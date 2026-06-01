//! Facade for KCL memory implementations.
//!
//! The legacy implementation is still the only backend. Keeping it behind this
//! facade lets new memory backends be added without moving call sites first.

mod legacy;

pub use legacy::EnvironmentRef;
pub(crate) use legacy::MODULE_PREFIX;
pub(crate) use legacy::ProgramMemory;
pub(crate) use legacy::RETURN_NAME;
pub(crate) use legacy::SKETCH_PREFIX;
pub(crate) use legacy::Stack;
pub(crate) use legacy::TYPE_PREFIX;
