use crate::{ast::types::Program, errors::KclError, token::Token};

mod math;
mod parser_impl;

pub const PIPE_SUBSTITUTION_OPERATOR: &str = "%";
pub const PIPE_OPERATOR: &str = "|>";

pub struct Parser {
    pub tokens: Vec<Token>,
}

impl Parser {
    pub fn new(tokens: Vec<Token>) -> Self {
        Self { tokens }
    }

    /// Run the parser
    pub fn ast(&self) -> Result<Program, KclError> {
        parser_impl::run_parser(&mut self.tokens.as_slice())
    }
}
