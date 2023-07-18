use lazy_static::lazy_static;
use regex::Regex;
use serde::{Deserialize, Serialize};
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
#[derive(Debug, PartialEq, Eq, Copy, Clone, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum TokenType {
    Number,
    Word,
    Operator,
    String,
    Brace,
    Whitespace,
    Comma,
    Colon,
    Period,
    LineComment,
    BlockComment,
}

#[wasm_bindgen]
#[derive(Debug, PartialEq, Eq, Deserialize, Serialize, Clone)]
pub struct Token {
    #[serde(rename = "type")]
    pub token_type: TokenType,
    pub start: usize,
    pub end: usize,
    #[wasm_bindgen(skip)]
    pub value: String,
}
#[wasm_bindgen]
impl Token {
    #[wasm_bindgen(constructor)]
    pub fn new(token_type: TokenType, value: String, start: usize, end: usize) -> Token {
        Token {
            token_type,
            value,
            start,
            end,
        }
    }

    #[wasm_bindgen(getter)]
    pub fn value(&self) -> String {
        self.value.clone()
    }

    #[wasm_bindgen(setter)]
    pub fn set_value(&mut self, value: String) {
        self.value = value;
    }
}

lazy_static! {
    static ref NUMBER: Regex = Regex::new(r"^-?\d+(\.\d+)?").unwrap();
    static ref WHITESPACE: Regex = Regex::new(r"\s+").unwrap();
    static ref WORD: Regex = Regex::new(r"^[a-zA-Z_][a-zA-Z0-9_]*").unwrap();
    static ref STRING: Regex = Regex::new(r#"^"([^"\\]|\\.)*"|'([^'\\]|\\.)*'"#).unwrap();
    static ref OPERATOR: Regex =
        Regex::new(r"^(>=|<=|==|=>|!= |\|>|\*|\+|-|/|%|=|<|>|\||\^)").unwrap();
    static ref BLOCK_START: Regex = Regex::new(r"^\{").unwrap();
    static ref BLOCK_END: Regex = Regex::new(r"^\}").unwrap();
    static ref PARAN_START: Regex = Regex::new(r"^\(").unwrap();
    static ref PARAN_END: Regex = Regex::new(r"^\)").unwrap();
    static ref ARRAY_START: Regex = Regex::new(r"^\[").unwrap();
    static ref ARRAY_END: Regex = Regex::new(r"^\]").unwrap();
    static ref COMMA: Regex = Regex::new(r"^,").unwrap();
    static ref COLON: Regex = Regex::new(r"^:").unwrap();
    static ref PERIOD: Regex = Regex::new(r"^\.").unwrap();
    static ref LINECOMMENT: Regex = Regex::new(r"^//.*").unwrap();
    static ref BLOCKCOMMENT: Regex = Regex::new(r"^/\*[\s\S]*?\*/").unwrap();
}

fn is_number(character: &str) -> bool {
    NUMBER.is_match(character)
}
fn is_whitespace(character: &str) -> bool {
    WHITESPACE.is_match(character)
}
fn is_word(character: &str) -> bool {
    WORD.is_match(character)
}
fn is_string(character: &str) -> bool {
    match STRING.find(character) {
        Some(m) => m.start() == 0,
        None => false,
    }
}
fn is_operator(character: &str) -> bool {
    OPERATOR.is_match(character)
}
fn is_block_start(character: &str) -> bool {
    BLOCK_START.is_match(character)
}
fn is_block_end(character: &str) -> bool {
    BLOCK_END.is_match(character)
}
fn is_paran_start(character: &str) -> bool {
    PARAN_START.is_match(character)
}
fn is_paran_end(character: &str) -> bool {
    PARAN_END.is_match(character)
}
fn is_array_start(character: &str) -> bool {
    ARRAY_START.is_match(character)
}
fn is_array_end(character: &str) -> bool {
    ARRAY_END.is_match(character)
}
fn is_comma(character: &str) -> bool {
    COMMA.is_match(character)
}
fn is_colon(character: &str) -> bool {
    COLON.is_match(character)
}
fn is_period(character: &str) -> bool {
    PERIOD.is_match(character)
}
fn is_line_comment(character: &str) -> bool {
    LINECOMMENT.is_match(character)
}
fn is_block_comment(character: &str) -> bool {
    BLOCKCOMMENT.is_match(character)
}

fn match_first(str: &str, regex: &Regex) -> String {
    let the_match = regex.find(str).unwrap();
    let the_match_str = &str[the_match.start()..the_match.end()];
    the_match_str.to_string()
}

fn make_token(token_type: TokenType, value: &str, start: usize) -> Token {
    Token {
        token_type,
        value: value.to_string(),
        start,
        end: start + value.len(),
    }
}

fn return_token_at_index(str: &str, start_index: usize) -> Option<Token> {
    let str_from_index = &str[start_index..];
    if is_string(str_from_index) {
        return Some(make_token(
            TokenType::String,
            &match_first(str_from_index, &STRING),
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
            ),
            start_index,
        ));
    }
    if is_paran_end(str_from_index) {
        return Some(make_token(
            TokenType::Brace,
            &match_first(str_from_index, &PARAN_END),
            start_index,
        ));
    }
    if is_paran_start(str_from_index) {
        return Some(make_token(
            TokenType::Brace,
            &match_first(str_from_index, &PARAN_START),
            start_index,
        ));
    }
    if is_block_start(str_from_index) {
        return Some(make_token(
            TokenType::Brace,
            &match_first(str_from_index, &BLOCK_START),
            start_index,
        ));
    }
    if is_block_end(str_from_index) {
        return Some(make_token(
            TokenType::Brace,
            &match_first(str_from_index, &BLOCK_END),
            start_index,
        ));
    }
    if is_array_start(str_from_index) {
        return Some(make_token(
            TokenType::Brace,
            &match_first(str_from_index, &ARRAY_START),
            start_index,
        ));
    }
    if is_array_end(str_from_index) {
        return Some(make_token(
            TokenType::Brace,
            &match_first(str_from_index, &ARRAY_END),
            start_index,
        ));
    }
    if is_comma(str_from_index) {
        return Some(make_token(
            TokenType::Comma,
            &match_first(str_from_index, &COMMA),
            start_index,
        ));
    }
    if is_number(str_from_index) {
        return Some(make_token(
            TokenType::Number,
            &match_first(str_from_index, &NUMBER),
            start_index,
        ));
    }
    if is_operator(str_from_index) {
        return Some(make_token(
            TokenType::Operator,
            &match_first(str_from_index, &OPERATOR),
            start_index,
        ));
    }
    if is_word(str_from_index) {
        return Some(make_token(
            TokenType::Word,
            &match_first(str_from_index, &WORD),
            start_index,
        ));
    }
    if is_colon(str_from_index) {
        return Some(make_token(
            TokenType::Colon,
            &match_first(str_from_index, &COLON),
            start_index,
        ));
    }
    if is_period(str_from_index) {
        return Some(make_token(
            TokenType::Period,
            &match_first(str_from_index, &PERIOD),
            start_index,
        ));
    }
    if is_whitespace(str_from_index) {
        return Some(make_token(
            TokenType::Whitespace,
            &match_first(str_from_index, &WHITESPACE),
            start_index,
        ));
    }
    None
}

fn lexer(str: &str) -> Vec<Token> {
    fn recursively_tokenise(
        str: &str,
        current_index: usize,
        previous_tokens: Vec<Token>,
    ) -> Vec<Token> {
        if current_index >= str.len() {
            return previous_tokens;
        }
        let token = return_token_at_index(str, current_index);
        if token.is_none() {
            return recursively_tokenise(str, current_index + 1, previous_tokens);
        }
        let token = token.unwrap();
        let mut new_tokens = previous_tokens;
        let token_length = token.value.len();
        new_tokens.push(token);
        recursively_tokenise(str, current_index + token_length, new_tokens)
    }
    recursively_tokenise(str, 0, Vec::new())
}

// wasm_bindgen wrapper for lexer
// test for this function and by extension lexer are done in javascript land src/lang/tokeniser.test.ts
#[wasm_bindgen]
pub fn lexer_js(str: &str) -> JsValue {
    let tokens = lexer(str);
    JsValue::from_str(&serde_json::to_string(&tokens).expect("failed to serialize lexer output"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn is_number_test() {
        assert_eq!(is_number("1"), true);
        assert_eq!(is_number("1 abc"), true);
        assert_eq!(is_number("1abc"), true);
        assert_eq!(is_number("1.1"), true);
        assert_eq!(is_number("1.1 abc"), true);
        assert_eq!(is_number("a"), false);

        assert_eq!(is_number("1"), true);
        assert_eq!(is_number("5?"), true);
        assert_eq!(is_number("5 + 6"), true);
        assert_eq!(is_number("5 + a"), true);
        assert_eq!(is_number("-5"), true);
        assert_eq!(is_number("5.5"), true);
        assert_eq!(is_number("-5.5"), true);

        assert_eq!(is_number("a"), false);
        assert_eq!(is_number("?"), false);
        assert_eq!(is_number("?5"), false);
    }

    #[test]
    fn is_whitespace_test() {
        assert_eq!(is_whitespace(" "), true);
        assert_eq!(is_whitespace("  "), true);
        assert_eq!(is_whitespace(" a"), true);
        assert_eq!(is_whitespace("a "), true);

        assert_eq!(is_whitespace("a"), false);
        assert_eq!(is_whitespace("?"), false);
    }

    #[test]
    fn is_word_test() {
        assert_eq!(is_word("a"), true);
        assert_eq!(is_word("a "), true);
        assert_eq!(is_word("a5"), true);
        assert_eq!(is_word("a5a"), true);

        assert_eq!(is_word("5"), false);
        assert_eq!(is_word("5a"), false);
        assert_eq!(is_word("5a5"), false);
    }

    #[test]
    fn is_string_test() {
        assert_eq!(is_string("\"\""), true);
        assert_eq!(is_string("\"a\""), true);
        assert_eq!(is_string("\"a\" "), true);
        assert_eq!(is_string("\"a\"5"), true);
        assert_eq!(is_string("'a'5"), true);
        assert_eq!(is_string("\"with escaped \\\" backslash\""), true);

        assert_eq!(is_string("\""), false);
        assert_eq!(is_string("\"a"), false);
        assert_eq!(is_string("a\""), false);
        assert_eq!(is_string(" \"a\""), false);
        assert_eq!(is_string("5\"a\""), false);
        assert_eq!(is_string("a + 'str'"), false);
    }

    #[test]
    fn is_operator_test() {
        assert_eq!(is_operator("+"), true);
        assert_eq!(is_operator("+ "), true);
        assert_eq!(is_operator("-"), true);
        assert_eq!(is_operator("<="), true);
        assert_eq!(is_operator("<= "), true);
        assert_eq!(is_operator(">="), true);
        assert_eq!(is_operator(">= "), true);
        assert_eq!(is_operator("> "), true);
        assert_eq!(is_operator("< "), true);
        assert_eq!(is_operator("| "), true);
        assert_eq!(is_operator("|> "), true);
        assert_eq!(is_operator("^ "), true);
        assert_eq!(is_operator("% "), true);
        assert_eq!(is_operator("+* "), true);

        assert_eq!(is_operator("5 + 5"), false);
        assert_eq!(is_operator("a"), false);
        assert_eq!(is_operator("a+"), false);
        assert_eq!(is_operator("a+5"), false);
        assert_eq!(is_operator("5a+5"), false);
        assert_eq!(is_operator(", newVar"), false);
        assert_eq!(is_operator(","), false);
    }

    #[test]
    fn is_block_start_test() {
        assert_eq!(is_block_start("{"), true);
        assert_eq!(is_block_start("{ "), true);
        assert_eq!(is_block_start("{5"), true);
        assert_eq!(is_block_start("{a"), true);
        assert_eq!(is_block_start("{5 "), true);

        assert_eq!(is_block_start("5"), false);
        assert_eq!(is_block_start("5 + 5"), false);
        assert_eq!(is_block_start("5{ + 5"), false);
        assert_eq!(is_block_start("a{ + 5"), false);
        assert_eq!(is_block_start(" { + 5"), false);
    }

    #[test]
    fn is_block_end_test() {
        assert_eq!(is_block_end("}"), true);
        assert_eq!(is_block_end("} "), true);
        assert_eq!(is_block_end("}5"), true);
        assert_eq!(is_block_end("}5 "), true);

        assert_eq!(is_block_end("5"), false);
        assert_eq!(is_block_end("5 + 5"), false);
        assert_eq!(is_block_end("5} + 5"), false);
        assert_eq!(is_block_end(" } + 5"), false);
    }

    #[test]
    fn is_paran_start_test() {
        assert_eq!(is_paran_start("("), true);
        assert_eq!(is_paran_start("( "), true);
        assert_eq!(is_paran_start("(5"), true);
        assert_eq!(is_paran_start("(5 "), true);
        assert_eq!(is_paran_start("(5 + 5"), true);
        assert_eq!(is_paran_start("(5 + 5)"), true);
        assert_eq!(is_paran_start("(5 + 5) "), true);

        assert_eq!(is_paran_start("5"), false);
        assert_eq!(is_paran_start("5 + 5"), false);
        assert_eq!(is_paran_start("5( + 5)"), false);
        assert_eq!(is_paran_start(" ( + 5)"), false);
    }

    #[test]
    fn is_paran_end_test() {
        assert_eq!(is_paran_end(")"), true);
        assert_eq!(is_paran_end(") "), true);
        assert_eq!(is_paran_end(")5"), true);
        assert_eq!(is_paran_end(")5 "), true);

        assert_eq!(is_paran_end("5"), false);
        assert_eq!(is_paran_end("5 + 5"), false);
        assert_eq!(is_paran_end("5) + 5"), false);
        assert_eq!(is_paran_end(" ) + 5"), false);
    }

    #[test]
    fn is_comma_test() {
        assert_eq!(is_comma(","), true);
        assert_eq!(is_comma(", "), true);
        assert_eq!(is_comma(",5"), true);
        assert_eq!(is_comma(",5 "), true);

        assert_eq!(is_comma("5"), false);
        assert_eq!(is_comma("5 + 5"), false);
        assert_eq!(is_comma("5, + 5"), false);
        assert_eq!(is_comma(" , + 5"), false);
    }

    #[test]
    fn is_line_comment_test() {
        assert_eq!(is_line_comment("//"), true);
        assert_eq!(is_line_comment("// "), true);
        assert_eq!(is_line_comment("//5"), true);
        assert_eq!(is_line_comment("//5 "), true);

        assert_eq!(is_line_comment("5"), false);
        assert_eq!(is_line_comment("5 + 5"), false);
        assert_eq!(is_line_comment("5// + 5"), false);
        assert_eq!(is_line_comment(" // + 5"), false);
    }

    #[test]
    fn is_block_comment_test() {
        assert_eq!(is_block_comment("/*  */"), true);
        assert_eq!(is_block_comment("/***/"), true);
        assert_eq!(is_block_comment("/*5*/"), true);
        assert_eq!(is_block_comment("/*5 */"), true);

        assert_eq!(is_block_comment("/*"), false);
        assert_eq!(is_block_comment("5"), false);
        assert_eq!(is_block_comment("5 + 5"), false);
        assert_eq!(is_block_comment("5/* + 5"), false);
        assert_eq!(is_block_comment(" /* + 5"), false);
    }

    #[test]
    fn make_token_test() {
        assert_eq!(
            make_token(TokenType::Word, &"const".to_string(), 56),
            Token {
                token_type: TokenType::Word,
                value: "const".to_string(),
                start: 56,
                end: 61,
            }
        );
    }

    #[test]
    fn return_token_at_index_test() {
        assert_eq!(
            return_token_at_index("const", 0),
            Some(Token {
                token_type: TokenType::Word,
                value: "const".to_string(),
                start: 0,
                end: 5,
            })
        );
        assert_eq!(
            return_token_at_index("  4554", 2),
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
                    token_type: TokenType::Word,
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
}
