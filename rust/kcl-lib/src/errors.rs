use indexmap::IndexMap;
use serde::{Deserialize, Serialize};
use thiserror::Error;
use tower_lsp::lsp_types::{Diagnostic, DiagnosticSeverity};

use crate::{
    execution::{ArtifactCommand, ArtifactGraph, Operation},
    lsp::IntoDiagnostic,
    modules::{ModulePath, ModuleSource},
    source_range::SourceRange,
    ModuleId,
};

/// How did the KCL execution fail
#[derive(thiserror::Error, Debug)]
pub enum ExecError {
    #[error("{0}")]
    Kcl(#[from] Box<crate::KclErrorWithOutputs>),
    #[error("Could not connect to engine: {0}")]
    Connection(#[from] ConnectionError),
    #[error("PNG snapshot could not be decoded: {0}")]
    BadPng(String),
}

impl From<KclErrorWithOutputs> for ExecError {
    fn from(error: KclErrorWithOutputs) -> Self {
        ExecError::Kcl(Box::new(error))
    }
}

/// How did the KCL execution fail, with extra state.
#[cfg_attr(target_arch = "wasm32", expect(dead_code))]
#[derive(Debug)]
pub struct ExecErrorWithState {
    pub error: ExecError,
    pub exec_state: Option<crate::execution::ExecState>,
}

impl ExecErrorWithState {
    #[cfg_attr(target_arch = "wasm32", expect(dead_code))]
    pub fn new(error: ExecError, exec_state: crate::execution::ExecState) -> Self {
        Self {
            error,
            exec_state: Some(exec_state),
        }
    }
}

impl From<ExecError> for ExecErrorWithState {
    fn from(error: ExecError) -> Self {
        Self {
            error,
            exec_state: None,
        }
    }
}

impl From<ConnectionError> for ExecErrorWithState {
    fn from(error: ConnectionError) -> Self {
        Self {
            error: error.into(),
            exec_state: None,
        }
    }
}

/// How did KCL client fail to connect to the engine
#[derive(thiserror::Error, Debug)]
pub enum ConnectionError {
    #[error("Could not create a Zoo client: {0}")]
    CouldNotMakeClient(anyhow::Error),
    #[error("Could not establish connection to engine: {0}")]
    Establishing(anyhow::Error),
}

#[derive(Error, Debug, Serialize, Deserialize, ts_rs::TS, Clone, PartialEq, Eq)]
#[ts(export)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum KclError {
    #[error("lexical: {0:?}")]
    Lexical(KclErrorDetails),
    #[error("syntax: {0:?}")]
    Syntax(KclErrorDetails),
    #[error("semantic: {0:?}")]
    Semantic(KclErrorDetails),
    #[error("import cycle: {0:?}")]
    ImportCycle(KclErrorDetails),
    #[error("type: {0:?}")]
    Type(KclErrorDetails),
    #[error("i/o: {0:?}")]
    Io(KclErrorDetails),
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

impl From<KclErrorWithOutputs> for KclError {
    fn from(error: KclErrorWithOutputs) -> Self {
        error.error
    }
}

#[derive(Error, Debug, Serialize, Deserialize, ts_rs::TS, Clone, PartialEq)]
#[error("{error}")]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct KclErrorWithOutputs {
    pub error: KclError,
    pub operations: Vec<Operation>,
    pub artifact_commands: Vec<ArtifactCommand>,
    pub artifact_graph: ArtifactGraph,
    pub filenames: IndexMap<ModuleId, ModulePath>,
    pub source_files: IndexMap<ModuleId, ModuleSource>,
}

impl KclErrorWithOutputs {
    pub fn new(
        error: KclError,
        operations: Vec<Operation>,
        artifact_commands: Vec<ArtifactCommand>,
        artifact_graph: ArtifactGraph,
        filenames: IndexMap<ModuleId, ModulePath>,
        source_files: IndexMap<ModuleId, ModuleSource>,
    ) -> Self {
        Self {
            error,
            operations,
            artifact_commands,
            artifact_graph,
            filenames,
            source_files,
        }
    }
    pub fn no_outputs(error: KclError) -> Self {
        Self {
            error,
            operations: Default::default(),
            artifact_commands: Default::default(),
            artifact_graph: Default::default(),
            filenames: Default::default(),
            source_files: Default::default(),
        }
    }
    pub fn into_miette_report_with_outputs(self) -> anyhow::Result<ReportWithOutputs> {
        let mut source_ranges = self.error.source_ranges();

        // Pop off the first source range to get the filename.
        let first_source_range = source_ranges
            .pop()
            .ok_or_else(|| anyhow::anyhow!("No source ranges found"))?;

        let source = self
            .source_files
            .get(&first_source_range.module_id())
            .cloned()
            .ok_or_else(|| {
                anyhow::anyhow!(
                    "Could not find source file for module id: {:?}",
                    first_source_range.module_id()
                )
            })?;
        let filename = source.path.to_string();
        let kcl_source = source.source.to_string();

        let mut related = Vec::new();
        for source_range in source_ranges {
            let module_id = source_range.module_id();
            let source = self
                .source_files
                .get(&module_id)
                .cloned()
                .ok_or_else(|| anyhow::anyhow!("Could not find source file for module id: {:?}", module_id))?;
            let error = self.error.override_source_ranges(vec![source_range]);
            let report = Report {
                error,
                kcl_source: source.source.to_string(),
                filename: source.path.to_string(),
            };
            related.push(report);
        }

        Ok(ReportWithOutputs {
            error: self,
            kcl_source,
            filename,
            related,
        })
    }
}

impl IntoDiagnostic for KclErrorWithOutputs {
    fn to_lsp_diagnostics(&self, code: &str) -> Vec<Diagnostic> {
        let message = self.error.get_message();
        let source_ranges = self.error.source_ranges();

        source_ranges
            .into_iter()
            .map(|source_range| {
                let source = self
                    .source_files
                    .get(&source_range.module_id())
                    .cloned()
                    .unwrap_or(ModuleSource {
                        source: code.to_string(),
                        path: self.filenames.get(&source_range.module_id()).unwrap().clone(),
                    });
                let mut filename = source.path.to_string();
                if !filename.starts_with("file://") {
                    filename = format!("file:///{}", filename.trim_start_matches("/"));
                }

                let related_information = if let Ok(uri) = url::Url::parse(&filename) {
                    Some(vec![tower_lsp::lsp_types::DiagnosticRelatedInformation {
                        location: tower_lsp::lsp_types::Location {
                            uri,
                            range: source_range.to_lsp_range(&source.source),
                        },
                        message: message.to_string(),
                    }])
                } else {
                    None
                };

                Diagnostic {
                    range: source_range.to_lsp_range(code),
                    severity: Some(self.severity()),
                    code: None,
                    // TODO: this is neat we can pass a URL to a help page here for this specific error.
                    code_description: None,
                    source: Some("kcl".to_string()),
                    related_information,
                    message: message.clone(),
                    tags: None,
                    data: None,
                }
            })
            .collect()
    }

    fn severity(&self) -> DiagnosticSeverity {
        DiagnosticSeverity::ERROR
    }
}

#[derive(thiserror::Error, Debug)]
#[error("{}", self.error.error.get_message())]
pub struct ReportWithOutputs {
    pub error: KclErrorWithOutputs,
    pub kcl_source: String,
    pub filename: String,
    pub related: Vec<Report>,
}

impl miette::Diagnostic for ReportWithOutputs {
    fn code<'a>(&'a self) -> Option<Box<dyn std::fmt::Display + 'a>> {
        let family = match self.error.error {
            KclError::Lexical(_) => "Lexical",
            KclError::Syntax(_) => "Syntax",
            KclError::Semantic(_) => "Semantic",
            KclError::ImportCycle(_) => "ImportCycle",
            KclError::Type(_) => "Type",
            KclError::Io(_) => "I/O",
            KclError::Unexpected(_) => "Unexpected",
            KclError::ValueAlreadyDefined(_) => "ValueAlreadyDefined",
            KclError::UndefinedValue(_) => "UndefinedValue",
            KclError::InvalidExpression(_) => "InvalidExpression",
            KclError::Engine(_) => "Engine",
            KclError::Internal(_) => "Internal",
        };
        let error_string = format!("KCL {family} error");
        Some(Box::new(error_string))
    }

    fn source_code(&self) -> Option<&dyn miette::SourceCode> {
        Some(&self.kcl_source)
    }

    fn labels(&self) -> Option<Box<dyn Iterator<Item = miette::LabeledSpan> + '_>> {
        let iter = self
            .error
            .error
            .source_ranges()
            .clone()
            .into_iter()
            .map(miette::SourceSpan::from)
            .map(|span| miette::LabeledSpan::new_with_span(Some(self.filename.to_string()), span));
        Some(Box::new(iter))
    }

    fn related<'a>(&'a self) -> Option<Box<dyn Iterator<Item = &'a dyn miette::Diagnostic> + 'a>> {
        let iter = self.related.iter().map(|r| r as &dyn miette::Diagnostic);
        Some(Box::new(iter))
    }
}

#[derive(thiserror::Error, Debug)]
#[error("{}", self.error.get_message())]
pub struct Report {
    pub error: KclError,
    pub kcl_source: String,
    pub filename: String,
}

impl miette::Diagnostic for Report {
    fn code<'a>(&'a self) -> Option<Box<dyn std::fmt::Display + 'a>> {
        let family = match self.error {
            KclError::Lexical(_) => "Lexical",
            KclError::Syntax(_) => "Syntax",
            KclError::Semantic(_) => "Semantic",
            KclError::ImportCycle(_) => "ImportCycle",
            KclError::Type(_) => "Type",
            KclError::Io(_) => "I/O",
            KclError::Unexpected(_) => "Unexpected",
            KclError::ValueAlreadyDefined(_) => "ValueAlreadyDefined",
            KclError::UndefinedValue(_) => "UndefinedValue",
            KclError::InvalidExpression(_) => "InvalidExpression",
            KclError::Engine(_) => "Engine",
            KclError::Internal(_) => "Internal",
        };
        let error_string = format!("KCL {family} error");
        Some(Box::new(error_string))
    }

    fn source_code(&self) -> Option<&dyn miette::SourceCode> {
        Some(&self.kcl_source)
    }

    fn labels(&self) -> Option<Box<dyn Iterator<Item = miette::LabeledSpan> + '_>> {
        let iter = self
            .error
            .source_ranges()
            .clone()
            .into_iter()
            .map(miette::SourceSpan::from)
            .map(|span| miette::LabeledSpan::new_with_span(Some(self.filename.to_string()), span));
        Some(Box::new(iter))
    }
}

#[derive(Debug, Serialize, Deserialize, ts_rs::TS, Clone, PartialEq, Eq, thiserror::Error, miette::Diagnostic)]
#[error("{message}")]
#[ts(export)]
pub struct KclErrorDetails {
    #[serde(rename = "sourceRanges")]
    #[label(collection, "Errors")]
    pub source_ranges: Vec<SourceRange>,
    #[serde(rename = "msg")]
    pub message: String,
}

impl KclError {
    pub fn internal(message: String) -> KclError {
        KclError::Internal(KclErrorDetails {
            source_ranges: Default::default(),
            message,
        })
    }

    /// Get the error message.
    pub fn get_message(&self) -> String {
        format!("{}: {}", self.error_type(), self.message())
    }

    pub fn error_type(&self) -> &'static str {
        match self {
            KclError::Lexical(_) => "lexical",
            KclError::Syntax(_) => "syntax",
            KclError::Semantic(_) => "semantic",
            KclError::ImportCycle(_) => "import cycle",
            KclError::Type(_) => "type",
            KclError::Io(_) => "i/o",
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
            KclError::ImportCycle(e) => e.source_ranges.clone(),
            KclError::Type(e) => e.source_ranges.clone(),
            KclError::Io(e) => e.source_ranges.clone(),
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
            KclError::ImportCycle(e) => &e.message,
            KclError::Type(e) => &e.message,
            KclError::Io(e) => &e.message,
            KclError::Unexpected(e) => &e.message,
            KclError::ValueAlreadyDefined(e) => &e.message,
            KclError::UndefinedValue(e) => &e.message,
            KclError::InvalidExpression(e) => &e.message,
            KclError::Engine(e) => &e.message,
            KclError::Internal(e) => &e.message,
        }
    }

    pub(crate) fn override_source_ranges(&self, source_ranges: Vec<SourceRange>) -> Self {
        let mut new = self.clone();
        match &mut new {
            KclError::Lexical(e) => e.source_ranges = source_ranges,
            KclError::Syntax(e) => e.source_ranges = source_ranges,
            KclError::Semantic(e) => e.source_ranges = source_ranges,
            KclError::ImportCycle(e) => e.source_ranges = source_ranges,
            KclError::Type(e) => e.source_ranges = source_ranges,
            KclError::Io(e) => e.source_ranges = source_ranges,
            KclError::Unexpected(e) => e.source_ranges = source_ranges,
            KclError::ValueAlreadyDefined(e) => e.source_ranges = source_ranges,
            KclError::UndefinedValue(e) => e.source_ranges = source_ranges,
            KclError::InvalidExpression(e) => e.source_ranges = source_ranges,
            KclError::Engine(e) => e.source_ranges = source_ranges,
            KclError::Internal(e) => e.source_ranges = source_ranges,
        }

        new
    }

    pub(crate) fn add_source_ranges(&self, source_ranges: Vec<SourceRange>) -> Self {
        let mut new = self.clone();
        match &mut new {
            KclError::Lexical(e) => e.source_ranges.extend(source_ranges),
            KclError::Syntax(e) => e.source_ranges.extend(source_ranges),
            KclError::Semantic(e) => e.source_ranges.extend(source_ranges),
            KclError::ImportCycle(e) => e.source_ranges.extend(source_ranges),
            KclError::Type(e) => e.source_ranges.extend(source_ranges),
            KclError::Io(e) => e.source_ranges.extend(source_ranges),
            KclError::Unexpected(e) => e.source_ranges.extend(source_ranges),
            KclError::ValueAlreadyDefined(e) => e.source_ranges.extend(source_ranges),
            KclError::UndefinedValue(e) => e.source_ranges.extend(source_ranges),
            KclError::InvalidExpression(e) => e.source_ranges.extend(source_ranges),
            KclError::Engine(e) => e.source_ranges.extend(source_ranges),
            KclError::Internal(e) => e.source_ranges.extend(source_ranges),
        }

        new
    }
}

impl IntoDiagnostic for KclError {
    fn to_lsp_diagnostics(&self, code: &str) -> Vec<Diagnostic> {
        let message = self.get_message();
        let source_ranges = self.source_ranges();

        // Limit to only errors in the top-level file.
        let module_id = ModuleId::default();
        let source_ranges = source_ranges
            .iter()
            .filter(|r| r.module_id() == module_id)
            .collect::<Vec<_>>();

        let mut diagnostics = Vec::new();
        for source_range in &source_ranges {
            diagnostics.push(Diagnostic {
                range: source_range.to_lsp_range(code),
                severity: Some(self.severity()),
                code: None,
                // TODO: this is neat we can pass a URL to a help page here for this specific error.
                code_description: None,
                source: Some("kcl".to_string()),
                related_information: None,
                message: message.clone(),
                tags: None,
                data: None,
            });
        }

        diagnostics
    }

    fn severity(&self) -> DiagnosticSeverity {
        DiagnosticSeverity::ERROR
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

#[cfg(feature = "pyo3")]
impl From<pyo3::PyErr> for KclError {
    fn from(error: pyo3::PyErr) -> Self {
        KclError::Internal(KclErrorDetails {
            source_ranges: vec![],
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

/// An error which occurred during parsing, etc.
#[derive(Debug, Clone, Serialize, Deserialize, ts_rs::TS)]
#[ts(export)]
pub struct CompilationError {
    #[serde(rename = "sourceRange")]
    pub source_range: SourceRange,
    pub message: String,
    pub suggestion: Option<Suggestion>,
    pub severity: Severity,
    pub tag: Tag,
}

impl CompilationError {
    pub(crate) fn err(source_range: SourceRange, message: impl ToString) -> CompilationError {
        CompilationError {
            source_range,
            message: message.to_string(),
            suggestion: None,
            severity: Severity::Error,
            tag: Tag::None,
        }
    }

    pub(crate) fn fatal(source_range: SourceRange, message: impl ToString) -> CompilationError {
        CompilationError {
            source_range,
            message: message.to_string(),
            suggestion: None,
            severity: Severity::Fatal,
            tag: Tag::None,
        }
    }

    pub(crate) fn with_suggestion(
        self,
        suggestion_title: impl ToString,
        suggestion_insert: impl ToString,
        // Will use the error source range if none is supplied
        source_range: Option<SourceRange>,
        tag: Tag,
    ) -> CompilationError {
        CompilationError {
            suggestion: Some(Suggestion {
                title: suggestion_title.to_string(),
                insert: suggestion_insert.to_string(),
                source_range: source_range.unwrap_or(self.source_range),
            }),
            tag,
            ..self
        }
    }

    #[cfg(test)]
    pub fn apply_suggestion(&self, src: &str) -> Option<String> {
        let suggestion = self.suggestion.as_ref()?;
        Some(format!(
            "{}{}{}",
            &src[0..suggestion.source_range.start()],
            suggestion.insert,
            &src[suggestion.source_range.end()..]
        ))
    }
}

impl From<CompilationError> for KclErrorDetails {
    fn from(err: CompilationError) -> Self {
        KclErrorDetails {
            source_ranges: vec![err.source_range],
            message: err.message,
        }
    }
}

#[derive(Debug, Copy, Clone, Eq, PartialEq, Serialize, Deserialize, ts_rs::TS)]
#[ts(export)]
pub enum Severity {
    Warning,
    Error,
    Fatal,
}

impl Severity {
    pub fn is_err(self) -> bool {
        match self {
            Severity::Warning => false,
            Severity::Error | Severity::Fatal => true,
        }
    }
}

#[derive(Debug, Copy, Clone, Eq, PartialEq, Serialize, Deserialize, ts_rs::TS)]
#[ts(export)]
pub enum Tag {
    Deprecated,
    Unnecessary,
    None,
}

#[derive(Debug, Clone, Serialize, Deserialize, ts_rs::TS)]
#[ts(export)]
pub struct Suggestion {
    pub title: String,
    pub insert: String,
    pub source_range: SourceRange,
}
