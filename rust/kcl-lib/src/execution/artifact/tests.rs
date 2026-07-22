//! Tests for artifact graph behavior.

use super::*;

#[test]
fn gdt_annotation_artifacts_get_node_paths() {
    let code = r#"gdt::annotation(annotation = "NOTE", faces = [], edges = [])"#;
    let ast = crate::parsing::parse_str(code, ModuleId::default()).unwrap();
    let programs = crate::execution::ProgramLookup::new(ast, Default::default());
    let source_range = SourceRange::new(0, code.len(), ModuleId::default());
    let mut artifact = Artifact::GdtAnnotation(GdtAnnotationArtifact {
        id: ArtifactId::new(Uuid::new_v4()),
        code_ref: CodeRef::placeholder(source_range),
    });

    fill_in_node_paths(&mut artifact, &programs, 0, &AHashMap::default());

    let Artifact::GdtAnnotation(annotation) = artifact else {
        panic!("Expected GD&T annotation artifact");
    };
    assert_eq!(annotation.code_ref.range, source_range);
    assert!(!annotation.code_ref.node_path.is_empty());
}

#[test]
fn entity_clone_remaps_sweep_ids() {
    let source_id = ArtifactId::new(Uuid::new_v4());
    let source_path_id = ArtifactId::new(Uuid::new_v4());
    let source_surface_id = ArtifactId::new(Uuid::new_v4());
    let source_edge_id = ArtifactId::new(Uuid::new_v4());
    let source_trajectory_id = ArtifactId::new(Uuid::new_v4());
    let cmd_id = Uuid::new_v4();
    let cloned_path_id = ArtifactId::new(Uuid::new_v4());
    let cloned_surface_id = ArtifactId::new(Uuid::new_v4());
    let cloned_edge_id = ArtifactId::new(Uuid::new_v4());
    let cloned_trajectory_id = ArtifactId::new(Uuid::new_v4());
    let mut artifacts = IndexMap::new();
    artifacts.insert(
        source_id,
        Artifact::Sweep(Sweep {
            id: source_id,
            sub_type: SweepSubType::Revolve,
            path_id: source_path_id,
            surface_ids: vec![source_surface_id],
            edge_ids: vec![source_edge_id],
            code_ref: CodeRef::placeholder(SourceRange::synthetic()),
            source_sweep_id: None,
            trajectory_id: Some(source_trajectory_id),
            method: kittycad_modeling_cmds::shared::ExtrudeMethod::New,
            consumed: true,
            pattern_ids: Vec::new(),
        }),
    );
    let mut clone_id_map = AHashMap::default();
    clone_id_map.insert(source_path_id, cloned_path_id);
    clone_id_map.insert(source_surface_id, cloned_surface_id);
    clone_id_map.insert(source_edge_id, cloned_edge_id);
    clone_id_map.insert(source_trajectory_id, cloned_trajectory_id);
    let mut entity_clone_id_maps = AHashMap::default();
    entity_clone_id_maps.insert(cmd_id, clone_id_map);

    let command = ModelingCmd::from(
        kcmc::each_cmd::EntityClone::builder()
            .entity_id(Uuid::from(source_id))
            .build(),
    );
    let artifact_command = ArtifactCommand {
        cmd_id,
        range: SourceRange::synthetic(),
        command,
        entity_clone_info: None,
        omit_from_graph: false,
    };
    let ast = crate::parsing::parse_str("", ModuleId::default()).unwrap();
    let programs = crate::execution::ProgramLookup::new(ast, Default::default());

    let updated = artifacts_to_update(
        &artifacts,
        &artifact_command,
        &AHashMap::default(),
        &entity_clone_id_maps,
        &AHashMap::default(),
        &programs,
        0,
        &IndexMap::default(),
        &AHashMap::default(),
    )
    .unwrap();

    assert_eq!(updated.len(), 1);
    let Artifact::Sweep(clone_sweep) = &updated[0] else {
        panic!("Expected EntityClone to preserve sweep type, got: {updated:?}");
    };
    assert_eq!(clone_sweep.id, ArtifactId::new(cmd_id));
    assert_eq!(clone_sweep.sub_type, SweepSubType::Revolve);
    assert_eq!(clone_sweep.path_id, cloned_path_id);
    assert_eq!(clone_sweep.method, kittycad_modeling_cmds::shared::ExtrudeMethod::New);
    assert_eq!(clone_sweep.surface_ids, vec![cloned_surface_id]);
    assert_eq!(clone_sweep.edge_ids, vec![cloned_edge_id]);
    assert_eq!(clone_sweep.trajectory_id, Some(cloned_trajectory_id));
    assert!(!clone_sweep.consumed);
}

#[test]
fn entity_clone_remaps_path_ids() {
    let source_id = ArtifactId::new(Uuid::new_v4());
    let cmd_id = Uuid::new_v4();
    let plane_id = ArtifactId::new(Uuid::new_v4());
    let sketch_block_id = ArtifactId::new(Uuid::new_v4());
    let source_seg_id = ArtifactId::new(Uuid::new_v4());
    let source_sweep_id = ArtifactId::new(Uuid::new_v4());
    let source_trajectory_sweep_id = ArtifactId::new(Uuid::new_v4());
    let source_solid2d_id = ArtifactId::new(Uuid::new_v4());
    let source_composite_solid_id = ArtifactId::new(Uuid::new_v4());
    let source_origin_path_id = ArtifactId::new(Uuid::new_v4());
    let source_inner_path_id = ArtifactId::new(Uuid::new_v4());
    let source_outer_path_id = ArtifactId::new(Uuid::new_v4());
    let cloned_seg_id = ArtifactId::new(Uuid::new_v4());
    let cloned_sweep_id = ArtifactId::new(Uuid::new_v4());
    let cloned_trajectory_sweep_id = ArtifactId::new(Uuid::new_v4());
    let cloned_solid2d_id = ArtifactId::new(Uuid::new_v4());
    let cloned_composite_solid_id = ArtifactId::new(Uuid::new_v4());
    let cloned_origin_path_id = ArtifactId::new(Uuid::new_v4());
    let cloned_inner_path_id = ArtifactId::new(Uuid::new_v4());
    let cloned_outer_path_id = ArtifactId::new(Uuid::new_v4());
    let mut artifacts = IndexMap::new();
    artifacts.insert(
        source_id,
        Artifact::Path(Path {
            id: source_id,
            sub_type: PathSubType::Region,
            plane_id,
            sketch_block_id: Some(sketch_block_id),
            seg_ids: vec![source_seg_id],
            consumed: true,
            sweep_id: Some(source_sweep_id),
            trajectory_sweep_id: Some(source_trajectory_sweep_id),
            solid2d_id: Some(source_solid2d_id),
            code_ref: CodeRef::placeholder(SourceRange::synthetic()),
            composite_solid_id: Some(source_composite_solid_id),
            origin_path_id: Some(source_origin_path_id),
            pattern_ids: Vec::new(),
            inner_path_id: Some(source_inner_path_id),
            outer_path_id: Some(source_outer_path_id),
        }),
    );
    let mut clone_id_map = AHashMap::default();
    clone_id_map.insert(source_seg_id, cloned_seg_id);
    clone_id_map.insert(source_sweep_id, cloned_sweep_id);
    clone_id_map.insert(source_trajectory_sweep_id, cloned_trajectory_sweep_id);
    clone_id_map.insert(source_solid2d_id, cloned_solid2d_id);
    clone_id_map.insert(source_composite_solid_id, cloned_composite_solid_id);
    clone_id_map.insert(source_origin_path_id, cloned_origin_path_id);
    clone_id_map.insert(source_inner_path_id, cloned_inner_path_id);
    clone_id_map.insert(source_outer_path_id, cloned_outer_path_id);
    let mut entity_clone_id_maps = AHashMap::default();
    entity_clone_id_maps.insert(cmd_id, clone_id_map);

    let command = ModelingCmd::from(
        kcmc::each_cmd::EntityClone::builder()
            .entity_id(Uuid::from(source_id))
            .build(),
    );
    let artifact_command = ArtifactCommand {
        cmd_id,
        range: SourceRange::synthetic(),
        command,
        entity_clone_info: None,
        omit_from_graph: false,
    };
    let ast = crate::parsing::parse_str("", ModuleId::default()).unwrap();
    let programs = crate::execution::ProgramLookup::new(ast, Default::default());

    let updated = artifacts_to_update(
        &artifacts,
        &artifact_command,
        &AHashMap::default(),
        &entity_clone_id_maps,
        &AHashMap::default(),
        &programs,
        0,
        &IndexMap::default(),
        &AHashMap::default(),
    )
    .unwrap();

    assert_eq!(updated.len(), 1);
    let Artifact::Path(clone_path) = &updated[0] else {
        panic!("Expected EntityClone to preserve path type, got: {updated:?}");
    };
    assert_eq!(clone_path.id, ArtifactId::new(cmd_id));
    assert_eq!(clone_path.sub_type, PathSubType::Region);
    assert_eq!(clone_path.plane_id, plane_id);
    assert_eq!(clone_path.sketch_block_id, Some(sketch_block_id));
    assert_eq!(clone_path.seg_ids, vec![cloned_seg_id]);
    assert_eq!(clone_path.sweep_id, Some(cloned_sweep_id));
    assert_eq!(clone_path.trajectory_sweep_id, Some(cloned_trajectory_sweep_id));
    assert_eq!(clone_path.solid2d_id, Some(cloned_solid2d_id));
    assert_eq!(clone_path.composite_solid_id, Some(cloned_composite_solid_id));
    assert_eq!(clone_path.origin_path_id, Some(cloned_origin_path_id));
    assert_eq!(clone_path.inner_path_id, Some(cloned_inner_path_id));
    assert_eq!(clone_path.outer_path_id, Some(cloned_outer_path_id));
    assert!(!clone_path.consumed);
}

#[test]
fn entity_clone_remaps_composite_solid_ids() {
    let source_id = ArtifactId::new(Uuid::new_v4());
    let cmd_id = Uuid::new_v4();
    let source_solid_id = ArtifactId::new(Uuid::new_v4());
    let source_tool_id = ArtifactId::new(Uuid::new_v4());
    let source_parent_composite_id = ArtifactId::new(Uuid::new_v4());
    let cloned_solid_id = ArtifactId::new(Uuid::new_v4());
    let cloned_tool_id = ArtifactId::new(Uuid::new_v4());
    let cloned_parent_composite_id = ArtifactId::new(Uuid::new_v4());
    let mut artifacts = IndexMap::new();
    artifacts.insert(
        source_id,
        Artifact::CompositeSolid(CompositeSolid {
            id: source_id,
            consumed: true,
            sub_type: CompositeSolidSubType::Subtract,
            output_index: Some(1),
            solid_ids: vec![source_solid_id],
            tool_ids: vec![source_tool_id],
            code_ref: CodeRef::placeholder(SourceRange::synthetic()),
            composite_solid_id: Some(source_parent_composite_id),
            pattern_ids: Vec::new(),
        }),
    );
    let mut clone_id_map = AHashMap::default();
    clone_id_map.insert(source_solid_id, cloned_solid_id);
    clone_id_map.insert(source_tool_id, cloned_tool_id);
    clone_id_map.insert(source_parent_composite_id, cloned_parent_composite_id);
    let mut entity_clone_id_maps = AHashMap::default();
    entity_clone_id_maps.insert(cmd_id, clone_id_map);

    let command = ModelingCmd::from(
        kcmc::each_cmd::EntityClone::builder()
            .entity_id(Uuid::from(source_id))
            .build(),
    );
    let artifact_command = ArtifactCommand {
        cmd_id,
        range: SourceRange::synthetic(),
        command,
        entity_clone_info: Some(EntityCloneInfo {
            source_artifact_id: source_id,
            result_artifact_id: ArtifactId::new(cmd_id),
            source_topology_id: source_id,
        }),
        omit_from_graph: false,
    };
    let ast = crate::parsing::parse_str("", ModuleId::default()).unwrap();
    let programs = crate::execution::ProgramLookup::new(ast, Default::default());

    let updated = artifacts_to_update(
        &artifacts,
        &artifact_command,
        &AHashMap::default(),
        &entity_clone_id_maps,
        &AHashMap::default(),
        &programs,
        0,
        &IndexMap::default(),
        &AHashMap::default(),
    )
    .unwrap();

    assert_eq!(updated.len(), 1);
    let Artifact::CompositeSolid(clone_solid) = &updated[0] else {
        panic!("Expected EntityClone to preserve composite solid type, got: {updated:?}");
    };
    assert_eq!(clone_solid.id, ArtifactId::new(cmd_id));
    assert_eq!(clone_solid.sub_type, CompositeSolidSubType::Subtract);
    assert_eq!(clone_solid.output_index, Some(1));
    assert_eq!(clone_solid.solid_ids, vec![cloned_solid_id]);
    assert_eq!(clone_solid.tool_ids, vec![cloned_tool_id]);
    assert_eq!(clone_solid.composite_solid_id, Some(cloned_parent_composite_id));
    assert!(!clone_solid.consumed);
}

#[test]
fn entity_clone_does_not_preserve_unmapped_pattern_links() {
    let source_id = ArtifactId::new(Uuid::new_v4());
    let pattern_id = ArtifactId::new(Uuid::new_v4());
    let cmd_id = Uuid::new_v4();
    let mut artifacts = IndexMap::new();
    artifacts.insert(
        source_id,
        Artifact::Path(Path {
            id: source_id,
            sub_type: PathSubType::Sketch,
            plane_id: ArtifactId::new(Uuid::new_v4()),
            sketch_block_id: None,
            seg_ids: Vec::new(),
            consumed: true,
            sweep_id: None,
            trajectory_sweep_id: None,
            solid2d_id: None,
            code_ref: CodeRef::placeholder(SourceRange::synthetic()),
            composite_solid_id: None,
            origin_path_id: None,
            pattern_ids: vec![pattern_id],
            inner_path_id: None,
            outer_path_id: None,
        }),
    );

    let command = ModelingCmd::from(
        kcmc::each_cmd::EntityClone::builder()
            .entity_id(Uuid::from(source_id))
            .build(),
    );
    let artifact_command = ArtifactCommand {
        cmd_id,
        range: SourceRange::synthetic(),
        command,
        entity_clone_info: None,
        omit_from_graph: false,
    };
    let ast = crate::parsing::parse_str("", ModuleId::default()).unwrap();
    let programs = crate::execution::ProgramLookup::new(ast, Default::default());

    let updated = artifacts_to_update(
        &artifacts,
        &artifact_command,
        &AHashMap::default(),
        &AHashMap::default(),
        &AHashMap::default(),
        &programs,
        0,
        &IndexMap::default(),
        &AHashMap::default(),
    )
    .unwrap();

    let Artifact::Path(clone_path) = &updated[0] else {
        panic!("Expected EntityClone to preserve path type, got: {updated:?}");
    };
    assert!(clone_path.pattern_ids.is_empty());
}

#[test]
fn entity_clone_clones_mapped_child_artifacts() {
    let source_path_id = ArtifactId::new(Uuid::new_v4());
    let source_seg_id = ArtifactId::new(Uuid::new_v4());
    let source_sweep_id = ArtifactId::new(Uuid::new_v4());
    let source_wall_id = ArtifactId::new(Uuid::new_v4());
    let source_plane_id = ArtifactId::new(Uuid::new_v4());
    let cmd_id = Uuid::new_v4();

    let cloned_path_id = ArtifactId::new(cmd_id);
    let cloned_seg_id = ArtifactId::new(Uuid::new_v4());
    let cloned_sweep_id = ArtifactId::new(Uuid::new_v4());
    let cloned_wall_id = ArtifactId::new(Uuid::new_v4());

    let mut artifacts = IndexMap::new();
    artifacts.insert(
        source_path_id,
        Artifact::Path(Path {
            id: source_path_id,
            sub_type: PathSubType::Sketch,
            plane_id: source_plane_id,
            seg_ids: vec![source_seg_id],
            consumed: true,
            sweep_id: Some(source_sweep_id),
            trajectory_sweep_id: None,
            solid2d_id: None,
            code_ref: CodeRef::placeholder(SourceRange::synthetic()),
            composite_solid_id: None,
            sketch_block_id: None,
            origin_path_id: None,
            inner_path_id: None,
            outer_path_id: None,
            pattern_ids: Vec::new(),
        }),
    );
    artifacts.insert(
        source_seg_id,
        Artifact::Segment(Segment {
            id: source_seg_id,
            path_id: source_path_id,
            original_seg_id: None,
            surface_id: Some(source_wall_id),
            edge_ids: Vec::new(),
            edge_cut_id: None,
            code_ref: CodeRef::placeholder(SourceRange::synthetic()),
            common_surface_ids: Vec::new(),
        }),
    );
    artifacts.insert(
        source_sweep_id,
        Artifact::Sweep(Sweep {
            id: source_sweep_id,
            sub_type: SweepSubType::Extrusion,
            path_id: source_path_id,
            surface_ids: vec![source_wall_id],
            edge_ids: Vec::new(),
            code_ref: CodeRef::placeholder(SourceRange::synthetic()),
            source_sweep_id: None,
            trajectory_id: None,
            method: kittycad_modeling_cmds::shared::ExtrudeMethod::Merge,
            consumed: true,
            pattern_ids: Vec::new(),
        }),
    );
    artifacts.insert(
        source_wall_id,
        Artifact::Wall(Wall {
            id: source_wall_id,
            seg_id: source_seg_id,
            edge_cut_edge_ids: Vec::new(),
            sweep_id: source_sweep_id,
            path_ids: vec![source_path_id],
            face_code_ref: CodeRef::placeholder(SourceRange::synthetic()),
            cmd_id: Uuid::new_v4(),
        }),
    );

    let mut clone_id_map = AHashMap::default();
    clone_id_map.insert(source_path_id, cloned_path_id);
    clone_id_map.insert(source_seg_id, cloned_seg_id);
    clone_id_map.insert(source_sweep_id, cloned_sweep_id);
    clone_id_map.insert(source_wall_id, cloned_wall_id);
    let mut entity_clone_id_maps = AHashMap::default();
    entity_clone_id_maps.insert(cmd_id, clone_id_map);

    let command = ModelingCmd::from(
        kcmc::each_cmd::EntityClone::builder()
            .entity_id(Uuid::from(source_path_id))
            .build(),
    );
    let artifact_command = ArtifactCommand {
        cmd_id,
        range: SourceRange::synthetic(),
        command,
        entity_clone_info: None,
        omit_from_graph: false,
    };
    let ast = crate::parsing::parse_str("", ModuleId::default()).unwrap();
    let programs = crate::execution::ProgramLookup::new(ast, Default::default());

    let updated = artifacts_to_update(
        &artifacts,
        &artifact_command,
        &AHashMap::default(),
        &entity_clone_id_maps,
        &AHashMap::default(),
        &programs,
        0,
        &IndexMap::default(),
        &AHashMap::default(),
    )
    .unwrap();

    let updated_map: IndexMap<ArtifactId, Artifact> =
        IndexMap::from_iter(updated.into_iter().map(|artifact| (artifact.id(), artifact)));

    let Artifact::Path(cloned_path) = updated_map.get(&cloned_path_id).expect("Expected cloned path artifact") else {
        panic!("Expected cloned path artifact");
    };
    assert_eq!(cloned_path.seg_ids, vec![cloned_seg_id]);
    assert_eq!(cloned_path.sweep_id, Some(cloned_sweep_id));
    assert!(!cloned_path.consumed);

    let Artifact::Segment(cloned_seg) = updated_map
        .get(&cloned_seg_id)
        .expect("Expected cloned segment artifact")
    else {
        panic!("Expected cloned segment artifact");
    };
    assert_eq!(cloned_seg.path_id, cloned_path_id);
    assert_eq!(cloned_seg.surface_id, Some(cloned_wall_id));

    let Artifact::Sweep(cloned_sweep) = updated_map
        .get(&cloned_sweep_id)
        .expect("Expected cloned sweep artifact")
    else {
        panic!("Expected cloned sweep artifact");
    };
    assert_eq!(cloned_sweep.path_id, cloned_path_id);
    assert_eq!(cloned_sweep.surface_ids, vec![cloned_wall_id]);
    assert!(cloned_sweep.consumed);

    let Artifact::Wall(cloned_wall) = updated_map.get(&cloned_wall_id).expect("Expected cloned wall artifact") else {
        panic!("Expected cloned wall artifact");
    };
    assert_eq!(cloned_wall.seg_id, cloned_seg_id);
    assert_eq!(cloned_wall.sweep_id, cloned_sweep_id);
    assert_eq!(cloned_wall.path_ids, vec![cloned_path_id]);
}

#[test]
fn entity_clone_separates_solid_artifact_from_root_path() {
    let source_path_id = ArtifactId::new(Uuid::new_v4());
    let source_sweep_id = ArtifactId::new(Uuid::new_v4());
    let source_seg_id = ArtifactId::new(Uuid::new_v4());
    let source_wall_id = ArtifactId::new(Uuid::new_v4());
    let source_plane_id = ArtifactId::new(Uuid::new_v4());
    let clone_entity_id = Uuid::new_v4();
    let cloned_path_id = ArtifactId::new(clone_entity_id);
    let cloned_sweep_id = ArtifactId::new(Uuid::new_v4());
    let cloned_seg_id = ArtifactId::new(Uuid::new_v4());
    let cloned_wall_id = ArtifactId::new(Uuid::new_v4());

    let mut artifacts = IndexMap::new();
    artifacts.insert(
        source_path_id,
        Artifact::Path(Path {
            id: source_path_id,
            sub_type: PathSubType::Region,
            plane_id: source_plane_id,
            seg_ids: vec![source_seg_id],
            consumed: true,
            sweep_id: Some(source_sweep_id),
            trajectory_sweep_id: None,
            solid2d_id: None,
            code_ref: CodeRef::placeholder(SourceRange::synthetic()),
            composite_solid_id: None,
            sketch_block_id: None,
            origin_path_id: None,
            inner_path_id: None,
            outer_path_id: None,
            pattern_ids: Vec::new(),
        }),
    );
    artifacts.insert(
        source_sweep_id,
        Artifact::Sweep(Sweep {
            id: source_sweep_id,
            sub_type: SweepSubType::Extrusion,
            path_id: source_path_id,
            surface_ids: vec![source_wall_id],
            edge_ids: Vec::new(),
            code_ref: CodeRef::placeholder(SourceRange::synthetic()),
            source_sweep_id: None,
            trajectory_id: None,
            method: kittycad_modeling_cmds::shared::ExtrudeMethod::Merge,
            consumed: false,
            pattern_ids: Vec::new(),
        }),
    );
    artifacts.insert(
        source_seg_id,
        Artifact::Segment(Segment {
            id: source_seg_id,
            path_id: source_path_id,
            original_seg_id: None,
            surface_id: Some(source_wall_id),
            edge_ids: Vec::new(),
            edge_cut_id: None,
            code_ref: CodeRef::placeholder(SourceRange::synthetic()),
            common_surface_ids: Vec::new(),
        }),
    );
    artifacts.insert(
        source_wall_id,
        Artifact::Wall(Wall {
            id: source_wall_id,
            seg_id: source_seg_id,
            edge_cut_edge_ids: Vec::new(),
            sweep_id: source_sweep_id,
            path_ids: vec![source_path_id],
            face_code_ref: CodeRef::placeholder(SourceRange::synthetic()),
            cmd_id: Uuid::new_v4(),
        }),
    );

    // The engine child mapping contains topology entity IDs, but not the
    // extrusion command ID used by the source Sweep artifact.
    let mut clone_id_map = AHashMap::default();
    clone_id_map.insert(source_seg_id, cloned_seg_id);
    clone_id_map.insert(source_wall_id, cloned_wall_id);
    let mut entity_clone_id_maps = AHashMap::default();
    entity_clone_id_maps.insert(clone_entity_id, clone_id_map);

    let artifact_command = ArtifactCommand {
        cmd_id: clone_entity_id,
        range: SourceRange::synthetic(),
        command: ModelingCmd::from(
            kcmc::each_cmd::EntityClone::builder()
                .entity_id(Uuid::from(source_path_id))
                .build(),
        ),
        entity_clone_info: Some(EntityCloneInfo {
            source_artifact_id: source_sweep_id,
            result_artifact_id: cloned_sweep_id,
            source_topology_id: source_path_id,
        }),
        omit_from_graph: false,
    };
    let ast = crate::parsing::parse_str("", ModuleId::default()).unwrap();
    let programs = crate::execution::ProgramLookup::new(ast, Default::default());

    let updated = artifacts_to_update(
        &artifacts,
        &artifact_command,
        &AHashMap::default(),
        &entity_clone_id_maps,
        &AHashMap::default(),
        &programs,
        0,
        &IndexMap::default(),
        &AHashMap::default(),
    )
    .unwrap();
    let updated_map: IndexMap<ArtifactId, Artifact> =
        IndexMap::from_iter(updated.into_iter().map(|artifact| (artifact.id(), artifact)));

    let Artifact::Path(cloned_path) = updated_map.get(&cloned_path_id).expect("Expected cloned path artifact") else {
        panic!("Expected cloned path artifact");
    };
    assert!(cloned_path.consumed);
    assert_eq!(cloned_path.sweep_id, Some(cloned_sweep_id));

    let Artifact::Sweep(cloned_sweep) = updated_map
        .get(&cloned_sweep_id)
        .expect("Expected cloned sweep artifact")
    else {
        panic!("Expected cloned sweep artifact");
    };
    assert!(!cloned_sweep.consumed);
    assert_eq!(cloned_sweep.source_sweep_id, Some(source_sweep_id));
    assert_eq!(cloned_sweep.path_id, cloned_path_id);
    assert_eq!(cloned_sweep.surface_ids, vec![cloned_wall_id]);

    let second_clone_sweep_id = ArtifactId::new(Uuid::new_v4());
    let mut second_clone_id_map = AHashMap::default();
    second_clone_id_map.insert(cloned_sweep_id, second_clone_sweep_id);
    let Artifact::Sweep(second_clone_sweep) = remap_artifact_for_clone(
        updated_map.get(&cloned_sweep_id).unwrap(),
        &second_clone_id_map,
        &CodeRef::placeholder(SourceRange::synthetic()),
        Uuid::new_v4(),
        cloned_sweep_id,
    ) else {
        panic!("Expected second cloned sweep artifact");
    };
    assert_eq!(second_clone_sweep.source_sweep_id, Some(source_sweep_id));

    let Artifact::Segment(cloned_seg) = updated_map
        .get(&cloned_seg_id)
        .expect("Expected cloned segment artifact")
    else {
        panic!("Expected cloned segment artifact");
    };
    assert_eq!(cloned_seg.path_id, cloned_path_id);
    assert_eq!(cloned_seg.surface_id, Some(cloned_wall_id));

    let Artifact::Wall(cloned_wall) = updated_map.get(&cloned_wall_id).expect("Expected cloned wall artifact") else {
        panic!("Expected cloned wall artifact");
    };
    assert_eq!(cloned_wall.sweep_id, cloned_sweep_id);
    assert_eq!(cloned_wall.path_ids, vec![cloned_path_id]);
}

#[test]
fn build_entity_clone_id_maps_from_child_queries() {
    let source_id = Uuid::new_v4();
    let clone_cmd_id = Uuid::new_v4();
    let old_children_cmd_id = Uuid::new_v4();
    let source_topology_id = Uuid::new_v4();
    let source_children_cmd_id = Uuid::new_v4();
    let new_children_cmd_id = Uuid::new_v4();
    let old_child_a = Uuid::new_v4();
    let old_child_b = Uuid::new_v4();
    let source_child_a = Uuid::new_v4();
    let source_child_b = Uuid::new_v4();
    let new_child_a = Uuid::new_v4();
    let new_child_b = Uuid::new_v4();

    let artifact_commands = vec![
        ArtifactCommand {
            cmd_id: clone_cmd_id,
            range: SourceRange::synthetic(),
            command: ModelingCmd::from(kcmc::each_cmd::EntityClone::builder().entity_id(source_id).build()),
            entity_clone_info: Some(EntityCloneInfo {
                source_artifact_id: ArtifactId::new(source_id),
                result_artifact_id: ArtifactId::new(clone_cmd_id),
                source_topology_id: ArtifactId::new(source_topology_id),
            }),
            omit_from_graph: false,
        },
        ArtifactCommand {
            cmd_id: old_children_cmd_id,
            range: SourceRange::synthetic(),
            command: ModelingCmd::from(
                kcmc::each_cmd::EntityGetAllChildUuids::builder()
                    .entity_id(source_id)
                    .build(),
            ),
            entity_clone_info: None,
            omit_from_graph: false,
        },
        ArtifactCommand {
            cmd_id: source_children_cmd_id,
            range: SourceRange::synthetic(),
            command: ModelingCmd::from(
                kcmc::each_cmd::EntityGetAllChildUuids::builder()
                    .entity_id(source_topology_id)
                    .build(),
            ),
            entity_clone_info: None,
            omit_from_graph: false,
        },
        ArtifactCommand {
            cmd_id: new_children_cmd_id,
            range: SourceRange::synthetic(),
            command: ModelingCmd::from(
                kcmc::each_cmd::EntityGetAllChildUuids::builder()
                    .entity_id(clone_cmd_id)
                    .build(),
            ),
            entity_clone_info: None,
            omit_from_graph: false,
        },
    ];

    let mut responses = AHashMap::default();
    let old_children_response: kcmc::output::EntityGetAllChildUuids =
        serde_json::from_value(serde_json::json!({ "entity_ids": [old_child_a, old_child_b] })).unwrap();
    let new_children_response: kcmc::output::EntityGetAllChildUuids =
        serde_json::from_value(serde_json::json!({ "entity_ids": [new_child_a, new_child_b] })).unwrap();
    let source_children_response: kcmc::output::EntityGetAllChildUuids =
        serde_json::from_value(serde_json::json!({ "entity_ids": [source_child_a, source_child_b] })).unwrap();
    responses.insert(
        old_children_cmd_id,
        OkModelingCmdResponse::EntityGetAllChildUuids(old_children_response),
    );
    responses.insert(
        source_children_cmd_id,
        OkModelingCmdResponse::EntityGetAllChildUuids(source_children_response),
    );
    responses.insert(
        new_children_cmd_id,
        OkModelingCmdResponse::EntityGetAllChildUuids(new_children_response),
    );

    let clone_id_maps = build_entity_clone_id_maps(&artifact_commands, &responses);
    let id_map = clone_id_maps
        .get(&clone_cmd_id)
        .expect("Expected clone ID map for clone command");

    assert_eq!(
        id_map.get(&ArtifactId::new(source_id)),
        Some(&ArtifactId::new(clone_cmd_id))
    );
    assert_eq!(
        id_map.get(&ArtifactId::new(old_child_a)),
        Some(&ArtifactId::new(new_child_a))
    );
    assert_eq!(
        id_map.get(&ArtifactId::new(old_child_b)),
        Some(&ArtifactId::new(new_child_b))
    );
    assert_eq!(
        id_map.get(&ArtifactId::new(source_child_a)),
        Some(&ArtifactId::new(new_child_a))
    );
    assert_eq!(
        id_map.get(&ArtifactId::new(source_child_b)),
        Some(&ArtifactId::new(new_child_b))
    );
    assert!(!id_map.contains_key(&ArtifactId::new(source_topology_id)));
}

#[test]
fn surface_blend_creates_blend_sweep_artifact() {
    let path_one_id = ArtifactId::new(Uuid::new_v4());
    let path_two_id = ArtifactId::new(Uuid::new_v4());
    let source_surface_one_id = ArtifactId::new(Uuid::new_v4());
    let source_surface_two_id = ArtifactId::new(Uuid::new_v4());
    let source_code_ref = CodeRef::placeholder(SourceRange::synthetic());

    let mut artifacts = IndexMap::new();
    artifacts.insert(
        source_surface_one_id,
        Artifact::Sweep(Sweep {
            id: source_surface_one_id,
            sub_type: SweepSubType::Extrusion,
            path_id: path_one_id,
            surface_ids: Vec::new(),
            edge_ids: Vec::new(),
            code_ref: source_code_ref.clone(),
            source_sweep_id: None,
            trajectory_id: None,
            method: kittycad_modeling_cmds::shared::ExtrudeMethod::Merge,
            consumed: false,
            pattern_ids: Vec::new(),
        }),
    );
    artifacts.insert(
        source_surface_two_id,
        Artifact::Sweep(Sweep {
            id: source_surface_two_id,
            sub_type: SweepSubType::Extrusion,
            path_id: path_two_id,
            surface_ids: Vec::new(),
            edge_ids: Vec::new(),
            code_ref: source_code_ref,
            source_sweep_id: None,
            trajectory_id: None,
            method: kittycad_modeling_cmds::shared::ExtrudeMethod::Merge,
            consumed: false,
            pattern_ids: Vec::new(),
        }),
    );

    let cmd_id = Uuid::new_v4();
    let command = ModelingCmd::from(
        kcmc::each_cmd::SurfaceBlend::builder()
            .surfaces(vec![
                kcmc::shared::SurfaceEdgeReference::builder()
                    .object_id(Uuid::from(source_surface_one_id))
                    .edges(vec![
                        kcmc::shared::FractionOfEdge::builder()
                            .edge_id(Uuid::new_v4())
                            .lower_bound(0.0)
                            .upper_bound(1.0)
                            .build(),
                    ])
                    .build(),
                kcmc::shared::SurfaceEdgeReference::builder()
                    .object_id(Uuid::from(source_surface_two_id))
                    .edges(vec![
                        kcmc::shared::FractionOfEdge::builder()
                            .edge_id(Uuid::new_v4())
                            .lower_bound(0.0)
                            .upper_bound(1.0)
                            .build(),
                    ])
                    .build(),
            ])
            .build(),
    );
    let artifact_command = ArtifactCommand {
        cmd_id,
        range: SourceRange::synthetic(),
        command,
        entity_clone_info: None,
        omit_from_graph: false,
    };
    let ast = crate::parsing::parse_str("", ModuleId::default()).unwrap();
    let programs = crate::execution::ProgramLookup::new(ast, Default::default());

    let updated = artifacts_to_update(
        &artifacts,
        &artifact_command,
        &AHashMap::default(),
        &AHashMap::default(),
        &AHashMap::default(),
        &programs,
        0,
        &IndexMap::default(),
        &AHashMap::default(),
    )
    .unwrap();

    assert_eq!(updated.len(), 1);
    let Artifact::Sweep(blend_sweep) = &updated[0] else {
        panic!("Expected SurfaceBlend to create a sweep artifact, got: {updated:?}");
    };

    assert_eq!(blend_sweep.id, ArtifactId::new(cmd_id));
    assert_eq!(blend_sweep.sub_type, SweepSubType::Blend);
    assert_eq!(blend_sweep.path_id, path_one_id);
    assert_eq!(blend_sweep.trajectory_id, Some(path_two_id));
    assert_eq!(blend_sweep.method, kittycad_modeling_cmds::shared::ExtrudeMethod::New);
    assert!(!blend_sweep.consumed);
}

#[test]
fn create_region_creates_region_path_sub_type() {
    let origin_path_id = ArtifactId::new(Uuid::new_v4());
    let origin_plane_id = ArtifactId::new(Uuid::new_v4());
    let source_code_ref = CodeRef::placeholder(SourceRange::synthetic());

    let mut artifacts = IndexMap::new();
    artifacts.insert(
        origin_path_id,
        Artifact::Path(Path {
            id: origin_path_id,
            sub_type: PathSubType::Sketch,
            plane_id: origin_plane_id,
            seg_ids: Vec::new(),
            consumed: false,
            sweep_id: None,
            trajectory_sweep_id: None,
            solid2d_id: None,
            code_ref: source_code_ref,
            composite_solid_id: None,
            sketch_block_id: None,
            origin_path_id: None,
            inner_path_id: None,
            outer_path_id: None,
            pattern_ids: Vec::new(),
        }),
    );

    let cmd_id = Uuid::new_v4();
    let command = ModelingCmd::from(
        kcmc::each_cmd::CreateRegion::builder()
            .object_id(Uuid::from(origin_path_id))
            .segment(Uuid::new_v4())
            .intersection_segment(Uuid::new_v4())
            .intersection_index(-1)
            .curve_clockwise(false)
            .build(),
    );
    let artifact_command = ArtifactCommand {
        cmd_id,
        range: SourceRange::synthetic(),
        command,
        entity_clone_info: None,
        omit_from_graph: false,
    };
    let ast = crate::parsing::parse_str("", ModuleId::default()).unwrap();
    let programs = crate::execution::ProgramLookup::new(ast, Default::default());

    let updated = artifacts_to_update(
        &artifacts,
        &artifact_command,
        &AHashMap::default(),
        &AHashMap::default(),
        &AHashMap::default(),
        &programs,
        0,
        &IndexMap::default(),
        &AHashMap::default(),
    )
    .unwrap();

    assert_eq!(updated.len(), 1);
    let Artifact::Path(region_path) = &updated[0] else {
        panic!("Expected CreateRegion to create a path artifact, got: {updated:?}");
    };
    assert_eq!(region_path.id, ArtifactId::new(cmd_id));
    assert_eq!(region_path.sub_type, PathSubType::Region);
    assert_eq!(region_path.plane_id, origin_plane_id);
    // A region path isn't created from a sketch block directly.
    assert_eq!(region_path.sketch_block_id, None);
    // It links back to the origin sketch path.
    assert_eq!(region_path.origin_path_id, Some(origin_path_id));
}

#[test]
fn pattern_artifact_links_to_source_geometry() {
    let path_id = ArtifactId::new(Uuid::new_v4());
    let sweep_id = ArtifactId::new(Uuid::new_v4());
    let pattern_id = ArtifactId::new(Uuid::new_v4());
    let plane_id = ArtifactId::new(Uuid::new_v4());
    let copy_id = Uuid::new_v4();
    let wall_id = ArtifactId::new(Uuid::new_v4());
    let cap_id = ArtifactId::new(Uuid::new_v4());
    let edge_id = ArtifactId::new(Uuid::new_v4());
    let copy_wall_id = Uuid::new_v4();
    let copy_cap_id = Uuid::new_v4();
    let copy_edge_id = Uuid::new_v4();
    let code_ref = CodeRef::placeholder(SourceRange::synthetic());
    let face_edge_infos: Vec<kcmc::output::FaceEdgeInfo> = serde_json::from_value(serde_json::json!([
        {
            "object_id": copy_id,
            "faces": [copy_wall_id, copy_cap_id],
            "edges": [copy_edge_id],
        }
    ]))
    .expect("valid face-edge info");

    let mut artifacts = IndexMap::new();
    artifacts.insert(
        path_id,
        Artifact::Path(Path {
            id: path_id,
            sub_type: PathSubType::Sketch,
            plane_id,
            seg_ids: Vec::new(),
            consumed: true,
            sweep_id: Some(sweep_id),
            trajectory_sweep_id: None,
            solid2d_id: None,
            code_ref: code_ref.clone(),
            composite_solid_id: None,
            sketch_block_id: None,
            origin_path_id: None,
            inner_path_id: None,
            outer_path_id: None,
            pattern_ids: Vec::new(),
        }),
    );
    artifacts.insert(
        sweep_id,
        Artifact::Sweep(Sweep {
            id: sweep_id,
            sub_type: SweepSubType::Extrusion,
            path_id,
            surface_ids: vec![wall_id, cap_id],
            edge_ids: vec![edge_id],
            code_ref: code_ref.clone(),
            source_sweep_id: None,
            trajectory_id: None,
            method: kittycad_modeling_cmds::shared::ExtrudeMethod::Merge,
            consumed: false,
            pattern_ids: Vec::new(),
        }),
    );
    artifacts.insert(
        wall_id,
        Artifact::Wall(Wall {
            id: wall_id,
            seg_id: ArtifactId::new(Uuid::new_v4()),
            edge_cut_edge_ids: vec![edge_id],
            sweep_id,
            path_ids: Vec::new(),
            face_code_ref: code_ref.clone(),
            cmd_id: Uuid::new_v4(),
        }),
    );
    artifacts.insert(
        cap_id,
        Artifact::Cap(Cap {
            id: cap_id,
            sub_type: CapSubType::End,
            edge_cut_edge_ids: Vec::new(),
            sweep_id,
            path_ids: Vec::new(),
            face_code_ref: code_ref.clone(),
            cmd_id: Uuid::new_v4(),
        }),
    );
    artifacts.insert(
        edge_id,
        Artifact::SweepEdge(SweepEdge {
            id: edge_id,
            sub_type: SweepEdgeSubType::Opposite,
            seg_id: ArtifactId::new(Uuid::new_v4()),
            cmd_id: Uuid::new_v4(),
            index: 0,
            sweep_id,
            common_surface_ids: vec![wall_id, cap_id],
        }),
    );

    let updated = pattern_artifact_updates(
        &artifacts,
        pattern_id,
        PatternSubType::Circular,
        path_id,
        &face_edge_infos,
        code_ref,
    );

    assert!(matches!(
        updated.first(),
        Some(Artifact::Pattern(Pattern {
            id,
            sub_type: PatternSubType::Circular,
            source_id,
            copy_ids,
            copy_face_ids,
            copy_edge_ids,
            ..
        })) if *id == pattern_id
            && *source_id == path_id
            && copy_ids == &vec![ArtifactId::new(copy_id)]
            && copy_face_ids == &vec![ArtifactId::new(copy_wall_id), ArtifactId::new(copy_cap_id)]
            && copy_edge_ids == &vec![ArtifactId::new(copy_edge_id)]
    ));
    assert!(updated.iter().any(|artifact| {
        matches!(artifact, Artifact::Path(path) if path.id == path_id && path.pattern_ids == vec![pattern_id])
    }));
    assert!(updated.iter().any(|artifact| {
        matches!(artifact, Artifact::Sweep(sweep) if sweep.id == sweep_id && sweep.pattern_ids == vec![pattern_id])
    }));
    assert!(updated.iter().any(|artifact| {
        matches!(
            artifact,
            Artifact::Sweep(sweep)
                if sweep.id == ArtifactId::new(copy_id)
                    && sweep.surface_ids == vec![ArtifactId::new(copy_wall_id), ArtifactId::new(copy_cap_id)]
                    && sweep.edge_ids == vec![ArtifactId::new(copy_edge_id)]
                    && !sweep.consumed
                    && sweep.pattern_ids.is_empty()
        )
    }));
    assert!(
        !updated
            .iter()
            .any(|artifact| matches!(artifact, Artifact::Wall(_) | Artifact::Cap(_) | Artifact::SweepEdge(_)))
    );
}

#[test]
fn pattern_artifact_materializes_composite_solid_copies() {
    let source_id = ArtifactId::new(Uuid::new_v4());
    let pattern_id = ArtifactId::new(Uuid::new_v4());
    let copy_id = Uuid::new_v4();
    let face_edge_infos: Vec<kcmc::output::FaceEdgeInfo> = serde_json::from_value(serde_json::json!([
        {
            "object_id": copy_id,
            "faces": [Uuid::new_v4()],
            "edges": [Uuid::new_v4()],
        }
    ]))
    .expect("valid face-edge info");
    let mut artifacts = IndexMap::new();
    artifacts.insert(
        source_id,
        Artifact::CompositeSolid(CompositeSolid {
            id: source_id,
            consumed: false,
            sub_type: CompositeSolidSubType::Union,
            output_index: Some(2),
            solid_ids: vec![ArtifactId::new(Uuid::new_v4())],
            tool_ids: Vec::new(),
            code_ref: CodeRef::placeholder(SourceRange::synthetic()),
            composite_solid_id: Some(ArtifactId::new(Uuid::new_v4())),
            pattern_ids: Vec::new(),
        }),
    );

    let updated = pattern_artifact_updates(
        &artifacts,
        pattern_id,
        PatternSubType::Linear,
        source_id,
        &face_edge_infos,
        CodeRef::placeholder(SourceRange::synthetic()),
    );

    let Some(Artifact::CompositeSolid(copy)) = updated
        .iter()
        .find(|artifact| artifact.id() == ArtifactId::new(copy_id))
    else {
        panic!("Expected a materialized composite solid pattern copy");
    };
    assert!(!copy.consumed);
    assert_eq!(copy.output_index, None);
    assert_eq!(copy.composite_solid_id, None);
    assert!(copy.pattern_ids.is_empty());
}

#[test]
fn entity_clone_resolves_materialized_pattern_copy() {
    let source_path_id = ArtifactId::new(Uuid::new_v4());
    let source_sweep_id = ArtifactId::new(Uuid::new_v4());
    let source_wall_id = ArtifactId::new(Uuid::new_v4());
    let source_cap_id = ArtifactId::new(Uuid::new_v4());
    let pattern_id = ArtifactId::new(Uuid::new_v4());
    let copy_id = Uuid::new_v4();
    let copy_face_id = Uuid::new_v4();
    let copy_cap_id = Uuid::new_v4();
    let copy_edge_id = Uuid::new_v4();
    let clone_id = Uuid::new_v4();
    let cloned_face_id = ArtifactId::new(Uuid::new_v4());
    let cloned_cap_id = ArtifactId::new(Uuid::new_v4());
    let cloned_edge_id = ArtifactId::new(Uuid::new_v4());
    let code_ref = CodeRef::placeholder(SourceRange::synthetic());
    let mut artifacts = IndexMap::new();
    artifacts.insert(
        source_sweep_id,
        Artifact::Sweep(Sweep {
            id: source_sweep_id,
            sub_type: SweepSubType::Extrusion,
            path_id: source_path_id,
            surface_ids: vec![source_wall_id, source_cap_id],
            edge_ids: Vec::new(),
            code_ref: code_ref.clone(),
            source_sweep_id: None,
            trajectory_id: None,
            method: kittycad_modeling_cmds::shared::ExtrudeMethod::New,
            consumed: false,
            pattern_ids: Vec::new(),
        }),
    );
    artifacts.insert(
        source_wall_id,
        Artifact::Wall(Wall {
            id: source_wall_id,
            seg_id: ArtifactId::new(Uuid::new_v4()),
            edge_cut_edge_ids: Vec::new(),
            sweep_id: source_sweep_id,
            path_ids: Vec::new(),
            face_code_ref: code_ref.clone(),
            cmd_id: Uuid::new_v4(),
        }),
    );
    artifacts.insert(
        source_cap_id,
        Artifact::Cap(Cap {
            id: source_cap_id,
            sub_type: CapSubType::End,
            edge_cut_edge_ids: Vec::new(),
            sweep_id: source_sweep_id,
            path_ids: Vec::new(),
            face_code_ref: code_ref.clone(),
            cmd_id: Uuid::new_v4(),
        }),
    );
    let face_edge_infos: Vec<kcmc::output::FaceEdgeInfo> = serde_json::from_value(serde_json::json!([
        {
            "object_id": copy_id,
            "faces": [copy_face_id, copy_cap_id],
            "edges": [copy_edge_id],
        }
    ]))
    .expect("valid face-edge info");
    for update in pattern_artifact_updates(
        &artifacts,
        pattern_id,
        PatternSubType::Circular,
        source_sweep_id,
        &face_edge_infos,
        code_ref,
    ) {
        merge_artifact_into_map(&mut artifacts, update);
    }

    let artifact_command = ArtifactCommand {
        cmd_id: clone_id,
        range: SourceRange::synthetic(),
        command: ModelingCmd::from(kcmc::each_cmd::EntityClone::builder().entity_id(copy_id).build()),
        entity_clone_info: Some(EntityCloneInfo {
            source_artifact_id: ArtifactId::new(copy_id),
            result_artifact_id: ArtifactId::new(clone_id),
            source_topology_id: source_path_id,
        }),
        omit_from_graph: false,
    };
    let mut clone_id_map = AHashMap::default();
    clone_id_map.insert(ArtifactId::new(copy_face_id), cloned_face_id);
    clone_id_map.insert(ArtifactId::new(copy_cap_id), cloned_cap_id);
    clone_id_map.insert(ArtifactId::new(copy_edge_id), cloned_edge_id);
    clone_id_map.insert(source_wall_id, cloned_face_id);
    clone_id_map.insert(source_cap_id, cloned_cap_id);
    let entity_clone_id_maps = AHashMap::from_iter([(clone_id, clone_id_map)]);
    let ast = crate::parsing::parse_str("", ModuleId::default()).unwrap();
    let programs = crate::execution::ProgramLookup::new(ast, Default::default());

    let updated = artifacts_to_update(
        &artifacts,
        &artifact_command,
        &AHashMap::default(),
        &entity_clone_id_maps,
        &AHashMap::default(),
        &programs,
        0,
        &IndexMap::default(),
        &AHashMap::default(),
    )
    .unwrap();
    let Some(Artifact::Sweep(cloned_sweep)) = updated
        .iter()
        .find(|artifact| artifact.id() == ArtifactId::new(clone_id))
    else {
        panic!("Expected clone() to create a Sweep from the pattern copy");
    };
    assert_eq!(cloned_sweep.surface_ids, vec![cloned_face_id, cloned_cap_id]);
    assert_eq!(cloned_sweep.edge_ids, vec![cloned_edge_id]);
    assert_eq!(cloned_sweep.source_sweep_id, Some(ArtifactId::new(copy_id)));
    assert!(!cloned_sweep.consumed);
    assert!(updated.iter().any(|artifact| {
        matches!(
            artifact,
            Artifact::Wall(wall)
                if wall.id == cloned_face_id
                    && wall.sweep_id == ArtifactId::new(clone_id)
        )
    }));
    assert!(updated.iter().any(|artifact| {
        matches!(
            artifact,
            Artifact::Cap(cap)
                if cap.id == cloned_cap_id
                    && cap.sweep_id == ArtifactId::new(clone_id)
        )
    }));
}

#[test]
fn primitive_edge_does_not_replace_existing_segment_artifact() {
    let shared_id = ArtifactId::new(Uuid::new_v4());
    let path_id = ArtifactId::new(Uuid::new_v4());
    let solid_id = ArtifactId::new(Uuid::new_v4());

    let mut map = IndexMap::new();
    map.insert(
        shared_id,
        Artifact::Segment(Segment {
            id: shared_id,
            path_id,
            original_seg_id: None,
            surface_id: None,
            edge_ids: Vec::new(),
            edge_cut_id: None,
            code_ref: CodeRef::placeholder(SourceRange::synthetic()),
            common_surface_ids: Vec::new(),
        }),
    );

    merge_artifact_into_map(
        &mut map,
        Artifact::PrimitiveEdge(PrimitiveEdge {
            id: shared_id,
            solid_id,
            code_ref: CodeRef::placeholder(SourceRange::synthetic()),
        }),
    );

    assert!(matches!(map.get(&shared_id), Some(Artifact::Segment(_))));
}

#[test]
fn primitive_face_does_not_replace_existing_cap_artifact() {
    let shared_id = ArtifactId::new(Uuid::new_v4());
    let sweep_id = ArtifactId::new(Uuid::new_v4());
    let solid_id = ArtifactId::new(Uuid::new_v4());

    let mut map = IndexMap::new();
    map.insert(
        shared_id,
        Artifact::Cap(Cap {
            id: shared_id,
            sub_type: CapSubType::End,
            edge_cut_edge_ids: Vec::new(),
            sweep_id,
            path_ids: Vec::new(),
            face_code_ref: CodeRef::placeholder(SourceRange::synthetic()),
            cmd_id: Uuid::new_v4(),
        }),
    );

    merge_artifact_into_map(
        &mut map,
        Artifact::PrimitiveFace(PrimitiveFace {
            id: shared_id,
            solid_id,
            code_ref: CodeRef::placeholder(SourceRange::synthetic()),
        }),
    );

    assert!(matches!(map.get(&shared_id), Some(Artifact::Cap(_))));
}

#[test]
fn mirror_3d_artifacts_include_mirrored_body_with_face_and_edge_ids() {
    let path_id = ArtifactId::new(Uuid::new_v4());
    let source_sweep_id = ArtifactId::new(Uuid::new_v4());
    let mirrored_sweep_id = Uuid::new_v4();
    let face_one_id = Uuid::new_v4();
    let face_two_id = Uuid::new_v4();
    let edge_id = Uuid::new_v4();
    let code_ref = CodeRef::placeholder(SourceRange::synthetic());

    let mut artifacts = IndexMap::new();
    artifacts.insert(
        path_id,
        Artifact::Path(Path {
            id: path_id,
            sub_type: PathSubType::Region,
            plane_id: ArtifactId::new(Uuid::new_v4()),
            seg_ids: Vec::new(),
            consumed: true,
            sweep_id: Some(source_sweep_id),
            trajectory_sweep_id: None,
            solid2d_id: None,
            code_ref: CodeRef::placeholder(SourceRange::synthetic()),
            composite_solid_id: None,
            sketch_block_id: None,
            origin_path_id: None,
            inner_path_id: None,
            outer_path_id: None,
            pattern_ids: Vec::new(),
        }),
    );
    artifacts.insert(
        source_sweep_id,
        Artifact::Sweep(Sweep {
            id: source_sweep_id,
            sub_type: SweepSubType::Extrusion,
            path_id,
            surface_ids: Vec::new(),
            edge_ids: Vec::new(),
            code_ref,
            source_sweep_id: None,
            trajectory_id: None,
            method: kittycad_modeling_cmds::shared::ExtrudeMethod::Merge,
            consumed: false,
            pattern_ids: Vec::new(),
        }),
    );

    let cmd_id = Uuid::new_v4();
    let command = ModelingCmd::from(
        kcmc::each_cmd::EntityMirrorAcross::builder()
            .ids(vec![Uuid::from(path_id)])
            .across(kittycad_modeling_cmds::shared::MirrorAcross::Plane { id: Uuid::new_v4() })
            .build(),
    );
    let artifact_command = ArtifactCommand {
        cmd_id,
        range: SourceRange::synthetic(),
        command,
        entity_clone_info: None,
        omit_from_graph: false,
    };
    let mirror_response: kcmc::output::EntityMirrorAcross = serde_json::from_value(serde_json::json!({
        "entity_face_edge_ids": [
            {
                "object_id": mirrored_sweep_id,
                "faces": [face_one_id, face_two_id],
                "edges": [edge_id],
            }
        ]
    }))
    .expect("valid mirror response");
    let mut responses = AHashMap::default();
    responses.insert(cmd_id, OkModelingCmdResponse::EntityMirrorAcross(mirror_response));
    let ast = crate::parsing::parse_str("", ModuleId::default()).unwrap();
    let programs = crate::execution::ProgramLookup::new(ast, Default::default());

    let updated = artifacts_to_update(
        &artifacts,
        &artifact_command,
        &responses,
        &AHashMap::default(),
        &AHashMap::default(),
        &programs,
        0,
        &IndexMap::default(),
        &AHashMap::default(),
    )
    .unwrap();

    assert_eq!(updated.len(), 1);
    assert!(updated.iter().any(|artifact| {
        matches!(
            artifact,
            Artifact::Sweep(Sweep {
                id,
                surface_ids,
                edge_ids,
                ..
            }) if *id == ArtifactId::new(mirrored_sweep_id)
                && surface_ids == &vec![ArtifactId::new(face_one_id), ArtifactId::new(face_two_id)]
                && edge_ids == &vec![ArtifactId::new(edge_id)]
        )
    }));
}
