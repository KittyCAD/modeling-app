//! Functions for interacting with files on a machine.

use std::sync::Arc;

use anyhow::Result;

use crate::SourceRange;
use crate::execution::typed_path::TypedPath;

pub mod in_memory;
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

pub type FileSystemHandle = Arc<Box<dyn FileSystem>>;

pub fn new_file_system_handle<T>(fs: T) -> FileSystemHandle
where
    T: FileSystem + 'static,
{
    Arc::new(Box::new(fs) as Box<dyn FileSystem>)
}

#[async_trait::async_trait]
pub trait FileSystem: Send + Sync {
    /// Read a file from the local file system.
    async fn read(&self, path: &TypedPath, source_range: SourceRange) -> Result<Vec<u8>, crate::errors::KclError>;

    /// Read a file from the local file system.
    async fn read_to_string(
        &self,
        path: &TypedPath,
        source_range: SourceRange,
    ) -> Result<String, crate::errors::KclError>;

    /// Check if a file exists on the local file system.
    async fn exists(&self, path: &TypedPath, source_range: SourceRange) -> Result<bool, crate::errors::KclError>;

    /// Get all the files in a directory recursively.
    async fn get_all_files(
        &self,
        path: &TypedPath,
        source_range: SourceRange,
    ) -> Result<Vec<TypedPath>, crate::errors::KclError>;
}
