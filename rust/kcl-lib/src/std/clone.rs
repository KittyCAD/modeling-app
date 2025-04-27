//! Standard library clone.

use std::collections::HashMap;

use anyhow::Result;
use kcl_derive_docs::stdlib;
use kcmc::{
    each_cmd as mcmd,
    ok_response::{output::EntityGetAllChildUuids, OkModelingCmdResponse},
    websocket::OkWebSocketResponseData,
    ModelingCmd,
};
use kittycad_modeling_cmds::{self as kcmc};

use super::extrude::do_post_extrude;
use crate::{
    errors::{KclError, KclErrorDetails},
    execution::{
        types::{NumericType, PrimitiveType, RuntimeType},
        ExecState, GeometryWithImportedGeometry, KclValue, Sketch, Solid,
    },
    parsing::ast::types::TagNode,
    std::{extrude::NamedCapTags, Args},
};

/// Clone a sketch or solid.
///
/// This works essentially like a copy-paste operation.
pub async fn clone(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let geometry = args.get_unlabeled_kw_arg_typed(
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

/// Clone a sketch or solid.
///
/// This works essentially like a copy-paste operation. It creates a perfect replica
/// at that point in time that you can manipulate individually afterwards.
///
/// This doesn't really have much utility unless you need the equivalent of a double
/// instance pattern with zero transformations.
///
/// Really only use this function if YOU ARE SURE you need it. In most cases you
/// do not need clone and using a pattern with `instance = 2` is more appropriate.
///
/// ```no_run
/// // Clone a basic sketch and move it and extrude it.
/// exampleSketch = startSketchOn(XY)
///   |> startProfile(at = [0, 0])
///   |> line(end = [10, 0])
///   |> line(end = [0, 10])
///   |> line(end = [-10, 0])
///   |> close()
///
/// clonedSketch = clone(exampleSketch)
///     |> scale(
///     x = 1.0,
///     y = 1.0,
///     z = 2.5,
///     )
///     |> translate(
///         x = 15.0,
///         y = 0,
///         z = 0,
///     )
///     |> extrude(length = 5)
/// ```
///
/// ```no_run
/// // Clone a basic solid and move it.
///
/// exampleSketch = startSketchOn(XY)
///   |> startProfile(at = [0, 0])
///   |> line(end = [10, 0])
///   |> line(end = [0, 10])
///   |> line(end = [-10, 0])
///   |> close()
///
/// myPart = extrude(exampleSketch, length = 5)
/// clonedPart = clone(myPart)
///     |> translate(
///         x = 25.0,
///     )
/// ```
///
/// ```no_run
/// // Translate and rotate a cloned sketch to create a loft.
///
/// sketch001 = startSketchOn(XY)
///         |> startProfile(at = [-10, 10])
///         |> xLine(length = 20)
///         |> yLine(length = -20)
///         |> xLine(length = -20)
///         |> close()
///
/// sketch002 = clone(sketch001)
///     |> translate(x = 0, y = 0, z = 20)
///     |> rotate(axis = [0, 0, 1.0], angle = 45)
///
/// loft([sketch001, sketch002])
/// ```
///
/// ```no_run
/// // Translate a cloned solid. Fillet only the clone.
///
/// sketch001 = startSketchOn(XY)
///         |> startProfile(at = [-10, 10])
///         |> xLine(length = 20)
///         |> yLine(length = -20)
///         |> xLine(length = -20, tag = $filletTag)
///         |> close()
///         |> extrude(length = 5)
///
///
/// sketch002 = clone(sketch001)
///     |> translate(x = 0, y = 0, z = 20)
///     |> fillet(
///     radius = 2,
///     tags = [getNextAdjacentEdge(filletTag)],
///     )
/// ```
///
/// ```no_run
/// // You can reuse the tags from the original geometry with the cloned geometry.
///
/// sketch001 = startSketchOn(XY)
///   |> startProfile(at = [0, 0])
///   |> line(end = [10, 0])
///   |> line(end = [0, 10], tag = $sketchingFace)
///   |> line(end = [-10, 0])
///   |> close()
///
/// sketch002 = clone(sketch001)
///     |> translate(x = 10, y = 20, z = 0)
///     |> extrude(length = 5)
///
/// startSketchOn(sketch002, face = sketchingFace)
///   |> startProfile(at = [1, 1])
///   |> line(end = [8, 0])
///   |> line(end = [0, 8])
///   |> line(end = [-8, 0])
///   |> close(tag = $sketchingFace002)
///   |> extrude(length = 10)
/// ```
///
/// ```no_run
/// // You can also use the tags from the original geometry to fillet the cloned geometry.
///
/// width = 20
/// length = 10
/// thickness = 1
/// filletRadius = 2
///
/// mountingPlateSketch = startSketchOn(XY)
///   |> startProfile(at = [-width/2, -length/2])
///   |> line(endAbsolute = [width/2, -length/2], tag = $edge1)
///   |> line(endAbsolute = [width/2, length/2], tag = $edge2)
///   |> line(endAbsolute = [-width/2, length/2], tag = $edge3)
///   |> close(tag = $edge4)
///
/// mountingPlate = extrude(mountingPlateSketch, length = thickness)
///
/// clonedMountingPlate = clone(mountingPlate)
///   |> fillet(
///     radius = filletRadius,
///     tags = [
///       getNextAdjacentEdge(edge1),
///       getNextAdjacentEdge(edge2),
///       getNextAdjacentEdge(edge3),
///       getNextAdjacentEdge(edge4)
///     ],
///   )
///   |> translate(x = 0, y = 50, z = 0)
/// ```
///
/// ```no_run
/// // Create a spring by sweeping around a helix path from a cloned sketch.
///
/// // Create a helix around the Z axis.
/// helixPath = helix(
///     angleStart = 0,
///     ccw = true,
///     revolutions = 4,
///     length = 10,
///     radius = 5,
///     axis = Z,
///  )
///
///
/// springSketch = startSketchOn(YZ)
///     |> circle( center = [0, 0], radius = 1)
///
/// // Create a spring by sweeping around the helix path.
/// sweepedSpring = clone(springSketch)
///     |> translate(x=100)
///     |> sweep(path = helixPath)
/// ```
///
/// ```
/// // A donut shape from a cloned sketch.
/// sketch001 = startSketchOn(XY)
///     |> circle( center = [15, 0], radius = 5 )
///
/// sketch002 = clone(sketch001)
///    |> translate( z = 30)
///     |> revolve(
///         angle = 360,
///         axis = Y,
///     )
/// ```
///
/// ```no_run
/// // Sketch on the end of a revolved face by tagging the end face.
/// // This shows the cloned geometry will have the same tags as the original geometry.
///
/// exampleSketch = startSketchOn(XY)
///   |> startProfile(at = [4, 12])
///   |> line(end = [2, 0])
///   |> line(end = [0, -6])
///   |> line(end = [4, -6])
///   |> line(end = [0, -6])
///   |> line(end = [-3.75, -4.5])
///   |> line(end = [0, -5.5])
///   |> line(end = [-2, 0])
///   |> close()
///
/// example001 = revolve(exampleSketch, axis = Y, angle = 180, tagEnd = $end01)
///
/// // example002 = clone(example001)
/// // |> translate(x = 0, y = 20, z = 0)
///
/// // Sketch on the cloned face.
/// // exampleSketch002 = startSketchOn(example002, face = end01)
/// //  |> startProfile(at = [4.5, -5])
/// //  |> line(end = [0, 5])
/// //  |> line(end = [5, 0])
/// //  |> line(end = [0, -5])
/// //  |> close()
///
/// // example003 = extrude(exampleSketch002, length = 5)
/// ```
///
/// ```no_run
/// // Clone an imported model.
///
/// import "tests/inputs/cube.sldprt" as cube
///
/// myCube = cube
///
/// clonedCube = clone(myCube)
///    |> translate(
///    x = 1020,
///    )
///    |> appearance(
///        color = "#ff0000",
///        metalness = 50,
///        roughness = 50
///    )
/// ```
#[stdlib {
    name = "clone",
    feature_tree_operation = true,
    keywords = true,
    unlabeled_first = true,
    args = {
        geometry = { docs = "The sketch, solid, or imported geometry to be cloned" },
    }
}]
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
            #[cfg(feature = "artifact-graph")]
            {
                new_sketch.artifact_id = new_id.into();
            }
            GeometryWithImportedGeometry::Sketch(new_sketch)
        }
        GeometryWithImportedGeometry::Solid(solid) => {
            let mut new_solid = solid.clone();
            new_solid.id = new_id;
            new_solid.sketch.original_id = new_id;
            #[cfg(feature = "artifact-graph")]
            {
                new_solid.artifact_id = new_id.into();
            }
            GeometryWithImportedGeometry::Solid(new_solid)
        }
    };

    if args.ctx.no_engine_commands().await {
        return Ok(new_geometry);
    }

    args.batch_modeling_cmd(new_id, ModelingCmd::from(mcmd::EntityClone { entity_id: old_id }))
        .await?;

    fix_tags_and_references(&mut new_geometry, old_id, exec_state, &args)
        .await
        .map_err(|e| {
            KclError::Internal(KclErrorDetails {
                message: format!("failed to fix tags and references: {:?}", e),
                source_ranges: vec![args.source_range],
            })
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
            #[cfg(feature = "artifact-graph")]
            {
                solid.sketch.artifact_id = new_geometry_id.into();
            }

            fix_sketch_tags_and_references(&mut solid.sketch, &entity_id_map, exec_state).await?;

            let (start_tag, end_tag) = get_named_cap_tags(solid);

            // Fix the edge cuts.
            for edge_cut in solid.edge_cuts.iter_mut() {
                let Some(new_edge_id) = entity_id_map.get(&edge_cut.edge_id()) else {
                    anyhow::bail!("Failed to find new edge id for old edge id: {:?}", edge_cut.edge_id());
                };
                edge_cut.set_edge_id(*new_edge_id);
                let Some(id) = entity_id_map.get(&edge_cut.id()) else {
                    anyhow::bail!(
                        "Failed to find new edge cut id for old edge cut id: {:?}",
                        edge_cut.id()
                    );
                };
                edge_cut.set_id(*id);
            }

            // Do the after extrude things to update those ids, based on the new sketch
            // information.
            let new_solid = do_post_extrude(
                &solid.sketch,
                #[cfg(feature = "artifact-graph")]
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
    // Get the new geometries entity ids.
    let response = args
        .send_modeling_cmd(
            exec_state.next_uuid(),
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

    // Get the old geometries entity ids.
    let response = args
        .send_modeling_cmd(
            exec_state.next_uuid(),
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
        let Some(new_path_id) = entity_id_map.get(&path.get_id()) else {
            anyhow::bail!("Failed to find new path id for old path id: {:?}", path.get_id());
        };
        path.set_id(*new_path_id);
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
    // TODO: Right now this one does not work, ignore for now and see if we really need it.
    /* let Some(new_base_path) = entity_id_map.get(&new_sketch.start.geo_meta.id) else {
        anyhow::bail!(
            "Failed to find new base path id for old base path id: {:?}",
            new_sketch.start.geo_meta.id
        );
    };
    new_sketch.start.geo_meta.id = *new_base_path;*/

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
            panic!("Expected a sketch, got: {:?}", cube);
        };
        let KclValue::Sketch { value: cloned_cube } = cloned_cube else {
            panic!("Expected a sketch, got: {:?}", cloned_cube);
        };

        assert_ne!(cube.id, cloned_cube.id);
        assert_ne!(cube.original_id, cloned_cube.original_id);
        #[cfg(feature = "artifact-graph")]
        assert_ne!(cube.artifact_id, cloned_cube.artifact_id);

        #[cfg(feature = "artifact-graph")]
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
            panic!("Expected a solid, got: {:?}", cube);
        };
        let KclValue::Solid { value: cloned_cube } = cloned_cube else {
            panic!("Expected a solid, got: {:?}", cloned_cube);
        };

        assert_ne!(cube.id, cloned_cube.id);
        assert_ne!(cube.sketch.id, cloned_cube.sketch.id);
        assert_ne!(cube.sketch.original_id, cloned_cube.sketch.original_id);
        #[cfg(feature = "artifact-graph")]
        assert_ne!(cube.artifact_id, cloned_cube.artifact_id);
        #[cfg(feature = "artifact-graph")]
        assert_ne!(cube.sketch.artifact_id, cloned_cube.sketch.artifact_id);

        #[cfg(feature = "artifact-graph")]
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
            panic!("Expected a sketch, got: {:?}", cube);
        };
        let KclValue::Sketch { value: cloned_cube } = cloned_cube else {
            panic!("Expected a sketch, got: {:?}", cloned_cube);
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
            panic!("Expected a solid, got: {:?}", cube);
        };
        let KclValue::Solid { value: cloned_cube } = cloned_cube else {
            panic!("Expected a solid, got: {:?}", cloned_cube);
        };

        assert_ne!(cube.id, cloned_cube.id);
        assert_ne!(cube.sketch.id, cloned_cube.sketch.id);
        assert_ne!(cube.sketch.original_id, cloned_cube.sketch.original_id);
        #[cfg(feature = "artifact-graph")]
        assert_ne!(cube.artifact_id, cloned_cube.artifact_id);
        #[cfg(feature = "artifact-graph")]
        assert_ne!(cube.sketch.artifact_id, cloned_cube.sketch.artifact_id);

        #[cfg(feature = "artifact-graph")]
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
            panic!("Expected a solid, got: {:?}", cube);
        };
        let KclValue::Solid { value: cloned_cube } = cloned_cube else {
            panic!("Expected a solid, got: {:?}", cloned_cube);
        };

        assert_ne!(cube.id, cloned_cube.id);
        assert_ne!(cube.sketch.id, cloned_cube.sketch.id);
        assert_ne!(cube.sketch.original_id, cloned_cube.sketch.original_id);
        #[cfg(feature = "artifact-graph")]
        assert_ne!(cube.artifact_id, cloned_cube.artifact_id);
        #[cfg(feature = "artifact-graph")]
        assert_ne!(cube.sketch.artifact_id, cloned_cube.sketch.artifact_id);

        #[cfg(feature = "artifact-graph")]
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
    #[ignore = "this test is not working yet, need to fix the edge cut ids"]
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
            panic!("Expected a solid, got: {:?}", cube);
        };
        let KclValue::Solid { value: cloned_cube } = cloned_cube else {
            panic!("Expected a solid, got: {:?}", cloned_cube);
        };

        assert_ne!(cube.id, cloned_cube.id);
        assert_ne!(cube.sketch.id, cloned_cube.sketch.id);
        assert_ne!(cube.sketch.original_id, cloned_cube.sketch.original_id);
        #[cfg(feature = "artifact-graph")]
        assert_ne!(cube.artifact_id, cloned_cube.artifact_id);
        #[cfg(feature = "artifact-graph")]
        assert_ne!(cube.sketch.artifact_id, cloned_cube.sketch.artifact_id);

        #[cfg(feature = "artifact-graph")]
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
}
