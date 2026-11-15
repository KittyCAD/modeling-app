//! Standard library shapes.

use anyhow::Result;
use kcl_api::UnitLength;
use kcmc::ModelingCmd;
use kcmc::each_cmd as mcmd;
use kcmc::length_unit::LengthUnit;
use kcmc::shared::Angle;
use kcmc::shared::Point2d as KPoint2d;
use kittycad_modeling_cmds::shared::PathSegment;
use kittycad_modeling_cmds::{self as kcmc};
use serde::Serialize;

use super::args::TyF64;
use super::utils::point_to_len_unit;
use super::utils::point_to_mm;
use super::utils::point_to_typed;
use super::utils::untype_point;
use super::utils::untyped_point_to_mm;
use super::utils::untyped_point_to_unit;
use crate::SourceRange;
use crate::errors::KclError;
use crate::errors::KclErrorDetails;
use crate::execution::BasePath;
use crate::execution::ExecState;
use crate::execution::GeoMeta;
use crate::execution::KclValue;
use crate::execution::ModelingCmdMeta;
use crate::execution::Path;
use crate::execution::ProfileClosed;
use crate::execution::Sketch;
use crate::execution::SketchSurface;
use crate::execution::types::NumericTypeExt;
use crate::execution::types::RuntimeType;
use crate::execution::types::adjust_length;
use crate::parsing::ast::types::TagNode;
use crate::std::Args;
use crate::std::utils::calculate_circle_center;
use crate::std::utils::distance;

/// A sketch surface or a sketch.
#[derive(Debug, Clone, Serialize, PartialEq, ts_rs::TS)]
#[ts(export)]
#[serde(untagged)]
pub enum SketchOrSurface {
    SketchSurface(SketchSurface),
    Sketch(Box<Sketch>),
}

impl SketchOrSurface {
    pub fn into_sketch_surface(self) -> SketchSurface {
        match self {
            SketchOrSurface::SketchSurface(surface) => surface,
            SketchOrSurface::Sketch(sketch) => sketch.on,
        }
    }
}

/// Sketch a rectangle.
pub async fn rectangle(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let sketch_or_surface =
        args.get_unlabeled_kw_arg("sketchOrSurface", &RuntimeType::sketch_or_surface(), exec_state)?;
    let center = args.get_kw_arg_opt("center", &RuntimeType::point2d(), exec_state)?;
    let corner = args.get_kw_arg_opt("corner", &RuntimeType::point2d(), exec_state)?;
    let width: TyF64 = args.get_kw_arg("width", &RuntimeType::length(), exec_state)?;
    let height: TyF64 = args.get_kw_arg("height", &RuntimeType::length(), exec_state)?;

    inner_rectangle(sketch_or_surface, center, corner, width, height, exec_state, args)
        .await
        .map(Box::new)
        .map(|value| KclValue::Sketch { value })
}

async fn inner_rectangle(
    sketch_or_surface: SketchOrSurface,
    center: Option<[TyF64; 2]>,
    corner: Option<[TyF64; 2]>,
    width: TyF64,
    height: TyF64,
    exec_state: &mut ExecState,
    args: Args,
) -> Result<Sketch, KclError> {
    let sketch_surface = sketch_or_surface.into_sketch_surface();

    // Find the corner in the negative quadrant
    let (ty, corner) = match (center, corner) {
        (Some(center), None) => {
            let units = center[0].ty.as_length().unwrap_or(UnitLength::Millimeters);
            (
                center[0].ty,
                [
                    center[0].n - width.unwrap_to_length_units(units) / 2.0,
                    center[1].n - height.unwrap_to_length_units(units) / 2.0,
                ],
            )
        }
        (None, Some(corner)) => (corner[0].ty, [corner[0].n, corner[1].n]),
        (None, None) => {
            return Err(KclError::new_semantic(KclErrorDetails::new(
                "You must supply either `corner` or `center` arguments, but not both".to_string(),
                vec![args.source_range],
            )));
        }
        (Some(_), Some(_)) => {
            return Err(KclError::new_semantic(KclErrorDetails::new(
                "You must supply either `corner` or `center` arguments, but not both".to_string(),
                vec![args.source_range],
            )));
        }
    };
    let units = ty.as_length().unwrap_or(UnitLength::Millimeters);
    let corner_t = [TyF64::new(corner[0], ty), TyF64::new(corner[1], ty)];
    // The rectangle is drawn in the units of `center` or `corner`, which can
    // differ from the units of `width` and `height`.
    let width = width.unwrap_to_length_units(units);
    let height = height.unwrap_to_length_units(units);

    // Start the sketch then draw the 4 lines.
    let sketch = crate::std::sketch::inner_start_profile(
        sketch_surface,
        corner_t,
        None,
        exec_state,
        &args.ctx,
        args.source_range,
    )
    .await?;
    let sketch_id = sketch.id;
    let deltas = [[width, 0.0], [0.0, height], [-width, 0.0], [0.0, -height]];
    let ids = [
        exec_state.next_uuid(),
        exec_state.next_uuid(),
        exec_state.next_uuid(),
        exec_state.next_uuid(),
    ];
    for (id, delta) in ids.iter().copied().zip(deltas) {
        exec_state
            .batch_modeling_cmd(
                ModelingCmdMeta::from_args_id(exec_state, &args, id),
                ModelingCmd::from(
                    mcmd::ExtendPath::builder()
                        .path(sketch.id.into())
                        .segment(PathSegment::Line {
                            end: KPoint2d::from(untyped_point_to_mm(delta, units))
                                .with_z(0.0)
                                .map(LengthUnit),
                            relative: true,
                        })
                        .build(),
                ),
            )
            .await?;
    }
    exec_state
        .batch_modeling_cmd(
            ModelingCmdMeta::from_args_id(exec_state, &args, sketch_id),
            ModelingCmd::from(mcmd::ClosePath::builder().path_id(sketch.id).build()),
        )
        .await?;

    // Update the sketch in KCL memory.
    let mut new_sketch = sketch;
    new_sketch.is_closed = ProfileClosed::Explicitly;
    fn add(a: [f64; 2], b: [f64; 2]) -> [f64; 2] {
        [a[0] + b[0], a[1] + b[1]]
    }
    let a = (corner, add(corner, deltas[0]));
    let b = (a.1, add(a.1, deltas[1]));
    let c = (b.1, add(b.1, deltas[2]));
    let d = (c.1, add(c.1, deltas[3]));
    for (id, (from, to)) in ids.into_iter().zip([a, b, c, d]) {
        let current_path = Path::ToPoint {
            base: BasePath {
                from,
                to,
                tag: None,
                units,
                geo_meta: GeoMeta {
                    id,
                    metadata: args.source_range.into(),
                },
            },
        };
        new_sketch.paths.push_back(current_path);
    }
    Ok(new_sketch)
}

/// Sketch a circle.
pub async fn circle(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let sketch_or_surface =
        args.get_unlabeled_kw_arg("sketchOrSurface", &RuntimeType::sketch_or_surface(), exec_state)?;
    let center = args.get_kw_arg_opt("center", &RuntimeType::point2d(), exec_state)?;
    let radius: Option<TyF64> = args.get_kw_arg_opt("radius", &RuntimeType::length(), exec_state)?;
    let diameter: Option<TyF64> = args.get_kw_arg_opt("diameter", &RuntimeType::length(), exec_state)?;
    let tag = args.get_kw_arg_opt("tag", &RuntimeType::tag_decl(), exec_state)?;

    let sketch = inner_circle(sketch_or_surface, center, radius, diameter, tag, exec_state, args).await?;
    Ok(KclValue::Sketch {
        value: Box::new(sketch),
    })
}

pub const POINT_ZERO_ZERO: [TyF64; 2] = [
    TyF64::new(
        0.0,
        crate::exec::NumericType::Known(crate::exec::UnitType::Length(crate::exec::UnitLength::Millimeters)),
    ),
    TyF64::new(
        0.0,
        crate::exec::NumericType::Known(crate::exec::UnitType::Length(crate::exec::UnitLength::Millimeters)),
    ),
];

pub(super) async fn inner_circle(
    sketch_or_surface: SketchOrSurface,
    center: Option<[TyF64; 2]>,
    radius: Option<TyF64>,
    diameter: Option<TyF64>,
    tag: Option<TagNode>,
    exec_state: &mut ExecState,
    args: Args,
) -> Result<Sketch, KclError> {
    let sketch_surface = sketch_or_surface.into_sketch_surface();
    let center = center.unwrap_or(POINT_ZERO_ZERO);
    let (center_u, ty) = untype_point(center.clone());
    let units = ty.as_length().unwrap_or(UnitLength::Millimeters);

    let radius = get_radius(radius, diameter, args.source_range)?;
    let from = [center_u[0] + radius.unwrap_to_length_units(units), center_u[1]];
    let from_t = [TyF64::new(from[0], ty), TyF64::new(from[1], ty)];

    let sketch =
        crate::std::sketch::inner_start_profile(sketch_surface, from_t, None, exec_state, &args.ctx, args.source_range)
            .await?;

    let angle_start = Angle::zero();
    let angle_end = Angle::turn();

    let id = exec_state.next_uuid();

    exec_state
        .batch_modeling_cmd(
            ModelingCmdMeta::from_args_id(exec_state, &args, id),
            ModelingCmd::from(
                mcmd::ExtendPath::builder()
                    .path(sketch.id.into())
                    .segment(PathSegment::Arc {
                        start: angle_start,
                        end: angle_end,
                        center: KPoint2d::from(point_to_mm(center)).map(LengthUnit),
                        radius: LengthUnit(radius.unwrap_to_mm()),
                        relative: false,
                    })
                    .build(),
            ),
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
        radius: radius.unwrap_to_length_units(units),
        center: center_u,
        ccw: angle_start < angle_end,
    };

    let mut new_sketch = sketch;
    new_sketch.is_closed = ProfileClosed::Explicitly;
    if let Some(tag) = &tag {
        new_sketch.add_tag(tag, &current_path, exec_state, None);
    }

    new_sketch.paths.push_back(current_path);

    exec_state
        .batch_modeling_cmd(
            ModelingCmdMeta::from_args_id(exec_state, &args, id),
            ModelingCmd::from(mcmd::ClosePath::builder().path_id(new_sketch.id).build()),
        )
        .await?;

    Ok(new_sketch)
}

/// Sketch a 3-point circle.
pub async fn circle_three_point(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let sketch_or_surface =
        args.get_unlabeled_kw_arg("sketchOrSurface", &RuntimeType::sketch_or_surface(), exec_state)?;
    let p1 = args.get_kw_arg("p1", &RuntimeType::point2d(), exec_state)?;
    let p2 = args.get_kw_arg("p2", &RuntimeType::point2d(), exec_state)?;
    let p3 = args.get_kw_arg("p3", &RuntimeType::point2d(), exec_state)?;
    let tag = args.get_kw_arg_opt("tag", &RuntimeType::tag_decl(), exec_state)?;

    let sketch = inner_circle_three_point(sketch_or_surface, p1, p2, p3, tag, exec_state, args).await?;
    Ok(KclValue::Sketch {
        value: Box::new(sketch),
    })
}

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
    let ty = p1[0].ty;
    let units = ty.as_length().unwrap_or(UnitLength::Millimeters);

    let p1 = point_to_len_unit(p1, units);
    let p2 = point_to_len_unit(p2, units);
    let p3 = point_to_len_unit(p3, units);

    let center = calculate_circle_center(p1, p2, p3);
    // It can be the distance to any of the 3 points - they all lay on the circumference.
    let radius = distance(center, p2);

    let sketch_surface = sketch_surface_or_group.into_sketch_surface();

    let from = [TyF64::new(center[0] + radius, ty), TyF64::new(center[1], ty)];
    let sketch = crate::std::sketch::inner_start_profile(
        sketch_surface,
        from.clone(),
        None,
        exec_state,
        &args.ctx,
        args.source_range,
    )
    .await?;

    let angle_start = Angle::zero();
    let angle_end = Angle::turn();

    let id = exec_state.next_uuid();

    exec_state
        .batch_modeling_cmd(
            ModelingCmdMeta::from_args_id(exec_state, &args, id),
            ModelingCmd::from(
                mcmd::ExtendPath::builder()
                    .path(sketch.id.into())
                    .segment(PathSegment::Arc {
                        start: angle_start,
                        end: angle_end,
                        center: KPoint2d::from(untyped_point_to_mm(center, units)).map(LengthUnit),
                        radius: adjust_length(units, radius, UnitLength::Millimeters).0.into(),
                        relative: false,
                    })
                    .build(),
            ),
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

    let mut new_sketch = sketch;
    new_sketch.is_closed = ProfileClosed::Explicitly;
    if let Some(tag) = &tag {
        new_sketch.add_tag(tag, &current_path, exec_state, None);
    }

    new_sketch.paths.push_back(current_path);

    exec_state
        .batch_modeling_cmd(
            ModelingCmdMeta::from_args_id(exec_state, &args, id),
            ModelingCmd::from(mcmd::ClosePath::builder().path_id(new_sketch.id).build()),
        )
        .await?;

    Ok(new_sketch)
}

/// Type of the polygon
#[derive(Debug, Clone, Serialize, PartialEq, ts_rs::TS, Default)]
#[ts(export)]
#[serde(rename_all = "lowercase")]
pub enum PolygonType {
    #[default]
    Inscribed,
    Circumscribed,
}

/// Create a regular polygon with the specified number of sides and radius.
pub async fn polygon(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let sketch_or_surface =
        args.get_unlabeled_kw_arg("sketchOrSurface", &RuntimeType::sketch_or_surface(), exec_state)?;
    let radius: TyF64 = args.get_kw_arg("radius", &RuntimeType::length(), exec_state)?;
    let num_sides: TyF64 = args.get_kw_arg("numSides", &RuntimeType::count(), exec_state)?;
    let center = args.get_kw_arg_opt("center", &RuntimeType::point2d(), exec_state)?;
    let inscribed = args.get_kw_arg_opt("inscribed", &RuntimeType::bool(), exec_state)?;

    let sketch = inner_polygon(
        sketch_or_surface,
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

#[allow(clippy::too_many_arguments)]
async fn inner_polygon(
    sketch_surface_or_group: SketchOrSurface,
    radius: TyF64,
    num_sides: u64,
    center: Option<[TyF64; 2]>,
    inscribed: Option<bool>,
    exec_state: &mut ExecState,
    args: Args,
) -> Result<Sketch, KclError> {
    let center = center.unwrap_or(POINT_ZERO_ZERO);
    if num_sides < 3 {
        return Err(KclError::new_type(KclErrorDetails::new(
            "Polygon must have at least 3 sides".to_string(),
            vec![args.source_range],
        )));
    }

    if radius.n <= 0.0 {
        return Err(KclError::new_type(KclErrorDetails::new(
            "Radius must be greater than 0".to_string(),
            vec![args.source_range],
        )));
    }

    let (sketch_surface, units) = match sketch_surface_or_group {
        SketchOrSurface::SketchSurface(surface) => (surface, radius.ty.as_length().unwrap_or(UnitLength::Millimeters)),
        SketchOrSurface::Sketch(group) => (group.on, group.units),
    };

    let half_angle = std::f64::consts::PI / num_sides as f64;

    // `units` comes from the sketch when one is piped in, so convert `radius` to it.
    let radius_u = radius.to_length_units(units);
    let radius_to_vertices = if inscribed.unwrap_or(true) {
        // inscribed
        radius_u
    } else {
        // circumscribed
        radius_u / libm::cos(half_angle)
    };

    let angle_step = std::f64::consts::TAU / num_sides as f64;

    let center_u = point_to_len_unit(center, units);

    let vertices: Vec<[f64; 2]> = (0..num_sides)
        .map(|i| {
            let angle = angle_step * i as f64;
            [
                center_u[0] + radius_to_vertices * libm::cos(angle),
                center_u[1] + radius_to_vertices * libm::sin(angle),
            ]
        })
        .collect();

    let mut sketch = crate::std::sketch::inner_start_profile(
        sketch_surface,
        point_to_typed(vertices[0], units),
        None,
        exec_state,
        &args.ctx,
        args.source_range,
    )
    .await?;

    // Draw all the lines with unique IDs and modified tags
    for vertex in vertices.iter().skip(1) {
        let from = sketch.current_pen_position()?;
        let id = exec_state.next_uuid();

        exec_state
            .batch_modeling_cmd(
                ModelingCmdMeta::from_args_id(exec_state, &args, id),
                ModelingCmd::from(
                    mcmd::ExtendPath::builder()
                        .path(sketch.id.into())
                        .segment(PathSegment::Line {
                            end: KPoint2d::from(untyped_point_to_mm(*vertex, units))
                                .with_z(0.0)
                                .map(LengthUnit),
                            relative: false,
                        })
                        .build(),
                ),
            )
            .await?;

        let current_path = Path::ToPoint {
            base: BasePath {
                from: from.ignore_units(),
                // The vertices are in the units of `radius`, which can differ
                // from the units of the sketch.
                to: untyped_point_to_unit(*vertex, units, sketch.units),
                tag: None,
                units: sketch.units,
                geo_meta: GeoMeta {
                    id,
                    metadata: args.source_range.into(),
                },
            },
        };

        sketch.paths.push_back(current_path);
    }

    // Close the polygon by connecting back to the first vertex with a new ID
    let from = sketch.current_pen_position()?;
    let close_id = exec_state.next_uuid();

    exec_state
        .batch_modeling_cmd(
            ModelingCmdMeta::from_args_id(exec_state, &args, close_id),
            ModelingCmd::from(
                mcmd::ExtendPath::builder()
                    .path(sketch.id.into())
                    .segment(PathSegment::Line {
                        end: KPoint2d::from(untyped_point_to_mm(vertices[0], units))
                            .with_z(0.0)
                            .map(LengthUnit),
                        relative: false,
                    })
                    .build(),
            ),
        )
        .await?;

    let current_path = Path::ToPoint {
        base: BasePath {
            from: from.ignore_units(),
            to: untyped_point_to_unit(vertices[0], units, sketch.units),
            tag: None,
            units: sketch.units,
            geo_meta: GeoMeta {
                id: close_id,
                metadata: args.source_range.into(),
            },
        },
    };

    sketch.paths.push_back(current_path);
    sketch.is_closed = ProfileClosed::Explicitly;

    exec_state
        .batch_modeling_cmd(
            ModelingCmdMeta::from_args(exec_state, &args),
            ModelingCmd::from(mcmd::ClosePath::builder().path_id(sketch.id).build()),
        )
        .await?;

    Ok(sketch)
}

/// Sketch an ellipse.
pub async fn ellipse(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let sketch_or_surface =
        args.get_unlabeled_kw_arg("sketchOrSurface", &RuntimeType::sketch_or_surface(), exec_state)?;
    let center = args.get_kw_arg_opt("center", &RuntimeType::point2d(), exec_state)?;
    let major_radius = args.get_kw_arg_opt("majorRadius", &RuntimeType::length(), exec_state)?;
    let major_axis = args.get_kw_arg_opt("majorAxis", &RuntimeType::point2d(), exec_state)?;
    let minor_radius = args.get_kw_arg("minorRadius", &RuntimeType::length(), exec_state)?;
    let tag = args.get_kw_arg_opt("tag", &RuntimeType::tag_decl(), exec_state)?;

    let sketch = inner_ellipse(
        sketch_or_surface,
        center,
        major_radius,
        major_axis,
        minor_radius,
        tag,
        exec_state,
        args,
    )
    .await?;
    Ok(KclValue::Sketch {
        value: Box::new(sketch),
    })
}

#[allow(clippy::too_many_arguments)]
async fn inner_ellipse(
    sketch_surface_or_group: SketchOrSurface,
    center: Option<[TyF64; 2]>,
    major_radius: Option<TyF64>,
    major_axis: Option<[TyF64; 2]>,
    minor_radius: TyF64,
    tag: Option<TagNode>,
    exec_state: &mut ExecState,
    args: Args,
) -> Result<Sketch, KclError> {
    let sketch_surface = sketch_surface_or_group.into_sketch_surface();
    let center = center.unwrap_or(POINT_ZERO_ZERO);
    let (center_u, ty) = untype_point(center.clone());
    let units = ty.as_length().unwrap_or(UnitLength::Millimeters);

    let major_axis = match (major_axis, major_radius) {
        (Some(_), Some(_)) | (None, None) => {
            return Err(KclError::new_type(KclErrorDetails::new(
                "Provide either `majorAxis` or `majorRadius`.".to_string(),
                vec![args.source_range],
            )));
        }
        (Some(major_axis), None) => major_axis,
        (None, Some(major_radius)) => [
            major_radius.clone(),
            TyF64 {
                n: 0.0,
                ty: major_radius.ty,
            },
        ],
    };

    let from = [
        center_u[0] + major_axis[0].unwrap_to_length_units(units),
        center_u[1] + major_axis[1].unwrap_to_length_units(units),
    ];
    let from_t = [TyF64::new(from[0], ty), TyF64::new(from[1], ty)];

    let sketch =
        crate::std::sketch::inner_start_profile(sketch_surface, from_t, None, exec_state, &args.ctx, args.source_range)
            .await?;

    let angle_start = Angle::zero();
    let angle_end = Angle::turn();

    let id = exec_state.next_uuid();

    let axis = KPoint2d::from(untyped_point_to_mm([major_axis[0].n, major_axis[1].n], units)).map(LengthUnit);
    exec_state
        .batch_modeling_cmd(
            ModelingCmdMeta::from_args_id(exec_state, &args, id),
            ModelingCmd::from(
                mcmd::ExtendPath::builder()
                    .path(sketch.id.into())
                    .segment(PathSegment::Ellipse {
                        center: KPoint2d::from(point_to_mm(center)).map(LengthUnit),
                        major_axis: axis,
                        minor_radius: LengthUnit(minor_radius.unwrap_to_mm()),
                        start_angle: Angle::from_degrees(angle_start.to_degrees()),
                        end_angle: Angle::from_degrees(angle_end.to_degrees()),
                    })
                    .build(),
            ),
        )
        .await?;

    let current_path = Path::Ellipse {
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
        major_axis: major_axis.map(|x| x.unwrap_to_length_units(units)),
        minor_radius: minor_radius.unwrap_to_length_units(units),
        center: center_u,
        ccw: angle_start < angle_end,
    };

    let mut new_sketch = sketch;
    new_sketch.is_closed = ProfileClosed::Explicitly;
    if let Some(tag) = &tag {
        new_sketch.add_tag(tag, &current_path, exec_state, None);
    }

    new_sketch.paths.push_back(current_path);

    exec_state
        .batch_modeling_cmd(
            ModelingCmdMeta::from_args_id(exec_state, &args, id),
            ModelingCmd::from(mcmd::ClosePath::builder().path_id(new_sketch.id).build()),
        )
        .await?;

    Ok(new_sketch)
}

pub(crate) fn get_radius(
    radius: Option<TyF64>,
    diameter: Option<TyF64>,
    source_range: SourceRange,
) -> Result<TyF64, KclError> {
    get_radius_labelled(radius, diameter, source_range, "radius", "diameter")
}

pub(crate) fn get_radius_labelled(
    radius: Option<TyF64>,
    diameter: Option<TyF64>,
    source_range: SourceRange,
    label_radius: &'static str,
    label_diameter: &'static str,
) -> Result<TyF64, KclError> {
    match (radius, diameter) {
        (Some(radius), None) => Ok(radius),
        (None, Some(diameter)) => Ok(TyF64::new(diameter.n / 2.0, diameter.ty)),
        (None, None) => Err(KclError::new_type(KclErrorDetails::new(
            format!("This function needs either `{label_diameter}` or `{label_radius}`"),
            vec![source_range],
        ))),
        (Some(_), Some(_)) => Err(KclError::new_type(KclErrorDetails::new(
            format!("You cannot specify both `{label_diameter}` and `{label_radius}`, please remove one"),
            vec![source_range],
        ))),
    }
}

#[cfg(test)]
mod tests {
    use kittycad_modeling_cmds::ModelingCmd;
    use kittycad_modeling_cmds::shared::PathSegment;

    use crate::execution::KclValue;
    use crate::execution::parse_execute;

    /// Runs `code`, which draws one rectangle called `r`, and returns where the
    /// engine was told to start the profile, the relative line segments it was
    /// sent, and the corners recorded in the sketch, all in mm.
    async fn rectangle_in_mm(code: &str) -> ([f64; 2], Vec<[f64; 2]>, Vec<[f64; 2]>) {
        let result = parse_execute(code).await.unwrap();

        let mut start = None;
        let mut segments = Vec::new();
        for command in result.root_module_artifact_commands() {
            match &command.command {
                ModelingCmd::MovePathPen(move_pen) => start = Some([move_pen.to.x.0, move_pen.to.y.0]),
                ModelingCmd::ExtendPath(extend) => match &extend.segment {
                    PathSegment::Line { end, relative: true } => segments.push([end.x.0, end.y.0]),
                    other => panic!("expected a relative line, got {other:?}"),
                },
                _ => {}
            }
        }

        let KclValue::Sketch { value: sketch } = result.variable("r") else {
            panic!("expected `r` to be a sketch");
        };
        let corners = sketch
            .paths
            .iter()
            .map(|path| {
                let [x, y] = path.get_to();
                [x.unwrap_to_mm(), y.unwrap_to_mm()]
            })
            .collect();

        (
            start.expect("expected the profile to start somewhere"),
            segments,
            corners,
        )
    }

    fn assert_close(actual: &[[f64; 2]], expected: &[[f64; 2]], code: &str) {
        assert_eq!(actual.len(), expected.len(), "{code}");
        for (a, e) in actual.iter().zip(expected) {
            assert!(
                (a[0] - e[0]).abs() < 1e-9 && (a[1] - e[1]).abs() < 1e-9,
                "expected {expected:?}, got {actual:?} for:\n{code}"
            );
        }
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn rectangle_converts_width_and_height_to_the_units_of_the_center_or_corner() {
        // https://github.com/KittyCAD/modeling-app/issues/14207
        // Every case describes the same 1in x 2in rectangle, so the engine must
        // get the same numbers in mm whichever units the arguments use.
        let centered = [
            "@settings(kclVersion = 2.0, defaultLengthUnit = mm)\nr = startSketchOn(XY) |> rectangle(center = [0, 0], width = 1in, height = 2in)",
            "@settings(kclVersion = 2.0, defaultLengthUnit = mm)\nr = startSketchOn(XY) |> rectangle(center = [0, 0], width = 25.4, height = 50.8)",
            "@settings(kclVersion = 2.0, defaultLengthUnit = mm)\nr = startSketchOn(XY) |> rectangle(center = [0in, 0in], width = 1in, height = 2in)",
            "@settings(kclVersion = 2.0, defaultLengthUnit = in)\nr = startSketchOn(XY) |> rectangle(center = [0, 0], width = 25.4mm, height = 50.8mm)",
            "@settings(kclVersion = 2.0, defaultLengthUnit = in)\nr = startSketchOn(XY) |> rectangle(center = [0, 0], width = 1, height = 2)",
        ];
        let cornered = [
            "@settings(kclVersion = 2.0, defaultLengthUnit = mm)\nr = startSketchOn(XY) |> rectangle(corner = [0, 0], width = 1in, height = 2in)",
            "@settings(kclVersion = 2.0, defaultLengthUnit = mm)\nr = startSketchOn(XY) |> rectangle(corner = [0, 0], width = 25.4, height = 50.8)",
            "@settings(kclVersion = 2.0, defaultLengthUnit = in)\nr = startSketchOn(XY) |> rectangle(corner = [0, 0], width = 25.4mm, height = 50.8mm)",
        ];
        let segments = [[25.4, 0.0], [0.0, 50.8], [-25.4, 0.0], [0.0, -50.8]];

        for (codes, start, corners) in [
            (
                &centered[..],
                [-12.7, -25.4],
                [[12.7, -25.4], [12.7, 25.4], [-12.7, 25.4], [-12.7, -25.4]],
            ),
            (
                &cornered[..],
                [0.0, 0.0],
                [[25.4, 0.0], [25.4, 50.8], [0.0, 50.8], [0.0, 0.0]],
            ),
        ] {
            for code in codes {
                let (actual_start, actual_segments, actual_corners) = rectangle_in_mm(code).await;
                assert_close(&[actual_start], &[start], code);
                assert_close(&actual_segments, &segments, code);
                assert_close(&actual_corners, &corners, code);
            }
        }
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn polygon_records_its_vertices_in_the_units_of_the_sketch() {
        // Every case is the same square with vertices 1in = 25.4mm from the
        // center, written with different units.
        let cases = [
            "@settings(kclVersion = 2.0, defaultLengthUnit = mm)\np = startSketchOn(XY) |> polygon(radius = 1in, numSides = 4, center = [0, 0])",
            "@settings(kclVersion = 2.0, defaultLengthUnit = mm)\np = startSketchOn(XY) |> polygon(radius = 25.4, numSides = 4, center = [0, 0])",
            "@settings(kclVersion = 2.0, defaultLengthUnit = in)\np = startSketchOn(XY) |> polygon(radius = 25.4mm, numSides = 4, center = [0, 0])",
            "@settings(kclVersion = 2.0, defaultLengthUnit = in)\np = startSketchOn(XY) |> polygon(radius = 1, numSides = 4, center = [0, 0])",
            // A sketch piped in instead of a plane: the units come from the sketch.
            "@settings(kclVersion = 2.0, defaultLengthUnit = mm)\np = startSketchOn(XY) |> startProfile(at = [0, 0]) |> polygon(radius = 1in, numSides = 4, center = [0, 0])",
            "@settings(kclVersion = 2.0, defaultLengthUnit = in)\np = startSketchOn(XY) |> startProfile(at = [0, 0]) |> polygon(radius = 25.4mm, numSides = 4, center = [0, 0])",
        ];
        // The vertices after the first one, then back to the first one.
        let expected = [[0.0, 25.4], [-25.4, 0.0], [0.0, -25.4], [25.4, 0.0]];

        for case in cases {
            let code = format!("{case}\nlastX = lastSegX(p)\nstartX = profileStartX(p)");
            let result = parse_execute(&code).await.unwrap();

            // What the engine was told to draw.
            let engine: Vec<[f64; 2]> = result
                .root_module_artifact_commands()
                .iter()
                .filter_map(|command| match &command.command {
                    ModelingCmd::ExtendPath(extend) => match &extend.segment {
                        PathSegment::Line { end, relative: false } => Some([end.x.0, end.y.0]),
                        other => panic!("expected an absolute line, got {other:?}"),
                    },
                    _ => None,
                })
                .collect();

            // What KCL recorded in the sketch.
            let KclValue::Sketch { value: sketch } = result.variable("p") else {
                panic!("expected `p` to be a sketch");
            };
            let recorded: Vec<[f64; 2]> = sketch
                .paths
                .iter()
                .map(|path| {
                    let [x, y] = path.get_to();
                    [x.to_mm(), y.to_mm()]
                })
                .collect();

            for actual in [&engine, &recorded] {
                assert_eq!(actual.len(), expected.len(), "{code}");
                for (a, e) in actual.iter().zip(expected) {
                    assert!(
                        (a[0] - e[0]).abs() < 1e-9 && (a[1] - e[1]).abs() < 1e-9,
                        "expected {expected:?}, got engine {engine:?} and recorded {recorded:?} for:\n{code}"
                    );
                }
            }

            let last_x = result.variable("lastX").as_ty_f64().unwrap().to_mm();
            let start_x = result.variable("startX").as_ty_f64().unwrap().to_mm();
            assert!(
                (last_x - 25.4).abs() < 1e-9 && (start_x - 25.4).abs() < 1e-9,
                "lastSegX = {last_x} mm, profileStartX = {start_x} mm for:\n{code}"
            );
        }
    }
}
