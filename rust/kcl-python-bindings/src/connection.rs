//! Offers methods to execute KCL, then keep the connection alive so you can
//! execute follow-up methods, like exporting or snapshotting, without re-executing the KCL.
use std::sync::Arc;

use kittycad_modeling_cmds::ImageFormat;
use kittycad_modeling_cmds::shared::FileExportFormat;
use kittycad_modeling_cmds::websocket::RawFile;
use pyo3::Py;
use pyo3::PyResult;
use pyo3::Python;
use pyo3::exceptions::PyException;
use pyo3::pyclass;
use pyo3::pyfunction;
use pyo3::pymethods;
use pyo3::types::PyAny;
use tokio::sync::Mutex;

use crate::ExecOutcome;
use crate::KclInput;
use crate::KclProgram;
use crate::SnapshotOptions;
use crate::bridge::physical_properties::PhysicalPropertiesRequest;
use crate::bridge::physical_properties::PhysicalPropertiesResponse;
use crate::bridge::sketch_constraints::SketchConstraintReport;
use crate::into_miette_for_parse;
use crate::into_rich_error;
use crate::load_and_parse;
use crate::measure_model_properties;
use crate::new_context_state;
use crate::spawn_py;
use crate::spawn_snapshot_task;
use crate::take_snaps;
use crate::to_py_exception;

/// Created after executing a KCL project.
/// Lets you call follow-up methods, like exporting or snapshotting, without re-executing the KCL.
#[derive(Clone)]
#[pyo3_stub_gen::derive::gen_stub_pyclass]
#[pyclass(from_py_object)]
pub struct KclSession {
    geometry_only: bool,
    executed_kcl: Arc<SessionState>,
    api_call_id: Option<String>,
    websocket_upgrade_request_id: Option<String>,
}

struct SessionState {
    ctx: Mutex<Option<kcl_lib::ExecutorContext>>,
    program: kcl_lib::Program,
    outcome: ExecOutcome,
}

impl SessionState {
    async fn context(&self) -> PyResult<kcl_lib::ExecutorContext> {
        self.ctx
            .lock()
            .await
            .clone()
            .ok_or_else(|| PyException::new_err("Connection already closed"))
    }
}

impl std::fmt::Debug for KclSession {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Connection")
            .field("executed_kcl.filename", &self.executed_kcl.outcome.filename)
            .finish()
    }
}

#[pyo3_stub_gen::derive::gen_stub_pymethods]
#[pymethods]
impl KclSession {
    /// Saved diagnostics, constraint reports, and sketch rendering from this execution.
    /// Available after close(); accessing it neither re-executes KCL nor copies the execution state.
    #[getter]
    #[gen_stub(override_return_type(type_repr = "ExecOutcome"))]
    fn outcome(&self) -> ExecOutcome {
        self.executed_kcl.outcome.clone()
    }

    /// Engine API call ID for correlating this modeling session with engine logs.
    #[getter]
    fn api_call_id(&self) -> Option<String> {
        self.api_call_id.clone()
    }

    /// Request ID for the HTTP request that upgraded to this engine WebSocket.
    #[getter]
    fn websocket_upgrade_request_id(&self) -> Option<String> {
        self.websocket_upgrade_request_id.clone()
    }

    // This is for entering a Python 'async with' context.
    // See <https://docs.python.org/3/reference/datamodel.html#object.__aenter__>
    /// Enter this session without executing KCL again.
    #[gen_stub(override_return_type(type_repr = "KclSession"))]
    async fn __aenter__(slf: Py<Self>) -> PyResult<Py<Self>> {
        // Get the context, so that we can check it's still there and hasn't been closed/taken yet.
        Python::attach(|py| -> PyResult<_> { Ok(slf.try_borrow(py)?.executed_kcl.clone()) })?
            .context()
            .await?;
        Ok(slf)
    }

    // This is for exiting a Python 'async with' context.
    // See <https://docs.python.org/3/reference/datamodel.html#object.__aexit__>
    /// Close the session, including when the context body raises an exception.
    #[pyo3(signature = (exc_type, exc_value, traceback))]
    async fn __aexit__(
        &mut self,
        #[gen_stub(override_type(type_repr = "builtins.type[builtins.BaseException] | None"))] exc_type: Option<
            Py<PyAny>,
        >,
        #[gen_stub(override_type(type_repr = "builtins.BaseException | None"))] exc_value: Option<Py<PyAny>>,
        #[gen_stub(override_type(type_repr = "types.TracebackType | None", imports = ("types")))] traceback: Option<
            Py<PyAny>,
        >,
    ) -> PyResult<()> {
        let _ = (exc_type, exc_value, traceback);
        self.close().await
    }

    /// After calling this, calling any methods that use the connection will raise an exception.
    pub async fn close(&mut self) -> PyResult<()> {
        let Some(ctx) = self.executed_kcl.ctx.lock().await.take() else {
            return Ok(());
        };
        spawn_py(async move {
            ctx.close().await;
            Ok(())
        })
        .await
    }

    /// Measure the active model's physical properties.
    /// Supports choosing any of the available properties, like volume, mass, bounding box, or any combination of them.
    /// It is NOT safe to concurrently call methods on this object. Only call one of measure, export, etc at a time.
    pub async fn measure(&self, request: PhysicalPropertiesRequest) -> PyResult<PhysicalPropertiesResponse> {
        let ctx = self.executed_kcl.context().await?;
        spawn_py(async move {
            let result = measure_model_properties(&ctx, request).await;
            ctx.engine.take_responses().await;
            result
        })
        .await
    }

    /// Analyze the executed sketches and report their constraint status and execution issues.
    /// Uses the saved execution state without executing KCL again.
    /// It is NOT safe to concurrently call methods on this object. Only call one of measure, export, etc at a time.
    pub async fn sketch_constraint_report(&self) -> PyResult<SketchConstraintReport> {
        self.executed_kcl.context().await?;
        let outcome = self.outcome();
        spawn_py(async move { Ok(outcome.sketch_constraint_report()) }).await
    }

    /// Get 2D images of the model.
    /// CPU-only sessions temporarily enable graphics for the entire batch.
    /// If Python cancels, the batch and cleanup finish before the session can be reused.
    /// If graphics cannot be disabled, the session is closed.
    /// It is NOT safe to concurrently call methods on this object. Only call one of measure, export, etc at a time.
    #[pyo3(signature = (image_format, snapshot_options, *, zoom=true))]
    pub async fn snapshots(
        &self,
        image_format: ImageFormat,
        snapshot_options: Vec<SnapshotOptions>,
        zoom: bool,
    ) -> PyResult<Vec<Vec<u8>>> {
        let executed_kcl = self.executed_kcl.clone();
        let geometry_only = self.geometry_only;
        spawn_snapshot_task(async move {
            // Keep the context locked through cleanup, including after Python
            // cancellation, so follow-up calls and close() wait for it.
            let mut context = executed_kcl.ctx.lock().await;
            let ctx = context
                .as_ref()
                .ok_or_else(|| PyException::new_err("Connection already closed"))?;
            let result = take_snaps(ctx, image_format, snapshot_options, zoom, geometry_only).await;
            ctx.engine.take_responses().await;
            match result {
                Ok(images) => Ok(images),
                Err(error) => {
                    if error.graphics_cleanup_failed
                        && let Some(ctx) = context.take()
                    {
                        ctx.close().await;
                    }
                    Err(error.exception)
                }
            }
        })
        .await
    }

    /// Get 3D files containing this model.
    /// It is NOT safe to concurrently call methods on this object. Only call one of measure, export, etc at a time.
    pub async fn export(&self, export_format: FileExportFormat) -> PyResult<Vec<RawFile>> {
        let executed_kcl = self.executed_kcl.clone();
        let ctx = executed_kcl.context().await?;
        spawn_py(async move {
            let result = crate::export_from_executed(
                &ctx,
                &executed_kcl.program,
                &executed_kcl.outcome.code,
                &executed_kcl.outcome.filename,
                export_format,
            )
            .await;
            ctx.engine.take_responses().await;
            result
        })
        .await
    }
}

/// Execute this KCL project.
/// Return an executed KCL project with its connection still available.
/// You can call follow-up methods, like exporting or snapshotting or measuring, on the returned session.
/// `geometry_only` uses the CPU engine pool without initializing rendering.
/// `token` and `base_url` override the client environment settings for this session.
/// Omitted values retain the client's existing environment defaults.
#[pyo3_stub_gen::derive::gen_stub_pyfunction]
#[gen_stub(override_return_type(type_repr = "KclSession"))]
#[pyfunction(signature = (path, *, mock=false, geometry_only=false, highlight_edges=None, video_res_width=None, video_res_height=None, token=None, base_url=None))]
#[allow(clippy::too_many_arguments)] // Independent Python keyword options.
pub async fn new_kcl_session(
    path: String,
    mock: bool,
    geometry_only: bool,
    highlight_edges: Option<bool>,
    video_res_width: Option<u32>,
    video_res_height: Option<u32>,
    token: Option<String>,
    base_url: Option<String>,
) -> PyResult<KclSession> {
    let input = KclInput::Path(path);
    spawn_py(async move {
        new_kcl_session_impl(
            input,
            crate::ContextParams {
                mock,
                geometry_only,
                highlight_edges,
                video_res_width,
                video_res_height,
                token,
                base_url,
                ..Default::default()
            },
        )
        .await
    })
    .await
}

/// Execute this KCL source code string.
/// Return an executed KCL project with its connection still available.
/// You can call follow-up methods, like exporting or snapshotting or measuring, on the returned session.
/// `geometry_only` uses the CPU engine pool without initializing rendering.
/// `token` and `base_url` override the client environment settings for this session.
/// Omitted values retain the client's existing environment defaults.
#[pyo3_stub_gen::derive::gen_stub_pyfunction]
#[gen_stub(override_return_type(type_repr = "KclSession"))]
#[pyfunction(signature = (code, *, mock=false, geometry_only=false, highlight_edges=None, video_res_width=None, video_res_height=None, token=None, base_url=None))]
#[allow(clippy::too_many_arguments)] // Independent Python keyword options.
pub async fn new_kcl_session_code(
    code: String,
    mock: bool,
    geometry_only: bool,
    highlight_edges: Option<bool>,
    video_res_width: Option<u32>,
    video_res_height: Option<u32>,
    token: Option<String>,
    base_url: Option<String>,
) -> PyResult<KclSession> {
    let input = KclInput::Code(code);
    spawn_py(async move {
        new_kcl_session_impl(
            input,
            crate::ContextParams {
                mock,
                geometry_only,
                highlight_edges,
                video_res_width,
                video_res_height,
                token,
                base_url,
                ..Default::default()
            },
        )
        .await
    })
    .await
}

/// Execute this KCL project.
/// Return an executed KCL project with its connection still available.
async fn new_kcl_session_impl(input: KclInput, mut params: crate::ContextParams) -> PyResult<KclSession> {
    // I/O or parse failures should raise an exception.
    // There's no more useful data to include.
    // So it's fine to use ? here.
    let KclProgram {
        code,
        program,
        path,
        filename,
    } = load_and_parse(input).await?;
    params.current_file = path;

    let geometry_only = params.geometry_only;

    // Connect to the engine.
    // If you can't even connect to the engine, just raise an exception.
    // So it's fine to use ? here.
    let (ctx, mut state) = new_context_state(
        program
            .language_version()
            .map_err(|err| into_miette_for_parse(&filename, &code, err))?,
        params,
    )
    .await
    .map_err(to_py_exception)?;

    // Failures here should keep the execution outcome, so that users can still
    // call sketch report or sketch debug visualization.
    let (env_ref, modeling_session_data) = match ctx.run(&program, &mut state).await {
        Ok(result) => result,
        Err(err) => {
            ctx.close().await;
            return Err(into_rich_error(err, &filename, &code));
        }
    };
    let api_call_id = modeling_session_data.map(|session| session.api_call_id);
    let websocket_upgrade_request_id = ctx.engine.websocket_upgrade_request_id().map(str::to_owned);

    let outcome = match state.into_exec_outcome(env_ref, &ctx).await {
        Ok(inner) => ExecOutcome {
            inner: Arc::new(inner),
            code: code.into(),
            filename: filename.into(),
        },
        // This error case only occurs when there's an internal error inside KCL's memory implementation.
        // Ideally this would still return a rich error, however, ZK is very unlikely to hit this.
        // If we hit it, we should upgrade this. Or make KCL's memory infallible.
        Err(err) => {
            ctx.close().await;
            return Err(to_py_exception(err));
        }
    };

    // Execution succeeded, return the data.
    let executed_kcl = Arc::new(SessionState {
        ctx: Mutex::new(Some(ctx)),
        program,
        outcome,
    });
    Ok(KclSession {
        executed_kcl,
        api_call_id,
        websocket_upgrade_request_id,
        geometry_only,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn follow_up_error_drains_responses_and_close_releases_context() {
        let mut session = new_kcl_session_impl(
            KclInput::Code("@settings(kclVersion = 2.0)\nvalue = 1".to_owned()),
            crate::ContextParams {
                mock: true,
                ..Default::default()
            },
        )
        .await
        .unwrap();

        session.snapshots(ImageFormat::Png, Vec::new(), true).await.unwrap_err();
        let ctx = session.executed_kcl.context().await.unwrap();
        assert!(ctx.engine.take_responses().await.is_empty());

        session.close().await.unwrap();
        session.executed_kcl.context().await.unwrap_err();
        assert!(session.outcome().report_all().is_empty());
    }

    #[tokio::test]
    async fn snapshot_cancellation_finishes_batch_before_session_reuse() {
        use std::time::Duration;

        use crate::snapshot_tests::SnapshotTransport;

        for cancelled_at in ["enable", "camera", "snapshot", "disable"] {
            let mut session = new_kcl_session_impl(
                KclInput::Code("@settings(kclVersion = 2.0)\nvalue = 1".to_owned()),
                crate::ContextParams {
                    mock: true,
                    geometry_only: true,
                    ..Default::default()
                },
            )
            .await
            .unwrap();
            let (mut transport, mut started) = SnapshotTransport::new();
            Arc::get_mut(&mut transport).unwrap().block = vec![cancelled_at];
            session.executed_kcl.ctx.lock().await.as_mut().unwrap().engine = transport.engine();

            let snapshot_session = session.clone();
            let caller = tokio::spawn(async move {
                snapshot_session
                    .snapshots(ImageFormat::Png, vec![SnapshotOptions::isometric_view(0.1); 2], true)
                    .await
            });
            assert_eq!(started.recv().await, Some(cancelled_at));
            caller.abort();
            assert!(caller.await.unwrap_err().is_cancelled());
            let state = session.executed_kcl.clone();
            let mut follow_up = tokio::spawn(async move { state.context().await });
            tokio::time::timeout(Duration::from_millis(20), &mut follow_up)
                .await
                .expect_err("session reused before graphics cleanup finished");
            // Release both snapshots' camera/snapshot commands if needed.
            transport.resume.add_permits(2);
            tokio::time::timeout(Duration::from_secs(1), follow_up)
                .await
                .unwrap()
                .unwrap()
                .unwrap();
            assert_eq!(transport.stages().last(), Some(&"disable"));
            assert_eq!(transport.stages().iter().filter(|&&s| s == "snapshot").count(), 2);
            let ctx = session.executed_kcl.context().await.unwrap();
            assert!(ctx.engine.take_responses().await.is_empty());
            session.close().await.unwrap();
        }
    }

    #[tokio::test]
    async fn failed_graphics_cleanup_closes_session_even_after_cancellation() {
        use crate::snapshot_tests::SnapshotTransport;

        for cancel in [false, true] {
            let session = new_kcl_session_impl(
                KclInput::Code("@settings(kclVersion = 2.0)\nvalue = 1".to_owned()),
                crate::ContextParams {
                    mock: true,
                    geometry_only: true,
                    ..Default::default()
                },
            )
            .await
            .unwrap();
            let (mut transport, mut started) = SnapshotTransport::new();
            let config = Arc::get_mut(&mut transport).unwrap();
            config.fail.push("disable");
            if cancel {
                config.block.push("snapshot");
            }
            session.executed_kcl.ctx.lock().await.as_mut().unwrap().engine = transport.engine();
            let snapshot_session = session.clone();
            let caller =
                tokio::spawn(async move { snapshot_session.snapshots(ImageFormat::Png, Vec::new(), true).await });
            if cancel {
                assert_eq!(started.recv().await, Some("snapshot"));
                caller.abort();
                assert!(caller.await.unwrap_err().is_cancelled());
                transport.resume.add_permits(1);
            } else {
                assert!(caller.await.unwrap().unwrap_err().to_string().contains("disable"));
            }
            let error = session.executed_kcl.context().await.unwrap_err();
            assert!(error.to_string().contains("Connection already closed"));
        }
    }
}
