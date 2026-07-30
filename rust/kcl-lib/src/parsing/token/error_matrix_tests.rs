//! Snapshot tests pinning the lexical-error behavior of both lexers, row by row.
//!
//! For each error-matrix row they record the old lexer's (winnow `tokeniser`)
//! behavior -- including known quirks such as buggy byte ranges on non-ASCII
//! input and the `unexpected EOF while parsing` path -- and the new lexer's
//! (`kcl-syntax` adapter) behavior, so the two can be compared against a frozen
//! baseline.
//!
//! The matrix (exact pinned values live in the per-row `.snap` files; `\u{..}`
//! denotes a non-ASCII char, escaped so this comment stays ASCII):
//!
//! | # | Input | Condition | Old lexer (final) | New lexer (final) |
//! |---|-------|-----------|-------------------|-------------------|
//! | 1 | `~`, `12 ~ 8` | unknown ASCII char | lexes OK, then `found unknown token '~'` at the char | same message and range (match) |
//! | 2 | `"abc` | unterminated string | `lex` Err `found unknown token '"'` @ `[0,1]` | `unterminated string literal` @ `[0,4]` (better) |
//! | 3 | `"` | lone `"` (unterminated) | `lex` Err `found unknown token '"'` @ `[0,1]` | `unterminated string literal` @ `[0,1]` (better) |
//! | 4 | `/* abc` | unterminated block comment | lexes OK, then parser Fatal `Unexpected token: /` @ `[0,1]` | `unterminated block comment` @ `[0,6]` (better) |
//! | 5 | `a\u{A0}b` (NBSP) | non-ASCII whitespace | `lex` Err `found unknown token` @ `[1,2]` (range cuts mid-char) | same message @ `[1,3]` (full-char range) |
//! | 6 | `a\u{1F642}b` (emoji) | unsupported Unicode scalar | `lex` Err `found unknown token` @ `[1,2]` (mid-char) | same message @ `[1,5]` (full-char range) |
//! | 7 | `~ \u{4E9E}` | ASCII unknown before non-ASCII | `lex` Err `found unknown token '~'` @ `[0,1]` | same (match) |
//! | 8 | fuzz EOF inputs (from `parsing/mod.rs`) | unterminated string at EOF | `lex` Err `unexpected EOF while parsing` @ `[10,10]` | `unterminated string literal` at the string (better) |
//!
//! The "Old lexer" column folds the `lex` and parse stages: rows 2, 3, 5, 6, 7,
//! 8 fail in `lex`; row 1 lexes OK and fails later; row 4 lexes OK and the parser
//! chokes on the leftover `/`. The new lexer never fails in `lex` -- it emits
//! recovery tokens plus a lexical diagnostic, which folds into the "New lexer"
//! column.
//!
//! Each matrix row is its own test so a drift points at exactly one row.
//!
//! The old lexer is forced explicitly: `lex` dispatches on `LexerMode`, so without
//! this a developer's `KCL_LEXER=new` could pollute the baseline.

use super::LexerMode;
use super::adapter;
use super::lex;
use crate::ModuleId;
use crate::errors::KclError;
use crate::parsing::parse_str;

/// Capture the old lexer's behavior of both pipeline stages for `source`:
/// - `lex`: whether tokenization itself returns `Ok`/`Err` (rows 5-7 fail here);
/// - `parse`: the final user-facing result from `parse_str` (rows 1-3 fail here,
///   row 4 reaches the parser).
fn characterize_old(source: &str) -> String {
    let _guard = LexerMode::override_for_test(LexerMode::Old);
    let module_id = ModuleId::default();

    let fmt_err = |err: &KclError| {
        format!(
            "Err [{}] {:?} @ {:?}",
            err.error_type(),
            err.message(),
            err.source_ranges()
        )
    };

    let lex_stage = match lex(source, module_id) {
        Ok(stream) => format!("Ok ({} tokens)", stream.iter().count()),
        Err(err) => fmt_err(&err),
    };

    let parse_stage = match parse_str(source, module_id).0 {
        Ok((program, issues)) => {
            let issues = issues
                .iter()
                .map(|i| format!("{:?} {:?} @ {:?}", i.severity, i.message, i.source_range))
                .collect::<Vec<_>>();
            format!("Ok (program: {}, issues: {issues:?})", program.is_some())
        }
        Err(err) => fmt_err(&err),
    };

    format!("source: {source:?}\nlex:   {lex_stage}\nparse: {parse_stage}")
}

#[test]
fn row1_unknown_ascii_tilde() {
    insta::assert_snapshot!(characterize_old("~"));
}

#[test]
fn row1_unknown_ascii_tilde_in_context() {
    insta::assert_snapshot!(characterize_old("12 ~ 8"));
}

#[test]
fn row2_unterminated_string() {
    insta::assert_snapshot!(characterize_old("\"abc"));
}

#[test]
fn row3_lone_double_quote() {
    insta::assert_snapshot!(characterize_old("\""));
}

#[test]
fn row4_unterminated_block_comment() {
    insta::assert_snapshot!(characterize_old("/* abc"));
}

#[test]
fn row5_non_ascii_whitespace_nbsp() {
    insta::assert_snapshot!(characterize_old("a\u{00A0}b"));
}

#[test]
fn row6_unsupported_unicode_scalar_emoji() {
    insta::assert_snapshot!(characterize_old("a\u{1F642}b"));
}

#[test]
fn row7_ascii_unknown_then_non_ascii() {
    insta::assert_snapshot!(characterize_old("~ \u{4E9E}"));
}

// The two exact `crash_eof_*` literals from `crate::parsing` tests
// (parsing/mod.rs:197-198): U+078E is `ge` (Thaana) and U+075D is the second
// Arabic glyph; `\0` are literal NULs.
#[test]
fn row8_eof_ish_crash_input_1() {
    insta::assert_snapshot!(characterize_old("{\"\u{78E}\u{78E}\0\0\0\"\"."));
}

#[test]
fn row8_eof_ish_crash_input_2() {
    insta::assert_snapshot!(characterize_old("(/=e\"\u{616}\u{75D}\"\""));
}

/// Captures the new lexer's (`kcl-syntax` adapter) behavior for the same rows:
/// the token/issue counts and the folded lexical `KclError`, so the new lexer's
/// reality can be checked against the old lexer's baseline. Calls the adapter
/// directly (no global mode override needed).
fn characterize_new(source: &str) -> String {
    let result = adapter::lex_with_diagnostics(source, ModuleId::default());
    let final_line = match result.to_lexical_error() {
        None => "Ok (no lexical issues)".to_owned(),
        Some(err) => format!(
            "Err [{}] {:?} @ {:?}",
            err.error_type(),
            err.message(),
            err.source_ranges()
        ),
    };
    format!(
        "source: {source:?}\ntokens: {}\nissues: {}\nfinal:  {final_line}",
        result.tokens.iter().count(),
        result.issues.len()
    )
}

#[test]
fn row1_unknown_ascii_tilde_new() {
    insta::assert_snapshot!(characterize_new("~"));
}

#[test]
fn row1_unknown_ascii_tilde_in_context_new() {
    insta::assert_snapshot!(characterize_new("12 ~ 8"));
}

#[test]
fn row2_unterminated_string_new() {
    insta::assert_snapshot!(characterize_new("\"abc"));
}

#[test]
fn row3_lone_double_quote_new() {
    insta::assert_snapshot!(characterize_new("\""));
}

#[test]
fn row4_unterminated_block_comment_new() {
    insta::assert_snapshot!(characterize_new("/* abc"));
}

#[test]
fn row5_non_ascii_whitespace_nbsp_new() {
    insta::assert_snapshot!(characterize_new("a\u{00A0}b"));
}

#[test]
fn row6_unsupported_unicode_scalar_emoji_new() {
    insta::assert_snapshot!(characterize_new("a\u{1F642}b"));
}

#[test]
fn row7_ascii_unknown_then_non_ascii_new() {
    insta::assert_snapshot!(characterize_new("~ \u{4E9E}"));
}

#[test]
fn row8_eof_ish_crash_input_1_new() {
    insta::assert_snapshot!(characterize_new("{\"\u{78E}\u{78E}\0\0\0\"\"."));
}

#[test]
fn row8_eof_ish_crash_input_2_new() {
    insta::assert_snapshot!(characterize_new("(/=e\"\u{616}\u{75D}\"\""));
}

/// Verifies the (now-merged) multiline-string fix through the kcl-lib adapter:
/// the legacy tokeniser and the new lexer both tokenize a closed multiline
/// string as a single `String` token with no lexical issues.
#[test]
fn valid_multiline_string_is_one_string_token_in_both_lexers() {
    let source = "\"line one\nline two\"";
    let expected = vec![(super::TokenType::String, 0, source.len())];

    let legacy: Vec<_> = super::lex_legacy(source, ModuleId::default())
        .unwrap()
        .iter()
        .map(|token| (token.token_type, token.start, token.end))
        .collect();
    assert_eq!(
        legacy, expected,
        "legacy should accept a closed multiline string as one String token"
    );

    let new_result = adapter::lex_with_diagnostics(source, ModuleId::default());
    assert!(
        new_result.issues.is_empty(),
        "new lexer should accept a closed multiline string without lexical issues, got {} issue(s)",
        new_result.issues.len()
    );
    let new: Vec<_> = new_result
        .tokens
        .iter()
        .map(|token| (token.token_type, token.start, token.end))
        .collect();
    assert_eq!(
        new, expected,
        "new lexer should tokenize a closed multiline string as one String token"
    );
}

/// The same content on ONE line is a single `String` token in both lexers, so
/// `//` inside quotes is string text (not a comment) for both, and the only
/// source of multiline divergence is the embedded newline.
#[test]
fn single_line_string_containing_comment_text_agrees_across_lexers() {
    let source = "\"// a comment\"";
    let expected = vec![(super::TokenType::String, 0, source.len())];

    let legacy: Vec<_> = super::lex_legacy(source, ModuleId::default())
        .unwrap()
        .iter()
        .map(|token| (token.token_type, token.start, token.end))
        .collect();

    let new_result = adapter::lex_with_diagnostics(source, ModuleId::default());
    let new: Vec<_> = new_result
        .tokens
        .iter()
        .map(|token| (token.token_type, token.start, token.end))
        .collect();

    assert_eq!(legacy, expected, "legacy: single-line string is one String token");
    assert_eq!(new, expected, "new: single-line string is one String token");
    assert!(
        new_result.issues.is_empty(),
        "new: no lexical issues for a closed single-line string"
    );
    assert_eq!(legacy, new, "both lexers agree on the single-line case");
}
