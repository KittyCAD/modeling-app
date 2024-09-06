//! Standard library shapes.

use anyhow::Result;
use derive_docs::stdlib;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::{
    ast::types::TagDeclarator,
    errors::KclError,
    executor::KclValue,
    std::{Args, SketchGroup, SketchSurface},
};

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
    let mut sketch_group =
        crate::std::sketch::inner_start_profile_at([center[0] + radius, center[1]], sketch_surface, None, args.clone())
            .await?;

    // Call arc.
    sketch_group = crate::std::sketch::inner_arc(
        crate::std::sketch::ArcData::AnglesAndRadius {
            angle_start: 0.0,
            angle_end: 360.0,
            radius,
        },
        sketch_group,
        tag,
        args.clone(),
    )
    .await?;

    // Call close.
    crate::std::sketch::inner_close(sketch_group, None, args).await
}
