use anyhow::Result;
use std::sync::{
    Arc, Mutex
};
use kcl_lib::{
    executor::{ExecutorContext, ExecutorSettings},
};

#[cfg(not(target_arch = "wasm32"))]
mod conn_mock_core;

///Converts the given kcl code to an engine test
pub async fn kcl_to_engine_core(code: &str) -> Result<String> {
    let tokens = kcl_lib::token::lexer(code)?;
    let parser = kcl_lib::parser::Parser::new(tokens);
    let program = parser.ast()?;

    let result = Arc::new(Mutex::new("".into()));
    let refResult = Arc::clone(&result);

    let ctx = ExecutorContext {
        engine: Arc::new(Box::new(crate::conn_mock_core::EngineConnection::new(refResult).await?)),
        fs: Arc::new(kcl_lib::fs::FileManager::new()),
        stdlib: Arc::new(kcl_lib::std::StdLib::new()),
        settings: Default::default(),
        is_mock: true,
    };
    let memory = ctx.run(&program, None).await?;

    println!("results!\n {}", result.lock().unwrap());

    Ok("".into())
}
