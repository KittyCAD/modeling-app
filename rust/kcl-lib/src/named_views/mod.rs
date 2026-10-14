//! Named-view support.

pub(crate) mod values;

/// Returns the reserved name of the default KCL view.
pub fn default_view_name() -> &'static str {
    values::RESERVED_DEFAULT_VIEW_NAME
}
