//! Types used to send data to the test server.

use std::path::PathBuf;

use kittycad_modeling_cmds::websocket::RawFile;

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
    let ctx = new_context_engine_graphics(true, current_file).await?;
    let program = Program::parse_no_errs(code).map_err(KclErrorWithOutputs::no_outputs)?;
    let res = do_execute(&ctx, program, None)
        .await
        .map(|_| ())
        .map_err(|err| err.error);
    ctx.close().await;
    res
}

pub struct Snapshot3d {
    /// Bytes of the snapshot.
    pub image: image::DynamicImage,
    /// Glb binary containing mesh and brep data
    pub glb: Glb,
}

/// Execute the kcl and ask the engine to render an image
/// 2d kcl files can't be exported for local render
/// Fails if geometry_only = true
pub async fn execute_locally_and_render_on_engine(
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
pub async fn execute_export_and_render_locally(
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
            // Close the context to avoid any resource leaks.
            ctx.close().await;
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

pub struct KclDocGraphics {
    pub image: image::DynamicImage,
    pub glb: Option<Glb>,
}

pub async fn kcl_doc_execute_and_snapshot(
    code: &str,
    current_file: Option<PathBuf>,
    no_3d: bool,
) -> Result<KclDocGraphics, ExecError> {
    let ctx = new_context(true, current_file, !no_3d).await?;
    let program = Program::parse_no_errs(code).map_err(KclErrorWithOutputs::no_outputs)?;

    let graphical_result = match no_3d {
        true => execute_locally_and_render_on_engine(&ctx, program, None)
            .await
            .map(|(_, _, image)| KclDocGraphics { image, glb: None })
            .map_err(|err| err.error)?,
        false => execute_export_and_render_locally(&ctx, program, None)
            .await
            .map(|(_, _, snap_3d)| KclDocGraphics {
                image: snap_3d.image,
                glb: Some(snap_3d.glb),
            })
            .map_err(|err| err.error)?,
    };
    Ok(graphical_result)
}

/// Executes a kcl program and takes a snapshot of the result.
/// This returns the bytes of the snapshot.
pub async fn execute_and_snapshot_legacy_sim_test(
    code: &str,
    current_file: Option<PathBuf>,
) -> Result<image::DynamicImage, ExecError> {
    let ctx = new_context_engine_graphics(true, current_file).await?;
    let program = Program::parse_no_errs(code).map_err(KclErrorWithOutputs::no_outputs)?;
    let res = execute_locally_and_render_on_engine(&ctx, program, None)
        .await
        .map(|(_, _, img)| img)
        .map_err(|err| err.error);
    ctx.close().await;
    res
}

/// Executes a KCL program and takes a snapshot without closing the engine
/// connection. If OK, the caller must close the returned context.
/// If Err, the context will already be closed within this function.
#[cfg(test)]
pub async fn execute_and_snapshot_ast_no_close(
    ast: Program,
    current_file: Option<PathBuf>,
    deprecation_version_override: Option<&str>,
) -> Result<(ExecState, ExecutorContext, EnvironmentRef, Snapshot3d), ExecErrorWithState> {
    execute_and_snapshot_ast_with_heartbeats(ast, current_file, deprecation_version_override, Some(5)).await
}

#[cfg(test)]
async fn execute_and_snapshot_ast_with_heartbeats(
    ast: Program,
    current_file: Option<PathBuf>,
    deprecation_version_override: Option<&str>,
    heartbeats: Option<u64>,
) -> Result<(ExecState, ExecutorContext, EnvironmentRef, Snapshot3d), ExecErrorWithState> {
    let ctx = new_context_with_heartbeats(true, current_file, heartbeats, false).await?;
    let (exec_state, env, snap_3d) =
        match execute_export_and_render_locally(&ctx, ast, deprecation_version_override).await {
            Ok((exec_state, env_ref, snap_3d)) => (exec_state, env_ref, snap_3d),
            Err(err) => {
                // If there was an error executing the program, return it.
                // Close the context to avoid any resource leaks.
                ctx.close().await;
                return Err(err);
            }
        };
    Ok((exec_state, ctx, env, snap_3d))
}

pub async fn execute_and_snapshot_no_auth(
    code: &str,
    current_file: Option<PathBuf>,
) -> Result<(image::DynamicImage, EnvironmentRef), ExecError> {
    let ctx = new_context_engine_graphics(false, current_file).await?;
    let program = Program::parse_no_errs(code).map_err(KclErrorWithOutputs::no_outputs)?;
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
) -> Result<ExecutorContext, ConnectionError> {
    new_context_with_heartbeats(with_auth, current_file, None, false).await
}

pub async fn new_context(
    with_auth: bool,
    current_file: Option<PathBuf>,
    geometry_only: bool,
) -> Result<ExecutorContext, ConnectionError> {
    new_context_with_heartbeats(with_auth, current_file, None, geometry_only).await
}

async fn new_context_with_heartbeats(
    with_auth: bool,
    current_file: Option<PathBuf>,
    heartbeats: Option<u64>,
    geometry_only: bool,
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
        geometry_only,
    };
    if let Some(current_file) = current_file {
        settings.with_current_file(crate::TypedPath(current_file));
    }
    let ctx = ExecutorContext::new(&client, settings)
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
    let ctx = new_context_engine_graphics(true, current_file).await?;
    let mut exec_state = ExecState::new(&ctx);
    let program = Program::parse_no_errs(code).map_err(|err| {
        ExecErrorWithState::new(KclErrorWithOutputs::no_outputs(err).into(), exec_state.clone(), None)
    })?;
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
