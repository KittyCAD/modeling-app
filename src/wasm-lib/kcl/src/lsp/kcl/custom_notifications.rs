//! Custom notifications for the KCL LSP server that are not part of the LSP specification.

use serde::{Deserialize, Serialize};
use tower_lsp::lsp_types::notification::Notification;

use crate::{ast::types::UnboxedNode, settings::types::UnitLength};

/// A notification that the AST has changed.
#[derive(Debug)]
pub enum AstUpdated {}

impl Notification for AstUpdated {
    type Params = UnboxedNode<crate::ast::types::Program>;
    const METHOD: &'static str = "kcl/astUpdated";
}

/// A notification that the Memory has changed.
#[derive(Debug)]
pub enum MemoryUpdated {}

impl Notification for MemoryUpdated {
    type Params = crate::executor::ProgramMemory;
    const METHOD: &'static str = "kcl/memoryUpdated";
}

/// Text documents are identified using a URI. On the protocol level, URIs are passed as strings.
#[derive(Debug, Eq, PartialEq, Clone, Deserialize, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct TextDocumentIdentifier {
    /// The text document's URI.
    pub uri: url::Url,
}

#[derive(Debug, Eq, PartialEq, Clone, Deserialize, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct UpdateUnitsParams {
    pub text_document: TextDocumentIdentifier,
    /// The content of the text document.
    pub text: String,
    pub units: UnitLength,
}

#[derive(Debug, PartialEq, Clone, Deserialize, Serialize, ts_rs::TS)]
#[ts(export)]
pub struct UpdateUnitsResponse {}

#[derive(Debug, Eq, PartialEq, Clone, Deserialize, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct UpdateCanExecuteParams {
    pub can_execute: bool,
}

#[derive(Debug, Eq, PartialEq, Clone, Deserialize, Serialize, ts_rs::TS)]
#[ts(export)]
pub struct UpdateCanExecuteResponse {}
