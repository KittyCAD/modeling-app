use anyhow::Result;
#[cfg(feature = "pyo3")]
use pyo3_stub_gen::{inventory, type_info::PyEnumInfo};
use serde::Serialize;
use tower_lsp::lsp_types::{Diagnostic, DiagnosticSeverity};

use crate::{
    SourceRange,
    errors::Suggestion,
    lsp::{IntoDiagnostic, ToLspRange, to_lsp_edit},
    parsing::ast::types::{Node as AstNode, Program},
    walk::Node,
};

/// Check the provided AST for any found rule violations.
///
/// The Rule trait is automatically implemented for a few other types,
/// but it can also be manually implemented as required.
pub trait Rule<'a> {
    /// Check the AST at this specific node for any Finding(s).
    fn check(&self, node: Node<'a>, prog: &AstNode<Program>) -> Result<Vec<Discovered>>;
}

impl<'a, FnT> Rule<'a> for FnT
where
    FnT: Fn(Node<'a>, &AstNode<Program>) -> Result<Vec<Discovered>>,
{
    fn check(&self, n: Node<'a>, prog: &AstNode<Program>) -> Result<Vec<Discovered>> {
        self(n, prog)
    }
}

/// Specific discovered lint rule Violation of a particular Finding.
#[derive(Clone, Debug, ts_rs::TS, Serialize)]
#[ts(export)]
#[cfg_attr(feature = "pyo3", pyo3::pyclass, pyo3_stub_gen::derive::gen_stub_pyclass)]
#[serde(rename_all = "camelCase")]
pub struct Discovered {
    /// Zoo Lint Finding information.
    pub finding: Finding,

    /// Further information about the specific finding.
    pub description: String,

    /// Source code location.
    pub pos: SourceRange,

    /// Is this discovered issue overridden by the programmer?
    pub overridden: bool,

    /// Suggestion to fix the issue.
    pub suggestion: Option<Suggestion>,
}

impl Discovered {
    pub fn apply_suggestion(&self, src: &str) -> Option<String> {
        self.suggestion.as_ref().map(|suggestion| suggestion.apply(src))
    }
}

/// Lint, and try to apply all suggestions.
/// Returns the new source code, and any lints without suggestions.
/// # Implementation
/// Currently, this runs a loop: parse the code, lint it, apply a lint with suggestions,
/// and loop again, until there's no more lints with suggestions. This is because our auto-fix
/// system currently replaces the whole program, not just a certain part of it.
/// If/when we discover that this autofix loop is too slow, we'll change our lint system so that
/// lints can be applied to a small part of the program.
pub fn lint_and_fix_all(mut source: String) -> anyhow::Result<(String, Vec<Discovered>)> {
    loop {
        let (program, errors) = crate::Program::parse(&source)?;
        if !errors.is_empty() {
            anyhow::bail!("Found errors while parsing, please run the parser and fix them before linting.");
        }
        let Some(program) = program else {
            anyhow::bail!("Could not parse, please run parser and ensure the program is valid before linting");
        };
        let lints = program.lint_all()?;
        if let Some(to_fix) = lints.iter().find_map(|lint| lint.suggestion.clone()) {
            source = to_fix.apply(&source);
        } else {
            return Ok((source, lints));
        }
    }
}

/// Lint, and try to apply all suggestions.
/// Returns the new source code, and any lints without suggestions.
/// # Implementation
/// Currently, this runs a loop: parse the code, lint it, apply a lint with suggestions,
/// and loop again, until there's no more lints with suggestions. This is because our auto-fix
/// system currently replaces the whole program, not just a certain part of it.
/// If/when we discover that this autofix loop is too slow, we'll change our lint system so that
/// lints can be applied to a small part of the program.
pub fn lint_and_fix_families(
    mut source: String,
    families_to_fix: &[FindingFamily],
) -> anyhow::Result<(String, Vec<Discovered>)> {
    loop {
        let (program, errors) = crate::Program::parse(&source)?;
        if !errors.is_empty() {
            anyhow::bail!("Found errors while parsing, please run the parser and fix them before linting.");
        }
        let Some(program) = program else {
            anyhow::bail!("Could not parse, please run parser and ensure the program is valid before linting");
        };
        let lints = program.lint_all()?;
        if let Some(to_fix) = lints.iter().find_map(|lint| {
            if families_to_fix.contains(&lint.finding.family) {
                lint.suggestion.clone()
            } else {
                None
            }
        }) {
            source = to_fix.apply(&source);
        } else {
            return Ok((source, lints));
        }
    }
}

#[cfg(feature = "pyo3")]
#[pyo3_stub_gen::derive::gen_stub_pymethods]
#[pyo3::pymethods]
impl Discovered {
    #[getter]
    pub fn finding(&self) -> Finding {
        self.finding.clone()
    }

    #[getter]
    pub fn description(&self) -> String {
        self.description.clone()
    }

    #[getter]
    pub fn pos(&self) -> (usize, usize) {
        (self.pos.start(), self.pos.end())
    }

    #[getter]
    pub fn overridden(&self) -> bool {
        self.overridden
    }
}

impl IntoDiagnostic for Discovered {
    fn to_lsp_diagnostics(&self, code: &str) -> Vec<Diagnostic> {
        (&self).to_lsp_diagnostics(code)
    }

    fn severity(&self) -> DiagnosticSeverity {
        (&self).severity()
    }
}

impl IntoDiagnostic for &Discovered {
    fn to_lsp_diagnostics(&self, code: &str) -> Vec<Diagnostic> {
        let message = self.finding.title.to_owned();
        let source_range = self.pos;
        let edit = self.suggestion.as_ref().map(|s| to_lsp_edit(s, code));

        vec![Diagnostic {
            range: source_range.to_lsp_range(code),
            severity: Some(self.severity()),
            code: Some(tower_lsp::lsp_types::NumberOrString::String(
                self.finding.code.to_string(),
            )),
            // TODO: this is neat we can pass a URL to a help page here for this specific error.
            code_description: None,
            source: Some("lint".to_string()),
            message,
            related_information: None,
            tags: None,
            data: edit.map(|e| serde_json::to_value(e).unwrap()),
        }]
    }

    fn severity(&self) -> DiagnosticSeverity {
        DiagnosticSeverity::INFORMATION
    }
}

/// Abstract lint problem type.
#[derive(Clone, Debug, PartialEq, ts_rs::TS, Serialize)]
#[ts(export)]
#[cfg_attr(feature = "pyo3", pyo3::pyclass, pyo3_stub_gen::derive::gen_stub_pyclass)]
#[serde(rename_all = "camelCase")]
pub struct Finding {
    /// Unique identifier for this particular issue.
    pub code: &'static str,

    /// Short one-line description of this issue.
    pub title: &'static str,

    /// Long human-readable description of this issue.
    pub description: &'static str,

    /// Is this discovered issue experimental?
    pub experimental: bool,

    /// Findings are sorted into families, e.g. "style" or "correctness".
    pub family: FindingFamily,
}

/// Abstract lint problem type.
#[derive(Clone, Copy, Debug, PartialEq, Eq, ts_rs::TS, Serialize, Hash)]
#[ts(export)]
#[cfg_attr(feature = "pyo3", pyo3::pyclass)]
#[serde(rename_all = "camelCase")]
pub enum FindingFamily {
    /// KCL style guidelines, e.g. identifier casing.
    Style,
    /// The user is probably doing something incorrect or unintended.
    Correctness,
    /// The user has expressed something in a complex way that
    /// could be simplified.
    Simplify,
}

impl std::fmt::Display for FindingFamily {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            FindingFamily::Style => write!(f, "style"),
            FindingFamily::Correctness => write!(f, "correctness"),
            FindingFamily::Simplify => write!(f, "simplify"),
        }
    }
}

#[cfg(feature = "pyo3")]
impl pyo3_stub_gen::PyStubType for FindingFamily {
    fn type_output() -> pyo3_stub_gen::TypeInfo {
        // Expose the enum name in stubs; functions using FindingFamily will be annotated accordingly.
        pyo3_stub_gen::TypeInfo::unqualified("FindingFamily")
    }
}

#[cfg(feature = "pyo3")]
fn finding_family_type_id() -> std::any::TypeId {
    std::any::TypeId::of::<FindingFamily>()
}

#[cfg(feature = "pyo3")]
inventory::submit! {
    PyEnumInfo {
        enum_id: finding_family_type_id,
        pyclass_name: "FindingFamily",
        module: None,
        doc: "Lint families such as style or correctness.",
        variants: &[
            ("Style", "KCL style guidelines, e.g. identifier casing."),
            ("Correctness", "The user is probably doing something incorrect or unintended."),
            ("Simplify", "The user has expressed something in a complex way that could be simplified."),
        ],
    }
}

impl Finding {
    /// Create a new Discovered finding at the specific Position.
    pub fn at(&self, description: String, pos: SourceRange, suggestion: Option<Suggestion>) -> Discovered {
        Discovered {
            description,
            finding: self.clone(),
            pos,
            overridden: false,
            suggestion,
        }
    }
}

#[cfg(feature = "pyo3")]
#[pyo3_stub_gen::derive::gen_stub_pymethods]
#[pyo3::pymethods]
impl Finding {
    #[getter]
    pub fn code(&self) -> &'static str {
        self.code
    }

    #[getter]
    pub fn title(&self) -> &'static str {
        self.title
    }

    #[getter]
    pub fn description(&self) -> &'static str {
        self.description
    }

    #[getter]
    pub fn experimental(&self) -> bool {
        self.experimental
    }

    #[getter]
    pub fn family(&self) -> String {
        self.family.to_string()
    }
}

macro_rules! def_finding {
    ( $code:ident, $title:expr_2021, $description:expr_2021, $family:path) => {
        /// Generated Finding
        pub const $code: Finding = $crate::lint::rule::finding!($code, $title, $description, $family);
    };
}
pub(crate) use def_finding;

macro_rules! finding {
    ( $code:ident, $title:expr_2021, $description:expr_2021, $family:path ) => {
        $crate::lint::rule::Finding {
            code: stringify!($code),
            title: $title,
            description: $description,
            experimental: false,
            family: $family,
        }
    };
}
pub(crate) use finding;
#[cfg(test)]
pub(crate) use test::{assert_finding, assert_no_finding, test_finding, test_no_finding};

#[cfg(test)]
mod test {

    #[test]
    fn test_lint_and_fix_all() {
        // This file has some snake_case identifiers.
        let path = "../kcl-python-bindings/files/box_with_linter_errors.kcl";
        let f = std::fs::read_to_string(path).unwrap();
        let prog = crate::Program::parse_no_errs(&f).unwrap();

        // That should cause linter errors.
        let lints = prog.lint_all().unwrap();
        assert!(lints.len() >= 4);

        // But the linter errors can be fixed.
        let (new_code, unfixed) = lint_and_fix_all(f).unwrap();
        assert!(unfixed.len() < 4);

        // After the fix, no more snake_case identifiers.
        assert!(!new_code.contains('_'));
    }

    #[test]
    fn test_lint_and_fix_families() {
        // This file has some snake_case identifiers.
        let path = "../kcl-python-bindings/files/box_with_linter_errors.kcl";
        let original_code = std::fs::read_to_string(path).unwrap();
        let prog = crate::Program::parse_no_errs(&original_code).unwrap();

        // That should cause linter errors.
        let lints = prog.lint_all().unwrap();
        assert!(lints.len() >= 4);

        // But the linter errors can be fixed.
        let (new_code, unfixed) =
            lint_and_fix_families(original_code, &[FindingFamily::Correctness, FindingFamily::Simplify]).unwrap();
        assert!(unfixed.len() >= 3);

        // After the fix, no more snake_case identifiers.
        assert!(new_code.contains("box_width"));
        assert!(new_code.contains("box_depth"));
        assert!(new_code.contains("box_height"));
    }

    macro_rules! assert_no_finding {
        ( $check:expr_2021, $finding:expr_2021, $kcl:expr_2021 ) => {
            let prog = $crate::Program::parse_no_errs($kcl).unwrap();

            // Ensure the code still works.
            $crate::execution::parse_execute($kcl).await.unwrap();

            for discovered_finding in prog.lint($check).unwrap() {
                if discovered_finding.finding == $finding {
                    assert!(false, "Finding {:?} was emitted", $finding.code);
                }
            }
        };
    }

    macro_rules! assert_finding {
        ( $check:expr_2021, $finding:expr_2021, $kcl:expr_2021, $output:expr_2021, $suggestion:expr_2021 ) => {
            let prog = $crate::Program::parse_no_errs($kcl).unwrap();

            // Ensure the code still works.
            $crate::execution::parse_execute($kcl).await.unwrap();

            for discovered_finding in prog.lint($check).unwrap() {
                pretty_assertions::assert_eq!(discovered_finding.description, $output,);

                if discovered_finding.finding == $finding {
                    pretty_assertions::assert_eq!(
                        discovered_finding.suggestion.clone().map(|s| s.insert),
                        $suggestion,
                    );

                    if discovered_finding.suggestion.is_some() {
                        // Apply the suggestion to the source code.
                        let code = discovered_finding.apply_suggestion($kcl).unwrap();

                        // Ensure the code still works.
                        $crate::execution::parse_execute(&code).await.unwrap();
                    }
                    return;
                }
            }
            assert!(false, "Finding {:?} was not emitted", $finding.code);
        };
    }

    macro_rules! test_finding {
        ( $name:ident, $check:expr_2021, $finding:expr_2021, $kcl:expr_2021, $output:expr_2021, $suggestion:expr_2021 ) => {
            #[tokio::test]
            async fn $name() {
                $crate::lint::rule::assert_finding!($check, $finding, $kcl, $output, $suggestion);
            }
        };
    }

    macro_rules! test_no_finding {
        ( $name:ident, $check:expr_2021, $finding:expr_2021, $kcl:expr_2021 ) => {
            #[tokio::test]
            async fn $name() {
                $crate::lint::rule::assert_no_finding!($check, $finding, $kcl);
            }
        };
    }

    pub(crate) use assert_finding;
    pub(crate) use assert_no_finding;
    pub(crate) use test_finding;
    pub(crate) use test_no_finding;

    use super::*;
}
