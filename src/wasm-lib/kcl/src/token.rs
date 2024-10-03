use std::str::FromStr;

use anyhow::Result;
use parse_display::{Display, FromStr};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use tower_lsp::lsp_types::SemanticTokenType;
use winnow::stream::ContainsToken;

use crate::{ast::types::VariableKind, errors::KclError, executor::SourceRange};

mod tokeniser;

/// The types of tokens.
#[derive(Debug, PartialEq, Eq, Copy, Clone, Deserialize, Serialize, ts_rs::TS, JsonSchema, FromStr, Display)]
#[cfg_attr(feature = "pyo3", pyo3::pyclass(eq, eq_int))]
#[ts(export)]
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
    /// A type.
    Type,
    /// A brace.
    Brace,
    /// A hash.
    Hash,
    /// A bang.
    Bang,
    /// A dollar sign.
    Dollar,
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
    /// Unknown lexemes.
    Unknown,
    /// The ? symbol, used for optional values.
    QuestionMark,
}

/// Most KCL tokens correspond to LSP semantic tokens (but not all).
impl TryFrom<TokenType> for SemanticTokenType {
    type Error = anyhow::Error;
    fn try_from(token_type: TokenType) -> Result<Self> {
        Ok(match token_type {
            TokenType::Number => Self::NUMBER,
            TokenType::Word => Self::VARIABLE,
            TokenType::Keyword => Self::KEYWORD,
            TokenType::Type => Self::TYPE,
            TokenType::Operator => Self::OPERATOR,
            TokenType::QuestionMark => Self::OPERATOR,
            TokenType::String => Self::STRING,
            TokenType::Bang => Self::OPERATOR,
            TokenType::LineComment => Self::COMMENT,
            TokenType::BlockComment => Self::COMMENT,
            TokenType::Function => Self::FUNCTION,
            TokenType::Whitespace
            | TokenType::Brace
            | TokenType::Comma
            | TokenType::Colon
            | TokenType::Period
            | TokenType::DoublePeriod
            | TokenType::Hash
            | TokenType::Dollar
            | TokenType::Unknown => {
                anyhow::bail!("unsupported token type: {:?}", token_type)
            }
        })
    }
}

impl TokenType {
    // This is for the lsp server.
    // Don't call this function directly in the code use a lazy_static instead
    // like we do in the lsp server.
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

    pub fn is_whitespace(&self) -> bool {
        matches!(self, Self::Whitespace)
    }

    pub fn is_comment(&self) -> bool {
        matches!(self, Self::LineComment | Self::BlockComment)
    }
}

#[derive(Debug, PartialEq, Eq, Deserialize, Serialize, Clone, ts_rs::TS)]
#[cfg_attr(feature = "pyo3", pyo3::pyclass)]
#[ts(export)]
pub struct Token {
    #[serde(rename = "type")]
    pub token_type: TokenType,
    /// Offset in the source code where this token begins.
    pub start: usize,
    /// Offset in the source code where this token ends.
    pub end: usize,
    pub value: String,
}

impl ContainsToken<Token> for (TokenType, &str) {
    fn contains_token(&self, token: Token) -> bool {
        self.0 == token.token_type && self.1 == token.value
    }
}

impl ContainsToken<Token> for TokenType {
    fn contains_token(&self, token: Token) -> bool {
        *self == token.token_type
    }
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

    pub fn as_source_range(&self) -> SourceRange {
        SourceRange([self.start, self.end])
    }

    pub fn as_source_ranges(&self) -> Vec<SourceRange> {
        vec![self.as_source_range()]
    }

    /// Is this token the beginning of a variable/function declaration?
    /// If so, what kind?
    /// If not, returns None.
    pub fn declaration_keyword(&self) -> Option<VariableKind> {
        if !matches!(self.token_type, TokenType::Keyword) {
            return None;
        }
        Some(match self.value.as_str() {
            "fn" => VariableKind::Fn,
            "var" | "let" | "const" => VariableKind::Const,
            _ => return None,
        })
    }
}

impl From<Token> for SourceRange {
    fn from(token: Token) -> Self {
        Self([token.start, token.end])
    }
}

impl From<&Token> for SourceRange {
    fn from(token: &Token) -> Self {
        Self([token.start, token.end])
    }
}

pub fn lexer(s: &str) -> Result<Vec<Token>, KclError> {
    tokeniser::lexer(s).map_err(From::from)
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
