use schemars::JsonSchema;

use crate::{
    ast::types::FunctionExpression,
    errors::KclError,
    executor::{DynamicState, ExecutorContext, KclValue, MemoryFunction, Metadata, ProgramMemory},
};

/// A function being used as a parameter into a stdlib function.
pub struct FunctionParam<'a> {
    pub inner: &'a MemoryFunction,
    pub memory: ProgramMemory,
    pub dynamic_state: DynamicState,
    pub fn_expr: Box<FunctionExpression>,
    pub meta: Vec<Metadata>,
    pub ctx: ExecutorContext,
}

impl<'a> FunctionParam<'a> {
    pub async fn call(&self, args: Vec<KclValue>) -> Result<Option<KclValue>, KclError> {
        (self.inner)(
            args,
            self.memory.clone(),
            self.fn_expr.clone(),
            self.meta.clone(),
            self.dynamic_state.clone(),
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
