//! Types used to send data to the test server.

use std::path::PathBuf;

use crate::{
    execution::{new_zoo_client, ExecutorContext, ExecutorSettings, ProgramMemory},
    settings::types::UnitLength,
    ConnectionError, ExecError, ExecState, Program,
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
    let ctx = new_context(units, true).await?;
    let program = Program::parse_no_errs(code)?;
    do_execute_and_snapshot(&ctx, program, project_directory)
        .await
        .map(|(_state, snap)| snap)
}

/// Executes a kcl program and takes a snapshot of the result.
/// This returns the bytes of the snapshot.
pub async fn execute_and_snapshot_ast(
    ast: Program,
    units: UnitLength,
    project_directory: Option<PathBuf>,
) -> Result<(ProgramMemory, image::DynamicImage), ExecError> {
    let ctx = new_context(units, true).await?;
    do_execute_and_snapshot(&ctx, ast, project_directory)
        .await
        .map(|(state, snap)| (state.memory, snap))
}

pub async fn execute_and_snapshot_no_auth(
    code: &str,
    units: UnitLength,
    project_directory: Option<PathBuf>,
) -> Result<image::DynamicImage, ExecError> {
    let ctx = new_context(units, false).await?;
    let program = Program::parse_no_errs(code)?;
    do_execute_and_snapshot(&ctx, program, project_directory)
        .await
        .map(|(_state, snap)| snap)
}

async fn do_execute_and_snapshot(
    ctx: &ExecutorContext,
    program: Program,
    project_directory: Option<PathBuf>,
) -> Result<(crate::execution::ExecState, image::DynamicImage), ExecError> {
    let mut exec_state = ExecState::default();
    exec_state.project_directory = project_directory;
    let snapshot_png_bytes = ctx.execute_and_prepare(&program, &mut exec_state).await?.contents.0;

    // Decode the snapshot, return it.
    let img = image::ImageReader::new(std::io::Cursor::new(snapshot_png_bytes))
        .with_guessed_format()
        .map_err(|e| ExecError::BadPng(e.to_string()))
        .and_then(|x| x.decode().map_err(|e| ExecError::BadPng(e.to_string())))?;
    Ok((exec_state, img))
}

async fn new_context(units: UnitLength, with_auth: bool) -> Result<ExecutorContext, ConnectionError> {
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
        },
    )
    .await
    .map_err(ConnectionError::Establishing)?;
    Ok(ctx)
}
