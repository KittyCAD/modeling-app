//! Standard library fillets.

use anyhow::Result;
use derive_docs::stdlib;
use kcmc::each_cmd as mcmd;
use kcmc::length_unit::LengthUnit;
use kcmc::ok_response::OkModelingCmdResponse;
use kcmc::websocket::OkWebSocketResponseData;
use kcmc::{shared::CutType, ModelingCmd};
use kittycad_modeling_cmds as kcmc;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{
    ast::types::TagDeclarator,
    errors::{KclError, KclErrorDetails},
    executor::{
        EdgeCut, ExecState, ExtrudeGroup, ExtrudeSurface, FilletSurface, GeoMeta, KclValue, TagIdentifier, UserVal,
    },
    settings::types::UnitLength,
    std::Args,
};

/// Data for fillets.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct FilletData {
    /// The radius of the fillet.
    pub radius: f64,
    /// The tags of the paths you want to fillet.
    pub tags: Vec<EdgeReference>,
    /// The tolerance for the fillet.
    #[serde(default)]
    pub tolerance: Option<f64>,
}

/// A tag or a uuid of an edge.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema, Eq, Ord, PartialOrd, Hash)]
#[ts(export)]
#[serde(untagged)]
pub enum EdgeReference {
    /// A uuid of an edge.
    Uuid(uuid::Uuid),
    /// A tag of an edge.
    Tag(Box<TagIdentifier>),
}

/// Create fillets on tagged paths.
pub async fn fillet(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let (data, extrude_group, tag): (FilletData, Box<ExtrudeGroup>, Option<TagDeclarator>) =
        args.get_data_and_extrude_group_and_tag()?;

    let extrude_group = inner_fillet(data, extrude_group, tag, exec_state, args).await?;
    Ok(KclValue::ExtrudeGroup(extrude_group))
}

/// Blend a transitional edge along a tagged path, smoothing the sharp edge.
///
/// Fillet is similar in function and use to a chamfer, except
/// a chamfer will cut a sharp transition along an edge while fillet
/// will smoothly blend the transition.
///
/// ```no_run
/// const width = 20
/// const length = 10
/// const thickness = 1
/// const filletRadius = 2
///
/// const mountingPlateSketch = startSketchOn("XY")
///   |> startProfileAt([-width/2, -length/2], %)
///   |> lineTo([width/2, -length/2], %, $edge1)
///   |> lineTo([width/2, length/2], %, $edge2)
///   |> lineTo([-width/2, length/2], %, $edge3)
///   |> close(%, $edge4)
///
/// const mountingPlate = extrude(thickness, mountingPlateSketch)
///   |> fillet({
///     radius: filletRadius,
///     tags: [
///       getNextAdjacentEdge(edge1),
///       getNextAdjacentEdge(edge2),
///       getNextAdjacentEdge(edge3),
///       getNextAdjacentEdge(edge4)
///     ],
///   }, %)
/// ```
///
/// ```no_run
/// const width = 20
/// const length = 10
/// const thickness = 1
/// const filletRadius = 1
///
/// const mountingPlateSketch = startSketchOn("XY")
///   |> startProfileAt([-width/2, -length/2], %)
///   |> lineTo([width/2, -length/2], %, $edge1)
///   |> lineTo([width/2, length/2], %, $edge2)
///   |> lineTo([-width/2, length/2], %, $edge3)
///   |> close(%, $edge4)
///
/// const mountingPlate = extrude(thickness, mountingPlateSketch)
///   |> fillet({
///     radius: filletRadius,
///     tolerance: 0.000001,
///     tags: [
///       getNextAdjacentEdge(edge1),
///       getNextAdjacentEdge(edge2),
///       getNextAdjacentEdge(edge3),
///       getNextAdjacentEdge(edge4)
///     ],
///   }, %)
/// ```
#[stdlib {
    name = "fillet",
}]
async fn inner_fillet(
    data: FilletData,
    extrude_group: Box<ExtrudeGroup>,
    tag: Option<TagDeclarator>,
    exec_state: &mut ExecState,
    args: Args,
) -> Result<Box<ExtrudeGroup>, KclError> {
    // Check if tags contains any duplicate values.
    let mut tags = data.tags.clone();
    tags.sort();
    tags.dedup();
    if tags.len() != data.tags.len() {
        return Err(KclError::Type(KclErrorDetails {
            message: "Duplicate tags are not allowed.".to_string(),
            source_ranges: vec![args.source_range],
        }));
    }

    let mut extrude_group = extrude_group.clone();
    let mut edge_cuts = Vec::new();
    for edge_tag in data.tags {
        let edge_id = match edge_tag {
            EdgeReference::Uuid(uuid) => uuid,
            EdgeReference::Tag(edge_tag) => args.get_tag_engine_info(exec_state, &edge_tag)?.id,
        };

        let id = uuid::Uuid::new_v4();
        args.batch_end_cmd(
            id,
            ModelingCmd::from(mcmd::Solid3dFilletEdge {
                edge_id,
                object_id: extrude_group.id,
                radius: LengthUnit(data.radius),
                tolerance: LengthUnit(data.tolerance.unwrap_or(default_tolerance(&args.ctx.settings.units))),
                cut_type: CutType::Fillet,
                face_id: None,
            }),
        )
        .await?;

        edge_cuts.push(EdgeCut::Fillet {
            id,
            edge_id,
            radius: data.radius,
            tag: Box::new(tag.clone()),
        });

        if let Some(ref tag) = tag {
            extrude_group.value.push(ExtrudeSurface::Fillet(FilletSurface {
                face_id: edge_id,
                tag: Some(tag.clone()),
                geo_meta: GeoMeta {
                    id,
                    metadata: args.source_range.into(),
                },
            }));
        }
    }

    extrude_group.edge_cuts = edge_cuts;

    Ok(extrude_group)
}

/// Get the opposite edge to the edge given.
pub async fn get_opposite_edge(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let tag: TagIdentifier = args.get_data()?;

    let edge = inner_get_opposite_edge(tag, exec_state, args.clone()).await?;
    Ok(KclValue::UserVal(UserVal {
        value: serde_json::to_value(edge).map_err(|e| {
            KclError::Type(KclErrorDetails {
                message: format!("Failed to convert Uuid to json: {}", e),
                source_ranges: vec![args.source_range],
            })
        })?,
        meta: vec![args.source_range.into()],
    }))
}

/// Get the opposite edge to the edge given.
///
/// ```no_run
/// const exampleSketch = startSketchOn('XZ')
///   |> startProfileAt([0, 0], %)
///   |> line([10, 0], %)
///   |> angledLine({
///     angle: 60,
///     length: 10,
///   }, %)
///   |> angledLine({
///     angle: 120,
///     length: 10,
///   }, %)
///   |> line([-10, 0], %)
///   |> angledLine({
///     angle: 240,
///     length: 10,
///   }, %, $referenceEdge)
///   |> close(%)
///
/// const example = extrude(5, exampleSketch)
///   |> fillet({
///     radius: 3,
///     tags: [getOppositeEdge(referenceEdge)],
///   }, %)
/// ```
#[stdlib {
    name = "getOppositeEdge",
}]
async fn inner_get_opposite_edge(tag: TagIdentifier, exec_state: &mut ExecState, args: Args) -> Result<Uuid, KclError> {
    if args.ctx.is_mock {
        return Ok(Uuid::new_v4());
    }
    let face_id = args.get_adjacent_face_to_tag(exec_state, &tag, false).await?;

    let tagged_path = args.get_tag_engine_info(exec_state, &tag)?;

    let resp = args
        .send_modeling_cmd(
            uuid::Uuid::new_v4(),
            ModelingCmd::from(mcmd::Solid3dGetOppositeEdge {
                edge_id: tagged_path.id,
                object_id: tagged_path.sketch_group,
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
    Ok(KclValue::UserVal(UserVal {
        value: serde_json::to_value(edge).map_err(|e| {
            KclError::Type(KclErrorDetails {
                message: format!("Failed to convert Uuid to json: {}", e),
                source_ranges: vec![args.source_range],
            })
        })?,
        meta: vec![args.source_range.into()],
    }))
}

/// Get the next adjacent edge to the edge given.
///
/// ```no_run
/// const exampleSketch = startSketchOn('XZ')
///   |> startProfileAt([0, 0], %)
///   |> line([10, 0], %)
///   |> angledLine({
///     angle: 60,
///     length: 10,
///   }, %)
///   |> angledLine({
///     angle: 120,
///     length: 10,
///   }, %)
///   |> line([-10, 0], %)
///   |> angledLine({
///     angle: 240,
///     length: 10,
///   }, %, $referenceEdge)
///   |> close(%)
///
/// const example = extrude(5, exampleSketch)
///   |> fillet({
///     radius: 3,
///     tags: [getNextAdjacentEdge(referenceEdge)],
///   }, %)
/// ```
#[stdlib {
    name = "getNextAdjacentEdge",
}]
async fn inner_get_next_adjacent_edge(
    tag: TagIdentifier,
    exec_state: &mut ExecState,
    args: Args,
) -> Result<Uuid, KclError> {
    if args.ctx.is_mock {
        return Ok(Uuid::new_v4());
    }
    let face_id = args.get_adjacent_face_to_tag(exec_state, &tag, false).await?;

    let tagged_path = args.get_tag_engine_info(exec_state, &tag)?;

    let resp = args
        .send_modeling_cmd(
            uuid::Uuid::new_v4(),
            ModelingCmd::from(mcmd::Solid3dGetNextAdjacentEdge {
                edge_id: tagged_path.id,
                object_id: tagged_path.sketch_group,
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
    Ok(KclValue::UserVal(UserVal {
        value: serde_json::to_value(edge).map_err(|e| {
            KclError::Type(KclErrorDetails {
                message: format!("Failed to convert Uuid to json: {}", e),
                source_ranges: vec![args.source_range],
            })
        })?,
        meta: vec![args.source_range.into()],
    }))
}

/// Get the previous adjacent edge to the edge given.
///
/// ```no_run
/// const exampleSketch = startSketchOn('XZ')
///   |> startProfileAt([0, 0], %)
///   |> line([10, 0], %)
///   |> angledLine({
///     angle: 60,
///     length: 10,
///   }, %)
///   |> angledLine({
///     angle: 120,
///     length: 10,
///   }, %)
///   |> line([-10, 0], %)
///   |> angledLine({
///     angle: 240,
///     length: 10,
///   }, %, $referenceEdge)
///   |> close(%)
///
/// const example = extrude(5, exampleSketch)
///   |> fillet({
///     radius: 3,
///     tags: [getPreviousAdjacentEdge(referenceEdge)],
///   }, %)
/// ```
#[stdlib {
    name = "getPreviousAdjacentEdge",
}]
async fn inner_get_previous_adjacent_edge(
    tag: TagIdentifier,
    exec_state: &mut ExecState,
    args: Args,
) -> Result<Uuid, KclError> {
    if args.ctx.is_mock {
        return Ok(Uuid::new_v4());
    }
    let face_id = args.get_adjacent_face_to_tag(exec_state, &tag, false).await?;

    let tagged_path = args.get_tag_engine_info(exec_state, &tag)?;

    let resp = args
        .send_modeling_cmd(
            uuid::Uuid::new_v4(),
            ModelingCmd::from(mcmd::Solid3dGetPrevAdjacentEdge {
                edge_id: tagged_path.id,
                object_id: tagged_path.sketch_group,
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
