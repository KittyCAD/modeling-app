use kcl_error::SourceRange;
use kcmc::{ModelingCmd, each_cmd as mcmd};
use kittycad_modeling_cmds::{
    self as kcmc,
    shared::{
        AnnotationFeatureControl, AnnotationLineEnd, AnnotationMbdControlFrame, AnnotationOptions, AnnotationType,
        MbdSymbol, Point2d as KPoint2d,
    },
};

use crate::{
    ExecState, KclError,
    errors::KclErrorDetails,
    exec::KclValue,
    execution::{
        ControlFlowKind, GdtAnnotation, Metadata, ModelingCmdMeta, Plane, StatementKind, TagIdentifier,
        types::{ArrayLen, RuntimeType},
    },
    parsing::ast::types as ast,
    std::{Args, args::TyF64, sketch::ensure_sketch_plane_in_engine},
};

/// Bundle of common GD&T annotation style arguments.
#[derive(Debug, Clone)]
pub(crate) struct AnnotationStyle {
    pub font_point_size: Option<TyF64>,
    pub font_scale: Option<TyF64>,
}

pub async fn datum(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let face: TagIdentifier = args.get_kw_arg("face", &RuntimeType::tagged_face(), exec_state)?;
    let name: String = args.get_kw_arg("name", &RuntimeType::string(), exec_state)?;
    let frame_position: Option<[TyF64; 2]> =
        args.get_kw_arg_opt("framePosition", &RuntimeType::point2d(), exec_state)?;
    let frame_plane: Option<Plane> = args.get_kw_arg_opt("framePlane", &RuntimeType::plane(), exec_state)?;
    let leader_scale: Option<TyF64> = args.get_kw_arg_opt("leaderScale", &RuntimeType::count(), exec_state)?;
    let font_point_size: Option<TyF64> = args.get_kw_arg_opt("fontPointSize", &RuntimeType::count(), exec_state)?;
    let font_scale: Option<TyF64> = args.get_kw_arg_opt("fontScale", &RuntimeType::count(), exec_state)?;

    let annotation = inner_datum(
        face,
        name,
        frame_position,
        frame_plane,
        leader_scale,
        AnnotationStyle {
            font_point_size,
            font_scale,
        },
        exec_state,
        &args,
    )
    .await?;
    Ok(KclValue::GdtAnnotation {
        value: Box::new(annotation),
    })
}

#[allow(clippy::too_many_arguments)]
async fn inner_datum(
    face: TagIdentifier,
    name: String,
    frame_position: Option<[TyF64; 2]>,
    frame_plane: Option<Plane>,
    leader_scale: Option<TyF64>,
    style: AnnotationStyle,
    exec_state: &mut ExecState,
    args: &Args,
) -> Result<GdtAnnotation, KclError> {
    const DATUM_LENGTH_ERROR: &str = "Datum name must be a single character.";
    if name.len() > 1 {
        return Err(KclError::new_semantic(KclErrorDetails::new(
            DATUM_LENGTH_ERROR.to_owned(),
            vec![args.source_range],
        )));
    }
    let name_char = name.chars().next().ok_or_else(|| {
        KclError::new_semantic(KclErrorDetails::new(
            DATUM_LENGTH_ERROR.to_owned(),
            vec![args.source_range],
        ))
    })?;
    let mut frame_plane = if let Some(plane) = frame_plane {
        plane
    } else {
        // No plane given. Use one of the standard planes.
        xy_plane(exec_state, args).await?
    };
    ensure_sketch_plane_in_engine(&mut frame_plane, exec_state, args).await?;
    let face_id = args.get_adjacent_face_to_tag(exec_state, &face, false).await?;
    let meta = vec![Metadata::from(args.source_range)];
    let annotation_id = exec_state.next_uuid();
    exec_state
        .batch_modeling_cmd(
            ModelingCmdMeta::from_args_id(exec_state, args, annotation_id),
            ModelingCmd::from(
                mcmd::NewAnnotation::builder()
                    .options(AnnotationOptions {
                        text: None,
                        line_ends: None,
                        line_width: None,
                        color: None,
                        position: None,
                        dimension: None,
                        feature_control: Some(AnnotationFeatureControl {
                            entity_id: face_id,
                            // Point to the center of the face.
                            entity_pos: KPoint2d { x: 0.5, y: 0.5 },
                            leader_type: AnnotationLineEnd::Dot,
                            dimension: None,
                            control_frame: None,
                            defined_datum: Some(name_char),
                            prefix: None,
                            suffix: None,
                            plane_id: frame_plane.id,
                            offset: if let Some(offset) = &frame_position {
                                KPoint2d {
                                    x: offset[0].to_mm(),
                                    y: offset[1].to_mm(),
                                }
                            } else {
                                KPoint2d { x: 100.0, y: 100.0 }
                            },
                            precision: 0,
                            font_scale: style.font_scale.as_ref().map(|n| n.n as f32).unwrap_or(1.0),
                            font_point_size: style.font_point_size.as_ref().map(|n| n.n.round() as u32).unwrap_or(36),
                            leader_scale: leader_scale.as_ref().map(|n| n.n as f32).unwrap_or(1.0),
                        }),
                        feature_tag: None,
                    })
                    .clobber(false)
                    .annotation_type(AnnotationType::T3D)
                    .build(),
            ),
        )
        .await?;
    Ok(GdtAnnotation {
        id: annotation_id,
        meta,
    })
}

pub async fn flatness(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let faces: Vec<TagIdentifier> = args.get_kw_arg(
        "faces",
        &RuntimeType::Array(Box::new(RuntimeType::tagged_face()), ArrayLen::Minimum(1)),
        exec_state,
    )?;
    let tolerance = args.get_kw_arg("tolerance", &RuntimeType::length(), exec_state)?;
    let precision = args.get_kw_arg_opt("precision", &RuntimeType::count(), exec_state)?;
    let frame_position: Option<[TyF64; 2]> =
        args.get_kw_arg_opt("framePosition", &RuntimeType::point2d(), exec_state)?;
    let frame_plane: Option<Plane> = args.get_kw_arg_opt("framePlane", &RuntimeType::plane(), exec_state)?;
    let leader_scale: Option<TyF64> = args.get_kw_arg_opt("leaderScale", &RuntimeType::count(), exec_state)?;
    let font_point_size: Option<TyF64> = args.get_kw_arg_opt("fontPointSize", &RuntimeType::count(), exec_state)?;
    let font_scale: Option<TyF64> = args.get_kw_arg_opt("fontScale", &RuntimeType::count(), exec_state)?;

    let annotations = inner_flatness(
        faces,
        tolerance,
        precision,
        frame_position,
        frame_plane,
        leader_scale,
        AnnotationStyle {
            font_point_size,
            font_scale,
        },
        exec_state,
        &args,
    )
    .await?;
    Ok(annotations.into())
}

#[allow(clippy::too_many_arguments)]
async fn inner_flatness(
    faces: Vec<TagIdentifier>,
    tolerance: TyF64,
    precision: Option<TyF64>,
    frame_position: Option<[TyF64; 2]>,
    frame_plane: Option<Plane>,
    leader_scale: Option<TyF64>,
    style: AnnotationStyle,
    exec_state: &mut ExecState,
    args: &Args,
) -> Result<Vec<GdtAnnotation>, KclError> {
    let precision = if let Some(precision) = precision {
        let rounded = precision.n.round();
        if !(0.0..=9.0).contains(&rounded) {
            return Err(KclError::new_semantic(KclErrorDetails::new(
                "Precision must be between 0 and 9".to_owned(),
                vec![args.source_range],
            )));
        }
        rounded as u32
    } else {
        // The default precision.
        3
    };
    let mut frame_plane = if let Some(plane) = frame_plane {
        plane
    } else {
        // No plane given. Use one of the standard planes.
        xy_plane(exec_state, args).await?
    };
    ensure_sketch_plane_in_engine(&mut frame_plane, exec_state, args).await?;
    let mut annotations = Vec::with_capacity(faces.len());
    for face in &faces {
        let face_id = args.get_adjacent_face_to_tag(exec_state, face, false).await?;
        let meta = vec![Metadata::from(args.source_range)];
        let annotation_id = exec_state.next_uuid();
        exec_state
            .batch_modeling_cmd(
                ModelingCmdMeta::from_args_id(exec_state, args, annotation_id),
                ModelingCmd::from(
                    mcmd::NewAnnotation::builder()
                        .options(AnnotationOptions {
                            text: None,
                            line_ends: None,
                            line_width: None,
                            color: None,
                            position: None,
                            dimension: None,
                            feature_control: Some(AnnotationFeatureControl {
                                entity_id: face_id,
                                // Point to the center of the face.
                                entity_pos: KPoint2d { x: 0.5, y: 0.5 },
                                leader_type: AnnotationLineEnd::Dot,
                                dimension: None,
                                control_frame: Some(AnnotationMbdControlFrame {
                                    symbol: MbdSymbol::Flatness,
                                    diameter_symbol: None,
                                    tolerance: tolerance.to_mm(),
                                    modifier: None,
                                    primary_datum: None,
                                    secondary_datum: None,
                                    tertiary_datum: None,
                                }),
                                defined_datum: None,
                                prefix: None,
                                suffix: None,
                                plane_id: frame_plane.id,
                                offset: if let Some(offset) = &frame_position {
                                    KPoint2d {
                                        x: offset[0].to_mm(),
                                        y: offset[1].to_mm(),
                                    }
                                } else {
                                    KPoint2d { x: 100.0, y: 100.0 }
                                },
                                precision,
                                font_scale: style.font_scale.as_ref().map(|n| n.n as f32).unwrap_or(1.0),
                                font_point_size: style
                                    .font_point_size
                                    .as_ref()
                                    .map(|n| n.n.round() as u32)
                                    .unwrap_or(36),
                                leader_scale: leader_scale.as_ref().map(|n| n.n as f32).unwrap_or(1.0),
                            }),
                            feature_tag: None,
                        })
                        .clobber(false)
                        .annotation_type(AnnotationType::T3D)
                        .build(),
                ),
            )
            .await?;
        annotations.push(GdtAnnotation {
            id: annotation_id,
            meta,
        });
    }
    Ok(annotations)
}

/// Get the XY plane by evaluating the `XY` expression so that it's the same as
/// if the user specified `XY`.
async fn xy_plane(exec_state: &mut ExecState, args: &Args) -> Result<Plane, KclError> {
    let plane_ast = plane_ast("XY", args.source_range);
    let metadata = Metadata::from(args.source_range);
    let plane_value = args
        .ctx
        .execute_expr(&plane_ast, exec_state, &metadata, &[], StatementKind::Expression)
        .await?;
    let plane_value = match plane_value.control {
        ControlFlowKind::Continue => plane_value.into_value(),
        ControlFlowKind::Exit => {
            let message = "Early return inside plane value is currently not supported".to_owned();
            debug_assert!(false, "{}", &message);
            return Err(KclError::new_internal(KclErrorDetails::new(
                message,
                vec![args.source_range],
            )));
        }
    };
    Ok(plane_value
        .as_plane()
        .ok_or_else(|| {
            KclError::new_internal(KclErrorDetails::new(
                "Expected XY plane to be defined".to_owned(),
                vec![args.source_range],
            ))
        })?
        .clone())
}

/// An AST node for a plane with the given name.
fn plane_ast(plane_name: &str, range: SourceRange) -> ast::Node<ast::Expr> {
    ast::Node::new(
        ast::Expr::Name(Box::new(ast::Node::new(
            ast::Name {
                name: ast::Identifier::new(plane_name),
                path: Vec::new(),
                // TODO: We may want to set this to true once we implement it to
                // prevent it breaking if users redefine the identifier.
                abs_path: false,
                digest: None,
            },
            range.start(),
            range.end(),
            range.module_id(),
        ))),
        range.start(),
        range.end(),
        range.module_id(),
    )
}
