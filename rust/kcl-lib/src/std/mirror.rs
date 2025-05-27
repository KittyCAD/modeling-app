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

    let mut mirrored_ids = Vec::new();

    match axis {
        Axis2dOrEdgeReference::Axis { direction, origin } => {
            let resp = args.send_modeling_cmd(
                exec_state.next_uuid(),
                ModelingCmd::from(mcmd::EntityMirror {
                    ids: starting_sketches.iter().map(|sketch| sketch.id).collect(),
                    axis: Point3d {
                        x: direction[0].to_mm(),
                        y: direction[1].to_mm(),
                        z: 0.0,
                    },
                    point: Point3d {
                        x: LengthUnit(origin[0].to_mm()),
                        y: LengthUnit(origin[1].to_mm()),
                        z: LengthUnit(0.0),
                    },
                }),
            )
            .await?;

            let mock_ids = Vec::new();
            let entity_ids = if let OkWebSocketResponseData::Modeling {
                modeling_response: OkModelingCmdResponse::EntityMirror(mirror_info),
            } = &resp
            {
                &mirror_info.entity_face_edge_ids.iter().map(|x| x.object_id).collect()
            } else if args.ctx.no_engine_commands().await {
                &mock_ids
            } else {
                return Err(KclError::Engine(KclErrorDetails::new(
                    format!("EntityLinearPattern response was not as expected: {:?}", resp),
                    vec![args.source_range],
                )));
            };
            #[cfg(target_arch = "wasm32")]
            web_sys::console::log_1(&format!("entityidsnew{:?}", entity_ids).into());
            mirrored_ids.extend(entity_ids.iter().cloned());
        }
        Axis2dOrEdgeReference::Edge(edge) => {
            let edge_id = edge.get_engine_id(exec_state, &args)?;

            let resp = args.send_modeling_cmd(
                exec_state.next_uuid(),
                ModelingCmd::from(mcmd::EntityMirrorAcrossEdge {
                    ids: starting_sketches.iter().map(|sketch| sketch.id).collect(),
                    edge_id,
                }),
            )
            .await?;

            let mock_ids = Vec::new();
            let entity_ids = if let OkWebSocketResponseData::Modeling {
                modeling_response: OkModelingCmdResponse::EntityMirrorAcrossEdge(mirror_info),
            } = &resp
            {
                &mirror_info.entity_face_edge_ids.iter().map(|x| x.object_id).collect()
            } else if args.ctx.no_engine_commands().await {
                &mock_ids
            } else {
                return Err(KclError::Engine(KclErrorDetails::new(
                    format!("EntityLinearPattern response was not as expected: {:?}", resp),
                    vec![args.source_range],
                )));
            };
            #[cfg(target_arch = "wasm32")]
            web_sys::console::log_1(&format!("entityidsnew{:?}", entity_ids).into());
            mirrored_ids.extend(entity_ids.iter().cloned());
        }
    };

    // After the mirror, get the first child uuid for the path.
    // The "get extrusion face info" API call requires *any* edge on the sketch being extruded.
    // But if you mirror2d a sketch these IDs might change so we need to get the children versus
    // using the IDs we already have.
    // We only do this with mirrors because otherwise it is a waste of a websocket call.
    for i in 0..starting_sketches.len() {
        starting_sketches[i].mirror = Some(mirrored_ids[i]);
        #[cfg(target_arch = "wasm32")]
web_sys::console::log_1(&format!("mirroredid{:?}", mirrored_ids[i]).into());
    }

    Ok(starting_sketches)
}
