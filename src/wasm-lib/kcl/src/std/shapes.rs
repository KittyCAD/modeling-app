//! Standard library shapes.

use anyhow::Result;
use derive_docs::stdlib;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::{
    errors::KclError,
    executor::MemoryItem,
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
pub async fn circle(args: Args) -> Result<MemoryItem, KclError> {
    let (center, radius, sketch_surface_or_group, tag): ([f64; 2], f64, SketchSurfaceOrGroup, Option<String>) =
        args.get_circle_args()?;

    let sketch_group = inner_circle(center, radius, tag, sketch_surface_or_group, args).await?;
    Ok(MemoryItem::SketchGroup(sketch_group))
}

/// Sketch a circle.
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
#[stdlib {
    name = "circle",
}]
async fn inner_circle(
    center: [f64; 2],
    radius: f64,
    tag: Option<String>,
    sketch_surface_or_group: SketchSurfaceOrGroup,
    args: Args,
) -> Result<Box<SketchGroup>, KclError> {
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
