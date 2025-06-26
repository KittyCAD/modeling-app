//! Standard library assert functions.

use anyhow::Result;

use super::args::TyF64;
use crate::{
    errors::{KclError, KclErrorDetails},
    execution::{ExecState, KclValue, types::RuntimeType},
    std::Args,
};

async fn _assert(value: bool, message: &str, args: &Args) -> Result<(), KclError> {
    if !value {
        return Err(KclError::new_type(KclErrorDetails::new(
            format!("assert failed: {message}"),
            vec![args.source_range],
        )));
    }
    Ok(())
}

pub async fn assert_is(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let actual = args.get_unlabeled_kw_arg("actual", &RuntimeType::bool(), exec_state)?;
    let error = args.get_kw_arg_opt("error", &RuntimeType::string(), exec_state)?;
    inner_assert_is(actual, error, &args).await?;
    Ok(KclValue::none())
}

/// Check that the provided value is true, or raise a [KclError]
/// with the provided description.
pub async fn assert(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let actual = args.get_unlabeled_kw_arg("actual", &RuntimeType::num_any(), exec_state)?;
    let gt = args.get_kw_arg_opt("isGreaterThan", &RuntimeType::num_any(), exec_state)?;
    let lt = args.get_kw_arg_opt("isLessThan", &RuntimeType::num_any(), exec_state)?;
    let gte = args.get_kw_arg_opt("isGreaterThanOrEqual", &RuntimeType::num_any(), exec_state)?;
    let lte = args.get_kw_arg_opt("isLessThanOrEqual", &RuntimeType::num_any(), exec_state)?;
    let eq = args.get_kw_arg_opt("isEqualTo", &RuntimeType::num_any(), exec_state)?;
    let tolerance = args.get_kw_arg_opt("tolerance", &RuntimeType::num_any(), exec_state)?;
    let error = args.get_kw_arg_opt("error", &RuntimeType::string(), exec_state)?;
    inner_assert(actual, gt, lt, gte, lte, eq, tolerance, error, &args).await?;
    Ok(KclValue::none())
}

async fn inner_assert_is(actual: bool, error: Option<String>, args: &Args) -> Result<(), KclError> {
    let error_msg = match &error {
        Some(x) => x,
        None => "should have been true, but it was not",
    };
    _assert(actual, error_msg, args).await
}

#[allow(clippy::too_many_arguments)]
async fn inner_assert(
    actual: TyF64,
    is_greater_than: Option<TyF64>,
    is_less_than: Option<TyF64>,
    is_greater_than_or_equal: Option<TyF64>,
    is_less_than_or_equal: Option<TyF64>,
    is_equal_to: Option<TyF64>,
    tolerance: Option<TyF64>,
    error: Option<String>,
    args: &Args,
) -> Result<(), KclError> {
    // Validate the args
    let no_condition_given = [
        &is_greater_than,
        &is_less_than,
        &is_greater_than_or_equal,
        &is_less_than_or_equal,
        &is_equal_to,
    ]
    .iter()
    .all(|cond| cond.is_none());
    if no_condition_given {
        return Err(KclError::new_type(KclErrorDetails::new(
            "You must provide at least one condition in this assert (for example, isEqualTo)".to_owned(),
            vec![args.source_range],
        )));
    }

    if tolerance.is_some() && is_equal_to.is_none() {
        return Err(KclError::new_type(KclErrorDetails::new(
            "The `tolerance` arg is only used with `isEqualTo`. Either remove `tolerance` or add an `isEqualTo` arg."
                .to_owned(),
            vec![args.source_range],
        )));
    }

    let suffix = if let Some(err_string) = error {
        format!(": {err_string}")
    } else {
        Default::default()
    };
    let actual = actual.n;

    // Run the checks.
    if let Some(exp) = is_greater_than {
        let exp = exp.n;
        _assert(
            actual > exp,
            &format!("Expected {actual} to be greater than {exp} but it wasn't{suffix}"),
            args,
        )
        .await?;
    }
    if let Some(exp) = is_less_than {
        let exp = exp.n;
        _assert(
            actual < exp,
            &format!("Expected {actual} to be less than {exp} but it wasn't{suffix}"),
            args,
        )
        .await?;
    }
    if let Some(exp) = is_greater_than_or_equal {
        let exp = exp.n;
        _assert(
            actual >= exp,
            &format!("Expected {actual} to be greater than or equal to {exp} but it wasn't{suffix}"),
            args,
        )
        .await?;
    }
    if let Some(exp) = is_less_than_or_equal {
        let exp = exp.n;
        _assert(
            actual <= exp,
            &format!("Expected {actual} to be less than or equal to {exp} but it wasn't{suffix}"),
            args,
        )
        .await?;
    }
    if let Some(exp) = is_equal_to {
        let exp = exp.n;
        let tolerance = tolerance.map(|e| e.n).unwrap_or(0.0000000001);
        _assert(
            (actual - exp).abs() < tolerance,
            &format!("Expected {actual} to be equal to {exp} but it wasn't{suffix}"),
            args,
        )
        .await?;
    }
    Ok(())
}
