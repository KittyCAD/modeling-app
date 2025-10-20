//! The wasm engine interface.

use std::sync::Arc;

use gloo_utils::format::JsValueSerdeExt;
use kcl_lib::{
    front::{FrontendState, SketchApi},
    wasm_engine::FileManager,
    EngineManager, ExecOutcome, KclError, KclErrorWithOutputs, Program, ProjectManager,
};
use wasm_bindgen::prelude::*;

const TRUE_BUG: &str = "This is a bug in KCL and not in your code, please report this to Zoo.";

#[wasm_bindgen]
pub struct Context {
    engine: Arc<Box<dyn EngineManager>>,
    response_context: Arc<kcl_lib::wasm_engine::ResponseContext>,
    fs: Arc<FileManager>,
    mock_engine: Arc<Box<dyn EngineManager>>,
    pub(crate) project_manager: ProjectManager,
    frontend: Arc<tokio::sync::RwLock<FrontendState>>,
}

#[wasm_bindgen]
impl Context {
    #[wasm_bindgen(constructor)]
    pub fn new(
        engine_manager: kcl_lib::wasm_engine::EngineCommandManager,
        fs_manager: kcl_lib::wasm_engine::FileSystemManager,
    ) -> Result<Self, JsValue> {
        console_error_panic_hook::set_once();
        // Initialize the thread pool for rayon. For some reason, this wasn't
        // happening automatically. It may return an error if it was already
        // initialized, so ignore the result.
        let _ = rayon::ThreadPoolBuilder::new()
            .num_threads(1)
            .use_current_thread()
            .build_global();

        let response_context = Arc::new(kcl_lib::wasm_engine::ResponseContext::new());
        Ok(Self {
            engine: Arc::new(Box::new(
                kcl_lib::wasm_engine::EngineConnection::new(engine_manager, response_context.clone())
                    .map_err(|e| format!("{:?}", e))?,
            )),
            fs: Arc::new(FileManager::new(fs_manager)),
            mock_engine: Arc::new(Box::new(
                kcl_lib::mock_engine::EngineConnection::new().map_err(|e| format!("{:?}", e))?,
            )),
            response_context,
            project_manager: ProjectManager,
            frontend: Arc::new(tokio::sync::RwLock::new(FrontendState::new())),
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
        if let Some(path_src) = path {
            settings.with_current_file(kcl_lib::TypedPath::from(&path_src));
        }

        if is_mock {
            return Ok(kcl_lib::ExecutorContext::new_mock(
                self.mock_engine.clone(),
                self.fs.clone(),
                settings,
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
    ) -> Result<JsValue, JsValue> {
        console_error_panic_hook::set_once();

        self.execute_typed(program_ast_json, path, settings)
            .await
            .and_then(|outcome| {
                JsValue::from_serde(&outcome).map_err(|e| {
                    // The serde-wasm-bindgen does not work here because of weird HashMap issues.
                    // DO NOT USE serde_wasm_bindgen::to_value it will break the frontend.
                    KclErrorWithOutputs::no_outputs(KclError::internal(format!(
                        "Could not serialize successful KCL result. {TRUE_BUG} Details: {e}"
                    )))
                })
            })
            .map_err(|e: KclErrorWithOutputs| JsValue::from_serde(&e).unwrap())
    }

    async fn execute_typed(
        &self,
        program_ast_json: &str,
        path: Option<String>,
        settings: &str,
    ) -> Result<ExecOutcome, KclErrorWithOutputs> {
        let program: Program = serde_json::from_str(program_ast_json).map_err(|e| {
            let err = KclError::internal(format!("Could not deserialize KCL AST. {TRUE_BUG} Details: {e}"));
            KclErrorWithOutputs::no_outputs(err)
        })?;
        let ctx = self.create_executor_ctx(settings, path, false).map_err(|e| {
            KclErrorWithOutputs::no_outputs(KclError::internal(format!(
                "Could not create KCL executor context. {TRUE_BUG} Details: {e}"
            )))
        })?;
        ctx.run_with_caching(program).await
    }

    /// Reset the scene and bust the cache.
    /// ONLY use this if you absolutely need to reset the scene and bust the cache.
    #[wasm_bindgen(js_name = bustCacheAndResetScene)]
    pub async fn bust_cache_and_reset_scene(&self, settings: &str, path: Option<String>) -> Result<JsValue, String> {
        console_error_panic_hook::set_once();

        let ctx = self.create_executor_ctx(settings, path, false)?;
        match ctx.bust_cache_and_reset_scene().await {
            // The serde-wasm-bindgen does not work here because of weird HashMap issues.
            // DO NOT USE serde_wasm_bindgen::to_value it will break the frontend.
            Ok(outcome) => JsValue::from_serde(&outcome).map_err(|e| e.to_string()),
            Err(err) => Err(serde_json::to_string(&err).map_err(|serde_err| serde_err.to_string())?),
        }
    }

    /// Send a response to kcl lib's engine.
    #[wasm_bindgen(js_name = sendResponse)]
    pub async fn send_response(&self, data: js_sys::Uint8Array) {
        self.response_context.send_response(data).await
    }

    /// Execute a program in mock mode.
    #[wasm_bindgen(js_name = executeMock)]
    pub async fn execute_mock(
        &self,
        program_ast_json: &str,
        path: Option<String>,
        settings: &str,
        use_prev_memory: bool,
    ) -> Result<JsValue, JsValue> {
        console_error_panic_hook::set_once();

        self.execute_mock_typed(program_ast_json, path, settings, use_prev_memory)
            .await
            .and_then(|outcome| {
                JsValue::from_serde(&outcome).map_err(|e| {
                    // The serde-wasm-bindgen does not work here because of weird HashMap issues.
                    // DO NOT USE serde_wasm_bindgen::to_value it will break the frontend.
                    KclErrorWithOutputs::no_outputs(KclError::internal(format!(
                        "Could not serialize successful KCL result. {TRUE_BUG} Details: {e}"
                    )))
                })
            })
            .map_err(|e: KclErrorWithOutputs| JsValue::from_serde(&e).unwrap())
    }

    async fn execute_mock_typed(
        &self,
        program_ast_json: &str,
        path: Option<String>,
        settings: &str,
        use_prev_memory: bool,
    ) -> Result<ExecOutcome, KclErrorWithOutputs> {
        let program: Program = serde_json::from_str(program_ast_json).map_err(|e| {
            let err = KclError::internal(format!("Could not deserialize KCL AST. {TRUE_BUG} Details: {e}"));
            KclErrorWithOutputs::no_outputs(err)
        })?;
        let ctx = self.create_executor_ctx(settings, path, true).map_err(|e| {
            KclErrorWithOutputs::no_outputs(KclError::internal(format!(
                "Could not create KCL executor context. {TRUE_BUG} Details: {e}"
            )))
        })?;
        ctx.run_mock(&program, use_prev_memory).await
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

    /// Create new sketch and enter sketch mode.
    #[wasm_bindgen]
    pub async fn new_sketch(
        &self,
        project_json: &str,
        file_json: &str,
        version_json: &str,
        args_json: &str,
        settings: &str,
    ) -> Result<JsValue, JsValue> {
        console_error_panic_hook::set_once();

        let project: kcl_lib::front::ProjectId =
            serde_json::from_str(project_json).map_err(|e| format!("Could not deserialize ProjectId: {e}"))?;
        let file: kcl_lib::front::FileId =
            serde_json::from_str(file_json).map_err(|e| format!("Could not deserialize FileId: {e}"))?;
        let version: kcl_lib::front::Version =
            serde_json::from_str(version_json).map_err(|e| format!("Could not deserialize Version: {e}"))?;
        let args: kcl_lib::front::SketchArgs =
            serde_json::from_str(args_json).map_err(|e| format!("Could not deserialize SketchArgs: {e}"))?;

        let ctx = self
            .create_executor_ctx(settings, None, false)
            .map_err(|e| format!("Could not create KCL executor context for new sketch. {TRUE_BUG} Details: {e}"))?;

        let frontend = Arc::clone(&self.frontend);
        let mut guard = frontend.write().await;
        let result = guard
            .new_sketch(&ctx, project, file, version, args)
            .await
            .map_err(|e| format!("Failed to create new sketch: {:?}", e))?;

        Ok(JsValue::from_serde(&result)
            .map_err(|e| format!("Could not serialize new sketch result. {TRUE_BUG} Details: {e}"))?)
    }

    /// Exit sketch mode.
    #[wasm_bindgen]
    pub async fn exit_sketch(&self, version_json: &str, sketch_json: &str, settings: &str) -> Result<JsValue, JsValue> {
        console_error_panic_hook::set_once();

        let version: kcl_lib::front::Version =
            serde_json::from_str(version_json).map_err(|e| format!("Could not deserialize Version: {e}"))?;
        let sketch: kcl_lib::front::ObjectId =
            serde_json::from_str(sketch_json).map_err(|e| format!("Could not deserialize ObjectId: {e}"))?;

        let ctx = self
            .create_executor_ctx(settings, None, false)
            .map_err(|e| format!("Could not create KCL executor context for exit sketch. {TRUE_BUG} Details: {e}"))?;

        let frontend = Arc::clone(&self.frontend);
        let mut guard = frontend.write().await;
        let result = guard
            .exit_sketch(&ctx, version, sketch)
            .await
            .map_err(|e| format!("Failed to exit sketch: {:?}", e))?;

        Ok(JsValue::from_serde(&result)
            .map_err(|e| format!("Could not serialize exit sketch result. {TRUE_BUG} Details: {e}"))?)
    }

    /// Add segment to sketch.
    #[wasm_bindgen]
    pub async fn add_segment(
        &self,
        version_json: &str,
        sketch_json: &str,
        segment_json: &str,
        label_json: &str,
        settings: &str,
    ) -> Result<JsValue, JsValue> {
        console_error_panic_hook::set_once();

        let version: kcl_lib::front::Version =
            serde_json::from_str(version_json).map_err(|e| format!("Could not deserialize Version: {e}"))?;
        let sketch: kcl_lib::front::ObjectId =
            serde_json::from_str(sketch_json).map_err(|e| format!("Could not deserialize ObjectId: {e}"))?;
        let segment: kcl_lib::front::SegmentCtor =
            serde_json::from_str(segment_json).map_err(|e| format!("Could not deserialize SegmentCtor: {e}"))?;
        let label: Option<String> =
            serde_json::from_str(label_json).map_err(|e| format!("Could not deserialize label: {e}"))?;

        let ctx = self
            .create_executor_ctx(settings, None, false)
            .map_err(|e| format!("Could not create KCL executor context for add segment. {TRUE_BUG} Details: {e}"))?;

        let frontend = Arc::clone(&self.frontend);
        let mut guard = frontend.write().await;
        let result = guard
            .add_segment(&ctx, version, sketch, segment, label)
            .await
            .map_err(|e| format!("Failed to add segment to sketch: {:?}", e))?;

        Ok(JsValue::from_serde(&result)
            .map_err(|e| format!("Could not serialize add segment result. {TRUE_BUG} Details: {e}"))?)
    }

    /// Edit segment in sketch.
    #[wasm_bindgen]
    pub async fn edit_segment(
        &self,
        version_json: &str,
        sketch_json: &str,
        segment_id_json: &str,
        segment_json: &str,
        settings: &str,
    ) -> Result<JsValue, JsValue> {
        console_error_panic_hook::set_once();

        let version: kcl_lib::front::Version =
            serde_json::from_str(version_json).map_err(|e| format!("Could not deserialize Version: {e}"))?;
        let sketch: kcl_lib::front::ObjectId =
            serde_json::from_str(sketch_json).map_err(|e| format!("Could not deserialize sketch ObjectId: {e}"))?;
        let segment_id: kcl_lib::front::ObjectId = serde_json::from_str(segment_id_json)
            .map_err(|e| format!("Could not deserialize segment ObjectId: {e}"))?;
        let segment: kcl_lib::front::SegmentCtor =
            serde_json::from_str(segment_json).map_err(|e| format!("Could not deserialize SegmentCtor: {e}"))?;

        let ctx = self
            .create_executor_ctx(settings, None, false)
            .map_err(|e| format!("Could not create KCL executor context for edit segment. {TRUE_BUG} Details: {e}"))?;

        let frontend = Arc::clone(&self.frontend);
        let mut guard = frontend.write().await;
        let result = guard
            .edit_segment(&ctx, version, sketch, segment_id, segment)
            .await
            .map_err(|e| format!("Failed to edit segment in sketch: {:?}", e))?;

        Ok(JsValue::from_serde(&result)
            .map_err(|e| format!("Could not serialize edit segment result. {TRUE_BUG} Details: {e}"))?)
    }
}
