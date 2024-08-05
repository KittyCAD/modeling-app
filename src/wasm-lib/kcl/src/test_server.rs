//! Types used to send data to the test server.

use crate::{
    executor::{ExecutorContext, ExecutorSettings},
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
    let ctx = new_context(units).await?;
    let tokens = crate::token::lexer(code)?;
    let parser = crate::parser::Parser::new(tokens);
    let program = parser.ast()?;

    let snapshot = ctx.execute_and_prepare_snapshot(&program).await?;

    // Create a temporary file to write the output to.
    let output_file = std::env::temp_dir().join(format!("kcl_output_{}.png", uuid::Uuid::new_v4()));
    // Save the snapshot locally, to that temporary file.
    std::fs::write(&output_file, snapshot.contents.0)?;
    // Decode the snapshot, return it.
    let img = image::ImageReader::open(output_file).unwrap().decode()?;
    Ok(img)
}

async fn new_context(units: UnitLength) -> anyhow::Result<ExecutorContext> {
    let user_agent = concat!(env!("CARGO_PKG_NAME"), ".rs/", env!("CARGO_PKG_VERSION"),);
    let http_client = reqwest::Client::builder()
        .user_agent(user_agent)
        // For file conversions we need this to be long.
        .timeout(std::time::Duration::from_secs(600))
        .connect_timeout(std::time::Duration::from_secs(60));
    let ws_client = reqwest::Client::builder()
        .user_agent(user_agent)
        // For file conversions we need this to be long.
        .timeout(std::time::Duration::from_secs(600))
        .connect_timeout(std::time::Duration::from_secs(60))
        .connection_verbose(true)
        .tcp_keepalive(std::time::Duration::from_secs(600))
        .http1_only();

    let token = std::env::var("KITTYCAD_API_TOKEN").expect("KITTYCAD_API_TOKEN not set");

    // Create the client.
    let mut client = kittycad::Client::new_from_reqwest(token, http_client, ws_client);
    // Set a local engine address if it's set.
    if let Ok(addr) = std::env::var("LOCAL_ENGINE_ADDR") {
        client.set_base_url(addr);
    }

    let ctx = ExecutorContext::new(
        &client,
        ExecutorSettings {
            units,
            highlight_edges: true,
            enable_ssao: false,
            show_grid: false,
        },
    )
    .await?;
    Ok(ctx)
}
