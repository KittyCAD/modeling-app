//! The wasm engine interface.

use std::sync::Arc;

use gloo_utils::format::JsValueSerdeExt;
use kcl_lib::ExecOutcome;
use kcl_lib::ExecutionCallbacks;
use kcl_lib::KclError;
use kcl_lib::KclErrorWithOutputs;
use kcl_lib::MockConfig;
use kcl_lib::OperationCallbackArgs;
use kcl_lib::Program;
use kcl_lib::ProjectManager;
use kcl_lib::front::FrontendState;
use kcl_lib::front::SceneGraphDelta;
use kcl_lib::wasm_engine::FileManager;
use wasm_bindgen::prelude::*;

pub(crate) const TRUE_BUG: &str = "This is a bug in KCL and not in your code, please report this to Zoo.";

#[wasm_bindgen]
extern "C" {
    #[derive(Debug, Clone)]
    pub type JsExecutionCallbacks;

    #[wasm_bindgen(method, js_name = onOperation)]
    fn on_operation(this: &JsExecutionCallbacks, args: JsValue);
}

impl ExecutionCallbacks for JsExecutionCallbacks {
    fn on_operation(&self, args: OperationCallbackArgs) {
        let js_args = match JsValue::from_serde(&args) {
            Ok(value) => value,
            Err(err) => {
                web_sys::console::error_1(&JsValue::from_str(&format!(
                    "Failed to serialize operation callback args: {err}"
                )));
                return;
            }
        };

        self.on_operation(js_args);
    }
}

#[wasm_bindgen]
pub struct Context {
    pub(crate) cache: kcl_lib::Cache,
    engine: Arc<kcl_lib::wasm_engine::EngineConnection>,
    response_context: Arc<kcl_lib::wasm_engine::ResponseContext>,
    fs: kcl_lib::FileSystemHandle,
    mock_engine: Arc<kcl_lib::wasm_engine::EngineConnection>,
    geometry_only: bool,
    execution_callbacks: Option<JsExecutionCallbacks>,
    pub(crate) project_manager: ProjectManager,
    pub(crate) frontend: Arc<tokio::sync::RwLock<FrontendState>>,
}

#[wasm_bindgen]
impl Context {
    #[wasm_bindgen(constructor)]
    pub fn new(
        engine_manager: kcl_lib::wasm_engine::EngineCommandManager,
        fs_manager: kcl_lib::wasm_engine::FileSystemManager,
        execution_callbacks: Option<JsExecutionCallbacks>,
        geometry_only: Option<bool>,
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
            cache: kcl_lib::Cache::default(),
            engine: Arc::new(kcl_lib::wasm_engine::EngineConnection::new_wasm_transport(
                engine_manager,
                response_context.clone(),
            )),
            fs: kcl_lib::new_file_system_handle(FileManager::new(fs_manager)),
            mock_engine: Arc::new(kcl_lib::wasm_engine::EngineConnection::new_mock()),
            geometry_only: geometry_only.unwrap_or_default(),
            execution_callbacks,
            response_context,
            project_manager: ProjectManager,
            frontend: Arc::new(tokio::sync::RwLock::new(FrontendState::new())),
        })
    }

    #[wasm_bindgen(js_name = cloneWithExecuteCallbacks)]
    pub fn clone_with_execute_callbacks(&self, execution_callbacks: JsExecutionCallbacks) -> Self {
        Self {
            cache: self.cache.clone(),
            engine: self.engine.clone(),
            response_context: self.response_context.clone(),
            fs: self.fs.clone(),
            mock_engine: self.mock_engine.clone(),
            geometry_only: self.geometry_only,
            execution_callbacks: Some(execution_callbacks),
            project_manager: self.project_manager.clone(),
            frontend: self.frontend.clone(),
        }
    }

    pub(crate) fn create_executor_ctx(
        &self,
        settings: &str,
        path: Option<String>,
        is_mock: bool,
    ) -> Result<kcl_lib::ExecutorContext, String> {
        let config: kcl_lib::Configuration = serde_json::from_str(settings).map_err(|e| e.to_string())?;
        let mut settings: kcl_lib::ExecutorSettings = config.into();
        if !is_mock {
            settings.geometry_only = self.geometry_only;
        }
        if let Some(path_src) = path {
            settings.with_current_file(kcl_lib::TypedPath::from(&path_src));
        }

        let mut ctx = if is_mock {
            kcl_lib::ExecutorContext::new_mock(self.mock_engine.clone(), self.fs.clone(), settings)
        } else {
            kcl_lib::ExecutorContext::new_with_engine_and_fs(self.engine.clone(), self.fs.clone(), settings)
        }
        .with_cache(self.cache.clone());

        ctx.execution_callbacks = self
            .execution_callbacks
            .clone()
            .map(|callbacks| Arc::new(callbacks) as Arc<dyn ExecutionCallbacks>);
        Ok(ctx)
    }

    /// Parse an execution entry point using Rust-owned scene/cache lifecycle.
    #[wasm_bindgen(js_name = parseForExecution)]
    pub async fn parse_for_execution(
        &self,
        source: &str,
        settings: &str,
        path: Option<String>,
    ) -> Result<JsValue, JsValue> {
        let ctx = self
            .create_executor_ctx(settings, path, false)
            .map_err(|error| JsValue::from_str(&error))?;
        // Use the same owner lock as execution so parsing another entry point
        // cannot clear a scene while its previous execution is publishing.
        let _owner = self.frontend.write().await;
        match ctx.parse_for_execution(source).await {
            Ok(parsed) => JsValue::from_serde(&parsed).map_err(|error| JsValue::from_str(&error.to_string())),
            Err(error) => Err(JsValue::from_serde(&error).map_err(|error| JsValue::from_str(&error.to_string()))?),
        }
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
    ) -> Result<SceneGraphDelta, KclErrorWithOutputs> {
        let program: Program = serde_json::from_str(program_ast_json).map_err(|e| {
            let err = KclError::internal(format!("Could not deserialize KCL AST. {TRUE_BUG} Details: {e}"));
            KclErrorWithOutputs::no_outputs(err)
        })?;
        let program = program.fill_node_paths();
        let ctx = self.create_executor_ctx(settings, path, false).map_err(|e| {
            KclErrorWithOutputs::no_outputs(KclError::internal(format!(
                "Could not create KCL executor context. {TRUE_BUG} Details: {e}"
            )))
        })?;

        let frontend = Arc::clone(&self.frontend);
        let mut guard = frontend.write().await;
        guard.engine_execute(&ctx, program).await
    }

    /// WARNING: NO ONE CAN CALL THIS FUNCTION WITHOUT FIRST ASKING @jessfraz.
    ///
    /// This manually discards the execution cache and resets the engine scene.
    /// Do not use it to work around file changes, settings changes, navigation,
    /// or stale results. Rust owns cache validity and dependency tracking. Fix
    /// incorrect invalidation in Rust and cover it with execution/I/O tests.
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
        let program = program.fill_node_paths();
        let ctx = self.create_executor_ctx(settings, path, true).map_err(|e| {
            KclErrorWithOutputs::no_outputs(KclError::internal(format!(
                "Could not create KCL executor context. {TRUE_BUG} Details: {e}"
            )))
        })?;
        let mock_config = MockConfig {
            use_prev_memory,
            ..Default::default()
        };
        ctx.run_mock(&program, &mock_config).await
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
