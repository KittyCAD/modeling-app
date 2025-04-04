//! Standard library revolution surfaces.

use anyhow::Result;
use kcmc::{each_cmd as mcmd, length_unit::LengthUnit, shared::Angle, shared::Opposite, ModelingCmd};
use kittycad_modeling_cmds::{self as kcmc, shared::Point3d};

use super::DEFAULT_TOLERANCE;
use crate::{
    errors::{KclError, KclErrorDetails},
    execution::{
        types::{PrimitiveType, RuntimeType},
        ExecState, KclValue, Sketch, Solid,
    },
    parsing::ast::types::TagNode,
    std::{axis_or_reference::Axis2dOrEdgeReference, extrude::do_post_extrude, Args},
};

/// Revolve a sketch or set of sketches around an axis.
pub async fn revolve(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let sketches = args.get_unlabeled_kw_arg_typed("sketches", &RuntimeType::sketches(), exec_state)?;
    let axis = args.get_kw_arg_typed(
        "axis",
        &RuntimeType::Union(vec![
            RuntimeType::Primitive(PrimitiveType::Edge),
            RuntimeType::Primitive(PrimitiveType::Axis2d),
        ]),
        exec_state,
    )?;
    let angle = args.get_kw_arg_opt("angle")?;
    let tolerance = args.get_kw_arg_opt("tolerance")?;
    let tag_start = args.get_kw_arg_opt("tagStart")?;
    let tag_end = args.get_kw_arg_opt("tagEnd")?;
    let symmetric = args.get_kw_arg_opt("symmetric")?;
    let bidirectional_angle = args.get_kw_arg_opt("bidirectional")?;

    let value = inner_revolve(
        sketches,
        axis,
        angle,
        tolerance,
        tag_start,
        tag_end,
        symmetric,
        bidirectional_angle,
        exec_state,
        args,
    )
    .await?;
    Ok(value.into())
}

#[allow(clippy::too_many_arguments)]
async fn inner_revolve(
    sketches: Vec<Sketch>,
    axis: Axis2dOrEdgeReference,
    angle: Option<f64>,
    tolerance: Option<f64>,
    tag_start: Option<TagNode>,
    tag_end: Option<TagNode>,
    symmetric: Option<bool>,
    bidirectional_angle: Option<f64>,
    exec_state: &mut ExecState,
    args: Args,
) -> Result<Vec<Solid>, KclError> {
    if let Some(angle) = angle {
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

    if let Some(bidirectional_angle) = bidirectional_angle {
        // Return an error if the angle is zero.
        // We don't use validate() here because we want to return a specific error message that is
        // nice and we use the other data in the docs, so we still need use the derive above for the json schema.
        if !(-360.0..=360.0).contains(&bidirectional_angle) || bidirectional_angle == 0.0 {
            return Err(KclError::Semantic(KclErrorDetails {
                message: format!(
                    "Expected bidirectional angle to be between -360 and 360 and not 0, found `{}`",
                    bidirectional_angle
                ),
                source_ranges: vec![args.source_range],
            }));
        }

        if let Some(angle) = angle {
            let ang = angle.signum() * bidirectional_angle + angle;
            if !(-360.0..=360.0).contains(&ang) {
                return Err(KclError::Semantic(KclErrorDetails {
                    message: format!(
                        "Combined angle and bidirectional must be between -360 and 360, found '{}'",
                        ang
                    ),
                    source_ranges: vec![args.source_range],
                }));
            }
        }
    }

    if symmetric.is_some() && symmetric.unwrap() && bidirectional_angle.is_some() {
        return Err(KclError::Semantic(KclErrorDetails {
            source_ranges: vec![args.source_range],
            message: "You cannot give both `symmetric` and `bidirectional` params, you have to choose one or the other"
                .to_owned(),
        }));
    }

    let angle = Angle::from_degrees(angle.unwrap_or(360.0));

    let bidirectional_angle = bidirectional_angle.map(Angle::from_degrees);

    let opposite = match (symmetric, bidirectional_angle) {
        (Some(true), _) => Opposite::Symmetric,
        (None, None) => Opposite::None,
        (Some(false), None) => Opposite::None,
        (None, Some(angle)) => Opposite::Other(angle),
        (Some(false), Some(angle)) => Opposite::Other(angle),
    };

    let mut solids = Vec::new();
    for sketch in &sketches {
        let id = exec_state.next_uuid();

        match &axis {
            Axis2dOrEdgeReference::Axis { direction, origin } => {
                args.batch_modeling_cmd(
                    id,
                    ModelingCmd::from(mcmd::Revolve {
                        angle,
                        target: sketch.id.into(),
                        axis: Point3d {
                            x: direction[0],
                            y: direction[1],
                            z: 0.0,
                        },
                        origin: Point3d {
                            x: LengthUnit(origin[0]),
                            y: LengthUnit(origin[1]),
                            z: LengthUnit(0.0),
                        },
                        tolerance: LengthUnit(tolerance.unwrap_or(DEFAULT_TOLERANCE)),
                        axis_is_2d: true,
                        opposite: opposite.clone(),
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
                        tolerance: LengthUnit(tolerance.unwrap_or(DEFAULT_TOLERANCE)),
                        opposite: opposite.clone(),
                    }),
                )
                .await?;
            }
        }

        solids.push(
            do_post_extrude(
                sketch,
                id.into(),
                0.0,
                false,
                &super::extrude::NamedCapTags {
                    start: tag_start.as_ref(),
                    end: tag_end.as_ref(),
                },
                exec_state,
                &args,
            )
            .await?,
        );
    }

    Ok(solids)
}
