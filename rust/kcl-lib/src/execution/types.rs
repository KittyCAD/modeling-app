use std::{collections::HashMap, fmt};

use anyhow::Result;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::{
    execution::{
        kcl_value::{KclValue, TypeDef},
        memory::{self},
        ExecState, Plane, PlaneInfo, Point3d,
    },
    parsing::{
        ast::types::{PrimitiveType as AstPrimitiveType, Type},
        token::NumericSuffix,
    },
    std::args::{FromKclValue, TyF64},
    CompilationError, SourceRange,
};

#[derive(Debug, Clone, PartialEq)]
pub enum RuntimeType {
    Primitive(PrimitiveType),
    Array(Box<RuntimeType>, ArrayLen),
    Union(Vec<RuntimeType>),
    Tuple(Vec<RuntimeType>),
    Object(Vec<(String, RuntimeType)>),
}

impl RuntimeType {
    pub fn any() -> Self {
        RuntimeType::Primitive(PrimitiveType::Any)
    }

    pub fn edge() -> Self {
        RuntimeType::Primitive(PrimitiveType::Edge)
    }

    pub fn sketch() -> Self {
        RuntimeType::Primitive(PrimitiveType::Sketch)
    }

    /// `[Sketch; 1+]`
    pub fn sketches() -> Self {
        RuntimeType::Array(
            Box::new(RuntimeType::Primitive(PrimitiveType::Sketch)),
            ArrayLen::NonEmpty,
        )
    }

    /// `[Solid; 1+]`
    pub fn solids() -> Self {
        RuntimeType::Array(
            Box::new(RuntimeType::Primitive(PrimitiveType::Solid)),
            ArrayLen::NonEmpty,
        )
    }

    pub fn solid() -> Self {
        RuntimeType::Primitive(PrimitiveType::Solid)
    }

    pub fn helix() -> Self {
        RuntimeType::Primitive(PrimitiveType::Helix)
    }

    pub fn plane() -> Self {
        RuntimeType::Primitive(PrimitiveType::Plane)
    }

    pub fn face() -> Self {
        RuntimeType::Primitive(PrimitiveType::Face)
    }

    pub fn tag() -> Self {
        RuntimeType::Primitive(PrimitiveType::Tag)
    }

    pub fn tag_identifier() -> Self {
        RuntimeType::Primitive(PrimitiveType::TagId)
    }

    pub fn bool() -> Self {
        RuntimeType::Primitive(PrimitiveType::Boolean)
    }

    pub fn string() -> Self {
        RuntimeType::Primitive(PrimitiveType::String)
    }

    pub fn imported() -> Self {
        RuntimeType::Primitive(PrimitiveType::ImportedGeometry)
    }

    /// `[number; 2]`
    pub fn point2d() -> Self {
        RuntimeType::Array(Box::new(RuntimeType::length()), ArrayLen::Known(2))
    }

    /// `[number; 3]`
    pub fn point3d() -> Self {
        RuntimeType::Array(Box::new(RuntimeType::length()), ArrayLen::Known(3))
    }

    pub fn length() -> Self {
        RuntimeType::Primitive(PrimitiveType::Number(NumericType::Known(UnitType::Length(
            UnitLen::Unknown,
        ))))
    }

    pub fn known_length(len: UnitLen) -> Self {
        RuntimeType::Primitive(PrimitiveType::Number(NumericType::Known(UnitType::Length(len))))
    }

    pub fn angle() -> Self {
        RuntimeType::Primitive(PrimitiveType::Number(NumericType::Known(UnitType::Angle(
            UnitAngle::Unknown,
        ))))
    }

    pub fn radians() -> Self {
        RuntimeType::Primitive(PrimitiveType::Number(NumericType::Known(UnitType::Angle(
            UnitAngle::Radians,
        ))))
    }

    pub fn degrees() -> Self {
        RuntimeType::Primitive(PrimitiveType::Number(NumericType::Known(UnitType::Angle(
            UnitAngle::Degrees,
        ))))
    }

    pub fn count() -> Self {
        RuntimeType::Primitive(PrimitiveType::Number(NumericType::Known(UnitType::Count)))
    }

    pub fn num_any() -> Self {
        RuntimeType::Primitive(PrimitiveType::Number(NumericType::Any))
    }

    pub fn from_parsed(
        value: Type,
        exec_state: &mut ExecState,
        source_range: SourceRange,
    ) -> Result<Self, CompilationError> {
        match value {
            Type::Primitive(pt) => Self::from_parsed_primitive(pt, exec_state, source_range),
            Type::Array { ty, len } => {
                Self::from_parsed(*ty, exec_state, source_range).map(|t| RuntimeType::Array(Box::new(t), len))
            }
            Type::Union { tys } => tys
                .into_iter()
                .map(|t| Self::from_parsed_primitive(t.inner, exec_state, source_range))
                .collect::<Result<Vec<_>, CompilationError>>()
                .map(RuntimeType::Union),
            Type::Object { properties } => properties
                .into_iter()
                .map(|p| {
                    RuntimeType::from_parsed(p.type_.unwrap().inner, exec_state, source_range)
                        .map(|ty| (p.identifier.inner.name, ty))
                })
                .collect::<Result<Vec<_>, CompilationError>>()
                .map(RuntimeType::Object),
        }
    }

    fn from_parsed_primitive(
        value: AstPrimitiveType,
        exec_state: &mut ExecState,
        source_range: SourceRange,
    ) -> Result<Self, CompilationError> {
        Ok(match value {
            AstPrimitiveType::Any => RuntimeType::Primitive(PrimitiveType::Any),
            AstPrimitiveType::String => RuntimeType::Primitive(PrimitiveType::String),
            AstPrimitiveType::Boolean => RuntimeType::Primitive(PrimitiveType::Boolean),
            AstPrimitiveType::Number(suffix) => {
                let ty = match suffix {
                    NumericSuffix::None => NumericType::Any,
                    _ => NumericType::from_parsed(suffix, &exec_state.mod_local.settings),
                };
                RuntimeType::Primitive(PrimitiveType::Number(ty))
            }
            AstPrimitiveType::Named(name) => Self::from_alias(&name.name, exec_state, source_range)?,
            AstPrimitiveType::Tag => RuntimeType::Primitive(PrimitiveType::Tag),
            AstPrimitiveType::ImportedGeometry => RuntimeType::Primitive(PrimitiveType::ImportedGeometry),
            AstPrimitiveType::Function(_) => RuntimeType::Primitive(PrimitiveType::Function),
        })
    }

    pub fn from_alias(
        alias: &str,
        exec_state: &mut ExecState,
        source_range: SourceRange,
    ) -> Result<Self, CompilationError> {
        let ty_val = exec_state
            .stack()
            .get(&format!("{}{}", memory::TYPE_PREFIX, alias), source_range)
            .map_err(|_| CompilationError::err(source_range, format!("Unknown type: {}", alias)))?;

        Ok(match ty_val {
            KclValue::Type { value, .. } => match value {
                TypeDef::RustRepr(ty, _) => RuntimeType::Primitive(ty.clone()),
                TypeDef::Alias(ty) => ty.clone(),
            },
            _ => unreachable!(),
        })
    }

    pub fn human_friendly_type(&self) -> String {
        match self {
            RuntimeType::Primitive(ty) => ty.to_string(),
            RuntimeType::Array(ty, ArrayLen::None) => format!("an array of {}", ty.display_multiple()),
            RuntimeType::Array(ty, ArrayLen::NonEmpty) => format!("one or more {}", ty.display_multiple()),
            RuntimeType::Array(ty, ArrayLen::Known(n)) => format!("an array of {n} {}", ty.display_multiple()),
            RuntimeType::Union(tys) => tys
                .iter()
                .map(Self::human_friendly_type)
                .collect::<Vec<_>>()
                .join(" or "),
            RuntimeType::Tuple(tys) => format!(
                "a tuple with values of types ({})",
                tys.iter().map(Self::human_friendly_type).collect::<Vec<_>>().join(", ")
            ),
            RuntimeType::Object(_) => format!("an object with fields {}", self),
        }
    }

    // Subtype with no coercion, including refining numeric types.
    fn subtype(&self, sup: &RuntimeType) -> bool {
        use RuntimeType::*;

        match (self, sup) {
            (_, Primitive(PrimitiveType::Any)) => true,
            (Primitive(t1), Primitive(t2)) => t1.subtype(t2),
            (Array(t1, l1), Array(t2, l2)) => t1.subtype(t2) && l1.subtype(*l2),
            (Tuple(t1), Tuple(t2)) => t1.len() == t2.len() && t1.iter().zip(t2).all(|(t1, t2)| t1.subtype(t2)),
            (Union(ts1), Union(ts2)) => ts1.iter().all(|t| ts2.contains(t)),
            (t1, Union(ts2)) => ts2.iter().any(|t| t1.subtype(t)),
            (Object(t1), Object(t2)) => t2
                .iter()
                .all(|(f, t)| t1.iter().any(|(ff, tt)| f == ff && tt.subtype(t))),
            // Equality between Axis types and their object representation.
            (Object(t1), Primitive(PrimitiveType::Axis2d)) => {
                t1.iter()
                    .any(|(n, t)| n == "origin" && t.subtype(&RuntimeType::point2d()))
                    && t1
                        .iter()
                        .any(|(n, t)| n == "direction" && t.subtype(&RuntimeType::point2d()))
            }
            (Object(t1), Primitive(PrimitiveType::Axis3d)) => {
                t1.iter()
                    .any(|(n, t)| n == "origin" && t.subtype(&RuntimeType::point3d()))
                    && t1
                        .iter()
                        .any(|(n, t)| n == "direction" && t.subtype(&RuntimeType::point3d()))
            }
            (Primitive(PrimitiveType::Axis2d), Object(t2)) => {
                t2.iter()
                    .any(|(n, t)| n == "origin" && t.subtype(&RuntimeType::point2d()))
                    && t2
                        .iter()
                        .any(|(n, t)| n == "direction" && t.subtype(&RuntimeType::point2d()))
            }
            (Primitive(PrimitiveType::Axis3d), Object(t2)) => {
                t2.iter()
                    .any(|(n, t)| n == "origin" && t.subtype(&RuntimeType::point3d()))
                    && t2
                        .iter()
                        .any(|(n, t)| n == "direction" && t.subtype(&RuntimeType::point3d()))
            }
            _ => false,
        }
    }

    fn display_multiple(&self) -> String {
        match self {
            RuntimeType::Primitive(ty) => ty.display_multiple(),
            RuntimeType::Array(..) => "arrays".to_owned(),
            RuntimeType::Union(tys) => tys
                .iter()
                .map(|t| t.display_multiple())
                .collect::<Vec<_>>()
                .join(" or "),
            RuntimeType::Tuple(_) => "tuples".to_owned(),
            RuntimeType::Object(_) => format!("objects with fields {self}"),
        }
    }
}

impl fmt::Display for RuntimeType {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            RuntimeType::Primitive(t) => t.fmt(f),
            RuntimeType::Array(t, l) => match l {
                ArrayLen::None => write!(f, "[{t}]"),
                ArrayLen::NonEmpty => write!(f, "[{t}; 1+]"),
                ArrayLen::Known(n) => write!(f, "[{t}; {n}]"),
            },
            RuntimeType::Tuple(ts) => write!(
                f,
                "({})",
                ts.iter().map(|t| t.to_string()).collect::<Vec<_>>().join(", ")
            ),
            RuntimeType::Union(ts) => write!(
                f,
                "{}",
                ts.iter().map(|t| t.to_string()).collect::<Vec<_>>().join(" | ")
            ),
            RuntimeType::Object(items) => write!(
                f,
                "{{ {} }}",
                items
                    .iter()
                    .map(|(n, t)| format!("{n}: {t}"))
                    .collect::<Vec<_>>()
                    .join(", ")
            ),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, ts_rs::TS, JsonSchema)]
pub enum ArrayLen {
    None,
    NonEmpty,
    Known(usize),
}

impl ArrayLen {
    pub fn subtype(self, other: ArrayLen) -> bool {
        match (self, other) {
            (_, ArrayLen::None) => true,
            (ArrayLen::NonEmpty, ArrayLen::NonEmpty) => true,
            (ArrayLen::Known(size), ArrayLen::NonEmpty) if size > 0 => true,
            (ArrayLen::Known(s1), ArrayLen::Known(s2)) if s1 == s2 => true,
            _ => false,
        }
    }

    /// True if the length constraint is satisfied by the supplied length.
    fn satisfied(self, len: usize, allow_shrink: bool) -> Option<usize> {
        match self {
            ArrayLen::None => Some(len),
            ArrayLen::NonEmpty => (len > 0).then_some(len),
            ArrayLen::Known(s) => (if allow_shrink { len >= s } else { len == s }).then_some(s),
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum PrimitiveType {
    Any,
    Number(NumericType),
    String,
    Boolean,
    Tag,
    // Annoyingly some functions only want a TagIdentifier, not any kind of tag.
    TagId,
    Sketch,
    Solid,
    Plane,
    Helix,
    Face,
    Edge,
    Axis2d,
    Axis3d,
    ImportedGeometry,
    Function,
}

impl PrimitiveType {
    fn display_multiple(&self) -> String {
        match self {
            PrimitiveType::Any => "any values".to_owned(),
            PrimitiveType::Number(NumericType::Known(unit)) => format!("numbers({unit})"),
            PrimitiveType::Number(_) => "numbers".to_owned(),
            PrimitiveType::String => "strings".to_owned(),
            PrimitiveType::Boolean => "bools".to_owned(),
            PrimitiveType::Sketch => "Sketches".to_owned(),
            PrimitiveType::Solid => "Solids".to_owned(),
            PrimitiveType::Plane => "Planes".to_owned(),
            PrimitiveType::Helix => "Helices".to_owned(),
            PrimitiveType::Face => "Faces".to_owned(),
            PrimitiveType::Edge => "Edges".to_owned(),
            PrimitiveType::Axis2d => "2d axes".to_owned(),
            PrimitiveType::Axis3d => "3d axes".to_owned(),
            PrimitiveType::ImportedGeometry => "imported geometries".to_owned(),
            PrimitiveType::Function => "functions".to_owned(),
            PrimitiveType::Tag => "tags".to_owned(),
            PrimitiveType::TagId => "tag identifiers".to_owned(),
        }
    }

    fn subtype(&self, other: &PrimitiveType) -> bool {
        match (self, other) {
            (_, PrimitiveType::Any) => true,
            (PrimitiveType::Number(n1), PrimitiveType::Number(n2)) => n1.subtype(n2),
            (PrimitiveType::TagId, PrimitiveType::Tag) => true,
            (t1, t2) => t1 == t2,
        }
    }
}

impl fmt::Display for PrimitiveType {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            PrimitiveType::Any => write!(f, "any"),
            PrimitiveType::Number(NumericType::Known(unit)) => write!(f, "number({unit})"),
            PrimitiveType::Number(NumericType::Unknown) => write!(f, "number(unknown units)"),
            PrimitiveType::Number(NumericType::Default { .. }) => write!(f, "number(default units)"),
            PrimitiveType::Number(NumericType::Any) => write!(f, "number(any units)"),
            PrimitiveType::String => write!(f, "string"),
            PrimitiveType::Boolean => write!(f, "bool"),
            PrimitiveType::Tag => write!(f, "tag"),
            PrimitiveType::TagId => write!(f, "tag identifier"),
            PrimitiveType::Sketch => write!(f, "Sketch"),
            PrimitiveType::Solid => write!(f, "Solid"),
            PrimitiveType::Plane => write!(f, "Plane"),
            PrimitiveType::Face => write!(f, "Face"),
            PrimitiveType::Edge => write!(f, "Edge"),
            PrimitiveType::Axis2d => write!(f, "Axis2d"),
            PrimitiveType::Axis3d => write!(f, "Axis3d"),
            PrimitiveType::Helix => write!(f, "Helix"),
            PrimitiveType::ImportedGeometry => write!(f, "imported geometry"),
            PrimitiveType::Function => write!(f, "function"),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(tag = "type")]
pub enum NumericType {
    // Specified by the user (directly or indirectly)
    Known(UnitType),
    // Unspecified, using defaults
    Default { len: UnitLen, angle: UnitAngle },
    // Exceeded the ability of the type system to track.
    Unknown,
    // Type info has been explicitly cast away.
    Any,
}

impl Default for NumericType {
    fn default() -> Self {
        NumericType::Default {
            len: UnitLen::default(),
            angle: UnitAngle::default(),
        }
    }
}

impl NumericType {
    pub const fn count() -> Self {
        NumericType::Known(UnitType::Count)
    }

    pub const fn mm() -> Self {
        NumericType::Known(UnitType::Length(UnitLen::Mm))
    }

    pub const fn radians() -> Self {
        NumericType::Known(UnitType::Angle(UnitAngle::Radians))
    }

    pub const fn degrees() -> Self {
        NumericType::Known(UnitType::Angle(UnitAngle::Degrees))
    }

    pub fn expect_default_length(&self) -> Self {
        match self {
            NumericType::Default { len, .. } => NumericType::Known(UnitType::Length(*len)),
            _ => unreachable!(),
        }
    }

    pub fn expect_default_angle(&self) -> Self {
        match self {
            NumericType::Default { angle, .. } => NumericType::Known(UnitType::Angle(*angle)),
            _ => unreachable!(),
        }
    }

    /// Combine two types when we expect them to be equal, erring on the side of less coercion. To be
    /// precise, only adjusting one number or the other when they are of known types.
    ///
    /// This combinator function is suitable for comparisons where uncertainty should
    /// be handled by the user.
    pub fn combine_eq(a: TyF64, b: TyF64) -> (f64, f64, NumericType) {
        use NumericType::*;
        match (a.ty, b.ty) {
            (at, bt) if at == bt => (a.n, b.n, at),
            (at, Any) => (a.n, b.n, at),
            (Any, bt) => (a.n, b.n, bt),

            (t @ Known(UnitType::Length(l1)), Known(UnitType::Length(l2))) => (a.n, l2.adjust_to(b.n, l1).0, t),
            (t @ Known(UnitType::Angle(a1)), Known(UnitType::Angle(a2))) => (a.n, a2.adjust_to(b.n, a1).0, t),

            (Known(UnitType::Count), Default { .. }) | (Default { .. }, Known(UnitType::Count)) => {
                (a.n, b.n, Known(UnitType::Count))
            }
            (t @ Known(UnitType::Length(l1)), Default { len: l2, .. }) if l1 == l2 => (a.n, b.n, t),
            (Default { len: l1, .. }, t @ Known(UnitType::Length(l2))) if l1 == l2 => (a.n, b.n, t),
            (t @ Known(UnitType::Angle(a1)), Default { angle: a2, .. }) if a1 == a2 => (a.n, b.n, t),
            (Default { angle: a1, .. }, t @ Known(UnitType::Angle(a2))) if a1 == a2 => (a.n, b.n, t),

            _ => (a.n, b.n, Unknown),
        }
    }

    /// Combine two types when we expect them to be equal, erring on the side of more coercion. Including adjusting when
    /// we are certain about only one type.
    ///
    /// This combinator function is suitable for situations where the user would almost certainly want the types to be
    /// coerced together, for example two arguments to the same function or two numbers in an array being used as a point.
    ///
    /// Prefer to use `combine_eq` if possible since using that prioritises correctness over ergonomics.
    pub fn combine_eq_coerce(a: TyF64, b: TyF64) -> (f64, f64, NumericType) {
        use NumericType::*;
        match (a.ty, b.ty) {
            (at, bt) if at == bt => (a.n, b.n, at),
            (at, Any) => (a.n, b.n, at),
            (Any, bt) => (a.n, b.n, bt),

            (Default { .. }, Default { .. }) | (_, Unknown) | (Unknown, _) => (a.n, b.n, Unknown),

            // Known types and compatible, but needs adjustment.
            (t @ Known(UnitType::Length(l1)), Known(UnitType::Length(l2))) => (a.n, l2.adjust_to(b.n, l1).0, t),
            (t @ Known(UnitType::Angle(a1)), Known(UnitType::Angle(a2))) => (a.n, a2.adjust_to(b.n, a1).0, t),

            // Known but incompatible.
            (Known(_), Known(_)) => (a.n, b.n, Unknown),

            // Known and unknown => we assume the known one, possibly with adjustment
            (Known(UnitType::Count), Default { .. }) | (Default { .. }, Known(UnitType::Count)) => {
                (a.n, b.n, Known(UnitType::Count))
            }

            (t @ Known(UnitType::Length(l1)), Default { len: l2, .. }) => (a.n, l2.adjust_to(b.n, l1).0, t),
            (Default { len: l1, .. }, t @ Known(UnitType::Length(l2))) => (l1.adjust_to(a.n, l2).0, b.n, t),

            (t @ Known(UnitType::Angle(a1)), Default { angle: a2, .. }) => (a.n, a2.adjust_to(b.n, a1).0, t),
            (Default { angle: a1, .. }, t @ Known(UnitType::Angle(a2))) => (a1.adjust_to(a.n, a2).0, b.n, t),
        }
    }

    pub fn combine_eq_array(input: &[TyF64]) -> (Vec<f64>, NumericType) {
        use NumericType::*;
        let result = input.iter().map(|t| t.n).collect();

        let mut ty = Any;
        for i in input {
            if i.ty == Any || ty == i.ty {
                continue;
            }

            // The cases where we check the values for 0.0 are so we don't crash out where a conversion would always be safe
            match (&ty, &i.ty) {
                (Any, Default { .. }) if i.n == 0.0 => {}
                (Any, t) => {
                    ty = t.clone();
                }
                (_, Unknown) | (Default { .. }, Default { .. }) => return (result, Unknown),

                (Known(UnitType::Count), Default { .. }) | (Default { .. }, Known(UnitType::Count)) => {
                    ty = Known(UnitType::Count);
                }

                (Known(UnitType::Length(l1)), Default { len: l2, .. }) if l1 == l2 || i.n == 0.0 => {}
                (Known(UnitType::Angle(a1)), Default { angle: a2, .. }) if a1 == a2 || i.n == 0.0 => {}

                (Default { len: l1, .. }, Known(UnitType::Length(l2))) if l1 == l2 => {
                    ty = Known(UnitType::Length(*l2));
                }
                (Default { angle: a1, .. }, Known(UnitType::Angle(a2))) if a1 == a2 => {
                    ty = Known(UnitType::Angle(*a2));
                }

                _ => return (result, Unknown),
            }
        }

        if ty == Any && !input.is_empty() {
            ty = input[0].ty.clone();
        }

        (result, ty)
    }

    /// Combine two types for multiplication-like operations.
    pub fn combine_mul(a: TyF64, b: TyF64) -> (f64, f64, NumericType) {
        use NumericType::*;
        match (a.ty, b.ty) {
            (at @ Default { .. }, bt @ Default { .. }) if at == bt => (a.n, b.n, at),
            (Default { .. }, Default { .. }) => (a.n, b.n, Unknown),
            (Known(UnitType::Count), bt) => (a.n, b.n, bt),
            (at, Known(UnitType::Count)) => (a.n, b.n, at),
            (at @ Known(_), Default { .. }) | (Default { .. }, at @ Known(_)) => (a.n, b.n, at),
            (Any, Any) => (a.n, b.n, Any),
            _ => (a.n, b.n, Unknown),
        }
    }

    /// Combine two types for division-like operations.
    pub fn combine_div(a: TyF64, b: TyF64) -> (f64, f64, NumericType) {
        use NumericType::*;
        match (a.ty, b.ty) {
            (at @ Default { .. }, bt @ Default { .. }) if at == bt => (a.n, b.n, at),
            (at, bt) if at == bt => (a.n, b.n, Known(UnitType::Count)),
            (Default { .. }, Default { .. }) => (a.n, b.n, Unknown),
            (at, Known(UnitType::Count) | Any) => (a.n, b.n, at),
            (at @ Known(_), Default { .. }) => (a.n, b.n, at),
            (Known(UnitType::Count), _) => (a.n, b.n, Known(UnitType::Count)),
            _ => (a.n, b.n, Unknown),
        }
    }

    pub fn from_parsed(suffix: NumericSuffix, settings: &super::MetaSettings) -> Self {
        match suffix {
            NumericSuffix::None => NumericType::Default {
                len: settings.default_length_units,
                angle: settings.default_angle_units,
            },
            NumericSuffix::Count => NumericType::Known(UnitType::Count),
            NumericSuffix::Length => NumericType::Known(UnitType::Length(UnitLen::Unknown)),
            NumericSuffix::Angle => NumericType::Known(UnitType::Angle(UnitAngle::Unknown)),
            NumericSuffix::Mm => NumericType::Known(UnitType::Length(UnitLen::Mm)),
            NumericSuffix::Cm => NumericType::Known(UnitType::Length(UnitLen::Cm)),
            NumericSuffix::M => NumericType::Known(UnitType::Length(UnitLen::M)),
            NumericSuffix::Inch => NumericType::Known(UnitType::Length(UnitLen::Inches)),
            NumericSuffix::Ft => NumericType::Known(UnitType::Length(UnitLen::Feet)),
            NumericSuffix::Yd => NumericType::Known(UnitType::Length(UnitLen::Yards)),
            NumericSuffix::Deg => NumericType::Known(UnitType::Angle(UnitAngle::Degrees)),
            NumericSuffix::Rad => NumericType::Known(UnitType::Angle(UnitAngle::Radians)),
            NumericSuffix::Unknown => NumericType::Unknown,
        }
    }

    fn subtype(&self, other: &NumericType) -> bool {
        use NumericType::*;

        match (self, other) {
            (_, Any) => true,
            (a, b) if a == b => true,
            (
                NumericType::Known(UnitType::Length(_)) | NumericType::Default { .. },
                NumericType::Known(UnitType::Length(UnitLen::Unknown)),
            )
            | (
                NumericType::Known(UnitType::Angle(_)) | NumericType::Default { .. },
                NumericType::Known(UnitType::Angle(UnitAngle::Unknown)),
            ) => true,
            (Unknown, _) | (_, Unknown) => false,
            (_, _) => false,
        }
    }

    fn is_unknown(&self) -> bool {
        matches!(
            self,
            NumericType::Unknown
                | NumericType::Known(UnitType::Angle(UnitAngle::Unknown))
                | NumericType::Known(UnitType::Length(UnitLen::Unknown))
        )
    }

    fn example_ty(&self) -> Option<String> {
        match self {
            Self::Known(t) if !self.is_unknown() => Some(t.to_string()),
            Self::Default { len, .. } => Some(len.to_string()),
            _ => None,
        }
    }

    fn coerce(&self, val: &KclValue) -> Result<KclValue, CoercionError> {
        let KclValue::Number { value, ty, meta } = val else {
            return Err(val.into());
        };

        if ty.subtype(self) {
            return Ok(KclValue::Number {
                value: *value,
                ty: ty.clone(),
                meta: meta.clone(),
            });
        }

        // Not subtypes, but might be able to coerce
        use NumericType::*;
        match (ty, self) {
            // We don't have enough information to coerce.
            (Unknown, _) => Err(CoercionError::from(val).with_explicit(self.example_ty().unwrap_or("mm".to_owned()))),
            (_, Unknown) => Err(val.into()),

            (Any, _) => Ok(KclValue::Number {
                value: *value,
                ty: self.clone(),
                meta: meta.clone(),
            }),

            // If we're coercing to a default, we treat this as coercing to Any since leaving the numeric type unspecified in a coercion situation
            // means accept any number rather than force the current default.
            (_, Default { .. }) => Ok(KclValue::Number {
                value: *value,
                ty: ty.clone(),
                meta: meta.clone(),
            }),

            // Known types and compatible, but needs adjustment.
            (Known(UnitType::Length(l1)), Known(UnitType::Length(l2))) => {
                let (value, ty) = l1.adjust_to(*value, *l2);
                Ok(KclValue::Number {
                    value,
                    ty: Known(UnitType::Length(ty)),
                    meta: meta.clone(),
                })
            }
            (Known(UnitType::Angle(a1)), Known(UnitType::Angle(a2))) => {
                let (value, ty) = a1.adjust_to(*value, *a2);
                Ok(KclValue::Number {
                    value,
                    ty: Known(UnitType::Angle(ty)),
                    meta: meta.clone(),
                })
            }

            // Known but incompatible.
            (Known(_), Known(_)) => Err(val.into()),

            // Known and unknown => we assume the rhs, possibly with adjustment
            (Default { .. }, Known(UnitType::Count)) => Ok(KclValue::Number {
                value: *value,
                ty: Known(UnitType::Count),
                meta: meta.clone(),
            }),

            (Default { len: l1, .. }, Known(UnitType::Length(l2))) => {
                let (value, ty) = l1.adjust_to(*value, *l2);
                Ok(KclValue::Number {
                    value,
                    ty: Known(UnitType::Length(ty)),
                    meta: meta.clone(),
                })
            }

            (Default { angle: a1, .. }, Known(UnitType::Angle(a2))) => {
                let (value, ty) = a1.adjust_to(*value, *a2);
                Ok(KclValue::Number {
                    value,
                    ty: Known(UnitType::Angle(ty)),
                    meta: meta.clone(),
                })
            }

            (_, _) => unreachable!(),
        }
    }

    pub fn expect_length(&self) -> UnitLen {
        match self {
            Self::Known(UnitType::Length(len)) | Self::Default { len, .. } => *len,
            _ => unreachable!("Found {self:?}"),
        }
    }

    pub fn as_length(&self) -> Option<UnitLen> {
        match self {
            Self::Known(UnitType::Length(len)) | Self::Default { len, .. } => Some(*len),
            _ => None,
        }
    }
}

impl From<NumericType> for RuntimeType {
    fn from(t: NumericType) -> RuntimeType {
        RuntimeType::Primitive(PrimitiveType::Number(t))
    }
}

impl From<UnitLen> for NumericType {
    fn from(value: UnitLen) -> Self {
        NumericType::Known(UnitType::Length(value))
    }
}

impl From<UnitAngle> for NumericType {
    fn from(value: UnitAngle) -> Self {
        NumericType::Known(UnitType::Angle(value))
    }
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(tag = "type")]
pub enum UnitType {
    Count,
    Length(UnitLen),
    Angle(UnitAngle),
}

impl std::fmt::Display for UnitType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            UnitType::Count => write!(f, "Count"),
            UnitType::Length(l) => l.fmt(f),
            UnitType::Angle(a) => a.fmt(f),
        }
    }
}

// TODO called UnitLen so as not to clash with UnitLength in settings)
/// A unit of length.
#[derive(Debug, Default, Clone, Copy, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema, Eq)]
#[ts(export)]
#[serde(tag = "type")]
pub enum UnitLen {
    #[default]
    Mm,
    Cm,
    M,
    Inches,
    Feet,
    Yards,
    Unknown,
}

impl UnitLen {
    pub fn adjust_to(self, value: f64, to: UnitLen) -> (f64, UnitLen) {
        use UnitLen::*;

        if self == to {
            return (value, to);
        }

        if to == Unknown {
            return (value, self);
        }

        let (base, base_unit) = match self {
            Mm => (value, Mm),
            Cm => (value * 10.0, Mm),
            M => (value * 1000.0, Mm),
            Inches => (value, Inches),
            Feet => (value * 12.0, Inches),
            Yards => (value * 36.0, Inches),
            Unknown => unreachable!(),
        };
        let (base, base_unit) = match (base_unit, to) {
            (Mm, Inches) | (Mm, Feet) | (Mm, Yards) => (base / 25.4, Inches),
            (Inches, Mm) | (Inches, Cm) | (Inches, M) => (base * 25.4, Mm),
            _ => (base, base_unit),
        };

        let value = match (base_unit, to) {
            (Mm, Mm) => base,
            (Mm, Cm) => base / 10.0,
            (Mm, M) => base / 1000.0,
            (Inches, Inches) => base,
            (Inches, Feet) => base / 12.0,
            (Inches, Yards) => base / 36.0,
            _ => unreachable!(),
        };

        (value, to)
    }
}

impl std::fmt::Display for UnitLen {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            UnitLen::Mm => write!(f, "mm"),
            UnitLen::Cm => write!(f, "cm"),
            UnitLen::M => write!(f, "m"),
            UnitLen::Inches => write!(f, "in"),
            UnitLen::Feet => write!(f, "ft"),
            UnitLen::Yards => write!(f, "yd"),
            UnitLen::Unknown => write!(f, "Length"),
        }
    }
}

impl TryFrom<NumericSuffix> for UnitLen {
    type Error = ();

    fn try_from(suffix: NumericSuffix) -> std::result::Result<Self, Self::Error> {
        match suffix {
            NumericSuffix::Mm => Ok(Self::Mm),
            NumericSuffix::Cm => Ok(Self::Cm),
            NumericSuffix::M => Ok(Self::M),
            NumericSuffix::Inch => Ok(Self::Inches),
            NumericSuffix::Ft => Ok(Self::Feet),
            NumericSuffix::Yd => Ok(Self::Yards),
            _ => Err(()),
        }
    }
}

impl From<crate::UnitLength> for UnitLen {
    fn from(unit: crate::UnitLength) -> Self {
        match unit {
            crate::UnitLength::Cm => UnitLen::Cm,
            crate::UnitLength::Ft => UnitLen::Feet,
            crate::UnitLength::In => UnitLen::Inches,
            crate::UnitLength::M => UnitLen::M,
            crate::UnitLength::Mm => UnitLen::Mm,
            crate::UnitLength::Yd => UnitLen::Yards,
        }
    }
}

impl From<UnitLen> for crate::UnitLength {
    fn from(unit: UnitLen) -> Self {
        match unit {
            UnitLen::Cm => crate::UnitLength::Cm,
            UnitLen::Feet => crate::UnitLength::Ft,
            UnitLen::Inches => crate::UnitLength::In,
            UnitLen::M => crate::UnitLength::M,
            UnitLen::Mm => crate::UnitLength::Mm,
            UnitLen::Yards => crate::UnitLength::Yd,
            UnitLen::Unknown => unreachable!(),
        }
    }
}

impl From<UnitLen> for kittycad_modeling_cmds::units::UnitLength {
    fn from(unit: UnitLen) -> Self {
        match unit {
            UnitLen::Cm => kittycad_modeling_cmds::units::UnitLength::Centimeters,
            UnitLen::Feet => kittycad_modeling_cmds::units::UnitLength::Feet,
            UnitLen::Inches => kittycad_modeling_cmds::units::UnitLength::Inches,
            UnitLen::M => kittycad_modeling_cmds::units::UnitLength::Meters,
            UnitLen::Mm => kittycad_modeling_cmds::units::UnitLength::Millimeters,
            UnitLen::Yards => kittycad_modeling_cmds::units::UnitLength::Yards,
            UnitLen::Unknown => unreachable!(),
        }
    }
}

/// A unit of angle.
#[derive(Debug, Default, Clone, Copy, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema, Eq)]
#[ts(export)]
#[serde(tag = "type")]
pub enum UnitAngle {
    #[default]
    Degrees,
    Radians,
    Unknown,
}

impl UnitAngle {
    pub fn adjust_to(self, value: f64, to: UnitAngle) -> (f64, UnitAngle) {
        use std::f64::consts::PI;

        use UnitAngle::*;

        if to == Unknown {
            return (value, self);
        }

        let value = match (self, to) {
            (Degrees, Degrees) => value,
            (Degrees, Radians) => (value / 180.0) * PI,
            (Radians, Degrees) => 180.0 * value / PI,
            (Radians, Radians) => value,
            (Unknown, _) | (_, Unknown) => unreachable!(),
        };

        (value, to)
    }
}

impl std::fmt::Display for UnitAngle {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            UnitAngle::Degrees => write!(f, "deg"),
            UnitAngle::Radians => write!(f, "rad"),
            UnitAngle::Unknown => write!(f, "Angle"),
        }
    }
}

impl TryFrom<NumericSuffix> for UnitAngle {
    type Error = ();

    fn try_from(suffix: NumericSuffix) -> std::result::Result<Self, Self::Error> {
        match suffix {
            NumericSuffix::Deg => Ok(Self::Degrees),
            NumericSuffix::Rad => Ok(Self::Radians),
            _ => Err(()),
        }
    }
}

#[derive(Debug, Clone)]
pub struct CoercionError {
    pub found: Option<RuntimeType>,
    pub explicit_coercion: Option<String>,
}

impl CoercionError {
    fn with_explicit(mut self, c: String) -> Self {
        self.explicit_coercion = Some(c);
        self
    }
}

impl From<&'_ KclValue> for CoercionError {
    fn from(value: &'_ KclValue) -> Self {
        CoercionError {
            found: value.principal_type(),
            explicit_coercion: None,
        }
    }
}

impl KclValue {
    /// True if `self` has a type which is a subtype of `ty` without coercion.
    pub fn has_type(&self, ty: &RuntimeType) -> bool {
        let Some(self_ty) = self.principal_type() else {
            return false;
        };

        self_ty.subtype(ty)
    }

    /// Coerce `self` to a new value which has `ty` as its closest supertype.
    ///
    /// If the result is Ok, then:
    ///   - result.principal_type().unwrap().subtype(ty)
    ///
    /// If self.principal_type() == ty then result == self
    pub fn coerce(&self, ty: &RuntimeType, exec_state: &mut ExecState) -> Result<KclValue, CoercionError> {
        match ty {
            RuntimeType::Primitive(ty) => self.coerce_to_primitive_type(ty, exec_state),
            RuntimeType::Array(ty, len) => self.coerce_to_array_type(ty, *len, exec_state, false),
            RuntimeType::Tuple(tys) => self.coerce_to_tuple_type(tys, exec_state),
            RuntimeType::Union(tys) => self.coerce_to_union_type(tys, exec_state),
            RuntimeType::Object(tys) => self.coerce_to_object_type(tys, exec_state),
        }
    }

    fn coerce_to_primitive_type(
        &self,
        ty: &PrimitiveType,
        exec_state: &mut ExecState,
    ) -> Result<KclValue, CoercionError> {
        let value = match self {
            KclValue::Tuple { value, .. } | KclValue::HomArray { value, .. } if value.len() == 1 => &value[0],
            _ => self,
        };
        match ty {
            PrimitiveType::Any => Ok(value.clone()),
            PrimitiveType::Number(ty) => ty.coerce(value),
            PrimitiveType::String => match value {
                KclValue::String { .. } => Ok(value.clone()),
                _ => Err(self.into()),
            },
            PrimitiveType::Boolean => match value {
                KclValue::Bool { .. } => Ok(value.clone()),
                _ => Err(self.into()),
            },
            PrimitiveType::Sketch => match value {
                KclValue::Sketch { .. } => Ok(value.clone()),
                _ => Err(self.into()),
            },
            PrimitiveType::Solid => match value {
                KclValue::Solid { .. } => Ok(value.clone()),
                _ => Err(self.into()),
            },
            PrimitiveType::Plane => match value {
                KclValue::String { value: s, .. }
                    if [
                        "xy", "xz", "yz", "-xy", "-xz", "-yz", "XY", "XZ", "YZ", "-XY", "-XZ", "-YZ",
                    ]
                    .contains(&&**s) =>
                {
                    Ok(value.clone())
                }
                KclValue::Plane { .. } => Ok(value.clone()),
                KclValue::Object { value, meta } => {
                    let origin = value
                        .get("origin")
                        .and_then(Point3d::from_kcl_val)
                        .ok_or(CoercionError::from(self))?;
                    let x_axis = value
                        .get("xAxis")
                        .and_then(Point3d::from_kcl_val)
                        .ok_or(CoercionError::from(self))?;
                    let y_axis = value
                        .get("yAxis")
                        .and_then(Point3d::from_kcl_val)
                        .ok_or(CoercionError::from(self))?;

                    if value.get("zAxis").is_some() {
                        exec_state.warn(CompilationError::err(
                            self.into(),
                            "Object with a zAxis field is being coerced into a plane, but the zAxis is ignored.",
                        ));
                    }

                    let id = exec_state.mod_local.id_generator.next_uuid();
                    let plane = Plane {
                        id,
                        #[cfg(feature = "artifact-graph")]
                        artifact_id: id.into(),
                        info: PlaneInfo {
                            origin,
                            x_axis: x_axis.normalize(),
                            y_axis: y_axis.normalize(),
                        },
                        value: super::PlaneType::Uninit,
                        meta: meta.clone(),
                    };

                    Ok(KclValue::Plane { value: Box::new(plane) })
                }
                _ => Err(self.into()),
            },
            PrimitiveType::Face => match value {
                KclValue::Face { .. } => Ok(value.clone()),
                _ => Err(self.into()),
            },
            PrimitiveType::Helix => match value {
                KclValue::Helix { .. } => Ok(value.clone()),
                _ => Err(self.into()),
            },
            PrimitiveType::Edge => match value {
                KclValue::Uuid { .. } => Ok(value.clone()),
                KclValue::TagIdentifier { .. } => Ok(value.clone()),
                _ => Err(self.into()),
            },
            PrimitiveType::Axis2d => match value {
                KclValue::Object { value: values, meta } => {
                    if values
                        .get("origin")
                        .ok_or(CoercionError::from(self))?
                        .has_type(&RuntimeType::point2d())
                        && values
                            .get("direction")
                            .ok_or(CoercionError::from(self))?
                            .has_type(&RuntimeType::point2d())
                    {
                        return Ok(value.clone());
                    }

                    let origin = values.get("origin").ok_or(self.into()).and_then(|p| {
                        p.coerce_to_array_type(&RuntimeType::length(), ArrayLen::Known(2), exec_state, true)
                    })?;
                    let direction = values.get("direction").ok_or(self.into()).and_then(|p| {
                        p.coerce_to_array_type(&RuntimeType::length(), ArrayLen::Known(2), exec_state, true)
                    })?;

                    Ok(KclValue::Object {
                        value: [("origin".to_owned(), origin), ("direction".to_owned(), direction)].into(),
                        meta: meta.clone(),
                    })
                }
                _ => Err(self.into()),
            },
            PrimitiveType::Axis3d => match value {
                KclValue::Object { value: values, meta } => {
                    if values
                        .get("origin")
                        .ok_or(CoercionError::from(self))?
                        .has_type(&RuntimeType::point3d())
                        && values
                            .get("direction")
                            .ok_or(CoercionError::from(self))?
                            .has_type(&RuntimeType::point3d())
                    {
                        return Ok(value.clone());
                    }

                    let origin = values.get("origin").ok_or(self.into()).and_then(|p| {
                        p.coerce_to_array_type(&RuntimeType::length(), ArrayLen::Known(3), exec_state, true)
                    })?;
                    let direction = values.get("direction").ok_or(self.into()).and_then(|p| {
                        p.coerce_to_array_type(&RuntimeType::length(), ArrayLen::Known(3), exec_state, true)
                    })?;

                    Ok(KclValue::Object {
                        value: [("origin".to_owned(), origin), ("direction".to_owned(), direction)].into(),
                        meta: meta.clone(),
                    })
                }
                _ => Err(self.into()),
            },
            PrimitiveType::ImportedGeometry => match value {
                KclValue::ImportedGeometry { .. } => Ok(value.clone()),
                _ => Err(self.into()),
            },
            PrimitiveType::Function => match value {
                KclValue::Function { .. } => Ok(value.clone()),
                _ => Err(self.into()),
            },
            PrimitiveType::TagId => match value {
                KclValue::TagIdentifier { .. } => Ok(value.clone()),
                _ => Err(self.into()),
            },
            PrimitiveType::Tag => match value {
                KclValue::TagDeclarator { .. } | KclValue::TagIdentifier { .. } | KclValue::Uuid { .. } => {
                    Ok(value.clone())
                }
                s @ KclValue::String { value, .. } if ["start", "end", "START", "END"].contains(&&**value) => {
                    Ok(s.clone())
                }
                _ => Err(self.into()),
            },
        }
    }

    fn coerce_to_array_type(
        &self,
        ty: &RuntimeType,
        len: ArrayLen,
        exec_state: &mut ExecState,
        allow_shrink: bool,
    ) -> Result<KclValue, CoercionError> {
        match self {
            KclValue::HomArray { value, ty: aty, .. } => {
                let satisfied_len = len.satisfied(value.len(), allow_shrink);

                if aty.subtype(ty) {
                    // If the element type is a subtype of the target type and
                    // the length constraint is satisfied, we can just return
                    // the values unchanged, only adjusting the length. The new
                    // array element type should preserve its type because the
                    // target type oftentimes includes an unknown type as a way
                    // to say that the caller doesn't care.
                    return satisfied_len
                        .map(|len| KclValue::HomArray {
                            value: value[..len].to_vec(),
                            ty: aty.clone(),
                        })
                        .ok_or(self.into());
                }

                // Ignore the array type, and coerce the elements of the array.
                if let Some(satisfied_len) = satisfied_len {
                    let value_result = value
                        .iter()
                        .take(satisfied_len)
                        .map(|v| v.coerce(ty, exec_state))
                        .collect::<Result<Vec<_>, _>>();

                    if let Ok(value) = value_result {
                        // We were able to coerce all the elements.
                        return Ok(KclValue::HomArray { value, ty: ty.clone() });
                    }
                }

                // As a last resort, try to flatten the array.
                let mut values = Vec::new();
                for item in value {
                    if let KclValue::HomArray { value: inner_value, .. } = item {
                        // Flatten elements.
                        for item in inner_value {
                            values.push(item.coerce(ty, exec_state)?);
                        }
                    } else {
                        values.push(item.coerce(ty, exec_state)?);
                    }
                }

                let len = len
                    .satisfied(values.len(), allow_shrink)
                    .ok_or(CoercionError::from(self))?;

                assert!(len <= values.len());
                values.truncate(len);

                Ok(KclValue::HomArray {
                    value: values,
                    ty: ty.clone(),
                })
            }
            KclValue::Tuple { value, .. } => {
                let len = len
                    .satisfied(value.len(), allow_shrink)
                    .ok_or(CoercionError::from(self))?;
                let value = value
                    .iter()
                    .map(|item| item.coerce(ty, exec_state))
                    .take(len)
                    .collect::<Result<Vec<_>, _>>()?;

                Ok(KclValue::HomArray { value, ty: ty.clone() })
            }
            KclValue::KclNone { .. } if len.satisfied(0, false).is_some() => Ok(KclValue::HomArray {
                value: Vec::new(),
                ty: ty.clone(),
            }),
            _ if len.satisfied(1, false).is_some() => Ok(KclValue::HomArray {
                value: vec![self.coerce(ty, exec_state)?],
                ty: ty.clone(),
            }),
            _ => Err(self.into()),
        }
    }

    fn coerce_to_tuple_type(&self, tys: &[RuntimeType], exec_state: &mut ExecState) -> Result<KclValue, CoercionError> {
        match self {
            KclValue::Tuple { value, .. } | KclValue::HomArray { value, .. } if value.len() == tys.len() => {
                let mut result = Vec::new();
                for (i, t) in tys.iter().enumerate() {
                    result.push(value[i].coerce(t, exec_state)?);
                }

                Ok(KclValue::Tuple {
                    value: result,
                    meta: Vec::new(),
                })
            }
            KclValue::KclNone { meta, .. } if tys.is_empty() => Ok(KclValue::Tuple {
                value: Vec::new(),
                meta: meta.clone(),
            }),
            value if tys.len() == 1 && value.has_type(&tys[0]) => Ok(KclValue::Tuple {
                value: vec![value.clone()],
                meta: Vec::new(),
            }),
            _ => Err(self.into()),
        }
    }

    fn coerce_to_union_type(&self, tys: &[RuntimeType], exec_state: &mut ExecState) -> Result<KclValue, CoercionError> {
        for t in tys {
            if let Ok(v) = self.coerce(t, exec_state) {
                return Ok(v);
            }
        }

        Err(self.into())
    }

    fn coerce_to_object_type(
        &self,
        tys: &[(String, RuntimeType)],
        _exec_state: &mut ExecState,
    ) -> Result<KclValue, CoercionError> {
        match self {
            KclValue::Object { value, .. } => {
                for (s, t) in tys {
                    // TODO coerce fields
                    if !value.get(s).ok_or(CoercionError::from(self))?.has_type(t) {
                        return Err(self.into());
                    }
                }
                // TODO remove non-required fields
                Ok(self.clone())
            }
            KclValue::KclNone { meta, .. } if tys.is_empty() => Ok(KclValue::Object {
                value: HashMap::new(),
                meta: meta.clone(),
            }),
            _ => Err(self.into()),
        }
    }

    pub fn principal_type(&self) -> Option<RuntimeType> {
        match self {
            KclValue::Bool { .. } => Some(RuntimeType::Primitive(PrimitiveType::Boolean)),
            KclValue::Number { ty, .. } => Some(RuntimeType::Primitive(PrimitiveType::Number(ty.clone()))),
            KclValue::String { .. } => Some(RuntimeType::Primitive(PrimitiveType::String)),
            KclValue::Object { value, .. } => {
                let properties = value
                    .iter()
                    .map(|(k, v)| v.principal_type().map(|t| (k.clone(), t)))
                    .collect::<Option<Vec<_>>>()?;
                Some(RuntimeType::Object(properties))
            }
            KclValue::Plane { .. } => Some(RuntimeType::Primitive(PrimitiveType::Plane)),
            KclValue::Sketch { .. } => Some(RuntimeType::Primitive(PrimitiveType::Sketch)),
            KclValue::Solid { .. } => Some(RuntimeType::Primitive(PrimitiveType::Solid)),
            KclValue::Face { .. } => Some(RuntimeType::Primitive(PrimitiveType::Face)),
            KclValue::Helix { .. } => Some(RuntimeType::Primitive(PrimitiveType::Helix)),
            KclValue::ImportedGeometry(..) => Some(RuntimeType::Primitive(PrimitiveType::ImportedGeometry)),
            KclValue::Tuple { value, .. } => Some(RuntimeType::Tuple(
                value.iter().map(|v| v.principal_type()).collect::<Option<Vec<_>>>()?,
            )),
            KclValue::HomArray { ty, value, .. } => {
                Some(RuntimeType::Array(Box::new(ty.clone()), ArrayLen::Known(value.len())))
            }
            KclValue::TagIdentifier(_) => Some(RuntimeType::Primitive(PrimitiveType::TagId)),
            KclValue::TagDeclarator(_) | KclValue::Uuid { .. } => Some(RuntimeType::Primitive(PrimitiveType::Tag)),
            KclValue::Function { .. } => Some(RuntimeType::Primitive(PrimitiveType::Function)),
            KclValue::Module { .. } | KclValue::KclNone { .. } | KclValue::Type { .. } => None,
        }
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use crate::execution::{parse_execute, ExecTestResults};

    fn values(exec_state: &mut ExecState) -> Vec<KclValue> {
        vec![
            KclValue::Bool {
                value: true,
                meta: Vec::new(),
            },
            KclValue::Number {
                value: 1.0,
                ty: NumericType::count(),
                meta: Vec::new(),
            },
            KclValue::String {
                value: "hello".to_owned(),
                meta: Vec::new(),
            },
            KclValue::Tuple {
                value: Vec::new(),
                meta: Vec::new(),
            },
            KclValue::HomArray {
                value: Vec::new(),
                ty: RuntimeType::solid(),
            },
            KclValue::Object {
                value: crate::execution::KclObjectFields::new(),
                meta: Vec::new(),
            },
            KclValue::TagIdentifier(Box::new("foo".parse().unwrap())),
            KclValue::TagDeclarator(Box::new(crate::parsing::ast::types::TagDeclarator::new("foo"))),
            KclValue::Plane {
                value: Box::new(Plane::from_plane_data(crate::std::sketch::PlaneData::XY, exec_state).unwrap()),
            },
            // No easy way to make a Face, Sketch, Solid, or Helix
            KclValue::ImportedGeometry(crate::execution::ImportedGeometry::new(
                uuid::Uuid::nil(),
                Vec::new(),
                Vec::new(),
            )),
            // Other values don't have types
        ]
    }

    #[track_caller]
    fn assert_coerce_results(
        value: &KclValue,
        super_type: &RuntimeType,
        expected_value: &KclValue,
        exec_state: &mut ExecState,
    ) {
        let is_subtype = value == expected_value;
        assert_eq!(&value.coerce(super_type, exec_state).unwrap(), expected_value);
        assert_eq!(
            is_subtype,
            value.principal_type().is_some() && value.principal_type().unwrap().subtype(super_type),
            "{:?} <: {super_type:?} should be {is_subtype}",
            value.principal_type().unwrap()
        );
        assert!(
            expected_value.principal_type().unwrap().subtype(super_type),
            "{} <: {super_type}",
            expected_value.principal_type().unwrap()
        )
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn coerce_idempotent() {
        let mut exec_state = ExecState::new(&crate::ExecutorContext::new_mock().await);
        let values = values(&mut exec_state);
        for v in &values {
            // Identity subtype
            let ty = v.principal_type().unwrap();
            assert_coerce_results(v, &ty, v, &mut exec_state);

            // Union subtype
            let uty1 = RuntimeType::Union(vec![ty.clone()]);
            let uty2 = RuntimeType::Union(vec![ty.clone(), RuntimeType::Primitive(PrimitiveType::Boolean)]);
            assert_coerce_results(v, &uty1, v, &mut exec_state);
            assert_coerce_results(v, &uty2, v, &mut exec_state);

            // Array subtypes
            let aty = RuntimeType::Array(Box::new(ty.clone()), ArrayLen::None);
            let aty1 = RuntimeType::Array(Box::new(ty.clone()), ArrayLen::Known(1));
            let aty0 = RuntimeType::Array(Box::new(ty.clone()), ArrayLen::NonEmpty);

            match v {
                KclValue::Tuple { .. } | KclValue::HomArray { .. } => {
                    // These will not get wrapped if possible.
                    assert_coerce_results(
                        v,
                        &aty,
                        &KclValue::HomArray {
                            value: vec![],
                            ty: ty.clone(),
                        },
                        &mut exec_state,
                    );
                    // Coercing an empty tuple or array to an array of length 1
                    // should fail.
                    v.coerce(&aty1, &mut exec_state).unwrap_err();
                    // Coercing an empty tuple or array to an array that's
                    // non-empty should fail.
                    v.coerce(&aty0, &mut exec_state).unwrap_err();
                }
                _ => {
                    assert_coerce_results(
                        v,
                        &aty,
                        &KclValue::HomArray {
                            value: vec![v.clone()],
                            ty: ty.clone(),
                        },
                        &mut exec_state,
                    );
                    assert_coerce_results(
                        v,
                        &aty1,
                        &KclValue::HomArray {
                            value: vec![v.clone()],
                            ty: ty.clone(),
                        },
                        &mut exec_state,
                    );
                    assert_coerce_results(
                        v,
                        &aty0,
                        &KclValue::HomArray {
                            value: vec![v.clone()],
                            ty: ty.clone(),
                        },
                        &mut exec_state,
                    );

                    // Tuple subtype
                    let tty = RuntimeType::Tuple(vec![ty.clone()]);
                    assert_coerce_results(
                        v,
                        &tty,
                        &KclValue::Tuple {
                            value: vec![v.clone()],
                            meta: Vec::new(),
                        },
                        &mut exec_state,
                    );
                }
            }
        }

        for v in &values[1..] {
            // Not a subtype
            v.coerce(&RuntimeType::Primitive(PrimitiveType::Boolean), &mut exec_state)
                .unwrap_err();
        }
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn coerce_none() {
        let mut exec_state = ExecState::new(&crate::ExecutorContext::new_mock().await);
        let none = KclValue::KclNone {
            value: crate::parsing::ast::types::KclNone::new(),
            meta: Vec::new(),
        };

        let aty = RuntimeType::Array(Box::new(RuntimeType::solid()), ArrayLen::None);
        let aty0 = RuntimeType::Array(Box::new(RuntimeType::solid()), ArrayLen::Known(0));
        let aty1 = RuntimeType::Array(Box::new(RuntimeType::solid()), ArrayLen::Known(1));
        let aty1p = RuntimeType::Array(Box::new(RuntimeType::solid()), ArrayLen::NonEmpty);
        assert_coerce_results(
            &none,
            &aty,
            &KclValue::HomArray {
                value: Vec::new(),
                ty: RuntimeType::solid(),
            },
            &mut exec_state,
        );
        assert_coerce_results(
            &none,
            &aty0,
            &KclValue::HomArray {
                value: Vec::new(),
                ty: RuntimeType::solid(),
            },
            &mut exec_state,
        );
        none.coerce(&aty1, &mut exec_state).unwrap_err();
        none.coerce(&aty1p, &mut exec_state).unwrap_err();

        let tty = RuntimeType::Tuple(vec![]);
        let tty1 = RuntimeType::Tuple(vec![RuntimeType::solid()]);
        assert_coerce_results(
            &none,
            &tty,
            &KclValue::Tuple {
                value: Vec::new(),
                meta: Vec::new(),
            },
            &mut exec_state,
        );
        none.coerce(&tty1, &mut exec_state).unwrap_err();

        let oty = RuntimeType::Object(vec![]);
        assert_coerce_results(
            &none,
            &oty,
            &KclValue::Object {
                value: HashMap::new(),
                meta: Vec::new(),
            },
            &mut exec_state,
        );
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn coerce_record() {
        let mut exec_state = ExecState::new(&crate::ExecutorContext::new_mock().await);

        let obj0 = KclValue::Object {
            value: HashMap::new(),
            meta: Vec::new(),
        };
        let obj1 = KclValue::Object {
            value: [(
                "foo".to_owned(),
                KclValue::Bool {
                    value: true,
                    meta: Vec::new(),
                },
            )]
            .into(),
            meta: Vec::new(),
        };
        let obj2 = KclValue::Object {
            value: [
                (
                    "foo".to_owned(),
                    KclValue::Bool {
                        value: true,
                        meta: Vec::new(),
                    },
                ),
                (
                    "bar".to_owned(),
                    KclValue::Number {
                        value: 0.0,
                        ty: NumericType::count(),
                        meta: Vec::new(),
                    },
                ),
                (
                    "baz".to_owned(),
                    KclValue::Number {
                        value: 42.0,
                        ty: NumericType::count(),
                        meta: Vec::new(),
                    },
                ),
            ]
            .into(),
            meta: Vec::new(),
        };

        let ty0 = RuntimeType::Object(vec![]);
        assert_coerce_results(&obj0, &ty0, &obj0, &mut exec_state);
        assert_coerce_results(&obj1, &ty0, &obj1, &mut exec_state);
        assert_coerce_results(&obj2, &ty0, &obj2, &mut exec_state);

        let ty1 = RuntimeType::Object(vec![("foo".to_owned(), RuntimeType::Primitive(PrimitiveType::Boolean))]);
        obj0.coerce(&ty1, &mut exec_state).unwrap_err();
        assert_coerce_results(&obj1, &ty1, &obj1, &mut exec_state);
        assert_coerce_results(&obj2, &ty1, &obj2, &mut exec_state);

        // Different ordering, (TODO - test for covariance once implemented)
        let ty2 = RuntimeType::Object(vec![
            (
                "bar".to_owned(),
                RuntimeType::Primitive(PrimitiveType::Number(NumericType::count())),
            ),
            ("foo".to_owned(), RuntimeType::Primitive(PrimitiveType::Boolean)),
        ]);
        obj0.coerce(&ty2, &mut exec_state).unwrap_err();
        obj1.coerce(&ty2, &mut exec_state).unwrap_err();
        assert_coerce_results(&obj2, &ty2, &obj2, &mut exec_state);

        // field not present
        let tyq = RuntimeType::Object(vec![("qux".to_owned(), RuntimeType::Primitive(PrimitiveType::Boolean))]);
        obj0.coerce(&tyq, &mut exec_state).unwrap_err();
        obj1.coerce(&tyq, &mut exec_state).unwrap_err();
        obj2.coerce(&tyq, &mut exec_state).unwrap_err();

        // field with different type
        let ty1 = RuntimeType::Object(vec![("bar".to_owned(), RuntimeType::Primitive(PrimitiveType::Boolean))]);
        obj2.coerce(&ty1, &mut exec_state).unwrap_err();
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn coerce_array() {
        let mut exec_state = ExecState::new(&crate::ExecutorContext::new_mock().await);

        let hom_arr = KclValue::HomArray {
            value: vec![
                KclValue::Number {
                    value: 0.0,
                    ty: NumericType::count(),
                    meta: Vec::new(),
                },
                KclValue::Number {
                    value: 1.0,
                    ty: NumericType::count(),
                    meta: Vec::new(),
                },
                KclValue::Number {
                    value: 2.0,
                    ty: NumericType::count(),
                    meta: Vec::new(),
                },
                KclValue::Number {
                    value: 3.0,
                    ty: NumericType::count(),
                    meta: Vec::new(),
                },
            ],
            ty: RuntimeType::Primitive(PrimitiveType::Number(NumericType::count())),
        };
        let mixed1 = KclValue::Tuple {
            value: vec![
                KclValue::Number {
                    value: 0.0,
                    ty: NumericType::count(),
                    meta: Vec::new(),
                },
                KclValue::Number {
                    value: 1.0,
                    ty: NumericType::count(),
                    meta: Vec::new(),
                },
            ],
            meta: Vec::new(),
        };
        let mixed2 = KclValue::Tuple {
            value: vec![
                KclValue::Number {
                    value: 0.0,
                    ty: NumericType::count(),
                    meta: Vec::new(),
                },
                KclValue::Bool {
                    value: true,
                    meta: Vec::new(),
                },
            ],
            meta: Vec::new(),
        };

        // Principal types
        let tyh = RuntimeType::Array(
            Box::new(RuntimeType::Primitive(PrimitiveType::Number(NumericType::count()))),
            ArrayLen::Known(4),
        );
        let tym1 = RuntimeType::Tuple(vec![
            RuntimeType::Primitive(PrimitiveType::Number(NumericType::count())),
            RuntimeType::Primitive(PrimitiveType::Number(NumericType::count())),
        ]);
        let tym2 = RuntimeType::Tuple(vec![
            RuntimeType::Primitive(PrimitiveType::Number(NumericType::count())),
            RuntimeType::Primitive(PrimitiveType::Boolean),
        ]);
        assert_coerce_results(&hom_arr, &tyh, &hom_arr, &mut exec_state);
        assert_coerce_results(&mixed1, &tym1, &mixed1, &mut exec_state);
        assert_coerce_results(&mixed2, &tym2, &mixed2, &mut exec_state);
        mixed1.coerce(&tym2, &mut exec_state).unwrap_err();
        mixed2.coerce(&tym1, &mut exec_state).unwrap_err();

        // Length subtyping
        let tyhn = RuntimeType::Array(
            Box::new(RuntimeType::Primitive(PrimitiveType::Number(NumericType::count()))),
            ArrayLen::None,
        );
        let tyh1 = RuntimeType::Array(
            Box::new(RuntimeType::Primitive(PrimitiveType::Number(NumericType::count()))),
            ArrayLen::NonEmpty,
        );
        let tyh3 = RuntimeType::Array(
            Box::new(RuntimeType::Primitive(PrimitiveType::Number(NumericType::count()))),
            ArrayLen::Known(3),
        );
        assert_coerce_results(&hom_arr, &tyhn, &hom_arr, &mut exec_state);
        assert_coerce_results(&hom_arr, &tyh1, &hom_arr, &mut exec_state);
        hom_arr.coerce(&tyh3, &mut exec_state).unwrap_err();

        let hom_arr0 = KclValue::HomArray {
            value: vec![],
            ty: RuntimeType::Primitive(PrimitiveType::Number(NumericType::count())),
        };
        assert_coerce_results(&hom_arr0, &tyhn, &hom_arr0, &mut exec_state);
        hom_arr0.coerce(&tyh1, &mut exec_state).unwrap_err();
        hom_arr0.coerce(&tyh3, &mut exec_state).unwrap_err();

        // Covariance
        // let tyh = RuntimeType::Array(Box::new(RuntimeType::Primitive(PrimitiveType::Number(NumericType::Any))), ArrayLen::Known(4));
        let tym1 = RuntimeType::Tuple(vec![
            RuntimeType::Primitive(PrimitiveType::Number(NumericType::Any)),
            RuntimeType::Primitive(PrimitiveType::Number(NumericType::count())),
        ]);
        let tym2 = RuntimeType::Tuple(vec![
            RuntimeType::Primitive(PrimitiveType::Number(NumericType::Any)),
            RuntimeType::Primitive(PrimitiveType::Boolean),
        ]);
        // TODO implement covariance for homogeneous arrays
        // assert_coerce_results(&hom_arr, &tyh, &hom_arr, &mut exec_state);
        assert_coerce_results(&mixed1, &tym1, &mixed1, &mut exec_state);
        assert_coerce_results(&mixed2, &tym2, &mixed2, &mut exec_state);

        // Mixed to homogeneous
        let hom_arr_2 = KclValue::HomArray {
            value: vec![
                KclValue::Number {
                    value: 0.0,
                    ty: NumericType::count(),
                    meta: Vec::new(),
                },
                KclValue::Number {
                    value: 1.0,
                    ty: NumericType::count(),
                    meta: Vec::new(),
                },
            ],
            ty: RuntimeType::Primitive(PrimitiveType::Number(NumericType::count())),
        };
        let mixed0 = KclValue::Tuple {
            value: vec![],
            meta: Vec::new(),
        };
        assert_coerce_results(&mixed1, &tyhn, &hom_arr_2, &mut exec_state);
        assert_coerce_results(&mixed1, &tyh1, &hom_arr_2, &mut exec_state);
        assert_coerce_results(&mixed0, &tyhn, &hom_arr0, &mut exec_state);
        mixed0.coerce(&tyh, &mut exec_state).unwrap_err();
        mixed0.coerce(&tyh1, &mut exec_state).unwrap_err();

        // Homogehous to mixed
        assert_coerce_results(&hom_arr_2, &tym1, &mixed1, &mut exec_state);
        hom_arr.coerce(&tym1, &mut exec_state).unwrap_err();
        hom_arr_2.coerce(&tym2, &mut exec_state).unwrap_err();

        mixed0.coerce(&tym1, &mut exec_state).unwrap_err();
        mixed0.coerce(&tym2, &mut exec_state).unwrap_err();
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn coerce_union() {
        let mut exec_state = ExecState::new(&crate::ExecutorContext::new_mock().await);

        // Subtyping smaller unions
        assert!(RuntimeType::Union(vec![]).subtype(&RuntimeType::Union(vec![
            RuntimeType::Primitive(PrimitiveType::Number(NumericType::Any)),
            RuntimeType::Primitive(PrimitiveType::Boolean)
        ])));
        assert!(
            RuntimeType::Union(vec![RuntimeType::Primitive(PrimitiveType::Number(NumericType::Any))]).subtype(
                &RuntimeType::Union(vec![
                    RuntimeType::Primitive(PrimitiveType::Number(NumericType::Any)),
                    RuntimeType::Primitive(PrimitiveType::Boolean)
                ])
            )
        );
        assert!(RuntimeType::Union(vec![
            RuntimeType::Primitive(PrimitiveType::Number(NumericType::Any)),
            RuntimeType::Primitive(PrimitiveType::Boolean)
        ])
        .subtype(&RuntimeType::Union(vec![
            RuntimeType::Primitive(PrimitiveType::Number(NumericType::Any)),
            RuntimeType::Primitive(PrimitiveType::Boolean)
        ])));

        // Covariance
        let count = KclValue::Number {
            value: 1.0,
            ty: NumericType::count(),
            meta: Vec::new(),
        };

        let tya = RuntimeType::Union(vec![RuntimeType::Primitive(PrimitiveType::Number(NumericType::Any))]);
        let tya2 = RuntimeType::Union(vec![
            RuntimeType::Primitive(PrimitiveType::Number(NumericType::Any)),
            RuntimeType::Primitive(PrimitiveType::Boolean),
        ]);
        assert_coerce_results(&count, &tya, &count, &mut exec_state);
        assert_coerce_results(&count, &tya2, &count, &mut exec_state);

        // No matching type
        let tyb = RuntimeType::Union(vec![RuntimeType::Primitive(PrimitiveType::Boolean)]);
        let tyb2 = RuntimeType::Union(vec![
            RuntimeType::Primitive(PrimitiveType::Boolean),
            RuntimeType::Primitive(PrimitiveType::String),
        ]);
        count.coerce(&tyb, &mut exec_state).unwrap_err();
        count.coerce(&tyb2, &mut exec_state).unwrap_err();
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn coerce_axes() {
        let mut exec_state = ExecState::new(&crate::ExecutorContext::new_mock().await);

        // Subtyping
        assert!(RuntimeType::Primitive(PrimitiveType::Axis2d).subtype(&RuntimeType::Primitive(PrimitiveType::Axis2d)));
        assert!(RuntimeType::Primitive(PrimitiveType::Axis3d).subtype(&RuntimeType::Primitive(PrimitiveType::Axis3d)));
        assert!(!RuntimeType::Primitive(PrimitiveType::Axis3d).subtype(&RuntimeType::Primitive(PrimitiveType::Axis2d)));
        assert!(!RuntimeType::Primitive(PrimitiveType::Axis2d).subtype(&RuntimeType::Primitive(PrimitiveType::Axis3d)));

        // Coercion
        let a2d = KclValue::Object {
            value: [
                (
                    "origin".to_owned(),
                    KclValue::HomArray {
                        value: vec![
                            KclValue::Number {
                                value: 0.0,
                                ty: NumericType::mm(),
                                meta: Vec::new(),
                            },
                            KclValue::Number {
                                value: 0.0,
                                ty: NumericType::mm(),
                                meta: Vec::new(),
                            },
                        ],
                        ty: RuntimeType::Primitive(PrimitiveType::Number(NumericType::mm())),
                    },
                ),
                (
                    "direction".to_owned(),
                    KclValue::HomArray {
                        value: vec![
                            KclValue::Number {
                                value: 1.0,
                                ty: NumericType::mm(),
                                meta: Vec::new(),
                            },
                            KclValue::Number {
                                value: 0.0,
                                ty: NumericType::mm(),
                                meta: Vec::new(),
                            },
                        ],
                        ty: RuntimeType::Primitive(PrimitiveType::Number(NumericType::mm())),
                    },
                ),
            ]
            .into(),
            meta: Vec::new(),
        };
        let a3d = KclValue::Object {
            value: [
                (
                    "origin".to_owned(),
                    KclValue::HomArray {
                        value: vec![
                            KclValue::Number {
                                value: 0.0,
                                ty: NumericType::mm(),
                                meta: Vec::new(),
                            },
                            KclValue::Number {
                                value: 0.0,
                                ty: NumericType::mm(),
                                meta: Vec::new(),
                            },
                            KclValue::Number {
                                value: 0.0,
                                ty: NumericType::mm(),
                                meta: Vec::new(),
                            },
                        ],
                        ty: RuntimeType::Primitive(PrimitiveType::Number(NumericType::mm())),
                    },
                ),
                (
                    "direction".to_owned(),
                    KclValue::HomArray {
                        value: vec![
                            KclValue::Number {
                                value: 1.0,
                                ty: NumericType::mm(),
                                meta: Vec::new(),
                            },
                            KclValue::Number {
                                value: 0.0,
                                ty: NumericType::mm(),
                                meta: Vec::new(),
                            },
                            KclValue::Number {
                                value: 1.0,
                                ty: NumericType::mm(),
                                meta: Vec::new(),
                            },
                        ],
                        ty: RuntimeType::Primitive(PrimitiveType::Number(NumericType::mm())),
                    },
                ),
            ]
            .into(),
            meta: Vec::new(),
        };

        let ty2d = RuntimeType::Primitive(PrimitiveType::Axis2d);
        let ty3d = RuntimeType::Primitive(PrimitiveType::Axis3d);

        assert_coerce_results(&a2d, &ty2d, &a2d, &mut exec_state);
        assert_coerce_results(&a3d, &ty3d, &a3d, &mut exec_state);
        assert_coerce_results(&a3d, &ty2d, &a2d, &mut exec_state);
        a2d.coerce(&ty3d, &mut exec_state).unwrap_err();
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn coerce_numeric() {
        let mut exec_state = ExecState::new(&crate::ExecutorContext::new_mock().await);

        let count = KclValue::Number {
            value: 1.0,
            ty: NumericType::count(),
            meta: Vec::new(),
        };
        let mm = KclValue::Number {
            value: 1.0,
            ty: NumericType::mm(),
            meta: Vec::new(),
        };
        let inches = KclValue::Number {
            value: 1.0,
            ty: NumericType::Known(UnitType::Length(UnitLen::Inches)),
            meta: Vec::new(),
        };
        let rads = KclValue::Number {
            value: 1.0,
            ty: NumericType::Known(UnitType::Angle(UnitAngle::Radians)),
            meta: Vec::new(),
        };
        let default = KclValue::Number {
            value: 1.0,
            ty: NumericType::default(),
            meta: Vec::new(),
        };
        let any = KclValue::Number {
            value: 1.0,
            ty: NumericType::Any,
            meta: Vec::new(),
        };
        let unknown = KclValue::Number {
            value: 1.0,
            ty: NumericType::Unknown,
            meta: Vec::new(),
        };

        // Trivial coercions
        assert_coerce_results(&count, &NumericType::count().into(), &count, &mut exec_state);
        assert_coerce_results(&mm, &NumericType::mm().into(), &mm, &mut exec_state);
        assert_coerce_results(&any, &NumericType::Any.into(), &any, &mut exec_state);
        assert_coerce_results(&unknown, &NumericType::Unknown.into(), &unknown, &mut exec_state);
        assert_coerce_results(&default, &NumericType::default().into(), &default, &mut exec_state);

        assert_coerce_results(&count, &NumericType::Any.into(), &count, &mut exec_state);
        assert_coerce_results(&mm, &NumericType::Any.into(), &mm, &mut exec_state);
        assert_coerce_results(&unknown, &NumericType::Any.into(), &unknown, &mut exec_state);
        assert_coerce_results(&default, &NumericType::Any.into(), &default, &mut exec_state);

        assert_eq!(
            default
                .coerce(
                    &NumericType::Default {
                        len: UnitLen::Yards,
                        angle: UnitAngle::default()
                    }
                    .into(),
                    &mut exec_state
                )
                .unwrap(),
            default
        );

        // No coercion
        count.coerce(&NumericType::mm().into(), &mut exec_state).unwrap_err();
        mm.coerce(&NumericType::count().into(), &mut exec_state).unwrap_err();
        unknown.coerce(&NumericType::mm().into(), &mut exec_state).unwrap_err();
        unknown
            .coerce(&NumericType::default().into(), &mut exec_state)
            .unwrap_err();

        count.coerce(&NumericType::Unknown.into(), &mut exec_state).unwrap_err();
        mm.coerce(&NumericType::Unknown.into(), &mut exec_state).unwrap_err();
        default
            .coerce(&NumericType::Unknown.into(), &mut exec_state)
            .unwrap_err();

        assert_eq!(
            inches
                .coerce(&NumericType::mm().into(), &mut exec_state)
                .unwrap()
                .as_f64()
                .unwrap()
                .round(),
            25.0
        );
        assert_eq!(
            rads.coerce(
                &NumericType::Known(UnitType::Angle(UnitAngle::Degrees)).into(),
                &mut exec_state
            )
            .unwrap()
            .as_f64()
            .unwrap()
            .round(),
            57.0
        );
        assert_eq!(
            inches
                .coerce(&NumericType::default().into(), &mut exec_state)
                .unwrap()
                .as_f64()
                .unwrap()
                .round(),
            1.0
        );
        assert_eq!(
            rads.coerce(&NumericType::default().into(), &mut exec_state)
                .unwrap()
                .as_f64()
                .unwrap()
                .round(),
            1.0
        );
    }

    #[track_caller]
    fn assert_value_and_type(name: &str, result: &ExecTestResults, expected: f64, expected_ty: NumericType) {
        let mem = result.exec_state.stack();
        match mem
            .memory
            .get_from(name, result.mem_env, SourceRange::default(), 0)
            .unwrap()
        {
            KclValue::Number { value, ty, .. } => {
                assert_eq!(value.round(), expected);
                assert_eq!(*ty, expected_ty);
            }
            _ => unreachable!(),
        }
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn combine_numeric() {
        let program = r#"a = 5 + 4
b = 5 - 2
c = 5mm - 2mm + 10mm
d = 5mm - 2 + 10
e = 5 - 2mm + 10
f = 30mm - 1inch

g = 2 * 10
h = 2 * 10mm
i = 2mm * 10mm
j = 2_ * 10
k = 2_ * 3mm * 3mm

l = 1 / 10
m = 2mm / 1mm
n = 10inch / 2mm
o = 3mm / 3
p = 3_ / 4
q = 4inch / 2_

r = min([0, 3, 42])
s = min([0, 3mm, -42])
t = min([100, 3in, 142mm])
u = min([3rad, 4in])
"#;

        let result = parse_execute(program).await.unwrap();
        assert_eq!(
            result.exec_state.errors().len(),
            5,
            "errors: {:?}",
            result.exec_state.errors()
        );

        assert_value_and_type("a", &result, 9.0, NumericType::default());
        assert_value_and_type("b", &result, 3.0, NumericType::default());
        assert_value_and_type("c", &result, 13.0, NumericType::mm());
        assert_value_and_type("d", &result, 13.0, NumericType::mm());
        assert_value_and_type("e", &result, 13.0, NumericType::mm());
        assert_value_and_type("f", &result, 5.0, NumericType::mm());

        assert_value_and_type("g", &result, 20.0, NumericType::default());
        assert_value_and_type("h", &result, 20.0, NumericType::mm());
        assert_value_and_type("i", &result, 20.0, NumericType::Unknown);
        assert_value_and_type("j", &result, 20.0, NumericType::default());
        assert_value_and_type("k", &result, 18.0, NumericType::Unknown);

        assert_value_and_type("l", &result, 0.0, NumericType::default());
        assert_value_and_type("m", &result, 2.0, NumericType::count());
        assert_value_and_type("n", &result, 5.0, NumericType::Unknown);
        assert_value_and_type("o", &result, 1.0, NumericType::mm());
        assert_value_and_type("p", &result, 1.0, NumericType::count());
        assert_value_and_type("q", &result, 2.0, NumericType::Known(UnitType::Length(UnitLen::Inches)));

        assert_value_and_type("r", &result, 0.0, NumericType::default());
        assert_value_and_type("s", &result, -42.0, NumericType::mm());
        assert_value_and_type("t", &result, 3.0, NumericType::Unknown);
        assert_value_and_type("u", &result, 3.0, NumericType::Unknown);
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn bad_typed_arithmetic() {
        let program = r#"
a = 1rad
b = 180 / PI * a + 360
"#;

        let result = parse_execute(program).await.unwrap();

        assert_value_and_type("a", &result, 1.0, NumericType::radians());
        assert_value_and_type("b", &result, 417.0, NumericType::Unknown);
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn cos_coercions() {
        let program = r#"
a = cos(units::toRadians(30))
b = 3 / a
c = cos(30deg)
d = cos(30)
"#;

        let result = parse_execute(program).await.unwrap();
        assert!(result.exec_state.errors().is_empty());

        assert_value_and_type("a", &result, 1.0, NumericType::count());
        assert_value_and_type("b", &result, 3.0, NumericType::default());
        assert_value_and_type("c", &result, 1.0, NumericType::count());
        assert_value_and_type("d", &result, 1.0, NumericType::count());
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn coerce_nested_array() {
        let mut exec_state = ExecState::new(&crate::ExecutorContext::new_mock().await);

        let mixed1 = KclValue::HomArray {
            value: vec![
                KclValue::Number {
                    value: 0.0,
                    ty: NumericType::count(),
                    meta: Vec::new(),
                },
                KclValue::Number {
                    value: 1.0,
                    ty: NumericType::count(),
                    meta: Vec::new(),
                },
                KclValue::HomArray {
                    value: vec![
                        KclValue::Number {
                            value: 2.0,
                            ty: NumericType::count(),
                            meta: Vec::new(),
                        },
                        KclValue::Number {
                            value: 3.0,
                            ty: NumericType::count(),
                            meta: Vec::new(),
                        },
                    ],
                    ty: RuntimeType::Primitive(PrimitiveType::Number(NumericType::count())),
                },
            ],
            ty: RuntimeType::any(),
        };

        // Principal types
        let tym1 = RuntimeType::Array(
            Box::new(RuntimeType::Primitive(PrimitiveType::Number(NumericType::count()))),
            ArrayLen::NonEmpty,
        );

        let result = KclValue::HomArray {
            value: vec![
                KclValue::Number {
                    value: 0.0,
                    ty: NumericType::count(),
                    meta: Vec::new(),
                },
                KclValue::Number {
                    value: 1.0,
                    ty: NumericType::count(),
                    meta: Vec::new(),
                },
                KclValue::Number {
                    value: 2.0,
                    ty: NumericType::count(),
                    meta: Vec::new(),
                },
                KclValue::Number {
                    value: 3.0,
                    ty: NumericType::count(),
                    meta: Vec::new(),
                },
            ],
            ty: RuntimeType::Primitive(PrimitiveType::Number(NumericType::count())),
        };
        assert_coerce_results(&mixed1, &tym1, &result, &mut exec_state);
    }
}
