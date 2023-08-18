//! Functions related to line segments.

use crate::{
    errors::{KclError, KclErrorDetails},
    executor::MemoryItem,
    std::{utils::get_angle, Args},
};

use anyhow::Result;

/// Returns the segment end of x.
pub fn segment_end_x(args: &mut Args) -> Result<MemoryItem, KclError> {
    let (segment_name, sketch_group) = args.get_segment_name_sketch_group()?;
    let line = sketch_group
        .get_base_by_name_or_start(&segment_name)
        .ok_or_else(|| {
            KclError::Type(KclErrorDetails {
                message: format!(
                    "Expected a segment name that exists in the given SketchGroup, found `{}`",
                    segment_name
                ),
                source_ranges: vec![args.source_range],
            })
        })?;

    args.make_user_val_from_f64(line.to[0])
}

/// Returns the segment end of y.
pub fn segment_end_y(args: &mut Args) -> Result<MemoryItem, KclError> {
    let (segment_name, sketch_group) = args.get_segment_name_sketch_group()?;
    let line = sketch_group
        .get_base_by_name_or_start(&segment_name)
        .ok_or_else(|| {
            KclError::Type(KclErrorDetails {
                message: format!(
                    "Expected a segment name that exists in the given SketchGroup, found `{}`",
                    segment_name
                ),
                source_ranges: vec![args.source_range],
            })
        })?;

    args.make_user_val_from_f64(line.to[1])
}

/// Returns the last segment of x.
pub fn last_segment_x(args: &mut Args) -> Result<MemoryItem, KclError> {
    let sketch_group = args.get_sketch_group()?;
    let last_line = sketch_group
        .value
        .last()
        .ok_or_else(|| {
            KclError::Type(KclErrorDetails {
                message: format!(
                    "Expected a SketchGroup with at least one segment, found `{:?}`",
                    sketch_group
                ),
                source_ranges: vec![args.source_range],
            })
        })?
        .get_base();

    args.make_user_val_from_f64(last_line.to[0])
}

/// Returns the last segment of y.
pub fn last_segment_y(args: &mut Args) -> Result<MemoryItem, KclError> {
    let sketch_group = args.get_sketch_group()?;
    let last_line = sketch_group
        .value
        .last()
        .ok_or_else(|| {
            KclError::Type(KclErrorDetails {
                message: format!(
                    "Expected a SketchGroup with at least one segment, found `{:?}`",
                    sketch_group
                ),
                source_ranges: vec![args.source_range],
            })
        })?
        .get_base();

    args.make_user_val_from_f64(last_line.to[1])
}

/// Returns the length of the segment.
pub fn segment_length(args: &mut Args) -> Result<MemoryItem, KclError> {
    let (segment_name, sketch_group) = args.get_segment_name_sketch_group()?;
    let path = sketch_group
        .get_path_by_name(&segment_name)
        .ok_or_else(|| {
            KclError::Type(KclErrorDetails {
                message: format!(
                    "Expected a segment name that exists in the given SketchGroup, found `{}`",
                    segment_name
                ),
                source_ranges: vec![args.source_range],
            })
        })?;
    let line = path.get_base();

    let result = ((line.from[1] - line.to[1]).powi(2) + (line.from[0] - line.to[0]).powi(2)).sqrt();
    args.make_user_val_from_f64(result)
}

/// Returns the angle of the segment.
pub fn segment_angle(args: &mut Args) -> Result<MemoryItem, KclError> {
    let (segment_name, sketch_group) = args.get_segment_name_sketch_group()?;
    let path = sketch_group
        .get_path_by_name(&segment_name)
        .ok_or_else(|| {
            KclError::Type(KclErrorDetails {
                message: format!(
                    "Expected a segment name that exists in the given SketchGroup, found `{}`",
                    segment_name
                ),
                source_ranges: vec![args.source_range],
            })
        })?;
    let line = path.get_base();

    let result = get_angle(&line.from, &line.to);
    args.make_user_val_from_f64(result)
}

/// Returns the angle to match the given length for x.
pub fn angle_to_match_length_x(args: &mut Args) -> Result<MemoryItem, KclError> {
    let (segment_name, to, sketch_group) = args.get_segment_name_to_number_sketch_group()?;
    let path = sketch_group
        .get_path_by_name(&segment_name)
        .ok_or_else(|| {
            KclError::Type(KclErrorDetails {
                message: format!(
                    "Expected a segment name that exists in the given SketchGroup, found `{}`",
                    segment_name
                ),
                source_ranges: vec![args.source_range],
            })
        })?;
    let line = path.get_base();

    let length = ((line.from[1] - line.to[1]).powi(2) + (line.from[0] - line.to[0]).powi(2)).sqrt();

    let last_line = sketch_group
        .value
        .last()
        .ok_or_else(|| {
            KclError::Type(KclErrorDetails {
                message: format!(
                    "Expected a SketchGroup with at least one segment, found `{:?}`",
                    sketch_group
                ),
                source_ranges: vec![args.source_range],
            })
        })?
        .get_base();

    let diff = (to - last_line.to[0]).abs();

    let angle_r = diff / length.acos();

    if diff > length {
        args.make_user_val_from_f64(0.0)
    } else {
        args.make_user_val_from_f64(angle_r * 180.0 / std::f64::consts::PI)
    }
}

/// Returns the angle to match the given length for y.
pub fn angle_to_match_length_y(args: &mut Args) -> Result<MemoryItem, KclError> {
    let (segment_name, to, sketch_group) = args.get_segment_name_to_number_sketch_group()?;
    let path = sketch_group
        .get_path_by_name(&segment_name)
        .ok_or_else(|| {
            KclError::Type(KclErrorDetails {
                message: format!(
                    "Expected a segment name that exists in the given SketchGroup, found `{}`",
                    segment_name
                ),
                source_ranges: vec![args.source_range],
            })
        })?;
    let line = path.get_base();

    let length = ((line.from[1] - line.to[1]).powi(2) + (line.from[0] - line.to[0]).powi(2)).sqrt();

    let last_line = sketch_group
        .value
        .last()
        .ok_or_else(|| {
            KclError::Type(KclErrorDetails {
                message: format!(
                    "Expected a SketchGroup with at least one segment, found `{:?}`",
                    sketch_group
                ),
                source_ranges: vec![args.source_range],
            })
        })?
        .get_base();

    let diff = (to - last_line.to[1]).abs();

    let angle_r = diff / length.asin();

    if diff > length {
        args.make_user_val_from_f64(0.0)
    } else {
        args.make_user_val_from_f64(angle_r * 180.0 / std::f64::consts::PI)
    }
}
