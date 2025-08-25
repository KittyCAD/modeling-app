//! Data on available annotations.

use std::str::FromStr;

use kittycad_modeling_cmds::coord::{KITTYCAD, OPENGL, System, VULKAN};
use serde::{Deserialize, Serialize};

use crate::{
    KclError, SourceRange,
    errors::{KclErrorDetails, Severity},
    execution::types::{UnitAngle, UnitLen},
    parsing::ast::types::{Annotation, Expr, LiteralValue, Node, ObjectProperty},
};

/// Annotations which should cause re-execution if they change.
pub(super) const SIGNIFICANT_ATTRS: [&str; 3] = [SETTINGS, NO_PRELUDE, WARNINGS];

pub(crate) const SETTINGS: &str = "settings";
pub(crate) const SETTINGS_UNIT_LENGTH: &str = "defaultLengthUnit";
pub(crate) const SETTINGS_UNIT_ANGLE: &str = "defaultAngleUnit";
pub(crate) const SETTINGS_VERSION: &str = "kclVersion";
pub(crate) const SETTINGS_EXPERIMENTAL_FEATURES: &str = "experimentalFeatures";

pub(super) const NO_PRELUDE: &str = "no_std";
pub(crate) const DEPRECATED: &str = "deprecated";
pub(crate) const EXPERIMENTAL: &str = "experimental";

pub(super) const IMPORT_FORMAT: &str = "format";
pub(super) const IMPORT_COORDS: &str = "coords";
pub(super) const IMPORT_COORDS_VALUES: [(&str, &System); 3] =
    [("zoo", KITTYCAD), ("opengl", OPENGL), ("vulkan", VULKAN)];
pub(super) const IMPORT_LENGTH_UNIT: &str = "lengthUnit";

pub(crate) const IMPL: &str = "impl";
pub(crate) const IMPL_RUST: &str = "std_rust";
pub(crate) const IMPL_KCL: &str = "kcl";
pub(crate) const IMPL_PRIMITIVE: &str = "primitive";
pub(super) const IMPL_VALUES: [&str; 3] = [IMPL_RUST, IMPL_KCL, IMPL_PRIMITIVE];

pub(crate) const WARNINGS: &str = "warnings";
pub(crate) const WARN_ALLOW: &str = "allow";
pub(crate) const WARN_DENY: &str = "deny";
pub(crate) const WARN_WARN: &str = "warn";
pub(super) const WARN_LEVELS: [&str; 3] = [WARN_ALLOW, WARN_DENY, WARN_WARN];
pub(crate) const WARN_UNKNOWN_UNITS: &str = "unknownUnits";
pub(crate) const WARN_UNKNOWN_ATTR: &str = "unknownAttribute";
pub(crate) const WARN_MOD_RETURN_VALUE: &str = "moduleReturnValue";
pub(crate) const WARN_DEPRECATED: &str = "deprecated";
pub(crate) const WARN_IGNORED_Z_AXIS: &str = "ignoredZAxis";
pub(crate) const WARN_UNNECESSARY_CLOSE: &str = "unnecessaryClose";
pub(super) const WARN_VALUES: [&str; 6] = [
    WARN_UNKNOWN_UNITS,
    WARN_UNKNOWN_ATTR,
    WARN_MOD_RETURN_VALUE,
    WARN_DEPRECATED,
    WARN_IGNORED_Z_AXIS,
    WARN_UNNECESSARY_CLOSE,
];

#[derive(Clone, Copy, Eq, PartialEq, Debug, Deserialize, Serialize, ts_rs::TS)]
pub enum WarningLevel {
    Allow,
    Warn,
    Deny,
}

impl WarningLevel {
    pub(crate) fn severity(self) -> Option<Severity> {
        match self {
            WarningLevel::Allow => None,
            WarningLevel::Warn => Some(Severity::Warning),
            WarningLevel::Deny => Some(Severity::Error),
        }
    }
}

impl FromStr for WarningLevel {
    type Err = ();

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            WARN_ALLOW => Ok(Self::Allow),
            WARN_WARN => Ok(Self::Warn),
            WARN_DENY => Ok(Self::Deny),
            _ => Err(()),
        }
    }
}

#[derive(Clone, Copy, Eq, PartialEq, Debug, Default)]
pub enum Impl {
    #[default]
    Kcl,
    Rust,
    Primitive,
}

impl FromStr for Impl {
    type Err = ();

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            IMPL_RUST => Ok(Self::Rust),
            IMPL_KCL => Ok(Self::Kcl),
            IMPL_PRIMITIVE => Ok(Self::Primitive),
            _ => Err(()),
        }
    }
}

pub(crate) fn settings_completion_text() -> String {
    format!("@{SETTINGS}({SETTINGS_UNIT_LENGTH} = mm, {SETTINGS_UNIT_ANGLE} = deg, {SETTINGS_VERSION} = 1.0)")
}

pub(super) fn is_significant(attr: &&Node<Annotation>) -> bool {
    match attr.name() {
        Some(name) => SIGNIFICANT_ATTRS.contains(&name),
        None => true,
    }
}

pub(super) fn expect_properties<'a>(
    for_key: &'static str,
    annotation: &'a Node<Annotation>,
) -> Result<&'a [Node<ObjectProperty>], KclError> {
    assert_eq!(annotation.name().unwrap(), for_key);
    Ok(&**annotation.properties.as_ref().ok_or_else(|| {
        KclError::new_semantic(KclErrorDetails::new(
            format!("Empty `{for_key}` annotation"),
            vec![annotation.as_source_range()],
        ))
    })?)
}

pub(super) fn expect_ident(expr: &Expr) -> Result<&str, KclError> {
    if let Expr::Name(name) = expr
        && let Some(name) = name.local_ident()
    {
        return Ok(*name);
    }

    Err(KclError::new_semantic(KclErrorDetails::new(
        "Unexpected settings value, expected a simple name, e.g., `mm`".to_owned(),
        vec![expr.into()],
    )))
}

pub(super) fn many_of(
    expr: &Expr,
    of: &[&'static str],
    source_range: SourceRange,
) -> Result<Vec<&'static str>, KclError> {
    const UNEXPECTED_MSG: &str = "Unexpected warnings value, expected a name or array of names, e.g., `unknownUnits` or `[unknownUnits, deprecated]`";

    let values = match expr {
        Expr::Name(name) => {
            if let Some(name) = name.local_ident() {
                vec![*name]
            } else {
                return Err(KclError::new_semantic(KclErrorDetails::new(
                    UNEXPECTED_MSG.to_owned(),
                    vec![expr.into()],
                )));
            }
        }
        Expr::ArrayExpression(e) => {
            let mut result = Vec::new();
            for e in &e.elements {
                if let Expr::Name(name) = e
                    && let Some(name) = name.local_ident()
                {
                    result.push(*name);
                    continue;
                }
                return Err(KclError::new_semantic(KclErrorDetails::new(
                    UNEXPECTED_MSG.to_owned(),
                    vec![e.into()],
                )));
            }
            result
        }
        _ => {
            return Err(KclError::new_semantic(KclErrorDetails::new(
                UNEXPECTED_MSG.to_owned(),
                vec![expr.into()],
            )));
        }
    };

    values
        .into_iter()
        .map(|v| {
            of.iter()
                .find(|vv| **vv == v)
                .ok_or_else(|| {
                    KclError::new_semantic(KclErrorDetails::new(
                        format!("Unexpected warning value: `{v}`; accepted values: {}", of.join(", "),),
                        vec![source_range],
                    ))
                })
                .copied()
        })
        .collect::<Result<Vec<&str>, KclError>>()
}

// Returns the unparsed number literal.
pub(super) fn expect_number(expr: &Expr) -> Result<String, KclError> {
    if let Expr::Literal(lit) = expr
        && let LiteralValue::Number { .. } = &lit.value
    {
        return Ok(lit.raw.clone());
    }

    Err(KclError::new_semantic(KclErrorDetails::new(
        "Unexpected settings value, expected a number, e.g., `1.0`".to_owned(),
        vec![expr.into()],
    )))
}

#[derive(Debug, Clone, Copy, Eq, PartialEq, Default)]
pub struct FnAttrs {
    pub impl_: Impl,
    pub deprecated: bool,
    pub experimental: bool,
}

pub(super) fn get_fn_attrs(
    annotations: &[Node<Annotation>],
    source_range: SourceRange,
) -> Result<Option<FnAttrs>, KclError> {
    let mut result = None;
    for attr in annotations {
        if attr.name.is_some() || attr.properties.is_none() {
            continue;
        }
        for p in attr.properties.as_ref().unwrap() {
            if &*p.key.name == IMPL
                && let Some(s) = p.value.ident_name()
            {
                if result.is_none() {
                    result = Some(FnAttrs::default());
                }

                result.as_mut().unwrap().impl_ = Impl::from_str(s).map_err(|_| {
                    KclError::new_semantic(KclErrorDetails::new(
                        format!(
                            "Invalid value for {} attribute, expected one of: {}",
                            IMPL,
                            IMPL_VALUES.join(", ")
                        ),
                        vec![source_range],
                    ))
                })?;
                continue;
            }

            if &*p.key.name == DEPRECATED
                && let Some(b) = p.value.literal_bool()
            {
                if result.is_none() {
                    result = Some(FnAttrs::default());
                }
                result.as_mut().unwrap().deprecated = b;
                continue;
            }

            if &*p.key.name == EXPERIMENTAL
                && let Some(b) = p.value.literal_bool()
            {
                if result.is_none() {
                    result = Some(FnAttrs::default());
                }
                result.as_mut().unwrap().experimental = b;
                continue;
            }

            return Err(KclError::new_semantic(KclErrorDetails::new(
                format!(
                    "Invalid attribute, expected one of: {IMPL}, {DEPRECATED}, {EXPERIMENTAL}, found `{}`",
                    &*p.key.name,
                ),
                vec![source_range],
            )));
        }
    }

    Ok(result)
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
            value => Err(KclError::new_semantic(KclErrorDetails::new(
                format!(
                    "Unexpected value for length units: `{value}`; expected one of `mm`, `cm`, `m`, `in`, `ft`, `yd`"
                ),
                vec![source_range],
            ))),
        }
    }
}

impl UnitAngle {
    pub(super) fn from_str(s: &str, source_range: SourceRange) -> Result<Self, KclError> {
        match s {
            "deg" => Ok(UnitAngle::Degrees),
            "rad" => Ok(UnitAngle::Radians),
            value => Err(KclError::new_semantic(KclErrorDetails::new(
                format!("Unexpected value for angle units: `{value}`; expected one of `deg`, `rad`"),
                vec![source_range],
            ))),
        }
    }
}
