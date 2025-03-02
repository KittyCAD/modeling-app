//! Standard library mirror.

use anyhow::Result;
use kcl_derive_docs::stdlib;
use kcmc::{each_cmd as mcmd, ModelingCmd};
use kittycad_modeling_cmds::{self as kcmc};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::{
    errors::KclError,
    execution::{ExecState, KclValue, Sketch, SketchSet},
    std::{axis_or_reference::Axis2dOrEdgeReference, Args},
};

/// Data for a mirror.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct Mirror2dData {
    /// Axis to use as mirror.
    pub axis: Axis2dOrEdgeReference,
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
/// sketch001 = startSketchOn('XZ')
///     |> startProfileAt([0, 10], %)
///     |> line(end = [15, 0])
///     |> line(end = [-7, -3])
///     |> line(end = [9, -1])
///     |> line(end = [-8, -5])
///     |> line(end = [9, -3])
///     |> line(end = [-8, -3])
///     |> line(end = [9, -1])
///     |> line(end = [-19, -0])
///     |> mirror2d({axis = 'Y'}, %)
///
/// example = extrude(sketch001, length = 10)
/// ```
///
/// ```no_run
/// // Mirror a un-closed sketch across the Y axis.
/// sketch001 = startSketchOn('XZ')
///     |> startProfileAt([0, 8.5], %)
///     |> line(end = [20, -8.5])
///     |> line(end = [-20, -8.5])
///     |> mirror2d({axis = 'Y'}, %)
///
/// example = extrude(sketch001, length = 10)
/// ```
///
/// ```no_run
/// // Mirror a un-closed sketch across an edge.
/// helper001 = startSketchOn('XZ')
///  |> startProfileAt([0, 0], %)
///  |> line(end = [0, 10], tag = $edge001)
///
/// sketch001 = startSketchOn('XZ')
///     |> startProfileAt([0, 8.5], %)
///     |> line(end = [20, -8.5])
///     |> line(end = [-20, -8.5])
///     |> mirror2d({axis = edge001}, %)
///
/// // example = extrude(sketch001, length = 10)
/// ```
///
/// ```no_run
/// // Mirror an un-closed sketch across a custom axis.
/// sketch001 = startSketchOn('XZ')
///     |> startProfileAt([0, 8.5], %)
///     |> line(end = [20, -8.5])
///     |> line(end = [-20, -8.5])
///     |> mirror2d({
///   axis = {
///     custom = {
///       axis = [0.0, 1.0],
///       origin = [0.0, 0.0]
///     }
///   }
/// }, %)
///
/// example = extrude(sketch001, length = 10)
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

    if args.ctx.no_engine_commands().await {
        return Ok(starting_sketches);
    }

    match data.axis {
        Axis2dOrEdgeReference::Axis(axis) => {
            let (axis, origin) = axis.axis_and_origin()?;

            args.batch_modeling_cmd(
                exec_state.next_uuid(),
                ModelingCmd::from(mcmd::EntityMirror {
                    ids: starting_sketches.iter().map(|sketch| sketch.id).collect(),
                    axis,
                    point: origin,
                }),
            )
            .await?;
        }
        Axis2dOrEdgeReference::Edge(edge) => {
            let edge_id = edge.get_engine_id(exec_state, &args)?;

            args.batch_modeling_cmd(
                exec_state.next_uuid(),
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
