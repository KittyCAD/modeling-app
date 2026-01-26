//! Standard library appearance.

use std::collections::HashSet;

use anyhow::Result;
use kcmc::{ModelingCmd, each_cmd as mcmd};
use kittycad_modeling_cmds::{
    self as kcmc, ok_response::OkModelingCmdResponse, output as mout, shared::BodyType,
    websocket::OkWebSocketResponseData,
};

use crate::{
    errors::{KclError, KclErrorDetails},
    execution::{
        ExecState, KclValue, ModelingCmdMeta, Solid,
        types::{ArrayLen, RuntimeType},
    },
    std::{Args, args::TyF64, sketch::FaceTag},
};

/// Flips the orientation of a surface, swapping which side is the front and which is the reverse.
pub async fn flip_surface(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let surface = args.get_unlabeled_kw_arg("surface", &RuntimeType::solids(), exec_state)?;
    let out = inner_flip_surface(surface, exec_state, args).await?;
    Ok(out.into())
}

async fn inner_flip_surface(
    surfaces: Vec<Solid>,
    exec_state: &mut ExecState,
    args: Args,
) -> Result<Vec<Solid>, KclError> {
    for surface in &surfaces {
        exec_state
            .batch_modeling_cmd(
                ModelingCmdMeta::from_args(exec_state, &args),
                ModelingCmd::from(mcmd::Solid3dFlip::builder().object_id(surface.id).build()),
            )
            .await?;
    }

    Ok(surfaces)
}

/// Check if this object is a solid or not.
pub async fn is_solid(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let argument = args.get_unlabeled_kw_arg("body", &RuntimeType::solid(), exec_state)?;
    let meta = vec![crate::execution::Metadata {
        source_range: args.source_range,
    }];

    let res = inner_is_equal_body_type(argument, exec_state, args, BodyType::Solid).await?;
    Ok(KclValue::Bool { value: res, meta })
}

/// Check if this object is a surface or not.
pub async fn is_surface(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let argument = args.get_unlabeled_kw_arg("body", &RuntimeType::solid(), exec_state)?;
    let meta = vec![crate::execution::Metadata {
        source_range: args.source_range,
    }];

    let res = inner_is_equal_body_type(argument, exec_state, args, BodyType::Surface).await?;
    Ok(KclValue::Bool { value: res, meta })
}

async fn inner_is_equal_body_type(
    surface: Solid,
    exec_state: &mut ExecState,
    args: Args,
    expected: BodyType,
) -> Result<bool, KclError> {
    let meta = ModelingCmdMeta::from_args(exec_state, &args);
    let cmd = ModelingCmd::from(mcmd::Solid3dGetBodyType::builder().object_id(surface.id).build());

    let response = exec_state.send_modeling_cmd(meta, cmd).await?;

    let OkWebSocketResponseData::Modeling {
        modeling_response: OkModelingCmdResponse::Solid3dGetBodyType(body),
    } = response
    else {
        return Err(KclError::new_semantic(KclErrorDetails::new(
            format!(
                "Engine returned invalid response, it should have returned Solid3dGetBodyType but it returned {response:#?}"
            ),
            vec![args.source_range],
        )));
    };

    Ok(expected == body.body_type)
}

pub async fn delete_face(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let body = args.get_unlabeled_kw_arg("body", &RuntimeType::solid(), exec_state)?;
    let faces: Option<Vec<FaceTag>> = args.get_kw_arg_opt(
        "faces",
        &RuntimeType::Array(Box::new(RuntimeType::tagged_face()), ArrayLen::Minimum(1)),
        exec_state,
    )?;
    let face_indices: Option<Vec<TyF64>> = args.get_kw_arg_opt(
        "faceIndices",
        &RuntimeType::Array(Box::new(RuntimeType::count()), ArrayLen::Minimum(1)),
        exec_state,
    )?;
    let face_indices = if let Some(face_indices) = face_indices {
        let faces = face_indices
            .into_iter()
            .map(|num| {
                crate::try_f64_to_u32(num.n).ok_or_else(|| {
                    KclError::new_semantic(KclErrorDetails::new(
                        format!("Face indices must be whole numbers, got {}", num.n),
                        vec![args.source_range],
                    ))
                })
            })
            .collect::<Result<Vec<_>, _>>()?;
        Some(faces)
    } else {
        None
    };
    inner_delete_face(body, faces, face_indices, exec_state, args)
        .await
        .map(Box::new)
        .map(|value| KclValue::Solid { value })
}

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
            modeling_response: OkModelingCmdResponse::Solid3dGetFaceUuid(mout::Solid3dGetFaceUuid { face_id }),
        } = face_uuid_response
        else {
            return Err(KclError::new_semantic(KclErrorDetails::new(
                format!(
                    "Engine returned invalid response, it should have returned Solid3dGetFaceUuid but it returned {face_uuid_response:?}"
                ),
                vec![args.source_range],
            )));
        };
        face_ids.insert(face_id);
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
