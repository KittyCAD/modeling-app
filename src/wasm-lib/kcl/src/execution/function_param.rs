use schemars::JsonSchema;

use crate::{
    errors::KclError,
    execution::{
        call_user_defined_function, ExecState, ExecutorContext, KclValue, MemoryFunction, Metadata, ProgramMemory,
    },
    parsing::ast::types::FunctionExpression,
    std::args::Arg,
};

/// A function being used as a parameter into a stdlib function.  This is a
/// closure, plus everything needed to execute it.
pub struct FunctionParam<'a> {
    pub inner: Option<&'a MemoryFunction>,
    pub memory: ProgramMemory,
    pub fn_expr: crate::parsing::ast::types::BoxNode<FunctionExpression>,
    pub meta: Vec<Metadata>,
    pub ctx: ExecutorContext,
}

impl<'a> FunctionParam<'a> {
    pub async fn call(&self, exec_state: &mut ExecState, args: Vec<Arg>) -> Result<Option<KclValue>, KclError> {
        if let Some(inner) = self.inner {
            inner(
                args,
                self.memory.clone(),
                self.fn_expr.clone(),
                self.meta.clone(),
                exec_state,
                self.ctx.clone(),
            )
            .await
        } else {
            call_user_defined_function(args, &self.memory, self.fn_expr.as_ref(), exec_state, &self.ctx).await
        }
    }
}

impl JsonSchema for FunctionParam<'_> {
    fn schema_name() -> String {
        "FunctionParam".to_owned()
    }

    fn json_schema(gen: &mut schemars::gen::SchemaGenerator) -> schemars::schema::Schema {
        // TODO: Actually generate a reasonable schema.
        gen.subschema_for::<()>()
    }
}
