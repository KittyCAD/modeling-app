//! Edge helper functions.

use anyhow::Result;
use kcmc::ModelingCmd;
use kcmc::each_cmd as mcmd;
use kcmc::ok_response::OkModelingCmdResponse;
use kcmc::websocket::OkWebSocketResponseData;
use kittycad_modeling_cmds as kcmc;
use serde::Deserialize;
use serde::Serialize;
use uuid::Uuid;

use crate::SourceRange;
use crate::errors::KclError;
use crate::errors::KclErrorDetails;
use crate::execution::BoundedEdge;
use crate::execution::ExecState;
use crate::execution::ExtrudeSurface;
use crate::execution::KclObjectFields;
use crate::execution::KclValue;
use crate::execution::ModelingCmdMeta;
use crate::execution::Solid;
use crate::execution::TagIdentifier;
use crate::execution::types::ArrayLen;
use crate::execution::types::RuntimeType;
use crate::std::Args;
use crate::std::args::TyF64;
use crate::std::fillet::EdgeReference;
use crate::std::sketch::FaceTag;

/// Tag or UUID for use in an unresolved edge specifier (resolved to face UUIDs in blend).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash, ts_rs::TS)]
#[serde(untagged)]
pub enum TagOrUuid {
    Uuid(Uuid),
    Tag(Box<TagIdentifier>),
}

/// Edge specifier payload (sideFaces, endFaces, index) as passed from KCL. Stored in BoundedEdge and resolved to `kcmc::shared::EdgeSpecifier` in blend().
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct UnresolvedEdgeSpecifier {
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub side_faces: Vec<TagOrUuid>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub end_faces: Vec<TagOrUuid>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub index: Option<u32>,
}

/// Fetch the face ID(s) for an edge via Solid3dGetAllEdgeFaces.
/// Returns 1 face for boundary edges (e.g. on surfaces) or 2 for interior edges.
/// Used for refactor metadata (artifact-graph), fillet/chamfer, and blend edge specifier resolution.
pub(crate) async fn get_face_ids_for_edge(
    exec_state: &mut ExecState,
    object_id: Uuid,
    edge_id: Uuid,
    args: &Args,
) -> Result<Vec<Uuid>, KclError> {
    if args.ctx.no_engine_commands().await {
        // Return two so that anything that is expecting an edge on a solid
        // works.
        return Ok(vec![exec_state.next_uuid(), exec_state.next_uuid()]);
    }

    let resp = exec_state
        .send_modeling_cmd(
            ModelingCmdMeta::from_args(exec_state, args),
            ModelingCmd::from(
                mcmd::Solid3dGetAllEdgeFaces::builder()
                    .object_id(object_id)
                    .edge_id(edge_id)
                    .build(),
            ),
        )
        .await?;
    let OkWebSocketResponseData::Modeling {
        modeling_response: OkModelingCmdResponse::Solid3dGetAllEdgeFaces(info),
    } = &resp
    else {
        return Err(KclError::new_engine(KclErrorDetails::new(
            format!("Solid3dGetAllEdgeFaces response was not as expected: {resp:?}"),
            vec![args.source_range],
        )));
    };
    if info.faces.is_empty() || info.faces.len() > 2 {
        return Err(KclError::new_engine(KclErrorDetails::new(
            format!(
                "Solid3dGetAllEdgeFaces returned {} face(s) for edge {edge_id}, expected 1 or 2",
                info.faces.len()
            ),
            vec![args.source_range],
        )));
    }
    Ok(info.faces.clone())
}

/// Check that a tag does not map to multiple edges (ambiguous region mapping).
pub(super) fn check_tag_not_ambiguous(tag: &TagIdentifier, args: &Args) -> Result<(), KclError> {
    let all_infos = tag.get_all_cur_info();
    if all_infos.len() > 1 {
        return Err(KclError::new_semantic(KclErrorDetails::new(
            format!(
                "Tag `{}` is ambiguous: it maps to {} edges in the region. Use a more specific reference.",
                tag.value,
                all_infos.len()
            ),
            vec![args.source_range],
        )));
    }
    Ok(())
}

/// Get the opposite edge to the edge given.
pub async fn get_opposite_edge(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let input_edge = args.get_unlabeled_kw_arg("edge", &RuntimeType::tagged_edge(), exec_state)?;

    let edge = inner_get_opposite_edge(input_edge, exec_state, args.clone()).await?;
    Ok(KclValue::Uuid {
        value: edge,
        meta: vec![args.source_range.into()],
    })
}

async fn inner_get_opposite_edge(
    edge: TagIdentifier,
    exec_state: &mut ExecState,
    args: Args,
) -> Result<Uuid, KclError> {
    check_tag_not_ambiguous(&edge, &args)?;
    if args.ctx.no_engine_commands().await {
        return Ok(exec_state.next_uuid());
    }
    let face_id = args.get_adjacent_face_to_tag(exec_state, &edge, false).await?;

    let tagged_path = args.get_tag_engine_info(exec_state, &edge)?;
    let tagged_path_id = tagged_path.id;
    let sketch_id = tagged_path.geometry.id();

    let resp = exec_state
        .send_modeling_cmd(
            ModelingCmdMeta::from_args(exec_state, &args),
            ModelingCmd::from(
                mcmd::Solid3dGetOppositeEdge::builder()
                    .edge_id(tagged_path_id)
                    .object_id(sketch_id)
                    .face_id(face_id)
                    .build(),
            ),
        )
        .await?;
    let OkWebSocketResponseData::Modeling {
        modeling_response: OkModelingCmdResponse::Solid3dGetOppositeEdge(opposite_edge),
    } = &resp
    else {
        return Err(KclError::new_engine(KclErrorDetails::new(
            format!("mcmd::Solid3dGetOppositeEdge response was not as expected: {resp:?}"),
            vec![args.source_range],
        )));
    };

    Ok(opposite_edge.edge)
}

/// Get the next adjacent edge to the edge given.
pub async fn get_next_adjacent_edge(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let input_edge = args.get_unlabeled_kw_arg("edge", &RuntimeType::tagged_edge(), exec_state)?;

    let edge = inner_get_next_adjacent_edge(input_edge, exec_state, args.clone()).await?;
    Ok(KclValue::Uuid {
        value: edge,
        meta: vec![args.source_range.into()],
    })
}

async fn inner_get_next_adjacent_edge(
    edge: TagIdentifier,
    exec_state: &mut ExecState,
    args: Args,
) -> Result<Uuid, KclError> {
    check_tag_not_ambiguous(&edge, &args)?;
    if args.ctx.no_engine_commands().await {
        return Ok(exec_state.next_uuid());
    }
    let face_id = args.get_adjacent_face_to_tag(exec_state, &edge, false).await?;

    let tagged_path = args.get_tag_engine_info(exec_state, &edge)?;
    let tagged_path_id = tagged_path.id;
    let sketch_id = tagged_path.geometry.id();

    let resp = exec_state
        .send_modeling_cmd(
            ModelingCmdMeta::from_args(exec_state, &args),
            ModelingCmd::from(
                mcmd::Solid3dGetNextAdjacentEdge::builder()
                    .edge_id(tagged_path_id)
                    .object_id(sketch_id)
                    .face_id(face_id)
                    .build(),
            ),
        )
        .await?;

    let OkWebSocketResponseData::Modeling {
        modeling_response: OkModelingCmdResponse::Solid3dGetNextAdjacentEdge(adjacent_edge),
    } = &resp
    else {
        return Err(KclError::new_engine(KclErrorDetails::new(
            format!("mcmd::Solid3dGetNextAdjacentEdge response was not as expected: {resp:?}"),
            vec![args.source_range],
        )));
    };

    adjacent_edge.edge.ok_or_else(|| {
        KclError::new_type(KclErrorDetails::new(
            format!("No edge found next adjacent to tag: `{}`", edge.value),
            vec![args.source_range],
        ))
    })
}

/// Get the previous adjacent edge to the edge given.
pub async fn get_previous_adjacent_edge(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let input_edge = args.get_unlabeled_kw_arg("edge", &RuntimeType::tagged_edge(), exec_state)?;

    let edge = inner_get_previous_adjacent_edge(input_edge, exec_state, args.clone()).await?;
    Ok(KclValue::Uuid {
        value: edge,
        meta: vec![args.source_range.into()],
    })
}

async fn inner_get_previous_adjacent_edge(
    edge: TagIdentifier,
    exec_state: &mut ExecState,
    args: Args,
) -> Result<Uuid, KclError> {
    check_tag_not_ambiguous(&edge, &args)?;
    if args.ctx.no_engine_commands().await {
        return Ok(exec_state.next_uuid());
    }
    let face_id = args.get_adjacent_face_to_tag(exec_state, &edge, false).await?;

    let tagged_path = args.get_tag_engine_info(exec_state, &edge)?;
    let tagged_path_id = tagged_path.id;
    let sketch_id = tagged_path.geometry.id();

    let resp = exec_state
        .send_modeling_cmd(
            ModelingCmdMeta::from_args(exec_state, &args),
            ModelingCmd::from(
                mcmd::Solid3dGetPrevAdjacentEdge::builder()
                    .edge_id(tagged_path_id)
                    .object_id(sketch_id)
                    .face_id(face_id)
                    .build(),
            ),
        )
        .await?;
    let OkWebSocketResponseData::Modeling {
        modeling_response: OkModelingCmdResponse::Solid3dGetPrevAdjacentEdge(adjacent_edge),
    } = &resp
    else {
        return Err(KclError::new_engine(KclErrorDetails::new(
            format!("mcmd::Solid3dGetPrevAdjacentEdge response was not as expected: {resp:?}"),
            vec![args.source_range],
        )));
    };

    adjacent_edge.edge.ok_or_else(|| {
        KclError::new_type(KclErrorDetails::new(
            format!("No edge found previous adjacent to tag: `{}`", edge.value),
            vec![args.source_range],
        ))
    })
}

/// Get the shared edge between two faces.
pub async fn get_common_edge(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let faces: Vec<FaceTag> = args.get_kw_arg(
        "faces",
        &RuntimeType::Array(Box::new(RuntimeType::tagged_face()), ArrayLen::Known(2)),
        exec_state,
    )?;

    fn into_tag(face: FaceTag, source_range: SourceRange) -> Result<TagIdentifier, KclError> {
        match face {
            FaceTag::StartOrEnd(_) => Err(KclError::new_type(KclErrorDetails::new(
                "getCommonEdge requires a tagged face, it cannot use `START` or `END` faces".to_owned(),
                vec![source_range],
            ))),
            FaceTag::Tag(tag_identifier) => Ok(*tag_identifier),
        }
    }

    let [face1, face2]: [FaceTag; 2] = faces.try_into().map_err(|_: Vec<FaceTag>| {
        KclError::new_type(KclErrorDetails::new(
            "getCommonEdge requires exactly two tags for faces".to_owned(),
            vec![args.source_range],
        ))
    })?;

    let face1 = into_tag(face1, args.source_range)?;
    let face2 = into_tag(face2, args.source_range)?;

    let edge = inner_get_common_edge(face1, face2, exec_state, args.clone()).await?;
    Ok(KclValue::Uuid {
        value: edge,
        meta: vec![args.source_range.into()],
    })
}

async fn inner_get_common_edge(
    face1: TagIdentifier,
    face2: TagIdentifier,
    exec_state: &mut ExecState,
    args: Args,
) -> Result<Uuid, KclError> {
    check_tag_not_ambiguous(&face1, &args)?;
    check_tag_not_ambiguous(&face2, &args)?;
    let id = exec_state.next_uuid();
    if args.ctx.no_engine_commands().await {
        return Ok(id);
    }

    let first_face_id = args.get_adjacent_face_to_tag(exec_state, &face1, false).await?;
    let second_face_id = args.get_adjacent_face_to_tag(exec_state, &face2, false).await?;

    let first_tagged_path = args.get_tag_engine_info(exec_state, &face1)?.clone();
    let second_tagged_path = args.get_tag_engine_info(exec_state, &face2)?;

    if first_tagged_path.geometry.id() != second_tagged_path.geometry.id() {
        return Err(KclError::new_type(KclErrorDetails::new(
            "getCommonEdge requires the faces to be in the same original sketch".to_string(),
            vec![args.source_range],
        )));
    }

    // Flush the batch for our fillets/chamfers if there are any.
    // If we have a chamfer/fillet, flush the batch.
    // TODO: we likely want to be a lot more persnickety _which_ fillets we are flushing
    // but for now, we'll just flush everything.
    if let Some(ExtrudeSurface::Chamfer { .. } | ExtrudeSurface::Fillet { .. }) = first_tagged_path.surface {
        exec_state
            .flush_batch(ModelingCmdMeta::from_args(exec_state, &args), true)
            .await?;
    } else if let Some(ExtrudeSurface::Chamfer { .. } | ExtrudeSurface::Fillet { .. }) = second_tagged_path.surface {
        exec_state
            .flush_batch(ModelingCmdMeta::from_args(exec_state, &args), true)
            .await?;
    }

    let resp = exec_state
        .send_modeling_cmd(
            ModelingCmdMeta::from_args_id(exec_state, &args, id),
            ModelingCmd::from(
                mcmd::Solid3dGetCommonEdge::builder()
                    .object_id(first_tagged_path.geometry.id())
                    .face_ids([first_face_id, second_face_id])
                    .build(),
            ),
        )
        .await?;
    let OkWebSocketResponseData::Modeling {
        modeling_response: OkModelingCmdResponse::Solid3dGetCommonEdge(common_edge),
    } = &resp
    else {
        return Err(KclError::new_engine(KclErrorDetails::new(
            format!("mcmd::Solid3dGetCommonEdge response was not as expected: {resp:?}"),
            vec![args.source_range],
        )));
    };

    common_edge.edge.ok_or_else(|| {
        KclError::new_type(KclErrorDetails::new(
            format!(
                "No common edge was found between `{}` and `{}`",
                face1.value, face2.value
            ),
            vec![args.source_range],
        ))
    })
}

pub async fn get_bounded_edge(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let face = args.get_unlabeled_kw_arg("solid", &RuntimeType::solid(), exec_state)?;
    let edge_val = args.get_kw_arg("edge", &RuntimeType::any(), exec_state)?;
    let lower_bound = args.get_kw_arg_opt("lowerBound", &RuntimeType::num_any(), exec_state)?;
    let upper_bound = args.get_kw_arg_opt("upperBound", &RuntimeType::num_any(), exec_state)?;

    let bounded_edge = match &edge_val {
        KclValue::Uuid { value, .. } => {
            inner_get_bounded_edge_with_id(face, EdgeReference::Uuid(*value), lower_bound, upper_bound, exec_state, args.clone()).await?
        }
        KclValue::TagIdentifier(tag) => {
            inner_get_bounded_edge_with_id(face, EdgeReference::Tag(tag.clone()), lower_bound, upper_bound, exec_state, args.clone()).await?
        }
        KclValue::Object { value: obj, .. } => {
            let spec = parse_edge_specifier_object(obj, &args)?;
            inner_get_bounded_edge_with_specifier(face, spec, lower_bound, upper_bound, &args)?
        }
        _ => {
            return Err(KclError::new_type(KclErrorDetails::new(
                "edge must be a tagged edge, edge UUID, or edge specifier object (e.g. { sideFaces = [...], endFaces = [...], index = 0 })".to_owned(),
                vec![args.source_range],
            )))
        }
    };
    Ok(KclValue::BoundedEdge {
        value: bounded_edge,
        meta: vec![args.source_range.into()],
    })
}

fn tag_or_uuid_from_value(value: &KclValue, field_name: &str, args: &Args) -> Result<TagOrUuid, KclError> {
    match value {
        KclValue::Uuid { value, .. } => Ok(TagOrUuid::Uuid(*value)),
        KclValue::TagIdentifier(tag) => Ok(TagOrUuid::Tag(tag.clone())),
        _ => Err(KclError::new_type(KclErrorDetails::new(
            format!("{field_name} elements must be tags or UUIDs"),
            vec![args.source_range],
        ))),
    }
}

fn parse_tag_or_uuid_array(
    obj: &KclObjectFields,
    field_name: &str,
    required: bool,
    args: &Args,
) -> Result<Vec<TagOrUuid>, KclError> {
    let Some(value) = obj.get(field_name) else {
        return if required {
            Err(KclError::new_type(KclErrorDetails::new(
                format!("edge specifier object must have {field_name}"),
                vec![args.source_range],
            )))
        } else {
            Ok(Vec::new())
        };
    };
    let values = value.as_slice().ok_or_else(|| {
        KclError::new_type(KclErrorDetails::new(
            format!("{field_name} must be an array"),
            vec![args.source_range],
        ))
    })?;
    values
        .iter()
        .map(|value| tag_or_uuid_from_value(value, field_name, args))
        .collect()
}

fn parse_edge_specifier_index(obj: &KclObjectFields, args: &Args) -> Result<Option<u32>, KclError> {
    let Some(index) = obj.get("index") else {
        return Ok(None);
    };
    let KclValue::Number { value, .. } = index else {
        return Err(KclError::new_type(KclErrorDetails::new(
            "edge specifier 'index' must be a non-negative integer".to_owned(),
            vec![args.source_range],
        )));
    };
    if !value.is_finite() || value.fract() != 0.0 || *value < 0.0 || *value > u32::MAX as f64 {
        return Err(KclError::new_type(KclErrorDetails::new(
            "edge specifier 'index' must be a non-negative integer".to_owned(),
            vec![args.source_range],
        )));
    }
    Ok(Some(*value as u32))
}

pub(crate) fn is_edge_specifier_object(value: &KclValue) -> bool {
    matches!(value, KclValue::Object { value, .. } if value.contains_key("sideFaces"))
}

pub(crate) fn parse_edge_specifier_value(value: &KclValue, args: &Args) -> Result<UnresolvedEdgeSpecifier, KclError> {
    let KclValue::Object { value: obj, .. } = value else {
        return Err(KclError::new_type(KclErrorDetails::new(
            "edge specifier must be an object with 'sideFaces'".to_owned(),
            vec![args.source_range],
        )));
    };
    parse_edge_specifier_object(obj, args)
}

/// Parse a KCL object `{ sideFaces, endFaces?, index? }` into UnresolvedEdgeSpecifier. Used by getBoundedEdge and blend.
pub(crate) fn parse_edge_specifier_object(
    obj: &KclObjectFields,
    args: &Args,
) -> Result<UnresolvedEdgeSpecifier, KclError> {
    let side_faces = parse_tag_or_uuid_array(obj, "sideFaces", true, args)?;
    if side_faces.is_empty() {
        return Err(KclError::new_semantic(KclErrorDetails::new(
            "sideFaces must be an array of at least one face, but zero were given".to_owned(),
            vec![args.source_range],
        )));
    }
    let end_faces = parse_tag_or_uuid_array(obj, "endFaces", false, args)?;
    let index = parse_edge_specifier_index(obj, args)?;
    Ok(UnresolvedEdgeSpecifier {
        side_faces,
        end_faces,
        index,
    })
}

async fn resolve_as_face_id(value: &TagOrUuid, exec_state: &mut ExecState, args: &Args) -> Result<Uuid, KclError> {
    match value {
        TagOrUuid::Uuid(uuid) => Ok(*uuid),
        TagOrUuid::Tag(tag) => {
            FaceTag::Tag(tag.clone())
                .get_face_id_from_tag(exec_state, args, false)
                .await
        }
    }
}

async fn resolve_as_face_ids(
    value: &TagOrUuid,
    solid: Option<&Solid>,
    exec_state: &mut ExecState,
    args: &Args,
) -> Result<Vec<Uuid>, KclError> {
    match value {
        TagOrUuid::Uuid(uuid) => Ok(vec![*uuid]),
        TagOrUuid::Tag(tag) => {
            let infos = tag.get_all_cur_info();
            if !infos.is_empty() {
                let face_ids = infos
                    .iter()
                    .map(|info| {
                        info.surface
                            .as_ref()
                            .map(ExtrudeSurface::face_id)
                            .or_else(|| solid.and_then(|solid| face_id_for_tag_info_from_solid(info.id, solid)))
                    })
                    .collect::<Option<Vec<_>>>();
                if let Some(face_ids) = face_ids {
                    return Ok(face_ids);
                }
            }

            Ok(vec![resolve_as_face_id(value, exec_state, args).await?])
        }
    }
}

fn face_id_for_tag_info_from_solid(tag_info_id: Uuid, solid: &Solid) -> Option<Uuid> {
    solid
        .value
        .iter()
        .find(|surface| surface.get_id() == tag_info_id)
        .map(ExtrudeSurface::face_id)
}

async fn resolve_as_adjacent_face_or_tag_id(
    value: &TagOrUuid,
    exec_state: &mut ExecState,
    args: &Args,
) -> Result<Uuid, KclError> {
    match value {
        TagOrUuid::Uuid(uuid) => Ok(*uuid),
        TagOrUuid::Tag(tag) => match args.get_adjacent_face_to_tag(exec_state, tag, false).await {
            Ok(face_id) => Ok(face_id),
            Err(_) => Ok(args.get_tag_engine_info(exec_state, tag)?.id),
        },
    }
}

async fn resolve_as_edge_faces(
    value: &TagOrUuid,
    object_id: Uuid,
    exec_state: &mut ExecState,
    args: &Args,
) -> Result<Vec<Uuid>, KclError> {
    match value {
        TagOrUuid::Uuid(uuid) => Ok(vec![*uuid]),
        TagOrUuid::Tag(tag) => {
            let edge_id = args.get_tag_engine_info(exec_state, tag)?.id;
            get_face_ids_for_edge(exec_state, object_id, edge_id, args).await
        }
    }
}

pub(crate) async fn resolve_edge_specifier_with_face_tags(
    unresolved: &UnresolvedEdgeSpecifier,
    solid: Option<&Solid>,
    exec_state: &mut ExecState,
    args: &Args,
) -> Result<kcmc::shared::EdgeSpecifier, KclError> {
    let mut references = resolve_edge_specifiers_with_face_tags(unresolved, solid, exec_state, args).await?;
    if references.len() != 1 {
        return Err(KclError::new_semantic(KclErrorDetails::new(
            "edge specifier resolved to multiple edge references where exactly one was expected".to_owned(),
            vec![args.source_range],
        )));
    }
    Ok(references.remove(0))
}

const MAX_EDGE_COMBINATIONS: usize = 256;

async fn resolve_edge_specifiers_with_face_tags(
    unresolved: &UnresolvedEdgeSpecifier,
    solid: Option<&Solid>,
    exec_state: &mut ExecState,
    args: &Args,
) -> Result<Vec<kcmc::shared::EdgeSpecifier>, KclError> {
    let mut side_face_groups = Vec::with_capacity(unresolved.side_faces.len());
    for value in &unresolved.side_faces {
        side_face_groups.push(resolve_as_face_ids(value, solid, exec_state, args).await?);
    }
    let mut end_face_groups = Vec::with_capacity(unresolved.end_faces.len());
    for value in &unresolved.end_faces {
        end_face_groups.push(resolve_as_face_ids(value, solid, exec_state, args).await?);
    }

    // Before computing all combinations, count them. If there would be too
    // many, generate a fatal error so that we don't get stuck doing large
    // work on pathological input.
    let side_face_count = side_face_groups.iter().map(Vec::len).fold(1, usize::saturating_mul);
    let end_face_count = end_face_groups.iter().map(Vec::len).fold(1, usize::saturating_mul);
    let total_combinations = side_face_count.saturating_mul(end_face_count);
    // We need to check all of them in case one is zero. It would make the total
    // zero.
    if side_face_count > MAX_EDGE_COMBINATIONS
        || end_face_count > MAX_EDGE_COMBINATIONS
        || total_combinations > MAX_EDGE_COMBINATIONS
    {
        return Err(KclError::new_semantic(KclErrorDetails::new(
            "This edge specifier is too ambiguous. The maximum number of effective edges specified has been exceeded. Either specify fewer faces or use faces that have been split fewer times.".to_owned(),
            vec![args.source_range],
        )));
    }

    // TODO(face-api): Once modeling-commands can represent grouped logical face
    // references, pass these groups through as one engine payload instead of
    // expanding them into several flat EdgeSpecifier payloads.
    // See https://github.com/KittyCAD/modeling-api/issues/1252.
    let side_face_combinations = face_id_combinations(&side_face_groups);
    let end_face_combinations = face_id_combinations(&end_face_groups);
    let mut references = Vec::with_capacity(side_face_combinations.len() * end_face_combinations.len());
    for side_faces in side_face_combinations {
        for end_faces in &end_face_combinations {
            references.push(
                kcmc::shared::EdgeSpecifier::builder()
                    .side_faces(side_faces.clone())
                    .end_faces(end_faces.clone())
                    .maybe_index(unresolved.index)
                    .build(),
            );
        }
    }
    // We should never duplicate the index. It should be used once on the engine
    // side to resolve the entire set.
    if references.len() > 1 && unresolved.index.is_some() {
        return Err(KclError::new_semantic(KclErrorDetails::new(
            "You tried to use an index with sideFaces or endFaces that were split, which isn't supported yet. Please report this to Zoo and include your KCL to help improve this.".to_owned(),
            vec![args.source_range],
        )));
    }
    Ok(references)
}

/// Computes the Cartesian product of a list of groups of face UUIDs. Given N
/// groups, it returns every way of picking exactly one UUID from each group,
/// preserving positional order.
///
/// ```ignore
/// face_id_combinations([[a, b], [c, d]])  ->  [[a, c], [a, d], [b, c], [b, d]]
/// ```
fn face_id_combinations(groups: &[Vec<Uuid>]) -> Vec<Vec<Uuid>> {
    if groups.is_empty() {
        // Callers expect at least one element in the outer Vec.
        return vec![Vec::new()];
    }

    let mut combinations = vec![Vec::new()];
    for group in groups {
        let mut next = Vec::with_capacity(combinations.len() * group.len());
        for combination in &combinations {
            for face_id in group {
                let mut new_combination = combination.clone();
                new_combination.push(*face_id);
                next.push(new_combination);
            }
        }
        combinations = next;
    }
    combinations
}

pub(crate) async fn resolve_edge_specifier_with_adjacent_faces_or_tag_ids(
    unresolved: &UnresolvedEdgeSpecifier,
    exec_state: &mut ExecState,
    args: &Args,
) -> Result<kcmc::shared::EdgeSpecifier, KclError> {
    let mut side_faces = Vec::with_capacity(unresolved.side_faces.len());
    for value in &unresolved.side_faces {
        side_faces.push(resolve_as_adjacent_face_or_tag_id(value, exec_state, args).await?);
    }
    let mut end_faces = Vec::with_capacity(unresolved.end_faces.len());
    for value in &unresolved.end_faces {
        end_faces.push(resolve_as_adjacent_face_or_tag_id(value, exec_state, args).await?);
    }
    Ok(kcmc::shared::EdgeSpecifier::builder()
        .side_faces(side_faces)
        .end_faces(end_faces)
        .maybe_index(unresolved.index)
        .build())
}

pub(crate) async fn parse_edge_refs_to_references(
    edge_refs: Vec<KclValue>,
    solid: Option<&Solid>,
    exec_state: &mut ExecState,
    args: &Args,
) -> Result<Vec<kcmc::shared::EdgeSpecifier>, KclError> {
    if edge_refs.is_empty() {
        return Err(KclError::new_semantic(KclErrorDetails::new(
            "You must provide at least one edge".to_owned(),
            vec![args.source_range],
        )));
    }

    let mut edge_references = Vec::with_capacity(edge_refs.len());
    for edge_ref_value in &edge_refs {
        let spec = parse_edge_specifier_value(edge_ref_value, args)?;
        edge_references.extend(resolve_edge_specifiers_with_face_tags(&spec, solid, exec_state, args).await?);
    }
    Ok(edge_references)
}

/// Get the face (surface body) id from the first side_face of an unresolved
/// specifier. Used when building a BoundedEdge from an edge specifier object in
/// blend().
pub(super) fn face_id_from_first_side_face(
    spec: &UnresolvedEdgeSpecifier,
    exec_state: &mut ExecState,
    args: &Args,
) -> Result<Uuid, KclError> {
    let first = spec.side_faces.first().ok_or_else(|| {
        KclError::new_type(KclErrorDetails::new(
            "edge specifier must have at least one sideFace".to_owned(),
            vec![args.source_range],
        ))
    })?;
    match first {
        TagOrUuid::Uuid(u) => Ok(*u),
        TagOrUuid::Tag(t) => {
            let info = args.get_tag_engine_info(exec_state, t)?;
            Ok(info.geometry.id())
        }
    }
}

pub(crate) async fn inner_get_bounded_edge_with_id(
    face: Solid,
    edge: EdgeReference,
    lower_bound: Option<TyF64>,
    upper_bound: Option<TyF64>,
    exec_state: &mut ExecState,
    args: Args,
) -> Result<BoundedEdge, KclError> {
    let (lb, ub) = bounds_from_opts(lower_bound, upper_bound, &args)?;
    let edge_id = edge.get_engine_id(exec_state, &args)?;
    Ok(BoundedEdge {
        face_id: face.id,
        edge_id: Some(edge_id),
        edge_specifier: None,
        lower_bound: lb,
        upper_bound: ub,
    })
}

fn inner_get_bounded_edge_with_specifier(
    face: Solid,
    spec: UnresolvedEdgeSpecifier,
    lower_bound: Option<TyF64>,
    upper_bound: Option<TyF64>,
    args: &Args,
) -> Result<BoundedEdge, KclError> {
    let (lb, ub) = bounds_from_opts(lower_bound, upper_bound, args)?;
    Ok(BoundedEdge {
        face_id: face.id,
        edge_id: None,
        edge_specifier: Some(spec),
        lower_bound: lb,
        upper_bound: ub,
    })
}

fn bounds_from_opts(
    lower_bound: Option<TyF64>,
    upper_bound: Option<TyF64>,
    args: &Args,
) -> Result<(f32, f32), KclError> {
    let lower_bound = if let Some(lower_bound) = lower_bound {
        let val = lower_bound.n as f32;
        if !(0.0..=1.0).contains(&val) {
            return Err(KclError::new_semantic(KclErrorDetails::new(
                format!(
                    "Invalid value: lowerBound must be between 0.0 and 1.0, provided {}",
                    val
                ),
                vec![args.source_range],
            )));
        }
        val
    } else {
        0.0_f32
    };
    let upper_bound = if let Some(upper_bound) = upper_bound {
        let val = upper_bound.n as f32;
        if !(0.0..=1.0).contains(&val) {
            return Err(KclError::new_semantic(KclErrorDetails::new(
                format!(
                    "Invalid value: upperBound must be between 0.0 and 1.0, provided {}",
                    val
                ),
                vec![args.source_range],
            )));
        }
        val
    } else {
        1.0_f32
    };
    Ok((lower_bound, upper_bound))
}

/// Resolve an unresolved edge specifier (tags/UUIDs) to engine EdgeSpecifier (face UUIDs) for blend. Called from blend().
pub(crate) async fn resolve_unresolved_edge_specifier(
    object_id: Uuid,
    unresolved: &UnresolvedEdgeSpecifier,
    exec_state: &mut ExecState,
    args: &Args,
) -> Result<kcmc::shared::EdgeSpecifier, KclError> {
    let mut side_faces = Vec::new();
    for v in &unresolved.side_faces {
        side_faces.extend(resolve_as_edge_faces(v, object_id, exec_state, args).await?);
    }
    let mut end_faces = Vec::new();
    for v in &unresolved.end_faces {
        end_faces.extend(resolve_as_edge_faces(v, object_id, exec_state, args).await?);
    }
    Ok(kcmc::shared::EdgeSpecifier::builder()
        .side_faces(side_faces)
        .end_faces(end_faces)
        .maybe_index(unresolved.index)
        .build())
}
