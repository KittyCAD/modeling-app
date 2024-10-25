use std::sync::{Arc, RwLock};

use anyhow::Result;
use tower_lsp::LanguageServer;

fn new_zoo_client() -> kittycad::Client {
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
    if let Ok(addr) = std::env::var("ZOO_HOST") {
        client.set_base_url(addr);
    }

    client
}

// Create a fake kcl lsp server for testing.
pub async fn kcl_lsp_server(execute: bool) -> Result<crate::lsp::kcl::Backend> {
    let stdlib = crate::std::StdLib::new();
    let stdlib_completions = crate::lsp::kcl::get_completions_from_stdlib(&stdlib)?;
    let stdlib_signatures = crate::lsp::kcl::get_signatures_from_stdlib(&stdlib)?;

    let zoo_client = new_zoo_client();

    let executor_ctx = if execute {
        Some(crate::executor::ExecutorContext::new(&zoo_client, Default::default()).await?)
    } else {
        None
    };

    let can_execute = executor_ctx.is_some();

    // Create the backend.
    let (service, _) = tower_lsp::LspService::build(|client| crate::lsp::kcl::Backend {
        client,
        fs: Arc::new(crate::fs::FileManager::new()),
        workspace_folders: Default::default(),
        stdlib_completions,
        stdlib_signatures,
        token_map: Default::default(),
        ast_map: Default::default(),
        memory_map: Default::default(),
        code_map: Default::default(),
        diagnostics_map: Default::default(),
        symbols_map: Default::default(),
        semantic_tokens_map: Default::default(),
        zoo_client,
        can_send_telemetry: true,
        executor_ctx: Arc::new(tokio::sync::RwLock::new(executor_ctx)),
        can_execute: Arc::new(tokio::sync::RwLock::new(can_execute)),
        is_initialized: Default::default(),
    })
    .custom_method("kcl/updateUnits", crate::lsp::kcl::Backend::update_units)
    .custom_method("kcl/updateCanExecute", crate::lsp::kcl::Backend::update_can_execute)
    .finish();

    let server = service.inner();

    server
        .initialize(tower_lsp::lsp_types::InitializeParams::default())
        .await?;

    server.initialized(tower_lsp::lsp_types::InitializedParams {}).await;

    Ok(server.clone())
}

// Create a fake copilot lsp server for testing.
pub async fn copilot_lsp_server() -> Result<crate::lsp::copilot::Backend> {
    // We don't actually need to authenticate to the backend for this test.
    let zoo_client = kittycad::Client::new_from_env();

    // Create the backend.
    let (service, _) = tower_lsp::LspService::new(|client| crate::lsp::copilot::Backend {
        client,
        fs: Arc::new(crate::fs::FileManager::new()),
        workspace_folders: Default::default(),
        code_map: Default::default(),
        zoo_client,
        editor_info: Arc::new(RwLock::new(crate::lsp::copilot::types::CopilotEditorInfo::default())),
        cache: Arc::new(crate::lsp::copilot::cache::CopilotCache::new()),
        telemetry: Default::default(),
        is_initialized: Default::default(),
        diagnostics_map: Default::default(),
        dev_mode: Default::default(),
    });
    let server = service.inner();

    server
        .initialize(tower_lsp::lsp_types::InitializeParams::default())
        .await?;

    server.initialized(tower_lsp::lsp_types::InitializedParams {}).await;

    Ok(server.clone())
}
