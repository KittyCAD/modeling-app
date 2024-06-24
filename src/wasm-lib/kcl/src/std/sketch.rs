//! Functions related to sketching.

use anyhow::Result;
use derive_docs::stdlib;
use kittycad::types::{Angle, ModelingCmd, Point3D};
use parse_display::{Display, FromStr};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::{
    errors::{KclError, KclErrorDetails},
    executor::{
        BasePath, ExtrudeGroup, Face, GeoMeta, MemoryItem, Path, Plane, PlaneType, Point2d, Point3d, SketchGroup,
        SketchGroupSet, SketchSurface, SourceRange, UserVal,
    },
    std::{
        utils::{
            arc_angles, arc_center_and_end, get_tangent_point_from_previous_arc, get_tangential_arc_to_info,
            get_x_component, get_y_component, intersection_with_parallel_line, TangentialArcInfoInput,
        },
        Args, ExtrudeGroupSet,
    },
};

/// A tag for a face.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema, FromStr, Display)]
#[ts(export)]
#[serde(rename_all = "snake_case", untagged)]
#[display("{0}")]
pub enum FaceTag {
    StartOrEnd(StartOrEnd),
    /// A string tag for the face you want to sketch on.
    String(String),
}

impl FaceTag {
    /// Get the face id from the tag.
    pub fn get_face_id(
        &self,
        extrude_group: &ExtrudeGroup,
        args: &Args,
        must_be_planar: bool,
    ) -> Result<uuid::Uuid, KclError> {
        match self {
            FaceTag::String(ref s) => args.get_adjacent_face_to_tag(extrude_group, s, must_be_planar),
            FaceTag::StartOrEnd(StartOrEnd::Start) => extrude_group.start_cap_id.ok_or_else(|| {
                KclError::Type(KclErrorDetails {
                    message: "Expected a start face".to_string(),
                    source_ranges: vec![args.source_range],
                })
            }),
            FaceTag::StartOrEnd(StartOrEnd::End) => extrude_group.end_cap_id.ok_or_else(|| {
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
pub async fn line_to(args: Args) -> Result<MemoryItem, KclError> {
    let (to, sketch_group, tag): ([f64; 2], Box<SketchGroup>, Option<String>) =
        args.get_data_and_sketch_group_and_tag()?;

    let new_sketch_group = inner_line_to(to, sketch_group, tag, args).await?;
    Ok(MemoryItem::SketchGroup(new_sketch_group))
}

/// Draw a line to a point.
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
    sketch_group: Box<SketchGroup>,
    tag: Option<String>,
    args: Args,
) -> Result<Box<SketchGroup>, KclError> {
    let from = sketch_group.current_pen_position()?;
    let id = uuid::Uuid::new_v4();

    args.batch_modeling_cmd(
        id,
        ModelingCmd::ExtendPath {
            path: sketch_group.id,
            segment: kittycad::types::PathSegment::Line {
                end: Point3D {
                    x: to[0],
                    y: to[1],
                    z: 0.0,
                },
                relative: false,
            },
        },
    )
    .await?;

    let current_path = Path::ToPoint {
        base: BasePath {
            from: from.into(),
            to,
            name: tag.unwrap_or("".to_string()),
            geo_meta: GeoMeta {
                id,
                metadata: args.source_range.into(),
            },
        },
    };

    let mut new_sketch_group = sketch_group.clone();
    new_sketch_group.value.push(current_path);

    Ok(new_sketch_group)
}

/// Draw a line to a point on the x-axis.
pub async fn x_line_to(args: Args) -> Result<MemoryItem, KclError> {
    let (to, sketch_group, tag): (f64, Box<SketchGroup>, Option<String>) = args.get_data_and_sketch_group_and_tag()?;

    let new_sketch_group = inner_x_line_to(to, sketch_group, tag, args).await?;
    Ok(MemoryItem::SketchGroup(new_sketch_group))
}

/// Draw a line to a point on the x-axis.
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
async fn inner_x_line_to(
    to: f64,
    sketch_group: Box<SketchGroup>,
    tag: Option<String>,
    args: Args,
) -> Result<Box<SketchGroup>, KclError> {
    let from = sketch_group.current_pen_position()?;

    let new_sketch_group = inner_line_to([to, from.y], sketch_group, tag, args).await?;

    Ok(new_sketch_group)
}

/// Draw a line to a point on the y-axis.
pub async fn y_line_to(args: Args) -> Result<MemoryItem, KclError> {
    let (to, sketch_group, tag): (f64, Box<SketchGroup>, Option<String>) = args.get_data_and_sketch_group_and_tag()?;

    let new_sketch_group = inner_y_line_to(to, sketch_group, tag, args).await?;
    Ok(MemoryItem::SketchGroup(new_sketch_group))
}

/// Draw a line to a point on the y-axis.
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
async fn inner_y_line_to(
    to: f64,
    sketch_group: Box<SketchGroup>,
    tag: Option<String>,
    args: Args,
) -> Result<Box<SketchGroup>, KclError> {
    let from = sketch_group.current_pen_position()?;

    let new_sketch_group = inner_line_to([from.x, to], sketch_group, tag, args).await?;
    Ok(new_sketch_group)
}

/// Draw a line.
pub async fn line(args: Args) -> Result<MemoryItem, KclError> {
    let (delta, sketch_group, tag): ([f64; 2], Box<SketchGroup>, Option<String>) =
        args.get_data_and_sketch_group_and_tag()?;

    let new_sketch_group = inner_line(delta, sketch_group, tag, args).await?;
    Ok(MemoryItem::SketchGroup(new_sketch_group))
}

/// Draw a line.
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
    sketch_group: Box<SketchGroup>,
    tag: Option<String>,
    args: Args,
) -> Result<Box<SketchGroup>, KclError> {
    let from = sketch_group.current_pen_position()?;
    let to = [from.x + delta[0], from.y + delta[1]];

    let id = uuid::Uuid::new_v4();

    args.batch_modeling_cmd(
        id,
        ModelingCmd::ExtendPath {
            path: sketch_group.id,
            segment: kittycad::types::PathSegment::Line {
                end: Point3D {
                    x: delta[0],
                    y: delta[1],
                    z: 0.0,
                },
                relative: true,
            },
        },
    )
    .await?;

    let current_path = Path::ToPoint {
        base: BasePath {
            from: from.into(),
            to,
            name: tag.unwrap_or("".to_string()),
            geo_meta: GeoMeta {
                id,
                metadata: args.source_range.into(),
            },
        },
    };

    let mut new_sketch_group = sketch_group.clone();
    new_sketch_group.value.push(current_path);

    Ok(new_sketch_group)
}

/// Draw a line on the x-axis.
pub async fn x_line(args: Args) -> Result<MemoryItem, KclError> {
    let (length, sketch_group, tag): (f64, Box<SketchGroup>, Option<String>) =
        args.get_data_and_sketch_group_and_tag()?;

    let new_sketch_group = inner_x_line(length, sketch_group, tag, args).await?;
    Ok(MemoryItem::SketchGroup(new_sketch_group))
}

/// Draw a line on the x-axis.
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
async fn inner_x_line(
    length: f64,
    sketch_group: Box<SketchGroup>,
    tag: Option<String>,
    args: Args,
) -> Result<Box<SketchGroup>, KclError> {
    inner_line([length, 0.0], sketch_group, tag, args).await
}

/// Draw a line on the y-axis.
pub async fn y_line(args: Args) -> Result<MemoryItem, KclError> {
    let (length, sketch_group, tag): (f64, Box<SketchGroup>, Option<String>) =
        args.get_data_and_sketch_group_and_tag()?;

    let new_sketch_group = inner_y_line(length, sketch_group, tag, args).await?;
    Ok(MemoryItem::SketchGroup(new_sketch_group))
}

/// Draw a line on the y-axis.
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
async fn inner_y_line(
    length: f64,
    sketch_group: Box<SketchGroup>,
    tag: Option<String>,
    args: Args,
) -> Result<Box<SketchGroup>, KclError> {
    inner_line([0.0, length], sketch_group, tag, args).await
}

/// Data to draw an angled line.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(rename_all = "camelCase", untagged)]
pub enum AngledLineData {
    /// An angle and length with explicitly named parameters
    AngleAndLengthNamed {
        /// The angle of the line.
        angle: f64,
        /// The length of the line.
        length: f64,
    },
    /// An angle and length given as a pair
    AngleAndLengthPair([f64; 2]),
}

/// Draw an angled line.
pub async fn angled_line(args: Args) -> Result<MemoryItem, KclError> {
    let (data, sketch_group, tag): (AngledLineData, Box<SketchGroup>, Option<String>) =
        args.get_data_and_sketch_group_and_tag()?;

    let new_sketch_group = inner_angled_line(data, sketch_group, tag, args).await?;
    Ok(MemoryItem::SketchGroup(new_sketch_group))
}

/// Draw an angled line.
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
    sketch_group: Box<SketchGroup>,
    tag: Option<String>,
    args: Args,
) -> Result<Box<SketchGroup>, KclError> {
    let from = sketch_group.current_pen_position()?;
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

    let current_path = Path::ToPoint {
        base: BasePath {
            from: from.into(),
            to,
            name: tag.unwrap_or("".to_string()),
            geo_meta: GeoMeta {
                id,
                metadata: args.source_range.into(),
            },
        },
    };

    args.batch_modeling_cmd(
        id,
        ModelingCmd::ExtendPath {
            path: sketch_group.id,
            segment: kittycad::types::PathSegment::Line {
                end: Point3D {
                    x: delta[0],
                    y: delta[1],
                    z: 0.0,
                },
                relative,
            },
        },
    )
    .await?;

    let mut new_sketch_group = sketch_group.clone();
    new_sketch_group.value.push(current_path);
    Ok(new_sketch_group)
}

/// Draw an angled line of a given x length.
pub async fn angled_line_of_x_length(args: Args) -> Result<MemoryItem, KclError> {
    let (data, sketch_group, tag): (AngledLineData, Box<SketchGroup>, Option<String>) =
        args.get_data_and_sketch_group_and_tag()?;

    let new_sketch_group = inner_angled_line_of_x_length(data, sketch_group, tag, args).await?;
    Ok(MemoryItem::SketchGroup(new_sketch_group))
}

/// Draw an angled line of a given x length.
///
/// ```no_run
/// const sketch001 = startSketchOn('XZ')
///   |> startProfileAt([0, 0], %)
///   |> angledLineOfXLength({ angle: 45, length: 10 }, %, "edge1")
///   |> angledLineOfXLength({ angle: -15, length: 20 }, %, "edge2")
///   |> line([0, -5], %)
///   |> close(%, "edge3")
///
/// const extrusion = extrude(10, sketch001)
/// ```
#[stdlib {
    name = "angledLineOfXLength",
}]
async fn inner_angled_line_of_x_length(
    data: AngledLineData,
    sketch_group: Box<SketchGroup>,
    tag: Option<String>,
    args: Args,
) -> Result<Box<SketchGroup>, KclError> {
    let (angle, length) = match data {
        AngledLineData::AngleAndLengthNamed { angle, length } => (angle, length),
        AngledLineData::AngleAndLengthPair(pair) => (pair[0], pair[1]),
    };

    let to = get_y_component(Angle::from_degrees(angle), length);

    let new_sketch_group = inner_line(to.into(), sketch_group, tag, args).await?;

    Ok(new_sketch_group)
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
pub async fn angled_line_to_x(args: Args) -> Result<MemoryItem, KclError> {
    let (data, sketch_group, tag): (AngledLineToData, Box<SketchGroup>, Option<String>) =
        args.get_data_and_sketch_group_and_tag()?;

    let new_sketch_group = inner_angled_line_to_x(data, sketch_group, tag, args).await?;
    Ok(MemoryItem::SketchGroup(new_sketch_group))
}

/// Draw an angled line to a given x coordinate.
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
    sketch_group: Box<SketchGroup>,
    tag: Option<String>,
    args: Args,
) -> Result<Box<SketchGroup>, KclError> {
    let from = sketch_group.current_pen_position()?;
    let AngledLineToData { angle, to: x_to } = data;

    let x_component = x_to - from.x;
    let y_component = x_component * f64::tan(angle.to_radians());
    let y_to = from.y + y_component;

    let new_sketch_group = inner_line_to([x_to, y_to], sketch_group, tag, args).await?;
    Ok(new_sketch_group)
}

/// Draw an angled line of a given y length.
pub async fn angled_line_of_y_length(args: Args) -> Result<MemoryItem, KclError> {
    let (data, sketch_group, tag): (AngledLineData, Box<SketchGroup>, Option<String>) =
        args.get_data_and_sketch_group_and_tag()?;

    let new_sketch_group = inner_angled_line_of_y_length(data, sketch_group, tag, args).await?;

    Ok(MemoryItem::SketchGroup(new_sketch_group))
}

/// Draw an angled line of a given y length.
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
    sketch_group: Box<SketchGroup>,
    tag: Option<String>,
    args: Args,
) -> Result<Box<SketchGroup>, KclError> {
    let (angle, length) = match data {
        AngledLineData::AngleAndLengthNamed { angle, length } => (angle, length),
        AngledLineData::AngleAndLengthPair(pair) => (pair[0], pair[1]),
    };

    let to = get_x_component(Angle::from_degrees(angle), length);

    let new_sketch_group = inner_line(to.into(), sketch_group, tag, args).await?;

    Ok(new_sketch_group)
}

/// Draw an angled line to a given y coordinate.
pub async fn angled_line_to_y(args: Args) -> Result<MemoryItem, KclError> {
    let (data, sketch_group, tag): (AngledLineToData, Box<SketchGroup>, Option<String>) =
        args.get_data_and_sketch_group_and_tag()?;

    let new_sketch_group = inner_angled_line_to_y(data, sketch_group, tag, args).await?;
    Ok(MemoryItem::SketchGroup(new_sketch_group))
}

/// Draw an angled line to a given y coordinate.
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
    sketch_group: Box<SketchGroup>,
    tag: Option<String>,
    args: Args,
) -> Result<Box<SketchGroup>, KclError> {
    let from = sketch_group.current_pen_position()?;
    let AngledLineToData { angle, to: y_to } = data;

    let y_component = y_to - from.y;
    let x_component = y_component / f64::tan(angle.to_radians());
    let x_to = from.x + x_component;

    let new_sketch_group = inner_line_to([x_to, y_to], sketch_group, tag, args).await?;
    Ok(new_sketch_group)
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
    pub intersect_tag: String,
    /// The offset from the intersecting line.
    pub offset: Option<f64>,
}

/// Draw an angled line that intersects with a given line.
pub async fn angled_line_that_intersects(args: Args) -> Result<MemoryItem, KclError> {
    let (data, sketch_group, tag): (AngledLineThatIntersectsData, Box<SketchGroup>, Option<String>) =
        args.get_data_and_sketch_group_and_tag()?;
    let new_sketch_group = inner_angled_line_that_intersects(data, sketch_group, tag, args).await?;
    Ok(MemoryItem::SketchGroup(new_sketch_group))
}

/// Draw an angled line that intersects with a given line.
///
/// ```no_run
/// const exampleSketch = startSketchOn('XZ')
///   |> startProfileAt([0, 0], %)
///   |> lineTo([5, 10], %)
///   |> lineTo([-10, 10], %, "lineToIntersect")
///   |> lineTo([0, 20], %)
///   |> angledLineThatIntersects({
///        angle: 80,
///        intersectTag: 'lineToIntersect',
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
    sketch_group: Box<SketchGroup>,
    tag: Option<String>,
    args: Args,
) -> Result<Box<SketchGroup>, KclError> {
    let intersect_path = sketch_group
        .get_path_by_name(&data.intersect_tag)
        .ok_or_else(|| {
            KclError::Type(KclErrorDetails {
                message: format!(
                    "Expected a line that exists in the given SketchGroup, found `{}`",
                    data.intersect_tag
                ),
                source_ranges: vec![args.source_range],
            })
        })?
        .get_base();

    let from = sketch_group.current_pen_position()?;
    let to = intersection_with_parallel_line(
        &[intersect_path.from.into(), intersect_path.to.into()],
        data.offset.unwrap_or_default(),
        data.angle,
        from,
    );

    let new_sketch_group = inner_line_to(to.into(), sketch_group, tag, args).await?;
    Ok(new_sketch_group)
}

/// Start a sketch at a given point.
pub async fn start_sketch_at(args: Args) -> Result<MemoryItem, KclError> {
    let data: [f64; 2] = args.get_data()?;

    let sketch_group = inner_start_sketch_at(data, args).await?;
    Ok(MemoryItem::SketchGroup(sketch_group))
}

/// Start a sketch at a given point on the 'XY' plane.
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
async fn inner_start_sketch_at(data: [f64; 2], args: Args) -> Result<Box<SketchGroup>, KclError> {
    // Let's assume it's the XY plane for now, this is just for backwards compatibility.
    let xy_plane = PlaneData::XY;
    let sketch_surface = inner_start_sketch_on(SketchData::Plane(xy_plane), None, args.clone()).await?;
    let sketch_group = inner_start_profile_at(data, sketch_surface, None, args).await?;
    Ok(sketch_group)
}

/// Data for start sketch on.
/// You can start a sketch on a plane or an extrude group.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(rename_all = "camelCase", untagged)]
pub enum SketchData {
    Plane(PlaneData),
    ExtrudeGroup(Box<ExtrudeGroup>),
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
        x_axis: Box<Point3d>,
        /// What should the plane’s Y axis be?
        y_axis: Box<Point3d>,
        /// The z-axis (normal).
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
pub async fn start_sketch_on(args: Args) -> Result<MemoryItem, KclError> {
    let (data, tag): (SketchData, Option<FaceTag>) = args.get_data_and_optional_tag()?;

    match inner_start_sketch_on(data, tag, args).await? {
        SketchSurface::Plane(plane) => Ok(MemoryItem::Plane(plane)),
        SketchSurface::Face(face) => Ok(MemoryItem::Face(face)),
    }
}

/// Start a sketch on a specific plane or face.
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
///   |> line([0, 10], %, 'sketchingFace')
///   |> line([-10, 0], %)
///   |> close(%)
///
/// const example = extrude(10, exampleSketch)
///
/// const exampleSketch002 = startSketchOn(example, 'sketchingFace')
///   |> startProfileAt([1, 1], %)
///   |> line([8, 0], %)
///   |> line([0, 8], %)
///   |> line([-8, 0], %)
///   |> close(%, 'sketchingFace002')
///
/// const example002 = extrude(10, exampleSketch002)
///
/// const exampleSketch003 = startSketchOn(example002, 'sketchingFace002')
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
///         x_axis: { x: 1, y: 0, z: 0 },
///         y_axis: { x: 0, y: 1, z: 0 },
///         z_axis: { x: 0, y: 0, z: 1 }
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
async fn inner_start_sketch_on(data: SketchData, tag: Option<FaceTag>, args: Args) -> Result<SketchSurface, KclError> {
    match data {
        SketchData::Plane(plane_data) => {
            let plane = start_sketch_on_plane(plane_data, args).await?;
            Ok(SketchSurface::Plane(plane))
        }
        SketchData::ExtrudeGroup(extrude_group) => {
            let Some(tag) = tag else {
                return Err(KclError::Type(KclErrorDetails {
                    message: "Expected a tag for the face to sketch on".to_string(),
                    source_ranges: vec![args.source_range],
                }));
            };
            let face = start_sketch_on_face(extrude_group, tag, args).await?;
            Ok(SketchSurface::Face(face))
        }
    }
}

async fn start_sketch_on_face(
    extrude_group: Box<ExtrudeGroup>,
    tag: FaceTag,
    args: Args,
) -> Result<Box<Face>, KclError> {
    let extrude_plane_id = tag.get_face_id(&extrude_group, &args, true)?;

    Ok(Box::new(Face {
        id: extrude_plane_id,
        value: tag.to_string(),
        // TODO: get this from the extrude plane data.
        x_axis: extrude_group.sketch_group.on.x_axis(),
        y_axis: extrude_group.sketch_group.on.y_axis(),
        z_axis: extrude_group.sketch_group.on.z_axis(),
        extrude_group,
        meta: vec![args.source_range.into()],
    }))
}

async fn start_sketch_on_plane(data: PlaneData, args: Args) -> Result<Box<Plane>, KclError> {
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
                ModelingCmd::MakePlane {
                    clobber: false,
                    origin: (*origin).into(),
                    size: 60.0,
                    x_axis: (*x_axis).into(),
                    y_axis: (*y_axis).into(),
                    hide: Some(true),
                },
            )
            .await?;

            id
        }
    };

    Ok(Box::new(plane))
}

/// Start a profile at a given point.
pub async fn start_profile_at(args: Args) -> Result<MemoryItem, KclError> {
    let (start, sketch_surface, tag): ([f64; 2], SketchSurface, Option<String>) = args.get_data_and_sketch_surface()?;

    let sketch_group = inner_start_profile_at(start, sketch_surface, tag, args).await?;
    Ok(MemoryItem::SketchGroup(sketch_group))
}

/// Start a profile at a given point.
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
    tag: Option<String>,
    args: Args,
) -> Result<Box<SketchGroup>, KclError> {
    if let SketchSurface::Face(face) = &sketch_surface {
        // Flush the batch for our fillets/chamfers if there are any.
        // If we do not do these for sketch on face, things will fail with face does not exist.
        args.flush_batch_for_extrude_group_set(&ExtrudeGroupSet::ExtrudeGroup(face.extrude_group.clone()))
            .await?;
    }

    // Enter sketch mode on the surface.
    // We call this here so you can reuse the sketch surface for multiple sketches.
    let id = uuid::Uuid::new_v4();
    args.batch_modeling_cmd(
        id,
        ModelingCmd::EnableSketchMode {
            animated: false,
            ortho: false,
            entity_id: sketch_surface.id(),
            adjust_camera: false,
            planar_normal: if let SketchSurface::Plane(plane) = &sketch_surface {
                // We pass in the normal for the plane here.
                Some(plane.z_axis.clone().into())
            } else {
                None
            },
        },
    )
    .await?;

    let id = uuid::Uuid::new_v4();
    let path_id = uuid::Uuid::new_v4();

    args.batch_modeling_cmd(path_id, ModelingCmd::StartPath {}).await?;
    args.batch_modeling_cmd(
        id,
        ModelingCmd::MovePathPen {
            path: path_id,
            to: Point3D {
                x: to[0],
                y: to[1],
                z: 0.0,
            },
        },
    )
    .await?;

    let current_path = BasePath {
        from: to,
        to,
        name: tag.unwrap_or("".to_string()),
        geo_meta: GeoMeta {
            id,
            metadata: args.source_range.into(),
        },
    };

    let sketch_group = SketchGroup {
        id: path_id,
        on: sketch_surface.clone(),
        value: vec![],
        start: current_path,
        meta: vec![args.source_range.into()],
    };
    Ok(Box::new(sketch_group))
}

/// Returns the X component of the sketch profile start point.
pub async fn profile_start_x(args: Args) -> Result<MemoryItem, KclError> {
    let sketch_group: Box<SketchGroup> = args.get_sketch_group()?;
    let x = inner_profile_start_x(sketch_group)?;
    args.make_user_val_from_f64(x)
}

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
pub(crate) fn inner_profile_start_x(sketch_group: Box<SketchGroup>) -> Result<f64, KclError> {
    Ok(sketch_group.start.to[0])
}

/// Returns the Y component of the sketch profile start point.
pub async fn profile_start_y(args: Args) -> Result<MemoryItem, KclError> {
    let sketch_group: Box<SketchGroup> = args.get_sketch_group()?;
    let x = inner_profile_start_y(sketch_group)?;
    args.make_user_val_from_f64(x)
}

/// ```no_run
/// const sketch001 = startSketchOn('XY')
///  |> startProfileAt([5, 2], %)
///  |> angledLine({ angle: -60, length: 14 }, %)
///  |> angledLineToY({ angle: 30, to: profileStartY(%) }, %)
/// ```
#[stdlib {
    name = "profileStartY"
}]
pub(crate) fn inner_profile_start_y(sketch_group: Box<SketchGroup>) -> Result<f64, KclError> {
    Ok(sketch_group.start.to[1])
}

/// Returns the sketch profile start point.
pub async fn profile_start(args: Args) -> Result<MemoryItem, KclError> {
    let sketch_group: Box<SketchGroup> = args.get_sketch_group()?;
    let point = inner_profile_start(sketch_group)?;
    Ok(MemoryItem::UserVal(UserVal {
        value: serde_json::to_value(point).map_err(|e| {
            KclError::Type(KclErrorDetails {
                message: format!("Failed to convert point to json: {}", e),
                source_ranges: vec![args.source_range],
            })
        })?,
        meta: Default::default(),
    }))
}

/// ```no_run
/// const sketch001 = startSketchOn('XY')
///  |> startProfileAt([5, 2], %)
///  |> angledLine({ angle: 120, length: 50 }, %, 'seg01')
///  |> angledLine({ angle: segAng('seg01', %) + 120, length: 50 }, %)
///  |> lineTo(profileStart(%), %)
///  |> close(%)
///  |> extrude(20, %)
/// ```
#[stdlib {
    name = "profileStart"
}]
pub(crate) fn inner_profile_start(sketch_group: Box<SketchGroup>) -> Result<[f64; 2], KclError> {
    Ok(sketch_group.start.to)
}

/// Close the current sketch.
pub async fn close(args: Args) -> Result<MemoryItem, KclError> {
    let (sketch_group, tag): (Box<SketchGroup>, Option<String>) = args.get_sketch_group_and_optional_tag()?;

    let new_sketch_group = inner_close(sketch_group, tag, args).await?;

    Ok(MemoryItem::SketchGroup(new_sketch_group))
}

/// Close the current sketch.
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
pub(crate) async fn inner_close(
    sketch_group: Box<SketchGroup>,
    tag: Option<String>,
    args: Args,
) -> Result<Box<SketchGroup>, KclError> {
    let from = sketch_group.current_pen_position()?;
    let to: Point2d = sketch_group.start.from.into();

    let id = uuid::Uuid::new_v4();

    args.batch_modeling_cmd(
        id,
        ModelingCmd::ClosePath {
            path_id: sketch_group.id,
        },
    )
    .await?;

    // If we are sketching on a plane we can close the sketch group now.
    if let SketchSurface::Plane(_) = sketch_group.on {
        // We were on a plane, disable the sketch mode.
        args.batch_modeling_cmd(uuid::Uuid::new_v4(), kittycad::types::ModelingCmd::SketchModeDisable {})
            .await?;
    }

    let mut new_sketch_group = sketch_group.clone();
    new_sketch_group.value.push(Path::ToPoint {
        base: BasePath {
            from: from.into(),
            to: to.into(),
            name: tag.unwrap_or_default(),
            geo_meta: GeoMeta {
                id,
                metadata: args.source_range.into(),
            },
        },
    });

    Ok(new_sketch_group)
}

/// Data to draw an arc.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(rename_all = "camelCase", untagged)]
pub enum ArcData {
    /// Angles and radius with an optional tag.
    AnglesAndRadius {
        /// The start angle.
        angle_start: f64,
        /// The end angle.
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
pub async fn arc(args: Args) -> Result<MemoryItem, KclError> {
    let (data, sketch_group, tag): (ArcData, Box<SketchGroup>, Option<String>) =
        args.get_data_and_sketch_group_and_tag()?;

    let new_sketch_group = inner_arc(data, sketch_group, tag, args).await?;
    Ok(MemoryItem::SketchGroup(new_sketch_group))
}

/// Draw an arc.
///
/// ```no_run
/// const exampleSketch = startSketchOn('XZ')
///   |> startProfileAt([0, 0], %)
///   |> line([10, 0], %)
///   |> arc({
///        angle_start: 0,
///        angle_end: 280,
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
    sketch_group: Box<SketchGroup>,
    tag: Option<String>,
    args: Args,
) -> Result<Box<SketchGroup>, KclError> {
    let from: Point2d = sketch_group.current_pen_position()?;

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

    let id = uuid::Uuid::new_v4();

    args.batch_modeling_cmd(
        id,
        ModelingCmd::ExtendPath {
            path: sketch_group.id,
            segment: kittycad::types::PathSegment::Arc {
                start: angle_start,
                end: angle_end,
                center: center.into(),
                radius,
                relative: false,
            },
        },
    )
    .await?;

    let current_path = Path::ToPoint {
        base: BasePath {
            from: from.into(),
            to: end.into(),
            name: tag.unwrap_or("".to_string()),
            geo_meta: GeoMeta {
                id,
                metadata: args.source_range.into(),
            },
        },
    };

    let mut new_sketch_group = sketch_group.clone();
    new_sketch_group.value.push(current_path);

    Ok(new_sketch_group)
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
    /// A point where the arc should end. Must lie in the same plane as the current path pen position. Must not be colinear with current path pen position.
    Point([f64; 2]),
}

/// Draw a tangential arc.
pub async fn tangential_arc(args: Args) -> Result<MemoryItem, KclError> {
    let (data, sketch_group, tag): (TangentialArcData, Box<SketchGroup>, Option<String>) =
        args.get_data_and_sketch_group_and_tag()?;

    let new_sketch_group = inner_tangential_arc(data, sketch_group, tag, args).await?;
    Ok(MemoryItem::SketchGroup(new_sketch_group))
}

/// Draw an arc.
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
    sketch_group: Box<SketchGroup>,
    tag: Option<String>,
    args: Args,
) -> Result<Box<SketchGroup>, KclError> {
    let from: Point2d = sketch_group.current_pen_position()?;

    let id = uuid::Uuid::new_v4();

    let to = match &data {
        TangentialArcData::RadiusAndOffset { radius, offset } => {
            // Calculate the end point from the angle and radius.
            let end_angle = Angle::from_degrees(*offset);
            let start_angle = Angle::from_degrees(0.0);
            let (_, to) = arc_center_and_end(from, start_angle, end_angle, *radius);

            args.batch_modeling_cmd(
                id,
                ModelingCmd::ExtendPath {
                    path: sketch_group.id,
                    segment: kittycad::types::PathSegment::TangentialArc {
                        radius: *radius,
                        offset: Angle {
                            unit: kittycad::types::UnitAngle::Degrees,
                            value: *offset,
                        },
                    },
                },
            )
            .await?;
            to.into()
        }
        TangentialArcData::Point(to) => {
            args.batch_modeling_cmd(id, tan_arc_to(&sketch_group, to)).await?;

            *to
        }
    };

    let to = [from.x + to[0], from.y + to[1]];

    let current_path = Path::TangentialArc {
        base: BasePath {
            from: from.into(),
            to,
            name: tag.unwrap_or("".to_string()),
            geo_meta: GeoMeta {
                id,
                metadata: args.source_range.into(),
            },
        },
    };

    let mut new_sketch_group = sketch_group.clone();
    new_sketch_group.value.push(current_path);

    Ok(new_sketch_group)
}

fn tan_arc_to(sketch_group: &SketchGroup, to: &[f64; 2]) -> ModelingCmd {
    ModelingCmd::ExtendPath {
        path: sketch_group.id,
        segment: kittycad::types::PathSegment::TangentialArcTo {
            angle_snap_increment: None,
            to: Point3D {
                x: to[0],
                y: to[1],
                z: 0.0,
            },
        },
    }
}

fn too_few_args(source_range: SourceRange) -> KclError {
    KclError::Syntax(KclErrorDetails {
        source_ranges: vec![source_range],
        message: "too few arguments".to_owned(),
    })
}

fn get_arg<I: Iterator>(it: &mut I, src: SourceRange) -> Result<I::Item, KclError> {
    it.next().ok_or_else(|| too_few_args(src))
}

/// Draw a tangential arc to a specific point.
pub async fn tangential_arc_to(args: Args) -> Result<MemoryItem, KclError> {
    let src = args.source_range;

    // Get arguments to function call
    let mut it = args.args.iter();
    let to: [f64; 2] = get_arg(&mut it, src)?.get_json()?;
    let sketch_group: Box<SketchGroup> = get_arg(&mut it, src)?.get_json()?;
    let tag = if let Ok(memory_item) = get_arg(&mut it, src) {
        memory_item.get_json_opt()?
    } else {
        None
    };

    let new_sketch_group = inner_tangential_arc_to(to, sketch_group, tag, args).await?;
    Ok(MemoryItem::SketchGroup(new_sketch_group))
}

/// Draw an arc.
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
    sketch_group: Box<SketchGroup>,
    tag: Option<String>,
    args: Args,
) -> Result<Box<SketchGroup>, KclError> {
    let from: Point2d = sketch_group.current_pen_position()?;
    let tangent_info = sketch_group.get_tangential_info_from_paths();
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
    args.batch_modeling_cmd(id, tan_arc_to(&sketch_group, &delta)).await?;

    let current_path = Path::TangentialArcTo {
        base: BasePath {
            from: from.into(),
            to,
            name: tag.unwrap_or_default(),
            geo_meta: GeoMeta {
                id,
                metadata: args.source_range.into(),
            },
        },
        center: result.center,
        ccw: result.ccw > 0,
    };

    let mut new_sketch_group = sketch_group.clone();
    new_sketch_group.value.push(current_path);

    Ok(new_sketch_group)
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
pub async fn bezier_curve(args: Args) -> Result<MemoryItem, KclError> {
    let (data, sketch_group, tag): (BezierData, Box<SketchGroup>, Option<String>) =
        args.get_data_and_sketch_group_and_tag()?;

    let new_sketch_group = inner_bezier_curve(data, sketch_group, tag, args).await?;
    Ok(MemoryItem::SketchGroup(new_sketch_group))
}

/// Draw a bezier curve.
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
    sketch_group: Box<SketchGroup>,
    tag: Option<String>,
    args: Args,
) -> Result<Box<SketchGroup>, KclError> {
    let from = sketch_group.current_pen_position()?;

    let relative = true;
    let delta = data.to;
    let to = [from.x + data.to[0], from.y + data.to[1]];

    let id = uuid::Uuid::new_v4();

    args.batch_modeling_cmd(
        id,
        ModelingCmd::ExtendPath {
            path: sketch_group.id,
            segment: kittycad::types::PathSegment::Bezier {
                control_1: Point3D {
                    x: data.control1[0],
                    y: data.control1[1],
                    z: 0.0,
                },
                control_2: Point3D {
                    x: data.control2[0],
                    y: data.control2[1],
                    z: 0.0,
                },
                end: Point3D {
                    x: delta[0],
                    y: delta[1],
                    z: 0.0,
                },
                relative,
            },
        },
    )
    .await?;

    let current_path = Path::ToPoint {
        base: BasePath {
            from: from.into(),
            to,
            name: tag.unwrap_or_default().to_string(),
            geo_meta: GeoMeta {
                id,
                metadata: args.source_range.into(),
            },
        },
    };

    let mut new_sketch_group = sketch_group.clone();
    new_sketch_group.value.push(current_path);

    Ok(new_sketch_group)
}

/// Use a sketch to cut a hole in another sketch.
pub async fn hole(args: Args) -> Result<MemoryItem, KclError> {
    let (hole_sketch_group, sketch_group): (SketchGroupSet, Box<SketchGroup>) = args.get_sketch_groups()?;

    let new_sketch_group = inner_hole(hole_sketch_group, sketch_group, args).await?;
    Ok(MemoryItem::SketchGroup(new_sketch_group))
}

/// Use a sketch to cut a hole in another sketch.
///
/// ```no_run
/// const exampleSketch = startSketchOn('XY')
///   |> startProfileAt([0, 0], %)
///   |> line([0, 5], %)
///   |> line([5, 0], %)
///   |> line([0, -5], %)
///   |> close(%)
///   |> hole(circle([1, 1], .25, %), %)
///   |> hole(circle([1, 4], .25, %), %)
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
///     |> circle([0, 0], 3, %)
///     |> hole(squareHoleSketch(), %)
///  const example = extrude(1, exampleSketch)
/// ```
#[stdlib {
    name = "hole",
}]
async fn inner_hole(
    hole_sketch_group: SketchGroupSet,
    sketch_group: Box<SketchGroup>,
    args: Args,
) -> Result<Box<SketchGroup>, KclError> {
    //TODO: batch these (once we have batch)

    match hole_sketch_group {
        SketchGroupSet::SketchGroup(hole_sketch_group) => {
            args.batch_modeling_cmd(
                uuid::Uuid::new_v4(),
                ModelingCmd::Solid2DAddHole {
                    object_id: sketch_group.id,
                    hole_id: hole_sketch_group.id,
                },
            )
            .await?;
            // suggestion (mike)
            // we also hide the source hole since its essentially "consumed" by this operation
            args.batch_modeling_cmd(
                uuid::Uuid::new_v4(),
                ModelingCmd::ObjectVisible {
                    object_id: hole_sketch_group.id,
                    hidden: true,
                },
            )
            .await?;
        }
        SketchGroupSet::SketchGroups(hole_sketch_groups) => {
            for hole_sketch_group in hole_sketch_groups {
                args.batch_modeling_cmd(
                    uuid::Uuid::new_v4(),
                    ModelingCmd::Solid2DAddHole {
                        object_id: sketch_group.id,
                        hole_id: hole_sketch_group.id,
                    },
                )
                .await?;
                // suggestion (mike)
                // we also hide the source hole since its essentially "consumed" by this operation
                args.batch_modeling_cmd(
                    uuid::Uuid::new_v4(),
                    ModelingCmd::ObjectVisible {
                        object_id: hole_sketch_group.id,
                        hidden: true,
                    },
                )
                .await?;
            }
        }
    }

    // TODO: should we modify the sketch group to include the hole data, probably?

    Ok(sketch_group)
}

#[cfg(test)]
mod tests {

    use pretty_assertions::assert_eq;

    use crate::std::sketch::PlaneData;

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

        str_json = "\"thing\"".to_string();
        let data: crate::std::sketch::FaceTag = serde_json::from_str(&str_json).unwrap();
        assert_eq!(data, crate::std::sketch::FaceTag::String("thing".to_string()));

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
