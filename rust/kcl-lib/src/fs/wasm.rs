//! Functions for interacting with a file system via wasm.

use anyhow::Result;
use wasm_bindgen::prelude::wasm_bindgen;

use crate::{
    SourceRange,
    errors::{KclError, KclErrorDetails},
    execution::typed_path::TypedPath,
    fs::FileSystem,
    wasm::JsFuture,
};

#[wasm_bindgen(module = "/../../src/lang/std/fileSystemManager.ts")]
extern "C" {
    #[derive(Debug, Clone)]
    pub type FileSystemManager;

    #[wasm_bindgen(constructor)]
    pub fn new() -> FileSystemManager;

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
    async fn read(&self, path: &TypedPath, source_range: SourceRange) -> Result<Vec<u8>, KclError> {
        let promise = self
            .manager
            .read_file(path.to_string_lossy())
            .map_err(|e| KclError::new_engine(KclErrorDetails::new(e.to_string().into(), vec![source_range])))?;

        let value = JsFuture::from(promise).await.map_err(|e| {
            KclError::new_engine(KclErrorDetails::new(
                format!("Failed to wait for promise from engine: {:?}", e),
                vec![source_range],
            ))
        })?;

        let array = js_sys::Uint8Array::new(&value);
        let bytes: Vec<u8> = array.to_vec();

        Ok(bytes)
    }

    async fn read_to_string(&self, path: &TypedPath, source_range: SourceRange) -> Result<String, KclError> {
        let bytes = self.read(path, source_range).await?;
        let string = String::from_utf8(bytes).map_err(|e| {
            KclError::new_engine(KclErrorDetails::new(
                format!("Failed to convert bytes to string: {:?}", e),
                vec![source_range],
            ))
        })?;

        Ok(string)
    }

    async fn exists(&self, path: &TypedPath, source_range: SourceRange) -> Result<bool, crate::errors::KclError> {
        let promise = self
            .manager
            .exists(path.to_string_lossy())
            .map_err(|e| KclError::new_engine(KclErrorDetails::new(e.to_string().into(), vec![source_range])))?;

        let value = JsFuture::from(promise).await.map_err(|e| {
            KclError::new_engine(KclErrorDetails::new(
                format!("Failed to wait for promise from engine: {:?}", e),
                vec![source_range],
            ))
        })?;

        let it_exists = value.as_bool().ok_or_else(|| {
            KclError::new_engine(KclErrorDetails::new(
                "Failed to convert value to bool".to_string(),
                vec![source_range],
            ))
        })?;

        Ok(it_exists)
    }

    async fn get_all_files(
        &self,
        path: &TypedPath,
        source_range: SourceRange,
    ) -> Result<Vec<TypedPath>, crate::errors::KclError> {
        let promise = self
            .manager
            .get_all_files(path.to_string_lossy())
            .map_err(|e| KclError::new_engine(KclErrorDetails::new(e.to_string().into(), vec![source_range])))?;

        let value = JsFuture::from(promise).await.map_err(|e| {
            KclError::new_engine(KclErrorDetails::new(
                format!("Failed to wait for promise from javascript: {:?}", e),
                vec![source_range],
            ))
        })?;

        let s = value.as_string().ok_or_else(|| {
            KclError::new_engine(KclErrorDetails::new(
                format!("Failed to get string from response from javascript: `{:?}`", value),
                vec![source_range],
            ))
        })?;

        let files: Vec<String> = serde_json::from_str(&s).map_err(|e| {
            KclError::new_engine(KclErrorDetails::new(
                format!("Failed to parse json from javascript: `{}` `{:?}`", s, e),
                vec![source_range],
            ))
        })?;

        Ok(files.into_iter().map(|s| TypedPath::from(&s)).collect())
    }
}
