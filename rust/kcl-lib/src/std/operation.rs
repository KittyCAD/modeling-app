use crate::{
    ExecState,
    errors::KclError,
    exec::KclValue,
    execution::{
        ModelingCmdMeta, Solid,
        types::{ArrayLen, NumericTypeExt, PrimitiveType, RuntimeType},
    },
    std::{Args, args::TyF64},
};
use kcmc::each_cmd as mcmd;
use kittycad_modeling_cmds::{self as kcmc, units::UnitLength};
use kittycad_modeling_cmds::{ModelingCmd, ModelingCmdEndpoint::BoundingBox};

pub async fn facing(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    #[cfg(target_arch = "wasm32")]
    web_sys::console::log_1(&format!("Facing was called!").into());
    let solid: Solid = args.get_unlabeled_kw_arg("solid", &RuntimeType::Primitive(PrimitiveType::Solid), exec_state)?;

    let tool_diameter: TyF64 = args.get_kw_arg("tool_diameter", &RuntimeType::length(), exec_state)?;

    let bounding_box_cmd_id = exec_state.next_uuid();

    let cmd = ModelingCmd::from(
        mcmd::BoundingBox::builder()
            .entity_ids(vec![solid.id])
            .output_unit(UnitLength::Millimeters)
            .build(),
    );
    let response = exec_state
        .send_modeling_cmd(
            ModelingCmdMeta::from_args_id(exec_state, &args, bounding_box_cmd_id),
            cmd,
        )
        .await?;

    #[cfg(target_arch = "wasm32")]
    web_sys::console::log_1(&format!("{:#?}", response).into());

    Ok(KclValue::Number {
        value: 4.0,
        ty: kcl_api::NumericType::count(),
        meta: vec![],
    })
}
