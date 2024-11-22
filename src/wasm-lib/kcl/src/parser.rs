use parser_impl::ParseContext;

use crate::{
    ast::types::{ModuleId, Node, Program},
    errors::{KclError, KclErrorDetails},
    executor::SourceRange,
    token::{Token, TokenType},
};

mod bad_inputs;
mod math;
pub(crate) mod parser_impl;

pub const PIPE_SUBSTITUTION_OPERATOR: &str = "%";
pub const PIPE_OPERATOR: &str = "|>";

// `?` like behavior for `Result`s to return a ParseResult if there is an error.
macro_rules! pr_try {
    ($e: expr) => {
        match $e {
            Ok(a) => a,
            Err(e) => return e.into(),
        }
    };
}

#[cfg(test)]
/// Parse the given KCL code into an AST.  This is the top-level.
pub fn top_level_parse(code: &str) -> ParseResult {
    let module_id = ModuleId::default();
    parse_str(code, module_id)
}

/// Parse the given KCL code into an AST.
pub fn parse_str(code: &str, module_id: ModuleId) -> ParseResult {
    let tokens = pr_try!(crate::token::lexer(code, module_id));
    parse_tokens(tokens)
}

/// Parse the supplied tokens into an AST.
pub fn parse_tokens(tokens: Vec<Token>) -> ParseResult {
    let (tokens, unknown_tokens): (Vec<Token>, Vec<Token>) = tokens
        .into_iter()
        .partition(|token| token.token_type != TokenType::Unknown);

    if !unknown_tokens.is_empty() {
        let source_ranges = unknown_tokens.iter().map(SourceRange::from).collect();
        let token_list = unknown_tokens.iter().map(|t| t.value.as_str()).collect::<Vec<_>>();
        let message = if token_list.len() == 1 {
            format!("found unknown token '{}'", token_list[0])
        } else {
            format!("found unknown tokens [{}]", token_list.join(", "))
        };
        return KclError::Lexical(KclErrorDetails { source_ranges, message }).into();
    }

    // Important, to not call this before the unknown tokens check.
    if tokens.is_empty() {
        // Empty file should just do nothing.
        return Node::<Program>::default().into();
    }

    // Check all the tokens are whitespace or comments.
    if tokens
        .iter()
        .all(|t| t.token_type.is_whitespace() || t.token_type.is_comment())
    {
        return Node::<Program>::default().into();
    }

    parser_impl::run_parser(&mut tokens.as_slice())
}

/// Result of parsing.
///
/// Will be a KclError if there was a lexing error or some unexpected error during parsing.
///   TODO - lexing errors should be included with the parse errors.
/// Will be Ok otherwise, including if there were parsing errors. Any errors or warnings will
/// be in the ParseContext. If an AST was produced, then that will be in the Option.
///
/// Invariants:
/// - if there are no errors, then the Option will be Some
/// - if the Option is None, then there will be at least one error in the ParseContext.
pub(crate) struct ParseResult(pub Result<(Option<Node<Program>>, ParseContext), KclError>);

impl ParseResult {
    #[cfg(test)]
    pub fn unwrap(self) -> Node<Program> {
        self.0.unwrap().0.unwrap()
    }

    #[cfg(test)]
    pub fn is_ok(&self) -> bool {
        match &self.0 {
            Ok((p, pc)) => p.is_some() && pc.errors.is_empty(),
            Err(_) => false,
        }
    }

    #[cfg(test)]
    #[track_caller]
    pub fn unwrap_errs(&self) -> &[parser_impl::error::ParseError] {
        &self.0.as_ref().unwrap().1.errors
    }

    /// Treat parsing errors as an Error.
    pub fn parse_errs_as_err(self) -> Result<Node<Program>, KclError> {
        let (p, errs) = self.0?;
        if !errs.errors.is_empty() {
            // TODO could summarise all errors rather than just the first one.
            return Err(errs.errors.into_iter().next().unwrap().into());
        }
        match p {
            Some(p) => Ok(p),
            None => Err(KclError::internal("Unknown parsing error".to_owned())),
        }
    }
}

impl From<Result<(Option<Node<Program>>, ParseContext), KclError>> for ParseResult {
    fn from(r: Result<(Option<Node<Program>>, ParseContext), KclError>) -> ParseResult {
        ParseResult(r)
    }
}

impl From<(Option<Node<Program>>, ParseContext)> for ParseResult {
    fn from(p: (Option<Node<Program>>, ParseContext)) -> ParseResult {
        ParseResult(Ok(p))
    }
}

impl From<Node<Program>> for ParseResult {
    fn from(p: Node<Program>) -> ParseResult {
        ParseResult(Ok((Some(p), ParseContext::default())))
    }
}

impl From<KclError> for ParseResult {
    fn from(e: KclError) -> ParseResult {
        ParseResult(Err(e))
    }
}
