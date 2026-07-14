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
#[derive(Debug, Clone, Copy, Default, Deserialize, Serialize, PartialEq, Eq)]
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
#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
pub struct KclRuntimeFlags {
    pub use_new_lexer_parser: RuntimeFlag,
}

impl KclRuntimeFlags {
    pub const DEFAULT: Self = Self {
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
