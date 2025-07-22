use crate::{
    ModuleId,
    errors::{CompilationError, KclError, KclErrorDetails},
    parsing::{
        ast::types::{Node, Program},
        token::TokenStream,
    },
    source_range::SourceRange,
};

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

/// Parse the supplied tokens into an AST.
pub fn parse_tokens(mut tokens: TokenStream) -> ParseResult {
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

    parser::run_parser(tokens.as_slice())
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
pub(crate) struct ParseResult(pub Result<(Option<Node<Program>>, Vec<CompilationError>), KclError>);

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
    pub fn unwrap_errs(&self) -> impl Iterator<Item = &CompilationError> {
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

impl From<Result<(Option<Node<Program>>, Vec<CompilationError>), KclError>> for ParseResult {
    fn from(r: Result<(Option<Node<Program>>, Vec<CompilationError>), KclError>) -> ParseResult {
        ParseResult(r)
    }
}

impl From<(Option<Node<Program>>, Vec<CompilationError>)> for ParseResult {
    fn from(p: (Option<Node<Program>>, Vec<CompilationError>)) -> ParseResult {
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
