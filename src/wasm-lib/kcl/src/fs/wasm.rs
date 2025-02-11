//! Functions for interacting with a file system via wasm.

use anyhow::Result;
use wasm_bindgen::prelude::wasm_bindgen;

use crate::{
    errors::{KclError, KclErrorDetails},
    fs::FileSystem,
    wasm::JsFuture,
    SourceRange,
};

#[wasm_bindgen(module = "/../../lang/std/fileSystemManager.ts")]
extern "C" {
    #[derive(Debug, Clone)]
    pub type FileSystemManager;

    #[wasm_bindgen(method, js_name = readFile, catch)]
    fn read_file(this: &FileSystemManager, path: String) -> Result<js_sys::Promise, js_sys::Error>;

    #[wasm_bindgen(method, js_name = exists, catch)]
    fn exists(this: &FileSystemManager, path: String) -> Result<js_sys::Promise, js_sys::Error>;

    #[wasm_bindgen(method, js_name = getAllFiles, catch)]
    fn get_all_files(this: &FileSystemManager, path: String) -> Result<js_sys::Promise, js_sys::Error>;
}

#[derive(Debug, Clone)]
pub struct FileManager {
    manager: FileSystemManager,
}

impl FileManager {
    pub fn new(manager: FileSystemManager) -> FileManager {
        FileManager { manager }
    }
}

unsafe impl Send for FileManager {}
unsafe impl Sync for FileManager {}

#[async_trait::async_trait]
impl FileSystem for FileManager {
    async fn read<P: AsRef<std::path::Path> + std::marker::Send + std::marker::Sync>(
        &self,
        path: P,
        source_range: SourceRange,
    ) -> Result<Vec<u8>, KclError> {
        let promise = self
            .manager
            .read_file(
                path.as_ref()
                    .to_str()
                    .ok_or_else(|| {
                        KclError::Engine(KclErrorDetails {
                            message: "Failed to convert path to string".to_string(),
                            source_ranges: vec![source_range],
                        })
                    })?
                    .to_string(),
            )
            .map_err(|e| {
                KclError::Engine(KclErrorDetails {
                    message: e.to_string().into(),
                    source_ranges: vec![source_range],
                })
            })?;

        let value = JsFuture::from(promise).await.map_err(|e| {
            KclError::Engine(KclErrorDetails {
                message: format!("Failed to wait for promise from engine: {:?}", e),
                source_ranges: vec![source_range],
            })
        })?;

        let array = js_sys::Uint8Array::new(&value);
        let bytes: Vec<u8> = array.to_vec();

        Ok(bytes)
    }

    async fn read_to_string<P: AsRef<std::path::Path> + std::marker::Send + std::marker::Sync>(
        &self,
        path: P,
        source_range: SourceRange,
    ) -> Result<String, KclError> {
        let bytes = self.read(path, source_range).await?;
        let string = String::from_utf8(bytes).map_err(|e| {
            KclError::Engine(KclErrorDetails {
                message: format!("Failed to convert bytes to string: {:?}", e),
                source_ranges: vec![source_range],
            })
        })?;

        Ok(string)
    }

    async fn exists<P: AsRef<std::path::Path> + std::marker::Send + std::marker::Sync>(
        &self,
        path: P,
        source_range: SourceRange,
    ) -> Result<bool, crate::errors::KclError> {
        let promise = self
            .manager
            .exists(
                path.as_ref()
                    .to_str()
                    .ok_or_else(|| {
                        KclError::Engine(KclErrorDetails {
                            message: "Failed to convert path to string".to_string(),
                            source_ranges: vec![source_range],
                        })
                    })?
                    .to_string(),
            )
            .map_err(|e| {
                KclError::Engine(KclErrorDetails {
                    message: e.to_string().into(),
                    source_ranges: vec![source_range],
                })
            })?;

        let value = JsFuture::from(promise).await.map_err(|e| {
            KclError::Engine(KclErrorDetails {
                message: format!("Failed to wait for promise from engine: {:?}", e),
                source_ranges: vec![source_range],
            })
        })?;

        let it_exists = value.as_bool().ok_or_else(|| {
            KclError::Engine(KclErrorDetails {
                message: "Failed to convert value to bool".to_string(),
                source_ranges: vec![source_range],
            })
        })?;

        Ok(it_exists)
    }

    async fn get_all_files<P: AsRef<std::path::Path> + std::marker::Send + std::marker::Sync>(
        &self,
        path: P,
        source_range: SourceRange,
    ) -> Result<Vec<std::path::PathBuf>, crate::errors::KclError> {
        let promise = self
            .manager
            .get_all_files(
                path.as_ref()
                    .to_str()
                    .ok_or_else(|| {
                        KclError::Engine(KclErrorDetails {
                            message: "Failed to convert path to string".to_string(),
                            source_ranges: vec![source_range],
                        })
                    })?
                    .to_string(),
            )
            .map_err(|e| {
                KclError::Engine(KclErrorDetails {
                    message: e.to_string().into(),
                    source_ranges: vec![source_range],
                })
            })?;

        let value = JsFuture::from(promise).await.map_err(|e| {
            KclError::Engine(KclErrorDetails {
                message: format!("Failed to wait for promise from javascript: {:?}", e),
                source_ranges: vec![source_range],
            })
        })?;

        let s = value.as_string().ok_or_else(|| {
            KclError::Engine(KclErrorDetails {
                message: format!("Failed to get string from response from javascript: `{:?}`", value),
                source_ranges: vec![source_range],
            })
        })?;

        let files: Vec<String> = serde_json::from_str(&s).map_err(|e| {
            KclError::Engine(KclErrorDetails {
                message: format!("Failed to parse json from javascript: `{}` `{:?}`", s, e),
                source_ranges: vec![source_range],
            })
        })?;

        Ok(files.into_iter().map(std::path::PathBuf::from).collect())
    }
}
