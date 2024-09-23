//! Standard library helices.

use anyhow::Result;
use derive_docs::stdlib;
use kcmc::{each_cmd as mcmd, length_unit::LengthUnit, shared::Angle, ModelingCmd};
use kittycad_modeling_cmds as kcmc;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::{
    errors::KclError,
    executor::{ExecState, ExtrudeGroup, KclValue},
    std::Args,
};

/// Data for helices.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
pub struct HelixData {
    /// Number of revolutions.
    pub revolutions: f64,
    /// Start angle (in degrees).
    #[serde(rename = "angleStart", alias = "angle_start")]
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
pub async fn helix(_exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let (data, extrude_group): (HelixData, Box<ExtrudeGroup>) = args.get_data_and_extrude_group()?;

    let extrude_group = inner_helix(data, extrude_group, args).await?;
    Ok(KclValue::ExtrudeGroup(extrude_group))
}

/// Create a helix on a cylinder.
///
/// ```no_run
/// const part001 = startSketchOn('XY')
///   |> circle({ center: [5, 5], radius: 10 }, %)
///   |> extrude(10, %)
///   |> helix({
///     angleStart: 0,
///     ccw: true,
///     revolutions: 16,
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
    args.batch_modeling_cmd(
        id,
        ModelingCmd::from(mcmd::EntityMakeHelix {
            cylinder_id: extrude_group.id,
            is_clockwise: !data.ccw,
            length: LengthUnit(data.length.unwrap_or(extrude_group.height)),
            revolutions: data.revolutions,
            start_angle: Angle::from_degrees(data.angle_start),
        }),
    )
    .await?;

    Ok(extrude_group)
}
