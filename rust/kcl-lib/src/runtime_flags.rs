use std::sync::RwLock;

use serde::Deserialize;
use serde::Serialize;

/// Runtime representation for feature flags that can be set by the TS app.
///
/// TS currently provides a two-state feature answer: `true` means the feature is
/// on, while `false` covers both explicit off/default behavior and a missing
/// feature entry. Rust keeps a third state so code that was not initialized
/// through the TS/wasm path can still fall back to Rust-side defaults, such as
/// env-based configuration.
#[derive(Debug, Clone, Copy, Default, Deserialize, Serialize, PartialEq, Eq, ts_rs::TS)]
#[ts(export)]
pub enum RuntimeFlag {
    /// No TS/wasm runtime flag has been installed; fall back to Rust defaults.
    #[default]
    Unset,
    /// TS observed the feature as on; use the new feature behavior.
    On,
    /// TS observed the feature as false or missing; use default behavior.
    Off,
}

/// Maps 1-1 to the KCL related flags added to the Admin portal and TS.
///
/// Fields missing from a deserialized payload become [`RuntimeFlag::Unset`],
/// so a sender built before a flag existed falls back to Rust-side defaults
/// instead of failing to parse.
#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq, ts_rs::TS)]
#[ts(export)]
pub struct KclRuntimeFlags {
    #[serde(default)]
    pub use_cek_executor: RuntimeFlag,
    #[serde(default)]
    pub use_new_lexer_parser: RuntimeFlag,
}

impl KclRuntimeFlags {
    pub const DEFAULT: Self = Self {
        use_cek_executor: RuntimeFlag::Unset,
        use_new_lexer_parser: RuntimeFlag::Unset,
    };
}

impl Default for KclRuntimeFlags {
    fn default() -> Self {
        Self::DEFAULT
    }
}

static KCL_RUNTIME_FLAGS: RwLock<KclRuntimeFlags> = RwLock::new(KclRuntimeFlags::DEFAULT);

pub fn set_kcl_runtime_flags(flags: KclRuntimeFlags) {
    match KCL_RUNTIME_FLAGS.write() {
        Ok(mut guard) => *guard = flags,
        Err(poisoned) => {
            let mut guard = poisoned.into_inner();
            *guard = flags;
        }
    }
}

pub fn kcl_runtime_flags() -> KclRuntimeFlags {
    match KCL_RUNTIME_FLAGS.read() {
        Ok(guard) => *guard,
        Err(poisoned) => *poisoned.into_inner(),
    }
}

pub(crate) trait RuntimeFlagResolve {
    fn on() -> Self;
    fn off() -> Self;
    /// Not named `default()` so that it doesn't collide with
    /// `Default::default()`.
    fn resolve_default() -> Self;
    fn parse_env_var(value: &str) -> Self;
}

pub(crate) fn resolve_from_sources<T: RuntimeFlagResolve>(
    runtime_flag: RuntimeFlag,
    test_override: Option<T>,
    env_value: Option<&str>,
) -> T {
    match runtime_flag {
        RuntimeFlag::On => return T::on(),
        RuntimeFlag::Off => return T::off(),
        RuntimeFlag::Unset => {}
    }

    if let Some(mode) = test_override {
        return mode;
    }

    env_value.map(T::parse_env_var).unwrap_or_else(T::resolve_default)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deserializing_empty_flags_defaults_to_unset() {
        let flags: KclRuntimeFlags = serde_json::from_str("{}").unwrap();
        assert_eq!(flags, KclRuntimeFlags::DEFAULT);
    }

    #[test]
    fn deserializing_partial_flags_defaults_missing_fields_to_unset() {
        let flags: KclRuntimeFlags = serde_json::from_str(r#"{"use_new_lexer_parser":"On"}"#).unwrap();
        assert_eq!(
            flags,
            KclRuntimeFlags {
                use_cek_executor: RuntimeFlag::Unset,
                use_new_lexer_parser: RuntimeFlag::On,
            }
        );
    }
}
