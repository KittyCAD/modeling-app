//! Functions related to polar coordinates.

use anyhow::Result;
use derive_docs::stdlib;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::{
    errors::KclError,
    execution::{ExecState, KclValue},
    std::args::{Args, TyF64},
};

/// Data for polar coordinates.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct PolarCoordsData {
    /// The angle of the line (in degrees).
    pub angle: f64,
    /// The length of the line.
    pub length: TyF64,
}

/// Convert from polar/sphere coordinates to cartesian coordinates.
pub async fn polar(_exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let data: PolarCoordsData = args.get_data()?;
    let result = inner_polar(&data)?;

    args.make_user_val_from_f64_array(result.to_vec(), &data.length.ty)
}

/// Convert polar/sphere (azimuth, elevation, distance) coordinates to
/// cartesian (x/y/z grid) coordinates.
///
/// ```no_run
/// exampleSketch = startSketchOn('XZ')
///   |> startProfileAt([0, 0], %)
///   |> line(end = polar({angle: 30, length: 5}), tag = $thing)
///   |> line(end = [0, 5])
///   |> line(end = [segEndX(thing), 0])
///   |> line(end = [-20, 10])
///   |> close()
///  
/// example = extrude(exampleSketch, length = 5)
/// ```
#[stdlib {
    name = "polar",
}]
fn inner_polar(data: &PolarCoordsData) -> Result<[f64; 2], KclError> {
    let angle = data.angle.to_radians();
    let x = data.length.n * angle.cos();
    let y = data.length.n * angle.sin();
    Ok([x, y])
}
