//! Standard library revolution surfaces.

use anyhow::Result;
use kcmc::{
    ModelingCmd, each_cmd as mcmd,
    length_unit::LengthUnit,
    shared::{Angle, Opposite},
};
use kittycad_modeling_cmds::{
    self as kcmc,
    shared::{BodyType, Point3d},
};

use super::{DEFAULT_TOLERANCE_MM, args::TyF64};
use crate::{
    errors::{KclError, KclErrorDetails},
    execution::{
        ExecState, KclValue, ModelingCmdMeta, Sketch, Solid,
        types::{PrimitiveType, RuntimeType},
    },
    parsing::ast::types::TagNode,
    std::{Args, axis_or_reference::Axis2dOrEdgeReference, extrude::do_post_extrude},
};

extern crate nalgebra_glm as glm;

/// Revolve a sketch or set of sketches around an axis.
pub async fn revolve(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let sketches: Vec<Sketch> = args.get_unlabeled_kw_arg("sketches", &RuntimeType::sketches(), exec_state)?;

    // Check if edgeRef is provided (new API)
    let edge_ref: Option<KclValue> = args.get_kw_arg_opt("edgeRef", &RuntimeType::any(), exec_state)?;

    // Check if axis is provided (old API)
    let axis_opt: Option<Axis2dOrEdgeReference> = args.get_kw_arg_opt(
        "axis",
        &RuntimeType::Union(vec![
            RuntimeType::Primitive(PrimitiveType::Edge),
            RuntimeType::Primitive(PrimitiveType::Axis2d),
        ]),
        exec_state,
    )?;

    let axis: Axis2dOrEdgeReference = if let Some(edge_ref_value) = edge_ref {
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

        // Resolve faces to UUIDs - for revolve, we try to resolve tags to face IDs
        // Similar to fillet, but we don't have a solid context
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

        Axis2dOrEdgeReference::EdgeReference(edge_reference)
    } else if let Some(axis_val) = axis_opt {
        // Old API: use axis (tag or axis)
        axis_val
    } else {
        // Neither edgeRef nor axis provided - error
        return Err(KclError::new_semantic(KclErrorDetails {
            message: "The `revolve` function requires either a keyword argument `axis` or `edgeRef`".to_string(),
            source_ranges: vec![args.source_range],
            backtrace: Default::default(),
        }));
    };

    let angle: Option<TyF64> = args.get_kw_arg_opt("angle", &RuntimeType::degrees(), exec_state)?;
    let tolerance: Option<TyF64> = args.get_kw_arg_opt("tolerance", &RuntimeType::length(), exec_state)?;
    let tag_start = args.get_kw_arg_opt("tagStart", &RuntimeType::tag_decl(), exec_state)?;
    let tag_end = args.get_kw_arg_opt("tagEnd", &RuntimeType::tag_decl(), exec_state)?;
    let symmetric = args.get_kw_arg_opt("symmetric", &RuntimeType::bool(), exec_state)?;
    let bidirectional_angle: Option<TyF64> =
        args.get_kw_arg_opt("bidirectionalAngle", &RuntimeType::angle(), exec_state)?;
    let body_type: Option<BodyType> = args.get_kw_arg_opt("bodyType", &RuntimeType::string(), exec_state)?;

    let value = inner_revolve(
        sketches,
        axis,
        angle.map(|t| t.n),
        tolerance,
        tag_start,
        tag_end,
        symmetric,
        bidirectional_angle.map(|t| t.n),
        body_type,
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
    tolerance: Option<TyF64>,
    tag_start: Option<TagNode>,
    tag_end: Option<TagNode>,
    symmetric: Option<bool>,
    bidirectional_angle: Option<f64>,
    body_type: Option<BodyType>,
    exec_state: &mut ExecState,
    args: Args,
) -> Result<Vec<Solid>, KclError> {
    let body_type = body_type.unwrap_or_default();
    if let Some(angle) = angle {
        // Return an error if the angle is zero.
        // We don't use validate() here because we want to return a specific error message that is
        // nice and we use the other data in the docs, so we still need use the derive above for the json schema.
        if !(-360.0..=360.0).contains(&angle) || angle == 0.0 {
            return Err(KclError::new_semantic(KclErrorDetails::new(
                format!("Expected angle to be between -360 and 360 and not 0, found `{angle}`"),
                vec![args.source_range],
            )));
        }
    }

    if let Some(bidirectional_angle) = bidirectional_angle {
        // Return an error if the angle is zero.
        // We don't use validate() here because we want to return a specific error message that is
        // nice and we use the other data in the docs, so we still need use the derive above for the json schema.
        if !(-360.0..=360.0).contains(&bidirectional_angle) || bidirectional_angle == 0.0 {
            return Err(KclError::new_semantic(KclErrorDetails::new(
                format!(
                    "Expected bidirectional angle to be between -360 and 360 and not 0, found `{bidirectional_angle}`"
                ),
                vec![args.source_range],
            )));
        }

        if let Some(angle) = angle {
            let ang = angle.signum() * bidirectional_angle + angle;
            if !(-360.0..=360.0).contains(&ang) {
                return Err(KclError::new_semantic(KclErrorDetails::new(
                    format!("Combined angle and bidirectional must be between -360 and 360, found '{ang}'"),
                    vec![args.source_range],
                )));
            }
        }
    }

    if symmetric.unwrap_or(false) && bidirectional_angle.is_some() {
        return Err(KclError::new_semantic(KclErrorDetails::new(
            "You cannot give both `symmetric` and `bidirectional` params, you have to choose one or the other"
                .to_owned(),
            vec![args.source_range],
        )));
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
        let new_solid_id = exec_state.next_uuid();
        let tolerance = tolerance.as_ref().map(|t| t.to_mm()).unwrap_or(DEFAULT_TOLERANCE_MM);

        let direction = match &axis {
            Axis2dOrEdgeReference::Axis { direction, origin } => {
                exec_state
                    .batch_modeling_cmd(
                        ModelingCmdMeta::from_args_id(exec_state, &args, new_solid_id),
                        ModelingCmd::from(
                            mcmd::Revolve::builder()
                                .angle(angle)
                                .target(sketch.id.into())
                                .axis(Point3d {
                                    x: direction[0].to_mm(),
                                    y: direction[1].to_mm(),
                                    z: 0.0,
                                })
                                .origin(Point3d {
                                    x: LengthUnit(origin[0].to_mm()),
                                    y: LengthUnit(origin[1].to_mm()),
                                    z: LengthUnit(0.0),
                                })
                                .tolerance(LengthUnit(tolerance))
                                .axis_is_2d(true)
                                .opposite(opposite.clone())
                                .body_type(body_type)
                                .build(),
                        ),
                    )
                    .await?;
                glm::DVec2::new(direction[0].to_mm(), direction[1].to_mm())
            }
            Axis2dOrEdgeReference::Edge(edge) => {
                let edge_id = edge.get_engine_id(exec_state, &args)?;
                exec_state
                    .batch_modeling_cmd(
                        ModelingCmdMeta::from_args_id(exec_state, &args, new_solid_id),
                        ModelingCmd::from(
                            mcmd::RevolveAboutEdge::builder()
                                .angle(angle)
                                .target(sketch.id.into())
                                .edge_id(edge_id)
                                .tolerance(LengthUnit(tolerance))
                                .opposite(opposite.clone())
                                .body_type(body_type)
                                .build(),
                        ),
                    )
                    .await?;
                //TODO: fix me! Need to be able to calculate this to ensure the path isn't colinear
                glm::DVec2::new(0.0, 1.0)
            }
            Axis2dOrEdgeReference::EdgeReference(edge_ref) => {
                // New API: use EdgeReference directly
                exec_state
                    .batch_modeling_cmd(
                        ModelingCmdMeta::from_args_id(exec_state, &args, new_solid_id),
                        ModelingCmd::from(
                            mcmd::RevolveAboutEdgeReference::builder()
                                .angle(angle)
                                .target(sketch.id.into())
                                .edge_reference(edge_ref.clone())
                                .tolerance(LengthUnit(tolerance))
                                .opposite(opposite.clone())
                                .body_type(body_type)
                                .build(),
                        ),
                    )
                    .await?;
                //TODO: fix me! Need to be able to calculate this to ensure the path isn't colinear
                glm::DVec2::new(0.0, 1.0)
            }
        };

        let mut edge_id = None;
        // If an edge lies on the axis of revolution it will not exist after the revolve, so
        // it cannot be used to retrieve data about the solid
        for path in sketch.paths.clone() {
            if !path.is_straight_line() {
                edge_id = Some(path.get_id());
                break;
            }

            let from = path.get_from();
            let to = path.get_to();

            let dir = glm::DVec2::new(to[0].n - from[0].n, to[1].n - from[1].n);
            if glm::are_collinear2d(&dir, &direction, tolerance) {
                continue;
            }
            edge_id = Some(path.get_id());
            break;
        }

        solids.push(
            do_post_extrude(
                sketch,
                new_solid_id.into(),
                false,
                &super::extrude::NamedCapTags {
                    start: tag_start.as_ref(),
                    end: tag_end.as_ref(),
                },
                kittycad_modeling_cmds::shared::ExtrudeMethod::New,
                exec_state,
                &args,
                edge_id,
                None,
                body_type,
                crate::std::extrude::BeingExtruded::Sketch,
            )
            .await?,
        );
    }

    Ok(solids)
}
