//! Facade for KCL memory implementations.
//!
//! The legacy implementation is still the only backend. Keeping it behind this
//! facade lets new memory backends be added without moving call sites first.

mod legacy;

use std::env;
use std::fmt;
use std::sync::Arc;

pub use legacy::EnvironmentRef;
pub(crate) use legacy::MODULE_PREFIX;
pub(crate) use legacy::RETURN_NAME;
pub(crate) use legacy::SKETCH_PREFIX;
pub(crate) use legacy::TYPE_PREFIX;

use crate::SourceRange;
use crate::errors::KclError;
use crate::execution::KclValue;

pub(crate) const KCL_MEMORY_IMPL_ENV_VAR: &str = "KCL_MEMORY_IMPL";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum MemoryBackendKind {
    Legacy,
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

        panic!("Unsupported {KCL_MEMORY_IMPL_ENV_VAR} value `{value}`. Expected `legacy`.")
    }
}

#[derive(Debug)]
enum ProgramMemoryBackend {
    Legacy(Arc<legacy::ProgramMemory>),
}

#[derive(Debug, Clone)]
enum StackBackend {
    Legacy(legacy::Stack),
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
        }
    }
}

impl fmt::Display for Stack {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match &self.backend {
            StackBackend::Legacy(stack) => stack.fmt(f),
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
                backend: ProgramMemoryBackend::Legacy(legacy::ProgramMemory::new_with_backend(backend)),
            }),
        }
    }

    pub fn new_stack(self: Arc<Self>) -> Stack {
        let backend = match &self.backend {
            ProgramMemoryBackend::Legacy(memory) => StackBackend::Legacy(Arc::clone(memory).new_stack()),
        };

        Stack { memory: self, backend }
    }

    pub fn set_std(self: &mut Arc<Self>, std: EnvironmentRef) {
        match &self.backend {
            ProgramMemoryBackend::Legacy(memory) => {
                let mut memory = Arc::clone(memory);
                memory.set_std(std);
            }
        }
    }

    pub fn requires_std(&self) -> bool {
        match &self.backend {
            ProgramMemoryBackend::Legacy(memory) => memory.requires_std(),
        }
    }

    pub(crate) fn stats(&self) -> &legacy::MemoryStats {
        match &self.backend {
            ProgramMemoryBackend::Legacy(memory) => &memory.stats,
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
        }
    }

    #[cfg(test)]
    pub fn get_from_unchecked(&self, var: &str, env_ref: EnvironmentRef) -> Result<&KclValue, KclError> {
        match &self.backend {
            ProgramMemoryBackend::Legacy(memory) => memory.get_from_unchecked(var, env_ref),
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
        }
    }

    pub fn push_new_env_for_call(&mut self, parent: EnvironmentRef) {
        match &mut self.backend {
            StackBackend::Legacy(stack) => stack.push_new_env_for_call(parent),
        }
    }

    pub fn push_new_env_for_scope(&mut self) {
        match &mut self.backend {
            StackBackend::Legacy(stack) => stack.push_new_env_for_scope(),
        }
    }

    pub fn push_new_root_env(&mut self, include_prelude: bool) {
        match &mut self.backend {
            StackBackend::Legacy(stack) => stack.push_new_root_env(include_prelude),
        }
    }

    pub fn restore_env(&mut self, env: EnvironmentRef) {
        match &mut self.backend {
            StackBackend::Legacy(stack) => stack.restore_env(env),
        }
    }

    pub fn pop_env(&mut self) -> EnvironmentRef {
        match &mut self.backend {
            StackBackend::Legacy(stack) => stack.pop_env(),
        }
    }

    pub fn pop_and_preserve_env(&mut self) -> EnvironmentRef {
        match &mut self.backend {
            StackBackend::Legacy(stack) => stack.pop_and_preserve_env(),
        }
    }

    pub fn squash_env(&mut self, old: EnvironmentRef) {
        match &mut self.backend {
            StackBackend::Legacy(stack) => stack.squash_env(old),
        }
    }

    pub fn snapshot(&mut self) -> EnvironmentRef {
        match &mut self.backend {
            StackBackend::Legacy(stack) => stack.snapshot(),
        }
    }

    pub fn add(&mut self, key: String, value: KclValue, source_range: SourceRange) -> Result<(), KclError> {
        match &mut self.backend {
            StackBackend::Legacy(stack) => stack.add(key, value, source_range),
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
        }
    }

    pub fn update(&mut self, key: &str, f: impl Fn(&mut KclValue, usize)) {
        match &mut self.backend {
            StackBackend::Legacy(stack) => stack.update(key, f),
        }
    }

    pub fn get(&self, var: &str, source_range: SourceRange) -> Result<&KclValue, KclError> {
        match &self.backend {
            StackBackend::Legacy(stack) => stack.get(var, source_range),
        }
    }

    pub fn cur_frame_contains(&self, var: &str) -> bool {
        match &self.backend {
            StackBackend::Legacy(stack) => stack.cur_frame_contains(var),
        }
    }

    pub fn get_from_call_stack(&self, key: &str, source_range: SourceRange) -> Result<(usize, &KclValue), KclError> {
        match &self.backend {
            StackBackend::Legacy(stack) => stack.get_from_call_stack(key, source_range),
        }
    }

    pub fn find_keys_in_current_env<'a>(
        &'a self,
        pred: impl Fn(&KclValue) -> bool + 'a,
    ) -> impl Iterator<Item = &'a String> {
        match &self.backend {
            StackBackend::Legacy(stack) => stack.find_keys_in_current_env(pred),
        }
    }

    pub fn find_all_in_current_env(&self) -> impl Iterator<Item = (&String, &KclValue)> {
        match &self.backend {
            StackBackend::Legacy(stack) => stack.find_all_in_current_env(),
        }
    }

    pub fn find_all_in_env(&self, env: EnvironmentRef) -> impl Iterator<Item = (&String, &KclValue)> {
        match &self.backend {
            StackBackend::Legacy(stack) => stack.find_all_in_env(env),
        }
    }

    pub(crate) fn find_var_name_in_all_envs(&self, pred: impl Fn(&KclValue) -> bool) -> Option<String> {
        match &self.backend {
            StackBackend::Legacy(stack) => stack.find_var_name_in_all_envs(pred),
        }
    }

    pub fn walk_call_stack(&self) -> impl Iterator<Item = &KclValue> {
        match &self.backend {
            StackBackend::Legacy(stack) => stack.walk_call_stack(),
        }
    }
}

#[cfg(test)]
impl PartialEq for Stack {
    fn eq(&self, other: &Self) -> bool {
        match (&self.backend, &other.backend) {
            (StackBackend::Legacy(left), StackBackend::Legacy(right)) => left == right,
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
    fn empty_backend_name_uses_legacy() {
        assert_eq!(MemoryBackendKind::parse(""), MemoryBackendKind::Legacy);
        assert_eq!(MemoryBackendKind::parse("   "), MemoryBackendKind::Legacy);
    }

    #[test]
    #[should_panic(expected = "Unsupported KCL_MEMORY_IMPL value `arena`. Expected `legacy`.")]
    fn unsupported_backend_name_panics() {
        MemoryBackendKind::parse("arena");
    }
}
