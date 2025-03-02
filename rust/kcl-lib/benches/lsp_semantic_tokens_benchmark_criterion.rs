use criterion::{black_box, criterion_group, criterion_main, BenchmarkId, Criterion};
use kcl_lib::kcl_lsp_server;
use tokio::runtime::Runtime;
use tower_lsp::LanguageServer;

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
        ("lsystem", LSYSTEM_PROGRAM),
    ] {
        c.bench_with_input(BenchmarkId::new("semantic_tokens_", name), &code, |b, &s| {
            let rt = Runtime::new().unwrap();

            // Spawn a future onto the runtime
            b.iter(|| {
                rt.block_on(kcl_lsp_semantic_tokens(s));
            });
        });
    }
}

criterion_group!(benches, bench_kcl_lsp_semantic_tokens);
criterion_main!(benches);

const KITT_PROGRAM: &str = include_str!("../e2e/executor/inputs/kittycad_svg.kcl");
const PIPES_PROGRAM: &str = include_str!("../e2e/executor/inputs/pipes_on_pipes.kcl");
const CUBE_PROGRAM: &str = include_str!("../e2e/executor/inputs/cube.kcl");
const MATH_PROGRAM: &str = include_str!("../e2e/executor/inputs/math.kcl");
const MIKE_STRESS_TEST_PROGRAM: &str = include_str!("../tests/mike_stress_test/input.kcl");
const GLOBAL_TAGS_FILE: &str = include_str!("../e2e/executor/inputs/global-tags.kcl");
const LSYSTEM_PROGRAM: &str = include_str!("../e2e/executor/inputs/lsystem.kcl");
