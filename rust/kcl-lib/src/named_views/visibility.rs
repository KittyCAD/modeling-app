use std::collections::HashSet;

use indexmap::IndexMap;
use kcl_api::ArtifactId;
use kcl_api::OpKclValue;
use kcl_api::Operation;
use kcl_api::artifact::Artifact;
use kcl_api::artifact::ArtifactGraph;
use kcl_api::artifact::ArtifactVisibility;
use kcl_api::artifact::NamedViewArtifact;
use kcl_api::artifact::Pattern;
use kcl_api::artifact::Sweep;
use kcl_api::artifact::SweepSubType;
use kcl_error::ModuleId;
use uuid::Uuid;

/// Returns the engine object UUID for an artifact kind supported by named views.
///
/// - `id` identifies the copy when `artifact` is a pattern.
/// - The supplied artifact does not need to be stored in `artifact_graph`.
/// - Unsupported artifact kinds return `None`.
pub fn engine_id_for_artifact(id: ArtifactId, artifact: &Artifact, artifact_graph: &ArtifactGraph) -> Option<Uuid> {
    match artifact {
        Artifact::Sweep(sweep) => Some(engine_id_for_sweep(sweep, artifact_graph).into()),
        Artifact::CompositeSolid(_)
        | Artifact::Path(_)
        | Artifact::GdtAnnotation(_)
        | Artifact::Helix(_)
        | Artifact::Plane(_)
        | Artifact::ImportedGeometry(_) => Some(artifact.id().into()),
        Artifact::Pattern(_) => Some(id.into()),
        Artifact::Segment(_)
        | Artifact::Solid2d(_)
        | Artifact::PrimitiveFace(_)
        | Artifact::PrimitiveEdge(_)
        | Artifact::PlaneOfFace(_)
        | Artifact::StartSketchOnFace(_)
        | Artifact::StartSketchOnPlane(_)
        | Artifact::SketchBlock(_)
        | Artifact::SketchBlockConstraint(_)
        | Artifact::Wall(_)
        | Artifact::Cap(_)
        | Artifact::SweepEdge(_)
        | Artifact::EdgeCut(_)
        | Artifact::EdgeCutEdge(_)
        | Artifact::NamedView(_) => None,
    }
}

fn engine_id_for_sweep(sweep: &Sweep, artifact_graph: &ArtifactGraph) -> ArtifactId {
    match sweep.sub_type {
        SweepSubType::Loft | SweepSubType::Blend | SweepSubType::PlanarSurface => sweep.id,
        SweepSubType::Extrusion
        | SweepSubType::ExtrusionTwist
        | SweepSubType::Revolve
        | SweepSubType::RevolveAboutEdge
        | SweepSubType::Sweep => {
            let Some(path_id) = sweep.path_id else {
                return sweep.id;
            };

            // A mirrored sweep can retain its source's path ID. Use that path
            // only when it refers to this sweep.
            match artifact_graph.get(&path_id) {
                Some(Artifact::Path(path)) if path.sweep_id == Some(sweep.id) => path_id,
                _ => sweep.id,
            }
        }
    }
}

pub(super) fn visibility_for_view(artifact_graph: &ArtifactGraph, view: &NamedViewArtifact) -> IndexMap<Uuid, bool> {
    let exceptions = match view.baseline {
        ArtifactVisibility::Show => &view.hide_ids,
        ArtifactVisibility::Hide => &view.show_ids,
    };
    visibility_for_baseline(artifact_graph, view.baseline, &exceptions.iter().copied().collect())
}

pub(super) fn visibility_for_default(
    artifact_graph: &ArtifactGraph,
    operations: &IndexMap<ModuleId, Vec<Operation>>,
) -> IndexMap<Uuid, bool> {
    let mut hidden_ids = HashSet::new();
    for operation in operations.values().flatten() {
        // Include `hide` calls even when `is_error` is true,
        // matching `getHideOperationArtifactIds` in TypeScript.
        if let Operation::StdLibCall {
            name,
            unlabeled_arg: Some(arg),
            ..
        } = operation
            && name == "hide"
        {
            collect_artifact_ids(arg.value(), &mut hidden_ids);
        }
    }

    visibility_for_baseline(artifact_graph, ArtifactVisibility::Show, &hidden_ids)
}

fn visibility_for_baseline(
    artifact_graph: &ArtifactGraph,
    baseline: ArtifactVisibility,
    exceptions: &HashSet<ArtifactId>,
) -> IndexMap<Uuid, bool> {
    view_universe(artifact_graph)
        .into_iter()
        .filter_map(|(id, artifact)| {
            let object_id = engine_id_for_artifact(id, artifact, artifact_graph)?;
            let hidden = match baseline {
                ArtifactVisibility::Show => exceptions.contains(&id),
                ArtifactVisibility::Hide => !exceptions.contains(&id),
            };
            Some((object_id, hidden))
        })
        .fold(IndexMap::new(), |mut visibility, (object_id, hidden)| {
            *visibility.entry(object_id).or_insert(false) |= hidden;
            visibility
        })
}

fn view_universe(artifact_graph: &ArtifactGraph) -> IndexMap<ArtifactId, &Artifact> {
    // only consider elements of artifact_graph what we can independenty hide
    let mut universe: IndexMap<_, _> = artifact_graph
        .iter()
        .filter_map(|(id, artifact)| is_independently_hideable(artifact).then_some((*id, artifact)))
        .collect();

    // get patterns--they are special. We need to add the results of the pattern (the clones)
    let patterns = artifact_graph.values().filter_map(|artifact| match artifact {
        Artifact::Pattern(pattern) => Some((artifact, pattern)),
        _ => None,
    });
    for (artifact, pattern) in patterns {
        if source_body_for_pattern(pattern, artifact_graph).is_some_and(|source| universe.contains_key(&source.id())) {
            universe.extend(pattern.copy_ids.iter().map(|id| (*id, artifact)));
        }
    }
    universe
}

fn is_independently_hideable(artifact: &Artifact) -> bool {
    match artifact {
        Artifact::Sweep(value) => !value.consumed,
        Artifact::CompositeSolid(value) => !value.consumed,
        Artifact::Path(value) => !value.consumed,
        Artifact::GdtAnnotation(value) => !value.consumed,
        Artifact::Helix(value) => !value.consumed,
        Artifact::ImportedGeometry(value) => !value.consumed,
        Artifact::Plane(value) => value.path_ids.is_empty(),
        Artifact::Segment(_)
        | Artifact::Solid2d(_)
        | Artifact::PrimitiveFace(_)
        | Artifact::PrimitiveEdge(_)
        | Artifact::PlaneOfFace(_)
        | Artifact::StartSketchOnFace(_)
        | Artifact::StartSketchOnPlane(_)
        | Artifact::SketchBlock(_)
        | Artifact::SketchBlockConstraint(_)
        | Artifact::Wall(_)
        | Artifact::Cap(_)
        | Artifact::SweepEdge(_)
        | Artifact::EdgeCut(_)
        | Artifact::EdgeCutEdge(_)
        | Artifact::NamedView(_)
        | Artifact::Pattern(_) => false,
    }
}

fn source_body_for_pattern<'a>(pattern: &Pattern, artifact_graph: &'a ArtifactGraph) -> Option<&'a Artifact> {
    match artifact_graph.get(&pattern.source_id) {
        Some(source @ (Artifact::Sweep(_) | Artifact::CompositeSolid(_))) => Some(source),
        _ => artifact_graph.values().find(|artifact| match artifact {
            Artifact::Sweep(value) => value.pattern_ids.contains(&pattern.id),
            Artifact::CompositeSolid(value) => value.pattern_ids.contains(&pattern.id),
            _ => false,
        }),
    }
}

fn collect_artifact_ids(value: &OpKclValue, ids: &mut HashSet<ArtifactId>) {
    match value {
        OpKclValue::Plane { artifact_id }
        | OpKclValue::Face { artifact_id }
        | OpKclValue::Segment { artifact_id }
        | OpKclValue::GdtAnnotation { artifact_id }
        | OpKclValue::ImportedGeometry { artifact_id } => {
            ids.insert(*artifact_id);
        }
        OpKclValue::Sketch { value } => {
            ids.insert(value.artifact_id());
        }
        OpKclValue::Solid { value } => {
            ids.insert(value.artifact_id());
        }
        OpKclValue::Helix { value } => {
            ids.insert(value.artifact_id());
        }
        OpKclValue::Array { value } => {
            for value in value {
                collect_artifact_ids(value, ids);
            }
        }
        OpKclValue::TagIdentifier { .. }
        | OpKclValue::TagDeclarator { .. }
        | OpKclValue::Object { .. }
        | OpKclValue::Uuid { .. }
        | OpKclValue::Bool { .. }
        | OpKclValue::Number { .. }
        | OpKclValue::String { .. }
        | OpKclValue::Enum { .. }
        | OpKclValue::SketchVar { .. }
        | OpKclValue::CameraView { .. }
        | OpKclValue::Function { .. }
        | OpKclValue::Module { .. }
        | OpKclValue::Type { .. }
        | OpKclValue::KclNone { .. }
        | OpKclValue::BoundedEdge { .. } => {}
    }
}
