use std::collections::HashMap;
use std::f64::consts::TAU;

use indexmap::IndexMap;
use kcl_error::SourceRange;
use kittycad_modeling_cmds::ModelingCmd;
use kittycad_modeling_cmds::each_cmd as mcmd;
use kittycad_modeling_cmds::length_unit::LengthUnit;
use kittycad_modeling_cmds::ok_response::OkModelingCmdResponse;
use kittycad_modeling_cmds::shared::Angle as KAngle;
use kittycad_modeling_cmds::shared::PathSegment;
use kittycad_modeling_cmds::shared::Point2d as KPoint2d;
use kittycad_modeling_cmds::units::UnitLength;
use kittycad_modeling_cmds::websocket::OkWebSocketResponseData;
use uuid::Uuid;

use crate::ExecState;
use crate::ExecutorContext;
use crate::KclError;
use crate::errors::KclErrorDetails;
use crate::exec::KclValue;
use crate::exec::NumericType;
use crate::exec::Sketch;
use crate::execution::BasePath;
use crate::execution::GeoMeta;
use crate::execution::Metadata;
use crate::execution::ModelingCmdMeta;
use crate::execution::Path;
use crate::execution::ProfileClosed;
use crate::execution::SKETCH_OBJECT_META;
use crate::execution::SKETCH_OBJECT_META_SKETCH;
use crate::execution::Segment;
use crate::execution::SegmentKind;
use crate::execution::SketchSurface;
use crate::execution::types::ArrayLen;
use crate::execution::types::RuntimeType;
use crate::front::ObjectId;
use crate::parsing::ast::types::TagNode;
use crate::std::Args;
use crate::std::CircularDirection;
use crate::std::args::FromKclValue;
use crate::std::args::TyF64;
use crate::std::shapes::SketchOrSurface;
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
            SegmentKind::Circle { start, .. } => start.clone(),
        };

        // Get the source range of the segment from its metadata, falling back to the sketch block's.
        let default_meta = Metadata {
            source_range: sketch_block_range,
        };
        let meta = segment.meta.first().unwrap_or(&default_meta);
        let range = meta.source_range;

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

                let sketch_surface = SketchOrSurface::Sketch(Box::new(sketch.clone())).into_sketch_surface();
                let units = center_ty.as_length().unwrap_or(UnitLength::Millimeters);
                let from = start_in_center_unit;
                let from_t = [TyF64::new(from[0], center_ty), TyF64::new(from[1], center_ty)];

                let sketch =
                    crate::std::sketch::inner_start_profile(sketch_surface, from_t, None, exec_state, ctx, range)
                        .await?;

                let id = exec_state.next_uuid();

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

                let mut new_sketch = sketch;
                if let Some(tag) = &tag {
                    new_sketch.add_tag(tag, &current_path, exec_state, None);
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

pub(super) async fn region(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let point = args.get_kw_arg_opt(
        "point",
        &RuntimeType::Union(vec![RuntimeType::point2d(), RuntimeType::segment()]),
        exec_state,
    )?;
    let segments = args.get_kw_arg_opt(
        "segments",
        &RuntimeType::Array(Box::new(RuntimeType::segment()), ArrayLen::Minimum(1)),
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

    let (sketch_or_segment, region_mapping) = match (point, segments) {
        (Some(point), None) => {
            let (sketch, pt) = region_from_point(point, sketch, &args)?;

            let meta = ModelingCmdMeta::from_args_id(exec_state, &args, region_id);
            let response = exec_state
                .send_modeling_cmd(
                    meta,
                    ModelingCmd::from(
                        mcmd::CreateRegionFromQueryPoint::builder()
                            .object_id(sketch.sketch()?.id)
                            .query_point(KPoint2d::from(point_to_mm(pt.clone())).map(LengthUnit))
                            .build(),
                    ),
                )
                .await?;

            let region_mapping = if let OkWebSocketResponseData::Modeling {
                modeling_response: OkModelingCmdResponse::CreateRegionFromQueryPoint(data),
            } = response
            {
                data.region_mapping
            } else {
                Default::default()
            };

            (sketch, region_mapping)
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
            let mut segments = segments.into_iter();
            let Some(seg0_value) = segments.next() else {
                return Err(KclError::new_argument(KclErrorDetails::new(
                    format!("Expected at least 1 segment to create a region, but got {segments_len}"),
                    vec![args.source_range],
                )));
            };
            let seg1_value = segments.next().unwrap_or_else(|| seg0_value.clone());
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
            let response = exec_state
                .send_modeling_cmd(
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

            let region_mapping = if let OkWebSocketResponseData::Modeling {
                modeling_response: OkModelingCmdResponse::CreateRegion(data),
            } = response
            {
                data.region_mapping
            } else {
                Default::default()
            };

            (SketchOrSegment::Segment(seg0), region_mapping)
        }
        (Some(_), Some(_)) => {
            return Err(KclError::new_semantic(KclErrorDetails::new(
                "Cannot provide both point and segments parameters. Choose one.".to_owned(),
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
                    region_mapping: Default::default(),
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

    let mut region_mapping = region_mapping;
    if args.ctx.no_engine_commands().await && region_mapping.is_empty() {
        // In mock mode, we need to create fake segment IDs so that tags can be
        // found.
        let mut mock_mapping = HashMap::new();
        for path in &sketch.paths {
            mock_mapping.insert(exec_state.next_uuid(), path.get_id());
        }
        region_mapping = mock_mapping;
    }
    // Build reverse map: original_seg_id -> Vec<region_seg_id>
    let original_segment_ids = sketch.paths.iter().map(|p| p.get_id()).collect::<Vec<_>>();
    sketch.region_mapping = build_reverse_region_mapping(&region_mapping, &original_segment_ids);

    // Early expansion: replace paths and update tags to use region segment IDs.
    {
        // Replace paths with region-segment paths.
        let mut new_paths = Vec::new();
        for path in &sketch.paths {
            let original_id = path.get_id();
            if let Some(region_ids) = sketch.region_mapping.get(&original_id) {
                for region_id in region_ids {
                    let mut new_path = path.clone();
                    new_path.set_id(*region_id);
                    new_paths.push(new_path);
                }
            }
            // Paths not in region_mapping are dropped (not part of region).
        }
        sketch.paths = new_paths;

        // Update tag engine infos to use region segment IDs.
        for (_tag_name, tag) in &mut sketch.tags {
            let Some(info) = tag.get_cur_info().cloned() else {
                continue;
            };
            let original_id = info.id;
            if let Some(region_ids) = sketch.region_mapping.get(&original_id) {
                let epoch = tag.info.last().map(|(e, _)| *e).unwrap_or(0);
                // First entry: update existing info's ID.
                // Additional entries: clone and push with new IDs.
                for (i, region_id) in region_ids.iter().enumerate() {
                    if i == 0 {
                        if let Some((_, existing)) = tag.info.last_mut() {
                            existing.id = *region_id;
                        }
                    } else {
                        let mut new_info = info.clone();
                        new_info.id = *region_id;
                        tag.info.push((epoch, new_info));
                    }
                }
            }
        }
    }

    sketch.meta.push(args.source_range.into());
    // The engine always returns a closed Solid2d for a region.
    sketch.is_closed = ProfileClosed::Explicitly;

    Ok(KclValue::Sketch {
        value: Box::new(sketch),
    })
}

/// The region mapping returned from the engine maps from region segment ID to
/// the original sketch segment ID. Create the reverse mapping, i.e. original
/// sketch segment ID to region segment IDs, where the entries are ordered by
/// the given original segments.
///
/// This runs in O(r + s) where r is the number of segments in the region, and s
/// is the number of segments in the original sketch. Technically, it's more
/// complicated since we also sort region segments, but in practice, there
/// should be very few of these.
pub(crate) fn build_reverse_region_mapping(
    region_mapping: &HashMap<Uuid, Uuid>,
    original_segments: &[Uuid],
) -> IndexMap<Uuid, Vec<Uuid>> {
    // Build reverse map: original_seg_id -> Vec<region_seg_id>
    let mut reverse: HashMap<Uuid, Vec<Uuid>> = HashMap::default();
    #[expect(
        clippy::iter_over_hash_type,
        reason = "This is bad since we're storing in an ordered Vec, but modeling-cmds gives us an unordered HashMap, so we don't really have a choice. This function exists to work around that."
    )]
    for (region_id, original_id) in region_mapping {
        reverse.entry(*original_id).or_default().push(*region_id);
    }
    // Sort the values so that they're deterministic. The engine uses
    // UUIDv5s, so the relative order shouldn't change across runs.
    #[expect(
        clippy::iter_over_hash_type,
        reason = "This is safe since we're just sorting values."
    )]
    for values in reverse.values_mut() {
        values.sort_unstable();
    }
    // Create the order. The region_mapping is unordered, so never use any order
    // that comes out of it. Use the order of the original segments.
    let mut ordered = IndexMap::with_capacity(original_segments.len());
    for original_id in original_segments {
        let mut region_ids = Vec::new();
        reverse.entry(*original_id).and_modify(|entry_value| {
            region_ids = std::mem::take(entry_value);
        });
        // Not every original segment will be in the region. Omit those.
        if !region_ids.is_empty() {
            ordered.insert(*original_id, region_ids);
        }
    }
    ordered
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
