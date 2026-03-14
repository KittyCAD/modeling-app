//! Lint for deprecated edge stdlib functions (getOppositeEdge, getNextAdjacentEdge, etc.)
//! when used inside fillet/chamfer `tags` or revolve/helic `axis` argument.
//! Step 2 of refactor-to-edgeRefs: detection only; auto-fix is Step 3.

use anyhow::Result;

use crate::{
    SourceRange,
    lint::rule::{Discovered, Finding, FindingFamily, def_finding},
    parsing::ast::types::{CallExpressionKw, Expr, Node as AstNode, Program},
    walk::Node,
};

def_finding!(
    Z0006,
    "Prefer edgeRefs/edgeRef over tags/axis in fillet/chamfer/revolve/helic",
    "\
Using 'tags' in fillet/chamfer or 'axis' in revolve/helic with deprecated stdlib (e.g. \
getOppositeEdge) or direct tags is deprecated. Prefer 'edgeRefs' (fillet/chamfer) or \
'edgeRef' (revolve/helic) with { faces: [tag1, tag2] }. The auto-fix will convert.
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

fn is_revolve_or_helix(callee_name: &str) -> bool {
    matches!(callee_name, "revolve" | "helix")
}

/// Axis argument for revolve/helic: axis = getOppositeEdge(...) etc.
fn get_axis_arg(call: &CallExpressionKw) -> Option<&Expr> {
    let axis_arg = call
        .arguments
        .iter()
        .find(|arg| arg.label.as_ref().map(|l| l.name.as_str()).unwrap_or("") == "axis")?;
    Some(&axis_arg.arg)
}

fn is_deprecated_edge_stdlib(callee_name: &str) -> bool {
    DEPRECATED_EDGE_STDLIB.contains(&callee_name)
}

/// Elements to check for deprecated/direct usage: from tags = [a, b] or tags = singleExpr.
fn get_tags_elements(call: &CallExpressionKw) -> Option<Vec<&Expr>> {
    let tags_arg = call
        .arguments
        .iter()
        .find(|arg| arg.label.as_ref().map(|l| l.name.as_str()).unwrap_or("") == "tags")?;
    Some(match &tags_arg.arg {
        Expr::ArrayExpression(arr) => arr.elements.iter().collect(),
        single => vec![single],
    })
}

/// True if the expression is a direct tag reference (e.g. identifier `e1`), not a call.
fn is_direct_tag_ref(element: &Expr) -> bool {
    matches!(element, Expr::Name(_))
}

/// Lint: prefer edgeRefs/edgeRef over tags/axis. Fires for fillet/chamfer when tags has
/// deprecated stdlib or direct tag; fires for revolve/helic when axis is a deprecated stdlib call.
pub fn lint_deprecated_edge_stdlib_in_fillet_chamfer(node: Node, _prog: &AstNode<Program>) -> Result<Vec<Discovered>> {
    let mut findings = vec![];

    let Node::CallExpressionKw(call_node) = node else {
        return Ok(findings);
    };

    let callee_name = call_node.callee.name.name.as_str();

    if is_fillet_or_chamfer(callee_name) {
        let Some(elements) = get_tags_elements(call_node) else {
            return Ok(findings);
        };
        if !elements.is_empty() {
            let any_deprecated = elements.iter().any(|el| {
                if let Expr::CallExpressionKw(inner) = el {
                    is_deprecated_edge_stdlib(inner.callee.name.name.as_str())
                } else {
                    false
                }
            });
            let any_direct = elements.iter().any(|el| is_direct_tag_ref(el));
            if any_deprecated || any_direct {
                let pos = SourceRange::new(call_node.start, call_node.end, call_node.module_id);
                findings.push(Z0006.at(format!("{} uses 'tags'; prefer edgeRefs", callee_name), pos, None));
            }
        }
    } else if is_revolve_or_helix(callee_name)
        && let Some(axis_expr) = get_axis_arg(call_node)
        && let Expr::CallExpressionKw(inner) = axis_expr
        && is_deprecated_edge_stdlib(inner.callee.name.name.as_str())
    {
        let pos = SourceRange::new(call_node.start, call_node.end, call_node.module_id);
        findings.push(Z0006.at(
            format!("{} uses 'axis' with deprecated stdlib; prefer edgeRef", callee_name),
            pos,
            None,
        ));
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
            z0006[0].description.contains("tags") || z0006[0].description.contains("edgeRefs"),
            "description should mention tags or edgeRefs"
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
    fn no_finding_when_tags_has_no_convertible_element() {
        // tags = [foo()] is a call but not deprecated stdlib; not a direct tag (Name), so no Z0006.
        let kcl = r#"fillet(body, radius = 1, tags = [foo()])
"#;
        let prog = crate::Program::parse_no_errs(kcl).unwrap();
        let findings = prog.lint(lint_deprecated_edge_stdlib_in_fillet_chamfer).unwrap();
        let z0006: Vec<_> = findings.iter().filter(|d| d.finding.code == Z0006.code).collect();
        assert!(
            z0006.is_empty(),
            "no Z0006 when tags has no deprecated stdlib and no direct tag (Name)"
        );
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

    #[test]
    fn z0006_detects_direct_tags_in_fillet() {
        let kcl = r#"body = startSketchOn(XY)
  |> startProfile(at = [0, 0])
  |> line(endAbsolute = [10, 0], tag = $e1)
  |> line(endAbsolute = [10, 10])
  |> line(endAbsolute = [0, 10])
  |> line(endAbsolute = [0, 0])
  |> close()
  |> extrude(length = 5, tagStart = $capStart001)
  |> fillet(radius = 1, tags = [e1])
"#;
        let prog = crate::Program::parse_no_errs(kcl).unwrap();
        let findings = prog.lint(lint_deprecated_edge_stdlib_in_fillet_chamfer).unwrap();
        let z0006: Vec<_> = findings.iter().filter(|d| d.finding.code == Z0006.code).collect();
        assert_eq!(z0006.len(), 1, "expected one Z0006 for fillet with direct tags");
        assert!(z0006[0].description.contains("tags"), "description should mention tags");
    }

    #[test]
    fn z0006_fires_when_tags_has_deprecated_stdlib() {
        let kcl = r#"fillet(body, radius = 1, tags = [getOppositeEdge(e1)])
"#;
        let prog = crate::Program::parse_no_errs(kcl).unwrap();
        let findings = prog.lint(lint_deprecated_edge_stdlib_in_fillet_chamfer).unwrap();
        let z0006: Vec<_> = findings.iter().filter(|d| d.finding.code == Z0006.code).collect();
        assert_eq!(z0006.len(), 1, "Z0006 fires when tags uses deprecated stdlib");
    }

    #[test]
    fn z0006_fires_when_tags_is_single_value_not_array() {
        // tags = getOppositeEdge(e1) is valid KCL (single value, not array); lint should still fire.
        let kcl = r#"fillet(body, radius = 1, tags = getOppositeEdge(e1))
"#;
        let prog = crate::Program::parse_no_errs(kcl).unwrap();
        let findings = prog.lint(lint_deprecated_edge_stdlib_in_fillet_chamfer).unwrap();
        let z0006: Vec<_> = findings.iter().filter(|d| d.finding.code == Z0006.code).collect();
        assert_eq!(
            z0006.len(),
            1,
            "Z0006 fires when tags is single getOppositeEdge(e1) (not array)"
        );
    }

    #[test]
    fn z0006_fires_for_revolve_with_deprecated_axis() {
        let kcl = r#"revolve(profile, axis = getOppositeEdge(seg01))
"#;
        let prog = crate::Program::parse_no_errs(kcl).unwrap();
        let findings = prog.lint(lint_deprecated_edge_stdlib_in_fillet_chamfer).unwrap();
        let z0006: Vec<_> = findings.iter().filter(|d| d.finding.code == Z0006.code).collect();
        assert_eq!(z0006.len(), 1, "Z0006 fires for revolve with deprecated axis");
        assert!(
            z0006[0].description.contains("axis") || z0006[0].description.contains("edgeRef"),
            "description should mention axis or edgeRef"
        );
    }

    #[test]
    fn z0006_fires_for_helix_with_deprecated_axis() {
        let kcl = r#"helix(profile, axis = getOppositeEdge(seg01), radius = 1)
"#;
        let prog = crate::Program::parse_no_errs(kcl).unwrap();
        let findings = prog.lint(lint_deprecated_edge_stdlib_in_fillet_chamfer).unwrap();
        let z0006: Vec<_> = findings.iter().filter(|d| d.finding.code == Z0006.code).collect();
        assert_eq!(z0006.len(), 1, "Z0006 fires for helix with deprecated axis");
    }
}
