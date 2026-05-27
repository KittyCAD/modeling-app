//! Switchable facade for KCL memory implementations.
//!
//! The legacy implementation is still the only active backend. The facade exists
//! so a frozen-env implementation can be added and compared without changing the
//! rest of execution code.

mod legacy;

use std::env;

pub use legacy::EnvironmentRef;
pub(crate) use legacy::MODULE_PREFIX;
pub(crate) use legacy::ProgramMemory;
pub(crate) use legacy::RETURN_NAME;
pub(crate) use legacy::SKETCH_PREFIX;
pub(crate) use legacy::Stack;
pub(crate) use legacy::TYPE_PREFIX;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum MemoryBackendKind {
    Legacy,
    Frozen,
}

impl MemoryBackendKind {
    const ENV_VAR: &'static str = "KCL_MEMORY_IMPL";

    pub(crate) fn from_env() -> Self {
        match env::var(Self::ENV_VAR) {
            Ok(value) if value.eq_ignore_ascii_case("legacy") => Self::Legacy,
            Ok(value) if value.eq_ignore_ascii_case("frozen") => Self::Frozen,
            Ok(value) if value.trim().is_empty() => Self::Legacy,
            Ok(value) => panic!(
                "Unsupported {} value `{}`. Expected `legacy` or `frozen`.",
                Self::ENV_VAR,
                value
            ),
            Err(env::VarError::NotPresent) => Self::Legacy,
            Err(env::VarError::NotUnicode(_)) => {
                panic!("{} must be valid unicode.", Self::ENV_VAR)
            }
        }
    }
}

#[cfg(test)]
mod characterization_tests {
    use kcl_error::SourceRange;
    use kittycad_modeling_cmds::units::UnitLength;
    use uuid::Uuid;

    use super::*;
    use crate::execution::ArtifactId;
    use crate::execution::ConsumedSolidKey;
    use crate::execution::Geometry;
    use crate::execution::KclObjectFields;
    use crate::execution::KclValue;
    use crate::execution::Solid;
    use crate::execution::SolidCreator;
    use crate::execution::TagEngineInfo;
    use crate::execution::TagIdentifier;
    use crate::execution::kcl_value::FunctionBody;
    use crate::execution::kcl_value::FunctionSource;
    use crate::execution::kcl_value::KclFunctionSourceParams;
    use crate::execution::types::NumericType;
    use crate::execution::types::PrimitiveType;
    use crate::execution::types::RuntimeType;
    use crate::parsing::ast::types::FunctionExpression;

    const BACKENDS: [MemoryBackendKind; 2] = [MemoryBackendKind::Legacy, MemoryBackendKind::Frozen];

    fn for_each_backend(test: impl Fn(MemoryBackendKind)) {
        for backend in BACKENDS {
            test(backend);
        }
    }

    fn sr() -> SourceRange {
        SourceRange::default()
    }

    fn val(value: i64) -> KclValue {
        KclValue::Number {
            value: value as f64,
            ty: NumericType::count(),
            meta: Vec::new(),
        }
    }

    fn minimal_solid(id: Uuid, value_id: Uuid) -> Solid {
        Solid {
            id,
            value_id,
            artifact_id: ArtifactId::new(id),
            value: Vec::new(),
            creator: SolidCreator::Procedural,
            start_cap_id: None,
            end_cap_id: None,
            edge_cuts: Vec::new(),
            units: UnitLength::Millimeters,
            sectional: false,
            meta: Vec::new(),
        }
    }

    fn solid_value(id: Uuid, value_id: Uuid) -> KclValue {
        KclValue::Solid {
            value: Box::new(minimal_solid(id, value_id)),
        }
    }

    fn function_value(env: EnvironmentRef) -> KclValue {
        KclValue::Function {
            value: Box::new(FunctionSource::kcl(
                FunctionExpression::dummy(),
                env,
                KclFunctionSourceParams {
                    std_props: None,
                    experimental: false,
                    include_in_feature_tree: false,
                },
            )),
            meta: Vec::new(),
        }
    }

    fn tag_info(id: Uuid) -> TagEngineInfo {
        TagEngineInfo {
            id,
            geometry: Geometry::Solid(minimal_solid(id, id)),
            path: None,
            surface: None,
        }
    }

    fn contains_solid_key(value: &KclValue, target_key: ConsumedSolidKey) -> bool {
        match value {
            KclValue::Solid { value } => {
                value.id == target_key.engine_id() && value.value_id == target_key.instance_id()
            }
            KclValue::HomArray { value, .. } => value.iter().any(|v| contains_solid_key(v, target_key)),
            _ => false,
        }
    }

    #[track_caller]
    fn assert_number(stack: &Stack, backend: MemoryBackendKind, key: &str, expected: i64) {
        match stack.get(key, sr()).unwrap() {
            KclValue::Number { value, .. } => assert_eq!(*value as i64, expected, "{backend:?}"),
            value => panic!("{backend:?}: expected number for `{key}`, got {value:?}"),
        }
    }

    #[track_caller]
    fn assert_tag_info_id(value: &KclValue, backend: MemoryBackendKind, at_epoch: usize, expected_id: Uuid) {
        match value {
            KclValue::TagIdentifier(tag) => {
                let info = tag
                    .get_info(at_epoch)
                    .unwrap_or_else(|| panic!("{backend:?}: missing tag info at epoch {at_epoch}"));
                assert_eq!(info.id, expected_id, "{backend:?}");
            }
            value => panic!("{backend:?}: expected tag identifier, got {value:?}"),
        }
    }

    #[track_caller]
    fn assert_tag_cur_info_id(value: &KclValue, backend: MemoryBackendKind, expected_id: Uuid) {
        match value {
            KclValue::TagIdentifier(tag) => {
                assert_eq!(tag.get_cur_info().unwrap().id, expected_id, "{backend:?}");
            }
            value => panic!("{backend:?}: expected tag identifier, got {value:?}"),
        }
    }

    #[track_caller]
    fn assert_solid_ids(value: &KclValue, backend: MemoryBackendKind, expected_id: Uuid, expected_value_id: Uuid) {
        match value {
            KclValue::Solid { value } => {
                assert_eq!(value.id, expected_id, "{backend:?}");
                assert_eq!(value.value_id, expected_value_id, "{backend:?}");
            }
            value => panic!("{backend:?}: expected solid, got {value:?}"),
        }
    }

    #[track_caller]
    fn closure_env_ref(value: &KclValue, backend: MemoryBackendKind) -> EnvironmentRef {
        match value {
            KclValue::Function { value, .. } => match &**value {
                FunctionSource {
                    body: FunctionBody::Kcl(env),
                    ..
                } => *env,
                value => panic!("{backend:?}: expected KCL function, got {value:?}"),
            },
            value => panic!("{backend:?}: expected function, got {value:?}"),
        }
    }

    fn sorted_keys<'a>(items: impl Iterator<Item = &'a String>) -> Vec<String> {
        let mut keys = items.cloned().collect::<Vec<_>>();
        keys.sort();
        keys
    }

    fn sorted_number_values<'a>(items: impl Iterator<Item = &'a KclValue>) -> Vec<i64> {
        let mut values = items
            .filter_map(|value| match value {
                KclValue::Number { value, .. } => Some(*value as i64),
                _ => None,
            })
            .collect::<Vec<_>>();
        values.sort();
        values
    }

    #[test]
    fn captured_env_hides_later_bindings() {
        for_each_backend(|backend| {
            let stack = &mut Stack::new_for_tests_with_backend(backend);
            stack.add("visible".to_owned(), val(1), sr()).unwrap();

            let captured = stack.snapshot();
            stack.add("future".to_owned(), val(2), sr()).unwrap();

            stack.push_new_env_for_call(captured);
            assert_number(stack, backend, "visible", 1);
            assert!(stack.get("future", sr()).is_err(), "{backend:?}");
            stack.pop_env();
        });
    }

    #[test]
    fn captured_env_observes_later_tag_info_with_legacy_call_stack_epoch() {
        for_each_backend(|backend| {
            let stack = &mut Stack::new_for_tests_with_backend(backend);
            let tag_name = "seg01";
            let old_id = Uuid::from_u128(1);
            let new_id = Uuid::from_u128(2);
            let original_epoch = stack.current_epoch();

            stack
                .add(
                    tag_name.to_owned(),
                    KclValue::TagIdentifier(Box::new(TagIdentifier {
                        value: tag_name.to_owned(),
                        info: vec![(original_epoch, tag_info(old_id))],
                        meta: Vec::new(),
                    })),
                    sr(),
                )
                .unwrap();

            let captured = stack.snapshot();
            stack.update(tag_name, |value, epoch| {
                let tag = value.as_mut_tag().unwrap();
                tag.merge_info(&TagIdentifier {
                    value: tag_name.to_owned(),
                    info: vec![(epoch, tag_info(new_id))],
                    meta: Vec::new(),
                });
            });

            let captured_value = stack.memory.get_from_unchecked(tag_name, captured).unwrap();
            assert_tag_info_id(captured_value, backend, original_epoch, old_id);
            match captured_value {
                KclValue::TagIdentifier(tag) => assert_eq!(tag.get_cur_info().unwrap().id, new_id, "{backend:?}"),
                _ => unreachable!(),
            }

            stack.push_new_env_for_call(captured);
            let (lookup_epoch, value) = stack.get_from_call_stack(tag_name, sr()).unwrap();
            assert_tag_info_id(value, backend, lookup_epoch, new_id);
            stack.pop_env();
        });
    }

    #[test]
    fn module_import_materializes_cloned_values_with_legacy_solid_identity() {
        for_each_backend(|backend| {
            let exporter = &mut Stack::new_for_tests_with_backend(backend);
            let tag_name = "seg01";
            let export_tag_id = Uuid::from_u128(10);
            let imported_tag_id = Uuid::from_u128(11);
            let solid_id = Uuid::from_u128(12);
            let solid_value_id = Uuid::from_u128(13);
            let importer_value_id = Uuid::from_u128(14);
            let epoch = exporter.current_epoch();

            exporter
                .add(
                    tag_name.to_owned(),
                    KclValue::TagIdentifier(Box::new(TagIdentifier {
                        value: tag_name.to_owned(),
                        info: vec![(epoch, tag_info(export_tag_id))],
                        meta: Vec::new(),
                    })),
                    sr(),
                )
                .unwrap();
            exporter
                .add("body".to_owned(), solid_value(solid_id, solid_value_id), sr())
                .unwrap();

            let export_env = exporter.snapshot();
            exporter.pop_and_preserve_env();

            let importer = &mut exporter.memory.clone().new_stack();
            importer.push_new_root_env(false);

            let imported_tag = importer.memory.get_from(tag_name, export_env, sr(), 0).unwrap().clone();
            importer.add(tag_name.to_owned(), imported_tag, sr()).unwrap();

            let imported_solid = importer.memory.get_from("body", export_env, sr(), 0).unwrap().clone();
            importer.add("body".to_owned(), imported_solid, sr()).unwrap();

            importer.update(tag_name, |value, update_epoch| {
                value.as_mut_tag().unwrap().merge_info(&TagIdentifier {
                    value: tag_name.to_owned(),
                    info: vec![(update_epoch, tag_info(imported_tag_id))],
                    meta: Vec::new(),
                });
            });
            importer.update("body", |value, _| {
                if let KclValue::Solid { value } = value {
                    value.value_id = importer_value_id;
                }
            });

            assert_tag_cur_info_id(importer.get(tag_name, sr()).unwrap(), backend, imported_tag_id);
            assert_tag_cur_info_id(
                importer.memory.get_from(tag_name, export_env, sr(), 0).unwrap(),
                backend,
                export_tag_id,
            );
            assert_solid_ids(
                importer.get("body", sr()).unwrap(),
                backend,
                solid_id,
                importer_value_id,
            );
            assert_solid_ids(
                importer.memory.get_from("body", export_env, sr(), 0).unwrap(),
                backend,
                solid_id,
                solid_value_id,
            );

            let fresh_imported_solid = importer.memory.get_from("body", export_env, sr(), 0).unwrap().clone();
            assert_solid_ids(&fresh_imported_solid, backend, solid_id, solid_value_id);
        });
    }

    #[test]
    fn consumed_solid_name_lookup_searches_current_env_and_call_stack() {
        for_each_backend(|backend| {
            let stack = &mut Stack::new_for_tests_with_backend(backend);
            let root_key = ConsumedSolidKey::new(Uuid::from_u128(20), Uuid::from_u128(21));
            let local_key = ConsumedSolidKey::new(Uuid::from_u128(22), Uuid::from_u128(23));
            let ignored_key = ConsumedSolidKey::new(Uuid::from_u128(24), Uuid::from_u128(25));
            let object_key = ConsumedSolidKey::new(Uuid::from_u128(26), Uuid::from_u128(27));

            stack
                .add(
                    "root_body".to_owned(),
                    solid_value(root_key.engine_id(), root_key.instance_id()),
                    sr(),
                )
                .unwrap();
            let parent = stack.snapshot();
            stack.push_new_env_for_call(parent);

            stack
                .add(
                    "local_bodies".to_owned(),
                    KclValue::HomArray {
                        value: vec![
                            solid_value(ignored_key.engine_id(), ignored_key.instance_id()),
                            solid_value(local_key.engine_id(), local_key.instance_id()),
                        ],
                        ty: RuntimeType::Primitive(PrimitiveType::Solid),
                    },
                    sr(),
                )
                .unwrap();
            stack
                .add(
                    "object_body".to_owned(),
                    KclValue::Object {
                        value: KclObjectFields::from([(
                            "body".to_owned(),
                            solid_value(object_key.engine_id(), object_key.instance_id()),
                        )]),
                        constrainable: false,
                        meta: Vec::new(),
                    },
                    sr(),
                )
                .unwrap();

            assert_eq!(
                stack.find_var_name_in_all_envs(|value| contains_solid_key(value, local_key)),
                Some("local_bodies".to_owned()),
                "{backend:?}",
            );
            assert_eq!(
                stack.find_var_name_in_all_envs(|value| contains_solid_key(value, root_key)),
                Some("root_body".to_owned()),
                "{backend:?}",
            );
            assert_eq!(
                stack.find_var_name_in_all_envs(|value| contains_solid_key(value, ignored_key)),
                Some("local_bodies".to_owned()),
                "{backend:?}",
            );
            assert_eq!(
                stack.find_var_name_in_all_envs(|value| contains_solid_key(value, object_key)),
                None,
                "{backend:?}",
            );
        });
    }

    #[test]
    fn recursive_closure_rewrites_placeholder_env_ref() {
        for_each_backend(|backend| {
            let stack = &mut Stack::new_for_tests_with_backend(backend);
            let placeholder = EnvironmentRef::dummy();

            let fixed_closure = stack
                .add_recursive_closure("recurse".to_owned(), function_value(placeholder), placeholder, sr())
                .unwrap();

            stack.push_new_env_for_call(closure_env_ref(&fixed_closure, backend));
            match stack.get("recurse", sr()).unwrap() {
                KclValue::Function { .. } => {}
                value => panic!("{backend:?}: expected recursive closure to see itself, got {value:?}"),
            }
            stack.pop_env();
        });
    }

    #[test]
    fn squash_preserved_env_moves_bindings_and_rewrites_closure_refs() {
        for_each_backend(|backend| {
            let stack = &mut Stack::new_for_tests_with_backend(backend);
            stack.add("a".to_owned(), val(1), sr()).unwrap();
            stack.add("b".to_owned(), val(3), sr()).unwrap();

            let parent = stack.snapshot();
            stack.push_new_env_for_call(parent);
            stack.add("b".to_owned(), val(2), sr()).unwrap();
            let closure_parent = stack.snapshot();
            stack.add("f".to_owned(), function_value(closure_parent), sr()).unwrap();

            let old = stack.pop_and_preserve_env();
            stack.squash_env(old);

            assert_number(stack, backend, "a", 1);
            assert_number(stack, backend, "b", 2);

            let closure_env = closure_env_ref(stack.get("f", sr()).unwrap(), backend);
            stack.push_new_env_for_call(closure_env);
            assert_number(stack, backend, "a", 1);
            assert_number(stack, backend, "b", 2);
            stack.pop_env();
        });
    }

    #[test]
    fn find_all_and_walk_call_stack_keep_legacy_visibility_shape() {
        for_each_backend(|backend| {
            let stack = &mut Stack::new_for_tests_with_backend(backend);
            stack.add("root".to_owned(), val(1), sr()).unwrap();

            let old_root = stack.snapshot();
            stack.add("future".to_owned(), val(9), sr()).unwrap();
            assert_eq!(
                sorted_keys(stack.find_all_in_env(old_root).map(|(key, _)| key)),
                vec!["future".to_owned(), "root".to_owned()],
                "{backend:?}",
            );

            let parent = stack.snapshot();
            stack.push_new_env_for_call(parent);
            stack.add("local".to_owned(), val(2), sr()).unwrap();

            assert_eq!(
                sorted_keys(stack.find_all_in_current_env().map(|(key, _)| key)),
                vec!["local".to_owned()],
                "{backend:?}",
            );

            let walked = sorted_number_values(stack.walk_call_stack());
            assert!(walked.contains(&1), "{backend:?}: walked values: {walked:?}");
            assert!(walked.contains(&2), "{backend:?}: walked values: {walked:?}");
            assert!(walked.contains(&9), "{backend:?}: walked values: {walked:?}");
            stack.pop_env();
        });
    }

    #[test]
    fn two_stacks_keep_independent_current_frames_on_shared_memory() {
        for_each_backend(|backend| {
            let stack1 = &mut Stack::new_for_tests_with_backend(backend);
            let stack2 = &mut stack1.memory.clone().new_stack();
            stack2.push_new_root_env(false);

            stack1.add("a".to_owned(), val(1), sr()).unwrap();
            let stack1_parent = stack1.snapshot();
            stack1.push_new_env_for_call(stack1_parent);

            stack2.add("a".to_owned(), val(2), sr()).unwrap();
            let stack2_parent = stack2.snapshot();
            stack2.push_new_env_for_call(stack2_parent);

            stack1.add("a".to_owned(), val(3), sr()).unwrap();
            stack2.add("a".to_owned(), val(4), sr()).unwrap();

            assert_number(stack1, backend, "a", 3);
            assert_number(stack2, backend, "a", 4);

            stack1.pop_env();
            assert_number(stack1, backend, "a", 1);
            assert_number(stack2, backend, "a", 4);

            stack2.pop_env();
            assert_number(stack1, backend, "a", 1);
            assert_number(stack2, backend, "a", 2);
        });
    }

    #[test]
    fn root_env_can_include_and_shadow_std_prelude() {
        for_each_backend(|backend| {
            let std_stack = &mut ProgramMemory::new_with_backend(backend).new_stack();
            std_stack.push_new_root_env(false);
            std_stack.add("std_name".to_owned(), val(1), sr()).unwrap();
            let std_env = std_stack.pop_and_preserve_env();
            std_stack.memory.set_std(std_env);

            let module_stack = &mut std_stack.memory.clone().new_stack();
            module_stack.push_new_root_env(true);
            assert_number(module_stack, backend, "std_name", 1);

            module_stack.add("std_name".to_owned(), val(2), sr()).unwrap();
            assert_number(module_stack, backend, "std_name", 2);
        });
    }

    #[test]
    fn deep_clone_detaches_preserved_memory_and_restore_reopens_env() {
        for_each_backend(|backend| {
            let stack = &mut Stack::new_for_tests_with_backend(backend);
            stack.add("shared".to_owned(), val(1), sr()).unwrap();

            let preserved = stack.pop_and_preserve_env();
            let mut cloned = stack.deep_clone();

            stack.restore_env(preserved);
            stack.update("shared", |value, _| {
                *value = val(2);
            });
            assert_number(stack, backend, "shared", 2);
            stack.pop_and_preserve_env();

            cloned.restore_env(preserved);
            assert_number(&cloned, backend, "shared", 1);
            cloned.add("restored".to_owned(), val(3), sr()).unwrap();
            assert_number(&cloned, backend, "restored", 3);
            cloned.pop_env();
        });
    }

    #[test]
    fn current_frame_helpers_ignore_parent_bindings() {
        for_each_backend(|backend| {
            let stack = &mut Stack::new_for_tests_with_backend(backend);
            stack.add("outer".to_owned(), val(1), sr()).unwrap();

            stack.push_new_env_for_scope();
            stack.add("inner".to_owned(), val(2), sr()).unwrap();

            assert!(!stack.cur_frame_contains("outer"), "{backend:?}");
            assert!(stack.cur_frame_contains("inner"), "{backend:?}");
            assert_number(stack, backend, "outer", 1);
            assert_number(stack, backend, "inner", 2);

            assert_eq!(
                sorted_keys(stack.find_keys_in_current_env(|_| true)),
                vec!["inner".to_owned()],
                "{backend:?}",
            );
            stack.pop_env();
        });
    }
}
