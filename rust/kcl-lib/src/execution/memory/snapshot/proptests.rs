//! Generate values and valid memory operations rather than serialized payloads.

use proptest::prelude::*;
use proptest::test_runner::TestCaseError;
use proptest::test_runner::TestCaseResult;

use super::Ref;
use crate::Program;
use crate::SourceRange;
use crate::execution::KclValue;
use crate::execution::Metadata;
use crate::execution::SketchVar;
use crate::execution::SketchVarId;
use crate::execution::kcl_value::FunctionSource;
use crate::execution::kcl_value::KclFunctionSourceParams;
use crate::execution::kcl_value::KclObjectKind;
use crate::execution::memory::Stack;
use crate::execution::types::NumericType;
use crate::execution::types::NumericTypeExt;
use crate::parsing::ast::types::BodyItem;
use crate::parsing::ast::types::Expr;

fn metadata() -> impl Strategy<Value = Vec<Metadata>> {
    prop::collection::vec((any::<u16>(), any::<u16>()), 0..3).prop_map(|ranges| {
        ranges
            .into_iter()
            .map(|(start, len)| {
                SourceRange::new(
                    usize::from(start),
                    usize::from(start) + usize::from(len),
                    Default::default(),
                )
                .into()
            })
            .collect()
    })
}

fn text() -> impl Strategy<Value = String> {
    prop::collection::vec(any::<char>(), 0..24).prop_map(|chars| chars.into_iter().collect())
}

fn finite_number() -> impl Strategy<Value = f64> {
    // JSON cannot represent NaN or infinities. Include finite boundary values
    // explicitly as well as arbitrary finite IEEE-754 values.
    prop_oneof![
        Just(0.0),
        Just(-0.0),
        Just(f64::MIN_POSITIVE),
        Just(f64::MAX),
        Just(f64::MIN),
        any::<f64>().prop_filter("finite JSON number", |value| value.is_finite()),
    ]
}

fn numeric_type() -> impl Strategy<Value = NumericType> {
    prop_oneof![
        Just(NumericType::count()),
        Just(NumericType::length(kcl_api::UnitLength::Millimeters)),
        Just(NumericType::default()),
        Just(NumericType::Unknown),
        Just(NumericType::Any),
    ]
}

fn value() -> impl Strategy<Value = KclValue> {
    let scalar = prop_oneof![
        (any::<bool>(), metadata()).prop_map(|(value, meta)| KclValue::Bool { value, meta }),
        (finite_number(), numeric_type(), metadata()).prop_map(|(value, ty, meta)| KclValue::Number {
            value,
            ty,
            meta
        }),
        (text(), metadata()).prop_map(|(value, meta)| KclValue::String { value, meta }),
        (any::<[u8; 16]>(), metadata()).prop_map(|(bytes, meta)| KclValue::Uuid {
            value: uuid::Uuid::from_bytes(bytes),
            meta
        }),
        (
            prop_oneof![Just(SketchVarId::INVALID), (0usize..1000).prop_map(SketchVarId)],
            finite_number(),
            numeric_type(),
            metadata()
        )
            .prop_map(|(id, initial_value, ty, meta)| KclValue::SketchVar {
                value: Box::new(SketchVar {
                    id,
                    initial_value,
                    ty,
                    node_path: None,
                    meta
                })
            }),
    ];
    scalar.prop_recursive(3, 32, 4, |inner| {
        prop_oneof![
            (prop::collection::vec(inner.clone(), 0..4), metadata())
                .prop_map(|(value, meta)| KclValue::Tuple { value, meta }),
            (prop::collection::btree_map(text(), inner, 0..4), metadata()).prop_map(|(fields, meta)| {
                KclValue::Object {
                    value: fields.into_iter().collect(),
                    constrainable: false,
                    object_kind: KclObjectKind::Default,
                    meta,
                }
            }),
        ]
    })
}

#[derive(Debug, Clone)]
enum Op {
    Bind(u8, Box<KclValue>),
    Closure(u8, bool),
    Scope,
    Block,
    Root,
    Pop,
    Capture,
}

fn operations() -> impl Strategy<Value = Vec<Op>> {
    prop::collection::vec(
        prop_oneof![
        4 => (0u8..6, value()).prop_map(|(slot, value)| Op::Bind(slot, Box::new(value))),
            2 => (0u8..6, any::<bool>()).prop_map(|(slot, native)| Op::Closure(slot, native)),
            1 => Just(Op::Scope),
            1 => Just(Op::Block),
            1 => Just(Op::Root),
            2 => Just(Op::Pop),
            1 => Just(Op::Capture),
        ],
        0..32,
    )
}

fn apply(stack: &mut Stack, depth: &mut usize, operations: &[Op]) {
    let range = SourceRange::default();
    for op in operations {
        let binding = match op {
            Op::Bind(slot, value) => Some((*slot, value.as_ref().clone())),
            Op::Closure(slot, native) => {
                let program = Program::parse_no_errs("@settings(kclVersion = 3.0)\nfn f() { return 1 }").unwrap();
                let BodyItem::VariableDeclaration(declaration) = &program.ast.body[0] else {
                    panic!("expected function declaration")
                };
                let Expr::FunctionExpression(ast) = &declaration.declaration.init else {
                    panic!("expected function expression")
                };
                let function = if *native {
                    let (function, props) = crate::std::std_fn("math", "abs");
                    FunctionSource::rust(function, ast.clone(), props, Default::default())
                } else {
                    FunctionSource::kcl(
                        ast.clone(),
                        stack.snapshot().unwrap(),
                        KclFunctionSourceParams {
                            std_props: None,
                            experimental: false,
                            include_in_feature_tree: true,
                        },
                    )
                };
                Some((
                    *slot,
                    KclValue::Function {
                        value: Box::new(function),
                        meta: vec![range.into()],
                    },
                ))
            }
            Op::Scope => {
                stack.push_new_env_for_scope().unwrap();
                *depth += 1;
                None
            }
            Op::Block => {
                stack.push_new_env_for_block().unwrap();
                *depth += 1;
                None
            }
            Op::Root => {
                stack.push_new_root_env(true).unwrap();
                *depth += 1;
                None
            }
            Op::Pop => {
                // Keep the initial root alive; all generated sequences remain valid.
                if *depth > 0 {
                    stack.pop_env().unwrap();
                    *depth -= 1;
                }
                None
            }
            Op::Capture => {
                stack.snapshot().unwrap();
                None
            }
        };
        if let Some((slot, value)) = binding {
            let key = format!("v{slot}");
            if stack.cur_frame_contains(&key).unwrap() {
                stack.update(&key, |stored, _| *stored = value.clone()).unwrap();
            } else {
                stack.add(key, value, range).unwrap();
            }
        }
    }
}

fn round_trip(stack: &Stack) -> Result<Stack, TestCaseError> {
    let json = serde_json::to_vec(stack).map_err(|error| TestCaseError::fail(error.to_string()))?;
    serde_json::from_slice(&json).map_err(|error| TestCaseError::fail(error.to_string()))
}

fn equivalent(original: &Stack, restored: &Stack) -> TestCaseResult {
    // Compare the whole arena, including bindings outside the current scope.
    // Stack's existing PartialEq only checks the current environment.
    prop_assert_eq!(
        serde_json::to_value(original).unwrap(),
        serde_json::to_value(restored).unwrap()
    );
    for slot in 0..6 {
        let key = format!("v{slot}");
        let lookup = |stack: &Stack| {
            stack
                .get(&key, SourceRange::default())
                .map(|value| serde_json::to_value(Ref(&value)).unwrap())
                .map_err(|error| error.to_string())
        };
        prop_assert_eq!(lookup(original), lookup(restored), "lookup of {}", key);
    }
    Ok(())
}

proptest! {
    #[test]
    fn memory_snapshot_roundtrips_float_bits(value in finite_number()) {
        let mut original = Stack::new_for_tests();
        original.add("value".into(), KclValue::from_number_with_type(value, NumericType::count(), vec![]), SourceRange::default()).unwrap();
        let restored = round_trip(&original)?;
        let KclValue::Number { value: actual, .. } = restored.get("value", SourceRange::default()).unwrap() else {
            return Err(TestCaseError::fail("expected a number"));
        };
        prop_assert_eq!(actual.to_bits(), value.to_bits());
    }

    #[test]
    fn memory_snapshot_roundtrips_generated_bindings(bindings in prop::collection::btree_map(text(), value(), 0..12)) {
        let mut original = Stack::new_for_tests();
        for (name, value) in &bindings {
            original.add(name.clone(), value.clone(), SourceRange::default()).unwrap();
        }
        let restored = round_trip(&original)?;
        equivalent(&original, &restored)?;
        for (name, expected) in bindings {
            // Also compare actual values, so a lossy serializer cannot hide
            // data loss by omitting the same field on both sides.
            prop_assert_eq!(restored.get(&name, SourceRange::default()).unwrap(), expected);
        }
    }

    #[test]
    fn memory_snapshot_roundtrips_generated_operations(before in operations(), after in operations()) {
        let mut original = Stack::new_for_tests();
        let mut depth = 0;
        apply(&mut original, &mut depth, &before);
        let mut restored = round_trip(&original)?;
        equivalent(&original, &restored)?;

        // Restored memory must support the same subsequent mutations, epochs,
        // and scope transitions, not just serialize to the same representation.
        let mut restored_depth = depth;
        apply(&mut original, &mut depth, &after);
        apply(&mut restored, &mut restored_depth, &after);
        equivalent(&original, &restored)?;
        for _ in 0..depth {
            original.pop_env().unwrap();
            restored.pop_env().unwrap();
            equivalent(&original, &restored)?;
        }
    }
}
