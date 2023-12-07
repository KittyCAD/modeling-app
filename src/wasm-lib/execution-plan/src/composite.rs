use crate::{ExecutionError, Value};

mod impls;

/// Types that can be written to or read from KCEP program memory,
/// but require multiple values to store.
/// They get laid out into multiple consecutive memory addresses.
pub trait Composite: Sized {
    /// Store the value in memory.
    fn into_parts(self) -> Vec<Value>;
    /// Read the value from memory.
    fn from_parts(values: &[Option<Value>]) -> Result<Self, ExecutionError>;
}
