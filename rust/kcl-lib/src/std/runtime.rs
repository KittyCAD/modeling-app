use crate::{ExecState, KclError, exec::KclValue, execution::KclValueControlFlow, std::Args};

pub async fn exit(_exec_state: &mut ExecState, _args: Args) -> Result<KclValueControlFlow, KclError> {
    Ok(KclValue::none().exit())
}
