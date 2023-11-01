use crate::{ast::types::Program, errors::KclError, token::{Token, TokenType}, executor::SourceRange, errors::KclErrorDetails};

mod math;
mod parser_impl;

pub const PIPE_SUBSTITUTION_OPERATOR: &str = "%";
pub const PIPE_OPERATOR: &str = "|>";

pub struct Parser {
    pub tokens: Vec<Token>,
    pub unkown_tokens: Vec<Token>
}

impl Parser {
    pub fn new(tokens: Vec<Token>) -> Self {
        let (tokens, unkown_tokens): (Vec<Token>, Vec<Token>) = tokens
            .into_iter()
            .partition(|token| token.token_type != TokenType::Unknown);
        Self {
            tokens,
            unkown_tokens,
        }
    }

    /// Run the parser
    pub fn ast(&self) -> Result<Program, KclError> {

        if !self.unkown_tokens.is_empty() {
            return Err(KclError::Lexical(KclErrorDetails {
                source_ranges: self
                    .unkown_tokens
                    .clone()
                    .iter()
                    .map(|token| SourceRange::new(token.start, token.end))
                    .collect(),
                message: format!(
                    "found list of unkown tokens {:?}",
                    self.unkown_tokens
                        .clone()
                        .iter()
                        .map(|token| token.value.clone())
                        .collect::<Vec<_>>()
                        .join(" ")
                ),
            }));
        }

        parser_impl::run_parser(&mut self.tokens.as_slice(), &mut self.unkown_tokens.as_slice())
    }
}
