//! The copilot lsp server for ghost text.

pub mod cache;
pub mod types;

use std::{
    borrow::Cow,
    fmt::Debug,
    sync::{Arc, RwLock},
};

use dashmap::DashMap;
use serde::{Deserialize, Serialize};
use tower_lsp::{
    jsonrpc::{Error, Result},
    lsp_types::{
        CreateFilesParams, DeleteFilesParams, DidChangeConfigurationParams, DidChangeTextDocumentParams,
        DidChangeWatchedFilesParams, DidChangeWorkspaceFoldersParams, DidCloseTextDocumentParams,
        DidOpenTextDocumentParams, DidSaveTextDocumentParams, InitializeParams, InitializeResult, InitializedParams,
        MessageType, OneOf, RenameFilesParams, ServerCapabilities, TextDocumentItem, TextDocumentSyncCapability,
        TextDocumentSyncKind, TextDocumentSyncOptions, WorkspaceFolder, WorkspaceFoldersServerCapabilities,
        WorkspaceServerCapabilities,
    },
    LanguageServer,
};

use crate::lsp::{
    backend::Backend as _,
    copilot::types::{CopilotCompletionResponse, CopilotEditorInfo, CopilotLspCompletionParams, DocParams},
};

use self::types::{CopilotAcceptCompletionParams, CopilotCompletionTelemetry, CopilotRejectCompletionParams};

#[derive(Deserialize, Serialize, Debug)]
pub struct Success {
    success: bool,
}
impl Success {
    pub fn new(success: bool) -> Self {
        Self { success }
    }
}

#[derive(Debug, Clone)]
pub struct Backend {
    /// The client is used to send notifications and requests to the client.
    pub client: tower_lsp::Client,
    /// The file system client to use.
    pub fs: crate::fs::FileManager,
    /// The workspace folders.
    pub workspace_folders: DashMap<String, WorkspaceFolder>,
    /// Current code.
    pub current_code_map: DashMap<String, Vec<u8>>,
    /// The Zoo API client.
    pub zoo_client: kittycad::Client,
    /// The editor info is used to store information about the editor.
    pub editor_info: Arc<RwLock<CopilotEditorInfo>>,
    /// The cache is used to store the results of previous requests.
    pub cache: Arc<cache::CopilotCache>,
    /// Storage so we can send telemetry data back out.
    pub telemetry: DashMap<uuid::Uuid, CopilotCompletionTelemetry>,
}

// Implement the shared backend trait for the language server.
#[async_trait::async_trait]
impl crate::lsp::backend::Backend for Backend {
    fn client(&self) -> tower_lsp::Client {
        self.client.clone()
    }

    fn fs(&self) -> crate::fs::FileManager {
        self.fs.clone()
    }

    fn workspace_folders(&self) -> Vec<WorkspaceFolder> {
        self.workspace_folders.iter().map(|v| v.value().clone()).collect()
    }

    fn add_workspace_folders(&self, folders: Vec<WorkspaceFolder>) {
        for folder in folders {
            self.workspace_folders.insert(folder.name.to_string(), folder);
        }
    }

    fn remove_workspace_folders(&self, folders: Vec<WorkspaceFolder>) {
        for folder in folders {
            self.workspace_folders.remove(&folder.name);
        }
    }

    fn current_code_map(&self) -> DashMap<String, Vec<u8>> {
        self.current_code_map.clone()
    }

    fn insert_current_code_map(&self, uri: String, text: Vec<u8>) {
        self.current_code_map.insert(uri, text);
    }

    fn remove_from_code_map(&self, uri: String) -> Option<(String, Vec<u8>)> {
        self.current_code_map.remove(&uri)
    }

    fn clear_code_state(&self) {
        self.current_code_map.clear();
    }

    async fn on_change(&self, _params: TextDocumentItem) {
        // We don't need to do anything here.
    }
}

impl Backend {
    /// Get completions from the kittycad api.
    pub async fn get_completions(&self, language: String, prompt: String, suffix: String) -> Result<Vec<String>> {
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

        let resp = self
            .zoo_client
            .ai()
            .create_kcl_code_completions(&body)
            .await
            .map_err(|err| Error {
                code: tower_lsp::jsonrpc::ErrorCode::from(69),
                data: None,
                message: Cow::from(format!("Failed to get completions from zoo api: {}", err)),
            })?;
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
        let offset = crate::lsp::util::position_to_offset(pos.into(), &rope).unwrap_or_default();

        Ok(DocParams {
            uri: uri.to_string(),
            pos,
            language: params.doc.language_id.to_string(),
            prefix: crate::lsp::util::get_text_before(offset, &rope).unwrap_or_default(),
            suffix: crate::lsp::util::get_text_after(offset, &rope).unwrap_or_default(),
            line_before: crate::lsp::util::get_line_before(pos.into(), &rope).unwrap_or_default(),
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

        // Let's not call it yet since it's not our model.
        // We will need to wrap in spawn_local like we do in kcl/mod.rs for wasm only.
        #[cfg(test)]
        let completion_list = self
            .get_completions(doc_params.language, doc_params.prefix, doc_params.suffix)
            .await
            .map_err(|err| Error {
                code: tower_lsp::jsonrpc::ErrorCode::from(69),
                data: None,
                message: Cow::from(format!("Failed to get completions: {}", err)),
            })?;
        #[cfg(not(test))]
        let completion_list = vec![];

        let response = CopilotCompletionResponse::from_str_vec(completion_list, line_before, doc_params.pos);
        // Set the telemetry data for each completion.
        for completion in response.completions.iter() {
            let telemetry = CopilotCompletionTelemetry {
                completion: completion.clone(),
                params: params.clone(),
            };
            self.telemetry.insert(completion.uuid, telemetry);
        }
        self.cache
            .set_cached_result(&doc_params.uri, &doc_params.pos.line, &response);

        Ok(response)
    }

    pub async fn accept_completion(&self, params: CopilotAcceptCompletionParams) {
        self.client
            .log_message(MessageType::INFO, format!("Accepted completions: {:?}", params))
            .await;

        // Get the original telemetry data.
        let Some((_, original)) = self.telemetry.remove(&params.uuid) else {
            return;
        };

        self.client
            .log_message(MessageType::INFO, format!("Original telemetry: {:?}", original))
            .await;

        // TODO: Send the telemetry data to the zoo api.
    }

    pub async fn reject_completions(&self, params: CopilotRejectCompletionParams) {
        self.client
            .log_message(MessageType::INFO, format!("Rejected completions: {:?}", params))
            .await;

        // Get the original telemetry data.
        let mut originals: Vec<CopilotCompletionTelemetry> = Default::default();
        for uuid in params.uuids {
            if let Some((_, original)) = self.telemetry.remove(&uuid) {
                originals.push(original);
            }
        }

        self.client
            .log_message(MessageType::INFO, format!("Original telemetry: {:?}", originals))
            .await;

        // TODO: Send the telemetry data to the zoo api.
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
