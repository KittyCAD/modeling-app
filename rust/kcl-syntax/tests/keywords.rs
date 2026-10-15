use kcl_syntax::keywords::keyword_kind;
use kcl_syntax::syntax_kind::SyntaxKind;

#[test]
fn keyword_lookup_requires_exact_spelling() {
    for (text, expected) in [
        ("if", Some(SyntaxKind::IfKw)),
        ("import", Some(SyntaxKind::ImportKw)),
        ("use", Some(SyntaxKind::UseKw)),
        ("If", None),
        ("if1", None),
        ("useful", None),
        (" import", None),
        ("import ", None),
        ("import(", None),
        ("construction", None),
        ("on", None),
        ("zoo", None),
    ] {
        assert_eq!(keyword_kind(text), expected, "{text:?}");
    }
}
