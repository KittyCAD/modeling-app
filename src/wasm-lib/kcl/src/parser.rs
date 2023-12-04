use crate::{
    ast::types::Program,
    errors::{KclError, KclErrorDetails},
    executor::SourceRange,
    token::{Token, TokenType},
};

mod math;
pub(crate) mod parser_impl;

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
            let source_ranges = self.unknown_tokens.iter().map(SourceRange::from).collect();
            let token_list = self.unknown_tokens.iter().map(|t| t.value.as_str()).collect::<Vec<_>>();
            let message = if token_list.len() == 1 {
                format!("found unknown token '{}'", token_list[0])
            } else {
                format!("found unknown tokens [{}]", token_list.join(", "))
            };
            return Err(KclError::Lexical(KclErrorDetails { source_ranges, message }));
        }

        parser_impl::run_parser(&mut self.tokens.as_slice())
    }
}
