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

use crate::ExecOutcome;
use crate::ExecutedKcl;
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
    executed_kcl: Arc<ExecutedKcl>,
    is_closed: bool,
}

impl std::fmt::Debug for KclSession {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Connection")
            .field("executed_kcl.filename", &self.executed_kcl.filename)
            .field("is_closed", &self.is_closed)
            .finish()
    }
}

#[pyo3_stub_gen::derive::gen_stub_pymethods]
#[pymethods]
impl KclSession {
    // This is for entering a Python 'async with' context.
    // See <https://docs.python.org/3/reference/datamodel.html#object.__aenter__>
    /// Enter this session without executing KCL again.
    #[gen_stub(override_return_type(type_repr = "KclSession"))]
    async fn __aenter__(slf: Py<Self>) -> PyResult<Py<Self>> {
        Python::attach(|py| {
            if slf.try_borrow(py)?.is_closed {
                return Err(PyException::new_err("Connection already closed"));
            }
            Ok(slf)
        })
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
        if self.is_closed {
            return Ok(());
        }
        let executed_kcl = self.executed_kcl.clone();
        spawn_py(async move {
            executed_kcl.ctx.close().await;
            Ok(())
        })
        .await?;
        self.is_closed = true;
        Ok(())
    }

    /// Measure the active model's physical properties.
    /// Supports choosing any of the available properties, like volume, mass, bounding box, or any combination of them.
    /// It is NOT safe to concurrently call methods on this object. Only call one of measure, export, etc at a time.
    pub async fn measure(&self, request: PhysicalPropertiesRequest) -> PyResult<PhysicalPropertiesResponse> {
        if self.is_closed {
            return Err(PyException::new_err("Connection already closed"));
        }
        let executed_kcl = self.executed_kcl.clone();
        spawn_py(async move { measure_model_properties(&executed_kcl.ctx, request).await }).await
    }

    /// Analyze the executed sketches and report their constraint status and execution issues.
    /// Uses the saved execution state without executing KCL again.
    /// It is NOT safe to concurrently call methods on this object. Only call one of measure, export, etc at a time.
    pub async fn sketch_constraint_report(&self) -> PyResult<SketchConstraintReport> {
        if self.is_closed {
            return Err(PyException::new_err("Connection already closed"));
        }
        let executed_kcl = self.executed_kcl.clone();
        spawn_py(async move {
            let inner = executed_kcl
                .state
                .clone()
                .into_exec_outcome(executed_kcl.env_ref, &executed_kcl.ctx)
                .await
                .map_err(to_py_exception)?;
            Ok(ExecOutcome {
                inner,
                code: executed_kcl.code.clone(),
                filename: executed_kcl.filename.clone(),
            }
            .sketch_constraint_report())
        })
        .await
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
        if self.is_closed {
            return Err(PyException::new_err("Connection already closed"));
        }
        let executed_kcl = self.executed_kcl.clone();
        spawn_py(async move { take_snaps(&executed_kcl.ctx, image_format, snapshot_options, zoom).await }).await
    }

    /// Get 3D files containing this model.
    /// It is NOT safe to concurrently call methods on this object. Only call one of measure, export, etc at a time.
    pub async fn export(&self, export_format: FileExportFormat) -> PyResult<Vec<RawFile>> {
        if self.is_closed {
            return Err(PyException::new_err("Connection already closed"));
        }
        let executed_kcl = self.executed_kcl.clone();
        spawn_py(async move {
            crate::export_from_executed(
                &executed_kcl.ctx,
                &executed_kcl.program,
                &executed_kcl.code,
                &executed_kcl.filename,
                export_format,
            )
            .await
        })
        .await
    }
}

/// Execute this KCL project.
/// Return an executed KCL project with its connection still available.
/// You can call follow-up methods, like exporting or snapshotting or measuring, on the returned session.
#[pyo3_stub_gen::derive::gen_stub_pyfunction]
#[gen_stub(override_return_type(type_repr = "KclSession"))]
#[pyfunction(signature = (path, *, mock=false, highlight_edges=None))]
pub async fn new_kcl_session(path: String, mock: bool, highlight_edges: Option<bool>) -> PyResult<KclSession> {
    let input = KclInput::Path(path);
    spawn_py(async move { new_kcl_session_impl(input, mock, highlight_edges).await }).await
}

/// Execute this KCL source code string.
/// Return an executed KCL project with its connection still available.
/// You can call follow-up methods, like exporting or snapshotting or measuring, on the returned session.
#[pyo3_stub_gen::derive::gen_stub_pyfunction]
#[gen_stub(override_return_type(type_repr = "KclSession"))]
#[pyfunction(signature = (code, *, mock=false, highlight_edges=None))]
pub async fn new_kcl_session_code(code: String, mock: bool, highlight_edges: Option<bool>) -> PyResult<KclSession> {
    let input = KclInput::Code(code);
    spawn_py(async move { new_kcl_session_impl(input, mock, highlight_edges).await }).await
}

/// Execute this KCL project.
/// Return an executed KCL project with its connection still available.
pub async fn new_kcl_session_impl(input: KclInput, mock: bool, highlight_edges: Option<bool>) -> PyResult<KclSession> {
    let KclProgram {
        code,
        program,
        path,
        filename,
    } = load_and_parse(input).await?;

    let (ctx, mut state) = new_context_state(path, mock, highlight_edges)
        .await
        .map_err(to_py_exception)?;
    let env_ref = match ctx.run(&program, &mut state).await {
        Ok((env_ref, _modeling_session_data)) => env_ref,
        Err(err) => {
            ctx.close().await;
            return Err(into_miette(err, &code));
        }
    };
    let executed_kcl = Arc::new(ExecutedKcl {
        ctx,
        state,
        env_ref,
        program,
        code,
        filename,
    });
    Ok(KclSession {
        executed_kcl,
        is_closed: false,
    })
}
