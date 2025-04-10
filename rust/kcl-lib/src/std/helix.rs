//! Standard library helices.

use anyhow::Result;
use kcmc::{each_cmd as mcmd, length_unit::LengthUnit, shared::Angle, ModelingCmd};
use kittycad_modeling_cmds::{self as kcmc, shared::Point3d};

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
    let angle_start = args.get_kw_arg("angleStart")?;
    let revolutions = args.get_kw_arg("revolutions")?;
    let ccw = args.get_kw_arg_opt("ccw")?;
    let radius = args.get_kw_arg_opt("radius")?;
    let axis: Option<Axis3dOrEdgeReference> = args.get_kw_arg_opt_typed(
        "axis",
        &RuntimeType::Union(vec![
            RuntimeType::Primitive(PrimitiveType::Edge),
            RuntimeType::Primitive(PrimitiveType::Axis3d),
        ]),
        exec_state,
    )?;
    let length = args.get_kw_arg_opt("length")?;
    let cylinder = args.get_kw_arg_opt("cylinder")?;

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
        revolutions,
        angle_start,
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
    radius: Option<f64>,
    axis: Option<Axis3dOrEdgeReference>,
    length: Option<f64>,
    cylinder: Option<Solid>,
    exec_state: &mut ExecState,
    args: Args,
) -> Result<Box<HelixValue>, KclError> {
    let id = exec_state.next_uuid();

    let helix_result = Box::new(HelixValue {
        value: id,
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
                length: LengthUnit(length.unwrap_or(cylinder.height)),
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
                        radius: LengthUnit(radius),
                        is_clockwise: !helix_result.ccw,
                        length: LengthUnit(length),
                        revolutions,
                        start_angle: Angle::from_degrees(angle_start),
                        axis: Point3d {
                            x: direction[0],
                            y: direction[1],
                            z: direction[2],
                        },
                        center: Point3d {
                            x: LengthUnit(origin[0]),
                            y: LengthUnit(origin[1]),
                            z: LengthUnit(origin[2]),
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
                        radius: LengthUnit(radius),
                        is_clockwise: !helix_result.ccw,
                        length: length.map(LengthUnit),
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
