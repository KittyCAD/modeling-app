use kcl_error::SourceRange;
use kcmc::ModelingCmd;
use kcmc::each_cmd as mcmd;
use kcmc::websocket::ModelingCmdReq;
use kittycad_modeling_cmds::shared::AnnotationBasicDimension;
use kittycad_modeling_cmds::shared::AnnotationFeatureControl;
use kittycad_modeling_cmds::shared::AnnotationLineEnd;
use kittycad_modeling_cmds::shared::AnnotationMbdBasicDimension;
use kittycad_modeling_cmds::shared::AnnotationMbdControlFrame;
use kittycad_modeling_cmds::shared::AnnotationOptions;
use kittycad_modeling_cmds::shared::AnnotationType;
use kittycad_modeling_cmds::shared::MbdSymbol;
use kittycad_modeling_cmds::shared::Point2d as KPoint2d;
use kittycad_modeling_cmds::{self as kcmc};

use crate::ExecState;
use crate::KclError;
use crate::errors::KclErrorDetails;
use crate::exec::KclValue;
use crate::execution::Artifact;
use crate::execution::ArtifactId;
use crate::execution::CodeRef;
use crate::execution::ControlFlowKind;
use crate::execution::Face;
use crate::execution::GdtAnnotation;
use crate::execution::GdtAnnotationArtifact;
use crate::execution::Metadata;
use crate::execution::ModelingCmdMeta;
use crate::execution::Plane;
use crate::execution::StatementKind;
use crate::execution::TagIdentifier;
use crate::execution::types::ArrayLen;
use crate::execution::types::RuntimeType;
use crate::parsing::ast::types as ast;
use crate::std::Args;
use crate::std::args::FromKclValue;
use crate::std::args::TyF64;
use crate::std::fillet::EdgeReference;
use crate::std::sketch::ensure_sketch_plane_in_engine;

// The engine exposes two text knobs:
// - font_point_size controls the FreeType raster/bitmap texture resolution in pixels/points.
// - font_scale is the unitless model-space multiplier applied to that texture.
// KCL exposes only fontSize as a Length. Keep the raster quality fixed so changing
// quality does not resize the text, and map the requested length into font_scale.
const GDT_FONT_TEXTURE_POINT_SIZE: u32 = 36;
const DEFAULT_GDT_FONT_SIZE_MM: f64 = 10.0;
const DEFAULT_GDT_DOT_LEADER_SCALE: f64 = 1.0;
const DEFAULT_GDT_DIMENSION_LEADER_SCALE: f64 = 1.0;
const GDT_DOT_LEADER_REFERENCE_FONT_SIZE_MM: f64 = 100.0;
const GDT_DOT_LEADER_REFERENCE_ENGINE_SCALE: f64 = 0.5;

// Calibration target: measured annotation text/frame height in millimeters when
// font_scale is 1.0 and GDT_FONT_TEXTURE_POINT_SIZE is fixed. Tune this value from
// scene measurements, not by exposing engine font_point_size to users.
const GDT_FONT_SCALE_1_HEIGHT_MM: f64 = 8.0;

fn gdt_font_scale(font_size: Option<&TyF64>, args: &Args) -> Result<f32, KclError> {
    let requested_height_mm = font_size.map(TyF64::to_mm).unwrap_or(DEFAULT_GDT_FONT_SIZE_MM);
    if requested_height_mm <= 0.0 {
        return Err(KclError::new_semantic(KclErrorDetails::new(
            "fontSize must be greater than 0.".to_owned(),
            vec![args.source_range],
        )));
    }
    Ok(gdt_font_scale_for_height_mm(requested_height_mm))
}

fn gdt_font_scale_for_height_mm(requested_height_mm: f64) -> f32 {
    (requested_height_mm / GDT_FONT_SCALE_1_HEIGHT_MM) as f32
}

fn gdt_user_leader_scale(leader_scale: Option<&TyF64>, default_scale: f64, args: &Args) -> Result<f32, KclError> {
    let scale = leader_scale.map(|scale| scale.n).unwrap_or(default_scale);
    if scale <= 0.0 {
        return Err(KclError::new_semantic(KclErrorDetails::new(
            "leaderScale must be greater than 0.".to_owned(),
            vec![args.source_range],
        )));
    }
    Ok(scale as f32)
}

fn gdt_dot_leader_scale(leader_scale: Option<&TyF64>, font_size: Option<&TyF64>, args: &Args) -> Result<f32, KclError> {
    let user_scale = gdt_user_leader_scale(leader_scale, DEFAULT_GDT_DOT_LEADER_SCALE, args)?;
    // Engine dot leaders are screen-space point sprites after an internal font_scale
    // multiplier. Divide that out so KCL leaderScale stays stable across fontSize.
    Ok(user_scale * gdt_dot_leader_normal_size() / gdt_font_scale(font_size, args)?)
}

fn gdt_dot_leader_normal_size() -> f32 {
    gdt_font_scale_for_height_mm(GDT_DOT_LEADER_REFERENCE_FONT_SIZE_MM) * (GDT_DOT_LEADER_REFERENCE_ENGINE_SCALE as f32)
}

fn gdt_dimension_leader_scale(leader_scale: Option<&TyF64>, args: &Args) -> Result<f32, KclError> {
    gdt_user_leader_scale(leader_scale, DEFAULT_GDT_DIMENSION_LEADER_SCALE, args)
}

fn set_engine_scene_units_cmd(cmd_id: uuid::Uuid, units: kcmc::units::UnitLength) -> ModelingCmdReq {
    ModelingCmdReq {
        cmd_id: cmd_id.into(),
        cmd: ModelingCmd::from(mcmd::SetSceneUnits::builder().unit(units).build()),
    }
}

#[derive(Debug, Clone)]
enum DistanceEntity {
    Face(Box<Face>),
    TaggedFace(Box<TagIdentifier>),
    Edge(EdgeReference),
}

#[derive(Debug, Clone, Copy)]
struct DistanceEndpoint {
    entity_id: uuid::Uuid,
    entity_pos: KPoint2d<f64>,
}

fn add_gdt_annotation_artifact(exec_state: &mut ExecState, args: &Args, annotation_id: uuid::Uuid) {
    exec_state.add_artifact(Artifact::GdtAnnotation(GdtAnnotationArtifact {
        id: ArtifactId::new(annotation_id),
        code_ref: CodeRef::placeholder(args.source_range),
    }));
}

impl DistanceEntity {
    async fn to_endpoint(&self, exec_state: &mut ExecState, args: &Args) -> Result<DistanceEndpoint, KclError> {
        match self {
            DistanceEntity::Face(face) => Ok(DistanceEndpoint {
                entity_id: face.id,
                entity_pos: KPoint2d { x: 0.5, y: 0.5 },
            }),
            DistanceEntity::TaggedFace(face) => Ok(DistanceEndpoint {
                entity_id: args.get_adjacent_face_to_tag(exec_state, face, false).await?,
                entity_pos: KPoint2d { x: 0.5, y: 0.5 },
            }),
            DistanceEntity::Edge(edge) => Ok(DistanceEndpoint {
                entity_id: edge.get_engine_id(exec_state, args)?,
                entity_pos: KPoint2d { x: 0.5, y: 0.0 },
            }),
        }
    }
}

impl<'a> FromKclValue<'a> for DistanceEntity {
    fn from_kcl_val(arg: &'a KclValue) -> Option<Self> {
        match arg {
            KclValue::Face { value } => Some(Self::Face(value.to_owned())),
            KclValue::Uuid { value, .. } => Some(Self::Edge(EdgeReference::Uuid(*value))),
            KclValue::TagIdentifier(value) => Some(Self::TaggedFace(value.to_owned())),
            _ => None,
        }
    }
}

fn distance_entity_type() -> RuntimeType {
    RuntimeType::Union(vec![
        RuntimeType::face(),
        RuntimeType::tagged_face(),
        RuntimeType::edge(),
    ])
}

pub async fn datum(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let face: TagIdentifier = args.get_kw_arg("face", &RuntimeType::tagged_face(), exec_state)?;
    let name: String = args.get_kw_arg("name", &RuntimeType::string(), exec_state)?;
    let frame_position: Option<[TyF64; 2]> =
        args.get_kw_arg_opt("framePosition", &RuntimeType::point2d(), exec_state)?;
    let frame_plane: Option<Plane> = args.get_kw_arg_opt("framePlane", &RuntimeType::plane(), exec_state)?;
    let leader_scale: Option<TyF64> = args.get_kw_arg_opt("leaderScale", &RuntimeType::count(), exec_state)?;
    let font_size: Option<TyF64> = args.get_kw_arg_opt("fontSize", &RuntimeType::length(), exec_state)?;

    let annotation = inner_datum(
        face,
        name,
        frame_position,
        frame_plane,
        leader_scale,
        font_size,
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
    font_size: Option<TyF64>,
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
    ensure_sketch_plane_in_engine(
        &mut frame_plane,
        exec_state,
        &args.ctx,
        args.source_range,
        args.node_path.clone(),
    )
    .await?;
    let face_id = args.get_adjacent_face_to_tag(exec_state, &face, false).await?;
    let meta = vec![Metadata::from(args.source_range)];
    let annotation_id = exec_state.next_uuid();
    let feature_control = AnnotationFeatureControl::builder()
        .entity_id(face_id)
        // Point to the center of the face.
        .entity_pos(KPoint2d { x: 0.5, y: 0.5 })
        .leader_type(AnnotationLineEnd::Dot)
        .defined_datum(name_char)
        .plane_id(frame_plane.id)
        .offset(if let Some(offset) = &frame_position {
            KPoint2d {
                x: offset[0].to_mm(),
                y: offset[1].to_mm(),
            }
        } else {
            KPoint2d { x: 100.0, y: 100.0 }
        })
        .precision(0)
        .font_scale(gdt_font_scale(font_size.as_ref(), args)?)
        .font_point_size(GDT_FONT_TEXTURE_POINT_SIZE)
        .leader_scale(gdt_dot_leader_scale(leader_scale.as_ref(), font_size.as_ref(), args)?)
        .build();
    exec_state
        .batch_modeling_cmd(
            ModelingCmdMeta::from_args_id(exec_state, args, annotation_id),
            ModelingCmd::from(
                mcmd::NewAnnotation::builder()
                    .options(AnnotationOptions::builder().feature_control(feature_control).build())
                    .clobber(false)
                    .annotation_type(AnnotationType::T3D)
                    .build(),
            ),
        )
        .await?;
    add_gdt_annotation_artifact(exec_state, args, annotation_id);
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
    let font_size: Option<TyF64> = args.get_kw_arg_opt("fontSize", &RuntimeType::length(), exec_state)?;

    let annotations = inner_flatness(
        faces,
        tolerance,
        precision,
        frame_position,
        frame_plane,
        leader_scale,
        font_size,
        exec_state,
        &args,
    )
    .await?;
    Ok(annotations.into())
}

pub async fn profile(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let edges: Vec<EdgeReference> = args.get_kw_arg(
        "edges",
        &RuntimeType::Array(Box::new(RuntimeType::edge()), ArrayLen::Minimum(1)),
        exec_state,
    )?;
    let datums: Option<Vec<String>> = args.get_kw_arg_opt(
        "datums",
        &RuntimeType::Array(Box::new(RuntimeType::string()), ArrayLen::Minimum(1)),
        exec_state,
    )?;
    let tolerance = args.get_kw_arg("tolerance", &RuntimeType::length(), exec_state)?;
    let precision = args.get_kw_arg_opt("precision", &RuntimeType::count(), exec_state)?;
    let frame_position: Option<[TyF64; 2]> =
        args.get_kw_arg_opt("framePosition", &RuntimeType::point2d(), exec_state)?;
    let frame_plane: Option<Plane> = args.get_kw_arg_opt("framePlane", &RuntimeType::plane(), exec_state)?;
    let leader_scale: Option<TyF64> = args.get_kw_arg_opt("leaderScale", &RuntimeType::count(), exec_state)?;
    let font_size: Option<TyF64> = args.get_kw_arg_opt("fontSize", &RuntimeType::length(), exec_state)?;

    let annotations = inner_profile(
        edges,
        datums,
        tolerance,
        precision,
        frame_position,
        frame_plane,
        leader_scale,
        font_size,
        exec_state,
        &args,
    )
    .await?;
    Ok(annotations.into())
}

pub async fn position(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let faces: Option<Vec<TagIdentifier>> = args.get_kw_arg_opt(
        "faces",
        &RuntimeType::Array(Box::new(RuntimeType::tagged_face()), ArrayLen::Minimum(1)),
        exec_state,
    )?;
    let edges: Option<Vec<EdgeReference>> = args.get_kw_arg_opt(
        "edges",
        &RuntimeType::Array(Box::new(RuntimeType::edge()), ArrayLen::Minimum(1)),
        exec_state,
    )?;
    let datums: Option<Vec<String>> = args.get_kw_arg_opt(
        "datums",
        &RuntimeType::Array(Box::new(RuntimeType::string()), ArrayLen::Minimum(1)),
        exec_state,
    )?;
    let tolerance = args.get_kw_arg("tolerance", &RuntimeType::length(), exec_state)?;
    let precision = args.get_kw_arg_opt("precision", &RuntimeType::count(), exec_state)?;
    let frame_position: Option<[TyF64; 2]> =
        args.get_kw_arg_opt("framePosition", &RuntimeType::point2d(), exec_state)?;
    let frame_plane: Option<Plane> = args.get_kw_arg_opt("framePlane", &RuntimeType::plane(), exec_state)?;
    let leader_scale: Option<TyF64> = args.get_kw_arg_opt("leaderScale", &RuntimeType::count(), exec_state)?;
    let font_size: Option<TyF64> = args.get_kw_arg_opt("fontSize", &RuntimeType::length(), exec_state)?;

    let annotations = inner_position(
        faces.unwrap_or_default(),
        edges.unwrap_or_default(),
        tolerance,
        datums,
        precision,
        frame_position,
        frame_plane,
        leader_scale,
        font_size,
        exec_state,
        &args,
    )
    .await?;
    Ok(annotations.into())
}

pub async fn distance(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let from: Option<DistanceEntity> = args.get_kw_arg_opt("from", &distance_entity_type(), exec_state)?;
    let to: Option<DistanceEntity> = args.get_kw_arg_opt("to", &distance_entity_type(), exec_state)?;
    let edges: Option<Vec<EdgeReference>> = args.get_kw_arg_opt(
        "edges",
        &RuntimeType::Array(Box::new(RuntimeType::edge()), ArrayLen::Minimum(1)),
        exec_state,
    )?;
    let tolerance = args.get_kw_arg("tolerance", &RuntimeType::length(), exec_state)?;
    let precision = args.get_kw_arg_opt("precision", &RuntimeType::count(), exec_state)?;
    let frame_position: Option<[TyF64; 2]> =
        args.get_kw_arg_opt("framePosition", &RuntimeType::point2d(), exec_state)?;
    let frame_plane: Option<Plane> = args.get_kw_arg_opt("framePlane", &RuntimeType::plane(), exec_state)?;
    let leader_scale: Option<TyF64> = args.get_kw_arg_opt("leaderScale", &RuntimeType::count(), exec_state)?;
    let font_size: Option<TyF64> = args.get_kw_arg_opt("fontSize", &RuntimeType::length(), exec_state)?;

    let annotations = inner_distance(
        from,
        to,
        edges.unwrap_or_default(),
        tolerance,
        precision,
        frame_position,
        frame_plane,
        leader_scale,
        font_size,
        exec_state,
        &args,
    )
    .await?;
    Ok(annotations.into())
}

pub async fn perpendicularity(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let faces: Option<Vec<TagIdentifier>> = args.get_kw_arg_opt(
        "faces",
        &RuntimeType::Array(Box::new(RuntimeType::tagged_face()), ArrayLen::Minimum(1)),
        exec_state,
    )?;
    let edges: Option<Vec<EdgeReference>> = args.get_kw_arg_opt(
        "edges",
        &RuntimeType::Array(Box::new(RuntimeType::edge()), ArrayLen::Minimum(1)),
        exec_state,
    )?;
    let datums: Option<Vec<String>> = args.get_kw_arg_opt(
        "datums",
        &RuntimeType::Array(Box::new(RuntimeType::string()), ArrayLen::Minimum(1)),
        exec_state,
    )?;
    let tolerance = args.get_kw_arg("tolerance", &RuntimeType::length(), exec_state)?;
    let precision = args.get_kw_arg_opt("precision", &RuntimeType::count(), exec_state)?;
    let frame_position: Option<[TyF64; 2]> =
        args.get_kw_arg_opt("framePosition", &RuntimeType::point2d(), exec_state)?;
    let frame_plane: Option<Plane> = args.get_kw_arg_opt("framePlane", &RuntimeType::plane(), exec_state)?;
    let leader_scale: Option<TyF64> = args.get_kw_arg_opt("leaderScale", &RuntimeType::count(), exec_state)?;
    let font_size: Option<TyF64> = args.get_kw_arg_opt("fontSize", &RuntimeType::length(), exec_state)?;

    let annotations = inner_perpendicularity(
        faces.unwrap_or_default(),
        edges.unwrap_or_default(),
        datums,
        tolerance,
        precision,
        frame_position,
        frame_plane,
        leader_scale,
        font_size,
        exec_state,
        &args,
    )
    .await?;
    Ok(annotations.into())
}

pub async fn parallelism(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let faces: Option<Vec<TagIdentifier>> = args.get_kw_arg_opt(
        "faces",
        &RuntimeType::Array(Box::new(RuntimeType::tagged_face()), ArrayLen::Minimum(1)),
        exec_state,
    )?;
    let edges: Option<Vec<EdgeReference>> = args.get_kw_arg_opt(
        "edges",
        &RuntimeType::Array(Box::new(RuntimeType::edge()), ArrayLen::Minimum(1)),
        exec_state,
    )?;
    let datums: Option<Vec<String>> = args.get_kw_arg_opt(
        "datums",
        &RuntimeType::Array(Box::new(RuntimeType::string()), ArrayLen::Minimum(1)),
        exec_state,
    )?;
    let tolerance = args.get_kw_arg("tolerance", &RuntimeType::length(), exec_state)?;
    let precision = args.get_kw_arg_opt("precision", &RuntimeType::count(), exec_state)?;
    let frame_position: Option<[TyF64; 2]> =
        args.get_kw_arg_opt("framePosition", &RuntimeType::point2d(), exec_state)?;
    let frame_plane: Option<Plane> = args.get_kw_arg_opt("framePlane", &RuntimeType::plane(), exec_state)?;
    let leader_scale: Option<TyF64> = args.get_kw_arg_opt("leaderScale", &RuntimeType::count(), exec_state)?;
    let font_size: Option<TyF64> = args.get_kw_arg_opt("fontSize", &RuntimeType::length(), exec_state)?;

    let annotations = inner_parallelism(
        faces.unwrap_or_default(),
        edges.unwrap_or_default(),
        datums,
        tolerance,
        precision,
        frame_position,
        frame_plane,
        leader_scale,
        font_size,
        exec_state,
        &args,
    )
    .await?;
    Ok(annotations.into())
}

pub async fn annotation(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let annotation: String = args.get_kw_arg("annotation", &RuntimeType::string(), exec_state)?;
    let faces: Option<Vec<TagIdentifier>> = args.get_kw_arg_opt(
        "faces",
        &RuntimeType::Array(Box::new(RuntimeType::tagged_face()), ArrayLen::Minimum(1)),
        exec_state,
    )?;
    let edges: Option<Vec<EdgeReference>> = args.get_kw_arg_opt(
        "edges",
        &RuntimeType::Array(Box::new(RuntimeType::edge()), ArrayLen::Minimum(1)),
        exec_state,
    )?;
    let frame_position: Option<[TyF64; 2]> =
        args.get_kw_arg_opt("framePosition", &RuntimeType::point2d(), exec_state)?;
    let frame_plane: Option<Plane> = args.get_kw_arg_opt("framePlane", &RuntimeType::plane(), exec_state)?;
    let leader_scale: Option<TyF64> = args.get_kw_arg_opt("leaderScale", &RuntimeType::count(), exec_state)?;
    let font_size: Option<TyF64> = args.get_kw_arg_opt("fontSize", &RuntimeType::length(), exec_state)?;

    let annotations = inner_annotation(
        annotation,
        faces.unwrap_or_default(),
        edges.unwrap_or_default(),
        frame_position,
        frame_plane,
        leader_scale,
        font_size,
        exec_state,
        &args,
    )
    .await?;
    Ok(annotations.into())
}

#[allow(clippy::too_many_arguments)]
async fn inner_perpendicularity(
    faces: Vec<TagIdentifier>,
    edges: Vec<EdgeReference>,
    datums: Option<Vec<String>>,
    tolerance: TyF64,
    precision: Option<TyF64>,
    frame_position: Option<[TyF64; 2]>,
    frame_plane: Option<Plane>,
    leader_scale: Option<TyF64>,
    font_size: Option<TyF64>,
    exec_state: &mut ExecState,
    args: &Args,
) -> Result<Vec<GdtAnnotation>, KclError> {
    if faces.is_empty() && edges.is_empty() {
        return Err(KclError::new_semantic(KclErrorDetails::new(
            "Perpendicularity requires at least one face or edge.".to_owned(),
            vec![args.source_range],
        )));
    }

    let precision = resolve_precision(precision, args)?;
    let datums = resolve_datums(datums, args, "Perpendicularity")?;
    let mut frame_plane = if let Some(plane) = frame_plane {
        plane
    } else {
        xy_plane(exec_state, args).await?
    };
    ensure_sketch_plane_in_engine(
        &mut frame_plane,
        exec_state,
        &args.ctx,
        args.source_range,
        args.node_path.clone(),
    )
    .await?;

    let mut annotations = Vec::with_capacity(faces.len() + edges.len());
    for face in &faces {
        let face_id = args.get_adjacent_face_to_tag(exec_state, face, false).await?;
        create_feature_control_annotation(
            face_id,
            MbdSymbol::Perpendicularity,
            &tolerance,
            &datums,
            precision,
            frame_position.as_ref(),
            frame_plane.id,
            leader_scale.as_ref(),
            font_size.as_ref(),
            exec_state,
            args,
            &mut annotations,
        )
        .await?;
    }
    for edge in &edges {
        let edge_id = edge.get_engine_id(exec_state, args)?;
        create_feature_control_annotation(
            edge_id,
            MbdSymbol::Perpendicularity,
            &tolerance,
            &datums,
            precision,
            frame_position.as_ref(),
            frame_plane.id,
            leader_scale.as_ref(),
            font_size.as_ref(),
            exec_state,
            args,
            &mut annotations,
        )
        .await?;
    }

    Ok(annotations)
}

#[allow(clippy::too_many_arguments)]
async fn inner_parallelism(
    faces: Vec<TagIdentifier>,
    edges: Vec<EdgeReference>,
    datums: Option<Vec<String>>,
    tolerance: TyF64,
    precision: Option<TyF64>,
    frame_position: Option<[TyF64; 2]>,
    frame_plane: Option<Plane>,
    leader_scale: Option<TyF64>,
    font_size: Option<TyF64>,
    exec_state: &mut ExecState,
    args: &Args,
) -> Result<Vec<GdtAnnotation>, KclError> {
    if faces.is_empty() && edges.is_empty() {
        return Err(KclError::new_semantic(KclErrorDetails::new(
            "Parallelism requires at least one face or edge.".to_owned(),
            vec![args.source_range],
        )));
    }

    let precision = resolve_precision(precision, args)?;
    let datums = resolve_datums(datums, args, "Parallelism")?;
    let mut frame_plane = if let Some(plane) = frame_plane {
        plane
    } else {
        xy_plane(exec_state, args).await?
    };
    ensure_sketch_plane_in_engine(
        &mut frame_plane,
        exec_state,
        &args.ctx,
        args.source_range,
        args.node_path.clone(),
    )
    .await?;

    let mut annotations = Vec::with_capacity(faces.len() + edges.len());
    for face in &faces {
        let face_id = args.get_adjacent_face_to_tag(exec_state, face, false).await?;
        create_feature_control_annotation(
            face_id,
            MbdSymbol::Parallelism,
            &tolerance,
            &datums,
            precision,
            frame_position.as_ref(),
            frame_plane.id,
            leader_scale.as_ref(),
            font_size.as_ref(),
            exec_state,
            args,
            &mut annotations,
        )
        .await?;
    }
    for edge in &edges {
        let edge_id = edge.get_engine_id(exec_state, args)?;
        create_feature_control_annotation(
            edge_id,
            MbdSymbol::Parallelism,
            &tolerance,
            &datums,
            precision,
            frame_position.as_ref(),
            frame_plane.id,
            leader_scale.as_ref(),
            font_size.as_ref(),
            exec_state,
            args,
            &mut annotations,
        )
        .await?;
    }

    Ok(annotations)
}

#[allow(clippy::too_many_arguments)]
async fn inner_annotation(
    annotation: String,
    faces: Vec<TagIdentifier>,
    edges: Vec<EdgeReference>,
    frame_position: Option<[TyF64; 2]>,
    frame_plane: Option<Plane>,
    leader_scale: Option<TyF64>,
    font_size: Option<TyF64>,
    exec_state: &mut ExecState,
    args: &Args,
) -> Result<Vec<GdtAnnotation>, KclError> {
    if annotation.is_empty() {
        return Err(KclError::new_semantic(KclErrorDetails::new(
            "Annotation text must not be empty.".to_owned(),
            vec![args.source_range],
        )));
    }
    if faces.is_empty() && edges.is_empty() {
        return Err(KclError::new_semantic(KclErrorDetails::new(
            "Annotation requires at least one face or edge.".to_owned(),
            vec![args.source_range],
        )));
    }

    let mut frame_plane = if let Some(plane) = frame_plane {
        plane
    } else {
        xy_plane(exec_state, args).await?
    };
    ensure_sketch_plane_in_engine(
        &mut frame_plane,
        exec_state,
        &args.ctx,
        args.source_range,
        args.node_path.clone(),
    )
    .await?;

    let mut annotations = Vec::with_capacity(faces.len() + edges.len());
    for face in &faces {
        let face_id = args.get_adjacent_face_to_tag(exec_state, face, false).await?;
        create_annotation(
            face_id,
            &annotation,
            frame_position.as_ref(),
            frame_plane.id,
            leader_scale.as_ref(),
            font_size.as_ref(),
            exec_state,
            args,
            &mut annotations,
        )
        .await?;
    }
    for edge in &edges {
        let edge_id = edge.get_engine_id(exec_state, args)?;
        create_annotation(
            edge_id,
            &annotation,
            frame_position.as_ref(),
            frame_plane.id,
            leader_scale.as_ref(),
            font_size.as_ref(),
            exec_state,
            args,
            &mut annotations,
        )
        .await?;
    }

    Ok(annotations)
}

#[allow(clippy::too_many_arguments)]
async fn inner_distance(
    from: Option<DistanceEntity>,
    to: Option<DistanceEntity>,
    edges: Vec<EdgeReference>,
    tolerance: TyF64,
    precision: Option<TyF64>,
    frame_position: Option<[TyF64; 2]>,
    frame_plane: Option<Plane>,
    leader_scale: Option<TyF64>,
    font_size: Option<TyF64>,
    exec_state: &mut ExecState,
    args: &Args,
) -> Result<Vec<GdtAnnotation>, KclError> {
    let precision = resolve_precision(precision, args)?;
    let mut frame_plane = if let Some(plane) = frame_plane {
        plane
    } else {
        xy_plane(exec_state, args).await?
    };
    ensure_sketch_plane_in_engine(
        &mut frame_plane,
        exec_state,
        &args.ctx,
        args.source_range,
        args.node_path.clone(),
    )
    .await?;

    if from.is_some() || to.is_some() {
        if !edges.is_empty() {
            return Err(KclError::new_semantic(KclErrorDetails::new(
                "Distance cannot combine `from`/`to` with `edges`.".to_owned(),
                vec![args.source_range],
            )));
        }

        let (Some(from), Some(to)) = (from, to) else {
            return Err(KclError::new_semantic(KclErrorDetails::new(
                "Distance requires both `from` and `to` when measuring between entities.".to_owned(),
                vec![args.source_range],
            )));
        };

        let from = from.to_endpoint(exec_state, args).await?;
        let to = to.to_endpoint(exec_state, args).await?;
        let mut annotations = Vec::with_capacity(1);
        create_basic_distance_annotation(
            from,
            to,
            &tolerance,
            precision,
            frame_position.as_ref(),
            frame_plane.id,
            leader_scale.as_ref(),
            font_size.as_ref(),
            exec_state,
            args,
            &mut annotations,
        )
        .await?;
        return Ok(annotations);
    }

    if edges.is_empty() {
        return Err(KclError::new_semantic(KclErrorDetails::new(
            "Distance requires either `edges` or both `from` and `to`.".to_owned(),
            vec![args.source_range],
        )));
    }

    let mut annotations = Vec::with_capacity(edges.len());
    for edge in &edges {
        let edge_id = edge.get_engine_id(exec_state, args)?;
        create_basic_distance_annotation(
            DistanceEndpoint {
                entity_id: edge_id,
                entity_pos: KPoint2d { x: 0.0, y: 0.0 },
            },
            DistanceEndpoint {
                entity_id: edge_id,
                entity_pos: KPoint2d { x: 1.0, y: 0.0 },
            },
            &tolerance,
            precision,
            frame_position.as_ref(),
            frame_plane.id,
            leader_scale.as_ref(),
            font_size.as_ref(),
            exec_state,
            args,
            &mut annotations,
        )
        .await?;
    }
    Ok(annotations)
}

#[allow(clippy::too_many_arguments)]
async fn inner_profile(
    edges: Vec<EdgeReference>,
    datums: Option<Vec<String>>,
    tolerance: TyF64,
    precision: Option<TyF64>,
    frame_position: Option<[TyF64; 2]>,
    frame_plane: Option<Plane>,
    leader_scale: Option<TyF64>,
    font_size: Option<TyF64>,
    exec_state: &mut ExecState,
    args: &Args,
) -> Result<Vec<GdtAnnotation>, KclError> {
    let precision = resolve_precision(precision, args)?;
    let datums = resolve_datums(datums, args, "Profile")?;
    let mut frame_plane = if let Some(plane) = frame_plane {
        plane
    } else {
        xy_plane(exec_state, args).await?
    };
    ensure_sketch_plane_in_engine(
        &mut frame_plane,
        exec_state,
        &args.ctx,
        args.source_range,
        args.node_path.clone(),
    )
    .await?;

    let mut annotations = Vec::with_capacity(edges.len());
    for edge in &edges {
        let edge_id = edge.get_engine_id(exec_state, args)?;
        create_feature_control_annotation(
            edge_id,
            MbdSymbol::ProfileOfLine,
            &tolerance,
            &datums,
            precision,
            frame_position.as_ref(),
            frame_plane.id,
            leader_scale.as_ref(),
            font_size.as_ref(),
            exec_state,
            args,
            &mut annotations,
        )
        .await?;
    }
    Ok(annotations)
}

#[allow(clippy::too_many_arguments)]
async fn inner_position(
    faces: Vec<TagIdentifier>,
    edges: Vec<EdgeReference>,
    tolerance: TyF64,
    datums: Option<Vec<String>>,
    precision: Option<TyF64>,
    frame_position: Option<[TyF64; 2]>,
    frame_plane: Option<Plane>,
    leader_scale: Option<TyF64>,
    font_size: Option<TyF64>,
    exec_state: &mut ExecState,
    args: &Args,
) -> Result<Vec<GdtAnnotation>, KclError> {
    if faces.is_empty() && edges.is_empty() {
        return Err(KclError::new_semantic(KclErrorDetails::new(
            "Position requires at least one face or edge.".to_owned(),
            vec![args.source_range],
        )));
    }

    let precision = resolve_precision(precision, args)?;
    let datums = resolve_datums(datums, args, "Position")?;
    let mut frame_plane = if let Some(plane) = frame_plane {
        plane
    } else {
        xy_plane(exec_state, args).await?
    };
    ensure_sketch_plane_in_engine(
        &mut frame_plane,
        exec_state,
        &args.ctx,
        args.source_range,
        args.node_path.clone(),
    )
    .await?;

    let mut annotations = Vec::with_capacity(faces.len() + edges.len());
    for face in &faces {
        let face_id = args.get_adjacent_face_to_tag(exec_state, face, false).await?;
        create_feature_control_annotation(
            face_id,
            MbdSymbol::Position,
            &tolerance,
            &datums,
            precision,
            frame_position.as_ref(),
            frame_plane.id,
            leader_scale.as_ref(),
            font_size.as_ref(),
            exec_state,
            args,
            &mut annotations,
        )
        .await?;
    }
    for edge in &edges {
        let edge_id = edge.get_engine_id(exec_state, args)?;
        create_feature_control_annotation(
            edge_id,
            MbdSymbol::Position,
            &tolerance,
            &datums,
            precision,
            frame_position.as_ref(),
            frame_plane.id,
            leader_scale.as_ref(),
            font_size.as_ref(),
            exec_state,
            args,
            &mut annotations,
        )
        .await?;
    }
    Ok(annotations)
}

#[allow(clippy::too_many_arguments)]
async fn inner_flatness(
    faces: Vec<TagIdentifier>,
    tolerance: TyF64,
    precision: Option<TyF64>,
    frame_position: Option<[TyF64; 2]>,
    frame_plane: Option<Plane>,
    leader_scale: Option<TyF64>,
    font_size: Option<TyF64>,
    exec_state: &mut ExecState,
    args: &Args,
) -> Result<Vec<GdtAnnotation>, KclError> {
    let precision = resolve_precision(precision, args)?;
    let mut frame_plane = if let Some(plane) = frame_plane {
        plane
    } else {
        // No plane given. Use one of the standard planes.
        xy_plane(exec_state, args).await?
    };
    ensure_sketch_plane_in_engine(
        &mut frame_plane,
        exec_state,
        &args.ctx,
        args.source_range,
        args.node_path.clone(),
    )
    .await?;
    let mut annotations = Vec::with_capacity(faces.len());
    let display_units = exec_state.length_unit();
    for face in &faces {
        let face_id = args.get_adjacent_face_to_tag(exec_state, face, false).await?;
        let meta = vec![Metadata::from(args.source_range)];
        let annotation_id = exec_state.next_uuid();
        let feature_control = AnnotationFeatureControl::builder()
            .entity_id(face_id)
            // Point to the center of the face.
            .entity_pos(KPoint2d { x: 0.5, y: 0.5 })
            .leader_type(AnnotationLineEnd::Dot)
            .control_frame(
                AnnotationMbdControlFrame::builder()
                    .symbol(MbdSymbol::Flatness)
                    .tolerance(tolerance.to_length_units(display_units))
                    .build(),
            )
            .plane_id(frame_plane.id)
            .offset(if let Some(offset) = &frame_position {
                KPoint2d {
                    x: offset[0].to_mm(),
                    y: offset[1].to_mm(),
                }
            } else {
                KPoint2d { x: 100.0, y: 100.0 }
            })
            .precision(precision)
            .font_scale(gdt_font_scale(font_size.as_ref(), args)?)
            .font_point_size(GDT_FONT_TEXTURE_POINT_SIZE)
            .leader_scale(gdt_dot_leader_scale(leader_scale.as_ref(), font_size.as_ref(), args)?)
            .build();
        let options = AnnotationOptions::builder().feature_control(feature_control).build();
        exec_state
            .batch_modeling_cmd(
                ModelingCmdMeta::from_args_id(exec_state, args, annotation_id),
                ModelingCmd::from(
                    mcmd::NewAnnotation::builder()
                        .options(options)
                        .clobber(false)
                        .annotation_type(AnnotationType::T3D)
                        .build(),
                ),
            )
            .await?;
        add_gdt_annotation_artifact(exec_state, args, annotation_id);
        annotations.push(GdtAnnotation {
            id: annotation_id,
            meta,
        });
    }
    Ok(annotations)
}

fn resolve_precision(precision: Option<TyF64>, args: &Args) -> Result<u32, KclError> {
    if let Some(precision) = precision {
        let rounded = precision.n.round();
        if !(0.0..=9.0).contains(&rounded) {
            return Err(KclError::new_semantic(KclErrorDetails::new(
                "Precision must be between 0 and 9".to_owned(),
                vec![args.source_range],
            )));
        }
        Ok(rounded as u32)
    } else {
        Ok(3)
    }
}

#[allow(clippy::too_many_arguments)]
async fn create_basic_distance_annotation(
    from: DistanceEndpoint,
    to: DistanceEndpoint,
    tolerance: &TyF64,
    precision: u32,
    frame_position: Option<&[TyF64; 2]>,
    frame_plane_id: uuid::Uuid,
    leader_scale: Option<&TyF64>,
    font_size: Option<&TyF64>,
    exec_state: &mut ExecState,
    args: &Args,
    annotations: &mut Vec<GdtAnnotation>,
) -> Result<(), KclError> {
    let meta = vec![Metadata::from(args.source_range)];
    let annotation_id = exec_state.next_uuid();
    let display_units = exec_state.length_unit();
    let dimension = AnnotationBasicDimension::builder()
        .from_entity_id(from.entity_id)
        .from_entity_pos(from.entity_pos)
        .to_entity_id(to.entity_id)
        .to_entity_pos(to.entity_pos)
        .dimension(
            AnnotationMbdBasicDimension::builder()
                .tolerance(tolerance.to_length_units(display_units))
                .build(),
        )
        .plane_id(frame_plane_id)
        .offset(if let Some(offset) = frame_position {
            KPoint2d {
                x: offset[0].to_mm(),
                y: offset[1].to_mm(),
            }
        } else {
            KPoint2d { x: 100.0, y: 100.0 }
        })
        .precision(precision)
        .font_scale(gdt_font_scale(font_size, args)?)
        .font_point_size(GDT_FONT_TEXTURE_POINT_SIZE)
        .arrow_scale(gdt_dimension_leader_scale(leader_scale, args)?)
        .build();
    let options = AnnotationOptions::builder().dimension(dimension).build();
    // The engine formats auto-measured MBD distance labels from its current scene units.
    // Queue the unit switch, annotation, and reset together so other module commands
    // cannot interleave while the engine's MBD display units are flipped.
    let use_display_units = display_units != kcmc::units::UnitLength::Millimeters;
    let annotation_cmd = ModelingCmd::from(
        mcmd::NewAnnotation::builder()
            .options(options)
            .clobber(false)
            .annotation_type(AnnotationType::T3D)
            .build(),
    );
    let cmd_meta = ModelingCmdMeta::from_args_id(exec_state, args, annotation_id);
    if use_display_units {
        let set_units_id = exec_state.next_uuid();
        let reset_units_id = exec_state.next_uuid();
        exec_state
            .batch_modeling_cmds(
                cmd_meta,
                &[
                    set_engine_scene_units_cmd(set_units_id, display_units),
                    ModelingCmdReq {
                        cmd_id: annotation_id.into(),
                        cmd: annotation_cmd,
                    },
                    set_engine_scene_units_cmd(reset_units_id, kcmc::units::UnitLength::Millimeters),
                ],
            )
            .await?;
    } else {
        exec_state.batch_modeling_cmd(cmd_meta, annotation_cmd).await?;
    }
    add_gdt_annotation_artifact(exec_state, args, annotation_id);
    annotations.push(GdtAnnotation {
        id: annotation_id,
        meta,
    });
    Ok(())
}

#[allow(clippy::too_many_arguments)]
async fn create_feature_control_annotation(
    entity_id: uuid::Uuid,
    symbol: MbdSymbol,
    tolerance: &TyF64,
    datums: &[char],
    precision: u32,
    frame_position: Option<&[TyF64; 2]>,
    frame_plane_id: uuid::Uuid,
    leader_scale: Option<&TyF64>,
    font_size: Option<&TyF64>,
    exec_state: &mut ExecState,
    args: &Args,
    annotations: &mut Vec<GdtAnnotation>,
) -> Result<(), KclError> {
    let meta = vec![Metadata::from(args.source_range)];
    let annotation_id = exec_state.next_uuid();
    let display_units = exec_state.length_unit();
    let control_frame = gdt_control_frame(symbol, tolerance.to_length_units(display_units), datums);
    let feature_control = AnnotationFeatureControl::builder()
        .entity_id(entity_id)
        .entity_pos(KPoint2d { x: 0.5, y: 0.5 })
        .leader_type(AnnotationLineEnd::Dot)
        .control_frame(control_frame)
        .plane_id(frame_plane_id)
        .offset(if let Some(offset) = frame_position {
            KPoint2d {
                x: offset[0].to_mm(),
                y: offset[1].to_mm(),
            }
        } else {
            KPoint2d { x: 100.0, y: 100.0 }
        })
        .precision(precision)
        .font_scale(gdt_font_scale(font_size, args)?)
        .font_point_size(GDT_FONT_TEXTURE_POINT_SIZE)
        .leader_scale(gdt_dot_leader_scale(leader_scale, font_size, args)?)
        .build();
    let options = AnnotationOptions::builder().feature_control(feature_control).build();
    exec_state
        .batch_modeling_cmd(
            ModelingCmdMeta::from_args_id(exec_state, args, annotation_id),
            ModelingCmd::from(
                mcmd::NewAnnotation::builder()
                    .options(options)
                    .clobber(false)
                    .annotation_type(AnnotationType::T3D)
                    .build(),
            ),
        )
        .await?;
    add_gdt_annotation_artifact(exec_state, args, annotation_id);
    annotations.push(GdtAnnotation {
        id: annotation_id,
        meta,
    });
    Ok(())
}

#[allow(clippy::too_many_arguments)]
async fn create_annotation(
    entity_id: uuid::Uuid,
    annotation: &str,
    frame_position: Option<&[TyF64; 2]>,
    frame_plane_id: uuid::Uuid,
    leader_scale: Option<&TyF64>,
    font_size: Option<&TyF64>,
    exec_state: &mut ExecState,
    args: &Args,
    annotations: &mut Vec<GdtAnnotation>,
) -> Result<(), KclError> {
    let meta = vec![Metadata::from(args.source_range)];
    let annotation_id = exec_state.next_uuid();
    let feature_control = AnnotationFeatureControl::builder()
        .entity_id(entity_id)
        .entity_pos(KPoint2d { x: 0.5, y: 0.5 })
        .leader_type(AnnotationLineEnd::Dot)
        .prefix(annotation.to_owned())
        .plane_id(frame_plane_id)
        .offset(if let Some(offset) = frame_position {
            KPoint2d {
                x: offset[0].to_mm(),
                y: offset[1].to_mm(),
            }
        } else {
            KPoint2d { x: 100.0, y: 100.0 }
        })
        .precision(0)
        .font_scale(gdt_font_scale(font_size, args)?)
        .font_point_size(GDT_FONT_TEXTURE_POINT_SIZE)
        .leader_scale(gdt_dot_leader_scale(leader_scale, font_size, args)?)
        .build();
    let options = AnnotationOptions::builder().feature_control(feature_control).build();
    exec_state
        .batch_modeling_cmd(
            ModelingCmdMeta::from_args_id(exec_state, args, annotation_id),
            ModelingCmd::from(
                mcmd::NewAnnotation::builder()
                    .options(options)
                    .clobber(false)
                    .annotation_type(AnnotationType::T3D)
                    .build(),
            ),
        )
        .await?;
    add_gdt_annotation_artifact(exec_state, args, annotation_id);
    annotations.push(GdtAnnotation {
        id: annotation_id,
        meta,
    });
    Ok(())
}

fn gdt_control_frame(symbol: MbdSymbol, tolerance: f64, datums: &[char]) -> AnnotationMbdControlFrame {
    match datums {
        [] => AnnotationMbdControlFrame::builder()
            .symbol(symbol)
            .tolerance(tolerance)
            .build(),
        [primary] => AnnotationMbdControlFrame::builder()
            .symbol(symbol)
            .tolerance(tolerance)
            .primary_datum(*primary)
            .build(),
        [primary, secondary] => AnnotationMbdControlFrame::builder()
            .symbol(symbol)
            .tolerance(tolerance)
            .primary_datum(*primary)
            .secondary_datum(*secondary)
            .build(),
        [primary, secondary, tertiary] => AnnotationMbdControlFrame::builder()
            .symbol(symbol)
            .tolerance(tolerance)
            .primary_datum(*primary)
            .secondary_datum(*secondary)
            .tertiary_datum(*tertiary)
            .build(),
        _ => unreachable!("resolve_datums rejects more than three datums"),
    }
}

fn resolve_datums(datums: Option<Vec<String>>, args: &Args, annotation_name: &str) -> Result<Vec<char>, KclError> {
    let datums = datums.unwrap_or_default();
    if datums.len() > 3 {
        return Err(KclError::new_semantic(KclErrorDetails::new(
            format!("{annotation_name} datums must include at most three names."),
            vec![args.source_range],
        )));
    }

    let mut resolved = Vec::with_capacity(datums.len());
    for datum in &datums {
        let mut chars = datum.chars();
        let Some(name) = chars.next() else {
            return Err(KclError::new_semantic(KclErrorDetails::new(
                format!("{annotation_name} datum names must be a single character."),
                vec![args.source_range],
            )));
        };
        if chars.next().is_some() {
            return Err(KclError::new_semantic(KclErrorDetails::new(
                format!("{annotation_name} datum names must be a single character."),
                vec![args.source_range],
            )));
        }
        resolved.push(name);
    }

    Ok(resolved)
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ExecutorContext;
    use crate::execution::Artifact;
    use crate::execution::ExecutorSettings;
    use crate::execution::MockConfig;
    use crate::execution::parse_execute;

    const GDT_DISTANCE_KCL_TEMPLATE: &str = r#"
@settings(defaultLengthUnit = __UNIT__, kclVersion = 2)

sketch001 = sketch(on = XY) {
  line1 = line(start = [var 0mm, var 0mm], end = [var 10mm, var 0mm])
  line2 = line(start = [var 10mm, var 0mm], end = [var 10mm, var 10mm])
  line3 = line(start = [var 10mm, var 10mm], end = [var 0mm, var 10mm])
  line4 = line(start = [var 0mm, var 10mm], end = [var 0mm, var 0mm])
  coincident([line1.end, line2.start])
  coincident([line2.end, line3.start])
  coincident([line3.end, line4.start])
  coincident([line4.end, line1.start])
  parallel([line2, line4])
  parallel([line3, line1])
  perpendicular([line1, line2])
  horizontal(line3)
}

region001 = region(point = [5mm, 5mm], sketch = sketch001)
extrude001 = extrude(region001, length = 10mm)
gdt::distance(
  edges = [
    getCommonEdge(faces = [
      region001.tags.line4,
      region001.tags.line1
    ])
  ],
  tolerance = __TOLERANCE__,
  framePosition = __FRAME_POSITION__,
  fontSize = 2in,
)
"#;

    const GDT_FLATNESS_KCL_TEMPLATE: &str = r#"
@settings(defaultLengthUnit = __UNIT__, kclVersion = 2)

sketch001 = sketch(on = XY) {
  line1 = line(start = [var 0mm, var 0mm], end = [var 10mm, var 0mm])
  line2 = line(start = [var 10mm, var 0mm], end = [var 10mm, var 10mm])
  line3 = line(start = [var 10mm, var 10mm], end = [var 0mm, var 10mm])
  line4 = line(start = [var 0mm, var 10mm], end = [var 0mm, var 0mm])
  coincident([line1.end, line2.start])
  coincident([line2.end, line3.start])
  coincident([line3.end, line4.start])
  coincident([line4.end, line1.start])
  parallel([line2, line4])
  parallel([line3, line1])
  perpendicular([line1, line2])
  horizontal(line3)
}

region001 = region(point = [5mm, 5mm], sketch = sketch001)
extrude001 = extrude(region001, length = 10mm, tagEnd = $capEnd001)
gdt::flatness(
  faces = [capEnd001],
  tolerance = __TOLERANCE__,
  framePosition = __FRAME_POSITION__,
  framePlane = XZ,
  fontSize = 2in,
)
"#;

    fn gdt_distance_kcl(unit: &str, tolerance: &str, frame_position: &str) -> String {
        GDT_DISTANCE_KCL_TEMPLATE
            .replace("__UNIT__", unit)
            .replace("__TOLERANCE__", tolerance)
            .replace("__FRAME_POSITION__", frame_position)
    }

    fn gdt_flatness_kcl(unit: &str, tolerance: &str, frame_position: &str) -> String {
        GDT_FLATNESS_KCL_TEMPLATE
            .replace("__UNIT__", unit)
            .replace("__TOLERANCE__", tolerance)
            .replace("__FRAME_POSITION__", frame_position)
    }

    async fn gdt_commands(code: &str) -> Vec<ModelingCmd> {
        let result = parse_execute(code).await.unwrap();
        result
            .root_module_artifact_commands()
            .iter()
            .map(|artifact_command| artifact_command.command.clone())
            .collect()
    }

    #[track_caller]
    fn set_scene_units(command: &ModelingCmd) -> kcmc::units::UnitLength {
        let ModelingCmd::SetSceneUnits(set_scene_units) = command else {
            panic!("expected set_scene_units command, got {command:?}");
        };
        set_scene_units.unit
    }

    #[track_caller]
    fn basic_dimension(command: &ModelingCmd) -> &AnnotationBasicDimension {
        let ModelingCmd::NewAnnotation(new_annotation) = command else {
            panic!("expected new_annotation command, got {command:?}");
        };
        new_annotation.options.dimension.as_ref().unwrap()
    }

    #[track_caller]
    fn feature_control(command: &ModelingCmd) -> &AnnotationFeatureControl {
        let ModelingCmd::NewAnnotation(new_annotation) = command else {
            panic!("expected new_annotation command, got {command:?}");
        };
        new_annotation.options.feature_control.as_ref().unwrap()
    }

    #[track_caller]
    fn assert_close(actual: f64, expected: f64) {
        assert!((actual - expected).abs() < 1e-6, "expected {expected}, got {actual}");
    }

    #[track_caller]
    fn new_annotation_command_index(commands: &[ModelingCmd]) -> usize {
        commands
            .iter()
            .position(|command| matches!(command, ModelingCmd::NewAnnotation(_)))
            .unwrap()
    }

    #[test]
    fn gdt_font_scale_is_scene_height_divided_by_calibration_height() {
        let scale_at_calibrated_height = gdt_font_scale_for_height_mm(GDT_FONT_SCALE_1_HEIGHT_MM);
        assert!((scale_at_calibrated_height - 1.0).abs() < f32::EPSILON);

        let double_height_scale = gdt_font_scale_for_height_mm(GDT_FONT_SCALE_1_HEIGHT_MM * 2.0);
        assert!((double_height_scale - 2.0).abs() < f32::EPSILON);

        let inch_in_mm = 25.4;
        let inch_scale = gdt_font_scale_for_height_mm(inch_in_mm);
        assert!((inch_scale - (inch_in_mm / GDT_FONT_SCALE_1_HEIGHT_MM) as f32).abs() < f32::EPSILON);
    }

    const GDT_FLATNESS_LEADER_KCL_TEMPLATE: &str = r#"
@settings(defaultLengthUnit = mm, kclVersion = 2)

blockProfile = sketch(on = XY) {
  edge1 = line(start = [var 0mm, var 0mm], end = [var 10mm, var 0mm])
  edge2 = line(start = [var 10mm, var 0mm], end = [var 10mm, var 10mm])
  edge3 = line(start = [var 10mm, var 10mm], end = [var 0mm, var 10mm])
  edge4 = line(start = [var 0mm, var 10mm], end = [var 0mm, var 0mm])
  coincident([edge1.end, edge2.start])
  coincident([edge2.end, edge3.start])
  coincident([edge3.end, edge4.start])
  coincident([edge4.end, edge1.start])
  parallel([edge2, edge4])
  parallel([edge3, edge1])
  perpendicular([edge1, edge2])
  horizontal(edge3)
}

region001 = region(point = [5mm, 5mm], sketch = blockProfile)
extrude001 = extrude(region001, length = 10mm, tagEnd = $top)
gdt::flatness(
  faces = [top],
  tolerance = 0.1mm,
  framePosition = [10mm, 0mm],
  framePlane = XZ,
  fontSize = __FONT_SIZE__
  __LEADER_SCALE__
)
"#;

    fn gdt_flatness_leader_kcl(font_size: &str, leader_scale: Option<&str>) -> String {
        GDT_FLATNESS_LEADER_KCL_TEMPLATE
            .replace("__FONT_SIZE__", font_size)
            .replace(
                "__LEADER_SCALE__",
                leader_scale
                    .map(|scale| format!(",\n  leaderScale = {scale}"))
                    .unwrap_or_default()
                    .as_str(),
            )
    }

    async fn gdt_flatness_feature_control(font_size: &str, leader_scale: Option<&str>) -> AnnotationFeatureControl {
        let code = gdt_flatness_leader_kcl(font_size, leader_scale);
        let commands = gdt_commands(&code).await;
        let annotation_index = new_annotation_command_index(&commands);
        feature_control(&commands[annotation_index]).clone()
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn gdt_dot_leader_scale_is_normalized_against_font_scale() {
        let tiny = gdt_flatness_feature_control("1mm", None).await;
        let large = gdt_flatness_feature_control("100mm", None).await;

        assert_close(f64::from(tiny.font_scale), gdt_font_scale_for_height_mm(1.0).into());
        assert_close(f64::from(large.font_scale), gdt_font_scale_for_height_mm(100.0).into());
        assert_close(f64::from(tiny.leader_scale), 50.0);
        assert_close(f64::from(large.leader_scale), 0.5);

        assert_close(
            f64::from(tiny.font_scale) * f64::from(tiny.leader_scale),
            f64::from(gdt_dot_leader_normal_size()),
        );
        assert_close(
            f64::from(large.font_scale) * f64::from(large.leader_scale),
            f64::from(gdt_dot_leader_normal_size()),
        );
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn explicit_gdt_dot_leader_scale_multiplies_normal_size() {
        let tiny = gdt_flatness_feature_control("1mm", Some("2")).await;
        let large = gdt_flatness_feature_control("100mm", Some("2")).await;

        let expected_scaled_dot_size = f64::from(gdt_dot_leader_normal_size()) * 2.0;
        assert_close(
            f64::from(tiny.font_scale) * f64::from(tiny.leader_scale),
            expected_scaled_dot_size,
        );
        assert_close(
            f64::from(large.font_scale) * f64::from(large.leader_scale),
            expected_scaled_dot_size,
        );
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn gdt_flatness_uses_scene_units_for_control_frame_tolerance() {
        let cases = [
            ("in", "0.1in", "[10, -10]", 0.1, 254.0, -254.0),
            ("cm", "10mm", "[1, -1]", 1.0, 10.0, -10.0),
        ];

        for (default_unit, tolerance, frame_position, expected_tolerance, expected_x, expected_y) in cases {
            let code = gdt_flatness_kcl(default_unit, tolerance, frame_position);
            let commands = gdt_commands(&code).await;
            let annotation_index = new_annotation_command_index(&commands);
            let feature_control = feature_control(&commands[annotation_index]);
            let control_frame = feature_control.control_frame.as_ref().unwrap();

            assert_close(control_frame.tolerance, expected_tolerance);
            assert_close(feature_control.offset.x, expected_x);
            assert_close(feature_control.offset.y, expected_y);
            assert_close(
                f64::from(feature_control.font_scale),
                gdt_font_scale_for_height_mm(50.8).into(),
            );
        }
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn gdt_distance_sets_scene_units_around_non_mm_annotation() {
        let cases = [
            (
                "in",
                "2.54mm",
                "[10, -10]",
                kcmc::units::UnitLength::Inches,
                0.1,
                254.0,
                -254.0,
            ),
            (
                "cm",
                "10mm",
                "[1, -1]",
                kcmc::units::UnitLength::Centimeters,
                1.0,
                10.0,
                -10.0,
            ),
        ];

        for (default_unit, tolerance, frame_position, scene_unit, expected_tolerance, expected_x, expected_y) in cases {
            let code = gdt_distance_kcl(default_unit, tolerance, frame_position);
            let commands = gdt_commands(&code).await;
            let annotation_index = new_annotation_command_index(&commands);
            let dimension = basic_dimension(&commands[annotation_index]);

            assert_eq!(set_scene_units(&commands[annotation_index - 1]), scene_unit);
            assert_eq!(
                set_scene_units(&commands[annotation_index + 1]),
                kcmc::units::UnitLength::Millimeters
            );

            assert_close(dimension.dimension.tolerance, expected_tolerance);
            assert_close(dimension.offset.x, expected_x);
            assert_close(dimension.offset.y, expected_y);
            assert_close(
                f64::from(dimension.font_scale),
                gdt_font_scale_for_height_mm(50.8).into(),
            );
        }
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn gdt_distance_keeps_mm_annotation_in_current_scene_units() {
        let code = gdt_distance_kcl("mm", "2.54mm", "[10, -10]");
        let commands = gdt_commands(&code).await;
        let annotation_index = new_annotation_command_index(&commands);
        let dimension = basic_dimension(&commands[annotation_index]);

        assert!(
            !commands
                .iter()
                .any(|command| matches!(command, ModelingCmd::SetSceneUnits(_)))
        );
        assert_close(dimension.dimension.tolerance, 2.54);
        assert_close(dimension.offset.x, 10.0);
        assert_close(dimension.offset.y, -10.0);
    }

    const GDT_DATUM_KCL: &str = r#"
blockProfile = sketch(on = XY) {
  edge1 = line(start = [var 0mm, var 0mm], end = [var 8mm, var 0mm])
  edge2 = line(start = [var 8mm, var 0mm], end = [var 8mm, var 5mm])
  edge3 = line(start = [var 8mm, var 5mm], end = [var 0mm, var 5mm])
  edge4 = line(start = [var 0mm, var 5mm], end = [var 0mm, var 0mm])
  coincident([edge1.end, edge2.start])
  coincident([edge2.end, edge3.start])
  coincident([edge3.end, edge4.start])
  coincident([edge4.end, edge1.start])
  horizontal(edge1)
  vertical(edge2)
  horizontal(edge3)
  vertical(edge4)
}

block = extrude(region(point = [4mm, 2mm], sketch = blockProfile), length = 4mm, tagEnd = $top)

gdt::datum(face = top, name = "A", framePosition = [10mm, 0mm], framePlane = XZ)
"#;

    async fn gdt_artifact_count(skip_artifact_graph: bool) -> usize {
        let settings = ExecutorSettings {
            skip_artifact_graph,
            ..Default::default()
        };
        let ctx = ExecutorContext::new_mock(Some(settings)).await;
        let program = crate::Program::parse_no_errs(GDT_DATUM_KCL).unwrap();
        let mock_config = MockConfig {
            use_prev_memory: false,
            ..Default::default()
        };
        let outcome = ctx.run_mock(&program, &mock_config).await.unwrap();
        ctx.close().await;

        outcome
            .artifact_graph
            .values()
            .filter(|artifact| matches!(artifact, Artifact::GdtAnnotation(_)))
            .count()
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn gdt_annotations_do_not_follow_runtime_artifact_graph_setting() {
        assert_eq!(gdt_artifact_count(false).await, 1);
        assert_eq!(gdt_artifact_count(true).await, 1);
    }
}
