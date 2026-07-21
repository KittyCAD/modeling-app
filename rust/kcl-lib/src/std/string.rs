//! Standard library string operations.

use crate::errors::KclError;
use crate::execution::ExecState;
use crate::execution::KclValue;
use crate::execution::types::RuntimeType;
use crate::std::Args;

/// Convert all cased characters in a string to uppercase.
pub async fn uppercase(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let text: String = args.get_unlabeled_kw_arg("text", &RuntimeType::string(), exec_state)?;

    Ok(KclValue::String {
        value: text.to_uppercase(),
        meta: args.into(),
    })
}
