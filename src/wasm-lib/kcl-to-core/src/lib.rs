use anyhow::Result;
use kcl_lib::{ExecState, ExecutorContext};
use std::sync::{Arc, Mutex};

#[cfg(not(target_arch = "wasm32"))]
mod conn_mock_core;

///Converts the given kcl code to an engine test
pub async fn kcl_to_engine_core(code: &str) -> Result<String> {
    let program = kcl_lib::Program::parse(code)?;

    let result = Arc::new(Mutex::new("".into()));
    let ref_result = Arc::clone(&result);

    let ctx = ExecutorContext::new_forwarded_mock(Arc::new(Box::new(
        crate::conn_mock_core::EngineConnection::new(ref_result).await?,
    )));
    ctx.run(&program, &mut ExecState::default()).await?;

    let result = result.lock().expect("mutex lock").clone();
    Ok(result)
}
