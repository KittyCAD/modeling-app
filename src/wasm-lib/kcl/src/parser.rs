use crate::{
    ast::types::{Node, Program},
    errors::{KclError, KclErrorDetails},
    executor::SourceRange,
    token::{Token, TokenType},
};

mod bad_inputs;
mod math;
pub(crate) mod parser_impl;

pub const PIPE_SUBSTITUTION_OPERATOR: &str = "%";
pub const PIPE_OPERATOR: &str = "|>";

/// Parse the given KCL code into an AST.
pub fn parse(code: &str) -> Result<Node<Program>, KclError> {
    let tokens = crate::token::lexer(code)?;
    let parser = Parser::new(tokens);
    parser.ast()
}

pub struct Parser {
    pub tokens: Vec<Token>,
    pub unknown_tokens: Vec<Token>,
}

impl Parser {
    pub fn new(tokens: Vec<Token>) -> Self {
        let (tokens, unknown_tokens): (Vec<Token>, Vec<Token>) = tokens
            .into_iter()
            .partition(|token| token.token_type != TokenType::Unknown);
        Self { tokens, unknown_tokens }
    }

    /// Run the parser
    pub fn ast(&self) -> Result<Node<Program>, KclError> {
        if !self.unknown_tokens.is_empty() {
            let source_ranges = self.unknown_tokens.iter().map(SourceRange::from).collect();
            let token_list = self.unknown_tokens.iter().map(|t| t.value.as_str()).collect::<Vec<_>>();
            let message = if token_list.len() == 1 {
                format!("found unknown token '{}'", token_list[0])
            } else {
                format!("found unknown tokens [{}]", token_list.join(", "))
            };
            return Err(KclError::Lexical(KclErrorDetails { source_ranges, message }));
        }

        // Important, to not call this before the unknown tokens check.
        if self.tokens.is_empty() {
            // Empty file should just do nothing.
            return Ok(Node::<Program>::default());
        }

        // Check all the tokens are whitespace or comments.
        if self
            .tokens
            .iter()
            .all(|t| t.token_type.is_whitespace() || t.token_type.is_comment())
        {
            return Ok(Node::<Program>::default());
        }

        parser_impl::run_parser(&mut self.tokens.as_slice())
    }
}
