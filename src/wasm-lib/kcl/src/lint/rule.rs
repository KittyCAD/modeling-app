use anyhow::Result;
use tower_lsp::lsp_types::{Diagnostic, DiagnosticSeverity};

use crate::{executor::SourceRange, lint::Node, lsp::IntoDiagnostic};

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
#[derive(Clone, Debug)]
#[cfg_attr(feature = "pyo3", pyo3::pyclass)]
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

impl IntoDiagnostic for Discovered {
    fn to_lsp_diagnostic(&self, code: &str) -> Diagnostic {
        let message = self.finding.title.to_owned();
        let source_range = self.pos;

        Diagnostic {
            range: source_range.to_lsp_range(code),
            severity: Some(DiagnosticSeverity::INFORMATION),
            code: None,
            // TODO: this is neat we can pass a URL to a help page here for this specific error.
            code_description: None,
            source: Some("lint".to_string()),
            message,
            related_information: None,
            tags: None,
            data: None,
        }
    }
}

/// Abstract lint problem type.
#[derive(Clone, Debug, PartialEq)]
#[cfg_attr(feature = "pyo3", pyo3::pyclass)]
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
            let tokens = $crate::token::lexer($kcl).unwrap();
            let parser = $crate::parser::Parser::new(tokens);
            let prog = parser.ast().unwrap();
            for discovered_finding in prog.lint($check).unwrap() {
                if discovered_finding.finding == $finding {
                    assert!(false, "Finding {:?} was emitted", $finding.code);
                }
            }
        };
    }

    macro_rules! assert_finding {
        ( $check:expr, $finding:expr, $kcl:expr ) => {
            let tokens = $crate::token::lexer($kcl).unwrap();
            let parser = $crate::parser::Parser::new(tokens);
            let prog = parser.ast().unwrap();

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
