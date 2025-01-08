//! Standard library helices.

use anyhow::Result;
use derive_docs::stdlib;
use kcmc::{each_cmd as mcmd, length_unit::LengthUnit, shared::Angle, ModelingCmd};
use kittycad_modeling_cmds as kcmc;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::{
    errors::KclError,
    execution::{ExecState, Helix as HelixValue, KclValue, Solid},
    std::{revolve::AxisOrEdgeReference, Args},
};

/// Data for a helix.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
pub struct HelixData {
    /// Number of revolutions.
    pub revolutions: f64,
    /// Start angle (in degrees).
    #[serde(rename = "angleStart")]
    pub angle_start: f64,
    /// Is the helix rotation counter clockwise?
    /// The default is `false`.
    #[serde(default)]
    pub ccw: bool,
    /// Length of the helix.
    pub length: f64,
    /// Radius of the helix.
    pub radius: f64,
    /// Axis to use as mirror.
    pub axis: AxisOrEdgeReference,
}

/// Create a helix.
pub async fn helix(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let data: HelixData = args.get_data()?;

    let helix = inner_helix(data, exec_state, args).await?;
    Ok(KclValue::Helix(helix))
}

/// Create a helix.
///
/// ```no_run
/// // Create a helix around the Y axis.
/// helixPath = helix({
///     angleStart = 0,
///     ccw = true,
///     revolutions = 16,
///     length = 10,
///     radius = 5,
///     axis = 'Y',
///  })
///
///
/// // Create a spring by sweeping around the helix path.
/// springSketch = startSketchOn('YZ')
///     |> circle({ center = [0, 0], radius = 1 }, %)
///     //|> sweep({ path = helixPath }, %)
/// ```
///
/// ```no_run
/// // Create a helix around an edge.
/// /*helper001 = startSketchOn('XZ')
///  |> startProfileAt([0, 0], %)
///  |> line([0, 10], %, $edge001)
///
/// helixPath = helix({
///     angleStart = 0,
///     ccw = true,
///     revolutions = 16,
///     length = 10,
///     radius = 5,
///     axis = edge001,
///  })
///
/// // Create a spring by sweeping around the helix path.
/// springSketch = startSketchOn('XY')
///     |> circle({ center = [0, 0], radius = 2 }, %)
///     |> sweep({ path = helixPath }, %)*/
/// ```
#[stdlib {
    name = "helix",
    feature_tree_operation = true,
}]
async fn inner_helix(data: HelixData, exec_state: &mut ExecState, args: Args) -> Result<Box<HelixValue>, KclError> {
    let id = exec_state.next_uuid();

    let helix_result = Box::new(HelixValue {
        value: id,
        revolutions: data.revolutions,
        angle_start: data.angle_start,
        ccw: data.ccw,
        meta: vec![args.source_range.into()],
    });

    if args.ctx.is_mock() {
        return Ok(helix_result);
    }

    match data.axis {
        AxisOrEdgeReference::Axis(axis) => {
            let (axis, origin) = axis.axis_and_origin()?;

            args.batch_modeling_cmd(
                exec_state.next_uuid(),
                ModelingCmd::from(mcmd::EntityMakeHelixFromParams {
                    radius: data.radius,
                    is_clockwise: !data.ccw,
                    length: LengthUnit(data.length),
                    revolutions: data.revolutions,
                    start_angle: Angle::from_degrees(data.angle_start),
                    axis,
                    center: origin,
                }),
            )
            .await?;
        }
        AxisOrEdgeReference::Edge(_edge) => {
            /*let edge_id = edge.get_engine_id(exec_state, &args)?;

            args.batch_modeling_cmd(
                exec_state.next_uuid(),
                ModelingCmd::from(mcmd::EntityMakeHelixFromEdge {
                    radius: data.radius,
                    is_clockwise: !data.ccw,
                    length: LengthUnit(data.length),
                    revolutions: data.revolutions,
                    start_angle: Angle::from_degrees(data.angle_start),
                    edge_id,
                }),
            )
            .await?;*/
            return Err(KclError::Unimplemented(crate::errors::KclErrorDetails {
                message: "Helix around edge is not yet implemented".to_string(),
                source_ranges: vec![args.source_range],
            }));
        }
    };

    Ok(helix_result)
}

/// Data for helix revolutions.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
pub struct HelixRevolutionsData {
    /// Number of revolutions.
    pub revolutions: f64,
    /// Start angle (in degrees).
    #[serde(rename = "angleStart")]
    pub angle_start: f64,
    /// Is the helix rotation counter clockwise?
    /// The default is `false`.
    #[serde(default)]
    pub ccw: bool,
    /// Length of the helix. If this argument is not provided, the height of
    /// the solid is used.
    pub length: Option<f64>,
}

/// Create a helix on a cylinder.
pub async fn helix_revolutions(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let (data, solid): (HelixRevolutionsData, Box<Solid>) = args.get_data_and_solid()?;

    let solid = inner_helix_revolutions(data, solid, exec_state, args).await?;
    Ok(KclValue::Solid(solid))
}

/// Create a helix on a cylinder.
///
/// ```no_run
/// part001 = startSketchOn('XY')
///   |> circle({ center: [5, 5], radius: 10 }, %)
///   |> extrude(10, %)
///   |> helixRevolutions({
///     angleStart = 0,
///     ccw = true,
///     revolutions = 16,
///  }, %)
/// ```
#[stdlib {
    name = "helixRevolutions",
    feature_tree_operation = true,
}]
async fn inner_helix_revolutions(
    data: HelixRevolutionsData,
    solid: Box<Solid>,
    exec_state: &mut ExecState,
    args: Args,
) -> Result<Box<Solid>, KclError> {
    let id = exec_state.next_uuid();
    args.batch_modeling_cmd(
        id,
        ModelingCmd::from(mcmd::EntityMakeHelix {
            cylinder_id: solid.id,
            is_clockwise: !data.ccw,
            length: LengthUnit(data.length.unwrap_or(solid.height)),
            revolutions: data.revolutions,
            start_angle: Angle::from_degrees(data.angle_start),
        }),
    )
    .await?;

    Ok(solid)
}
