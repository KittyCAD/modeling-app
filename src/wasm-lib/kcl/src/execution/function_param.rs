use schemars::JsonSchema;

use crate::{
    errors::KclError,
    execution::{call_user_defined_function, ExecState, ExecutorContext, KclValue, ProgramMemory},
    parsing::ast::types::FunctionExpression,
    source_range::SourceRange,
    std::args::Arg,
};

/// A function being used as a parameter into a stdlib function.  This is a
/// closure, plus everything needed to execute it.
pub struct FunctionParam<'a> {
    pub inner: Option<&'a crate::std::StdFn>,
    pub memory: Option<ProgramMemory>,
    pub fn_expr: crate::parsing::ast::types::BoxNode<FunctionExpression>,
    pub ctx: ExecutorContext,
}

impl<'a> FunctionParam<'a> {
    pub async fn call(
        &self,
        exec_state: &mut ExecState,
        args: Vec<Arg>,
        source_range: SourceRange,
    ) -> Result<Option<KclValue>, KclError> {
        if let Some(inner) = self.inner {
            let args = crate::std::Args::new(
                args,
                source_range,
                self.ctx.clone(),
                exec_state.mod_local.pipe_value.clone().map(Arg::synthetic),
            );

            inner(exec_state, args).await.map(Some)
        } else {
            call_user_defined_function(
                args,
                self.memory.as_ref().unwrap(),
                self.fn_expr.as_ref(),
                exec_state,
                &self.ctx,
            )
            .await
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
