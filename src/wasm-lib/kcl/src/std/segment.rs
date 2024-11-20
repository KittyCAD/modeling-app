//! Functions related to line segments.

use anyhow::Result;
use derive_docs::stdlib;

use crate::{
    errors::{KclError, KclErrorDetails},
    executor::{ExecState, KclValue, Sketch, TagIdentifier},
    std::{utils::between, Args},
};

/// Returns the point at the end of the given segment.
pub async fn segment_end(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let tag: TagIdentifier = args.get_data()?;
    let result = inner_segment_end(&tag, exec_state, args.clone())?;

    args.make_user_val_from_point(result)
}

/// Compute the ending point of the provided line segment.
///
/// ```no_run
/// w = 15
/// cube = startSketchAt([0, 0])
///   |> line([w, 0], %, $line1)
///   |> line([0, w], %, $line2)
///   |> line([-w, 0], %, $line3)
///   |> line([0, -w], %, $line4)
///   |> close(%)
///   |> extrude(5, %)
///
/// fn cylinder = (radius, tag) => {
///   return startSketchAt([0, 0])
///   |> circle({ radius = radius, center = segEnd(tag) }, %)
///   |> extrude(radius, %)
/// }
///
/// cylinder(1, line1)
/// cylinder(2, line2)
/// cylinder(3, line3)
/// cylinder(4, line4)
/// ```
#[stdlib {
    name = "segEnd",
}]
fn inner_segment_end(tag: &TagIdentifier, exec_state: &mut ExecState, args: Args) -> Result<[f64; 2], KclError> {
    let line = args.get_tag_engine_info(exec_state, tag)?;
    let path = line.path.clone().ok_or_else(|| {
        KclError::Type(KclErrorDetails {
            message: format!("Expected a line segment with a path, found `{:?}`", line),
            source_ranges: vec![args.source_range],
        })
    })?;

    Ok(path.get_base().to)
}

/// Returns the segment end of x.
pub async fn segment_end_x(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let tag: TagIdentifier = args.get_data()?;
    let result = inner_segment_end_x(&tag, exec_state, args.clone())?;

    Ok(args.make_user_val_from_f64(result))
}

/// Compute the ending point of the provided line segment along the 'x' axis.
///
/// ```no_run
/// const exampleSketch = startSketchOn('XZ')
///   |> startProfileAt([0, 0], %)
///   |> line([20, 0], %, $thing)
///   |> line([0, 5], %)
///   |> line([segEndX(thing), 0], %)
///   |> line([-20, 10], %)
///   |> close(%)
///  
/// const example = extrude(5, exampleSketch)
/// ```
#[stdlib {
    name = "segEndX",
}]
fn inner_segment_end_x(tag: &TagIdentifier, exec_state: &mut ExecState, args: Args) -> Result<f64, KclError> {
    let line = args.get_tag_engine_info(exec_state, tag)?;
    let path = line.path.clone().ok_or_else(|| {
        KclError::Type(KclErrorDetails {
            message: format!("Expected a line segment with a path, found `{:?}`", line),
            source_ranges: vec![args.source_range],
        })
    })?;

    Ok(path.get_base().to[0])
}

/// Returns the segment end of y.
pub async fn segment_end_y(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let tag: TagIdentifier = args.get_data()?;
    let result = inner_segment_end_y(&tag, exec_state, args.clone())?;

    Ok(args.make_user_val_from_f64(result))
}

/// Compute the ending point of the provided line segment along the 'y' axis.
///
/// ```no_run
/// const exampleSketch = startSketchOn('XZ')
///   |> startProfileAt([0, 0], %)
///   |> line([20, 0], %)
///   |> line([0, 3], %, $thing)
///   |> line([-10, 0], %)
///   |> line([0, segEndY(thing)], %)
///   |> line([-10, 0], %)
///   |> close(%)
///  
/// const example = extrude(5, exampleSketch)
/// ```
#[stdlib {
    name = "segEndY",
}]
fn inner_segment_end_y(tag: &TagIdentifier, exec_state: &mut ExecState, args: Args) -> Result<f64, KclError> {
    let line = args.get_tag_engine_info(exec_state, tag)?;
    let path = line.path.clone().ok_or_else(|| {
        KclError::Type(KclErrorDetails {
            message: format!("Expected a line segment with a path, found `{:?}`", line),
            source_ranges: vec![args.source_range],
        })
    })?;

    Ok(path.get_to()[1])
}

/// Returns the point at the start of the given segment.
pub async fn segment_start(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let tag: TagIdentifier = args.get_data()?;
    let result = inner_segment_start(&tag, exec_state, args.clone())?;

    args.make_user_val_from_point(result)
}

/// Compute the starting point of the provided line segment.
///
/// ```no_run
/// w = 15
/// cube = startSketchAt([0, 0])
///   |> line([w, 0], %, $line1)
///   |> line([0, w], %, $line2)
///   |> line([-w, 0], %, $line3)
///   |> line([0, -w], %, $line4)
///   |> close(%)
///   |> extrude(5, %)
///
/// fn cylinder = (radius, tag) => {
///   return startSketchAt([0, 0])
///   |> circle({ radius = radius, center = segStart(tag) }, %)
///   |> extrude(radius, %)
/// }
///
/// cylinder(1, line1)
/// cylinder(2, line2)
/// cylinder(3, line3)
/// cylinder(4, line4)
/// ```
#[stdlib {
    name = "segStart",
}]
fn inner_segment_start(tag: &TagIdentifier, exec_state: &mut ExecState, args: Args) -> Result<[f64; 2], KclError> {
    let line = args.get_tag_engine_info(exec_state, tag)?;
    let path = line.path.clone().ok_or_else(|| {
        KclError::Type(KclErrorDetails {
            message: format!("Expected a line segment with a path, found `{:?}`", line),
            source_ranges: vec![args.source_range],
        })
    })?;

    Ok(path.get_from().to_owned())
}

/// Returns the segment start of x.
pub async fn segment_start_x(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let tag: TagIdentifier = args.get_data()?;
    let result = inner_segment_start_x(&tag, exec_state, args.clone())?;

    Ok(args.make_user_val_from_f64(result))
}

/// Compute the starting point of the provided line segment along the 'x' axis.
///
/// ```no_run
/// const exampleSketch = startSketchOn('XZ')
///   |> startProfileAt([0, 0], %)
///   |> line([20, 0], %, $thing)
///   |> line([0, 5], %)
///   |> line([20 - segStartX(thing), 0], %)
///   |> line([-20, 10], %)
///   |> close(%)
///  
/// const example = extrude(5, exampleSketch)
/// ```
#[stdlib {
    name = "segStartX",
}]
fn inner_segment_start_x(tag: &TagIdentifier, exec_state: &mut ExecState, args: Args) -> Result<f64, KclError> {
    let line = args.get_tag_engine_info(exec_state, tag)?;
    let path = line.path.clone().ok_or_else(|| {
        KclError::Type(KclErrorDetails {
            message: format!("Expected a line segment with a path, found `{:?}`", line),
            source_ranges: vec![args.source_range],
        })
    })?;

    Ok(path.get_from()[0])
}

/// Returns the segment start of y.
pub async fn segment_start_y(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let tag: TagIdentifier = args.get_data()?;
    let result = inner_segment_start_y(&tag, exec_state, args.clone())?;

    Ok(args.make_user_val_from_f64(result))
}

/// Compute the starting point of the provided line segment along the 'y' axis.
///
/// ```no_run
/// const exampleSketch = startSketchOn('XZ')
///   |> startProfileAt([0, 0], %)
///   |> line([20, 0], %)
///   |> line([0, 3], %, $thing)
///   |> line([-10, 0], %)
///   |> line([0, 20-segStartY(thing)], %)
///   |> line([-10, 0], %)
///   |> close(%)
///  
/// const example = extrude(5, exampleSketch)
/// ```
#[stdlib {
    name = "segStartY",
}]
fn inner_segment_start_y(tag: &TagIdentifier, exec_state: &mut ExecState, args: Args) -> Result<f64, KclError> {
    let line = args.get_tag_engine_info(exec_state, tag)?;
    let path = line.path.clone().ok_or_else(|| {
        KclError::Type(KclErrorDetails {
            message: format!("Expected a line segment with a path, found `{:?}`", line),
            source_ranges: vec![args.source_range],
        })
    })?;

    Ok(path.get_from()[1])
}
/// Returns the last segment of x.
pub async fn last_segment_x(_exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let sketch = args.get_sketch()?;
    let result = inner_last_segment_x(sketch, args.clone())?;

    Ok(args.make_user_val_from_f64(result))
}

/// Extract the 'x' axis value of the last line segment in the provided 2-d
/// sketch.
///
/// ```no_run
/// const exampleSketch = startSketchOn("XZ")
///   |> startProfileAt([0, 0], %)
///   |> line([5, 0], %)
///   |> line([20, 5], %)
///   |> line([lastSegX(%), 0], %)
///   |> line([-15, 0], %)
///   |> close(%)
///
/// const example = extrude(5, exampleSketch)
/// ```
#[stdlib {
    name = "lastSegX",
}]
fn inner_last_segment_x(sketch: Sketch, args: Args) -> Result<f64, KclError> {
    let last_line = sketch
        .paths
        .last()
        .ok_or_else(|| {
            KclError::Type(KclErrorDetails {
                message: format!("Expected a Sketch with at least one segment, found `{:?}`", sketch),
                source_ranges: vec![args.source_range],
            })
        })?
        .get_base();

    Ok(last_line.to[0])
}

/// Returns the last segment of y.
pub async fn last_segment_y(_exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let sketch = args.get_sketch()?;
    let result = inner_last_segment_y(sketch, args.clone())?;

    Ok(args.make_user_val_from_f64(result))
}

/// Extract the 'y' axis value of the last line segment in the provided 2-d
/// sketch.
///
/// ```no_run
/// const exampleSketch = startSketchOn("XZ")
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
fn inner_last_segment_y(sketch: Sketch, args: Args) -> Result<f64, KclError> {
    let last_line = sketch
        .paths
        .last()
        .ok_or_else(|| {
            KclError::Type(KclErrorDetails {
                message: format!("Expected a Sketch with at least one segment, found `{:?}`", sketch),
                source_ranges: vec![args.source_range],
            })
        })?
        .get_base();

    Ok(last_line.to[1])
}

/// Returns the length of the segment.
pub async fn segment_length(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let tag: TagIdentifier = args.get_data()?;
    let result = inner_segment_length(&tag, exec_state, args.clone())?;
    Ok(args.make_user_val_from_f64(result))
}

/// Compute the length of the provided line segment.
///
/// ```no_run
/// const exampleSketch = startSketchOn("XZ")
///   |> startProfileAt([0, 0], %)
///   |> angledLine({
///     angle = 60,
///     length = 10,
///   }, %, $thing)
///   |> tangentialArc({
///     offset = -120,
///     radius = 5,
///   }, %)
///   |> angledLine({
///     angle = -60,
///     length = segLen(thing),
///   }, %)
///   |> close(%)
///
/// const example = extrude(5, exampleSketch)
/// ```
#[stdlib {
    name = "segLen",
}]
fn inner_segment_length(tag: &TagIdentifier, exec_state: &mut ExecState, args: Args) -> Result<f64, KclError> {
    let line = args.get_tag_engine_info(exec_state, tag)?;
    let path = line.path.clone().ok_or_else(|| {
        KclError::Type(KclErrorDetails {
            message: format!("Expected a line segment with a path, found `{:?}`", line),
            source_ranges: vec![args.source_range],
        })
    })?;

    let result = path.length();

    Ok(result)
}

/// Returns the angle of the segment.
pub async fn segment_angle(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let tag: TagIdentifier = args.get_data()?;

    let result = inner_segment_angle(&tag, exec_state, args.clone())?;
    Ok(args.make_user_val_from_f64(result))
}

/// Compute the angle (in degrees) of the provided line segment.
///
/// ```no_run
/// const exampleSketch = startSketchOn('XZ')
///   |> startProfileAt([0, 0], %)
///   |> line([10, 0], %)
///   |> line([5, 10], %, $seg01)
///   |> line([-10, 0], %)
///   |> angledLine([segAng(seg01), 10], %)
///   |> line([-10, 0], %)
///   |> angledLine([segAng(seg01), -15], %)
///   |> close(%)
///
/// const example = extrude(4, exampleSketch)
/// ```
#[stdlib {
    name = "segAng",
}]
fn inner_segment_angle(tag: &TagIdentifier, exec_state: &mut ExecState, args: Args) -> Result<f64, KclError> {
    let line = args.get_tag_engine_info(exec_state, tag)?;
    let path = line.path.clone().ok_or_else(|| {
        KclError::Type(KclErrorDetails {
            message: format!("Expected a line segment with a path, found `{:?}`", line),
            source_ranges: vec![args.source_range],
        })
    })?;

    let result = between(path.get_from().into(), path.get_to().into());

    Ok(result.to_degrees())
}

/// Returns the angle to match the given length for x.
pub async fn angle_to_match_length_x(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let (tag, to, sketch) = args.get_tag_to_number_sketch()?;
    let result = inner_angle_to_match_length_x(&tag, to, sketch, exec_state, args.clone())?;
    Ok(args.make_user_val_from_f64(result))
}

/// Returns the angle to match the given length for x.
///
/// ```no_run
/// const sketch001 = startSketchOn('XZ')
///   |> startProfileAt([0, 0], %)
///   |> line([2, 5], %, $seg01)
///   |> angledLineToX([
///        -angleToMatchLengthX(seg01, 7, %),
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
    tag: &TagIdentifier,
    to: f64,
    sketch: Sketch,
    exec_state: &mut ExecState,
    args: Args,
) -> Result<f64, KclError> {
    let line = args.get_tag_engine_info(exec_state, tag)?;
    let path = line.path.clone().ok_or_else(|| {
        KclError::Type(KclErrorDetails {
            message: format!("Expected a line segment with a path, found `{:?}`", line),
            source_ranges: vec![args.source_range],
        })
    })?;

    let length = path.length();

    let last_line = sketch
        .paths
        .last()
        .ok_or_else(|| {
            KclError::Type(KclErrorDetails {
                message: format!("Expected a Sketch with at least one segment, found `{:?}`", sketch),
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
pub async fn angle_to_match_length_y(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let (tag, to, sketch) = args.get_tag_to_number_sketch()?;
    let result = inner_angle_to_match_length_y(&tag, to, sketch, exec_state, args.clone())?;
    Ok(args.make_user_val_from_f64(result))
}

/// Returns the angle to match the given length for y.
///
/// ```no_run
/// const sketch001 = startSketchOn('XZ')
///   |> startProfileAt([0, 0], %)
///   |> line([1, 2], %, $seg01)
///   |> angledLine({
///     angle = angleToMatchLengthY(seg01, 15, %),
///     length = 5,
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
    tag: &TagIdentifier,
    to: f64,
    sketch: Sketch,
    exec_state: &mut ExecState,
    args: Args,
) -> Result<f64, KclError> {
    let line = args.get_tag_engine_info(exec_state, tag)?;
    let path = line.path.clone().ok_or_else(|| {
        KclError::Type(KclErrorDetails {
            message: format!("Expected a line segment with a path, found `{:?}`", line),
            source_ranges: vec![args.source_range],
        })
    })?;

    let length = path.length();

    let last_line = sketch
        .paths
        .last()
        .ok_or_else(|| {
            KclError::Type(KclErrorDetails {
                message: format!("Expected a Sketch with at least one segment, found `{:?}`", sketch),
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
