//! Functions for interacting with a file system locally.

use anyhow::Result;

use crate::{
    SourceRange,
    errors::{KclError, KclErrorDetails},
    execution::typed_path::TypedPath,
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

#[async_trait::async_trait]
impl FileSystem for FileManager {
    async fn read(&self, path: &TypedPath, source_range: SourceRange) -> Result<Vec<u8>, KclError> {
        tokio::fs::read(&path.0).await.map_err(|e| {
            KclError::new_io(KclErrorDetails::new(
                format!("Failed to read file `{}`: {}", path.display(), e),
                vec![source_range],
            ))
        })
    }

    async fn read_to_string(&self, path: &TypedPath, source_range: SourceRange) -> Result<String, KclError> {
        tokio::fs::read_to_string(&path.0).await.map_err(|e| {
            KclError::new_io(KclErrorDetails::new(
                format!("Failed to read file `{}`: {}", path.display(), e),
                vec![source_range],
            ))
        })
    }

    async fn exists(&self, path: &TypedPath, source_range: SourceRange) -> Result<bool, crate::errors::KclError> {
        tokio::fs::metadata(&path.0).await.map(|_| true).or_else(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                Ok(false)
            } else {
                Err(KclError::new_io(KclErrorDetails::new(
                    format!("Failed to check if file `{}` exists: {}", path.display(), e),
                    vec![source_range],
                )))
            }
        })
    }

    async fn get_all_files(
        &self,
        path: &TypedPath,
        source_range: SourceRange,
    ) -> Result<Vec<TypedPath>, crate::errors::KclError> {
        let mut files = vec![];
        let mut stack = vec![path.0.to_path_buf()];

        while let Some(path) = stack.pop() {
            if !path.is_dir() {
                continue;
            }

            let mut read_dir = tokio::fs::read_dir(&path).await.map_err(|e| {
                KclError::new_io(KclErrorDetails::new(
                    format!("Failed to read directory `{}`: {}", path.display(), e),
                    vec![source_range],
                ))
            })?;

            while let Ok(Some(entry)) = read_dir.next_entry().await {
                let path = entry.path();
                if path.is_dir() {
                    // Iterate over the directory.
                    stack.push(path);
                } else {
                    files.push(TypedPath(path));
                }
            }
        }

        Ok(files)
    }
}
