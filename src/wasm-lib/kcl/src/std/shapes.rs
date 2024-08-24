//! Standard library shapes.

use anyhow::Result;
use derive_docs::stdlib;
use kittycad::types::{Angle, ModelingCmd};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::{
    ast::types::TagDeclarator,
    errors::{KclError, KclErrorDetails},
    executor::{BasePath, GeoMeta, KclValue, Path, Point2d, SketchGroup, SketchSurface},
    std::Args,
};

use super::utils::arc_center_and_end;

/// A sketch surface or a sketch group.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(untagged)]
pub enum SketchSurfaceOrGroup {
    SketchSurface(SketchSurface),
    SketchGroup(Box<SketchGroup>),
}

/// Sketch a circle.
pub async fn circle(args: Args) -> Result<KclValue, KclError> {
    let (center, radius, sketch_surface_or_group, tag): ([f64; 2], f64, SketchSurfaceOrGroup, Option<TagDeclarator>) =
        args.get_circle_args()?;

    let sketch_group = inner_circle(center, radius, sketch_surface_or_group, tag, args).await?;
    Ok(KclValue::new_user_val(sketch_group.meta.clone(), sketch_group))
}

/// Construct a 2-dimensional circle, of the specified radius, centered at
/// the provided (x, y) origin point.
///
/// ```no_run
/// const exampleSketch = startSketchOn("-XZ")
///   |> circle([0, 0], 10, %)
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
///   |> hole(circle([0, 15], 5, %), %)
///
/// const example = extrude(5, exampleSketch)
/// ```
#[stdlib {
    name = "circle",
}]
async fn inner_circle(
    center: [f64; 2],
    radius: f64,
    sketch_surface_or_group: SketchSurfaceOrGroup,
    tag: Option<TagDeclarator>,
    args: Args,
) -> Result<SketchGroup, KclError> {
    let sketch_surface = match sketch_surface_or_group {
        SketchSurfaceOrGroup::SketchSurface(surface) => surface,
        SketchSurfaceOrGroup::SketchGroup(group) => group.on,
    };
    let sketch_group =
        crate::std::sketch::inner_start_profile_at([center[0] + radius, center[1]], sketch_surface, None, args.clone())
            .await?;

    let from: Point2d = sketch_group.current_pen_position()?;

    let angle_start = Angle::from_degrees(0.0);
    let angle_end = Angle::from_degrees(360.0);
    let (center, end) = arc_center_and_end(from, angle_start, angle_end, radius);

    if angle_start == angle_end {
        return Err(KclError::Type(KclErrorDetails {
            message: "Arc start and end angles must be different".to_string(),
            source_ranges: vec![args.source_range],
        }));
    }

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

    let current_path = Path::Circle {
        base: BasePath {
            from: center.into(),
            // to: end.into(),
            to: center.into(),
            tag: tag.clone(),
            geo_meta: GeoMeta {
                id,
                metadata: args.source_range.into(),
            },
        },
        radius,
        center: center.into(),
        ccw: angle_start.degrees() < angle_end.degrees(),
    };

    let mut new_sketch_group = sketch_group.clone();
    if let Some(tag) = &tag {
        new_sketch_group.add_tag(tag, &current_path);
    }

    new_sketch_group.value.push(current_path);

    args.batch_modeling_cmd(
        id,
        ModelingCmd::ClosePath {
            path_id: new_sketch_group.id,
        },
    )
    .await?;

    Ok(new_sketch_group)
}
