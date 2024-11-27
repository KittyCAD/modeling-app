use serde::{Deserialize, Serialize};
use tower_lsp::lsp_types::{Diagnostic, DiagnosticSeverity, DiagnosticTag};
use winnow::{error::StrContext, stream::Stream};

use crate::{
    errors::{KclError, KclErrorDetails},
    parsing::token::Token,
    lsp::IntoDiagnostic,
    SourceRange,
};

/// Accumulate context while backtracking errors
/// Very similar to [`winnow::error::ContextError`] type,
/// but the 'cause' field is always a [`KclError`],
/// instead of a dynamic [`std::error::Error`] trait object.
#[derive(Debug, Clone)]
pub struct ContextError<C = StrContext> {
    pub context: Vec<C>,
    pub cause: Option<KclError>,
}

/// An error which occurred during parsing.
///
/// In contrast to Winnow errors which may not be an actual error but just an attempted parse which
/// didn't work out, these are errors which are always a result of incorrect user code and which should
/// be presented to the user.
#[derive(Debug, Clone, Serialize, Deserialize, ts_rs::TS)]
#[ts(export)]
pub struct CompilationError {
    pub source_range: SourceRange,
    pub context_range: Option<SourceRange>,
    pub message: String,
    pub suggestion: Option<String>,
    pub severity: Severity,
    pub tag: Tag,
}

impl CompilationError {
    pub(super) fn err(source_range: SourceRange, message: impl ToString) -> CompilationError {
        CompilationError {
            source_range,
            context_range: None,
            message: message.to_string(),
            suggestion: None,
            severity: Severity::Error,
            tag: Tag::None,
        }
    }

    pub(super) fn with_suggestion(
        source_range: SourceRange,
        context_range: Option<SourceRange>,
        message: impl ToString,
        suggestion: Option<impl ToString>,
        tag: Tag,
    ) -> CompilationError {
        CompilationError {
            source_range,
            context_range,
            message: message.to_string(),
            suggestion: suggestion.map(|s| s.to_string()),
            severity: Severity::Error,
            tag,
        }
    }

    #[cfg(test)]
    pub fn apply_suggestion(&self, src: &str) -> Option<String> {
        let suggestion = self.suggestion.as_ref()?;
        Some(format!(
            "{}{}{}",
            &src[0..self.source_range.start()],
            suggestion,
            &src[self.source_range.end()..]
        ))
    }
}

impl IntoDiagnostic for CompilationError {
    fn to_lsp_diagnostic(&self, code: &str) -> Diagnostic {
        let edit = self.suggestion.as_ref().map(|text| {
            serde_json::to_value(tower_lsp::lsp_types::TextEdit {
                range: self.source_range.to_lsp_range(code),
                new_text: text.clone(),
            })
            .unwrap()
        });

        Diagnostic {
            range: self.source_range.to_lsp_range(code),
            severity: Some(self.severity()),
            code: None,
            code_description: None,
            source: Some("kcl".to_string()),
            message: self.message.clone(),
            related_information: None,
            tags: self.tag.to_lsp_tags(),
            data: edit,
        }
    }

    fn severity(&self) -> DiagnosticSeverity {
        match self.severity {
            Severity::Warning => DiagnosticSeverity::WARNING,
            _ => DiagnosticSeverity::ERROR,
        }
    }
}

impl From<CompilationError> for KclErrorDetails {
    fn from(err: CompilationError) -> Self {
        KclErrorDetails {
            source_ranges: vec![err.source_range],
            message: err.message,
        }
    }
}

#[derive(Debug, Copy, Clone, Eq, PartialEq, Serialize, Deserialize, ts_rs::TS)]
#[ts(export)]
pub enum Severity {
    Warning,
    Error,
    Fatal,
}

#[derive(Debug, Copy, Clone, Eq, PartialEq, Serialize, Deserialize, ts_rs::TS)]
#[ts(export)]
pub enum Tag {
    Deprecated,
    Unnecessary,
    None,
}

impl Tag {
    fn to_lsp_tags(self) -> Option<Vec<DiagnosticTag>> {
        match self {
            Tag::Deprecated => Some(vec![DiagnosticTag::DEPRECATED]),
            Tag::Unnecessary => Some(vec![DiagnosticTag::UNNECESSARY]),
            Tag::None => None,
        }
    }
}

/// Helper enum for the below conversion of Winnow errors into either a parse error or an unexpected
/// error.
// TODO we should optimise the size of SourceRange and thus CompilationError
#[allow(clippy::large_enum_variant)]
pub(super) enum ErrorKind {
    Parse(CompilationError),
    Internal(KclError),
}

impl ErrorKind {
    #[cfg(test)]
    pub fn unwrap_compile_error(self) -> CompilationError {
        match self {
            ErrorKind::Parse(e) => e,
            ErrorKind::Internal(_) => panic!(),
        }
    }
}

impl From<winnow::error::ParseError<&[Token], ContextError>> for ErrorKind {
    fn from(err: winnow::error::ParseError<&[Token], ContextError>) -> Self {
        let Some(last_token) = err.input().last() else {
            return ErrorKind::Parse(CompilationError::err(Default::default(), "file is empty"));
        };

        let (input, offset, err) = (err.input().to_vec(), err.offset(), err.into_inner());

        if let Some(e) = err.cause {
            return match e {
                KclError::Syntax(details) => ErrorKind::Parse(CompilationError::err(
                    details.source_ranges.into_iter().next().unwrap(),
                    details.message,
                )),
                e => ErrorKind::Internal(e),
            };
        }

        // See docs on `offset`.
        if offset >= input.len() {
            let context = err.context.first();
            return ErrorKind::Parse(CompilationError::err(
                last_token.as_source_range(),
                match context {
                    Some(what) => format!("Unexpected end of file. The compiler {what}"),
                    None => "Unexpected end of file while still parsing".to_owned(),
                },
            ));
        }

        let bad_token = &input[offset];
        // TODO: Add the Winnow parser context to the error.
        // See https://github.com/KittyCAD/modeling-app/issues/784
        ErrorKind::Parse(CompilationError::err(
            bad_token.as_source_range(),
            format!("Unexpected token: {}", bad_token.value),
        ))
    }
}

impl<C> From<KclError> for ContextError<C> {
    fn from(e: KclError) -> Self {
        Self {
            context: Default::default(),
            cause: Some(e),
        }
    }
}

impl<C> std::default::Default for ContextError<C> {
    fn default() -> Self {
        Self {
            context: Default::default(),
            cause: None,
        }
    }
}

impl<I, C> winnow::error::ParserError<I> for ContextError<C>
where
    I: Stream,
{
    #[inline]
    fn from_error_kind(_input: &I, _kind: winnow::error::ErrorKind) -> Self {
        Self::default()
    }

    #[inline]
    fn append(
        self,
        _input: &I,
        _input_checkpoint: &<I as Stream>::Checkpoint,
        _kind: winnow::error::ErrorKind,
    ) -> Self {
        self
    }

    #[inline]
    fn or(self, other: Self) -> Self {
        other
    }
}

impl<C, I> winnow::error::AddContext<I, C> for ContextError<C>
where
    I: Stream,
{
    #[inline]
    fn add_context(mut self, _input: &I, _input_checkpoint: &<I as Stream>::Checkpoint, ctx: C) -> Self {
        self.context.push(ctx);
        self
    }
}

impl<C, I> winnow::error::FromExternalError<I, KclError> for ContextError<C> {
    #[inline]
    fn from_external_error(_input: &I, _kind: winnow::error::ErrorKind, e: KclError) -> Self {
        let mut err = Self::default();
        {
            err.cause = Some(e);
        }
        err
    }
}
