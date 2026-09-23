use crate::ModuleId;
use crate::SourceRange;
use crate::errors::CompilationIssue;
use crate::errors::KclError;
use crate::errors::KclErrorDetails;
use crate::parsing::ast::types::Node;
use crate::parsing::ast::types::Program;
use crate::parsing::token::TokenStream;
use crate::parsing::token::TokenType;

pub(crate) mod ast;
mod math;
pub(crate) mod parser;
pub(crate) mod token;

pub const PIPE_SUBSTITUTION_OPERATOR: &str = "%";
pub const PIPE_OPERATOR: &str = "|>";

// `?` like behavior for `Result`s to return a ParseResult if there is an error.
macro_rules! pr_try {
    ($e: expr_2021) => {
        match $e {
            Ok(a) => a,
            Err(e) => return e.into(),
        }
    };
}

#[cfg(test)]
/// Parse the given KCL code into an AST.  This is the top-level.
pub fn top_level_parse(code: &str) -> ParseResult {
    let module_id = ModuleId::default();
    parse_str(code, module_id)
}

/// Parse the given KCL code into an AST.
pub fn parse_str(code: &str, module_id: ModuleId) -> ParseResult {
    let tokens = pr_try!(crate::parsing::token::lex(code, module_id));
    parse_tokens(tokens)
}

/// Parse local imported KCL before comparing its declared version with the
/// entry point. Defer V3 keyword validation so a version mismatch is reported first.
pub(crate) fn parse_str_deferred_use_keyword(code: &str, module_id: ModuleId) -> ParseResult {
    let tokens = pr_try!(crate::parsing::token::lex(code, module_id));
    parse_tokens_with_use_policy(tokens, UseKeywordPolicy::Deferred)
}

pub(crate) const RESERVED_USE_MESSAGE: &str =
    "`use` is a reserved keyword in KCL 3.0 and cannot be used as an identifier";
pub(crate) const RESERVED_ENUM_MESSAGE: &str =
    "`enum` is a reserved keyword in KCL 3.0 and cannot be used as an identifier";

/// Check an imported source using the same lexer classification as ordinary
/// parsing, including the `use(` function-name exception.
pub(crate) fn validate_use_keyword_source(code: &str, module_id: ModuleId) -> Result<(), KclError> {
    let tokens = crate::parsing::token::lex(code, module_id)?;
    let Some(token) = tokens
        .iter()
        .find(|token| token.token_type == TokenType::Keyword && token.value == "use")
    else {
        return Ok(());
    };
    Err(KclError::new_syntax(KclErrorDetails::new(
        RESERVED_USE_MESSAGE.to_owned(),
        vec![token.as_source_range()],
    )))
}

/// Reject `enum` in every identifier position of an imported V3 module.
pub(crate) fn validate_enum_keyword_source(code: &str, module_id: ModuleId) -> Result<(), KclError> {
    let tokens = crate::parsing::token::lex(code, module_id)?;
    let Some(issue) = reserved_enum_issues(&tokens).into_iter().next() else {
        return Ok(());
    };
    Err(KclError::new_syntax(issue.into()))
}

fn reserved_enum_issues(tokens: &TokenStream) -> Vec<CompilationIssue> {
    tokens
        .iter()
        .filter(|token| token.token_type == TokenType::Word && token.value == "enum")
        .map(|token| CompilationIssue::err(token.as_source_range(), RESERVED_ENUM_MESSAGE))
        .collect()
}

/// Reject names reserved for future import modifiers in the first import slot.
pub(crate) fn validate_import_modifier_source(code: &str, module_id: ModuleId) -> Result<(), KclError> {
    let tokens = crate::parsing::token::lex(code, module_id)?;
    let Some(issue) = reserved_import_modifier_issues(&tokens).into_iter().next() else {
        return Ok(());
    };
    Err(KclError::new_syntax(issue.into()))
}

fn reserved_import_modifier_issues(tokens: &TokenStream) -> Vec<CompilationIssue> {
    let tokens = tokens.as_slice();
    tokens
        .iter()
        .enumerate()
        .filter_map(|(index, token)| {
            if token.token_type != TokenType::Keyword || token.value != "import" {
                return None;
            }
            let first_item = tokens[index + 1..]
                .iter()
                .find(|next| !next.token_type.is_whitespace())?;
            if first_item.token_type != TokenType::Word
                || !matches!(first_item.value.as_str(), "template" | "lazy" | "component")
            {
                return None;
            }
            Some(CompilationIssue::err(
                first_item.as_source_range(),
                format!(
                    "`{}` is reserved as an import modifier in KCL 3.0 and cannot be the first imported item",
                    first_item.value
                ),
            ))
        })
        .collect()
}

#[derive(Clone, Copy)]
enum UseKeywordPolicy {
    DeclaredVersion,
    Deferred,
}

/// Parse the supplied tokens into an AST.
pub fn parse_tokens(tokens: TokenStream) -> ParseResult {
    parse_tokens_with_use_policy(tokens, UseKeywordPolicy::DeclaredVersion)
}

fn parse_tokens_with_use_policy(mut tokens: TokenStream, use_policy: UseKeywordPolicy) -> ParseResult {
    let unknown_tokens = tokens.remove_unknown();

    if !unknown_tokens.is_empty() {
        let source_ranges = unknown_tokens.iter().map(SourceRange::from).collect();
        let token_list = unknown_tokens.iter().map(|t| t.value.as_str()).collect::<Vec<_>>();
        let message = if token_list.len() == 1 {
            format!("found unknown token '{}'", token_list[0])
        } else {
            format!("found unknown tokens [{}]", token_list.join(", "))
        };
        return KclError::new_lexical(KclErrorDetails::new(message, source_ranges)).into();
    }

    // Important, to not call this before the unknown tokens check.
    if tokens.is_empty() {
        // Empty file should just do nothing.
        return Node::<Program>::default().into();
    }

    // Check all the tokens are whitespace.
    if tokens.iter().all(|t| t.token_type.is_whitespace()) {
        return Node::<Program>::default().into();
    }

    let mut reserved_issues = reserved_import_modifier_issues(&tokens);
    reserved_issues.extend(reserved_enum_issues(&tokens));
    let use_keyword_ranges = tokens.allow_use_identifiers();
    reserved_issues.extend(
        use_keyword_ranges
            .into_iter()
            .map(|range| CompilationIssue::err(range, RESERVED_USE_MESSAGE)),
    );
    reserved_issues.sort_by_key(|issue| issue.source_range.start());
    let mut result = parser::run_parser(tokens.as_slice());
    if matches!(use_policy, UseKeywordPolicy::DeclaredVersion)
        && let Ok((Some(program), issues)) = &mut result.0
        && !reserved_issues.is_empty()
        && matches!(
            crate::execution::declared_kcl_version(program),
            Ok(Some((version, _))) if version >= crate::KclVersion::V3Preview
        )
    {
        issues.extend(reserved_issues);
    }
    result
}

/// Result of parsing.
///
/// Will be a KclError if there was a lexing error or some unexpected error during parsing.
///   TODO - lexing errors should be included with the parse errors.
/// Will be Ok otherwise, including if there were parsing errors. Any errors or warnings will
/// be in the ParseContext. If an AST was produced, then that will be in the Option.
///
/// Invariants:
/// - if there are no errors, then the Option will be Some
/// - if the Option is None, then there will be at least one error in the ParseContext.
#[derive(Debug, Clone)]
pub struct ParseResult(pub Result<(Option<Node<Program>>, Vec<CompilationIssue>), KclError>);

impl ParseResult {
    #[cfg(test)]
    #[track_caller]
    pub fn unwrap(self) -> Node<Program> {
        if self.0.is_err() || self.0.as_ref().unwrap().0.is_none() {
            eprint!("{self:#?}");
        }
        self.0.unwrap().0.unwrap()
    }

    #[cfg(test)]
    pub fn is_ok(&self) -> bool {
        match &self.0 {
            Ok((p, errs)) => p.is_some() && !errs.iter().any(|e| e.severity.is_err()),
            Err(_) => false,
        }
    }

    #[cfg(test)]
    #[track_caller]
    pub fn unwrap_errs(&self) -> impl Iterator<Item = &CompilationIssue> {
        self.0.as_ref().unwrap().1.iter().filter(|e| e.severity.is_err())
    }

    /// Treat parsing errors as an Error.
    pub fn parse_errs_as_err(self) -> Result<Node<Program>, KclError> {
        let (p, errs) = self.0?;

        if let Some(err) = errs.iter().find(|e| e.severity.is_err()) {
            return Err(KclError::new_syntax(err.clone().into()));
        }
        match p {
            Some(p) => Ok(p),
            None => Err(KclError::internal("Unknown parsing error".to_owned())),
        }
    }
}

impl From<Result<(Option<Node<Program>>, Vec<CompilationIssue>), KclError>> for ParseResult {
    fn from(r: Result<(Option<Node<Program>>, Vec<CompilationIssue>), KclError>) -> ParseResult {
        ParseResult(r)
    }
}

impl From<(Option<Node<Program>>, Vec<CompilationIssue>)> for ParseResult {
    fn from(p: (Option<Node<Program>>, Vec<CompilationIssue>)) -> ParseResult {
        ParseResult(Ok(p))
    }
}

impl From<Node<Program>> for ParseResult {
    fn from(p: Node<Program>) -> ParseResult {
        ParseResult(Ok((Some(p), vec![])))
    }
}

impl From<KclError> for ParseResult {
    fn from(e: KclError) -> ParseResult {
        ParseResult(Err(e))
    }
}

const STR_DEPRECATIONS: [(&str, &str); 16] = [
    ("XY", "XY"),
    ("XZ", "XZ"),
    ("YZ", "YZ"),
    ("-XY", "-XY"),
    ("-XZ", "-XZ"),
    ("-YZ", "-YZ"),
    ("xy", "XY"),
    ("xz", "XZ"),
    ("yz", "YZ"),
    ("-xy", "-XY"),
    ("-xz", "-XZ"),
    ("-yz", "-YZ"),
    ("START", "START"),
    ("start", "START"),
    ("END", "END"),
    ("end", "END"),
];
const FN_DEPRECATIONS: [(&str, &str); 3] = [("pi", "PI"), ("e", "E"), ("tau", "TAU")];
const CONST_DEPRECATIONS: [(&str, &str); 4] = [
    ("ZERO", "turns::ZERO"),
    ("QUARTER_TURN", "turns::QUARTER_TURN"),
    ("HALF_TURN", "turns::HALF_TURN"),
    ("THREE_QUARTER_TURN", "turns::THREE_QUARTER_TURN"),
];

#[derive(Clone, Copy)]
pub enum DeprecationKind {
    String,
    Function,
    Const,
}

pub fn deprecation(s: &str, kind: DeprecationKind) -> Option<&'static str> {
    match kind {
        DeprecationKind::String => STR_DEPRECATIONS.iter().find_map(|(a, b)| (*a == s).then_some(*b)),
        DeprecationKind::Function => FN_DEPRECATIONS.iter().find_map(|(a, b)| (*a == s).then_some(*b)),
        DeprecationKind::Const => CONST_DEPRECATIONS.iter().find_map(|(a, b)| (*a == s).then_some(*b)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::parsing::token::LexerMode;

    #[test]
    fn use_identifiers_remain_valid_before_v3() {
        for mode in [LexerMode::Old, LexerMode::New] {
            let _guard = LexerMode::override_for_test(mode);
            for version in [None, Some("1.0"), Some("2.0")] {
                let settings = version.map_or(String::new(), |version| format!("@settings(kclVersion = {version})\n"));
                let code = format!("{settings}use = 1\nvalue = use\n");
                assert!(top_level_parse(&code).is_ok(), "{mode:?}: {code}");
            }
        }
    }

    #[test]
    fn use_identifiers_are_reserved_in_v3_preview() {
        for mode in [LexerMode::Old, LexerMode::New] {
            let _guard = LexerMode::override_for_test(mode);
            for version in ["3-preview", "3.0-preview", "3.0.0-preview"] {
                let code = format!("@settings(kclVersion = \"{version}\")\nuse = 1\n");
                let result = top_level_parse(&code);
                let errors: Vec<_> = result.unwrap_errs().collect();
                assert_eq!(errors.len(), 1, "{mode:?}: {code}: {errors:#?}");
                assert_eq!(
                    errors[0].source_range,
                    SourceRange::new(
                        code.find("use =").unwrap(),
                        code.find("use =").unwrap() + 3,
                        ModuleId::default()
                    )
                );
                assert_eq!(
                    errors[0].message,
                    "`use` is a reserved keyword in KCL 3.0 and cannot be used as an identifier"
                );
            }
        }
    }

    #[test]
    fn use_function_name_exception_requires_adjacent_parenthesis() {
        for mode in [LexerMode::Old, LexerMode::New] {
            let _guard = LexerMode::override_for_test(mode);
            let allowed = "@settings(kclVersion = \"3.0-preview\")\nfn use() { return 1 }\nuse()\n";
            assert!(top_level_parse(allowed).is_ok(), "{mode:?}: {allowed}");

            let rejected = "@settings(kclVersion = \"3.0-preview\")\nfn use () { return 1 }\n";
            assert!(!top_level_parse(rejected).is_ok(), "{mode:?}: {rejected}");
        }
    }

    #[test]
    fn use_in_settings_keys_is_version_checked() {
        for mode in [LexerMode::Old, LexerMode::New] {
            let _guard = LexerMode::override_for_test(mode);
            assert!(top_level_parse("@settings(use = 1)\n").is_ok());
            let v3 = "@settings(kclVersion = \"3.0-preview\", use = 1)\n";
            assert!(!top_level_parse(v3).is_ok(), "{mode:?}: {v3}");
        }
    }

    #[test]
    fn use_reservation_uses_last_declared_version() {
        for mode in [LexerMode::Old, LexerMode::New] {
            let _guard = LexerMode::override_for_test(mode);
            let late_v3 = "use = 1\n@settings(kclVersion = \"3.0-preview\")\n";
            assert!(!top_level_parse(late_v3).is_ok(), "{mode:?}: {late_v3}");

            let last_v2 = "@settings(kclVersion = \"3.0-preview\")\n@settings(kclVersion = 2.0)\nuse = 1\n";
            assert!(top_level_parse(last_v2).is_ok(), "{mode:?}: {last_v2}");
        }
    }

    #[test]
    fn use_text_in_strings_comments_and_longer_names_is_not_reserved() {
        for mode in [LexerMode::Old, LexerMode::New] {
            let _guard = LexerMode::override_for_test(mode);
            let code = "@settings(kclVersion = \"3.0-preview\")\nuseful = \"use\" // use\n";
            assert!(top_level_parse(code).is_ok(), "{mode:?}: {code}");
        }
    }

    #[test]
    fn enum_identifiers_remain_valid_before_v3() {
        for mode in [LexerMode::Old, LexerMode::New] {
            let _guard = LexerMode::override_for_test(mode);
            for version in [None, Some("1.0"), Some("2.0")] {
                let settings = version.map_or(String::new(), |version| format!("@settings(kclVersion = {version})\n"));
                for body in [
                    "enum = 1\nvalue = enum\n",
                    "fn enum() { return 1 }\n",
                    "import enum from \"dep.kcl\"\n",
                ] {
                    let code = format!("{settings}{body}");
                    assert!(top_level_parse(&code).is_ok(), "{mode:?}: {code}");
                }
            }
        }
    }

    #[test]
    fn enum_is_reserved_in_every_v3_identifier_position() {
        for mode in [LexerMode::Old, LexerMode::New] {
            let _guard = LexerMode::override_for_test(mode);
            for body in [
                "enum = 1\n",
                "value = enum\n",
                "fn enum() { return 1 }\n",
                "type enum = number\n",
                "import enum from \"dep.kcl\"\n",
                "import other as enum from \"dep.kcl\"\n",
                "import \"dep.kcl\" as enum\n",
                "@settings(enum = 1)\nvalue = 1\n",
            ] {
                let code = format!("@settings(kclVersion = \"3.0-preview\", experimentalFeatures = allow)\n{body}");
                let result = top_level_parse(&code);
                let errors: Vec<_> = result.unwrap_errs().collect();
                assert_eq!(errors.len(), 1, "{mode:?}: {code}: {errors:#?}");
                let start = code.find("enum").unwrap();
                assert_eq!(
                    errors[0].source_range,
                    SourceRange::new(start, start + "enum".len(), ModuleId::default())
                );
                assert_eq!(errors[0].message, RESERVED_ENUM_MESSAGE);
            }
        }
    }

    #[test]
    fn enum_reservation_uses_last_declared_version() {
        for mode in [LexerMode::Old, LexerMode::New] {
            let _guard = LexerMode::override_for_test(mode);
            let late_v3 = "enum = 1\n@settings(kclVersion = \"3.0-preview\")\n";
            assert!(!top_level_parse(late_v3).is_ok(), "{mode:?}: {late_v3}");

            let last_v2 = "@settings(kclVersion = \"3.0-preview\")\n@settings(kclVersion = 2.0)\nenum = 1\n";
            assert!(top_level_parse(last_v2).is_ok(), "{mode:?}: {last_v2}");
        }
    }

    #[test]
    fn enum_text_in_strings_comments_and_longer_names_is_not_reserved() {
        for mode in [LexerMode::Old, LexerMode::New] {
            let _guard = LexerMode::override_for_test(mode);
            let code = "@settings(kclVersion = \"3.0-preview\")\nenumeration = \"enum\" // enum\n";
            assert!(top_level_parse(code).is_ok(), "{mode:?}: {code}");
        }
    }

    #[test]
    fn import_modifier_words_are_reserved_in_the_first_import_slot_in_v3() {
        for mode in [LexerMode::Old, LexerMode::New] {
            let _guard = LexerMode::override_for_test(mode);
            for word in ["template", "lazy", "component"] {
                for version in [None, Some("1.0"), Some("2.0")] {
                    let settings =
                        version.map_or(String::new(), |version| format!("@settings(kclVersion = {version})\n"));
                    let code = format!("{settings}import {word} from \"dep.kcl\"\n");
                    assert!(top_level_parse(&code).is_ok(), "{mode:?}: {code}");
                }

                for selector in [word.to_owned(), format!("{word} as alias, other")] {
                    let code = format!("@settings(kclVersion = \"3.0-preview\")\nimport {selector} from \"dep.kcl\"\n");
                    let result = top_level_parse(&code);
                    let errors: Vec<_> = result.unwrap_errs().collect();
                    assert_eq!(errors.len(), 1, "{mode:?}: {code}: {errors:#?}");
                    let start = code.find(&format!("import {word}")).unwrap() + "import ".len();
                    assert_eq!(
                        errors[0].source_range,
                        SourceRange::new(start, start + word.len(), ModuleId::default())
                    );
                    assert_eq!(
                        errors[0].message,
                        format!(
                            "`{word}` is reserved as an import modifier in KCL 3.0 and cannot be the first imported item"
                        )
                    );
                }
            }
        }
    }

    #[test]
    fn import_modifier_words_remain_valid_outside_the_first_import_slot() {
        for mode in [LexerMode::Old, LexerMode::New] {
            let _guard = LexerMode::override_for_test(mode);
            for word in ["template", "lazy", "component"] {
                for code in [
                    format!(
                        "@settings(kclVersion = \"3.0-preview\")\n{word} = \"{word}\" // import {word} from \"dep.kcl\"\n"
                    ),
                    format!("@settings(kclVersion = \"3.0-preview\")\nimport other, {word} from \"dep.kcl\"\n"),
                    format!("@settings(kclVersion = \"3.0-preview\")\nimport \"dep.kcl\" as {word}\n"),
                ] {
                    assert!(top_level_parse(&code).is_ok(), "{mode:?}: {code}");
                }
            }
        }
    }

    #[test]
    fn import_modifier_reservation_uses_last_declared_version() {
        for mode in [LexerMode::Old, LexerMode::New] {
            let _guard = LexerMode::override_for_test(mode);
            let late_v3 = "import lazy from \"dep.kcl\"\n@settings(kclVersion = \"3.0-preview\")\n";
            assert!(!top_level_parse(late_v3).is_ok(), "{mode:?}: {late_v3}");

            let last_v2 =
                "@settings(kclVersion = \"3.0-preview\")\n@settings(kclVersion = 2.0)\nimport lazy from \"dep.kcl\"\n";
            assert!(top_level_parse(last_v2).is_ok(), "{mode:?}: {last_v2}");
        }
    }

    macro_rules! parse_and_lex {
        ($func_name:ident, $test_kcl_program:expr_2021) => {
            #[test]
            fn $func_name() {
                let _ = crate::parsing::top_level_parse($test_kcl_program);
            }
        };
    }

    parse_and_lex!(crash_eof_1, "{\"ގގ\0\0\0\"\".");
    parse_and_lex!(crash_eof_2, "(/=e\"\u{616}ݝ\"\"");
}
