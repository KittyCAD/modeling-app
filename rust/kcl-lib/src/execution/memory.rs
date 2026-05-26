//! Switchable facade for KCL memory implementations.
//!
//! The legacy implementation is still the only active backend. The facade exists
//! so a frozen-env implementation can be added and compared without changing the
//! rest of execution code.

mod legacy;

use std::env;

pub use legacy::EnvironmentRef;
pub(crate) use legacy::MODULE_PREFIX;
pub(crate) use legacy::ProgramMemory;
pub(crate) use legacy::RETURN_NAME;
pub(crate) use legacy::SKETCH_PREFIX;
pub(crate) use legacy::Stack;
pub(crate) use legacy::TYPE_PREFIX;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum MemoryBackendKind {
    Legacy,
    Frozen,
}

impl MemoryBackendKind {
    const ENV_VAR: &'static str = "KCL_MEMORY_IMPL";

    pub(crate) fn from_env() -> Self {
        match env::var(Self::ENV_VAR) {
            Ok(value) if value.eq_ignore_ascii_case("legacy") => Self::Legacy,
            Ok(value) if value.eq_ignore_ascii_case("frozen") => Self::Frozen,
            Ok(value) if value.trim().is_empty() => Self::Legacy,
            Ok(value) => panic!(
                "Unsupported {} value `{}`. Expected `legacy` or `frozen`.",
                Self::ENV_VAR,
                value
            ),
            Err(env::VarError::NotPresent) => Self::Legacy,
            Err(env::VarError::NotUnicode(_)) => {
                panic!("{} must be valid unicode.", Self::ENV_VAR)
            }
        }
    }
}
