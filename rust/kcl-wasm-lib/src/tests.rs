//! Helper for starting a connection.

use std::env;

use kcl_lib::{
    wasm_engine::{EngineCommandManager, FileSystemManager},
    Program,
};
use pretty_assertions::assert_eq;
use wasm_bindgen::prelude::*;
use wasm_bindgen_test::*;

#[wasm_bindgen]
pub async fn get_connection() -> Result<EngineCommandManager, JsValue> {
    let token = if let Ok(token) = env::var("KITTYCAD_API_TOKEN") {
        token
    } else if let Ok(token) = env::var("ZOO_API_TOKEN") {
        token
    } else {
        return Err("must set KITTYCAD_API_TOKEN or ZOO_API_TOKEN".into());
    };

    let mgr = EngineCommandManager::new();
    // TODO: we should probably allow for setting the host as well.
    mgr.start_from_wasm(&token).await?;

    // Return the JS object so the test can poke at it.
    Ok(mgr)
}

#[wasm_bindgen]
pub async fn execute_code(code: &str) -> Result<JsValue, JsValue> {
    let mgr = get_connection().await?;

    let program = Program::parse_no_errs(code).map_err(String::from)?;

    let ctx = crate::context::Context::new(mgr, FileSystemManager::new()).await?;

    let result = ctx
        .execute(&serde_json::to_string(&program).map_err(|e| e.to_string())?, None, "")
        .await?;

    Ok(result)
}

wasm_bindgen_test_configure!(run_in_browser);

#[wasm_bindgen_test]
async fn wasm_basic_execution_single_file() {
    let code = include_str!("../../../public/kcl-samples/gear/main.kcl");

    let result = execute_code(code).await.unwrap();

    assert_eq!(result, JsValue::from_str(""));
}
