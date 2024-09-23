//! Standard library revolution surfaces.

use anyhow::Result;
use derive_docs::stdlib;
use kcmc::{each_cmd as mcmd, length_unit::LengthUnit, shared::Angle, ModelingCmd};
use kittycad_modeling_cmds::{self as kcmc};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::{
    errors::{KclError, KclErrorDetails},
    executor::{ExecState, ExtrudeGroup, KclValue, SketchGroup},
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
    pub angle: Option<f64>,
    /// Axis of revolution.
    pub axis: RevolveAxis,
    /// Tolerance for the revolve operation.
    #[serde(default)]
    pub tolerance: Option<f64>,
}

/// Axis of revolution or tagged edge.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(untagged)]
pub enum RevolveAxis {
    /// Axis of revolution.
    Axis(RevolveAxisAndOrigin),
    /// Tagged edge.
    Edge(EdgeReference),
}

/// Axis of revolution.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub enum RevolveAxisAndOrigin {
    /// X-axis.
    #[serde(rename = "X", alias = "x")]
    X,
    /// Y-axis.
    #[serde(rename = "Y", alias = "y")]
    Y,
    /// Z-axis.
    #[serde(rename = "Z", alias = "z")]
    Z,
    /// Flip the X-axis.
    #[serde(rename = "-X", alias = "-x")]
    NegX,
    /// Flip the Y-axis.
    #[serde(rename = "-Y", alias = "-y")]
    NegY,
    /// Flip the Z-axis.
    #[serde(rename = "-Z", alias = "-z")]
    NegZ,
    Custom {
        /// The axis.
        axis: [f64; 3],
        /// The origin.
        origin: [f64; 3],
    },
}

impl RevolveAxisAndOrigin {
    /// Get the axis and origin.
    pub fn axis_and_origin(&self) -> Result<(kcmc::shared::Point3d<f64>, kcmc::shared::Point3d<LengthUnit>), KclError> {
        let (axis, origin) = match self {
            RevolveAxisAndOrigin::X => ([1.0, 0.0, 0.0], [0.0, 0.0, 0.0]),
            RevolveAxisAndOrigin::Y => ([0.0, 1.0, 0.0], [0.0, 0.0, 0.0]),
            RevolveAxisAndOrigin::Z => ([0.0, 0.0, 1.0], [0.0, 0.0, 0.0]),
            RevolveAxisAndOrigin::NegX => ([-1.0, 0.0, 0.0], [0.0, 0.0, 0.0]),
            RevolveAxisAndOrigin::NegY => ([0.0, -1.0, 0.0], [0.0, 0.0, 0.0]),
            RevolveAxisAndOrigin::NegZ => ([0.0, 0.0, -1.0], [0.0, 0.0, 0.0]),
            RevolveAxisAndOrigin::Custom { axis, origin } => (*axis, *origin),
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
    let (data, sketch_group): (RevolveData, SketchGroup) = args.get_data_and_sketch_group()?;

    let extrude_group = inner_revolve(data, sketch_group, exec_state, args).await?;
    Ok(KclValue::ExtrudeGroup(extrude_group))
}

/// Rotate a sketch around some provided axis, creating a solid from its extent.
///
/// This, like extrude, is able to create a 3-dimensional solid from a
/// 2-dimensional sketch. However, unlike extrude, this creates a solid
/// by using the extent of the sketch as its revolved around an axis rather
/// than using the extent of the sketch linearly translated through a third
/// dimension.
///
/// ```no_run
/// const part001 = startSketchOn('XY')
///     |> startProfileAt([4, 12], %)
///     |> line([2, 0], %)
///     |> line([0, -6], %)
///     |> line([4, -6], %)
///     |> line([0, -6], %)
///     |> line([-3.75, -4.5], %)
///     |> line([0, -5.5], %)
///     |> line([-2, 0], %)
///     |> close(%)
///     |> revolve({axis: 'y'}, %) // default angle is 360
/// ```
///
/// ```no_run
/// // A donut shape.
/// const sketch001 = startSketchOn('XY')
///     |> circle({ center: [15, 0], radius: 5 }, %)
///     |> revolve({
///         angle: 360,
///         axis: 'y'
///     }, %)
/// ```
///
/// ```no_run
/// const part001 = startSketchOn('XY')
///     |> startProfileAt([4, 12], %)
///     |> line([2, 0], %)
///     |> line([0, -6], %)
///     |> line([4, -6], %)
///     |> line([0, -6], %)
///     |> line([-3.75, -4.5], %)
///     |> line([0, -5.5], %)
///     |> line([-2, 0], %)
///     |> close(%)
///     |> revolve({axis: 'y', angle: 180}, %)
/// ```
///
/// ```no_run
/// const part001 = startSketchOn('XY')
///     |> startProfileAt([4, 12], %)
///     |> line([2, 0], %)
///     |> line([0, -6], %)
///     |> line([4, -6], %)
///     |> line([0, -6], %)
///     |> line([-3.75, -4.5], %)
///     |> line([0, -5.5], %)
///     |> line([-2, 0], %)
///     |> close(%)
///     |> revolve({axis: 'y', angle: 180}, %)
/// const part002 = startSketchOn(part001, 'end')
///     |> startProfileAt([4.5, -5], %)
///     |> line([0, 5], %)
///     |> line([5, 0], %)
///     |> line([0, -5], %)
///     |> close(%)
///     |> extrude(5, %)
/// ```
///
/// ```no_run
/// const box = startSketchOn('XY')
///     |> startProfileAt([0, 0], %)
///     |> line([0, 20], %)
///     |> line([20, 0], %)
///     |> line([0, -20], %)
///     |> close(%)
///     |> extrude(20, %)
///
/// const sketch001 = startSketchOn(box, "END")
///     |> circle({ center: [10,10], radius: 4 }, %)
///     |> revolve({
///         angle: -90,
///         axis: 'y'
///     }, %)
/// ```
///
/// ```no_run
/// const box = startSketchOn('XY')
///     |> startProfileAt([0, 0], %)
///     |> line([0, 20], %)
///     |> line([20, 0], %)
///     |> line([0, -20], %, $revolveAxis)
///     |> close(%)
///     |> extrude(20, %)
///
/// const sketch001 = startSketchOn(box, "END")
///     |> circle({ center: [10,10], radius: 4 }, %)
///     |> revolve({
///         angle: 90,
///         axis: getOppositeEdge(revolveAxis)
///     }, %)
/// ```
///
/// ```no_run
/// const box = startSketchOn('XY')
///     |> startProfileAt([0, 0], %)
///     |> line([0, 20], %)
///     |> line([20, 0], %)
///     |> line([0, -20], %, $revolveAxis)
///     |> close(%)
///     |> extrude(20, %)
///
/// const sketch001 = startSketchOn(box, "END")
///     |> circle({ center: [10,10], radius: 4 }, %)
///     |> revolve({
///         angle: 90,
///         axis: getOppositeEdge(revolveAxis),
///         tolerance: 0.0001
///     }, %)
/// ```
///
/// ```no_run
/// const sketch001 = startSketchOn('XY')
///   |> startProfileAt([10, 0], %)
///   |> line([5, -5], %)
///   |> line([5, 5], %)
///   |> lineTo([profileStartX(%), profileStartY(%)], %)
///   |> close(%)
///
/// const part001 = revolve({
///   axis: {
///     custom: {
///       axis: [0.0, 1.0, 0.0],
///       origin: [0.0, 0.0, 0.0]
///     }
///   }
/// }, sketch001)
/// ```
#[stdlib {
    name = "revolve",
}]
async fn inner_revolve(
    data: RevolveData,
    sketch_group: SketchGroup,
    exec_state: &mut ExecState,
    args: Args,
) -> Result<Box<ExtrudeGroup>, KclError> {
    if let Some(angle) = data.angle {
        // Return an error if the angle is less than -360 or greater than 360.
        if !(-360.0..=360.0).contains(&angle) {
            return Err(KclError::Semantic(KclErrorDetails {
                message: format!("Expected angle to be between -360 and 360, found `{}`", angle),
                source_ranges: vec![args.source_range],
            }));
        }
    }

    let angle = Angle::from_degrees(data.angle.unwrap_or(360.0));

    let id = uuid::Uuid::new_v4();
    match data.axis {
        RevolveAxis::Axis(axis) => {
            let (axis, origin) = axis.axis_and_origin()?;
            args.batch_modeling_cmd(
                id,
                ModelingCmd::from(mcmd::Revolve {
                    angle,
                    target: sketch_group.id.into(),
                    axis,
                    origin,
                    tolerance: LengthUnit(data.tolerance.unwrap_or(default_tolerance(&args.ctx.settings.units))),
                    axis_is_2d: true,
                }),
            )
            .await?;
        }
        RevolveAxis::Edge(edge) => {
            let edge_id = match edge {
                EdgeReference::Uuid(uuid) => uuid,
                EdgeReference::Tag(tag) => args.get_tag_engine_info(exec_state, &tag)?.id,
            };
            args.batch_modeling_cmd(
                id,
                ModelingCmd::from(mcmd::RevolveAboutEdge {
                    angle,
                    target: sketch_group.id.into(),
                    edge_id,
                    tolerance: LengthUnit(data.tolerance.unwrap_or(default_tolerance(&args.ctx.settings.units))),
                }),
            )
            .await?;
        }
    }

    do_post_extrude(sketch_group, 0.0, args).await
}

#[cfg(test)]
mod tests {

    use pretty_assertions::assert_eq;

    use crate::std::revolve::{RevolveAxis, RevolveAxisAndOrigin};

    #[test]
    fn test_deserialize_revolve_axis() {
        let data = RevolveAxis::Axis(RevolveAxisAndOrigin::X);
        let mut str_json = serde_json::to_string(&data).unwrap();
        assert_eq!(str_json, "\"X\"");

        str_json = "\"Y\"".to_string();
        let data: RevolveAxis = serde_json::from_str(&str_json).unwrap();
        assert_eq!(data, RevolveAxis::Axis(RevolveAxisAndOrigin::Y));

        str_json = "\"-Y\"".to_string();
        let data: RevolveAxis = serde_json::from_str(&str_json).unwrap();
        assert_eq!(data, RevolveAxis::Axis(RevolveAxisAndOrigin::NegY));

        str_json = "\"-x\"".to_string();
        let data: RevolveAxis = serde_json::from_str(&str_json).unwrap();
        assert_eq!(data, RevolveAxis::Axis(RevolveAxisAndOrigin::NegX));

        let data = RevolveAxis::Axis(RevolveAxisAndOrigin::Custom {
            axis: [0.0, -1.0, 0.0],
            origin: [1.0, 0.0, 2.0],
        });
        str_json = serde_json::to_string(&data).unwrap();
        assert_eq!(str_json, r#"{"custom":{"axis":[0.0,-1.0,0.0],"origin":[1.0,0.0,2.0]}}"#);

        str_json = r#"{"custom": {"axis": [0,-1,0], "origin": [1,0,2.0]}}"#.to_string();
        let data: RevolveAxis = serde_json::from_str(&str_json).unwrap();
        assert_eq!(
            data,
            RevolveAxis::Axis(RevolveAxisAndOrigin::Custom {
                axis: [0.0, -1.0, 0.0],
                origin: [1.0, 0.0, 2.0]
            })
        );
    }
}
