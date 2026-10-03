//! Standard library assert functions.

use anyhow::Result;

use super::args::TyF64;
use crate::CompilationIssue;
use crate::errors::KclError;
use crate::errors::KclErrorDetails;
use crate::execution::ExecState;
use crate::execution::KclValue;
use crate::execution::annotations;
use crate::execution::types::NumericType;
use crate::execution::types::NumericTypeExt;
use crate::execution::types::RuntimeType;
use crate::execution::types::UnitType;
use crate::std::Args;

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
    let neq = args.get_kw_arg_opt("isNotEqualTo", &RuntimeType::num_any(), exec_state)?;
    let tolerance = args.get_kw_arg_opt("tolerance", &RuntimeType::num_any(), exec_state)?;
    let error = args.get_kw_arg_opt("error", &RuntimeType::string(), exec_state)?;
    inner_assert(actual, gt, lt, gte, lte, eq, neq, tolerance, error, exec_state, &args).await?;
    Ok(KclValue::none())
}

/// Bring `bound` into the units of `actual`, the same way the comparison
/// operators (`actual > bound` and friends) do, and return the two numbers to
/// compare along with their common type. Like the operators, this warns when
/// the units are unknown or incompatible (for example a length and an angle)
/// and then compares the raw numbers.
fn coerce_bound(actual: &TyF64, bound: TyF64, exec_state: &mut ExecState, args: &Args) -> (f64, f64, NumericType) {
    let (actual, bound, ty) = NumericType::combine_eq(actual.clone(), bound, exec_state, args.source_range);
    if ty == NumericType::Unknown {
        exec_state.clear_units_warnings(&args.source_range);
        let mut err = CompilationIssue::err(
            args.source_range,
            "Calling `assert` on numbers which have unknown or incompatible units.\nYou can probably fix this error by specifying the units using type ascription, e.g., `len: number(mm)` or `(a * b): number(deg)`.",
        );
        err.tag = crate::errors::Tag::UnknownNumericUnits;
        exec_state.warn(err, annotations::WARN_UNKNOWN_UNITS);
    }
    (actual, bound, ty)
}

/// Format a number with its unit suffix (for example `25.4mm`) for error messages.
fn with_units(n: f64, ty: &NumericType) -> String {
    match ty {
        NumericType::Known(UnitType::Length(unit)) => format!("{n}{unit}"),
        NumericType::Known(UnitType::Angle(unit)) => format!("{n}{unit}"),
        _ => n.to_string(),
    }
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
    is_not_equal_to: Option<TyF64>,
    tolerance: Option<TyF64>,
    error: Option<String>,
    exec_state: &mut ExecState,
    args: &Args,
) -> Result<(), KclError> {
    // Validate the args
    let no_condition_given = [
        &is_greater_than,
        &is_less_than,
        &is_greater_than_or_equal,
        &is_less_than_or_equal,
        &is_equal_to,
        &is_not_equal_to,
    ]
    .iter()
    .all(|cond| cond.is_none());
    if no_condition_given {
        return Err(KclError::new_type(KclErrorDetails::new(
            "You must provide at least one condition in this assert (for example, isEqualTo)".to_owned(),
            vec![args.source_range],
        )));
    }

    if tolerance.is_some() && is_equal_to.is_none() && is_not_equal_to.is_none() {
        return Err(KclError::new_type(KclErrorDetails::new(
            "The `tolerance` arg is only used with `isEqualTo` and `isNotEqualTo`. Either remove `tolerance` or add an `isEqualTo` or `isNotEqualTo` arg."
                .to_owned(),
            vec![args.source_range],
        )));
    }

    let suffix = if let Some(err_string) = error {
        format!(": {err_string}")
    } else {
        Default::default()
    };

    // Run the checks. Each bound is converted to the units of `actual` first,
    // so `assert(1in, isGreaterThan = 20mm)` compares 1in with 0.787in.
    if let Some(exp) = is_greater_than {
        let (actual, exp, ty) = coerce_bound(&actual, exp, exec_state, args);
        _assert(
            actual > exp,
            &format!(
                "Expected {} to be greater than {} but it wasn't{suffix}",
                with_units(actual, &ty),
                with_units(exp, &ty)
            ),
            args,
        )
        .await?;
    }
    if let Some(exp) = is_less_than {
        let (actual, exp, ty) = coerce_bound(&actual, exp, exec_state, args);
        _assert(
            actual < exp,
            &format!(
                "Expected {} to be less than {} but it wasn't{suffix}",
                with_units(actual, &ty),
                with_units(exp, &ty)
            ),
            args,
        )
        .await?;
    }
    if let Some(exp) = is_greater_than_or_equal {
        let (actual, exp, ty) = coerce_bound(&actual, exp, exec_state, args);
        _assert(
            actual >= exp,
            &format!(
                "Expected {} to be greater than or equal to {} but it wasn't{suffix}",
                with_units(actual, &ty),
                with_units(exp, &ty)
            ),
            args,
        )
        .await?;
    }
    if let Some(exp) = is_less_than_or_equal {
        let (actual, exp, ty) = coerce_bound(&actual, exp, exec_state, args);
        _assert(
            actual <= exp,
            &format!(
                "Expected {} to be less than or equal to {} but it wasn't{suffix}",
                with_units(actual, &ty),
                with_units(exp, &ty)
            ),
            args,
        )
        .await?;
    }
    const DEFAULT_TOLERANCE: f64 = 0.0000000001;
    // The tolerance is converted to the same units as the compared values.
    let tolerance_in = |ty: NumericType, actual: f64, exec_state: &mut ExecState| match &tolerance {
        Some(tol) => coerce_bound(&TyF64::new(actual, ty), tol.clone(), exec_state, args).1,
        None => DEFAULT_TOLERANCE,
    };
    if let Some(exp) = is_equal_to {
        let (actual, exp, ty) = coerce_bound(&actual, exp, exec_state, args);
        let tolerance = tolerance_in(ty, actual, exec_state);
        _assert(
            (actual - exp).abs() < tolerance,
            &format!(
                "Expected {} to be equal to {} using tolerance {} but it wasn't{suffix}",
                with_units(actual, &ty),
                with_units(exp, &ty),
                with_units(tolerance, &ty)
            ),
            args,
        )
        .await?;
    }
    if let Some(exp) = is_not_equal_to {
        let (actual, exp, ty) = coerce_bound(&actual, exp, exec_state, args);
        let tolerance = tolerance_in(ty, actual, exec_state);
        _assert(
            (actual - exp).abs() >= tolerance,
            &format!(
                "Expected {} to not be equal to {} using tolerance {} but it was{suffix}",
                with_units(actual, &ty),
                with_units(exp, &ty),
                with_units(tolerance, &ty)
            ),
            args,
        )
        .await?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use crate::execution::parse_execute;

    /// Runs `code` in a mm file and returns the warnings it produced, or the
    /// error message if it failed.
    async fn run(code: &str) -> Result<Vec<String>, String> {
        let code = format!("@settings(kclVersion = 2.0, defaultLengthUnit = mm)\n{code}");
        match parse_execute(&code).await {
            Ok(result) => Ok(result.issues().iter().map(|issue| issue.message.clone()).collect()),
            Err(e) => Err(e.message().to_owned()),
        }
    }

    async fn assert_passes(code: &str) {
        match run(code).await {
            Ok(warnings) => assert!(warnings.is_empty(), "unexpected warnings {warnings:?} for:\n{code}"),
            Err(e) => panic!("expected to pass, got `{e}` for:\n{code}"),
        }
    }

    /// Checks that `code` fails and that every fragment appears in the error
    /// message. Fragments stop short of the last digits of converted values,
    /// since those depend on floating-point rounding.
    async fn assert_fails_with(code: &str, fragments: &[&str]) {
        match run(code).await {
            Ok(_) => panic!("expected to fail for:\n{code}"),
            Err(e) => {
                for fragment in fragments {
                    assert!(e.contains(fragment), "expected `{fragment}` in `{e}` for:\n{code}");
                }
            }
        }
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn assert_converts_bounds_to_the_units_of_the_actual_value() {
        // 1in is 25.4mm, so each of these holds once the bound is converted.
        assert_passes("assert(1in, isGreaterThan = 20mm)").await;
        assert_passes("assert(20mm, isLessThan = 1in)").await;
        assert_passes("assert(1in, isGreaterThanOrEqual = 25.4mm)").await;
        assert_passes("assert(25.4mm, isLessThanOrEqual = 1in)").await;
        assert_passes("assert(25.4mm, isEqualTo = 1in)").await;
        assert_passes("assert(1in, isEqualTo = 25.4mm)").await;
        assert_passes("assert(1in, isNotEqualTo = 20mm)").await;
        assert_passes("assert(2in, isGreaterThan = 1in, isLessThan = 60mm)").await;

        // And each of these fails, with both values shown in the units of `actual`.
        assert_fails_with(
            "assert(1in, isLessThan = 20mm)",
            &["Expected 1in to be less than 0.7874015748031", "in but it wasn't"],
        )
        .await;
        assert_fails_with(
            "assert(20mm, isGreaterThan = 1in)",
            &["Expected 20mm to be greater than 25.4mm but it wasn't"],
        )
        .await;
        assert_fails_with(
            "assert(1in, isLessThanOrEqual = 20mm)",
            &[
                "Expected 1in to be less than or equal to 0.7874015748031",
                "in but it wasn't",
            ],
        )
        .await;
        assert_fails_with(
            "assert(20mm, isGreaterThanOrEqual = 1in)",
            &["Expected 20mm to be greater than or equal to 25.4mm but it wasn't"],
        )
        .await;
        assert_fails_with(
            "assert(20mm, isEqualTo = 1in, error = \"wall too thin\")",
            &["Expected 20mm to be equal to 25.4mm using tolerance 0.0000000001mm but it wasn't: wall too thin"],
        )
        .await;
        assert_fails_with(
            "assert(25.4mm, isNotEqualTo = 1in)",
            &["Expected 25.4mm to not be equal to 25.4mm using tolerance 0.0000000001mm but it was"],
        )
        .await;
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn assert_converts_the_tolerance_too() {
        // 25.5mm is 1.0039in, so it is within 1mm of 1in but not within 0.01mm.
        assert_passes("assert(1in, isEqualTo = 25.5mm, tolerance = 1mm)").await;
        assert_fails_with(
            "assert(1in, isEqualTo = 25.5mm, tolerance = 0.01mm)",
            &[
                "Expected 1in to be equal to 1.0039370078740",
                "in using tolerance 0.0003937007874015",
                "in but it wasn't",
            ],
        )
        .await;
        assert_passes("assert(1in, isNotEqualTo = 25.5mm, tolerance = 0.01mm)").await;
        assert_fails_with(
            "assert(1in, isNotEqualTo = 25.5mm, tolerance = 1mm)",
            &[
                "Expected 1in to not be equal to 1.0039370078740",
                "in using tolerance 0.03937007874015",
                "in but it was",
            ],
        )
        .await;

        // Angles: 1.5707963rad is 89.9999985deg, within 0.001deg of 90deg but not within 1e-9rad.
        assert_passes("assert(90deg, isEqualTo = 1.5707963rad, tolerance = 0.001deg)").await;
        assert_passes("assert(1.5707963rad, isEqualTo = 90deg, tolerance = 0.001deg)").await;
        assert_fails_with(
            "assert(90deg, isEqualTo = 1.5707963rad, tolerance = 0.000000001rad)",
            &[
                "Expected 90deg to be equal to 89.9999984647",
                "deg using tolerance 0.000000057295779513",
                "deg but it wasn't",
            ],
        )
        .await;
        assert_passes("assert(90deg, isGreaterThan = 1rad, isLessThan = 2rad)").await;
        assert_fails_with(
            "assert(90deg, isLessThan = 1rad)",
            &["Expected 90deg to be less than 57.29577951308", "deg but it wasn't"],
        )
        .await;
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn assert_with_matching_or_no_units_is_unchanged() {
        assert_passes("assert(25.4mm, isGreaterThan = 20mm, isLessThan = 30mm, isEqualTo = 25.4mm)").await;
        assert_passes("assert(90deg, isEqualTo = 90deg, tolerance = 0.001deg)").await;
        // A bound or tolerance without units takes the units of the file.
        assert_passes("assert(25.4mm, isEqualTo = 25.4, tolerance = 0.001)").await;
        assert_passes("assert(25.4, isEqualTo = 25.4mm, tolerance = 0.001mm)").await;
        assert_passes("assert(10, isGreaterThan = 5, isLessThan = 20, isNotEqualTo = 7)").await;
        assert_passes("assert(1.0000000000012, isEqualTo = 1, tolerance = 0.0001)").await;
        assert_fails_with(
            "assert(10, isGreaterThan = 20)",
            &["Expected 10 to be greater than 20 but it wasn't"],
        )
        .await;
        assert_fails_with(
            "assert(25.4mm, isEqualTo = 25mm, error = \"not 25\")",
            &["Expected 25.4mm to be equal to 25mm using tolerance 0.0000000001mm but it wasn't: not 25"],
        )
        .await;
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn assert_warns_on_incompatible_units() {
        // A length cannot be converted to an angle, so, like `30in > 20deg`,
        // the raw numbers are compared and a warning is reported.
        let warnings = run("assert(30in, isGreaterThan = 20deg)").await.unwrap();
        assert_eq!(warnings.len(), 1, "{warnings:?}");
        assert!(
            warnings[0].contains("Calling `assert` on numbers which have unknown or incompatible units"),
            "{warnings:?}"
        );
        assert_fails_with(
            "assert(1in, isGreaterThan = 20deg)",
            &["Expected 1 to be greater than 20 but it wasn't"],
        )
        .await;
        // The tolerance is checked the same way, and the warning is reported once.
        let warnings = run("assert(90deg, isEqualTo = 90deg, tolerance = 1mm)").await.unwrap();
        assert_eq!(warnings.len(), 1, "{warnings:?}");
    }
}
