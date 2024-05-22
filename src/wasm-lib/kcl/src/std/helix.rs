//! Standard library helices.

use anyhow::Result;
use derive_docs::stdlib;
use kittycad::types::ModelingCmd;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::{
    errors::KclError,
    executor::{ExtrudeGroup, MemoryItem},
    std::Args,
};

/// Data for helices.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
pub struct HelixData {
    /// Number of revolutions.
    pub revolutions: f64,
    /// Start angle (in degrees).
    pub angle_start: f64,
    /// Is the helix rotation counter clockwise?
    /// The default is `false`.
    #[serde(default)]
    pub ccw: bool,
    /// Length of the helix. If this argument is not provided, the height of
    /// the extrude group is used.
    pub length: Option<f64>,
}

/// Create a helix on a cylinder.
pub async fn helix(args: Args) -> Result<MemoryItem, KclError> {
    let (data, extrude_group): (HelixData, Box<ExtrudeGroup>) = args.get_data_and_extrude_group()?;

    let extrude_group = inner_helix(data, extrude_group, args).await?;
    Ok(MemoryItem::ExtrudeGroup(extrude_group))
}

/// Create a helix on a cylinder.
///
/// ```no_run
/// const part001 = startSketchOn('XY')
///   |> circle([5, 5], 10, %)
///   |> extrude(10, %)
///   |> helix({
///     angle_start: 0,
///     ccw: true,
///     revolutions: 16,
///     angle_start: 0
///  }, %)
/// ```
#[stdlib {
    name = "helix",
}]
async fn inner_helix(
    data: HelixData,
    extrude_group: Box<ExtrudeGroup>,
    args: Args,
) -> Result<Box<ExtrudeGroup>, KclError> {
    let id = uuid::Uuid::new_v4();
    args.send_modeling_cmd(
        id,
        ModelingCmd::EntityMakeHelix {
            cylinder_id: extrude_group.id,
            is_clockwise: !data.ccw,
            length: data.length.unwrap_or(extrude_group.height),
            revolutions: data.revolutions,
            start_angle: kittycad::types::Angle::from_degrees(data.angle_start),
        },
    )
    .await?;

    Ok(extrude_group)
}
