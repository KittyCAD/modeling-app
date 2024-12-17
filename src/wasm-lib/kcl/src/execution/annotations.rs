//! Data on available annotations.

use super::kcl_value::{UnitAngle, UnitLen};
use crate::{
    errors::KclErrorDetails,
    parsing::ast::types::{Expr, Node, NonCodeValue, ObjectProperty},
    KclError, SourceRange,
};

pub(super) const SETTINGS: &str = "settings";
pub(super) const SETTINGS_UNIT_LENGTH: &str = "defaultLengthUnit";
pub(super) const SETTINGS_UNIT_ANGLE: &str = "defaultAngleUnit";

pub(super) fn expect_properties<'a>(
    for_key: &'static str,
    annotation: &'a NonCodeValue,
    source_range: SourceRange,
) -> Result<&'a [Node<ObjectProperty>], KclError> {
    match annotation {
        NonCodeValue::Annotation { name, properties } => {
            assert_eq!(name.name, for_key);
            Ok(&**properties.as_ref().ok_or_else(|| {
                KclError::Semantic(KclErrorDetails {
                    message: format!("Empty `{for_key}` annotation"),
                    source_ranges: vec![source_range],
                })
            })?)
        }
        _ => unreachable!(),
    }
}

pub(super) fn expect_ident(expr: &Expr) -> Result<&str, KclError> {
    match expr {
        Expr::Identifier(id) => Ok(&id.name),
        e => Err(KclError::Semantic(KclErrorDetails {
            message: "Unexpected settings value, expected a simple name, e.g., `mm`".to_owned(),
            source_ranges: vec![e.into()],
        })),
    }
}

impl UnitLen {
    pub(super) fn from_str(s: &str, source_range: SourceRange) -> Result<Self, KclError> {
        match s {
            "mm" => Ok(UnitLen::Mm),
            "cm" => Ok(UnitLen::Cm),
            "m" => Ok(UnitLen::M),
            "inch" | "in" => Ok(UnitLen::Inches),
            "ft" => Ok(UnitLen::Feet),
            "yd" => Ok(UnitLen::Yards),
            value => Err(KclError::Semantic(KclErrorDetails {
                message: format!(
                    "Unexpected settings value: `{value}`; expected one of `mm`, `cm`, `m`, `inch`, `ft`, `yd`"
                ),
                source_ranges: vec![source_range],
            })),
        }
    }
}

impl UnitAngle {
    pub(super) fn from_str(s: &str, source_range: SourceRange) -> Result<Self, KclError> {
        match s {
            "deg" => Ok(UnitAngle::Degrees),
            "rad" => Ok(UnitAngle::Radians),
            value => Err(KclError::Semantic(KclErrorDetails {
                message: format!("Unexpected settings value: `{value}`; expected one of `deg`, `rad`"),
                source_ranges: vec![source_range],
            })),
        }
    }
}
