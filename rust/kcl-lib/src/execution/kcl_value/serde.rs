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

// The flattened source uses the field serde generated on FunctionSource itself.
// Only the body needs the containing source, to read its native identity.
impl Serialize for FunctionSource {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        use ::serde::ser::Error;

        #[derive(Serialize)]
        struct FunctionRef<'a> {
            #[serde(flatten, with = "FunctionSource")]
            source: &'a FunctionSource,
            body: FunctionBodyData,
        }

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
        // AST serialization can emit repeated `type` keys through flattening.
        // Canonicalize before writing so streaming readers also see unique keys.
        serde_json::to_value(FunctionRef { source: self, body })
            .map_err(S::Error::custom)?
            .serialize(serializer)
    }
}

impl<'de> Deserialize<'de> for FunctionSource {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        use ::serde::de::Error;

        #[derive(Deserialize)]
        struct FunctionOwned {
            #[serde(flatten, with = "FunctionSource")]
            source: FunctionSource,
            body: FunctionBodyData,
        }

        let FunctionOwned { mut source, body } = FunctionOwned::deserialize(deserializer)?;
        source.body = match body {
            FunctionBodyData::Kcl(env) => FunctionBody::Kcl(env),
            FunctionBodyData::Rust(name) => {
                let (module, function) =
                    native_name(&name).ok_or_else(|| D::Error::custom("invalid native function name"))?;
                let (function, props) = crate::std::std_fn(module, function)
                    .map_err(|error| D::Error::custom(format!("unknown native function `{name}`: {error}")))?;
                source.std_props = Some(props);
                FunctionBody::Rust(function)
            }
        };
        Ok(source)
    }
}

// The derived field decoder does not read the body. The outer decoder replaces
// this placeholder before returning a FunctionSource, or fails with an error.
pub(super) fn pending_function_body() -> FunctionBody {
    FunctionBody::Kcl(EnvironmentRef::dummy())
}

pub(super) mod function_ast {
    use super::*;

    #[derive(Serialize, Deserialize)]
    struct FunctionAstData<T> {
        ast: T,
        ast_node_path: Option<crate::NodePath>,
        // Ordinary AST serde omits return annotations on nested functions too.
        ast_return_types: Vec<(SourceRange, Node<Type>)>,
    }

    pub(crate) fn serialize<S: Serializer>(
        ast: &BoxNode<FunctionExpression>,
        serializer: S,
    ) -> Result<S::Ok, S::Error> {
        use ::serde::ser::Error;
        let return_types = std::cell::RefCell::new(Vec::new());
        if let Some(ty) = &ast.return_type {
            return_types
                .borrow_mut()
                .push((SourceRange::from(ast.as_ref()), ty.clone()));
        }
        crate::walk::walk(&ast.body, |node| {
            if let crate::walk::Node::FunctionExpression(function) = node
                && let Some(ty) = &function.return_type
            {
                return_types
                    .borrow_mut()
                    .push((SourceRange::from(function), ty.clone()));
            }
            Ok::<_, anyhow::Error>(true)
        })
        .map_err(S::Error::custom)?;
        FunctionAstData {
            ast,
            ast_node_path: ast.node_path.clone(),
            ast_return_types: return_types.into_inner(),
        }
        .serialize(serializer)
    }

    pub(crate) fn deserialize<'de, D: Deserializer<'de>>(
        deserializer: D,
    ) -> Result<BoxNode<FunctionExpression>, D::Error> {
        let FunctionAstData {
            mut ast,
            ast_node_path,
            ast_return_types,
        } = FunctionAstData::<BoxNode<FunctionExpression>>::deserialize(deserializer)?;
        if let Some((_, ty)) = ast_return_types
            .iter()
            .find(|(range, _)| *range == SourceRange::from(ast.as_ref()))
        {
            ast.return_type = Some(ty.clone());
        }
        let _ = crate::walk::traverse::dfs_mut(&mut ast.body, &mut ReturnTypes(&ast_return_types));
        // Restore absolute paths so solver source references survive.
        if let Some(path) = ast_node_path {
            crate::parsing::ast::types::fill_function_node_paths(&mut ast, path);
        }
        Ok(ast)
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

    pub(crate) mod optional {
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
