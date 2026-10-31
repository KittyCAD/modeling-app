//! Custom serde for executable functions and AST metadata.

use ::serde::Deserialize;
use ::serde::Deserializer;
use ::serde::Serialize;
use ::serde::Serializer;

use super::*;

/// A native address is meaningful only in its original process. Rebind it by
/// the stdlib declaration name in the receiving executor instead.
#[derive(Serialize, Deserialize)]
enum FunctionBodyData {
    Rust(String),
    Kcl(EnvironmentRef),
}

#[derive(Serialize, Deserialize)]
struct FunctionData {
    input_arg: Option<(String, Option<Type>)>,
    resolved_input_ty: Option<RuntimeType>,
    named_args: IndexMap<String, NamedParam>,
    return_type: Option<Node<Type>>,
    resolved_return_ty: Option<RuntimeType>,
    deprecated: bool,
    deprecated_since: Option<VersionConstraint>,
    experimental: bool,
    include_in_feature_tree: bool,
    #[serde(with = "std_fn_props::optional")]
    std_props: Option<StdFnProps>,
    body: FunctionBodyData,
    ast: BoxNode<FunctionExpression>,
    ast_node_path: Option<crate::NodePath>,
    // FunctionExpression's ordinary serde skips return annotations, including
    // annotations on nested functions that have not been evaluated yet.
    ast_return_types: Vec<(SourceRange, Node<Type>)>,
}

impl Serialize for FunctionSource {
    fn serialize<S: ::serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        use ::serde::ser::Error;
        let body = match &self.body {
            FunctionBody::Kcl(env) => FunctionBodyData::Kcl(*env),
            FunctionBody::Rust(_) => FunctionBodyData::Rust(
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
        let value = FunctionData {
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
}

impl<'de> Deserialize<'de> for FunctionSource {
    fn deserialize<D: ::serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        use ::serde::de::Error;
        let mut value = FunctionData::deserialize(deserializer)?;
        let (body, std_props) = match value.body {
            FunctionBodyData::Kcl(env) => (FunctionBody::Kcl(env), value.std_props),
            FunctionBodyData::Rust(name) => {
                let (module, function) =
                    native_name(&name).ok_or_else(|| D::Error::custom("invalid native function name"))?;
                let (function, props) = crate::std::std_fn(module, function)
                    .map_err(|error| D::Error::custom(format!("unknown native function `{name}`: {error}")))?;
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

pub(crate) mod std_fn_props {
    use super::*;

    fn resolve(name: String) -> StdFnProps {
        native_name(&name)
            .and_then(|(module, function)| crate::std::std_fn(module, function).ok())
            .map(|(_, props)| props)
            .unwrap_or_else(|| StdFnProps::default(&name))
    }

    pub(crate) fn serialize<S: Serializer>(value: &StdFnProps, serializer: S) -> Result<S::Ok, S::Error> {
        value.name.serialize(serializer)
    }
    pub(crate) fn deserialize<'de, D: Deserializer<'de>>(deserializer: D) -> Result<StdFnProps, D::Error> {
        String::deserialize(deserializer).map(resolve)
    }

    pub(super) mod optional {
        use super::*;
        pub(crate) fn serialize<S: Serializer>(value: &Option<StdFnProps>, serializer: S) -> Result<S::Ok, S::Error> {
            value.as_ref().map(|props| &props.name).serialize(serializer)
        }
        pub(crate) fn deserialize<'de, D: Deserializer<'de>>(deserializer: D) -> Result<Option<StdFnProps>, D::Error> {
            Ok(Option::<String>::deserialize(deserializer)?.map(resolve))
        }
    }
}

/// Preserve the root node path that the AST's general-purpose serde omits.
/// The wrappers also keep the tag's AST `type` separate from KclValue's tag.
pub(crate) mod tag_node {
    use super::*;

    #[derive(Serialize, Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct TagNodeData {
        #[serde(flatten)]
        node: TagNode,
        node_path: Option<crate::NodePath>,
    }

    pub(crate) trait Nodes: Sized {
        fn write<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error>;
        fn read<'de, D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error>;
    }
    pub(crate) fn serialize<T: Nodes, S: Serializer>(value: &T, serializer: S) -> Result<S::Ok, S::Error> {
        value.write(serializer)
    }
    pub(crate) fn deserialize<'de, T: Nodes, D: Deserializer<'de>>(deserializer: D) -> Result<T, D::Error> {
        T::read(deserializer)
    }
    impl Nodes for TagNode {
        fn write<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
            TagNodeData {
                node: self.clone(),
                node_path: self.node_path.clone(),
            }
            .serialize(serializer)
        }
        fn read<'de, D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
            let mut data = TagNodeData::deserialize(deserializer)?;
            data.node.node_path = data.node_path;
            Ok(data.node)
        }
    }
    impl Nodes for BoxNode<TagDeclarator> {
        fn write<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
            use ::serde::ser::Error;
            let mut data = serde_json::to_value(TagNodeData {
                node: self.as_ref().clone(),
                node_path: self.node_path.clone(),
            })
            .map_err(S::Error::custom)?;
            // KclValue supplies this tag for the newtype variant itself.
            if let Some(fields) = data.as_object_mut() {
                fields.remove("type");
            }
            data.serialize(serializer)
        }
        fn read<'de, D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
            use ::serde::de::Error;
            let mut data = serde_json::Value::deserialize(deserializer)?;
            if let Some(fields) = data.as_object_mut() {
                fields.insert("type".into(), "TagDeclarator".into());
            }
            let mut data: TagNodeData = serde_json::from_value(data).map_err(D::Error::custom)?;
            data.node.node_path = data.node_path;
            Ok(Self::new(data.node))
        }
    }
    impl<T: Nodes> Nodes for Box<T> {
        fn write<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
            self.as_ref().write(serializer)
        }
        fn read<'de, D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
            T::read(deserializer).map(Box::new)
        }
    }
    struct Ref<'a, T>(&'a T);
    impl<T: Nodes> Serialize for Ref<'_, T> {
        fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
            self.0.write(serializer)
        }
    }
    struct Owned<T>(T);
    impl<'de, T: Nodes> Deserialize<'de> for Owned<T> {
        fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
            T::read(deserializer).map(Self)
        }
    }
    impl<T: Nodes> Nodes for Option<T> {
        fn write<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
            self.as_ref().map(Ref).serialize(serializer)
        }
        fn read<'de, D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
            Ok(Option::<Owned<T>>::deserialize(deserializer)?.map(|value| value.0))
        }
    }
}
