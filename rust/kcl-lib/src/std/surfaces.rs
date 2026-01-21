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
