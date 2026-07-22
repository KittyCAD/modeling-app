use kcl_error::SourceRange;
use kcmc::ModelingCmd;
use kcmc::each_cmd as mcmd;
use kittycad_modeling_cmds::shared::AnnotationBasicDimension;
use kittycad_modeling_cmds::shared::AnnotationFeatureControl;
use kittycad_modeling_cmds::shared::AnnotationFeatureTag;
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
use crate::parsing::ast::types::BoxNode;
use crate::std::Args;
use crate::std::args::FromKclValue;
use crate::std::args::TyF64;
use crate::std::edge;
use crate::std::fillet::EdgeReference;
use crate::std::sketch::ensure_sketch_plane_in_engine;
use crate::unit_conversion::ToKcmc;

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
    gdt_font_scale_for_height_mm(GDT_DOT_LEADER_REFERENCE_FONT_SIZE_MM) * GDT_DOT_LEADER_REFERENCE_ENGINE_SCALE as f32
}

fn gdt_dimension_leader_scale(leader_scale: Option<&TyF64>, args: &Args) -> Result<f32, KclError> {
    gdt_user_leader_scale(leader_scale, DEFAULT_GDT_DIMENSION_LEADER_SCALE, args)
}

#[derive(Debug, Clone)]
enum DistanceEntity {
    Face(Box<Face>),
    TaggedFace(Box<TagIdentifier>),
    Edge(EdgeReference),
    Specifier(kcmc::shared::EdgeSpecifier),
}

#[derive(Debug, Clone)]
enum GdtEdgeReference {
    Entity(EdgeReference),
    Specifier(kcmc::shared::EdgeSpecifier),
}

#[derive(Debug, Clone)]
struct DistanceEndpoint {
    entity_id: Option<uuid::Uuid>,
    edge_reference: Option<kcmc::shared::EdgeSpecifier>,
    entity_pos: KPoint2d<f64>,
}

#[derive(Debug, Clone, Copy)]
enum GdtFeatureControlKind {
    Flatness,
    Straightness,
    Circularity,
    Cylindricity,
    Concentricity,
    Symmetry,
    Runout,
    ProfileLine,
    ProfileSurface,
    Position,
    Angularity,
    Perpendicularity,
    Parallelism,
}

struct GdtFeatureControlParams {
    faces: Vec<TagIdentifier>,
    edges: Vec<GdtEdgeReference>,
    datums: Option<Vec<String>>,
    tolerance: TyF64,
    precision: Option<TyF64>,
    frame_position: Option<[TyF64; 2]>,
    frame_plane: Option<Plane>,
    leader_scale: Option<TyF64>,
    font_size: Option<TyF64>,
}

struct GdtProfileCommonParams {
    datums: Option<Vec<String>>,
    tolerance: TyF64,
    precision: Option<TyF64>,
    frame_position: Option<[TyF64; 2]>,
    frame_plane: Option<Plane>,
    leader_scale: Option<TyF64>,
    font_size: Option<TyF64>,
}

impl GdtFeatureControlKind {
    fn label(self) -> &'static str {
        match self {
            Self::Flatness => "Flatness",
            Self::Straightness => "Straightness",
            Self::Circularity => "Circularity",
            Self::Cylindricity => "Cylindricity",
            Self::Concentricity => "Concentricity",
            Self::Symmetry => "Symmetry",
            Self::Runout => "Runout",
            Self::ProfileLine => "Profile line",
            Self::ProfileSurface => "Profile surface",
            Self::Position => "Position",
            Self::Angularity => "Angularity",
            Self::Perpendicularity => "Perpendicularity",
            Self::Parallelism => "Parallelism",
        }
    }

    fn symbol(self) -> MbdSymbol {
        match self {
            Self::Flatness => MbdSymbol::Flatness,
            Self::Straightness => MbdSymbol::Straightness,
            Self::Circularity => MbdSymbol::Roundness,
            Self::Cylindricity => MbdSymbol::Cylindricity,
            Self::Concentricity => MbdSymbol::Concentricity,
            Self::Symmetry => MbdSymbol::Symmetry,
            Self::Runout => MbdSymbol::Runout,
            Self::ProfileLine => MbdSymbol::ProfileOfLine,
            Self::ProfileSurface => MbdSymbol::SurfaceProfile,
            Self::Position => MbdSymbol::Position,
            Self::Angularity => MbdSymbol::Angularity,
            Self::Perpendicularity => MbdSymbol::Perpendicularity,
            Self::Parallelism => MbdSymbol::Parallelism,
        }
    }

    fn diameter_symbol(self) -> Option<MbdSymbol> {
        match self {
            Self::Concentricity => Some(MbdSymbol::Diameter),
            _ => None,
        }
    }

    fn requires_datums(self) -> bool {
        matches!(self, Self::Concentricity | Self::Symmetry | Self::Runout)
    }
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
                entity_id: Some(face.id),
                edge_reference: None,
                entity_pos: KPoint2d { x: 0.5, y: 0.5 },
            }),
            DistanceEntity::TaggedFace(face) => Ok(DistanceEndpoint {
                entity_id: Some(args.get_adjacent_face_to_tag(exec_state, face, false).await?),
                edge_reference: None,
                entity_pos: KPoint2d { x: 0.5, y: 0.5 },
            }),
            DistanceEntity::Edge(edge) => Ok(DistanceEndpoint {
                entity_id: Some(edge.get_engine_id(exec_state, args)?),
                edge_reference: None,
                entity_pos: KPoint2d { x: 0.5, y: 0.0 },
            }),
            DistanceEntity::Specifier(edge_reference) => Ok(DistanceEndpoint {
                entity_id: None,
                edge_reference: Some(edge_reference.clone()),
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

async fn parse_distance_entity_arg(
    arg_name: &str,
    exec_state: &mut ExecState,
    args: &Args,
) -> Result<Option<DistanceEntity>, KclError> {
    let Some(value): Option<KclValue> = args.get_kw_arg_opt(arg_name, &RuntimeType::any(), exec_state)? else {
        return Ok(None);
    };

    if edge::is_edge_specifier_object(&value) {
        let unresolved = edge::parse_edge_specifier_value(&value, args)?;
        let edge_reference = edge::resolve_edge_specifier_with_face_tags(&unresolved, None, exec_state, args).await?;
        return Ok(Some(DistanceEntity::Specifier(edge_reference)));
    }

    DistanceEntity::from_kcl_val(&value)
        .map(Some)
        .ok_or_else(|| {
            KclError::new_type(KclErrorDetails::new(
                format!(
                    "`{arg_name}` must be a face, tagged face, tagged edge, edge UUID, or edge specifier object (e.g. {{ sideFaces = [...], endFaces = [...], index = 0 }})"
                ),
                vec![args.source_range],
            ))
        })
}

async fn parse_gdt_edges_arg(exec_state: &mut ExecState, args: &Args) -> Result<Vec<GdtEdgeReference>, KclError> {
    // Face API edge specifiers are object-shaped payloads, so keep the runtime type
    // broad here and validate each element below. This mirrors fillet/chamfer.
    let Some(edges): Option<Vec<KclValue>> = args.get_kw_arg_opt("edges", &RuntimeType::any_array(), exec_state)?
    else {
        return Ok(Vec::new());
    };

    if edges.is_empty() {
        return Err(KclError::new_semantic(KclErrorDetails::new(
            "`edges` must contain at least one edge.".to_owned(),
            vec![args.source_range],
        )));
    }

    let mut parsed_edges = Vec::with_capacity(edges.len());
    for edge_value in &edges {
        if edge::is_edge_specifier_object(edge_value) {
            let unresolved = edge::parse_edge_specifier_value(edge_value, args)?;
            let edge_reference =
                edge::resolve_edge_specifier_with_face_tags(&unresolved, None, exec_state, args).await?;
            parsed_edges.push(GdtEdgeReference::Specifier(edge_reference));
        } else if let Some(edge) = EdgeReference::from_kcl_val(edge_value) {
            parsed_edges.push(GdtEdgeReference::Entity(edge));
        } else {
            return Err(KclError::new_type(KclErrorDetails::new(
                "edges must contain tagged edges, edge UUIDs, or edge specifier objects (e.g. { sideFaces = [...], endFaces = [...], index = 0 })".to_owned(),
                vec![args.source_range],
            )));
        }
    }
    Ok(parsed_edges)
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
        .maybe_entity_id(Some(face_id))
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

pub async fn note(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let note: String = args.get_kw_arg("note", &RuntimeType::string(), exec_state)?;
    let frame_plane: Option<Plane> = args.get_kw_arg_opt("framePlane", &RuntimeType::plane(), exec_state)?;
    let frame_position: Option<[TyF64; 2]> =
        args.get_kw_arg_opt("framePosition", &RuntimeType::point2d(), exec_state)?;
    let font_size: Option<TyF64> = args.get_kw_arg_opt("fontSize", &RuntimeType::length(), exec_state)?;

    let annotation = inner_note(note, frame_plane, frame_position, font_size, exec_state, &args).await?;
    Ok(KclValue::GdtAnnotation {
        value: Box::new(annotation),
    })
}

async fn inner_note(
    note: String,
    frame_plane: Option<Plane>,
    frame_position: Option<[TyF64; 2]>,
    font_size: Option<TyF64>,
    exec_state: &mut ExecState,
    args: &Args,
) -> Result<GdtAnnotation, KclError> {
    let mut frame_plane = if let Some(plane) = frame_plane {
        plane
    } else {
        // No plane given. Default to the world XY plane.
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
    let meta = vec![Metadata::from(args.source_range)];
    let annotation_id = exec_state.next_uuid();
    // A note does not attach to a face. Passing the plane as the entity tells the engine to
    // place the note inline on that plane with no leader (an MBD free note).
    let feature_tag = AnnotationFeatureTag::builder()
        .maybe_entity_id(Some(frame_plane.id))
        .entity_pos(KPoint2d { x: 0.0, y: 0.0 })
        .leader_type(AnnotationLineEnd::None)
        .key(String::new())
        .value(note)
        .show_key(false)
        .plane_id(frame_plane.id)
        .offset(if let Some(offset) = &frame_position {
            KPoint2d {
                x: offset[0].to_mm(),
                y: offset[1].to_mm(),
            }
        } else {
            KPoint2d { x: 100.0, y: 100.0 }
        })
        .font_scale(gdt_font_scale(font_size.as_ref(), args)?)
        .font_point_size(GDT_FONT_TEXTURE_POINT_SIZE)
        .leader_scale(1.0)
        .build();
    exec_state
        .batch_modeling_cmd(
            ModelingCmdMeta::from_args_id(exec_state, args, annotation_id),
            ModelingCmd::from(
                mcmd::NewAnnotation::builder()
                    .options(AnnotationOptions::builder().feature_tag(feature_tag).build())
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

    let annotations = create_feature_control_annotations(
        GdtFeatureControlKind::Flatness,
        GdtFeatureControlParams {
            faces,
            edges: Vec::new(),
            datums: None,
            tolerance,
            precision,
            frame_position,
            frame_plane,
            leader_scale,
            font_size,
        },
        exec_state,
        &args,
    )
    .await?;
    Ok(annotations.into())
}

pub async fn straightness(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let faces: Option<Vec<TagIdentifier>> = args.get_kw_arg_opt(
        "faces",
        &RuntimeType::Array(Box::new(RuntimeType::tagged_face()), ArrayLen::Minimum(1)),
        exec_state,
    )?;
    let edges = parse_gdt_edges_arg(exec_state, &args).await?;
    let tolerance = args.get_kw_arg("tolerance", &RuntimeType::length(), exec_state)?;
    let precision = args.get_kw_arg_opt("precision", &RuntimeType::count(), exec_state)?;
    let frame_position: Option<[TyF64; 2]> =
        args.get_kw_arg_opt("framePosition", &RuntimeType::point2d(), exec_state)?;
    let frame_plane: Option<Plane> = args.get_kw_arg_opt("framePlane", &RuntimeType::plane(), exec_state)?;
    let leader_scale: Option<TyF64> = args.get_kw_arg_opt("leaderScale", &RuntimeType::count(), exec_state)?;
    let font_size: Option<TyF64> = args.get_kw_arg_opt("fontSize", &RuntimeType::length(), exec_state)?;

    let annotations = create_feature_control_annotations(
        GdtFeatureControlKind::Straightness,
        GdtFeatureControlParams {
            faces: faces.unwrap_or_default(),
            edges,
            datums: None,
            tolerance,
            precision,
            frame_position,
            frame_plane,
            leader_scale,
            font_size,
        },
        exec_state,
        &args,
    )
    .await?;
    Ok(annotations.into())
}

pub async fn circularity(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let faces: Option<Vec<TagIdentifier>> = args.get_kw_arg_opt(
        "faces",
        &RuntimeType::Array(Box::new(RuntimeType::tagged_face()), ArrayLen::Minimum(1)),
        exec_state,
    )?;
    let edges = parse_gdt_edges_arg(exec_state, &args).await?;
    let tolerance = args.get_kw_arg("tolerance", &RuntimeType::length(), exec_state)?;
    let precision = args.get_kw_arg_opt("precision", &RuntimeType::count(), exec_state)?;
    let frame_position: Option<[TyF64; 2]> =
        args.get_kw_arg_opt("framePosition", &RuntimeType::point2d(), exec_state)?;
    let frame_plane: Option<Plane> = args.get_kw_arg_opt("framePlane", &RuntimeType::plane(), exec_state)?;
    let leader_scale: Option<TyF64> = args.get_kw_arg_opt("leaderScale", &RuntimeType::count(), exec_state)?;
    let font_size: Option<TyF64> = args.get_kw_arg_opt("fontSize", &RuntimeType::length(), exec_state)?;

    let annotations = create_feature_control_annotations(
        GdtFeatureControlKind::Circularity,
        GdtFeatureControlParams {
            faces: faces.unwrap_or_default(),
            edges,
            datums: None,
            tolerance,
            precision,
            frame_position,
            frame_plane,
            leader_scale,
            font_size,
        },
        exec_state,
        &args,
    )
    .await?;
    Ok(annotations.into())
}

pub async fn cylindricity(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let faces: Option<Vec<TagIdentifier>> = args.get_kw_arg_opt(
        "faces",
        &RuntimeType::Array(Box::new(RuntimeType::tagged_face()), ArrayLen::Minimum(1)),
        exec_state,
    )?;
    let edges = parse_gdt_edges_arg(exec_state, &args).await?;
    let tolerance = args.get_kw_arg("tolerance", &RuntimeType::length(), exec_state)?;
    let precision = args.get_kw_arg_opt("precision", &RuntimeType::count(), exec_state)?;
    let frame_position: Option<[TyF64; 2]> =
        args.get_kw_arg_opt("framePosition", &RuntimeType::point2d(), exec_state)?;
    let frame_plane: Option<Plane> = args.get_kw_arg_opt("framePlane", &RuntimeType::plane(), exec_state)?;
    let leader_scale: Option<TyF64> = args.get_kw_arg_opt("leaderScale", &RuntimeType::count(), exec_state)?;
    let font_size: Option<TyF64> = args.get_kw_arg_opt("fontSize", &RuntimeType::length(), exec_state)?;

    let annotations = create_feature_control_annotations(
        GdtFeatureControlKind::Cylindricity,
        GdtFeatureControlParams {
            faces: faces.unwrap_or_default(),
            edges,
            datums: None,
            tolerance,
            precision,
            frame_position,
            frame_plane,
            leader_scale,
            font_size,
        },
        exec_state,
        &args,
    )
    .await?;
    Ok(annotations.into())
}

pub async fn concentricity(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let faces: Option<Vec<TagIdentifier>> = args.get_kw_arg_opt(
        "faces",
        &RuntimeType::Array(Box::new(RuntimeType::tagged_face()), ArrayLen::Minimum(1)),
        exec_state,
    )?;
    let edges = parse_gdt_edges_arg(exec_state, &args).await?;
    let datums: Vec<String> = args.get_kw_arg(
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

    let annotations = create_feature_control_annotations(
        GdtFeatureControlKind::Concentricity,
        GdtFeatureControlParams {
            faces: faces.unwrap_or_default(),
            edges,
            datums: Some(datums),
            tolerance,
            precision,
            frame_position,
            frame_plane,
            leader_scale,
            font_size,
        },
        exec_state,
        &args,
    )
    .await?;
    Ok(annotations.into())
}

pub async fn symmetry(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let faces: Option<Vec<TagIdentifier>> = args.get_kw_arg_opt(
        "faces",
        &RuntimeType::Array(Box::new(RuntimeType::tagged_face()), ArrayLen::Minimum(1)),
        exec_state,
    )?;
    let edges = parse_gdt_edges_arg(exec_state, &args).await?;
    let datums: Vec<String> = args.get_kw_arg(
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

    let annotations = create_feature_control_annotations(
        GdtFeatureControlKind::Symmetry,
        GdtFeatureControlParams {
            faces: faces.unwrap_or_default(),
            edges,
            datums: Some(datums),
            tolerance,
            precision,
            frame_position,
            frame_plane,
            leader_scale,
            font_size,
        },
        exec_state,
        &args,
    )
    .await?;
    Ok(annotations.into())
}

pub async fn runout(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let faces: Option<Vec<TagIdentifier>> = args.get_kw_arg_opt(
        "faces",
        &RuntimeType::Array(Box::new(RuntimeType::tagged_face()), ArrayLen::Minimum(1)),
        exec_state,
    )?;
    let edges = parse_gdt_edges_arg(exec_state, &args).await?;
    let datums: Vec<String> = args.get_kw_arg(
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

    let annotations = create_feature_control_annotations(
        GdtFeatureControlKind::Runout,
        GdtFeatureControlParams {
            faces: faces.unwrap_or_default(),
            edges,
            datums: Some(datums),
            tolerance,
            precision,
            frame_position,
            frame_plane,
            leader_scale,
            font_size,
        },
        exec_state,
        &args,
    )
    .await?;
    Ok(annotations.into())
}

pub async fn profile_line(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let edges = parse_gdt_edges_arg(exec_state, &args).await?;
    let params = profile_common_params(&args, exec_state)?;

    let annotations = inner_profile_line(edges, params, exec_state, &args).await?;
    Ok(annotations.into())
}

pub async fn profile_surface(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let faces: Vec<TagIdentifier> = args.get_kw_arg(
        "faces",
        &RuntimeType::Array(Box::new(RuntimeType::tagged_face()), ArrayLen::Minimum(1)),
        exec_state,
    )?;
    let params = profile_common_params(&args, exec_state)?;

    let annotations = inner_profile_surface(faces, params, exec_state, &args).await?;
    Ok(annotations.into())
}

/// Backwards-compatible implementation for the historical `gdt::profile` KCL function.
///
/// New KCL should call `gdt::profileLine` for edges or `gdt::profileSurface` for faces.
/// Keep the dispatch explicit so invalid combinations produce semantic KCL errors
/// instead of silently choosing one entity type.
pub async fn profile(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let faces: Option<Vec<TagIdentifier>> = args.get_kw_arg_opt(
        "faces",
        &RuntimeType::Array(Box::new(RuntimeType::tagged_face()), ArrayLen::Minimum(1)),
        exec_state,
    )?;
    let edges = parse_gdt_edges_arg(exec_state, &args).await?;

    let annotations = match (!edges.is_empty(), faces) {
        (true, None) => {
            let params = profile_common_params(&args, exec_state)?;
            inner_profile_line(edges, params, exec_state, &args).await?
        }
        (false, Some(faces)) => {
            let params = profile_common_params(&args, exec_state)?;
            inner_profile_surface(faces, params, exec_state, &args).await?
        }
        (true, Some(_)) => {
            return Err(KclError::new_semantic(KclErrorDetails::new(
                "Profile cannot combine `edges` and `faces`. Use `profileLine` for edges or `profileSurface` for faces."
                    .to_owned(),
                vec![args.source_range],
            )));
        }
        (false, None) => {
            return Err(KclError::new_semantic(KclErrorDetails::new(
                "Profile requires either `edges` for `profileLine` or `faces` for `profileSurface`.".to_owned(),
                vec![args.source_range],
            )));
        }
    };

    Ok(annotations.into())
}

fn profile_common_params(args: &Args, exec_state: &mut ExecState) -> Result<GdtProfileCommonParams, KclError> {
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

    Ok(GdtProfileCommonParams {
        datums,
        tolerance,
        precision,
        frame_position,
        frame_plane,
        leader_scale,
        font_size,
    })
}

async fn inner_profile_line(
    edges: Vec<GdtEdgeReference>,
    params: GdtProfileCommonParams,
    exec_state: &mut ExecState,
    args: &Args,
) -> Result<Vec<GdtAnnotation>, KclError> {
    create_feature_control_annotations(
        GdtFeatureControlKind::ProfileLine,
        GdtFeatureControlParams {
            faces: Vec::new(),
            edges,
            datums: params.datums,
            tolerance: params.tolerance,
            precision: params.precision,
            frame_position: params.frame_position,
            frame_plane: params.frame_plane,
            leader_scale: params.leader_scale,
            font_size: params.font_size,
        },
        exec_state,
        args,
    )
    .await
}

async fn inner_profile_surface(
    faces: Vec<TagIdentifier>,
    params: GdtProfileCommonParams,
    exec_state: &mut ExecState,
    args: &Args,
) -> Result<Vec<GdtAnnotation>, KclError> {
    create_feature_control_annotations(
        GdtFeatureControlKind::ProfileSurface,
        GdtFeatureControlParams {
            faces,
            edges: Vec::new(),
            datums: params.datums,
            tolerance: params.tolerance,
            precision: params.precision,
            frame_position: params.frame_position,
            frame_plane: params.frame_plane,
            leader_scale: params.leader_scale,
            font_size: params.font_size,
        },
        exec_state,
        args,
    )
    .await
}

pub async fn position(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let faces: Option<Vec<TagIdentifier>> = args.get_kw_arg_opt(
        "faces",
        &RuntimeType::Array(Box::new(RuntimeType::tagged_face()), ArrayLen::Minimum(1)),
        exec_state,
    )?;
    let edges = parse_gdt_edges_arg(exec_state, &args).await?;
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

    let annotations = create_feature_control_annotations(
        GdtFeatureControlKind::Position,
        GdtFeatureControlParams {
            faces: faces.unwrap_or_default(),
            edges,
            datums,
            tolerance,
            precision,
            frame_position,
            frame_plane,
            leader_scale,
            font_size,
        },
        exec_state,
        &args,
    )
    .await?;
    Ok(annotations.into())
}

pub async fn distance(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let from = parse_distance_entity_arg("from", exec_state, &args).await?;
    let to = parse_distance_entity_arg("to", exec_state, &args).await?;
    let edges = parse_gdt_edges_arg(exec_state, &args).await?;
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
        edges,
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

#[allow(clippy::too_many_arguments)]
async fn inner_distance(
    from: Option<DistanceEntity>,
    to: Option<DistanceEntity>,
    edges: Vec<GdtEdgeReference>,
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
        let (entity_id, edge_reference) = match edge {
            GdtEdgeReference::Entity(edge) => (Some(edge.get_engine_id(exec_state, args)?), None),
            GdtEdgeReference::Specifier(edge_reference) => (None, Some(edge_reference.clone())),
        };
        create_basic_distance_annotation(
            DistanceEndpoint {
                entity_id,
                edge_reference: edge_reference.clone(),
                entity_pos: KPoint2d { x: 0.0, y: 0.0 },
            },
            DistanceEndpoint {
                entity_id,
                edge_reference,
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
        .maybe_from_entity_id(from.entity_id)
        .maybe_from_edge_reference(from.edge_reference)
        .from_entity_pos(from.entity_pos)
        .maybe_to_entity_id(to.entity_id)
        .maybe_to_edge_reference(to.edge_reference)
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
    let options = AnnotationOptions::builder()
        .dimension(dimension)
        .units(display_units.to_kcmc())
        .build();
    let annotation_cmd = ModelingCmd::from(
        mcmd::NewAnnotation::builder()
            .options(options)
            .clobber(false)
            .annotation_type(AnnotationType::T3D)
            .build(),
    );
    let cmd_meta = ModelingCmdMeta::from_args_id(exec_state, args, annotation_id);
    exec_state.batch_modeling_cmd(cmd_meta, annotation_cmd).await?;
    add_gdt_annotation_artifact(exec_state, args, annotation_id);
    annotations.push(GdtAnnotation {
        id: annotation_id,
        meta,
    });
    Ok(())
}

pub async fn angularity(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let faces: Option<Vec<TagIdentifier>> = args.get_kw_arg_opt(
        "faces",
        &RuntimeType::Array(Box::new(RuntimeType::tagged_face()), ArrayLen::Minimum(1)),
        exec_state,
    )?;
    let edges = parse_gdt_edges_arg(exec_state, &args).await?;
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

    let annotations = create_feature_control_annotations(
        GdtFeatureControlKind::Angularity,
        GdtFeatureControlParams {
            faces: faces.unwrap_or_default(),
            edges,
            datums,
            tolerance,
            precision,
            frame_position,
            frame_plane,
            leader_scale,
            font_size,
        },
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
    let edges = parse_gdt_edges_arg(exec_state, &args).await?;
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

    let annotations = create_feature_control_annotations(
        GdtFeatureControlKind::Perpendicularity,
        GdtFeatureControlParams {
            faces: faces.unwrap_or_default(),
            edges,
            datums,
            tolerance,
            precision,
            frame_position,
            frame_plane,
            leader_scale,
            font_size,
        },
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
    let edges = parse_gdt_edges_arg(exec_state, &args).await?;
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

    let annotations = create_feature_control_annotations(
        GdtFeatureControlKind::Parallelism,
        GdtFeatureControlParams {
            faces: faces.unwrap_or_default(),
            edges,
            datums,
            tolerance,
            precision,
            frame_position,
            frame_plane,
            leader_scale,
            font_size,
        },
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
    let edges = parse_gdt_edges_arg(exec_state, &args).await?;
    let frame_position: Option<[TyF64; 2]> =
        args.get_kw_arg_opt("framePosition", &RuntimeType::point2d(), exec_state)?;
    let frame_plane: Option<Plane> = args.get_kw_arg_opt("framePlane", &RuntimeType::plane(), exec_state)?;
    let leader_scale: Option<TyF64> = args.get_kw_arg_opt("leaderScale", &RuntimeType::count(), exec_state)?;
    let font_size: Option<TyF64> = args.get_kw_arg_opt("fontSize", &RuntimeType::length(), exec_state)?;

    let annotations = inner_annotation(
        annotation,
        faces.unwrap_or_default(),
        edges,
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
async fn inner_annotation(
    annotation: String,
    faces: Vec<TagIdentifier>,
    edges: Vec<GdtEdgeReference>,
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
            Some(face_id),
            None,
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
        match edge {
            GdtEdgeReference::Entity(edge) => {
                create_annotation(
                    Some(edge.get_engine_id(exec_state, args)?),
                    None,
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
            GdtEdgeReference::Specifier(edge_reference) => {
                create_annotation(
                    None,
                    Some(edge_reference.clone()),
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
        }
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

async fn resolve_gdt_frame_plane(
    frame_plane: Option<Plane>,
    exec_state: &mut ExecState,
    args: &Args,
) -> Result<Plane, KclError> {
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
    Ok(frame_plane)
}

async fn create_feature_control_annotations(
    kind: GdtFeatureControlKind,
    params: GdtFeatureControlParams,
    exec_state: &mut ExecState,
    args: &Args,
) -> Result<Vec<GdtAnnotation>, KclError> {
    let GdtFeatureControlParams {
        faces,
        edges,
        datums,
        tolerance,
        precision,
        frame_position,
        frame_plane,
        leader_scale,
        font_size,
    } = params;

    if faces.is_empty() && edges.is_empty() {
        return Err(KclError::new_semantic(KclErrorDetails::new(
            format!("{} requires at least one face or edge.", kind.label()),
            vec![args.source_range],
        )));
    }

    let precision = resolve_precision(precision, args)?;
    let datums = resolve_datums(datums, args, kind.label())?;
    if kind.requires_datums() && datums.is_empty() {
        return Err(KclError::new_semantic(KclErrorDetails::new(
            format!("{} requires at least one datum.", kind.label()),
            vec![args.source_range],
        )));
    }
    let frame_plane = resolve_gdt_frame_plane(frame_plane, exec_state, args).await?;
    let symbol = kind.symbol();
    let diameter_symbol = kind.diameter_symbol();

    let mut annotations = Vec::with_capacity(faces.len() + edges.len());
    for face in &faces {
        let face_id = args.get_adjacent_face_to_tag(exec_state, face, false).await?;
        create_feature_control_annotation(
            Some(face_id),
            None,
            symbol,
            diameter_symbol,
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
        match edge {
            GdtEdgeReference::Entity(edge) => {
                create_feature_control_annotation(
                    Some(edge.get_engine_id(exec_state, args)?),
                    None,
                    symbol,
                    diameter_symbol,
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
            GdtEdgeReference::Specifier(edge_reference) => {
                create_feature_control_annotation(
                    None,
                    Some(edge_reference.clone()),
                    symbol,
                    diameter_symbol,
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
        }
    }

    Ok(annotations)
}

#[allow(clippy::too_many_arguments)]
async fn create_feature_control_annotation(
    entity_id: Option<uuid::Uuid>,
    edge_reference: Option<kcmc::shared::EdgeSpecifier>,
    symbol: MbdSymbol,
    diameter_symbol: Option<MbdSymbol>,
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
    let control_frame = gdt_control_frame(
        symbol,
        diameter_symbol,
        tolerance.to_length_units(display_units),
        datums,
    );
    let feature_control = AnnotationFeatureControl::builder()
        .maybe_entity_id(entity_id)
        .maybe_edge_reference(edge_reference)
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

fn gdt_control_frame(
    symbol: MbdSymbol,
    diameter_symbol: Option<MbdSymbol>,
    tolerance: f64,
    datums: &[char],
) -> AnnotationMbdControlFrame {
    match datums {
        [] => AnnotationMbdControlFrame::builder()
            .symbol(symbol)
            .maybe_diameter_symbol(diameter_symbol)
            .tolerance(tolerance)
            .build(),
        [primary] => AnnotationMbdControlFrame::builder()
            .symbol(symbol)
            .maybe_diameter_symbol(diameter_symbol)
            .tolerance(tolerance)
            .primary_datum(*primary)
            .build(),
        [primary, secondary] => AnnotationMbdControlFrame::builder()
            .symbol(symbol)
            .maybe_diameter_symbol(diameter_symbol)
            .tolerance(tolerance)
            .primary_datum(*primary)
            .secondary_datum(*secondary)
            .build(),
        [primary, secondary, tertiary] => AnnotationMbdControlFrame::builder()
            .symbol(symbol)
            .maybe_diameter_symbol(diameter_symbol)
            .tolerance(tolerance)
            .primary_datum(*primary)
            .secondary_datum(*secondary)
            .tertiary_datum(*tertiary)
            .build(),
        _ => unreachable!("resolve_datums rejects more than three datums"),
    }
}

#[allow(clippy::too_many_arguments)]
async fn create_annotation(
    entity_id: Option<uuid::Uuid>,
    edge_reference: Option<kcmc::shared::EdgeSpecifier>,
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
        .maybe_entity_id(entity_id)
        .maybe_edge_reference(edge_reference)
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
        ast::Expr::Name(BoxNode::new(ast::Node::new(
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

    fn annotation_options(command: &ModelingCmd) -> Result<&AnnotationOptions, KclError> {
        let ModelingCmd::NewAnnotation(new_annotation) = command else {
            return Err(KclError::new_internal(KclErrorDetails::new(
                format!("expected new_annotation command, got {command:?}"),
                vec![SourceRange::default()],
            )));
        };
        Ok(&new_annotation.options)
    }

    fn feature_control(command: &ModelingCmd) -> Result<&AnnotationFeatureControl, KclError> {
        let ModelingCmd::NewAnnotation(new_annotation) = command else {
            return Err(KclError::new_internal(KclErrorDetails::new(
                format!("expected new_annotation command, got {command:?}"),
                vec![SourceRange::default()],
            )));
        };
        new_annotation.options.feature_control.as_ref().ok_or_else(|| {
            KclError::new_internal(KclErrorDetails::new(
                "expected new_annotation command to have a feature_control".to_owned(),
                vec![SourceRange::default()],
            ))
        })
    }

    fn find_control_frame_with_symbol(
        commands: &[ModelingCmd],
        symbol: MbdSymbol,
    ) -> Result<&AnnotationMbdControlFrame, KclError> {
        for command in commands {
            if let Ok(feature_control) = feature_control(command)
                && let Some(control_frame) = feature_control.control_frame.as_ref()
                && control_frame.symbol == symbol
            {
                return Ok(control_frame);
            }
        }

        Err(KclError::new_internal(KclErrorDetails::new(
            format!("expected commands to contain a {symbol:?} control frame"),
            vec![SourceRange::default()],
        )))
    }

    #[track_caller]
    fn assert_close(actual: f64, expected: f64) {
        assert!((actual - expected).abs() < 1e-6, "expected {expected}, got {actual}");
    }

    fn new_annotation_command_index(commands: &[ModelingCmd]) -> Result<usize, KclError> {
        commands
            .iter()
            .position(|command| matches!(command, ModelingCmd::NewAnnotation(_)))
            .ok_or_else(|| {
                KclError::new_internal(KclErrorDetails::new(
                    "expected commands to contain a new_annotation command".to_owned(),
                    vec![SourceRange::default()],
                ))
            })
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

    async fn gdt_flatness_feature_control(
        font_size: &str,
        leader_scale: Option<&str>,
    ) -> Result<AnnotationFeatureControl, KclError> {
        let code = gdt_flatness_leader_kcl(font_size, leader_scale);
        let commands = gdt_commands(&code).await;
        let annotation_index = new_annotation_command_index(&commands)?;
        Ok(feature_control(&commands[annotation_index])?.clone())
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn gdt_dot_leader_scale_is_normalized_against_font_scale() -> Result<(), KclError> {
        let tiny = gdt_flatness_feature_control("1mm", None).await?;
        let large = gdt_flatness_feature_control("100mm", None).await?;

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
        Ok(())
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn explicit_gdt_dot_leader_scale_multiplies_normal_size() -> Result<(), KclError> {
        let tiny = gdt_flatness_feature_control("1mm", Some("2")).await?;
        let large = gdt_flatness_feature_control("100mm", Some("2")).await?;

        let expected_scaled_dot_size = f64::from(gdt_dot_leader_normal_size()) * 2.0;
        assert_close(
            f64::from(tiny.font_scale) * f64::from(tiny.leader_scale),
            expected_scaled_dot_size,
        );
        assert_close(
            f64::from(large.font_scale) * f64::from(large.leader_scale),
            expected_scaled_dot_size,
        );
        Ok(())
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn gdt_flatness_uses_scene_units_for_control_frame_tolerance() -> Result<(), KclError> {
        let cases = [
            ("in", "0.1in", "[10, -10]", 0.1, 254.0, -254.0),
            ("cm", "10mm", "[1, -1]", 1.0, 10.0, -10.0),
        ];

        for (default_unit, tolerance, frame_position, expected_tolerance, expected_x, expected_y) in cases {
            let code = gdt_flatness_kcl(default_unit, tolerance, frame_position);
            let commands = gdt_commands(&code).await;
            let annotation_index = new_annotation_command_index(&commands)?;
            let feature_control = feature_control(&commands[annotation_index])?;
            let control_frame = feature_control.control_frame.as_ref().ok_or_else(|| {
                KclError::new_internal(KclErrorDetails::new(
                    "expected feature_control to have a control_frame".to_owned(),
                    vec![SourceRange::default()],
                ))
            })?;

            assert_close(control_frame.tolerance, expected_tolerance);
            assert_close(feature_control.offset.x, expected_x);
            assert_close(feature_control.offset.y, expected_y);
            assert_close(
                f64::from(feature_control.font_scale),
                gdt_font_scale_for_height_mm(50.8).into(),
            );
        }
        Ok(())
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn gdt_distance_sets_units() -> Result<(), KclError> {
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
            (
                "mm",
                "2.54mm",
                "[10, -10]",
                kcmc::units::UnitLength::Millimeters,
                2.54,
                10.0,
                -10.0,
            ),
        ];

        for (default_unit, tolerance, frame_position, scene_unit, expected_tolerance, expected_x, expected_y) in cases {
            let code = gdt_distance_kcl(default_unit, tolerance, frame_position);
            let commands = gdt_commands(&code).await;
            let annotation_index = new_annotation_command_index(&commands)?;
            let options = annotation_options(&commands[annotation_index])?;

            assert_eq!(options.units, Some(scene_unit));

            let dimension = options
                .dimension
                .as_ref()
                .expect("expected new_annotation command to have a dimension");
            assert_close(dimension.dimension.tolerance, expected_tolerance);
            assert_close(dimension.offset.x, expected_x);
            assert_close(dimension.offset.y, expected_y);
            assert_close(
                f64::from(dimension.font_scale),
                gdt_font_scale_for_height_mm(50.8).into(),
            );
        }
        Ok(())
    }

    const GDT_FACE_API_EDGE_KCL_TEMPLATE: &str = r#"
@settings(defaultLengthUnit = mm, kclVersion = 2)

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
extrude001 = extrude(region001, length = 10mm, tagStart = $capStart001)
__GDT_CALL__
"#;

    fn gdt_face_api_edge_kcl(gdt_call: &str) -> String {
        GDT_FACE_API_EDGE_KCL_TEMPLATE.replace("__GDT_CALL__", gdt_call)
    }

    fn assert_feature_control_uses_edge_reference(feature_control: &AnnotationFeatureControl) {
        assert!(feature_control.entity_id.is_none());
        let edge_reference = feature_control
            .edge_reference
            .as_ref()
            .expect("expected face API edge specifier to emit edge_reference");
        assert_eq!(edge_reference.side_faces.len(), 2);
        assert!(edge_reference.end_faces.is_empty());
        assert_eq!(edge_reference.index, None);
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn gdt_straightness_accepts_face_api_edge_specifier() -> Result<(), KclError> {
        let code = gdt_face_api_edge_kcl(
            r#"gdt::straightness(
  edges = [
    {
      sideFaces = [region001.tags.line1, capStart001]
    }
  ],
  tolerance = 0.1mm,
  framePosition = [12mm, 8mm],
  framePlane = XZ,
)"#,
        );
        let commands = gdt_commands(&code).await;
        let annotation_index = new_annotation_command_index(&commands)?;
        let feature_control = feature_control(&commands[annotation_index])?;
        assert_feature_control_uses_edge_reference(feature_control);
        assert!(feature_control.control_frame.is_some());
        Ok(())
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn gdt_annotation_accepts_face_api_edge_specifier() -> Result<(), KclError> {
        let code = gdt_face_api_edge_kcl(
            r#"gdt::annotation(
  annotation = "A",
  edges = [
    {
      sideFaces = [region001.tags.line1, capStart001]
    }
  ],
  framePosition = [12mm, 8mm],
  framePlane = XZ,
)"#,
        );
        let commands = gdt_commands(&code).await;
        let annotation_index = new_annotation_command_index(&commands)?;
        let feature_control = feature_control(&commands[annotation_index])?;
        assert_feature_control_uses_edge_reference(feature_control);
        assert_eq!(feature_control.prefix.as_deref(), Some("A"));
        Ok(())
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn gdt_distance_accepts_face_api_edge_specifier() -> Result<(), KclError> {
        let code = gdt_face_api_edge_kcl(
            r#"gdt::distance(
  edges = [
    {
      sideFaces = [region001.tags.line1, capStart001]
    }
  ],
  tolerance = 0.1mm,
  framePosition = [12mm, 8mm],
  framePlane = XZ,
)"#,
        );
        let commands = gdt_commands(&code).await;
        let annotation_index = new_annotation_command_index(&commands)?;
        let options = annotation_options(&commands[annotation_index])?;
        let dimension = options
            .dimension
            .as_ref()
            .expect("expected new_annotation command to have a dimension");
        assert!(dimension.from_entity_id.is_none());
        assert!(dimension.to_entity_id.is_none());
        assert_eq!(
            dimension
                .from_edge_reference
                .as_ref()
                .expect("expected from_edge_reference")
                .side_faces
                .len(),
            2
        );
        assert_eq!(
            dimension
                .to_edge_reference
                .as_ref()
                .expect("expected to_edge_reference")
                .side_faces
                .len(),
            2
        );
        Ok(())
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn gdt_distance_from_to_accept_face_api_edge_specifiers() -> Result<(), KclError> {
        let code = gdt_face_api_edge_kcl(
            r#"gdt::distance(
  from = {
    sideFaces = [region001.tags.line1, capStart001]
  },
  to = {
    sideFaces = [region001.tags.line3, capStart001]
  },
  tolerance = 0.1mm,
  framePosition = [12mm, 8mm],
  framePlane = XZ,
)"#,
        );
        let commands = gdt_commands(&code).await;
        let annotation_index = new_annotation_command_index(&commands)?;
        let options = annotation_options(&commands[annotation_index])?;
        let dimension = options
            .dimension
            .as_ref()
            .expect("expected new_annotation command to have a dimension");
        assert!(dimension.from_entity_id.is_none());
        assert!(dimension.to_entity_id.is_none());
        assert_eq!(
            dimension
                .from_edge_reference
                .as_ref()
                .expect("expected from_edge_reference")
                .side_faces
                .len(),
            2
        );
        assert_eq!(
            dimension
                .to_edge_reference
                .as_ref()
                .expect("expected to_edge_reference")
                .side_faces
                .len(),
            2
        );
        Ok(())
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

    const GDT_ANGULARITY_FACE_KCL: &str = r#"
@settings(defaultLengthUnit = mm, kclVersion = 2)

basicAngle = 30deg
thickness = 3.5mm
flangeLength = 24mm
bendStartX = 5mm
legLength = 30mm
legRun = legLength * cos(basicAngle)
legRise = legLength * sin(basicAngle)
normalRun = thickness * sin(basicAngle)
normalRise = thickness * cos(basicAngle)
annotationFont = 2mm

stampedProfile = sketch(on = XY) {
  datumFace = line(start = [var 0mm, var 0mm], end = [var 24mm, var 0mm])
  flangeEnd = line(start = [var 24mm, var 0mm], end = [var 24mm, var 3.5mm])
  innerFlange = line(start = [var 24mm, var 3.5mm], end = [var 5mm, var 3.5mm])
  controlledSurface = line(start = [var 5mm, var 3.5mm], end = [var 30.98mm, var 18.5mm])
  tabEnd = line(start = [var 30.98mm, var 18.5mm], end = [var 29.23mm, var 21.53mm])
  outerSurface = line(start = [var 29.23mm, var 21.53mm], end = [var 3.25mm, var 6.53mm])
  outsideBend = line(start = [var 3.25mm, var 6.53mm], end = [var 0mm, var 0mm])
  coincident([datumFace.end, flangeEnd.start])
  coincident([flangeEnd.end, innerFlange.start])
  coincident([innerFlange.end, controlledSurface.start])
  coincident([controlledSurface.end, tabEnd.start])
  coincident([tabEnd.end, outerSurface.start])
  coincident([outerSurface.end, outsideBend.start])
  coincident([outsideBend.end, datumFace.start])
  coincident([datumFace.start, ORIGIN])
  horizontal(datumFace)
  horizontal(innerFlange)
  vertical(flangeEnd)
  distance([datumFace.start, datumFace.end]) == flangeLength
  distance([flangeEnd.start, flangeEnd.end]) == thickness
  distance([innerFlange.start, innerFlange.end]) == flangeLength - bendStartX
  distance([controlledSurface.start, controlledSurface.end]) == legLength
  distance([tabEnd.start, tabEnd.end]) == thickness
  distance([outerSurface.start, outerSurface.end]) == legLength
  parallel([controlledSurface, outerSurface])
  perpendicular([controlledSurface, tabEnd])
  angle([datumFace, controlledSurface]) == basicAngle
}

stampedPart = extrude(region(point = [12mm, 2mm], sketch = stampedProfile), length = 0.8mm)

gdt::datum(face = stampedPart.sketch.tags.datumFace, name = "A", framePosition = [6mm, -4mm], framePlane = XY, fontSize = annotationFont)
gdt::angularity(faces = [stampedPart.sketch.tags.controlledSurface], tolerance = 0.1mm, datums = ["A"], framePosition = [-12mm, 11mm], framePlane = XZ, fontSize = annotationFont)
"#;

    const GDT_ANGULARITY_EDGE_KCL: &str = r#"
@settings(defaultLengthUnit = mm, kclVersion = 2)

basicAngle = 30deg
thickness = 3.5mm
flangeLength = 24mm
bendStartX = 5mm
legLength = 30mm
legRun = legLength * cos(basicAngle)
legRise = legLength * sin(basicAngle)
normalRun = thickness * sin(basicAngle)
normalRise = thickness * cos(basicAngle)
annotationFont = 2mm

stampedProfile = sketch(on = XY) {
  datumFace = line(start = [var 0mm, var 0mm], end = [var 24mm, var 0mm])
  flangeEnd = line(start = [var 24mm, var 0mm], end = [var 24mm, var 3.5mm])
  innerFlange = line(start = [var 24mm, var 3.5mm], end = [var 5mm, var 3.5mm])
  controlledSurface = line(start = [var 5mm, var 3.5mm], end = [var 30.98mm, var 18.5mm])
  tabEnd = line(start = [var 30.98mm, var 18.5mm], end = [var 29.23mm, var 21.53mm])
  outerSurface = line(start = [var 29.23mm, var 21.53mm], end = [var 3.25mm, var 6.53mm])
  outsideBend = line(start = [var 3.25mm, var 6.53mm], end = [var 0mm, var 0mm])
  coincident([datumFace.end, flangeEnd.start])
  coincident([flangeEnd.end, innerFlange.start])
  coincident([innerFlange.end, controlledSurface.start])
  coincident([controlledSurface.end, tabEnd.start])
  coincident([tabEnd.end, outerSurface.start])
  coincident([outerSurface.end, outsideBend.start])
  coincident([outsideBend.end, datumFace.start])
  coincident([datumFace.start, ORIGIN])
  horizontal(datumFace)
  horizontal(innerFlange)
  vertical(flangeEnd)
  distance([datumFace.start, datumFace.end]) == flangeLength
  distance([flangeEnd.start, flangeEnd.end]) == thickness
  distance([innerFlange.start, innerFlange.end]) == flangeLength - bendStartX
  distance([controlledSurface.start, controlledSurface.end]) == legLength
  distance([tabEnd.start, tabEnd.end]) == thickness
  distance([outerSurface.start, outerSurface.end]) == legLength
  parallel([controlledSurface, outerSurface])
  perpendicular([controlledSurface, tabEnd])
  angle([datumFace, controlledSurface]) == basicAngle
}

stampedRegion = region(point = [12mm, 2mm], sketch = stampedProfile)
hide(stampedProfile)
stampedPart = extrude(stampedRegion, length = 0.8mm)

gdt::datum(face = stampedPart.sketch.tags.datumFace, name = "A", framePosition = [6mm, -4mm], framePlane = XY, fontSize = annotationFont)
gdt::angularity(edges = [stampedRegion.tags.controlledSurface], tolerance = 0.1mm, datums = ["A"], framePosition = [-12mm, 11mm], framePlane = XZ, fontSize = annotationFont)
"#;

    #[tokio::test(flavor = "multi_thread")]
    async fn gdt_angularity_uses_angularity_symbol_with_datums() -> Result<(), KclError> {
        let cases = [
            ("angled face", GDT_ANGULARITY_FACE_KCL, 0.1),
            ("angled edge", GDT_ANGULARITY_EDGE_KCL, 0.1),
        ];

        for (label, code, expected_tolerance) in cases {
            let commands = gdt_commands(code).await;
            let control_frame = find_control_frame_with_symbol(&commands, MbdSymbol::Angularity)?;

            assert_close(control_frame.tolerance, expected_tolerance);
            assert_eq!(control_frame.primary_datum, Some('A'), "case: {label}");
            assert!(control_frame.secondary_datum.is_none(), "case: {label}");
            assert!(control_frame.tertiary_datum.is_none(), "case: {label}");
        }
        Ok(())
    }

    const GDT_PROFILE_LINE_KCL: &str = r#"
@settings(defaultLengthUnit = mm, kclVersion = 2)

blockProfile = sketch(on = XY) {
  edge1 = line(start = [var 0mm, var 0mm], end = [var 10mm, var 0mm])
  edge2 = line(start = [var 10mm, var 0mm], end = [var 10mm, var 6mm])
  edge3 = line(start = [var 10mm, var 6mm], end = [var 0mm, var 6mm])
  edge4 = line(start = [var 0mm, var 6mm], end = [var 0mm, var 0mm])
  coincident([edge1.end, edge2.start])
  coincident([edge2.end, edge3.start])
  coincident([edge3.end, edge4.start])
  coincident([edge4.end, edge1.start])
  horizontal(edge1)
  vertical(edge2)
  horizontal(edge3)
  vertical(edge4)
}

block = extrude(region(point = [5mm, 3mm], sketch = blockProfile), length = 4mm, tagEnd = $top)
profileEdge = getCommonEdge(faces = [block.sketch.tags.edge1, top])
gdt::profileLine(edges = [profileEdge], tolerance = 0.05mm, framePosition = [12mm, 8mm], framePlane = XZ)
"#;

    const GDT_PROFILE_GENERIC_LINE_KCL: &str = r#"
@settings(defaultLengthUnit = mm, kclVersion = 2)

blockProfile = sketch(on = XY) {
  edge1 = line(start = [var 0mm, var 0mm], end = [var 10mm, var 0mm])
  edge2 = line(start = [var 10mm, var 0mm], end = [var 10mm, var 6mm])
  edge3 = line(start = [var 10mm, var 6mm], end = [var 0mm, var 6mm])
  edge4 = line(start = [var 0mm, var 6mm], end = [var 0mm, var 0mm])
  coincident([edge1.end, edge2.start])
  coincident([edge2.end, edge3.start])
  coincident([edge3.end, edge4.start])
  coincident([edge4.end, edge1.start])
  horizontal(edge1)
  vertical(edge2)
  horizontal(edge3)
  vertical(edge4)
}

block = extrude(region(point = [5mm, 3mm], sketch = blockProfile), length = 4mm, tagEnd = $top)
profileEdge = getCommonEdge(faces = [block.sketch.tags.edge1, top])
gdt::profile(edges = [profileEdge], tolerance = 0.05mm, framePosition = [12mm, 8mm], framePlane = XZ)
"#;

    const GDT_PROFILE_SURFACE_KCL: &str = r#"
@settings(defaultLengthUnit = mm, kclVersion = 2)

cylinderSketch = sketch(on = XY) {
  perimeter = circle(start = [var 5mm, var 0mm], center = [var 0mm, var 0mm])
}

cylinder = extrude(region(point = cylinderSketch.perimeter.center, sketch = cylinderSketch), length = 10mm, tagEnd = $top)
gdt::profileSurface(faces = [top], tolerance = 0.05mm, framePosition = [12mm, 8mm], framePlane = XZ)
"#;

    const GDT_PROFILE_GENERIC_SURFACE_KCL: &str = r#"
@settings(defaultLengthUnit = mm, kclVersion = 2)

cylinderSketch = sketch(on = XY) {
  perimeter = circle(start = [var 5mm, var 0mm], center = [var 0mm, var 0mm])
}

cylinder = extrude(region(point = cylinderSketch.perimeter.center, sketch = cylinderSketch), length = 10mm, tagEnd = $top)
gdt::profile(faces = [top], tolerance = 0.05mm, framePosition = [12mm, 8mm], framePlane = XZ)
"#;

    const GDT_PROFILE_BOTH_KCL: &str = r#"
@settings(defaultLengthUnit = mm, kclVersion = 2)

blockProfile = sketch(on = XY) {
  edge1 = line(start = [var 0mm, var 0mm], end = [var 10mm, var 0mm])
  edge2 = line(start = [var 10mm, var 0mm], end = [var 10mm, var 6mm])
  edge3 = line(start = [var 10mm, var 6mm], end = [var 0mm, var 6mm])
  edge4 = line(start = [var 0mm, var 6mm], end = [var 0mm, var 0mm])
  coincident([edge1.end, edge2.start])
  coincident([edge2.end, edge3.start])
  coincident([edge3.end, edge4.start])
  coincident([edge4.end, edge1.start])
  horizontal(edge1)
  vertical(edge2)
  horizontal(edge3)
  vertical(edge4)
}

block = extrude(region(point = [5mm, 3mm], sketch = blockProfile), length = 4mm, tagEnd = $top)
profileEdge = getCommonEdge(faces = [block.sketch.tags.edge1, top])
gdt::profile(edges = [profileEdge], faces = [top], tolerance = 0.05mm)
"#;

    const GDT_PROFILE_MISSING_ENTITIES_KCL: &str = r#"
@settings(defaultLengthUnit = mm, kclVersion = 2)

gdt::profile(tolerance = 0.05mm)
"#;

    #[tokio::test(flavor = "multi_thread")]
    async fn gdt_profile_line_uses_profile_of_line_symbol() -> Result<(), KclError> {
        let cases = [
            ("specific profileLine", GDT_PROFILE_LINE_KCL),
            ("generic profile with edges", GDT_PROFILE_GENERIC_LINE_KCL),
        ];

        for (label, code) in cases {
            let commands = gdt_commands(code).await;
            let control_frame = find_control_frame_with_symbol(&commands, MbdSymbol::ProfileOfLine)?;

            assert_close(control_frame.tolerance, 0.05);
            assert!(control_frame.primary_datum.is_none(), "case: {label}");
            assert!(control_frame.secondary_datum.is_none(), "case: {label}");
            assert!(control_frame.tertiary_datum.is_none(), "case: {label}");
        }
        Ok(())
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn gdt_profile_surface_uses_surface_profile_symbol() -> Result<(), KclError> {
        let cases = [
            ("specific profileSurface", GDT_PROFILE_SURFACE_KCL),
            ("generic profile with faces", GDT_PROFILE_GENERIC_SURFACE_KCL),
        ];

        for (label, code) in cases {
            let commands = gdt_commands(code).await;
            let control_frame = find_control_frame_with_symbol(&commands, MbdSymbol::SurfaceProfile)?;

            assert_close(control_frame.tolerance, 0.05);
            assert!(control_frame.primary_datum.is_none(), "case: {label}");
            assert!(control_frame.secondary_datum.is_none(), "case: {label}");
            assert!(control_frame.tertiary_datum.is_none(), "case: {label}");
        }
        Ok(())
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn gdt_profile_requires_edges_or_faces() {
        assert_eq!(
            parse_execute(GDT_PROFILE_MISSING_ENTITIES_KCL)
                .await
                .unwrap_err()
                .message(),
            "Profile requires either `edges` for `profileLine` or `faces` for `profileSurface`.",
        );
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn gdt_profile_rejects_combined_edges_and_faces() {
        assert_eq!(
            parse_execute(GDT_PROFILE_BOTH_KCL).await.unwrap_err().message(),
            "Profile cannot combine `edges` and `faces`. Use `profileLine` for edges or `profileSurface` for faces.",
        );
    }

    // Mirrors the gdt::circularity doc examples: annotate a cylinder's circular
    // edge and its curved wall. Runs in mock mode, so it validates parsing, name
    // resolution, and that the control frame uses the Roundness (circularity)
    // symbol without datums. The doc examples additionally render against the
    // engine in kcl_test_examples.
    const GDT_CIRCULARITY_EDGE_KCL: &str = r#"
@settings(defaultLengthUnit = mm, kclVersion = 2)

cylinderSketch = sketch(on = XY) {
  perimeter = circle(start = [var 5mm, var 0mm], center = [var 0mm, var 0mm])
}

cylinderRegion = region(point = cylinderSketch.perimeter.center, sketch = cylinderSketch)
hide(cylinderSketch)
cylinder = extrude(cylinderRegion, length = 10mm)
gdt::circularity(edges = [cylinderRegion.tags.perimeter], tolerance = 0.05mm)
"#;

    const GDT_CIRCULARITY_WALL_KCL: &str = r#"
@settings(defaultLengthUnit = mm, kclVersion = 2)

cylinderSketch = sketch(on = XY) {
  perimeter = circle(start = [var 5mm, var 0mm], center = [var 0mm, var 0mm])
}

cylinder = extrude(region(point = cylinderSketch.perimeter.center, sketch = cylinderSketch), length = 10mm)
gdt::circularity(faces = [cylinder.sketch.tags.perimeter], tolerance = 0.02mm, framePosition = [12mm, 8mm], framePlane = XZ)
"#;

    const GDT_CIRCULARITY_COMMON_EDGE_KCL: &str = r#"
@settings(defaultLengthUnit = mm, kclVersion = 2)

cylinderSketch = sketch(on = XY) {
  perimeter = circle(start = [var 5mm, var 0mm], center = [var 0mm, var 0mm])
}

cylinder = extrude(region(point = cylinderSketch.perimeter.center, sketch = cylinderSketch), length = 10mm, tagEnd = $top)
topEdge = getCommonEdge(faces = [cylinder.sketch.tags.perimeter, top])
gdt::circularity(edges = [topEdge], tolerance = 0.05mm, framePosition = [12mm, 8mm], framePlane = XZ)
"#;

    #[tokio::test(flavor = "multi_thread")]
    async fn gdt_circularity_uses_roundness_symbol_without_datums() -> Result<(), KclError> {
        let cases = [
            ("circular edge", GDT_CIRCULARITY_EDGE_KCL, 0.05),
            ("cylinder wall", GDT_CIRCULARITY_WALL_KCL, 0.02),
            ("common edge", GDT_CIRCULARITY_COMMON_EDGE_KCL, 0.05),
        ];

        for (label, code, expected_tolerance) in cases {
            let commands = gdt_commands(code).await;
            let annotation_index = new_annotation_command_index(&commands)?;
            let feature_control = feature_control(&commands[annotation_index])?;
            let control_frame = feature_control.control_frame.as_ref().ok_or_else(|| {
                KclError::new_internal(KclErrorDetails::new(
                    format!("expected {label} feature_control to have a control_frame"),
                    vec![SourceRange::default()],
                ))
            })?;

            assert_eq!(control_frame.symbol, MbdSymbol::Roundness, "case: {label}");
            assert_close(control_frame.tolerance, expected_tolerance);
            // Circularity is a form tolerance and never references datums.
            assert!(control_frame.primary_datum.is_none(), "case: {label}");
            assert!(control_frame.secondary_datum.is_none(), "case: {label}");
            assert!(control_frame.tertiary_datum.is_none(), "case: {label}");
        }
        Ok(())
    }

    // Mirrors the gdt::cylindricity doc examples: annotate a cylinder's curved
    // wall and its circular edge. Runs in mock mode, so it validates parsing,
    // name resolution, and that the control frame uses the Cylindricity symbol
    // without datums. The doc examples additionally render against the engine in
    // kcl_test_examples.
    const GDT_CYLINDRICITY_WALL_KCL: &str = r#"
@settings(defaultLengthUnit = mm, kclVersion = 2)

cylinderSketch = sketch(on = XY) {
  perimeter = circle(start = [var 5mm, var 0mm], center = [var 0mm, var 0mm])
}

cylinder = extrude(region(point = cylinderSketch.perimeter.center, sketch = cylinderSketch), length = 10mm)
gdt::cylindricity(faces = [cylinder.sketch.tags.perimeter], tolerance = 0.02mm, framePosition = [-12mm, 8mm], framePlane = XZ)
"#;

    const GDT_CYLINDRICITY_EDGE_KCL: &str = r#"
@settings(defaultLengthUnit = mm, kclVersion = 2)

cylinderSketch = sketch(on = XY) {
  perimeter = circle(start = [var 5mm, var 0mm], center = [var 0mm, var 0mm])
}

cylinderRegion = region(point = cylinderSketch.perimeter.center, sketch = cylinderSketch)
hide(cylinderSketch)
cylinder = extrude(cylinderRegion, length = 10mm)
gdt::cylindricity(edges = [cylinderRegion.tags.perimeter], tolerance = 0.05mm, framePosition = [-12mm, 8mm])
"#;

    const GDT_CYLINDRICITY_COMMON_EDGE_KCL: &str = r#"
@settings(defaultLengthUnit = mm, kclVersion = 2)

cylinderSketch = sketch(on = XY) {
  perimeter = circle(start = [var 5mm, var 0mm], center = [var 0mm, var 0mm])
}

cylinder = extrude(region(point = cylinderSketch.perimeter.center, sketch = cylinderSketch), length = 10mm, tagEnd = $top)
topEdge = getCommonEdge(faces = [cylinder.sketch.tags.perimeter, top])
gdt::cylindricity(edges = [topEdge], tolerance = 0.05mm, framePosition = [-12mm, 8mm], framePlane = XZ)
"#;

    #[tokio::test(flavor = "multi_thread")]
    async fn gdt_cylindricity_uses_cylindricity_symbol_without_datums() -> Result<(), KclError> {
        let cases = [
            ("cylinder wall", GDT_CYLINDRICITY_WALL_KCL, 0.02),
            ("circular edge", GDT_CYLINDRICITY_EDGE_KCL, 0.05),
            ("common edge", GDT_CYLINDRICITY_COMMON_EDGE_KCL, 0.05),
        ];

        for (label, code, expected_tolerance) in cases {
            let commands = gdt_commands(code).await;
            let annotation_index = new_annotation_command_index(&commands)?;
            let feature_control = feature_control(&commands[annotation_index])?;
            let control_frame = feature_control.control_frame.as_ref().ok_or_else(|| {
                KclError::new_internal(KclErrorDetails::new(
                    format!("expected {label} feature_control to have a control_frame"),
                    vec![SourceRange::default()],
                ))
            })?;

            assert_eq!(control_frame.symbol, MbdSymbol::Cylindricity, "case: {label}");
            assert_close(control_frame.tolerance, expected_tolerance);
            // Cylindricity is a form tolerance and never references datums.
            assert!(control_frame.primary_datum.is_none(), "case: {label}");
            assert!(control_frame.secondary_datum.is_none(), "case: {label}");
            assert!(control_frame.tertiary_datum.is_none(), "case: {label}");
        }
        Ok(())
    }

    // Uses the GD&T Basics stepped-shaft example: reference feature B is
    // controlled relative to datum feature A. Runs in mock mode, so it validates
    // parsing, name resolution, and that the control frame uses the
    // Concentricity symbol with a diameter tolerance zone and datum reference.
    const GDT_CONCENTRICITY_REFERENCE_FEATURE_B_FACE_KCL: &str = r#"
@settings(defaultLengthUnit = mm, kclVersion = 2)

datumASketch = sketch(on = XY) {
  perimeter = circle(start = [var 5mm, var 0mm], center = [var 0mm, var 0mm])
}

datumA = extrude(region(point = datumASketch.perimeter.center, sketch = datumASketch), length = 16mm)

referenceFeatureBSketch = sketch(on = XY) {
  perimeter = circle(start = [var 2.5mm, var 0mm], center = [var 0mm, var 0mm])
}

referenceFeatureB = extrude(region(point = referenceFeatureBSketch.perimeter.center, sketch = referenceFeatureBSketch), length = 12mm)
  |> translate(z = -12mm)

gdt::datum(face = datumA.sketch.tags.perimeter, name = "A", framePosition = [10mm, -12mm], framePlane = XZ)
gdt::concentricity(faces = [referenceFeatureB.sketch.tags.perimeter], tolerance = 0.2mm, datums = ["A"], framePosition = [-18mm, 12mm], framePlane = XZ)
"#;

    const GDT_CONCENTRICITY_REFERENCE_FEATURE_B_EDGE_KCL: &str = r#"
@settings(defaultLengthUnit = mm, kclVersion = 2)

datumASketch = sketch(on = XY) {
  perimeter = circle(start = [var 5mm, var 0mm], center = [var 0mm, var 0mm])
}

datumA = extrude(region(point = datumASketch.perimeter.center, sketch = datumASketch), length = 16mm)

referenceFeatureBSketch = sketch(on = XY) {
  perimeter = circle(start = [var 2.5mm, var 0mm], center = [var 0mm, var 0mm])
}

referenceFeatureB = extrude(region(point = referenceFeatureBSketch.perimeter.center, sketch = referenceFeatureBSketch), length = 12mm, tagEnd = $endB)
  |> translate(z = -12mm)
endEdgeB = getCommonEdge(faces = [referenceFeatureB.sketch.tags.perimeter, endB])

gdt::datum(face = datumA.sketch.tags.perimeter, name = "A", framePosition = [10mm, -12mm], framePlane = XZ)
gdt::concentricity(edges = [endEdgeB], tolerance = 0.2mm, datums = ["A"], framePosition = [-18mm, 12mm], framePlane = XZ)
"#;

    #[tokio::test(flavor = "multi_thread")]
    async fn gdt_concentricity_uses_concentricity_symbol_with_diameter_zone_and_datums() -> Result<(), KclError> {
        let cases = [
            (
                "reference feature B face",
                GDT_CONCENTRICITY_REFERENCE_FEATURE_B_FACE_KCL,
                0.2,
            ),
            (
                "reference feature B edge",
                GDT_CONCENTRICITY_REFERENCE_FEATURE_B_EDGE_KCL,
                0.2,
            ),
        ];

        for (label, code, expected_tolerance) in cases {
            let commands = gdt_commands(code).await;
            let control_frame = find_control_frame_with_symbol(&commands, MbdSymbol::Concentricity)?;

            assert_eq!(
                control_frame.diameter_symbol,
                Some(MbdSymbol::Diameter),
                "case: {label}"
            );
            assert_close(control_frame.tolerance, expected_tolerance);
            assert_eq!(control_frame.primary_datum, Some('A'), "case: {label}");
            assert!(control_frame.secondary_datum.is_none(), "case: {label}");
            assert!(control_frame.tertiary_datum.is_none(), "case: {label}");
        }
        Ok(())
    }

    // Models the GD&T Basics latch-block groove example as closely as the
    // current datum API allows. Each test annotates one groove floor target
    // so KCL emits one symmetry feature control frame.
    const GDT_SYMMETRY_LATCH_BLOCK_GROOVE_FACE_KCL: &str = r#"
@settings(defaultLengthUnit = mm, kclVersion = 2)

latchProfile = sketch(on = XZ) {
  bottom = line(start = [var -20mm, var -10mm], end = [var 20mm, var -10mm])
  datumWidthFace = line(start = [var 20mm, var -10mm], end = [var 20mm, var 10mm])
  topRight = line(start = [var 20mm, var 10mm], end = [var 5mm, var 10mm])
  rightGrooveWall = line(start = [var 5mm, var 10mm], end = [var 5mm, var 3mm])
  grooveFloor = line(start = [var 5mm, var 3mm], end = [var -5mm, var 3mm])
  leftGrooveWall = line(start = [var -5mm, var 3mm], end = [var -5mm, var 10mm])
  topLeft = line(start = [var -5mm, var 10mm], end = [var -20mm, var 10mm])
  leftSide = line(start = [var -20mm, var 10mm], end = [var -20mm, var -10mm])
  coincident([bottom.end, datumWidthFace.start])
  coincident([datumWidthFace.end, topRight.start])
  coincident([topRight.end, rightGrooveWall.start])
  coincident([rightGrooveWall.end, grooveFloor.start])
  coincident([grooveFloor.end, leftGrooveWall.start])
  coincident([leftGrooveWall.end, topLeft.start])
  coincident([topLeft.end, leftSide.start])
  coincident([leftSide.end, bottom.start])
  horizontal(bottom)
  vertical(datumWidthFace)
  horizontal(topRight)
  vertical(rightGrooveWall)
  horizontal(grooveFloor)
  vertical(leftGrooveWall)
  horizontal(topLeft)
  vertical(leftSide)
}

latchBlockRegion = region(point = [0mm, 0mm], sketch = latchProfile)
latchBlock = extrude(latchBlockRegion, length = 12mm)

gdt::datum(face = latchBlock.sketch.tags.bottom, name = "A", framePosition = [0mm, -16mm], framePlane = XZ)
gdt::symmetry(faces = [latchBlock.sketch.tags.grooveFloor], tolerance = 0.2mm, datums = ["A"], framePosition = [-24mm, 14mm], framePlane = XZ)
"#;

    const GDT_SYMMETRY_LATCH_BLOCK_GROOVE_EDGE_KCL: &str = r#"
@settings(defaultLengthUnit = mm, kclVersion = 2)

latchProfile = sketch(on = XZ) {
  bottom = line(start = [var -20mm, var -10mm], end = [var 20mm, var -10mm])
  datumWidthFace = line(start = [var 20mm, var -10mm], end = [var 20mm, var 10mm])
  topRight = line(start = [var 20mm, var 10mm], end = [var 5mm, var 10mm])
  rightGrooveWall = line(start = [var 5mm, var 10mm], end = [var 5mm, var 3mm])
  grooveFloor = line(start = [var 5mm, var 3mm], end = [var -5mm, var 3mm])
  leftGrooveWall = line(start = [var -5mm, var 3mm], end = [var -5mm, var 10mm])
  topLeft = line(start = [var -5mm, var 10mm], end = [var -20mm, var 10mm])
  leftSide = line(start = [var -20mm, var 10mm], end = [var -20mm, var -10mm])
  coincident([bottom.end, datumWidthFace.start])
  coincident([datumWidthFace.end, topRight.start])
  coincident([topRight.end, rightGrooveWall.start])
  coincident([rightGrooveWall.end, grooveFloor.start])
  coincident([grooveFloor.end, leftGrooveWall.start])
  coincident([leftGrooveWall.end, topLeft.start])
  coincident([topLeft.end, leftSide.start])
  coincident([leftSide.end, bottom.start])
  horizontal(bottom)
  vertical(datumWidthFace)
  horizontal(topRight)
  vertical(rightGrooveWall)
  horizontal(grooveFloor)
  vertical(leftGrooveWall)
  horizontal(topLeft)
  vertical(leftSide)
}

latchBlockRegion = region(point = [0mm, 0mm], sketch = latchProfile)
latchBlock = extrude(latchBlockRegion, length = 12mm, tagEnd = $frontFace)
grooveFloorFrontEdge = getCommonEdge(faces = [latchBlock.sketch.tags.grooveFloor, frontFace])

gdt::datum(face = latchBlock.sketch.tags.bottom, name = "A", framePosition = [0mm, -16mm], framePlane = XZ)
gdt::symmetry(edges = [grooveFloorFrontEdge], tolerance = 0.2mm, datums = ["A"], framePosition = [-24mm, 14mm], framePlane = XZ)
"#;

    #[tokio::test(flavor = "multi_thread")]
    async fn gdt_symmetry_uses_symmetry_symbol_with_datums_for_face() -> Result<(), KclError> {
        let commands = gdt_commands(GDT_SYMMETRY_LATCH_BLOCK_GROOVE_FACE_KCL).await;
        let control_frames: Vec<_> = commands
            .iter()
            .filter_map(|command| {
                feature_control(command)
                    .ok()
                    .and_then(|feature_control| feature_control.control_frame.as_ref())
                    .filter(|control_frame| control_frame.symbol == MbdSymbol::Symmetry)
            })
            .collect();

        assert_eq!(control_frames.len(), 1);
        let control_frame = control_frames[0];
        assert_eq!(control_frame.diameter_symbol, None);
        assert_close(control_frame.tolerance, 0.2);
        assert_eq!(control_frame.primary_datum, Some('A'));
        assert!(control_frame.secondary_datum.is_none());
        assert!(control_frame.tertiary_datum.is_none());
        Ok(())
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn gdt_symmetry_uses_symmetry_symbol_with_datums_for_edge() -> Result<(), KclError> {
        let commands = gdt_commands(GDT_SYMMETRY_LATCH_BLOCK_GROOVE_EDGE_KCL).await;
        let control_frames: Vec<_> = commands
            .iter()
            .filter_map(|command| {
                feature_control(command)
                    .ok()
                    .and_then(|feature_control| feature_control.control_frame.as_ref())
                    .filter(|control_frame| control_frame.symbol == MbdSymbol::Symmetry)
            })
            .collect();

        assert_eq!(control_frames.len(), 1);
        let control_frame = control_frames[0];
        assert_eq!(control_frame.diameter_symbol, None);
        assert_close(control_frame.tolerance, 0.2);
        assert_eq!(control_frame.primary_datum, Some('A'));
        assert!(control_frame.secondary_datum.is_none());
        assert!(control_frame.tertiary_datum.is_none());
        Ok(())
    }

    // Covers the gdt::runout doc example plus a face-based variant. Runs in mock mode, so it validates
    // parsing, name resolution, and that the control frame uses the Runout
    // symbol with a datum reference and no diameter symbol.
    const GDT_RUNOUT_STEPPED_SHAFT_KCL: &str = r#"
@settings(defaultLengthUnit = mm, kclVersion = 2)

annotationPlane = offsetPlane(XZ, offset = 24mm)

controlledSketch = sketch(on = YZ) {
  upperPerimeter = arc(start = [var 10mm, var 0mm], end = [var -10mm, var 0mm], center = [var 0mm, var 0mm])
  lowerPerimeter = arc(start = [var -10mm, var 0mm], end = [var 10mm, var 0mm], center = [var 0mm, var 0mm])
  coincident([upperPerimeter.end, lowerPerimeter.start])
  coincident([lowerPerimeter.end, upperPerimeter.start])
}

controlledShaft = extrude(
  region(point = [0mm, 1mm], sketch = controlledSketch),
  length = -58mm,
  tagStart = $controlledShoulder,
  tagEnd = $controlledFreeEnd
)

controlledUpperShoulderEdge = getCommonEdge(faces = [
  controlledShaft.sketch.tags.upperPerimeter,
  controlledShoulder
])

datumSketch = sketch(on = YZ) {
  perimeter = circle(start = [var 18mm, var 0mm], center = [var 0mm, var 0mm])
}

datumShaft = extrude(
  region(point = datumSketch.perimeter.center, sketch = datumSketch),
  length = 36mm,
  tagEnd = $datumEnd
)

gdt::datum(
  face = datumShaft.sketch.tags.perimeter,
  name = "A",
  framePosition = [18mm, -28mm],
  framePlane = annotationPlane,
  leaderScale = 1.15,
  fontSize = 6mm
)

gdt::runout(
  edges = [controlledUpperShoulderEdge],
  tolerance = 0.2mm,
  datums = ["A"],
  precision = 1,
  framePosition = [12mm, 48mm],
  framePlane = annotationPlane,
  leaderScale = 1.15,
  fontSize = 6mm
)
"#;

    const GDT_RUNOUT_FACE_KCL: &str = r#"
@settings(defaultLengthUnit = mm, kclVersion = 2)

datumSketch = sketch(on = XY) {
  perimeter = circle(start = [var 6mm, var 0mm], center = [var 0mm, var 0mm])
}

datumShaft = extrude(region(point = datumSketch.perimeter.center, sketch = datumSketch), length = 18mm)

controlledSketch = sketch(on = XY) {
  perimeter = circle(start = [var 3mm, var 0mm], center = [var 0mm, var 0mm])
}

controlledShaft = extrude(region(point = controlledSketch.perimeter.center, sketch = controlledSketch), length = 16mm)
  |> translate(z = -16mm)

gdt::datum(face = datumShaft.sketch.tags.perimeter, name = "A", framePosition = [12mm, -14mm], framePlane = XZ)
gdt::runout(faces = [controlledShaft.sketch.tags.perimeter], tolerance = 0.2mm, datums = ["A"], framePosition = [-18mm, 12mm], framePlane = XZ)
"#;

    #[tokio::test(flavor = "multi_thread")]
    async fn gdt_runout_uses_runout_symbol_with_axis_datum() -> Result<(), KclError> {
        let cases = [
            ("stepped shaft", GDT_RUNOUT_STEPPED_SHAFT_KCL, 0.2),
            ("controlled face", GDT_RUNOUT_FACE_KCL, 0.2),
        ];

        for (label, code, expected_tolerance) in cases {
            let commands = gdt_commands(code).await;
            let control_frame = find_control_frame_with_symbol(&commands, MbdSymbol::Runout)?;

            assert!(control_frame.diameter_symbol.is_none(), "case: {label}");
            assert_close(control_frame.tolerance, expected_tolerance);
            assert_eq!(control_frame.primary_datum, Some('A'), "case: {label}");
            assert!(control_frame.secondary_datum.is_none(), "case: {label}");
            assert!(control_frame.tertiary_datum.is_none(), "case: {label}");
        }
        Ok(())
    }
}
