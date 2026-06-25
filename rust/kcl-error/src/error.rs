use schemars::JsonSchema;
use serde::Deserialize;
use serde::Serialize;
use thiserror::Error;

use crate::CompilationIssue;
use crate::SourceRange;

const RETRYABLE_ENGINE_MESSAGE_MARKER_SETS: &[&[&str]] = &[
    &["modeling connection", "interrupted", "please reconnect"],
    &["modeling connection", "heartbeats", "please reconnect"],
];

pub trait IsRetryable {
    /// Returns true if the error is transient and the operation that caused it
    /// should be retried.
    fn is_retryable(&self) -> bool;
}

#[derive(Error, Debug, Serialize, Deserialize, ts_rs::TS, Clone, PartialEq, Eq, JsonSchema)]
#[ts(export)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum KclError {
    #[error("lexical: {details:?}")]
    Lexical { details: KclErrorDetails },
    #[error("syntax: {details:?}")]
    Syntax { details: KclErrorDetails },
    #[error("semantic: {details:?}")]
    Semantic { details: KclErrorDetails },
    #[error("import cycle: {details:?}")]
    ImportCycle { details: KclErrorDetails },
    #[error("argument: {details:?}")]
    Argument { details: KclErrorDetails },
    #[error("type: {details:?}")]
    Type { details: KclErrorDetails },
    #[error("i/o: {details:?}")]
    Io { details: KclErrorDetails },
    #[error("unexpected: {details:?}")]
    Unexpected { details: KclErrorDetails },
    #[error("value already defined: {details:?}")]
    ValueAlreadyDefined { details: KclErrorDetails },
    #[error("undefined value: {details:?}")]
    UndefinedValue {
        details: KclErrorDetails,
        name: Option<String>,
    },
    #[error("invalid expression: {details:?}")]
    InvalidExpression { details: KclErrorDetails },
    #[error("max call stack size exceeded: {details:?}")]
    MaxCallStack { details: KclErrorDetails },
    #[error("refactor: {details:?}")]
    Refactor { details: KclErrorDetails },
    #[error("engine: {details:?}")]
    Engine { details: KclErrorDetails },
    #[error("engine hangup: {details:?}")]
    EngineHangup {
        details: KclErrorDetails,
        api_call_id: Option<String>,
    },
    #[error("engine internal: {details:?}")]
    EngineInternal { details: KclErrorDetails },
    #[error("internal error, please report to KittyCAD team: {details:?}")]
    Internal { details: KclErrorDetails },
}

impl IsRetryable for KclError {
    fn is_retryable(&self) -> bool {
        matches!(self, KclError::EngineHangup { .. } | KclError::EngineInternal { .. })
    }
}
#[derive(
    Debug, Serialize, Deserialize, ts_rs::TS, Clone, PartialEq, Eq, thiserror::Error, miette::Diagnostic, JsonSchema,
)]
#[serde(rename_all = "camelCase")]
#[error("{message}")]
#[ts(export)]
pub struct KclErrorDetails {
    #[label(collection, "Errors")]
    pub source_ranges: Vec<SourceRange>,
    pub backtrace: Vec<BacktraceItem>,
    #[serde(rename = "msg")]
    pub message: String,
}

impl KclErrorDetails {
    pub fn new(message: String, source_ranges: Vec<SourceRange>) -> KclErrorDetails {
        let backtrace = source_ranges
            .iter()
            .map(|s| BacktraceItem {
                source_range: *s,
                fn_name: None,
            })
            .collect();
        KclErrorDetails {
            source_ranges,
            backtrace,
            message,
        }
    }
}

impl KclError {
    pub fn internal(message: String) -> KclError {
        KclError::Internal {
            details: KclErrorDetails {
                source_ranges: Default::default(),
                backtrace: Default::default(),
                message,
            },
        }
    }

    pub fn new_internal(details: KclErrorDetails) -> KclError {
        KclError::Internal { details }
    }

    pub fn new_import_cycle(details: KclErrorDetails) -> KclError {
        KclError::ImportCycle { details }
    }

    pub fn new_argument(details: KclErrorDetails) -> KclError {
        KclError::Argument { details }
    }

    pub fn new_semantic(details: KclErrorDetails) -> KclError {
        KclError::Semantic { details }
    }

    pub fn new_value_already_defined(details: KclErrorDetails) -> KclError {
        KclError::ValueAlreadyDefined { details }
    }

    pub fn new_syntax(details: KclErrorDetails) -> KclError {
        KclError::Syntax { details }
    }

    pub fn new_io(details: KclErrorDetails) -> KclError {
        KclError::Io { details }
    }

    pub fn new_invalid_expression(details: KclErrorDetails) -> KclError {
        KclError::InvalidExpression { details }
    }

    pub fn refactor(message: String) -> KclError {
        KclError::Refactor {
            details: KclErrorDetails {
                source_ranges: Default::default(),
                backtrace: Default::default(),
                message,
            },
        }
    }

    pub fn new_engine(details: KclErrorDetails) -> KclError {
        if details.message.eq_ignore_ascii_case("internal error") {
            KclError::EngineInternal { details }
        } else if is_retryable_engine_message(&details.message) {
            KclError::EngineHangup {
                details,
                api_call_id: None,
            }
        } else {
            KclError::Engine { details }
        }
    }

    pub fn new_engine_hangup(details: KclErrorDetails, api_call_id: Option<String>) -> KclError {
        KclError::EngineHangup { details, api_call_id }
    }

    pub fn new_lexical(details: KclErrorDetails) -> KclError {
        KclError::Lexical { details }
    }

    pub fn new_undefined_value(details: KclErrorDetails, name: Option<String>) -> KclError {
        KclError::UndefinedValue { details, name }
    }

    pub fn new_type(details: KclErrorDetails) -> KclError {
        KclError::Type { details }
    }

    pub fn is_undefined_value(&self) -> bool {
        matches!(self, KclError::UndefinedValue { .. })
    }

    /// Get the error message.
    pub fn get_message(&self) -> String {
        format!("{}: {}", self.error_type(), self.message())
    }

    pub fn error_type(&self) -> &'static str {
        match self {
            KclError::Lexical { .. } => "lexical",
            KclError::Syntax { .. } => "syntax",
            KclError::Semantic { .. } => "semantic",
            KclError::ImportCycle { .. } => "import cycle",
            KclError::Argument { .. } => "argument",
            KclError::Type { .. } => "type",
            KclError::Io { .. } => "i/o",
            KclError::Unexpected { .. } => "unexpected",
            KclError::ValueAlreadyDefined { .. } => "value already defined",
            KclError::UndefinedValue { .. } => "undefined value",
            KclError::InvalidExpression { .. } => "invalid expression",
            KclError::MaxCallStack { .. } => "max call stack",
            KclError::Refactor { .. } => "refactor",
            KclError::Engine { .. } => "engine",
            KclError::EngineHangup { .. } => "engine hangup",
            KclError::EngineInternal { .. } => "engine internal",
            KclError::Internal { .. } => "internal",
        }
    }

    pub fn source_ranges(&self) -> Vec<SourceRange> {
        match &self {
            KclError::Lexical { details: e } => e.source_ranges.clone(),
            KclError::Syntax { details: e } => e.source_ranges.clone(),
            KclError::Semantic { details: e } => e.source_ranges.clone(),
            KclError::ImportCycle { details: e } => e.source_ranges.clone(),
            KclError::Argument { details: e } => e.source_ranges.clone(),
            KclError::Type { details: e } => e.source_ranges.clone(),
            KclError::Io { details: e } => e.source_ranges.clone(),
            KclError::Unexpected { details: e } => e.source_ranges.clone(),
            KclError::ValueAlreadyDefined { details: e } => e.source_ranges.clone(),
            KclError::UndefinedValue { details: e, .. } => e.source_ranges.clone(),
            KclError::InvalidExpression { details: e } => e.source_ranges.clone(),
            KclError::MaxCallStack { details: e } => e.source_ranges.clone(),
            KclError::Refactor { details: e } => e.source_ranges.clone(),
            KclError::Engine { details: e } => e.source_ranges.clone(),
            KclError::EngineHangup { details: e, .. } => e.source_ranges.clone(),
            KclError::EngineInternal { details: e } => e.source_ranges.clone(),
            KclError::Internal { details: e } => e.source_ranges.clone(),
        }
    }

    /// Get the inner error message.
    pub fn message(&self) -> &str {
        match &self {
            KclError::Lexical { details: e } => &e.message,
            KclError::Syntax { details: e } => &e.message,
            KclError::Semantic { details: e } => &e.message,
            KclError::ImportCycle { details: e } => &e.message,
            KclError::Argument { details: e } => &e.message,
            KclError::Type { details: e } => &e.message,
            KclError::Io { details: e } => &e.message,
            KclError::Unexpected { details: e } => &e.message,
            KclError::ValueAlreadyDefined { details: e } => &e.message,
            KclError::UndefinedValue { details: e, .. } => &e.message,
            KclError::InvalidExpression { details: e } => &e.message,
            KclError::MaxCallStack { details: e } => &e.message,
            KclError::Refactor { details: e } => &e.message,
            KclError::Engine { details: e } => &e.message,
            KclError::EngineHangup { details: e, .. } => &e.message,
            KclError::EngineInternal { details: e } => &e.message,
            KclError::Internal { details: e } => &e.message,
        }
    }

    pub fn backtrace(&self) -> Vec<BacktraceItem> {
        match self {
            KclError::Lexical { details: e }
            | KclError::Syntax { details: e }
            | KclError::Semantic { details: e }
            | KclError::ImportCycle { details: e }
            | KclError::Argument { details: e }
            | KclError::Type { details: e }
            | KclError::Io { details: e }
            | KclError::Unexpected { details: e }
            | KclError::ValueAlreadyDefined { details: e }
            | KclError::UndefinedValue { details: e, .. }
            | KclError::InvalidExpression { details: e }
            | KclError::MaxCallStack { details: e }
            | KclError::Refactor { details: e }
            | KclError::Engine { details: e }
            | KclError::EngineHangup { details: e, .. }
            | KclError::EngineInternal { details: e }
            | KclError::Internal { details: e } => e.backtrace.clone(),
        }
    }

    pub fn override_source_ranges(&self, source_ranges: Vec<SourceRange>) -> Self {
        let mut new = self.clone();
        match &mut new {
            KclError::Lexical { details: e }
            | KclError::Syntax { details: e }
            | KclError::Semantic { details: e }
            | KclError::ImportCycle { details: e }
            | KclError::Argument { details: e }
            | KclError::Type { details: e }
            | KclError::Io { details: e }
            | KclError::Unexpected { details: e }
            | KclError::ValueAlreadyDefined { details: e }
            | KclError::UndefinedValue { details: e, .. }
            | KclError::InvalidExpression { details: e }
            | KclError::MaxCallStack { details: e }
            | KclError::Refactor { details: e }
            | KclError::Engine { details: e }
            | KclError::EngineHangup { details: e, .. }
            | KclError::EngineInternal { details: e }
            | KclError::Internal { details: e } => {
                e.backtrace = source_ranges
                    .iter()
                    .map(|s| BacktraceItem {
                        source_range: *s,
                        fn_name: None,
                    })
                    .collect();
                e.source_ranges = source_ranges;
            }
        }

        new
    }

    pub fn add_unwind_location(&self, last_fn_name: Option<String>, source_range: SourceRange) -> Self {
        let mut new = self.clone();
        match &mut new {
            KclError::Lexical { details: e }
            | KclError::Syntax { details: e }
            | KclError::Semantic { details: e }
            | KclError::ImportCycle { details: e }
            | KclError::Argument { details: e }
            | KclError::Type { details: e }
            | KclError::Io { details: e }
            | KclError::Unexpected { details: e }
            | KclError::ValueAlreadyDefined { details: e }
            | KclError::UndefinedValue { details: e, .. }
            | KclError::InvalidExpression { details: e }
            | KclError::MaxCallStack { details: e }
            | KclError::Refactor { details: e }
            | KclError::Engine { details: e }
            | KclError::EngineHangup { details: e, .. }
            | KclError::EngineInternal { details: e }
            | KclError::Internal { details: e } => {
                if let Some(item) = e.backtrace.last_mut() {
                    item.fn_name = last_fn_name;
                }
                e.backtrace.push(BacktraceItem {
                    source_range,
                    fn_name: None,
                });
                e.source_ranges.push(source_range);
            }
        }

        new
    }
}

#[derive(
    Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ts_rs::TS, thiserror::Error, miette::Diagnostic, JsonSchema,
)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct BacktraceItem {
    pub source_range: SourceRange,
    pub fn_name: Option<String>,
}

impl std::fmt::Display for BacktraceItem {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        if let Some(fn_name) = &self.fn_name {
            write!(f, "{fn_name}: {:?}", self.source_range)
        } else {
            write!(f, "(fn): {:?}", self.source_range)
        }
    }
}

fn is_retryable_engine_message(message: &str) -> bool {
    // TODO: Replace string matching with structured engine/API retry metadata once it is available.
    let message = message.to_ascii_lowercase();
    RETRYABLE_ENGINE_MESSAGE_MARKER_SETS
        .iter()
        .any(|markers| markers.iter().all(|marker| message.contains(marker)))
}

/// This is different than to_string() in that it will serialize the Error
/// the struct as JSON so we can deserialize it on the js side.
impl From<KclError> for String {
    fn from(error: KclError) -> Self {
        serde_json::to_string(&error).unwrap()
    }
}

impl From<CompilationIssue> for KclErrorDetails {
    fn from(err: CompilationIssue) -> Self {
        let backtrace = vec![BacktraceItem {
            source_range: err.source_range,
            fn_name: None,
        }];
        KclErrorDetails {
            source_ranges: vec![err.source_range],
            backtrace,
            message: err.message,
        }
    }
}

#[cfg(feature = "pyo3")]
impl From<pyo3::PyErr> for KclError {
    fn from(error: pyo3::PyErr) -> Self {
        KclError::new_internal(KclErrorDetails {
            source_ranges: vec![],
            backtrace: Default::default(),
            message: error.to_string(),
        })
    }
}

#[cfg(feature = "pyo3")]
impl From<KclError> for pyo3::PyErr {
    fn from(error: KclError) -> Self {
        pyo3::exceptions::PyException::new_err(error.to_string())
    }
}
