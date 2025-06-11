//! Edge helper functions.

use anyhow::Result;
use kcmc::{each_cmd as mcmd, ok_response::OkModelingCmdResponse, websocket::OkWebSocketResponseData, ModelingCmd};
use kittycad_modeling_cmds as kcmc;
use uuid::Uuid;

use crate::{
    errors::{KclError, KclErrorDetails},
    execution::{
        types::{ArrayLen, RuntimeType},
        ExecState, ExtrudeSurface, KclValue, ModelingCmdMeta, TagIdentifier,
    },
    std::Args,
};

/// Get the opposite edge to the edge given.
pub async fn get_opposite_edge(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let input_edge = args.get_unlabeled_kw_arg("edge", &RuntimeType::tag_identifier(), exec_state)?;

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
    let sketch_id = tagged_path.sketch;

    let resp = exec_state
        .send_modeling_cmd(
            (&args).into(),
            ModelingCmd::from(mcmd::Solid3dGetOppositeEdge {
                edge_id: tagged_path_id,
                object_id: sketch_id,
                face_id,
            }),
        )
        .await?;
    let OkWebSocketResponseData::Modeling {
        modeling_response: OkModelingCmdResponse::Solid3dGetOppositeEdge(opposite_edge),
    } = &resp
    else {
        return Err(KclError::new_engine(KclErrorDetails::new(
            format!("mcmd::Solid3dGetOppositeEdge response was not as expected: {:?}", resp),
            vec![args.source_range],
        )));
    };

    Ok(opposite_edge.edge)
}

/// Get the next adjacent edge to the edge given.
pub async fn get_next_adjacent_edge(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let input_edge = args.get_unlabeled_kw_arg("edge", &RuntimeType::tag_identifier(), exec_state)?;

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
    let sketch_id = tagged_path.sketch;

    let resp = exec_state
        .send_modeling_cmd(
            (&args).into(),
            ModelingCmd::from(mcmd::Solid3dGetNextAdjacentEdge {
                edge_id: tagged_path_id,
                object_id: sketch_id,
                face_id,
            }),
        )
        .await?;

    let OkWebSocketResponseData::Modeling {
        modeling_response: OkModelingCmdResponse::Solid3dGetNextAdjacentEdge(adjacent_edge),
    } = &resp
    else {
        return Err(KclError::new_engine(KclErrorDetails::new(
            format!(
                "mcmd::Solid3dGetNextAdjacentEdge response was not as expected: {:?}",
                resp
            ),
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
    let input_edge = args.get_unlabeled_kw_arg("edge", &RuntimeType::tag_identifier(), exec_state)?;

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
    let sketch_id = tagged_path.sketch;

    let resp = exec_state
        .send_modeling_cmd(
            (&args).into(),
            ModelingCmd::from(mcmd::Solid3dGetPrevAdjacentEdge {
                edge_id: tagged_path_id,
                object_id: sketch_id,
                face_id,
            }),
        )
        .await?;
    let OkWebSocketResponseData::Modeling {
        modeling_response: OkModelingCmdResponse::Solid3dGetPrevAdjacentEdge(adjacent_edge),
    } = &resp
    else {
        return Err(KclError::new_engine(KclErrorDetails::new(
            format!(
                "mcmd::Solid3dGetPrevAdjacentEdge response was not as expected: {:?}",
                resp
            ),
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
    let faces: Vec<TagIdentifier> = args.get_kw_arg(
        "faces",
        &RuntimeType::Array(Box::new(RuntimeType::tag_identifier()), ArrayLen::Known(2)),
        exec_state,
    )?;

    let edge = inner_get_common_edge(faces, exec_state, args.clone()).await?;
    Ok(KclValue::Uuid {
        value: edge,
        meta: vec![args.source_range.into()],
    })
}

async fn inner_get_common_edge(
    faces: Vec<TagIdentifier>,
    exec_state: &mut ExecState,
    args: Args,
) -> Result<Uuid, KclError> {
    let id = exec_state.next_uuid();
    if args.ctx.no_engine_commands().await {
        return Ok(id);
    }

    if faces.len() != 2 {
        return Err(KclError::new_type(KclErrorDetails::new(
            "getCommonEdge requires exactly two tags for faces".to_string(),
            vec![args.source_range],
        )));
    }
    let first_face_id = args.get_adjacent_face_to_tag(exec_state, &faces[0], false).await?;
    let second_face_id = args.get_adjacent_face_to_tag(exec_state, &faces[1], false).await?;

    let first_tagged_path = args.get_tag_engine_info(exec_state, &faces[0])?.clone();
    let second_tagged_path = args.get_tag_engine_info(exec_state, &faces[1])?;

    if first_tagged_path.sketch != second_tagged_path.sketch {
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
        exec_state.flush_batch((&args).into(), true).await?;
    } else if let Some(ExtrudeSurface::Chamfer { .. } | ExtrudeSurface::Fillet { .. }) = second_tagged_path.surface {
        exec_state.flush_batch((&args).into(), true).await?;
    }

    let resp = exec_state
        .send_modeling_cmd(
            ModelingCmdMeta::from_args_id(&args, id),
            ModelingCmd::from(mcmd::Solid3dGetCommonEdge {
                object_id: first_tagged_path.sketch,
                face_ids: [first_face_id, second_face_id],
            }),
        )
        .await?;
    let OkWebSocketResponseData::Modeling {
        modeling_response: OkModelingCmdResponse::Solid3dGetCommonEdge(common_edge),
    } = &resp
    else {
        return Err(KclError::new_engine(KclErrorDetails::new(
            format!("mcmd::Solid3dGetCommonEdge response was not as expected: {:?}", resp),
            vec![args.source_range],
        )));
    };

    common_edge.edge.ok_or_else(|| {
        KclError::new_type(KclErrorDetails::new(
            format!(
                "No common edge was found between `{}` and `{}`",
                faces[0].value, faces[1].value
            ),
            vec![args.source_range],
        ))
    })
}
