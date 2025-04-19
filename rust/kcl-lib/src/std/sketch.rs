//! Functions related to sketching.

use anyhow::Result;
use indexmap::IndexMap;
use kcl_derive_docs::stdlib;
use kcmc::shared::Point2d as KPoint2d; // Point2d is already defined in this pkg, to impl ts_rs traits.
use kcmc::shared::Point3d as KPoint3d; // Point3d is already defined in this pkg, to impl ts_rs traits.
use kcmc::{each_cmd as mcmd, length_unit::LengthUnit, shared::Angle, websocket::ModelingCmdReq, ModelingCmd};
use kittycad_modeling_cmds as kcmc;
use kittycad_modeling_cmds::shared::PathSegment;
use parse_display::{Display, FromStr};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use super::utils::untype_point;
use crate::{
    errors::{KclError, KclErrorDetails},
    execution::{
        types::{PrimitiveType, RuntimeType, UnitLen},
        Artifact, ArtifactId, BasePath, CodeRef, ExecState, Face, GeoMeta, KclValue, Path, Plane, Point2d, Point3d,
        Sketch, SketchSurface, Solid, StartSketchOnFace, StartSketchOnPlane, TagEngineInfo, TagIdentifier,
    },
    parsing::ast::types::TagNode,
    std::{
        args::{Args, TyF64},
        utils::{
            arc_center_and_end, get_tangential_arc_to_info, get_x_component, get_y_component,
            intersection_with_parallel_line, TangentialArcInfoInput,
        },
    },
};

/// A tag for a face.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(rename_all = "snake_case", untagged)]
pub enum FaceTag {
    StartOrEnd(StartOrEnd),
    /// A tag for the face.
    Tag(Box<TagIdentifier>),
}

impl std::fmt::Display for FaceTag {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            FaceTag::Tag(t) => write!(f, "{}", t),
            FaceTag::StartOrEnd(StartOrEnd::Start) => write!(f, "start"),
            FaceTag::StartOrEnd(StartOrEnd::End) => write!(f, "end"),
        }
    }
}

impl FaceTag {
    /// Get the face id from the tag.
    pub async fn get_face_id(
        &self,
        solid: &Solid,
        exec_state: &mut ExecState,
        args: &Args,
        must_be_planar: bool,
    ) -> Result<uuid::Uuid, KclError> {
        match self {
            FaceTag::Tag(ref t) => args.get_adjacent_face_to_tag(exec_state, t, must_be_planar).await,
            FaceTag::StartOrEnd(StartOrEnd::Start) => solid.start_cap_id.ok_or_else(|| {
                KclError::Type(KclErrorDetails {
                    message: "Expected a start face".to_string(),
                    source_ranges: vec![args.source_range],
                })
            }),
            FaceTag::StartOrEnd(StartOrEnd::End) => solid.end_cap_id.ok_or_else(|| {
                KclError::Type(KclErrorDetails {
                    message: "Expected an end face".to_string(),
                    source_ranges: vec![args.source_range],
                })
            }),
        }
    }
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema, FromStr, Display)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
#[display(style = "snake_case")]
pub enum StartOrEnd {
    /// The start face as in before you extruded. This could also be known as the bottom
    /// face. But we do not call it bottom because it would be the top face if you
    /// extruded it in the opposite direction or flipped the camera.
    #[serde(rename = "start", alias = "START")]
    Start,
    /// The end face after you extruded. This could also be known as the top
    /// face. But we do not call it top because it would be the bottom face if you
    /// extruded it in the opposite direction or flipped the camera.
    #[serde(rename = "end", alias = "END")]
    End,
}

pub const NEW_TAG_KW: &str = "tag";

pub async fn involute_circular(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let sketch =
        args.get_unlabeled_kw_arg_typed("sketch", &RuntimeType::Primitive(PrimitiveType::Sketch), exec_state)?;

    let start_radius: TyF64 = args.get_kw_arg_typed("startRadius", &RuntimeType::length(), exec_state)?;
    let end_radius: TyF64 = args.get_kw_arg_typed("endRadius", &RuntimeType::length(), exec_state)?;
    let angle: TyF64 = args.get_kw_arg_typed("angle", &RuntimeType::angle(), exec_state)?;
    let reverse = args.get_kw_arg_opt("reverse")?;
    let tag = args.get_kw_arg_opt(NEW_TAG_KW)?;
    let new_sketch = inner_involute_circular(
        sketch,
        start_radius.n,
        end_radius.n,
        angle.n,
        reverse,
        tag,
        exec_state,
        args,
    )
    .await?;
    Ok(KclValue::Sketch {
        value: Box::new(new_sketch),
    })
}

fn involute_curve(radius: f64, angle: f64) -> (f64, f64) {
    (
        radius * (angle.cos() + angle * angle.sin()),
        radius * (angle.sin() - angle * angle.cos()),
    )
}

/// Extend the current sketch with a new involute circular curve.
///
/// ```no_run
/// a = 10
/// b = 14
/// startSketchOn(XZ)
///   |> startProfileAt([0, 0], %)
///   |> involuteCircular(startRadius = a, endRadius = b, angle = 60)
///   |> involuteCircular(startRadius = a, endRadius = b, angle = 60, reverse = true)
/// ```
#[stdlib {
    name = "involuteCircular",
    keywords = true,
    unlabeled_first = true,
    args = {
        sketch = { docs = "Which sketch should this path be added to?"},
        start_radius  = { docs = "The involute is described between two circles, start_radius is the radius of the inner circle."},
        end_radius  = { docs = "The involute is described between two circles, end_radius is the radius of the outer circle."},
        angle  = { docs = "The angle to rotate the involute by. A value of zero will produce a curve with a tangent along the x-axis at the start point of the curve."},
        reverse  = { docs = "If reverse is true, the segment will start from the end of the involute, otherwise it will start from that start. Defaults to false."},
        tag = { docs = "Create a new tag which refers to this line"},
    }
}]
#[allow(clippy::too_many_arguments)]
async fn inner_involute_circular(
    sketch: Sketch,
    start_radius: f64,
    end_radius: f64,
    angle: f64,
    reverse: Option<bool>,
    tag: Option<TagNode>,
    exec_state: &mut ExecState,
    args: Args,
) -> Result<Sketch, KclError> {
    let id = exec_state.next_uuid();
    let angle = Angle::from_degrees(angle);
    let segment = PathSegment::CircularInvolute {
        start_radius: LengthUnit(start_radius),
        end_radius: LengthUnit(end_radius),
        angle,
        reverse: reverse.unwrap_or_default(),
    };

    args.batch_modeling_cmd(
        id,
        ModelingCmd::from(mcmd::ExtendPath {
            path: sketch.id.into(),
            segment,
        }),
    )
    .await?;

    let from = sketch.current_pen_position()?;
    let mut end: KPoint3d<f64> = Default::default(); // ADAM: TODO impl this below.
    let theta = f64::sqrt(end_radius * end_radius - start_radius * start_radius) / start_radius;
    let (x, y) = involute_curve(start_radius, theta);

    end.x = x * angle.to_radians().cos() - y * angle.to_radians().sin();
    end.y = x * angle.to_radians().sin() + y * angle.to_radians().cos();

    end.x -= start_radius * angle.to_radians().cos();
    end.y -= start_radius * angle.to_radians().sin();

    if reverse.unwrap_or_default() {
        end.x = -end.x;
    }

    end.x += from.x;
    end.y += from.y;

    // let path_json = path_to_json();
    // let end = args
    //     .send_modeling_cmd(
    //         exec_state.next_uuid(),
    //         ModelingCmd::EngineUtilEvaluatePath(mcmd::EngineUtilEvaluatePath { path_json, t: 1.0 }),
    //     )
    //     .await?;

    // let end = match end {
    //     kittycad_modeling_cmds::websocket::OkWebSocketResponseData::Modeling {
    //         modeling_response: OkModelingCmdResponse::EngineUtilEvaluatePath(eval_path),
    //     } => eval_path.pos,
    //     other => {
    //         return Err(KclError::Engine(KclErrorDetails {
    //             source_ranges: vec![args.source_range],
    //             message: format!("Expected EngineUtilEvaluatePath response but found {other:?}"),
    //         }))
    //     }
    // };

    let current_path = Path::ToPoint {
        base: BasePath {
            from: from.into(),
            to: [end.x, end.y],
            tag: tag.clone(),
            units: sketch.units,
            geo_meta: GeoMeta {
                id,
                metadata: args.source_range.into(),
            },
        },
    };

    let mut new_sketch = sketch.clone();
    if let Some(tag) = &tag {
        new_sketch.add_tag(tag, &current_path, exec_state);
    }
    new_sketch.paths.push(current_path);
    Ok(new_sketch)
}

/// Draw a line to a point.
pub async fn line(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let sketch = args.get_unlabeled_kw_arg_typed("sketch", &RuntimeType::sketch(), exec_state)?;
    let end = args.get_kw_arg_opt_typed("end", &RuntimeType::point2d(), exec_state)?;
    let end_absolute = args.get_kw_arg_opt_typed("endAbsolute", &RuntimeType::point2d(), exec_state)?;
    let tag = args.get_kw_arg_opt(NEW_TAG_KW)?;

    let new_sketch = inner_line(
        sketch,
        end_absolute.map(|p| untype_point(p).0),
        end.map(|p| untype_point(p).0),
        tag,
        exec_state,
        args,
    )
    .await?;
    Ok(KclValue::Sketch {
        value: Box::new(new_sketch),
    })
}

/// Extend the current sketch with a new straight line.
///
/// ```no_run
/// triangle = startSketchOn(XZ)
///   |> startProfileAt([0, 0], %)
///   // The END argument means it ends at exactly [10, 0].
///   // This is an absolute measurement, it is NOT relative to
///   // the start of the sketch.
///   |> line(endAbsolute = [10, 0])
///   |> line(endAbsolute = [0, 10])
///   |> line(endAbsolute = [-10, 0], tag = $thirdLineOfTriangle)
///   |> close()
///   |> extrude(length = 5)
///
/// box = startSketchOn(XZ)
///   |> startProfileAt([10, 10], %)
///   // The 'to' argument means move the pen this much.
///   // So, [10, 0] is a relative distance away from the current point.
///   |> line(end = [10, 0])
///   |> line(end = [0, 10])
///   |> line(end = [-10, 0], tag = $thirdLineOfBox)
///   |> close()
///   |> extrude(length = 5)
/// ```
#[stdlib {
    name = "line",
    keywords = true,
    unlabeled_first = true,
    args = {
        sketch = { docs = "Which sketch should this path be added to?"},
        end_absolute = { docs = "Which absolute point should this line go to? Incompatible with `end`."},
        end = { docs = "How far away (along the X and Y axes) should this line go? Incompatible with `endAbsolute`.", include_in_snippet = true},
        tag = { docs = "Create a new tag which refers to this line"},
    }
}]
async fn inner_line(
    sketch: Sketch,
    end_absolute: Option<[f64; 2]>,
    end: Option<[f64; 2]>,
    tag: Option<TagNode>,
    exec_state: &mut ExecState,
    args: Args,
) -> Result<Sketch, KclError> {
    straight_line(
        StraightLineParams {
            sketch,
            end_absolute,
            end,
            tag,
        },
        exec_state,
        args,
    )
    .await
}

struct StraightLineParams {
    sketch: Sketch,
    end_absolute: Option<[f64; 2]>,
    end: Option<[f64; 2]>,
    tag: Option<TagNode>,
}

impl StraightLineParams {
    fn relative(p: [f64; 2], sketch: Sketch, tag: Option<TagNode>) -> Self {
        Self {
            sketch,
            tag,
            end: Some(p),
            end_absolute: None,
        }
    }
    fn absolute(p: [f64; 2], sketch: Sketch, tag: Option<TagNode>) -> Self {
        Self {
            sketch,
            tag,
            end: None,
            end_absolute: Some(p),
        }
    }
}

async fn straight_line(
    StraightLineParams {
        sketch,
        end,
        end_absolute,
        tag,
    }: StraightLineParams,
    exec_state: &mut ExecState,
    args: Args,
) -> Result<Sketch, KclError> {
    let from = sketch.current_pen_position()?;
    let (point, is_absolute) = match (end_absolute, end) {
        (Some(_), Some(_)) => {
            return Err(KclError::Semantic(KclErrorDetails {
                source_ranges: vec![args.source_range],
                message: "You cannot give both `end` and `endAbsolute` params, you have to choose one or the other"
                    .to_owned(),
            }));
        }
        (Some(end_absolute), None) => (end_absolute, true),
        (None, Some(end)) => (end, false),
        (None, None) => {
            return Err(KclError::Semantic(KclErrorDetails {
                source_ranges: vec![args.source_range],
                message: "You must supply either `end` or `endAbsolute` arguments".to_owned(),
            }));
        }
    };

    let id = exec_state.next_uuid();
    args.batch_modeling_cmd(
        id,
        ModelingCmd::from(mcmd::ExtendPath {
            path: sketch.id.into(),
            segment: PathSegment::Line {
                end: KPoint2d::from(point).with_z(0.0).map(LengthUnit),
                relative: !is_absolute,
            },
        }),
    )
    .await?;

    let end = if is_absolute {
        point
    } else {
        let from = sketch.current_pen_position()?;
        [from.x + point[0], from.y + point[1]]
    };

    let current_path = Path::ToPoint {
        base: BasePath {
            from: from.into(),
            to: end,
            tag: tag.clone(),
            units: sketch.units,
            geo_meta: GeoMeta {
                id,
                metadata: args.source_range.into(),
            },
        },
    };

    let mut new_sketch = sketch.clone();
    if let Some(tag) = &tag {
        new_sketch.add_tag(tag, &current_path, exec_state);
    }

    new_sketch.paths.push(current_path);

    Ok(new_sketch)
}

/// Draw a line on the x-axis.
pub async fn x_line(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let sketch =
        args.get_unlabeled_kw_arg_typed("sketch", &RuntimeType::Primitive(PrimitiveType::Sketch), exec_state)?;
    let length: Option<TyF64> = args.get_kw_arg_opt_typed("length", &RuntimeType::length(), exec_state)?;
    let end_absolute: Option<TyF64> = args.get_kw_arg_opt_typed("endAbsolute", &RuntimeType::length(), exec_state)?;
    let tag = args.get_kw_arg_opt(NEW_TAG_KW)?;

    let new_sketch = inner_x_line(
        sketch,
        length.map(|t| t.n),
        end_absolute.map(|t| t.n),
        tag,
        exec_state,
        args,
    )
    .await?;
    Ok(KclValue::Sketch {
        value: Box::new(new_sketch),
    })
}

/// Draw a line relative to the current origin to a specified distance away
/// from the current position along the 'x' axis.
///
/// ```no_run
/// exampleSketch = startSketchOn(XZ)
///   |> startProfileAt([0, 0], %)
///   |> xLine(length = 15)
///   |> angledLine(
///     angle = 80,
///     length = 15,
///   )
///   |> line(end = [8, -10])
///   |> xLine(length = 10)
///   |> angledLine(
///     angle = 120,
///     length = 30,
///   )
///   |> xLine(length = -15)
///   |> close()
///
/// example = extrude(exampleSketch, length = 10)
/// ```
#[stdlib {
    name = "xLine",
    keywords = true,
    unlabeled_first = true,
    args = {
        sketch = { docs = "Which sketch should this path be added to?"},
        length = { docs = "How far away along the X axis should this line go? Incompatible with `endAbsolute`.", include_in_snippet = true},
        end_absolute = { docs = "Which absolute X value should this line go to? Incompatible with `length`."},
        tag = { docs = "Create a new tag which refers to this line"},
    }
}]
async fn inner_x_line(
    sketch: Sketch,
    length: Option<f64>,
    end_absolute: Option<f64>,
    tag: Option<TagNode>,
    exec_state: &mut ExecState,
    args: Args,
) -> Result<Sketch, KclError> {
    let from = sketch.current_pen_position()?;
    straight_line(
        StraightLineParams {
            sketch,
            end_absolute: end_absolute.map(|x| [x, from.y]),
            end: length.map(|x| [x, 0.0]),
            tag,
        },
        exec_state,
        args,
    )
    .await
}

/// Draw a line on the y-axis.
pub async fn y_line(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let sketch =
        args.get_unlabeled_kw_arg_typed("sketch", &RuntimeType::Primitive(PrimitiveType::Sketch), exec_state)?;
    let length: Option<TyF64> = args.get_kw_arg_opt_typed("length", &RuntimeType::length(), exec_state)?;
    let end_absolute: Option<TyF64> = args.get_kw_arg_opt_typed("endAbsolute", &RuntimeType::length(), exec_state)?;
    let tag = args.get_kw_arg_opt(NEW_TAG_KW)?;

    let new_sketch = inner_y_line(
        sketch,
        length.map(|t| t.n),
        end_absolute.map(|t| t.n),
        tag,
        exec_state,
        args,
    )
    .await?;
    Ok(KclValue::Sketch {
        value: Box::new(new_sketch),
    })
}

/// Draw a line relative to the current origin to a specified distance away
/// from the current position along the 'y' axis.
///
/// ```no_run
/// exampleSketch = startSketchOn(XZ)
///   |> startProfileAt([0, 0], %)
///   |> yLine(length = 15)
///   |> angledLine(
///     angle = 30,
///     length = 15,
///   )
///   |> line(end = [8, -10])
///   |> yLine(length = -5)
///   |> close()
///
/// example = extrude(exampleSketch, length = 10)
/// ```
#[stdlib {
    name = "yLine",
    keywords = true,
    unlabeled_first = true,
    args = {
        sketch = { docs = "Which sketch should this path be added to?"},
        length = { docs = "How far away along the Y axis should this line go? Incompatible with `endAbsolute`.", include_in_snippet = true},
        end_absolute = { docs = "Which absolute Y value should this line go to? Incompatible with `length`."},
        tag = { docs = "Create a new tag which refers to this line"},
    }
}]
async fn inner_y_line(
    sketch: Sketch,
    length: Option<f64>,
    end_absolute: Option<f64>,
    tag: Option<TagNode>,
    exec_state: &mut ExecState,
    args: Args,
) -> Result<Sketch, KclError> {
    let from = sketch.current_pen_position()?;
    straight_line(
        StraightLineParams {
            sketch,
            end_absolute: end_absolute.map(|y| [from.x, y]),
            end: length.map(|y| [0.0, y]),
            tag,
        },
        exec_state,
        args,
    )
    .await
}

/// Draw an angled line.
pub async fn angled_line(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let sketch = args.get_unlabeled_kw_arg_typed("sketch", &RuntimeType::sketch(), exec_state)?;
    let angle: TyF64 = args.get_kw_arg_typed("angle", &RuntimeType::degrees(), exec_state)?;
    let length: Option<TyF64> = args.get_kw_arg_opt_typed("length", &RuntimeType::length(), exec_state)?;
    let length_x: Option<TyF64> = args.get_kw_arg_opt_typed("lengthX", &RuntimeType::length(), exec_state)?;
    let length_y: Option<TyF64> = args.get_kw_arg_opt_typed("lengthY", &RuntimeType::length(), exec_state)?;
    let end_absolute_x: Option<TyF64> =
        args.get_kw_arg_opt_typed("endAbsoluteX", &RuntimeType::length(), exec_state)?;
    let end_absolute_y: Option<TyF64> =
        args.get_kw_arg_opt_typed("endAbsoluteY", &RuntimeType::length(), exec_state)?;
    let tag = args.get_kw_arg_opt(NEW_TAG_KW)?;

    let new_sketch = inner_angled_line(
        sketch,
        angle.n,
        length.map(|t| t.n),
        length_x.map(|t| t.n),
        length_y.map(|t| t.n),
        end_absolute_x.map(|t| t.n),
        end_absolute_y.map(|t| t.n),
        tag,
        exec_state,
        args,
    )
    .await?;
    Ok(KclValue::Sketch {
        value: Box::new(new_sketch),
    })
}

/// Draw a line segment relative to the current origin using the polar
/// measure of some angle and distance.
///
/// ```no_run
/// exampleSketch = startSketchOn(XZ)
///   |> startProfileAt([0, 0], %)
///   |> yLine(endAbsolute = 15)
///   |> angledLine(
///     angle = 30,
///     length = 15,
///   )
///   |> line(end = [8, -10])
///   |> yLine(endAbsolute = 0)
///   |> close()
///
/// example = extrude(exampleSketch, length = 10)
/// ```
#[stdlib {
    name = "angledLine",
    keywords = true,
    unlabeled_first = true,
    args = {
        sketch = { docs = "Which sketch should this path be added to?"},
        angle = { docs = "Which angle should the line be drawn at?" },
        length = { docs = "Draw the line this distance along the given angle. Only one of `length`, `lengthX`, `lengthY`, `endAbsoluteX`, `endAbsoluteY` can be given."},
        length_x = { docs = "Draw the line this distance along the X axis. Only one of `length`, `lengthX`, `lengthY`, `endAbsoluteX`, `endAbsoluteY` can be given."},
        length_y = { docs = "Draw the line this distance along the Y axis. Only one of `length`, `lengthX`, `lengthY`, `endAbsoluteX`, `endAbsoluteY` can be given."},
        end_absolute_x = { docs = "Draw the line along the given angle until it reaches this point along the X axis. Only one of `length`, `lengthX`, `lengthY`, `endAbsoluteX`, `endAbsoluteY` can be given."},
        end_absolute_y = { docs = "Draw the line along the given angle until it reaches this point along the Y axis. Only one of `length`, `lengthX`, `lengthY`, `endAbsoluteX`, `endAbsoluteY` can be given."},
        tag = { docs = "Create a new tag which refers to this line"},
    }
}]
#[allow(clippy::too_many_arguments)]
async fn inner_angled_line(
    sketch: Sketch,
    angle: f64,
    length: Option<f64>,
    length_x: Option<f64>,
    length_y: Option<f64>,
    end_absolute_x: Option<f64>,
    end_absolute_y: Option<f64>,
    tag: Option<TagNode>,
    exec_state: &mut ExecState,
    args: Args,
) -> Result<Sketch, KclError> {
    let options_given = [length, length_x, length_y, end_absolute_x, end_absolute_y]
        .iter()
        .filter(|x| x.is_some())
        .count();
    if options_given > 1 {
        return Err(KclError::Type(KclErrorDetails {
            message: " one of `length`, `lengthX`, `lengthY`, `endAbsoluteX`, `endAbsoluteY` can be given".to_string(),
            source_ranges: vec![args.source_range],
        }));
    }
    if let Some(length_x) = length_x {
        return inner_angled_line_of_x_length(angle, length_x, sketch, tag, exec_state, args).await;
    }
    if let Some(length_y) = length_y {
        return inner_angled_line_of_y_length(angle, length_y, sketch, tag, exec_state, args).await;
    }
    let angle_degrees = angle;
    match (length, length_x, length_y, end_absolute_x, end_absolute_y) {
        (Some(length), None, None, None, None) => {
            inner_angled_line_length(sketch, angle_degrees, length, tag, exec_state, args).await
        }
        (None, Some(length_x), None, None, None) => {
            inner_angled_line_of_x_length(angle_degrees, length_x, sketch, tag, exec_state, args).await
        }
        (None, None, Some(length_y), None, None) => {
            inner_angled_line_of_y_length(angle_degrees, length_y, sketch, tag, exec_state, args).await
        }
        (None, None, None, Some(end_absolute_x), None) => {
            inner_angled_line_to_x(angle_degrees, end_absolute_x, sketch, tag, exec_state, args).await
        }
        (None, None, None, None, Some(end_absolute_y)) => {
            inner_angled_line_to_y(angle_degrees, end_absolute_y, sketch, tag, exec_state, args).await
        }
        (None, None, None, None, None) => Err(KclError::Type(KclErrorDetails {
            message: "One of `length`, `lengthX`, `lengthY`, `endAbsoluteX`, `endAbsoluteY` must be given".to_string(),
            source_ranges: vec![args.source_range],
        })),
        _ => Err(KclError::Type(KclErrorDetails {
            message: "Only One of `length`, `lengthX`, `lengthY`, `endAbsoluteX`, `endAbsoluteY` can be given"
                .to_string(),
            source_ranges: vec![args.source_range],
        })),
    }
}

async fn inner_angled_line_length(
    sketch: Sketch,
    angle_degrees: f64,
    length: f64,
    tag: Option<TagNode>,
    exec_state: &mut ExecState,
    args: Args,
) -> Result<Sketch, KclError> {
    let from = sketch.current_pen_position()?;

    //double check me on this one - mike
    let delta: [f64; 2] = [
        length * f64::cos(angle_degrees.to_radians()),
        length * f64::sin(angle_degrees.to_radians()),
    ];
    let relative = true;

    let to: [f64; 2] = [from.x + delta[0], from.y + delta[1]];

    let id = exec_state.next_uuid();

    args.batch_modeling_cmd(
        id,
        ModelingCmd::from(mcmd::ExtendPath {
            path: sketch.id.into(),
            segment: PathSegment::Line {
                end: KPoint2d::from(delta).with_z(0.0).map(LengthUnit),
                relative,
            },
        }),
    )
    .await?;

    let current_path = Path::ToPoint {
        base: BasePath {
            from: from.into(),
            to,
            tag: tag.clone(),
            units: sketch.units,
            geo_meta: GeoMeta {
                id,
                metadata: args.source_range.into(),
            },
        },
    };

    let mut new_sketch = sketch.clone();
    if let Some(tag) = &tag {
        new_sketch.add_tag(tag, &current_path, exec_state);
    }

    new_sketch.paths.push(current_path);
    Ok(new_sketch)
}

async fn inner_angled_line_of_x_length(
    angle_degrees: f64,
    length: f64,
    sketch: Sketch,
    tag: Option<TagNode>,
    exec_state: &mut ExecState,
    args: Args,
) -> Result<Sketch, KclError> {
    if angle_degrees.abs() == 270.0 {
        return Err(KclError::Type(KclErrorDetails {
            message: "Cannot have an x constrained angle of 270 degrees".to_string(),
            source_ranges: vec![args.source_range],
        }));
    }

    if angle_degrees.abs() == 90.0 {
        return Err(KclError::Type(KclErrorDetails {
            message: "Cannot have an x constrained angle of 90 degrees".to_string(),
            source_ranges: vec![args.source_range],
        }));
    }

    let to = get_y_component(Angle::from_degrees(angle_degrees), length);

    let new_sketch = straight_line(StraightLineParams::relative(to, sketch, tag), exec_state, args).await?;

    Ok(new_sketch)
}

async fn inner_angled_line_to_x(
    angle_degrees: f64,
    x_to: f64,
    sketch: Sketch,
    tag: Option<TagNode>,
    exec_state: &mut ExecState,
    args: Args,
) -> Result<Sketch, KclError> {
    let from = sketch.current_pen_position()?;

    if angle_degrees.abs() == 270.0 {
        return Err(KclError::Type(KclErrorDetails {
            message: "Cannot have an x constrained angle of 270 degrees".to_string(),
            source_ranges: vec![args.source_range],
        }));
    }

    if angle_degrees.abs() == 90.0 {
        return Err(KclError::Type(KclErrorDetails {
            message: "Cannot have an x constrained angle of 90 degrees".to_string(),
            source_ranges: vec![args.source_range],
        }));
    }

    let x_component = x_to - from.x;
    let y_component = x_component * f64::tan(angle_degrees.to_radians());
    let y_to = from.y + y_component;

    let new_sketch = straight_line(
        StraightLineParams::absolute([x_to, y_to], sketch, tag),
        exec_state,
        args,
    )
    .await?;
    Ok(new_sketch)
}

async fn inner_angled_line_of_y_length(
    angle_degrees: f64,
    length: f64,
    sketch: Sketch,
    tag: Option<TagNode>,
    exec_state: &mut ExecState,
    args: Args,
) -> Result<Sketch, KclError> {
    if angle_degrees.abs() == 0.0 {
        return Err(KclError::Type(KclErrorDetails {
            message: "Cannot have a y constrained angle of 0 degrees".to_string(),
            source_ranges: vec![args.source_range],
        }));
    }

    if angle_degrees.abs() == 180.0 {
        return Err(KclError::Type(KclErrorDetails {
            message: "Cannot have a y constrained angle of 180 degrees".to_string(),
            source_ranges: vec![args.source_range],
        }));
    }

    let to = get_x_component(Angle::from_degrees(angle_degrees), length);

    let new_sketch = straight_line(StraightLineParams::relative(to, sketch, tag), exec_state, args).await?;

    Ok(new_sketch)
}

async fn inner_angled_line_to_y(
    angle_degrees: f64,
    y_to: f64,
    sketch: Sketch,
    tag: Option<TagNode>,
    exec_state: &mut ExecState,
    args: Args,
) -> Result<Sketch, KclError> {
    let from = sketch.current_pen_position()?;

    if angle_degrees.abs() == 0.0 {
        return Err(KclError::Type(KclErrorDetails {
            message: "Cannot have a y constrained angle of 0 degrees".to_string(),
            source_ranges: vec![args.source_range],
        }));
    }

    if angle_degrees.abs() == 180.0 {
        return Err(KclError::Type(KclErrorDetails {
            message: "Cannot have a y constrained angle of 180 degrees".to_string(),
            source_ranges: vec![args.source_range],
        }));
    }

    let y_component = y_to - from.y;
    let x_component = y_component / f64::tan(angle_degrees.to_radians());
    let x_to = from.x + x_component;

    let new_sketch = straight_line(
        StraightLineParams::absolute([x_to, y_to], sketch, tag),
        exec_state,
        args,
    )
    .await?;
    Ok(new_sketch)
}

/// Draw an angled line that intersects with a given line.
pub async fn angled_line_that_intersects(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let sketch =
        args.get_unlabeled_kw_arg_typed("sketch", &RuntimeType::Primitive(PrimitiveType::Sketch), exec_state)?;
    let angle: TyF64 = args.get_kw_arg("angle")?;
    let intersect_tag: TagIdentifier = args.get_kw_arg("intersectTag")?;
    let offset: Option<TyF64> = args.get_kw_arg_opt("offset")?;
    let tag: Option<TagNode> = args.get_kw_arg_opt("tag")?;
    let new_sketch =
        inner_angled_line_that_intersects(sketch, angle, intersect_tag, offset, tag, exec_state, args).await?;
    Ok(KclValue::Sketch {
        value: Box::new(new_sketch),
    })
}

/// Draw an angled line from the current origin, constructing a line segment
/// such that the newly created line intersects the desired target line
/// segment.
///
/// ```no_run
/// exampleSketch = startSketchOn(XZ)
///   |> startProfileAt([0, 0], %)
///   |> line(endAbsolute = [5, 10])
///   |> line(endAbsolute = [-10, 10], tag = $lineToIntersect)
///   |> line(endAbsolute = [0, 20])
///   |> angledLineThatIntersects(
///        angle = 80,
///        intersectTag = lineToIntersect,
///        offset = 10,
///      )
///   |> close()
///
/// example = extrude(exampleSketch, length = 10)
/// ```
#[stdlib {
    name = "angledLineThatIntersects",
    keywords = true,
    unlabeled_first = true,
    args = {
        sketch = { docs = "Which sketch should this path be added to?"},
        angle = { docs = "Which angle should the line be drawn at?" },
        intersect_tag = { docs = "The tag of the line to intersect with" },
        offset = { docs = "The offset from the intersecting line. Defaults to 0." },
        tag = { docs = "Create a new tag which refers to this line"},
    }
}]
pub async fn inner_angled_line_that_intersects(
    sketch: Sketch,
    angle: TyF64,
    intersect_tag: TagIdentifier,
    offset: Option<TyF64>,
    tag: Option<TagNode>,
    exec_state: &mut ExecState,
    args: Args,
) -> Result<Sketch, KclError> {
    let intersect_path = args.get_tag_engine_info(exec_state, &intersect_tag)?;
    let path = intersect_path.path.clone().ok_or_else(|| {
        KclError::Type(KclErrorDetails {
            message: format!("Expected an intersect path with a path, found `{:?}`", intersect_path),
            source_ranges: vec![args.source_range],
        })
    })?;

    let from = sketch.current_pen_position()?;
    let to = intersection_with_parallel_line(
        &[untype_point(path.get_from()).0, untype_point(path.get_to()).0],
        offset.map(|t| t.n).unwrap_or_default(),
        angle.n,
        from.into(),
    );

    straight_line(StraightLineParams::absolute(to, sketch, tag), exec_state, args).await
}

/// Data for start sketch on.
/// You can start a sketch on a plane or an solid.
#[derive(Debug, Clone, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(rename_all = "camelCase", untagged)]
#[allow(clippy::large_enum_variant)]
pub enum SketchData {
    PlaneOrientation(PlaneData),
    Plane(Box<Plane>),
    Solid(Box<Solid>),
}

/// Orientation data that can be used to construct a plane, not a plane in itself.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
#[allow(clippy::large_enum_variant)]
pub enum PlaneData {
    /// The XY plane.
    #[serde(rename = "XY", alias = "xy")]
    XY,
    /// The opposite side of the XY plane.
    #[serde(rename = "-XY", alias = "-xy")]
    NegXY,
    /// The XZ plane.
    #[serde(rename = "XZ", alias = "xz")]
    XZ,
    /// The opposite side of the XZ plane.
    #[serde(rename = "-XZ", alias = "-xz")]
    NegXZ,
    /// The YZ plane.
    #[serde(rename = "YZ", alias = "yz")]
    YZ,
    /// The opposite side of the YZ plane.
    #[serde(rename = "-YZ", alias = "-yz")]
    NegYZ,
    /// A defined plane.
    Plane {
        /// Origin of the plane.
        origin: Point3d,
        /// What should the plane’s X axis be?
        #[serde(rename = "xAxis")]
        x_axis: Point3d,
        /// What should the plane’s Y axis be?
        #[serde(rename = "yAxis")]
        y_axis: Point3d,
        /// The z-axis (normal).
        #[serde(rename = "zAxis")]
        z_axis: Point3d,
    },
}

/// Start a sketch on a specific plane or face.
pub async fn start_sketch_on(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let data = args.get_unlabeled_kw_arg_typed(
        "planeOrSolid",
        &RuntimeType::Union(vec![RuntimeType::solid(), RuntimeType::plane()]),
        exec_state,
    )?;
    let face = args.get_kw_arg_opt("face")?;

    match inner_start_sketch_on(data, face, exec_state, &args).await? {
        SketchSurface::Plane(value) => Ok(KclValue::Plane { value }),
        SketchSurface::Face(value) => Ok(KclValue::Face { value }),
    }
}

/// Start a new 2-dimensional sketch on a specific plane or face.
///
/// ### Sketch on Face Behavior
///
/// There are some important behaviors to understand when sketching on a face:
///
/// The resulting sketch will _include_ the face and thus Solid
/// that was sketched on. So say you were to export the resulting Sketch / Solid
/// from a sketch on a face, you would get both the artifact of the sketch
/// on the face and the parent face / Solid itself.
///
/// This is important to understand because if you were to then sketch on the
/// resulting Solid, it would again include the face and parent Solid that was
/// sketched on. This could go on indefinitely.
///
/// The point is if you want to export the result of a sketch on a face, you
/// only need to export the final Solid that was created from the sketch on the
/// face, since it will include all the parent faces and Solids.
///
///
/// ```no_run
/// exampleSketch = startSketchOn(XY)
///   |> startProfileAt([0, 0], %)
///   |> line(end = [10, 0])
///   |> line(end = [0, 10])
///   |> line(end = [-10, 0])
///   |> close()
///
/// example = extrude(exampleSketch, length = 5)
///
/// exampleSketch002 = startSketchOn(example, face = END)
///   |> startProfileAt([1, 1], %)
///   |> line(end = [8, 0])
///   |> line(end = [0, 8])
///   |> line(end = [-8, 0])
///   |> close()
///
/// example002 = extrude(exampleSketch002, length = 5)
///
/// exampleSketch003 = startSketchOn(example002, face = END)
///   |> startProfileAt([2, 2], %)
///   |> line(end = [6, 0])
///   |> line(end = [0, 6])
///   |> line(end = [-6, 0])
///   |> close()
///
/// example003 = extrude(exampleSketch003, length = 5)
/// ```
///
/// ```no_run
/// // Sketch on the end of an extruded face by tagging the end face.
///
/// exampleSketch = startSketchOn(XY)
///   |> startProfileAt([0, 0], %)
///   |> line(end = [10, 0])
///   |> line(end = [0, 10])
///   |> line(end = [-10, 0])
///   |> close()
///
/// example = extrude(exampleSketch, length = 5, tagEnd = $end01)
///
/// exampleSketch002 = startSketchOn(example, face = end01)
///   |> startProfileAt([1, 1], %)
///   |> line(end = [8, 0])
///   |> line(end = [0, 8])
///   |> line(end = [-8, 0])
///   |> close()
///
/// example002 = extrude(exampleSketch002, length = 5, tagEnd = $end02)
///
/// exampleSketch003 = startSketchOn(example002, face = end02)
///   |> startProfileAt([2, 2], %)
///   |> line(end = [6, 0])
///   |> line(end = [0, 6])
///   |> line(end = [-6, 0])
///   |> close()
///
/// example003 = extrude(exampleSketch003, length = 5)
/// ```
///
/// ```no_run
/// exampleSketch = startSketchOn(XY)
///   |> startProfileAt([0, 0], %)
///   |> line(end = [10, 0])
///   |> line(end = [0, 10], tag = $sketchingFace)
///   |> line(end = [-10, 0])
///   |> close()
///
/// example = extrude(exampleSketch, length = 10)
///
/// exampleSketch002 = startSketchOn(example, face = sketchingFace)
///   |> startProfileAt([1, 1], %)
///   |> line(end = [8, 0])
///   |> line(end = [0, 8])
///   |> line(end = [-8, 0])
///   |> close(tag = $sketchingFace002)
///
/// example002 = extrude(exampleSketch002, length = 10)
///
/// exampleSketch003 = startSketchOn(example002, face = sketchingFace002)
///   |> startProfileAt([-8, 12], %)
///   |> line(end = [0, 6])
///   |> line(end = [6, 0])
///   |> line(end = [0, -6])
///   |> close()
///
/// example003 = extrude(exampleSketch003, length = 5)
/// ```
///
/// ```no_run
/// exampleSketch = startSketchOn(XY)
///   |> startProfileAt([4, 12], %)
///   |> line(end = [2, 0])
///   |> line(end = [0, -6])
///   |> line(end = [4, -6])
///   |> line(end = [0, -6])
///   |> line(end = [-3.75, -4.5])
///   |> line(end = [0, -5.5])
///   |> line(end = [-2, 0])
///   |> close()
///
/// example = revolve(exampleSketch, axis = Y, angle = 180)
///
/// exampleSketch002 = startSketchOn(example, face = END)
///   |> startProfileAt([4.5, -5], %)
///   |> line(end = [0, 5])
///   |> line(end = [5, 0])
///   |> line(end = [0, -5])
///   |> close()
///
/// example002 = extrude(exampleSketch002, length = 5)
/// ```
///
/// ```no_run
/// // Sketch on the end of a revolved face by tagging the end face.
///
/// exampleSketch = startSketchOn(XY)
///   |> startProfileAt([4, 12], %)
///   |> line(end = [2, 0])
///   |> line(end = [0, -6])
///   |> line(end = [4, -6])
///   |> line(end = [0, -6])
///   |> line(end = [-3.75, -4.5])
///   |> line(end = [0, -5.5])
///   |> line(end = [-2, 0])
///   |> close()
///
/// example = revolve(exampleSketch, axis = Y, angle = 180, tagEnd = $end01)
///
/// exampleSketch002 = startSketchOn(example, face = end01)
///   |> startProfileAt([4.5, -5], %)
///   |> line(end = [0, 5])
///   |> line(end = [5, 0])
///   |> line(end = [0, -5])
///   |> close()
///
/// example002 = extrude(exampleSketch002, length = 5)
/// ```
///
/// ```no_run
/// a1 = startSketchOn({
///     origin = { x = 0, y = 0, z = 0 },
///     xAxis = { x = 1, y = 0, z = 0 },
///     yAxis = { x = 0, y = 1, z = 0 },
///     zAxis = { x = 0, y = 0, z = 1 }
///   })
///  |> startProfileAt([0, 0], %)
///  |> line(end = [100.0, 0])
///  |> yLine(length = -100.0)
///  |> xLine(length = -100.0)
///  |> yLine(length = 100.0)
///  |> close()
///  |> extrude(length = 3.14)
/// ```
#[stdlib {
    name = "startSketchOn",
    feature_tree_operation = true,
    keywords = true,
    unlabeled_first = true,
    args = {
        plane_or_solid = { docs = "The plane or solid to sketch on"},
        face = { docs = "Identify a face of a solid if a solid is specified as the input argument (`plane_or_solid`)"},
    }
}]
async fn inner_start_sketch_on(
    plane_or_solid: SketchData,
    face: Option<FaceTag>,
    exec_state: &mut ExecState,
    args: &Args,
) -> Result<SketchSurface, KclError> {
    match plane_or_solid {
        SketchData::PlaneOrientation(plane_data) => {
            let plane = make_sketch_plane_from_orientation(plane_data, exec_state, args).await?;
            Ok(SketchSurface::Plane(plane))
        }
        SketchData::Plane(plane) => {
            if plane.value == crate::exec::PlaneType::Uninit {
                let plane = make_sketch_plane_from_orientation(plane.into_plane_data(), exec_state, args).await?;
                Ok(SketchSurface::Plane(plane))
            } else {
                // Create artifact used only by the UI, not the engine.
                let id = exec_state.next_uuid();
                exec_state.add_artifact(Artifact::StartSketchOnPlane(StartSketchOnPlane {
                    id: ArtifactId::from(id),
                    plane_id: plane.artifact_id,
                    code_ref: CodeRef::placeholder(args.source_range),
                }));

                Ok(SketchSurface::Plane(plane))
            }
        }
        SketchData::Solid(solid) => {
            let Some(tag) = face else {
                return Err(KclError::Type(KclErrorDetails {
                    message: "Expected a tag for the face to sketch on".to_string(),
                    source_ranges: vec![args.source_range],
                }));
            };
            let face = start_sketch_on_face(solid, tag, exec_state, args).await?;

            // Create artifact used only by the UI, not the engine.
            let id = exec_state.next_uuid();
            exec_state.add_artifact(Artifact::StartSketchOnFace(StartSketchOnFace {
                id: ArtifactId::from(id),
                face_id: face.artifact_id,
                code_ref: CodeRef::placeholder(args.source_range),
            }));

            Ok(SketchSurface::Face(face))
        }
    }
}

async fn start_sketch_on_face(
    solid: Box<Solid>,
    tag: FaceTag,
    exec_state: &mut ExecState,
    args: &Args,
) -> Result<Box<Face>, KclError> {
    let extrude_plane_id = tag.get_face_id(&solid, exec_state, args, true).await?;

    Ok(Box::new(Face {
        id: extrude_plane_id,
        artifact_id: extrude_plane_id.into(),
        value: tag.to_string(),
        // TODO: get this from the extrude plane data.
        x_axis: solid.sketch.on.x_axis(),
        y_axis: solid.sketch.on.y_axis(),
        z_axis: solid.sketch.on.z_axis(),
        units: solid.units,
        solid,
        meta: vec![args.source_range.into()],
    }))
}

async fn make_sketch_plane_from_orientation(
    data: PlaneData,
    exec_state: &mut ExecState,
    args: &Args,
) -> Result<Box<Plane>, KclError> {
    let plane = Plane::from_plane_data(data.clone(), exec_state);

    // Create the plane on the fly.
    let clobber = false;
    let size = LengthUnit(60.0);
    let hide = Some(true);
    match data {
        PlaneData::XY | PlaneData::NegXY | PlaneData::XZ | PlaneData::NegXZ | PlaneData::YZ | PlaneData::NegYZ => {
            // TODO: ignoring the default planes here since we already created them, breaks the
            // front end for the feature tree which is stupid and we should fix it.
            let x_axis = match data {
                PlaneData::NegXY => Point3d::new(-1.0, 0.0, 0.0, UnitLen::Mm),
                PlaneData::NegXZ => Point3d::new(-1.0, 0.0, 0.0, UnitLen::Mm),
                PlaneData::NegYZ => Point3d::new(0.0, -1.0, 0.0, UnitLen::Mm),
                _ => plane.x_axis,
            };
            args.batch_modeling_cmd(
                plane.id,
                ModelingCmd::from(mcmd::MakePlane {
                    clobber,
                    origin: plane.origin.into(),
                    size,
                    x_axis: x_axis.into(),
                    y_axis: plane.y_axis.into(),
                    hide,
                }),
            )
            .await?;
        }
        PlaneData::Plane {
            origin,
            x_axis,
            y_axis,
            z_axis: _,
        } => {
            args.batch_modeling_cmd(
                plane.id,
                ModelingCmd::from(mcmd::MakePlane {
                    clobber,
                    origin: origin.into(),
                    size,
                    x_axis: x_axis.into(),
                    y_axis: y_axis.into(),
                    hide,
                }),
            )
            .await?;
        }
    }

    Ok(Box::new(plane))
}

/// Start a new profile at a given point.
pub async fn start_profile_at(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let (start, sketch_surface, tag) = args.get_data_and_sketch_surface()?;

    let sketch = inner_start_profile_at([start[0].n, start[1].n], sketch_surface, tag, exec_state, args).await?;
    Ok(KclValue::Sketch {
        value: Box::new(sketch),
    })
}

/// Start a new profile at a given point.
///
/// ```no_run
/// exampleSketch = startSketchOn(XZ)
///   |> startProfileAt([0, 0], %)
///   |> line(end = [10, 0])
///   |> line(end = [0, 10])
///   |> line(end = [-10, 0])
///   |> close()
///
/// example = extrude(exampleSketch, length = 5)
/// ```
///
/// ```no_run
/// exampleSketch = startSketchOn(-XZ)
///   |> startProfileAt([10, 10], %)
///   |> line(end = [10, 0])
///   |> line(end = [0, 10])
///   |> line(end = [-10, 0])
///   |> close()
///
/// example = extrude(exampleSketch, length = 5)
/// ```
///
/// ```no_run
/// exampleSketch = startSketchOn(-XZ)
///   |> startProfileAt([-10, 23], %)
///   |> line(end = [10, 0])
///   |> line(end = [0, 10])
///   |> line(end = [-10, 0])
///   |> close()
///
/// example = extrude(exampleSketch, length = 5)
/// ```
#[stdlib {
    name = "startProfileAt",
}]
pub(crate) async fn inner_start_profile_at(
    to: [f64; 2],
    sketch_surface: SketchSurface,
    tag: Option<TagNode>,
    exec_state: &mut ExecState,
    args: Args,
) -> Result<Sketch, KclError> {
    match &sketch_surface {
        SketchSurface::Face(face) => {
            // Flush the batch for our fillets/chamfers if there are any.
            // If we do not do these for sketch on face, things will fail with face does not exist.
            args.flush_batch_for_solids(exec_state, &[(*face.solid).clone()])
                .await?;
        }
        SketchSurface::Plane(plane) if !plane.is_standard() => {
            // Hide whatever plane we are sketching on.
            // This is especially helpful for offset planes, which would be visible otherwise.
            args.batch_end_cmd(
                exec_state.next_uuid(),
                ModelingCmd::from(mcmd::ObjectVisible {
                    object_id: plane.id,
                    hidden: true,
                }),
            )
            .await?;
        }
        _ => {}
    }

    let enable_sketch_id = exec_state.next_uuid();
    let path_id = exec_state.next_uuid();
    let move_pen_id = exec_state.next_uuid();
    args.batch_modeling_cmds(&[
        // Enter sketch mode on the surface.
        // We call this here so you can reuse the sketch surface for multiple sketches.
        ModelingCmdReq {
            cmd: ModelingCmd::from(mcmd::EnableSketchMode {
                animated: false,
                ortho: false,
                entity_id: sketch_surface.id(),
                adjust_camera: false,
                planar_normal: if let SketchSurface::Plane(plane) = &sketch_surface {
                    // We pass in the normal for the plane here.
                    Some(plane.z_axis.into())
                } else {
                    None
                },
            }),
            cmd_id: enable_sketch_id.into(),
        },
        ModelingCmdReq {
            cmd: ModelingCmd::from(mcmd::StartPath::default()),
            cmd_id: path_id.into(),
        },
        ModelingCmdReq {
            cmd: ModelingCmd::from(mcmd::MovePathPen {
                path: path_id.into(),
                to: KPoint2d::from(to).with_z(0.0).map(LengthUnit),
            }),
            cmd_id: move_pen_id.into(),
        },
        ModelingCmdReq {
            cmd: ModelingCmd::SketchModeDisable(mcmd::SketchModeDisable::default()),
            cmd_id: exec_state.next_uuid().into(),
        },
    ])
    .await?;

    let current_path = BasePath {
        from: to,
        to,
        tag: tag.clone(),
        units: sketch_surface.units(),
        geo_meta: GeoMeta {
            id: move_pen_id,
            metadata: args.source_range.into(),
        },
    };

    let sketch = Sketch {
        id: path_id,
        original_id: path_id,
        artifact_id: path_id.into(),
        on: sketch_surface.clone(),
        paths: vec![],
        units: sketch_surface.units(),
        mirror: Default::default(),
        meta: vec![args.source_range.into()],
        tags: if let Some(tag) = &tag {
            let mut tag_identifier: TagIdentifier = tag.into();
            tag_identifier.info = vec![(
                exec_state.stack().current_epoch(),
                TagEngineInfo {
                    id: current_path.geo_meta.id,
                    sketch: path_id,
                    path: Some(Path::Base {
                        base: current_path.clone(),
                    }),
                    surface: None,
                },
            )];
            IndexMap::from([(tag.name.to_string(), tag_identifier)])
        } else {
            Default::default()
        },
        start: current_path,
    };
    Ok(sketch)
}

/// Returns the X component of the sketch profile start point.
pub async fn profile_start_x(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let sketch: Sketch = args.get_sketch(exec_state)?;
    let ty = sketch.units.into();
    let x = inner_profile_start_x(sketch)?;
    Ok(args.make_user_val_from_f64_with_type(TyF64::new(x, ty)))
}

/// Extract the provided 2-dimensional sketch's profile's origin's 'x'
/// value.
///
/// ```no_run
/// sketch001 = startSketchOn(XY)
///  |> startProfileAt([5, 2], %)
///  |> angledLine(angle = -26.6, length = 50)
///  |> angledLine(angle = 90, length = 50)
///  |> angledLine(angle = 30, endAbsoluteX = profileStartX(%))
/// ```
#[stdlib {
    name = "profileStartX"
}]
pub(crate) fn inner_profile_start_x(sketch: Sketch) -> Result<f64, KclError> {
    Ok(sketch.start.to[0])
}

/// Returns the Y component of the sketch profile start point.
pub async fn profile_start_y(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let sketch: Sketch = args.get_sketch(exec_state)?;
    let ty = sketch.units.into();
    let x = inner_profile_start_y(sketch)?;
    Ok(args.make_user_val_from_f64_with_type(TyF64::new(x, ty)))
}

/// Extract the provided 2-dimensional sketch's profile's origin's 'y'
/// value.
///
/// ```no_run
/// sketch001 = startSketchOn(XY)
///  |> startProfileAt([5, 2], %)
///  |> angledLine(angle = -60, length = 14 )
///  |> angledLine(angle = 30, endAbsoluteY =  profileStartY(%))
/// ```
#[stdlib {
    name = "profileStartY"
}]
pub(crate) fn inner_profile_start_y(sketch: Sketch) -> Result<f64, KclError> {
    Ok(sketch.start.to[1])
}

/// Returns the sketch profile start point.
pub async fn profile_start(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let sketch: Sketch = args.get_sketch(exec_state)?;
    let ty = sketch.units.into();
    let point = inner_profile_start(sketch)?;
    Ok(KclValue::from_point2d(point, ty, args.into()))
}

/// Extract the provided 2-dimensional sketch's profile's origin
/// value.
///
/// ```no_run
/// sketch001 = startSketchOn(XY)
///  |> startProfileAt([5, 2], %)
///  |> angledLine(angle = 120, length = 50 , tag = $seg01)
///  |> angledLine(angle = segAng(seg01) + 120, length = 50 )
///  |> line(end = profileStart(%))
///  |> close()
///  |> extrude(length = 20)
/// ```
#[stdlib {
    name = "profileStart"
}]
pub(crate) fn inner_profile_start(sketch: Sketch) -> Result<[f64; 2], KclError> {
    Ok(sketch.start.to)
}

/// Close the current sketch.
pub async fn close(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let sketch =
        args.get_unlabeled_kw_arg_typed("sketch", &RuntimeType::Primitive(PrimitiveType::Sketch), exec_state)?;
    let tag = args.get_kw_arg_opt(NEW_TAG_KW)?;
    let new_sketch = inner_close(sketch, tag, exec_state, args).await?;
    Ok(KclValue::Sketch {
        value: Box::new(new_sketch),
    })
}

/// Construct a line segment from the current origin back to the profile's
/// origin, ensuring the resulting 2-dimensional sketch is not open-ended.
///
/// ```no_run
/// startSketchOn(XZ)
///    |> startProfileAt([0, 0], %)
///    |> line(end = [10, 10])
///    |> line(end = [10, 0])
///    |> close()
///    |> extrude(length = 10)
/// ```
///
/// ```no_run
/// exampleSketch = startSketchOn(-XZ)
///   |> startProfileAt([0, 0], %)
///   |> line(end = [10, 0])
///   |> line(end = [0, 10])
///   |> close()
///
/// example = extrude(exampleSketch, length = 10)
/// ```
#[stdlib {
    name = "close",
    keywords = true,
    unlabeled_first = true,
    args = {
        sketch = { docs = "The sketch you want to close"},
        tag = { docs = "Create a new tag which refers to this line"},
    }
}]
pub(crate) async fn inner_close(
    sketch: Sketch,
    tag: Option<TagNode>,
    exec_state: &mut ExecState,
    args: Args,
) -> Result<Sketch, KclError> {
    let from = sketch.current_pen_position()?;
    let to: Point2d = sketch.start.get_from().into();

    let id = exec_state.next_uuid();

    args.batch_modeling_cmd(id, ModelingCmd::from(mcmd::ClosePath { path_id: sketch.id }))
        .await?;

    let current_path = Path::ToPoint {
        base: BasePath {
            from: from.into(),
            to: to.into(),
            tag: tag.clone(),
            units: sketch.units,
            geo_meta: GeoMeta {
                id,
                metadata: args.source_range.into(),
            },
        },
    };

    let mut new_sketch = sketch.clone();
    if let Some(tag) = &tag {
        new_sketch.add_tag(tag, &current_path, exec_state);
    }

    new_sketch.paths.push(current_path);

    Ok(new_sketch)
}

/// Draw an arc.
pub async fn arc(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let sketch =
        args.get_unlabeled_kw_arg_typed("sketch", &RuntimeType::Primitive(PrimitiveType::Sketch), exec_state)?;

    let angle_start: Option<TyF64> = args.get_kw_arg_opt_typed("angleStart", &RuntimeType::degrees(), exec_state)?;
    let angle_end: Option<TyF64> = args.get_kw_arg_opt_typed("angleEnd", &RuntimeType::degrees(), exec_state)?;
    let radius: Option<TyF64> = args.get_kw_arg_opt_typed("radius", &RuntimeType::length(), exec_state)?;
    let end_absolute: Option<[TyF64; 2]> =
        args.get_kw_arg_opt_typed("endAbsolute", &RuntimeType::point2d(), exec_state)?;
    let interior_absolute: Option<[TyF64; 2]> =
        args.get_kw_arg_opt_typed("interiorAbsolute", &RuntimeType::point2d(), exec_state)?;
    let tag = args.get_kw_arg_opt(NEW_TAG_KW)?;
    let new_sketch = inner_arc(
        sketch,
        angle_start,
        angle_end,
        radius,
        interior_absolute,
        end_absolute,
        tag,
        exec_state,
        args,
    )
    .await?;
    Ok(KclValue::Sketch {
        value: Box::new(new_sketch),
    })
}

/// Draw a curved line segment along an imaginary circle.
///
/// The arc is constructed such that the current position of the sketch is
/// placed along an imaginary circle of the specified radius, at angleStart
/// degrees. The resulting arc is the segment of the imaginary circle from
/// that origin point to angleEnd, radius away from the center of the imaginary
/// circle.
///
/// Unless this makes a lot of sense and feels like what you're looking
/// for to construct your shape, you're likely looking for tangentialArc.
///
/// ```no_run
/// exampleSketch = startSketchOn(XZ)
///   |> startProfileAt([0, 0], %)
///   |> line(end = [10, 0])
///   |> arc(
///        angleStart = 0,
///        angleEnd = 280,
///        radius = 16
///      )
///   |> close()
/// example = extrude(exampleSketch, length = 10)
/// ```
/// ```no_run
/// exampleSketch = startSketchOn(XZ)
///   |> startProfileAt([0, 0], %)
///   |> arc(
///         endAbsolute = [10,0],
///         interiorAbsolute = [5,5]
///      )
///   |> close()
/// example = extrude(exampleSketch, length = 10)
/// ```
#[stdlib {
    name = "arc",
    keywords = true,
    unlabeled_first = true,
    args = {
        sketch = { docs = "Which sketch should this path be added to?" },
        angle_start = { docs = "Where along the circle should this arc start?", include_in_snippet = true },
        angle_end = { docs = "Where along the circle should this arc end?", include_in_snippet = true },
        radius = { docs = "How large should the circle be?", include_in_snippet = true },
        interior_absolute = { docs = "Any point between the arc's start and end? Requires `endAbsolute`. Incompatible with `angleStart` or `angleEnd`" },
        end_absolute = { docs = "Where should this arc end? Requires `interiorAbsolute`. Incompatible with `angleStart` or `angleEnd`" },
        tag = { docs = "Create a new tag which refers to this line"},
    }
}]
#[allow(clippy::too_many_arguments)]
pub(crate) async fn inner_arc(
    sketch: Sketch,
    angle_start: Option<TyF64>,
    angle_end: Option<TyF64>,
    radius: Option<TyF64>,
    interior_absolute: Option<[TyF64; 2]>,
    end_absolute: Option<[TyF64; 2]>,
    tag: Option<TagNode>,
    exec_state: &mut ExecState,
    args: Args,
) -> Result<Sketch, KclError> {
    let from: Point2d = sketch.current_pen_position()?;
    let id = exec_state.next_uuid();

    // Relative case
    match (angle_start, angle_end, radius, interior_absolute, end_absolute) {
        (Some(angle_start), Some(angle_end), Some(radius), None, None) => {
            relative_arc(&args, id, exec_state, sketch, from, angle_start, angle_end, radius, tag).await
        }
        (None, None, None, Some(interior_absolute), Some(end_absolute)) => {
            absolute_arc(&args, id, exec_state, sketch, from, interior_absolute, end_absolute, tag).await
        }
        _ => {
            Err(KclError::Type(KclErrorDetails {
                message:
                    "Invalid combination of arguments. Either provide (angleStart, angleEnd, radius) or (endAbsolute, interiorAbsolute)"
                        .to_string(),
                source_ranges: vec![args.source_range],
            }))
        }
    }
}

#[allow(clippy::too_many_arguments)]
pub async fn absolute_arc(
    args: &Args,
    id: uuid::Uuid,
    exec_state: &mut ExecState,
    sketch: Sketch,
    from: Point2d,
    interior_absolute: [TyF64; 2],
    end_absolute: [TyF64; 2],
    tag: Option<TagNode>,
) -> Result<Sketch, KclError> {
    // The start point is taken from the path you are extending.
    args.batch_modeling_cmd(
        id,
        ModelingCmd::from(mcmd::ExtendPath {
            path: sketch.id.into(),
            segment: PathSegment::ArcTo {
                end: kcmc::shared::Point3d {
                    x: LengthUnit(end_absolute[0].n),
                    y: LengthUnit(end_absolute[1].n),
                    z: LengthUnit(0.0),
                },
                interior: kcmc::shared::Point3d {
                    x: LengthUnit(interior_absolute[0].n),
                    y: LengthUnit(interior_absolute[1].n),
                    z: LengthUnit(0.0),
                },
                relative: false,
            },
        }),
    )
    .await?;

    let start = [from.x, from.y];
    let end = end_absolute.clone();
    let untyped_end = untype_point(end);

    let current_path = Path::ArcThreePoint {
        base: BasePath {
            from: from.into(),
            to: untyped_end.0,
            tag: tag.clone(),
            units: sketch.units,
            geo_meta: GeoMeta {
                id,
                metadata: args.source_range.into(),
            },
        },
        p1: start,
        p2: untype_point(interior_absolute).0,
        p3: untyped_end.0,
    };

    let mut new_sketch = sketch.clone();
    if let Some(tag) = &tag {
        new_sketch.add_tag(tag, &current_path, exec_state);
    }

    new_sketch.paths.push(current_path);

    Ok(new_sketch)
}

#[allow(clippy::too_many_arguments)]
pub async fn relative_arc(
    args: &Args,
    id: uuid::Uuid,
    exec_state: &mut ExecState,
    sketch: Sketch,
    from: Point2d,
    angle_start: TyF64,
    angle_end: TyF64,
    radius: TyF64,
    tag: Option<TagNode>,
) -> Result<Sketch, KclError> {
    let a_start = Angle::from_degrees(angle_start.n);
    let a_end = Angle::from_degrees(angle_end.n);
    let (center, end) = arc_center_and_end(from.into(), a_start, a_end, radius.n);
    if angle_start == angle_end {
        return Err(KclError::Type(KclErrorDetails {
            message: "Arc start and end angles must be different".to_string(),
            source_ranges: vec![args.source_range],
        }));
    }
    let ccw = angle_start.n < angle_end.n;

    args.batch_modeling_cmd(
        id,
        ModelingCmd::from(mcmd::ExtendPath {
            path: sketch.id.into(),
            segment: PathSegment::Arc {
                start: a_start,
                end: a_end,
                center: KPoint2d::from(center).map(LengthUnit),
                radius: LengthUnit(radius.n),
                relative: false,
            },
        }),
    )
    .await?;

    let current_path = Path::Arc {
        base: BasePath {
            from: from.into(),
            to: end,
            tag: tag.clone(),
            units: sketch.units,
            geo_meta: GeoMeta {
                id,
                metadata: args.source_range.into(),
            },
        },
        center,
        radius: radius.n,
        ccw,
    };

    let mut new_sketch = sketch.clone();
    if let Some(tag) = &tag {
        new_sketch.add_tag(tag, &current_path, exec_state);
    }

    new_sketch.paths.push(current_path);

    Ok(new_sketch)
}
/// Draw a tangential arc to a specific point.
pub async fn tangential_arc(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let sketch =
        args.get_unlabeled_kw_arg_typed("sketch", &RuntimeType::Primitive(PrimitiveType::Sketch), exec_state)?;
    let end = args.get_kw_arg_opt_typed("end", &RuntimeType::point2d(), exec_state)?;
    let end_absolute = args.get_kw_arg_opt_typed("endAbsolute", &RuntimeType::point2d(), exec_state)?;
    let radius = args.get_kw_arg_opt_typed("radius", &RuntimeType::length(), exec_state)?;
    let angle = args.get_kw_arg_opt_typed("angle", &RuntimeType::angle(), exec_state)?;
    let tag = args.get_kw_arg_opt(NEW_TAG_KW)?;

    let new_sketch = inner_tangential_arc(
        sketch,
        end_absolute.map(|p| untype_point(p).0),
        end.map(|p| untype_point(p).0),
        radius,
        angle,
        tag,
        exec_state,
        args,
    )
    .await?;
    Ok(KclValue::Sketch {
        value: Box::new(new_sketch),
    })
}

/// Starting at the current sketch's origin, draw a curved line segment along
/// some part of an imaginary circle until it reaches the desired (x, y)
/// coordinates.
///
/// When using radius and angle, draw a curved line segment along part of an
/// imaginary circle. The arc is constructed such that the last line segment is
/// placed tangent to the imaginary circle of the specified radius. The
/// resulting arc is the segment of the imaginary circle from that tangent point
/// for 'angle' degrees along the imaginary circle.
///
/// ```no_run
/// exampleSketch = startSketchOn(XZ)
///   |> startProfileAt([0, 0], %)
///   |> angledLine(
///     angle = 45,
///     length = 10,
///   )
///   |> tangentialArc(end = [0, -10])
///   |> line(end = [-10, 0])
///   |> close()
///
/// example = extrude(exampleSketch, length = 10)
/// ```
///
/// ```no_run
/// exampleSketch = startSketchOn(XZ)
///   |> startProfileAt([0, 0], %)
///   |> angledLine(
///     angle = 60,
///     length = 10,
///   )
///   |> tangentialArc(endAbsolute = [15, 15])
///   |> line(end = [10, -15])
///   |> close()
///
/// example = extrude(exampleSketch, length = 10)
/// ```
///
/// ```no_run
/// exampleSketch = startSketchOn(XZ)
///   |> startProfileAt([0, 0], %)
///   |> angledLine(
///     angle = 60,
///     length = 10,
///   )
///   |> tangentialArc(radius = 10, angle = -120)
///   |> angledLine(
///     angle = -60,
///     length = 10,
///   )
///   |> close()
///
/// example = extrude(exampleSketch, length = 10)
/// ```
#[stdlib {
    name = "tangentialArc",
    keywords = true,
    unlabeled_first = true,
    args = {
        sketch = { docs = "Which sketch should this path be added to?"},
        end_absolute = { docs = "Which absolute point should this arc go to? Incompatible with `end`, `radius`, and `offset`."},
        end = { docs = "How far away (along the X and Y axes) should this arc go? Incompatible with `endAbsolute`, `radius`, and `offset`.", include_in_snippet = true },
        radius = { docs = "Radius of the imaginary circle. `angle` must be given. Incompatible with `end` and `endAbsolute`."},
        angle = { docs = "Offset of the arc in degrees. `radius` must be given. Incompatible with `end` and `endAbsolute`."},
        tag = { docs = "Create a new tag which refers to this arc"},
    }
}]
#[allow(clippy::too_many_arguments)]
async fn inner_tangential_arc(
    sketch: Sketch,
    end_absolute: Option<[f64; 2]>,
    end: Option<[f64; 2]>,
    radius: Option<TyF64>,
    angle: Option<TyF64>,
    tag: Option<TagNode>,
    exec_state: &mut ExecState,
    args: Args,
) -> Result<Sketch, KclError> {
    match (end_absolute, end, radius, angle) {
        (Some(point), None, None, None) => {
            inner_tangential_arc_to_point(sketch, point, true, tag, exec_state, args).await
        }
        (None, Some(point), None, None) => {
            inner_tangential_arc_to_point(sketch, point, false, tag, exec_state, args).await
        }
        (None, None, Some(radius), Some(angle)) => {
            let data = TangentialArcData::RadiusAndOffset { radius, offset: angle };
            inner_tangential_arc_radius_angle(data, sketch, tag, exec_state, args).await
        }
        (Some(_), Some(_), None, None) => Err(KclError::Semantic(KclErrorDetails {
            source_ranges: vec![args.source_range],
            message: "You cannot give both `end` and `endAbsolute` params, you have to choose one or the other"
                .to_owned(),
        })),
        (None, None, Some(_), None) | (None, None, None, Some(_)) => Err(KclError::Semantic(KclErrorDetails {
            source_ranges: vec![args.source_range],
            message: "You must supply both `radius` and `angle` arguments".to_owned(),
        })),
        (_, _, _, _) => Err(KclError::Semantic(KclErrorDetails {
            source_ranges: vec![args.source_range],
            message: "You must supply `end`, `endAbsolute`, or both `radius` and `angle` arguments".to_owned(),
        })),
    }
}

/// Data to draw a tangential arc.
#[derive(Debug, Clone, Serialize, PartialEq, JsonSchema, ts_rs::TS)]
#[ts(export)]
#[serde(rename_all = "camelCase", untagged)]
pub enum TangentialArcData {
    RadiusAndOffset {
        /// Radius of the arc.
        /// Not to be confused with Raiders of the Lost Ark.
        radius: TyF64,
        /// Offset of the arc, in degrees.
        offset: TyF64,
    },
}

/// Draw a curved line segment along part of an imaginary circle.
///
/// The arc is constructed such that the last line segment is placed tangent
/// to the imaginary circle of the specified radius. The resulting arc is the
/// segment of the imaginary circle from that tangent point for 'angle'
/// degrees along the imaginary circle.
async fn inner_tangential_arc_radius_angle(
    data: TangentialArcData,
    sketch: Sketch,
    tag: Option<TagNode>,
    exec_state: &mut ExecState,
    args: Args,
) -> Result<Sketch, KclError> {
    let from: Point2d = sketch.current_pen_position()?;
    // next set of lines is some undocumented voodoo from get_tangential_arc_to_info
    let tangent_info = sketch.get_tangential_info_from_paths(); //this function desperately needs some documentation
    let tan_previous_point = tangent_info.tan_previous_point(from.into());

    let id = exec_state.next_uuid();

    let (center, to, ccw) = match data {
        TangentialArcData::RadiusAndOffset { radius, offset } => {
            // KCL stdlib types use degrees.
            let offset = Angle::from_degrees(offset.n);

            // Calculate the end point from the angle and radius.
            // atan2 outputs radians.
            let previous_end_tangent = Angle::from_radians(f64::atan2(
                from.y - tan_previous_point[1],
                from.x - tan_previous_point[0],
            ));
            // make sure the arc center is on the correct side to guarantee deterministic behavior
            // note the engine automatically rejects an offset of zero, if we want to flag that at KCL too to avoid engine errors
            let ccw = offset.to_degrees() > 0.0;
            let tangent_to_arc_start_angle = if ccw {
                // CCW turn
                Angle::from_degrees(-90.0)
            } else {
                // CW turn
                Angle::from_degrees(90.0)
            };
            // may need some logic and / or modulo on the various angle values to prevent them from going "backwards"
            // but the above logic *should* capture that behavior
            let start_angle = previous_end_tangent + tangent_to_arc_start_angle;
            let end_angle = start_angle + offset;
            let (center, to) = arc_center_and_end(from.into(), start_angle, end_angle, radius.n);

            args.batch_modeling_cmd(
                id,
                ModelingCmd::from(mcmd::ExtendPath {
                    path: sketch.id.into(),
                    segment: PathSegment::TangentialArc {
                        radius: LengthUnit(radius.n),
                        offset,
                    },
                }),
            )
            .await?;
            (center, to, ccw)
        }
    };

    let current_path = Path::TangentialArc {
        ccw,
        center,
        base: BasePath {
            from: from.into(),
            to,
            tag: tag.clone(),
            units: sketch.units,
            geo_meta: GeoMeta {
                id,
                metadata: args.source_range.into(),
            },
        },
    };

    let mut new_sketch = sketch.clone();
    if let Some(tag) = &tag {
        new_sketch.add_tag(tag, &current_path, exec_state);
    }

    new_sketch.paths.push(current_path);

    Ok(new_sketch)
}

fn tan_arc_to(sketch: &Sketch, to: &[f64; 2]) -> ModelingCmd {
    ModelingCmd::from(mcmd::ExtendPath {
        path: sketch.id.into(),
        segment: PathSegment::TangentialArcTo {
            angle_snap_increment: None,
            to: KPoint2d::from(*to).with_z(0.0).map(LengthUnit),
        },
    })
}

async fn inner_tangential_arc_to_point(
    sketch: Sketch,
    point: [f64; 2],
    is_absolute: bool,
    tag: Option<TagNode>,
    exec_state: &mut ExecState,
    args: Args,
) -> Result<Sketch, KclError> {
    let from: Point2d = sketch.current_pen_position()?;
    let tangent_info = sketch.get_tangential_info_from_paths();
    let tan_previous_point = tangent_info.tan_previous_point(from.into());

    let to = if is_absolute {
        point
    } else {
        [from.x + point[0], from.y + point[1]]
    };
    let [to_x, to_y] = to;
    let result = get_tangential_arc_to_info(TangentialArcInfoInput {
        arc_start_point: [from.x, from.y],
        arc_end_point: to,
        tan_previous_point,
        obtuse: true,
    });

    if result.center[0].is_infinite() {
        return Err(KclError::Semantic(KclErrorDetails {
            source_ranges: vec![args.source_range],
            message:
                "could not sketch tangential arc, because its center would be infinitely far away in the X direction"
                    .to_owned(),
        }));
    } else if result.center[1].is_infinite() {
        return Err(KclError::Semantic(KclErrorDetails {
            source_ranges: vec![args.source_range],
            message:
                "could not sketch tangential arc, because its center would be infinitely far away in the Y direction"
                    .to_owned(),
        }));
    }

    let delta = if is_absolute {
        [to_x - from.x, to_y - from.y]
    } else {
        point
    };
    let id = exec_state.next_uuid();
    args.batch_modeling_cmd(id, tan_arc_to(&sketch, &delta)).await?;

    let current_path = Path::TangentialArcTo {
        base: BasePath {
            from: from.into(),
            to,
            tag: tag.clone(),
            units: sketch.units,
            geo_meta: GeoMeta {
                id,
                metadata: args.source_range.into(),
            },
        },
        center: result.center,
        ccw: result.ccw > 0,
    };

    let mut new_sketch = sketch.clone();
    if let Some(tag) = &tag {
        new_sketch.add_tag(tag, &current_path, exec_state);
    }

    new_sketch.paths.push(current_path);

    Ok(new_sketch)
}

/// Data to draw a bezier curve.
#[derive(Debug, Clone, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct BezierData {
    /// The to point.
    pub to: [TyF64; 2],
    /// The first control point.
    pub control1: [TyF64; 2],
    /// The second control point.
    pub control2: [TyF64; 2],
}

/// Draw a bezier curve.
pub async fn bezier_curve(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let (data, sketch, tag): (BezierData, Sketch, Option<TagNode>) = args.get_data_and_sketch_and_tag(exec_state)?;

    let new_sketch = inner_bezier_curve(data, sketch, tag, exec_state, args).await?;
    Ok(KclValue::Sketch {
        value: Box::new(new_sketch),
    })
}

/// Draw a smooth, continuous, curved line segment from the current origin to
/// the desired (x, y), using a number of control points to shape the curve's
/// shape.
///
/// ```no_run
/// exampleSketch = startSketchOn(XZ)
///   |> startProfileAt([0, 0], %)
///   |> line(end = [0, 10])
///   |> bezierCurve({
///        to = [10, 10],
///        control1 = [5, 0],
///        control2 = [5, 10]
///      }, %)
///   |> line(endAbsolute = [10, 0])
///   |> close()
///
/// example = extrude(exampleSketch, length = 10)
/// ```
#[stdlib {
    name = "bezierCurve",
}]
async fn inner_bezier_curve(
    data: BezierData,
    sketch: Sketch,
    tag: Option<TagNode>,
    exec_state: &mut ExecState,
    args: Args,
) -> Result<Sketch, KclError> {
    let from = sketch.current_pen_position()?;

    let relative = true;
    let delta = data.to.clone();
    let to = [from.x + data.to[0].n, from.y + data.to[1].n];

    let id = exec_state.next_uuid();

    args.batch_modeling_cmd(
        id,
        ModelingCmd::from(mcmd::ExtendPath {
            path: sketch.id.into(),
            segment: PathSegment::Bezier {
                control1: KPoint2d::from(untype_point(data.control1).0)
                    .with_z(0.0)
                    .map(LengthUnit),
                control2: KPoint2d::from(untype_point(data.control2).0)
                    .with_z(0.0)
                    .map(LengthUnit),
                end: KPoint2d::from(untype_point(delta).0).with_z(0.0).map(LengthUnit),
                relative,
            },
        }),
    )
    .await?;

    let current_path = Path::ToPoint {
        base: BasePath {
            from: from.into(),
            to,
            tag: tag.clone(),
            units: sketch.units,
            geo_meta: GeoMeta {
                id,
                metadata: args.source_range.into(),
            },
        },
    };

    let mut new_sketch = sketch.clone();
    if let Some(tag) = &tag {
        new_sketch.add_tag(tag, &current_path, exec_state);
    }

    new_sketch.paths.push(current_path);

    Ok(new_sketch)
}

/// Use a sketch to cut a hole in another sketch.
pub async fn hole(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let (hole_sketch, sketch): (Vec<Sketch>, Sketch) = args.get_sketches(exec_state)?;

    let new_sketch = inner_hole(hole_sketch, sketch, exec_state, args).await?;
    Ok(KclValue::Sketch {
        value: Box::new(new_sketch),
    })
}

/// Use a 2-dimensional sketch to cut a hole in another 2-dimensional sketch.
///
/// ```no_run
/// exampleSketch = startSketchOn(XY)
///   |> startProfileAt([0, 0], %)
///   |> line(end = [0, 5])
///   |> line(end = [5, 0])
///   |> line(end = [0, -5])
///   |> close()
///   |> hole(circle( center = [1, 1], radius = .25 ), %)
///   |> hole(circle( center = [1, 4], radius = .25 ), %)
///
/// example = extrude(exampleSketch, length = 1)
/// ```
///
/// ```no_run
/// fn squareHoleSketch() {
///   squareSketch = startSketchOn(-XZ)
///     |> startProfileAt([-1, -1], %)
///     |> line(end = [2, 0])
///     |> line(end = [0, 2])
///     |> line(end = [-2, 0])
///     |> close()
///   return squareSketch
/// }
///
/// exampleSketch = startSketchOn(-XZ)
///     |> circle( center = [0, 0], radius = 3 )
///     |> hole(squareHoleSketch(), %)
/// example = extrude(exampleSketch, length = 1)
/// ```
#[stdlib {
    name = "hole",
    feature_tree_operation = true,
}]
async fn inner_hole(
    hole_sketch: Vec<Sketch>,
    sketch: Sketch,
    exec_state: &mut ExecState,
    args: Args,
) -> Result<Sketch, KclError> {
    for hole_sketch in hole_sketch {
        args.batch_modeling_cmd(
            exec_state.next_uuid(),
            ModelingCmd::from(mcmd::Solid2dAddHole {
                object_id: sketch.id,
                hole_id: hole_sketch.id,
            }),
        )
        .await?;

        // suggestion (mike)
        // we also hide the source hole since its essentially "consumed" by this operation
        args.batch_modeling_cmd(
            exec_state.next_uuid(),
            ModelingCmd::from(mcmd::ObjectVisible {
                object_id: hole_sketch.id,
                hidden: true,
            }),
        )
        .await?;
    }

    Ok(sketch)
}

#[cfg(test)]
mod tests {

    use pretty_assertions::assert_eq;

    use crate::{
        execution::TagIdentifier,
        std::{sketch::PlaneData, utils::calculate_circle_center},
    };

    #[test]
    fn test_deserialize_plane_data() {
        let data = PlaneData::XY;
        let mut str_json = serde_json::to_string(&data).unwrap();
        assert_eq!(str_json, "\"XY\"");

        str_json = "\"YZ\"".to_string();
        let data: PlaneData = serde_json::from_str(&str_json).unwrap();
        assert_eq!(data, PlaneData::YZ);

        str_json = "\"-YZ\"".to_string();
        let data: PlaneData = serde_json::from_str(&str_json).unwrap();
        assert_eq!(data, PlaneData::NegYZ);

        str_json = "\"-xz\"".to_string();
        let data: PlaneData = serde_json::from_str(&str_json).unwrap();
        assert_eq!(data, PlaneData::NegXZ);
    }

    #[test]
    fn test_deserialize_sketch_on_face_tag() {
        let data = "start";
        let mut str_json = serde_json::to_string(&data).unwrap();
        assert_eq!(str_json, "\"start\"");

        str_json = "\"end\"".to_string();
        let data: crate::std::sketch::FaceTag = serde_json::from_str(&str_json).unwrap();
        assert_eq!(
            data,
            crate::std::sketch::FaceTag::StartOrEnd(crate::std::sketch::StartOrEnd::End)
        );

        str_json = serde_json::to_string(&TagIdentifier {
            value: "thing".to_string(),
            info: Vec::new(),
            meta: Default::default(),
        })
        .unwrap();
        let data: crate::std::sketch::FaceTag = serde_json::from_str(&str_json).unwrap();
        assert_eq!(
            data,
            crate::std::sketch::FaceTag::Tag(Box::new(TagIdentifier {
                value: "thing".to_string(),
                info: Vec::new(),
                meta: Default::default()
            }))
        );

        str_json = "\"END\"".to_string();
        let data: crate::std::sketch::FaceTag = serde_json::from_str(&str_json).unwrap();
        assert_eq!(
            data,
            crate::std::sketch::FaceTag::StartOrEnd(crate::std::sketch::StartOrEnd::End)
        );

        str_json = "\"start\"".to_string();
        let data: crate::std::sketch::FaceTag = serde_json::from_str(&str_json).unwrap();
        assert_eq!(
            data,
            crate::std::sketch::FaceTag::StartOrEnd(crate::std::sketch::StartOrEnd::Start)
        );

        str_json = "\"START\"".to_string();
        let data: crate::std::sketch::FaceTag = serde_json::from_str(&str_json).unwrap();
        assert_eq!(
            data,
            crate::std::sketch::FaceTag::StartOrEnd(crate::std::sketch::StartOrEnd::Start)
        );
    }

    #[test]
    fn test_circle_center() {
        let actual = calculate_circle_center([0.0, 0.0], [5.0, 5.0], [10.0, 0.0]);
        assert_eq!(actual[0], 5.0);
        assert_eq!(actual[1], 0.0);
    }
}
