//! Custom serde for executable functions and AST metadata.

use ::serde::Deserialize;
use ::serde::Deserializer;
use ::serde::Serialize;
use ::serde::Serializer;

use super::FunctionSource;

impl Serialize for FunctionSource {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        todo!()
    }
}

impl<'de> Deserialize<'de> for FunctionSource {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        todo!()
    }
}

// #[derive(Serialize, Deserialize)]
// enum FunctionBodyData {
//     /// The fully-qualified path in the KCL stdlib.
//     Rust(String),
//     Kcl(EnvironmentRef),
// }

pub(crate) mod std_fn_props {
    use crate::std::StdFnProps;

    use super::*;

    pub(crate) fn serialize<S: Serializer>(value: &StdFnProps, serializer: S) -> Result<S::Ok, S::Error> {
        todo!()
    }

    pub(crate) fn deserialize<'de, D: Deserializer<'de>>(deserializer: D) -> Result<StdFnProps, D::Error> {
        todo!()
    }
}

/// Preserve the root node path that the AST's general-purpose serde omits.
/// The wrappers also keep the tag's AST `type` separate from KclValue's tag.
pub(crate) mod tag_node {

    use crate::parsing::ast::types::TagNode;

    use super::*;

    pub(crate) trait Nodes: Sized {
        fn write<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error>;
        fn read<'de, D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error>;
    }

    impl Nodes for TagNode {
        fn write<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
            todo!()
        }
        fn read<'de, D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
            todo!()
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

    impl<T: Nodes> Nodes for Option<T> {
        fn write<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
            self.as_ref().map(Ref).serialize(serializer)
        }
        fn read<'de, D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
            Option::<Owned<T>>::deserialize(deserializer)
                // If there's a T, get it.
                .map(|option_owned| option_owned.map(|owned| owned.0))
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

    pub(crate) fn serialize<T: Nodes, S: Serializer>(value: &T, serializer: S) -> Result<S::Ok, S::Error> {
        todo!()
    }

    pub(crate) fn deserialize<'de, T: Nodes, D: Deserializer<'de>>(deserializer: D) -> Result<T, D::Error> {
        todo!()
    }
}
