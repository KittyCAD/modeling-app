use crate::{
    ast::types::Program,
    errors::KclError,
    errors::KclErrorDetails,
    executor::SourceRange,
    token::{Token, TokenType},
};

mod math;
mod parser_impl;

pub const PIPE_SUBSTITUTION_OPERATOR: &str = "%";
pub const PIPE_OPERATOR: &str = "|>";

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
    pub fn ast(&self) -> Result<Program, KclError> {
        if self.tokens.is_empty() {
            return Err(KclError::Syntax(KclErrorDetails {
                source_ranges: vec![],
                message: "file is empty".to_string(),
            }));
        }

        if !self.unknown_tokens.is_empty() {
            return Err(KclError::Lexical(KclErrorDetails {
                source_ranges: self
                    .unknown_tokens
                    .clone()
                    .iter()
                    .map(|token| SourceRange::new(token.start, token.end))
                    .collect(),
                message: format!(
                    "found list of unknown tokens {:?}",
                    self.unknown_tokens
                        .clone()
                        .iter()
                        .map(|token| token.value.clone())
                        .collect::<Vec<_>>()
                        .join(" ")
                ),
            }));
        }

        parser_impl::run_parser(&mut self.tokens.as_slice(), &mut self.unknown_tokens.as_slice())
    }
}
