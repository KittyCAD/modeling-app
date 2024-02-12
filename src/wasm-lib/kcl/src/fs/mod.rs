//! Functions for interacting with files on a machine.

#[cfg(not(target_arch = "wasm32"))]
pub mod local;
#[cfg(not(target_arch = "wasm32"))]
pub use local::FileManager;

#[cfg(target_arch = "wasm32")]
#[cfg(not(test))]
pub mod wasm;
#[cfg(target_arch = "wasm32")]
#[cfg(not(test))]
pub use wasm::FileManager;

use anyhow::Result;

#[async_trait::async_trait(?Send)]
pub trait FileSystem: Clone {
    /// Read a file from the local file system.
    async fn read<P: AsRef<std::path::Path>>(
        &self,
        path: P,
        source_range: crate::executor::SourceRange,
    ) -> Result<Vec<u8>, crate::errors::KclError>;

    /// Check if a file exists on the local file system.
    async fn exists<P: AsRef<std::path::Path>>(
        &self,
        path: P,
        source_range: crate::executor::SourceRange,
    ) -> Result<bool, crate::errors::KclError>;
}
