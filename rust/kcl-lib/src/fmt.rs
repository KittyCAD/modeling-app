use serde::Serialize;

use crate::{execution::types::NumericType, pretty::NumericSuffix};

/// For the UI, display a number and its type for debugging purposes. This is
/// used by TS.
pub fn human_display_number(value: f64, ty: NumericType) -> String {
    match ty {
        NumericType::Known(unit_type) => format!("{value}: number({unit_type})"),
        NumericType::Default { len, angle } => format!("{value} (no units, defaulting to {len} or {angle})"),
        NumericType::Unknown => format!("{value} (number with unknown units)"),
        NumericType::Any => format!("{value} (number with any units)"),
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, thiserror::Error)]
#[serde(tag = "type")]
pub enum FormatNumericSuffixError {
    #[error("Invalid numeric suffix: {0}")]
    Invalid(NumericSuffix),
}

/// For UI code generation, format a number with a suffix. The result must parse
/// as a literal. If it can't be done, returns an error.
///
/// This is used by TS.
pub fn format_number_literal(value: f64, suffix: NumericSuffix) -> Result<String, FormatNumericSuffixError> {
    match suffix {
        // There isn't a syntactic suffix for these. For unknown, we don't want
        // to ever generate the unknown suffix. We currently warn on it, and we
        // may remove it in the future.
        NumericSuffix::Length | NumericSuffix::Angle | NumericSuffix::Unknown => {
            Err(FormatNumericSuffixError::Invalid(suffix))
        }
        NumericSuffix::None
        | NumericSuffix::Count
        | NumericSuffix::Mm
        | NumericSuffix::Cm
        | NumericSuffix::M
        | NumericSuffix::Inch
        | NumericSuffix::Ft
        | NumericSuffix::Yd
        | NumericSuffix::Deg
        | NumericSuffix::Rad => Ok(format!("{value}{suffix}")),
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, thiserror::Error)]
#[serde(tag = "type")]
pub enum FormatNumericTypeError {
    #[error("Invalid numeric type: {0:?}")]
    Invalid(NumericType),
}

/// For UI code generation, format a number value with a suffix such that the
/// result can parse as a literal. If it can't be done, returns an error.
///
/// This is used by TS.
pub fn format_number_value(value: f64, ty: NumericType) -> Result<String, FormatNumericTypeError> {
    match ty {
        NumericType::Default { .. } => Ok(value.to_string()),
        // There isn't a syntactic suffix for these. For unknown, we don't want
        // to ever generate the unknown suffix. We currently warn on it, and we
        // may remove it in the future.
        NumericType::Unknown | NumericType::Any => Err(FormatNumericTypeError::Invalid(ty)),
        NumericType::Known(unit_type) => unit_type
            .to_suffix()
            .map(|suffix| format!("{value}{suffix}"))
            .ok_or(FormatNumericTypeError::Invalid(ty)),
    }
}

#[cfg(test)]
mod tests {
    use kittycad_modeling_cmds::units::{UnitAngle, UnitLength};
    use pretty_assertions::assert_eq;

    use super::*;
    use crate::execution::types::UnitType;

    #[test]
    fn test_human_display_number() {
        assert_eq!(
            human_display_number(1.0, NumericType::Known(UnitType::Count)),
            "1: number(Count)"
        );
        assert_eq!(
            human_display_number(1.0, NumericType::Known(UnitType::Length(UnitLength::Meters))),
            "1: number(m)"
        );
        assert_eq!(
            human_display_number(1.0, NumericType::Known(UnitType::Length(UnitLength::Millimeters))),
            "1: number(mm)"
        );
        assert_eq!(
            human_display_number(1.0, NumericType::Known(UnitType::Length(UnitLength::Inches))),
            "1: number(in)"
        );
        assert_eq!(
            human_display_number(1.0, NumericType::Known(UnitType::Length(UnitLength::Feet))),
            "1: number(ft)"
        );
        assert_eq!(
            human_display_number(1.0, NumericType::Known(UnitType::Angle(UnitAngle::Degrees))),
            "1: number(deg)"
        );
        assert_eq!(
            human_display_number(1.0, NumericType::Known(UnitType::Angle(UnitAngle::Radians))),
            "1: number(rad)"
        );
        assert_eq!(
            human_display_number(
                1.0,
                NumericType::Default {
                    len: UnitLength::Millimeters,
                    angle: UnitAngle::Degrees,
                }
            ),
            "1 (no units, defaulting to mm or deg)"
        );
        assert_eq!(
            human_display_number(
                1.0,
                NumericType::Default {
                    len: UnitLength::Feet,
                    angle: UnitAngle::Radians,
                }
            ),
            "1 (no units, defaulting to ft or rad)"
        );
        assert_eq!(
            human_display_number(1.0, NumericType::Unknown),
            "1 (number with unknown units)"
        );
        assert_eq!(human_display_number(1.0, NumericType::Any), "1 (number with any units)");
    }

    #[test]
    fn test_format_number_literal() {
        assert_eq!(
            format_number_literal(1.0, NumericSuffix::Length),
            Err(FormatNumericSuffixError::Invalid(NumericSuffix::Length))
        );
        assert_eq!(
            format_number_literal(1.0, NumericSuffix::Angle),
            Err(FormatNumericSuffixError::Invalid(NumericSuffix::Angle))
        );
        assert_eq!(format_number_literal(1.0, NumericSuffix::None), Ok("1".to_owned()));
        assert_eq!(format_number_literal(1.0, NumericSuffix::Count), Ok("1_".to_owned()));
        assert_eq!(format_number_literal(1.0, NumericSuffix::Mm), Ok("1mm".to_owned()));
        assert_eq!(format_number_literal(1.0, NumericSuffix::Cm), Ok("1cm".to_owned()));
        assert_eq!(format_number_literal(1.0, NumericSuffix::M), Ok("1m".to_owned()));
        assert_eq!(format_number_literal(1.0, NumericSuffix::Inch), Ok("1in".to_owned()));
        assert_eq!(format_number_literal(1.0, NumericSuffix::Ft), Ok("1ft".to_owned()));
        assert_eq!(format_number_literal(1.0, NumericSuffix::Yd), Ok("1yd".to_owned()));
        assert_eq!(format_number_literal(1.0, NumericSuffix::Deg), Ok("1deg".to_owned()));
        assert_eq!(format_number_literal(1.0, NumericSuffix::Rad), Ok("1rad".to_owned()));
        assert_eq!(
            format_number_literal(1.0, NumericSuffix::Unknown),
            Err(FormatNumericSuffixError::Invalid(NumericSuffix::Unknown))
        );
    }

    #[test]
    fn test_format_number_value() {
        assert_eq!(
            format_number_value(
                1.0,
                NumericType::Default {
                    len: UnitLength::Millimeters,
                    angle: UnitAngle::Degrees,
                }
            ),
            Ok("1".to_owned())
        );
        assert_eq!(
            format_number_value(1.0, NumericType::Known(UnitType::GenericLength)),
            Err(FormatNumericTypeError::Invalid(NumericType::Known(
                UnitType::GenericLength
            )))
        );
        assert_eq!(
            format_number_value(1.0, NumericType::Known(UnitType::GenericAngle)),
            Err(FormatNumericTypeError::Invalid(NumericType::Known(
                UnitType::GenericAngle
            )))
        );
        assert_eq!(
            format_number_value(1.0, NumericType::Known(UnitType::Count)),
            Ok("1_".to_owned())
        );
        assert_eq!(
            format_number_value(1.0, NumericType::Known(UnitType::Length(UnitLength::Millimeters))),
            Ok("1mm".to_owned())
        );
        assert_eq!(
            format_number_value(1.0, NumericType::Known(UnitType::Length(UnitLength::Centimeters))),
            Ok("1cm".to_owned())
        );
        assert_eq!(
            format_number_value(1.0, NumericType::Known(UnitType::Length(UnitLength::Meters))),
            Ok("1m".to_owned())
        );
        assert_eq!(
            format_number_value(1.0, NumericType::Known(UnitType::Length(UnitLength::Inches))),
            Ok("1in".to_owned())
        );
        assert_eq!(
            format_number_value(1.0, NumericType::Known(UnitType::Length(UnitLength::Feet))),
            Ok("1ft".to_owned())
        );
        assert_eq!(
            format_number_value(1.0, NumericType::Known(UnitType::Length(UnitLength::Yards))),
            Ok("1yd".to_owned())
        );
        assert_eq!(
            format_number_value(1.0, NumericType::Known(UnitType::Angle(UnitAngle::Degrees))),
            Ok("1deg".to_owned())
        );
        assert_eq!(
            format_number_value(1.0, NumericType::Known(UnitType::Angle(UnitAngle::Radians))),
            Ok("1rad".to_owned())
        );
        assert_eq!(
            format_number_value(1.0, NumericType::Unknown),
            Err(FormatNumericTypeError::Invalid(NumericType::Unknown))
        );
        assert_eq!(
            format_number_value(1.0, NumericType::Any),
            Err(FormatNumericTypeError::Invalid(NumericType::Any))
        );
    }
}
