//! A single executed model and its engine connection.
use std::pin::Pin;
use std::sync::Arc;
use std::sync::atomic::AtomicBool;
use std::sync::atomic::Ordering;
use std::time::Duration;

use pyo3::exceptions::PyRuntimeError;
use tokio::sync::Mutex;
use tokio::sync::Notify;

use super::*;

const CLOSE_TIMEOUT: Duration = Duration::from_secs(5);

struct Connection {
    ctx: Option<ExecutorContext>,
    closed: Arc<AtomicBool>,
}

impl Drop for Connection {
    fn drop(&mut self) {
        if let Some(ctx) = self.ctx.take() {
            self.closed.store(true, Ordering::Release);
            // Also covers cancelled initialization/operations and forgotten close().
            tokio().spawn(async move {
                let _ = tokio::time::timeout(CLOSE_TIMEOUT, ctx.close()).await;
            });
        }
    }
}

/// An executed KCL model. Use ``async with`` or await ``close()`` when finished.
/// KCL failures are retained in ``outcome``; inspect it before using partial geometry.
/// Engine operations are serialized and never re-execute KCL automatically.
#[pyo3_stub_gen::derive::gen_stub_pyclass]
#[pyclass]
pub(crate) struct Session {
    connection: Arc<Mutex<Option<Connection>>>,
    closed: Arc<AtomicBool>,
    shutdown: Arc<Notify>,
    outcome: ExecOutcome,
    units: UnitLength,
}

impl Session {
    async fn operation<T: Send + 'static>(
        &self,
        operation: impl FnOnce(ExecutorContext) -> Pin<Box<dyn Future<Output = PyResult<T>> + Send>> + Send + 'static,
    ) -> PyResult<T> {
        let connection = self.connection.clone();
        let closed = self.closed.clone();
        let shutdown = self.shutdown.clone();
        spawn_py(async move {
            let notified = shutdown.notified();
            tokio::pin!(notified);
            notified.as_mut().enable();
            let mut slot = connection.lock().await;
            if closed.load(Ordering::Acquire) {
                return Err(PyRuntimeError::new_err("KCL session is closed"));
            }
            let connection = slot
                .take()
                .ok_or_else(|| PyRuntimeError::new_err("KCL session has no engine connection"))?;
            let ctx = connection
                .ctx
                .as_ref()
                .ok_or_else(|| PyRuntimeError::new_err("KCL session is closed"))?
                .clone();
            // The owned connection closes on cancellation, so a command still in
            // flight cannot interfere with a later operation on this session.
            let result = tokio::select! {
                biased;
                _ = &mut notified => Err(PyRuntimeError::new_err("KCL session is closed")),
                result = operation(ctx) => result,
            };
            *slot = Some(connection);
            result
        })
        .await
    }
}

#[pyo3_stub_gen::derive::gen_stub_pymethods]
#[pymethods]
impl Session {
    /// Saved diagnostics and partial sketch results, available after close().
    #[getter]
    pub(crate) fn outcome(&self) -> ExecOutcome {
        self.outcome.clone()
    }

    #[getter]
    fn closed(&self) -> bool {
        self.closed.load(Ordering::Acquire)
    }

    /// Close the connection. Repeated calls are safe. Cleanup continues if cancelled.
    pub(crate) async fn close(&self) -> PyResult<()> {
        self.closed.store(true, Ordering::Release);
        self.shutdown.notify_waiters();
        let connection = self.connection.clone();
        // Unlike operations, shutdown must survive cancellation of its caller.
        tokio()
            .spawn(async move {
                let mut slot = connection.lock().await;
                if let Some(mut connection) = slot.take()
                    && let Some(ctx) = connection.ctx.take()
                {
                    tokio::time::timeout(CLOSE_TIMEOUT, ctx.close())
                        .await
                        .map_err(|_| PyRuntimeError::new_err("Timed out closing KCL session"))?;
                }
                Ok(())
            })
            .await
            .map_err(to_py_exception)?
    }

    async fn __aenter__(slf: Py<Self>) -> PyResult<Py<Self>> {
        // A parse failure intentionally has no connection, but still supports
        // the same context-manager path for inspecting its outcome.
        Ok(slf)
    }

    async fn __aexit__(
        &self,
        _exc_type: Option<Py<PyAny>>,
        _exc_value: Option<Py<PyAny>>,
        _traceback: Option<Py<PyAny>>,
    ) -> PyResult<()> {
        self.close().await
    }

    /// Take a snapshot of the current (possibly partial) model.
    #[pyo3(signature = (image_format, *, zoom=true))]
    async fn snapshot(&self, image_format: ImageFormat, zoom: bool) -> PyResult<Vec<u8>> {
        self.operation(move |ctx| Box::pin(async move { snapshot(&ctx, image_format, 0.1, zoom).await }))
            .await
    }

    /// Take several views without re-executing KCL.
    #[pyo3(signature = (image_format, snapshot_options, *, zoom=true))]
    async fn snapshot_views(
        &self,
        image_format: ImageFormat,
        snapshot_options: Vec<SnapshotOptions>,
        zoom: bool,
    ) -> PyResult<Vec<Vec<u8>>> {
        self.operation(move |ctx| Box::pin(async move { take_snaps(&ctx, image_format, snapshot_options, zoom).await }))
            .await
    }

    async fn measure(&self, request: PhysicalPropertiesRequest) -> PyResult<PhysicalPropertiesResponse> {
        self.operation(move |ctx| Box::pin(async move { measure_model_properties(&ctx, request).await }))
            .await
    }

    #[pyo3(signature = (entity_ids=None, output_unit=None))]
    async fn bounding_box(
        &self,
        entity_ids: Option<Vec<String>>,
        output_unit: Option<UnitLength>,
    ) -> PyResult<BoundingBoxResponse> {
        let ids = parse_entity_ids(entity_ids.unwrap_or_default())?;
        self.operation(move |ctx| Box::pin(async move { get_bounding_box(&ctx, ids, output_unit).await }))
            .await
    }

    /// Export the current (possibly partial) model using the program's length units.
    async fn export(&self, export_format: FileExportFormat) -> PyResult<Vec<RawFile>> {
        let units = self.units;
        self.operation(move |ctx| Box::pin(async move { export_model(&ctx, units, export_format).await }))
            .await
    }
}

fn failed_outcome(error: kcl_lib::KclErrorWithOutputs, code: String, filename: String, phase: &str) -> ExecOutcome {
    let retryable = error.is_retryable();
    let text = if phase == "parse" {
        render_miette_for_parse(&filename, &code, error.error.clone())
    } else {
        render_miette(error.clone(), &code)
    };
    ExecOutcome {
        inner: Arc::new(kcl_lib::ExecOutcome {
            variables: error.variables,
            operations: error.operations,
            artifact_graph: error.artifact_graph,
            scene_objects: error.scene_objects,
            source_range_to_object: error.source_range_to_object,
            var_solutions: error.var_solutions,
            refactor_metadata: error.refactor_metadata,
            issues: error.non_fatal,
            filenames: error.filenames,
            source_files: error.source_files,
            default_planes: error.default_planes,
        }),
        code,
        filename,
        error: Some(KclErrorInfo {
            phase: phase.to_owned(),
            text,
        }),
        retryable,
    }
}

pub(super) async fn execute(input: KclInput, mock: bool, highlight_edges: Option<bool>) -> PyResult<Session> {
    let (code, path, filename) = match input {
        KclInput::Path(path) => {
            let (code, path) = get_code_and_file_path(&path).await.map_err(to_py_exception)?;
            let filename = path.display().to_string();
            (code, Some(path), filename)
        }
        KclInput::Code(code) => (code, None, String::new()),
    };
    let parsed = kcl_lib::Program::parse_no_errs(&code).and_then(|program| {
        let units = program.meta_settings()?.unwrap_or_default().default_length_units.into();
        Ok((program, units))
    });
    let (program, units) = match parsed {
        Ok(parsed) => parsed,
        Err(error) => {
            return Ok(Session {
                connection: Arc::new(Mutex::new(None)),
                closed: Arc::new(AtomicBool::new(true)),
                shutdown: Arc::new(Notify::new()),
                outcome: failed_outcome(kcl_lib::KclErrorWithOutputs::no_outputs(error), code, filename, "parse"),
                units: UnitLength::Millimeters,
            });
        }
    };
    let (ctx, mut state) = new_context_state(path, mock, highlight_edges)
        .await
        .map_err(to_py_exception)?;
    let closed = Arc::new(AtomicBool::new(false));
    let connection = Connection {
        ctx: Some(ctx.clone()),
        closed: closed.clone(),
    };
    let outcome = match ctx.run(&program, &mut state).await {
        Ok((env_ref, _)) => match state.into_exec_outcome(env_ref, &ctx).await {
            Ok(inner) => ExecOutcome {
                inner: Arc::new(inner),
                code,
                filename,
                error: None,
                retryable: false,
            },
            Err(error) => return Err(into_kcl_exception(error)),
        },
        Err(error) => failed_outcome(error, code, filename, "execution"),
    };
    Ok(Session {
        connection: Arc::new(Mutex::new(Some(connection))),
        closed,
        shutdown: Arc::new(Notify::new()),
        outcome,
        units,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn mock_session() -> Session {
        execute(KclInput::Code("@settings(kclVersion = 2.0)\na = 1".into()), true, None)
            .await
            .unwrap()
    }

    #[tokio::test]
    async fn parse_failure_retains_diagnostics_without_a_connection() {
        let session = execute(KclInput::Code("a = sketch(".into()), true, None).await.unwrap();
        assert!(session.closed());
        assert_eq!(session.outcome.error().unwrap().phase, "parse");
        assert!(!session.outcome.sketch_constraint_report().is_complete);
        assert!(session.outcome.raise_for_error().is_err());
        session.close().await.unwrap();
        session.close().await.unwrap();
    }

    #[tokio::test]
    async fn failed_execution_retains_completed_sketches() {
        let code = "@settings(kclVersion = 2.0)\ns = sketch(on = XY) {\n l = line(start = [var 0mm, var 0mm], end = [var 10mm, var 5mm])\n}\na = missing_value";
        let session = execute(KclInput::Code(code.into()), true, None).await.unwrap();
        let outcome = session.outcome();
        assert!(!outcome.is_complete());
        assert_eq!(outcome.error().unwrap().phase, "execution");
        assert!(outcome.error().unwrap().text.contains("missing_value"));
        assert_eq!(outcome.sketch_constraint_report().under_constrained.len(), 1);
        assert!(outcome.render_sketch_png("s").unwrap().starts_with(b"\x89PNG"));
        session.close().await.unwrap();
        assert_eq!(outcome.sketch_constraint_report().under_constrained.len(), 1);
    }

    #[tokio::test]
    async fn cancelling_an_operation_invalidates_the_session() {
        let session = Arc::new(mock_session().await);
        let (started_tx, started_rx) = tokio::sync::oneshot::channel();
        let worker_session = session.clone();
        let worker = tokio::spawn(async move {
            worker_session
                .operation(move |_| {
                    Box::pin(async move {
                        started_tx.send(()).unwrap();
                        std::future::pending::<PyResult<()>>().await
                    })
                })
                .await
        });
        started_rx.await.unwrap();
        worker.abort();
        let _ = worker.await;
        tokio::time::timeout(Duration::from_secs(1), async {
            while !session.closed() {
                tokio::task::yield_now().await;
            }
        })
        .await
        .unwrap();
        assert!(session.operation(|_| Box::pin(async { Ok(()) })).await.is_err());
        session.close().await.unwrap();
    }

    #[tokio::test]
    async fn close_interrupts_an_operation_and_rejects_later_calls() {
        let session = Arc::new(mock_session().await);
        let (started_tx, started_rx) = tokio::sync::oneshot::channel();
        let worker_session = session.clone();
        let worker = tokio::spawn(async move {
            worker_session
                .operation(move |_| {
                    Box::pin(async move {
                        started_tx.send(()).unwrap();
                        std::future::pending::<PyResult<()>>().await
                    })
                })
                .await
        });
        started_rx.await.unwrap();
        tokio::time::timeout(Duration::from_secs(1), session.close())
            .await
            .unwrap()
            .unwrap();
        assert!(worker.await.unwrap().is_err());
        assert!(session.operation(|_| Box::pin(async { Ok(()) })).await.is_err());
        session.close().await.unwrap();
    }

    #[tokio::test]
    async fn operations_are_serialized() {
        let session = Arc::new(mock_session().await);
        let active = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let mut tasks = Vec::new();
        for _ in 0..4 {
            let session = session.clone();
            let active = active.clone();
            tasks.push(tokio::spawn(async move {
                session
                    .operation(move |_| {
                        Box::pin(async move {
                            assert_eq!(active.fetch_add(1, Ordering::SeqCst), 0);
                            tokio::time::sleep(Duration::from_millis(10)).await;
                            assert_eq!(active.fetch_sub(1, Ordering::SeqCst), 1);
                            Ok(())
                        })
                    })
                    .await
                    .unwrap();
            }));
        }
        for task in tasks {
            task.await.unwrap();
        }
        session.close().await.unwrap();
    }
}
