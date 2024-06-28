use std::collections::HashMap;

use schemars::JsonSchema;

use crate::{
    ast::types::FunctionExpression,
    errors::KclError,
    executor::{ExecutorContext, MemoryFunction, MemoryItem, Metadata, ProgramMemory, ProgramReturn},
};

/// A function being used as a parameter into a stdlib function.
pub struct FunctionParam<'a> {
    pub inner: &'a MemoryFunction,
    pub memory: ProgramMemory,
    pub fn_expr: Box<FunctionExpression>,
    pub meta: Vec<Metadata>,
    pub ctx: ExecutorContext,
}

impl<'a> FunctionParam<'a> {
    pub async fn call(
        &self,
        args: Vec<MemoryItem>,
    ) -> Result<(Option<ProgramReturn>, HashMap<String, MemoryItem>), KclError> {
        (self.inner)(
            args,
            self.memory.clone(),
            self.fn_expr.clone(),
            self.meta.clone(),
            self.ctx.clone(),
        )
        .await
    }
}

impl<'a> JsonSchema for FunctionParam<'a> {
    fn schema_name() -> String {
        "FunctionParam".to_owned()
    }

    fn json_schema(gen: &mut schemars::gen::SchemaGenerator) -> schemars::schema::Schema {
        // TODO: Actually generate a reasonable schema.
        gen.subschema_for::<()>()
    }
}
