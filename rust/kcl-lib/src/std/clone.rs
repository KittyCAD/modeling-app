//! Standard library clone.

use std::collections::HashMap;

use anyhow::Result;
use kcmc::{
    ModelingCmd, each_cmd as mcmd,
    ok_response::{OkModelingCmdResponse, output::EntityGetAllChildUuids},
    websocket::OkWebSocketResponseData,
};
use kittycad_modeling_cmds::{self as kcmc};

use super::extrude::do_post_extrude;
use crate::{
    errors::{KclError, KclErrorDetails},
    execution::{
        ExecState, GeometryWithImportedGeometry, KclValue, ModelingCmdMeta, Sketch, Solid,
        types::{NumericType, PrimitiveType, RuntimeType},
    },
    parsing::ast::types::TagNode,
    std::{Args, extrude::NamedCapTags},
};

/// Clone a sketch or solid.
///
/// This works essentially like a copy-paste operation.
pub async fn clone(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let geometry = args.get_unlabeled_kw_arg(
        "geometry",
        &RuntimeType::Union(vec![
            RuntimeType::Primitive(PrimitiveType::Sketch),
            RuntimeType::Primitive(PrimitiveType::Solid),
            RuntimeType::imported(),
        ]),
        exec_state,
    )?;

    let cloned = inner_clone(geometry, exec_state, args).await?;
    Ok(cloned.into())
}

async fn inner_clone(
    geometry: GeometryWithImportedGeometry,
    exec_state: &mut ExecState,
    args: Args,
) -> Result<GeometryWithImportedGeometry, KclError> {
    let new_id = exec_state.next_uuid();
    let mut geometry = geometry.clone();
    let old_id = geometry.id(&args.ctx).await?;

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
                .flush_batch_for_solids((&args).into(), &[solid.clone()])
                .await?;

            let mut new_solid = solid.clone();
            new_solid.id = new_id;
            new_solid.sketch.original_id = new_id;
            new_solid.artifact_id = new_id.into();
            GeometryWithImportedGeometry::Solid(new_solid)
        }
    };

    if args.ctx.no_engine_commands().await {
        return Ok(new_geometry);
    }

    exec_state
        .batch_modeling_cmd(
            ModelingCmdMeta::from_args_id(&args, new_id),
            ModelingCmd::from(mcmd::EntityClone { entity_id: old_id }),
        )
        .await?;

    fix_tags_and_references(&mut new_geometry, old_id, exec_state, &args)
        .await
        .map_err(|e| {
            KclError::new_internal(KclErrorDetails::new(
                format!("failed to fix tags and references: {e:?}"),
                vec![args.source_range],
            ))
        })?;

    Ok(new_geometry)
}
/// Fix the tags and references of the cloned geometry.
async fn fix_tags_and_references(
    new_geometry: &mut GeometryWithImportedGeometry,
    old_geometry_id: uuid::Uuid,
    exec_state: &mut ExecState,
    args: &Args,
) -> Result<()> {
    let new_geometry_id = new_geometry.id(&args.ctx).await?;
    let entity_id_map = get_old_new_child_map(new_geometry_id, old_geometry_id, exec_state, args).await?;

    // Fix the path references in the new geometry.
    match new_geometry {
        GeometryWithImportedGeometry::ImportedGeometry(_) => {}
        GeometryWithImportedGeometry::Sketch(sketch) => {
            fix_sketch_tags_and_references(sketch, &entity_id_map, exec_state).await?;
        }
        GeometryWithImportedGeometry::Solid(solid) => {
            // Make the sketch id the new geometry id.
            solid.sketch.id = new_geometry_id;
            solid.sketch.original_id = new_geometry_id;
            solid.sketch.artifact_id = new_geometry_id.into();

            fix_sketch_tags_and_references(&mut solid.sketch, &entity_id_map, exec_state).await?;

            let (start_tag, end_tag) = get_named_cap_tags(solid);

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
                &solid.sketch,
                new_geometry_id.into(),
                crate::std::args::TyF64::new(
                    solid.height,
                    NumericType::Known(crate::execution::types::UnitType::Length(solid.units)),
                ),
                solid.sectional,
                &NamedCapTags {
                    start: start_tag.as_ref(),
                    end: end_tag.as_ref(),
                },
                exec_state,
                args,
                None,
            )
            .await?;

            *solid = new_solid;
        }
    }

    Ok(())
}

async fn get_old_new_child_map(
    new_geometry_id: uuid::Uuid,
    old_geometry_id: uuid::Uuid,
    exec_state: &mut ExecState,
    args: &Args,
) -> Result<HashMap<uuid::Uuid, uuid::Uuid>> {
    // Get the old geometries entity ids.
    let response = exec_state
        .send_modeling_cmd(
            args.into(),
            ModelingCmd::from(mcmd::EntityGetAllChildUuids {
                entity_id: old_geometry_id,
            }),
        )
        .await?;
    let OkWebSocketResponseData::Modeling {
        modeling_response:
            OkModelingCmdResponse::EntityGetAllChildUuids(EntityGetAllChildUuids {
                entity_ids: old_entity_ids,
            }),
    } = response
    else {
        anyhow::bail!("Expected EntityGetAllChildUuids response, got: {:?}", response);
    };

    // Get the new geometries entity ids.
    let response = exec_state
        .send_modeling_cmd(
            args.into(),
            ModelingCmd::from(mcmd::EntityGetAllChildUuids {
                entity_id: new_geometry_id,
            }),
        )
        .await?;
    let OkWebSocketResponseData::Modeling {
        modeling_response:
            OkModelingCmdResponse::EntityGetAllChildUuids(EntityGetAllChildUuids {
                entity_ids: new_entity_ids,
            }),
    } = response
    else {
        anyhow::bail!("Expected EntityGetAllChildUuids response, got: {:?}", response);
    };

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

    // Fix the tags
    // This is annoying, in order to fix the tags we need to iterate over the paths again, but not
    // mutable borrow the paths.
    for path in new_sketch.paths.clone() {
        // Check if this path has a tag.
        if let Some(tag) = path.get_tag() {
            new_sketch.add_tag(&tag, &path, exec_state);
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
                start_tag = value.get_tag().clone();
                break;
            }
        }
    }

    // Check the end cap.
    if let Some(end_cap_id) = solid.end_cap_id {
        // Check if we had a value for that cap.
        for value in &solid.value {
            if value.get_id() == end_cap_id {
                end_tag = value.get_tag().clone();
                break;
            }
        }
    }

    (start_tag, end_tag)
}

#[cfg(test)]
mod tests {
    use pretty_assertions::{assert_eq, assert_ne};

    use crate::exec::KclValue;

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

        let KclValue::Sketch { value: cube } = cube else {
            panic!("Expected a sketch, got: {cube:?}");
        };
        let KclValue::Sketch { value: cloned_cube } = cloned_cube else {
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

        let KclValue::Solid { value: cube } = cube else {
            panic!("Expected a solid, got: {cube:?}");
        };
        let KclValue::Solid { value: cloned_cube } = cloned_cube else {
            panic!("Expected a solid, got: {cloned_cube:?}");
        };

        assert_ne!(cube.id, cloned_cube.id);
        assert_ne!(cube.sketch.id, cloned_cube.sketch.id);
        assert_ne!(cube.sketch.original_id, cloned_cube.sketch.original_id);
        assert_ne!(cube.artifact_id, cloned_cube.artifact_id);
        assert_ne!(cube.sketch.artifact_id, cloned_cube.sketch.artifact_id);

        assert_eq!(cloned_cube.artifact_id, cloned_cube.id.into());

        for (path, cloned_path) in cube.sketch.paths.iter().zip(cloned_cube.sketch.paths.iter()) {
            assert_ne!(path.get_id(), cloned_path.get_id());
            assert_eq!(path.get_tag(), cloned_path.get_tag());
        }

        for (value, cloned_value) in cube.value.iter().zip(cloned_cube.value.iter()) {
            assert_ne!(value.get_id(), cloned_value.get_id());
            assert_eq!(value.get_tag(), cloned_value.get_tag());
        }

        assert_eq!(cube.sketch.tags.len(), 0);
        assert_eq!(cloned_cube.sketch.tags.len(), 0);

        assert_eq!(cube.edge_cuts.len(), 0);
        assert_eq!(cloned_cube.edge_cuts.len(), 0);

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

        let KclValue::Sketch { value: cube } = cube else {
            panic!("Expected a sketch, got: {cube:?}");
        };
        let KclValue::Sketch { value: cloned_cube } = cloned_cube else {
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
            assert_ne!(tag_info.sketch, cloned_tag_info.sketch);
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
    |> extrude(length = 5) // TODO: Tag these

clonedCube = clone(cube)
"#;
        let ctx = crate::test_server::new_context(true, None).await.unwrap();
        let program = crate::Program::parse_no_errs(code).unwrap();

        // Execute the program.
        let result = ctx.run_with_caching(program.clone()).await.unwrap();
        let cube = result.variables.get("cube").unwrap();
        let cloned_cube = result.variables.get("clonedCube").unwrap();

        assert_ne!(cube, cloned_cube);

        let KclValue::Solid { value: cube } = cube else {
            panic!("Expected a solid, got: {cube:?}");
        };
        let KclValue::Solid { value: cloned_cube } = cloned_cube else {
            panic!("Expected a solid, got: {cloned_cube:?}");
        };

        assert_ne!(cube.id, cloned_cube.id);
        assert_ne!(cube.sketch.id, cloned_cube.sketch.id);
        assert_ne!(cube.sketch.original_id, cloned_cube.sketch.original_id);
        assert_ne!(cube.artifact_id, cloned_cube.artifact_id);
        assert_ne!(cube.sketch.artifact_id, cloned_cube.sketch.artifact_id);

        assert_eq!(cloned_cube.artifact_id, cloned_cube.id.into());

        for (path, cloned_path) in cube.sketch.paths.iter().zip(cloned_cube.sketch.paths.iter()) {
            assert_ne!(path.get_id(), cloned_path.get_id());
            assert_eq!(path.get_tag(), cloned_path.get_tag());
        }

        for (value, cloned_value) in cube.value.iter().zip(cloned_cube.value.iter()) {
            assert_ne!(value.get_id(), cloned_value.get_id());
            assert_eq!(value.get_tag(), cloned_value.get_tag());
        }

        for (tag_name, tag) in &cube.sketch.tags {
            let cloned_tag = cloned_cube.sketch.tags.get(tag_name).unwrap();

            let tag_info = tag.get_cur_info().unwrap();
            let cloned_tag_info = cloned_tag.get_cur_info().unwrap();

            assert_ne!(tag_info.id, cloned_tag_info.id);
            assert_ne!(tag_info.sketch, cloned_tag_info.sketch);
            assert_ne!(tag_info.path, cloned_tag_info.path);
            assert_ne!(tag_info.surface, cloned_tag_info.surface);
        }

        assert_eq!(cube.edge_cuts.len(), 0);
        assert_eq!(cloned_cube.edge_cuts.len(), 0);

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

        let KclValue::Solid { value: cube } = cube else {
            panic!("Expected a solid, got: {cube:?}");
        };
        let KclValue::Solid { value: cloned_cube } = cloned_cube else {
            panic!("Expected a solid, got: {cloned_cube:?}");
        };

        assert_ne!(cube.id, cloned_cube.id);
        assert_ne!(cube.sketch.id, cloned_cube.sketch.id);
        assert_ne!(cube.sketch.original_id, cloned_cube.sketch.original_id);
        assert_ne!(cube.artifact_id, cloned_cube.artifact_id);
        assert_ne!(cube.sketch.artifact_id, cloned_cube.sketch.artifact_id);

        assert_eq!(cloned_cube.artifact_id, cloned_cube.id.into());

        for (path, cloned_path) in cube.sketch.paths.iter().zip(cloned_cube.sketch.paths.iter()) {
            assert_ne!(path.get_id(), cloned_path.get_id());
            assert_eq!(path.get_tag(), cloned_path.get_tag());
        }

        for (value, cloned_value) in cube.value.iter().zip(cloned_cube.value.iter()) {
            assert_ne!(value.get_id(), cloned_value.get_id());
            assert_eq!(value.get_tag(), cloned_value.get_tag());
        }

        for (tag_name, tag) in &cube.sketch.tags {
            let cloned_tag = cloned_cube.sketch.tags.get(tag_name).unwrap();

            let tag_info = tag.get_cur_info().unwrap();
            let cloned_tag_info = cloned_tag.get_cur_info().unwrap();

            assert_ne!(tag_info.id, cloned_tag_info.id);
            assert_ne!(tag_info.sketch, cloned_tag_info.sketch);
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
    #[ignore] // until https://github.com/KittyCAD/engine/pull/3380 lands
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

        let KclValue::Solid { value: cube } = cube else {
            panic!("Expected a solid, got: {cube:?}");
        };
        let KclValue::Solid { value: cloned_cube } = cloned_cube else {
            panic!("Expected a solid, got: {cloned_cube:?}");
        };

        assert_ne!(cube.id, cloned_cube.id);
        assert_ne!(cube.sketch.id, cloned_cube.sketch.id);
        assert_ne!(cube.sketch.original_id, cloned_cube.sketch.original_id);
        assert_ne!(cube.artifact_id, cloned_cube.artifact_id);
        assert_ne!(cube.sketch.artifact_id, cloned_cube.sketch.artifact_id);

        assert_eq!(cloned_cube.artifact_id, cloned_cube.id.into());

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
