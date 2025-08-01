#![allow(clippy::useless_conversion)]
use anyhow::Result;
use kcl_lib::{
    lint::{checks, Discovered},
    ExecutorContext, UnitLength,
};
use kittycad_modeling_cmds::{self as kcmc, format::InputFormat3d, ImportFile};
use pyo3::{
    exceptions::PyException, prelude::PyModuleMethods, pyclass, pyfunction, pymethods, pymodule, types::PyModule,
    wrap_pyfunction, Bound, PyErr, PyResult, Python,
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

mod bridge;

fn tokio() -> &'static tokio::runtime::Runtime {
    use std::sync::OnceLock;
    static RT: OnceLock<tokio::runtime::Runtime> = OnceLock::new();
    RT.get_or_init(|| tokio::runtime::Runtime::new().unwrap())
}

fn into_miette(error: kcl_lib::KclErrorWithOutputs, code: &str) -> PyErr {
    let report = error.clone().into_miette_report_with_outputs(code).unwrap();
    let report = miette::Report::new(report);
    pyo3::exceptions::PyException::new_err(format!("{report:?}"))
}

fn into_miette_for_parse(filename: &str, input: &str, error: kcl_lib::KclError) -> PyErr {
    let report = kcl_lib::Report {
        kcl_source: input.to_string(),
        error: error.clone(),
        filename: filename.to_string(),
    };
    let report = miette::Report::new(report);
    pyo3::exceptions::PyException::new_err(format!("{report:?}"))
}

/// The variety of image formats snapshots may be exported to.
#[derive(Serialize, Deserialize, PartialEq, Hash, Debug, Clone, Copy)]
#[pyclass(eq, eq_int)]
#[serde(rename_all = "lowercase")]
pub enum ImageFormat {
    /// .png format
    Png,
    /// .jpeg format
    Jpeg,
}

impl From<ImageFormat> for kittycad_modeling_cmds::ImageFormat {
    fn from(format: ImageFormat) -> Self {
        match format {
            ImageFormat::Png => kittycad_modeling_cmds::ImageFormat::Png,
            ImageFormat::Jpeg => kittycad_modeling_cmds::ImageFormat::Jpeg,
        }
    }
}

/// A file that was exported from the engine.
#[derive(Serialize, Deserialize, PartialEq, Debug, Clone)]
#[pyclass]
pub struct ExportFile {
    /// Binary contents of the file.
    pub contents: Vec<u8>,
    /// Name of the file.
    pub name: String,
}

impl From<kittycad_modeling_cmds::shared::ExportFile> for ExportFile {
    fn from(file: kittycad_modeling_cmds::shared::ExportFile) -> Self {
        ExportFile {
            contents: file.contents.0,
            name: file.name,
        }
    }
}

impl From<kittycad_modeling_cmds::websocket::RawFile> for ExportFile {
    fn from(file: kittycad_modeling_cmds::websocket::RawFile) -> Self {
        ExportFile {
            contents: file.contents,
            name: file.name,
        }
    }
}

#[pymethods]
impl ExportFile {
    #[getter]
    fn contents(&self) -> Vec<u8> {
        self.contents.clone()
    }

    #[getter]
    fn name(&self) -> String {
        self.name.clone()
    }
}

/// The valid types of output file formats.
#[derive(Serialize, Deserialize, PartialEq, Hash, Debug, Clone)]
#[pyclass(eq, eq_int)]
#[serde(rename_all = "lowercase")]
pub enum FileExportFormat {
    /// Autodesk Filmbox (FBX) format. <https://en.wikipedia.org/wiki/FBX>
    Fbx,
    /// Binary glTF 2.0.
    ///
    /// This is a single binary with .glb extension.
    ///
    /// This is better if you want a compressed format as opposed to the human readable glTF that lacks
    /// compression.
    Glb,
    /// glTF 2.0. Embedded glTF 2.0 (pretty printed).
    ///
    /// Single JSON file with .gltf extension binary data encoded as base64 data URIs.
    ///
    /// The JSON contents are pretty printed.
    ///
    /// It is human readable, single file, and you can view the diff easily in a
    /// git commit.
    Gltf,
    /// The OBJ file format. <https://en.wikipedia.org/wiki/Wavefront_.obj_file> It may or
    /// may not have an an attached material (mtl // mtllib) within the file, but we
    /// interact with it as if it does not.
    Obj,
    /// The PLY file format. <https://en.wikipedia.org/wiki/PLY_(file_format)>
    Ply,
    /// The STEP file format. <https://en.wikipedia.org/wiki/ISO_10303-21>
    Step,
    /// The STL file format. <https://en.wikipedia.org/wiki/STL_(file_format)>
    Stl,
}

fn get_output_format(
    format: &FileExportFormat,
    src_unit: kittycad_modeling_cmds::units::UnitLength,
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
#[pyfunction]
fn parse_code(code: String) -> PyResult<bool> {
    let _program = kcl_lib::Program::parse_no_errs(&code).map_err(|err| into_miette_for_parse("", &code, err))?;

    Ok(true)
}

/// Execute the kcl code from a file path.
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

            Ok(())
        })
        .await
        .map_err(|err| pyo3::exceptions::PyException::new_err(err.to_string()))?
}

/// Execute the kcl code.
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

            Ok(())
        })
        .await
        .map_err(|err| pyo3::exceptions::PyException::new_err(err.to_string()))?
}

/// Mock execute the kcl code.
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

            Ok(true)
        })
        .await
        .map_err(|err| pyo3::exceptions::PyException::new_err(err.to_string()))?
}

/// Mock execute the kcl code from a file path.
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

            Ok(true)
        })
        .await
        .map_err(|err| pyo3::exceptions::PyException::new_err(err.to_string()))?
}

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
            take_snaps(&ctx, image_format, snapshot_options).await
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
            &kcmc::ModelingCmd::ImportFiles(kcmc::ImportFiles { files, format }),
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
#[pyfunction]
async fn execute_and_snapshot(path: String, image_format: ImageFormat) -> PyResult<Vec<u8>> {
    let img = execute_and_snapshot_views(path, image_format, Vec::new()).await?.pop();
    Ok(img.unwrap())
}

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

            take_snaps(&ctx, image_format, snapshot_options).await
        })
        .await
        .map_err(|err| pyo3::exceptions::PyException::new_err(err.to_string()))?
}

/// Execute the kcl code and snapshot it in a specific format.
#[pyfunction]
async fn execute_code_and_snapshot(code: String, image_format: ImageFormat) -> PyResult<Vec<u8>> {
    let mut snaps = execute_code_and_snapshot_views(code, image_format, Vec::new()).await?;
    Ok(snaps.pop().unwrap())
}

/// Customize a snapshot.
#[derive(Serialize, Deserialize, PartialEq, Debug, Clone)]
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

            take_snaps(&ctx, image_format, snapshot_options).await
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
            let view_cmd = kcmc::ModelingCmd::ViewIsometric(kcmc::ViewIsometric { padding: 0.0 });
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
    // Zoom to fit.
    ctx.engine
        .send_modeling_cmd(
            uuid::Uuid::new_v4(),
            kcl_lib::SourceRange::default(),
            &kittycad_modeling_cmds::ModelingCmd::ZoomToFit(kittycad_modeling_cmds::ZoomToFit {
                object_ids: Default::default(),
                padding,
                animated: false,
            }),
        )
        .await?;

    // Send a snapshot request to the engine.
    let resp = ctx
        .engine
        .send_modeling_cmd(
            uuid::Uuid::new_v4(),
            kcl_lib::SourceRange::default(),
            &kittycad_modeling_cmds::ModelingCmd::TakeSnapshot(kittycad_modeling_cmds::TakeSnapshot {
                format: image_format.into(),
            }),
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
#[pyfunction]
async fn execute_and_export(path: String, export_format: FileExportFormat) -> PyResult<Vec<ExportFile>> {
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
                    &kittycad_modeling_cmds::ModelingCmd::Export(kittycad_modeling_cmds::Export {
                        entity_ids: vec![],
                        format: get_output_format(&export_format, units.into()),
                    }),
                )
                .await?;

            let kittycad_modeling_cmds::websocket::OkWebSocketResponseData::Export { files } = resp else {
                return Err(pyo3::exceptions::PyException::new_err(format!(
                    "Unexpected response from engine: {resp:?}"
                )));
            };

            Ok(files.into_iter().map(ExportFile::from).collect())
        })
        .await
        .map_err(|err| pyo3::exceptions::PyException::new_err(err.to_string()))?
}

/// Execute the kcl code and export it to a specific file format.
#[pyfunction]
async fn execute_code_and_export(code: String, export_format: FileExportFormat) -> PyResult<Vec<ExportFile>> {
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
                    &kittycad_modeling_cmds::ModelingCmd::Export(kittycad_modeling_cmds::Export {
                        entity_ids: vec![],
                        format: get_output_format(&export_format, units.into()),
                    }),
                )
                .await?;

            let kittycad_modeling_cmds::websocket::OkWebSocketResponseData::Export { files } = resp else {
                return Err(pyo3::exceptions::PyException::new_err(format!(
                    "Unexpected response from engine: {resp:?}"
                )));
            };

            Ok(files.into_iter().map(ExportFile::from).collect())
        })
        .await
        .map_err(|err| pyo3::exceptions::PyException::new_err(err.to_string()))?
}

/// Format the kcl code. This will return the formatted code.
#[pyfunction]
fn format(code: String) -> PyResult<String> {
    let program = kcl_lib::Program::parse_no_errs(&code).map_err(|err| into_miette_for_parse("", &code, err))?;
    let recasted = program.recast();

    Ok(recasted)
}

/// Format a whole directory of kcl code.
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
#[pyfunction]
fn lint(code: String) -> PyResult<Vec<Discovered>> {
    let program = kcl_lib::Program::parse_no_errs(&code).map_err(|err| into_miette_for_parse("", &code, err))?;
    let lints = program
        .lint(checks::lint_variables)
        .map_err(|err| pyo3::exceptions::PyException::new_err(err.to_string()))?;

    Ok(lints)
}

/// The kcl python module.
#[pymodule]
fn kcl(py: Python, m: &Bound<'_, PyModule>) -> PyResult<()> {
    // Add our types to the module.
    m.add_class::<ImageFormat>()?;
    m.add_class::<ExportFile>()?;
    m.add_class::<FileExportFormat>()?;
    m.add_class::<UnitLength>()?;
    m.add_class::<Discovered>()?;
    m.add_class::<SnapshotOptions>()?;
    m.add_class::<bridge::Point3d>()?;
    m.add_class::<bridge::CameraLookAt>()?;
    m.add_class::<kcmc::format::InputFormat3d>()?;

    let step_import = PyModule::new(py, "step_import")?;
    step_import.add_class::<kcmc::format::step::import::Options>()?;
    m.add_submodule(&step_import)?;
    let step_export = PyModule::new(py, "step_export")?;
    step_export.add_class::<kcmc::format::step::export::Options>()?;
    m.add_submodule(&step_export)?;

    let gltf_import = PyModule::new(py, "gltf_import")?;
    gltf_import.add_class::<kcmc::format::gltf::import::Options>()?;
    m.add_submodule(&gltf_import)?;
    let gltf_export = PyModule::new(py, "gltf_export")?;
    gltf_export.add_class::<kcmc::format::gltf::export::Options>()?;
    m.add_submodule(&gltf_export)?;

    let obj_import = PyModule::new(py, "obj_import")?;
    obj_import.add_class::<kcmc::format::obj::import::Options>()?;
    m.add_submodule(&obj_import)?;
    let obj_export = PyModule::new(py, "obj_export")?;
    obj_export.add_class::<kcmc::format::obj::export::Options>()?;
    m.add_submodule(&obj_export)?;

    let ply_import = PyModule::new(py, "ply_import")?;
    ply_import.add_class::<kcmc::format::ply::import::Options>()?;
    m.add_submodule(&ply_import)?;
    let ply_export = PyModule::new(py, "ply_export")?;
    ply_export.add_class::<kcmc::format::ply::export::Options>()?;
    m.add_submodule(&ply_export)?;

    let stl_import = PyModule::new(py, "stl_import")?;
    stl_import.add_class::<kcmc::format::stl::import::Options>()?;
    m.add_submodule(&stl_import)?;
    let stl_export = PyModule::new(py, "stl_export")?;
    stl_export.add_class::<kcmc::format::stl::export::Options>()?;
    m.add_submodule(&stl_export)?;

    let sldprt_import = PyModule::new(py, "sldprt_import")?;
    sldprt_import.add_class::<kcmc::format::sldprt::import::Options>()?;
    m.add_submodule(&sldprt_import)?;

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
    Ok(())
}
