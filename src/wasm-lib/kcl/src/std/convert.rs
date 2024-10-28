//! Conversions between types.

use derive_docs::stdlib;

use crate::{
    errors::{KclError, KclErrorDetails},
    executor::{ExecState, KclValue, SourceRange},
    std::Args,
};

#[derive(Debug, PartialEq, Eq)]
enum ConversionError {
    Nan,
    TooLarge,
}

impl ConversionError {
    pub fn into_kcl_error(self, source_range: SourceRange) -> KclError {
        match self {
            ConversionError::Nan => KclError::Semantic(KclErrorDetails {
                message: "NaN cannot be converted to an integer".to_owned(),
                source_ranges: vec![source_range],
            }),
            ConversionError::TooLarge => KclError::Semantic(KclErrorDetails {
                message: "Number is too large to convert to integer".to_owned(),
                source_ranges: vec![source_range],
            }),
        }
    }
}

/// Converts a number to integer.
pub async fn int(_exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let num = args.get_number()?;
    let converted = inner_int(num).map_err(|err| err.into_kcl_error(args.source_range))?;

    args.make_user_val_from_i64(converted)
}

/// Convert a number to an integer.
///
/// Callers should use floor(), ceil(), or other rounding function first if they
/// care about how numbers with fractional parts are converted.  If the number
/// has a fractional part, it's truncated, moving the number towards zero.
///
/// If the number is NaN or has a magnitude, either positive or negative, that
/// is too large to fit into the internal integer representation, the result is
/// a runtime error.
///
/// ```no_run
/// let n = int(ceil(5/2))
/// assertEqual(n, 3, 0.0001, "5/2 = 2.5, rounded up makes 3")
/// // Draw n cylinders.
/// startSketchOn('XZ')
///   |> circle({ center: [0, 0], radius: 2 }, %)
///   |> extrude(5, %)
///   |> patternTransform(n, (id) => {
///   return { translate: [4 * id, 0, 0] }
/// }, %)
/// ```
#[stdlib {
    name = "int",
    tags = ["convert"],
}]
fn inner_int(num: f64) -> Result<i64, ConversionError> {
    if num.is_nan() {
        return Err(ConversionError::Nan);
    }
    if num > 2_f64.powi(53) || num < -(2_f64.powi(53)) {
        // 2^53 is the largest magnitude integer that can be represented in f64
        // and accurately converted.
        return Err(ConversionError::TooLarge);
    }

    Ok(num as i64)
}

#[cfg(test)]
mod tests {
    use core::f64;

    use pretty_assertions::assert_eq;

    use super::*;

    #[test]
    fn test_inner_int() {
        assert_eq!(inner_int(0.0), Ok(0));
        assert_eq!(inner_int(-0.0), Ok(0));
        assert_eq!(inner_int(3.0), Ok(3));
        assert_eq!(inner_int(2.5), Ok(2));
        assert_eq!(inner_int(-2.5), Ok(-2));
        assert_eq!(inner_int(f64::NAN), Err(ConversionError::Nan));
        assert_eq!(inner_int(f64::INFINITY), Err(ConversionError::TooLarge));
        assert_eq!(inner_int(f64::NEG_INFINITY), Err(ConversionError::TooLarge));
        assert_eq!(inner_int(2_f64.powi(53)), Ok(2_i64.pow(53)));
        assert_eq!(inner_int(-(2_f64.powi(53))), Ok(-(2_i64.pow(53))));
        // Note: 2_f64.powi(53) + 1.0 can't be represented.
        assert_eq!(inner_int(2_f64.powi(53) + 2.0), Err(ConversionError::TooLarge));
        assert_eq!(inner_int(-(2_f64.powi(53)) - 2.0), Err(ConversionError::TooLarge));
        assert_eq!(inner_int(-(2_f64.powi(64))), Err(ConversionError::TooLarge));
    }
}
