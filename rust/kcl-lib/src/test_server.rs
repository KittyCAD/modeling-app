//! Types used to send data to the test server.

use std::path::PathBuf;

use crate::{
    engine::new_zoo_client,
    errors::ExecErrorWithState,
    execution::{EnvironmentRef, ExecState, ExecutorContext, ExecutorSettings},
    settings::types::UnitLength,
    ConnectionError, ExecError, KclError, KclErrorWithOutputs, Program,
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
    current_file: Option<PathBuf>,
) -> Result<image::DynamicImage, ExecError> {
    let ctx = new_context(units, true, current_file).await?;
    let program = Program::parse_no_errs(code).map_err(KclErrorWithOutputs::no_outputs)?;
    let res = do_execute_and_snapshot(&ctx, program)
        .await
        .map(|(_, _, snap)| snap)
        .map_err(|err| err.error);
    ctx.close().await;
    res
}

/// Executes a kcl program and takes a snapshot of the result.
/// This returns the bytes of the snapshot.
pub async fn execute_and_snapshot_ast(
    ast: Program,
    units: UnitLength,
    current_file: Option<PathBuf>,
    with_export_step: bool,
) -> Result<(ExecState, EnvironmentRef, image::DynamicImage, Option<Vec<u8>>), ExecErrorWithState> {
    let ctx = new_context(units, true, current_file).await?;
    let (exec_state, env, img) = do_execute_and_snapshot(&ctx, ast).await?;
    let mut step = None;
    if with_export_step {
        let files = match ctx.export_step(true).await {
            Ok(f) => f,
            Err(err) => {
                return Err(ExecErrorWithState::new(
                    ExecError::BadExport(format!("Export failed: {:?}", err)),
                    exec_state.clone(),
                ));
            }
        };

        step = files.into_iter().next().map(|f| f.contents);
    }
    ctx.close().await;
    Ok((exec_state, env, img, step))
}

pub async fn execute_and_snapshot_no_auth(
    code: &str,
    units: UnitLength,
    current_file: Option<PathBuf>,
) -> Result<(image::DynamicImage, EnvironmentRef), ExecError> {
    let ctx = new_context(units, false, current_file).await?;
    let program = Program::parse_no_errs(code).map_err(KclErrorWithOutputs::no_outputs)?;
    let res = do_execute_and_snapshot(&ctx, program)
        .await
        .map(|(_, env_ref, snap)| (snap, env_ref))
        .map_err(|err| err.error);
    ctx.close().await;
    res
}

async fn do_execute_and_snapshot(
    ctx: &ExecutorContext,
    program: Program,
) -> Result<(ExecState, EnvironmentRef, image::DynamicImage), ExecErrorWithState> {
    let mut exec_state = ExecState::new(ctx);
    let result = ctx
        .run(&program, &mut exec_state)
        .await
        .map_err(|err| ExecErrorWithState::new(err.into(), exec_state.clone()))?;
    for e in exec_state.errors() {
        if e.severity.is_err() {
            return Err(ExecErrorWithState::new(
                KclErrorWithOutputs::no_outputs(KclError::Semantic(e.clone().into())).into(),
                exec_state.clone(),
            ));
        }
    }
    let snapshot_png_bytes = ctx
        .prepare_snapshot()
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

    Ok((exec_state, result.0, img))
}

pub async fn new_context(
    units: UnitLength,
    with_auth: bool,
    current_file: Option<PathBuf>,
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
        units,
        highlight_edges: true,
        enable_ssao: false,
        show_grid: false,
        replay: None,
        project_directory: None,
        current_file: None,
    };
    if let Some(current_file) = current_file {
        settings.with_current_file(current_file);
    }
    let ctx = ExecutorContext::new(&client, settings)
        .await
        .map_err(ConnectionError::Establishing)?;
    Ok(ctx)
}

pub async fn execute_and_export_step(
    code: &str,
    units: UnitLength,
    current_file: Option<PathBuf>,
) -> Result<
    (
        ExecState,
        EnvironmentRef,
        Vec<kittycad_modeling_cmds::websocket::RawFile>,
    ),
    ExecErrorWithState,
> {
    let ctx = new_context(units, true, current_file).await?;
    let mut exec_state = ExecState::new(&ctx);
    let program = Program::parse_no_errs(code)
        .map_err(|err| ExecErrorWithState::new(KclErrorWithOutputs::no_outputs(err).into(), exec_state.clone()))?;
    let result = ctx
        .run(&program, &mut exec_state)
        .await
        .map_err(|err| ExecErrorWithState::new(err.into(), exec_state.clone()))?;
    for e in exec_state.errors() {
        if e.severity.is_err() {
            return Err(ExecErrorWithState::new(
                KclErrorWithOutputs::no_outputs(KclError::Semantic(e.clone().into())).into(),
                exec_state.clone(),
            ));
        }
    }

    let files = match ctx.export_step(true).await {
        Ok(f) => f,
        Err(err) => {
            return Err(ExecErrorWithState::new(
                ExecError::BadExport(format!("Export failed: {:?}", err)),
                exec_state.clone(),
            ));
        }
    };

    ctx.close().await;

    Ok((exec_state, result.0, files))
}
