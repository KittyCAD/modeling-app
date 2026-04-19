use std::f64::consts::TAU;

use indexmap::IndexMap;
use kcl_error::SourceRange;
use kittycad_modeling_cmds::ModelingCmd;
use kittycad_modeling_cmds::each_cmd as mcmd;
use kittycad_modeling_cmds::length_unit::LengthUnit;
use kittycad_modeling_cmds::shared::Angle as KAngle;
use kittycad_modeling_cmds::shared::PathSegment;
use kittycad_modeling_cmds::shared::Point2d as KPoint2d;
use kittycad_modeling_cmds::shared::Point4d as KPoint4d;
use kittycad_modeling_cmds::units::UnitLength;
use uuid::Uuid;

use crate::ExecState;
use crate::ExecutorContext;
use crate::KclError;
use crate::errors::KclErrorDetails;
use crate::exec::NumericType;
use crate::exec::Sketch;
use crate::execution::BasePath;
use crate::execution::GeoMeta;
use crate::execution::Metadata;
use crate::execution::ModelingCmdMeta;
use crate::execution::Path;
use crate::execution::Segment;
use crate::execution::SegmentKind;
use crate::execution::SketchSurface;
use crate::front::ObjectId;
use crate::parsing::ast::types::TagNode;
use crate::std::args::TyF64;
use crate::std::sketch::StraightLineParams;
use crate::std::sketch::create_sketch;
use crate::std::sketch::relative_arc;
use crate::std::sketch::straight_line;
use crate::std::utils::distance;
use crate::std::utils::point_to_len_unit;
use crate::std::utils::point_to_mm;
use crate::std::utils::untype_point;
use crate::std::utils::untyped_point_to_mm;
use crate::std_utils::untyped_point_to_unit;

pub const SOLVER_CONVERGENCE_TOLERANCE: f64 = 1e-8;

fn spline_controls_to_units(
    controls: &[[TyF64; 2]],
    units: UnitLength,
    range: SourceRange,
) -> Result<Vec<[f64; 2]>, KclError> {
    controls
        .iter()
        .map(|control| {
            let (point, point_ty) = untype_point(control.clone());
            let Some(point_unit) = point_ty.as_length() else {
                return Err(KclError::new_semantic(KclErrorDetails::new(
                    "Control point spline points must have length units".to_owned(),
                    vec![range],
                )));
            };
            Ok(untyped_point_to_unit(point, point_unit, units))
        })
        .collect()
}

fn spline_controls_to_engine_points(controls: &[[f64; 2]], units: UnitLength) -> Vec<KPoint4d<LengthUnit>> {
    controls
        .iter()
        .skip(1)
        .map(|control| {
            let point_mm = untyped_point_to_mm(*control, units);
            KPoint4d {
                x: LengthUnit(point_mm[0]),
                y: LengthUnit(point_mm[1]),
                z: LengthUnit(0.0),
                w: LengthUnit(1.0),
            }
        })
        .collect()
}

fn closes_path(end: [f64; 2], start: [f64; 2]) -> bool {
    (end[0] - start[0]).abs() <= SOLVER_CONVERGENCE_TOLERANCE
        && (end[1] - start[1]).abs() <= SOLVER_CONVERGENCE_TOLERANCE
}

/// Create the Sketch and send to the engine. Return will be None if there are
/// no segments.
pub(crate) async fn create_segments_in_engine(
    sketch_surface: &SketchSurface,
    sketch_engine_id: Uuid,
    segments: &mut [Segment],
    segment_tags: &IndexMap<ObjectId, TagNode>,
    ctx: &ExecutorContext,
    exec_state: &mut ExecState,
    sketch_block_range: SourceRange,
) -> Result<Option<Sketch>, KclError> {
    #[derive(Clone, Copy, Debug, PartialEq, Eq)]
    enum SegmentTraversal {
        Forward,
        Reverse,
    }

    let mut outer_sketch: Option<Sketch> = None;
    for segment in segments.iter() {
        if segment.is_construction() {
            // Don't send construction segments to the engine.
            continue;
        }

        // The start point for the segment's declared forward direction.
        let forward_start = match &segment.kind {
            SegmentKind::Point { .. } => {
                // TODO: In the engine, points currently need to be their own
                // path. Skipping them for now.
                continue;
            }
            SegmentKind::Line { start, .. } => start.clone(),
            SegmentKind::Arc { start, .. } => start.clone(),
            SegmentKind::Circle { start, .. } => start.clone(),
            SegmentKind::ControlPointSpline { controls, .. } => controls.first().cloned().ok_or_else(|| {
                KclError::new_internal(KclErrorDetails::new(
                    "Control point spline is missing control points".to_owned(),
                    vec![sketch_block_range],
                ))
            })?,
        };

        // Get the source range of the segment from its metadata, falling back to the sketch block's.
        let default_meta = Metadata {
            source_range: sketch_block_range,
        };
        let meta = segment.meta.first().unwrap_or(&default_meta);
        let range = meta.source_range;
        let mut traversal = SegmentTraversal::Forward;

        if let Some(sketch) = &mut outer_sketch {
            let forward_start_mm = point_to_mm(forward_start.clone());
            let current_pen = sketch.current_pen_position()?;
            let current_pen_mm = untyped_point_to_mm([current_pen.x, current_pen.y], current_pen.units);

            let entry_point = match &segment.kind {
                SegmentKind::Line { end, .. } | SegmentKind::Arc { end, .. } => {
                    let reverse_start_mm = point_to_mm(end.clone());
                    if distance(forward_start_mm, current_pen_mm) <= SOLVER_CONVERGENCE_TOLERANCE {
                        forward_start.clone()
                    } else if distance(reverse_start_mm, current_pen_mm) <= SOLVER_CONVERGENCE_TOLERANCE {
                        traversal = SegmentTraversal::Reverse;
                        end.clone()
                    } else {
                        forward_start.clone()
                    }
                }
                SegmentKind::Circle { .. } => forward_start.clone(),
                SegmentKind::ControlPointSpline { controls, .. } => {
                    let reverse_start = controls.last().cloned().ok_or_else(|| {
                        KclError::new_internal(KclErrorDetails::new(
                            "Control point spline is missing control points".to_owned(),
                            vec![range],
                        ))
                    })?;
                    let reverse_start_mm = point_to_mm(reverse_start.clone());
                    if distance(forward_start_mm, current_pen_mm) <= SOLVER_CONVERGENCE_TOLERANCE {
                        forward_start.clone()
                    } else if distance(reverse_start_mm, current_pen_mm) <= SOLVER_CONVERGENCE_TOLERANCE {
                        traversal = SegmentTraversal::Reverse;
                        reverse_start
                    } else {
                        forward_start.clone()
                    }
                }
                SegmentKind::Point { .. } => unreachable!("points are skipped earlier"),
            };
            let entry_point_mm = point_to_mm(entry_point.clone());

            // If the next segment already starts where the pen is, preserve continuity by
            // skipping both the engine pen move and the synthetic bookkeeping jump.
            if distance(entry_point_mm, current_pen_mm) > SOLVER_CONVERGENCE_TOLERANCE {
                let id = exec_state.next_uuid();
                if !exec_state.sketch_mode() {
                    exec_state
                        .batch_modeling_cmd(
                            ModelingCmdMeta::with_id(exec_state, ctx, range, id),
                            ModelingCmd::from(
                                mcmd::MovePathPen::builder()
                                    .path(sketch.id.into())
                                    .to(KPoint2d::from(entry_point_mm).with_z(0.0).map(LengthUnit))
                                    .build(),
                            ),
                        )
                        .await?;
                }
                // Store the current location in the sketch.
                let previous_base = sketch.paths.last().map(|p| p.get_base()).unwrap_or(&sketch.start);
                let base = BasePath {
                    from: previous_base.to,
                    to: point_to_len_unit(entry_point, sketch.units),
                    units: previous_base.units,
                    tag: None,
                    geo_meta: GeoMeta {
                        id,
                        metadata: range.into(),
                    },
                };
                sketch.paths.push(Path::ToPoint { base });
                sketch.synthetic_jump_path_ids.push(id);
            }
        } else {
            // Create a new path.
            let sketch = create_sketch(
                sketch_engine_id,
                sketch_surface.clone(),
                forward_start,
                None,
                !exec_state.sketch_mode(),
                exec_state,
                ctx,
                sketch_block_range,
            )
            .await?;
            outer_sketch = Some(sketch);
        };

        let Some(sketch) = &outer_sketch else {
            return Err(KclError::new_internal(KclErrorDetails::new(
                "Sketch should have been initialized before creating segments".to_owned(),
                vec![range],
            )));
        };

        // Verify that the sketch ID of the segment matches the current sketch.
        if segment.sketch_id != sketch_engine_id {
            let message = format!(
                "segment sketch ID doesn't match sketch ID being used to the engine; segment.sketch_id={:?}, sketch_engine_id={sketch_engine_id:?}",
                segment.sketch_id
            );
            debug_assert!(false, "{message}");
            return Err(KclError::new_internal(KclErrorDetails::new(message, vec![range])));
        }

        let tag = segment_tags.get(&segment.object_id).cloned();

        match &segment.kind {
            SegmentKind::Point { .. } => {
                debug_assert!(false, "Points should have been skipped earlier");
                continue;
            }
            SegmentKind::Line { end, start, .. } => {
                let to = match traversal {
                    SegmentTraversal::Forward => end.clone(),
                    SegmentTraversal::Reverse => start.clone(),
                };
                let sketch = straight_line(
                    segment.id,
                    StraightLineParams::absolute(to, sketch.clone(), tag),
                    !exec_state.sketch_mode(),
                    exec_state,
                    ctx,
                    range,
                )
                .await?;
                outer_sketch = Some(sketch);
            }
            SegmentKind::Arc { start, end, center, .. } => {
                let (start, start_ty) = untype_point(start.clone());
                let Some(start_unit) = start_ty.as_length() else {
                    return Err(KclError::new_semantic(KclErrorDetails::new(
                        "Start point of arc must have length units".to_owned(),
                        vec![range],
                    )));
                };
                let (end, end_ty) = untype_point(end.clone());
                let Some(end_unit) = end_ty.as_length() else {
                    return Err(KclError::new_semantic(KclErrorDetails::new(
                        "End point of arc must have length units".to_owned(),
                        vec![range],
                    )));
                };
                let (center, center_ty) = untype_point(center.clone());
                let Some(center_unit) = center_ty.as_length() else {
                    return Err(KclError::new_semantic(KclErrorDetails::new(
                        "Center point of arc must have length units".to_owned(),
                        vec![range],
                    )));
                };
                let (traversal_start, traversal_end, traversal_start_unit, traversal_end_unit) = match traversal {
                    SegmentTraversal::Forward => (start, end, start_unit, end_unit),
                    SegmentTraversal::Reverse => (end, start, end_unit, start_unit),
                };
                let start_in_center_unit = untyped_point_to_unit(traversal_start, traversal_start_unit, center_unit);
                let end_in_center_unit = untyped_point_to_unit(traversal_end, traversal_end_unit, center_unit);
                let start_radians =
                    libm::atan2(start_in_center_unit[1] - center[1], start_in_center_unit[0] - center[0]);
                let mut end_radians = libm::atan2(end_in_center_unit[1] - center[1], end_in_center_unit[0] - center[0]);
                match traversal {
                    SegmentTraversal::Forward => {
                        if end_radians <= start_radians {
                            end_radians += std::f64::consts::TAU;
                        }
                    }
                    SegmentTraversal::Reverse => {
                        if end_radians >= start_radians {
                            end_radians -= std::f64::consts::TAU;
                        }
                    }
                }
                let radius_in_center_unit = distance(center, start_in_center_unit);
                let sketch = relative_arc(
                    segment.id,
                    exec_state,
                    sketch.clone(),
                    sketch.current_pen_position()?,
                    TyF64::new(start_radians, NumericType::radians()),
                    TyF64::new(end_radians, NumericType::radians()),
                    TyF64::new(radius_in_center_unit, center_ty),
                    tag,
                    !exec_state.sketch_mode(),
                    ctx,
                    range,
                )
                .await?;
                outer_sketch = Some(sketch);
            }
            SegmentKind::Circle { start, center, .. } => {
                let (start, start_ty) = untype_point(start.clone());
                let Some(start_unit) = start_ty.as_length() else {
                    return Err(KclError::new_semantic(KclErrorDetails::new(
                        "Start point of circle must have length units".to_owned(),
                        vec![range],
                    )));
                };
                let (center, center_ty) = untype_point(center.clone());
                let Some(center_unit) = center_ty.as_length() else {
                    return Err(KclError::new_semantic(KclErrorDetails::new(
                        "Center point of circle must have length units".to_owned(),
                        vec![range],
                    )));
                };
                let start_in_center_unit = untyped_point_to_unit(start, start_unit, center_unit);
                let start_radians =
                    libm::atan2(start_in_center_unit[1] - center[1], start_in_center_unit[0] - center[0]);
                let end_radians = start_radians + TAU;
                let radius_in_center_unit = distance(center, start_in_center_unit);

                let units = center_ty.as_length().unwrap_or(UnitLength::Millimeters);
                let from = start_in_center_unit;

                let id = segment.id;

                exec_state
                    .batch_modeling_cmd(
                        ModelingCmdMeta::with_id(exec_state, ctx, range, id),
                        ModelingCmd::from(
                            mcmd::ExtendPath::builder()
                                .path(sketch.id.into())
                                .segment(PathSegment::Arc {
                                    start: KAngle::from_radians(start_radians),
                                    end: KAngle::from_radians(end_radians),
                                    center: KPoint2d::from(untyped_point_to_mm(center, units)).map(LengthUnit),
                                    radius: LengthUnit(
                                        crate::execution::types::adjust_length(
                                            units,
                                            radius_in_center_unit,
                                            UnitLength::Millimeters,
                                        )
                                        .0,
                                    ),
                                    relative: false,
                                })
                                .build(),
                        ),
                    )
                    .await?;

                let current_path = Path::Circle {
                    base: BasePath {
                        from,
                        to: from,
                        tag: tag.clone(),
                        units,
                        geo_meta: GeoMeta {
                            id,
                            metadata: range.into(),
                        },
                    },
                    radius: radius_in_center_unit,
                    center,
                    ccw: start_radians < end_radians,
                };

                let mut new_sketch = sketch.clone();
                if let Some(tag) = &tag {
                    new_sketch.add_tag(tag, &current_path, exec_state, None);
                }

                new_sketch.paths.push(current_path);

                outer_sketch = Some(new_sketch);
            }
            SegmentKind::ControlPointSpline { controls, degree, .. } => {
                let mut curve_controls = spline_controls_to_units(controls, sketch.units, range)?;
                if traversal == SegmentTraversal::Reverse {
                    curve_controls.reverse();
                }

                exec_state
                    .batch_modeling_cmd(
                        ModelingCmdMeta::with_id(exec_state, ctx, range, segment.id),
                        ModelingCmd::from(
                            mcmd::ExtendPath::builder()
                                .path(sketch.id.into())
                                .segment(PathSegment::Curve {
                                    degree: *degree,
                                    rational: false,
                                    points: spline_controls_to_engine_points(&curve_controls, sketch.units),
                                    relative: false,
                                })
                                .build(),
                        ),
                    )
                    .await?;

                let from = sketch.current_pen_position()?;
                let to = *curve_controls.last().ok_or_else(|| {
                    KclError::new_internal(KclErrorDetails::new(
                        "Control point spline is missing control points".to_owned(),
                        vec![range],
                    ))
                })?;
                let loops_back_to_start = closes_path(to, sketch.start.from);

                let current_path = Path::ControlPointSpline {
                    base: BasePath {
                        from: from.ignore_units(),
                        to,
                        tag: tag.clone(),
                        units: sketch.units,
                        geo_meta: GeoMeta {
                            id: segment.id,
                            metadata: range.into(),
                        },
                    },
                    controls: curve_controls,
                    degree: *degree,
                };

                let mut new_sketch = sketch.clone();
                if let Some(tag) = &tag {
                    new_sketch.add_tag(tag, &current_path, exec_state, None);
                }
                if loops_back_to_start {
                    new_sketch.is_closed = crate::execution::ProfileClosed::Implicitly;
                }

                new_sketch.paths.push(current_path);
                outer_sketch = Some(new_sketch);
            }
        }
    }

    // Add the sketch to each segment.
    if outer_sketch.is_some() {
        for segment in segments {
            segment.sketch = outer_sketch.clone();
        }
    }

    Ok(outer_sketch)
}

#[cfg(test)]
mod tests {
    use indexmap::IndexMap;
    use kcl_error::SourceRange;

    use super::create_segments_in_engine;
    use super::spline_controls_to_engine_points;
    use crate::ExecState;
    use crate::ExecutorContext;
    use crate::execution::Path;
    use crate::execution::Plane;
    use crate::execution::Segment;
    use crate::execution::SegmentKind;
    use crate::execution::SketchSurface;
    use crate::front::ControlPointSplineCtor;
    use crate::front::ObjectId;
    use crate::std::args::TyF64;
    use crate::std::sketch::PlaneData;
    use kittycad_modeling_cmds::units::UnitLength;

    #[test]
    fn spline_curve_points_skip_entry_control() {
        let controls = vec![[0.0, 0.0], [10.0, 20.0], [20.0, 0.0], [30.0, 10.0]];
        let curve_points = spline_controls_to_engine_points(&controls, UnitLength::Millimeters);

        assert_eq!(curve_points.len(), controls.len() - 1);
        assert_eq!(curve_points[0].x.0, 10.0);
        assert_eq!(curve_points[curve_points.len() - 1].x.0, 30.0);
        assert!(curve_points.iter().all(|point| point.w.0 == 1.0));
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn control_point_spline_lowering_uses_exact_curve_path() {
        let ctx = ExecutorContext::new_mock(None).await;
        let mut exec_state = ExecState::new(&ctx);
        let sketch_id = exec_state.next_uuid();
        let plane = Plane::from_plane_data_skipping_engine(PlaneData::XY, &mut exec_state).unwrap();
        let sketch_surface = SketchSurface::Plane(Box::new(plane));
        let mut segments = vec![Segment {
            id: exec_state.next_uuid(),
            object_id: ObjectId(100),
            kind: SegmentKind::ControlPointSpline {
                controls: vec![
                    [
                        TyF64::new(0.0, UnitLength::Millimeters.into()),
                        TyF64::new(0.0, UnitLength::Millimeters.into()),
                    ],
                    [
                        TyF64::new(12.0, UnitLength::Millimeters.into()),
                        TyF64::new(22.0, UnitLength::Millimeters.into()),
                    ],
                    [
                        TyF64::new(28.0, UnitLength::Millimeters.into()),
                        TyF64::new(22.0, UnitLength::Millimeters.into()),
                    ],
                    [
                        TyF64::new(40.0, UnitLength::Millimeters.into()),
                        TyF64::new(0.0, UnitLength::Millimeters.into()),
                    ],
                ],
                ctor: Box::new(ControlPointSplineCtor {
                    points: Vec::new(),
                    construction: None,
                }),
                control_object_ids: vec![ObjectId(101), ObjectId(102), ObjectId(103), ObjectId(104)],
                control_polygon_edge_object_ids: vec![ObjectId(105), ObjectId(106), ObjectId(107)],
                control_freedoms: Vec::new(),
                degree: 3,
                construction: false,
            },
            surface: sketch_surface.clone(),
            sketch_id,
            sketch: None,
            tag: None,
            node_path: None,
            meta: vec![],
        }];

        let sketch = create_segments_in_engine(
            &sketch_surface,
            sketch_id,
            &mut segments,
            &IndexMap::new(),
            &ctx,
            &mut exec_state,
            SourceRange::default(),
        )
        .await
        .unwrap()
        .expect("expected sketch output");

        assert_eq!(
            sketch.paths.len(),
            1,
            "expected one exact path, not sampled line segments"
        );
        match &sketch.paths[0] {
            Path::ControlPointSpline { controls, degree, .. } => {
                assert_eq!(*degree, 3);
                assert_eq!(controls.len(), 4);
                assert_eq!(controls[0], [0.0, 0.0]);
                assert_eq!(controls[3], [40.0, 0.0]);
            }
            other => panic!("expected exact control point spline path, got {other:?}"),
        }

        ctx.close().await;
    }
}
