//! A shared backend trait for lsp servers memory and behavior.

use anyhow::Result;
use dashmap::DashMap;
use tower_lsp::lsp_types::{
    CreateFilesParams, DeleteFilesParams, DidChangeConfigurationParams, DidChangeTextDocumentParams,
    DidChangeWatchedFilesParams, DidChangeWorkspaceFoldersParams, DidCloseTextDocumentParams,
    DidOpenTextDocumentParams, DidSaveTextDocumentParams, InitializedParams, MessageType, RenameFilesParams,
    TextDocumentItem, WorkspaceFolder,
};

use crate::fs::FileSystem;

/// A trait for the backend of the language server.
#[async_trait::async_trait]
pub trait Backend {
    fn client(&self) -> tower_lsp::Client;

    fn fs(&self) -> crate::fs::FileManager;

    fn workspace_folders(&self) -> Vec<WorkspaceFolder>;

    fn add_workspace_folders(&self, folders: Vec<WorkspaceFolder>);

    fn remove_workspace_folders(&self, folders: Vec<WorkspaceFolder>);

    /// Get the current code map.
    fn current_code_map(&self) -> DashMap<String, Vec<u8>>;

    /// Insert a new code map.
    fn insert_current_code_map(&self, uri: String, text: Vec<u8>);

    // Remove from code map.
    fn remove_from_code_map(&self, uri: String) -> Option<(String, Vec<u8>)>;

    /// Clear the current code state.
    fn clear_code_state(&self);

    /// On change event.
    async fn on_change(&self, params: TextDocumentItem);

    async fn update_memory(&self, params: TextDocumentItem) {
        self.insert_current_code_map(params.uri.to_string(), params.text.as_bytes().to_vec());
    }

    async fn update_from_disk<P: AsRef<std::path::Path> + std::marker::Send>(&self, path: P) -> Result<()> {
        // Read over all the files in the directory and add them to our current code map.
        let files = self.fs().get_all_files(path.as_ref(), Default::default()).await?;
        for file in files {
            // Read the file.
            let contents = self.fs().read(&file, Default::default()).await?;
            let file_path = format!(
                "file://{}",
                file.as_path()
                    .to_str()
                    .ok_or_else(|| anyhow::anyhow!("could not get name of file: {:?}", file))?
            );
            self.insert_current_code_map(file_path, contents);
        }

        Ok(())
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
        // TODO: If we are adding a folder that we were previously on, we should not clear the
        // state.
        self.add_workspace_folders(params.event.added.clone());
        self.remove_workspace_folders(params.event.removed);
        // Remove the code from the current code map.
        // We do this since it means the user is changing projects so let's refresh the state.
        if !self.current_code_map().is_empty() {
            self.clear_code_state();
        }
        for added in params.event.added {
            // Try to read all the files in the project.
            let project_dir = added.uri.to_string().replace("file://", "");
            if let Err(err) = self.update_from_disk(&project_dir).await {
                self.client()
                    .log_message(
                        MessageType::WARNING,
                        format!("updating from disk `{}` failed: {:?}", project_dir, err),
                    )
                    .await;
            }
        }
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
        // Create each file in the code map.
        for file in params.files {
            self.insert_current_code_map(file.uri.to_string(), Default::default());
        }
    }

    async fn do_did_rename_files(&self, params: RenameFilesParams) {
        self.client()
            .log_message(MessageType::INFO, format!("files renamed: {:?}", params))
            .await;
        // Rename each file in the code map.
        for file in params.files {
            if let Some((_, value)) = self.remove_from_code_map(file.old_uri) {
                // Rename the file if it exists.
                self.insert_current_code_map(file.new_uri.to_string(), value);
            } else {
                // Otherwise create it.
                self.insert_current_code_map(file.new_uri.to_string(), Default::default());
            }
        }
    }

    async fn do_did_delete_files(&self, params: DeleteFilesParams) {
        self.client()
            .log_message(MessageType::INFO, format!("files deleted: {:?}", params))
            .await;
        // Delete each file in the map.
        for file in params.files {
            self.remove_from_code_map(file.uri.to_string());
        }
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
