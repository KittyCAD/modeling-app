use kcl_error::SourceRange;
use kittycad_modeling_cmds::{ModelingCmd, each_cmd as mcmd, length_unit::LengthUnit, shared::Point2d as KPoint2d};
use uuid::Uuid;

use crate::{
    ExecState, ExecutorContext, KclError,
    errors::KclErrorDetails,
    exec::{KclValue, NumericType, Sketch},
    execution::{
        BasePath, GeoMeta, ModelingCmdMeta, Path, ProfileClosed, Segment, SegmentKind, SketchSurface,
        types::{ArrayLen, RuntimeType},
    },
    std::{
        Args, CircularDirection,
        args::TyF64,
        sketch::{StraightLineParams, create_sketch, relative_arc, straight_line},
        utils::{distance, point_to_len_unit, point_to_mm, untype_point},
    },
    std_utils::untyped_point_to_unit,
};

pub(crate) async fn create_segments_in_engine(
    sketch_surface: &SketchSurface,
    sketch_engine_id: Uuid,
    segments: &mut [Segment],
    ctx: &ExecutorContext,
    exec_state: &mut ExecState,
    range: SourceRange,
) -> Result<(), KclError> {
    let mut outer_sketch: Option<Sketch> = None;
    for segment in segments {
        if segment.is_construction() {
            // Don't send construction segments to the engine.
            continue;
        }

        // The start point.
        let start = match &segment.kind {
            SegmentKind::Point { .. } => {
                // TODO: In the engine, points currently need to be their own
                // path. Skipping them for now.
                continue;
            }
            SegmentKind::Line { start, .. } => start.clone(),
            SegmentKind::Arc { start, .. } => start.clone(),
        };

        if let Some(sketch) = &mut outer_sketch {
            // TODO: Check if we're within tolerance of the last point. If so,
            // we can skip moving the pen.

            // Move the path pen.
            let id = exec_state.next_uuid();
            exec_state
                .batch_modeling_cmd(
                    ModelingCmdMeta::with_id(exec_state, ctx, range, id),
                    ModelingCmd::from(
                        mcmd::MovePathPen::builder()
                            .path(sketch.id.into())
                            .to(KPoint2d::from(point_to_mm(start.clone())).with_z(0.0).map(LengthUnit))
                            .build(),
                    ),
                )
                .await?;
            // Store the current location in the sketch.
            let previous_base = sketch.paths.last().map(|p| p.get_base()).unwrap_or(&sketch.start);
            let base = BasePath {
                from: previous_base.to,
                to: point_to_len_unit(start, sketch.units),
                units: previous_base.units,
                tag: None,
                geo_meta: GeoMeta {
                    id,
                    metadata: range.into(),
                },
            };
            sketch.paths.push(Path::ToPoint { base });
        } else {
            // Create a new path.
            let sketch = create_sketch(
                sketch_engine_id,
                sketch_surface.clone(),
                start,
                None,
                exec_state,
                ctx,
                range,
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

        match &segment.kind {
            SegmentKind::Point { .. } => {
                debug_assert!(false, "Points should have been skipped earlier");
                continue;
            }
            SegmentKind::Line { end, .. } => {
                let sketch = straight_line(
                    segment.id,
                    StraightLineParams::absolute(end.clone(), sketch.clone(), None),
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
                let start_in_center_unit = untyped_point_to_unit(start, start_unit, center_unit);
                let end_in_center_unit = untyped_point_to_unit(end, end_unit, center_unit);
                let start_radians =
                    libm::atan2(start_in_center_unit[1] - center[1], start_in_center_unit[0] - center[0]);
                let mut end_radians = libm::atan2(end_in_center_unit[1] - center[1], end_in_center_unit[0] - center[0]);
                // Sketch-solve arcs always go counterclockwise.
                if end_radians <= start_radians {
                    end_radians += std::f64::consts::TAU;
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
                    None,
                    ctx,
                    range,
                )
                .await?;
                outer_sketch = Some(sketch);
            }
        }
    }
    Ok(())
}

pub(super) async fn region(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let segments: Vec<KclValue> = args.get_kw_arg(
        "segments",
        &RuntimeType::Array(Box::new(RuntimeType::segment()), ArrayLen::Known(2)),
        exec_state,
    )?;
    let intersection_index = args.get_kw_arg_opt("intersectionIndex", &RuntimeType::count(), exec_state)?;
    let direction = args.get_kw_arg_opt("direction", &RuntimeType::string(), exec_state)?;
    inner_region(segments, intersection_index, direction, exec_state, args).await
}

async fn inner_region(
    segments: Vec<KclValue>,
    intersection_index: Option<TyF64>,
    direction: Option<CircularDirection>,
    exec_state: &mut ExecState,
    args: Args,
) -> Result<KclValue, KclError> {
    let segments_len = segments.len();
    let [seg0_value, seg1_value]: [KclValue; 2] = segments.try_into().map_err(|_| {
        KclError::new_argument(KclErrorDetails::new(
            format!("Expected exactly 2 segments to create a region, but got {segments_len}"),
            vec![args.source_range],
        ))
    })?;
    let Some(seg0) = seg0_value.as_segment() else {
        return Err(KclError::new_argument(KclErrorDetails::new(
            "Expected first segment to be a Segment".to_owned(),
            vec![args.source_range],
        )));
    };
    let Some(seg1) = seg1_value.as_segment() else {
        return Err(KclError::new_argument(KclErrorDetails::new(
            "Expected second segment to be a Segment".to_owned(),
            vec![args.source_range],
        )));
    };
    let intersection_index = intersection_index.map(|n| n.n as i32).unwrap_or(-1);
    let direction = direction.unwrap_or(CircularDirection::Counterclockwise);

    let region_id = exec_state.next_uuid();
    let meta = ModelingCmdMeta::from_args_id(exec_state, &args, region_id);
    exec_state
        .batch_modeling_cmd(
            meta,
            ModelingCmd::from(
                mcmd::CreateRegion::builder()
                    .object_id(seg0.sketch_id)
                    .segment(seg0.id)
                    .intersection_segment(seg1.id)
                    .intersection_index(intersection_index)
                    .curve_clockwise(direction.is_clockwise())
                    .build(),
            ),
        )
        .await?;

    let units = exec_state.length_unit();
    // Dummy to-coordinate.
    let to = [0.0, 0.0];
    // Dummy path so that paths is never empty, as long as the segment ID is
    // valid. It's used by `do_post_extrude`.
    let first_path = Path::ToPoint {
        base: BasePath {
            from: to,
            to,
            units,
            tag: None,
            geo_meta: GeoMeta {
                id: seg0.id,
                metadata: args.source_range.into(),
            },
        },
    };
    let start_base_path = BasePath {
        from: to,
        to,
        tag: None,
        units,
        geo_meta: GeoMeta {
            id: region_id,
            metadata: args.source_range.into(),
        },
    };
    let sketch = Sketch {
        id: region_id,
        original_id: region_id,
        artifact_id: region_id.into(),
        on: seg0.surface.clone(),
        paths: vec![first_path],
        inner_paths: vec![],
        units,
        mirror: Default::default(),
        clone: Default::default(),
        meta: vec![args.source_range.into()],
        tags: Default::default(),
        start: start_base_path,
        // The engine always returns a closed Solid2d.
        is_closed: ProfileClosed::Explicitly,
    };
    Ok(KclValue::Sketch {
        value: Box::new(sketch),
    })
}
