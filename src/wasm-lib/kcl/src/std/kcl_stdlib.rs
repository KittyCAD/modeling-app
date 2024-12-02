use std::path::Path;

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::{
    docs::{StdLibFn, StdLibFnData},
    parsing::ast::types::{FunctionExpression, Program},
};

pub trait KclStdLibFn: StdLibFn {
    fn kcl_clone_box(&self) -> Box<dyn KclStdLibFn>;
    fn function(&self) -> &FunctionExpression;
    fn program(&self) -> &Program;
    fn std_lib(&self) -> Box<dyn StdLibFn> {
        self.clone_box()
    }
}

impl ts_rs::TS for dyn KclStdLibFn {
    type WithoutGenerics = Self;

    fn name() -> String {
        "StdLibFnData".to_string()
    }

    fn decl() -> String {
        StdLibFnData::decl()
    }

    fn decl_concrete() -> String {
        StdLibFnData::decl_concrete()
    }

    fn inline() -> String {
        StdLibFnData::inline()
    }

    fn inline_flattened() -> String {
        StdLibFnData::inline_flattened()
    }

    fn output_path() -> Option<&'static Path> {
        StdLibFnData::output_path()
    }
}

impl Clone for Box<dyn KclStdLibFn> {
    fn clone(&self) -> Box<dyn KclStdLibFn> {
        self.kcl_clone_box()
    }
}

impl JsonSchema for dyn KclStdLibFn {
    fn schema_name() -> String {
        "KclStdLibFn".to_string()
    }

    fn json_schema(gen: &mut schemars::gen::SchemaGenerator) -> schemars::schema::Schema {
        gen.subschema_for::<StdLibFnData>()
    }
}

impl<'de> Deserialize<'de> for Box<dyn KclStdLibFn> {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let data = StdLibFnData::deserialize(deserializer)?;
        let stdlib = crate::std::StdLib::new();
        let stdlib_fn = stdlib
            .get_kcl(&data.name)
            .ok_or_else(|| serde::de::Error::custom(format!("StdLibFn {} not found", data.name)))?;
        Ok(stdlib_fn)
    }
}

impl Serialize for Box<dyn KclStdLibFn> {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        self.to_json().unwrap().serialize(serializer)
    }
}
