//! Lint for deprecated edge stdlib functions (getOppositeEdge, getNextAdjacentEdge, etc.)
//! when used inside fillet or chamfer `tags` argument.
//! Step 2 of refactor-to-edgeRefs: detection only; auto-fix is Step 3.

use anyhow::Result;

use crate::{
    SourceRange,
    lint::rule::{Discovered, Finding, FindingFamily, def_finding},
    parsing::ast::types::{ArrayExpression, CallExpressionKw, Expr, Node as AstNode, Program},
    walk::Node,
};

def_finding!(
    Z0006,
    "Prefer edgeRefs over deprecated edge stdlib functions in fillet/chamfer",
    "\
Using getOppositeEdge, getNextAdjacentEdge, getPreviousAdjacentEdge, getCommonEdge, or edgeId \
inside a fillet or chamfer 'tags' argument is deprecated. These functions require an engine call \
to resolve the edge ID before the operation, adding latency.

Prefer the 'edgeRefs' argument with { faces: [tag1, tag2] } instead, which bypasses that resolution. \
The auto-fix (when available) will convert to edgeRefs using execution metadata.
",
    FindingFamily::Simplify
);

/// Deprecated stdlib function names that should be reported when used in fillet/chamfer tags.
const DEPRECATED_EDGE_STDLIB: &[&str] = &[
    "getOppositeEdge",
    "getNextAdjacentEdge",
    "getPreviousAdjacentEdge",
    "getCommonEdge",
    "edgeId",
];

fn is_fillet_or_chamfer(callee_name: &str) -> bool {
    matches!(callee_name, "fillet" | "chamfer")
}

fn is_deprecated_edge_stdlib(callee_name: &str) -> bool {
    DEPRECATED_EDGE_STDLIB.contains(&callee_name)
}

/// Find the "tags" labeled argument and return the array expression if present.
fn get_tags_array(call: &CallExpressionKw) -> Option<&ArrayExpression> {
    for arg in &call.arguments {
        let label_name = arg.label.as_ref().map(|l| l.name.as_str()).unwrap_or("");
        if label_name == "tags" {
            if let Expr::ArrayExpression(arr) = &arg.arg {
                return Some(arr);
            }
            return None;
        }
    }
    None
}

/// Lint: detect deprecated edge stdlib calls inside fillet/chamfer tags.
/// Only reports when the call appears directly in the tags array (not via a variable).
pub fn lint_deprecated_edge_stdlib_in_fillet_chamfer(node: Node, _prog: &AstNode<Program>) -> Result<Vec<Discovered>> {
    let mut findings = vec![];

    let Node::CallExpressionKw(call_node) = node else {
        return Ok(findings);
    };

    let callee_name = call_node.callee.name.name.as_str();
    if !is_fillet_or_chamfer(callee_name) {
        return Ok(findings);
    }

    let Some(tags_array) = get_tags_array(call_node) else {
        return Ok(findings);
    };

    for element in &tags_array.elements {
        let Expr::CallExpressionKw(inner_node) = element else {
            continue;
        };
        let inner_callee = inner_node.callee.name.name.as_str();
        if is_deprecated_edge_stdlib(inner_callee) {
            let pos = SourceRange::new(inner_node.start, inner_node.end, inner_node.module_id);
            findings.push(Z0006.at(
                format!(
                    "deprecated edge stdlib '{}' in {} tags; prefer edgeRefs",
                    inner_callee, callee_name
                ),
                pos,
                None, // Auto-fix in Step 3
            ));
        }
    }

    Ok(findings)
}

#[cfg(test)]
mod tests {
    use super::{Z0006, lint_deprecated_edge_stdlib_in_fillet_chamfer};

    #[test]
    fn detects_get_opposite_edge_in_fillet_tags() {
        let kcl = r#"body = startSketchOn(XY)
  |> startProfile(at = [0, 0])
  |> line(endAbsolute = [10, 0], tag = $e1)
  |> line(endAbsolute = [10, 10])
  |> line(endAbsolute = [0, 10])
  |> line(endAbsolute = [0, 0])
  |> close()
  |> extrude(length = 5)
  |> fillet(radius = 1, tags = [getOppositeEdge(e1)])
"#;
        let prog = crate::Program::parse_no_errs(kcl).unwrap();
        let findings = prog.lint(lint_deprecated_edge_stdlib_in_fillet_chamfer).unwrap();
        let z0006: Vec<_> = findings.iter().filter(|d| d.finding.code == Z0006.code).collect();
        assert_eq!(
            z0006.len(),
            1,
            "expected one Z0006 finding for getOppositeEdge in fillet tags"
        );
        assert!(
            z0006[0].description.contains("getOppositeEdge"),
            "description should mention getOppositeEdge"
        );
    }

    #[test]
    fn detects_get_common_edge_in_chamfer_tags() {
        let kcl = r#"chamfer(body, length = 0.1, tags = [getCommonEdge(faces = [face1, face2])])
"#;
        let prog = crate::Program::parse_no_errs(kcl).unwrap();
        let findings = prog.lint(lint_deprecated_edge_stdlib_in_fillet_chamfer).unwrap();
        let z0006: Vec<_> = findings.iter().filter(|d| d.finding.code == Z0006.code).collect();
        assert_eq!(
            z0006.len(),
            1,
            "expected one Z0006 finding for getCommonEdge in chamfer tags"
        );
    }

    #[test]
    fn no_finding_when_fillet_has_no_deprecated_calls() {
        let kcl = r#"fillet(body, radius = 1, tags = [myTag])
"#;
        let prog = crate::Program::parse_no_errs(kcl).unwrap();
        let findings = prog.lint(lint_deprecated_edge_stdlib_in_fillet_chamfer).unwrap();
        let z0006: Vec<_> = findings.iter().filter(|d| d.finding.code == Z0006.code).collect();
        assert!(z0006.is_empty(), "no Z0006 when tags do not use deprecated stdlib")
    }

    #[test]
    fn no_finding_for_fillet_without_tags_arg() {
        let kcl = r#"fillet(body, radius = 1)
"#;
        let prog = crate::Program::parse_no_errs(kcl).unwrap();
        let findings = prog.lint(lint_deprecated_edge_stdlib_in_fillet_chamfer).unwrap();
        let z0006: Vec<_> = findings.iter().filter(|d| d.finding.code == Z0006.code).collect();
        assert!(z0006.is_empty(), "no Z0006 when fillet has no tags argument")
    }
}
