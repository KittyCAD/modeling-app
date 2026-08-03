#![allow(clippy::useless_conversion)]
use std::future::Future;
use std::path::Path;
use std::path::PathBuf;

use anyhow::Result;
use kcl_api::UnitAngle;
use kcl_api::UnitLength;
use kcl_lib::ExecutorContext;
use kcl_lib::IsRetryable;
use kcl_lib::lint::Discovered;
use kcl_lib::lint::FindingFamily;
use kcl_lib::lint::checks;
use kcl_lib::unit_conversion::ToKcmc;
use kittycad_modeling_cmds::ImageFormat;
use kittycad_modeling_cmds::ImportFile;
use kittycad_modeling_cmds::ModelingCmd;
use kittycad_modeling_cmds::format::InputFormat3d;
use kittycad_modeling_cmds::format::OutputFormat3d;
use kittycad_modeling_cmds::ok_response::OkModelingCmdResponse;
use kittycad_modeling_cmds::shared::FileExportFormat;
use kittycad_modeling_cmds::websocket::OkWebSocketResponseData;
use kittycad_modeling_cmds::websocket::RawFile;
use kittycad_modeling_cmds::{self as kcmc};
use pyo3::Bound;
use pyo3::Py;
use pyo3::PyErr;
use pyo3::PyResult;
use pyo3::Python;
use pyo3::exceptions::PyException;
use pyo3::prelude::PyModuleMethods;
use pyo3::pyclass;
use pyo3::pyfunction;
use pyo3::pymethods;
use pyo3::pymodule;
use pyo3::types::PyAny;
use pyo3::types::PyModule;
use pyo3::wrap_pyfunction;
use pyo3_stub_gen::define_stub_info_gatherer;
use serde::Deserialize;
use serde::Serialize;
use uuid::Uuid;

use crate::bridge::bounding_box::BoundingBoxResponse;
use crate::bridge::physical_properties::PhysicalPropertiesRequest;
use crate::bridge::physical_properties::PhysicalPropertiesResponse;
use crate::bridge::sketch_constraints::KclErrorInfo;
use crate::bridge::sketch_constraints::SketchConstraintReport;

const HEARTBEAT_INTERVAL_SECONDS: u64 = 5;

mod bridge;

fn tokio() -> &'static tokio::runtime::Runtime {
    use std::sync::OnceLock;
    static RT: OnceLock<tokio::runtime::Runtime> = OnceLock::new();
    RT.get_or_init(|| tokio::runtime::Runtime::new().unwrap())
}

async fn spawn_py<T, Fut>(future: Fut) -> PyResult<T>
where
    T: Send + 'static,
    Fut: Future<Output = PyResult<T>> + Send + 'static,
{
    tokio()
        .spawn(future)
        .await
        .map_err(|err| PyException::new_err(err.to_string()))?
}

fn into_miette(error: kcl_lib::KclErrorWithOutputs, code: &str) -> PyErr {
    let retryable = error.is_retryable();
    PyErr::new::<PyKclError, _>((render_miette(error, code), retryable))
}

fn render_miette(error: kcl_lib::KclErrorWithOutputs, code: &str) -> String {
    let report = error.into_miette_report_with_outputs(code).unwrap();
    let report = miette::Report::new(report);
    format!("{report:?}")
}

fn into_miette_for_parse(filename: &str, input: &str, error: kcl_lib::KclError) -> PyErr {
    let retryable = error.is_retryable();
    PyErr::new::<PyKclError, _>((render_miette_for_parse(filename, input, error), retryable))
}

fn render_miette_for_parse(filename: &str, input: &str, error: kcl_lib::KclError) -> String {
    let report = kcl_lib::Report {
        kcl_source: input.to_string(),
        error,
        filename: filename.to_string(),
    };
    let report = miette::Report::new(report);
    format!("{report:?}")
}

fn incomplete_sketch_constraint_report(phase: &str, text: String) -> SketchConstraintReport {
    SketchConstraintReport {
        fully_constrained: Vec::new(),
        under_constrained: Vec::new(),
        over_constrained: Vec::new(),
        errors: Vec::new(),
        is_complete: false,
        kcl_error: Some(KclErrorInfo {
            phase: phase.to_string(),
            text,
        }),
    }
}

/// Get the path to the current file from the path given, and read the code.
async fn get_code_and_file_path(path: &str) -> Result<(String, std::path::PathBuf)> {
    let mut path = std::path::PathBuf::from(path);
    // Check if the path is a directory, if so we want to look for a main.kcl inside.
    if path.is_dir() {
        path = path.join("main.kcl");
        if !path.exists() {
            return Err(anyhow::anyhow!("Directory must contain a main.kcl file"));
        }
    } else {
        // Otherwise be sure we have a kcl file.
        if let Some(ext) = path.extension()
            && ext != "kcl"
        {
            return Err(anyhow::anyhow!("File must have a .kcl extension"));
        }
    }

    let code = tokio::fs::read_to_string(&path).await?;
    Ok((code, path))
}

enum KclInput {
    Path(String),
    Code(String),
}

struct KclProgram {
    code: String,
    program: kcl_lib::Program,
    path: Option<PathBuf>,
    filename: String,
}

fn into_kcl_exception(error: kcl_lib::KclError) -> PyErr {
    let retryable = error.is_retryable();
    PyErr::new::<PyKclError, _>((error.to_string(), retryable))
}

// Keep the stub for this exception manual in `kcl.pyi`. `pyo3_stub_gen`
// generates code for this `PyException` subclass that does not compile on
// PyPy, because it references `pyo3::prepare_freethreaded_python`.
#[pyclass(name = "KclError", extends = PyException, from_py_object)]
#[derive(Debug, Clone)]
struct PyKclError {
    retryable: bool,
}

#[pymethods]
impl PyKclError {
    #[new]
    #[pyo3(signature = (_message, retryable = false))]
    fn new(_message: &Bound<'_, PyAny>, retryable: bool) -> Self {
        Self { retryable }
    }

    fn is_retryable(&self) -> bool {
        self.retryable
    }
}

#[pyo3_stub_gen::derive::gen_stub_pyclass]
#[pyclass(from_py_object)]
#[derive(Debug, Clone, Copy)]
pub struct DefaultUnits {
    length: UnitLength,
    angle: UnitAngle,
}

#[pyo3_stub_gen::derive::gen_stub_pymethods]
#[pymethods]
impl DefaultUnits {
    #[getter]
    fn length(&self) -> PyResult<UnitLength> {
        Ok(self.length)
    }

    #[getter]
    fn angle(&self) -> PyResult<UnitAngle> {
        Ok(self.angle)
    }
}

async fn load_and_parse(input: KclInput) -> PyResult<KclProgram> {
    let (code, path, filename) = match input {
        KclInput::Path(input_path) => {
            let (code, path) = get_code_and_file_path(&input_path).await.map_err(to_py_exception)?;
            let filename = path.display().to_string();
            (code, Some(path), filename)
        }
        KclInput::Code(code) => (code, None, String::new()),
    };

    let program = kcl_lib::Program::parse_no_errs(&code).map_err(|err| into_miette_for_parse(&filename, &code, err))?;

    Ok(KclProgram {
        code,
        program,
        path,
        filename,
    })
}

fn executor_settings(current_file: Option<PathBuf>, highlight_edges: Option<bool>) -> kcl_lib::ExecutorSettings {
    let mut settings: kcl_lib::ExecutorSettings = kcl_lib::ExecutorSettings {
        heartbeats: Some(HEARTBEAT_INTERVAL_SECONDS),
        ..Default::default()
    };
    if let Some(current_file) = current_file {
        settings.with_current_file(kcl_lib::TypedPath(current_file));
    }
    if let Some(highlight_edges) = highlight_edges {
        settings.highlight_edges = highlight_edges;
    }
    // Must turn on SSAO, without it, transparent images will look opaque.
    settings.enable_ssao = true;
    settings
}

async fn new_context_state(
    current_file: Option<PathBuf>,
    mock: bool,
    highlight_edges: Option<bool>,
) -> Result<(ExecutorContext, kcl_lib::ExecState)> {
    let settings = executor_settings(current_file, highlight_edges);
    let ctx = if mock {
        ExecutorContext::new_mock(Some(settings)).await
    } else {
        ExecutorContext::new_with_client(settings, None, None).await?
    };
    let state = kcl_lib::ExecState::new(&ctx);
    Ok((ctx, state))
}

/// Wrapper for [kcl_lib::kcl_error::CompilationIssue].
#[pyo3_stub_gen::derive::gen_stub_pyclass]
#[pyclass(from_py_object)]
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CompilationIssue {
    inner: kcl_lib::CompilationIssue,
}

impl From<kcl_lib::kcl_error::CompilationIssue> for CompilationIssue {
    fn from(value: kcl_lib::kcl_error::CompilationIssue) -> Self {
        Self { inner: value }
    }
}

#[pyo3_stub_gen::derive::gen_stub_pymethods]
#[pymethods]
impl CompilationIssue {
    pub fn is_warning(&self) -> bool {
        self.inner.severity.is_warning()
    }

    pub fn is_err(&self) -> bool {
        self.inner.severity.is_err()
    }

    pub fn is_fatal(&self) -> bool {
        self.inner.severity.is_fatal()
    }
}

/// Returned from execution functions.
#[pyo3_stub_gen::derive::gen_stub_pyclass]
#[pyclass(from_py_object)]
#[derive(Debug, Clone)]
struct ExecOutcome {
    issues: Vec<CompilationIssue>,
    code: String,
    filename: String,
}

#[pyo3_stub_gen::derive::gen_stub_pymethods]
#[pymethods]
impl ExecOutcome {
    fn issues(&self) -> PyResult<Vec<CompilationIssue>> {
        Ok(self.issues.clone())
    }

    /// Render the given compilation issue as a miette report string, using
    /// the source code and filename captured at execution time.
    fn report(&self, issue: &CompilationIssue) -> String {
        kcl_lib::render_compilation_issue_miette(&self.filename, &self.code, issue.inner.clone())
    }
}

struct ExecutedKcl {
    ctx: ExecutorContext,
    program: kcl_lib::Program,
    code: String,
    filename: String,
    issues: Vec<kcl_lib::CompilationIssue>,
}

async fn run_kcl(input: KclInput, mock: bool, highlight_edges: Option<bool>) -> PyResult<ExecutedKcl> {
    let KclProgram {
        code,
        program,
        path,
        filename,
    } = load_and_parse(input).await?;

    let (ctx, mut state) = new_context_state(path, mock, highlight_edges)
        .await
        .map_err(to_py_exception)?;
    if let Err(err) = ctx.run(&program, &mut state).await {
        ctx.close().await;
        return Err(into_miette(err, &code));
    }

    let issues = state.issues().to_vec();

    Ok(ExecutedKcl {
        ctx,
        program,
        code,
        filename,
        issues,
    })
}

async fn execute_impl(input: KclInput, mock: bool) -> PyResult<ExecOutcome> {
    let ExecutedKcl {
        ctx,
        issues,
        code,
        filename,
        ..
    } = run_kcl(input, mock, None).await?;
    ctx.close().await;
    Ok(ExecOutcome {
        issues: issues.into_iter().map(CompilationIssue::from).collect(),
        code,
        filename,
    })
}

async fn sketch_constraint_report_impl(input: KclInput) -> PyResult<SketchConstraintReport> {
    let (code, path, filename) = match input {
        KclInput::Path(input_path) => {
            let (code, path) = get_code_and_file_path(&input_path).await.map_err(to_py_exception)?;
            let filename = path.display().to_string();
            (code, Some(path), filename)
        }
        KclInput::Code(code) => (code, None, String::new()),
    };

    let program = match kcl_lib::Program::parse_no_errs(&code) {
        Ok(program) => program,
        Err(err) => {
            let error_text = render_miette_for_parse(&filename, &code, err);
            return Ok(incomplete_sketch_constraint_report("parse", error_text));
        }
    };

    let (ctx, mut state) = new_context_state(path, false, None).await.map_err(to_py_exception)?;
    let result = match ctx.run(&program, &mut state).await {
        Ok((env_ref, _)) => {
            let outcome = state.into_exec_outcome(env_ref, &ctx).await.map_err(to_py_exception)?;
            Ok(outcome.sketch_constraint_report().into())
        }
        Err(err) => {
            if err.is_retryable() {
                return Err(into_miette(err, &code));
            }
            let error_text = render_miette(err.clone(), &code);
            let mut report: SketchConstraintReport = err.sketch_constraint_report().into();
            report.is_complete = false;
            report.kcl_error = Some(KclErrorInfo {
                phase: "execution".to_string(),
                text: error_text,
            });
            Ok(report)
        }
    };
    ctx.close().await;
    result
}

async fn execute_and_snapshot_views_impl(
    input: KclInput,
    image_format: ImageFormat,
    snapshot_options: Vec<SnapshotOptions>,
    zoom: bool,
    highlight_edges: Option<bool>,
) -> PyResult<Vec<Vec<u8>>> {
    let ExecutedKcl { ctx, .. } = run_kcl(input, false, highlight_edges).await?;
    let result = take_snaps(&ctx, image_format, snapshot_options, zoom).await;
    ctx.close().await;
    result
}

async fn execute_and_measure_impl(
    input: KclInput,
    request: PhysicalPropertiesRequest,
) -> PyResult<PhysicalPropertiesResponse> {
    let ExecutedKcl { ctx, .. } = run_kcl(input, false, None).await?;
    let result = measure_model_properties(&ctx, request).await;
    ctx.close().await;
    result
}

fn parse_uuid(entity_id: &str) -> PyResult<Uuid> {
    Uuid::parse_str(entity_id).map_err(|err| PyException::new_err(format!("Invalid ID `{entity_id}`: {err}")))
}

fn parse_entity_ids(entity_ids: Vec<String>) -> PyResult<Vec<Uuid>> {
    entity_ids.into_iter().map(|s| parse_uuid(&s)).collect()
}

async fn execute_and_bounding_box_impl(
    input: KclInput,
    entity_ids: Vec<String>,
    output_unit: Option<UnitLength>,
) -> PyResult<BoundingBoxResponse> {
    let entity_ids = parse_entity_ids(entity_ids)?;
    let ExecutedKcl { ctx, .. } = run_kcl(input, false, None).await?;
    let result = get_bounding_box(&ctx, entity_ids, output_unit).await;
    ctx.close().await;
    result
}

async fn execute_and_export_impl(input: KclInput, export_format: FileExportFormat) -> PyResult<Vec<RawFile>> {
    let ExecutedKcl {
        ctx,
        program,
        code,
        filename,
        issues: _,
    } = run_kcl(input, false, None).await?;

    let settings = match program.meta_settings() {
        Ok(x) => x.unwrap_or_default(),
        Err(err) => {
            ctx.close().await;
            return Err(into_miette_for_parse(&filename, &code, err));
        }
    };
    let units: UnitLength = settings.default_length_units.into();

    // This will not return until there are files.
    let export_res = ctx
        .engine
        .send_modeling_cmd(
            &ctx.engine_batch,
            uuid::Uuid::new_v4(),
            kcl_lib::SourceRange::default(),
            &kittycad_modeling_cmds::ModelingCmd::Export(
                kittycad_modeling_cmds::Export::builder()
                    .entity_ids(vec![])
                    .format(OutputFormat3d::new(
                        &export_format,
                        kcmc::format::OutputFormat3dOptions::new(units.to_kcmc()),
                    ))
                    .build(),
            ),
        )
        .await;
    let resp = match export_res {
        Ok(x) => x,
        Err(e) => {
            ctx.close().await;
            return Err(into_kcl_exception(e));
        }
    };

    let result = match resp {
        kittycad_modeling_cmds::websocket::OkWebSocketResponseData::Export { files } => Ok(files),
        _ => Err(pyo3::exceptions::PyException::new_err(format!(
            "Unexpected response from engine: {resp:?}"
        ))),
    };

    ctx.close().await;
    result
}

/// Parse the kcl code from a file path.
#[pyo3_stub_gen::derive::gen_stub_pyfunction]
#[pyfunction]
async fn parse(path: String) -> PyResult<bool> {
    spawn_py(async move {
        let _parsed = load_and_parse(KclInput::Path(path)).await?;

        Ok(true)
    })
    .await
}

/// Get the default length and angle units from a kcl file.
#[pyo3_stub_gen::derive::gen_stub_pyfunction]
#[pyfunction]
async fn default_units(path: String) -> PyResult<DefaultUnits> {
    spawn_py(async move {
        let KclProgram {
            code,
            program,
            filename,
            ..
        } = load_and_parse(KclInput::Path(path)).await?;

        let settings = program
            .meta_settings()
            .map_err(|err| into_miette_for_parse(&filename, &code, err))?
            .unwrap_or_default();

        Ok(DefaultUnits {
            length: settings.default_length_units,
            angle: settings.default_angle_units,
        })
    })
    .await
}

/// Parse the kcl code.
#[pyo3_stub_gen::derive::gen_stub_pyfunction]
#[pyfunction]
fn parse_code(code: String) -> PyResult<bool> {
    let _program = kcl_lib::Program::parse_no_errs(&code).map_err(|err| into_miette_for_parse("", &code, err))?;

    Ok(true)
}

/// Execute the kcl code from a file path.
#[pyo3_stub_gen::derive::gen_stub_pyfunction]
#[pyfunction]
async fn execute(path: String) -> PyResult<ExecOutcome> {
    spawn_py(async move { execute_impl(KclInput::Path(path), false).await }).await
}

/// Execute the kcl code.
#[pyo3_stub_gen::derive::gen_stub_pyfunction]
#[pyfunction]
async fn execute_code(code: String) -> PyResult<ExecOutcome> {
    spawn_py(async move { execute_impl(KclInput::Code(code), false).await }).await
}

/// Mock execute the kcl code.
#[pyo3_stub_gen::derive::gen_stub_pyfunction]
#[pyfunction]
async fn mock_execute_code(code: String) -> PyResult<bool> {
    spawn_py(async move {
        execute_impl(KclInput::Code(code), true).await?;
        Ok(true)
    })
    .await
}

/// Mock execute the kcl code from a file path.
#[pyo3_stub_gen::derive::gen_stub_pyfunction]
#[pyfunction]
async fn mock_execute(path: String) -> PyResult<bool> {
    spawn_py(async move {
        execute_impl(KclInput::Path(path), true).await?;
        Ok(true)
    })
    .await
}

/// Execute a kcl file and return a report of sketch constraint status.
#[pyo3_stub_gen::derive::gen_stub_pyfunction]
#[pyfunction]
async fn get_sketch_constraint_status(path: String) -> PyResult<SketchConstraintReport> {
    spawn_py(async move { sketch_constraint_report_impl(KclInput::Path(path)).await }).await
}

/// Execute kcl code and return a report of sketch constraint status.
#[pyo3_stub_gen::derive::gen_stub_pyfunction]
#[pyfunction]
async fn get_sketch_constraint_status_code(code: String) -> PyResult<SketchConstraintReport> {
    spawn_py(async move { sketch_constraint_report_impl(KclInput::Code(code)).await }).await
}

#[pyo3_stub_gen::derive::gen_stub_pyfunction]
#[pyfunction(signature = (filepaths, format, image_format, *, zoom=None, highlight_edges=None))]
async fn import_and_snapshot(
    filepaths: Vec<String>,
    format: InputFormat3d,
    image_format: ImageFormat,
    zoom: Option<bool>,
    highlight_edges: Option<bool>,
) -> PyResult<Vec<u8>> {
    let zoom = zoom.unwrap_or(true);
    let img = import_and_snapshot_views(filepaths, format, image_format, Vec::new(), Some(zoom), highlight_edges)
        .await?
        .pop();
    Ok(img.unwrap())
}

fn to_py_exception(err: impl std::fmt::Display) -> PyErr {
    PyException::new_err(err.to_string())
}

/// Get the allowed relevant file extensions (imports + kcl).
#[pyo3_stub_gen::derive::gen_stub_pyfunction]
#[pyfunction]
fn relevant_file_extensions() -> PyResult<Vec<String>> {
    Ok(kcl_lib::RELEVANT_FILE_EXTENSIONS
        .iter()
        .map(|s| s.to_string())
        .collect::<Vec<String>>())
}

#[pyo3_stub_gen::derive::gen_stub_pyfunction]
#[pyfunction(signature = (filepaths, format, image_format, snapshot_options, *, zoom=None, highlight_edges=None))]
async fn import_and_snapshot_views(
    filepaths: Vec<String>,
    format: InputFormat3d,
    image_format: ImageFormat,
    snapshot_options: Vec<SnapshotOptions>,
    zoom: Option<bool>,
    highlight_edges: Option<bool>,
) -> PyResult<Vec<Vec<u8>>> {
    let zoom = zoom.unwrap_or(true);
    spawn_py(async move {
        let (ctx, _state) = new_context_state(None, false, highlight_edges)
            .await
            .map_err(to_py_exception)?;
        if let Err(e) = import(&ctx, filepaths, format).await {
            ctx.close().await;
            return Err(e);
        }
        let result = take_snaps(&ctx, image_format, snapshot_options, zoom).await;
        ctx.close().await;
        result
    })
    .await
}

/// Make an absolute path not absolute. We need to do this to re-root files
/// under a directory by using [Path::join].
pub(crate) fn unabs_path(path: &Path) -> &Path {
    if !path.is_absolute() {
        return path;
    }
    path.strip_prefix("/").expect("not possible given is_absolute check")
}

/// Return the ID of the imported object.
async fn import(ctx: &ExecutorContext, filepaths: Vec<String>, format: InputFormat3d) -> PyResult<Uuid> {
    let mut files = Vec::with_capacity(filepaths.len());
    for filepath in filepaths {
        let filepath = Path::new(&filepath);
        let file_contents = tokio::fs::read(&filepath).await.map_err(to_py_exception)?;
        let relative_filepath = unabs_path(filepath);
        files.push(
            ImportFile::builder()
                .path(relative_filepath.display().to_string())
                .data(file_contents)
                .build(),
        );
    }
    let resp = ctx
        .engine
        .send_modeling_cmd(
            &ctx.engine_batch,
            Uuid::new_v4(),
            Default::default(),
            &kcmc::ModelingCmd::ImportFiles(kcmc::ImportFiles::builder().files(files).format(format).build()),
        )
        .await
        .map_err(into_kcl_exception)?;
    let kittycad_modeling_cmds::websocket::OkWebSocketResponseData::Modeling {
        modeling_response: OkModelingCmdResponse::ImportFiles(data),
    } = resp
    else {
        return Err(pyo3::exceptions::PyException::new_err(format!(
            "Unexpected response from engine: {resp:?}",
        )));
    };
    Ok(data.object_id)
}

/// Execute a kcl file and snapshot it in a specific format.
#[pyo3_stub_gen::derive::gen_stub_pyfunction]
#[pyfunction(signature = (path, image_format, *, zoom=None, highlight_edges=None))]
async fn execute_and_snapshot(
    path: String,
    image_format: ImageFormat,
    zoom: Option<bool>,
    highlight_edges: Option<bool>,
) -> PyResult<Vec<u8>> {
    let zoom = zoom.unwrap_or(true);
    let img = execute_and_snapshot_views(path, image_format, Vec::new(), Some(zoom), highlight_edges)
        .await?
        .pop();
    Ok(img.unwrap())
}

#[pyo3_stub_gen::derive::gen_stub_pyfunction]
#[pyfunction(signature = (path, image_format, snapshot_options, *, zoom=None, highlight_edges=None))]
async fn execute_and_snapshot_views(
    path: String,
    image_format: ImageFormat,
    snapshot_options: Vec<SnapshotOptions>,
    zoom: Option<bool>,
    highlight_edges: Option<bool>,
) -> PyResult<Vec<Vec<u8>>> {
    let zoom = zoom.unwrap_or(true);
    spawn_py(async move {
        execute_and_snapshot_views_impl(
            KclInput::Path(path),
            image_format,
            snapshot_options,
            zoom,
            highlight_edges,
        )
        .await
    })
    .await
}

/// Execute the kcl code and snapshot it in a specific format.
#[pyo3_stub_gen::derive::gen_stub_pyfunction]
#[pyfunction(signature = (code, image_format, *, zoom=None, highlight_edges=None))]
async fn execute_code_and_snapshot(
    code: String,
    image_format: ImageFormat,
    zoom: Option<bool>,
    highlight_edges: Option<bool>,
) -> PyResult<Vec<u8>> {
    let zoom = zoom.unwrap_or(true);
    let mut snaps =
        execute_code_and_snapshot_views(code, image_format, Vec::new(), Some(zoom), highlight_edges).await?;
    Ok(snaps.pop().unwrap())
}

/// Execute a kcl file and measure physical properties of the resulting model.
#[pyo3_stub_gen::derive::gen_stub_pyfunction]
#[pyfunction]
async fn execute_and_measure(path: String, request: PhysicalPropertiesRequest) -> PyResult<PhysicalPropertiesResponse> {
    spawn_py(async move { execute_and_measure_impl(KclInput::Path(path), request).await }).await
}

/// Execute the kcl code and measure physical properties of the resulting model.
#[pyo3_stub_gen::derive::gen_stub_pyfunction]
#[pyfunction]
async fn execute_code_and_measure(
    code: String,
    request: PhysicalPropertiesRequest,
) -> PyResult<PhysicalPropertiesResponse> {
    spawn_py(async move { execute_and_measure_impl(KclInput::Code(code), request).await }).await
}

/// Execute a kcl file and return the model's bounding box.
#[pyo3_stub_gen::derive::gen_stub_pyfunction]
#[pyfunction(signature = (path, entity_ids=None, output_unit=None))]
async fn execute_and_bounding_box(
    path: String,
    entity_ids: Option<Vec<String>>,
    output_unit: Option<UnitLength>,
) -> PyResult<BoundingBoxResponse> {
    let entity_ids = entity_ids.unwrap_or_default();
    spawn_py(async move { execute_and_bounding_box_impl(KclInput::Path(path), entity_ids, output_unit).await }).await
}

/// Execute the kcl code and return the model's bounding box.
#[pyo3_stub_gen::derive::gen_stub_pyfunction]
#[pyfunction(signature = (code, entity_ids=None, output_unit=None))]
async fn execute_code_and_bounding_box(
    code: String,
    entity_ids: Option<Vec<String>>,
    output_unit: Option<UnitLength>,
) -> PyResult<BoundingBoxResponse> {
    let entity_ids = entity_ids.unwrap_or_default();
    spawn_py(async move { execute_and_bounding_box_impl(KclInput::Code(code), entity_ids, output_unit).await }).await
}

/// Customize a snapshot.
#[derive(Serialize, Deserialize, PartialEq, Debug, Clone)]
#[pyo3_stub_gen::derive::gen_stub_pyclass]
#[pyclass(from_py_object)]
pub struct SnapshotOptions {
    /// If none, will use isometric view.
    pub camera: Option<bridge::CameraLookAt>,
    /// How much to pad the view frame by, as a fraction of the object(s) bounding box size.
    /// Negative padding will crop the view of the object proportionally.
    /// e.g. padding = 0.2 means the view will span 120% of the object(s) bounding box,
    /// and padding = -0.2 means the view will span 80% of the object(s) bounding box.
    pub padding: f32,
}

#[pyo3_stub_gen::derive::gen_stub_pymethods]
#[pymethods]
impl SnapshotOptions {
    #[new]
    /// Takes a kcl.CameraLookAt, and a padding number.
    fn new(camera: Option<bridge::CameraLookAt>, padding: f32) -> Self {
        Self { camera, padding }
    }

    #[staticmethod]
    /// Takes a padding number.
    fn isometric_view(padding: f32) -> Self {
        Self::new(None, padding)
    }
}

/// Execute the kcl code and snapshot it in a specific format.
/// Returns one image for each camera angle you provide.
/// If you don't provide any camera angles, a default head-on camera angle will be used.
#[pyo3_stub_gen::derive::gen_stub_pyfunction]
#[pyfunction(signature = (code, image_format, snapshot_options, *, zoom=None, highlight_edges=None))]
async fn execute_code_and_snapshot_views(
    code: String,
    image_format: ImageFormat,
    snapshot_options: Vec<SnapshotOptions>,
    zoom: Option<bool>,
    highlight_edges: Option<bool>,
) -> PyResult<Vec<Vec<u8>>> {
    let zoom = zoom.unwrap_or(true);
    spawn_py(async move {
        execute_and_snapshot_views_impl(
            KclInput::Code(code),
            image_format,
            snapshot_options,
            zoom,
            highlight_edges,
        )
        .await
    })
    .await
}

async fn take_snaps(
    ctx: &ExecutorContext,
    image_format: ImageFormat,
    snapshot_options: Vec<SnapshotOptions>,
    zoom: bool,
) -> PyResult<Vec<Vec<u8>>> {
    if snapshot_options.is_empty() {
        let data_bytes = snapshot(ctx, image_format, 0.1, zoom).await?;
        return Ok(vec![data_bytes]);
    }

    let mut snaps = Vec::with_capacity(snapshot_options.len());
    for pre_snap in snapshot_options {
        if let Some(camera) = pre_snap.camera {
            let view_cmd = kcmc::DefaultCameraLookAt::from(camera);
            let view_cmd = kcmc::ModelingCmd::DefaultCameraLookAt(view_cmd);
            ctx.engine
                .send_modeling_cmd(&ctx.engine_batch, uuid::Uuid::new_v4(), Default::default(), &view_cmd)
                .await
                .map_err(into_kcl_exception)?;
        } else {
            let view_cmd = kcmc::ModelingCmd::ViewIsometric(kcmc::ViewIsometric::builder().padding(0.0).build());
            ctx.engine
                .send_modeling_cmd(&ctx.engine_batch, uuid::Uuid::new_v4(), Default::default(), &view_cmd)
                .await
                .map_err(into_kcl_exception)?;
        }
        let data_bytes = snapshot(ctx, image_format, pre_snap.padding, zoom).await?;
        snaps.push(data_bytes);
    }
    Ok(snaps)
}

async fn snapshot(ctx: &ExecutorContext, image_format: ImageFormat, padding: f32, zoom: bool) -> PyResult<Vec<u8>> {
    // Set orthographic projection
    ctx.engine
        .send_modeling_cmd(
            &ctx.engine_batch,
            uuid::Uuid::new_v4(),
            kcl_lib::SourceRange::default(),
            &kittycad_modeling_cmds::ModelingCmd::DefaultCameraSetOrthographic(
                kittycad_modeling_cmds::DefaultCameraSetOrthographic::builder().build(),
            ),
        )
        .await
        .map_err(into_kcl_exception)?;

    // Zoom to fit.
    if zoom {
        ctx.engine
            .send_modeling_cmd(
                &ctx.engine_batch,
                uuid::Uuid::new_v4(),
                kcl_lib::SourceRange::default(),
                &kittycad_modeling_cmds::ModelingCmd::ZoomToFit(
                    kittycad_modeling_cmds::ZoomToFit::builder()
                        .padding(padding)
                        .animated(false)
                        .object_ids(Default::default())
                        .build(),
                ),
            )
            .await
            .map_err(into_kcl_exception)?;
    }

    // Send a snapshot request to the engine.
    let resp = ctx
        .engine
        .send_modeling_cmd(
            &ctx.engine_batch,
            uuid::Uuid::new_v4(),
            kcl_lib::SourceRange::default(),
            &kittycad_modeling_cmds::ModelingCmd::TakeSnapshot(
                kittycad_modeling_cmds::TakeSnapshot::builder()
                    .format(image_format.into())
                    .build(),
            ),
        )
        .await
        .map_err(into_kcl_exception)?;

    let kittycad_modeling_cmds::websocket::OkWebSocketResponseData::Modeling {
        modeling_response: OkModelingCmdResponse::TakeSnapshot(data),
    } = resp
    else {
        return Err(pyo3::exceptions::PyException::new_err(format!(
            "Unexpected response from engine: {resp:?}",
        )));
    };

    Ok(data.contents.0)
}

async fn measure_model_properties(
    ctx: &ExecutorContext,
    request: PhysicalPropertiesRequest,
) -> PyResult<PhysicalPropertiesResponse> {
    let mut out = PhysicalPropertiesResponse::default();
    let PhysicalPropertiesRequest {
        volume,
        mass,
        center_of_mass,
        surface_area,
        density,
        bounding_box,
    } = request;
    // volume
    if let Some(volume_req) = volume {
        let volume_resp = ctx
            .engine
            .send_modeling_cmd(
                &ctx.engine_batch,
                uuid::Uuid::new_v4(),
                kcl_lib::SourceRange::default(),
                &ModelingCmd::from(volume_req),
            )
            .await
            .map_err(into_kcl_exception)?;
        let OkWebSocketResponseData::Modeling {
            modeling_response: OkModelingCmdResponse::Volume(volume_resp),
        } = volume_resp
        else {
            return Err(pyo3::exceptions::PyException::new_err(format!(
                "Unexpected response from engine: {volume_resp:?}",
            )));
        };
        out.volume = Some(volume_resp);
    }
    // mass
    if let Some(mass_req) = mass {
        let mass_resp = ctx
            .engine
            .send_modeling_cmd(
                &ctx.engine_batch,
                uuid::Uuid::new_v4(),
                kcl_lib::SourceRange::default(),
                &ModelingCmd::from(mass_req),
            )
            .await
            .map_err(into_kcl_exception)?;
        let OkWebSocketResponseData::Modeling {
            modeling_response: OkModelingCmdResponse::Mass(mass_resp),
        } = mass_resp
        else {
            return Err(pyo3::exceptions::PyException::new_err(format!(
                "Unexpected response from engine: {mass_resp:?}",
            )));
        };
        out.mass = Some(mass_resp);
    }
    // center_of_mass
    if let Some(center_of_mass_req) = center_of_mass {
        let center_of_mass_resp = ctx
            .engine
            .send_modeling_cmd(
                &ctx.engine_batch,
                uuid::Uuid::new_v4(),
                kcl_lib::SourceRange::default(),
                &ModelingCmd::from(center_of_mass_req),
            )
            .await
            .map_err(into_kcl_exception)?;
        let OkWebSocketResponseData::Modeling {
            modeling_response: OkModelingCmdResponse::CenterOfMass(center_of_mass_resp),
        } = center_of_mass_resp
        else {
            return Err(pyo3::exceptions::PyException::new_err(format!(
                "Unexpected response from engine: {center_of_mass_resp:?}",
            )));
        };
        out.center_of_mass = Some(center_of_mass_resp);
    }
    // density
    if let Some(density_req) = density {
        let density_resp = ctx
            .engine
            .send_modeling_cmd(
                &ctx.engine_batch,
                uuid::Uuid::new_v4(),
                kcl_lib::SourceRange::default(),
                &ModelingCmd::from(density_req),
            )
            .await
            .map_err(into_kcl_exception)?;
        let OkWebSocketResponseData::Modeling {
            modeling_response: OkModelingCmdResponse::Density(density_resp),
        } = density_resp
        else {
            return Err(pyo3::exceptions::PyException::new_err(format!(
                "Unexpected response from engine: {density_resp:?}",
            )));
        };
        out.density = Some(density_resp);
    }
    // surface_area
    if let Some(surface_area_req) = surface_area {
        let surface_area_resp = ctx
            .engine
            .send_modeling_cmd(
                &ctx.engine_batch,
                uuid::Uuid::new_v4(),
                kcl_lib::SourceRange::default(),
                &ModelingCmd::from(surface_area_req),
            )
            .await
            .map_err(into_kcl_exception)?;
        let OkWebSocketResponseData::Modeling {
            modeling_response: OkModelingCmdResponse::SurfaceArea(surface_area_resp),
        } = surface_area_resp
        else {
            return Err(pyo3::exceptions::PyException::new_err(format!(
                "Unexpected response from engine: {surface_area_resp:?}",
            )));
        };
        out.surface_area = Some(surface_area_resp);
    }
    // Bounding box
    if let Some(bb_req) = bounding_box {
        let bb_resp = ctx
            .engine
            .send_modeling_cmd(
                &ctx.engine_batch,
                uuid::Uuid::new_v4(),
                kcl_lib::SourceRange::default(),
                &ModelingCmd::from(bb_req),
            )
            .await
            .map_err(into_kcl_exception)?;
        let OkWebSocketResponseData::Modeling {
            modeling_response: OkModelingCmdResponse::BoundingBox(bb_resp),
        } = bb_resp
        else {
            return Err(pyo3::exceptions::PyException::new_err(format!(
                "Unexpected response from engine: {bb_resp:?}",
            )));
        };
        out.bounding_box = Some(bb_resp);
    }

    Ok(out)
}

async fn get_bounding_box(
    ctx: &ExecutorContext,
    entity_ids: Vec<Uuid>,
    output_unit: Option<UnitLength>,
) -> PyResult<BoundingBoxResponse> {
    let bounding_box_resp = ctx
        .engine
        .send_modeling_cmd(
            &ctx.engine_batch,
            uuid::Uuid::new_v4(),
            kcl_lib::SourceRange::default(),
            &ModelingCmd::from(
                kcmc::BoundingBox::builder()
                    .maybe_output_unit(output_unit.map(ToKcmc::to_kcmc))
                    .entity_ids(entity_ids)
                    .build(),
            ),
        )
        .await
        .map_err(into_kcl_exception)?;
    let OkWebSocketResponseData::Modeling {
        modeling_response: OkModelingCmdResponse::BoundingBox(bounding_box_resp),
    } = bounding_box_resp
    else {
        return Err(pyo3::exceptions::PyException::new_err(format!(
            "Unexpected response from engine: {bounding_box_resp:?}",
        )));
    };

    Ok(bounding_box_resp.into())
}

/// Execute a kcl file and export it to a specific file format.
#[pyo3_stub_gen::derive::gen_stub_pyfunction]
#[pyfunction]
async fn execute_and_export(path: String, export_format: FileExportFormat) -> PyResult<Vec<RawFile>> {
    spawn_py(async move { execute_and_export_impl(KclInput::Path(path), export_format).await }).await
}

/// Execute the kcl code and export it to a specific file format.
#[pyo3_stub_gen::derive::gen_stub_pyfunction]
#[pyfunction]
async fn execute_code_and_export(code: String, export_format: FileExportFormat) -> PyResult<Vec<RawFile>> {
    spawn_py(async move { execute_and_export_impl(KclInput::Code(code), export_format).await }).await
}

/// Format the kcl code. This will return the formatted code.
#[pyo3_stub_gen::derive::gen_stub_pyfunction]
#[pyfunction]
fn format(code: String) -> PyResult<String> {
    let program = kcl_lib::Program::parse_no_errs(&code).map_err(|err| into_miette_for_parse("", &code, err))?;
    let recasted = program.recast();

    Ok(recasted)
}

/// Format a whole directory of kcl code.
#[pyo3_stub_gen::derive::gen_stub_pyfunction]
#[pyfunction]
async fn format_dir(dir: String) -> PyResult<()> {
    spawn_py(async move {
        kcl_lib::recast_dir(std::path::Path::new(&dir), &Default::default())
            .await
            .map_err(|err| pyo3::exceptions::PyException::new_err(err.to_string()))
    })
    .await
}

/// Lint the kcl code.
#[pyo3_stub_gen::derive::gen_stub_pyfunction]
#[pyfunction]
fn lint(code: String) -> PyResult<Vec<Discovered>> {
    let program = kcl_lib::Program::parse_no_errs(&code).map_err(|err| into_miette_for_parse("", &code, err))?;
    let lints = program
        .lint(checks::lint_variables)
        .map_err(|err| pyo3::exceptions::PyException::new_err(err.to_string()))?;

    Ok(lints)
}

/// Result from linting and fixing automatically.
/// Shows the new code after applying fixes,
/// and any lints that couldn't be automatically applied.
#[derive(Serialize, Debug, Clone)]
#[pyo3_stub_gen::derive::gen_stub_pyclass]
#[pyclass(from_py_object)]
pub struct FixedLints {
    /// Code after suggestions have been applied.
    pub new_code: String,
    /// Any lints that didn't have suggestions or couldn't be applied.
    pub unfixed_lints: Vec<Discovered>,
}

#[pymethods]
impl FixedLints {
    #[getter]
    fn unfixed_lints(&self) -> PyResult<Vec<Discovered>> {
        Ok(self.unfixed_lints.clone())
    }

    #[getter]
    fn new_code(&self) -> PyResult<String> {
        Ok(self.new_code.clone())
    }
}

/// Lint the kcl code. Fix any lints that can be fixed with automatic suggestions.
/// Returns any unfixed lints.
#[pyo3_stub_gen::derive::gen_stub_pyfunction]
#[pyfunction]
fn lint_and_fix_all(code: String) -> PyResult<FixedLints> {
    let (new_code, unfixed_lints) =
        kcl_lib::lint::lint_and_fix_all(code).map_err(|err| pyo3::exceptions::PyException::new_err(err.to_string()))?;
    Ok(FixedLints {
        new_code,
        unfixed_lints,
    })
}

/// Lint the kcl code. Fix any lints that can be fixed with automatic suggestions,
/// and are in the list of families to fix.
/// Returns any unfixed lints.
#[pyo3_stub_gen::derive::gen_stub_pyfunction]
#[pyfunction]
fn lint_and_fix_families(code: String, families_to_fix: Vec<FindingFamily>) -> PyResult<FixedLints> {
    let (new_code, unfixed_lints) = kcl_lib::lint::lint_and_fix_families(code, &families_to_fix)
        .map_err(|err| pyo3::exceptions::PyException::new_err(err.to_string()))?;
    Ok(FixedLints {
        new_code,
        unfixed_lints,
    })
}

/// The kcl python module.
#[pymodule]
fn kcl(_py: Python, m: &Bound<'_, PyModule>) -> PyResult<()> {
    // Add our types to the module.
    m.add_class::<PyKclError>()?;
    m.add_class::<DefaultUnits>()?;
    m.add_class::<ImageFormat>()?;
    m.add_class::<RawFile>()?;
    m.add_class::<FileExportFormat>()?;
    m.add_class::<Discovered>()?;
    m.add_class::<BoundingBoxResponse>()?;
    m.add_class::<PhysicalPropertiesRequest>()?;
    m.add_class::<PhysicalPropertiesResponse>()?;
    m.add_class::<SnapshotOptions>()?;
    m.add_class::<bridge::Point3d>()?;
    m.add_class::<bridge::CameraLookAt>()?;
    m.add_class::<kcmc::format::InputFormat3d>()?;
    m.add_class::<FindingFamily>()?;
    m.add_class::<bridge::sketch_constraints::ConstraintKind>()?;
    m.add_class::<bridge::sketch_constraints::KclErrorInfo>()?;
    m.add_class::<bridge::sketch_constraints::SketchConstraintStatus>()?;
    m.add_class::<bridge::sketch_constraints::SketchConstraintReport>()?;

    m.add_class::<kcl_api::UnitAngle>()?;
    m.add_class::<kcl_api::UnitArea>()?;
    m.add_class::<kcl_api::UnitDensity>()?;
    m.add_class::<kcl_api::UnitLength>()?;
    m.add_class::<kcl_api::UnitMass>()?;
    m.add_class::<kcl_api::UnitVolume>()?;

    // These are fine to add top level since we rename them in pyo3 derives.
    m.add_class::<kcmc::format::step::import::Options>()?;
    m.add_class::<kcmc::format::step::export::Options>()?;
    m.add_class::<kcmc::format::gltf::import::Options>()?;
    m.add_class::<kcmc::format::gltf::export::Options>()?;
    m.add_class::<kcmc::format::obj::import::Options>()?;
    m.add_class::<kcmc::format::obj::export::Options>()?;
    m.add_class::<kcmc::format::ply::import::Options>()?;
    m.add_class::<kcmc::format::ply::export::Options>()?;
    m.add_class::<kcmc::format::stl::import::Options>()?;
    m.add_class::<kcmc::format::stl::export::Options>()?;
    m.add_class::<kcmc::format::sldprt::import::Options>()?;

    // Add our functions to the module.
    m.add_function(wrap_pyfunction!(parse, m)?)?;
    m.add_function(wrap_pyfunction!(default_units, m)?)?;
    m.add_function(wrap_pyfunction!(parse_code, m)?)?;
    m.add_function(wrap_pyfunction!(execute, m)?)?;
    m.add_function(wrap_pyfunction!(execute_code, m)?)?;
    m.add_function(wrap_pyfunction!(mock_execute, m)?)?;
    m.add_function(wrap_pyfunction!(mock_execute_code, m)?)?;
    m.add_function(wrap_pyfunction!(get_sketch_constraint_status, m)?)?;
    m.add_function(wrap_pyfunction!(get_sketch_constraint_status_code, m)?)?;
    m.add_function(wrap_pyfunction!(execute_and_snapshot, m)?)?;
    m.add_function(wrap_pyfunction!(execute_and_snapshot_views, m)?)?;
    m.add_function(wrap_pyfunction!(execute_code_and_snapshot, m)?)?;
    m.add_function(wrap_pyfunction!(execute_code_and_snapshot_views, m)?)?;
    m.add_function(wrap_pyfunction!(execute_and_measure, m)?)?;
    m.add_function(wrap_pyfunction!(execute_code_and_measure, m)?)?;
    m.add_function(wrap_pyfunction!(execute_and_bounding_box, m)?)?;
    m.add_function(wrap_pyfunction!(execute_code_and_bounding_box, m)?)?;
    m.add_function(wrap_pyfunction!(import_and_snapshot, m)?)?;
    m.add_function(wrap_pyfunction!(import_and_snapshot_views, m)?)?;
    m.add_function(wrap_pyfunction!(execute_and_export, m)?)?;
    m.add_function(wrap_pyfunction!(execute_code_and_export, m)?)?;
    m.add_function(wrap_pyfunction!(format, m)?)?;
    m.add_function(wrap_pyfunction!(format_dir, m)?)?;
    m.add_function(wrap_pyfunction!(lint, m)?)?;
    m.add_function(wrap_pyfunction!(lint_and_fix_all, m)?)?;
    m.add_function(wrap_pyfunction!(lint_and_fix_families, m)?)?;
    m.add_function(wrap_pyfunction!(relevant_file_extensions, m)?)?;

    m.add("PanicException", _py.get_type::<pyo3::panic::PanicException>())?;

    Ok(())
}

// Define a function to gather stub information.
define_stub_info_gatherer!(stub_info);

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn executor_settings_preserve_default_edge_visibility_without_override() {
        let settings = executor_settings(None, None);

        assert!(settings.highlight_edges);
    }

    #[test]
    fn executor_settings_apply_edge_visibility_override() {
        let settings = executor_settings(None, Some(false));

        assert!(!settings.highlight_edges);
    }

    /// Cube and cylinder positioned so they do not overlap, then subtracted.
    /// The engine should report no intersection, which the executor records as
    /// a no-overlap warning on the `subtract(...)` source range.
    const NO_OVERLAP_SUBTRACT_KCL: &str = r#"@settings(kclVersion = 2.0)

cubeSketch = sketch(on = XY) {
  bottom = line(start = [var 0, var 0], end = [var 10, var 0])
  right = line(start = [var 10, var 0], end = [var 10, var 10])
  top = line(start = [var 10, var 10], end = [var 0, var 10])
  left = line(start = [var 0, var 10], end = [var 0, var 0])
  coincident([bottom.end, right.start])
  coincident([right.end, top.start])
  coincident([top.end, left.start])
  coincident([left.end, bottom.start])
}
cube = extrude(region(point = [5, 5], sketch = cubeSketch), length = 10)

cylinderSketch = sketch(on = XY) {
  c = circle(start = [var 102, var 100], center = [var 100, var 100])
}
hidden001 = hide(cylinderSketch)
region001 = region(point = [98.0025mm, 100mm], sketch = cylinderSketch)
cylinder = extrude(region001, length = 10)

result = subtract(cube, tools = [cylinder])
"#;

    #[tokio::test(flavor = "multi_thread")]
    async fn exec_outcome_report_renders_csg_no_overlap_warning() {
        let outcome = execute_impl(KclInput::Code(NO_OVERLAP_SUBTRACT_KCL.to_string()), false)
            .await
            .expect("execute_impl should succeed for valid non-overlapping subtract");

        let warning = outcome
            .issues
            .iter()
            .find(|issue| issue.is_warning())
            .unwrap_or_else(|| panic!("expected at least one warning issue, got: {:?}", outcome.issues));
        assert!(!warning.is_err());
        assert!(!warning.is_fatal());

        let report = outcome.report(warning);

        assert!(
            report.contains("had no overlap"),
            "report missing warning message text: {report}"
        );
        // The labeled span should point at the `subtract(...)` call site, so
        // that line of the KCL source should appear in the rendered snippet.
        assert!(
            report.contains("result = subtract(cube, tools = [cylinder])"),
            "report should include the subtract call from the source snippet: {report}"
        );
        // miette renders a line:column header for the labeled span. The
        // `subtract` call is on line 18, column 10 of the KCL source.
        assert!(
            report.contains("[22:10]"),
            "report should include a line:column marker for the source span: {report}"
        );
    }
}
