//! Types used to send data to the test server.

use std::path::PathBuf;

use crate::{
    errors::ExecErrorWithState,
    execution::{new_zoo_client, ArtifactCommand, ExecutorContext, ExecutorSettings, Operation, ProgramMemory},
    settings::types::UnitLength,
    ConnectionError, ExecError, Program,
};

#[derive(serde::Deserialize, serde::Serialize)]
pub struct RequestBody {
    pub kcl_program: String,
    #[serde(default)]
    pub test_name: String,
}

/// Executes a kcl program and takes a snapshot of the result.
/// This returns the bytes of the snapshot.
pub async fn execute_and_snapshot(
    code: &str,
    units: UnitLength,
    project_directory: Option<PathBuf>,
) -> Result<image::DynamicImage, ExecError> {
    let ctx = new_context(units, true, project_directory).await?;
    let program = Program::parse_no_errs(code)?;
    do_execute_and_snapshot(&ctx, program)
        .await
        .map(|(_state, snap)| snap)
        .map_err(|err| err.error)
}

/// Executes a kcl program and takes a snapshot of the result.
/// This returns the bytes of the snapshot.
pub async fn execute_and_snapshot_ast(
    ast: Program,
    units: UnitLength,
    project_directory: Option<PathBuf>,
) -> Result<(ProgramMemory, Vec<Operation>, Vec<ArtifactCommand>, image::DynamicImage), ExecErrorWithState> {
    let ctx = new_context(units, true, project_directory).await?;
    do_execute_and_snapshot(&ctx, ast).await.map(|(state, snap)| {
        (
            state.mod_local.memory,
            state.mod_local.operations,
            state.global.artifact_commands,
            snap,
        )
    })
}

pub async fn execute_and_snapshot_no_auth(
    code: &str,
    units: UnitLength,
    project_directory: Option<PathBuf>,
) -> Result<image::DynamicImage, ExecError> {
    let ctx = new_context(units, false, project_directory).await?;
    let program = Program::parse_no_errs(code)?;
    do_execute_and_snapshot(&ctx, program)
        .await
        .map(|(_state, snap)| snap)
        .map_err(|err| err.error)
}

async fn do_execute_and_snapshot(
    ctx: &ExecutorContext,
    program: Program,
) -> Result<(crate::execution::ExecState, image::DynamicImage), ExecErrorWithState> {
    let mut exec_state = Default::default();
    let snapshot_png_bytes = ctx
        .execute_and_prepare_snapshot(&program, &mut exec_state)
        .await
        .map_err(|err| ExecErrorWithState::new(err, exec_state.clone()))?
        .contents
        .0;

    // Decode the snapshot, return it.
    let img = image::ImageReader::new(std::io::Cursor::new(snapshot_png_bytes))
        .with_guessed_format()
        .map_err(|e| ExecError::BadPng(e.to_string()))
        .and_then(|x| x.decode().map_err(|e| ExecError::BadPng(e.to_string())))
        .map_err(|err| ExecErrorWithState::new(err, exec_state.clone()))?;
    Ok((exec_state, img))
}

pub async fn new_context(
    units: UnitLength,
    with_auth: bool,
    project_directory: Option<PathBuf>,
) -> Result<ExecutorContext, ConnectionError> {
    let mut client = new_zoo_client(if with_auth { None } else { Some("bad_token".to_string()) }, None)
        .map_err(ConnectionError::CouldNotMakeClient)?;
    if !with_auth {
        // Use prod, don't override based on env vars.
        // We do this so even in the engine repo, tests that need to run with
        // no auth can fail in the same way as they would in prod.
        client.set_base_url("https://api.zoo.dev".to_string());
    }

    let ctx = ExecutorContext::new(
        &client,
        ExecutorSettings {
            units,
            highlight_edges: true,
            enable_ssao: false,
            show_grid: false,
            replay: None,
            project_directory,
        },
    )
    .await
    .map_err(ConnectionError::Establishing)?;
    Ok(ctx)
}
