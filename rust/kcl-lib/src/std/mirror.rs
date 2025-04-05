//! Standard library mirror.

use anyhow::Result;
use kcmc::{each_cmd as mcmd, ModelingCmd};
use kittycad_modeling_cmds::{
    self as kcmc, length_unit::LengthUnit, ok_response::OkModelingCmdResponse, output::EntityGetAllChildUuids,
    shared::Point3d, websocket::OkWebSocketResponseData,
};

use crate::{
    errors::{KclError, KclErrorDetails},
    execution::{
        types::{PrimitiveType, RuntimeType},
        ExecState, KclValue, Sketch,
    },
    std::{axis_or_reference::Axis2dOrEdgeReference, Args},
};

/// Mirror a sketch.
///
/// Only works on unclosed sketches for now.
pub async fn mirror_2d(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let sketches = args.get_unlabeled_kw_arg_typed("sketches", &RuntimeType::sketches(), exec_state)?;
    let axis = args.get_kw_arg_typed(
        "axis",
        &RuntimeType::Union(vec![
            RuntimeType::Primitive(PrimitiveType::Edge),
            RuntimeType::Primitive(PrimitiveType::Axis2d),
        ]),
        exec_state,
    )?;

    let sketches = inner_mirror_2d(sketches, axis, exec_state, args).await?;
    Ok(sketches.into())
}

/// Mirror a sketch.
///
/// Only works on unclosed sketches for now.
async fn inner_mirror_2d(
    sketches: Vec<Sketch>,
    axis: Axis2dOrEdgeReference,
    exec_state: &mut ExecState,
    args: Args,
) -> Result<Vec<Sketch>, KclError> {
    let mut starting_sketches = sketches.clone();

    // Update all to have a mirror.
    starting_sketches.iter_mut().for_each(|sketch| {
        sketch.mirror = Some(exec_state.next_uuid());
    });

    if args.ctx.no_engine_commands().await {
        return Ok(starting_sketches);
    }

    match axis {
        Axis2dOrEdgeReference::Axis { direction, origin } => {
            args.batch_modeling_cmd(
                exec_state.next_uuid(),
                ModelingCmd::from(mcmd::EntityMirror {
                    ids: starting_sketches.iter().map(|sketch| sketch.id).collect(),
                    axis: Point3d {
                        x: direction[0],
                        y: direction[1],
                        z: 0.0,
                    },
                    point: Point3d {
                        x: LengthUnit(origin[0]),
                        y: LengthUnit(origin[1]),
                        z: LengthUnit(0.0),
                    },
                }),
            )
            .await?;
        }
        Axis2dOrEdgeReference::Edge(edge) => {
            let edge_id = edge.get_engine_id(exec_state, &args)?;

            args.batch_modeling_cmd(
                exec_state.next_uuid(),
                ModelingCmd::from(mcmd::EntityMirrorAcrossEdge {
                    ids: starting_sketches.iter().map(|sketch| sketch.id).collect(),
                    edge_id,
                }),
            )
            .await?;
        }
    };

    // After the mirror, get the first child uuid for the path.
    // The "get extrusion face info" API call requires *any* edge on the sketch being extruded.
    // But if you mirror2d a sketch these IDs might change so we need to get the children versus
    // using the IDs we already have.
    // We only do this with mirrors because otherwise it is a waste of a websocket call.
    for sketch in &mut starting_sketches {
        let response = args
            .send_modeling_cmd(
                exec_state.next_uuid(),
                ModelingCmd::from(mcmd::EntityGetAllChildUuids { entity_id: sketch.id }),
            )
            .await?;
        let OkWebSocketResponseData::Modeling {
            modeling_response:
                OkModelingCmdResponse::EntityGetAllChildUuids(EntityGetAllChildUuids { entity_ids: child_ids }),
        } = response
        else {
            return Err(KclError::Internal(KclErrorDetails {
                message: "Expected a successful response from EntityGetAllChildUuids".to_string(),
                source_ranges: vec![args.source_range],
            }));
        };

        if child_ids.len() >= 2 {
            // The first child is the original sketch, the second is the mirrored sketch.
            let child_id = child_ids[1];
            sketch.mirror = Some(child_id);
        } else {
            return Err(KclError::Type(KclErrorDetails {
                message: "Expected child uuids to be >= 2".to_string(),
                source_ranges: vec![args.source_range],
            }));
        }
    }

    Ok(starting_sketches)
}
