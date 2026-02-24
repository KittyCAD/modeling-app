//! Standard library helices.

use anyhow::Result;
use kcmc::{ModelingCmd, each_cmd as mcmd, length_unit::LengthUnit, shared::Angle};
use kittycad_modeling_cmds::{self as kcmc, shared::Point3d};

use super::args::TyF64;
use crate::{
    errors::{KclError, KclErrorDetails},
    execution::{
        ExecState, Helix as HelixValue, KclValue, ModelingCmdMeta, Solid,
        types::{PrimitiveType, RuntimeType},
    },
    std::{Args, axis_or_reference::Axis3dOrEdgeReference},
};

/// Create a helix.
pub async fn helix(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let angle_start: TyF64 = args.get_kw_arg("angleStart", &RuntimeType::degrees(), exec_state)?;
    let revolutions: TyF64 = args.get_kw_arg("revolutions", &RuntimeType::count(), exec_state)?;
    let ccw = args.get_kw_arg_opt("ccw", &RuntimeType::bool(), exec_state)?;
    let radius: Option<TyF64> = args.get_kw_arg_opt("radius", &RuntimeType::length(), exec_state)?;
    
    // Check if edgeRef is provided (new API)
    let edge_ref: Option<KclValue> = args.get_kw_arg_opt("edgeRef", &RuntimeType::any(), exec_state)?;
    
    // Check if axis is provided (old API)
    let axis_opt: Option<Axis3dOrEdgeReference> = args.get_kw_arg_opt(
        "axis",
        &RuntimeType::Union(vec![
            RuntimeType::Primitive(PrimitiveType::Edge),
            RuntimeType::Primitive(PrimitiveType::Axis3d),
        ]),
        exec_state,
    )?;
    
    let axis: Option<Axis3dOrEdgeReference> = if let Some(edge_ref_value) = edge_ref {
        // New API: parse edgeRef and convert to EdgeReference
        let edge_ref_obj = match edge_ref_value {
            KclValue::Object { value, .. } => value,
            _ => {
                return Err(KclError::new_type(KclErrorDetails {
                    message: "edgeRef must be an object with 'faces' field".to_string(),
                    source_ranges: vec![args.source_range],
                    backtrace: Default::default(),
                }));
            }
        };

        // Get faces array
        let faces_value = edge_ref_obj.get("faces").ok_or_else(|| {
            KclError::new_type(KclErrorDetails {
                message: "edgeRef must have 'faces' field".to_string(),
                source_ranges: vec![args.source_range],
                backtrace: Default::default(),
            })
        })?;

        let faces_array = match faces_value {
            KclValue::HomArray { value, .. } | KclValue::Tuple { value, .. } => value,
            _ => {
                return Err(KclError::new_type(KclErrorDetails {
                    message: "edgeRef 'faces' must be an array".to_string(),
                    source_ranges: vec![args.source_range],
                    backtrace: Default::default(),
                }));
            }
        };

        if faces_array.is_empty() {
            return Err(KclError::new_type(KclErrorDetails {
                message: "edgeRef 'faces' must have at least one face".to_string(),
                source_ranges: vec![args.source_range],
                backtrace: Default::default(),
            }));
        }

        // Resolve faces to UUIDs - for helix, we try to resolve tags to face IDs
        let mut face_uuids = Vec::new();
        for face_value in faces_array {
            let face_uuid = match face_value {
                KclValue::Uuid { value, .. } => *value,
                KclValue::TagIdentifier(tag) => {
                    // Try to get face ID using get_adjacent_face_to_tag (for face tags)
                    match args.get_adjacent_face_to_tag(exec_state, tag, false).await {
                        Ok(face_id) => face_id,
                        Err(_) => {
                            // The tag doesn't refer to a face. It might refer to an edge.
                            // Try to get the engine info as a fallback
                            args.get_tag_engine_info(exec_state, tag)?.id
                        }
                    }
                }
                _ => {
                    return Err(KclError::new_type(KclErrorDetails {
                        message: "edgeRef faces must be UUIDs or tags".to_string(),
                        source_ranges: vec![args.source_range],
                        backtrace: Default::default(),
                    }));
                }
            };
            face_uuids.push(face_uuid);
        }

        // Get disambiguators (optional)
        let mut disambiguator_uuids = Vec::new();
        if let Some(disambiguators_value) = edge_ref_obj.get("disambiguators") {
            let disambiguators_array = match disambiguators_value {
                KclValue::HomArray { value, .. } | KclValue::Tuple { value, .. } => value,
                _ => {
                    return Err(KclError::new_type(KclErrorDetails {
                        message: "edgeRef 'disambiguators' must be an array".to_string(),
                        source_ranges: vec![args.source_range],
                        backtrace: Default::default(),
                    }));
                }
            };
            for disambiguator_value in disambiguators_array {
                let disamb_uuid = match disambiguator_value {
                    KclValue::Uuid { value, .. } => *value,
                    KclValue::TagIdentifier(tag) => {
                        // Try to get face ID using get_adjacent_face_to_tag (for face tags)
                        match args.get_adjacent_face_to_tag(exec_state, tag, false).await {
                            Ok(face_id) => face_id,
                            Err(_) => {
                                // The tag doesn't refer to a face. Try to get the engine info as a fallback
                                args.get_tag_engine_info(exec_state, tag)?.id
                            }
                        }
                    }
                    _ => {
                        return Err(KclError::new_type(KclErrorDetails {
                            message: "edgeRef disambiguators must be UUIDs or tags".to_string(),
                            source_ranges: vec![args.source_range],
                            backtrace: Default::default(),
                        }));
                    }
                };
                disambiguator_uuids.push(disamb_uuid);
            }
        }

        // Get index (optional)
        let index = match edge_ref_obj.get("index") {
            Some(KclValue::Number { value, .. }) => Some(*value as u32),
            Some(_) => {
                return Err(KclError::new_type(KclErrorDetails {
                    message: "edgeRef 'index' must be a number".to_string(),
                    source_ranges: vec![args.source_range],
                    backtrace: Default::default(),
                }));
            }
            None => None,
        };

        // Build EdgeReference from shared module
        use kcmc::shared::EdgeReference as ModelingEdgeReference;
        let builder = ModelingEdgeReference::builder()
            .faces(face_uuids)
            .disambiguators(disambiguator_uuids);

        let edge_reference: ModelingEdgeReference = if let Some(index_val) = index {
            builder.index(index_val).build()
        } else {
            builder.build()
        };

        Some(Axis3dOrEdgeReference::EdgeReference(edge_reference))
    } else if let Some(axis_val) = axis_opt {
        // Old API: use axis (tag or axis)
        Some(axis_val)
    } else {
        // Neither edgeRef nor axis provided - will be checked later
        None
    };
    
    let length: Option<TyF64> = args.get_kw_arg_opt("length", &RuntimeType::length(), exec_state)?;
    let cylinder = args.get_kw_arg_opt("cylinder", &RuntimeType::solid(), exec_state)?;

    // Make sure we have a radius if we don't have a cylinder.
    if radius.is_none() && cylinder.is_none() {
        return Err(KclError::new_semantic(crate::errors::KclErrorDetails::new(
            "Radius is required when creating a helix without a cylinder.".to_string(),
            vec![args.source_range],
        )));
    }

    // Make sure we don't have a radius if we have a cylinder.
    if radius.is_some() && cylinder.is_some() {
        return Err(KclError::new_semantic(crate::errors::KclErrorDetails::new(
            "Radius is not allowed when creating a helix with a cylinder.".to_string(),
            vec![args.source_range],
        )));
    }

    // Make sure we have an axis or edgeRef if we don't have a cylinder.
    if axis.is_none() && cylinder.is_none() {
        return Err(KclError::new_semantic(crate::errors::KclErrorDetails::new(
            "Either `axis` or `edgeRef` is required when creating a helix without a cylinder.".to_string(),
            vec![args.source_range],
        )));
    }

    // Make sure we don't have an axis or edgeRef if we have a cylinder.
    if axis.is_some() && cylinder.is_some() {
        return Err(KclError::new_semantic(crate::errors::KclErrorDetails::new(
            "Neither `axis` nor `edgeRef` is allowed when creating a helix with a cylinder.".to_string(),
            vec![args.source_range],
        )));
    }

    // Make sure we have a radius if we have an axis or edgeRef.
    if radius.is_none() && axis.is_some() {
        return Err(KclError::new_semantic(crate::errors::KclErrorDetails::new(
            "Radius is required when creating a helix around an axis or edge.".to_string(),
            vec![args.source_range],
        )));
    }

    // Make sure we have an axis or edgeRef if we have a radius.
    if axis.is_none() && radius.is_some() {
        return Err(KclError::new_semantic(crate::errors::KclErrorDetails::new(
            "Either `axis` or `edgeRef` is required when creating a helix around an axis or edge.".to_string(),
            vec![args.source_range],
        )));
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
        let cmd = if let Some(length) = length {
            mcmd::EntityMakeHelix::builder()
                .cylinder_id(cylinder.id)
                .is_clockwise(!helix_result.ccw)
                .revolutions(revolutions)
                .start_angle(Angle::from_degrees(angle_start))
                .length(LengthUnit(length.to_mm()))
                .build()
        } else {
            mcmd::EntityMakeHelix::builder()
                .cylinder_id(cylinder.id)
                .is_clockwise(!helix_result.ccw)
                .revolutions(revolutions)
                .start_angle(Angle::from_degrees(angle_start))
                .build()
        };
        exec_state
            .batch_modeling_cmd(
                ModelingCmdMeta::from_args_id(exec_state, &args, id),
                ModelingCmd::from(cmd),
            )
            .await?;
    } else if let (Some(axis), Some(radius)) = (axis, radius) {
        match axis {
            Axis3dOrEdgeReference::Axis { direction, origin } => {
                // Make sure they gave us a length.
                let Some(length) = length else {
                    return Err(KclError::new_semantic(KclErrorDetails::new(
                        "Length is required when creating a helix around an axis.".to_owned(),
                        vec![args.source_range],
                    )));
                };

                exec_state
                    .batch_modeling_cmd(
                        ModelingCmdMeta::from_args_id(exec_state, &args, id),
                        ModelingCmd::from(
                            mcmd::EntityMakeHelixFromParams::builder()
                                .radius(LengthUnit(radius.to_mm()))
                                .is_clockwise(!helix_result.ccw)
                                .length(LengthUnit(length.to_mm()))
                                .revolutions(revolutions)
                                .start_angle(Angle::from_degrees(angle_start))
                                .axis(Point3d {
                                    x: direction[0].to_mm(),
                                    y: direction[1].to_mm(),
                                    z: direction[2].to_mm(),
                                })
                                .center(Point3d {
                                    x: LengthUnit(origin[0].to_mm()),
                                    y: LengthUnit(origin[1].to_mm()),
                                    z: LengthUnit(origin[2].to_mm()),
                                })
                                .build(),
                        ),
                    )
                    .await?;
            }
            Axis3dOrEdgeReference::Edge(edge) => {
                let edge_id = edge.get_engine_id(exec_state, &args)?;

                // For backwards compatibility, use edge_id directly instead of querying for EdgeReference
                let cmd = if let Some(length) = length {
                    mcmd::EntityMakeHelixFromEdge::builder()
                        .radius(LengthUnit(radius.to_mm()))
                        .is_clockwise(!helix_result.ccw)
                        .revolutions(revolutions)
                        .start_angle(Angle::from_degrees(angle_start))
                        .edge_id(edge_id)
                        .length(LengthUnit(length.to_mm()))
                        .build()
                } else {
                    mcmd::EntityMakeHelixFromEdge::builder()
                        .radius(LengthUnit(radius.to_mm()))
                        .is_clockwise(!helix_result.ccw)
                        .revolutions(revolutions)
                        .start_angle(Angle::from_degrees(angle_start))
                        .edge_id(edge_id)
                        .build()
                };
                exec_state
                    .batch_modeling_cmd(
                        ModelingCmdMeta::from_args_id(exec_state, &args, id),
                        ModelingCmd::from(cmd),
                    )
                    .await?;
            }
            Axis3dOrEdgeReference::EdgeReference(edge_ref) => {
                // New API: use EdgeReference directly
                let cmd = if let Some(length) = length {
                    mcmd::EntityMakeHelixFromEdge::builder()
                        .radius(LengthUnit(radius.to_mm()))
                        .is_clockwise(!helix_result.ccw)
                        .revolutions(revolutions)
                        .start_angle(Angle::from_degrees(angle_start))
                        .edge_reference(edge_ref.clone())
                        .length(LengthUnit(length.to_mm()))
                        .build()
                } else {
                    mcmd::EntityMakeHelixFromEdge::builder()
                        .radius(LengthUnit(radius.to_mm()))
                        .is_clockwise(!helix_result.ccw)
                        .revolutions(revolutions)
                        .start_angle(Angle::from_degrees(angle_start))
                        .edge_reference(edge_ref.clone())
                        .build()
                };
                exec_state
                    .batch_modeling_cmd(
                        ModelingCmdMeta::from_args_id(exec_state, &args, id),
                        ModelingCmd::from(cmd),
                    )
                    .await?;
            }
        };
    }

    Ok(helix_result)
}
