//! Edge helper functions.

use anyhow::Result;
use kcmc::{ModelingCmd, each_cmd as mcmd, ok_response::OkModelingCmdResponse, websocket::OkWebSocketResponseData};
use kittycad_modeling_cmds as kcmc;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[cfg(feature = "artifact-graph")]
use crate::execution::{EdgeRefactorMeta, EdgeRefactorStdlibFn};
use crate::{
    SourceRange,
    errors::{KclError, KclErrorDetails},
    execution::{
        BoundedEdge, ExecState, ExtrudeSurface, KclValue, ModelingCmdMeta, Solid, TagIdentifier,
        types::{ArrayLen, RuntimeType},
    },
    std::{Args, args::TyF64, fillet::EdgeReference, sketch::FaceTag},
};

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
    pub side_faces: Vec<TagOrUuid>,
    #[serde(default)]
    pub end_faces: Vec<TagOrUuid>,
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

    let edge_id = opposite_edge.edge;

    #[cfg(feature = "artifact-graph")]
    if let Ok(face_ids) = get_face_ids_for_edge(exec_state, sketch_id, edge_id, &args).await {
        if let [a, b] = face_ids.as_slice() {
            exec_state.record_edge_refactor_meta(EdgeRefactorMeta {
                edge_id,
                face_ids: [*a, *b],
                source_range: args.source_range,
                stdlib_fn: EdgeRefactorStdlibFn::GetOppositeEdge,
            });
        }
    }

    Ok(edge_id)
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

    let edge_id = adjacent_edge.edge.ok_or_else(|| {
        KclError::new_type(KclErrorDetails::new(
            format!("No edge found next adjacent to tag: `{}`", edge.value),
            vec![args.source_range],
        ))
    })?;

    #[cfg(feature = "artifact-graph")]
    if let Ok(face_ids) = get_face_ids_for_edge(exec_state, sketch_id, edge_id, &args).await {
        if let [a, b] = face_ids.as_slice() {
            exec_state.record_edge_refactor_meta(EdgeRefactorMeta {
                edge_id,
                face_ids: [*a, *b],
                source_range: args.source_range,
                stdlib_fn: EdgeRefactorStdlibFn::GetNextAdjacentEdge,
            });
        }
    }

    Ok(edge_id)
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

    let edge_id = adjacent_edge.edge.ok_or_else(|| {
        KclError::new_type(KclErrorDetails::new(
            format!("No edge found previous adjacent to tag: `{}`", edge.value),
            vec![args.source_range],
        ))
    })?;

    #[cfg(feature = "artifact-graph")]
    if let Ok(face_ids) = get_face_ids_for_edge(exec_state, sketch_id, edge_id, &args).await {
        if let [a, b] = face_ids.as_slice() {
            exec_state.record_edge_refactor_meta(EdgeRefactorMeta {
                edge_id,
                face_ids: [*a, *b],
                source_range: args.source_range,
                stdlib_fn: EdgeRefactorStdlibFn::GetPreviousAdjacentEdge,
            });
        }
    }

    Ok(edge_id)
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

    let edge_id = common_edge.edge.ok_or_else(|| {
        KclError::new_type(KclErrorDetails::new(
            format!(
                "No common edge was found between `{}` and `{}`",
                face1.value, face2.value
            ),
            vec![args.source_range],
        ))
    })?;

    #[cfg(feature = "artifact-graph")]
    exec_state.record_edge_refactor_meta(EdgeRefactorMeta {
        edge_id,
        face_ids: [first_face_id, second_face_id],
        source_range: args.source_range,
        stdlib_fn: EdgeRefactorStdlibFn::GetCommonEdge,
    });

    Ok(edge_id)
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

fn array_from_kcl(v: &KclValue) -> Option<&[KclValue]> {
    match v {
        KclValue::Tuple { value, .. } | KclValue::HomArray { value, .. } => Some(value),
        _ => None,
    }
}

/// Parse a KCL object `{ sideFaces, endFaces?, index? }` into UnresolvedEdgeSpecifier. Used by getBoundedEdge and blend.
pub(crate) fn parse_edge_specifier_object(
    obj: &crate::execution::KclObjectFields,
    args: &Args,
) -> Result<UnresolvedEdgeSpecifier, KclError> {
    let side_faces_val = obj.get("sideFaces").ok_or_else(|| {
        KclError::new_type(KclErrorDetails::new(
            "edge specifier object must have sideFaces".to_owned(),
            vec![args.source_range],
        ))
    })?;
    let side_faces = array_from_kcl(side_faces_val)
        .ok_or_else(|| {
            KclError::new_type(KclErrorDetails::new(
                "sideFaces must be an array".to_owned(),
                vec![args.source_range],
            ))
        })?
        .iter()
        .map(|v| match v {
            KclValue::Uuid { value, .. } => Ok(TagOrUuid::Uuid(*value)),
            KclValue::TagIdentifier(t) => Ok(TagOrUuid::Tag(t.clone())),
            _ => Err(KclError::new_type(KclErrorDetails::new(
                "sideFaces elements must be tags or UUIDs".to_owned(),
                vec![args.source_range],
            ))),
        })
        .collect::<Result<Vec<_>, _>>()?;
    let end_faces = obj
        .get("endFaces")
        .and_then(|v| array_from_kcl(v))
        .map(|arr| {
            arr.iter()
                .map(|v| match v {
                    KclValue::Uuid { value, .. } => Ok(TagOrUuid::Uuid(*value)),
                    KclValue::TagIdentifier(t) => Ok(TagOrUuid::Tag(t.clone())),
                    _ => Err(KclError::new_type(KclErrorDetails::new(
                        "endFaces elements must be tags or UUIDs".to_owned(),
                        vec![args.source_range],
                    ))),
                })
                .collect::<Result<Vec<_>, _>>()
        })
        .transpose()?
        .unwrap_or_default();
    let index = obj.get("index").and_then(|v| v.as_ty_f64().map(|t| t.n as u32));
    Ok(UnresolvedEdgeSpecifier {
        side_faces,
        end_faces,
        index,
    })
}

/// Get the face (surface body) id from the first side_face of an unresolved specifier. Used when building a BoundedEdge from an edge specifier object in blend().
pub(crate) fn face_id_from_first_side_face(
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

pub async fn inner_get_bounded_edge_with_id(
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
pub async fn resolve_unresolved_edge_specifier(
    object_id: Uuid,
    unresolved: &UnresolvedEdgeSpecifier,
    exec_state: &mut ExecState,
    args: &Args,
) -> Result<kcmc::shared::EdgeSpecifier, KclError> {
    let mut side_faces = Vec::new();
    for v in &unresolved.side_faces {
        match v {
            TagOrUuid::Uuid(u) => side_faces.push(*u),
            TagOrUuid::Tag(t) => {
                let edge_id = {
                    let info = args.get_tag_engine_info(exec_state, t)?;
                    info.id
                };
                let face_ids = get_face_ids_for_edge(exec_state, object_id, edge_id, args).await?;
                side_faces.extend(face_ids);
            }
        }
    }
    let mut end_faces = Vec::new();
    for v in &unresolved.end_faces {
        match v {
            TagOrUuid::Uuid(u) => end_faces.push(*u),
            TagOrUuid::Tag(t) => {
                let edge_id = {
                    let info = args.get_tag_engine_info(exec_state, t)?;
                    info.id
                };
                let face_ids = get_face_ids_for_edge(exec_state, object_id, edge_id, args).await?;
                end_faces.extend(face_ids);
            }
        }
    }
    Ok(kcmc::shared::EdgeSpecifier::builder()
        .side_faces(side_faces)
        .end_faces(end_faces)
        .maybe_index(unresolved.index)
        .build())
}
