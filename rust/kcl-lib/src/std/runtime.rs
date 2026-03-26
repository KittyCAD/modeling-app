use crate::ExecState;
use crate::KclError;
use crate::exec::KclValue;
use crate::execution::KclValueControlFlow;
use crate::std::Args;

pub async fn exit(_exec_state: &mut ExecState, _args: Args) -> Result<KclValueControlFlow, KclError> {
    Ok(KclValue::none().exit())
}
