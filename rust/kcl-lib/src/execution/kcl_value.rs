use std::collections::HashMap;
use std::sync::Arc;

use anyhow::Result;
use indexmap::IndexMap;
use kcl_api::UnitLength;
use serde::Serialize;
use serde::Serializer;

use crate::CompilationIssue;
use crate::KclError;
use crate::ModuleId;
use crate::SourceRange;
use crate::errors::KclErrorDetails;
use crate::execution::AbstractSegment;
use crate::execution::BoundedEdge;
use crate::execution::CameraView;
use crate::execution::EnvironmentRef;
use crate::execution::ExecState;
use crate::execution::Face;
use crate::execution::GdtAnnotation;
use crate::execution::Geometry;
use crate::execution::GeometryWithImportedGeometry;
use crate::execution::Helix;
use crate::execution::ImportedGeometry;
use crate::execution::Metadata;
use crate::execution::NamedViewValue;
use crate::execution::Plane;
use crate::execution::Segment;
use crate::execution::SegmentRepr;
use crate::execution::Sketch;
use crate::execution::SketchConstraint;
use crate::execution::SketchVar;
use crate::execution::SketchVarId;
use crate::execution::Solid;
use crate::execution::TagIdentifier;
use crate::execution::UnsolvedExpr;
use crate::execution::annotations::FnAttrs;
use crate::execution::annotations::SETTINGS;
use crate::execution::annotations::SETTINGS_UNIT_LENGTH;
use crate::execution::annotations::VersionConstraint;
use crate::execution::annotations::{self};
use crate::execution::types::NumericType;
use crate::execution::types::NumericTypeExt;
use crate::execution::types::PrimitiveType;
use crate::execution::types::RuntimeType;
use crate::parsing::ast::types::BoxNode;
use crate::parsing::ast::types::DefaultParamVal;
use crate::parsing::ast::types::FunctionExpression;
use crate::parsing::ast::types::KclNone;
use crate::parsing::ast::types::Literal;
use crate::parsing::ast::types::LiteralValue;
use crate::parsing::ast::types::Node;
use crate::parsing::ast::types::NumericLiteral;
use crate::parsing::ast::types::TagDeclarator;
use crate::parsing::ast::types::TagNode;
use crate::parsing::ast::types::Type;
use crate::std::StdFnProps;
use crate::std::args::TyF64;

pub type KclObjectFields = HashMap<String, KclValue>;

#[derive(Debug, Clone, Default, PartialEq, Serialize)]
pub enum KclObjectKind {
    #[default]
    Default,
    SketchTags {
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        deprecated_solid_tag_names: Vec<String>,
    },
}

impl KclObjectKind {
    pub(crate) fn is_default(&self) -> bool {
        match self {
            KclObjectKind::Default => true,
            KclObjectKind::SketchTags { .. } => false,
        }
    }

    pub(crate) fn deprecated_solid_tag_names(&self) -> &[String] {
        match self {
            Self::Default => &[],
            Self::SketchTags {
                deprecated_solid_tag_names,
            } => deprecated_solid_tag_names,
        }
    }
}

/// Any KCL value.
#[derive(Debug, Clone, Serialize, PartialEq)]
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
    Enum {
        value: Box<EnumValue>,
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
        #[serde(default, skip_serializing_if = "KclObjectKind::is_default")]
        object_kind: KclObjectKind,
        #[serde(skip)]
        meta: Vec<Metadata>,
    },
    TagIdentifier(Box<TagIdentifier>),
    TagDeclarator(BoxNode<TagDeclarator>),
    GdtAnnotation {
        value: Box<GdtAnnotation>,
    },
    Plane {
        value: Box<Plane>,
    },
    Face {
        value: Box<Face>,
    },
    BoundedEdge {
        value: BoundedEdge,
        meta: Vec<Metadata>,
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
    CameraView {
        value: Box<CameraView>,
    },
    NamedView {
        value: Box<NamedViewValue>,
    },
    ImportedGeometry(ImportedGeometry),
    Function {
        #[serde(serialize_with = "function_value_stub")]
        value: Box<FunctionSource>,
        #[serde(skip)]
        meta: Vec<Metadata>,
    },
    Module {
        value: ModuleId,
        #[serde(skip)]
        meta: Vec<Metadata>,
    },
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
pub struct NamedParam {
    pub experimental: bool,
    /// If true, this parameter is deprecated regardless of the KCL version.
    pub deprecated: bool,
    /// Constraint marking the KCL version at or after which this parameter is deprecated.
    pub deprecated_since: Option<VersionConstraint>,
    pub default_value: Option<DefaultParamVal>,
    pub ty: Option<Type>,
    /// The `RuntimeType` that `ty` resolved to when the function declaration
    /// executed, so the resolution happened in the scope where the signature
    /// is written. `None` when `ty` is `None`. Populated by
    /// [`FunctionSource::resolve_signature_types`].
    pub resolved_ty: Option<RuntimeType>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct FunctionSource {
    pub input_arg: Option<(String, Option<Type>)>,
    /// The `RuntimeType` that the input (unlabeled) argument's type resolved
    /// to when the function declaration executed. `None` when the input
    /// argument has no type annotation. Populated by
    /// [`FunctionSource::resolve_signature_types`].
    pub resolved_input_ty: Option<RuntimeType>,
    pub named_args: IndexMap<String, NamedParam>,
    pub return_type: Option<Node<Type>>,
    /// The `RuntimeType` that `return_type` resolved to when the function
    /// declaration executed. `None` when `return_type` is `None`. Populated
    /// by [`FunctionSource::resolve_signature_types`].
    pub resolved_return_ty: Option<RuntimeType>,
    pub deprecated: bool,
    /// Constraint on the KCL version at which this function is deprecated, e.g.
    /// "2.0". When the active `kclVersion` is at or after this, calls trigger a
    /// deprecation warning.
    pub deprecated_since: Option<VersionConstraint>,
    pub experimental: bool,
    pub include_in_feature_tree: bool,
    pub std_props: Option<StdFnProps>,
    pub body: FunctionBody,
    pub ast: BoxNode<FunctionExpression>,
}

pub struct KclFunctionSourceParams {
    pub std_props: Option<StdFnProps>,
    pub experimental: bool,
    pub include_in_feature_tree: bool,
}

impl FunctionSource {
    pub fn rust(func: crate::std::StdFn, ast: BoxNode<FunctionExpression>, props: StdFnProps, attrs: FnAttrs) -> Self {
        let (input_arg, named_args) = Self::args_from_ast(&ast);

        FunctionSource {
            input_arg,
            resolved_input_ty: None,
            named_args,
            return_type: ast.return_type.clone(),
            resolved_return_ty: None,
            deprecated: attrs.deprecated,
            deprecated_since: attrs.deprecated_since,
            experimental: attrs.experimental,
            include_in_feature_tree: attrs.include_in_feature_tree,
            std_props: Some(props),
            body: FunctionBody::Rust(func),
            ast,
        }
    }

    pub fn kcl(ast: BoxNode<FunctionExpression>, memory: EnvironmentRef, params: KclFunctionSourceParams) -> Self {
        let KclFunctionSourceParams {
            std_props,
            experimental,
            include_in_feature_tree,
        } = params;
        let (input_arg, named_args) = Self::args_from_ast(&ast);
        FunctionSource {
            input_arg,
            resolved_input_ty: None,
            named_args,
            return_type: ast.return_type.clone(),
            resolved_return_ty: None,
            deprecated: false,
            deprecated_since: None,
            experimental,
            include_in_feature_tree,
            std_props,
            body: FunctionBody::Kcl(memory),
            ast,
        }
    }

    #[expect(clippy::type_complexity)]
    fn args_from_ast(ast: &FunctionExpression) -> (Option<(String, Option<Type>)>, IndexMap<String, NamedParam>) {
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
                NamedParam {
                    experimental: p.experimental,
                    deprecated: p.deprecated,
                    deprecated_since: p.deprecated_since.clone(),
                    default_value: p.default_value.clone(),
                    ty: p.param_type.as_ref().map(|t| t.inner.clone()),
                    resolved_ty: None,
                },
            );
        }

        (input_arg, named_args)
    }

    pub(crate) fn is_std(&self) -> bool {
        self.std_props.is_some()
    }

    /// Resolve every parameter type and the return type of this function's
    /// signature into a `RuntimeType`, looking type names up in the current
    /// environment.
    ///
    /// This must run while the function declaration executes, so that a type
    /// name in a signature resolves in the scope where the signature is
    /// written. Argument and return-value coercion consume the stored results
    /// and perform no name resolution of their own. A name that does not
    /// resolve is an error at the declaration, and an experimental type warns
    /// here, once, rather than at every call.
    pub(crate) fn resolve_signature_types(&mut self, exec_state: &mut ExecState) -> Result<(), KclError> {
        for param in &self.ast.params {
            let Some(ty) = &param.param_type else {
                continue;
            };
            let resolved = RuntimeType::from_parsed(ty.inner.clone(), exec_state, ty.as_source_range(), false, false)
                .map_err(|e| KclError::new_semantic(e.into()))?;
            if param.labeled {
                if let Some(named) = self.named_args.get_mut(&param.identifier.name) {
                    named.resolved_ty = Some(resolved);
                }
            } else {
                self.resolved_input_ty = Some(resolved);
            }
        }

        if let Some(ret_ty) = &self.return_type {
            self.resolved_return_ty = Some(
                RuntimeType::from_parsed(ret_ty.inner.clone(), exec_state, ret_ty.as_source_range(), false, false)
                    .map_err(|e| KclError::new_semantic(e.into()))?,
            );
        }

        Ok(())
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
    /// Shared rather than owned so that every value of the enum points at the
    /// one declaration object, and so that reading the type out of memory,
    /// which clones the `KclValue`, does not copy the variant list.
    Enum(Arc<EnumTypeDef>),
}

/// The nominal identity of an enum.
///
/// Two enums are the same type only if they come from the same `type`
/// declaration, so identity is the declaring module plus the name written at
/// the declaration site. Importing under an alias renames the binding, not the
/// type, so it leaves identity untouched. Two enums declaring identical variant
/// names are still distinct types.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize)]
pub struct EnumTypeId {
    module_id: ModuleId,
    declared_name: String,
}

impl EnumTypeId {
    pub fn new(module_id: ModuleId, declared_name: impl Into<String>) -> Self {
        Self {
            module_id,
            declared_name: declared_name.into(),
        }
    }

    pub fn module_id(&self) -> ModuleId {
        self.module_id
    }

    /// The name at the declaration site, which is what users see in
    /// diagnostics even when the enum was imported under another name.
    pub fn declared_name(&self) -> &str {
        &self.declared_name
    }
}

/// A declared enum: its identity plus its variants in declaration order.
#[derive(Debug, Clone, PartialEq)]
pub struct EnumTypeDef {
    id: EnumTypeId,
    variants: Vec<String>,
}

/// Two variants of one enum declared under the same name, e.g.
/// `type Color { | Red | Red }`.
///
/// Carries indices into the variant list rather than source ranges so that
/// `EnumTypeDef` stays independent of the AST and of diagnostic types. The
/// caller holds the declaration, so it can turn an index back into the range it
/// needs for the error it reports.
#[derive(Debug, Clone, PartialEq)]
pub struct DuplicateVariant {
    /// The name declared twice.
    pub name: String,
    /// Where the name was first declared.
    pub first_index: usize,
    /// Where it was declared again. Always greater than `first_index`.
    pub duplicate_index: usize,
}

impl EnumTypeDef {
    /// Variant names must be unique, so this is the only way to build an
    /// `EnumTypeDef` and it rejects a repeat rather than dropping it. Silently
    /// collapsing duplicates would deny the user a diagnostic naming the variant
    /// they typed twice.
    ///
    /// Reports the earliest repeat when a declaration contains several.
    pub fn new(id: EnumTypeId, variants: Vec<String>) -> Result<Self, DuplicateVariant> {
        for (duplicate_index, variant) in variants.iter().enumerate() {
            if let Some(first_index) = variants[..duplicate_index].iter().position(|v| v == variant) {
                return Err(DuplicateVariant {
                    name: variant.clone(),
                    first_index,
                    duplicate_index,
                });
            }
        }

        Ok(Self { id, variants })
    }

    pub fn id(&self) -> &EnumTypeId {
        &self.id
    }

    pub fn variants(&self) -> &[String] {
        &self.variants
    }

    pub fn has_variant(&self, name: &str) -> bool {
        self.variants.iter().any(|v| v == name)
    }
}

/// A value of an enum type, i.e. one of its variants.
///
/// V1 variants are nullary, so the variant name is the entire value. The value
/// holds its declaration rather than only the declaration's identity, which is
/// what lets a variant be projected to its declared representation: that
/// representation is per-variant declaration data, and a value cannot find its
/// declaration by name, because an import alias renames the binding and a value
/// can reach a module that never imported the type at all. The declaration is
/// reachable, not part of the value: identity and equality read the declaration's
/// id and the variant name, never a representation.
#[derive(Debug, Clone, Serialize)]
pub struct EnumValue {
    /// Serialized as `enum_id` so that the exposed shape stays the nominal
    /// identity plus the variant, and no declaration data leaks into snapshots
    /// or the memory pane.
    #[serde(rename = "enum_id", serialize_with = "serialize_enum_def_id")]
    def: Arc<EnumTypeDef>,
    variant: String,
    #[serde(skip)]
    meta: Vec<Metadata>,
}

fn serialize_enum_def_id<S: Serializer>(def: &Arc<EnumTypeDef>, serializer: S) -> Result<S::Ok, S::Error> {
    def.id().serialize(serializer)
}

/// Two values are equal when they name the same variant of the same declaration.
/// Written out rather than derived because the declaration handle is a route to
/// the declaration and not part of the value: comparing it would, once variants
/// carry representations, let a representation decide equality.
impl PartialEq for EnumValue {
    fn eq(&self, other: &Self) -> bool {
        self.def.id() == other.def.id() && self.variant == other.variant
    }
}

impl EnumValue {
    pub fn new(def: Arc<EnumTypeDef>, variant: impl Into<String>, meta: Vec<Metadata>) -> Self {
        Self {
            def,
            variant: variant.into(),
            meta,
        }
    }

    pub fn enum_id(&self) -> &EnumTypeId {
        self.def.id()
    }

    pub fn variant(&self) -> &str {
        &self.variant
    }

    pub fn meta(&self) -> &[Metadata] {
        &self.meta
    }

    /// The string this variant projects to under `enumValue: string`.
    ///
    /// The declared representation of the variant, which in V1 is always the
    /// variant name because no variant can declare a `@repr` yet. This is the
    /// single place that answers the question, so when `@repr` lands it reads the
    /// declaration here rather than adding a second notion of representation at
    /// the projection site.
    pub fn declared_string_repr(&self) -> String {
        self.variant.clone()
    }

    /// How the value is written in KCL and shown to users, e.g. `Color::Red`.
    pub fn qualified_name(&self) -> String {
        format!("{}::{}", self.def.id().declared_name(), self.variant)
    }
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
            KclValue::CameraView { value } => to_vec_sr(value.meta()),
            KclValue::NamedView { value } => to_vec_sr(value.meta()),
            KclValue::ImportedGeometry(i) => to_vec_sr(&i.meta),
            KclValue::Function { meta, .. } => to_vec_sr(&meta),
            KclValue::Plane { value } => to_vec_sr(&value.meta),
            KclValue::Face { value } => to_vec_sr(&value.meta),
            KclValue::Segment { value } => to_vec_sr(&value.meta),
            KclValue::Bool { meta, .. } => to_vec_sr(&meta),
            KclValue::Number { meta, .. } => to_vec_sr(&meta),
            KclValue::String { meta, .. } => to_vec_sr(&meta),
            KclValue::Enum { value } => to_vec_sr(value.meta()),
            KclValue::SketchVar { value, .. } => to_vec_sr(&value.meta),
            KclValue::SketchConstraint { value, .. } => to_vec_sr(&value.meta),
            KclValue::Tuple { meta, .. } => to_vec_sr(&meta),
            KclValue::HomArray { value, .. } => value.iter().flat_map(Into::<Vec<SourceRange>>::into).collect(),
            KclValue::Object { meta, .. } => to_vec_sr(&meta),
            KclValue::Module { meta, .. } => to_vec_sr(&meta),
            KclValue::Uuid { meta, .. } => to_vec_sr(&meta),
            KclValue::Type { meta, .. } => to_vec_sr(&meta),
            KclValue::KclNone { meta, .. } => to_vec_sr(&meta),
            KclValue::BoundedEdge { meta, .. } => to_vec_sr(&meta),
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
            KclValue::CameraView { value } => to_vec_sr(value.meta()),
            KclValue::NamedView { value } => to_vec_sr(value.meta()),
            KclValue::ImportedGeometry(i) => to_vec_sr(&i.meta),
            KclValue::Function { meta, .. } => to_vec_sr(meta),
            KclValue::Plane { value } => to_vec_sr(&value.meta),
            KclValue::Face { value } => to_vec_sr(&value.meta),
            KclValue::Segment { value } => to_vec_sr(&value.meta),
            KclValue::Bool { meta, .. } => to_vec_sr(meta),
            KclValue::Number { meta, .. } => to_vec_sr(meta),
            KclValue::String { meta, .. } => to_vec_sr(meta),
            KclValue::Enum { value } => to_vec_sr(value.meta()),
            KclValue::SketchVar { value, .. } => to_vec_sr(&value.meta),
            KclValue::SketchConstraint { value, .. } => to_vec_sr(&value.meta),
            KclValue::Uuid { meta, .. } => to_vec_sr(meta),
            KclValue::Tuple { meta, .. } => to_vec_sr(meta),
            KclValue::HomArray { value, .. } => value.iter().flat_map(Into::<Vec<SourceRange>>::into).collect(),
            KclValue::Object { meta, .. } => to_vec_sr(meta),
            KclValue::Module { meta, .. } => to_vec_sr(meta),
            KclValue::KclNone { meta, .. } => to_vec_sr(meta),
            KclValue::Type { meta, .. } => to_vec_sr(meta),
            KclValue::BoundedEdge { meta, .. } => to_vec_sr(meta),
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
            KclValue::Enum { value } => value.meta().to_vec(),
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
            KclValue::CameraView { value } => value.meta().to_vec(),
            KclValue::NamedView { value } => value.meta().to_vec(),
            KclValue::ImportedGeometry(x) => x.meta.clone(),
            KclValue::Function { meta, .. } => meta.clone(),
            KclValue::Module { meta, .. } => meta.clone(),
            KclValue::KclNone { meta, .. } => meta.clone(),
            KclValue::Type { meta, .. } => meta.clone(),
            KclValue::BoundedEdge { meta, .. } => meta.clone(),
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
            KclValue::Bool { .. } | KclValue::Number { .. } | KclValue::String { .. } | KclValue::Enum { .. } => true,
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
            | KclValue::CameraView { .. }
            | KclValue::NamedView { .. }
            | KclValue::ImportedGeometry(_)
            | KclValue::Function { .. }
            | KclValue::Module { .. }
            | KclValue::Type { .. }
            | KclValue::BoundedEdge { .. }
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
            KclValue::CameraView { .. } => "a camera view".to_owned(),
            KclValue::NamedView { .. } => "a named view".to_owned(),
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
            KclValue::Enum { value } => format!("a value of enum `{}`", value.enum_id().declared_name()),
            KclValue::SketchVar { .. } => "a sketch variable".to_owned(),
            KclValue::SketchConstraint { .. } => "a sketch constraint".to_owned(),
            KclValue::Object { .. } => "an object".to_owned(),
            KclValue::Module { .. } => "a module".to_owned(),
            KclValue::Type { .. } => "a type".to_owned(),
            KclValue::KclNone { .. } => "none".to_owned(),
            KclValue::BoundedEdge { .. } => "a bounded edge".to_owned(),
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
        node_path: Option<crate::NodePath>,
        exec_state: &ExecState,
    ) -> Self {
        let meta = vec![literal.metadata()];
        let ty = NumericType::from_parsed(literal.suffix, &exec_state.mod_local.settings);
        KclValue::SketchVar {
            value: Box::new(SketchVar {
                id,
                initial_value: literal.value,
                node_path,
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
                        CompilationIssue::err(
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

    pub fn from_imported_geometries(geometries: Vec<ImportedGeometry>) -> Self {
        geometries
            .into_iter()
            .map(|geometry| GeometryWithImportedGeometry::ImportedGeometry(Box::new(geometry)))
            .collect::<Vec<_>>()
            .into()
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
            // The original sketch var (if any) lives in `sketch_vars` and carries
            // its own node_path; this synthesized wrapper isn't pushed there, so
            // its node_path doesn't drive var-solution writeback.
            UnsolvedExpr::Unknown(var_id) => crate::execution::KclValue::SketchVar {
                value: Box::new(SketchVar {
                    id: var_id,
                    initial_value: Default::default(),
                    // TODO: Should this be the solver units?
                    ty: Default::default(),
                    node_path: None,
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

    pub fn as_slice(&self) -> Option<&[KclValue]> {
        match self {
            KclValue::Tuple { value, .. } | KclValue::HomArray { value, .. } => Some(value),
            _ => None,
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

    /// A solved segment.
    pub fn as_segment(&self) -> Option<&Segment> {
        match self {
            KclValue::Segment { value, .. } => match &value.repr {
                SegmentRepr::Solved { segment } => Some(segment),
                _ => None,
            },
            _ => None,
        }
    }

    /// A solved segment.
    pub fn into_segment(self) -> Option<Segment> {
        match self {
            KclValue::Segment { value, .. } => match value.repr {
                SegmentRepr::Solved { segment } => Some(*segment),
                _ => None,
            },
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
            KclValue::Enum { value } => Some(value.qualified_name()),
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
            | KclValue::CameraView { .. }
            | KclValue::NamedView { .. }
            | KclValue::ImportedGeometry(_)
            | KclValue::Function { .. }
            | KclValue::Plane { .. }
            | KclValue::Face { .. }
            | KclValue::Segment { .. }
            | KclValue::KclNone { .. }
            | KclValue::BoundedEdge { .. }
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

impl From<Vec<GeometryWithImportedGeometry>> for KclValue {
    fn from(mut values: Vec<GeometryWithImportedGeometry>) -> Self {
        if values.len() == 1
            && let Some(v) = values.pop()
        {
            KclValue::from(v)
        } else {
            KclValue::HomArray {
                value: values.into_iter().map(KclValue::from).collect(),
                ty: RuntimeType::Union(vec![
                    RuntimeType::Primitive(PrimitiveType::Sketch),
                    RuntimeType::Primitive(PrimitiveType::Solid),
                    RuntimeType::Primitive(PrimitiveType::ImportedGeometry),
                ]),
            }
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

    fn color_def() -> Arc<EnumTypeDef> {
        Arc::new(
            EnumTypeDef::new(
                EnumTypeId::new(ModuleId::default(), "Color"),
                vec!["Red".to_owned(), "Green".to_owned()],
            )
            .unwrap(),
        )
    }

    fn color_red() -> KclValue {
        KclValue::Enum {
            value: Box::new(EnumValue::new(color_def(), "Red", vec![])),
        }
    }

    #[test]
    fn enum_values_describe_themselves_by_name_and_variant() {
        let red = color_red();

        assert_eq!(red.human_friendly_type(), "a value of enum `Color`");
        // Feature-tree and variable display use the qualified form.
        assert_eq!(red.value_str(), Some("Color::Red".to_owned()));
        assert!(red.show_variable_in_feature_tree());
    }

    /// The externally visible form of an enum value is its nominal identity,
    /// never a representation of the variant. Pinning both view types keeps a
    /// future `@repr` from leaking out of these surfaces by accident.
    #[test]
    fn enum_values_are_exposed_by_nominal_identity() {
        let view = crate::execution::KclValueView::from(color_red());
        assert_eq!(
            view,
            crate::execution::KclValueView::Enum {
                enum_name: "Color".to_owned(),
                variant: "Red".to_owned(),
            }
        );

        let op = crate::execution::cad_op::op_from_kcl_value(&color_red());
        assert_eq!(
            op,
            kcl_api::OpKclValue::Enum {
                enum_name: "Color".to_owned(),
                variant: "Red".to_owned(),
            }
        );
    }

    /// Serialization is the third such surface, and the one that reaches
    /// `program_memory.snap`. A value holds its whole declaration, so this pins
    /// that only the identity and the variant are written out: the declaration
    /// will carry `@repr` values, and those must not appear here.
    #[test]
    fn enum_values_serialize_as_identity_and_variant() {
        assert_eq!(
            serde_json::to_value(color_red()).unwrap(),
            serde_json::json!({
                "type": "Enum",
                "value": {
                    "enum_id": { "module_id": 0, "declared_name": "Color" },
                    "variant": "Red",
                },
            })
        );
    }

    #[test]
    fn enum_declarations_carry_their_variants() {
        let def = EnumTypeDef::new(
            EnumTypeId::new(ModuleId::default(), "Color"),
            vec!["Red".to_owned(), "Green".to_owned()],
        )
        .unwrap();

        assert_eq!(def.variants(), ["Red", "Green"]);
        assert!(def.has_variant("Red"));
        assert!(!def.has_variant("Blue"));
        // Identity is the declaration, not the variant set: an enum declaring
        // the same variants elsewhere is a different type.
        assert_ne!(
            def.id(),
            EnumTypeDef::new(
                EnumTypeId::new(ModuleId::from_usize(1), "Color"),
                vec!["Red".to_owned(), "Green".to_owned()],
            )
            .unwrap()
            .id()
        );
    }

    #[test]
    fn enum_rejects_duplicate_variant() {
        let err = EnumTypeDef::new(
            EnumTypeId::new(ModuleId::default(), "Color"),
            vec!["Red".to_owned(), "Green".to_owned(), "Red".to_owned()],
        )
        .unwrap_err();

        assert_eq!(
            err,
            DuplicateVariant {
                name: "Red".to_owned(),
                first_index: 0,
                duplicate_index: 2,
            }
        );
    }

    #[test]
    fn enum_reports_earliest_duplicate() {
        // `Green` repeats at index 3 and `Red` at index 4. The caller reports one
        // duplicate, so it must be the one the user reads first.
        let err = EnumTypeDef::new(
            EnumTypeId::new(ModuleId::default(), "Color"),
            vec![
                "Red".to_owned(),
                "Green".to_owned(),
                "Blue".to_owned(),
                "Green".to_owned(),
                "Red".to_owned(),
            ],
        )
        .unwrap_err();

        assert_eq!(err.name, "Green");
        assert_eq!(err.first_index, 1);
        assert_eq!(err.duplicate_index, 3);
    }
}
