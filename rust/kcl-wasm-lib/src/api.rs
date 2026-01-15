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
    #[wasm_bindgen]
    pub async fn batch_split_segment_operations(
        &self,
        version_json: &str,
        sketch_json: &str,
        edit_segments_json: &str,
        add_constraints_json: &str,
        delete_constraint_ids_json: &str,
        new_segment_id_json: &str,
        new_segment_start_point_id_json: &str,
        new_segment_end_point_id_json: &str,
        new_segment_center_point_id_json: &str,
        settings: &str,
    ) -> Result<JsValue, JsValue> {
        console_error_panic_hook::set_once();

        let version: kcl_lib::front::Version =
            serde_json::from_str(version_json).map_err(|e| format!("Could not deserialize Version: {e}"))?;
        let sketch: kcl_lib::front::ObjectId =
            serde_json::from_str(sketch_json).map_err(|e| format!("Could not deserialize ObjectId: {e}"))?;
        let edit_segments: Vec<kcl_lib::front::ExistingSegmentCtor> = serde_json::from_str(edit_segments_json)
            .map_err(|e| format!("Could not deserialize edit_segments: {e}"))?;
        let add_constraints: Vec<kcl_lib::front::Constraint> = serde_json::from_str(add_constraints_json)
            .map_err(|e| format!("Could not deserialize add_constraints: {e}"))?;
        let delete_constraint_ids: Vec<kcl_lib::front::ObjectId> = serde_json::from_str(delete_constraint_ids_json)
            .map_err(|e| format!("Could not deserialize delete_constraint_ids: {e}"))?;
        let new_segment_id: kcl_lib::front::ObjectId = serde_json::from_str(new_segment_id_json)
            .map_err(|e| format!("Could not deserialize new_segment_id: {e}"))?;
        let new_segment_start_point_id: kcl_lib::front::ObjectId =
            serde_json::from_str(new_segment_start_point_id_json)
                .map_err(|e| format!("Could not deserialize new_segment_start_point_id: {e}"))?;
        let new_segment_end_point_id: kcl_lib::front::ObjectId = serde_json::from_str(new_segment_end_point_id_json)
            .map_err(|e| format!("Could not deserialize new_segment_end_point_id: {e}"))?;
        let new_segment_center_point_id: Option<kcl_lib::front::ObjectId> =
            if new_segment_center_point_id_json.is_empty() {
                None
            } else {
                Some(
                    serde_json::from_str(new_segment_center_point_id_json)
                        .map_err(|e| format!("Could not deserialize new_segment_center_point_id: {e}"))?,
                )
            };

        let ctx = self.create_executor_ctx(settings, None, true).map_err(|e| {
            format!("Could not create KCL executor context for batch split segment operations. {TRUE_BUG} Details: {e}")
        })?;

        let frontend = Arc::clone(&self.frontend);
        let mut guard = frontend.write().await;
        let result = guard
            .batch_split_segment_operations(
                &ctx,
                version,
                sketch,
                edit_segments,
                add_constraints,
                delete_constraint_ids,
                kcl_lib::front::NewSegmentInfo {
                    segment_id: new_segment_id,
                    start_point_id: new_segment_start_point_id,
                    end_point_id: new_segment_end_point_id,
                    center_point_id: new_segment_center_point_id,
                },
            )
            .await
            .map_err(|e| format!("Failed to batch split segment operations: {:?}", e))?;

        Ok(JsValue::from_serde(&result).map_err(|e| {
            format!("Could not serialize batch split segment operations result. {TRUE_BUG} Details: {e}")
        })?)
    }

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

        // Import trim functions from kcl-lib
        use kcl_lib::front::{
            get_next_trim_coords, get_trim_spawn_terminations, trim_strategy, Coords2d as Coords2dCore,
            NextTrimResult as NextTrimResultCore, TrimTermination as TrimTerminationCore,
            TrimTerminations as TrimTerminationsCore,
        };

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

        // Use native Rust types directly - no serialization needed!
        // Track the current scene graph delta so we can access its objects
        let mut current_scene_graph_delta = initial_scene_graph_delta.clone();

        // Convert WASM Coords2d to core Coords2d for kcl-lib functions
        let points_core: Vec<Coords2dCore> = points
            .iter()
            .map(|c| kcl_lib::front::Coords2d { x: c.x, y: c.y })
            .collect();

        // Run the trim loop
        let mut start_index = 0;
        let max_iterations = 1000;
        let mut iteration_count = 0;
        // Use the types from the return value of execute_mock
        let mut last_result: Option<(kcl_lib::front::SourceDelta, kcl_lib::front::SceneGraphDelta)> = Some((
            kcl_lib::front::SourceDelta { text: String::new() },
            initial_scene_graph_delta,
        ));
        let mut invalidates_ids = false;
        let mut operations_performed = false;

        while start_index < points_core.len().saturating_sub(1) && iteration_count < max_iterations {
            iteration_count += 1;

            // Get next trim result - use objects from current scene graph
            let next_trim_result_core =
                get_next_trim_coords(&points_core, start_index, &current_scene_graph_delta.new_graph.objects);

            match &next_trim_result_core {
                NextTrimResultCore::NoTrimSpawn { next_index } => {
                    let old_start_index = start_index;
                    start_index = *next_index;

                    // Fail-safe: if nextIndex didn't advance, force it to advance
                    if start_index <= old_start_index {
                        start_index = old_start_index + 1;
                    }

                    // Early exit if we've reached the end
                    if start_index >= points_core.len().saturating_sub(1) {
                        break;
                    }
                    continue;
                }
                NextTrimResultCore::TrimSpawn {
                    trim_spawn_seg_id,
                    next_index,
                    ..
                } => {
                    // Get terminations - use objects from current scene graph
                    let terminations_core = match get_trim_spawn_terminations(
                        *trim_spawn_seg_id,
                        &points_core,
                        &current_scene_graph_delta.new_graph.objects,
                    ) {
                        Ok(terms) => terms,
                        Err(e) => {
                            eprintln!("Error getting trim spawn terminations: {}", e);
                            let old_start_index = start_index;
                            start_index = *next_index;
                            if start_index <= old_start_index {
                                start_index = old_start_index + 1;
                            }
                            continue;
                        }
                    };

                    // Get trim strategy - use objects from current scene graph
                    let trim_spawn_segment = current_scene_graph_delta
                        .new_graph
                        .objects
                        .iter()
                        .find(|obj| obj.id.0 == *trim_spawn_seg_id)
                        .ok_or_else(|| format!("Trim spawn segment {} not found", trim_spawn_seg_id))?;

                    let strategy_core = match trim_strategy(
                        *trim_spawn_seg_id,
                        trim_spawn_segment,
                        &terminations_core.left_side,
                        &terminations_core.right_side,
                        &current_scene_graph_delta.new_graph.objects,
                    ) {
                        Ok(ops) => ops,
                        Err(e) => {
                            eprintln!("Error determining trim strategy: {}", e);
                            let old_start_index = start_index;
                            start_index = *next_index;
                            if start_index <= old_start_index {
                                start_index = old_start_index + 1;
                            }
                            continue;
                        }
                    };

                    // Use core types directly - no need for WASM wrapper since we're only pattern matching
                    let strategy = strategy_core;

                    // Execute operations
                    // Check if we deleted a segment (for fail-safe logic later)
                    let was_deleted = strategy
                        .iter()
                        .any(|op| matches!(op, kcl_lib::front::TrimOperation::SimpleTrim { .. }));

                    // Track the last successful operation result to update objects once at the end
                    let mut last_operation_result: Option<(
                        kcl_lib::front::SourceDelta,
                        kcl_lib::front::SceneGraphDelta,
                    )> = None;

                    let mut op_index = 0;
                    while op_index < strategy.len() {
                        let mut consumed_ops = 1;
                        let operation_result = match &strategy[op_index] {
                            kcl_lib::front::TrimOperation::SimpleTrim { segment_to_trim_id } => {
                                // Delete the segment
                                let result = guard
                                    .delete_objects(
                                        &ctx,
                                        version,
                                        actual_sketch_id,
                                        Vec::new(),                                          // constraint_ids
                                        vec![kcl_lib::front::ObjectId(*segment_to_trim_id)], // segment_ids
                                    )
                                    .await;
                                result
                            }
                            kcl_lib::front::TrimOperation::EditSegment {
                                segment_id,
                                ctor,
                                endpoint_changed,
                            } => {
                                // Try to batch tail-cut sequence: EditSegment + AddCoincidentConstraint (+ DeleteConstraints)
                                if op_index + 1 < strategy.len() {
                                    if let kcl_lib::front::TrimOperation::AddCoincidentConstraint {
                                        segment_id: coincident_seg_id,
                                        endpoint_changed: coincident_endpoint_changed,
                                        segment_or_point_to_make_coincident_to,
                                        intersecting_endpoint_point_id,
                                    } = &strategy[op_index + 1]
                                    {
                                        if segment_id == coincident_seg_id
                                            && endpoint_changed == coincident_endpoint_changed
                                        {
                                            let mut delete_constraint_ids: Vec<kcl_lib::front::ObjectId> = Vec::new();
                                            if op_index + 2 < strategy.len() {
                                                if let kcl_lib::front::TrimOperation::DeleteConstraints {
                                                    constraint_ids,
                                                } = &strategy[op_index + 2]
                                                {
                                                    delete_constraint_ids = constraint_ids
                                                        .iter()
                                                        .map(|id| kcl_lib::front::ObjectId(*id))
                                                        .collect();
                                                    consumed_ops = 3;
                                                } else {
                                                    consumed_ops = 2;
                                                }
                                            } else {
                                                consumed_ops = 2;
                                            }

                                            // Use ctor directly
                                            let segment_ctor = ctor.clone();

                                            // Get endpoint point id from current scene graph (IDs stay the same after edit)
                                            let edited_segment = match current_scene_graph_delta
                                                .new_graph
                                                .objects
                                                .iter()
                                                .find(|obj| obj.id.0 == *segment_id)
                                            {
                                                Some(seg) => seg,
                                                None => {
                                                    eprintln!(
                                                        "Failed to find segment {} for tail-cut batch",
                                                        segment_id
                                                    );
                                                    op_index += consumed_ops;
                                                    continue;
                                                }
                                            };

                                            let endpoint_point_id = match &edited_segment.kind {
                                                kcl_lib::front::ObjectKind::Segment { segment } => match segment {
                                                    kcl_lib::front::Segment::Line(line) => {
                                                        if *endpoint_changed == kcl_lib::front::EndpointChanged::Start {
                                                            line.start.0
                                                        } else {
                                                            line.end.0
                                                        }
                                                    }
                                                    kcl_lib::front::Segment::Arc(arc) => {
                                                        if *endpoint_changed == kcl_lib::front::EndpointChanged::Start {
                                                            arc.start.0
                                                        } else {
                                                            arc.end.0
                                                        }
                                                    }
                                                    _ => {
                                                        eprintln!("Unsupported segment type for tail-cut batch");
                                                        op_index += consumed_ops;
                                                        continue;
                                                    }
                                                },
                                                _ => {
                                                    eprintln!("Edited object is not a segment (tail-cut batch)");
                                                    op_index += consumed_ops;
                                                    continue;
                                                }
                                            };

                                            let coincident_segments = if let Some(point_id) =
                                                intersecting_endpoint_point_id
                                            {
                                                vec![
                                                    kcl_lib::front::ObjectId(endpoint_point_id),
                                                    kcl_lib::front::ObjectId(*point_id),
                                                ]
                                            } else {
                                                vec![
                                                    kcl_lib::front::ObjectId(endpoint_point_id),
                                                    kcl_lib::front::ObjectId(*segment_or_point_to_make_coincident_to),
                                                ]
                                            };

                                            let constraint =
                                                kcl_lib::front::Constraint::Coincident(kcl_lib::front::Coincident {
                                                    segments: coincident_segments,
                                                });

                                            let segment_to_edit = kcl_lib::front::ExistingSegmentCtor {
                                                id: kcl_lib::front::ObjectId(*segment_id),
                                                ctor: segment_ctor,
                                            };

                                            let result = guard
                                                .batch_tail_cut_operations(
                                                    &ctx,
                                                    version,
                                                    actual_sketch_id,
                                                    vec![segment_to_edit],
                                                    vec![constraint],
                                                    delete_constraint_ids,
                                                )
                                                .await;
                                            op_index += consumed_ops;
                                            // Handle result below
                                            result
                                        } else {
                                            // not same segment/endpoint
                                            let segment_to_edit = kcl_lib::front::ExistingSegmentCtor {
                                                id: kcl_lib::front::ObjectId(*segment_id),
                                                ctor: ctor.clone(),
                                            };

                                            let result = guard
                                                .edit_segments(&ctx, version, actual_sketch_id, vec![segment_to_edit])
                                                .await;
                                            result
                                        }
                                    } else {
                                        // Not followed by AddCoincidentConstraint
                                        let segment_to_edit = kcl_lib::front::ExistingSegmentCtor {
                                            id: kcl_lib::front::ObjectId(*segment_id),
                                            ctor: ctor.clone(),
                                        };

                                        let result = guard
                                            .edit_segments(&ctx, version, actual_sketch_id, vec![segment_to_edit])
                                            .await;
                                        result
                                    }
                                } else {
                                    // No following op to batch with
                                    let segment_to_edit = kcl_lib::front::ExistingSegmentCtor {
                                        id: kcl_lib::front::ObjectId(*segment_id),
                                        ctor: ctor.clone(),
                                    };

                                    let result = guard
                                        .edit_segments(&ctx, version, actual_sketch_id, vec![segment_to_edit])
                                        .await;
                                    result
                                }
                            }
                            kcl_lib::front::TrimOperation::AddCoincidentConstraint {
                                segment_id,
                                endpoint_changed,
                                segment_or_point_to_make_coincident_to,
                                intersecting_endpoint_point_id,
                            } => {
                                // Find the edited segment to get the endpoint point ID using native types
                                let edited_segment = match current_scene_graph_delta
                                    .new_graph
                                    .objects
                                    .iter()
                                    .find(|obj| obj.id.0 == *segment_id)
                                {
                                    Some(seg) => seg,
                                    None => {
                                        eprintln!("Failed to find edited segment {}", segment_id);
                                        continue;
                                    }
                                };

                                // Get the endpoint ID after editing using native types
                                let new_segment_endpoint_point_id = match &edited_segment.kind {
                                    kcl_lib::front::ObjectKind::Segment { segment } => match segment {
                                        kcl_lib::front::Segment::Line(line) => {
                                            if *endpoint_changed == kcl_lib::front::EndpointChanged::Start {
                                                line.start.0
                                            } else {
                                                line.end.0
                                            }
                                        }
                                        kcl_lib::front::Segment::Arc(arc) => {
                                            if *endpoint_changed == kcl_lib::front::EndpointChanged::Start {
                                                arc.start.0
                                            } else {
                                                arc.end.0
                                            }
                                        }
                                        _ => {
                                            eprintln!("Unsupported segment type for addCoincidentConstraint");
                                            continue;
                                        }
                                    },
                                    _ => {
                                        eprintln!("Edited object is not a segment");
                                        continue;
                                    }
                                };

                                // Determine coincident segments
                                let coincident_segments = if let Some(point_id) = intersecting_endpoint_point_id {
                                    vec![
                                        kcl_lib::front::ObjectId(new_segment_endpoint_point_id),
                                        kcl_lib::front::ObjectId(*point_id),
                                    ]
                                } else {
                                    vec![
                                        kcl_lib::front::ObjectId(new_segment_endpoint_point_id),
                                        kcl_lib::front::ObjectId(*segment_or_point_to_make_coincident_to),
                                    ]
                                };

                                let constraint = kcl_lib::front::Constraint::Coincident(kcl_lib::front::Coincident {
                                    segments: coincident_segments,
                                });

                                guard.add_constraint(&ctx, version, actual_sketch_id, constraint).await
                            }
                            kcl_lib::front::TrimOperation::DeleteConstraints { constraint_ids } => {
                                // Delete constraints
                                let constraint_object_ids: Vec<kcl_lib::front::ObjectId> =
                                    constraint_ids.iter().map(|id| kcl_lib::front::ObjectId(*id)).collect();

                                guard
                                    .delete_objects(
                                        &ctx,
                                        version,
                                        actual_sketch_id,
                                        constraint_object_ids,
                                        Vec::new(), // segment_ids
                                    )
                                    .await
                            }
                            kcl_lib::front::TrimOperation::SplitSegment {
                                segment_id,
                                left_trim_coords,
                                right_trim_coords,
                                original_end_coords,
                                left_side,
                                right_side,
                                left_side_coincident_data,
                                right_side_coincident_data,
                                constraints_to_migrate,
                                constraints_to_delete,
                            } => {
                                // Split segment operation: edit original segment, create new segment, migrate constraints
                                // This is a complex multi-step operation

                                // Step 1: Find and validate original segment using native types
                                let original_segment = match current_scene_graph_delta
                                    .new_graph
                                    .objects
                                    .iter()
                                    .find(|obj| obj.id.0 == *segment_id)
                                {
                                    Some(seg) => seg,
                                    None => {
                                        eprintln!("Failed to find original segment {}", segment_id);
                                        continue;
                                    }
                                };

                                // Extract point IDs from original segment early to avoid borrow issues
                                let (
                                    original_segment_start_point_id,
                                    original_segment_end_point_id,
                                    original_segment_center_point_id,
                                ) = match &original_segment.kind {
                                    kcl_lib::front::ObjectKind::Segment { segment } => match segment {
                                        kcl_lib::front::Segment::Line(line) => {
                                            (Some(line.start.0), Some(line.end.0), None)
                                        }
                                        kcl_lib::front::Segment::Arc(arc) => {
                                            (Some(arc.start.0), Some(arc.end.0), Some(arc.center.0))
                                        }
                                        _ => (None, None, None),
                                    },
                                    _ => (None, None, None),
                                };

                                // Store center point constraints to migrate BEFORE edit_segments modifies the scene graph
                                let mut center_point_constraints_to_migrate: Vec<(kcl_lib::front::Constraint, usize)> =
                                    Vec::new();
                                if let Some(original_center_id) = original_segment_center_point_id {
                                    for obj in &current_scene_graph_delta.new_graph.objects {
                                        let kcl_lib::front::ObjectKind::Constraint { constraint } = &obj.kind else {
                                            continue;
                                        };

                                        // Find coincident constraints that reference the original center point
                                        if let kcl_lib::front::Constraint::Coincident(coincident) = constraint {
                                            if coincident.segments.iter().any(|seg_id| seg_id.0 == original_center_id) {
                                                center_point_constraints_to_migrate
                                                    .push((constraint.clone(), original_center_id));
                                            }
                                        }

                                        // Find distance constraints that reference the original center point
                                        if let kcl_lib::front::Constraint::Distance(distance) = constraint {
                                            if distance.points.iter().any(|pt| pt.0 == original_center_id) {
                                                center_point_constraints_to_migrate
                                                    .push((constraint.clone(), original_center_id));
                                            }
                                        }
                                    }
                                }

                                // Extract segment and ctor using native types
                                let (segment_type, original_ctor) = match &original_segment.kind {
                                    kcl_lib::front::ObjectKind::Segment { segment } => match segment {
                                        kcl_lib::front::Segment::Line(line) => ("Line", line.ctor.clone()),
                                        kcl_lib::front::Segment::Arc(arc) => ("Arc", arc.ctor.clone()),
                                        _ => {
                                            eprintln!("Original segment is not a Line or Arc");
                                            continue;
                                        }
                                    },
                                    _ => {
                                        eprintln!("Original object is not a segment");
                                        continue;
                                    }
                                };

                                // Extract units from the existing ctor
                                let units = match &original_ctor {
                                    kcl_lib::front::SegmentCtor::Line(line_ctor) => match &line_ctor.start.x {
                                        kcl_lib::front::Expr::Var(v) | kcl_lib::front::Expr::Number(v) => v.units,
                                        _ => kcl_lib::pretty::NumericSuffix::Mm,
                                    },
                                    kcl_lib::front::SegmentCtor::Arc(arc_ctor) => match &arc_ctor.start.x {
                                        kcl_lib::front::Expr::Var(v) | kcl_lib::front::Expr::Number(v) => v.units,
                                        _ => kcl_lib::pretty::NumericSuffix::Mm,
                                    },
                                    _ => kcl_lib::pretty::NumericSuffix::Mm,
                                };

                                // Helper to convert Coords2d to Point2d with units
                                let coords_to_point =
                                    |coords: kcl_lib::front::Coords2d| -> kcl_lib::front::Point2d<kcl_lib::front::Number> {
                                        // Round to 2 decimal places (matching TypeScript roundOff function)
                                        let round_off = |val: f64| -> f64 { (val * 100.0).round() / 100.0 };
                                        kcl_lib::front::Point2d {
                                            x: kcl_lib::front::Number {
                                                value: round_off(coords.x),
                                                units,
                                            },
                                            y: kcl_lib::front::Number {
                                                value: round_off(coords.y),
                                                units,
                                            },
                                        }
                                    };

                                // Convert Point2d<Number> to Point2d<Expr> for SegmentCtor
                                let point_to_expr = |point: kcl_lib::front::Point2d<kcl_lib::front::Number>| -> kcl_lib::front::Point2d<kcl_lib::front::Expr> {
                                    kcl_lib::front::Point2d {
                                        x: kcl_lib::front::Expr::Var(point.x),
                                        y: kcl_lib::front::Expr::Var(point.y),
                                    }
                                };

                                // Step 1: Create new segment (right side) first to get its IDs
                                // Note: We'll update objects once at the end of all operations
                                // For arcs, we need to create a new center point so the new arc has its own center point ID
                                let new_segment_ctor = match &original_ctor {
                                    kcl_lib::front::SegmentCtor::Line(_) => {
                                        kcl_lib::front::SegmentCtor::Line(kcl_lib::front::LineCtor {
                                            start: point_to_expr(coords_to_point(*right_trim_coords)),
                                            end: point_to_expr(coords_to_point(*original_end_coords)),
                                        })
                                    }
                                    kcl_lib::front::SegmentCtor::Arc(arc_ctor) => {
                                        kcl_lib::front::SegmentCtor::Arc(kcl_lib::front::ArcCtor {
                                            start: point_to_expr(coords_to_point(*right_trim_coords)),
                                            end: point_to_expr(coords_to_point(*original_end_coords)),
                                            center: arc_ctor.center.clone(),
                                        })
                                    }
                                    _ => {
                                        eprintln!("Unsupported segment type for new segment");
                                        continue;
                                    }
                                };

                                let add_result = guard
                                    .add_segment(&ctx, version, actual_sketch_id, new_segment_ctor, None)
                                    .await;

                                let (_, mut add_scene_graph_delta) = match add_result {
                                    Ok(result) => {
                                        last_result = Some(result.clone());
                                        invalidates_ids = invalidates_ids || result.1.invalidates_ids;
                                        result
                                    }
                                    Err(e) => {
                                        eprintln!("Failed to add new segment: {:?}", e);
                                        continue;
                                    }
                                };

                                // Update current scene graph delta - no serialization needed!
                                current_scene_graph_delta = add_scene_graph_delta.clone();

                                // Step 4: Find the newly created segment using native types
                                let new_segment_id = match add_scene_graph_delta.new_objects.iter().find(|&id| {
                                    let id_usize = id.0;
                                    if let Some(obj) = current_scene_graph_delta.new_graph.objects.get(id_usize) {
                                        matches!(&obj.kind, kcl_lib::front::ObjectKind::Segment { segment } if matches!(segment, kcl_lib::front::Segment::Line(_) | kcl_lib::front::Segment::Arc(_)))
                                    } else {
                                        false
                                    }
                                }) {
                                    Some(id) => id.0,
                                    None => {
                                        eprintln!("Failed to find newly created segment");
                                        continue;
                                    }
                                };

                                let new_segment = match current_scene_graph_delta.new_graph.objects.get(new_segment_id)
                                {
                                    Some(seg) => seg,
                                    None => {
                                        eprintln!("New segment not found at index {}", new_segment_id);
                                        continue;
                                    }
                                };

                                // Extract endpoint IDs using native types
                                let (new_segment_start_point_id, new_segment_end_point_id, new_segment_center_point_id) =
                                    match &new_segment.kind {
                                        kcl_lib::front::ObjectKind::Segment { segment } => match segment {
                                            kcl_lib::front::Segment::Line(line) => (line.start.0, line.end.0, None),
                                            kcl_lib::front::Segment::Arc(arc) => {
                                                (arc.start.0, arc.end.0, Some(arc.center.0))
                                            }
                                            _ => {
                                                eprintln!("New segment is not a Line or Arc");
                                                continue;
                                            }
                                        },
                                        _ => {
                                            eprintln!("New segment is not a segment");
                                            continue;
                                        }
                                    };

                                // Step 2: Prepare data for batched operations
                                // Prepare edit_segments
                                let edited_ctor = match &original_ctor {
                                    kcl_lib::front::SegmentCtor::Line(line_ctor) => {
                                        kcl_lib::front::SegmentCtor::Line(kcl_lib::front::LineCtor {
                                            start: line_ctor.start.clone(),
                                            end: point_to_expr(coords_to_point(*left_trim_coords)),
                                        })
                                    }
                                    kcl_lib::front::SegmentCtor::Arc(arc_ctor) => {
                                        kcl_lib::front::SegmentCtor::Arc(kcl_lib::front::ArcCtor {
                                            start: arc_ctor.start.clone(),
                                            end: point_to_expr(coords_to_point(*left_trim_coords)),
                                            center: arc_ctor.center.clone(),
                                        })
                                    }
                                    _ => {
                                        eprintln!("Unsupported segment type for split");
                                        continue;
                                    }
                                };

                                // We need the left endpoint ID, but it will be created during edit_segments in the batch
                                // We can't know it beforehand, so we'll need to do edit_segments first to get it
                                // Then batch the rest
                                let edit_result = guard
                                    .edit_segments(
                                        &ctx,
                                        version,
                                        actual_sketch_id,
                                        vec![kcl_lib::front::ExistingSegmentCtor {
                                            id: kcl_lib::front::ObjectId(*segment_id),
                                            ctor: edited_ctor,
                                        }],
                                    )
                                    .await;

                                let (_, edit_scene_graph_delta) = match edit_result {
                                    Ok(result) => {
                                        last_operation_result = Some(result.clone());
                                        invalidates_ids = invalidates_ids || result.1.invalidates_ids;
                                        result
                                    }
                                    Err(e) => {
                                        eprintln!("Failed to edit segment: {:?}", e);
                                        continue;
                                    }
                                };

                                // Update current scene graph delta
                                current_scene_graph_delta = edit_scene_graph_delta.clone();

                                // Get left endpoint ID from edited segment
                                let edited_segment = match current_scene_graph_delta
                                    .new_graph
                                    .objects
                                    .iter()
                                    .find(|obj| obj.id.0 == *segment_id)
                                {
                                    Some(seg) => seg,
                                    None => {
                                        eprintln!("Failed to find edited segment {}", segment_id);
                                        continue;
                                    }
                                };

                                let left_side_endpoint_point_id = match &edited_segment.kind {
                                    kcl_lib::front::ObjectKind::Segment { segment } => match segment {
                                        kcl_lib::front::Segment::Line(line) => line.end.0,
                                        kcl_lib::front::Segment::Arc(arc) => arc.end.0,
                                        _ => {
                                            eprintln!("Edited segment is not a Line or Arc");
                                            continue;
                                        }
                                    },
                                    _ => {
                                        eprintln!("Edited segment is not a segment");
                                        continue;
                                    }
                                };

                                // Prepare constraints for batch
                                let mut batch_constraints = Vec::new();

                                // Left constraint
                                let left_intersecting_seg_id = match &**left_side {
                                    kcl_lib::front::TrimTermination::Intersection { intersecting_seg_id, .. }
                                    | kcl_lib::front::TrimTermination::TrimSpawnSegmentCoincidentWithAnotherSegmentPoint { intersecting_seg_id, .. } => *intersecting_seg_id,
                                    _ => {
                                        eprintln!("Left side is not an intersection or coincident");
                                        continue;
                                    }
                                };
                                let left_coincident_segments = match &**left_side {
                                    kcl_lib::front::TrimTermination::TrimSpawnSegmentCoincidentWithAnotherSegmentPoint {
                                        trim_spawn_segment_coincident_with_another_segment_point_id,
                                        ..
                                    } => {
                                        vec![
                                            kcl_lib::front::ObjectId(left_side_endpoint_point_id),
                                            kcl_lib::front::ObjectId(*trim_spawn_segment_coincident_with_another_segment_point_id),
                                        ]
                                    }
                                    _ => {
                                        vec![
                                            kcl_lib::front::ObjectId(left_side_endpoint_point_id),
                                            kcl_lib::front::ObjectId(left_intersecting_seg_id),
                                        ]
                                    }
                                };
                                batch_constraints.push(kcl_lib::front::Constraint::Coincident(
                                    kcl_lib::front::Coincident {
                                        segments: left_coincident_segments,
                                    },
                                ));

                                // Right constraint
                                let right_intersecting_seg_id = match &**right_side {
                                    kcl_lib::front::TrimTermination::Intersection { intersecting_seg_id, .. }
                                    | kcl_lib::front::TrimTermination::TrimSpawnSegmentCoincidentWithAnotherSegmentPoint { intersecting_seg_id, .. } => *intersecting_seg_id,
                                    _ => {
                                        eprintln!("Right side is not an intersection or coincident");
                                        continue;
                                    }
                                };

                                // Check if right side is an intersection and if it's at an endpoint
                                let mut intersection_point_id: Option<usize> = None;
                                if matches!(&**right_side, kcl_lib::front::TrimTermination::Intersection { .. }) {
                                    let intersecting_seg = current_scene_graph_delta
                                        .new_graph
                                        .objects
                                        .iter()
                                        .find(|obj| obj.id.0 == right_intersecting_seg_id);

                                    if let Some(seg) = intersecting_seg {
                                        let endpoint_epsilon = 1e-3; // 0.001mm
                                        let right_trim_coords_value = right_trim_coords;

                                        if let kcl_lib::front::ObjectKind::Segment { segment } = &seg.kind {
                                            match segment {
                                                kcl_lib::front::Segment::Line(_) => {
                                                    // Check start and end
                                                    if let (Some(start_coords), Some(end_coords)) = (
                                                        kcl_lib::front::get_position_coords_for_line(
                                                            seg,
                                                            "start",
                                                            &current_scene_graph_delta.new_graph.objects,
                                                        ),
                                                        kcl_lib::front::get_position_coords_for_line(
                                                            seg,
                                                            "end",
                                                            &current_scene_graph_delta.new_graph.objects,
                                                        ),
                                                    ) {
                                                        let dist_to_start = ((right_trim_coords_value.x
                                                            - start_coords.x)
                                                            * (right_trim_coords_value.x - start_coords.x)
                                                            + (right_trim_coords_value.y - start_coords.y)
                                                                * (right_trim_coords_value.y - start_coords.y))
                                                            .sqrt();
                                                        if dist_to_start < endpoint_epsilon {
                                                            if let kcl_lib::front::Segment::Line(line) = segment {
                                                                intersection_point_id = Some(line.start.0);
                                                            }
                                                        } else {
                                                            let dist_to_end = ((right_trim_coords_value.x
                                                                - end_coords.x)
                                                                * (right_trim_coords_value.x - end_coords.x)
                                                                + (right_trim_coords_value.y - end_coords.y)
                                                                    * (right_trim_coords_value.y - end_coords.y))
                                                                .sqrt();
                                                            if dist_to_end < endpoint_epsilon {
                                                                if let kcl_lib::front::Segment::Line(line) = segment {
                                                                    intersection_point_id = Some(line.end.0);
                                                                }
                                                            }
                                                        }
                                                    }
                                                }
                                                kcl_lib::front::Segment::Arc(_) => {
                                                    // Check start and end for arc
                                                    if let (Some(start_coords), Some(end_coords)) = (
                                                        kcl_lib::front::get_position_coords_from_arc(
                                                            seg,
                                                            "start",
                                                            &current_scene_graph_delta.new_graph.objects,
                                                        ),
                                                        kcl_lib::front::get_position_coords_from_arc(
                                                            seg,
                                                            "end",
                                                            &current_scene_graph_delta.new_graph.objects,
                                                        ),
                                                    ) {
                                                        let dist_to_start = ((right_trim_coords_value.x
                                                            - start_coords.x)
                                                            * (right_trim_coords_value.x - start_coords.x)
                                                            + (right_trim_coords_value.y - start_coords.y)
                                                                * (right_trim_coords_value.y - start_coords.y))
                                                            .sqrt();
                                                        if dist_to_start < endpoint_epsilon {
                                                            if let kcl_lib::front::Segment::Arc(arc) = segment {
                                                                intersection_point_id = Some(arc.start.0);
                                                            }
                                                        } else {
                                                            let dist_to_end = ((right_trim_coords_value.x
                                                                - end_coords.x)
                                                                * (right_trim_coords_value.x - end_coords.x)
                                                                + (right_trim_coords_value.y - end_coords.y)
                                                                    * (right_trim_coords_value.y - end_coords.y))
                                                                .sqrt();
                                                            if dist_to_end < endpoint_epsilon {
                                                                if let kcl_lib::front::Segment::Arc(arc) = segment {
                                                                    intersection_point_id = Some(arc.end.0);
                                                                }
                                                            }
                                                        }
                                                    }
                                                }
                                                _ => {}
                                            }
                                        }
                                    }
                                }

                                let right_coincident_segments = if let Some(point_id) = intersection_point_id {
                                    vec![
                                        kcl_lib::front::ObjectId(new_segment_start_point_id),
                                        kcl_lib::front::ObjectId(point_id),
                                    ]
                                } else if let kcl_lib::front::TrimTermination::TrimSpawnSegmentCoincidentWithAnotherSegmentPoint {
                                    trim_spawn_segment_coincident_with_another_segment_point_id,
                                    ..
                                } = &**right_side {
                                    vec![
                                        kcl_lib::front::ObjectId(new_segment_start_point_id),
                                        kcl_lib::front::ObjectId(*trim_spawn_segment_coincident_with_another_segment_point_id),
                                    ]
                                } else {
                                    vec![
                                        kcl_lib::front::ObjectId(new_segment_start_point_id),
                                        kcl_lib::front::ObjectId(right_intersecting_seg_id),
                                    ]
                                };
                                batch_constraints.push(kcl_lib::front::Constraint::Coincident(
                                    kcl_lib::front::Coincident {
                                        segments: right_coincident_segments,
                                    },
                                ));

                                // Migrate constraints
                                let mut points_constrained_to_new_segment_start = std::collections::HashSet::new();
                                let mut points_constrained_to_new_segment_end = std::collections::HashSet::new();

                                if let kcl_lib::front::TrimTermination::TrimSpawnSegmentCoincidentWithAnotherSegmentPoint {
                                    trim_spawn_segment_coincident_with_another_segment_point_id,
                                    ..
                                } = &**right_side {
                                    points_constrained_to_new_segment_start.insert(*trim_spawn_segment_coincident_with_another_segment_point_id);
                                }

                                for constraint_to_migrate in constraints_to_migrate.iter() {
                                    if constraint_to_migrate.attach_to_endpoint == kcl_lib::front::AttachToEndpoint::End
                                        && constraint_to_migrate.is_point_point
                                    {
                                        points_constrained_to_new_segment_end
                                            .insert(constraint_to_migrate.other_entity_id);
                                    }
                                }

                                for constraint_to_migrate in constraints_to_migrate.iter() {
                                    // Skip migrating point-segment constraints if the point is already constrained
                                    if constraint_to_migrate.attach_to_endpoint
                                        == kcl_lib::front::AttachToEndpoint::Segment
                                    {
                                        if points_constrained_to_new_segment_start
                                            .contains(&constraint_to_migrate.other_entity_id)
                                            || points_constrained_to_new_segment_end
                                                .contains(&constraint_to_migrate.other_entity_id)
                                        {
                                            continue; // Skip redundant constraint
                                        }
                                    }

                                    let constraint_segments = if constraint_to_migrate.attach_to_endpoint
                                        == kcl_lib::front::AttachToEndpoint::Segment
                                    {
                                        vec![
                                            kcl_lib::front::ObjectId(constraint_to_migrate.other_entity_id),
                                            kcl_lib::front::ObjectId(new_segment_id),
                                        ]
                                    } else {
                                        let target_endpoint_id = if constraint_to_migrate.attach_to_endpoint
                                            == kcl_lib::front::AttachToEndpoint::Start
                                        {
                                            new_segment_start_point_id
                                        } else {
                                            new_segment_end_point_id
                                        };
                                        vec![
                                            kcl_lib::front::ObjectId(target_endpoint_id),
                                            kcl_lib::front::ObjectId(constraint_to_migrate.other_entity_id),
                                        ]
                                    };
                                    batch_constraints.push(kcl_lib::front::Constraint::Coincident(
                                        kcl_lib::front::Coincident {
                                            segments: constraint_segments,
                                        },
                                    ));
                                }

                                // Find distance constraints that reference both endpoints of the original segment
                                // These should be re-added with: original start, new segment end
                                // We need to do this before other operations that might modify current_scene_graph_delta
                                let mut distance_constraints_to_re_add: Vec<kcl_lib::front::Number> = Vec::new();
                                if let (Some(original_start_id), Some(original_end_id)) =
                                    (original_segment_start_point_id, original_segment_end_point_id)
                                {
                                    for obj in &current_scene_graph_delta.new_graph.objects {
                                        let kcl_lib::front::ObjectKind::Constraint { constraint } = &obj.kind else {
                                            continue;
                                        };

                                        let kcl_lib::front::Constraint::Distance(distance) = constraint else {
                                            continue;
                                        };

                                        // Check if this distance constraint references both endpoints of the original segment
                                        let references_start =
                                            distance.points.iter().any(|pt| pt.0 == original_start_id);
                                        let references_end = distance.points.iter().any(|pt| pt.0 == original_end_id);

                                        if references_start && references_end {
                                            // Store the distance value to re-add later
                                            distance_constraints_to_re_add.push(distance.distance.clone());
                                        }
                                    }
                                }

                                // Re-add distance constraints that were on the original segment's endpoints
                                // These should reference: original start, new segment end
                                if let Some(original_start_id) = original_segment_start_point_id {
                                    for distance_value in distance_constraints_to_re_add {
                                        batch_constraints.push(kcl_lib::front::Constraint::Distance(
                                            kcl_lib::front::Distance {
                                                points: vec![
                                                    kcl_lib::front::ObjectId(original_start_id),
                                                    kcl_lib::front::ObjectId(new_segment_end_point_id),
                                                ],
                                                distance: distance_value,
                                            },
                                        ));
                                    }
                                }

                                // Migrate center point constraints for arcs
                                // When an arc is split, constraints on the center point should be applied to the new arc's center as well
                                // Use the constraints we captured BEFORE edit_segments
                                // IMPORTANT: We add these constraints AFTER the new segment is created, so the new center point ID is valid
                                if let Some(new_center_id) = new_segment_center_point_id {
                                    for (constraint, original_center_id) in center_point_constraints_to_migrate {
                                        match constraint {
                                            kcl_lib::front::Constraint::Coincident(coincident) => {
                                                // Create a new coincident constraint with the new center point replacing the old one
                                                let new_segments: Vec<kcl_lib::front::ObjectId> = coincident
                                                    .segments
                                                    .iter()
                                                    .map(|seg_id| {
                                                        if seg_id.0 == original_center_id {
                                                            kcl_lib::front::ObjectId(new_center_id)
                                                        } else {
                                                            *seg_id
                                                        }
                                                    })
                                                    .collect();

                                                batch_constraints.push(kcl_lib::front::Constraint::Coincident(
                                                    kcl_lib::front::Coincident { segments: new_segments },
                                                ));
                                            }
                                            kcl_lib::front::Constraint::Distance(distance) => {
                                                // Create a new distance constraint with the new center point
                                                // NOTE: Distance constraints on center points should NOT be deleted by the solver
                                                // because they reference a point that's owned by a segment, not the segment itself
                                                let new_points: Vec<kcl_lib::front::ObjectId> = distance
                                                    .points
                                                    .iter()
                                                    .map(|pt| {
                                                        if pt.0 == original_center_id {
                                                            kcl_lib::front::ObjectId(new_center_id)
                                                        } else {
                                                            *pt
                                                        }
                                                    })
                                                    .collect();

                                                batch_constraints.push(kcl_lib::front::Constraint::Distance(
                                                    kcl_lib::front::Distance {
                                                        points: new_points,
                                                        distance: distance.distance.clone(),
                                                    },
                                                ));
                                            }
                                            _ => {}
                                        }
                                    }
                                }

                                // Re-add angle constraints (Parallel, Perpendicular, Horizontal, Vertical)
                                // that referenced the original segment, adding them for the new segment
                                // Note: We don't delete the original constraint - it still applies to the trimmed segment
                                for obj in &current_scene_graph_delta.new_graph.objects {
                                    let kcl_lib::front::ObjectKind::Constraint { constraint } = &obj.kind else {
                                        continue;
                                    };

                                    let should_migrate = match constraint {
                                        kcl_lib::front::Constraint::Parallel(parallel) => {
                                            parallel.lines.iter().any(|line_id| line_id.0 == *segment_id)
                                        }
                                        kcl_lib::front::Constraint::Perpendicular(perpendicular) => {
                                            perpendicular.lines.iter().any(|line_id| line_id.0 == *segment_id)
                                        }
                                        kcl_lib::front::Constraint::Horizontal(horizontal) => {
                                            horizontal.line.0 == *segment_id
                                        }
                                        kcl_lib::front::Constraint::Vertical(vertical) => {
                                            vertical.line.0 == *segment_id
                                        }
                                        _ => false,
                                    };

                                    if should_migrate {
                                        // Create a new constraint with the new segment ID replacing the old one
                                        // The original constraint remains on the original (trimmed) segment
                                        let migrated_constraint = match constraint {
                                            kcl_lib::front::Constraint::Parallel(parallel) => {
                                                let new_lines: Vec<kcl_lib::front::ObjectId> = parallel
                                                    .lines
                                                    .iter()
                                                    .map(|line_id| {
                                                        if line_id.0 == *segment_id {
                                                            kcl_lib::front::ObjectId(new_segment_id)
                                                        } else {
                                                            *line_id
                                                        }
                                                    })
                                                    .collect();
                                                kcl_lib::front::Constraint::Parallel(kcl_lib::front::Parallel {
                                                    lines: new_lines,
                                                })
                                            }
                                            kcl_lib::front::Constraint::Perpendicular(perpendicular) => {
                                                let new_lines: Vec<kcl_lib::front::ObjectId> = perpendicular
                                                    .lines
                                                    .iter()
                                                    .map(|line_id| {
                                                        if line_id.0 == *segment_id {
                                                            kcl_lib::front::ObjectId(new_segment_id)
                                                        } else {
                                                            *line_id
                                                        }
                                                    })
                                                    .collect();
                                                kcl_lib::front::Constraint::Perpendicular(
                                                    kcl_lib::front::Perpendicular { lines: new_lines },
                                                )
                                            }
                                            kcl_lib::front::Constraint::Horizontal(horizontal) => {
                                                // For single-line constraints, create a new constraint for the new segment
                                                if horizontal.line.0 == *segment_id {
                                                    kcl_lib::front::Constraint::Horizontal(kcl_lib::front::Horizontal {
                                                        line: kcl_lib::front::ObjectId(new_segment_id),
                                                    })
                                                } else {
                                                    continue; // Shouldn't happen, but skip if it does
                                                }
                                            }
                                            kcl_lib::front::Constraint::Vertical(vertical) => {
                                                // For single-line constraints, create a new constraint for the new segment
                                                if vertical.line.0 == *segment_id {
                                                    kcl_lib::front::Constraint::Vertical(kcl_lib::front::Vertical {
                                                        line: kcl_lib::front::ObjectId(new_segment_id),
                                                    })
                                                } else {
                                                    continue; // Shouldn't happen, but skip if it does
                                                }
                                            }
                                            _ => continue,
                                        };
                                        batch_constraints.push(migrated_constraint);
                                    }
                                }

                                // Step 3: Batch all remaining operations (constraints and delete)
                                // edit_segments and add_segment are already done, so we just batch constraints and delete
                                let constraint_object_ids: Vec<kcl_lib::front::ObjectId> = constraints_to_delete
                                    .iter()
                                    .map(|id| kcl_lib::front::ObjectId(*id))
                                    .collect();

                                let batch_result = guard
                                    .batch_split_segment_operations(
                                        &ctx,
                                        version,
                                        actual_sketch_id,
                                        Vec::new(), // edit_segments already done
                                        batch_constraints,
                                        constraint_object_ids,
                                        kcl_lib::front::NewSegmentInfo {
                                            segment_id: kcl_lib::front::ObjectId(new_segment_id),
                                            start_point_id: kcl_lib::front::ObjectId(new_segment_start_point_id),
                                            end_point_id: kcl_lib::front::ObjectId(new_segment_end_point_id),
                                            center_point_id: new_segment_center_point_id
                                                .map(|id| kcl_lib::front::ObjectId(id)),
                                        },
                                    )
                                    .await;

                                match batch_result {
                                    Ok((source_delta, delta)) => {
                                        let delta_clone = delta.clone();
                                        last_result = Some((source_delta, delta_clone.clone()));
                                        invalidates_ids = invalidates_ids || delta_clone.invalidates_ids;
                                        current_scene_graph_delta = delta_clone.clone();
                                    }
                                    Err(e) => {
                                        eprintln!("Failed to batch split segment operations: {:?}", e);
                                        // Continue anyway - some failures are non-fatal
                                    }
                                }

                                // Return success for split operation

                                match &last_result {
                                    Some((source_delta, delta)) => Ok((source_delta.clone(), delta.clone())),
                                    None => {
                                        // This shouldn't happen, but return the scene_graph_delta we have
                                        Ok((
                                            kcl_lib::front::SourceDelta { text: String::new() },
                                            current_scene_graph_delta.clone(),
                                        ))
                                    }
                                }
                            }
                        };

                        match operation_result {
                            Ok((source_delta, scene_graph_delta)) => {
                                last_result = Some((source_delta, scene_graph_delta.clone()));
                                invalidates_ids = invalidates_ids || scene_graph_delta.invalidates_ids;
                                operations_performed = true;

                                // Update current scene graph delta - no serialization needed!
                                current_scene_graph_delta = scene_graph_delta;
                            }
                            Err(e) => {
                                eprintln!("Error executing trim operation: {:?}", e);
                                // Continue to next operation instead of failing completely
                                // Some operations (like addCoincidentConstraint) can fail without breaking the trim
                            }
                        }

                        // Advance to the next unprocessed operation
                        op_index += consumed_ops;
                    }

                    // Move to next segment (or re-check same segment if deletion occurred)
                    let old_start_index = start_index;
                    start_index = match &next_trim_result_core {
                        NextTrimResultCore::TrimSpawn { next_index, .. } => *next_index,
                        NextTrimResultCore::NoTrimSpawn { .. } => {
                            // Should not happen here
                            break;
                        }
                    };

                    // Fail-safe: if nextIndex didn't advance and we didn't delete, force it to advance
                    if start_index <= old_start_index {
                        if !was_deleted {
                            start_index = old_start_index + 1;
                        }
                    }
                }
            }
        }

        if iteration_count >= max_iterations {
            eprintln!("ERROR: Reached max iterations ({}). Breaking loop.", max_iterations);
        }

        // Return the last result or execute mock to get current state
        let (source_delta, mut scene_graph_delta) = if let Some((sd, sgd)) = last_result {
            // If source_delta is empty, it means no operations were executed
            // In this case, we should return the original source code unchanged, not an empty string
            if sd.text.is_empty() {
                // Get the current source code by executing mock, which returns the unchanged source
                guard
                    .execute_mock(&ctx, version, actual_sketch_id)
                    .await
                    .map_err(|e| format!("Failed to execute mock: {:?}", e))?
            } else {
                (sd, sgd)
            }
        } else {
            guard
                .execute_mock(&ctx, version, actual_sketch_id)
                .await
                .map_err(|e| format!("Failed to execute mock: {:?}", e))?
        };

        // Set invalidates_ids if any operation invalidated IDs
        scene_graph_delta.invalidates_ids = invalidates_ids;

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
