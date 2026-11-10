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
        Self {
            files: files
                .into_iter()
                .map(|(path, bytes)| (normalize(&path), bytes))
                .collect(),
        }
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
        let path_str = normalize(&path.to_string());
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
        Ok(self.files.contains_key(&normalize(&path.to_string())))
    }

    async fn get_all_files(
        &self,
        base_path: &TypedPath,
        _source_range: SourceRange,
    ) -> Result<Vec<TypedPath>, crate::errors::KclError> {
        let base_path = TypedPath::new(&normalize(&base_path.to_string()));
        let all_files = self
            .files
            .keys()
            .map(|filename| TypedPath::new(filename))
            .filter(|file| file.starts_with(&base_path))
            .collect();
        Ok(all_files)
    }
}

fn normalize(path: &str) -> String {
    let path = typed_path::TypedPath::derive(path);
    let mut output_components: Vec<typed_path::TypedComponent<'_>> = Vec::new();
    for component in path.components() {
        if component.is_current() {
            continue;
        }
        if component.is_parent() {
            if output_components.last().is_some_and(|last| last.is_normal()) {
                output_components.pop();
                continue;
            }
            if path.is_absolute() {
                continue;
            }
        }
        output_components.push(component);
    }
    let mut normalized = path.to_path_buf();
    normalized.clear();
    for component in output_components {
        normalized.push(component.as_bytes());
    }
    normalized.to_string_lossy().into_owned()
}

#[cfg(test)]
mod tests {
    use ahash::HashMap;
    use kcl_error::SourceRange;
    use kittycad_modeling_cmds::shared::safe_filepath::SafeFilepath;

    use super::InMemoryFiles;
    use super::normalize;
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

    #[test]
    fn normalize_resolves_parent_relative_asset_from_safe_uploaded_paths() {
        // sub/main.kcl imports "../cube.step", while both uploaded filenames
        // satisfy the API's restriction against parent directory components.
        let entrypoint = SafeFilepath::validate("sub/main.kcl").unwrap();
        let asset = SafeFilepath::validate("cube.step").unwrap();
        let import_path = typed_path::UnixPath::new(&entrypoint.to_string())
            .parent()
            .unwrap()
            .join("../cube.step")
            .to_string_lossy()
            .into_owned();

        assert_eq!(import_path, "sub/../cube.step");
        SafeFilepath::validate(&import_path).unwrap_err();
        assert_eq!(normalize(&import_path), asset.to_string());
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
    async fn resolves_relative_import_components() {
        let fs = files(&[("part.kcl", b"part = 1"), ("./sub/shape.kcl", b"shape = 2")]);
        let range = SourceRange::synthetic();
        assert_eq!(
            fs.read(&TypedPath::new("sub/../part.kcl"), range).await.unwrap(),
            b"part = 1"
        );
        assert!(fs.exists(&TypedPath::new("./sub/shape.kcl"), range).await.unwrap());
        assert!(!fs.exists(&TypedPath::new("../part.kcl"), range).await.unwrap());
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
