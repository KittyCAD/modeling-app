//! Standard library sweep.

use anyhow::Result;
use derive_docs::stdlib;
use kcmc::{each_cmd as mcmd, length_unit::LengthUnit, ModelingCmd};
use kittycad_modeling_cmds::{self as kcmc};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::{
    errors::KclError,
    execution::{ExecState, KclValue, Sketch, Solid},
    std::{extrude::do_post_extrude, fillet::default_tolerance, Args},
};

/// Data for a sweep.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
pub struct SweepData {
    /// The path to sweep along.
    pub path: Sketch,
    /// If true, the sweep will be broken up into sub-sweeps (extrusions, revolves, sweeps) based on the trajectory path components.
    pub sectional: Option<bool>,
    /// Tolerance for the sweep operation.
    #[serde(default)]
    pub tolerance: Option<f64>,
}

/// Extrude a sketch along a path.
pub async fn sweep(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let (data, sketch): (SweepData, Sketch) = args.get_data_and_sketch()?;

    let solid = inner_sweep(data, sketch, exec_state, args).await?;
    Ok(KclValue::Solid(solid))
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
/// /// Create a pipe using a sweep.
///
/// /// Create a path for the sweep.
/// sweepPath = startSketchOn('XZ')
///     |> startProfileAt([0.05, 0.05], %)
///     |> line([0, 7], %)
///     |> tangentialArc({
///         offset: 90,
///         radius: 5
///     }, %)
///     |> line([-3, 0], %)
///     |> tangentialArc({
///         offset: -90,
///         radius: 5
///     }, %)
///     |> line([0, 7], %)
///
/// sweepSketch = startSketchOn('XY')
///     |> startProfileAt([2, 0], %)
///     |> arc({
///         angle_end: 360,
///         angle_start: 0,
///         radius: 2
///     }, %)
///     |> sweep({
///         path: sweepPath,
///     }, %)   
/// ```
#[stdlib {
    name = "sweep",
}]
async fn inner_sweep(
    data: SweepData,
    sketch: Sketch,
    exec_state: &mut ExecState,
    args: Args,
) -> Result<Box<Solid>, KclError> {
    let id = exec_state.id_generator.next_uuid();
    args.batch_modeling_cmd(
        id,
        ModelingCmd::from(mcmd::Sweep {
            target: sketch.id.into(),
            trajectory: data.path.id.into(),
            sectional: data.sectional.unwrap_or(false),
            tolerance: LengthUnit(data.tolerance.unwrap_or(default_tolerance(&args.ctx.settings.units))),
        }),
    )
    .await?;

    do_post_extrude(sketch, 0.0, exec_state, args).await
}
