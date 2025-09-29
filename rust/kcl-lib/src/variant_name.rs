use serde::Serialize;
use serde_json::Value;

/// Extract the variant tag of any enum that uses Serde.
#[allow(dead_code)]
pub fn variant_name<T: Serialize>(v: &T) -> String {
    // 1. Serialize to JSON Value.
    match serde_json::to_value(v).unwrap() {
        // internally-tagged:  {"type": "Foo", ...}
        Value::Object(ref map) if map.get("type").is_some() => map["type"].as_str().unwrap().to_string(),
        // externally-tagged: {"Foo": {...}}
        Value::Object(map) => map.keys().next().unwrap().as_str().to_string(),
        _ => panic!("untagged enum or unsupported representation"),
    }
}
