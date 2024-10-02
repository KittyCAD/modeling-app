//! Standard library mirror.

use anyhow::Result;
use derive_docs::stdlib;
use kcmc::{each_cmd as mcmd, ModelingCmd};
use kittycad_modeling_cmds::{self as kcmc};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::{
    errors::KclError,
    executor::{ExecState, KclValue, Sketch, SketchSet},
    std::{revolve::AxisOrEdgeReference, Args},
};

/// Data for a mirror.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct Mirror2dData {
    /// Axis to use as mirror.
    pub axis: AxisOrEdgeReference,
}

/// Mirror a sketch.
///
/// Only works on unclosed sketches for now.
pub async fn mirror_2d(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let (data, sketch_set): (Mirror2dData, SketchSet) = args.get_data_and_sketch_set()?;

    let sketches = inner_mirror_2d(data, sketch_set, exec_state, args).await?;
    Ok(sketches.into())
}

/// Mirror a sketch.
///
/// Only works on unclosed sketches for now.
///
/// Mirror occurs around a local sketch axis rather than a global axis.
///
/// ```no_run
/// // Mirror an un-closed sketch across the Y axis.
/// const sketch001 = startSketchOn('XZ')
///     |> startProfileAt([0, 10], %)
///     |> line([15, 0], %)
///     |> line([-7, -3], %)
///     |> line([9, -1], %)
///     |> line([-8, -5], %)
///     |> line([9, -3], %)
///     |> line([-8, -3], %)
///     |> line([9, -1], %)
///     |> line([-19, -0], %)
///     |> mirror2d({axis: 'Y'}, %)
///
/// const example = extrude(10, sketch001)
/// ```
///
/// ```no_run
/// // Mirror a un-closed sketch across the Y axis.
/// const sketch001 = startSketchOn('XZ')
///     |> startProfileAt([0, 8.5], %)
///     |> line([20, -8.5], %)
///     |> line([-20, -8.5], %)
///     |> mirror2d({axis: 'Y'}, %)
///
/// const example = extrude(10, sketch001)
/// ```
///
/// ```no_run
/// // Mirror a un-closed sketch across an edge.
/// const helper001 = startSketchOn('XZ')
///  |> startProfileAt([0, 0], %)
///  |> line([0, 10], %, $edge001)
///
/// const sketch001 = startSketchOn('XZ')
///     |> startProfileAt([0, 8.5], %)
///     |> line([20, -8.5], %)
///     |> line([-20, -8.5], %)
///     |> mirror2d({axis: edge001}, %)
///
/// const example = extrude(10, sketch001)
/// ```
///
/// ```no_run
/// // Mirror an un-closed sketch across a custom axis.
/// const sketch001 = startSketchOn('XZ')
///     |> startProfileAt([0, 8.5], %)
///     |> line([20, -8.5], %)
///     |> line([-20, -8.5], %)
///     |> mirror2d({
///   axis: {
///     custom: {
///       axis: [0.0, 1.0],
///       origin: [0.0, 0.0]
///     }
///   }
/// }, %)
///
/// const example = extrude(10, sketch001)
/// ```
#[stdlib {
    name = "mirror2d",
}]
async fn inner_mirror_2d(
    data: Mirror2dData,
    sketch_set: SketchSet,
    exec_state: &mut ExecState,
    args: Args,
) -> Result<Vec<Box<Sketch>>, KclError> {
    let starting_sketches = match sketch_set {
        SketchSet::Sketch(sketch) => vec![sketch],
        SketchSet::Sketches(sketches) => sketches,
    };

    if args.ctx.is_mock() {
        return Ok(starting_sketches);
    }

    match data.axis {
        AxisOrEdgeReference::Axis(axis) => {
            let (axis, origin) = axis.axis_and_origin()?;

            args.batch_modeling_cmd(
                uuid::Uuid::new_v4(),
                ModelingCmd::from(mcmd::EntityMirror {
                    ids: starting_sketches.iter().map(|sketch| sketch.id).collect(),
                    axis,
                    point: origin,
                }),
            )
            .await?;
        }
        AxisOrEdgeReference::Edge(edge) => {
            let edge_id = edge.get_engine_id(exec_state, &args)?;

            args.batch_modeling_cmd(
                uuid::Uuid::new_v4(),
                ModelingCmd::from(mcmd::EntityMirrorAcrossEdge {
                    ids: starting_sketches.iter().map(|sketch| sketch.id).collect(),
                    edge_id,
                }),
            )
            .await?;
        }
    };

    Ok(starting_sketches)
}
