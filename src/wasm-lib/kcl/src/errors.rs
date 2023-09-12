use serde::{Deserialize, Serialize};
use thiserror::Error;
use tower_lsp::lsp_types::{Diagnostic, DiagnosticSeverity};

use crate::executor::SourceRange;

#[derive(Error, Debug, Serialize, Deserialize, ts_rs::TS)]
#[ts(export)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum KclError {
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
}

#[derive(Debug, Serialize, Deserialize, ts_rs::TS)]
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
        let (type_, source_range, message) = match &self {
            KclError::Syntax(e) => ("syntax", e.source_ranges.clone(), e.message.clone()),
            KclError::Semantic(e) => ("semantic", e.source_ranges.clone(), e.message.clone()),
            KclError::Type(e) => ("type", e.source_ranges.clone(), e.message.clone()),
            KclError::Unimplemented(e) => ("unimplemented", e.source_ranges.clone(), e.message.clone()),
            KclError::Unexpected(e) => ("unexpected", e.source_ranges.clone(), e.message.clone()),
            KclError::ValueAlreadyDefined(e) => ("value already defined", e.source_ranges.clone(), e.message.clone()),
            KclError::UndefinedValue(e) => ("undefined value", e.source_ranges.clone(), e.message.clone()),
            KclError::InvalidExpression(e) => ("invalid expression", e.source_ranges.clone(), e.message.clone()),
            KclError::Engine(e) => ("engine", e.source_ranges.clone(), e.message.clone()),
        };

        // Calculate the line and column of the error from the source range.
        let (line, column) = if let Some(range) = source_range.first() {
            let line = input[..range.0[0]].lines().count();
            let column = input[..range.0[0]].lines().last().map(|l| l.len()).unwrap_or_default();

            (Some(line), Some(column))
        } else {
            (None, None)
        };

        (format!("{}: {}", type_, message), line, column)
    }

    pub fn source_ranges(&self) -> Vec<SourceRange> {
        match &self {
            KclError::Syntax(e) => e.source_ranges.clone(),
            KclError::Semantic(e) => e.source_ranges.clone(),
            KclError::Type(e) => e.source_ranges.clone(),
            KclError::Unimplemented(e) => e.source_ranges.clone(),
            KclError::Unexpected(e) => e.source_ranges.clone(),
            KclError::ValueAlreadyDefined(e) => e.source_ranges.clone(),
            KclError::UndefinedValue(e) => e.source_ranges.clone(),
            KclError::InvalidExpression(e) => e.source_ranges.clone(),
            KclError::Engine(e) => e.source_ranges.clone(),
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
