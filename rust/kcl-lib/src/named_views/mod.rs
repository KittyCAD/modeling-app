//! Named-view support.

pub use kcl_api::ArtifactId;
pub use kcl_api::artifact::Artifact;
pub use kcl_api::artifact::ArtifactGraph;
pub use visibility::engine_id_for_artifact;

pub(crate) mod values;
mod visibility;

#[cfg(test)]
mod tests;

/// Returns the reserved name of the default KCL view.
pub fn default_view_name() -> &'static str {
    values::RESERVED_DEFAULT_VIEW_NAME
}
