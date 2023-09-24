use std::str::FromStr;

use anyhow::Result;
use serde::{Deserialize, Serialize};

use crate::{
    ast::types::{
        BinaryExpression, BinaryOperator, BinaryPart, CallExpression, Identifier, Literal, MemberExpression,
        UnaryExpression, ValueMeta,
    },
    errors::{KclError, KclErrorDetails},
    executor::SourceRange,
    parser::Parser,
    tokeniser::{Token, TokenType},
};

#[derive(Debug, PartialEq, Eq, Deserialize, Serialize, Clone, ts_rs::TS)]
#[ts(export)]
pub enum MathTokenType {
    Number,
    Word,
    Operator,
    String,
    Brace,
    Whitespace,
    Comma,
    Colon,
    Period,
    LineComment,
    BlockComment,
    Parenthesis,
}

#[derive(Debug, PartialEq, Eq, Deserialize, Serialize, Clone, ts_rs::TS)]
#[ts(export)]
#[serde(tag = "type")]
pub struct ParenthesisToken {
    pub token_type: MathTokenType,
    pub value: String,
    pub start: usize,
    pub end: usize,
}

crate::ast::types::impl_value_meta!(ParenthesisToken);

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS)]
#[ts(export)]
#[serde(tag = "type")]
pub struct ExtendedBinaryExpression {
    pub start: usize,
    pub end: usize,
    pub operator: BinaryOperator,
    pub left: BinaryPart,
    pub right: BinaryPart,
    pub start_extended: Option<usize>,
    pub end_extended: Option<usize>,
}

crate::ast::types::impl_value_meta!(ExtendedBinaryExpression);

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS)]
#[ts(export)]
#[serde(tag = "type")]
pub struct ExtendedLiteral {
    pub start: usize,
    pub end: usize,
    pub value: serde_json::Value,
    pub raw: String,
    pub start_extended: Option<usize>,
    pub end_extended: Option<usize>,
}

crate::ast::types::impl_value_meta!(ExtendedLiteral);

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS)]
#[ts(export)]
#[serde(tag = "type")]
pub enum MathExpression {
    ExtendedLiteral(Box<ExtendedLiteral>),
    Identifier(Box<Identifier>),
    CallExpression(Box<CallExpression>),
    BinaryExpression(Box<BinaryExpression>),
    ExtendedBinaryExpression(Box<ExtendedBinaryExpression>),
    ParenthesisToken(Box<ParenthesisToken>),
    MemberExpression(Box<MemberExpression>),
    UnaryExpression(Box<UnaryExpression>),
}

impl MathExpression {
    pub fn start(&self) -> usize {
        match self {
            MathExpression::ExtendedLiteral(literal) => literal.start(),
            MathExpression::Identifier(identifier) => identifier.start(),
            MathExpression::CallExpression(call_expression) => call_expression.start(),
            MathExpression::BinaryExpression(binary_expression) => binary_expression.start(),
            MathExpression::ExtendedBinaryExpression(extended_binary_expression) => extended_binary_expression.start(),
            MathExpression::ParenthesisToken(parenthesis_token) => parenthesis_token.start(),
            MathExpression::MemberExpression(member_expression) => member_expression.start(),
            MathExpression::UnaryExpression(unary_expression) => unary_expression.start(),
        }
    }

    pub fn end(&self) -> usize {
        match self {
            MathExpression::ExtendedLiteral(literal) => literal.end(),
            MathExpression::Identifier(identifier) => identifier.end(),
            MathExpression::CallExpression(call_expression) => call_expression.end(),
            MathExpression::BinaryExpression(binary_expression) => binary_expression.end(),
            MathExpression::ExtendedBinaryExpression(extended_binary_expression) => extended_binary_expression.end(),
            MathExpression::ParenthesisToken(parenthesis_token) => parenthesis_token.end(),
            MathExpression::MemberExpression(member_expression) => member_expression.end(),
            MathExpression::UnaryExpression(unary_expression) => unary_expression.end(),
        }
    }
}

pub struct ReversePolishNotation {
    parser: Parser,
    previous_postfix: Vec<Token>,
    operators: Vec<Token>,
}

impl ReversePolishNotation {
    pub fn new(tokens: &[Token], previous_postfix: &[Token], operators: &[Token]) -> Self {
        Self {
            parser: Parser::new(tokens.to_vec()),
            previous_postfix: previous_postfix.to_vec(),
            operators: operators.to_vec(),
        }
    }

    fn parse(&self) -> Result<Vec<Token>, KclError> {
        if self.parser.tokens.is_empty() {
            return Ok(self
                .previous_postfix
                .iter()
                .cloned()
                .chain(self.operators.iter().cloned().rev())
                .collect());
        }

        let current_token = self.parser.get_token(0)?;
        if current_token.token_type == TokenType::Word {
            if let Ok(next) = self.parser.get_token(1) {
                if next.token_type == TokenType::Brace && next.value == "(" {
                    let closing_brace = self.parser.find_closing_brace(1, 0, "")?;
                    let rpn = ReversePolishNotation::new(
                        &self.parser.tokens[closing_brace + 1..],
                        &self
                            .previous_postfix
                            .iter()
                            .cloned()
                            .chain(self.parser.tokens[0..closing_brace + 1].iter().cloned())
                            .collect::<Vec<Token>>(),
                        &self.operators,
                    );
                    return rpn.parse();
                }
                if (current_token.token_type == TokenType::Word)
                    && (next.token_type == TokenType::Period
                        || (next.token_type == TokenType::Brace && next.value == "["))
                {
                    // Find the end of the binary expression, ie the member expression.
                    let end = self.parser.make_member_expression(0)?.last_index;
                    let rpn = ReversePolishNotation::new(
                        &self.parser.tokens[end + 1..],
                        &self
                            .previous_postfix
                            .iter()
                            .cloned()
                            .chain(self.parser.tokens[0..end + 1].iter().cloned())
                            .collect::<Vec<Token>>(),
                        &self.operators,
                    );
                    return rpn.parse();
                }
            }

            let rpn = ReversePolishNotation::new(
                &self.parser.tokens[1..],
                &self
                    .previous_postfix
                    .iter()
                    .cloned()
                    .chain(vec![current_token.clone()])
                    .collect::<Vec<Token>>(),
                &self.operators,
            );
            return rpn.parse();
        } else if current_token.token_type == TokenType::Number
            || current_token.token_type == TokenType::Word
            || current_token.token_type == TokenType::String
        {
            let rpn = ReversePolishNotation::new(
                &self.parser.tokens[1..],
                &self
                    .previous_postfix
                    .iter()
                    .cloned()
                    .chain(vec![current_token.clone()])
                    .collect::<Vec<Token>>(),
                &self.operators,
            );
            return rpn.parse();
        } else if let Ok(binop) = BinaryOperator::from_str(current_token.value.as_str()) {
            if !self.operators.is_empty() {
                if binop == BinaryOperator::Sub {
                    // We need to check if we have a "sub" and if the previous token is a word or
                    // number or string, then we need to treat it as a negative number.
                    // This oddity only applies to the "-" operator.
                    if let Some(prevtoken) = self.previous_postfix.last() {
                        if prevtoken.token_type == TokenType::Operator {
                            // Get the next token and see if it is a number.
                            if let Ok(nexttoken) = self.parser.get_token(1) {
                                if nexttoken.token_type == TokenType::Number || nexttoken.token_type == TokenType::Word
                                {
                                    // We have a negative number/ word or string.
                                    // Change the value of the token to be the negative number/ word or string.
                                    let mut new_token = nexttoken.clone();
                                    new_token.value = format!("-{}", nexttoken.value);
                                    let rpn = ReversePolishNotation::new(
                                        &self.parser.tokens[2..],
                                        &self
                                            .previous_postfix
                                            .iter()
                                            .cloned()
                                            .chain(vec![new_token.clone()])
                                            .collect::<Vec<Token>>(),
                                        &self.operators,
                                    );
                                    return rpn.parse();
                                }
                            }
                        }
                    }
                }
                if let Ok(prevbinop) = BinaryOperator::from_str(self.operators[self.operators.len() - 1].value.as_str())
                {
                    if prevbinop.precedence() >= binop.precedence() {
                        let rpn = ReversePolishNotation::new(
                            &self.parser.tokens,
                            &self
                                .previous_postfix
                                .iter()
                                .cloned()
                                .chain(vec![self.operators[self.operators.len() - 1].clone()])
                                .collect::<Vec<Token>>(),
                            &self.operators[0..self.operators.len() - 1],
                        );
                        return rpn.parse();
                    }
                }
            } else if self.previous_postfix.is_empty()
                && current_token.token_type == TokenType::Operator
                && current_token.value == "-"
            {
                if let Ok(nexttoken) = self.parser.get_token(1) {
                    if nexttoken.token_type == TokenType::Number || nexttoken.token_type == TokenType::Word {
                        // We have a negative number/ word or string.
                        // Change the value of the token to be the negative number/ word or string.
                        let mut new_token = nexttoken.clone();
                        new_token.value = format!("-{}", nexttoken.value);
                        let rpn = ReversePolishNotation::new(
                            &self.parser.tokens[2..],
                            &self
                                .previous_postfix
                                .iter()
                                .cloned()
                                .chain(vec![new_token.clone()])
                                .collect::<Vec<Token>>(),
                            &self.operators,
                        );
                        return rpn.parse();
                    }
                }
            }

            let rpn = ReversePolishNotation::new(
                &self.parser.tokens[1..],
                &self.previous_postfix,
                &self
                    .operators
                    .iter()
                    .cloned()
                    .chain(vec![current_token.clone()])
                    .collect::<Vec<Token>>(),
            );
            return rpn.parse();
        } else if current_token.value == "(" {
            // push current token to both stacks as it is a legitimate operator
            // but later we'll need to pop other operators off the stack until we find the matching ')'
            let rpn = ReversePolishNotation::new(
                &self.parser.tokens[1..],
                &self
                    .previous_postfix
                    .iter()
                    .cloned()
                    .chain(vec![current_token.clone()])
                    .collect::<Vec<Token>>(),
                &self
                    .operators
                    .iter()
                    .cloned()
                    .chain(vec![current_token.clone()])
                    .collect::<Vec<Token>>(),
            );
            return rpn.parse();
        } else if current_token.value == ")" && !self.operators.is_empty() {
            if self.operators[self.operators.len() - 1].value != "(" {
                // pop operators off the stack and push them to postFix until we find the matching '('
                let rpn = ReversePolishNotation::new(
                    &self.parser.tokens,
                    &self
                        .previous_postfix
                        .iter()
                        .cloned()
                        .chain(vec![self.operators[self.operators.len() - 1].clone()])
                        .collect::<Vec<Token>>(),
                    &self.operators[0..self.operators.len() - 1],
                );
                return rpn.parse();
            }

            let rpn = ReversePolishNotation::new(
                &self.parser.tokens[1..],
                &self
                    .previous_postfix
                    .iter()
                    .cloned()
                    .chain(vec![current_token.clone()])
                    .collect::<Vec<Token>>(),
                &self.operators[0..self.operators.len() - 1],
            );
            return rpn.parse();
        }

        if !current_token.is_code_token() {
            let rpn = ReversePolishNotation::new(&self.parser.tokens[1..], &self.previous_postfix, &self.operators);
            return rpn.parse();
        }

        Err(KclError::Syntax(KclErrorDetails {
            source_ranges: vec![current_token.into()],
            message: format!(
                "Unexpected token: {} {:?}",
                current_token.value, current_token.token_type
            ),
        }))
    }

    fn build_tree(
        &mut self,
        reverse_polish_notation_tokens: &[Token],
        stack: Vec<MathExpression>,
    ) -> Result<BinaryExpression, KclError> {
        self.parser = Parser::new(reverse_polish_notation_tokens.to_vec());

        if reverse_polish_notation_tokens.is_empty() {
            return match &stack[0] {
                MathExpression::ExtendedBinaryExpression(bin_exp) => Ok(BinaryExpression {
                    operator: bin_exp.operator.clone(),
                    start: bin_exp.start,
                    end: bin_exp.end,
                    left: bin_exp.left.clone(),
                    right: bin_exp.right.clone(),
                }),
                MathExpression::BinaryExpression(bin_exp) => Ok(BinaryExpression {
                    operator: bin_exp.operator.clone(),
                    start: bin_exp.start,
                    end: bin_exp.end,
                    left: bin_exp.left.clone(),
                    right: bin_exp.right.clone(),
                }),

                a => {
                    return Err(KclError::InvalidExpression(KclErrorDetails {
                        source_ranges: vec![SourceRange([a.start(), a.end()])],
                        message: format!("{:?}", a),
                    }));
                }
            };
        }
        let current_token = &reverse_polish_notation_tokens[0];
        if current_token.token_type == TokenType::Number || current_token.token_type == TokenType::String {
            let mut new_stack = stack;
            new_stack.push(MathExpression::ExtendedLiteral(Box::new(ExtendedLiteral {
                value: if current_token.token_type == TokenType::Number {
                    if let Ok(value) = current_token.value.parse::<i64>() {
                        serde_json::Value::Number(value.into())
                    } else if let Ok(value) = current_token.value.parse::<f64>() {
                        if let Some(n) = serde_json::Number::from_f64(value) {
                            serde_json::Value::Number(n)
                        } else {
                            return Err(KclError::Syntax(KclErrorDetails {
                                source_ranges: vec![current_token.into()],
                                message: format!("Invalid float: {}", current_token.value),
                            }));
                        }
                    } else {
                        return Err(KclError::Syntax(KclErrorDetails {
                            source_ranges: vec![current_token.into()],
                            message: format!("Invalid integer: {}", current_token.value),
                        }));
                    }
                } else {
                    let mut str_val = current_token.value.clone();
                    str_val.remove(0);
                    str_val.pop();
                    serde_json::Value::String(str_val)
                },
                start: current_token.start,
                end: current_token.end,
                raw: current_token.value.clone(),
                end_extended: None,
                start_extended: None,
            })));
            return self.build_tree(&reverse_polish_notation_tokens[1..], new_stack);
        } else if current_token.token_type == TokenType::Word {
            if reverse_polish_notation_tokens.len() > 1 {
                if reverse_polish_notation_tokens[1].token_type == TokenType::Brace
                    && reverse_polish_notation_tokens[1].value == "("
                {
                    let closing_brace = self.parser.find_closing_brace(1, 0, "")?;
                    let mut new_stack = stack;
                    let call_expression = self.parser.make_call_expression(0)?;
                    new_stack.push(MathExpression::CallExpression(Box::new(call_expression.expression)));
                    return self.build_tree(&reverse_polish_notation_tokens[closing_brace + 1..], new_stack);
                }
                if reverse_polish_notation_tokens[1].token_type == TokenType::Period
                    || (reverse_polish_notation_tokens[1].token_type == TokenType::Brace
                        && reverse_polish_notation_tokens[1].value == "[")
                {
                    let mut new_stack = stack;
                    let member_expression = self.parser.make_member_expression(0)?;
                    new_stack.push(MathExpression::MemberExpression(Box::new(member_expression.expression)));
                    return self.build_tree(
                        &reverse_polish_notation_tokens[member_expression.last_index + 1..],
                        new_stack,
                    );
                }
                let mut new_stack = stack;
                if current_token.value.starts_with('-') {
                    let expression = UnaryExpression {
                        start: current_token.start,
                        end: current_token.end,
                        operator: crate::ast::types::UnaryOperator::Neg,
                        argument: BinaryPart::Identifier(Box::new(Identifier {
                            name: current_token.value.trim_start_matches('-').to_string(),
                            start: current_token.start + 1,
                            end: current_token.end,
                        })),
                    };
                    new_stack.push(MathExpression::UnaryExpression(Box::new(expression)));
                } else {
                    new_stack.push(MathExpression::Identifier(Box::new(Identifier {
                        name: current_token.value.clone(),
                        start: current_token.start,
                        end: current_token.end,
                    })));
                }
                return self.build_tree(&reverse_polish_notation_tokens[1..], new_stack);
            }
        } else if current_token.token_type == TokenType::Brace && current_token.value == "(" {
            let mut new_stack = stack;
            new_stack.push(MathExpression::ParenthesisToken(Box::new(ParenthesisToken {
                value: "(".to_string(),
                start: current_token.start,
                end: current_token.end,
                token_type: MathTokenType::Parenthesis,
            })));
            return self.build_tree(&reverse_polish_notation_tokens[1..], new_stack);
        } else if current_token.token_type == TokenType::Brace && current_token.value == ")" {
            let inner_node: MathExpression = match &stack[stack.len() - 1] {
                MathExpression::ExtendedBinaryExpression(bin_exp) => {
                    MathExpression::ExtendedBinaryExpression(Box::new(ExtendedBinaryExpression {
                        operator: bin_exp.operator.clone(),
                        start: bin_exp.start,
                        end: bin_exp.end,
                        left: bin_exp.left.clone(),
                        right: bin_exp.right.clone(),
                        start_extended: None,
                        end_extended: None,
                    }))
                }
                MathExpression::BinaryExpression(bin_exp) => {
                    MathExpression::ExtendedBinaryExpression(Box::new(ExtendedBinaryExpression {
                        operator: bin_exp.operator.clone(),
                        start: bin_exp.start,
                        end: bin_exp.end,
                        left: bin_exp.left.clone(),
                        right: bin_exp.right.clone(),
                        start_extended: None,
                        end_extended: None,
                    }))
                }
                MathExpression::ExtendedLiteral(literal) => MathExpression::ExtendedLiteral(literal.clone()),
                a => {
                    return Err(KclError::InvalidExpression(KclErrorDetails {
                        source_ranges: vec![current_token.into()],
                        message: format!("{:?}", a),
                    }));
                }
            };
            let paran = match &stack[stack.len() - 2] {
                MathExpression::ParenthesisToken(paran) => paran.clone(),
                a => {
                    return Err(KclError::InvalidExpression(KclErrorDetails {
                        source_ranges: vec![current_token.into()],
                        message: format!("{:?}", a),
                    }))
                }
            };
            let expression = match inner_node {
                MathExpression::ExtendedBinaryExpression(bin_exp) => {
                    MathExpression::ExtendedBinaryExpression(Box::new(ExtendedBinaryExpression {
                        operator: bin_exp.operator.clone(),
                        start: bin_exp.start,
                        end: bin_exp.end,
                        left: bin_exp.left.clone(),
                        right: bin_exp.right.clone(),
                        start_extended: Some(paran.start),
                        end_extended: Some(current_token.end),
                    }))
                }
                MathExpression::BinaryExpression(bin_exp) => {
                    MathExpression::ExtendedBinaryExpression(Box::new(ExtendedBinaryExpression {
                        operator: bin_exp.operator.clone(),
                        start: bin_exp.start,
                        end: bin_exp.end,
                        left: bin_exp.left.clone(),
                        right: bin_exp.right.clone(),
                        start_extended: Some(paran.start),
                        end_extended: Some(current_token.end),
                    }))
                }
                MathExpression::ExtendedLiteral(literal) => {
                    MathExpression::ExtendedLiteral(Box::new(ExtendedLiteral {
                        value: literal.value.clone(),
                        start: literal.start,
                        end: literal.end,
                        raw: literal.raw.clone(),
                        end_extended: Some(current_token.end),
                        start_extended: Some(paran.start),
                    }))
                }
                a => {
                    return Err(KclError::InvalidExpression(KclErrorDetails {
                        source_ranges: vec![current_token.into()],
                        message: format!("{:?}", a),
                    }));
                }
            };
            let mut new_stack = stack[0..stack.len() - 2].to_vec();
            new_stack.push(expression);
            return self.build_tree(&reverse_polish_notation_tokens[1..], new_stack);
        }

        if stack.len() < 2 {
            return Err(KclError::Syntax(KclErrorDetails {
                source_ranges: vec![current_token.into()],
                message: "unexpected end of expression".to_string(),
            }));
        }

        let left: (BinaryPart, usize) = match &stack[stack.len() - 2] {
            MathExpression::ExtendedBinaryExpression(bin_exp) => (
                BinaryPart::BinaryExpression(Box::new(BinaryExpression {
                    operator: bin_exp.operator.clone(),
                    start: bin_exp.start,
                    end: bin_exp.end,
                    left: bin_exp.left.clone(),
                    right: bin_exp.right.clone(),
                })),
                bin_exp.start_extended.unwrap_or(bin_exp.start),
            ),
            MathExpression::ExtendedLiteral(lit) => (
                BinaryPart::Literal(Box::new(Literal {
                    value: lit.value.clone(),
                    start: lit.start,
                    end: lit.end,
                    raw: lit.raw.clone(),
                })),
                lit.start_extended.unwrap_or(lit.start),
            ),
            MathExpression::Identifier(ident) => (BinaryPart::Identifier(ident.clone()), ident.start),
            MathExpression::CallExpression(call) => (BinaryPart::CallExpression(call.clone()), call.start),
            MathExpression::BinaryExpression(bin_exp) => (BinaryPart::BinaryExpression(bin_exp.clone()), bin_exp.start),
            MathExpression::MemberExpression(member_expression) => (
                BinaryPart::MemberExpression(member_expression.clone()),
                member_expression.start,
            ),
            MathExpression::UnaryExpression(unary_expression) => (
                BinaryPart::UnaryExpression(unary_expression.clone()),
                unary_expression.start,
            ),
            a => {
                return Err(KclError::InvalidExpression(KclErrorDetails {
                    source_ranges: vec![current_token.into()],
                    message: format!("{:?}", a),
                }))
            }
        };
        let right = match &stack[stack.len() - 1] {
            MathExpression::ExtendedBinaryExpression(bin_exp) => (
                BinaryPart::BinaryExpression(Box::new(BinaryExpression {
                    operator: bin_exp.operator.clone(),
                    start: bin_exp.start,
                    end: bin_exp.end,
                    left: bin_exp.left.clone(),
                    right: bin_exp.right.clone(),
                })),
                bin_exp.end_extended.unwrap_or(bin_exp.end),
            ),
            MathExpression::ExtendedLiteral(lit) => (
                BinaryPart::Literal(Box::new(Literal {
                    value: lit.value.clone(),
                    start: lit.start,
                    end: lit.end,
                    raw: lit.raw.clone(),
                })),
                lit.end_extended.unwrap_or(lit.end),
            ),
            MathExpression::Identifier(ident) => (BinaryPart::Identifier(ident.clone()), ident.end),
            MathExpression::CallExpression(call) => (BinaryPart::CallExpression(call.clone()), call.end),
            MathExpression::BinaryExpression(bin_exp) => (BinaryPart::BinaryExpression(bin_exp.clone()), bin_exp.end),
            MathExpression::MemberExpression(member_expression) => (
                BinaryPart::MemberExpression(member_expression.clone()),
                member_expression.end,
            ),
            MathExpression::UnaryExpression(unary_expression) => (
                BinaryPart::UnaryExpression(unary_expression.clone()),
                unary_expression.end,
            ),
            a => {
                return Err(KclError::InvalidExpression(KclErrorDetails {
                    source_ranges: vec![current_token.into()],
                    message: format!("{:?}", a),
                }))
            }
        };

        let right_end = right.0.clone().end();

        let tree = BinaryExpression {
            operator: BinaryOperator::from_str(&current_token.value.clone()).map_err(|err| {
                KclError::Syntax(KclErrorDetails {
                    source_ranges: vec![current_token.into()],
                    message: format!("{}", err),
                })
            })?,
            start: left.1,
            end: if right.1 > right_end { right.1 } else { right_end },
            left: left.0,
            right: right.0,
        };
        let mut new_stack = stack[0..stack.len() - 2].to_vec();
        new_stack.push(MathExpression::BinaryExpression(Box::new(tree)));

        self.build_tree(&reverse_polish_notation_tokens[1..], new_stack)
    }
}

pub struct MathParser {
    rpn: ReversePolishNotation,
}

impl MathParser {
    pub fn new(tokens: &[Token]) -> Self {
        MathParser {
            rpn: ReversePolishNotation::new(tokens, &[], &[]),
        }
    }

    pub fn parse(&mut self) -> Result<BinaryExpression, KclError> {
        let rpn = self.rpn.parse()?;
        let tree_with_maybe_bad_top_level_start_end = self.rpn.build_tree(&rpn, vec![])?;
        let left_start = tree_with_maybe_bad_top_level_start_end.clone().left.start();
        let min_start = if left_start < tree_with_maybe_bad_top_level_start_end.start {
            left_start
        } else {
            tree_with_maybe_bad_top_level_start_end.start
        };
        let right_end = tree_with_maybe_bad_top_level_start_end.clone().right.end();
        let max_end = if right_end > tree_with_maybe_bad_top_level_start_end.end {
            right_end
        } else {
            tree_with_maybe_bad_top_level_start_end.end
        };
        Ok(BinaryExpression {
            left: tree_with_maybe_bad_top_level_start_end.left,
            right: tree_with_maybe_bad_top_level_start_end.right,
            start: min_start,
            end: max_end,
            operator: tree_with_maybe_bad_top_level_start_end.operator,
        })
    }
}

#[cfg(test)]
mod test {
    use pretty_assertions::assert_eq;

    use super::*;

    #[test]
    fn test_parse_expression() {
        let tokens = crate::tokeniser::lexer("1 + 2");
        let mut parser = MathParser::new(&tokens);
        let result = parser.parse().unwrap();
        assert_eq!(
            result,
            BinaryExpression {
                operator: BinaryOperator::Add,
                start: 0,
                end: 5,
                left: BinaryPart::Literal(Box::new(Literal {
                    value: serde_json::Value::Number(serde_json::Number::from(1)),
                    raw: "1".to_string(),
                    start: 0,
                    end: 1,
                })),
                right: BinaryPart::Literal(Box::new(Literal {
                    value: serde_json::Value::Number(serde_json::Number::from(2)),
                    raw: "2".to_string(),
                    start: 4,
                    end: 5,
                })),
            }
        );
    }

    #[test]
    fn test_parse_expression_add_no_spaces() {
        let tokens = crate::tokeniser::lexer("1+2");
        let mut parser = MathParser::new(&tokens);
        let result = parser.parse().unwrap();
        assert_eq!(
            result,
            BinaryExpression {
                operator: BinaryOperator::Add,
                start: 0,
                end: 3,
                left: BinaryPart::Literal(Box::new(Literal {
                    value: serde_json::Value::Number(serde_json::Number::from(1)),
                    raw: "1".to_string(),
                    start: 0,
                    end: 1,
                })),
                right: BinaryPart::Literal(Box::new(Literal {
                    value: serde_json::Value::Number(serde_json::Number::from(2)),
                    raw: "2".to_string(),
                    start: 2,
                    end: 3,
                })),
            }
        );
    }

    #[test]
    fn test_parse_expression_sub_no_spaces() {
        let tokens = crate::tokeniser::lexer("1 -2");
        let mut parser = MathParser::new(&tokens);
        let result = parser.parse().unwrap();
        assert_eq!(
            result,
            BinaryExpression {
                operator: BinaryOperator::Sub,
                start: 0,
                end: 4,
                left: BinaryPart::Literal(Box::new(Literal {
                    value: serde_json::Value::Number(serde_json::Number::from(1)),
                    raw: "1".to_string(),
                    start: 0,
                    end: 1,
                })),
                right: BinaryPart::Literal(Box::new(Literal {
                    value: serde_json::Value::Number(serde_json::Number::from(2)),
                    raw: "2".to_string(),
                    start: 3,
                    end: 4,
                })),
            }
        );
    }

    #[test]
    fn test_parse_expression_plus_followed_by_star() {
        let tokens = crate::tokeniser::lexer("1 + 2 * 3");
        let mut parser = MathParser::new(&tokens);
        let result = parser.parse().unwrap();
        assert_eq!(
            result,
            BinaryExpression {
                operator: BinaryOperator::Add,
                start: 0,
                end: 9,
                left: BinaryPart::Literal(Box::new(Literal {
                    value: serde_json::Value::Number(serde_json::Number::from(1)),
                    raw: "1".to_string(),
                    start: 0,
                    end: 1,
                })),
                right: BinaryPart::BinaryExpression(Box::new(BinaryExpression {
                    operator: BinaryOperator::Mul,
                    start: 4,
                    end: 9,
                    left: BinaryPart::Literal(Box::new(Literal {
                        value: serde_json::Value::Number(serde_json::Number::from(2)),
                        raw: "2".to_string(),
                        start: 4,
                        end: 5,
                    })),
                    right: BinaryPart::Literal(Box::new(Literal {
                        value: serde_json::Value::Number(serde_json::Number::from(3)),
                        raw: "3".to_string(),
                        start: 8,
                        end: 9,
                    })),
                })),
            }
        );
    }

    #[test]
    fn test_parse_expression_with_parentheses() {
        let tokens = crate::tokeniser::lexer("1 * ( 2 + 3 )");
        let mut parser = MathParser::new(&tokens);
        let result = parser.parse().unwrap();
        assert_eq!(
            result,
            BinaryExpression {
                operator: BinaryOperator::Mul,
                start: 0,
                end: 13,
                left: BinaryPart::Literal(Box::new(Literal {
                    value: serde_json::Value::Number(serde_json::Number::from(1)),
                    raw: "1".to_string(),
                    start: 0,
                    end: 1,
                })),
                right: BinaryPart::BinaryExpression(Box::new(BinaryExpression {
                    operator: BinaryOperator::Add,
                    start: 6,
                    end: 11,
                    left: BinaryPart::Literal(Box::new(Literal {
                        value: serde_json::Value::Number(serde_json::Number::from(2)),
                        raw: "2".to_string(),
                        start: 6,
                        end: 7,
                    })),
                    right: BinaryPart::Literal(Box::new(Literal {
                        value: serde_json::Value::Number(serde_json::Number::from(3)),
                        raw: "3".to_string(),
                        start: 10,
                        end: 11,
                    })),
                })),
            }
        );
    }

    #[test]
    fn test_parse_expression_parens_in_middle() {
        let tokens = crate::tokeniser::lexer("1 * ( 2 + 3 ) / 4");
        let mut parser = MathParser::new(&tokens);
        let result = parser.parse().unwrap();
        assert_eq!(
            result,
            BinaryExpression {
                operator: BinaryOperator::Div,
                start: 0,
                end: 17,
                left: BinaryPart::BinaryExpression(Box::new(BinaryExpression {
                    operator: BinaryOperator::Mul,
                    start: 0,
                    end: 13,
                    left: BinaryPart::Literal(Box::new(Literal {
                        value: serde_json::Value::Number(serde_json::Number::from(1)),
                        raw: "1".to_string(),
                        start: 0,
                        end: 1,
                    })),
                    right: BinaryPart::BinaryExpression(Box::new(BinaryExpression {
                        operator: BinaryOperator::Add,
                        start: 6,
                        end: 11,
                        left: BinaryPart::Literal(Box::new(Literal {
                            value: serde_json::Value::Number(serde_json::Number::from(2)),
                            raw: "2".to_string(),
                            start: 6,
                            end: 7,
                        })),
                        right: BinaryPart::Literal(Box::new(Literal {
                            value: serde_json::Value::Number(serde_json::Number::from(3)),
                            raw: "3".to_string(),
                            start: 10,
                            end: 11,
                        })),
                    })),
                })),
                right: BinaryPart::Literal(Box::new(Literal {
                    value: serde_json::Value::Number(serde_json::Number::from(4)),
                    raw: "4".to_string(),
                    start: 16,
                    end: 17,
                })),
            }
        )
    }

    #[test]
    fn test_parse_expression_parans_and_predence() {
        let tokens = crate::tokeniser::lexer("1 + ( 2 + 3 ) / 4");
        let mut parser = MathParser::new(&tokens);
        let result = parser.parse().unwrap();
        assert_eq!(
            result,
            BinaryExpression {
                operator: BinaryOperator::Add,
                start: 0,
                end: 17,
                left: BinaryPart::Literal(Box::new(Literal {
                    value: serde_json::Value::Number(serde_json::Number::from(1)),
                    raw: "1".to_string(),
                    start: 0,
                    end: 1,
                })),
                right: BinaryPart::BinaryExpression(Box::new(BinaryExpression {
                    operator: BinaryOperator::Div,
                    start: 4,
                    end: 17,
                    left: BinaryPart::BinaryExpression(Box::new(BinaryExpression {
                        operator: BinaryOperator::Add,
                        start: 6,
                        end: 11,
                        left: BinaryPart::Literal(Box::new(Literal {
                            value: serde_json::Value::Number(serde_json::Number::from(2)),
                            raw: "2".to_string(),
                            start: 6,
                            end: 7,
                        })),
                        right: BinaryPart::Literal(Box::new(Literal {
                            value: serde_json::Value::Number(serde_json::Number::from(3)),
                            raw: "3".to_string(),
                            start: 10,
                            end: 11,
                        })),
                    })),
                    right: BinaryPart::Literal(Box::new(Literal {
                        value: serde_json::Value::Number(serde_json::Number::from(4)),
                        raw: "4".to_string(),
                        start: 16,
                        end: 17,
                    })),
                })),
            }
        )
    }
    #[test]
    fn test_parse_expression_nested() {
        let tokens = crate::tokeniser::lexer("1 * (( 2 + 3 ) / 4 + 5 )");
        let mut parser = MathParser::new(&tokens);
        let result = parser.parse().unwrap();
        assert_eq!(
            result,
            BinaryExpression {
                operator: BinaryOperator::Mul,
                start: 0,
                end: 24,
                left: BinaryPart::Literal(Box::new(Literal {
                    value: serde_json::Value::Number(serde_json::Number::from(1)),
                    raw: "1".to_string(),
                    start: 0,
                    end: 1,
                })),
                right: BinaryPart::BinaryExpression(Box::new(BinaryExpression {
                    operator: BinaryOperator::Add,
                    start: 5,
                    end: 22,
                    left: BinaryPart::BinaryExpression(Box::new(BinaryExpression {
                        operator: BinaryOperator::Div,
                        start: 5,
                        end: 18,
                        left: BinaryPart::BinaryExpression(Box::new(BinaryExpression {
                            operator: BinaryOperator::Add,
                            start: 7,
                            end: 12,
                            left: BinaryPart::Literal(Box::new(Literal {
                                value: serde_json::Value::Number(serde_json::Number::from(2)),
                                raw: "2".to_string(),
                                start: 7,
                                end: 8,
                            })),
                            right: BinaryPart::Literal(Box::new(Literal {
                                value: serde_json::Value::Number(serde_json::Number::from(3)),
                                raw: "3".to_string(),
                                start: 11,
                                end: 12,
                            })),
                        })),
                        right: BinaryPart::Literal(Box::new(Literal {
                            value: serde_json::Value::Number(serde_json::Number::from(4)),
                            raw: "4".to_string(),
                            start: 17,
                            end: 18,
                        })),
                    })),
                    right: BinaryPart::Literal(Box::new(Literal {
                        value: serde_json::Value::Number(serde_json::Number::from(5)),
                        raw: "5".to_string(),
                        start: 21,
                        end: 22,
                    })),
                })),
            }
        )
    }
    #[test]
    fn test_parse_expression_redundant_braces() {
        let tokens = crate::tokeniser::lexer("1 * ((( 2 + 3 )))");
        let mut parser = MathParser::new(&tokens);
        let result = parser.parse().unwrap();
        assert_eq!(
            result,
            BinaryExpression {
                operator: BinaryOperator::Mul,
                start: 0,
                end: 17,
                left: BinaryPart::Literal(Box::new(Literal {
                    value: serde_json::Value::Number(serde_json::Number::from(1)),
                    raw: "1".to_string(),
                    start: 0,
                    end: 1,
                })),
                right: BinaryPart::BinaryExpression(Box::new(BinaryExpression {
                    operator: BinaryOperator::Add,
                    start: 8,
                    end: 13,
                    left: BinaryPart::Literal(Box::new(Literal {
                        value: serde_json::Value::Number(serde_json::Number::from(2)),
                        raw: "2".to_string(),
                        start: 8,
                        end: 9,
                    })),
                    right: BinaryPart::Literal(Box::new(Literal {
                        value: serde_json::Value::Number(serde_json::Number::from(3)),
                        raw: "3".to_string(),
                        start: 12,
                        end: 13,
                    })),
                })),
            }
        )
    }

    #[test]
    fn test_reverse_polish_notation_simple() {
        let parser = ReversePolishNotation::new(&crate::tokeniser::lexer("1 + 2"), &[], &[]);
        let result = parser.parse().unwrap();
        assert_eq!(
            result,
            vec![
                Token {
                    token_type: TokenType::Number,
                    value: "1".to_string(),
                    start: 0,
                    end: 1
                },
                Token {
                    token_type: TokenType::Number,
                    value: "2".to_string(),
                    start: 4,
                    end: 5
                },
                Token {
                    token_type: TokenType::Operator,
                    value: "+".to_string(),
                    start: 2,
                    end: 3
                }
            ]
        );
    }

    #[test]
    fn test_reverse_polish_notation_complex() {
        let parser = ReversePolishNotation::new(&crate::tokeniser::lexer("1 + 2 * 3"), &[], &[]);
        let result = parser.parse().unwrap();
        assert_eq!(
            result,
            vec![
                Token {
                    token_type: TokenType::Number,
                    value: "1".to_string(),
                    start: 0,
                    end: 1
                },
                Token {
                    token_type: TokenType::Number,
                    value: "2".to_string(),
                    start: 4,
                    end: 5
                },
                Token {
                    token_type: TokenType::Number,
                    value: "3".to_string(),
                    start: 8,
                    end: 9
                },
                Token {
                    token_type: TokenType::Operator,
                    value: "*".to_string(),
                    start: 6,
                    end: 7
                },
                Token {
                    token_type: TokenType::Operator,
                    value: "+".to_string(),
                    start: 2,
                    end: 3
                },
            ]
        );
    }

    #[test]
    fn test_reverse_polish_notation_complex_with_parentheses() {
        let parser = ReversePolishNotation::new(&crate::tokeniser::lexer("1 * ( 2 + 3 )"), &[], &[]);
        let result = parser.parse().unwrap();
        assert_eq!(
            result,
            vec![
                Token {
                    token_type: TokenType::Number,
                    value: "1".to_string(),
                    start: 0,
                    end: 1
                },
                Token {
                    token_type: TokenType::Brace,
                    value: "(".to_string(),
                    start: 4,
                    end: 5
                },
                Token {
                    token_type: TokenType::Number,
                    value: "2".to_string(),
                    start: 6,
                    end: 7
                },
                Token {
                    token_type: TokenType::Number,
                    value: "3".to_string(),
                    start: 10,
                    end: 11
                },
                Token {
                    token_type: TokenType::Operator,
                    value: "+".to_string(),
                    start: 8,
                    end: 9
                },
                Token {
                    token_type: TokenType::Brace,
                    value: ")".to_string(),
                    start: 12,
                    end: 13
                },
                Token {
                    token_type: TokenType::Operator,
                    value: "*".to_string(),
                    start: 2,
                    end: 3
                }
            ]
        );
    }

    #[test]
    fn test_parse_expression_redundant_braces_around_literal() {
        let code = "2 + (((3)))";
        let tokens = crate::tokeniser::lexer(code);
        let mut parser = MathParser::new(&tokens);
        let result = parser.parse().unwrap();
        assert_eq!(
            result,
            BinaryExpression {
                operator: BinaryOperator::Add,
                start: 0,
                end: code.find(")))").unwrap() + 3,
                left: BinaryPart::Literal(Box::new(Literal {
                    value: serde_json::Value::Number(serde_json::Number::from(2)),
                    raw: "2".to_string(),
                    start: 0,
                    end: 1,
                })),
                right: BinaryPart::Literal(Box::new(Literal {
                    value: serde_json::Value::Number(serde_json::Number::from(3)),
                    raw: "3".to_string(),
                    start: 7,
                    end: 8,
                })),
            }
        )
    }

    #[test]
    fn test_build_tree() {
        let input_tokens = vec![
            Token {
                token_type: TokenType::Number,
                start: 0,
                end: 1,
                value: "1".to_string(),
            },
            Token {
                token_type: TokenType::Number,
                start: 4,
                end: 5,
                value: "2".to_string(),
            },
            Token {
                token_type: TokenType::Number,
                start: 8,
                end: 9,
                value: "3".to_string(),
            },
            Token {
                token_type: TokenType::Operator,
                start: 6,
                end: 7,
                value: "*".to_string(),
            },
            Token {
                token_type: TokenType::Operator,
                start: 2,
                end: 3,
                value: "+".to_string(),
            },
        ];
        let expected_output = BinaryExpression {
            operator: BinaryOperator::Add,
            start: 0,
            end: 9,
            left: BinaryPart::Literal(Box::new(Literal {
                value: serde_json::Value::Number(serde_json::Number::from(1)),
                raw: "1".to_string(),
                start: 0,
                end: 1,
            })),
            right: BinaryPart::BinaryExpression(Box::new(BinaryExpression {
                operator: BinaryOperator::Mul,
                start: 4,
                end: 9,
                left: BinaryPart::Literal(Box::new(Literal {
                    value: serde_json::Value::Number(serde_json::Number::from(2)),
                    raw: "2".to_string(),
                    start: 4,
                    end: 5,
                })),
                right: BinaryPart::Literal(Box::new(Literal {
                    value: serde_json::Value::Number(serde_json::Number::from(3)),
                    raw: "3".to_string(),
                    start: 8,
                    end: 9,
                })),
            })),
        };
        let mut parser = ReversePolishNotation::new(&[], &[], &[]);
        let output = parser.build_tree(&input_tokens, vec![]).unwrap();
        assert_eq!(output, expected_output);
    }

    #[test]
    fn test_parse_expression_braces_around_lots_of_math() {
        let code = "(distance * p * FOS * 6 / (sigmaAllow * width))";
        let tokens = crate::tokeniser::lexer(code);
        let mut parser = MathParser::new(&tokens);
        let result = parser.parse();
        assert!(result.is_ok());
    }

    #[test]
    fn test_parse_expression_braces_around_internals_lots_of_math() {
        let code = "distance * p * FOS * 6 / (sigmaAllow * width)";
        let tokens = crate::tokeniser::lexer(code);
        let mut parser = MathParser::new(&tokens);
        let result = parser.parse();
        assert!(result.is_ok());
    }
}
