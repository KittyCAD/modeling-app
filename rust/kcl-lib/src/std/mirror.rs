//! Standard library mirror.

use anyhow::Result;
use kcmc::{each_cmd as mcmd, ModelingCmd};
use kittycad_modeling_cmds::{self as kcmc, length_unit::LengthUnit, shared::Point3d};

use crate::{
    errors::KclError,
    execution::{
        types::{PrimitiveType, RuntimeType},
        ExecState, KclValue, Sketch,
    },
    std::{axis_or_reference::Axis2dOrEdgeReference, Args},
};

/// Mirror a sketch.
///
/// Only works on unclosed sketches for now.
pub async fn mirror_2d(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let sketches = args.get_unlabeled_kw_arg_typed("sketches", &RuntimeType::sketches(), exec_state)?;
    let axis = args.get_kw_arg_typed(
        "axis",
        &RuntimeType::Union(vec![
            RuntimeType::Primitive(PrimitiveType::Edge),
            RuntimeType::Primitive(PrimitiveType::Axis2d),
        ]),
        exec_state,
    )?;

    let sketches = inner_mirror_2d(sketches, axis, exec_state, args).await?;
    Ok(sketches.into())
}

/// Mirror a sketch.
///
/// Only works on unclosed sketches for now.
async fn inner_mirror_2d(
    sketches: Vec<Sketch>,
    axis: Axis2dOrEdgeReference,
    exec_state: &mut ExecState,
    args: Args,
) -> Result<Vec<Sketch>, KclError> {
    let mut starting_sketches = sketches.clone();

    // Update all to have a mirror.
    starting_sketches.iter_mut().for_each(|sketch| {
        sketch.mirror = true;
    });

    if args.ctx.no_engine_commands().await {
        return Ok(starting_sketches);
    }

    match axis {
        Axis2dOrEdgeReference::Axis { direction, origin } => {
            args.batch_modeling_cmd(
                exec_state.next_uuid(),
                ModelingCmd::from(mcmd::EntityMirror {
                    ids: starting_sketches.iter().map(|sketch| sketch.id).collect(),
                    axis: Point3d {
                        x: direction[0],
                        y: direction[1],
                        z: 0.0,
                    },
                    point: Point3d {
                        x: LengthUnit(origin[0]),
                        y: LengthUnit(origin[1]),
                        z: LengthUnit(0.0),
                    },
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
