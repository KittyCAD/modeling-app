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
/// const depth = 10
/// const rackWidth = 100
/// const toothSize = 10
///
/// const rackSketch = startSketchOn('XZ')
///   |> startProfileAt([0.35, 0], %)
///   |> angledLine([0, rackWidth], %, $rectangleSegmentA001)
///   |> angledLine([
///        segAng(rectangleSegmentA001, %) + 90,
///        10.34
///      ], %, $rectangleSegmentB001)
///   |> angledLine([
///        segAng(rectangleSegmentA001, %),
///        -segLen(rectangleSegmentA001, %)
///      ], %, $rectangleSegmentC001)
///   |> lineTo([profileStartX(%), profileStartY(%)], %, $rectangleSegmentD001)
///   |> close(%)
///
/// const toothSketch = startSketchOn('XZ')
///   |> startProfileAt([
///        segEndX(rectangleSegmentC001, rackSketch),
///        segEndY(rectangleSegmentC001, rackSketch)
///      ], %)
///   |> angledLine({
///        angle: segAng(rectangleSegmentC001, rackSketch),
///        length: -toothSize
///      }, %, $tag001)
///   |> angledLine({
///        angle: segAng(tag001, %) + 120,
///        length: segLen(tag001, %)
///      }, %, $tag002)
///   |> angledLine({
///        angle: segAng(tag002, %) + 120,
///        length: segLen(tag002, %)
///      }, %, $tag003)
///   |> close(%)
///
/// const rack = extrude(depth, rackSketch)
/// const tooth = extrude(depth, toothSketch)
///
/// const teeth = patternTransform(int(rackWidth / toothSize), (index) => {
///   const offset = toothSize * index
///   return {
///     translate: [
///       offset * cos(segAng(rectangleSegmentA001, rackSketch)),
///       0,
///       offset * sin(segAng(rectangleSegmentA001, rackSketch))
///     ]
///   }
/// }, tooth)
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
