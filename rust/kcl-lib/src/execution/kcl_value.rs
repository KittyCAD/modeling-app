use std::collections::HashMap;

use anyhow::Result;
use indexmap::IndexMap;
use kittycad_modeling_cmds::units::UnitLength;
use serde::Serialize;

use crate::{
    CompilationError, KclError, ModuleId, SourceRange,
    errors::KclErrorDetails,
    execution::{
        AbstractSegment, EnvironmentRef, ExecState, Face, GdtAnnotation, Geometry, GeometryWithImportedGeometry, Helix,
        ImportedGeometry, Metadata, Plane, Sketch, SketchConstraint, SketchVar, SketchVarId, Solid, TagIdentifier,
        UnsolvedExpr,
        annotations::{self, FnAttrs, SETTINGS, SETTINGS_UNIT_LENGTH},
        types::{NumericType, PrimitiveType, RuntimeType},
    },
    parsing::ast::types::{
        DefaultParamVal, FunctionExpression, KclNone, Literal, LiteralValue, Node, NumericLiteral, TagDeclarator,
        TagNode, Type,
    },
    std::{StdFnProps, args::TyF64},
};

pub type KclObjectFields = HashMap<String, KclValue>;

/// Any KCL value.
#[derive(Debug, Clone, Serialize, PartialEq, ts_rs::TS)]
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
    SketchVar {
        value: Box<SketchVar>,
    },
    SketchConstraint {
        value: Box<SketchConstraint>,
    },
    Tuple {
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
        constrainable: bool,
        #[serde(skip)]
        meta: Vec<Metadata>,
    },
    TagIdentifier(Box<TagIdentifier>),
    TagDeclarator(crate::parsing::ast::types::BoxNode<TagDeclarator>),
    GdtAnnotation {
        value: Box<GdtAnnotation>,
    },
    Plane {
        value: Box<Plane>,
    },
    Face {
        value: Box<Face>,
    },
    Segment {
        value: Box<AbstractSegment>,
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
    Function {
        #[serde(serialize_with = "function_value_stub")]
        #[ts(type = "null")]
        value: Box<FunctionSource>,
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
        experimental: bool,
        #[serde(skip)]
        meta: Vec<Metadata>,
    },
    KclNone {
        value: KclNone,
        #[serde(skip)]
        meta: Vec<Metadata>,
    },
}

fn function_value_stub<S>(_value: &FunctionSource, serializer: S) -> Result<S::Ok, S::Error>
where
    S: serde::Serializer,
{
    serializer.serialize_unit()
}

#[derive(Debug, Clone, PartialEq)]
pub struct FunctionSource {
    pub input_arg: Option<(String, Option<Type>)>,
    pub named_args: IndexMap<String, (Option<DefaultParamVal>, Option<Type>)>,
    pub return_type: Option<Node<Type>>,
    pub deprecated: bool,
    pub experimental: bool,
    pub include_in_feature_tree: bool,
    pub is_std: bool,
    pub body: FunctionBody,
    pub ast: crate::parsing::ast::types::BoxNode<FunctionExpression>,
}

pub struct KclFunctionSourceParams {
    pub is_std: bool,
    pub experimental: bool,
    pub include_in_feature_tree: bool,
}

impl FunctionSource {
    pub fn rust(
        func: crate::std::StdFn,
        ast: Box<Node<FunctionExpression>>,
        _props: StdFnProps,
        attrs: FnAttrs,
    ) -> Self {
        let (input_arg, named_args) = Self::args_from_ast(&ast);

        FunctionSource {
            input_arg,
            named_args,
            return_type: ast.return_type.clone(),
            deprecated: attrs.deprecated,
            experimental: attrs.experimental,
            include_in_feature_tree: attrs.include_in_feature_tree,
            is_std: true,
            body: FunctionBody::Rust(func),
            ast,
        }
    }

    pub fn kcl(ast: Box<Node<FunctionExpression>>, memory: EnvironmentRef, params: KclFunctionSourceParams) -> Self {
        let KclFunctionSourceParams {
            is_std,
            experimental,
            include_in_feature_tree,
        } = params;
        let (input_arg, named_args) = Self::args_from_ast(&ast);
        FunctionSource {
            input_arg,
            named_args,
            return_type: ast.return_type.clone(),
            deprecated: false,
            experimental,
            include_in_feature_tree,
            is_std,
            body: FunctionBody::Kcl(memory),
            ast,
        }
    }

    #[allow(clippy::type_complexity)]
    fn args_from_ast(
        ast: &FunctionExpression,
    ) -> (
        Option<(String, Option<Type>)>,
        IndexMap<String, (Option<DefaultParamVal>, Option<Type>)>,
    ) {
        let mut input_arg = None;
        let mut named_args = IndexMap::new();
        for p in &ast.params {
            if !p.labeled {
                input_arg = Some((
                    p.identifier.name.clone(),
                    p.param_type.as_ref().map(|t| t.inner.clone()),
                ));
                continue;
            }

            named_args.insert(
                p.identifier.name.clone(),
                (p.default_value.clone(), p.param_type.as_ref().map(|t| t.inner.clone())),
            );
        }

        (input_arg, named_args)
    }
}

#[derive(Debug, Clone, PartialEq)]
// If you try to compare two `crate::std::StdFn` the results will be meaningless and arbitrary,
// because they're just function pointers.
#[allow(unpredictable_function_pointer_comparisons)]
pub enum FunctionBody {
    Rust(crate::std::StdFn),
    Kcl(EnvironmentRef),
}

#[derive(Debug, Clone, PartialEq)]
pub enum TypeDef {
    RustRepr(PrimitiveType, StdFnProps),
    Alias(RuntimeType),
}

impl From<Vec<GdtAnnotation>> for KclValue {
    fn from(mut values: Vec<GdtAnnotation>) -> Self {
        if values.len() == 1 {
            let value = values.pop().expect("Just checked len == 1");
            KclValue::GdtAnnotation { value: Box::new(value) }
        } else {
            KclValue::HomArray {
                value: values
                    .into_iter()
                    .map(|s| KclValue::GdtAnnotation { value: Box::new(s) })
                    .collect(),
                ty: RuntimeType::Primitive(PrimitiveType::GdtAnnotation),
            }
        }
    }
}

impl From<Vec<Sketch>> for KclValue {
    fn from(mut eg: Vec<Sketch>) -> Self {
        if eg.len() == 1
            && let Some(s) = eg.pop()
        {
            KclValue::Sketch { value: Box::new(s) }
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
        if eg.len() == 1
            && let Some(s) = eg.pop()
        {
            KclValue::Solid { value: Box::new(s) }
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
            KclValue::GdtAnnotation { value } => to_vec_sr(&value.meta),
            KclValue::Solid { value } => to_vec_sr(&value.meta),
            KclValue::Sketch { value } => to_vec_sr(&value.meta),
            KclValue::Helix { value } => to_vec_sr(&value.meta),
            KclValue::ImportedGeometry(i) => to_vec_sr(&i.meta),
            KclValue::Function { meta, .. } => to_vec_sr(&meta),
            KclValue::Plane { value } => to_vec_sr(&value.meta),
            KclValue::Face { value } => to_vec_sr(&value.meta),
            KclValue::Segment { value } => to_vec_sr(&value.meta),
            KclValue::Bool { meta, .. } => to_vec_sr(&meta),
            KclValue::Number { meta, .. } => to_vec_sr(&meta),
            KclValue::String { meta, .. } => to_vec_sr(&meta),
            KclValue::SketchVar { value, .. } => to_vec_sr(&value.meta),
            KclValue::SketchConstraint { value, .. } => to_vec_sr(&value.meta),
            KclValue::Tuple { meta, .. } => to_vec_sr(&meta),
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
            KclValue::GdtAnnotation { value } => to_vec_sr(&value.meta),
            KclValue::Solid { value } => to_vec_sr(&value.meta),
            KclValue::Sketch { value } => to_vec_sr(&value.meta),
            KclValue::Helix { value } => to_vec_sr(&value.meta),
            KclValue::ImportedGeometry(i) => to_vec_sr(&i.meta),
            KclValue::Function { meta, .. } => to_vec_sr(meta),
            KclValue::Plane { value } => to_vec_sr(&value.meta),
            KclValue::Face { value } => to_vec_sr(&value.meta),
            KclValue::Segment { value } => to_vec_sr(&value.meta),
            KclValue::Bool { meta, .. } => to_vec_sr(meta),
            KclValue::Number { meta, .. } => to_vec_sr(meta),
            KclValue::String { meta, .. } => to_vec_sr(meta),
            KclValue::SketchVar { value, .. } => to_vec_sr(&value.meta),
            KclValue::SketchConstraint { value, .. } => to_vec_sr(&value.meta),
            KclValue::Uuid { meta, .. } => to_vec_sr(meta),
            KclValue::Tuple { meta, .. } => to_vec_sr(meta),
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
            KclValue::SketchVar { value, .. } => value.meta.clone(),
            KclValue::SketchConstraint { value, .. } => value.meta.clone(),
            KclValue::Tuple { value: _, meta } => meta.clone(),
            KclValue::HomArray { value, .. } => value.iter().flat_map(|v| v.metadata()).collect(),
            KclValue::Object { meta, .. } => meta.clone(),
            KclValue::TagIdentifier(x) => x.meta.clone(),
            KclValue::TagDeclarator(x) => vec![x.metadata()],
            KclValue::GdtAnnotation { value } => value.meta.clone(),
            KclValue::Plane { value } => value.meta.clone(),
            KclValue::Face { value } => value.meta.clone(),
            KclValue::Segment { value } => value.meta.clone(),
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

    #[allow(unused)]
    pub(crate) fn none() -> Self {
        Self::KclNone {
            value: Default::default(),
            meta: Default::default(),
        }
    }

    /// Returns true if we should generate an [`crate::execution::Operation`] to
    /// display in the Feature Tree for variable declarations initialized with
    /// this value.
    pub(crate) fn show_variable_in_feature_tree(&self) -> bool {
        match self {
            KclValue::Uuid { .. } => false,
            KclValue::Bool { .. } | KclValue::Number { .. } | KclValue::String { .. } => true,
            KclValue::SketchVar { .. }
            | KclValue::SketchConstraint { .. }
            | KclValue::Tuple { .. }
            | KclValue::HomArray { .. }
            | KclValue::Object { .. }
            | KclValue::TagIdentifier(_)
            | KclValue::TagDeclarator(_)
            | KclValue::GdtAnnotation { .. }
            | KclValue::Plane { .. }
            | KclValue::Face { .. }
            | KclValue::Segment { .. }
            | KclValue::Sketch { .. }
            | KclValue::Solid { .. }
            | KclValue::Helix { .. }
            | KclValue::ImportedGeometry(_)
            | KclValue::Function { .. }
            | KclValue::Module { .. }
            | KclValue::Type { .. }
            | KclValue::KclNone { .. } => false,
        }
    }

    /// Human readable type name used in error messages.  Should not be relied
    /// on for program logic.
    pub(crate) fn human_friendly_type(&self) -> String {
        match self {
            KclValue::Uuid { .. } => "a unique ID (uuid)".to_owned(),
            KclValue::TagDeclarator(_) => "a tag declarator".to_owned(),
            KclValue::TagIdentifier(_) => "a tag identifier".to_owned(),
            KclValue::GdtAnnotation { .. } => "an annotation".to_owned(),
            KclValue::Solid { .. } => "a solid".to_owned(),
            KclValue::Sketch { .. } => "a sketch".to_owned(),
            KclValue::Helix { .. } => "a helix".to_owned(),
            KclValue::ImportedGeometry(_) => "an imported geometry".to_owned(),
            KclValue::Function { .. } => "a function".to_owned(),
            KclValue::Plane { .. } => "a plane".to_owned(),
            KclValue::Face { .. } => "a face".to_owned(),
            KclValue::Segment { .. } => "a segment".to_owned(),
            KclValue::Bool { .. } => "a boolean (`true` or `false`)".to_owned(),
            KclValue::Number {
                ty: NumericType::Unknown,
                ..
            } => "a number with unknown units".to_owned(),
            KclValue::Number {
                ty: NumericType::Known(units),
                ..
            } => format!("a number ({units})"),
            KclValue::Number { .. } => "a number".to_owned(),
            KclValue::String { .. } => "a string".to_owned(),
            KclValue::SketchVar { .. } => "a sketch variable".to_owned(),
            KclValue::SketchConstraint { .. } => "a sketch constraint".to_owned(),
            KclValue::Object { .. } => "an object".to_owned(),
            KclValue::Module { .. } => "a module".to_owned(),
            KclValue::Type { .. } => "a type".to_owned(),
            KclValue::KclNone { .. } => "none".to_owned(),
            KclValue::Tuple { value, .. } | KclValue::HomArray { value, .. } => {
                if value.is_empty() {
                    "an empty array".to_owned()
                } else {
                    // A max of 3 is good because it's common to use 3D points.
                    const MAX: usize = 3;

                    let len = value.len();
                    let element_tys = value
                        .iter()
                        .take(MAX)
                        .map(|elem| elem.principal_type_string())
                        .collect::<Vec<_>>()
                        .join(", ");
                    let mut result = format!("an array of {element_tys}");
                    if len > MAX {
                        result.push_str(&format!(", ... with {len} values"));
                    }
                    if len == 1 {
                        result.push_str(" with 1 value");
                    }
                    result
                }
            }
        }
    }

    pub(crate) fn from_sketch_var_literal(
        literal: &Node<NumericLiteral>,
        id: SketchVarId,
        exec_state: &ExecState,
    ) -> Self {
        let meta = vec![literal.metadata()];
        let ty = NumericType::from_parsed(literal.suffix, &exec_state.mod_local.settings);
        KclValue::SketchVar {
            value: Box::new(SketchVar {
                id,
                initial_value: literal.value,
                meta,
                ty,
            }),
        }
    }

    pub(crate) fn from_literal(literal: Node<Literal>, exec_state: &mut ExecState) -> Self {
        let meta = vec![literal.metadata()];
        match literal.inner.value {
            LiteralValue::Number { value, suffix } => {
                let ty = NumericType::from_parsed(suffix, &exec_state.mod_local.settings);
                if let NumericType::Default { len, .. } = &ty
                    && !exec_state.mod_local.explicit_length_units
                    && *len != UnitLength::Millimeters
                {
                    exec_state.warn(
                        CompilationError::err(
                            literal.as_source_range(),
                            "Project-wide units are deprecated. Prefer to use per-file default units.",
                        )
                        .with_suggestion(
                            "Fix by adding per-file settings",
                            format!("@{SETTINGS}({SETTINGS_UNIT_LENGTH} = {len})\n"),
                            // Insert at the start of the file.
                            Some(SourceRange::new(0, 0, literal.module_id)),
                            crate::errors::Tag::Deprecated,
                        ),
                        annotations::WARN_DEPRECATED,
                    );
                }
                KclValue::Number { value, meta, ty }
            }
            LiteralValue::String(value) => KclValue::String { value, meta },
            LiteralValue::Bool(value) => KclValue::Bool { value, meta },
        }
    }

    pub(crate) fn from_default_param(param: DefaultParamVal, exec_state: &mut ExecState) -> Self {
        match param {
            DefaultParamVal::Literal(lit) => Self::from_literal(lit, exec_state),
            DefaultParamVal::KclNone(value) => KclValue::KclNone {
                value,
                meta: Default::default(),
            },
        }
    }

    pub(crate) fn map_env_ref(&self, old_env: EnvironmentRef, new_env: EnvironmentRef) -> Self {
        let mut result = self.clone();
        if let KclValue::Function { ref mut value, .. } = result
            && let FunctionSource {
                body: FunctionBody::Kcl(memory),
                ..
            } = &mut **value
        {
            memory.replace_env(old_env, new_env);
        }

        result
    }

    pub(crate) fn map_env_ref_and_epoch(&self, old_env: EnvironmentRef, new_env: EnvironmentRef) -> Self {
        let mut result = self.clone();
        if let KclValue::Function { ref mut value, .. } = result
            && let FunctionSource {
                body: FunctionBody::Kcl(memory),
                ..
            } = &mut **value
        {
            memory.replace_env_and_epoch(old_env, new_env);
        }

        result
    }

    pub const fn from_number_with_type(f: f64, ty: NumericType, meta: Vec<Metadata>) -> Self {
        Self::Number { value: f, meta, ty }
    }

    /// Put the point into a KCL value.
    pub fn from_point2d(p: [f64; 2], ty: NumericType, meta: Vec<Metadata>) -> Self {
        let [x, y] = p;
        Self::Tuple {
            value: vec![
                Self::Number {
                    value: x,
                    meta: meta.clone(),
                    ty,
                },
                Self::Number {
                    value: y,
                    meta: meta.clone(),
                    ty,
                },
            ],
            meta,
        }
    }

    /// Put the point into a KCL value.
    pub fn from_point3d(p: [f64; 3], ty: NumericType, meta: Vec<Metadata>) -> Self {
        let [x, y, z] = p;
        Self::Tuple {
            value: vec![
                Self::Number {
                    value: x,
                    meta: meta.clone(),
                    ty,
                },
                Self::Number {
                    value: y,
                    meta: meta.clone(),
                    ty,
                },
                Self::Number {
                    value: z,
                    meta: meta.clone(),
                    ty,
                },
            ],
            meta,
        }
    }

    /// Put the point into a KCL point.
    pub(crate) fn array_from_point2d(p: [f64; 2], ty: NumericType, meta: Vec<Metadata>) -> Self {
        let [x, y] = p;
        Self::HomArray {
            value: vec![
                Self::Number {
                    value: x,
                    meta: meta.clone(),
                    ty,
                },
                Self::Number { value: y, meta, ty },
            ],
            ty: ty.into(),
        }
    }

    /// Put the point into a KCL point.
    pub fn array_from_point3d(p: [f64; 3], ty: NumericType, meta: Vec<Metadata>) -> Self {
        let [x, y, z] = p;
        Self::HomArray {
            value: vec![
                Self::Number {
                    value: x,
                    meta: meta.clone(),
                    ty,
                },
                Self::Number {
                    value: y,
                    meta: meta.clone(),
                    ty,
                },
                Self::Number { value: z, meta, ty },
            ],
            ty: ty.into(),
        }
    }

    pub(crate) fn from_unsolved_expr(expr: UnsolvedExpr, meta: Vec<Metadata>) -> Self {
        match expr {
            UnsolvedExpr::Known(v) => crate::execution::KclValue::Number {
                value: v.n,
                ty: v.ty,
                meta,
            },
            UnsolvedExpr::Unknown(var_id) => crate::execution::KclValue::SketchVar {
                value: Box::new(SketchVar {
                    id: var_id,
                    initial_value: Default::default(),
                    // TODO: Should this be the solver units?
                    ty: Default::default(),
                    meta,
                }),
            },
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

    pub fn as_int_with_ty(&self) -> Option<(i64, NumericType)> {
        match self {
            KclValue::Number { value, ty, .. } => crate::try_f64_to_i64(*value).map(|i| (i, *ty)),
            _ => None,
        }
    }

    pub fn as_object(&self) -> Option<&KclObjectFields> {
        match self {
            KclValue::Object { value, .. } => Some(value),
            _ => None,
        }
    }

    pub fn into_object(self) -> Option<KclObjectFields> {
        match self {
            KclValue::Object { value, .. } => Some(value),
            _ => None,
        }
    }

    pub fn as_unsolved_expr(&self) -> Option<UnsolvedExpr> {
        match self {
            KclValue::Number { value, ty, .. } => Some(UnsolvedExpr::Known(TyF64::new(*value, *ty))),
            KclValue::SketchVar { value, .. } => Some(UnsolvedExpr::Unknown(value.id)),
            _ => None,
        }
    }

    pub fn to_sketch_expr(&self) -> Option<crate::front::Expr> {
        match self {
            KclValue::Number { value, ty, .. } => Some(crate::front::Expr::Number(crate::front::Number {
                value: *value,
                units: (*ty).try_into().ok()?,
            })),
            KclValue::SketchVar { value, .. } => Some(crate::front::Expr::Var(crate::front::Number {
                value: value.initial_value,
                units: value.ty.try_into().ok()?,
            })),
            _ => None,
        }
    }

    pub fn as_str(&self) -> Option<&str> {
        match self {
            KclValue::String { value, .. } => Some(value),
            _ => None,
        }
    }

    pub fn into_array(self) -> Vec<KclValue> {
        match self {
            KclValue::Tuple { value, .. } | KclValue::HomArray { value, .. } => value,
            _ => vec![self],
        }
    }

    pub fn as_point2d(&self) -> Option<[TyF64; 2]> {
        let value = match self {
            KclValue::Tuple { value, .. } | KclValue::HomArray { value, .. } => value,
            _ => return None,
        };

        let [x, y] = value.as_slice() else {
            return None;
        };
        let x = x.as_ty_f64()?;
        let y = y.as_ty_f64()?;
        Some([x, y])
    }

    pub fn as_point3d(&self) -> Option<[TyF64; 3]> {
        let value = match self {
            KclValue::Tuple { value, .. } | KclValue::HomArray { value, .. } => value,
            _ => return None,
        };

        let [x, y, z] = value.as_slice() else {
            return None;
        };
        let x = x.as_ty_f64()?;
        let y = y.as_ty_f64()?;
        let z = z.as_ty_f64()?;
        Some([x, y, z])
    }

    pub fn as_uuid(&self) -> Option<uuid::Uuid> {
        match self {
            KclValue::Uuid { value, .. } => Some(*value),
            _ => None,
        }
    }

    pub fn as_plane(&self) -> Option<&Plane> {
        match self {
            KclValue::Plane { value, .. } => Some(value),
            _ => None,
        }
    }

    pub fn as_solid(&self) -> Option<&Solid> {
        match self {
            KclValue::Solid { value, .. } => Some(value),
            _ => None,
        }
    }

    pub fn as_sketch(&self) -> Option<&Sketch> {
        match self {
            KclValue::Sketch { value, .. } => Some(value),
            _ => None,
        }
    }

    pub fn as_mut_sketch(&mut self) -> Option<&mut Sketch> {
        match self {
            KclValue::Sketch { value } => Some(value),
            _ => None,
        }
    }

    pub fn as_sketch_var(&self) -> Option<&SketchVar> {
        match self {
            KclValue::SketchVar { value, .. } => Some(value),
            _ => None,
        }
    }

    pub fn as_mut_tag(&mut self) -> Option<&mut TagIdentifier> {
        match self {
            KclValue::TagIdentifier(value) => Some(value),
            _ => None,
        }
    }

    #[cfg(test)]
    pub fn as_f64(&self) -> Option<f64> {
        match self {
            KclValue::Number { value, .. } => Some(*value),
            _ => None,
        }
    }

    pub fn as_ty_f64(&self) -> Option<TyF64> {
        match self {
            KclValue::Number { value, ty, .. } => Some(TyF64::new(*value, *ty)),
            _ => None,
        }
    }

    pub fn as_bool(&self) -> Option<bool> {
        match self {
            KclValue::Bool { value, .. } => Some(*value),
            _ => None,
        }
    }

    /// If this value is of type function, return it.
    pub fn as_function(&self) -> Option<&FunctionSource> {
        match self {
            KclValue::Function { value, .. } => Some(value),
            _ => None,
        }
    }

    /// Get a tag identifier from a memory item.
    pub fn get_tag_identifier(&self) -> Result<TagIdentifier, KclError> {
        match self {
            KclValue::TagIdentifier(t) => Ok(*t.clone()),
            _ => Err(KclError::new_semantic(KclErrorDetails::new(
                format!("Not a tag identifier: {self:?}"),
                self.clone().into(),
            ))),
        }
    }

    /// Get a tag declarator from a memory item.
    pub fn get_tag_declarator(&self) -> Result<TagNode, KclError> {
        match self {
            KclValue::TagDeclarator(t) => Ok((**t).clone()),
            _ => Err(KclError::new_semantic(KclErrorDetails::new(
                format!("Not a tag declarator: {self:?}"),
                self.clone().into(),
            ))),
        }
    }

    /// If this KCL value is a bool, retrieve it.
    pub fn get_bool(&self) -> Result<bool, KclError> {
        self.as_bool().ok_or_else(|| {
            KclError::new_type(KclErrorDetails::new(
                format!("Expected bool, found {}", self.human_friendly_type()),
                self.into(),
            ))
        })
    }

    pub fn is_unknown_number(&self) -> bool {
        match self {
            KclValue::Number { ty, .. } => !ty.is_fully_specified(),
            _ => false,
        }
    }

    pub fn value_str(&self) -> Option<String> {
        match self {
            KclValue::Bool { value, .. } => Some(format!("{value}")),
            // TODO: Show units.
            KclValue::Number { value, .. } => Some(format!("{value}")),
            KclValue::String { value, .. } => Some(format!("'{value}'")),
            // TODO: Show units.
            KclValue::SketchVar { value, .. } => Some(format!("var {}", value.initial_value)),
            KclValue::Uuid { value, .. } => Some(format!("{value}")),
            KclValue::TagDeclarator(tag) => Some(format!("${}", tag.name)),
            KclValue::TagIdentifier(tag) => Some(format!("${}", tag.value)),
            // TODO better Array and Object stringification
            KclValue::Tuple { .. } => Some("[...]".to_owned()),
            KclValue::HomArray { .. } => Some("[...]".to_owned()),
            KclValue::Object { .. } => Some("{ ... }".to_owned()),
            KclValue::Module { .. }
            | KclValue::GdtAnnotation { .. }
            | KclValue::SketchConstraint { .. }
            | KclValue::Solid { .. }
            | KclValue::Sketch { .. }
            | KclValue::Helix { .. }
            | KclValue::ImportedGeometry(_)
            | KclValue::Function { .. }
            | KclValue::Plane { .. }
            | KclValue::Face { .. }
            | KclValue::Segment { .. }
            | KclValue::KclNone { .. }
            | KclValue::Type { .. } => None,
        }
    }
}

impl From<Geometry> for KclValue {
    fn from(value: Geometry) -> Self {
        match value {
            Geometry::Sketch(x) => Self::Sketch { value: Box::new(x) },
            Geometry::Solid(x) => Self::Solid { value: Box::new(x) },
        }
    }
}

impl From<GeometryWithImportedGeometry> for KclValue {
    fn from(value: GeometryWithImportedGeometry) -> Self {
        match value {
            GeometryWithImportedGeometry::Sketch(x) => Self::Sketch { value: Box::new(x) },
            GeometryWithImportedGeometry::Solid(x) => Self::Solid { value: Box::new(x) },
            GeometryWithImportedGeometry::ImportedGeometry(x) => Self::ImportedGeometry(*x),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::exec::UnitType;

    #[test]
    fn test_human_friendly_type() {
        let len = KclValue::Number {
            value: 1.0,
            ty: NumericType::Known(UnitType::GenericLength),
            meta: vec![],
        };
        assert_eq!(len.human_friendly_type(), "a number (Length)".to_string());

        let unknown = KclValue::Number {
            value: 1.0,
            ty: NumericType::Unknown,
            meta: vec![],
        };
        assert_eq!(unknown.human_friendly_type(), "a number with unknown units".to_string());

        let mm = KclValue::Number {
            value: 1.0,
            ty: NumericType::Known(UnitType::Length(UnitLength::Millimeters)),
            meta: vec![],
        };
        assert_eq!(mm.human_friendly_type(), "a number (mm)".to_string());

        let array1_mm = KclValue::HomArray {
            value: vec![mm.clone()],
            ty: RuntimeType::any(),
        };
        assert_eq!(
            array1_mm.human_friendly_type(),
            "an array of `number(mm)` with 1 value".to_string()
        );

        let array2_mm = KclValue::HomArray {
            value: vec![mm.clone(), mm.clone()],
            ty: RuntimeType::any(),
        };
        assert_eq!(
            array2_mm.human_friendly_type(),
            "an array of `number(mm)`, `number(mm)`".to_string()
        );

        let array3_mm = KclValue::HomArray {
            value: vec![mm.clone(), mm.clone(), mm.clone()],
            ty: RuntimeType::any(),
        };
        assert_eq!(
            array3_mm.human_friendly_type(),
            "an array of `number(mm)`, `number(mm)`, `number(mm)`".to_string()
        );

        let inches = KclValue::Number {
            value: 1.0,
            ty: NumericType::Known(UnitType::Length(UnitLength::Inches)),
            meta: vec![],
        };
        let array4 = KclValue::HomArray {
            value: vec![mm.clone(), mm.clone(), inches, mm],
            ty: RuntimeType::any(),
        };
        assert_eq!(
            array4.human_friendly_type(),
            "an array of `number(mm)`, `number(mm)`, `number(in)`, ... with 4 values".to_string()
        );

        let empty_array = KclValue::HomArray {
            value: vec![],
            ty: RuntimeType::any(),
        };
        assert_eq!(empty_array.human_friendly_type(), "an empty array".to_string());

        let array_nested = KclValue::HomArray {
            value: vec![array2_mm],
            ty: RuntimeType::any(),
        };
        assert_eq!(
            array_nested.human_friendly_type(),
            "an array of `[any; 2]` with 1 value".to_string()
        );
    }
}
