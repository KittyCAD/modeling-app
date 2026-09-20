use std::collections::HashMap;
use std::sync::Arc;

use kcl_lib::KclError;
use kcl_lib::SourceRange;
use kcl_lib::engine_connection::EngineTransport;
use kcl_lib::engine_connection::TransportCloseError;
use kittycad_modeling_cmds::ModelingCmd;
use kittycad_modeling_cmds::websocket::ModelingCmdReq;
use kittycad_modeling_cmds::websocket::WebSocketRequest;
use kittycad_modeling_cmds::websocket::WebSocketResponse;
use tokio::sync::Mutex;
use uuid::Uuid;

#[derive(Debug)]
enum TransportEvent {
    Request(Box<WebSocketRequest>),
    Response(Uuid),
}

impl TransportEvent {
    fn request(&self) -> Option<&WebSocketRequest> {
        match self {
            Self::Request(request) => Some(request),
            Self::Response(_) => None,
        }
    }
}

/// Observe the actual transport, including when a batch's response has arrived.
/// Artifact commands do not preserve batch boundaries or include Begin/EndExecution.
struct RecordingTransport {
    inner: Arc<Box<dyn EngineTransport>>,
    events: Arc<Mutex<Vec<TransportEvent>>>,
}

#[async_trait::async_trait]
impl EngineTransport for RecordingTransport {
    async fn inner_fire_modeling_cmd(
        &self,
        cmd_id: Uuid,
        source_range: SourceRange,
        cmd: WebSocketRequest,
        id_to_source_range: HashMap<Uuid, SourceRange>,
    ) -> Result<(), KclError> {
        self.events
            .lock()
            .await
            .push(TransportEvent::Request(Box::new(cmd.clone())));
        self.inner
            .inner_fire_modeling_cmd(cmd_id, source_range, cmd, id_to_source_range)
            .await
    }

    async fn inner_send_modeling_cmd(
        &self,
        cmd_id: Uuid,
        source_range: SourceRange,
        cmd: WebSocketRequest,
        id_to_source_range: HashMap<Uuid, SourceRange>,
    ) -> Result<WebSocketResponse, KclError> {
        self.events
            .lock()
            .await
            .push(TransportEvent::Request(Box::new(cmd.clone())));
        let response = self
            .inner
            .inner_send_modeling_cmd(cmd_id, source_range, cmd, id_to_source_range)
            .await?;
        self.events.lock().await.push(TransportEvent::Response(cmd_id));
        Ok(response)
    }

    async fn start_new_session(&self, source_range: SourceRange) -> Result<(), KclError> {
        self.inner.start_new_session(source_range).await
    }

    async fn close(&self) -> Result<(), TransportCloseError> {
        self.inner.close().await
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_lego_batches_are_between_begin_and_end_execution() {
    lego_batches_are_between_begin_and_end_execution(false).await;
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_cached_lego_batches_are_between_begin_and_end_execution() {
    lego_batches_are_between_begin_and_end_execution(true).await;
}

async fn lego_batches_are_between_begin_and_end_execution(use_cache: bool) {
    let mut ctx = kcl_lib::ExecutorContext::new_with_default_client().await.unwrap();
    let events = Arc::new(Mutex::new(Vec::new()));
    let engine = Arc::get_mut(&mut ctx.engine).unwrap();
    engine.transport = Arc::new(Box::new(RecordingTransport {
        inner: Arc::clone(&engine.transport),
        events: Arc::clone(&events),
    }));

    let program = kcl_lib::Program::parse_no_errs(include_str!("inputs/lego.kcl")).unwrap();
    if use_cache {
        kcl_lib::bust_cache().await;
    }
    assert!(record_lego_execution(&ctx, &events, &program, use_cache).await > 0);
    if use_cache {
        // A cache hit can still send setup batches when settings change.
        ctx.settings.show_grid = !ctx.settings.show_grid;
        assert!(record_lego_execution(&ctx, &events, &program, true).await > 0);
        // A subsequent unchanged execution must still finish its begin/end pair.
        assert_eq!(record_lego_execution(&ctx, &events, &program, true).await, 0);
    }
    ctx.close().await;
}

async fn record_lego_execution(
    ctx: &kcl_lib::ExecutorContext,
    events: &Mutex<Vec<TransportEvent>>,
    program: &kcl_lib::Program,
    use_cache: bool,
) -> usize {
    let result = if use_cache {
        ctx.run_with_caching(program.clone()).await.map(|_| ())
    } else {
        ctx.run(program, &mut kcl_lib::ExecState::new(ctx)).await.map(|_| ())
    };
    let batch_is_empty = ctx.engine_batch.is_empty().await;
    if result.is_err() {
        ctx.close().await;
    }
    result.unwrap();
    assert!(batch_is_empty, "Execution left modeling commands queued");

    let events = std::mem::take(&mut *events.lock().await);
    assert_execution_order(&events)
}

fn assert_execution_order(events: &[TransportEvent]) -> usize {
    let Some(WebSocketRequest::ModelingCmdReq(ModelingCmdReq {
        cmd: ModelingCmd::BeginExecution(_),
        cmd_id: begin_id,
    })) = events.first().and_then(TransportEvent::request)
    else {
        panic!("The first request must be a standalone BeginExecution: {events:#?}");
    };
    assert!(
        matches!(events.get(1), Some(TransportEvent::Response(id)) if *id == Uuid::from(*begin_id)),
        "BeginExecution must complete before any other request: {events:#?}"
    );

    let (end_index, end_id) = events
        .iter()
        .enumerate()
        .find_map(|(index, event)| match event.request() {
            Some(WebSocketRequest::ModelingCmdReq(ModelingCmdReq {
                cmd: ModelingCmd::EndExecution(_),
                cmd_id,
            })) => Some((index, Uuid::from(*cmd_id))),
            _ => None,
        })
        .expect("Execution must send a standalone EndExecution");
    assert_eq!(
        events.len(),
        end_index + 2,
        "Only EndExecution's response may follow EndExecution: {events:#?}"
    );
    assert!(matches!(events.last(), Some(TransportEvent::Response(id)) if *id == end_id));

    let mut batch_count = 0;
    for (index, event) in events.iter().enumerate().take(end_index).skip(2) {
        match event.request() {
            Some(WebSocketRequest::ModelingCmdBatchReq(batch)) => {
                batch_count += 1;
                assert!(
                    batch.requests.iter().all(|request| !matches!(
                        request.cmd,
                        ModelingCmd::BeginExecution(_) | ModelingCmd::EndExecution(_)
                    )),
                    "Execution boundaries must not be included in a batch: {batch:#?}"
                );
                assert!(
                    events[index + 1..end_index].iter().any(
                        |event| matches!(event, TransportEvent::Response(id) if *id == Uuid::from(batch.batch_id))
                    ),
                    "Batch {} must complete before EndExecution: {events:#?}",
                    batch.batch_id
                );
            }
            Some(WebSocketRequest::ModelingCmdReq(request)) => assert!(
                !matches!(
                    request.cmd,
                    ModelingCmd::BeginExecution(_) | ModelingCmd::EndExecution(_)
                ),
                "Execution must have exactly one begin/end pair: {events:#?}"
            ),
            _ => {}
        }
    }
    batch_count
}
