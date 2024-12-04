use iai::black_box;
use kcl_lib::kcl_lsp_server;
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

async fn semantic_tokens_global_tags() {
    let code = GLOBAL_TAGS_FILE;
    kcl_lsp_semantic_tokens(code).await;
}

iai::main! {
    semantic_tokens_global_tags,
}

const GLOBAL_TAGS_FILE: &str = include_str!("../../tests/executor/inputs/global-tags.kcl");
