//! Standard library shapes.

use anyhow::Result;
use derive_docs::stdlib;
use kcmc::{
    each_cmd as mcmd,
    length_unit::LengthUnit,
    shared::{Angle, Point2d as KPoint2d},
    ModelingCmd,
};
use kittycad_modeling_cmds as kcmc;
use kittycad_modeling_cmds::shared::PathSegment;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::{
    ast::types::TagNode,
    errors::{KclError, KclErrorDetails},
    executor::{BasePath, ExecState, GeoMeta, KclValue, Path, Sketch, SketchSurface},
    std::Args,
};

/// A sketch surface or a sketch.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(untagged)]

pub enum SketchOrSurface {
    SketchSurface(SketchSurface),
    Sketch(Box<Sketch>),
}

/// Data for drawing an circle
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
// TODO: make sure the docs on the args below are correct.
pub struct CircleData {
    /// The center of the circle.
    pub center: [f64; 2],
    /// The circle radius
    pub radius: f64,
}

/// Sketch a circle.
pub async fn circle(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let (data, sketch_surface_or_group, tag): (CircleData, SketchOrSurface, Option<TagNode>) =
        args.get_circle_args()?;

    let sketch = inner_circle(data, sketch_surface_or_group, tag, exec_state, args).await?;
    Ok(KclValue::Sketch {
        value: Box::new(sketch),
    })
}

/// Construct a 2-dimensional circle, of the specified radius, centered at
/// the provided (x, y) origin point.
///
/// ```no_run
/// const exampleSketch = startSketchOn("-XZ")
///   |> circle({ center = [0, 0], radius = 10 }, %)
///
/// const example = extrude(5, exampleSketch)
/// ```
///
/// ```no_run
/// const exampleSketch = startSketchOn("XZ")
///   |> startProfileAt([-15, 0], %)
///   |> line([30, 0], %)
///   |> line([0, 30], %)
///   |> line([-30, 0], %)
///   |> close(%)
///   |> hole(circle({ center = [0, 15], radius = 5 }, %), %)
///
/// const example = extrude(5, exampleSketch)
/// ```
#[stdlib {
    name = "circle",
}]
async fn inner_circle(
    data: CircleData,
    sketch_surface_or_group: SketchOrSurface,
    tag: Option<TagNode>,
    exec_state: &mut ExecState,
    args: Args,
) -> Result<Sketch, KclError> {
    let sketch_surface = match sketch_surface_or_group {
        SketchOrSurface::SketchSurface(surface) => surface,
        SketchOrSurface::Sketch(group) => group.on,
    };
    let sketch = crate::std::sketch::inner_start_profile_at(
        [data.center[0] + data.radius, data.center[1]],
        sketch_surface,
        None,
        exec_state,
        args.clone(),
    )
    .await?;

    let angle_start = Angle::zero();
    let angle_end = Angle::turn();

    let id = exec_state.id_generator.next_uuid();

    args.batch_modeling_cmd(
        id,
        ModelingCmd::from(mcmd::ExtendPath {
            path: sketch.id.into(),
            segment: PathSegment::Arc {
                start: angle_start,
                end: angle_end,
                center: KPoint2d::from(data.center).map(LengthUnit),
                radius: data.radius.into(),
                relative: false,
            },
        }),
    )
    .await?;

    let current_path = Path::Circle {
        base: BasePath {
            from: data.center,
            to: data.center,
            tag: tag.clone(),
            geo_meta: GeoMeta {
                id,
                metadata: args.source_range.into(),
            },
        },
        radius: data.radius,
        center: data.center,
        ccw: angle_start.to_degrees() < angle_end.to_degrees(),
    };

    let mut new_sketch = sketch.clone();
    if let Some(tag) = &tag {
        new_sketch.add_tag(tag, &current_path);
    }

    new_sketch.paths.push(current_path);

    args.batch_modeling_cmd(id, ModelingCmd::from(mcmd::ClosePath { path_id: new_sketch.id }))
        .await?;

    Ok(new_sketch)
}

/// Type of the polygon
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema, Default)]
#[ts(export)]
#[serde(rename_all = "lowercase")]
pub enum PolygonType {
    #[default]
    Inscribed,
    Circumscribed,
}

/// Data for drawing a polygon
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct PolygonData {
    /// The radius of the polygon
    pub radius: f64,
    /// The number of sides in the polygon
    pub num_sides: u64,
    /// The center point of the polygon
    pub center: [f64; 2],
    /// The type of the polygon (inscribed or circumscribed)
    #[serde(skip)]
    pub polygon_type: PolygonType,
    /// Whether the polygon is inscribed (true) or circumscribed (false) about a circle with the specified radius
    #[serde(default = "default_inscribed")]
    pub inscribed: bool,
}

fn default_inscribed() -> bool {
    true
}

/// Create a regular polygon with the specified number of sides and radius.
pub async fn polygon(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let (data, sketch_surface_or_group, tag): (PolygonData, SketchOrSurface, Option<TagNode>) =
        args.get_polygon_args()?;

    let sketch = inner_polygon(data, sketch_surface_or_group, tag, exec_state, args).await?;
    Ok(KclValue::Sketch {
        value: Box::new(sketch),
    })
}

/// Create a regular polygon with the specified number of sides that is either inscribed or circumscribed around a circle of the specified radius.
///
/// ```no_run
/// // Create a regular hexagon inscribed in a circle of radius 10
/// hex = startSketchOn('XY')
///   |> polygon({
///     radius = 10,
///     numSides = 6,
///     center = [0, 0],
///     inscribed = true,
///   }, %)
///
/// example = extrude(5, hex)
/// ```
///
/// ```no_run
/// // Create a square circumscribed around a circle of radius 5
/// square = startSketchOn('XY')
///   |> polygon({
///     radius = 5.0,
///     numSides = 4,
///     center = [10, 10],
///     inscribed = false,
///   }, %)
/// example = extrude(5, square)
/// ```
#[stdlib {
    name = "polygon",
}]
async fn inner_polygon(
    data: PolygonData,
    sketch_surface_or_group: SketchOrSurface,
    tag: Option<TagNode>,
    exec_state: &mut ExecState,
    args: Args,
) -> Result<Sketch, KclError> {
    if data.num_sides < 3 {
        return Err(KclError::Type(KclErrorDetails {
            message: "Polygon must have at least 3 sides".to_string(),
            source_ranges: vec![args.source_range],
        }));
    }

    if data.radius <= 0.0 {
        return Err(KclError::Type(KclErrorDetails {
            message: "Radius must be greater than 0".to_string(),
            source_ranges: vec![args.source_range],
        }));
    }

    let sketch_surface = match sketch_surface_or_group {
        SketchOrSurface::SketchSurface(surface) => surface,
        SketchOrSurface::Sketch(group) => group.on,
    };

    let half_angle = std::f64::consts::PI / data.num_sides as f64;

    let radius_to_vertices = match data.polygon_type {
        PolygonType::Inscribed => data.radius,
        PolygonType::Circumscribed => data.radius / half_angle.cos(),
    };

    let angle_step = 2.0 * std::f64::consts::PI / data.num_sides as f64;

    let vertices: Vec<[f64; 2]> = (0..data.num_sides)
        .map(|i| {
            let angle = angle_step * i as f64;
            [
                data.center[0] + radius_to_vertices * angle.cos(),
                data.center[1] + radius_to_vertices * angle.sin(),
            ]
        })
        .collect();

    let mut sketch =
        crate::std::sketch::inner_start_profile_at(vertices[0], sketch_surface, None, exec_state, args.clone()).await?;

    // Draw all the lines with unique IDs and modified tags
    for vertex in vertices.iter().skip(1) {
        let from = sketch.current_pen_position()?;
        let id = exec_state.id_generator.next_uuid();

        args.batch_modeling_cmd(
            id,
            ModelingCmd::from(mcmd::ExtendPath {
                path: sketch.id.into(),
                segment: PathSegment::Line {
                    end: KPoint2d::from(*vertex).with_z(0.0).map(LengthUnit),
                    relative: false,
                },
            }),
        )
        .await?;

        let current_path = Path::ToPoint {
            base: BasePath {
                from: from.into(),
                to: *vertex,
                tag: tag.clone(),
                geo_meta: GeoMeta {
                    id,
                    metadata: args.source_range.into(),
                },
            },
        };

        if let Some(tag) = &tag {
            sketch.add_tag(tag, &current_path);
        }

        sketch.paths.push(current_path);
    }

    // Close the polygon by connecting back to the first vertex with a new ID
    let from = sketch.current_pen_position()?;
    let close_id = exec_state.id_generator.next_uuid();

    args.batch_modeling_cmd(
        close_id,
        ModelingCmd::from(mcmd::ExtendPath {
            path: sketch.id.into(),
            segment: PathSegment::Line {
                end: KPoint2d::from(vertices[0]).with_z(0.0).map(LengthUnit),
                relative: false,
            },
        }),
    )
    .await?;

    let current_path = Path::ToPoint {
        base: BasePath {
            from: from.into(),
            to: vertices[0],
            tag: tag.clone(),
            geo_meta: GeoMeta {
                id: close_id,
                metadata: args.source_range.into(),
            },
        },
    };

    if let Some(tag) = &tag {
        sketch.add_tag(tag, &current_path);
    }

    sketch.paths.push(current_path);

    args.batch_modeling_cmd(
        exec_state.id_generator.next_uuid(),
        ModelingCmd::from(mcmd::ClosePath { path_id: sketch.id }),
    )
    .await?;

    Ok(sketch)
}
