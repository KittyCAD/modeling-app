//! Functions related to line segments.

use anyhow::Result;
use derive_docs::stdlib;
use kittycad_modeling_cmds::shared::Angle;

use crate::{
    errors::{KclError, KclErrorDetails},
    execution::{ExecState, KclValue, Point2d, Sketch, TagIdentifier},
    std::{utils::between, Args},
};

/// Returns the point at the end of the given segment.
pub async fn segment_end(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let tag: TagIdentifier = args.get_unlabeled_kw_arg("tag")?;
    let result = inner_segment_end(&tag, exec_state, args.clone())?;

    args.make_user_val_from_point(result)
}

/// Compute the ending point of the provided line segment.
///
/// ```no_run
/// w = 15
/// cube = startSketchOn('XY')
///   |> startProfileAt([0, 0], %)
///   |> line(end = [w, 0], tag = $line1)
///   |> line(end = [0, w], tag = $line2)
///   |> line(end = [-w, 0], tag = $line3)
///   |> line(end = [0, -w], tag = $line4)
///   |> close()
///   |> extrude(length = 5)
///
/// fn cylinder(radius, tag) {
///   return startSketchOn('XY')
///   |> startProfileAt([0, 0], %)
///   |> circle(radius = radius, center = segEnd(tag) )
///   |> extrude(length = radius)
/// }
///
/// cylinder(1, line1)
/// cylinder(2, line2)
/// cylinder(3, line3)
/// cylinder(4, line4)
/// ```
#[stdlib {
    name = "segEnd",
    keywords = true,
    unlabeled_first = true,
    args = {
        tag = { docs = "The line segment being queried by its tag"},
    }
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
    let tag: TagIdentifier = args.get_unlabeled_kw_arg("tag")?;
    let result = inner_segment_end_x(&tag, exec_state, args.clone())?;

    Ok(args.make_user_val_from_f64(result))
}

/// Compute the ending point of the provided line segment along the 'x' axis.
///
/// ```no_run
/// exampleSketch = startSketchOn('XZ')
///   |> startProfileAt([0, 0], %)
///   |> line(end = [20, 0], tag = $thing)
///   |> line(end = [0, 5])
///   |> line(end = [segEndX(thing), 0])
///   |> line(end = [-20, 10])
///   |> close()
///  
/// example = extrude(exampleSketch, length = 5)
/// ```
#[stdlib {
    name = "segEndX",
    keywords = true,
    unlabeled_first = true,
    args = {
        tag = { docs = "The line segment being queried by its tag"},
    }
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
    let tag: TagIdentifier = args.get_unlabeled_kw_arg("tag")?;
    let result = inner_segment_end_y(&tag, exec_state, args.clone())?;

    Ok(args.make_user_val_from_f64(result))
}

/// Compute the ending point of the provided line segment along the 'y' axis.
///
/// ```no_run
/// exampleSketch = startSketchOn('XZ')
///   |> startProfileAt([0, 0], %)
///   |> line(end = [20, 0])
///   |> line(end = [0, 3], tag = $thing)
///   |> line(end = [-10, 0])
///   |> line(end = [0, segEndY(thing)])
///   |> line(end = [-10, 0])
///   |> close()
///  
/// example = extrude(exampleSketch, length = 5)
/// ```
#[stdlib {
    name = "segEndY",
    keywords = true,
    unlabeled_first = true,
    args = {
        tag = { docs = "The line segment being queried by its tag"},
    }
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
    let tag: TagIdentifier = args.get_unlabeled_kw_arg("tag")?;
    let result = inner_segment_start(&tag, exec_state, args.clone())?;

    args.make_user_val_from_point(result)
}

/// Compute the starting point of the provided line segment.
///
/// ```no_run
/// w = 15
/// cube = startSketchOn('XY')
///   |> startProfileAt([0, 0], %)
///   |> line(end = [w, 0], tag = $line1)
///   |> line(end = [0, w], tag = $line2)
///   |> line(end = [-w, 0], tag = $line3)
///   |> line(end = [0, -w], tag = $line4)
///   |> close()
///   |> extrude(length = 5)
///
/// fn cylinder(radius, tag) {
///   return startSketchOn('XY')
///   |> startProfileAt([0, 0], %)
///   |> circle( radius = radius, center = segStart(tag) )
///   |> extrude(length = radius)
/// }
///
/// cylinder(1, line1)
/// cylinder(2, line2)
/// cylinder(3, line3)
/// cylinder(4, line4)
/// ```
#[stdlib {
    name = "segStart",
    keywords = true,
    unlabeled_first = true,
    args = {
        tag = { docs = "The line segment being queried by its tag"},
    }
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
    let tag: TagIdentifier = args.get_unlabeled_kw_arg("tag")?;
    let result = inner_segment_start_x(&tag, exec_state, args.clone())?;

    Ok(args.make_user_val_from_f64(result))
}

/// Compute the starting point of the provided line segment along the 'x' axis.
///
/// ```no_run
/// exampleSketch = startSketchOn('XZ')
///   |> startProfileAt([0, 0], %)
///   |> line(end = [20, 0], tag = $thing)
///   |> line(end = [0, 5])
///   |> line(end = [20 - segStartX(thing), 0])
///   |> line(end = [-20, 10])
///   |> close()
///  
/// example = extrude(exampleSketch, length = 5)
/// ```
#[stdlib {
    name = "segStartX",
    keywords = true,
    unlabeled_first = true,
    args = {
        tag = { docs = "The line segment being queried by its tag"},
    }
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
    let tag: TagIdentifier = args.get_unlabeled_kw_arg("tag")?;
    let result = inner_segment_start_y(&tag, exec_state, args.clone())?;

    Ok(args.make_user_val_from_f64(result))
}

/// Compute the starting point of the provided line segment along the 'y' axis.
///
/// ```no_run
/// exampleSketch = startSketchOn('XZ')
///   |> startProfileAt([0, 0], %)
///   |> line(end = [20, 0])
///   |> line(end = [0, 3], tag = $thing)
///   |> line(end = [-10, 0])
///   |> line(end = [0, 20-segStartY(thing)])
///   |> line(end = [-10, 0])
///   |> close()
///  
/// example = extrude(exampleSketch, length = 5)
/// ```
#[stdlib {
    name = "segStartY",
    keywords = true,
    unlabeled_first = true,
    args = {
        tag = { docs = "The line segment being queried by its tag"},
    }
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
    let sketch = args.get_unlabeled_kw_arg("sketch")?;
    let result = inner_last_segment_x(sketch, args.clone())?;

    Ok(args.make_user_val_from_f64(result))
}

/// Extract the 'x' axis value of the last line segment in the provided 2-d
/// sketch.
///
/// ```no_run
/// exampleSketch = startSketchOn("XZ")
///   |> startProfileAt([0, 0], %)
///   |> line(end = [5, 0])
///   |> line(end = [20, 5])
///   |> line(end = [lastSegX(%), 0])
///   |> line(end = [-15, 0])
///   |> close()
///
/// example = extrude(exampleSketch, length = 5)
/// ```
#[stdlib {
    name = "lastSegX",
    keywords = true,
    unlabeled_first = true,
    args = {
        sketch = { docs = "The sketch whose line segment is being queried"},
    }
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
    let sketch = args.get_unlabeled_kw_arg("sketch")?;
    let result = inner_last_segment_y(sketch, args.clone())?;

    Ok(args.make_user_val_from_f64(result))
}

/// Extract the 'y' axis value of the last line segment in the provided 2-d
/// sketch.
///
/// ```no_run
/// exampleSketch = startSketchOn("XZ")
///   |> startProfileAt([0, 0], %)
///   |> line(end = [5, 0])
///   |> line(end = [20, 5])
///   |> line(end = [0, lastSegY(%)])
///   |> line(end = [-15, 0])
///   |> close()
///
/// example = extrude(exampleSketch, length = 5)
/// ```
#[stdlib {
    name = "lastSegY",
    keywords = true,
    unlabeled_first = true,
    args = {
        sketch = { docs = "The sketch whose line segment is being queried"},
    }
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
    let tag: TagIdentifier = args.get_unlabeled_kw_arg("tag")?;
    let result = inner_segment_length(&tag, exec_state, args.clone())?;
    Ok(args.make_user_val_from_f64(result))
}

/// Compute the length of the provided line segment.
///
/// ```no_run
/// exampleSketch = startSketchOn("XZ")
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
///   |> close()
///
/// example = extrude(exampleSketch, length = 5)
/// ```
#[stdlib {
    name = "segLen",
    keywords = true,
    unlabeled_first = true,
    args = {
        tag = { docs = "The line segment being queried by its tag"},
    }
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
    let tag: TagIdentifier = args.get_unlabeled_kw_arg("tag")?;

    let result = inner_segment_angle(&tag, exec_state, args.clone())?;
    Ok(args.make_user_val_from_f64(result))
}

/// Compute the angle (in degrees) of the provided line segment.
///
/// ```no_run
/// exampleSketch = startSketchOn('XZ')
///   |> startProfileAt([0, 0], %)
///   |> line(end = [10, 0])
///   |> line(end = [5, 10], tag = $seg01)
///   |> line(end = [-10, 0])
///   |> angledLine([segAng(seg01), 10], %)
///   |> line(end = [-10, 0])
///   |> angledLine([segAng(seg01), -15], %)
///   |> close()
///
/// example = extrude(exampleSketch, length = 4)
/// ```
#[stdlib {
    name = "segAng",
    keywords = true,
    unlabeled_first = true,
    args = {
        tag = { docs = "The line segment being queried by its tag"},
    }
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

/// Returns the angle coming out of the end of the segment in degrees.
pub async fn tangent_to_end(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let tag: TagIdentifier = args.get_unlabeled_kw_arg("tag")?;

    let result = inner_tangent_to_end(&tag, exec_state, args.clone()).await?;
    Ok(args.make_user_val_from_f64(result))
}

/// Returns the angle coming out of the end of the segment in degrees.
///
/// ```no_run
/// // Horizontal pill.
/// pillSketch = startSketchOn('XZ')
///   |> startProfileAt([0, 0], %)
///   |> line(end = [20, 0])
///   |> tangentialArcToRelative([0, 10], %, $arc1)
///   |> angledLine({
///     angle: tangentToEnd(arc1),
///     length: 20,
///   }, %)
///   |> tangentialArcToRelative([0, -10], %)
///   |> close()
///
/// pillExtrude = extrude(pillSketch, length = 10)
/// ```
///
/// ```no_run
/// // Vertical pill.  Use absolute coordinate for arc.
/// pillSketch = startSketchOn('XZ')
///   |> startProfileAt([0, 0], %)
///   |> line(end = [0, 20])
///   |> tangentialArcTo([10, 20], %, $arc1)
///   |> angledLine({
///     angle: tangentToEnd(arc1),
///     length: 20,
///   }, %)
///   |> tangentialArcToRelative([-10, 0], %)
///   |> close()
///
/// pillExtrude = extrude(pillSketch, length = 10)
/// ```
///
/// ```no_run
/// rectangleSketch = startSketchOn('XZ')
///   |> startProfileAt([0, 0], %)
///   |> line(end = [10, 0], tag = $seg1)
///   |> angledLine({
///     angle: tangentToEnd(seg1),
///     length: 10,
///   }, %)
///   |> line(end = [0, 10])
///   |> line(end = [-20, 0])
///   |> close()
///
/// rectangleExtrude = extrude(rectangleSketch, length = 10)
/// ```
///
/// ```no_run
/// bottom = startSketchOn("XY")
///   |> startProfileAt([0, 0], %)
///   |> arcTo({
///        end: [10, 10],
///        interior: [5, 1]
///      }, %, $arc1)
///   |> angledLine([tangentToEnd(arc1), 20], %)
///   |> close()
/// ```
///
/// ```no_run
/// circSketch = startSketchOn("XY")
///   |> circle( center= [0, 0], radius= 3 , tag= $circ)
///
/// triangleSketch = startSketchOn("XY")
///   |> startProfileAt([-5, 0], %)
///   |> angledLine([tangentToEnd(circ), 10], %)
///   |> line(end = [-15, 0])
///   |> close()
/// ```
#[stdlib {
    name = "tangentToEnd",
    keywords = true,
    unlabeled_first = true,
    args = {
        tag = { docs = "The line segment being queried by its tag"},
    }
}]
async fn inner_tangent_to_end(tag: &TagIdentifier, exec_state: &mut ExecState, args: Args) -> Result<f64, KclError> {
    let line = args.get_tag_engine_info(exec_state, tag)?;
    let path = line.path.clone().ok_or_else(|| {
        KclError::Type(KclErrorDetails {
            message: format!("Expected a line segment with a path, found `{:?}`", line),
            source_ranges: vec![args.source_range],
        })
    })?;

    let from = Point2d::from(path.get_to());

    // Undocumented voodoo from get_tangential_arc_to_info
    let tangent_info = path.get_tangential_info();
    let tan_previous_point = tangent_info.tan_previous_point(from.into());

    // Calculate the end point from the angle and radius.
    // atan2 outputs radians.
    let previous_end_tangent = Angle::from_radians(f64::atan2(
        from.y - tan_previous_point[1],
        from.x - tan_previous_point[0],
    ));

    Ok(previous_end_tangent.to_degrees())
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
/// sketch001 = startSketchOn('XZ')
///   |> startProfileAt([0, 0], %)
///   |> line(end = [2, 5], tag = $seg01)
///   |> angledLineToX([
///        -angleToMatchLengthX(seg01, 7, %),
///        10
///      ], %)
///   |> close()
///
/// extrusion = extrude(sketch001, length = 5)
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
/// sketch001 = startSketchOn('XZ')
///   |> startProfileAt([0, 0], %)
///   |> line(end = [1, 2], tag = $seg01)
///   |> angledLine({
///     angle = angleToMatchLengthY(seg01, 15, %),
///     length = 5,
///     }, %)
///   |> yLineTo(0, %)
///   |> close()
///  
/// extrusion = extrude(sketch001, length = 5)
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
