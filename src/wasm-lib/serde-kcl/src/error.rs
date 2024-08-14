use std::{fmt::Display, num::TryFromIntError};

/// Errors that can occur when converting between
/// Rust types and KCL types.
#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("{0}")]
    Message(String),
    #[error("Number is too big")]
    NumberTooBig,
    #[error("You cannot use this as a key of a KCL object")]
    InvalidKey,
    #[error("Invalid syntax")]
    Syntax,
}

impl From<TryFromIntError> for Error {
    fn from(_: TryFromIntError) -> Self {
        Self::NumberTooBig
    }
}

impl serde::ser::Error for Error {
    fn custom<T: Display>(msg: T) -> Self {
        Self::Message(msg.to_string())
    }
}

impl serde::de::Error for Error {
    fn custom<T: Display>(msg: T) -> Self {
        Self::Message(msg.to_string())
    }
}
