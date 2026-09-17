use indexmap::IndexMap;
use kcl_api::KclValueView;
use kcl_api::Operation;
use kcl_api::OperationsByModule;
use kcl_api::TagIdentifierView;
use kcl_api::TagIdentifierViewType;
use kcl_error::ModuleId;
use serde::Deserialize;
use serde::Serialize;

// Match the buffering boundary used by the modeling WebSocket response, without
// depending on modeling-cmds (which itself depends on kcl-api).
#[derive(Debug, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
enum Response<T> {
    Success { result: Result<T, T> },
    Failure { errors: Vec<String> },
}

#[test]
fn raw_operations_map_round_trips_inside_untagged_response() {
    let operations = IndexMap::from([
        (ModuleId::default(), vec![Operation::GroupEnd]),
        (ModuleId::from_usize(7), vec![]),
    ]);
    for result in [Ok(operations.clone()), Err(operations)] {
        let response = Response::Success { result };
        let json = serde_json::to_string(&response).unwrap();
        assert!(json.contains(r#""0":[{"type":"GroupEnd"}],"7":[]"#));
        let decoded: Response<IndexMap<ModuleId, Vec<Operation>>> = serde_json::from_str(&json).unwrap();
        assert_eq!(decoded, response);
    }
}

#[test]
fn operations_by_module_round_trips_inside_untagged_response() {
    let response = Response::Success {
        result: Ok(OperationsByModule {
            map: IndexMap::from([(ModuleId::default(), vec![Operation::GroupEnd])]),
        }),
    };
    let json = serde_json::to_string(&response).unwrap();
    let decoded: Response<OperationsByModule> = serde_json::from_str(&json).unwrap();
    assert_eq!(decoded, response);
}

#[test]
fn tag_identifier_has_one_discriminator_and_round_trips() {
    let value = KclValueView::TagIdentifier {
        value: "edge01".to_owned(),
    };
    // Test the string, not serde_json::Value, which hides duplicate object keys.
    let json = serde_json::to_string(&value).unwrap();
    assert_eq!(json, r#"{"type":"TagIdentifier","value":"edge01"}"#);
    assert_eq!(serde_json::from_str::<KclValueView>(&json).unwrap(), value);

    let response = Response::Success { result: Ok(value) };
    let json = serde_json::to_string(&response).unwrap();
    assert_eq!(serde_json::from_str::<Response<KclValueView>>(&json).unwrap(), response);

    // Tags embedded in sketches and solids must retain their discriminator too.
    let nested = TagIdentifierView {
        type_: TagIdentifierViewType::TagIdentifier,
        value: "edge01".to_owned(),
    };
    let json = serde_json::to_string(&nested).unwrap();
    assert_eq!(json, r#"{"type":"TagIdentifier","value":"edge01"}"#);
    assert_eq!(serde_json::from_str::<TagIdentifierView>(&json).unwrap(), nested);
}

#[test]
fn module_ids_preserve_numeric_values_and_reject_invalid_ids() {
    for id in [0, 7, u32::MAX] {
        let module = ModuleId::from_usize(id as usize);
        assert_eq!(serde_json::to_string(&module).unwrap(), id.to_string());
        assert_eq!(serde_json::from_str::<ModuleId>(&id.to_string()).unwrap(), module);
        assert_eq!(serde_json::from_str::<ModuleId>(&format!("\"{id}\"")).unwrap(), module);
    }
    for json in [
        "-1",
        "4294967296",
        "1.5",
        "null",
        "true",
        r#""-1""#,
        r#""4294967296""#,
        r#""abc""#,
    ] {
        serde_json::from_str::<ModuleId>(json).expect_err(json);
    }
}

fn numeric_types() -> Vec<kcl_api::NumericType> {
    use kcl_api::NumericType;
    use kcl_api::UnitAngle;
    use kcl_api::UnitLength;
    use kcl_api::UnitType;

    let mut types = vec![
        NumericType::Known(UnitType::Count),
        NumericType::Known(UnitType::GenericLength),
        NumericType::Known(UnitType::GenericAngle),
        NumericType::Unknown,
        NumericType::Any,
    ];
    for len in [
        UnitLength::Millimeters,
        UnitLength::Centimeters,
        UnitLength::Meters,
        UnitLength::Inches,
        UnitLength::Feet,
        UnitLength::Yards,
    ] {
        types.push(NumericType::Known(UnitType::Length(len)));
        for angle in [UnitAngle::Degrees, UnitAngle::Radians] {
            types.push(NumericType::Default { len, angle });
        }
    }
    for angle in [UnitAngle::Degrees, UnitAngle::Radians] {
        types.push(NumericType::Known(UnitType::Angle(angle)));
    }
    types
}

#[test]
fn numeric_types_round_trip_without_overlapping_discriminators() {
    use kcl_api::NumericType;
    use kcl_api::UnitLength;
    use kcl_api::UnitType;

    for ty in numeric_types() {
        let json = serde_json::to_string(&ty).unwrap();
        assert_eq!(serde_json::from_str::<NumericType>(&json).unwrap(), ty, "{json}");
        // JavaScript parses and returns these types through the WASM API. Going
        // through Value also verifies that object-key deduplication loses no data.
        let value = serde_json::to_value(ty).unwrap();
        assert_eq!(serde_json::from_value::<NumericType>(value).unwrap(), ty);
        if let NumericType::Known(unit) = ty {
            let json = serde_json::to_string(&unit).unwrap();
            assert_eq!(serde_json::from_str::<UnitType>(&json).unwrap(), unit);
        }
    }
    assert_eq!(
        serde_json::to_string(&NumericType::Known(UnitType::Length(UnitLength::Millimeters))).unwrap(),
        r#"{"type":"Known","value":{"type":"Length","value":"mm"}}"#,
    );
}

#[test]
fn numeric_values_round_trip_inside_untagged_response() {
    use kcl_api::OpArg;
    use kcl_api::OpKclValue;

    #[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
    struct Outputs {
        operations: IndexMap<ModuleId, Vec<Operation>>,
        variables: IndexMap<String, KclValueView>,
    }

    for ty in numeric_types() {
        let values = vec![
            OpKclValue::Number { value: 12.5, ty },
            OpKclValue::SketchVar { value: -2.0, ty },
        ];
        let operations = vec![Operation::StdLibCall {
            name: "line".to_owned(),
            unlabeled_arg: None,
            labeled_args: IndexMap::from([(
                "end".to_owned(),
                OpArg::new(OpKclValue::Array { value: values }, Default::default()),
            )]),
            node_path: Default::default(),
            source_range: Default::default(),
            stdlib_entry_source_range: None,
            is_error: false,
        }];
        let outputs = Outputs {
            operations: IndexMap::from([(ModuleId::default(), operations)]),
            variables: IndexMap::from([("length".to_owned(), KclValueView::Number { value: 12.5, ty })]),
        };
        for result in [Ok(outputs.clone()), Err(outputs)] {
            let response = Response::Success { result };
            let json = serde_json::to_string(&response).unwrap();
            assert_eq!(serde_json::from_str::<Response<Outputs>>(&json).unwrap(), response);
        }
    }
}
