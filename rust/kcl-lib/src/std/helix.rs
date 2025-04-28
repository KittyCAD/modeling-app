//! Standard library helices.

use anyhow::Result;
use kcmc::{each_cmd as mcmd, length_unit::LengthUnit, shared::Angle, ModelingCmd};
use kittycad_modeling_cmds::{self as kcmc, shared::Point3d};

use super::args::TyF64;
use crate::{
    errors::KclError,
    execution::{
        types::{PrimitiveType, RuntimeType},
        ExecState, Helix as HelixValue, KclValue, Solid,
    },
    std::{axis_or_reference::Axis3dOrEdgeReference, Args},
};

/// Create a helix.
pub async fn helix(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let angle_start: TyF64 = args.get_kw_arg_typed("angleStart", &RuntimeType::degrees(), exec_state)?;
    let revolutions: TyF64 = args.get_kw_arg_typed("revolutions", &RuntimeType::count(), exec_state)?;
    let ccw = args.get_kw_arg_opt("ccw")?;
    let radius: Option<TyF64> = args.get_kw_arg_opt_typed("radius", &RuntimeType::length(), exec_state)?;
    let axis: Option<Axis3dOrEdgeReference> = args.get_kw_arg_opt_typed(
        "axis",
        &RuntimeType::Union(vec![
            RuntimeType::Primitive(PrimitiveType::Edge),
            RuntimeType::Primitive(PrimitiveType::Axis3d),
        ]),
        exec_state,
    )?;
    let length: Option<TyF64> = args.get_kw_arg_opt_typed("length", &RuntimeType::length(), exec_state)?;
    let cylinder = args.get_kw_arg_opt_typed("cylinder", &RuntimeType::solid(), exec_state)?;

    // Make sure we have a radius if we don't have a cylinder.
    if radius.is_none() && cylinder.is_none() {
        return Err(KclError::Semantic(crate::errors::KclErrorDetails {
            message: "Radius is required when creating a helix without a cylinder.".to_string(),
            source_ranges: vec![args.source_range],
        }));
    }

    // Make sure we don't have a radius if we have a cylinder.
    if radius.is_some() && cylinder.is_some() {
        return Err(KclError::Semantic(crate::errors::KclErrorDetails {
            message: "Radius is not allowed when creating a helix with a cylinder.".to_string(),
            source_ranges: vec![args.source_range],
        }));
    }

    // Make sure we have an axis if we don't have a cylinder.
    if axis.is_none() && cylinder.is_none() {
        return Err(KclError::Semantic(crate::errors::KclErrorDetails {
            message: "Axis is required when creating a helix without a cylinder.".to_string(),
            source_ranges: vec![args.source_range],
        }));
    }

    // Make sure we don't have an axis if we have a cylinder.
    if axis.is_some() && cylinder.is_some() {
        return Err(KclError::Semantic(crate::errors::KclErrorDetails {
            message: "Axis is not allowed when creating a helix with a cylinder.".to_string(),
            source_ranges: vec![args.source_range],
        }));
    }

    // Make sure we have a radius if we have an axis.
    if radius.is_none() && axis.is_some() {
        return Err(KclError::Semantic(crate::errors::KclErrorDetails {
            message: "Radius is required when creating a helix around an axis.".to_string(),
            source_ranges: vec![args.source_range],
        }));
    }

    // Make sure we have an axis if we have a radius.
    if axis.is_none() && radius.is_some() {
        return Err(KclError::Semantic(crate::errors::KclErrorDetails {
            message: "Axis is required when creating a helix around an axis.".to_string(),
            source_ranges: vec![args.source_range],
        }));
    }

    let value = inner_helix(
        revolutions.n,
        angle_start.n,
        ccw,
        radius,
        axis,
        length,
        cylinder,
        exec_state,
        args,
    )
    .await?;
    Ok(KclValue::Helix { value })
}

#[allow(clippy::too_many_arguments)]
async fn inner_helix(
    revolutions: f64,
    angle_start: f64,
    ccw: Option<bool>,
    radius: Option<TyF64>,
    axis: Option<Axis3dOrEdgeReference>,
    length: Option<TyF64>,
    cylinder: Option<Solid>,
    exec_state: &mut ExecState,
    args: Args,
) -> Result<Box<HelixValue>, KclError> {
    let id = exec_state.next_uuid();

    let helix_result = Box::new(HelixValue {
        value: id,
        #[cfg(feature = "artifact-graph")]
        artifact_id: id.into(),
        revolutions,
        angle_start,
        cylinder_id: cylinder.as_ref().map(|c| c.id),
        ccw: ccw.unwrap_or(false),
        units: exec_state.length_unit(),
        meta: vec![args.source_range.into()],
    });

    if args.ctx.no_engine_commands().await {
        return Ok(helix_result);
    }

    if let Some(cylinder) = cylinder {
        args.batch_modeling_cmd(
            id,
            ModelingCmd::from(mcmd::EntityMakeHelix {
                cylinder_id: cylinder.id,
                is_clockwise: !helix_result.ccw,
                length: LengthUnit(length.as_ref().map(|t| t.to_mm()).unwrap_or(cylinder.height_in_mm())),
                revolutions,
                start_angle: Angle::from_degrees(angle_start),
            }),
        )
        .await?;
    } else if let (Some(axis), Some(radius)) = (axis, radius) {
        match axis {
            Axis3dOrEdgeReference::Axis { direction, origin } => {
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
                        radius: LengthUnit(radius.to_mm()),
                        is_clockwise: !helix_result.ccw,
                        length: LengthUnit(length.to_mm()),
                        revolutions,
                        start_angle: Angle::from_degrees(angle_start),
                        axis: Point3d {
                            x: direction[0].to_mm(),
                            y: direction[1].to_mm(),
                            z: direction[2].to_mm(),
                        },
                        center: Point3d {
                            x: LengthUnit(origin[0].to_mm()),
                            y: LengthUnit(origin[1].to_mm()),
                            z: LengthUnit(origin[2].to_mm()),
                        },
                    }),
                )
                .await?;
            }
            Axis3dOrEdgeReference::Edge(edge) => {
                let edge_id = edge.get_engine_id(exec_state, &args)?;

                args.batch_modeling_cmd(
                    id,
                    ModelingCmd::from(mcmd::EntityMakeHelixFromEdge {
                        radius: LengthUnit(radius.to_mm()),
                        is_clockwise: !helix_result.ccw,
                        length: length.map(|t| LengthUnit(t.to_mm())),
                        revolutions,
                        start_angle: Angle::from_degrees(angle_start),
                        edge_id,
                    }),
                )
                .await?;
            }
        };
    }

    Ok(helix_result)
}
