//! Conversions between types.

use derive_docs::stdlib;
use schemars::JsonSchema;

use crate::{
    errors::{KclError, KclErrorDetails},
    executor::MemoryItem,
    std::Args,
};

#[derive(Debug, PartialEq, Eq)]
enum ConversionError {
    Nan,
    TooLarge,
}

/// Converts a number to integer.
pub async fn int(args: Args) -> Result<MemoryItem, KclError> {
    let num = args.get_number()?;
    let converted = inner_int(num).map_err(|err| match err {
        ConversionError::Nan => KclError::Semantic(KclErrorDetails {
            message: "NaN cannot be converted to an integer".to_owned(),
            source_ranges: vec![args.source_range.clone()],
        }),
        ConversionError::TooLarge => KclError::Semantic(KclErrorDetails {
            message: "Number is too large to convert to integer".to_owned(),
            source_ranges: vec![args.source_range.clone()],
        }),
    })?;

    args.make_user_val_from_i32(converted)
}

/// Converts a number to an integer.
///
/// Callers should use floor(), ceil(), or other rounding function first if they
/// care about how numbers with fractional parts are converted.  If the number
/// has a fractional part, it's truncated, moving the number towards zero.
///
/// ```no_run
/// const sketch001 = startSketchOn('XZ')
///   |> circle([0, 0], 2, %)
/// const extrude001 = extrude(5, sketch001)
///
/// const pattern01 = patternTransform(int(ceil(5 / 2)), (id) => {
///   return { translate: [4 * id, 0, 0] }
/// }, extrude001)
/// ```
#[stdlib {
    name = "int",
    tags = ["convert"],
}]
fn inner_int(num: f64) -> Result<i32, ConversionError> {
    if num.is_nan() {
        return Err(ConversionError::Nan);
    } else if num > f64::from(i32::MAX) || num < f64::from(i32::MIN) {
        return Err(ConversionError::TooLarge);
    }

    Ok(num as i32)
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
        assert_eq!(inner_int(1e32 - 1.0), Err(ConversionError::TooLarge));
        assert_eq!(inner_int(-1e32), Err(ConversionError::TooLarge));
    }
}
