use crate::ast::types::{BinaryExpression, BinaryOperator, BinaryPart};

/// Parses a list of tokens (in infix order, i.e. as the user typed them)
/// into a binary expression tree.
pub fn parse(infix_tokens: Vec<BinaryExpressionToken>) -> BinaryExpression {
    let rpn = postfix(infix_tokens);
    evaluate(rpn)
}

/// Parses a list of tokens (in postfix order) into a binary expression tree.
fn evaluate(rpn: Vec<BinaryExpressionToken>) -> BinaryExpression {
    let mut operand_stack = Vec::new();
    for item in rpn {
        let expr = match item {
            BinaryExpressionToken::Operator(operator) => {
                let right: BinaryPart = operand_stack.pop().unwrap();
                let left = operand_stack.pop().unwrap();
                BinaryPart::BinaryExpression(Box::new(BinaryExpression {
                    start: left.start(),
                    end: right.end(),
                    operator,
                    left,
                    right,
                }))
            }
            BinaryExpressionToken::Operand(o) => o,
        };
        operand_stack.push(expr)
    }
    if let BinaryPart::BinaryExpression(expr) = operand_stack.pop().unwrap() {
        *expr
    } else {
        panic!("Last expression was not a binary expression")
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
                while operator_stack
                    .last()
                    .map(|o2| {
                        (o2.precedence() > o1.precedence())
                            || o1.precedence() == o2.precedence() && o1.associativity().is_left()
                    })
                    .unwrap_or(false)
                {
                    output.push(BinaryExpressionToken::Operator(operator_stack.pop().unwrap()));
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
    use crate::ast::types::Literal;

    use super::*;

    #[test]
    fn parse_and_evaluate() {
        /// Make a literal
        fn lit(n: u64) -> BinaryPart {
            BinaryPart::Literal(Box::new(Literal {
                start: 0,
                end: 0,
                value: n.into(),
                raw: n.to_string(),
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
            let tree = evaluate(rpn);
            dbg!(tree);
        }
    }
}
