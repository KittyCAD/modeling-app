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

fn trim_whitespace(text: &str, at_start: bool, at_end: bool) -> &str {
    match (at_start, at_end) {
        (true, true) => text.trim(),
        (true, false) => text.trim_start(),
        (false, true) => text.trim_end(),
        (false, false) => text,
    }
}

/// Remove whitespace from the start and end of a string.
pub async fn trim(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let text: String = args.get_unlabeled_kw_arg("text", &RuntimeType::string(), exec_state)?;
    let value = trim_whitespace(&text, true, true).to_owned();

    Ok(KclValue::String {
        value,
        meta: args.into(),
    })
}
