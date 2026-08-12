use std::f64::consts::PI;

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
    "A constant angle that is a multiple of 180deg constrains the lines to be parallel. Use parallel to express the constraint directly.",
    FindingFamily::Simplify
);

const ANGLE_EPSILON: f64 = 1e-10;

#[derive(Clone, Copy, Debug, PartialEq)]
enum StaticNumber {
    Scalar(f64),
    Angle(f64),
}

impl StaticNumber {
    fn finite(self) -> Option<Self> {
        match self {
            Self::Scalar(value) | Self::Angle(value) if value.is_finite() => Some(self),
            Self::Scalar(_) | Self::Angle(_) => None,
        }
    }
}

fn eval_static_number(part: &BinaryPart) -> Option<StaticNumber> {
    match part {
        BinaryPart::Literal(literal) => {
            let LiteralValue::Number { value, suffix } = literal.value else {
                return None;
            };
            match suffix {
                NumericSuffix::Deg => StaticNumber::Angle(value.to_radians()).finite(),
                NumericSuffix::Rad => StaticNumber::Angle(value).finite(),
                NumericSuffix::None | NumericSuffix::Count => StaticNumber::Scalar(value).finite(),
                _ => None,
            }
        }
        BinaryPart::UnaryExpression(unary) => {
            let value = eval_static_number(&unary.argument)?;
            match unary.operator {
                UnaryOperator::Neg => match value {
                    StaticNumber::Scalar(value) => StaticNumber::Scalar(-value),
                    StaticNumber::Angle(value) => StaticNumber::Angle(-value),
                },
                UnaryOperator::Plus => value,
                UnaryOperator::Not => return None,
            }
            .finite()
        }
        BinaryPart::BinaryExpression(binary) => eval_static_binary_expression(binary),
        BinaryPart::Name(_)
        | BinaryPart::CallExpressionKw(_)
        | BinaryPart::MemberExpression(_)
        | BinaryPart::ArrayExpression(_)
        | BinaryPart::ArrayRangeExpression(_)
        | BinaryPart::ObjectExpression(_)
        | BinaryPart::IfExpression(_)
        | BinaryPart::AscribedExpression(_)
        | BinaryPart::SketchVar(_) => None,
    }
}

fn eval_static_binary_expression(binary: &AstNode<BinaryExpression>) -> Option<StaticNumber> {
    let left = eval_static_number(&binary.left)?;
    let right = eval_static_number(&binary.right)?;

    let result = match binary.operator {
        BinaryOperator::Add => match (left, right) {
            (StaticNumber::Scalar(left), StaticNumber::Scalar(right)) => StaticNumber::Scalar(left + right),
            (StaticNumber::Angle(left), StaticNumber::Angle(right)) => StaticNumber::Angle(left + right),
            (StaticNumber::Angle(angle), StaticNumber::Scalar(0.0))
            | (StaticNumber::Scalar(0.0), StaticNumber::Angle(angle)) => StaticNumber::Angle(angle),
            _ => return None,
        },
        BinaryOperator::Sub => match (left, right) {
            (StaticNumber::Scalar(left), StaticNumber::Scalar(right)) => StaticNumber::Scalar(left - right),
            (StaticNumber::Angle(left), StaticNumber::Angle(right)) => StaticNumber::Angle(left - right),
            (StaticNumber::Angle(angle), StaticNumber::Scalar(0.0)) => StaticNumber::Angle(angle),
            (StaticNumber::Scalar(0.0), StaticNumber::Angle(angle)) => StaticNumber::Angle(-angle),
            _ => return None,
        },
        BinaryOperator::Mul => match (left, right) {
            (StaticNumber::Scalar(left), StaticNumber::Scalar(right)) => StaticNumber::Scalar(left * right),
            (StaticNumber::Scalar(left), StaticNumber::Angle(right))
            | (StaticNumber::Angle(right), StaticNumber::Scalar(left)) => StaticNumber::Angle(left * right),
            (StaticNumber::Angle(_), StaticNumber::Angle(_)) => return None,
        },
        BinaryOperator::Div => match (left, right) {
            (_, StaticNumber::Scalar(0.0) | StaticNumber::Angle(0.0)) => return None,
            (StaticNumber::Scalar(left), StaticNumber::Scalar(right)) => StaticNumber::Scalar(left / right),
            (StaticNumber::Angle(left), StaticNumber::Scalar(right)) => StaticNumber::Angle(left / right),
            (StaticNumber::Angle(left), StaticNumber::Angle(right)) => StaticNumber::Scalar(left / right),
            (StaticNumber::Scalar(_), StaticNumber::Angle(_)) => return None,
        },
        BinaryOperator::Mod => match (left, right) {
            (_, StaticNumber::Scalar(0.0) | StaticNumber::Angle(0.0)) => return None,
            (StaticNumber::Scalar(left), StaticNumber::Scalar(right)) => StaticNumber::Scalar(left % right),
            (StaticNumber::Angle(left), StaticNumber::Angle(right)) => StaticNumber::Angle(left % right),
            _ => return None,
        },
        BinaryOperator::Pow => match (left, right) {
            (StaticNumber::Scalar(left), StaticNumber::Scalar(right)) => StaticNumber::Scalar(left.powf(right)),
            _ => return None,
        },
        BinaryOperator::Eq
        | BinaryOperator::Neq
        | BinaryOperator::Gt
        | BinaryOperator::Gte
        | BinaryOperator::Lt
        | BinaryOperator::Lte
        | BinaryOperator::And
        | BinaryOperator::Or => return None,
    };

    result.finite()
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

pub(super) fn is_static_parallel_angle(part: &BinaryPart) -> bool {
    match eval_static_number(part) {
        // A unitless zero is independent of the program's default angle unit.
        Some(StaticNumber::Scalar(value)) => value.abs() <= ANGLE_EPSILON,
        Some(StaticNumber::Angle(value)) => {
            let remainder = value.rem_euclid(PI);
            remainder.min(PI - remainder) <= ANGLE_EPSILON
        }
        None => false,
    }
}

pub fn lint_legacy_angle_to_parallel(node: Node, _prog: &AstNode<Program>) -> Result<Vec<Discovered>> {
    let Node::BinaryExpression(binary) = node else {
        return Ok(vec![]);
    };
    let Some((source_range, angle)) = legacy_angle_constraint(binary) else {
        return Ok(vec![]);
    };
    if !is_static_parallel_angle(angle) {
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
    fn finds_static_parallel_angle_expressions() {
        for angle in [
            "0",
            "0deg",
            "180deg",
            "360deg",
            "-180deg",
            "540deg",
            "180deg + 180deg",
            "180deg + 0",
            "0 + 180deg",
            "180deg - 0",
            "0 - 180deg",
            "180deg + (2 - 2)",
            "2 * 180deg",
            "360deg / 2",
            "3.141592653589793rad",
        ] {
            let findings = lint_angle(angle);
            assert_eq!(findings.len(), 1, "angle: {angle}");
            assert_eq!(findings[0].finding.code, Z0008.code, "angle: {angle}");
        }
    }

    #[test]
    fn ignores_non_parallel_or_runtime_angle_expressions() {
        for angle in ["90deg", "270deg", "180deg + 1", "targetAngle", "getAngle()"] {
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
        let program = crate::Program::parse_no_errs("sketch(on = XY) { 180deg == angle([line1, line2]) }").unwrap();
        let findings = program.lint(lint_legacy_angle_to_parallel).unwrap();
        assert_eq!(findings.len(), 1);
        assert_eq!(findings[0].finding.code, Z0008.code);
    }

    #[test]
    fn replaces_the_general_legacy_angle_lint() {
        let program = crate::Program::parse_no_errs("sketch(on = XY) { angle([line1, line2]) == 180deg }").unwrap();
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
