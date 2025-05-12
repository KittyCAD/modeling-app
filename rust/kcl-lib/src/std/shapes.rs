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

use super::{
    args::TyF64,
    utils::{point_to_len_unit, point_to_mm, point_to_typed, untype_point, untyped_point_to_mm},
};
use crate::{
    errors::{KclError, KclErrorDetails},
    execution::{
        types::{RuntimeType, UnitLen},
        BasePath, ExecState, GeoMeta, KclValue, Path, Sketch, SketchSurface,
    },
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

    let sketch = inner_circle(sketch_or_surface, center, radius, tag, exec_state, args).await?;
    Ok(KclValue::Sketch {
        value: Box::new(sketch),
    })
}

async fn inner_circle(
    sketch_or_surface: SketchOrSurface,
    center: [TyF64; 2],
    radius: TyF64,
    tag: Option<TagNode>,
    exec_state: &mut ExecState,
    args: Args,
) -> Result<Sketch, KclError> {
    let sketch_surface = match sketch_or_surface {
        SketchOrSurface::SketchSurface(surface) => surface,
        SketchOrSurface::Sketch(s) => s.on,
    };
    let (center_u, ty) = untype_point(center.clone());
    let units = ty.expect_length();

    let from = [center_u[0] + radius.to_length_units(units), center_u[1]];
    let from_t = [TyF64::new(from[0], ty.clone()), TyF64::new(from[1], ty)];

    let sketch =
        crate::std::sketch::inner_start_profile(sketch_surface, from_t, None, exec_state, args.clone()).await?;

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
                center: KPoint2d::from(point_to_mm(center)).map(LengthUnit),
                radius: LengthUnit(radius.to_mm()),
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
        radius: radius.to_length_units(units),
        center: center_u,
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

    let sketch = inner_circle_three_point(sketch_surface_or_group, p1, p2, p3, tag, exec_state, args).await?;
    Ok(KclValue::Sketch {
        value: Box::new(sketch),
    })
}

/// Construct a circle derived from 3 points.
///
/// ```no_run
/// exampleSketch = startSketchOn(XY)
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
    },
    tags = ["sketch"]
}]

// Similar to inner_circle, but needs to retain 3-point information in the
// path so it can be used for other features, otherwise it's lost.
async fn inner_circle_three_point(
    sketch_surface_or_group: SketchOrSurface,
    p1: [TyF64; 2],
    p2: [TyF64; 2],
    p3: [TyF64; 2],
    tag: Option<TagNode>,
    exec_state: &mut ExecState,
    args: Args,
) -> Result<Sketch, KclError> {
    let ty = p1[0].ty.clone();
    let units = ty.expect_length();

    let p1 = point_to_len_unit(p1, units);
    let p2 = point_to_len_unit(p2, units);
    let p3 = point_to_len_unit(p3, units);

    let center = calculate_circle_center(p1, p2, p3);
    // It can be the distance to any of the 3 points - they all lay on the circumference.
    let radius = distance(center, p2);

    let sketch_surface = match sketch_surface_or_group {
        SketchOrSurface::SketchSurface(surface) => surface,
        SketchOrSurface::Sketch(group) => group.on,
    };

    let from = [
        TyF64::new(center[0] + radius, ty.clone()),
        TyF64::new(center[1], ty.clone()),
    ];
    let sketch =
        crate::std::sketch::inner_start_profile(sketch_surface, from.clone(), None, exec_state, args.clone()).await?;

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
                center: KPoint2d::from(untyped_point_to_mm(center, units)).map(LengthUnit),
                radius: units.adjust_to(radius, UnitLen::Mm).0.into(),
                relative: false,
            },
        }),
    )
    .await?;

    let current_path = Path::CircleThreePoint {
        base: BasePath {
            // It's fine to untype here because we know `from` has units as its units.
            from: untype_point(from.clone()).0,
            to: untype_point(from).0,
            tag: tag.clone(),
            units,
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
        center,
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
/// hex = startSketchOn(XY)
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
/// square = startSketchOn(XY)
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
    },
    tags = ["sketch"]
}]
#[allow(clippy::too_many_arguments)]
async fn inner_polygon(
    sketch_surface_or_group: SketchOrSurface,
    radius: TyF64,
    num_sides: u64,
    center: [TyF64; 2],
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

    let (sketch_surface, units) = match sketch_surface_or_group {
        SketchOrSurface::SketchSurface(surface) => (surface, radius.ty.expect_length()),
        SketchOrSurface::Sketch(group) => (group.on, group.units),
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

    let center_u = point_to_len_unit(center, units);

    let vertices: Vec<[f64; 2]> = (0..num_sides)
        .map(|i| {
            let angle = angle_step * i as f64;
            [
                center_u[0] + radius_to_vertices * angle.cos(),
                center_u[1] + radius_to_vertices * angle.sin(),
            ]
        })
        .collect();

    let mut sketch = crate::std::sketch::inner_start_profile(
        sketch_surface,
        point_to_typed(vertices[0], units),
        None,
        exec_state,
        args.clone(),
    )
    .await?;

    // Draw all the lines with unique IDs and modified tags
    for vertex in vertices.iter().skip(1) {
        let from = sketch.current_pen_position()?;
        let id = exec_state.next_uuid();

        args.batch_modeling_cmd(
            id,
            ModelingCmd::from(mcmd::ExtendPath {
                path: sketch.id.into(),
                segment: PathSegment::Line {
                    end: KPoint2d::from(untyped_point_to_mm(*vertex, units))
                        .with_z(0.0)
                        .map(LengthUnit),
                    relative: false,
                },
            }),
        )
        .await?;

        let current_path = Path::ToPoint {
            base: BasePath {
                from: from.ignore_units(),
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
                end: KPoint2d::from(untyped_point_to_mm(vertices[0], units))
                    .with_z(0.0)
                    .map(LengthUnit),
                relative: false,
            },
        }),
    )
    .await?;

    let current_path = Path::ToPoint {
        base: BasePath {
            from: from.ignore_units(),
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
