//! A shared backend trait for lsp servers memory and behavior.

use std::sync::Arc;

use anyhow::Result;
use dashmap::DashMap;
use tower_lsp::lsp_types::{
    CreateFilesParams, DeleteFilesParams, Diagnostic, DidChangeConfigurationParams, DidChangeTextDocumentParams,
    DidChangeWatchedFilesParams, DidChangeWorkspaceFoldersParams, DidCloseTextDocumentParams,
    DidOpenTextDocumentParams, DidSaveTextDocumentParams, InitializedParams, MessageType, RenameFilesParams,
    TextDocumentItem, WorkspaceFolder,
};

use crate::{execution::typed_path::TypedPath, fs::FileSystem};

/// A trait for the backend of the language server.
#[async_trait::async_trait]
pub trait Backend: Clone + Send + Sync
where
    Self: 'static,
{
    fn client(&self) -> &tower_lsp::Client;

    fn fs(&self) -> &Arc<crate::fs::FileManager>;

    async fn is_initialized(&self) -> bool;

    async fn set_is_initialized(&self, is_initialized: bool);

    async fn workspace_folders(&self) -> Vec<WorkspaceFolder>;

    async fn add_workspace_folders(&self, folders: Vec<WorkspaceFolder>);

    async fn remove_workspace_folders(&self, folders: Vec<WorkspaceFolder>);

    /// Get the current code map.
    fn code_map(&self) -> &DashMap<String, Vec<u8>>;

    /// Insert a new code map.
    async fn insert_code_map(&self, uri: String, text: Vec<u8>);

    // Remove from code map.
    async fn remove_from_code_map(&self, uri: String) -> Option<Vec<u8>>;

    /// Clear the current code state.
    async fn clear_code_state(&self);

    /// Get the current diagnostics map.
    fn current_diagnostics_map(&self) -> &DashMap<String, Vec<Diagnostic>>;

    /// On change event.
    async fn inner_on_change(&self, params: TextDocumentItem, force: bool);

    /// Check if the file has diagnostics.
    async fn has_diagnostics(&self, uri: &str) -> bool {
        let Some(diagnostics) = self.current_diagnostics_map().get(uri) else {
            return false;
        };

        !diagnostics.is_empty()
    }

    async fn on_change(&self, params: TextDocumentItem) {
        // Check if the document is in the current code map and if it is the same as what we have
        // stored.
        let filename = params.uri.to_string();
        if let Some(current_code) = self.code_map().get(&filename) {
            if *current_code == params.text.as_bytes() && !self.has_diagnostics(&filename).await {
                return;
            }
        }

        self.insert_code_map(params.uri.to_string(), params.text.as_bytes().to_vec())
            .await;
        self.inner_on_change(params, false).await;
    }

    async fn update_from_disk(&self, path: &TypedPath) -> Result<()> {
        // Read over all the files in the directory and add them to our current code map.
        let files = self.fs().get_all_files(path, Default::default()).await?;
        for file in files {
            // Read the file.
            let contents = self.fs().read(&file, Default::default()).await?;
            let file_path = format!("file://{}", file.to_string_lossy());
            self.insert_code_map(file_path, contents).await;
        }

        Ok(())
    }

    async fn do_initialized(&self, params: InitializedParams) {
        self.client()
            .log_message(MessageType::INFO, format!("initialized: {params:?}"))
            .await;

        self.set_is_initialized(true).await;
    }

    async fn do_shutdown(&self) -> tower_lsp::jsonrpc::Result<()> {
        self.client()
            .log_message(MessageType::INFO, "shutdown".to_string())
            .await;
        Ok(())
    }

    async fn do_did_change_workspace_folders(&self, params: DidChangeWorkspaceFoldersParams) {
        // If we are adding a folder that we were previously on, we should not clear the
        // state.
        let should_clear = if !params.event.added.is_empty() {
            let mut should_clear = false;
            for folder in params.event.added.iter() {
                if !self
                    .workspace_folders()
                    .await
                    .iter()
                    .any(|f| f.uri == folder.uri && f.name == folder.name)
                {
                    should_clear = true;
                    break;
                }
            }

            should_clear
        } else {
            !(params.event.removed.is_empty() && params.event.added.is_empty())
        };

        self.add_workspace_folders(params.event.added.clone()).await;
        self.remove_workspace_folders(params.event.removed).await;
        // Remove the code from the current code map.
        // We do this since it means the user is changing projects so let's refresh the state.
        if !self.code_map().is_empty() && should_clear {
            self.clear_code_state().await;
        }
        for added in params.event.added {
            // Try to read all the files in the project.
            let project_dir = TypedPath::from(&added.uri.to_string().replace("file://", ""));
            if let Err(err) = self.update_from_disk(&project_dir).await {
                self.client()
                    .log_message(
                        MessageType::WARNING,
                        format!("updating from disk `{project_dir}` failed: {err:?}"),
                    )
                    .await;
            }
        }
    }

    async fn do_did_change_configuration(&self, params: DidChangeConfigurationParams) {
        self.client()
            .log_message(MessageType::INFO, format!("configuration changed: {params:?}"))
            .await;
    }

    async fn do_did_change_watched_files(&self, params: DidChangeWatchedFilesParams) {
        self.client()
            .log_message(MessageType::INFO, format!("watched files changed: {params:?}"))
            .await;
    }

    async fn do_did_create_files(&self, params: CreateFilesParams) {
        self.client()
            .log_message(MessageType::INFO, format!("files created: {params:?}"))
            .await;
        // Create each file in the code map.
        for file in params.files {
            self.insert_code_map(file.uri.to_string(), Default::default()).await;
        }
    }

    async fn do_did_rename_files(&self, params: RenameFilesParams) {
        self.client()
            .log_message(MessageType::INFO, format!("files renamed: {params:?}"))
            .await;
        // Rename each file in the code map.
        for file in params.files {
            if let Some(value) = self.remove_from_code_map(file.old_uri).await {
                // Rename the file if it exists.
                self.insert_code_map(file.new_uri.to_string(), value).await;
            } else {
                // Otherwise create it.
                self.insert_code_map(file.new_uri.to_string(), Default::default()).await;
            }
        }
    }

    async fn do_did_delete_files(&self, params: DeleteFilesParams) {
        self.client()
            .log_message(MessageType::INFO, format!("files deleted: {params:?}"))
            .await;
        // Delete each file in the map.
        for file in params.files {
            self.remove_from_code_map(file.uri.to_string()).await;
        }
    }

    async fn do_did_open(&self, params: DidOpenTextDocumentParams) {
        let new_params = TextDocumentItem {
            uri: params.text_document.uri,
            text: params.text_document.text,
            version: params.text_document.version,
            language_id: params.text_document.language_id,
        };
        self.on_change(new_params).await;
    }

    async fn do_did_change(&self, mut params: DidChangeTextDocumentParams) {
        let new_params = TextDocumentItem {
            uri: params.text_document.uri,
            text: std::mem::take(&mut params.content_changes[0].text),
            version: params.text_document.version,
            language_id: Default::default(),
        };
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
            self.on_change(new_params).await;
        }
    }

    async fn do_did_close(&self, params: DidCloseTextDocumentParams) {
        self.client()
            .log_message(MessageType::INFO, format!("document closed: {params:?}"))
            .await;
    }
}
