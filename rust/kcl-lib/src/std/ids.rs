//! Functions for handling and converting IDs.

use anyhow::Result;
use kcmc::{ModelingCmd, each_cmd as mcmd};
use kittycad_modeling_cmds::{self as kcmc, ok_response::OkModelingCmdResponse, websocket::OkWebSocketResponseData};
use uuid::Uuid;

use crate::{
    errors::{KclError, KclErrorDetails},
    exec::KclValue,
    execution::{ExecState, Metadata, ModelingCmdMeta, Solid, types::RuntimeType},
    parsing::ast::types::TagNode,
    std::Args,
};

/// Translates face indices to face IDs.
pub async fn face_id(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let body = args.get_unlabeled_kw_arg("body", &RuntimeType::solid(), exec_state)?;
    let face_index: u32 = args.get_kw_arg("index", &RuntimeType::count(), exec_state)?;
    let tag = args.get_kw_arg("tag", &RuntimeType::tag_decl(), exec_state)?;

    inner_face_id(body, face_index, tag, exec_state, args).await
}

/// Translates face indices to face IDs.
async fn inner_face_id(
    body: Solid,
    face_index: u32,
    tag: TagNode,
    exec_state: &mut ExecState,
    args: Args,
) -> Result<KclValue, KclError> {
    // TODO: Check for mock execution here and return some ID.
    let face_uuid_response = exec_state
        .send_modeling_cmd(
            ModelingCmdMeta::from_args(exec_state, &args),
            ModelingCmd::from(
                mcmd::Solid3dGetFaceUuid::builder()
                    .object_id(body.id)
                    .face_index(face_index)
                    .build(),
            ),
        )
        .await?;

    let OkWebSocketResponseData::Modeling {
        modeling_response: OkModelingCmdResponse::Solid3dGetFaceUuid(inner_resp),
    } = face_uuid_response
    else {
        return Err(KclError::new_semantic(KclErrorDetails::new(
            format!(
                "Engine returned invalid response, it should have returned Solid3dGetFaceUuid but it returned {face_uuid_response:?}"
            ),
            vec![args.source_range],
        )));
    };
    let new_tagged_face = todo!();
    Ok(new_tagged_face)
}

/// Translates edge indices to edge IDs.
pub async fn edge_id(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let body = args.get_unlabeled_kw_arg("body", &RuntimeType::solid(), exec_state)?;
    let edge_index: u32 = args.get_kw_arg("index", &RuntimeType::count(), exec_state)?;
    let tag = args.get_kw_arg("tag", &RuntimeType::tag_decl(), exec_state)?;

    let meta = vec![Metadata {
        source_range: args.source_range,
    }];
    inner_edge_id(body, edge_index, tag, exec_state, args).await
}

/// Translates edge indices to edge IDs.
async fn inner_edge_id(
    body: Solid,
    edge_index: u32,
    tag: TagNode,
    exec_state: &mut ExecState,
    args: Args,
) -> Result<KclValue, KclError> {
    // TODO: Check for mock execution here and return some ID.
    let edge_uuid_response = exec_state
        .send_modeling_cmd(
            ModelingCmdMeta::from_args(exec_state, &args),
            ModelingCmd::from(
                mcmd::Solid3dGetEdgeUuid::builder()
                    .object_id(body.id)
                    .edge_index(edge_index)
                    .build(),
            ),
        )
        .await?;

    let OkWebSocketResponseData::Modeling {
        modeling_response: OkModelingCmdResponse::Solid3dGetEdgeUuid(inner_resp),
    } = edge_uuid_response
    else {
        return Err(KclError::new_semantic(KclErrorDetails::new(
            format!(
                "Engine returned invalid response, it should have returned Solid3dGetEdgeUuid but it returned {edge_uuid_response:?}"
            ),
            vec![args.source_range],
        )));
    };
    let new_tagged_edge = todo!();
    Ok(new_tagged_edge)
}
