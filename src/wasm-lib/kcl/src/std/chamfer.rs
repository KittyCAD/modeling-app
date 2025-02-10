//! Standard library chamfers.

use anyhow::Result;
use derive_docs::stdlib;
use kcmc::{each_cmd as mcmd, length_unit::LengthUnit, shared::CutType, ModelingCmd};
use kittycad_modeling_cmds as kcmc;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::{
    errors::{KclError, KclErrorDetails},
    execution::{ChamferSurface, EdgeCut, ExecState, ExtrudeSurface, GeoMeta, KclValue, Solid},
    parsing::ast::types::TagNode,
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
    let (data, solid, tag): (ChamferData, Box<Solid>, Option<TagNode>) = args.get_data_and_solid_and_tag()?;

    let value = inner_chamfer(data, solid, tag, exec_state, args).await?;
    Ok(KclValue::Solid { value })
}

/// Cut a straight transitional edge along a tagged path.
///
/// Chamfer is similar in function and use to a fillet, except
/// a fillet will blend the transition along an edge, rather than cut
/// a sharp, straight transitional edge.
///
/// ```no_run
/// // Chamfer a mounting plate.
/// width = 20
/// length = 10
/// thickness = 1
/// chamferLength = 2
///
/// mountingPlateSketch = startSketchOn("XY")
///   |> startProfileAt([-width/2, -length/2], %)
///   |> line(endAbsolute = [width/2, -length/2], tag = $edge1)
///   |> line(endAbsolute = [width/2, length/2], tag = $edge2)
///   |> line(endAbsolute = [-width/2, length/2], tag = $edge3)
///   |> close(tag = $edge4)
///
/// mountingPlate = extrude(mountingPlateSketch, length = thickness)
///   |> chamfer({
///     length = chamferLength,
///     tags = [
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
/// fn cube(pos, scale) {
/// sg = startSketchOn('XY')
///     |> startProfileAt(pos, %)
///     |> line(end = [0, scale])
///     |> line(end = [scale, 0])
///     |> line(end = [0, -scale])
///
///     return sg
/// }
///
/// part001 = cube([0,0], 20)
///     |> close(tag = $line1)
///     |> extrude(length = 20)
///     |> chamfer({
///         length = 10,
///         tags = [getOppositeEdge(line1)]
///     }, %, $chamfer1) // We tag the chamfer to reference it later.
///
/// sketch001 = startSketchOn(part001, chamfer1)
///     |> startProfileAt([10, 10], %)
///     |> line(end = [2, 0])
///     |> line(end = [0, 2])
///     |> line(end = [-2, 0])
///     |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
///     |> close()
///     |> extrude(length = 10)
/// ```
#[stdlib {
    name = "chamfer",
    feature_tree_operation = true,
}]
async fn inner_chamfer(
    data: ChamferData,
    solid: Box<Solid>,
    tag: Option<TagNode>,
    exec_state: &mut ExecState,
    args: Args,
) -> Result<Box<Solid>, KclError> {
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

    let mut solid = solid.clone();
    for edge_tag in data.tags {
        let edge_id = match edge_tag {
            EdgeReference::Uuid(uuid) => uuid,
            EdgeReference::Tag(edge_tag) => args.get_tag_engine_info(exec_state, &edge_tag)?.id,
        };

        let id = exec_state.global.id_generator.next_uuid();
        args.batch_end_cmd(
            id,
            ModelingCmd::from(mcmd::Solid3dFilletEdge {
                edge_id,
                object_id: solid.id,
                radius: LengthUnit(data.length),
                tolerance: LengthUnit(DEFAULT_TOLERANCE), // We can let the user set this in the future.
                cut_type: CutType::Chamfer,
                // We make this a none so that we can remove it in the future.
                face_id: None,
            }),
        )
        .await?;

        solid.edge_cuts.push(EdgeCut::Chamfer {
            id,
            edge_id,
            length: data.length,
            tag: Box::new(tag.clone()),
        });

        if let Some(ref tag) = tag {
            solid.value.push(ExtrudeSurface::Chamfer(ChamferSurface {
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
