//! Types used to send data to the test server.

use crate::{
    executor::{ExecutorContext, ExecutorSettings, IdGenerator},
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
    do_execute_and_snapshot(&ctx, code).await
}

pub async fn execute_and_snapshot_no_auth(code: &str, units: UnitLength) -> anyhow::Result<image::DynamicImage> {
    let ctx = new_context(units, false).await?;
    do_execute_and_snapshot(&ctx, code).await
}

async fn do_execute_and_snapshot(ctx: &ExecutorContext, code: &str) -> anyhow::Result<image::DynamicImage> {
    let tokens = crate::token::lexer(code)?;
    let parser = crate::parser::Parser::new(tokens);
    let program = parser.ast()?;

    let snapshot = ctx
        .execute_and_prepare_snapshot(&program, IdGenerator::default(), None)
        .await?;

    // Create a temporary file to write the output to.
    let output_file = std::env::temp_dir().join(format!("kcl_output_{}.png", uuid::Uuid::new_v4()));
    // Save the snapshot locally, to that temporary file.
    std::fs::write(&output_file, snapshot.contents.0)?;
    // Decode the snapshot, return it.
    let img = image::ImageReader::open(output_file).unwrap().decode()?;
    Ok(img)
}

async fn new_context(units: UnitLength, with_auth: bool) -> anyhow::Result<ExecutorContext> {
    let ctx = ExecutorContext::new_with_client(
        ExecutorSettings {
            units,
            highlight_edges: true,
            enable_ssao: false,
            show_grid: false,
            replay: None,
        },
        if with_auth { None } else { Some("bad_token".to_string()) },
        None,
    )
    .await?;
    Ok(ctx)
}
