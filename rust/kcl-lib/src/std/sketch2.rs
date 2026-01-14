use kcl_error::SourceRange;
use kittycad_modeling_cmds::{ModelingCmd, each_cmd as mcmd, length_unit::LengthUnit, shared::Point2d as KPoint2d};

use crate::{
    ExecState, ExecutorContext, KclError,
    errors::KclErrorDetails,
    exec::Sketch,
    execution::{BasePath, GeoMeta, ModelingCmdMeta, Path, Segment, SegmentKind, SketchSurface},
    std::{
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
