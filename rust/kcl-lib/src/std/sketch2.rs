use indexmap::IndexMap;
use kcl_error::SourceRange;
use kittycad_modeling_cmds::{ModelingCmd, each_cmd as mcmd, length_unit::LengthUnit, shared::Point2d as KPoint2d};
use uuid::Uuid;

use crate::{
    ExecState, ExecutorContext, KclError,
    errors::KclErrorDetails,
    exec::{KclValue, NumericType, Sketch},
    execution::{
        BasePath, GeoMeta, ModelingCmdMeta, Path, ProfileClosed, SKETCH_OBJECT_META, SKETCH_OBJECT_META_SKETCH,
        Segment, SegmentKind, SketchSurface,
        types::{ArrayLen, RuntimeType},
    },
    front::ObjectId,
    parsing::ast::types::TagNode,
    std::{
        Args, CircularDirection,
        args::{FromKclValue, TyF64},
        sketch::{StraightLineParams, create_sketch, relative_arc, straight_line},
        utils::{distance, point_to_len_unit, point_to_mm, untype_point},
    },
    std_utils::untyped_point_to_unit,
};

/// Create the Sketch and send to the engine. Return will be None if there are
/// no segments.
pub(crate) async fn create_segments_in_engine(
    sketch_surface: &SketchSurface,
    sketch_engine_id: Uuid,
    segments: &mut [Segment],
    segment_tags: &IndexMap<ObjectId, TagNode>,
    ctx: &ExecutorContext,
    exec_state: &mut ExecState,
    range: SourceRange,
) -> Result<Option<Sketch>, KclError> {
    let mut outer_sketch: Option<Sketch> = None;
    for segment in segments.iter() {
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
            if !exec_state.sketch_mode() {
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
            }
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
                !exec_state.sketch_mode(),
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

        let tag = segment_tags.get(&segment.object_id).cloned();

        match &segment.kind {
            SegmentKind::Point { .. } => {
                debug_assert!(false, "Points should have been skipped earlier");
                continue;
            }
            SegmentKind::Line { end, .. } => {
                let sketch = straight_line(
                    segment.id,
                    StraightLineParams::absolute(end.clone(), sketch.clone(), tag),
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
                    tag,
                    !exec_state.sketch_mode(),
                    ctx,
                    range,
                )
                .await?;
                outer_sketch = Some(sketch);
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

pub(super) async fn region(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let point = args.get_kw_arg_opt(
        "point",
        &RuntimeType::Union(vec![RuntimeType::point2d(), RuntimeType::segment()]),
        exec_state,
    )?;
    let segments = args.get_kw_arg_opt(
        "segments",
        &RuntimeType::Array(Box::new(RuntimeType::segment()), ArrayLen::Known(2)),
        exec_state,
    )?;
    let intersection_index = args.get_kw_arg_opt("intersectionIndex", &RuntimeType::count(), exec_state)?;
    let direction = args.get_kw_arg_opt("direction", &RuntimeType::string(), exec_state)?;
    let sketch = args.get_kw_arg_opt("sketch", &RuntimeType::any(), exec_state)?;
    inner_region(point, segments, intersection_index, direction, sketch, exec_state, args).await
}

/// Helper enum to reduce cloning of Sketch and Segment in the two branches of
/// region creation.
#[expect(clippy::large_enum_variant)]
enum SketchOrSegment {
    Sketch(Sketch),
    Segment(Segment),
}

impl SketchOrSegment {
    fn sketch(&self) -> Result<&Sketch, KclError> {
        match self {
            SketchOrSegment::Sketch(sketch) => Ok(sketch),
            SketchOrSegment::Segment(segment) => segment.sketch.as_ref().ok_or_else(|| {
                KclError::new_semantic(KclErrorDetails::new(
                    "Segment should have an associated sketch".to_owned(),
                    vec![],
                ))
            }),
        }
    }
}

async fn inner_region(
    point: Option<KclValue>,
    segments: Option<Vec<KclValue>>,
    intersection_index: Option<TyF64>,
    direction: Option<CircularDirection>,
    sketch: Option<KclValue>,
    exec_state: &mut ExecState,
    args: Args,
) -> Result<KclValue, KclError> {
    let region_id = exec_state.next_uuid();

    let sketch_or_segment = match (point, segments) {
        (Some(point), None) => {
            let (sketch, pt) = region_from_point(point, sketch, &args)?;

            let meta = ModelingCmdMeta::from_args_id(exec_state, &args, region_id);
            exec_state
                .batch_modeling_cmd(
                    meta,
                    ModelingCmd::from(
                        mcmd::CreateRegionFromQueryPoint::builder()
                            .object_id(sketch.sketch()?.id)
                            .query_point(KPoint2d::from(point_to_mm(pt.clone())).map(LengthUnit))
                            .build(),
                    ),
                )
                .await?;

            sketch
        }
        (None, Some(segments)) => {
            if sketch.is_some() {
                // Don't allow an explicit sketch to be passed in. It creates a
                // problematic case if it doesn't match the sketch of the
                // segments.
                return Err(KclError::new_semantic(KclErrorDetails::new(
                    "Sketch parameter must not be provided when segments parameters is provided".to_owned(),
                    vec![args.source_range],
                )));
            }
            let segments_len = segments.len();
            let [seg0_value, seg1_value]: [KclValue; 2] = segments.try_into().map_err(|_| {
                KclError::new_argument(KclErrorDetails::new(
                    format!("Expected exactly 2 segments to create a region, but got {segments_len}"),
                    vec![args.source_range],
                ))
            })?;
            let Some(seg0) = seg0_value.into_segment() else {
                return Err(KclError::new_argument(KclErrorDetails::new(
                    "Expected first segment to be a Segment".to_owned(),
                    vec![args.source_range],
                )));
            };
            let Some(seg1) = seg1_value.into_segment() else {
                return Err(KclError::new_argument(KclErrorDetails::new(
                    "Expected second segment to be a Segment".to_owned(),
                    vec![args.source_range],
                )));
            };
            let intersection_index = intersection_index.map(|n| n.n as i32).unwrap_or(-1);
            let direction = direction.unwrap_or(CircularDirection::Counterclockwise);

            let Some(sketch) = &seg0.sketch else {
                return Err(KclError::new_semantic(KclErrorDetails::new(
                    "Expected first segment to have an associated sketch. The sketch must be solved to create a region from it.".to_owned(),
                    vec![args.source_range],
                )));
            };

            let meta = ModelingCmdMeta::from_args_id(exec_state, &args, region_id);
            exec_state
                .batch_modeling_cmd(
                    meta,
                    ModelingCmd::from(
                        mcmd::CreateRegion::builder()
                            .object_id(sketch.id)
                            .segment(seg0.id)
                            .intersection_segment(seg1.id)
                            .intersection_index(intersection_index)
                            .curve_clockwise(direction.is_clockwise())
                            .build(),
                    ),
                )
                .await?;

            SketchOrSegment::Segment(seg0)
        }
        (Some(_), Some(_)) => {
            return Err(KclError::new_semantic(KclErrorDetails::new(
                "Both point and segments parameters must not be provided. Choose one.".to_owned(),
                vec![args.source_range],
            )));
        }
        (None, None) => {
            return Err(KclError::new_semantic(KclErrorDetails::new(
                "Either point or segments parameter must be provided".to_owned(),
                vec![args.source_range],
            )));
        }
    };

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
                id: match &sketch_or_segment {
                    SketchOrSegment::Sketch(sketch) => sketch.id,
                    SketchOrSegment::Segment(segment) => segment.id,
                },
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
    let mut sketch = match sketch_or_segment {
        SketchOrSegment::Sketch(sketch) => sketch,
        SketchOrSegment::Segment(segment) => {
            if let Some(sketch) = segment.sketch {
                sketch
            } else {
                Sketch {
                    id: region_id,
                    original_id: region_id,
                    artifact_id: region_id.into(),
                    on: segment.surface.clone(),
                    paths: vec![first_path],
                    inner_paths: vec![],
                    units,
                    mirror: Default::default(),
                    clone: Default::default(),
                    meta: vec![args.source_range.into()],
                    tags: Default::default(),
                    start: start_base_path,
                    is_closed: ProfileClosed::Explicitly,
                }
            }
        }
    };
    sketch.id = region_id;
    sketch.original_id = region_id;
    sketch.artifact_id = region_id.into();
    sketch.meta.push(args.source_range.into());
    // The engine always returns a closed Solid2d for a region.
    sketch.is_closed = ProfileClosed::Explicitly;

    Ok(KclValue::Sketch {
        value: Box::new(sketch),
    })
}

fn region_from_point(
    point: KclValue,
    sketch: Option<KclValue>,
    args: &Args,
) -> Result<(SketchOrSegment, [TyF64; 2]), KclError> {
    match point {
        KclValue::HomArray { .. } | KclValue::Tuple { .. } => {
            let Some(pt) = <[TyF64; 2]>::from_kcl_val(&point) else {
                return Err(KclError::new_semantic(KclErrorDetails::new(
                    "Expected 2D point for point parameter".to_owned(),
                    vec![args.source_range],
                )));
            };

            let Some(sketch_value) = sketch else {
                return Err(KclError::new_semantic(KclErrorDetails::new(
                    "Sketch must be provided when point is a 2D point".to_owned(),
                    vec![args.source_range],
                )));
            };
            let sketch = match sketch_value {
                KclValue::Sketch { value } => *value,
                KclValue::Object { value, .. } => {
                    let Some(meta_value) = value.get(SKETCH_OBJECT_META) else {
                        return Err(KclError::new_semantic(KclErrorDetails::new(
                            "Expected sketch to be of type Sketch with a meta field. Sketch must not be empty to create a region.".to_owned(),
                            vec![args.source_range],
                        )));
                    };
                    let meta_map = match meta_value {
                        KclValue::Object { value, .. } => value,
                        _ => {
                            return Err(KclError::new_semantic(KclErrorDetails::new(
                                "Expected sketch to be of type Sketch with a meta field that's an object".to_owned(),
                                vec![args.source_range],
                            )));
                        }
                    };
                    let Some(sketch_value) = meta_map.get(SKETCH_OBJECT_META_SKETCH) else {
                        return Err(KclError::new_semantic(KclErrorDetails::new(
                            "Expected sketch meta to have a sketch field. Sketch must not be empty to create a region."
                                .to_owned(),
                            vec![args.source_range],
                        )));
                    };
                    let Some(sketch) = sketch_value.as_sketch() else {
                        return Err(KclError::new_semantic(KclErrorDetails::new(
                            "Expected sketch meta to have a sketch field of type Sketch. Sketch must not be empty to create a region.".to_owned(),
                            vec![args.source_range],
                        )));
                    };
                    sketch.clone()
                }
                _ => {
                    return Err(KclError::new_semantic(KclErrorDetails::new(
                        "Expected sketch to be of type Sketch".to_owned(),
                        vec![args.source_range],
                    )));
                }
            };

            Ok((SketchOrSegment::Sketch(sketch), pt))
        }
        KclValue::Segment { value } => match value.repr {
            crate::execution::SegmentRepr::Unsolved { .. } => Err(KclError::new_semantic(KclErrorDetails::new(
                "Segment provided to point parameter is unsolved; segments must be solved to be used as points"
                    .to_owned(),
                vec![args.source_range],
            ))),
            crate::execution::SegmentRepr::Solved { segment } => {
                let pt = match &segment.kind {
                    SegmentKind::Point { position, .. } => position.clone(),
                    _ => {
                        return Err(KclError::new_semantic(KclErrorDetails::new(
                            "Expected segment to be a point segment".to_owned(),
                            vec![args.source_range],
                        )));
                    }
                };

                Ok((SketchOrSegment::Segment(*segment), pt))
            }
        },
        _ => Err(KclError::new_semantic(KclErrorDetails::new(
            "Expected point to be either a 2D point like `[0, 0]` or a point segment created from `point()`".to_owned(),
            vec![args.source_range],
        ))),
    }
}
