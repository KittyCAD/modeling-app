//! Lossless, versioned interpreter memory snapshots.
//!
//! Display serialization deliberately omits executable state. These adapters
//! preserve it without changing the public value shapes or snapshot fixtures.
//! Snapshot versions describe the wire format, not the program's KCL version.

#[cfg(test)]
mod proptests;

use std::collections::HashMap;
use std::sync::Arc;

use indexmap::IndexMap;
use serde::Deserialize;
use serde::Deserializer;
use serde::Serialize;
use serde::Serializer;
use uuid::Uuid;

use super::EnvironmentRef;
use super::Stack;
use super::StackBackend;
use crate::execution::Metadata;
use crate::execution::TagEngineInfo;
use crate::execution::TagIdentifier;
use crate::execution::geometry::*;
use crate::execution::memory::snapshot;
use crate::std::edge::TagOrUuid;
use crate::std::edge::UnresolvedEdgeSpecifier;

pub(crate) trait Snapshot: Sized {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error>;
    fn deserialize<'de, D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error>;
}

pub(crate) fn serialize<T: Snapshot, S: Serializer>(value: &T, serializer: S) -> Result<S::Ok, S::Error> {
    Snapshot::serialize(value, serializer)
}

pub(crate) fn deserialize<'de, T: Snapshot, D: Deserializer<'de>>(deserializer: D) -> Result<T, D::Error> {
    Snapshot::deserialize(deserializer)
}

macro_rules! snapshot_type {
    ($ty:ty, $remote:ident) => {
        impl $crate::execution::memory_snapshot::Snapshot for $ty {
            fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
                $remote::serialize(self, serializer)
            }
            fn deserialize<'de, D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
                $remote::deserialize(deserializer)
            }
        }
    };
}
pub(crate) use snapshot_type;

struct Ref<'a, T>(&'a T);
impl<T: Snapshot> Serialize for Ref<'_, T> {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        Snapshot::serialize(self.0, serializer)
    }
}

struct Owned<T>(T);
impl<'de, T: Snapshot> Deserialize<'de> for Owned<T> {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        Snapshot::deserialize(deserializer).map(Self)
    }
}

impl<T: Snapshot> Snapshot for Box<T> {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        Snapshot::serialize(self.as_ref(), serializer)
    }
    fn deserialize<'de, D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        Snapshot::deserialize(deserializer).map(Box::new)
    }
}

impl<T: Snapshot> Snapshot for Arc<T> {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        Snapshot::serialize(self.as_ref(), serializer)
    }
    fn deserialize<'de, D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        Snapshot::deserialize(deserializer).map(Arc::new)
    }
}

impl<T: Snapshot> Snapshot for Option<T> {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        Serialize::serialize(&self.as_ref().map(Ref), serializer)
    }
    fn deserialize<'de, D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        Ok(Option::<Owned<T>>::deserialize(deserializer)?.map(|value| value.0))
    }
}

impl<T: Snapshot> Snapshot for Vec<T> {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.collect_seq(self.iter().map(Ref))
    }
    fn deserialize<'de, D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        Ok(Vec::<Owned<T>>::deserialize(deserializer)?
            .into_iter()
            .map(|value| value.0)
            .collect())
    }
}

impl<T: Snapshot, const N: usize> Snapshot for [T; N] {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.collect_seq(self.iter().map(Ref))
    }
    fn deserialize<'de, D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        use serde::de::Error;
        let values = Vec::<Owned<T>>::deserialize(deserializer)?
            .into_iter()
            .map(|value| value.0)
            .collect::<Vec<_>>();
        values
            .try_into()
            .map_err(|_| D::Error::custom("invalid snapshot array length"))
    }
}

impl<T: Snapshot + std::fmt::Debug + Clone + ts_rs::TS> Snapshot for kcl_api::Point2d<T> {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        Serialize::serialize(&(Ref(&self.x), Ref(&self.y)), serializer)
    }
    fn deserialize<'de, D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let (x, y) = <(Owned<T>, Owned<T>)>::deserialize(deserializer)?;
        Ok(Self { x: x.0, y: y.0 })
    }
}

impl<T: Snapshot> Snapshot for (usize, T) {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        use serde::ser::Error;
        let epoch = u32::try_from(self.0).map_err(S::Error::custom)?;
        if epoch == 0 || epoch == u32::MAX {
            return Err(S::Error::custom("invalid snapshot history epoch"));
        }
        Serialize::serialize(&(epoch, Ref(&self.1)), serializer)
    }
    fn deserialize<'de, D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        use serde::de::Error;
        let (epoch, value) = <(u32, Owned<T>)>::deserialize(deserializer)?;
        if epoch == 0 || epoch == u32::MAX {
            return Err(D::Error::custom("invalid snapshot history epoch"));
        }
        Ok((epoch as usize, value.0))
    }
}

impl<T: Snapshot + Clone> Snapshot for imbl::Vector<T> {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.collect_seq(self.iter().map(Ref))
    }
    fn deserialize<'de, D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        Ok(Vec::<Owned<T>>::deserialize(deserializer)?
            .into_iter()
            .map(|value| value.0)
            .collect())
    }
}

impl<T: Snapshot> Snapshot for IndexMap<String, T> {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.collect_map(self.iter().map(|(key, value)| (key, Ref(value))))
    }
    fn deserialize<'de, D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        Ok(IndexMap::<String, Owned<T>>::deserialize(deserializer)?
            .into_iter()
            .map(|(key, value)| (key, value.0))
            .collect())
    }
}

impl<T: Snapshot> Snapshot for HashMap<String, T> {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.collect_map(self.iter().map(|(key, value)| (key, Ref(value))))
    }
    fn deserialize<'de, D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        Ok(HashMap::<String, Owned<T>>::deserialize(deserializer)?
            .into_iter()
            .map(|(key, value)| (key, value.0))
            .collect())
    }
}

/// Avoid encoding pointer-width-dependent sentinel integers on the wire.
#[derive(Serialize, Deserialize)]
enum EnvRef {
    Dummy,
    Current(u32),
    AtEpoch { index: u32, epoch: u32 },
}

impl Snapshot for EnvironmentRef {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        use serde::ser::Error;
        let value = if *self == Self::dummy() {
            EnvRef::Dummy
        } else {
            let index = u32::try_from(self.index()).map_err(S::Error::custom)?;
            if self.epoch() == usize::MAX {
                EnvRef::Current(index)
            } else {
                let epoch = u32::try_from(self.epoch()).map_err(S::Error::custom)?;
                if epoch == 0 || epoch == u32::MAX {
                    return Err(S::Error::custom("invalid snapshot environment epoch"));
                }
                EnvRef::AtEpoch { index, epoch }
            }
        };
        Serialize::serialize(&value, serializer)
    }
    fn deserialize<'de, D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        use serde::de::Error;
        match EnvRef::deserialize(deserializer)? {
            EnvRef::Dummy => Ok(Self::dummy()),
            EnvRef::Current(index) if index < u32::MAX => Ok(Self::current(index as usize)),
            EnvRef::AtEpoch { index, epoch } if index < u32::MAX && epoch > 0 && epoch < u32::MAX => {
                Ok(Self::at_epoch(index as usize, epoch as usize))
            }
            _ => Err(D::Error::custom("invalid snapshot environment reference")),
        }
    }
}

impl Snapshot for SketchVarId {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        use serde::ser::Error;
        let value = if *self == Self::INVALID {
            None
        } else {
            Some(u32::try_from(self.0).map_err(S::Error::custom)?)
        };
        Serialize::serialize(&value, serializer)
    }
    fn deserialize<'de, D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        use serde::de::Error;
        match Option::<u32>::deserialize(deserializer)? {
            None => Ok(Self::INVALID),
            Some(value) if value < u32::MAX => Ok(Self(value as usize)),
            _ => Err(D::Error::custom("invalid snapshot sketch variable ID")),
        }
    }
}

impl Serialize for Stack {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        match &self.backend {
            StackBackend::Arena(stack) => Serialize::serialize(stack, serializer),
        }
    }
}

impl<'de> Deserialize<'de> for Stack {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let stack = super::arena::Stack::deserialize(deserializer)?;
        Ok(Self {
            memory: Arc::new(super::ProgramMemory {
                backend: super::ProgramMemoryBackend::Arena(Arc::clone(&stack.memory)),
            }),
            backend: StackBackend::Arena(stack),
        })
    }
}
#[derive(Serialize, Deserialize)]
#[serde(remote = "TagIdentifier")]
struct TagIdentifierSnapshot {
    value: String,
    #[serde(with = "snapshot")]
    info: Vec<(usize, TagEngineInfo)>,
    meta: Vec<Metadata>,
}
snapshot::snapshot_type!(TagIdentifier, TagIdentifierSnapshot);

#[derive(Serialize, Deserialize)]
#[serde(remote = "TagEngineInfo")]
struct TagEngineInfoSnapshot {
    id: uuid::Uuid,
    #[serde(with = "snapshot")]
    geometry: Geometry,
    #[serde(with = "snapshot")]
    path: Option<Path>,
    #[serde(with = "snapshot")]
    surface: Option<ExtrudeSurface>,
}
snapshot::snapshot_type!(TagEngineInfo, TagEngineInfoSnapshot);

#[derive(Serialize, Deserialize)]
#[serde(remote = "TagOrUuid")]
enum TagOrUuidSnapshot {
    Uuid(Uuid),
    Tag(#[serde(with = "snapshot")] Box<TagIdentifier>),
}
snapshot::snapshot_type!(TagOrUuid, TagOrUuidSnapshot);

#[derive(Serialize, Deserialize)]
#[serde(remote = "UnresolvedEdgeSpecifier")]
struct UnresolvedEdgeSpecifierSnapshot {
    #[serde(with = "snapshot")]
    side_faces: Vec<TagOrUuid>,
    #[serde(with = "snapshot")]
    end_faces: Vec<TagOrUuid>,
    index: Option<u32>,
}
snapshot::snapshot_type!(UnresolvedEdgeSpecifier, UnresolvedEdgeSpecifierSnapshot);

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ExecutorContext;
    use crate::Program;
    use crate::SourceRange;
    use crate::execution::KclValue;
    use crate::execution::MockConfig;
    use crate::execution::types::NumericType;
    use crate::execution::types::NumericTypeExt;

    fn round_trip(stack: &Stack) -> Stack {
        let data = serde_json::to_value(stack).unwrap();
        let json = serde_json::to_string(stack).unwrap();
        let restored: Stack = serde_json::from_str(&json).unwrap();
        assert_eq!(serde_json::to_value(&restored).unwrap(), data);
        restored
    }

    #[test]
    fn memory_snapshot_restores_shared_arena_and_epoch_visibility() {
        let mut original = Stack::new_for_tests();
        let range = SourceRange::default();
        original
            .add(
                "early".into(),
                KclValue::from_number_with_type(1.0, NumericType::count(), vec![range.into()]),
                range,
            )
            .unwrap();
        let captured = original.snapshot().unwrap();
        original
            .add(
                "late".into(),
                KclValue::from_number_with_type(2.0, NumericType::count(), vec![]),
                range,
            )
            .unwrap();
        let mut restored = round_trip(&original);
        restored.push_new_env_for_call(captured).unwrap();
        assert_eq!(
            restored.get("early", range).unwrap(),
            original.get("early", range).unwrap()
        );
        assert!(matches!(
            restored.get("late", range).unwrap_err(),
            crate::KclError::UndefinedValue { .. }
        ));
        restored
            .add(
                "local".into(),
                KclValue::from_number_with_type(3.0, NumericType::count(), vec![]),
                range,
            )
            .unwrap();
        let StackBackend::Arena(stack) = &restored.backend;
        let super::super::ProgramMemoryBackend::Arena(memory) = &restored.memory.backend;
        assert!(Arc::ptr_eq(memory, &stack.memory));
        restored.pop_env().unwrap();
        assert_eq!(
            restored.get("late", range).unwrap(),
            original.get("late", range).unwrap()
        );
    }

    #[test]
    fn memory_snapshot_rejects_invalid_graphs_and_versions() {
        let stack = Stack::new_for_tests();
        let valid = serde_json::to_value(&stack).unwrap();
        let mut value = valid.clone();
        value["version"] = serde_json::json!(2);
        assert!(
            serde_json::from_value::<Stack>(value)
                .unwrap_err()
                .to_string()
                .contains("version")
        );
        let mut value = valid.clone();
        value["current_env"] = serde_json::json!({"Current": 999});
        assert!(
            serde_json::from_value::<Stack>(value)
                .unwrap_err()
                .to_string()
                .contains("reference")
        );
        let mut value = valid.clone();
        value["environments"][0]["parent"] = serde_json::json!({"Current": 0});
        assert!(
            serde_json::from_value::<Stack>(value)
                .unwrap_err()
                .to_string()
                .contains("cyclic")
        );
        let mut value = valid;
        value["environments"][0]["owner"] = serde_json::json!(999);
        assert!(
            serde_json::from_value::<Stack>(value)
                .unwrap_err()
                .to_string()
                .contains("owner")
        );
    }

    #[test]
    fn memory_snapshot_has_portable_sentinels() {
        let refs = vec![
            EnvironmentRef::dummy(),
            EnvironmentRef::current(2),
            EnvironmentRef::at_epoch(3, 4),
        ];
        let json = serde_json::to_value(refs.iter().map(Ref).collect::<Vec<_>>()).unwrap();
        assert_eq!(
            json,
            serde_json::json!(["Dummy", {"Current": 2}, {"AtEpoch": {"index": 3, "epoch": 4}}])
        );
        let restored = Vec::<Owned<EnvironmentRef>>::deserialize(json).unwrap();
        assert_eq!(restored.into_iter().map(|v| v.0).collect::<Vec<_>>(), refs);
        assert_eq!(
            serde_json::to_value(Ref(&SketchVarId::INVALID)).unwrap(),
            serde_json::Value::Null
        );
    }

    #[tokio::test]
    async fn memory_snapshot_executes_restored_closures_and_native_aliases() {
        let ctx = ExecutorContext::new_mock(None).await;
        let source = Program::parse_no_errs(
            r#"
@settings(kclVersion = 3.0)
width = 3mm
fn f() { return abs(-width) }
fn factory() {
    fn inner(): number(Length) { return width }
    return inner
}
functions = { kcl = f, native = abs, factory = factory }
"#,
        )
        .unwrap();
        ctx.run_mock(&source, &MockConfig::default()).await.unwrap();
        let mut memory = ctx.cache.read_old_memory().await.unwrap();
        memory.stack = round_trip(&memory.stack);
        let fresh = ExecutorContext::new_mock(None).await;
        fresh.cache.write_old_memory(memory).await;
        let call = Program::parse_no_errs(
            r#"
@settings(kclVersion = 3.0)
kcl = functions.kcl
native = functions.native
a = kcl()
b = native(-5mm)
factory = functions.factory
inner = factory()
c = inner()
"#,
        )
        .unwrap();
        fresh.run_mock(&call, &MockConfig::default()).await.unwrap();
        for (name, expected) in [("a", 3.0), ("b", 5.0), ("c", 3.0)] {
            let KclValue::Number { value, .. } = fresh.cache.read_old_memory_var(name).await.unwrap() else {
                panic!("expected a number")
            };
            assert_eq!(value, expected);
        }
        // Normal value serialization keeps its existing display-only shape.
        let KclValue::Object { value, .. } = fresh.cache.read_old_memory_var("functions").await.unwrap() else {
            panic!("expected an object")
        };
        assert!(serde_json::to_value(&value["kcl"]).unwrap()["value"].is_null());
    }

    #[tokio::test]
    async fn memory_snapshot_solves_sketch_using_restored_function() {
        let ctx = ExecutorContext::new_mock(None).await;
        let block = r#"
s = sketch(on = XY) {
    line1 = line(start = [var 0mm, var 0mm], end = [var 4mm, var 0mm])
    distance([line1.start, line1.end]) == f()
}
"#;
        let program = Program::parse_no_errs(&format!(
            "@settings(kclVersion = 3.0)\nwidth = 3mm\nfn f() {{ return abs(-width) }}\n{block}"
        ))
        .unwrap();
        let outcome = ctx.run_mock(&program, &MockConfig::default()).await.unwrap();
        let sketch = outcome
            .scene_objects
            .iter()
            .find(|object| matches!(object.kind, kcl_api::ObjectKind::Sketch(_)))
            .unwrap()
            .id;
        let mut memory = ctx.cache.read_old_memory().await.unwrap();
        memory.stack = round_trip(&memory.stack);
        let fresh = ExecutorContext::new_mock(None).await;
        fresh.cache.write_old_memory(memory).await;
        let mut program = Program::parse_no_errs(&format!("@settings(kclVersion = 3.0)\n{block}")).unwrap();
        let crate::parsing::ast::types::BodyItem::VariableDeclaration(declaration) = &mut program.ast.body[0] else {
            panic!("expected sketch declaration")
        };
        let crate::parsing::ast::types::Expr::SketchBlock(block) = &mut declaration.declaration.init else {
            panic!("expected sketch block")
        };
        block.is_being_edited = true;
        let outcome = fresh
            .run_mock(&program, &MockConfig::new_sketch_mode(sketch))
            .await
            .unwrap();
        assert!(!outcome.var_solutions.is_empty());
        assert!(
            outcome
                .scene_objects
                .iter()
                .any(|object| matches!(object.kind, kcl_api::ObjectKind::Constraint { .. }))
        );
    }

    #[tokio::test]
    async fn memory_snapshot_preserves_geometry_ids_and_tag_history() {
        let ctx = ExecutorContext::new_mock(None).await;
        let program = Program::parse_no_errs(
            r#"
@settings(kclVersion = 3.0)
s = sketch(on = XY) {
    circle1 = circle(center = [0mm, 0mm], start = [5mm, 0mm])
}
body = extrude(region(segments = s.circle1), length = 10mm)
"#,
        )
        .unwrap();
        ctx.run_mock(&program, &MockConfig::default()).await.unwrap();
        let mut memory = ctx.cache.read_old_memory().await.unwrap();
        let range = SourceRange::default();
        let KclValue::Solid { mut value } = memory.stack.get("body", range).unwrap() else {
            panic!("expected a solid")
        };
        let tag = TagIdentifier {
            value: "cap".into(),
            info: vec![(
                memory.stack.current_epoch(),
                TagEngineInfo {
                    id: Uuid::new_v4(),
                    geometry: Geometry::Solid(*value.clone()),
                    path: None,
                    surface: None,
                },
            )],
            meta: vec![range.into()],
        };
        value.faces.insert("cap".into(), tag.clone());
        memory
            .stack
            .add("tag".into(), KclValue::TagIdentifier(Box::new(tag)), range)
            .unwrap();
        memory
            .stack
            .add("taggedBody".into(), KclValue::Solid { value }, range)
            .unwrap();
        let restored = round_trip(&memory.stack);
        for name in ["tag", "taggedBody"] {
            assert_eq!(
                restored.get(name, range).unwrap(),
                memory.stack.get(name, range).unwrap()
            );
        }
    }

    #[tokio::test]
    async fn memory_snapshot_rejects_unknown_native_function() {
        let ctx = ExecutorContext::new_mock(None).await;
        let program = Program::parse_no_errs("@settings(kclVersion = 3.0)\nf = abs").unwrap();
        ctx.run_mock(&program, &MockConfig::default()).await.unwrap();
        let memory = ctx.cache.read_old_memory().await.unwrap();
        let json = serde_json::to_string(&memory.stack)
            .unwrap()
            .replace("std::math::abs", "std::math::unknownFunction");
        let error = serde_json::from_str::<Stack>(&json).unwrap_err();
        assert!(error.to_string().contains("unknown native function"), "{error}");
    }
}

#[derive(Serialize, Deserialize)]
struct TagNodeSnapshot {
    node: crate::parsing::ast::types::Node<crate::parsing::ast::types::TagDeclarator>,
    node_path: Option<crate::NodePath>,
}

impl Snapshot for crate::parsing::ast::types::TagNode {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        Serialize::serialize(
            &TagNodeSnapshot {
                node: self.clone(),
                node_path: self.node_path.clone(),
            },
            serializer,
        )
    }
    fn deserialize<'de, D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let mut value = TagNodeSnapshot::deserialize(deserializer)?;
        value.node.node_path = value.node_path;
        Ok(value.node)
    }
}

impl Snapshot for crate::parsing::ast::types::BoxNode<crate::parsing::ast::types::TagDeclarator> {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        Snapshot::serialize(self.as_ref(), serializer)
    }
    fn deserialize<'de, D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        Snapshot::deserialize(deserializer).map(Self::new)
    }
}
