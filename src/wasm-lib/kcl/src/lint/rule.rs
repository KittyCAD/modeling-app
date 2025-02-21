use anyhow::Result;
use schemars::JsonSchema;
use serde::Serialize;
use tower_lsp::lsp_types::{Diagnostic, DiagnosticSeverity};

use crate::{lsp::IntoDiagnostic, walk::Node, SourceRange};

/// Check the provided AST for any found rule violations.
///
/// The Rule trait is automatically implemented for a few other types,
/// but it can also be manually implemented as required.
pub trait Rule<'a> {
    /// Check the AST at this specific node for any Finding(s).
    fn check(&self, node: Node<'a>) -> Result<Vec<Discovered>>;
}

impl<'a, FnT> Rule<'a> for FnT
where
    FnT: Fn(Node<'a>) -> Result<Vec<Discovered>>,
{
    fn check(&self, n: Node<'a>) -> Result<Vec<Discovered>> {
        self(n)
    }
}

/// Specific discovered lint rule Violation of a particular Finding.
#[derive(Clone, Debug, ts_rs::TS, Serialize, JsonSchema)]
#[ts(export)]
#[cfg_attr(feature = "pyo3", pyo3::pyclass)]
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
}

#[cfg(feature = "pyo3")]
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

        vec![Diagnostic {
            range: source_range.to_lsp_range(code),
            severity: Some(self.severity()),
            code: None,
            // TODO: this is neat we can pass a URL to a help page here for this specific error.
            code_description: None,
            source: Some("lint".to_string()),
            message,
            related_information: None,
            tags: None,
            data: None,
        }]
    }

    fn severity(&self) -> DiagnosticSeverity {
        DiagnosticSeverity::INFORMATION
    }
}

/// Abstract lint problem type.
#[derive(Clone, Debug, PartialEq, ts_rs::TS, Serialize, JsonSchema)]
#[ts(export)]
#[cfg_attr(feature = "pyo3", pyo3::pyclass)]
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
}

impl Finding {
    /// Create a new Discovered finding at the specific Position.
    pub fn at(&self, description: String, pos: SourceRange) -> Discovered {
        Discovered {
            description,
            finding: self.clone(),
            pos,
            overridden: false,
        }
    }
}

#[cfg(feature = "pyo3")]
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
}

macro_rules! def_finding {
    ( $code:ident, $title:expr, $description:expr ) => {
        /// Generated Finding
        pub const $code: Finding = $crate::lint::rule::finding!($code, $title, $description);
    };
}
pub(crate) use def_finding;

macro_rules! finding {
    ( $code:ident, $title:expr, $description:expr ) => {
        $crate::lint::rule::Finding {
            code: stringify!($code),
            title: $title,
            description: $description,
            experimental: false,
        }
    };
}
pub(crate) use finding;
#[cfg(test)]
pub(crate) use test::{assert_finding, assert_no_finding, test_finding, test_no_finding};

#[cfg(test)]
mod test {

    macro_rules! assert_no_finding {
        ( $check:expr, $finding:expr, $kcl:expr ) => {
            let prog = $crate::parsing::top_level_parse($kcl).unwrap();
            for discovered_finding in prog.lint($check).unwrap() {
                if discovered_finding.finding == $finding {
                    assert!(false, "Finding {:?} was emitted", $finding.code);
                }
            }
        };
    }

    macro_rules! assert_finding {
        ( $check:expr, $finding:expr, $kcl:expr ) => {
            let prog = $crate::parsing::top_level_parse($kcl).unwrap();

            for discovered_finding in prog.lint($check).unwrap() {
                if discovered_finding.finding == $finding {
                    return;
                }
            }
            assert!(false, "Finding {:?} was not emitted", $finding.code);
        };
    }

    macro_rules! test_finding {
        ( $name:ident, $check:expr, $finding:expr, $kcl:expr ) => {
            #[test]
            fn $name() {
                $crate::lint::rule::assert_finding!($check, $finding, $kcl);
            }
        };
    }

    macro_rules! test_no_finding {
        ( $name:ident, $check:expr, $finding:expr, $kcl:expr ) => {
            #[test]
            fn $name() {
                $crate::lint::rule::assert_no_finding!($check, $finding, $kcl);
            }
        };
    }

    pub(crate) use assert_finding;
    pub(crate) use assert_no_finding;
    pub(crate) use test_finding;
    pub(crate) use test_no_finding;
}
