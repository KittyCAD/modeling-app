use anyhow::Result;

use crate::SourceRange;
use crate::lint::rule::Discovered;
use crate::lint::rule::Finding;
use crate::lint::rule::FindingFamily;
use crate::lint::rule::def_finding;
use crate::parsing::ast::types::BinaryExpression;
use crate::parsing::ast::types::BinaryOperator;
use crate::parsing::ast::types::BinaryPart;
use crate::parsing::ast::types::LiteralValue;
use crate::parsing::ast::types::Node as AstNode;
use crate::parsing::ast::types::Program;
use crate::parsing::ast::types::UnaryOperator;
use crate::parsing::token::NumericSuffix;
use crate::walk::Node;

def_finding!(
    Z0008,
    "Legacy angle constraint can be converted to parallel",
    "A literal angle that is a multiple of 180deg constrains the lines to be parallel. Use parallel to express the constraint directly.",
    FindingFamily::Simplify
);

fn literal_number(part: &BinaryPart) -> Option<(f64, NumericSuffix)> {
    let (sign, literal) = match part {
        BinaryPart::Literal(literal) => (1.0, literal),
        BinaryPart::UnaryExpression(unary) if unary.operator == UnaryOperator::Neg => {
            let BinaryPart::Literal(literal) = &unary.argument else {
                return None;
            };
            (-1.0, literal)
        }
        _ => return None,
    };
    let LiteralValue::Number { value, suffix } = literal.value else {
        return None;
    };
    Some((sign * value, suffix))
}

fn legacy_angle_call_source_range(part: &BinaryPart) -> Option<SourceRange> {
    let BinaryPart::CallExpressionKw(call) = part else {
        return None;
    };
    if call.callee.name.name != "angle" || call.unlabeled.is_none() {
        return None;
    }
    Some(SourceRange::new(call.start, call.end, call.module_id))
}

pub(super) fn legacy_angle_constraint(binary: &AstNode<BinaryExpression>) -> Option<(SourceRange, &BinaryPart)> {
    if binary.operator != BinaryOperator::Eq {
        return None;
    }
    if let Some(source_range) = legacy_angle_call_source_range(&binary.left) {
        return Some((source_range, &binary.right));
    }
    legacy_angle_call_source_range(&binary.right).map(|source_range| (source_range, &binary.left))
}

fn is_literal_parallel_angle(part: &BinaryPart) -> bool {
    let Some((value, suffix)) = literal_number(part) else {
        return false;
    };
    match suffix {
        // A unitless zero is independent of the program's default angle unit.
        NumericSuffix::None | NumericSuffix::Count => value == 0.0,
        NumericSuffix::Deg => value % 180.0 == 0.0,
        // Zero is the only radian literal that can exactly express a multiple
        // of pi without evaluating an expression or using a tolerance.
        NumericSuffix::Rad => value == 0.0,
        _ => false,
    }
}

pub fn lint_legacy_angle_to_parallel(node: Node, _prog: &AstNode<Program>) -> Result<Vec<Discovered>> {
    let Node::BinaryExpression(binary) = node else {
        return Ok(vec![]);
    };
    let Some((source_range, angle)) = legacy_angle_constraint(binary) else {
        return Ok(vec![]);
    };
    if !is_literal_parallel_angle(angle) {
        return Ok(vec![]);
    }

    Ok(vec![Z0008.at(
        "angle can be converted to parallel".to_owned(),
        source_range,
        None,
    )])
}

#[cfg(test)]
mod tests {
    use super::Z0008;
    use super::lint_legacy_angle_to_parallel;

    fn lint_angle(angle: &str) -> Vec<crate::lint::Discovered> {
        let code = format!("sketch(on = XY) {{ angle([line1, line2]) == {angle} }}");
        let program = crate::Program::parse_no_errs(&code).unwrap();
        program.lint(lint_legacy_angle_to_parallel).unwrap()
    }

    #[test]
    fn finds_parallel_angle_literals() {
        for angle in [
            "0", "0deg", "0rad", "180deg", "360deg", "540deg", "-180deg", "-360deg", "-540deg",
        ] {
            let findings = lint_angle(angle);
            assert_eq!(findings.len(), 1, "angle: {angle}");
            assert_eq!(findings[0].finding.code, Z0008.code, "angle: {angle}");
        }
    }

    #[test]
    fn ignores_non_parallel_or_non_literal_angles() {
        for angle in [
            "90deg",
            "270deg",
            "3.141592653589793rad",
            "180deg + 180deg",
            "180deg + 0",
            "2 * 180deg",
            "targetAngle",
            "getAngle()",
        ] {
            assert!(lint_angle(angle).is_empty(), "angle: {angle}");
        }
    }

    #[test]
    fn ignores_angle_dimension() {
        let program = crate::Program::parse_no_errs(
            "sketch(on = XY) { angleDimension(lines = [line1, line2], sector = 1) == 180deg }",
        )
        .unwrap();
        assert!(program.lint(lint_legacy_angle_to_parallel).unwrap().is_empty());
    }

    #[test]
    fn finds_angle_call_on_the_right_side_of_equality() {
        let program = crate::Program::parse_no_errs("sketch(on = XY) { -180deg == angle([line1, line2]) }").unwrap();
        let findings = program.lint(lint_legacy_angle_to_parallel).unwrap();
        assert_eq!(findings.len(), 1);
        assert_eq!(findings[0].finding.code, Z0008.code);
    }

    #[test]
    fn replaces_the_general_legacy_angle_lint() {
        let program = crate::Program::parse_no_errs("sketch(on = XY) { angle([line1, line2]) == -180deg }").unwrap();
        let findings = program.lint_all().unwrap();
        assert!(findings.iter().any(|finding| finding.finding.code == Z0008.code));
        assert!(
            findings
                .iter()
                .all(|finding| finding.finding.code != crate::lint::checks::Z0007.code)
        );
    }

    #[test]
    fn leaves_identifier_values_to_the_general_legacy_angle_lint() {
        let program = crate::Program::parse_no_errs("x = 0\nsketch(on = XY) { angle([line1, line2]) == x }").unwrap();
        let findings = program.lint_all().unwrap();
        assert!(
            findings
                .iter()
                .any(|finding| finding.finding.code == crate::lint::checks::Z0007.code)
        );
        assert!(findings.iter().all(|finding| finding.finding.code != Z0008.code));
    }
}
