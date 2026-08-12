use std::cell::RefCell;
use std::collections::HashSet;
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
use crate::parsing::ast::types::BodyItem;
use crate::parsing::ast::types::Expr;
use crate::parsing::ast::types::ImportSelector;
use crate::parsing::ast::types::LiteralValue;
use crate::parsing::ast::types::Name;
use crate::parsing::ast::types::Node as AstNode;
use crate::parsing::ast::types::Parameter;
use crate::parsing::ast::types::Program;
use crate::parsing::ast::types::UnaryOperator;
use crate::parsing::ast::types::VariableDeclarator;
use crate::parsing::ast::types::VariableKind;
use crate::parsing::ast::types::body_item_defined_names;
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

enum StaticBinding<'a> {
    Constant(&'a AstNode<VariableDeclarator>),
    Runtime,
}

struct LexicalScope<'a> {
    range: SourceRange,
    body: &'a [BodyItem],
    params: Option<&'a [Parameter]>,
    function_name: Option<&'a str>,
}

struct StaticEvaluator<'a> {
    program: &'a AstNode<Program>,
    // A declaration can only be evaluated once in the current dependency chain.
    resolving: HashSet<SourceRange>,
}

impl<'a> StaticEvaluator<'a> {
    fn new(program: &'a AstNode<Program>) -> Self {
        Self {
            program,
            resolving: HashSet::new(),
        }
    }

    fn eval_part(&mut self, part: &BinaryPart) -> Option<StaticNumber> {
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
                let value = self.eval_part(&unary.argument)?;
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
            BinaryPart::BinaryExpression(binary) => self.eval_binary_expression(binary),
            BinaryPart::Name(name) => self.eval_name(name),
            BinaryPart::CallExpressionKw(_)
            | BinaryPart::MemberExpression(_)
            | BinaryPart::ArrayExpression(_)
            | BinaryPart::ArrayRangeExpression(_)
            | BinaryPart::ObjectExpression(_)
            | BinaryPart::IfExpression(_)
            | BinaryPart::AscribedExpression(_)
            | BinaryPart::SketchVar(_) => None,
        }
    }

    fn eval_expr(&mut self, expr: &Expr) -> Option<StaticNumber> {
        match expr {
            Expr::Literal(literal) => {
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
            Expr::Name(name) => self.eval_name(name),
            Expr::BinaryExpression(binary) => self.eval_binary_expression(binary),
            Expr::UnaryExpression(unary) => {
                let value = self.eval_part(&unary.argument)?;
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
            Expr::TagDeclarator(_)
            | Expr::FunctionExpression(_)
            | Expr::CallExpressionKw(_)
            | Expr::PipeExpression(_)
            | Expr::PipeSubstitution(_)
            | Expr::ArrayExpression(_)
            | Expr::ArrayRangeExpression(_)
            | Expr::ObjectExpression(_)
            | Expr::MemberExpression(_)
            | Expr::IfExpression(_)
            | Expr::LabelledExpression(_)
            | Expr::AscribedExpression(_)
            | Expr::SketchBlock(_)
            | Expr::SketchVar(_)
            | Expr::None(_) => None,
        }
    }

    fn eval_name(&mut self, name: &AstNode<Name>) -> Option<StaticNumber> {
        if name.abs_path || !name.path.is_empty() {
            return None;
        }

        let StaticBinding::Constant(declaration) = self.resolve_name(&name.name.name, name.into())? else {
            // `StaticBinding::Runtime` means this name cannot be proven constant
            // by this lint. For example, a function parameter (`@turns`) or a
            // constant derived from it (`angle = turns * 180deg`) may have a
            // different value on each call, so it is not safe to refactor.
            return None;
        };
        let declaration_range = SourceRange::from(declaration);
        if !self.resolving.insert(declaration_range) {
            return None;
        }
        let result = self.eval_expr(&declaration.init);
        self.resolving.remove(&declaration_range);
        result
    }

    fn resolve_name(&self, name: &str, use_range: SourceRange) -> Option<StaticBinding<'a>> {
        let mut scopes = self.scopes_containing(use_range);
        scopes.sort_by_key(|scope| {
            (
                scope.range.end() - scope.range.start(),
                usize::from(scope.params.is_none()),
            )
        });

        scopes
            .into_iter()
            .find_map(|scope| Self::binding_in_scope(scope, name, use_range))
    }

    fn scopes_containing(&self, use_range: SourceRange) -> Vec<LexicalScope<'a>> {
        let scopes = RefCell::new(Vec::new());
        crate::walk::walk(self.program, |node| {
            match node {
                Node::Program(program)
                    if std::ptr::eq(program, self.program) && SourceRange::from(program).contains_range(&use_range) =>
                {
                    scopes.borrow_mut().push(LexicalScope {
                        range: program.into(),
                        body: &program.body,
                        params: None,
                        function_name: None,
                    });
                }
                Node::FunctionExpression(function) if SourceRange::from(&function.body).contains_range(&use_range) => {
                    scopes.borrow_mut().push(LexicalScope {
                        range: (&function.body).into(),
                        body: &function.body.body,
                        params: Some(&function.params),
                        function_name: function.name.as_ref().map(|name| name.name.as_str()),
                    });
                }
                Node::Block(block) if SourceRange::from(block).contains_range(&use_range) => {
                    scopes.borrow_mut().push(LexicalScope {
                        range: block.into(),
                        body: &block.items,
                        params: None,
                        function_name: None,
                    });
                }
                _ => {}
            }
            Ok::<bool, anyhow::Error>(true)
        })
        .expect("the lexical-scope visitor cannot fail");
        scopes.into_inner()
    }

    fn binding_in_scope(scope: LexicalScope<'a>, name: &str, use_range: SourceRange) -> Option<StaticBinding<'a>> {
        let mut binding = if scope
            .params
            .is_some_and(|params| params.iter().any(|param| param.identifier.name == name))
            || scope.function_name == Some(name)
        {
            Some(StaticBinding::Runtime)
        } else {
            None
        };

        // KCL bindings are order-aware: only declarations before this use are
        // visible. The declaration being initialized cannot resolve to itself.
        for item in scope.body {
            let item_range = SourceRange::from(item);
            if item_range.contains_range(&use_range) || item_range.start() >= use_range.start() {
                break;
            }
            let defines_name = body_item_defined_names(item).iter().any(|defined| defined == name);
            match item {
                BodyItem::ImportStatement(import) => {
                    // Imported values require loading and evaluating another module.
                    if import.get_variable(name) || matches!(import.selector, ImportSelector::Glob(_)) {
                        binding = Some(StaticBinding::Runtime);
                    }
                }
                BodyItem::VariableDeclaration(variable) if variable.declaration.id.name == name => {
                    binding = Some(if variable.kind == VariableKind::Const {
                        StaticBinding::Constant(&variable.declaration)
                    } else {
                        StaticBinding::Runtime
                    });
                }
                BodyItem::TypeDeclaration(declaration) if declaration.name.name == name => {
                    binding = Some(StaticBinding::Runtime);
                }
                _ if defines_name => {
                    // Tags, labels, and named function expressions also bind names.
                    binding = Some(StaticBinding::Runtime);
                }
                BodyItem::ExpressionStatement(_)
                | BodyItem::VariableDeclaration(_)
                | BodyItem::TypeDeclaration(_)
                | BodyItem::ReturnStatement(_) => {}
            }
        }
        binding
    }

    fn eval_binary_expression(&mut self, binary: &AstNode<BinaryExpression>) -> Option<StaticNumber> {
        let left = self.eval_part(&binary.left)?;
        let right = self.eval_part(&binary.right)?;

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
                (StaticNumber::Scalar(left), StaticNumber::Scalar(right)) => {
                    StaticNumber::Scalar(libm::pow(left, right))
                }
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

fn is_static_parallel_angle(part: &BinaryPart, program: &AstNode<Program>) -> bool {
    match StaticEvaluator::new(program).eval_part(part) {
        // A unitless zero is independent of the program's default angle unit.
        Some(StaticNumber::Scalar(value)) => value.abs() <= ANGLE_EPSILON,
        Some(StaticNumber::Angle(value)) => {
            let remainder = value.rem_euclid(PI);
            libm::fmin(remainder, PI - remainder) <= ANGLE_EPSILON
        }
        None => false,
    }
}

pub fn lint_legacy_angle_to_parallel(node: Node, prog: &AstNode<Program>) -> Result<Vec<Discovered>> {
    let Node::BinaryExpression(binary) = node else {
        return Ok(vec![]);
    };
    let Some((source_range, angle)) = legacy_angle_constraint(binary) else {
        return Ok(vec![]);
    };
    if !is_static_parallel_angle(angle, prog) {
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
    use super::StaticEvaluator;
    use super::Z0008;
    use super::lint_legacy_angle_to_parallel;

    fn lint_code(code: &str) -> Vec<crate::lint::Discovered> {
        let program = crate::Program::parse_no_errs(code).unwrap();
        program.lint(lint_legacy_angle_to_parallel).unwrap()
    }

    fn lint_angle(angle: &str) -> Vec<crate::lint::Discovered> {
        let code = format!("sketch(on = XY) {{ angle([line1, line2]) == {angle} }}");
        lint_code(&code)
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
    fn propagates_immutable_constants() {
        let findings = lint_code(
            r#"
halfTurn = 180deg
turns = 2
targetAngle = halfTurn * turns
sketch(on = XY) {
  angle([line1, line2]) == targetAngle
}
"#,
        );
        assert_eq!(findings.len(), 1);
        assert_eq!(findings[0].finding.code, Z0008.code);
    }

    #[test]
    fn does_not_propagate_function_parameters() {
        let findings = lint_code(
            r#"
targetAngle = 180deg
fn constrain(@targetAngle) {
  result = sketch(on = XY) {
    angle([line1, line2]) == targetAngle
  }
  return result
}
"#,
        );
        assert!(findings.is_empty());
    }

    #[test]
    fn does_not_propagate_constants_that_depend_on_function_parameters() {
        let findings = lint_code(
            r#"
fn constrain(@turns) {
  targetAngle = turns * 180deg
  result = sketch(on = XY) {
    angle([line1, line2]) == targetAngle
  }
  return result
}
"#,
        );
        assert!(findings.is_empty());
    }

    #[test]
    fn does_not_propagate_callback_parameters() {
        let findings = lint_code(
            r#"
result = map([180deg], f = fn(@targetAngle) {
  constrained = sketch(on = XY) {
    angle([line1, line2]) == targetAngle
  }
  return constrained
})
"#,
        );
        assert!(findings.is_empty());
    }

    #[test]
    fn propagates_constants_captured_by_functions() {
        let findings = lint_code(
            r#"
targetAngle = 180deg
fn constrain(@unused) {
  result = sketch(on = XY) {
    angle([line1, line2]) == targetAngle
  }
  return result
}
"#,
        );
        assert_eq!(findings.len(), 1);
        assert_eq!(findings[0].finding.code, Z0008.code);
    }

    #[test]
    fn respects_shadowing() {
        let findings = lint_code(
            r#"
targetAngle = 180deg
fn constrain() {
  targetAngle = 90deg
  result = sketch(on = XY) {
    angle([line1, line2]) == targetAngle
  }
  return result
}
"#,
        );
        assert!(findings.is_empty());
    }

    #[test]
    fn respects_tag_shadowing() {
        let findings = lint_code(
            r#"
targetAngle = 180deg
sketch(on = XY) {
  line1 = line(start = [0, 0], end = [1, 0], tag = $targetAngle)
  angle([line1, line2]) == targetAngle
}
"#,
        );
        assert!(findings.is_empty());
    }

    #[test]
    fn a_later_local_binding_does_not_shadow_an_earlier_use() {
        let findings = lint_code(
            r#"
targetAngle = 180deg
fn constrain() {
  result = sketch(on = XY) {
    angle([line1, line2]) == targetAngle
  }
  targetAngle = 90deg
  return result
}
"#,
        );
        assert_eq!(findings.len(), 1);
        assert_eq!(findings[0].finding.code, Z0008.code);
    }

    #[test]
    fn does_not_follow_imported_values() {
        for code in [
            r#"
import targetAngle from "constants.kcl"
sketch(on = XY) {
  angle([line1, line2]) == targetAngle
}
"#,
            r#"
import "constants.kcl" as constants
sketch(on = XY) {
  angle([line1, line2]) == constants::targetAngle
}
"#,
            r#"
import * from "constants.kcl"
sketch(on = XY) {
  angle([line1, line2]) == targetAngle
}
"#,
        ] {
            assert!(lint_code(code).is_empty());
        }
    }

    #[test]
    fn cyclic_dependencies_are_not_static() {
        for declarations in ["targetAngle = targetAngle", "a = b\nb = a\ntargetAngle = a"] {
            let code = format!(
                r#"
{declarations}
sketch(on = XY) {{
  angle([line1, line2]) == targetAngle
}}
"#
            );
            assert!(lint_code(&code).is_empty());
        }
    }

    #[test]
    fn stops_reentering_a_constant_declaration() {
        use crate::parsing::ast::types::BodyItem;
        use crate::parsing::ast::types::Expr;

        let program = crate::Program::parse_no_errs(
            r#"
targetAngle = 180deg
sketch(on = XY) {
  angle([line1, line2]) == targetAngle
}
"#,
        )
        .unwrap();
        let BodyItem::VariableDeclaration(target) = &program.ast.body[0] else {
            panic!("expected targetAngle declaration");
        };
        let BodyItem::ExpressionStatement(sketch) = &program.ast.body[1] else {
            panic!("expected sketch expression");
        };
        let Expr::SketchBlock(sketch) = &sketch.expression else {
            panic!("expected sketch block");
        };
        let BodyItem::ExpressionStatement(constraint) = &sketch.body.items[0] else {
            panic!("expected angle constraint");
        };
        let Expr::BinaryExpression(constraint) = &constraint.expression else {
            panic!("expected binary angle constraint");
        };

        let mut evaluator = StaticEvaluator::new(&program.ast);
        evaluator.resolving.insert((&target.declaration).into());
        assert_eq!(evaluator.eval_part(&constraint.right), None);
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
    fn replaces_the_general_legacy_angle_lint_for_constant_identifiers() {
        let program = crate::Program::parse_no_errs("x = 0\nsketch(on = XY) { angle([line1, line2]) == x }").unwrap();
        let findings = program.lint_all().unwrap();
        assert!(
            findings
                .iter()
                .all(|finding| finding.finding.code != crate::lint::checks::Z0007.code)
        );
        assert!(findings.iter().any(|finding| finding.finding.code == Z0008.code));
    }
}
