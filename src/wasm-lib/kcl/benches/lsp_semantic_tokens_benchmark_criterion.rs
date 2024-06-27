use std::sync::Arc;

use anyhow::Result;
use criterion::{async_executor::FuturesExecutor, black_box, criterion_group, criterion_main, BenchmarkId, Criterion};
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
    if let Ok(addr) = std::env::var("LOCAL_ENGINE_ADDR") {
        client.set_base_url(addr);
    }

    client
}

// Create a fake kcl lsp server for testing.
async fn kcl_lsp_server(execute: bool) -> Result<kcl_lib::lsp::kcl::Backend> {
    let stdlib = kcl_lib::std::StdLib::new();
    let stdlib_completions = kcl_lib::lsp::kcl::get_completions_from_stdlib(&stdlib)?;
    let stdlib_signatures = kcl_lib::lsp::kcl::get_signatures_from_stdlib(&stdlib)?;

    let zoo_client = new_zoo_client();

    let executor_ctx = if execute {
        Some(kcl_lib::executor::ExecutorContext::new(&zoo_client, Default::default()).await?)
    } else {
        None
    };

    let can_execute = executor_ctx.is_some();

    // Create the backend.
    let (service, _) = tower_lsp::LspService::build(|client| kcl_lib::lsp::kcl::Backend {
        client,
        fs: Arc::new(kcl_lib::fs::FileManager::new()),
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
    .custom_method("kcl/updateUnits", kcl_lib::lsp::kcl::Backend::update_units)
    .custom_method("kcl/updateCanExecute", kcl_lib::lsp::kcl::Backend::update_can_execute)
    .finish();

    let server = service.inner();

    server
        .initialize(tower_lsp::lsp_types::InitializeParams::default())
        .await?;

    server.initialized(tower_lsp::lsp_types::InitializedParams {}).await;

    Ok(server.clone())
}

async fn kcl_lsp_semantic_tokens(code: &str) {
    let server = kcl_lsp_server(false).await.unwrap();

    // Send open file.
    server
        .did_open(tower_lsp::lsp_types::DidOpenTextDocumentParams {
            text_document: tower_lsp::lsp_types::TextDocumentItem {
                uri: "file:///test.kcl".try_into().unwrap(),
                language_id: "kcl".to_string(),
                version: 1,
                text: code.to_string(),
            },
        })
        .await;

    // Send semantic tokens request.
    black_box(
        server
            .semantic_tokens_full(tower_lsp::lsp_types::SemanticTokensParams {
                text_document: tower_lsp::lsp_types::TextDocumentIdentifier {
                    uri: "file:///test.kcl".try_into().unwrap(),
                },
                partial_result_params: Default::default(),
                work_done_progress_params: Default::default(),
            })
            .await
            .unwrap()
            .unwrap(),
    );
}

fn bench_kcl_lsp_semantic_tokens(c: &mut Criterion) {
    for (name, code) in [
        ("pipes_on_pipes", PIPES_PROGRAM),
        ("big_kitt", KITT_PROGRAM),
        ("cube", CUBE_PROGRAM),
        ("math", MATH_PROGRAM),
        ("mike_stress_test", MIKE_STRESS_TEST_PROGRAM),
        ("global_tags", GLOBAL_TAGS_FILE),
    ] {
        c.bench_with_input(BenchmarkId::new(name, code), &code, |b, &s| {
            // Insert a call to `to_async` to convert the bencher to async mode.
            // The timing loops are the same as with the normal bencher.
            b.to_async(FuturesExecutor).iter(|| kcl_lsp_semantic_tokens(s));
        });
    }
}

criterion_group!(benches, bench_kcl_lsp_semantic_tokens);
criterion_main!(benches);

const KITT_PROGRAM: &str = include_str!("../../tests/executor/inputs/kittycad_svg.kcl");
const PIPES_PROGRAM: &str = include_str!("../../tests/executor/inputs/pipes_on_pipes.kcl");
const CUBE_PROGRAM: &str = include_str!("../../tests/executor/inputs/cube.kcl");
const MATH_PROGRAM: &str = include_str!("../../tests/executor/inputs/math.kcl");
const MIKE_STRESS_TEST_PROGRAM: &str = include_str!("../../tests/executor/inputs/mike_stress_test.kcl");
const GLOBAL_TAGS_FILE: &str = include_str!("../../tests/executor/inputs/global-tags.kcl");
