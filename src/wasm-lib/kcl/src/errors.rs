use serde::{Deserialize, Serialize};
use thiserror::Error;
use tower_lsp::lsp_types::{Diagnostic, DiagnosticSeverity};

use crate::executor::SourceRange;

#[derive(Error, Debug, Serialize, Deserialize, ts_rs::TS, Clone)]
#[ts(export)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum KclError {
    #[error("lexical: {0:?}")]
    Lexical(KclErrorDetails),
    #[error("syntax: {0:?}")]
    Syntax(KclErrorDetails),
    #[error("semantic: {0:?}")]
    Semantic(KclErrorDetails),
    #[error("type: {0:?}")]
    Type(KclErrorDetails),
    #[error("unimplemented: {0:?}")]
    Unimplemented(KclErrorDetails),
    #[error("unexpected: {0:?}")]
    Unexpected(KclErrorDetails),
    #[error("value already defined: {0:?}")]
    ValueAlreadyDefined(KclErrorDetails),
    #[error("undefined value: {0:?}")]
    UndefinedValue(KclErrorDetails),
    #[error("invalid expression: {0:?}")]
    InvalidExpression(KclErrorDetails),
    #[error("engine: {0:?}")]
    Engine(KclErrorDetails),
    #[error("internal error, please report to KittyCAD team: {0:?}")]
    Internal(KclErrorDetails),
}

#[derive(Debug, Serialize, Deserialize, ts_rs::TS, Clone)]
#[ts(export)]
pub struct KclErrorDetails {
    #[serde(rename = "sourceRanges")]
    pub source_ranges: Vec<SourceRange>,
    #[serde(rename = "msg")]
    pub message: String,
}

impl KclError {
    /// Get the error message, line and column from the error and input code.
    pub fn get_message_line_column(&self, input: &str) -> (String, Option<usize>, Option<usize>) {
        // Calculate the line and column of the error from the source range.
        let (line, column) = if let Some(range) = self.source_ranges().first() {
            let line = input[..range.0[0]].lines().count();
            let column = input[..range.0[0]].lines().last().map(|l| l.len()).unwrap_or_default();

            (Some(line), Some(column))
        } else {
            (None, None)
        };

        (format!("{}: {}", self.error_type(), self.message()), line, column)
    }

    pub fn error_type(&self) -> &'static str {
        match self {
            KclError::Lexical(_) => "lexical",
            KclError::Syntax(_) => "syntax",
            KclError::Semantic(_) => "semantic",
            KclError::Type(_) => "type",
            KclError::Unimplemented(_) => "unimplemented",
            KclError::Unexpected(_) => "unexpected",
            KclError::ValueAlreadyDefined(_) => "value already defined",
            KclError::UndefinedValue(_) => "undefined value",
            KclError::InvalidExpression(_) => "invalid expression",
            KclError::Engine(_) => "engine",
            KclError::Internal(_) => "internal",
        }
    }

    pub fn source_ranges(&self) -> Vec<SourceRange> {
        match &self {
            KclError::Lexical(e) => e.source_ranges.clone(),
            KclError::Syntax(e) => e.source_ranges.clone(),
            KclError::Semantic(e) => e.source_ranges.clone(),
            KclError::Type(e) => e.source_ranges.clone(),
            KclError::Unimplemented(e) => e.source_ranges.clone(),
            KclError::Unexpected(e) => e.source_ranges.clone(),
            KclError::ValueAlreadyDefined(e) => e.source_ranges.clone(),
            KclError::UndefinedValue(e) => e.source_ranges.clone(),
            KclError::InvalidExpression(e) => e.source_ranges.clone(),
            KclError::Engine(e) => e.source_ranges.clone(),
            KclError::Internal(e) => e.source_ranges.clone(),
        }
    }

    /// Get the inner error message.
    pub fn message(&self) -> &str {
        match &self {
            KclError::Lexical(e) => &e.message,
            KclError::Syntax(e) => &e.message,
            KclError::Semantic(e) => &e.message,
            KclError::Type(e) => &e.message,
            KclError::Unimplemented(e) => &e.message,
            KclError::Unexpected(e) => &e.message,
            KclError::ValueAlreadyDefined(e) => &e.message,
            KclError::UndefinedValue(e) => &e.message,
            KclError::InvalidExpression(e) => &e.message,
            KclError::Engine(e) => &e.message,
            KclError::Internal(e) => &e.message,
        }
    }

    pub fn to_lsp_diagnostic(&self, code: &str) -> Diagnostic {
        let (message, _, _) = self.get_message_line_column(code);
        let source_ranges = self.source_ranges();

        Diagnostic {
            range: source_ranges.first().map(|r| r.to_lsp_range(code)).unwrap_or_default(),
            severity: Some(DiagnosticSeverity::ERROR),
            code: None,
            // TODO: this is neat we can pass a URL to a help page here for this specific error.
            code_description: None,
            source: Some("kcl".to_string()),
            message,
            related_information: None,
            tags: None,
            data: None,
        }
    }
}

/// This is different than to_string() in that it will serialize the Error
/// the struct as JSON so we can deserialize it on the js side.
impl From<KclError> for String {
    fn from(error: KclError) -> Self {
        serde_json::to_string(&error).unwrap()
    }
}

impl From<String> for KclError {
    fn from(error: String) -> Self {
        serde_json::from_str(&error).unwrap()
    }
}
