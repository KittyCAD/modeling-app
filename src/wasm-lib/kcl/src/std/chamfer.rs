//! Standard library chamfers.

use anyhow::Result;
use derive_docs::stdlib;
use kittycad::types::ModelingCmd;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::{
    ast::types::TagDeclarator,
    errors::{KclError, KclErrorDetails},
    executor::{ExtrudeGroup, FilletOrChamfer, MemoryItem},
    std::{fillet::EdgeReference, Args},
};

pub(crate) const DEFAULT_TOLERANCE: f64 = 0.0000001;

/// Data for chamfers.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct ChamferData {
    /// The length of the chamfer.
    pub length: f64,
    /// The tags of the paths you want to chamfer.
    pub tags: Vec<EdgeReference>,
}

/// Create chamfers on tagged paths.
pub async fn chamfer(args: Args) -> Result<MemoryItem, KclError> {
    let (data, extrude_group, tag): (ChamferData, Box<ExtrudeGroup>, Option<TagDeclarator>) =
        args.get_data_and_extrude_group_and_tag()?;

    let extrude_group = inner_chamfer(data, extrude_group, tag, args).await?;
    Ok(MemoryItem::ExtrudeGroup(extrude_group))
}

/// Create chamfers on tagged paths.
///
/// ```no_run
/// const width = 20
/// const length = 10
/// const thickness = 1
/// const chamferLength = 2
///
/// const mountingPlateSketch = startSketchOn("XY")
///   |> startProfileAt([-width/2, -length/2], %)
///   |> lineTo([width/2, -length/2], %, 'edge1')
///   |> lineTo([width/2, length/2], %, 'edge2')
///   |> lineTo([-width/2, length/2], %, 'edge3')
///   |> close(%, 'edge4')
///
/// const mountingPlate = extrude(thickness, mountingPlateSketch)
///   |> chamfer({
///     length: chamferLength,
///     tags: [
///       getNextAdjacentEdge('edge1', %),
///       getNextAdjacentEdge('edge2', %),
///       getNextAdjacentEdge('edge3', %),
///       getNextAdjacentEdge('edge4', %)
///     ],
///   }, %)
/// ```
#[stdlib {
    name = "chamfer",
}]
async fn inner_chamfer(
    data: ChamferData,
    extrude_group: Box<ExtrudeGroup>,
    tag: Option<TagDeclarator>,
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

    // If you try and tag multiple edges with a tagged chamfer, we want to return an
    // error to the user that they can only tag one edge at a time.
    if tag.is_some() && data.tags.len() > 1 {
        return Err(KclError::Type(KclErrorDetails {
            message: "You can only tag one edge at a time with a tagged chamfer. Either delete the tag for the chamfer fn if you don't need it OR separate into individual chamfer functions for each tag.".to_string(),
            source_ranges: vec![args.source_range],
        }));
    }

    let mut fillet_or_chamfers = Vec::new();
    for edge_tag in data.tags {
        let edge_id = match edge_tag {
            EdgeReference::Uuid(uuid) => uuid,
            EdgeReference::Tag(edge_tag) => {
                extrude_group
                    .sketch_group
                    .get_path_by_tag(&edge_tag)
                    .ok_or_else(|| {
                        KclError::Type(KclErrorDetails {
                            message: format!("No edge found with tag: `{}`", edge_tag.value),
                            source_ranges: vec![args.source_range],
                        })
                    })?
                    .get_base()
                    .geo_meta
                    .id
            }
        };

        let id = uuid::Uuid::new_v4();
        args.batch_end_cmd(
            id,
            ModelingCmd::Solid3DFilletEdge {
                edge_id,
                object_id: extrude_group.id,
                radius: data.length,
                tolerance: DEFAULT_TOLERANCE, // We can let the user set this in the future.
                cut_type: Some(kittycad::types::CutType::Chamfer),
            },
        )
        .await?;

        fillet_or_chamfers.push(FilletOrChamfer::Chamfer {
            id,
            edge_id,
            length: data.length,
            tag: Box::new(tag.clone()),
        });
    }

    let mut extrude_group = extrude_group.clone();
    extrude_group.fillet_or_chamfers = fillet_or_chamfers;

    Ok(extrude_group)
}
