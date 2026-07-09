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
        // Multiline strings: a closed string spanning raw newlines is one String
        // token in both lexers.
        "\"line one\nline two\"",
        "'multi\nline string'",
        "\"// a comment\nstill in the string\"",
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
    if let Err(divergence) = check_matches_old_scanner(source) {
        panic!("source:\n{source}\n{divergence}");
    }
}

/// How the new and old scanners agreed for one input.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum MatchKind {
    /// Token-for-token identical (the strong case).
    Strict,
    /// New scanner emitted a recovery token; only lossless reconstruction is required.
    Recovery,
    /// The intentional `import(` policy divergence (old: Word, new: Keyword).
    ImportPolicy,
    /// Old scanner rejected the source; new scanner reconstructs it losslessly.
    OldError,
}

/// Compare the new lexer against the old scanner for `source`. Returns `Ok(kind)`
/// when they agree or when the difference is an intentionally-tolerated case
/// (`kind` says which), and `Err(description)` for a real, untolerated divergence.
/// Non-panicking so a corpus scan can collect divergences and tally how much
/// matched strictly vs. was tolerated, in a single pass.
fn check_matches_old_scanner(source: &str) -> Result<MatchKind, String> {
    let new_tokens = new_tokens(source);
    let reconstructed = || new_tokens.iter().map(|(_, text, _)| text.as_str()).collect::<String>();

    match old_tokens(source) {
        Ok(_) if has_recovery_token(&new_tokens) => {
            if reconstructed() == source {
                Ok(MatchKind::Recovery)
            } else {
                Err("new scanner did not preserve text while recovering from a lexical error".to_owned())
            }
        }
        Ok(old_tokens) if has_import_policy_divergence(&old_tokens, &new_tokens) => {
            if reconstructed() != source {
                Err("new scanner did not preserve text in the import-policy case".to_owned())
            } else if old_tokens == new_tokens {
                Err("import-policy case expected a divergence but tokens matched".to_owned())
            } else {
                Ok(MatchKind::ImportPolicy)
            }
        }
        Ok(old_tokens) => {
            if old_tokens == new_tokens {
                Ok(MatchKind::Strict)
            } else {
                Err(format!("token mismatch:\n  old: {old_tokens:?}\n  new: {new_tokens:?}"))
            }
        }
        Err(old_error) => {
            if reconstructed() == source {
                Ok(MatchKind::OldError)
            } else {
                Err(format!(
                    "old scanner rejected the source but the new scanner did not reconstruct it losslessly; old error:\n{old_error:?}"
                ))
            }
        }
    }
}

/// Runs the new-vs-old comparison over the whole in-repo `.kcl` corpus (far
/// beyond `kcl-lib/tests`), plus an external corpus when `KCL_CORPUS_DIR` is set,
/// reporting every divergence in one pass.
#[test]
fn corpus_matches_old_scanner() {
    let manifest = Path::new(env!("CARGO_MANIFEST_DIR"));
    let repo_root = manifest.join("..").join("..");

    let mut roots = vec![
        manifest.to_path_buf(),
        repo_root.join("public").join("kcl-samples"),
        repo_root.join("public").join("kcl-samples-legacy"),
        repo_root.join("rust").join("kcl-python-bindings"),
    ];
    if let Ok(external) = std::env::var("KCL_CORPUS_DIR") {
        roots.push(std::path::PathBuf::from(external));
    }

    let mut checked = 0usize;
    let mut strict = 0usize;
    let mut recovery = 0usize;
    let mut import_policy = 0usize;
    let mut old_error = 0usize;
    let mut divergences: Vec<(String, String)> = Vec::new();

    for root in &roots {
        if !root.exists() {
            continue;
        }
        for entry in walkdir::WalkDir::new(root).into_iter().filter_map(Result::ok) {
            let path = entry.path();
            if !path.is_file() || path.extension().is_none_or(|extension| extension != "kcl") {
                continue;
            }
            let Ok(source) = std::fs::read_to_string(path) else {
                continue;
            };
            checked += 1;
            match check_matches_old_scanner(&source) {
                Ok(MatchKind::Strict) => strict += 1,
                Ok(MatchKind::Recovery) => recovery += 1,
                Ok(MatchKind::ImportPolicy) => import_policy += 1,
                Ok(MatchKind::OldError) => old_error += 1,
                Err(divergence) => divergences.push((path.display().to_string(), divergence)),
            }
        }
    }

    eprintln!(
        "[corpus] checked {checked} .kcl file(s): strict={strict} recovery={recovery} import={import_policy} old_error={old_error}; {} untolerated divergence(s)",
        divergences.len()
    );
    for (path, divergence) in divergences.iter().take(50) {
        eprintln!("[corpus] DIVERGENCE {path}\n{divergence}\n");
    }
    if divergences.len() > 50 {
        eprintln!(
            "[corpus] ... and {} more divergence(s) not shown",
            divergences.len() - 50
        );
    }

    assert!(
        divergences.is_empty(),
        "{} corpus divergence(s); see stderr above",
        divergences.len()
    );
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
    // Pin to the legacy tokeniser regardless of the ambient `KCL_LEXER` mode, so
    // this stays the "old" side of the comparison even under `KCL_LEXER=new`.
    super::lex_legacy(source, ModuleId::default()).map(|tokens| {
        tokens
            .tokens
            .into_iter()
            .map(|token| (token.token_type, token.value, token.start..token.end))
            .collect()
    })
}

fn new_tokens(source: &str) -> Vec<(TokenType, String, Range<usize>)> {
    // Uses the production mapping so the compat comparison and the new lexer's
    // adapter can never drift. Recovery kinds (unterminated string/block comment)
    // map to `Unknown` here; those inputs hit the recovery arm of
    // `assert_matches_old_scanner`, so the mapped type is not compared directly.
    kcl_syntax::lexer::lex(source)
        .into_iter()
        .map(|token| {
            (
                super::adapter::syntax_kind_to_token_type(token.kind()),
                token.text().to_owned(),
                token.range(),
            )
        })
        .collect()
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
