use std::collections::HashMap;

use anyhow::Result;
use schemars::JsonSchema;
use serde::Serialize;

use super::{memory::EnvironmentRef, MetaSettings};
use crate::{
    errors::KclErrorDetails,
    execution::{
        types::{NumericType, PrimitiveType, RuntimeType},
        Face, Helix, ImportedGeometry, Metadata, Plane, Sketch, Solid, TagIdentifier,
    },
    parsing::ast::types::{
        DefaultParamVal, FunctionExpression, KclNone, Literal, LiteralValue, Node, TagDeclarator, TagNode,
    },
    std::StdFnProps,
    KclError, ModuleId, SourceRange,
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
        ty: RuntimeType,
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
        value: TypeDef,
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
        ast: crate::parsing::ast::types::BoxNode<FunctionExpression>,
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

#[derive(Debug, Clone, PartialEq)]
pub enum TypeDef {
    RustRepr(PrimitiveType, StdFnProps),
    Alias(RuntimeType),
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
                ty: RuntimeType::Primitive(PrimitiveType::Sketch),
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
                ty: RuntimeType::Primitive(PrimitiveType::Solid),
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

    pub fn as_fn(&self) -> Option<&FunctionSource> {
        match self {
            KclValue::Function { value, .. } => Some(value),
            _ => None,
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
