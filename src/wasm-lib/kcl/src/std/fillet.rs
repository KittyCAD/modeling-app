//! Standard library fillets.

use anyhow::Result;
use derive_docs::stdlib;
use kcmc::{
    each_cmd as mcmd, length_unit::LengthUnit, ok_response::OkModelingCmdResponse, shared::CutType,
    websocket::OkWebSocketResponseData, ModelingCmd,
};
use kittycad_modeling_cmds as kcmc;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::utils::unique_count;
use crate::{
    errors::{KclError, KclErrorDetails},
    execution::{EdgeCut, ExecState, ExtrudeSurface, FilletSurface, GeoMeta, KclValue, Solid, TagIdentifier},
    parsing::ast::types::TagNode,
    settings::types::UnitLength,
    std::Args,
};

/// A tag or a uuid of an edge.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema, Eq, Hash)]
#[ts(export)]
#[serde(untagged)]
pub enum EdgeReference {
    /// A uuid of an edge.
    Uuid(uuid::Uuid),
    /// A tag of an edge.
    Tag(Box<TagIdentifier>),
}

impl EdgeReference {
    pub fn get_engine_id(&self, exec_state: &mut ExecState, args: &Args) -> Result<uuid::Uuid, KclError> {
        match self {
            EdgeReference::Uuid(uuid) => Ok(*uuid),
            EdgeReference::Tag(tag) => Ok(args.get_tag_engine_info(exec_state, tag)?.id),
        }
    }
}

/// Create fillets on tagged paths.
pub async fn fillet(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let solid = args.get_unlabeled_kw_arg("solid")?;
    let radius = args.get_kw_arg("radius")?;
    let tolerance = args.get_kw_arg_opt("tolerance")?;
    let tags = args.get_kw_arg("tags")?;
    let tag = args.get_kw_arg_opt("tag")?;
    let value = inner_fillet(solid, radius, tags, tolerance, tag, exec_state, args).await?;
    Ok(KclValue::Solid { value })
}

/// Blend a transitional edge along a tagged path, smoothing the sharp edge.
///
/// Fillet is similar in function and use to a chamfer, except
/// a chamfer will cut a sharp transition along an edge while fillet
/// will smoothly blend the transition.
///
/// ```no_run
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
///   |> fillet(
///     radius = filletRadius,
///     tags = [
///       getNextAdjacentEdge(edge1),
///       getNextAdjacentEdge(edge2),
///       getNextAdjacentEdge(edge3),
///       getNextAdjacentEdge(edge4)
///     ],
///   )
/// ```
///
/// ```no_run
/// width = 20
/// length = 10
/// thickness = 1
/// filletRadius = 1
///
/// mountingPlateSketch = startSketchOn("XY")
///   |> startProfileAt([-width/2, -length/2], %)
///   |> line(endAbsolute = [width/2, -length/2], tag = $edge1)
///   |> line(endAbsolute = [width/2, length/2], tag = $edge2)
///   |> line(endAbsolute = [-width/2, length/2], tag = $edge3)
///   |> close(tag = $edge4)
///
/// mountingPlate = extrude(mountingPlateSketch, length = thickness)
///   |> fillet(
///     radius = filletRadius,
///     tolerance = 0.000001,
///     tags = [
///       getNextAdjacentEdge(edge1),
///       getNextAdjacentEdge(edge2),
///       getNextAdjacentEdge(edge3),
///       getNextAdjacentEdge(edge4)
///     ],
///   )
/// ```
#[stdlib {
    name = "fillet",
    feature_tree_operation = true,
    keywords = true,
    unlabeled_first = true,
    args = {
        solid = { docs = "The solid whose edges should be filletted" },
        radius = { docs = "The radius of the fillet" },
        tags = { docs = "The paths you want to fillet" },
        tolerance = { docs = "The tolerance for this fillet" },
        tag = { docs = "Create a new tag which refers to this fillet"},
    }
}]
async fn inner_fillet(
    solid: Box<Solid>,
    radius: f64,
    tags: Vec<EdgeReference>,
    tolerance: Option<f64>,
    tag: Option<TagNode>,
    exec_state: &mut ExecState,
    args: Args,
) -> Result<Box<Solid>, KclError> {
    // Check if tags contains any duplicate values.
    let unique_tags = unique_count(tags.clone());
    if unique_tags != tags.len() {
        return Err(KclError::Type(KclErrorDetails {
            message: "Duplicate tags are not allowed.".to_string(),
            source_ranges: vec![args.source_range],
        }));
    }

    let mut solid = solid.clone();
    for edge_tag in tags {
        let edge_id = edge_tag.get_engine_id(exec_state, &args)?;

        let id = exec_state.next_uuid();
        args.batch_end_cmd(
            id,
            ModelingCmd::from(mcmd::Solid3dFilletEdge {
                edge_id,
                object_id: solid.id,
                radius: LengthUnit(radius),
                tolerance: LengthUnit(tolerance.unwrap_or(default_tolerance(&args.ctx.settings.units))),
                cut_type: CutType::Fillet,
                // We make this a none so that we can remove it in the future.
                face_id: None,
            }),
        )
        .await?;

        solid.edge_cuts.push(EdgeCut::Fillet {
            id,
            edge_id,
            radius,
            tag: Box::new(tag.clone()),
        });

        if let Some(ref tag) = tag {
            solid.value.push(ExtrudeSurface::Fillet(FilletSurface {
                face_id: id,
                tag: Some(tag.clone()),
                geo_meta: GeoMeta {
                    id,
                    metadata: args.source_range.into(),
                },
            }));
        }
    }

    Ok(solid)
}

/// Get the opposite edge to the edge given.
pub async fn get_opposite_edge(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let tag: TagIdentifier = args.get_data()?;

    let edge = inner_get_opposite_edge(tag, exec_state, args.clone()).await?;
    Ok(KclValue::Uuid {
        value: edge,
        meta: vec![args.source_range.into()],
    })
}

/// Get the opposite edge to the edge given.
///
/// ```no_run
/// exampleSketch = startSketchOn('XZ')
///   |> startProfileAt([0, 0], %)
///   |> line(end = [10, 0])
///   |> angledLine({
///     angle = 60,
///     length = 10,
///   }, %)
///   |> angledLine({
///     angle = 120,
///     length = 10,
///   }, %)
///   |> line(end = [-10, 0])
///   |> angledLine({
///     angle = 240,
///     length = 10,
///   }, %, $referenceEdge)
///   |> close()
///
/// example = extrude(exampleSketch, length = 5)
///   |> fillet(
///     radius = 3,
///     tags = [getOppositeEdge(referenceEdge)],
///   )
/// ```
#[stdlib {
    name = "getOppositeEdge",
}]
async fn inner_get_opposite_edge(tag: TagIdentifier, exec_state: &mut ExecState, args: Args) -> Result<Uuid, KclError> {
    if args.ctx.no_engine_commands().await {
        return Ok(exec_state.next_uuid());
    }
    let face_id = args.get_adjacent_face_to_tag(exec_state, &tag, false).await?;

    let id = exec_state.next_uuid();
    let tagged_path = args.get_tag_engine_info(exec_state, &tag)?;

    let resp = args
        .send_modeling_cmd(
            id,
            ModelingCmd::from(mcmd::Solid3dGetOppositeEdge {
                edge_id: tagged_path.id,
                object_id: tagged_path.sketch,
                face_id,
            }),
        )
        .await?;
    let OkWebSocketResponseData::Modeling {
        modeling_response: OkModelingCmdResponse::Solid3dGetOppositeEdge(opposite_edge),
    } = &resp
    else {
        return Err(KclError::Engine(KclErrorDetails {
            message: format!("mcmd::Solid3dGetOppositeEdge response was not as expected: {:?}", resp),
            source_ranges: vec![args.source_range],
        }));
    };

    Ok(opposite_edge.edge)
}

/// Get the next adjacent edge to the edge given.
pub async fn get_next_adjacent_edge(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let tag: TagIdentifier = args.get_data()?;

    let edge = inner_get_next_adjacent_edge(tag, exec_state, args.clone()).await?;
    Ok(KclValue::Uuid {
        value: edge,
        meta: vec![args.source_range.into()],
    })
}

/// Get the next adjacent edge to the edge given.
///
/// ```no_run
/// exampleSketch = startSketchOn('XZ')
///   |> startProfileAt([0, 0], %)
///   |> line(end = [10, 0])
///   |> angledLine({
///     angle = 60,
///     length = 10,
///   }, %)
///   |> angledLine({
///     angle = 120,
///     length = 10,
///   }, %)
///   |> line(end = [-10, 0])
///   |> angledLine({
///     angle = 240,
///     length = 10,
///   }, %, $referenceEdge)
///   |> close()
///
/// example = extrude(exampleSketch, length = 5)
///   |> fillet(
///     radius = 3,
///     tags = [getNextAdjacentEdge(referenceEdge)],
///   )
/// ```
#[stdlib {
    name = "getNextAdjacentEdge",
}]
async fn inner_get_next_adjacent_edge(
    tag: TagIdentifier,
    exec_state: &mut ExecState,
    args: Args,
) -> Result<Uuid, KclError> {
    if args.ctx.no_engine_commands().await {
        return Ok(exec_state.next_uuid());
    }
    let face_id = args.get_adjacent_face_to_tag(exec_state, &tag, false).await?;

    let id = exec_state.next_uuid();
    let tagged_path = args.get_tag_engine_info(exec_state, &tag)?;

    let resp = args
        .send_modeling_cmd(
            id,
            ModelingCmd::from(mcmd::Solid3dGetNextAdjacentEdge {
                edge_id: tagged_path.id,
                object_id: tagged_path.sketch,
                face_id,
            }),
        )
        .await?;
    let OkWebSocketResponseData::Modeling {
        modeling_response: OkModelingCmdResponse::Solid3dGetNextAdjacentEdge(adjacent_edge),
    } = &resp
    else {
        return Err(KclError::Engine(KclErrorDetails {
            message: format!(
                "mcmd::Solid3dGetNextAdjacentEdge response was not as expected: {:?}",
                resp
            ),
            source_ranges: vec![args.source_range],
        }));
    };

    adjacent_edge.edge.ok_or_else(|| {
        KclError::Type(KclErrorDetails {
            message: format!("No edge found next adjacent to tag: `{}`", tag.value),
            source_ranges: vec![args.source_range],
        })
    })
}

/// Get the previous adjacent edge to the edge given.
pub async fn get_previous_adjacent_edge(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let tag: TagIdentifier = args.get_data()?;

    let edge = inner_get_previous_adjacent_edge(tag, exec_state, args.clone()).await?;
    Ok(KclValue::Uuid {
        value: edge,
        meta: vec![args.source_range.into()],
    })
}

/// Get the previous adjacent edge to the edge given.
///
/// ```no_run
/// exampleSketch = startSketchOn('XZ')
///   |> startProfileAt([0, 0], %)
///   |> line(end = [10, 0])
///   |> angledLine({
///     angle = 60,
///     length = 10,
///   }, %)
///   |> angledLine({
///     angle = 120,
///     length = 10,
///   }, %)
///   |> line(end = [-10, 0])
///   |> angledLine({
///     angle = 240,
///     length = 10,
///   }, %, $referenceEdge)
///   |> close()
///
/// example = extrude(exampleSketch, length = 5)
///   |> fillet(
///     radius = 3,
///     tags = [getPreviousAdjacentEdge(referenceEdge)],
///   )
/// ```
#[stdlib {
    name = "getPreviousAdjacentEdge",
}]
async fn inner_get_previous_adjacent_edge(
    tag: TagIdentifier,
    exec_state: &mut ExecState,
    args: Args,
) -> Result<Uuid, KclError> {
    if args.ctx.no_engine_commands().await {
        return Ok(exec_state.next_uuid());
    }
    let face_id = args.get_adjacent_face_to_tag(exec_state, &tag, false).await?;

    let id = exec_state.next_uuid();
    let tagged_path = args.get_tag_engine_info(exec_state, &tag)?;

    let resp = args
        .send_modeling_cmd(
            id,
            ModelingCmd::from(mcmd::Solid3dGetPrevAdjacentEdge {
                edge_id: tagged_path.id,
                object_id: tagged_path.sketch,
                face_id,
            }),
        )
        .await?;
    let OkWebSocketResponseData::Modeling {
        modeling_response: OkModelingCmdResponse::Solid3dGetPrevAdjacentEdge(adjacent_edge),
    } = &resp
    else {
        return Err(KclError::Engine(KclErrorDetails {
            message: format!(
                "mcmd::Solid3dGetPrevAdjacentEdge response was not as expected: {:?}",
                resp
            ),
            source_ranges: vec![args.source_range],
        }));
    };

    adjacent_edge.edge.ok_or_else(|| {
        KclError::Type(KclErrorDetails {
            message: format!("No edge found previous adjacent to tag: `{}`", tag.value),
            source_ranges: vec![args.source_range],
        })
    })
}

pub(crate) fn default_tolerance(units: &UnitLength) -> f64 {
    match units {
        UnitLength::Mm => 0.0000001,
        UnitLength::Cm => 0.0000001,
        UnitLength::In => 0.0000001,
        UnitLength::Ft => 0.0001,
        UnitLength::Yd => 0.001,
        UnitLength::M => 0.001,
    }
}
