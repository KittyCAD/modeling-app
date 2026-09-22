use std::sync::Arc;
use std::sync::RwLock;

use anyhow::Result;
use tower_lsp::LanguageServer;

// Create a fake kcl lsp server for testing.
pub async fn kcl_lsp_server(execute: bool) -> Result<crate::lsp::kcl::Backend> {
    let zoo_client =
        kcl_lib::lsp_support::engine::new_zoo_client(if execute { None } else { Some("bad_token".to_string()) }, None)?;

    let executor_ctx = if execute {
        Some(crate::execution::ExecutorContext::new(&zoo_client, Default::default()).await?)
    } else {
        None
    };
    assert!(!execute || executor_ctx.is_some());

    build_kcl_lsp_server(zoo_client, executor_ctx).await
}

/// Create a kcl lsp server that executes against a mock engine, so tests can
/// reach execution-time diagnostics without an engine connection.
///
/// Only the in-crate tests use this. The benchmark, which is the other consumer
/// of this module, builds its server with `kcl_lsp_server`.
#[cfg(test)]
pub async fn kcl_lsp_server_mock_execution() -> Result<crate::lsp::kcl::Backend> {
    let zoo_client = kcl_lib::lsp_support::engine::new_zoo_client(Some("bad_token".to_string()), None)?;
    let executor_ctx = crate::execution::ExecutorContext::new_mock(None).await;
    build_kcl_lsp_server(zoo_client, Some(executor_ctx)).await
}

async fn build_kcl_lsp_server(
    zoo_client: kittycad::Client,
    executor_ctx: Option<crate::execution::ExecutorContext>,
) -> Result<crate::lsp::kcl::Backend> {
    let kcl_std = crate::docs::kcl_doc::walk_stdlib();
    let stdlib_completions = crate::lsp::kcl::get_completions_from_stdlib(&kcl_std)?;
    let sketch_block_stdlib_completions = crate::lsp::kcl::get_completions_from_stdlib_for_sketch_block(&kcl_std)?;
    let stdlib_signatures = crate::lsp::kcl::get_signatures_from_stdlib(&kcl_std);
    let sketch_block_stdlib_signatures = crate::lsp::kcl::get_signatures_from_stdlib_for_sketch_block(&kcl_std);
    let stdlib_args = crate::lsp::kcl::get_arg_maps_from_stdlib(&kcl_std);
    let sketch_block_stdlib_args = crate::lsp::kcl::get_arg_maps_from_stdlib_for_sketch_block(&kcl_std);
    let kcl_keywords = crate::lsp::kcl::get_keywords();

    let can_execute = executor_ctx.is_some();

    // Create the backend.
    let (service, _) = tower_lsp::LspService::build(|client| crate::lsp::kcl::Backend {
        client,
        fs: crate::fs::new_file_system_handle(crate::fs::FileManager::new()),
        workspace_folders: Default::default(),
        stdlib_completions,
        sketch_block_stdlib_completions,
        stdlib_signatures,
        sketch_block_stdlib_signatures,
        stdlib_args,
        sketch_block_stdlib_args,
        token_map: Default::default(),
        ast_map: Default::default(),
        code_map: Default::default(),
        diagnostics_map: Default::default(),
        symbols_map: Default::default(),
        semantic_tokens_map: Default::default(),
        zoo_client,
        executor_ctx: Arc::new(tokio::sync::RwLock::new(executor_ctx)),
        can_execute: Arc::new(tokio::sync::RwLock::new(can_execute)),
        is_initialized: Default::default(),
        kcl_keywords,
    })
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
        fs: crate::fs::new_file_system_handle(crate::fs::FileManager::new()),
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
