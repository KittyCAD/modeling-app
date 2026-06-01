//! Facade for KCL memory implementations.
//!
//! Keeping memory implementations behind this facade lets new memory backends
//! be added without moving call sites first.

mod arena;
mod legacy;

use std::env;
use std::fmt;
use std::sync::Arc;
use std::sync::atomic::AtomicUsize;

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

    pub(crate) fn is_regular(&self) -> bool {
        self.0 < usize::MAX && self.1 > 0
    }

    pub(crate) fn index(&self) -> usize {
        self.0
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
        match env::var(KCL_MEMORY_IMPL_ENV_VAR) {
            Ok(value) => Self::parse(&value),
            Err(env::VarError::NotPresent) => Self::Legacy,
            Err(env::VarError::NotUnicode(value)) => {
                panic!(
                    "{KCL_MEMORY_IMPL_ENV_VAR} must be valid unicode; got `{}`.",
                    value.to_string_lossy()
                )
            }
        }
    }

    fn parse(value: &str) -> Self {
        if value.trim().is_empty() || value.eq_ignore_ascii_case("legacy") {
            return Self::Legacy;
        }

        if value.eq_ignore_ascii_case("arena") {
            return Self::Arena;
        }

        panic!("Unsupported {KCL_MEMORY_IMPL_ENV_VAR} value `{value}`. Expected `legacy` or `arena`.")
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

    pub fn set_std(self: &mut Arc<Self>, std: EnvironmentRef) {
        match &self.backend {
            ProgramMemoryBackend::Legacy(memory) => {
                let mut memory = Arc::clone(memory);
                memory.set_std(std);
            }
            ProgramMemoryBackend::Arena(memory) => {
                let mut memory = Arc::clone(memory);
                memory.set_std(std);
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

    pub fn get_from(
        &self,
        var: &str,
        env_ref: EnvironmentRef,
        source_range: SourceRange,
        owner: usize,
    ) -> Result<&KclValue, KclError> {
        match &self.backend {
            ProgramMemoryBackend::Legacy(memory) => memory.get_from(var, env_ref, source_range, owner),
            ProgramMemoryBackend::Arena(memory) => memory.get_from(var, env_ref, source_range, owner),
        }
    }

    #[cfg(test)]
    pub fn get_from_unchecked(&self, var: &str, env_ref: EnvironmentRef) -> Result<&KclValue, KclError> {
        match &self.backend {
            ProgramMemoryBackend::Legacy(memory) => memory.get_from_unchecked(var, env_ref),
            ProgramMemoryBackend::Arena(memory) => memory.get_from_unchecked(var, env_ref),
        }
    }
}

impl Stack {
    pub fn deep_clone(&self) -> Stack {
        match &self.backend {
            StackBackend::Legacy(stack) => {
                let stack = stack.deep_clone();
                Stack {
                    memory: Arc::new(ProgramMemory {
                        backend: ProgramMemoryBackend::Legacy(Arc::clone(&stack.memory)),
                    }),
                    backend: StackBackend::Legacy(stack),
                }
            }
            StackBackend::Arena(stack) => {
                let stack = stack.deep_clone();
                Stack {
                    memory: Arc::new(ProgramMemory {
                        backend: ProgramMemoryBackend::Arena(Arc::clone(&stack.memory)),
                    }),
                    backend: StackBackend::Arena(stack),
                }
            }
        }
    }

    #[cfg(test)]
    pub fn new_for_tests() -> Stack {
        let stack = legacy::Stack::new_for_tests();
        Stack {
            memory: Arc::new(ProgramMemory {
                backend: ProgramMemoryBackend::Legacy(Arc::clone(&stack.memory)),
            }),
            backend: StackBackend::Legacy(stack),
        }
    }

    pub fn current_epoch(&self) -> usize {
        match &self.backend {
            StackBackend::Legacy(stack) => stack.current_epoch(),
            StackBackend::Arena(stack) => stack.current_epoch(),
        }
    }

    pub fn push_new_env_for_call(&mut self, parent: EnvironmentRef) {
        match &mut self.backend {
            StackBackend::Legacy(stack) => stack.push_new_env_for_call(parent),
            StackBackend::Arena(stack) => stack.push_new_env_for_call(parent),
        }
    }

    pub fn push_new_env_for_scope(&mut self) {
        match &mut self.backend {
            StackBackend::Legacy(stack) => stack.push_new_env_for_scope(),
            StackBackend::Arena(stack) => stack.push_new_env_for_scope(),
        }
    }

    pub fn push_new_root_env(&mut self, include_prelude: bool) {
        match &mut self.backend {
            StackBackend::Legacy(stack) => stack.push_new_root_env(include_prelude),
            StackBackend::Arena(stack) => stack.push_new_root_env(include_prelude),
        }
    }

    pub fn restore_env(&mut self, env: EnvironmentRef) {
        match &mut self.backend {
            StackBackend::Legacy(stack) => stack.restore_env(env),
            StackBackend::Arena(stack) => stack.restore_env(env),
        }
    }

    pub fn pop_env(&mut self) -> EnvironmentRef {
        match &mut self.backend {
            StackBackend::Legacy(stack) => stack.pop_env(),
            StackBackend::Arena(stack) => stack.pop_env(),
        }
    }

    pub fn pop_and_preserve_env(&mut self) -> EnvironmentRef {
        match &mut self.backend {
            StackBackend::Legacy(stack) => stack.pop_and_preserve_env(),
            StackBackend::Arena(stack) => stack.pop_and_preserve_env(),
        }
    }

    pub fn squash_env(&mut self, old: EnvironmentRef) {
        match &mut self.backend {
            StackBackend::Legacy(stack) => stack.squash_env(old),
            StackBackend::Arena(stack) => stack.squash_env(old),
        }
    }

    pub fn snapshot(&mut self) -> EnvironmentRef {
        match &mut self.backend {
            StackBackend::Legacy(stack) => stack.snapshot(),
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

    pub fn update(&mut self, key: &str, f: impl Fn(&mut KclValue, usize)) {
        match &mut self.backend {
            StackBackend::Legacy(stack) => stack.update(key, f),
            StackBackend::Arena(stack) => stack.update(key, f),
        }
    }

    pub fn get(&self, var: &str, source_range: SourceRange) -> Result<&KclValue, KclError> {
        match &self.backend {
            StackBackend::Legacy(stack) => stack.get(var, source_range),
            StackBackend::Arena(stack) => stack.get(var, source_range),
        }
    }

    pub fn cur_frame_contains(&self, var: &str) -> bool {
        match &self.backend {
            StackBackend::Legacy(stack) => stack.cur_frame_contains(var),
            StackBackend::Arena(stack) => stack.cur_frame_contains(var),
        }
    }

    pub fn get_from_call_stack(&self, key: &str, source_range: SourceRange) -> Result<(usize, &KclValue), KclError> {
        match &self.backend {
            StackBackend::Legacy(stack) => stack.get_from_call_stack(key, source_range),
            StackBackend::Arena(stack) => stack.get_from_call_stack(key, source_range),
        }
    }

    pub fn find_keys_in_current_env<'a>(
        &'a self,
        pred: impl Fn(&KclValue) -> bool + 'a,
    ) -> Box<dyn Iterator<Item = &'a String> + 'a> {
        match &self.backend {
            StackBackend::Legacy(stack) => Box::new(stack.find_keys_in_current_env(pred)),
            StackBackend::Arena(stack) => Box::new(stack.find_keys_in_current_env(pred)),
        }
    }

    pub fn find_all_in_current_env(&self) -> Box<dyn Iterator<Item = (&String, &KclValue)> + '_> {
        match &self.backend {
            StackBackend::Legacy(stack) => Box::new(stack.find_all_in_current_env()),
            StackBackend::Arena(stack) => Box::new(stack.find_all_in_current_env()),
        }
    }

    pub fn find_all_in_env(&self, env: EnvironmentRef) -> Box<dyn Iterator<Item = (&String, &KclValue)> + '_> {
        match &self.backend {
            StackBackend::Legacy(stack) => Box::new(stack.find_all_in_env(env)),
            StackBackend::Arena(stack) => Box::new(stack.find_all_in_env(env)),
        }
    }

    pub(crate) fn find_var_name_in_all_envs(&self, pred: impl Fn(&KclValue) -> bool) -> Option<String> {
        match &self.backend {
            StackBackend::Legacy(stack) => stack.find_var_name_in_all_envs(pred),
            StackBackend::Arena(stack) => stack.find_var_name_in_all_envs(pred),
        }
    }

    pub fn walk_call_stack(&self) -> Box<dyn Iterator<Item = &KclValue> + '_> {
        match &self.backend {
            StackBackend::Legacy(stack) => Box::new(stack.walk_call_stack()),
            StackBackend::Arena(stack) => Box::new(stack.walk_call_stack()),
        }
    }
}

#[cfg(test)]
impl PartialEq for Stack {
    fn eq(&self, other: &Self) -> bool {
        match (&self.backend, &other.backend) {
            (StackBackend::Legacy(left), StackBackend::Legacy(right)) => left == right,
            (StackBackend::Arena(left), StackBackend::Arena(right)) => left == right,
            _ => false,
        }
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
    fn empty_backend_name_uses_legacy() {
        assert_eq!(MemoryBackendKind::parse(""), MemoryBackendKind::Legacy);
        assert_eq!(MemoryBackendKind::parse("   "), MemoryBackendKind::Legacy);
    }

    #[test]
    #[should_panic(expected = "Unsupported KCL_MEMORY_IMPL value `frozen`. Expected `legacy` or `arena`.")]
    fn unsupported_backend_name_panics() {
        MemoryBackendKind::parse("frozen");
    }
}
