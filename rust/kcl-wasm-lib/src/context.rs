//! The wasm engine interface.

use std::sync::Arc;

use gloo_utils::format::JsValueSerdeExt;
use kcl_lib::ExecOutcome;
use kcl_lib::ExecutionCallbacks;
use kcl_lib::KclError;
use kcl_lib::KclErrorWithOutputs;
use kcl_lib::MockConfig;
use kcl_lib::NodePath;
use kcl_lib::OperationCallbackArgs;
use kcl_lib::Program;
use kcl_lib::ProjectManager;
use kcl_lib::SourceRange;
use kcl_lib::front::FrontendRenderPacketMetadata;
use kcl_lib::front::FrontendRenderPacketSketchSegment;
use kcl_lib::front::FrontendState;
use kcl_lib::front::ObjectKind;
use kcl_lib::front::SceneGraphDelta;
use kcl_lib::front::SourceRef;
use kcl_lib::wasm_engine::FileManager;
use kittycad_modeling_cmds::format::render_packet::RENDER_PACKET_HEADER_SIZE;
use kittycad_modeling_cmds::format::render_packet::RENDER_PACKET_MAGIC;
use kittycad_modeling_cmds::format::render_packet::RENDER_PACKET_VERSION;
use kittycad_modeling_cmds::format::render_packet::RenderPacket;
use kittycad_modeling_cmds::format::render_packet::RenderPacketBinarySection;
use wasm_bindgen::prelude::*;

pub(crate) const TRUE_BUG: &str = "This is a bug in KCL and not in your code, please report this to Zoo.";

#[wasm_bindgen]
extern "C" {
    #[derive(Debug, Clone)]
    pub type JsExecutionCallbacks;

    #[wasm_bindgen(method, js_name = onOperation)]
    fn on_operation(this: &JsExecutionCallbacks, args: JsValue);
}

impl ExecutionCallbacks for JsExecutionCallbacks {
    fn on_operation(&self, args: OperationCallbackArgs) {
        let js_args = match JsValue::from_serde(&args) {
            Ok(value) => value,
            Err(err) => {
                web_sys::console::error_1(&JsValue::from_str(&format!(
                    "Failed to serialize operation callback args: {err}"
                )));
                return;
            }
        };

        self.on_operation(js_args);
    }
}

#[wasm_bindgen]
pub struct Context {
    engine: Arc<kcl_lib::wasm_engine::EngineConnection>,
    response_context: Arc<kcl_lib::wasm_engine::ResponseContext>,
    fs: kcl_lib::FileSystemHandle,
    mock_engine: Arc<kcl_lib::wasm_engine::EngineConnection>,
    execution_callbacks: Option<JsExecutionCallbacks>,
    pub(crate) project_manager: ProjectManager,
    pub(crate) frontend: Arc<tokio::sync::RwLock<FrontendState>>,
}

#[wasm_bindgen]
impl Context {
    #[wasm_bindgen(constructor)]
    pub fn new(
        engine_manager: kcl_lib::wasm_engine::EngineCommandManager,
        fs_manager: kcl_lib::wasm_engine::FileSystemManager,
        execution_callbacks: Option<JsExecutionCallbacks>,
    ) -> Result<Self, JsValue> {
        console_error_panic_hook::set_once();
        // Initialize the thread pool for rayon. For some reason, this wasn't
        // happening automatically. It may return an error if it was already
        // initialized, so ignore the result.
        let _ = rayon::ThreadPoolBuilder::new()
            .num_threads(1)
            .use_current_thread()
            .build_global();

        let response_context = Arc::new(kcl_lib::wasm_engine::ResponseContext::new());
        Ok(Self {
            engine: Arc::new(kcl_lib::wasm_engine::EngineConnection::new_wasm_transport(
                engine_manager,
                response_context.clone(),
            )),
            fs: kcl_lib::new_file_system_handle(FileManager::new(fs_manager)),
            mock_engine: Arc::new(kcl_lib::wasm_engine::EngineConnection::new_mock()),
            execution_callbacks,
            response_context,
            project_manager: ProjectManager,
            frontend: Arc::new(tokio::sync::RwLock::new(FrontendState::new())),
        })
    }

    #[wasm_bindgen(js_name = cloneWithExecuteCallbacks)]
    pub fn clone_with_execute_callbacks(&self, execution_callbacks: JsExecutionCallbacks) -> Self {
        Self {
            engine: self.engine.clone(),
            response_context: self.response_context.clone(),
            fs: self.fs.clone(),
            mock_engine: self.mock_engine.clone(),
            execution_callbacks: Some(execution_callbacks),
            project_manager: self.project_manager.clone(),
            frontend: self.frontend.clone(),
        }
    }

    pub(crate) fn create_executor_ctx(
        &self,
        settings: &str,
        path: Option<String>,
        is_mock: bool,
    ) -> Result<kcl_lib::ExecutorContext, String> {
        let config: kcl_lib::Configuration = serde_json::from_str(settings).map_err(|e| e.to_string())?;
        let mut settings: kcl_lib::ExecutorSettings = config.into();
        if let Some(path_src) = path {
            settings.with_current_file(kcl_lib::TypedPath::from(&path_src));
        }

        let mut ctx = if is_mock {
            kcl_lib::ExecutorContext::new_mock(self.mock_engine.clone(), self.fs.clone(), settings)
        } else {
            kcl_lib::ExecutorContext::new_with_engine_and_fs(self.engine.clone(), self.fs.clone(), settings)
        };

        ctx.execution_callbacks = self
            .execution_callbacks
            .clone()
            .map(|callbacks| Arc::new(callbacks) as Arc<dyn ExecutionCallbacks>);
        Ok(ctx)
    }

    /// Execute a program.
    #[wasm_bindgen]
    pub async fn execute(
        &self,
        program_ast_json: &str,
        path: Option<String>,
        settings: &str,
    ) -> Result<JsValue, JsValue> {
        console_error_panic_hook::set_once();

        self.execute_typed(program_ast_json, path, settings)
            .await
            .and_then(|outcome| {
                JsValue::from_serde(&outcome).map_err(|e| {
                    // The serde-wasm-bindgen does not work here because of weird HashMap issues.
                    // DO NOT USE serde_wasm_bindgen::to_value it will break the frontend.
                    KclErrorWithOutputs::no_outputs(KclError::internal(format!(
                        "Could not serialize successful KCL result. {TRUE_BUG} Details: {e}"
                    )))
                })
            })
            .map_err(|e: KclErrorWithOutputs| JsValue::from_serde(&e).unwrap())
    }

    async fn execute_typed(
        &self,
        program_ast_json: &str,
        path: Option<String>,
        settings: &str,
    ) -> Result<SceneGraphDelta, KclErrorWithOutputs> {
        let program: Program = serde_json::from_str(program_ast_json).map_err(|e| {
            let err = KclError::internal(format!("Could not deserialize KCL AST. {TRUE_BUG} Details: {e}"));
            KclErrorWithOutputs::no_outputs(err)
        })?;
        let program = program.fill_node_paths();
        let ctx = self.create_executor_ctx(settings, path, false).map_err(|e| {
            KclErrorWithOutputs::no_outputs(KclError::internal(format!(
                "Could not create KCL executor context. {TRUE_BUG} Details: {e}"
            )))
        })?;

        let frontend = Arc::clone(&self.frontend);
        let mut guard = frontend.write().await;
        guard.engine_execute(&ctx, program).await
    }

    /// Reset the scene and bust the cache.
    /// ONLY use this if you absolutely need to reset the scene and bust the cache.
    #[wasm_bindgen(js_name = bustCacheAndResetScene)]
    pub async fn bust_cache_and_reset_scene(&self, settings: &str, path: Option<String>) -> Result<JsValue, String> {
        console_error_panic_hook::set_once();

        let ctx = self.create_executor_ctx(settings, path, false)?;
        match ctx.bust_cache_and_reset_scene().await {
            // The serde-wasm-bindgen does not work here because of weird HashMap issues.
            // DO NOT USE serde_wasm_bindgen::to_value it will break the frontend.
            Ok(outcome) => JsValue::from_serde(&outcome).map_err(|e| e.to_string()),
            Err(err) => Err(serde_json::to_string(&err).map_err(|serde_err| serde_err.to_string())?),
        }
    }

    /// Send a response to kcl lib's engine.
    #[wasm_bindgen(js_name = sendResponse)]
    pub async fn send_response(&self, data: js_sys::Uint8Array) {
        self.response_context.send_response(data).await
    }

    /// Execute a program in mock mode.
    #[wasm_bindgen(js_name = executeMock)]
    pub async fn execute_mock(
        &self,
        program_ast_json: &str,
        path: Option<String>,
        settings: &str,
        use_prev_memory: bool,
    ) -> Result<JsValue, JsValue> {
        console_error_panic_hook::set_once();

        self.execute_mock_typed(program_ast_json, path, settings, use_prev_memory)
            .await
            .and_then(|outcome| {
                JsValue::from_serde(&outcome).map_err(|e| {
                    // The serde-wasm-bindgen does not work here because of weird HashMap issues.
                    // DO NOT USE serde_wasm_bindgen::to_value it will break the frontend.
                    KclErrorWithOutputs::no_outputs(KclError::internal(format!(
                        "Could not serialize successful KCL result. {TRUE_BUG} Details: {e}"
                    )))
                })
            })
            .map_err(|e: KclErrorWithOutputs| JsValue::from_serde(&e).unwrap())
    }

    async fn execute_mock_typed(
        &self,
        program_ast_json: &str,
        path: Option<String>,
        settings: &str,
        use_prev_memory: bool,
    ) -> Result<ExecOutcome, KclErrorWithOutputs> {
        let program: Program = serde_json::from_str(program_ast_json).map_err(|e| {
            let err = KclError::internal(format!("Could not deserialize KCL AST. {TRUE_BUG} Details: {e}"));
            KclErrorWithOutputs::no_outputs(err)
        })?;
        let program = program.fill_node_paths();
        let ctx = self.create_executor_ctx(settings, path, true).map_err(|e| {
            KclErrorWithOutputs::no_outputs(KclError::internal(format!(
                "Could not create KCL executor context. {TRUE_BUG} Details: {e}"
            )))
        })?;
        let mock_config = MockConfig {
            use_prev_memory,
            ..Default::default()
        };
        ctx.run_mock(&program, &mock_config).await
    }

    /// Export a scene to a file.
    #[wasm_bindgen]
    pub async fn export(&self, format_json: &str, settings: &str) -> Result<JsValue, String> {
        console_error_panic_hook::set_once();

        let format: kittycad_modeling_cmds::format::OutputFormat3d =
            serde_json::from_str(format_json).map_err(|e| e.to_string())?;

        let ctx = self.create_executor_ctx(settings, None, false)?;

        match ctx.export(format).await {
            // The serde-wasm-bindgen does not work here because of weird HashMap issues.
            // DO NOT USE serde_wasm_bindgen::to_value it will break the frontend.
            Ok(outcome) => JsValue::from_serde(&outcome).map_err(|e| e.to_string()),
            Err(err) => Err(serde_json::to_string(&err).map_err(|serde_err| serde_err.to_string())?),
        }
    }

    /// Export a scene to a browser render packet.
    #[wasm_bindgen(js_name = exportRenderPacket)]
    pub async fn export_render_packet(&self, settings: &str) -> Result<JsValue, String> {
        console_error_panic_hook::set_once();

        let ctx = self.create_executor_ctx(settings, None, false)?;
        let files = ctx
            .export(kittycad_modeling_cmds::format::OutputFormat3d::RenderPacket(
                Default::default(),
            ))
            .await
            .map_err(|err| serde_json::to_string(&err).unwrap_or_else(|serde_err| serde_err.to_string()))?;

        let packet_file = files
            .iter()
            .find(|file| file.name.ends_with(".render_packet.bin"))
            .or_else(|| files.first())
            .ok_or_else(|| "render packet export returned no files".to_owned())?;

        let (packet, binary_data) = decode_render_packet(&packet_file.contents)?;

        let frontend = self.frontend.read().await;
        let metadata = enrich_render_packet(packet, frontend.scene_graph());

        let result = js_sys::Object::new();
        let metadata = JsValue::from_serde(&metadata).map_err(|error| error.to_string())?;
        js_sys::Reflect::set(&result, &JsValue::from_str("metadata"), &metadata)
            .map_err(|_| "failed to attach render packet metadata".to_owned())?;
        let data = js_sys::Uint8Array::from(binary_data);
        js_sys::Reflect::set(&result, &JsValue::from_str("data"), &data)
            .map_err(|_| "failed to attach render packet binary data".to_owned())?;

        Ok(result.into())
    }
}

fn align_to_four(value: usize) -> usize {
    (value + 3) & !3
}

fn validate_render_packet_section(
    name: &str,
    section: &RenderPacketBinarySection,
    binary_len: usize,
) -> Result<(), String> {
    if section.byte_offset % 4 != 0 {
        return Err(format!("render packet section {name} is not 4-byte aligned"));
    }
    let end = (section.byte_offset as usize)
        .checked_add(section.byte_length as usize)
        .ok_or_else(|| format!("render packet section {name} range overflowed"))?;
    if end > binary_len {
        return Err(format!("render packet section {name} exceeds the binary payload"));
    }
    Ok(())
}

fn decode_render_packet(bytes: &[u8]) -> Result<(RenderPacket, &[u8]), String> {
    if bytes.len() < RENDER_PACKET_HEADER_SIZE {
        return Err("render packet is shorter than its fixed header".to_owned());
    }
    if bytes[..RENDER_PACKET_MAGIC.len()] != RENDER_PACKET_MAGIC {
        return Err("render packet has an invalid magic value".to_owned());
    }

    let version = u32::from_le_bytes(
        bytes[8..12]
            .try_into()
            .map_err(|_| "render packet version is truncated".to_owned())?,
    );
    if version != RENDER_PACKET_VERSION {
        return Err(format!(
            "unsupported render packet version {version}; expected {RENDER_PACKET_VERSION}"
        ));
    }
    let metadata_len = u32::from_le_bytes(
        bytes[12..16]
            .try_into()
            .map_err(|_| "render packet metadata length is truncated".to_owned())?,
    ) as usize;
    let metadata_end = RENDER_PACKET_HEADER_SIZE
        .checked_add(metadata_len)
        .ok_or_else(|| "render packet metadata range overflowed".to_owned())?;
    let binary_offset = align_to_four(metadata_end);
    if binary_offset > bytes.len() {
        return Err("render packet metadata exceeds the packet length".to_owned());
    }

    let packet: RenderPacket =
        serde_json::from_slice(&bytes[RENDER_PACKET_HEADER_SIZE..metadata_end]).map_err(|error| error.to_string())?;
    if packet.version != version {
        return Err(format!(
            "render packet header version {version} does not match metadata version {}",
            packet.version
        ));
    }

    let binary_data = &bytes[binary_offset..];
    for (name, section) in [
        ("vertices", &packet.sections.vertices),
        ("primitiveIndices", &packet.sections.primitive_indices),
        ("indices", &packet.sections.indices),
        ("trimPoints", &packet.sections.trim_points),
        ("edgePoints", &packet.sections.edge_points),
        ("sketchPoints", &packet.sections.sketch_points),
        ("regionPoints", &packet.sections.region_points),
    ] {
        validate_render_packet_section(name, section, binary_data.len())?;
    }

    Ok((packet, binary_data))
}

#[derive(Clone)]
struct FrontendSketchSegmentIdentity {
    artifact_id: uuid::Uuid,
    source_range: Option<SourceRange>,
    node_path: Option<NodePath>,
}

fn source_ref_identity(artifact_id: uuid::Uuid, source: &SourceRef) -> FrontendSketchSegmentIdentity {
    match source {
        SourceRef::Simple { range, node_path } => FrontendSketchSegmentIdentity {
            artifact_id,
            source_range: Some(*range),
            node_path: node_path.clone(),
        },
        SourceRef::BackTrace { ranges } => {
            let Some((range, node_path)) = ranges.first() else {
                return FrontendSketchSegmentIdentity {
                    artifact_id,
                    source_range: None,
                    node_path: None,
                };
            };
            FrontendSketchSegmentIdentity {
                artifact_id,
                source_range: Some(*range),
                node_path: node_path.clone(),
            }
        }
    }
}

fn collect_scene_graph_sketch_segments(
    scene_graph: &kcl_lib::front::SceneGraph,
) -> Vec<Vec<FrontendSketchSegmentIdentity>> {
    scene_graph
        .objects
        .iter()
        .filter_map(|object| {
            let ObjectKind::Sketch(sketch) = &object.kind else {
                return None;
            };

            let segments = sketch
                .segments
                .iter()
                .filter_map(|segment_object_id| {
                    let segment_object = scene_graph.objects.get(segment_object_id.0)?;
                    let ObjectKind::Segment { segment } = &segment_object.kind else {
                        return None;
                    };
                    if matches!(segment, kcl_lib::front::Segment::Point(_)) {
                        return None;
                    }

                    Some(source_ref_identity(
                        uuid::Uuid::from(segment_object.artifact_id),
                        &segment_object.source,
                    ))
                })
                .collect::<Vec<_>>();

            Some(segments)
        })
        .collect()
}

fn group_packet_sketch_indices(
    packet: &kittycad_modeling_cmds::format::render_packet::RenderPacket,
) -> Vec<Vec<usize>> {
    let mut groups: Vec<Vec<usize>> = Vec::new();
    let mut current_sketch_id = None;

    for (index, sketch) in packet.sketches.iter().enumerate() {
        if current_sketch_id != Some(sketch.sketch_id) {
            groups.push(Vec::new());
            current_sketch_id = Some(sketch.sketch_id);
        }
        groups
            .last_mut()
            .expect("group should exist before pushing packet sketch index")
            .push(index);
    }

    groups
}

fn enrich_render_packet(
    packet: RenderPacket,
    scene_graph: &kcl_lib::front::SceneGraph,
) -> FrontendRenderPacketMetadata {
    let packet_groups = group_packet_sketch_indices(&packet);
    let scene_graph_groups = collect_scene_graph_sketch_segments(scene_graph);
    let packet_sketch_ids = packet
        .sketches
        .iter()
        .map(|segment| segment.sketch_id)
        .collect::<Vec<_>>();
    let mut region_sketch_artifact_ids = std::collections::HashMap::new();
    let mut sketches = packet
        .sketches
        .into_iter()
        .map(|segment| FrontendRenderPacketSketchSegment {
            first_point: segment.first_point,
            point_count: segment.point_count,
            sketch_id: segment.sketch_id,
            segment_id: segment.segment_id,
            segment_index: segment.segment_index,
            hole_index: segment.hole_index,
            closed: segment.closed,
            source_range: None,
            node_path: None,
        })
        .collect::<Vec<_>>();

    for (packet_group, scene_graph_group) in packet_groups.iter().zip(scene_graph_groups.iter()) {
        for (packet_index, identity) in packet_group.iter().zip(scene_graph_group.iter()) {
            let sketch = &mut sketches[*packet_index];
            sketch.source_range = identity.source_range;
            sketch.node_path = identity.node_path.clone();
            region_sketch_artifact_ids
                .entry(packet_sketch_ids[*packet_index])
                .or_insert(identity.artifact_id);
        }
    }

    let regions = packet
        .regions
        .into_iter()
        .map(|mut region| {
            if let Some(artifact_id) = region_sketch_artifact_ids.get(&region.sketch_id) {
                region.sketch_id = *artifact_id;
                region.parent_id = *artifact_id;
            }
            region
        })
        .collect();

    FrontendRenderPacketMetadata {
        version: packet.version,
        vertex_layout: packet.vertex_layout,
        sections: packet.sections,
        body_materials: packet.body_materials,
        primitives: packet.primitives,
        edges: packet.edges,
        sketches,
        regions,
    }
}
