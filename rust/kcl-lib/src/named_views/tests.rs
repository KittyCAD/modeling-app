use std::collections::BTreeSet;
use std::collections::HashMap;
use std::collections::HashSet;

use indexmap::IndexMap;
use kcl_api::OpArg;
use kcl_api::OpHelix;
use kcl_api::OpKclValue;
use kcl_api::OpSketch;
use kcl_api::OpSolid;
use kcl_api::artifact::ArtifactSweepMethod;
use kcl_api::artifact::ArtifactVisibility;
use kcl_api::artifact::CompositeSolid;
use kcl_api::artifact::CompositeSolidSubType;
use kcl_api::artifact::GdtAnnotationArtifact;
use kcl_api::artifact::Helix;
use kcl_api::artifact::ImportedGeometryArtifact;
use kcl_api::artifact::NamedViewArtifact;
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
use super::ArtifactCameraLook;
use super::ArtifactCameraView;
use super::ArtifactGraph;
use super::ArtifactId;
use super::ArtifactOrientation;
use super::ArtifactProjection;
use super::ModuleId;
use super::ModulePath;
use super::NamedViewInfo;
use super::NamedViewResolutionFailure;
use super::Operation;
use super::ResolvedNamedView;
use super::ResolvedView;
use super::ResolvedViewBatch;
use super::ViewResolutionError;
use super::ViewTarget;
use super::engine_id_for_artifact;
use super::resolver::resolve_all;
use crate::docs::kcl_doc::DocData;
use crate::docs::kcl_doc::walk_prelude;

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
        edge_ids: Vec::new(),
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
        plane_info: None,
        size: None,
        hidden: false,
        color: None,
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
fn identity_kinds_use_their_artifact_ids_without_visibility_filtering() {
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
            plane_info: None,
            size: None,
            hidden: false,
            color: None,
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

fn plane(artifact_id: ArtifactId) -> Artifact {
    Artifact::Plane(Plane {
        id: artifact_id,
        path_ids: Vec::new(),
        code_ref: Default::default(),
        plane_info: None,
        size: None,
        hidden: false,
        color: None,
    })
}

fn composite(artifact_id: ArtifactId) -> Artifact {
    Artifact::CompositeSolid(CompositeSolid {
        id: artifact_id,
        consumed: false,
        sub_type: CompositeSolidSubType::Union,
        output_index: None,
        solid_ids: Vec::new(),
        tool_ids: Vec::new(),
        code_ref: Default::default(),
        composite_solid_id: None,
        pattern_ids: Vec::new(),
    })
}

fn named_view(
    artifact_id: ArtifactId,
    name: &str,
    module: usize,
    baseline: ArtifactVisibility,
    exceptions: &[ArtifactId],
) -> Artifact {
    Artifact::NamedView(NamedViewArtifact {
        id: artifact_id,
        name: name.to_owned(),
        declaring_module_id: ModuleId::from_usize(module),
        camera: ArtifactCameraView {
            look: ArtifactCameraLook::Oriented {
                orientation: ArtifactOrientation::Front,
            },
            target: None,
            distance: None,
            projection: ArtifactProjection::Orthographic,
        },
        baseline,
        show_ids: if baseline == ArtifactVisibility::Hide {
            exceptions.to_vec()
        } else {
            Vec::new()
        },
        hide_ids: if baseline == ArtifactVisibility::Show {
            exceptions.to_vec()
        } else {
            Vec::new()
        },
        code_ref: kcl_api::artifact::CodeRef {
            range: [0, 0, module].into(),
            ..Default::default()
        },
    })
}

fn pattern(artifact_id: ArtifactId, source_id: ArtifactId, copy_ids: Vec<ArtifactId>) -> Artifact {
    Artifact::Pattern(Pattern {
        id: artifact_id,
        sub_type: PatternSubType::Linear,
        source_id,
        copy_ids,
        copy_face_ids: Vec::new(),
        copy_edge_ids: Vec::new(),
        code_ref: Default::default(),
    })
}

fn hide(value: OpKclValue) -> Operation {
    Operation::StdLibCall {
        name: "hide".to_owned(),
        unlabeled_arg: Some(OpArg::new(value, Default::default())),
        labeled_args: IndexMap::new(),
        node_path: Default::default(),
        source_range: Default::default(),
        stdlib_entry_source_range: None,
        is_error: false,
    }
}

fn target(name: &str, module_id: ModuleId) -> ViewTarget {
    ViewTarget::Named {
        name: name.to_owned(),
        module_id,
    }
}

fn assert_same_named_views(actual: &[NamedViewInfo], expected: &[NamedViewInfo]) {
    assert_eq!(actual.len(), expected.len());
    assert_eq!(
        actual
            .iter()
            .map(|info| (info.artifact_id, info))
            .collect::<HashMap<_, _>>(),
        expected
            .iter()
            .map(|info| (info.artifact_id, info))
            .collect::<HashMap<_, _>>()
    );
}

fn assert_ambiguous_candidates(error: &ViewResolutionError, expected: &[NamedViewInfo]) {
    let ViewResolutionError::Ambiguous { candidates } = error else {
        panic!("expected an ambiguous selection, received {error:?}");
    };
    assert_same_named_views(candidates, expected);
}

fn resolve_named(
    mut artifacts: Vec<Artifact>,
    baseline: ArtifactVisibility,
    exceptions: &[ArtifactId],
) -> ResolvedNamedView {
    artifacts.push(named_view(id(900), "Front", 0, baseline, exceptions));
    let graph = graph(artifacts);
    let filenames = [(ModuleId::default(), ModulePath::Main)].into_iter().collect();
    resolve_all(&graph, &IndexMap::new(), &filenames)
        .named_views()
        .first()
        .expect("the fixture must calculate its named view")
        .clone()
}

fn eligible_artifacts() -> Vec<Artifact> {
    let mut sketch = path(id(3), None);
    if let Artifact::Path(value) = &mut sketch {
        value.consumed = false;
    }
    vec![
        sweep(SweepSubType::Loft, id(1), None),
        composite(id(2)),
        sketch,
        Artifact::GdtAnnotation(GdtAnnotationArtifact {
            id: id(4),
            code_ref: Default::default(),
            consumed: false,
        }),
        Artifact::Helix(Helix {
            id: id(5),
            axis_id: None,
            code_ref: Default::default(),
            trajectory_sweep_id: None,
            consumed: false,
        }),
        plane(id(6)),
        Artifact::ImportedGeometry(ImportedGeometryArtifact {
            id: id(7),
            code_ref: Default::default(),
            consumed: false,
        }),
    ]
}

#[test]
fn discovery_preserves_module_identity_and_module_paths() {
    let graph = graph(vec![
        named_view(id(1), "Front", 1, ArtifactVisibility::Show, &[]),
        plane(id(2)),
        named_view(id(3), "Front", 0, ArtifactVisibility::Show, &[]),
        named_view(id(4), "Detail", 7, ArtifactVisibility::Hide, &[]),
    ]);
    let operations = IndexMap::new();
    let imported_path = ModulePath::Local {
        value: "part.kcl".into(),
        original_import_path: None,
    };
    let detail_path = ModulePath::Local {
        value: "detail.kcl".into(),
        original_import_path: None,
    };
    let filenames = [
        (ModuleId::default(), ModulePath::Main),
        (ModuleId::from_usize(1), imported_path.clone()),
        (ModuleId::from_usize(7), detail_path.clone()),
    ]
    .into_iter()
    .collect();
    let batch = resolve_all(&graph, &operations, &filenames);
    assert_same_named_views(
        &batch.list_named_views(),
        &[
            NamedViewInfo {
                artifact_id: id(1),
                name: "Front".to_owned(),
                module_id: ModuleId::from_usize(1),
                module_path: imported_path,
            },
            NamedViewInfo {
                artifact_id: id(3),
                name: "Front".to_owned(),
                module_id: ModuleId::default(),
                module_path: ModulePath::Main,
            },
            NamedViewInfo {
                artifact_id: id(4),
                name: "Detail".to_owned(),
                module_id: ModuleId::from_usize(7),
                module_path: detail_path,
            },
        ],
    );
}

#[test]
fn construction_retains_incomplete_module_paths_for_resolution() {
    let graph = graph(vec![
        plane(id(100)),
        named_view(id(1), "Front", 0, ArtifactVisibility::Show, &[]),
        named_view(id(2), "Detail", 7, ArtifactVisibility::Hide, &[]),
    ]);
    let operations = IndexMap::new();
    let root_only = [(ModuleId::default(), ModulePath::Main)].into_iter().collect();
    for (filenames, module_id) in [
        (IndexMap::new(), ModuleId::default()),
        (root_only, ModuleId::from_usize(7)),
    ] {
        let batch = resolve_all(&graph, &operations, &filenames);
        let name = if module_id == ModuleId::default() {
            "Front"
        } else {
            "Detail"
        };
        assert_eq!(
            batch.get(&target(name, module_id)),
            Err(ViewResolutionError::MissingModulePath { module_id })
        );
        assert_eq!(
            batch.get(&ViewTarget::Default).unwrap().visibility(),
            &[(Uuid::from_u128(100), false)].into_iter().collect::<IndexMap<_, _>>()
        );
    }
}

#[test]
fn ambiguous_selection_returns_candidate_metadata() {
    let graph = graph(vec![
        named_view(id(1), "Front", 0, ArtifactVisibility::Hide, &[]),
        plane(id(2)),
        named_view(id(3), "Front", 1, ArtifactVisibility::Show, &[]),
        named_view(id(4), "Front", 0, ArtifactVisibility::Show, &[]),
        named_view(id(5), "Other", 0, ArtifactVisibility::Show, &[]),
    ]);
    let operations = IndexMap::new();
    let filenames = [
        (ModuleId::default(), ModulePath::Main),
        (
            ModuleId::from_usize(1),
            ModulePath::Local {
                value: "part.kcl".into(),
                original_import_path: None,
            },
        ),
    ]
    .into_iter()
    .collect();
    let batch = resolve_all(&graph, &operations, &filenames);
    assert_ambiguous_candidates(
        &batch.get(&target("Front", ModuleId::default())).unwrap_err(),
        &[
            NamedViewInfo {
                artifact_id: id(1),
                name: "Front".to_owned(),
                module_id: ModuleId::default(),
                module_path: ModulePath::Main,
            },
            NamedViewInfo {
                artifact_id: id(4),
                name: "Front".to_owned(),
                module_id: ModuleId::default(),
                module_path: ModulePath::Main,
            },
        ],
    );
    assert_eq!(
        batch
            .list_named_views()
            .iter()
            .map(|view| view.artifact_id)
            .collect::<HashSet<_>>(),
        HashSet::from([id(3), id(5)])
    );
}

#[test]
fn qualified_selection_distinguishes_same_names_across_modules() {
    let graph = graph(vec![
        named_view(id(1), "Front", 1, ArtifactVisibility::Hide, &[]),
        plane(id(2)),
        named_view(id(3), "Front", 0, ArtifactVisibility::Show, &[]),
    ]);
    let operations = IndexMap::new();
    let filenames = [
        (ModuleId::default(), ModulePath::Main),
        (
            ModuleId::from_usize(1),
            ModulePath::Local {
                value: "part.kcl".into(),
                original_import_path: None,
            },
        ),
    ]
    .into_iter()
    .collect();
    let batch = resolve_all(&graph, &operations, &filenames);
    assert_eq!(
        batch
            .get(&target("Front", ModuleId::from_usize(1)))
            .unwrap()
            .visibility(),
        &[(Uuid::from_u128(2), true)].into_iter().collect::<IndexMap<_, _>>()
    );
    assert_eq!(
        batch.get(&target("Front", ModuleId::default())).unwrap().visibility(),
        &[(Uuid::from_u128(2), false)].into_iter().collect::<IndexMap<_, _>>()
    );
}

#[test]
fn selection_requires_an_exact_name_and_matching_module() {
    let graph = graph(vec![named_view(id(1), "Front", 1, ArtifactVisibility::Show, &[])]);
    let operations = IndexMap::new();
    let filenames = [(
        ModuleId::from_usize(1),
        ModulePath::Local {
            value: "part.kcl".into(),
            original_import_path: None,
        },
    )]
    .into_iter()
    .collect();
    let batch = resolve_all(&graph, &operations, &filenames);
    for name in ["missing", "front", " Front", "Front ", ""] {
        assert_eq!(
            batch.get(&target(name, ModuleId::from_usize(1))),
            Err(ViewResolutionError::NotFound),
            "{name:?}"
        );
    }
    assert_eq!(
        batch.get(&target("Front", ModuleId::default())),
        Err(ViewResolutionError::NotFound)
    );
    batch.get(&target("Front", ModuleId::from_usize(1))).unwrap();
}

#[test]
fn an_empty_execution_has_only_the_computed_default() {
    let graph = ArtifactGraph::default();
    let operations = IndexMap::new();
    let filenames = IndexMap::new();
    let batch = resolve_all(&graph, &operations, &filenames);
    assert!(batch.list_named_views().is_empty());
    let resolved = batch.get(&ViewTarget::Default).unwrap();
    assert!(resolved.visibility().is_empty());
    assert!(matches!(resolved, ResolvedView::Default { .. }));
}

#[test]
fn batch_preserves_metadata_camera_and_visibility() {
    let graph = graph(vec![
        path(id(2), Some(id(1))),
        sweep(SweepSubType::Extrusion, id(1), Some(id(2))),
        pattern(id(3), id(1), vec![id(4)]),
        named_view(id(10), "Front", 1, ArtifactVisibility::Hide, &[id(4)]),
        named_view(id(11), "Front", 0, ArtifactVisibility::Show, &[id(1)]),
    ]);
    let operations = [(
        ModuleId::default(),
        vec![hide(OpKclValue::Solid {
            value: Box::new(OpSolid::new(id(1))),
        })],
    )]
    .into_iter()
    .collect();
    let filenames = [
        (ModuleId::default(), ModulePath::Main),
        (
            ModuleId::from_usize(1),
            ModulePath::Local {
                value: "part.kcl".into(),
                original_import_path: None,
            },
        ),
    ]
    .into_iter()
    .collect();
    let batch = resolve_all(&graph, &operations, &filenames);

    assert!(batch.failures().is_empty());
    assert_eq!(
        batch.default_view(),
        batch.get(&ViewTarget::Default).unwrap().visibility()
    );
    assert_eq!(
        batch.default_view(),
        &[(Uuid::from_u128(2), true), (Uuid::from_u128(4), false)]
            .into_iter()
            .collect::<IndexMap<_, _>>()
    );
    assert_eq!(
        batch
            .list_named_views()
            .into_iter()
            .map(|view| (view.artifact_id, view.module_id))
            .collect::<HashMap<_, _>>(),
        HashMap::from([(id(10), ModuleId::from_usize(1)), (id(11), ModuleId::default())])
    );
    for resolved in batch.named_views() {
        assert_eq!(
            ResolvedView::Named(resolved),
            batch
                .get(&target(&resolved.info.name, resolved.info.module_id))
                .unwrap()
        );
    }
    for view in batch.named_views() {
        assert_eq!(
            &view.visibility,
            &[(Uuid::from_u128(2), true), (Uuid::from_u128(4), false)]
                .into_iter()
                .collect::<IndexMap<_, _>>()
        );
    }
}

#[test]
fn batch_preserves_other_views_when_the_second_module_path_is_missing() {
    let mut second = named_view(id(2), "Second", 7, ArtifactVisibility::Hide, &[]);
    let source_range = [10, 20, 3].into();
    if let Artifact::NamedView(view) = &mut second {
        view.code_ref.range = source_range;
    }
    let artifacts = vec![
        plane(id(100)),
        named_view(id(1), "First", 0, ArtifactVisibility::Show, &[]),
        second,
        named_view(id(3), "Third", 0, ArtifactVisibility::Hide, &[]),
        named_view(id(4), "Fourth", 0, ArtifactVisibility::Show, &[]),
    ];
    let operations = IndexMap::new();
    let filenames = [(ModuleId::default(), ModulePath::Main)].into_iter().collect();
    for artifacts in [artifacts.clone(), artifacts.into_iter().rev().collect()] {
        let graph = graph(artifacts);
        let batch = resolve_all(&graph, &operations, &filenames);

        assert_eq!(
            batch
                .named_views()
                .iter()
                .map(|view| view.info.name.as_str())
                .collect::<HashSet<_>>(),
            HashSet::from(["First", "Third", "Fourth"])
        );
        assert_eq!(
            batch.default_view(),
            &[(Uuid::from_u128(100), false)].into_iter().collect::<IndexMap<_, _>>()
        );
        assert_eq!(
            batch.failures(),
            vec![NamedViewResolutionFailure {
                artifact_id: id(2),
                name: "Second".to_owned(),
                module_id: ModuleId::from_usize(7),
                source_range,
                error: ViewResolutionError::MissingModulePath {
                    module_id: ModuleId::from_usize(7)
                },
            }]
        );
        assert_eq!(
            batch.get(&target("Second", ModuleId::from_usize(7))),
            Err(ViewResolutionError::MissingModulePath {
                module_id: ModuleId::from_usize(7)
            })
        );
        for name in ["First", "Third", "Fourth"] {
            batch
                .get(&target(name, ModuleId::default()))
                .expect("another view's missing metadata must not prevent resolution");
        }
        assert_eq!(batch.list_named_views().len(), 3);
    }
}

#[test]
fn batch_rejects_ambiguous_selections_without_discarding_other_views() {
    let graph = graph(vec![
        plane(id(100)),
        named_view(id(1), "Front", 0, ArtifactVisibility::Show, &[]),
        named_view(id(2), "Front", 1, ArtifactVisibility::Hide, &[]),
        named_view(id(3), "Front", 0, ArtifactVisibility::Hide, &[]),
        named_view(id(4), "Other", 0, ArtifactVisibility::Show, &[]),
    ]);
    let operations = IndexMap::new();
    let filenames = [
        (ModuleId::default(), ModulePath::Main),
        (
            ModuleId::from_usize(1),
            ModulePath::Local {
                value: "part.kcl".into(),
                original_import_path: None,
            },
        ),
    ]
    .into_iter()
    .collect();
    let batch = resolve_all(&graph, &operations, &filenames);
    let expected_candidates = [id(1), id(3)].map(|artifact_id| NamedViewInfo {
        artifact_id,
        name: "Front".to_owned(),
        module_id: ModuleId::default(),
        module_path: ModulePath::Main,
    });

    assert_eq!(batch.named_views().len(), 2);
    assert_eq!(
        batch
            .named_views()
            .iter()
            .map(|view| view.info.artifact_id)
            .collect::<HashSet<_>>(),
        HashSet::from([id(2), id(4)])
    );
    assert_eq!(batch.failures().len(), 2);
    assert_eq!(
        batch
            .failures()
            .iter()
            .map(|failure| failure.artifact_id)
            .collect::<HashSet<_>>(),
        HashSet::from([id(1), id(3)])
    );
    for failure in batch.failures() {
        assert_ambiguous_candidates(&failure.error, &expected_candidates);
    }
    assert_eq!(
        batch.default_view(),
        batch.get(&ViewTarget::Default).unwrap().visibility()
    );
}

#[test]
fn batch_retains_default_when_every_declared_view_has_missing_metadata() {
    let graph = graph(vec![
        plane(id(100)),
        named_view(id(1), "Front", 0, ArtifactVisibility::Hide, &[]),
        named_view(id(2), "Back", 1, ArtifactVisibility::Show, &[]),
    ]);
    let operations = [(
        ModuleId::default(),
        vec![hide(OpKclValue::Plane { artifact_id: id(100) })],
    )]
    .into_iter()
    .collect();
    let batch = resolve_all(&graph, &operations, &IndexMap::new());

    assert!(batch.named_views().is_empty());
    assert_eq!(batch.failures().len(), 2);
    assert_eq!(
        batch.default_view(),
        &[(Uuid::from_u128(100), true)].into_iter().collect::<IndexMap<_, _>>()
    );
}

#[test]
fn batch_includes_default_with_or_without_declared_views() {
    for view_count in [0, 4] {
        let mut artifacts = vec![plane(id(100))];
        artifacts.extend((0..view_count).map(|index| {
            named_view(
                id(index + 1),
                &format!("View {index}"),
                0,
                ArtifactVisibility::Show,
                &[],
            )
        }));
        let graph = graph(artifacts);
        let operations = IndexMap::new();
        let filenames = [(ModuleId::default(), ModulePath::Main)].into_iter().collect();
        let batch = resolve_all(&graph, &operations, &filenames);

        assert_eq!(batch.named_views().len(), view_count as usize);
        assert!(batch.failures().is_empty());
        assert_eq!(
            batch.default_view(),
            &[(Uuid::from_u128(100), false)].into_iter().collect::<IndexMap<_, _>>()
        );
        assert_eq!(
            batch.get(&ViewTarget::Default).unwrap().visibility(),
            batch.default_view()
        );
        for resolved in batch.named_views() {
            assert_eq!(
                batch
                    .get(&target(&resolved.info.name, resolved.info.module_id))
                    .unwrap(),
                ResolvedView::Named(resolved)
            );
        }
    }
}

#[test]
fn calculated_results_own_their_execution_data() {
    let batch: ResolvedViewBatch = {
        let graph = graph(vec![
            plane(id(1)),
            named_view(id(2), "Front", 0, ArtifactVisibility::Show, &[]),
        ]);
        let filenames = [(ModuleId::default(), ModulePath::Main)].into_iter().collect();
        let operations = [(
            ModuleId::default(),
            vec![hide(OpKclValue::Plane { artifact_id: id(1) })],
        )]
        .into_iter()
        .collect();
        resolve_all(&graph, &operations, &filenames)
    };

    assert_eq!(
        batch.get(&ViewTarget::Default).unwrap().visibility(),
        &[(Uuid::from_u128(1), true)].into_iter().collect::<IndexMap<_, _>>()
    );
    assert_eq!(
        batch.default_view(),
        &[(Uuid::from_u128(1), true)].into_iter().collect::<IndexMap<_, _>>()
    );
    let ResolvedView::Named(view) = batch.get(&target("Front", ModuleId::default())).unwrap() else {
        panic!("the calculated named view must remain available after its inputs are dropped");
    };
    assert_eq!(view.info.module_path, ModulePath::Main);
    assert!(std::ptr::eq(view, &batch.named_views()[0]));
    assert!(std::ptr::eq(
        batch.get(&target("Front", ModuleId::default())).unwrap().visibility(),
        &view.visibility,
    ));
    assert!(std::ptr::eq(
        batch.get(&ViewTarget::Default).unwrap().visibility(),
        batch.default_view(),
    ));
    assert_eq!(
        view.visibility,
        [(Uuid::from_u128(1), false)].into_iter().collect::<IndexMap<_, _>>()
    );
}

#[test]
fn batch_preserves_hidden_decisions_when_artifacts_share_an_engine_id() {
    let mut shared_path = path(id(2), Some(id(1)));
    if let Artifact::Path(path) = &mut shared_path {
        path.consumed = false;
    }
    let graph = graph(vec![
        shared_path,
        sweep(SweepSubType::Extrusion, id(1), Some(id(2))),
        named_view(id(3), "Front", 0, ArtifactVisibility::Show, &[id(1)]),
    ]);
    let filenames = [(ModuleId::default(), ModulePath::Main)].into_iter().collect();
    let batch = resolve_all(&graph, &IndexMap::new(), &filenames);

    assert_eq!(
        &batch.named_views()[0].visibility,
        &[(Uuid::from_u128(2), true)].into_iter().collect::<IndexMap<_, _>>()
    );
}

#[test]
fn named_views_preserve_authored_camera_intent_without_framing_it() {
    let resolved = resolve_named(Vec::new(), ArtifactVisibility::Show, &[]);
    let ResolvedNamedView {
        camera_intent: camera, ..
    } = resolved;
    assert_eq!(
        camera.look,
        ArtifactCameraLook::Oriented {
            orientation: ArtifactOrientation::Front
        }
    );
    assert_eq!(camera.projection, ArtifactProjection::Orthographic);
    assert_eq!(camera.target, None);
    assert_eq!(camera.distance, None);
}

#[test]
fn visibility_targets_match_named_view_except_types() {
    let std_docs = walk_prelude();
    let Some(DocData::Fn(named)) = std_docs.find_by_name("named") else {
        panic!("view::named must be a documented function");
    };
    assert_eq!(named.qual_name, "std::view::named");
    let except = named
        .args
        .iter()
        .find(|arg| arg.name == "except")
        .expect("view::named must declare except");
    let except_type = except.ty.as_deref().expect("except must declare a type");
    let union = except_type
        .strip_prefix('[')
        .and_then(|ty| ty.strip_suffix("; 1+]"))
        .expect("except must be a non-empty union array");
    let expected: BTreeSet<_> = union
        .split('|')
        .map(str::trim)
        .flat_map(|kcl_type| {
            let fixture_ids: &[u128] = match kcl_type {
                "Solid" => &[1, 2],
                "Sketch" => &[3],
                "GdtAnnotation" => &[4],
                "Helix" => &[5],
                "Plane" => &[6],
                "ImportedGeometry" => &[7],
                _ => panic!("no visibility fixture is defined for except type {kcl_type}"),
            };
            fixture_ids.iter().copied().map(Uuid::from_u128)
        })
        .collect();
    let resolved = resolve_named(eligible_artifacts(), ArtifactVisibility::Show, &[]);
    let actual: BTreeSet<_> = resolved.visibility.keys().copied().collect();
    assert_eq!(actual, expected);
}

#[test]
fn each_baseline_produces_a_complete_decision_for_every_eligible_kind() {
    for (baseline, baseline_hidden) in [(ArtifactVisibility::Show, false), (ArtifactVisibility::Hide, true)] {
        let resolved = resolve_named(eligible_artifacts(), baseline, &[id(1), id(7), id(999)]);
        let expected: IndexMap<_, _> = (1..=7)
            .map(|value| {
                (
                    Uuid::from_u128(value),
                    if value == 1 || value == 7 {
                        !baseline_hidden
                    } else {
                        baseline_hidden
                    },
                )
            })
            .collect();
        assert_eq!(&resolved.visibility, &expected, "{baseline:?}");
    }
}

#[test]
fn consumed_artifacts_are_excluded_from_visibility() {
    let mut artifacts = eligible_artifacts();
    for artifact in &mut artifacts {
        match artifact {
            Artifact::Sweep(value) => value.consumed = true,
            Artifact::CompositeSolid(value) => value.consumed = true,
            Artifact::Path(value) => value.consumed = true,
            Artifact::GdtAnnotation(value) => value.consumed = true,
            Artifact::Helix(value) => value.consumed = true,
            Artifact::ImportedGeometry(value) => value.consumed = true,
            Artifact::Plane(_) => {}
            _ => panic!("unexpected fixture artifact"),
        }
    }
    let resolved = resolve_named(artifacts, ArtifactVisibility::Hide, &[id(1), id(7)]);
    assert_eq!(
        &resolved.visibility,
        &[(Uuid::from_u128(6), true)].into_iter().collect::<IndexMap<_, _>>()
    );
}

#[test]
fn only_standalone_graph_planes_enter_visibility() {
    let resolved = resolve_named(
        vec![
            plane(id(1)),
            Artifact::Plane(Plane {
                id: id(2),
                path_ids: vec![id(5)],
                code_ref: Default::default(),
                plane_info: None,
                size: None,
                hidden: false,
                color: None,
            }),
            Artifact::PlaneOfFace(PlaneOfFace {
                id: id(3),
                face_id: id(6),
                code_ref: Default::default(),
            }),
            Artifact::Solid2d(Solid2d {
                id: id(4),
                path_id: id(5),
            }),
        ],
        ArtifactVisibility::Show,
        &[id(2), id(3), id(4), id(999)],
    );
    assert_eq!(
        &resolved.visibility,
        &[(Uuid::from_u128(1), false)].into_iter().collect::<IndexMap<_, _>>()
    );
}

#[test]
fn mixed_geometry_visibility_uses_source_mirror_and_copy_engine_ids() {
    let mut artifacts = eligible_artifacts();
    let Artifact::Sweep(source) = &mut artifacts[0] else {
        panic!("expected the source sweep fixture");
    };
    source.sub_type = SweepSubType::Extrusion;
    source.path_id = Some(id(100));
    source.pattern_ids.push(id(102));
    artifacts.insert(0, path(id(100), Some(id(1))));
    artifacts.extend([
        sweep(SweepSubType::Extrusion, id(101), Some(id(100))),
        pattern(id(102), id(1), vec![id(103)]),
    ]);

    for (baseline, baseline_hidden) in [(ArtifactVisibility::Show, false), (ArtifactVisibility::Hide, true)] {
        let resolved = resolve_named(artifacts.clone(), baseline, &[id(1), id(101), id(103)]);
        let expected: IndexMap<_, _> = [
            (100, !baseline_hidden),
            (2, baseline_hidden),
            (3, baseline_hidden),
            (4, baseline_hidden),
            (5, baseline_hidden),
            (6, baseline_hidden),
            (7, baseline_hidden),
            (101, !baseline_hidden),
            (103, !baseline_hidden),
        ]
        .into_iter()
        .map(|(value, hidden)| (Uuid::from_u128(value), hidden))
        .collect();
        assert_eq!(&resolved.visibility, &expected, "{baseline:?}");
    }
}

#[test]
fn pattern_copies_use_eligible_direct_source_bodies() {
    for source in [sweep(SweepSubType::Loft, id(1), None), composite(id(1))] {
        let resolved = resolve_named(
            vec![source, pattern(id(2), id(1), vec![id(3), id(4)])],
            ArtifactVisibility::Hide,
            &[id(3)],
        );
        assert_eq!(
            &resolved.visibility,
            &[
                (Uuid::from_u128(1), true),
                (Uuid::from_u128(3), false),
                (Uuid::from_u128(4), true)
            ]
            .into_iter()
            .collect::<IndexMap<_, _>>()
        );
    }
}

#[test]
fn pattern_sources_fall_back_to_body_pattern_ids() {
    for mut source in [sweep(SweepSubType::Loft, id(1), None), composite(id(1))] {
        match &mut source {
            Artifact::Sweep(value) => value.pattern_ids.push(id(2)),
            Artifact::CompositeSolid(value) => value.pattern_ids.push(id(2)),
            _ => panic!("unexpected fixture artifact"),
        }
        for source_exists in [false, true] {
            let mut artifacts = vec![source.clone(), pattern(id(2), id(5), vec![id(3)])];
            if source_exists {
                artifacts.push(path(id(5), None));
            }
            let resolved = resolve_named(artifacts, ArtifactVisibility::Show, &[]);
            assert_eq!(
                &resolved.visibility,
                &[(Uuid::from_u128(1), false), (Uuid::from_u128(3), false)]
                    .into_iter()
                    .collect::<IndexMap<_, _>>()
            );
        }
    }
}

#[test]
fn ineligible_pattern_sources_do_not_fall_back_to_later_bodies() {
    for direct_source in [false, true] {
        let mut first = composite(id(1));
        if let Artifact::CompositeSolid(value) = &mut first {
            value.consumed = true;
            value.pattern_ids.push(id(3));
        }
        let mut second = composite(id(2));
        if let Artifact::CompositeSolid(value) = &mut second {
            value.pattern_ids.push(id(3));
        }
        let resolved = resolve_named(
            vec![
                first,
                second,
                pattern(id(3), if direct_source { id(1) } else { id(5) }, vec![id(4)]),
            ],
            ArtifactVisibility::Show,
            &[],
        );
        assert_eq!(
            &resolved.visibility,
            &[(Uuid::from_u128(2), false)].into_iter().collect::<IndexMap<_, _>>()
        );
    }
}

#[test]
fn patterns_without_a_source_body_contribute_no_copies() {
    let resolved = resolve_named(
        vec![
            plane(id(1)),
            pattern(id(2), id(1), vec![id(3)]),
            pattern(id(4), id(999), vec![id(5)]),
        ],
        ArtifactVisibility::Show,
        &[],
    );
    assert_eq!(
        &resolved.visibility,
        &[(Uuid::from_u128(1), false)].into_iter().collect::<IndexMap<_, _>>()
    );
}

#[test]
fn hidden_decisions_win_engine_id_collisions_in_either_graph_order() {
    let mut base_path = path(id(2), Some(id(1)));
    if let Artifact::Path(value) = &mut base_path {
        value.consumed = false;
    }
    let body = sweep(SweepSubType::Extrusion, id(1), Some(id(2)));
    for artifacts in [vec![base_path.clone(), body.clone()], vec![body, base_path]] {
        let resolved = resolve_named(artifacts, ArtifactVisibility::Show, &[id(1)]);
        assert_eq!(
            &resolved.visibility,
            &[(Uuid::from_u128(2), true)].into_iter().collect::<IndexMap<_, _>>()
        );
    }
}

#[test]
fn default_visibility_reads_all_artifact_id_shapes_across_modules_and_nested_arrays() {
    let values = vec![
        OpKclValue::Plane { artifact_id: id(1) },
        OpKclValue::Face { artifact_id: id(2) },
        OpKclValue::Segment { artifact_id: id(3) },
        OpKclValue::GdtAnnotation { artifact_id: id(4) },
        OpKclValue::ImportedGeometry { artifact_id: id(5) },
        OpKclValue::Sketch {
            value: Box::new(OpSketch::new(id(6))),
        },
        OpKclValue::Solid {
            value: Box::new(OpSolid::new(id(7))),
        },
        OpKclValue::Helix {
            value: Box::new(OpHelix::new(id(8))),
        },
    ];
    let mut operations = IndexMap::new();
    for (module, value) in values.into_iter().enumerate() {
        operations.insert(
            ModuleId::from_usize(module),
            vec![hide(OpKclValue::Array {
                value: vec![OpKclValue::Array { value: vec![value] }],
            })],
        );
    }
    let graph = graph((1..=9).map(|value| plane(id(value))).collect());
    let batch = resolve_all(&graph, &operations, &IndexMap::new());
    let resolved = batch.get(&ViewTarget::Default).unwrap();
    assert_eq!(
        resolved.visibility(),
        &(1..=9)
            .map(|value| (Uuid::from_u128(value), value <= 8))
            .collect::<IndexMap<_, _>>()
    );
    assert!(matches!(resolved, ResolvedView::Default { .. }));
}

#[test]
fn default_visibility_ignores_tags_objects_non_hide_calls_and_labeled_values() {
    let value = OpKclValue::Plane { artifact_id: id(1) };
    let mut non_hide = hide(value.clone());
    if let Operation::StdLibCall { name, .. } = &mut non_hide {
        *name = "extrude".to_owned();
    }
    let mut labeled = hide(value.clone());
    if let Operation::StdLibCall {
        unlabeled_arg,
        labeled_args,
        ..
    } = &mut labeled
    {
        *unlabeled_arg = None;
        labeled_args.insert("objects".to_owned(), OpArg::new(value.clone(), Default::default()));
    }
    let operations = [(
        ModuleId::default(),
        vec![
            hide(OpKclValue::TagIdentifier {
                value: "tag".to_owned(),
                artifact_id: Some(id(1)),
            }),
            hide(OpKclValue::Object {
                value: [("body".to_owned(), value)].into_iter().collect(),
            }),
            hide(OpKclValue::Uuid {
                value: Uuid::from_u128(1),
            }),
            Operation::GroupEnd,
            non_hide,
            labeled,
        ],
    )]
    .into_iter()
    .collect();
    let graph = graph(vec![plane(id(1))]);
    let batch = resolve_all(&graph, &operations, &IndexMap::new());
    let resolved = batch.get(&ViewTarget::Default).unwrap();
    assert_eq!(
        resolved.visibility(),
        &[(Uuid::from_u128(1), false)].into_iter().collect::<IndexMap<_, _>>()
    );
}

#[test]
fn default_visibility_preserves_hide_operations_marked_as_errors() {
    let mut operation = hide(OpKclValue::Plane { artifact_id: id(1) });
    operation.set_std_lib_call_is_error(true);
    let operations = [(ModuleId::default(), vec![operation])].into_iter().collect();
    let graph = graph(vec![plane(id(1)), plane(id(2))]);
    let batch = resolve_all(&graph, &operations, &IndexMap::new());
    let resolved = batch.get(&ViewTarget::Default).unwrap();
    assert_eq!(
        resolved.visibility(),
        &[(Uuid::from_u128(1), true), (Uuid::from_u128(2), false)]
            .into_iter()
            .collect::<IndexMap<_, _>>()
    );
}

#[test]
fn declared_visibility_ignores_program_hide_operations_and_inactive_exception_lists() {
    for baseline in [ArtifactVisibility::Show, ArtifactVisibility::Hide] {
        let mut view = named_view(id(2), "Front", 0, baseline, &[]);
        if let Artifact::NamedView(value) = &mut view {
            match baseline {
                ArtifactVisibility::Show => value.show_ids.push(id(1)),
                ArtifactVisibility::Hide => value.hide_ids.push(id(1)),
            }
        }
        let graph = graph(vec![plane(id(1)), view]);
        let operations = [(
            ModuleId::default(),
            vec![hide(OpKclValue::Plane { artifact_id: id(1) })],
        )]
        .into_iter()
        .collect();
        let filenames = [(ModuleId::default(), ModulePath::Main)].into_iter().collect();
        let batch = resolve_all(&graph, &operations, &filenames);
        let resolved = batch.get(&target("Front", ModuleId::default())).unwrap();
        assert_eq!(
            resolved.visibility(),
            &[(Uuid::from_u128(1), baseline == ArtifactVisibility::Hide)]
                .into_iter()
                .collect::<IndexMap<_, _>>()
        );
    }
}
