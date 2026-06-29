use std::collections::BTreeMap;

use indexmap::IndexMap;
use kcl_api::NodePath;
pub use kcl_error::BacktraceItem;
pub use kcl_error::CompilationIssue;
pub use kcl_error::IsRetryable;
pub use kcl_error::KclError;
pub use kcl_error::KclErrorDetails;
pub use kcl_error::Severity;
pub use kcl_error::Suggestion;
pub use kcl_error::Tag;
use serde::Serialize;
use thiserror::Error;
use tower_lsp::lsp_types::Diagnostic;
use tower_lsp::lsp_types::DiagnosticSeverity;
use uuid::Uuid;

use crate::ExecOutcome;
use crate::ModuleId;
use crate::SourceRange;
use crate::exec::KclValue;
use crate::execution::ArtifactCommand;
use crate::execution::ArtifactGraph;
use crate::execution::DefaultPlanes;
use crate::execution::KclValueView;
use crate::execution::OperationsByModule;
use crate::front::Number;
use crate::front::Object;
use crate::front::ObjectId;
use crate::lsp::IntoDiagnostic;
use crate::lsp::ToLspRange;
use crate::modules::ModulePath;
use crate::modules::ModuleSource;

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
#[derive(Debug, thiserror::Error)]
#[error("{error}")]
pub struct ExecErrorWithState {
    pub error: ExecError,
    pub exec_state: Option<crate::execution::ExecState>,
    #[cfg(feature = "snapshot-engine-responses")]
    pub responses: Option<IndexMap<Uuid, kittycad_modeling_cmds::websocket::WebSocketResponse>>,
}

impl ExecErrorWithState {
    #[cfg_attr(target_arch = "wasm32", expect(dead_code))]
    pub fn new(
        error: ExecError,
        exec_state: crate::execution::ExecState,
        #[cfg_attr(not(feature = "snapshot-engine-responses"), expect(unused_variables))] responses: Option<
            IndexMap<Uuid, kittycad_modeling_cmds::websocket::WebSocketResponse>,
        >,
    ) -> Self {
        Self {
            error,
            exec_state: Some(exec_state),
            #[cfg(feature = "snapshot-engine-responses")]
            responses,
        }
    }
}

impl IsRetryable for ExecErrorWithState {
    fn is_retryable(&self) -> bool {
        self.error.is_retryable()
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

impl IsRetryable for ExecError {
    fn is_retryable(&self) -> bool {
        matches!(self, ExecError::Kcl(kcl_error) if kcl_error.is_retryable())
    }
}

impl From<ExecError> for ExecErrorWithState {
    fn from(error: ExecError) -> Self {
        Self {
            error,
            exec_state: None,
            #[cfg(feature = "snapshot-engine-responses")]
            responses: None,
        }
    }
}

impl From<ConnectionError> for ExecErrorWithState {
    fn from(error: ConnectionError) -> Self {
        Self {
            error: error.into(),
            exec_state: None,
            #[cfg(feature = "snapshot-engine-responses")]
            responses: None,
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
    pub non_fatal: Vec<CompilationIssue>,
    /// Variables in the top-level of the root module. Note that functions will
    /// have an invalid env ref.
    pub variables: IndexMap<String, KclValueView>,
    pub operations: OperationsByModule,
    // TODO: Remove this field.  Doing so breaks the ts-rs output for some
    // reason.
    pub _artifact_commands: Vec<ArtifactCommand>,
    pub artifact_graph: ArtifactGraph,
    #[serde(skip)]
    pub scene_objects: Vec<Object>,
    #[serde(skip)]
    pub source_range_to_object: BTreeMap<SourceRange, ObjectId>,
    #[serde(skip)]
    pub var_solutions: Vec<(SourceRange, Option<NodePath>, Number)>,
    pub scene_graph: Option<crate::front::SceneGraph>,
    pub filenames: IndexMap<ModuleId, ModulePath>,
    pub source_files: IndexMap<ModuleId, ModuleSource>,
    pub default_planes: Option<DefaultPlanes>,
}

impl KclErrorWithOutputs {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        error: KclError,
        non_fatal: Vec<CompilationIssue>,
        variables: IndexMap<String, KclValue>,
        operations: OperationsByModule,
        artifact_commands: Vec<ArtifactCommand>,
        artifact_graph: ArtifactGraph,
        scene_objects: Vec<Object>,
        source_range_to_object: BTreeMap<SourceRange, ObjectId>,
        var_solutions: Vec<(SourceRange, Option<NodePath>, Number)>,
        filenames: IndexMap<ModuleId, ModulePath>,
        source_files: IndexMap<ModuleId, ModuleSource>,
        default_planes: Option<DefaultPlanes>,
    ) -> Self {
        let variables_view = variables.into_iter().map(|(k, v)| (k, v.into())).collect();
        Self {
            error,
            non_fatal,
            variables: variables_view,
            operations,
            _artifact_commands: artifact_commands,
            artifact_graph,
            scene_objects,
            source_range_to_object,
            var_solutions,
            scene_graph: Default::default(),
            filenames,
            source_files,
            default_planes,
        }
    }

    pub fn no_outputs(error: KclError) -> Self {
        Self {
            error,
            non_fatal: Default::default(),
            variables: Default::default(),
            operations: Default::default(),
            _artifact_commands: Default::default(),
            artifact_graph: Default::default(),
            scene_objects: Default::default(),
            source_range_to_object: Default::default(),
            var_solutions: Default::default(),
            scene_graph: Default::default(),
            filenames: Default::default(),
            source_files: Default::default(),
            default_planes: Default::default(),
        }
    }

    /// This is for when the error is generated after a successful execution.
    pub fn from_error_outcome(error: KclError, outcome: ExecOutcome) -> Self {
        KclErrorWithOutputs {
            error,
            non_fatal: outcome.issues,
            variables: outcome.variables,
            operations: outcome.operations,
            _artifact_commands: Default::default(),
            artifact_graph: outcome.artifact_graph,
            scene_objects: outcome.scene_objects,
            source_range_to_object: outcome.source_range_to_object,
            var_solutions: outcome.var_solutions,
            scene_graph: Default::default(),
            filenames: outcome.filenames,
            source_files: Default::default(),
            default_planes: outcome.default_planes,
        }
    }

    pub fn sketch_constraint_report(&self) -> crate::SketchConstraintReport {
        crate::execution::sketch_constraint_report_from_scene_objects(&self.scene_objects)
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
        let kcl_source = source.source;

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

impl IsRetryable for KclErrorWithOutputs {
    fn is_retryable(&self) -> bool {
        matches!(
            self.error,
            KclError::EngineHangup { .. } | KclError::EngineInternal { .. }
        )
    }
}

impl IntoDiagnostic for KclErrorWithOutputs {
    fn to_lsp_diagnostics(&self, code: &str) -> Vec<Diagnostic> {
        let message = self.error.get_message();
        let source_ranges = self.error.source_ranges();

        source_ranges
            .into_iter()
            .map(|source_range| {
                let source = self.source_files.get(&source_range.module_id()).cloned().or_else(|| {
                    self.filenames
                        .get(&source_range.module_id())
                        .cloned()
                        .map(|path| ModuleSource {
                            source: code.to_string(),
                            path,
                        })
                });

                let related_information = source.and_then(|source| {
                    let mut filename = source.path.to_string();
                    if !filename.starts_with("file://") {
                        filename = format!("file:///{}", filename.trim_start_matches("/"));
                    }

                    url::Url::parse(&filename).ok().map(|uri| {
                        vec![tower_lsp::lsp_types::DiagnosticRelatedInformation {
                            location: tower_lsp::lsp_types::Location {
                                uri,
                                range: source_range.to_lsp_range(&source.source),
                            },
                            message: message.to_string(),
                        }]
                    })
                });

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
            KclError::Argument { .. } => "Argument",
            KclError::Type { .. } => "Type",
            KclError::Io { .. } => "I/O",
            KclError::Unexpected { .. } => "Unexpected",
            KclError::ValueAlreadyDefined { .. } => "ValueAlreadyDefined",
            KclError::UndefinedValue { .. } => "UndefinedValue",
            KclError::InvalidExpression { .. } => "InvalidExpression",
            KclError::MaxCallStack { .. } => "MaxCallStack",
            KclError::Refactor { .. } => "Refactor",
            KclError::Engine { .. } => "Engine",
            KclError::EngineHangup { .. } => "EngineHangup",
            KclError::EngineInternal { .. } => "EngineInternal",
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
            KclError::Argument { .. } => "Argument",
            KclError::Type { .. } => "Type",
            KclError::Io { .. } => "I/O",
            KclError::Unexpected { .. } => "Unexpected",
            KclError::ValueAlreadyDefined { .. } => "ValueAlreadyDefined",
            KclError::UndefinedValue { .. } => "UndefinedValue",
            KclError::InvalidExpression { .. } => "InvalidExpression",
            KclError::MaxCallStack { .. } => "MaxCallStack",
            KclError::Refactor { .. } => "Refactor",
            KclError::Engine { .. } => "Engine",
            KclError::EngineHangup { .. } => "EngineHangup",
            KclError::EngineInternal { .. } => "EngineInternal",
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
            .into_iter()
            .map(miette::SourceSpan::from)
            .map(|span| miette::LabeledSpan::new_with_span(Some(self.filename.to_string()), span));
        Some(Box::new(iter))
    }
}

#[derive(thiserror::Error, Debug)]
#[error("{}", self.issue.message)]
pub struct CompilationIssueReport {
    pub issue: CompilationIssue,
    pub kcl_source: String,
    pub filename: String,
}

impl miette::Diagnostic for CompilationIssueReport {
    fn code<'a>(&'a self) -> Option<Box<dyn std::fmt::Display + 'a>> {
        let tag = match self.issue.tag {
            Tag::Deprecated => "deprecated",
            Tag::Unnecessary => "unnecessary",
            Tag::UnknownNumericUnits => "unknown-numeric-units",
            Tag::None => return None,
        };
        Some(Box::new(format!("KCL {tag}")))
    }

    fn severity(&self) -> Option<miette::Severity> {
        Some(match self.issue.severity {
            Severity::Warning => miette::Severity::Warning,
            Severity::Error | Severity::Fatal => miette::Severity::Error,
        })
    }

    fn help<'a>(&'a self) -> Option<Box<dyn std::fmt::Display + 'a>> {
        self.issue
            .suggestion
            .as_ref()
            .map(|s| Box::new(s.title.clone()) as Box<dyn std::fmt::Display>)
    }

    fn source_code(&self) -> Option<&dyn miette::SourceCode> {
        Some(&self.kcl_source)
    }

    fn labels(&self) -> Option<Box<dyn Iterator<Item = miette::LabeledSpan> + '_>> {
        let span = miette::SourceSpan::from(self.issue.source_range);
        let label = miette::LabeledSpan::new_with_span(Some(self.filename.to_string()), span);
        Some(Box::new(std::iter::once(label)))
    }
}

/// Render a [`CompilationIssue`] as a miette report string, mirroring the
/// formatting used for [`Report`].
pub fn render_compilation_issue_miette(filename: &str, source: &str, issue: CompilationIssue) -> String {
    let report = CompilationIssueReport {
        issue,
        kcl_source: source.to_owned(),
        filename: filename.to_owned(),
    };
    let report = miette::Report::new(report);
    format!("{report:?}")
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_filename_mapping_does_not_panic_when_building_diagnostics() {
        let error = KclErrorWithOutputs::no_outputs(KclError::new_semantic(KclErrorDetails::new(
            "boom".to_owned(),
            vec![SourceRange::new(0, 1, ModuleId::from_usize(9))],
        )));

        let diagnostics = error.to_lsp_diagnostics("x");

        assert_eq!(diagnostics.len(), 1);
        assert_eq!(diagnostics[0].message, "semantic: boom");
        assert_eq!(diagnostics[0].related_information, None);
    }
}
