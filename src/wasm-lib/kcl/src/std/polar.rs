//! Functions related to polar coordinates.

use anyhow::Result;
use derive_docs::stdlib;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::{errors::KclError, executor::MemoryItem, std::Args};

/// Data for polar coordinates.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct PolarCoordsData {
    /// The angle of the line (in degrees).
    pub angle: f64,
    /// The length of the line.
    pub length: f64,
}

/// Convert from polar/sphere coordinates to cartesian coordinates.
pub async fn polar(args: Args) -> Result<MemoryItem, KclError> {
    let data: PolarCoordsData = args.get_data()?;
    let result = inner_polar(&data)?;

    args.make_user_val_from_f64_array(result.to_vec())
}

/// Convert polar/sphere (azimuth, elevation, distance) coordinates to
/// cartesian (x/y/z grid) coordinates.
///
/// ```no_run
/// const exampleSketch = startSketchOn('XZ')
///   |> startProfileAt([0, 0], %)
///   |> line(polar({angle: 30, length: 5}), %, $thing)
///   |> line([0, 5], %)
///   |> line([segEndX(thing), 0], %)
///   |> line([-20, 10], %)
///   |> close(%)
///  
/// const example = extrude(5, exampleSketch)
/// ```
#[stdlib {
    name = "polar",
}]
fn inner_polar(data: &PolarCoordsData) -> Result<[f64; 2], KclError> {
    let angle = data.angle.to_radians();
    let x = data.length * angle.cos();
    let y = data.length * angle.sin();
    Ok([x, y])
}
