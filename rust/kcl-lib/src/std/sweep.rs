//! Standard library sweep.

use anyhow::Result;
use kcl_derive_docs::stdlib;
use kcmc::{each_cmd as mcmd, length_unit::LengthUnit, ModelingCmd};
use kittycad_modeling_cmds::{self as kcmc};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::{
    errors::KclError,
    execution::{types::RuntimeType, ExecState, Helix, KclValue, Sketch, Solid},
    parsing::ast::types::TagNode,
    std::{extrude::do_post_extrude, fillet::default_tolerance, Args},
};

/// A path to sweep along.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(untagged)]
pub enum SweepPath {
    Sketch(Sketch),
    Helix(Box<Helix>),
}

/// Extrude a sketch along a path.
pub async fn sweep(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let sketches = args.get_unlabeled_kw_arg_typed("sketches", &RuntimeType::sketches(), exec_state)?;
    let path: SweepPath = args.get_kw_arg("path")?;
    let sectional = args.get_kw_arg_opt("sectional")?;
    let tolerance = args.get_kw_arg_opt("tolerance")?;
    let tag_start = args.get_kw_arg_opt("tagStart")?;
    let tag_end = args.get_kw_arg_opt("tagEnd")?;

    let value = inner_sweep(
        sketches, path, sectional, tolerance, tag_start, tag_end, exec_state, args,
    )
    .await?;
    Ok(value.into())
}

/// Extrude a sketch along a path.
///
/// This, like extrude, is able to create a 3-dimensional solid from a
/// 2-dimensional sketch. However, unlike extrude, this creates a solid
/// by using the extent of the sketch as its path. This is useful for
/// creating more complex shapes that can't be created with a simple
/// extrusion.
///
/// You can provide more than one sketch to sweep, and they will all be
/// swept along the same path.
///
/// ```no_run
/// // Create a pipe using a sweep.
///
/// // Create a path for the sweep.
/// sweepPath = startSketchOn('XZ')
///     |> startProfileAt([0.05, 0.05], %)
///     |> line(end = [0, 7])
///     |> tangentialArc({
///         offset: 90,
///         radius: 5
///     }, %)
///     |> line(end = [-3, 0])
///     |> tangentialArc({
///         offset: -90,
///         radius: 5
///     }, %)
///     |> line(end = [0, 7])
///
/// // Create a hole for the pipe.
/// pipeHole = startSketchOn('XY')
///     |> circle(
///         center = [0, 0],
///         radius = 1.5,
///     )
///
/// sweepSketch = startSketchOn('XY')
///     |> circle(
///         center = [0, 0],
///         radius = 2,
///         )              
///     |> hole(pipeHole, %)
///     |> sweep(path = sweepPath)   
/// ```
///
/// ```no_run
/// // Create a spring by sweeping around a helix path.
///
/// // Create a helix around the Z axis.
/// helixPath = helix(
///     angleStart = 0,
///     ccw = true,
///     revolutions = 4,
///     length = 10,
///     radius = 5,
///     axis = 'Z',
///  )
///
///
/// // Create a spring by sweeping around the helix path.
/// springSketch = startSketchOn('YZ')
///     |> circle( center = [0, 0], radius = 1)
///     |> sweep(path = helixPath)
/// ```
///
/// ```
/// // Sweep two sketches along the same path.
///
/// sketch001 = startSketchOn('XY')
/// rectangleSketch = startProfileAt([-200, 23.86], sketch001)
///     |> angledLine([0, 73.47], %, $rectangleSegmentA001)
///     |> angledLine([
///         segAng(rectangleSegmentA001) - 90,
///         50.61
///     ], %)
///     |> angledLine([
///         segAng(rectangleSegmentA001),
///         -segLen(rectangleSegmentA001)
///     ], %)
///     |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
///     |> close()
///
/// circleSketch = circle(sketch001, center = [200, -30.29], radius = 32.63)
///
/// sketch002 = startSketchOn('YZ')
/// sweepPath = startProfileAt([0, 0], sketch002)
///     |> yLine(length = 231.81)
///     |> tangentialArc({
///         radius = 80,
///         offset = -90,
///     }, %)
///     |> xLine(length = 384.93)
///
/// sweep([rectangleSketch, circleSketch], path = sweepPath)
/// ```
#[stdlib {
    name = "sweep",
    feature_tree_operation = true,
    keywords = true,
    unlabeled_first = true,
    args = {
        sketches = { docs = "The sketch or set of sketches that should be swept in space" },
        path = { docs = "The path to sweep the sketch along" },
        sectional = { docs = "If true, the sweep will be broken up into sub-sweeps (extrusions, revolves, sweeps) based on the trajectory path components." },
        tolerance = { docs = "Tolerance for this operation" },
        tag_start = { docs = "A named tag for the face at the start of the sweep, i.e. the original sketch" },
        tag_end = { docs = "A named tag for the face at the end of the sweep" },
    }
}]
#[allow(clippy::too_many_arguments)]
async fn inner_sweep(
    sketches: Vec<Sketch>,
    path: SweepPath,
    sectional: Option<bool>,
    tolerance: Option<f64>,
    tag_start: Option<TagNode>,
    tag_end: Option<TagNode>,
    exec_state: &mut ExecState,
    args: Args,
) -> Result<Vec<Solid>, KclError> {
    let trajectory = match path {
        SweepPath::Sketch(sketch) => sketch.id.into(),
        SweepPath::Helix(helix) => helix.value.into(),
    };

    let mut solids = Vec::new();
    for sketch in &sketches {
        let id = exec_state.next_uuid();
        args.batch_modeling_cmd(
            id,
            ModelingCmd::from(mcmd::Sweep {
                target: sketch.id.into(),
                trajectory,
                sectional: sectional.unwrap_or(false),
                tolerance: LengthUnit(tolerance.unwrap_or(default_tolerance(&args.ctx.settings.units))),
            }),
        )
        .await?;

        solids.push(
            do_post_extrude(
                sketch,
                id.into(),
                0.0,
                sectional.unwrap_or(false),
                &super::extrude::NamedCapTags {
                    start: tag_start.as_ref(),
                    end: tag_end.as_ref(),
                },
                exec_state,
                &args,
            )
            .await?,
        );
    }

    Ok(solids)
}
