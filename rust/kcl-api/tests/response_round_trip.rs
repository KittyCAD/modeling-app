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
