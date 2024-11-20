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

#[cfg(test)]
/// Parse the given KCL code into an AST.  This is the top-level.
pub fn top_level_parse(code: &str) -> Result<Node<Program>, KclError> {
    let module_id = ModuleId::default();
    parse_str(code, module_id)
}

/// Parse the given KCL code into an AST.
pub fn parse_str(code: &str, module_id: ModuleId) -> Result<Node<Program>, KclError> {
    let tokens = crate::token::lexer(code, module_id)?;
    parse_tokens(tokens)
}

pub fn parse_tokens(tokens: Vec<Token>) -> Result<Node<Program>, KclError> {
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
        return Err(KclError::Lexical(KclErrorDetails { source_ranges, message }));
    }

    // Important, to not call this before the unknown tokens check.
    if tokens.is_empty() {
        // Empty file should just do nothing.
        return Ok(Node::<Program>::default());
    }

    // Check all the tokens are whitespace or comments.
    if tokens
        .iter()
        .all(|t| t.token_type.is_whitespace() || t.token_type.is_comment())
    {
        return Ok(Node::<Program>::default());
    }

    parser_impl::run_parser(&mut tokens.as_slice())
}
