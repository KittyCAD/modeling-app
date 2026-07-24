use anyhow::Result;

use crate::SourceRange;
use crate::lint::rule::Discovered;
use crate::lint::rule::Finding;
use crate::lint::rule::FindingFamily;
use crate::lint::rule::def_finding;
use crate::parsing::ast::types::Node as AstNode;
use crate::parsing::ast::types::Program;
use crate::walk::Node;

def_finding!(
    Z0007,
    "Legacy angle constraint can be converted to angleDimension",
    "The angle function does not identify a directed angle sector. Convert it to angleDimension to preserve the currently solved sector explicitly.",
    FindingFamily::Simplify
);

pub fn lint_legacy_angle(node: Node, _prog: &AstNode<Program>) -> Result<Vec<Discovered>> {
    let Node::CallExpressionKw(call) = node else {
        return Ok(vec![]);
    };
    if call.callee.name.name != "angle" || call.unlabeled.is_none() {
        return Ok(vec![]);
    }

    let source_range = SourceRange::new(call.start, call.end, call.module_id);
    Ok(vec![Z0007.at(
        "angle can be converted to an explicit angleDimension sector".to_owned(),
        source_range,
        None,
    )])
}

#[cfg(test)]
mod tests {
    use super::Z0007;
    use super::lint_legacy_angle;

    #[test]
    fn finds_legacy_angle_calls() {
        let program = crate::Program::parse_no_errs("sketch(on = XY) { angle([line1, line2]) == 60deg }").unwrap();
        let findings = program.lint(lint_legacy_angle).unwrap();
        assert_eq!(findings.len(), 1);
        assert_eq!(findings[0].finding.code, Z0007.code);
    }

    #[test]
    fn ignores_angle_dimension_calls() {
        let program = crate::Program::parse_no_errs(
            "sketch(on = XY) { angleDimension(lines = [line1, line2], sector = 1) == 60deg }",
        )
        .unwrap();
        assert!(program.lint(lint_legacy_angle).unwrap().is_empty());
    }
}
