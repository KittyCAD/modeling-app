use indexmap::IndexMap;
use kcl_api::artifact::NamedViewArtifact;
use uuid::Uuid;

use super::Artifact;
use super::ArtifactCameraView;
use super::ArtifactGraph;
use super::ArtifactId;
use super::ModuleId;
use super::ModulePath;
use super::Operation;
use super::visibility;

/// A declared view's identity and source-file metadata.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NamedViewInfo {
    pub artifact_id: ArtifactId,
    pub name: String,
    pub module_id: ModuleId,
    pub module_path: ModulePath,
}

/// Selects a view within one execution's output.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ViewTarget {
    /// The visibility produced by the program's hide operations.
    Default,
    /// An exact display name within its declaring module.
    Named { name: String, module_id: ModuleId },
}

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum ViewResolutionError {
    #[error("No module path is available for named-view module {module_id}")]
    MissingModulePath { module_id: ModuleId },
    #[error("No named view matches the requested selection")]
    NotFound,
    /// The supplied graph contains multiple matches for the complete target.
    #[error("The requested selection matches multiple named views")]
    Ambiguous { candidates: Vec<NamedViewInfo> },
}

/// The data a consumer of Named Views needs to apply a selected view.
#[derive(Debug, Clone, PartialEq)]
pub enum ResolvedView {
    /// Default is populated programmatically and for a valid execution.
    /// There is no explicit camera -- use what the camera settings are
    Default { visibility: IndexMap<Uuid, bool> },
    /// A declared view with its authored camera settings.
    Named {
        visibility: IndexMap<Uuid, bool>,
        camera_intent: Box<ArtifactCameraView>,
    },
}

impl ResolvedView {
    /// Complete decisions keyed by engine object UUID. A value of `true` hides the object.
    pub fn visibility(&self) -> &IndexMap<Uuid, bool> {
        match self {
            Self::Default { visibility } | Self::Named { visibility, .. } => visibility,
        }
    }
}

/// Resolves named views from explicit execution data without engine calls.
#[derive(Debug)]
pub struct NamedViewResolver<'a> {
    artifact_graph: &'a ArtifactGraph,
    operations: &'a IndexMap<ModuleId, Vec<Operation>>,
    named_views: Vec<(&'a NamedViewArtifact, NamedViewInfo)>,
}

impl<'a> NamedViewResolver<'a> {
    /// Validates module paths before constructing complete named-view metadata.
    pub fn new(
        artifact_graph: &'a ArtifactGraph,
        operations: &'a IndexMap<ModuleId, Vec<Operation>>,
        filenames: &IndexMap<ModuleId, ModulePath>,
    ) -> Result<Self, ViewResolutionError> {
        let mut named_views = Vec::new();
        for artifact in artifact_graph.values() {
            let Artifact::NamedView(view) = artifact else {
                continue;
            };
            let module_id = view.declaring_module_id;
            let module_path = filenames
                .get(&module_id)
                .ok_or(ViewResolutionError::MissingModulePath { module_id })?;
            named_views.push((
                view,
                NamedViewInfo {
                    artifact_id: view.id,
                    name: view.name.clone(),
                    module_id,
                    module_path: module_path.clone(),
                },
            ));
        }
        Ok(Self {
            artifact_graph,
            operations,
            named_views,
        })
    }

    /// Returns declared views in graph order.
    ///
    /// - Views from imported modules are included.
    /// - Repeated display names remain separate entries.
    /// - The computed default is excluded because it is not declared.
    pub fn list(&self) -> Vec<NamedViewInfo> {
        self.named_views.iter().map(|(_, info)| info.clone()).collect()
    }

    pub fn resolve(&self, target: &ViewTarget) -> Result<ResolvedView, ViewResolutionError> {
        match target {
            ViewTarget::Default => Ok(ResolvedView::Default {
                visibility: visibility::visibility_for_default(self.artifact_graph, self.operations),
            }),
            ViewTarget::Named { name, module_id } => {
                let candidates: Vec<_> = self
                    .named_views
                    .iter()
                    .filter(|(_, info)| info.name == *name && info.module_id == *module_id)
                    .collect();

                match candidates.as_slice() {
                    [] => Err(ViewResolutionError::NotFound),
                    [(view, _)] => Ok(ResolvedView::Named {
                        visibility: visibility::visibility_for_view(self.artifact_graph, view),
                        camera_intent: Box::new(view.camera.clone()),
                    }),
                    _ => Err(ViewResolutionError::Ambiguous {
                        candidates: candidates.iter().map(|(_, info)| info.clone()).collect(),
                    }),
                }
            }
        }
    }
}
