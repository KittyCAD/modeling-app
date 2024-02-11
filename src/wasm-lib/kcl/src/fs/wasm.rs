//! Functions for interacting with a file system via wasm.

use anyhow::Result;
use wasm_bindgen::prelude::wasm_bindgen;

use crate::{
    errors::{KclError, KclErrorDetails},
    fs::FileSystem,
};

#[wasm_bindgen(module = "/../../lang/std/fileSystemManager.ts")]
extern "C" {
    #[wasm_bindgen( js_name = readFile)]
    fn read_file(path: String) -> js_sys::Promise;
}

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
        let promise = read_file(
            path.as_ref()
                .to_str()
                .ok_or_else(|| {
                    KclError::Engine(KclErrorDetails {
                        message: "Failed to convert path to string".to_string(),
                        source_ranges: vec![source_range],
                    })
                })?
                .to_string(),
        );

        let value = wasm_bindgen_futures::JsFuture::from(promise).await.map_err(|e| {
            KclError::Engine(KclErrorDetails {
                message: format!("Failed to wait for promise from engine: {:?}", e),
                source_ranges: vec![source_range],
            })
        })?;

        let array = js_sys::Uint8Array::new(&value);
        let bytes: Vec<u8> = array.to_vec();

        Ok(bytes)
    }
}
