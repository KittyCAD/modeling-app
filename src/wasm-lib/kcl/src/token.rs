use std::str::FromStr;

use anyhow::Result;
use parse_display::{Display, FromStr};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use tower_lsp::lsp_types::SemanticTokenType;

mod tokeniser;

/// The types of tokens.
#[derive(Debug, PartialEq, Eq, Copy, Clone, Deserialize, Serialize, JsonSchema, FromStr, Display)]
#[serde(rename_all = "camelCase")]
#[display(style = "camelCase")]
pub enum TokenType {
    /// A number.
    Number,
    /// A word.
    Word,
    /// An operator.
    Operator,
    /// A string.
    String,
    /// A keyword.
    Keyword,
    /// A brace.
    Brace,
    /// Whitespace.
    Whitespace,
    /// A comma.
    Comma,
    /// A colon.
    Colon,
    /// A period.
    Period,
    /// A double period: `..`.
    DoublePeriod,
    /// A line comment.
    LineComment,
    /// A block comment.
    BlockComment,
    /// A function name.
    Function,
}

/// Most KCL tokens correspond to LSP semantic tokens (but not all).
impl TryFrom<TokenType> for SemanticTokenType {
    type Error = anyhow::Error;
    fn try_from(token_type: TokenType) -> Result<Self> {
        Ok(match token_type {
            TokenType::Number => Self::NUMBER,
            TokenType::Word => Self::VARIABLE,
            TokenType::Keyword => Self::KEYWORD,
            TokenType::Operator => Self::OPERATOR,
            TokenType::String => Self::STRING,
            TokenType::LineComment => Self::COMMENT,
            TokenType::BlockComment => Self::COMMENT,
            TokenType::Function => Self::FUNCTION,
            TokenType::Whitespace
            | TokenType::Brace
            | TokenType::Comma
            | TokenType::Colon
            | TokenType::Period
            | TokenType::DoublePeriod => {
                anyhow::bail!("unsupported token type: {:?}", token_type)
            }
        })
    }
}

impl TokenType {
    // This is for the lsp server.
    pub fn all_semantic_token_types() -> Result<Vec<SemanticTokenType>> {
        let mut settings = schemars::gen::SchemaSettings::openapi3();
        settings.inline_subschemas = true;
        let mut generator = schemars::gen::SchemaGenerator::new(settings);

        let schema = TokenType::json_schema(&mut generator);
        let schemars::schema::Schema::Object(o) = &schema else {
            anyhow::bail!("expected object schema: {:#?}", schema);
        };
        let Some(subschemas) = &o.subschemas else {
            anyhow::bail!("expected subschemas: {:#?}", schema);
        };
        let Some(one_ofs) = &subschemas.one_of else {
            anyhow::bail!("expected one_of: {:#?}", schema);
        };

        let mut semantic_tokens = vec![];
        for one_of in one_ofs {
            let schemars::schema::Schema::Object(o) = one_of else {
                anyhow::bail!("expected object one_of: {:#?}", one_of);
            };

            let Some(enum_values) = o.enum_values.as_ref() else {
                anyhow::bail!("expected enum values: {:#?}", o);
            };

            if enum_values.len() > 1 {
                anyhow::bail!("expected only one enum value: {:#?}", o);
            }

            if enum_values.is_empty() {
                anyhow::bail!("expected at least one enum value: {:#?}", o);
            }

            let label = TokenType::from_str(&enum_values[0].to_string().replace('"', ""))?;
            if let Ok(semantic_token_type) = SemanticTokenType::try_from(label) {
                semantic_tokens.push(semantic_token_type);
            }
        }

        Ok(semantic_tokens)
    }
}

#[derive(Debug, PartialEq, Eq, Deserialize, Serialize, Clone)]
pub struct Token {
    #[serde(rename = "type")]
    pub token_type: TokenType,
    /// Offset in the source code where this token begins.
    pub start: usize,
    /// Offset in the source code where this token ends.
    pub end: usize,
    pub value: String,
}

impl Token {
    pub fn from_range(range: std::ops::Range<usize>, token_type: TokenType, value: String) -> Self {
        Self {
            start: range.start,
            end: range.end,
            value,
            token_type,
        }
    }
    pub fn is_code_token(&self) -> bool {
        !matches!(
            self.token_type,
            TokenType::Whitespace | TokenType::LineComment | TokenType::BlockComment
        )
    }
}

impl From<Token> for crate::executor::SourceRange {
    fn from(token: Token) -> Self {
        Self([token.start, token.end])
    }
}

impl From<&Token> for crate::executor::SourceRange {
    fn from(token: &Token) -> Self {
        Self([token.start, token.end])
    }
}

pub fn lexer(s: &str) -> Vec<Token> {
    tokeniser::lexer(s).unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    // We have this as a test so we can ensure it never panics with an unwrap in the server.
    #[test]
    fn test_token_type_to_semantic_token_type() {
        let semantic_types = TokenType::all_semantic_token_types().unwrap();
        assert!(!semantic_types.is_empty());
    }
}
