//! Standard library appearance.

use anyhow::Result;
use kcmc::{ModelingCmd, each_cmd as mcmd};
use kittycad_modeling_cmds::{
    self as kcmc, ok_response::OkModelingCmdResponse, shared::BodyType, websocket::OkWebSocketResponseData,
};

use crate::{
    errors::{KclError, KclErrorDetails},
    execution::{ExecState, KclValue, ModelingCmdMeta, Solid, types::RuntimeType},
    std::Args,
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
