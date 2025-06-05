//! Functions related to sketching.

use anyhow::Result;
use indexmap::IndexMap;
use kcmc::shared::Point2d as KPoint2d; // Point2d is already defined in this pkg, to impl ts_rs traits.
use kcmc::shared::Point3d as KPoint3d; // Point3d is already defined in this pkg, to impl ts_rs traits.
use kcmc::{each_cmd as mcmd, length_unit::LengthUnit, shared::Angle, websocket::ModelingCmdReq, ModelingCmd};
use kittycad_modeling_cmds as kcmc;
use kittycad_modeling_cmds::shared::PathSegment;
use parse_display::{Display, FromStr};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use super::shapes::get_radius;
#[cfg(feature = "artifact-graph")]
use crate::execution::{Artifact, ArtifactId, CodeRef, StartSketchOnFace, StartSketchOnPlane};
use crate::{
    errors::{KclError, KclErrorDetails},
    execution::{
        types::{ArrayLen, NumericType, PrimitiveType, RuntimeType, UnitLen},
        BasePath, ExecState, Face, GeoMeta, KclValue, Path, Plane, PlaneInfo, Point2d, Sketch, SketchSurface, Solid,
        TagEngineInfo, TagIdentifier,
    },
    parsing::ast::types::TagNode,
    std::{
        args::{Args, TyF64},
        utils::{
            arc_center_and_end, get_tangential_arc_to_info, get_x_component, get_y_component,
            intersection_with_parallel_line, point_to_len_unit, point_to_mm, untyped_point_to_mm,
            TangentialArcInfoInput,
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
                KclError::new_type(KclErrorDetails::new(
                    "Expected a start face".to_string(),
                    vec![args.source_range],
                ))
            }),
            FaceTag::StartOrEnd(StartOrEnd::End) => solid.end_cap_id.ok_or_else(|| {
                KclError::new_type(KclErrorDetails::new(
                    "Expected an end face".to_string(),
                    vec![args.source_range],
                ))
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
    let sketch = args.get_unlabeled_kw_arg_typed("sketch", &RuntimeType::sketch(), exec_state)?;

    let start_radius: TyF64 = args.get_kw_arg_typed("startRadius", &RuntimeType::length(), exec_state)?;
    let end_radius: TyF64 = args.get_kw_arg_typed("endRadius", &RuntimeType::length(), exec_state)?;
    let angle: TyF64 = args.get_kw_arg_typed("angle", &RuntimeType::angle(), exec_state)?;
    let reverse = args.get_kw_arg_opt_typed("reverse", &RuntimeType::bool(), exec_state)?;
    let tag = args.get_kw_arg_opt(NEW_TAG_KW)?;
    let new_sketch =
        inner_involute_circular(sketch, start_radius, end_radius, angle, reverse, tag, exec_state, args).await?;
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

#[allow(clippy::too_many_arguments)]
async fn inner_involute_circular(
    sketch: Sketch,
    start_radius: TyF64,
    end_radius: TyF64,
    angle: TyF64,
    reverse: Option<bool>,
    tag: Option<TagNode>,
    exec_state: &mut ExecState,
    args: Args,
) -> Result<Sketch, KclError> {
    let id = exec_state.next_uuid();

    args.batch_modeling_cmd(
        id,
        ModelingCmd::from(mcmd::ExtendPath {
            path: sketch.id.into(),
            segment: PathSegment::CircularInvolute {
                start_radius: LengthUnit(start_radius.to_mm()),
                end_radius: LengthUnit(end_radius.to_mm()),
                angle: Angle::from_degrees(angle.to_degrees()),
                reverse: reverse.unwrap_or_default(),
            },
        }),
    )
    .await?;

    let from = sketch.current_pen_position()?;

    let start_radius = start_radius.to_length_units(from.units);
    let end_radius = end_radius.to_length_units(from.units);

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

    let current_path = Path::ToPoint {
        base: BasePath {
            from: from.ignore_units(),
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

    let new_sketch = inner_line(sketch, end_absolute, end, tag, exec_state, args).await?;
    Ok(KclValue::Sketch {
        value: Box::new(new_sketch),
    })
}

async fn inner_line(
    sketch: Sketch,
    end_absolute: Option<[TyF64; 2]>,
    end: Option<[TyF64; 2]>,
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
            relative_name: "end",
        },
        exec_state,
        args,
    )
    .await
}

struct StraightLineParams {
    sketch: Sketch,
    end_absolute: Option<[TyF64; 2]>,
    end: Option<[TyF64; 2]>,
    tag: Option<TagNode>,
    relative_name: &'static str,
}

impl StraightLineParams {
    fn relative(p: [TyF64; 2], sketch: Sketch, tag: Option<TagNode>) -> Self {
        Self {
            sketch,
            tag,
            end: Some(p),
            end_absolute: None,
            relative_name: "end",
        }
    }
    fn absolute(p: [TyF64; 2], sketch: Sketch, tag: Option<TagNode>) -> Self {
        Self {
            sketch,
            tag,
            end: None,
            end_absolute: Some(p),
            relative_name: "end",
        }
    }
}

async fn straight_line(
    StraightLineParams {
        sketch,
        end,
        end_absolute,
        tag,
        relative_name,
    }: StraightLineParams,
    exec_state: &mut ExecState,
    args: Args,
) -> Result<Sketch, KclError> {
    let from = sketch.current_pen_position()?;
    let (point, is_absolute) = match (end_absolute, end) {
        (Some(_), Some(_)) => {
            return Err(KclError::new_semantic(KclErrorDetails::new(
                "You cannot give both `end` and `endAbsolute` params, you have to choose one or the other".to_owned(),
                vec![args.source_range],
            )));
        }
        (Some(end_absolute), None) => (end_absolute, true),
        (None, Some(end)) => (end, false),
        (None, None) => {
            return Err(KclError::new_semantic(KclErrorDetails::new(
                format!("You must supply either `{relative_name}` or `endAbsolute` arguments"),
                vec![args.source_range],
            )));
        }
    };

    let id = exec_state.next_uuid();
    args.batch_modeling_cmd(
        id,
        ModelingCmd::from(mcmd::ExtendPath {
            path: sketch.id.into(),
            segment: PathSegment::Line {
                end: KPoint2d::from(point_to_mm(point.clone())).with_z(0.0).map(LengthUnit),
                relative: !is_absolute,
            },
        }),
    )
    .await?;

    let end = if is_absolute {
        point_to_len_unit(point, from.units)
    } else {
        let from = sketch.current_pen_position()?;
        let point = point_to_len_unit(point, from.units);
        [from.x + point[0], from.y + point[1]]
    };

    let current_path = Path::ToPoint {
        base: BasePath {
            from: from.ignore_units(),
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

    let new_sketch = inner_x_line(sketch, length, end_absolute, tag, exec_state, args).await?;
    Ok(KclValue::Sketch {
        value: Box::new(new_sketch),
    })
}

async fn inner_x_line(
    sketch: Sketch,
    length: Option<TyF64>,
    end_absolute: Option<TyF64>,
    tag: Option<TagNode>,
    exec_state: &mut ExecState,
    args: Args,
) -> Result<Sketch, KclError> {
    let from = sketch.current_pen_position()?;
    straight_line(
        StraightLineParams {
            sketch,
            end_absolute: end_absolute.map(|x| [x, from.into_y()]),
            end: length.map(|x| [x, TyF64::new(0.0, NumericType::mm())]),
            tag,
            relative_name: "length",
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

    let new_sketch = inner_y_line(sketch, length, end_absolute, tag, exec_state, args).await?;
    Ok(KclValue::Sketch {
        value: Box::new(new_sketch),
    })
}

async fn inner_y_line(
    sketch: Sketch,
    length: Option<TyF64>,
    end_absolute: Option<TyF64>,
    tag: Option<TagNode>,
    exec_state: &mut ExecState,
    args: Args,
) -> Result<Sketch, KclError> {
    let from = sketch.current_pen_position()?;
    straight_line(
        StraightLineParams {
            sketch,
            end_absolute: end_absolute.map(|y| [from.into_x(), y]),
            end: length.map(|y| [TyF64::new(0.0, NumericType::mm()), y]),
            tag,
            relative_name: "length",
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
        length,
        length_x,
        length_y,
        end_absolute_x,
        end_absolute_y,
        tag,
        exec_state,
        args,
    )
    .await?;
    Ok(KclValue::Sketch {
        value: Box::new(new_sketch),
    })
}

#[allow(clippy::too_many_arguments)]
async fn inner_angled_line(
    sketch: Sketch,
    angle: f64,
    length: Option<TyF64>,
    length_x: Option<TyF64>,
    length_y: Option<TyF64>,
    end_absolute_x: Option<TyF64>,
    end_absolute_y: Option<TyF64>,
    tag: Option<TagNode>,
    exec_state: &mut ExecState,
    args: Args,
) -> Result<Sketch, KclError> {
    let options_given = [&length, &length_x, &length_y, &end_absolute_x, &end_absolute_y]
        .iter()
        .filter(|x| x.is_some())
        .count();
    if options_given > 1 {
        return Err(KclError::new_type(KclErrorDetails::new(
            " one of `length`, `lengthX`, `lengthY`, `endAbsoluteX`, `endAbsoluteY` can be given".to_string(),
            vec![args.source_range],
        )));
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
        (None, None, None, None, None) => Err(KclError::new_type(KclErrorDetails::new(
            "One of `length`, `lengthX`, `lengthY`, `endAbsoluteX`, `endAbsoluteY` must be given".to_string(),
            vec![args.source_range],
        ))),
        _ => Err(KclError::new_type(KclErrorDetails::new(
            "Only One of `length`, `lengthX`, `lengthY`, `endAbsoluteX`, `endAbsoluteY` can be given".to_owned(),
            vec![args.source_range],
        ))),
    }
}

async fn inner_angled_line_length(
    sketch: Sketch,
    angle_degrees: f64,
    length: TyF64,
    tag: Option<TagNode>,
    exec_state: &mut ExecState,
    args: Args,
) -> Result<Sketch, KclError> {
    let from = sketch.current_pen_position()?;
    let length = length.to_length_units(from.units);

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
                end: KPoint2d::from(untyped_point_to_mm(delta, from.units))
                    .with_z(0.0)
                    .map(LengthUnit),
                relative,
            },
        }),
    )
    .await?;

    let current_path = Path::ToPoint {
        base: BasePath {
            from: from.ignore_units(),
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
    length: TyF64,
    sketch: Sketch,
    tag: Option<TagNode>,
    exec_state: &mut ExecState,
    args: Args,
) -> Result<Sketch, KclError> {
    if angle_degrees.abs() == 270.0 {
        return Err(KclError::new_type(KclErrorDetails::new(
            "Cannot have an x constrained angle of 270 degrees".to_string(),
            vec![args.source_range],
        )));
    }

    if angle_degrees.abs() == 90.0 {
        return Err(KclError::new_type(KclErrorDetails::new(
            "Cannot have an x constrained angle of 90 degrees".to_string(),
            vec![args.source_range],
        )));
    }

    let to = get_y_component(Angle::from_degrees(angle_degrees), length.n);
    let to = [TyF64::new(to[0], length.ty.clone()), TyF64::new(to[1], length.ty)];

    let new_sketch = straight_line(StraightLineParams::relative(to, sketch, tag), exec_state, args).await?;

    Ok(new_sketch)
}

async fn inner_angled_line_to_x(
    angle_degrees: f64,
    x_to: TyF64,
    sketch: Sketch,
    tag: Option<TagNode>,
    exec_state: &mut ExecState,
    args: Args,
) -> Result<Sketch, KclError> {
    let from = sketch.current_pen_position()?;

    if angle_degrees.abs() == 270.0 {
        return Err(KclError::new_type(KclErrorDetails::new(
            "Cannot have an x constrained angle of 270 degrees".to_string(),
            vec![args.source_range],
        )));
    }

    if angle_degrees.abs() == 90.0 {
        return Err(KclError::new_type(KclErrorDetails::new(
            "Cannot have an x constrained angle of 90 degrees".to_string(),
            vec![args.source_range],
        )));
    }

    let x_component = x_to.to_length_units(from.units) - from.x;
    let y_component = x_component * f64::tan(angle_degrees.to_radians());
    let y_to = from.y + y_component;

    let new_sketch = straight_line(
        StraightLineParams::absolute([x_to, TyF64::new(y_to, from.units.into())], sketch, tag),
        exec_state,
        args,
    )
    .await?;
    Ok(new_sketch)
}

async fn inner_angled_line_of_y_length(
    angle_degrees: f64,
    length: TyF64,
    sketch: Sketch,
    tag: Option<TagNode>,
    exec_state: &mut ExecState,
    args: Args,
) -> Result<Sketch, KclError> {
    if angle_degrees.abs() == 0.0 {
        return Err(KclError::new_type(KclErrorDetails::new(
            "Cannot have a y constrained angle of 0 degrees".to_string(),
            vec![args.source_range],
        )));
    }

    if angle_degrees.abs() == 180.0 {
        return Err(KclError::new_type(KclErrorDetails::new(
            "Cannot have a y constrained angle of 180 degrees".to_string(),
            vec![args.source_range],
        )));
    }

    let to = get_x_component(Angle::from_degrees(angle_degrees), length.n);
    let to = [TyF64::new(to[0], length.ty.clone()), TyF64::new(to[1], length.ty)];

    let new_sketch = straight_line(StraightLineParams::relative(to, sketch, tag), exec_state, args).await?;

    Ok(new_sketch)
}

async fn inner_angled_line_to_y(
    angle_degrees: f64,
    y_to: TyF64,
    sketch: Sketch,
    tag: Option<TagNode>,
    exec_state: &mut ExecState,
    args: Args,
) -> Result<Sketch, KclError> {
    let from = sketch.current_pen_position()?;

    if angle_degrees.abs() == 0.0 {
        return Err(KclError::new_type(KclErrorDetails::new(
            "Cannot have a y constrained angle of 0 degrees".to_string(),
            vec![args.source_range],
        )));
    }

    if angle_degrees.abs() == 180.0 {
        return Err(KclError::new_type(KclErrorDetails::new(
            "Cannot have a y constrained angle of 180 degrees".to_string(),
            vec![args.source_range],
        )));
    }

    let y_component = y_to.to_length_units(from.units) - from.y;
    let x_component = y_component / f64::tan(angle_degrees.to_radians());
    let x_to = from.x + x_component;

    let new_sketch = straight_line(
        StraightLineParams::absolute([TyF64::new(x_to, from.units.into()), y_to], sketch, tag),
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
    let angle: TyF64 = args.get_kw_arg_typed("angle", &RuntimeType::angle(), exec_state)?;
    let intersect_tag: TagIdentifier =
        args.get_kw_arg_typed("intersectTag", &RuntimeType::tag_identifier(), exec_state)?;
    let offset = args.get_kw_arg_opt_typed("offset", &RuntimeType::length(), exec_state)?;
    let tag: Option<TagNode> = args.get_kw_arg_opt("tag")?;
    let new_sketch =
        inner_angled_line_that_intersects(sketch, angle, intersect_tag, offset, tag, exec_state, args).await?;
    Ok(KclValue::Sketch {
        value: Box::new(new_sketch),
    })
}

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
        KclError::new_type(KclErrorDetails::new(
            format!("Expected an intersect path with a path, found `{:?}`", intersect_path),
            vec![args.source_range],
        ))
    })?;

    let from = sketch.current_pen_position()?;
    let to = intersection_with_parallel_line(
        &[
            point_to_len_unit(path.get_from(), from.units),
            point_to_len_unit(path.get_to(), from.units),
        ],
        offset.map(|t| t.to_length_units(from.units)).unwrap_or_default(),
        angle.to_degrees(),
        from.ignore_units(),
    );
    let to = [
        TyF64::new(to[0], from.units.into()),
        TyF64::new(to[1], from.units.into()),
    ];

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
    Plane(PlaneInfo),
}

/// Start a sketch on a specific plane or face.
pub async fn start_sketch_on(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let data = args.get_unlabeled_kw_arg_typed(
        "planeOrSolid",
        &RuntimeType::Union(vec![RuntimeType::solid(), RuntimeType::plane()]),
        exec_state,
    )?;
    let face = args.get_kw_arg_opt_typed("face", &RuntimeType::tag(), exec_state)?;

    match inner_start_sketch_on(data, face, exec_state, &args).await? {
        SketchSurface::Plane(value) => Ok(KclValue::Plane { value }),
        SketchSurface::Face(value) => Ok(KclValue::Face { value }),
    }
}

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
                if plane.info.origin.units == UnitLen::Unknown {
                    return Err(KclError::new_semantic(KclErrorDetails::new(
                        "Origin of plane has unknown units".to_string(),
                        vec![args.source_range],
                    )));
                }
                let plane = make_sketch_plane_from_orientation(plane.info.into_plane_data(), exec_state, args).await?;
                Ok(SketchSurface::Plane(plane))
            } else {
                // Create artifact used only by the UI, not the engine.
                #[cfg(feature = "artifact-graph")]
                {
                    let id = exec_state.next_uuid();
                    exec_state.add_artifact(Artifact::StartSketchOnPlane(StartSketchOnPlane {
                        id: ArtifactId::from(id),
                        plane_id: plane.artifact_id,
                        code_ref: CodeRef::placeholder(args.source_range),
                    }));
                }

                Ok(SketchSurface::Plane(plane))
            }
        }
        SketchData::Solid(solid) => {
            let Some(tag) = face else {
                return Err(KclError::new_type(KclErrorDetails::new(
                    "Expected a tag for the face to sketch on".to_string(),
                    vec![args.source_range],
                )));
            };
            let face = start_sketch_on_face(solid, tag, exec_state, args).await?;

            #[cfg(feature = "artifact-graph")]
            {
                // Create artifact used only by the UI, not the engine.
                let id = exec_state.next_uuid();
                exec_state.add_artifact(Artifact::StartSketchOnFace(StartSketchOnFace {
                    id: ArtifactId::from(id),
                    face_id: face.artifact_id,
                    code_ref: CodeRef::placeholder(args.source_range),
                }));
            }

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
    let plane = Plane::from_plane_data(data.clone(), exec_state)?;

    // Create the plane on the fly.
    let clobber = false;
    let size = LengthUnit(60.0);
    let hide = Some(true);
    args.batch_modeling_cmd(
        plane.id,
        ModelingCmd::from(mcmd::MakePlane {
            clobber,
            origin: plane.info.origin.into(),
            size,
            x_axis: plane.info.x_axis.into(),
            y_axis: plane.info.y_axis.into(),
            hide,
        }),
    )
    .await?;

    Ok(Box::new(plane))
}

/// Start a new profile at a given point.
pub async fn start_profile(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let sketch_surface = args.get_unlabeled_kw_arg_typed(
        "startProfileOn",
        &RuntimeType::Union(vec![RuntimeType::plane(), RuntimeType::face()]),
        exec_state,
    )?;
    let start: [TyF64; 2] = args.get_kw_arg_typed("at", &RuntimeType::point2d(), exec_state)?;
    let tag = args.get_kw_arg_opt(NEW_TAG_KW)?;

    let sketch = inner_start_profile(sketch_surface, start, tag, exec_state, args).await?;
    Ok(KclValue::Sketch {
        value: Box::new(sketch),
    })
}

pub(crate) async fn inner_start_profile(
    sketch_surface: SketchSurface,
    at: [TyF64; 2],
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
                    let normal = plane.info.x_axis.axes_cross_product(&plane.info.y_axis);
                    Some(normal.into())
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
                to: KPoint2d::from(point_to_mm(at.clone())).with_z(0.0).map(LengthUnit),
            }),
            cmd_id: move_pen_id.into(),
        },
        ModelingCmdReq {
            cmd: ModelingCmd::SketchModeDisable(mcmd::SketchModeDisable::default()),
            cmd_id: exec_state.next_uuid().into(),
        },
    ])
    .await?;

    // Convert to the units of the module.  This is what the frontend expects.
    let units = exec_state.length_unit();
    let to = point_to_len_unit(at, units);
    let current_path = BasePath {
        from: to,
        to,
        tag: tag.clone(),
        units,
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
        units,
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
    let sketch: Sketch = args.get_unlabeled_kw_arg_typed("profile", &RuntimeType::sketch(), exec_state)?;
    let ty = sketch.units.into();
    let x = inner_profile_start_x(sketch)?;
    Ok(args.make_user_val_from_f64_with_type(TyF64::new(x, ty)))
}

pub(crate) fn inner_profile_start_x(profile: Sketch) -> Result<f64, KclError> {
    Ok(profile.start.to[0])
}

/// Returns the Y component of the sketch profile start point.
pub async fn profile_start_y(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let sketch: Sketch = args.get_unlabeled_kw_arg_typed("profile", &RuntimeType::sketch(), exec_state)?;
    let ty = sketch.units.into();
    let x = inner_profile_start_y(sketch)?;
    Ok(args.make_user_val_from_f64_with_type(TyF64::new(x, ty)))
}

pub(crate) fn inner_profile_start_y(profile: Sketch) -> Result<f64, KclError> {
    Ok(profile.start.to[1])
}

/// Returns the sketch profile start point.
pub async fn profile_start(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let sketch: Sketch = args.get_unlabeled_kw_arg_typed("profile", &RuntimeType::sketch(), exec_state)?;
    let ty = sketch.units.into();
    let point = inner_profile_start(sketch)?;
    Ok(KclValue::from_point2d(point, ty, args.into()))
}

pub(crate) fn inner_profile_start(profile: Sketch) -> Result<[f64; 2], KclError> {
    Ok(profile.start.to)
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

pub(crate) async fn inner_close(
    sketch: Sketch,
    tag: Option<TagNode>,
    exec_state: &mut ExecState,
    args: Args,
) -> Result<Sketch, KclError> {
    let from = sketch.current_pen_position()?;
    let to = point_to_len_unit(sketch.start.get_from(), from.units);

    let id = exec_state.next_uuid();

    args.batch_modeling_cmd(id, ModelingCmd::from(mcmd::ClosePath { path_id: sketch.id }))
        .await?;

    let current_path = Path::ToPoint {
        base: BasePath {
            from: from.ignore_units(),
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

/// Draw an arc.
pub async fn arc(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let sketch =
        args.get_unlabeled_kw_arg_typed("sketch", &RuntimeType::Primitive(PrimitiveType::Sketch), exec_state)?;

    let angle_start: Option<TyF64> = args.get_kw_arg_opt_typed("angleStart", &RuntimeType::degrees(), exec_state)?;
    let angle_end: Option<TyF64> = args.get_kw_arg_opt_typed("angleEnd", &RuntimeType::degrees(), exec_state)?;
    let radius: Option<TyF64> = args.get_kw_arg_opt_typed("radius", &RuntimeType::length(), exec_state)?;
    let diameter: Option<TyF64> = args.get_kw_arg_opt_typed("diameter", &RuntimeType::length(), exec_state)?;
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
        diameter,
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

#[allow(clippy::too_many_arguments)]
pub(crate) async fn inner_arc(
    sketch: Sketch,
    angle_start: Option<TyF64>,
    angle_end: Option<TyF64>,
    radius: Option<TyF64>,
    diameter: Option<TyF64>,
    interior_absolute: Option<[TyF64; 2]>,
    end_absolute: Option<[TyF64; 2]>,
    tag: Option<TagNode>,
    exec_state: &mut ExecState,
    args: Args,
) -> Result<Sketch, KclError> {
    let from: Point2d = sketch.current_pen_position()?;
    let id = exec_state.next_uuid();

    match (angle_start, angle_end, radius, diameter, interior_absolute, end_absolute) {
        (Some(angle_start), Some(angle_end), radius, diameter, None, None) => {
            let radius = get_radius(radius, diameter, args.source_range)?;
            relative_arc(&args, id, exec_state, sketch, from, angle_start, angle_end, radius, tag).await
        }
        (None, None, None, None, Some(interior_absolute), Some(end_absolute)) => {
            absolute_arc(&args, id, exec_state, sketch, from, interior_absolute, end_absolute, tag).await
        }
        _ => {
            Err(KclError::new_type(KclErrorDetails::new(
                "Invalid combination of arguments. Either provide (angleStart, angleEnd, radius) or (endAbsolute, interiorAbsolute)".to_owned(),
                vec![args.source_range],
            )))
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
                    x: LengthUnit(end_absolute[0].to_mm()),
                    y: LengthUnit(end_absolute[1].to_mm()),
                    z: LengthUnit(0.0),
                },
                interior: kcmc::shared::Point3d {
                    x: LengthUnit(interior_absolute[0].to_mm()),
                    y: LengthUnit(interior_absolute[1].to_mm()),
                    z: LengthUnit(0.0),
                },
                relative: false,
            },
        }),
    )
    .await?;

    let start = [from.x, from.y];
    let end = point_to_len_unit(end_absolute, from.units);

    let current_path = Path::ArcThreePoint {
        base: BasePath {
            from: from.ignore_units(),
            to: end,
            tag: tag.clone(),
            units: sketch.units,
            geo_meta: GeoMeta {
                id,
                metadata: args.source_range.into(),
            },
        },
        p1: start,
        p2: point_to_len_unit(interior_absolute, from.units),
        p3: end,
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
    let a_start = Angle::from_degrees(angle_start.to_degrees());
    let a_end = Angle::from_degrees(angle_end.to_degrees());
    let radius = radius.to_length_units(from.units);
    let (center, end) = arc_center_and_end(from.ignore_units(), a_start, a_end, radius);
    if a_start == a_end {
        return Err(KclError::new_type(KclErrorDetails::new(
            "Arc start and end angles must be different".to_string(),
            vec![args.source_range],
        )));
    }
    let ccw = a_start < a_end;

    args.batch_modeling_cmd(
        id,
        ModelingCmd::from(mcmd::ExtendPath {
            path: sketch.id.into(),
            segment: PathSegment::Arc {
                start: a_start,
                end: a_end,
                center: KPoint2d::from(untyped_point_to_mm(center, from.units)).map(LengthUnit),
                radius: LengthUnit(from.units.adjust_to(radius, UnitLen::Mm).0),
                relative: false,
            },
        }),
    )
    .await?;

    let current_path = Path::Arc {
        base: BasePath {
            from: from.ignore_units(),
            to: end,
            tag: tag.clone(),
            units: from.units,
            geo_meta: GeoMeta {
                id,
                metadata: args.source_range.into(),
            },
        },
        center,
        radius,
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
    let diameter = args.get_kw_arg_opt_typed("diameter", &RuntimeType::length(), exec_state)?;
    let angle = args.get_kw_arg_opt_typed("angle", &RuntimeType::angle(), exec_state)?;
    let tag = args.get_kw_arg_opt(NEW_TAG_KW)?;

    let new_sketch = inner_tangential_arc(
        sketch,
        end_absolute,
        end,
        radius,
        diameter,
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

#[allow(clippy::too_many_arguments)]
async fn inner_tangential_arc(
    sketch: Sketch,
    end_absolute: Option<[TyF64; 2]>,
    end: Option<[TyF64; 2]>,
    radius: Option<TyF64>,
    diameter: Option<TyF64>,
    angle: Option<TyF64>,
    tag: Option<TagNode>,
    exec_state: &mut ExecState,
    args: Args,
) -> Result<Sketch, KclError> {
    match (end_absolute, end, radius, diameter, angle) {
        (Some(point), None, None, None, None) => {
            inner_tangential_arc_to_point(sketch, point, true, tag, exec_state, args).await
        }
        (None, Some(point), None, None, None) => {
            inner_tangential_arc_to_point(sketch, point, false, tag, exec_state, args).await
        }
        (None, None, radius, diameter, Some(angle)) => {
            let radius = get_radius(radius, diameter, args.source_range)?;
            let data = TangentialArcData::RadiusAndOffset { radius, offset: angle };
            inner_tangential_arc_radius_angle(data, sketch, tag, exec_state, args).await
        }
        (Some(_), Some(_), None, None, None) => Err(KclError::new_semantic(KclErrorDetails::new(
            "You cannot give both `end` and `endAbsolute` params, you have to choose one or the other".to_owned(),
            vec![args.source_range],
        ))),
        (_, _, _, _, _) => Err(KclError::new_semantic(KclErrorDetails::new(
            "You must supply `end`, `endAbsolute`, or both `angle` and `radius`/`diameter` arguments".to_owned(),
            vec![args.source_range],
        ))),
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
    let tan_previous_point = tangent_info.tan_previous_point(from.ignore_units());

    let id = exec_state.next_uuid();

    let (center, to, ccw) = match data {
        TangentialArcData::RadiusAndOffset { radius, offset } => {
            // KCL stdlib types use degrees.
            let offset = Angle::from_degrees(offset.to_degrees());

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
            let (center, to) = arc_center_and_end(
                from.ignore_units(),
                start_angle,
                end_angle,
                radius.to_length_units(from.units),
            );

            args.batch_modeling_cmd(
                id,
                ModelingCmd::from(mcmd::ExtendPath {
                    path: sketch.id.into(),
                    segment: PathSegment::TangentialArc {
                        radius: LengthUnit(radius.to_mm()),
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
            from: from.ignore_units(),
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

// `to` must be in sketch.units
fn tan_arc_to(sketch: &Sketch, to: [f64; 2]) -> ModelingCmd {
    ModelingCmd::from(mcmd::ExtendPath {
        path: sketch.id.into(),
        segment: PathSegment::TangentialArcTo {
            angle_snap_increment: None,
            to: KPoint2d::from(untyped_point_to_mm(to, sketch.units))
                .with_z(0.0)
                .map(LengthUnit),
        },
    })
}

async fn inner_tangential_arc_to_point(
    sketch: Sketch,
    point: [TyF64; 2],
    is_absolute: bool,
    tag: Option<TagNode>,
    exec_state: &mut ExecState,
    args: Args,
) -> Result<Sketch, KclError> {
    let from: Point2d = sketch.current_pen_position()?;
    let tangent_info = sketch.get_tangential_info_from_paths();
    let tan_previous_point = tangent_info.tan_previous_point(from.ignore_units());

    let point = point_to_len_unit(point, from.units);

    let to = if is_absolute {
        point
    } else {
        [from.x + point[0], from.y + point[1]]
    };
    let [to_x, to_y] = to;
    let result = get_tangential_arc_to_info(TangentialArcInfoInput {
        arc_start_point: [from.x, from.y],
        arc_end_point: [to_x, to_y],
        tan_previous_point,
        obtuse: true,
    });

    if result.center[0].is_infinite() {
        return Err(KclError::new_semantic(KclErrorDetails::new(
            "could not sketch tangential arc, because its center would be infinitely far away in the X direction"
                .to_owned(),
            vec![args.source_range],
        )));
    } else if result.center[1].is_infinite() {
        return Err(KclError::new_semantic(KclErrorDetails::new(
            "could not sketch tangential arc, because its center would be infinitely far away in the Y direction"
                .to_owned(),
            vec![args.source_range],
        )));
    }

    let delta = if is_absolute {
        [to_x - from.x, to_y - from.y]
    } else {
        point
    };
    let id = exec_state.next_uuid();
    args.batch_modeling_cmd(id, tan_arc_to(&sketch, delta)).await?;

    let current_path = Path::TangentialArcTo {
        base: BasePath {
            from: from.ignore_units(),
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

/// Draw a bezier curve.
pub async fn bezier_curve(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let sketch =
        args.get_unlabeled_kw_arg_typed("sketch", &RuntimeType::Primitive(PrimitiveType::Sketch), exec_state)?;
    let control1 = args.get_kw_arg_opt_typed("control1", &RuntimeType::point2d(), exec_state)?;
    let control2 = args.get_kw_arg_opt_typed("control2", &RuntimeType::point2d(), exec_state)?;
    let end = args.get_kw_arg_opt_typed("end", &RuntimeType::point2d(), exec_state)?;
    let control1_absolute = args.get_kw_arg_opt_typed("control1Absolute", &RuntimeType::point2d(), exec_state)?;
    let control2_absolute = args.get_kw_arg_opt_typed("control2Absolute", &RuntimeType::point2d(), exec_state)?;
    let end_absolute = args.get_kw_arg_opt_typed("endAbsolute", &RuntimeType::point2d(), exec_state)?;
    let tag = args.get_kw_arg_opt("tag")?;

    let new_sketch = inner_bezier_curve(
        sketch,
        control1,
        control2,
        end,
        control1_absolute,
        control2_absolute,
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

#[allow(clippy::too_many_arguments)]
async fn inner_bezier_curve(
    sketch: Sketch,
    control1: Option<[TyF64; 2]>,
    control2: Option<[TyF64; 2]>,
    end: Option<[TyF64; 2]>,
    control1_absolute: Option<[TyF64; 2]>,
    control2_absolute: Option<[TyF64; 2]>,
    end_absolute: Option<[TyF64; 2]>,
    tag: Option<TagNode>,
    exec_state: &mut ExecState,
    args: Args,
) -> Result<Sketch, KclError> {
    let from = sketch.current_pen_position()?;
    let id = exec_state.next_uuid();

    let to = match (
        control1,
        control2,
        end,
        control1_absolute,
        control2_absolute,
        end_absolute,
    ) {
        // Relative
        (Some(control1), Some(control2), Some(end), None, None, None) => {
            let delta = end.clone();
            let to = [
                from.x + end[0].to_length_units(from.units),
                from.y + end[1].to_length_units(from.units),
            ];

            args.batch_modeling_cmd(
                id,
                ModelingCmd::from(mcmd::ExtendPath {
                    path: sketch.id.into(),
                    segment: PathSegment::Bezier {
                        control1: KPoint2d::from(point_to_mm(control1)).with_z(0.0).map(LengthUnit),
                        control2: KPoint2d::from(point_to_mm(control2)).with_z(0.0).map(LengthUnit),
                        end: KPoint2d::from(point_to_mm(delta)).with_z(0.0).map(LengthUnit),
                        relative: true,
                    },
                }),
            )
            .await?;
            to
        }
        // Absolute
        (None, None, None, Some(control1), Some(control2), Some(end)) => {
            let to = [end[0].to_length_units(from.units), end[1].to_length_units(from.units)];
            args.batch_modeling_cmd(
                id,
                ModelingCmd::from(mcmd::ExtendPath {
                    path: sketch.id.into(),
                    segment: PathSegment::Bezier {
                        control1: KPoint2d::from(point_to_mm(control1)).with_z(0.0).map(LengthUnit),
                        control2: KPoint2d::from(point_to_mm(control2)).with_z(0.0).map(LengthUnit),
                        end: KPoint2d::from(point_to_mm(end)).with_z(0.0).map(LengthUnit),
                        relative: false,
                    },
                }),
            )
            .await?;
            to
        }
        _ => {
            return Err(KclError::new_semantic(KclErrorDetails::new(
                "You must either give `control1`, `control2` and `end`, or `control1Absolute`, `control2Absolute` and `endAbsolute`.".to_owned(),
                vec![args.source_range],
            )));
        }
    };

    let current_path = Path::ToPoint {
        base: BasePath {
            from: from.ignore_units(),
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
pub async fn subtract_2d(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let sketch =
        args.get_unlabeled_kw_arg_typed("sketch", &RuntimeType::Primitive(PrimitiveType::Sketch), exec_state)?;

    let tool: Vec<Sketch> = args.get_kw_arg_typed(
        "tool",
        &RuntimeType::Array(
            Box::new(RuntimeType::Primitive(PrimitiveType::Sketch)),
            ArrayLen::Minimum(1),
        ),
        exec_state,
    )?;

    let new_sketch = inner_subtract_2d(sketch, tool, exec_state, args).await?;
    Ok(KclValue::Sketch {
        value: Box::new(new_sketch),
    })
}

async fn inner_subtract_2d(
    sketch: Sketch,
    tool: Vec<Sketch>,
    exec_state: &mut ExecState,
    args: Args,
) -> Result<Sketch, KclError> {
    for hole_sketch in tool {
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
