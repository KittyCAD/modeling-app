//! Functions related to line segments.

use anyhow::Result;
use derive_docs::stdlib;
use schemars::JsonSchema;

use super::utils::between;
use crate::{
    errors::{KclError, KclErrorDetails},
    executor::{MemoryItem, SketchGroup},
    std::Args,
};

/// Returns the segment end of x.
pub async fn segment_end_x(args: Args) -> Result<MemoryItem, KclError> {
    let (segment_name, sketch_group) = args.get_segment_name_sketch_group()?;
    let result = inner_segment_end_x(&segment_name, sketch_group, args.clone())?;

    args.make_user_val_from_f64(result)
}

/// Returns the segment end of x.
///
/// ```no_run
/// const exampleSketch = startSketchOn('-XZ')
///   |> startProfileAt([0, 0], %)
///   |> line([20, 0], %, "thing")
///   |> line([0, 5], %)
///   |> line([segEndX("thing", %), 0], %)
///   |> line([-20, 10], %)
///   |> close(%)
///  
/// const example = extrude(5, exampleSketch)
/// ```
#[stdlib {
    name = "segEndX",
}]
fn inner_segment_end_x(segment_name: &str, sketch_group: Box<SketchGroup>, args: Args) -> Result<f64, KclError> {
    let line = sketch_group.get_base_by_name_or_start(segment_name).ok_or_else(|| {
        KclError::Type(KclErrorDetails {
            message: format!(
                "Expected a segment name that exists in the given SketchGroup, found `{}`",
                segment_name
            ),
            source_ranges: vec![args.source_range],
        })
    })?;

    Ok(line.to[0])
}

/// Returns the segment end of y.
pub async fn segment_end_y(args: Args) -> Result<MemoryItem, KclError> {
    let (segment_name, sketch_group) = args.get_segment_name_sketch_group()?;
    let result = inner_segment_end_y(&segment_name, sketch_group, args.clone())?;

    args.make_user_val_from_f64(result)
}

/// Returns the segment end of y.
///
/// ```no_run
/// const exampleSketch = startSketchOn('-XZ')
///   |> startProfileAt([0, 0], %)
///   |> line([20, 0], %)
///   |> line([0, 3], %, "thing")
///   |> line([-10, 0], %)
///   |> line([0, segEndY("thing", %)], %)
///   |> line([-10, 0], %)
///   |> close(%)
///  
/// const example = extrude(5, exampleSketch)
/// ```
#[stdlib {
    name = "segEndY",
}]
fn inner_segment_end_y(segment_name: &str, sketch_group: Box<SketchGroup>, args: Args) -> Result<f64, KclError> {
    let line = sketch_group.get_base_by_name_or_start(segment_name).ok_or_else(|| {
        KclError::Type(KclErrorDetails {
            message: format!(
                "Expected a segment name that exists in the given SketchGroup, found `{}`",
                segment_name
            ),
            source_ranges: vec![args.source_range],
        })
    })?;

    Ok(line.to[1])
}

/// Returns the last segment of x.
pub async fn last_segment_x(args: Args) -> Result<MemoryItem, KclError> {
    let sketch_group = args.get_sketch_group()?;
    let result = inner_last_segment_x(sketch_group, args.clone())?;

    args.make_user_val_from_f64(result)
}

/// Returns the last segment of x.
///
/// ```no_run
/// const exampleSketch = startSketchOn("-XZ")
///   |> startProfileAt([0, 0], %)
///   |> line([5, 0], %)
///   |> line([20, 5], %)
///   |> line([0, lastSegX(%)], %)
///   |> line([-15, 0], %)
///   |> close(%)
///
/// const example = extrude(5, exampleSketch)
/// ```
#[stdlib {
    name = "lastSegX",
}]
fn inner_last_segment_x(sketch_group: Box<SketchGroup>, args: Args) -> Result<f64, KclError> {
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

    Ok(last_line.to[0])
}

/// Returns the last segment of y.
pub async fn last_segment_y(args: Args) -> Result<MemoryItem, KclError> {
    let sketch_group = args.get_sketch_group()?;
    let result = inner_last_segment_y(sketch_group, args.clone())?;

    args.make_user_val_from_f64(result)
}

/// Returns the last segment of y.
///
/// ```no_run
/// const exampleSketch = startSketchOn("-XZ")
///   |> startProfileAt([0, 0], %)
///   |> line([5, 0], %)
///   |> line([20, 5], %)
///   |> line([0, lastSegY(%)], %)
///   |> line([-15, 0], %)
///   |> close(%)
///
/// const example = extrude(5, exampleSketch)
/// ```
#[stdlib {
    name = "lastSegY",
}]
fn inner_last_segment_y(sketch_group: Box<SketchGroup>, args: Args) -> Result<f64, KclError> {
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

    Ok(last_line.to[1])
}

/// Returns the length of the segment.
pub async fn segment_length(args: Args) -> Result<MemoryItem, KclError> {
    let (segment_name, sketch_group) = args.get_segment_name_sketch_group()?;
    let result = inner_segment_length(&segment_name, sketch_group, args.clone())?;
    args.make_user_val_from_f64(result)
}

/// Returns the length of the segment.
///
/// ```no_run
/// const exampleSketch = startSketchOn("-XZ")
///   |> startProfileAt([0, 0], %)
///   |> angledLine({
///     angle: 60,
///     length: 10,
///   }, %, "thing")
///   |> tangentialArc({
///     offset: -120,
///     radius: 5,
///   }, %)
///   |> angledLine({
///     angle: -60,
///     length: segLen("thing", %),
///   }, %)
///   |> close(%)
///
/// const example = extrude(5, exampleSketch)
/// ```
#[stdlib {
    name = "segLen",
}]
fn inner_segment_length(segment_name: &str, sketch_group: Box<SketchGroup>, args: Args) -> Result<f64, KclError> {
    let path = sketch_group.get_path_by_name(segment_name).ok_or_else(|| {
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

    Ok(result)
}

/// Returns the angle of the segment.
pub async fn segment_angle(args: Args) -> Result<MemoryItem, KclError> {
    let (segment_name, sketch_group) = args.get_segment_name_sketch_group()?;

    let result = inner_segment_angle(&segment_name, sketch_group, args.clone())?;
    args.make_user_val_from_f64(result)
}

/// Returns the angle of the segment.
///
/// ```no_run
/// const exampleSketch = startSketchOn('-XZ')
///   |> startProfileAt([0, 0], %)
///   |> line([10, 0], %)
///   |> line([5, 10], %, 'seg01')
///   |> line([-10, 0], %)
///   |> angledLine([segAng('seg01', %), 10], %)
///   |> line([-10, 0], %)
///   |> angledLine([segAng('seg01', %), -15], %)
///   |> close(%)
///
/// const example = extrude(4, exampleSketch)
/// ```
#[stdlib {
    name = "segAng",
}]
fn inner_segment_angle(segment_name: &str, sketch_group: Box<SketchGroup>, args: Args) -> Result<f64, KclError> {
    let path = sketch_group.get_path_by_name(segment_name).ok_or_else(|| {
        KclError::Type(KclErrorDetails {
            message: format!(
                "Expected a segment name that exists in the given SketchGroup, found `{}`",
                segment_name
            ),
            source_ranges: vec![args.source_range],
        })
    })?;
    let line = path.get_base();

    let result = between(line.from.into(), line.to.into());

    Ok(result.degrees())
}

/// Returns the angle to match the given length for x.
pub async fn angle_to_match_length_x(args: Args) -> Result<MemoryItem, KclError> {
    let (segment_name, to, sketch_group) = args.get_segment_name_to_number_sketch_group()?;
    let result = inner_angle_to_match_length_x(&segment_name, to, sketch_group, args.clone())?;
    args.make_user_val_from_f64(result)
}

/// Returns the angle to match the given length for x.
///
/// ```no_run
/// const sketch001 = startSketchOn('-XZ')
///   |> startProfileAt([0, 0], %)
///   |> line([2, 5], %, 'seg01')
///   |> angledLineToX([
///        -angleToMatchLengthX('seg01', 7, %),
///        10
///      ], %)
///   |> close(%)
///
/// const extrusion = extrude(5, sketch001)
/// ```
#[stdlib {
    name = "angleToMatchLengthX",
}]
fn inner_angle_to_match_length_x(
    segment_name: &str,
    to: f64,
    sketch_group: Box<SketchGroup>,
    args: Args,
) -> Result<f64, KclError> {
    let path = sketch_group.get_path_by_name(segment_name).ok_or_else(|| {
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

    let angle_r = (diff / length).acos();

    if diff > length {
        Ok(0.0)
    } else {
        Ok(angle_r.to_degrees())
    }
}

/// Returns the angle to match the given length for y.
pub async fn angle_to_match_length_y(args: Args) -> Result<MemoryItem, KclError> {
    let (segment_name, to, sketch_group) = args.get_segment_name_to_number_sketch_group()?;
    let result = inner_angle_to_match_length_y(&segment_name, to, sketch_group, args.clone())?;
    args.make_user_val_from_f64(result)
}

/// Returns the angle to match the given length for y.
///
/// ```no_run
/// const sketch001 = startSketchOn('-XZ')
///   |> startProfileAt([0, 0], %)
///   |> line([1, 2], %, 'seg01')
///   |> angledLine({
///     angle: angleToMatchLengthY('seg01', 15, %),
///     length: 5,
///     }, %)
///   |> yLineTo(0, %)
///   |> close(%)
///  
/// const extrusion = extrude(5, sketch001)
/// ```
#[stdlib {
    name = "angleToMatchLengthY",
}]
fn inner_angle_to_match_length_y(
    segment_name: &str,
    to: f64,
    sketch_group: Box<SketchGroup>,
    args: Args,
) -> Result<f64, KclError> {
    let path = sketch_group.get_path_by_name(segment_name).ok_or_else(|| {
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

    let angle_r = (diff / length).asin();

    if diff > length {
        Ok(0.0)
    } else {
        Ok(angle_r.to_degrees())
    }
}
