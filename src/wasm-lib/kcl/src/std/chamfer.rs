//! Standard library chamfers.

use anyhow::Result;
use derive_docs::stdlib;
use kittycad::types::ModelingCmd;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::{
    errors::{KclError, KclErrorDetails},
    executor::{ExtrudeGroup, MemoryItem},
    std::Args,
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

/// A string or a uuid.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema, Ord, PartialOrd, Eq, Hash)]
#[ts(export)]
#[serde(untagged)]
pub enum EdgeReference {
    /// A uuid of an edge.
    Uuid(uuid::Uuid),
    /// A tag name of an edge.
    Tag(String),
}

/// Create chamfers on tagged paths.
pub async fn chamfer(args: Args) -> Result<MemoryItem, KclError> {
    let (data, extrude_group): (ChamferData, Box<ExtrudeGroup>) = args.get_data_and_extrude_group()?;

    let extrude_group = inner_chamfer(data, extrude_group, args).await?;
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

    for tag in data.tags {
        let edge_id = match tag {
            EdgeReference::Uuid(uuid) => uuid,
            EdgeReference::Tag(tag) => {
                extrude_group
                    .sketch_group
                    .value
                    .iter()
                    .find(|p| p.get_name() == tag)
                    .ok_or_else(|| {
                        KclError::Type(KclErrorDetails {
                            message: format!("No edge found with tag: `{}`", tag),
                            source_ranges: vec![args.source_range],
                        })
                    })?
                    .get_base()
                    .geo_meta
                    .id
            }
        };

        args.batch_end_cmd(
            uuid::Uuid::new_v4(),
            ModelingCmd::Solid3DFilletEdge {
                edge_id,
                object_id: extrude_group.id,
                radius: data.length,
                tolerance: DEFAULT_TOLERANCE, // We can let the user set this in the future.
                cut_type: Some(kittycad::types::CutType::Chamfer),
            },
        )
        .await?;
    }

    Ok(extrude_group)
}
