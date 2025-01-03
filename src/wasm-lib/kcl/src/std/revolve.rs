//! Standard library revolution surfaces.

use anyhow::Result;
use derive_docs::stdlib;
use kcmc::{each_cmd as mcmd, length_unit::LengthUnit, shared::Angle, ModelingCmd};
use kittycad_modeling_cmds::{self as kcmc};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::{
    errors::{KclError, KclErrorDetails},
    execution::{ExecState, KclValue, Sketch, Solid},
    std::{
        extrude::do_post_extrude,
        fillet::{default_tolerance, EdgeReference},
        Args,
    },
};

/// Data for revolution surfaces.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
pub struct RevolveData {
    /// Angle to revolve (in degrees). Default is 360.
    #[serde(default)]
    #[schemars(range(min = -360.0, max = 360.0))]
    pub angle: Option<f64>,
    /// Axis of revolution.
    pub axis: AxisOrEdgeReference,
    /// Tolerance for the revolve operation.
    #[serde(default)]
    pub tolerance: Option<f64>,
}

/// Axis or tagged edge.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(untagged)]
pub enum AxisOrEdgeReference {
    /// Axis and origin.
    Axis(AxisAndOrigin),
    /// Tagged edge.
    Edge(EdgeReference),
}

/// Axis and origin.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub enum AxisAndOrigin {
    /// X-axis.
    #[serde(rename = "X", alias = "x")]
    X,
    /// Y-axis.
    #[serde(rename = "Y", alias = "y")]
    Y,
    /// Flip the X-axis.
    #[serde(rename = "-X", alias = "-x")]
    NegX,
    /// Flip the Y-axis.
    #[serde(rename = "-Y", alias = "-y")]
    NegY,
    Custom {
        /// The axis.
        axis: [f64; 2],
        /// The origin.
        origin: [f64; 2],
    },
}

impl AxisAndOrigin {
    /// Get the axis and origin.
    pub fn axis_and_origin(&self) -> Result<(kcmc::shared::Point3d<f64>, kcmc::shared::Point3d<LengthUnit>), KclError> {
        let (axis, origin) = match self {
            AxisAndOrigin::X => ([1.0, 0.0, 0.0], [0.0, 0.0, 0.0]),
            AxisAndOrigin::Y => ([0.0, 1.0, 0.0], [0.0, 0.0, 0.0]),
            AxisAndOrigin::NegX => ([-1.0, 0.0, 0.0], [0.0, 0.0, 0.0]),
            AxisAndOrigin::NegY => ([0.0, -1.0, 0.0], [0.0, 0.0, 0.0]),
            AxisAndOrigin::Custom { axis, origin } => ([axis[0], axis[1], 0.0], [origin[0], origin[1], 0.0]),
        };

        Ok((
            kcmc::shared::Point3d {
                x: axis[0],
                y: axis[1],
                z: axis[2],
            },
            kcmc::shared::Point3d {
                x: LengthUnit(origin[0]),
                y: LengthUnit(origin[1]),
                z: LengthUnit(origin[2]),
            },
        ))
    }
}

/// Revolve a sketch around an axis.
pub async fn revolve(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let (data, sketch): (RevolveData, Sketch) = args.get_data_and_sketch()?;

    let solid = inner_revolve(data, sketch, exec_state, args).await?;
    Ok(KclValue::Solid(solid))
}

/// Rotate a sketch around some provided axis, creating a solid from its extent.
///
/// This, like extrude, is able to create a 3-dimensional solid from a
/// 2-dimensional sketch. However, unlike extrude, this creates a solid
/// by using the extent of the sketch as its revolved around an axis rather
/// than using the extent of the sketch linearly translated through a third
/// dimension.
///
/// Revolve occurs around a local sketch axis rather than a global axis.
///
/// ```no_run
/// part001 = startSketchOn('XY')
///     |> startProfileAt([4, 12], %)
///     |> line([2, 0], %)
///     |> line([0, -6], %)
///     |> line([4, -6], %)
///     |> line([0, -6], %)
///     |> line([-3.75, -4.5], %)
///     |> line([0, -5.5], %)
///     |> line([-2, 0], %)
///     |> close(%)
///     |> revolve({axis = 'y'}, %) // default angle is 360
/// ```
///
/// ```no_run
/// // A donut shape.
/// sketch001 = startSketchOn('XY')
///     |> circle({ center = [15, 0], radius = 5 }, %)
///     |> revolve({
///         angle = 360,
///         axis = 'y'
///     }, %)
/// ```
///
/// ```no_run
/// part001 = startSketchOn('XY')
///     |> startProfileAt([4, 12], %)
///     |> line([2, 0], %)
///     |> line([0, -6], %)
///     |> line([4, -6], %)
///     |> line([0, -6], %)
///     |> line([-3.75, -4.5], %)
///     |> line([0, -5.5], %)
///     |> line([-2, 0], %)
///     |> close(%)
///     |> revolve({axis = 'y', angle = 180}, %)
/// ```
///
/// ```no_run
/// part001 = startSketchOn('XY')
///     |> startProfileAt([4, 12], %)
///     |> line([2, 0], %)
///     |> line([0, -6], %)
///     |> line([4, -6], %)
///     |> line([0, -6], %)
///     |> line([-3.75, -4.5], %)
///     |> line([0, -5.5], %)
///     |> line([-2, 0], %)
///     |> close(%)
///     |> revolve({axis = 'y', angle = 180}, %)
/// part002 = startSketchOn(part001, 'end')
///     |> startProfileAt([4.5, -5], %)
///     |> line([0, 5], %)
///     |> line([5, 0], %)
///     |> line([0, -5], %)
///     |> close(%)
///     |> extrude(5, %)
/// ```
///
/// ```no_run
/// box = startSketchOn('XY')
///     |> startProfileAt([0, 0], %)
///     |> line([0, 20], %)
///     |> line([20, 0], %)
///     |> line([0, -20], %)
///     |> close(%)
///     |> extrude(20, %)
///
/// sketch001 = startSketchOn(box, "END")
///     |> circle({ center = [10,10], radius = 4 }, %)
///     |> revolve({
///         angle = -90,
///         axis = 'y'
///     }, %)
/// ```
///
/// ```no_run
/// box = startSketchOn('XY')
///     |> startProfileAt([0, 0], %)
///     |> line([0, 20], %)
///     |> line([20, 0], %)
///     |> line([0, -20], %, $revolveAxis)
///     |> close(%)
///     |> extrude(20, %)
///
/// sketch001 = startSketchOn(box, "END")
///     |> circle({ center = [10,10], radius = 4 }, %)
///     |> revolve({
///         angle = 90,
///         axis = getOppositeEdge(revolveAxis)
///     }, %)
/// ```
///
/// ```no_run
/// box = startSketchOn('XY')
///     |> startProfileAt([0, 0], %)
///     |> line([0, 20], %)
///     |> line([20, 0], %)
///     |> line([0, -20], %, $revolveAxis)
///     |> close(%)
///     |> extrude(20, %)
///
/// sketch001 = startSketchOn(box, "END")
///     |> circle({ center = [10,10], radius = 4 }, %)
///     |> revolve({
///         angle = 90,
///         axis = getOppositeEdge(revolveAxis),
///         tolerance: 0.0001
///     }, %)
/// ```
///
/// ```no_run
/// sketch001 = startSketchOn('XY')
///   |> startProfileAt([10, 0], %)
///   |> line([5, -5], %)
///   |> line([5, 5], %)
///   |> lineTo([profileStartX(%), profileStartY(%)], %)
///   |> close(%)
///
/// part001 = revolve({
///   axis = {
///     custom: {
///       axis = [0.0, 1.0],
///       origin: [0.0, 0.0]
///     }
///   }
/// }, sketch001)
/// ```
#[stdlib {
    name = "revolve",
    feature_tree_operation = true,
}]
async fn inner_revolve(
    data: RevolveData,
    sketch: Sketch,
    exec_state: &mut ExecState,
    args: Args,
) -> Result<Box<Solid>, KclError> {
    if let Some(angle) = data.angle {
        // Return an error if the angle is zero.
        // We don't use validate() here because we want to return a specific error message that is
        // nice and we use the other data in the docs, so we still need use the derive above for the json schema.
        if !(-360.0..=360.0).contains(&angle) || angle == 0.0 {
            return Err(KclError::Semantic(KclErrorDetails {
                message: format!("Expected angle to be between -360 and 360 and not 0, found `{}`", angle),
                source_ranges: vec![args.source_range],
            }));
        }
    }

    let angle = Angle::from_degrees(data.angle.unwrap_or(360.0));

    let id = exec_state.next_uuid();
    match data.axis {
        AxisOrEdgeReference::Axis(axis) => {
            let (axis, origin) = axis.axis_and_origin()?;
            args.batch_modeling_cmd(
                id,
                ModelingCmd::from(mcmd::Revolve {
                    angle,
                    target: sketch.id.into(),
                    axis,
                    origin,
                    tolerance: LengthUnit(data.tolerance.unwrap_or(default_tolerance(&args.ctx.settings.units))),
                    axis_is_2d: true,
                }),
            )
            .await?;
        }
        AxisOrEdgeReference::Edge(edge) => {
            let edge_id = edge.get_engine_id(exec_state, &args)?;
            args.batch_modeling_cmd(
                id,
                ModelingCmd::from(mcmd::RevolveAboutEdge {
                    angle,
                    target: sketch.id.into(),
                    edge_id,
                    tolerance: LengthUnit(data.tolerance.unwrap_or(default_tolerance(&args.ctx.settings.units))),
                }),
            )
            .await?;
        }
    }

    do_post_extrude(sketch, 0.0, exec_state, args).await
}

#[cfg(test)]
mod tests {

    use pretty_assertions::assert_eq;

    use crate::std::revolve::{AxisAndOrigin, AxisOrEdgeReference};

    #[test]
    fn test_deserialize_revolve_axis() {
        let data = AxisOrEdgeReference::Axis(AxisAndOrigin::X);
        let mut str_json = serde_json::to_string(&data).unwrap();
        assert_eq!(str_json, "\"X\"");

        str_json = "\"Y\"".to_string();
        let data: AxisOrEdgeReference = serde_json::from_str(&str_json).unwrap();
        assert_eq!(data, AxisOrEdgeReference::Axis(AxisAndOrigin::Y));

        str_json = "\"-Y\"".to_string();
        let data: AxisOrEdgeReference = serde_json::from_str(&str_json).unwrap();
        assert_eq!(data, AxisOrEdgeReference::Axis(AxisAndOrigin::NegY));

        str_json = "\"-x\"".to_string();
        let data: AxisOrEdgeReference = serde_json::from_str(&str_json).unwrap();
        assert_eq!(data, AxisOrEdgeReference::Axis(AxisAndOrigin::NegX));

        let data = AxisOrEdgeReference::Axis(AxisAndOrigin::Custom {
            axis: [0.0, -1.0],
            origin: [1.0, 0.0],
        });
        str_json = serde_json::to_string(&data).unwrap();
        assert_eq!(str_json, r#"{"custom":{"axis":[0.0,-1.0],"origin":[1.0,0.0]}}"#);

        str_json = r#"{"custom": {"axis": [0,-1], "origin": [1,2.0]}}"#.to_string();
        let data: AxisOrEdgeReference = serde_json::from_str(&str_json).unwrap();
        assert_eq!(
            data,
            AxisOrEdgeReference::Axis(AxisAndOrigin::Custom {
                axis: [0.0, -1.0],
                origin: [1.0, 2.0]
            })
        );
    }
}
