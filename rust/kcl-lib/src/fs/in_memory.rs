use ahash::HashMap;
use async_trait::async_trait;
use kcl_error::KclError;
use kcl_error::KclErrorDetails;
use kcl_error::SourceRange;

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
            .filter(|file| file.starts_with(base_path))
            .collect();
        Ok(all_files)
    }
}

#[cfg(test)]
mod tests {
    use ahash::HashMap;
    use kcl_error::SourceRange;

    use super::InMemoryFiles;
    use crate::TypedPath;
    use crate::fs::FileSystem;

    fn files(entries: &[(&str, &[u8])]) -> InMemoryFiles {
        InMemoryFiles::new(
            entries
                .iter()
                .map(|(path, bytes)| ((*path).to_owned(), (*bytes).to_vec()))
                .collect::<HashMap<_, _>>(),
        )
    }

    #[tokio::test]
    async fn reads_existing_file_as_bytes_and_string() {
        let fs = files(&[("/project/main.kcl", b"part = 1")]);
        let path = TypedPath::new("/project/main.kcl");

        assert_eq!(
            fs.read(&path, SourceRange::default()).await.unwrap(),
            b"part = 1".to_vec()
        );
        assert_eq!(
            fs.read_to_string(&path, SourceRange::default()).await.unwrap(),
            "part = 1"
        );
    }

    #[tokio::test]
    async fn reports_file_existence() {
        let fs = files(&[("/project/main.kcl", b"part = 1")]);

        assert!(
            fs.exists(&TypedPath::new("/project/main.kcl"), SourceRange::default())
                .await
                .unwrap()
        );
        assert!(
            !fs.exists(&TypedPath::new("/project/missing.kcl"), SourceRange::default())
                .await
                .unwrap()
        );
    }

    #[tokio::test]
    async fn read_errors_when_file_is_missing() {
        let fs = files(&[]);

        let err = fs
            .read(&TypedPath::new("/project/missing.kcl"), SourceRange::default())
            .await
            .unwrap_err();

        assert!(err.to_string().contains("No such file /project/missing.kcl found"));
    }

    #[tokio::test]
    async fn read_to_string_errors_when_file_is_not_utf8() {
        let fs = files(&[("/project/binary.kcl", &[0xff, 0xfe])]);

        let err = fs
            .read_to_string(&TypedPath::new("/project/binary.kcl"), SourceRange::default())
            .await
            .unwrap_err();

        assert!(
            err.to_string()
                .contains("File /project/binary.kcl had invalid UTF-8 bytes")
        );
    }

    #[tokio::test]
    async fn get_all_files_returns_files_under_base_path() {
        let fs = files(&[
            ("/project/main.kcl", b"main"),
            ("/project/sub/part.kcl", b"part"),
            ("/projectile/not-project.kcl", b"outside"),
            ("/other/file.kcl", b"other"),
        ]);

        let mut files = fs
            .get_all_files(&TypedPath::new("/project"), SourceRange::default())
            .await
            .unwrap()
            .into_iter()
            .map(|path| path.to_string())
            .collect::<Vec<_>>();
        files.sort();

        assert_eq!(files, vec!["/project/main.kcl", "/project/sub/part.kcl"]);
    }
}
