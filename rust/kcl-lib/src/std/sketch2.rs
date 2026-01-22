use kcl_error::SourceRange;
use kittycad_modeling_cmds::{ModelingCmd, each_cmd as mcmd, length_unit::LengthUnit, shared::Point2d as KPoint2d};

use crate::{
    ExecState, ExecutorContext, KclError,
    errors::KclErrorDetails,
    exec::{NumericType, Sketch},
    execution::{BasePath, GeoMeta, ModelingCmdMeta, Path, Segment, SegmentKind, SketchSurface},
    std::{
        args::TyF64,
        sketch::{StraightLineParams, inner_start_profile, relative_arc, straight_line},
        utils::{distance, point_to_len_unit, point_to_mm, untype_point},
    },
    std_utils::untyped_point_to_unit,
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
