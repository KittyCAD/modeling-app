//! Adapts the `kcl-syntax` (logos) lexer onto the legacy `TokenType` token
//! stream, plus a rich lexical-diagnostic pass. Used under `LexerMode::New`;
//! `LexerMode::Old` runs the winnow `tokeniser`.
//!
//! Three separable pieces:
//! 1. [`syntax_kind_to_token_type`] -- a pure, total, mechanical mapping. Every
//!    recovery kind (`Unknown`, `UnterminatedString`, `UnterminatedBlockComment`)
//!    maps to `TokenType::Unknown`, never `String`/`BlockComment`, so invalid
//!    input can never be silently accepted as trivia by the parser.
//! 2. the rich diagnostic pass in [`lex_with_diagnostics`], which produces
//!    [`LexDiagnostic`]s from the raw `SyntaxKind` stream *before* the mapping
//!    above collapses the recovery kinds and loses the distinction.
//! 3. [`legacy_import_paren_quirk`] -- the winnow tokeniser classified `import`
//!    written directly before `(` as a `Word` (not the `import` keyword). We
//!    replicate it here so the two lexers agree; it is a temporary shim.

use kcl_error::KclErrorDetails;
use kcl_syntax::syntax_kind::SyntaxKind;

use super::Token;
use super::TokenStream;
use super::TokenType;
use crate::ModuleId;
use crate::SourceRange;
use crate::errors::KclError;

/// Classification of a recoverable lexical problem, retained from the rich
/// `SyntaxKind` stream so a good message can be produced before the token stream
/// collapses recovery kinds to `TokenType::Unknown`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum LexErrorKind {
    UnknownToken,
    UnterminatedString,
    UnterminatedBlockComment,
}

/// A single lexical diagnostic over a byte range of the source.
///
/// Deliberately NOT a [`crate::errors::CompilationIssue`]: that type carries a
/// single range and is recategorised to a *syntax* error by `parse_errs_as_err`.
/// Lexical problems stay lexical by converting to `KclError::new_lexical` (see
/// [`LexResult::to_lexical_error`]).
#[derive(Debug, Clone)]
pub(crate) struct LexDiagnostic {
    kind: LexErrorKind,
    /// Offending source text, used to render `found unknown token '<x>'`.
    text: String,
    range: SourceRange,
}

impl LexDiagnostic {
    fn message(&self) -> String {
        match self.kind {
            LexErrorKind::UnknownToken => format!("found unknown token '{}'", self.text),
            LexErrorKind::UnterminatedString => "unterminated string literal".to_owned(),
            LexErrorKind::UnterminatedBlockComment => "unterminated block comment".to_owned(),
        }
    }
}

/// Result of lexing with the new lexer: the (recovery-collapsed) token stream plus
/// every lexical diagnostic found. Callers choose how to surface `issues`: the
/// public parse path folds them into one `KclError::new_lexical` via
/// [`LexResult::to_lexical_error`]; the LSP renders each as a diagnostic while
/// keeping `tokens` for highlighting.
#[derive(Debug)]
pub(crate) struct LexResult {
    pub(crate) tokens: TokenStream,
    pub(crate) issues: Vec<LexDiagnostic>,
}

impl LexResult {
    /// Fold the lexical issues into a single lexical `KclError`, or `None` when
    /// there are none. Matches the legacy public contract: a run of unknown
    /// tokens aggregates into one message with all ranges (mirroring
    /// `parse_tokens`); any other case reports the first issue in source order.
    pub(crate) fn to_lexical_error(&self) -> Option<KclError> {
        let issues = &self.issues;
        let first = issues.first()?;

        if issues.iter().all(|issue| issue.kind == LexErrorKind::UnknownToken) {
            let ranges: Vec<SourceRange> = issues.iter().map(|issue| issue.range).collect();
            let message = if issues.len() == 1 {
                format!("found unknown token '{}'", first.text)
            } else {
                let list = issues
                    .iter()
                    .map(|issue| issue.text.as_str())
                    .collect::<Vec<_>>()
                    .join(", ");
                format!("found unknown tokens [{list}]")
            };
            return Some(KclError::new_lexical(KclErrorDetails::new(message, ranges)));
        }

        Some(KclError::new_lexical(KclErrorDetails::new(
            first.message(),
            vec![first.range],
        )))
    }
}

/// Lex `source` with the `kcl-syntax` lexer, mapping to the legacy token stream
/// and collecting lexical diagnostics. Never fails: recoverable problems appear
/// in `tokens` (as `Unknown`) and in `issues`.
pub(crate) fn lex_with_diagnostics(source: &str, module_id: ModuleId) -> LexResult {
    let lexed = kcl_syntax::lexer::lex(source);

    let mut tokens: Vec<Token> = Vec::with_capacity(lexed.len());
    let mut issues: Vec<LexDiagnostic> = Vec::new();

    for token in lexed.tokens() {
        let kind = token.kind();
        let range = token.range();
        let text = token.text();

        if let Some(error_kind) = recovery_kind(kind) {
            issues.push(LexDiagnostic {
                kind: error_kind,
                text: text.to_owned(),
                range: SourceRange::new(range.start, range.end, module_id),
            });
        }

        tokens.push(Token::from_range(
            range,
            module_id,
            syntax_kind_to_token_type(kind),
            text.to_owned(),
        ));
    }

    legacy_import_paren_quirk(&mut tokens);

    LexResult {
        tokens: TokenStream::new(tokens),
        issues,
    }
}

/// The recovery classification of a kind, if it is one; `None` for normal kinds.
fn recovery_kind(kind: SyntaxKind) -> Option<LexErrorKind> {
    match kind {
        SyntaxKind::Unknown => Some(LexErrorKind::UnknownToken),
        SyntaxKind::UnterminatedString => Some(LexErrorKind::UnterminatedString),
        SyntaxKind::UnterminatedBlockComment => Some(LexErrorKind::UnterminatedBlockComment),
        _ => None,
    }
}

/// TODO: temporary shim -- delete once the parser no longer distinguishes
/// `import(` from the `import` keyword. The winnow tokeniser classified `import`
/// written directly before `(` (no intervening whitespace) as a `Word` rather
/// than the `import` keyword (see `tokeniser::import_keyword`); the parser's item
/// dispatch relies on this, so we replicate it to keep the two lexers in agreement.
fn legacy_import_paren_quirk(tokens: &mut [Token]) {
    for i in 0..tokens.len() {
        if tokens[i].token_type != TokenType::Keyword || tokens[i].value != "import" {
            continue;
        }
        let import_end = tokens[i].end;
        let followed_by_open_paren = tokens
            .get(i + 1)
            .is_some_and(|next| next.token_type == TokenType::Brace && next.value == "(" && next.start == import_end);
        if followed_by_open_paren {
            tokens[i].token_type = TokenType::Word;
        }
    }
}

/// Pure, total mapping from a new-lexer `SyntaxKind` to the legacy `TokenType`.
///
/// `TokenType::Type` and `TokenType::Function` are intentionally never produced
/// here -- the parser assigns those later. Recovery kinds map to `Unknown`.
pub(crate) fn syntax_kind_to_token_type(kind: SyntaxKind) -> TokenType {
    match kind {
        SyntaxKind::Number => TokenType::Number,
        SyntaxKind::Word => TokenType::Word,
        SyntaxKind::GtEq
        | SyntaxKind::LtEq
        | SyntaxKind::EqEq
        | SyntaxKind::FatArrow
        | SyntaxKind::BangEq
        | SyntaxKind::PipeGt
        | SyntaxKind::Star
        | SyntaxKind::Plus
        | SyntaxKind::Minus
        | SyntaxKind::Slash
        | SyntaxKind::Percent
        | SyntaxKind::Eq
        | SyntaxKind::Lt
        | SyntaxKind::Gt
        | SyntaxKind::Backslash
        | SyntaxKind::Caret
        | SyntaxKind::PipePipe
        | SyntaxKind::AmpAmp
        | SyntaxKind::Pipe
        | SyntaxKind::Amp => TokenType::Operator,
        SyntaxKind::String => TokenType::String,
        SyntaxKind::IfKw
        | SyntaxKind::ElseKw
        | SyntaxKind::ForKw
        | SyntaxKind::WhileKw
        | SyntaxKind::ReturnKw
        | SyntaxKind::BreakKw
        | SyntaxKind::ContinueKw
        | SyntaxKind::FnKw
        | SyntaxKind::LetKw
        | SyntaxKind::MutKw
        | SyntaxKind::AsKw
        | SyntaxKind::LoopKw
        | SyntaxKind::TrueKw
        | SyntaxKind::FalseKw
        | SyntaxKind::NilKw
        | SyntaxKind::AndKw
        | SyntaxKind::OrKw
        | SyntaxKind::NotKw
        | SyntaxKind::VarKw
        | SyntaxKind::ConstKw
        | SyntaxKind::ImportKw
        | SyntaxKind::ExportKw
        | SyntaxKind::TypeKw
        | SyntaxKind::InterfaceKw
        | SyntaxKind::NewKw
        | SyntaxKind::SelfKw
        | SyntaxKind::RecordKw
        | SyntaxKind::StructKw
        | SyntaxKind::ObjectKw => TokenType::Keyword,
        SyntaxKind::OpenParen
        | SyntaxKind::CloseParen
        | SyntaxKind::OpenBrace
        | SyntaxKind::CloseBrace
        | SyntaxKind::OpenBracket
        | SyntaxKind::CloseBracket => TokenType::Brace,
        SyntaxKind::Hash => TokenType::Hash,
        SyntaxKind::Bang => TokenType::Bang,
        SyntaxKind::Dollar => TokenType::Dollar,
        SyntaxKind::Whitespace => TokenType::Whitespace,
        SyntaxKind::Comma => TokenType::Comma,
        SyntaxKind::Colon => TokenType::Colon,
        SyntaxKind::DoubleColon => TokenType::DoubleColon,
        SyntaxKind::Period => TokenType::Period,
        SyntaxKind::DoublePeriod => TokenType::DoublePeriod,
        SyntaxKind::DoublePeriodLessThan => TokenType::DoublePeriodLessThan,
        SyntaxKind::LineComment => TokenType::LineComment,
        SyntaxKind::BlockComment => TokenType::BlockComment,
        // Recovery kinds collapse to Unknown so the parser can never treat
        // invalid input as trivia; the rich pass has already recorded a
        // diagnostic with the precise kind.
        SyntaxKind::UnterminatedString | SyntaxKind::UnterminatedBlockComment | SyntaxKind::Unknown => {
            TokenType::Unknown
        }
        SyntaxKind::QuestionMark => TokenType::QuestionMark,
        SyntaxKind::At => TokenType::At,
        SyntaxKind::SemiColon => TokenType::SemiColon,
    }
}
