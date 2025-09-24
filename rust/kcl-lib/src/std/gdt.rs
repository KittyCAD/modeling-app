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
        Metadata, Plane, StatementKind, TagIdentifier,
        types::{ArrayLen, RuntimeType},
    },
    parsing::ast::types as ast,
    std::{Args, args::TyF64, sketch::make_sketch_plane_from_orientation},
};

/// Bundle of common GD&T annotation style arguments.
#[derive(Debug, Clone)]
pub(crate) struct AnnotationStyle {
    pub font_point_size: Option<TyF64>,
    pub font_scale: Option<TyF64>,
}

pub async fn flatness(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let faces: Vec<TagIdentifier> = args.get_kw_arg(
        "faces",
        &RuntimeType::Array(Box::new(RuntimeType::tagged_face()), ArrayLen::Minimum(1)),
        exec_state,
    )?;
    let tolerance = args.get_kw_arg("tolerance", &RuntimeType::length(), exec_state)?;
    let precision = args.get_kw_arg_opt("precision", &RuntimeType::count(), exec_state)?;
    let gdt_position: Option<[TyF64; 2]> = args.get_kw_arg_opt("gdtPosition", &RuntimeType::point2d(), exec_state)?;
    let in_plane: Option<Plane> = args.get_kw_arg_opt("inPlane", &RuntimeType::plane(), exec_state)?;
    let font_point_size: Option<TyF64> = args.get_kw_arg_opt("fontPointSize", &RuntimeType::count(), exec_state)?;
    let font_scale: Option<TyF64> = args.get_kw_arg_opt("fontScale", &RuntimeType::count(), exec_state)?;

    inner_flatness(
        faces,
        tolerance,
        precision,
        gdt_position,
        in_plane,
        AnnotationStyle {
            font_point_size,
            font_scale,
        },
        exec_state,
        &args,
    )
    .await?;
    Ok(KclValue::none())
}

#[allow(clippy::too_many_arguments)]
async fn inner_flatness(
    faces: Vec<TagIdentifier>,
    tolerance: TyF64,
    precision: Option<TyF64>,
    gdt_position: Option<[TyF64; 2]>,
    in_plane: Option<Plane>,
    style: AnnotationStyle,
    exec_state: &mut ExecState,
    args: &Args,
) -> Result<(), KclError> {
    let in_plane = if let Some(plane) = in_plane {
        plane
    } else {
        // No plane given. Use one of the default planes by evaluating the `XY`
        // expression.
        let plane_ast = ast::Node::new(
            ast::Expr::Name(Box::new(ast::Node::new(
                ast::Name {
                    name: ast::Identifier::new("XY"),
                    path: Vec::new(),
                    abs_path: false,
                    digest: None,
                },
                args.source_range.start(),
                args.source_range.end(),
                args.source_range.module_id(),
            ))),
            args.source_range.start(),
            args.source_range.end(),
            args.source_range.module_id(),
        );
        let metadata = Metadata::from(args.source_range);
        let plane_value = args
            .ctx
            .execute_expr(&plane_ast, exec_state, &metadata, &[], StatementKind::Expression)
            .await?
            .clone();
        plane_value
            .as_plane()
            .ok_or_else(|| {
                KclError::new_internal(KclErrorDetails::new(
                    "Expected XY plane to be defined".to_owned(),
                    vec![args.source_range],
                ))
            })?
            .clone()
    };
    let in_plane_id = if in_plane.value == crate::exec::PlaneType::Uninit {
        // Create it in the engine.
        let engine_plane =
            make_sketch_plane_from_orientation(in_plane.info.into_plane_data(), exec_state, args).await?;
        engine_plane.id
    } else {
        in_plane.id
    };
    for face in &faces {
        let face_id = args.get_adjacent_face_to_tag(exec_state, face, true).await?;
        exec_state
            .batch_modeling_cmd(
                args.into(),
                ModelingCmd::from(mcmd::NewAnnotation {
                    options: AnnotationOptions {
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
                            leader_type: AnnotationLineEnd::Arrow,
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
                            plane_id: in_plane_id,
                            offset: if let Some(offset) = &gdt_position {
                                KPoint2d {
                                    x: offset[0].to_mm(),
                                    y: offset[1].to_mm(),
                                }
                            } else {
                                KPoint2d { x: 100.0, y: 100.0 }
                            },
                            precision: precision.as_ref().map(|n| n.n.round() as u32).unwrap_or(3),
                            font_scale: style.font_scale.as_ref().map(|n| n.n as f32).unwrap_or(1.0),
                            font_point_size: style.font_point_size.as_ref().map(|n| n.n.round() as u32).unwrap_or(36),
                        }),
                        feature_tag: None,
                    },
                    clobber: false,
                    annotation_type: AnnotationType::T3D,
                }),
            )
            .await?;
    }
    Ok(())
}
