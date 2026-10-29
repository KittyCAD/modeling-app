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
    engine_manager: kcl_lib::wasm_engine::EngineCommandManager,
    pub(crate) cache: kcl_lib::Cache,
    executor: kcl_lib::ExecutorContext,
    mock_executor: kcl_lib::ExecutorContext,
    response_context: Arc<kcl_lib::wasm_engine::ResponseContext>,
    pub(crate) project_manager: ProjectManager,
    pub(crate) frontend: Arc<tokio::sync::RwLock<FrontendState>>,
}

pub(crate) enum ExecutionMode {
    Engine,
    Mock,
}

#[wasm_bindgen]
impl Context {
    #[wasm_bindgen(constructor)]
    pub fn new(
        engine_manager: kcl_lib::wasm_engine::EngineCommandManager,
        fs_manager: kcl_lib::wasm_engine::FileSystemManager,
        execution_callbacks: Option<JsExecutionCallbacks>,
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
        let cache = kcl_lib::Cache::default();
        let engine = Arc::new(kcl_lib::wasm_engine::EngineConnection::new_wasm_transport(
            engine_manager.clone(),
            response_context.clone(),
        ));
        let fs = kcl_lib::new_file_system_handle(FileManager::new(fs_manager));
        let mut executor = kcl_lib::ExecutorContext::new_with_engine_and_fs(engine, fs.clone(), Default::default())
            .with_cache(cache.clone());
        executor.execution_callbacks =
            execution_callbacks.map(|callbacks| Arc::new(callbacks) as Arc<dyn ExecutionCallbacks>);
        let mut mock_executor = kcl_lib::ExecutorContext::new_mock(
            Arc::new(kcl_lib::wasm_engine::EngineConnection::new_mock()),
            fs,
            Default::default(),
        )
        .with_cache(cache.clone());
        mock_executor.execution_callbacks = executor.execution_callbacks.clone();
        Ok(Self {
            engine_manager,
            cache,
            executor,
            mock_executor,
            response_context,
            project_manager: ProjectManager::default(),
            frontend: Arc::new(tokio::sync::RwLock::new(FrontendState::new())),
        })
    }

    #[wasm_bindgen(js_name = cloneWithExecuteCallbacks)]
    pub fn clone_with_execute_callbacks(&self, execution_callbacks: JsExecutionCallbacks) -> Self {
        let callbacks = Some(Arc::new(execution_callbacks) as Arc<dyn ExecutionCallbacks>);
        let mut executor = self.executor.clone();
        executor.execution_callbacks = callbacks.clone();
        let mut mock_executor = self.mock_executor.clone();
        mock_executor.execution_callbacks = callbacks;
        Self {
            engine_manager: self.engine_manager.clone(),
            cache: self.cache.clone(),
            executor,
            mock_executor,
            response_context: self.response_context.clone(),
            project_manager: self.project_manager.clone(),
            frontend: self.frontend.clone(),
        }
    }

    /// Borrow this runtime's execution resources while holding its frontend owner.
    /// An optional JS path is only an assertion against the registered active file,
    /// never permission to select another cache owner or create an anonymous one.
    pub(crate) async fn executor_for_operation(
        &self,
        settings: &str,
        requested_path: Option<&str>,
        mode: ExecutionMode,
    ) -> Result<
        (
            tokio::sync::RwLockWriteGuard<'_, FrontendState>,
            kcl_lib::ExecutorContext,
        ),
        KclErrorWithOutputs,
    > {
        let owner = self.frontend.write().await;
        let resolved: Result<_, String> = async {
            let file = self
                .project_manager
                .execution_file(requested_path)
                .await
                .map_err(|error| error.msg)?;
            let config: kcl_lib::Configuration = serde_json::from_str(settings).map_err(|error| error.to_string())?;
            Ok((file, config))
        }
        .await;
        let (file, config) = match resolved {
            Ok(resolved) => resolved,
            Err(message) => {
                return Err(KclErrorWithOutputs {
                    default_planes: self.executor.engine.get_default_planes().read().await.clone(),
                    ..KclErrorWithOutputs::no_outputs(KclError::internal(message))
                });
            }
        };
        let mut settings: kcl_lib::ExecutorSettings = config.into();
        let mut ctx = match mode {
            ExecutionMode::Engine => {
                // The mode can change on reconnect, so read it from the live connection.
                settings.geometry_only = self.engine_manager.geometry_only();
                self.executor.clone()
            }
            ExecutionMode::Mock => self.mock_executor.clone(),
        };
        settings.enable_ssao &= !settings.geometry_only;
        if let Some(file) = file {
            settings.with_current_file(file);
        }
        ctx.settings = settings;
        Ok((owner, ctx))
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
        let (mut guard, ctx) = self
            .executor_for_operation(settings, path.as_deref(), ExecutionMode::Engine)
            .await?;

        guard.engine_execute(&ctx, program).await
    }

    /// Reset the scene and bust the cache.
    /// ONLY use this if you absolutely need to reset the scene and bust the cache.
    #[wasm_bindgen(js_name = bustCacheAndResetScene)]
    pub async fn bust_cache_and_reset_scene(&self, settings: &str, path: Option<String>) -> Result<JsValue, String> {
        console_error_panic_hook::set_once();

        let (_owner, ctx) = self
            .executor_for_operation(settings, path.as_deref(), ExecutionMode::Engine)
            .await
            .map_err(|error| error.error.to_string())?;
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
        let (_owner, ctx) = self
            .executor_for_operation(settings, path.as_deref(), ExecutionMode::Mock)
            .await?;
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

        let (_owner, ctx) = self
            .executor_for_operation(settings, None, ExecutionMode::Engine)
            .await
            .map_err(|error| error.error.to_string())?;

        match ctx.export(format).await {
            // The serde-wasm-bindgen does not work here because of weird HashMap issues.
            // DO NOT USE serde_wasm_bindgen::to_value it will break the frontend.
            Ok(outcome) => JsValue::from_serde(&outcome).map_err(|e| e.to_string()),
            Err(err) => Err(serde_json::to_string(&err).map_err(|serde_err| serde_err.to_string())?),
        }
    }
}
