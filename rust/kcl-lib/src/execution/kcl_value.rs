use std::{collections::HashMap, fmt};

use anyhow::Result;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use super::{memory::EnvironmentRef, MetaSettings};
use crate::{
    errors::KclErrorDetails,
    execution::{
        ExecState, ExecutorContext, Face, Helix, ImportedGeometry, Metadata, Plane, Sketch, SketchSet, Solid, SolidSet,
        TagIdentifier,
    },
    parsing::{
        ast::types::{
            DefaultParamVal, FunctionExpression, KclNone, Literal, LiteralValue, Node,
            PrimitiveType as AstPrimitiveType, TagDeclarator, TagNode, Type,
        },
        token::NumericSuffix,
    },
    std::{args::Arg, StdFnProps},
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
        #[serde(rename = "__meta")]
        meta: Vec<Metadata>,
    },
    Bool {
        value: bool,
        #[serde(rename = "__meta")]
        meta: Vec<Metadata>,
    },
    Number {
        value: f64,
        ty: NumericType,
        #[serde(rename = "__meta")]
        meta: Vec<Metadata>,
    },
    String {
        value: String,
        #[serde(rename = "__meta")]
        meta: Vec<Metadata>,
    },
    MixedArray {
        value: Vec<KclValue>,
        #[serde(rename = "__meta")]
        meta: Vec<Metadata>,
    },
    Object {
        value: KclObjectFields,
        #[serde(rename = "__meta")]
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
    Sketches {
        value: Vec<Box<Sketch>>,
    },
    Solid {
        value: Box<Solid>,
    },
    Solids {
        value: Vec<Box<Solid>>,
    },
    Helix {
        value: Box<Helix>,
    },
    ImportedGeometry(ImportedGeometry),
    #[ts(skip)]
    Function {
        #[serde(skip)]
        value: FunctionSource,
        #[serde(rename = "__meta")]
        meta: Vec<Metadata>,
    },
    Module {
        value: ModuleId,
        #[serde(rename = "__meta")]
        meta: Vec<Metadata>,
    },
    KclNone {
        value: KclNone,
        #[serde(rename = "__meta")]
        meta: Vec<Metadata>,
    },
    // Only used for memory management. Should never be visible outside of the memory module.
    Tombstone {
        value: (),
        #[serde(rename = "__meta")]
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

impl From<SketchSet> for KclValue {
    fn from(sg: SketchSet) -> Self {
        match sg {
            SketchSet::Sketch(value) => KclValue::Sketch { value },
            SketchSet::Sketches(value) => KclValue::Sketches { value },
        }
    }
}

impl From<Vec<Box<Sketch>>> for KclValue {
    fn from(sg: Vec<Box<Sketch>>) -> Self {
        KclValue::Sketches { value: sg }
    }
}

impl From<SolidSet> for KclValue {
    fn from(eg: SolidSet) -> Self {
        match eg {
            SolidSet::Solid(eg) => KclValue::Solid { value: eg },
            SolidSet::Solids(egs) => KclValue::Solids { value: egs },
        }
    }
}

impl From<Vec<Box<Solid>>> for KclValue {
    fn from(eg: Vec<Box<Solid>>) -> Self {
        if eg.len() == 1 {
            KclValue::Solid { value: eg[0].clone() }
        } else {
            KclValue::Solids { value: eg }
        }
    }
}
impl From<KclValue> for Vec<SourceRange> {
    fn from(item: KclValue) -> Self {
        match item {
            KclValue::TagDeclarator(t) => vec![SourceRange::new(t.start, t.end, t.module_id)],
            KclValue::TagIdentifier(t) => to_vec_sr(&t.meta),
            KclValue::Solid { value } => to_vec_sr(&value.meta),
            KclValue::Solids { value } => value.iter().flat_map(|eg| to_vec_sr(&eg.meta)).collect(),
            KclValue::Sketch { value } => to_vec_sr(&value.meta),
            KclValue::Sketches { value } => value.iter().flat_map(|eg| to_vec_sr(&eg.meta)).collect(),
            KclValue::Helix { value } => to_vec_sr(&value.meta),
            KclValue::ImportedGeometry(i) => to_vec_sr(&i.meta),
            KclValue::Function { meta, .. } => to_vec_sr(&meta),
            KclValue::Plane { value } => to_vec_sr(&value.meta),
            KclValue::Face { value } => to_vec_sr(&value.meta),
            KclValue::Bool { meta, .. } => to_vec_sr(&meta),
            KclValue::Number { meta, .. } => to_vec_sr(&meta),
            KclValue::String { meta, .. } => to_vec_sr(&meta),
            KclValue::MixedArray { meta, .. } => to_vec_sr(&meta),
            KclValue::Object { meta, .. } => to_vec_sr(&meta),
            KclValue::Module { meta, .. } => to_vec_sr(&meta),
            KclValue::Uuid { meta, .. } => to_vec_sr(&meta),
            KclValue::KclNone { meta, .. } => to_vec_sr(&meta),
            KclValue::Tombstone { .. } => unreachable!("Tombstone SourceRange"),
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
            KclValue::Solids { value } => value.iter().flat_map(|eg| to_vec_sr(&eg.meta)).collect(),
            KclValue::Sketch { value } => to_vec_sr(&value.meta),
            KclValue::Sketches { value } => value.iter().flat_map(|eg| to_vec_sr(&eg.meta)).collect(),
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
            KclValue::Object { meta, .. } => to_vec_sr(meta),
            KclValue::Module { meta, .. } => to_vec_sr(meta),
            KclValue::KclNone { meta, .. } => to_vec_sr(meta),
            KclValue::Tombstone { .. } => unreachable!("Tombstone &SourceRange"),
        }
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
            KclValue::Object { value: _, meta } => meta.clone(),
            KclValue::TagIdentifier(x) => x.meta.clone(),
            KclValue::TagDeclarator(x) => vec![x.metadata()],
            KclValue::Plane { value } => value.meta.clone(),
            KclValue::Face { value } => value.meta.clone(),
            KclValue::Sketch { value } => value.meta.clone(),
            KclValue::Sketches { value } => value.iter().flat_map(|sketch| &sketch.meta).copied().collect(),
            KclValue::Solid { value } => value.meta.clone(),
            KclValue::Solids { value } => value.iter().flat_map(|sketch| &sketch.meta).copied().collect(),
            KclValue::Helix { value } => value.meta.clone(),
            KclValue::ImportedGeometry(x) => x.meta.clone(),
            KclValue::Function { meta, .. } => meta.clone(),
            KclValue::Module { meta, .. } => meta.clone(),
            KclValue::KclNone { meta, .. } => meta.clone(),
            KclValue::Tombstone { .. } => unreachable!("Tombstone Metadata"),
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

    pub(crate) fn get_solid_set(&self) -> Result<SolidSet> {
        match self {
            KclValue::Solid { value } => Ok(SolidSet::Solid(value.clone())),
            KclValue::Solids { value } => Ok(SolidSet::Solids(value.clone())),
            KclValue::MixedArray { value, .. } => {
                let solids: Vec<_> = value
                    .iter()
                    .enumerate()
                    .map(|(i, v)| {
                        v.as_solid().map(|v| v.to_owned()).map(Box::new).ok_or_else(|| {
                            anyhow::anyhow!(
                                "expected this array to only contain solids, but element {i} was actually {}",
                                v.human_friendly_type()
                            )
                        })
                    })
                    .collect::<Result<_, _>>()?;
                Ok(SolidSet::Solids(solids))
            }
            _ => anyhow::bail!("Not a solid or solids: {:?}", self),
        }
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
            KclValue::Solids { .. } => "Solids",
            KclValue::Sketch { .. } => "Sketch",
            KclValue::Sketches { .. } => "Sketches",
            KclValue::Helix { .. } => "Helix",
            KclValue::ImportedGeometry(_) => "ImportedGeometry",
            KclValue::Function { .. } => "Function",
            KclValue::Plane { .. } => "Plane",
            KclValue::Face { .. } => "Face",
            KclValue::Bool { .. } => "boolean (true/false value)",
            KclValue::Number { .. } => "number",
            KclValue::String { .. } => "string (text)",
            KclValue::MixedArray { .. } => "array (list)",
            KclValue::Object { .. } => "object",
            KclValue::Module { .. } => "module",
            KclValue::KclNone { .. } => "None",
            KclValue::Tombstone { .. } => "TOMBSTONE",
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

    pub(crate) fn map_env_ref(&self, env_map: &HashMap<EnvironmentRef, EnvironmentRef>) -> Self {
        let mut result = self.clone();
        if let KclValue::Function {
            value: FunctionSource::User { ref mut memory, .. },
            ..
        } = result
        {
            if let Some(new) = env_map.get(memory) {
                *memory = *new;
            }
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

    /// Get an optional tag from a memory item.
    pub fn get_tag_declarator_opt(&self) -> Result<Option<TagNode>, KclError> {
        match self {
            KclValue::TagDeclarator(t) => Ok(Some((**t).clone())),
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
            KclValue::Sketches { .. } => Some(RuntimeType::Array(PrimitiveType::Sketch)),
            KclValue::Solid { .. } => Some(RuntimeType::Primitive(PrimitiveType::Solid)),
            KclValue::Solids { .. } => Some(RuntimeType::Array(PrimitiveType::Solid)),
            KclValue::MixedArray { value, .. } => Some(RuntimeType::Tuple(
                value
                    .iter()
                    .map(|v| v.principal_type().and_then(RuntimeType::primitive))
                    .collect::<Option<Vec<_>>>()?,
            )),
            KclValue::Face { .. } => None,
            KclValue::Helix { .. } => None,
            KclValue::ImportedGeometry(..) => None,
            KclValue::Function { .. } => None,
            KclValue::Module { .. } => None,
            KclValue::TagIdentifier(_) => None,
            KclValue::TagDeclarator(_) => None,
            KclValue::KclNone { .. } => None,
            KclValue::Uuid { .. } => None,
            KclValue::Tombstone { .. } => None,
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
                    exec_state.mod_local.pipe_value.clone().map(Arg::synthetic),
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
            KclValue::Object { .. } => Some("{ ... }".to_owned()),
            KclValue::Module { .. }
            | KclValue::Solid { .. }
            | KclValue::Solids { .. }
            | KclValue::Sketch { .. }
            | KclValue::Sketches { .. }
            | KclValue::Helix { .. }
            | KclValue::ImportedGeometry(_)
            | KclValue::Function { .. }
            | KclValue::Plane { .. }
            | KclValue::Face { .. }
            | KclValue::KclNone { .. }
            | KclValue::Tombstone { .. } => None,
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum RuntimeType {
    Primitive(PrimitiveType),
    Array(PrimitiveType),
    Tuple(Vec<PrimitiveType>),
    Object(Vec<(String, RuntimeType)>),
}

impl RuntimeType {
    pub fn from_parsed(value: Type, settings: &super::MetaSettings) -> Option<Self> {
        match value {
            Type::Primitive(pt) => Some(RuntimeType::Primitive(PrimitiveType::from_parsed(pt, settings)?)),
            Type::Array(pt) => Some(RuntimeType::Array(PrimitiveType::from_parsed(pt, settings)?)),
            Type::Object { properties } => Some(RuntimeType::Object(
                properties
                    .into_iter()
                    .map(|p| {
                        p.type_.and_then(|t| {
                            RuntimeType::from_parsed(t.inner, settings).map(|ty| (p.identifier.inner.name, ty))
                        })
                    })
                    .collect::<Option<Vec<_>>>()?,
            )),
        }
    }

    // Subtype with no coercion, including refining numeric types.
    fn subtype(&self, sup: &RuntimeType) -> bool {
        use RuntimeType::*;

        match (self, sup) {
            // TODO arrays could be covariant
            (Primitive(t1), Primitive(t2)) | (Array(t1), Array(t2)) => t1 == t2,
            (Tuple(t1), Tuple(t2)) => t1 == t2,
            (Tuple(t1), Array(t2)) => t1.iter().all(|t| t == t2),
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
            RuntimeType::Array(t) => write!(f, "[{t}]"),
            RuntimeType::Tuple(ts) => write!(
                f,
                "[{}]",
                ts.iter().map(|t| t.to_string()).collect::<Vec<_>>().join(", ")
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

#[derive(Debug, Clone, PartialEq)]
pub enum PrimitiveType {
    Number(NumericType),
    String,
    Boolean,
    Sketch,
    Solid,
    Plane,
}

impl PrimitiveType {
    fn from_parsed(value: AstPrimitiveType, settings: &super::MetaSettings) -> Option<Self> {
        match value {
            AstPrimitiveType::String => Some(PrimitiveType::String),
            AstPrimitiveType::Boolean => Some(PrimitiveType::Boolean),
            AstPrimitiveType::Number(suffix) => Some(PrimitiveType::Number(NumericType::from_parsed(suffix, settings))),
            AstPrimitiveType::Sketch => Some(PrimitiveType::Sketch),
            AstPrimitiveType::Solid => Some(PrimitiveType::Solid),
            AstPrimitiveType::Plane => Some(PrimitiveType::Plane),
            _ => None,
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
