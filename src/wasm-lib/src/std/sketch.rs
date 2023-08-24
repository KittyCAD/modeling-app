//! Functions related to sketching.

use derive_docs::stdlib;
use kittycad::types::{ModelingCmd, Point3D};
use serde::{Deserialize, Serialize};

use crate::{
    errors::{KclError, KclErrorDetails},
    executor::{BasePath, GeoMeta, MemoryItem, Path, Point2d, Position, Rotation, SketchGroup},
    std::{
        utils::{get_x_component, get_y_component, intersection_with_parallel_line},
        Args,
    },
};

use anyhow::Result;

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS)]
#[ts(export)]
#[serde(rename_all = "camelCase", untagged)]
pub enum LineToData {
    PointWithTag { to: [f64; 2], tag: String },
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
fn inner_line_to(
    data: LineToData,
    sketch_group: SketchGroup,
    args: &Args,
) -> Result<SketchGroup, KclError> {
    let from = sketch_group.get_coords_from_paths()?;
    let to = match data {
        LineToData::PointWithTag { to, .. } => to,
        LineToData::Point(to) => to,
    };

    let id = uuid::Uuid::new_v4();
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

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS)]
#[ts(export)]
#[serde(rename_all = "camelCase", untagged)]
pub enum AxisLineToData {
    PointWithTag { to: f64, tag: String },
    Point(f64),
}

/// Draw a line to a point on the x-axis.
pub fn x_line_to(args: &mut Args) -> Result<MemoryItem, KclError> {
    let (data, sketch_group): (AxisLineToData, SketchGroup) = args.get_data_and_sketch_group()?;
    let from = sketch_group.get_coords_from_paths()?;

    let line_to_data = match data {
        AxisLineToData::PointWithTag { to, tag } => LineToData::PointWithTag {
            to: [to, from.y],
            tag,
        },
        AxisLineToData::Point(data) => LineToData::Point([data, from.y]),
    };

    let new_sketch_group = inner_line_to(line_to_data, sketch_group, args)?;
    Ok(MemoryItem::SketchGroup(new_sketch_group))
}

/// Draw a line to a point on the y-axis.
pub fn y_line_to(args: &mut Args) -> Result<MemoryItem, KclError> {
    let (data, sketch_group): (AxisLineToData, SketchGroup) = args.get_data_and_sketch_group()?;
    let from = sketch_group.get_coords_from_paths()?;

    let line_to_data = match data {
        AxisLineToData::PointWithTag { to, tag } => LineToData::PointWithTag {
            to: [from.x, to],
            tag,
        },
        AxisLineToData::Point(data) => LineToData::Point([from.x, data]),
    };

    let new_sketch_group = inner_line_to(line_to_data, sketch_group, args)?;
    Ok(MemoryItem::SketchGroup(new_sketch_group))
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS)]
#[ts(export)]
#[serde(rename_all = "camelCase", untagged)]
pub enum LineData {
    PointWithTag { to: PointOrDefault, tag: String },
    Point([f64; 2]),
    Default(String),
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS)]
#[ts(export)]
#[serde(rename_all = "camelCase", untagged)]
pub enum PointOrDefault {
    Point([f64; 2]),
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

fn inner_line(
    data: LineData,
    sketch_group: SketchGroup,
    args: &mut Args,
) -> Result<SketchGroup, KclError> {
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

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS)]
#[ts(export)]
#[serde(rename_all = "camelCase", untagged)]
pub enum AxisLineData {
    PointWithTag { length: f64, tag: String },
    Point(f64),
}

/// Draw a line on the x-axis.
pub fn x_line(args: &mut Args) -> Result<MemoryItem, KclError> {
    let (data, sketch_group): (AxisLineData, SketchGroup) = args.get_data_and_sketch_group()?;

    let line_data = match data {
        AxisLineData::PointWithTag { length, tag } => LineData::PointWithTag {
            to: PointOrDefault::Point([length, 0.0]),
            tag,
        },
        AxisLineData::Point(length) => LineData::Point([length, 0.0]),
    };

    let new_sketch_group = inner_line(line_data, sketch_group, args)?;
    Ok(MemoryItem::SketchGroup(new_sketch_group))
}

/// Draw a line on the y-axis.
pub fn y_line(args: &mut Args) -> Result<MemoryItem, KclError> {
    let (data, sketch_group): (AxisLineData, SketchGroup) = args.get_data_and_sketch_group()?;

    let line_data = match data {
        AxisLineData::PointWithTag { length, tag } => LineData::PointWithTag {
            to: PointOrDefault::Point([0.0, length]),
            tag,
        },
        AxisLineData::Point(length) => LineData::Point([0.0, length]),
    };

    let new_sketch_group = inner_line(line_data, sketch_group, args)?;
    Ok(MemoryItem::SketchGroup(new_sketch_group))
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS)]
#[ts(export)]
#[serde(rename_all = "camelCase", untagged)]
pub enum AngledLineData {
    AngleWithTag {
        angle: f64,
        length: f64,
        tag: String,
    },
    AngleAndLength([f64; 2]),
}

/// Draw an angled line.
pub fn angled_line(args: &mut Args) -> Result<MemoryItem, KclError> {
    let (data, sketch_group): (AngledLineData, SketchGroup) = args.get_data_and_sketch_group()?;

    let from = sketch_group.get_coords_from_paths()?;
    let (angle, length) = match &data {
        AngledLineData::AngleWithTag { angle, length, .. } => (*angle, *length),
        AngledLineData::AngleAndLength(angle_and_length) => {
            (angle_and_length[0], angle_and_length[1])
        }
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
    Ok(MemoryItem::SketchGroup(new_sketch_group))
}

/// Draw an angled line of a given x length.
pub fn angled_line_of_x_length(args: &mut Args) -> Result<MemoryItem, KclError> {
    let (data, sketch_group): (AngledLineData, SketchGroup) = args.get_data_and_sketch_group()?;

    let (angle, length) = match &data {
        AngledLineData::AngleWithTag { angle, length, .. } => (*angle, *length),
        AngledLineData::AngleAndLength(angle_and_length) => {
            (angle_and_length[0], angle_and_length[1])
        }
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

    Ok(MemoryItem::SketchGroup(new_sketch_group))
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS)]
#[ts(export)]
#[serde(rename_all = "camelCase", untagged)]
pub enum AngledLineToData {
    AngleWithTag { angle: f64, to: f64, tag: String },
    AngleAndPoint([f64; 2]),
}

/// Draw an angled line to a given x coordinate.
pub fn angled_line_to_x(args: &mut Args) -> Result<MemoryItem, KclError> {
    let (data, sketch_group): (AngledLineToData, SketchGroup) = args.get_data_and_sketch_group()?;

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
            LineToData::PointWithTag {
                to: [x_to, y_to],
                tag,
            }
        } else {
            LineToData::Point([x_to, y_to])
        },
        sketch_group,
        args,
    )?;
    Ok(MemoryItem::SketchGroup(new_sketch_group))
}

/// Draw an angled line of a given y length.
pub fn angled_line_of_y_length(args: &mut Args) -> Result<MemoryItem, KclError> {
    let (data, sketch_group): (AngledLineData, SketchGroup) = args.get_data_and_sketch_group()?;

    let (angle, length) = match &data {
        AngledLineData::AngleWithTag { angle, length, .. } => (*angle, *length),
        AngledLineData::AngleAndLength(angle_and_length) => {
            (angle_and_length[0], angle_and_length[1])
        }
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

    Ok(MemoryItem::SketchGroup(new_sketch_group))
}

/// Draw an angled line to a given y coordinate.
pub fn angled_line_to_y(args: &mut Args) -> Result<MemoryItem, KclError> {
    let (data, sketch_group): (AngledLineToData, SketchGroup) = args.get_data_and_sketch_group()?;

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
            LineToData::PointWithTag {
                to: [x_to, y_to],
                tag,
            }
        } else {
            LineToData::Point([x_to, y_to])
        },
        sketch_group,
        args,
    )?;
    Ok(MemoryItem::SketchGroup(new_sketch_group))
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS)]
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
    let (data, sketch_group): (AngeledLineThatIntersectsData, SketchGroup) =
        args.get_data_and_sketch_group()?;
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
    Ok(MemoryItem::SketchGroup(new_sketch_group))
}

/// Start a sketch at a given point.
pub fn start_sketch_at(args: &mut Args) -> Result<MemoryItem, KclError> {
    let data: LineData = args.get_data()?;

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
    Ok(MemoryItem::SketchGroup(sketch_group))
}

/// Close the current sketch.
pub fn close(args: &mut Args) -> Result<MemoryItem, KclError> {
    let sketch_group = args.get_sketch_group()?;
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

    Ok(MemoryItem::SketchGroup(new_sketch_group))
}

#[cfg(test)]
mod tests {

    use crate::std::sketch::{LineData, PointOrDefault};

    use pretty_assertions::assert_eq;

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
