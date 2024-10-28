use std::path::Path;

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::{
    ast::types::{BodyItem, Expr, FunctionExpression, Program},
    docs::{StdLibFn, StdLibFnData},
    token::lexer,
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

/// Parse a KCL program. Expect it to have a single body item, which is a function.
/// Return the program and its single function.
/// Return None if those expectations aren't met.
pub fn extract_function(source: &str) -> Option<(Program, Box<FunctionExpression>)> {
    let tokens = lexer(source).unwrap();
    let src = crate::parser::Parser::new(tokens).ast().ok()?;
    assert_eq!(src.body.len(), 1);
    let BodyItem::ExpressionStatement(expr) = src.body.last()? else {
        panic!("expected expression statement");
    };
    let Expr::FunctionExpression(function) = expr.expression.clone() else {
        panic!("expected function expr");
    };
    Some((src, function))
}
