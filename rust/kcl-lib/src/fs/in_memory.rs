use ahash::HashMap;
use async_trait::async_trait;
use kcl_error::{KclError, KclErrorDetails, SourceRange};

use crate::TypedPath;

#[derive(Clone, Eq, PartialEq)]
pub struct InMemoryFiles {
    files: HashMap<String, Vec<u8>>,
}

impl InMemoryFiles {
    pub fn new(files: HashMap<String, Vec<u8>>) -> Self {
        Self { files }
    }
}

impl std::fmt::Debug for InMemoryFiles {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let filenames: Vec<_> = self.files.keys().collect();
        f.debug_struct("InMemoryFiles").field("files", &filenames).finish()
    }
}

#[async_trait]
impl crate::fs::FileSystem for InMemoryFiles {
    async fn read(&self, path: &TypedPath, source_range: SourceRange) -> Result<Vec<u8>, KclError> {
        let path_str = path.to_string();
        let bytes = self.files.get(&path_str).ok_or_else(|| {
            KclError::new_io(KclErrorDetails::new(
                format!("No such file {} found", path.display()),
                vec![source_range],
            ))
        })?;
        Ok(bytes.to_owned())
    }

    async fn read_to_string(&self, path: &TypedPath, source_range: SourceRange) -> Result<String, KclError> {
        let bytes = self.read(path, source_range).await?;
        String::from_utf8(bytes).map_err(|err| {
            KclError::new_io(KclErrorDetails::new(
                format!("File {} had invalid UTF-8 bytes: {err}", path.display()),
                vec![source_range],
            ))
        })
    }

    async fn exists(&self, path: &TypedPath, _source_range: SourceRange) -> Result<bool, crate::errors::KclError> {
        Ok(self.files.contains_key(&path.to_string()))
    }

    async fn get_all_files(
        &self,
        base_path: &TypedPath,
        _source_range: SourceRange,
    ) -> Result<Vec<TypedPath>, crate::errors::KclError> {
        let all_files = self
            .files
            .keys()
            .map(|filename| TypedPath::new(filename))
            .filter(|file| file.starts_with(&base_path.to_string()))
            .collect();
        Ok(all_files)
    }
}
