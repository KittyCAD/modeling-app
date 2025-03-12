//! Standard library chamfers.

use anyhow::Result;
use kcl_derive_docs::stdlib;
use kcmc::{each_cmd as mcmd, length_unit::LengthUnit, shared::CutType, ModelingCmd};
use kittycad_modeling_cmds as kcmc;

use crate::{
    errors::{KclError, KclErrorDetails},
    execution::{
        kcl_value::RuntimeType, ChamferSurface, EdgeCut, ExecState, ExtrudeSurface, GeoMeta, KclValue, PrimitiveType,
        Solid,
    },
    parsing::ast::types::TagNode,
    std::{fillet::EdgeReference, Args},
};

pub(crate) const DEFAULT_TOLERANCE: f64 = 0.0000001;

/// Create chamfers on tagged paths.
pub async fn chamfer(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let solid = args.get_unlabeled_kw_arg_typed("solid", &RuntimeType::Primitive(PrimitiveType::Solid), exec_state)?;
    let length = args.get_kw_arg("length")?;
    let tags = args.kw_arg_array_and_source::<EdgeReference>("tags")?;
    let tag = args.get_kw_arg_opt("tag")?;

    super::fillet::validate_unique(&tags)?;
    let tags: Vec<EdgeReference> = tags.into_iter().map(|item| item.0).collect();
    let value = inner_chamfer(solid, length, tags, tag, exec_state, args).await?;
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
///   |> chamfer(
///     length = chamferLength,
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
///     // We tag the chamfer to reference it later.
///     |> chamfer(
///         length = 10,
///         tags = [getOppositeEdge(line1)],
///         tag = $chamfer1,
///     )  
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
    keywords = true,
    unlabeled_first = true,
    args = {
        solid = { docs = "The solid whose edges should be chamfered" },
        length = { docs = "The length of the chamfer" },
        tags = { docs = "The paths you want to chamfer" },
        tag = { docs = "Create a new tag which refers to this chamfer"},
    }
}]
async fn inner_chamfer(
    solid: Box<Solid>,
    length: f64,
    tags: Vec<EdgeReference>,
    tag: Option<TagNode>,
    exec_state: &mut ExecState,
    args: Args,
) -> Result<Box<Solid>, KclError> {
    // If you try and tag multiple edges with a tagged chamfer, we want to return an
    // error to the user that they can only tag one edge at a time.
    if tag.is_some() && tags.len() > 1 {
        return Err(KclError::Type(KclErrorDetails {
            message: "You can only tag one edge at a time with a tagged chamfer. Either delete the tag for the chamfer fn if you don't need it OR separate into individual chamfer functions for each tag.".to_string(),
            source_ranges: vec![args.source_range],
        }));
    }

    let mut solid = solid.clone();
    for edge_tag in tags {
        let edge_id = match edge_tag {
            EdgeReference::Uuid(uuid) => uuid,
            EdgeReference::Tag(edge_tag) => args.get_tag_engine_info(exec_state, &edge_tag)?.id,
        };

        let id = exec_state.next_uuid();
        args.batch_end_cmd(
            id,
            ModelingCmd::from(mcmd::Solid3dFilletEdge {
                edge_id,
                object_id: solid.id,
                radius: LengthUnit(length),
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
            length,
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
