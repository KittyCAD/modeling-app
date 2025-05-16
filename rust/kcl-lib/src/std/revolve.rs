//! Standard library revolution surfaces.

use anyhow::Result;
use kcmc::{
    each_cmd as mcmd,
    length_unit::LengthUnit,
    shared::{Angle, Opposite},
    ModelingCmd,
};
use kittycad_modeling_cmds::{self as kcmc, shared::Point3d};

use super::{args::TyF64, DEFAULT_TOLERANCE};
use crate::{
    errors::{KclError, KclErrorDetails},
    execution::{
        types::{NumericType, PrimitiveType, RuntimeType},
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
    let angle: Option<TyF64> = args.get_kw_arg_opt_typed("angle", &RuntimeType::degrees(), exec_state)?;
    let tolerance: Option<TyF64> = args.get_kw_arg_opt_typed("tolerance", &RuntimeType::length(), exec_state)?;
    let tag_start = args.get_kw_arg_opt("tagStart")?;
    let tag_end = args.get_kw_arg_opt("tagEnd")?;
    let symmetric = args.get_kw_arg_opt("symmetric")?;
    let bidirectional_angle: Option<TyF64> =
        args.get_kw_arg_opt_typed("bidirectionalAngle", &RuntimeType::angle(), exec_state)?;

    let value = inner_revolve(
        sketches,
        axis,
        angle.map(|t| t.n),
        tolerance,
        tag_start,
        tag_end,
        symmetric,
        bidirectional_angle.map(|t| t.n),
        exec_state,
        args,
    )
    .await?;
    Ok(value.into())
}

// Simple colinear check, assumes lines are normalised
fn are_colinear(
    a: Point3d<f64>,
    b: Point3d<f64>,
) -> bool {
    a == b || a == (Point3d{x: -b.x, y: -b.y, z: -b.z})
}

#[allow(clippy::too_many_arguments)]
async fn inner_revolve(
    sketches: Vec<Sketch>,
    axis: Axis2dOrEdgeReference,
    angle: Option<f64>,
    tolerance: Option<TyF64>,
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

    if symmetric.unwrap_or(false) && bidirectional_angle.is_some() {
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

        let direction = match &axis {
            Axis2dOrEdgeReference::Axis { direction, origin } => {
                let axis = Point3d {
                            x: direction[0].to_mm(),
                            y: direction[1].to_mm(),
                            z: 0.0,
                        };

                args.batch_modeling_cmd(
                    id,
                    ModelingCmd::from(mcmd::Revolve {
                        angle,
                        target: sketch.id.into(),
                        axis,
                        origin: Point3d {
                            x: LengthUnit(origin[0].to_mm()),
                            y: LengthUnit(origin[1].to_mm()),
                            z: LengthUnit(0.0),
                        },
                        tolerance: LengthUnit(tolerance.as_ref().map(|t| t.to_mm()).unwrap_or(DEFAULT_TOLERANCE)),
                        axis_is_2d: true,
                        opposite: opposite.clone(),
                    }),
                )
                .await?;
                axis
            }
            Axis2dOrEdgeReference::Edge(edge) => {
                let edge_id = edge.get_engine_id(exec_state, &args)?;
                args.batch_modeling_cmd(
                    id,
                    ModelingCmd::from(mcmd::RevolveAboutEdge {
                        angle,
                        target: sketch.id.into(),
                        edge_id,
                        tolerance: LengthUnit(tolerance.as_ref().map(|t| t.to_mm()).unwrap_or(DEFAULT_TOLERANCE)),
                        opposite: opposite.clone(),
                    }),
                )
                .await?;
                //TODO: fix me
                Point3d{ x: 0.0, y: 1.0, z: 0.0}
            }
        };

        let mut edge_id = None;
        // If an edge lies on the axis of revolution it will not exist after the revolve, so
        // it cannot be used to retrieve data about the solid
        for path in sketch.paths.clone() {

        let from = path.get_from();
        let to = path.get_to();

        let mut dir = Point3d { x: to[0].n - from[0].n, y: to[1].n - from[1].n, z: 0.0};
        let dir_mag = ((dir.x.powf(2.0) + dir.y.powf(2.0) + dir.z.powf(2.0))).sqrt();
        dir = dir.map(|x| x / dir_mag);
         if are_colinear(dir, direction) {
             continue
        }
         edge_id = Some(path.get_id());
         break;
        };

        solids.push(
            do_post_extrude(
                sketch,
                #[cfg(feature = "artifact-graph")]
                id.into(),
                TyF64::new(0.0, NumericType::mm()),
                false,
                &super::extrude::NamedCapTags {
                    start: tag_start.as_ref(),
                    end: tag_end.as_ref(),
                },
                exec_state,
                &args,
                edge_id,
            )
            .await?,
        );
    }

    Ok(solids)
}
