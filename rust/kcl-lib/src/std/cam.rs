use kcl_error::KclError;

use crate::ExecState;
use crate::exec::KclValue;
use crate::execution::types::NumericTypeExt;
use crate::std::Args;

pub async fn program(_exec_state: &mut ExecState, _args: Args) -> Result<KclValue, KclError> {
    Ok(KclValue::Number {
        value: 4.0,
        ty: kcl_api::NumericType::count(),
        meta: vec![],
    })
}
