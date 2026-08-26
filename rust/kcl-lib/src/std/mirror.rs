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
use crate::execution::ExecState;
use crate::execution::GeometryWithImportedGeometry;
use crate::execution::KclValue;
use crate::execution::ModelingCmdMeta;
use crate::execution::Sketch;
use crate::execution::Solid;
use crate::execution::types::PrimitiveType;
use crate::execution::types::RuntimeType;
use crate::std::Args;
use crate::std::args::FromKclValue;
use crate::std::axis_or_reference::Axis2dOrEdgeReference;
use crate::std::axis_or_reference::MirrorAcross3d;
use crate::std::clone::fix_tags_and_references;
use crate::std::patterns::GeometryTrait;

/// Mirror a solid.
pub async fn mirror_3d(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let bodies = args.get_unlabeled_kw_arg("bodies", &RuntimeType::solids(), exec_state)?;
    let across_value: KclValue = args.get_kw_arg("across", &RuntimeType::any(), exec_state)?;
    let across = if crate::std::edge::is_edge_specifier_object(&across_value) {
        MirrorAcross3d::EdgeSpecifier(crate::std::edge::parse_edge_specifier_value(&across_value, &args)?)
    } else {
        MirrorAcross3d::from_kcl_val(&across_value).ok_or_else(|| {
            KclError::new_type(KclErrorDetails::new(
                "across must be an Edge, Plane, Axis3d, Segment, or an edge specifier object".to_owned(),
                vec![args.source_range],
            ))
        })?
    };

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
        let mut unmapped_mirrored_bodies = unmapped_mirrored_bodies;
        for mirrored_body in &mut unmapped_mirrored_bodies {
            let id = exec_state.next_uuid();
            mirrored_body.set_id(id);
            mirrored_body.become_new_body(id, id.into());
        }
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
        MirrorAcross3d::Edge(edge) => {
            let edge_id = edge.get_engine_id(exec_state, &args)?;
            let source_range = args
                .labeled
                .get("across")
                .map(|arg| arg.source_range)
                .unwrap_or(args.source_range);
            crate::std::edge::record_refactor_meta_for_consumed_edge(exec_state, edge_id, source_range, &args).await;
            MirrorAcross::Edge { id: edge_id }
        }
        MirrorAcross3d::EdgeSpecifier(specifier) => MirrorAcross::EdgeReference {
            reference: crate::std::edge::resolve_edge_specifier_with_adjacent_faces_or_tag_ids(
                &specifier, exec_state, &args,
            )
            .await?,
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
    for (mut mirrored_body, info) in unmapped_mirrored_bodies
        .into_iter()
        .zip(mirror_info.entity_face_edge_ids.iter())
    {
        let old_id = mirrored_body.id;
        let source_topology_id = mirrored_body.topology_id();
        mirrored_body.id = info.object_id;
        mirrored_body.become_new_body(info.object_id, info.object_id.into());
        let mut new_geometry = GeometryWithImportedGeometry::Solid(mirrored_body);
        fix_tags_and_references(&mut new_geometry, old_id, source_topology_id, exec_state, &args)
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

#[cfg(test)]
mod tests {
    use crate::execution::MockConfig;

    #[tokio::test(flavor = "multi_thread")]
    async fn mock_mirror_has_independent_consumption_identity() {
        let code = r#"// Mirrored rectangular cut blocks
@settings(defaultLengthUnit = mm, kclVersion = 2.0)

baseStartX = 1mm
baseWidth = 10mm
baseHeight = 10mm
partThickness = 5mm
cutStartX = 3mm
cutStartY = 3mm
cutWidth = 2mm
cutHeight = 2mm

baseSketch = sketch(on = XY) {
  baseBottom = line(start = [var 1mm, var 0mm], end = [var 11mm, var 0mm])
  baseRight = line(start = [var 11mm, var 0mm], end = [var 11mm, var 10mm])
  baseTop = line(start = [var 11mm, var 10mm], end = [var 1mm, var 10mm])
  baseLeft = line(start = [var 1mm, var 10mm], end = [var 1mm, var 0mm])

  coincident([baseBottom.end, baseRight.start])
  coincident([baseRight.end, baseTop.start])
  coincident([baseTop.end, baseLeft.start])
  coincident([baseLeft.end, baseBottom.start])
  horizontal(baseBottom)
  horizontal(baseTop)
  vertical(baseRight)
  vertical(baseLeft)
  horizontalDistance([ORIGIN, baseBottom.start]) == baseStartX
  verticalDistance([ORIGIN, baseBottom.start]) == 0mm
  horizontalDistance([baseBottom.start, baseBottom.end]) == baseWidth
  verticalDistance([baseBottom.start, baseLeft.start]) == baseHeight
}

baseRegion = region(segments = [
  baseSketch.baseBottom,
  baseSketch.baseRight
])
base = extrude(baseRegion, length = partThickness)
hiddenBaseSketch = hide(baseSketch)

mirroredBase = mirror3d([base], across = YZ)

cutSketch = sketch(on = XY) {
  cutBottom = line(start = [var 3mm, var 3mm], end = [var 5mm, var 3mm])
  cutRight = line(start = [var 5mm, var 3mm], end = [var 5mm, var 5mm])
  cutTop = line(start = [var 5mm, var 5mm], end = [var 3mm, var 5mm])
  cutLeft = line(start = [var 3mm, var 5mm], end = [var 3mm, var 3mm])

  coincident([cutBottom.end, cutRight.start])
  coincident([cutRight.end, cutTop.start])
  coincident([cutTop.end, cutLeft.start])
  coincident([cutLeft.end, cutBottom.start])
  horizontal(cutBottom)
  horizontal(cutTop)
  vertical(cutRight)
  vertical(cutLeft)
  horizontalDistance([ORIGIN, cutBottom.start]) == cutStartX
  verticalDistance([ORIGIN, cutBottom.start]) == cutStartY
  horizontalDistance([cutBottom.start, cutBottom.end]) == cutWidth
  verticalDistance([cutBottom.start, cutLeft.start]) == cutHeight
}

cutRegion = region(segments = [
  cutSketch.cutBottom,
  cutSketch.cutRight
])
tool = extrude(cutRegion, length = partThickness)
hiddenCutSketch = hide(cutSketch)

mirroredTool = mirror3d([tool], across = YZ)
firstCut = subtract(base, tools = [tool])
secondCut = subtract(mirroredBase, tools = [mirroredTool])
"#;

        let program = crate::Program::parse_no_errs(code).unwrap();
        let ctx = crate::ExecutorContext::new_mock(None).await;
        let result = ctx.run_mock(&program, &MockConfig::default()).await;
        ctx.close().await;
        result.unwrap();
    }
}
