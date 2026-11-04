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
/// and then compares the raw numbers. A number without units only matches a
/// value in the file's units: in a mm file, `1in` against `20` is not
/// converted, so the raw numbers 1 and 20 are compared, with the warning.
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

const DEFAULT_TOLERANCE: f64 = 0.0000000001;

/// Bring the tolerance into the units of the compared values (`actual` with
/// type `ty`), like [`coerce_bound`]. Returns the tolerance to use and how to
/// show it in an error message. If its units cannot be converted, the raw
/// number is used, and the message shows the units the tolerance was written
/// in and says so, rather than claiming a conversion happened.
fn coerce_tolerance(
    tolerance: Option<&TyF64>,
    actual: f64,
    ty: NumericType,
    exec_state: &mut ExecState,
    args: &Args,
) -> (f64, String) {
    let Some(tolerance) = tolerance else {
        return (DEFAULT_TOLERANCE, with_units(DEFAULT_TOLERANCE, &ty));
    };
    let (_, n, tolerance_ty) = coerce_bound(&TyF64::new(actual, ty), tolerance.clone(), exec_state, args);
    let shown = if tolerance_ty == NumericType::Unknown {
        format!(
            "{} (its units could not be converted, so the raw number {n} was used)",
            with_units(tolerance.n, &tolerance.ty)
        )
    } else {
        with_units(n, &tolerance_ty)
    };
    (n, shown)
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
    if let Some(exp) = is_equal_to {
        let (actual, exp, ty) = coerce_bound(&actual, exp, exec_state, args);
        let (tolerance, tolerance_shown) = coerce_tolerance(tolerance.as_ref(), actual, ty, exec_state, args);
        _assert(
            (actual - exp).abs() < tolerance,
            &format!(
                "Expected {} to be equal to {} using tolerance {tolerance_shown} but it wasn't{suffix}",
                with_units(actual, &ty),
                with_units(exp, &ty),
            ),
            args,
        )
        .await?;
    }
    if let Some(exp) = is_not_equal_to {
        let (actual, exp, ty) = coerce_bound(&actual, exp, exec_state, args);
        let (tolerance, tolerance_shown) = coerce_tolerance(tolerance.as_ref(), actual, ty, exec_state, args);
        _assert(
            (actual - exp).abs() >= tolerance,
            &format!(
                "Expected {} to not be equal to {} using tolerance {tolerance_shown} but it was{suffix}",
                with_units(actual, &ty),
                with_units(exp, &ty),
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

    /// Every case runs under each of these KCL versions. The comparison has
    /// no version gate, so the results must be the same.
    const KCL_VERSIONS: [&str; 2] = ["2.0", "3.0"];

    const UNKNOWN_UNITS: &str = "Calling `assert` on numbers which have unknown or incompatible units";
    const ANGLE_UNITS: &str = "Prefer to use explicit units for angles";

    /// Runs `code` in a file with default length unit `unit` and KCL version
    /// `version`, and returns the warnings it produced, or the error message
    /// if it failed.
    async fn run(unit: &str, version: &str, code: &str) -> Result<Vec<String>, String> {
        let code = format!("@settings(kclVersion = {version}, defaultLengthUnit = {unit})\n{code}");
        match parse_execute(&code).await {
            Ok(result) => Ok(result.issues().iter().map(|issue| issue.message.clone()).collect()),
            Err(e) => Err(e.message().to_owned()),
        }
    }

    /// Checks that `code` passes in a file with default length unit `unit`,
    /// under every KCL version, and that it reports one warning for each entry
    /// of `warnings`, containing that text. `&[]` means no warnings.
    async fn assert_passes_in(unit: &str, code: &str, warnings: &[&str]) {
        for version in KCL_VERSIONS {
            match run(unit, version, code).await {
                Ok(actual) => {
                    assert_eq!(
                        actual.len(),
                        warnings.len(),
                        "expected warnings {warnings:?}, got {actual:?} under KCL {version} for:\n{code}"
                    );
                    for (actual, expected) in actual.iter().zip(warnings) {
                        assert!(
                            actual.contains(expected),
                            "expected warning `{expected}`, got `{actual}` under KCL {version} for:\n{code}"
                        );
                    }
                }
                Err(e) => panic!("expected to pass, got `{e}` under KCL {version} for:\n{code}"),
            }
        }
    }

    /// Checks that `code` passes with no warnings in a mm file.
    async fn assert_passes(code: &str) {
        assert_passes_in("mm", code, &[]).await;
    }

    /// Checks that `code` fails in a file with default length unit `unit`,
    /// under every KCL version, and that every fragment appears in the error
    /// message. Fragments stop short of the last digits of converted values,
    /// since those depend on floating-point rounding.
    async fn assert_fails_in(unit: &str, code: &str, fragments: &[&str]) {
        for version in KCL_VERSIONS {
            match run(unit, version, code).await {
                Ok(_) => panic!("expected to fail under KCL {version} for:\n{code}"),
                Err(e) => {
                    for fragment in fragments {
                        assert!(
                            e.contains(fragment),
                            "expected `{fragment}` in `{e}` under KCL {version} for:\n{code}"
                        );
                    }
                }
            }
        }
    }

    /// Checks that `code` fails in a mm file, as [`assert_fails_in`].
    async fn assert_fails_with(code: &str, fragments: &[&str]) {
        assert_fails_in("mm", code, fragments).await;
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
        // A bound or tolerance without units matches a value in the file's
        // units (mm here). Against other units it is not converted; see
        // `assert_does_not_convert_a_number_without_units_to_other_units`.
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
        assert_passes_in("mm", "assert(30in, isGreaterThan = 20deg)", &[UNKNOWN_UNITS]).await;
        assert_fails_with(
            "assert(1in, isGreaterThan = 20deg)",
            &["Expected 1 to be greater than 20 but it wasn't"],
        )
        .await;
        // The tolerance is checked the same way, and the warning is reported once.
        assert_passes_in(
            "mm",
            "assert(90deg, isEqualTo = 90deg, tolerance = 1mm)",
            &[UNKNOWN_UNITS],
        )
        .await;
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn assert_shows_an_incompatible_tolerance_in_its_own_units() {
        // 1mm cannot be converted to degrees, so the raw number 1 is used as
        // the tolerance. The message must say so, not claim it was 1deg.
        assert_fails_with(
            "assert(90deg, isEqualTo = 92deg, tolerance = 1mm)",
            &["Expected 90deg to be equal to 92deg using tolerance 1mm (its units could not be converted, so the raw number 1 was used) but it wasn't"],
        )
        .await;
        assert_fails_with(
            "assert(90deg, isNotEqualTo = 90.5deg, tolerance = 1mm)",
            &["Expected 90deg to not be equal to 90.5deg using tolerance 1mm (its units could not be converted, so the raw number 1 was used) but it was"],
        )
        .await;
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn assert_does_not_convert_a_number_without_units_to_other_units() {
        // Like the operators, a number without units only takes the file's
        // units when the other value is in the file's units too. Against a
        // different unit it is not converted: the raw numbers are compared,
        // with a warning. So in a mm file, `1in` against `20` compares 1 with
        // 20 (like `1in > 20`), not 25.4mm with 20mm.
        assert_fails_with(
            "assert(1in, isGreaterThan = 20)",
            &["Expected 1 to be greater than 20 but it wasn't"],
        )
        .await;
        assert_passes_in("mm", "assert(1in, isLessThan = 20)", &[UNKNOWN_UNITS]).await;
        // The same for the tolerance: 1in and 1.02in differ by 0.02in
        // (0.508mm), and the raw tolerance 0.1 is used, not 0.1mm.
        assert_passes_in(
            "mm",
            "assert(1in, isEqualTo = 1.02in, tolerance = 0.1)",
            &[UNKNOWN_UNITS],
        )
        .await;
        assert_fails_with(
            "assert(1in, isEqualTo = 1.2in, tolerance = 0.1)",
            &["Expected 1in to be equal to 1.2in using tolerance 0.1 (its units could not be converted, so the raw number 0.1 was used) but it wasn't"],
        )
        .await;

        // In an inch file, numbers without units match inches, not mm.
        assert_passes_in("in", "assert(1in, isEqualTo = 1, tolerance = 0.001)", &[]).await;
        assert_passes_in("in", "assert(25.4mm, isEqualTo = 1in)", &[]).await;
        assert_fails_in(
            "in",
            "assert(25.4mm, isLessThan = 2)",
            &["Expected 25.4 to be less than 2 but it wasn't"],
        )
        .await;
        assert_passes_in("in", "assert(25.4mm, isGreaterThan = 2)", &[UNKNOWN_UNITS]).await;

        // A count matches a plain number, but never a length.
        assert_passes_in("mm", "assert(2_, isEqualTo = 2)", &[]).await;
        assert_passes_in("mm", "assert(2_, isEqualTo = 2mm)", &[UNKNOWN_UNITS]).await;
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn assert_warns_about_angles_without_units_like_the_operators() {
        // A number without units against degrees gets the operators' angle
        // warning, not the unknown-units one. The bound and the tolerance are
        // each checked, so today the same warning is reported once for each.
        for version in KCL_VERSIONS {
            let code = "assert(90deg, isEqualTo = 90, tolerance = 0.1)";
            let warnings = run("mm", version, code).await.unwrap();
            assert!(
                !warnings.is_empty() && warnings.iter().all(|w| w.contains(ANGLE_UNITS)),
                "expected only angle warnings, got {warnings:?} under KCL {version} for:\n{code}"
            );
        }
    }
}
