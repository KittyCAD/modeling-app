//! Functions for the `kcl` lsp server.

use std::{collections::HashMap, io::Write, str::FromStr, sync::Arc};

use tokio::sync::RwLock;

pub mod custom_notifications;

use anyhow::Result;
#[cfg(feature = "cli")]
use clap::Parser;
use sha2::Digest;
use tower_lsp::{
    jsonrpc::Result as RpcResult,
    lsp_types::{
        CompletionItem, CompletionItemKind, CompletionOptions, CompletionParams, CompletionResponse, CreateFilesParams,
        DeleteFilesParams, DiagnosticOptions, DiagnosticServerCapabilities, DidChangeConfigurationParams,
        DidChangeTextDocumentParams, DidChangeWatchedFilesParams, DidChangeWorkspaceFoldersParams,
        DidCloseTextDocumentParams, DidOpenTextDocumentParams, DidSaveTextDocumentParams, DocumentDiagnosticParams,
        DocumentDiagnosticReport, DocumentDiagnosticReportResult, DocumentFilter, DocumentFormattingParams,
        DocumentSymbol, DocumentSymbolParams, DocumentSymbolResponse, Documentation, FoldingRange, FoldingRangeParams,
        FoldingRangeProviderCapability, FullDocumentDiagnosticReport, Hover, HoverContents, HoverParams,
        HoverProviderCapability, InitializeParams, InitializeResult, InitializedParams, InlayHint, InlayHintParams,
        InsertTextFormat, MarkupContent, MarkupKind, MessageType, OneOf, Position, RelatedFullDocumentDiagnosticReport,
        RenameFilesParams, RenameParams, SemanticToken, SemanticTokenType, SemanticTokens, SemanticTokensFullOptions,
        SemanticTokensLegend, SemanticTokensOptions, SemanticTokensParams, SemanticTokensRegistrationOptions,
        SemanticTokensResult, SemanticTokensServerCapabilities, ServerCapabilities, SignatureHelp,
        SignatureHelpOptions, SignatureHelpParams, StaticRegistrationOptions, TextDocumentItem,
        TextDocumentRegistrationOptions, TextDocumentSyncCapability, TextDocumentSyncKind, TextDocumentSyncOptions,
        TextEdit, WorkDoneProgressOptions, WorkspaceEdit, WorkspaceFolder, WorkspaceFoldersServerCapabilities,
        WorkspaceServerCapabilities,
    },
    Client, LanguageServer,
};

use super::backend::{InnerHandle, UpdateHandle};
use crate::{
    ast::types::VariableKind,
    executor::SourceRange,
    lint::checks,
    lsp::{backend::Backend as _, safemap::SafeMap, util::IntoDiagnostic},
    parser::PIPE_OPERATOR,
};

/// A subcommand for running the server.
#[derive(Clone, Debug)]
#[cfg_attr(feature = "cli", derive(Parser))]
pub struct Server {
    /// Port that the server should listen
    #[cfg_attr(feature = "cli", clap(long, default_value = "8080"))]
    pub socket: i32,

    /// Listen over stdin and stdout instead of a tcp socket.
    #[cfg_attr(feature = "cli", clap(short, long, default_value = "false"))]
    pub stdio: bool,
}

/// The lsp server backend.
#[derive(Clone)]
pub struct Backend {
    /// The client for the backend.
    pub client: Client,
    /// The file system client to use.
    pub fs: Arc<crate::fs::FileManager>,
    /// The workspace folders.
    pub workspace_folders: SafeMap<String, WorkspaceFolder>,
    /// The stdlib completions for the language.
    pub stdlib_completions: HashMap<String, CompletionItem>,
    /// The stdlib signatures for the language.
    pub stdlib_signatures: HashMap<String, SignatureHelp>,
    /// The types of tokens the server supports.
    pub token_types: Vec<SemanticTokenType>,
    /// Token maps.
    pub token_map: SafeMap<String, Vec<crate::token::Token>>,
    /// AST maps.
    pub ast_map: SafeMap<String, crate::ast::types::Program>,
    /// Memory maps.
    pub memory_map: SafeMap<String, crate::executor::ProgramMemory>,
    /// Current code.
    pub code_map: SafeMap<String, Vec<u8>>,
    /// Diagnostics.
    pub diagnostics_map: SafeMap<String, DocumentDiagnosticReport>,
    /// Symbols map.
    pub symbols_map: SafeMap<String, Vec<DocumentSymbol>>,
    /// Semantic tokens map.
    pub semantic_tokens_map: SafeMap<String, Vec<SemanticToken>>,
    /// The Zoo API client.
    pub zoo_client: kittycad::Client,
    /// If we can send telemetry for this user.
    pub can_send_telemetry: bool,
    /// Optional executor context to use if we want to execute the code.
    pub executor_ctx: Arc<RwLock<Option<crate::executor::ExecutorContext>>>,
    /// If we are currently allowed to execute the ast.
    pub can_execute: Arc<RwLock<bool>>,

    pub is_initialized: Arc<RwLock<bool>>,
    pub current_handle: UpdateHandle,
}

// Implement the shared backend trait for the language server.
#[async_trait::async_trait]
impl crate::lsp::backend::Backend for Backend {
    fn client(&self) -> Client {
        self.client.clone()
    }

    fn fs(&self) -> Arc<crate::fs::FileManager> {
        self.fs.clone()
    }

    async fn is_initialized(&self) -> bool {
        *self.is_initialized.read().await
    }

    async fn set_is_initialized(&self, is_initialized: bool) {
        *self.is_initialized.write().await = is_initialized;
    }

    async fn current_handle(&self) -> Option<InnerHandle> {
        self.current_handle.read().await
    }

    async fn set_current_handle(&self, handle: Option<InnerHandle>) {
        self.current_handle.write(handle).await;
    }

    async fn workspace_folders(&self) -> Vec<WorkspaceFolder> {
        self.workspace_folders.inner().await.values().cloned().collect()
    }

    async fn add_workspace_folders(&self, folders: Vec<WorkspaceFolder>) {
        for folder in folders {
            self.workspace_folders.insert(folder.name.to_string(), folder).await;
        }
    }

    async fn remove_workspace_folders(&self, folders: Vec<WorkspaceFolder>) {
        for folder in folders {
            self.workspace_folders.remove(&folder.name).await;
        }
    }

    fn code_map(&self) -> SafeMap<String, Vec<u8>> {
        self.code_map.clone()
    }

    async fn insert_code_map(&self, uri: String, text: Vec<u8>) {
        self.code_map.insert(uri, text).await;
    }

    async fn remove_from_code_map(&self, uri: String) -> Option<Vec<u8>> {
        self.code_map.remove(&uri).await
    }

    async fn clear_code_state(&self) {
        self.code_map.clear().await;
        self.token_map.clear().await;
        self.ast_map.clear().await;
        self.diagnostics_map.clear().await;
        self.symbols_map.clear().await;
        self.semantic_tokens_map.clear().await;
    }

    fn current_diagnostics_map(&self) -> SafeMap<String, DocumentDiagnosticReport> {
        self.diagnostics_map.clone()
    }

    async fn inner_on_change(&self, params: TextDocumentItem, force: bool) {
        self.clear_diagnostics_map(&params.uri).await;
        // We already updated the code map in the shared backend.

        // Lets update the tokens.
        let tokens = match crate::token::lexer(&params.text) {
            Ok(tokens) => tokens,
            Err(err) => {
                self.add_to_diagnostics(&params, err).await;
                return;
            }
        };

        // Get the previous tokens.
        let previous_tokens = self.token_map.get(&params.uri.to_string()).await;

        // Try to get the memory for the current code.
        let has_memory = if let Some(memory) = self.memory_map.get(&params.uri.to_string()).await {
            memory != crate::executor::ProgramMemory::default()
        } else {
            false
        };

        let tokens_changed = if let Some(previous_tokens) = previous_tokens.clone() {
            previous_tokens != tokens
        } else {
            true
        };

        // Check if the tokens are the same.
        if !tokens_changed && !force && has_memory && !self.has_diagnostics(params.uri.as_ref()).await {
            // We return early here because the tokens are the same.
            return;
        }

        if tokens_changed {
            // Update our token map.
            self.token_map.insert(params.uri.to_string(), tokens.clone()).await;
            // Update our semantic tokens.
            self.update_semantic_tokens(tokens.clone(), &params).await;
        }

        // Lets update the ast.
        let parser = crate::parser::Parser::new(tokens);
        let result = parser.ast();
        let ast = match result {
            Ok(ast) => ast,
            Err(err) => {
                self.add_to_diagnostics(&params, err).await;
                return;
            }
        };

        // Check if the ast changed.
        let ast_changed = match self.ast_map.get(&params.uri.to_string()).await {
            Some(old_ast) => {
                // Check if the ast changed.
                old_ast != ast
            }
            None => true,
        };

        if !ast_changed && !force && has_memory && !self.has_diagnostics(params.uri.as_ref()).await {
            // Return early if the ast did not change and we don't need to force.
            return;
        }

        if ast_changed {
            self.ast_map.insert(params.uri.to_string(), ast.clone()).await;
            // Update the symbols map.
            self.symbols_map
                .insert(params.uri.to_string(), ast.get_lsp_symbols(&params.text))
                .await;
        }

        // Send the notification to the client that the ast was updated.
        if self.can_execute().await || self.executor_ctx().await.is_none() {
            // Only send the notification if we can execute.
            // Otherwise it confuses the client.
            self.client
                .send_notification::<custom_notifications::AstUpdated>(ast.clone())
                .await;
        }

        // Execute the code if we have an executor context.
        // This function automatically executes if we should & updates the diagnostics if we got
        // errors.
        if self.execute(&params, ast.clone()).await.is_err() {
            // if there was an issue, let's bail and avoid trying to lint.
            return;
        }

        for discovered_finding in ast.lint(checks::lint_variables).into_iter().flatten() {
            self.add_to_diagnostics(&params, discovered_finding).await;
        }
    }
}

impl Backend {
    pub async fn can_execute(&self) -> bool {
        *self.can_execute.read().await
    }

    async fn set_can_execute(&self, can_execute: bool) {
        *self.can_execute.write().await = can_execute;
    }

    pub async fn executor_ctx(&self) -> Option<crate::executor::ExecutorContext> {
        self.executor_ctx.read().await.clone()
    }

    async fn set_executor_ctx(&self, executor_ctx: crate::executor::ExecutorContext) {
        *self.executor_ctx.write().await = Some(executor_ctx);
    }

    async fn update_semantic_tokens(&self, tokens: Vec<crate::token::Token>, params: &TextDocumentItem) {
        // Update the semantic tokens map.
        let mut semantic_tokens = vec![];
        let mut last_position = Position::new(0, 0);
        for token in &tokens {
            let Ok(mut token_type) = SemanticTokenType::try_from(token.token_type) else {
                // We continue here because not all tokens can be converted this way, we will get
                // the rest from the ast.
                continue;
            };

            if token.token_type == crate::token::TokenType::Word && self.stdlib_completions.contains_key(&token.value) {
                // This is a stdlib function.
                token_type = SemanticTokenType::FUNCTION;
            }

            let token_type_index = match self.get_semantic_token_type_index(token_type.clone()) {
                Some(index) => index,
                // This is actually bad this should not fail.
                // TODO: ensure we never get here.
                None => {
                    self.client
                        .log_message(
                            MessageType::INFO,
                            format!("token type `{:?}` not accounted for", token_type),
                        )
                        .await;
                    continue;
                }
            };

            let source_range: SourceRange = token.clone().into();
            let position = source_range.start_to_lsp_position(&params.text);

            // We need to check if we are on the last token of the line.
            // If we are starting from the end of the last line just add 1 to the line.
            // Check if we are on the last token of the line.
            if let Some(line) = params.text.lines().nth(position.line as usize) {
                if line.len() == position.character as usize {
                    // We are on the last token of the line.
                    // We need to add a new line.
                    let semantic_token = SemanticToken {
                        delta_line: position.line - last_position.line + 1,
                        delta_start: 0,
                        length: token.value.len() as u32,
                        token_type: token_type_index as u32,
                        token_modifiers_bitset: 0,
                    };

                    semantic_tokens.push(semantic_token);

                    last_position = Position::new(position.line + 1, 0);
                    continue;
                }
            }

            let semantic_token = SemanticToken {
                delta_line: position.line - last_position.line,
                delta_start: if position.line != last_position.line {
                    position.character
                } else {
                    position.character - last_position.character
                },
                length: token.value.len() as u32,
                token_type: token_type_index as u32,
                token_modifiers_bitset: 0,
            };

            semantic_tokens.push(semantic_token);

            last_position = position;
        }
        self.semantic_tokens_map
            .insert(params.uri.to_string(), semantic_tokens)
            .await;
    }

    async fn clear_diagnostics_map(&self, uri: &url::Url) {
        self.diagnostics_map
            .insert(
                uri.to_string(),
                DocumentDiagnosticReport::Full(RelatedFullDocumentDiagnosticReport {
                    related_documents: None,
                    full_document_diagnostic_report: FullDocumentDiagnosticReport {
                        result_id: None,
                        items: vec![],
                    },
                }),
            )
            .await;

        #[cfg(not(target_arch = "wasm32"))]
        {
            self.client.publish_diagnostics(uri.clone(), vec![], None).await;
        }
    }

    async fn add_to_diagnostics<DiagT: IntoDiagnostic + std::fmt::Debug>(
        &self,
        params: &TextDocumentItem,
        diagnostic: DiagT,
    ) {
        self.client
            .log_message(MessageType::INFO, format!("adding {:?} to diag", diagnostic))
            .await;

        let diagnostic = diagnostic.to_lsp_diagnostic(&params.text);

        let DocumentDiagnosticReport::Full(mut report) = self
            .diagnostics_map
            .get(params.uri.clone().as_str())
            .await
            .unwrap_or(DocumentDiagnosticReport::Full(RelatedFullDocumentDiagnosticReport {
                related_documents: None,
                full_document_diagnostic_report: FullDocumentDiagnosticReport {
                    result_id: None,
                    items: vec![],
                },
            }))
        else {
            unreachable!();
        };

        report.full_document_diagnostic_report.items.push(diagnostic);

        self.diagnostics_map
            .insert(params.uri.to_string(), DocumentDiagnosticReport::Full(report.clone()))
            .await;

        self.client
            .publish_diagnostics(params.uri.clone(), report.full_document_diagnostic_report.items, None)
            .await;
    }

    async fn execute(&self, params: &TextDocumentItem, ast: crate::ast::types::Program) -> Result<()> {
        // Check if we can execute.
        if !self.can_execute().await {
            return Ok(());
        }

        // Execute the code if we have an executor context.
        let Some(executor_ctx) = self.executor_ctx().await else {
            return Ok(());
        };

        if !self.is_initialized().await {
            // We are not initialized yet.
            return Ok(());
        }

        // Clear the scene, before we execute so it's not fugly as shit.
        executor_ctx.engine.clear_scene(SourceRange::default()).await?;

        let memory = match executor_ctx.run(ast, None).await {
            Ok(memory) => memory,
            Err(err) => {
                self.add_to_diagnostics(params, err).await;

                // Since we already published the diagnostics we don't really care about the error
                // string.
                return Err(anyhow::anyhow!("failed to execute code"));
            }
        };
        drop(executor_ctx);

        self.memory_map.insert(params.uri.to_string(), memory.clone()).await;

        // Send the notification to the client that the memory was updated.
        self.client
            .send_notification::<custom_notifications::MemoryUpdated>(memory)
            .await;

        Ok(())
    }

    fn get_semantic_token_type_index(&self, token_type: SemanticTokenType) -> Option<usize> {
        self.token_types.iter().position(|x| *x == token_type)
    }

    async fn completions_get_variables_from_ast(&self, file_name: &str) -> Vec<CompletionItem> {
        let mut completions = vec![];

        let ast = match self.ast_map.get(file_name).await {
            Some(ast) => ast,
            None => return completions,
        };

        for item in &ast.body {
            match item {
                crate::ast::types::BodyItem::ExpressionStatement(_) => continue,
                crate::ast::types::BodyItem::ReturnStatement(_) => continue,
                crate::ast::types::BodyItem::VariableDeclaration(variable) => {
                    // We only want to complete variables.
                    for declaration in &variable.declarations {
                        completions.push(CompletionItem {
                            label: declaration.id.name.to_string(),
                            label_details: None,
                            kind: Some(match variable.kind {
                                crate::ast::types::VariableKind::Let => CompletionItemKind::VARIABLE,
                                crate::ast::types::VariableKind::Const => CompletionItemKind::CONSTANT,
                                crate::ast::types::VariableKind::Var => CompletionItemKind::VARIABLE,
                                crate::ast::types::VariableKind::Fn => CompletionItemKind::FUNCTION,
                            }),
                            detail: Some(variable.kind.to_string()),
                            documentation: None,
                            deprecated: None,
                            preselect: None,
                            sort_text: None,
                            filter_text: None,
                            insert_text: None,
                            insert_text_format: None,
                            insert_text_mode: None,
                            text_edit: None,
                            additional_text_edits: None,
                            command: None,
                            commit_characters: None,
                            data: None,
                            tags: None,
                        });
                    }
                }
            }
        }

        completions
    }

    pub async fn create_zip(&self) -> Result<Vec<u8>> {
        // Collect all the file data we know.
        let mut buf = vec![];
        let mut zip = zip::ZipWriter::new(std::io::Cursor::new(&mut buf));
        for (entry, value) in self.code_map.inner().await.iter() {
            let file_name = entry.replace("file://", "").to_string();

            let options = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored);
            zip.start_file(file_name, options)?;
            zip.write_all(value)?;
        }
        // Apply the changes you've made.
        // Dropping the `ZipWriter` will have the same effect, but may silently fail
        zip.finish()?;

        Ok(buf)
    }

    pub async fn send_telemetry(&self) -> Result<()> {
        // Get information about the user.
        let user = self
            .zoo_client
            .users()
            .get_self()
            .await
            .map_err(|e| anyhow::anyhow!(e.to_string()))?;

        // Hash the user's id.
        // Create a SHA-256 object
        let mut hasher = sha2::Sha256::new();
        // Write input message
        hasher.update(user.id);
        // Read hash digest and consume hasher
        let result = hasher.finalize();
        // Get the hash as a string.
        let user_id_hash = format!("{:x}", result);

        // Get the workspace folders.
        // The key of the workspace folder is the project name.
        let workspace_folders = self.workspace_folders().await;
        let project_names: Vec<String> = workspace_folders.iter().map(|v| v.name.clone()).collect::<Vec<_>>();
        // Get the first name.
        let project_name = project_names
            .first()
            .ok_or_else(|| anyhow::anyhow!("no project names"))?
            .to_string();

        // Send the telemetry data.
        self.zoo_client
            .meta()
            .create_event(
                vec![kittycad::types::multipart::Attachment {
                    // Clean the URI part.
                    name: "attachment".to_string(),
                    filename: Some("attachment.zip".to_string()),
                    content_type: Some("application/x-zip".to_string()),
                    data: self.create_zip().await?,
                }],
                &kittycad::types::Event {
                    // This gets generated server side so leave empty for now.
                    attachment_uri: None,
                    created_at: chrono::Utc::now(),
                    event_type: kittycad::types::ModelingAppEventType::SuccessfulCompileBeforeClose,
                    last_compiled_at: Some(chrono::Utc::now()),
                    // We do not have project descriptions yet.
                    project_description: None,
                    project_name,
                    // The UUID for the modeling app.
                    // We can unwrap here because we know it will not panic.
                    source_id: uuid::Uuid::from_str("70178592-dfca-47b3-bd2d-6fce2bcaee04").unwrap(),
                    type_: kittycad::types::Type::ModelingAppEvent,
                    user_id: user_id_hash,
                },
            )
            .await
            .map_err(|e| anyhow::anyhow!(e.to_string()))?;

        Ok(())
    }

    pub async fn update_units(
        &self,
        params: custom_notifications::UpdateUnitsParams,
    ) -> RpcResult<Option<custom_notifications::UpdateUnitsResponse>> {
        let filename = params.text_document.uri.to_string();

        {
            let Some(mut executor_ctx) = self.executor_ctx().await else {
                self.client
                    .log_message(MessageType::ERROR, "no executor context set to update units for")
                    .await;
                return Ok(None);
            };

            self.client
                .log_message(MessageType::INFO, format!("update units: {:?}", params))
                .await;

            // Try to get the memory for the current code.
            let has_memory = if let Some(memory) = self.memory_map.get(&filename).await {
                memory != crate::executor::ProgramMemory::default()
            } else {
                false
            };

            if executor_ctx.settings.units == params.units
                && !self.has_diagnostics(params.text_document.uri.as_ref()).await
                && has_memory
            {
                // Return early the units are the same.
                return Ok(None);
            }

            // Set the engine units.
            executor_ctx.update_units(params.units);

            // Update the locked executor context.
            self.set_executor_ctx(executor_ctx.clone()).await;
            drop(executor_ctx);
        }
        // Lock is dropped here since nested.
        // This is IMPORTANT.

        let new_params = TextDocumentItem {
            uri: params.text_document.uri.clone(),
            text: std::mem::take(&mut params.text.to_string()),
            version: Default::default(),
            language_id: Default::default(),
        };

        // Force re-execution.
        self.inner_on_change(new_params, true).await;

        // Check if we have diagnostics.
        // If we do we return early, since we failed in some way.
        if self.has_diagnostics(params.text_document.uri.as_ref()).await {
            return Ok(None);
        }

        Ok(Some(custom_notifications::UpdateUnitsResponse {}))
    }

    pub async fn update_can_execute(
        &self,
        params: custom_notifications::UpdateCanExecuteParams,
    ) -> RpcResult<custom_notifications::UpdateCanExecuteResponse> {
        let can_execute = self.can_execute().await;

        if can_execute == params.can_execute {
            return Ok(custom_notifications::UpdateCanExecuteResponse {});
        }

        if !params.can_execute {
            // Kill any in progress executions.
            if let Some(current_handle) = self.current_handle().await {
                current_handle.cancel();
            }
        }

        self.set_can_execute(params.can_execute).await;

        Ok(custom_notifications::UpdateCanExecuteResponse {})
    }
}

#[tower_lsp::async_trait]
impl LanguageServer for Backend {
    async fn initialize(&self, params: InitializeParams) -> RpcResult<InitializeResult> {
        self.client
            .log_message(MessageType::INFO, format!("initialize: {:?}", params))
            .await;

        Ok(InitializeResult {
            capabilities: ServerCapabilities {
                completion_provider: Some(CompletionOptions {
                    resolve_provider: Some(false),
                    trigger_characters: Some(vec![".".to_string()]),
                    work_done_progress_options: Default::default(),
                    all_commit_characters: None,
                    ..Default::default()
                }),
                diagnostic_provider: Some(DiagnosticServerCapabilities::Options(DiagnosticOptions {
                    ..Default::default()
                })),
                document_formatting_provider: Some(OneOf::Left(true)),
                folding_range_provider: Some(FoldingRangeProviderCapability::Simple(true)),
                hover_provider: Some(HoverProviderCapability::Simple(true)),
                inlay_hint_provider: Some(OneOf::Left(true)),
                rename_provider: Some(OneOf::Left(true)),
                semantic_tokens_provider: Some(SemanticTokensServerCapabilities::SemanticTokensRegistrationOptions(
                    SemanticTokensRegistrationOptions {
                        text_document_registration_options: {
                            TextDocumentRegistrationOptions {
                                document_selector: Some(vec![DocumentFilter {
                                    language: Some("kcl".to_string()),
                                    scheme: Some("file".to_string()),
                                    pattern: None,
                                }]),
                            }
                        },
                        semantic_tokens_options: SemanticTokensOptions {
                            work_done_progress_options: WorkDoneProgressOptions::default(),
                            legend: SemanticTokensLegend {
                                token_types: self.token_types.clone(),
                                token_modifiers: vec![],
                            },
                            range: Some(false),
                            full: Some(SemanticTokensFullOptions::Bool(true)),
                        },
                        static_registration_options: StaticRegistrationOptions::default(),
                    },
                )),
                signature_help_provider: Some(SignatureHelpOptions {
                    trigger_characters: None,
                    retrigger_characters: None,
                    ..Default::default()
                }),
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
                ..Default::default()
            },
            ..Default::default()
        })
    }

    async fn initialized(&self, params: InitializedParams) {
        self.do_initialized(params).await
    }

    async fn shutdown(&self) -> RpcResult<()> {
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
        self.do_did_close(params).await;

        // Inject telemetry if we can train on the user's code.
        // Return early if we cannot.
        if !self.can_send_telemetry {
            return;
        }

        // In wasm this needs to be spawn_local since fucking reqwests doesn't implement Send for wasm.
        #[cfg(target_arch = "wasm32")]
        {
            let be = self.clone();
            wasm_bindgen_futures::spawn_local(async move {
                if let Err(err) = be.send_telemetry().await {
                    be.client
                        .log_message(MessageType::WARNING, format!("failed to send telemetry: {}", err))
                        .await;
                }
            });
        }
        #[cfg(not(target_arch = "wasm32"))]
        if let Err(err) = self.send_telemetry().await {
            self.client
                .log_message(MessageType::WARNING, format!("failed to send telemetry: {}", err))
                .await;
        }
    }

    async fn hover(&self, params: HoverParams) -> RpcResult<Option<Hover>> {
        let filename = params.text_document_position_params.text_document.uri.to_string();

        let Some(current_code) = self.code_map.get(&filename).await else {
            return Ok(None);
        };
        let Ok(current_code) = std::str::from_utf8(&current_code) else {
            return Ok(None);
        };

        let pos = position_to_char_index(params.text_document_position_params.position, current_code);

        // Let's iterate over the AST and find the node that contains the cursor.
        let Some(ast) = self.ast_map.get(&filename).await else {
            return Ok(None);
        };

        let Some(hover) = ast.get_hover_value_for_position(pos, current_code) else {
            return Ok(None);
        };

        match hover {
            crate::ast::types::Hover::Function { name, range } => {
                // Get the docs for this function.
                let Some(completion) = self.stdlib_completions.get(&name) else {
                    return Ok(None);
                };
                let Some(docs) = &completion.documentation else {
                    return Ok(None);
                };

                let docs = match docs {
                    Documentation::String(docs) => docs,
                    Documentation::MarkupContent(MarkupContent { value, .. }) => value,
                };

                let Some(label_details) = &completion.label_details else {
                    return Ok(None);
                };

                Ok(Some(Hover {
                    contents: HoverContents::Markup(MarkupContent {
                        kind: MarkupKind::Markdown,
                        value: format!(
                            "```{}{}```\n{}",
                            name,
                            label_details.detail.clone().unwrap_or_default(),
                            docs
                        ),
                    }),
                    range: Some(range),
                }))
            }
            crate::ast::types::Hover::Signature { .. } => Ok(None),
            crate::ast::types::Hover::Comment { value, range } => Ok(Some(Hover {
                contents: HoverContents::Markup(MarkupContent {
                    kind: MarkupKind::Markdown,
                    value,
                }),
                range: Some(range),
            })),
        }
    }

    async fn completion(&self, params: CompletionParams) -> RpcResult<Option<CompletionResponse>> {
        let mut completions = vec![CompletionItem {
            label: PIPE_OPERATOR.to_string(),
            label_details: None,
            kind: Some(CompletionItemKind::OPERATOR),
            detail: Some("A pipe operator.".to_string()),
            documentation: Some(Documentation::MarkupContent(MarkupContent {
                kind: MarkupKind::Markdown,
                value: "A pipe operator.".to_string(),
            })),
            deprecated: Some(false),
            preselect: None,
            sort_text: None,
            filter_text: None,
            insert_text: Some("|> ".to_string()),
            insert_text_format: Some(InsertTextFormat::PLAIN_TEXT),
            insert_text_mode: None,
            text_edit: None,
            additional_text_edits: None,
            command: None,
            commit_characters: None,
            data: None,
            tags: None,
        }];

        completions.extend(self.stdlib_completions.values().cloned());

        // Get our variables from our AST to include in our completions.
        completions.extend(
            self.completions_get_variables_from_ast(params.text_document_position.text_document.uri.as_ref())
                .await,
        );

        Ok(Some(CompletionResponse::Array(completions)))
    }

    async fn diagnostic(&self, params: DocumentDiagnosticParams) -> RpcResult<DocumentDiagnosticReportResult> {
        let filename = params.text_document.uri.to_string();

        // Get the current diagnostics for this file.
        let Some(diagnostic) = self.diagnostics_map.get(&filename).await else {
            // Send an empty report.
            return Ok(DocumentDiagnosticReportResult::Report(DocumentDiagnosticReport::Full(
                RelatedFullDocumentDiagnosticReport {
                    related_documents: None,
                    full_document_diagnostic_report: FullDocumentDiagnosticReport {
                        result_id: None,
                        items: vec![],
                    },
                },
            )));
        };

        Ok(DocumentDiagnosticReportResult::Report(diagnostic.clone()))
    }

    async fn signature_help(&self, params: SignatureHelpParams) -> RpcResult<Option<SignatureHelp>> {
        let filename = params.text_document_position_params.text_document.uri.to_string();

        let Some(current_code) = self.code_map.get(&filename).await else {
            return Ok(None);
        };
        let Ok(current_code) = std::str::from_utf8(&current_code) else {
            return Ok(None);
        };

        let pos = position_to_char_index(params.text_document_position_params.position, current_code);

        // Let's iterate over the AST and find the node that contains the cursor.
        let Some(ast) = self.ast_map.get(&filename).await else {
            return Ok(None);
        };

        let Some(value) = ast.get_value_for_position(pos) else {
            return Ok(None);
        };

        let Some(hover) = value.get_hover_value_for_position(pos, current_code) else {
            return Ok(None);
        };

        match hover {
            crate::ast::types::Hover::Function { name, range: _ } => {
                // Get the docs for this function.
                let Some(signature) = self.stdlib_signatures.get(&name) else {
                    return Ok(None);
                };

                Ok(Some(signature.clone()))
            }
            crate::ast::types::Hover::Signature {
                name,
                parameter_index,
                range: _,
            } => {
                let Some(signature) = self.stdlib_signatures.get(&name) else {
                    return Ok(None);
                };

                let mut signature = signature.clone();

                signature.active_parameter = Some(parameter_index);

                Ok(Some(signature.clone()))
            }
            crate::ast::types::Hover::Comment { value: _, range: _ } => {
                return Ok(None);
            }
        }
    }

    async fn inlay_hint(&self, _params: InlayHintParams) -> RpcResult<Option<Vec<InlayHint>>> {
        // TODO: do this

        Ok(None)
    }

    async fn semantic_tokens_full(&self, params: SemanticTokensParams) -> RpcResult<Option<SemanticTokensResult>> {
        let filename = params.text_document.uri.to_string();

        let Some(semantic_tokens) = self.semantic_tokens_map.get(&filename).await else {
            return Ok(None);
        };

        Ok(Some(SemanticTokensResult::Tokens(SemanticTokens {
            result_id: None,
            data: semantic_tokens.clone(),
        })))
    }

    async fn document_symbol(&self, params: DocumentSymbolParams) -> RpcResult<Option<DocumentSymbolResponse>> {
        let filename = params.text_document.uri.to_string();

        let Some(symbols) = self.symbols_map.get(&filename).await else {
            return Ok(None);
        };

        Ok(Some(DocumentSymbolResponse::Nested(symbols.clone())))
    }

    async fn formatting(&self, params: DocumentFormattingParams) -> RpcResult<Option<Vec<TextEdit>>> {
        let filename = params.text_document.uri.to_string();

        let Some(current_code) = self.code_map.get(&filename).await else {
            return Ok(None);
        };
        let Ok(current_code) = std::str::from_utf8(&current_code) else {
            return Ok(None);
        };

        // Parse the ast.
        // I don't know if we need to do this again since it should be updated in the context.
        // But I figure better safe than sorry since this will write back out to the file.
        let Ok(tokens) = crate::token::lexer(current_code) else {
            return Ok(None);
        };
        let parser = crate::parser::Parser::new(tokens);
        let Ok(ast) = parser.ast() else {
            return Ok(None);
        };
        // Now recast it.
        let recast = ast.recast(
            &crate::ast::types::FormatOptions {
                tab_size: params.options.tab_size as usize,
                insert_final_newline: params.options.insert_final_newline.unwrap_or(false),
                use_tabs: !params.options.insert_spaces,
            },
            0,
        );
        let source_range = SourceRange([0, current_code.len()]);
        let range = source_range.to_lsp_range(current_code);
        Ok(Some(vec![TextEdit {
            new_text: recast,
            range,
        }]))
    }

    async fn rename(&self, params: RenameParams) -> RpcResult<Option<WorkspaceEdit>> {
        let filename = params.text_document_position.text_document.uri.to_string();

        let Some(current_code) = self.code_map.get(&filename).await else {
            return Ok(None);
        };
        let Ok(current_code) = std::str::from_utf8(&current_code) else {
            return Ok(None);
        };

        // Parse the ast.
        // I don't know if we need to do this again since it should be updated in the context.
        // But I figure better safe than sorry since this will write back out to the file.
        let Ok(tokens) = crate::token::lexer(current_code) else {
            return Ok(None);
        };
        let parser = crate::parser::Parser::new(tokens);
        let Ok(mut ast) = parser.ast() else {
            return Ok(None);
        };

        // Let's convert the position to a character index.
        let pos = position_to_char_index(params.text_document_position.position, current_code);
        // Now let's perform the rename on the ast.
        ast.rename_symbol(&params.new_name, pos);
        // Now recast it.
        let recast = ast.recast(&Default::default(), 0);
        let source_range = SourceRange([0, current_code.len() - 1]);
        let range = source_range.to_lsp_range(current_code);
        Ok(Some(WorkspaceEdit {
            changes: Some(HashMap::from([(
                params.text_document_position.text_document.uri,
                vec![TextEdit {
                    new_text: recast,
                    range,
                }],
            )])),
            document_changes: None,
            change_annotations: None,
        }))
    }

    async fn folding_range(&self, params: FoldingRangeParams) -> RpcResult<Option<Vec<FoldingRange>>> {
        let filename = params.text_document.uri.to_string();

        // Get the ast.
        let Some(ast) = self.ast_map.get(&filename).await else {
            return Ok(None);
        };

        // Get the folding ranges.
        let folding_ranges = ast.get_lsp_folding_ranges();

        if folding_ranges.is_empty() {
            return Ok(None);
        }

        Ok(Some(folding_ranges))
    }
}

/// Get completions from our stdlib.
pub fn get_completions_from_stdlib(stdlib: &crate::std::StdLib) -> Result<HashMap<String, CompletionItem>> {
    let mut completions = HashMap::new();
    let combined = stdlib.combined();

    for internal_fn in combined.values() {
        completions.insert(internal_fn.name(), internal_fn.to_completion_item()?);
    }

    let variable_kinds = VariableKind::to_completion_items()?;
    for variable_kind in variable_kinds {
        completions.insert(variable_kind.label.clone(), variable_kind);
    }

    Ok(completions)
}

/// Get signatures from our stdlib.
pub fn get_signatures_from_stdlib(stdlib: &crate::std::StdLib) -> Result<HashMap<String, SignatureHelp>> {
    let mut signatures = HashMap::new();
    let combined = stdlib.combined();

    for internal_fn in combined.values() {
        signatures.insert(internal_fn.name(), internal_fn.to_signature_help());
    }

    Ok(signatures)
}

/// Convert a position to a character index from the start of the file.
fn position_to_char_index(position: Position, code: &str) -> usize {
    // Get the character position from the start of the file.
    let mut char_position = 0;
    for (index, line) in code.lines().enumerate() {
        if index == position.line as usize {
            char_position += position.character as usize;
            break;
        } else {
            char_position += line.len() + 1;
        }
    }

    char_position
}
