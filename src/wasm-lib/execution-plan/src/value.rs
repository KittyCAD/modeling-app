use crate::{ExecutionError, Primitive};

mod impls;

/// Types that can be written to or read from KCEP program memory.
/// If they require multiple memory addresses, they will be laid out
/// into multiple consecutive memory addresses.
pub trait Value: Sized {
    /// Store the value in memory.
    fn into_parts(self) -> Vec<Primitive>;
    /// Read the value from memory.
    fn from_parts(values: &[Option<Primitive>]) -> Result<Self, ExecutionError>;
}
