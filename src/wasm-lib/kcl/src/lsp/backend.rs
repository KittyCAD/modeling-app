//! A shared backend trait for lsp servers memory and behavior.

use std::sync::Arc;

use anyhow::Result;
use tokio::sync::RwLock;
use tower_lsp::lsp_types::{
    CreateFilesParams, DeleteFilesParams, DidChangeConfigurationParams, DidChangeTextDocumentParams,
    DidChangeWatchedFilesParams, DidChangeWorkspaceFoldersParams, DidCloseTextDocumentParams,
    DidOpenTextDocumentParams, DidSaveTextDocumentParams, DocumentDiagnosticReport, InitializedParams, MessageType,
    RenameFilesParams, TextDocumentItem, WorkspaceFolder,
};

use crate::{
    fs::FileSystem,
    lsp::safemap::SafeMap,
    thread::{JoinHandle, Thread},
};

#[derive(Clone)]
pub struct InnerHandle(Arc<JoinHandle>);

impl InnerHandle {
    pub fn new(handle: JoinHandle) -> Self {
        Self(Arc::new(handle))
    }

    pub fn is_finished(&self) -> bool {
        self.0.is_finished()
    }

    pub fn cancel(&self) {
        self.0.abort();
    }
}

#[derive(Clone)]
pub struct UpdateHandle(Arc<RwLock<Option<InnerHandle>>>);

impl UpdateHandle {
    pub fn new(handle: InnerHandle) -> Self {
        Self(Arc::new(RwLock::new(Some(handle))))
    }

    pub async fn read(&self) -> Option<InnerHandle> {
        self.0.read().await.clone()
    }

    pub async fn write(&self, handle: Option<InnerHandle>) {
        *self.0.write().await = handle;
    }
}

impl Default for UpdateHandle {
    fn default() -> Self {
        Self(Arc::new(RwLock::new(None)))
    }
}

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

    async fn current_handle(&self) -> Option<InnerHandle>;

    async fn set_current_handle(&self, handle: Option<InnerHandle>);

    async fn workspace_folders(&self) -> Vec<WorkspaceFolder>;

    async fn add_workspace_folders(&self, folders: Vec<WorkspaceFolder>);

    async fn remove_workspace_folders(&self, folders: Vec<WorkspaceFolder>);

    /// Get the current code map.
    fn code_map(&self) -> &SafeMap<String, Vec<u8>>;

    /// Insert a new code map.
    async fn insert_code_map(&self, uri: String, text: Vec<u8>);

    // Remove from code map.
    async fn remove_from_code_map(&self, uri: String) -> Option<Vec<u8>>;

    /// Clear the current code state.
    async fn clear_code_state(&self);

    /// Get the current diagnostics map.
    fn current_diagnostics_map(&self) -> SafeMap<String, DocumentDiagnosticReport>;

    /// On change event.
    async fn inner_on_change(&self, params: TextDocumentItem, force: bool);

    /// Check if the file has diagnostics.
    async fn has_diagnostics(&self, uri: &str) -> bool {
        if let Some(tower_lsp::lsp_types::DocumentDiagnosticReport::Full(diagnostics)) =
            self.current_diagnostics_map().get(uri).await
        {
            !diagnostics.full_document_diagnostic_report.items.is_empty()
        } else {
            false
        }
    }

    async fn on_change(&self, params: TextDocumentItem) {
        // Check if the document is in the current code map and if it is the same as what we have
        // stored.
        let filename = params.uri.to_string();
        if let Some(current_code) = self.code_map().get(&filename).await {
            if current_code == params.text.as_bytes() && !self.has_diagnostics(&filename).await {
                return;
            }
        }

        // Check if we already have a handle running.
        if let Some(current_handle) = self.current_handle().await {
            self.set_current_handle(None).await;
            // Drop that handle to cancel it.
            current_handle.cancel();
        }

        let cloned = self.clone();
        let task = JoinHandle::new(async move {
            cloned
                .insert_code_map(params.uri.to_string(), params.text.as_bytes().to_vec())
                .await;
            cloned.inner_on_change(params, false).await;
            cloned.set_current_handle(None).await;
        });
        let update_handle = InnerHandle::new(task);

        // Set our new handle.
        self.set_current_handle(Some(update_handle.clone())).await;
    }

    async fn wait_on_handle(&self) {
        while let Some(handle) = self.current_handle().await {
            if !handle.is_finished() {
                tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
            } else {
                break;
            }
        }
        self.set_current_handle(None).await;
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
            self.insert_code_map(file_path, contents).await;
        }

        Ok(())
    }

    async fn do_initialized(&self, params: InitializedParams) {
        self.client()
            .log_message(MessageType::INFO, format!("initialized: {:?}", params))
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
        if !self.code_map().is_empty().await && should_clear {
            self.clear_code_state().await;
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
            self.insert_code_map(file.uri.to_string(), Default::default()).await;
        }
    }

    async fn do_did_rename_files(&self, params: RenameFilesParams) {
        self.client()
            .log_message(MessageType::INFO, format!("files renamed: {:?}", params))
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
            .log_message(MessageType::INFO, format!("files deleted: {:?}", params))
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
            .log_message(MessageType::INFO, format!("document closed: {:?}", params))
            .await;
    }
}
