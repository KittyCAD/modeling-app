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
        types::{PrimitiveType, RuntimeType},
        ExecState, Geometry, KclValue, Sketch,
    },
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
        ]),
        exec_state,
    )?;

    let cloned = inner_clone(geometry, exec_state, args).await?;
    Ok(cloned.into())
}

/// Clone a sketch or solid.
///
/// This works essentially like a copy-paste operation.
///
/// ```no_run
/// exampleSketch = startSketchOn("XY")
///   |> startProfileAt([0, 0], %)
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
/// exampleSketch = startSketchOn("XY")
///   |> startProfileAt([0, 0], %)
///   |> line(end = [10, 0])
///   |> line(end = [0, 10])
///   |> line(end = [-10, 0])
///   |> close()
///
/// myPart = extrude(exampleSketch, length = 5)
/// clonedPart = clone(myPart)
///     |> translate(
///         x = 25.0,
///         y = 0.0,
///         z = 0,
///     )
/// ```
///
/// ```no_run
/// // Translate and rotate a cloned sketch to create a loft.
/// sketch001 = startSketchOn('XY')
///         |> startProfileAt([-10, 10], %)
///         |> xLine(length = 20)
///         |> yLine(length = -20)
///         |> xLine(length = -20)
///         |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
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
/// // You can reuse the tags from the original geometry with the cloned geometry.
///
/// sketch001 = startSketchOn(XY)
///   |> startProfileAt([0, 0], %)
///   |> line(end = [10, 0])
///   |> line(end = [0, 10], tag = $sketchingFace)
///   |> line(end = [-10, 0])
///   |> close()
///
/// sketch002 = clone(sketch001)
///     |> translate(x = 10, y = 20, z = 0)
///     |> extrude(length = 5)
///
/// startSketchOn(sketch002, sketchingFace)
///   |> startProfileAt([1, 1], %)
///   |> line(end = [8, 0])
///   |> line(end = [0, 8])
///   |> line(end = [-8, 0])
///   |> close(tag = $sketchingFace002)
///   |> extrude(length = 10)
/// ```
///
/// ```no_run
/// // You can also use the tags from the original geometry to fillet the cloned geometry.
/// width = 20
/// length = 10
/// thickness = 1
/// filletRadius = 2
///
/// mountingPlateSketch = startSketchOn("XY")
///   |> startProfileAt([-width/2, -length/2], %)
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
#[stdlib {
    name = "clone",
    feature_tree_operation = true,
    keywords = true,
    unlabeled_first = true,
    args = {
        geometry = { docs = "The sketch or solid to be cloned" },
    }
}]
async fn inner_clone(geometry: Geometry, exec_state: &mut ExecState, args: Args) -> Result<Geometry, KclError> {
    let new_id = exec_state.next_uuid();
    let old_id = geometry.id();

    let mut new_geometry = match &geometry {
        Geometry::Sketch(sketch) => {
            let mut new_sketch = sketch.clone();
            new_sketch.id = new_id;
            new_sketch.original_id = new_id;
            Geometry::Sketch(new_sketch)
        }
        Geometry::Solid(solid) => {
            let mut new_solid = solid.clone();
            new_solid.id = new_id;
            Geometry::Solid(new_solid)
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
    new_geometry: &mut Geometry,
    old_geometry_id: uuid::Uuid,
    exec_state: &mut ExecState,
    args: &Args,
) -> Result<()> {
    let new_geometry_id = new_geometry.id();
    let entity_id_map = get_old_new_child_map(new_geometry_id, old_geometry_id, exec_state, args).await?;

    // Fix the path references in the new geometry.
    match new_geometry {
        Geometry::Sketch(sketch) => {
            fix_sketch_tags_and_references(sketch, &entity_id_map).await?;
        }
        Geometry::Solid(solid) => {
            // Make the sketch id the new geometry id.
            solid.sketch.id = new_geometry_id;
            solid.sketch.original_id = new_geometry_id;

            fix_sketch_tags_and_references(&mut solid.sketch, &entity_id_map).await?;

            // Do the after extrude things to update those ids, based on the new sketch
            // information.
            let new_solid = do_post_extrude(
                &solid.sketch,
                new_geometry_id.into(),
                solid.height,
                solid.sectional,
                // TODO: fix these
                &NamedCapTags { start: None, end: None },
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
) -> Result<()> {
    // Fix the path references in the sketch.
    for path in &mut new_sketch.paths {
        let Some(new_path_id) = entity_id_map.get(&path.get_id()) else {
            anyhow::bail!("Failed to find new path id for old path id: {:?}", path.get_id());
        };
        path.set_id(*new_path_id);
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
