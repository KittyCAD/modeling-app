use indexmap::IndexMap;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use thiserror::Error;
use tower_lsp::lsp_types::{Diagnostic, DiagnosticSeverity};

#[cfg(feature = "artifact-graph")]
use crate::execution::{ArtifactCommand, ArtifactGraph, Operation};
use crate::{
    ModuleId,
    execution::DefaultPlanes,
    lsp::IntoDiagnostic,
    modules::{ModulePath, ModuleSource},
    source_range::SourceRange,
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
    #[error("Bad export: {0}")]
    BadExport(String),
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

impl ExecError {
    pub fn as_kcl_error(&self) -> Option<&crate::KclError> {
        let ExecError::Kcl(k) = &self else {
            return None;
        };
        Some(&k.error)
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
    #[error("lexical: {details:?}")]
    Lexical { details: KclErrorDetails },
    #[error("syntax: {details:?}")]
    Syntax { details: KclErrorDetails },
    #[error("semantic: {details:?}")]
    Semantic { details: KclErrorDetails },
    #[error("import cycle: {details:?}")]
    ImportCycle { details: KclErrorDetails },
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
    #[error("engine: {details:?}")]
    Engine { details: KclErrorDetails },
    #[error("internal error, please report to KittyCAD team: {details:?}")]
    Internal { details: KclErrorDetails },
}

impl From<KclErrorWithOutputs> for KclError {
    fn from(error: KclErrorWithOutputs) -> Self {
        error.error
    }
}

#[derive(Error, Debug, Serialize, ts_rs::TS, Clone, PartialEq)]
#[error("{error}")]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct KclErrorWithOutputs {
    pub error: KclError,
    pub non_fatal: Vec<CompilationError>,
    #[cfg(feature = "artifact-graph")]
    pub operations: Vec<Operation>,
    // TODO: Remove this field.  Doing so breaks the ts-rs output for some
    // reason.
    #[cfg(feature = "artifact-graph")]
    pub _artifact_commands: Vec<ArtifactCommand>,
    #[cfg(feature = "artifact-graph")]
    pub artifact_graph: ArtifactGraph,
    pub filenames: IndexMap<ModuleId, ModulePath>,
    pub source_files: IndexMap<ModuleId, ModuleSource>,
    pub default_planes: Option<DefaultPlanes>,
}

impl KclErrorWithOutputs {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        error: KclError,
        non_fatal: Vec<CompilationError>,
        #[cfg(feature = "artifact-graph")] operations: Vec<Operation>,
        #[cfg(feature = "artifact-graph")] artifact_commands: Vec<ArtifactCommand>,
        #[cfg(feature = "artifact-graph")] artifact_graph: ArtifactGraph,
        filenames: IndexMap<ModuleId, ModulePath>,
        source_files: IndexMap<ModuleId, ModuleSource>,
        default_planes: Option<DefaultPlanes>,
    ) -> Self {
        Self {
            error,
            non_fatal,
            #[cfg(feature = "artifact-graph")]
            operations,
            #[cfg(feature = "artifact-graph")]
            _artifact_commands: artifact_commands,
            #[cfg(feature = "artifact-graph")]
            artifact_graph,
            filenames,
            source_files,
            default_planes,
        }
    }
    pub fn no_outputs(error: KclError) -> Self {
        Self {
            error,
            non_fatal: Default::default(),
            #[cfg(feature = "artifact-graph")]
            operations: Default::default(),
            #[cfg(feature = "artifact-graph")]
            _artifact_commands: Default::default(),
            #[cfg(feature = "artifact-graph")]
            artifact_graph: Default::default(),
            filenames: Default::default(),
            source_files: Default::default(),
            default_planes: Default::default(),
        }
    }
    pub fn into_miette_report_with_outputs(self, code: &str) -> anyhow::Result<ReportWithOutputs> {
        let mut source_ranges = self.error.source_ranges();

        // Pop off the first source range to get the filename.
        let first_source_range = source_ranges
            .pop()
            .ok_or_else(|| anyhow::anyhow!("No source ranges found"))?;

        let source = self
            .source_files
            .get(&first_source_range.module_id())
            .cloned()
            .unwrap_or(ModuleSource {
                source: code.to_string(),
                path: self
                    .filenames
                    .get(&first_source_range.module_id())
                    .cloned()
                    .unwrap_or(ModulePath::Main),
            });
        let filename = source.path.to_string();
        let kcl_source = source.source.to_string();

        let mut related = Vec::new();
        for source_range in source_ranges {
            let module_id = source_range.module_id();
            let source = self.source_files.get(&module_id).cloned().unwrap_or(ModuleSource {
                source: code.to_string(),
                path: self.filenames.get(&module_id).cloned().unwrap_or(ModulePath::Main),
            });
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
            KclError::Lexical { .. } => "Lexical",
            KclError::Syntax { .. } => "Syntax",
            KclError::Semantic { .. } => "Semantic",
            KclError::ImportCycle { .. } => "ImportCycle",
            KclError::Type { .. } => "Type",
            KclError::Io { .. } => "I/O",
            KclError::Unexpected { .. } => "Unexpected",
            KclError::ValueAlreadyDefined { .. } => "ValueAlreadyDefined",
            KclError::UndefinedValue { .. } => "UndefinedValue",
            KclError::InvalidExpression { .. } => "InvalidExpression",
            KclError::Engine { .. } => "Engine",
            KclError::Internal { .. } => "Internal",
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
            KclError::Lexical { .. } => "Lexical",
            KclError::Syntax { .. } => "Syntax",
            KclError::Semantic { .. } => "Semantic",
            KclError::ImportCycle { .. } => "ImportCycle",
            KclError::Type { .. } => "Type",
            KclError::Io { .. } => "I/O",
            KclError::Unexpected { .. } => "Unexpected",
            KclError::ValueAlreadyDefined { .. } => "ValueAlreadyDefined",
            KclError::UndefinedValue { .. } => "UndefinedValue",
            KclError::InvalidExpression { .. } => "InvalidExpression",
            KclError::Engine { .. } => "Engine",
            KclError::Internal { .. } => "Internal",
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

    pub fn new_engine(details: KclErrorDetails) -> KclError {
        KclError::Engine { details }
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
            KclError::Type { .. } => "type",
            KclError::Io { .. } => "i/o",
            KclError::Unexpected { .. } => "unexpected",
            KclError::ValueAlreadyDefined { .. } => "value already defined",
            KclError::UndefinedValue { .. } => "undefined value",
            KclError::InvalidExpression { .. } => "invalid expression",
            KclError::Engine { .. } => "engine",
            KclError::Internal { .. } => "internal",
        }
    }

    pub fn source_ranges(&self) -> Vec<SourceRange> {
        match &self {
            KclError::Lexical { details: e } => e.source_ranges.clone(),
            KclError::Syntax { details: e } => e.source_ranges.clone(),
            KclError::Semantic { details: e } => e.source_ranges.clone(),
            KclError::ImportCycle { details: e } => e.source_ranges.clone(),
            KclError::Type { details: e } => e.source_ranges.clone(),
            KclError::Io { details: e } => e.source_ranges.clone(),
            KclError::Unexpected { details: e } => e.source_ranges.clone(),
            KclError::ValueAlreadyDefined { details: e } => e.source_ranges.clone(),
            KclError::UndefinedValue { details: e, .. } => e.source_ranges.clone(),
            KclError::InvalidExpression { details: e } => e.source_ranges.clone(),
            KclError::Engine { details: e } => e.source_ranges.clone(),
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
            KclError::Type { details: e } => &e.message,
            KclError::Io { details: e } => &e.message,
            KclError::Unexpected { details: e } => &e.message,
            KclError::ValueAlreadyDefined { details: e } => &e.message,
            KclError::UndefinedValue { details: e, .. } => &e.message,
            KclError::InvalidExpression { details: e } => &e.message,
            KclError::Engine { details: e } => &e.message,
            KclError::Internal { details: e } => &e.message,
        }
    }

    pub fn backtrace(&self) -> Vec<BacktraceItem> {
        match self {
            KclError::Lexical { details: e }
            | KclError::Syntax { details: e }
            | KclError::Semantic { details: e }
            | KclError::ImportCycle { details: e }
            | KclError::Type { details: e }
            | KclError::Io { details: e }
            | KclError::Unexpected { details: e }
            | KclError::ValueAlreadyDefined { details: e }
            | KclError::UndefinedValue { details: e, .. }
            | KclError::InvalidExpression { details: e }
            | KclError::Engine { details: e }
            | KclError::Internal { details: e } => e.backtrace.clone(),
        }
    }

    pub(crate) fn override_source_ranges(&self, source_ranges: Vec<SourceRange>) -> Self {
        let mut new = self.clone();
        match &mut new {
            KclError::Lexical { details: e }
            | KclError::Syntax { details: e }
            | KclError::Semantic { details: e }
            | KclError::ImportCycle { details: e }
            | KclError::Type { details: e }
            | KclError::Io { details: e }
            | KclError::Unexpected { details: e }
            | KclError::ValueAlreadyDefined { details: e }
            | KclError::UndefinedValue { details: e, .. }
            | KclError::InvalidExpression { details: e }
            | KclError::Engine { details: e }
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

    pub(crate) fn add_unwind_location(&self, last_fn_name: Option<String>, source_range: SourceRange) -> Self {
        let mut new = self.clone();
        match &mut new {
            KclError::Lexical { details: e }
            | KclError::Syntax { details: e }
            | KclError::Semantic { details: e }
            | KclError::ImportCycle { details: e }
            | KclError::Type { details: e }
            | KclError::Io { details: e }
            | KclError::Unexpected { details: e }
            | KclError::ValueAlreadyDefined { details: e }
            | KclError::UndefinedValue { details: e, .. }
            | KclError::InvalidExpression { details: e }
            | KclError::Engine { details: e }
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

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ts_rs::TS, thiserror::Error, miette::Diagnostic)]
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

/// An error which occurred during parsing, etc.
#[derive(Debug, Clone, Serialize, Deserialize, ts_rs::TS, PartialEq, Eq)]
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
    UnknownNumericUnits,
    None,
}

#[derive(Debug, Clone, Serialize, Deserialize, ts_rs::TS, PartialEq, Eq, JsonSchema)]
#[ts(export)]
pub struct Suggestion {
    pub title: String,
    pub insert: String,
    pub source_range: SourceRange,
}

pub type LspSuggestion = (Suggestion, tower_lsp::lsp_types::Range);

impl Suggestion {
    pub fn to_lsp_edit(&self, code: &str) -> LspSuggestion {
        let range = self.source_range.to_lsp_range(code);
        (self.clone(), range)
    }
}
