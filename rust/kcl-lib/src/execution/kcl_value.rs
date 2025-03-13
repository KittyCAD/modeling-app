use std::{collections::HashMap, fmt};

use anyhow::Result;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use super::{
    memory::{self, EnvironmentRef},
    MetaSettings, Point3d,
};
use crate::{
    errors::KclErrorDetails,
    execution::{
        ExecState, ExecutorContext, Face, Helix, ImportedGeometry, Metadata, Plane, Sketch, Solid, TagIdentifier,
    },
    parsing::{
        ast::types::{
            DefaultParamVal, FunctionExpression, KclNone, Literal, LiteralValue, Node,
            PrimitiveType as AstPrimitiveType, TagDeclarator, TagNode, Type,
        },
        token::NumericSuffix,
    },
    std::{
        args::{Arg, FromKclValue},
        StdFnProps,
    },
    CompilationError, KclError, ModuleId, SourceRange,
};

pub type KclObjectFields = HashMap<String, KclValue>;

/// Any KCL value.
#[derive(Debug, Clone, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(tag = "type")]
pub enum KclValue {
    Uuid {
        value: ::uuid::Uuid,
        #[serde(skip)]
        meta: Vec<Metadata>,
    },
    Bool {
        value: bool,
        #[serde(skip)]
        meta: Vec<Metadata>,
    },
    Number {
        value: f64,
        ty: NumericType,
        #[serde(skip)]
        meta: Vec<Metadata>,
    },
    String {
        value: String,
        #[serde(skip)]
        meta: Vec<Metadata>,
    },
    MixedArray {
        value: Vec<KclValue>,
        #[serde(skip)]
        meta: Vec<Metadata>,
    },
    // An array where all values have a shared type (not necessarily the same principal type).
    HomArray {
        value: Vec<KclValue>,
        // The type of values, not the array type.
        #[serde(skip)]
        ty: PrimitiveType,
    },
    Object {
        value: KclObjectFields,
        #[serde(skip)]
        meta: Vec<Metadata>,
    },
    TagIdentifier(Box<TagIdentifier>),
    TagDeclarator(crate::parsing::ast::types::BoxNode<TagDeclarator>),
    Plane {
        value: Box<Plane>,
    },
    Face {
        value: Box<Face>,
    },
    Sketch {
        value: Box<Sketch>,
    },
    Solid {
        value: Box<Solid>,
    },
    Helix {
        value: Box<Helix>,
    },
    ImportedGeometry(ImportedGeometry),
    #[ts(skip)]
    Function {
        #[serde(skip)]
        value: FunctionSource,
        #[serde(skip)]
        meta: Vec<Metadata>,
    },
    Module {
        value: ModuleId,
        #[serde(skip)]
        meta: Vec<Metadata>,
    },
    #[ts(skip)]
    Type {
        #[serde(skip)]
        value: Option<(PrimitiveType, StdFnProps)>,
        #[serde(skip)]
        meta: Vec<Metadata>,
    },
    KclNone {
        value: KclNone,
        #[serde(skip)]
        meta: Vec<Metadata>,
    },
}

#[derive(Debug, Clone, PartialEq, Default)]
pub enum FunctionSource {
    #[default]
    None,
    Std {
        func: crate::std::StdFn,
        props: StdFnProps,
    },
    User {
        ast: crate::parsing::ast::types::BoxNode<FunctionExpression>,
        settings: MetaSettings,
        memory: EnvironmentRef,
    },
}

impl JsonSchema for FunctionSource {
    fn schema_name() -> String {
        "FunctionSource".to_owned()
    }

    fn json_schema(gen: &mut schemars::gen::SchemaGenerator) -> schemars::schema::Schema {
        // TODO: Actually generate a reasonable schema.
        gen.subschema_for::<()>()
    }
}

impl From<Vec<Sketch>> for KclValue {
    fn from(mut eg: Vec<Sketch>) -> Self {
        if eg.len() == 1 {
            KclValue::Sketch {
                value: Box::new(eg.pop().unwrap()),
            }
        } else {
            KclValue::HomArray {
                value: eg
                    .into_iter()
                    .map(|s| KclValue::Sketch { value: Box::new(s) })
                    .collect(),
                ty: crate::execution::PrimitiveType::Sketch,
            }
        }
    }
}

impl From<Vec<Solid>> for KclValue {
    fn from(mut eg: Vec<Solid>) -> Self {
        if eg.len() == 1 {
            KclValue::Solid {
                value: Box::new(eg.pop().unwrap()),
            }
        } else {
            KclValue::HomArray {
                value: eg.into_iter().map(|s| KclValue::Solid { value: Box::new(s) }).collect(),
                ty: crate::execution::PrimitiveType::Solid,
            }
        }
    }
}

impl From<KclValue> for Vec<SourceRange> {
    fn from(item: KclValue) -> Self {
        match item {
            KclValue::TagDeclarator(t) => vec![SourceRange::new(t.start, t.end, t.module_id)],
            KclValue::TagIdentifier(t) => to_vec_sr(&t.meta),
            KclValue::Solid { value } => to_vec_sr(&value.meta),
            KclValue::Sketch { value } => to_vec_sr(&value.meta),
            KclValue::Helix { value } => to_vec_sr(&value.meta),
            KclValue::ImportedGeometry(i) => to_vec_sr(&i.meta),
            KclValue::Function { meta, .. } => to_vec_sr(&meta),
            KclValue::Plane { value } => to_vec_sr(&value.meta),
            KclValue::Face { value } => to_vec_sr(&value.meta),
            KclValue::Bool { meta, .. } => to_vec_sr(&meta),
            KclValue::Number { meta, .. } => to_vec_sr(&meta),
            KclValue::String { meta, .. } => to_vec_sr(&meta),
            KclValue::MixedArray { meta, .. } => to_vec_sr(&meta),
            KclValue::HomArray { value, .. } => value.iter().flat_map(Into::<Vec<SourceRange>>::into).collect(),
            KclValue::Object { meta, .. } => to_vec_sr(&meta),
            KclValue::Module { meta, .. } => to_vec_sr(&meta),
            KclValue::Uuid { meta, .. } => to_vec_sr(&meta),
            KclValue::Type { meta, .. } => to_vec_sr(&meta),
            KclValue::KclNone { meta, .. } => to_vec_sr(&meta),
        }
    }
}

fn to_vec_sr(meta: &[Metadata]) -> Vec<SourceRange> {
    meta.iter().map(|m| m.source_range).collect()
}

impl From<&KclValue> for Vec<SourceRange> {
    fn from(item: &KclValue) -> Self {
        match item {
            KclValue::TagDeclarator(t) => vec![SourceRange::new(t.start, t.end, t.module_id)],
            KclValue::TagIdentifier(t) => to_vec_sr(&t.meta),
            KclValue::Solid { value } => to_vec_sr(&value.meta),
            KclValue::Sketch { value } => to_vec_sr(&value.meta),
            KclValue::Helix { value } => to_vec_sr(&value.meta),
            KclValue::ImportedGeometry(i) => to_vec_sr(&i.meta),
            KclValue::Function { meta, .. } => to_vec_sr(meta),
            KclValue::Plane { value } => to_vec_sr(&value.meta),
            KclValue::Face { value } => to_vec_sr(&value.meta),
            KclValue::Bool { meta, .. } => to_vec_sr(meta),
            KclValue::Number { meta, .. } => to_vec_sr(meta),
            KclValue::String { meta, .. } => to_vec_sr(meta),
            KclValue::Uuid { meta, .. } => to_vec_sr(meta),
            KclValue::MixedArray { meta, .. } => to_vec_sr(meta),
            KclValue::HomArray { value, .. } => value.iter().flat_map(Into::<Vec<SourceRange>>::into).collect(),
            KclValue::Object { meta, .. } => to_vec_sr(meta),
            KclValue::Module { meta, .. } => to_vec_sr(meta),
            KclValue::KclNone { meta, .. } => to_vec_sr(meta),
            KclValue::Type { meta, .. } => to_vec_sr(meta),
        }
    }
}

impl From<&KclValue> for SourceRange {
    fn from(item: &KclValue) -> Self {
        let v: Vec<_> = item.into();
        v.into_iter().next().unwrap_or_default()
    }
}

impl KclValue {
    pub(crate) fn metadata(&self) -> Vec<Metadata> {
        match self {
            KclValue::Uuid { value: _, meta } => meta.clone(),
            KclValue::Bool { value: _, meta } => meta.clone(),
            KclValue::Number { meta, .. } => meta.clone(),
            KclValue::String { value: _, meta } => meta.clone(),
            KclValue::MixedArray { value: _, meta } => meta.clone(),
            KclValue::HomArray { value, .. } => value.iter().flat_map(|v| v.metadata()).collect(),
            KclValue::Object { value: _, meta } => meta.clone(),
            KclValue::TagIdentifier(x) => x.meta.clone(),
            KclValue::TagDeclarator(x) => vec![x.metadata()],
            KclValue::Plane { value } => value.meta.clone(),
            KclValue::Face { value } => value.meta.clone(),
            KclValue::Sketch { value } => value.meta.clone(),
            KclValue::Solid { value } => value.meta.clone(),
            KclValue::Helix { value } => value.meta.clone(),
            KclValue::ImportedGeometry(x) => x.meta.clone(),
            KclValue::Function { meta, .. } => meta.clone(),
            KclValue::Module { meta, .. } => meta.clone(),
            KclValue::KclNone { meta, .. } => meta.clone(),
            KclValue::Type { meta, .. } => meta.clone(),
        }
    }

    pub(crate) fn function_def_source_range(&self) -> Option<SourceRange> {
        let KclValue::Function {
            value: FunctionSource::User { ast, .. },
            ..
        } = self
        else {
            return None;
        };
        // TODO: It would be nice if we could extract the source range starting
        // at the fn, but that's the variable declaration.
        Some(ast.as_source_range())
    }

    #[allow(unused)]
    pub(crate) fn none() -> Self {
        Self::KclNone {
            value: Default::default(),
            meta: Default::default(),
        }
    }

    /// Human readable type name used in error messages.  Should not be relied
    /// on for program logic.
    pub(crate) fn human_friendly_type(&self) -> &'static str {
        match self {
            KclValue::Uuid { .. } => "Unique ID (uuid)",
            KclValue::TagDeclarator(_) => "TagDeclarator",
            KclValue::TagIdentifier(_) => "TagIdentifier",
            KclValue::Solid { .. } => "Solid",
            KclValue::Sketch { .. } => "Sketch",
            KclValue::Helix { .. } => "Helix",
            KclValue::ImportedGeometry(_) => "ImportedGeometry",
            KclValue::Function { .. } => "Function",
            KclValue::Plane { .. } => "Plane",
            KclValue::Face { .. } => "Face",
            KclValue::Bool { .. } => "boolean (true/false value)",
            KclValue::Number { .. } => "number",
            KclValue::String { .. } => "string (text)",
            KclValue::MixedArray { .. } => "array (list)",
            KclValue::HomArray { .. } => "array (list)",
            KclValue::Object { .. } => "object",
            KclValue::Module { .. } => "module",
            KclValue::Type { .. } => "type",
            KclValue::KclNone { .. } => "None",
        }
    }

    pub(crate) fn from_literal(literal: Node<Literal>, settings: &MetaSettings) -> Self {
        let meta = vec![literal.metadata()];
        match literal.inner.value {
            LiteralValue::Number { value, suffix } => KclValue::Number {
                value,
                meta,
                ty: NumericType::from_parsed(suffix, settings),
            },
            LiteralValue::String(value) => KclValue::String { value, meta },
            LiteralValue::Bool(value) => KclValue::Bool { value, meta },
        }
    }

    pub(crate) fn from_default_param(param: DefaultParamVal, settings: &MetaSettings) -> Self {
        match param {
            DefaultParamVal::Literal(lit) => Self::from_literal(lit, settings),
            DefaultParamVal::KclNone(none) => KclValue::KclNone {
                value: none,
                meta: Default::default(),
            },
        }
    }

    pub(crate) fn map_env_ref(&self, old_env: usize, new_env: usize) -> Self {
        let mut result = self.clone();
        if let KclValue::Function {
            value: FunctionSource::User { ref mut memory, .. },
            ..
        } = result
        {
            memory.replace_env(old_env, new_env);
        }
        result
    }

    /// Put the number into a KCL value.
    pub const fn from_number(f: f64, meta: Vec<Metadata>) -> Self {
        Self::Number {
            value: f,
            meta,
            ty: NumericType::Unknown,
        }
    }

    pub const fn from_number_with_type(f: f64, ty: NumericType, meta: Vec<Metadata>) -> Self {
        Self::Number { value: f, meta, ty }
    }

    /// Put the point into a KCL value.
    pub fn from_point2d(p: [f64; 2], ty: NumericType, meta: Vec<Metadata>) -> Self {
        Self::MixedArray {
            value: vec![
                Self::Number {
                    value: p[0],
                    meta: meta.clone(),
                    ty: ty.clone(),
                },
                Self::Number {
                    value: p[1],
                    meta: meta.clone(),
                    ty,
                },
            ],
            meta,
        }
    }

    pub(crate) fn as_usize(&self) -> Option<usize> {
        match self {
            KclValue::Number { value, .. } => crate::try_f64_to_usize(*value),
            _ => None,
        }
    }

    pub fn as_int(&self) -> Option<i64> {
        match self {
            KclValue::Number { value, .. } => crate::try_f64_to_i64(*value),
            _ => None,
        }
    }

    pub fn as_object(&self) -> Option<&KclObjectFields> {
        if let KclValue::Object { value, meta: _ } = &self {
            Some(value)
        } else {
            None
        }
    }

    pub fn into_object(self) -> Option<KclObjectFields> {
        if let KclValue::Object { value, meta: _ } = self {
            Some(value)
        } else {
            None
        }
    }

    pub fn as_str(&self) -> Option<&str> {
        if let KclValue::String { value, meta: _ } = &self {
            Some(value)
        } else {
            None
        }
    }

    pub fn as_array(&self) -> Option<&[KclValue]> {
        if let KclValue::MixedArray { value, meta: _ } = &self {
            Some(value)
        } else {
            None
        }
    }

    pub fn as_point2d(&self) -> Option<[f64; 2]> {
        let arr = self.as_array()?;
        if arr.len() != 2 {
            return None;
        }
        let x = arr[0].as_f64()?;
        let y = arr[1].as_f64()?;
        Some([x, y])
    }

    pub fn as_uuid(&self) -> Option<uuid::Uuid> {
        if let KclValue::Uuid { value, meta: _ } = &self {
            Some(*value)
        } else {
            None
        }
    }

    pub fn as_plane(&self) -> Option<&Plane> {
        if let KclValue::Plane { value } = &self {
            Some(value)
        } else {
            None
        }
    }

    pub fn as_solid(&self) -> Option<&Solid> {
        if let KclValue::Solid { value } = &self {
            Some(value)
        } else {
            None
        }
    }

    pub fn as_sketch(&self) -> Option<&Sketch> {
        if let KclValue::Sketch { value } = self {
            Some(value)
        } else {
            None
        }
    }

    pub fn as_mut_sketch(&mut self) -> Option<&mut Sketch> {
        if let KclValue::Sketch { value } = self {
            Some(value)
        } else {
            None
        }
    }

    pub fn as_mut_tag(&mut self) -> Option<&mut TagIdentifier> {
        if let KclValue::TagIdentifier(value) = self {
            Some(value)
        } else {
            None
        }
    }
    pub fn as_f64(&self) -> Option<f64> {
        if let KclValue::Number { value, .. } = &self {
            Some(*value)
        } else {
            None
        }
    }

    pub fn as_bool(&self) -> Option<bool> {
        if let KclValue::Bool { value, meta: _ } = &self {
            Some(*value)
        } else {
            None
        }
    }

    /// If this value fits in a u32, return it.
    pub fn get_u32(&self, source_ranges: Vec<SourceRange>) -> Result<u32, KclError> {
        let u = self.as_int().and_then(|n| u64::try_from(n).ok()).ok_or_else(|| {
            KclError::Semantic(KclErrorDetails {
                message: "Expected an integer >= 0".to_owned(),
                source_ranges: source_ranges.clone(),
            })
        })?;
        u32::try_from(u).map_err(|_| {
            KclError::Semantic(KclErrorDetails {
                message: "Number was too big".to_owned(),
                source_ranges,
            })
        })
    }

    /// If this value is of type function, return it.
    pub fn get_function(&self) -> Option<&FunctionSource> {
        match self {
            KclValue::Function { value, .. } => Some(value),
            _ => None,
        }
    }

    /// Get a tag identifier from a memory item.
    pub fn get_tag_identifier(&self) -> Result<TagIdentifier, KclError> {
        match self {
            KclValue::TagIdentifier(t) => Ok(*t.clone()),
            _ => Err(KclError::Semantic(KclErrorDetails {
                message: format!("Not a tag identifier: {:?}", self),
                source_ranges: self.clone().into(),
            })),
        }
    }

    /// Get a tag declarator from a memory item.
    pub fn get_tag_declarator(&self) -> Result<TagNode, KclError> {
        match self {
            KclValue::TagDeclarator(t) => Ok((**t).clone()),
            _ => Err(KclError::Semantic(KclErrorDetails {
                message: format!("Not a tag declarator: {:?}", self),
                source_ranges: self.clone().into(),
            })),
        }
    }

    /// If this KCL value is a bool, retrieve it.
    pub fn get_bool(&self) -> Result<bool, KclError> {
        let Self::Bool { value: b, .. } = self else {
            return Err(KclError::Type(KclErrorDetails {
                source_ranges: self.into(),
                message: format!("Expected bool, found {}", self.human_friendly_type()),
            }));
        };
        Ok(*b)
    }

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
            PrimitiveType::ImportedGeometry => match value {
                KclValue::ImportedGeometry { .. } => Some(value.clone()),
                _ => None,
            },
        }
    }

    fn coerce_to_array_type(&self, ty: &PrimitiveType, len: ArrayLen, exec_state: &mut ExecState) -> Option<KclValue> {
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

                let rt = RuntimeType::Primitive(ty.clone());
                let value = value
                    .iter()
                    .map(|v| v.coerce(&rt, exec_state))
                    .collect::<Option<Vec<_>>>()?;

                Some(KclValue::HomArray { value, ty: ty.clone() })
            }
            KclValue::KclNone { .. } if len.satisfied(0) => Some(KclValue::HomArray {
                value: Vec::new(),
                ty: ty.clone(),
            }),
            value if len.satisfied(1) => {
                if value.has_type(&RuntimeType::Primitive(ty.clone())) {
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

    fn coerce_to_tuple_type(&self, tys: &[PrimitiveType], exec_state: &mut ExecState) -> Option<KclValue> {
        match self {
            KclValue::MixedArray { value, .. } | KclValue::HomArray { value, .. } => {
                if value.len() < tys.len() {
                    return None;
                }
                let mut result = Vec::new();
                for (i, t) in tys.iter().enumerate() {
                    result.push(value[i].coerce_to_primitive_type(t, exec_state)?);
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
                if value.has_type(&RuntimeType::Primitive(tys[0].clone())) {
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
            KclValue::ImportedGeometry(..) => Some(RuntimeType::Primitive(PrimitiveType::ImportedGeometry)),
            KclValue::MixedArray { value, .. } => Some(RuntimeType::Tuple(
                value
                    .iter()
                    .map(|v| v.principal_type().and_then(RuntimeType::primitive))
                    .collect::<Option<Vec<_>>>()?,
            )),
            KclValue::HomArray { ty, value, .. } => Some(RuntimeType::Array(ty.clone(), ArrayLen::Known(value.len()))),
            KclValue::Face { .. } => None,
            KclValue::Helix { .. }
            | KclValue::Function { .. }
            | KclValue::Module { .. }
            | KclValue::TagIdentifier(_)
            | KclValue::TagDeclarator(_)
            | KclValue::KclNone { .. }
            | KclValue::Type { .. }
            | KclValue::Uuid { .. } => None,
        }
    }

    /// If this memory item is a function, call it with the given arguments, return its val as Ok.
    /// If it's not a function, return Err.
    pub async fn call_fn(
        &self,
        args: Vec<Arg>,
        exec_state: &mut ExecState,
        ctx: ExecutorContext,
        source_range: SourceRange,
    ) -> Result<Option<KclValue>, KclError> {
        match self {
            KclValue::Function {
                value: FunctionSource::Std { func, props },
                ..
            } => {
                if props.deprecated {
                    exec_state.warn(CompilationError::err(
                        source_range,
                        format!(
                            "`{}` is deprecated, see the docs for a recommended replacement",
                            props.name
                        ),
                    ));
                }
                exec_state.mut_stack().push_new_env_for_rust_call();
                let args = crate::std::Args::new(
                    args,
                    source_range,
                    ctx.clone(),
                    exec_state
                        .mod_local
                        .pipe_value
                        .clone()
                        .map(|v| Arg::new(v, source_range)),
                );
                let result = func(exec_state, args).await.map(Some);
                exec_state.mut_stack().pop_env();
                result
            }
            KclValue::Function {
                value: FunctionSource::User { ast, memory, .. },
                ..
            } => crate::execution::exec_ast::call_user_defined_function(args, *memory, ast, exec_state, &ctx).await,
            _ => Err(KclError::Semantic(KclErrorDetails {
                message: "cannot call this because it isn't a function".to_string(),
                source_ranges: vec![source_range],
            })),
        }
    }

    /// If this is a function, call it by applying keyword arguments.
    /// If it's not a function, returns an error.
    pub async fn call_fn_kw(
        &self,
        args: crate::std::Args,
        exec_state: &mut ExecState,
        ctx: ExecutorContext,
        callsite: SourceRange,
    ) -> Result<Option<KclValue>, KclError> {
        match self {
            KclValue::Function {
                value: FunctionSource::Std { func: _, props },
                ..
            } => {
                if props.deprecated {
                    exec_state.warn(CompilationError::err(
                        callsite,
                        format!(
                            "`{}` is deprecated, see the docs for a recommended replacement",
                            props.name
                        ),
                    ));
                }
                todo!("Implement KCL stdlib fns with keyword args");
            }
            KclValue::Function {
                value: FunctionSource::User { ast, memory, .. },
                ..
            } => {
                crate::execution::exec_ast::call_user_defined_function_kw(args.kw_args, *memory, ast, exec_state, &ctx)
                    .await
            }
            _ => Err(KclError::Semantic(KclErrorDetails {
                message: "cannot call this because it isn't a function".to_string(),
                source_ranges: vec![callsite],
            })),
        }
    }

    pub fn value_str(&self) -> Option<String> {
        match self {
            KclValue::Bool { value, .. } => Some(format!("{value}")),
            KclValue::Number { value, .. } => Some(format!("{value}")),
            KclValue::String { value, .. } => Some(format!("'{value}'")),
            KclValue::Uuid { value, .. } => Some(format!("{value}")),
            KclValue::TagDeclarator(tag) => Some(format!("${}", tag.name)),
            KclValue::TagIdentifier(tag) => Some(format!("${}", tag.value)),
            // TODO better Array and Object stringification
            KclValue::MixedArray { .. } => Some("[...]".to_owned()),
            KclValue::HomArray { .. } => Some("[...]".to_owned()),
            KclValue::Object { .. } => Some("{ ... }".to_owned()),
            KclValue::Module { .. }
            | KclValue::Solid { .. }
            | KclValue::Sketch { .. }
            | KclValue::Helix { .. }
            | KclValue::ImportedGeometry(_)
            | KclValue::Function { .. }
            | KclValue::Plane { .. }
            | KclValue::Face { .. }
            | KclValue::KclNone { .. }
            | KclValue::Type { .. } => None,
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum RuntimeType {
    Primitive(PrimitiveType),
    Array(PrimitiveType, ArrayLen),
    Union(Vec<RuntimeType>),
    Tuple(Vec<PrimitiveType>),
    Object(Vec<(String, RuntimeType)>),
}

impl RuntimeType {
    pub fn from_parsed(
        value: Type,
        exec_state: &mut ExecState,
        source_range: SourceRange,
    ) -> Result<Option<Self>, CompilationError> {
        Ok(match value {
            Type::Primitive(pt) => {
                PrimitiveType::from_parsed(pt, exec_state, source_range)?.map(RuntimeType::Primitive)
            }
            Type::Array { ty, len } => {
                PrimitiveType::from_parsed(ty, exec_state, source_range)?.map(|t| RuntimeType::Array(t, len))
            }
            Type::Union { tys } => tys
                .into_iter()
                .map(|t| PrimitiveType::from_parsed(t.inner, exec_state, source_range))
                .collect::<Result<Option<Vec<_>>, CompilationError>>()?
                .map(RuntimeType::Union),
            Type::Object { properties } => properties
                .into_iter()
                .map(|p| {
                    let pt = match p.type_ {
                        Some(t) => t,
                        None => return Ok(None),
                    };
                    Ok(RuntimeType::from_parsed(pt.inner, exec_state, source_range)?
                        .map(|ty| (p.identifier.inner.name, ty)))
                })
                .collect::<Result<Option<Vec<_>>, CompilationError>>()?
                .map(RuntimeType::Object),
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
                tys.iter().map(PrimitiveType::to_string).collect::<Vec<_>>().join(", ")
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
            (Tuple(t1), Array(t2, l2)) => (l2.satisfied(t1.len())) && t1.iter().all(|t| t == t2),
            (Union(ts1), Union(ts2)) => ts1.iter().all(|t| ts2.contains(t)),
            (t1, Union(ts2)) => ts2.contains(t1),
            // TODO record subtyping - subtype can be larger, fields can be covariant.
            (Object(t1), Object(t2)) => t1 == t2,
            _ => false,
        }
    }

    fn primitive(self) -> Option<PrimitiveType> {
        match self {
            RuntimeType::Primitive(t) => Some(t),
            _ => None,
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
    Sketch,
    Solid,
    Plane,
    ImportedGeometry,
}

impl PrimitiveType {
    fn from_parsed(
        value: AstPrimitiveType,
        exec_state: &mut ExecState,
        source_range: SourceRange,
    ) -> Result<Option<Self>, CompilationError> {
        Ok(match value {
            AstPrimitiveType::String => Some(PrimitiveType::String),
            AstPrimitiveType::Boolean => Some(PrimitiveType::Boolean),
            AstPrimitiveType::Number(suffix) => Some(PrimitiveType::Number(NumericType::from_parsed(
                suffix,
                &exec_state.mod_local.settings,
            ))),
            AstPrimitiveType::Named(name) => {
                let ty_val = exec_state
                    .stack()
                    .get(&format!("{}{}", memory::TYPE_PREFIX, name.name), source_range)
                    .map_err(|_| CompilationError::err(source_range, format!("Unknown type: {}", name.name)))?;

                let (ty, _) = match ty_val {
                    KclValue::Type { value: Some(ty), .. } => ty,
                    _ => unreachable!(),
                };

                Some(ty.clone())
            }
            _ => None,
        })
    }

    fn display_multiple(&self) -> String {
        match self {
            PrimitiveType::Number(NumericType::Known(unit)) => format!("numbers({unit})"),
            PrimitiveType::Number(_) => "numbers".to_owned(),
            PrimitiveType::String => "strings".to_owned(),
            PrimitiveType::Boolean => "bools".to_owned(),
            PrimitiveType::Sketch => "Sketches".to_owned(),
            PrimitiveType::Solid => "Solids".to_owned(),
            PrimitiveType::Plane => "Planes".to_owned(),
            PrimitiveType::ImportedGeometry => "imported geometries".to_owned(),
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
            PrimitiveType::Sketch => write!(f, "Sketch"),
            PrimitiveType::Solid => write!(f, "Solid"),
            PrimitiveType::Plane => write!(f, "Plane"),
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
