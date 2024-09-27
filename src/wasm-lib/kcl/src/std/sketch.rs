//! Functions related to sketching.

use std::collections::HashMap;

use anyhow::Result;
use derive_docs::stdlib;
use kcmc::shared::Point2d as KPoint2d; // Point2d is already defined in this pkg, to impl ts_rs traits.
use kcmc::{each_cmd as mcmd, length_unit::LengthUnit, shared::Angle, ModelingCmd};
use kittycad_modeling_cmds as kcmc;
use kittycad_modeling_cmds::shared::PathSegment;
use parse_display::{Display, FromStr};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::{
    ast::types::TagDeclarator,
    errors::{KclError, KclErrorDetails},
    executor::{
        BasePath, ExecState, Face, GeoMeta, KclValue, Path, Plane, PlaneType, Point2d, Point3d, Sketch, SketchSet,
        SketchSurface, Solid, TagEngineInfo, TagIdentifier, UserVal,
    },
    std::{
        utils::{
            arc_angles, arc_center_and_end, get_tangent_point_from_previous_arc, get_tangential_arc_to_info,
            get_x_component, get_y_component, intersection_with_parallel_line, TangentialArcInfoInput,
        },
        Args,
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

/// Draw a line to a point.
pub async fn line_to(_exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let (to, sketch, tag): ([f64; 2], Sketch, Option<TagDeclarator>) = args.get_data_and_sketch_and_tag()?;

    let new_sketch = inner_line_to(to, sketch, tag, args).await?;
    Ok(KclValue::new_user_val(new_sketch.meta.clone(), new_sketch))
}

/// Draw a line from the current origin to some absolute (x, y) point.
///
/// ```no_run
/// const exampleSketch = startSketchOn("XZ")
///   |> startProfileAt([0, 0], %)
///   |> lineTo([10, 0], %)
///   |> lineTo([0, 10], %)
///   |> lineTo([-10, 0], %)
///   |> close(%)
///
/// const example = extrude(5, exampleSketch)
/// ```
#[stdlib {
    name = "lineTo",
}]
async fn inner_line_to(
    to: [f64; 2],
    sketch: Sketch,
    tag: Option<TagDeclarator>,
    args: Args,
) -> Result<Sketch, KclError> {
    let from = sketch.current_pen_position()?;
    let id = uuid::Uuid::new_v4();

    args.batch_modeling_cmd(
        id,
        ModelingCmd::from(mcmd::ExtendPath {
            path: sketch.id.into(),
            segment: PathSegment::Line {
                end: KPoint2d::from(to).with_z(0.0).map(LengthUnit),
                relative: false,
            },
        }),
    )
    .await?;

    let current_path = Path::ToPoint {
        base: BasePath {
            from: from.into(),
            to,
            tag: tag.clone(),
            geo_meta: GeoMeta {
                id,
                metadata: args.source_range.into(),
            },
        },
    };

    let mut new_sketch = sketch.clone();
    if let Some(tag) = &tag {
        new_sketch.add_tag(tag, &current_path);
    }

    new_sketch.value.push(current_path);

    Ok(new_sketch)
}

/// Draw a line to a point on the x-axis.
pub async fn x_line_to(_exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let (to, sketch, tag): (f64, Sketch, Option<TagDeclarator>) = args.get_data_and_sketch_and_tag()?;

    let new_sketch = inner_x_line_to(to, sketch, tag, args).await?;
    Ok(KclValue::new_user_val(new_sketch.meta.clone(), new_sketch))
}

/// Draw a line parallel to the X axis, that ends at the given X.
/// E.g. if the previous line ended at (1, 1),
/// then xLineTo(4) draws a line from (1, 1) to (4, 1)
///
/// ```no_run
/// const exampleSketch = startSketchOn('XZ')
///   |> startProfileAt([0, 0], %)
///   |> xLineTo(15, %)
///   |> angledLine({
///     angle: 80,
///     length: 15,
///   }, %)
///   |> line([8, -10], %)
///   |> xLineTo(40, %)
///   |> angledLine({
///     angle: 135,
///     length: 30,
///   }, %)
///   |> xLineTo(10, %)
///   |> close(%)
///
/// const example = extrude(10, exampleSketch)
/// ```
#[stdlib {
    name = "xLineTo",
}]
async fn inner_x_line_to(to: f64, sketch: Sketch, tag: Option<TagDeclarator>, args: Args) -> Result<Sketch, KclError> {
    let from = sketch.current_pen_position()?;

    let new_sketch = inner_line_to([to, from.y], sketch, tag, args).await?;

    Ok(new_sketch)
}

/// Draw a line to a point on the y-axis.
pub async fn y_line_to(_exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let (to, sketch, tag): (f64, Sketch, Option<TagDeclarator>) = args.get_data_and_sketch_and_tag()?;

    let new_sketch = inner_y_line_to(to, sketch, tag, args).await?;
    Ok(KclValue::new_user_val(new_sketch.meta.clone(), new_sketch))
}

/// Draw a line parallel to the Y axis, that ends at the given Y.
/// E.g. if the previous line ended at (1, 1),
/// then yLineTo(4) draws a line from (1, 1) to (1, 4)
///
/// ```no_run
/// const exampleSketch = startSketchOn("XZ")
///   |> startProfileAt([0, 0], %)
///   |> angledLine({
///     angle: 50,
///     length: 45,
///   }, %)
///   |> yLineTo(0, %)
///   |> close(%)
///
/// const example = extrude(5, exampleSketch)
/// ```
#[stdlib {
    name = "yLineTo",
}]
async fn inner_y_line_to(to: f64, sketch: Sketch, tag: Option<TagDeclarator>, args: Args) -> Result<Sketch, KclError> {
    let from = sketch.current_pen_position()?;

    let new_sketch = inner_line_to([from.x, to], sketch, tag, args).await?;
    Ok(new_sketch)
}

/// Draw a line.
pub async fn line(_exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let (delta, sketch, tag): ([f64; 2], Sketch, Option<TagDeclarator>) = args.get_data_and_sketch_and_tag()?;

    let new_sketch = inner_line(delta, sketch, tag, args).await?;
    Ok(KclValue::new_user_val(new_sketch.meta.clone(), new_sketch))
}

/// Draw a line relative to the current origin to a specified (x, y) away
/// from the current position.
///
/// ```no_run
/// const exampleSketch = startSketchOn("XZ")
///   |> startProfileAt([0, 0], %)
///   |> line([25, 15], %)
///   |> line([5, -6], %)
///   |> line([-10, -10], %)
///   |> close(%)
///
/// const example = extrude(5, exampleSketch)
/// ```
///
/// ```no_run
/// const exampleSketch = startSketchOn("XZ")
///   |> startProfileAt([0, 0], %)
///   |> line([10, 0], %)
///   |> line([0, 10], %)
///   |> line([-10, 0], %)
///   |> close(%)
///
/// const example = extrude(5, exampleSketch)
/// ```
#[stdlib {
    name = "line",
}]
async fn inner_line(
    delta: [f64; 2],
    sketch: Sketch,
    tag: Option<TagDeclarator>,
    args: Args,
) -> Result<Sketch, KclError> {
    let from = sketch.current_pen_position()?;
    let to = [from.x + delta[0], from.y + delta[1]];

    let id = uuid::Uuid::new_v4();

    args.batch_modeling_cmd(
        id,
        ModelingCmd::from(mcmd::ExtendPath {
            path: sketch.id.into(),
            segment: PathSegment::Line {
                end: KPoint2d::from(delta).with_z(0.0).map(LengthUnit),
                relative: true,
            },
        }),
    )
    .await?;

    let current_path = Path::ToPoint {
        base: BasePath {
            from: from.into(),
            to,
            tag: tag.clone(),
            geo_meta: GeoMeta {
                id,
                metadata: args.source_range.into(),
            },
        },
    };

    let mut new_sketch = sketch.clone();
    if let Some(tag) = &tag {
        new_sketch.add_tag(tag, &current_path);
    }

    new_sketch.value.push(current_path);

    Ok(new_sketch)
}

/// Draw a line on the x-axis.
pub async fn x_line(_exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let (length, sketch, tag): (f64, Sketch, Option<TagDeclarator>) = args.get_data_and_sketch_and_tag()?;

    let new_sketch = inner_x_line(length, sketch, tag, args).await?;
    Ok(KclValue::new_user_val(new_sketch.meta.clone(), new_sketch))
}

/// Draw a line relative to the current origin to a specified distance away
/// from the current position along the 'x' axis.
///
/// ```no_run
/// const exampleSketch = startSketchOn('XZ')
///   |> startProfileAt([0, 0], %)
///   |> xLine(15, %)
///   |> angledLine({
///     angle: 80,
///     length: 15,
///   }, %)
///   |> line([8, -10], %)
///   |> xLine(10, %)
///   |> angledLine({
///     angle: 120,
///     length: 30,
///   }, %)
///   |> xLine(-15, %)
///   |> close(%)
///
/// const example = extrude(10, exampleSketch)
/// ```
#[stdlib {
    name = "xLine",
}]
async fn inner_x_line(length: f64, sketch: Sketch, tag: Option<TagDeclarator>, args: Args) -> Result<Sketch, KclError> {
    inner_line([length, 0.0], sketch, tag, args).await
}

/// Draw a line on the y-axis.
pub async fn y_line(_exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let (length, sketch, tag): (f64, Sketch, Option<TagDeclarator>) = args.get_data_and_sketch_and_tag()?;

    let new_sketch = inner_y_line(length, sketch, tag, args).await?;
    Ok(KclValue::new_user_val(new_sketch.meta.clone(), new_sketch))
}

/// Draw a line relative to the current origin to a specified distance away
/// from the current position along the 'y' axis.
///
/// ```no_run
/// const exampleSketch = startSketchOn('XZ')
///   |> startProfileAt([0, 0], %)
///   |> yLine(15, %)
///   |> angledLine({
///     angle: 30,
///     length: 15,
///   }, %)
///   |> line([8, -10], %)
///   |> yLine(-5, %)
///   |> close(%)
///
/// const example = extrude(10, exampleSketch)
/// ```
#[stdlib {
    name = "yLine",
}]
async fn inner_y_line(length: f64, sketch: Sketch, tag: Option<TagDeclarator>, args: Args) -> Result<Sketch, KclError> {
    inner_line([0.0, length], sketch, tag, args).await
}

/// Data to draw an angled line.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(rename_all = "camelCase", untagged)]
pub enum AngledLineData {
    /// An angle and length with explicitly named parameters
    AngleAndLengthNamed {
        /// The angle of the line (in degrees).
        angle: f64,
        /// The length of the line.
        length: f64,
    },
    /// An angle and length given as a pair
    AngleAndLengthPair([f64; 2]),
}

/// Draw an angled line.
pub async fn angled_line(_exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let (data, sketch, tag): (AngledLineData, Sketch, Option<TagDeclarator>) = args.get_data_and_sketch_and_tag()?;

    let new_sketch = inner_angled_line(data, sketch, tag, args).await?;
    Ok(KclValue::new_user_val(new_sketch.meta.clone(), new_sketch))
}

/// Draw a line segment relative to the current origin using the polar
/// measure of some angle and distance.
///
/// ```no_run
/// const exampleSketch = startSketchOn('XZ')
///   |> startProfileAt([0, 0], %)
///   |> yLineTo(15, %)
///   |> angledLine({
///     angle: 30,
///     length: 15,
///   }, %)
///   |> line([8, -10], %)
///   |> yLineTo(0, %)
///   |> close(%)
///
/// const example = extrude(10, exampleSketch)
/// ```
#[stdlib {
    name = "angledLine",
}]
async fn inner_angled_line(
    data: AngledLineData,
    sketch: Sketch,
    tag: Option<TagDeclarator>,
    args: Args,
) -> Result<Sketch, KclError> {
    let from = sketch.current_pen_position()?;
    let (angle, length) = match data {
        AngledLineData::AngleAndLengthNamed { angle, length } => (angle, length),
        AngledLineData::AngleAndLengthPair(pair) => (pair[0], pair[1]),
    };

    //double check me on this one - mike
    let delta: [f64; 2] = [
        length * f64::cos(angle.to_radians()),
        length * f64::sin(angle.to_radians()),
    ];
    let relative = true;

    let to: [f64; 2] = [from.x + delta[0], from.y + delta[1]];

    let id = uuid::Uuid::new_v4();

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
            geo_meta: GeoMeta {
                id,
                metadata: args.source_range.into(),
            },
        },
    };

    let mut new_sketch = sketch.clone();
    if let Some(tag) = &tag {
        new_sketch.add_tag(tag, &current_path);
    }

    new_sketch.value.push(current_path);
    Ok(new_sketch)
}

/// Draw an angled line of a given x length.
pub async fn angled_line_of_x_length(_exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let (data, sketch, tag): (AngledLineData, Sketch, Option<TagDeclarator>) = args.get_data_and_sketch_and_tag()?;

    let new_sketch = inner_angled_line_of_x_length(data, sketch, tag, args).await?;
    Ok(KclValue::new_user_val(new_sketch.meta.clone(), new_sketch))
}

/// Create a line segment from the current 2-dimensional sketch origin
/// along some angle (in degrees) for some relative length in the 'x' dimension.
///
/// ```no_run
/// const sketch001 = startSketchOn('XZ')
///   |> startProfileAt([0, 0], %)
///   |> angledLineOfXLength({ angle: 45, length: 10 }, %, $edge1)
///   |> angledLineOfXLength({ angle: -15, length: 20 }, %, $edge2)
///   |> line([0, -5], %)
///   |> close(%, $edge3)
///
/// const extrusion = extrude(10, sketch001)
/// ```
#[stdlib {
    name = "angledLineOfXLength",
}]
async fn inner_angled_line_of_x_length(
    data: AngledLineData,
    sketch: Sketch,
    tag: Option<TagDeclarator>,
    args: Args,
) -> Result<Sketch, KclError> {
    let (angle, length) = match data {
        AngledLineData::AngleAndLengthNamed { angle, length } => (angle, length),
        AngledLineData::AngleAndLengthPair(pair) => (pair[0], pair[1]),
    };

    if angle.abs() == 270.0 {
        return Err(KclError::Type(KclErrorDetails {
            message: "Cannot have an x constrained angle of 270 degrees".to_string(),
            source_ranges: vec![args.source_range],
        }));
    }

    if angle.abs() == 90.0 {
        return Err(KclError::Type(KclErrorDetails {
            message: "Cannot have an x constrained angle of 90 degrees".to_string(),
            source_ranges: vec![args.source_range],
        }));
    }

    let to = get_y_component(Angle::from_degrees(angle), length);

    let new_sketch = inner_line(to.into(), sketch, tag, args).await?;

    Ok(new_sketch)
}

/// Data to draw an angled line to a point.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct AngledLineToData {
    /// The angle of the line.
    angle: f64,
    /// The point to draw to.
    to: f64,
}

/// Draw an angled line to a given x coordinate.
pub async fn angled_line_to_x(_exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let (data, sketch, tag): (AngledLineToData, Sketch, Option<TagDeclarator>) = args.get_data_and_sketch_and_tag()?;

    let new_sketch = inner_angled_line_to_x(data, sketch, tag, args).await?;
    Ok(KclValue::new_user_val(new_sketch.meta.clone(), new_sketch))
}

/// Create a line segment from the current 2-dimensional sketch origin
/// along some angle (in degrees) for some length, ending at the provided value
/// in the 'x' dimension.
///
/// ```no_run
/// const exampleSketch = startSketchOn('XZ')
///   |> startProfileAt([0, 0], %)
///   |> angledLineToX({ angle: 30, to: 10 }, %)
///   |> line([0, 10], %)
///   |> line([-10, 0], %)
///   |> close(%)
///  
/// const example = extrude(10, exampleSketch)
/// ```
#[stdlib {
    name = "angledLineToX",
}]
async fn inner_angled_line_to_x(
    data: AngledLineToData,
    sketch: Sketch,
    tag: Option<TagDeclarator>,
    args: Args,
) -> Result<Sketch, KclError> {
    let from = sketch.current_pen_position()?;
    let AngledLineToData { angle, to: x_to } = data;

    if angle.abs() == 270.0 {
        return Err(KclError::Type(KclErrorDetails {
            message: "Cannot have an x constrained angle of 270 degrees".to_string(),
            source_ranges: vec![args.source_range],
        }));
    }

    if angle.abs() == 90.0 {
        return Err(KclError::Type(KclErrorDetails {
            message: "Cannot have an x constrained angle of 90 degrees".to_string(),
            source_ranges: vec![args.source_range],
        }));
    }

    let x_component = x_to - from.x;
    let y_component = x_component * f64::tan(angle.to_radians());
    let y_to = from.y + y_component;

    let new_sketch = inner_line_to([x_to, y_to], sketch, tag, args).await?;
    Ok(new_sketch)
}

/// Draw an angled line of a given y length.
pub async fn angled_line_of_y_length(_exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let (data, sketch, tag): (AngledLineData, Sketch, Option<TagDeclarator>) = args.get_data_and_sketch_and_tag()?;

    let new_sketch = inner_angled_line_of_y_length(data, sketch, tag, args).await?;

    Ok(KclValue::new_user_val(new_sketch.meta.clone(), new_sketch))
}

/// Create a line segment from the current 2-dimensional sketch origin
/// along some angle (in degrees) for some relative length in the 'y' dimension.
///
/// ```no_run
/// const exampleSketch = startSketchOn('XZ')
///   |> startProfileAt([0, 0], %)
///   |> line([10, 0], %)
///   |> angledLineOfYLength({ angle: 45, length: 10 }, %)
///   |> line([0, 10], %)
///   |> angledLineOfYLength({ angle: 135, length: 10 }, %)
///   |> line([-10, 0], %)
///   |> line([0, -30], %)
///
/// const example = extrude(10, exampleSketch)
/// ```
#[stdlib {
    name = "angledLineOfYLength",
}]
async fn inner_angled_line_of_y_length(
    data: AngledLineData,
    sketch: Sketch,
    tag: Option<TagDeclarator>,
    args: Args,
) -> Result<Sketch, KclError> {
    let (angle, length) = match data {
        AngledLineData::AngleAndLengthNamed { angle, length } => (angle, length),
        AngledLineData::AngleAndLengthPair(pair) => (pair[0], pair[1]),
    };

    if angle.abs() == 0.0 {
        return Err(KclError::Type(KclErrorDetails {
            message: "Cannot have a y constrained angle of 0 degrees".to_string(),
            source_ranges: vec![args.source_range],
        }));
    }

    if angle.abs() == 180.0 {
        return Err(KclError::Type(KclErrorDetails {
            message: "Cannot have a y constrained angle of 180 degrees".to_string(),
            source_ranges: vec![args.source_range],
        }));
    }

    let to = get_x_component(Angle::from_degrees(angle), length);

    let new_sketch = inner_line(to.into(), sketch, tag, args).await?;

    Ok(new_sketch)
}

/// Draw an angled line to a given y coordinate.
pub async fn angled_line_to_y(_exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let (data, sketch, tag): (AngledLineToData, Sketch, Option<TagDeclarator>) = args.get_data_and_sketch_and_tag()?;

    let new_sketch = inner_angled_line_to_y(data, sketch, tag, args).await?;
    Ok(KclValue::new_user_val(new_sketch.meta.clone(), new_sketch))
}

/// Create a line segment from the current 2-dimensional sketch origin
/// along some angle (in degrees) for some length, ending at the provided value
/// in the 'y' dimension.
///
/// ```no_run
/// const exampleSketch = startSketchOn('XZ')
///   |> startProfileAt([0, 0], %)
///   |> angledLineToY({ angle: 60, to: 20 }, %)
///   |> line([-20, 0], %)
///   |> angledLineToY({ angle: 70, to: 10 }, %)
///   |> close(%)
///
/// const example = extrude(10, exampleSketch)
/// ```
#[stdlib {
    name = "angledLineToY",
}]
async fn inner_angled_line_to_y(
    data: AngledLineToData,
    sketch: Sketch,
    tag: Option<TagDeclarator>,
    args: Args,
) -> Result<Sketch, KclError> {
    let from = sketch.current_pen_position()?;
    let AngledLineToData { angle, to: y_to } = data;

    if angle.abs() == 0.0 {
        return Err(KclError::Type(KclErrorDetails {
            message: "Cannot have a y constrained angle of 0 degrees".to_string(),
            source_ranges: vec![args.source_range],
        }));
    }

    if angle.abs() == 180.0 {
        return Err(KclError::Type(KclErrorDetails {
            message: "Cannot have a y constrained angle of 180 degrees".to_string(),
            source_ranges: vec![args.source_range],
        }));
    }

    let y_component = y_to - from.y;
    let x_component = y_component / f64::tan(angle.to_radians());
    let x_to = from.x + x_component;

    let new_sketch = inner_line_to([x_to, y_to], sketch, tag, args).await?;
    Ok(new_sketch)
}

/// Data for drawing an angled line that intersects with a given line.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
// TODO: make sure the docs on the args below are correct.
pub struct AngledLineThatIntersectsData {
    /// The angle of the line.
    pub angle: f64,
    /// The tag of the line to intersect with.
    pub intersect_tag: TagIdentifier,
    /// The offset from the intersecting line.
    pub offset: Option<f64>,
}

/// Draw an angled line that intersects with a given line.
pub async fn angled_line_that_intersects(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let (data, sketch, tag): (AngledLineThatIntersectsData, Sketch, Option<TagDeclarator>) =
        args.get_data_and_sketch_and_tag()?;
    let new_sketch = inner_angled_line_that_intersects(data, sketch, tag, exec_state, args).await?;
    Ok(KclValue::new_user_val(new_sketch.meta.clone(), new_sketch))
}

/// Draw an angled line from the current origin, constructing a line segment
/// such that the newly created line intersects the desired target line
/// segment.
///
/// ```no_run
/// const exampleSketch = startSketchOn('XZ')
///   |> startProfileAt([0, 0], %)
///   |> lineTo([5, 10], %)
///   |> lineTo([-10, 10], %, $lineToIntersect)
///   |> lineTo([0, 20], %)
///   |> angledLineThatIntersects({
///        angle: 80,
///        intersectTag: lineToIntersect,
///        offset: 10
///      }, %)
///   |> close(%)
///
/// const example = extrude(10, exampleSketch)
/// ```
#[stdlib {
    name = "angledLineThatIntersects",
}]
async fn inner_angled_line_that_intersects(
    data: AngledLineThatIntersectsData,
    sketch: Sketch,
    tag: Option<TagDeclarator>,
    exec_state: &mut ExecState,
    args: Args,
) -> Result<Sketch, KclError> {
    let intersect_path = args.get_tag_engine_info(exec_state, &data.intersect_tag)?;
    let path = intersect_path.path.clone().ok_or_else(|| {
        KclError::Type(KclErrorDetails {
            message: format!("Expected an intersect path with a path, found `{:?}`", intersect_path),
            source_ranges: vec![args.source_range],
        })
    })?;

    let from = sketch.current_pen_position()?;
    let to = intersection_with_parallel_line(
        &[path.from.into(), path.to.into()],
        data.offset.unwrap_or_default(),
        data.angle,
        from,
    );

    let new_sketch = inner_line_to(to.into(), sketch, tag, args).await?;
    Ok(new_sketch)
}

/// Start a sketch at a given point.
pub async fn start_sketch_at(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let data: [f64; 2] = args.get_data()?;

    let sketch = inner_start_sketch_at(data, exec_state, args).await?;
    Ok(KclValue::new_user_val(sketch.meta.clone(), sketch))
}

/// Start a new 2-dimensional sketch at a given point on the 'XY' plane.
///
/// ```no_run
/// const exampleSketch = startSketchAt([0, 0])
///   |> line([10, 0], %)
///   |> line([0, 10], %)
///   |> line([-10, 0], %)
///   |> close(%)
///
/// const example = extrude(5, exampleSketch)
/// ```
///
/// ```no_run
/// const exampleSketch = startSketchAt([10, 10])
///   |> line([10, 0], %)
///   |> line([0, 10], %)
///   |> line([-10, 0], %)
///   |> close(%)
///
/// const example = extrude(5, exampleSketch)
/// ```
///
/// ```no_run
/// const exampleSketch = startSketchAt([-10, 23])
///   |> line([10, 0], %)
///   |> line([0, 10], %)
///   |> line([-10, 0], %)
///   |> close(%)
///
/// const example = extrude(5, exampleSketch)
/// ```
#[stdlib {
    name = "startSketchAt",
}]
async fn inner_start_sketch_at(data: [f64; 2], exec_state: &mut ExecState, args: Args) -> Result<Sketch, KclError> {
    // Let's assume it's the XY plane for now, this is just for backwards compatibility.
    let xy_plane = PlaneData::XY;
    let sketch_surface = inner_start_sketch_on(SketchData::Plane(xy_plane), None, exec_state, &args).await?;
    let sketch = inner_start_profile_at(data, sketch_surface, None, exec_state, args).await?;
    Ok(sketch)
}

/// Data for start sketch on.
/// You can start a sketch on a plane or an solid.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(rename_all = "camelCase", untagged)]
pub enum SketchData {
    Plane(PlaneData),
    Solid(Box<Solid>),
}

/// Data for a plane.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
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
        origin: Box<Point3d>,
        /// What should the plane’s X axis be?
        #[serde(rename = "xAxis", alias = "x_axis")]
        x_axis: Box<Point3d>,
        /// What should the plane’s Y axis be?
        #[serde(rename = "yAxis", alias = "y_axis")]
        y_axis: Box<Point3d>,
        /// The z-axis (normal).
        #[serde(rename = "zAxis", alias = "z_axis")]
        z_axis: Box<Point3d>,
    },
}

impl From<PlaneData> for Plane {
    fn from(value: PlaneData) -> Self {
        let id = uuid::Uuid::new_v4();
        match value {
            PlaneData::XY => Plane {
                id,
                origin: Point3d::new(0.0, 0.0, 0.0),
                x_axis: Point3d::new(1.0, 0.0, 0.0),
                y_axis: Point3d::new(0.0, 1.0, 0.0),
                z_axis: Point3d::new(0.0, 0.0, 1.0),
                value: PlaneType::XY,
                meta: vec![],
            },
            PlaneData::NegXY => Plane {
                id,
                origin: Point3d::new(0.0, 0.0, 0.0),
                x_axis: Point3d::new(1.0, 0.0, 0.0),
                y_axis: Point3d::new(0.0, 1.0, 0.0),
                z_axis: Point3d::new(0.0, 0.0, -1.0),
                value: PlaneType::XY,
                meta: vec![],
            },
            PlaneData::XZ => Plane {
                id,
                origin: Point3d::new(0.0, 0.0, 0.0),
                x_axis: Point3d::new(1.0, 0.0, 0.0),
                y_axis: Point3d::new(0.0, 0.0, 1.0),
                z_axis: Point3d::new(0.0, -1.0, 0.0),
                value: PlaneType::XZ,
                meta: vec![],
            },
            PlaneData::NegXZ => Plane {
                id,
                origin: Point3d::new(0.0, 0.0, 0.0),
                x_axis: Point3d::new(-1.0, 0.0, 0.0),
                y_axis: Point3d::new(0.0, 0.0, 1.0),
                z_axis: Point3d::new(0.0, 1.0, 0.0),
                value: PlaneType::XZ,
                meta: vec![],
            },
            PlaneData::YZ => Plane {
                id,
                origin: Point3d::new(0.0, 0.0, 0.0),
                x_axis: Point3d::new(0.0, 1.0, 0.0),
                y_axis: Point3d::new(0.0, 0.0, 1.0),
                z_axis: Point3d::new(1.0, 0.0, 0.0),
                value: PlaneType::YZ,
                meta: vec![],
            },
            PlaneData::NegYZ => Plane {
                id,
                origin: Point3d::new(0.0, 0.0, 0.0),
                x_axis: Point3d::new(0.0, 1.0, 0.0),
                y_axis: Point3d::new(0.0, 0.0, 1.0),
                z_axis: Point3d::new(-1.0, 0.0, 0.0),
                value: PlaneType::YZ,
                meta: vec![],
            },
            PlaneData::Plane {
                origin,
                x_axis,
                y_axis,
                z_axis,
            } => Plane {
                id,
                origin: *origin,
                x_axis: *x_axis,
                y_axis: *y_axis,
                z_axis: *z_axis,
                value: PlaneType::Custom,
                meta: vec![],
            },
        }
    }
}

/// Start a sketch on a specific plane or face.
pub async fn start_sketch_on(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let (data, tag): (SketchData, Option<FaceTag>) = args.get_data_and_optional_tag()?;

    match inner_start_sketch_on(data, tag, exec_state, &args).await? {
        SketchSurface::Plane(plane) => Ok(KclValue::Plane(plane)),
        SketchSurface::Face(face) => Ok(KclValue::Face(face)),
    }
}

/// Start a new 2-dimensional sketch on a specific plane or face.
///
/// ```no_run
/// const exampleSketch = startSketchOn("XY")
///   |> startProfileAt([0, 0], %)
///   |> line([10, 0], %)
///   |> line([0, 10], %)
///   |> line([-10, 0], %)
///   |> close(%)
///
/// const example = extrude(5, exampleSketch)
///
/// const exampleSketch002 = startSketchOn(example, 'end')
///   |> startProfileAt([1, 1], %)
///   |> line([8, 0], %)
///   |> line([0, 8], %)
///   |> line([-8, 0], %)
///   |> close(%)
///
/// const example002 = extrude(5, exampleSketch002)
///
/// const exampleSketch003 = startSketchOn(example002, 'end')
///   |> startProfileAt([2, 2], %)
///   |> line([6, 0], %)
///   |> line([0, 6], %)
///   |> line([-6, 0], %)
///   |> close(%)
///
/// const example003 = extrude(5, exampleSketch003)
/// ```
///
/// ```no_run
/// const exampleSketch = startSketchOn("XY")
///   |> startProfileAt([0, 0], %)
///   |> line([10, 0], %)
///   |> line([0, 10], %, $sketchingFace)
///   |> line([-10, 0], %)
///   |> close(%)
///
/// const example = extrude(10, exampleSketch)
///
/// const exampleSketch002 = startSketchOn(example, sketchingFace)
///   |> startProfileAt([1, 1], %)
///   |> line([8, 0], %)
///   |> line([0, 8], %)
///   |> line([-8, 0], %)
///   |> close(%, $sketchingFace002)
///
/// const example002 = extrude(10, exampleSketch002)
///
/// const exampleSketch003 = startSketchOn(example002, sketchingFace002)
///   |> startProfileAt([-8, 12], %)
///   |> line([0, 6], %)
///   |> line([6, 0], %)
///   |> line([0, -6], %)
///   |> close(%)
///
/// const example003 = extrude(5, exampleSketch003)
/// ```
///
/// ```no_run
/// const exampleSketch = startSketchOn('XY')
///   |> startProfileAt([4, 12], %)
///   |> line([2, 0], %)
///   |> line([0, -6], %)
///   |> line([4, -6], %)
///   |> line([0, -6], %)
///   |> line([-3.75, -4.5], %)
///   |> line([0, -5.5], %)
///   |> line([-2, 0], %)
///   |> close(%)
///
/// const example = revolve({ axis: 'y', angle: 180 }, exampleSketch)
///  
/// const exampleSketch002 = startSketchOn(example, 'end')
///   |> startProfileAt([4.5, -5], %)
///   |> line([0, 5], %)
///   |> line([5, 0], %)
///   |> line([0, -5], %)
///   |> close(%)
///
/// const example002 = extrude(5, exampleSketch002)
/// ```
///
/// ```no_run
/// const a1 = startSketchOn({
///       plane: {
///         origin: { x: 0, y: 0, z: 0 },
///         xAxis: { x: 1, y: 0, z: 0 },
///         yAxis: { x: 0, y: 1, z: 0 },
///         zAxis: { x: 0, y: 0, z: 1 }
///       }
///     })
///  |> startProfileAt([0, 0], %)
///  |> line([100.0, 0], %)
///  |> yLine(-100.0, %)
///  |> xLine(-100.0, %)
///  |> yLine(100.0, %)
///  |> close(%)
///  |> extrude(3.14, %)
/// ```
#[stdlib {
    name = "startSketchOn",
}]
async fn inner_start_sketch_on(
    data: SketchData,
    tag: Option<FaceTag>,
    exec_state: &mut ExecState,
    args: &Args,
) -> Result<SketchSurface, KclError> {
    match data {
        SketchData::Plane(plane_data) => {
            let plane = start_sketch_on_plane(plane_data, args).await?;
            Ok(SketchSurface::Plane(plane))
        }
        SketchData::Solid(solid) => {
            let Some(tag) = tag else {
                return Err(KclError::Type(KclErrorDetails {
                    message: "Expected a tag for the face to sketch on".to_string(),
                    source_ranges: vec![args.source_range],
                }));
            };
            let face = start_sketch_on_face(solid, tag, exec_state, args).await?;
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
        value: tag.to_string(),
        // TODO: get this from the extrude plane data.
        x_axis: solid.sketch.on.x_axis(),
        y_axis: solid.sketch.on.y_axis(),
        z_axis: solid.sketch.on.z_axis(),
        solid,
        meta: vec![args.source_range.into()],
    }))
}

async fn start_sketch_on_plane(data: PlaneData, args: &Args) -> Result<Box<Plane>, KclError> {
    let mut plane: Plane = data.clone().into();

    // Get the default planes.
    let default_planes = args.ctx.engine.default_planes(args.source_range).await?;

    plane.id = match data {
        PlaneData::XY => default_planes.xy,
        PlaneData::XZ => default_planes.xz,
        PlaneData::YZ => default_planes.yz,
        PlaneData::NegXY => default_planes.neg_xy,
        PlaneData::NegXZ => default_planes.neg_xz,
        PlaneData::NegYZ => default_planes.neg_yz,
        PlaneData::Plane {
            origin,
            x_axis,
            y_axis,
            z_axis: _,
        } => {
            // Create the custom plane on the fly.
            let id = uuid::Uuid::new_v4();
            args.batch_modeling_cmd(
                id,
                ModelingCmd::from(mcmd::MakePlane {
                    clobber: false,
                    origin: (*origin).into(),
                    size: LengthUnit(60.0),
                    x_axis: (*x_axis).into(),
                    y_axis: (*y_axis).into(),
                    hide: Some(true),
                }),
            )
            .await?;

            id
        }
    };

    Ok(Box::new(plane))
}

/// Start a new profile at a given point.
pub async fn start_profile_at(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let (start, sketch_surface, tag): ([f64; 2], SketchSurface, Option<TagDeclarator>) =
        args.get_data_and_sketch_surface()?;

    let sketch = inner_start_profile_at(start, sketch_surface, tag, exec_state, args).await?;
    Ok(KclValue::new_user_val(sketch.meta.clone(), sketch))
}

/// Start a new profile at a given point.
///
/// ```no_run
/// const exampleSketch = startSketchOn('XZ')
///   |> startProfileAt([0, 0], %)
///   |> line([10, 0], %)
///   |> line([0, 10], %)
///   |> line([-10, 0], %)
///   |> close(%)
///
/// const example = extrude(5, exampleSketch)
/// ```
///
/// ```no_run
/// const exampleSketch = startSketchOn('-XZ')
///   |> startProfileAt([10, 10], %)
///   |> line([10, 0], %)
///   |> line([0, 10], %)
///   |> line([-10, 0], %)
///   |> close(%)
///
/// const example = extrude(5, exampleSketch)
/// ```
///
/// ```no_run
/// const exampleSketch = startSketchOn('-XZ')
///   |> startProfileAt([-10, 23], %)
///   |> line([10, 0], %)
///   |> line([0, 10], %)
///   |> line([-10, 0], %)
///   |> close(%)
///
/// const example = extrude(5, exampleSketch)
/// ```
#[stdlib {
    name = "startProfileAt",
}]
pub(crate) async fn inner_start_profile_at(
    to: [f64; 2],
    sketch_surface: SketchSurface,
    tag: Option<TagDeclarator>,
    exec_state: &mut ExecState,
    args: Args,
) -> Result<Sketch, KclError> {
    if let SketchSurface::Face(face) = &sketch_surface {
        // Flush the batch for our fillets/chamfers if there are any.
        // If we do not do these for sketch on face, things will fail with face does not exist.
        args.flush_batch_for_solid_set(exec_state, face.solid.clone().into())
            .await?;
    }

    // Enter sketch mode on the surface.
    // We call this here so you can reuse the sketch surface for multiple sketches.
    let id = uuid::Uuid::new_v4();
    args.batch_modeling_cmd(
        id,
        ModelingCmd::from(mcmd::EnableSketchMode {
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
    )
    .await?;

    let id = uuid::Uuid::new_v4();
    let path_id = uuid::Uuid::new_v4();

    args.batch_modeling_cmd(path_id, ModelingCmd::from(mcmd::StartPath {}))
        .await?;
    args.batch_modeling_cmd(
        id,
        ModelingCmd::from(mcmd::MovePathPen {
            path: path_id.into(),
            to: KPoint2d::from(to).with_z(0.0).map(LengthUnit),
        }),
    )
    .await?;

    let current_path = BasePath {
        from: to,
        to,
        tag: tag.clone(),
        geo_meta: GeoMeta {
            id,
            metadata: args.source_range.into(),
        },
    };

    let sketch = Sketch {
        id: path_id,
        original_id: path_id,
        on: sketch_surface.clone(),
        value: vec![],
        meta: vec![args.source_range.into()],
        tags: if let Some(tag) = &tag {
            let mut tag_identifier: TagIdentifier = tag.into();
            tag_identifier.info = Some(TagEngineInfo {
                id: current_path.geo_meta.id,
                sketch: path_id,
                path: Some(current_path.clone()),
                surface: None,
            });
            HashMap::from([(tag.name.to_string(), tag_identifier)])
        } else {
            Default::default()
        },
        start: current_path,
    };
    Ok(sketch)
}

/// Returns the X component of the sketch profile start point.
pub async fn profile_start_x(_exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let sketch: Sketch = args.get_sketch()?;
    let x = inner_profile_start_x(sketch)?;
    args.make_user_val_from_f64(x)
}

/// Extract the provided 2-dimensional sketch's profile's origin's 'x'
/// value.
///
/// ```no_run
/// const sketch001 = startSketchOn('XY')
///  |> startProfileAt([5, 2], %)
///  |> angledLine([-26.6, 50], %)
///  |> angledLine([90, 50], %)
///  |> angledLineToX({ angle: 30, to: profileStartX(%) }, %)
/// ```
#[stdlib {
    name = "profileStartX"
}]
pub(crate) fn inner_profile_start_x(sketch: Sketch) -> Result<f64, KclError> {
    Ok(sketch.start.to[0])
}

/// Returns the Y component of the sketch profile start point.
pub async fn profile_start_y(_exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let sketch: Sketch = args.get_sketch()?;
    let x = inner_profile_start_y(sketch)?;
    args.make_user_val_from_f64(x)
}

/// Extract the provided 2-dimensional sketch's profile's origin's 'y'
/// value.
///
/// ```no_run
/// const sketch001 = startSketchOn('XY')
///  |> startProfileAt([5, 2], %)
///  |> angledLine({ angle: -60, length: 14 }, %)
///  |> angledLineToY({ angle: 30, to: profileStartY(%) }, %)
/// ```
#[stdlib {
    name = "profileStartY"
}]
pub(crate) fn inner_profile_start_y(sketch: Sketch) -> Result<f64, KclError> {
    Ok(sketch.start.to[1])
}

/// Returns the sketch profile start point.
pub async fn profile_start(_exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let sketch: Sketch = args.get_sketch()?;
    let point = inner_profile_start(sketch)?;
    Ok(KclValue::UserVal(UserVal {
        value: serde_json::to_value(point).map_err(|e| {
            KclError::Type(KclErrorDetails {
                message: format!("Failed to convert point to json: {}", e),
                source_ranges: vec![args.source_range],
            })
        })?,
        meta: Default::default(),
    }))
}

/// Extract the provided 2-dimensional sketch's profile's origin
/// value.
///
/// ```no_run
/// const sketch001 = startSketchOn('XY')
///  |> startProfileAt([5, 2], %)
///  |> angledLine({ angle: 120, length: 50 }, %, $seg01)
///  |> angledLine({ angle: segAng(seg01) + 120, length: 50 }, %)
///  |> lineTo(profileStart(%), %)
///  |> close(%)
///  |> extrude(20, %)
/// ```
#[stdlib {
    name = "profileStart"
}]
pub(crate) fn inner_profile_start(sketch: Sketch) -> Result<[f64; 2], KclError> {
    Ok(sketch.start.to)
}

/// Close the current sketch.
pub async fn close(_exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let (sketch, tag): (Sketch, Option<TagDeclarator>) = args.get_sketch_and_optional_tag()?;

    let new_sketch = inner_close(sketch, tag, args).await?;

    Ok(KclValue::new_user_val(new_sketch.meta.clone(), new_sketch))
}

/// Construct a line segment from the current origin back to the profile's
/// origin, ensuring the resulting 2-dimensional sketch is not open-ended.
///
/// ```no_run
/// startSketchOn('XZ')
///    |> startProfileAt([0, 0], %)
///    |> line([10, 10], %)
///    |> line([10, 0], %)
///    |> close(%)
///    |> extrude(10, %)
/// ```
///
/// ```no_run
/// const exampleSketch = startSketchOn('-XZ')
///   |> startProfileAt([0, 0], %)
///   |> line([10, 0], %)
///   |> line([0, 10], %)
///   |> close(%)
///
/// const example = extrude(10, exampleSketch)
/// ```
#[stdlib {
    name = "close",
}]
pub(crate) async fn inner_close(sketch: Sketch, tag: Option<TagDeclarator>, args: Args) -> Result<Sketch, KclError> {
    let from = sketch.current_pen_position()?;
    let to: Point2d = sketch.start.from.into();

    let id = uuid::Uuid::new_v4();

    args.batch_modeling_cmd(id, ModelingCmd::from(mcmd::ClosePath { path_id: sketch.id }))
        .await?;

    // If we are sketching on a plane we can close the sketch now.
    if let SketchSurface::Plane(_) = sketch.on {
        // We were on a plane, disable the sketch mode.
        args.batch_modeling_cmd(
            uuid::Uuid::new_v4(),
            ModelingCmd::SketchModeDisable(mcmd::SketchModeDisable {}),
        )
        .await?;
    }

    let current_path = Path::ToPoint {
        base: BasePath {
            from: from.into(),
            to: to.into(),
            tag: tag.clone(),
            geo_meta: GeoMeta {
                id,
                metadata: args.source_range.into(),
            },
        },
    };

    let mut new_sketch = sketch.clone();
    if let Some(tag) = &tag {
        new_sketch.add_tag(tag, &current_path);
    }

    new_sketch.value.push(current_path);

    Ok(new_sketch)
}

/// Data to draw an arc.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(rename_all = "camelCase", untagged)]
pub enum ArcData {
    /// Angles and radius with an optional tag.
    AnglesAndRadius {
        /// The start angle.
        #[serde(rename = "angleStart", alias = "angle_start")]
        #[schemars(range(min = -360.0, max = 360.0))]
        angle_start: f64,
        /// The end angle.
        #[serde(rename = "angleEnd", alias = "angle_end")]
        #[schemars(range(min = -360.0, max = 360.0))]
        angle_end: f64,
        /// The radius.
        radius: f64,
    },
    /// Center, to and radius with an optional tag.
    CenterToRadius {
        /// The center.
        center: [f64; 2],
        /// The to point.
        to: [f64; 2],
        /// The radius.
        radius: f64,
    },
}

/// Draw an arc.
pub async fn arc(_exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let (data, sketch, tag): (ArcData, Sketch, Option<TagDeclarator>) = args.get_data_and_sketch_and_tag()?;

    let new_sketch = inner_arc(data, sketch, tag, args).await?;
    Ok(KclValue::new_user_val(new_sketch.meta.clone(), new_sketch))
}

/// Starting at the current sketch's origin, draw a curved line segment along
/// an imaginary circle of the specified radius.
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
/// const exampleSketch = startSketchOn('XZ')
///   |> startProfileAt([0, 0], %)
///   |> line([10, 0], %)
///   |> arc({
///        angleStart: 0,
///        angleEnd: 280,
///        radius: 16
///      }, %)
///   |> close(%)
// const example = extrude(10, exampleSketch)
/// ```
#[stdlib {
    name = "arc",
}]
pub(crate) async fn inner_arc(
    data: ArcData,
    sketch: Sketch,
    tag: Option<TagDeclarator>,
    args: Args,
) -> Result<Sketch, KclError> {
    let from: Point2d = sketch.current_pen_position()?;

    let (center, angle_start, angle_end, radius, end) = match &data {
        ArcData::AnglesAndRadius {
            angle_start,
            angle_end,
            radius,
        } => {
            let a_start = Angle::from_degrees(*angle_start);
            let a_end = Angle::from_degrees(*angle_end);
            let (center, end) = arc_center_and_end(from, a_start, a_end, *radius);
            (center, a_start, a_end, *radius, end)
        }
        ArcData::CenterToRadius { center, to, radius } => {
            let (angle_start, angle_end) = arc_angles(from, center.into(), to.into(), *radius, args.source_range)?;
            (center.into(), angle_start, angle_end, *radius, to.into())
        }
    };

    if angle_start == angle_end {
        return Err(KclError::Type(KclErrorDetails {
            message: "Arc start and end angles must be different".to_string(),
            source_ranges: vec![args.source_range],
        }));
    }

    let id = uuid::Uuid::new_v4();

    args.batch_modeling_cmd(
        id,
        ModelingCmd::from(mcmd::ExtendPath {
            path: sketch.id.into(),
            segment: PathSegment::Arc {
                start: angle_start,
                end: angle_end,
                center: KPoint2d::from(center).map(LengthUnit),
                radius: LengthUnit(radius),
                relative: false,
            },
        }),
    )
    .await?;

    let current_path = Path::ToPoint {
        base: BasePath {
            from: from.into(),
            to: end.into(),
            tag: tag.clone(),
            geo_meta: GeoMeta {
                id,
                metadata: args.source_range.into(),
            },
        },
    };

    let mut new_sketch = sketch.clone();
    if let Some(tag) = &tag {
        new_sketch.add_tag(tag, &current_path);
    }

    new_sketch.value.push(current_path);

    Ok(new_sketch)
}

/// Data to draw a tangential arc.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, JsonSchema, ts_rs::TS)]
#[ts(export)]
#[serde(rename_all = "camelCase", untagged)]
pub enum TangentialArcData {
    RadiusAndOffset {
        /// Radius of the arc.
        /// Not to be confused with Raiders of the Lost Ark.
        radius: f64,
        /// Offset of the arc, in degrees.
        offset: f64,
    },
}

/// Draw a tangential arc.
pub async fn tangential_arc(_exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let (data, sketch, tag): (TangentialArcData, Sketch, Option<TagDeclarator>) = args.get_data_and_sketch_and_tag()?;

    let new_sketch = inner_tangential_arc(data, sketch, tag, args).await?;
    Ok(KclValue::new_user_val(new_sketch.meta.clone(), new_sketch))
}

/// Starting at the current sketch's origin, draw a curved line segment along
/// some part of an imaginary circle of the specified radius.
///
/// The arc is constructed such that the last line segment is placed tangent
/// to the imaginary circle of the specified radius. The resulting arc is the
/// segment of the imaginary circle from that tangent point for 'offset'
/// degrees along the imaginary circle.
///
/// ```no_run
/// const exampleSketch = startSketchOn('XZ')
///   |> startProfileAt([0, 0], %)
///   |> angledLine({
///     angle: 60,
///     length: 10,
///   }, %)
///   |> tangentialArc({ radius: 10, offset: -120 }, %)
///   |> angledLine({
///     angle: -60,
///     length: 10,
///   }, %)
///   |> close(%)
///
/// const example = extrude(10, exampleSketch)
/// ```
#[stdlib {
    name = "tangentialArc",
}]
async fn inner_tangential_arc(
    data: TangentialArcData,
    sketch: Sketch,
    tag: Option<TagDeclarator>,
    args: Args,
) -> Result<Sketch, KclError> {
    let from: Point2d = sketch.current_pen_position()?;
    // next set of lines is some undocumented voodoo from get_tangential_arc_to_info
    let tangent_info = sketch.get_tangential_info_from_paths(); //this function desperately needs some documentation
    let tan_previous_point = if tangent_info.is_center {
        get_tangent_point_from_previous_arc(tangent_info.center_or_tangent_point, tangent_info.ccw, from.into())
    } else {
        tangent_info.center_or_tangent_point
    };

    let id = uuid::Uuid::new_v4();

    let (center, to, ccw) = match data {
        TangentialArcData::RadiusAndOffset { radius, offset } => {
            // KCL stdlib types use degrees.
            let offset = Angle::from_degrees(offset);

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
            let (center, to) = arc_center_and_end(from, start_angle, end_angle, radius);

            args.batch_modeling_cmd(
                id,
                ModelingCmd::from(mcmd::ExtendPath {
                    path: sketch.id.into(),
                    segment: PathSegment::TangentialArc {
                        radius: LengthUnit(radius),
                        offset,
                    },
                }),
            )
            .await?;
            (center, to.into(), ccw)
        }
    };

    let current_path = Path::TangentialArc {
        ccw,
        center: center.into(),
        base: BasePath {
            from: from.into(),
            to,
            tag: tag.clone(),
            geo_meta: GeoMeta {
                id,
                metadata: args.source_range.into(),
            },
        },
    };

    let mut new_sketch = sketch.clone();
    if let Some(tag) = &tag {
        new_sketch.add_tag(tag, &current_path);
    }

    new_sketch.value.push(current_path);

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

/// Draw a tangential arc to a specific point.
pub async fn tangential_arc_to(_exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let (to, sketch, tag): ([f64; 2], Sketch, Option<TagDeclarator>) = super::args::FromArgs::from_args(&args, 0)?;

    let new_sketch = inner_tangential_arc_to(to, sketch, tag, args).await?;
    Ok(KclValue::new_user_val(new_sketch.meta.clone(), new_sketch))
}

/// Draw a tangential arc to point some distance away..
pub async fn tangential_arc_to_relative(_exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let (delta, sketch, tag): ([f64; 2], Sketch, Option<TagDeclarator>) = super::args::FromArgs::from_args(&args, 0)?;

    let new_sketch = inner_tangential_arc_to_relative(delta, sketch, tag, args).await?;
    Ok(KclValue::new_user_val(new_sketch.meta.clone(), new_sketch))
}

/// Starting at the current sketch's origin, draw a curved line segment along
/// some part of an imaginary circle until it reaches the desired (x, y)
/// coordinates.
///
/// ```no_run
/// const exampleSketch = startSketchOn('XZ')
///   |> startProfileAt([0, 0], %)
///   |> angledLine({
///     angle: 60,
///     length: 10,
///   }, %)
///   |> tangentialArcTo([15, 15], %)
///   |> line([10, -15], %)
///   |> close(%)
///
/// const example = extrude(10, exampleSketch)
/// ```
#[stdlib {
    name = "tangentialArcTo",
}]
async fn inner_tangential_arc_to(
    to: [f64; 2],
    sketch: Sketch,
    tag: Option<TagDeclarator>,
    args: Args,
) -> Result<Sketch, KclError> {
    let from: Point2d = sketch.current_pen_position()?;
    let tangent_info = sketch.get_tangential_info_from_paths();
    let tan_previous_point = if tangent_info.is_center {
        get_tangent_point_from_previous_arc(tangent_info.center_or_tangent_point, tangent_info.ccw, from.into())
    } else {
        tangent_info.center_or_tangent_point
    };
    let [to_x, to_y] = to;
    let result = get_tangential_arc_to_info(TangentialArcInfoInput {
        arc_start_point: [from.x, from.y],
        arc_end_point: to,
        tan_previous_point,
        obtuse: true,
    });

    let delta = [to_x - from.x, to_y - from.y];
    let id = uuid::Uuid::new_v4();
    args.batch_modeling_cmd(id, tan_arc_to(&sketch, &delta)).await?;

    let current_path = Path::TangentialArcTo {
        base: BasePath {
            from: from.into(),
            to,
            tag: tag.clone(),
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
        new_sketch.add_tag(tag, &current_path);
    }

    new_sketch.value.push(current_path);

    Ok(new_sketch)
}

/// Starting at the current sketch's origin, draw a curved line segment along
/// some part of an imaginary circle until it reaches a point the given (x, y)
/// distance away.
///
/// ```no_run
/// const exampleSketch = startSketchOn('XZ')
///   |> startProfileAt([0, 0], %)
///   |> angledLine({
///     angle: 45,
///     length: 10,
///   }, %)
///   |> tangentialArcToRelative([0, -10], %)
///   |> line([-10, 0], %)
///   |> close(%)
///
/// const example = extrude(10, exampleSketch)
/// ```
#[stdlib {
    name = "tangentialArcToRelative",
}]
async fn inner_tangential_arc_to_relative(
    delta: [f64; 2],
    sketch: Sketch,
    tag: Option<TagDeclarator>,
    args: Args,
) -> Result<Sketch, KclError> {
    let from: Point2d = sketch.current_pen_position()?;
    let tangent_info = sketch.get_tangential_info_from_paths();
    let tan_previous_point = if tangent_info.is_center {
        get_tangent_point_from_previous_arc(tangent_info.center_or_tangent_point, tangent_info.ccw, from.into())
    } else {
        tangent_info.center_or_tangent_point
    };
    let [dx, dy] = delta;
    let result = get_tangential_arc_to_info(TangentialArcInfoInput {
        arc_start_point: [from.x, from.y],
        arc_end_point: [from.x + dx, from.y + dy],
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

    let id = uuid::Uuid::new_v4();
    args.batch_modeling_cmd(id, tan_arc_to(&sketch, &delta)).await?;

    let current_path = Path::TangentialArcTo {
        base: BasePath {
            from: from.into(),
            to: delta,
            tag: tag.clone(),
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
        new_sketch.add_tag(tag, &current_path);
    }

    new_sketch.value.push(current_path);

    Ok(new_sketch)
}

/// Data to draw a bezier curve.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct BezierData {
    /// The to point.
    to: [f64; 2],
    /// The first control point.
    control1: [f64; 2],
    /// The second control point.
    control2: [f64; 2],
}

/// Draw a bezier curve.
pub async fn bezier_curve(_exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let (data, sketch, tag): (BezierData, Sketch, Option<TagDeclarator>) = args.get_data_and_sketch_and_tag()?;

    let new_sketch = inner_bezier_curve(data, sketch, tag, args).await?;
    Ok(KclValue::new_user_val(new_sketch.meta.clone(), new_sketch))
}

/// Draw a smooth, continuous, curved line segment from the current origin to
/// the desired (x, y), using a number of control points to shape the curve's
/// shape.
///
/// ```no_run
/// const exampleSketch = startSketchOn('XZ')
///   |> startProfileAt([0, 0], %)
///   |> line([0, 10], %)
///   |> bezierCurve({
///        to: [10, 10],
///        control1: [5, 0],
///        control2: [5, 10]
///      }, %)
///   |> lineTo([10, 0], %)
///   |> close(%)
///
/// const example = extrude(10, exampleSketch)
/// ```
#[stdlib {
    name = "bezierCurve",
}]
async fn inner_bezier_curve(
    data: BezierData,
    sketch: Sketch,
    tag: Option<TagDeclarator>,
    args: Args,
) -> Result<Sketch, KclError> {
    let from = sketch.current_pen_position()?;

    let relative = true;
    let delta = data.to;
    let to = [from.x + data.to[0], from.y + data.to[1]];

    let id = uuid::Uuid::new_v4();

    args.batch_modeling_cmd(
        id,
        ModelingCmd::from(mcmd::ExtendPath {
            path: sketch.id.into(),
            segment: PathSegment::Bezier {
                control1: KPoint2d::from(data.control1).with_z(0.0).map(LengthUnit),
                control2: KPoint2d::from(data.control2).with_z(0.0).map(LengthUnit),
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
            geo_meta: GeoMeta {
                id,
                metadata: args.source_range.into(),
            },
        },
    };

    let mut new_sketch = sketch.clone();
    if let Some(tag) = &tag {
        new_sketch.add_tag(tag, &current_path);
    }

    new_sketch.value.push(current_path);

    Ok(new_sketch)
}

/// Use a sketch to cut a hole in another sketch.
pub async fn hole(_exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let (hole_sketch, sketch): (SketchSet, Sketch) = args.get_sketches()?;

    let new_sketch = inner_hole(hole_sketch, sketch, args).await?;
    Ok(KclValue::new_user_val(new_sketch.meta.clone(), new_sketch))
}

/// Use a 2-dimensional sketch to cut a hole in another 2-dimensional sketch.
///
/// ```no_run
/// const exampleSketch = startSketchOn('XY')
///   |> startProfileAt([0, 0], %)
///   |> line([0, 5], %)
///   |> line([5, 0], %)
///   |> line([0, -5], %)
///   |> close(%)
///   |> hole(circle({ center: [1, 1], radius: .25 }, %), %)
///   |> hole(circle({ center: [1, 4], radius: .25 }, %), %)
///
/// const example = extrude(1, exampleSketch)
/// ```
///
/// ```no_run
/// fn squareHoleSketch = () => {
///     const squareSketch = startSketchOn('-XZ')
///       |> startProfileAt([-1, -1], %)
///       |> line([2, 0], %)
///       |> line([0, 2], %)
///       |> line([-2, 0], %)
///       |> close(%)
///     return squareSketch
///   }
///
///  const exampleSketch = startSketchOn('-XZ')
///     |> circle({ center: [0, 0], radius: 3 }, %)
///     |> hole(squareHoleSketch(), %)
///  const example = extrude(1, exampleSketch)
/// ```
#[stdlib {
    name = "hole",
}]
async fn inner_hole(hole_sketch: SketchSet, sketch: Sketch, args: Args) -> Result<Sketch, KclError> {
    let hole_sketches: Vec<Sketch> = hole_sketch.into();
    for hole_sketch in hole_sketches {
        args.batch_modeling_cmd(
            uuid::Uuid::new_v4(),
            ModelingCmd::from(mcmd::Solid2dAddHole {
                object_id: sketch.id,
                hole_id: hole_sketch.id,
            }),
        )
        .await?;

        // suggestion (mike)
        // we also hide the source hole since its essentially "consumed" by this operation
        args.batch_modeling_cmd(
            uuid::Uuid::new_v4(),
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

    use crate::{executor::TagIdentifier, std::sketch::PlaneData};

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
            info: None,
            meta: Default::default(),
        })
        .unwrap();
        let data: crate::std::sketch::FaceTag = serde_json::from_str(&str_json).unwrap();
        assert_eq!(
            data,
            crate::std::sketch::FaceTag::Tag(Box::new(TagIdentifier {
                value: "thing".to_string(),
                info: None,
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
}
