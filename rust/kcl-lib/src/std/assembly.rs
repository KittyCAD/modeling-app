use kittycad_modeling_cmds::each_cmd;
use kittycad_modeling_cmds::id::ModelingCmdId;

use kcmc::ModelingCmd;
use kcmc::each_cmd as mcmd;
use kittycad_modeling_cmds::{self as kcmc};

use crate::errors::KclError;
use crate::execution::Assembly;
use crate::execution::ExecState;
use crate::execution::KclValue;
use crate::execution::ModelingCmdMeta;
use crate::execution::SolidOrAssembly;
use crate::execution::types::RuntimeType;
use crate::std::Args;

pub async fn create_assembly(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let name = args.get_unlabeled_kw_arg("name", &RuntimeType::string(), exec_state)?;
    let assembly = inner_create_assembly(name, exec_state, args).await?;
    Ok(assembly.into())
}

async fn inner_create_assembly(name: String, exec_state: &mut ExecState, args: Args) -> Result<Assembly, KclError> {
    let cmd_id = exec_state.next_uuid();
    let cmd = ModelingCmd::from(mcmd::CreateAssembly::builder().name(name).build());

    exec_state
        .batch_modeling_cmd(ModelingCmdMeta::from_args_id(exec_state, &args, cmd_id), cmd)
        .await?;

    //TODO: don't know what is supposed to be stored in this
    Ok(Assembly {
        id: cmd_id,
        meta: vec![],
    })
}

pub async fn add_to_assembly(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let assembly = args.get_unlabeled_kw_arg("assembly", &RuntimeType::assembly(), exec_state)?;
    let solid = args.get_kw_arg(
        "solid",
        &RuntimeType::Union(vec![RuntimeType::solid(), RuntimeType::assembly()]),
        exec_state,
    )?;

    let result = inner_add_to_assembly(assembly, solid, exec_state, args).await?;

    Ok(result.into())
}

async fn inner_add_to_assembly(
    assembly: Assembly,
    solid: SolidOrAssembly,
    exec_state: &mut ExecState,
    args: Args,
) -> Result<Assembly, KclError> {
    let ids = match solid {
        SolidOrAssembly::SolidSet(s) => s[0].id,
        SolidOrAssembly::AssemblySet(a) => a[0].id,
    };

    //TODO: change to vec of ids
    let cmd = ModelingCmd::from(
        mcmd::AddToAssembly::builder()
            .assembly_id(assembly.id)
            .object_id(ids)
            .build(),
    );
    exec_state
        .batch_modeling_cmd(ModelingCmdMeta::from_args(exec_state, &args), cmd)
        .await?;

    Ok(assembly)
}
