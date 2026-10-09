// Clippy does not agree with rustc here for some reason.
#![allow(clippy::needless_lifetimes)]

use std::fmt;
use std::iter::Enumerate;
use std::num::NonZeroUsize;
use std::str::FromStr;

use anyhow::Result;
use parse_display::Display;
use serde::Deserialize;
use serde::Serialize;
use tower_lsp::lsp_types::SemanticTokenType;
use winnow::stream::ContainsToken;
use winnow::stream::Stream;
use winnow::{self};

use crate::CompilationIssue;
use crate::ModuleId;
use crate::SourceRange;
use crate::errors::KclError;
use crate::parsing::ast::types::ItemVisibility;
use crate::parsing::ast::types::VariableKind;

#[doc(hidden)]
pub mod adapter;

pub use kcl_syntax::keywords::KEYWORDS as RESERVED_WORDS;

// Note the ordering, it's important that `m` comes after `mm` and `cm`.
pub const NUM_SUFFIXES: [&str; 10] = ["mm", "cm", "m", "inch", "in", "ft", "yd", "deg", "rad", "?"];

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize, ts_rs::TS)]
#[repr(u32)]
pub enum NumericSuffix {
    None,
    Count,
    Length,
    Angle,
    Mm,
    Cm,
    M,
    Inch,
    Ft,
    Yd,
    Deg,
    Rad,
    Unknown,
}

impl NumericSuffix {
    #[allow(dead_code)]
    pub fn is_none(self) -> bool {
        self == Self::None
    }

    pub fn is_some(self) -> bool {
        self != Self::None
    }

    pub fn digestable_id(&self) -> &[u8] {
        match self {
            NumericSuffix::None => &[],
            NumericSuffix::Count => b"_",
            NumericSuffix::Unknown => b"?",
            NumericSuffix::Length => b"Length",
            NumericSuffix::Angle => b"Angle",
            NumericSuffix::Mm => b"mm",
            NumericSuffix::Cm => b"cm",
            NumericSuffix::M => b"m",
            NumericSuffix::Inch => b"in",
            NumericSuffix::Ft => b"ft",
            NumericSuffix::Yd => b"yd",
            NumericSuffix::Deg => b"deg",
            NumericSuffix::Rad => b"rad",
        }
    }
}

impl FromStr for NumericSuffix {
    type Err = CompilationIssue;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "_" | "Count" => Ok(NumericSuffix::Count),
            "Length" => Ok(NumericSuffix::Length),
            "Angle" => Ok(NumericSuffix::Angle),
            "mm" | "millimeters" => Ok(NumericSuffix::Mm),
            "cm" | "centimeters" => Ok(NumericSuffix::Cm),
            "m" | "meters" => Ok(NumericSuffix::M),
            "inch" | "in" => Ok(NumericSuffix::Inch),
            "ft" | "feet" => Ok(NumericSuffix::Ft),
            "yd" | "yards" => Ok(NumericSuffix::Yd),
            "deg" | "degrees" => Ok(NumericSuffix::Deg),
            "rad" | "radians" => Ok(NumericSuffix::Rad),
            "?" => Ok(NumericSuffix::Unknown),
            _ => Err(CompilationIssue::err(SourceRange::default(), "invalid unit of measure")),
        }
    }
}

impl fmt::Display for NumericSuffix {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            NumericSuffix::None => Ok(()),
            NumericSuffix::Count => write!(f, "_"),
            NumericSuffix::Unknown => write!(f, "_?"),
            NumericSuffix::Length => write!(f, "Length"),
            NumericSuffix::Angle => write!(f, "Angle"),
            NumericSuffix::Mm => write!(f, "mm"),
            NumericSuffix::Cm => write!(f, "cm"),
            NumericSuffix::M => write!(f, "m"),
            NumericSuffix::Inch => write!(f, "in"),
            NumericSuffix::Ft => write!(f, "ft"),
            NumericSuffix::Yd => write!(f, "yd"),
            NumericSuffix::Deg => write!(f, "deg"),
            NumericSuffix::Rad => write!(f, "rad"),
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct TokenStream {
    tokens: Vec<Token>,
}

impl TokenStream {
    fn new(tokens: Vec<Token>) -> Self {
        Self { tokens }
    }

    /// Allow the parser to read `use` as an identifier until the module's KCL
    /// version is known. Return the original keyword ranges for validation.
    pub(super) fn allow_use_identifiers(&mut self) -> Vec<SourceRange> {
        self.tokens
            .iter_mut()
            .filter_map(|token| {
                if token.token_type == TokenType::Keyword && token.value == "use" {
                    token.token_type = TokenType::Word;
                    Some(token.as_source_range())
                } else {
                    None
                }
            })
            .collect()
    }

    pub(super) fn remove_unknown(&mut self) -> Vec<Token> {
        let tokens = std::mem::take(&mut self.tokens);
        let (tokens, unknown_tokens): (Vec<Token>, Vec<Token>) = tokens
            .into_iter()
            .partition(|token| token.token_type != TokenType::Unknown);
        self.tokens = tokens;
        unknown_tokens
    }

    pub fn iter(&self) -> impl Iterator<Item = &Token> {
        self.tokens.iter()
    }

    pub fn is_empty(&self) -> bool {
        self.tokens.is_empty()
    }

    pub fn as_slice(&self) -> TokenSlice<'_> {
        TokenSlice::from(self)
    }
}

impl<'a> From<&'a TokenStream> for TokenSlice<'a> {
    fn from(stream: &'a TokenStream) -> Self {
        TokenSlice {
            start: 0,
            end: stream.tokens.len(),
            stream,
        }
    }
}

impl IntoIterator for TokenStream {
    type Item = Token;

    type IntoIter = std::vec::IntoIter<Token>;

    fn into_iter(self) -> Self::IntoIter {
        self.tokens.into_iter()
    }
}

#[derive(Debug, Clone)]
pub struct TokenSlice<'a> {
    stream: &'a TokenStream,
    /// Current position of the leading Token in the stream
    start: usize,
    /// The number of total Tokens in the stream
    end: usize,
}

impl<'a> std::ops::Deref for TokenSlice<'a> {
    type Target = [Token];

    fn deref(&self) -> &Self::Target {
        &self.stream.tokens[self.start..self.end]
    }
}

impl<'a> TokenSlice<'a> {
    pub fn token(&self, i: usize) -> &Token {
        &self.stream.tokens[i + self.start]
    }

    pub fn iter(&self) -> impl Iterator<Item = &Token> {
        (**self).iter()
    }

    pub fn without_ends(&self) -> Self {
        Self {
            start: self.start + 1,
            end: self.end - 1,
            stream: self.stream,
        }
    }

    pub fn as_source_range(&self) -> SourceRange {
        let stream_len = self.stream.tokens.len();
        let first_token = if stream_len == self.start {
            &self.stream.tokens[self.start - 1]
        } else {
            self.token(0)
        };
        let last_token = if stream_len == self.end {
            &self.stream.tokens[stream_len - 1]
        } else {
            self.token(self.end - self.start)
        };
        SourceRange::new(first_token.start, last_token.end, last_token.module_id)
    }
}

impl<'a> IntoIterator for TokenSlice<'a> {
    type Item = &'a Token;

    type IntoIter = std::slice::Iter<'a, Token>;

    fn into_iter(self) -> Self::IntoIter {
        self.stream.tokens[self.start..self.end].iter()
    }
}

impl<'a> Stream for TokenSlice<'a> {
    type Token = Token;
    type Slice = Self;
    type IterOffsets = Enumerate<std::vec::IntoIter<Token>>;
    type Checkpoint = Checkpoint;

    fn iter_offsets(&self) -> Self::IterOffsets {
        #[allow(clippy::unnecessary_to_owned)]
        self.to_vec().into_iter().enumerate()
    }

    fn eof_offset(&self) -> usize {
        self.len()
    }

    fn next_token(&mut self) -> Option<Self::Token> {
        let token = self.first()?.clone();
        self.start += 1;
        Some(token)
    }

    /// Split off the next token from the input
    fn peek_token(&self) -> Option<Self::Token> {
        Some(self.first()?.clone())
    }

    fn offset_for<P>(&self, predicate: P) -> Option<usize>
    where
        P: Fn(Self::Token) -> bool,
    {
        self.iter().position(|b| predicate(b.clone()))
    }

    fn offset_at(&self, tokens: usize) -> Result<usize, winnow::error::Needed> {
        if let Some(needed) = tokens.checked_sub(self.len()).and_then(NonZeroUsize::new) {
            Err(winnow::error::Needed::Size(needed))
        } else {
            Ok(tokens)
        }
    }

    fn next_slice(&mut self, offset: usize) -> Self::Slice {
        assert!(self.start + offset <= self.end);

        let next = TokenSlice {
            stream: self.stream,
            start: self.start,
            end: self.start + offset,
        };
        self.start += offset;
        next
    }

    /// Split off a slice of tokens from the input
    fn peek_slice(&self, offset: usize) -> Self::Slice {
        assert!(self.start + offset <= self.end);

        TokenSlice {
            stream: self.stream,
            start: self.start,
            end: self.start + offset,
        }
    }

    fn checkpoint(&self) -> Self::Checkpoint {
        Checkpoint(self.start, self.end)
    }

    fn reset(&mut self, checkpoint: &Self::Checkpoint) {
        self.start = checkpoint.0;
        self.end = checkpoint.1;
    }

    fn trace(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        write!(f, "{self:?}")
    }
}

impl<'a> winnow::stream::Offset for TokenSlice<'a> {
    fn offset_from(&self, start: &Self) -> usize {
        self.start - start.start
    }
}

impl<'a> winnow::stream::Offset<Checkpoint> for TokenSlice<'a> {
    fn offset_from(&self, start: &Checkpoint) -> usize {
        self.start - start.0
    }
}

impl winnow::stream::Offset for Checkpoint {
    fn offset_from(&self, start: &Self) -> usize {
        self.0 - start.0
    }
}

impl<'a> winnow::stream::StreamIsPartial for TokenSlice<'a> {
    type PartialState = ();

    fn complete(&mut self) -> Self::PartialState {}

    fn restore_partial(&mut self, _: Self::PartialState) {}

    fn is_partial_supported() -> bool {
        false
    }
}

impl<'a> winnow::stream::FindSlice<&str> for TokenSlice<'a> {
    fn find_slice(&self, substr: &str) -> Option<std::ops::Range<usize>> {
        self.iter()
            .enumerate()
            .find_map(|(i, b)| if b.value == substr { Some(i..self.end) } else { None })
    }
}

#[derive(Clone, Debug)]
pub struct Checkpoint(usize, usize);

/// The types of tokens.
#[derive(Debug, PartialEq, Eq, Copy, Clone, Display)]
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
    /// A double colon: `::`
    DoubleColon,
    /// A period.
    Period,
    /// A double period: `..`.
    DoublePeriod,
    /// A double period and a less than: `..<`.
    DoublePeriodLessThan,
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
    /// The @ symbol.
    At,
    /// `;`
    SemiColon,
}

/// Most KCL tokens correspond to LSP semantic tokens (but not all).
impl TryFrom<TokenType> for SemanticTokenType {
    type Error = anyhow::Error;
    fn try_from(token_type: TokenType) -> Result<Self> {
        // If you return a new kind of `SemanticTokenType`, make sure to update `SEMANTIC_TOKEN_TYPES`
        // in the LSP implementation.
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
            | TokenType::DoubleColon
            | TokenType::Period
            | TokenType::DoublePeriod
            | TokenType::DoublePeriodLessThan
            | TokenType::Hash
            | TokenType::Dollar
            | TokenType::At
            | TokenType::SemiColon
            | TokenType::Unknown => {
                anyhow::bail!("unsupported token type: {:?}", token_type)
            }
        })
    }
}

impl TokenType {
    pub fn is_whitespace(&self) -> bool {
        matches!(self, Self::Whitespace)
    }

    pub fn is_comment(&self) -> bool {
        matches!(self, Self::LineComment | Self::BlockComment)
    }
}

#[derive(Debug, PartialEq, Eq, Clone)]
pub struct Token {
    pub token_type: TokenType,
    /// Offset in the source code where this token begins.
    pub start: usize,
    /// Offset in the source code where this token ends.
    pub end: usize,
    pub(super) module_id: ModuleId,
    pub(super) value: String,
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
    pub fn from_range(
        range: std::ops::Range<usize>,
        module_id: ModuleId,
        token_type: TokenType,
        value: String,
    ) -> Self {
        Self {
            start: range.start,
            end: range.end,
            module_id,
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
        SourceRange::new(self.start, self.end, self.module_id)
    }

    pub fn as_source_ranges(&self) -> Vec<SourceRange> {
        vec![self.as_source_range()]
    }

    pub fn visibility_keyword(&self) -> Option<ItemVisibility> {
        if !matches!(self.token_type, TokenType::Keyword) {
            return None;
        }
        match self.value.as_str() {
            "export" => Some(ItemVisibility::Export),
            _ => None,
        }
    }

    pub fn numeric_value(&self) -> Option<f64> {
        if self.token_type != TokenType::Number {
            return None;
        }
        let value = &self.value;
        let value = value
            .split_once(|c: char| c == '_' || c.is_ascii_alphabetic())
            .map(|(s, _)| s)
            .unwrap_or(value);
        value.parse().ok()
    }

    pub fn uint_value(&self) -> Option<u32> {
        if self.token_type != TokenType::Number {
            return None;
        }
        let value = &self.value;
        let value = value
            .split_once(|c: char| c == '_' || c.is_ascii_alphabetic())
            .map(|(s, _)| s)
            .unwrap_or(value);
        value.parse().ok()
    }

    pub fn numeric_suffix(&self) -> NumericSuffix {
        if self.token_type != TokenType::Number {
            return NumericSuffix::None;
        }

        if self.value.ends_with('_') {
            return NumericSuffix::Count;
        }

        for suffix in NUM_SUFFIXES {
            if self.value.ends_with(suffix) {
                return suffix.parse().unwrap();
            }
        }

        NumericSuffix::None
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
        Self::new(token.start, token.end, token.module_id)
    }
}

impl From<&Token> for SourceRange {
    fn from(token: &Token) -> Self {
        Self::new(token.start, token.end, token.module_id)
    }
}

/// Tokenizes source using `kcl-syntax`.
pub fn lex(s: &str, module_id: ModuleId) -> Result<TokenStream, KclError> {
    let result = adapter::lex_with_diagnostics(s, module_id);
    match result.to_lexical_error() {
        Some(err) => Err(err),
        None => Ok(result.tokens),
    }
}

#[cfg(test)]
mod tests {
    use super::Token;
    use super::TokenSlice;
    use super::TokenType;
    use super::lex;
    use crate::ModuleId;

    #[test]
    fn lex_uses_syntax_lexer() {
        let module_id = ModuleId::default();
        let tokens = lex("x = 1", module_id).expect("valid input should produce tokens");
        assert!(!tokens.is_empty());

        let err = lex("\"abc", module_id).expect_err("unterminated string is a lexical error");
        assert_eq!(err.error_type(), "lexical");
        assert_eq!(err.message(), "unterminated string literal");
    }

    #[test]
    fn test_program2() {
        let program = r#"const part001 = startSketchOn(XY)
    |> startProfileAt([0.0000000000, 5.0000000000], %)
    |> line([0.4900857016, -0.0240763666], %)

const part002 = "part002"
const things = [part001, 0.0]
let blah = 1
const foo = false
let baz = {a: 1, part001: "thing"}

fn ghi = (part001) => {
  return part001
}

show(part001)"#;
        let module_id = ModuleId::from_usize(1);
        let actual = lex(program, module_id).unwrap();
        insta::assert_debug_snapshot!(actual.tokens);
    }

    #[track_caller]
    fn assert_tokens(expected: &[(TokenType, usize, usize)], actual: TokenSlice) {
        let mut e = 0;
        let mut issues = vec![];
        for a in actual {
            if expected[e].0 != a.token_type {
                if a.token_type == TokenType::Whitespace {
                    continue;
                }
                issues.push(format!(
                    "Type mismatch: expected `{}`, found `{}` (`{a:?}`), at index {e}",
                    expected[e].0, a.token_type
                ));
            }

            if expected[e].1 != a.start || expected[e].2 != a.end {
                issues.push(format!(
                    "Source range mismatch: expected {}-{}, found {}-{} (`{a:?}`), at index {e}",
                    expected[e].1, expected[e].2, a.start, a.end
                ));
            }

            e += 1;
        }
        if e < expected.len() {
            issues.push(format!("Expected `{}` tokens, found `{e}`", expected.len()));
        }
        assert!(issues.is_empty(), "{}", issues.join("\n"));
    }

    #[test]
    fn test_program0() {
        let program = "const a=5";
        let module_id = ModuleId::from_usize(1);
        let actual = lex(program, module_id).unwrap();

        use TokenType::*;
        assert_tokens(
            &[(Keyword, 0, 5), (Word, 6, 7), (Operator, 7, 8), (Number, 8, 9)],
            actual.as_slice(),
        );
    }

    #[test]
    fn test_program1() {
        let program = "54 + 22500 + 6";
        let module_id = ModuleId::from_usize(1);
        let actual = lex(program, module_id).unwrap();

        use TokenType::*;
        assert_tokens(
            &[
                (Number, 0, 2),
                (Operator, 3, 4),
                (Number, 5, 10),
                (Operator, 11, 12),
                (Number, 13, 14),
            ],
            actual.as_slice(),
        );
    }

    #[test]
    fn test_program3() {
        let program = r#"
// this is a comment
const yo = { a: { b: { c: '123' } } }

const key = 'c'
const things = "things"

// this is also a comment"#;
        let module_id = ModuleId::from_usize(1);
        let actual = lex(program, module_id).unwrap();

        use TokenType::*;
        assert_tokens(
            &[
                (Whitespace, 0, 1),
                (LineComment, 1, 21),
                (Whitespace, 21, 22),
                (Keyword, 22, 27),
                (Whitespace, 27, 28),
                (Word, 28, 30),
                (Whitespace, 30, 31),
                (Operator, 31, 32),
                (Whitespace, 32, 33),
                (Brace, 33, 34),
                (Whitespace, 34, 35),
                (Word, 35, 36),
                (Colon, 36, 37),
                (Whitespace, 37, 38),
                (Brace, 38, 39),
                (Whitespace, 39, 40),
                (Word, 40, 41),
                (Colon, 41, 42),
                (Whitespace, 42, 43),
                (Brace, 43, 44),
                (Whitespace, 44, 45),
                (Word, 45, 46),
                (Colon, 46, 47),
                (Whitespace, 47, 48),
                (String, 48, 53),
                (Whitespace, 53, 54),
                (Brace, 54, 55),
                (Whitespace, 55, 56),
                (Brace, 56, 57),
                (Whitespace, 57, 58),
                (Brace, 58, 59),
                (Whitespace, 59, 61),
                (Keyword, 61, 66),
                (Whitespace, 66, 67),
                (Word, 67, 70),
                (Whitespace, 70, 71),
                (Operator, 71, 72),
                (Whitespace, 72, 73),
                (String, 73, 76),
                (Whitespace, 76, 77),
                (Keyword, 77, 82),
                (Whitespace, 82, 83),
                (Word, 83, 89),
                (Whitespace, 89, 90),
                (Operator, 90, 91),
                (Whitespace, 91, 92),
                (String, 92, 100),
                (Whitespace, 100, 102),
                (LineComment, 102, 127),
            ],
            actual.as_slice(),
        );
    }

    #[test]
    fn test_program4() {
        let program = "const myArray = [0..10]";
        let module_id = ModuleId::from_usize(1);
        let actual = lex(program, module_id).unwrap();

        use TokenType::*;
        assert_tokens(
            &[
                (Keyword, 0, 5),
                (Word, 6, 13),
                (Operator, 14, 15),
                (Brace, 16, 17),
                (Number, 17, 18),
                (DoublePeriod, 18, 20),
                (Number, 20, 22),
                (Brace, 22, 23),
            ],
            actual.as_slice(),
        );
    }

    #[test]
    fn test_lexer_negative_word() {
        let module_id = ModuleId::from_usize(1);
        let actual = lex("-legX", module_id).unwrap();

        use TokenType::*;
        assert_tokens(&[(Operator, 0, 1), (Word, 1, 5)], actual.as_slice());
    }

    #[test]
    fn not_eq() {
        let module_id = ModuleId::from_usize(1);
        let actual = lex("!=", module_id).unwrap();
        let expected = vec![Token {
            token_type: TokenType::Operator,
            value: "!=".to_owned(),
            start: 0,
            end: 2,
            module_id,
        }];
        assert_eq!(actual.tokens, expected);
    }

    #[test]
    fn import_keyword() {
        let module_id = ModuleId::from_usize(1);
        let actual = lex("import foo", module_id).unwrap();
        let expected = Token {
            token_type: TokenType::Keyword,
            value: "import".to_owned(),
            start: 0,
            end: 6,
            module_id,
        };
        assert_eq!(actual.tokens[0], expected);
    }

    #[test]
    fn import_function() {
        let module_id = ModuleId::from_usize(1);
        let actual = lex("import(3)", module_id).unwrap();
        let expected = Token {
            token_type: TokenType::Word,
            value: "import".to_owned(),
            start: 0,
            end: 6,
            module_id,
        };
        assert_eq!(actual.tokens[0], expected);
    }

    #[test]
    fn use_keyword_and_function_name() {
        let module_id = ModuleId::default();
        for (source, expected_type) in [
            ("use", TokenType::Keyword),
            ("use = 1", TokenType::Keyword),
            ("use(3)", TokenType::Word),
            ("use (3)", TokenType::Keyword),
            ("useful", TokenType::Word),
        ] {
            let tokens = lex(source, module_id).unwrap();
            assert_eq!(tokens.tokens[0].token_type, expected_type, "{source}");
        }
    }

    #[test]
    fn test_is_code_token() {
        let module_id = ModuleId::default();
        let actual = lex("foo (4/* comment */ +,2,\"sdfsdf\") // comment", module_id).unwrap();
        let non_code = [1, 4, 5, 12, 13];
        for i in 0..14 {
            if non_code.contains(&i) {
                assert!(
                    !actual.tokens[i].is_code_token(),
                    "failed test {i}: {:?}",
                    actual.tokens[i],
                );
            } else {
                assert!(
                    actual.tokens[i].is_code_token(),
                    "failed test {i}: {:?}",
                    actual.tokens[i],
                );
            }
        }
    }
    #[test]
    fn test_boolean_literal() {
        let module_id = ModuleId::default();
        let actual = lex("true", module_id).unwrap();
        let expected = Token {
            token_type: TokenType::Keyword,
            value: "true".to_owned(),
            start: 0,
            end: 4,
            module_id,
        };
        assert_eq!(actual.tokens[0], expected);
    }

    #[test]
    fn test_word_starting_with_keyword() {
        let module_id = ModuleId::default();
        let actual = lex("truee", module_id).unwrap();
        let expected = Token {
            token_type: TokenType::Word,
            value: "truee".to_owned(),
            start: 0,
            end: 5,
            module_id,
        };
        assert_eq!(actual.tokens[0], expected);
    }

    #[test]
    fn non_english_identifiers() {
        let module_id = ModuleId::default();
        let actual = lex("亞當", module_id).unwrap();
        let expected = Token {
            token_type: TokenType::Word,
            value: "亞當".to_owned(),
            start: 0,
            end: 6,
            module_id,
        };
        assert_eq!(actual.tokens[0], expected);
    }
}
