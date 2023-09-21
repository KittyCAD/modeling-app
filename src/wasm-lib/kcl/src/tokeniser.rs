use std::str::FromStr;

use anyhow::Result;
use lazy_static::lazy_static;
use parse_display::{Display, FromStr};
use regex::bytes::Regex;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use tower_lsp::lsp_types::SemanticTokenType;

/// The types of tokens.
#[derive(Debug, PartialEq, Eq, Copy, Clone, Deserialize, Serialize, ts_rs::TS, JsonSchema, FromStr, Display)]
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

#[derive(Debug, PartialEq, Eq, Deserialize, Serialize, Clone, ts_rs::TS)]
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

lazy_static! {
    static ref NUMBER: Regex = Regex::new(r"^(\d+(\.\d*)?|\.\d+)\b").unwrap();
    static ref WHITESPACE: Regex = Regex::new(r"\s+").unwrap();
    static ref WORD: Regex = Regex::new(r"^[a-zA-Z_][a-zA-Z0-9_]*").unwrap();
    // TODO: these should be generated using our struct types for these.
    static ref KEYWORD: Regex =
        Regex::new(r"^(if|else|for|while|return|break|continue|fn|let|mut|loop|true|false|nil|and|or|not|var|const)\b").unwrap();
    static ref OPERATOR: Regex = Regex::new(r"^(>=|<=|==|=>|!= |\|>|\*|\+|-|/|%|=|<|>|\||\^)").unwrap();
    static ref STRING: Regex = Regex::new(r#"^"([^"\\]|\\.)*"|'([^'\\]|\\.)*'"#).unwrap();
    static ref BLOCK_START: Regex = Regex::new(r"^\{").unwrap();
    static ref BLOCK_END: Regex = Regex::new(r"^\}").unwrap();
    static ref PARAN_START: Regex = Regex::new(r"^\(").unwrap();
    static ref PARAN_END: Regex = Regex::new(r"^\)").unwrap();
    static ref ARRAY_START: Regex = Regex::new(r"^\[").unwrap();
    static ref ARRAY_END: Regex = Regex::new(r"^\]").unwrap();
    static ref COMMA: Regex = Regex::new(r"^,").unwrap();
    static ref COLON: Regex = Regex::new(r"^:").unwrap();
    static ref PERIOD: Regex = Regex::new(r"^\.").unwrap();
    static ref DOUBLE_PERIOD: Regex = Regex::new(r"^\.\.").unwrap();
    static ref LINECOMMENT: Regex = Regex::new(r"^//.*").unwrap();
    static ref BLOCKCOMMENT: Regex = Regex::new(r"^/\*[\s\S]*?\*/").unwrap();
}

fn is_number(character: &[u8]) -> bool {
    NUMBER.is_match(character)
}
fn is_whitespace(character: &[u8]) -> bool {
    WHITESPACE.is_match(character)
}
fn is_word(character: &[u8]) -> bool {
    WORD.is_match(character)
}
fn is_keyword(character: &[u8]) -> bool {
    KEYWORD.is_match(character)
}
fn is_string(character: &[u8]) -> bool {
    match STRING.find(character) {
        Some(m) => m.start() == 0,
        None => false,
    }
}
fn is_operator(character: &[u8]) -> bool {
    OPERATOR.is_match(character)
}
fn is_block_start(character: &[u8]) -> bool {
    BLOCK_START.is_match(character)
}
fn is_block_end(character: &[u8]) -> bool {
    BLOCK_END.is_match(character)
}
fn is_paren_start(character: &[u8]) -> bool {
    PARAN_START.is_match(character)
}
fn is_paren_end(character: &[u8]) -> bool {
    PARAN_END.is_match(character)
}
fn is_array_start(character: &[u8]) -> bool {
    ARRAY_START.is_match(character)
}
fn is_array_end(character: &[u8]) -> bool {
    ARRAY_END.is_match(character)
}
fn is_comma(character: &[u8]) -> bool {
    COMMA.is_match(character)
}
fn is_colon(character: &[u8]) -> bool {
    COLON.is_match(character)
}
fn is_double_period(character: &[u8]) -> bool {
    DOUBLE_PERIOD.is_match(character)
}
fn is_period(character: &[u8]) -> bool {
    PERIOD.is_match(character)
}
fn is_line_comment(character: &[u8]) -> bool {
    LINECOMMENT.is_match(character)
}
fn is_block_comment(character: &[u8]) -> bool {
    BLOCKCOMMENT.is_match(character)
}

fn match_first(s: &[u8], regex: &Regex) -> Option<String> {
    regex
        .find(s)
        .map(|the_match| String::from_utf8_lossy(the_match.as_bytes()).into())
}

fn make_token(token_type: TokenType, value: &str, start: usize) -> Token {
    Token {
        token_type,
        value: value.to_string(),
        start,
        end: start + value.len(),
    }
}

fn return_token_at_index(str_from_index: &[u8], start_index: usize) -> Option<Token> {
    if is_string(str_from_index) {
        return Some(make_token(
            TokenType::String,
            &match_first(str_from_index, &STRING)?,
            start_index,
        ));
    }
    let is_line_comment_bool = is_line_comment(str_from_index);
    if is_line_comment_bool || is_block_comment(str_from_index) {
        return Some(make_token(
            if is_line_comment_bool {
                TokenType::LineComment
            } else {
                TokenType::BlockComment
            },
            &match_first(
                str_from_index,
                if is_line_comment_bool {
                    &LINECOMMENT
                } else {
                    &BLOCKCOMMENT
                },
            )?,
            start_index,
        ));
    }
    if is_paren_end(str_from_index) {
        return Some(make_token(
            TokenType::Brace,
            &match_first(str_from_index, &PARAN_END)?,
            start_index,
        ));
    }
    if is_paren_start(str_from_index) {
        return Some(make_token(
            TokenType::Brace,
            &match_first(str_from_index, &PARAN_START)?,
            start_index,
        ));
    }
    if is_block_start(str_from_index) {
        return Some(make_token(
            TokenType::Brace,
            &match_first(str_from_index, &BLOCK_START)?,
            start_index,
        ));
    }
    if is_block_end(str_from_index) {
        return Some(make_token(
            TokenType::Brace,
            &match_first(str_from_index, &BLOCK_END)?,
            start_index,
        ));
    }
    if is_array_start(str_from_index) {
        return Some(make_token(
            TokenType::Brace,
            &match_first(str_from_index, &ARRAY_START)?,
            start_index,
        ));
    }
    if is_array_end(str_from_index) {
        return Some(make_token(
            TokenType::Brace,
            &match_first(str_from_index, &ARRAY_END)?,
            start_index,
        ));
    }
    if is_comma(str_from_index) {
        return Some(make_token(
            TokenType::Comma,
            &match_first(str_from_index, &COMMA)?,
            start_index,
        ));
    }
    if is_operator(str_from_index) {
        return Some(make_token(
            TokenType::Operator,
            &match_first(str_from_index, &OPERATOR)?,
            start_index,
        ));
    }
    if is_number(str_from_index) {
        return Some(make_token(
            TokenType::Number,
            &match_first(str_from_index, &NUMBER)?,
            start_index,
        ));
    }
    if is_keyword(str_from_index) {
        return Some(make_token(
            TokenType::Keyword,
            &match_first(str_from_index, &KEYWORD)?,
            start_index,
        ));
    }
    if is_word(str_from_index) {
        return Some(make_token(
            TokenType::Word,
            &match_first(str_from_index, &WORD)?,
            start_index,
        ));
    }
    if is_colon(str_from_index) {
        return Some(make_token(
            TokenType::Colon,
            &match_first(str_from_index, &COLON)?,
            start_index,
        ));
    }
    if is_double_period(str_from_index) {
        return Some(make_token(
            TokenType::DoublePeriod,
            &match_first(str_from_index, &DOUBLE_PERIOD)?,
            start_index,
        ));
    }
    if is_period(str_from_index) {
        return Some(make_token(
            TokenType::Period,
            &match_first(str_from_index, &PERIOD)?,
            start_index,
        ));
    }
    if is_whitespace(str_from_index) {
        return Some(make_token(
            TokenType::Whitespace,
            &match_first(str_from_index, &WHITESPACE)?,
            start_index,
        ));
    }
    None
}

fn recursively_tokenise(s: &[u8], current_index: usize, previous_tokens: Vec<Token>) -> Vec<Token> {
    if current_index >= s.len() {
        return previous_tokens;
    }
    let token = return_token_at_index(&s[current_index..], current_index);
    let Some(token) = token else {
        return recursively_tokenise(s, current_index + 1, previous_tokens);
    };
    let mut new_tokens = previous_tokens;
    let token_length = token.value.len();
    new_tokens.push(token);
    recursively_tokenise(s, current_index + token_length, new_tokens)
}

pub fn lexer(s: &str) -> Vec<Token> {
    recursively_tokenise(s.as_bytes(), 0, Vec::new())
}

#[cfg(test)]
mod tests {
    use pretty_assertions::assert_eq;

    use super::*;

    #[test]
    fn is_number_test() {
        assert!(is_number("1".as_bytes()));
        assert!(is_number("1 abc".as_bytes()));
        assert!(is_number("1.1".as_bytes()));
        assert!(is_number("1.1 abc".as_bytes()));
        assert!(!is_number("a".as_bytes()));

        assert!(is_number("1".as_bytes()));
        assert!(is_number(".1".as_bytes()));
        assert!(is_number("5?".as_bytes()));
        assert!(is_number("5 + 6".as_bytes()));
        assert!(is_number("5 + a".as_bytes()));
        assert!(is_number("5.5".as_bytes()));

        assert!(!is_number("1abc".as_bytes()));
        assert!(!is_number("a".as_bytes()));
        assert!(!is_number("?".as_bytes()));
        assert!(!is_number("?5".as_bytes()));
    }

    #[test]
    fn is_whitespace_test() {
        assert!(is_whitespace(" ".as_bytes()));
        assert!(is_whitespace("  ".as_bytes()));
        assert!(is_whitespace(" a".as_bytes()));
        assert!(is_whitespace("a ".as_bytes()));

        assert!(!is_whitespace("a".as_bytes()));
        assert!(!is_whitespace("?".as_bytes()));
    }

    #[test]
    fn is_word_test() {
        assert!(is_word("a".as_bytes()));
        assert!(is_word("a ".as_bytes()));
        assert!(is_word("a5".as_bytes()));
        assert!(is_word("a5a".as_bytes()));

        assert!(!is_word("5".as_bytes()));
        assert!(!is_word("5a".as_bytes()));
        assert!(!is_word("5a5".as_bytes()));
    }

    #[test]
    fn is_string_test() {
        assert!(is_string("\"\"".as_bytes()));
        assert!(is_string("\"a\"".as_bytes()));
        assert!(is_string("\"a\" ".as_bytes()));
        assert!(is_string("\"a\"5".as_bytes()));
        assert!(is_string("'a'5".as_bytes()));
        assert!(is_string("\"with escaped \\\" backslash\"".as_bytes()));

        assert!(!is_string("\"".as_bytes()));
        assert!(!is_string("\"a".as_bytes()));
        assert!(!is_string("a\"".as_bytes()));
        assert!(!is_string(" \"a\"".as_bytes()));
        assert!(!is_string("5\"a\"".as_bytes()));
        assert!(!is_string("a + 'str'".as_bytes()));
        assert!(is_string("'c'".as_bytes()));
    }

    #[test]
    fn is_operator_test() {
        assert!(is_operator("+".as_bytes()));
        assert!(is_operator("+ ".as_bytes()));
        assert!(is_operator("-".as_bytes()));
        assert!(is_operator("<=".as_bytes()));
        assert!(is_operator("<= ".as_bytes()));
        assert!(is_operator(">=".as_bytes()));
        assert!(is_operator(">= ".as_bytes()));
        assert!(is_operator("> ".as_bytes()));
        assert!(is_operator("< ".as_bytes()));
        assert!(is_operator("| ".as_bytes()));
        assert!(is_operator("|> ".as_bytes()));
        assert!(is_operator("^ ".as_bytes()));
        assert!(is_operator("% ".as_bytes()));
        assert!(is_operator("+* ".as_bytes()));

        assert!(!is_operator("5 + 5".as_bytes()));
        assert!(!is_operator("a".as_bytes()));
        assert!(!is_operator("a+".as_bytes()));
        assert!(!is_operator("a+5".as_bytes()));
        assert!(!is_operator("5a+5".as_bytes()));
        assert!(!is_operator(", newVar".as_bytes()));
        assert!(!is_operator(",".as_bytes()));
    }

    #[test]
    fn is_block_start_test() {
        assert!(is_block_start("{".as_bytes()));
        assert!(is_block_start("{ ".as_bytes()));
        assert!(is_block_start("{5".as_bytes()));
        assert!(is_block_start("{a".as_bytes()));
        assert!(is_block_start("{5 ".as_bytes()));

        assert!(!is_block_start("5".as_bytes()));
        assert!(!is_block_start("5 + 5".as_bytes()));
        assert!(!is_block_start("5{ + 5".as_bytes()));
        assert!(!is_block_start("a{ + 5".as_bytes()));
        assert!(!is_block_start(" { + 5".as_bytes()));
    }

    #[test]
    fn is_block_end_test() {
        assert!(is_block_end("}".as_bytes()));
        assert!(is_block_end("} ".as_bytes()));
        assert!(is_block_end("}5".as_bytes()));
        assert!(is_block_end("}5 ".as_bytes()));

        assert!(!is_block_end("5".as_bytes()));
        assert!(!is_block_end("5 + 5".as_bytes()));
        assert!(!is_block_end("5} + 5".as_bytes()));
        assert!(!is_block_end(" } + 5".as_bytes()));
    }

    #[test]
    fn is_paren_start_test() {
        assert!(is_paren_start("(".as_bytes()));
        assert!(is_paren_start("( ".as_bytes()));
        assert!(is_paren_start("(5".as_bytes()));
        assert!(is_paren_start("(5 ".as_bytes()));
        assert!(is_paren_start("(5 + 5".as_bytes()));
        assert!(is_paren_start("(5 + 5)".as_bytes()));
        assert!(is_paren_start("(5 + 5) ".as_bytes()));

        assert!(!is_paren_start("5".as_bytes()));
        assert!(!is_paren_start("5 + 5".as_bytes()));
        assert!(!is_paren_start("5( + 5)".as_bytes()));
        assert!(!is_paren_start(" ( + 5)".as_bytes()));
    }

    #[test]
    fn is_paren_end_test() {
        assert!(is_paren_end(")".as_bytes()));
        assert!(is_paren_end(") ".as_bytes()));
        assert!(is_paren_end(")5".as_bytes()));
        assert!(is_paren_end(")5 ".as_bytes()));

        assert!(!is_paren_end("5".as_bytes()));
        assert!(!is_paren_end("5 + 5".as_bytes()));
        assert!(!is_paren_end("5) + 5".as_bytes()));
        assert!(!is_paren_end(" ) + 5".as_bytes()));
    }

    #[test]
    fn is_comma_test() {
        assert!(is_comma(",".as_bytes()));
        assert!(is_comma(", ".as_bytes()));
        assert!(is_comma(",5".as_bytes()));
        assert!(is_comma(",5 ".as_bytes()));

        assert!(!is_comma("5".as_bytes()));
        assert!(!is_comma("5 + 5".as_bytes()));
        assert!(!is_comma("5, + 5".as_bytes()));
        assert!(!is_comma(" , + 5".as_bytes()));
    }

    #[test]
    fn is_line_comment_test() {
        assert!(is_line_comment("//".as_bytes()));
        assert!(is_line_comment("// ".as_bytes()));
        assert!(is_line_comment("//5".as_bytes()));
        assert!(is_line_comment("//5 ".as_bytes()));

        assert!(!is_line_comment("5".as_bytes()));
        assert!(!is_line_comment("5 + 5".as_bytes()));
        assert!(!is_line_comment("5// + 5".as_bytes()));
        assert!(!is_line_comment(" // + 5".as_bytes()));
    }

    #[test]
    fn is_block_comment_test() {
        assert!(is_block_comment("/*  */".as_bytes()));
        assert!(is_block_comment("/***/".as_bytes()));
        assert!(is_block_comment("/*5*/".as_bytes()));
        assert!(is_block_comment("/*5 */".as_bytes()));

        assert!(!is_block_comment("/*".as_bytes()));
        assert!(!is_block_comment("5".as_bytes()));
        assert!(!is_block_comment("5 + 5".as_bytes()));
        assert!(!is_block_comment("5/* + 5".as_bytes()));
        assert!(!is_block_comment(" /* + 5".as_bytes()));
        assert!(!is_block_comment(
            r#"  /* and
   here
   */
   "#
            .as_bytes()
        ));
    }

    #[test]
    fn make_token_test() {
        assert_eq!(
            make_token(TokenType::Keyword, "const", 56),
            Token {
                token_type: TokenType::Keyword,
                value: "const".to_string(),
                start: 56,
                end: 61,
            }
        );
    }

    #[test]
    fn return_token_at_index_test() {
        assert_eq!(
            return_token_at_index("const".as_bytes(), 0),
            Some(Token {
                token_type: TokenType::Keyword,
                value: "const".to_string(),
                start: 0,
                end: 5,
            })
        );
        assert_eq!(
            return_token_at_index("4554".as_bytes(), 2),
            Some(Token {
                token_type: TokenType::Number,
                value: "4554".to_string(),
                start: 2,
                end: 6,
            })
        );
    }

    #[test]
    fn lexer_test() {
        assert_eq!(
            lexer("const a=5"),
            vec![
                Token {
                    token_type: TokenType::Keyword,
                    value: "const".to_string(),
                    start: 0,
                    end: 5,
                },
                Token {
                    token_type: TokenType::Whitespace,
                    value: " ".to_string(),
                    start: 5,
                    end: 6,
                },
                Token {
                    token_type: TokenType::Word,
                    value: "a".to_string(),
                    start: 6,
                    end: 7,
                },
                Token {
                    token_type: TokenType::Operator,
                    value: "=".to_string(),
                    start: 7,
                    end: 8,
                },
                Token {
                    token_type: TokenType::Number,
                    value: "5".to_string(),
                    start: 8,
                    end: 9,
                },
            ]
        );
        assert_eq!(
            lexer("54 + 22500 + 6"),
            vec![
                Token {
                    token_type: TokenType::Number,
                    value: "54".to_string(),
                    start: 0,
                    end: 2,
                },
                Token {
                    token_type: TokenType::Whitespace,
                    value: " ".to_string(),
                    start: 2,
                    end: 3,
                },
                Token {
                    token_type: TokenType::Operator,
                    value: "+".to_string(),
                    start: 3,
                    end: 4,
                },
                Token {
                    token_type: TokenType::Whitespace,
                    value: " ".to_string(),
                    start: 4,
                    end: 5,
                },
                Token {
                    token_type: TokenType::Number,
                    value: "22500".to_string(),
                    start: 5,
                    end: 10,
                },
                Token {
                    token_type: TokenType::Whitespace,
                    value: " ".to_string(),
                    start: 10,
                    end: 11,
                },
                Token {
                    token_type: TokenType::Operator,
                    value: "+".to_string(),
                    start: 11,
                    end: 12,
                },
                Token {
                    token_type: TokenType::Whitespace,
                    value: " ".to_string(),
                    start: 12,
                    end: 13,
                },
                Token {
                    token_type: TokenType::Number,
                    value: "6".to_string(),
                    start: 13,
                    end: 14,
                },
            ]
        );
    }

    // We have this as a test so we can ensure it never panics with an unwrap in the server.
    #[test]
    fn test_token_type_to_semantic_token_type() {
        let semantic_types = TokenType::all_semantic_token_types().unwrap();
        assert!(!semantic_types.is_empty());
    }

    #[test]
    fn test_lexer_negative_word() {
        assert_eq!(
            lexer("-legX"),
            vec![
                Token {
                    token_type: TokenType::Operator,
                    value: "-".to_string(),
                    start: 0,
                    end: 1,
                },
                Token {
                    token_type: TokenType::Word,
                    value: "legX".to_string(),
                    start: 1,
                    end: 5,
                },
            ]
        );
    }
}
