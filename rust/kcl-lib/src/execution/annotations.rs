//! Data on available annotations.

use std::str::FromStr;

use kittycad_modeling_cmds::coord::{KITTYCAD, OPENGL, System, VULKAN};

use crate::{
    KclError, SourceRange,
    errors::KclErrorDetails,
    execution::types::{UnitAngle, UnitLen},
    parsing::ast::types::{Annotation, Expr, LiteralValue, Node, ObjectProperty},
};

/// Annotations which should cause re-execution if they change.
pub(super) const SIGNIFICANT_ATTRS: [&str; 2] = [SETTINGS, NO_PRELUDE];

pub(crate) const SETTINGS: &str = "settings";
pub(crate) const SETTINGS_UNIT_LENGTH: &str = "defaultLengthUnit";
pub(crate) const SETTINGS_UNIT_ANGLE: &str = "defaultAngleUnit";
pub(crate) const SETTINGS_VERSION: &str = "kclVersion";
pub(super) const NO_PRELUDE: &str = "no_std";

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

pub(crate) const DEPRECATED: &str = "deprecated";

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
    if let Expr::Name(name) = expr {
        if let Some(name) = name.local_ident() {
            return Ok(*name);
        }
    }

    Err(KclError::new_semantic(KclErrorDetails::new(
        "Unexpected settings value, expected a simple name, e.g., `mm`".to_owned(),
        vec![expr.into()],
    )))
}

// Returns the unparsed number literal.
pub(super) fn expect_number(expr: &Expr) -> Result<String, KclError> {
    if let Expr::Literal(lit) = expr {
        if let LiteralValue::Number { .. } = &lit.value {
            return Ok(lit.raw.clone());
        }
    }

    Err(KclError::new_semantic(KclErrorDetails::new(
        "Unexpected settings value, expected a number, e.g., `1.0`".to_owned(),
        vec![expr.into()],
    )))
}

pub(super) fn get_impl(annotations: &[Node<Annotation>], source_range: SourceRange) -> Result<Option<Impl>, KclError> {
    for attr in annotations {
        if attr.name.is_some() || attr.properties.is_none() {
            continue;
        }
        for p in attr.properties.as_ref().unwrap() {
            if &*p.key.name == IMPL {
                if let Some(s) = p.value.ident_name() {
                    return Impl::from_str(s).map(Some).map_err(|_| {
                        KclError::new_semantic(KclErrorDetails::new(
                            format!(
                                "Invalid value for {} attribute, expected one of: {}",
                                IMPL,
                                IMPL_VALUES.join(", ")
                            ),
                            vec![source_range],
                        ))
                    });
                }
            }
        }
    }

    Ok(None)
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
