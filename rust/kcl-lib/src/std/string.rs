//! Standard library string operations.

use crate::errors::KclError;
use crate::errors::KclErrorDetails;
use crate::execution::ExecState;
use crate::execution::KclValue;
use crate::execution::types::NumericType;
use crate::execution::types::RuntimeType;
use crate::std::Args;
use crate::std::args::TyF64;

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

/// Remove whitespace from the start of a string.
pub async fn trim_start(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let text: String = args.get_unlabeled_kw_arg("text", &RuntimeType::string(), exec_state)?;
    let value = trim_whitespace(&text, true, false).to_owned();

    Ok(KclValue::String {
        value,
        meta: args.into(),
    })
}

/// Remove whitespace from the end of a string.
pub async fn trim_end(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let text: String = args.get_unlabeled_kw_arg("text", &RuntimeType::string(), exec_state)?;
    let value = trim_whitespace(&text, false, true).to_owned();

    Ok(KclValue::String {
        value,
        meta: args.into(),
    })
}

/// An infinity or a NaN, which KCL has no literal syntax for and so cannot be
/// written as source. Holds the label to show the user.
#[derive(Debug, PartialEq, Eq)]
struct NonFiniteNumber(&'static str);

/// Render a number the way it would be written in KCL source.
///
/// The numeric text is the shortest form that reads back as the same `f64`, so
/// the result round-trips through the parser. A suffix is appended only when
/// the concrete unit is known; when it is not, the bare number is all that can
/// be said truthfully about the value, so that is what callers get.
///
/// Deliberately not built on its near twin `crate::fmt::format_number_value`:
/// - that function errors on `Unknown`, `Any`, `GenericLength`, and
///   `GenericAngle`; this one returns the bare number.
/// - that function has no non-finite handling: an infinity or a NaN formats as
///   `inf` or `NaN`, which KCL cannot parse.
fn format_number(n: f64, ty: NumericType) -> Result<String, NonFiniteNumber> {
    if n.is_nan() {
        return Err(NonFiniteNumber("NaN"));
    }
    if n.is_infinite() {
        return Err(NonFiniteNumber(if n.is_sign_positive() {
            "Infinity"
        } else {
            "-Infinity"
        }));
    }

    let n = crate::fmt::normalize_negative_zero(n);
    let suffix = match ty {
        // `to_suffix` yields nothing for the generic length and angle types,
        // which is the same "units unclear" case as the arms below.
        NumericType::Known(unit_type) => unit_type.to_suffix().unwrap_or_default(),
        NumericType::Default { .. } | NumericType::Unknown | NumericType::Any => String::new(),
    };

    Ok(format!("{n}{suffix}"))
}

/// Convert a number to text that reads like KCL source.
pub async fn number_to_string(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    // Reading the argument as `Any` preserves whatever numeric type it already
    // has rather than erasing it, which is what the suffix depends on.
    let num: TyF64 = args.get_unlabeled_kw_arg("num", &RuntimeType::num_any(), exec_state)?;

    let value = format_number(num.n, num.ty).map_err(|NonFiniteNumber(label)| {
        KclError::new_type(KclErrorDetails::new(
            format!("Cannot convert a non-finite number to a string: {label}"),
            vec![args.source_range],
        ))
    })?;

    Ok(KclValue::String {
        value,
        meta: args.into(),
    })
}

#[cfg(test)]
mod tests {
    use kcl_api::UnitAngle;
    use kcl_api::UnitLength;
    use pretty_assertions::assert_eq;

    use super::*;
    use crate::execution::types::UnitType;

    /// The unitless default, as a value with no explicit suffix acquires.
    fn default_units() -> NumericType {
        NumericType::Default {
            len: UnitLength::Millimeters,
            angle: UnitAngle::Degrees,
        }
    }

    fn length(len: UnitLength) -> NumericType {
        NumericType::Known(UnitType::Length(len))
    }

    fn angle(angle: UnitAngle) -> NumericType {
        NumericType::Known(UnitType::Angle(angle))
    }

    #[test]
    fn format_number_covers_every_numeric_type() {
        for (name, n, ty, expected) in [
            // Unitless and default: no suffix.
            ("default integer", 12.0, default_units(), "12"),
            ("default fractional", 1.5, default_units(), "1.5"),
            ("default negative", -7.0, default_units(), "-7"),
            ("default zero", 0.0, default_units(), "0"),
            // Negative zero is normalized, so it prints like positive zero.
            ("negative zero", -0.0, default_units(), "0"),
            (
                "negative zero with a unit",
                -0.0,
                length(UnitLength::Millimeters),
                "0mm",
            ),
            // Counts keep the `_` suffix.
            ("count", 3.0, NumericType::Known(UnitType::Count), "3_"),
            ("count fractional", 2.5, NumericType::Known(UnitType::Count), "2.5_"),
            ("count negative", -4.0, NumericType::Known(UnitType::Count), "-4_"),
            // Every concrete length unit keeps its canonical suffix.
            ("millimeters", 12.0, length(UnitLength::Millimeters), "12mm"),
            ("centimeters", 12.0, length(UnitLength::Centimeters), "12cm"),
            ("meters", 12.0, length(UnitLength::Meters), "12m"),
            ("inches", 1.5, length(UnitLength::Inches), "1.5in"),
            ("feet", 2.0, length(UnitLength::Feet), "2ft"),
            ("yards", 3.0, length(UnitLength::Yards), "3yd"),
            ("negative length", -5.0, length(UnitLength::Millimeters), "-5mm"),
            // Both concrete angle units keep their canonical suffix.
            ("degrees", 90.0, angle(UnitAngle::Degrees), "90deg"),
            ("radians", 1.5, angle(UnitAngle::Radians), "1.5rad"),
            // Units the type system cannot pin down: the bare number is all
            // that can be said truthfully, so no suffix is emitted.
            (
                "generic length",
                12.0,
                NumericType::Known(UnitType::GenericLength),
                "12",
            ),
            ("generic angle", 90.0, NumericType::Known(UnitType::GenericAngle), "90"),
            ("unknown", 20.0, NumericType::Unknown, "20"),
            ("any", 12.0, NumericType::Any, "12"),
        ] {
            assert_eq!(format_number(n, ty).unwrap(), expected, "case: {name}");
        }
    }

    #[test]
    fn format_number_rejects_non_finite_values() {
        // The finiteness check runs before the suffix is chosen, so a unit on
        // the value cannot smuggle an infinity through.
        for (name, n, ty, expected) in [
            ("positive infinity", f64::INFINITY, default_units(), "Infinity"),
            ("negative infinity", f64::NEG_INFINITY, default_units(), "-Infinity"),
            ("nan", f64::NAN, default_units(), "NaN"),
            (
                "infinity with a unit",
                f64::INFINITY,
                length(UnitLength::Millimeters),
                "Infinity",
            ),
            ("nan with a unit", f64::NAN, angle(UnitAngle::Degrees), "NaN"),
            ("nan as a count", f64::NAN, NumericType::Known(UnitType::Count), "NaN"),
        ] {
            assert_eq!(
                format_number(n, ty).unwrap_err(),
                NonFiniteNumber(expected),
                "case: {name}"
            );
        }
    }

    #[test]
    fn format_number_round_trips_through_f64() {
        // The rendered text must read back as bit-identical to what went in,
        // which is why no rounding or precision parameter exists.
        for (name, n) in [
            ("one tenth", 0.1),
            ("sum that is not exact", 0.1 + 0.2),
            ("one third", 1.0 / 3.0),
            ("largest finite", f64::MAX),
            ("smallest positive normal", f64::MIN_POSITIVE),
            ("smallest subnormal", f64::from_bits(1)),
            ("large magnitude", 1e300),
            ("small magnitude", 1e-300),
            ("negative fractional", -123.456),
        ] {
            let text = format_number(n, default_units()).unwrap();
            let reparsed: f64 = text.parse().unwrap();
            assert_eq!(reparsed.to_bits(), n.to_bits(), "case: {name}, rendered as {text}");
        }
    }

    #[test]
    fn format_number_loses_the_sign_of_negative_zero() {
        // Deliberate: `-0` and `0` are the same quantity, and the existing
        // formatter for generated KCL already normalizes the sign away. This is
        // the one value that does not round-trip bit-for-bit.
        let text = format_number(-0.0, default_units()).unwrap();
        assert_eq!(text, "0");

        let reparsed: f64 = text.parse().unwrap();
        assert_eq!(reparsed.to_bits(), 0.0_f64.to_bits());
        assert_ne!(reparsed.to_bits(), (-0.0_f64).to_bits());
    }

    #[test]
    fn format_number_never_uses_exponent_notation() {
        // KCL number literals have no exponent form, so output that used one
        // would not parse as KCL even though it parses as a Rust float.
        for (name, n) in [
            ("large magnitude", 1e300),
            ("small magnitude", 1e-300),
            ("largest finite", f64::MAX),
            ("smallest subnormal", f64::from_bits(1)),
        ] {
            let text = format_number(n, default_units()).unwrap();
            assert!(!text.contains('e'), "case: {name}, rendered as {text}");
            assert!(!text.contains('E'), "case: {name}, rendered as {text}");
        }
    }
}
