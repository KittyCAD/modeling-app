//! Custom types for various standard library types.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

/// A Uint that allows us to do math but rounds to a uint.
#[derive(Debug, Clone, Copy, PartialEq, PartialOrd, Serialize, Deserialize, ts_rs::TS)]
#[ts(export)]
pub struct Uint(f64);

#[allow(dead_code)]
impl Uint {
    pub fn new(value: f64) -> Self {
        if value < 0.0 {
            panic!("Uint cannot be negative");
        }
        Self(value)
    }

    pub fn value(&self) -> f64 {
        self.0
    }

    pub fn u32(&self) -> u32 {
        self.0.round() as u32
    }

    pub fn u64(&self) -> u64 {
        self.0.round() as u64
    }
}

impl JsonSchema for Uint {
    fn schema_name() -> String {
        "Uint".to_string()
    }

    fn json_schema(gen: &mut schemars::gen::SchemaGenerator) -> schemars::schema::Schema {
        gen.subschema_for::<u32>()
    }
}
