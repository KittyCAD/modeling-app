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
use crate::into_miette;
use crate::load_and_parse;
use crate::measure_model_properties;
use crate::new_context_state;
use crate::spawn_py;
use crate::take_snaps;
use crate::to_py_exception;

/// Created after executing a KCL project.
/// Lets you call follow-up methods, like exporting or snapshotting, without re-executing the KCL.
#[derive(Clone)]
#[pyo3_stub_gen::derive::gen_stub_pyclass]
#[pyclass(from_py_object)]
pub struct KclSession {
    executed_kcl: Arc<SessionState>,
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
    /// It is NOT safe to concurrently call methods on this object. Only call one of measure, export, etc at a time.
    #[pyo3(signature = (image_format, snapshot_options, *, zoom=true))]
    pub async fn snapshots(
        &self,
        image_format: ImageFormat,
        snapshot_options: Vec<SnapshotOptions>,
        zoom: bool,
    ) -> PyResult<Vec<Vec<u8>>> {
        let ctx = self.executed_kcl.context().await?;
        spawn_py(async move {
            let result = take_snaps(&ctx, image_format, snapshot_options, zoom).await;
            ctx.engine.take_responses().await;
            result
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
#[pyo3_stub_gen::derive::gen_stub_pyfunction]
#[gen_stub(override_return_type(type_repr = "KclSession"))]
#[pyfunction(signature = (path, *, mock=false, highlight_edges=None, video_res_width=None, video_res_height=None, api_call_id=None))]
pub async fn new_kcl_session(
    path: String,
    mock: bool,
    highlight_edges: Option<bool>,
    video_res_width: Option<u32>,
    video_res_height: Option<u32>,
    api_call_id: Option<String>,
) -> PyResult<KclSession> {
    let input = KclInput::Path(path);
    spawn_py(async move {
        new_kcl_session_impl(
            input,
            mock,
            highlight_edges,
            video_res_width,
            video_res_height,
            api_call_id,
        )
        .await
    })
    .await
}

/// Execute this KCL source code string.
/// Return an executed KCL project with its connection still available.
/// You can call follow-up methods, like exporting or snapshotting or measuring, on the returned session.
#[pyo3_stub_gen::derive::gen_stub_pyfunction]
#[gen_stub(override_return_type(type_repr = "KclSession"))]
#[pyfunction(signature = (code, *, mock=false, highlight_edges=None, video_res_width=None, video_res_height=None, api_call_id=None))]
pub async fn new_kcl_session_code(
    code: String,
    mock: bool,
    highlight_edges: Option<bool>,
    video_res_width: Option<u32>,
    video_res_height: Option<u32>,
    api_call_id: Option<String>,
) -> PyResult<KclSession> {
    let input = KclInput::Code(code);
    spawn_py(async move {
        new_kcl_session_impl(
            input,
            mock,
            highlight_edges,
            video_res_width,
            video_res_height,
            api_call_id,
        )
        .await
    })
    .await
}

/// Execute this KCL project.
/// Return an executed KCL project with its connection still available.
pub async fn new_kcl_session_impl(
    input: KclInput,
    mock: bool,
    highlight_edges: Option<bool>,
    video_res_width: Option<u32>,
    video_res_height: Option<u32>,
    api_call_id: Option<String>,
) -> PyResult<KclSession> {
    let KclProgram {
        code,
        program,
        path,
        filename,
    } = load_and_parse(input).await?;

    let (ctx, mut state) = new_context_state(
        path,
        mock,
        highlight_edges,
        false,
        video_res_width,
        video_res_height,
        program.language_version().map_err(to_py_exception)?,
        api_call_id,
    )
    .await
    .map_err(to_py_exception)?;
    let env_ref = match ctx.run(&program, &mut state).await {
        Ok((env_ref, _modeling_session_data)) => env_ref,
        Err(err) => {
            ctx.close().await;
            return Err(into_miette(err, &filename, &code));
        }
    };
    let outcome = match state.into_exec_outcome(env_ref, &ctx).await {
        Ok(inner) => ExecOutcome {
            inner: Arc::new(inner),
            code: code.into(),
            filename: filename.into(),
        },
        Err(err) => {
            ctx.close().await;
            return Err(to_py_exception(err));
        }
    };
    let executed_kcl = Arc::new(SessionState {
        ctx: Mutex::new(Some(ctx)),
        program,
        outcome,
    });
    Ok(KclSession { executed_kcl })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn follow_up_error_drains_responses_and_close_releases_context() {
        let mut session = new_kcl_session_impl(
            KclInput::Code("@settings(kclVersion = 2.0)\nvalue = 1".to_owned()),
            true,
            None,
            None,
            None,
            None,
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
}
