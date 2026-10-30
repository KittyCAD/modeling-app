//! Lossless interpreter values, separate from the existing display serialization.

use serde::Deserialize;

use super::*;
use crate::execution::memory::snapshot;

#[derive(Serialize, Deserialize)]
#[serde(remote = "KclValue")]
enum KclValueSnapshot {
    Uuid {
        value: ::uuid::Uuid,
        meta: Vec<Metadata>,
    },
    Bool {
        value: bool,
        meta: Vec<Metadata>,
    },
    Number {
        value: f64,
        ty: NumericType,
        meta: Vec<Metadata>,
    },
    String {
        value: String,
        meta: Vec<Metadata>,
    },
    Enum {
        #[serde(with = "snapshot")]
        value: Box<EnumValue>,
    },
    SketchVar {
        #[serde(with = "snapshot")]
        value: Box<SketchVar>,
    },
    SketchConstraint {
        #[serde(with = "snapshot")]
        value: Box<SketchConstraint>,
    },
    Tuple {
        #[serde(with = "snapshot")]
        value: Vec<KclValue>,
        meta: Vec<Metadata>,
    },
    HomArray {
        #[serde(with = "snapshot")]
        value: Vec<KclValue>,
        ty: RuntimeType,
    },
    Object {
        #[serde(with = "snapshot")]
        value: KclObjectFields,
        constrainable: bool,
        object_kind: KclObjectKind,
        meta: Vec<Metadata>,
    },
    TagIdentifier(#[serde(with = "snapshot")] Box<TagIdentifier>),
    TagDeclarator(#[serde(with = "snapshot")] BoxNode<TagDeclarator>),
    GdtAnnotation {
        #[serde(with = "snapshot")]
        value: Box<GdtAnnotation>,
    },
    Plane {
        #[serde(with = "snapshot")]
        value: Box<Plane>,
    },
    Face {
        #[serde(with = "snapshot")]
        value: Box<Face>,
    },
    BoundedEdge {
        #[serde(with = "snapshot")]
        value: BoundedEdge,
        meta: Vec<Metadata>,
    },
    Segment {
        #[serde(with = "snapshot")]
        value: Box<AbstractSegment>,
    },
    Sketch {
        #[serde(with = "snapshot")]
        value: Box<Sketch>,
    },
    Solid {
        #[serde(with = "snapshot")]
        value: Box<Solid>,
    },
    Helix {
        #[serde(with = "snapshot")]
        value: Box<Helix>,
    },
    CameraView {
        #[serde(with = "snapshot")]
        value: Box<CameraView>,
    },
    NamedView {
        #[serde(with = "snapshot")]
        value: Box<NamedViewValue>,
    },
    ImportedGeometry(#[serde(with = "snapshot")] ImportedGeometry),
    Function {
        #[serde(with = "snapshot")]
        value: Box<FunctionSource>,
        meta: Vec<Metadata>,
    },
    Module {
        value: ModuleId,
        meta: Vec<Metadata>,
    },
    Type {
        #[serde(with = "snapshot")]
        value: TypeDef,
        experimental: bool,
        meta: Vec<Metadata>,
    },
    KclNone {
        value: KclNone,
        meta: Vec<Metadata>,
    },
}
snapshot::snapshot_type!(KclValue, KclValueSnapshot);

#[derive(Serialize, Deserialize)]
#[serde(remote = "TypeDef")]
enum TypeDefSnapshot {
    RustRepr(PrimitiveType, #[serde(with = "snapshot")] StdFnProps),
    Alias(RuntimeType),
    Enum(#[serde(with = "snapshot")] Arc<EnumTypeDef>),
}
snapshot::snapshot_type!(TypeDef, TypeDefSnapshot);

#[derive(Serialize, Deserialize)]
#[serde(remote = "EnumTypeDef")]
struct EnumTypeDefSnapshot {
    id: EnumTypeId,
    variants: Vec<String>,
    experimental: bool,
}
snapshot::snapshot_type!(EnumTypeDef, EnumTypeDefSnapshot);

#[derive(Serialize, Deserialize)]
#[serde(remote = "EnumValue")]
struct EnumValueSnapshot {
    #[serde(with = "snapshot")]
    def: Arc<EnumTypeDef>,
    variant: String,
    meta: Vec<Metadata>,
}
snapshot::snapshot_type!(EnumValue, EnumValueSnapshot);

/// A native address is meaningful only in its original process. Rebind it by
/// the stdlib declaration name in the receiving executor instead.
#[derive(Serialize, Deserialize)]
enum BodySnapshot {
    Rust(String),
    Kcl(#[serde(with = "snapshot")] EnvironmentRef),
}

#[derive(Serialize, Deserialize)]
struct FunctionSnapshot {
    input_arg: Option<(String, Option<Type>)>,
    resolved_input_ty: Option<RuntimeType>,
    named_args: IndexMap<String, NamedParam>,
    return_type: Option<Node<Type>>,
    resolved_return_ty: Option<RuntimeType>,
    deprecated: bool,
    deprecated_since: Option<VersionConstraint>,
    experimental: bool,
    include_in_feature_tree: bool,
    #[serde(with = "snapshot")]
    std_props: Option<StdFnProps>,
    body: BodySnapshot,
    ast: BoxNode<FunctionExpression>,
    ast_node_path: Option<crate::NodePath>,
    // FunctionExpression's ordinary serde skips return annotations, including
    // annotations on nested functions that have not been evaluated yet.
    ast_return_types: Vec<(SourceRange, Node<Type>)>,
}

impl snapshot::Snapshot for FunctionSource {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        use serde::ser::Error;
        let body = match &self.body {
            FunctionBody::Kcl(env) => BodySnapshot::Kcl(*env),
            FunctionBody::Rust(_) => BodySnapshot::Rust(
                self.std_props
                    .as_ref()
                    .ok_or_else(|| S::Error::custom("native function has no stdlib identity"))?
                    .name
                    .clone(),
            ),
        };
        let ast_return_types = std::cell::RefCell::new(Vec::new());
        if let Some(ty) = &self.ast.return_type {
            ast_return_types
                .borrow_mut()
                .push((SourceRange::from(self.ast.as_ref()), ty.clone()));
        }
        crate::walk::walk(&self.ast.body, |node| {
            if let crate::walk::Node::FunctionExpression(function) = node
                && let Some(ty) = &function.return_type
            {
                ast_return_types
                    .borrow_mut()
                    .push((SourceRange::from(function), ty.clone()));
            }
            Ok::<_, anyhow::Error>(true)
        })
        .map_err(S::Error::custom)?;
        let value = FunctionSnapshot {
            input_arg: self.input_arg.clone(),
            resolved_input_ty: self.resolved_input_ty.clone(),
            named_args: self.named_args.clone(),
            return_type: self.return_type.clone(),
            resolved_return_ty: self.resolved_return_ty.clone(),
            deprecated: self.deprecated,
            deprecated_since: self.deprecated_since.clone(),
            experimental: self.experimental,
            include_in_feature_tree: self.include_in_feature_tree,
            std_props: self.std_props.clone(),
            body,
            ast: self.ast.clone(),
            ast_node_path: self.ast.node_path.clone(),
            ast_return_types: ast_return_types.into_inner(),
        };
        // AST display serialization can emit repeated `type` keys through
        // flattening. Canonicalize the data model before writing the snapshot,
        // so streaming deserializers see the same map as from_value does.
        serde_json::to_value(value)
            .map_err(S::Error::custom)?
            .serialize(serializer)
    }

    fn deserialize<'de, D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        use serde::de::Error;
        let mut value = FunctionSnapshot::deserialize(deserializer)?;
        let (body, std_props) = match value.body {
            BodySnapshot::Kcl(env) => (FunctionBody::Kcl(env), value.std_props),
            BodySnapshot::Rust(name) => {
                let (module, function) =
                    native_name(&name).ok_or_else(|| D::Error::custom("invalid native function name"))?;
                let (function, props) = crate::std::try_std_fn(module, function)
                    .ok_or_else(|| D::Error::custom(format!("unknown native function `{name}`")))?;
                (FunctionBody::Rust(function), Some(props))
            }
        };
        if let Some((_, ty)) = value
            .ast_return_types
            .iter()
            .find(|(range, _)| *range == SourceRange::from(value.ast.as_ref()))
        {
            value.ast.return_type = Some(ty.clone());
        }
        let _ = crate::walk::traverse::dfs_mut(&mut value.ast.body, &mut ReturnTypes(&value.ast_return_types));
        // Ordinary AST serde omits node paths. Rebuild the function subtree
        // using the original absolute path so solver source references survive.
        if let Some(path) = value.ast_node_path {
            crate::parsing::ast::types::fill_function_node_paths(&mut value.ast, path);
        }
        Ok(Self {
            input_arg: value.input_arg,
            resolved_input_ty: value.resolved_input_ty,
            named_args: value.named_args,
            return_type: value.return_type,
            resolved_return_ty: value.resolved_return_ty,
            deprecated: value.deprecated,
            deprecated_since: value.deprecated_since,
            experimental: value.experimental,
            include_in_feature_tree: value.include_in_feature_tree,
            std_props,
            body,
            ast: value.ast,
        })
    }
}

impl snapshot::Snapshot for StdFnProps {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        self.name.serialize(serializer)
    }
    fn deserialize<'de, D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let name = String::deserialize(deserializer)?;
        // KCL-backed std functions and primitive type declarations have default
        // properties. Native implementations get their policies from the registry.
        Ok(native_name(&name)
            .and_then(|(module, function)| crate::std::try_std_fn(module, function))
            .map(|(_, props)| props)
            .unwrap_or_else(|| Self::default(&name)))
    }
}

fn native_name(name: &str) -> Option<(&str, &str)> {
    let name = name.strip_prefix("std::")?;
    Some(name.rsplit_once("::").unwrap_or(("prelude", name)))
}

struct ReturnTypes<'a>(&'a [(SourceRange, Node<Type>)]);
impl crate::walk::traverse::Visitor for ReturnTypes<'_> {
    type Break = ();
    type Continue = ();
    fn visit(&mut self, node: crate::walk::NodeMut) -> crate::walk::traverse::TraversalReturn<(), ()> {
        if let crate::walk::NodeMut::FunctionExpression(node) = node
            && let Some((_, ty)) = self.0.iter().find(|(range, _)| *range == SourceRange::from(&*node))
        {
            node.return_type = Some(ty.clone());
        }
        crate::walk::traverse::TraversalReturn::new_continue(())
    }
    fn finish(&mut self, _node: crate::walk::NodeMut) {}
}
