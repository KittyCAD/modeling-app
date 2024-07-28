//! Standard library fillets.

use anyhow::Result;
use derive_docs::stdlib;
use kittycad::types::ModelingCmd;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{
    errors::{KclError, KclErrorDetails},
    executor::{ExtrudeGroup, FilletOrChamfer, MemoryItem, TagIdentifier, UserVal},
    std::Args,
};

pub(crate) const DEFAULT_TOLERANCE: f64 = 0.0000001;

/// Data for fillets.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct FilletData {
    /// The radius of the fillet.
    pub radius: f64,
    /// The tags of the paths you want to fillet.
    pub tags: Vec<EdgeReference>,
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
pub async fn fillet(args: Args) -> Result<MemoryItem, KclError> {
    let (data, extrude_group): (FilletData, Box<ExtrudeGroup>) = args.get_data_and_extrude_group()?;

    let extrude_group = inner_fillet(data, extrude_group, args).await?;
    Ok(MemoryItem::ExtrudeGroup(extrude_group))
}

/// Create fillets on tagged paths.
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
#[stdlib {
    name = "fillet",
}]
async fn inner_fillet(
    data: FilletData,
    extrude_group: Box<ExtrudeGroup>,
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

    let mut fillet_or_chamfers = Vec::new();
    for tag in data.tags {
        let edge_id = match tag {
            EdgeReference::Uuid(uuid) => uuid,
            EdgeReference::Tag(edge_tag) => args.get_tag_engine_info(&edge_tag)?.id,
        };

        let id = uuid::Uuid::new_v4();
        args.batch_end_cmd(
            id,
            ModelingCmd::Solid3DFilletEdge {
                edge_id,
                object_id: extrude_group.id,
                radius: data.radius,
                tolerance: DEFAULT_TOLERANCE, // We can let the user set this in the future.
                cut_type: Some(kittycad::types::CutType::Fillet),
            },
        )
        .await?;

        fillet_or_chamfers.push(FilletOrChamfer::Fillet {
            id,
            edge_id,
            radius: data.radius,
        });
    }

    let mut extrude_group = extrude_group.clone();
    extrude_group.fillet_or_chamfers = fillet_or_chamfers;

    Ok(extrude_group)
}

/// Get the opposite edge to the edge given.
pub async fn get_opposite_edge(args: Args) -> Result<MemoryItem, KclError> {
    let tag: TagIdentifier = args.get_data()?;

    let edge = inner_get_opposite_edge(tag, args.clone()).await?;
    Ok(MemoryItem::UserVal(UserVal {
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
async fn inner_get_opposite_edge(tag: TagIdentifier, args: Args) -> Result<Uuid, KclError> {
    if args.ctx.is_mock {
        return Ok(Uuid::new_v4());
    }
    let tagged_path = args.get_tag_engine_info(&tag)?;

    let face_id = args.get_adjacent_face_to_tag(&tag, false).await?;

    let resp = args
        .send_modeling_cmd(
            uuid::Uuid::new_v4(),
            ModelingCmd::Solid3DGetOppositeEdge {
                edge_id: tagged_path.id,
                object_id: tagged_path.sketch_group,
                face_id,
            },
        )
        .await?;
    let kittycad::types::OkWebSocketResponseData::Modeling {
        modeling_response: kittycad::types::OkModelingCmdResponse::Solid3DGetOppositeEdge { data: opposite_edge },
    } = &resp
    else {
        return Err(KclError::Engine(KclErrorDetails {
            message: format!("Solid3DGetOppositeEdge response was not as expected: {:?}", resp),
            source_ranges: vec![args.source_range],
        }));
    };

    Ok(opposite_edge.edge)
}

/// Get the next adjacent edge to the edge given.
pub async fn get_next_adjacent_edge(args: Args) -> Result<MemoryItem, KclError> {
    let tag: TagIdentifier = args.get_data()?;

    let edge = inner_get_next_adjacent_edge(tag, args.clone()).await?;
    Ok(MemoryItem::UserVal(UserVal {
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
async fn inner_get_next_adjacent_edge(tag: TagIdentifier, args: Args) -> Result<Uuid, KclError> {
    if args.ctx.is_mock {
        return Ok(Uuid::new_v4());
    }
    let tagged_path = args.get_tag_engine_info(&tag)?;

    let face_id = args.get_adjacent_face_to_tag(&tag, false).await?;

    let resp = args
        .send_modeling_cmd(
            uuid::Uuid::new_v4(),
            ModelingCmd::Solid3DGetPrevAdjacentEdge {
                edge_id: tagged_path.id,
                object_id: tagged_path.sketch_group,
                face_id,
            },
        )
        .await?;
    let kittycad::types::OkWebSocketResponseData::Modeling {
        modeling_response: kittycad::types::OkModelingCmdResponse::Solid3DGetPrevAdjacentEdge { data: ajacent_edge },
    } = &resp
    else {
        return Err(KclError::Engine(KclErrorDetails {
            message: format!("Solid3DGetNextAdjacentEdge response was not as expected: {:?}", resp),
            source_ranges: vec![args.source_range],
        }));
    };

    ajacent_edge.edge.ok_or_else(|| {
        KclError::Type(KclErrorDetails {
            message: format!("No edge found next adjacent to tag: `{}`", tag.value),
            source_ranges: vec![args.source_range],
        })
    })
}

/// Get the previous adjacent edge to the edge given.
pub async fn get_previous_adjacent_edge(args: Args) -> Result<MemoryItem, KclError> {
    let tag: TagIdentifier = args.get_data()?;

    let edge = inner_get_previous_adjacent_edge(tag, args.clone()).await?;
    Ok(MemoryItem::UserVal(UserVal {
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
async fn inner_get_previous_adjacent_edge(tag: TagIdentifier, args: Args) -> Result<Uuid, KclError> {
    if args.ctx.is_mock {
        return Ok(Uuid::new_v4());
    }
    let tagged_path = args.get_tag_engine_info(&tag)?;

    let face_id = args.get_adjacent_face_to_tag(&tag, false).await?;

    let resp = args
        .send_modeling_cmd(
            uuid::Uuid::new_v4(),
            ModelingCmd::Solid3DGetNextAdjacentEdge {
                edge_id: tagged_path.id,
                object_id: tagged_path.sketch_group,
                face_id,
            },
        )
        .await?;
    let kittycad::types::OkWebSocketResponseData::Modeling {
        modeling_response: kittycad::types::OkModelingCmdResponse::Solid3DGetNextAdjacentEdge { data: ajacent_edge },
    } = &resp
    else {
        return Err(KclError::Engine(KclErrorDetails {
            message: format!("Solid3DGetPrevAdjacentEdge response was not as expected: {:?}", resp),
            source_ranges: vec![args.source_range],
        }));
    };

    ajacent_edge.edge.ok_or_else(|| {
        KclError::Type(KclErrorDetails {
            message: format!("No edge found previous adjacent to tag: `{}`", tag.value),
            source_ranges: vec![args.source_range],
        })
    })
}
