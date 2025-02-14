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
    std::{axis_or_reference::Axis3dOrEdgeReference, Args},
};

/// Create a helix.
pub async fn helix(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let angle_start = args.get_kw_arg("angleStart")?;
    let revolutions = args.get_kw_arg("revolutions")?;
    let ccw = args.get_kw_arg_opt("ccw")?;
    let radius = args.get_kw_arg("radius")?;
    let axis = args.get_kw_arg("axis")?;
    let length = args.get_kw_arg_opt("length")?;

    let value = inner_helix(revolutions, angle_start, ccw, radius, axis, length, exec_state, args).await?;
    Ok(KclValue::Helix { value })
}

/// Create a helix.
///
/// ```no_run
/// // Create a helix around the Z axis.
/// helixPath = helix(
///     angleStart = 0,
///     ccw = true,
///     revolutions = 5,
///     length = 10,
///     radius = 5,
///     axis = 'Z',
///  )
///
///
/// // Create a spring by sweeping around the helix path.
/// springSketch = startSketchOn('YZ')
///     |> circle({ center = [0, 0], radius = 0.5 }, %)
///     |> sweep(path = helixPath)
/// ```
///
/// ```no_run
/// // Create a helix around an edge.
/// helper001 = startSketchOn('XZ')
///  |> startProfileAt([0, 0], %)
///  |> line(end = [0, 10], tag = $edge001)
///
/// helixPath = helix(
///     angleStart = 0,
///     ccw = true,
///     revolutions = 5,
///     length = 10,
///     radius = 5,
///     axis = edge001,
///  )
///
/// // Create a spring by sweeping around the helix path.
/// springSketch = startSketchOn('XY')
///     |> circle({ center = [0, 0], radius = 0.5 }, %)
///     |> sweep(path = helixPath)
/// ```
///
/// ```no_run
/// // Create a helix around a custom axis.
/// helixPath = helix(
///     angleStart = 0,
///     ccw = true,
///     revolutions = 5,
///     length = 10,
///     radius = 5,
///     axis = {
///         custom = {
///             axis = [0, 0, 1.0],
///             origin = [0, 0.25, 0]
///             }
///         }
///  )
///
/// // Create a spring by sweeping around the helix path.
/// springSketch = startSketchOn('XY')
///     |> circle({ center = [0, 0], radius = 1 }, %)
///     |> sweep(path = helixPath)
/// ```
#[stdlib {
    name = "helix",
    keywords = true,
    unlabeled_first = false,
    args = {
        revolutions = { docs = "Number of revolutions."},
        angle_start = { docs = "Start angle (in degrees)."},
        ccw = { docs = "Is the helix rotation counter clockwise? The default is `false`.", include_in_snippet = false},
        radius = { docs = "Radius of the helix."},
        axis = { docs = "Axis to use for the helix."},
        length = { docs = "Length of the helix. This is not necessary if the helix is created around an edge. If not given the length of the edge is used.", include_in_snippet = true},
    },
    feature_tree_operation = true,
}]
#[allow(clippy::too_many_arguments)]
async fn inner_helix(
    revolutions: f64,
    angle_start: f64,
    ccw: Option<bool>,
    radius: f64,
    axis: Axis3dOrEdgeReference,
    length: Option<f64>,
    exec_state: &mut ExecState,
    args: Args,
) -> Result<Box<HelixValue>, KclError> {
    let id = exec_state.next_uuid();

    let helix_result = Box::new(HelixValue {
        value: id,
        artifact_id: id.into(),
        revolutions,
        angle_start,
        ccw: ccw.unwrap_or(false),
        units: exec_state.length_unit(),
        meta: vec![args.source_range.into()],
    });

    if args.ctx.no_engine_commands() {
        return Ok(helix_result);
    }

    match axis {
        Axis3dOrEdgeReference::Axis(axis) => {
            let (axis, origin) = axis.axis_and_origin()?;

            // Make sure they gave us a length.
            let Some(length) = length else {
                return Err(KclError::Semantic(crate::errors::KclErrorDetails {
                    message: "Length is required when creating a helix around an axis.".to_string(),
                    source_ranges: vec![args.source_range],
                }));
            };

            args.batch_modeling_cmd(
                id,
                ModelingCmd::from(mcmd::EntityMakeHelixFromParams {
                    radius: LengthUnit(radius),
                    is_clockwise: !helix_result.ccw,
                    length: LengthUnit(length),
                    revolutions,
                    start_angle: Angle::from_degrees(angle_start),
                    axis,
                    center: origin,
                }),
            )
            .await?;
        }
        Axis3dOrEdgeReference::Edge(edge) => {
            let edge_id = edge.get_engine_id(exec_state, &args)?;

            args.batch_modeling_cmd(
                id,
                ModelingCmd::from(mcmd::EntityMakeHelixFromEdge {
                    radius: LengthUnit(radius),
                    is_clockwise: !helix_result.ccw,
                    length: length.map(LengthUnit),
                    revolutions,
                    start_angle: Angle::from_degrees(angle_start),
                    edge_id,
                }),
            )
            .await?;
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

    let value = inner_helix_revolutions(data, solid, exec_state, args).await?;
    Ok(KclValue::Solid { value })
}

/// Create a helix on a cylinder.
///
/// ```no_run
/// part001 = startSketchOn('XY')
///   |> circle({ center: [5, 5], radius: 10 }, %)
///   |> extrude(length = 10)
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
