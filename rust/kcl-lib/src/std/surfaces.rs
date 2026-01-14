//! Standard library appearance.

use anyhow::Result;
use kcmc::{ModelingCmd, each_cmd as mcmd};
use kittycad_modeling_cmds::{self as kcmc};

use crate::{
    errors::KclError,
    execution::{ExecState, KclValue, ModelingCmdMeta, Solid, types::RuntimeType},
    std::Args,
};

/// Flips the orientation of a surface, swapping which side is the front and which is the reverse.
pub async fn flip(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let solid = args.get_unlabeled_kw_arg("solid", &RuntimeType::solid(), exec_state)?;
    inner_flip(solid, exec_state, args)
        .await
        .map(|solid| KclValue::Solid { value: Box::new(solid) })
}

async fn inner_flip(solid: Solid, exec_state: &mut ExecState, args: Args) -> Result<Solid, KclError> {
    exec_state
        .batch_modeling_cmd(
            ModelingCmdMeta::from_args(exec_state, &args),
            ModelingCmd::from(mcmd::Solid3dFlip::builder().object_id(solid.id).build()),
        )
        .await?;

    Ok(solid)
}
