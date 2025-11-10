use std::sync::Arc;

use gloo_utils::format::JsValueSerdeExt;
use kcl_lib::{
    front::{
        Error, ExistingSegmentCtor, File, FileId, LifecycleApi, ObjectId, ProjectId, SegmentCtor, SketchApi,
        SketchApiStub, Version,
    },
    Program,
};
use wasm_bindgen::prelude::*;

use crate::{Context, TRUE_BUG};

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

    /// Set the current program AST and execute it. Temporary hack for
    /// development purposes only.
    #[wasm_bindgen]
    pub async fn hack_set_program(&self, program_ast_json: &str, settings: &str) -> Result<JsValue, JsValue> {
        console_error_panic_hook::set_once();

        let program: Program =
            serde_json::from_str(program_ast_json).map_err(|e| format!("Could not deserialize KCL AST: {e}"))?;

        let ctx = self
            .create_executor_ctx(settings, None, false)
            .map_err(|e| format!("Could not create KCL executor context for new sketch. {TRUE_BUG} Details: {e}"))?;

        let frontend = Arc::clone(&self.frontend);
        let mut guard = frontend.write().await;
        guard
            .hack_set_program(&ctx, program)
            .await
            .map_err(|e| format!("Failed to execute new program: {:?}", e))?;

        Ok(JsValue::undefined())
    }

    /// Create new sketch and enter sketch mode.
    #[wasm_bindgen]
    pub async fn new_sketch(
        &self,
        project_json: &str,
        file_json: &str,
        version_json: &str,
        args_json: &str,
        settings: &str,
    ) -> Result<JsValue, JsValue> {
        console_error_panic_hook::set_once();

        let project: kcl_lib::front::ProjectId =
            serde_json::from_str(project_json).map_err(|e| format!("Could not deserialize ProjectId: {e}"))?;
        let file: kcl_lib::front::FileId =
            serde_json::from_str(file_json).map_err(|e| format!("Could not deserialize FileId: {e}"))?;
        let version: kcl_lib::front::Version =
            serde_json::from_str(version_json).map_err(|e| format!("Could not deserialize Version: {e}"))?;
        let args: kcl_lib::front::SketchArgs =
            serde_json::from_str(args_json).map_err(|e| format!("Could not deserialize SketchArgs: {e}"))?;

        let ctx = self
            .create_executor_ctx(settings, None, true)
            .map_err(|e| format!("Could not create KCL executor context for new sketch. {TRUE_BUG} Details: {e}"))?;

        let frontend = Arc::clone(&self.frontend);
        let mut guard = frontend.write().await;
        let result = guard
            .new_sketch(&ctx, project, file, version, args)
            .await
            .map_err(|e| format!("Failed to create new sketch: {:?}", e))?;

        Ok(JsValue::from_serde(&result)
            .map_err(|e| format!("Could not serialize new sketch result. {TRUE_BUG} Details: {e}"))?)
    }

    /// Exit sketch mode.
    #[wasm_bindgen]
    pub async fn exit_sketch(&self, version_json: &str, sketch_json: &str, settings: &str) -> Result<JsValue, JsValue> {
        console_error_panic_hook::set_once();

        let version: kcl_lib::front::Version =
            serde_json::from_str(version_json).map_err(|e| format!("Could not deserialize Version: {e}"))?;
        let sketch: kcl_lib::front::ObjectId =
            serde_json::from_str(sketch_json).map_err(|e| format!("Could not deserialize ObjectId: {e}"))?;

        let ctx = self
            .create_executor_ctx(settings, None, false)
            .map_err(|e| format!("Could not create KCL executor context for exit sketch. {TRUE_BUG} Details: {e}"))?;

        let frontend = Arc::clone(&self.frontend);
        let mut guard = frontend.write().await;
        let result = guard
            .exit_sketch(&ctx, version, sketch)
            .await
            .map_err(|e| format!("Failed to exit sketch: {:?}", e))?;

        Ok(JsValue::from_serde(&result)
            .map_err(|e| format!("Could not serialize exit sketch result. {TRUE_BUG} Details: {e}"))?)
    }

    /// Add segment to sketch.
    #[wasm_bindgen]
    pub async fn add_segment(
        &self,
        version_json: &str,
        sketch_json: &str,
        segment_json: &str,
        label: Option<String>,
        settings: &str,
    ) -> Result<JsValue, JsValue> {
        console_error_panic_hook::set_once();

        let version: kcl_lib::front::Version =
            serde_json::from_str(version_json).map_err(|e| format!("Could not deserialize Version: {e}"))?;
        let sketch: kcl_lib::front::ObjectId =
            serde_json::from_str(sketch_json).map_err(|e| format!("Could not deserialize ObjectId: {e}"))?;
        let segment: kcl_lib::front::SegmentCtor =
            serde_json::from_str(segment_json).map_err(|e| format!("Could not deserialize SegmentCtor: {e}"))?;

        let ctx = self
            .create_executor_ctx(settings, None, true)
            .map_err(|e| format!("Could not create KCL executor context for add segment. {TRUE_BUG} Details: {e}"))?;

        let frontend = Arc::clone(&self.frontend);
        let mut guard = frontend.write().await;
        let result = guard
            .add_segment(&ctx, version, sketch, segment, label)
            .await
            .map_err(|e| format!("Failed to add segment to sketch: {:?}", e))?;

        Ok(JsValue::from_serde(&result)
            .map_err(|e| format!("Could not serialize add segment result. {TRUE_BUG} Details: {e}"))?)
    }

    #[wasm_bindgen]
    pub async fn add_segment_stub(
        &self,
        version: usize,
        sketch: usize,
        segment: &str,
        label: Option<String>,
        settings: &str,
    ) -> Result<JsValue, JsValue> {
        console_error_panic_hook::set_once();

        let segment: SegmentCtor = serde_json::from_str(segment)
            .map_err(|e| JsValue::from_serde(&Error::deserialize("segment", e)).unwrap())?;

        // For now, use the stub implementation
        let mut sketch_api = SketchApiStub;
        let ctx = self
            .create_executor_ctx(settings, None, true)
            .map_err(|e| format!("Could not create KCL executor context for add segment. {TRUE_BUG} Details: {e}"))?;
        let result = sketch_api
            .add_segment(&ctx, Version(version), ObjectId(sketch), segment, label)
            .await
            .map_err(|e: Error| JsValue::from_serde(&e).unwrap())?;

        Ok(JsValue::from_str(&serde_json::to_string(&result).unwrap()))
    }

    /// Edit segment in sketch.
    #[wasm_bindgen]
    pub async fn edit_segments(
        &self,
        version_json: &str,
        sketch_json: &str,
        segments_json: &str,
        settings: &str,
    ) -> Result<JsValue, JsValue> {
        console_error_panic_hook::set_once();

        let version: kcl_lib::front::Version =
            serde_json::from_str(version_json).map_err(|e| format!("Could not deserialize Version: {e}"))?;
        let sketch: kcl_lib::front::ObjectId =
            serde_json::from_str(sketch_json).map_err(|e| format!("Could not deserialize sketch ObjectId: {e}"))?;
        let segments: Vec<ExistingSegmentCtor> =
            serde_json::from_str(segments_json).map_err(|e| format!("Could not deserialize Segments: {e}"))?;

        let ctx = self
            .create_executor_ctx(settings, None, true)
            .map_err(|e| format!("Could not create KCL executor context for edit segment. {TRUE_BUG} Details: {e}"))?;

        let frontend = Arc::clone(&self.frontend);
        let mut guard = frontend.write().await;
        let result = guard
            .edit_segments(&ctx, version, sketch, segments)
            .await
            .map_err(|e| format!("Failed to edit segments in sketch: {:?}", e))?;

        Ok(JsValue::from_serde(&result)
            .map_err(|e| format!("Could not serialize edit segments result. {TRUE_BUG} Details: {e}"))?)
    }

    /// Delete segments in sketch.
    #[wasm_bindgen]
    pub async fn delete_segments(
        &self,
        version_json: &str,
        sketch_json: &str,
        segment_ids_json: &str,
        settings: &str,
    ) -> Result<JsValue, JsValue> {
        console_error_panic_hook::set_once();

        let version: kcl_lib::front::Version =
            serde_json::from_str(version_json).map_err(|e| format!("Could not deserialize Version: {e}"))?;
        let sketch: kcl_lib::front::ObjectId =
            serde_json::from_str(sketch_json).map_err(|e| format!("Could not deserialize sketch ObjectId: {e}"))?;
        let segment_ids: Vec<ObjectId> =
            serde_json::from_str(segment_ids_json).map_err(|e| format!("Could not deserialize Segment IDs: {e}"))?;

        let ctx = self
            .create_executor_ctx(settings, None, true)
            .map_err(|e| format!("Could not create KCL executor context for edit segment. {TRUE_BUG} Details: {e}"))?;

        let frontend = Arc::clone(&self.frontend);
        let mut guard = frontend.write().await;
        let result = guard
            .delete_segments(&ctx, version, sketch, segment_ids)
            .await
            .map_err(|e| format!("Failed to delete segments in sketch: {:?}", e))?;

        Ok(JsValue::from_serde(&result)
            .map_err(|e| format!("Could not serialize delete segments result. {TRUE_BUG} Details: {e}"))?)
    }

    /// Add a constraint to sketch.
    #[wasm_bindgen]
    pub async fn add_constraint(
        &self,
        version_json: &str,
        sketch_json: &str,
        constraint_json: &str,
        settings: &str,
    ) -> Result<JsValue, JsValue> {
        console_error_panic_hook::set_once();

        let version: kcl_lib::front::Version =
            serde_json::from_str(version_json).map_err(|e| format!("Could not deserialize Version: {e}"))?;
        let sketch: kcl_lib::front::ObjectId =
            serde_json::from_str(sketch_json).map_err(|e| format!("Could not deserialize ObjectId: {e}"))?;
        let constraint: kcl_lib::front::Constraint =
            serde_json::from_str(constraint_json).map_err(|e| format!("Could not deserialize ConstraintCtor: {e}"))?;

        let ctx = self.create_executor_ctx(settings, None, true).map_err(|e| {
            format!("Could not create KCL executor context for add constraint. {TRUE_BUG} Details: {e}")
        })?;

        let frontend = Arc::clone(&self.frontend);
        let mut guard = frontend.write().await;
        let result = guard
            .add_constraint(&ctx, version, sketch, constraint)
            .await
            .map_err(|e| format!("Failed to add constraint to sketch: {:?}", e))?;

        Ok(JsValue::from_serde(&result)
            .map_err(|e| format!("Could not serialize add constraint result. {TRUE_BUG} Details: {e}"))?)
    }
}
