use std::collections::BTreeMap;

use indexmap::IndexMap;
use kcl_api::NodePath;
pub use kcl_error::BacktraceItem;
pub use kcl_error::BacktraceItemKind;
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
use crate::execution::RefactorMetadata;
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
    pub refactor_metadata: Vec<RefactorMetadata>,
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
        refactor_metadata: Vec<RefactorMetadata>,
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
            refactor_metadata,
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
            refactor_metadata: Default::default(),
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
            refactor_metadata: outcome.refactor_metadata,
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
        let source_ranges = self.error.source_ranges();

        // Source ranges are ordered innermost first, so the first one is where
        // the error actually occurred; it anchors the primary report. Each
        // outer frame either becomes another label on the primary (same file
        // and not overlapping any label already kept; miette merges
        // overlapping labels into hard-to-read shared rows) or its own
        // related report below.
        let first_source_range = *source_ranges
            .first()
            .ok_or_else(|| anyhow::anyhow!("No source ranges found"))?;
        let primary_module_id = first_source_range.module_id();

        let module_source = |module_id: ModuleId| {
            self.source_files.get(&module_id).cloned().unwrap_or(ModuleSource {
                source: code.to_string(),
                path: self.filenames.get(&module_id).cloned().unwrap_or(ModulePath::Main),
            })
        };
        let source = module_source(primary_module_id);
        let filename = source.path.to_string();
        let kcl_source = source.source;

        // Label outer frames with their backtrace names so the chain reads
        // like a backtrace; fall back to the filename.
        let backtrace = self.error.backtrace();

        let mut primary_labels = vec![miette::LabeledSpan::new_with_span(
            Some(filename.clone()),
            miette::SourceSpan::from(first_source_range),
        )];
        let mut kept_ranges = vec![first_source_range];
        let mut related = Vec::new();
        for (index, source_range) in source_ranges.iter().copied().enumerate().skip(1) {
            let keep = source_range.module_id() == primary_module_id
                && !kept_ranges.iter().any(|kept| ranges_overlap(*kept, source_range));
            let source = module_source(source_range.module_id());
            let label = frame_label(&backtrace, source_ranges.len(), index).unwrap_or_else(|| source.path.to_string());
            if keep {
                primary_labels.push(miette::LabeledSpan::new_with_span(
                    Some(label),
                    miette::SourceSpan::from(source_range),
                ));
                kept_ranges.push(source_range);
            } else {
                let error = self.error.override_source_ranges(vec![source_range]);
                related.push(Report {
                    error,
                    kcl_source: source.source,
                    filename: source.path.to_string(),
                    label,
                });
            }
        }

        Ok(ReportWithOutputs {
            error: self,
            kcl_source,
            filename,
            primary_labels,
            related,
        })
    }
}

/// The display label for backtrace frame `index`, derived from the frame's
/// name: `in someFunction()` for calls, the `import <path>` label for
/// imports. Some errors carry source ranges without matching frames (e.g.
/// hand-built details), so the backtrace is only trusted when it lines up
/// with the source ranges.
fn frame_label(backtrace: &[BacktraceItem], ranges_len: usize, index: usize) -> Option<String> {
    if backtrace.len() != ranges_len {
        return None;
    }
    let frame = &backtrace[index];
    let name = frame.fn_name.as_ref()?;
    match frame.kind {
        BacktraceItemKind::Import => Some(name.clone()),
        BacktraceItemKind::Call => Some(format!("in {name}()")),
    }
}

/// Whether two source ranges cover any common source text.
///
/// Equal ranges count as overlapping even when empty so that repeated frames
/// (e.g. recursion) do not stack duplicate labels on the primary report.
fn ranges_overlap(a: SourceRange, b: SourceRange) -> bool {
    if a.module_id() != b.module_id() {
        return false;
    }
    if a.start() == b.start() && a.end() == b.end() {
        return true;
    }
    a.start() < b.end() && b.start() < a.end()
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
    fn to_lsp_diagnostics(&self, code: &str, uri: &tower_lsp::lsp_types::Url) -> Vec<Diagnostic> {
        let message = self.error.get_message();
        let source_ranges = self.error.source_ranges();
        if source_ranges.is_empty() {
            return Vec::new();
        }

        // The caller publishes these diagnostics under the top-level
        // document's URI, so the diagnostic range must be a top-level range
        // converted against the top-level source; imported offsets would
        // point at unrelated text. Source ranges are ordered innermost
        // first: anchor at the innermost top-level range and attach every
        // other frame as related information located in its own module.
        let primary_index = source_ranges.iter().position(|range| range.module_id().is_top_level());
        let primary_range = primary_index.map(|index| source_ranges[index]).unwrap_or_default();

        let backtrace = self.error.backtrace();
        let related_information: Vec<tower_lsp::lsp_types::DiagnosticRelatedInformation> = source_ranges
            .iter()
            .enumerate()
            .filter(|(index, _)| Some(*index) != primary_index)
            .filter_map(|(index, source_range)| {
                // Top-level frames belong to the document these diagnostics
                // are published under; its path in `filenames` is the virtual
                // main module, so only the caller knows the real URI.
                let location = if source_range.module_id().is_top_level() {
                    tower_lsp::lsp_types::Location {
                        uri: uri.clone(),
                        range: source_range.to_lsp_range(code),
                    }
                } else {
                    let source = self.source_files.get(&source_range.module_id()).cloned().or_else(|| {
                        self.filenames
                            .get(&source_range.module_id())
                            .cloned()
                            .map(|path| ModuleSource {
                                source: code.to_string(),
                                path,
                            })
                    })?;
                    let mut filename = source.path.to_string();
                    if !filename.starts_with("file://") {
                        filename = format!("file:///{}", filename.trim_start_matches("/"));
                    }
                    tower_lsp::lsp_types::Location {
                        uri: url::Url::parse(&filename).ok()?,
                        range: source_range.to_lsp_range(&source.source),
                    }
                };
                Some(tower_lsp::lsp_types::DiagnosticRelatedInformation {
                    location,
                    message: frame_label(&backtrace, source_ranges.len(), index).unwrap_or_else(|| message.clone()),
                })
            })
            .collect();

        vec![Diagnostic {
            range: primary_range.to_lsp_range(code),
            severity: Some(self.severity()),
            code: None,
            // TODO: this is neat we can pass a URL to a help page here for this specific error.
            code_description: None,
            source: Some("kcl".to_string()),
            related_information: (!related_information.is_empty()).then_some(related_information),
            message,
            tags: None,
            data: None,
        }]
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
    /// Labels to render on the primary report, precomputed so they cannot
    /// disagree with which frames were split out into `related`.
    pub primary_labels: Vec<miette::LabeledSpan>,
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
            KclError::UserDefined { .. } => "UserDefined",
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
        Some(Box::new(self.primary_labels.iter().cloned()))
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
    /// Text for this report's span label: the backtrace frame name when one
    /// exists, otherwise the filename.
    pub label: String,
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
            KclError::UserDefined { .. } => "UserDefined",
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
            .map(|span| miette::LabeledSpan::new_with_span(Some(self.label.clone()), span));
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
    fn to_lsp_diagnostics(&self, code: &str, _uri: &tower_lsp::lsp_types::Url) -> Vec<Diagnostic> {
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

        let diagnostics = error.to_lsp_diagnostics("x", &"file:///test.kcl".try_into().unwrap());

        assert_eq!(diagnostics.len(), 1);
        assert_eq!(diagnostics[0].message, "semantic: boom");
        assert_eq!(diagnostics[0].related_information, None);
    }

    #[test]
    fn lsp_diagnostics_anchor_at_top_level_and_relate_imported_frames() {
        let main_code = "import assemblyValue from \"assembly.kcl\"\n\nassemblyValue\n";
        // The failing expression is on line 2 of the imported file, so a
        // range converted against the wrong source lands on the wrong line.
        let imported_code = "// comment\nexport brokenValue = missingName + 1\n";
        let imported_module = ModuleId::from_usize(1);
        let missing_name_start = imported_code.find("missingName").unwrap();
        let imported_range = SourceRange::new(missing_name_start, missing_name_start + 11, imported_module);
        let import_stmt_range = SourceRange::new(0, 41, ModuleId::default());

        let error = KclError::new_semantic(KclErrorDetails::new(
            "`missingName` is not defined".to_owned(),
            vec![imported_range],
        ))
        .add_import_location("assembly.kcl", import_stmt_range);
        let mut error = KclErrorWithOutputs::no_outputs(error);
        error.source_files.insert(
            imported_module,
            ModuleSource {
                source: imported_code.to_owned(),
                path: ModulePath::Local {
                    value: "/project/assembly.kcl".into(),
                    original_import_path: None,
                },
            },
        );

        let diagnostics = error.to_lsp_diagnostics(main_code, &"file:///project/main.kcl".try_into().unwrap());

        // One diagnostic, anchored at the import statement in the top-level
        // file (line 0), not at imported offsets.
        assert_eq!(diagnostics.len(), 1);
        assert_eq!(diagnostics[0].range.start.line, 0);
        assert_eq!(diagnostics[0].range.end.line, 0);

        // The imported frame is related information located in its own file,
        // with the range computed against that file's source.
        let related = diagnostics[0].related_information.as_ref().unwrap();
        assert_eq!(related.len(), 1);
        assert!(related[0].location.uri.as_str().ends_with("assembly.kcl"));
        assert_eq!(related[0].location.range.start.line, 1);
        assert_eq!(related[0].message, "import assembly.kcl");
    }

    fn report_for(ranges: Vec<SourceRange>) -> ReportWithOutputs {
        let error = KclError::new_semantic(KclErrorDetails::new("boom".to_owned(), ranges));
        KclErrorWithOutputs::no_outputs(error)
            .into_miette_report_with_outputs("code")
            .unwrap()
    }

    #[test]
    fn overlapping_same_file_ranges_become_related_reports() {
        let module = ModuleId::default();
        let narrow = SourceRange::new(10, 16, module);
        let wide = SourceRange::new(0, 20, module);
        let disjoint = SourceRange::new(30, 40, module);

        let report = report_for(vec![narrow, wide, disjoint]);

        // The wide range overlaps the primary label, so it is split out; the
        // disjoint one stays as a second label.
        assert_eq!(report.primary_labels.len(), 2);
        assert_eq!(report.related.len(), 1);
        assert_eq!(report.related[0].error.source_ranges(), vec![wide]);
    }

    #[test]
    fn other_module_ranges_become_related_reports() {
        let inner = SourceRange::new(0, 5, ModuleId::from_usize(7));
        let outer = SourceRange::new(10, 20, ModuleId::default());

        let report = report_for(vec![inner, outer]);

        assert_eq!(report.primary_labels.len(), 1);
        assert_eq!(report.related.len(), 1);
        assert_eq!(report.related[0].error.source_ranges(), vec![outer]);
    }

    #[test]
    fn labels_use_frame_names_when_available() {
        let module = ModuleId::default();
        let inner = SourceRange::new(10, 16, module);
        let mid_call = SourceRange::new(30, 40, module);
        let outer_call = SourceRange::new(0, 20, module);
        let import_site = SourceRange::new(0, 5, ModuleId::from_usize(2));
        let error = KclError::new_semantic(KclErrorDetails::new("boom".to_owned(), vec![inner]))
            .add_unwind_location(Some("f".to_owned()), mid_call)
            .add_unwind_location(Some("g".to_owned()), outer_call)
            .add_import_location("part.kcl", import_site);

        let report = KclErrorWithOutputs::no_outputs(error)
            .into_miette_report_with_outputs("code")
            .unwrap();

        // mid_call is disjoint, so it stays as a label named for the function
        // containing it; outer_call overlaps the anchor and was labeled by the
        // import unwind; import_site has no frame name, so it falls back to
        // its filename.
        assert_eq!(report.primary_labels.len(), 2);
        assert_eq!(report.primary_labels[1].label(), Some("in g()"));
        assert_eq!(
            report.related.iter().map(|r| r.label.as_str()).collect::<Vec<_>>(),
            ["import part.kcl", report.related[1].filename.as_str()]
        );
    }

    #[test]
    fn repeated_frames_do_not_stack_duplicate_labels() {
        // Recursion repeats the same range; only the first occurrence stays
        // on the primary report.
        let module = ModuleId::default();
        let range = SourceRange::new(10, 16, module);

        let report = report_for(vec![range, range, range]);

        assert_eq!(report.primary_labels.len(), 1);
        assert_eq!(report.related.len(), 2);
    }
}
