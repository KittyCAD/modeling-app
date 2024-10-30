//! Types used to send data to the test server.

use crate::{
    ast::types::Program,
    executor::{new_zoo_client, ExecutorContext, ExecutorSettings, IdGenerator, ProgramMemory},
    settings::types::UnitLength,
};

#[derive(serde::Deserialize, serde::Serialize)]
pub struct RequestBody {
    pub kcl_program: String,
    #[serde(default)]
    pub test_name: String,
}

/// Executes a kcl program and takes a snapshot of the result.
/// This returns the bytes of the snapshot.
pub async fn execute_and_snapshot(code: &str, units: UnitLength) -> anyhow::Result<image::DynamicImage> {
    let ctx = new_context(units, true).await?;
    let tokens = crate::token::lexer(code)?;
    let parser = crate::parser::Parser::new(tokens);
    let program = parser.ast()?;
    do_execute_and_snapshot(&ctx, program).await.map(|(_state, snap)| snap)
}

/// Executes a kcl program and takes a snapshot of the result.
/// This returns the bytes of the snapshot.
pub async fn execute_and_snapshot_ast(
    ast: Program,
    units: UnitLength,
) -> anyhow::Result<(ProgramMemory, image::DynamicImage)> {
    let ctx = new_context(units, true).await?;
    do_execute_and_snapshot(&ctx, ast)
        .await
        .map(|(state, snap)| (state.memory, snap))
}

pub async fn execute_and_snapshot_no_auth(code: &str, units: UnitLength) -> anyhow::Result<image::DynamicImage> {
    let ctx = new_context(units, false).await?;
    let tokens = crate::token::lexer(code)?;
    let parser = crate::parser::Parser::new(tokens);
    let program = parser.ast()?;
    do_execute_and_snapshot(&ctx, program).await.map(|(_state, snap)| snap)
}

async fn do_execute_and_snapshot(
    ctx: &ExecutorContext,
    program: Program,
) -> anyhow::Result<(crate::executor::ExecState, image::DynamicImage)> {
    let (exec_state, snapshot) = ctx.execute_and_prepare(&program, IdGenerator::default(), None).await?;

    // Create a temporary file to write the output to.
    let output_file = std::env::temp_dir().join(format!("kcl_output_{}.png", uuid::Uuid::new_v4()));
    // Save the snapshot locally, to that temporary file.
    std::fs::write(&output_file, snapshot.contents.0)?;
    // Decode the snapshot, return it.
    let img = image::ImageReader::open(output_file).unwrap().decode()?;
    Ok((exec_state, img))
}

async fn new_context(units: UnitLength, with_auth: bool) -> anyhow::Result<ExecutorContext> {
    let mut client = new_zoo_client(if with_auth { None } else { Some("bad_token".to_string()) }, None)?;
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
    .await?;
    Ok(ctx)
}
