use kcmc::{ModelingCmd, each_cmd as mcmd};
use kittycad_modeling_cmds::{
    self as kcmc,
    ok_response::OkModelingCmdResponse,
    shared::{
        AnnotationFeatureControl, AnnotationLineEnd, AnnotationMbdControlFrame, AnnotationOptions,
        AnnotationTextAlignmentX, AnnotationTextAlignmentY, AnnotationTextOptions, AnnotationType, Color, MbdSymbol,
        Point2d, Point3d,
    },
    websocket::OkWebSocketResponseData,
};

use crate::{
    ExecState, KclError,
    errors::KclErrorDetails,
    exec::KclValue,
    execution::{
        TagIdentifier,
        types::{ArrayLen, RuntimeType},
    },
    fmt,
    std::{Args, args::TyF64},
};

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
    let annotation_style_ty = RuntimeType::from_alias("AnnotationStyle", exec_state, args.source_range)
        .map_err(|err| KclError::internal(format!("Error getting AnnotationStyle runtime type; {err:?}")))?;
    let style: Option<AnnotationStyle> = args.get_kw_arg_opt("style", &annotation_style_ty, exec_state)?;

    inner_flatness(faces, tolerance, style, exec_state, &args).await?;
    Ok(KclValue::none())
}

async fn inner_flatness(
    faces: Vec<TagIdentifier>,
    tolerance: TyF64,
    style: Option<AnnotationStyle>,
    exec_state: &mut ExecState,
    args: &Args,
) -> Result<(), KclError> {
    let tolerance_str = fmt::format_number_value(tolerance.n, tolerance.ty).map_err(|e| {
        KclError::new_internal(KclErrorDetails::new(
            format!("Failed to format tolerance value {}: {}", tolerance.n, e),
            vec![args.source_range],
        ))
    })?;
    let plane_id = {
        let arc = args.ctx.engine.get_default_planes();
        let default_planes_guard = arc.read().await;
        let Some(planes) = &*default_planes_guard else {
            return Err(KclError::new_semantic(KclErrorDetails::new(
                "No default construction plane found".to_string(),
                vec![args.source_range],
            )));
        };
        planes.xy
    };
    for face in &faces {
        let face_id = args.get_adjacent_face_to_tag(exec_state, face, true).await?;
        // Get the center point of the face.
        let OkWebSocketResponseData::Modeling {
            modeling_response:
                OkModelingCmdResponse::FaceGetCenter(kittycad_modeling_cmds::output::FaceGetCenter { pos: center }),
        } = exec_state
            .send_modeling_cmd(
                args.into(),
                ModelingCmd::from(mcmd::FaceGetCenter { object_id: face_id }),
            )
            .await?
        else {
            return Err(KclError::new_semantic(KclErrorDetails::new(
                format!("Failed to get center of face {face_id}"),
                vec![args.source_range],
            )));
        };
        let feature_control_id = exec_state.next_uuid();
        exec_state
            .batch_modeling_cmd(
                args.into(),
                ModelingCmd::from(mcmd::NewAnnotation {
                    options: AnnotationOptions {
                        text: Some(AnnotationTextOptions {
                            x: AnnotationTextAlignmentX::Center,
                            y: AnnotationTextAlignmentY::Center,
                            text: format!("Flatness tolerance {tolerance_str}"),
                            point_size: 12,
                        }),
                        line_ends: None,
                        line_width: None,
                        color: Some(Color {
                            r: 0.1,
                            g: 0.1,
                            b: 0.1,
                            a: 1.0,
                        }),
                        // The engine should accept LengthUnit, but it doesn't,
                        // so we need to do a weird conversion and assume the
                        // engine responded with millimeters.
                        position: Some(Point3d {
                            x: center.x.0 as f32,
                            y: center.y.0 as f32,
                            z: center.z.0 as f32,
                        }),
                        dimension: None,
                        feature_control: Some(AnnotationFeatureControl {
                            entity_id: feature_control_id,
                            entity_pos: Default::default(),
                            leader_type: AnnotationLineEnd::None,
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
                            plane_id,
                            offset: Point2d { x: 50.0, y: 50.0 },
                            precision: 3,
                            font_scale: style
                                .as_ref()
                                .and_then(|s| s.font_scale.as_ref().map(|n| n.n as f32))
                                .unwrap_or(1.0),
                            font_point_size: style
                                .as_ref()
                                .and_then(|s| s.font_point_size.as_ref().map(|n| n.n.round() as u32))
                                .unwrap_or(36),
                        }),
                        feature_tag: None,
                    },
                    clobber: true,
                    annotation_type: AnnotationType::T3D,
                }),
            )
            .await?;
    }
    Ok(())
}
