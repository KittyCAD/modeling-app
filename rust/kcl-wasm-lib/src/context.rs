//! The wasm engine interface.

use std::sync::Arc;

use gloo_utils::format::JsValueSerdeExt;
use kcl_lib::{wasm_engine::FileManager, EngineManager, Program};
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub struct Context {
    engine: Arc<Box<dyn EngineManager>>,
    fs: Arc<FileManager>,
    mock_engine: Arc<Box<dyn EngineManager>>,
}

#[wasm_bindgen]
impl Context {
    #[wasm_bindgen(constructor)]
    pub async fn new(
        engine_manager: kcl_lib::wasm_engine::EngineCommandManager,
        fs_manager: kcl_lib::wasm_engine::FileSystemManager,
    ) -> Result<Self, JsValue> {
        console_error_panic_hook::set_once();

        Ok(Self {
            engine: Arc::new(Box::new(
                kcl_lib::wasm_engine::EngineConnection::new(engine_manager)
                    .await
                    .map_err(|e| format!("{:?}", e))?,
            )),
            fs: Arc::new(FileManager::new(fs_manager)),
            mock_engine: Arc::new(Box::new(
                kcl_lib::mock_engine::EngineConnection::new()
                    .await
                    .map_err(|e| format!("{:?}", e))?,
            )),
        })
    }

    fn create_executor_ctx(
        &self,
        settings: &str,
        path: Option<String>,
        is_mock: bool,
    ) -> Result<kcl_lib::ExecutorContext, String> {
        let config: kcl_lib::Configuration = serde_json::from_str(settings).map_err(|e| e.to_string())?;
        let mut settings: kcl_lib::ExecutorSettings = config.into();
        if let Some(path) = path {
            settings.with_current_file(std::path::PathBuf::from(path));
        }

        if is_mock {
            return Ok(kcl_lib::ExecutorContext::new_mock(
                self.mock_engine.clone(),
                self.fs.clone(),
                settings.into(),
            ));
        }

        Ok(kcl_lib::ExecutorContext::new(
            self.engine.clone(),
            self.fs.clone(),
            settings,
        ))
    }

    /// Execute a program.
    #[wasm_bindgen]
    pub async fn execute(
        &self,
        program_ast_json: &str,
        path: Option<String>,
        settings: &str,
    ) -> Result<JsValue, String> {
        console_error_panic_hook::set_once();

        let program: Program = serde_json::from_str(program_ast_json).map_err(|e| e.to_string())?;

        let ctx = self.create_executor_ctx(settings, path, false)?;
        match ctx.run_with_caching(program).await {
            // The serde-wasm-bindgen does not work here because of weird HashMap issues.
            // DO NOT USE serde_wasm_bindgen::to_value it will break the frontend.
            Ok(outcome) => JsValue::from_serde(&outcome).map_err(|e| e.to_string()),
            Err(err) => Err(serde_json::to_string(&err).map_err(|serde_err| serde_err.to_string())?),
        }
    }

    /// Execute a program in mock mode.
    #[wasm_bindgen(js_name = executeMock)]
    pub async fn execute_mock(
        &self,
        program_ast_json: &str,
        path: Option<String>,
        settings: &str,
        use_prev_memory: bool,
    ) -> Result<JsValue, String> {
        console_error_panic_hook::set_once();

        let program: Program = serde_json::from_str(program_ast_json).map_err(|e| e.to_string())?;

        let ctx = self.create_executor_ctx(settings, path, true)?;
        match ctx.run_mock(program, use_prev_memory).await {
            // The serde-wasm-bindgen does not work here because of weird HashMap issues.
            // DO NOT USE serde_wasm_bindgen::to_value it will break the frontend.
            Ok(outcome) => JsValue::from_serde(&outcome).map_err(|e| e.to_string()),
            Err(err) => Err(serde_json::to_string(&err).map_err(|serde_err| serde_err.to_string())?),
        }
    }

    /// Export a scene to a file.
    #[wasm_bindgen]
    pub async fn export(&self, format_json: &str, settings: &str) -> Result<JsValue, String> {
        console_error_panic_hook::set_once();

        let format: kittycad_modeling_cmds::format::OutputFormat3d =
            serde_json::from_str(format_json).map_err(|e| e.to_string())?;

        let ctx = self.create_executor_ctx(settings, None, false)?;

        match ctx.export(format).await {
            // The serde-wasm-bindgen does not work here because of weird HashMap issues.
            // DO NOT USE serde_wasm_bindgen::to_value it will break the frontend.
            Ok(outcome) => JsValue::from_serde(&outcome).map_err(|e| e.to_string()),
            Err(err) => Err(serde_json::to_string(&err).map_err(|serde_err| serde_err.to_string())?),
        }
    }
}
