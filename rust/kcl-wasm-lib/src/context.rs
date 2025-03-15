//! The wasm engine interface.

use std::sync::Arc;

use gloo_utils::format::JsValueSerdeExt;
use kcl_lib::{bust_cache, clear_mem_cache, exec::IdGenerator, wasm_engine::FileManager, EngineManager, Program};
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub struct Context {
    engine: Arc<Box<dyn EngineManager>>,
    fs: Arc<FileManager>,
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
        })
    }

    /// Clear the scene and bust the cache.
    pub async fn clear_scene_and_bust_cache(&self) -> Result<(), JsValue> {
        console_error_panic_hook::set_once();

        bust_cache().await;
        clear_mem_cache().await;

        let mut id_generator = IdGenerator::new(Default::default());
        self.engine
            .clear_scene(&mut id_generator, Default::default())
            .await
            .map_err(|e| e.to_string())?;

        Ok(())
    }

    fn create_executor_ctx(&self, settings: &str, path: Option<String>) -> Result<kcl_lib::ExecutorContext, String> {
        let config: kcl_lib::Configuration = serde_json::from_str(settings).map_err(|e| e.to_string())?;
        let mut settings: kcl_lib::ExecutorSettings = config.into();
        if let Some(path) = path {
            settings.with_current_file(std::path::PathBuf::from(path));
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

        let ctx = self.create_executor_ctx(settings, path)?;
        match ctx.run_with_caching(program).await {
            // The serde-wasm-bindgen does not work here because of weird HashMap issues.
            // DO NOT USE serde_wasm_bindgen::to_value it will break the frontend.
            Ok(outcome) => JsValue::from_serde(&outcome).map_err(|e| e.to_string()),
            Err(err) => Err(serde_json::to_string(&err).map_err(|serde_err| serde_err.to_string())?),
        }
    }
}
