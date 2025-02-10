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
    std::{axis_or_reference::Axis2dOrEdgeReference, extrude::do_post_extrude, fillet::default_tolerance, Args},
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
    pub axis: Axis2dOrEdgeReference,
    /// Tolerance for the revolve operation.
    #[serde(default)]
    pub tolerance: Option<f64>,
}

/// Revolve a sketch around an axis.
pub async fn revolve(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let (data, sketch): (RevolveData, Sketch) = args.get_data_and_sketch()?;

    let value = inner_revolve(data, sketch, exec_state, args).await?;
    Ok(KclValue::Solid { value })
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
///     |> line(end = [2, 0])
///     |> line(end = [0, -6])
///     |> line(end = [4, -6])
///     |> line(end = [0, -6])
///     |> line(end = [-3.75, -4.5])
///     |> line(end = [0, -5.5])
///     |> line(end = [-2, 0])
///     |> close()
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
///     |> line(end = [2, 0])
///     |> line(end = [0, -6])
///     |> line(end = [4, -6])
///     |> line(end = [0, -6])
///     |> line(end = [-3.75, -4.5])
///     |> line(end = [0, -5.5])
///     |> line(end = [-2, 0])
///     |> close()
///     |> revolve({axis = 'y', angle = 180}, %)
/// ```
///
/// ```no_run
/// part001 = startSketchOn('XY')
///     |> startProfileAt([4, 12], %)
///     |> line(end = [2, 0])
///     |> line(end = [0, -6])
///     |> line(end = [4, -6])
///     |> line(end = [0, -6])
///     |> line(end = [-3.75, -4.5])
///     |> line(end = [0, -5.5])
///     |> line(end = [-2, 0])
///     |> close()
///     |> revolve({axis = 'y', angle = 180}, %)
/// part002 = startSketchOn(part001, 'end')
///     |> startProfileAt([4.5, -5], %)
///     |> line(end = [0, 5])
///     |> line(end = [5, 0])
///     |> line(end = [0, -5])
///     |> close()
///     |> extrude(length = 5)
/// ```
///
/// ```no_run
/// box = startSketchOn('XY')
///     |> startProfileAt([0, 0], %)
///     |> line(end = [0, 20])
///     |> line(end = [20, 0])
///     |> line(end = [0, -20])
///     |> close()
///     |> extrude(length = 20)
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
///     |> line(end = [0, 20])
///     |> line(end = [20, 0])
///     |> line(end = [0, -20], tag = $revolveAxis)
///     |> close()
///     |> extrude(length = 20)
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
///     |> line(end = [0, 20])
///     |> line(end = [20, 0])
///     |> line(end = [0, -20], tag = $revolveAxis)
///     |> close()
///     |> extrude(length = 20)
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
///   |> line(end = [5, -5])
///   |> line(end = [5, 5])
///   |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
///   |> close()
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
        Axis2dOrEdgeReference::Axis(axis) => {
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
        Axis2dOrEdgeReference::Edge(edge) => {
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

    do_post_extrude(sketch, id.into(), 0.0, exec_state, args).await
}
