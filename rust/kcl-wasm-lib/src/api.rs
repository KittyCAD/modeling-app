use std::sync::Arc;

use gloo_utils::format::JsValueSerdeExt;
use kcl_lib::{
    front::{Error, ExistingSegmentCtor, File, FileId, LifecycleApi, ObjectId, ProjectId, SketchApi, Version},
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
        let result = guard
            .hack_set_program(&ctx, program)
            .await
            .map_err(|e| format!("Failed to execute new program: {:?}", e))?;

        Ok(JsValue::from_serde(&result)
            .map_err(|e| format!("Could not serialize hack set program result. {TRUE_BUG} Details: {e}"))?)
    }

    /// Execute the sketch in mock mode, without changing anything. This is
    /// useful after editing segments, and the user releases the mouse button.
    #[wasm_bindgen]
    pub async fn sketch_execute_mock(
        &self,
        version_json: &str,
        sketch_json: &str,
        settings: &str,
    ) -> Result<JsValue, JsValue> {
        console_error_panic_hook::set_once();

        let version: Version =
            serde_json::from_str(version_json).map_err(|e| format!("Could not deserialize Version: {e}"))?;
        let sketch: ObjectId =
            serde_json::from_str(sketch_json).map_err(|e| format!("Could not deserialize ObjectId: {e}"))?;

        let ctx = self
            .create_executor_ctx(settings, None, true)
            .map_err(|e| format!("Could not create KCL executor context for new sketch. {TRUE_BUG} Details: {e}"))?;

        let frontend = Arc::clone(&self.frontend);
        let mut guard = frontend.write().await;
        let result = guard
            .execute_mock(&ctx, version, sketch)
            .await
            .map_err(|e| format!("Failed to execute mock: {:?}", e))?;

        Ok(JsValue::from_serde(&result)
            .map_err(|e| format!("Could not serialize execute mock result. {TRUE_BUG} Details: {e}"))?)
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
        let args: kcl_lib::front::SketchCtor =
            serde_json::from_str(args_json).map_err(|e| format!("Could not deserialize SketchCtor: {e}"))?;

        let ctx = self
            .create_executor_ctx(settings, None, false)
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

    /// Enter sketch mode for an existing sketch.
    #[wasm_bindgen]
    pub async fn edit_sketch(
        &self,
        project_json: &str,
        file_json: &str,
        version_json: &str,
        sketch_json: &str,
        settings: &str,
    ) -> Result<JsValue, JsValue> {
        console_error_panic_hook::set_once();

        let project: kcl_lib::front::ProjectId =
            serde_json::from_str(project_json).map_err(|e| format!("Could not deserialize ProjectId: {e}"))?;
        let file: kcl_lib::front::FileId =
            serde_json::from_str(file_json).map_err(|e| format!("Could not deserialize FileId: {e}"))?;
        let version: kcl_lib::front::Version =
            serde_json::from_str(version_json).map_err(|e| format!("Could not deserialize Version: {e}"))?;
        let sketch: kcl_lib::front::ObjectId =
            serde_json::from_str(sketch_json).map_err(|e| format!("Could not deserialize sketch ObjectId: {e}"))?;

        let ctx = self
            .create_executor_ctx(settings, None, true)
            .map_err(|e| format!("Could not create KCL executor context for edit sketch. {TRUE_BUG} Details: {e}"))?;

        let frontend = Arc::clone(&self.frontend);
        let mut guard = frontend.write().await;
        let result = guard
            .edit_sketch(&ctx, project, file, version, sketch)
            .await
            .map_err(|e| format!("Failed to edit sketch: {:?}", e))?;

        Ok(JsValue::from_serde(&result)
            .map_err(|e| format!("Could not serialize edit sketch result. {TRUE_BUG} Details: {e}"))?)
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

    /// Delete sketch.
    #[wasm_bindgen]
    pub async fn delete_sketch(
        &self,
        version_json: &str,
        sketch_json: &str,
        settings: &str,
    ) -> Result<JsValue, JsValue> {
        console_error_panic_hook::set_once();

        let version: Version =
            serde_json::from_str(version_json).map_err(|e| format!("Could not deserialize Version: {e}"))?;
        let sketch: ObjectId =
            serde_json::from_str(sketch_json).map_err(|e| format!("Could not deserialize sketch ObjectId: {e}"))?;

        let ctx = self
            .create_executor_ctx(settings, None, false)
            .map_err(|e| format!("Could not create KCL executor context for delete sketch. {TRUE_BUG} Details: {e}"))?;

        let frontend = Arc::clone(&self.frontend);
        let mut guard = frontend.write().await;
        let result = guard
            .delete_sketch(&ctx, version, sketch)
            .await
            .map_err(|e| format!("Failed to delete sketch: {:?}", e))?;

        Ok(JsValue::from_serde(&result)
            .map_err(|e| format!("Could not serialize delete sketch result. {TRUE_BUG} Details: {e}"))?)
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

    /// Delete segments and constraints in sketch.
    #[wasm_bindgen]
    pub async fn delete_objects(
        &self,
        version_json: &str,
        sketch_json: &str,
        constraint_ids_json: &str,
        segment_ids_json: &str,
        settings: &str,
    ) -> Result<JsValue, JsValue> {
        console_error_panic_hook::set_once();

        let version: kcl_lib::front::Version =
            serde_json::from_str(version_json).map_err(|e| format!("Could not deserialize Version: {e}"))?;
        let sketch: kcl_lib::front::ObjectId =
            serde_json::from_str(sketch_json).map_err(|e| format!("Could not deserialize sketch ObjectId: {e}"))?;
        let constraint_ids: Vec<ObjectId> =
            serde_json::from_str(constraint_ids_json).map_err(|e| format!("Could not deserialize Segment IDs: {e}"))?;
        let segment_ids: Vec<ObjectId> =
            serde_json::from_str(segment_ids_json).map_err(|e| format!("Could not deserialize Segment IDs: {e}"))?;

        let ctx = self
            .create_executor_ctx(settings, None, true)
            .map_err(|e| format!("Could not create KCL executor context for edit segment. {TRUE_BUG} Details: {e}"))?;

        let frontend = Arc::clone(&self.frontend);
        let mut guard = frontend.write().await;
        let result = guard
            .delete_objects(&ctx, version, sketch, constraint_ids, segment_ids)
            .await
            .map_err(|e| format!("Failed to delete objects in sketch: {:?}", e))?;

        Ok(JsValue::from_serde(&result)
            .map_err(|e| format!("Could not serialize delete objects result. {TRUE_BUG} Details: {e}"))?)
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

    /// Batch operations for split segment: edit segments, add constraints, delete objects.
    /// All operations are applied to a single AST and execute_after_edit is called once at the end.
    /// Execute trim operations on a sketch.
    /// This runs the full trim loop internally, executing all trim operations.
    #[wasm_bindgen]
    pub async fn execute_trim(
        &self,
        version_json: &str,
        sketch_json: &str,
        points_json: &str,
        settings: &str,
    ) -> Result<JsValue, JsValue> {
        console_error_panic_hook::set_once();
        let version: kcl_lib::front::Version =
            serde_json::from_str(version_json).map_err(|e| format!("Could not deserialize Version: {e}"))?;
        let sketch: kcl_lib::front::ObjectId =
            serde_json::from_str(sketch_json).map_err(|e| format!("Could not deserialize ObjectId: {e}"))?;
        let points: Vec<crate::trim::Coords2d> =
            serde_json::from_str(points_json).map_err(|e| format!("Could not deserialize points: {e}"))?;

        let ctx = self
            .create_executor_ctx(settings, None, true)
            .map_err(|e| format!("Could not create KCL executor context for trim. {TRUE_BUG} Details: {e}"))?;

        let frontend = Arc::clone(&self.frontend);
        let mut guard = frontend.write().await;

        // Import trim function from kcl-lib
        use kcl_lib::front::{execute_trim_loop_with_context, Coords2d as Coords2dCore};

        // Find the actual sketch object ID from the scene graph
        // First try sketch_mode, then try to find a sketch object, then fall back to provided sketch
        let actual_sketch_id = if let Some(sketch_mode) = guard.scene_graph().sketch_mode {
            sketch_mode
        } else {
            // Try to find a sketch object in the scene graph
            guard
                .scene_graph()
                .objects
                .iter()
                .find(|obj| matches!(obj.kind, kcl_lib::front::ObjectKind::Sketch { .. }))
                .map(|obj| obj.id)
                .unwrap_or(sketch) // Fall back to provided sketch
        };

        // Get current scene graph by executing mock first
        let (_, initial_scene_graph_delta) = guard
            .execute_mock(&ctx, version, actual_sketch_id)
            .await
            .map_err(|e| format!("Failed to get initial scene graph: {:?}", e))?;

        // Convert WASM Coords2d to core Coords2d for kcl-lib functions
        let points_core: Vec<Coords2dCore> = points
            .iter()
            .map(|c| kcl_lib::front::Coords2d { x: c.x, y: c.y })
            .collect();

        // Execute the trim loop using the shared function from kcl-lib
        // This replaces ~140 lines of duplicated loop logic
        let (source_delta, mut scene_graph_delta) = match execute_trim_loop_with_context(
            &points_core,
            initial_scene_graph_delta,
            &mut *guard,
            &ctx,
            version,
            actual_sketch_id,
        )
        .await
        {
            Ok(result) => result,
            Err(e) => {
                // If the trim loop returns an error (e.g., no operations executed),
                // execute mock to get the current state and return that
                eprintln!("Trim loop returned error: {}", e);
                guard
                    .execute_mock(&ctx, version, actual_sketch_id)
                    .await
                    .map_err(|e| format!("Failed to execute mock: {:?}", e))?
            }
        };

        // Track if any operations were performed (for return value)
        // If source_delta is empty, it means no operations were executed
        let operations_performed = !source_delta.text.is_empty();

        // If source_delta is empty, it means no operations were executed
        // In this case, we should return the original source code unchanged, not an empty string
        let (source_delta, scene_graph_delta) = if source_delta.text.is_empty() {
            // Get the current source code by executing mock, which returns the unchanged source
            guard
                .execute_mock(&ctx, version, actual_sketch_id)
                .await
                .map_err(|e| format!("Failed to execute mock: {:?}", e))?
        } else {
            (source_delta, scene_graph_delta)
        };

        // Return both kclSource and sceneGraphDelta
        #[derive(serde::Serialize)]
        struct TrimResult {
            kcl_source: kcl_lib::front::SourceDelta,
            scene_graph_delta: kcl_lib::front::SceneGraphDelta,
            operations_performed: bool,
        }

        let result = TrimResult {
            kcl_source: source_delta,
            scene_graph_delta,
            operations_performed,
        };

        Ok(JsValue::from_serde(&result)
            .map_err(|e| format!("Could not serialize trim result. {TRUE_BUG} Details: {e}"))?)
    }

    /// Chain a segment to a previous segment by adding it and creating a coincident constraint.
    #[wasm_bindgen]
    pub async fn chain_segment(
        &self,
        version_json: &str,
        sketch_json: &str,
        previous_segment_end_point_id_json: &str,
        segment_json: &str,
        label: Option<String>,
        settings: &str,
    ) -> Result<JsValue, JsValue> {
        console_error_panic_hook::set_once();

        let version: kcl_lib::front::Version =
            serde_json::from_str(version_json).map_err(|e| format!("Could not deserialize Version: {e}"))?;
        let sketch: kcl_lib::front::ObjectId =
            serde_json::from_str(sketch_json).map_err(|e| format!("Could not deserialize ObjectId: {e}"))?;
        let previous_segment_end_point_id: kcl_lib::front::ObjectId =
            serde_json::from_str(previous_segment_end_point_id_json)
                .map_err(|e| format!("Could not deserialize previous_segment_end_point_id: {e}"))?;
        let segment: kcl_lib::front::SegmentCtor =
            serde_json::from_str(segment_json).map_err(|e| format!("Could not deserialize SegmentCtor: {e}"))?;

        let ctx = self
            .create_executor_ctx(settings, None, true)
            .map_err(|e| format!("Could not create KCL executor context for chain segment. {TRUE_BUG} Details: {e}"))?;

        let frontend = Arc::clone(&self.frontend);
        let mut guard = frontend.write().await;
        let result = guard
            .chain_segment(&ctx, version, sketch, previous_segment_end_point_id, segment, label)
            .await
            .map_err(|e| format!("Failed to chain segment: {:?}", e))?;

        Ok(JsValue::from_serde(&result)
            .map_err(|e| format!("Could not serialize chain segment result. {TRUE_BUG} Details: {e}"))?)
    }
}
