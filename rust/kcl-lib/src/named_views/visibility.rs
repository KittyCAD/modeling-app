use kcl_api::ArtifactId;
use kcl_api::artifact::Artifact;
use kcl_api::artifact::ArtifactGraph;
use kcl_api::artifact::Sweep;
use kcl_api::artifact::SweepSubType;
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
