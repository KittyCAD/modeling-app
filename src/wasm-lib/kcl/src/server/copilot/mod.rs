//! The copilot lsp server for ghost text.

pub mod cache;
pub mod types;

use std::{
    borrow::Cow,
    fmt::Debug,
    sync::{Arc, RwLock},
};

use dashmap::DashMap;
use eventsource_stream::Eventsource;
use futures::StreamExt;
use serde::{Deserialize, Serialize};
use tower_lsp::{
    jsonrpc::{Error, Result},
    lsp_types::{
        CreateFilesParams, DeleteFilesParams, DidChangeConfigurationParams, DidChangeTextDocumentParams,
        DidChangeWatchedFilesParams, DidChangeWorkspaceFoldersParams, DidCloseTextDocumentParams,
        DidOpenTextDocumentParams, DidSaveTextDocumentParams, InitializeParams, InitializeResult, InitializedParams,
        MessageType, OneOf, RenameFilesParams, ServerCapabilities, TextDocumentItem, TextDocumentSyncCapability,
        TextDocumentSyncKind, TextDocumentSyncOptions, WorkspaceFoldersServerCapabilities, WorkspaceServerCapabilities,
    },
    LanguageServer,
};

use crate::server::{
    backend::Backend as _,
    copilot::types::{
        CopilotCompletionResponse, CopilotEditorInfo, CopilotLspCompletionParams, CopilotResponse, DocParams,
    },
};

#[derive(Deserialize, Serialize, Debug)]
pub struct Success {
    success: bool,
}
impl Success {
    pub fn new(success: bool) -> Self {
        Self { success }
    }
}

#[derive(Debug)]
pub struct Backend {
    /// The client is used to send notifications and requests to the client.
    pub client: tower_lsp::Client,
    /// Current code.
    pub current_code_map: DashMap<String, String>,
    /// The token is used to authenticate requests to the API server.
    pub token: String,
    /// The editor info is used to store information about the editor.
    pub editor_info: Arc<RwLock<CopilotEditorInfo>>,
    /// The cache is used to store the results of previous requests.
    pub cache: cache::CopilotCache,
}

// Implement the shared backend trait for the language server.
#[async_trait::async_trait]
impl crate::server::backend::Backend for Backend {
    fn client(&self) -> tower_lsp::Client {
        self.client.clone()
    }

    fn current_code_map(&self) -> DashMap<String, String> {
        self.current_code_map.clone()
    }

    fn insert_current_code_map(&self, uri: String, text: String) {
        self.current_code_map.insert(uri, text);
    }

    async fn on_change(&self, _params: TextDocumentItem) {
        // We don't need to do anything here.
    }
}

fn handle_event(event: eventsource_stream::Event) -> CopilotResponse {
    if event.data == "[DONE]" {
        return CopilotResponse::Done;
    }
    match serde_json::from_str(&event.data) {
        Ok(data) => CopilotResponse::Answer(data),
        Err(e) => CopilotResponse::Error(e.to_string()),
    }
}

impl Backend {
    /// Get completions from the kittycad api.
    async fn get_completions(&self, language: String, prompt: String, suffix: String) -> anyhow::Result<Vec<String>> {
        let body = kittycad::types::KclCodeCompletionRequest {
            prompt: Some(prompt.clone()),
            suffix: Some(suffix.clone()),
            max_tokens: Some(500),
            temperature: Some(1.0),
            top_p: Some(1.0),
            // We only handle one completion at a time, for now so don't even waste the tokens.
            n: Some(1),
            stop: Some(["unset".to_string()].to_vec()),
            nwo: None,
            // We haven't implemented streaming yet.
            stream: None,
            extra: Some(kittycad::types::KclCodeCompletionParams {
                language: Some(language.to_string()),
                next_indent: None,
                trim_by_indentation: Some(true),
                prompt_tokens: Some(prompt.len() as u32),
                suffix_tokens: Some(suffix.len() as u32),
            }),
        };

        let kc_client = kittycad::Client::new(&self.token);
        let resp = kc_client.ai().create_kcl_code_completions(&body).await?;
        Ok(resp.completions)
    }

    pub async fn set_editor_info(&self, params: CopilotEditorInfo) -> Result<Success> {
        self.client.log_message(MessageType::INFO, "setEditorInfo").await;
        let copy = Arc::clone(&self.editor_info);
        let mut lock = copy.write().map_err(|err| Error {
            code: tower_lsp::jsonrpc::ErrorCode::from(69),
            data: None,
            message: Cow::from(format!("Failed lock: {}", err)),
        })?;
        *lock = params;
        Ok(Success::new(true))
    }

    pub fn get_doc_params(&self, params: &CopilotLspCompletionParams) -> Result<DocParams> {
        let pos = params.doc.position;
        let uri = params.doc.uri.to_string();
        let rope = ropey::Rope::from_str(&params.doc.source);
        let offset = crate::server::util::position_to_offset(pos, &rope).unwrap_or_default();

        Ok(DocParams {
            uri: uri.to_string(),
            pos,
            language: params.doc.language_id.to_string(),
            prefix: crate::server::util::get_text_before(offset, &rope).unwrap_or_default(),
            suffix: crate::server::util::get_text_after(offset, &rope).unwrap_or_default(),
            line_before: crate::server::util::get_line_before(pos, &rope).unwrap_or_default(),
            rope,
        })
    }

    pub async fn get_completions_cycling(
        &self,
        params: CopilotLspCompletionParams,
    ) -> Result<CopilotCompletionResponse> {
        let doc_params = self.get_doc_params(&params)?;
        let cached_result = self.cache.get_cached_result(&doc_params.uri, doc_params.pos.line);
        if let Some(cached_result) = cached_result {
            return Ok(cached_result);
        }

        let doc_params = self.get_doc_params(&params)?;
        let line_before = doc_params.line_before.to_string();
        let _prompt = format!("// Path: {}\n{}", doc_params.uri, doc_params.prefix);

        let completion_list = self
            .get_completions(doc_params.language, doc_params.prefix, doc_params.suffix)
            .await
            .map_err(|err| Error {
                code: tower_lsp::jsonrpc::ErrorCode::from(69),
                data: None,
                message: Cow::from(format!("Failed to get completions: {}", err)),
            })?;

        let response = CopilotCompletionResponse::from_str_vec(completion_list, line_before, doc_params.pos);
        self.cache
            .set_cached_result(&doc_params.uri, &doc_params.pos.line, &response);

        Ok(response)
    }

    pub async fn accept_completions(&self, params: Vec<String>) {
        self.client
            .log_message(MessageType::INFO, format!("Accepted completions: {:?}", params))
            .await;

        // TODO: send telemetry data back out that we accepted the completions
    }

    pub async fn reject_completions(&self, params: Vec<String>) {
        self.client
            .log_message(MessageType::INFO, format!("Rejected completions: {:?}", params))
            .await;

        // TODO: send telemetry data back out that we rejected the completions
    }
}

#[tower_lsp::async_trait]
impl LanguageServer for Backend {
    async fn initialize(&self, _: InitializeParams) -> Result<InitializeResult> {
        Ok(InitializeResult {
            capabilities: ServerCapabilities {
                text_document_sync: Some(TextDocumentSyncCapability::Options(TextDocumentSyncOptions {
                    open_close: Some(true),
                    change: Some(TextDocumentSyncKind::FULL),
                    ..Default::default()
                })),
                workspace: Some(WorkspaceServerCapabilities {
                    workspace_folders: Some(WorkspaceFoldersServerCapabilities {
                        supported: Some(true),
                        change_notifications: Some(OneOf::Left(true)),
                    }),
                    file_operations: None,
                }),
                ..ServerCapabilities::default()
            },
            ..Default::default()
        })
    }

    async fn initialized(&self, params: InitializedParams) {
        self.do_initialized(params).await
    }

    async fn shutdown(&self) -> tower_lsp::jsonrpc::Result<()> {
        self.do_shutdown().await
    }

    async fn did_change_workspace_folders(&self, params: DidChangeWorkspaceFoldersParams) {
        self.do_did_change_workspace_folders(params).await
    }

    async fn did_change_configuration(&self, params: DidChangeConfigurationParams) {
        self.do_did_change_configuration(params).await
    }

    async fn did_change_watched_files(&self, params: DidChangeWatchedFilesParams) {
        self.do_did_change_watched_files(params).await
    }

    async fn did_create_files(&self, params: CreateFilesParams) {
        self.do_did_create_files(params).await
    }

    async fn did_rename_files(&self, params: RenameFilesParams) {
        self.do_did_rename_files(params).await
    }

    async fn did_delete_files(&self, params: DeleteFilesParams) {
        self.do_did_delete_files(params).await
    }

    async fn did_open(&self, params: DidOpenTextDocumentParams) {
        self.do_did_open(params).await
    }

    async fn did_change(&self, params: DidChangeTextDocumentParams) {
        self.do_did_change(params.clone()).await;
    }

    async fn did_save(&self, params: DidSaveTextDocumentParams) {
        self.do_did_save(params).await
    }

    async fn did_close(&self, params: DidCloseTextDocumentParams) {
        self.do_did_close(params).await
    }
}
