use crate::{
    ast::types::{BinaryExpression, BinaryOperator, BinaryPart},
    errors::{KclError, KclErrorDetails},
    executor::SourceRange,
};

/// Parses a list of tokens (in infix order, i.e. as the user typed them)
/// into a binary expression tree.
pub fn parse(infix_tokens: Vec<BinaryExpressionToken>) -> Result<BinaryExpression, KclError> {
    let rpn = postfix(infix_tokens);
    evaluate(rpn)
}

/// Parses a list of tokens (in postfix order) into a binary expression tree.
fn evaluate(rpn: Vec<BinaryExpressionToken>) -> Result<BinaryExpression, KclError> {
    let source_ranges = source_range(&rpn);
    let mut operand_stack: Vec<BinaryPart> = Vec::new();
    let e = KclError::Internal(KclErrorDetails {
        source_ranges,
        message: "error parsing binary math expressions".to_owned(),
    });
    for item in rpn {
        let expr = match item {
            BinaryExpressionToken::Operator(operator) => {
                let Some(right) = operand_stack.pop() else {
                    return Err(e);
                };
                let Some(left) = operand_stack.pop() else {
                    return Err(e);
                };
                BinaryPart::BinaryExpression(Box::new(BinaryExpression {
                    start: left.start(),
                    end: right.end(),
                    operator,
                    left,
                    right,
                    digest: None,
                }))
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

fn source_range(tokens: &[BinaryExpressionToken]) -> Vec<SourceRange> {
    let sources: Vec<_> = tokens
        .iter()
        .filter_map(|op| match op {
            BinaryExpressionToken::Operator(_) => None,
            BinaryExpressionToken::Operand(o) => Some((o.start(), o.end())),
        })
        .collect();
    match (sources.first(), sources.last()) {
        (Some((start, _)), Some((_, end))) => vec![SourceRange([*start, *end])],
        _ => Vec::new(),
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
    use crate::ast::types::Literal;

    #[test]
    fn parse_and_evaluate() {
        /// Make a literal
        fn lit(n: u8) -> BinaryPart {
            BinaryPart::Literal(Box::new(Literal {
                start: 0,
                end: 0,
                value: n.into(),
                raw: n.to_string(),
                digest: None,
            }))
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
                BinaryPart::BinaryExpression(Box::new(BinaryExpression {
                    start: 0,
                    end: 0,
                    operator: BinaryOperator::Sub,
                    left: lit(1),
                    right: lit(5),
                    digest: None,
                }))
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
