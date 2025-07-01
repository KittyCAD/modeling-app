// Clippy does not agree with rustc here for some reason.
#![allow(clippy::needless_lifetimes)]

use std::{fmt, iter::Enumerate, num::NonZeroUsize, str::FromStr};

use anyhow::Result;
use parse_display::Display;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use tokeniser::Input;
use tower_lsp::lsp_types::SemanticTokenType;
use winnow::{
    self,
    error::ParseError,
    stream::{ContainsToken, Stream},
};

use crate::{
    CompilationError, ModuleId,
    errors::KclError,
    parsing::ast::types::{ItemVisibility, VariableKind},
    source_range::SourceRange,
};

mod tokeniser;

pub(crate) use tokeniser::RESERVED_WORDS;

// Note the ordering, it's important that `m` comes after `mm` and `cm`.
pub const NUM_SUFFIXES: [&str; 10] = ["mm", "cm", "m", "inch", "in", "ft", "yd", "deg", "rad", "?"];

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize, ts_rs::TS, JsonSchema)]
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
    type Err = CompilationError;

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
            _ => Err(CompilationError::err(SourceRange::default(), "invalid unit of measure")),
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
pub(crate) struct TokenStream {
    tokens: Vec<Token>,
}

impl TokenStream {
    fn new(tokens: Vec<Token>) -> Self {
        Self { tokens }
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

    pub fn as_slice(&self) -> TokenSlice {
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
pub(crate) struct TokenSlice<'a> {
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

    fn raw(&self) -> &dyn fmt::Debug {
        self
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

pub fn lex(s: &str, module_id: ModuleId) -> Result<TokenStream, KclError> {
    tokeniser::lex(s, module_id).map_err(From::from)
}

impl From<ParseError<Input<'_>, winnow::error::ContextError>> for KclError {
    fn from(err: ParseError<Input<'_>, winnow::error::ContextError>) -> Self {
        let (input, offset): (Vec<char>, usize) = (err.input().chars().collect(), err.offset());
        let module_id = err.input().state.module_id;

        if offset >= input.len() {
            // From the winnow docs:
            //
            // This is an offset, not an index, and may point to
            // the end of input (input.len()) on eof errors.

            return KclError::new_lexical(crate::errors::KclErrorDetails::new(
                "unexpected EOF while parsing".to_owned(),
                vec![SourceRange::new(offset, offset, module_id)],
            ));
        }

        // TODO: Add the Winnow tokenizer context to the error.
        // See https://github.com/KittyCAD/modeling-app/issues/784
        let bad_token = &input[offset];
        // TODO: Add the Winnow parser context to the error.
        // See https://github.com/KittyCAD/modeling-app/issues/784
        KclError::new_lexical(crate::errors::KclErrorDetails::new(
            format!("found unknown token '{bad_token}'"),
            vec![SourceRange::new(offset, offset + 1, module_id)],
        ))
    }
}
