// TODO optimise size of CompilationError
#![allow(clippy::result_large_err)]

use super::CompilationError;
use crate::{
    SourceRange,
    parsing::ast::types::{BinaryExpression, BinaryOperator, BinaryPart, Node},
};

/// Parses a list of tokens (in infix order, i.e. as the user typed them)
/// into a binary expression tree.
pub fn parse(infix_tokens: Vec<BinaryExpressionToken>) -> Result<Node<BinaryExpression>, CompilationError> {
    let rpn = postfix(infix_tokens);
    evaluate(rpn)
}

/// Parses a list of tokens (in postfix order) into a binary expression tree.
fn evaluate(rpn: Vec<BinaryExpressionToken>) -> Result<Node<BinaryExpression>, CompilationError> {
    let source_range = source_range(&rpn);
    let mut operand_stack: Vec<BinaryPart> = Vec::new();
    let e = CompilationError::fatal(source_range, "error parsing binary math expressions");
    for item in rpn {
        let expr = match item {
            BinaryExpressionToken::Operator(operator) => {
                let Some(right) = operand_stack.pop() else {
                    return Err(e);
                };
                let Some(left) = operand_stack.pop() else {
                    return Err(e);
                };
                let start = left.start();
                let end = right.end();
                let module_id = left.module_id();

                BinaryPart::BinaryExpression(Node::boxed(
                    BinaryExpression {
                        operator,
                        left,
                        right,
                        digest: None,
                    },
                    start,
                    end,
                    module_id,
                ))
            }
            BinaryExpressionToken::Operand(o) => o,
        };
        operand_stack.push(expr)
    }
    if let Some(BinaryPart::BinaryExpression(expr)) = operand_stack.pop() {
        Ok(*expr)
    } else {
        // If this branch is used, the evaluation algorithm has a bug and must be fixed.
        // This is a programmer error, not a user error.
        Err(e)
    }
}

fn source_range(tokens: &[BinaryExpressionToken]) -> SourceRange {
    let sources: Vec<_> = tokens
        .iter()
        .filter_map(|op| match op {
            BinaryExpressionToken::Operator(_) => None,
            BinaryExpressionToken::Operand(o) => Some((o.start(), o.end(), o.module_id())),
        })
        .collect();
    match (sources.first(), sources.last()) {
        (Some((start, _, module_id)), Some((_, end, _))) => SourceRange::new(*start, *end, *module_id),
        _ => panic!(),
    }
}

/// Reorders tokens from infix order to postfix order.
fn postfix(infix: Vec<BinaryExpressionToken>) -> Vec<BinaryExpressionToken> {
    let mut operator_stack: Vec<BinaryOperator> = Vec::with_capacity(infix.len());
    let mut output = Vec::with_capacity(infix.len());
    for token in infix {
        match token {
            BinaryExpressionToken::Operator(o1) => {
                // From https://en.wikipedia.org/wiki/Shunting_yard_algorithm:
                // while (
                //     there is an operator o2 at the top of the operator stack which is not a left parenthesis,
                //     and (o2 has greater precedence than o1 or (o1 and o2 have the same precedence and o1 is left-associative))
                // )
                // pop o2 from the operator stack into the output queue
                while let Some(o2) = operator_stack.pop() {
                    if (o2.precedence() > o1.precedence())
                        || o1.precedence() == o2.precedence() && o1.associativity().is_left()
                    {
                        output.push(BinaryExpressionToken::Operator(o2));
                    } else {
                        operator_stack.push(o2);
                        break;
                    }
                }
                operator_stack.push(o1);
            }
            o @ BinaryExpressionToken::Operand(_) => output.push(o),
        }
    }
    // After the while loop, pop the remaining items from the operator stack into the output queue.
    output.extend(operator_stack.into_iter().rev().map(BinaryExpressionToken::Operator));
    output
}

/// Expressions are made up of operators and operands.
#[derive(PartialEq, Debug)]
pub enum BinaryExpressionToken {
    Operator(BinaryOperator),
    Operand(BinaryPart),
}

impl From<BinaryPart> for BinaryExpressionToken {
    fn from(value: BinaryPart) -> Self {
        Self::Operand(value)
    }
}

impl From<BinaryOperator> for BinaryExpressionToken {
    fn from(value: BinaryOperator) -> Self {
        Self::Operator(value)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        ModuleId,
        parsing::{
            ast::types::{Literal, LiteralValue},
            token::NumericSuffix,
        },
    };

    #[test]
    fn parse_and_evaluate() {
        /// Make a literal
        fn lit(n: u8) -> BinaryPart {
            BinaryPart::Literal(Box::new(Node::new(
                Literal {
                    value: LiteralValue::Number {
                        value: n as f64,
                        suffix: NumericSuffix::None,
                    },
                    raw: n.to_string(),
                    digest: None,
                },
                0,
                0,
                ModuleId::default(),
            )))
        }
        let tests: Vec<Vec<BinaryExpressionToken>> = vec![
            // 3 + 4 × 2 ÷ ( 1 − 5 ) ^ 2 ^ 3
            vec![
                lit(3).into(),
                BinaryOperator::Add.into(),
                lit(4).into(),
                BinaryOperator::Mul.into(),
                lit(2).into(),
                BinaryOperator::Div.into(),
                BinaryPart::BinaryExpression(Node::boxed(
                    BinaryExpression {
                        operator: BinaryOperator::Sub,
                        left: lit(1),
                        right: lit(5),
                        digest: None,
                    },
                    0,
                    0,
                    ModuleId::default(),
                ))
                .into(),
                BinaryOperator::Pow.into(),
                lit(2).into(),
                BinaryOperator::Pow.into(),
                lit(3).into(),
            ],
        ];
        for infix_input in tests {
            let rpn = postfix(infix_input);
            let _tree = evaluate(rpn).unwrap();
        }
    }
}
