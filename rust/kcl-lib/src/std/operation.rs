use crate::{ExecState, errors::KclError, exec::KclValue, std::Args};

pub async fn facing(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    Ok(KclValue::Number {
        value: 4.0,
        ty: kcl_api::NumericType::Unknown,
        meta: vec![],
    })
}
