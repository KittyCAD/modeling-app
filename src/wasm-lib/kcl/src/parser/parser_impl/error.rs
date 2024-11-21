use winnow::{error::StrContext, stream::Stream};

use crate::{
    errors::{KclError, KclErrorDetails},
    executor::SourceRange,
    token::Token,
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
#[derive(Debug, Clone)]
pub(crate) struct ParseError {
    pub source_range: SourceRange,
    pub message: String,
    #[allow(dead_code)]
    pub suggestion: String,
    pub severity: Severity,
}

impl ParseError {
    pub(super) fn err(source_range: SourceRange, message: impl ToString) -> ParseError {
        ParseError {
            source_range,
            message: message.to_string(),
            suggestion: String::new(),
            severity: Severity::Error,
        }
    }

    #[allow(dead_code)]
    pub(super) fn with_suggestion(
        source_range: SourceRange,
        message: impl ToString,
        suggestion: impl ToString,
    ) -> ParseError {
        ParseError {
            source_range,
            message: message.to_string(),
            suggestion: suggestion.to_string(),
            severity: Severity::Error,
        }
    }
}

impl From<ParseError> for KclError {
    fn from(err: ParseError) -> Self {
        KclError::Syntax(KclErrorDetails {
            source_ranges: vec![err.source_range],
            message: err.message,
        })
    }
}

#[derive(Debug, Clone)]
pub(crate) enum Severity {
    #[allow(dead_code)]
    Warning,
    Error,
}

/// Helper enum for the below conversion of Winnow errors into either a parse error or an unexpected
/// error.
pub(super) enum ErrorKind {
    Parse(ParseError),
    Internal(KclError),
}

impl ErrorKind {
    #[cfg(test)]
    pub fn unwrap_parse_error(self) -> ParseError {
        match self {
            ErrorKind::Parse(parse_error) => parse_error,
            ErrorKind::Internal(_) => panic!(),
        }
    }
}

impl From<winnow::error::ParseError<&[Token], ContextError>> for ErrorKind {
    fn from(err: winnow::error::ParseError<&[Token], ContextError>) -> Self {
        let Some(last_token) = err.input().last() else {
            return ErrorKind::Parse(ParseError::err(Default::default(), "file is empty"));
        };

        let (input, offset, err) = (err.input().to_vec(), err.offset(), err.into_inner());

        if let Some(e) = err.cause {
            return match e {
                KclError::Syntax(details) => ErrorKind::Parse(ParseError::err(
                    details.source_ranges.into_iter().next().unwrap(),
                    details.message,
                )),
                e => ErrorKind::Internal(e),
            };
        }

        // See docs on `offset`.
        if offset >= input.len() {
            let context = err.context.first();
            return ErrorKind::Parse(ParseError::err(
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
        ErrorKind::Parse(ParseError::err(
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
