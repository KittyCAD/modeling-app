use crate::{ExecState, errors::KclError, exec::KclValue, execution::types::NumericTypeExt, std::Args};

pub async fn facing(_exec_state: &mut ExecState, _args: Args) -> Result<KclValue, KclError> {
    Ok(KclValue::Number {
        value: 4.0,
        ty: kcl_api::NumericType::count(),
        meta: vec![],
    })
}
