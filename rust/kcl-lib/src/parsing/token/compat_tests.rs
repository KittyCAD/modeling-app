use std::ops::Range;
use std::path::Path;

use proptest::prelude::*;

use super::TokenType;
use crate::ModuleId;

#[test]
fn representative_sources_match_old_scanner() {
    for source in [
        "const part001 = startSketchOn(XY)",
        "import foo",
        "import(3)",
        "import",
        "import\tfoo",
        "import\nfoo",
        "import.foo",
        "import::foo",
        "import/*comment*/foo",
        "const myArray = [0..10]",
        "const myArray = [0..<10]",
        "1_ 1_mm 1m 1inch .5 0.25rad",
        "1?foo",
        "1_foo",
        "1_mmfoo",
        "1.2.3",
        "1toot",
        "1..2",
        ".foo",
        "...",
        ".1",
        "\"with escaped \\\" quote\" 'with escaped \\\' quote'",
        r#""a\q""#,
        concat!("\"a\\", "\n", "\""),
        "\"unterminated",
        "'unterminated",
        "\"a",
        "'a",
        "\"",
        "'",
        "// this is a line comment\n/* this is a block comment */",
        "/* unterminated",
        "# ! $ ? @ ; :: : . , { } ( ) [ ]",
        ">= <= == => != |> * + - / % = < > \\ ^ || && | &",
        "12 ~ 8",
        "a\u{00A0}b",
        "a\u{1680}b",
        "a\u{2003}b",
        "a\u{3000}b",
        "a🙂b",
        "a\u{200B}b",
        "a∴b",
        "a©b",
        "亞當 = 1",
        "亞當~ = 1",
    ] {
        assert_matches_old_scanner(source);
    }
}

#[test]
fn fixture_kcl_inputs_match_old_scanner() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests");
    for entry in walkdir::WalkDir::new(root).into_iter().filter_map(Result::ok) {
        let path = entry.path();
        if !path.is_file() || path.extension().is_none_or(|extension| extension != "kcl") {
            continue;
        }

        let source = std::fs::read_to_string(path).unwrap_or_else(|err| {
            panic!("failed to read fixture {}: {err}", path.display());
        });
        assert_matches_old_scanner(&source);
    }
}

proptest! {
    #![proptest_config(ProptestConfig {
        failure_persistence: None,
        ..ProptestConfig::default()
    })]

    #[test]
    fn generated_sources_match_old_scanner(source in kclish_source()) {
        assert_matches_old_scanner(&source);
    }
}

fn assert_matches_old_scanner(source: &str) {
    let new_tokens = new_tokens(source);
    match old_tokens(source) {
        Ok(_) if has_recovery_token(&new_tokens) => {
            let reconstructed = new_tokens.iter().map(|(_, text, _)| text.as_str()).collect::<String>();
            assert_eq!(
                reconstructed, source,
                "new scanner should preserve text when intentionally recovering from lexical error:\n{source}"
            );
        }
        Ok(old_tokens) if has_import_policy_divergence(&old_tokens, &new_tokens) => {
            let reconstructed = new_tokens.iter().map(|(_, text, _)| text.as_str()).collect::<String>();
            assert_eq!(
                reconstructed, source,
                "new scanner should preserve text when intentionally classifying import by text:\n{source}"
            );
            assert_ne!(
                old_tokens, new_tokens,
                "import policy case should be an intentional old scanner divergence:\n{source}"
            );
        }
        Ok(old_tokens) => assert_eq!(old_tokens, new_tokens, "source:\n{source}"),
        Err(old_error) => {
            let reconstructed = new_tokens.iter().map(|(_, text, _)| text.as_str()).collect::<String>();
            assert_eq!(
                reconstructed, source,
                "new scanner should preserve text when old scanner rejects source:\n{source}\nold error:\n{old_error:?}"
            );
        }
    }
}

fn has_import_policy_divergence(
    old_tokens: &[(TokenType, String, Range<usize>)],
    new_tokens: &[(TokenType, String, Range<usize>)],
) -> bool {
    if old_tokens.len() != new_tokens.len() {
        return false;
    }

    let mut saw_import_difference = false;
    for (old, new) in old_tokens.iter().zip(new_tokens) {
        if old == new {
            continue;
        }

        if old.0 == TokenType::Word
            && new.0 == TokenType::Keyword
            && old.1 == "import"
            && new.1 == "import"
            && old.2 == new.2
        {
            saw_import_difference = true;
            continue;
        }

        return false;
    }

    saw_import_difference
}

fn has_recovery_token(tokens: &[(TokenType, String, Range<usize>)]) -> bool {
    tokens
        .iter()
        .any(|(_, text, _)| text.starts_with("/*") && !text.ends_with("*/") || is_unterminated_string_text(text))
}

fn is_unterminated_string_text(text: &str) -> bool {
    let Some(quote) = text.chars().next().filter(|quote| *quote == '"' || *quote == '\'') else {
        return false;
    };
    text.len() == 1 || !text.ends_with(quote)
}

fn old_tokens(source: &str) -> Result<Vec<(TokenType, String, Range<usize>)>, crate::errors::KclError> {
    super::lex(source, ModuleId::default()).map(|tokens| {
        tokens
            .tokens
            .into_iter()
            .map(|token| (token.token_type, token.value, token.start..token.end))
            .collect()
    })
}

fn new_tokens(source: &str) -> Vec<(TokenType, String, Range<usize>)> {
    kcl_syntax::lexer::lex(source)
        .into_iter()
        .map(|token| (old_token_type(token.kind()), token.text().to_owned(), token.range()))
        .collect()
}

fn old_token_type(kind: kcl_syntax::syntax_kind::SyntaxKind) -> TokenType {
    match kind {
        kcl_syntax::syntax_kind::SyntaxKind::Number => TokenType::Number,
        kcl_syntax::syntax_kind::SyntaxKind::Word => TokenType::Word,
        kcl_syntax::syntax_kind::SyntaxKind::GtEq
        | kcl_syntax::syntax_kind::SyntaxKind::LtEq
        | kcl_syntax::syntax_kind::SyntaxKind::EqEq
        | kcl_syntax::syntax_kind::SyntaxKind::FatArrow
        | kcl_syntax::syntax_kind::SyntaxKind::BangEq
        | kcl_syntax::syntax_kind::SyntaxKind::PipeGt
        | kcl_syntax::syntax_kind::SyntaxKind::Star
        | kcl_syntax::syntax_kind::SyntaxKind::Plus
        | kcl_syntax::syntax_kind::SyntaxKind::Minus
        | kcl_syntax::syntax_kind::SyntaxKind::Slash
        | kcl_syntax::syntax_kind::SyntaxKind::Percent
        | kcl_syntax::syntax_kind::SyntaxKind::Eq
        | kcl_syntax::syntax_kind::SyntaxKind::Lt
        | kcl_syntax::syntax_kind::SyntaxKind::Gt
        | kcl_syntax::syntax_kind::SyntaxKind::Backslash
        | kcl_syntax::syntax_kind::SyntaxKind::Caret
        | kcl_syntax::syntax_kind::SyntaxKind::PipePipe
        | kcl_syntax::syntax_kind::SyntaxKind::AmpAmp
        | kcl_syntax::syntax_kind::SyntaxKind::Pipe
        | kcl_syntax::syntax_kind::SyntaxKind::Amp => TokenType::Operator,
        kcl_syntax::syntax_kind::SyntaxKind::String => TokenType::String,
        kcl_syntax::syntax_kind::SyntaxKind::UnterminatedString => TokenType::Unknown,
        kcl_syntax::syntax_kind::SyntaxKind::IfKw
        | kcl_syntax::syntax_kind::SyntaxKind::ElseKw
        | kcl_syntax::syntax_kind::SyntaxKind::ForKw
        | kcl_syntax::syntax_kind::SyntaxKind::WhileKw
        | kcl_syntax::syntax_kind::SyntaxKind::ReturnKw
        | kcl_syntax::syntax_kind::SyntaxKind::BreakKw
        | kcl_syntax::syntax_kind::SyntaxKind::ContinueKw
        | kcl_syntax::syntax_kind::SyntaxKind::FnKw
        | kcl_syntax::syntax_kind::SyntaxKind::LetKw
        | kcl_syntax::syntax_kind::SyntaxKind::MutKw
        | kcl_syntax::syntax_kind::SyntaxKind::AsKw
        | kcl_syntax::syntax_kind::SyntaxKind::LoopKw
        | kcl_syntax::syntax_kind::SyntaxKind::TrueKw
        | kcl_syntax::syntax_kind::SyntaxKind::FalseKw
        | kcl_syntax::syntax_kind::SyntaxKind::NilKw
        | kcl_syntax::syntax_kind::SyntaxKind::AndKw
        | kcl_syntax::syntax_kind::SyntaxKind::OrKw
        | kcl_syntax::syntax_kind::SyntaxKind::NotKw
        | kcl_syntax::syntax_kind::SyntaxKind::VarKw
        | kcl_syntax::syntax_kind::SyntaxKind::ConstKw
        | kcl_syntax::syntax_kind::SyntaxKind::ImportKw
        | kcl_syntax::syntax_kind::SyntaxKind::ExportKw
        | kcl_syntax::syntax_kind::SyntaxKind::TypeKw
        | kcl_syntax::syntax_kind::SyntaxKind::InterfaceKw
        | kcl_syntax::syntax_kind::SyntaxKind::NewKw
        | kcl_syntax::syntax_kind::SyntaxKind::SelfKw
        | kcl_syntax::syntax_kind::SyntaxKind::RecordKw
        | kcl_syntax::syntax_kind::SyntaxKind::StructKw
        | kcl_syntax::syntax_kind::SyntaxKind::ObjectKw => TokenType::Keyword,
        kcl_syntax::syntax_kind::SyntaxKind::OpenParen
        | kcl_syntax::syntax_kind::SyntaxKind::CloseParen
        | kcl_syntax::syntax_kind::SyntaxKind::OpenBrace
        | kcl_syntax::syntax_kind::SyntaxKind::CloseBrace
        | kcl_syntax::syntax_kind::SyntaxKind::OpenBracket
        | kcl_syntax::syntax_kind::SyntaxKind::CloseBracket => TokenType::Brace,
        kcl_syntax::syntax_kind::SyntaxKind::Hash => TokenType::Hash,
        kcl_syntax::syntax_kind::SyntaxKind::Bang => TokenType::Bang,
        kcl_syntax::syntax_kind::SyntaxKind::Dollar => TokenType::Dollar,
        kcl_syntax::syntax_kind::SyntaxKind::Whitespace => TokenType::Whitespace,
        kcl_syntax::syntax_kind::SyntaxKind::Comma => TokenType::Comma,
        kcl_syntax::syntax_kind::SyntaxKind::Colon => TokenType::Colon,
        kcl_syntax::syntax_kind::SyntaxKind::DoubleColon => TokenType::DoubleColon,
        kcl_syntax::syntax_kind::SyntaxKind::Period => TokenType::Period,
        kcl_syntax::syntax_kind::SyntaxKind::DoublePeriod => TokenType::DoublePeriod,
        kcl_syntax::syntax_kind::SyntaxKind::DoublePeriodLessThan => TokenType::DoublePeriodLessThan,
        kcl_syntax::syntax_kind::SyntaxKind::LineComment => TokenType::LineComment,
        kcl_syntax::syntax_kind::SyntaxKind::BlockComment => TokenType::BlockComment,
        kcl_syntax::syntax_kind::SyntaxKind::UnterminatedBlockComment => TokenType::BlockComment,
        kcl_syntax::syntax_kind::SyntaxKind::Unknown => TokenType::Unknown,
        kcl_syntax::syntax_kind::SyntaxKind::QuestionMark => TokenType::QuestionMark,
        kcl_syntax::syntax_kind::SyntaxKind::At => TokenType::At,
        kcl_syntax::syntax_kind::SyntaxKind::SemiColon => TokenType::SemiColon,
    }
}

fn kclish_source() -> impl Strategy<Value = String> {
    prop::collection::vec(kclish_piece(), 0..128).prop_map(|pieces| pieces.concat())
}

fn kclish_piece() -> impl Strategy<Value = String> {
    prop_oneof![
        keyword().prop_map(str::to_owned),
        word(),
        number(),
        string_literal(),
        comment(),
        whitespace(),
        operator().prop_map(str::to_owned),
        punctuation().prop_map(str::to_owned),
        unknown_ascii().prop_map(str::to_owned),
    ]
}

fn keyword() -> impl Strategy<Value = &'static str> {
    prop::sample::select(&[
        "if",
        "else",
        "for",
        "while",
        "return",
        "break",
        "continue",
        "fn",
        "let",
        "mut",
        "as",
        "loop",
        "true",
        "false",
        "nil",
        "and",
        "or",
        "not",
        "var",
        "const",
        "import",
        "export",
        "type",
        "interface",
        "new",
        "self",
        "record",
        "struct",
        "object",
    ])
}

fn word() -> impl Strategy<Value = String> {
    "[A-Za-z_][A-Za-z0-9_]{0,16}"
}

fn number() -> impl Strategy<Value = String> {
    (
        prop_oneof!["[0-9]{1,8}", "[0-9]{1,8}\\.[0-9]{1,8}", "\\.[0-9]{1,8}"],
        prop::option::of(prop_oneof![
            Just("_"),
            Just("mm"),
            Just("cm"),
            Just("m"),
            Just("inch"),
            Just("in"),
            Just("ft"),
            Just("yd"),
            Just("deg"),
            Just("rad"),
            Just("?"),
        ]),
    )
        .prop_map(|(number, suffix)| format!("{number}{}", suffix.unwrap_or_default()))
}

fn string_literal() -> impl Strategy<Value = String> {
    prop_oneof![
        "[A-Za-z0-9 _-]{0,24}".prop_map(|inner| format!("\"{inner}\"")),
        "[A-Za-z0-9 _-]{0,24}".prop_map(|inner| format!("'{inner}'")),
    ]
}

fn comment() -> impl Strategy<Value = String> {
    prop_oneof![
        "[A-Za-z0-9 _/-]{0,32}".prop_map(|inner| format!("//{inner}")),
        "[A-Za-z0-9 _/-]{0,32}".prop_map(|inner| format!("/*{inner}*/")),
    ]
}

fn whitespace() -> impl Strategy<Value = String> {
    "[ \\t\\n\\r]{1,8}"
}

fn operator() -> impl Strategy<Value = &'static str> {
    prop::sample::select(&[
        ">=", "<=", "==", "=>", "!=", "|>", "*", "+", "-", "/", "%", "=", "<", ">", "\\", "^", "||", "&&", "|", "&",
    ])
}

fn punctuation() -> impl Strategy<Value = &'static str> {
    prop::sample::select(&[
        "{", "}", "(", ")", "[", "]", ",", "?", "@", ";", "::", ":", "..<", "..", ".", "#", "$", "!",
    ])
}

fn unknown_ascii() -> impl Strategy<Value = &'static str> {
    prop::sample::select(&["~", "`"])
}
