//! Standard library mirror.

use anyhow::Result;
use kcmc::{each_cmd as mcmd, ModelingCmd};
use kittycad_modeling_cmds::{
    self as kcmc, length_unit::LengthUnit, ok_response::OkModelingCmdResponse, shared::Point3d,
    websocket::OkWebSocketResponseData,
};
use uuid::Uuid;

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

    match axis {
        Axis2dOrEdgeReference::Axis { direction, origin } => {
            let resp = exec_state
                .send_modeling_cmd(
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

            if let OkWebSocketResponseData::Modeling {
                modeling_response: OkModelingCmdResponse::EntityMirror(mirror_info),
            } = &resp
            {
                let face_edge_info = &mirror_info.entity_face_edge_ids;

                #[cfg(target_arch = "wasm32")]
                web_sys::console::log_1(&format!("faceedgeinfo {:?}", face_edge_info).into());

                #[cfg(target_arch = "wasm32")]
                web_sys::console::log_1(&format!("startig sketches before{:?}", starting_sketches).into());

                starting_sketches
                    .iter_mut()
                    .zip(face_edge_info.iter())
                    .map(|(sketch, info)| {
                        sketch.id = info.object_id;
                        sketch.mirror = info.edges.first().copied();
                        #[cfg(target_arch = "wasm32")]
                        web_sys::console::log_1(&format!("mirror sketch {:?}", sketch.mirror).into());
                    }).for_each(drop);

                #[cfg(target_arch = "wasm32")]
                web_sys::console::log_1(&format!("startig sketches after{:?}", starting_sketches).into());
                            } else {
                return Err(KclError::new_engine(KclErrorDetails::new(
                    format!("EntityMirror response was not as expected: {:?}", resp),
                    vec![args.source_range],
                )));
            };
        }
        Axis2dOrEdgeReference::Edge(edge) => {
            let edge_id = edge.get_engine_id(exec_state, &args)?;

            let resp = exec_state
                .send_modeling_cmd(
                    (&args).into(),
                    ModelingCmd::from(mcmd::EntityMirrorAcrossEdge {
                        ids: starting_sketches.iter().map(|sketch| sketch.id).collect(),
                        edge_id,
                    }),
                )
                .await?;

            let mut _edge_ids: Result<Vec<Uuid>> = Ok(Vec::new());
            if let OkWebSocketResponseData::Modeling {
                modeling_response: OkModelingCmdResponse::EntityMirrorAcrossEdge(mirror_info),
            } = &resp
            {
                let face_edge_info = &mirror_info.entity_face_edge_ids;

                #[cfg(target_arch = "wasm32")]
                        web_sys::console::log_1(&format!("faceedgeinfo {:?}", face_edge_info).into());

                #[cfg(target_arch = "wasm32")]
                web_sys::console::log_1(&format!("startig sketches before{:?}", starting_sketches).into());

                let _ = starting_sketches
                    .iter_mut()
                    .zip(face_edge_info.iter())
                    .map(|(sketch, info)| {
                        sketch.id = info.object_id;
                        sketch.mirror = info.edges.first().copied();
                        #[cfg(target_arch = "wasm32")]
                        web_sys::console::log_1(&format!("mirror sketch {:?}", sketch.mirror).into());
                    }).for_each(drop);

                #[cfg(target_arch = "wasm32")]
                web_sys::console::log_1(&format!("startig sketches after{:?}", starting_sketches).into());

            } else {
                return Err(KclError::new_engine(KclErrorDetails::new(
                    format!("EntityMirrorAcrossEdge response was not as expected: {:?}", resp),
                    vec![args.source_range],
                )));
            };
        }
    };

    Ok(starting_sketches)
}
