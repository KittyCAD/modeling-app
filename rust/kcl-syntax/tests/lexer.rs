use std::ops::Range;

use kcl_syntax::syntax_kind::SyntaxKind;
use proptest::prelude::*;

#[test]
fn lexed_source_exposes_original_source_and_token_slice() {
    let empty = kcl_syntax::lexer::lex("");

    assert_eq!(empty.as_str(), "");
    assert_eq!(empty.len(), 0);
    assert!(empty.is_empty());
    assert!(empty.tokens().is_empty());
    assert!(empty.into_tokens().is_empty());

    let lexed = kcl_syntax::lexer::lex("x = 1");

    assert_eq!(lexed.as_str(), "x = 1");
    assert_eq!(lexed.len(), 5);
    assert_eq!(lexed.len(), lexed.tokens().len());
    assert!(!lexed.is_empty());
    assert_eq!(lexed.tokens()[0].kind(), SyntaxKind::Word);
    assert_eq!(lexed.tokens()[0].text(), "x");
}

#[test]
fn lexed_source_supports_borrowed_and_owned_iteration() {
    let lexed = kcl_syntax::lexer::lex("x = 1");

    let borrowed_text = lexed.iter().map(|token| token.text()).collect::<String>();
    assert_eq!(borrowed_text, lexed.as_str());

    let borrowed_text = (&lexed).into_iter().map(|token| token.text()).collect::<String>();
    assert_eq!(borrowed_text, lexed.as_str());

    let owned_text = lexed.clone().into_iter().map(|token| token.text()).collect::<String>();
    assert_eq!(owned_text, lexed.as_str());

    let tokens = lexed.clone().into_tokens();
    assert_eq!(tokens.len(), lexed.len());
    assert_eq!(
        tokens.iter().map(|token| token.text()).collect::<String>(),
        lexed.as_str()
    );
}

#[test]
fn token_ranges_are_byte_ranges() {
    let lexed = kcl_syntax::lexer::lex("亞 = 🙂");
    let tokens = lexed.tokens();

    assert_eq!(tokens.len(), 5);
    assert_eq!(tokens[0].kind(), SyntaxKind::Word);
    assert_eq!(tokens[0].text(), "亞");
    assert_eq!(tokens[0].range(), 0..3);
    assert_eq!(tokens[1].range(), 3..4);
    assert_eq!(tokens[2].range(), 4..5);
    assert_eq!(tokens[3].range(), 5..6);
    assert_eq!(tokens[4].kind(), SyntaxKind::Unknown);
    assert_eq!(tokens[4].text(), "🙂");
    assert_eq!(tokens[4].range(), 6..10);
}

#[test]
fn lexes_multiline_strings() {
    // A closed string may span raw newlines; the whole thing is one String token,
    // matching the legacy lexer (KCL supports multiline strings).
    assert_tokens(
        "\"line one\nline two\"",
        &[(SyntaxKind::String, "\"line one\nline two\"", 0..19)],
    );
    assert_tokens("'a\nb'", &[(SyntaxKind::String, "'a\nb'", 0..5)]);
    // An escaped newline inside a closed string is part of the string.
    assert_tokens("\"a\\\nb\"", &[(SyntaxKind::String, "\"a\\\nb\"", 0..6)]);
}

#[test]
fn recovery_tokens_are_part_of_the_public_token_stream() {
    assert_tokens(
        "\"abc\n/*x",
        &[
            (SyntaxKind::UnterminatedString, "\"abc", 0..4),
            (SyntaxKind::Whitespace, "\n", 4..5),
            (SyntaxKind::UnterminatedBlockComment, "/*x", 5..8),
        ],
    );
}

#[test]
fn lexes_basic_declaration() {
    assert_tokens(
        "const part001 = startSketchOn(XY)",
        &[
            (SyntaxKind::ConstKw, "const", 0..5),
            (SyntaxKind::Whitespace, " ", 5..6),
            (SyntaxKind::Word, "part001", 6..13),
            (SyntaxKind::Whitespace, " ", 13..14),
            (SyntaxKind::Eq, "=", 14..15),
            (SyntaxKind::Whitespace, " ", 15..16),
            (SyntaxKind::Word, "startSketchOn", 16..29),
            (SyntaxKind::OpenParen, "(", 29..30),
            (SyntaxKind::Word, "XY", 30..32),
            (SyntaxKind::CloseParen, ")", 32..33),
        ],
    );
}

#[test]
fn lexes_each_operator_as_a_specific_kind() {
    assert_tokens(
        ">= <= == => != |> * + - / % = < > \\ ^ || && | &",
        &[
            (SyntaxKind::GtEq, ">=", 0..2),
            (SyntaxKind::Whitespace, " ", 2..3),
            (SyntaxKind::LtEq, "<=", 3..5),
            (SyntaxKind::Whitespace, " ", 5..6),
            (SyntaxKind::EqEq, "==", 6..8),
            (SyntaxKind::Whitespace, " ", 8..9),
            (SyntaxKind::FatArrow, "=>", 9..11),
            (SyntaxKind::Whitespace, " ", 11..12),
            (SyntaxKind::BangEq, "!=", 12..14),
            (SyntaxKind::Whitespace, " ", 14..15),
            (SyntaxKind::PipeGt, "|>", 15..17),
            (SyntaxKind::Whitespace, " ", 17..18),
            (SyntaxKind::Star, "*", 18..19),
            (SyntaxKind::Whitespace, " ", 19..20),
            (SyntaxKind::Plus, "+", 20..21),
            (SyntaxKind::Whitespace, " ", 21..22),
            (SyntaxKind::Minus, "-", 22..23),
            (SyntaxKind::Whitespace, " ", 23..24),
            (SyntaxKind::Slash, "/", 24..25),
            (SyntaxKind::Whitespace, " ", 25..26),
            (SyntaxKind::Percent, "%", 26..27),
            (SyntaxKind::Whitespace, " ", 27..28),
            (SyntaxKind::Eq, "=", 28..29),
            (SyntaxKind::Whitespace, " ", 29..30),
            (SyntaxKind::Lt, "<", 30..31),
            (SyntaxKind::Whitespace, " ", 31..32),
            (SyntaxKind::Gt, ">", 32..33),
            (SyntaxKind::Whitespace, " ", 33..34),
            (SyntaxKind::Backslash, "\\", 34..35),
            (SyntaxKind::Whitespace, " ", 35..36),
            (SyntaxKind::Caret, "^", 36..37),
            (SyntaxKind::Whitespace, " ", 37..38),
            (SyntaxKind::PipePipe, "||", 38..40),
            (SyntaxKind::Whitespace, " ", 40..41),
            (SyntaxKind::AmpAmp, "&&", 41..43),
            (SyntaxKind::Whitespace, " ", 43..44),
            (SyntaxKind::Pipe, "|", 44..45),
            (SyntaxKind::Whitespace, " ", 45..46),
            (SyntaxKind::Amp, "&", 46..47),
        ],
    );
}

#[test]
fn lexes_each_keyword_as_a_specific_kind() {
    assert_tokens(
        "if else for while return break continue fn let mut as loop true false nil and or not var const import export type interface new self record struct object",
        &[
            (SyntaxKind::IfKw, "if", 0..2),
            (SyntaxKind::Whitespace, " ", 2..3),
            (SyntaxKind::ElseKw, "else", 3..7),
            (SyntaxKind::Whitespace, " ", 7..8),
            (SyntaxKind::ForKw, "for", 8..11),
            (SyntaxKind::Whitespace, " ", 11..12),
            (SyntaxKind::WhileKw, "while", 12..17),
            (SyntaxKind::Whitespace, " ", 17..18),
            (SyntaxKind::ReturnKw, "return", 18..24),
            (SyntaxKind::Whitespace, " ", 24..25),
            (SyntaxKind::BreakKw, "break", 25..30),
            (SyntaxKind::Whitespace, " ", 30..31),
            (SyntaxKind::ContinueKw, "continue", 31..39),
            (SyntaxKind::Whitespace, " ", 39..40),
            (SyntaxKind::FnKw, "fn", 40..42),
            (SyntaxKind::Whitespace, " ", 42..43),
            (SyntaxKind::LetKw, "let", 43..46),
            (SyntaxKind::Whitespace, " ", 46..47),
            (SyntaxKind::MutKw, "mut", 47..50),
            (SyntaxKind::Whitespace, " ", 50..51),
            (SyntaxKind::AsKw, "as", 51..53),
            (SyntaxKind::Whitespace, " ", 53..54),
            (SyntaxKind::LoopKw, "loop", 54..58),
            (SyntaxKind::Whitespace, " ", 58..59),
            (SyntaxKind::TrueKw, "true", 59..63),
            (SyntaxKind::Whitespace, " ", 63..64),
            (SyntaxKind::FalseKw, "false", 64..69),
            (SyntaxKind::Whitespace, " ", 69..70),
            (SyntaxKind::NilKw, "nil", 70..73),
            (SyntaxKind::Whitespace, " ", 73..74),
            (SyntaxKind::AndKw, "and", 74..77),
            (SyntaxKind::Whitespace, " ", 77..78),
            (SyntaxKind::OrKw, "or", 78..80),
            (SyntaxKind::Whitespace, " ", 80..81),
            (SyntaxKind::NotKw, "not", 81..84),
            (SyntaxKind::Whitespace, " ", 84..85),
            (SyntaxKind::VarKw, "var", 85..88),
            (SyntaxKind::Whitespace, " ", 88..89),
            (SyntaxKind::ConstKw, "const", 89..94),
            (SyntaxKind::Whitespace, " ", 94..95),
            (SyntaxKind::ImportKw, "import", 95..101),
            (SyntaxKind::Whitespace, " ", 101..102),
            (SyntaxKind::ExportKw, "export", 102..108),
            (SyntaxKind::Whitespace, " ", 108..109),
            (SyntaxKind::TypeKw, "type", 109..113),
            (SyntaxKind::Whitespace, " ", 113..114),
            (SyntaxKind::InterfaceKw, "interface", 114..123),
            (SyntaxKind::Whitespace, " ", 123..124),
            (SyntaxKind::NewKw, "new", 124..127),
            (SyntaxKind::Whitespace, " ", 127..128),
            (SyntaxKind::SelfKw, "self", 128..132),
            (SyntaxKind::Whitespace, " ", 132..133),
            (SyntaxKind::RecordKw, "record", 133..139),
            (SyntaxKind::Whitespace, " ", 139..140),
            (SyntaxKind::StructKw, "struct", 140..146),
            (SyntaxKind::Whitespace, " ", 146..147),
            (SyntaxKind::ObjectKw, "object", 147..153),
        ],
    );
}

#[test]
fn lexes_import_as_keyword_based_on_text_only() {
    assert_tokens(
        "import foo",
        &[
            (SyntaxKind::ImportKw, "import", 0..6),
            (SyntaxKind::Whitespace, " ", 6..7),
            (SyntaxKind::Word, "foo", 7..10),
        ],
    );
    assert_tokens(
        "import(3)",
        &[
            (SyntaxKind::ImportKw, "import", 0..6),
            (SyntaxKind::OpenParen, "(", 6..7),
            (SyntaxKind::Number, "3", 7..8),
            (SyntaxKind::CloseParen, ")", 8..9),
        ],
    );
    assert_tokens(
        "import.foo import::foo import/*comment*/foo",
        &[
            (SyntaxKind::ImportKw, "import", 0..6),
            (SyntaxKind::Period, ".", 6..7),
            (SyntaxKind::Word, "foo", 7..10),
            (SyntaxKind::Whitespace, " ", 10..11),
            (SyntaxKind::ImportKw, "import", 11..17),
            (SyntaxKind::DoubleColon, "::", 17..19),
            (SyntaxKind::Word, "foo", 19..22),
            (SyntaxKind::Whitespace, " ", 22..23),
            (SyntaxKind::ImportKw, "import", 23..29),
            (SyntaxKind::BlockComment, "/*comment*/", 29..40),
            (SyntaxKind::Word, "foo", 40..43),
        ],
    );
}

#[test]
fn lexes_numbers_and_ranges() {
    assert_tokens(
        "1_ 1_mm 1m 1inch .5 0..10 0..<10",
        &[
            (SyntaxKind::Number, "1_", 0..2),
            (SyntaxKind::Whitespace, " ", 2..3),
            (SyntaxKind::Number, "1_mm", 3..7),
            (SyntaxKind::Whitespace, " ", 7..8),
            (SyntaxKind::Number, "1m", 8..10),
            (SyntaxKind::Whitespace, " ", 10..11),
            (SyntaxKind::Number, "1inch", 11..16),
            (SyntaxKind::Whitespace, " ", 16..17),
            (SyntaxKind::Number, ".5", 17..19),
            (SyntaxKind::Whitespace, " ", 19..20),
            (SyntaxKind::Number, "0", 20..21),
            (SyntaxKind::DoublePeriod, "..", 21..23),
            (SyntaxKind::Number, "10", 23..25),
            (SyntaxKind::Whitespace, " ", 25..26),
            (SyntaxKind::Number, "0", 26..27),
            (SyntaxKind::DoublePeriodLessThan, "..<", 27..30),
            (SyntaxKind::Number, "10", 30..32),
        ],
    );
}

#[test]
fn lexes_strings_comments_punctuation_and_unknown_ascii() {
    assert_tokens(
        "\"a\\\"b\" 'c' // hi\n/* block */ # ! $ ? @ ; :: : . , { } ( ) [ ] ~",
        &[
            (SyntaxKind::String, "\"a\\\"b\"", 0..6),
            (SyntaxKind::Whitespace, " ", 6..7),
            (SyntaxKind::String, "'c'", 7..10),
            (SyntaxKind::Whitespace, " ", 10..11),
            (SyntaxKind::LineComment, "// hi", 11..16),
            (SyntaxKind::Whitespace, "\n", 16..17),
            (SyntaxKind::BlockComment, "/* block */", 17..28),
            (SyntaxKind::Whitespace, " ", 28..29),
            (SyntaxKind::Hash, "#", 29..30),
            (SyntaxKind::Whitespace, " ", 30..31),
            (SyntaxKind::Bang, "!", 31..32),
            (SyntaxKind::Whitespace, " ", 32..33),
            (SyntaxKind::Dollar, "$", 33..34),
            (SyntaxKind::Whitespace, " ", 34..35),
            (SyntaxKind::QuestionMark, "?", 35..36),
            (SyntaxKind::Whitespace, " ", 36..37),
            (SyntaxKind::At, "@", 37..38),
            (SyntaxKind::Whitespace, " ", 38..39),
            (SyntaxKind::SemiColon, ";", 39..40),
            (SyntaxKind::Whitespace, " ", 40..41),
            (SyntaxKind::DoubleColon, "::", 41..43),
            (SyntaxKind::Whitespace, " ", 43..44),
            (SyntaxKind::Colon, ":", 44..45),
            (SyntaxKind::Whitespace, " ", 45..46),
            (SyntaxKind::Period, ".", 46..47),
            (SyntaxKind::Whitespace, " ", 47..48),
            (SyntaxKind::Comma, ",", 48..49),
            (SyntaxKind::Whitespace, " ", 49..50),
            (SyntaxKind::OpenBrace, "{", 50..51),
            (SyntaxKind::Whitespace, " ", 51..52),
            (SyntaxKind::CloseBrace, "}", 52..53),
            (SyntaxKind::Whitespace, " ", 53..54),
            (SyntaxKind::OpenParen, "(", 54..55),
            (SyntaxKind::Whitespace, " ", 55..56),
            (SyntaxKind::CloseParen, ")", 56..57),
            (SyntaxKind::Whitespace, " ", 57..58),
            (SyntaxKind::OpenBracket, "[", 58..59),
            (SyntaxKind::Whitespace, " ", 59..60),
            (SyntaxKind::CloseBracket, "]", 60..61),
            (SyntaxKind::Whitespace, " ", 61..62),
            (SyntaxKind::Unknown, "~", 62..63),
        ],
    );
}

#[test]
fn lexes_unterminated_strings_to_line_boundary() {
    assert_tokens(
        "\"abc\nnext",
        &[
            (SyntaxKind::UnterminatedString, "\"abc", 0..4),
            (SyntaxKind::Whitespace, "\n", 4..5),
            (SyntaxKind::Word, "next", 5..9),
        ],
    );
    assert_tokens(
        "'abc\r\nnext",
        &[
            (SyntaxKind::UnterminatedString, "'abc", 0..4),
            (SyntaxKind::Whitespace, "\r\n", 4..6),
            (SyntaxKind::Word, "next", 6..10),
        ],
    );
}

#[test]
fn lexes_unterminated_string_edge_boundaries() {
    assert_tokens("\"abc + 1", &[(SyntaxKind::UnterminatedString, "\"abc + 1", 0..8)]);
    assert_tokens(
        "\"abc\\\nnext",
        &[
            (SyntaxKind::UnterminatedString, "\"abc\\", 0..5),
            (SyntaxKind::Whitespace, "\n", 5..6),
            (SyntaxKind::Word, "next", 6..10),
        ],
    );
    assert_tokens(
        "'abc\\\r\nnext",
        &[
            (SyntaxKind::UnterminatedString, "'abc\\", 0..5),
            (SyntaxKind::Whitespace, "\r\n", 5..7),
            (SyntaxKind::Word, "next", 7..11),
        ],
    );
    assert_tokens(
        "\"\n'",
        &[
            (SyntaxKind::UnterminatedString, "\"", 0..1),
            (SyntaxKind::Whitespace, "\n", 1..2),
            (SyntaxKind::UnterminatedString, "'", 2..3),
        ],
    );
    assert_tokens("\"", &[(SyntaxKind::UnterminatedString, "\"", 0..1)]);
    assert_tokens("'", &[(SyntaxKind::UnterminatedString, "'", 0..1)]);
}

#[test]
fn lexes_unterminated_block_comment_to_eof() {
    assert_tokens(
        "before /* unfinished\nstill comment",
        &[
            (SyntaxKind::Word, "before", 0..6),
            (SyntaxKind::Whitespace, " ", 6..7),
            (
                SyntaxKind::UnterminatedBlockComment,
                "/* unfinished\nstill comment",
                7..34,
            ),
        ],
    );
}

#[test]
fn lexes_block_comment_edge_boundaries() {
    assert_tokens("/*", &[(SyntaxKind::UnterminatedBlockComment, "/*", 0..2)]);
    assert_tokens(
        "x/* text",
        &[
            (SyntaxKind::Word, "x", 0..1),
            (SyntaxKind::UnterminatedBlockComment, "/* text", 1..8),
        ],
    );
    assert_tokens("/*/**/", &[(SyntaxKind::BlockComment, "/*/**/", 0..6)]);
    assert_tokens("/**/", &[(SyntaxKind::BlockComment, "/**/", 0..4)]);
    assert_tokens("/***/", &[(SyntaxKind::BlockComment, "/***/", 0..5)]);
    assert_tokens(
        "/* outer /* inner */ tail */",
        &[
            (SyntaxKind::BlockComment, "/* outer /* inner */", 0..20),
            (SyntaxKind::Whitespace, " ", 20..21),
            (SyntaxKind::Word, "tail", 21..25),
            (SyntaxKind::Whitespace, " ", 25..26),
            (SyntaxKind::Star, "*", 26..27),
            (SyntaxKind::Slash, "/", 27..28),
        ],
    );
}

#[test]
fn lexes_line_comment_boundaries() {
    assert_tokens("// hi", &[(SyntaxKind::LineComment, "// hi", 0..5)]);
    assert_tokens(
        "// hi\r\nx",
        &[
            (SyntaxKind::LineComment, "// hi", 0..5),
            (SyntaxKind::Whitespace, "\r\n", 5..7),
            (SyntaxKind::Word, "x", 7..8),
        ],
    );
}

#[test]
fn lexes_numeric_like_boundaries() {
    assert_tokens(
        "1. 1._ . ... 1..2 .foo .1 1_mmfoo",
        &[
            (SyntaxKind::Number, "1", 0..1),
            (SyntaxKind::Period, ".", 1..2),
            (SyntaxKind::Whitespace, " ", 2..3),
            (SyntaxKind::Number, "1", 3..4),
            (SyntaxKind::Period, ".", 4..5),
            (SyntaxKind::Word, "_", 5..6),
            (SyntaxKind::Whitespace, " ", 6..7),
            (SyntaxKind::Period, ".", 7..8),
            (SyntaxKind::Whitespace, " ", 8..9),
            (SyntaxKind::DoublePeriod, "..", 9..11),
            (SyntaxKind::Period, ".", 11..12),
            (SyntaxKind::Whitespace, " ", 12..13),
            (SyntaxKind::Number, "1", 13..14),
            (SyntaxKind::DoublePeriod, "..", 14..16),
            (SyntaxKind::Number, "2", 16..17),
            (SyntaxKind::Whitespace, " ", 17..18),
            (SyntaxKind::Period, ".", 18..19),
            (SyntaxKind::Word, "foo", 19..22),
            (SyntaxKind::Whitespace, " ", 22..23),
            (SyntaxKind::Number, ".1", 23..25),
            (SyntaxKind::Whitespace, " ", 25..26),
            (SyntaxKind::Number, "1_mm", 26..30),
            (SyntaxKind::Word, "foo", 30..33),
        ],
    );
}

#[test]
fn lexes_numeric_suffix_boundaries_like_current_scanner() {
    assert_tokens(
        "1?foo 1_foo 1_mmfoo 1.2.3",
        &[
            (SyntaxKind::Number, "1?", 0..2),
            (SyntaxKind::Word, "foo", 2..5),
            (SyntaxKind::Whitespace, " ", 5..6),
            (SyntaxKind::Number, "1_", 6..8),
            (SyntaxKind::Word, "foo", 8..11),
            (SyntaxKind::Whitespace, " ", 11..12),
            (SyntaxKind::Number, "1_mm", 12..16),
            (SyntaxKind::Word, "foo", 16..19),
            (SyntaxKind::Whitespace, " ", 19..20),
            (SyntaxKind::Number, "1.2", 20..23),
            (SyntaxKind::Number, ".3", 23..25),
        ],
    );
}

#[test]
fn recovers_non_kcl_unicode_whitespace_as_unknown() {
    for whitespace in ["\u{00A0}", "\u{1680}", "\u{2003}", "\u{3000}"] {
        let source = format!("a{whitespace}b");
        let lexed = kcl_syntax::lexer::lex(&source);
        let tokens = lexed.tokens();

        assert_eq!(tokens.len(), 3);
        assert_eq!(tokens[0].kind(), SyntaxKind::Word);
        assert_eq!(tokens[0].text(), "a");
        assert_eq!(tokens[1].kind(), SyntaxKind::Unknown);
        assert_eq!(tokens[1].text(), whitespace);
        assert_eq!(tokens[2].kind(), SyntaxKind::Word);
        assert_eq!(tokens[2].text(), "b");
    }
}

#[test]
fn recovers_unsupported_unicode_scalars_as_unknown() {
    for scalar in ["🙂", "\u{200B}", "∴", "©"] {
        let source = format!("a{scalar}b");
        let lexed = kcl_syntax::lexer::lex(&source);
        let tokens = lexed.tokens();

        assert_eq!(tokens.len(), 3);
        assert_eq!(tokens[0].kind(), SyntaxKind::Word);
        assert_eq!(tokens[0].text(), "a");
        assert_eq!(tokens[1].kind(), SyntaxKind::Unknown);
        assert_eq!(tokens[1].text(), scalar);
        assert_eq!(tokens[2].kind(), SyntaxKind::Word);
        assert_eq!(tokens[2].text(), "b");
    }
}

#[test]
fn lexes_unknown_string_escapes_as_string_text() {
    assert_tokens(
        r#""a\q" 'a\q'"#,
        &[
            (SyntaxKind::String, r#""a\q""#, 0..5),
            (SyntaxKind::Whitespace, " ", 5..6),
            (SyntaxKind::String, r#"'a\q'"#, 6..11),
        ],
    );
}

#[test]
fn recovers_string_escape_newline_at_line_boundary() {
    // An *unterminated* string with a trailing backslash still recovers at the
    // line boundary. (An escaped newline only continues a *closed* string --
    // matching the legacy tokeniser -- see `lexes_multiline_strings`.)
    assert_tokens(
        concat!("\"a\\", "\n"),
        &[
            (SyntaxKind::UnterminatedString, "\"a\\", 0..3),
            (SyntaxKind::Whitespace, "\n", 3..4),
        ],
    );
}

#[test]
fn lexes_unicode_words_and_unknown_unicode_scalars() {
    assert_tokens(
        "亞當 = 🙂",
        &[
            (SyntaxKind::Word, "亞當", 0..6),
            (SyntaxKind::Whitespace, " ", 6..7),
            (SyntaxKind::Eq, "=", 7..8),
            (SyntaxKind::Whitespace, " ", 8..9),
            (SyntaxKind::Unknown, "🙂", 9..13),
        ],
    );
}

proptest! {
    #![proptest_config(ProptestConfig {
        failure_persistence: None,
        ..ProptestConfig::default()
    })]

    #[test]
    fn lex_preserves_source_text(source in kclish_source()) {
        let reconstructed: String = kcl_syntax::lexer::lex(&source)
            .into_iter()
            .map(|token| token.text())
            .collect();
        prop_assert_eq!(reconstructed, source);
    }

    #[test]
    fn numeric_suffix_tokens_stop_before_word_tail(
        numeric in prop_oneof![Just("1"), Just("1.2"), Just(".3")],
        suffix in prop::sample::select(&["", "_", "mm", "cm", "m", "inch", "in", "ft", "yd", "deg", "rad", "?"]),
    ) {
        let source = format!("{numeric}{suffix}foo");
        let lexed = kcl_syntax::lexer::lex(&source);
        let tokens = lexed.tokens();

        prop_assert_eq!(tokens.len(), 2);
        prop_assert_eq!(tokens[0].kind(), SyntaxKind::Number);
        prop_assert_eq!(tokens[0].text(), format!("{numeric}{suffix}"));
        prop_assert_eq!(tokens[1].kind(), SyntaxKind::Word);
        prop_assert_eq!(tokens[1].text(), "foo");
    }
}

fn assert_tokens(source: &str, expected: &[(SyntaxKind, &str, Range<usize>)]) {
    let actual = kcl_syntax::lexer::lex(source)
        .into_iter()
        .map(|token| (token.kind(), token.text(), token.range()))
        .collect::<Vec<_>>();
    assert_eq!(actual, expected);
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
