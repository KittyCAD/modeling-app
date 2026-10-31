//! Direct round trips of runtime values, independent of memory snapshots.

use proptest::prelude::*;

use super::*;

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

fn function(native: bool) -> FunctionSource {
    let program =
        crate::Program::parse_no_errs("@settings(kclVersion = 3.0)\nfn f(): number(Length) { return 1mm }").unwrap();
    let crate::parsing::ast::types::BodyItem::VariableDeclaration(declaration) = &program.ast.body[0] else {
        panic!("expected function declaration")
    };
    let crate::parsing::ast::types::Expr::FunctionExpression(ast) = &declaration.declaration.init else {
        panic!("expected function expression")
    };
    if native {
        let (function, props) = crate::std::std_fn("math", "abs").unwrap();
        FunctionSource::rust(function, ast.clone(), props, Default::default())
    } else {
        FunctionSource::kcl(
            ast.clone(),
            EnvironmentRef::at_epoch(2, 3),
            KclFunctionSourceParams {
                std_props: None,
                experimental: false,
                include_in_feature_tree: true,
            },
        )
    }
}

fn value() -> impl Strategy<Value = KclValue> {
    let scalar = prop_oneof![
        any::<bool>().prop_map(|keep_path| {
            let program = crate::Program::parse_no_errs("@settings(kclVersion = 3.0)\ntag = $edge").unwrap();
            let crate::parsing::ast::types::BodyItem::VariableDeclaration(declaration) = &program.ast.body[0] else {
                panic!("expected declaration")
            };
            let crate::parsing::ast::types::Expr::TagDeclarator(node) = &declaration.declaration.init else {
                panic!("expected tag declarator")
            };
            let mut node = node.clone();
            if !keep_path {
                node.node_path = None;
            }
            KclValue::TagDeclarator(node)
        }),
        metadata().prop_map(|meta| KclValue::Function {
            value: Box::new(function(false)),
            meta
        }),
        (text(), metadata()).prop_map(|(value, meta)| KclValue::TagIdentifier(Box::new(TagIdentifier {
            value,
            info: vec![],
            meta
        }))),
        (numeric_type(), any::<bool>(), metadata()).prop_map(|(ty, experimental, meta)| KclValue::Type {
            value: TypeDef::Alias(RuntimeType::Primitive(PrimitiveType::Number(ty))),
            experimental,
            meta
        }),
        (any::<u16>(), metadata()).prop_map(|(id, meta)| KclValue::Module {
            value: ModuleId::from_usize(usize::from(id)),
            meta
        }),
        metadata().prop_map(|meta| KclValue::KclNone {
            value: KclNone::default(),
            meta
        }),
        ("[a-z]{1,8}", metadata()).prop_map(|(name, meta)| {
            let def = Arc::new(
                EnumTypeDef::new(
                    EnumTypeId::new(ModuleId::default(), name),
                    vec!["A".into(), "B".into()],
                    false,
                )
                .unwrap(),
            );
            KclValue::Enum {
                value: Box::new(EnumValue::new(def, "B", meta)),
            }
        }),
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
            (prop::collection::vec(finite_number(), 0..4), numeric_type()).prop_map(|(numbers, ty)| {
                KclValue::HomArray {
                    value: numbers
                        .into_iter()
                        .map(|value| KclValue::Number {
                            value,
                            ty,
                            meta: vec![],
                        })
                        .collect(),
                    ty: RuntimeType::Primitive(PrimitiveType::Number(ty)),
                }
            }),
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

proptest! {
    /// Any arbitrary KCL value should be able to get serialized, then deserialized,
    /// and come out the same as before. I.e. composing serialization and deserialization
    /// should be the identity function.
    #[test]
    fn kcl_value_roundtrips(input_value in value()) {
        let serialized = serde_json::to_vec(&input_value).unwrap();
        let output_value: KclValue = serde_json::from_slice(&serialized).unwrap();
        prop_assert_eq!(serde_json::to_value(&output_value).unwrap(), serde_json::to_value(&input_value).unwrap());
        prop_assert_eq!(output_value, input_value);
    }
}

#[test]
fn native_function_roundtrips_by_identity() {
    let value = KclValue::Function {
        value: Box::new(function(true)),
        meta: vec![SourceRange::new(2, 5, ModuleId::default()).into()],
    };
    let json = serde_json::to_string(&value).unwrap();
    let restored: KclValue = serde_json::from_str(&json).unwrap();
    assert_eq!(
        serde_json::to_value(restored).unwrap(),
        serde_json::to_value(value).unwrap()
    );
    let error = serde_json::from_str::<KclValue>(&json.replace("std::math::abs", "std::math::missing")).unwrap_err();
    assert!(error.to_string().contains("unknown native function"));
}

#[tokio::test]
async fn executed_values_roundtrip_with_geometry_and_closures() {
    let ctx = crate::ExecutorContext::new_mock(None).await;
    let program = crate::Program::parse_no_errs(
        r#"
@settings(kclVersion = 3.0)
width = 3mm
fn f(): number(Length) { return abs(-width) }
s = sketch(on = XY) {
    circle1 = circle(center = [var 0mm, var 0mm], start = [var 3mm, var 0mm])
    radius(circle1) == width
}
r = region(segments = s.circle1)
body = extrude(r, length = 10mm)
"#,
    )
    .unwrap();
    ctx.run_mock(&program, &crate::execution::MockConfig::default())
        .await
        .unwrap();
    for name in ["width", "f", "s", "r", "body", "abs"] {
        let mut value = ctx.cache.read_old_memory_var(name).await.unwrap();
        if let KclValue::Solid { value: solid } = &mut value {
            solid.faces.insert(
                "cap".into(),
                TagIdentifier {
                    value: "cap".into(),
                    info: vec![(
                        7,
                        crate::execution::TagEngineInfo {
                            id: uuid::Uuid::new_v4(),
                            geometry: Geometry::Solid(*solid.clone()),
                            path: None,
                            surface: None,
                        },
                    )],
                    meta: vec![SourceRange::new(1, 3, ModuleId::default()).into()],
                },
            );
        }
        let json = serde_json::to_string(&value).unwrap();
        let restored: KclValue = serde_json::from_str(&json).unwrap_or_else(|error| panic!("{name}: {error}"));
        assert_eq!(
            serde_json::to_value(&restored).unwrap(),
            serde_json::to_value(&value).unwrap(),
            "{name}"
        );
        if name != "abs" {
            assert_eq!(restored, value, "{name}");
        }
    }
}
