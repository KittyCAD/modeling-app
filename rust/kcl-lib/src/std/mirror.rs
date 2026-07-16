//! Standard library mirror.

use anyhow::Result;
use kcmc::ModelingCmd;
use kcmc::each_cmd as mcmd;
use kittycad_modeling_cmds::length_unit::LengthUnit;
use kittycad_modeling_cmds::ok_response::OkModelingCmdResponse;
use kittycad_modeling_cmds::shared::MirrorAcross;
use kittycad_modeling_cmds::shared::Point3d;
use kittycad_modeling_cmds::websocket::OkWebSocketResponseData;
use kittycad_modeling_cmds::{self as kcmc};

use crate::errors::KclError;
use crate::errors::KclErrorDetails;
use crate::execution::ArtifactId;
use crate::execution::ExecState;
use crate::execution::GeometryWithImportedGeometry;
use crate::execution::KclValue;
use crate::execution::ModelingCmdMeta;
use crate::execution::Sketch;
use crate::execution::Solid;
use crate::execution::types::PrimitiveType;
use crate::execution::types::RuntimeType;
use crate::std::Args;
use crate::std::axis_or_reference::Axis2dOrEdgeReference;
use crate::std::axis_or_reference::MirrorAcross3d;
use crate::std::clone::fix_tags_and_references;

/// Mirror a solid.
pub async fn mirror_3d(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let bodies = args.get_unlabeled_kw_arg("bodies", &RuntimeType::solids(), exec_state)?;
    let across = args.get_kw_arg(
        "across",
        &RuntimeType::Union(vec![
            RuntimeType::Primitive(PrimitiveType::Edge),
            RuntimeType::Primitive(PrimitiveType::Axis3d),
            RuntimeType::Primitive(PrimitiveType::Plane),
            RuntimeType::segment(),
        ]),
        exec_state,
    )?;

    let bodies = inner_mirror_3d(bodies, across, exec_state, args).await?;
    Ok(bodies.into())
}

/// Mirror a solid.
async fn inner_mirror_3d(
    bodies: Vec<Solid>,
    across: MirrorAcross3d,
    exec_state: &mut ExecState,
    args: Args,
) -> Result<Vec<Solid>, KclError> {
    let unmapped_mirrored_bodies = bodies.clone();

    if args.ctx.no_engine_commands().await {
        return Ok(unmapped_mirrored_bodies);
    }

    exec_state
        .flush_batch_for_solids(ModelingCmdMeta::from_args(exec_state, &args), &bodies)
        .await?;

    let across = match across {
        MirrorAcross3d::Axis { direction, origin } => MirrorAcross::Axis {
            axis: Point3d {
                x: direction[0].to_mm(),
                y: direction[1].to_mm(),
                z: direction[2].to_mm(),
            },
            point: Point3d {
                x: LengthUnit(origin[0].to_mm()),
                y: LengthUnit(origin[1].to_mm()),
                z: LengthUnit(origin[2].to_mm()),
            },
        },
        MirrorAcross3d::Edge(edge) => MirrorAcross::Edge {
            id: edge.get_engine_id(exec_state, &args)?,
        },
        MirrorAcross3d::Plane(mut plane) => {
            if plane.is_uninitialized() {
                crate::std::sketch::ensure_sketch_plane_in_engine(
                    &mut plane,
                    exec_state,
                    &args.ctx,
                    args.source_range,
                    args.node_path.clone(),
                )
                .await?;
            }
            MirrorAcross::Plane { id: plane.id }
        }
    };

    let old_body_ids = bodies.iter().map(|body| body.id).collect::<Vec<_>>();
    let resp = exec_state
        .send_modeling_cmd(
            ModelingCmdMeta::from_args(exec_state, &args),
            ModelingCmd::from(
                mcmd::EntityMirrorAcross::builder()
                    .ids(old_body_ids.clone())
                    .across(across)
                    .build(),
            ),
        )
        .await?;

    let OkWebSocketResponseData::Modeling {
        modeling_response: OkModelingCmdResponse::EntityMirrorAcross(mirror_info),
    } = &resp
    else {
        return Err(KclError::new_engine(KclErrorDetails::new(
            format!("EntityMirrorAcross response was not as expected: {resp:?}"),
            vec![args.source_range],
        )));
    };

    if unmapped_mirrored_bodies.len() != mirror_info.entity_face_edge_ids.len() {
        return Err(KclError::new_engine(KclErrorDetails::new(
            format!(
                "EntityMirrorAcross response had {} mirrored bodies for {} input bodies",
                mirror_info.entity_face_edge_ids.len(),
                unmapped_mirrored_bodies.len()
            ),
            vec![args.source_range],
        )));
    }

    let mut mirrored_bodies = Vec::with_capacity(unmapped_mirrored_bodies.len());
    for ((mut mirrored_body, old_id), info) in unmapped_mirrored_bodies
        .into_iter()
        .zip(old_body_ids)
        .zip(mirror_info.entity_face_edge_ids.iter())
    {
        mirrored_body.id = info.object_id;
        mirrored_body.artifact_id = ArtifactId::new(info.object_id);
        let mut new_geometry = GeometryWithImportedGeometry::Solid(mirrored_body);
        fix_tags_and_references(&mut new_geometry, old_id, old_id, exec_state, &args)
            .await
            .map_err(|e| {
                KclError::new_internal(KclErrorDetails::new(
                    format!("failed to fix tags and references: {e:?}"),
                    vec![args.source_range],
                ))
            })?;
        let Some(mirrored_body) = new_geometry.into_solid() else {
            let message = "failed to extract Solid from Geometry";
            debug_assert!(false, "{message}");
            return Err(KclError::new_internal(KclErrorDetails::new(
                message.to_owned(),
                vec![args.source_range],
            )));
        };
        mirrored_bodies.push(mirrored_body);
    }

    Ok(mirrored_bodies)
}

/// Mirror a sketch.
pub async fn mirror_2d(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let sketches = args.get_unlabeled_kw_arg("sketches", &RuntimeType::sketches(), exec_state)?;
    let axis = args.get_kw_arg(
        "axis",
        &RuntimeType::Union(vec![
            RuntimeType::Primitive(PrimitiveType::Edge),
            RuntimeType::Primitive(PrimitiveType::Axis2d),
            RuntimeType::segment(),
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
        // Currently, frontend doesn't know if mirror2d will close the sketch or not.
        // Track that information.
        for sketch in starting_sketches.iter_mut() {
            sketch.is_closed = crate::execution::ProfileClosed::Maybe;
        }
        return Ok(starting_sketches);
    }

    match axis {
        Axis2dOrEdgeReference::Axis { direction, origin } => {
            let resp = exec_state
                .send_modeling_cmd(
                    ModelingCmdMeta::from_args(exec_state, &args),
                    ModelingCmd::from(
                        mcmd::EntityMirror::builder()
                            .ids(starting_sketches.iter().map(|sketch| sketch.id).collect())
                            .axis(Point3d {
                                x: direction[0].to_mm(),
                                y: direction[1].to_mm(),
                                z: 0.0,
                            })
                            .point(Point3d {
                                x: LengthUnit(origin[0].to_mm()),
                                y: LengthUnit(origin[1].to_mm()),
                                z: LengthUnit(0.0),
                            })
                            .build(),
                    ),
                )
                .await?;

            if let OkWebSocketResponseData::Modeling {
                modeling_response: OkModelingCmdResponse::EntityMirror(mirror_info),
            } = &resp
            {
                let face_edge_info = &mirror_info.entity_face_edge_ids;

                starting_sketches
                    .iter_mut()
                    .zip(face_edge_info.iter())
                    .try_for_each(|(sketch, info)| {
                        sketch.id = info.object_id;
                        let first_edge = info.edges.first().copied();
                        match first_edge {
                            Some(edge) => sketch.mirror = Some(edge),
                            None => {
                                return Err(KclError::new_engine(KclErrorDetails::new(
                                    "No edges found in mirror info".to_string(),
                                    vec![args.source_range],
                                )));
                            }
                        }
                        // Currently, frontend doesn't know if mirror2d will close the sketch or not.
                        // Track that information.
                        sketch.is_closed = crate::execution::ProfileClosed::Maybe;
                        Ok(())
                    })?;
            } else {
                return Err(KclError::new_engine(KclErrorDetails::new(
                    format!("EntityMirror response was not as expected: {resp:?}"),
                    vec![args.source_range],
                )));
            };
        }
        Axis2dOrEdgeReference::Edge(edge) => {
            let edge_id = edge.get_engine_id(exec_state, &args)?;

            let resp = exec_state
                .send_modeling_cmd(
                    ModelingCmdMeta::from_args(exec_state, &args),
                    ModelingCmd::from(
                        mcmd::EntityMirrorAcrossEdge::builder()
                            .ids(starting_sketches.iter().map(|sketch| sketch.id).collect())
                            .edge_id(edge_id)
                            .build(),
                    ),
                )
                .await?;

            if let OkWebSocketResponseData::Modeling {
                modeling_response: OkModelingCmdResponse::EntityMirrorAcrossEdge(mirror_info),
            } = &resp
            {
                let face_edge_info = &mirror_info.entity_face_edge_ids;

                starting_sketches
                    .iter_mut()
                    .zip(face_edge_info.iter())
                    .try_for_each(|(sketch, info)| {
                        sketch.id = info.object_id;
                        let first_edge = info.edges.first().copied();
                        match first_edge {
                            Some(edge) => sketch.mirror = Some(edge),
                            None => {
                                return Err(KclError::new_engine(KclErrorDetails::new(
                                    "No edges found in mirror info".to_string(),
                                    vec![args.source_range],
                                )));
                            }
                        }
                        // Currently, frontend doesn't know if mirror2d will close the sketch or not.
                        // Track that information.
                        sketch.is_closed = crate::execution::ProfileClosed::Maybe;
                        Ok(())
                    })?;
            } else {
                return Err(KclError::new_engine(KclErrorDetails::new(
                    format!("EntityMirrorAcrossEdge response was not as expected: {resp:?}"),
                    vec![args.source_range],
                )));
            };
        }
        // EdgeSpecifier variant exists for revolve, but mirror2d doesn't support edge specifiers.
        Axis2dOrEdgeReference::EdgeSpecifier(_) => {
            debug_assert!(false, "mirror2d does not support EdgeSpecifier, only Axis or Edge");
            return Err(KclError::new_internal(KclErrorDetails::new(
                "mirror2d does not support edge specifiers, only Axis or Edge".to_owned(),
                vec![args.source_range],
            )));
        }
    }

    Ok(starting_sketches)
}
