//! Types used to send data to the test server.

use std::path::PathBuf;

use kittycad_modeling_cmds::websocket::RawFile;
#[cfg(test)]
use serde::Deserialize;

use crate::ConnectionError;
use crate::ExecError;
use crate::KclError;
use crate::KclErrorWithOutputs;
use crate::Program;
use crate::engine::new_zoo_client;
use crate::errors::ExecErrorWithState;
use crate::execution::EnvironmentRef;
use crate::execution::ExecState;
use crate::execution::ExecutorContext;
use crate::execution::ExecutorSettings;

#[derive(serde::Deserialize, serde::Serialize)]
pub struct RequestBody {
    pub kcl_program: String,
    #[serde(default)]
    pub test_name: String,
}

/// Executes a KCL program. Only returns success or error.
pub async fn execute(code: &str, current_file: Option<PathBuf>) -> Result<(), ExecError> {
    let program = Program::parse_no_errs(code).map_err(KclErrorWithOutputs::no_outputs)?;
    let version = program.language_version().map_err(KclErrorWithOutputs::no_outputs)?;
    let ctx = new_context(true, current_file, true, version).await?;
    let res = do_execute(&ctx, program, None)
        .await
        .map(|_| ())
        .map_err(|err| err.error);
    ctx.close().await;
    res
}

#[cfg(test)]
pub struct Snapshot3d {
    /// Bytes of the snapshot.
    pub image: image::DynamicImage,
    /// Glb binary containing mesh and brep data
    pub glb: Glb,
}

/// Execute the kcl and ask the engine to render an image
/// 2d kcl files can't be exported for local render
/// Fails if geometry_only = true
/// CTX should be closed by caller.
async fn execute_locally_and_render_on_engine(
    ctx: &ExecutorContext,
    program: Program,
    deprecation_version_override: Option<&str>,
) -> Result<(ExecState, EnvironmentRef, image::DynamicImage), ExecErrorWithState> {
    let (exec_state, env_ref) = do_execute(ctx, program, deprecation_version_override).await?;
    let snapshot_png_bytes = ctx
        .prepare_snapshot()
        .await
        .map_err(|err| ExecErrorWithState::new(err, exec_state.clone(), None))?
        .contents
        .0;

    // Decode the snapshot, return it.
    let img = image::ImageReader::new(std::io::Cursor::new(snapshot_png_bytes))
        .with_guessed_format()
        .map_err(|e| ExecError::BadPng(e.to_string()))
        .and_then(|x| x.decode().map_err(|e| ExecError::BadPng(e.to_string())))
        .map_err(|err| ExecErrorWithState::new(err, exec_state.clone(), None))?;

    Ok((exec_state, env_ref, img))
}

/// Execute the kcl then export the resulting glb and CPU render an image locally
/// cheaper than engine render since we can use the engine in geometry-only mode.
/// CTX should be closed by caller.
#[cfg(test)]
async fn execute_export_and_render_locally(
    ctx: &ExecutorContext,
    program: Program,
    deprecation_version_override: Option<&str>,
) -> Result<(ExecState, EnvironmentRef, Snapshot3d), ExecErrorWithState> {
    let (exec_state, env_ref) = do_execute(ctx, program, deprecation_version_override).await?;

    // export glb
    let glb_blob_files = match ctx
        .export(kittycad_modeling_cmds::format::OutputFormat3d::Gltf(
            kittycad_modeling_cmds::format::gltf::export::Options::builder()
                .storage(kittycad_modeling_cmds::format::gltf::export::Storage::Binary)
                .build(),
        ))
        .await
    {
        Ok(f) => f,
        Err(err) => {
            return Err(ExecErrorWithState::new(
                ExecError::BadExport(format!("Export failed: {err:?}")),
                exec_state.clone(),
                None,
            ));
        }
    };
    if glb_blob_files.len() != 1 {
        return Err(ExecErrorWithState::new(
            ExecError::BadExport(format!("Expected 1 glb file, found {}", glb_blob_files.len())),
            exec_state,
            None,
        ));
    }
    let glb: Glb = glb_blob_files
        .into_iter()
        .next()
        .unwrap_or_else(|| RawFile {
            name: String::new(),
            contents: vec![],
        })
        .into();
    let image = glb_render::render(&glb.bytes)
        .map_err(|e| ExecErrorWithState::new(ExecError::BadExport(e), exec_state.clone(), None))?;

    let snap_3d = Snapshot3d { image, glb };
    Ok((exec_state, env_ref, snap_3d))
}

/// single-file binary blob containing mesh and brep
pub struct Glb {
    pub name: String,
    pub bytes: Vec<u8>,
}

impl From<RawFile> for Glb {
    fn from(value: RawFile) -> Self {
        Glb {
            name: value.name,
            bytes: value.contents,
        }
    }
}

#[cfg(test)]
pub enum TestGraphicsArtifact {
    Image(image::DynamicImage),
    ImageAndGlb { image: image::DynamicImage, glb: Glb },
    None,
}

#[cfg(test)]
impl TestGraphicsArtifact {
    pub fn image(self) -> Option<image::DynamicImage> {
        match self {
            Self::Image(img) => Some(img),
            Self::ImageAndGlb { image, .. } => Some(image),
            Self::None => None,
        }
    }
}

#[cfg(test)]
#[derive(Deserialize, Debug, Clone, Default)]
pub enum TestGraphicsParams {
    /// use the 3d engine scene to render an image
    EngineRender { reason: String },
    /// the model is exportable. export and CPU render
    #[default]
    ExportAndRender,
    /// the model doesn't need any graphical test output
    None,
}

#[cfg(test)]
impl TestGraphicsParams {
    fn geometry_only(&self) -> bool {
        matches!(self, Self::ExportAndRender | Self::None)
    }
    /// kcl doc examples have `engineRender` or `noRender` flags in their declaration if an export and CPU render is not desirable for that example.
    /// Translate these requirements into a more descriptive type here.
    fn from_kcl_sample_spec(engine_render: bool, no_render: bool) -> Self {
        match (engine_render, no_render) {
            (true, false) => Self::EngineRender {
                // It would be nice for the kcl sample itself to contain richer information about why it's marked engineRender.
                // But this is the best info we have for now.
                reason: "KCL sample marked 'engineRender'".to_string(),
            },
            (false, false) => Self::ExportAndRender,
            (true, true) | (false, true) => Self::None,
        }
    }
}

#[cfg(test)]
async fn execute_from_graphics_params(
    graphics: TestGraphicsParams,
    program: Program,
    deprecation_version_override: Option<&str>,
    ctx: &ExecutorContext,
) -> Result<(ExecState, EnvironmentRef, TestGraphicsArtifact), ExecErrorWithState> {
    match graphics {
        // maybe there's something we can do to pipe reason into test output,
        // or maybe the main importance of the field is just that it must exist in config.toml files
        TestGraphicsParams::EngineRender { reason: _r } => {
            execute_locally_and_render_on_engine(ctx, program, deprecation_version_override)
                .await
                .map(|(state, env, image)| (state, env, TestGraphicsArtifact::Image(image)))
        }
        TestGraphicsParams::ExportAndRender => {
            execute_export_and_render_locally(ctx, program, deprecation_version_override)
                .await
                .map(|(state, env, snap_3d)| {
                    (
                        state,
                        env,
                        TestGraphicsArtifact::ImageAndGlb {
                            image: snap_3d.image,
                            glb: snap_3d.glb,
                        },
                    )
                })
        }
        TestGraphicsParams::None => do_execute(ctx, program, deprecation_version_override)
            .await
            .map(|(state, env)| (state, env, TestGraphicsArtifact::None)),
    }
}

#[cfg(test)]
pub async fn kcl_doc_execute_and_snapshot(
    code: &str,
    current_file: Option<PathBuf>,
    engine_render: bool,
    no_render: bool,
) -> Result<TestGraphicsArtifact, ExecError> {
    let graphics = TestGraphicsParams::from_kcl_sample_spec(engine_render, no_render);
    let program = Program::parse_no_errs(code).map_err(KclErrorWithOutputs::no_outputs)?;
    let version = program.language_version().map_err(KclErrorWithOutputs::no_outputs)?;
    let ctx = new_context(true, current_file, graphics.geometry_only(), version).await?;

    let result: Result<TestGraphicsArtifact, ExecError> = execute_from_graphics_params(graphics, program, None, &ctx)
        .await
        .map(|(_exec_state, _env, graphics)| graphics)
        .map_err(|e| e.error);

    ctx.close().await;
    result
}

/// Executes a KCL program and takes a snapshot without closing the engine
/// connection. If OK, the caller must close the returned context.
/// If Err, the context will already be closed within this function.
#[cfg(test)]
pub async fn execute_sim_test_no_close(
    ast: Program,
    current_file: Option<PathBuf>,
    deprecation_version_override: Option<&str>,
    graphics: TestGraphicsParams,
) -> Result<(ExecState, ExecutorContext, EnvironmentRef, TestGraphicsArtifact), ExecErrorWithState> {
    let heartbeats = Some(5);
    let version = ast
        .language_version()
        .map_err(|error| {
            let mut error = KclErrorWithOutputs::no_outputs(error);
            if let Some(path) = &current_file {
                error.filenames.insert(
                    crate::ModuleId::default(),
                    crate::modules::ModulePath::Local {
                        value: crate::TypedPath(path.clone()),
                        original_import_path: None,
                    },
                );
            }
            error
        })
        .map_err(ExecError::from)?;
    let ctx = new_context_with_heartbeats(true, current_file, heartbeats, graphics.geometry_only(), version).await?;
    let result = execute_from_graphics_params(graphics, ast, deprecation_version_override, &ctx).await;
    // we shouldn't let the ctx leave this function without closing, but an open ctx is relied on downstream.
    // needs to be refactored.
    if result.is_err() {
        ctx.close().await;
    }
    result.map(|(state, env, graphics_result)| (state, ctx, env, graphics_result))
}

pub async fn execute_and_snapshot_no_auth(
    code: &str,
    current_file: Option<PathBuf>,
) -> Result<(image::DynamicImage, EnvironmentRef), ExecError> {
    let program = Program::parse_no_errs(code).map_err(KclErrorWithOutputs::no_outputs)?;
    let version = program.language_version().map_err(KclErrorWithOutputs::no_outputs)?;
    let ctx = new_context_engine_graphics(false, current_file, version).await?;
    let res = execute_locally_and_render_on_engine(&ctx, program, None)
        .await
        .map(|(_, env_ref, image)| (image, env_ref))
        .map_err(|err| err.error);
    ctx.close().await;
    res
}

async fn do_execute(
    ctx: &ExecutorContext,
    program: Program,
    _deprecation_version_override: Option<&str>,
) -> Result<(ExecState, EnvironmentRef), ExecErrorWithState> {
    let mut exec_state = ExecState::new(ctx);
    #[cfg(test)]
    exec_state.set_deprecation_version_override(_deprecation_version_override);
    let _ = ctx.send_clear_scene(&mut exec_state, Default::default()).await;
    let result = ctx.run(&program, &mut exec_state).await;
    let responses = if result.is_err() {
        #[cfg(feature = "snapshot-engine-responses")]
        {
            Some(exec_state.take_root_module_responses())
        }
        #[cfg(not(feature = "snapshot-engine-responses"))]
        None
    } else {
        None
    };
    let result = result.map_err(|err| ExecErrorWithState::new(err.into(), exec_state.clone(), responses))?;
    for issue in exec_state.issues() {
        if issue.severity.is_err() {
            return Err(ExecErrorWithState::new(
                KclErrorWithOutputs::no_outputs(KclError::new_semantic(issue.clone().into())).into(),
                exec_state.clone(),
                None,
            ));
        }
    }

    Ok((exec_state, result.0))
}

pub async fn new_context_engine_graphics(
    with_auth: bool,
    current_file: Option<PathBuf>,
    kcl_version: crate::KclVersion,
) -> Result<ExecutorContext, ConnectionError> {
    new_context_with_heartbeats(with_auth, current_file, None, false, kcl_version).await
}

pub async fn new_context(
    with_auth: bool,
    current_file: Option<PathBuf>,
    geometry_only: bool,
    kcl_version: crate::KclVersion,
) -> Result<ExecutorContext, ConnectionError> {
    new_context_with_heartbeats(with_auth, current_file, None, geometry_only, kcl_version).await
}

async fn new_context_with_heartbeats(
    with_auth: bool,
    current_file: Option<PathBuf>,
    heartbeats: Option<u64>,
    geometry_only: bool,
    kcl_version: crate::KclVersion,
) -> Result<ExecutorContext, ConnectionError> {
    let mut client = new_zoo_client(if with_auth { None } else { Some("bad_token".to_string()) }, None)
        .map_err(ConnectionError::CouldNotMakeClient)?;
    if !with_auth {
        // Use prod, don't override based on env vars.
        // We do this so even in the engine repo, tests that need to run with
        // no auth can fail in the same way as they would in prod.
        client.set_base_url("https://api.zoo.dev".to_string());
    }

    let mut settings = ExecutorSettings {
        highlight_edges: true,
        enable_ssao: false,
        show_grid: false,
        replay: None,
        project_directory: None,
        current_file: None,
        fixed_size_grid: true,
        skip_artifact_graph: false,
        heartbeats,
        default_backface_color: Some("#00D5FF".to_owned()),
        pool: None,
        video_res_width: None,
        video_res_height: None,
        geometry_only,
    };
    if let Some(current_file) = current_file {
        settings.with_current_file(crate::TypedPath(current_file));
    }
    let ctx = ExecutorContext::new(&client, settings, kcl_version)
        .await
        .map_err(ConnectionError::Establishing)?;
    Ok(ctx)
}

pub async fn execute_and_export_step(
    code: &str,
    current_file: Option<PathBuf>,
) -> Result<
    (
        ExecState,
        EnvironmentRef,
        Vec<kittycad_modeling_cmds::websocket::RawFile>,
    ),
    ExecErrorWithState,
> {
    let program = Program::parse_no_errs(code)
        .map_err(KclErrorWithOutputs::no_outputs)
        .map_err(ExecError::from)?;
    let version = program
        .language_version()
        .map_err(KclErrorWithOutputs::no_outputs)
        .map_err(ExecError::from)?;
    let ctx = new_context(true, current_file, true, version).await?;
    let mut exec_state = ExecState::new(&ctx);
    let result = ctx
        .run(&program, &mut exec_state)
        .await
        .map_err(|err| ExecErrorWithState::new(err.into(), exec_state.clone(), None))?;
    for issue in exec_state.issues() {
        if issue.severity.is_err() {
            return Err(ExecErrorWithState::new(
                KclErrorWithOutputs::no_outputs(KclError::new_semantic(issue.clone().into())).into(),
                exec_state.clone(),
                None,
            ));
        }
    }

    let files = match ctx.export_step(true).await {
        Ok(f) => f,
        Err(err) => {
            return Err(ExecErrorWithState::new(
                ExecError::BadExport(format!("Export failed: {err:?}")),
                exec_state.clone(),
                None,
            ));
        }
    };

    ctx.close().await;

    Ok((exec_state, result.0, files))
}
