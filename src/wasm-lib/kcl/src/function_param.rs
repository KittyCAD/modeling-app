use schemars::JsonSchema;

use crate::{
    ast::types::FunctionExpression,
    errors::KclError,
    executor::{
        call_user_defined_function, ExecState, ExecutorContext, KclValue, MemoryFunction, Metadata, ProgramMemory,
    },
};

/// A function being used as a parameter into a stdlib function.  This is a
/// closure, plus everything needed to execute it.
pub struct FunctionParam<'a> {
    pub inner: Option<&'a MemoryFunction>,
    pub memory: ProgramMemory,
    pub fn_expr: Box<FunctionExpression>,
    pub read_only_exec_state: ExecState,
    pub meta: Vec<Metadata>,
    pub ctx: ExecutorContext,
}

impl<'a> FunctionParam<'a> {
    pub async fn call(&self, args: Vec<KclValue>) -> Result<Option<KclValue>, KclError> {
        if let Some(inner) = self.inner {
            inner(
                args,
                self.memory.clone(),
                self.fn_expr.clone(),
                self.meta.clone(),
                &self.read_only_exec_state,
                self.ctx.clone(),
            )
            .await
        } else {
            // TODO: We really shouldn't be cloning the read-only exec state
            // here.  It means that any changes to the state while executing
            // this function won't be reflected in the exec state outside of it.
            let mut temp_exec_state = self.read_only_exec_state.clone();
            call_user_defined_function(
                args,
                &self.memory,
                self.fn_expr.as_ref(),
                &mut temp_exec_state,
                &self.ctx,
            )
            .await
        }
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
