//! Standard library clone.

use std::collections::HashMap;

use kcmc::ModelingCmd;
use kcmc::each_cmd as mcmd;
use kcmc::ok_response::OkModelingCmdResponse;
use kcmc::shared::BodyType;
use kcmc::websocket::OkWebSocketResponseData;
use kittycad_modeling_cmds::{self as kcmc};

use super::extrude::do_post_extrude;
use super::solid_consumption::is_consuming_operation_output;
use crate::errors::KclError;
use crate::errors::KclErrorDetails;
use crate::execution::EntityCloneInfo;
use crate::execution::ExecState;
use crate::execution::ExtrudeSurface;
use crate::execution::Geometry;
use crate::execution::GeometryWithImportedGeometry;
use crate::execution::KclValue;
use crate::execution::Metadata;
use crate::execution::ModelingCmdMeta;
use crate::execution::Sketch;
use crate::execution::Solid;
use crate::execution::TagEngineInfo;
use crate::execution::TagIdentifier;
use crate::execution::types::ArrayLen;
use crate::execution::types::PrimitiveType;
use crate::execution::types::RuntimeType;
use crate::parsing::ast::types::TagNode;
use crate::std::Args;
use crate::std::extrude::BeingExtruded;
use crate::std::extrude::NamedCapTags;

type Result<T> = std::result::Result<T, KclError>;

/// Clone a sketch or solid.
///
/// This works essentially like a copy-paste operation.
pub async fn clone(exec_state: &mut ExecState, args: Args) -> Result<KclValue> {
    let geometries = args.get_unlabeled_kw_arg(
        "geometry",
        &RuntimeType::Array(
            Box::new(RuntimeType::Union(vec![
                RuntimeType::Primitive(PrimitiveType::Sketch),
                RuntimeType::Primitive(PrimitiveType::Solid),
                RuntimeType::imported(),
            ])),
            ArrayLen::Minimum(1),
        ),
        exec_state,
    )?;

    let cloned = inner_clone(geometries, exec_state, args).await?;
    Ok(cloned.into())
}

async fn inner_clone(
    geometries: Vec<GeometryWithImportedGeometry>,
    exec_state: &mut ExecState,
    args: Args,
) -> Result<Vec<GeometryWithImportedGeometry>> {
    let mut res = vec![];

    for g in geometries {
        let new_id = exec_state.next_uuid();
        let mut geometry = g.clone();
        let old_id = geometry.id(&args.ctx).await?;
        // Pattern copies have a new top-level entity ID, but their KCL
        // geometry still describes the source topology. Map that source
        // topology directly to the clone so paths and tagged faces receive
        // the clone's child IDs.
        let source_topology_id = match &geometry {
            GeometryWithImportedGeometry::Sketch(sketch) => sketch.original_id,
            GeometryWithImportedGeometry::Solid(solid) => {
                if is_consuming_operation_output(solid, exec_state) {
                    solid.id
                } else {
                    solid.original_id()
                }
            }
            GeometryWithImportedGeometry::ImportedGeometry(_) => old_id,
        };
        let mut entity_clone_info = None;

        let mut new_geometry = match &geometry {
            GeometryWithImportedGeometry::ImportedGeometry(imported) => {
                let mut new_imported = imported.clone();
                new_imported.id = new_id;
                GeometryWithImportedGeometry::ImportedGeometry(new_imported)
            }
            GeometryWithImportedGeometry::Sketch(sketch) => {
                let mut new_sketch = sketch.clone();
                new_sketch.id = new_id;
                new_sketch.original_id = new_id;
                new_sketch.artifact_id = new_id.into();
                GeometryWithImportedGeometry::Sketch(new_sketch)
            }
            GeometryWithImportedGeometry::Solid(solid) => {
                // We flush before the clone so all the shit exists.
                exec_state
                    .flush_batch_for_solids(
                        ModelingCmdMeta::from_args(exec_state, &args),
                        std::slice::from_ref(solid),
                    )
                    .await?;

                let mut new_solid = solid.clone();
                // Sweep-backed solids normally have separate engine entity
                // and body artifact IDs. Preserve that split so the cloned
                // Path and Sweep can coexist. Bodies whose artifact is the
                // engine entity itself (including composites and pattern
                // copies) keep those IDs together.
                let source_entity_id = solid.id.into();
                let result_artifact_id = if solid.artifact_id == source_entity_id {
                    new_id.into()
                } else {
                    exec_state.next_artifact_id()
                };
                entity_clone_info = Some(EntityCloneInfo {
                    source_artifact_id: solid.artifact_id,
                    result_artifact_id,
                    source_topology_id: source_topology_id.into(),
                });
                new_solid.id = new_id;
                new_solid.value_id = new_id;
                if let Some(sketch) = new_solid.sketch_mut() {
                    sketch.original_id = new_id;
                }
                new_solid.artifact_id = result_artifact_id;
                GeometryWithImportedGeometry::Solid(new_solid)
            }
        };

        if args.ctx.no_engine_commands().await {
            res.push(new_geometry);
        } else {
            exec_state
                .batch_modeling_cmd_with_entity_clone_info(
                    ModelingCmdMeta::from_args_id(exec_state, &args, new_id),
                    ModelingCmd::from(mcmd::EntityClone::builder().entity_id(old_id).build()),
                    entity_clone_info,
                )
                .await?;

            fix_tags_and_references(&mut new_geometry, old_id, source_topology_id, exec_state, &args)
                .await
                .map_err(|e| {
                    KclError::new_internal(KclErrorDetails::new(
                        format!("failed to fix tags and references: {e:?}"),
                        vec![args.source_range],
                    ))
                })?;
            res.push(new_geometry)
        }
    }

    Ok(res)
}
/// Fix the tags and references of the cloned geometry.
pub(super) async fn fix_tags_and_references(
    new_geometry: &mut GeometryWithImportedGeometry,
    old_geometry_id: uuid::Uuid,
    source_topology_id: uuid::Uuid,
    exec_state: &mut ExecState,
    args: &Args,
) -> Result<()> {
    let new_geometry_id = new_geometry.id(&args.ctx).await?;
    let entity_id_map =
        get_old_new_child_map(new_geometry_id, old_geometry_id, source_topology_id, exec_state, args).await?;

    // Fix the path references in the new geometry.
    match new_geometry {
        GeometryWithImportedGeometry::ImportedGeometry(_) => {}
        GeometryWithImportedGeometry::Sketch(sketch) => {
            sketch.clone = Some(source_topology_id);
            fix_sketch_tags_and_references(sketch, &entity_id_map, exec_state, args, None).await?;
        }
        GeometryWithImportedGeometry::Solid(solid) => {
            let (start_tag, end_tag) = get_named_cap_tags(solid);
            let solid_value = solid.value.clone();
            let solid_artifact_id = solid.artifact_id;
            let old_face_tag_names = solid.faces.keys().cloned().collect::<Vec<_>>();

            // Make the sketch id the new geometry id.
            let sketch = solid.sketch_mut().ok_or_else(|| {
                KclError::new_type(KclErrorDetails::new(
                    "Cloning solids created without a sketch is not yet supported.".to_owned(),
                    vec![args.source_range],
                ))
            })?;
            sketch.id = new_geometry_id;
            sketch.original_id = new_geometry_id;
            sketch.artifact_id = new_geometry_id.into();
            sketch.clone = Some(source_topology_id);

            fix_sketch_tags_and_references(sketch, &entity_id_map, exec_state, args, Some(solid_value)).await?;
            let sketch_for_post = sketch.clone();

            // Fix the edge cuts.
            for edge_cut in solid.edge_cuts.iter_mut() {
                if let Some(id) = entity_id_map.get(&edge_cut.id()) {
                    edge_cut.set_id(*id);
                } else {
                    crate::log::logln!(
                        "Failed to find new edge cut id for old edge cut id: {:?}",
                        edge_cut.id()
                    );
                }
                if let Some(new_edge_id) = entity_id_map.get(&edge_cut.edge_id()) {
                    edge_cut.set_edge_id(*new_edge_id);
                } else {
                    crate::log::logln!("Failed to find new edge id for old edge id: {:?}", edge_cut.edge_id());
                }
            }

            // Do the after extrude things to update those ids, based on the new sketch
            // information.
            let new_solid = do_post_extrude(
                &sketch_for_post,
                solid_artifact_id,
                solid.sectional,
                &NamedCapTags {
                    start: start_tag.as_ref(),
                    end: end_tag.as_ref(),
                },
                kittycad_modeling_cmds::shared::ExtrudeMethod::New,
                exec_state,
                args,
                None,
                Some(&entity_id_map.clone()),
                BodyType::Solid, // TODO: Support surface clones.
                BeingExtruded::Sketch,
            )
            .await?;

            *solid = new_solid;

            restore_face_tags(solid, &old_face_tag_names, exec_state);
        }
    }

    Ok(())
}

/// Rebuild the face tag map of a cloned solid from its new surfaces.
///
/// [`do_post_extrude`] leaves `faces` empty, and we can't reuse the sketch's
/// tags like tagging at creation time does, because the cloned sketch still
/// carries the original solid's face info. Build fresh tag identifiers from
/// the new surfaces, which have the clone's face ids.
fn restore_face_tags(solid: &mut Solid, face_tag_names: &[String], exec_state: &ExecState) {
    let surfaces = solid.value.clone();
    for surface in surfaces {
        let Some(tag) = surface.get_tag() else {
            continue;
        };
        if !face_tag_names.iter().any(|tag_name| tag_name == &tag.name) {
            continue;
        }

        let mut solid_copy = solid.clone();
        if let Some(sketch) = solid_copy.sketch_mut() {
            // Avoid recursive tags.
            sketch.tags.clear();
        }
        solid_copy.faces.clear();

        let tag_id = TagIdentifier {
            value: tag.name.clone(),
            info: vec![(
                exec_state.stack().current_epoch(),
                TagEngineInfo {
                    id: surface.get_id(),
                    surface: Some(surface.clone()),
                    path: None,
                    geometry: Geometry::Solid(solid_copy),
                },
            )],
            meta: vec![Metadata {
                source_range: tag.clone().into(),
            }],
        };

        match solid.faces.get_mut(&tag.name) {
            Some(existing_tag) => existing_tag.merge_info(&tag_id),
            None => {
                solid.faces.insert(tag.name.clone(), tag_id);
            }
        }
    }

    for name in face_tag_names {
        if !solid.faces.contains_key(name) {
            crate::log::logln!("Failed to find new face for face tag: {name:?}");
        }
    }
}

async fn get_old_new_child_map(
    new_geometry_id: uuid::Uuid,
    old_geometry_id: uuid::Uuid,
    source_topology_id: uuid::Uuid,
    exec_state: &mut ExecState,
    args: &Args,
) -> Result<HashMap<uuid::Uuid, uuid::Uuid>> {
    // The artifact graph needs the pattern copy's own child IDs so it can
    // remap the materialized copy body. Runtime tags, however, still refer to
    // the source topology. Query both when those roots differ.
    if old_geometry_id != source_topology_id {
        let response = exec_state
            .send_modeling_cmd(
                ModelingCmdMeta::from_args(exec_state, args),
                ModelingCmd::from(
                    mcmd::EntityGetAllChildUuids::builder()
                        .entity_id(old_geometry_id)
                        .build(),
                ),
            )
            .await?;
        let OkWebSocketResponseData::Modeling {
            modeling_response: OkModelingCmdResponse::EntityGetAllChildUuids(_),
        } = &response
        else {
            return Err(KclError::new_engine(KclErrorDetails::new(
                format!("EntityGetAllChildUuids response was not as expected: {response:?}"),
                vec![args.source_range],
            )));
        };
    }

    // Get the old geometries entity ids.
    let response = exec_state
        .send_modeling_cmd(
            ModelingCmdMeta::from_args(exec_state, args),
            ModelingCmd::from(
                mcmd::EntityGetAllChildUuids::builder()
                    .entity_id(source_topology_id)
                    .build(),
            ),
        )
        .await?;
    let OkWebSocketResponseData::Modeling {
        modeling_response: OkModelingCmdResponse::EntityGetAllChildUuids(old_resp),
    } = response
    else {
        return Err(KclError::new_engine(KclErrorDetails::new(
            format!("EntityGetAllChildUuids response was not as expected: {response:?}"),
            vec![args.source_range],
        )));
    };
    let old_entity_ids = old_resp.entity_ids;

    // Get the new geometries entity ids.
    let response = exec_state
        .send_modeling_cmd(
            ModelingCmdMeta::from_args(exec_state, args),
            ModelingCmd::from(
                mcmd::EntityGetAllChildUuids::builder()
                    .entity_id(new_geometry_id)
                    .build(),
            ),
        )
        .await?;
    let OkWebSocketResponseData::Modeling {
        modeling_response: OkModelingCmdResponse::EntityGetAllChildUuids(new_resp),
    } = response
    else {
        return Err(KclError::new_engine(KclErrorDetails::new(
            format!("EntityGetAllChildUuids response was not as expected: {response:?}"),
            vec![args.source_range],
        )));
    };
    let new_entity_ids = new_resp.entity_ids;

    // Create a map of old entity ids to new entity ids.
    Ok(HashMap::from_iter(
        old_entity_ids
            .iter()
            .zip(new_entity_ids.iter())
            .map(|(old_id, new_id)| (*old_id, *new_id)),
    ))
}

/// Fix the tags and references of a sketch.
async fn fix_sketch_tags_and_references(
    new_sketch: &mut Sketch,
    entity_id_map: &HashMap<uuid::Uuid, uuid::Uuid>,
    exec_state: &mut ExecState,
    args: &Args,
    surfaces: Option<Vec<ExtrudeSurface>>,
) -> Result<()> {
    // Fix the path references in the sketch.
    for path in new_sketch.paths.as_mut_slice() {
        if let Some(new_path_id) = entity_id_map.get(&path.get_id()) {
            path.set_id(*new_path_id);
        } else {
            // We log on these because we might have already flushed and the id is no longer
            // relevant since filleted or something.
            crate::log::logln!("Failed to find new path id for old path id: {:?}", path.get_id());
        }
    }

    // Map the surface tags to the new surface ids.
    let mut surface_id_map: HashMap<String, &ExtrudeSurface> = HashMap::new();
    let surfaces = surfaces.unwrap_or_default();
    for surface in surfaces.iter() {
        if let Some(tag) = surface.get_tag() {
            surface_id_map.insert(tag.name.clone(), surface);
        }
    }

    // Fix the tags
    // This is annoying, in order to fix the tags we need to iterate over the paths again, but not
    // mutable borrow the paths.
    for path in new_sketch.paths.clone() {
        // Check if this path has a tag.
        if let Some(tag) = path.get_tag() {
            let mut surface = None;
            if let Some(found_surface) = surface_id_map.get(&tag.name) {
                let mut new_surface = (*found_surface).clone();
                let Some(new_face_id) = entity_id_map.get(&new_surface.face_id()).copied() else {
                    return Err(KclError::new_engine(KclErrorDetails::new(
                        format!(
                            "Failed to find new face id for old face id: {:?}",
                            new_surface.face_id()
                        ),
                        vec![args.source_range],
                    )));
                };
                new_surface.set_face_id(new_face_id);
                surface = Some(new_surface);
            }

            new_sketch.add_tag(&tag, &path, exec_state, surface.as_ref());
        }
    }

    // Fix the base path.
    if let Some(new_base_path) = entity_id_map.get(&new_sketch.start.geo_meta.id) {
        new_sketch.start.geo_meta.id = *new_base_path;
    } else {
        crate::log::logln!(
            "Failed to find new base path id for old base path id: {:?}",
            new_sketch.start.geo_meta.id
        );
    }

    Ok(())
}

// Return the named cap tags for the original solid.
fn get_named_cap_tags(solid: &Solid) -> (Option<TagNode>, Option<TagNode>) {
    let mut start_tag = None;
    let mut end_tag = None;
    // Check the start cap.
    if let Some(start_cap_id) = solid.start_cap_id {
        // Check if we had a value for that cap.
        for value in &solid.value {
            if value.get_id() == start_cap_id {
                start_tag = value.get_tag();
                break;
            }
        }
    }

    // Check the end cap.
    if let Some(end_cap_id) = solid.end_cap_id {
        // Check if we had a value for that cap.
        for value in &solid.value {
            if value.get_id() == end_cap_id {
                end_tag = value.get_tag();
                break;
            }
        }
    }

    (start_tag, end_tag)
}

#[cfg(test)]
mod tests {
    use pretty_assertions::assert_eq;
    use pretty_assertions::assert_ne;

    use crate::exec::KclValueView;
    use crate::execution::Artifact;
    use crate::execution::ArtifactId;

    // Ensure the clone function returns a sketch with different ids for all the internal paths and
    // the resulting sketch.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_clone_sketch() {
        let code = r#"cube = startSketchOn(XY)
    |> startProfile(at = [0,0])
    |> line(end = [0, 10])
    |> line(end = [10, 0])
    |> line(end = [0, -10])
    |> close()

clonedCube = clone(cube)
"#;
        let ctx = crate::test_server::new_context(true, None).await.unwrap();
        let program = crate::Program::parse_no_errs(code).unwrap();

        // Execute the program.
        let result = ctx.run_with_caching(program.clone()).await.unwrap();
        let cube = result.variables.get("cube").unwrap();
        let cloned_cube = result.variables.get("clonedCube").unwrap();

        assert_ne!(cube, cloned_cube);

        let KclValueView::Sketch { value: cube } = cube else {
            panic!("Expected a sketch, got: {cube:?}");
        };
        let KclValueView::Sketch { value: cloned_cube } = cloned_cube else {
            panic!("Expected a sketch, got: {cloned_cube:?}");
        };

        assert_ne!(cube.id, cloned_cube.id);
        assert_ne!(cube.original_id, cloned_cube.original_id);
        assert_ne!(cube.artifact_id, cloned_cube.artifact_id);

        assert_eq!(cloned_cube.artifact_id, cloned_cube.id.into());
        assert_eq!(cloned_cube.original_id, cloned_cube.id);

        for (path, cloned_path) in cube.paths.iter().zip(cloned_cube.paths.iter()) {
            assert_ne!(path.get_id(), cloned_path.get_id());
            assert_eq!(path.get_tag(), cloned_path.get_tag());
        }

        assert_eq!(cube.tags.len(), 0);
        assert_eq!(cloned_cube.tags.len(), 0);

        ctx.close().await;
    }

    // Ensure the clone function returns a solid with different ids for all the internal paths and
    // references.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_clone_solid() {
        let code = r#"cube = startSketchOn(XY)
    |> startProfile(at = [0,0])
    |> line(end = [0, 10])
    |> line(end = [10, 0])
    |> line(end = [0, -10])
    |> close()
    |> extrude(length = 5)

clonedCube = clone(cube)
"#;
        let ctx = crate::test_server::new_context(true, None).await.unwrap();
        let program = crate::Program::parse_no_errs(code).unwrap();

        // Execute the program.
        let result = ctx.run_with_caching(program.clone()).await.unwrap();
        let cube = result.variables.get("cube").unwrap();
        let cloned_cube = result.variables.get("clonedCube").unwrap();

        assert_ne!(cube, cloned_cube);

        let KclValueView::Solid { value: cube } = cube else {
            panic!("Expected a solid, got: {cube:?}");
        };
        let KclValueView::Solid { value: cloned_cube } = cloned_cube else {
            panic!("Expected a solid, got: {cloned_cube:?}");
        };
        let cube_sketch = cube.sketch().expect("Expected cube to have a sketch");
        let cloned_cube_sketch = cloned_cube.sketch().expect("Expected cloned cube to have a sketch");

        assert_ne!(cube.id, cloned_cube.id);
        assert_ne!(cube_sketch.id, cloned_cube_sketch.id);
        assert_ne!(cube_sketch.original_id, cloned_cube_sketch.original_id);
        assert_ne!(cube.artifact_id, cloned_cube.artifact_id);
        assert_ne!(cube_sketch.artifact_id, cloned_cube_sketch.artifact_id);

        assert_ne!(cloned_cube.artifact_id, cloned_cube.id.into());

        for (path, cloned_path) in cube_sketch.paths.iter().zip(cloned_cube_sketch.paths.iter()) {
            assert_ne!(path.get_id(), cloned_path.get_id());
            assert_eq!(path.get_tag(), cloned_path.get_tag());
        }

        for (value, cloned_value) in cube.value.iter().zip(cloned_cube.value.iter()) {
            assert_ne!(value.get_id(), cloned_value.get_id());
            assert_eq!(value.get_tag(), cloned_value.get_tag());
        }

        assert_eq!(cube_sketch.tags.len(), 0);
        assert_eq!(cloned_cube_sketch.tags.len(), 0);

        assert_eq!(cube.edge_cuts.len(), 0);
        assert_eq!(cloned_cube.edge_cuts.len(), 0);

        ctx.close().await;
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_clone_composite_solid_keeps_engine_artifact_id() {
        let code = r#"left = startSketchOn(XY)
    |> startProfile(at = [0, 0])
    |> line(end = [10, 0])
    |> line(end = [0, 10])
    |> line(end = [-10, 0])
    |> close()
    |> extrude(length = 5)

right = startSketchOn(XY)
    |> startProfile(at = [5, 0])
    |> line(end = [10, 0])
    |> line(end = [0, 10])
    |> line(end = [-10, 0])
    |> close()
    |> extrude(length = 5)

composite = union([left, right])
clonedComposite = clone(composite)
"#;
        let ctx = crate::test_server::new_context(true, None).await.unwrap();
        let program = crate::Program::parse_no_errs(code).unwrap();

        let result = ctx.run_with_caching(program).await.unwrap();
        let KclValueView::Solid { value: composite } = result.variables.get("composite").unwrap() else {
            panic!("Expected composite to be a solid");
        };
        let KclValueView::Solid {
            value: cloned_composite,
        } = result.variables.get("clonedComposite").unwrap()
        else {
            panic!("Expected clonedComposite to be a solid");
        };

        assert_eq!(composite.artifact_id, composite.id.into());
        assert_eq!(cloned_composite.artifact_id, cloned_composite.id.into());
        assert_ne!(composite.id, cloned_composite.id);
        assert_ne!(composite.original_id(), composite.id);
        assert_eq!(cloned_composite.original_id(), cloned_composite.id);

        let Some(Artifact::CompositeSolid(cloned_artifact)) = result.artifact_graph.get(&cloned_composite.artifact_id)
        else {
            panic!("Expected a cloned composite solid artifact at the engine entity ID");
        };
        assert_eq!(cloned_artifact.id, cloned_composite.artifact_id);
        assert!(!cloned_artifact.consumed);

        ctx.close().await;
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_clone_patterned_composite_uses_composite_topology() {
        let code = r#"left = startSketchOn(XY)
    |> startProfile(at = [0, 0])
    |> line(end = [10, 0])
    |> line(end = [0, 10])
    |> line(end = [-10, 0])
    |> close()
    |> extrude(length = 5)

right = startSketchOn(XY)
    |> startProfile(at = [5, 0])
    |> line(end = [10, 0])
    |> line(end = [0, 10])
    |> line(end = [-10, 0])
    |> close()
    |> extrude(length = 5)

composite = union([left, right])
patterned = patternLinear3d(
    composite,
    instances = 2,
    distance = 20,
    axis = [1, 0, 0],
)
patternCopy = patterned[1]
clonedCopy = clone(patternCopy)
"#;
        let ctx = crate::test_server::new_context(true, None).await.unwrap();
        let program = crate::Program::parse_no_errs(code).unwrap();

        let result = ctx.run_with_caching(program).await.unwrap();
        let KclValueView::Solid { value: composite } = result.variables.get("composite").unwrap() else {
            panic!("Expected composite to be a solid");
        };
        let KclValueView::Solid { value: pattern_copy } = result.variables.get("patternCopy").unwrap() else {
            panic!("Expected patternCopy to be a solid");
        };
        let KclValueView::Solid { value: cloned_copy } = result.variables.get("clonedCopy").unwrap() else {
            panic!("Expected clonedCopy to be a solid");
        };

        assert_eq!(pattern_copy.original_id(), composite.id);
        assert_eq!(cloned_copy.original_id(), cloned_copy.id);
        assert_eq!(cloned_copy.artifact_id, cloned_copy.id.into());
        assert_ne!(pattern_copy.id, cloned_copy.id);
        assert!(result.artifact_graph.get(&pattern_copy.artifact_id).is_none());
        assert!(matches!(
            result.artifact_graph.get(&cloned_copy.artifact_id),
            Some(Artifact::CompositeSolid(_))
        ));

        ctx.close().await;
    }

    // Ensure the clone function returns a sketch with different ids for all the internal paths and
    // the resulting sketch.
    // AND TAGS.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_clone_sketch_with_tags() {
        let code = r#"cube = startSketchOn(XY)
    |> startProfile(at = [0,0]) // tag this one
    |> line(end = [0, 10], tag = $tag02)
    |> line(end = [10, 0], tag = $tag03)
    |> line(end = [0, -10], tag = $tag04)
    |> close(tag = $tag05)

clonedCube = clone(cube)
"#;
        let ctx = crate::test_server::new_context(true, None).await.unwrap();
        let program = crate::Program::parse_no_errs(code).unwrap();

        // Execute the program.
        let result = ctx.run_with_caching(program.clone()).await.unwrap();
        let cube = result.variables.get("cube").unwrap();
        let cloned_cube = result.variables.get("clonedCube").unwrap();

        assert_ne!(cube, cloned_cube);

        let KclValueView::Sketch { value: cube } = cube else {
            panic!("Expected a sketch, got: {cube:?}");
        };
        let KclValueView::Sketch { value: cloned_cube } = cloned_cube else {
            panic!("Expected a sketch, got: {cloned_cube:?}");
        };

        assert_ne!(cube.id, cloned_cube.id);
        assert_ne!(cube.original_id, cloned_cube.original_id);

        for (path, cloned_path) in cube.paths.iter().zip(cloned_cube.paths.iter()) {
            assert_ne!(path.get_id(), cloned_path.get_id());
            assert_eq!(path.get_tag(), cloned_path.get_tag());
        }

        for (tag_name, tag) in &cube.tags {
            let cloned_tag = cloned_cube.tags.get(tag_name).unwrap();

            let tag_info = tag.get_cur_info().unwrap();
            let cloned_tag_info = cloned_tag.get_cur_info().unwrap();

            assert_ne!(tag_info.id, cloned_tag_info.id);
            assert_ne!(tag_info.geometry.id(), cloned_tag_info.geometry.id());
            assert_ne!(tag_info.path, cloned_tag_info.path);
            assert_eq!(tag_info.surface, None);
            assert_eq!(cloned_tag_info.surface, None);
        }

        ctx.close().await;
    }

    // Ensure the clone function returns a solid with different ids for all the internal paths and
    // references.
    // WITH TAGS.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_clone_solid_with_tags() {
        let code = r#"cube = startSketchOn(XY)
    |> startProfile(at = [0,0]) // tag this one
    |> line(end = [0, 10], tag = $tag02)
    |> line(end = [10, 0], tag = $tag03)
    |> line(end = [0, -10], tag = $tag04)
    |> close(tag = $tag05)
    |> extrude(length = 5, tagEnd = $endCap)

clonedCube = clone(cube)
"#;
        let ctx = crate::test_server::new_context(true, None).await.unwrap();
        let program = crate::Program::parse_no_errs(code).unwrap();

        // Execute the program.
        let result = ctx.run_with_caching(program.clone()).await.unwrap();
        let cube = result.variables.get("cube").unwrap();
        let cloned_cube = result.variables.get("clonedCube").unwrap();

        assert_ne!(cube, cloned_cube);

        let KclValueView::Solid { value: cube } = cube else {
            panic!("Expected a solid, got: {cube:?}");
        };
        let KclValueView::Solid { value: cloned_cube } = cloned_cube else {
            panic!("Expected a solid, got: {cloned_cube:?}");
        };
        let cube_sketch = cube.sketch().expect("Expected cube to have a sketch");
        let cloned_cube_sketch = cloned_cube.sketch().expect("Expected cloned cube to have a sketch");

        assert_ne!(cube.id, cloned_cube.id);
        assert_ne!(cube_sketch.id, cloned_cube_sketch.id);
        assert_ne!(cube_sketch.original_id, cloned_cube_sketch.original_id);
        assert_ne!(cube.artifact_id, cloned_cube.artifact_id);
        assert_ne!(cube_sketch.artifact_id, cloned_cube_sketch.artifact_id);

        assert_ne!(cloned_cube.artifact_id, cloned_cube.id.into());

        for (path, cloned_path) in cube_sketch.paths.iter().zip(cloned_cube_sketch.paths.iter()) {
            assert_ne!(path.get_id(), cloned_path.get_id());
            assert_eq!(path.get_tag(), cloned_path.get_tag());
        }

        for (value, cloned_value) in cube.value.iter().zip(cloned_cube.value.iter()) {
            assert_ne!(value.get_id(), cloned_value.get_id());
            assert_eq!(value.get_tag(), cloned_value.get_tag());
        }

        for (tag_name, tag) in &cube_sketch.tags {
            let cloned_tag = cloned_cube_sketch.tags.get(tag_name).unwrap();

            let tag_info = tag.get_cur_info().unwrap();
            let cloned_tag_info = cloned_tag.get_cur_info().unwrap();

            assert_ne!(tag_info.id, cloned_tag_info.id);
            assert_ne!(tag_info.geometry.id(), cloned_tag_info.geometry.id());
            assert_eq!(tag_info.path.is_some(), cloned_tag_info.path.is_some());
            if let (Some(path), Some(cloned_path)) = (&tag_info.path, &cloned_tag_info.path) {
                assert_ne!(path, cloned_path);
            }
            assert_eq!(tag_info.surface.is_some(), cloned_tag_info.surface.is_some());
            if let (Some(surface), Some(cloned_surface)) = (&tag_info.surface, &cloned_tag_info.surface) {
                assert_ne!(surface, cloned_surface);
            }
        }

        for (tag_name, tag) in &cube.faces {
            let cloned_tag = cloned_cube.faces.get(tag_name).unwrap();

            let tag_info = tag.get_cur_info().unwrap();
            let cloned_tag_info = cloned_tag.get_cur_info().unwrap();

            assert_ne!(tag_info.id, cloned_tag_info.id);
            assert_ne!(tag_info.geometry.id(), cloned_tag_info.geometry.id());
            assert_ne!(tag_info.surface, cloned_tag_info.surface);
        }
        assert!(cube.faces.contains_key("endCap"));
        assert!(cloned_cube.faces.contains_key("endCap"));

        assert_eq!(cube.edge_cuts.len(), 0);
        assert_eq!(cloned_cube.edge_cuts.len(), 0);

        ctx.close().await;
    }

    // Pattern copies retain the source topology in program memory. Cloning a
    // copy must map that source topology directly onto the clone so both wall
    // and cap tags refer to the clone's faces.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_clone_pattern_copy_with_face_tags() {
        let code = r#"source = startSketchOn(XY)
    |> startProfile(at = [0, 0])
    |> line(end = [0, 10], tag = $wall)
    |> line(end = [10, 0])
    |> line(end = [0, -10])
    |> close()
    |> extrude(length = 5, tagEnd = $endCap)

patterned = patternLinear3d(
    source,
    instances = 2,
    distance = 15,
    axis = [1, 0, 0],
)
patternCopy = patterned[1]
clonedCopy = clone(patternCopy)
"#;
        let program = crate::Program::parse_no_errs(code).unwrap();
        let ctx = crate::test_server::new_context(true, None).await.unwrap();

        let result = ctx.run_with_caching(program).await.unwrap();
        let source = result.variables.get("source").unwrap();
        let pattern_copy = result.variables.get("patternCopy").unwrap();
        let cloned_copy = result.variables.get("clonedCopy").unwrap();

        let KclValueView::Solid { value: source } = source else {
            panic!("Expected a solid, got: {source:?}");
        };
        let KclValueView::Solid { value: pattern_copy } = pattern_copy else {
            panic!("Expected a solid, got: {pattern_copy:?}");
        };
        let KclValueView::Solid { value: cloned_copy } = cloned_copy else {
            panic!("Expected a solid, got: {cloned_copy:?}");
        };
        let pattern_sketch = pattern_copy.sketch().expect("Expected pattern copy to have a sketch");
        let cloned_sketch = cloned_copy.sketch().expect("Expected cloned copy to have a sketch");
        assert_eq!(pattern_copy.original_id(), source.id);
        assert_eq!(cloned_copy.original_id(), cloned_copy.id);
        assert!(result.artifact_graph.get(&pattern_copy.artifact_id).is_none());

        let pattern_wall = pattern_sketch.tags.get("wall").unwrap().get_cur_info().unwrap();
        let cloned_wall = cloned_sketch.tags.get("wall").unwrap().get_cur_info().unwrap();
        assert_ne!(pattern_wall.id, cloned_wall.id);
        assert_ne!(pattern_wall.surface, cloned_wall.surface);
        let cloned_wall_id = ArtifactId::new(
            cloned_wall
                .surface
                .as_ref()
                .expect("Expected cloned wall tag to reference a surface")
                .face_id(),
        );

        let pattern_cap = pattern_copy.faces.get("endCap").unwrap().get_cur_info().unwrap();
        let cloned_cap = cloned_copy.faces.get("endCap").unwrap().get_cur_info().unwrap();
        assert_ne!(pattern_cap.id, cloned_cap.id);
        assert_ne!(pattern_cap.surface, cloned_cap.surface);
        let cloned_cap_id = ArtifactId::new(
            cloned_cap
                .surface
                .as_ref()
                .expect("Expected cloned cap tag to reference a surface")
                .face_id(),
        );

        assert!(matches!(
            result.artifact_graph.get(&cloned_copy.artifact_id),
            Some(Artifact::Sweep(_))
        ));
        assert!(matches!(
            result.artifact_graph.get(&cloned_wall_id),
            Some(Artifact::Wall(wall)) if wall.sweep_id == cloned_copy.artifact_id
        ));
        assert!(matches!(
            result.artifact_graph.get(&cloned_cap_id),
            Some(Artifact::Cap(cap)) if cap.sweep_id == cloned_copy.artifact_id
        ));

        ctx.close().await;
    }

    // Ensure we can get all paths even on a sketch where we closed it and it was already closed.
    #[tokio::test(flavor = "multi_thread")]
    #[ignore = "this test is not working yet, need to fix the getting of ids if sketch already closed"]
    async fn kcl_test_clone_cube_already_closed_sketch() {
        let code = r#"// Clone a basic solid and move it.

exampleSketch = startSketchOn(XY)
  |> startProfile(at = [0, 0])
  |> line(end = [10, 0])
  |> line(end = [0, 10])
  |> line(end = [-10, 0])
  |> line(end = [0, -10])
  |> close()

cube = extrude(exampleSketch, length = 5)
clonedCube = clone(cube)
    |> translate(
        x = 25.0,
    )"#;
        let ctx = crate::test_server::new_context(true, None).await.unwrap();
        let program = crate::Program::parse_no_errs(code).unwrap();

        // Execute the program.
        let result = ctx.run_with_caching(program.clone()).await.unwrap();
        let cube = result.variables.get("cube").unwrap();
        let cloned_cube = result.variables.get("clonedCube").unwrap();

        assert_ne!(cube, cloned_cube);

        let KclValueView::Solid { value: cube } = cube else {
            panic!("Expected a solid, got: {cube:?}");
        };
        let KclValueView::Solid { value: cloned_cube } = cloned_cube else {
            panic!("Expected a solid, got: {cloned_cube:?}");
        };
        let cube_sketch = cube.sketch().expect("Expected cube to have a sketch");
        let cloned_cube_sketch = cloned_cube.sketch().expect("Expected cloned cube to have a sketch");

        assert_ne!(cube.id, cloned_cube.id);
        assert_ne!(cube_sketch.id, cloned_cube_sketch.id);
        assert_ne!(cube_sketch.original_id, cloned_cube_sketch.original_id);
        assert_ne!(cube.artifact_id, cloned_cube.artifact_id);
        assert_ne!(cube_sketch.artifact_id, cloned_cube_sketch.artifact_id);

        assert_ne!(cloned_cube.artifact_id, cloned_cube.id.into());

        for (path, cloned_path) in cube_sketch.paths.iter().zip(cloned_cube_sketch.paths.iter()) {
            assert_ne!(path.get_id(), cloned_path.get_id());
            assert_eq!(path.get_tag(), cloned_path.get_tag());
        }

        for (value, cloned_value) in cube.value.iter().zip(cloned_cube.value.iter()) {
            assert_ne!(value.get_id(), cloned_value.get_id());
            assert_eq!(value.get_tag(), cloned_value.get_tag());
        }

        for (tag_name, tag) in &cube_sketch.tags {
            let cloned_tag = cloned_cube_sketch.tags.get(tag_name).unwrap();

            let tag_info = tag.get_cur_info().unwrap();
            let cloned_tag_info = cloned_tag.get_cur_info().unwrap();

            assert_ne!(tag_info.id, cloned_tag_info.id);
            assert_ne!(tag_info.geometry.id(), cloned_tag_info.geometry.id());
            assert_ne!(tag_info.path, cloned_tag_info.path);
            assert_ne!(tag_info.surface, cloned_tag_info.surface);
        }

        for (edge_cut, cloned_edge_cut) in cube.edge_cuts.iter().zip(cloned_cube.edge_cuts.iter()) {
            assert_ne!(edge_cut.id(), cloned_edge_cut.id());
            assert_ne!(edge_cut.edge_id(), cloned_edge_cut.edge_id());
            assert_eq!(edge_cut.tag(), cloned_edge_cut.tag());
        }

        ctx.close().await;
    }

    // Ensure the clone function returns a solid with different ids for all the internal paths and
    // references.
    // WITH TAGS AND EDGE CUTS.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_clone_solid_with_edge_cuts() {
        let code = r#"cube = startSketchOn(XY)
    |> startProfile(at = [0,0]) // tag this one
    |> line(end = [0, 10], tag = $tag02)
    |> line(end = [10, 0], tag = $tag03)
    |> line(end = [0, -10], tag = $tag04)
    |> close(tag = $tag05)
    |> extrude(length = 5) // TODO: Tag these
  |> fillet(
    radius = 2,
    tags = [
      getNextAdjacentEdge(tag02),
    ],
    tag = $fillet01,
  )
  |> fillet(
    radius = 2,
    tags = [
      getNextAdjacentEdge(tag04),
    ],
    tag = $fillet02,
  )
  |> chamfer(
    length = 2,
    tags = [
      getNextAdjacentEdge(tag03),
    ],
    tag = $chamfer01,
  )
  |> chamfer(
    length = 2,
    tags = [
      getNextAdjacentEdge(tag05),
    ],
    tag = $chamfer02,
  )

clonedCube = clone(cube)
"#;
        let ctx = crate::test_server::new_context(true, None).await.unwrap();
        let program = crate::Program::parse_no_errs(code).unwrap();

        // Execute the program.
        let result = ctx.run_with_caching(program.clone()).await.unwrap();
        let cube = result.variables.get("cube").unwrap();
        let cloned_cube = result.variables.get("clonedCube").unwrap();

        assert_ne!(cube, cloned_cube);

        let KclValueView::Solid { value: cube } = cube else {
            panic!("Expected a solid, got: {cube:?}");
        };
        let KclValueView::Solid { value: cloned_cube } = cloned_cube else {
            panic!("Expected a solid, got: {cloned_cube:?}");
        };
        let cube_sketch = cube.sketch().expect("Expected cube to have a sketch");
        let cloned_cube_sketch = cloned_cube.sketch().expect("Expected cloned cube to have a sketch");

        assert_ne!(cube.id, cloned_cube.id);
        assert_ne!(cube_sketch.id, cloned_cube_sketch.id);
        assert_ne!(cube_sketch.original_id, cloned_cube_sketch.original_id);
        assert_ne!(cube.artifact_id, cloned_cube.artifact_id);
        assert_ne!(cube_sketch.artifact_id, cloned_cube_sketch.artifact_id);

        assert_ne!(cloned_cube.artifact_id, cloned_cube.id.into());

        for (value, cloned_value) in cube.value.iter().zip(cloned_cube.value.iter()) {
            assert_ne!(value.get_id(), cloned_value.get_id());
            assert_eq!(value.get_tag(), cloned_value.get_tag());
        }

        for (edge_cut, cloned_edge_cut) in cube.edge_cuts.iter().zip(cloned_cube.edge_cuts.iter()) {
            assert_ne!(edge_cut.id(), cloned_edge_cut.id());
            assert_ne!(edge_cut.edge_id(), cloned_edge_cut.edge_id());
            assert_eq!(edge_cut.tag(), cloned_edge_cut.tag());
        }

        ctx.close().await;
    }
}
