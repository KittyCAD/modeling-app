//! Standard library chamfers.

use anyhow::Result;
use derive_docs::stdlib;
use kcmc::{each_cmd as mcmd, length_unit::LengthUnit, shared::CutType, ModelingCmd};
use kittycad_modeling_cmds as kcmc;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::{
    ast::types::TagDeclarator,
    errors::{KclError, KclErrorDetails},
    executor::{ChamferSurface, EdgeCut, ExecState, ExtrudeGroup, ExtrudeSurface, GeoMeta, KclValue},
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
pub async fn chamfer(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let (data, extrude_group, tag): (ChamferData, Box<ExtrudeGroup>, Option<TagDeclarator>) =
        args.get_data_and_extrude_group_and_tag()?;

    let extrude_group = inner_chamfer(data, extrude_group, tag, exec_state, args).await?;
    Ok(KclValue::ExtrudeGroup(extrude_group))
}

/// Cut a straight transitional edge along a tagged path.
///
/// Chamfer is similar in function and use to a fillet, except
/// a fillet will blend the transition along an edge, rather than cut
/// a sharp, straight transitional edge.
///
/// ```no_run
/// // Chamfer a mounting plate.
/// const width = 20
/// const length = 10
/// const thickness = 1
/// const chamferLength = 2
///
/// const mountingPlateSketch = startSketchOn("XY")
///   |> startProfileAt([-width/2, -length/2], %)
///   |> lineTo([width/2, -length/2], %, $edge1)
///   |> lineTo([width/2, length/2], %, $edge2)
///   |> lineTo([-width/2, length/2], %, $edge3)
///   |> close(%, $edge4)
///
/// const mountingPlate = extrude(thickness, mountingPlateSketch)
///   |> chamfer({
///     length: chamferLength,
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
/// // Sketch on the face of a chamfer.
/// fn cube = (pos, scale) => {
/// const sg = startSketchOn('XY')
///     |> startProfileAt(pos, %)
///     |> line([0, scale], %)
///     |> line([scale, 0], %)
///     |> line([0, -scale], %)
///
///     return sg
/// }
///
/// const part001 = cube([0,0], 20)
///     |> close(%, $line1)
///     |> extrude(20, %)
///     |> chamfer({
///         length: 10,
///         tags: [getOppositeEdge(line1)]
///     }, %, $chamfer1) // We tag the chamfer to reference it later.
///
/// const sketch001 = startSketchOn(part001, chamfer1)
///     |> startProfileAt([10, 10], %)
///     |> line([2, 0], %)
///     |> line([0, 2], %)
///     |> line([-2, 0], %)
///     |> lineTo([profileStartX(%), profileStartY(%)], %)
///     |> close(%)
///     |> extrude(10, %)
/// ```
#[stdlib {
    name = "chamfer",
}]
async fn inner_chamfer(
    data: ChamferData,
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

    // If you try and tag multiple edges with a tagged chamfer, we want to return an
    // error to the user that they can only tag one edge at a time.
    if tag.is_some() && data.tags.len() > 1 {
        return Err(KclError::Type(KclErrorDetails {
            message: "You can only tag one edge at a time with a tagged chamfer. Either delete the tag for the chamfer fn if you don't need it OR separate into individual chamfer functions for each tag.".to_string(),
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
                radius: LengthUnit(data.length),
                tolerance: LengthUnit(DEFAULT_TOLERANCE), // We can let the user set this in the future.
                cut_type: CutType::Chamfer,
                // We pass in the command id as the face id.
                // So the resulting face of the fillet will be the same.
                // This is because that's how most other endpoints work.
                face_id: Some(id),
            }),
        )
        .await?;

        edge_cuts.push(EdgeCut::Chamfer {
            id,
            edge_id,
            length: data.length,
            tag: Box::new(tag.clone()),
        });

        if let Some(ref tag) = tag {
            extrude_group.value.push(ExtrudeSurface::Chamfer(ChamferSurface {
                face_id: id,
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
