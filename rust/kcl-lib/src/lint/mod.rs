pub mod checks;
mod rule;

pub use rule::Discovered;
pub use rule::Finding;
pub use rule::FindingFamily;
pub use rule::Rule;
pub use rule::lint_and_fix_all;
pub use rule::lint_and_fix_families;

/// Controls opt-in lint rules that are not ready for all KCL consumers.
#[derive(Debug, Clone, Copy, Default)]
pub struct LintOptions {
    /// Enable the Z0006 deprecated edge API migration lint.
    enable_z0006: bool,
}

impl LintOptions {
    /// Include the Z0006 deprecated edge API migration lint.
    pub fn with_z0006(mut self, enable: bool) -> Self {
        self.enable_z0006 = enable;
        self
    }

    pub(crate) fn z0006_enabled(self) -> bool {
        self.enable_z0006
    }
}
