use std::{fmt::Display, num::TryFromIntError};

/// Errors that can occur when converting between
/// Rust types and KCL types.
#[derive(Debug, thiserror::Error)]
pub enum Error {
    /// Some error not covered by other cases.
    #[error("{0}")]
    Message(String),
    /// Number is too big.
    #[error("Number is too big")]
    NumberTooBig,
    /// Invalid key for a KCL object.
    #[error("You cannot use this as a key of a KCL object")]
    InvalidKey,
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
