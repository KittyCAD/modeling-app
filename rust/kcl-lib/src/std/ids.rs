//! Functions for handling and converting IDs.

use std::collections::HashSet;

use anyhow::Result;
use kcmc::{ModelingCmd, each_cmd as mcmd};
use kittycad_modeling_cmds::{
    self as kcmc, ok_response::OkModelingCmdResponse, output as mout, websocket::OkWebSocketResponseData,
};

use crate::{
    errors::{KclError, KclErrorDetails},
    execution::{ExecState, ModelingCmdMeta, Solid},
    std::{Args, sketch::FaceTag},
};

async fn inner_delete_face(
    body: Solid,
    tagged_faces: Option<Vec<FaceTag>>,
    face_indices: Option<Vec<u32>>,
    exec_state: &mut ExecState,
    args: Args,
) -> Result<Solid, KclError> {
    // Validate args:
    // User has to give us SOMETHING to delete.
    if tagged_faces.is_none() && face_indices.is_none() {
        return Err(KclError::new_semantic(KclErrorDetails::new(
            "You must use either the `faces` or the `face_indices` parameter".to_string(),
            vec![args.source_range],
        )));
    }

    // Early return for mock response, just return the same solid.
    // If we tracked faces, we would remove some faces... but we don't really.
    let no_engine_commands = args.ctx.no_engine_commands().await;
    if no_engine_commands {
        return Ok(body);
    }

    // Combine the list of faces, both tagged and indexed.
    let tagged_faces = tagged_faces.unwrap_or_default();
    let face_indices = face_indices.unwrap_or_default();
    // Get the face's ID
    let mut face_ids = HashSet::with_capacity(face_indices.len() + tagged_faces.len());

    for tagged_face in tagged_faces {
        let face_id = tagged_face.get_face_id(&body, exec_state, &args, false).await?;
        face_ids.insert(face_id);
    }

    for face_index in face_indices {
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
        face_ids.insert(inner_resp.face_id);
    }

    // Now that we've got all the faces, delete them all.
    let delete_face_response = exec_state
        .send_modeling_cmd(
            ModelingCmdMeta::from_args(exec_state, &args),
            ModelingCmd::from(
                mcmd::EntityDeleteChildren::builder()
                    .entity_id(body.id)
                    .child_entity_ids(face_ids)
                    .build(),
            ),
        )
        .await?;

    let OkWebSocketResponseData::Modeling {
        modeling_response: OkModelingCmdResponse::EntityDeleteChildren(mout::EntityDeleteChildren { .. }),
    } = delete_face_response
    else {
        return Err(KclError::new_semantic(KclErrorDetails::new(
            format!(
                "Engine returned invalid response, it should have returned EntityDeleteChildren but it returned {delete_face_response:?}"
            ),
            vec![args.source_range],
        )));
    };

    // Return the same body, it just has fewer faces.
    Ok(body)
}
