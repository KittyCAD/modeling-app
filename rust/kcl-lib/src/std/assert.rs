//! Standard library assert functions.

use anyhow::Result;
use kcl_derive_docs::stdlib;

use crate::{
    errors::{KclError, KclErrorDetails},
    execution::{ExecState, KclValue},
    std::Args,
};

use super::args::TyF64;

async fn _assert(value: bool, message: &str, args: &Args) -> Result<(), KclError> {
    if !value {
        return Err(KclError::Type(KclErrorDetails {
            message: format!("assert failed: {}", message),
            source_ranges: vec![args.source_range],
        }));
    }
    Ok(())
}

/// Check that the provided value is true, or raise a [KclError]
/// with the provided description.
pub async fn assert(_exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let actual = args.get_unlabeled_kw_arg("actual")?;
    let gt = args.get_kw_arg_opt("isGreaterThan")?;
    let lt = args.get_kw_arg_opt("isLessThan")?;
    let gte = args.get_kw_arg_opt("isGreaterThanOrEqual")?;
    let lte = args.get_kw_arg_opt("isLessThanOrEqual")?;
    let eq = args.get_kw_arg_opt("isEqualTo")?;
    let epsilon = args.get_kw_arg_opt("epsilon")?;
    let error = args.get_kw_arg_opt("error")?;
    inner_assert(actual, gt, lt, gte, lte, eq, epsilon, error, &args).await?;
    Ok(KclValue::none())
}

/// Check a value meets some expected conditions at runtime. Program terminates with an error if conditions aren't met.
/// If you provide multiple conditions, they will all be checked and all must be met.
///
/// ```no_run
/// n = 10
/// assert(n, isEqualTo = 10)
/// assert(n, isGreaterThanOrEqual = 0, isLessThan = 100, error = "number should be between 0 and 100")
/// assert(1.0000000000012, isEqualTo = 1, epsilon = 0.0001, error = "number should be almost exactly 1")
/// ```
#[stdlib {
    name = "assert",
    keywords = true,
    unlabeled_first = true,
    args = {
        actual = { docs = "Value to check. It will be compared with one of the comparison arguments." },
        is_greater_than = { docs = "Comparison argument. If given, checks the `actual` value is greater than this." },
        is_less_than = { docs = "Comparison argument. If given, checks the `actual` value is less than this." },
        is_greater_than_or_equal = { docs = "Comparison argument. If given, checks the `actual` value is greater than or equal to this." },
        is_less_than_or_equal = { docs = "Comparison argument. If given, checks the `actual` value is less than or equal to this." },
        is_equal_to = { docs = "Comparison argument. If given, checks the `actual` value is less than or equal to this.", include_in_snippet = true },
        epsilon = { docs = "If `isEqualTo` is used, this is the tolerance to allow for the comparison. This tolerance is used because KCL's number system has some floating-point imprecision when used with very large decimal places." },
        error = { docs = "If the value was false, the program will terminate with this error message" },
    }
}]
#[allow(clippy::too_many_arguments)]
async fn inner_assert(
    actual: TyF64,
    is_greater_than: Option<TyF64>,
    is_less_than: Option<TyF64>,
    is_greater_than_or_equal: Option<TyF64>,
    is_less_than_or_equal: Option<TyF64>,
    is_equal_to: Option<TyF64>,
    epsilon: Option<TyF64>,
    error: Option<String>,
    args: &Args,
) -> Result<(), KclError> {
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
        return Err(KclError::Type(KclErrorDetails {
            message: "You must provide at least one condition in this assert (for example, isEqualTo)".to_owned(),
            source_ranges: vec![args.source_range],
        }));
    }
    let suffix = if let Some(err_string) = error {
        format!(": {err_string}")
    } else {
        Default::default()
    };
    let actual = actual.n;
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
        let cond = if let Some(epsilon) = epsilon {
            (actual - exp).abs() < epsilon.n
        } else {
            actual == exp
        };
        _assert(
            cond,
            &format!("Expected {actual} to be equal to {exp} but it wasn't{suffix}"),
            args,
        )
        .await?;
    }
    Ok(())
}
