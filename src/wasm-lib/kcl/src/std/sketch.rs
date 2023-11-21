//! Functions related to sketching.

use anyhow::Result;
use derive_docs::stdlib;
use kittycad::types::{Angle, ModelingCmd, Point3D};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use std::fmt::Formatter;

use crate::executor::SourceRange;
use crate::{
    errors::{KclError, KclErrorDetails},
    executor::{
        BasePath, GeoMeta, MemoryItem, Path, Plane, PlaneType, Point2d, Point3d, Position, Rotation, SketchGroup,
    },
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
pub async fn line_to(args: Args) -> Result<MemoryItem, KclError> {
    let (data, sketch_group): (LineToData, Box<SketchGroup>) = args.get_data_and_sketch_group()?;

    let new_sketch_group = inner_line_to(data, sketch_group, args).await?;
    Ok(MemoryItem::SketchGroup(new_sketch_group))
}

/// Draw a line to a point.
#[stdlib {
    name = "lineTo",
}]
async fn inner_line_to(
    data: LineToData,
    sketch_group: Box<SketchGroup>,
    args: Args,
) -> Result<Box<SketchGroup>, KclError> {
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
                relative: false,
            },
        },
    )
    .await?;

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
pub async fn x_line_to(args: Args) -> Result<MemoryItem, KclError> {
    let (data, sketch_group): (AxisLineToData, Box<SketchGroup>) = args.get_data_and_sketch_group()?;

    let new_sketch_group = inner_x_line_to(data, sketch_group, args).await?;
    Ok(MemoryItem::SketchGroup(new_sketch_group))
}

/// Draw a line to a point on the x-axis.
#[stdlib {
    name = "xLineTo",
}]
async fn inner_x_line_to(
    data: AxisLineToData,
    sketch_group: Box<SketchGroup>,
    args: Args,
) -> Result<Box<SketchGroup>, KclError> {
    let from = sketch_group.get_coords_from_paths()?;

    let line_to_data = match data {
        AxisLineToData::PointWithTag { to, tag } => LineToData::PointWithTag { to: [to, from.y], tag },
        AxisLineToData::Point(data) => LineToData::Point([data, from.y]),
    };

    let new_sketch_group = inner_line_to(line_to_data, sketch_group, args).await?;

    Ok(new_sketch_group)
}

/// Draw a line to a point on the y-axis.
pub async fn y_line_to(args: Args) -> Result<MemoryItem, KclError> {
    let (data, sketch_group): (AxisLineToData, Box<SketchGroup>) = args.get_data_and_sketch_group()?;

    let new_sketch_group = inner_y_line_to(data, sketch_group, args).await?;
    Ok(MemoryItem::SketchGroup(new_sketch_group))
}

/// Draw a line to a point on the y-axis.
#[stdlib {
    name = "yLineTo",
}]
async fn inner_y_line_to(
    data: AxisLineToData,
    sketch_group: Box<SketchGroup>,
    args: Args,
) -> Result<Box<SketchGroup>, KclError> {
    let from = sketch_group.get_coords_from_paths()?;

    let line_to_data = match data {
        AxisLineToData::PointWithTag { to, tag } => LineToData::PointWithTag { to: [from.x, to], tag },
        AxisLineToData::Point(data) => LineToData::Point([from.x, data]),
    };

    let new_sketch_group = inner_line_to(line_to_data, sketch_group, args).await?;
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
        to: [f64; 2],
        /// The tag.
        tag: String,
    },
    /// A point.
    Point([f64; 2]),
}

/// Draw a line.
pub async fn line(args: Args) -> Result<MemoryItem, KclError> {
    let (data, sketch_group): (LineData, Box<SketchGroup>) = args.get_data_and_sketch_group()?;

    let new_sketch_group = inner_line(data, sketch_group, args).await?;
    Ok(MemoryItem::SketchGroup(new_sketch_group))
}

/// Draw a line.
#[stdlib {
    name = "line",
}]
async fn inner_line(data: LineData, sketch_group: Box<SketchGroup>, args: Args) -> Result<Box<SketchGroup>, KclError> {
    let from = sketch_group.get_coords_from_paths()?;
    let inner_args = match &data {
        LineData::PointWithTag { to, .. } => *to,
        LineData::Point(to) => *to,
    };

    let delta = inner_args;
    let to = [from.x + inner_args[0], from.y + inner_args[1]];

    let id = uuid::Uuid::new_v4();

    args.send_modeling_cmd(
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
pub async fn x_line(args: Args) -> Result<MemoryItem, KclError> {
    let (data, sketch_group): (AxisLineData, Box<SketchGroup>) = args.get_data_and_sketch_group()?;

    let new_sketch_group = inner_x_line(data, sketch_group, args).await?;
    Ok(MemoryItem::SketchGroup(new_sketch_group))
}

/// Draw a line on the x-axis.
#[stdlib {
    name = "xLine",
}]
async fn inner_x_line(
    data: AxisLineData,
    sketch_group: Box<SketchGroup>,
    args: Args,
) -> Result<Box<SketchGroup>, KclError> {
    let line_data = match data {
        AxisLineData::LengthWithTag { length, tag } => LineData::PointWithTag { to: [length, 0.0], tag },
        AxisLineData::Length(length) => LineData::Point([length, 0.0]),
    };

    let new_sketch_group = inner_line(line_data, sketch_group, args).await?;
    Ok(new_sketch_group)
}

/// Draw a line on the y-axis.
pub async fn y_line(args: Args) -> Result<MemoryItem, KclError> {
    let (data, sketch_group): (AxisLineData, Box<SketchGroup>) = args.get_data_and_sketch_group()?;

    let new_sketch_group = inner_y_line(data, sketch_group, args).await?;
    Ok(MemoryItem::SketchGroup(new_sketch_group))
}

/// Draw a line on the y-axis.
#[stdlib {
    name = "yLine",
}]
async fn inner_y_line(
    data: AxisLineData,
    sketch_group: Box<SketchGroup>,
    args: Args,
) -> Result<Box<SketchGroup>, KclError> {
    let line_data = match data {
        AxisLineData::LengthWithTag { length, tag } => LineData::PointWithTag { to: [0.0, length], tag },
        AxisLineData::Length(length) => LineData::Point([0.0, length]),
    };

    let new_sketch_group = inner_line(line_data, sketch_group, args).await?;
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

impl AngledLineData {
    pub fn into_inner_line(self, to: [f64; 2]) -> LineData {
        if let AngledLineData::AngleWithTag { tag, .. } = self {
            LineData::PointWithTag { to, tag }
        } else {
            LineData::Point(to)
        }
    }
}

/// Draw an angled line.
pub async fn angled_line(args: Args) -> Result<MemoryItem, KclError> {
    let (data, sketch_group): (AngledLineData, Box<SketchGroup>) = args.get_data_and_sketch_group()?;

    let new_sketch_group = inner_angled_line(data, sketch_group, args).await?;
    Ok(MemoryItem::SketchGroup(new_sketch_group))
}

/// Draw an angled line.
#[stdlib {
    name = "angledLine",
}]
async fn inner_angled_line(
    data: AngledLineData,
    sketch_group: Box<SketchGroup>,
    args: Args,
) -> Result<Box<SketchGroup>, KclError> {
    let from = sketch_group.get_coords_from_paths()?;
    let (angle, length) = match &data {
        AngledLineData::AngleWithTag { angle, length, .. } => (*angle, *length),
        AngledLineData::AngleAndLength(angle_and_length) => (angle_and_length[0], angle_and_length[1]),
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

    args.send_modeling_cmd(
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
    let (data, sketch_group): (AngledLineData, Box<SketchGroup>) = args.get_data_and_sketch_group()?;

    let new_sketch_group = inner_angled_line_of_x_length(data, sketch_group, args).await?;
    Ok(MemoryItem::SketchGroup(new_sketch_group))
}

/// Draw an angled line of a given x length.
#[stdlib {
    name = "angledLineOfXLength",
}]
async fn inner_angled_line_of_x_length(
    data: AngledLineData,
    sketch_group: Box<SketchGroup>,
    args: Args,
) -> Result<Box<SketchGroup>, KclError> {
    let (angle, length) = match &data {
        AngledLineData::AngleWithTag { angle, length, .. } => (*angle, *length),
        AngledLineData::AngleAndLength(angle_and_length) => (angle_and_length[0], angle_and_length[1]),
    };

    let to = get_y_component(Angle::from_degrees(angle), length);

    let new_sketch_group = inner_line(data.into_inner_line(to.into()), sketch_group, args).await?;

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

impl AngledLineToData {
    pub fn into_inner_line(self, x_to: f64, y_to: f64) -> LineToData {
        if let AngledLineToData::AngleWithTag { tag, .. } = self {
            LineToData::PointWithTag { to: [x_to, y_to], tag }
        } else {
            LineToData::Point([x_to, y_to])
        }
    }
}

/// Draw an angled line to a given x coordinate.
pub async fn angled_line_to_x(args: Args) -> Result<MemoryItem, KclError> {
    let (data, sketch_group): (AngledLineToData, Box<SketchGroup>) = args.get_data_and_sketch_group()?;

    let new_sketch_group = inner_angled_line_to_x(data, sketch_group, args).await?;
    Ok(MemoryItem::SketchGroup(new_sketch_group))
}

/// Draw an angled line to a given x coordinate.
#[stdlib {
    name = "angledLineToX",
}]
async fn inner_angled_line_to_x(
    data: AngledLineToData,
    sketch_group: Box<SketchGroup>,
    args: Args,
) -> Result<Box<SketchGroup>, KclError> {
    let from = sketch_group.get_coords_from_paths()?;
    let (angle, x_to) = match &data {
        AngledLineToData::AngleWithTag { angle, to, .. } => (*angle, *to),
        AngledLineToData::AngleAndPoint(angle_and_to) => (angle_and_to[0], angle_and_to[1]),
    };

    let x_component = x_to - from.x;
    let y_component = x_component * f64::tan(angle.to_radians());
    let y_to = from.y + y_component;

    let new_sketch_group = inner_line_to(data.into_inner_line(x_to, y_to), sketch_group, args).await?;
    Ok(new_sketch_group)
}

/// Draw an angled line of a given y length.
pub async fn angled_line_of_y_length(args: Args) -> Result<MemoryItem, KclError> {
    let (data, sketch_group): (AngledLineData, Box<SketchGroup>) = args.get_data_and_sketch_group()?;

    let new_sketch_group = inner_angled_line_of_y_length(data, sketch_group, args).await?;

    Ok(MemoryItem::SketchGroup(new_sketch_group))
}

/// Draw an angled line of a given y length.
#[stdlib {
    name = "angledLineOfYLength",
}]
async fn inner_angled_line_of_y_length(
    data: AngledLineData,
    sketch_group: Box<SketchGroup>,
    args: Args,
) -> Result<Box<SketchGroup>, KclError> {
    let (angle, length) = match &data {
        AngledLineData::AngleWithTag { angle, length, .. } => (*angle, *length),
        AngledLineData::AngleAndLength(angle_and_length) => (angle_and_length[0], angle_and_length[1]),
    };

    let to = get_x_component(Angle::from_degrees(angle), length);

    let new_sketch_group = inner_line(data.into_inner_line(to.into()), sketch_group, args).await?;

    Ok(new_sketch_group)
}

/// Draw an angled line to a given y coordinate.
pub async fn angled_line_to_y(args: Args) -> Result<MemoryItem, KclError> {
    let (data, sketch_group): (AngledLineToData, Box<SketchGroup>) = args.get_data_and_sketch_group()?;

    let new_sketch_group = inner_angled_line_to_y(data, sketch_group, args).await?;
    Ok(MemoryItem::SketchGroup(new_sketch_group))
}

/// Draw an angled line to a given y coordinate.
#[stdlib {
    name = "angledLineToY",
}]
async fn inner_angled_line_to_y(
    data: AngledLineToData,
    sketch_group: Box<SketchGroup>,
    args: Args,
) -> Result<Box<SketchGroup>, KclError> {
    let from = sketch_group.get_coords_from_paths()?;
    let (angle, y_to) = match &data {
        AngledLineToData::AngleWithTag { angle, to, .. } => (*angle, *to),
        AngledLineToData::AngleAndPoint(angle_and_to) => (angle_and_to[0], angle_and_to[1]),
    };

    let y_component = y_to - from.y;
    let x_component = y_component / f64::tan(angle.to_radians());
    let x_to = from.x + x_component;

    let new_sketch_group = inner_line_to(data.into_inner_line(x_to, y_to), sketch_group, args).await?;
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
    /// The tag.
    pub tag: Option<String>,
}

/// Draw an angled line that intersects with a given line.
pub async fn angled_line_that_intersects(args: Args) -> Result<MemoryItem, KclError> {
    let (data, sketch_group): (AngledLineThatIntersectsData, Box<SketchGroup>) = args.get_data_and_sketch_group()?;
    let new_sketch_group = inner_angled_line_that_intersects(data, sketch_group, args).await?;
    Ok(MemoryItem::SketchGroup(new_sketch_group))
}

/// Draw an angled line that intersects with a given line.
#[stdlib {
    name = "angledLineThatIntersects",
}]
async fn inner_angled_line_that_intersects(
    data: AngledLineThatIntersectsData,
    sketch_group: Box<SketchGroup>,
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

    let from = sketch_group.get_coords_from_paths()?;
    let to = intersection_with_parallel_line(
        &[intersect_path.from.into(), intersect_path.to.into()],
        data.offset.unwrap_or_default(),
        data.angle,
        from,
    );

    let line_to_data = if let Some(tag) = data.tag {
        LineToData::PointWithTag { to: to.into(), tag }
    } else {
        LineToData::Point(to.into())
    };

    let new_sketch_group = inner_line_to(line_to_data, sketch_group, args).await?;
    Ok(new_sketch_group)
}

/// Start a sketch at a given point.
pub async fn start_sketch_at(args: Args) -> Result<MemoryItem, KclError> {
    let data: LineData = args.get_data()?;

    let sketch_group = inner_start_sketch_at(data, args).await?;
    Ok(MemoryItem::SketchGroup(sketch_group))
}

/// Start a sketch at a given point on the 'XY' plane.
#[stdlib {
    name = "startSketchAt",
}]
async fn inner_start_sketch_at(data: LineData, args: Args) -> Result<Box<SketchGroup>, KclError> {
    // Let's assume it's the XY plane for now, this is just for backwards compatibility.
    let xy_plane = PlaneData::XY;
    let plane = inner_start_sketch_on(xy_plane, args.clone()).await?;
    let sketch_group = inner_start_profile_at(data, plane, args).await?;
    Ok(sketch_group)
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
                z_axis: Point3d::new(0.0, 1.0, 0.0),
                value: PlaneType::XZ,
                meta: vec![],
            },
            PlaneData::NegXZ => Plane {
                id,
                origin: Point3d::new(0.0, 0.0, 0.0),
                x_axis: Point3d::new(1.0, 0.0, 0.0),
                y_axis: Point3d::new(0.0, 0.0, 1.0),
                z_axis: Point3d::new(0.0, -1.0, 0.0),
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

/// Start a sketch on a specific plane.
pub async fn start_sketch_on(args: Args) -> Result<MemoryItem, KclError> {
    let data: PlaneData = args.get_data()?;

    let plane = inner_start_sketch_on(data, args).await?;
    Ok(MemoryItem::Plane(plane))
}

/// Start a sketch at a given point.
#[stdlib {
    name = "startSketchOn",
}]
async fn inner_start_sketch_on(data: PlaneData, args: Args) -> Result<Box<Plane>, KclError> {
    let mut plane: Plane = data.clone().into();

    plane.id = match data {
        PlaneData::XY | PlaneData::NegXY => args.ctx.planes.xy,
        PlaneData::XZ | PlaneData::NegXZ => args.ctx.planes.xz,
        PlaneData::YZ | PlaneData::NegYZ => args.ctx.planes.yz,
        PlaneData::Plane {
            origin,
            x_axis,
            y_axis,
            z_axis: _,
        } => {
            let id = uuid::Uuid::new_v4();
            // Create the plane.
            args.send_modeling_cmd(
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

    // Enter sketch mode on the plane.
    args.send_modeling_cmd(
        uuid::Uuid::new_v4(),
        ModelingCmd::SketchModeEnable {
            animated: false,
            ortho: false,
            plane_id: plane.id,
            // We pass in the normal for the plane here.
            disable_camera_with_plane: Some(plane.z_axis.clone().into()),
        },
    )
    .await?;

    Ok(Box::new(plane))
}

/// Start a profile at a given point.
pub async fn start_profile_at(args: Args) -> Result<MemoryItem, KclError> {
    let (data, plane): (LineData, Box<Plane>) = args.get_data_and_plane()?;

    let sketch_group = inner_start_profile_at(data, plane, args).await?;
    Ok(MemoryItem::SketchGroup(sketch_group))
}

/// Start a profile at a given point.
#[stdlib {
    name = "startProfileAt",
}]
async fn inner_start_profile_at(data: LineData, plane: Box<Plane>, args: Args) -> Result<Box<SketchGroup>, KclError> {
    let to = match &data {
        LineData::PointWithTag { to, .. } => *to,
        LineData::Point(to) => *to,
    };

    let id = uuid::Uuid::new_v4();
    let path_id = uuid::Uuid::new_v4();

    args.send_modeling_cmd(path_id, ModelingCmd::StartPath {}).await?;
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
    )
    .await?;

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
        plane_id: Some(plane.id),
        value: vec![],
        start: current_path,
        meta: vec![args.source_range.into()],
    };
    Ok(Box::new(sketch_group))
}

/// Close the current sketch.
pub async fn close(args: Args) -> Result<MemoryItem, KclError> {
    let sketch_group = args.get_sketch_group()?;

    let new_sketch_group = inner_close(sketch_group, args).await?;

    Ok(MemoryItem::SketchGroup(new_sketch_group))
}

/// Close the current sketch.
#[stdlib {
    name = "close",
}]
async fn inner_close(sketch_group: Box<SketchGroup>, args: Args) -> Result<Box<SketchGroup>, KclError> {
    let from = sketch_group.get_coords_from_paths()?;
    let to: Point2d = sketch_group.start.from.into();

    let id = uuid::Uuid::new_v4();

    args.send_modeling_cmd(
        id,
        ModelingCmd::ClosePath {
            path_id: sketch_group.id,
        },
    )
    .await?;

    // Exit sketch mode, since if we were in a plane we'd want to disable the sketch mode after.
    if sketch_group.plane_id.is_some() {
        // We were on a plane, disable the sketch mode.
        args.send_modeling_cmd(uuid::Uuid::new_v4(), ModelingCmd::SketchModeDisable {})
            .await?;
    }

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
pub async fn arc(args: Args) -> Result<MemoryItem, KclError> {
    let (data, sketch_group): (ArcData, Box<SketchGroup>) = args.get_data_and_sketch_group()?;

    let new_sketch_group = inner_arc(data, sketch_group, args).await?;
    Ok(MemoryItem::SketchGroup(new_sketch_group))
}

/// Draw an arc.
#[stdlib {
    name = "arc",
}]
async fn inner_arc(data: ArcData, sketch_group: Box<SketchGroup>, args: Args) -> Result<Box<SketchGroup>, KclError> {
    let from: Point2d = sketch_group.get_coords_from_paths()?;

    let (center, angle_start, angle_end, radius, end) = match &data {
        ArcData::AnglesAndRadiusWithTag {
            angle_start,
            angle_end,
            radius,
            ..
        } => {
            let a_start = Angle::from_degrees(*angle_start);
            let a_end = Angle::from_degrees(*angle_end);
            let (center, end) = arc_center_and_end(from, a_start, a_end, *radius);
            (center, a_start, a_end, *radius, end)
        }
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
        ArcData::CenterToRadiusWithTag { center, to, radius, .. } => {
            let (angle_start, angle_end) = arc_angles(from, center.into(), to.into(), *radius, args.source_range)?;
            (center.into(), angle_start, angle_end, *radius, to.into())
        }
        ArcData::CenterToRadius { center, to, radius } => {
            let (angle_start, angle_end) = arc_angles(from, center.into(), to.into(), *radius, args.source_range)?;
            (center.into(), angle_start, angle_end, *radius, to.into())
        }
    };

    let id = uuid::Uuid::new_v4();

    args.send_modeling_cmd(
        id,
        ModelingCmd::ExtendPath {
            path: sketch_group.id,
            segment: kittycad::types::PathSegment::Arc {
                angle_start: angle_start.degrees(),
                angle_end: angle_end.degrees(),
                start: Some(angle_start),
                end: Some(angle_end),
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
    /// A point with a tag.
    PointWithTag {
        /// Where the arc should end. Must lie in the same plane as the current path pen position. Must not be colinear with current path pen position.
        to: [f64; 2],
        /// The tag.
        tag: String,
    },
    /// A point where the arc should end. Must lie in the same plane as the current path pen position. Must not be colinear with current path pen position.
    Point([f64; 2]),
}

/// Draw a tangential arc.
pub async fn tangential_arc(args: Args) -> Result<MemoryItem, KclError> {
    let (data, sketch_group): (TangentialArcData, Box<SketchGroup>) = args.get_data_and_sketch_group()?;

    let new_sketch_group = inner_tangential_arc(data, sketch_group, args).await?;
    Ok(MemoryItem::SketchGroup(new_sketch_group))
}

/// Draw an arc.
#[stdlib {
    name = "tangentialArc",
}]
async fn inner_tangential_arc(
    data: TangentialArcData,
    sketch_group: Box<SketchGroup>,
    args: Args,
) -> Result<Box<SketchGroup>, KclError> {
    let from: Point2d = sketch_group.get_coords_from_paths()?;

    let id = uuid::Uuid::new_v4();

    let to = match &data {
        TangentialArcData::RadiusAndOffset { radius, offset } => {
            // Calculate the end point from the angle and radius.
            let end_angle = Angle::from_degrees(*offset);
            let start_angle = Angle::from_degrees(0.0);
            let (_, to) = arc_center_and_end(from, start_angle, end_angle, *radius);

            args.send_modeling_cmd(
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
        TangentialArcData::PointWithTag { to, .. } => {
            args.send_modeling_cmd(id, tan_arc_to(&sketch_group, to)).await?;

            *to
        }
        TangentialArcData::Point(to) => {
            args.send_modeling_cmd(id, tan_arc_to(&sketch_group, to)).await?;

            *to
        }
    };

    let to = [from.x + to[0], from.y + to[1]];

    let current_path = Path::ToPoint {
        base: BasePath {
            from: from.into(),
            to,
            name: "".to_string(),
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

/// Draw a tangential arc to a specific point.
pub async fn tangential_arc_to(args: Args) -> Result<MemoryItem, KclError> {
    let mut it = args.args.iter();
    let source_range = args.source_range;
    let to: [f64; 2] = it.next().ok_or_else(|| too_few_args(source_range))?.get_json()?;
    let sketch_group: Box<SketchGroup> = it.next().ok_or_else(|| too_few_args(source_range))?.get_json()?;
    let tag: Tag = if let Some(memory_item) = it.next() {
        memory_item.get_json()?
    } else {
        Default::default()
    };

    let new_sketch_group = inner_tangential_arc_to(Point2(to), sketch_group, tag, args).await?;
    Ok(MemoryItem::SketchGroup(new_sketch_group))
}

/// Wrapper which only exists because the stdlib macro cannot use [f64; 2] as an identifier.
#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, JsonSchema)]
#[serde(transparent)]
struct Point2(pub [f64; 2]);

/// Wrapper which only exists because the stdlib macro cannot use Option<String> as an identifier.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, JsonSchema, Default)]
#[serde(transparent)]
struct Tag(pub Option<String>);

impl std::fmt::Display for Tag {
    fn fmt(&self, f: &mut Formatter<'_>) -> std::fmt::Result {
        if let Some(tag) = &self.0 { tag } else { "" }.fmt(f)
    }
}

/// Draw an arc.
#[stdlib {
    name = "tangentialArcTo",
}]
async fn inner_tangential_arc_to(
    to: Point2,
    sketch_group: Box<SketchGroup>,
    tag: Tag,
    args: Args,
) -> Result<Box<SketchGroup>, KclError> {
    let from: Point2d = sketch_group.get_coords_from_paths()?;
    let to = to.0;

    let delta = [to[0] - from.x, to[1] - from.y];
    let id = uuid::Uuid::new_v4();
    args.send_modeling_cmd(id, tan_arc_to(&sketch_group, &delta)).await?;

    let current_path = Path::ToPoint {
        base: BasePath {
            from: from.into(),
            to,
            name: tag.to_string(),
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
pub async fn bezier_curve(args: Args) -> Result<MemoryItem, KclError> {
    let (data, sketch_group): (BezierData, Box<SketchGroup>) = args.get_data_and_sketch_group()?;

    let new_sketch_group = inner_bezier_curve(data, sketch_group, args).await?;
    Ok(MemoryItem::SketchGroup(new_sketch_group))
}

/// Draw a bezier curve.
#[stdlib {
    name = "bezierCurve",
}]
async fn inner_bezier_curve(
    data: BezierData,
    sketch_group: Box<SketchGroup>,
    args: Args,
) -> Result<Box<SketchGroup>, KclError> {
    let from = sketch_group.get_coords_from_paths()?;

    let (to, control1, control2) = match &data {
        BezierData::PointsWithTag {
            to, control1, control2, ..
        } => (to, control1, control2),
        BezierData::Points { to, control1, control2 } => (to, control1, control2),
    };

    let relative = true;
    let delta = to;
    let to = [from.x + to[0], from.y + to[1]];

    let id = uuid::Uuid::new_v4();

    args.send_modeling_cmd(
        id,
        ModelingCmd::ExtendPath {
            path: sketch_group.id,
            segment: kittycad::types::PathSegment::Bezier {
                control1: Point3D {
                    x: control1[0],
                    y: control1[1],
                    z: 0.0,
                },
                control2: Point3D {
                    x: control2[0],
                    y: control2[1],
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

/// Use a sketch to cut a hole in another sketch.
pub async fn hole(args: Args) -> Result<MemoryItem, KclError> {
    let (hole_sketch_group, sketch_group): (Box<SketchGroup>, Box<SketchGroup>) = args.get_sketch_groups()?;

    let new_sketch_group = inner_hole(hole_sketch_group, sketch_group, args).await?;
    Ok(MemoryItem::SketchGroup(new_sketch_group))
}

/// Use a sketch to cut a hole in another sketch.
#[stdlib {
    name = "hole",
}]
async fn inner_hole(
    hole_sketch_group: Box<SketchGroup>,
    sketch_group: Box<SketchGroup>,
    args: Args,
) -> Result<Box<SketchGroup>, KclError> {
    //TODO: batch these (once we have batch)

    args.send_modeling_cmd(
        uuid::Uuid::new_v4(),
        ModelingCmd::Solid2DAddHole {
            object_id: sketch_group.id,
            hole_id: hole_sketch_group.id,
        },
    )
    .await?;

    //suggestion (mike)
    //we also hide the source hole since its essentially "consumed" by this operation
    args.send_modeling_cmd(
        uuid::Uuid::new_v4(),
        ModelingCmd::ObjectVisible {
            object_id: hole_sketch_group.id,
            hidden: true,
        },
    )
    .await?;

    // TODO: should we modify the sketch group to include the hole data, probably?

    Ok(sketch_group)
}

#[cfg(test)]
mod tests {

    use pretty_assertions::assert_eq;

    use crate::std::sketch::{LineData, PlaneData};

    #[test]
    fn test_deserialize_line_data() {
        let data = LineData::Point([0.0, 1.0]);
        let mut str_json = serde_json::to_string(&data).unwrap();
        assert_eq!(str_json, "[0.0,1.0]");

        str_json = "[0, 1]".to_string();
        let data: LineData = serde_json::from_str(&str_json).unwrap();
        assert_eq!(data, LineData::Point([0.0, 1.0]));

        str_json = "{ \"to\": [0.0, 1.0], \"tag\": \"thing\" }".to_string();
        let data: LineData = serde_json::from_str(&str_json).unwrap();
        assert_eq!(
            data,
            LineData::PointWithTag {
                to: [0.0, 1.0],
                tag: "thing".to_string()
            }
        );
    }

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
}
