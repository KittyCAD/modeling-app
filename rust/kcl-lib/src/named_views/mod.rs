//! Named-view support.

pub use kcl_api::ArtifactId;
pub use kcl_api::Operation;
pub use kcl_api::artifact::Artifact;
pub use kcl_api::artifact::ArtifactCameraLook;
pub use kcl_api::artifact::ArtifactCameraView;
pub use kcl_api::artifact::ArtifactGraph;
pub use kcl_api::artifact::ArtifactOrientation;
pub use kcl_api::artifact::ArtifactPoint3d;
pub use kcl_api::artifact::ArtifactProjection;
pub use kcl_api::modules::ModulePath;
pub use kcl_error::ModuleId;
pub use resolver::NamedViewInfo;
pub use resolver::NamedViewResolutionFailure;
pub use resolver::ResolvedNamedView;
pub use resolver::ResolvedView;
pub use resolver::ResolvedViewBatch;
pub use resolver::ViewResolutionError;
pub use resolver::ViewTarget;
pub(crate) use resolver::resolve_all;
pub use visibility::engine_id_for_artifact;

mod resolver;
pub(crate) mod values;
mod visibility;

#[cfg(test)]
mod execution_tests;
#[cfg(test)]
mod tests;

/// Returns the reserved name of the default KCL view.
pub fn default_view_name() -> &'static str {
    values::RESERVED_DEFAULT_VIEW_NAME
}
