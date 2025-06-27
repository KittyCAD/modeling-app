//! Functions for the `kcl` lsp server.
#![allow(dead_code)]

use std::{
    collections::HashMap,
    io::Write,
    str::FromStr,
    sync::{Arc, Mutex},
};

use anyhow::Result;
#[cfg(feature = "cli")]
use clap::Parser;
use dashmap::DashMap;
use sha2::Digest;
use tokio::sync::RwLock;
use tower_lsp::{
    Client, LanguageServer,
    jsonrpc::Result as RpcResult,
    lsp_types::{
        CodeAction, CodeActionKind, CodeActionOptions, CodeActionOrCommand, CodeActionParams,
        CodeActionProviderCapability, CodeActionResponse, ColorInformation, ColorPresentation, ColorPresentationParams,
        ColorProviderCapability, CompletionItem, CompletionItemKind, CompletionOptions, CompletionParams,
        CompletionResponse, CreateFilesParams, DeleteFilesParams, Diagnostic, DiagnosticOptions,
        DiagnosticServerCapabilities, DiagnosticSeverity, DidChangeConfigurationParams, DidChangeTextDocumentParams,
        DidChangeWatchedFilesParams, DidChangeWorkspaceFoldersParams, DidCloseTextDocumentParams,
        DidOpenTextDocumentParams, DidSaveTextDocumentParams, DocumentColorParams, DocumentDiagnosticParams,
        DocumentDiagnosticReport, DocumentDiagnosticReportResult, DocumentFilter, DocumentFormattingParams,
        DocumentSymbol, DocumentSymbolParams, DocumentSymbolResponse, Documentation, FoldingRange, FoldingRangeParams,
        FoldingRangeProviderCapability, FullDocumentDiagnosticReport, Hover as LspHover, HoverContents, HoverParams,
        HoverProviderCapability, InitializeParams, InitializeResult, InitializedParams, InlayHint, InlayHintParams,
        InsertTextFormat, MarkupContent, MarkupKind, MessageType, OneOf, Position, PrepareRenameResponse,
        RelatedFullDocumentDiagnosticReport, RenameFilesParams, RenameParams, SemanticToken, SemanticTokenModifier,
        SemanticTokenType, SemanticTokens, SemanticTokensFullOptions, SemanticTokensLegend, SemanticTokensOptions,
        SemanticTokensParams, SemanticTokensRegistrationOptions, SemanticTokensResult,
        SemanticTokensServerCapabilities, ServerCapabilities, SignatureHelp, SignatureHelpOptions, SignatureHelpParams,
        StaticRegistrationOptions, TextDocumentItem, TextDocumentPositionParams, TextDocumentRegistrationOptions,
        TextDocumentSyncCapability, TextDocumentSyncKind, TextDocumentSyncOptions, TextEdit, WorkDoneProgressOptions,
        WorkspaceEdit, WorkspaceFolder, WorkspaceFoldersServerCapabilities, WorkspaceServerCapabilities,
    },
};

use crate::{
    ModuleId, Program, SourceRange,
    docs::kcl_doc::ModData,
    errors::LspSuggestion,
    exec::KclValue,
    execution::{cache, kcl_value::FunctionSource},
    lsp::{
        backend::Backend as _,
        kcl::hover::{Hover, HoverOpts},
        util::IntoDiagnostic,
    },
    parsing::{
        PIPE_OPERATOR,
        ast::types::{Expr, VariableKind},
        token::TokenStream,
    },
};

pub mod custom_notifications;
mod hover;

const SEMANTIC_TOKEN_TYPES: [SemanticTokenType; 10] = [
    SemanticTokenType::NUMBER,
    SemanticTokenType::VARIABLE,
    SemanticTokenType::KEYWORD,
    SemanticTokenType::TYPE,
    SemanticTokenType::STRING,
    SemanticTokenType::OPERATOR,
    SemanticTokenType::COMMENT,
    SemanticTokenType::FUNCTION,
    SemanticTokenType::PARAMETER,
    SemanticTokenType::PROPERTY,
];

const SEMANTIC_TOKEN_MODIFIERS: [SemanticTokenModifier; 5] = [
    SemanticTokenModifier::DECLARATION,
    SemanticTokenModifier::DEFINITION,
    SemanticTokenModifier::DEFAULT_LIBRARY,
    SemanticTokenModifier::READONLY,
    SemanticTokenModifier::STATIC,
];

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
    pub workspace_folders: DashMap<String, WorkspaceFolder>,
    /// The stdlib completions for the language.
    pub stdlib_completions: HashMap<String, CompletionItem>,
    /// The stdlib signatures for the language.
    pub stdlib_signatures: HashMap<String, SignatureHelp>,
    /// For all KwArg functions in std, a map from their arg names to arg help snippets (markdown format).
    pub stdlib_args: HashMap<String, HashMap<String, String>>,
    /// Token maps.
    pub(super) token_map: DashMap<String, TokenStream>,
    /// AST maps.
    pub ast_map: DashMap<String, crate::Program>,
    /// Current code.
    pub code_map: DashMap<String, Vec<u8>>,
    /// Diagnostics.
    pub diagnostics_map: DashMap<String, Vec<Diagnostic>>,
    /// Symbols map.
    pub symbols_map: DashMap<String, Vec<DocumentSymbol>>,
    /// Semantic tokens map.
    pub semantic_tokens_map: DashMap<String, Vec<SemanticToken>>,
    /// The Zoo API client.
    pub zoo_client: kittycad::Client,
    /// If we can send telemetry for this user.
    pub can_send_telemetry: bool,
    /// Optional executor context to use if we want to execute the code.
    pub executor_ctx: Arc<RwLock<Option<crate::execution::ExecutorContext>>>,
    /// If we are currently allowed to execute the ast.
    pub can_execute: Arc<RwLock<bool>>,

    pub is_initialized: Arc<RwLock<bool>>,
}

impl Backend {
    #[cfg(target_arch = "wasm32")]
    pub fn new_wasm(
        client: Client,
        executor_ctx: Option<crate::execution::ExecutorContext>,
        fs: crate::fs::wasm::FileSystemManager,
        zoo_client: kittycad::Client,
        can_send_telemetry: bool,
    ) -> Result<Self, String> {
        Self::with_file_manager(
            client,
            executor_ctx,
            crate::fs::FileManager::new(fs),
            zoo_client,
            can_send_telemetry,
        )
    }

    #[cfg(not(target_arch = "wasm32"))]
    pub fn new(
        client: Client,
        executor_ctx: Option<crate::execution::ExecutorContext>,
        zoo_client: kittycad::Client,
        can_send_telemetry: bool,
    ) -> Result<Self, String> {
        Self::with_file_manager(
            client,
            executor_ctx,
            crate::fs::FileManager::new(),
            zoo_client,
            can_send_telemetry,
        )
    }

    fn with_file_manager(
        client: Client,
        executor_ctx: Option<crate::execution::ExecutorContext>,
        fs: crate::fs::FileManager,
        zoo_client: kittycad::Client,
        can_send_telemetry: bool,
    ) -> Result<Self, String> {
        let kcl_std = crate::docs::kcl_doc::walk_prelude();
        let stdlib_completions = get_completions_from_stdlib(&kcl_std).map_err(|e| e.to_string())?;
        let stdlib_signatures = get_signatures_from_stdlib(&kcl_std);
        let stdlib_args = get_arg_maps_from_stdlib(&kcl_std);

        Ok(Self {
            client,
            fs: Arc::new(fs),
            stdlib_completions,
            stdlib_signatures,
            stdlib_args,
            zoo_client,
            can_send_telemetry,
            can_execute: Arc::new(RwLock::new(executor_ctx.is_some())),
            executor_ctx: Arc::new(RwLock::new(executor_ctx)),
            workspace_folders: Default::default(),
            token_map: Default::default(),
            ast_map: Default::default(),
            code_map: Default::default(),
            diagnostics_map: Default::default(),
            symbols_map: Default::default(),
            semantic_tokens_map: Default::default(),
            is_initialized: Default::default(),
        })
    }

    fn remove_from_ast_maps(&self, filename: &str) {
        self.ast_map.remove(filename);
        self.symbols_map.remove(filename);
    }
}

// Implement the shared backend trait for the language server.
#[async_trait::async_trait]
impl crate::lsp::backend::Backend for Backend {
    fn client(&self) -> &Client {
        &self.client
    }

    fn fs(&self) -> &Arc<crate::fs::FileManager> {
        &self.fs
    }

    async fn is_initialized(&self) -> bool {
        *self.is_initialized.read().await
    }

    async fn set_is_initialized(&self, is_initialized: bool) {
        *self.is_initialized.write().await = is_initialized;
    }

    async fn workspace_folders(&self) -> Vec<WorkspaceFolder> {
        // TODO: fix clone
        self.workspace_folders.iter().map(|i| i.clone()).collect()
    }

    async fn add_workspace_folders(&self, folders: Vec<WorkspaceFolder>) {
        for folder in folders {
            self.workspace_folders.insert(folder.name.to_string(), folder);
        }
    }

    async fn remove_workspace_folders(&self, folders: Vec<WorkspaceFolder>) {
        for folder in folders {
            self.workspace_folders.remove(&folder.name);
        }
    }

    fn code_map(&self) -> &DashMap<String, Vec<u8>> {
        &self.code_map
    }

    async fn insert_code_map(&self, uri: String, text: Vec<u8>) {
        self.code_map.insert(uri, text);
    }

    async fn remove_from_code_map(&self, uri: String) -> Option<Vec<u8>> {
        self.code_map.remove(&uri).map(|x| x.1)
    }

    async fn clear_code_state(&self) {
        self.code_map.clear();
        self.token_map.clear();
        self.ast_map.clear();
        self.diagnostics_map.clear();
        self.symbols_map.clear();
        self.semantic_tokens_map.clear();
    }

    fn current_diagnostics_map(&self) -> &DashMap<String, Vec<Diagnostic>> {
        &self.diagnostics_map
    }

    async fn inner_on_change(&self, params: TextDocumentItem, force: bool) {
        if force {
            crate::bust_cache().await;
        }

        let filename = params.uri.to_string();
        // We already updated the code map in the shared backend.

        // Lets update the tokens.
        let module_id = ModuleId::default();
        let tokens = match crate::parsing::token::lex(&params.text, module_id) {
            Ok(tokens) => tokens,
            Err(err) => {
                self.add_to_diagnostics(&params, &[err], true).await;
                self.token_map.remove(&filename);
                self.remove_from_ast_maps(&filename);
                self.semantic_tokens_map.remove(&filename);
                return;
            }
        };

        // Get the previous tokens.
        let tokens_changed = match self.token_map.get(&filename) {
            Some(previous_tokens) => *previous_tokens != tokens,
            _ => true,
        };

        let had_diagnostics = self.has_diagnostics(params.uri.as_ref()).await;

        // Check if the tokens are the same.
        if !tokens_changed && !force && !had_diagnostics {
            // We return early here because the tokens are the same.
            return;
        }

        if tokens_changed {
            // Update our token map.
            self.token_map.insert(params.uri.to_string(), tokens.clone());
            // Update our semantic tokens.
            self.update_semantic_tokens(&tokens, &params).await;
        }

        // Lets update the ast.

        let (ast, errs) = match crate::parsing::parse_tokens(tokens.clone()).0 {
            Ok(result) => result,
            Err(err) => {
                self.add_to_diagnostics(&params, &[err], true).await;
                self.remove_from_ast_maps(&filename);
                return;
            }
        };

        self.add_to_diagnostics(&params, &errs, true).await;

        if errs.iter().any(|e| e.severity == crate::errors::Severity::Fatal) {
            self.remove_from_ast_maps(&filename);
            return;
        }

        let Some(mut ast) = ast else {
            self.remove_from_ast_maps(&filename);
            return;
        };

        // Here we will want to store the digest and compare, but for now
        // we're doing this in a non-load-bearing capacity so we can remove
        // this if it backfires and only hork the LSP.
        ast.compute_digest();

        // Save it as a program.
        let ast = crate::Program {
            ast,
            original_file_contents: params.text.clone(),
        };

        // Check if the ast changed.
        let ast_changed = match self.ast_map.get(&filename) {
            Some(old_ast) => {
                // Check if the ast changed.
                *old_ast.ast != *ast.ast
            }
            None => true,
        };

        if !ast_changed && !force && !had_diagnostics {
            // Return early if the ast did not change and we don't need to force.
            return;
        }

        if ast_changed {
            self.ast_map.insert(params.uri.to_string(), ast.clone());
            // Update the symbols map.
            self.symbols_map.insert(
                params.uri.to_string(),
                ast.ast.get_lsp_symbols(&params.text).unwrap_or_default(),
            );

            // Update our semantic tokens.
            self.update_semantic_tokens(&tokens, &params).await;

            let discovered_findings = ast.lint_all().into_iter().flatten().collect::<Vec<_>>();
            self.add_to_diagnostics(&params, &discovered_findings, false).await;
        }

        // Send the notification to the client that the ast was updated.
        if self.can_execute().await || self.executor_ctx().await.is_none() {
            // Only send the notification if we can execute.
            // Otherwise it confuses the client.
            self.client
                .send_notification::<custom_notifications::AstUpdated>(ast.ast.clone())
                .await;
        }

        // Execute the code if we have an executor context.
        // This function automatically executes if we should & updates the diagnostics if we got
        // errors.
        if self.execute(&params, &ast).await.is_err() {
            return;
        }

        // If we made it here we can clear the diagnostics.
        self.clear_diagnostics_map(&params.uri, Some(DiagnosticSeverity::ERROR))
            .await;
    }
}

impl Backend {
    pub async fn can_execute(&self) -> bool {
        *self.can_execute.read().await
    }

    pub async fn executor_ctx(&self) -> tokio::sync::RwLockReadGuard<'_, Option<crate::execution::ExecutorContext>> {
        self.executor_ctx.read().await
    }

    async fn update_semantic_tokens(&self, tokens: &TokenStream, params: &TextDocumentItem) {
        // Update the semantic tokens map.
        let mut semantic_tokens = vec![];
        let mut last_position = Position::new(0, 0);
        for token in tokens.as_slice() {
            let Ok(token_type) = SemanticTokenType::try_from(token.token_type) else {
                // We continue here because not all tokens can be converted this way, we will get
                // the rest from the ast.
                continue;
            };

            let mut token_type_index = match self.get_semantic_token_type_index(&token_type) {
                Some(index) => index,
                // This is actually bad this should not fail.
                // The test for listing all semantic token types should make this never happen.
                None => {
                    self.client
                        .log_message(
                            MessageType::ERROR,
                            format!("token type `{token_type:?}` not accounted for"),
                        )
                        .await;
                    continue;
                }
            };

            let source_range: SourceRange = token.into();
            let position = source_range.start_to_lsp_position(&params.text);

            // Calculate the token modifiers.
            // Get the value at the current position.
            let token_modifiers_bitset = match self.ast_map.get(params.uri.as_str()) {
                Some(ast) => {
                    let token_index = Arc::new(Mutex::new(token_type_index));
                    let modifier_index: Arc<Mutex<u32>> = Arc::new(Mutex::new(0));
                    crate::walk::walk(&ast.ast, |node: crate::walk::Node| {
                        let Ok(node_range): Result<SourceRange, _> = (&node).try_into() else {
                            return Ok(true);
                        };

                        if !node_range.contains(source_range.start()) {
                            return Ok(true);
                        }

                        let get_modifier = |modifier: Vec<SemanticTokenModifier>| -> Result<bool> {
                            let mut mods = modifier_index.lock().map_err(|_| anyhow::anyhow!("mutex"))?;
                            let Some(token_modifier_index) = self.get_semantic_token_modifier_index(modifier) else {
                                return Ok(true);
                            };
                            if *mods == 0 {
                                *mods = token_modifier_index;
                            } else {
                                *mods |= token_modifier_index;
                            }
                            Ok(false)
                        };

                        match node {
                            crate::walk::Node::TagDeclarator(_) => {
                                return get_modifier(vec![
                                    SemanticTokenModifier::DEFINITION,
                                    SemanticTokenModifier::STATIC,
                                ]);
                            }
                            crate::walk::Node::VariableDeclarator(variable) => {
                                let sr: SourceRange = (&variable.id).into();
                                if sr.contains(source_range.start()) {
                                    if let Expr::FunctionExpression(_) = &variable.init {
                                        let mut ti = token_index.lock().map_err(|_| anyhow::anyhow!("mutex"))?;
                                        *ti = match self.get_semantic_token_type_index(&SemanticTokenType::FUNCTION) {
                                            Some(index) => index,
                                            None => token_type_index,
                                        };
                                    }

                                    return get_modifier(vec![
                                        SemanticTokenModifier::DECLARATION,
                                        SemanticTokenModifier::READONLY,
                                    ]);
                                }
                            }
                            crate::walk::Node::Parameter(_) => {
                                let mut ti = token_index.lock().map_err(|_| anyhow::anyhow!("mutex"))?;
                                *ti = match self.get_semantic_token_type_index(&SemanticTokenType::PARAMETER) {
                                    Some(index) => index,
                                    None => token_type_index,
                                };
                                return Ok(false);
                            }
                            crate::walk::Node::MemberExpression(member_expression) => {
                                let sr: SourceRange = (&member_expression.property).into();
                                if sr.contains(source_range.start()) {
                                    let mut ti = token_index.lock().map_err(|_| anyhow::anyhow!("mutex"))?;
                                    *ti = match self.get_semantic_token_type_index(&SemanticTokenType::PROPERTY) {
                                        Some(index) => index,
                                        None => token_type_index,
                                    };
                                    return Ok(false);
                                }
                            }
                            crate::walk::Node::ObjectProperty(object_property) => {
                                let sr: SourceRange = (&object_property.key).into();
                                if sr.contains(source_range.start()) {
                                    let mut ti = token_index.lock().map_err(|_| anyhow::anyhow!("mutex"))?;
                                    *ti = match self.get_semantic_token_type_index(&SemanticTokenType::PROPERTY) {
                                        Some(index) => index,
                                        None => token_type_index,
                                    };
                                }
                                return get_modifier(vec![SemanticTokenModifier::DECLARATION]);
                            }
                            crate::walk::Node::CallExpressionKw(call_expr) => {
                                let sr: SourceRange = (&call_expr.callee).into();
                                if sr.contains(source_range.start()) {
                                    let mut ti = token_index.lock().map_err(|_| anyhow::anyhow!("mutex"))?;
                                    *ti = match self.get_semantic_token_type_index(&SemanticTokenType::FUNCTION) {
                                        Some(index) => index,
                                        None => token_type_index,
                                    };

                                    if self.stdlib_completions.contains_key(&call_expr.callee.name.name) {
                                        // This is a stdlib function.
                                        return get_modifier(vec![SemanticTokenModifier::DEFAULT_LIBRARY]);
                                    }

                                    return Ok(false);
                                }
                            }
                            _ => {}
                        }
                        Ok(true)
                    })
                    .unwrap_or_default();

                    let t = match token_index.lock() {
                        Ok(guard) => *guard,
                        _ => 0,
                    };
                    token_type_index = t;

                    match modifier_index.lock() {
                        Ok(guard) => *guard,
                        _ => 0,
                    }
                }
                _ => 0,
            };

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
                        length: (token.end - token.start) as u32,
                        token_type: token_type_index,
                        token_modifiers_bitset,
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
                length: (token.end - token.start) as u32,
                token_type: token_type_index,
                token_modifiers_bitset,
            };

            semantic_tokens.push(semantic_token);

            last_position = position;
        }
        self.semantic_tokens_map.insert(params.uri.to_string(), semantic_tokens);
    }

    async fn clear_diagnostics_map(&self, uri: &url::Url, severity: Option<DiagnosticSeverity>) {
        let Some(mut items) = self.diagnostics_map.get_mut(uri.as_str()) else {
            return;
        };

        // If we only want to clear a specific severity, do that.
        if let Some(severity) = severity {
            items.retain(|x| x.severity != Some(severity));
        } else {
            items.clear();
        }

        if items.is_empty() {
            #[cfg(not(target_arch = "wasm32"))]
            {
                self.client.publish_diagnostics(uri.clone(), items.clone(), None).await;
            }

            // We need to drop the items here.
            drop(items);

            self.diagnostics_map.remove(uri.as_str());
        } else {
            // We don't need to update the map since we used get_mut.

            #[cfg(not(target_arch = "wasm32"))]
            {
                self.client.publish_diagnostics(uri.clone(), items.clone(), None).await;
            }
        }
    }

    async fn add_to_diagnostics<DiagT: IntoDiagnostic + std::fmt::Debug>(
        &self,
        params: &TextDocumentItem,
        diagnostics: &[DiagT],
        clear_all_before_add: bool,
    ) {
        if diagnostics.is_empty() {
            return;
        }

        if clear_all_before_add {
            self.clear_diagnostics_map(&params.uri, None).await;
        } else if diagnostics.iter().all(|x| x.severity() == DiagnosticSeverity::ERROR) {
            // If the diagnostic is an error, it will be the only error we get since that halts
            // execution.
            // Clear the diagnostics before we add a new one.
            self.clear_diagnostics_map(&params.uri, Some(DiagnosticSeverity::ERROR))
                .await;
        } else if diagnostics
            .iter()
            .all(|x| x.severity() == DiagnosticSeverity::INFORMATION)
        {
            // If the diagnostic is a lint, we will pass them all to add at once so we need to
            // clear the old ones.
            self.clear_diagnostics_map(&params.uri, Some(DiagnosticSeverity::INFORMATION))
                .await;
        }

        let mut items = match self.diagnostics_map.get(params.uri.as_str()) {
            Some(items) => {
                // TODO: Would be awesome to fix the clone here.
                items.clone()
            }
            _ => {
                vec![]
            }
        };

        for diagnostic in diagnostics {
            let lsp_d = diagnostic.to_lsp_diagnostics(&params.text);
            // Make sure we don't duplicate diagnostics.
            for d in lsp_d {
                if !items.iter().any(|x| x == &d) {
                    items.push(d);
                }
            }
        }

        self.diagnostics_map.insert(params.uri.to_string(), items.clone());

        self.client.publish_diagnostics(params.uri.clone(), items, None).await;
    }

    async fn execute(&self, params: &TextDocumentItem, ast: &Program) -> Result<()> {
        // Check if we can execute.
        if !self.can_execute().await {
            return Ok(());
        }

        // Execute the code if we have an executor context.
        let ctx = self.executor_ctx().await;
        let Some(ref executor_ctx) = *ctx else {
            return Ok(());
        };

        if !self.is_initialized().await {
            // We are not initialized yet.
            return Ok(());
        }

        match executor_ctx.run_with_caching(ast.clone()).await {
            Err(err) => {
                self.add_to_diagnostics(params, &[err], false).await;

                // Since we already published the diagnostics we don't really care about the error
                // string.
                Err(anyhow::anyhow!("failed to execute code"))
            }
            Ok(_) => Ok(()),
        }
    }

    pub fn get_semantic_token_type_index(&self, token_type: &SemanticTokenType) -> Option<u32> {
        SEMANTIC_TOKEN_TYPES
            .iter()
            .position(|x| *x == *token_type)
            .map(|y| y as u32)
    }

    pub fn get_semantic_token_modifier_index(&self, token_types: Vec<SemanticTokenModifier>) -> Option<u32> {
        if token_types.is_empty() {
            return None;
        }

        let mut modifier = None;
        for token_type in token_types {
            if let Some(index) = SEMANTIC_TOKEN_MODIFIERS
                .iter()
                .position(|x| *x == token_type)
                .map(|y| y as u32)
            {
                modifier = match modifier {
                    Some(modifier) => Some(modifier | index),
                    None => Some(index),
                };
            }
        }
        modifier
    }

    pub async fn create_zip(&self) -> Result<Vec<u8>> {
        // Collect all the file data we know.
        let mut buf = vec![];
        let mut zip = zip::ZipWriter::new(std::io::Cursor::new(&mut buf));
        for code in self.code_map.iter() {
            let entry = code.key();
            let value = code.value();
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
        let user_id_hash = format!("{result:x}");

        // Get the workspace folders.
        // The key of the workspace folder is the project name.
        let workspace_folders = self.workspace_folders().await;
        let project_names: Vec<&str> = workspace_folders.iter().map(|v| v.name.as_str()).collect::<Vec<_>>();
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
                    filepath: Some("attachment.zip".into()),
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
                    // The UUID for the Design Studio.
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

    pub async fn update_can_execute(
        &self,
        params: custom_notifications::UpdateCanExecuteParams,
    ) -> RpcResult<custom_notifications::UpdateCanExecuteResponse> {
        let mut can_execute = self.can_execute.write().await;

        if *can_execute == params.can_execute {
            return Ok(custom_notifications::UpdateCanExecuteResponse {});
        }

        *can_execute = params.can_execute;

        Ok(custom_notifications::UpdateCanExecuteResponse {})
    }

    /// Returns the new string for the code after rename.
    pub fn inner_prepare_rename(
        &self,
        params: &TextDocumentPositionParams,
        new_name: &str,
    ) -> RpcResult<Option<(String, String)>> {
        let filename = params.text_document.uri.to_string();

        let Some(current_code) = self.code_map.get(&filename) else {
            return Ok(None);
        };
        let Ok(current_code) = std::str::from_utf8(&current_code) else {
            return Ok(None);
        };

        // Parse the ast.
        // I don't know if we need to do this again since it should be updated in the context.
        // But I figure better safe than sorry since this will write back out to the file.
        let module_id = ModuleId::default();
        let Ok(mut ast) = crate::parsing::parse_str(current_code, module_id).parse_errs_as_err() else {
            return Ok(None);
        };

        // Let's convert the position to a character index.
        let pos = position_to_char_index(params.position, current_code);
        // Now let's perform the rename on the ast.
        ast.rename_symbol(new_name, pos);
        // Now recast it.
        let recast = ast.recast(&Default::default(), 0);

        Ok(Some((current_code.to_string(), recast)))
    }
}

#[tower_lsp::async_trait]
impl LanguageServer for Backend {
    async fn initialize(&self, params: InitializeParams) -> RpcResult<InitializeResult> {
        self.client
            .log_message(MessageType::INFO, format!("initialize: {params:?}"))
            .await;

        Ok(InitializeResult {
            capabilities: ServerCapabilities {
                color_provider: Some(ColorProviderCapability::Simple(true)),
                code_action_provider: Some(CodeActionProviderCapability::Options(CodeActionOptions {
                    code_action_kinds: Some(vec![CodeActionKind::QUICKFIX]),
                    resolve_provider: Some(false),
                    work_done_progress_options: WorkDoneProgressOptions::default(),
                })),
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
                                token_types: SEMANTIC_TOKEN_TYPES.to_vec(),
                                token_modifiers: SEMANTIC_TOKEN_MODIFIERS.to_vec(),
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
        self.do_did_change(params).await;
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
                .log_message(MessageType::WARNING, format!("failed to send telemetry: {err}"))
                .await;
        }
    }

    async fn hover(&self, params: HoverParams) -> RpcResult<Option<LspHover>> {
        let filename = params.text_document_position_params.text_document.uri.to_string();

        let Some(current_code) = self.code_map.get(&filename) else {
            return Ok(None);
        };
        let Ok(current_code) = std::str::from_utf8(&current_code) else {
            return Ok(None);
        };

        let pos = position_to_char_index(params.text_document_position_params.position, current_code);

        // Let's iterate over the AST and find the node that contains the cursor.
        let Some(ast) = self.ast_map.get(&filename) else {
            return Ok(None);
        };

        let Some(hover) = ast
            .ast
            .get_hover_value_for_position(pos, current_code, &HoverOpts::default_for_hover())
        else {
            return Ok(None);
        };

        match hover {
            Hover::Function { name, range } => {
                let (sig, docs) = if let Some(Some(result)) = with_cached_var(&name, |value| {
                    match value {
                        // User-defined or KCL std function
                        KclValue::Function {
                            value: FunctionSource::User { ast, .. },
                            ..
                        } => {
                            // TODO get docs from comments
                            Some((ast.signature(), ""))
                        }
                        _ => None,
                    }
                })
                .await
                {
                    result
                } else {
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

                    let docs = if docs.len() > 320 {
                        let end = docs.find("\n\n").or_else(|| docs.find("\n\r\n")).unwrap_or(320);
                        &docs[..end]
                    } else {
                        &**docs
                    };

                    let Some(label_details) = &completion.label_details else {
                        return Ok(None);
                    };

                    let sig = if let Some(detail) = &label_details.detail {
                        detail.clone()
                    } else {
                        String::new()
                    };

                    (sig, docs)
                };

                Ok(Some(LspHover {
                    contents: HoverContents::Markup(MarkupContent {
                        kind: MarkupKind::Markdown,
                        value: format!("```\n{name}{sig}\n```\n\n{docs}"),
                    }),
                    range: Some(range),
                }))
            }
            Hover::Type { name, range } => {
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

                let docs = if docs.len() > 320 {
                    let end = docs.find("\n\n").or_else(|| docs.find("\n\r\n")).unwrap_or(320);
                    &docs[..end]
                } else {
                    &**docs
                };

                Ok(Some(LspHover {
                    contents: HoverContents::Markup(MarkupContent {
                        kind: MarkupKind::Markdown,
                        value: format!("```\n{name}\n```\n\n{docs}"),
                    }),
                    range: Some(range),
                }))
            }
            Hover::KwArg {
                name,
                callee_name,
                range,
            } => {
                // TODO handle user-defined functions too

                let Some(arg_map) = self.stdlib_args.get(&callee_name) else {
                    return Ok(None);
                };

                let Some(tip) = arg_map.get(&name) else {
                    return Ok(None);
                };

                Ok(Some(LspHover {
                    contents: HoverContents::Markup(MarkupContent {
                        kind: MarkupKind::Markdown,
                        value: tip.clone(),
                    }),
                    range: Some(range),
                }))
            }
            Hover::Variable {
                name,
                ty: Some(ty),
                range,
            } => Ok(Some(LspHover {
                contents: HoverContents::Markup(MarkupContent {
                    kind: MarkupKind::Markdown,
                    value: format!("```\n{name}: {ty}\n```"),
                }),
                range: Some(range),
            })),
            Hover::Variable { name, ty: None, range } => Ok(with_cached_var(&name, |value| {
                let mut text: String = format!("```\n{name}");
                if let Some(ty) = value.principal_type() {
                    text.push_str(&format!(": {}", ty.human_friendly_type()));
                }
                if let Some(v) = value.value_str() {
                    text.push_str(&format!(" = {v}"));
                }
                text.push_str("\n```");

                LspHover {
                    contents: HoverContents::Markup(MarkupContent {
                        kind: MarkupKind::Markdown,
                        value: text,
                    }),
                    range: Some(range),
                }
            })
            .await),
            Hover::Signature { .. } => Ok(None),
            Hover::Comment { value, range } => Ok(Some(LspHover {
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

        // Get the current line up to cursor
        let Some(current_code) = self
            .code_map
            .get(params.text_document_position.text_document.uri.as_ref())
        else {
            return Ok(Some(CompletionResponse::Array(completions)));
        };
        let Ok(current_code) = std::str::from_utf8(&current_code) else {
            return Ok(Some(CompletionResponse::Array(completions)));
        };

        // Get the current line up to cursor, with bounds checking
        if let Some(line) = current_code
            .lines()
            .nth(params.text_document_position.position.line as usize)
        {
            let char_pos = params.text_document_position.position.character as usize;
            if char_pos <= line.len() {
                let line_prefix = &line[..char_pos];
                // Get last word
                let last_word = line_prefix
                    .split(|c: char| c.is_whitespace() || c.is_ascii_punctuation())
                    .next_back()
                    .unwrap_or("");

                // If the last word starts with a digit, return no completions
                if !last_word.is_empty() && last_word.chars().next().unwrap().is_ascii_digit() {
                    return Ok(None);
                }
            }
        }

        completions.extend(self.stdlib_completions.values().cloned());

        // Add more to the completions if we have more.
        let Some(ast) = self
            .ast_map
            .get(params.text_document_position.text_document.uri.as_ref())
        else {
            return Ok(Some(CompletionResponse::Array(completions)));
        };

        let Some(current_code) = self
            .code_map
            .get(params.text_document_position.text_document.uri.as_ref())
        else {
            return Ok(Some(CompletionResponse::Array(completions)));
        };
        let Ok(current_code) = std::str::from_utf8(&current_code) else {
            return Ok(Some(CompletionResponse::Array(completions)));
        };

        let position = position_to_char_index(params.text_document_position.position, current_code);
        if ast.ast.in_comment(position) {
            // If we are in a code comment we don't want to show completions.
            return Ok(None);
        }

        // Get the completion items for the ast.
        let Ok(variables) = ast.ast.completion_items(position) else {
            return Ok(Some(CompletionResponse::Array(completions)));
        };

        // Get our variables from our AST to include in our completions.
        completions.extend(variables);

        Ok(Some(CompletionResponse::Array(completions)))
    }

    async fn diagnostic(&self, params: DocumentDiagnosticParams) -> RpcResult<DocumentDiagnosticReportResult> {
        let filename = params.text_document.uri.to_string();

        // Get the current diagnostics for this file.
        let Some(items) = self.diagnostics_map.get(&filename) else {
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

        Ok(DocumentDiagnosticReportResult::Report(DocumentDiagnosticReport::Full(
            RelatedFullDocumentDiagnosticReport {
                related_documents: None,
                full_document_diagnostic_report: FullDocumentDiagnosticReport {
                    result_id: None,
                    items: items.clone(),
                },
            },
        )))
    }

    async fn signature_help(&self, params: SignatureHelpParams) -> RpcResult<Option<SignatureHelp>> {
        let filename = params.text_document_position_params.text_document.uri.to_string();

        let Some(current_code) = self.code_map.get(&filename) else {
            return Ok(None);
        };
        let Ok(current_code) = std::str::from_utf8(&current_code) else {
            return Ok(None);
        };

        let pos = position_to_char_index(params.text_document_position_params.position, current_code);

        // Get the character at the position.
        let Some(ch) = current_code.chars().nth(pos) else {
            return Ok(None);
        };

        let check_char = |ch: char| {
            // If  we are on a (, then get the string in front of the (
            // and try to get the signature.
            // We do these before the ast check because we might not have a valid ast.
            if ch == '(' {
                // If the current character is not a " " then get the next space after
                // our position so we can split on that.
                // Find the next space after the current position.
                let next_space = if ch != ' ' {
                    if let Some(next_space) = current_code[pos..].find(' ') {
                        pos + next_space
                    } else if let Some(next_space) = current_code[pos..].find('(') {
                        pos + next_space
                    } else {
                        pos
                    }
                } else {
                    pos
                };
                let p2 = std::cmp::max(pos, next_space);

                let last_word = current_code[..p2].split_whitespace().last()?;

                // Get the function name.
                return self.stdlib_signatures.get(last_word);
            } else if ch == ',' {
                // If we have a comma, then get the string in front of
                // the closest ( and try to get the signature.

                // Find the last ( before the comma.
                let last_paren = current_code[..pos].rfind('(')?;
                // Get the string in front of the (.
                let last_word = current_code[..last_paren].split_whitespace().last()?;
                // Get the function name.
                return self.stdlib_signatures.get(last_word);
            }

            None
        };

        if let Some(signature) = check_char(ch) {
            return Ok(Some(signature.clone()));
        }

        // Check if we have context.
        if let Some(context) = params.context {
            if let Some(character) = context.trigger_character {
                for character in character.chars() {
                    // Check if we are on a ( or a ,.
                    if character == '(' || character == ',' {
                        if let Some(signature) = check_char(character) {
                            return Ok(Some(signature.clone()));
                        }
                    }
                }
            }
        }

        // Let's iterate over the AST and find the node that contains the cursor.
        let Some(ast) = self.ast_map.get(&filename) else {
            return Ok(None);
        };

        let Some(value) = ast.ast.get_expr_for_position(pos) else {
            return Ok(None);
        };

        let Some(hover) =
            value.get_hover_value_for_position(pos, current_code, &HoverOpts::default_for_signature_help())
        else {
            return Ok(None);
        };

        match hover {
            Hover::Function { name, range: _ } => {
                // Get the docs for this function.
                let Some(signature) = self.stdlib_signatures.get(&name) else {
                    return Ok(None);
                };

                Ok(Some(signature.clone()))
            }
            Hover::Signature {
                name,
                parameter_index,
                range: _,
            } => {
                let Some(signature) = self.stdlib_signatures.get(&name) else {
                    return Ok(None);
                };

                let mut signature = signature.clone();

                signature.active_parameter = Some(parameter_index);

                Ok(Some(signature))
            }
            _ => {
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

        let Some(semantic_tokens) = self.semantic_tokens_map.get(&filename) else {
            return Ok(None);
        };

        Ok(Some(SemanticTokensResult::Tokens(SemanticTokens {
            result_id: None,
            data: semantic_tokens.clone(),
        })))
    }

    async fn document_symbol(&self, params: DocumentSymbolParams) -> RpcResult<Option<DocumentSymbolResponse>> {
        let filename = params.text_document.uri.to_string();

        let Some(symbols) = self.symbols_map.get(&filename) else {
            return Ok(None);
        };

        Ok(Some(DocumentSymbolResponse::Nested(symbols.clone())))
    }

    async fn formatting(&self, params: DocumentFormattingParams) -> RpcResult<Option<Vec<TextEdit>>> {
        let filename = params.text_document.uri.to_string();

        let Some(current_code) = self.code_map.get(&filename) else {
            return Ok(None);
        };
        let Ok(current_code) = std::str::from_utf8(&current_code) else {
            return Ok(None);
        };

        // Parse the ast.
        // I don't know if we need to do this again since it should be updated in the context.
        // But I figure better safe than sorry since this will write back out to the file.
        let module_id = ModuleId::default();
        let Ok(ast) = crate::parsing::parse_str(current_code, module_id).parse_errs_as_err() else {
            return Ok(None);
        };
        // Now recast it.
        let recast = ast.recast(
            &crate::parsing::ast::types::FormatOptions {
                tab_size: params.options.tab_size as usize,
                insert_final_newline: params.options.insert_final_newline.unwrap_or(false),
                use_tabs: !params.options.insert_spaces,
            },
            0,
        );
        let source_range = SourceRange::new(0, current_code.len(), module_id);
        let range = source_range.to_lsp_range(current_code);
        Ok(Some(vec![TextEdit {
            new_text: recast,
            range,
        }]))
    }

    async fn rename(&self, params: RenameParams) -> RpcResult<Option<WorkspaceEdit>> {
        let Some((current_code, new_code)) =
            self.inner_prepare_rename(&params.text_document_position, &params.new_name)?
        else {
            return Ok(None);
        };

        let source_range = SourceRange::new(0, current_code.len(), ModuleId::default());
        let range = source_range.to_lsp_range(&current_code);
        Ok(Some(WorkspaceEdit {
            changes: Some(HashMap::from([(
                params.text_document_position.text_document.uri,
                vec![TextEdit {
                    new_text: new_code,
                    range,
                }],
            )])),
            document_changes: None,
            change_annotations: None,
        }))
    }

    async fn prepare_rename(&self, params: TextDocumentPositionParams) -> RpcResult<Option<PrepareRenameResponse>> {
        if self
            .inner_prepare_rename(&params, "someNameNoOneInTheirRightMindWouldEverUseForTesting")?
            .is_none()
        {
            return Ok(None);
        }

        // Return back to the client, that it is safe to use the rename behavior.
        Ok(Some(PrepareRenameResponse::DefaultBehavior { default_behavior: true }))
    }

    async fn folding_range(&self, params: FoldingRangeParams) -> RpcResult<Option<Vec<FoldingRange>>> {
        let filename = params.text_document.uri.to_string();

        // Get the ast.
        let Some(ast) = self.ast_map.get(&filename) else {
            return Ok(None);
        };

        // Get the folding ranges.
        let folding_ranges = ast.ast.get_lsp_folding_ranges();

        if folding_ranges.is_empty() {
            return Ok(None);
        }

        Ok(Some(folding_ranges))
    }

    async fn code_action(&self, params: CodeActionParams) -> RpcResult<Option<CodeActionResponse>> {
        let actions = params
            .context
            .diagnostics
            .into_iter()
            .filter_map(|diagnostic| {
                let (suggestion, range) = diagnostic
                    .data
                    .as_ref()
                    .and_then(|data| serde_json::from_value::<LspSuggestion>(data.clone()).ok())?;
                let edit = TextEdit {
                    range,
                    new_text: suggestion.insert,
                };
                let changes = HashMap::from([(params.text_document.uri.clone(), vec![edit])]);

                // If you add more code action kinds, make sure you add it to the server
                // capabilities on initialization!
                Some(CodeActionOrCommand::CodeAction(CodeAction {
                    title: suggestion.title,
                    kind: Some(CodeActionKind::QUICKFIX),
                    diagnostics: Some(vec![diagnostic]),
                    edit: Some(WorkspaceEdit {
                        changes: Some(changes),
                        document_changes: None,
                        change_annotations: None,
                    }),
                    command: None,
                    is_preferred: Some(true),
                    disabled: None,
                    data: None,
                }))
            })
            .collect();

        Ok(Some(actions))
    }

    async fn document_color(&self, params: DocumentColorParams) -> RpcResult<Vec<ColorInformation>> {
        let filename = params.text_document.uri.to_string();

        let Some(current_code) = self.code_map.get(&filename) else {
            return Ok(vec![]);
        };
        let Ok(current_code) = std::str::from_utf8(&current_code) else {
            return Ok(vec![]);
        };

        // Get the ast from our map.
        let Some(ast) = self.ast_map.get(&filename) else {
            return Ok(vec![]);
        };

        // Get the colors from the ast.
        let Ok(colors) = ast.ast.document_color(current_code) else {
            return Ok(vec![]);
        };

        Ok(colors)
    }

    async fn color_presentation(&self, params: ColorPresentationParams) -> RpcResult<Vec<ColorPresentation>> {
        let filename = params.text_document.uri.to_string();

        let Some(current_code) = self.code_map.get(&filename) else {
            return Ok(vec![]);
        };
        let Ok(current_code) = std::str::from_utf8(&current_code) else {
            return Ok(vec![]);
        };

        // Get the ast from our map.
        let Some(ast) = self.ast_map.get(&filename) else {
            return Ok(vec![]);
        };

        let pos_start = position_to_char_index(params.range.start, current_code);
        let pos_end = position_to_char_index(params.range.end, current_code);

        // Get the colors from the ast.
        let Ok(Some(presentation)) = ast.ast.color_presentation(&params.color, pos_start, pos_end) else {
            return Ok(vec![]);
        };

        Ok(vec![presentation])
    }
}

/// Get completions from our stdlib.
pub fn get_completions_from_stdlib(kcl_std: &ModData) -> Result<HashMap<String, CompletionItem>> {
    let mut completions = HashMap::new();

    for d in kcl_std.all_docs() {
        if let Some(ci) = d.to_completion_item() {
            completions.insert(d.name().to_owned(), ci);
        }
    }

    let variable_kinds = VariableKind::to_completion_items();
    for variable_kind in variable_kinds {
        completions.insert(variable_kind.label.clone(), variable_kind);
    }

    Ok(completions)
}

/// Get signatures from our stdlib.
pub fn get_signatures_from_stdlib(kcl_std: &ModData) -> HashMap<String, SignatureHelp> {
    let mut signatures = HashMap::new();

    for d in kcl_std.all_docs() {
        if let Some(sig) = d.to_signature_help() {
            signatures.insert(d.name().to_owned(), sig);
        }
    }

    signatures
}

/// Get signatures from our stdlib.
pub fn get_arg_maps_from_stdlib(kcl_std: &ModData) -> HashMap<String, HashMap<String, String>> {
    let mut result = HashMap::new();

    for d in kcl_std.all_docs() {
        let crate::docs::kcl_doc::DocData::Fn(f) = d else {
            continue;
        };
        let arg_map: HashMap<String, String> = f
            .args
            .iter()
            .map(|data| {
                let mut tip = "```\n".to_owned();
                tip.push_str(&data.to_string());
                tip.push_str("\n```");
                if let Some(docs) = &data.docs {
                    tip.push_str("\n\n");
                    tip.push_str(docs);
                }
                (data.name.clone(), tip)
            })
            .collect();
        if !arg_map.is_empty() {
            result.insert(f.name.clone(), arg_map);
        }
    }

    result
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

    std::cmp::min(char_position, code.len() - 1)
}

async fn with_cached_var<T>(name: &str, f: impl Fn(&KclValue) -> T) -> Option<T> {
    let mem = cache::read_old_memory().await?;
    let value = mem.0.get(name, SourceRange::default()).ok()?;

    Some(f(value))
}

#[cfg(test)]
mod tests {
    use pretty_assertions::assert_eq;

    use super::*;

    #[test]
    fn test_position_to_char_index_first_line() {
        let code = r#"def foo():
return 42"#;
        let position = Position::new(0, 3);
        let index = position_to_char_index(position, code);
        assert_eq!(index, 3);
    }

    #[test]
    fn test_position_to_char_index() {
        let code = r#"def foo():
return 42"#;
        let position = Position::new(1, 4);
        let index = position_to_char_index(position, code);
        assert_eq!(index, 15);
    }

    #[test]
    fn test_position_to_char_index_with_newline() {
        let code = r#"def foo():

return 42"#;
        let position = Position::new(2, 0);
        let index = position_to_char_index(position, code);
        assert_eq!(index, 12);
    }

    #[test]
    fn test_position_to_char_at_end() {
        let code = r#"def foo():
return 42"#;

        let position = Position::new(1, 8);
        let index = position_to_char_index(position, code);
        assert_eq!(index, 19);
    }
}
