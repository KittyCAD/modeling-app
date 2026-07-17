//! Lint for deprecated edge stdlib functions (getOppositeEdge, getNextAdjacentEdge, etc.)
//! when used inside fillet/chamfer `tags`, revolve/helix `axis`, extrude edge arguments,
//! `getBoundedEdge` `edge`, GD&T `edges`, or GD&T distance `from`/`to` arguments.
//! Step 2 of the Z0006 upgrade path: detection only; auto-fix is Step 3.

use anyhow::Result;

use crate::SourceRange;
use crate::lint::rule::Discovered;
use crate::lint::rule::Finding;
use crate::lint::rule::FindingFamily;
use crate::lint::rule::def_finding;
use crate::parsing::ast::types::BodyItem;
use crate::parsing::ast::types::CallExpressionKw;
use crate::parsing::ast::types::Expr;
use crate::parsing::ast::types::Node as AstNode;
use crate::parsing::ast::types::Program;
use crate::walk::Node;

def_finding!(
    Z0006,
    "Prefer edges or edge specifiers over deprecated edge stdlib calls",
    "\
Using 'tags' in fillet/chamfer, 'axis' in revolve/helix, or edge arguments in extrude with deprecated \
stdlib (e.g. getOppositeEdge, getCommonEdge) or direct tags is deprecated. Deprecated stdlib usage \
in getBoundedEdge 'edge' arguments is also deprecated. Prefer 'edges' (fillet/chamfer) or an edge \
specifier object such as { sideFaces = [tag1, tag2] }. \
The auto-fix will convert it.
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

fn is_extrude(callee_name: &str) -> bool {
    callee_name == "extrude"
}

fn is_get_bounded_edge(callee_name: &str) -> bool {
    callee_name == "getBoundedEdge"
}

fn is_gdt_edge_command(callee_name: &str) -> bool {
    matches!(
        callee_name,
        "straightness"
            | "circularity"
            | "cylindricity"
            | "profile"
            | "profileLine"
            | "position"
            | "distance"
            | "angularity"
            | "concentricity"
            | "symmetry"
            | "runout"
            | "perpendicularity"
            | "parallelism"
            | "annotation"
    )
}

/// Axis argument for revolve/helix: axis = getOppositeEdge(...) etc.
fn get_axis_arg(call: &CallExpressionKw) -> Option<&Expr> {
    let axis_arg = call
        .arguments
        .iter()
        .find(|arg| arg.label.as_ref().map(|l| l.name.as_str()).unwrap_or("") == "axis")?;
    Some(&axis_arg.arg)
}

fn get_arg<'a>(call: &'a CallExpressionKw, label: &str) -> Option<&'a Expr> {
    let arg = call
        .arguments
        .iter()
        .find(|arg| arg.label.as_ref().map(|l| l.name.as_str()).unwrap_or("") == label)?;
    Some(&arg.arg)
}

fn deprecated_extrude_edge_arguments(call: &CallExpressionKw, prog: &AstNode<Program>) -> Vec<&'static str> {
    let mut arguments = Vec::with_capacity(3);
    if call
        .unlabeled
        .as_ref()
        .is_some_and(|expr| is_deprecated_edge_stdlib_or_variable_expr(expr, prog))
    {
        arguments.push("target");
    }
    for label in ["to", "direction"] {
        if get_arg(call, label).is_some_and(|expr| {
            is_deprecated_edge_stdlib_or_variable_expr(expr, prog)
                || (label == "direction" && is_direct_sketch_segment_ref(expr))
        }) {
            arguments.push(label);
        }
    }
    arguments
}

fn is_direct_sketch_segment_ref(expr: &Expr) -> bool {
    let Expr::MemberExpression(member) = expr else {
        return false;
    };
    matches!((&member.object, &member.property), (Expr::Name(_), Expr::Name(_)))
}

fn is_deprecated_edge_stdlib(callee_name: &str) -> bool {
    DEPRECATED_EDGE_STDLIB.contains(&callee_name)
}

fn is_deprecated_edge_stdlib_expr(expr: &Expr) -> bool {
    if let Expr::CallExpressionKw(inner) = expr {
        is_deprecated_edge_stdlib(inner.callee.name.name.as_str())
    } else {
        false
    }
}

fn top_level_variable_init<'a>(prog: &'a AstNode<Program>, variable_name: &str) -> Option<&'a Expr> {
    prog.body.iter().find_map(|item| {
        let BodyItem::VariableDeclaration(var_decl) = item else {
            return None;
        };
        (var_decl.declaration.id.name == variable_name).then_some(&var_decl.declaration.init)
    })
}

fn is_deprecated_edge_stdlib_or_variable_expr(expr: &Expr, prog: &AstNode<Program>) -> bool {
    if is_deprecated_edge_stdlib_expr(expr) {
        return true;
    }

    let Expr::Name(name) = expr else {
        return false;
    };
    top_level_variable_init(prog, name.name.name.as_str()).is_some_and(is_deprecated_edge_stdlib_expr)
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

/// Elements to check for deprecated usage in GD&T: from edges = [a, b] or edges = singleExpr.
fn get_edges_elements(call: &CallExpressionKw) -> Option<Vec<&Expr>> {
    let edges_arg = call
        .arguments
        .iter()
        .find(|arg| arg.label.as_ref().map(|l| l.name.as_str()).unwrap_or("") == "edges")?;
    Some(match &edges_arg.arg {
        Expr::ArrayExpression(arr) => arr.elements.iter().collect(),
        single => vec![single],
    })
}

/// True if the expression is a direct tag reference (e.g. identifier `e1` or `body.sketch.tags.e1`), not a call.
fn is_direct_tag_ref(element: &Expr) -> bool {
    if matches!(element, Expr::Name(_)) {
        return true;
    }

    let Expr::MemberExpression(member) = element else {
        return false;
    };
    let Expr::Name(_) = &member.property else {
        return false;
    };
    let Expr::MemberExpression(tags_member) = &member.object else {
        return false;
    };
    let Expr::Name(tags_property) = &tags_member.property else {
        return false;
    };
    tags_property.name.name == "tags"
}

/// Lint: prefer edges/edge specifiers over deprecated tags/axis usage.
pub fn lint_deprecated_edge_stdlib_in_fillet_chamfer(node: Node, prog: &AstNode<Program>) -> Result<Vec<Discovered>> {
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
            let any_deprecated = elements
                .iter()
                .any(|el| is_deprecated_edge_stdlib_or_variable_expr(el, prog));
            let any_direct = elements.iter().any(|el| is_direct_tag_ref(el));
            if any_deprecated || any_direct {
                let pos = SourceRange::new(call_node.start, call_node.end, call_node.module_id);
                findings.push(Z0006.at(format!("{} uses 'tags'; prefer edges", callee_name), pos, None));
            }
        }
    } else if is_revolve_or_helix(callee_name)
        && let Some(axis_expr) = get_axis_arg(call_node)
        && is_deprecated_edge_stdlib_or_variable_expr(axis_expr, prog)
    {
        let pos = SourceRange::new(call_node.start, call_node.end, call_node.module_id);
        findings.push(Z0006.at(
            format!(
                "{} uses 'axis' with deprecated stdlib; prefer an edge specifier object",
                callee_name
            ),
            pos,
            None,
        ));
    } else if is_extrude(callee_name) {
        let deprecated_arguments = deprecated_extrude_edge_arguments(call_node, prog);
        if !deprecated_arguments.is_empty() {
            let pos = SourceRange::new(call_node.start, call_node.end, call_node.module_id);
            findings.push(Z0006.at(
                format!(
                    "extrude uses {} with deprecated edge stdlib; prefer edge specifier {{ sideFaces = [...] }}",
                    deprecated_arguments.join(" and ")
                ),
                pos,
                None,
            ));
        }
    } else if is_get_bounded_edge(callee_name)
        && let Some(edge_expr) = get_arg(call_node, "edge")
        && let Expr::CallExpressionKw(inner) = edge_expr
        && is_deprecated_edge_stdlib(inner.callee.name.name.as_str())
    {
        let pos = SourceRange::new(call_node.start, call_node.end, call_node.module_id);
        findings.push(Z0006.at(
            "getBoundedEdge uses 'edge' with deprecated stdlib; prefer an edge specifier object".to_string(),
            pos,
            None,
        ));
    } else if is_gdt_edge_command(callee_name)
        && let Some(elements) = get_edges_elements(call_node)
        && elements
            .iter()
            .any(|el| is_deprecated_edge_stdlib_or_variable_expr(el, prog))
    {
        let pos = SourceRange::new(call_node.start, call_node.end, call_node.module_id);
        findings.push(Z0006.at(
            format!(
                "gdt::{} uses 'edges' with deprecated stdlib; prefer edge specifier objects",
                callee_name
            ),
            pos,
            None,
        ));
    } else if callee_name == "distance"
        && ["from", "to"]
            .iter()
            .filter_map(|label| get_arg(call_node, label))
            .any(|expr| is_deprecated_edge_stdlib_or_variable_expr(expr, prog))
    {
        let pos = SourceRange::new(call_node.start, call_node.end, call_node.module_id);
        findings.push(Z0006.at(
            "gdt::distance uses 'from' or 'to' with deprecated stdlib; prefer edge specifier objects".to_string(),
            pos,
            None,
        ));
    }

    Ok(findings)
}

#[cfg(test)]
mod tests {
    use super::Z0006;
    use super::lint_deprecated_edge_stdlib_in_fillet_chamfer;

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
            z0006[0].description.contains("tags") || z0006[0].description.contains("edge specifiers"),
            "description should mention tags or edge specifiers"
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
    fn z0006_detects_member_direct_tags_in_fillet() {
        let kcl = r#"body = startSketchOn(XY)
  |> startProfile(at = [0, 0])
  |> line(endAbsolute = [10, 0], tag = $e1)
  |> line(endAbsolute = [10, 10])
  |> line(endAbsolute = [0, 10])
  |> line(endAbsolute = [0, 0])
  |> close()
  |> extrude(length = 5, tagStart = $capStart001)
fillet(body, radius = 1, tags = [body.sketch.tags.e1])
"#;
        let prog = crate::Program::parse_no_errs(kcl).unwrap();
        let findings = prog.lint(lint_deprecated_edge_stdlib_in_fillet_chamfer).unwrap();
        let z0006: Vec<_> = findings.iter().filter(|d| d.finding.code == Z0006.code).collect();
        assert_eq!(z0006.len(), 1, "expected one Z0006 for fillet with member direct tags");
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
    fn z0006_fires_for_revolve_with_deprecated_axis_variable() {
        let kcl = r#"axisEdge = getOppositeEdge(seg01)
revolve(profile, axis = axisEdge)
"#;
        let prog = crate::Program::parse_no_errs(kcl).unwrap();
        let findings = prog.lint(lint_deprecated_edge_stdlib_in_fillet_chamfer).unwrap();
        let z0006: Vec<_> = findings.iter().filter(|d| d.finding.code == Z0006.code).collect();
        assert_eq!(z0006.len(), 1, "Z0006 fires for revolve with deprecated axis variable");
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

    #[test]
    fn z0006_fires_for_extrude_with_deprecated_to() {
        let kcl = r#"extrude(cylinder3, to = getCommonEdge(faces = [facetag0, facetag1]))
"#;
        let prog = crate::Program::parse_no_errs(kcl).unwrap();
        let findings = prog.lint(lint_deprecated_edge_stdlib_in_fillet_chamfer).unwrap();
        let z0006: Vec<_> = findings.iter().filter(|d| d.finding.code == Z0006.code).collect();
        assert_eq!(z0006.len(), 1, "Z0006 fires for extrude with deprecated to");
        assert!(
            z0006[0].description.contains("to") || z0006[0].description.contains("sideFaces"),
            "description should mention to or sideFaces"
        );
    }

    #[test]
    fn z0006_fires_for_get_bounded_edge_with_deprecated_edge() {
        let kcl = r#"blend([
  getBoundedEdge(surface001, edge = getOppositeEdge(edge1)),
  edge2,
])
"#;
        let prog = crate::Program::parse_no_errs(kcl).unwrap();
        let findings = prog.lint(lint_deprecated_edge_stdlib_in_fillet_chamfer).unwrap();
        let z0006: Vec<_> = findings.iter().filter(|d| d.finding.code == Z0006.code).collect();
        assert_eq!(z0006.len(), 1, "Z0006 fires for getBoundedEdge with deprecated edge");
        assert!(
            z0006[0].description.contains("getBoundedEdge") || z0006[0].description.contains("edge"),
            "description should mention getBoundedEdge or edge"
        );
    }

    #[test]
    fn z0006_fires_for_extrude_with_deprecated_to_variable() {
        let kcl = r#"targetEdge = getCommonEdge(faces = [facetag0, facetag1])
extrude(cylinder3, to = targetEdge)
"#;
        let prog = crate::Program::parse_no_errs(kcl).unwrap();
        let findings = prog.lint(lint_deprecated_edge_stdlib_in_fillet_chamfer).unwrap();
        let z0006: Vec<_> = findings.iter().filter(|d| d.finding.code == Z0006.code).collect();
        assert_eq!(z0006.len(), 1, "Z0006 fires for extrude with deprecated to variable");
    }

    #[test]
    fn z0006_fires_for_extrude_with_deprecated_target() {
        let kcl = r#"extrude(getOppositeEdge(edge1), length = 5, bodyType = SURFACE)
"#;
        let prog = crate::Program::parse_no_errs(kcl).unwrap();
        let findings = prog.lint(lint_deprecated_edge_stdlib_in_fillet_chamfer).unwrap();
        let z0006: Vec<_> = findings.iter().filter(|d| d.finding.code == Z0006.code).collect();
        assert_eq!(
            z0006.len(),
            1,
            "Z0006 fires for an extrude target using deprecated edge stdlib"
        );
        assert!(z0006[0].description.contains("target"));
    }

    #[test]
    fn z0006_fires_for_extrude_with_deprecated_direction_variable() {
        let kcl = r#"directionEdge = getOppositeEdge(edge1)
extrude(profile, length = 5, direction = directionEdge)
"#;
        let prog = crate::Program::parse_no_errs(kcl).unwrap();
        let findings = prog.lint(lint_deprecated_edge_stdlib_in_fillet_chamfer).unwrap();
        let z0006: Vec<_> = findings.iter().filter(|d| d.finding.code == Z0006.code).collect();
        assert_eq!(
            z0006.len(),
            1,
            "Z0006 fires for an extrude direction using deprecated edge stdlib"
        );
        assert!(z0006[0].description.contains("direction"));
    }

    #[test]
    fn z0006_fires_for_extrude_with_direct_segment_direction() {
        let kcl = r#"extrude(profile, length = 5, direction = sketch001.line3)
"#;
        let prog = crate::Program::parse_no_errs(kcl).unwrap();
        let findings = prog.lint(lint_deprecated_edge_stdlib_in_fillet_chamfer).unwrap();
        let z0006: Vec<_> = findings.iter().filter(|d| d.finding.code == Z0006.code).collect();
        assert_eq!(z0006.len(), 1, "Z0006 fires for a direct segment direction");
        assert!(z0006[0].description.contains("direction"));
    }

    #[test]
    fn z0006_fires_for_gdt_with_deprecated_edges() {
        let kcl = r#"gdt::straightness(edges = [getCommonEdge(faces = [face1, face2])], tolerance = 0.1mm)
"#;
        let prog = crate::Program::parse_no_errs(kcl).unwrap();
        let findings = prog.lint(lint_deprecated_edge_stdlib_in_fillet_chamfer).unwrap();
        let z0006: Vec<_> = findings.iter().filter(|d| d.finding.code == Z0006.code).collect();
        assert_eq!(z0006.len(), 1, "Z0006 fires for GD&T with deprecated edges");
        assert!(
            z0006[0].description.contains("edges"),
            "description should mention edges"
        );
    }

    #[test]
    fn z0006_fires_for_gdt_distance_with_deprecated_from_to() {
        let kcl = r#"gdt::distance(
  from = getCommonEdge(faces = [face1, face2]),
  to = getCommonEdge(faces = [face3, face4]),
  tolerance = 0.1mm,
)
"#;
        let prog = crate::Program::parse_no_errs(kcl).unwrap();
        let findings = prog.lint(lint_deprecated_edge_stdlib_in_fillet_chamfer).unwrap();
        let z0006: Vec<_> = findings.iter().filter(|d| d.finding.code == Z0006.code).collect();
        assert_eq!(z0006.len(), 1, "Z0006 fires for GD&T distance with deprecated from/to");
        assert!(
            z0006[0].description.contains("from") || z0006[0].description.contains("to"),
            "description should mention from or to"
        );
    }

    #[test]
    fn z0006_does_not_fire_for_gdt_direct_edge() {
        let kcl = r#"gdt::straightness(edges = [edge1], tolerance = 0.1mm)
"#;
        let prog = crate::Program::parse_no_errs(kcl).unwrap();
        let findings = prog.lint(lint_deprecated_edge_stdlib_in_fillet_chamfer).unwrap();
        let z0006: Vec<_> = findings.iter().filter(|d| d.finding.code == Z0006.code).collect();
        assert!(z0006.is_empty(), "Z0006 should not fire for GD&T direct edge refs");
    }
}
