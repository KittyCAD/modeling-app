use std::collections::HashMap;
use std::sync::Mutex;

use kcl_lib::engine_connection::EngineManager;
use kcl_lib::engine_connection::EngineTransport;
use kcl_lib::engine_connection::TransportCloseError;
use kcmc::websocket::SuccessWebSocketResponse;
use kcmc::websocket::WebSocketRequest;
use kcmc::websocket::WebSocketResponse;
use tokio::sync::Semaphore;
use tokio::sync::mpsc;

use super::*;

pub(crate) struct SnapshotTransport {
    pub commands: Mutex<Vec<ModelingCmd>>,
    pub fail: Vec<&'static str>,
    pub block: Vec<&'static str>,
    pub started: mpsc::UnboundedSender<&'static str>,
    pub resume: Semaphore,
    pub closed: tokio::sync::Notify,
}

impl SnapshotTransport {
    pub fn new() -> (Arc<Self>, mpsc::UnboundedReceiver<&'static str>) {
        let (started, receiver) = mpsc::unbounded_channel();
        (
            Arc::new(Self {
                commands: Mutex::new(Vec::new()),
                fail: Vec::new(),
                block: Vec::new(),
                started,
                resume: Semaphore::new(0),
                closed: tokio::sync::Notify::new(),
            }),
            receiver,
        )
    }

    pub fn stages(&self) -> Vec<&'static str> {
        self.commands.lock().unwrap().iter().map(stage).collect()
    }

    pub fn engine(self: &Arc<Self>) -> Arc<EngineManager> {
        let mut engine = EngineManager::new_mock();
        engine.transport = Arc::new(Box::new(RecordingTransport(self.clone())));
        Arc::new(engine)
    }
}

fn stage(cmd: &ModelingCmd) -> &'static str {
    match cmd {
        ModelingCmd::ToggleGraphics(toggle) if toggle.graphics_enabled => "enable",
        ModelingCmd::ToggleGraphics(_) => "disable",
        ModelingCmd::TakeSnapshot(_) => "snapshot",
        ModelingCmd::DefaultCameraSetOrthographic(_) => "camera",
        _ => "other",
    }
}

struct RecordingTransport(Arc<SnapshotTransport>);

impl std::ops::Deref for RecordingTransport {
    type Target = SnapshotTransport;

    fn deref(&self) -> &Self::Target {
        &self.0
    }
}

#[async_trait::async_trait]
impl EngineTransport for RecordingTransport {
    async fn inner_fire_modeling_cmd(
        &self,
        _id: Uuid,
        _range: kcl_lib::SourceRange,
        _cmd: WebSocketRequest,
        _ranges: HashMap<Uuid, kcl_lib::SourceRange>,
    ) -> Result<(), kcl_lib::KclError> {
        panic!("snapshot commands must wait for responses")
    }

    async fn inner_send_modeling_cmd(
        &self,
        id: Uuid,
        _range: kcl_lib::SourceRange,
        cmd: WebSocketRequest,
        _ranges: HashMap<Uuid, kcl_lib::SourceRange>,
    ) -> Result<WebSocketResponse, kcl_lib::KclError> {
        let WebSocketRequest::ModelingCmdReq(request) = cmd else {
            panic!("expected individual snapshot command")
        };
        let stage = stage(&request.cmd);
        self.commands.lock().unwrap().push(request.cmd);
        if self.block.contains(&stage) {
            self.started.send(stage).unwrap();
            self.resume.acquire().await.unwrap().forget();
        }
        if self.fail.contains(&stage) {
            // Exercise conversion of actual engine failures without a network.
            return Ok(serde_json::from_value(serde_json::json!({
                "success": false,
                "request_id": id,
                "errors": [{"error_code": "internal_api", "message": stage}]
            }))
            .unwrap());
        }
        let modeling_response = if stage == "snapshot" {
            OkModelingCmdResponse::TakeSnapshot(
                serde_json::from_value(serde_json::json!({"contents": "AQID"})).unwrap(),
            )
        } else {
            OkModelingCmdResponse::Empty {}
        };
        Ok(WebSocketResponse::Success(SuccessWebSocketResponse {
            request_id: Some(id),
            resp: OkWebSocketResponseData::Modeling { modeling_response },
            success: true,
        }))
    }

    async fn close(&self) -> Result<(), TransportCloseError> {
        self.closed.notify_one();
        Ok(())
    }
}

fn context(transport: &Arc<SnapshotTransport>, geometry_only: bool) -> ExecutorContext {
    ExecutorContext::new_with_engine(transport.engine(), executor_settings(None, Some(false), geometry_only))
}

#[tokio::test]
async fn snapshots_toggle_once_per_batch_and_preserve_graphics_sessions() {
    for geometry_only in [false, true] {
        for count in [0, 2] {
            let (transport, _) = SnapshotTransport::new();
            let options = vec![SnapshotOptions::isometric_view(0.1); count];
            let images = take_snaps(
                &context(&transport, geometry_only),
                ImageFormat::Png,
                options,
                true,
                geometry_only,
            )
            .await
            .unwrap();
            assert_eq!(images, vec![vec![1, 2, 3]; count.max(1)]);
            let stages = transport.stages();
            assert_eq!(
                stages.iter().filter(|&&s| s == "enable").count(),
                usize::from(geometry_only)
            );
            assert_eq!(
                stages.iter().filter(|&&s| s == "disable").count(),
                usize::from(geometry_only)
            );
            if geometry_only {
                assert_eq!(stages.first(), Some(&"enable"));
                assert_eq!(stages.last(), Some(&"disable"));
                assert!(
                    transport
                        .commands
                        .lock()
                        .unwrap()
                        .iter()
                        .any(|cmd| matches!(cmd, ModelingCmd::EdgeLinesVisible(edges) if edges.hidden))
                );
            }
        }
    }
}

#[tokio::test]
async fn snapshot_failures_always_attempt_graphics_cleanup() {
    for fail in ["enable", "camera", "snapshot", "disable"] {
        let (mut transport, _) = SnapshotTransport::new();
        Arc::get_mut(&mut transport).unwrap().fail.push(fail);
        let error = take_snaps(&context(&transport, true), ImageFormat::Png, Vec::new(), true, true)
            .await
            .unwrap_err()
            .exception;
        assert!(error.to_string().contains(fail), "{error}");
        assert_eq!(transport.stages().last(), Some(&"disable"));
    }
}

#[tokio::test]
async fn cleanup_failure_preserves_the_snapshot_error_as_its_cause() {
    let (mut transport, _) = SnapshotTransport::new();
    Arc::get_mut(&mut transport).unwrap().fail = vec!["snapshot", "disable"];
    let error = take_snaps(&context(&transport, true), ImageFormat::Png, Vec::new(), true, true)
        .await
        .unwrap_err()
        .exception;
    assert!(error.to_string().contains("disable"));
    Python::attach(|py| assert!(error.cause(py).unwrap().to_string().contains("snapshot")));
}

#[tokio::test]
async fn cancelled_snapshot_helper_finishes_batch_and_closes_connection() {
    for cancelled_at in ["enable", "camera", "snapshot", "disable"] {
        let (mut transport, mut started) = SnapshotTransport::new();
        Arc::get_mut(&mut transport).unwrap().block = vec![cancelled_at];
        let ctx = context(&transport, true);
        // Reproduce the outer execution/import task being aborted by Python.
        let caller = tokio::spawn(spawn_py(async move {
            snapshot_and_close(
                ctx,
                ImageFormat::Png,
                vec![SnapshotOptions::isometric_view(0.1); 2],
                true,
            )
            .await
        }));
        assert_eq!(started.recv().await, Some(cancelled_at));
        caller.abort();
        assert!(caller.await.unwrap_err().is_cancelled());
        transport.resume.add_permits(2);
        tokio::time::timeout(std::time::Duration::from_secs(1), transport.closed.notified())
            .await
            .expect("cancelled snapshot helper did not close its connection");
        assert_eq!(transport.stages().last(), Some(&"disable"));
        assert_eq!(transport.stages().iter().filter(|&&s| s == "snapshot").count(), 2);
    }
}
