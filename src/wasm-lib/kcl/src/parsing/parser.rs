use std::{cell::RefCell, collections::HashMap, str::FromStr};

use winnow::{
    combinator::{alt, delimited, opt, peek, preceded, repeat, separated, separated_pair, terminated},
    dispatch,
    error::{ErrMode, StrContext, StrContextValue},
    prelude::*,
    token::{any, one_of, take_till},
};

use crate::{
    docs::StdLibFn,
    errors::{KclError, KclErrorDetails},
    parsing::{
        ast::types::{
            ArrayExpression, ArrayRangeExpression, BinaryExpression, BinaryOperator, BinaryPart, BodyItem, BoxNode,
            CallExpression, CallExpressionKw, CommentStyle, ElseIf, Expr, ExpressionStatement, FnArgPrimitive,
            FnArgType, FunctionExpression, Identifier, IfExpression, ImportItem, ImportStatement, ItemVisibility,
            Literal, LiteralIdentifier, LiteralValue, MemberExpression, MemberObject, Node, NonCodeMeta, NonCodeNode,
            NonCodeValue, ObjectExpression, ObjectProperty, Parameter, PipeExpression, PipeSubstitution, Program,
            ReturnStatement, Shebang, TagDeclarator, UnaryExpression, UnaryOperator, VariableDeclaration,
            VariableDeclarator, VariableKind,
        },
        error::{self, CompilationError, ContextError, ParseError},
        math::BinaryExpressionToken,
        token::{Token, TokenType},
        PIPE_OPERATOR, PIPE_SUBSTITUTION_OPERATOR,
    },
    unparser::ExprContext,
    SourceRange,
};

use super::ast::types::LabeledArg;

thread_local! {
    /// The current `ParseContext`. `None` if parsing is not currently happening on this thread.
    static CTXT: RefCell<Option<ParseContext>> = const { RefCell::new(None) };
}

pub type TokenSlice<'slice, 'input> = &'slice mut &'input [Token];

pub fn run_parser(i: TokenSlice) -> super::ParseResult {
    let _stats = crate::log::LogPerfStats::new("Parsing");
    ParseContext::init();

    let result = program.parse(i).save_err();
    let ctxt = ParseContext::take();
    result.map(|o| (o, ctxt.errors)).into()
}

/// Context built up while parsing a program.
///
/// When returned from parsing contains the errors and warnings from the current parse.
#[derive(Debug, Clone, Default)]
pub(crate) struct ParseContext {
    pub errors: Vec<CompilationError>,
}

impl ParseContext {
    fn new() -> Self {
        ParseContext { errors: Vec::new() }
    }

    /// Set a new `ParseContext` in thread-local storage. Panics if one already exists.
    fn init() {
        assert!(CTXT.with_borrow(|ctxt| ctxt.is_none()));
        CTXT.with_borrow_mut(|ctxt| *ctxt = Some(ParseContext::new()));
    }

    /// Take the current `ParseContext` from thread-local storage, leaving `None`. Panics if a `ParseContext`
    /// is not present.
    fn take() -> ParseContext {
        CTXT.with_borrow_mut(|ctxt| ctxt.take()).unwrap()
    }

    /// Add an error to the current `ParseContext`, panics if there is none.
    fn err(err: CompilationError) {
        CTXT.with_borrow_mut(|ctxt| {
            // Avoid duplicating errors. This is possible since the parser can try one path, find
            // a warning, then backtrack and decide not to take that path and try another. This can
            // happen 'high up the stack', so it's impossible to fix where the errors are generated.
            // Ideally we would pass errors up the call stack rather than use a context object or
            // have some way to mark errors as speculative or committed, but I don't think Winnow
            // is flexible enough for that (or at least, not without significant changes to the
            // parser).
            let errors = &mut ctxt.as_mut().unwrap().errors;
            for e in errors.iter_mut().rev() {
                if e.source_range == err.source_range {
                    *e = err;
                    return;
                }

                if e.source_range.start() > err.source_range.end() {
                    break;
                }
            }
            errors.push(err);
        });
    }

    /// Add a warning to the current `ParseContext`, panics if there is none.
    fn warn(mut e: CompilationError) {
        e.severity = error::Severity::Warning;
        Self::err(e);
    }
}

type PResult<O, E = error::ContextError> = winnow::prelude::PResult<O, E>;

/// Helper trait for dealing with PResults and the `ParseContext`.
trait PResultEx {
    type O;

    /// If self is Ok, then returns it wrapped in `Ok(Some())`.
    /// If self is a parsing error, saves it to the current `ParseContext` and returns `Ok(None)`.
    /// If self is some other kind of error, then returns it.
    fn save_err(self) -> Result<Option<Self::O>, KclError>;
}

impl<O, E: Into<error::ErrorKind>> PResultEx for Result<O, E> {
    type O = O;

    fn save_err(self) -> Result<Option<O>, KclError> {
        match self {
            Ok(o) => Ok(Some(o)),
            Err(e) => match e.into() {
                error::ErrorKind::Parse(e) => {
                    ParseContext::err(e);
                    Ok(None)
                }
                error::ErrorKind::Internal(e) => Err(e),
            },
        }
    }
}

fn expected(what: &'static str) -> StrContext {
    StrContext::Expected(StrContextValue::Description(what))
}

fn program(i: TokenSlice) -> PResult<Node<Program>> {
    let shebang = opt(shebang).parse_next(i)?;
    let mut out: Node<Program> = function_body.parse_next(i)?;
    out.shebang = shebang;

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
fn non_code_node(i: TokenSlice) -> PResult<Node<NonCodeNode>> {
    /// Matches one case of NonCodeValue
    /// See docstring on [NonCodeValue::NewLineBlockComment] for why that case is different to the others.
    fn non_code_node_leading_whitespace(i: TokenSlice) -> PResult<Node<NonCodeNode>> {
        let leading_whitespace = one_of(TokenType::Whitespace)
            .context(expected("whitespace, with a newline"))
            .parse_next(i)?;
        let has_empty_line = count_in('\n', &leading_whitespace.value) >= 2;
        non_code_node_no_leading_whitespace
            .verify_map(|node: Node<NonCodeNode>| match node.inner.value {
                NonCodeValue::BlockComment { value, style } => Some(Node::new(
                    NonCodeNode {
                        value: if has_empty_line {
                            NonCodeValue::NewLineBlockComment { value, style }
                        } else {
                            NonCodeValue::BlockComment { value, style }
                        },
                        digest: None,
                    },
                    leading_whitespace.start,
                    node.end + 1,
                    node.module_id,
                )),
                _ => None,
            })
            .context(expected("a comment or whitespace"))
            .parse_next(i)
    }

    alt((non_code_node_leading_whitespace, non_code_node_no_leading_whitespace)).parse_next(i)
}

// Matches remaining three cases of NonCodeValue
fn non_code_node_no_leading_whitespace(i: TokenSlice) -> PResult<Node<NonCodeNode>> {
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
            Some(Node::new(
                NonCodeNode { value, digest: None },
                token.start,
                token.end,
                token.module_id,
            ))
        }
    })
    .context(expected("Non-code token (comments or whitespace)"))
    .parse_next(i)
}

fn pipe_expression(i: TokenSlice) -> PResult<Node<PipeExpression>> {
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
    Ok(Node {
        start: values.first().unwrap().start(),
        end: values.last().unwrap().end().max(max_noncode_end),
        module_id: values.first().unwrap().module_id(),
        inner: PipeExpression {
            body: values,
            non_code_meta,
            digest: None,
        },
    })
}

fn bool_value(i: TokenSlice) -> PResult<BoxNode<Literal>> {
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
    Ok(Box::new(Node::new(
        Literal {
            value: LiteralValue::Bool(value),
            raw: value.to_string(),
            digest: None,
        },
        token.start,
        token.end,
        token.module_id,
    )))
}

pub fn literal(i: TokenSlice) -> PResult<BoxNode<Literal>> {
    alt((string_literal, unsigned_number_literal))
        .map(Box::new)
        .context(expected("a KCL literal, like 'myPart' or 3"))
        .parse_next(i)
}

/// Parse a KCL string literal
pub fn string_literal(i: TokenSlice) -> PResult<Node<Literal>> {
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
    Ok(Node::new(
        Literal {
            value,
            raw: token.value.clone(),
            digest: None,
        },
        token.start,
        token.end,
        token.module_id,
    ))
}

/// Parse a KCL literal number, with no - sign.
pub(crate) fn unsigned_number_literal(i: TokenSlice) -> PResult<Node<Literal>> {
    let (value, token) = any
        .try_map(|token: Token| match token.token_type {
            TokenType::Number => {
                let x: f64 = token.value.parse().map_err(|_| {
                    KclError::Syntax(KclErrorDetails {
                        source_ranges: token.as_source_ranges(),
                        message: format!("Invalid float: {}", token.value),
                    })
                })?;

                Ok((LiteralValue::Number(x), token))
            }
            _ => Err(KclError::Syntax(KclErrorDetails {
                source_ranges: token.as_source_ranges(),
                message: "invalid literal".to_owned(),
            })),
        })
        .context(expected("an unsigned number literal (e.g. 3 or 12.5)"))
        .parse_next(i)?;
    Ok(Node::new(
        Literal {
            value,
            raw: token.value.clone(),
            digest: None,
        },
        token.start,
        token.end,
        token.module_id,
    ))
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
            let source_ranges = vec![SourceRange::from(&part)];
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
                Expr::CallExpressionKw(x) => BinaryPart::CallExpressionKw(x),
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
fn shebang(i: TokenSlice) -> PResult<Node<Shebang>> {
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

    Ok(Node::new(
        Shebang::new(format!("#!{}", value)),
        0,
        tokens.last().unwrap().end,
        tokens.first().unwrap().module_id,
    ))
}

#[allow(clippy::large_enum_variant)]
pub enum NonCodeOr<T> {
    NonCode(Node<NonCodeNode>),
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
fn array_empty(i: TokenSlice) -> PResult<Node<ArrayExpression>> {
    let open = open_bracket(i)?;
    let start = open.start;
    ignore_whitespace(i);
    let end = close_bracket(i)?.end;
    Ok(Node::new(
        ArrayExpression {
            elements: Default::default(),
            non_code_meta: Default::default(),
            digest: None,
        },
        start,
        end,
        open.module_id,
    ))
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

pub(crate) fn array_elem_by_elem(i: TokenSlice) -> PResult<Node<ArrayExpression>> {
    let open = open_bracket(i)?;
    let start = open.start;
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
        start_nodes: Vec::new(),
        digest: None,
    };
    Ok(Node::new(
        ArrayExpression {
            elements,
            non_code_meta,
            digest: None,
        },
        start,
        end,
        open.module_id,
    ))
}

fn array_end_start(i: TokenSlice) -> PResult<Node<ArrayRangeExpression>> {
    let open = open_bracket(i)?;
    let start = open.start;
    ignore_whitespace(i);
    let start_element = expression.parse_next(i)?;
    ignore_whitespace(i);
    double_period.parse_next(i)?;
    ignore_whitespace(i);
    let end_element = expression.parse_next(i)?;
    ignore_whitespace(i);
    let end = close_bracket(i)?.end;
    Ok(Node::new(
        ArrayRangeExpression {
            start_element,
            end_element,
            end_inclusive: true,
            digest: None,
        },
        start,
        end,
        open.module_id,
    ))
}

fn object_property_same_key_and_val(i: TokenSlice) -> PResult<Node<ObjectProperty>> {
    let key = identifier.context(expected("the property's key (the name or identifier of the property), e.g. in 'height: 4', 'height' is the property key")).parse_next(i)?;
    ignore_whitespace(i);
    Ok(Node {
        start: key.start,
        end: key.end,
        module_id: key.module_id,
        inner: ObjectProperty {
            value: Expr::Identifier(Box::new(key.clone())),
            key,
            digest: None,
        },
    })
}

fn object_property(i: TokenSlice) -> PResult<Node<ObjectProperty>> {
    let key = identifier.context(expected("the property's key (the name or identifier of the property), e.g. in 'height = 4', 'height' is the property key")).parse_next(i)?;
    ignore_whitespace(i);
    // Temporarily accept both `:` and `=` for compatibility.
    let sep = alt((colon, equals))
        .context(expected(
            "`=`, which separates the property's key from the value you're setting it to, e.g. 'height = 4'",
        ))
        .parse_next(i)?;
    ignore_whitespace(i);
    let expr = expression
        .context(expected(
            "the value which you're setting the property to, e.g. in 'height: 4', the value is 4",
        ))
        .parse_next(i)?;

    let result = Node {
        start: key.start,
        end: expr.end(),
        module_id: key.module_id,
        inner: ObjectProperty {
            key,
            value: expr,
            digest: None,
        },
    };

    if sep.token_type == TokenType::Colon {
        ParseContext::warn(CompilationError::with_suggestion(
            sep.into(),
            Some(result.as_source_range()),
            "Using `:` to initialize objects is deprecated, prefer using `=`.",
            Some(" ="),
            error::Tag::Deprecated,
        ));
    }

    Ok(result)
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
pub(crate) fn object(i: TokenSlice) -> PResult<Node<ObjectExpression>> {
    let open = open_brace(i)?;
    let start = open.start;
    ignore_whitespace(i);
    let properties: Vec<_> = repeat(
        0..,
        alt((
            terminated(non_code_node.map(NonCodeOr::NonCode), whitespace),
            terminated(
                alt((object_property, object_property_same_key_and_val)),
                property_separator,
            )
            .map(NonCodeOr::Code),
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
    Ok(Node::new(
        ObjectExpression {
            properties,
            non_code_meta,
            digest: None,
        },
        start,
        end,
        open.module_id,
    ))
}

/// Parse the % symbol, used to substitute a curried argument from a |> (pipe).
fn pipe_sub(i: TokenSlice) -> PResult<Node<PipeSubstitution>> {
    any.try_map(|token: Token| {
        if matches!(token.token_type, TokenType::Operator) && token.value == PIPE_SUBSTITUTION_OPERATOR {
            Ok(Node::new(
                PipeSubstitution { digest: None },
                token.start,
                token.end,
                token.module_id,
            ))
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

fn else_if(i: TokenSlice) -> PResult<Node<ElseIf>> {
    let else_ = any
        .try_map(|token: Token| {
            if matches!(token.token_type, TokenType::Keyword) && token.value == "else" {
                Ok(token)
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
    Ok(Node::new(
        ElseIf {
            cond,
            then_val,
            digest: Default::default(),
        },
        else_.start,
        end,
        else_.module_id,
    ))
}

fn if_expr(i: TokenSlice) -> PResult<BoxNode<IfExpression>> {
    let if_ = any
        .try_map(|token: Token| {
            if matches!(token.token_type, TokenType::Keyword) && token.value == "if" {
                Ok(token)
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
    Ok(Node::boxed(
        IfExpression {
            cond,
            then_val,
            else_ifs,
            final_else,
            digest: Default::default(),
        },
        if_.start,
        end,
        if_.module_id,
    ))
}

fn function_expr(i: TokenSlice) -> PResult<Expr> {
    let fn_tok = opt(fun).parse_next(i)?;
    ignore_whitespace(i);
    let (result, has_arrow) = function_decl.parse_next(i)?;
    if fn_tok.is_none() && !has_arrow {
        let err = KclError::Syntax(KclErrorDetails {
            source_ranges: result.as_source_ranges(),
            message: "Anonymous function requires `fn` before `(`".to_owned(),
        });
        return Err(ErrMode::Cut(err.into()));
    }
    Ok(Expr::FunctionExpression(Box::new(result)))
}

// Looks like
// (arg0, arg1) {
//     const x = arg0 + arg1;
//     return x
// }
fn function_decl(i: TokenSlice) -> PResult<(Node<FunctionExpression>, bool)> {
    fn return_type(i: TokenSlice) -> PResult<FnArgType> {
        colon(i)?;
        ignore_whitespace(i);
        argument_type(i)
    }

    let open = open_paren(i)?;
    let start = open.start;
    let params = parameters(i)?;
    close_paren(i)?;
    ignore_whitespace(i);
    let arrow = opt(big_arrow).parse_next(i)?;
    ignore_whitespace(i);
    // Optional return type.
    let return_type = opt(return_type).parse_next(i)?;
    ignore_whitespace(i);
    open_brace(i)?;
    let body = function_body(i)?;
    let end = close_brace(i)?.end;
    let result = Node::new(
        FunctionExpression {
            params,
            body,
            return_type,
            digest: None,
        },
        start,
        end,
        open.module_id,
    );

    let has_arrow = if let Some(arrow) = arrow {
        ParseContext::warn(CompilationError::with_suggestion(
            arrow.as_source_range(),
            Some(result.as_source_range()),
            "Unnecessary `=>` in function declaration",
            Some(""),
            error::Tag::Unnecessary,
        ));
        true
    } else {
        false
    };

    Ok((result, has_arrow))
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
        literal.map(LiteralIdentifier::Literal),
        identifier.map(Box::new).map(LiteralIdentifier::Identifier),
    ))
    .parse_next(i)?;

    let end = close_bracket.parse_next(i)?.end;
    let computed = matches!(property, LiteralIdentifier::Identifier(_));
    Ok((property, end, computed))
}

/// Get a property of an object, or an index of an array, or a member of a collection.
/// Can be arbitrarily nested, e.g. `people[i]['adam'].age`.
fn member_expression(i: TokenSlice) -> PResult<Node<MemberExpression>> {
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
    let module_id = id.module_id;
    let initial_member_expression = Node::new(
        MemberExpression {
            object: MemberObject::Identifier(Box::new(id)),
            computed,
            property,
            digest: None,
        },
        start,
        end,
        module_id,
    );

    // Each remaining member wraps the current member expression inside another member expression.
    Ok(members
        .into_iter()
        // Take the accumulated member expression from the previous iteration,
        // and use it as the `object` of a new, bigger member expression.
        .fold(initial_member_expression, |accumulated, (property, end, computed)| {
            Node::new(
                MemberExpression {
                    object: MemberObject::MemberExpression(Box::new(accumulated)),
                    computed,
                    property,
                    digest: None,
                },
                start,
                end,
                module_id,
            )
        }))
}

/// Find a noncode node which occurs just after a body item,
/// such that if the noncode item is a comment, it might be an inline comment.
fn noncode_just_after_code(i: TokenSlice) -> PResult<Node<NonCodeNode>> {
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
                let value = match nc.inner.value {
                    // Change block comments to inline, as discussed above
                    NonCodeValue::BlockComment { value, style } => NonCodeValue::NewLineBlockComment { value, style },
                    // Other variants don't need to change.
                    x @ NonCodeValue::InlineComment { .. } => x,
                    x @ NonCodeValue::NewLineBlockComment { .. } => x,
                    x @ NonCodeValue::NewLine => x,
                };
                Node::new(
                    NonCodeNode { value, ..nc.inner },
                    nc.start.saturating_sub(1),
                    nc.end,
                    nc.module_id,
                )
            } else if has_newline {
                // Nothing has to change, a single newline does not need preserving.
                nc
            } else {
                // There's no newline between the body item and comment,
                // so if this is a comment, it must be inline with code.
                let value = match nc.inner.value {
                    // Change block comments to inline, as discussed above
                    NonCodeValue::BlockComment { value, style } => NonCodeValue::InlineComment { value, style },
                    // Other variants don't need to change.
                    x @ NonCodeValue::InlineComment { .. } => x,
                    x @ NonCodeValue::NewLineBlockComment { .. } => x,
                    x @ NonCodeValue::NewLine => x,
                };
                Node::new(NonCodeNode { value, ..nc.inner }, nc.start, nc.end, nc.module_id)
            }
        })
        .map(|nc| Node::new(nc.inner, nc.start.saturating_sub(1), nc.end, nc.module_id))
        .parse_next(i)?;
    Ok(nc)
}

// the large_enum_variant lint below introduces a LOT of code complexity in a
// match!() that's super clean that isn't worth it for the marginal space
// savings. revisit if that's a lie.

#[derive(Debug)]
#[allow(clippy::large_enum_variant)]
enum WithinFunction {
    BodyItem((BodyItem, Option<Node<NonCodeNode>>)),
    NonCode(Node<NonCodeNode>),
}

impl WithinFunction {
    fn is_newline(&self) -> bool {
        match self {
            WithinFunction::NonCode(nc) => nc.value == NonCodeValue::NewLine,
            _ => false,
        }
    }
}

fn body_items_within_function(i: TokenSlice) -> PResult<WithinFunction> {
    // Any of the body item variants, each of which can optionally be followed by a comment.
    // If there is a comment, it may be preceded by whitespace.
    let item = dispatch! {peek(any);
        token if token.declaration_keyword().is_some() || token.visibility_keyword().is_some() =>
            (declaration.map(BodyItem::VariableDeclaration), opt(noncode_just_after_code)).map(WithinFunction::BodyItem),
        token if token.value == "import" && matches!(token.token_type, TokenType::Keyword) =>
            (import_stmt.map(BodyItem::ImportStatement), opt(noncode_just_after_code)).map(WithinFunction::BodyItem),
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
pub fn function_body(i: TokenSlice) -> PResult<Node<Program>> {
    let leading_whitespace_start = alt((
        peek(non_code_node).map(|_| None),
        // Subtract 1 from `t.start` to match behaviour of the old parser.
        // Consider removing the -1 in the future because I think it's inaccurate, but for now,
        // I prefer to match the old parser exactly when I can.
        opt(whitespace).map(|tok| tok.and_then(|t| t.first().map(|t| (t.start.saturating_sub(1), t.module_id)))),
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
        let last_match_was_empty_line = things_within_body.last().map(|wf| wf.is_newline()).unwrap_or(false);

        use winnow::stream::Stream;

        let start = i.checkpoint();
        let len = i.eof_offset();

        let found_ws = ws_with_newline.parse_next(i);

        // The separator whitespace might be important:
        // if it has an empty line, it should be considered a noncode token, because the user
        // deliberately put an empty line there. We should track this and preserve it.
        if let Ok(ref ws_token) = found_ws {
            if ws_token.value.contains("\n\n") {
                things_within_body.push(WithinFunction::NonCode(Node::new(
                    NonCodeNode {
                        value: NonCodeValue::NewLine,
                        digest: None,
                    },
                    ws_token.start,
                    ws_token.end,
                    ws_token.module_id,
                )));
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
                    start = Some((b.start(), b.module_id()));
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
                    start = Some((nc.start, nc.module_id));
                }
                end = nc.end;
                if body.is_empty() {
                    non_code_meta.start_nodes.push(nc);
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
    Ok(Node::new(
        Program {
            body,
            non_code_meta,
            shebang: None,
            digest: None,
        },
        start.0,
        end,
        start.1,
    ))
}

fn import_stmt(i: TokenSlice) -> PResult<BoxNode<ImportStatement>> {
    let import_token = any
        .try_map(|token: Token| {
            if matches!(token.token_type, TokenType::Keyword) && token.value == "import" {
                Ok(token)
            } else {
                Err(KclError::Syntax(KclErrorDetails {
                    source_ranges: token.as_source_ranges(),
                    message: format!("{} is not the 'import' keyword", token.value.as_str()),
                }))
            }
        })
        .context(expected("the 'import' keyword"))
        .parse_next(i)?;
    let start = import_token.start;

    require_whitespace(i)?;

    let items = separated(1.., import_item, comma_sep)
        .parse_next(i)
        .map_err(|e| e.cut())?;

    require_whitespace(i)?;

    any.try_map(|token: Token| {
        if matches!(token.token_type, TokenType::Keyword | TokenType::Word) && token.value == "from" {
            Ok(())
        } else {
            Err(KclError::Syntax(KclErrorDetails {
                source_ranges: token.as_source_ranges(),
                message: format!("{} is not the 'from' keyword", token.value.as_str()),
            }))
        }
    })
    .context(expected("the 'from' keyword"))
    .parse_next(i)
    .map_err(|e| e.cut())?;

    require_whitespace(i)?;

    let path = string_literal(i)?;
    let end = path.end;
    let path_string = match path.inner.value {
        LiteralValue::String(s) => s,
        _ => unreachable!(),
    };
    if path_string
        .chars()
        .any(|c| !c.is_ascii_alphanumeric() && c != '_' && c != '-' && c != '.')
    {
        return Err(ErrMode::Cut(
            KclError::Syntax(KclErrorDetails {
                source_ranges: vec![SourceRange::new(path.start, path.end, path.module_id)],
                message: "import path may only contain alphanumeric characters, underscore, hyphen, and period. Files in other directories are not yet supported.".to_owned(),
            })
            .into(),
        ));
    }
    Ok(Node::boxed(
        ImportStatement {
            items,
            path: path_string,
            raw_path: path.inner.raw,
            digest: None,
        },
        start,
        end,
        import_token.module_id,
    ))
}

fn import_item(i: TokenSlice) -> PResult<Node<ImportItem>> {
    let name = identifier.context(expected("an identifier to import")).parse_next(i)?;
    let start = name.start;
    let module_id = name.module_id;
    let alias = opt(preceded(
        (whitespace, import_as_keyword, whitespace),
        identifier.context(expected("an identifier to alias the import")),
    ))
    .parse_next(i)?;
    let end = if let Some(ref alias) = alias {
        alias.end
    } else {
        name.end
    };
    Ok(Node::new(
        ImportItem {
            name,
            alias,
            digest: None,
        },
        start,
        end,
        module_id,
    ))
}

fn import_as_keyword(i: TokenSlice) -> PResult<Token> {
    any.try_map(|token: Token| {
        if matches!(token.token_type, TokenType::Keyword | TokenType::Word) && token.value == "as" {
            Ok(token)
        } else {
            Err(KclError::Syntax(KclErrorDetails {
                source_ranges: token.as_source_ranges(),
                message: format!("{} is not the 'as' keyword", token.value.as_str()),
            }))
        }
    })
    .context(expected("the 'as' keyword"))
    .parse_next(i)
}

/// Parse a return statement of a user-defined function, e.g. `return x`.
pub fn return_stmt(i: TokenSlice) -> PResult<Node<ReturnStatement>> {
    let ret = any
        .try_map(|token: Token| {
            if matches!(token.token_type, TokenType::Keyword) && token.value == "return" {
                Ok(token)
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
    Ok(Node {
        start: ret.start,
        end: argument.end(),
        module_id: ret.module_id,
        inner: ReturnStatement { argument, digest: None },
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
        bool_value.map(Expr::Literal),
        tag.map(Box::new).map(Expr::TagDeclarator),
        literal.map(Expr::Literal),
        fn_call.map(Box::new).map(Expr::CallExpression),
        fn_call_kw.map(Box::new).map(Expr::CallExpressionKw),
        identifier.map(Box::new).map(Expr::Identifier),
        array,
        object.map(Box::new).map(Expr::ObjectExpression),
        pipe_sub.map(Box::new).map(Expr::PipeSubstitution),
        function_expr,
        if_expr.map(Expr::IfExpression),
        unnecessarily_bracketed,
    ))
    .context(expected("a KCL expression (but not a pipe expression)"))
    .parse_next(i)
}

fn possible_operands(i: TokenSlice) -> PResult<Expr> {
    alt((
        unary_expression.map(Box::new).map(Expr::UnaryExpression),
        bool_value.map(Expr::Literal),
        member_expression.map(Box::new).map(Expr::MemberExpression),
        literal.map(Expr::Literal),
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

/// Parse an item visibility specifier, e.g. export.
fn item_visibility(i: TokenSlice) -> PResult<(ItemVisibility, Token)> {
    any.verify_map(|token: Token| {
        if token.token_type == TokenType::Keyword && token.value == "export" {
            Some((ItemVisibility::Export, token))
        } else {
            None
        }
    })
    .context(expected("item visibility, e.g. 'export'"))
    .parse_next(i)
}

fn declaration_keyword(i: TokenSlice) -> PResult<(VariableKind, Token)> {
    let res = any
        .verify_map(|token: Token| token.declaration_keyword().map(|kw| (kw, token)))
        .parse_next(i)?;
    Ok(res)
}

/// Parse a variable/constant declaration.
fn declaration(i: TokenSlice) -> PResult<BoxNode<VariableDeclaration>> {
    let (visibility, visibility_token) = opt(terminated(item_visibility, whitespace))
        .parse_next(i)?
        .map_or((ItemVisibility::Default, None), |pair| (pair.0, Some(pair.1)));
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
    let (kind, mut start, dec_end, module_id) = if let Some((kind, token)) = &decl_token {
        (*kind, token.start, token.end, token.module_id)
    } else {
        // TODO warn on const
        (VariableKind::Const, id.start, id.end, id.module_id)
    };
    if let Some(token) = visibility_token {
        start = token.start;
    }

    ignore_whitespace(i);

    let val = if kind == VariableKind::Fn {
        let eq = opt(equals).parse_next(i)?;
        ignore_whitespace(i);

        let val = function_decl
            .map(|t| Box::new(t.0))
            .map(Expr::FunctionExpression)
            .context(expected("a KCL function expression, like () { return 1 }"))
            .parse_next(i);

        if let Some(t) = eq {
            let ctxt_end = val.as_ref().map(|e| e.end()).unwrap_or(t.end);
            ParseContext::warn(CompilationError::with_suggestion(
                t.as_source_range(),
                Some(SourceRange::new(id.start, ctxt_end, module_id)),
                "Unnecessary `=` in function declaration",
                Some(""),
                error::Tag::Unnecessary,
            ));
        }

        val
    } else {
        equals(i)?;
        ignore_whitespace(i);

        expression
            .try_map(|val| {
                // Function bodies can be used if and only if declaring a function.
                // Check the 'if' direction:
                if matches!(val, Expr::FunctionExpression(_)) {
                    return Err(KclError::Syntax(KclErrorDetails {
                        source_ranges: vec![SourceRange::new(start, dec_end, module_id)],
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
    Ok(Box::new(Node {
        inner: VariableDeclaration {
            declarations: vec![Node {
                start: id.start,
                end,
                module_id,
                inner: VariableDeclarator {
                    id,
                    init: val,
                    digest: None,
                },
            }],
            visibility,
            kind,
            digest: None,
        },
        start,
        end,
        module_id,
    }))
}

impl TryFrom<Token> for Node<Identifier> {
    type Error = KclError;

    fn try_from(token: Token) -> Result<Self, Self::Error> {
        if token.token_type == TokenType::Word {
            Ok(Node::new(
                Identifier {
                    name: token.value,
                    digest: None,
                },
                token.start,
                token.end,
                token.module_id,
            ))
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
fn identifier(i: TokenSlice) -> PResult<Node<Identifier>> {
    any.try_map(Node::<Identifier>::try_from)
        .context(expected("an identifier, e.g. 'width' or 'myPart'"))
        .parse_next(i)
}

fn sketch_keyword(i: TokenSlice) -> PResult<Node<Identifier>> {
    any.try_map(|token: Token| {
        if token.token_type == TokenType::Type && token.value == "sketch" {
            Ok(Node::new(
                Identifier {
                    name: token.value,
                    digest: None,
                },
                token.start,
                token.end,
                token.module_id,
            ))
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

impl TryFrom<Token> for Node<TagDeclarator> {
    type Error = KclError;

    fn try_from(token: Token) -> Result<Self, Self::Error> {
        if token.token_type == TokenType::Word {
            Ok(Node::new(
                TagDeclarator {
                    // We subtract 1 from the start because the tag starts with a `$`.
                    name: token.value,
                    digest: None,
                },
                token.start - 1,
                token.end,
                token.module_id,
            ))
        } else {
            Err(KclError::Syntax(KclErrorDetails {
                source_ranges: token.as_source_ranges(),
                message: format!("Cannot assign a tag to a reserved keyword: {}", token.value.as_str()),
            }))
        }
    }
}

impl Node<TagDeclarator> {
    fn into_valid_binding_name(self) -> Result<Self, KclError> {
        // Make sure they are not assigning a variable to a stdlib function.
        if crate::std::name_in_stdlib(&self.name) {
            return Err(KclError::Syntax(KclErrorDetails {
                source_ranges: vec![SourceRange::from(&self)],
                message: format!("Cannot assign a tag to a reserved keyword: {}", self.name),
            }));
        }
        Ok(self)
    }
}

/// Parse a Kcl tag that starts with a `$`.
fn tag(i: TokenSlice) -> PResult<Node<TagDeclarator>> {
    dollar.parse_next(i)?;
    let tag_declarator = any
        .try_map(Node::<TagDeclarator>::try_from)
        .context(expected("a tag, e.g. '$seg01' or '$line01'"))
        .parse_next(i)?;
    // Now that we've parsed a tag declarator, verify that it's not a stdlib
    // name.  If it is, stop backtracking.
    tag_declarator
        .into_valid_binding_name()
        .map_err(|e| ErrMode::Cut(ContextError::from(e)))
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

fn unary_expression(i: TokenSlice) -> PResult<Node<UnaryExpression>> {
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
    Ok(Node {
        start: op_token.start,
        end: argument.end(),
        module_id: op_token.module_id,
        inner: UnaryExpression {
            operator,
            argument,
            digest: None,
        },
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
fn binary_expression(i: TokenSlice) -> PResult<Node<BinaryExpression>> {
    // Find the slice of tokens which makes up the binary expression
    let tokens = binary_expression_tokens.parse_next(i)?;

    // Pass the token slice into the specialized math parser, for things like
    // precedence and converting infix operations to an AST.
    let expr = super::math::parse(tokens).map_err(|e| ErrMode::Backtrack(e.into()))?;
    Ok(expr)
}

fn binary_expr_in_parens(i: TokenSlice) -> PResult<Node<BinaryExpression>> {
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
fn expression_stmt(i: TokenSlice) -> PResult<Node<ExpressionStatement>> {
    let val = expression
        .context(expected(
            "an expression (i.e. a value, or an algorithm for calculating one), e.g. 'x + y' or '3' or 'width * 2'",
        ))
        .parse_next(i)?;
    Ok(Node {
        start: val.start(),
        end: val.end(),
        module_id: val.module_id(),
        inner: ExpressionStatement {
            expression: val,
            digest: None,
        },
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

fn colon(i: TokenSlice) -> PResult<Token> {
    TokenType::Colon.parse_from(i)
}

fn equals(i: TokenSlice) -> PResult<Token> {
    one_of((TokenType::Operator, "="))
        .context(expected("the equals operator, ="))
        .parse_next(i)
}

fn question_mark(i: TokenSlice) -> PResult<()> {
    TokenType::QuestionMark.parse_from(i)?;
    Ok(())
}

fn fun(i: TokenSlice) -> PResult<Token> {
    any.try_map(|token: Token| match token.token_type {
        TokenType::Keyword if token.value == "fn" => Ok(token),
        _ => Err(KclError::Syntax(KclErrorDetails {
            source_ranges: token.as_source_ranges(),
            message: format!("expected 'fn', found {}", token.value.as_str(),),
        })),
    })
    .parse_next(i)
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

fn labeled_argument(i: TokenSlice) -> PResult<LabeledArg> {
    separated_pair(identifier, (one_of(TokenType::Colon), opt(whitespace)), expression)
        .map(|(label, arg)| LabeledArg {
            label: label.inner,
            arg,
        })
        .parse_next(i)
}

/// Arguments are passed into a function,
/// preceded by the name of the parameter (the label).
fn labeled_arguments(i: TokenSlice) -> PResult<Vec<LabeledArg>> {
    separated(0.., labeled_argument, comma_sep)
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
        // TODO it is buggy to treat object fields like parameters since the parameters parser assumes a terminating `)`.
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
    let (arg_name, optional, _, type_) = (
        any.verify(|token: &Token| !matches!(token.token_type, TokenType::Brace) || token.value != ")"),
        opt(question_mark),
        opt(whitespace),
        opt((colon, opt(whitespace), argument_type).map(|tup| tup.2)),
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
            let identifier =
                Node::<Identifier>::try_from(arg_name).and_then(Node::<Identifier>::into_valid_binding_name)?;

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

impl Node<Identifier> {
    fn into_valid_binding_name(self) -> Result<Node<Identifier>, KclError> {
        // Make sure they are not assigning a variable to a stdlib function.
        if crate::std::name_in_stdlib(&self.name) {
            return Err(KclError::Syntax(KclErrorDetails {
                source_ranges: vec![SourceRange::from(&self)],
                message: format!("Cannot assign a variable to a reserved keyword: {}", self.name),
            }));
        }
        Ok(self)
    }
}

/// Introduce a new name, which binds some value.
fn binding_name(i: TokenSlice) -> PResult<Node<Identifier>> {
    identifier
        .context(expected("an identifier, which will be the name of some value"))
        .try_map(Node::<Identifier>::into_valid_binding_name)
        .context(expected("an identifier, which will be the name of some value"))
        .parse_next(i)
}

fn typecheck_all(std_fn: Box<dyn StdLibFn>, args: &[&Expr]) -> PResult<()> {
    // Type check the arguments.
    for (i, spec_arg) in std_fn.args(false).iter().enumerate() {
        let Some(arg) = &args.get(i) else {
            // The executor checks the number of arguments, so we don't need to check it here.
            continue;
        };
        typecheck(spec_arg, arg)?;
    }
    Ok(())
}

fn typecheck(spec_arg: &crate::docs::StdLibFnArg, arg: &&Expr) -> PResult<()> {
    match spec_arg.type_.as_ref() {
        "TagNode" => match &arg {
            Expr::Identifier(_) => {
                // These are fine since we want someone to be able to map a variable to a tag declarator.
            }
            Expr::TagDeclarator(tag) => {
                // TODO: Remove this check. It should be redundant.
                tag.clone()
                    .into_valid_binding_name()
                    .map_err(|e| ErrMode::Cut(ContextError::from(e)))?;
            }
            e => {
                return Err(ErrMode::Cut(
                    KclError::Syntax(KclErrorDetails {
                        source_ranges: vec![SourceRange::from(*arg)],
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
                        source_ranges: vec![SourceRange::from(*arg)],
                        message: format!("Expected a tag identifier like `tagName`, found {:?}", e),
                    })
                    .into(),
                ));
            }
        },
        _ => {}
    }
    Ok(())
}

fn fn_call(i: TokenSlice) -> PResult<Node<CallExpression>> {
    let fn_name = identifier(i)?;
    opt(whitespace).parse_next(i)?;
    let _ = terminated(open_paren, opt(whitespace)).parse_next(i)?;
    let args = arguments(i)?;
    if let Some(std_fn) = crate::std::get_stdlib_fn(&fn_name.name) {
        let just_args: Vec<_> = args.iter().collect();
        typecheck_all(std_fn, &just_args)?;
    }
    let end = preceded(opt(whitespace), close_paren).parse_next(i)?.end;

    // This should really be done with resolved names, but we don't have warning support there
    // so we'll hack this in here.
    if fn_name.name == "int" {
        assert_eq!(args.len(), 1);
        let mut arg_str = args[0].recast(&crate::FormatOptions::default(), 0, ExprContext::Other);
        if arg_str.contains('.') && !arg_str.ends_with(".0") {
            arg_str = format!("round({arg_str})");
        }
        ParseContext::warn(CompilationError::with_suggestion(
            SourceRange::new(fn_name.start, end, fn_name.module_id),
            None,
            "`int` function is deprecated. You may not need it at all. If you need to round, consider `round`, `ceil`, or `floor`.",
            Some(arg_str),
            error::Tag::Deprecated,
        ));
    }

    Ok(Node {
        start: fn_name.start,
        end,
        module_id: fn_name.module_id,
        inner: CallExpression {
            callee: fn_name,
            arguments: args,
            digest: None,
        },
    })
}

fn fn_call_kw(i: TokenSlice) -> PResult<Node<CallExpressionKw>> {
    let fn_name = identifier(i)?;
    opt(whitespace).parse_next(i)?;
    let _ = open_paren.parse_next(i)?;
    ignore_whitespace(i);

    let initial_unlabeled_arg = opt((expression, comma, opt(whitespace)).map(|(arg, _, _)| arg)).parse_next(i)?;
    let args = labeled_arguments(i)?;
    ignore_whitespace(i);
    let end = close_paren.parse_next(i)?.end;

    Ok(Node {
        start: fn_name.start,
        end,
        module_id: fn_name.module_id,
        inner: CallExpressionKw {
            callee: fn_name,
            unlabeled: initial_unlabeled_arg,
            arguments: args,
            digest: None,
        },
    })
}

#[cfg(test)]
mod tests {
    use itertools::Itertools;
    use pretty_assertions::assert_eq;

    use super::*;
    use crate::{
        parsing::ast::types::{BodyItem, Expr, VariableKind},
        ModuleId,
    };

    fn assert_reserved(word: &str) {
        // Try to use it as a variable name.
        let code = format!(r#"{} = 0"#, word);
        let result = crate::parsing::top_level_parse(code.as_str());
        let err = &result.unwrap_errs()[0];
        // Which token causes the error may change.  In "return = 0", for
        // example, "return" is the problem.
        assert!(
            err.message.starts_with("Unexpected token: ")
                || err
                    .message
                    .starts_with("Cannot assign a variable to a reserved keyword: "),
            "Error message is: {}",
            err.message,
        );
    }

    #[test]
    fn reserved_words() {
        // Since these are stored in a set, we sort to make the tests
        // deterministic.
        for word in crate::parsing::token::RESERVED_WORDS.keys().sorted() {
            assert_reserved(word);
        }
        assert_reserved("import");
    }

    #[test]
    fn parse_args() {
        for (i, (test, expected_len)) in [("someVar", 1), ("5, 3", 2), (r#""a""#, 1)].into_iter().enumerate() {
            let tokens = crate::parsing::token::lexer(test, ModuleId::default()).unwrap();
            let actual = match arguments.parse(&tokens) {
                Ok(x) => x,
                Err(e) => panic!("Failed test {i}, could not parse function arguments from \"{test}\": {e:?}"),
            };
            assert_eq!(actual.len(), expected_len, "failed test {i}");
        }
    }

    #[test]
    fn weird_program_unclosed_paren() {
        let tokens = crate::parsing::token::lexer("fn firstPrime(", ModuleId::default()).unwrap();
        let last = tokens.last().unwrap();
        let err: super::error::ErrorKind = program.parse(&tokens).unwrap_err().into();
        let err = err.unwrap_compile_error();
        assert_eq!(vec![err.source_range], last.as_source_ranges());
        // TODO: Better comment. This should explain the compiler expected ) because the user had started declaring the function's parameters.
        // Part of https://github.com/KittyCAD/modeling-app/issues/784
        assert_eq!(err.message, "Unexpected end of file. The compiler expected )");
    }

    #[test]
    fn weird_program_just_a_pipe() {
        let tokens = crate::parsing::token::lexer("|", ModuleId::default()).unwrap();
        let err: super::error::ErrorKind = program.parse(&tokens).unwrap_err().into();
        let err = err.unwrap_compile_error();
        assert_eq!(vec![err.source_range], vec![SourceRange([0, 1, 0])]);
        assert_eq!(err.message, "Unexpected token: |");
    }

    #[test]
    fn parse_binary_expressions() {
        for (i, test_program) in ["1 + 2 + 3"].into_iter().enumerate() {
            let tokens = crate::parsing::token::lexer(test_program, ModuleId::default()).unwrap();
            let mut slice = tokens.as_slice();
            let _actual = match binary_expression.parse_next(&mut slice) {
                Ok(x) => x,
                Err(e) => panic!("Failed test {i}, could not parse binary expressions from \"{test_program}\": {e:?}"),
            };
        }
    }

    #[test]
    fn test_vardec_no_keyword() {
        let tokens = crate::parsing::token::lexer("x = 4", ModuleId::default()).unwrap();
        let vardec = declaration(&mut tokens.as_slice()).unwrap();
        assert_eq!(vardec.inner.kind, VariableKind::Const);
        let vardec = vardec.declarations.first().unwrap();
        assert_eq!(vardec.id.name, "x");
        let Expr::Literal(init_val) = &vardec.init else {
            panic!("weird init value")
        };
        assert_eq!(init_val.raw, "4");
    }

    #[test]
    fn test_negative_operands() {
        let tokens = crate::parsing::token::lexer("-leg2", ModuleId::default()).unwrap();
        let _s = operand.parse_next(&mut tokens.as_slice()).unwrap();
    }

    #[test]
    fn test_comments_in_function1() {
        let test_program = r#"() {
            // comment 0
            const a = 1
            // comment 1
            const b = 2
            // comment 2
            return 1
        }"#;
        let tokens = crate::parsing::token::lexer(test_program, ModuleId::default()).unwrap();
        let mut slice = tokens.as_slice();
        let expr = function_decl.map(|t| t.0).parse_next(&mut slice).unwrap();
        assert_eq!(expr.params, vec![]);
        let comment_start = expr.body.non_code_meta.start_nodes.first().unwrap();
        let comment0 = &expr.body.non_code_meta.non_code_nodes.get(&0).unwrap()[0];
        let comment1 = &expr.body.non_code_meta.non_code_nodes.get(&1).unwrap()[0];
        assert_eq!(comment_start.value(), "comment 0");
        assert_eq!(comment0.value(), "comment 1");
        assert_eq!(comment1.value(), "comment 2");
    }

    #[test]
    fn test_comments_in_function2() {
        let test_program = r#"() {
  const yo = { a = { b = { c = '123' } } } /* block
comment */
}"#;
        let tokens = crate::parsing::token::lexer(test_program, ModuleId::default()).unwrap();
        let mut slice = tokens.as_slice();
        let expr = function_decl.map(|t| t.0).parse_next(&mut slice).unwrap();
        let comment0 = &expr.body.non_code_meta.non_code_nodes.get(&0).unwrap()[0];
        assert_eq!(comment0.value(), "block\ncomment");
    }

    #[test]
    fn test_comment_at_start_of_program() {
        let test_program = r#"
/* comment at start */

const mySk1 = startSketchAt([0, 0])"#;
        let tokens = crate::parsing::token::lexer(test_program, ModuleId::default()).unwrap();
        let program = program.parse(&tokens).unwrap();
        let mut starting_comments = program.inner.non_code_meta.start_nodes;
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
        let tokens = crate::parsing::token::lexer(r#"const x = y() |> /*hi*/ z(%)"#, ModuleId::default()).unwrap();
        let mut body = program.parse(&tokens).unwrap().inner.body;
        let BodyItem::VariableDeclaration(mut item) = body.remove(0) else {
            panic!("expected vardec");
        };
        let val = item.declarations.remove(0).inner.init;
        let Expr::PipeExpression(pipe) = val else {
            panic!("expected pipe");
        };
        let mut noncode = pipe.inner.non_code_meta;
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
        let test_program = r#"() {
            return sg
            return sg
          }"#;
        let tokens = crate::parsing::token::lexer(test_program, ModuleId::default()).unwrap();
        let mut slice = tokens.as_slice();
        let _expr = function_decl.parse_next(&mut slice).unwrap();
    }

    #[test]
    fn test_empty_lines_in_function() {
        let test_program = "() {

                return 2
            }";
        let module_id = ModuleId::from_usize(1);
        let tokens = crate::parsing::token::lexer(test_program, module_id).unwrap();
        let mut slice = tokens.as_slice();
        let expr = function_decl.map(|t| t.0).parse_next(&mut slice).unwrap();
        assert_eq!(
            expr,
            Node::new(
                FunctionExpression {
                    params: Default::default(),
                    body: Node::new(
                        Program {
                            body: vec![BodyItem::ReturnStatement(Node::new(
                                ReturnStatement {
                                    argument: Expr::Literal(Box::new(Node::new(
                                        Literal {
                                            value: 2u32.into(),
                                            raw: "2".to_owned(),
                                            digest: None,
                                        },
                                        29,
                                        30,
                                        module_id,
                                    ))),
                                    digest: None,
                                },
                                22,
                                30,
                                module_id,
                            ))],
                            non_code_meta: NonCodeMeta {
                                non_code_nodes: Default::default(),
                                start_nodes: vec![Node::new(
                                    NonCodeNode {
                                        value: NonCodeValue::NewLine,
                                        digest: None
                                    },
                                    4,
                                    22,
                                    module_id,
                                )],
                                digest: None,
                            },
                            shebang: None,
                            digest: None,
                        },
                        4,
                        44,
                        module_id,
                    ),
                    return_type: None,
                    digest: None,
                },
                0,
                44,
                module_id,
            )
        );
    }

    #[test]
    fn inline_comment_pipe_expression() {
        let test_input = r#"a('XY')
        |> b(%)
        |> c(%) // inline-comment
        |> d(%)"#;

        let tokens = crate::parsing::token::lexer(test_input, ModuleId::default()).unwrap();
        let mut slice = tokens.as_slice();
        let Node {
            inner: PipeExpression {
                body, non_code_meta, ..
            },
            ..
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
  const yo = { a = { b = { c = '123' } } } /* block
  comment */

  const key = 'c'
  // this is also a comment
  return things
"#;

        let module_id = ModuleId::default();
        let tokens = crate::parsing::token::lexer(test_program, module_id).unwrap();
        let Program { non_code_meta, .. } = function_body.parse(&tokens).unwrap().inner;
        assert_eq!(
            vec![Node::new(
                NonCodeNode {
                    value: NonCodeValue::BlockComment {
                        value: "this is a comment".to_owned(),
                        style: CommentStyle::Line
                    },
                    digest: None,
                },
                0,
                20,
                module_id,
            )],
            non_code_meta.start_nodes,
        );

        assert_eq!(
            Some(&vec![
                Node::new(
                    NonCodeNode {
                        value: NonCodeValue::InlineComment {
                            value: "block\n  comment".to_owned(),
                            style: CommentStyle::Block
                        },
                        digest: None,
                    },
                    63,
                    85,
                    module_id,
                ),
                Node::new(
                    NonCodeNode {
                        value: NonCodeValue::NewLine,
                        digest: None,
                    },
                    85,
                    89,
                    module_id,
                )
            ]),
            non_code_meta.non_code_nodes.get(&0),
        );

        assert_eq!(
            Some(&vec![Node::new(
                NonCodeNode {
                    value: NonCodeValue::BlockComment {
                        value: "this is also a comment".to_owned(),
                        style: CommentStyle::Line
                    },
                    digest: None,
                },
                106,
                132,
                module_id,
            )]),
            non_code_meta.non_code_nodes.get(&1),
        );
    }

    #[test]
    fn inline_block_comments() {
        let test_program = r#"const yo = 3 /* block
  comment */
  return 1"#;

        let tokens = crate::parsing::token::lexer(test_program, ModuleId::default()).unwrap();
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
        let tokens = crate::parsing::token::lexer(input, ModuleId::default()).unwrap();
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
            let tokens = crate::parsing::token::lexer(input, ModuleId::default()).unwrap();
            let _actual = match expression.parse(&tokens) {
                Ok(x) => x,
                Err(e) => panic!("{e:?}"),
            };
        }
    }

    #[test]
    fn test_arithmetic() {
        let input = "1 * (2 - 3)";
        let tokens = crate::parsing::token::lexer(input, ModuleId::default()).unwrap();
        // The RHS should be a binary expression.
        let actual = binary_expression.parse(&tokens).unwrap();
        assert_eq!(actual.operator, BinaryOperator::Mul);
        let BinaryPart::BinaryExpression(rhs) = actual.inner.right else {
            panic!("Expected RHS to be another binary expression");
        };
        assert_eq!(rhs.operator, BinaryOperator::Sub);
        match &rhs.right {
            BinaryPart::Literal(lit) => {
                assert!(lit.start == 9 && lit.end == 10);
                assert!(lit.value == 3u32.into() && &lit.raw == "3" && lit.digest.is_none());
            }
            _ => panic!(),
        }
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
            let tokens = crate::parsing::token::lexer(test_input, ModuleId::default()).unwrap();
            let mut actual = match declaration.parse(&tokens) {
                Err(e) => panic!("Could not parse test {i}: {e:#?}"),
                Ok(a) => a,
            };
            let Expr::BinaryExpression(_expr) = actual.declarations.remove(0).inner.init else {
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
            let tokens = crate::parsing::token::lexer(test_input, ModuleId::default()).unwrap();
            let _actual = match declaration.parse(&tokens) {
                Err(e) => panic!("Could not parse test {i}: {e:#?}"),
                Ok(a) => a,
            };
        }
    }

    #[test]
    fn test_nested_arithmetic() {
        let input = "1 * ((2 - 3) / 4)";
        let tokens = crate::parsing::token::lexer(input, ModuleId::default()).unwrap();
        // The RHS should be a binary expression.
        let outer = binary_expression.parse(&tokens).unwrap();
        assert_eq!(outer.operator, BinaryOperator::Mul);
        let BinaryPart::BinaryExpression(middle) = outer.inner.right else {
            panic!("Expected RHS to be another binary expression");
        };

        assert_eq!(middle.operator, BinaryOperator::Div);
        let BinaryPart::BinaryExpression(inner) = middle.inner.left else {
            panic!("expected nested binary expression");
        };
        assert_eq!(inner.operator, BinaryOperator::Sub);
    }

    #[test]
    fn binary_expression_ignores_whitespace() {
        let tests = ["1 - 2", "1- 2", "1 -2", "1-2"];
        for test in tests {
            let tokens = crate::parsing::token::lexer(test, ModuleId::default()).unwrap();
            let actual = binary_expression.parse(&tokens).unwrap();
            assert_eq!(actual.operator, BinaryOperator::Sub);
            let BinaryPart::Literal(left) = actual.inner.left else {
                panic!("should be expression");
            };
            assert_eq!(left.value, 1u32.into());
            let BinaryPart::Literal(right) = actual.inner.right else {
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
        let tokens = crate::parsing::token::lexer(test_program, ModuleId::default()).unwrap();
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
            let tokens = crate::parsing::token::lexer(test_program, ModuleId::default()).unwrap();
            let actual = pipe_expression.parse(&tokens);
            assert!(actual.is_ok(), "could not parse test {i}, '{test_program}'");
            let actual = actual.unwrap();
            let n = actual.non_code_meta.non_code_nodes.len();
            assert_eq!(n, 1, "expected one comment in pipe expression but found {n}",)
        }
    }

    #[test]
    fn comments() {
        let module_id = ModuleId::from_usize(1);
        for (i, (test_program, expected)) in [
            (
                "//hi",
                Node::new(
                    NonCodeNode {
                        value: NonCodeValue::BlockComment {
                            value: "hi".to_owned(),
                            style: CommentStyle::Line,
                        },
                        digest: None,
                    },
                    0,
                    4,
                    module_id,
                ),
            ),
            (
                "/*hello*/",
                Node::new(
                    NonCodeNode {
                        value: NonCodeValue::BlockComment {
                            value: "hello".to_owned(),
                            style: CommentStyle::Block,
                        },
                        digest: None,
                    },
                    0,
                    9,
                    module_id,
                ),
            ),
            (
                "/* hello */",
                Node::new(
                    NonCodeNode {
                        value: NonCodeValue::BlockComment {
                            value: "hello".to_owned(),
                            style: CommentStyle::Block,
                        },
                        digest: None,
                    },
                    0,
                    11,
                    module_id,
                ),
            ),
            (
                "/* \nhello */",
                Node::new(
                    NonCodeNode {
                        value: NonCodeValue::BlockComment {
                            value: "hello".to_owned(),
                            style: CommentStyle::Block,
                        },
                        digest: None,
                    },
                    0,
                    12,
                    module_id,
                ),
            ),
            (
                "
                /* hello */",
                Node::new(
                    NonCodeNode {
                        value: NonCodeValue::BlockComment {
                            value: "hello".to_owned(),
                            style: CommentStyle::Block,
                        },
                        digest: None,
                    },
                    0,
                    29,
                    module_id,
                ),
            ),
            (
                // Empty line with trailing whitespace
                "
  
                /* hello */",
                Node::new(
                    NonCodeNode {
                        value: NonCodeValue::NewLineBlockComment {
                            value: "hello".to_owned(),
                            style: CommentStyle::Block,
                        },
                        digest: None,
                    },
                    0,
                    32,
                    module_id,
                ),
            ),
            (
                // Empty line, no trailing whitespace
                "

                /* hello */",
                Node::new(
                    NonCodeNode {
                        value: NonCodeValue::NewLineBlockComment {
                            value: "hello".to_owned(),
                            style: CommentStyle::Block,
                        },
                        digest: None,
                    },
                    0,
                    30,
                    module_id,
                ),
            ),
            (
                r#"/* block
                    comment */"#,
                Node::new(
                    NonCodeNode {
                        value: NonCodeValue::BlockComment {
                            value: "block\n                    comment".to_owned(),
                            style: CommentStyle::Block,
                        },
                        digest: None,
                    },
                    0,
                    39,
                    module_id,
                ),
            ),
        ]
        .into_iter()
        .enumerate()
        {
            let tokens = crate::parsing::token::lexer(test_program, module_id).unwrap();
            let actual = non_code_node.parse(&tokens);
            assert!(actual.is_ok(), "could not parse test {i}: {actual:#?}");
            let actual = actual.unwrap();
            assert_eq!(actual, expected, "failed test {i}");
        }
    }

    #[test]
    fn recognize_invalid_params() {
        let test_fn = "(let) => { return 1 }";
        let module_id = ModuleId::from_usize(2);
        let tokens = crate::parsing::token::lexer(test_fn, module_id).unwrap();
        let err = function_decl.parse(&tokens).unwrap_err().into_inner();
        let cause = err.cause.unwrap();
        // This is the token `let`
        assert_eq!(
            cause.source_ranges(),
            vec![SourceRange::new(1, 4, ModuleId::from_usize(2))]
        );
        assert_eq!(cause.message(), "Cannot assign a variable to a reserved keyword: let");
    }

    #[test]
    fn comment_in_string() {
        let string_literal = r#""
           // a comment
             ""#;
        let tokens = crate::parsing::token::lexer(string_literal, ModuleId::default()).unwrap();
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
        let tokens = crate::parsing::token::lexer(test_program, ModuleId::default()).unwrap();
        let mut slice = &tokens[..];
        let _actual = pipe_expression.parse_next(&mut slice).unwrap();
        assert_eq!(slice[0].token_type, TokenType::Whitespace);
    }

    #[test]
    fn test_pipes_on_pipes() {
        let test_program = include_str!("../../../tests/executor/inputs/pipes_on_pipes.kcl");
        let tokens = crate::parsing::token::lexer(test_program, ModuleId::default()).unwrap();
        let _ = run_parser(&mut &*tokens).unwrap();
    }

    #[test]
    fn test_cube() {
        let test_program = include_str!("../../../tests/executor/inputs/cube.kcl");
        let tokens = crate::parsing::token::lexer(test_program, ModuleId::default()).unwrap();
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
            let tokens = crate::parsing::token::lexer(input, ModuleId::default()).unwrap();
            let actual = parameters.parse(&tokens);
            assert!(actual.is_ok(), "could not parse test {i}");
            let actual_ids: Vec<_> = actual.unwrap().into_iter().map(|p| p.identifier.inner.name).collect();
            assert_eq!(actual_ids, expected);
        }
    }

    #[test]
    fn test_user_function() {
        let input = "() {
            return 2
        }";

        let tokens = crate::parsing::token::lexer(input, ModuleId::default()).unwrap();
        let actual = function_decl.parse(&tokens);
        assert!(actual.is_ok(), "could not parse test function");
    }

    #[test]
    fn test_declaration() {
        let tests = ["const myVar = 5", "const myVar=5", "const myVar =5", "const myVar= 5"];
        for test in tests {
            // Run the original parser
            let tokens = crate::parsing::token::lexer(test, ModuleId::default()).unwrap();
            let mut expected_body = crate::parsing::parse_tokens(tokens.clone()).unwrap().inner.body;
            assert_eq!(expected_body.len(), 1);
            let BodyItem::VariableDeclaration(expected) = expected_body.pop().unwrap() else {
                panic!("Expected variable declaration");
            };

            // Run the second parser, check it matches the first parser.
            let mut actual = declaration.parse(&tokens).unwrap();
            assert_eq!(expected, actual);

            // Inspect its output in more detail.
            assert_eq!(actual.inner.kind, VariableKind::Const);
            assert_eq!(actual.start, 0);
            assert_eq!(actual.declarations.len(), 1);
            let decl = actual.declarations.pop().unwrap();
            assert_eq!(decl.id.name, "myVar");
            let Expr::Literal(value) = decl.inner.init else {
                panic!("value should be a literal")
            };
            assert_eq!(value.end, test.len());
            assert_eq!(value.raw, "5");
        }
    }

    #[test]
    fn test_math_parse() {
        let module_id = ModuleId::default();
        let actual = crate::parsing::parse_str(r#"5 + "a""#, module_id).unwrap().inner.body;
        let expr = Node::boxed(
            BinaryExpression {
                operator: BinaryOperator::Add,
                left: BinaryPart::Literal(Box::new(Node::new(
                    Literal {
                        value: 5u32.into(),
                        raw: "5".to_owned(),
                        digest: None,
                    },
                    0,
                    1,
                    module_id,
                ))),
                right: BinaryPart::Literal(Box::new(Node::new(
                    Literal {
                        value: "a".into(),
                        raw: r#""a""#.to_owned(),
                        digest: None,
                    },
                    4,
                    7,
                    module_id,
                ))),
                digest: None,
            },
            0,
            7,
            module_id,
        );
        let expected = vec![BodyItem::ExpressionStatement(Node::new(
            ExpressionStatement {
                expression: Expr::BinaryExpression(expr),
                digest: None,
            },
            0,
            7,
            module_id,
        ))];
        assert_eq!(expected, actual);
    }

    #[test]
    fn test_is_code_token() {
        let module_id = ModuleId::default();
        let tokens = [
            Token {
                token_type: TokenType::Word,
                start: 0,
                end: 3,
                module_id,
                value: "log".to_string(),
            },
            Token {
                token_type: TokenType::Brace,
                start: 3,
                end: 4,
                module_id,
                value: "(".to_string(),
            },
            Token {
                token_type: TokenType::Number,
                start: 4,
                end: 5,
                module_id,
                value: "5".to_string(),
            },
            Token {
                token_type: TokenType::Comma,
                start: 5,
                end: 6,
                module_id,
                value: ",".to_string(),
            },
            Token {
                token_type: TokenType::String,
                start: 7,
                end: 14,
                module_id,
                value: "\"hello\"".to_string(),
            },
            Token {
                token_type: TokenType::Word,
                start: 16,
                end: 27,
                module_id,
                value: "aIdentifier".to_string(),
            },
            Token {
                token_type: TokenType::Brace,
                start: 27,
                end: 28,
                module_id,
                value: ")".to_string(),
            },
        ];
        for (i, token) in tokens.iter().enumerate() {
            assert!(token.is_code_token(), "failed test {i}: {token:?}")
        }
    }

    #[test]
    fn test_is_not_code_token() {
        let module_id = ModuleId::default();
        let tokens = [
            Token {
                token_type: TokenType::Whitespace,
                start: 6,
                end: 7,
                module_id,
                value: " ".to_string(),
            },
            Token {
                token_type: TokenType::BlockComment,
                start: 28,
                end: 30,
                module_id,
                value: "/* abte */".to_string(),
            },
            Token {
                token_type: TokenType::LineComment,
                start: 30,
                end: 33,
                module_id,
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
        let module_id = ModuleId::default();
        let result = crate::parsing::parse_str(code, module_id).unwrap();
        let expected_result = Node::new(
            Program {
                body: vec![BodyItem::ExpressionStatement(Node::new(
                    ExpressionStatement {
                        expression: Expr::BinaryExpression(Node::boxed(
                            BinaryExpression {
                                left: BinaryPart::Literal(Box::new(Node::new(
                                    Literal {
                                        value: 5u32.into(),
                                        raw: "5".to_string(),
                                        digest: None,
                                    },
                                    0,
                                    1,
                                    module_id,
                                ))),
                                operator: BinaryOperator::Add,
                                right: BinaryPart::Literal(Box::new(Node::new(
                                    Literal {
                                        value: 6u32.into(),
                                        raw: "6".to_string(),
                                        digest: None,
                                    },
                                    3,
                                    4,
                                    module_id,
                                ))),
                                digest: None,
                            },
                            0,
                            4,
                            module_id,
                        )),
                        digest: None,
                    },
                    0,
                    4,
                    module_id,
                ))],
                shebang: None,
                non_code_meta: NonCodeMeta::default(),
                digest: None,
            },
            0,
            4,
            module_id,
        );

        assert_eq!(result, expected_result);
    }

    #[test]
    fn test_empty_file() {
        let some_program_string = r#""#;
        let result = crate::parsing::top_level_parse(some_program_string);
        assert!(result.is_ok());
    }

    #[track_caller]
    fn assert_no_err(p: &str) -> (Node<Program>, Vec<CompilationError>) {
        let result = crate::parsing::top_level_parse(p);
        let result = result.0.unwrap();
        assert!(result.1.is_empty(), "found: {:#?}", result.1);
        (result.0.unwrap(), result.1)
    }

    #[track_caller]
    fn assert_err(p: &str, msg: &str, src: [usize; 2]) {
        let result = crate::parsing::top_level_parse(p);
        let err = &result.unwrap_errs()[0];
        assert_eq!(err.message, msg);
        assert_eq!(err.source_range.start(), src[0]);
        assert_eq!(err.source_range.end(), src[1]);
    }

    #[track_caller]
    fn assert_err_contains(p: &str, expected: &str) {
        let result = crate::parsing::top_level_parse(p);
        let err = &result.unwrap_errs()[0].message;
        assert!(err.contains(expected), "actual='{err}'");
    }

    #[test]
    fn test_parse_half_pipe_small() {
        assert_err_contains(
            "const secondExtrude = startSketchOn('XY')
  |> startProfileAt([0,0], %)
  |",
            "Unexpected token: |",
        );
    }

    #[test]
    fn test_parse_member_expression_double_nested_braces() {
        let code = r#"const prop = yo["one"][two]"#;
        crate::parsing::top_level_parse(code).unwrap();
    }

    #[test]
    fn test_parse_member_expression_binary_expression_period_number_first() {
        let code = r#"const obj = { a: 1, b: 2 }
const height = 1 - obj.a"#;
        crate::parsing::top_level_parse(code).unwrap();
    }

    #[test]
    fn test_parse_member_expression_allowed_type_in_expression() {
        let code = r#"const obj = { thing: 1 }
startSketchOn(obj.sketch)"#;

        crate::parsing::top_level_parse(code).unwrap();
    }

    #[test]
    fn test_parse_member_expression_binary_expression_brace_number_first() {
        let code = r#"const obj = { a: 1, b: 2 }
const height = 1 - obj["a"]"#;
        crate::parsing::top_level_parse(code).unwrap();
    }

    #[test]
    fn test_parse_member_expression_binary_expression_brace_number_second() {
        let code = r#"const obj = { a: 1, b: 2 }
const height = obj["a"] - 1"#;
        crate::parsing::top_level_parse(code).unwrap();
    }

    #[test]
    fn test_parse_member_expression_binary_expression_in_array_number_first() {
        let code = r#"const obj = { a: 1, b: 2 }
const height = [1 - obj["a"], 0]"#;
        crate::parsing::top_level_parse(code).unwrap();
    }

    #[test]
    fn test_parse_member_expression_binary_expression_in_array_number_second() {
        let code = r#"const obj = { a: 1, b: 2 }
const height = [obj["a"] - 1, 0]"#;
        crate::parsing::top_level_parse(code).unwrap();
    }

    #[test]
    fn test_parse_member_expression_binary_expression_in_array_number_second_missing_space() {
        let code = r#"const obj = { a: 1, b: 2 }
const height = [obj["a"] -1, 0]"#;
        crate::parsing::top_level_parse(code).unwrap();
    }

    #[test]
    fn test_anon_fn() {
        crate::parsing::top_level_parse("foo(42, fn(x) { return x + 1 })").unwrap();
    }

    #[test]
    fn test_anon_fn_no_fn() {
        assert_err_contains("foo(42, (x) { return x + 1 })", "Anonymous function requires `fn`");
    }

    #[test]
    fn test_parse_half_pipe() {
        let code = "const height = 10

const firstExtrude = startSketchOn('XY')
  |> startProfileAt([0,0], %)
  |> line([0, 8], %)
  |> line([20, 0], %)
  |> line([0, -8], %)
  |> close(%)
  |> extrude(2, %)

const secondExtrude = startSketchOn('XY')
  |> startProfileAt([0,0], %)
  |";
        assert_err_contains(code, "Unexpected token: |");
    }

    #[test]
    fn test_parse_greater_bang() {
        assert_err(">!", "Unexpected token: >", [0, 1]);
    }

    #[test]
    fn test_parse_z_percent_parens() {
        assert_err("z%)", "Unexpected token: %", [1, 2]);
    }

    #[test]
    fn test_parse_parens_unicode() {
        let result = crate::parsing::top_level_parse("(ޜ");
        let KclError::Lexical(details) = result.0.unwrap_err() else {
            panic!();
        };
        // TODO: Better errors when program cannot tokenize.
        // https://github.com/KittyCAD/modeling-app/issues/696
        assert_eq!(details.message, "found unknown token 'ޜ'");
        assert_eq!(details.source_ranges[0].start(), 1);
        assert_eq!(details.source_ranges[0].end(), 2);
    }

    #[test]
    fn test_parse_negative_in_array_binary_expression() {
        let code = r#"const leg1 = 5
const thickness = 0.56

const bracket = [-leg2 + thickness, 0]
"#;
        crate::parsing::top_level_parse(code).unwrap();
    }

    #[test]
    fn test_parse_nested_open_brackets() {
        crate::parsing::top_level_parse(
            r#"
z(-[["#,
        )
        .unwrap_errs();
    }

    #[test]
    fn test_parse_weird_new_line_function() {
        assert_err(
            r#"z
(--#"#,
            "Unexpected token: (",
            [2, 3],
        );
    }

    #[test]
    fn test_parse_weird_lots_of_fancy_brackets() {
        assert_err(r#"zz({{{{{{{{)iegAng{{{{{{{##"#, "Unexpected token: (", [2, 3]);
    }

    #[test]
    fn test_parse_weird_close_before_open() {
        assert_err_contains(
            r#"fn)n
e
["#,
            "expected whitespace, found ')' which is brace",
        );
    }

    #[test]
    fn test_parse_weird_close_before_nada() {
        assert_err_contains(r#"fn)n-"#, "expected whitespace, found ')' which is brace");
    }

    #[test]
    fn test_parse_weird_lots_of_slashes() {
        assert_err_contains(
            r#"J///////////o//+///////////P++++*++++++P///////˟
++4"#,
            "Unexpected token: +",
        );
    }

    #[test]
    fn test_optional_param_order() {
        for (i, (params, expect_ok)) in [
            (
                vec![Parameter {
                    identifier: Node::no_src(Identifier {
                        name: "a".to_owned(),
                        digest: None,
                    }),
                    type_: None,
                    optional: true,
                    digest: None,
                }],
                true,
            ),
            (
                vec![Parameter {
                    identifier: Node::no_src(Identifier {
                        name: "a".to_owned(),
                        digest: None,
                    }),
                    type_: None,
                    optional: false,
                    digest: None,
                }],
                true,
            ),
            (
                vec![
                    Parameter {
                        identifier: Node::no_src(Identifier {
                            name: "a".to_owned(),
                            digest: None,
                        }),
                        type_: None,
                        optional: false,
                        digest: None,
                    },
                    Parameter {
                        identifier: Node::no_src(Identifier {
                            name: "b".to_owned(),
                            digest: None,
                        }),
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
                        identifier: Node::no_src(Identifier {
                            name: "a".to_owned(),
                            digest: None,
                        }),
                        type_: None,
                        optional: true,
                        digest: None,
                    },
                    Parameter {
                        identifier: Node::no_src(Identifier {
                            name: "b".to_owned(),
                            digest: None,
                        }),
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
        assert_err(
            r#"const let = "thing""#,
            "Cannot assign a variable to a reserved keyword: let",
            [6, 9],
        );
    }

    #[test]
    fn test_error_keyword_in_fn_name() {
        assert_err(
            r#"fn let = () {}"#,
            "Cannot assign a variable to a reserved keyword: let",
            [3, 6],
        );
    }

    #[test]
    fn test_error_stdlib_in_fn_name() {
        assert_err(
            r#"fn cos = () => {
            return 1
        }"#,
            "Cannot assign a variable to a reserved keyword: cos",
            [3, 6],
        );
    }

    #[test]
    fn test_error_keyword_in_fn_args() {
        assert_err(
            r#"fn thing = (let) => {
    return 1
}"#,
            "Cannot assign a variable to a reserved keyword: let",
            [12, 15],
        )
    }

    #[test]
    fn test_error_stdlib_in_fn_args() {
        assert_err(
            r#"fn thing = (cos) => {
    return 1
}"#,
            "Cannot assign a variable to a reserved keyword: cos",
            [12, 15],
        )
    }

    #[test]
    fn zero_param_function() {
        let code = r#"
        fn firstPrimeNumber = () => {
            return 2
        }
        firstPrimeNumber()
        "#;
        let _ast = crate::parsing::top_level_parse(code).unwrap();
    }

    #[test]
    fn array() {
        let program = r#"[1, 2, 3]"#;
        let module_id = ModuleId::default();
        let tokens = crate::parsing::token::lexer(program, module_id).unwrap();
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
        let module_id = ModuleId::default();
        let tokens = crate::parsing::token::lexer(program, module_id).unwrap();
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
        let module_id = ModuleId::default();
        let tokens = crate::parsing::token::lexer(program, module_id).unwrap();
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
        let module_id = ModuleId::default();
        let tokens = crate::parsing::token::lexer(some_program_string, module_id).unwrap();
        let mut sl: &[Token] = &tokens;
        let _res = if_expr(&mut sl).unwrap();
    }

    #[test]
    fn basic_else_if() {
        let some_program_string = "else if true {
            4
        }";
        let module_id = ModuleId::default();
        let tokens = crate::parsing::token::lexer(some_program_string, module_id).unwrap();
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
        let module_id = ModuleId::default();
        let tokens = crate::parsing::token::lexer(some_program_string, module_id).unwrap();
        let mut sl: &[Token] = &tokens;
        let _res = if_expr(&mut sl).unwrap();
    }

    #[test]
    fn test_keyword_ok_in_fn_args_return() {
        let some_program_string = r#"fn thing(param) {
    return true
}

thing(false)
"#;
        crate::parsing::top_level_parse(some_program_string).unwrap();
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
            assert_err(
                &some_program_string,
                "Expected a `fn` variable kind, found: `const`",
                [0, name.len()],
            );
        }
    }

    #[test]
    fn test_error_define_var_as_function() {
        // TODO: https://github.com/KittyCAD/modeling-app/issues/784
        // Improve this error message.
        // It should say that the compiler is expecting a function expression on the RHS.
        assert_err(r#"fn thing = "thing""#, "Unexpected token: \"thing\"", [11, 18]);
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
        crate::parsing::top_level_parse(test_program).unwrap_errs();
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
        crate::parsing::top_level_parse(some_program_string).unwrap();
    }

    #[test]
    fn test_math_with_stdlib() {
        let some_program_string = r#"const d2r = pi() / 2
let other_thing = 2 * cos(3)"#;
        crate::parsing::top_level_parse(some_program_string).unwrap();
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
        crate::parsing::top_level_parse(some_program_string).unwrap();
    }

    #[test]
    fn must_use_percent_in_pipeline_fn() {
        let some_program_string = r#"
        foo()
            |> bar(2)
        "#;
        assert_err(
            some_program_string,
            "All expressions in a pipeline must use the % (substitution operator)",
            [30, 36],
        );
    }

    #[test]
    fn arg_labels() {
        let input = r#"length: 3"#;
        let module_id = ModuleId::default();
        let tokens = crate::parsing::token::lexer(input, module_id).unwrap();
        let mut sl: &[Token] = &tokens;
        super::labeled_arguments(&mut sl).unwrap();
    }

    #[test]
    fn kw_fn() {
        for input in ["val = foo(x, y: z)", "val = foo(y: z)"] {
            let module_id = ModuleId::default();
            let tokens = crate::parsing::token::lexer(input, module_id).unwrap();
            let sl = &tokens;
            super::program.parse(sl).unwrap();
        }
    }

    #[test]
    fn test_parse_tag_named_std_lib() {
        let some_program_string = r#"startSketchOn('XY')
    |> startProfileAt([0, 0], %)
    |> line([5, 5], %, $xLine)
"#;
        assert_err(
            some_program_string,
            "Cannot assign a tag to a reserved keyword: xLine",
            [76, 82],
        );
    }

    #[test]
    fn test_parse_empty_tag() {
        let some_program_string = r#"startSketchOn('XY')
    |> startProfileAt([0, 0], %)
    |> line([5, 5], %, $)
"#;
        assert_err(some_program_string, "Unexpected token: |>", [57, 59]);
    }

    #[test]
    fn warn_object_expr() {
        let some_program_string = "{ foo: bar }";
        let (_, errs) = assert_no_err(some_program_string);
        assert_eq!(errs.len(), 1);
        assert_eq!(errs[0].apply_suggestion(some_program_string).unwrap(), "{ foo = bar }")
    }

    #[test]
    fn warn_fn_int() {
        let some_program_string = r#"int(1.0)
int(42.3)"#;
        let (_, errs) = assert_no_err(some_program_string);
        assert_eq!(errs.len(), 2);
        let replaced = errs[1].apply_suggestion(some_program_string).unwrap();
        let replaced = errs[0].apply_suggestion(&replaced).unwrap();
        assert_eq!(replaced, "1.0\nround(42.3)");
    }

    #[test]
    fn warn_fn_decl() {
        let some_program_string = r#"fn foo = () => {
    return 0
}"#;
        let (_, errs) = assert_no_err(some_program_string);
        assert_eq!(errs.len(), 2);
        let replaced = errs[0].apply_suggestion(some_program_string).unwrap();
        let replaced = errs[1].apply_suggestion(&replaced).unwrap();
        // Note the whitespace here is bad, but we're just testing the suggestion spans really. In
        // real life we might reformat after applying suggestions.
        assert_eq!(
            replaced,
            r#"fn foo  ()  {
    return 0
}"#
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
                let module_id = crate::ModuleId::default();
                let tokens = crate::parsing::token::lexer($test_kcl_program, module_id).unwrap();
                ParseContext::init();

                let actual = match binary_expression.parse(&tokens) {
                    Ok(x) => x,
                    Err(_e) => panic!("could not parse test"),
                };
                insta::assert_json_snapshot!(actual);
                let _ = ParseContext::take();
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
                let module_id = crate::ModuleId::default();
                let tokens = crate::parsing::token::lexer($test_kcl_program, module_id).unwrap();
                print_tokens(&tokens);
                ParseContext::init();
                let actual = match program.parse(&tokens) {
                    Ok(x) => x,
                    Err(e) => panic!("could not parse test: {e:?}"),
                };
                let mut settings = insta::Settings::clone_current();
                settings.set_sort_maps(true);
                settings.bind(|| {
                    insta::assert_json_snapshot!(actual);
                });
                let _ = ParseContext::take();
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
    snapshot_test!(
        bi,
        r#"x = 3
        obj = { x, y: 4}"#
    );
    snapshot_test!(kw_function_unnamed_first, r#"val = foo(x, y: z)"#);
    snapshot_test!(kw_function_all_named, r#"val = foo(x: a, y: b)"#);
}

#[allow(unused)]
#[cfg(test)]
pub(crate) fn print_tokens(tokens: &[Token]) {
    for (i, tok) in tokens.iter().enumerate() {
        println!("{i:.2}: ({:?}):) '{}'", tok.token_type, tok.value.replace("\n", "\\n"));
    }
}
