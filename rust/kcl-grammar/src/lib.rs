//! Sentence grammars and reference membership recognition for KCL.

use kcl_syntax::lexer::lex;

lalrpop_util::lalrpop_mod!(settings);

/// Returns whether the complete source matches the initial settings grammar.
///
/// This entry point recognizes one settings annotation. The value grammar
/// is intentionally incomplete.
pub fn recognizes_settings(source: &str) -> bool {
    let tokens = lex(source).into_iter().map(|token| {
        let range = token.range();
        (range.start, (token.kind(), token.text()), range.end)
    });
    settings::StartParser::new().parse(tokens).is_ok()
}
