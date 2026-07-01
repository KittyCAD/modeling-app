//! Logos-based lexer for KCL source.

use std::ops::Range;

use logos::Logos;

use crate::syntax_kind::SyntaxKind;

/// Lossless tokenization of a KCL source string.
///
/// `LexedSource` keeps the original source and the full token sequence,
/// including whitespace, comments, and recovery tokens. Lexical errors are
/// represented as token kinds such as [`SyntaxKind::Unknown`],
/// [`SyntaxKind::UnterminatedString`], and
/// [`SyntaxKind::UnterminatedBlockComment`].
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct LexedSource<'a> {
    source: &'a str,
    tokens: Vec<Token<'a>>,
}

impl<'a> LexedSource<'a> {
    /// Returns the original source string.
    pub fn as_str(&self) -> &'a str {
        self.source
    }

    /// Returns all tokens, including trivia and recovery tokens.
    pub fn tokens(&self) -> &[Token<'a>] {
        &self.tokens
    }

    /// Iterates over all tokens by reference.
    pub fn iter(&self) -> impl Iterator<Item = &Token<'a>> {
        self.tokens.iter()
    }

    /// Consumes the lexed source and returns its token vector.
    pub fn into_tokens(self) -> Vec<Token<'a>> {
        self.tokens
    }

    /// Returns the number of tokens.
    pub fn len(&self) -> usize {
        self.tokens.len()
    }

    /// Returns true when the source produced no tokens.
    pub fn is_empty(&self) -> bool {
        self.tokens.is_empty()
    }
}

impl<'a> IntoIterator for LexedSource<'a> {
    type IntoIter = std::vec::IntoIter<Token<'a>>;
    type Item = Token<'a>;

    fn into_iter(self) -> Self::IntoIter {
        self.tokens.into_iter()
    }
}

impl<'a, 's> IntoIterator for &'s LexedSource<'a> {
    type IntoIter = std::slice::Iter<'s, Token<'a>>;
    type Item = &'s Token<'a>;

    fn into_iter(self) -> Self::IntoIter {
        self.tokens.iter()
    }
}

/// A single KCL token.
///
/// Token text is borrowed from the original source. Ranges are byte offsets into
/// that source string.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Token<'a> {
    kind: SyntaxKind,
    text: &'a str,
    range: Range<usize>,
}

impl<'a> Token<'a> {
    /// Returns this token's syntax kind.
    pub fn kind(&self) -> SyntaxKind {
        self.kind
    }

    /// Returns the exact source text for this token.
    pub fn text(&self) -> &'a str {
        self.text
    }

    /// Returns this token's byte range in the original source string.
    pub fn range(&self) -> Range<usize> {
        self.range.clone()
    }
}

#[derive(Clone, Copy, Debug, Logos, PartialEq)]
enum RawTokenKind {
    #[regex(r"[ \t\n\r]+")]
    Whitespace,
    // A closed string may span newlines (KCL supports multiline strings), matching
    // the legacy tokeniser: content is any char except the quote or backslash, or a
    // backslash-escape of any char including a newline. Note the UnterminatedString
    // patterns below deliberately still stop at a line boundary for recovery.
    #[regex(r#""([^"\\]|\\[\s\S])*""#)]
    #[regex(r#"'([^'\\]|\\[\s\S])*'"#)]
    String,
    #[regex(r#""([^"\\\n\r]|\\[^\n\r])*"#, unterminated_string)]
    #[regex(r#"'([^'\\\n\r]|\\[^\n\r])*"#, unterminated_string)]
    UnterminatedString,
    #[regex(r"//[^\n\r]*", allow_greedy = true)]
    LineComment,
    #[regex(r"/\*", block_comment)]
    BlockComment,
    #[regex(r"[0-9]+(\.[0-9]+)?_?(mm|cm|m|inch|in|ft|yd|deg|rad|\?)?")]
    #[regex(r"\.[0-9]+_?(mm|cm|m|inch|in|ft|yd|deg|rad|\?)?")]
    Number,
    #[token("..<")]
    DoublePeriodLessThan,
    #[token("..")]
    DoublePeriod,
    #[token("::")]
    DoubleColon,
    #[regex(r"[\p{Alphabetic}_][\p{Alphabetic}0-9_]*")]
    Word,
    #[token(">=")]
    GtEq,
    #[token("<=")]
    LtEq,
    #[token("==")]
    EqEq,
    #[token("=>")]
    FatArrow,
    #[token("!=")]
    BangEq,
    #[token("|>")]
    PipeGt,
    #[token("*")]
    Star,
    #[token("+")]
    Plus,
    #[token("-")]
    Minus,
    #[token("/")]
    Slash,
    #[token("%")]
    Percent,
    #[token("=")]
    Eq,
    #[token("<")]
    Lt,
    #[token(">")]
    Gt,
    #[token("\\")]
    Backslash,
    #[token("^")]
    Caret,
    #[token("||")]
    PipePipe,
    #[token("&&")]
    AmpAmp,
    #[token("|")]
    Pipe,
    #[token("&")]
    Amp,
    #[token("(")]
    OpenParen,
    #[token(")")]
    CloseParen,
    #[token("{")]
    OpenBrace,
    #[token("}")]
    CloseBrace,
    #[token("[")]
    OpenBracket,
    #[token("]")]
    CloseBracket,
    #[token("#")]
    Hash,
    #[token("!")]
    Bang,
    #[token("$")]
    Dollar,
    #[token(",")]
    Comma,
    #[token(":")]
    Colon,
    #[token(".")]
    Period,
    #[token("?")]
    QuestionMark,
    #[token("@")]
    At,
    #[token(";")]
    SemiColon,
}

/// Lexes KCL source into a lossless token sequence.
///
/// This function does not return lexical errors separately. Invalid or
/// recoverable input is preserved in the token stream with recovery token kinds.
pub fn lex(source: &str) -> LexedSource<'_> {
    let mut lexer = RawTokenKind::lexer(source);
    let mut tokens = Vec::new();

    while let Some(raw_kind) = lexer.next() {
        let range = lexer.span();
        let text = &source[range.clone()];
        let kind = match raw_kind {
            Ok(RawTokenKind::Whitespace) => SyntaxKind::Whitespace,
            Ok(RawTokenKind::String) => SyntaxKind::String,
            Ok(RawTokenKind::UnterminatedString) => SyntaxKind::UnterminatedString,
            Ok(RawTokenKind::LineComment) => SyntaxKind::LineComment,
            Ok(RawTokenKind::BlockComment) if text.ends_with("*/") => SyntaxKind::BlockComment,
            Ok(RawTokenKind::BlockComment) => SyntaxKind::UnterminatedBlockComment,
            Ok(RawTokenKind::Number) => SyntaxKind::Number,
            Ok(RawTokenKind::DoublePeriodLessThan) => SyntaxKind::DoublePeriodLessThan,
            Ok(RawTokenKind::DoublePeriod) => SyntaxKind::DoublePeriod,
            Ok(RawTokenKind::DoubleColon) => SyntaxKind::DoubleColon,
            Ok(RawTokenKind::Word) => keyword_or_word(text),
            Ok(RawTokenKind::GtEq) => SyntaxKind::GtEq,
            Ok(RawTokenKind::LtEq) => SyntaxKind::LtEq,
            Ok(RawTokenKind::EqEq) => SyntaxKind::EqEq,
            Ok(RawTokenKind::FatArrow) => SyntaxKind::FatArrow,
            Ok(RawTokenKind::BangEq) => SyntaxKind::BangEq,
            Ok(RawTokenKind::PipeGt) => SyntaxKind::PipeGt,
            Ok(RawTokenKind::Star) => SyntaxKind::Star,
            Ok(RawTokenKind::Plus) => SyntaxKind::Plus,
            Ok(RawTokenKind::Minus) => SyntaxKind::Minus,
            Ok(RawTokenKind::Slash) => SyntaxKind::Slash,
            Ok(RawTokenKind::Percent) => SyntaxKind::Percent,
            Ok(RawTokenKind::Eq) => SyntaxKind::Eq,
            Ok(RawTokenKind::Lt) => SyntaxKind::Lt,
            Ok(RawTokenKind::Gt) => SyntaxKind::Gt,
            Ok(RawTokenKind::Backslash) => SyntaxKind::Backslash,
            Ok(RawTokenKind::Caret) => SyntaxKind::Caret,
            Ok(RawTokenKind::PipePipe) => SyntaxKind::PipePipe,
            Ok(RawTokenKind::AmpAmp) => SyntaxKind::AmpAmp,
            Ok(RawTokenKind::Pipe) => SyntaxKind::Pipe,
            Ok(RawTokenKind::Amp) => SyntaxKind::Amp,
            Ok(RawTokenKind::OpenParen) => SyntaxKind::OpenParen,
            Ok(RawTokenKind::CloseParen) => SyntaxKind::CloseParen,
            Ok(RawTokenKind::OpenBrace) => SyntaxKind::OpenBrace,
            Ok(RawTokenKind::CloseBrace) => SyntaxKind::CloseBrace,
            Ok(RawTokenKind::OpenBracket) => SyntaxKind::OpenBracket,
            Ok(RawTokenKind::CloseBracket) => SyntaxKind::CloseBracket,
            Ok(RawTokenKind::Hash) => SyntaxKind::Hash,
            Ok(RawTokenKind::Bang) => SyntaxKind::Bang,
            Ok(RawTokenKind::Dollar) => SyntaxKind::Dollar,
            Ok(RawTokenKind::Comma) => SyntaxKind::Comma,
            Ok(RawTokenKind::Colon) => SyntaxKind::Colon,
            Ok(RawTokenKind::Period) => SyntaxKind::Period,
            Ok(RawTokenKind::QuestionMark) => SyntaxKind::QuestionMark,
            Ok(RawTokenKind::At) => SyntaxKind::At,
            Ok(RawTokenKind::SemiColon) => SyntaxKind::SemiColon,
            Err(()) => SyntaxKind::Unknown,
        };
        tokens.push(Token { kind, text, range });
    }

    LexedSource { source, tokens }
}

fn keyword_or_word(text: &str) -> SyntaxKind {
    match text {
        "if" => SyntaxKind::IfKw,
        "else" => SyntaxKind::ElseKw,
        "for" => SyntaxKind::ForKw,
        "while" => SyntaxKind::WhileKw,
        "return" => SyntaxKind::ReturnKw,
        "break" => SyntaxKind::BreakKw,
        "continue" => SyntaxKind::ContinueKw,
        "fn" => SyntaxKind::FnKw,
        "let" => SyntaxKind::LetKw,
        "mut" => SyntaxKind::MutKw,
        "as" => SyntaxKind::AsKw,
        "loop" => SyntaxKind::LoopKw,
        "true" => SyntaxKind::TrueKw,
        "false" => SyntaxKind::FalseKw,
        "nil" => SyntaxKind::NilKw,
        "and" => SyntaxKind::AndKw,
        "or" => SyntaxKind::OrKw,
        "not" => SyntaxKind::NotKw,
        "var" => SyntaxKind::VarKw,
        "const" => SyntaxKind::ConstKw,
        "import" => SyntaxKind::ImportKw,
        "export" => SyntaxKind::ExportKw,
        "type" => SyntaxKind::TypeKw,
        "interface" => SyntaxKind::InterfaceKw,
        "new" => SyntaxKind::NewKw,
        "self" => SyntaxKind::SelfKw,
        "record" => SyntaxKind::RecordKw,
        "struct" => SyntaxKind::StructKw,
        "object" => SyntaxKind::ObjectKw,
        _ => SyntaxKind::Word,
    }
}

fn block_comment(lexer: &mut logos::Lexer<'_, RawTokenKind>) {
    if let Some(end) = lexer.remainder().find("*/") {
        lexer.bump(end + 2);
    } else {
        lexer.bump(lexer.remainder().len());
    }
}

fn unterminated_string(lexer: &mut logos::Lexer<'_, RawTokenKind>) {
    let until_line_end = lexer
        .remainder()
        .find(['\n', '\r'])
        .unwrap_or_else(|| lexer.remainder().len());
    lexer.bump(until_line_end);
}
