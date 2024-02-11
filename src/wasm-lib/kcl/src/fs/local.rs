//! Functions for interacting with a file system locally.

use anyhow::Result;

use crate::{
    errors::{KclError, KclErrorDetails},
    fs::FileSystem,
};

#[derive(Debug, Clone)]
pub struct FileManager {}

impl FileManager {
    pub fn new() -> FileManager {
        FileManager {}
    }
}

impl Default for FileManager {
    fn default() -> Self {
        FileManager::new()
    }
}

#[async_trait::async_trait(?Send)]
impl FileSystem for FileManager {
    async fn read<P: AsRef<std::path::Path>>(
        &self,
        path: P,
        source_range: crate::executor::SourceRange,
    ) -> Result<Vec<u8>, KclError> {
        tokio::fs::read(&path).await.map_err(|e| {
            KclError::Engine(KclErrorDetails {
                message: format!("Failed to read file `{}`: {}", path.as_ref().display(), e),
                source_ranges: vec![source_range],
            })
        })
    }
}
