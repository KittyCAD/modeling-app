//! Functions for interacting with files on a machine.

use anyhow::Result;

use crate::SourceRange;

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

#[async_trait::async_trait]
pub trait FileSystem: Clone {
    /// Read a file from the local file system.
    async fn read<P: AsRef<std::path::Path> + std::marker::Send + std::marker::Sync>(
        &self,
        path: P,
        source_range: SourceRange,
    ) -> Result<Vec<u8>, crate::errors::KclError>;

    /// Read a file from the local file system.
    async fn read_to_string<P: AsRef<std::path::Path> + std::marker::Send + std::marker::Sync>(
        &self,
        path: P,
        source_range: SourceRange,
    ) -> Result<String, crate::errors::KclError>;

    /// Check if a file exists on the local file system.
    async fn exists<P: AsRef<std::path::Path> + std::marker::Send + std::marker::Sync>(
        &self,
        path: P,
        source_range: SourceRange,
    ) -> Result<bool, crate::errors::KclError>;

    /// Get all the files in a directory recursively.
    async fn get_all_files<P: AsRef<std::path::Path> + std::marker::Send + std::marker::Sync>(
        &self,
        path: P,
        source_range: SourceRange,
    ) -> Result<Vec<std::path::PathBuf>, crate::errors::KclError>;
}
