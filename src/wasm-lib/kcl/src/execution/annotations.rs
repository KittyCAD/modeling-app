//! Data on available annotations.

use kittycad_modeling_cmds::coord::{System, KITTYCAD, OPENGL, VULKAN};

use crate::{
    errors::KclErrorDetails,
    execution::kcl_value::{UnitAngle, UnitLen},
    parsing::ast::types::{Annotation, Expr, Node, ObjectProperty},
    KclError, SourceRange,
};

/// Annotations which should cause re-execution if they change.
pub(super) const SIGNIFICANT_ATTRS: [&str; 2] = [SETTINGS, NO_PRELUDE];

pub(crate) const SETTINGS: &str = "settings";
pub(crate) const SETTINGS_UNIT_LENGTH: &str = "defaultLengthUnit";
pub(crate) const SETTINGS_UNIT_ANGLE: &str = "defaultAngleUnit";
pub(super) const NO_PRELUDE: &str = "no_prelude";

pub(super) const IMPORT_FORMAT: &str = "format";
pub(super) const IMPORT_FORMAT_VALUES: [&str; 9] = ["fbx", "gltf", "glb", "obj", "ply", "sldprt", "stp", "step", "stl"];
pub(super) const IMPORT_COORDS: &str = "coords";
pub(super) const IMPORT_COORDS_VALUES: [(&str, &System); 3] =
    [("zoo", KITTYCAD), ("opengl", OPENGL), ("vulkan", VULKAN)];
pub(super) const IMPORT_LENGTH_UNIT: &str = "lengthUnit";

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
        KclError::Semantic(KclErrorDetails {
            message: format!("Empty `{for_key}` annotation"),
            source_ranges: vec![annotation.as_source_range()],
        })
    })?)
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
                    "Unexpected value for length units: `{value}`; expected one of `mm`, `cm`, `m`, `inch`, `ft`, `yd`"
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
                message: format!("Unexpected value for angle units: `{value}`; expected one of `deg`, `rad`"),
                source_ranges: vec![source_range],
            })),
        }
    }
}
