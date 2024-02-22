//! A shared backend trait for lsp servers memory and behavior.

use dashmap::DashMap;
use tower_lsp::lsp_types::{
    CreateFilesParams, DeleteFilesParams, DidChangeConfigurationParams, DidChangeTextDocumentParams,
    DidChangeWatchedFilesParams, DidChangeWorkspaceFoldersParams, DidCloseTextDocumentParams,
    DidOpenTextDocumentParams, DidSaveTextDocumentParams, InitializedParams, MessageType, RenameFilesParams,
    TextDocumentItem,
};

/// A trait for the backend of the language server.
#[async_trait::async_trait]
pub trait Backend {
    fn client(&self) -> tower_lsp::Client;

    fn fs(&self) -> crate::fs::FileManager;

    /// Get the current code map.
    fn current_code_map(&self) -> DashMap<String, String>;

    /// Insert a new code map.
    fn insert_current_code_map(&self, uri: String, text: String);

    /// On change event.
    async fn on_change(&self, params: TextDocumentItem);

    async fn update_memory(&self, params: TextDocumentItem) {
        // Lets update the tokens.
        self.insert_current_code_map(params.uri.to_string(), params.text.clone());
    }

    async fn do_initialized(&self, params: InitializedParams) {
        self.client()
            .log_message(MessageType::INFO, format!("initialized: {:?}", params))
            .await;
    }

    async fn do_shutdown(&self) -> tower_lsp::jsonrpc::Result<()> {
        self.client()
            .log_message(MessageType::INFO, "shutdown".to_string())
            .await;
        Ok(())
    }

    async fn do_did_change_workspace_folders(&self, params: DidChangeWorkspaceFoldersParams) {
        self.client()
            .log_message(MessageType::INFO, format!("workspace folders changed: {:?}", params))
            .await;
    }

    async fn do_did_change_configuration(&self, params: DidChangeConfigurationParams) {
        self.client()
            .log_message(MessageType::INFO, format!("configuration changed: {:?}", params))
            .await;
    }

    async fn do_did_change_watched_files(&self, params: DidChangeWatchedFilesParams) {
        self.client()
            .log_message(MessageType::INFO, format!("watched files changed: {:?}", params))
            .await;
    }

    async fn do_did_create_files(&self, params: CreateFilesParams) {
        self.client()
            .log_message(MessageType::INFO, format!("files created: {:?}", params))
            .await;
    }

    async fn do_did_rename_files(&self, params: RenameFilesParams) {
        self.client()
            .log_message(MessageType::INFO, format!("files renamed: {:?}", params))
            .await;
    }

    async fn do_did_delete_files(&self, params: DeleteFilesParams) {
        self.client()
            .log_message(MessageType::INFO, format!("files deleted: {:?}", params))
            .await;
    }

    async fn do_did_open(&self, params: DidOpenTextDocumentParams) {
        let new_params = TextDocumentItem {
            uri: params.text_document.uri,
            text: params.text_document.text,
            version: params.text_document.version,
            language_id: params.text_document.language_id,
        };
        self.update_memory(new_params.clone()).await;
        self.on_change(new_params).await;
    }

    async fn do_did_change(&self, mut params: DidChangeTextDocumentParams) {
        let new_params = TextDocumentItem {
            uri: params.text_document.uri,
            text: std::mem::take(&mut params.content_changes[0].text),
            version: params.text_document.version,
            language_id: Default::default(),
        };
        self.update_memory(new_params.clone()).await;
        self.on_change(new_params).await;
    }

    async fn do_did_save(&self, params: DidSaveTextDocumentParams) {
        if let Some(text) = params.text {
            let new_params = TextDocumentItem {
                uri: params.text_document.uri,
                text,
                version: Default::default(),
                language_id: Default::default(),
            };
            self.update_memory(new_params.clone()).await;
            self.on_change(new_params).await;
        }
    }

    async fn do_did_close(&self, params: DidCloseTextDocumentParams) {
        self.client()
            .log_message(MessageType::INFO, format!("document closed: {:?}", params))
            .await;
    }
}
