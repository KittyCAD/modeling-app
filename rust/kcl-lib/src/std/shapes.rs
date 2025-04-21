//! Standard library shapes.

use anyhow::Result;
use kcl_derive_docs::stdlib;
use kcmc::{
    each_cmd as mcmd,
    length_unit::LengthUnit,
    shared::{Angle, Point2d as KPoint2d},
    ModelingCmd,
};
use kittycad_modeling_cmds as kcmc;
use kittycad_modeling_cmds::shared::PathSegment;
use schemars::JsonSchema;
use serde::Serialize;

use super::{args::TyF64, utils::untype_point};
use crate::{
    errors::{KclError, KclErrorDetails},
    execution::{types::RuntimeType, BasePath, ExecState, GeoMeta, KclValue, Path, Sketch, SketchSurface},
    parsing::ast::types::TagNode,
    std::{
        sketch::NEW_TAG_KW,
        utils::{calculate_circle_center, distance},
        Args,
    },
};

/// A sketch surface or a sketch.
#[derive(Debug, Clone, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(untagged)]
pub enum SketchOrSurface {
    SketchSurface(SketchSurface),
    Sketch(Box<Sketch>),
}

/// Sketch a circle.
pub async fn circle(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let sketch_or_surface = args.get_unlabeled_kw_arg("sketchOrSurface")?;
    let center = args.get_kw_arg_typed("center", &RuntimeType::point2d(), exec_state)?;
    let radius: TyF64 = args.get_kw_arg_typed("radius", &RuntimeType::length(), exec_state)?;
    let tag = args.get_kw_arg_opt(NEW_TAG_KW)?;

    let sketch = inner_circle(
        sketch_or_surface,
        untype_point(center).0,
        radius.n,
        tag,
        exec_state,
        args,
    )
    .await?;
    Ok(KclValue::Sketch {
        value: Box::new(sketch),
    })
}

async fn inner_circle(
    sketch_or_surface: SketchOrSurface,
    center: [f64; 2],
    radius: f64,
    tag: Option<TagNode>,
    exec_state: &mut ExecState,
    args: Args,
) -> Result<Sketch, KclError> {
    let sketch_surface = match sketch_or_surface {
        SketchOrSurface::SketchSurface(surface) => surface,
        SketchOrSurface::Sketch(s) => s.on,
    };
    let units = sketch_surface.units();
    let sketch = crate::std::sketch::inner_start_profile_at(
        [center[0] + radius, center[1]],
        sketch_surface,
        None,
        exec_state,
        args.clone(),
    )
    .await?;

    let from = [center[0] + radius, center[1]];
    let angle_start = Angle::zero();
    let angle_end = Angle::turn();

    let id = exec_state.next_uuid();

    args.batch_modeling_cmd(
        id,
        ModelingCmd::from(mcmd::ExtendPath {
            path: sketch.id.into(),
            segment: PathSegment::Arc {
                start: angle_start,
                end: angle_end,
                center: KPoint2d::from(center).map(LengthUnit),
                radius: radius.into(),
                relative: false,
            },
        }),
    )
    .await?;

    let current_path = Path::Circle {
        base: BasePath {
            from,
            to: from,
            tag: tag.clone(),
            units,
            geo_meta: GeoMeta {
                id,
                metadata: args.source_range.into(),
            },
        },
        radius,
        center,
        ccw: angle_start < angle_end,
    };

    let mut new_sketch = sketch.clone();
    if let Some(tag) = &tag {
        new_sketch.add_tag(tag, &current_path, exec_state);
    }

    new_sketch.paths.push(current_path);

    args.batch_modeling_cmd(id, ModelingCmd::from(mcmd::ClosePath { path_id: new_sketch.id }))
        .await?;

    Ok(new_sketch)
}

/// Sketch a 3-point circle.
pub async fn circle_three_point(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let sketch_surface_or_group = args.get_unlabeled_kw_arg("sketch_surface_or_group")?;
    let p1 = args.get_kw_arg_typed("p1", &RuntimeType::point2d(), exec_state)?;
    let p2 = args.get_kw_arg_typed("p2", &RuntimeType::point2d(), exec_state)?;
    let p3 = args.get_kw_arg_typed("p3", &RuntimeType::point2d(), exec_state)?;
    let tag = args.get_kw_arg_opt("tag")?;

    let sketch = inner_circle_three_point(
        sketch_surface_or_group,
        untype_point(p1).0,
        untype_point(p2).0,
        untype_point(p3).0,
        tag,
        exec_state,
        args,
    )
    .await?;
    Ok(KclValue::Sketch {
        value: Box::new(sketch),
    })
}

/// Construct a circle derived from 3 points.
///
/// ```no_run
/// exampleSketch = startSketchOn("XY")
///   |> circleThreePoint(p1 = [10,10], p2 = [20,8], p3 = [15,5])
///   |> extrude(length = 5)
/// ```
#[stdlib {
    name = "circleThreePoint",
    keywords = true,
    unlabeled_first = true,
    args = {
        sketch_surface_or_group = {docs = "Plane or surface to sketch on."},
        p1 = {docs = "1st point to derive the circle."},
        p2 = {docs = "2nd point to derive the circle."},
        p3 = {docs = "3rd point to derive the circle."},
        tag = {docs = "Identifier for the circle to reference elsewhere."},
    }
}]

// Similar to inner_circle, but needs to retain 3-point information in the
// path so it can be used for other features, otherwise it's lost.
async fn inner_circle_three_point(
    sketch_surface_or_group: SketchOrSurface,
    p1: [f64; 2],
    p2: [f64; 2],
    p3: [f64; 2],
    tag: Option<TagNode>,
    exec_state: &mut ExecState,
    args: Args,
) -> Result<Sketch, KclError> {
    let center = calculate_circle_center(p1, p2, p3);
    // It can be the distance to any of the 3 points - they all lay on the circumference.
    let radius = distance(center, p2);

    let sketch_surface = match sketch_surface_or_group {
        SketchOrSurface::SketchSurface(surface) => surface,
        SketchOrSurface::Sketch(group) => group.on,
    };
    let sketch = crate::std::sketch::inner_start_profile_at(
        [center[0] + radius, center[1]],
        sketch_surface,
        None,
        exec_state,
        args.clone(),
    )
    .await?;

    let from = [center[0] + radius, center[1]];
    let angle_start = Angle::zero();
    let angle_end = Angle::turn();

    let id = exec_state.next_uuid();

    args.batch_modeling_cmd(
        id,
        ModelingCmd::from(mcmd::ExtendPath {
            path: sketch.id.into(),
            segment: PathSegment::Arc {
                start: angle_start,
                end: angle_end,
                center: KPoint2d::from(center).map(LengthUnit),
                radius: radius.into(),
                relative: false,
            },
        }),
    )
    .await?;

    let current_path = Path::CircleThreePoint {
        base: BasePath {
            from,
            to: from,
            tag: tag.clone(),
            units: sketch.units,
            geo_meta: GeoMeta {
                id,
                metadata: args.source_range.into(),
            },
        },
        p1,
        p2,
        p3,
    };

    let mut new_sketch = sketch.clone();
    if let Some(tag) = &tag {
        new_sketch.add_tag(tag, &current_path, exec_state);
    }

    new_sketch.paths.push(current_path);

    args.batch_modeling_cmd(id, ModelingCmd::from(mcmd::ClosePath { path_id: new_sketch.id }))
        .await?;

    Ok(new_sketch)
}

/// Type of the polygon
#[derive(Debug, Clone, Serialize, PartialEq, ts_rs::TS, JsonSchema, Default)]
#[ts(export)]
#[serde(rename_all = "lowercase")]
pub enum PolygonType {
    #[default]
    Inscribed,
    Circumscribed,
}

/// Create a regular polygon with the specified number of sides and radius.
pub async fn polygon(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let sketch_surface_or_group = args.get_unlabeled_kw_arg("sketchOrSurface")?;
    let radius: TyF64 = args.get_kw_arg_typed("radius", &RuntimeType::length(), exec_state)?;
    let num_sides: TyF64 = args.get_kw_arg_typed("numSides", &RuntimeType::count(), exec_state)?;
    let center = args.get_kw_arg_typed("center", &RuntimeType::point2d(), exec_state)?;
    let inscribed = args.get_kw_arg_opt_typed("inscribed", &RuntimeType::bool(), exec_state)?;

    let sketch = inner_polygon(
        sketch_surface_or_group,
        radius,
        num_sides.n as u64,
        untype_point(center).0,
        inscribed,
        exec_state,
        args,
    )
    .await?;
    Ok(KclValue::Sketch {
        value: Box::new(sketch),
    })
}

/// Create a regular polygon with the specified number of sides that is either inscribed or circumscribed around a circle of the specified radius.
///
/// ```no_run
/// // Create a regular hexagon inscribed in a circle of radius 10
/// hex = startSketchOn('XY')
///   |> polygon(
///     radius = 10,
///     numSides = 6,
///     center = [0, 0],
///     inscribed = true,
///   )
///
/// example = extrude(hex, length = 5)
/// ```
///
/// ```no_run
/// // Create a square circumscribed around a circle of radius 5
/// square = startSketchOn('XY')
///   |> polygon(
///     radius = 5.0,
///     numSides = 4,
///     center = [10, 10],
///     inscribed = false,
///   )
/// example = extrude(square, length = 5)
/// ```
#[stdlib {
    name = "polygon",
    keywords = true,
    unlabeled_first = true,
    args = {
        sketch_surface_or_group = { docs = "Plane or surface to sketch on" },
        radius = { docs = "The radius of the polygon", include_in_snippet = true },
        num_sides = { docs = "The number of sides in the polygon", include_in_snippet = true },
        center = { docs = "The center point of the polygon", include_in_snippet = true },
        inscribed = { docs = "Whether the polygon is inscribed (true, the default) or circumscribed (false) about a circle with the specified radius" },
    }
}]
#[allow(clippy::too_many_arguments)]
async fn inner_polygon(
    sketch_surface_or_group: SketchOrSurface,
    radius: TyF64,
    num_sides: u64,
    center: [f64; 2],
    inscribed: Option<bool>,
    exec_state: &mut ExecState,
    args: Args,
) -> Result<Sketch, KclError> {
    if num_sides < 3 {
        return Err(KclError::Type(KclErrorDetails {
            message: "Polygon must have at least 3 sides".to_string(),
            source_ranges: vec![args.source_range],
        }));
    }

    if radius.n <= 0.0 {
        return Err(KclError::Type(KclErrorDetails {
            message: "Radius must be greater than 0".to_string(),
            source_ranges: vec![args.source_range],
        }));
    }

    let sketch_surface = match sketch_surface_or_group {
        SketchOrSurface::SketchSurface(surface) => surface,
        SketchOrSurface::Sketch(group) => group.on,
    };

    let half_angle = std::f64::consts::PI / num_sides as f64;

    let radius_to_vertices = if inscribed.unwrap_or(true) {
        // inscribed
        radius.n
    } else {
        // circumscribed
        radius.n / half_angle.cos()
    };

    let angle_step = std::f64::consts::TAU / num_sides as f64;

    let vertices: Vec<[f64; 2]> = (0..num_sides)
        .map(|i| {
            let angle = angle_step * i as f64;
            [
                center[0] + radius_to_vertices * angle.cos(),
                center[1] + radius_to_vertices * angle.sin(),
            ]
        })
        .collect();

    let mut sketch =
        crate::std::sketch::inner_start_profile_at(vertices[0], sketch_surface, None, exec_state, args.clone()).await?;

    // Draw all the lines with unique IDs and modified tags
    for vertex in vertices.iter().skip(1) {
        let from = sketch.current_pen_position()?;
        let id = exec_state.next_uuid();

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
                tag: None,
                units: sketch.units,
                geo_meta: GeoMeta {
                    id,
                    metadata: args.source_range.into(),
                },
            },
        };

        sketch.paths.push(current_path);
    }

    // Close the polygon by connecting back to the first vertex with a new ID
    let from = sketch.current_pen_position()?;
    let close_id = exec_state.next_uuid();

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
            tag: None,
            units: sketch.units,
            geo_meta: GeoMeta {
                id: close_id,
                metadata: args.source_range.into(),
            },
        },
    };

    sketch.paths.push(current_path);

    args.batch_modeling_cmd(
        exec_state.next_uuid(),
        ModelingCmd::from(mcmd::ClosePath { path_id: sketch.id }),
    )
    .await?;

    Ok(sketch)
}
