//! Functions related to sketching.

use anyhow::Result;
use derive_docs::stdlib;
use kittycad::types::{ModelingCmd, Point3D};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::{
    errors::{KclError, KclErrorDetails},
    executor::{BasePath, GeoMeta, MemoryItem, Path, Point2d, Position, Rotation, SketchGroup},
    std::{
        utils::{arc_angles, arc_center_and_end, get_x_component, get_y_component, intersection_with_parallel_line},
        Args,
    },
};

/// Data to draw a line to a point.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(rename_all = "camelCase", untagged)]
pub enum LineToData {
    /// A point with a tag.
    PointWithTag {
        /// The to point.
        to: [f64; 2],
        /// The tag.
        tag: String,
    },
    /// A point.
    Point([f64; 2]),
}

/// Draw a line to a point.
pub fn line_to(args: &mut Args) -> Result<MemoryItem, KclError> {
    let (data, sketch_group): (LineToData, SketchGroup) = args.get_data_and_sketch_group()?;

    let new_sketch_group = inner_line_to(data, sketch_group, args)?;
    Ok(MemoryItem::SketchGroup(new_sketch_group))
}

/// Draw a line to a point.
#[stdlib {
    name = "lineTo",
}]
fn inner_line_to(data: LineToData, sketch_group: SketchGroup, args: &mut Args) -> Result<SketchGroup, KclError> {
    let from = sketch_group.get_coords_from_paths()?;
    let to = match data {
        LineToData::PointWithTag { to, .. } => to,
        LineToData::Point(to) => to,
    };

    let id = uuid::Uuid::new_v4();

    args.send_modeling_cmd(
        id,
        ModelingCmd::ExtendPath {
            path: sketch_group.id,
            segment: kittycad::types::PathSegment::Line {
                end: Point3D {
                    x: to[0],
                    y: to[1],
                    z: 0.0,
                },
            },
        },
    )?;

    let current_path = Path::ToPoint {
        base: BasePath {
            from: from.into(),
            to,
            name: if let LineToData::PointWithTag { tag, .. } = data {
                tag.to_string()
            } else {
                "".to_string()
            },
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

/// Data to draw a line to a point on an axis.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(rename_all = "camelCase", untagged)]
pub enum AxisLineToData {
    /// A point with a tag.
    PointWithTag {
        /// The to point.
        to: f64,
        /// The tag.
        tag: String,
    },
    /// A point.
    Point(f64),
}

/// Draw a line to a point on the x-axis.
pub fn x_line_to(args: &mut Args) -> Result<MemoryItem, KclError> {
    let (data, sketch_group): (AxisLineToData, SketchGroup) = args.get_data_and_sketch_group()?;

    let new_sketch_group = inner_x_line_to(data, sketch_group, args)?;
    Ok(MemoryItem::SketchGroup(new_sketch_group))
}

/// Draw a line to a point on the x-axis.
#[stdlib {
    name = "xLineTo",
}]
fn inner_x_line_to(data: AxisLineToData, sketch_group: SketchGroup, args: &mut Args) -> Result<SketchGroup, KclError> {
    let from = sketch_group.get_coords_from_paths()?;

    let line_to_data = match data {
        AxisLineToData::PointWithTag { to, tag } => LineToData::PointWithTag { to: [to, from.y], tag },
        AxisLineToData::Point(data) => LineToData::Point([data, from.y]),
    };

    let new_sketch_group = inner_line_to(line_to_data, sketch_group, args)?;

    Ok(new_sketch_group)
}

/// Draw a line to a point on the y-axis.
pub fn y_line_to(args: &mut Args) -> Result<MemoryItem, KclError> {
    let (data, sketch_group): (AxisLineToData, SketchGroup) = args.get_data_and_sketch_group()?;

    let new_sketch_group = inner_y_line_to(data, sketch_group, args)?;
    Ok(MemoryItem::SketchGroup(new_sketch_group))
}

/// Draw a line to a point on the y-axis.
#[stdlib {
    name = "yLineTo",
}]
fn inner_y_line_to(data: AxisLineToData, sketch_group: SketchGroup, args: &mut Args) -> Result<SketchGroup, KclError> {
    let from = sketch_group.get_coords_from_paths()?;

    let line_to_data = match data {
        AxisLineToData::PointWithTag { to, tag } => LineToData::PointWithTag { to: [from.x, to], tag },
        AxisLineToData::Point(data) => LineToData::Point([from.x, data]),
    };

    let new_sketch_group = inner_line_to(line_to_data, sketch_group, args)?;
    Ok(new_sketch_group)
}

/// Data to draw a line.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(rename_all = "camelCase", untagged)]
pub enum LineData {
    /// A point with a tag.
    PointWithTag {
        /// The to point.
        to: PointOrDefault,
        /// The tag.
        tag: String,
    },
    /// A point.
    Point([f64; 2]),
    /// A string like `default`.
    Default(String),
}

/// A point or a default value.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(rename_all = "camelCase", untagged)]
pub enum PointOrDefault {
    /// A point.
    Point([f64; 2]),
    /// A string like `default`.
    Default(String),
}

impl PointOrDefault {
    fn get_point_with_default(&self, default: [f64; 2]) -> [f64; 2] {
        match self {
            PointOrDefault::Point(point) => *point,
            PointOrDefault::Default(_) => default,
        }
    }
}

/// Draw a line.
pub fn line(args: &mut Args) -> Result<MemoryItem, KclError> {
    let (data, sketch_group): (LineData, SketchGroup) = args.get_data_and_sketch_group()?;

    let new_sketch_group = inner_line(data, sketch_group, args)?;
    Ok(MemoryItem::SketchGroup(new_sketch_group))
}

/// Draw a line.
#[stdlib {
    name = "line",
}]
fn inner_line(data: LineData, sketch_group: SketchGroup, args: &mut Args) -> Result<SketchGroup, KclError> {
    let from = sketch_group.get_coords_from_paths()?;

    let default = [0.2, 1.0];
    let inner_args = match &data {
        LineData::PointWithTag { to, .. } => to.get_point_with_default(default),
        LineData::Point(to) => *to,
        LineData::Default(_) => default,
    };

    let to = [from.x + inner_args[0], from.y + inner_args[1]];

    let id = uuid::Uuid::new_v4();

    args.send_modeling_cmd(
        id,
        ModelingCmd::ExtendPath {
            path: sketch_group.id,
            segment: kittycad::types::PathSegment::Line {
                end: Point3D {
                    x: to[0],
                    y: to[1],
                    z: 0.0,
                },
            },
        },
    )?;

    let current_path = Path::ToPoint {
        base: BasePath {
            from: from.into(),
            to,
            name: if let LineData::PointWithTag { tag, .. } = data {
                tag.to_string()
            } else {
                "".to_string()
            },
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

/// Data to draw a line on an axis.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(rename_all = "camelCase", untagged)]
pub enum AxisLineData {
    /// The length with a tag.
    LengthWithTag {
        /// The length of the line.
        length: f64,
        /// The tag.
        tag: String,
    },
    /// The length.
    Length(f64),
}

/// Draw a line on the x-axis.
pub fn x_line(args: &mut Args) -> Result<MemoryItem, KclError> {
    let (data, sketch_group): (AxisLineData, SketchGroup) = args.get_data_and_sketch_group()?;

    let new_sketch_group = inner_x_line(data, sketch_group, args)?;
    Ok(MemoryItem::SketchGroup(new_sketch_group))
}

/// Draw a line on the x-axis.
#[stdlib {
    name = "xLine",
}]
fn inner_x_line(data: AxisLineData, sketch_group: SketchGroup, args: &mut Args) -> Result<SketchGroup, KclError> {
    let line_data = match data {
        AxisLineData::LengthWithTag { length, tag } => LineData::PointWithTag {
            to: PointOrDefault::Point([length, 0.0]),
            tag,
        },
        AxisLineData::Length(length) => LineData::Point([length, 0.0]),
    };

    let new_sketch_group = inner_line(line_data, sketch_group, args)?;
    Ok(new_sketch_group)
}

/// Draw a line on the y-axis.
pub fn y_line(args: &mut Args) -> Result<MemoryItem, KclError> {
    let (data, sketch_group): (AxisLineData, SketchGroup) = args.get_data_and_sketch_group()?;

    let new_sketch_group = inner_y_line(data, sketch_group, args)?;
    Ok(MemoryItem::SketchGroup(new_sketch_group))
}

/// Draw a line on the y-axis.
#[stdlib {
    name = "yLine",
}]
fn inner_y_line(data: AxisLineData, sketch_group: SketchGroup, args: &mut Args) -> Result<SketchGroup, KclError> {
    let line_data = match data {
        AxisLineData::LengthWithTag { length, tag } => LineData::PointWithTag {
            to: PointOrDefault::Point([0.0, length]),
            tag,
        },
        AxisLineData::Length(length) => LineData::Point([0.0, length]),
    };

    let new_sketch_group = inner_line(line_data, sketch_group, args)?;
    Ok(new_sketch_group)
}

/// Data to draw an angled line.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(rename_all = "camelCase", untagged)]
pub enum AngledLineData {
    /// An angle and length with a tag.
    AngleWithTag {
        /// The angle of the line.
        angle: f64,
        /// The length of the line.
        length: f64,
        /// The tag.
        tag: String,
    },
    /// An angle and length.
    AngleAndLength([f64; 2]),
}

/// Draw an angled line.
pub fn angled_line(args: &mut Args) -> Result<MemoryItem, KclError> {
    let (data, sketch_group): (AngledLineData, SketchGroup) = args.get_data_and_sketch_group()?;

    let new_sketch_group = inner_angled_line(data, sketch_group, args)?;
    Ok(MemoryItem::SketchGroup(new_sketch_group))
}

/// Draw an angled line.
#[stdlib {
    name = "angledLine",
}]
fn inner_angled_line(
    data: AngledLineData,
    sketch_group: SketchGroup,
    args: &mut Args,
) -> Result<SketchGroup, KclError> {
    let from = sketch_group.get_coords_from_paths()?;
    let (angle, length) = match &data {
        AngledLineData::AngleWithTag { angle, length, .. } => (*angle, *length),
        AngledLineData::AngleAndLength(angle_and_length) => (angle_and_length[0], angle_and_length[1]),
    };
    let to: [f64; 2] = [
        from.x + length * f64::cos(angle * std::f64::consts::PI / 180.0),
        from.y + length * f64::sin(angle * std::f64::consts::PI / 180.0),
    ];

    let id = uuid::Uuid::new_v4();

    let current_path = Path::ToPoint {
        base: BasePath {
            from: from.into(),
            to,
            name: if let AngledLineData::AngleWithTag { tag, .. } = data {
                tag.to_string()
            } else {
                "".to_string()
            },
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

/// Draw an angled line of a given x length.
pub fn angled_line_of_x_length(args: &mut Args) -> Result<MemoryItem, KclError> {
    let (data, sketch_group): (AngledLineData, SketchGroup) = args.get_data_and_sketch_group()?;

    let new_sketch_group = inner_angled_line_of_x_length(data, sketch_group, args)?;
    Ok(MemoryItem::SketchGroup(new_sketch_group))
}

/// Draw an angled line of a given x length.
#[stdlib {
    name = "angledLineOfXLength",
}]
fn inner_angled_line_of_x_length(
    data: AngledLineData,
    sketch_group: SketchGroup,
    args: &mut Args,
) -> Result<SketchGroup, KclError> {
    let (angle, length) = match &data {
        AngledLineData::AngleWithTag { angle, length, .. } => (*angle, *length),
        AngledLineData::AngleAndLength(angle_and_length) => (angle_and_length[0], angle_and_length[1]),
    };

    let to = get_y_component(angle, length);

    let new_sketch_group = inner_line(
        if let AngledLineData::AngleWithTag { tag, .. } = data {
            LineData::PointWithTag {
                to: PointOrDefault::Point(to),
                tag,
            }
        } else {
            LineData::Point(to)
        },
        sketch_group,
        args,
    )?;

    Ok(new_sketch_group)
}

/// Data to draw an angled line to a point.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(rename_all = "camelCase", untagged)]
pub enum AngledLineToData {
    /// An angle and point with a tag.
    AngleWithTag {
        /// The angle of the line.
        angle: f64,
        /// The point to draw to.
        to: f64,
        /// The tag.
        tag: String,
    },
    /// An angle and point to draw to.
    AngleAndPoint([f64; 2]),
}

/// Draw an angled line to a given x coordinate.
pub fn angled_line_to_x(args: &mut Args) -> Result<MemoryItem, KclError> {
    let (data, sketch_group): (AngledLineToData, SketchGroup) = args.get_data_and_sketch_group()?;

    let new_sketch_group = inner_angled_line_to_x(data, sketch_group, args)?;
    Ok(MemoryItem::SketchGroup(new_sketch_group))
}

/// Draw an angled line to a given x coordinate.
#[stdlib {
    name = "angledLineToX",
}]
fn inner_angled_line_to_x(
    data: AngledLineToData,
    sketch_group: SketchGroup,
    args: &mut Args,
) -> Result<SketchGroup, KclError> {
    let from = sketch_group.get_coords_from_paths()?;
    let (angle, x_to) = match &data {
        AngledLineToData::AngleWithTag { angle, to, .. } => (*angle, *to),
        AngledLineToData::AngleAndPoint(angle_and_to) => (angle_and_to[0], angle_and_to[1]),
    };

    let x_component = x_to - from.x;
    let y_component = x_component * f64::tan(angle * std::f64::consts::PI / 180.0);
    let y_to = from.y + y_component;

    let new_sketch_group = inner_line_to(
        if let AngledLineToData::AngleWithTag { tag, .. } = data {
            LineToData::PointWithTag { to: [x_to, y_to], tag }
        } else {
            LineToData::Point([x_to, y_to])
        },
        sketch_group,
        args,
    )?;
    Ok(new_sketch_group)
}

/// Draw an angled line of a given y length.
pub fn angled_line_of_y_length(args: &mut Args) -> Result<MemoryItem, KclError> {
    let (data, sketch_group): (AngledLineData, SketchGroup) = args.get_data_and_sketch_group()?;

    let new_sketch_group = inner_angled_line_of_y_length(data, sketch_group, args)?;

    Ok(MemoryItem::SketchGroup(new_sketch_group))
}

/// Draw an angled line of a given y length.
#[stdlib {
    name = "angledLineOfYLength",
}]
fn inner_angled_line_of_y_length(
    data: AngledLineData,
    sketch_group: SketchGroup,
    args: &mut Args,
) -> Result<SketchGroup, KclError> {
    let (angle, length) = match &data {
        AngledLineData::AngleWithTag { angle, length, .. } => (*angle, *length),
        AngledLineData::AngleAndLength(angle_and_length) => (angle_and_length[0], angle_and_length[1]),
    };

    let to = get_x_component(angle, length);

    let new_sketch_group = inner_line(
        if let AngledLineData::AngleWithTag { tag, .. } = data {
            LineData::PointWithTag {
                to: PointOrDefault::Point(to),
                tag,
            }
        } else {
            LineData::Point(to)
        },
        sketch_group,
        args,
    )?;

    Ok(new_sketch_group)
}

/// Draw an angled line to a given y coordinate.
pub fn angled_line_to_y(args: &mut Args) -> Result<MemoryItem, KclError> {
    let (data, sketch_group): (AngledLineToData, SketchGroup) = args.get_data_and_sketch_group()?;

    let new_sketch_group = inner_angled_line_to_y(data, sketch_group, args)?;
    Ok(MemoryItem::SketchGroup(new_sketch_group))
}

/// Draw an angled line to a given y coordinate.
#[stdlib {
    name = "angledLineToY",
}]
fn inner_angled_line_to_y(
    data: AngledLineToData,
    sketch_group: SketchGroup,
    args: &mut Args,
) -> Result<SketchGroup, KclError> {
    let from = sketch_group.get_coords_from_paths()?;
    let (angle, y_to) = match &data {
        AngledLineToData::AngleWithTag { angle, to, .. } => (*angle, *to),
        AngledLineToData::AngleAndPoint(angle_and_to) => (angle_and_to[0], angle_and_to[1]),
    };

    let y_component = y_to - from.y;
    let x_component = y_component / f64::tan(angle * std::f64::consts::PI / 180.0);
    let x_to = from.x + x_component;

    let new_sketch_group = inner_line_to(
        if let AngledLineToData::AngleWithTag { tag, .. } = data {
            LineToData::PointWithTag { to: [x_to, y_to], tag }
        } else {
            LineToData::Point([x_to, y_to])
        },
        sketch_group,
        args,
    )?;
    Ok(new_sketch_group)
}

/// Data for drawing an angled line that intersects with a given line.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
// TODO: make sure the docs on the args below are correct.
pub struct AngeledLineThatIntersectsData {
    /// The angle of the line.
    pub angle: f64,
    /// The tag of the line to intersect with.
    pub intersect_tag: String,
    /// The offset from the intersecting line.
    pub offset: Option<f64>,
    /// The tag.
    pub tag: Option<String>,
}

/// Draw an angled line that intersects with a given line.
pub fn angled_line_that_intersects(args: &mut Args) -> Result<MemoryItem, KclError> {
    let (data, sketch_group): (AngeledLineThatIntersectsData, SketchGroup) = args.get_data_and_sketch_group()?;
    let new_sketch_group = inner_angled_line_that_intersects(data, sketch_group, args)?;
    Ok(MemoryItem::SketchGroup(new_sketch_group))
}

/// Draw an angled line that intersects with a given line.
#[stdlib {
    name = "angledLineThatIntersects",
}]
fn inner_angled_line_that_intersects(
    data: AngeledLineThatIntersectsData,
    sketch_group: SketchGroup,
    args: &mut Args,
) -> Result<SketchGroup, KclError> {
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

    let from = sketch_group.get_coords_from_paths()?;
    let to = intersection_with_parallel_line(
        &[intersect_path.from, intersect_path.to],
        data.offset.unwrap_or_default(),
        data.angle,
        from.into(),
    );

    let line_to_data = if let Some(tag) = data.tag {
        LineToData::PointWithTag { to, tag }
    } else {
        LineToData::Point(to)
    };

    let new_sketch_group = inner_line_to(line_to_data, sketch_group, args)?;
    Ok(new_sketch_group)
}

/// Start a sketch at a given point.
pub fn start_sketch_at(args: &mut Args) -> Result<MemoryItem, KclError> {
    let data: LineData = args.get_data()?;

    let sketch_group = inner_start_sketch_at(data, args)?;
    Ok(MemoryItem::SketchGroup(sketch_group))
}

/// Start a sketch at a given point.
#[stdlib {
    name = "startSketchAt",
}]
fn inner_start_sketch_at(data: LineData, args: &mut Args) -> Result<SketchGroup, KclError> {
    let default = [0.0, 0.0];
    let to = match &data {
        LineData::PointWithTag { to, .. } => to.get_point_with_default(default),
        LineData::Point(to) => *to,
        LineData::Default(_) => default,
    };

    let id = uuid::Uuid::new_v4();
    let path_id = uuid::Uuid::new_v4();

    args.send_modeling_cmd(path_id, ModelingCmd::StartPath {})?;
    args.send_modeling_cmd(
        id,
        ModelingCmd::MovePathPen {
            path: path_id,
            to: Point3D {
                x: to[0],
                y: to[1],
                z: 0.0,
            },
        },
    )?;

    let current_path = BasePath {
        from: to,
        to,
        name: if let LineData::PointWithTag { tag, .. } = data {
            tag.to_string()
        } else {
            "".to_string()
        },
        geo_meta: GeoMeta {
            id,
            metadata: args.source_range.into(),
        },
    };

    let sketch_group = SketchGroup {
        id: path_id,
        position: Position([0.0, 0.0, 0.0]),
        rotation: Rotation([0.0, 0.0, 0.0, 1.0]),
        value: vec![],
        start: current_path,
        meta: vec![args.source_range.into()],
    };
    Ok(sketch_group)
}

/// Close the current sketch.
pub fn close(args: &mut Args) -> Result<MemoryItem, KclError> {
    let sketch_group = args.get_sketch_group()?;

    let new_sketch_group = inner_close(sketch_group, args)?;

    Ok(MemoryItem::SketchGroup(new_sketch_group))
}

/// Close the current sketch.
#[stdlib {
    name = "close",
}]
fn inner_close(sketch_group: SketchGroup, args: &mut Args) -> Result<SketchGroup, KclError> {
    let from = sketch_group.get_coords_from_paths()?;
    let to: Point2d = sketch_group.start.from.into();

    let id = uuid::Uuid::new_v4();

    args.send_modeling_cmd(
        id,
        ModelingCmd::ClosePath {
            path_id: sketch_group.id,
        },
    )?;

    let mut new_sketch_group = sketch_group.clone();
    new_sketch_group.value.push(Path::ToPoint {
        base: BasePath {
            from: from.into(),
            to: to.into(),
            // TODO: should we use a different name?
            name: "".into(),
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
    /// Angles and radius with a tag.
    AnglesAndRadiusWithTag {
        /// The start angle.
        angle_start: f64,
        /// The end angle.
        angle_end: f64,
        /// The radius.
        radius: f64,
        /// The tag.
        tag: String,
    },
    /// Angles and radius.
    AnglesAndRadius {
        /// The start angle.
        angle_start: f64,
        /// The end angle.
        angle_end: f64,
        /// The radius.
        radius: f64,
    },
    /// Center, to and radius with a tag.
    CenterToRadiusWithTag {
        /// The center.
        center: [f64; 2],
        /// The to point.
        to: [f64; 2],
        /// The radius.
        radius: f64,
        /// The tag.
        tag: String,
    },
    /// Center, to and radius.
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
pub fn arc(args: &mut Args) -> Result<MemoryItem, KclError> {
    let (data, sketch_group): (ArcData, SketchGroup) = args.get_data_and_sketch_group()?;

    let new_sketch_group = inner_arc(data, sketch_group, args)?;
    Ok(MemoryItem::SketchGroup(new_sketch_group))
}

/// Draw an arc.
#[stdlib {
    name = "arc",
}]
fn inner_arc(data: ArcData, sketch_group: SketchGroup, args: &mut Args) -> Result<SketchGroup, KclError> {
    let from = sketch_group.get_coords_from_paths()?;

    let (center, angle_start, angle_end, radius, end) = match &data {
        ArcData::AnglesAndRadiusWithTag {
            angle_start,
            angle_end,
            radius,
            ..
        } => {
            let (center, end) = arc_center_and_end(&from, *angle_start, *angle_end, *radius);
            (center, *angle_start, *angle_end, *radius, end)
        }
        ArcData::AnglesAndRadius {
            angle_start,
            angle_end,
            radius,
        } => {
            let (center, end) = arc_center_and_end(&from, *angle_start, *angle_end, *radius);
            (center, *angle_start, *angle_end, *radius, end)
        }
        ArcData::CenterToRadiusWithTag { center, to, radius, .. } => {
            let (angle_start, angle_end) = arc_angles(&from, &center.into(), &to.into(), *radius, args.source_range)?;
            (center.into(), angle_start, angle_end, *radius, to.into())
        }
        ArcData::CenterToRadius { center, to, radius } => {
            let (angle_start, angle_end) = arc_angles(&from, &center.into(), &to.into(), *radius, args.source_range)?;
            (center.into(), angle_start, angle_end, *radius, to.into())
        }
    };

    let id = uuid::Uuid::new_v4();

    args.send_modeling_cmd(
        id,
        ModelingCmd::ExtendPath {
            path: sketch_group.id,
            segment: kittycad::types::PathSegment::Arc {
                angle_start,
                angle_end,
                center: center.into(),
                radius,
            },
        },
    )?;
    // Move the path pen to the end of the arc.
    // Since that is where we want to draw the next path.
    // TODO: the engine should automatically move the pen to the end of the arc.
    // This just seems inefficient.
    args.send_modeling_cmd(
        id,
        ModelingCmd::MovePathPen {
            path: sketch_group.id,
            to: Point3D {
                x: end.x,
                y: end.y,
                z: 0.0,
            },
        },
    )?;

    let current_path = Path::ToPoint {
        base: BasePath {
            from: from.into(),
            to: end.into(),
            name: match data {
                ArcData::AnglesAndRadiusWithTag { tag, .. } => tag.to_string(),
                ArcData::AnglesAndRadius { .. } => "".to_string(),
                ArcData::CenterToRadiusWithTag { tag, .. } => tag.to_string(),
                ArcData::CenterToRadius { .. } => "".to_string(),
            },
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

/// Data to draw a bezier curve.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(rename_all = "camelCase", untagged)]
pub enum BezierData {
    /// Points with a tag.
    PointsWithTag {
        /// The to point.
        to: [f64; 2],
        /// The first control point.
        control1: [f64; 2],
        /// The second control point.
        control2: [f64; 2],
        /// The tag.
        tag: String,
    },
    /// Points.
    Points {
        /// The to point.
        to: [f64; 2],
        /// The first control point.
        control1: [f64; 2],
        /// The second control point.
        control2: [f64; 2],
    },
}

/// Draw a bezier curve.
pub fn bezier_curve(args: &mut Args) -> Result<MemoryItem, KclError> {
    let (data, sketch_group): (BezierData, SketchGroup) = args.get_data_and_sketch_group()?;

    let new_sketch_group = inner_bezier_curve(data, sketch_group, args)?;
    Ok(MemoryItem::SketchGroup(new_sketch_group))
}

/// Draw a bezier curve.
#[stdlib {
    name = "bezierCurve",
}]
fn inner_bezier_curve(data: BezierData, sketch_group: SketchGroup, args: &mut Args) -> Result<SketchGroup, KclError> {
    let from = sketch_group.get_coords_from_paths()?;

    let (to, control1, control2) = match &data {
        BezierData::PointsWithTag {
            to, control1, control2, ..
        } => (to, control1, control2),
        BezierData::Points { to, control1, control2 } => (to, control1, control2),
    };

    let to = [from.x + to[0], from.y + to[1]];

    let id = uuid::Uuid::new_v4();

    args.send_modeling_cmd(
        id,
        ModelingCmd::ExtendPath {
            path: sketch_group.id,
            segment: kittycad::types::PathSegment::Bezier {
                control1: Point3D {
                    x: from.x + control1[0],
                    y: from.y + control1[1],
                    z: 0.0,
                },
                control2: Point3D {
                    x: from.x + control2[0],
                    y: from.y + control2[1],
                    z: 0.0,
                },
                end: Point3D {
                    x: to[0],
                    y: to[1],
                    z: 0.0,
                },
            },
        },
    )?;

    let current_path = Path::ToPoint {
        base: BasePath {
            from: from.into(),
            to,
            name: if let BezierData::PointsWithTag { tag, .. } = data {
                tag.to_string()
            } else {
                "".to_string()
            },
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

#[cfg(test)]
mod tests {

    use pretty_assertions::assert_eq;

    use crate::std::sketch::{LineData, PointOrDefault};

    #[test]
    fn test_deserialize_line_data() {
        let mut str_json = "\"default\"".to_string();
        let data: LineData = serde_json::from_str(&str_json).unwrap();
        assert_eq!(data, LineData::Default("default".to_string()));

        let data = LineData::Point([0.0, 1.0]);
        str_json = serde_json::to_string(&data).unwrap();
        assert_eq!(str_json, "[0.0,1.0]");

        str_json = "[0, 1]".to_string();
        let data: LineData = serde_json::from_str(&str_json).unwrap();
        assert_eq!(data, LineData::Point([0.0, 1.0]));

        str_json = "{ \"to\": [0.0, 1.0], \"tag\": \"thing\" }".to_string();
        let data: LineData = serde_json::from_str(&str_json).unwrap();
        assert_eq!(
            data,
            LineData::PointWithTag {
                to: PointOrDefault::Point([0.0, 1.0]),
                tag: "thing".to_string()
            }
        );
    }
}
