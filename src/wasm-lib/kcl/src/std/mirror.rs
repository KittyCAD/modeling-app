//! Standard library mirror.

use anyhow::Result;
use derive_docs::stdlib;
use kittycad::types::ModelingCmd;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::{
    errors::KclError,
    executor::{KclValue, SketchGroup, SketchGroupSet},
    std::{revolve::AxisOrEdgeReference, Args},
};

/// Data for a mirror.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct MirrorData {
    /// Axis to use as mirror.
    pub axis: AxisOrEdgeReference,
}

/// Mirror a sketch or set of sketches.
///
/// Only works on 2D sketches for now.
pub async fn mirror(args: Args) -> Result<KclValue, KclError> {
    let (data, sketch_group_set): (MirrorData, SketchGroupSet) = args.get_data_and_sketch_group_set()?;

    let sketch_groups = inner_mirror(data, sketch_group_set, args).await?;
    Ok(sketch_groups.into())
}

/// Mirror a sketch or set of sketches.
///
/// Only works on 2D sketches for now.
///
/// ```no_run
/// const exampleSketch = startSketchOn('XZ')
///     |> startProfileAt([20, 21], %)
///     |> line([0, 10], %)
///     |> line([10, 0], %)
///     |> line([0, -10], %)
///     |> close(%)
///     |> mirror({axis: 'X'}, %)
///
/// const example = extrude(10, exampleSketch)
/// ```
///
/// ```no_run
/// const sketch001 = startSketchOn('XZ')
///   |> circle([20, 20], 1, %)
///   |> mirror({axis: 'Y'}, %)
/// ```
///
/// ```no_run
/// const helper001 = startSketchOn('XZ')
///  |> startProfileAt([0, 0], %)
///  |> line([10, 0], %, $edge001)
///
/// const sketch001 = startSketchOn('XZ')
///  |> circle([20, 20], 1, %)
///  |> mirror({axis: edge001}, %)
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
/// const part001 = mirror({
///   axis: {
///     custom: {
///       axis: [0.0, 1.0, 0.0],
///       origin: [0.0, 0.0, 0.0]
///     }
///   }
/// }, sketch001)
/// ```
#[stdlib {
    name = "mirror",
}]
async fn inner_mirror(
    data: MirrorData,
    sketch_group_set: SketchGroupSet,
    args: Args,
) -> Result<Vec<Box<SketchGroup>>, KclError> {
    let starting_sketch_groups = match sketch_group_set {
        SketchGroupSet::SketchGroup(sketch_group) => vec![sketch_group],
        SketchGroupSet::SketchGroups(sketch_groups) => sketch_groups,
    };

    if args.ctx.is_mock {
        return Ok(starting_sketch_groups);
    }

    match data.axis {
        AxisOrEdgeReference::Axis(axis) => {
            let (axis, origin) = axis.axis_and_origin()?;

            args.batch_modeling_cmd(
                uuid::Uuid::new_v4(),
                ModelingCmd::EntityMirror {
                    ids: starting_sketch_groups
                        .iter()
                        .map(|sketch_group| sketch_group.id)
                        .collect(),
                    axis,
                    point: origin,
                },
            )
            .await?;
        }
        AxisOrEdgeReference::Edge(edge) => {
            let edge_id = edge.get_engine_id(&args)?;
            args.batch_modeling_cmd(
                uuid::Uuid::new_v4(),
                ModelingCmd::EntityMirrorAcrossEdge {
                    ids: starting_sketch_groups
                        .iter()
                        .map(|sketch_group| sketch_group.id)
                        .collect(),
                    edge_id,
                },
            )
            .await?;
        }
    };

    Ok(starting_sketch_groups)
}
