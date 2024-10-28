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
    ast::types::TagDeclarator,
    errors::KclError,
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
    let (data, sketch_surface_or_group, tag): (CircleData, SketchOrSurface, Option<TagDeclarator>) =
        args.get_circle_args()?;

    let sketch = inner_circle(data, sketch_surface_or_group, tag, exec_state, args).await?;
    Ok(KclValue::new_user_val(sketch.meta.clone(), sketch))
}

/// Construct a 2-dimensional circle, of the specified radius, centered at
/// the provided (x, y) origin point.
///
/// ```no_run
/// const exampleSketch = startSketchOn("-XZ")
///   |> circle({ center: [0, 0], radius: 10 }, %)
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
///   |> hole(circle({ center: [0, 15], radius: 5 }, %), %)
///
/// const example = extrude(5, exampleSketch)
/// ```
#[stdlib {
    name = "circle",
}]
async fn inner_circle(
    data: CircleData,
    sketch_surface_or_group: SketchOrSurface,
    tag: Option<TagDeclarator>,
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
