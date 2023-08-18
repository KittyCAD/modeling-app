use std::collections::HashMap;

use crate::abstract_syntax_tree_types::{
    ArrayExpression, BinaryExpression, BinaryPart, BlockStatement, BodyItem, CallExpression,
    ExpressionStatement, FunctionExpression, Identifier, Literal, LiteralIdentifier,
    MemberExpression, MemberObject, NoneCodeMeta, NoneCodeNode, ObjectExpression, ObjectKeyInfo,
    ObjectProperty, PipeExpression, PipeSubstitution, Program, ReturnStatement, UnaryExpression,
    Value, VariableDeclaration, VariableDeclarator,
};
use crate::errors::{KclError, KclErrorDetails};
use crate::math_parser::parse_expression;
use crate::tokeniser::lexer;
use crate::tokeniser::{Token, TokenType};

use wasm_bindgen::prelude::*;

fn make_identifier(tokens: &[Token], index: usize) -> Identifier {
    let current_token = &tokens[index];
    Identifier {
        start: current_token.start,
        end: current_token.end,
        name: current_token.value.clone(),
    }
}

pub fn make_literal(tokens: &[Token], index: usize) -> Result<Literal, KclError> {
    let token = &tokens[index];
    let value = if token.token_type == TokenType::Number {
        if let Ok(value) = token.value.parse::<i64>() {
            serde_json::Value::Number(value.into())
        } else if let Ok(value) = token.value.parse::<f64>() {
            if let Some(n) = serde_json::Number::from_f64(value) {
                serde_json::Value::Number(n)
            } else {
                return Err(KclError::Syntax(KclErrorDetails {
                    source_ranges: vec![[token.start as i32, token.end as i32]],
                    message: format!("Invalid float: {}", token.value),
                }));
            }
        } else {
            return Err(KclError::Syntax(KclErrorDetails {
                source_ranges: vec![[token.start as i32, token.end as i32]],
                message: format!("Invalid integer: {}", token.value),
            }));
        }
    } else {
        let mut str_val = token.value.clone();
        str_val.remove(0);
        str_val.pop();
        serde_json::Value::String(str_val)
    };
    Ok(Literal {
        start: token.start,
        end: token.end,
        value,
        raw: token.value.clone(),
    })
}

pub fn is_not_code_token(token: &Token) -> bool {
    token.token_type == TokenType::Whitespace
        || token.token_type == TokenType::LineComment
        || token.token_type == TokenType::BlockComment
}

fn find_end_of_non_code_node(tokens: &Vec<Token>, index: usize) -> usize {
    if index == tokens.len() {
        return index;
    }
    let current_token = &tokens[index];
    if is_not_code_token(current_token) {
        return find_end_of_non_code_node(tokens, index + 1);
    }
    index
}

fn make_none_code_node(tokens: &Vec<Token>, index: usize) -> (Option<NoneCodeNode>, usize) {
    let current_token = &tokens[index];
    let end_index = if index == tokens.len() {
        index
    } else {
        find_end_of_non_code_node(tokens, index)
    };
    let non_code_tokens = tokens[index..end_index].to_vec();
    let value = non_code_tokens
        .iter()
        .map(|t| t.value.clone())
        .collect::<String>();

    let node = NoneCodeNode {
        start: current_token.start,
        end: tokens[end_index - 1].end,
        value,
    };
    (Some(node), end_index - 1)
}

#[derive(Debug, PartialEq, Clone)]
struct TokenReturn {
    token: Option<Token>,
    index: usize,
}

#[derive(Debug, PartialEq, Clone)]
struct TokenReturnWithNonCode {
    token: Option<Token>,
    index: usize,
    non_code_node: Option<NoneCodeNode>,
}

fn next_meaningful_token(
    tokens: &Vec<Token>,
    index: usize,
    offset: Option<usize>,
) -> TokenReturnWithNonCode {
    let new_index = index + offset.unwrap_or(1);
    let _token = tokens.get(new_index);
    let token = if let Some(token) = _token {
        token
    } else {
        return TokenReturnWithNonCode {
            token: Some(tokens[tokens.len() - 1].clone()),
            index: tokens.len() - 1,
            non_code_node: None,
        };
    };

    if is_not_code_token(token) {
        let non_code_node = make_none_code_node(tokens, new_index);
        let new_new_index = non_code_node.1 + 1;
        let bonus_non_code_node = if non_code_node.0.is_some() {
            non_code_node.0
        } else {
            None
        };

        return TokenReturnWithNonCode {
            token: tokens.get(new_new_index).cloned(),
            index: new_new_index,
            non_code_node: bonus_non_code_node,
        };
    }
    TokenReturnWithNonCode {
        token: Some(token.clone()),
        index: new_index,
        non_code_node: None,
    }
}

pub fn find_closing_brace(
    tokens: &[Token],
    index: usize,
    brace_count: usize,
    search_opening_brace: &str,
) -> Result<usize, KclError> {
    let closing_brace_map: HashMap<&str, &str> = [("(", ")"), ("{", "}"), ("[", "]")]
        .iter()
        .cloned()
        .collect();
    let current_token = &tokens[index];
    let mut search_opening_brace = search_opening_brace;
    let is_first_call = search_opening_brace.is_empty() && brace_count == 0;
    if is_first_call {
        search_opening_brace = &current_token.value;
        if !["(", "{", "["].contains(&search_opening_brace) {
            return Err(KclError::Syntax(KclErrorDetails {
                source_ranges: vec![[current_token.start as i32, current_token.end as i32]],
                message: format!(
                    "expected to be started on a opening brace ( {{ [, instead found '{}'",
                    search_opening_brace
                ),
            }));
        }
    }
    let found_closing_brace =
        brace_count == 1 && current_token.value == closing_brace_map[search_opening_brace];
    let found_another_opening_brace = current_token.value == search_opening_brace;
    let found_another_closing_brace =
        current_token.value == closing_brace_map[search_opening_brace];
    if found_closing_brace {
        return Ok(index);
    }
    if found_another_opening_brace {
        return find_closing_brace(tokens, index + 1, brace_count + 1, search_opening_brace);
    }
    if found_another_closing_brace {
        return find_closing_brace(tokens, index + 1, brace_count - 1, search_opening_brace);
    }
    // non-brace token, increment and continue
    find_closing_brace(tokens, index + 1, brace_count, search_opening_brace)
}

fn is_call_expression(tokens: &[Token], index: usize) -> Result<Option<usize>, KclError> {
    if index + 1 >= tokens.len() {
        return Ok(None);
    }
    let current_token = &tokens[index];
    let very_next_token = &tokens[index + 1];
    if current_token.token_type == TokenType::Word
        && very_next_token.token_type == TokenType::Brace
        && very_next_token.value == "("
    {
        return Ok(Some(find_closing_brace(tokens, index + 1, 0, "")?));
    }
    Ok(None)
}

fn find_next_declaration_keyword(
    tokens: &Vec<Token>,
    index: usize,
) -> Result<TokenReturn, KclError> {
    if index >= tokens.len() - 1 {
        return Ok(TokenReturn {
            token: None,
            index: tokens.len() - 1,
        });
    }
    let next_token = next_meaningful_token(tokens, index, None);

    if next_token.index >= tokens.len() - 1 {
        return Ok(TokenReturn {
            token: None,
            index: tokens.len() - 1,
        });
    }
    if let Some(token_val) = next_token.token {
        if token_val.token_type == TokenType::Word
            && (token_val.value == "const" || token_val.value == "fn")
        {
            return Ok(TokenReturn {
                token: Some(token_val),
                index: next_token.index,
            });
        }
        if token_val.token_type == TokenType::Brace && token_val.value == "(" {
            let closing_brace_index = find_closing_brace(tokens, next_token.index, 0, "")?;
            let arrow_token = next_meaningful_token(tokens, closing_brace_index, None).token;
            if let Some(arrow_token) = arrow_token {
                if arrow_token.token_type == TokenType::Operator && arrow_token.value == "=>" {
                    return Ok(TokenReturn {
                        token: Some(token_val),
                        index: next_token.index,
                    });
                }
            }
        }
    }
    find_next_declaration_keyword(tokens, next_token.index)
}

fn has_pipe_operator(
    tokens: &Vec<Token>,
    index: usize,
    _limit_index: Option<usize>,
) -> Result<TokenReturnWithNonCode, KclError> {
    let limit_index = match _limit_index {
        Some(i) => i,
        None => {
            let call_expression = is_call_expression(tokens, index)?;
            if let Some(ce) = call_expression {
                let token_after_call_expression = next_meaningful_token(tokens, ce, None);

                if let Some(token_after_call_expression_val) = token_after_call_expression.token {
                    if token_after_call_expression_val.token_type == TokenType::Operator
                        && token_after_call_expression_val.value == "|>"
                    {
                        return Ok(TokenReturnWithNonCode {
                            token: Some(token_after_call_expression_val),
                            index: token_after_call_expression.index,
                            // non_code_node: None,
                            non_code_node: token_after_call_expression.non_code_node,
                        });
                    }
                    return Ok(TokenReturnWithNonCode {
                        token: None,
                        index: token_after_call_expression.index,
                        non_code_node: None,
                    });
                }
            }
            let current_token = &tokens[index];
            if current_token.token_type == TokenType::Brace && current_token.value == "{" {
                let closing_brace_index = find_closing_brace(tokens, index, 0, "")?;
                let token_after_closing_brace =
                    next_meaningful_token(tokens, closing_brace_index, None);
                if let Some(token_after_closing_brace_val) = token_after_closing_brace.token {
                    if token_after_closing_brace_val.token_type == TokenType::Operator
                        && token_after_closing_brace_val.value == "|>"
                    {
                        return Ok(TokenReturnWithNonCode {
                            token: Some(token_after_closing_brace_val),
                            index: token_after_closing_brace.index,
                            non_code_node: token_after_closing_brace.non_code_node,
                        });
                    }
                    return Ok(TokenReturnWithNonCode {
                        token: None,
                        index: token_after_closing_brace.index,
                        non_code_node: None,
                    });
                }
            }

            let next_declaration = find_next_declaration_keyword(tokens, index)?;
            next_declaration.index
        }
    };
    let next_token = next_meaningful_token(tokens, index, None);
    if next_token.index >= limit_index {
        return Ok(TokenReturnWithNonCode {
            token: None,
            index: next_token.index,
            non_code_node: None,
        });
    }
    if let Some(next_token_val) = next_token.token {
        if next_token_val.token_type == TokenType::Operator && next_token_val.value == "|>" {
            return Ok(TokenReturnWithNonCode {
                token: Some(next_token_val),
                index: next_token.index,
                non_code_node: next_token.non_code_node,
            });
        }
    }
    has_pipe_operator(tokens, next_token.index, Some(limit_index))
}

fn collect_object_keys(
    tokens: &Vec<Token>,
    index: usize,
    _previous_keys: Option<Vec<ObjectKeyInfo>>,
) -> Result<Vec<ObjectKeyInfo>, KclError> {
    let previous_keys = _previous_keys.unwrap_or(vec![]);
    let next_token = next_meaningful_token(tokens, index, None);
    let _next_token = next_token.clone();
    if _next_token.index == tokens.len() - 1 {
        return Ok(previous_keys);
    }
    let period_or_opening_bracket = match next_token.token {
        Some(next_token_val) => {
            if next_token_val.token_type == TokenType::Brace && next_token_val.value == "]" {
                next_meaningful_token(tokens, next_token.index, None)
            } else {
                _next_token
            }
        }
        None => _next_token,
    };
    if let Some(period_or_opening_bracket_token) = period_or_opening_bracket.token {
        if period_or_opening_bracket_token.token_type != TokenType::Period
            && period_or_opening_bracket_token.token_type != TokenType::Brace
        {
            return Ok(previous_keys);
        }
        let key_token = next_meaningful_token(tokens, period_or_opening_bracket.index, None);
        let next_period_or_opening_bracket = next_meaningful_token(tokens, key_token.index, None);
        let is_braced = match next_period_or_opening_bracket.token {
            Some(next_period_or_opening_bracket_val) => {
                next_period_or_opening_bracket_val.token_type == TokenType::Brace
                    && next_period_or_opening_bracket_val.value == "]"
            }
            None => false,
        };
        let end_index = if is_braced {
            next_period_or_opening_bracket.index
        } else {
            key_token.index
        };
        if let Some(key_token_token) = key_token.token {
            let key = if key_token_token.token_type == TokenType::Word {
                LiteralIdentifier::Identifier(Box::new(make_identifier(tokens, key_token.index)))
            } else {
                LiteralIdentifier::Literal(Box::new(make_literal(tokens, key_token.index)?))
            };
            let computed = is_braced && key_token_token.token_type == TokenType::Word;
            let mut new_previous_keys = previous_keys;
            new_previous_keys.push(ObjectKeyInfo {
                key,
                index: end_index,
                computed,
            });
            collect_object_keys(tokens, key_token.index, Some(new_previous_keys))
        } else {
            Err(KclError::Unimplemented(KclErrorDetails {
                source_ranges: vec![[
                    period_or_opening_bracket_token.start as i32,
                    period_or_opening_bracket_token.end as i32,
                ]],
                message: format!(
                    "expression with token type {:?}",
                    period_or_opening_bracket_token.token_type
                ),
            }))
        }
    } else {
        Ok(previous_keys)
    }
}

pub struct MemberExpressionReturn {
    pub expression: MemberExpression,
    pub last_index: usize,
}

fn make_member_expression(
    tokens: &Vec<Token>,
    index: usize,
) -> Result<MemberExpressionReturn, KclError> {
    let current_token = tokens[index].clone();
    let mut keys_info = collect_object_keys(tokens, index, None)?;
    let last_key = keys_info[keys_info.len() - 1].clone();
    let first_key = keys_info.remove(0);
    let root = make_identifier(tokens, index);
    let mut member_expression = MemberExpression {
        start: current_token.start,
        end: tokens[first_key.index].end,
        object: MemberObject::Identifier(Box::new(root)),
        property: first_key.key.clone(),
        computed: first_key.computed,
    };
    for key_info_1 in keys_info.iter() {
        let end_token = &tokens[key_info_1.index];
        member_expression = MemberExpression {
            start: current_token.start,
            end: end_token.end,
            object: MemberObject::MemberExpression(Box::new(member_expression)),
            property: key_info_1.key.clone(),
            computed: key_info_1.computed,
        };
    }
    Ok(MemberExpressionReturn {
        expression: member_expression,
        last_index: last_key.index,
    })
}

fn find_end_of_binary_expression(tokens: &Vec<Token>, index: usize) -> Result<usize, KclError> {
    let current_token = tokens[index].clone();
    if current_token.token_type == TokenType::Brace && current_token.value == "(" {
        let closing_parenthesis = find_closing_brace(tokens, index, 0, "")?;
        let maybe_another_operator = next_meaningful_token(tokens, closing_parenthesis, None);
        if let Some(maybe_another_operator_token) = maybe_another_operator.token {
            if maybe_another_operator_token.token_type != TokenType::Operator
                || maybe_another_operator_token.value == "|>"
            {
                return Ok(closing_parenthesis);
            }
            let next_right = next_meaningful_token(tokens, maybe_another_operator.index, None);
            return find_end_of_binary_expression(tokens, next_right.index);
        } else {
            return Ok(closing_parenthesis);
        }
    }
    if current_token.token_type == TokenType::Word
        && tokens.get(index + 1).unwrap().token_type == TokenType::Brace
        && tokens[index + 1].value == "("
    {
        let closing_parenthesis = find_closing_brace(tokens, index + 1, 0, "")?;
        let maybe_another_operator = next_meaningful_token(tokens, closing_parenthesis, None);
        if let Some(maybe_another_operator_token) = maybe_another_operator.token {
            if maybe_another_operator_token.token_type != TokenType::Operator
                || maybe_another_operator_token.value == "|>"
            {
                return Ok(closing_parenthesis);
            }
            let next_right = next_meaningful_token(tokens, maybe_another_operator.index, None);
            return find_end_of_binary_expression(tokens, next_right.index);
        } else {
            return Ok(closing_parenthesis);
        }
    }
    let maybe_operator = next_meaningful_token(tokens, index, None);
    if let Some(maybe_operator_token) = maybe_operator.token {
        if maybe_operator_token.token_type != TokenType::Operator
            || maybe_operator_token.value == "|>"
        {
            return Ok(index);
        }
        let next_right = next_meaningful_token(tokens, maybe_operator.index, None);
        find_end_of_binary_expression(tokens, next_right.index)
    } else {
        Ok(index)
    }
}

struct ValueReturn {
    value: Value,
    last_index: usize,
}

fn make_value(tokens: &Vec<Token>, index: usize) -> Result<ValueReturn, KclError> {
    let current_token = &tokens[index];
    let next = next_meaningful_token(tokens, index, None);
    if let Some(next_token) = &next.token {
        if next_token.token_type == TokenType::Brace && next_token.value == "(" {
            let end_index = find_closing_brace(tokens, next.index, 0, "")?;
            let token_after_call_expression = next_meaningful_token(tokens, end_index, None);
            if token_after_call_expression.token.is_some() {
                if let Some(token_after_call_expression_token) = token_after_call_expression.token {
                    if token_after_call_expression_token.token_type == TokenType::Operator
                        && token_after_call_expression_token.value != "|>"
                    {
                        let binary_expression = make_binary_expression(tokens, index)?;
                        return Ok(ValueReturn {
                            value: Value::BinaryExpression(Box::new(binary_expression.expression)),
                            last_index: binary_expression.last_index,
                        });
                    }
                } else {
                    return Err(KclError::Unimplemented(KclErrorDetails {
                        source_ranges: vec![[current_token.start as i32, current_token.end as i32]],
                        message: format!(
                            "expression with token type {:?}",
                            current_token.token_type
                        ),
                    }));
                }
            }
            let call_expression = make_call_expression(tokens, index)?;
            return Ok(ValueReturn {
                value: Value::CallExpression(Box::new(call_expression.expression)),
                last_index: call_expression.last_index,
            });
        }
    }
    if current_token.token_type == TokenType::Word
        || current_token.token_type == TokenType::Number
        || current_token.token_type == TokenType::String
    {
        if let Some(next_token) = &next.token {
            if next_token.token_type == TokenType::Operator {
                let binary_expression = make_binary_expression(tokens, index)?;
                return Ok(ValueReturn {
                    value: Value::BinaryExpression(Box::new(binary_expression.expression)),
                    last_index: binary_expression.last_index,
                });
            }
        }
    }
    if current_token.token_type == TokenType::Brace && current_token.value == "{" {
        let object_expression = make_object_expression(tokens, index)?;
        return Ok(ValueReturn {
            value: Value::ObjectExpression(Box::new(object_expression.expression)),
            last_index: object_expression.last_index,
        });
    }
    if current_token.token_type == TokenType::Brace && current_token.value == "[" {
        let array_expression = make_array_expression(tokens, index)?;
        return Ok(ValueReturn {
            value: Value::ArrayExpression(Box::new(array_expression.expression)),
            last_index: array_expression.last_index,
        });
    }

    if let Some(next_token) = next.token {
        if current_token.token_type == TokenType::Word
            && (next_token.token_type == TokenType::Period
                || (next_token.token_type == TokenType::Brace && next_token.value == "["))
        {
            let member_expression = make_member_expression(tokens, index)?;
            return Ok(ValueReturn {
                value: Value::MemberExpression(Box::new(member_expression.expression)),
                last_index: member_expression.last_index,
            });
        }
    }
    if current_token.token_type == TokenType::Word {
        let identifier = make_identifier(tokens, index);
        return Ok(ValueReturn {
            value: Value::Identifier(Box::new(identifier)),
            last_index: index,
        });
    }
    if current_token.token_type == TokenType::Number
        || current_token.token_type == TokenType::String
    {
        let literal = make_literal(tokens, index)?;
        return Ok(ValueReturn {
            value: Value::Literal(Box::new(literal)),
            last_index: index,
        });
    }

    if current_token.token_type == TokenType::Brace && current_token.value == "(" {
        let closing_brace_index = find_closing_brace(tokens, index, 0, "")?;
        if let Some(arrow_token) = next_meaningful_token(tokens, closing_brace_index, None).token {
            if arrow_token.token_type == TokenType::Operator && arrow_token.value == "=>" {
                let function_expression = make_function_expression(tokens, index)?;
                return Ok(ValueReturn {
                    value: Value::FunctionExpression(Box::new(function_expression.expression)),
                    last_index: function_expression.last_index,
                });
            } else {
                return Err(KclError::Unimplemented(KclErrorDetails {
                    source_ranges: vec![[current_token.start as i32, current_token.end as i32]],
                    message: "expression with braces".to_string(),
                }));
            }
        } else {
            return Err(KclError::Unimplemented(KclErrorDetails {
                source_ranges: vec![[current_token.start as i32, current_token.end as i32]],
                message: "expression with braces".to_string(),
            }));
        }
    }

    if current_token.token_type == TokenType::Operator && current_token.value == "-" {
        let unary_expression = make_unary_expression(tokens, index)?;
        return Ok(ValueReturn {
            value: Value::UnaryExpression(Box::new(unary_expression.expression)),
            last_index: unary_expression.last_index,
        });
    }

    Err(KclError::Unimplemented(KclErrorDetails {
        source_ranges: vec![[current_token.start as i32, current_token.end as i32]],
        message: format!("expression with token type {:?}", current_token.token_type),
    }))
}

struct ArrayElementsReturn {
    elements: Vec<Value>,
    last_index: usize,
}

fn make_array_elements(
    tokens: &Vec<Token>,
    index: usize,
    previous_elements: Vec<Value>,
) -> Result<ArrayElementsReturn, KclError> {
    let first_element_token = &tokens[index];
    if first_element_token.token_type == TokenType::Brace && first_element_token.value == "]" {
        return Ok(ArrayElementsReturn {
            elements: previous_elements,
            last_index: index,
        });
    }
    let current_element = make_value(tokens, index)?;
    let next_token = next_meaningful_token(tokens, current_element.last_index, None);
    if let Some(next_token_token) = next_token.token {
        let is_closing_brace =
            next_token_token.token_type == TokenType::Brace && next_token_token.value == "]";
        let is_comma = next_token_token.token_type == TokenType::Comma;
        if !is_closing_brace && !is_comma {
            return Err(KclError::Syntax(KclErrorDetails {
                source_ranges: vec![[next_token_token.start as i32, next_token_token.end as i32]],
                message: format!(
                    "Expected a comma or closing brace, found {:?}",
                    next_token_token.value
                ),
            }));
        }
        let next_call_index = if is_closing_brace {
            next_token.index
        } else {
            next_meaningful_token(tokens, next_token.index, None).index
        };
        let mut _previous_elements = previous_elements;
        _previous_elements.push(current_element.value);
        make_array_elements(tokens, next_call_index, _previous_elements)
    } else {
        Err(KclError::Unimplemented(KclErrorDetails {
            source_ranges: vec![[
                first_element_token.start as i32,
                first_element_token.end as i32,
            ]],
            message: "no next token".to_string(),
        }))
    }
}

#[derive(Debug, Clone)]
struct ArrayReturn {
    expression: ArrayExpression,
    last_index: usize,
}

fn make_array_expression(tokens: &Vec<Token>, index: usize) -> Result<ArrayReturn, KclError> {
    let opening_brace_token = &tokens[index];
    let first_element_token = next_meaningful_token(tokens, index, None);
    let array_elements = make_array_elements(tokens, first_element_token.index, Vec::new())?;
    Ok(ArrayReturn {
        expression: ArrayExpression {
            start: opening_brace_token.start,
            end: tokens[array_elements.last_index].end,
            elements: array_elements.elements,
        },
        last_index: array_elements.last_index,
    })
}

struct PipeBodyReturn {
    body: Vec<Value>,
    last_index: usize,
    non_code_meta: NoneCodeMeta,
}

fn make_pipe_body(
    tokens: &Vec<Token>,
    index: usize,
    previous_values: Vec<Value>,
    previous_non_code_meta: Option<NoneCodeMeta>,
) -> Result<PipeBodyReturn, KclError> {
    let non_code_meta = match previous_non_code_meta {
        Some(meta) => meta,
        None => NoneCodeMeta {
            start: None,
            none_code_nodes: HashMap::new(),
        },
    };
    let current_token = &tokens[index];
    let expression_start = next_meaningful_token(tokens, index, None);
    let value: Value;
    let last_index: usize;
    if current_token.token_type == TokenType::Operator {
        let val = make_value(tokens, expression_start.index)?;
        value = val.value;
        last_index = val.last_index;
    } else {
        return Err(KclError::Syntax(KclErrorDetails {
            source_ranges: vec![[current_token.start as i32, current_token.end as i32]],
            message: format!(
                "Expected a pipe value, found {:?}",
                current_token.token_type
            ),
        }));
    }
    let next_pipe = has_pipe_operator(tokens, index, None)?;
    if next_pipe.token.is_none() {
        let mut _previous_values = previous_values;
        _previous_values.push(value);
        return Ok(PipeBodyReturn {
            body: _previous_values,
            last_index,
            non_code_meta,
        });
    }
    let mut _non_code_meta: NoneCodeMeta;
    if let Some(node) = next_pipe.non_code_node {
        _non_code_meta = non_code_meta;
        _non_code_meta
            .none_code_nodes
            .insert(previous_values.len(), node);
    } else {
        _non_code_meta = non_code_meta;
    }
    let mut _previous_values = previous_values;
    _previous_values.push(value);
    make_pipe_body(
        tokens,
        next_pipe.index,
        _previous_values,
        Some(_non_code_meta),
    )
}

struct BinaryExpressionReturn {
    expression: BinaryExpression,
    last_index: usize,
}

fn make_binary_expression(
    tokens: &Vec<Token>,
    index: usize,
) -> Result<BinaryExpressionReturn, KclError> {
    let end_index = find_end_of_binary_expression(tokens, index)?;
    let expression = parse_expression(tokens[index..end_index + 1].to_vec())?;
    Ok(BinaryExpressionReturn {
        expression,
        last_index: end_index,
    })
}

struct ArgumentsReturn {
    arguments: Vec<Value>,
    last_index: usize,
}

fn make_arguments(
    tokens: &Vec<Token>,
    index: usize,
    previous_args: Vec<Value>,
) -> Result<ArgumentsReturn, KclError> {
    let brace_or_comma_token = &tokens[index];
    let should_finish_recursion =
        brace_or_comma_token.token_type == TokenType::Brace && brace_or_comma_token.value == ")";
    if should_finish_recursion {
        return Ok(ArgumentsReturn {
            arguments: previous_args,
            last_index: index,
        });
    }
    let argument_token = next_meaningful_token(tokens, index, None);
    if let Some(argument_token_token) = argument_token.token {
        let next_brace_or_comma = next_meaningful_token(tokens, argument_token.index, None);
        if let Some(next_brace_or_comma_token) = next_brace_or_comma.token {
            let is_identifier_or_literal = next_brace_or_comma_token.token_type == TokenType::Comma
                || next_brace_or_comma_token.token_type == TokenType::Brace;
            if argument_token_token.token_type == TokenType::Brace
                && argument_token_token.value == "["
            {
                let array_expression = make_array_expression(tokens, argument_token.index)?;
                let next_comma_or_brace_token_index =
                    next_meaningful_token(tokens, array_expression.last_index, None).index;
                let mut _previous_args = previous_args;
                _previous_args.push(Value::ArrayExpression(Box::new(
                    array_expression.expression,
                )));
                return make_arguments(tokens, next_comma_or_brace_token_index, _previous_args);
            }
            if argument_token_token.token_type == TokenType::Operator
                && argument_token_token.value == "-"
            {
                let unary_expression = make_unary_expression(tokens, argument_token.index)?;
                let next_comma_or_brace_token_index =
                    next_meaningful_token(tokens, unary_expression.last_index, None).index;
                let mut _previous_args = previous_args;
                _previous_args.push(Value::UnaryExpression(Box::new(
                    unary_expression.expression,
                )));
                return make_arguments(tokens, next_comma_or_brace_token_index, _previous_args);
            }
            if argument_token_token.token_type == TokenType::Brace
                && argument_token_token.value == "{"
            {
                let object_expression = make_object_expression(tokens, argument_token.index)?;
                let next_comma_or_brace_token_index =
                    next_meaningful_token(tokens, object_expression.last_index, None).index;
                let mut _previous_args = previous_args;
                _previous_args.push(Value::ObjectExpression(Box::new(
                    object_expression.expression,
                )));
                return make_arguments(tokens, next_comma_or_brace_token_index, _previous_args);
            }
            if (argument_token_token.token_type == TokenType::Word
                || argument_token_token.token_type == TokenType::Number
                || argument_token_token.token_type == TokenType::String)
                && next_brace_or_comma_token.token_type == TokenType::Operator
            {
                let binary_expression = make_binary_expression(tokens, argument_token.index)?;
                let next_comma_or_brace_token_index =
                    next_meaningful_token(tokens, binary_expression.last_index, None).index;
                let mut _previous_args = previous_args;
                _previous_args.push(Value::BinaryExpression(Box::new(
                    binary_expression.expression,
                )));
                return make_arguments(tokens, next_comma_or_brace_token_index, _previous_args);
            }

            if !is_identifier_or_literal {
                let binary_expression = make_binary_expression(tokens, next_brace_or_comma.index)?;
                let mut _previous_args = previous_args;
                _previous_args.push(Value::BinaryExpression(Box::new(
                    binary_expression.expression,
                )));
                return make_arguments(tokens, binary_expression.last_index, _previous_args);
            }
            if argument_token_token.token_type == TokenType::Operator
                && argument_token_token.value == "%"
            {
                let value = Value::PipeSubstitution(Box::new(PipeSubstitution {
                    start: argument_token_token.start,
                    end: argument_token_token.end,
                }));

                let mut _previous_args = previous_args;
                _previous_args.push(value);
                return make_arguments(tokens, next_brace_or_comma.index, _previous_args);
            }
            if argument_token_token.token_type == TokenType::Word
                && next_brace_or_comma_token.token_type == TokenType::Brace
                && next_brace_or_comma_token.value == "("
            {
                let closing_brace = find_closing_brace(tokens, next_brace_or_comma.index, 0, "")?;
                if let Some(token_after_closing_brace) =
                    next_meaningful_token(tokens, closing_brace, None).token
                {
                    if token_after_closing_brace.token_type == TokenType::Operator
                        && token_after_closing_brace.value != "|>"
                    {
                        let binary_expression =
                            make_binary_expression(tokens, argument_token.index)?;
                        let next_comma_or_brace_token_index =
                            next_meaningful_token(tokens, binary_expression.last_index, None).index;
                        let mut _previous_args = previous_args;
                        _previous_args.push(Value::BinaryExpression(Box::new(
                            binary_expression.expression,
                        )));
                        return make_arguments(
                            tokens,
                            next_comma_or_brace_token_index,
                            _previous_args,
                        );
                    }
                    let call_expression = make_call_expression(tokens, argument_token.index)?;
                    let next_comma_or_brace_token_index =
                        next_meaningful_token(tokens, call_expression.last_index, None).index;
                    let mut _previous_args = previous_args;
                    _previous_args
                        .push(Value::CallExpression(Box::new(call_expression.expression)));
                    return make_arguments(tokens, next_comma_or_brace_token_index, _previous_args);
                } else {
                    return Err(KclError::Unimplemented(KclErrorDetails {
                        source_ranges: vec![[
                            argument_token_token.start as i32,
                            argument_token_token.end as i32,
                        ]],
                        message: format!("Unexpected token {} ", argument_token_token.value),
                    }));
                }
            }

            if argument_token_token.token_type == TokenType::Word {
                let identifier =
                    Value::Identifier(Box::new(make_identifier(tokens, argument_token.index)));
                let mut _previous_args = previous_args;
                _previous_args.push(identifier);
                return make_arguments(tokens, next_brace_or_comma.index, _previous_args);
            } else if argument_token_token.token_type == TokenType::Number
                || argument_token_token.token_type == TokenType::String
            {
                let literal = Value::Literal(Box::new(make_literal(tokens, argument_token.index)?));
                let mut _previous_args = previous_args;
                _previous_args.push(literal);
                return make_arguments(tokens, next_brace_or_comma.index, _previous_args);
            } else if argument_token_token.token_type == TokenType::Brace
                && argument_token_token.value == ")"
            {
                return make_arguments(tokens, argument_token.index, previous_args);
            }

            Err(KclError::Unimplemented(KclErrorDetails {
                source_ranges: vec![[
                    argument_token_token.start as i32,
                    argument_token_token.end as i32,
                ]],
                message: format!("Unexpected token {} ", argument_token_token.value),
            }))
        } else {
            Err(KclError::Unimplemented(KclErrorDetails {
                source_ranges: vec![[
                    brace_or_comma_token.start as i32,
                    brace_or_comma_token.end as i32,
                ]],
                message: format!("Unexpected token {} ", brace_or_comma_token.value),
            }))
        }
    } else {
        Err(KclError::Unimplemented(KclErrorDetails {
            source_ranges: vec![[
                brace_or_comma_token.start as i32,
                brace_or_comma_token.end as i32,
            ]],
            message: format!("Unexpected token {} ", brace_or_comma_token.value),
        }))
    }
}

pub struct CallExpressionResult {
    pub expression: CallExpression,
    last_index: usize,
}

pub fn make_call_expression(
    tokens: &Vec<Token>,
    index: usize,
) -> Result<CallExpressionResult, KclError> {
    let current_token = tokens[index].clone();
    let brace_token = next_meaningful_token(tokens, index, None);
    let callee = make_identifier(tokens, index);
    let args = make_arguments(tokens, brace_token.index, vec![])?;
    let closing_brace_token = tokens[args.last_index].clone();
    Ok(CallExpressionResult {
        expression: CallExpression {
            start: current_token.start,
            end: closing_brace_token.end,
            callee,
            arguments: args.arguments,
            optional: false,
        },
        last_index: args.last_index,
    })
}

struct PipeExpressionResult {
    expression: PipeExpression,
    last_index: usize,
}

fn make_pipe_expression(
    tokens: &Vec<Token>,
    index: usize,
) -> Result<PipeExpressionResult, KclError> {
    let current_token = tokens[index].clone();
    let pipe_body_result = make_pipe_body(tokens, index, vec![], None)?;
    let end_token = tokens[pipe_body_result.last_index].clone();
    Ok(PipeExpressionResult {
        expression: PipeExpression {
            start: current_token.start,
            end: end_token.end,
            body: pipe_body_result.body,
            non_code_meta: pipe_body_result.non_code_meta,
        },
        last_index: pipe_body_result.last_index,
    })
}

struct VariableDeclaratorsReturn {
    declarations: Vec<VariableDeclarator>,
    last_index: usize,
}

fn make_variable_declarators(
    tokens: &Vec<Token>,
    index: usize,
    previous_declarators: Vec<VariableDeclarator>,
) -> Result<VariableDeclaratorsReturn, KclError> {
    let current_token = tokens[index].clone();
    let assignment = next_meaningful_token(tokens, index, None);
    if let Some(assignment_token) = assignment.token {
        let contents_start_token = next_meaningful_token(tokens, assignment.index, None);
        let pipe_start_index = if assignment_token.token_type == TokenType::Operator {
            contents_start_token.index
        } else {
            assignment.index
        };
        let next_pipe_operator = has_pipe_operator(tokens, pipe_start_index, None)?;
        let init: Value;
        let last_index = if next_pipe_operator.token.is_some() {
            let pipe_expression_result = make_pipe_expression(tokens, assignment.index)?;
            init = Value::PipeExpression(Box::new(pipe_expression_result.expression));
            pipe_expression_result.last_index
        } else {
            let value_result = make_value(tokens, contents_start_token.index)?;
            init = value_result.value;
            value_result.last_index
        };
        let current_declarator = VariableDeclarator {
            start: current_token.start,
            end: tokens[last_index].end,
            id: make_identifier(tokens, index),
            init,
        };
        let mut declarations = previous_declarators;
        declarations.push(current_declarator);
        Ok(VariableDeclaratorsReturn {
            declarations,
            last_index,
        })
    } else {
        Err(KclError::Unimplemented(KclErrorDetails {
            source_ranges: vec![[current_token.start as i32, current_token.end as i32]],
            message: format!("Unexpected token {} ", current_token.value),
        }))
    }
}

struct VariableDeclarationResult {
    declaration: VariableDeclaration,
    last_index: usize,
}

fn make_variable_declaration(
    tokens: &Vec<Token>,
    index: usize,
) -> Result<VariableDeclarationResult, KclError> {
    let current_token = tokens[index].clone();
    let declaration_start_token = next_meaningful_token(tokens, index, None);
    let variable_declarators_result =
        make_variable_declarators(tokens, declaration_start_token.index, vec![])?;
    Ok(VariableDeclarationResult {
        declaration: VariableDeclaration {
            start: current_token.start,
            end: variable_declarators_result.declarations
                [variable_declarators_result.declarations.len() - 1]
                .end,
            kind: if current_token.value == "const" {
                "const".to_string()
            } else if current_token.value == "fn" {
                "fn".to_string()
            } else {
                "unkown".to_string()
            },
            declarations: variable_declarators_result.declarations,
        },
        last_index: variable_declarators_result.last_index,
    })
}

pub struct ParamsResult {
    pub params: Vec<Identifier>,
    pub last_index: usize,
}

fn make_params(
    tokens: &Vec<Token>,
    index: usize,
    previous_params: Vec<Identifier>,
) -> Result<ParamsResult, KclError> {
    let brace_or_comma_token = &tokens[index];
    let argument = next_meaningful_token(tokens, index, None);
    if let Some(argument_token) = argument.token {
        let should_finish_recursion = (argument_token.token_type == TokenType::Brace
            && argument_token.value == ")")
            || (brace_or_comma_token.token_type == TokenType::Brace
                && brace_or_comma_token.value == ")");
        if should_finish_recursion {
            return Ok(ParamsResult {
                params: previous_params,
                last_index: index,
            });
        }
        let next_brace_or_comma_token = next_meaningful_token(tokens, argument.index, None);
        let identifier = make_identifier(tokens, argument.index);
        let mut _previous_params = previous_params;
        _previous_params.push(identifier);
        make_params(tokens, next_brace_or_comma_token.index, _previous_params)
    } else {
        Err(KclError::Unimplemented(KclErrorDetails {
            source_ranges: vec![[
                brace_or_comma_token.start as i32,
                brace_or_comma_token.end as i32,
            ]],
            message: format!("Unexpected token {} ", brace_or_comma_token.value),
        }))
    }
}

struct UnaryExpressionResult {
    expression: UnaryExpression,
    last_index: usize,
}

fn make_unary_expression(
    tokens: &Vec<Token>,
    index: usize,
) -> Result<UnaryExpressionResult, KclError> {
    let current_token = &tokens[index];
    let next_token = next_meaningful_token(tokens, index, None);
    let argument = make_value(tokens, next_token.index)?;
    let argument_token = &tokens[argument.last_index];
    Ok(UnaryExpressionResult {
        expression: UnaryExpression {
            operator: if current_token.value == "!" {
                "!".to_string()
            } else {
                "-".to_string()
            },
            start: current_token.start,
            end: argument_token.end,
            argument: match argument.value {
                Value::BinaryExpression(binary_expression) => {
                    BinaryPart::BinaryExpression(binary_expression)
                }
                Value::Identifier(identifier) => BinaryPart::Identifier(identifier),
                Value::Literal(literal) => BinaryPart::Literal(literal),
                Value::UnaryExpression(unary_expression) => {
                    BinaryPart::UnaryExpression(unary_expression)
                }
                Value::CallExpression(call_expression) => {
                    BinaryPart::CallExpression(call_expression)
                }
                _ => {
                    return Err(KclError::Syntax(KclErrorDetails {
                        source_ranges: vec![[current_token.start as i32, current_token.end as i32]],
                        message: "Invalid argument for unary expression".to_string(),
                    }));
                }
            },
        },
        last_index: argument.last_index,
    })
}

#[derive(Debug)]
struct ExpressionStatementResult {
    expression: ExpressionStatement,
    last_index: usize,
}

fn make_expression_statement(
    tokens: &Vec<Token>,
    index: usize,
) -> Result<ExpressionStatementResult, KclError> {
    let current_token = &tokens[index];
    let next = next_meaningful_token(tokens, index, None);
    if let Some(next_token) = &next.token {
        if next_token.token_type == TokenType::Brace && next_token.value == "(" {
            let call_expression = make_call_expression(tokens, index)?;
            let end = tokens[call_expression.last_index].end;
            return Ok(ExpressionStatementResult {
                expression: ExpressionStatement {
                    start: current_token.start,
                    // end: call_expression.last_index,
                    end,
                    expression: Value::CallExpression(Box::new(call_expression.expression)),
                },
                last_index: call_expression.last_index,
            });
        }
        let binary_expression = make_binary_expression(tokens, index)?;
        Ok(ExpressionStatementResult {
            expression: ExpressionStatement {
                start: current_token.start,
                end: binary_expression.expression.end,
                expression: Value::BinaryExpression(Box::new(binary_expression.expression)),
            },
            last_index: binary_expression.last_index,
        })
    } else {
        Err(KclError::Unimplemented(KclErrorDetails {
            source_ranges: vec![[current_token.start as i32, current_token.end as i32]],
            message: "make_expression_statement".to_string(),
        }))
    }
}

struct ObjectPropertiesResult {
    properties: Vec<ObjectProperty>,
    last_index: usize,
}

fn make_object_properties(
    tokens: &Vec<Token>,
    index: usize,
    previous_properties: Vec<ObjectProperty>,
) -> Result<ObjectPropertiesResult, KclError> {
    let property_key_token = &tokens[index];
    if property_key_token.token_type == TokenType::Brace && property_key_token.value == "}" {
        return Ok(ObjectPropertiesResult {
            properties: previous_properties,
            last_index: index,
        });
    }
    let colon_token = next_meaningful_token(tokens, index, None);
    let value_start_token = next_meaningful_token(tokens, colon_token.index, None);
    let val = make_value(tokens, value_start_token.index)?;
    let value = val.value;
    let value_last_index = val.last_index;
    let comma_or_closing_brace_token = next_meaningful_token(tokens, value_last_index, None);
    let object_property = ObjectProperty {
        start: property_key_token.start,
        end: match &value {
            Value::BinaryExpression(binary_expression) => binary_expression.end,
            Value::Identifier(identifier) => identifier.end,
            Value::Literal(literal) => literal.end,
            Value::CallExpression(call_expression) => call_expression.end,
            Value::UnaryExpression(unary_expression) => unary_expression.end,
            Value::ObjectExpression(object_expression) => object_expression.end,
            Value::ArrayExpression(array_expression) => array_expression.end,
            Value::FunctionExpression(function_expression) => function_expression.end,
            Value::PipeExpression(pipe_expression) => pipe_expression.end,
            Value::PipeSubstitution(pipe_substitution) => pipe_substitution.end,
            Value::MemberExpression(member_expression) => member_expression.end,
        },
        key: make_identifier(tokens, index),
        value,
    };
    let next_key_token = next_meaningful_token(tokens, comma_or_closing_brace_token.index, None);
    if let Some(comma_or_closing_brace_token_token) = &comma_or_closing_brace_token.token {
        let next_key_index = if comma_or_closing_brace_token_token.token_type == TokenType::Brace
            && comma_or_closing_brace_token_token.value == "}"
        {
            comma_or_closing_brace_token.index
        } else {
            next_key_token.index
        };
        let mut _previous_properties = previous_properties;
        _previous_properties.push(object_property);
        make_object_properties(tokens, next_key_index, _previous_properties)
    } else {
        Err(KclError::Unimplemented(KclErrorDetails {
            source_ranges: vec![[
                property_key_token.start as i32,
                property_key_token.end as i32,
            ]],
            message: "make_object_properties".to_string(),
        }))
    }
}

struct ObjectExpressionResult {
    expression: ObjectExpression,
    last_index: usize,
}

fn make_object_expression(
    tokens: &Vec<Token>,
    index: usize,
) -> Result<ObjectExpressionResult, KclError> {
    let opening_brace_token = &tokens[index];
    let first_property_token = next_meaningful_token(tokens, index, None);
    let object_properties = make_object_properties(tokens, first_property_token.index, vec![])?;
    Ok(ObjectExpressionResult {
        expression: ObjectExpression {
            start: opening_brace_token.start,
            end: tokens[object_properties.last_index].end,
            properties: object_properties.properties,
        },
        last_index: object_properties.last_index,
    })
}

struct ReturnStatementResult {
    statement: ReturnStatement,
    last_index: usize,
}

fn make_return_statement(
    tokens: &Vec<Token>,
    index: usize,
) -> Result<ReturnStatementResult, KclError> {
    let current_token = &tokens[index];
    let next_token = next_meaningful_token(tokens, index, None);
    let val = make_value(tokens, next_token.index)?;
    let value = val.value;
    let last_index = val.last_index;
    Ok(ReturnStatementResult {
        statement: ReturnStatement {
            start: current_token.start,
            end: tokens[last_index].end,
            argument: value,
        },
        last_index,
    })
}

struct BodyResult {
    body: Vec<BodyItem>,
    last_index: usize,
    non_code_meta: NoneCodeMeta,
}

fn make_body(
    tokens: &Vec<Token>,
    token_index: usize,
    previous_body: Vec<BodyItem>,
    previous_non_code_meta: NoneCodeMeta,
) -> Result<BodyResult, KclError> {
    let mut non_code_meta = previous_non_code_meta;
    if token_index >= tokens.len() - 1 {
        return Ok(BodyResult {
            body: previous_body,
            last_index: token_index,
            non_code_meta,
        });
    }

    let token = &tokens[token_index];
    if token.token_type == TokenType::Brace && token.value == "}" {
        return Ok(BodyResult {
            body: previous_body,
            last_index: token_index,
            non_code_meta,
        });
    }

    if is_not_code_token(token) {
        let next_token = next_meaningful_token(tokens, token_index, Some(0));
        if let Some(node) = &next_token.non_code_node {
            if previous_body.is_empty() {
                non_code_meta.start = next_token.non_code_node;
            } else {
                non_code_meta
                    .none_code_nodes
                    .insert(previous_body.len(), node.clone());
            }
        }
        return make_body(tokens, next_token.index, previous_body, non_code_meta);
    }

    let next = next_meaningful_token(tokens, token_index, None);
    if let Some(node) = &next.non_code_node {
        non_code_meta
            .none_code_nodes
            .insert(previous_body.len(), node.clone());
    }

    if token.token_type == TokenType::Word && (token.value == *"const" || token.value == "fn") {
        let declaration = make_variable_declaration(tokens, token_index)?;
        let next_thing = next_meaningful_token(tokens, declaration.last_index, None);
        if let Some(node) = &next_thing.non_code_node {
            non_code_meta
                .none_code_nodes
                .insert(previous_body.len(), node.clone());
        }
        let mut _previous_body = previous_body;
        _previous_body.push(BodyItem::VariableDeclaration(VariableDeclaration {
            start: declaration.declaration.start,
            end: declaration.declaration.end,
            kind: declaration.declaration.kind,
            declarations: declaration.declaration.declarations,
        }));
        let body = make_body(tokens, next_thing.index, _previous_body, non_code_meta)?;
        return Ok(BodyResult {
            body: body.body,
            last_index: body.last_index,
            non_code_meta: body.non_code_meta,
        });
    }

    if token.token_type == TokenType::Word && token.value == "return" {
        let statement = make_return_statement(tokens, token_index)?;
        let next_thing = next_meaningful_token(tokens, statement.last_index, None);
        if let Some(node) = &next_thing.non_code_node {
            non_code_meta
                .none_code_nodes
                .insert(previous_body.len(), node.clone());
        }
        let mut _previous_body = previous_body;
        _previous_body.push(BodyItem::ReturnStatement(ReturnStatement {
            start: statement.statement.start,
            end: statement.statement.end,
            argument: statement.statement.argument,
        }));
        let body = make_body(tokens, next_thing.index, _previous_body, non_code_meta)?;
        return Ok(BodyResult {
            body: body.body,
            last_index: body.last_index,
            non_code_meta: body.non_code_meta,
        });
    }

    if let Some(next_token) = next.token {
        if token.token_type == TokenType::Word
            && next_token.token_type == TokenType::Brace
            && next_token.value == "("
        {
            let expression = make_expression_statement(tokens, token_index)?;
            let next_thing = next_meaningful_token(tokens, expression.last_index, None);
            if let Some(node) = &next_thing.non_code_node {
                non_code_meta
                    .none_code_nodes
                    .insert(previous_body.len(), node.clone());
            }
            let mut _previous_body = previous_body;
            _previous_body.push(BodyItem::ExpressionStatement(ExpressionStatement {
                start: expression.expression.start,
                end: expression.expression.end,
                expression: expression.expression.expression,
            }));
            let body = make_body(tokens, next_thing.index, _previous_body, non_code_meta)?;
            return Ok(BodyResult {
                body: body.body,
                last_index: body.last_index,
                non_code_meta: body.non_code_meta,
            });
        }
    }

    let next_thing = next_meaningful_token(tokens, token_index, None);
    if let Some(next_thing_token) = next_thing.token {
        if (token.token_type == TokenType::Number || token.token_type == TokenType::Word)
            && next_thing_token.token_type == TokenType::Operator
        {
            if let Some(node) = &next_thing.non_code_node {
                non_code_meta
                    .none_code_nodes
                    .insert(previous_body.len(), node.clone());
            }
            let expression = make_expression_statement(tokens, token_index)?;
            let mut _previous_body = previous_body;
            _previous_body.push(BodyItem::ExpressionStatement(ExpressionStatement {
                start: expression.expression.start,
                end: expression.expression.end,
                expression: expression.expression.expression,
            }));
            return Ok(BodyResult {
                body: _previous_body,
                last_index: expression.last_index,
                non_code_meta,
            });
        }
    }

    Err(KclError::Syntax(KclErrorDetails {
        source_ranges: vec![[token.start as i32, token.end as i32]],
        message: "unexpected token".to_string(),
    }))
}

struct BlockStatementResult {
    block: BlockStatement,
    last_index: usize,
}

fn make_block_statement(
    tokens: &Vec<Token>,
    index: usize,
) -> Result<BlockStatementResult, KclError> {
    let opening_curly = tokens[index].clone();
    let next_token = &tokens[index + 1];
    let next_token_index = index + 1;
    let body = if next_token.value == "}" {
        BodyResult {
            body: vec![],
            last_index: next_token_index,
            non_code_meta: NoneCodeMeta {
                none_code_nodes: HashMap::new(),
                start: None,
            },
        }
    } else {
        make_body(
            tokens,
            next_token_index,
            vec![],
            NoneCodeMeta {
                none_code_nodes: HashMap::new(),
                start: None,
            },
        )?
    };
    Ok(BlockStatementResult {
        block: BlockStatement {
            start: opening_curly.start,
            end: tokens[body.last_index].end,
            body: body.body,
            non_code_meta: body.non_code_meta,
        },
        last_index: body.last_index,
    })
}

struct FunctionExpressionResult {
    expression: FunctionExpression,
    last_index: usize,
}

fn make_function_expression(
    tokens: &Vec<Token>,
    index: usize,
) -> Result<FunctionExpressionResult, KclError> {
    let current_token = &tokens[index];
    let closing_brace_index = find_closing_brace(tokens, index, 0, "")?;
    let arrow_token = next_meaningful_token(tokens, closing_brace_index, None);
    let body_start_token = next_meaningful_token(tokens, arrow_token.index, None);
    let params = make_params(tokens, index, vec![])?;
    let block = make_block_statement(tokens, body_start_token.index)?;
    Ok(FunctionExpressionResult {
        expression: FunctionExpression {
            start: current_token.start,
            end: tokens[block.last_index].end,
            id: None,
            params: params.params,
            body: block.block,
        },
        last_index: block.last_index,
    })
}

pub fn abstract_syntax_tree(tokens: &Vec<Token>) -> Result<Program, KclError> {
    let body = make_body(
        tokens,
        0,
        vec![],
        NoneCodeMeta {
            none_code_nodes: HashMap::new(),
            start: None,
        },
    )?;
    let end = match tokens.get(body.last_index) {
        Some(token) => token.end,
        None => tokens[tokens.len() - 1].end,
    };
    Ok(Program {
        start: 0,
        end,
        body: body.body,
        non_code_meta: body.non_code_meta,
    })
}

#[wasm_bindgen]
extern "C" {
    // Use `js_namespace` here to bind `console.log(..)` instead of just
    // `log(..)`
    #[wasm_bindgen(js_namespace = console)]
    fn log(s: &str);
}

#[wasm_bindgen]
pub fn parse_js(js: &str) -> Result<String, String> {
    let tokens = lexer(js);
    let program = abstract_syntax_tree(&tokens).map_err(String::from)?;
    //serde_wasm_bindgen::to_value(&program).map_err(|e| e.to_string())
    serde_json::to_string(&program).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use pretty_assertions::assert_eq;

    #[test]
    fn test_make_identifier() {
        let tokens = lexer("a");
        let identifier = make_identifier(&tokens, 0);
        assert_eq!(
            Identifier {
                start: 0,
                end: 1,
                name: "a".to_string()
            },
            identifier
        );
    }

    #[test]
    fn test_make_identifier_with_const_myvar_equals_5_and_index_2() {
        let tokens = lexer("const myVar = 5");
        let identifier = make_identifier(&tokens, 2);
        assert_eq!(
            Identifier {
                start: 6,
                end: 11,
                name: "myVar".to_string()
            },
            identifier
        );
    }

    #[test]
    fn test_make_identifier_multiline() {
        let tokens = lexer("const myVar = 5\nconst newVar = myVar + 1");
        let identifier = make_identifier(&tokens, 2);
        assert_eq!(
            Identifier {
                start: 6,
                end: 11,
                name: "myVar".to_string()
            },
            identifier
        );
        let identifier = make_identifier(&tokens, 10);
        assert_eq!(
            Identifier {
                start: 22,
                end: 28,
                name: "newVar".to_string()
            },
            identifier
        );
    }

    #[test]
    fn test_make_identifier_call_expression() {
        let tokens = lexer("log(5, \"hello\", aIdentifier)");
        let identifier = make_identifier(&tokens, 0);
        assert_eq!(
            Identifier {
                start: 0,
                end: 3,
                name: "log".to_string()
            },
            identifier
        );
        let identifier = make_identifier(&tokens, 8);
        assert_eq!(
            Identifier {
                start: 16,
                end: 27,
                name: "aIdentifier".to_string()
            },
            identifier
        );
    }
    #[test]
    fn test_make_none_code_node() {
        let tokens = lexer("log(5, \"hello\", aIdentifier)");
        let index = 4;
        let expected_output = (
            Some(NoneCodeNode {
                start: 6,
                end: 7,
                value: " ".to_string(),
            }),
            4,
        );
        assert_eq!(make_none_code_node(&tokens, index), expected_output);

        let index = 7;
        let expected_output = (
            Some(NoneCodeNode {
                start: 15,
                end: 16,
                value: " ".to_string(),
            }),
            7,
        );
        assert_eq!(make_none_code_node(&tokens, index), expected_output);
        let tokens = lexer(
            r#"
const yo = { a: { b: { c: '123' } } }
// this is a comment
const key = 'c'"#,
        );
        let index = 0;
        let expected_output = (
            Some(NoneCodeNode {
                start: 0,
                end: 1,
                value: "\n".to_string(),
            }),
            0,
        );
        assert_eq!(make_none_code_node(&tokens, index), expected_output);

        let index = 2;
        let expected_output = (
            Some(NoneCodeNode {
                start: 6,
                end: 7,
                value: " ".to_string(),
            }),
            2,
        );
        assert_eq!(make_none_code_node(&tokens, index), expected_output);

        let index = 2;
        let expected_output = (
            Some(NoneCodeNode {
                start: 6,
                end: 7,
                value: " ".to_string(),
            }),
            2,
        );
        assert_eq!(make_none_code_node(&tokens, index), expected_output);

        let index = 29;
        let expected_output = (
            Some(NoneCodeNode {
                start: 38,
                end: 60,
                value: "\n// this is a comment\n".to_string(),
            }),
            31,
        );
        assert_eq!(make_none_code_node(&tokens, index), expected_output);
        let tokens = lexer(
            r#"const mySketch = startSketchAt([0,0])
  |> lineTo({ to: [0, 1], tag: 'myPath' }, %)
  |> lineTo([1, 1], %) /* this is
      a comment
      spanning a few lines */
  |> lineTo({ to: [1,0], tag: "rightPath" }, %)
  |> close(%)"#,
        );
        let index = 57;
        let expected_output = (
            Some(NoneCodeNode {
                start: 106,
                end: 166,
                value: " /* this is\n      a comment\n      spanning a few lines */\n  "
                    .to_string(),
            }),
            59,
        );
        assert_eq!(make_none_code_node(&tokens, index), expected_output);
    }

    #[test]
    fn test_collect_object_keys() {
        let tokens = lexer("const prop = yo.one[\"two\"]");
        let keys_info = collect_object_keys(&tokens, 6, None).unwrap();
        assert_eq!(keys_info.len(), 2);
        let first_key = match keys_info[0].key.clone() {
            LiteralIdentifier::Identifier(identifier) => format!("identifier-{}", identifier.name),
            _ => panic!("Expected first key to be an identifier"),
        };
        assert_eq!(first_key, "identifier-one");
        assert!(!keys_info[0].computed);
        let second_key = match keys_info[1].key.clone() {
            LiteralIdentifier::Literal(literal) => format!("literal-{}", literal.value),
            _ => panic!("Expected second key to be a literal"),
        };
        assert_eq!(second_key, "literal-\"two\"");
        assert!(!keys_info[1].computed);
    }

    #[test]
    fn test_make_literal_call_expression() {
        let tokens = lexer("log(5, \"hello\", aIdentifier)");
        let literal = make_literal(&tokens, 2).unwrap();
        assert_eq!(
            Literal {
                start: 4,
                end: 5,
                value: serde_json::Value::Number(5.into()),
                raw: "5".to_string()
            },
            literal
        );
        let literal = make_literal(&tokens, 5).unwrap();
        assert_eq!(
            Literal {
                start: 7,
                end: 14,
                value: serde_json::Value::String("hello".to_string()),
                raw: "\"hello\"".to_string()
            },
            literal
        );
    }

    #[test]
    fn test_is_not_code_token() {
        assert!(!is_not_code_token(&Token {
            token_type: TokenType::Word,
            start: 0,
            end: 3,
            value: "log".to_string(),
        }));
        assert!(!is_not_code_token(&Token {
            token_type: TokenType::Brace,
            start: 3,
            end: 4,
            value: "(".to_string(),
        }));
        assert!(!is_not_code_token(&Token {
            token_type: TokenType::Number,
            start: 4,
            end: 5,
            value: "5".to_string(),
        }));
        assert!(!is_not_code_token(&Token {
            token_type: TokenType::Comma,
            start: 5,
            end: 6,
            value: ",".to_string(),
        }));
        assert!(is_not_code_token(&Token {
            token_type: TokenType::Whitespace,
            start: 6,
            end: 7,
            value: " ".to_string(),
        }));
        assert!(!is_not_code_token(&Token {
            token_type: TokenType::String,
            start: 7,
            end: 14,
            value: "\"hello\"".to_string(),
        }));
        assert!(!is_not_code_token(&Token {
            token_type: TokenType::Word,
            start: 16,
            end: 27,
            value: "aIdentifier".to_string(),
        }));
        assert!(!is_not_code_token(&Token {
            token_type: TokenType::Brace,
            start: 27,
            end: 28,
            value: ")".to_string(),
        }));
        assert!(is_not_code_token(&Token {
            token_type: TokenType::BlockComment,
            start: 28,
            end: 30,
            value: "/* abte */".to_string(),
        }));
        assert!(is_not_code_token(&Token {
            token_type: TokenType::LineComment,
            start: 30,
            end: 33,
            value: "// yoyo a line".to_string(),
        }));
    }

    #[test]
    fn test_next_meaningful_token() {
        let _offset = 1;
        let tokens = lexer(
            r#"const mySketch = startSketchAt([0,0])
  |> lineTo({ to: [0, 1], tag: 'myPath' }, %)
  |> lineTo([1, 1], %) /* this is
      a comment
      spanning a few lines */
  |> lineTo({ to: [1,0], tag: "rightPath" }, %)
  |> close(%)"#,
        );
        let index = 17;
        let expected_output = TokenReturnWithNonCode {
            token: Some(Token {
                token_type: TokenType::Brace,
                start: 49,
                end: 50,
                value: "(".to_string(),
            }),
            index: 18,
            non_code_node: None,
        };
        assert_eq!(next_meaningful_token(&tokens, index, None), expected_output);
        let index = 18;
        let expected_output = TokenReturnWithNonCode {
            token: Some(Token {
                token_type: TokenType::Brace,
                start: 50,
                end: 51,
                value: "{".to_string(),
            }),
            index: 19,
            non_code_node: None,
        };
        assert_eq!(next_meaningful_token(&tokens, index, None), expected_output);
        let index = 21;
        let expected_output = TokenReturnWithNonCode {
            token: Some(Token {
                token_type: TokenType::Colon,
                start: 54,
                end: 55,
                value: ":".to_string(),
            }),
            index: 22,
            non_code_node: None,
        };
        assert_eq!(next_meaningful_token(&tokens, index, None), expected_output);
        let index = 24;
        let expected_output = TokenReturnWithNonCode {
            token: Some(Token {
                token_type: TokenType::Number,
                start: 57,
                end: 58,
                value: "0".to_string(),
            }),
            index: 25,
            non_code_node: None,
        };
        assert_eq!(next_meaningful_token(&tokens, index, None), expected_output);
        let index = 25;
        let expected_output = TokenReturnWithNonCode {
            token: Some(Token {
                token_type: TokenType::Comma,
                start: 58,
                end: 59,
                value: ",".to_string(),
            }),
            index: 26,
            non_code_node: None,
        };
        assert_eq!(next_meaningful_token(&tokens, index, None), expected_output);
        let index = 28;
        let expected_output = TokenReturnWithNonCode {
            token: Some(Token {
                token_type: TokenType::Brace,
                start: 61,
                end: 62,
                value: "]".to_string(),
            }),
            index: 29,
            non_code_node: None,
        };
        assert_eq!(next_meaningful_token(&tokens, index, None), expected_output);
        let index = 29;
        let expected_output = TokenReturnWithNonCode {
            token: Some(Token {
                token_type: TokenType::Comma,
                start: 62,
                end: 63,
                value: ",".to_string(),
            }),
            index: 30,
            non_code_node: None,
        };
        assert_eq!(next_meaningful_token(&tokens, index, None), expected_output);
        let index = 32;
        let expected_output = TokenReturnWithNonCode {
            token: Some(Token {
                token_type: TokenType::Colon,
                start: 67,
                end: 68,
                value: ":".to_string(),
            }),
            index: 33,
            non_code_node: None,
        };
        assert_eq!(next_meaningful_token(&tokens, index, None), expected_output);
        let index = 37;
        let expected_output = TokenReturnWithNonCode {
            token: Some(Token {
                token_type: TokenType::Comma,
                start: 79,
                end: 80,
                value: ",".to_string(),
            }),
            index: 38,
            non_code_node: None,
        };
        assert_eq!(next_meaningful_token(&tokens, index, None), expected_output);
        let index = 40;
        let expected_output = TokenReturnWithNonCode {
            token: Some(Token {
                token_type: TokenType::Brace,
                start: 82,
                end: 83,
                value: ")".to_string(),
            }),
            index: 41,
            non_code_node: None,
        };
        assert_eq!(next_meaningful_token(&tokens, index, None), expected_output);
        let index = 45;
        let expected_output = TokenReturnWithNonCode {
            token: Some(Token {
                token_type: TokenType::Brace,
                start: 95,
                end: 96,
                value: "(".to_string(),
            }),
            index: 46,
            non_code_node: None,
        };
        assert_eq!(next_meaningful_token(&tokens, index, None), expected_output);
        let index = 46;
        let expected_output = TokenReturnWithNonCode {
            token: Some(Token {
                token_type: TokenType::Brace,
                start: 96,
                end: 97,
                value: "[".to_string(),
            }),
            index: 47,
            non_code_node: None,
        };
        assert_eq!(next_meaningful_token(&tokens, index, None), expected_output);
        let index = 47;
        let expected_output = TokenReturnWithNonCode {
            token: Some(Token {
                token_type: TokenType::Number,
                start: 97,
                end: 98,
                value: "1".to_string(),
            }),
            index: 48,
            non_code_node: None,
        };
        assert_eq!(next_meaningful_token(&tokens, index, None), expected_output);
        let index = 48;
        let expected_output = TokenReturnWithNonCode {
            token: Some(Token {
                token_type: TokenType::Comma,
                start: 98,
                end: 99,
                value: ",".to_string(),
            }),
            index: 49,
            non_code_node: None,
        };
        assert_eq!(next_meaningful_token(&tokens, index, None), expected_output);
        let index = 51;
        let expected_output = TokenReturnWithNonCode {
            token: Some(Token {
                token_type: TokenType::Brace,
                start: 101,
                end: 102,
                value: "]".to_string(),
            }),
            index: 52,
            non_code_node: None,
        };
        assert_eq!(next_meaningful_token(&tokens, index, None), expected_output);
        let index = 52;
        let expected_output = TokenReturnWithNonCode {
            token: Some(Token {
                token_type: TokenType::Comma,
                start: 102,
                end: 103,
                value: ",".to_string(),
            }),
            index: 53,
            non_code_node: None,
        };
        assert_eq!(next_meaningful_token(&tokens, index, None), expected_output);
        let index = 55;
        let expected_output = TokenReturnWithNonCode {
            token: Some(Token {
                token_type: TokenType::Brace,
                start: 105,
                end: 106,
                value: ")".to_string(),
            }),
            index: 56,
            non_code_node: None,
        };
        assert_eq!(next_meaningful_token(&tokens, index, None), expected_output);
        let index = 62;
        let expected_output = TokenReturnWithNonCode {
            token: Some(Token {
                token_type: TokenType::Brace,
                start: 175,
                end: 176,
                value: "(".to_string(),
            }),
            index: 63,
            non_code_node: None,
        };
        assert_eq!(next_meaningful_token(&tokens, index, None), expected_output);
        let index = 63;
        let expected_output = TokenReturnWithNonCode {
            token: Some(Token {
                token_type: TokenType::Brace,
                start: 176,
                end: 177,
                value: "{".to_string(),
            }),
            index: 64,
            non_code_node: None,
        };
        assert_eq!(next_meaningful_token(&tokens, index, None), expected_output);
        let index = 66;
        let expected_output = TokenReturnWithNonCode {
            token: Some(Token {
                token_type: TokenType::Colon,
                start: 180,
                end: 181,
                value: ":".to_string(),
            }),
            index: 67,
            non_code_node: None,
        };
        assert_eq!(next_meaningful_token(&tokens, index, None), expected_output);
        let index = 69;
        let expected_output = TokenReturnWithNonCode {
            token: Some(Token {
                token_type: TokenType::Number,
                start: 183,
                end: 184,
                value: "1".to_string(),
            }),
            index: 70,
            non_code_node: None,
        };
        assert_eq!(next_meaningful_token(&tokens, index, None), expected_output);
        let index = 70;
        let expected_output = TokenReturnWithNonCode {
            token: Some(Token {
                token_type: TokenType::Comma,
                start: 184,
                end: 185,
                value: ",".to_string(),
            }),
            index: 71,
            non_code_node: None,
        };
        assert_eq!(next_meaningful_token(&tokens, index, None), expected_output);
        let index = 71;
        let expected_output = TokenReturnWithNonCode {
            token: Some(Token {
                token_type: TokenType::Number,
                start: 185,
                end: 186,
                value: "0".to_string(),
            }),
            index: 72,
            non_code_node: None,
        };
        assert_eq!(next_meaningful_token(&tokens, index, None), expected_output);
        let index = 72;
        let expected_output = TokenReturnWithNonCode {
            token: Some(Token {
                token_type: TokenType::Brace,
                start: 186,
                end: 187,
                value: "]".to_string(),
            }),
            index: 73,
            non_code_node: None,
        };
        assert_eq!(next_meaningful_token(&tokens, index, None), expected_output);
        let index = 73;
        let expected_output = TokenReturnWithNonCode {
            token: Some(Token {
                token_type: TokenType::Comma,
                start: 187,
                end: 188,
                value: ",".to_string(),
            }),
            index: 74,
            non_code_node: None,
        };
        assert_eq!(next_meaningful_token(&tokens, index, None), expected_output);
        let index = 76;
        let expected_output = TokenReturnWithNonCode {
            token: Some(Token {
                token_type: TokenType::Colon,
                start: 192,
                end: 193,
                value: ":".to_string(),
            }),
            index: 77,
            non_code_node: None,
        };
        assert_eq!(next_meaningful_token(&tokens, index, None), expected_output);
        let index = 81;
        let expected_output = TokenReturnWithNonCode {
            token: Some(Token {
                token_type: TokenType::Comma,
                start: 207,
                end: 208,
                value: ",".to_string(),
            }),
            index: 82,
            non_code_node: None,
        };
        assert_eq!(next_meaningful_token(&tokens, index, None), expected_output);
        let index = 84;
        let expected_output = TokenReturnWithNonCode {
            token: Some(Token {
                token_type: TokenType::Brace,
                start: 210,
                end: 211,
                value: ")".to_string(),
            }),
            index: 85,
            non_code_node: None,
        };
        assert_eq!(next_meaningful_token(&tokens, index, None), expected_output);
        let index = 89;
        let expected_output = TokenReturnWithNonCode {
            token: Some(Token {
                token_type: TokenType::Brace,
                start: 222,
                end: 223,
                value: "(".to_string(),
            }),
            index: 90,
            non_code_node: None,
        };
        assert_eq!(next_meaningful_token(&tokens, index, None), expected_output);
        let index = 90;
        let expected_output = TokenReturnWithNonCode {
            token: Some(Token {
                token_type: TokenType::Operator,
                start: 223,
                end: 224,
                value: "%".to_string(),
            }),
            index: 91,
            non_code_node: None,
        };
        assert_eq!(next_meaningful_token(&tokens, index, None), expected_output);
        let index = 91;
        let expected_output = TokenReturnWithNonCode {
            token: Some(Token {
                token_type: TokenType::Brace,
                start: 224,
                end: 225,
                value: ")".to_string(),
            }),
            index: 92,
            non_code_node: None,
        };
        assert_eq!(next_meaningful_token(&tokens, index, None), expected_output);
    }

    #[test]
    fn test_find_closing_brace() {
        let tokens = lexer(
            r#"const mySketch = startSketchAt([0,0])
|> lineTo({ to: [0, 1], tag: 'myPath' }, %)
|> lineTo([1, 1], %) /* this is
  a comment
  spanning a few lines */
|> lineTo({ to: [1,0], tag: "rightPath" }, %)
|> close(%)"#,
        );
        assert_eq!(find_closing_brace(&tokens, 7, 0, "").unwrap(), 13);
        assert_eq!(find_closing_brace(&tokens, 18, 0, "").unwrap(), 41);
        assert_eq!(find_closing_brace(&tokens, 46, 0, "").unwrap(), 56);
        assert_eq!(find_closing_brace(&tokens, 63, 0, "").unwrap(), 85);
        assert_eq!(find_closing_brace(&tokens, 90, 0, "").unwrap(), 92);

        let basic = "( hey )";
        assert_eq!(find_closing_brace(&lexer(basic), 0, 0, "").unwrap(), 4);

        let handles_non_zero_index =
            "(indexForBracketToRightOfThisIsTwo(shouldBeFour)AndNotThisSix)";
        assert_eq!(
            find_closing_brace(&lexer(handles_non_zero_index), 2, 0, "").unwrap(),
            4
        );
        assert_eq!(
            find_closing_brace(&lexer(handles_non_zero_index), 0, 0, "").unwrap(),
            6
        );

        let handles_nested = "{a{b{c(}d]}eathou athoeu tah u} thatOneToTheLeftIsLast }";
        assert_eq!(
            find_closing_brace(&lexer(handles_nested), 0, 0, "").unwrap(),
            18
        );

        // TODO expect error when not started on a brace
    }

    #[test]
    fn test_is_call_expression() {
        let tokens = lexer(
            r#"const mySketch = startSketchAt([0,0])
|> lineTo({ to: [0, 1], tag: 'myPath' }, %)
|> lineTo([1, 1], %) /* this is
  a comment
  spanning a few lines */
|> lineTo({ to: [1,0], tag: "rightPath" }, %)
|> close(%)"#,
        );

        assert_eq!(is_call_expression(&tokens, 4).unwrap(), None);
        assert_eq!(is_call_expression(&tokens, 6).unwrap(), Some(13));
        assert_eq!(is_call_expression(&tokens, 15).unwrap(), None);
        assert_eq!(is_call_expression(&tokens, 43).unwrap(), None);
        assert_eq!(is_call_expression(&tokens, 60).unwrap(), None);
        assert_eq!(is_call_expression(&tokens, 87).unwrap(), None);
    }

    #[test]
    fn test_find_next_declaration_keyword() {
        let tokens = lexer(
            r#"const mySketch = startSketchAt([0,0])
|> lineTo({ to: [0, 1], tag: 'myPath' }, %)
|> lineTo([1, 1], %) /* this is
  a comment
  spanning a few lines */
|> lineTo({ to: [1,0], tag: "rightPath" }, %)
|> close(%)"#,
        );
        assert_eq!(
            find_next_declaration_keyword(&tokens, 4).unwrap(),
            TokenReturn {
                token: None,
                index: 92,
            }
        );

        let tokens = lexer(
            r#"const myVar = 5
const newVar = myVar + 1
"#,
        );
        assert_eq!(
            find_next_declaration_keyword(&tokens, 6).unwrap(),
            TokenReturn {
                token: Some(Token {
                    token_type: TokenType::Word,
                    start: 16,
                    end: 21,
                    value: "const".to_string(),
                }),
                index: 8,
            }
        );
        assert_eq!(
            find_next_declaration_keyword(&tokens, 14).unwrap(),
            TokenReturn {
                token: None,
                index: 19,
            }
        );
    }

    #[test]
    fn test_has_pipe_operator() {
        let code = r#"sketch mySketch {
  lineTo(2, 3)
} |> rx(45, %)
"#;
        let tokens = lexer(code);
        assert_eq!(
            has_pipe_operator(&tokens, 0, None).unwrap(),
            TokenReturnWithNonCode {
                token: Some(Token {
                    token_type: TokenType::Operator,
                    start: 35,
                    end: 37,
                    value: "|>".to_string(),
                }),
                index: 16,
                non_code_node: Some(NoneCodeNode {
                    start: 34,
                    end: 35,
                    value: " ".to_string()
                }),
            }
        );
        let code = r#"sketch mySketch {
  lineTo(2, 3)
} |> rx(45, %) |> rx(45, %)
"#;
        let tokens = lexer(code);
        assert_eq!(
            has_pipe_operator(&tokens, 0, None).unwrap(),
            TokenReturnWithNonCode {
                token: Some(Token {
                    token_type: TokenType::Operator,
                    start: 35,
                    end: 37,
                    value: "|>".to_string(),
                }),
                index: 16,
                non_code_node: Some(NoneCodeNode {
                    start: 34,
                    end: 35,
                    value: " ".to_string()
                }),
            }
        );

        let code = r#"sketch mySketch {
  lineTo(2, 3)
}
const yo = myFunc(9()
  |> rx(45, %)
"#;
        let tokens = lexer(code);
        assert_eq!(
            has_pipe_operator(&tokens, 0, None).unwrap(),
            TokenReturnWithNonCode {
                token: None,
                index: 16,
                non_code_node: None,
            }
        );

        let code = "const myVar2 = 5 + 1 |> myFn(%)";
        let tokens = lexer(code);
        assert_eq!(
            has_pipe_operator(&tokens, 1, None).unwrap(),
            TokenReturnWithNonCode {
                token: Some(Token {
                    token_type: TokenType::Operator,
                    start: 21,
                    end: 23,
                    value: "|>".to_string(),
                }),
                index: 12,
                non_code_node: Some(NoneCodeNode {
                    start: 20,
                    end: 21,
                    value: " ".to_string()
                }),
            }
        );

        let code = r#"sketch mySk1 {
  lineTo(1,1)
  path myPath = lineTo(0, 1)
  lineTo(1,1)
} |> rx(90, %)
show(mySk1)"#;
        let tokens = lexer(code);
        let token_with_my_path_index = tokens
            .iter()
            .position(|token| token.value == "myPath")
            .unwrap();
        // loop through getting the token and it's index
        let token_with_line_to_index_for_var_dec_index = tokens
            .iter()
            .enumerate()
            .find(|(index, token)| token.value == "lineTo" && index > &token_with_my_path_index)
            .unwrap()
            .0;
        // expect to return None,
        assert_eq!(
            has_pipe_operator(&tokens, token_with_line_to_index_for_var_dec_index, None).unwrap(),
            TokenReturnWithNonCode {
                token: None,
                index: 27,
                non_code_node: None,
            }
        );

        let brace_token_index = tokens.iter().position(|token| token.value == "{").unwrap();
        assert_eq!(
            has_pipe_operator(&tokens, brace_token_index, None).unwrap(),
            TokenReturnWithNonCode {
                token: Some(Token {
                    token_type: TokenType::Operator,
                    start: 74,
                    end: 76,
                    value: "|>".to_string(),
                }),
                index: 36,
                non_code_node: Some(NoneCodeNode {
                    start: 73,
                    end: 74,
                    value: " ".to_string()
                }),
            }
        );
    }

    #[test]
    fn test_make_member_expression() {
        let tokens = lexer("const prop = yo.one[\"two\"]");
        let member_expression_return = make_member_expression(&tokens, 6).unwrap();
        let member_expression = member_expression_return.expression;
        let last_index = member_expression_return.last_index;
        assert_eq!(member_expression.start, 13);
        assert_eq!(member_expression.end, 26);
        let member_object = match member_expression.object {
            MemberObject::MemberExpression(member_expression) => member_expression,
            _ => panic!("Expected member expression"),
        };
        assert_eq!(member_object.start, 13);
        assert_eq!(member_object.end, 19);
        let member_object_object = match member_object.object {
            MemberObject::Identifier(identifier) => identifier,
            _ => panic!("Expected identifier"),
        };
        assert_eq!(member_object_object.start, 13);
        assert_eq!(member_object_object.end, 15);
        assert_eq!(member_object_object.name, "yo");
        let member_object_property = match member_object.property {
            LiteralIdentifier::Identifier(identifier) => identifier,
            _ => panic!("Expected identifier"),
        };
        assert_eq!(member_object_property.start, 16);
        assert_eq!(member_object_property.end, 19);
        assert_eq!(member_object_property.name, "one");
        assert!(!member_object.computed);
        let member_expression_property = match member_expression.property {
            LiteralIdentifier::Literal(literal) => literal,
            _ => panic!("Expected literal"),
        };
        assert_eq!(member_expression_property.start, 20);
        assert_eq!(member_expression_property.end, 25);
        assert_eq!(member_expression_property.value, "two");
        assert!(!member_expression.computed);
        assert_eq!(last_index, 11);
    }

    #[test]
    fn test_find_end_of_binary_expression() {
        let code = "1 + 2 * 3\nconst yo = 5";
        let tokens = lexer(code);
        let end = find_end_of_binary_expression(&tokens, 0).unwrap();
        assert_eq!(tokens[end].value, "3");

        let code = "(1 + 25) / 5 - 3\nconst yo = 5";
        let tokens = lexer(code);
        let end = find_end_of_binary_expression(&tokens, 0).unwrap();
        assert_eq!(tokens[end].value, "3");
        let index_of_5 = code.find('5').unwrap();
        let end_starting_at_the_5 = find_end_of_binary_expression(&tokens, index_of_5).unwrap();
        assert_eq!(end_starting_at_the_5, end);
        // whole thing wraped
        let code = "((1 + 2) / 5 - 3)\nconst yo = 5";
        let tokens = lexer(code);
        let end = find_end_of_binary_expression(&tokens, 0).unwrap();
        assert_eq!(tokens[end].end, code.find("3)").unwrap() + 2);
        // whole thing wraped but given index after the first brace
        let code = "((1 + 2) / 5 - 3)\nconst yo = 5";
        let tokens = lexer(code);
        let end = find_end_of_binary_expression(&tokens, 1).unwrap();
        assert_eq!(tokens[end].value, "3");
        // given the index of a small wrapped section i.e. `1 + 2` in ((1 + 2) / 5 - 3)'
        let code = "((1 + 2) / 5 - 3)\nconst yo = 5";
        let tokens = lexer(code);
        let end = find_end_of_binary_expression(&tokens, 2).unwrap();
        assert_eq!(tokens[end].value, "2");
        // lots of silly nesting
        let code = "(1 + 2) / (5 - (3))\nconst yo = 5";
        let tokens = lexer(code);
        let end = find_end_of_binary_expression(&tokens, 0).unwrap();
        assert_eq!(tokens[end].end, code.find("))").unwrap() + 2);
        // with pipe operator at the end
        let code = "(1 + 2) / (5 - (3))\n  |> fn(%)";
        let tokens = lexer(code);
        let end = find_end_of_binary_expression(&tokens, 0).unwrap();
        assert_eq!(tokens[end].end, code.find("))").unwrap() + 2);
        // with call expression at the start of binary expression
        let code = "yo(2) + 3\n  |> fn(%)";
        let tokens = lexer(code);
        let end = find_end_of_binary_expression(&tokens, 0).unwrap();
        assert_eq!(tokens[end].value, "3");
        // with call expression at the end of binary expression
        let code = "3 + yo(2)\n  |> fn(%)";
        let tokens = lexer(code);
        let _end = find_end_of_binary_expression(&tokens, 0).unwrap();
    }

    #[test]
    fn test_make_array_expression() {
        // input_index: 6, output_index: 14, output: {"type":"ArrayExpression","start":11,"end":26,"elements":[{"type":"Literal","start":12,"end":15,"value":"1","raw":"\"1\""},{"type":"Literal","start":17,"end":18,"value":2,"raw":"2"},{"type":"Identifier","start":20,"end":25,"name":"three"}]}
        let tokens = lexer("const yo = [\"1\", 2, three]");
        let array_expression = make_array_expression(&tokens, 6).unwrap();
        let expression = array_expression.expression;
        assert_eq!(array_expression.last_index, 14);
        assert_eq!(expression.start, 11);
        assert_eq!(expression.end, 26);
        let elements = expression.elements;
        assert_eq!(elements.len(), 3);
        match &elements[0] {
            Value::Literal(literal) => {
                assert_eq!(literal.start, 12);
                assert_eq!(literal.end, 15);
                assert_eq!(literal.value, serde_json::Value::String("1".to_string()));
                assert_eq!(literal.raw, "\"1\"".to_string());
            }
            _ => panic!("Expected literal"),
        }
        match &elements[1] {
            Value::Literal(literal) => {
                assert_eq!(literal.start, 17);
                assert_eq!(literal.end, 18);
                assert_eq!(literal.value, serde_json::Value::Number(2.into()));
                assert_eq!(literal.raw, "2".to_string());
            }
            _ => panic!("Expected literal"),
        }
        match &elements[2] {
            Value::Identifier(identifier) => {
                assert_eq!(identifier.start, 20);
                assert_eq!(identifier.end, 25);
                assert_eq!(identifier.name, "three".to_string());
            }
            _ => panic!("Expected identifier"),
        }
    }

    #[test]
    fn test_make_call_expression() {
        let tokens = lexer("foo(\"a\", a, 3)");
        let result = make_call_expression(&tokens, 0).unwrap();
        assert_eq!(result.last_index, 9);
        assert_eq!(result.expression.start, 0);
        assert_eq!(result.expression.end, 14);
        assert_eq!(result.expression.callee.name, "foo");
        assert_eq!(result.expression.arguments.len(), 3);
        assert!(!result.expression.optional);
        let arguments = result.expression.arguments;
        match arguments[0] {
            Value::Literal(ref literal) => {
                assert_eq!(literal.value, "a");
                assert_eq!(literal.raw, "\"a\"");
            }
            _ => panic!("Expected literal"),
        }
        match arguments[1] {
            Value::Identifier(ref identifier) => {
                assert_eq!(identifier.name, "a");
            }
            _ => panic!("Expected identifier"),
        }
        match arguments[2] {
            Value::Literal(ref literal) => {
                assert_eq!(literal.value, 3);
                assert_eq!(literal.raw, "3");
            }
            _ => panic!("Expected literal"),
        }
    }

    #[test]
    fn test_make_variable_declaration() {
        let tokens = lexer(
            r#"const yo = startSketch([0, 0])
  |> lineTo([1, myVar], %)
  |> foo(myVar2, %)
  |> close(%)"#,
        );
        let result = make_variable_declaration(&tokens, 0).unwrap();
        assert_eq!(result.declaration.kind, "const");
        assert_eq!(result.declaration.declarations.len(), 1);
        assert_eq!(result.declaration.declarations[0].id.name, "yo");
        let declaration = result.declaration.declarations[0].clone();
        let body = match declaration.init {
            Value::PipeExpression(body) => body,
            _ => panic!("expected pipe expression"),
        };
        assert_eq!(body.body.len(), 4);
        let first_call_expression = match &body.body[0] {
            Value::CallExpression(call_expression) => call_expression,
            _ => panic!("expected call expression"),
        };
        assert_eq!(first_call_expression.callee.name, "startSketch");
        assert_eq!(first_call_expression.arguments.len(), 1);
        let first_argument = &first_call_expression.arguments[0];
        let first_argument_array_expression = match first_argument {
            Value::ArrayExpression(array_expression) => array_expression,
            _ => panic!("expected array expression"),
        };
        assert_eq!(first_argument_array_expression.elements.len(), 2);
        let second_call_expression = match &body.body[1] {
            Value::CallExpression(call_expression) => call_expression,
            _ => panic!("expected call expression"),
        };
        assert_eq!(second_call_expression.callee.name, "lineTo");
        assert_eq!(second_call_expression.arguments.len(), 2);
        let first_argument = &second_call_expression.arguments[0];
        let first_argument_array_expression = match first_argument {
            Value::ArrayExpression(array_expression) => array_expression,
            _ => panic!("expected array expression"),
        };
        assert_eq!(first_argument_array_expression.elements.len(), 2);
        let second_argument = &second_call_expression.arguments[1];
        let second_argument_pipe_substitution = match second_argument {
            Value::PipeSubstitution(pipe_substitution) => pipe_substitution,
            _ => panic!("expected pipe substitution"),
        };
        assert_eq!(second_argument_pipe_substitution.start, 55);
        let third_call_expression = match &body.body[2] {
            Value::CallExpression(call_expression) => call_expression,
            _ => panic!("expected call expression"),
        };
        assert_eq!(third_call_expression.callee.name, "foo");
        assert_eq!(third_call_expression.arguments.len(), 2);
        let first_argument = &third_call_expression.arguments[0];
        let first_argument_identifier = match first_argument {
            Value::Identifier(identifier) => identifier,
            _ => panic!("expected identifier"),
        };
        assert_eq!(first_argument_identifier.name, "myVar2");

        let fourth_call_expression = match &body.body[3] {
            Value::CallExpression(call_expression) => call_expression,
            _ => panic!("expected call expression"),
        };
        assert_eq!(fourth_call_expression.callee.name, "close");
        assert_eq!(fourth_call_expression.arguments.len(), 1);
    }

    #[test]
    fn test_make_body() {
        let tokens = lexer("const myVar = 5");
        let body = make_body(
            &tokens,
            0,
            vec![],
            NoneCodeMeta {
                none_code_nodes: HashMap::new(),
                start: None,
            },
        )
        .unwrap();
        assert_eq!(body.body.len(), 1);
    }

    #[test]
    fn test_abstract_syntax_tree() {
        let code = "5 +6";
        let result = abstract_syntax_tree(&lexer(code)).unwrap();
        let expected_result = Program {
            start: 0,
            end: 4,
            body: vec![BodyItem::ExpressionStatement(ExpressionStatement {
                start: 0,
                end: 4,
                expression: Value::BinaryExpression(Box::new(BinaryExpression {
                    start: 0,
                    end: 4,
                    left: BinaryPart::Literal(Box::new(Literal {
                        start: 0,
                        end: 1,
                        value: serde_json::Value::Number(serde_json::Number::from(5)),
                        raw: "5".to_string(),
                    })),
                    operator: "+".to_string(),
                    right: BinaryPart::Literal(Box::new(Literal {
                        start: 3,
                        end: 4,
                        value: serde_json::Value::Number(serde_json::Number::from(6)),
                        raw: "6".to_string(),
                    })),
                })),
            })],
            non_code_meta: NoneCodeMeta {
                none_code_nodes: HashMap::from_iter(vec![(
                    0,
                    NoneCodeNode {
                        start: 1,
                        end: 2,
                        value: " ".to_string(),
                    },
                )]),
                start: None,
            },
        };

        assert_eq!(result, expected_result);
    }
}
