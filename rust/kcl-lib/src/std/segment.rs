//! Functions related to line segments.

use anyhow::Result;
use kcl_derive_docs::stdlib;
use kittycad_modeling_cmds::shared::Angle;

use super::utils::untype_point;
use crate::{
    errors::{KclError, KclErrorDetails},
    execution::{
        types::{NumericType, PrimitiveType, RuntimeType},
        ExecState, KclValue, Sketch, TagIdentifier,
    },
    std::{args::TyF64, utils::between, Args},
};

/// Returns the point at the end of the given segment.
pub async fn segment_end(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let tag: TagIdentifier = args.get_unlabeled_kw_arg("tag")?;
    let pt = inner_segment_end(&tag, exec_state, args.clone())?;

    args.make_kcl_val_from_point([pt[0].n, pt[1].n], pt[0].ty.clone())
}

/// Compute the ending point of the provided line segment.
///
/// ```no_run
/// w = 15
/// cube = startSketchOn(XY)
///   |> startProfile(at = [0, 0])
///   |> line(end = [w, 0], tag = $line1)
///   |> line(end = [0, w], tag = $line2)
///   |> line(end = [-w, 0], tag = $line3)
///   |> line(end = [0, -w], tag = $line4)
///   |> close()
///   |> extrude(length = 5)
///
/// fn cylinder(radius, tag) {
///   return startSketchOn(XY)
///   |> startProfile(at = [0, 0])
///   |> circle(radius = radius, center = segEnd(tag) )
///   |> extrude(length = radius)
/// }
///
/// cylinder(radius = 1, tag = line1)
/// cylinder(radius = 2, tag = line2)
/// cylinder(radius = 3, tag = line3)
/// cylinder(radius = 4, tag = line4)
/// ```
#[stdlib {
    name = "segEnd",
    keywords = true,
    unlabeled_first = true,
    args = {
        tag = { docs = "The line segment being queried by its tag"},
    },
    tags = ["sketch"]
}]
fn inner_segment_end(tag: &TagIdentifier, exec_state: &mut ExecState, args: Args) -> Result<[TyF64; 2], KclError> {
    let line = args.get_tag_engine_info(exec_state, tag)?;
    let path = line.path.clone().ok_or_else(|| {
        KclError::Type(KclErrorDetails {
            message: format!("Expected a line segment with a path, found `{:?}`", line),
            source_ranges: vec![args.source_range],
        })
    })?;
    let (p, ty) = path.end_point_components();
    // Docs generation isn't smart enough to handle ([f64; 2], NumericType).
    let point = [TyF64::new(p[0], ty.clone()), TyF64::new(p[1], ty)];

    Ok(point)
}

/// Returns the segment end of x.
pub async fn segment_end_x(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let tag: TagIdentifier = args.get_unlabeled_kw_arg("tag")?;
    let result = inner_segment_end_x(&tag, exec_state, args.clone())?;

    Ok(args.make_user_val_from_f64_with_type(result))
}

/// Compute the ending point of the provided line segment along the 'x' axis.
///
/// ```no_run
/// exampleSketch = startSketchOn(XZ)
///   |> startProfile(at = [0, 0])
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
    },
    tags = ["sketch"]
}]
fn inner_segment_end_x(tag: &TagIdentifier, exec_state: &mut ExecState, args: Args) -> Result<TyF64, KclError> {
    let line = args.get_tag_engine_info(exec_state, tag)?;
    let path = line.path.clone().ok_or_else(|| {
        KclError::Type(KclErrorDetails {
            message: format!("Expected a line segment with a path, found `{:?}`", line),
            source_ranges: vec![args.source_range],
        })
    })?;

    Ok(TyF64::new(path.get_base().to[0], path.get_base().units.into()))
}

/// Returns the segment end of y.
pub async fn segment_end_y(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let tag: TagIdentifier = args.get_unlabeled_kw_arg("tag")?;
    let result = inner_segment_end_y(&tag, exec_state, args.clone())?;

    Ok(args.make_user_val_from_f64_with_type(result))
}

/// Compute the ending point of the provided line segment along the 'y' axis.
///
/// ```no_run
/// exampleSketch = startSketchOn(XZ)
///   |> startProfile(at = [0, 0])
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
    },
    tags = ["sketch"]
}]
fn inner_segment_end_y(tag: &TagIdentifier, exec_state: &mut ExecState, args: Args) -> Result<TyF64, KclError> {
    let line = args.get_tag_engine_info(exec_state, tag)?;
    let path = line.path.clone().ok_or_else(|| {
        KclError::Type(KclErrorDetails {
            message: format!("Expected a line segment with a path, found `{:?}`", line),
            source_ranges: vec![args.source_range],
        })
    })?;

    Ok(path.get_to()[1].clone())
}

/// Returns the point at the start of the given segment.
pub async fn segment_start(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let tag: TagIdentifier = args.get_unlabeled_kw_arg("tag")?;
    let pt = inner_segment_start(&tag, exec_state, args.clone())?;

    args.make_kcl_val_from_point([pt[0].n, pt[1].n], pt[0].ty.clone())
}

/// Compute the starting point of the provided line segment.
///
/// ```no_run
/// w = 15
/// cube = startSketchOn(XY)
///   |> startProfile(at = [0, 0])
///   |> line(end = [w, 0], tag = $line1)
///   |> line(end = [0, w], tag = $line2)
///   |> line(end = [-w, 0], tag = $line3)
///   |> line(end = [0, -w], tag = $line4)
///   |> close()
///   |> extrude(length = 5)
///
/// fn cylinder(radius, tag) {
///   return startSketchOn(XY)
///   |> startProfile(at = [0, 0])
///   |> circle( radius = radius, center = segStart(tag) )
///   |> extrude(length = radius)
/// }
///
/// cylinder(radius = 1, tag = line1)
/// cylinder(radius = 2, tag = line2)
/// cylinder(radius = 3, tag = line3)
/// cylinder(radius = 4, tag = line4)
/// ```
#[stdlib {
    name = "segStart",
    keywords = true,
    unlabeled_first = true,
    args = {
        tag = { docs = "The line segment being queried by its tag"},
    },
    tags = ["sketch"]
}]
fn inner_segment_start(tag: &TagIdentifier, exec_state: &mut ExecState, args: Args) -> Result<[TyF64; 2], KclError> {
    let line = args.get_tag_engine_info(exec_state, tag)?;
    let path = line.path.clone().ok_or_else(|| {
        KclError::Type(KclErrorDetails {
            message: format!("Expected a line segment with a path, found `{:?}`", line),
            source_ranges: vec![args.source_range],
        })
    })?;
    let (p, ty) = path.start_point_components();
    // Docs generation isn't smart enough to handle ([f64; 2], NumericType).
    let point = [TyF64::new(p[0], ty.clone()), TyF64::new(p[1], ty)];

    Ok(point)
}

/// Returns the segment start of x.
pub async fn segment_start_x(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let tag: TagIdentifier = args.get_unlabeled_kw_arg("tag")?;
    let result = inner_segment_start_x(&tag, exec_state, args.clone())?;

    Ok(args.make_user_val_from_f64_with_type(result))
}

/// Compute the starting point of the provided line segment along the 'x' axis.
///
/// ```no_run
/// exampleSketch = startSketchOn(XZ)
///   |> startProfile(at = [0, 0])
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
    },
    tags = ["sketch"]
}]
fn inner_segment_start_x(tag: &TagIdentifier, exec_state: &mut ExecState, args: Args) -> Result<TyF64, KclError> {
    let line = args.get_tag_engine_info(exec_state, tag)?;
    let path = line.path.clone().ok_or_else(|| {
        KclError::Type(KclErrorDetails {
            message: format!("Expected a line segment with a path, found `{:?}`", line),
            source_ranges: vec![args.source_range],
        })
    })?;

    Ok(path.get_from()[0].clone())
}

/// Returns the segment start of y.
pub async fn segment_start_y(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let tag: TagIdentifier = args.get_unlabeled_kw_arg("tag")?;
    let result = inner_segment_start_y(&tag, exec_state, args.clone())?;

    Ok(args.make_user_val_from_f64_with_type(result))
}

/// Compute the starting point of the provided line segment along the 'y' axis.
///
/// ```no_run
/// exampleSketch = startSketchOn(XZ)
///   |> startProfile(at = [0, 0])
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
    },
    tags = ["sketch"]
}]
fn inner_segment_start_y(tag: &TagIdentifier, exec_state: &mut ExecState, args: Args) -> Result<TyF64, KclError> {
    let line = args.get_tag_engine_info(exec_state, tag)?;
    let path = line.path.clone().ok_or_else(|| {
        KclError::Type(KclErrorDetails {
            message: format!("Expected a line segment with a path, found `{:?}`", line),
            source_ranges: vec![args.source_range],
        })
    })?;

    Ok(path.get_from()[1].clone())
}
/// Returns the last segment of x.
pub async fn last_segment_x(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let sketch =
        args.get_unlabeled_kw_arg_typed("sketch", &RuntimeType::Primitive(PrimitiveType::Sketch), exec_state)?;
    let result = inner_last_segment_x(sketch, args.clone())?;

    Ok(args.make_user_val_from_f64_with_type(result))
}

/// Extract the 'x' axis value of the last line segment in the provided 2-d
/// sketch.
///
/// ```no_run
/// exampleSketch = startSketchOn(XZ)
///   |> startProfile(at = [0, 0])
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
    },
    tags = ["sketch"]
}]
fn inner_last_segment_x(sketch: Sketch, args: Args) -> Result<TyF64, KclError> {
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

    Ok(TyF64::new(last_line.to[0], last_line.units.into()))
}

/// Returns the last segment of y.
pub async fn last_segment_y(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let sketch =
        args.get_unlabeled_kw_arg_typed("sketch", &RuntimeType::Primitive(PrimitiveType::Sketch), exec_state)?;
    let result = inner_last_segment_y(sketch, args.clone())?;

    Ok(args.make_user_val_from_f64_with_type(result))
}

/// Extract the 'y' axis value of the last line segment in the provided 2-d
/// sketch.
///
/// ```no_run
/// exampleSketch = startSketchOn(XZ)
///   |> startProfile(at = [0, 0])
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
    },
    tags = ["sketch"]
}]
fn inner_last_segment_y(sketch: Sketch, args: Args) -> Result<TyF64, KclError> {
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

    Ok(TyF64::new(last_line.to[1], last_line.units.into()))
}

/// Returns the length of the segment.
pub async fn segment_length(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let tag: TagIdentifier = args.get_unlabeled_kw_arg("tag")?;
    let result = inner_segment_length(&tag, exec_state, args.clone())?;
    Ok(args.make_user_val_from_f64_with_type(result))
}

/// Compute the length of the provided line segment.
///
/// ```no_run
/// exampleSketch = startSketchOn(XZ)
///   |> startProfile(at = [0, 0])
///   |> angledLine(
///     angle = 60,
///     length = 10,
///     tag = $thing,
///   )
///   |> tangentialArc(angle = -120, radius = 5)
///   |> angledLine(
///     angle = -60,
///     length = segLen(thing),
///   )
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
    },
    tags = ["sketch"]
}]
fn inner_segment_length(tag: &TagIdentifier, exec_state: &mut ExecState, args: Args) -> Result<TyF64, KclError> {
    let line = args.get_tag_engine_info(exec_state, tag)?;
    let path = line.path.clone().ok_or_else(|| {
        KclError::Type(KclErrorDetails {
            message: format!("Expected a line segment with a path, found `{:?}`", line),
            source_ranges: vec![args.source_range],
        })
    })?;

    Ok(path.length())
}

/// Returns the angle of the segment.
pub async fn segment_angle(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let tag: TagIdentifier = args.get_unlabeled_kw_arg("tag")?;

    let result = inner_segment_angle(&tag, exec_state, args.clone())?;
    Ok(args.make_user_val_from_f64_with_type(TyF64::new(result, NumericType::degrees())))
}

/// Compute the angle (in degrees) of the provided line segment.
///
/// ```no_run
/// exampleSketch = startSketchOn(XZ)
///   |> startProfile(at = [0, 0])
///   |> line(end = [10, 0])
///   |> line(end = [5, 10], tag = $seg01)
///   |> line(end = [-10, 0])
///   |> angledLine(angle = segAng(seg01), length = 10)
///   |> line(end = [-10, 0])
///   |> angledLine(angle = segAng(seg01), length = -15)
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
    },
    tags = ["sketch"]
}]
fn inner_segment_angle(tag: &TagIdentifier, exec_state: &mut ExecState, args: Args) -> Result<f64, KclError> {
    let line = args.get_tag_engine_info(exec_state, tag)?;
    let path = line.path.clone().ok_or_else(|| {
        KclError::Type(KclErrorDetails {
            message: format!("Expected a line segment with a path, found `{:?}`", line),
            source_ranges: vec![args.source_range],
        })
    })?;

    let result = between(path.get_base().from, path.get_base().to);

    Ok(result.to_degrees())
}

/// Returns the angle coming out of the end of the segment in degrees.
pub async fn tangent_to_end(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let tag: TagIdentifier = args.get_unlabeled_kw_arg("tag")?;

    let result = inner_tangent_to_end(&tag, exec_state, args.clone()).await?;
    Ok(args.make_user_val_from_f64_with_type(TyF64::new(result, NumericType::degrees())))
}

/// Returns the angle coming out of the end of the segment in degrees.
///
/// ```no_run
/// // Horizontal pill.
/// pillSketch = startSketchOn(XZ)
///   |> startProfile(at = [0, 0])
///   |> line(end = [20, 0])
///   |> tangentialArc(end = [0, 10], tag = $arc1)
///   |> angledLine(
///     angle = tangentToEnd(arc1),
///     length = 20,
///   )
///   |> tangentialArc(end = [0, -10])
///   |> close()
///
/// pillExtrude = extrude(pillSketch, length = 10)
/// ```
///
/// ```no_run
/// // Vertical pill.  Use absolute coordinate for arc.
/// pillSketch = startSketchOn(XZ)
///   |> startProfile(at = [0, 0])
///   |> line(end = [0, 20])
///   |> tangentialArc(endAbsolute = [10, 20], tag = $arc1)
///   |> angledLine(
///     angle = tangentToEnd(arc1),
///     length = 20,
///   )
///   |> tangentialArc(end = [-10, 0])
///   |> close()
///
/// pillExtrude = extrude(pillSketch, length = 10)
/// ```
///
/// ```no_run
/// rectangleSketch = startSketchOn(XZ)
///   |> startProfile(at = [0, 0])
///   |> line(end = [10, 0], tag = $seg1)
///   |> angledLine(
///     angle = tangentToEnd(seg1),
///     length = 10,
///   )
///   |> line(end = [0, 10])
///   |> line(end = [-20, 0])
///   |> close()
///
/// rectangleExtrude = extrude(rectangleSketch, length = 10)
/// ```
///
/// ```no_run
/// bottom = startSketchOn(XY)
///   |> startProfile(at = [0, 0])
///   |> arc(
///        endAbsolute = [10, 10],
///        interiorAbsolute = [5, 1],
///        tag = $arc1,
///      )
///   |> angledLine(angle = tangentToEnd(arc1), length = 20)
///   |> close()
/// ```
///
/// ```no_run
/// circSketch = startSketchOn(XY)
///   |> circle( center= [0, 0], radius= 3 , tag= $circ)
///
/// triangleSketch = startSketchOn(XY)
///   |> startProfile(at = [-5, 0])
///   |> angledLine(angle = tangentToEnd(circ), length = 10)
///   |> line(end = [-15, 0])
///   |> close()
/// ```
#[stdlib {
    name = "tangentToEnd",
    keywords = true,
    unlabeled_first = true,
    args = {
        tag = { docs = "The line segment being queried by its tag"},
    },
    tags = ["sketch"]
}]
async fn inner_tangent_to_end(tag: &TagIdentifier, exec_state: &mut ExecState, args: Args) -> Result<f64, KclError> {
    let line = args.get_tag_engine_info(exec_state, tag)?;
    let path = line.path.clone().ok_or_else(|| {
        KclError::Type(KclErrorDetails {
            message: format!("Expected a line segment with a path, found `{:?}`", line),
            source_ranges: vec![args.source_range],
        })
    })?;

    let from = untype_point(path.get_to()).0;

    // Undocumented voodoo from get_tangential_arc_to_info
    let tangent_info = path.get_tangential_info();
    let tan_previous_point = tangent_info.tan_previous_point(from);

    // Calculate the end point from the angle and radius.
    // atan2 outputs radians.
    let previous_end_tangent = Angle::from_radians(f64::atan2(
        from[1] - tan_previous_point[1],
        from[0] - tan_previous_point[0],
    ));

    Ok(previous_end_tangent.to_degrees())
}
