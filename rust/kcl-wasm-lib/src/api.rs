use gloo_utils::format::JsValueSerdeExt;
use kcl_api::sketch::{SegmentCtor, SketchApi, SketchApiStub, SketchExecOutcome};
use kcl_api::{Error, File, FileId, KclSource, LifecycleApi, ObjectId, ProjectId, Version};
use wasm_bindgen::prelude::*;

use crate::Context;

#[wasm_bindgen]
impl Context {
    #[wasm_bindgen]
    pub async fn open_project(&self, project: usize, files: &str, open_file: usize) -> Result<(), JsValue> {
        console_error_panic_hook::set_once();

        let files: Vec<File> =
            serde_json::from_str(files).map_err(|e| JsValue::from_serde(&Error::deserialize("files", e)).unwrap())?;

        self.project_manager
            .open_project(ProjectId(project), files, FileId(open_file))
            .await
            .map_err(|e: Error| JsValue::from_serde(&e).unwrap())
    }

    #[wasm_bindgen]
    pub async fn add_file(&self, project: usize, file: &str) -> Result<(), JsValue> {
        console_error_panic_hook::set_once();

        let file: File =
            serde_json::from_str(file).map_err(|e| JsValue::from_serde(&Error::deserialize("file", e)).unwrap())?;

        self.project_manager
            .add_file(ProjectId(project), file)
            .await
            .map_err(|e: Error| JsValue::from_serde(&e).unwrap())
    }

    #[wasm_bindgen]
    pub async fn remove_file(&self, project: usize, file: usize) -> Result<(), JsValue> {
        console_error_panic_hook::set_once();

        self.project_manager
            .remove_file(ProjectId(project), FileId(file))
            .await
            .map_err(|e: Error| JsValue::from_serde(&e).unwrap())
    }

    #[wasm_bindgen]
    pub async fn update_file(&self, project: usize, file: usize, text: String) -> Result<(), JsValue> {
        console_error_panic_hook::set_once();

        self.project_manager
            .update_file(ProjectId(project), FileId(file), text)
            .await
            .map_err(|e: Error| JsValue::from_serde(&e).unwrap())
    }

    #[wasm_bindgen]
    pub async fn switch_file(&self, project: usize, file: usize) -> Result<(), JsValue> {
        console_error_panic_hook::set_once();

        self.project_manager
            .switch_file(ProjectId(project), FileId(file))
            .await
            .map_err(|e: Error| JsValue::from_serde(&e).unwrap())
    }

    #[wasm_bindgen]
    pub async fn refresh(&self, project: usize) -> Result<(), JsValue> {
        console_error_panic_hook::set_once();

        self.project_manager
            .refresh(ProjectId(project))
            .await
            .map_err(|e: Error| JsValue::from_serde(&e).unwrap())
    }

    #[wasm_bindgen]
    pub async fn add_segment(
        &self,
        version: usize,
        sketch: usize,
        segment: &str,
        label: Option<String>,
    ) -> Result<JsValue, JsValue> {
        console_error_panic_hook::set_once();

        let segment: SegmentCtor = serde_json::from_str(segment)
            .map_err(|e| JsValue::from_serde(&Error::deserialize("segment", e)).unwrap())?;

        // For now, use the stub implementation
        let sketch_api = SketchApiStub;
        let result: (KclSource, SketchExecOutcome) = sketch_api
            .add_segment(Version(version), ObjectId(sketch), segment, label)
            .await
            .map_err(|e: Error| JsValue::from_serde(&e).unwrap())?;

        Ok(JsValue::from_str(&serde_json::to_string(&result).unwrap()))
    }
}
