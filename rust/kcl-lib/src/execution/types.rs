use std::{collections::HashMap, fmt};

use anyhow::Result;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::{
    execution::{
        kcl_value::{KclValue, TypeDef},
        memory::{self},
        ExecState, Plane, Point3d,
    },
    parsing::{
        ast::types::{PrimitiveType as AstPrimitiveType, Type},
        token::NumericSuffix,
    },
    std::args::FromKclValue,
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

    pub fn imported() -> Self {
        RuntimeType::Primitive(PrimitiveType::ImportedGeometry)
    }

    /// `[number; 2]`
    pub fn point2d() -> Self {
        RuntimeType::Array(Box::new(RuntimeType::number_any()), ArrayLen::Known(2))
    }

    /// `[number; 3]`
    pub fn point3d() -> Self {
        RuntimeType::Array(Box::new(RuntimeType::number_any()), ArrayLen::Known(3))
    }

    pub fn number_any() -> Self {
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
                Self::from_parsed_primitive(ty, exec_state, source_range).map(|t| RuntimeType::Array(Box::new(t), len))
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
            AstPrimitiveType::String => RuntimeType::Primitive(PrimitiveType::String),
            AstPrimitiveType::Boolean => RuntimeType::Primitive(PrimitiveType::Boolean),
            AstPrimitiveType::Number(suffix) => RuntimeType::Primitive(PrimitiveType::Number(
                NumericType::from_parsed(suffix, &exec_state.mod_local.settings),
            )),
            AstPrimitiveType::Named(name) => Self::from_alias(&name.name, exec_state, source_range)?,
            AstPrimitiveType::Tag => RuntimeType::Primitive(PrimitiveType::Tag),
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
                "an array with values of types ({})",
                tys.iter().map(Self::human_friendly_type).collect::<Vec<_>>().join(", ")
            ),
            RuntimeType::Object(_) => format!("an object with fields {}", self),
        }
    }

    // Subtype with no coercion, including refining numeric types.
    fn subtype(&self, sup: &RuntimeType) -> bool {
        use RuntimeType::*;

        match (self, sup) {
            (Primitive(t1), Primitive(t2)) => t1.subtype(t2),
            (Array(t1, l1), Array(t2, l2)) => t1.subtype(t2) && l1.subtype(*l2),
            (Tuple(t1), Tuple(t2)) => t1.len() == t2.len() && t1.iter().zip(t2).all(|(t1, t2)| t1.subtype(t2)),
            (Union(ts1), Union(ts2)) => ts1.iter().all(|t| ts2.contains(t)),
            (t1, Union(ts2)) => ts2.iter().any(|t| t1.subtype(t)),
            (Object(t1), Object(t2)) => t2
                .iter()
                .all(|(f, t)| t1.iter().any(|(ff, tt)| f == ff && tt.subtype(t))),
            // Equality between Axis types and there object representation.
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
            RuntimeType::Tuple(_) => "arrays".to_owned(),
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
                "[{}]",
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
    Number(NumericType),
    String,
    Boolean,
    Tag,
    Sketch,
    Solid,
    Plane,
    Helix,
    Face,
    Edge,
    Axis2d,
    Axis3d,
    ImportedGeometry,
}

impl PrimitiveType {
    fn display_multiple(&self) -> String {
        match self {
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
            PrimitiveType::Tag => "tags".to_owned(),
        }
    }

    fn subtype(&self, other: &PrimitiveType) -> bool {
        match (self, other) {
            (PrimitiveType::Number(n1), PrimitiveType::Number(n2)) => n1.subtype(n2),
            (t1, t2) => t1 == t2,
        }
    }
}

impl fmt::Display for PrimitiveType {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            PrimitiveType::Number(NumericType::Known(unit)) => write!(f, "number({unit})"),
            PrimitiveType::Number(_) => write!(f, "number"),
            PrimitiveType::String => write!(f, "string"),
            PrimitiveType::Boolean => write!(f, "bool"),
            PrimitiveType::Tag => write!(f, "tag"),
            PrimitiveType::Sketch => write!(f, "Sketch"),
            PrimitiveType::Solid => write!(f, "Solid"),
            PrimitiveType::Plane => write!(f, "Plane"),
            PrimitiveType::Face => write!(f, "Face"),
            PrimitiveType::Edge => write!(f, "Edge"),
            PrimitiveType::Axis2d => write!(f, "Axis2d"),
            PrimitiveType::Axis3d => write!(f, "Axis3d"),
            PrimitiveType::Helix => write!(f, "Helix"),
            PrimitiveType::ImportedGeometry => write!(f, "imported geometry"),
        }
    }
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
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

impl NumericType {
    pub fn count() -> Self {
        NumericType::Known(UnitType::Count)
    }

    pub fn mm() -> Self {
        NumericType::Known(UnitType::Length(UnitLen::Mm))
    }

    /// Combine two types when we expect them to be equal.
    pub fn combine_eq(self, other: &NumericType) -> NumericType {
        if &self == other {
            self
        } else {
            NumericType::Unknown
        }
    }

    /// Combine n types when we expect them to be equal.
    ///
    /// Precondition: tys.len() > 0
    pub fn combine_n_eq(tys: &[NumericType]) -> NumericType {
        let ty0 = tys[0].clone();
        for t in &tys[1..] {
            if t != &ty0 {
                return NumericType::Unknown;
            }
        }
        ty0
    }

    /// Combine two types in addition-like operations.
    pub fn combine_add(a: NumericType, b: NumericType) -> NumericType {
        if a == b {
            return a;
        }
        NumericType::Unknown
    }

    /// Combine two types in multiplication-like operations.
    pub fn combine_mul(a: NumericType, b: NumericType) -> NumericType {
        if a == NumericType::count() {
            return b;
        }
        if b == NumericType::count() {
            return a;
        }
        NumericType::Unknown
    }

    /// Combine two types in division-like operations.
    pub fn combine_div(a: NumericType, b: NumericType) -> NumericType {
        if b == NumericType::count() {
            return a;
        }
        NumericType::Unknown
    }

    pub fn from_parsed(suffix: NumericSuffix, settings: &super::MetaSettings) -> Self {
        match suffix {
            NumericSuffix::None => NumericType::Default {
                len: settings.default_length_units,
                angle: settings.default_angle_units,
            },
            NumericSuffix::Count => NumericType::Known(UnitType::Count),
            NumericSuffix::Mm => NumericType::Known(UnitType::Length(UnitLen::Mm)),
            NumericSuffix::Cm => NumericType::Known(UnitType::Length(UnitLen::Cm)),
            NumericSuffix::M => NumericType::Known(UnitType::Length(UnitLen::M)),
            NumericSuffix::Inch => NumericType::Known(UnitType::Length(UnitLen::Inches)),
            NumericSuffix::Ft => NumericType::Known(UnitType::Length(UnitLen::Feet)),
            NumericSuffix::Yd => NumericType::Known(UnitType::Length(UnitLen::Yards)),
            NumericSuffix::Deg => NumericType::Known(UnitType::Angle(UnitAngle::Degrees)),
            NumericSuffix::Rad => NumericType::Known(UnitType::Angle(UnitAngle::Radians)),
        }
    }

    fn subtype(&self, other: &NumericType) -> bool {
        use NumericType::*;

        match (self, other) {
            (Unknown, _) | (_, Unknown) => false,
            (a, b) if a == b => true,
            (_, Any) => true,
            (_, _) => false,
        }
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
            UnitType::Count => write!(f, "_"),
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
}

impl std::fmt::Display for UnitAngle {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            UnitAngle::Degrees => write!(f, "deg"),
            UnitAngle::Radians => write!(f, "rad"),
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

impl KclValue {
    /// True if `self` has a type which is a subtype of `ty` without coercion.
    pub fn has_type(&self, ty: &RuntimeType) -> bool {
        let Some(self_ty) = self.principal_type() else {
            return false;
        };

        self_ty.subtype(ty)
    }

    /// Coerce `self` to a new value which has `ty` as it's closest supertype.
    ///
    /// If the result is Some, then:
    ///   - result.principal_type().unwrap().subtype(ty)
    ///
    /// If self.principal_type() == ty then result == self
    pub fn coerce(&self, ty: &RuntimeType, exec_state: &mut ExecState) -> Option<KclValue> {
        match ty {
            RuntimeType::Primitive(ty) => self.coerce_to_primitive_type(ty, exec_state),
            RuntimeType::Array(ty, len) => self.coerce_to_array_type(ty, *len, exec_state, false),
            RuntimeType::Tuple(tys) => self.coerce_to_tuple_type(tys, exec_state),
            RuntimeType::Union(tys) => self.coerce_to_union_type(tys, exec_state),
            RuntimeType::Object(tys) => self.coerce_to_object_type(tys, exec_state),
        }
    }

    fn coerce_to_primitive_type(&self, ty: &PrimitiveType, exec_state: &mut ExecState) -> Option<KclValue> {
        let value = match self {
            KclValue::MixedArray { value, .. } | KclValue::HomArray { value, .. } if value.len() == 1 => &value[0],
            _ => self,
        };
        match ty {
            // TODO numeric type coercions
            PrimitiveType::Number(_ty) => match value {
                KclValue::Number { .. } => Some(value.clone()),
                _ => None,
            },
            PrimitiveType::String => match value {
                KclValue::String { .. } => Some(value.clone()),
                _ => None,
            },
            PrimitiveType::Boolean => match value {
                KclValue::Bool { .. } => Some(value.clone()),
                _ => None,
            },
            PrimitiveType::Sketch => match value {
                KclValue::Sketch { .. } => Some(value.clone()),
                _ => None,
            },
            PrimitiveType::Solid => match value {
                KclValue::Solid { .. } => Some(value.clone()),
                _ => None,
            },
            PrimitiveType::Plane => match value {
                KclValue::Plane { .. } => Some(value.clone()),
                KclValue::Object { value, meta } => {
                    let origin = value.get("origin").and_then(Point3d::from_kcl_val)?;
                    let x_axis = value.get("xAxis").and_then(Point3d::from_kcl_val)?;
                    let y_axis = value.get("yAxis").and_then(Point3d::from_kcl_val)?;
                    let z_axis = value.get("zAxis").and_then(Point3d::from_kcl_val)?;

                    let id = exec_state.mod_local.id_generator.next_uuid();
                    let plane = Plane {
                        id,
                        artifact_id: id.into(),
                        origin,
                        x_axis,
                        y_axis,
                        z_axis,
                        value: super::PlaneType::Uninit,
                        // TODO use length unit from origin
                        units: exec_state.length_unit(),
                        meta: meta.clone(),
                    };

                    Some(KclValue::Plane { value: Box::new(plane) })
                }
                _ => None,
            },
            PrimitiveType::Face => match value {
                KclValue::Face { .. } => Some(value.clone()),
                _ => None,
            },
            PrimitiveType::Helix => match value {
                KclValue::Helix { .. } => Some(value.clone()),
                _ => None,
            },
            PrimitiveType::Edge => match value {
                KclValue::Uuid { .. } => Some(value.clone()),
                KclValue::TagIdentifier { .. } => Some(value.clone()),
                _ => None,
            },
            PrimitiveType::Axis2d => match value {
                KclValue::Object { value: values, meta } => {
                    if values.get("origin")?.has_type(&RuntimeType::point2d())
                        && values.get("direction")?.has_type(&RuntimeType::point2d())
                    {
                        return Some(value.clone());
                    }

                    let origin = values.get("origin").and_then(|p| {
                        p.coerce_to_array_type(&RuntimeType::number_any(), ArrayLen::Known(2), exec_state, true)
                    })?;
                    let direction = values.get("direction").and_then(|p| {
                        p.coerce_to_array_type(&RuntimeType::number_any(), ArrayLen::Known(2), exec_state, true)
                    })?;

                    Some(KclValue::Object {
                        value: [("origin".to_owned(), origin), ("direction".to_owned(), direction)].into(),
                        meta: meta.clone(),
                    })
                }
                _ => None,
            },
            PrimitiveType::Axis3d => match value {
                KclValue::Object { value: values, meta } => {
                    if values.get("origin")?.has_type(&RuntimeType::point3d())
                        && values.get("direction")?.has_type(&RuntimeType::point3d())
                    {
                        return Some(value.clone());
                    }

                    let origin = values.get("origin").and_then(|p| {
                        p.coerce_to_array_type(&RuntimeType::number_any(), ArrayLen::Known(3), exec_state, true)
                    })?;
                    let direction = values.get("direction").and_then(|p| {
                        p.coerce_to_array_type(&RuntimeType::number_any(), ArrayLen::Known(3), exec_state, true)
                    })?;

                    Some(KclValue::Object {
                        value: [("origin".to_owned(), origin), ("direction".to_owned(), direction)].into(),
                        meta: meta.clone(),
                    })
                }
                _ => None,
            },
            PrimitiveType::ImportedGeometry => match value {
                KclValue::ImportedGeometry { .. } => Some(value.clone()),
                _ => None,
            },
            PrimitiveType::Tag => match value {
                KclValue::TagDeclarator { .. } => Some(value.clone()),
                KclValue::TagIdentifier { .. } => Some(value.clone()),
                _ => None,
            },
        }
    }

    fn coerce_to_array_type(
        &self,
        ty: &RuntimeType,
        len: ArrayLen,
        exec_state: &mut ExecState,
        allow_shrink: bool,
    ) -> Option<KclValue> {
        match self {
            KclValue::HomArray { value, ty: aty } if aty.subtype(ty) => {
                len.satisfied(value.len(), allow_shrink).map(|len| KclValue::HomArray {
                    value: value[..len].to_vec(),
                    ty: aty.clone(),
                })
            }
            value if len.satisfied(1, false).is_some() && value.has_type(ty) => Some(KclValue::HomArray {
                value: vec![value.clone()],
                ty: ty.clone(),
            }),
            KclValue::MixedArray { value, .. } => {
                let len = len.satisfied(value.len(), allow_shrink)?;

                let value = value[..len]
                    .iter()
                    .map(|v| v.coerce(ty, exec_state))
                    .collect::<Option<Vec<_>>>()?;

                Some(KclValue::HomArray { value, ty: ty.clone() })
            }
            KclValue::KclNone { .. } if len.satisfied(0, false).is_some() => Some(KclValue::HomArray {
                value: Vec::new(),
                ty: ty.clone(),
            }),
            _ => None,
        }
    }

    fn coerce_to_tuple_type(&self, tys: &[RuntimeType], exec_state: &mut ExecState) -> Option<KclValue> {
        match self {
            KclValue::MixedArray { value, .. } | KclValue::HomArray { value, .. } if value.len() == tys.len() => {
                let mut result = Vec::new();
                for (i, t) in tys.iter().enumerate() {
                    result.push(value[i].coerce(t, exec_state)?);
                }

                Some(KclValue::MixedArray {
                    value: result,
                    meta: Vec::new(),
                })
            }
            KclValue::KclNone { meta, .. } if tys.is_empty() => Some(KclValue::MixedArray {
                value: Vec::new(),
                meta: meta.clone(),
            }),
            value if tys.len() == 1 && value.has_type(&tys[0]) => Some(KclValue::MixedArray {
                value: vec![value.clone()],
                meta: Vec::new(),
            }),
            _ => None,
        }
    }

    fn coerce_to_union_type(&self, tys: &[RuntimeType], exec_state: &mut ExecState) -> Option<KclValue> {
        for t in tys {
            if let Some(v) = self.coerce(t, exec_state) {
                return Some(v);
            }
        }

        None
    }

    fn coerce_to_object_type(&self, tys: &[(String, RuntimeType)], _exec_state: &mut ExecState) -> Option<KclValue> {
        match self {
            KclValue::Object { value, .. } => {
                for (s, t) in tys {
                    // TODO coerce fields
                    if !value.get(s)?.has_type(t) {
                        return None;
                    }
                }
                // TODO remove non-required fields
                Some(self.clone())
            }
            KclValue::KclNone { meta, .. } if tys.is_empty() => Some(KclValue::Object {
                value: HashMap::new(),
                meta: meta.clone(),
            }),
            _ => None,
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
            KclValue::MixedArray { value, .. } => Some(RuntimeType::Tuple(
                value.iter().map(|v| v.principal_type()).collect::<Option<Vec<_>>>()?,
            )),
            KclValue::HomArray { ty, value, .. } => {
                Some(RuntimeType::Array(Box::new(ty.clone()), ArrayLen::Known(value.len())))
            }
            KclValue::TagIdentifier(_) | KclValue::TagDeclarator(_) => Some(RuntimeType::Primitive(PrimitiveType::Tag)),
            KclValue::Function { .. }
            | KclValue::Module { .. }
            | KclValue::KclNone { .. }
            | KclValue::Type { .. }
            | KclValue::Uuid { .. } => None,
        }
    }
}

#[cfg(test)]
mod test {
    use super::*;

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
            KclValue::MixedArray {
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
                value: Box::new(Plane::from_plane_data(crate::std::sketch::PlaneData::XY, exec_state)),
            },
            // No easy way to make a Face, Sketch, Solid, or Helix
            KclValue::ImportedGeometry(crate::execution::ImportedGeometry {
                id: uuid::Uuid::nil(),
                value: Vec::new(),
                meta: Vec::new(),
            }),
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
                &KclValue::MixedArray {
                    value: vec![v.clone()],
                    meta: Vec::new(),
                },
                &mut exec_state,
            );
        }

        for v in &values[1..] {
            // Not a subtype
            assert!(v
                .coerce(&RuntimeType::Primitive(PrimitiveType::Boolean), &mut exec_state)
                .is_none());
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
        assert!(none.coerce(&aty1, &mut exec_state).is_none());
        assert!(none.coerce(&aty1p, &mut exec_state).is_none());

        let tty = RuntimeType::Tuple(vec![]);
        let tty1 = RuntimeType::Tuple(vec![RuntimeType::solid()]);
        assert_coerce_results(
            &none,
            &tty,
            &KclValue::MixedArray {
                value: Vec::new(),
                meta: Vec::new(),
            },
            &mut exec_state,
        );
        assert!(none.coerce(&tty1, &mut exec_state).is_none());

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
        assert!(&obj0.coerce(&ty1, &mut exec_state).is_none());
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
        assert!(&obj0.coerce(&ty2, &mut exec_state).is_none());
        assert!(&obj1.coerce(&ty2, &mut exec_state).is_none());
        assert_coerce_results(&obj2, &ty2, &obj2, &mut exec_state);

        // field not present
        let tyq = RuntimeType::Object(vec![("qux".to_owned(), RuntimeType::Primitive(PrimitiveType::Boolean))]);
        assert!(&obj0.coerce(&tyq, &mut exec_state).is_none());
        assert!(&obj1.coerce(&tyq, &mut exec_state).is_none());
        assert!(&obj2.coerce(&tyq, &mut exec_state).is_none());

        // field with different type
        let ty1 = RuntimeType::Object(vec![("bar".to_owned(), RuntimeType::Primitive(PrimitiveType::Boolean))]);
        assert!(&obj2.coerce(&ty1, &mut exec_state).is_none());
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
        let mixed1 = KclValue::MixedArray {
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
        let mixed2 = KclValue::MixedArray {
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
        assert!(&mixed1.coerce(&tym2, &mut exec_state).is_none());
        assert!(&mixed2.coerce(&tym1, &mut exec_state).is_none());

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
        assert!(&hom_arr.coerce(&tyh3, &mut exec_state).is_none());

        let hom_arr0 = KclValue::HomArray {
            value: vec![],
            ty: RuntimeType::Primitive(PrimitiveType::Number(NumericType::count())),
        };
        assert_coerce_results(&hom_arr0, &tyhn, &hom_arr0, &mut exec_state);
        assert!(&hom_arr0.coerce(&tyh1, &mut exec_state).is_none());
        assert!(&hom_arr0.coerce(&tyh3, &mut exec_state).is_none());

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
        let mixed0 = KclValue::MixedArray {
            value: vec![],
            meta: Vec::new(),
        };
        assert_coerce_results(&mixed1, &tyhn, &hom_arr_2, &mut exec_state);
        assert_coerce_results(&mixed1, &tyh1, &hom_arr_2, &mut exec_state);
        assert_coerce_results(&mixed0, &tyhn, &hom_arr0, &mut exec_state);
        assert!(&mixed0.coerce(&tyh, &mut exec_state).is_none());
        assert!(&mixed0.coerce(&tyh1, &mut exec_state).is_none());

        // Homogehous to mixed
        assert_coerce_results(&hom_arr_2, &tym1, &mixed1, &mut exec_state);
        assert!(&hom_arr.coerce(&tym1, &mut exec_state).is_none());
        assert!(&hom_arr_2.coerce(&tym2, &mut exec_state).is_none());

        assert!(&mixed0.coerce(&tym1, &mut exec_state).is_none());
        assert!(&mixed0.coerce(&tym2, &mut exec_state).is_none());
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
        assert!(count.coerce(&tyb, &mut exec_state).is_none());
        assert!(count.coerce(&tyb2, &mut exec_state).is_none());
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
        assert!(a2d.coerce(&ty3d, &mut exec_state).is_none());
    }
}
