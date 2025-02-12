use std::collections::HashMap;

use anyhow::Result;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::{
    errors::KclErrorDetails,
    exec::Sketch,
    execution::{
        ExecState, Face, Helix, ImportedGeometry, MemoryFunction, Metadata, Plane, SketchSet, Solid, SolidSet,
        TagIdentifier,
    },
    parsing::{
        ast::types::{FunctionExpression, KclNone, LiteralValue, TagDeclarator, TagNode},
        token::NumericSuffix,
    },
    std::{args::Arg, FnAsArg},
    ExecutorContext, KclError, ModuleId, SourceRange,
};

use super::memory::EnvironmentRef;

pub type KclObjectFields = HashMap<String, KclValue>;

/// Any KCL value.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
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
        #[serde(rename = "__meta")]
        meta: Vec<Metadata>,
    },
    Int {
        value: i64,
        #[serde(rename = "__meta")]
        meta: Vec<Metadata>,
    },
    String {
        value: String,
        #[serde(rename = "__meta")]
        meta: Vec<Metadata>,
    },
    Array {
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
        /// Adam Chalmers speculation:
        /// Reference to a KCL stdlib function (written in Rust).
        /// Some if the KCL value is an alias of a stdlib function,
        /// None if it's a KCL function written/declared in KCL.
        #[serde(skip)]
        func: Option<MemoryFunction>,
        #[schemars(skip)]
        expression: crate::parsing::ast::types::BoxNode<FunctionExpression>,
        memory: EnvironmentRef,
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
            KclValue::Int { meta, .. } => to_vec_sr(&meta),
            KclValue::String { meta, .. } => to_vec_sr(&meta),
            KclValue::Array { meta, .. } => to_vec_sr(&meta),
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
            KclValue::Int { meta, .. } => to_vec_sr(meta),
            KclValue::String { meta, .. } => to_vec_sr(meta),
            KclValue::Uuid { meta, .. } => to_vec_sr(meta),
            KclValue::Array { meta, .. } => to_vec_sr(meta),
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
            KclValue::Number { value: _, meta } => meta.clone(),
            KclValue::Int { value: _, meta } => meta.clone(),
            KclValue::String { value: _, meta } => meta.clone(),
            KclValue::Array { value: _, meta } => meta.clone(),
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
        let KclValue::Function { expression, .. } = self else {
            return None;
        };
        // TODO: It would be nice if we could extract the source range starting
        // at the fn, but that's the variable declaration.
        Some(expression.as_source_range())
    }

    pub(crate) fn get_solid_set(&self) -> Result<SolidSet> {
        match self {
            KclValue::Solid { value } => Ok(SolidSet::Solid(value.clone())),
            KclValue::Solids { value } => Ok(SolidSet::Solids(value.clone())),
            KclValue::Array { value, .. } => {
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
            KclValue::Int { .. } => "integer",
            KclValue::String { .. } => "string (text)",
            KclValue::Array { .. } => "array (list)",
            KclValue::Object { .. } => "object",
            KclValue::Module { .. } => "module",
            KclValue::KclNone { .. } => "None",
            KclValue::Tombstone { .. } => "TOMBSTONE",
        }
    }

    pub(crate) fn from_literal(literal: LiteralValue, meta: Vec<Metadata>) -> Self {
        match literal {
            LiteralValue::Number { value, .. } => KclValue::Number { value, meta },
            LiteralValue::String(value) => KclValue::String { value, meta },
            LiteralValue::Bool(value) => KclValue::Bool { value, meta },
        }
    }

    pub(crate) fn map_env_ref(&self, env_map: &HashMap<EnvironmentRef, EnvironmentRef>) -> Self {
        let mut result = self.clone();
        if let KclValue::Function { ref mut memory, .. } = result {
            if let Some(new) = env_map.get(memory) {
                *memory = *new;
            }
        }
        result
    }

    /// Put the number into a KCL value.
    pub const fn from_number(f: f64, meta: Vec<Metadata>) -> Self {
        Self::Number { value: f, meta }
    }

    /// Put the point into a KCL value.
    pub fn from_point2d(p: [f64; 2], meta: Vec<Metadata>) -> Self {
        Self::Array {
            value: vec![
                Self::Number {
                    value: p[0],
                    meta: meta.clone(),
                },
                Self::Number {
                    value: p[1],
                    meta: meta.clone(),
                },
            ],
            meta,
        }
    }

    pub(crate) fn as_usize(&self) -> Option<usize> {
        match self {
            KclValue::Int { value, .. } if *value > 0 => Some(*value as usize),
            KclValue::Number { value, .. } => crate::try_f64_to_usize(*value),
            _ => None,
        }
    }

    pub fn as_int(&self) -> Option<i64> {
        match self {
            KclValue::Int { value, .. } => Some(*value),
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
        if let KclValue::Array { value, meta: _ } = &self {
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
        if let KclValue::Number { value, meta: _ } = &self {
            Some(*value)
        } else if let KclValue::Int { value, meta: _ } = &self {
            Some(*value as f64)
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
    pub fn get_function(&self) -> Option<FnAsArg<'_>> {
        let KclValue::Function {
            func,
            expression,
            memory,
            meta: _,
        } = &self
        else {
            return None;
        };
        Some(FnAsArg {
            func: func.as_ref(),
            expr: expression.to_owned(),
            memory: *memory,
        })
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

    /// If this memory item is a function, call it with the given arguments, return its val as Ok.
    /// If it's not a function, return Err.
    pub async fn call_fn(
        &self,
        args: Vec<Arg>,
        exec_state: &mut ExecState,
        ctx: ExecutorContext,
    ) -> Result<Option<KclValue>, KclError> {
        let KclValue::Function {
            func,
            expression,
            memory: closure_memory,
            meta,
        } = &self
        else {
            return Err(KclError::Semantic(KclErrorDetails {
                message: "not an in-memory function".to_string(),
                source_ranges: vec![],
            }));
        };
        if let Some(func) = func {
            exec_state.mut_memory().push_new_env_for_call(*closure_memory);
            let result = func(args, *closure_memory, expression.clone(), meta.clone(), exec_state, ctx).await;
            exec_state.mut_memory().pop_env();
            result
        } else {
            crate::execution::exec_ast::call_user_defined_function(
                args,
                *closure_memory,
                expression.as_ref(),
                exec_state,
                &ctx,
            )
            .await
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
        let KclValue::Function {
            func,
            expression,
            memory: closure_memory,
            meta: _,
        } = &self
        else {
            return Err(KclError::Semantic(KclErrorDetails {
                message: "cannot call this because it isn't a function".to_string(),
                source_ranges: vec![callsite],
            }));
        };
        if let Some(_func) = func {
            todo!("Implement calling KCL stdlib fns that are aliased. Part of https://github.com/KittyCAD/modeling-app/issues/4600");
        } else {
            crate::execution::exec_ast::call_user_defined_function_kw(
                args.kw_args,
                *closure_memory,
                expression.as_ref(),
                exec_state,
                &ctx,
            )
            .await
        }
    }
}

// TODO called UnitLen so as not to clash with UnitLength in settings)
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
