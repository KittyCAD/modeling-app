use kcl_error::SourceRange;
use kcmc::ModelingCmd;
use kcmc::each_cmd as mcmd;
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

const DEFAULT_FONT_POINT_SIZE: u32 = 36;

fn font_point_size(font_size: Option<&TyF64>) -> u32 {
    font_size
        .map(|size| size.n.round() as u32)
        .unwrap_or(DEFAULT_FONT_POINT_SIZE)
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
    if args.ctx.settings.skip_artifact_graph {
        return;
    }

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
    let font_size: Option<TyF64> = args.get_kw_arg_opt("fontSize", &RuntimeType::count(), exec_state)?;

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
        .font_scale(1.0)
        .font_point_size(font_point_size(font_size.as_ref()))
        .leader_scale(leader_scale.as_ref().map(|n| n.n as f32).unwrap_or(1.0))
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
    let font_size: Option<TyF64> = args.get_kw_arg_opt("fontSize", &RuntimeType::count(), exec_state)?;

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
    let font_size: Option<TyF64> = args.get_kw_arg_opt("fontSize", &RuntimeType::count(), exec_state)?;

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
    let font_size: Option<TyF64> = args.get_kw_arg_opt("fontSize", &RuntimeType::count(), exec_state)?;

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
    let font_size: Option<TyF64> = args.get_kw_arg_opt("fontSize", &RuntimeType::count(), exec_state)?;

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
    let font_size: Option<TyF64> = args.get_kw_arg_opt("fontSize", &RuntimeType::count(), exec_state)?;

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
    let font_size: Option<TyF64> = args.get_kw_arg_opt("fontSize", &RuntimeType::count(), exec_state)?;

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
    let font_size: Option<TyF64> = args.get_kw_arg_opt("fontSize", &RuntimeType::count(), exec_state)?;

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
                    .tolerance(tolerance.to_mm())
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
            .font_scale(1.0)
            .font_point_size(font_point_size(font_size.as_ref()))
            .leader_scale(leader_scale.as_ref().map(|n| n.n as f32).unwrap_or(1.0))
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
    let dimension = AnnotationBasicDimension::builder()
        .from_entity_id(from.entity_id)
        .from_entity_pos(from.entity_pos)
        .to_entity_id(to.entity_id)
        .to_entity_pos(to.entity_pos)
        .dimension(
            AnnotationMbdBasicDimension::builder()
                .tolerance(tolerance.to_mm())
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
        .font_scale(1.0)
        .font_point_size(font_point_size(font_size))
        .arrow_scale(leader_scale.map(|n| n.n as f32).unwrap_or(1.0))
        .build();
    let options = AnnotationOptions::builder().dimension(dimension).build();
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
    let control_frame = gdt_control_frame(symbol, tolerance.to_mm(), datums);
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
        .font_scale(1.0)
        .font_point_size(font_point_size(font_size))
        .leader_scale(leader_scale.map(|n| n.n as f32).unwrap_or(1.0))
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
        .font_scale(1.0)
        .font_point_size(font_point_size(font_size))
        .leader_scale(leader_scale.map(|n| n.n as f32).unwrap_or(1.0))
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
    use crate::ExecutorContext;
    use crate::execution::Artifact;
    use crate::execution::ExecutorSettings;
    use crate::execution::MockConfig;

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
    async fn gdt_annotations_follow_runtime_artifact_graph_setting() {
        assert_eq!(gdt_artifact_count(false).await, 1);
        assert_eq!(gdt_artifact_count(true).await, 0);
    }
}
