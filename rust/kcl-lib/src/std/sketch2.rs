use kcl_error::SourceRange;
use kittycad_modeling_cmds::{ModelingCmd, each_cmd as mcmd, length_unit::LengthUnit, shared::Point2d as KPoint2d};

use crate::{
    ExecState, ExecutorContext, KclError,
    errors::KclErrorDetails,
    exec::{KclValue, Sketch},
    execution::{
        BasePath, GeoMeta, ModelingCmdMeta, Path, Segment, SegmentKind, SketchSurface,
        types::{ArrayLen, RuntimeType},
    },
    std::{
        Args, CircularDirection,
        args::TyF64,
        sketch::{StraightLineParams, inner_start_profile, straight_line},
        utils::{point_to_len_unit, point_to_mm},
    },
};

pub(crate) async fn create_segments_in_engine(
    sketch_surface: &SketchSurface,
    segments: &[Segment],
    ctx: &ExecutorContext,
    exec_state: &mut ExecState,
    range: SourceRange,
) -> Result<(), KclError> {
    let mut outer_sketch: Option<Sketch> = None;
    for segment in segments {
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
            let sketch = inner_start_profile(sketch_surface.clone(), start, None, exec_state, ctx, range).await?;
            outer_sketch = Some(sketch);
        };

        let Some(sketch) = &outer_sketch else {
            return Err(KclError::new_internal(KclErrorDetails::new(
                "Sketch should have been initialized before creating segments".to_owned(),
                vec![range],
            )));
        };

        match &segment.kind {
            SegmentKind::Point { .. } => {
                // TODO: In the engine, points currently need to be their own
                // path. Skipping them for now.
                debug_assert!(false, "Points should have been skipped earlier");
                continue;
            }
            SegmentKind::Line { end, .. } => {
                let sketch = straight_line(
                    StraightLineParams::absolute(end.clone(), sketch.clone(), None),
                    exec_state,
                    ctx,
                    range,
                )
                .await?;
                outer_sketch = Some(sketch);
            }
            SegmentKind::Arc { .. } => {
                return Err(KclError::new_internal(KclErrorDetails::new(
                    "Arc segments are not yet implemented in create_segments_in_engine".to_owned(),
                    vec![range],
                )));
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
    let [seg0, seg1]: [KclValue; 2] = segments.try_into().map_err(|_| {
        KclError::new_argument(KclErrorDetails::new(
            format!("Expected exactly 2 segments to create a region, but got {segments_len}"),
            vec![args.source_range],
        ))
    })?;
    let Some(seg0_engine_id) = seg0.as_segment().map(|s| s.id) else {
        return Err(KclError::new_argument(KclErrorDetails::new(
            "Expected first segment to be a Segment".to_owned(),
            vec![args.source_range],
        )));
    };
    let Some(seg1_engine_id) = seg1.as_segment().map(|s| s.id) else {
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
                    .segment(seg0_engine_id)
                    .intersection_segment(seg1_engine_id)
                    .intersection_index(intersection_index)
                    .curve_clockwise(direction.is_clockwise())
                    .build(),
            ),
        )
        .await?;

    Ok(KclValue::none())
}
