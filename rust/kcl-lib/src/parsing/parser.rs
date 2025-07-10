// TODO optimise size of CompilationError
#![allow(clippy::result_large_err)]

use std::{cell::RefCell, collections::BTreeMap};

use indexmap::IndexMap;
use winnow::{
    combinator::{alt, delimited, opt, peek, preceded, repeat, repeat_till, separated, separated_pair, terminated},
    dispatch,
    error::{ErrMode, StrContext, StrContextValue},
    prelude::*,
    stream::Stream,
    token::{any, none_of, one_of, take_till},
};

use super::{
    DeprecationKind,
    ast::types::{AscribedExpression, ImportPath, LabelledExpression},
    token::{NumericSuffix, RESERVED_WORDS},
};
use crate::{
    IMPORT_FILE_EXTENSIONS, SourceRange, TypedPath,
    errors::{CompilationError, Severity, Tag},
    execution::types::ArrayLen,
    parsing::{
        PIPE_OPERATOR, PIPE_SUBSTITUTION_OPERATOR,
        ast::types::{
            Annotation, ArrayExpression, ArrayRangeExpression, BinaryExpression, BinaryOperator, BinaryPart, BodyItem,
            BoxNode, CallExpressionKw, CommentStyle, DefaultParamVal, ElseIf, Expr, ExpressionStatement,
            FunctionExpression, FunctionType, Identifier, IfExpression, ImportItem, ImportSelector, ImportStatement,
            ItemVisibility, LabeledArg, Literal, LiteralIdentifier, LiteralValue, MemberExpression, Name, Node,
            NodeList, NonCodeMeta, NonCodeNode, NonCodeValue, ObjectExpression, ObjectProperty, Parameter,
            PipeExpression, PipeSubstitution, PrimitiveType, Program, ReturnStatement, Shebang, TagDeclarator, Type,
            TypeDeclaration, UnaryExpression, UnaryOperator, VariableDeclaration, VariableDeclarator, VariableKind,
        },
        math::BinaryExpressionToken,
        token::{Token, TokenSlice, TokenType},
    },
};

thread_local! {
    /// The current `ParseContext`. `None` if parsing is not currently happening on this thread.
    static CTXT: RefCell<Option<ParseContext>> = const { RefCell::new(None) };
}

pub fn run_parser(i: TokenSlice) -> super::ParseResult {
    let _stats = crate::log::LogPerfStats::new("Parsing");
    ParseContext::init();

    let result = match program.parse(i) {
        Ok(result) => Some(result),
        Err(e) => {
            ParseContext::err(e.into());
            None
        }
    };
    let ctxt = ParseContext::take();
    (result, ctxt.errors).into()
}

/// Context built up while parsing a program.
///
/// When returned from parsing contains the errors and warnings from the current parse.
#[derive(Debug, Clone, Default)]
struct ParseContext {
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
            }
            errors.push(err);
        });
    }

    /// Add a warning to the current `ParseContext`, panics if there is none.
    fn warn(mut e: CompilationError) {
        e.severity = Severity::Warning;
        Self::err(e);
    }
}

/// Accumulate context while backtracking errors
/// Very similar to [`winnow::error::ContextError`] type,
/// but the 'cause' field is always a [`CompilationError`],
/// instead of a dynamic [`std::error::Error`] trait object.
#[derive(Debug, Clone)]
pub(crate) struct ContextError<C = StrContext> {
    pub context: Vec<C>,
    pub cause: Option<CompilationError>,
}

impl From<winnow::error::ParseError<TokenSlice<'_>, ContextError>> for CompilationError {
    fn from(err: winnow::error::ParseError<TokenSlice<'_>, ContextError>) -> Self {
        let Some(last_token) = err.input().last() else {
            return CompilationError::fatal(Default::default(), "file is empty");
        };

        let (input, offset, err) = (err.input(), err.offset(), err.clone().into_inner());

        if let Some(e) = err.cause {
            return e;
        }

        // See docs on `offset`.
        if offset >= input.len() {
            let context = err.context.first();
            return CompilationError::fatal(
                last_token.as_source_range(),
                match context {
                    Some(what) => format!("Unexpected end of file. The compiler {what}"),
                    None => "Unexpected end of file while still parsing".to_owned(),
                },
            );
        }

        let bad_token = input.token(offset);
        // TODO: Add the Winnow parser context to the error.
        // See https://github.com/KittyCAD/modeling-app/issues/784
        CompilationError::fatal(
            bad_token.as_source_range(),
            format!("Unexpected token: {}", bad_token.value),
        )
    }
}

impl<C> From<CompilationError> for ContextError<C> {
    fn from(e: CompilationError) -> Self {
        Self {
            context: Default::default(),
            cause: Some(e),
        }
    }
}

impl<C> std::default::Default for ContextError<C> {
    fn default() -> Self {
        Self {
            context: Default::default(),
            cause: None,
        }
    }
}

impl<I, C> winnow::error::ParserError<I> for ContextError<C>
where
    I: Stream,
{
    /// Generally, `Self`
    ///
    /// Mostly used for [`ErrMode`]
    type Inner = Self;

    /// Creates an error from the input position
    fn from_input(_input: &I) -> Self {
        Self::default()
    }

    /// Unwrap the mode, returning the underlying error, if present
    fn into_inner(self) -> winnow::Result<Self::Inner, Self> {
        Ok(self)
    }
}

impl<C, I> winnow::error::AddContext<I, C> for ContextError<C>
where
    I: Stream,
{
    #[inline]
    fn add_context(mut self, _input: &I, _input_checkpoint: &<I as Stream>::Checkpoint, ctx: C) -> Self {
        self.context.push(ctx);
        self
    }
}

impl<C, I> winnow::error::FromExternalError<I, CompilationError> for ContextError<C> {
    /// Like [`ParserError::from_input`] but also include an external error.
    #[inline]
    fn from_external_error(_input: &I, e: CompilationError) -> Self {
        let mut err = Self::default();
        {
            err.cause = Some(e);
        }
        err
    }
}

type ModalResult<O, E = ContextError> = winnow::prelude::ModalResult<O, E>;

fn expected(what: &'static str) -> StrContext {
    StrContext::Expected(StrContextValue::Description(what))
}

fn program(i: &mut TokenSlice) -> ModalResult<Node<Program>> {
    let shebang = opt(shebang).parse_next(i)?;
    let mut out: Node<Program> = function_body.parse_next(i)?;
    out.shebang = shebang;

    // Match original parser behaviour, for now.
    // Once this is merged and stable, consider changing this as I think it's more accurate
    // without the -1.
    out.end -= 1;
    Ok(out)
}

fn pipe_surrounded_by_whitespace(i: &mut TokenSlice) -> ModalResult<()> {
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
fn non_code_node(i: &mut TokenSlice) -> ModalResult<Node<NonCodeNode>> {
    /// Matches one case of NonCodeValue
    /// See docstring on [NonCodeValue::NewLineBlockComment] for why that case is different to the others.
    fn non_code_node_leading_whitespace(i: &mut TokenSlice) -> ModalResult<Node<NonCodeNode>> {
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

fn outer_annotation(i: &mut TokenSlice) -> ModalResult<Node<Annotation>> {
    peek((at_sign, open_paren)).parse_next(i)?;
    annotation(i)
}

fn annotation(i: &mut TokenSlice) -> ModalResult<Node<Annotation>> {
    let at = at_sign.parse_next(i)?;
    let name = opt(binding_name).parse_next(i)?;
    let mut end = name.as_ref().map(|n| n.end).unwrap_or(at.end);

    let properties = if peek(open_paren).parse_next(i).is_ok() {
        open_paren(i)?;
        ignore_whitespace(i);
        let properties: Vec<_> = separated(
            0..,
            separated_pair(
                terminated(identifier, opt(whitespace)),
                terminated(one_of((TokenType::Operator, "=")), opt(whitespace)),
                expression,
            )
            .map(|(key, value)| {
                Node::new_node(
                    key.start,
                    value.end(),
                    key.module_id,
                    ObjectProperty {
                        key,
                        value,
                        digest: None,
                    },
                )
            }),
            comma_sep,
        )
        .parse_next(i)?;
        ignore_trailing_comma(i);
        ignore_whitespace(i);
        end = close_paren(i)?.end;
        Some(properties)
    } else {
        None
    };

    if name.is_none() && properties.is_none() {
        return Err(ErrMode::Cut(
            CompilationError::fatal(at.as_source_range(), format!("Unexpected token: {}", at.value)).into(),
        ));
    }

    let value = Annotation {
        name,
        properties,
        digest: None,
    };
    Ok(Node::new(value, at.start, end, at.module_id))
}

// Matches remaining three cases of NonCodeValue
fn non_code_node_no_leading_whitespace(i: &mut TokenSlice) -> ModalResult<Node<NonCodeNode>> {
    any.verify_map(|token: Token| {
        if token.is_code_token() {
            None
        } else {
            let value = match token.token_type {
                TokenType::Whitespace if token.value.contains("\n\n") || token.value.contains("\n\r\n") => {
                    NonCodeValue::NewLine
                }
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

fn pipe_expression(i: &mut TokenSlice) -> ModalResult<Node<PipeExpression>> {
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
        preceded(opt(whitespace), labelled_fn_call),           // The expression.
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

    // Time to structure the return value.
    let mut code_count = 0;
    let mut max_noncode_end = 0;
    for (noncode_before, code, noncode_after) in tail {
        for nc in noncode_before {
            max_noncode_end = nc.end.max(max_noncode_end);
            non_code_meta.insert(code_count, nc);
        }
        values.push(code);
        code_count += 1;
        for nc in noncode_after {
            max_noncode_end = nc.end.max(max_noncode_end);
            non_code_meta.insert(code_count, nc);
        }
    }
    Ok(Node::new_node(
        values.first().unwrap().start(),
        values.last().unwrap().end().max(max_noncode_end),
        values.first().unwrap().module_id(),
        PipeExpression {
            body: values,
            non_code_meta,
            digest: None,
        },
    ))
}

fn bool_value(i: &mut TokenSlice) -> ModalResult<Node<Literal>> {
    let (value, token) = any
        .try_map(|token: Token| match token.token_type {
            TokenType::Keyword if token.value == "true" => Ok((true, token)),
            TokenType::Keyword if token.value == "false" => Ok((false, token)),
            _ => Err(CompilationError::fatal(
                token.as_source_range(),
                "invalid boolean literal",
            )),
        })
        .context(expected("a boolean literal (either true or false)"))
        .parse_next(i)?;
    Ok(Node::new(
        Literal {
            value: LiteralValue::Bool(value),
            raw: value.to_string(),
            digest: None,
        },
        token.start,
        token.end,
        token.module_id,
    ))
}

fn literal(i: &mut TokenSlice) -> ModalResult<BoxNode<Literal>> {
    alt((string_literal, unsigned_number_literal, bool_value))
        .map(Box::new)
        .context(expected("a KCL literal, like 'myPart' or 3"))
        .parse_next(i)
}

/// Parse a KCL string literal
fn string_literal(i: &mut TokenSlice) -> ModalResult<Node<Literal>> {
    let (value, token) = any
        .try_map(|token: Token| match token.token_type {
            TokenType::String => {
                let s = token.value[1..token.value.len() - 1].to_string();
                Ok((LiteralValue::from(s), token))
            }
            _ => Err(CompilationError::fatal(
                token.as_source_range(),
                "invalid string literal",
            )),
        })
        .context(expected("string literal (like \"myPart\""))
        .parse_next(i)?;

    let result = Node::new(
        Literal {
            value,
            raw: token.value.clone(),
            digest: None,
        },
        token.start,
        token.end,
        token.module_id,
    );

    if let Some(suggestion) = super::deprecation(result.value.string_value().unwrap(), DeprecationKind::String) {
        ParseContext::warn(
            CompilationError::err(
                result.as_source_range(),
                format!(
                    "Using `\"{}\"` is deprecated, prefer using `{}`.",
                    result.value.string_value().unwrap(),
                    suggestion
                ),
            )
            .with_suggestion(
                format!(
                    "Replace `\"{}\"` with `{}`",
                    result.value.string_value().unwrap(),
                    suggestion
                ),
                suggestion,
                None,
                Tag::Deprecated,
            ),
        );
    }

    Ok(result)
}

/// Parse a KCL literal number, with no - sign.
pub(crate) fn unsigned_number_literal(i: &mut TokenSlice) -> ModalResult<Node<Literal>> {
    let (value, token) = any
        .try_map(|token: Token| match token.token_type {
            TokenType::Number => {
                let value: f64 = token.numeric_value().ok_or_else(|| {
                    CompilationError::fatal(token.as_source_range(), format!("Invalid float: {}", token.value))
                })?;

                let suffix = token.numeric_suffix();
                if let NumericSuffix::Unknown = suffix {
                    ParseContext::warn(CompilationError::err(token.as_source_range(), "The 'unknown' numeric suffix is not properly supported; it is likely to change or be removed, and may be buggy."));
                }

                Ok((
                    LiteralValue::Number {
                        value,
                        suffix,
                    },
                    token,
                ))
            }
            _ => Err(CompilationError::fatal(token.as_source_range(), "invalid literal")),
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
fn binary_operator(i: &mut TokenSlice) -> ModalResult<BinaryOperator> {
    any.try_map(|token: Token| {
        if !matches!(token.token_type, TokenType::Operator) {
            return Err(CompilationError::fatal(
                token.as_source_range(),
                format!("unexpected token, should be an operator but was {}", token.token_type),
            ));
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
            "|" => BinaryOperator::Or,
            "&" => BinaryOperator::And,
            "||" => {
                ParseContext::err(
                    CompilationError::err(
                        token.as_source_range(),
                        "`||` is not an operator, did you mean to use `|`?",
                    )
                    .with_suggestion("Replace `||` with `|`", "|", None, Tag::None),
                );
                BinaryOperator::Or
            }
            "&&" => {
                ParseContext::err(
                    CompilationError::err(
                        token.as_source_range(),
                        "`&&` is not an operator, did you mean to use `&`?",
                    )
                    .with_suggestion("Replace `&&` with `&`", "&", None, Tag::None),
                );
                BinaryOperator::And
            }
            _ => {
                return Err(CompilationError::fatal(
                    token.as_source_range(),
                    format!("{} is not a binary operator", token.value.as_str()),
                ));
            }
        };
        Ok(op)
    })
    .context(expected("a binary operator (like + or *)"))
    .parse_next(i)
}

/// Parse a KCL operand that can be used with an operator.
fn operand(i: &mut TokenSlice) -> ModalResult<BinaryPart> {
    const TODO_783: &str = "found a value, but this kind of value cannot be used as the operand to an operator yet (see https://github.com/KittyCAD/modeling-app/issues/783)";
    let op = possible_operands
        .try_map(|part| {
            let source_range = SourceRange::from(&part);
            let expr = match part {
                // TODO: these should be valid operands eventually,
                // users should be able to run "let x = f() + g()"
                // see https://github.com/KittyCAD/modeling-app/issues/783
                Expr::FunctionExpression(_)
                | Expr::PipeExpression(_)
                | Expr::PipeSubstitution(_)
                | Expr::LabelledExpression(..) => return Err(CompilationError::fatal(source_range, TODO_783)),
                Expr::None(_) => {
                    return Err(CompilationError::fatal(
                        source_range,
                        // TODO: Better error message here.
                        // Once we have ways to use None values (e.g. by replacing with a default value)
                        // we should suggest one of them here.
                        "cannot use a KCL None value as an operand",
                    ));
                }
                Expr::TagDeclarator(_) => {
                    return Err(CompilationError::fatal(
                        source_range,
                        // TODO: Better error message here.
                        // Once we have ways to use None values (e.g. by replacing with a default value)
                        // we should suggest one of them here.
                        "cannot use a KCL tag declaration as an operand",
                    ));
                }
                Expr::UnaryExpression(x) => BinaryPart::UnaryExpression(x),
                Expr::Literal(x) => BinaryPart::Literal(x),
                Expr::Name(x) => BinaryPart::Name(x),
                Expr::BinaryExpression(x) => BinaryPart::BinaryExpression(x),
                Expr::CallExpressionKw(x) => BinaryPart::CallExpressionKw(x),
                Expr::MemberExpression(x) => BinaryPart::MemberExpression(x),
                Expr::ArrayExpression(x) => BinaryPart::ArrayExpression(x),
                Expr::ArrayRangeExpression(x) => BinaryPart::ArrayRangeExpression(x),
                Expr::ObjectExpression(x) => BinaryPart::ObjectExpression(x),
                Expr::IfExpression(x) => BinaryPart::IfExpression(x),
                Expr::AscribedExpression(x) => BinaryPart::AscribedExpression(x),
            };
            Ok(expr)
        })
        .context(expected("an operand (a value which can be used with an operator)"))
        .parse_next(i)?;
    Ok(op)
}

impl TokenType {
    fn parse_from(self, i: &mut TokenSlice) -> ModalResult<Token> {
        any.try_map(|token: Token| {
            if token.token_type == self {
                Ok(token)
            } else {
                Err(CompilationError::fatal(
                    token.as_source_range(),
                    format!(
                        "expected {self} but found {} which is a {}",
                        token.value.as_str(),
                        token.token_type
                    ),
                ))
            }
        })
        .parse_next(i)
    }
}

/// Parse some whitespace (i.e. at least one whitespace token)
fn whitespace(i: &mut TokenSlice) -> ModalResult<Vec<Token>> {
    repeat(
        1..,
        any.try_map(|token: Token| {
            if token.token_type == TokenType::Whitespace {
                Ok(token)
            } else {
                Err(CompilationError::fatal(
                    token.as_source_range(),
                    format!(
                        "expected whitespace, found '{}' which is {}",
                        token.value.as_str(),
                        token.token_type
                    ),
                ))
            }
        }),
    )
    .context(expected("some whitespace (e.g. spaces, tabs, new lines)"))
    .parse_next(i)
}

/// A shebang is a line at the start of a file that starts with `#!`.
/// If the shebang is present it takes up the whole line.
fn shebang(i: &mut TokenSlice) -> ModalResult<Node<Shebang>> {
    // Parse the hash and the bang.
    hash.parse_next(i)?;
    let tok = bang.parse_next(i)?;
    // Get the rest of the line.
    // Parse everything until the next newline.
    let tokens = take_till(0.., |token: Token| token.value.contains('\n')).parse_next(i)?;
    let value = tokens.iter().map(|t| t.value.as_str()).collect::<String>();

    if tokens.is_empty() {
        return Err(ErrMode::Cut(
            CompilationError::fatal(tok.as_source_range(), "expected a shebang value after #!").into(),
        ));
    }

    // Strip all the whitespace after the shebang.
    opt(whitespace).parse_next(i)?;

    Ok(Node::new(
        Shebang::new(format!("#!{value}")),
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
fn array(i: &mut TokenSlice) -> ModalResult<Expr> {
    alt((
        array_empty.map(Box::new).map(Expr::ArrayExpression),
        array_end_start.map(Box::new).map(Expr::ArrayRangeExpression),
        array_elem_by_elem.map(Box::new).map(Expr::ArrayExpression),
    ))
    .parse_next(i)
}

/// Match an empty array.
fn array_empty(i: &mut TokenSlice) -> ModalResult<Node<ArrayExpression>> {
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
fn array_separator(i: &mut TokenSlice) -> ModalResult<()> {
    alt((
        // Normally you need a comma.
        comma_sep,
        // But, if the array is ending, no need for a comma.
        peek(preceded(opt(whitespace), close_bracket)).void(),
    ))
    .parse_next(i)
}

pub(crate) fn array_elem_by_elem(i: &mut TokenSlice) -> ModalResult<Node<ArrayExpression>> {
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
    ignore_trailing_comma(i);
    ignore_whitespace(i);

    let maybe_end = close_bracket(i).map_err(|e| {
        if let Ok(mut err) = e.clone().into_inner() {
            let start_range = open.as_source_range();
            let end_range = i.as_source_range();
            err.cause = Some(CompilationError::fatal(
                SourceRange::from([start_range.start(), end_range.start(), end_range.module_id().as_usize()]),
                "Encountered an unexpected character(s) before finding a closing bracket(`]`) for the array",
            ));
            ErrMode::Cut(err)
        } else {
            // ErrMode::Incomplete, not sure if it's actually possible to end up with this here
            e
        }
    });

    if maybe_end.is_err() {
        // if there is a closing bracket at some point, but it wasn't the next token, it's likely that they forgot a comma between some
        // of the elements
        let maybe_closing_bracket: ModalResult<((), Token)> = peek(repeat_till(
            0..,
            none_of(|token: Token| {
                // bail out early if we encounter something that is for sure not allowed in an
                // array, otherwise we could seek to find a closing bracket until the end of the
                // file
                RESERVED_WORDS
                    .keys()
                    .chain([",,", "{", "}", "["].iter())
                    .any(|word| *word == token.value)
            })
            .void(),
            one_of(|term: Token| term.value == "]"),
        ))
        .parse_next(i);
        let has_closing_bracket = maybe_closing_bracket.is_ok();
        if has_closing_bracket {
            let start_range = i.as_source_range();
            // safe to unwrap here because we checked it was Ok above
            let end_range = maybe_closing_bracket.unwrap().1.as_source_range();
            let e = ContextError {
                context: vec![],
                cause: Some(CompilationError::fatal(
                    SourceRange::from([start_range.start(), end_range.end(), end_range.module_id().as_usize()]),
                    "Unexpected character encountered. You might be missing a comma in between elements.",
                )),
            };
            return Err(ErrMode::Cut(e));
        }
    }
    let end = maybe_end?.end;

    // Sort the array's elements (i.e. expression nodes) from the noncode nodes.
    let (elements, non_code_nodes): (Vec<_>, BTreeMap<usize, _>) = elements.into_iter().enumerate().fold(
        (Vec::new(), BTreeMap::new()),
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

fn array_end_start(i: &mut TokenSlice) -> ModalResult<Node<ArrayRangeExpression>> {
    let open = open_bracket(i)?;
    let start = open.start;
    ignore_whitespace(i);
    let start_element = expression.parse_next(i)?;
    ignore_whitespace(i);
    let end_inclusive = alt((end_inclusive_range.map(|_| true), end_exclusive_range.map(|_| false))).parse_next(i)?;
    ignore_whitespace(i);
    let end_element = expression.parse_next(i)?;
    ignore_whitespace(i);
    let end = close_bracket(i)?.end;
    Ok(Node::new(
        ArrayRangeExpression {
            start_element,
            end_element,
            end_inclusive,
            digest: None,
        },
        start,
        end,
        open.module_id,
    ))
}

fn object_property_same_key_and_val(i: &mut TokenSlice) -> ModalResult<Node<ObjectProperty>> {
    let key = nameable_identifier.context(expected("the property's key (the name or identifier of the property), e.g. in 'height = 4', 'height' is the property key")).parse_next(i)?;
    ignore_whitespace(i);
    Ok(Node::new_node(
        key.start,
        key.end,
        key.module_id,
        ObjectProperty {
            value: Expr::Name(Box::new(key.clone().into())),
            key,
            digest: None,
        },
    ))
}

fn object_property(i: &mut TokenSlice) -> ModalResult<Node<ObjectProperty>> {
    let key = identifier.context(expected("the property's key (the name or identifier of the property), e.g. in 'height = 4', 'height' is the property key")).parse_next(i)?;
    ignore_whitespace(i);
    // Temporarily accept both `:` and `=` for compatibility.
    let sep = alt((colon, equals))
        .context(expected(
            "`=`, which separates the property's key from the value you're setting it to, e.g. 'height = 4'",
        ))
        .parse_next(i)?;
    ignore_whitespace(i);
    let expr = match expression
        .context(expected(
            "the value which you're setting the property to, e.g. in 'height = 4', the value is 4",
        ))
        .parse_next(i)
    {
        Ok(expr) => expr,
        Err(_) => {
            return Err(ErrMode::Cut(
                CompilationError::fatal(
                    SourceRange::from(sep),
                    "This property has a label, but no value. Put some value after the equals sign",
                )
                .into(),
            ));
        }
    };

    let result = Node::new_node(
        key.start,
        expr.end(),
        key.module_id,
        ObjectProperty {
            key,
            value: expr,
            digest: None,
        },
    );

    if sep.token_type == TokenType::Colon {
        ParseContext::err(
            CompilationError::err(
                sep.into(),
                "Using `:` to initialize objects is deprecated, prefer using `=`.",
            )
            .with_suggestion("Replace `:` with `=`", " =", None, Tag::Deprecated),
        );
    }

    Ok(result)
}

/// Match something that separates properties of an object.
fn property_separator(i: &mut TokenSlice) -> ModalResult<()> {
    alt((
        // Normally you need a comma.
        comma_sep,
        // But, if the object is ending, no need for a comma.
        peek(preceded(opt(whitespace), close_brace)).void(),
    ))
    .parse_next(i)
}

/// Match something that separates the labeled arguments of a fn call.
/// Returns the source range of the erroneous separator, if any was found.
fn labeled_arg_separator(i: &mut TokenSlice) -> ModalResult<Option<SourceRange>> {
    alt((
        // Normally you need a comma.
        comma_sep.map(|_| None),
        // But, if the argument list is ending, no need for a comma.
        peek(preceded(opt(whitespace), close_paren)).void().map(|_| None),
        whitespace.map(|mut tokens| {
            // Safe to unwrap here because `whitespace` is guaranteed to return at least 1 whitespace.
            let first_token = tokens.pop().unwrap();
            Some(SourceRange::from(&first_token))
        }),
    ))
    .parse_next(i)
}

/// Parse a KCL object value.
pub(crate) fn object(i: &mut TokenSlice) -> ModalResult<Node<ObjectExpression>> {
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
        "a comma-separated list of key-value pairs, e.g. 'height = 4, width = 3'",
    ))
    .parse_next(i)?;
    ignore_trailing_comma(i);
    ignore_whitespace(i);

    let maybe_end = close_brace(i).map_err(|e| {
        if let Ok(mut err) = e.clone().into_inner() {
            let start_range = open.as_source_range();
            let end_range = i.as_source_range();
            err.cause = Some(CompilationError::fatal(
                SourceRange::from([start_range.start(), end_range.start(), end_range.module_id().as_usize()]),
                "Encountered an unexpected character(s) before finding a closing brace(`}`) for the object",
            ));
            ErrMode::Cut(err)
        } else {
            // ErrMode::Incomplete, not sure if it's actually possible to end up with this here
            e
        }
    });
    if maybe_end.is_err() {
        // if there is a closing brace at some point, but it wasn't the next token, it's likely that they forgot a comma between some
        // of the properties
        let maybe_closing_brace: ModalResult<((), Token)> = peek(repeat_till(
            0..,
            none_of(|token: Token| {
                // bail out early if we encounter something that is for sure not allowed in an
                // object, otherwise we could seek to find a closing brace until the end of the
                // file
                RESERVED_WORDS
                    .keys()
                    .chain([",,", "[", "]", "{"].iter())
                    .any(|word| *word == token.value)
            })
            .void(),
            one_of(|c: Token| c.value == "}"),
        ))
        .parse_next(i);
        let has_closing_brace = maybe_closing_brace.is_ok();
        if has_closing_brace {
            let start_range = i.as_source_range();
            // okay to unwrap here because we checked it was Ok above
            let end_range = maybe_closing_brace.unwrap().1.as_source_range();

            let e = ContextError {
                context: vec![],
                cause: Some(CompilationError::fatal(
                    SourceRange::from([start_range.start(), end_range.end(), end_range.module_id().as_usize()]),
                    "Unexpected character encountered. You might be missing a comma in between properties.",
                )),
            };
            return Err(ErrMode::Cut(e));
        }
    }

    let end = maybe_end?.end;
    // Sort the object's properties from the noncode nodes.
    let (properties, non_code_nodes): (Vec<_>, BTreeMap<usize, _>) = properties.into_iter().enumerate().fold(
        (Vec::new(), BTreeMap::new()),
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
fn pipe_sub(i: &mut TokenSlice) -> ModalResult<Node<PipeSubstitution>> {
    any.try_map(|token: Token| {
        if matches!(token.token_type, TokenType::Operator) && token.value == PIPE_SUBSTITUTION_OPERATOR {
            Ok(Node::new(
                PipeSubstitution { digest: None },
                token.start,
                token.end,
                token.module_id,
            ))
        } else {
            Err(CompilationError::fatal(
                token.as_source_range(),
                format!(
                    "expected a pipe substitution symbol (%) but found {}",
                    token.value.as_str()
                ),
            ))
        }
    })
    .context(expected("the substitution symbol, %"))
    .parse_next(i)
}

fn else_if(i: &mut TokenSlice) -> ModalResult<Node<ElseIf>> {
    let else_ = any
        .try_map(|token: Token| {
            if matches!(token.token_type, TokenType::Keyword) && token.value == "else" {
                Ok(token)
            } else {
                Err(CompilationError::fatal(
                    token.as_source_range(),
                    format!("{} is not 'else'", token.value.as_str()),
                ))
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
                Err(CompilationError::fatal(
                    token.as_source_range(),
                    format!("{} is not 'if'", token.value.as_str()),
                ))
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

fn if_expr(i: &mut TokenSlice) -> ModalResult<BoxNode<IfExpression>> {
    let if_ = any
        .try_map(|token: Token| {
            if matches!(token.token_type, TokenType::Keyword) && token.value == "if" {
                Ok(token)
            } else {
                Err(CompilationError::fatal(
                    token.as_source_range(),
                    format!("{} is not 'if'", token.value.as_str()),
                ))
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
                Err(CompilationError::fatal(
                    token.as_source_range(),
                    format!("{} is not 'else'", token.value.as_str()),
                ))
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

fn function_expr(i: &mut TokenSlice) -> ModalResult<Expr> {
    let fn_tok = opt(fun).parse_next(i)?;
    ignore_whitespace(i);
    let result = function_decl.parse_next(i)?;
    if fn_tok.is_none() {
        let err = CompilationError::fatal(result.as_source_range(), "Anonymous function requires `fn` before `(`");
        return Err(ErrMode::Cut(err.into()));
    }
    Ok(Expr::FunctionExpression(Box::new(result)))
}

// Looks like
// (arg0, arg1) {
//     const x = arg0 + arg1;
//     return x
// }
fn function_decl(i: &mut TokenSlice) -> ModalResult<Node<FunctionExpression>> {
    fn return_type(i: &mut TokenSlice) -> ModalResult<Node<Type>> {
        colon(i)?;
        ignore_whitespace(i);
        type_(i)
    }

    let open = open_paren(i)?;
    let start = open.start;
    let params = parameters(i)?;
    close_paren(i)?;
    ignore_whitespace(i);
    // Optional return type.
    let return_type = opt(return_type).parse_next(i)?;
    ignore_whitespace(i);
    let brace = open_brace(i)?;
    let close: Option<(Vec<Vec<Token>>, Token)> = opt((repeat(0.., whitespace), close_brace)).parse_next(i)?;
    let (body, end) = match close {
        Some((_, end)) => (
            Node::new(Program::default(), brace.end, brace.end, brace.module_id),
            end.end,
        ),
        None => (function_body(i)?, close_brace(i)?.end),
    };
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

    Ok(result)
}

/// E.g. `person.name`
fn member_expression_dot(i: &mut TokenSlice) -> ModalResult<(LiteralIdentifier, usize, bool)> {
    period.parse_next(i)?;
    let property = nameable_identifier
        .map(Box::new)
        .map(LiteralIdentifier::Identifier)
        .parse_next(i)?;
    let end = property.end();
    Ok((property, end, false))
}

/// E.g. `people[0]` or `people[i]` or `people['adam']`
fn member_expression_subscript(i: &mut TokenSlice) -> ModalResult<(LiteralIdentifier, usize, bool)> {
    let _ = open_bracket.parse_next(i)?;
    // TODO: This should be an expression, not just a literal or identifier.
    let property = alt((
        literal.map(LiteralIdentifier::Literal),
        nameable_identifier.map(Box::new).map(LiteralIdentifier::Identifier),
    ))
    .parse_next(i)?;

    let end = close_bracket.parse_next(i)?.end;
    let computed = matches!(property, LiteralIdentifier::Identifier(_));
    Ok((property, end, computed))
}

/// Get a property of an object, or an index of an array, or a member of a collection.
/// Can be arbitrarily nested, e.g. `people[i]['adam'].age`.
fn build_member_expression(object: Expr, i: &mut TokenSlice) -> ModalResult<Node<MemberExpression>> {
    // Now a sequence of members.
    let member = alt((member_expression_dot, member_expression_subscript)).context(expected("a member/property, e.g. size.x and size['height'] and size[0] are all different ways to access a member/property of 'size'"));
    let mut members: Vec<_> = repeat(1.., member)
        .context(expected("a sequence of at least one members/properties"))
        .parse_next(i)?;

    // Process the first member.
    // It's safe to call remove(0), because the vec is created from repeat(1..),
    // which is guaranteed to have >=1 elements.
    let (property, end, computed) = members.remove(0);
    let start = object.start();
    let module_id = object.module_id();
    let initial_member_expression = Node::new(
        MemberExpression {
            object,
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
                    object: Expr::MemberExpression(Box::new(accumulated)),
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
fn noncode_just_after_code(i: &mut TokenSlice) -> ModalResult<Node<NonCodeNode>> {
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
    Annotation(Node<Annotation>),
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

fn body_items_within_function(i: &mut TokenSlice) -> ModalResult<WithinFunction> {
    // Any of the body item variants, each of which can optionally be followed by a comment.
    // If there is a comment, it may be preceded by whitespace.
    let item = dispatch! {peek(any);
        token if token.visibility_keyword().is_some() => (alt((import_stmt.map(BodyItem::ImportStatement), ty_decl.map(BodyItem::TypeDeclaration), declaration.map(BodyItem::VariableDeclaration))), opt(noncode_just_after_code)).map(WithinFunction::BodyItem),
        token if token.value == "type" && matches!(token.token_type, TokenType::Keyword) =>
            (ty_decl.map(BodyItem::TypeDeclaration), opt(noncode_just_after_code)).map(WithinFunction::BodyItem),
        token if token.declaration_keyword().is_some() =>
            (declaration.map(BodyItem::VariableDeclaration), opt(noncode_just_after_code)).map(WithinFunction::BodyItem),
        token if token.value == "import" && matches!(token.token_type, TokenType::Keyword) =>
            (import_stmt.map(BodyItem::ImportStatement), opt(noncode_just_after_code)).map(WithinFunction::BodyItem),
        Token { ref value, .. } if value == "return" =>
            (return_stmt.map(BodyItem::ReturnStatement), opt(noncode_just_after_code)).map(WithinFunction::BodyItem),
        token if !token.is_code_token() => {
            non_code_node.map(WithinFunction::NonCode)
        },
        token if token.token_type == TokenType::At => {
            annotation.map(WithinFunction::Annotation)
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
fn function_body(i: &mut TokenSlice) -> ModalResult<Node<Program>> {
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
            if ws_token.value.contains("\n\n") || ws_token.value.contains("\n\r\n") {
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
    let mut inner_attrs = Vec::new();
    let mut pending_attrs = Vec::new();
    let mut non_code_meta = NonCodeMeta::default();
    let mut pending_non_code: Vec<Node<NonCodeNode>> = Vec::new();
    let mut end = 0;
    let mut start = leading_whitespace_start;

    macro_rules! handle_pending_non_code {
        ($node: ident) => {
            if !pending_non_code.is_empty() {
                let start = pending_non_code[0].start;
                let force_disoc = matches!(
                    &pending_non_code.last().unwrap().inner.value,
                    NonCodeValue::NewLine
                );
                let mut comments = Vec::new();
                for nc in pending_non_code {
                    match nc.inner.value {
                        NonCodeValue::BlockComment { value, style } if !force_disoc => {
                            comments.push(style.render_comment(&value));
                        }
                        NonCodeValue::NewLineBlockComment { value, style } if !force_disoc => {
                            if comments.is_empty() && nc.start != 0 {
                                comments.push(String::new());
                                comments.push(String::new());
                            }
                            comments.push(style.render_comment(&value));
                        }
                        NonCodeValue::NewLine if !force_disoc && !comments.is_empty() => {
                            comments.push(String::new());
                            comments.push(String::new());
                        }
                        _ => {
                            if body.is_empty() {
                                non_code_meta.start_nodes.push(nc);
                            } else {
                                non_code_meta.insert(body.len() - 1, nc);
                            }
                        }
                    }
                }
                $node.set_comments(comments, start);
                pending_non_code = Vec::new();
            }
        };
    }

    for thing_in_body in things_within_body {
        match thing_in_body {
            WithinFunction::Annotation(mut attr) => {
                if start.is_none() {
                    start = Some((attr.start, attr.module_id))
                }
                handle_pending_non_code!(attr);
                if attr.is_inner() {
                    if !body.is_empty() {
                        ParseContext::warn(CompilationError::err(
                            attr.as_source_range(),
                            "Named attributes should appear before any declarations or expressions.\n\nBecause named attributes apply to the whole function or module, including code written before them, it can be confusing for readers to not have these attributes at the top of code blocks.",
                        ));
                    }
                    inner_attrs.push(attr);
                } else {
                    pending_attrs.push(attr);
                }
            }
            WithinFunction::BodyItem((mut b, maybe_noncode)) => {
                if start.is_none() {
                    start = Some((b.start(), b.module_id()));
                }
                end = b.end();
                if !pending_attrs.is_empty() {
                    b.set_attrs(pending_attrs);
                    pending_attrs = Vec::new();
                }
                handle_pending_non_code!(b);
                body.push(b);
                if let Some(nc) = maybe_noncode {
                    end = nc.end;
                    pending_non_code.push(nc);
                }
            }
            WithinFunction::NonCode(nc) => {
                if start.is_none() {
                    start = Some((nc.start, nc.module_id));
                }
                end = nc.end;
                pending_non_code.push(nc);
            }
        }
    }

    let start = start.expect(
        "the `things_within_body` vec should have looped at least once, and each loop overwrites `start` if it is None",
    );

    if !pending_attrs.is_empty() {
        for a in pending_attrs {
            ParseContext::err(CompilationError::err(
                a.as_source_range(),
                "Attribute is not attached to any item",
            ));
        }
        return Err(ErrMode::Cut(
            CompilationError::fatal(
                SourceRange::new(start.0, end, start.1),
                "Block contains un-attached attributes",
            )
            .into(),
        ));
    }

    for nc in pending_non_code {
        if body.is_empty() {
            non_code_meta.start_nodes.push(nc);
        } else {
            non_code_meta.insert(body.len() - 1, nc);
        }
    }

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
            inner_attrs,
            shebang: None,
            digest: None,
        },
        start.0,
        end,
        start.1,
    ))
}

fn import_items(i: &mut TokenSlice) -> ModalResult<NodeList<ImportItem>> {
    separated(1.., import_item, comma_sep)
        .parse_next(i)
        .map_err(|e| e.cut())
}

fn glob(i: &mut TokenSlice) -> ModalResult<Token> {
    one_of((TokenType::Operator, "*"))
        .context(expected("the multiple import operator, *"))
        .parse_next(i)
}

pub(super) fn import_stmt(i: &mut TokenSlice) -> ModalResult<BoxNode<ImportStatement>> {
    let (visibility, visibility_token) = opt(terminated(item_visibility, whitespace))
        .parse_next(i)?
        .map_or((ItemVisibility::Default, None), |pair| (pair.0, Some(pair.1)));
    let import_token = any
        .try_map(|token: Token| {
            if matches!(token.token_type, TokenType::Keyword) && token.value == "import" {
                Ok(token)
            } else {
                Err(CompilationError::fatal(
                    token.as_source_range(),
                    format!("{} is not the 'import' keyword", token.value.as_str()),
                ))
            }
        })
        .context(expected("the 'import' keyword"))
        .parse_next(i)?;

    let module_id = import_token.module_id;
    let start = visibility_token.unwrap_or(import_token).start;

    require_whitespace(i)?;

    let (mut selector, path) = alt((
        string_literal.map(|s| (ImportSelector::None { alias: None }, Some(s))),
        glob.map(|t| {
            let s = t.as_source_range();
            (
                ImportSelector::Glob(Node::new((), s.start(), s.end(), s.module_id())),
                None,
            )
        }),
        import_items.map(|items| (ImportSelector::List { items }, None)),
    ))
    .parse_next(i)?;

    let path = match path {
        Some(path) => path,
        None => {
            require_whitespace(i)?;
            any.try_map(|token: Token| {
                if matches!(token.token_type, TokenType::Keyword | TokenType::Word) && token.value == "from" {
                    Ok(())
                } else {
                    Err(CompilationError::fatal(
                        token.as_source_range(),
                        format!("{} is not the 'from' keyword", token.value.as_str()),
                    ))
                }
            })
            .context(expected("the 'from' keyword"))
            .parse_next(i)
            .map_err(|e: ErrMode<ContextError>| e.cut())?;

            require_whitespace(i)?;

            string_literal(i)?
        }
    };

    let mut end: usize = path.end;

    if let ImportSelector::None {
        alias: ref mut selector_alias,
    } = selector
    {
        if let Some(alias) = opt(preceded(
            (whitespace, import_as_keyword, whitespace),
            identifier.context(expected("an identifier to alias the import")),
        ))
        .parse_next(i)?
        {
            end = alias.end;
            *selector_alias = Some(alias);
        }
    }

    let path_string = match path.inner.value {
        LiteralValue::String(s) => s,
        _ => unreachable!(),
    };
    let path = validate_path_string(
        path_string,
        selector.exposes_imported_name(),
        SourceRange::new(path.start, path.end, path.module_id),
    )?;

    if matches!(path, ImportPath::Foreign { .. }) && selector.imports_items() {
        return Err(ErrMode::Cut(
            CompilationError::fatal(
                SourceRange::new(start, end, module_id),
                "individual items can only be imported from KCL files",
            )
            .into(),
        ));
    }

    Ok(Node::boxed(
        ImportStatement {
            selector,
            visibility,
            path,
            digest: None,
        },
        start,
        end,
        module_id,
    ))
}

/// Validates the path string in an `import` statement.
///
/// `var_name` is `true` if the path will be used as a variable name.
fn validate_path_string(path_string: String, var_name: bool, path_range: SourceRange) -> ModalResult<ImportPath> {
    if path_string.is_empty() {
        return Err(ErrMode::Cut(
            CompilationError::fatal(path_range, "import path cannot be empty").into(),
        ));
    }

    if var_name
        && (path_string.starts_with("_")
            || path_string.contains('-')
            || path_string.chars().filter(|c| *c == '.').count() > 1)
    {
        return Err(ErrMode::Cut(
            CompilationError::fatal(path_range, "import path is not a valid identifier and must be aliased.").into(),
        ));
    }

    let path = if path_string.ends_with(".kcl") {
        if path_string
            .chars()
            .any(|c| !c.is_ascii_alphanumeric() && c != '_' && c != '-' && c != '.' && c != '/' && c != '\\')
        {
            return Err(ErrMode::Cut(
                CompilationError::fatal(
                    path_range,
                    "import path may only contain alphanumeric characters, `_`, `-`, `.`, `/`, and `\\`.",
                )
                .into(),
            ));
        }

        if path_string.starts_with("..") {
            return Err(ErrMode::Cut(
                CompilationError::fatal(
                    path_range,
                    "import path may not start with '..'. Cannot traverse to something outside the bounds of your project. If this path is inside your project please find a better way to reference it.",
                )
                .into(),
            ));
        }

        // Make sure they are not using an absolute path.
        if path_string.starts_with('/') || path_string.starts_with('\\') {
            return Err(ErrMode::Cut(
                CompilationError::fatal(
                    path_range,
                    "import path may not start with '/' or '\\'. Cannot traverse to something outside the bounds of your project. If this path is inside your project please find a better way to reference it.",
                )
                .into(),
            ));
        }

        if (path_string.contains('/') || path_string.contains('\\'))
            && !(path_string.ends_with("/main.kcl") || path_string.ends_with("\\main.kcl"))
        {
            return Err(ErrMode::Cut(
                CompilationError::fatal(path_range, "import path to a subdirectory must only refer to main.kcl.")
                    .into(),
            ));
        }

        ImportPath::Kcl {
            filename: TypedPath::new(&path_string),
        }
    } else if path_string.starts_with("std::") {
        ParseContext::warn(CompilationError::err(
            path_range,
            "explicit imports from the standard library are experimental, likely to be buggy, and likely to change.",
        ));

        let segments: Vec<String> = path_string.split("::").map(str::to_owned).collect();

        for s in &segments {
            if s.chars().any(|c| !c.is_ascii_alphanumeric() && c != '_') || s.starts_with('_') {
                return Err(ErrMode::Cut(
                    CompilationError::fatal(path_range, "invalid path in import statement.").into(),
                ));
            }
        }

        // For now we only support importing from singly-nested modules inside std.
        if segments.len() != 2 {
            return Err(ErrMode::Cut(
                CompilationError::fatal(
                    path_range,
                    format!("Invalid import path for import from std: {path_string}."),
                )
                .into(),
            ));
        }

        ImportPath::Std { path: segments }
    } else if path_string.contains('.') {
        let extn = std::path::Path::new(&path_string).extension().unwrap_or_default();
        if !IMPORT_FILE_EXTENSIONS.contains(&extn.to_string_lossy().to_string()) {
            ParseContext::warn(CompilationError::err(
                path_range,
                format!(
                    "unsupported import path format. KCL files can be imported from the current project, CAD files with the following formats are supported: {}",
                    IMPORT_FILE_EXTENSIONS.join(", ")
                ),
            ))
        }
        ImportPath::Foreign {
            path: TypedPath::new(&path_string),
        }
    } else {
        return Err(ErrMode::Cut(
            CompilationError::fatal(
                path_range,
                format!("unsupported import path format. KCL files can be imported from the current project, CAD files with the following formats are supported: {}", IMPORT_FILE_EXTENSIONS.join(", ")),
            )
            .into(),
        ));
    };

    Ok(path)
}

fn import_item(i: &mut TokenSlice) -> ModalResult<Node<ImportItem>> {
    let name = nameable_identifier
        .context(expected("an identifier to import"))
        .parse_next(i)?;
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

fn import_as_keyword(i: &mut TokenSlice) -> ModalResult<Token> {
    any.try_map(|token: Token| {
        if matches!(token.token_type, TokenType::Keyword | TokenType::Word) && token.value == "as" {
            Ok(token)
        } else {
            Err(CompilationError::fatal(
                token.as_source_range(),
                format!("{} is not the 'as' keyword", token.value.as_str()),
            ))
        }
    })
    .context(expected("the 'as' keyword"))
    .parse_next(i)
}

/// Parse a return statement of a user-defined function, e.g. `return x`.
fn return_stmt(i: &mut TokenSlice) -> ModalResult<Node<ReturnStatement>> {
    let ret = any
        .try_map(|token: Token| {
            if matches!(token.token_type, TokenType::Keyword) && token.value == "return" {
                Ok(token)
            } else {
                Err(CompilationError::fatal(
                    token.as_source_range(),
                    format!("{} is not a return keyword", token.value.as_str()),
                ))
            }
        })
        .context(expected(
            "the 'return' keyword, which ends your function (and becomes this function's value when it's called)",
        ))
        .parse_next(i)?;
    require_whitespace(i)?;
    let argument = expression(i)?;
    Ok(Node::new_node(
        ret.start,
        argument.end(),
        ret.module_id,
        ReturnStatement { argument, digest: None },
    ))
}

/// Parse a KCL expression.
fn expression(i: &mut TokenSlice) -> ModalResult<Expr> {
    alt((
        pipe_expression.map(Box::new).map(Expr::PipeExpression),
        expression_but_not_pipe,
    ))
    .context(expected("a KCL value"))
    .parse_next(i)
}

fn expression_but_not_pipe(i: &mut TokenSlice) -> ModalResult<Expr> {
    let mut expr = alt((
        binary_expression.map(Box::new).map(Expr::BinaryExpression),
        unary_expression.map(Box::new).map(Expr::UnaryExpression),
        expr_allowed_in_pipe_expr,
    ))
    .context(expected("a KCL value"))
    .parse_next(i)?;

    let ty = opt((colon, opt(whitespace), type_)).parse_next(i)?;
    if let Some((_, _, ty)) = ty {
        expr = Expr::AscribedExpression(Box::new(AscribedExpression::new(expr, ty)))
    }
    let label = opt(label).parse_next(i)?;
    match label {
        Some(label) => Ok(Expr::LabelledExpression(Box::new(LabelledExpression::new(expr, label)))),
        None => Ok(expr),
    }
}

fn label(i: &mut TokenSlice) -> ModalResult<Node<Identifier>> {
    let result = preceded(
        (whitespace, import_as_keyword, whitespace),
        identifier.context(expected("an identifier")),
    )
    .parse_next(i)?;

    ParseContext::warn(CompilationError::err(
        SourceRange::new(result.start, result.end, result.module_id),
        "Using `as` for tagging expressions is experimental, likely to be buggy, and likely to change",
    ));

    Ok(result)
}

fn unnecessarily_bracketed(i: &mut TokenSlice) -> ModalResult<Expr> {
    delimited(
        terminated(open_paren, opt(whitespace)),
        expression,
        preceded(opt(whitespace), close_paren),
    )
    .parse_next(i)
}

fn expr_allowed_in_pipe_expr(i: &mut TokenSlice) -> ModalResult<Expr> {
    let parsed_expr = alt((
        bool_value.map(Box::new).map(Expr::Literal),
        tag.map(Box::new).map(Expr::TagDeclarator),
        literal.map(Expr::Literal),
        fn_call_kw.map(Box::new).map(Expr::CallExpressionKw),
        name.map(Box::new).map(Expr::Name),
        array,
        object.map(Box::new).map(Expr::ObjectExpression),
        pipe_sub.map(Box::new).map(Expr::PipeSubstitution),
        function_expr,
        if_expr.map(Expr::IfExpression),
        unnecessarily_bracketed,
    ))
    .context(expected("a KCL expression (but not a pipe expression)"))
    .parse_next(i)?;

    let maybe_member = build_member_expression(parsed_expr.clone(), i);
    if let Ok(mem) = maybe_member {
        return Ok(Expr::MemberExpression(Box::new(mem)));
    }
    Ok(parsed_expr)
}

fn possible_operands(i: &mut TokenSlice) -> ModalResult<Expr> {
    let mut expr = alt((
        unary_expression.map(Box::new).map(Expr::UnaryExpression),
        bool_value.map(Box::new).map(Expr::Literal),
        literal.map(Expr::Literal),
        fn_call_kw.map(Box::new).map(Expr::CallExpressionKw),
        name.map(Box::new).map(Expr::Name),
        array,
        object.map(Box::new).map(Expr::ObjectExpression),
        binary_expr_in_parens.map(Box::new).map(Expr::BinaryExpression),
        unnecessarily_bracketed,
    ))
    .context(expected(
        "a KCL value which can be used as an argument/operand to an operator",
    ))
    .parse_next(i)?;
    let maybe_member = build_member_expression(expr.clone(), i);
    if let Ok(mem) = maybe_member {
        expr = Expr::MemberExpression(Box::new(mem));
    }

    let ty = opt((colon, opt(whitespace), type_)).parse_next(i)?;
    if let Some((_, _, ty)) = ty {
        expr = Expr::AscribedExpression(Box::new(AscribedExpression::new(expr, ty)))
    }

    Ok(expr)
}

/// Parse an item visibility specifier, e.g. export.
fn item_visibility(i: &mut TokenSlice) -> ModalResult<(ItemVisibility, Token)> {
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

fn declaration_keyword(i: &mut TokenSlice) -> ModalResult<(VariableKind, Token)> {
    let res = any
        .verify_map(|token: Token| token.declaration_keyword().map(|kw| (kw, token)))
        .parse_next(i)?;
    Ok(res)
}

/// Parse a variable/constant declaration.
fn declaration(i: &mut TokenSlice) -> ModalResult<BoxNode<VariableDeclaration>> {
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
    let (kind, mut start, dec_end) = if let Some((kind, token)) = &decl_token {
        (*kind, token.start, token.end)
    } else {
        (VariableKind::Const, id.start, id.end)
    };
    if let Some(token) = visibility_token {
        start = token.start;
    }

    ignore_whitespace(i);

    let val =
        if kind == VariableKind::Fn {
            let eq = opt(equals).parse_next(i)?;
            ignore_whitespace(i);

            let val = function_decl
                .map(Box::new)
                .map(Expr::FunctionExpression)
                .context(expected("a KCL function expression, like () { return 1 }"))
                .parse_next(i);

            if let Some(t) = eq {
                ParseContext::warn(
                    CompilationError::err(t.as_source_range(), "Unnecessary `=` in function declaration")
                        .with_suggestion("Remove `=`", "", None, Tag::Unnecessary),
                );
            }

            val
        } else {
            equals(i)?;
            ignore_whitespace(i);

            let val = expression
                .try_map(|val| {
                    // Function bodies can be used if and only if declaring a function.
                    // Check the 'if' direction:
                    if matches!(val, Expr::FunctionExpression(_)) {
                        return Err(CompilationError::fatal(
                            SourceRange::new(start, dec_end, id.module_id),
                            format!("Expected a `fn` variable kind, found: `{kind}`"),
                        ));
                    }
                    Ok(val)
                })
                .context(expected("a KCL value, which is being bound to a variable"))
                .parse_next(i);

            if let Some((_, tok)) = decl_token {
                let range_to_remove = SourceRange::new(tok.start, id.start, id.module_id);
                ParseContext::err(
                    CompilationError::err(
                        tok.as_source_range(),
                        format!(
                            "Using `{}` to declare constants is deprecated; no keyword is required",
                            tok.value
                        ),
                    )
                    .with_suggestion(
                        format!("Remove `{}`", tok.value),
                        "",
                        Some(range_to_remove),
                        Tag::Deprecated,
                    ),
                );
            }

            val
        }
        .map_err(|e| e.cut())?;

    let end = val.end();
    let module_id = id.module_id;
    Ok(Node::boxed(
        VariableDeclaration {
            declaration: Node::new_node(
                id.start,
                end,
                module_id,
                VariableDeclarator {
                    id,
                    init: val,
                    digest: None,
                },
            ),
            visibility,
            kind,
            digest: None,
        },
        start,
        end,
        module_id,
    ))
}

fn ty_decl(i: &mut TokenSlice) -> ModalResult<BoxNode<TypeDeclaration>> {
    let (visibility, visibility_token) = opt(terminated(item_visibility, whitespace))
        .parse_next(i)?
        .map_or((ItemVisibility::Default, None), |pair| (pair.0, Some(pair.1)));

    let decl_token = ty(i)?;
    let start = visibility_token.map(|t| t.start).unwrap_or_else(|| decl_token.start);
    whitespace(i)?;

    let name = alt((
        fun.map(|t| {
            Node::new(
                Identifier {
                    name: "fn".to_owned(),
                    digest: None,
                },
                t.start,
                t.end,
                t.module_id,
            )
        }),
        identifier,
    ))
    .parse_next(i)?;
    let mut end = name.end;

    let args = if peek((opt(whitespace), open_paren)).parse_next(i).is_ok() {
        ignore_whitespace(i);
        open_paren(i)?;
        ignore_whitespace(i);
        let args: Vec<_> = separated(0.., identifier, comma_sep).parse_next(i)?;
        ignore_trailing_comma(i);
        ignore_whitespace(i);
        end = close_paren(i)?.end;
        Some(args)
    } else {
        None
    };

    let alias = if peek((opt(whitespace), equals)).parse_next(i).is_ok() {
        ignore_whitespace(i);
        equals(i)?;
        ignore_whitespace(i);
        let ty = type_(i)?;

        ParseContext::warn(CompilationError::err(
            ty.as_source_range(),
            "Type aliases are experimental, likely to change in the future, and likely to not work properly.",
        ));

        Some(ty)
    } else {
        None
    };

    let module_id = name.module_id;
    let result = Node::boxed(
        TypeDeclaration {
            name,
            args,
            alias,
            visibility,
            digest: None,
        },
        start,
        end,
        module_id,
    );

    ParseContext::warn(CompilationError::err(
        result.as_source_range(),
        "Type declarations are experimental, likely to change, and may or may not do anything useful.",
    ));

    Ok(result)
}

impl TryFrom<Token> for Node<Identifier> {
    type Error = CompilationError;

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
            Err(CompilationError::fatal(
                token.as_source_range(),
                format!(
                    "Cannot assign a variable to a reserved keyword: {}",
                    token.value.as_str()
                ),
            ))
        }
    }
}

/// Parse a KCL identifier (name of a constant/variable/function)
fn identifier(i: &mut TokenSlice) -> ModalResult<Node<Identifier>> {
    any.try_map(Node::<Identifier>::try_from)
        .context(expected("an identifier, e.g. 'width' or 'myPart'"))
        .parse_next(i)
}

fn nameable_identifier(i: &mut TokenSlice) -> ModalResult<Node<Identifier>> {
    let result = identifier.parse_next(i)?;

    if !result.is_nameable() {
        let desc = if result.name == "_" {
            "Underscores"
        } else {
            "Names with a leading underscore"
        };
        ParseContext::err(CompilationError::err(
            SourceRange::new(result.start, result.end, result.module_id),
            format!("{desc} cannot be referred to, only declared."),
        ));
    }

    Ok(result)
}

fn name(i: &mut TokenSlice) -> ModalResult<Node<Name>> {
    let abs_path = opt(double_colon).parse_next(i)?;
    let mut idents: NodeList<Identifier> = separated(1.., nameable_identifier, double_colon)
        .parse_next(i)
        .map_err(|e| e.backtrack())?;

    let mut start = idents[0].start;
    if let Some(abs_path) = &abs_path {
        start = abs_path.start;
    }
    let abs_path = abs_path.is_some();

    let name = idents.pop().unwrap();
    let end = name.end;
    let module_id = name.module_id;
    let result = Node::new(
        Name {
            name,
            path: idents,
            abs_path,
            digest: None,
        },
        start,
        end,
        module_id,
    );

    if let Some(suggestion) = super::deprecation(&result.to_string(), DeprecationKind::Const) {
        ParseContext::warn(
            CompilationError::err(
                result.as_source_range(),
                format!("Using `{result}` is deprecated, prefer using `{suggestion}`."),
            )
            .with_suggestion(
                format!("Replace `{result}` with `{suggestion}`"),
                suggestion,
                None,
                Tag::Deprecated,
            ),
        );
    }

    Ok(result)
}

impl TryFrom<Token> for Node<TagDeclarator> {
    type Error = CompilationError;

    fn try_from(token: Token) -> Result<Self, Self::Error> {
        match token.token_type {
            TokenType::Word => {
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
            }
            TokenType::Number => Err(CompilationError::fatal(
                token.as_source_range(),
                format!(
                    "Tag names must not start with a number. Tag starts with `{}`",
                    token.value.as_str()
                ),
            )),

            // e.g. `line(%, $)` or `line(%, $ , 5)`
            TokenType::Brace | TokenType::Whitespace | TokenType::Comma => Err(CompilationError::fatal(
                token.as_source_range(),
                "Tag names must not be empty".to_string(),
            )),

            TokenType::Type => Err(CompilationError::fatal(
                token.as_source_range(),
                format!("Cannot assign a tag to a reserved keyword: {}", token.value.as_str()),
            )),

            _ => Err(CompilationError::fatal(
                token.as_source_range(),
                // this is `start with` because if most of these cases are in the middle, it ends
                // up hitting a different error path(e.g. including a bang) or being valid(e.g. including a comment) since it will get broken up into
                // multiple tokens
                format!("Tag names must not start with a {}", token.token_type),
            )),
        }
    }
}

/// Parse a Kcl tag that starts with a `$`.
fn tag(i: &mut TokenSlice) -> ModalResult<Node<TagDeclarator>> {
    dollar.parse_next(i)?;
    any.try_map(Node::<TagDeclarator>::try_from)
        .context(expected("a tag, e.g. '$seg01' or '$line01'"))
        .parse_next(i)
        .map_err(|e: ErrMode<ContextError>| e.cut())
}

/// Helper function. Matches any number of whitespace tokens and ignores them.
fn ignore_whitespace(i: &mut TokenSlice) {
    let _: ModalResult<()> = repeat(0.., whitespace).parse_next(i);
}

// A helper function to ignore a trailing comma.
fn ignore_trailing_comma(i: &mut TokenSlice) {
    let _ = opt(comma).parse_next(i);
}

/// Matches at least 1 whitespace.
fn require_whitespace(i: &mut TokenSlice) -> ModalResult<()> {
    repeat(1.., whitespace).parse_next(i)
}

fn unary_expression(i: &mut TokenSlice) -> ModalResult<Node<UnaryExpression>> {
    const EXPECTED: &str = "expected a unary operator (like '-', the negative-numeric operator),";
    let (operator, op_token) = any
        .try_map(|token: Token| match token.token_type {
            TokenType::Operator if token.value == "-" => Ok((UnaryOperator::Neg, token)),
            TokenType::Operator => Err(CompilationError::fatal(
                 token.as_source_range(),
                 format!("{EXPECTED} but found {} which is an operator, but not a unary one (unary operators apply to just a single operand, your operator applies to two or more operands)", token.value.as_str(),),
            )),
            TokenType::Bang => Ok((UnaryOperator::Not, token)),
            other => Err(CompilationError::fatal(  token.as_source_range(), format!("{EXPECTED} but found {} which is {}", token.value.as_str(), other,) )),
        })
        .context(expected("a unary expression, e.g. -x or -3"))
        .parse_next(i)?;
    let argument = operand.parse_next(i)?;
    Ok(Node::new_node(
        op_token.start,
        argument.end(),
        op_token.module_id,
        UnaryExpression {
            operator,
            argument,
            digest: None,
        },
    ))
}

/// Consume tokens that make up a binary expression, but don't actually return them.
/// Why not?
/// Because this is designed to be used with .take() within the `binary_expression` parser.
fn binary_expression_tokens(i: &mut TokenSlice) -> ModalResult<Vec<BinaryExpressionToken>> {
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
fn binary_expression(i: &mut TokenSlice) -> ModalResult<Node<BinaryExpression>> {
    // Find the slice of tokens which makes up the binary expression
    let tokens = binary_expression_tokens.parse_next(i)?;

    // Pass the token slice into the specialized math parser, for things like
    // precedence and converting infix operations to an AST.
    let expr = super::math::parse(tokens).map_err(|e| ErrMode::Backtrack(e.into()))?;
    Ok(expr)
}

fn binary_expr_in_parens(i: &mut TokenSlice) -> ModalResult<Node<BinaryExpression>> {
    let span_with_brackets = bracketed_section.take().parse_next(i)?;
    let mut span_no_brackets = span_with_brackets.without_ends();
    let expr = binary_expression.parse_next(&mut span_no_brackets)?;
    Ok(expr)
}

/// Match a starting bracket, then match to the corresponding end bracket.
/// Return the count of how many tokens are in that span
/// (not including the bracket tokens).
fn bracketed_section(i: &mut TokenSlice) -> ModalResult<usize> {
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
fn expression_stmt(i: &mut TokenSlice) -> ModalResult<Node<ExpressionStatement>> {
    let val = expression
        .context(expected(
            "an expression (i.e. a value, or an algorithm for calculating one), e.g. 'x + y' or '3' or 'width * 2'",
        ))
        .parse_next(i)?;
    Ok(Node::new_node(
        val.start(),
        val.end(),
        val.module_id(),
        ExpressionStatement {
            expression: val,
            digest: None,
        },
    ))
}

/// Parse the given brace symbol.
fn some_brace(symbol: &'static str, i: &mut TokenSlice) -> ModalResult<Token> {
    one_of((TokenType::Brace, symbol))
        .context(expected(symbol))
        .parse_next(i)
}

/// Parse a |> operator.
fn pipe_operator(i: &mut TokenSlice) -> ModalResult<Token> {
    one_of((TokenType::Operator, PIPE_OPERATOR))
        .context(expected(
            "the |> operator, used for 'piping' one function's output into another function's input",
        ))
        .parse_next(i)
}

fn ws_with_newline(i: &mut TokenSlice) -> ModalResult<Token> {
    one_of(TokenType::Whitespace)
        .verify(|token: &Token| token.value.contains('\n'))
        .context(expected("a newline, possibly with whitespace"))
        .parse_next(i)
}

/// (
fn open_paren(i: &mut TokenSlice) -> ModalResult<Token> {
    some_brace("(", i)
}

/// )
fn close_paren(i: &mut TokenSlice) -> ModalResult<Token> {
    some_brace(")", i)
}

/// [
fn open_bracket(i: &mut TokenSlice) -> ModalResult<Token> {
    some_brace("[", i)
}

/// ]
fn close_bracket(i: &mut TokenSlice) -> ModalResult<Token> {
    some_brace("]", i)
}

/// {
fn open_brace(i: &mut TokenSlice) -> ModalResult<Token> {
    some_brace("{", i)
}

/// }
fn close_brace(i: &mut TokenSlice) -> ModalResult<Token> {
    some_brace("}", i)
}

fn comma(i: &mut TokenSlice) -> ModalResult<()> {
    TokenType::Comma.parse_from(i)?;
    Ok(())
}

fn hash(i: &mut TokenSlice) -> ModalResult<()> {
    TokenType::Hash.parse_from(i)?;
    Ok(())
}

fn bang(i: &mut TokenSlice) -> ModalResult<Token> {
    TokenType::Bang.parse_from(i)
}

fn dollar(i: &mut TokenSlice) -> ModalResult<()> {
    TokenType::Dollar.parse_from(i)?;
    Ok(())
}

fn period(i: &mut TokenSlice) -> ModalResult<()> {
    TokenType::Period.parse_from(i)?;
    Ok(())
}

fn end_inclusive_range(i: &mut TokenSlice) -> ModalResult<Token> {
    any.try_map(|token: Token| {
        if matches!(token.token_type, TokenType::DoublePeriod) {
            Ok(token)
        } else {
            Err(CompilationError::fatal(
                token.as_source_range(),
                format!(
                    "expected a '..' (double period) found {} which is {}",
                    token.value.as_str(),
                    token.token_type
                ),
            ))
        }
    })
    .context(expected("the .. operator, used for array ranges like [0..10]"))
    .parse_next(i)
}

fn end_exclusive_range(i: &mut TokenSlice) -> ModalResult<Token> {
    any.try_map(|token: Token| {
        if matches!(token.token_type, TokenType::DoublePeriodLessThan) {
            Ok(token)
        } else {
            Err(CompilationError::fatal(
                token.as_source_range(),
                format!("expected a '..<' but found {}", token.value.as_str()),
            ))
        }
    })
    .context(expected("the ..< operator, used for array ranges like [0..<10]"))
    .parse_next(i)
}

fn colon(i: &mut TokenSlice) -> ModalResult<Token> {
    TokenType::Colon.parse_from(i)
}

fn semi_colon(i: &mut TokenSlice) -> ModalResult<Token> {
    TokenType::SemiColon.parse_from(i)
}

fn plus(i: &mut TokenSlice) -> ModalResult<Token> {
    one_of((TokenType::Operator, "+")).parse_next(i)
}

fn double_colon(i: &mut TokenSlice) -> ModalResult<Token> {
    TokenType::DoubleColon.parse_from(i)
}

fn equals(i: &mut TokenSlice) -> ModalResult<Token> {
    one_of((TokenType::Operator, "="))
        .context(expected("the equals operator, ="))
        .parse_next(i)
}

fn question_mark(i: &mut TokenSlice) -> ModalResult<()> {
    TokenType::QuestionMark.parse_from(i)?;
    Ok(())
}

fn at_sign(i: &mut TokenSlice) -> ModalResult<Token> {
    TokenType::At.parse_from(i)
}

fn fun(i: &mut TokenSlice) -> ModalResult<Token> {
    keyword(i, "fn")
}

fn ty(i: &mut TokenSlice) -> ModalResult<Token> {
    keyword(i, "type")
}

fn any_keyword(i: &mut TokenSlice) -> ModalResult<Token> {
    any.try_map(|token: Token| match token.token_type {
        TokenType::Keyword => Ok(token),
        _ => Err(CompilationError::fatal(
            token.as_source_range(),
            "expected some reserved keyword".to_owned(),
        )),
    })
    .parse_next(i)
}

fn keyword(i: &mut TokenSlice, expected: &str) -> ModalResult<Token> {
    any.try_map(|token: Token| match token.token_type {
        TokenType::Keyword if token.value == expected => Ok(token),
        _ => Err(CompilationError::fatal(
            token.as_source_range(),
            format!("expected '{expected}', found {}", token.value.as_str(),),
        )),
    })
    .parse_next(i)
}

/// Parse a comma, optionally followed by some whitespace.
fn comma_sep(i: &mut TokenSlice) -> ModalResult<()> {
    (opt(whitespace), comma, opt(whitespace))
        .context(expected("a comma, optionally followed by whitespace"))
        .parse_next(i)?;
    Ok(())
}

/// Parse a `|`, optionally followed by some whitespace.
fn pipe_sep(i: &mut TokenSlice) -> ModalResult<()> {
    (opt(whitespace), one_of((TokenType::Operator, "|")), opt(whitespace)).parse_next(i)?;
    Ok(())
}

fn labeled_argument(i: &mut TokenSlice) -> ModalResult<LabeledArg> {
    (
        opt((
            terminated(nameable_identifier, opt(whitespace)),
            terminated(one_of((TokenType::Operator, "=")), opt(whitespace)),
        )),
        expression,
    )
        .map(|(label, arg)| LabeledArg {
            label: label.map(|(l, _)| l),
            arg,
        })
        .parse_next(i)
}

fn record_ty_field(i: &mut TokenSlice) -> ModalResult<(Node<Identifier>, Node<Type>)> {
    (identifier, colon, opt(whitespace), type_)
        .map(|(id, _, _, ty)| (id, ty))
        .parse_next(i)
}

/// Parse a type in various positions.
fn type_(i: &mut TokenSlice) -> ModalResult<Node<Type>> {
    separated(1.., type_not_union, pipe_sep)
        .map(|mut tys: Vec<_>| {
            if tys.len() == 1 {
                tys.pop().unwrap()
            } else {
                let start = tys[0].start;
                let module_id = tys[0].module_id;
                let end = tys.last().unwrap().end;
                Node::new(Type::Union { tys }, start, end, module_id)
            }
        })
        .parse_next(i)
}

fn type_not_union(i: &mut TokenSlice) -> ModalResult<Node<Type>> {
    alt((
        // Object types
        (
            open_brace,
            opt(whitespace),
            separated(0.., record_ty_field, comma_sep),
            opt(whitespace),
            close_brace,
        )
            .try_map(|(open, _, params, _, close)| {
                Ok(Node::new(
                    Type::Object { properties: params },
                    open.start,
                    close.end,
                    open.module_id,
                ))
            }),
        // Array types
        array_type,
        // Primitive types
        primitive_type.map(|t| t.map(Type::Primitive)),
    ))
    .parse_next(i)
}

fn primitive_type(i: &mut TokenSlice) -> ModalResult<Node<PrimitiveType>> {
    alt((
        // A function type: `fn` (`(` type?, (id: type,)* `)` (`:` type)?)?
        (
            fun,
            opt((
                // `(` type?, (id: type,)* `)`
                delimited(
                    open_paren,
                    opt(alt((
                        // type, (id: type,)+
                        (
                            type_,
                            comma,
                            opt(whitespace),
                            separated(
                                1..,
                                (identifier, colon, opt(whitespace), type_).map(|(id, _, _, ty)| (id, ty)),
                                comma_sep,
                            ),
                        )
                            .map(|(t, _, _, args)| (Some(t), args)),
                        // (id: type,)+
                        separated(
                            1..,
                            (identifier, colon, opt(whitespace), type_).map(|(id, _, _, ty)| (id, ty)),
                            comma_sep,
                        )
                        .map(|args| (None, args)),
                        // type
                        type_.map(|t| (Some(t), Vec::new())),
                    ))),
                    close_paren,
                ),
                // `:` type
                opt((colon, opt(whitespace), type_)),
            )),
        )
            .map(|(t, tys)| {
                let mut ft = FunctionType::empty_fn_type();

                if let Some((args, ret)) = tys {
                    if let Some((unnamed, named)) = args {
                        if let Some(unnamed) = unnamed {
                            ft.unnamed_arg = Some(Box::new(unnamed));
                        }
                        ft.named_args = named;
                    }
                    if let Some((_, _, ty)) = ret {
                        ft.return_type = Some(Box::new(ty));
                    }
                }

                Node::new(PrimitiveType::Function(ft), t.start, t.end, t.module_id)
            }),
        // A named type, possibly with a numeric suffix.
        (identifier, opt(delimited(open_paren, uom_for_type, close_paren))).map(|(ident, suffix)| {
            let mut result = Node::new(PrimitiveType::Boolean, ident.start, ident.end, ident.module_id);
            result.inner =
                PrimitiveType::primitive_from_str(&ident.name, suffix).unwrap_or(PrimitiveType::Named { id: ident });
            result
        }),
    ))
    .parse_next(i)
}

fn array_type(i: &mut TokenSlice) -> ModalResult<Node<Type>> {
    fn opt_whitespace(i: &mut TokenSlice) -> ModalResult<()> {
        ignore_whitespace(i);
        Ok(())
    }

    open_bracket(i)?;
    let ty = type_(i)?;
    let len = opt((
        semi_colon,
        opt_whitespace,
        any.try_map(|token: Token| match token.token_type {
            TokenType::Number => {
                let value = token.uint_value().ok_or_else(|| {
                    CompilationError::fatal(
                        token.as_source_range(),
                        format!("Expected unsigned integer literal, found: {}", token.value),
                    )
                })?;

                Ok(value as usize)
            }
            _ => Err(CompilationError::fatal(token.as_source_range(), "invalid array length")),
        }),
        opt(plus),
    ))
    .parse_next(i)?;
    close_bracket(i)?;

    let len = if let Some((_, _, n, plus)) = len {
        if plus.is_some() {
            ArrayLen::Minimum(n)
        } else {
            ArrayLen::Known(n)
        }
    } else {
        ArrayLen::None
    };

    Ok(ty.map(|ty| Type::Array { ty: Box::new(ty), len }))
}

fn uom_for_type(i: &mut TokenSlice) -> ModalResult<NumericSuffix> {
    any.try_map(|t: Token| t.value.parse()).parse_next(i)
}

fn comment(i: &mut TokenSlice) -> ModalResult<Node<String>> {
    any.verify_map(|token: Token| {
        let value = match token.token_type {
            TokenType::LineComment => token.value,
            TokenType::BlockComment => token.value,
            _ => return None,
        };
        Some(Node::new(value, token.start, token.end, token.module_id))
    })
    .context(expected("Comment"))
    .parse_next(i)
}

fn comments(i: &mut TokenSlice) -> ModalResult<Node<Vec<String>>> {
    let comments: Vec<Node<String>> = repeat(1.., (comment, opt(whitespace)).map(|(c, _)| c)).parse_next(i)?;
    let start = comments[0].start;
    let module_id = comments[0].module_id;
    let end = comments.last().unwrap().end;
    let inner = comments.into_iter().map(|n| n.inner).collect();
    Ok(Node::new(inner, start, end, module_id))
}

struct ParamDescription {
    labeled: bool,
    arg_name: Token,
    type_: std::option::Option<Node<Type>>,
    default_value: Option<DefaultParamVal>,
    attr: Option<Node<Annotation>>,
    comments: Option<Node<Vec<String>>>,
}

fn parameter(i: &mut TokenSlice) -> ModalResult<ParamDescription> {
    let (_, comments, _, attr, _, found_at_sign, arg_name, question_mark, _, type_, _ws, default_literal) = (
        opt(whitespace),
        opt(comments),
        opt(whitespace),
        opt(outer_annotation),
        opt(whitespace),
        opt(at_sign),
        any.verify(|token: &Token| !matches!(token.token_type, TokenType::Brace) || token.value != ")"),
        opt(question_mark),
        opt(whitespace),
        opt((colon, opt(whitespace), type_).map(|tup| tup.2)),
        opt(whitespace),
        opt((equals, opt(whitespace), literal).map(|(_, _, literal)| literal)),
    )
        .parse_next(i)?;

    Ok(ParamDescription {
        labeled: found_at_sign.is_none(),
        arg_name,
        type_,
        default_value: match (question_mark.is_some(), default_literal) {
            (true, Some(lit)) => Some(DefaultParamVal::Literal(*lit)),
            (true, None) => Some(DefaultParamVal::none()),
            (false, None) => None,
            (false, Some(lit)) => {
                let msg = "You're trying to set a default value for an argument, but only optional arguments can have default values, and this argument is mandatory. Try putting a ? after the argument name, to make the argument optional.";
                let e = CompilationError::fatal((&lit).into(), msg);
                return Err(ErrMode::Backtrack(ContextError::from(e)));
            }
        },
        attr,
        comments,
    })
}

/// Parameters are declared in a function signature, and used within a function.
fn parameters(i: &mut TokenSlice) -> ModalResult<Vec<Parameter>> {
    // Get all tokens until the next ), because that ends the parameter list.
    let candidates: Vec<_> = separated(0.., parameter, comma_sep)
        .context(expected("function parameters"))
        .parse_next(i)?;
    opt(comma_sep).parse_next(i)?;

    // Make sure all those tokens are valid parameters.
    let params: Vec<Parameter> = candidates
        .into_iter()
        .map(
            |ParamDescription {
                 labeled,
                 arg_name,
                 type_,
                 default_value,
                 attr,
                 comments,
             }| {
                let mut identifier = Node::<Identifier>::try_from(arg_name)?;
                if let Some(comments) = comments {
                    identifier.comment_start = comments.start;
                    identifier.pre_comments = comments.inner;
                }
                if let Some(attr) = attr {
                    identifier.outer_attrs.push(attr);
                }

                Ok(Parameter {
                    identifier,
                    type_,
                    default_value,
                    labeled,
                    digest: None,
                })
            },
        )
        .collect::<Result<_, _>>()
        .map_err(|e: CompilationError| ErrMode::Backtrack(ContextError::from(e)))?;

    // Make sure the only unlabeled parameter is the first one.
    if let Some(param) = params.iter().skip(1).find(|param| !param.labeled) {
        let source_range = SourceRange::from(param);
        return Err(ErrMode::Cut(ContextError::from(CompilationError::fatal(
            source_range,
            "Only the first parameter can be declared unlabeled",
        ))));
    }

    // Make sure optional parameters are last.
    if let Err(e) = optional_after_required(&params) {
        return Err(ErrMode::Cut(ContextError::from(e)));
    }
    Ok(params)
}

fn optional_after_required(params: &[Parameter]) -> Result<(), CompilationError> {
    let mut found_optional = false;
    for p in params {
        if p.optional() {
            found_optional = true;
        }
        if !p.optional() && found_optional {
            let e = CompilationError::fatal(
                (&p.identifier).into(),
                "mandatory parameters must be declared before optional parameters",
            );
            return Err(e);
        }
    }
    Ok(())
}

/// Introduce a new name, which binds some value.
fn binding_name(i: &mut TokenSlice) -> ModalResult<Node<Identifier>> {
    identifier
        .context(expected("an identifier, which will be the name of some value"))
        .parse_next(i)
}

/// Either a positional or keyword function call.
fn fn_call_pos_or_kw(i: &mut TokenSlice) -> ModalResult<Expr> {
    fn_call_kw.map(Box::new).map(Expr::CallExpressionKw).parse_next(i)
}

fn labelled_fn_call(i: &mut TokenSlice) -> ModalResult<Expr> {
    let expr = fn_call_pos_or_kw.parse_next(i)?;

    let label = opt(label).parse_next(i)?;
    match label {
        Some(label) => Ok(Expr::LabelledExpression(Box::new(LabelledExpression::new(expr, label)))),
        None => Ok(expr),
    }
}

fn fn_call_kw(i: &mut TokenSlice) -> ModalResult<Node<CallExpressionKw>> {
    let fn_name = name(i)?;
    opt(whitespace).parse_next(i)?;
    let _ = open_paren.parse_next(i)?;
    ignore_whitespace(i);

    // Special case: no args
    let early_close = peek(close_paren).parse_next(i);
    if early_close.is_ok() {
        let cl = close_paren.parse_next(i)?;
        let result = Node::new_node(
            fn_name.start,
            cl.end,
            fn_name.module_id,
            CallExpressionKw {
                callee: fn_name,
                unlabeled: Default::default(),
                arguments: Default::default(),
                digest: None,
                non_code_meta: Default::default(),
            },
        );
        return Ok(result);
    }

    // Special case: one arg (unlabeled)
    let early_close = peek((expression, opt(whitespace), close_paren)).parse_next(i);
    if early_close.is_ok() {
        let first_expression = expression.parse_next(i)?;
        ignore_whitespace(i);
        let end = close_paren.parse_next(i)?.end;
        let result = Node::new_node(
            fn_name.start,
            end,
            fn_name.module_id,
            CallExpressionKw {
                callee: fn_name,
                unlabeled: Some(first_expression),
                arguments: Default::default(),
                digest: None,
                non_code_meta: Default::default(),
            },
        );
        return Ok(result);
    }

    #[derive(Debug)]
    #[allow(clippy::large_enum_variant)]
    enum ArgPlace {
        NonCode(Node<NonCodeNode>),
        LabeledArg((LabeledArg, Option<SourceRange>)),
        UnlabeledArg(Expr),
        Keyword(Token),
    }
    let initial_unlabeled_arg = opt((expression, comma, opt(whitespace)).map(|(arg, _, _)| arg)).parse_next(i)?;
    let args: Vec<_> = repeat(
        0..,
        alt((
            terminated(non_code_node.map(ArgPlace::NonCode), whitespace),
            terminated(any_keyword.map(ArgPlace::Keyword), whitespace),
            (labeled_argument, labeled_arg_separator).map(ArgPlace::LabeledArg),
            expression.map(ArgPlace::UnlabeledArg),
        )),
    )
    .parse_next(i)?;
    let (args, non_code_nodes): (Vec<_>, BTreeMap<usize, _>) = args.into_iter().enumerate().try_fold(
        (Vec::new(), BTreeMap::new()),
        |(mut args, mut non_code_nodes), (index, e)| {
            match e {
                ArgPlace::NonCode(x) => {
                    non_code_nodes.insert(index, vec![x]);
                }
                ArgPlace::LabeledArg((x, bad_token_source_range)) => {
                    if let Some(bad_token_source_range) = bad_token_source_range {
                        return Err(ErrMode::Cut(
                            CompilationError::fatal(
                                bad_token_source_range,
                                "Missing comma between arguments, try adding a comma in",
                            )
                            .into(),
                        ));
                    }
                    args.push(x);
                }
                ArgPlace::Keyword(kw) => {
                    return Err(ErrMode::Cut(
                        CompilationError::fatal(
                            SourceRange::from(kw.clone()),
                            format!(
                                "`{}` is not the name of an argument (it's a reserved keyword)",
                                kw.value
                            ),
                        )
                        .into(),
                    ));
                }
                ArgPlace::UnlabeledArg(arg) => {
                    let followed_by_equals = peek((opt(whitespace), equals)).parse_next(i).is_ok();
                    if followed_by_equals {
                        return Err(ErrMode::Cut(
                            CompilationError::fatal(
                                SourceRange::from(arg),
                                "This argument has a label, but no value. Put some value after the equals sign",
                            )
                            .into(),
                        ));
                    } else {
                        args.push(LabeledArg { label: None, arg });
                    }
                }
            }
            Ok((args, non_code_nodes))
        },
    )?;
    ignore_whitespace(i);
    opt(comma_sep).parse_next(i)?;
    let end = match close_paren.parse_next(i) {
        Ok(tok) => tok.end,
        Err(e) => {
            if let Some(tok) = i.next_token() {
                return Err(ErrMode::Cut(
                    CompilationError::fatal(
                        SourceRange::from(&tok),
                        format!("There was an unexpected `{}`. Try removing it.", tok.value),
                    )
                    .into(),
                ));
            } else {
                return Err(e);
            }
        }
    };

    // Validate there aren't any duplicate labels.
    let mut counted_labels = IndexMap::with_capacity(args.len());
    for arg in &args {
        if let Some(l) = &arg.label {
            *counted_labels.entry(&l.inner.name).or_insert(0) += 1;
        }
    }
    if let Some((duplicated, n)) = counted_labels.iter().find(|(_label, n)| n > &&1) {
        let msg = format!(
            "You've used the parameter labelled '{duplicated}' {n} times in a single function call. You can only set each parameter once! Remove all but one use."
        );
        ParseContext::err(CompilationError::err(
            SourceRange::new(fn_name.start, end, fn_name.module_id),
            msg,
        ));
    }

    let non_code_meta = NonCodeMeta {
        non_code_nodes,
        ..Default::default()
    };
    let result = Node::new_node(
        fn_name.start,
        end,
        fn_name.module_id,
        CallExpressionKw {
            callee: fn_name,
            unlabeled: initial_unlabeled_arg,
            arguments: args,
            digest: None,
            non_code_meta,
        },
    );

    let callee_str = result.callee.name.name.to_string();
    if let Some(suggestion) = super::deprecation(&callee_str, DeprecationKind::Function) {
        ParseContext::warn(
            CompilationError::err(
                result.as_source_range(),
                format!("Calling `{callee_str}` is deprecated, prefer using `{suggestion}`."),
            )
            .with_suggestion(
                format!("Replace `{callee_str}` with `{suggestion}`"),
                suggestion,
                None,
                Tag::Deprecated,
            ),
        );
    }

    Ok(result)
}

#[cfg(test)]
mod tests {
    use itertools::Itertools;
    use pretty_assertions::assert_eq;

    use super::*;
    use crate::{
        ModuleId,
        parsing::ast::types::{BodyItem, Expr, VariableKind},
    };

    fn assert_reserved(word: &str) {
        // Try to use it as a variable name.
        let code = format!(r#"{word} = 0"#);
        let result = crate::parsing::top_level_parse(code.as_str());
        let err = &result.unwrap_errs().next().unwrap();
        // Which token causes the error may change.  In "return = 0", for
        // example, "return" is the problem.
        assert!(
            err.message.starts_with("Unexpected token: ")
                || err.message.starts_with("= is not")
                || err
                    .message
                    .starts_with("Cannot assign a variable to a reserved keyword: "),
            "Error message is: `{}`",
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
    fn parse_names() {
        for (test, expected_len) in [("someVar", 0), ("::foo", 0), ("foo::bar::baz", 2)] {
            let tokens = crate::parsing::token::lex(test, ModuleId::default()).unwrap();
            match name.parse(tokens.as_slice()) {
                Ok(n) => assert_eq!(n.path.len(), expected_len, "Could not parse name from `{test}`: {n:?}"),
                Err(e) => panic!("Could not parse name from `{test}`: {e:?}"),
            }
        }
    }

    #[test]
    fn weird_program_unclosed_paren() {
        let tokens = crate::parsing::token::lex("fn firstPrime(", ModuleId::default()).unwrap();
        let tokens = tokens.as_slice();
        let last = tokens.last().unwrap().as_source_range();
        let err: CompilationError = program.parse(tokens).unwrap_err().into();
        assert_eq!(err.source_range, last);
        // TODO: Better comment. This should explain the compiler expected ) because the user had started declaring the function's parameters.
        // Part of https://github.com/KittyCAD/modeling-app/issues/784
        assert_eq!(err.message, "Unexpected end of file. The compiler expected )");
    }

    #[test]
    fn kw_call_as_operand() {
        let tokens = crate::parsing::token::lex("f(x = 1)", ModuleId::default()).unwrap();
        let tokens = tokens.as_slice();
        operand.parse(tokens).unwrap();
    }

    #[test]
    fn parse_binary_operator_on_array() {
        let tokens = crate::parsing::token::lex("[0] + 1", ModuleId::default()).unwrap();
        let tokens = tokens.as_slice();
        binary_expression.parse(tokens).unwrap();
    }

    #[test]
    fn parse_binary_operator_on_object() {
        let tokens = crate::parsing::token::lex("{ a = 1 } + 2", ModuleId::default()).unwrap();
        let tokens = tokens.as_slice();
        binary_expression.parse(tokens).unwrap();
    }

    #[test]
    fn parse_call_array_operator() {
        let tokens = crate::parsing::token::lex("f([0] + 1)", ModuleId::default()).unwrap();
        let tokens = tokens.as_slice();
        fn_call_kw.parse(tokens).unwrap();
    }

    #[test]
    fn weird_program_just_a_pipe() {
        let tokens = crate::parsing::token::lex("|", ModuleId::default()).unwrap();
        let err: CompilationError = program.parse(tokens.as_slice()).unwrap_err().into();
        assert_eq!(err.source_range, SourceRange::new(0, 1, ModuleId::default()));
        assert_eq!(err.message, "Unexpected token: |");
    }

    #[test]
    fn parse_binary_expressions() {
        for (i, test_program) in ["1 + 2 + 3"].into_iter().enumerate() {
            let tokens = crate::parsing::token::lex(test_program, ModuleId::default()).unwrap();
            let _actual = match binary_expression.parse_next(&mut tokens.as_slice()) {
                Ok(x) => x,
                Err(e) => panic!("Failed test {i}, could not parse binary expressions from \"{test_program}\": {e:?}"),
            };
        }
    }

    #[test]
    fn test_vardec_no_keyword() {
        let tokens = crate::parsing::token::lex("x = 4", ModuleId::default()).unwrap();
        let vardec = declaration(&mut tokens.as_slice()).unwrap();
        assert_eq!(vardec.inner.kind, VariableKind::Const);
        let vardec = &vardec.declaration;
        assert_eq!(vardec.id.name, "x");
        let Expr::Literal(init_val) = &vardec.init else {
            panic!("weird init value")
        };
        assert_eq!(init_val.raw, "4");
    }

    #[test]
    fn test_negative_operands() {
        let tokens = crate::parsing::token::lex("-leg2", ModuleId::default()).unwrap();
        let _s = operand.parse_next(&mut tokens.as_slice()).unwrap();
    }

    #[test]
    fn test_comments_in_function1() {
        let test_program = r#"() {
            // comment 0
            a = 1
            // comment 1
            b = 2
            /// comment 2
            return 1
        }"#;
        let tokens = crate::parsing::token::lex(test_program, ModuleId::default()).unwrap();
        let expr = function_decl.parse_next(&mut tokens.as_slice()).unwrap();
        assert_eq!(expr.params, vec![]);
        let comment_start = expr.body.body[0].get_comments();
        let comment0 = expr.body.body[1].get_comments();
        let comment1 = expr.body.body[2].get_comments();
        assert_eq!(comment_start, vec!["// comment 0".to_owned()]);
        assert_eq!(comment0, vec!["// comment 1".to_owned()]);
        assert_eq!(comment1, vec!["/// comment 2".to_owned()]);
    }

    #[test]
    fn test_comments_in_function2() {
        let test_program = r#"() {
  yo = { a = { b = { c = '123' } } } /* block
comment */
}"#;
        let tokens = crate::parsing::token::lex(test_program, ModuleId::default()).unwrap();
        let expr = function_decl.parse_next(&mut tokens.as_slice()).unwrap();
        let comment0 = &expr.body.non_code_meta.non_code_nodes.get(&0).unwrap()[0];
        assert_eq!(comment0.value(), "block\ncomment");
    }

    #[test]
    fn test_comment_at_start_of_program() {
        let test_program = r#"
/* comment at start */

mySk1 = startSketchOn(XY)
  |> startProfile(at = [0, 0])"#;
        let tokens = crate::parsing::token::lex(test_program, ModuleId::default()).unwrap();
        let program = program.parse(tokens.as_slice()).unwrap();
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
        let tokens = crate::parsing::token::lex(r#"x = y() |> /*hi*/ z(%)"#, ModuleId::default()).unwrap();
        let mut body = program.parse(tokens.as_slice()).unwrap().inner.body;
        let BodyItem::VariableDeclaration(item) = body.remove(0) else {
            panic!("expected vardec");
        };
        let val = item.inner.declaration.inner.init;
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
        let tokens = crate::parsing::token::lex(test_program, ModuleId::default()).unwrap();
        let _expr = function_decl.parse_next(&mut tokens.as_slice()).unwrap();
    }

    #[test]
    fn test_empty_lines_in_function() {
        let test_program = "() {

                return 2
            }";
        let module_id = ModuleId::from_usize(1);
        let tokens = crate::parsing::token::lex(test_program, module_id).unwrap();
        let expr = function_decl.parse_next(&mut tokens.as_slice()).unwrap();
        assert_eq!(
            expr.body.non_code_meta.start_nodes,
            vec![Node::new(
                NonCodeNode {
                    value: NonCodeValue::NewLine,
                    digest: None
                },
                4,
                22,
                module_id,
            )]
        );
    }

    #[test]
    fn inline_comment_pipe_expression() {
        let test_input = r#"a(XY)
        |> b(%)
        |> c(%) // inline-comment
        |> d(%)"#;

        let tokens = crate::parsing::token::lex(test_input, ModuleId::default()).unwrap();
        let Node {
            inner: PipeExpression {
                body, non_code_meta, ..
            },
            ..
        } = pipe_expression.parse_next(&mut tokens.as_slice()).unwrap();
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
  yo = { a = { b = { c = '123' } } } /* block
  comment */

  key = 'c'
  // this is also a comment
  return things
"#;

        let module_id = ModuleId::default();
        let tokens = crate::parsing::token::lex(test_program, module_id).unwrap();
        let Program {
            body, non_code_meta, ..
        } = function_body.parse(tokens.as_slice()).unwrap().inner;
        assert_eq!(body[0].get_comments(), vec!["// this is a comment".to_owned()],);

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
                    57,
                    79,
                    module_id,
                ),
                Node::new(
                    NonCodeNode {
                        value: NonCodeValue::NewLine,
                        digest: None,
                    },
                    79,
                    83,
                    module_id,
                )
            ]),
            non_code_meta.non_code_nodes.get(&0),
        );

        assert_eq!(body[2].get_comments(), vec!["// this is also a comment".to_owned()],);
    }

    #[test]
    fn inline_block_comments() {
        let test_program = r#"yo = 3 /* block
  comment */
  return 1"#;

        let tokens = crate::parsing::token::lex(test_program, ModuleId::default()).unwrap();
        let actual = program.parse(tokens.as_slice()).unwrap();
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
        let tokens = crate::parsing::token::lex(input, ModuleId::default()).unwrap();
        let actual = match binary_expr_in_parens.parse(tokens.as_slice()) {
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
            let tokens = crate::parsing::token::lex(input, ModuleId::default()).unwrap();
            let _actual = match expression.parse(tokens.as_slice()) {
                Ok(x) => x,
                Err(e) => panic!("{e:?}"),
            };
        }
    }

    #[test]
    fn test_arithmetic() {
        let input = "1 * (2 - 3)";
        let tokens = crate::parsing::token::lex(input, ModuleId::default()).unwrap();
        // The RHS should be a binary expression.
        let actual = binary_expression.parse(tokens.as_slice()).unwrap();
        assert_eq!(actual.operator, BinaryOperator::Mul);
        let BinaryPart::BinaryExpression(rhs) = actual.inner.right else {
            panic!("Expected RHS to be another binary expression");
        };
        assert_eq!(rhs.operator, BinaryOperator::Sub);
        match &rhs.right {
            BinaryPart::Literal(lit) => {
                assert!(lit.start == 9 && lit.end == 10);
                assert!(
                    lit.value
                        == LiteralValue::Number {
                            value: 3.0,
                            suffix: NumericSuffix::None
                        }
                        && &lit.raw == "3"
                        && lit.digest.is_none()
                );
            }
            _ => panic!(),
        }
    }

    #[test]
    fn assign_brackets() {
        for (i, test_input) in [
            "thickness_squared = (1 + 1)",
            "thickness_squared = ( 1 + 1)",
            "thickness_squared = (1 + 1 )",
            "thickness_squared = ( 1 + 1 )",
        ]
        .into_iter()
        .enumerate()
        {
            let tokens = crate::parsing::token::lex(test_input, ModuleId::default()).unwrap();
            let actual = match declaration.parse(tokens.as_slice()) {
                Err(e) => panic!("Could not parse test {i}: {e:#?}"),
                Ok(a) => a,
            };
            let Expr::BinaryExpression(_expr) = &actual.declaration.inner.init else {
                panic!(
                    "Expected test {i} to be a binary expression but it wasn't, it was {:?}",
                    actual.declaration
                );
            };
            // TODO: check both sides are 1... probably not necessary but should do.
        }
    }

    #[test]
    fn test_function_call() {
        for (i, test_input) in ["x = f(1)", "x = f( 1 )"].into_iter().enumerate() {
            let tokens = crate::parsing::token::lex(test_input, ModuleId::default()).unwrap();
            let _actual = match declaration.parse(tokens.as_slice()) {
                Err(e) => panic!("Could not parse test {i}: {e:#?}"),
                Ok(a) => a,
            };
        }
    }

    #[test]
    fn test_nested_arithmetic() {
        let input = "1 * ((2 - 3) / 4)";
        let tokens = crate::parsing::token::lex(input, ModuleId::default()).unwrap();
        // The RHS should be a binary expression.
        let outer = binary_expression.parse(tokens.as_slice()).unwrap();
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
            let tokens = crate::parsing::token::lex(test, ModuleId::default()).unwrap();
            let actual = binary_expression.parse(tokens.as_slice()).unwrap();
            assert_eq!(actual.operator, BinaryOperator::Sub);
            let BinaryPart::Literal(left) = actual.inner.left else {
                panic!("should be expression");
            };
            assert_eq!(
                left.value,
                LiteralValue::Number {
                    value: 1.0,
                    suffix: NumericSuffix::None
                }
            );
            let BinaryPart::Literal(right) = actual.inner.right else {
                panic!("should be expression");
            };
            assert_eq!(
                right.value,
                LiteralValue::Number {
                    value: 2.0,
                    suffix: NumericSuffix::None
                }
            );
        }
    }

    #[test]
    fn some_pipe_expr() {
        let test_program = r#"x()
        |> y(%) /* this is
        a comment
        spanning a few lines */
        |> z(%)"#;
        let tokens = crate::parsing::token::lex(test_program, ModuleId::default()).unwrap();
        let actual = pipe_expression.parse(tokens.as_slice()).unwrap();
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
            let tokens = crate::parsing::token::lex(test_program, ModuleId::default()).unwrap();
            let actual = pipe_expression.parse(tokens.as_slice());
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
            let tokens = crate::parsing::token::lex(test_program, module_id).unwrap();
            let actual = non_code_node.parse(tokens.as_slice());
            assert!(actual.is_ok(), "could not parse test {i}: {actual:#?}");
            let actual = actual.unwrap();
            assert_eq!(actual, expected, "failed test {i}");
        }
    }

    #[test]
    fn recognize_invalid_params() {
        let test_fn = "(let) => { return 1 }";
        let module_id = ModuleId::from_usize(2);
        let tokens = crate::parsing::token::lex(test_fn, module_id).unwrap();
        let err = function_decl.parse(tokens.as_slice()).unwrap_err().into_inner();
        let cause = err.cause.unwrap();
        // This is the token `let`
        assert_eq!(cause.source_range, SourceRange::new(1, 4, ModuleId::from_usize(2)));
        assert_eq!(cause.message, "Cannot assign a variable to a reserved keyword: let");
    }

    #[test]
    fn comment_in_string() {
        let string_literal = r#""
           // a comment
             ""#;
        let tokens = crate::parsing::token::lex(string_literal, ModuleId::default()).unwrap();
        let parsed_literal = literal.parse(tokens.as_slice()).unwrap();
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
        let test_program = r#"startSketchOn(XY)
        |> startProfile(at = [0, 0])
        |> line(endAbsolute = [0, -0]) // MoveRelative

        "#;
        let tokens = crate::parsing::token::lex(test_program, ModuleId::default()).unwrap();
        let tokens = &mut tokens.as_slice();
        let _actual = pipe_expression.parse_next(tokens).unwrap();
        assert_eq!(tokens.first().unwrap().token_type, TokenType::Whitespace);
    }

    #[test]
    fn test_pipes_on_pipes() {
        let test_program = include_str!("../../e2e/executor/inputs/pipes_on_pipes.kcl");
        let tokens = crate::parsing::token::lex(test_program, ModuleId::default()).unwrap();
        let _ = run_parser(tokens.as_slice()).unwrap();
    }

    #[test]
    fn test_cube() {
        let test_program = include_str!("../../e2e/executor/inputs/cube.kcl");
        let tokens = crate::parsing::token::lex(test_program, ModuleId::default()).unwrap();
        match program.parse(tokens.as_slice()) {
            Ok(_) => {}
            Err(e) => {
                panic!("{e:#?}");
            }
        }
    }

    #[test]
    fn parse_numeric() {
        let test_program = "fn foo(x: number(Length)) {}";
        let tokens = crate::parsing::token::lex(test_program, ModuleId::default()).unwrap();
        run_parser(tokens.as_slice()).unwrap();

        let test_program = "42_mm";
        let tokens = crate::parsing::token::lex(test_program, ModuleId::default()).unwrap();
        assert_eq!(tokens.iter().count(), 1);
        run_parser(tokens.as_slice()).unwrap();

        let test_program = "42_Length";
        let tokens = crate::parsing::token::lex(test_program, ModuleId::default()).unwrap();
        assert_eq!(tokens.iter().count(), 2);
        assert_eq!(run_parser(tokens.as_slice()).unwrap_errs().count(), 1);
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
            let tokens = crate::parsing::token::lex(input, ModuleId::default()).unwrap();
            let actual = parameters.parse(tokens.as_slice());
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

        let tokens = crate::parsing::token::lex(input, ModuleId::default()).unwrap();
        let actual = function_decl.parse(tokens.as_slice());
        assert!(actual.is_ok(), "could not parse test function");
    }

    #[test]
    fn test_declaration() {
        let tests = ["myVar = 5", "myVar=5", "myVar =5", "myVar= 5"];
        for test in tests {
            // Run the original parser
            let tokens = crate::parsing::token::lex(test, ModuleId::default()).unwrap();
            let mut expected_body = crate::parsing::parse_tokens(tokens.clone()).unwrap().inner.body;
            assert_eq!(expected_body.len(), 1);
            let BodyItem::VariableDeclaration(expected) = expected_body.pop().unwrap() else {
                panic!("Expected variable declaration");
            };

            // Run the second parser, check it matches the first parser.
            let actual = declaration.parse(tokens.as_slice()).unwrap();
            assert_eq!(expected, actual);

            // Inspect its output in more detail.
            assert_eq!(actual.inner.kind, VariableKind::Const);
            assert_eq!(actual.start, 0);
            let decl = &actual.declaration;
            assert_eq!(decl.id.name, "myVar");
            let Expr::Literal(value) = &decl.inner.init else {
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
                        value: LiteralValue::Number {
                            value: 5.0,
                            suffix: NumericSuffix::None,
                        },
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
                                        value: LiteralValue::Number {
                                            value: 5.0,
                                            suffix: NumericSuffix::None,
                                        },
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
                                        value: LiteralValue::Number {
                                            value: 6.0,
                                            suffix: NumericSuffix::None,
                                        },
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
                inner_attrs: Vec::new(),
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
        assert!(result.1.iter().all(|e| !e.severity.is_err()), "found: {:#?}", result.1);
        (result.0.unwrap(), result.1)
    }

    #[track_caller]
    fn assert_no_fatal(p: &str) -> (Node<Program>, Vec<CompilationError>) {
        let result = crate::parsing::top_level_parse(p);
        let result = result.0.unwrap();
        assert!(
            result.1.iter().all(|e| e.severity != Severity::Fatal),
            "found: {:#?}",
            result.1
        );
        (result.0.unwrap(), result.1)
    }

    #[track_caller]
    fn assert_err(p: &str, msg: &str, src_expected: [usize; 2]) {
        let result = crate::parsing::top_level_parse(p);
        let err = result.unwrap_errs().next().unwrap();
        assert!(
            err.message.starts_with(msg),
            "Found `{}`, expected `{msg}`",
            err.message
        );
        let src_actual = [err.source_range.start(), err.source_range.end()];
        assert_eq!(
            src_expected,
            src_actual,
            "expected error would highlight `{}` but it actually highlighted `{}`",
            &p[src_expected[0]..src_expected[1]],
            &p[src_actual[0]..src_actual[1]],
        );
    }

    #[track_caller]
    fn assert_err_contains(p: &str, expected: &str) {
        let result = crate::parsing::top_level_parse(p);
        let err = &result.unwrap_errs().next().unwrap().message;
        assert!(err.contains(expected), "actual='{err}'");
    }

    #[test]
    fn test_parse_half_pipe_small() {
        assert_err_contains(
            "secondExtrude = startSketchOn(XY)
  |> startProfile(at = [0,0])
  |",
            "Unexpected token: |",
        );
    }

    #[test]
    fn test_parse_member_expression_double_nested_braces() {
        let code = r#"prop = yo["one"][two]"#;
        crate::parsing::top_level_parse(code).unwrap();
    }

    #[test]
    fn test_parse_member_expression_binary_expression_period_number_first() {
        let code = r#"obj = { a: 1, b: 2 }
height = 1 - obj.a"#;
        crate::parsing::top_level_parse(code).unwrap();
    }

    #[test]
    fn test_parse_member_expression_allowed_type_in_expression() {
        let code = r#"obj = { thing: 1 }
startSketchOn(obj.sketch)"#;

        crate::parsing::top_level_parse(code).unwrap();
    }

    #[test]
    fn test_parse_member_expression_binary_expression_brace_number_first() {
        let code = r#"obj = { a: 1, b: 2 }
height = 1 - obj["a"]"#;
        crate::parsing::top_level_parse(code).unwrap();
    }

    #[test]
    fn test_parse_member_expression_binary_expression_brace_number_second() {
        let code = r#"obj = { a: 1, b: 2 }
height = obj["a"] - 1"#;
        crate::parsing::top_level_parse(code).unwrap();
    }

    #[test]
    fn test_parse_member_expression_binary_expression_in_array_number_first() {
        let code = r#"obj = { a: 1, b: 2 }
height = [1 - obj["a"], 0]"#;
        crate::parsing::top_level_parse(code).unwrap();
    }

    #[test]
    fn test_parse_member_expression_binary_expression_in_array_number_second() {
        let code = r#"obj = { a: 1, b: 2 }
height = [obj["a"] - 1, 0]"#;
        crate::parsing::top_level_parse(code).unwrap();
    }

    #[test]
    fn test_parse_member_expression_binary_expression_in_array_number_second_missing_space() {
        let code = r#"obj = { a: 1, b: 2 }
height = [obj["a"] -1, 0]"#;
        crate::parsing::top_level_parse(code).unwrap();
    }

    #[test]
    fn test_anon_fn() {
        crate::parsing::top_level_parse("foo(num=42, closure=fn(x) { return x + 1 })").unwrap();
    }

    #[test]
    fn test_annotation_fn() {
        crate::parsing::top_level_parse(
            r#"fn foo() {
  @annotated
  return 1
}"#,
        )
        .unwrap();
    }

    #[test]
    fn test_annotation_settings() {
        crate::parsing::top_level_parse("@settings(units = mm)").unwrap();
    }

    #[test]
    fn test_anon_fn_no_fn() {
        assert_err_contains("foo(42, (x) { return x + 1 })", "Anonymous function requires `fn`");
    }

    #[test]
    fn test_parse_half_pipe() {
        let code = "height = 10

firstExtrude = startSketchOn(XY)
  |> startProfile(at = [0,0])
  |> line(at = [0, 8])
  |> line(at = [20, 0])
  |> line(at = [0, -8])
  |> close()
  |> extrude(length=2)

secondExtrude = startSketchOn(XY)
  |> startProfile(at = [0,0])
  |";
        assert_err_contains(code, "Unexpected token: |");
    }

    #[test]
    fn test_parse_greater_bang() {
        assert_err(">!", "Unexpected token: >", [0, 1]);
    }

    #[test]
    fn test_parse_unlabeled_param_not_allowed() {
        assert_err(
            "fn f(@x, @y) { return 1 }",
            "Only the first parameter can be declared unlabeled",
            [9, 11],
        );
        assert_err(
            "fn f(x, @y) { return 1 }",
            "Only the first parameter can be declared unlabeled",
            [8, 10],
        );
    }

    #[test]
    fn test_parse_z_percent_parens() {
        assert_err("z%)", "Unexpected token: %", [1, 2]);
    }

    #[test]
    fn test_parse_parens_unicode() {
        let result = crate::parsing::top_level_parse("(ޜ");
        let details = result.0.unwrap().1.pop().unwrap();
        // TODO: Highlight where the unmatched open parenthesis is.
        // https://github.com/KittyCAD/modeling-app/issues/696
        assert_eq!(details.message, "Unexpected end of file. The compiler expected )");
    }

    #[test]
    fn test_parse_negative_in_array_binary_expression() {
        let code = r#"leg1 = 5
thickness = 0.56

bracket = [-leg2 + thickness, 0]
"#;
        crate::parsing::top_level_parse(code).unwrap();
    }

    #[test]
    fn test_parse_nested_open_brackets() {
        let _ = crate::parsing::top_level_parse(
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
            "There was an unexpected `-`. Try removing it.",
            [3, 4],
        );
    }

    #[test]
    fn test_parse_weird_lots_of_fancy_brackets() {
        assert_err(
            r#"zz({{{{{{{{)iegAng{{{{{{{##"#,
            "Encountered an unexpected character(s) before finding a closing brace(`}`) for the object",
            [3, 4],
        );
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
                    default_value: Some(DefaultParamVal::none()),
                    labeled: true,
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
                    default_value: None,
                    labeled: true,
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
                        default_value: None,
                        labeled: true,
                        digest: None,
                    },
                    Parameter {
                        identifier: Node::no_src(Identifier {
                            name: "b".to_owned(),
                            digest: None,
                        }),
                        type_: None,
                        default_value: Some(DefaultParamVal::none()),
                        labeled: true,
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
                        default_value: Some(DefaultParamVal::none()),
                        labeled: true,
                        digest: None,
                    },
                    Parameter {
                        identifier: Node::no_src(Identifier {
                            name: "b".to_owned(),
                            digest: None,
                        }),
                        type_: None,
                        default_value: None,
                        labeled: true,
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
    fn bad_imports() {
        assert_err(
            r#"import cube from "../cube.kcl""#,
            "import path may not start with '..'. Cannot traverse to something outside the bounds of your project. If this path is inside your project please find a better way to reference it.",
            [17, 30],
        );
        assert_err(
            r#"import cube from "/cube.kcl""#,
            "import path may not start with '/' or '\\'. Cannot traverse to something outside the bounds of your project. If this path is inside your project please find a better way to reference it.",
            [17, 28],
        );
        assert_err(
            r#"import cube from "C:\cube.kcl""#,
            "import path may only contain alphanumeric characters, `_`, `-`, `.`, `/`, and `\\`.",
            [17, 30],
        );
        assert_err(
            r#"import cube from "cube/cube.kcl""#,
            "import path to a subdirectory must only refer to main.kcl.",
            [17, 32],
        );
        assert_err(
            r#"import * as foo from "dsfs""#,
            "as is not the 'from' keyword",
            [9, 11],
        );
        assert_err(
            r#"import a from "dsfs" as b"#,
            "unsupported import path format",
            [14, 20],
        );
        assert_err(
            r#"import * from "dsfs" as b"#,
            "unsupported import path format",
            [14, 20],
        );
        assert_err(r#"import a from b"#, "invalid string literal", [14, 15]);
        assert_err(r#"import * "dsfs""#, "\"dsfs\" is not the 'from' keyword", [9, 15]);
        assert_err(r#"import from "dsfs""#, "\"dsfs\" is not the 'from' keyword", [12, 18]);
        assert_err(r#"import "dsfs.kcl" as *"#, "Unexpected token: as", [18, 20]);
        assert_err(r#"import "dsfs""#, "unsupported import path format", [7, 13]);
        assert_err(
            r#"import "foo.bar.kcl""#,
            "import path is not a valid identifier and must be aliased.",
            [7, 20],
        );
        assert_err(
            r#"import "_foo.kcl""#,
            "import path is not a valid identifier and must be aliased.",
            [7, 17],
        );
        assert_err(
            r#"import "foo-bar.kcl""#,
            "import path is not a valid identifier and must be aliased.",
            [7, 20],
        );
    }

    #[test]
    fn std_fn_decl() {
        let code = r#"/// Compute the cosine of a number (in radians).
///
/// ```
/// exampleSketch = startSketchOn(XZ)
///   |> startProfile(at = [0, 0])
///   |> angledLine(
///        angle = 30,
///        length = 3 / cos(toRadians(30)),
///      )
///   |> yLine(endAbsolute = 0)
///   |> close(%)
/// 
/// example = extrude(exampleSketch, length = 5)
/// ```
@(impl = std_rust)
export fn cos(num: number(rad)): number(_) {}"#;
        let _ast = crate::parsing::top_level_parse(code).unwrap();
    }

    #[test]
    fn warn_import() {
        let some_program_string = r#"import "foo.bad""#;
        let (_, errs) = assert_no_err(some_program_string);
        assert_eq!(errs.len(), 1, "{errs:#?}");
    }

    #[test]
    fn warn_late_settings() {
        let some_program_string = r#"foo = 42
@settings(defaultLengthUnit = mm)
"#;
        let (_, errs) = assert_no_err(some_program_string);
        assert_eq!(errs.len(), 1, "{errs:#?}");
    }

    #[test]
    fn warn_unknown_suffix() {
        let some_program_string = r#"foo = 42_?
"#;
        let (_, errs) = assert_no_err(some_program_string);
        assert_eq!(errs.len(), 1, "{errs:#?}");
    }

    #[test]
    fn fn_decl_uom_ty() {
        let some_program_string = r#"fn foo(x: number(mm)): number(_) { return 1 }"#;
        let (_, errs) = assert_no_fatal(some_program_string);
        assert!(errs.is_empty(), "Expected no errors, found: {errs:?}");
    }

    #[test]
    fn error_underscore() {
        let (_, errs) = assert_no_fatal("_foo(a=_blah, b=_)");
        assert_eq!(errs.len(), 3, "found: {errs:#?}");
    }

    #[test]
    fn error_double_and() {
        let (_, errs) = assert_no_fatal("foo = true && false");
        assert_eq!(errs.len(), 1, "found: {errs:#?}");
        assert!(errs[0].message.contains("`&&`") && errs[0].message.contains("`&`") && errs[0].suggestion.is_some());
    }

    #[test]
    fn error_type_ascription() {
        let (_, errs) = assert_no_fatal("a + b: number");
        assert!(errs.is_empty());
    }

    #[test]
    fn zero_param_function() {
        let code = r#"
        fn firstPrimeNumber() {
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
        let tokens = crate::parsing::token::lex(program, module_id).unwrap();
        let _arr = array_elem_by_elem(&mut tokens.as_slice()).unwrap();
    }

    #[test]
    fn array_linesep_trailing_comma() {
        let program = r#"[
            1,
            2,
            3,
        ]"#;
        let module_id = ModuleId::default();
        let tokens = crate::parsing::token::lex(program, module_id).unwrap();
        let _arr = array_elem_by_elem(&mut tokens.as_slice()).unwrap();
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
        let tokens = crate::parsing::token::lex(program, module_id).unwrap();
        let _arr = array_elem_by_elem(&mut tokens.as_slice()).unwrap();
    }

    #[test]
    fn basic_if_else() {
        let some_program_string = "if true {
            3
        } else {
            4
        }";
        let module_id = ModuleId::default();
        let tokens = crate::parsing::token::lex(some_program_string, module_id).unwrap();
        let _res = if_expr(&mut tokens.as_slice()).unwrap();
    }

    #[test]
    fn basic_else_if() {
        let some_program_string = "else if true {
            4
        }";
        let module_id = ModuleId::default();
        let tokens = crate::parsing::token::lex(some_program_string, module_id).unwrap();
        let _res = else_if(&mut tokens.as_slice()).unwrap();
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
        let tokens = crate::parsing::token::lex(some_program_string, module_id).unwrap();
        let _res = if_expr(&mut tokens.as_slice()).unwrap();
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
    fn test_error_define_var_as_function() {
        // TODO: https://github.com/KittyCAD/modeling-app/issues/784
        // Improve this error message.
        // It should say that the compiler is expecting a function expression on the RHS.
        assert_err(r#"fn thing = "thing""#, "Unexpected token: \"thing\"", [11, 18]);
    }

    #[test]
    fn random_words_fail() {
        let test_program = r#"part001 = startSketchOn(-XZ)
    |> startProfile(at = [8.53, 11.8])
    asdasd asdasd
    |> line(at = [11.12, -14.82])
    |> line(at = [-13.27, -6.98])
    |> line(at = [-5.09, 12.33])
    asdasd
"#;
        let _ = crate::parsing::top_level_parse(test_program).unwrap_errs();
    }

    #[test]
    fn test_member_expression_sketch() {
        let some_program_string = r#"fn cube(pos, scale) {
  sg = startSketchOn(XY)
  |> startProfile(pos)
    |> line(at = [0, scale])
    |> line(at = [scale, 0])
    |> line(at = [0, -scale])

  return sg
}

b1 = cube(pos=[0,0], scale=10)
b2 = cube(pos=[3,3], scale=4)

pt1 = b1[0]
pt2 = b2[0]
"#;
        crate::parsing::top_level_parse(some_program_string).unwrap();
    }

    #[test]
    fn test_math_with_stdlib() {
        let some_program_string = r#"d2r = pi() / 2
let other_thing = 2 * cos(3)"#;
        crate::parsing::top_level_parse(some_program_string).unwrap();
    }

    #[test]
    fn test_negative_arguments() {
        let some_program_string = r#"fn box(p, h, l, w) {
 myBox = startSketchOn(XY)
    |> startProfile(p)
    |> line(at = [0, l])
    |> line(at = [w, 0])
    |> line(at = [0, -l])
    |> close()
    |> extrude(length=h)

  return myBox
}
let myBox = box(p=[0,0], h=-3, l=-16, w=-10)
"#;
        crate::parsing::top_level_parse(some_program_string).unwrap();
    }

    #[test]
    fn kw_fn() {
        for input in ["val = foo(x, y = z)", "val = foo(y = z)"] {
            let module_id = ModuleId::default();
            let tokens = crate::parsing::token::lex(input, module_id).unwrap();
            super::program.parse(tokens.as_slice()).unwrap();
        }
    }

    #[test]
    fn test_parse_empty_tag_brace() {
        let some_program_string = r#"startSketchOn(XY)
    |> startProfile(at = [0, 0])
    |> line(%, $)
    "#;
        assert_err(some_program_string, "Tag names must not be empty", [67, 68]);
    }
    #[test]
    fn test_parse_empty_tag_whitespace() {
        let some_program_string = r#"startSketchOn(XY)
    |> startProfile(at = [0, 0])
    |> line(%, $ ,01)
    "#;
        assert_err(some_program_string, "Tag names must not be empty", [67, 68]);
    }

    #[test]
    fn test_parse_empty_tag_comma() {
        let some_program_string = r#"startSketchOn(XY)
    |> startProfile(at = [0, 0])
    |> line(%, $,)
    "#;
        assert_err(some_program_string, "Tag names must not be empty", [67, 68]);
    }
    #[test]
    fn test_parse_tag_starting_with_digit() {
        let some_program_string = r#"
    startSketchOn(XY)
    |> startProfile(at = [0, 0])
    |> line(%, $01)"#;
        assert_err(
            some_program_string,
            "Tag names must not start with a number. Tag starts with `01`",
            [72, 74],
        );
    }
    #[test]
    fn test_parse_tag_including_digit() {
        let some_program_string = r#"
    startSketchOn(XY)
    |> startProfile(at = [0, 0])
    |> line(%, tag = $var01)"#;
        assert_no_err(some_program_string);
    }

    #[test]
    fn test_parse_param_bool_default() {
        let some_program_string = r#"fn patternTransform(
  use_original?: boolean = false,
) {}"#;
        assert_no_err(some_program_string);
    }

    #[test]
    fn parse_function_types() {
        let code = r#"foo = x: fn
foo = x: fn(number)
fn foo(x: fn(): number): fn { return 0 }
fn foo(x: fn(a, b: number(mm), c: d): number(Angle)): fn { return 0 }
type fn
type foo = fn
type foo = fn(a: string, b: { f: fn(): any })
type foo = fn(a: string, b: {})
type foo = fn(a: string, b: { })
type foo = fn([fn])
type foo = fn(fn, f: fn(number(_))): [fn([any]): string]
    "#;
        assert_no_err(code);
    }
    #[test]
    fn test_parse_tag_starting_with_bang() {
        let some_program_string = r#"startSketchOn(XY)
    |> startProfile(at = [0, 0])
    |> line(%, $!var,01)
    "#;
        assert_err(some_program_string, "Tag names must not start with a bang", [67, 68]);
    }
    #[test]
    fn test_parse_tag_starting_with_dollar() {
        let some_program_string = r#"startSketchOn(XY)
    |> startProfile(at = [0, 0])
    |> line(%, $$,01)
    "#;
        assert_err(some_program_string, "Tag names must not start with a dollar", [67, 68]);
    }
    #[test]
    fn test_parse_tag_starting_with_fn() {
        let some_program_string = r#"startSketchOn(XY)
    |> startProfile(at = [0, 0])
    |> line(%, $fn,01)
    "#;
        assert_err(some_program_string, "Tag names must not start with a keyword", [67, 69]);
    }
    #[test]
    fn test_parse_tag_starting_with_a_comment() {
        let some_program_string = r#"startSketchOn(XY)
    |> startProfile(at = [0, 0])
    |> line(%, $//
    ,01)
    "#;
        assert_err(
            some_program_string,
            "Tag names must not start with a lineComment",
            [67, 69],
        );
    }

    #[test]
    fn test_parse_tag_with_reserved_in_middle_works() {
        let some_program_string = r#"
    startSketchOn(XY)
    |> startProfile(at = [0, 0])
    |> line(end = [5, 5], tag = $sketching)
    "#;
        assert_no_err(some_program_string);
    }

    #[test]
    fn test_parse_fn_call_then_field() {
        let some_program_string = "myFunction().field";
        let module_id = ModuleId::default();
        let tokens = crate::parsing::token::lex(some_program_string, module_id).unwrap(); // Updated import path
        let actual = expression.parse(tokens.as_slice()).unwrap();
        let Expr::MemberExpression(_expr) = actual else {
            panic!("expected member expression")
        };
    }

    #[test]
    fn test_parse_array_missing_closing_bracket() {
        let some_program_string = r#"
sketch001 = startSketchOn(XZ) |> startProfile(at = [90.45, 119.09)"#;
        assert_err(
            some_program_string,
            "Encountered an unexpected character(s) before finding a closing bracket(`]`) for the array",
            [52, 60],
        );
    }
    #[test]
    fn test_parse_array_missing_comma() {
        let some_program_string = r#"
sketch001 = startSketchOn(XZ) |> startProfile(at = [90.45 119.09])"#;
        assert_err(
            some_program_string,
            "Unexpected character encountered. You might be missing a comma in between elements.",
            [53, 66],
        );
    }
    #[test]
    fn test_parse_array_reserved_word_early_exit() {
        // since there is an early exit if encountering a reserved word, the error should be about
        // that and not the missing comma
        let some_program_string = r#"
sketch001 = startSketchOn(XZ) |> startProfile(at = [90.45 $struct])"#;
        assert_err(
            some_program_string,
            "Encountered an unexpected character(s) before finding a closing bracket(`]`) for the array",
            [52, 53],
        );
    }
    #[test]
    fn test_parse_array_random_brace() {
        let some_program_string = r#"
sketch001 = startSketchOn(XZ) |> startProfile(at = [}])"#;
        assert_err(
            some_program_string,
            "Encountered an unexpected character(s) before finding a closing bracket(`]`) for the array",
            [52, 53],
        );
    }

    #[test]
    fn test_parse_object_missing_closing_brace() {
        let some_program_string = r#"{
            foo = bar,"#;

        assert_err(
            some_program_string,
            "Encountered an unexpected character(s) before finding a closing brace(`}`) for the object",
            [0, 23],
        );
    }
    #[test]
    fn test_parse_object_reserved_word_early_exit() {
        // since there is an early exit if encountering a reserved word, the error should be about
        // that and not the missing comma
        let some_program_string = r#"{bar = foo struct = man}"#;

        assert_err(
            some_program_string,
            "Encountered an unexpected character(s) before finding a closing brace(`}`) for the object",
            [0, 1],
        );
    }
    #[test]
    fn test_parse_object_missing_comma() {
        let some_program_string = r#"{
            foo = bar,
            bar = foo
            bat = man
        }"#;

        assert_err(
            some_program_string,
            "Unexpected character encountered. You might be missing a comma in between properties.",
            [37, 78],
        );
    }

    #[test]
    fn test_parse_object_missing_comma_one_line() {
        let some_program_string = r#"{bar = foo bat = man}"#;

        assert_err(
            some_program_string,
            "Unexpected character encountered. You might be missing a comma in between properties.",
            [1, 21],
        );
    }

    #[test]
    fn test_parse_object_random_bracket() {
        let some_program_string = r#"{]}"#;

        assert_err(
            some_program_string,
            "Encountered an unexpected character(s) before finding a closing brace(`}`) for the object",
            [0, 1],
        );
    }

    #[test]
    fn test_parse_object_shorthand_missing_comma() {
        let some_program_string = r#"
bar = 1
        {
            foo = bar,
            bar
            bat = man
        }"#;

        assert_err(
            some_program_string,
            "Unexpected character encountered. You might be missing a comma in between properties.",
            [54, 89],
        );
    }

    #[test]
    fn test_unary_not_on_keyword_bool() {
        let some_program_string = r#"!true"#;
        let module_id = ModuleId::default();
        let tokens = crate::parsing::token::lex(some_program_string, module_id).unwrap(); // Updated import path
        let actual = match unary_expression.parse(tokens.as_slice()) {
            // Use tokens.as_slice() for parsing
            Ok(x) => x,
            Err(e) => panic!("{e:?}"),
        };
        assert_eq!(actual.operator, UnaryOperator::Not);
        crate::parsing::top_level_parse(some_program_string).unwrap(); // Updated import path
    }
    #[test]
    fn test_sensible_error_when_missing_comma_between_fn_args() {
        let program_source = "startSketchOn(XY)
|> arc(
    endAbsolute = [0, 50]
    interiorAbsolute = [-50, 0]
)";
        let expected_src_start = program_source.find("]").unwrap();
        let tokens = crate::parsing::token::lex(program_source, ModuleId::default()).unwrap();
        ParseContext::init();
        let err = program
            .parse(tokens.as_slice())
            .expect_err("Program succeeded, but it should have failed");
        let cause = err
            .inner()
            .cause
            .as_ref()
            .expect("Found an error, but there was no cause. Add a cause.");
        assert_eq!(cause.message, "Missing comma between arguments, try adding a comma in",);
        assert_eq!(cause.source_range.start() - 1, expected_src_start);
    }

    #[test]
    fn test_sensible_error_when_missing_rhs_of_kw_arg() {
        for (i, program) in ["f(x, y=)"].into_iter().enumerate() {
            let tokens = crate::parsing::token::lex(program, ModuleId::default()).unwrap();
            let err = fn_call_kw.parse(tokens.as_slice()).unwrap_err();
            let cause = err.inner().cause.as_ref().unwrap();
            assert_eq!(
                cause.message, "This argument has a label, but no value. Put some value after the equals sign",
                "failed test {i}: {program}"
            );
            assert_eq!(
                cause.source_range.start(),
                program.find("y").unwrap(),
                "failed test {i}: {program}"
            );
        }
    }

    #[test]
    fn test_sensible_error_when_unexpected_token_in_fn_call() {
        let program_source = "1
|> extrude(
  length=depth,
})";
        let expected_src_start = program_source.find("}").expect("Program should have an extraneous }");
        let tokens = crate::parsing::token::lex(program_source, ModuleId::default()).unwrap();
        ParseContext::init();
        let err = program.parse(tokens.as_slice()).unwrap_err();
        let cause = err
            .inner()
            .cause
            .as_ref()
            .expect("Found an error, but there was no cause. Add a cause.");
        assert_eq!(cause.message, "There was an unexpected `}`. Try removing it.",);
        assert_eq!(cause.source_range.start(), expected_src_start);
    }

    #[test]
    fn test_sensible_error_when_using_keyword_as_arg_label() {
        for (i, program) in ["pow(2, fn = 8)"].into_iter().enumerate() {
            let tokens = crate::parsing::token::lex(program, ModuleId::default()).unwrap();
            let err = match fn_call_kw.parse(tokens.as_slice()) {
                Err(e) => e,
                Ok(_ast) => {
                    panic!("Expected this to error but it didn't");
                }
            };
            let cause = err.inner().cause.as_ref().unwrap();
            assert_eq!(
                cause.message, "`fn` is not the name of an argument (it's a reserved keyword)",
                "failed test {i}: {program}"
            );
            assert_eq!(
                cause.source_range.start(),
                program.find("fn").unwrap(),
                "failed test {i}: {program}"
            );
        }
    }

    #[test]
    fn test_sensible_error_when_missing_rhs_of_obj_property() {
        for (i, program) in ["{x = 1, y =}"].into_iter().enumerate() {
            let tokens = crate::parsing::token::lex(program, ModuleId::default()).unwrap();
            let err = object.parse(tokens.as_slice()).unwrap_err();
            let cause = err.inner().cause.as_ref().unwrap();
            assert_eq!(
                cause.message, "This property has a label, but no value. Put some value after the equals sign",
                "failed test {i}: {program}"
            );
            assert_eq!(
                cause.source_range.start(),
                program.rfind('=').unwrap(),
                "failed test {i}: {program}"
            );
        }
    }

    #[test]
    fn test_sensible_error_duplicated_args() {
        let program = r#"f(arg = 1, normal = 44, arg = 2)"#;
        let (_, mut errs) = assert_no_fatal(program);
        assert_eq!(errs.len(), 1);
        let err = errs.pop().unwrap();
        assert_eq!(
            err.message,
            "You've used the parameter labelled 'arg' 2 times in a single function call. You can only set each parameter once! Remove all but one use.",
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
        ($func_name:ident, $test_kcl_program:expr_2021) => {
            #[test]
            fn $func_name() {
                let module_id = crate::ModuleId::default();
                let tokens = crate::parsing::token::lex($test_kcl_program, module_id).unwrap();
                ParseContext::init();

                let actual = match binary_expression.parse(tokens.as_slice()) {
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
        ($func_name:ident, $test_kcl_program:expr_2021) => {
            #[test]
            fn $func_name() {
                let module_id = crate::ModuleId::default();
                println!("{}", $test_kcl_program);
                let tokens = crate::parsing::token::lex($test_kcl_program, module_id).unwrap();
                print_tokens(tokens.as_slice());
                ParseContext::init();
                let actual = match program.parse(tokens.as_slice()) {
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
        r#"boxSketch = startSketchOn(XY)
    |> startProfileAt(at = [0, 0])
    |> line(at = [0, 10])
    |> tangentialArc(end = [-5, 5])
    |> line(at = [5, -15])
    |> extrude(length=10)
"#
    );
    snapshot_test!(b, "myVar = min(x=5 , y=-legLen(5, z=4))"); // Space before comma

    snapshot_test!(c, "myVar = min(x=-legLen(a=5, b=4), y=5)");
    snapshot_test!(d, "myVar = 5 + 6 |> myFunc(45)");
    snapshot_test!(e, "x = 1 * (3 - 4)");
    snapshot_test!(f, r#"x = 1 // this is an inline comment"#);
    snapshot_test!(
        g,
        r#"fn x() {
        return sg
        return sg
      }"#
    );
    snapshot_test!(d2, r#"x = -leg2 + thickness"#);
    snapshot_test!(
        h,
        r#"obj = { a = 1, b = 2 }
    height = 1 - obj.a"#
    );
    snapshot_test!(
        i,
        r#"obj = { a = 1, b = 2 }
     height = 1 - obj["a"]"#
    );
    snapshot_test!(
        j,
        r#"obj = { a = 1, b = 2 }
    height = obj["a"] - 1"#
    );
    snapshot_test!(
        k,
        r#"obj = { a = 1, b = 2 }
    height = [1 - obj["a"], 0]"#
    );
    snapshot_test!(
        l,
        r#"obj = { a = 1, b = 2 }
    height = [obj["a"] - 1, 0]"#
    );
    snapshot_test!(
        m,
        r#"obj = {a = 1, b = 2 }
    height = [obj["a"] -1, 0]"#
    );
    snapshot_test!(n, "height = 1 - obj.a");
    snapshot_test!(o, "six = 1 + 2 + 3");
    snapshot_test!(p, "five = 3 * 1 + 2");
    snapshot_test!(q, r#"height = [ obj["a"], 0 ]"#);
    snapshot_test!(
        r,
        r#"obj = { a = 1, b = 2 }
    height = obj["a"]"#
    );
    snapshot_test!(s, r#"prop = yo["one"][two]"#);
    snapshot_test!(t, r#"pt1 = b1[x]"#);
    snapshot_test!(u, "prop = yo.one.two.three.four");
    snapshot_test!(v, r#"pt1 = b1[0]"#);
    snapshot_test!(w, r#"pt1 = b1['zero']"#);
    snapshot_test!(x, r#"pt1 = b1.zero"#);
    snapshot_test!(y, r#"sg = startSketchOn(XY) |> startProfile(pos)"#);
    snapshot_test!(
        z,
        "sg = startSketchOn(XY)
    |> startProfile(pos) |> line([0, -scale])"
    );
    snapshot_test!(aa, r#"sg = -scale"#);
    snapshot_test!(ab, "line(endAbsolute = [0, -1])");
    snapshot_test!(
        ad,
        r#"
    fn firstPrimeNumber() {
        return 2
    }
    firstPrimeNumber()"#
    );
    snapshot_test!(
        ae,
        r#"fn thing(param) {
        return true
    }
    thing(false)"#
    );
    snapshot_test!(
        af,
        r#"mySketch = startSketchOn(XY)
        |> startProfile(at = [0,0])
        |> line(endAbsolute = [0, 1], tag = $myPath)
        |> line(endAbsolute = [1, 1])
        |> line(endAbsolute = [1, 0], tag = $rightPath)
        |> close()"#
    );
    snapshot_test!(
        ag,
        "mySketch = startSketchOn(XY) |> startProfile(at = [0,0]) |> line(endAbsolute = [1, 1]) |> close()"
    );
    snapshot_test!(ah, "myBox = startSketchOn(XY) |> startProfile(at = p)");
    snapshot_test!(ai, r#"myBox = f(1) |> g(2)"#);
    snapshot_test!(
        aj,
        r#"myBox = startSketchOn(XY) |> startProfile(at = p) |> line(end = [0, l])"#
    );
    snapshot_test!(ak, "line(endAbsolute = [0, 1])");
    snapshot_test!(ap, "mySketch = startSketchOn(XY) |> startProfile(at = [0,0])");
    snapshot_test!(aq, "log(number = 5, msg = \"hello\", id=aIdentifier)");
    snapshot_test!(ar, r#"5 + "a""#);
    snapshot_test!(at, "line([0, l])");
    snapshot_test!(au, include_str!("../../e2e/executor/inputs/cylinder.kcl"));
    snapshot_test!(av, "fn f(angle?) { return default(maybe=angle, otherwise=360) }");
    snapshot_test!(
        aw,
        "numbers = [
            1,
            // A,
            // B,
            3,
        ]"
    );
    snapshot_test!(
        ax,
        "numbers = [
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
        "props = {
            a: 1,
            // b: 2,
            c: 3
        }"
    );
    snapshot_test!(
        bb,
        r#"
my14 = 4 ^ 2 - 3 ^ 2 * 2
"#
    );
    snapshot_test!(
        bc,
        r#"x = if true {
            3
        } else {
            4
        }"#
    );
    snapshot_test!(
        bd,
        r#"x = if true {
            3
        } else if func(radius) {
            4
        } else {
            5
        }"#
    );
    snapshot_test!(be, "x = 3 == 3");
    snapshot_test!(bf, "x = 3 != 3");
    snapshot_test!(bg, r#"x = 4"#);
    snapshot_test!(bh, "obj = {center = [10, 10], radius =5}");
    snapshot_test!(
        bi,
        r#"x = 3
        obj = { x, y = 4}"#
    );
    snapshot_test!(bj, "true");
    snapshot_test!(bk, "truee");
    snapshot_test!(bl, "x = !true");
    snapshot_test!(bm, "x = true & false");
    snapshot_test!(bn, "x = true | false");
    snapshot_test!(kw_function_unnamed_first, r#"val = foo(x, y = z)"#);
    snapshot_test!(kw_function_all_named, r#"val = foo(x = a, y = b)"#);
    snapshot_test!(kw_function_decl_all_labeled, r#"fn foo(x, y) { return 1 }"#);
    snapshot_test!(kw_function_decl_first_unlabeled, r#"fn foo(@x, y) { return 1 }"#);
    snapshot_test!(kw_function_decl_with_default_no_type, r#"fn foo(x? = 2) { return 1 }"#);
    snapshot_test!(
        kw_function_decl_with_default_and_type,
        r#"fn foo(x?: number = 2) { return 1 }"#
    );
    snapshot_test!(kw_function_call_in_pipe, r#"val = 1 |> f(arg = x)"#);
    snapshot_test!(
        kw_function_call_multiline,
        r#"val = f(
             arg = x,
             foo = x,
             bar = x,
           )"#
    );
    snapshot_test!(
        kw_function_call_multiline_with_comments,
        r#"val = f(
             arg = x,
             // foo = x,
             bar = x,
           )"#
    );
    snapshot_test!(kw_function_in_binary_op, r#"val = f(x = 1) + 1"#);
    snapshot_test!(
        array_ranges,
        r#"incl = [1..10]
        excl = [0..<10]"#
    );
}

#[allow(unused)]
#[cfg(test)]
pub(crate) fn print_tokens(tokens: TokenSlice) {
    for (i, tok) in tokens.iter().enumerate() {
        println!("{i:.2}: ({:?}):) '{}'", tok.token_type, tok.value.replace("\n", "\\n"));
    }
}
