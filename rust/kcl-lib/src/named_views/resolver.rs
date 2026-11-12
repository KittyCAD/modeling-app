use std::collections::HashMap;

use indexmap::IndexMap;
use itertools::Itertools;
use kcl_api::artifact::NamedViewArtifact;
use kcl_error::SourceRange;
use serde::Serialize;
use uuid::Uuid;

use super::Artifact;
use super::ArtifactCameraView;
use super::ArtifactGraph;
use super::ArtifactId;
use super::ModuleId;
use super::ModulePath;
use super::Operation;
use super::visibility::VisibilityTargets;

/// A declared view's identity and source-file metadata.
#[derive(Debug, Clone, Serialize, ts_rs::TS, PartialEq, Eq)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
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

#[derive(Debug, Clone, Serialize, ts_rs::TS, PartialEq, Eq, thiserror::Error)]
#[ts(export)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum ViewResolutionError {
    #[error("No module path is available for named-view module {module_id}")]
    MissingModulePath {
        #[serde(rename = "moduleId")]
        module_id: ModuleId,
    },
    #[error("No named view matches the requested selection")]
    NotFound,
    /// The supplied graph contains multiple matches for the complete target.
    #[error("The requested selection matches multiple named views")]
    Ambiguous { candidates: Vec<NamedViewInfo> },
}

/// A resolved named view contains its identity and the data required for activation.
#[derive(Debug, Clone, Serialize, ts_rs::TS, PartialEq)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedNamedView {
    pub info: NamedViewInfo,
    pub visibility: IndexMap<Uuid, bool>,
    pub camera_intent: Box<ArtifactCameraView>,
}

/// A borrowed resolved view from execution output.
#[derive(Debug, Clone, PartialEq)]
pub enum ResolvedView<'a> {
    /// The program's Default visibility, with no authored camera settings.
    Default { visibility: &'a IndexMap<Uuid, bool> },
    /// A declared view with its authored camera settings.
    Named(&'a ResolvedNamedView),
}

impl ResolvedView<'_> {
    /// Returns object visibility by engine UUID after applying the view's baseline and exceptions.
    ///
    /// - `true`: hide the object.
    /// - `false`: show the object.
    pub fn visibility(&self) -> &IndexMap<Uuid, bool> {
        match self {
            Self::Default { visibility } => visibility,
            Self::Named(view) => &view.visibility,
        }
    }
}

/// Resolved views and individual failures from an execution.
///
/// Collection order is unspecified.
#[derive(Debug, Clone, Serialize, ts_rs::TS, PartialEq)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedViewBatch {
    default_view: IndexMap<Uuid, bool>,
    named_views: Vec<ResolvedNamedView>,
    failures: Vec<NamedViewResolutionFailure>,
}

impl ResolvedViewBatch {
    /// Returns the program's calculated Default visibility.
    pub fn default_view(&self) -> &IndexMap<Uuid, bool> {
        &self.default_view
    }

    /// Returns successfully resolved named views.
    pub fn named_views(&self) -> &[ResolvedNamedView] {
        &self.named_views
    }

    /// Returns failures from resolving declared named views.
    pub fn failures(&self) -> &[NamedViewResolutionFailure] {
        &self.failures
    }

    /// Returns metadata for successfully resolved named views.
    ///
    /// - Views from imported modules are included.
    /// - The computed Default view is excluded.
    /// - Failed views are available through [`Self::failures`].
    pub fn list_named_views(&self) -> Vec<NamedViewInfo> {
        self.named_views.iter().map(|view| view.info.clone()).collect()
    }

    /// Returns a stored result or the recorded failure for the requested view.
    pub fn get(&self, target: &ViewTarget) -> Result<ResolvedView<'_>, ViewResolutionError> {
        match target {
            ViewTarget::Default => Ok(ResolvedView::Default {
                visibility: &self.default_view,
            }),
            ViewTarget::Named { name, module_id } => {
                if let Some(failure) = self
                    .failures
                    .iter()
                    .find(|failure| failure.name == *name && failure.module_id == *module_id)
                {
                    return Err(failure.error.clone());
                }
                self.named_views
                    .iter()
                    .find(|view| view.info.name == *name && view.info.module_id == *module_id)
                    .map(ResolvedView::Named)
                    .ok_or(ViewResolutionError::NotFound)
            }
        }
    }
}

#[derive(Debug, Clone, Serialize, ts_rs::TS, PartialEq, Eq)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct NamedViewResolutionFailure {
    pub artifact_id: ArtifactId,
    pub name: String,
    pub module_id: ModuleId,
    pub source_range: SourceRange,
    pub error: ViewResolutionError,
}

impl NamedViewResolutionFailure {
    fn new(view: &NamedViewArtifact, error: ViewResolutionError) -> Self {
        Self {
            artifact_id: view.id,
            name: view.name.clone(),
            module_id: view.declaring_module_id,
            source_range: view.code_ref.range,
            error,
        }
    }
}

fn declared_views(artifact_graph: &ArtifactGraph) -> impl Iterator<Item = &NamedViewArtifact> {
    artifact_graph.values().filter_map(|artifact| match artifact {
        Artifact::NamedView(view) => Some(view),
        _ => None,
    })
}

fn named_view_info(
    view: &NamedViewArtifact,
    filenames: &IndexMap<ModuleId, ModulePath>,
) -> Result<NamedViewInfo, ViewResolutionError> {
    let module_id = view.declaring_module_id;
    let module_path = filenames
        .get(&module_id)
        .ok_or(ViewResolutionError::MissingModulePath { module_id })?;
    Ok(NamedViewInfo {
        artifact_id: view.id,
        name: view.name.clone(),
        module_id,
        module_path: module_path.clone(),
    })
}

/// Resolves every view using the same visibility targets from completed execution data.
pub(crate) fn resolve_all(
    artifact_graph: &ArtifactGraph,
    operations: &IndexMap<ModuleId, Vec<Operation>>,
    filenames: &IndexMap<ModuleId, ModulePath>,
) -> ResolvedViewBatch {
    let targets = VisibilityTargets::new(artifact_graph);
    let named_views: Vec<_> = declared_views(artifact_graph).collect();
    let views_by_identity = named_views
        .iter()
        .map(|view| ((view.declaring_module_id, view.name.as_str()), *view))
        .into_group_map();
    let (resolved_named_views, failures) = named_views
        .into_iter()
        .map(|view| {
            resolve_named_view(view, &views_by_identity, filenames, &targets)
                .map_err(|error| NamedViewResolutionFailure::new(view, error))
        })
        .partition_result();

    ResolvedViewBatch {
        default_view: targets.for_default_view(&super::visibility::hidden_ids_from_operations(operations)),
        named_views: resolved_named_views,
        failures,
    }
}

fn resolve_named_view(
    view: &NamedViewArtifact,
    views_by_identity: &HashMap<(ModuleId, &str), Vec<&NamedViewArtifact>>,
    filenames: &IndexMap<ModuleId, ModulePath>,
    targets: &VisibilityTargets,
) -> Result<ResolvedNamedView, ViewResolutionError> {
    let info = named_view_info(view, filenames)?;
    let candidates = views_by_identity
        .get(&(view.declaring_module_id, view.name.as_str()))
        .ok_or(ViewResolutionError::NotFound)?;
    if candidates.len() > 1 {
        return Err(ViewResolutionError::Ambiguous {
            candidates: candidates
                .iter()
                .map(|view| named_view_info(view, filenames))
                .collect::<Result<_, _>>()?,
        });
    }

    Ok(ResolvedNamedView {
        info,
        visibility: targets.for_named_view(view),
        camera_intent: Box::new(view.camera.clone()),
    })
}
