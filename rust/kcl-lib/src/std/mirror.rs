//! Standard library mirror.

use anyhow::Result;
use kcmc::{each_cmd as mcmd, ModelingCmd};
use kittycad_modeling_cmds::{
    self as kcmc,
    length_unit::LengthUnit,
    ok_response::OkModelingCmdResponse,
    output::{EntityMirror, EntityMirrorAcrossEdge},
    shared::Point3d,
    websocket::OkWebSocketResponseData,
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

    for sketch in &starting_sketches.clone() {
        let results = match &axis {
            Axis2dOrEdgeReference::Axis { direction, origin } => {
                let response = args
                    .send_modeling_cmd(
                        sketch.mirror.unwrap(), // This is safe we just made it above.
                        ModelingCmd::from(mcmd::EntityMirror {
                            ids: vec![sketch.id],
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

                let OkWebSocketResponseData::Modeling {
                    modeling_response:
                        OkModelingCmdResponse::EntityMirror(EntityMirror {
                            entity_face_edge_ids, ..
                        }),
                } = response
                else {
                    return Err(KclError::Internal(KclErrorDetails {
                        message: "Expected a successful response from EntityMirror".to_string(),
                        source_ranges: vec![args.source_range],
                    }));
                };

                entity_face_edge_ids
            }
            Axis2dOrEdgeReference::Edge(edge) => {
                let edge_id = edge.get_engine_id(exec_state, &args)?;

                let response = args
                    .send_modeling_cmd(
                        sketch.mirror.unwrap(), // This is safe we just made it above.
                        ModelingCmd::from(mcmd::EntityMirrorAcrossEdge {
                            ids: vec![sketch.id],
                            edge_id,
                        }),
                    )
                    .await?;

                let OkWebSocketResponseData::Modeling {
                    modeling_response:
                        OkModelingCmdResponse::EntityMirrorAcrossEdge(EntityMirrorAcrossEdge {
                            entity_face_edge_ids, ..
                        }),
                } = response
                else {
                    return Err(KclError::Internal(KclErrorDetails {
                        message: "Expected a successful response from EntityMirrorAcrossEdge".to_string(),
                        source_ranges: vec![args.source_range],
                    }));
                };

                entity_face_edge_ids
            }
        };

        println!("Mirror response: {:?}", results);
        for result in results {
            if result.object_id != sketch.id {
                // Add a new sketch to the list.
                let mut new_sketch = sketch.clone();
                new_sketch.id = result.object_id;
                new_sketch.original_id = sketch.id;

                starting_sketches.push(new_sketch);
            }
        }
    }

    Ok(starting_sketches)
}
