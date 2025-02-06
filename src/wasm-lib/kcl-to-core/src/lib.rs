use std::sync::{Arc, Mutex};

use anyhow::Result;
use kcl_lib::{ExecState, ExecutorContext};

#[cfg(not(target_arch = "wasm32"))]
mod conn_mock_core;

///Converts the given kcl code to an engine test
pub async fn kcl_to_engine_core(code: &str) -> Result<String> {
    let program = kcl_lib::Program::parse_no_errs(code)?;

    let result = Arc::new(Mutex::new("".into()));
    let ref_result = Arc::clone(&result);

    let ctx = ExecutorContext::new_forwarded_mock(Arc::new(Box::new(
        crate::conn_mock_core::EngineConnection::new(ref_result).await?,
    )));
    ctx.run(&program, &mut ExecState::new(&ctx.settings)).await?;

    let result = result.lock().expect("mutex lock").clone();
    Ok(result)
}
