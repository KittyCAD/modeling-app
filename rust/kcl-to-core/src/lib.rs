use std::collections::HashMap;
use std::sync::Arc;

use anyhow::Result;
use indexmap::IndexMap;
use kcl_lib::ExecState;
use kcl_lib::ExecutorContext;
use kcl_lib::KclError;
use kcl_lib::SourceRange;
use kcl_lib::engine_connection::EngineTransport;
use kcl_lib::engine_connection::ResponseInformation;
use kcl_lib::engine_connection::SocketHealth;
use kcl_lib::engine_connection::TransportCloseError;
use kcl_lib::engine_connection::UnifiedConnection;
use kittycad_modeling_cmds::websocket::ModelingSessionData;
use kittycad_modeling_cmds::websocket::WebSocketRequest;
use tokio::sync::RwLock;
use tokio::sync::mpsc;
use uuid::Uuid;

struct Transport;

#[async_trait::async_trait]
impl EngineTransport for Transport {
    async fn inner_fire_modeling_cmd(
        &self,
        _cmd_id: Uuid,
        _source_range: SourceRange,
        _cmd: WebSocketRequest,
        _id_to_source_range: HashMap<Uuid, SourceRange>,
    ) -> Result<(), KclError> {
        Ok(())
    }

    async fn close(self) -> Result<(), TransportCloseError> {
        Ok(())
    }
}

///Converts the given kcl code to an engine test
pub async fn kcl_to_engine_core(code: &str) -> Result<String> {
    let program = kcl_lib::Program::parse_no_errs(code)?;

    let test_source_code = Arc::new(RwLock::new(String::new()));

    let transport = Transport;
    let session_data: Arc<RwLock<Option<ModelingSessionData>>> = Arc::new(RwLock::new(None));
    let ids_of_async_commands: Arc<RwLock<IndexMap<Uuid, SourceRange>>> = Arc::new(RwLock::new(IndexMap::new()));
    let socket_health = Arc::new(RwLock::new(SocketHealth::Active));
    let pending_errors = Arc::new(RwLock::new(Vec::new()));
    let responses = ResponseInformation::new(Arc::new(RwLock::new(IndexMap::new())));
    let debug_info = Arc::new(RwLock::new(None));
    let (shutdown_tx, _shutdown_rx) = mpsc::channel(1);

    let connection = UnifiedConnection::builder()
        .transport(Arc::new(Box::new(transport)))
        .session_data(session_data)
        .pending_errors(pending_errors)
        .responses(responses)
        .debug_info(debug_info)
        .ids_of_async_commands(ids_of_async_commands)
        .socket_health(socket_health)
        .shutdown_tx(shutdown_tx)
        .build();
    let ctx = ExecutorContext::new_forwarded_mock(Arc::new(connection));
    ctx.run(&program, &mut ExecState::new(&ctx)).await?;

    Ok(test_source_code.read().await.clone())
}
