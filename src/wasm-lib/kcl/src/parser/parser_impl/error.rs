use winnow::{
    error::{ErrorKind, ParseError, StrContext},
    stream::Stream,
    Located,
};

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

impl From<ParseError<Located<&str>, winnow::error::ContextError>> for KclError {
    fn from(err: ParseError<Located<&str>, winnow::error::ContextError>) -> Self {
        let (input, offset): (Vec<char>, usize) = (err.input().chars().collect(), err.offset());

        if offset >= input.len() {
            // From the winnow docs:
            //
            // This is an offset, not an index, and may point to
            // the end of input (input.len()) on eof errors.

            return KclError::Lexical(KclErrorDetails {
                source_ranges: vec![SourceRange([offset, offset])],
                message: "unexpected EOF while parsing".to_string(),
            });
        }

        // TODO: Add the Winnow tokenizer context to the error.
        // See https://github.com/KittyCAD/modeling-app/issues/784
        let bad_token = &input[offset];
        // TODO: Add the Winnow parser context to the error.
        // See https://github.com/KittyCAD/modeling-app/issues/784
        KclError::Lexical(KclErrorDetails {
            source_ranges: vec![SourceRange([offset, offset + 1])],
            message: format!("found unknown token '{}'", bad_token),
        })
    }
}

impl From<ParseError<&[Token], ContextError>> for KclError {
    fn from(err: ParseError<&[Token], ContextError>) -> Self {
        let Some(last_token) = err.input().last() else {
            return KclError::Syntax(KclErrorDetails {
                source_ranges: Default::default(),
                message: "file is empty".to_owned(),
            });
        };

        let (input, offset, err) = (err.input().to_vec(), err.offset(), err.into_inner());

        if let Some(e) = err.cause {
            return e;
        }

        // See docs on `offset`.
        if offset >= input.len() {
            let context = err.context.first();
            return KclError::Syntax(KclErrorDetails {
                source_ranges: last_token.as_source_ranges(),
                message: match context {
                    Some(what) => format!("Unexpected end of file. The compiler {what}"),
                    None => "Unexpected end of file while still parsing".to_owned(),
                },
            });
        }

        let bad_token = &input[offset];
        // TODO: Add the Winnow parser context to the error.
        // See https://github.com/KittyCAD/modeling-app/issues/784
        KclError::Syntax(KclErrorDetails {
            source_ranges: bad_token.as_source_ranges(),
            message: format!("Unexpected token: {}", bad_token.value),
        })
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
    fn from_error_kind(_input: &I, _kind: ErrorKind) -> Self {
        Self::default()
    }

    #[inline]
    fn append(self, _input: &I, _input_checkpoint: &<I as Stream>::Checkpoint, _kind: ErrorKind) -> Self {
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
    fn from_external_error(_input: &I, _kind: ErrorKind, e: KclError) -> Self {
        let mut err = Self::default();
        {
            err.cause = Some(e);
        }
        err
    }
}
