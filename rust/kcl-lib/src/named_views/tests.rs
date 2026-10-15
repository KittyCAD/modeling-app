use kcl_api::artifact::ArtifactSweepMethod;
use kcl_api::artifact::CompositeSolid;
use kcl_api::artifact::CompositeSolidSubType;
use kcl_api::artifact::GdtAnnotationArtifact;
use kcl_api::artifact::Helix;
use kcl_api::artifact::ImportedGeometryArtifact;
use kcl_api::artifact::Path;
use kcl_api::artifact::PathSubType;
use kcl_api::artifact::Pattern;
use kcl_api::artifact::PatternSubType;
use kcl_api::artifact::Plane;
use kcl_api::artifact::PlaneOfFace;
use kcl_api::artifact::Solid2d;
use kcl_api::artifact::Sweep;
use kcl_api::artifact::SweepSubType;
use uuid::Uuid;

use super::Artifact;
use super::ArtifactGraph;
use super::ArtifactId;
use super::engine_id_for_artifact;

const LINKED_SWEEP_ENGINE_IDS: [(SweepSubType, u128); 7] = [
    (SweepSubType::Extrusion, 2),
    (SweepSubType::ExtrusionTwist, 2),
    (SweepSubType::Revolve, 2),
    (SweepSubType::RevolveAboutEdge, 2),
    (SweepSubType::Sweep, 2),
    (SweepSubType::Loft, 1),
    (SweepSubType::Blend, 1),
];

fn id(value: u128) -> ArtifactId {
    Uuid::from_u128(value).into()
}

fn graph(artifacts: Vec<Artifact>) -> ArtifactGraph {
    let item_count = artifacts.len();
    ArtifactGraph::from_parts(
        artifacts
            .into_iter()
            .map(|artifact| (artifact.id(), artifact))
            .collect(),
        item_count,
    )
}

fn sweep(sub_type: SweepSubType, artifact_id: ArtifactId, path_id: Option<ArtifactId>) -> Artifact {
    Artifact::Sweep(Sweep {
        id: artifact_id,
        sub_type,
        path_id,
        surface_ids: Vec::new(),
        code_ref: Default::default(),
        source_sweep_id: None,
        trajectory_id: None,
        method: ArtifactSweepMethod::New,
        consumed: false,
        pattern_ids: Vec::new(),
    })
}

fn path(artifact_id: ArtifactId, sweep_id: Option<ArtifactId>) -> Artifact {
    Artifact::Path(Path {
        id: artifact_id,
        sub_type: PathSubType::Region,
        plane_id: id(20),
        seg_ids: Vec::new(),
        consumed: true,
        sweep_id,
        trajectory_sweep_id: None,
        solid2d_id: None,
        code_ref: Default::default(),
        composite_solid_id: None,
        sketch_block_id: None,
        origin_path_id: None,
        inner_path_id: None,
        outer_path_id: None,
        pattern_ids: Vec::new(),
    })
}

#[test]
fn linked_sweeps_use_the_expected_engine_ids() {
    for (sub_type, expected) in LINKED_SWEEP_ENGINE_IDS {
        let body = sweep(sub_type, id(1), Some(id(2)));
        let graph = graph(vec![path(id(2), Some(id(1))), body.clone()]);

        assert_eq!(
            engine_id_for_artifact(id(1), &body, &graph),
            Some(Uuid::from_u128(expected)),
            "{sub_type:?}",
        );
    }
}

#[test]
fn mirrored_sweeps_use_their_own_ids() {
    for (sub_type, expected_source) in LINKED_SWEEP_ENGINE_IDS {
        let source = sweep(sub_type, id(1), Some(id(2)));
        let mirrored = sweep(sub_type, id(3), Some(id(2)));
        let graph = graph(vec![path(id(2), Some(id(1))), source.clone(), mirrored.clone()]);

        assert_eq!(
            engine_id_for_artifact(id(1), &source, &graph),
            Some(Uuid::from_u128(expected_source)),
            "{sub_type:?}",
        );
        assert_eq!(
            engine_id_for_artifact(id(3), &mirrored, &graph),
            Some(Uuid::from_u128(3)),
            "{sub_type:?}"
        );
    }
}

#[test]
fn sweeps_without_path_ids_use_their_own_ids() {
    for (sub_type, _) in LINKED_SWEEP_ENGINE_IDS {
        let body = sweep(sub_type, id(1), None);
        assert_eq!(
            engine_id_for_artifact(id(1), &body, &ArtifactGraph::default()),
            Some(Uuid::from_u128(1)),
            "{sub_type:?}"
        );
    }
}

#[test]
fn sweeps_with_missing_paths_use_their_own_ids() {
    for (sub_type, _) in LINKED_SWEEP_ENGINE_IDS {
        let body = sweep(sub_type, id(1), Some(id(2)));
        let graph = graph(vec![body.clone()]);
        assert_eq!(
            engine_id_for_artifact(id(1), &body, &graph),
            Some(Uuid::from_u128(1)),
            "{sub_type:?}"
        );
    }
}

#[test]
fn sweeps_with_unlinked_paths_use_their_own_ids() {
    for (sub_type, _) in LINKED_SWEEP_ENGINE_IDS {
        let body = sweep(sub_type, id(1), Some(id(2)));
        let graph = graph(vec![path(id(2), None)]);
        assert_eq!(
            engine_id_for_artifact(id(1), &body, &graph),
            Some(Uuid::from_u128(1)),
            "{sub_type:?}"
        );
    }
}

#[test]
fn sweeps_with_non_path_artifacts_use_their_own_ids() {
    let graph = graph(vec![Artifact::Plane(Plane {
        id: id(2),
        path_ids: Vec::new(),
        code_ref: Default::default(),
    })]);
    for (sub_type, _) in LINKED_SWEEP_ENGINE_IDS {
        let body = sweep(sub_type, id(1), Some(id(2)));
        assert_eq!(
            engine_id_for_artifact(id(1), &body, &graph),
            Some(Uuid::from_u128(1)),
            "{sub_type:?}"
        );
    }
}

#[test]
fn identity_kinds_use_their_artifact_ids_without_universe_filtering() {
    let artifacts = [
        Artifact::CompositeSolid(CompositeSolid {
            id: id(4),
            consumed: true,
            sub_type: CompositeSolidSubType::Union,
            output_index: None,
            solid_ids: Vec::new(),
            tool_ids: Vec::new(),
            code_ref: Default::default(),
            composite_solid_id: None,
            pattern_ids: Vec::new(),
        }),
        path(id(5), None),
        Artifact::GdtAnnotation(GdtAnnotationArtifact {
            id: id(6),
            code_ref: Default::default(),
            consumed: true,
        }),
        Artifact::Helix(Helix {
            id: id(7),
            axis_id: None,
            code_ref: Default::default(),
            trajectory_sweep_id: None,
            consumed: true,
        }),
        Artifact::Plane(Plane {
            id: id(8),
            path_ids: vec![id(5)],
            code_ref: Default::default(),
        }),
        Artifact::ImportedGeometry(ImportedGeometryArtifact {
            id: id(9),
            code_ref: Default::default(),
            consumed: true,
        }),
    ];

    for (artifact, expected) in artifacts.iter().zip(4..=9) {
        assert_eq!(
            engine_id_for_artifact(id(100), artifact, &ArtifactGraph::default()),
            Some(Uuid::from_u128(expected))
        );
    }
}

#[test]
fn pattern_copies_use_the_supplied_copy_ids() {
    let pattern = Artifact::Pattern(Pattern {
        id: id(4),
        sub_type: PatternSubType::Linear,
        source_id: id(1),
        copy_ids: vec![id(5), id(6)],
        copy_face_ids: Vec::new(),
        copy_edge_ids: Vec::new(),
        code_ref: Default::default(),
    });

    for copy in [5, 6] {
        assert_eq!(
            engine_id_for_artifact(id(copy), &pattern, &ArtifactGraph::default()),
            Some(Uuid::from_u128(copy))
        );
    }
}

#[test]
fn unsupported_artifact_kinds_return_none() {
    let artifacts = [
        Artifact::PlaneOfFace(PlaneOfFace {
            id: id(1),
            face_id: id(2),
            code_ref: Default::default(),
        }),
        Artifact::Solid2d(Solid2d {
            id: id(3),
            path_id: id(4),
        }),
    ];
    for artifact in artifacts {
        assert_eq!(
            engine_id_for_artifact(artifact.id(), &artifact, &ArtifactGraph::default()),
            None
        );
    }
}
