//! Standard library mirror.

use anyhow::Result;
use kcmc::{each_cmd as mcmd, ModelingCmd};
use kittycad_modeling_cmds::{
    self as kcmc, length_unit::LengthUnit, ok_response::OkModelingCmdResponse,
    shared::Point3d, websocket::OkWebSocketResponseData,
};

use crate::{
    errors::{KclError, KclErrorDetails}, execution::{
        types::{PrimitiveType, RuntimeType},
        ExecState, KclValue, Sketch,
    }, std::{axis_or_reference::Axis2dOrEdgeReference, Args}
};

/// Mirror a sketch.
pub async fn mirror_2d(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let sketches = args.get_unlabeled_kw_arg("sketches", &RuntimeType::sketches(), exec_state)?;
    let axis = args.get_kw_arg(
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

    if args.ctx.no_engine_commands().await {
        return Ok(starting_sketches);
    }

    let mut mirrored_ids = Vec::new();
    let mirrored_edge_ids = match axis {
        Axis2dOrEdgeReference::Axis { direction, origin } => {
            let resp = exec_state.send_modeling_cmd(
                (&args).into(),
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
            let mut edge_ids = Vec::new();
            let entity_ids = if let OkWebSocketResponseData::Modeling {
                modeling_response: OkModelingCmdResponse::EntityMirror(mirror_info),
            } = &resp
            {
                edge_ids = mirror_info.entity_face_edge_ids.iter()
                    .map(|x| x.edges.first().copied().unwrap_or_default())
                    .collect();
                &mirror_info.entity_face_edge_ids.iter().map(|x| x.object_id).collect()
            } else if args.ctx.no_engine_commands().await {
                &mock_ids
            } else {
                return Err(KclError::new_engine(KclErrorDetails::new(
                    format!("EntityLinearPattern response was not as expected: {:?}", resp),
                    vec![args.source_range],
                )));
            };
            #[cfg(target_arch = "wasm32")]
            web_sys::console::log_1(&format!("entityidsnew{:?}", entity_ids).into());
            mirrored_ids.extend(entity_ids.iter().cloned());
            edge_ids
        }
        Axis2dOrEdgeReference::Edge(edge) => {
            let edge_id = edge.get_engine_id(exec_state, &args)?;

            let resp = exec_state.send_modeling_cmd(
                (&args).into(),
                ModelingCmd::from(mcmd::EntityMirrorAcrossEdge {
                    ids: starting_sketches.iter().map(|sketch| sketch.id).collect(),
                    edge_id,
                }),
            )
            .await?;

            let mock_ids = Vec::new();
            let mut edge_ids = Vec::new();
            let entity_ids = if let OkWebSocketResponseData::Modeling {
                modeling_response: OkModelingCmdResponse::EntityMirrorAcrossEdge(mirror_info),
            } = &resp
            {
                edge_ids = mirror_info.entity_face_edge_ids.iter()
                .map(|x| x.edges.first().copied().unwrap_or_default())
                .collect();
               &mirror_info.entity_face_edge_ids.iter().map(|x| x.object_id).collect()
            } else if args.ctx.no_engine_commands().await {
                &mock_ids
            } else {
                return Err(KclError::new_engine(KclErrorDetails::new(
                    format!("EntityLinearPattern response was not as expected: {:?}", resp),
                    vec![args.source_range],
                )));
            };
            #[cfg(target_arch = "wasm32")]
            web_sys::console::log_1(&format!("entityidsnew{:?}", entity_ids).into());
            mirrored_ids.extend(entity_ids.iter().cloned());
            edge_ids
        }
    };

    // After the mirror, get the first child uuid for the path.
    // The "get extrusion face info" API call requires *any* edge on the sketch being extruded.
    // But if you mirror2d a sketch these IDs might change so we need to get the children versus
    // using the IDs we already have.
    // We only do this with mirrors because otherwise it is a waste of a websocket call.
    for i in 0..starting_sketches.len() {
        if starting_sketches[i].id != mirrored_ids[i] {
            // Mirroring created a new path. The mirrored Sketch is a clone of
            // the original with a new ID.
            starting_sketches[i].mirror = Some(mirrored_edge_ids[i]);
            starting_sketches[i].id = mirrored_ids[i];
        }
        #[cfg(target_arch = "wasm32")]
web_sys::console::log_1(&format!("mirroredid{:?}", mirrored_ids[i]).into());
    }

    Ok(starting_sketches)
}
