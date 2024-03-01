//! Functions for the `kcl` lsp server.

use std::collections::HashMap;

use anyhow::Result;
#[cfg(feature = "cli")]
use clap::Parser;
use dashmap::DashMap;
use tower_lsp::{
    jsonrpc::Result as RpcResult,
    lsp_types::{
        CompletionItem, CompletionItemKind, CompletionOptions, CompletionParams, CompletionResponse, CreateFilesParams,
        DeleteFilesParams, DiagnosticOptions, DiagnosticServerCapabilities, DidChangeConfigurationParams,
        DidChangeTextDocumentParams, DidChangeWatchedFilesParams, DidChangeWorkspaceFoldersParams,
        DidCloseTextDocumentParams, DidOpenTextDocumentParams, DidSaveTextDocumentParams, DocumentDiagnosticParams,
        DocumentDiagnosticReport, DocumentDiagnosticReportResult, DocumentFilter, DocumentFormattingParams,
        DocumentSymbol, DocumentSymbolParams, DocumentSymbolResponse, Documentation, FullDocumentDiagnosticReport,
        Hover, HoverContents, HoverParams, HoverProviderCapability, InitializeParams, InitializeResult,
        InitializedParams, InlayHint, InlayHintParams, InsertTextFormat, MarkupContent, MarkupKind, MessageType, OneOf,
        ParameterInformation, ParameterLabel, Position, RelatedFullDocumentDiagnosticReport, RenameFilesParams,
        RenameParams, SemanticToken, SemanticTokenType, SemanticTokens, SemanticTokensFullOptions,
        SemanticTokensLegend, SemanticTokensOptions, SemanticTokensParams, SemanticTokensRegistrationOptions,
        SemanticTokensResult, SemanticTokensServerCapabilities, ServerCapabilities, SignatureHelp,
        SignatureHelpOptions, SignatureHelpParams, SignatureInformation, StaticRegistrationOptions, TextDocumentItem,
        TextDocumentRegistrationOptions, TextDocumentSyncCapability, TextDocumentSyncKind, TextDocumentSyncOptions,
        TextEdit, WorkDoneProgressOptions, WorkspaceEdit, WorkspaceFoldersServerCapabilities,
        WorkspaceServerCapabilities,
    },
    Client, LanguageServer,
};

use crate::{ast::types::VariableKind, executor::SourceRange, lsp::backend::Backend as _, parser::PIPE_OPERATOR};

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
pub struct Backend {
    /// The client for the backend.
    pub client: Client,
    /// The file system client to use.
    pub fs: crate::fs::FileManager,
    /// The stdlib completions for the language.
    pub stdlib_completions: HashMap<String, CompletionItem>,
    /// The stdlib signatures for the language.
    pub stdlib_signatures: HashMap<String, SignatureHelp>,
    /// The types of tokens the server supports.
    pub token_types: Vec<SemanticTokenType>,
    /// Token maps.
    pub token_map: DashMap<String, Vec<crate::token::Token>>,
    /// AST maps.
    pub ast_map: DashMap<String, crate::ast::types::Program>,
    /// Current code.
    pub current_code_map: DashMap<String, String>,
    /// Diagnostics.
    pub diagnostics_map: DashMap<String, DocumentDiagnosticReport>,
    /// Symbols map.
    pub symbols_map: DashMap<String, Vec<DocumentSymbol>>,
    /// Semantic tokens map.
    pub semantic_tokens_map: DashMap<String, Vec<SemanticToken>>,
}

// Implement the shared backend trait for the language server.
#[async_trait::async_trait]
impl crate::lsp::backend::Backend for Backend {
    fn client(&self) -> Client {
        self.client.clone()
    }

    fn fs(&self) -> crate::fs::FileManager {
        self.fs.clone()
    }

    fn current_code_map(&self) -> DashMap<String, String> {
        self.current_code_map.clone()
    }

    fn insert_current_code_map(&self, uri: String, text: String) {
        self.current_code_map.insert(uri, text);
    }

    async fn on_change(&self, params: TextDocumentItem) {
        // We already updated the code map in the shared backend.

        // Lets update the tokens.
        let tokens = crate::token::lexer(&params.text);
        self.token_map.insert(params.uri.to_string(), tokens.clone());

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
        self.semantic_tokens_map.insert(params.uri.to_string(), semantic_tokens);

        // Lets update the ast.
        let parser = crate::parser::Parser::new(tokens);
        let result = parser.ast();
        let ast = match result {
            Ok(ast) => ast,
            Err(e) => {
                let diagnostic = e.to_lsp_diagnostic(&params.text);
                // We got errors, update the diagnostics.
                self.diagnostics_map.insert(
                    params.uri.to_string(),
                    DocumentDiagnosticReport::Full(RelatedFullDocumentDiagnosticReport {
                        related_documents: None,
                        full_document_diagnostic_report: FullDocumentDiagnosticReport {
                            result_id: None,
                            items: vec![diagnostic.clone()],
                        },
                    }),
                );

                // Publish the diagnostic.
                // If the client supports it.
                self.client
                    .publish_diagnostics(params.uri, vec![diagnostic], None)
                    .await;

                return;
            }
        };

        // Update the symbols map.
        self.symbols_map
            .insert(params.uri.to_string(), ast.get_lsp_symbols(&params.text));

        self.ast_map.insert(params.uri.to_string(), ast);
        // Lets update the diagnostics, since we got no errors.
        self.diagnostics_map.insert(
            params.uri.to_string(),
            DocumentDiagnosticReport::Full(RelatedFullDocumentDiagnosticReport {
                related_documents: None,
                full_document_diagnostic_report: FullDocumentDiagnosticReport {
                    result_id: None,
                    items: vec![],
                },
            }),
        );

        // Publish the diagnostic, we reset it here so the client knows the code compiles now.
        // If the client supports it.
        self.client.publish_diagnostics(params.uri.clone(), vec![], None).await;
    }
}

impl Backend {
    fn get_semantic_token_type_index(&self, token_type: SemanticTokenType) -> Option<usize> {
        self.token_types.iter().position(|x| *x == token_type)
    }

    async fn completions_get_variables_from_ast(&self, file_name: &str) -> Vec<CompletionItem> {
        let mut completions = vec![];

        let ast = match self.ast_map.get(file_name) {
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
                document_symbol_provider: Some(OneOf::Left(true)),
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
        self.do_did_close(params).await
    }

    async fn hover(&self, params: HoverParams) -> RpcResult<Option<Hover>> {
        let filename = params.text_document_position_params.text_document.uri.to_string();

        let Some(current_code) = self.current_code_map.get(&filename) else {
            return Ok(None);
        };

        let pos = position_to_char_index(params.text_document_position_params.position, &current_code);

        // Let's iterate over the AST and find the node that contains the cursor.
        let Some(ast) = self.ast_map.get(&filename) else {
            return Ok(None);
        };

        let Some(value) = ast.get_value_for_position(pos) else {
            return Ok(None);
        };

        let Some(hover) = value.get_hover_value_for_position(pos, &current_code) else {
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
        let Some(diagnostic) = self.diagnostics_map.get(&filename) else {
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

        let Some(current_code) = self.current_code_map.get(&filename) else {
            return Ok(None);
        };

        let pos = position_to_char_index(params.text_document_position_params.position, &current_code);

        // Let's iterate over the AST and find the node that contains the cursor.
        let Some(ast) = self.ast_map.get(&filename) else {
            return Ok(None);
        };

        let Some(value) = ast.get_value_for_position(pos) else {
            return Ok(None);
        };

        let Some(hover) = value.get_hover_value_for_position(pos, &current_code) else {
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

        let Some(current_code) = self.current_code_map.get(&filename) else {
            return Ok(None);
        };

        // Parse the ast.
        // I don't know if we need to do this again since it should be updated in the context.
        // But I figure better safe than sorry since this will write back out to the file.
        let tokens = crate::token::lexer(&current_code);
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
        let source_range = SourceRange([0, current_code.len() - 1]);
        let range = source_range.to_lsp_range(&current_code);
        Ok(Some(vec![TextEdit {
            new_text: recast,
            range,
        }]))
    }

    async fn rename(&self, params: RenameParams) -> RpcResult<Option<WorkspaceEdit>> {
        let filename = params.text_document_position.text_document.uri.to_string();

        let Some(current_code) = self.current_code_map.get(&filename) else {
            return Ok(None);
        };

        // Parse the ast.
        // I don't know if we need to do this again since it should be updated in the context.
        // But I figure better safe than sorry since this will write back out to the file.
        let tokens = crate::token::lexer(&current_code);
        let parser = crate::parser::Parser::new(tokens);
        let Ok(mut ast) = parser.ast() else {
            return Ok(None);
        };

        // Let's convert the position to a character index.
        let pos = position_to_char_index(params.text_document_position.position, &current_code);
        // Now let's perform the rename on the ast.
        ast.rename_symbol(&params.new_name, pos);
        // Now recast it.
        let recast = ast.recast(&Default::default(), 0);
        let source_range = SourceRange([0, current_code.len() - 1]);
        let range = source_range.to_lsp_range(&current_code);
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
}

/// Get completions from our stdlib.
pub fn get_completions_from_stdlib(stdlib: &crate::std::StdLib) -> Result<HashMap<String, CompletionItem>> {
    let mut completions = HashMap::new();

    for internal_fn in stdlib.fns.values() {
        completions.insert(internal_fn.name(), internal_fn.to_completion_item());
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

    for internal_fn in stdlib.fns.values() {
        signatures.insert(internal_fn.name(), internal_fn.to_signature_help());
    }

    let show = SignatureHelp {
        signatures: vec![SignatureInformation {
            label: "show".to_string(),
            documentation: Some(Documentation::MarkupContent(MarkupContent {
                kind: MarkupKind::PlainText,
                value: "Show a model.".to_string(),
            })),
            parameters: Some(vec![ParameterInformation {
                label: ParameterLabel::Simple("sg: SketchGroup".to_string()),
                documentation: Some(Documentation::MarkupContent(MarkupContent {
                    kind: MarkupKind::PlainText,
                    value: "A sketch group.".to_string(),
                })),
            }]),
            active_parameter: None,
        }],
        active_signature: Some(0),
        active_parameter: None,
    };
    signatures.insert("show".to_string(), show);

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
