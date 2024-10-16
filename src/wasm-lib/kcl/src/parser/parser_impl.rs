use std::{collections::HashMap, str::FromStr};

use winnow::{
    combinator::{alt, delimited, opt, peek, preceded, repeat, separated, terminated},
    dispatch,
    error::{ErrMode, StrContext, StrContextValue},
    prelude::*,
    token::{any, one_of, take_till},
};

use crate::{
    ast::types::{
        ArrayExpression, ArrayRangeExpression, BinaryExpression, BinaryOperator, BinaryPart, BodyItem, CallExpression,
        CommentStyle, ElseIf, Expr, ExpressionStatement, FnArgPrimitive, FnArgType, FunctionExpression, Identifier,
        IfExpression, Literal, LiteralIdentifier, LiteralValue, MemberExpression, MemberObject, NonCodeMeta,
        NonCodeNode, NonCodeValue, ObjectExpression, ObjectProperty, Parameter, PipeExpression, PipeSubstitution,
        Program, ReturnStatement, TagDeclarator, UnaryExpression, UnaryOperator, ValueMeta, VariableDeclaration,
        VariableDeclarator, VariableKind,
    },
    errors::{KclError, KclErrorDetails},
    executor::SourceRange,
    parser::{
        math::BinaryExpressionToken, parser_impl::error::ContextError, PIPE_OPERATOR, PIPE_SUBSTITUTION_OPERATOR,
    },
    token::{Token, TokenType},
};

mod error;

type PResult<O, E = error::ContextError> = winnow::prelude::PResult<O, E>;

type TokenSlice<'slice, 'input> = &'slice mut &'input [Token];

pub fn run_parser(i: TokenSlice) -> Result<Program, KclError> {
    program.parse(i).map_err(KclError::from)
}

fn expected(what: &'static str) -> StrContext {
    StrContext::Expected(StrContextValue::Description(what))
}

fn program(i: TokenSlice) -> PResult<Program> {
    let shebang = opt(shebang).parse_next(i)?;
    let mut out = function_body.parse_next(i)?;

    // Add the shebang to the non-code meta.
    if let Some(shebang) = shebang {
        out.non_code_meta.start.insert(0, shebang);
    }
    // Match original parser behaviour, for now.
    // Once this is merged and stable, consider changing this as I think it's more accurate
    // without the -1.
    out.end -= 1;
    Ok(out)
}

fn pipe_surrounded_by_whitespace(i: TokenSlice) -> PResult<()> {
    (
        repeat(0.., whitespace).map(|_: Vec<_>| ()),
        pipe_operator,
        repeat(0.., whitespace).map(|_: Vec<_>| ()),
    )
        .parse_next(i)?;
    Ok(())
}

/// Note this is O(n).
fn count_in(target: char, s: &str) -> usize {
    s.chars().filter(|&c| c == target).count()
}

/// Matches all four cases of NonCodeValue
fn non_code_node(i: TokenSlice) -> PResult<NonCodeNode> {
    /// Matches one case of NonCodeValue
    /// See docstring on [NonCodeValue::NewLineBlockComment] for why that case is different to the others.
    fn non_code_node_leading_whitespace(i: TokenSlice) -> PResult<NonCodeNode> {
        let leading_whitespace = one_of(TokenType::Whitespace)
            .context(expected("whitespace, with a newline"))
            .parse_next(i)?;
        let has_empty_line = count_in('\n', &leading_whitespace.value) >= 2;
        non_code_node_no_leading_whitespace
            .verify_map(|node: NonCodeNode| match node.value {
                NonCodeValue::BlockComment { value, style } => Some(NonCodeNode {
                    start: leading_whitespace.start,
                    end: node.end + 1,
                    value: if has_empty_line {
                        NonCodeValue::NewLineBlockComment { value, style }
                    } else {
                        NonCodeValue::BlockComment { value, style }
                    },
                    digest: None,
                }),
                _ => None,
            })
            .context(expected("a comment or whitespace"))
            .parse_next(i)
    }

    alt((non_code_node_leading_whitespace, non_code_node_no_leading_whitespace)).parse_next(i)
}

// Matches remaining three cases of NonCodeValue
fn non_code_node_no_leading_whitespace(i: TokenSlice) -> PResult<NonCodeNode> {
    any.verify_map(|token: Token| {
        if token.is_code_token() {
            None
        } else {
            let value = match token.token_type {
                TokenType::Whitespace if token.value.contains("\n\n") => NonCodeValue::NewLine,
                TokenType::LineComment => NonCodeValue::BlockComment {
                    value: token.value.trim_start_matches("//").trim().to_owned(),
                    style: CommentStyle::Line,
                },
                TokenType::BlockComment => NonCodeValue::BlockComment {
                    style: CommentStyle::Block,
                    value: token
                        .value
                        .trim_start_matches("/*")
                        .trim_end_matches("*/")
                        .trim()
                        .to_owned(),
                },
                _ => return None,
            };
            Some(NonCodeNode {
                start: token.start,
                end: token.end,
                value,
                digest: None,
            })
        }
    })
    .context(expected("Non-code token (comments or whitespace)"))
    .parse_next(i)
}

fn pipe_expression(i: TokenSlice) -> PResult<PipeExpression> {
    let mut non_code_meta = NonCodeMeta::default();
    let (head, noncode): (_, Vec<_>) = terminated(
        (
            expression_but_not_pipe,
            repeat(0.., preceded(whitespace, non_code_node)),
        ),
        peek(pipe_surrounded_by_whitespace),
    )
    .context(expected("an expression, followed by the |> (pipe) operator"))
    .parse_next(i)?;
    for nc in noncode {
        non_code_meta.insert(0, nc);
    }
    let mut values = vec![head];
    let value_surrounded_by_comments = (
        repeat(0.., preceded(opt(whitespace), non_code_node)), // Before the expression.
        preceded(opt(whitespace), fn_call),                    // The expression.
        repeat(0.., noncode_just_after_code),                  // After the expression.
    );
    let tail: Vec<(Vec<_>, _, Vec<_>)> = repeat(
        1..,
        preceded(pipe_surrounded_by_whitespace, value_surrounded_by_comments),
    )
    .context(expected(
        "a sequence of at least one |> (pipe) operator, followed by an expression",
    ))
    .parse_next(i)?;

    // All child parsers have been run.
    // First, ensure they all have a % in their args.
    let calls_without_substitution = tail.iter().find_map(|(_nc, call_expr, _nc2)| {
        if !call_expr.has_substitution_arg() {
            Some(call_expr.as_source_ranges())
        } else {
            None
        }
    });
    if let Some(source_ranges) = calls_without_substitution {
        let err = KclError::Syntax(KclErrorDetails {
            source_ranges,
            message: "All expressions in a pipeline must use the % (substitution operator)".to_owned(),
        });
        return Err(ErrMode::Cut(err.into()));
    }
    // Time to structure the return value.
    let mut code_count = 0;
    let mut max_noncode_end = 0;
    for (noncode_before, code, noncode_after) in tail {
        for nc in noncode_before {
            max_noncode_end = nc.end.max(max_noncode_end);
            non_code_meta.insert(code_count, nc);
        }
        values.push(Expr::CallExpression(Box::new(code)));
        code_count += 1;
        for nc in noncode_after {
            max_noncode_end = nc.end.max(max_noncode_end);
            non_code_meta.insert(code_count, nc);
        }
    }
    Ok(PipeExpression {
        start: values.first().unwrap().start(),
        end: values.last().unwrap().end().max(max_noncode_end),
        body: values,
        non_code_meta,
        digest: None,
    })
}

fn bool_value(i: TokenSlice) -> PResult<Literal> {
    let (value, token) = any
        .try_map(|token: Token| match token.token_type {
            TokenType::Keyword if token.value == "true" => Ok((true, token)),
            TokenType::Keyword if token.value == "false" => Ok((false, token)),
            _ => Err(KclError::Syntax(KclErrorDetails {
                source_ranges: token.as_source_ranges(),
                message: "invalid boolean literal".to_owned(),
            })),
        })
        .context(expected("a boolean literal (either true or false)"))
        .parse_next(i)?;
    Ok(Literal {
        start: token.start,
        end: token.end,
        value: LiteralValue::Bool(value),
        raw: value.to_string(),
        digest: None,
    })
}

pub fn literal(i: TokenSlice) -> PResult<Literal> {
    alt((string_literal, unsigned_number_literal))
        .context(expected("a KCL literal, like 'myPart' or 3"))
        .parse_next(i)
}

/// Parse a KCL string literal
pub fn string_literal(i: TokenSlice) -> PResult<Literal> {
    let (value, token) = any
        .try_map(|token: Token| match token.token_type {
            TokenType::String => {
                let s = token.value[1..token.value.len() - 1].to_string();
                Ok((LiteralValue::from(s), token))
            }
            _ => Err(KclError::Syntax(KclErrorDetails {
                source_ranges: token.as_source_ranges(),
                message: "invalid string literal".to_owned(),
            })),
        })
        .context(expected("string literal (like \"myPart\""))
        .parse_next(i)?;
    Ok(Literal {
        start: token.start,
        end: token.end,
        value,
        raw: token.value.clone(),
        digest: None,
    })
}

/// Parse a KCL literal number, with no - sign.
pub(crate) fn unsigned_number_literal(i: TokenSlice) -> PResult<Literal> {
    let (value, token) = any
        .try_map(|token: Token| match token.token_type {
            TokenType::Number => {
                if let Ok(x) = token.value.parse::<u64>() {
                    return Ok((LiteralValue::IInteger(x as i64), token));
                }
                let x: f64 = token.value.parse().map_err(|_| {
                    KclError::Syntax(KclErrorDetails {
                        source_ranges: token.as_source_ranges(),
                        message: format!("Invalid float: {}", token.value),
                    })
                })?;

                Ok((LiteralValue::Fractional(x), token))
            }
            _ => Err(KclError::Syntax(KclErrorDetails {
                source_ranges: token.as_source_ranges(),
                message: "invalid literal".to_owned(),
            })),
        })
        .context(expected("an unsigned number literal (e.g. 3 or 12.5)"))
        .parse_next(i)?;
    Ok(Literal {
        start: token.start,
        end: token.end,
        value,
        raw: token.value.clone(),
        digest: None,
    })
}

/// Parse a KCL operator that takes a left- and right-hand side argument.
fn binary_operator(i: TokenSlice) -> PResult<BinaryOperator> {
    any.try_map(|token: Token| {
        if !matches!(token.token_type, TokenType::Operator) {
            return Err(KclError::Syntax(KclErrorDetails {
                source_ranges: token.as_source_ranges(),
                message: format!("unexpected token, should be an operator but was {}", token.token_type),
            }));
        }
        let op = match token.value.as_str() {
            "+" => BinaryOperator::Add,
            "-" => BinaryOperator::Sub,
            "/" => BinaryOperator::Div,
            "*" => BinaryOperator::Mul,
            "%" => BinaryOperator::Mod,
            "^" => BinaryOperator::Pow,
            "==" => BinaryOperator::Eq,
            "!=" => BinaryOperator::Neq,
            ">" => BinaryOperator::Gt,
            ">=" => BinaryOperator::Gte,
            "<" => BinaryOperator::Lt,
            "<=" => BinaryOperator::Lte,
            _ => {
                return Err(KclError::Syntax(KclErrorDetails {
                    source_ranges: token.as_source_ranges(),
                    message: format!("{} is not a binary operator", token.value.as_str()),
                }))
            }
        };
        Ok(op)
    })
    .context(expected("a binary operator (like + or *)"))
    .parse_next(i)
}

/// Parse a KCL operand that can be used with an operator.
fn operand(i: TokenSlice) -> PResult<BinaryPart> {
    const TODO_783: &str = "found a value, but this kind of value cannot be used as the operand to an operator yet (see https://github.com/KittyCAD/modeling-app/issues/783)";
    let op = possible_operands
        .try_map(|part| {
            let source_ranges = vec![SourceRange([part.start(), part.end()])];
            let expr = match part {
                // TODO: these should be valid operands eventually,
                // users should be able to run "let x = f() + g()"
                // see https://github.com/KittyCAD/modeling-app/issues/783
                Expr::FunctionExpression(_)
                | Expr::PipeExpression(_)
                | Expr::PipeSubstitution(_)
                | Expr::ArrayExpression(_)
                | Expr::ArrayRangeExpression(_)
                | Expr::ObjectExpression(_) => {
                    return Err(KclError::Syntax(KclErrorDetails {
                        source_ranges,
                        message: TODO_783.to_owned(),
                    }))
                }
                Expr::None(_) => {
                    return Err(KclError::Semantic(KclErrorDetails {
                        source_ranges,
                        // TODO: Better error message here.
                        // Once we have ways to use None values (e.g. by replacing with a default value)
                        // we should suggest one of them here.
                        message: "cannot use a KCL None value as an operand".to_owned(),
                    }));
                }
                Expr::TagDeclarator(_) => {
                    return Err(KclError::Semantic(KclErrorDetails {
                        source_ranges,
                        // TODO: Better error message here.
                        // Once we have ways to use None values (e.g. by replacing with a default value)
                        // we should suggest one of them here.
                        message: "cannot use a KCL tag declaration as an operand".to_owned(),
                    }));
                }
                Expr::UnaryExpression(x) => BinaryPart::UnaryExpression(x),
                Expr::Literal(x) => BinaryPart::Literal(x),
                Expr::Identifier(x) => BinaryPart::Identifier(x),
                Expr::BinaryExpression(x) => BinaryPart::BinaryExpression(x),
                Expr::CallExpression(x) => BinaryPart::CallExpression(x),
                Expr::MemberExpression(x) => BinaryPart::MemberExpression(x),
                Expr::IfExpression(x) => BinaryPart::IfExpression(x),
            };
            Ok(expr)
        })
        .context(expected("an operand (a value which can be used with an operator)"))
        .parse_next(i)?;
    Ok(op)
}

impl TokenType {
    fn parse_from(self, i: TokenSlice) -> PResult<Token> {
        any.try_map(|token: Token| {
            if token.token_type == self {
                Ok(token)
            } else {
                Err(KclError::Syntax(KclErrorDetails {
                    source_ranges: token.as_source_ranges(),
                    message: format!(
                        "expected {self} but found {} which is a {}",
                        token.value.as_str(),
                        token.token_type
                    ),
                }))
            }
        })
        .parse_next(i)
    }
}

/// Parse some whitespace (i.e. at least one whitespace token)
fn whitespace(i: TokenSlice) -> PResult<Vec<Token>> {
    repeat(
        1..,
        any.try_map(|token: Token| {
            if token.token_type == TokenType::Whitespace {
                Ok(token)
            } else {
                Err(KclError::Syntax(KclErrorDetails {
                    source_ranges: token.as_source_ranges(),
                    message: format!(
                        "expected whitespace, found '{}' which is {}",
                        token.value.as_str(),
                        token.token_type
                    ),
                }))
            }
        }),
    )
    .context(expected("some whitespace (e.g. spaces, tabs, new lines)"))
    .parse_next(i)
}

/// A shebang is a line at the start of a file that starts with `#!`.
/// If the shebang is present it takes up the whole line.
fn shebang(i: TokenSlice) -> PResult<NonCodeNode> {
    // Parse the hash and the bang.
    hash.parse_next(i)?;
    bang.parse_next(i)?;
    // Get the rest of the line.
    // Parse everything until the next newline.
    let tokens = take_till(0.., |token: Token| token.value.contains('\n')).parse_next(i)?;
    let value = tokens.iter().map(|t| t.value.as_str()).collect::<String>();

    if tokens.is_empty() {
        return Err(ErrMode::Cut(
            KclError::Syntax(KclErrorDetails {
                source_ranges: vec![],
                message: "expected a shebang value after #!".to_owned(),
            })
            .into(),
        ));
    }

    // Strip all the whitespace after the shebang.
    opt(whitespace).parse_next(i)?;

    Ok(NonCodeNode {
        start: 0,
        end: tokens.last().unwrap().end,
        value: NonCodeValue::Shebang {
            value: format!("#!{}", value),
        },
        digest: None,
    })
}

/// Parse the = operator.
fn equals(i: TokenSlice) -> PResult<Token> {
    one_of((TokenType::Operator, "="))
        .context(expected("the equals operator, ="))
        .parse_next(i)
}

#[allow(clippy::large_enum_variant)]
pub enum NonCodeOr<T> {
    NonCode(NonCodeNode),
    Code(T),
}

/// Parse a KCL array of elements.
fn array(i: TokenSlice) -> PResult<Expr> {
    alt((
        array_empty.map(Box::new).map(Expr::ArrayExpression),
        array_elem_by_elem.map(Box::new).map(Expr::ArrayExpression),
        array_end_start.map(Box::new).map(Expr::ArrayRangeExpression),
    ))
    .parse_next(i)
}

/// Match an empty array.
fn array_empty(i: TokenSlice) -> PResult<ArrayExpression> {
    let start = open_bracket(i)?.start;
    ignore_whitespace(i);
    let end = close_bracket(i)?.end;
    Ok(ArrayExpression {
        start,
        end,
        elements: Default::default(),
        non_code_meta: Default::default(),
        digest: None,
    })
}

/// Match something that separates elements of an array.
fn array_separator(i: TokenSlice) -> PResult<()> {
    alt((
        // Normally you need a comma.
        comma_sep,
        // But, if the array is ending, no need for a comma.
        peek(preceded(opt(whitespace), close_bracket)).void(),
    ))
    .parse_next(i)
}

pub(crate) fn array_elem_by_elem(i: TokenSlice) -> PResult<ArrayExpression> {
    let start = open_bracket(i)?.start;
    ignore_whitespace(i);
    let elements: Vec<_> = repeat(
        0..,
        alt((
            terminated(expression.map(NonCodeOr::Code), array_separator),
            terminated(non_code_node.map(NonCodeOr::NonCode), whitespace),
        )),
    )
    .context(expected("array contents, a list of elements (like [1, 2, 3])"))
    .parse_next(i)?;
    ignore_whitespace(i);
    let end = close_bracket(i)?.end;

    // Sort the array's elements (i.e. expression nodes) from the noncode nodes.
    let (elements, non_code_nodes): (Vec<_>, HashMap<usize, _>) = elements.into_iter().enumerate().fold(
        (Vec::new(), HashMap::new()),
        |(mut elements, mut non_code_nodes), (i, e)| {
            match e {
                NonCodeOr::NonCode(x) => {
                    non_code_nodes.insert(i, vec![x]);
                }
                NonCodeOr::Code(x) => {
                    elements.push(x);
                }
            }
            (elements, non_code_nodes)
        },
    );
    let non_code_meta = NonCodeMeta {
        non_code_nodes,
        start: Vec::new(),
        digest: None,
    };
    Ok(ArrayExpression {
        start,
        end,
        elements,
        non_code_meta,
        digest: None,
    })
}

fn array_end_start(i: TokenSlice) -> PResult<ArrayRangeExpression> {
    let start = open_bracket(i)?.start;
    ignore_whitespace(i);
    let start_element = Box::new(expression.parse_next(i)?);
    ignore_whitespace(i);
    double_period.parse_next(i)?;
    ignore_whitespace(i);
    let end_element = Box::new(expression.parse_next(i)?);
    ignore_whitespace(i);
    let end = close_bracket(i)?.end;
    Ok(ArrayRangeExpression {
        start,
        end,
        start_element,
        end_element,
        end_inclusive: true,
        digest: None,
    })
}

fn object_property(i: TokenSlice) -> PResult<ObjectProperty> {
    let key = identifier.context(expected("the property's key (the name or identifier of the property), e.g. in 'height: 4', 'height' is the property key")).parse_next(i)?;
    ignore_whitespace(i);
    colon
        .context(expected(
            "a colon, which separates the property's key from the value you're setting it to, e.g. 'height: 4'",
        ))
        .parse_next(i)?;
    ignore_whitespace(i);
    let expr = expression
        .context(expected(
            "the value which you're setting the property to, e.g. in 'height: 4', the value is 4",
        ))
        .parse_next(i)?;
    Ok(ObjectProperty {
        start: key.start,
        end: expr.end(),
        key,
        value: expr,
        digest: None,
    })
}

/// Match something that separates properties of an object.
fn property_separator(i: TokenSlice) -> PResult<()> {
    alt((
        // Normally you need a comma.
        comma_sep,
        // But, if the array is ending, no need for a comma.
        peek(preceded(opt(whitespace), close_brace)).void(),
    ))
    .parse_next(i)
}

/// Parse a KCL object value.
pub(crate) fn object(i: TokenSlice) -> PResult<ObjectExpression> {
    let start = open_brace(i)?.start;
    ignore_whitespace(i);
    let properties: Vec<_> = repeat(
        0..,
        alt((
            terminated(non_code_node.map(NonCodeOr::NonCode), whitespace),
            terminated(object_property, property_separator).map(NonCodeOr::Code),
        )),
    )
    .context(expected(
        "a comma-separated list of key-value pairs, e.g. 'height: 4, width: 3'",
    ))
    .parse_next(i)?;

    // Sort the object's properties from the noncode nodes.
    let (properties, non_code_nodes): (Vec<_>, HashMap<usize, _>) = properties.into_iter().enumerate().fold(
        (Vec::new(), HashMap::new()),
        |(mut properties, mut non_code_nodes), (i, e)| {
            match e {
                NonCodeOr::NonCode(x) => {
                    non_code_nodes.insert(i, vec![x]);
                }
                NonCodeOr::Code(x) => {
                    properties.push(x);
                }
            }
            (properties, non_code_nodes)
        },
    );
    ignore_trailing_comma(i);
    ignore_whitespace(i);
    let end = close_brace(i)?.end;
    let non_code_meta = NonCodeMeta {
        non_code_nodes,
        ..Default::default()
    };
    Ok(ObjectExpression {
        start,
        end,
        properties,
        non_code_meta,
        digest: None,
    })
}

/// Parse the % symbol, used to substitute a curried argument from a |> (pipe).
fn pipe_sub(i: TokenSlice) -> PResult<PipeSubstitution> {
    any.try_map(|token: Token| {
        if matches!(token.token_type, TokenType::Operator) && token.value == PIPE_SUBSTITUTION_OPERATOR {
            Ok(PipeSubstitution {
                start: token.start,
                end: token.end,
                digest: None,
            })
        } else {
            Err(KclError::Syntax(KclErrorDetails {
                source_ranges: token.as_source_ranges(),
                message: format!(
                    "expected a pipe substitution symbol (%) but found {}",
                    token.value.as_str()
                ),
            }))
        }
    })
    .context(expected("the substitution symbol, %"))
    .parse_next(i)
}

fn else_if(i: TokenSlice) -> PResult<ElseIf> {
    let start = any
        .try_map(|token: Token| {
            if matches!(token.token_type, TokenType::Keyword) && token.value == "else" {
                Ok(token.start)
            } else {
                Err(KclError::Syntax(KclErrorDetails {
                    source_ranges: token.as_source_ranges(),
                    message: format!("{} is not 'else'", token.value.as_str()),
                }))
            }
        })
        .context(expected("the 'else' keyword"))
        .parse_next(i)?;
    ignore_whitespace(i);
    let _if = any
        .try_map(|token: Token| {
            if matches!(token.token_type, TokenType::Keyword) && token.value == "if" {
                Ok(token.start)
            } else {
                Err(KclError::Syntax(KclErrorDetails {
                    source_ranges: token.as_source_ranges(),
                    message: format!("{} is not 'if'", token.value.as_str()),
                }))
            }
        })
        .context(expected("the 'if' keyword"))
        .parse_next(i)?;
    ignore_whitespace(i);
    let cond = expression(i)?;
    ignore_whitespace(i);
    let _ = open_brace(i)?;
    let then_val = program
        .verify(|block| block.ends_with_expr())
        .parse_next(i)
        .map(Box::new)?;
    ignore_whitespace(i);
    let end = close_brace(i)?.end;
    ignore_whitespace(i);
    Ok(ElseIf {
        start,
        end,
        cond,
        then_val,
        digest: Default::default(),
    })
}

fn if_expr(i: TokenSlice) -> PResult<IfExpression> {
    let start = any
        .try_map(|token: Token| {
            if matches!(token.token_type, TokenType::Keyword) && token.value == "if" {
                Ok(token.start)
            } else {
                Err(KclError::Syntax(KclErrorDetails {
                    source_ranges: token.as_source_ranges(),
                    message: format!("{} is not 'if'", token.value.as_str()),
                }))
            }
        })
        .context(expected("the 'if' keyword"))
        .parse_next(i)?;
    let _ = whitespace(i)?;
    let cond = expression(i).map(Box::new)?;
    let _ = whitespace(i)?;
    let _ = open_brace(i)?;
    ignore_whitespace(i);
    let then_val = program
        .verify(|block| block.ends_with_expr())
        .parse_next(i)
        .map_err(|e| e.cut())
        .map(Box::new)?;
    ignore_whitespace(i);
    let _ = close_brace(i)?;
    ignore_whitespace(i);
    let else_ifs = repeat(0.., else_if).parse_next(i)?;

    ignore_whitespace(i);
    let _ = any
        .try_map(|token: Token| {
            if matches!(token.token_type, TokenType::Keyword) && token.value == "else" {
                Ok(token.start)
            } else {
                Err(KclError::Syntax(KclErrorDetails {
                    source_ranges: token.as_source_ranges(),
                    message: format!("{} is not 'else'", token.value.as_str()),
                }))
            }
        })
        .context(expected("the 'else' keyword"))
        .parse_next(i)?;
    ignore_whitespace(i);
    let _ = open_brace(i)?;
    ignore_whitespace(i);

    let final_else = program
        .verify(|block| block.ends_with_expr())
        .parse_next(i)
        .map_err(|e| e.cut())
        .map(Box::new)?;
    ignore_whitespace(i);
    let end = close_brace(i)?.end;
    Ok(IfExpression {
        start,
        end,
        cond,
        then_val,
        else_ifs,
        final_else,
        digest: Default::default(),
    })
}

// Looks like
// (arg0, arg1) => {
//     const x = arg0 + arg1;
//     return x
// }
fn function_expression(i: TokenSlice) -> PResult<FunctionExpression> {
    let start = open_paren(i)?.start;
    let params = parameters(i)?;
    close_paren(i)?;
    ignore_whitespace(i);
    big_arrow(i)?;
    ignore_whitespace(i);
    // Optional type arguments.
    let return_type = opt(argument_type).parse_next(i)?;
    ignore_whitespace(i);
    open_brace(i)?;
    let body = function_body(i)?;
    let end = close_brace(i)?.end;
    Ok(FunctionExpression {
        start,
        end,
        params,
        body,
        return_type,
        digest: None,
    })
}

/// E.g. `person.name`
fn member_expression_dot(i: TokenSlice) -> PResult<(LiteralIdentifier, usize, bool)> {
    period.parse_next(i)?;
    let property = alt((
        sketch_keyword.map(Box::new).map(LiteralIdentifier::Identifier),
        identifier.map(Box::new).map(LiteralIdentifier::Identifier),
    ))
    .parse_next(i)?;
    let end = property.end();
    Ok((property, end, false))
}

/// E.g. `people[0]` or `people[i]` or `people['adam']`
fn member_expression_subscript(i: TokenSlice) -> PResult<(LiteralIdentifier, usize, bool)> {
    let _ = open_bracket.parse_next(i)?;
    let property = alt((
        sketch_keyword.map(Box::new).map(LiteralIdentifier::Identifier),
        literal.map(Box::new).map(LiteralIdentifier::Literal),
        identifier.map(Box::new).map(LiteralIdentifier::Identifier),
    ))
    .parse_next(i)?;

    let end = close_bracket.parse_next(i)?.end;
    let computed = matches!(property, LiteralIdentifier::Identifier(_));
    Ok((property, end, computed))
}

/// Get a property of an object, or an index of an array, or a member of a collection.
/// Can be arbitrarily nested, e.g. `people[i]['adam'].age`.
fn member_expression(i: TokenSlice) -> PResult<MemberExpression> {
    // This is an identifier, followed by a sequence of members (aka properties)
    // First, the identifier.
    let id = identifier.context(expected("the identifier of the object whose property you're trying to access, e.g. in 'shape.size.width', 'shape' is the identifier")).parse_next(i)?;
    // Now a sequence of members.
    let member = alt((member_expression_dot, member_expression_subscript)).context(expected("a member/property, e.g. size.x and size['height'] and size[0] are all different ways to access a member/property of 'size'"));
    let mut members: Vec<_> = repeat(1.., member)
        .context(expected("a sequence of at least one members/properties"))
        .parse_next(i)?;

    // Process the first member.
    // It's safe to call remove(0), because the vec is created from repeat(1..),
    // which is guaranteed to have >=1 elements.
    let (property, end, computed) = members.remove(0);
    let start = id.start;
    let initial_member_expression = MemberExpression {
        start,
        end,
        object: MemberObject::Identifier(Box::new(id)),
        computed,
        property,
        digest: None,
    };

    // Each remaining member wraps the current member expression inside another member expression.
    Ok(members
        .into_iter()
        // Take the accumulated member expression from the previous iteration,
        // and use it as the `object` of a new, bigger member expression.
        .fold(initial_member_expression, |accumulated, (property, end, computed)| {
            MemberExpression {
                start,
                end,
                object: MemberObject::MemberExpression(Box::new(accumulated)),
                computed,
                property,
                digest: None,
            }
        }))
}

/// Find a noncode node which occurs just after a body item,
/// such that if the noncode item is a comment, it might be an inline comment.
fn noncode_just_after_code(i: TokenSlice) -> PResult<NonCodeNode> {
    let ws = opt(whitespace).parse_next(i)?;

    // What is the preceding whitespace like?
    let (has_newline, has_empty_line) = if let Some(ref ws) = ws {
        (
            ws.iter().any(|token| token.value.contains('\n')),
            ws.iter().any(|token| count_in('\n', &token.value) >= 2),
        )
    } else {
        (false, false)
    };

    // Look for a non-code node (e.g. comment)
    let nc = non_code_node_no_leading_whitespace
        .map(|nc| {
            if has_empty_line {
                // There's an empty line between the body item and the comment,
                // This means the comment is a NewLineBlockComment!
                let value = match nc.value {
                    NonCodeValue::Shebang { value } => NonCodeValue::Shebang { value },
                    // Change block comments to inline, as discussed above
                    NonCodeValue::BlockComment { value, style } => NonCodeValue::NewLineBlockComment { value, style },
                    // Other variants don't need to change.
                    x @ NonCodeValue::InlineComment { .. } => x,
                    x @ NonCodeValue::NewLineBlockComment { .. } => x,
                    x @ NonCodeValue::NewLine => x,
                };
                NonCodeNode {
                    value,
                    start: nc.start.saturating_sub(1),
                    ..nc
                }
            } else if has_newline {
                // Nothing has to change, a single newline does not need preserving.
                nc
            } else {
                // There's no newline between the body item and comment,
                // so if this is a comment, it must be inline with code.
                let value = match nc.value {
                    NonCodeValue::Shebang { value } => NonCodeValue::Shebang { value },
                    // Change block comments to inline, as discussed above
                    NonCodeValue::BlockComment { value, style } => NonCodeValue::InlineComment { value, style },
                    // Other variants don't need to change.
                    x @ NonCodeValue::InlineComment { .. } => x,
                    x @ NonCodeValue::NewLineBlockComment { .. } => x,
                    x @ NonCodeValue::NewLine => x,
                };
                NonCodeNode { value, ..nc }
            }
        })
        .map(|nc| NonCodeNode {
            start: nc.start.saturating_sub(1),
            ..nc
        })
        .parse_next(i)?;
    Ok(nc)
}

// the large_enum_variant lint below introduces a LOT of code complexity in a
// match!() that's super clean that isn't worth it for the marginal space
// savings. revisit if that's a lie.

#[derive(Debug)]
#[allow(clippy::large_enum_variant)]
enum WithinFunction {
    BodyItem((BodyItem, Option<NonCodeNode>)),
    NonCode(NonCodeNode),
}

fn body_items_within_function(i: TokenSlice) -> PResult<WithinFunction> {
    // Any of the body item variants, each of which can optionally be followed by a comment.
    // If there is a comment, it may be preceded by whitespace.
    let item = dispatch! {peek(any);
        token if token.declaration_keyword().is_some() =>
            (declaration.map(BodyItem::VariableDeclaration), opt(noncode_just_after_code)).map(WithinFunction::BodyItem),
        Token { ref value, .. } if value == "return" =>
            (return_stmt.map(BodyItem::ReturnStatement), opt(noncode_just_after_code)).map(WithinFunction::BodyItem),
        token if !token.is_code_token() => {
            non_code_node.map(WithinFunction::NonCode)
        },
        _ =>
            alt((
                (
                    declaration.map(BodyItem::VariableDeclaration),
                    opt(noncode_just_after_code)
                ).map(WithinFunction::BodyItem),
                (
                    expression_stmt.map(BodyItem::ExpressionStatement),
                    opt(noncode_just_after_code)
                ).map(WithinFunction::BodyItem),
            ))
    }
    .context(expected("a function body items (functions are made up of variable declarations, expressions, and return statements, each of those is a possible body item"))
    .parse_next(i)?;
    Ok(item)
}

/// Parse the body of a user-defined function.
pub fn function_body(i: TokenSlice) -> PResult<Program> {
    let leading_whitespace_start = alt((
        peek(non_code_node).map(|_| None),
        // Subtract 1 from `t.start` to match behaviour of the old parser.
        // Consider removing the -1 in the future because I think it's inaccurate, but for now,
        // I prefer to match the old parser exactly when I can.
        opt(whitespace).map(|tok| tok.and_then(|t| t.first().map(|t| t.start.saturating_sub(1)))),
    ))
    .parse_next(i)?;

    let mut things_within_body = Vec::new();
    // Parse the first item
    things_within_body.push(body_items_within_function.parse_next(i)?);

    // This loop is complicated! I'm sorry!
    // It's almost identical to the loop in `winnow::combinator::separated1`,
    // see <https://docs.rs/winnow/latest/winnow/combinator/fn.separated1.html>,
    // where the "main" parser is body_items_within_function and the `sep` (separator) parser is
    // ws_with_newline.
    //
    // Except for one thing.
    //
    // In this case, one of the body items being matched could be a whitespace with a newline,
    // and that could _also_ be the separator.
    //
    // So, if both the main parser and the `sep` parser within `separated1` try to match the same
    // token, the main parser will consume it and then the `sep` parser will fail.
    //
    // The solution is that this parser should check if the last matched body item was an empty line,
    // and if so, then ignore the separator parser for the current iteration.
    loop {
        let last_match_was_empty_line = matches!(
            things_within_body.last(),
            Some(WithinFunction::NonCode(NonCodeNode {
                value: NonCodeValue::NewLine,
                ..
            }))
        );

        use winnow::stream::Stream;

        let start = i.checkpoint();
        let len = i.eof_offset();

        let found_ws = ws_with_newline.parse_next(i);

        // The separator whitespace might be important:
        // if it has an empty line, it should be considered a noncode token, because the user
        // deliberately put an empty line there. We should track this and preserve it.
        if let Ok(ref ws_token) = found_ws {
            if ws_token.value.contains("\n\n") {
                things_within_body.push(WithinFunction::NonCode(NonCodeNode {
                    start: ws_token.start,
                    end: ws_token.end,
                    value: NonCodeValue::NewLine,
                    digest: None,
                }));
            }
        }

        match (found_ws, last_match_was_empty_line) {
            (Ok(_), _) | (_, true) => {
                // Infinite loop check: this loop must always consume tokens from the input.
                // That can either happen through the `sep` parser (i.e. ws_with_newline) or through
                // the main parser (body_items_within_function).
                // LHS of this checks fht
                if i.eof_offset() == len && !last_match_was_empty_line {
                    use winnow::error::ParserError;
                    return Err(ErrMode::assert(i, "sep parsers must always consume"));
                }

                match body_items_within_function.parse_next(i) {
                    Err(ErrMode::Backtrack(_)) => {
                        i.reset(&start);
                        break;
                    }
                    Err(e) => return Err(e),
                    Ok(o) => {
                        things_within_body.push(o);
                    }
                }
            }
            (Err(ErrMode::Backtrack(_)), _) => {
                i.reset(&start);
                break;
            }
            (Err(e), _) => return Err(e),
        }
    }

    let mut body = Vec::new();
    let mut non_code_meta = NonCodeMeta::default();
    let mut end = 0;
    let mut start = leading_whitespace_start;
    for thing_in_body in things_within_body {
        match thing_in_body {
            WithinFunction::BodyItem((b, maybe_noncode)) => {
                if start.is_none() {
                    start = Some(b.start());
                }
                end = b.end();
                body.push(b);
                if let Some(nc) = maybe_noncode {
                    end = nc.end;
                    non_code_meta.insert(body.len() - 1, nc);
                }
            }
            WithinFunction::NonCode(nc) => {
                if start.is_none() {
                    start = Some(nc.start);
                }
                end = nc.end;
                if body.is_empty() {
                    non_code_meta.start.push(nc);
                } else {
                    non_code_meta.insert(body.len() - 1, nc);
                }
            }
        }
    }
    let start = start.expect(
        "the `things_within_body` vec should have looped at least once, and each loop overwrites `start` if it is None",
    );
    // Safe to unwrap `body.first()` because `body` is `separated1` therefore guaranteed
    // to have len >= 1.
    let end_ws = opt(whitespace)
        .parse_next(i)?
        .and_then(|ws| ws.first().map(|tok| tok.end));
    if let Some(end_ws) = end_ws {
        end = end.max(end_ws);
    }
    end += 1;
    Ok(Program {
        start,
        end,
        body,
        non_code_meta,
        digest: None,
    })
}

/// Parse a return statement of a user-defined function, e.g. `return x`.
pub fn return_stmt(i: TokenSlice) -> PResult<ReturnStatement> {
    let start = any
        .try_map(|token: Token| {
            if matches!(token.token_type, TokenType::Keyword) && token.value == "return" {
                Ok(token.start)
            } else {
                Err(KclError::Syntax(KclErrorDetails {
                    source_ranges: token.as_source_ranges(),
                    message: format!("{} is not a return keyword", token.value.as_str()),
                }))
            }
        })
        .context(expected(
            "the 'return' keyword, which ends your function (and becomes this function's value when it's called)",
        ))
        .parse_next(i)?;
    require_whitespace(i)?;
    let argument = expression(i)?;
    Ok(ReturnStatement {
        start,
        end: argument.end(),
        argument,
        digest: None,
    })
}

/// Parse a KCL expression.
fn expression(i: TokenSlice) -> PResult<Expr> {
    alt((
        pipe_expression.map(Box::new).map(Expr::PipeExpression),
        expression_but_not_pipe,
    ))
    .context(expected("a KCL value"))
    .parse_next(i)
}

fn expression_but_not_pipe(i: TokenSlice) -> PResult<Expr> {
    alt((
        binary_expression.map(Box::new).map(Expr::BinaryExpression),
        unary_expression.map(Box::new).map(Expr::UnaryExpression),
        expr_allowed_in_pipe_expr,
    ))
    .context(expected("a KCL value"))
    .parse_next(i)
}

fn unnecessarily_bracketed(i: TokenSlice) -> PResult<Expr> {
    delimited(
        terminated(open_paren, opt(whitespace)),
        expression,
        preceded(opt(whitespace), close_paren),
    )
    .parse_next(i)
}

fn expr_allowed_in_pipe_expr(i: TokenSlice) -> PResult<Expr> {
    alt((
        member_expression.map(Box::new).map(Expr::MemberExpression),
        bool_value.map(Box::new).map(Expr::Literal),
        tag.map(Box::new).map(Expr::TagDeclarator),
        literal.map(Box::new).map(Expr::Literal),
        fn_call.map(Box::new).map(Expr::CallExpression),
        identifier.map(Box::new).map(Expr::Identifier),
        array,
        object.map(Box::new).map(Expr::ObjectExpression),
        pipe_sub.map(Box::new).map(Expr::PipeSubstitution),
        function_expression.map(Box::new).map(Expr::FunctionExpression),
        if_expr.map(Box::new).map(Expr::IfExpression),
        unnecessarily_bracketed,
    ))
    .context(expected("a KCL expression (but not a pipe expression)"))
    .parse_next(i)
}

fn possible_operands(i: TokenSlice) -> PResult<Expr> {
    alt((
        unary_expression.map(Box::new).map(Expr::UnaryExpression),
        bool_value.map(Box::new).map(Expr::Literal),
        member_expression.map(Box::new).map(Expr::MemberExpression),
        literal.map(Box::new).map(Expr::Literal),
        fn_call.map(Box::new).map(Expr::CallExpression),
        identifier.map(Box::new).map(Expr::Identifier),
        binary_expr_in_parens.map(Box::new).map(Expr::BinaryExpression),
        unnecessarily_bracketed,
    ))
    .context(expected(
        "a KCL value which can be used as an argument/operand to an operator",
    ))
    .parse_next(i)
}

fn declaration_keyword(i: TokenSlice) -> PResult<(VariableKind, Token)> {
    let res = any
        .verify_map(|token: Token| token.declaration_keyword().map(|kw| (kw, token)))
        .parse_next(i)?;
    Ok(res)
}

/// Parse a variable/constant declaration.
fn declaration(i: TokenSlice) -> PResult<VariableDeclaration> {
    let decl_token = opt(declaration_keyword).parse_next(i)?;
    if decl_token.is_some() {
        // If there was a declaration keyword like `fn`, then it must be followed by some spaces.
        // `fnx = ...` is not valid!
        require_whitespace(i)?;
    }

    let id = binding_name
        .context(expected(
            "an identifier, which becomes name you're binding the value to",
        ))
        .parse_next(i)?;
    let (kind, start, dec_end) = if let Some((kind, token)) = &decl_token {
        (*kind, token.start, token.end)
    } else {
        (VariableKind::Const, id.start(), id.end())
    };

    ignore_whitespace(i);
    equals(i)?;
    // After this point, the parser is DEFINITELY parsing a variable declaration, because
    // `fn`, `let`, `const` etc are all unambiguous. If you've parsed one of those tokens --
    // and we certainly have because `kind` was parsed above -- then the following tokens
    // MUST continue the variable declaration, otherwise the program is invalid.
    //
    // This means, from here until this function returns, any errors should be ErrMode::Cut,
    // not ErrMode::Backtrack. Because the parser is definitely parsing a variable declaration.
    // If there's an error, there's no point backtracking -- instead the parser should fail.
    ignore_whitespace(i);

    let val = if kind == VariableKind::Fn {
        function_expression
            .map(Box::new)
            .map(Expr::FunctionExpression)
            .context(expected("a KCL function expression, like () => { return 1 }"))
            .parse_next(i)
    } else {
        expression
            .try_map(|val| {
                // Function bodies can be used if and only if declaring a function.
                // Check the 'if' direction:
                if matches!(val, Expr::FunctionExpression(_)) {
                    return Err(KclError::Syntax(KclErrorDetails {
                        source_ranges: vec![SourceRange([start, dec_end])],
                        message: format!("Expected a `fn` variable kind, found: `{}`", kind),
                    }));
                }
                Ok(val)
            })
            .context(expected("a KCL value, which is being bound to a variable"))
            .parse_next(i)
    }
    .map_err(|e| e.cut())?;

    let end = val.end();
    Ok(VariableDeclaration {
        start,
        end,
        declarations: vec![VariableDeclarator {
            start: id.start,
            end,
            id,
            init: val,
            digest: None,
        }],
        kind,
        digest: None,
    })
}

impl TryFrom<Token> for Identifier {
    type Error = KclError;

    fn try_from(token: Token) -> Result<Self, Self::Error> {
        if token.token_type == TokenType::Word {
            Ok(Identifier {
                start: token.start,
                end: token.end,
                name: token.value,
                digest: None,
            })
        } else {
            Err(KclError::Syntax(KclErrorDetails {
                source_ranges: token.as_source_ranges(),
                message: format!(
                    "Cannot assign a variable to a reserved keyword: {}",
                    token.value.as_str()
                ),
            }))
        }
    }
}

/// Parse a KCL identifier (name of a constant/variable/function)
fn identifier(i: TokenSlice) -> PResult<Identifier> {
    any.try_map(Identifier::try_from)
        .context(expected("an identifier, e.g. 'width' or 'myPart'"))
        .parse_next(i)
}

fn sketch_keyword(i: TokenSlice) -> PResult<Identifier> {
    any.try_map(|token: Token| {
        if token.token_type == TokenType::Type && token.value == "sketch" {
            Ok(Identifier {
                start: token.start,
                end: token.end,
                name: token.value,
                digest: None,
            })
        } else {
            Err(KclError::Syntax(KclErrorDetails {
                source_ranges: token.as_source_ranges(),
                message: format!("Expected 'sketch' keyword, but found {}", token.value.as_str()),
            }))
        }
    })
    .context(expected("the 'sketch' keyword"))
    .parse_next(i)
}

impl TryFrom<Token> for TagDeclarator {
    type Error = KclError;

    fn try_from(token: Token) -> Result<Self, Self::Error> {
        if token.token_type == TokenType::Word {
            Ok(TagDeclarator {
                // We subtract 1 from the start because the tag starts with a `$`.
                start: token.start - 1,
                end: token.end,
                name: token.value,
                digest: None,
            })
        } else {
            Err(KclError::Syntax(KclErrorDetails {
                source_ranges: token.as_source_ranges(),
                message: format!("Cannot assign a tag to a reserved keyword: {}", token.value.as_str()),
            }))
        }
    }
}

impl TagDeclarator {
    fn into_valid_binding_name(self) -> Result<Self, KclError> {
        // Make sure they are not assigning a variable to a stdlib function.
        if crate::std::name_in_stdlib(&self.name) {
            return Err(KclError::Syntax(KclErrorDetails {
                source_ranges: vec![SourceRange([self.start, self.end])],
                message: format!("Cannot assign a tag to a reserved keyword: {}", self.name),
            }));
        }
        Ok(self)
    }
}

/// Parse a Kcl tag that starts with a `$`.
fn tag(i: TokenSlice) -> PResult<TagDeclarator> {
    dollar.parse_next(i)?;
    any.try_map(TagDeclarator::try_from)
        .context(expected("a tag, e.g. '$seg01' or '$line01'"))
        .parse_next(i)
}

/// Helper function. Matches any number of whitespace tokens and ignores them.
fn ignore_whitespace(i: TokenSlice) {
    let _: PResult<()> = repeat(0.., whitespace).parse_next(i);
}

// A helper function to ignore a trailing comma.
fn ignore_trailing_comma(i: TokenSlice) {
    let _ = opt(comma).parse_next(i);
}

/// Matches at least 1 whitespace.
fn require_whitespace(i: TokenSlice) -> PResult<()> {
    repeat(1.., whitespace).parse_next(i)
}

fn unary_expression(i: TokenSlice) -> PResult<UnaryExpression> {
    const EXPECTED: &str = "expected a unary operator (like '-', the negative-numeric operator),";
    let (operator, op_token) = any
        .try_map(|token: Token| match token.token_type {
            TokenType::Operator if token.value == "-" => Ok((UnaryOperator::Neg, token)),
            TokenType::Operator => Err(KclError::Syntax(KclErrorDetails {
                source_ranges: token.as_source_ranges(),
                message: format!("{EXPECTED} but found {} which is an operator, but not a unary one (unary operators apply to just a single operand, your operator applies to two or more operands)", token.value.as_str(),),
            })),
            TokenType::Bang => Ok((UnaryOperator::Not, token)),
            other => Err(KclError::Syntax(KclErrorDetails { source_ranges: token.as_source_ranges(), message: format!("{EXPECTED} but found {} which is {}", token.value.as_str(), other,) })),
        })
        .context(expected("a unary expression, e.g. -x or -3"))
        .parse_next(i)?;
    let argument = operand.parse_next(i)?;
    Ok(UnaryExpression {
        start: op_token.start,
        end: argument.end(),
        operator,
        argument,
        digest: None,
    })
}

/// Consume tokens that make up a binary expression, but don't actually return them.
/// Why not?
/// Because this is designed to be used with .take() within the `binary_expression` parser.
fn binary_expression_tokens(i: TokenSlice) -> PResult<Vec<BinaryExpressionToken>> {
    let first = operand.parse_next(i).map(BinaryExpressionToken::from)?;
    let remaining: Vec<_> = repeat(
        1..,
        (
            preceded(opt(whitespace), binary_operator).map(BinaryExpressionToken::from),
            preceded(opt(whitespace), operand).map(BinaryExpressionToken::from),
        ),
    )
    .context(expected(
        "one or more binary operators (like + or -) and operands for them, e.g. 1 + 2 - 3",
    ))
    .parse_next(i)?;
    let mut out = Vec::with_capacity(1 + 2 * remaining.len());
    out.push(first);
    out.extend(remaining.into_iter().flat_map(|(a, b)| [a, b]));
    Ok(out)
}

/// Parse an infix binary expression.
fn binary_expression(i: TokenSlice) -> PResult<BinaryExpression> {
    // Find the slice of tokens which makes up the binary expression
    let tokens = binary_expression_tokens.parse_next(i)?;

    // Pass the token slice into the specialized math parser, for things like
    // precedence and converting infix operations to an AST.
    let expr = super::math::parse(tokens).map_err(|e| ErrMode::Backtrack(e.into()))?;
    Ok(expr)
}

fn binary_expr_in_parens(i: TokenSlice) -> PResult<BinaryExpression> {
    let span_with_brackets = bracketed_section.take().parse_next(i)?;
    let n = span_with_brackets.len();
    let mut span_no_brackets = &span_with_brackets[1..n - 1];
    let expr = binary_expression.parse_next(&mut span_no_brackets)?;
    Ok(expr)
}

/// Match a starting bracket, then match to the corresponding end bracket.
/// Return the count of how many tokens are in that span
/// (not including the bracket tokens).
fn bracketed_section(i: TokenSlice) -> PResult<usize> {
    // Find the start of this bracketed expression.
    let _ = open_paren.parse_next(i)?;
    let mut opened_braces = 1usize;
    let mut tokens_examined = 0;
    while opened_braces > 0 {
        let tok = any.parse_next(i)?;
        tokens_examined += 1;
        if matches!(tok.token_type, TokenType::Brace) {
            if tok.value == "(" {
                opened_braces += 1;
            } else if tok.value == ")" {
                opened_braces -= 1;
            }
        }
    }
    Ok(tokens_examined)
}

/// Parse a KCL expression statement.
fn expression_stmt(i: TokenSlice) -> PResult<ExpressionStatement> {
    let val = expression
        .context(expected(
            "an expression (i.e. a value, or an algorithm for calculating one), e.g. 'x + y' or '3' or 'width * 2'",
        ))
        .parse_next(i)?;
    Ok(ExpressionStatement {
        start: val.start(),
        end: val.end(),
        expression: val,
        digest: None,
    })
}

/// Parse the given brace symbol.
fn some_brace(symbol: &'static str, i: TokenSlice) -> PResult<Token> {
    one_of((TokenType::Brace, symbol))
        .context(expected(symbol))
        .parse_next(i)
}

/// Parse a => operator.
fn big_arrow(i: TokenSlice) -> PResult<Token> {
    one_of((TokenType::Operator, "=>"))
        .context(expected("the => symbol, used for declaring functions"))
        .parse_next(i)
}
/// Parse a |> operator.
fn pipe_operator(i: TokenSlice) -> PResult<Token> {
    one_of((TokenType::Operator, PIPE_OPERATOR))
        .context(expected(
            "the |> operator, used for 'piping' one function's output into another function's input",
        ))
        .parse_next(i)
}

fn ws_with_newline(i: TokenSlice) -> PResult<Token> {
    one_of(TokenType::Whitespace)
        .verify(|token: &Token| token.value.contains('\n'))
        .context(expected("a newline, possibly with whitespace"))
        .parse_next(i)
}

/// (
fn open_paren(i: TokenSlice) -> PResult<Token> {
    some_brace("(", i)
}

/// )
fn close_paren(i: TokenSlice) -> PResult<Token> {
    some_brace(")", i)
}

/// [
fn open_bracket(i: TokenSlice) -> PResult<Token> {
    some_brace("[", i)
}

/// ]
fn close_bracket(i: TokenSlice) -> PResult<Token> {
    some_brace("]", i)
}

/// {
fn open_brace(i: TokenSlice) -> PResult<Token> {
    some_brace("{", i)
}

/// }
fn close_brace(i: TokenSlice) -> PResult<Token> {
    some_brace("}", i)
}

fn comma(i: TokenSlice) -> PResult<()> {
    TokenType::Comma.parse_from(i)?;
    Ok(())
}

fn hash(i: TokenSlice) -> PResult<()> {
    TokenType::Hash.parse_from(i)?;
    Ok(())
}

fn bang(i: TokenSlice) -> PResult<()> {
    TokenType::Bang.parse_from(i)?;
    Ok(())
}

fn dollar(i: TokenSlice) -> PResult<()> {
    TokenType::Dollar.parse_from(i)?;
    Ok(())
}

fn period(i: TokenSlice) -> PResult<()> {
    TokenType::Period.parse_from(i)?;
    Ok(())
}

fn double_period(i: TokenSlice) -> PResult<Token> {
    any.try_map(|token: Token| {
        if matches!(token.token_type, TokenType::DoublePeriod) {
            Ok(token)
        } else {
            Err(KclError::Syntax(KclErrorDetails {
                source_ranges: token.as_source_ranges(),
                message: format!(
                    "expected a '..' (double period) found {} which is {}",
                    token.value.as_str(),
                    token.token_type
                ),
            }))
        }
    })
    .context(expected("the .. operator, used for array ranges like [0..10]"))
    .parse_next(i)
}

fn colon(i: TokenSlice) -> PResult<()> {
    TokenType::Colon.parse_from(i)?;
    Ok(())
}

fn question_mark(i: TokenSlice) -> PResult<()> {
    TokenType::QuestionMark.parse_from(i)?;
    Ok(())
}

/// Parse a comma, optionally followed by some whitespace.
fn comma_sep(i: TokenSlice) -> PResult<()> {
    (opt(whitespace), comma, opt(whitespace))
        .context(expected("a comma, optionally followed by whitespace"))
        .parse_next(i)?;
    Ok(())
}

/// Arguments are passed into a function.
fn arguments(i: TokenSlice) -> PResult<Vec<Expr>> {
    separated(0.., expression, comma_sep)
        .context(expected("function arguments"))
        .parse_next(i)
}

/// A type of a function argument.
/// This can be:
/// - a primitive type, e.g. 'number' or 'string' or 'bool'
/// - an array type, e.g. 'number[]' or 'string[]' or 'bool[]'
/// - an object type, e.g. '{x: number, y: number}' or '{name: string, age: number}'
fn argument_type(i: TokenSlice) -> PResult<FnArgType> {
    let type_ = alt((
        // Object types
        (open_brace, parameters, close_brace).map(|(_, params, _)| Ok(FnArgType::Object { properties: params })),
        // Array types
        (one_of(TokenType::Type), open_bracket, close_bracket).map(|(token, _, _)| {
            FnArgPrimitive::from_str(&token.value)
                .map(FnArgType::Array)
                .map_err(|err| {
                    KclError::Syntax(KclErrorDetails {
                        source_ranges: token.as_source_ranges(),
                        message: format!("Invalid type: {}", err),
                    })
                })
        }),
        // Primitive types
        one_of(TokenType::Type).map(|token: Token| {
            FnArgPrimitive::from_str(&token.value)
                .map(FnArgType::Primitive)
                .map_err(|err| {
                    KclError::Syntax(KclErrorDetails {
                        source_ranges: token.as_source_ranges(),
                        message: format!("Invalid type: {}", err),
                    })
                })
        }),
    ))
    .parse_next(i)?
    .map_err(|e: KclError| ErrMode::Backtrack(ContextError::from(e)))?;
    Ok(type_)
}

fn parameter(i: TokenSlice) -> PResult<(Token, std::option::Option<FnArgType>, bool)> {
    let (arg_name, optional, _, _, _, type_) = (
        any.verify(|token: &Token| !matches!(token.token_type, TokenType::Brace) || token.value != ")"),
        opt(question_mark),
        opt(whitespace),
        opt(colon),
        opt(whitespace),
        opt(argument_type),
    )
        .parse_next(i)?;
    Ok((arg_name, type_, optional.is_some()))
}

/// Parameters are declared in a function signature, and used within a function.
fn parameters(i: TokenSlice) -> PResult<Vec<Parameter>> {
    // Get all tokens until the next ), because that ends the parameter list.
    let candidates: Vec<_> = separated(0.., parameter, comma_sep)
        .context(expected("function parameters"))
        .parse_next(i)?;

    // Make sure all those tokens are valid parameters.
    let params: Vec<Parameter> = candidates
        .into_iter()
        .map(|(arg_name, type_, optional)| {
            let identifier = Identifier::try_from(arg_name).and_then(Identifier::into_valid_binding_name)?;

            Ok(Parameter {
                identifier,
                type_,
                optional,
                digest: None,
            })
        })
        .collect::<Result<_, _>>()
        .map_err(|e: KclError| ErrMode::Backtrack(ContextError::from(e)))?;

    // Make sure optional parameters are last.
    if let Err(e) = optional_after_required(&params) {
        return Err(ErrMode::Cut(ContextError::from(e)));
    }
    Ok(params)
}

fn optional_after_required(params: &[Parameter]) -> Result<(), KclError> {
    let mut found_optional = false;
    for p in params {
        if p.optional {
            found_optional = true;
        }
        if !p.optional && found_optional {
            let e = KclError::Syntax(KclErrorDetails {
                source_ranges: vec![(&p.identifier).into()],
                message: "mandatory parameters must be declared before optional parameters".to_owned(),
            });
            return Err(e);
        }
    }
    Ok(())
}

impl Identifier {
    fn into_valid_binding_name(self) -> Result<Identifier, KclError> {
        // Make sure they are not assigning a variable to a stdlib function.
        if crate::std::name_in_stdlib(&self.name) {
            return Err(KclError::Syntax(KclErrorDetails {
                source_ranges: vec![SourceRange([self.start, self.end])],
                message: format!("Cannot assign a variable to a reserved keyword: {}", self.name),
            }));
        }
        Ok(self)
    }
}

/// Introduce a new name, which binds some value.
fn binding_name(i: TokenSlice) -> PResult<Identifier> {
    identifier
        .context(expected("an identifier, which will be the name of some value"))
        .try_map(Identifier::into_valid_binding_name)
        .context(expected("an identifier, which will be the name of some value"))
        .parse_next(i)
}

fn fn_call(i: TokenSlice) -> PResult<CallExpression> {
    let fn_name = identifier(i)?;
    opt(whitespace).parse_next(i)?;
    let _ = terminated(open_paren, opt(whitespace)).parse_next(i)?;
    let args = arguments(i)?;
    if let Some(std_fn) = crate::std::get_stdlib_fn(&fn_name.name) {
        // Type check the arguments.
        for (i, spec_arg) in std_fn.args(false).iter().enumerate() {
            let Some(arg) = &args.get(i) else {
                // The executor checks the number of arguments, so we don't need to check it here.
                continue;
            };
            match spec_arg.type_.as_ref() {
                "TagDeclarator" => match &arg {
                    Expr::Identifier(_) => {
                        // These are fine since we want someone to be able to map a variable to a tag declarator.
                    }
                    Expr::TagDeclarator(tag) => {
                        tag.clone()
                            .into_valid_binding_name()
                            .map_err(|e| ErrMode::Cut(ContextError::from(e)))?;
                    }
                    e => {
                        return Err(ErrMode::Cut(
                            KclError::Syntax(KclErrorDetails {
                                source_ranges: vec![SourceRange([arg.start(), arg.end()])],
                                message: format!("Expected a tag declarator like `$name`, found {:?}", e),
                            })
                            .into(),
                        ));
                    }
                },
                "TagIdentifier" => match &arg {
                    Expr::Identifier(_) => {}
                    Expr::MemberExpression(_) => {}
                    e => {
                        return Err(ErrMode::Cut(
                            KclError::Syntax(KclErrorDetails {
                                source_ranges: vec![SourceRange([arg.start(), arg.end()])],
                                message: format!("Expected a tag identifier like `tagName`, found {:?}", e),
                            })
                            .into(),
                        ));
                    }
                },
                _ => {}
            }
        }
    }
    let end = preceded(opt(whitespace), close_paren).parse_next(i)?.end;
    Ok(CallExpression {
        start: fn_name.start,
        end,
        callee: fn_name,
        arguments: args,
        optional: false,
        digest: None,
    })
}

#[cfg(test)]
mod tests {
    use pretty_assertions::assert_eq;

    use super::*;
    use crate::ast::types::{BodyItem, Expr, VariableKind};

    #[test]
    fn parse_args() {
        for (i, (test, expected_len)) in [("someVar", 1), ("5, 3", 2), (r#""a""#, 1)].into_iter().enumerate() {
            let tokens = crate::token::lexer(test).unwrap();
            let actual = match arguments.parse(&tokens) {
                Ok(x) => x,
                Err(e) => panic!("Failed test {i}, could not parse function arguments from \"{test}\": {e:?}"),
            };
            assert_eq!(actual.len(), expected_len, "failed test {i}");
        }
    }

    #[test]
    fn weird_program_unclosed_paren() {
        let tokens = crate::token::lexer("fn firstPrime=(").unwrap();
        let last = tokens.last().unwrap();
        let err: KclError = program.parse(&tokens).unwrap_err().into();
        assert_eq!(err.source_ranges(), last.as_source_ranges());
        // TODO: Better comment. This should explain the compiler expected ) because the user had started declaring the function's parameters.
        // Part of https://github.com/KittyCAD/modeling-app/issues/784
        assert_eq!(err.message(), "Unexpected end of file. The compiler expected )");
    }

    #[test]
    fn weird_program_just_a_pipe() {
        let tokens = crate::token::lexer("|").unwrap();
        let err: KclError = program.parse(&tokens).unwrap_err().into();
        assert_eq!(err.source_ranges(), vec![SourceRange([0, 1])]);
        assert_eq!(err.message(), "Unexpected token: |");
    }

    #[test]
    fn parse_binary_expressions() {
        for (i, test_program) in ["1 + 2 + 3"].into_iter().enumerate() {
            let tokens = crate::token::lexer(test_program).unwrap();
            let mut slice = tokens.as_slice();
            let _actual = match binary_expression.parse_next(&mut slice) {
                Ok(x) => x,
                Err(e) => panic!("Failed test {i}, could not parse binary expressions from \"{test_program}\": {e:?}"),
            };
        }
    }

    #[test]
    fn test_vardec_no_keyword() {
        let tokens = crate::token::lexer("x = 4").unwrap();
        let vardec = declaration(&mut tokens.as_slice()).unwrap();
        assert_eq!(vardec.kind, VariableKind::Const);
        let vardec = vardec.declarations.first().unwrap();
        assert_eq!(vardec.id.name, "x");
        let Expr::Literal(init_val) = &vardec.init else {
            panic!("weird init value")
        };
        assert_eq!(init_val.raw, "4");
    }

    #[test]
    fn test_negative_operands() {
        let tokens = crate::token::lexer("-leg2").unwrap();
        let _s = operand.parse_next(&mut tokens.as_slice()).unwrap();
    }

    #[test]
    fn test_comments_in_function1() {
        let test_program = r#"() => {
            // comment 0
            const a = 1
            // comment 1
            const b = 2
            // comment 2
            return 1
        }"#;
        let tokens = crate::token::lexer(test_program).unwrap();
        let mut slice = tokens.as_slice();
        let expr = function_expression.parse_next(&mut slice).unwrap();
        assert_eq!(expr.params, vec![]);
        let comment_start = expr.body.non_code_meta.start.first().unwrap();
        let comment0 = &expr.body.non_code_meta.non_code_nodes.get(&0).unwrap()[0];
        let comment1 = &expr.body.non_code_meta.non_code_nodes.get(&1).unwrap()[0];
        assert_eq!(comment_start.value(), "comment 0");
        assert_eq!(comment0.value(), "comment 1");
        assert_eq!(comment1.value(), "comment 2");
    }

    #[test]
    fn test_comments_in_function2() {
        let test_program = r#"() => {
  const yo = { a: { b: { c: '123' } } } /* block
comment */
}"#;
        let tokens = crate::token::lexer(test_program).unwrap();
        let mut slice = tokens.as_slice();
        let expr = function_expression.parse_next(&mut slice).unwrap();
        let comment0 = &expr.body.non_code_meta.non_code_nodes.get(&0).unwrap()[0];
        assert_eq!(comment0.value(), "block\ncomment");
    }

    #[test]
    fn test_comment_at_start_of_program() {
        let test_program = r#"
/* comment at start */

const mySk1 = startSketchAt([0, 0])"#;
        let tokens = crate::token::lexer(test_program).unwrap();
        let program = program.parse(&tokens).unwrap();
        let mut starting_comments = program.non_code_meta.start;
        assert_eq!(starting_comments.len(), 2);
        let start0 = starting_comments.remove(0);
        let start1 = starting_comments.remove(0);
        assert_eq!(
            start0.value,
            NonCodeValue::BlockComment {
                value: "comment at start".to_owned(),
                style: CommentStyle::Block
            }
        );
        assert_eq!(start1.value, NonCodeValue::NewLine);
    }

    #[test]
    fn test_comment_in_pipe() {
        let tokens = crate::token::lexer(r#"const x = y() |> /*hi*/ z(%)"#).unwrap();
        let mut body = program.parse(&tokens).unwrap().body;
        let BodyItem::VariableDeclaration(mut item) = body.remove(0) else {
            panic!("expected vardec");
        };
        let val = item.declarations.remove(0).init;
        let Expr::PipeExpression(pipe) = val else {
            panic!("expected pipe");
        };
        let mut noncode = pipe.non_code_meta;
        assert_eq!(noncode.non_code_nodes.len(), 1);
        let comment = noncode.non_code_nodes.remove(&0).unwrap().pop().unwrap();
        assert_eq!(
            comment.value,
            NonCodeValue::BlockComment {
                value: "hi".to_owned(),
                style: CommentStyle::Block
            }
        );
    }

    #[test]
    fn test_whitespace_in_function() {
        let test_program = r#"() => {
            return sg
            return sg
          }"#;
        let tokens = crate::token::lexer(test_program).unwrap();
        let mut slice = tokens.as_slice();
        let _expr = function_expression.parse_next(&mut slice).unwrap();
    }

    #[test]
    fn test_empty_lines_in_function() {
        let test_program = "() => {

                return 2
            }";
        let tokens = crate::token::lexer(test_program).unwrap();
        let mut slice = tokens.as_slice();
        let expr = function_expression.parse_next(&mut slice).unwrap();
        assert_eq!(
            expr,
            FunctionExpression {
                start: 0,
                end: 47,
                params: Default::default(),
                body: Program {
                    start: 7,
                    end: 47,
                    body: vec![BodyItem::ReturnStatement(ReturnStatement {
                        start: 25,
                        end: 33,
                        argument: Expr::Literal(Box::new(Literal {
                            start: 32,
                            end: 33,
                            value: 2u32.into(),
                            raw: "2".to_owned(),
                            digest: None,
                        })),
                        digest: None,
                    })],
                    non_code_meta: NonCodeMeta {
                        non_code_nodes: Default::default(),
                        start: vec![NonCodeNode {
                            start: 7,
                            end: 25,
                            value: NonCodeValue::NewLine,
                            digest: None
                        }],
                        digest: None,
                    },
                    digest: None,
                },
                return_type: None,
                digest: None,
            }
        );
    }

    #[test]
    fn inline_comment_pipe_expression() {
        let test_input = r#"a('XY')
        |> b(%)
        |> c(%) // inline-comment
        |> d(%)"#;

        let tokens = crate::token::lexer(test_input).unwrap();
        let mut slice = tokens.as_slice();
        let PipeExpression {
            body, non_code_meta, ..
        } = pipe_expression.parse_next(&mut slice).unwrap();
        assert_eq!(non_code_meta.non_code_nodes.len(), 1);
        assert_eq!(
            non_code_meta.non_code_nodes.get(&2).unwrap()[0].value,
            NonCodeValue::InlineComment {
                value: "inline-comment".to_owned(),
                style: CommentStyle::Line
            }
        );
        assert_eq!(body.len(), 4);
    }

    #[test]
    fn many_comments() {
        let test_program = r#"// this is a comment
  const yo = { a: { b: { c: '123' } } } /* block
  comment */

  const key = 'c'
  // this is also a comment
  return things
"#;

        let tokens = crate::token::lexer(test_program).unwrap();
        let Program { non_code_meta, .. } = function_body.parse(&tokens).unwrap();
        assert_eq!(
            vec![NonCodeNode {
                start: 0,
                end: 20,
                value: NonCodeValue::BlockComment {
                    value: "this is a comment".to_owned(),
                    style: CommentStyle::Line
                },
                digest: None,
            }],
            non_code_meta.start,
        );
        assert_eq!(
            Some(&vec![
                NonCodeNode {
                    start: 60,
                    end: 82,
                    value: NonCodeValue::InlineComment {
                        value: "block\n  comment".to_owned(),
                        style: CommentStyle::Block
                    },
                    digest: None,
                },
                NonCodeNode {
                    start: 82,
                    end: 86,
                    value: NonCodeValue::NewLine,
                    digest: None,
                },
            ]),
            non_code_meta.non_code_nodes.get(&0),
        );
        assert_eq!(
            Some(&vec![NonCodeNode {
                start: 103,
                end: 129,
                value: NonCodeValue::BlockComment {
                    value: "this is also a comment".to_owned(),
                    style: CommentStyle::Line
                },
                digest: None,
            }]),
            non_code_meta.non_code_nodes.get(&1),
        );
    }

    #[test]
    fn inline_block_comments() {
        let test_program = r#"const yo = 3 /* block
  comment */
  return 1"#;

        let tokens = crate::token::lexer(test_program).unwrap();
        let actual = program.parse(&tokens).unwrap();
        assert_eq!(actual.non_code_meta.non_code_nodes.len(), 1);
        assert_eq!(
            actual.non_code_meta.non_code_nodes.get(&0).unwrap()[0].value,
            NonCodeValue::InlineComment {
                value: "block\n  comment".to_owned(),
                style: CommentStyle::Block
            }
        );
    }

    #[test]
    fn test_bracketed_binary_expression() {
        let input = "(2 - 3)";
        let tokens = crate::token::lexer(input).unwrap();
        let actual = match binary_expr_in_parens.parse(&tokens) {
            Ok(x) => x,
            Err(e) => panic!("{e:?}"),
        };
        assert_eq!(actual.operator, BinaryOperator::Sub);
    }

    #[test]
    fn test_arg() {
        for input in [
            "( sigmaAllow * width )",
            "6 / ( sigmaAllow * width )",
            "sqrt(distance * p * FOS * 6 / ( sigmaAllow * width ))",
        ] {
            let tokens = crate::token::lexer(input).unwrap();
            let _actual = match expression.parse(&tokens) {
                Ok(x) => x,
                Err(e) => panic!("{e:?}"),
            };
        }
    }

    #[test]
    fn test_arithmetic() {
        let input = "1 * (2 - 3)";
        let tokens = crate::token::lexer(input).unwrap();
        // The RHS should be a binary expression.
        let actual = binary_expression.parse(&tokens).unwrap();
        assert_eq!(actual.operator, BinaryOperator::Mul);
        let BinaryPart::BinaryExpression(rhs) = actual.right else {
            panic!("Expected RHS to be another binary expression");
        };
        assert_eq!(rhs.operator, BinaryOperator::Sub);
        assert_eq!(
            rhs.right,
            BinaryPart::Literal(Box::new(Literal {
                start: 9,
                end: 10,
                value: 3u32.into(),
                raw: "3".to_owned(),
                digest: None,
            }))
        );
    }

    #[test]
    fn assign_brackets() {
        for (i, test_input) in [
            "const thickness_squared = (1 + 1)",
            "const thickness_squared = ( 1 + 1)",
            "const thickness_squared = (1 + 1 )",
            "const thickness_squared = ( 1 + 1 )",
        ]
        .into_iter()
        .enumerate()
        {
            let tokens = crate::token::lexer(test_input).unwrap();
            let mut actual = match declaration.parse(&tokens) {
                Err(e) => panic!("Could not parse test {i}: {e:#?}"),
                Ok(a) => a,
            };
            let Expr::BinaryExpression(_expr) = actual.declarations.remove(0).init else {
                panic!(
                    "Expected test {i} to be a binary expression but it wasn't, it was {:?}",
                    actual.declarations[0]
                );
            };
            // TODO: check both sides are 1... probably not necessary but should do.
        }
    }

    #[test]
    fn test_function_call() {
        for (i, test_input) in ["const x = f(1)", "const x = f( 1 )"].into_iter().enumerate() {
            let tokens = crate::token::lexer(test_input).unwrap();
            let _actual = match declaration.parse(&tokens) {
                Err(e) => panic!("Could not parse test {i}: {e:#?}"),
                Ok(a) => a,
            };
        }
    }

    #[test]
    fn test_nested_arithmetic() {
        let input = "1 * ((2 - 3) / 4)";
        let tokens = crate::token::lexer(input).unwrap();
        // The RHS should be a binary expression.
        let outer = binary_expression.parse(&tokens).unwrap();
        assert_eq!(outer.operator, BinaryOperator::Mul);
        let BinaryPart::BinaryExpression(middle) = outer.right else {
            panic!("Expected RHS to be another binary expression");
        };

        assert_eq!(middle.operator, BinaryOperator::Div);
        let BinaryPart::BinaryExpression(inner) = middle.left else {
            panic!("expected nested binary expression");
        };
        assert_eq!(inner.operator, BinaryOperator::Sub);
    }

    #[test]
    fn binary_expression_ignores_whitespace() {
        let tests = ["1 - 2", "1- 2", "1 -2", "1-2"];
        for test in tests {
            let tokens = crate::token::lexer(test).unwrap();
            let actual = binary_expression.parse(&tokens).unwrap();
            assert_eq!(actual.operator, BinaryOperator::Sub);
            let BinaryPart::Literal(left) = actual.left else {
                panic!("should be expression");
            };
            assert_eq!(left.value, 1u32.into());
            let BinaryPart::Literal(right) = actual.right else {
                panic!("should be expression");
            };
            assert_eq!(right.value, 2u32.into());
        }
    }

    #[test]
    fn some_pipe_expr() {
        let test_program = r#"x()
        |> y(%) /* this is
        a comment
        spanning a few lines */
        |> z(%)"#;
        let tokens = crate::token::lexer(test_program).unwrap();
        let actual = pipe_expression.parse(&tokens).unwrap();
        let n = actual.non_code_meta.non_code_nodes.len();
        assert_eq!(n, 1, "expected one comment in pipe expression but found {n}");
        let nc = &actual.non_code_meta.non_code_nodes.get(&1).unwrap()[0];
        assert!(nc.value().starts_with("this"));
        assert!(nc.value().ends_with("lines"));
    }

    #[test]
    fn comments_in_pipe_expr() {
        for (i, test_program) in [
            r#"y() |> /*hi*/ z(%)"#,
            "1 |>/*hi*/ f(%)",
            r#"y() |> /*hi*/ z(%)"#,
            "1 /*hi*/ |> f(%)",
            "1
        // Hi
        |> f(%)",
            "1
        /* Hi 
        there
        */
        |> f(%)",
        ]
        .into_iter()
        .enumerate()
        {
            let tokens = crate::token::lexer(test_program).unwrap();
            let actual = pipe_expression.parse(&tokens);
            assert!(actual.is_ok(), "could not parse test {i}, '{test_program}'");
            let actual = actual.unwrap();
            let n = actual.non_code_meta.non_code_nodes.len();
            assert_eq!(n, 1, "expected one comment in pipe expression but found {n}",)
        }
    }

    #[test]
    fn comments() {
        for (i, (test_program, expected)) in [
            (
                "//hi",
                NonCodeNode {
                    start: 0,
                    end: 4,
                    value: NonCodeValue::BlockComment {
                        value: "hi".to_owned(),
                        style: CommentStyle::Line,
                    },
                    digest: None,
                },
            ),
            (
                "/*hello*/",
                NonCodeNode {
                    start: 0,
                    end: 9,
                    value: NonCodeValue::BlockComment {
                        value: "hello".to_owned(),
                        style: CommentStyle::Block,
                    },
                    digest: None,
                },
            ),
            (
                "/* hello */",
                NonCodeNode {
                    start: 0,
                    end: 11,
                    value: NonCodeValue::BlockComment {
                        value: "hello".to_owned(),
                        style: CommentStyle::Block,
                    },
                    digest: None,
                },
            ),
            (
                "/* \nhello */",
                NonCodeNode {
                    start: 0,
                    end: 12,
                    value: NonCodeValue::BlockComment {
                        value: "hello".to_owned(),
                        style: CommentStyle::Block,
                    },
                    digest: None,
                },
            ),
            (
                "
                /* hello */",
                NonCodeNode {
                    start: 0,
                    end: 29,
                    value: NonCodeValue::BlockComment {
                        value: "hello".to_owned(),
                        style: CommentStyle::Block,
                    },
                    digest: None,
                },
            ),
            (
                // Empty line with trailing whitespace
                "
  
                /* hello */",
                NonCodeNode {
                    start: 0,
                    end: 32,
                    value: NonCodeValue::NewLineBlockComment {
                        value: "hello".to_owned(),
                        style: CommentStyle::Block,
                    },
                    digest: None,
                },
            ),
            (
                // Empty line, no trailing whitespace
                "

                /* hello */",
                NonCodeNode {
                    start: 0,
                    end: 30,
                    value: NonCodeValue::NewLineBlockComment {
                        value: "hello".to_owned(),
                        style: CommentStyle::Block,
                    },
                    digest: None,
                },
            ),
            (
                r#"/* block
                    comment */"#,
                NonCodeNode {
                    start: 0,
                    end: 39,
                    value: NonCodeValue::BlockComment {
                        value: "block\n                    comment".to_owned(),
                        style: CommentStyle::Block,
                    },
                    digest: None,
                },
            ),
        ]
        .into_iter()
        .enumerate()
        {
            let tokens = crate::token::lexer(test_program).unwrap();
            let actual = non_code_node.parse(&tokens);
            assert!(actual.is_ok(), "could not parse test {i}: {actual:#?}");
            let actual = actual.unwrap();
            assert_eq!(actual, expected, "failed test {i}");
        }
    }

    #[test]
    fn recognize_invalid_params() {
        let test_fn = "(let) => { return 1 }";
        let tokens = crate::token::lexer(test_fn).unwrap();
        let err = function_expression.parse(&tokens).unwrap_err().into_inner();
        let cause = err.cause.unwrap();
        // This is the token `let`
        assert_eq!(cause.source_ranges(), vec![SourceRange([1, 4])]);
        assert_eq!(cause.message(), "Cannot assign a variable to a reserved keyword: let");
    }

    #[test]
    fn comment_in_string() {
        let string_literal = r#""
           // a comment
             ""#;
        let tokens = crate::token::lexer(string_literal).unwrap();
        let parsed_literal = literal.parse(&tokens).unwrap();
        assert_eq!(
            parsed_literal.value,
            "
           // a comment
             "
            .into()
        );
    }

    #[test]
    fn pipes_on_pipes_minimal() {
        let test_program = r#"startSketchAt([0, 0])
        |> lineTo([0, -0], %) // MoveRelative

        "#;
        let tokens = crate::token::lexer(test_program).unwrap();
        let mut slice = &tokens[..];
        let _actual = pipe_expression.parse_next(&mut slice).unwrap();
        assert_eq!(slice[0].token_type, TokenType::Whitespace);
    }

    #[test]
    fn test_pipes_on_pipes() {
        let test_program = include_str!("../../../tests/executor/inputs/pipes_on_pipes.kcl");
        let tokens = crate::token::lexer(test_program).unwrap();
        let _actual = program.parse(&tokens).unwrap();
    }

    #[test]
    fn test_cube() {
        let test_program = include_str!("../../../tests/executor/inputs/cube.kcl");
        let tokens = crate::token::lexer(test_program).unwrap();
        match program.parse(&tokens) {
            Ok(_) => {}
            Err(e) => {
                panic!("{e:#?}");
            }
        }
    }

    #[test]
    fn test_parameter_list() {
        let tests = [
            ("", vec![]),
            ("a", vec!["a"]),
            ("a, b", vec!["a", "b"]),
            ("a,b", vec!["a", "b"]),
        ];
        for (i, (input, expected)) in tests.into_iter().enumerate() {
            let tokens = crate::token::lexer(input).unwrap();
            let actual = parameters.parse(&tokens);
            assert!(actual.is_ok(), "could not parse test {i}");
            let actual_ids: Vec<_> = actual.unwrap().into_iter().map(|p| p.identifier.name).collect();
            assert_eq!(actual_ids, expected);
        }
    }

    #[test]
    fn test_user_function() {
        let input = "() => {
            return 2
        }";

        let tokens = crate::token::lexer(input).unwrap();
        let actual = function_expression.parse(&tokens);
        assert!(actual.is_ok(), "could not parse test function");
    }

    #[test]
    fn test_declaration() {
        let tests = ["const myVar = 5", "const myVar=5", "const myVar =5", "const myVar= 5"];
        for test in tests {
            // Run the original parser
            let tokens = crate::token::lexer(test).unwrap();
            let mut expected_body = crate::parser::Parser::new(tokens.clone()).ast().unwrap().body;
            assert_eq!(expected_body.len(), 1);
            let BodyItem::VariableDeclaration(expected) = expected_body.pop().unwrap() else {
                panic!("Expected variable declaration");
            };

            // Run the second parser, check it matches the first parser.
            let mut actual = declaration.parse(&tokens).unwrap();
            assert_eq!(expected, actual);

            // Inspect its output in more detail.
            assert_eq!(actual.kind, VariableKind::Const);
            assert_eq!(actual.start, 0);
            assert_eq!(actual.declarations.len(), 1);
            let decl = actual.declarations.pop().unwrap();
            assert_eq!(decl.id.name, "myVar");
            let Expr::Literal(value) = decl.init else {
                panic!("value should be a literal")
            };
            assert_eq!(value.end, test.len());
            assert_eq!(value.raw, "5");
        }
    }

    #[test]
    fn test_math_parse() {
        let tokens = crate::token::lexer(r#"5 + "a""#).unwrap();
        let actual = crate::parser::Parser::new(tokens).ast().unwrap().body;
        let expr = BinaryExpression {
            start: 0,
            end: 7,
            operator: BinaryOperator::Add,
            left: BinaryPart::Literal(Box::new(Literal {
                start: 0,
                end: 1,
                value: 5u32.into(),
                raw: "5".to_owned(),
                digest: None,
            })),
            right: BinaryPart::Literal(Box::new(Literal {
                start: 4,
                end: 7,
                value: "a".into(),
                raw: r#""a""#.to_owned(),
                digest: None,
            })),
            digest: None,
        };
        let expected = vec![BodyItem::ExpressionStatement(ExpressionStatement {
            start: 0,
            end: 7,
            expression: Expr::BinaryExpression(Box::new(expr)),
            digest: None,
        })];
        assert_eq!(expected, actual);
    }

    #[test]
    fn test_is_code_token() {
        let tokens = [
            Token {
                token_type: TokenType::Word,
                start: 0,
                end: 3,
                value: "log".to_string(),
            },
            Token {
                token_type: TokenType::Brace,
                start: 3,
                end: 4,
                value: "(".to_string(),
            },
            Token {
                token_type: TokenType::Number,
                start: 4,
                end: 5,
                value: "5".to_string(),
            },
            Token {
                token_type: TokenType::Comma,
                start: 5,
                end: 6,
                value: ",".to_string(),
            },
            Token {
                token_type: TokenType::String,
                start: 7,
                end: 14,
                value: "\"hello\"".to_string(),
            },
            Token {
                token_type: TokenType::Word,
                start: 16,
                end: 27,
                value: "aIdentifier".to_string(),
            },
            Token {
                token_type: TokenType::Brace,
                start: 27,
                end: 28,
                value: ")".to_string(),
            },
        ];
        for (i, token) in tokens.iter().enumerate() {
            assert!(token.is_code_token(), "failed test {i}: {token:?}")
        }
    }

    #[test]
    fn test_is_not_code_token() {
        let tokens = [
            Token {
                token_type: TokenType::Whitespace,
                start: 6,
                end: 7,
                value: " ".to_string(),
            },
            Token {
                token_type: TokenType::BlockComment,
                start: 28,
                end: 30,
                value: "/* abte */".to_string(),
            },
            Token {
                token_type: TokenType::LineComment,
                start: 30,
                end: 33,
                value: "// yoyo a line".to_string(),
            },
        ];
        for (i, token) in tokens.iter().enumerate() {
            assert!(!token.is_code_token(), "failed test {i}: {token:?}")
        }
    }

    #[test]
    fn test_abstract_syntax_tree() {
        let code = "5 +6";
        let parser = crate::parser::Parser::new(crate::token::lexer(code).unwrap());
        let result = parser.ast().unwrap();
        let expected_result = Program {
            start: 0,
            end: 4,
            body: vec![BodyItem::ExpressionStatement(ExpressionStatement {
                start: 0,
                end: 4,
                expression: Expr::BinaryExpression(Box::new(BinaryExpression {
                    start: 0,
                    end: 4,
                    left: BinaryPart::Literal(Box::new(Literal {
                        start: 0,
                        end: 1,
                        value: 5u32.into(),
                        raw: "5".to_string(),
                        digest: None,
                    })),
                    operator: BinaryOperator::Add,
                    right: BinaryPart::Literal(Box::new(Literal {
                        start: 3,
                        end: 4,
                        value: 6u32.into(),
                        raw: "6".to_string(),
                        digest: None,
                    })),
                    digest: None,
                })),
                digest: None,
            })],
            non_code_meta: NonCodeMeta::default(),
            digest: None,
        };

        assert_eq!(result, expected_result);
    }

    #[test]
    fn test_empty_file() {
        let some_program_string = r#""#;
        let tokens = crate::token::lexer(some_program_string).unwrap();
        let parser = crate::parser::Parser::new(tokens);
        let result = parser.ast();
        assert!(result.is_ok());
    }

    #[test]
    fn test_parse_half_pipe_small() {
        let tokens = crate::token::lexer(
            "const secondExtrude = startSketchOn('XY')
  |> startProfileAt([0,0], %)
  |",
        )
        .unwrap();
        let parser = crate::parser::Parser::new(tokens);
        let result = parser.ast();
        assert!(result.is_err());
        let actual = result.err().unwrap().to_string();
        assert!(actual.contains("Unexpected token: |"), "actual={actual:?}");
    }

    #[test]
    fn test_parse_member_expression_double_nested_braces() {
        let tokens = crate::token::lexer(r#"const prop = yo["one"][two]"#).unwrap();
        let parser = crate::parser::Parser::new(tokens);
        parser.ast().unwrap();
    }

    #[test]
    fn test_parse_member_expression_binary_expression_period_number_first() {
        let tokens = crate::token::lexer(
            r#"const obj = { a: 1, b: 2 }
const height = 1 - obj.a"#,
        )
        .unwrap();
        let parser = crate::parser::Parser::new(tokens);
        parser.ast().unwrap();
    }

    #[test]
    fn test_parse_member_expression_allowed_type_in_expression() {
        let tokens = crate::token::lexer(
            r#"const obj = { thing: 1 }
startSketchOn(obj.sketch)"#,
        )
        .unwrap();

        let parser = crate::parser::Parser::new(tokens);
        parser.ast().unwrap();
    }

    #[test]
    fn test_parse_member_expression_binary_expression_brace_number_first() {
        let tokens = crate::token::lexer(
            r#"const obj = { a: 1, b: 2 }
const height = 1 - obj["a"]"#,
        )
        .unwrap();
        let parser = crate::parser::Parser::new(tokens);
        parser.ast().unwrap();
    }

    #[test]
    fn test_parse_member_expression_binary_expression_brace_number_second() {
        let tokens = crate::token::lexer(
            r#"const obj = { a: 1, b: 2 }
const height = obj["a"] - 1"#,
        )
        .unwrap();
        let parser = crate::parser::Parser::new(tokens);
        parser.ast().unwrap();
    }

    #[test]
    fn test_parse_member_expression_binary_expression_in_array_number_first() {
        let tokens = crate::token::lexer(
            r#"const obj = { a: 1, b: 2 }
const height = [1 - obj["a"], 0]"#,
        )
        .unwrap();
        let parser = crate::parser::Parser::new(tokens);
        parser.ast().unwrap();
    }

    #[test]
    fn test_parse_member_expression_binary_expression_in_array_number_second() {
        let tokens = crate::token::lexer(
            r#"const obj = { a: 1, b: 2 }
const height = [obj["a"] - 1, 0]"#,
        )
        .unwrap();
        let parser = crate::parser::Parser::new(tokens);
        parser.ast().unwrap();
    }

    #[test]
    fn test_parse_member_expression_binary_expression_in_array_number_second_missing_space() {
        let tokens = crate::token::lexer(
            r#"const obj = { a: 1, b: 2 }
const height = [obj["a"] -1, 0]"#,
        )
        .unwrap();
        let parser = crate::parser::Parser::new(tokens);
        parser.ast().unwrap();
    }

    #[test]
    fn test_parse_half_pipe() {
        let tokens = crate::token::lexer(
            "const height = 10

const firstExtrude = startSketchOn('XY')
  |> startProfileAt([0,0], %)
  |> line([0, 8], %)
  |> line([20, 0], %)
  |> line([0, -8], %)
  |> close(%)
  |> extrude(2, %)

const secondExtrude = startSketchOn('XY')
  |> startProfileAt([0,0], %)
  |",
        )
        .unwrap();
        let parser = crate::parser::Parser::new(tokens);
        let result = parser.ast();
        assert!(result.is_err());
        assert!(result.err().unwrap().to_string().contains("Unexpected token: |"));
    }

    #[test]
    fn test_parse_greater_bang() {
        let tokens = crate::token::lexer(">!").unwrap();
        let parser = crate::parser::Parser::new(tokens);
        let err = parser.ast().unwrap_err();
        assert_eq!(
            err.to_string(),
            r#"syntax: KclErrorDetails { source_ranges: [SourceRange([0, 1])], message: "Unexpected token: >" }"#
        );
    }

    #[test]
    fn test_parse_z_percent_parens() {
        let tokens = crate::token::lexer("z%)").unwrap();
        let parser = crate::parser::Parser::new(tokens);
        let result = parser.ast();
        assert!(result.is_err());
        assert_eq!(
            result.err().unwrap().to_string(),
            r#"syntax: KclErrorDetails { source_ranges: [SourceRange([1, 2])], message: "Unexpected token: %" }"#
        );
    }

    #[test]
    fn test_parse_parens_unicode() {
        let result = crate::token::lexer("(ޜ");
        // TODO: Better errors when program cannot tokenize.
        // https://github.com/KittyCAD/modeling-app/issues/696
        assert!(result.is_err());
        assert_eq!(
            result.err().unwrap().to_string(),
            r#"lexical: KclErrorDetails { source_ranges: [SourceRange([1, 2])], message: "found unknown token 'ޜ'" }"#
        );
    }

    #[test]
    fn test_parse_negative_in_array_binary_expression() {
        let tokens = crate::token::lexer(
            r#"const leg1 = 5
const thickness = 0.56

const bracket = [-leg2 + thickness, 0]
"#,
        )
        .unwrap();
        let parser = crate::parser::Parser::new(tokens);
        let result = parser.ast();
        assert!(result.is_ok());
    }

    #[test]
    fn test_parse_nested_open_brackets() {
        let tokens = crate::token::lexer(
            r#"
z(-[["#,
        )
        .unwrap();
        let parser = crate::parser::Parser::new(tokens);
        let result = parser.ast();
        assert!(result.is_err());
    }

    #[test]
    fn test_parse_weird_new_line_function() {
        let tokens = crate::token::lexer(
            r#"z
 (--#"#,
        )
        .unwrap();
        let parser = crate::parser::Parser::new(tokens);
        let result = parser.ast();
        assert!(result.is_err());
        assert_eq!(
            result.err().unwrap().to_string(),
            r#"syntax: KclErrorDetails { source_ranges: [SourceRange([3, 4])], message: "Unexpected token: (" }"#
        );
    }

    #[test]
    fn test_parse_weird_lots_of_fancy_brackets() {
        let tokens = crate::token::lexer(r#"zz({{{{{{{{)iegAng{{{{{{{##"#).unwrap();
        let parser = crate::parser::Parser::new(tokens);
        let result = parser.ast();
        assert!(result.is_err());
        assert_eq!(
            result.err().unwrap().to_string(),
            r#"syntax: KclErrorDetails { source_ranges: [SourceRange([2, 3])], message: "Unexpected token: (" }"#
        );
    }

    #[test]
    fn test_parse_weird_close_before_open() {
        let tokens = crate::token::lexer(
            r#"fn)n
e
["#,
        )
        .unwrap();
        let parser = crate::parser::Parser::new(tokens);
        let result = parser.ast();
        assert!(result.is_err());
        assert!(result
            .err()
            .unwrap()
            .to_string()
            .contains("expected whitespace, found ')' which is brace"));
    }

    #[test]
    fn test_parse_weird_close_before_nada() {
        let tokens = crate::token::lexer(r#"fn)n-"#).unwrap();
        let parser = crate::parser::Parser::new(tokens);
        let result = parser.ast();
        assert!(result.is_err());
        dbg!(&result);
        assert!(result
            .err()
            .unwrap()
            .to_string()
            .contains("expected whitespace, found ')' which is brace"));
    }

    #[test]
    fn test_parse_weird_lots_of_slashes() {
        let tokens = crate::token::lexer(
            r#"J///////////o//+///////////P++++*++++++P///////˟
++4"#,
        )
        .unwrap();
        let parser = crate::parser::Parser::new(tokens);
        let result = parser.ast();
        assert!(result.is_err());
        let actual = result.err().unwrap().to_string();
        assert!(actual.contains("Unexpected token: +"), "actual={actual:?}");
    }

    #[test]
    fn test_optional_param_order() {
        for (i, (params, expect_ok)) in [
            (
                vec![Parameter {
                    identifier: Identifier {
                        start: 0,
                        end: 0,
                        name: "a".to_owned(),
                        digest: None,
                    },
                    type_: None,
                    optional: true,
                    digest: None,
                }],
                true,
            ),
            (
                vec![Parameter {
                    identifier: Identifier {
                        start: 0,
                        end: 0,
                        name: "a".to_owned(),
                        digest: None,
                    },
                    type_: None,
                    optional: false,
                    digest: None,
                }],
                true,
            ),
            (
                vec![
                    Parameter {
                        identifier: Identifier {
                            start: 0,
                            end: 0,
                            name: "a".to_owned(),
                            digest: None,
                        },
                        type_: None,
                        optional: false,
                        digest: None,
                    },
                    Parameter {
                        identifier: Identifier {
                            start: 0,
                            end: 0,
                            name: "b".to_owned(),
                            digest: None,
                        },
                        type_: None,
                        optional: true,
                        digest: None,
                    },
                ],
                true,
            ),
            (
                vec![
                    Parameter {
                        identifier: Identifier {
                            start: 0,
                            end: 0,
                            name: "a".to_owned(),
                            digest: None,
                        },
                        type_: None,
                        optional: true,
                        digest: None,
                    },
                    Parameter {
                        identifier: Identifier {
                            start: 0,
                            end: 0,
                            name: "b".to_owned(),
                            digest: None,
                        },
                        type_: None,
                        optional: false,
                        digest: None,
                    },
                ],
                false,
            ),
        ]
        .into_iter()
        .enumerate()
        {
            let actual = optional_after_required(&params);
            assert_eq!(actual.is_ok(), expect_ok, "failed test {i}");
        }
    }

    #[test]
    fn test_error_keyword_in_variable() {
        let some_program_string = r#"const let = "thing""#;
        let tokens = crate::token::lexer(some_program_string).unwrap();
        let parser = crate::parser::Parser::new(tokens);
        let result = parser.ast();
        assert!(result.is_err());
        assert_eq!(
            result.err().unwrap().to_string(),
            r#"syntax: KclErrorDetails { source_ranges: [SourceRange([6, 9])], message: "Cannot assign a variable to a reserved keyword: let" }"#
        );
    }

    #[test]
    fn test_error_keyword_in_fn_name() {
        let some_program_string = r#"fn let = () {}"#;
        let tokens = crate::token::lexer(some_program_string).unwrap();
        let parser = crate::parser::Parser::new(tokens);
        let result = parser.ast();
        assert!(result.is_err());
        assert_eq!(
            result.err().unwrap().to_string(),
            r#"syntax: KclErrorDetails { source_ranges: [SourceRange([3, 6])], message: "Cannot assign a variable to a reserved keyword: let" }"#
        );
    }

    #[test]
    fn test_error_stdlib_in_fn_name() {
        let some_program_string = r#"fn cos = () => {
            return 1
        }"#;
        let tokens = crate::token::lexer(some_program_string).unwrap();
        let parser = crate::parser::Parser::new(tokens);
        let result = parser.ast();
        assert!(result.is_err());
        assert_eq!(
            result.err().unwrap().to_string(),
            r#"syntax: KclErrorDetails { source_ranges: [SourceRange([3, 6])], message: "Cannot assign a variable to a reserved keyword: cos" }"#
        );
    }

    #[test]
    fn test_error_keyword_in_fn_args() {
        let some_program_string = r#"fn thing = (let) => {
    return 1
}"#;
        let tokens = crate::token::lexer(some_program_string).unwrap();
        let parser = crate::parser::Parser::new(tokens);
        let result = parser.ast();
        assert!(result.is_err());
        assert_eq!(
            result.err().unwrap().to_string(),
            r#"syntax: KclErrorDetails { source_ranges: [SourceRange([12, 15])], message: "Cannot assign a variable to a reserved keyword: let" }"#
        );
    }

    #[test]
    fn test_error_stdlib_in_fn_args() {
        let some_program_string = r#"fn thing = (cos) => {
    return 1
}"#;
        let tokens = crate::token::lexer(some_program_string).unwrap();
        let parser = crate::parser::Parser::new(tokens);
        let result = parser.ast();
        assert!(result.is_err());
        assert_eq!(
            result.err().unwrap().to_string(),
            r#"syntax: KclErrorDetails { source_ranges: [SourceRange([12, 15])], message: "Cannot assign a variable to a reserved keyword: cos" }"#
        );
    }

    #[test]
    fn zero_param_function() {
        let program = r#"
        fn firstPrimeNumber = () => {
            return 2
        }
        firstPrimeNumber()
        "#;
        let tokens = crate::token::lexer(program).unwrap();
        let parser = crate::parser::Parser::new(tokens);
        let _ast = parser.ast().unwrap();
    }

    #[test]
    fn array() {
        let program = r#"[1, 2, 3]"#;
        let tokens = crate::token::lexer(program).unwrap();
        let mut sl: &[Token] = &tokens;
        let _arr = array_elem_by_elem(&mut sl).unwrap();
    }

    #[test]
    fn array_linesep_trailing_comma() {
        let program = r#"[
            1,
            2,
            3,
        ]"#;
        let tokens = crate::token::lexer(program).unwrap();
        let mut sl: &[Token] = &tokens;
        let _arr = array_elem_by_elem(&mut sl).unwrap();
    }

    #[allow(unused)]
    #[test]
    fn array_linesep_no_trailing_comma() {
        let program = r#"[
            1,
            2,
            3
        ]"#;
        let tokens = crate::token::lexer(program).unwrap();
        let mut sl: &[Token] = &tokens;
        let _arr = array_elem_by_elem(&mut sl).unwrap();
    }

    #[test]
    fn basic_if_else() {
        let some_program_string = "if true {
            3
        } else {
            4
        }";
        let tokens = crate::token::lexer(some_program_string).unwrap();
        let mut sl: &[Token] = &tokens;
        let _res = if_expr(&mut sl).unwrap();
    }

    #[test]
    fn basic_else_if() {
        let some_program_string = "else if true {
            4
        }";
        let tokens = crate::token::lexer(some_program_string).unwrap();
        let mut sl: &[Token] = &tokens;
        let _res = else_if(&mut sl).unwrap();
    }

    #[test]
    fn basic_if_else_if() {
        let some_program_string = "if true {
            3  
        } else if true {
            4
        } else {
            5
        }";
        let tokens = crate::token::lexer(some_program_string).unwrap();
        let mut sl: &[Token] = &tokens;
        let _res = if_expr(&mut sl).unwrap();
    }

    #[test]
    fn test_keyword_ok_in_fn_args_return() {
        let some_program_string = r#"fn thing = (param) => {
    return true
}

thing(false)
"#;
        let tokens = crate::token::lexer(some_program_string).unwrap();
        let parser = crate::parser::Parser::new(tokens);
        parser.ast().unwrap();
    }

    #[test]
    fn test_error_define_function_as_var() {
        for name in ["var", "let", "const"] {
            let some_program_string = format!(
                r#"{} thing = (param) => {{
    return true
}}

thing(false)
"#,
                name
            );
            let tokens = crate::token::lexer(&some_program_string).unwrap();
            let parser = crate::parser::Parser::new(tokens);
            let result = parser.ast();
            assert!(result.is_err());
            assert_eq!(
                result.err().unwrap().to_string(),
                format!(
                    r#"syntax: KclErrorDetails {{ source_ranges: [SourceRange([0, {}])], message: "Expected a `fn` variable kind, found: `const`" }}"#,
                    name.len(),
                )
            );
        }
    }

    #[test]
    fn test_error_define_var_as_function() {
        let some_program_string = r#"fn thing = "thing""#;
        let tokens = crate::token::lexer(some_program_string).unwrap();
        let parser = crate::parser::Parser::new(tokens);
        let result = parser.ast();
        assert!(result.is_err());
        // TODO: https://github.com/KittyCAD/modeling-app/issues/784
        // Improve this error message.
        // It should say that the compiler is expecting a function expression on the RHS.
        assert_eq!(
            result.err().unwrap().to_string(),
            r#"syntax: KclErrorDetails { source_ranges: [SourceRange([11, 18])], message: "Unexpected token: \"thing\"" }"#
        );
    }

    #[test]
    fn random_words_fail() {
        let test_program = r#"const part001 = startSketchOn('-XZ')
    |> startProfileAt([8.53, 11.8], %)
    asdasd asdasd
    |> line([11.12, -14.82], %)
    |> line([-13.27, -6.98], %)
    |> line([-5.09, 12.33], %)
    asdasd
"#;
        let tokens = crate::token::lexer(test_program).unwrap();
        let parser = crate::parser::Parser::new(tokens);
        let result = parser.ast();
        let _e = result.unwrap_err();
    }

    #[test]
    fn test_member_expression_sketch() {
        let some_program_string = r#"fn cube = (pos, scale) => {
  const sg = startSketchOn('XY')
  |> startProfileAt(pos, %)
    |> line([0, scale], %)
    |> line([scale, 0], %)
    |> line([0, -scale], %)

  return sg
}

const b1 = cube([0,0], 10)
const b2 = cube([3,3], 4)

const pt1 = b1[0]
const pt2 = b2[0]
"#;
        let tokens = crate::token::lexer(some_program_string).unwrap();
        let parser = crate::parser::Parser::new(tokens);
        parser.ast().unwrap();
    }

    #[test]
    fn test_math_with_stdlib() {
        let some_program_string = r#"const d2r = pi() / 2
let other_thing = 2 * cos(3)"#;
        let tokens = crate::token::lexer(some_program_string).unwrap();
        let parser = crate::parser::Parser::new(tokens);
        parser.ast().unwrap();
    }

    #[test]
    fn test_negative_arguments() {
        let some_program_string = r#"fn box = (p, h, l, w) => {
 const myBox = startSketchOn('XY')
    |> startProfileAt(p, %)
    |> line([0, l], %)
    |> line([w, 0], %)
    |> line([0, -l], %)
    |> close(%)
    |> extrude(h, %)

  return myBox
}
let myBox = box([0,0], -3, -16, -10)
"#;
        let tokens = crate::token::lexer(some_program_string).unwrap();
        let parser = crate::parser::Parser::new(tokens);
        parser.ast().unwrap();
    }
    #[test]
    fn must_use_percent_in_pipeline_fn() {
        let some_program_string = r#"
        foo()
            |> bar(2)
        "#;
        let tokens = crate::token::lexer(some_program_string).unwrap();
        let parser = crate::parser::Parser::new(tokens);
        let err = parser.ast().unwrap_err();
        assert_eq!(
            err.to_string(),
            r#"syntax: KclErrorDetails { source_ranges: [SourceRange([30, 36])], message: "All expressions in a pipeline must use the % (substitution operator)" }"#
        );
    }
}

#[cfg(test)]
mod snapshot_math_tests {
    use super::*;

    // This macro generates a test function with the given function name.
    // The macro takes a KCL program, ensures it tokenizes and parses, then compares
    // its parsed AST to a snapshot (kept in this repo in a file under snapshots/ dir)
    macro_rules! snapshot_test {
        ($func_name:ident, $test_kcl_program:expr) => {
            #[test]
            fn $func_name() {
                let tokens = crate::token::lexer($test_kcl_program).unwrap();
                let actual = match binary_expression.parse(&tokens) {
                    Ok(x) => x,
                    Err(_e) => panic!("could not parse test"),
                };
                insta::assert_json_snapshot!(actual);
            }
        };
    }

    snapshot_test!(a, "1 + 2");
    snapshot_test!(b, "1+2");
    snapshot_test!(c, "1 -2");
    snapshot_test!(d, "1 + 2 * 3");
    snapshot_test!(e, "1 * ( 2 + 3 )");
    snapshot_test!(f, "1 * ( 2 + 3 ) / 4");
    snapshot_test!(g, "1 + ( 2 + 3 ) / 4");
    snapshot_test!(h, "1 * (( 2 + 3 ) / 4 + 5 )");
    snapshot_test!(i, "1 * ((( 2 + 3 )))");
    snapshot_test!(j, "distance * p * FOS * 6 / (sigmaAllow * width)");
    snapshot_test!(k, "2 + (((3)))");
}

#[cfg(test)]
mod snapshot_tests {
    use super::*;

    // This macro generates a test function with the given function name.
    // The macro takes a KCL program, ensures it tokenizes and parses, then compares
    // its parsed AST to a snapshot (kept in this repo in a file under snapshots/ dir)
    macro_rules! snapshot_test {
        ($func_name:ident, $test_kcl_program:expr) => {
            #[test]
            fn $func_name() {
                let tokens = crate::token::lexer($test_kcl_program).unwrap();
                print_tokens(&tokens);
                let actual = match program.parse(&tokens) {
                    Ok(x) => x,
                    Err(e) => panic!("could not parse test: {e:?}"),
                };
                let mut settings = insta::Settings::clone_current();
                settings.set_sort_maps(true);
                settings.bind(|| {
                    insta::assert_json_snapshot!(actual);
                });
            }
        };
    }

    snapshot_test!(
        a,
        r#"const boxSketch = startSketchAt([0, 0])
    |> line([0, 10], %)
    |> tangentialArc([-5, 5], %)
    |> line([5, -15], %)
    |> extrude(10, %)
"#
    );
    snapshot_test!(b, "const myVar = min(5 , -legLen(5, 4))"); // Space before comma

    snapshot_test!(c, "const myVar = min(-legLen(5, 4), 5)");
    snapshot_test!(d, "const myVar = 5 + 6 |> myFunc(45, %)");
    snapshot_test!(e, "let x = 1 * (3 - 4)");
    snapshot_test!(f, r#"const x = 1 // this is an inline comment"#);
    snapshot_test!(
        g,
        r#"fn x = () => {
        return sg
        return sg
      }"#
    );
    snapshot_test!(d2, r#"const x = -leg2 + thickness"#);
    snapshot_test!(
        h,
        r#"const obj = { a: 1, b: 2 }
    const height = 1 - obj.a"#
    );
    snapshot_test!(
        i,
        r#"const obj = { a: 1, b: 2 }
     const height = 1 - obj["a"]"#
    );
    snapshot_test!(
        j,
        r#"const obj = { a: 1, b: 2 }
    const height = obj["a"] - 1"#
    );
    snapshot_test!(
        k,
        r#"const obj = { a: 1, b: 2 }
    const height = [1 - obj["a"], 0]"#
    );
    snapshot_test!(
        l,
        r#"const obj = { a: 1, b: 2 }
    const height = [obj["a"] - 1, 0]"#
    );
    snapshot_test!(
        m,
        r#"const obj = { a: 1, b: 2 }
    const height = [obj["a"] -1, 0]"#
    );
    snapshot_test!(n, "const height = 1 - obj.a");
    snapshot_test!(o, "const six = 1 + 2 + 3");
    snapshot_test!(p, "const five = 3 * 1 + 2");
    snapshot_test!(q, r#"const height = [ obj["a"], 0 ]"#);
    snapshot_test!(
        r,
        r#"const obj = { a: 1, b: 2 }
    const height = obj["a"]"#
    );
    snapshot_test!(s, r#"const prop = yo["one"][two]"#);
    snapshot_test!(t, r#"const pt1 = b1[x]"#);
    snapshot_test!(u, "const prop = yo.one.two.three.four");
    snapshot_test!(v, r#"const pt1 = b1[0]"#);
    snapshot_test!(w, r#"const pt1 = b1['zero']"#);
    snapshot_test!(x, r#"const pt1 = b1.zero"#);
    snapshot_test!(y, "const sg = startSketchAt(pos)");
    snapshot_test!(z, "const sg = startSketchAt(pos) |> line([0, -scale], %)");
    snapshot_test!(aa, r#"const sg = -scale"#);
    snapshot_test!(ab, "lineTo({ to: [0, -1] })");
    snapshot_test!(ac, "const myArray = [0..10]");
    snapshot_test!(
        ad,
        r#"
    fn firstPrimeNumber = () => {
        return 2
    }
    firstPrimeNumber()"#
    );
    snapshot_test!(
        ae,
        r#"fn thing = (param) => {
        return true
    }
    thing(false)"#
    );
    snapshot_test!(
        af,
        r#"const mySketch = startSketchAt([0,0])
        |> lineTo([0, 1], %, $myPath)
        |> lineTo([1, 1], %)
        |> lineTo([1, 0], %, $rightPath)
        |> close(%)"#
    );
    snapshot_test!(
        ag,
        "const mySketch = startSketchAt([0,0]) |> lineTo([1, 1], %) |> close(%)"
    );
    snapshot_test!(ah, "const myBox = startSketchAt(p)");
    snapshot_test!(ai, r#"const myBox = f(1) |> g(2, %)"#);
    snapshot_test!(aj, r#"const myBox = startSketchAt(p) |> line([0, l], %)"#);
    snapshot_test!(ak, "lineTo({ to: [0, 1] })");
    snapshot_test!(al, "lineTo({ to: [0, 1], from: [3, 3] })");
    snapshot_test!(am, "lineTo({to:[0, 1]})");
    snapshot_test!(an, "lineTo({ to: [0, 1], from: [3, 3]})");
    snapshot_test!(ao, "lineTo({ to: [0, 1],from: [3, 3] })");
    snapshot_test!(ap, "const mySketch = startSketchAt([0,0])");
    snapshot_test!(aq, "log(5, \"hello\", aIdentifier)");
    snapshot_test!(ar, r#"5 + "a""#);
    snapshot_test!(at, "line([0, l], %)");
    snapshot_test!(au, include_str!("../../../tests/executor/inputs/cylinder.kcl"));
    snapshot_test!(av, "fn f = (angle?) => { return default(angle, 360) }");
    snapshot_test!(
        aw,
        "let numbers = [
            1,
            // A,
            // B,
            3,
        ]"
    );
    snapshot_test!(
        ax,
        "let numbers = [
            1,
            2,
            // A,
            // B,
        ]"
    );
    snapshot_test!(
        ay,
        "let props = {
            a: 1,
            // b: 2,
            c: 3,
        }"
    );
    snapshot_test!(
        az,
        "let props = {
            a: 1,
            // b: 2,
            c: 3
        }"
    );
    snapshot_test!(
        ba,
        r#"
const sketch001 = startSketchOn('XY')
  // |> arc({
  //   angleEnd: 270,
  //   angleStart: 450,
  // }, %)
  |> startProfileAt(%)
"#
    );
    snapshot_test!(
        bb,
        r#"
const my14 = 4 ^ 2 - 3 ^ 2 * 2
"#
    );
    snapshot_test!(
        bc,
        r#"const x = if true {
            3
        } else {
            4
        }"#
    );
    snapshot_test!(
        bd,
        r#"const x = if true {
            3
        } else if func(radius) {
            4
        } else {
            5
        }"#
    );
    snapshot_test!(be, "let x = 3 == 3");
    snapshot_test!(bf, "let x = 3 != 3");
    snapshot_test!(bg, r#"x = 4"#);
    snapshot_test!(bh, "const obj = {center : [10, 10], radius: 5}");
}

#[allow(unused)]
#[cfg(test)]
pub(crate) fn print_tokens(tokens: &[Token]) {
    for (i, tok) in tokens.iter().enumerate() {
        println!("{i:.2}: ({:?}):) '{}'", tok.token_type, tok.value.replace("\n", "\\n"));
    }
}
