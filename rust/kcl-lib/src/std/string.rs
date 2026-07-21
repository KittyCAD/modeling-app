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

/// Convert all cased characters in a string to lowercase.
pub async fn lowercase(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let text: String = args.get_unlabeled_kw_arg("text", &RuntimeType::string(), exec_state)?;

    Ok(KclValue::String {
        value: text.to_lowercase(),
        meta: args.into(),
    })
}

/// Compare two strings for equality.
pub async fn is_equal(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let text: String = args.get_unlabeled_kw_arg("text", &RuntimeType::string(), exec_state)?;
    let to: String = args.get_kw_arg("to", &RuntimeType::string(), exec_state)?;
    let case_insensitive = args
        .get_kw_arg_opt("caseInsensitive", &RuntimeType::bool(), exec_state)?
        .unwrap_or(false);

    let value = if case_insensitive {
        unicase::eq(&text, &to)
    } else {
        text == to
    };

    Ok(KclValue::Bool {
        value,
        meta: args.into(),
    })
}
