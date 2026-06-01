//! Facade for KCL memory implementations.
//!
//! The legacy implementation is still the only backend. Keeping it behind this
//! facade lets new memory backends be added without moving call sites first.

mod legacy;

use std::env;
use std::ffi::OsString;

pub use legacy::EnvironmentRef;
pub(crate) use legacy::MODULE_PREFIX;
pub(crate) use legacy::ProgramMemory;
pub(crate) use legacy::RETURN_NAME;
pub(crate) use legacy::SKETCH_PREFIX;
pub(crate) use legacy::Stack;
pub(crate) use legacy::TYPE_PREFIX;

use crate::errors::KclError;

pub(crate) const KCL_MEMORY_IMPL_ENV_VAR: &str = "KCL_MEMORY_IMPL";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum MemoryBackendKind {
    Legacy,
}

impl MemoryBackendKind {
    // Wired into production construction once ExecState construction is fallible.
    #[allow(dead_code)]
    pub(crate) fn from_env() -> Result<Self, KclError> {
        match env::var(KCL_MEMORY_IMPL_ENV_VAR) {
            Ok(value) => Self::parse(&value),
            Err(env::VarError::NotPresent) => Ok(Self::Legacy),
            Err(env::VarError::NotUnicode(value)) => Err(Self::invalid_unicode(value)),
        }
    }

    fn parse(value: &str) -> Result<Self, KclError> {
        if value.trim().is_empty() || value.eq_ignore_ascii_case("legacy") {
            return Ok(Self::Legacy);
        }

        Err(KclError::internal(format!(
            "Unsupported {KCL_MEMORY_IMPL_ENV_VAR} value `{value}`. Expected `legacy`."
        )))
    }

    #[allow(dead_code)]
    fn invalid_unicode(value: OsString) -> KclError {
        KclError::internal(format!(
            "{KCL_MEMORY_IMPL_ENV_VAR} must be valid unicode; got `{}`.",
            value.to_string_lossy()
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_legacy_backend_name() {
        assert_eq!(MemoryBackendKind::parse("legacy").unwrap(), MemoryBackendKind::Legacy);
        assert_eq!(MemoryBackendKind::parse("LeGaCy").unwrap(), MemoryBackendKind::Legacy);
    }

    #[test]
    fn empty_backend_name_uses_legacy() {
        assert_eq!(MemoryBackendKind::parse("").unwrap(), MemoryBackendKind::Legacy);
        assert_eq!(MemoryBackendKind::parse("   ").unwrap(), MemoryBackendKind::Legacy);
    }

    #[test]
    fn unsupported_backend_name_returns_error() {
        let error = MemoryBackendKind::parse("arena").unwrap_err();
        assert!(error.to_string().contains("Unsupported KCL_MEMORY_IMPL value `arena`"));
    }
}
