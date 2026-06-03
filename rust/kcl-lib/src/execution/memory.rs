//! Facade for KCL memory implementations.
//!
//! Keeping memory implementations behind this facade lets new memory backends
//! be added without moving call sites first.

mod arena;
mod legacy;

use std::env;
use std::fmt;
use std::sync::Arc;
#[cfg(test)]
use std::sync::atomic::AtomicU8;
use std::sync::atomic::AtomicUsize;
#[cfg(test)]
use std::sync::atomic::Ordering;

use indexmap::IndexMap;
pub(crate) use legacy::MODULE_PREFIX;
pub(crate) use legacy::RETURN_NAME;
pub(crate) use legacy::SKETCH_PREFIX;
pub(crate) use legacy::TYPE_PREFIX;
use serde::Deserialize;
use serde::Serialize;

use crate::SourceRange;
use crate::errors::KclError;
use crate::execution::KclValue;

pub(crate) const KCL_MEMORY_IMPL_ENV_VAR: &str = "KCL_MEMORY_IMPL";

/// An index pointing to an environment at a point in time.
///
/// The first field indexes an environment, the second field is an epoch. An epoch of 0 is indicates
/// a dummy, error, or placeholder env ref, an epoch of `usize::MAX` represents the current most
/// recent epoch.
#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Hash, Eq, ts_rs::TS)]
pub struct EnvironmentRef(pub(crate) usize, pub(crate) usize);

impl EnvironmentRef {
    pub fn dummy() -> Self {
        Self(usize::MAX, 0)
    }

    pub(crate) fn current(index: usize) -> Self {
        Self(index, usize::MAX)
    }

    pub(crate) fn at_epoch(index: usize, epoch: usize) -> Self {
        Self(index, epoch)
    }

    pub(crate) fn is_regular(&self) -> bool {
        self.0 < usize::MAX && self.1 > 0
    }

    pub(crate) fn index(&self) -> usize {
        self.0
    }

    pub(crate) fn epoch(&self) -> usize {
        self.1
    }

    pub(crate) fn skip_env(&self) -> bool {
        self.0 == usize::MAX
    }

    /// Replace only the env index if it matches `old`.
    pub fn replace_env(&mut self, old: Self, new: Self) {
        if self.0 == old.0 {
            self.0 = new.0;
        }
    }

    /// Replace if it matches `old`.
    pub fn replace_env_and_epoch(&mut self, old: Self, new: Self) {
        if self.0 == old.0 && self.1 == old.1 {
            self.0 = new.0;
            self.1 = new.1;
        }
    }
}

// TODO keep per-stack stats to avoid so many atomic updates
#[derive(Debug, Default)]
pub(crate) struct MemoryStats {
    // Total number of environments created.
    env_count: AtomicUsize,
    // Total number of epochs.
    epoch_count: AtomicUsize,
    // Total number of values inserted or updated.
    mutation_count: AtomicUsize,
    // The number of iterations waiting for a spin lock.
    lock_waits: AtomicUsize,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum MemoryBackendKind {
    Legacy,
    Arena,
}

impl MemoryBackendKind {
    pub(crate) fn from_env() -> Self {
        #[cfg(test)]
        if let Some(backend) = Self::test_override() {
            return backend;
        }

        match env::var(KCL_MEMORY_IMPL_ENV_VAR) {
            Ok(value) => Self::parse(&value),
            Err(env::VarError::NotPresent) => Self::Arena,
            Err(env::VarError::NotUnicode(value)) => {
                panic!(
                    "{KCL_MEMORY_IMPL_ENV_VAR} must be valid unicode; got `{}`.",
                    value.to_string_lossy()
                )
            }
        }
    }

    fn parse(value: &str) -> Self {
        if value.trim().is_empty() || value.eq_ignore_ascii_case("arena") {
            return Self::Arena;
        }

        if value.eq_ignore_ascii_case("legacy") {
            return Self::Legacy;
        }

        panic!("Unsupported {KCL_MEMORY_IMPL_ENV_VAR} value `{value}`. Expected `legacy` or `arena`.")
    }

    #[cfg(test)]
    pub(crate) fn override_for_test(backend: Self) -> MemoryBackendOverrideGuard {
        let previous = TEST_BACKEND_OVERRIDE.swap(backend.test_override_value(), Ordering::SeqCst);
        MemoryBackendOverrideGuard { previous }
    }

    #[cfg(test)]
    fn test_override() -> Option<Self> {
        match TEST_BACKEND_OVERRIDE.load(Ordering::SeqCst) {
            1 => Some(Self::Legacy),
            2 => Some(Self::Arena),
            _ => None,
        }
    }

    #[cfg(test)]
    fn test_override_value(self) -> u8 {
        match self {
            Self::Legacy => 1,
            Self::Arena => 2,
        }
    }
}

#[cfg(test)]
static TEST_BACKEND_OVERRIDE: AtomicU8 = AtomicU8::new(0);

#[cfg(test)]
pub(crate) struct MemoryBackendOverrideGuard {
    previous: u8,
}

#[cfg(test)]
impl Drop for MemoryBackendOverrideGuard {
    fn drop(&mut self) {
        TEST_BACKEND_OVERRIDE.store(self.previous, Ordering::SeqCst);
    }
}

#[derive(Debug)]
enum ProgramMemoryBackend {
    Legacy(Arc<legacy::ProgramMemory>),
    Arena(Arc<arena::ProgramMemory>),
}

#[derive(Debug, Clone)]
enum StackBackend {
    Legacy(legacy::Stack),
    Arena(arena::Stack),
}

/// Switchable KCL memory facade.
#[derive(Debug)]
pub(crate) struct ProgramMemory {
    backend: ProgramMemoryBackend,
}

/// Switchable KCL stack facade.
#[derive(Debug, Clone)]
pub(crate) struct Stack {
    pub(crate) memory: Arc<ProgramMemory>,
    backend: StackBackend,
}

impl fmt::Display for ProgramMemory {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match &self.backend {
            ProgramMemoryBackend::Legacy(memory) => memory.fmt(f),
            ProgramMemoryBackend::Arena(memory) => memory.fmt(f),
        }
    }
}

impl fmt::Display for Stack {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match &self.backend {
            StackBackend::Legacy(stack) => stack.fmt(f),
            StackBackend::Arena(stack) => stack.fmt(f),
        }
    }
}

impl ProgramMemory {
    #[allow(clippy::new_without_default)]
    pub fn new() -> Arc<Self> {
        Self::new_with_backend(MemoryBackendKind::from_env())
    }

    pub(crate) fn new_with_backend(backend: MemoryBackendKind) -> Arc<Self> {
        match backend {
            MemoryBackendKind::Legacy => Arc::new(Self {
                backend: ProgramMemoryBackend::Legacy(legacy::ProgramMemory::new()),
            }),
            MemoryBackendKind::Arena => Arc::new(Self {
                backend: ProgramMemoryBackend::Arena(arena::ProgramMemory::new()),
            }),
        }
    }

    pub fn new_stack(self: Arc<Self>) -> Stack {
        let backend = match &self.backend {
            ProgramMemoryBackend::Legacy(memory) => StackBackend::Legacy(Arc::clone(memory).new_stack()),
            ProgramMemoryBackend::Arena(memory) => StackBackend::Arena(Arc::clone(memory).new_stack()),
        };

        Stack { memory: self, backend }
    }

    pub fn set_std(self: &mut Arc<Self>, std: EnvironmentRef) -> Result<(), KclError> {
        match &self.backend {
            ProgramMemoryBackend::Legacy(memory) => {
                let mut memory = Arc::clone(memory);
                memory.set_std(std);
                Ok(())
            }
            ProgramMemoryBackend::Arena(memory) => {
                let mut memory = Arc::clone(memory);
                memory.set_std(std)
            }
        }
    }

    pub fn requires_std(&self) -> bool {
        match &self.backend {
            ProgramMemoryBackend::Legacy(memory) => memory.requires_std(),
            ProgramMemoryBackend::Arena(memory) => memory.requires_std(),
        }
    }

    pub(crate) fn stats(&self) -> &MemoryStats {
        match &self.backend {
            ProgramMemoryBackend::Legacy(memory) => &memory.stats,
            ProgramMemoryBackend::Arena(memory) => &memory.stats,
        }
    }

    pub fn get_from_owned(
        &self,
        var: &str,
        env_ref: EnvironmentRef,
        source_range: SourceRange,
        owner: usize,
    ) -> Result<KclValue, KclError> {
        match &self.backend {
            ProgramMemoryBackend::Legacy(memory) => memory.get_from_owned(var, env_ref, source_range, owner),
            ProgramMemoryBackend::Arena(memory) => memory.get_from_owned(var, env_ref, source_range, owner),
        }
    }

    #[cfg(test)]
    pub fn get_from_unchecked(&self, var: &str, env_ref: EnvironmentRef) -> Result<KclValue, KclError> {
        match &self.backend {
            ProgramMemoryBackend::Legacy(memory) => memory.get_from_unchecked(var, env_ref).cloned(),
            ProgramMemoryBackend::Arena(memory) => memory.get_from(var, env_ref, SourceRange::default(), 0),
        }
    }
}

impl Stack {
    pub fn deep_clone(&self) -> Result<Stack, KclError> {
        match &self.backend {
            StackBackend::Legacy(stack) => {
                let stack = stack.deep_clone();
                Ok(Stack {
                    memory: Arc::new(ProgramMemory {
                        backend: ProgramMemoryBackend::Legacy(Arc::clone(&stack.memory)),
                    }),
                    backend: StackBackend::Legacy(stack),
                })
            }
            StackBackend::Arena(stack) => {
                let stack = stack.deep_clone()?;
                Ok(Stack {
                    memory: Arc::new(ProgramMemory {
                        backend: ProgramMemoryBackend::Arena(Arc::clone(&stack.memory)),
                    }),
                    backend: StackBackend::Arena(stack),
                })
            }
        }
    }

    #[cfg(test)]
    pub fn new_for_tests() -> Stack {
        Self::new_for_tests_with_backend(MemoryBackendKind::from_env())
    }

    #[cfg(test)]
    pub(crate) fn new_for_tests_with_backend(backend: MemoryBackendKind) -> Stack {
        let mut stack = ProgramMemory::new_with_backend(backend).new_stack();
        stack
            .push_new_root_env(false)
            .expect("test stack root environment should be created");
        let std = stack.current_env_ref();
        stack
            .memory
            .set_std(std)
            .expect("test standard library prelude should be initialized");
        stack
    }

    pub fn current_epoch(&self) -> usize {
        match &self.backend {
            StackBackend::Legacy(stack) => stack.current_epoch(),
            StackBackend::Arena(stack) => stack.current_epoch(),
        }
    }

    #[cfg(test)]
    pub(crate) fn current_env_ref(&self) -> EnvironmentRef {
        match &self.backend {
            StackBackend::Legacy(stack) => stack.current_env_ref(),
            StackBackend::Arena(stack) => stack.current_env_ref(),
        }
    }

    pub fn push_new_env_for_call(&mut self, parent: EnvironmentRef) -> Result<(), KclError> {
        match &mut self.backend {
            StackBackend::Legacy(stack) => {
                stack.push_new_env_for_call(parent);
                Ok(())
            }
            StackBackend::Arena(stack) => stack.push_new_env_for_call(parent),
        }
    }

    pub fn push_new_env_for_scope(&mut self) -> Result<(), KclError> {
        match &mut self.backend {
            StackBackend::Legacy(stack) => {
                stack.push_new_env_for_scope();
                Ok(())
            }
            StackBackend::Arena(stack) => stack.push_new_env_for_scope(),
        }
    }

    pub fn push_new_root_env(&mut self, include_prelude: bool) -> Result<(), KclError> {
        match &mut self.backend {
            StackBackend::Legacy(stack) => {
                stack.push_new_root_env(include_prelude);
                Ok(())
            }
            StackBackend::Arena(stack) => stack.push_new_root_env(include_prelude),
        }
    }

    pub fn restore_env(&mut self, env: EnvironmentRef) -> Result<(), KclError> {
        match &mut self.backend {
            StackBackend::Legacy(stack) => {
                stack.restore_env(env);
                Ok(())
            }
            StackBackend::Arena(stack) => stack.restore_env(env),
        }
    }

    pub fn pop_env(&mut self) -> Result<EnvironmentRef, KclError> {
        match &mut self.backend {
            StackBackend::Legacy(stack) => Ok(stack.pop_env()),
            StackBackend::Arena(stack) => stack.pop_env(),
        }
    }

    pub fn pop_and_preserve_env(&mut self) -> Result<EnvironmentRef, KclError> {
        match &mut self.backend {
            StackBackend::Legacy(stack) => Ok(stack.pop_and_preserve_env()),
            StackBackend::Arena(stack) => stack.pop_and_preserve_env(),
        }
    }

    pub fn squash_env(&mut self, old: EnvironmentRef) -> Result<(), KclError> {
        match &mut self.backend {
            StackBackend::Legacy(stack) => {
                stack.squash_env(old);
                Ok(())
            }
            StackBackend::Arena(stack) => stack.squash_env(old),
        }
    }

    pub fn snapshot(&mut self) -> Result<EnvironmentRef, KclError> {
        match &mut self.backend {
            StackBackend::Legacy(stack) => Ok(stack.snapshot()),
            StackBackend::Arena(stack) => stack.snapshot(),
        }
    }

    pub fn add(&mut self, key: String, value: KclValue, source_range: SourceRange) -> Result<(), KclError> {
        match &mut self.backend {
            StackBackend::Legacy(stack) => stack.add(key, value, source_range),
            StackBackend::Arena(stack) => stack.add(key, value, source_range),
        }
    }

    pub fn add_recursive_closure(
        &mut self,
        key: String,
        value: KclValue,
        placeholder_env_ref: EnvironmentRef,
        source_range: SourceRange,
    ) -> Result<KclValue, KclError> {
        match &mut self.backend {
            StackBackend::Legacy(stack) => stack.add_recursive_closure(key, value, placeholder_env_ref, source_range),
            StackBackend::Arena(stack) => stack.add_recursive_closure(key, value, placeholder_env_ref, source_range),
        }
    }

    pub fn update(&mut self, key: &str, f: impl Fn(&mut KclValue, usize)) -> Result<(), KclError> {
        match &mut self.backend {
            StackBackend::Legacy(stack) => stack.update(key, f),
            StackBackend::Arena(stack) => stack.update(key, f),
        }
    }

    pub fn get(&self, var: &str, source_range: SourceRange) -> Result<KclValue, KclError> {
        match &self.backend {
            StackBackend::Legacy(stack) => stack.get(var, source_range),
            StackBackend::Arena(stack) => stack.get(var, source_range),
        }
    }

    pub fn get_owned(&self, var: &str, source_range: SourceRange) -> Result<KclValue, KclError> {
        match &self.backend {
            StackBackend::Legacy(stack) => stack.get_owned(var, source_range),
            StackBackend::Arena(stack) => stack.get_owned(var, source_range),
        }
    }

    pub fn cur_frame_contains(&self, var: &str) -> Result<bool, KclError> {
        match &self.backend {
            StackBackend::Legacy(stack) => stack.cur_frame_contains(var),
            StackBackend::Arena(stack) => stack.cur_frame_contains(var),
        }
    }

    pub fn get_from_call_stack(&self, key: &str, source_range: SourceRange) -> Result<(usize, KclValue), KclError> {
        match &self.backend {
            StackBackend::Legacy(stack) => stack.get_from_call_stack(key, source_range),
            StackBackend::Arena(stack) => stack.get_from_call_stack(key, source_range),
        }
    }

    pub fn find_keys_in_current_env(&self, pred: impl Fn(&KclValue) -> bool) -> Result<Vec<String>, KclError> {
        match &self.backend {
            StackBackend::Legacy(stack) => Ok(stack.find_keys_in_current_env(pred)),
            StackBackend::Arena(stack) => stack.find_keys_in_current_env(pred),
        }
    }

    pub fn find_all_in_current_env(&self) -> Result<Vec<(String, KclValue)>, KclError> {
        match &self.backend {
            StackBackend::Legacy(stack) => Ok(stack.find_all_in_current_env()),
            StackBackend::Arena(stack) => stack.find_all_in_current_env(),
        }
    }

    pub fn find_all_in_env(&self, env: EnvironmentRef) -> Result<Vec<(String, KclValue)>, KclError> {
        match &self.backend {
            StackBackend::Legacy(stack) => Ok(stack.find_all_in_env(env)),
            StackBackend::Arena(stack) => stack.find_all_in_env(env),
        }
    }

    pub(crate) fn find_all_in_env_owned(&self, env: EnvironmentRef) -> Result<IndexMap<String, KclValue>, KclError> {
        Ok(self.find_all_in_env(env)?.into_iter().collect())
    }

    pub(crate) fn find_var_name_in_all_envs(
        &self,
        pred: impl Fn(&KclValue) -> bool,
    ) -> Result<Option<String>, KclError> {
        match &self.backend {
            StackBackend::Legacy(stack) => Ok(stack.find_var_name_in_all_envs(pred)),
            StackBackend::Arena(stack) => stack.find_var_name_in_all_envs(pred),
        }
    }

    pub fn walk_call_stack_with<T>(&self, f: impl FnMut(&KclValue) -> Option<T>) -> Result<Vec<T>, KclError> {
        match &self.backend {
            StackBackend::Legacy(stack) => Ok(stack.walk_call_stack_with(f)),
            StackBackend::Arena(stack) => stack.walk_call_stack_with(f),
        }
    }
}

#[cfg(test)]
impl PartialEq for Stack {
    fn eq(&self, other: &Self) -> bool {
        let vars = self
            .find_keys_in_current_env(|_| true)
            .expect("stack equality should enumerate current env");
        let vars_other = other
            .find_keys_in_current_env(|_| true)
            .expect("stack equality should enumerate other current env");
        if vars != vars_other {
            return false;
        }

        vars.iter().all(|key| {
            self.get(key, SourceRange::default()).unwrap() == other.get(key, SourceRange::default()).unwrap()
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_legacy_backend_name() {
        assert_eq!(MemoryBackendKind::parse("legacy"), MemoryBackendKind::Legacy);
        assert_eq!(MemoryBackendKind::parse("LeGaCy"), MemoryBackendKind::Legacy);
    }

    #[test]
    fn parses_arena_backend_name() {
        assert_eq!(MemoryBackendKind::parse("arena"), MemoryBackendKind::Arena);
        assert_eq!(MemoryBackendKind::parse("ArEnA"), MemoryBackendKind::Arena);
    }

    #[test]
    fn empty_backend_name_uses_arena() {
        assert_eq!(MemoryBackendKind::parse(""), MemoryBackendKind::Arena);
        assert_eq!(MemoryBackendKind::parse("   "), MemoryBackendKind::Arena);
    }

    #[test]
    #[should_panic(expected = "Unsupported KCL_MEMORY_IMPL value `frozen`. Expected `legacy` or `arena`.")]
    fn unsupported_backend_name_panics() {
        MemoryBackendKind::parse("frozen");
    }
}
