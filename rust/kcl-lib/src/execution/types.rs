use std::fmt;

use anyhow::Result;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use super::{
    memory::{self},
    Point3d,
};
use crate::{
    execution::{
        kcl_value::{KclValue, TypeDef},
        ExecState, Plane,
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
            AstPrimitiveType::Named(name) => {
                let ty_val = exec_state
                    .stack()
                    .get(&format!("{}{}", memory::TYPE_PREFIX, name.name), source_range)
                    .map_err(|_| CompilationError::err(source_range, format!("Unknown type: {}", name.name)))?;

                match ty_val {
                    KclValue::Type { value, .. } => match value {
                        TypeDef::RustRepr(ty, _) => RuntimeType::Primitive(ty.clone()),
                        TypeDef::Alias(ty) => ty.clone(),
                    },
                    _ => unreachable!(),
                }
            }
            AstPrimitiveType::Tag => RuntimeType::Primitive(PrimitiveType::Tag),
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
            (Primitive(t1), Primitive(t2)) => t1 == t2,
            // TODO arrays could be covariant
            (Array(t1, l1), Array(t2, l2)) => t1 == t2 && l1.subtype(*l2),
            (Tuple(t1), Tuple(t2)) => t1 == t2,
            (Tuple(t1), Array(t2, l2)) => (l2.satisfied(t1.len())) && t1.iter().all(|t| t == &**t2),
            (Union(ts1), Union(ts2)) => ts1.iter().all(|t| ts2.contains(t)),
            (t1, Union(ts2)) => ts2.contains(t1),
            // TODO record subtyping - subtype can be larger, fields can be covariant.
            (Object(t1), Object(t2)) => t1 == t2,
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
    fn satisfied(self, len: usize) -> bool {
        match self {
            ArrayLen::None => true,
            ArrayLen::NonEmpty => len > 0,
            ArrayLen::Known(s) => len == s,
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
            PrimitiveType::ImportedGeometry => "imported geometries".to_owned(),
            PrimitiveType::Tag => "tags".to_owned(),
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
            RuntimeType::Array(ty, len) => self.coerce_to_array_type(ty, *len, exec_state),
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

    fn coerce_to_array_type(&self, ty: &RuntimeType, len: ArrayLen, exec_state: &mut ExecState) -> Option<KclValue> {
        match self {
            KclValue::HomArray { value, ty: aty } => {
                // TODO could check types of values individually
                if aty != ty {
                    return None;
                }

                let value = match len {
                    ArrayLen::None => value.clone(),
                    ArrayLen::NonEmpty => {
                        if value.is_empty() {
                            return None;
                        }

                        value.clone()
                    }
                    ArrayLen::Known(n) => {
                        if n != value.len() {
                            return None;
                        }

                        value[..n].to_vec()
                    }
                };

                Some(KclValue::HomArray { value, ty: ty.clone() })
            }
            KclValue::MixedArray { value, .. } => {
                let value = match len {
                    ArrayLen::None => value.clone(),
                    ArrayLen::NonEmpty => {
                        if value.is_empty() {
                            return None;
                        }

                        value.clone()
                    }
                    ArrayLen::Known(n) => {
                        if n != value.len() {
                            return None;
                        }

                        value[..n].to_vec()
                    }
                };

                let value = value
                    .iter()
                    .map(|v| v.coerce(ty, exec_state))
                    .collect::<Option<Vec<_>>>()?;

                Some(KclValue::HomArray { value, ty: ty.clone() })
            }
            KclValue::KclNone { .. } if len.satisfied(0) => Some(KclValue::HomArray {
                value: Vec::new(),
                ty: ty.clone(),
            }),
            value if len.satisfied(1) => {
                if value.has_type(ty) {
                    Some(KclValue::HomArray {
                        value: vec![value.clone()],
                        ty: ty.clone(),
                    })
                } else {
                    None
                }
            }
            _ => None,
        }
    }

    fn coerce_to_tuple_type(&self, tys: &[RuntimeType], exec_state: &mut ExecState) -> Option<KclValue> {
        match self {
            KclValue::MixedArray { value, .. } | KclValue::HomArray { value, .. } => {
                if value.len() < tys.len() {
                    return None;
                }
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
            value if tys.len() == 1 => {
                if value.has_type(&tys[0]) {
                    Some(KclValue::MixedArray {
                        value: vec![value.clone()],
                        meta: Vec::new(),
                    })
                } else {
                    None
                }
            }
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
