#![allow(clippy::useless_conversion)]
use anyhow::Result;
use kcl_lib::{
    lint::{checks, Discovered, FindingFamily},
    ExecutorContext,
};
use kittycad_modeling_cmds::{
    self as kcmc, format::InputFormat3d, shared::FileExportFormat, units::UnitLength, websocket::RawFile, ImageFormat,
    ImportFile,
};
use pyo3::{
    exceptions::PyException, prelude::PyModuleMethods, pyclass, pyfunction, pymethods, pymodule, types::PyModule,
    wrap_pyfunction, Bound, PyErr, PyResult, Python,
};
use pyo3_stub_gen::define_stub_info_gatherer;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

mod bridge;

fn tokio() -> &'static tokio::runtime::Runtime {
    use std::sync::OnceLock;
    static RT: OnceLock<tokio::runtime::Runtime> = OnceLock::new();
    RT.get_or_init(|| tokio::runtime::Runtime::new().unwrap())
}

fn into_miette(error: kcl_lib::KclErrorWithOutputs, code: &str) -> PyErr {
    let report = error.into_miette_report_with_outputs(code).unwrap();
    let report = miette::Report::new(report);
    pyo3::exceptions::PyException::new_err(format!("{report:?}"))
}

fn into_miette_for_parse(filename: &str, input: &str, error: kcl_lib::KclError) -> PyErr {
    let report = kcl_lib::Report {
        kcl_source: input.to_string(),
        error,
        filename: filename.to_string(),
    };
    let report = miette::Report::new(report);
    pyo3::exceptions::PyException::new_err(format!("{report:?}"))
}

fn get_output_format(
    format: &FileExportFormat,
    src_unit: UnitLength,
) -> kittycad_modeling_cmds::format::OutputFormat3d {
    // Zoo co-ordinate system.
    //
    // * Forward: -Y
    // * Up: +Z
    // * Handedness: Right
    let coords = kittycad_modeling_cmds::coord::System {
        forward: kittycad_modeling_cmds::coord::AxisDirectionPair {
            axis: kittycad_modeling_cmds::coord::Axis::Y,
            direction: kittycad_modeling_cmds::coord::Direction::Negative,
        },
        up: kittycad_modeling_cmds::coord::AxisDirectionPair {
            axis: kittycad_modeling_cmds::coord::Axis::Z,
            direction: kittycad_modeling_cmds::coord::Direction::Positive,
        },
    };

    match format {
        FileExportFormat::Fbx => {
            kittycad_modeling_cmds::format::OutputFormat3d::Fbx(kittycad_modeling_cmds::format::fbx::export::Options {
                storage: kittycad_modeling_cmds::format::fbx::export::Storage::Binary,
                created: None,
            })
        }
        FileExportFormat::Glb => kittycad_modeling_cmds::format::OutputFormat3d::Gltf(
            kittycad_modeling_cmds::format::gltf::export::Options {
                storage: kittycad_modeling_cmds::format::gltf::export::Storage::Binary,
                presentation: kittycad_modeling_cmds::format::gltf::export::Presentation::Compact,
            },
        ),
        FileExportFormat::Gltf => kittycad_modeling_cmds::format::OutputFormat3d::Gltf(
            kittycad_modeling_cmds::format::gltf::export::Options {
                storage: kittycad_modeling_cmds::format::gltf::export::Storage::Embedded,
                presentation: kittycad_modeling_cmds::format::gltf::export::Presentation::Pretty,
            },
        ),
        FileExportFormat::Obj => {
            kittycad_modeling_cmds::format::OutputFormat3d::Obj(kittycad_modeling_cmds::format::obj::export::Options {
                coords,
                units: src_unit,
            })
        }
        FileExportFormat::Ply => {
            kittycad_modeling_cmds::format::OutputFormat3d::Ply(kittycad_modeling_cmds::format::ply::export::Options {
                storage: kittycad_modeling_cmds::format::ply::export::Storage::Ascii,
                coords,
                selection: kittycad_modeling_cmds::format::Selection::DefaultScene,
                units: src_unit,
            })
        }
        FileExportFormat::Step => kittycad_modeling_cmds::format::OutputFormat3d::Step(
            kittycad_modeling_cmds::format::step::export::Options { coords, created: None },
        ),
        FileExportFormat::Stl => {
            kittycad_modeling_cmds::format::OutputFormat3d::Stl(kittycad_modeling_cmds::format::stl::export::Options {
                storage: kittycad_modeling_cmds::format::stl::export::Storage::Ascii,
                coords,
                units: src_unit,
                selection: kittycad_modeling_cmds::format::Selection::DefaultScene,
            })
        }
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
        if let Some(ext) = path.extension() {
            if ext != "kcl" {
                return Err(anyhow::anyhow!("File must have a .kcl extension"));
            }
        }
    }

    let code = tokio::fs::read_to_string(&path).await?;
    Ok((code, path))
}

async fn new_context_state(
    current_file: Option<std::path::PathBuf>,
    mock: bool,
) -> Result<(ExecutorContext, kcl_lib::ExecState)> {
    let mut settings: kcl_lib::ExecutorSettings = Default::default();
    if let Some(current_file) = current_file {
        settings.with_current_file(kcl_lib::TypedPath(current_file));
    }
    let ctx = if mock {
        ExecutorContext::new_mock(Some(settings)).await
    } else {
        ExecutorContext::new_with_client(settings, None, None).await?
    };
    let state = kcl_lib::ExecState::new(&ctx);
    Ok((ctx, state))
}

/// Parse the kcl code from a file path.
#[pyo3_stub_gen::derive::gen_stub_pyfunction]
#[pyfunction]
async fn parse(path: String) -> PyResult<bool> {
    tokio()
        .spawn(async move {
            let (code, path) = get_code_and_file_path(&path)
                .await
                .map_err(|err| pyo3::exceptions::PyException::new_err(err.to_string()))?;
            let _program = kcl_lib::Program::parse_no_errs(&code)
                .map_err(|err| into_miette_for_parse(&path.display().to_string(), &code, err))?;

            Ok(true)
        })
        .await
        .map_err(|err| pyo3::exceptions::PyException::new_err(err.to_string()))?
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
async fn execute(path: String) -> PyResult<()> {
    tokio()
        .spawn(async move {
            let (code, path) = get_code_and_file_path(&path)
                .await
                .map_err(|err| pyo3::exceptions::PyException::new_err(err.to_string()))?;
            let program = kcl_lib::Program::parse_no_errs(&code)
                .map_err(|err| into_miette_for_parse(&path.display().to_string(), &code, err))?;

            let (ctx, mut state) = new_context_state(Some(path), false)
                .await
                .map_err(|err| pyo3::exceptions::PyException::new_err(err.to_string()))?;
            // Execute the program.
            ctx.run(&program, &mut state)
                .await
                .map_err(|err| into_miette(err, &code))?;

            ctx.close().await;
            Ok(())
        })
        .await
        .map_err(|err| pyo3::exceptions::PyException::new_err(err.to_string()))?
}

/// Execute the kcl code.
#[pyo3_stub_gen::derive::gen_stub_pyfunction]
#[pyfunction]
async fn execute_code(code: String) -> PyResult<()> {
    tokio()
        .spawn(async move {
            let program =
                kcl_lib::Program::parse_no_errs(&code).map_err(|err| into_miette_for_parse("", &code, err))?;

            let (ctx, mut state) = new_context_state(None, false)
                .await
                .map_err(|err| pyo3::exceptions::PyException::new_err(err.to_string()))?;
            // Execute the program.
            ctx.run(&program, &mut state)
                .await
                .map_err(|err| into_miette(err, &code))?;

            ctx.close().await;
            Ok(())
        })
        .await
        .map_err(|err| pyo3::exceptions::PyException::new_err(err.to_string()))?
}

/// Mock execute the kcl code.
#[pyo3_stub_gen::derive::gen_stub_pyfunction]
#[pyfunction]
async fn mock_execute_code(code: String) -> PyResult<bool> {
    tokio()
        .spawn(async move {
            let program =
                kcl_lib::Program::parse_no_errs(&code).map_err(|err| into_miette_for_parse("", &code, err))?;

            let (ctx, mut state) = new_context_state(None, true)
                .await
                .map_err(|err| pyo3::exceptions::PyException::new_err(err.to_string()))?;
            // Execute the program.
            ctx.run(&program, &mut state)
                .await
                .map_err(|err| into_miette(err, &code))?;

            ctx.close().await;
            Ok(true)
        })
        .await
        .map_err(|err| pyo3::exceptions::PyException::new_err(err.to_string()))?
}

/// Mock execute the kcl code from a file path.
#[pyo3_stub_gen::derive::gen_stub_pyfunction]
#[pyfunction]
async fn mock_execute(path: String) -> PyResult<bool> {
    tokio()
        .spawn(async move {
            let (code, path) = get_code_and_file_path(&path)
                .await
                .map_err(|err| pyo3::exceptions::PyException::new_err(err.to_string()))?;
            let program = kcl_lib::Program::parse_no_errs(&code)
                .map_err(|err| into_miette_for_parse(&path.display().to_string(), &code, err))?;

            let (ctx, mut state) = new_context_state(Some(path), true)
                .await
                .map_err(|err| pyo3::exceptions::PyException::new_err(err.to_string()))?;
            // Execute the program.
            ctx.run(&program, &mut state)
                .await
                .map_err(|err| into_miette(err, &code))?;

            ctx.close().await;
            Ok(true)
        })
        .await
        .map_err(|err| pyo3::exceptions::PyException::new_err(err.to_string()))?
}

#[pyo3_stub_gen::derive::gen_stub_pyfunction]
#[pyfunction]
async fn import_and_snapshot(
    filepaths: Vec<String>,
    format: InputFormat3d,
    image_format: ImageFormat,
) -> PyResult<Vec<u8>> {
    let img = import_and_snapshot_views(filepaths, format, image_format, Vec::new())
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
#[pyfunction]
async fn import_and_snapshot_views(
    filepaths: Vec<String>,
    format: InputFormat3d,
    image_format: ImageFormat,
    snapshot_options: Vec<SnapshotOptions>,
) -> PyResult<Vec<Vec<u8>>> {
    tokio()
        .spawn(async move {
            let (ctx, _state) = new_context_state(None, false).await.map_err(to_py_exception)?;
            import(&ctx, filepaths, format).await?;
            let result = take_snaps(&ctx, image_format, snapshot_options).await;
            ctx.close().await;
            result
        })
        .await
        .map_err(|err| pyo3::exceptions::PyException::new_err(err.to_string()))?
}

/// Return the ID of the imported object.
async fn import(ctx: &ExecutorContext, filepaths: Vec<String>, format: InputFormat3d) -> PyResult<Uuid> {
    let mut files = Vec::with_capacity(filepaths.len());
    for filepath in filepaths {
        let file_contents = tokio::fs::read(&filepath).await.map_err(to_py_exception)?;
        files.push(ImportFile {
            path: filepath,
            data: file_contents,
        });
    }
    let resp = ctx
        .engine
        .send_modeling_cmd(
            Uuid::new_v4().into(),
            Default::default(),
            &kcmc::ModelingCmd::ImportFiles(kcmc::ImportFiles::builder().files(files).format(format).build()),
        )
        .await?;
    let kittycad_modeling_cmds::websocket::OkWebSocketResponseData::Modeling {
        modeling_response: kittycad_modeling_cmds::ok_response::OkModelingCmdResponse::ImportFiles(data),
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
#[pyfunction]
async fn execute_and_snapshot(path: String, image_format: ImageFormat) -> PyResult<Vec<u8>> {
    let img = execute_and_snapshot_views(path, image_format, Vec::new()).await?.pop();
    Ok(img.unwrap())
}

#[pyo3_stub_gen::derive::gen_stub_pyfunction]
#[pyfunction]
async fn execute_and_snapshot_views(
    path: String,
    image_format: ImageFormat,
    snapshot_options: Vec<SnapshotOptions>,
) -> PyResult<Vec<Vec<u8>>> {
    tokio()
        .spawn(async move {
            let (code, path) = get_code_and_file_path(&path)
                .await
                .map_err(|err| pyo3::exceptions::PyException::new_err(err.to_string()))?;
            let program = kcl_lib::Program::parse_no_errs(&code)
                .map_err(|err| into_miette_for_parse(&path.display().to_string(), &code, err))?;

            let (ctx, mut state) = new_context_state(Some(path), false)
                .await
                .map_err(|err| pyo3::exceptions::PyException::new_err(err.to_string()))?;
            // Execute the program.
            ctx.run(&program, &mut state)
                .await
                .map_err(|err| into_miette(err, &code))?;

            let result = take_snaps(&ctx, image_format, snapshot_options).await;

            ctx.close().await;
            result
        })
        .await
        .map_err(|err| pyo3::exceptions::PyException::new_err(err.to_string()))?
}

/// Execute the kcl code and snapshot it in a specific format.
#[pyo3_stub_gen::derive::gen_stub_pyfunction]
#[pyfunction]
async fn execute_code_and_snapshot(code: String, image_format: ImageFormat) -> PyResult<Vec<u8>> {
    let mut snaps = execute_code_and_snapshot_views(code, image_format, Vec::new()).await?;
    Ok(snaps.pop().unwrap())
}

/// Customize a snapshot.
#[derive(Serialize, Deserialize, PartialEq, Debug, Clone)]
#[pyo3_stub_gen::derive::gen_stub_pyclass]
#[pyclass]
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
#[pyfunction]
async fn execute_code_and_snapshot_views(
    code: String,
    image_format: ImageFormat,
    snapshot_options: Vec<SnapshotOptions>,
) -> PyResult<Vec<Vec<u8>>> {
    tokio()
        .spawn(async move {
            let program =
                kcl_lib::Program::parse_no_errs(&code).map_err(|err| into_miette_for_parse("", &code, err))?;

            let (ctx, mut state) = new_context_state(None, false)
                .await
                .map_err(|err| pyo3::exceptions::PyException::new_err(err.to_string()))?;
            // Execute the program.
            ctx.run(&program, &mut state)
                .await
                .map_err(|err| into_miette(err, &code))?;

            let result = take_snaps(&ctx, image_format, snapshot_options).await;

            ctx.close().await;
            result
        })
        .await
        .map_err(|err| pyo3::exceptions::PyException::new_err(err.to_string()))?
}

async fn take_snaps(
    ctx: &ExecutorContext,
    image_format: ImageFormat,
    snapshot_options: Vec<SnapshotOptions>,
) -> PyResult<Vec<Vec<u8>>> {
    if snapshot_options.is_empty() {
        let data_bytes = snapshot(ctx, image_format, 0.1).await?;
        return Ok(vec![data_bytes]);
    }

    let mut snaps = Vec::with_capacity(snapshot_options.len());
    for pre_snap in snapshot_options {
        if let Some(camera) = pre_snap.camera {
            let view_cmd = kcmc::DefaultCameraLookAt::from(camera);
            let view_cmd = kcmc::ModelingCmd::DefaultCameraLookAt(view_cmd);
            ctx.engine
                .send_modeling_cmd(uuid::Uuid::new_v4(), Default::default(), &view_cmd)
                .await?;
        } else {
            let view_cmd = kcmc::ModelingCmd::ViewIsometric(kcmc::ViewIsometric::builder().padding(0.0).build());
            ctx.engine
                .send_modeling_cmd(uuid::Uuid::new_v4(), Default::default(), &view_cmd)
                .await?;
        }
        let data_bytes = snapshot(ctx, image_format, pre_snap.padding).await?;
        snaps.push(data_bytes);
    }
    Ok(snaps)
}

async fn snapshot(ctx: &ExecutorContext, image_format: ImageFormat, padding: f32) -> PyResult<Vec<u8>> {
    // Set orthographic projection
    ctx.engine
        .send_modeling_cmd(
            uuid::Uuid::new_v4(),
            kcl_lib::SourceRange::default(),
            &kittycad_modeling_cmds::ModelingCmd::DefaultCameraSetOrthographic(
                kittycad_modeling_cmds::DefaultCameraSetOrthographic::builder().build(),
            ),
        )
        .await?;

    // Zoom to fit.
    ctx.engine
        .send_modeling_cmd(
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
        .await?;

    // Send a snapshot request to the engine.
    let resp = ctx
        .engine
        .send_modeling_cmd(
            uuid::Uuid::new_v4(),
            kcl_lib::SourceRange::default(),
            &kittycad_modeling_cmds::ModelingCmd::TakeSnapshot(
                kittycad_modeling_cmds::TakeSnapshot::builder()
                    .format(image_format.into())
                    .build(),
            ),
        )
        .await?;

    let kittycad_modeling_cmds::websocket::OkWebSocketResponseData::Modeling {
        modeling_response: kittycad_modeling_cmds::ok_response::OkModelingCmdResponse::TakeSnapshot(data),
    } = resp
    else {
        return Err(pyo3::exceptions::PyException::new_err(format!(
            "Unexpected response from engine: {resp:?}",
        )));
    };

    Ok(data.contents.0)
}

/// Execute a kcl file and export it to a specific file format.
#[pyo3_stub_gen::derive::gen_stub_pyfunction]
#[pyfunction]
async fn execute_and_export(path: String, export_format: FileExportFormat) -> PyResult<Vec<RawFile>> {
    tokio()
        .spawn(async move {
            let (code, path) = get_code_and_file_path(&path)
                .await
                .map_err(|err| pyo3::exceptions::PyException::new_err(err.to_string()))?;
            let program = kcl_lib::Program::parse_no_errs(&code)
                .map_err(|err| into_miette_for_parse(&path.display().to_string(), &code, err))?;

            let (ctx, mut state) = new_context_state(Some(path.clone()), false)
                .await
                .map_err(|err| pyo3::exceptions::PyException::new_err(err.to_string()))?;
            // Execute the program.
            ctx.run(&program, &mut state)
                .await
                .map_err(|err| into_miette(err, &code))?;

            let settings = program
                .meta_settings()
                .map_err(|err| into_miette_for_parse(&path.display().to_string(), &code, err))?
                .unwrap_or_default();
            let units: UnitLength = settings.default_length_units.into();

            // This will not return until there are files.
            let resp = ctx
                .engine
                .send_modeling_cmd(
                    uuid::Uuid::new_v4(),
                    kcl_lib::SourceRange::default(),
                    &kittycad_modeling_cmds::ModelingCmd::Export(
                        kittycad_modeling_cmds::Export::builder()
                            .entity_ids(vec![])
                            .format(get_output_format(&export_format, units.into()))
                            .build(),
                    ),
                )
                .await?;

            ctx.close().await;
            drop(ctx);

            let kittycad_modeling_cmds::websocket::OkWebSocketResponseData::Export { files } = resp else {
                return Err(pyo3::exceptions::PyException::new_err(format!(
                    "Unexpected response from engine: {resp:?}"
                )));
            };

            Ok(files)
        })
        .await
        .map_err(|err| pyo3::exceptions::PyException::new_err(err.to_string()))?
}

/// Execute the kcl code and export it to a specific file format.
#[pyo3_stub_gen::derive::gen_stub_pyfunction]
#[pyfunction]
async fn execute_code_and_export(code: String, export_format: FileExportFormat) -> PyResult<Vec<RawFile>> {
    tokio()
        .spawn(async move {
            let program =
                kcl_lib::Program::parse_no_errs(&code).map_err(|err| into_miette_for_parse("", &code, err))?;

            let (ctx, mut state) = new_context_state(None, false)
                .await
                .map_err(|err| pyo3::exceptions::PyException::new_err(err.to_string()))?;
            // Execute the program.
            ctx.run(&program, &mut state)
                .await
                .map_err(|err| into_miette(err, &code))?;

            let settings = program
                .meta_settings()
                .map_err(|err| into_miette_for_parse("", &code, err))?
                .unwrap_or_default();
            let units: UnitLength = settings.default_length_units.into();

            // This will not return until there are files.
            let resp = ctx
                .engine
                .send_modeling_cmd(
                    uuid::Uuid::new_v4(),
                    kcl_lib::SourceRange::default(),
                    &kittycad_modeling_cmds::ModelingCmd::Export(
                        kittycad_modeling_cmds::Export::builder()
                            .entity_ids(vec![])
                            .format(get_output_format(&export_format, units.into()))
                            .build(),
                    ),
                )
                .await?;

            ctx.close().await;
            drop(ctx);

            let kittycad_modeling_cmds::websocket::OkWebSocketResponseData::Export { files } = resp else {
                return Err(pyo3::exceptions::PyException::new_err(format!(
                    "Unexpected response from engine: {resp:?}"
                )));
            };

            Ok(files)
        })
        .await
        .map_err(|err| pyo3::exceptions::PyException::new_err(err.to_string()))?
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
    tokio()
        .spawn(async move {
            kcl_lib::recast_dir(std::path::Path::new(&dir), &Default::default())
                .await
                .map_err(|err| pyo3::exceptions::PyException::new_err(err.to_string()))
        })
        .await
        .map_err(|err| pyo3::exceptions::PyException::new_err(err.to_string()))?
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
#[pyclass]
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
    m.add_class::<ImageFormat>()?;
    m.add_class::<RawFile>()?;
    m.add_class::<FileExportFormat>()?;
    m.add_class::<UnitLength>()?;
    m.add_class::<Discovered>()?;
    m.add_class::<SnapshotOptions>()?;
    m.add_class::<bridge::Point3d>()?;
    m.add_class::<bridge::CameraLookAt>()?;
    m.add_class::<kcmc::format::InputFormat3d>()?;
    m.add_class::<FindingFamily>()?;

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
    m.add_function(wrap_pyfunction!(parse_code, m)?)?;
    m.add_function(wrap_pyfunction!(execute, m)?)?;
    m.add_function(wrap_pyfunction!(execute_code, m)?)?;
    m.add_function(wrap_pyfunction!(mock_execute, m)?)?;
    m.add_function(wrap_pyfunction!(mock_execute_code, m)?)?;
    m.add_function(wrap_pyfunction!(execute_and_snapshot, m)?)?;
    m.add_function(wrap_pyfunction!(execute_and_snapshot_views, m)?)?;
    m.add_function(wrap_pyfunction!(execute_code_and_snapshot, m)?)?;
    m.add_function(wrap_pyfunction!(execute_code_and_snapshot_views, m)?)?;
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
    Ok(())
}

// Define a function to gather stub information.
define_stub_info_gatherer!(stub_info);
