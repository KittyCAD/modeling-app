//! Functions for interacting with a file system locally.

use anyhow::Result;

use crate::{
    errors::{KclError, KclErrorDetails},
    fs::FileSystem,
    SourceRange,
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

#[async_trait::async_trait]
impl FileSystem for FileManager {
    async fn read<P: AsRef<std::path::Path> + std::marker::Send + std::marker::Sync>(
        &self,
        path: P,
        source_range: SourceRange,
    ) -> Result<Vec<u8>, KclError> {
        tokio::fs::read(&path).await.map_err(|e| {
            KclError::Io(KclErrorDetails {
                message: format!("Failed to read file `{}`: {}", path.as_ref().display(), e),
                source_ranges: vec![source_range],
            })
        })
    }

    async fn read_to_string<P: AsRef<std::path::Path> + std::marker::Send + std::marker::Sync>(
        &self,
        path: P,
        source_range: SourceRange,
    ) -> Result<String, KclError> {
        tokio::fs::read_to_string(&path).await.map_err(|e| {
            KclError::Io(KclErrorDetails {
                message: format!("Failed to read file `{}`: {}", path.as_ref().display(), e),
                source_ranges: vec![source_range],
            })
        })
    }

    async fn exists<P: AsRef<std::path::Path> + std::marker::Send + std::marker::Sync>(
        &self,
        path: P,
        source_range: SourceRange,
    ) -> Result<bool, crate::errors::KclError> {
        tokio::fs::metadata(&path).await.map(|_| true).or_else(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                Ok(false)
            } else {
                Err(KclError::Io(KclErrorDetails {
                    message: format!("Failed to check if file `{}` exists: {}", path.as_ref().display(), e),
                    source_ranges: vec![source_range],
                }))
            }
        })
    }

    async fn get_all_files<P: AsRef<std::path::Path> + std::marker::Send + std::marker::Sync>(
        &self,
        path: P,
        source_range: SourceRange,
    ) -> Result<Vec<std::path::PathBuf>, crate::errors::KclError> {
        let mut files = vec![];
        let mut stack = vec![path.as_ref().to_path_buf()];

        while let Some(path) = stack.pop() {
            if !path.is_dir() {
                continue;
            }

            let mut read_dir = tokio::fs::read_dir(&path).await.map_err(|e| {
                KclError::Io(KclErrorDetails {
                    message: format!("Failed to read directory `{}`: {}", path.display(), e),
                    source_ranges: vec![source_range],
                })
            })?;

            while let Ok(Some(entry)) = read_dir.next_entry().await {
                let path = entry.path();
                if path.is_dir() {
                    // Iterate over the directory.
                    stack.push(path);
                } else {
                    files.push(path);
                }
            }
        }

        Ok(files)
    }
}
