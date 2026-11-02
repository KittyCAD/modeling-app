use kcl_error::{ModuleId, SourceRange};

use crate::execution::Metadata;

use super::KclValue;

const START: usize = 4;
const END: usize = 8;

#[test]
fn basic_roundtrip() {
    let input = KclValue::Uuid {
        value: "2f2026d2-aaaa-4240-9163-db4377f5cc90".parse().unwrap(),
        meta: vec![Metadata {
            source_range: SourceRange::new(START, END, ModuleId::from_usize(9)),
        }],
    };
    assert_roundtrips(input);
}

#[track_caller]
fn assert_roundtrips(input: KclValue) {
    let serialized = serde_json::to_string(&input).unwrap();
    let deserialized: KclValue = serde_json::from_str(&serialized).unwrap();
    assert_eq!(input, deserialized);
}
