//! Native OpenCascade engine backend.
//!
//! The native backend calls the shared C++ OCCT command core through a small C
//! ABI, then maps the protocol result into the strongly typed modeling response
//! shape expected by the KCL executor. The same C++ source is compiled to an
//! Emscripten module for the browser transport.

use std::collections::HashMap;
use std::ffi::{CStr, CString, c_char};
use std::io::Cursor;
use std::sync::Arc;

use anyhow::Result;
use image::ImageFormat;
use image::Rgba;
use image::RgbaImage;
use indexmap::IndexMap;
use kcmc::base64::Base64Data;
use kcmc::ok_response::OkModelingCmdResponse;
use kcmc::websocket::BatchResponse;
use kcmc::websocket::ModelingBatch;
use kcmc::websocket::OkWebSocketResponseData;
use kcmc::websocket::SuccessWebSocketResponse;
use kcmc::websocket::WebSocketRequest;
use kcmc::websocket::WebSocketResponse;
use kittycad_modeling_cmds::ImportFiles;
use kittycad_modeling_cmds::ModelingCmd;
use kittycad_modeling_cmds::websocket::ModelingCmdReq;
use kittycad_modeling_cmds::{self as kcmc};
use serde::Deserialize;
use tokio::sync::RwLock;
use uuid::Uuid;

use crate::SourceRange;
use crate::engine::AsyncTasks;
use crate::engine::EngineBatchContext;
use crate::engine::EngineStats;
use crate::errors::{KclError, KclErrorDetails};
use crate::exec::DefaultPlanes;
use crate::execution::IdGenerator;

unsafe extern "C" {
    fn zoo_occt_core_has_native_occt() -> i32;
    fn zoo_occt_core_start_new_session() -> *mut c_char;
    fn zoo_occt_core_record_rollback_marker(source_range_json: *const c_char) -> *mut c_char;
    fn zoo_occt_core_handle_modeling_command(request_id: *const c_char, request_json: *const c_char) -> *mut c_char;
    fn zoo_occt_core_debug_geometry_state() -> *mut c_char;
    fn zoo_occt_core_free(value: *mut c_char);
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CoreResponse {
    ok: bool,
    response: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CoreGeometryState {
    ok: bool,
    geometry_backend: String,
    native_occt: bool,
    shape_count: usize,
    shapes: Vec<CoreShapeSummary>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CoreShapeSummary {
    command_id: String,
    kind: String,
    body_type: String,
    volume: f64,
}

#[derive(Debug, Clone)]
pub struct EngineConnection {
    ids_of_async_commands: Arc<RwLock<IndexMap<Uuid, SourceRange>>>,
    responses: Arc<RwLock<IndexMap<Uuid, WebSocketResponse>>>,
    /// The default planes for the scene.
    default_planes: Arc<RwLock<Option<DefaultPlanes>>>,
    stats: EngineStats,
    async_tasks: AsyncTasks,
}

impl EngineConnection {
    pub fn new() -> Result<EngineConnection> {
        let connection = EngineConnection {
            ids_of_async_commands: Arc::new(RwLock::new(IndexMap::new())),
            responses: Arc::new(RwLock::new(IndexMap::new())),
            default_planes: Default::default(),
            stats: Default::default(),
            async_tasks: AsyncTasks::new(),
        };
        connection.start_core_session()?;
        Ok(connection)
    }

    fn start_core_session(&self) -> Result<(), KclError> {
        let response = call_core(|| unsafe { zoo_occt_core_start_new_session() }, SourceRange::default())?;
        parse_core_response(&response, SourceRange::default())?;
        Ok(())
    }

    fn send_to_core(
        &self,
        id: Uuid,
        cmd: &WebSocketRequest,
        source_range: SourceRange,
    ) -> Result<CoreResponse, KclError> {
        let request_id = CString::new(id.to_string()).map_err(|e| core_error(e.to_string(), source_range))?;
        let request_json =
            CString::new(serde_json::to_string(cmd).map_err(|e| core_error(e.to_string(), source_range))?)
                .map_err(|e| core_error(e.to_string(), source_range))?;
        let response = call_core(
            || unsafe { zoo_occt_core_handle_modeling_command(request_id.as_ptr(), request_json.as_ptr()) },
            source_range,
        )?;
        parse_core_response(&response, source_range)
    }

    fn debug_geometry_state(&self, source_range: SourceRange) -> Result<CoreGeometryState, KclError> {
        let response = call_core(|| unsafe { zoo_occt_core_debug_geometry_state() }, source_range)?;
        let state: CoreGeometryState = serde_json::from_str(&response).map_err(|e| {
            core_error(
                format!("Could not parse OCCT command core geometry state: {e}; response={response}"),
                source_range,
            )
        })?;
        if !state.ok {
            return Err(core_error(
                format!("OCCT command core rejected geometry-state request: {response}"),
                source_range,
            ));
        }
        Ok(state)
    }

    fn modeling_response_for_command(
        &self,
        cmd_id: Uuid,
        cmd: &ModelingCmd,
        source_range: SourceRange,
    ) -> Result<OkModelingCmdResponse, KclError> {
        match cmd {
            ModelingCmd::ImportFiles(ImportFiles { .. }) => Ok(OkModelingCmdResponse::ImportFiles(
                kittycad_modeling_cmds::output::ImportFiles::builder()
                    .object_id(cmd_id.into())
                    .build(),
            )),
            ModelingCmd::TakeSnapshot(_) => {
                let state = self.debug_geometry_state(source_range)?;
                let contents = render_snapshot_png(&state, source_range)?;
                let snapshot = serde_json::from_value(serde_json::json!({
                    "contents": Base64Data(contents),
                }))
                .map_err(|e| core_error(format!("Could not build OCCT snapshot response: {e}"), source_range))?;
                Ok(OkModelingCmdResponse::TakeSnapshot(snapshot))
            }
            _ => Ok(OkModelingCmdResponse::Empty {}),
        }
    }

    pub fn has_native_occt_geometry() -> bool {
        unsafe { zoo_occt_core_has_native_occt() != 0 }
    }
}

#[async_trait::async_trait]
impl crate::engine::EngineManager for EngineConnection {
    fn responses(&self) -> Arc<RwLock<IndexMap<Uuid, WebSocketResponse>>> {
        self.responses.clone()
    }

    fn stats(&self) -> &EngineStats {
        &self.stats
    }

    fn ids_of_async_commands(&self) -> Arc<RwLock<IndexMap<Uuid, SourceRange>>> {
        self.ids_of_async_commands.clone()
    }

    fn async_tasks(&self) -> AsyncTasks {
        self.async_tasks.clone()
    }

    fn get_default_planes(&self) -> Arc<RwLock<Option<DefaultPlanes>>> {
        self.default_planes.clone()
    }

    async fn clear_scene_post_hook(
        &self,
        _batch_context: &EngineBatchContext,
        _id_generator: &mut IdGenerator,
        _source_range: SourceRange,
    ) -> Result<(), KclError> {
        Ok(())
    }

    async fn record_rollback_marker(&self, source_range: SourceRange) -> Result<bool, KclError> {
        let source_range_json =
            CString::new(serde_json::to_string(&source_range).map_err(|e| core_error(e.to_string(), source_range))?)
                .map_err(|e| core_error(e.to_string(), source_range))?;
        let response = call_core(
            || unsafe { zoo_occt_core_record_rollback_marker(source_range_json.as_ptr()) },
            source_range,
        )?;
        let core = parse_core_response(&response, source_range)?;
        Ok(core.ok)
    }

    async fn get_debug(&self) -> Option<OkWebSocketResponseData> {
        None
    }

    async fn fetch_debug(&self) -> Result<(), KclError> {
        Ok(())
    }

    async fn inner_fire_modeling_cmd(
        &self,
        id: uuid::Uuid,
        source_range: SourceRange,
        cmd: WebSocketRequest,
        id_to_source_range: HashMap<Uuid, SourceRange>,
    ) -> Result<(), KclError> {
        // Pop off the id we care about.
        self.ids_of_async_commands.write().await.swap_remove(&id);

        // Add the response to our responses.
        let response = self
            .inner_send_modeling_cmd(id, source_range, cmd, id_to_source_range)
            .await?;
        self.responses().write().await.insert(id, response);

        Ok(())
    }

    async fn inner_send_modeling_cmd(
        &self,
        id: uuid::Uuid,
        source_range: SourceRange,
        cmd: WebSocketRequest,
        _id_to_source_range: HashMap<Uuid, SourceRange>,
    ) -> Result<WebSocketResponse, KclError> {
        let core = self.send_to_core(id, &cmd, source_range)?;
        match cmd {
            WebSocketRequest::ModelingCmdBatchReq(ModelingBatch {
                ref requests,
                batch_id: _,
                responses: _,
            }) => {
                if core.response != "batch" {
                    return Err(core_error(
                        format!("OCCT core returned {:?} for a modeling batch", core.response),
                        source_range,
                    ));
                }
                let mut responses = HashMap::with_capacity(requests.len());
                for request in requests {
                    responses.insert(
                        request.cmd_id,
                        BatchResponse::Success {
                            response: self.modeling_response_for_command(
                                request.cmd_id.into(),
                                &request.cmd,
                                source_range,
                            )?,
                        },
                    );
                }
                Ok(WebSocketResponse::Success(SuccessWebSocketResponse {
                    request_id: Some(id),
                    resp: OkWebSocketResponseData::ModelingBatch { responses },
                    success: true,
                }))
            }
            WebSocketRequest::ModelingCmdReq(ModelingCmdReq { cmd, cmd_id }) => {
                if core.response != "modeling" {
                    return Err(core_error(
                        format!("OCCT core returned {:?} for a modeling command", core.response),
                        source_range,
                    ));
                }
                Ok(WebSocketResponse::Success(SuccessWebSocketResponse {
                    request_id: Some(id),
                    resp: OkWebSocketResponseData::Modeling {
                        modeling_response: self.modeling_response_for_command(cmd_id.into(), &cmd, source_range)?,
                    },
                    success: true,
                }))
            }
            _ => Ok(WebSocketResponse::Success(SuccessWebSocketResponse {
                request_id: Some(id),
                resp: OkWebSocketResponseData::Modeling {
                    modeling_response: OkModelingCmdResponse::Empty {},
                },
                success: true,
            })),
        }
    }

    async fn close(&self) {}
}

fn call_core<F>(call: F, source_range: SourceRange) -> Result<String, KclError>
where
    F: FnOnce() -> *mut c_char,
{
    let raw = call();
    if raw.is_null() {
        return Err(core_error("OCCT command core returned a null response", source_range));
    }

    let value = unsafe { CStr::from_ptr(raw) }.to_string_lossy().into_owned();
    unsafe { zoo_occt_core_free(raw) };
    Ok(value)
}

fn parse_core_response(response: &str, source_range: SourceRange) -> Result<CoreResponse, KclError> {
    let parsed: CoreResponse = serde_json::from_str(response).map_err(|e| {
        core_error(
            format!("Could not parse OCCT command core response: {e}; response={response}"),
            source_range,
        )
    })?;
    if !parsed.ok {
        return Err(core_error(
            format!("OCCT command core rejected request: {response}"),
            source_range,
        ));
    }
    Ok(parsed)
}

fn core_error(message: impl Into<String>, source_range: SourceRange) -> KclError {
    KclError::new_engine(KclErrorDetails::new(message.into(), vec![source_range]))
}

fn render_snapshot_png(state: &CoreGeometryState, source_range: SourceRange) -> Result<Vec<u8>, KclError> {
    const WIDTH: u32 = 960;
    const HEIGHT: u32 = 720;
    let mut img = RgbaImage::from_pixel(WIDTH, HEIGHT, Rgba([248, 250, 252, 255]));

    draw_grid(&mut img);
    draw_label_markers(&mut img, state);

    if state.shapes.is_empty() {
        draw_empty_scene(&mut img);
    } else {
        let count = state.shapes.len();
        let spacing = 2.6;
        let total = (count.saturating_sub(1) as f64) * spacing;
        for (index, shape) in state.shapes.iter().enumerate() {
            let x = index as f64 * spacing - total / 2.0;
            draw_shape_proxy(&mut img, shape, [x, 0.0, 0.0]);
        }
    }

    let mut bytes = Cursor::new(Vec::new());
    image::DynamicImage::ImageRgba8(img)
        .write_to(&mut bytes, ImageFormat::Png)
        .map_err(|e| core_error(format!("Could not encode OCCT snapshot PNG: {e}"), source_range))?;
    Ok(bytes.into_inner())
}

fn draw_grid(img: &mut RgbaImage) {
    const STEP: usize = 48;
    let grid = Rgba([226, 232, 240, 255]);
    for x in (0..img.width()).step_by(STEP) {
        draw_line_2d(img, (x as i32, 0), (x as i32, img.height() as i32 - 1), grid);
    }
    for y in (0..img.height()).step_by(STEP) {
        draw_line_2d(img, (0, y as i32), (img.width() as i32 - 1, y as i32), grid);
    }
}

fn draw_label_markers(img: &mut RgbaImage, state: &CoreGeometryState) {
    let color = if state.native_occt {
        Rgba([16, 185, 129, 255])
    } else {
        Rgba([245, 158, 11, 255])
    };
    let width = (state.shape_count.max(1) as i32 * 18).min(260);
    fill_rect(img, 28, 28, 24 + width, 48, color);
    let backend_color = if state.geometry_backend == "native_occt" {
        Rgba([15, 118, 110, 255])
    } else {
        Rgba([180, 83, 9, 255])
    };
    fill_rect(img, 28, 54, 160, 62, backend_color);
}

fn draw_empty_scene(img: &mut RgbaImage) {
    let center = (img.width() as i32 / 2, img.height() as i32 / 2);
    let color = Rgba([100, 116, 139, 255]);
    draw_line_2d(img, (center.0 - 60, center.1), (center.0 + 60, center.1), color);
    draw_line_2d(img, (center.0, center.1 - 60), (center.0, center.1 + 60), color);
}

fn draw_shape_proxy(img: &mut RgbaImage, shape: &CoreShapeSummary, offset: [f64; 3]) {
    let volume_scale = if shape.volume.is_finite() && shape.volume > 0.0 {
        shape.volume.cbrt().clamp(0.8, 4.0)
    } else {
        1.2
    };
    let surface = shape.body_type == "surface";
    let height = if surface { 0.08 } else { volume_scale * 0.72 };
    let width = if shape.kind.contains("revolve") {
        volume_scale * 0.92
    } else {
        volume_scale
    };
    let depth = if shape.kind.contains("revolve") {
        volume_scale * 0.92
    } else {
        volume_scale * 0.78
    };
    let z = height / 2.0;
    let id_tint = shape.command_id.bytes().fold(0u8, |acc, byte| acc.wrapping_add(byte)) % 24;
    let base = [
        [offset[0] - width / 2.0, offset[1] - depth / 2.0, offset[2] - z],
        [offset[0] + width / 2.0, offset[1] - depth / 2.0, offset[2] - z],
        [offset[0] + width / 2.0, offset[1] + depth / 2.0, offset[2] - z],
        [offset[0] - width / 2.0, offset[1] + depth / 2.0, offset[2] - z],
    ];
    let top = [
        [base[0][0], base[0][1], offset[2] + z],
        [base[1][0], base[1][1], offset[2] + z],
        [base[2][0], base[2][1], offset[2] + z],
        [base[3][0], base[3][1], offset[2] + z],
    ];
    let top_color = if surface {
        Rgba([56, 189, 248, 210])
    } else {
        Rgba([132 + id_tint / 3, 160 + id_tint / 4, 198, 255])
    };
    let left_color = if surface {
        Rgba([14, 116, 144, 170])
    } else {
        Rgba([73, 96, 128, 255])
    };
    let right_color = if surface {
        Rgba([8, 145, 178, 185])
    } else {
        Rgba([92, 117, 150, 255])
    };

    fill_polygon_2d(
        img,
        &[project(base[0]), project(base[3]), project(top[3]), project(top[0])],
        left_color,
    );
    fill_polygon_2d(
        img,
        &[project(base[1]), project(base[2]), project(top[2]), project(top[1])],
        right_color,
    );
    fill_polygon_2d(
        img,
        &[project(top[0]), project(top[1]), project(top[2]), project(top[3])],
        top_color,
    );

    let edge = Rgba([51, 65, 85, 255]);
    for poly in [&base, &top] {
        for i in 0..4 {
            draw_line_2d(img, project(poly[i]), project(poly[(i + 1) % 4]), edge);
        }
    }
    for i in 0..4 {
        draw_line_2d(img, project(base[i]), project(top[i]), edge);
    }
}

fn project(point: [f64; 3]) -> (i32, i32) {
    let scale = 74.0;
    let x = (point[0] - point[1]) * 0.866 * scale + 480.0;
    let y = (point[0] + point[1]) * 0.32 * scale - point[2] * scale + 380.0;
    (x.round() as i32, y.round() as i32)
}

fn fill_rect(img: &mut RgbaImage, x0: i32, y0: i32, x1: i32, y1: i32, color: Rgba<u8>) {
    for y in y0.min(y1)..=y0.max(y1) {
        for x in x0.min(x1)..=x0.max(x1) {
            put_pixel_checked(img, x, y, color);
        }
    }
}

fn fill_polygon_2d(img: &mut RgbaImage, points: &[(i32, i32)], color: Rgba<u8>) {
    if points.len() < 3 {
        return;
    }
    let min_y = points.iter().map(|p| p.1).min().unwrap_or(0).max(0);
    let max_y = points
        .iter()
        .map(|p| p.1)
        .max()
        .unwrap_or(0)
        .min(img.height() as i32 - 1);

    for y in min_y..=max_y {
        let mut xs = Vec::new();
        for i in 0..points.len() {
            let (x0, y0) = points[i];
            let (x1, y1) = points[(i + 1) % points.len()];
            if y0 == y1 {
                continue;
            }
            let ymin = y0.min(y1);
            let ymax = y0.max(y1);
            if y >= ymin && y < ymax {
                let t = (y - y0) as f64 / (y1 - y0) as f64;
                xs.push((x0 as f64 + t * (x1 - x0) as f64).round() as i32);
            }
        }
        xs.sort_unstable();
        for pair in xs.chunks(2) {
            if let [x0, x1] = pair {
                for x in *x0..=*x1 {
                    put_pixel_checked(img, x, y, color);
                }
            }
        }
    }
}

fn draw_line_2d(img: &mut RgbaImage, start: (i32, i32), end: (i32, i32), color: Rgba<u8>) {
    let (mut x0, mut y0) = start;
    let (x1, y1) = end;
    let dx = (x1 - x0).abs();
    let sx = if x0 < x1 { 1 } else { -1 };
    let dy = -(y1 - y0).abs();
    let sy = if y0 < y1 { 1 } else { -1 };
    let mut err = dx + dy;
    loop {
        put_pixel_checked(img, x0, y0, color);
        if x0 == x1 && y0 == y1 {
            break;
        }
        let e2 = 2 * err;
        if e2 >= dy {
            err += dy;
            x0 += sx;
        }
        if e2 <= dx {
            err += dx;
            y0 += sy;
        }
    }
}

fn put_pixel_checked(img: &mut RgbaImage, x: i32, y: i32, color: Rgba<u8>) {
    if x >= 0 && y >= 0 && x < img.width() as i32 && y < img.height() as i32 {
        img.put_pixel(x as u32, y as u32, color);
    }
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;
    use std::ffi::CString;
    use std::sync::Arc;

    use kittycad_modeling_cmds::ModelingCmd;
    use kittycad_modeling_cmds::websocket::{ModelingCmdReq, WebSocketRequest};
    use serde_json::json;
    use uuid::Uuid;

    use super::EngineConnection;
    use super::{call_core, parse_core_response, zoo_occt_core_handle_modeling_command};
    use crate::SourceRange;
    use crate::engine::EngineManager;
    use crate::execution::ExecState;
    use crate::settings::types::ModelingEngine;
    use crate::{ExecutorContext, ExecutorSettings, Program};

    fn send_raw_to_core(request: serde_json::Value) {
        let request_id = CString::new(Uuid::new_v4().to_string()).unwrap();
        let request_json = CString::new(serde_json::to_string(&request).unwrap()).unwrap();
        let response = call_core(
            || unsafe { zoo_occt_core_handle_modeling_command(request_id.as_ptr(), request_json.as_ptr()) },
            SourceRange::default(),
        )
        .unwrap();
        parse_core_response(&response, SourceRange::default()).unwrap();
    }

    #[tokio::test]
    async fn native_occt_backend_round_trips_through_shared_core() {
        let engine = EngineConnection::new().unwrap();
        let request_id = Uuid::new_v4();
        let response = engine
            .inner_send_modeling_cmd(
                request_id,
                SourceRange::default(),
                WebSocketRequest::ModelingCmdReq(ModelingCmdReq {
                    cmd_id: Uuid::new_v4().into(),
                    cmd: ModelingCmd::SceneClearAll(kittycad_modeling_cmds::SceneClearAll::default()),
                }),
                HashMap::new(),
            )
            .await
            .unwrap();

        assert_eq!(response.request_id(), Some(request_id));
        assert!(response.is_success());
    }

    #[tokio::test]
    async fn native_occt_core_tracks_extrude_geometry_state() {
        let engine = EngineConnection::new().unwrap();
        assert_eq!(
            engine.debug_geometry_state(SourceRange::default()).unwrap().shape_count,
            0
        );

        let request: WebSocketRequest = serde_json::from_value(json!({
            "type": "modeling_cmd_req",
            "cmd_id": Uuid::new_v4(),
            "cmd": {
                "type": "extrude",
                "target": Uuid::new_v4(),
                "distance": 2,
                "body_type": "solid",
                "extrude_method": "new"
            }
        }))
        .unwrap();

        let response = engine
            .inner_send_modeling_cmd(Uuid::new_v4(), SourceRange::default(), request, HashMap::new())
            .await
            .unwrap();

        assert!(response.is_success());
        let geometry = engine.debug_geometry_state(SourceRange::default()).unwrap();
        assert_eq!(geometry.shape_count, 1);
        assert_eq!(geometry.shapes[0].kind, "extrude_prism");
        assert_eq!(geometry.shapes[0].body_type, "solid");
        assert!(geometry.shapes[0].volume > 0.0);
        assert_eq!(geometry.native_occt, EngineConnection::has_native_occt_geometry());
        assert_eq!(
            geometry.geometry_backend,
            if EngineConnection::has_native_occt_geometry() {
                "native_occt"
            } else {
                "protocol_geometry"
            }
        );
    }

    #[tokio::test]
    async fn native_occt_core_tracks_multiple_body_producing_commands_in_order() {
        let engine = EngineConnection::new().unwrap();
        let extrude_id = Uuid::new_v4();
        let revolve_id = Uuid::new_v4();
        let surface_id = Uuid::new_v4();
        send_raw_to_core(json!({
            "type": "modeling_cmd_batch_req",
            "batch_id": Uuid::new_v4(),
            "requests": [
                {
                    "cmd_id": extrude_id,
                    "cmd": {
                        "type": "extrude",
                        "target": Uuid::new_v4(),
                        "distance": 2,
                        "body_type": "solid",
                        "extrude_method": "new"
                    }
                },
                {
                    "cmd_id": revolve_id,
                    "cmd": {
                        "type": "revolve",
                        "target": Uuid::new_v4(),
                        "angle": 180,
                        "axis": "y",
                        "body_type": "solid"
                    }
                },
                {
                    "cmd_id": surface_id,
                    "cmd": {
                        "type": "extrude",
                        "target": Uuid::new_v4(),
                        "distance": 5,
                        "body_type": "surface",
                        "extrude_method": "new"
                    }
                }
            ],
            "responses": false
        }));

        let geometry = engine.debug_geometry_state(SourceRange::default()).unwrap();
        assert_eq!(geometry.shape_count, 3);
        assert_eq!(geometry.shapes[0].command_id, extrude_id.to_string());
        assert_eq!(geometry.shapes[0].kind, "extrude_prism");
        assert_eq!(geometry.shapes[1].command_id, revolve_id.to_string());
        assert_eq!(geometry.shapes[1].kind, "revolve_solid");
        assert_eq!(geometry.shapes[2].command_id, surface_id.to_string());
        assert_eq!(geometry.shapes[2].kind, "surface_extrude");
        assert_eq!(geometry.shapes[2].body_type, "surface");
        assert_eq!(geometry.shapes[2].volume, 0.0);
    }

    #[tokio::test]
    async fn native_occt_core_extrudes_closed_line_region_topology() {
        let engine = EngineConnection::new().unwrap();
        let plane_id = Uuid::new_v4();
        let path_id = Uuid::new_v4();
        let region_id = Uuid::new_v4();
        let extrude_id = Uuid::new_v4();
        send_raw_to_core(json!({
            "type": "modeling_cmd_batch_req",
            "batch_id": Uuid::new_v4(),
            "requests": [
                {
                    "cmd_id": plane_id,
                    "cmd": {
                        "type": "make_plane",
                        "origin": { "x": 0, "y": 0, "z": 0 },
                        "x_axis": { "x": 1, "y": 0, "z": 0 },
                        "y_axis": { "x": 0, "y": 1, "z": 0 },
                        "size": 10,
                        "clobber": false
                    }
                },
                {
                    "cmd_id": Uuid::new_v4(),
                    "cmd": {
                        "type": "enable_sketch_mode",
                        "entity_id": plane_id,
                        "ortho": true,
                        "animated": false,
                        "adjust_camera": false,
                        "planar_normal": null
                    }
                },
                {
                    "cmd_id": path_id,
                    "cmd": { "type": "start_path" }
                },
                {
                    "cmd_id": Uuid::new_v4(),
                    "cmd": {
                        "type": "move_path_pen",
                        "path": path_id,
                        "to": { "x": 0, "y": 0, "z": 0 }
                    }
                },
                {
                    "cmd_id": Uuid::new_v4(),
                    "cmd": {
                        "type": "extend_path",
                        "path": path_id,
                        "segment": {
                            "type": "line",
                            "end": { "x": 4, "y": 0, "z": 0 },
                            "relative": false
                        }
                    }
                },
                {
                    "cmd_id": Uuid::new_v4(),
                    "cmd": {
                        "type": "extend_path",
                        "path": path_id,
                        "segment": {
                            "type": "line",
                            "end": { "x": 4, "y": 2, "z": 0 },
                            "relative": false
                        }
                    }
                },
                {
                    "cmd_id": Uuid::new_v4(),
                    "cmd": {
                        "type": "extend_path",
                        "path": path_id,
                        "segment": {
                            "type": "line",
                            "end": { "x": 0, "y": 2, "z": 0 },
                            "relative": false
                        }
                    }
                },
                {
                    "cmd_id": Uuid::new_v4(),
                    "cmd": {
                        "type": "close_path",
                        "path_id": path_id
                    }
                },
                {
                    "cmd_id": region_id,
                    "cmd": {
                        "type": "create_region_from_query_point",
                        "object_id": path_id,
                        "query_point": { "x": 2, "y": 1 }
                    }
                },
                {
                    "cmd_id": extrude_id,
                    "cmd": {
                        "type": "extrude",
                        "target": region_id,
                        "distance": 5,
                        "body_type": "solid",
                        "extrude_method": "new"
                    }
                }
            ],
            "responses": false
        }));

        let geometry = engine.debug_geometry_state(SourceRange::default()).unwrap();
        assert_eq!(geometry.shape_count, 1);
        assert_eq!(geometry.shapes[0].command_id, extrude_id.to_string());
        assert_eq!(geometry.shapes[0].kind, "extrude_prism");
        assert_eq!(geometry.shapes[0].body_type, "solid");
        assert!(
            (geometry.shapes[0].volume - 40.0).abs() < 1e-6,
            "expected 4 x 2 region extruded by 5 to have volume 40, got {}",
            geometry.shapes[0].volume
        );
    }

    #[tokio::test]
    async fn native_occt_core_extrudes_closed_arc_region_topology() {
        let engine = EngineConnection::new().unwrap();
        let plane_id = Uuid::new_v4();
        let path_id = Uuid::new_v4();
        let region_id = Uuid::new_v4();
        let extrude_id = Uuid::new_v4();
        send_raw_to_core(json!({
            "type": "modeling_cmd_batch_req",
            "batch_id": Uuid::new_v4(),
            "requests": [
                {
                    "cmd_id": plane_id,
                    "cmd": {
                        "type": "make_plane",
                        "origin": { "x": 0, "y": 0, "z": 0 },
                        "x_axis": { "x": 1, "y": 0, "z": 0 },
                        "y_axis": { "x": 0, "y": 1, "z": 0 },
                        "size": 10,
                        "clobber": false
                    }
                },
                {
                    "cmd_id": Uuid::new_v4(),
                    "cmd": {
                        "type": "enable_sketch_mode",
                        "entity_id": plane_id,
                        "ortho": true,
                        "animated": false,
                        "adjust_camera": false,
                        "planar_normal": null
                    }
                },
                {
                    "cmd_id": path_id,
                    "cmd": { "type": "start_path" }
                },
                {
                    "cmd_id": Uuid::new_v4(),
                    "cmd": {
                        "type": "move_path_pen",
                        "path": path_id,
                        "to": { "x": 1, "y": 0, "z": 0 }
                    }
                },
                {
                    "cmd_id": Uuid::new_v4(),
                    "cmd": {
                        "type": "extend_path",
                        "path": path_id,
                        "segment": {
                            "type": "arc",
                            "center": { "x": 0, "y": 0, "z": 0 },
                            "radius": { "unit": "millimeters", "value": 1 },
                            "start": { "unit": "radians", "value": 0 },
                            "end": { "unit": "radians", "value": 3.141592653589793 },
                            "relative": false
                        }
                    }
                },
                {
                    "cmd_id": Uuid::new_v4(),
                    "cmd": {
                        "type": "extend_path",
                        "path": path_id,
                        "segment": {
                            "type": "line",
                            "end": { "x": 1, "y": 0, "z": 0 },
                            "relative": false
                        }
                    }
                },
                {
                    "cmd_id": Uuid::new_v4(),
                    "cmd": {
                        "type": "close_path",
                        "path_id": path_id
                    }
                },
                {
                    "cmd_id": region_id,
                    "cmd": {
                        "type": "create_region_from_query_point",
                        "object_id": path_id,
                        "query_point": { "x": 0, "y": 0.5 }
                    }
                },
                {
                    "cmd_id": extrude_id,
                    "cmd": {
                        "type": "extrude",
                        "target": region_id,
                        "distance": 2,
                        "body_type": "solid",
                        "extrude_method": "new"
                    }
                }
            ],
            "responses": false
        }));

        let geometry = engine.debug_geometry_state(SourceRange::default()).unwrap();
        assert_eq!(geometry.shape_count, 1);
        assert_eq!(geometry.shapes[0].command_id, extrude_id.to_string());
        assert_eq!(geometry.shapes[0].kind, "extrude_prism");
        assert_eq!(geometry.shapes[0].body_type, "solid");
        assert!(
            (2.9..3.2).contains(&geometry.shapes[0].volume),
            "expected semicircle region extruded by 2 to have volume close to pi, got {}",
            geometry.shapes[0].volume
        );
    }

    #[tokio::test]
    async fn native_occt_core_extrudes_closed_tangential_arc_region_topology() {
        let engine = EngineConnection::new().unwrap();
        let plane_id = Uuid::new_v4();
        let path_id = Uuid::new_v4();
        let region_id = Uuid::new_v4();
        let extrude_id = Uuid::new_v4();
        send_raw_to_core(json!({
            "type": "modeling_cmd_batch_req",
            "batch_id": Uuid::new_v4(),
            "requests": [
                {
                    "cmd_id": plane_id,
                    "cmd": {
                        "type": "make_plane",
                        "origin": { "x": 0, "y": 0, "z": 0 },
                        "x_axis": { "x": 1, "y": 0, "z": 0 },
                        "y_axis": { "x": 0, "y": 1, "z": 0 },
                        "size": 10,
                        "clobber": false
                    }
                },
                {
                    "cmd_id": Uuid::new_v4(),
                    "cmd": {
                        "type": "enable_sketch_mode",
                        "entity_id": plane_id,
                        "ortho": true,
                        "animated": false,
                        "adjust_camera": false,
                        "planar_normal": null
                    }
                },
                {
                    "cmd_id": path_id,
                    "cmd": { "type": "start_path" }
                },
                {
                    "cmd_id": Uuid::new_v4(),
                    "cmd": {
                        "type": "move_path_pen",
                        "path": path_id,
                        "to": { "x": 0, "y": 0, "z": 0 }
                    }
                },
                {
                    "cmd_id": Uuid::new_v4(),
                    "cmd": {
                        "type": "extend_path",
                        "path": path_id,
                        "segment": {
                            "type": "tangential_arc",
                            "radius": { "unit": "millimeters", "value": 1 },
                            "offset": { "unit": "radians", "value": 3.141592653589793 }
                        }
                    }
                },
                {
                    "cmd_id": Uuid::new_v4(),
                    "cmd": {
                        "type": "extend_path",
                        "path": path_id,
                        "segment": {
                            "type": "line",
                            "end": { "x": 0, "y": 0, "z": 0 },
                            "relative": false
                        }
                    }
                },
                {
                    "cmd_id": Uuid::new_v4(),
                    "cmd": {
                        "type": "close_path",
                        "path_id": path_id
                    }
                },
                {
                    "cmd_id": region_id,
                    "cmd": {
                        "type": "create_region_from_query_point",
                        "object_id": path_id,
                        "query_point": { "x": 0.5, "y": 1 }
                    }
                },
                {
                    "cmd_id": extrude_id,
                    "cmd": {
                        "type": "extrude",
                        "target": region_id,
                        "distance": 2,
                        "body_type": "solid",
                        "extrude_method": "new"
                    }
                }
            ],
            "responses": false
        }));

        let geometry = engine.debug_geometry_state(SourceRange::default()).unwrap();
        assert_eq!(geometry.shape_count, 1);
        assert_eq!(geometry.shapes[0].command_id, extrude_id.to_string());
        assert_eq!(geometry.shapes[0].kind, "extrude_prism");
        assert_eq!(geometry.shapes[0].body_type, "solid");
        assert!(
            (2.9..3.2).contains(&geometry.shapes[0].volume),
            "expected default-X tangential semicircle extruded by 2 to have volume close to pi, got {}",
            geometry.shapes[0].volume
        );
    }

    #[tokio::test]
    async fn native_occt_executor_runs_kcl_against_shared_core() {
        let engine = EngineConnection::new().unwrap();
        let debug_engine = engine.clone();
        let ctx = ExecutorContext::new_with_engine(
            Arc::new(Box::new(engine)),
            ExecutorSettings {
                engine: ModelingEngine::OpenCascade,
                ..Default::default()
            },
        );

        let source = r#"
sketch001 = startSketchOn(XY)
profile001 = startProfile(sketch001, at = [0, 0])
  |> xLine(length = 2)
  |> yLine(length = 2)
  |> xLine(length = -2)
  |> close()
extrude001 = extrude(profile001, length = 2)
"#;
        let (program, parse_errors) = Program::parse(source).unwrap();
        assert!(parse_errors.is_empty(), "{parse_errors:#?}");
        let program = program.unwrap();
        let mut exec_state = ExecState::new(&ctx);
        ctx.run(&program, &mut exec_state).await.unwrap();

        let geometry = debug_engine.debug_geometry_state(SourceRange::default()).unwrap();
        assert_eq!(geometry.shape_count, 1);
        assert_eq!(geometry.shapes[0].kind, "extrude_prism");
        assert!(
            (geometry.shapes[0].volume - 8.0).abs() < 1e-6,
            "expected 2 x 2 region extruded by 2 to have volume 8, got {}",
            geometry.shapes[0].volume
        );
    }

    #[tokio::test]
    async fn native_occt_executor_prepares_snapshot_without_zoo_engine() {
        let engine = EngineConnection::new().unwrap();
        let ctx = ExecutorContext::new_with_engine(
            Arc::new(Box::new(engine)),
            ExecutorSettings {
                engine: ModelingEngine::OpenCascade,
                ..Default::default()
            },
        );

        let source = r#"
sketch001 = startSketchOn(XY)
profile001 = startProfile(sketch001, at = [0, 0])
  |> xLine(length = 2)
  |> yLine(length = 2)
  |> xLine(length = -2)
  |> close()
extrude001 = extrude(profile001, length = 2)
"#;
        let program = Program::parse_no_errs(source).unwrap();
        let mut exec_state = ExecState::new(&ctx);
        ctx.run(&program, &mut exec_state).await.unwrap();

        let snapshot = ctx.prepare_snapshot().await.unwrap();
        let image = image::ImageReader::new(std::io::Cursor::new(snapshot.contents.0))
            .with_guessed_format()
            .unwrap()
            .decode()
            .unwrap();

        assert_eq!(image.width(), 960);
        assert_eq!(image.height(), 720);
    }

    #[tokio::test]
    async fn native_occt_core_applies_scene_clear_in_batch_order() {
        let engine = EngineConnection::new().unwrap();
        send_raw_to_core(json!({
            "type": "modeling_cmd_batch_req",
            "batch_id": Uuid::new_v4(),
            "requests": [
                {
                    "cmd_id": Uuid::new_v4(),
                    "cmd": {
                        "type": "extrude",
                        "target": Uuid::new_v4(),
                        "distance": 2,
                        "body_type": "solid",
                        "extrude_method": "new"
                    }
                },
                {
                    "cmd_id": Uuid::new_v4(),
                    "cmd": { "type": "scene_clear_all" }
                }
            ],
            "responses": false
        }));

        assert_eq!(
            engine.debug_geometry_state(SourceRange::default()).unwrap().shape_count,
            0
        );
    }
}
