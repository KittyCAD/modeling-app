//! Standard library sweep.

use anyhow::Result;
use kcl_derive_docs::stdlib;
use kcmc::{each_cmd as mcmd, length_unit::LengthUnit, ModelingCmd};
use kittycad_modeling_cmds::{self as kcmc};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::{
    errors::KclError,
    execution::{ExecState, Helix, KclValue, Sketch, Solid},
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
    let sketch = args.get_unlabeled_kw_arg("sketch")?;
    let path: SweepPath = args.get_kw_arg("path")?;
    let sectional = args.get_kw_arg_opt("sectional")?;
    let tolerance = args.get_kw_arg_opt("tolerance")?;

    let value = inner_sweep(sketch, path, sectional, tolerance, exec_state, args).await?;
    Ok(KclValue::Solid { value })
}

/// Extrude a sketch along a path.
///
/// This, like extrude, is able to create a 3-dimensional solid from a
/// 2-dimensional sketch. However, unlike extrude, this creates a solid
/// by using the extent of the sketch as its path. This is useful for
/// creating more complex shapes that can't be created with a simple
/// extrusion.
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
#[stdlib {
    name = "sweep",
    feature_tree_operation = true,
    keywords = true,
    unlabeled_first = true,
    args = {
        sketch = { docs = "The sketch that should be swept in space" },
        path = { docs = "The path to sweep the sketch along" },
        sectional = { docs = "If true, the sweep will be broken up into sub-sweeps (extrusions, revolves, sweeps) based on the trajectory path components." },
        tolerance = { docs = "Tolerance for this operation" },
    }
}]
async fn inner_sweep(
    sketch: Sketch,
    path: SweepPath,
    sectional: Option<bool>,
    tolerance: Option<f64>,
    exec_state: &mut ExecState,
    args: Args,
) -> Result<Box<Solid>, KclError> {
    let id = exec_state.next_uuid();
    args.batch_modeling_cmd(
        id,
        ModelingCmd::from(mcmd::Sweep {
            target: sketch.id.into(),
            trajectory: match path {
                SweepPath::Sketch(sketch) => sketch.id.into(),
                SweepPath::Helix(helix) => helix.value.into(),
            },
            sectional: sectional.unwrap_or(false),
            tolerance: LengthUnit(tolerance.unwrap_or(default_tolerance(&args.ctx.settings.units))),
        }),
    )
    .await?;

    do_post_extrude(sketch, id.into(), 0.0, exec_state, args).await
}
