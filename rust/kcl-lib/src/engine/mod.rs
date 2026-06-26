//! Functions for managing engine communications.

pub mod async_tasks;
#[cfg(target_arch = "wasm32")]
#[cfg(feature = "engine")]
pub mod conn_wasm;
#[cfg(feature = "engine")]
pub mod engine_manager;

use std::sync::Arc;
use std::sync::atomic::AtomicUsize;
use std::sync::atomic::Ordering;

pub use async_tasks::AsyncTasks;
use indexmap::IndexMap;
use kcl_api::UnitLength;
use kcmc::ModelingCmd;
use kcmc::each_cmd as mcmd;
use kcmc::websocket::WebSocketRequest;
use kittycad_modeling_cmds::{self as kcmc};
use parse_display::Display;
use parse_display::FromStr;
use serde::Deserialize;
use serde::Serialize;
use tokio::sync::RwLock;
use uuid::Uuid;

use crate::SourceRange;
use crate::execution::PlaneInfo;
use crate::execution::Point3d;
use crate::unit_conversion::ToKcmc;

lazy_static::lazy_static! {
    pub static ref GRID_OBJECT_ID: uuid::Uuid = uuid::Uuid::parse_str("cfa78409-653d-4c26-96f1-7c45fb784840").unwrap();

    pub static ref GRID_SCALE_TEXT_OBJECT_ID: uuid::Uuid = uuid::Uuid::parse_str("10782f33-f588-4668-8bcd-040502d26590").unwrap();

    pub static ref DEFAULT_PLANE_INFO: IndexMap<PlaneName, PlaneInfo> = IndexMap::from([
            (
                PlaneName::Xy,
                PlaneInfo {
                    origin: Point3d::new(0.0, 0.0, 0.0, Some(UnitLength::Millimeters)),
                    x_axis: Point3d::new(1.0, 0.0, 0.0, None),
                    y_axis: Point3d::new(0.0, 1.0, 0.0, None),
                    z_axis: Point3d::new(0.0, 0.0, 1.0, None),
                },
            ),
            (
                PlaneName::NegXy,
                PlaneInfo {
                    origin: Point3d::new( 0.0, 0.0,  0.0, Some(UnitLength::Millimeters)),
                    x_axis: Point3d::new(-1.0, 0.0,  0.0, None),
                    y_axis: Point3d::new( 0.0, 1.0,  0.0, None),
                    z_axis: Point3d::new( 0.0, 0.0, -1.0, None),
                },
            ),
            (
                PlaneName::Xz,
                PlaneInfo {
                    origin: Point3d::new(0.0,  0.0, 0.0, Some(UnitLength::Millimeters)),
                    x_axis: Point3d::new(1.0,  0.0, 0.0, None),
                    y_axis: Point3d::new(0.0,  0.0, 1.0, None),
                    z_axis: Point3d::new(0.0, -1.0, 0.0, None),
                },
            ),
            (
                PlaneName::NegXz,
                PlaneInfo {
                    origin: Point3d::new( 0.0, 0.0, 0.0, Some(UnitLength::Millimeters)),
                    x_axis: Point3d::new(-1.0, 0.0, 0.0, None),
                    y_axis: Point3d::new( 0.0, 0.0, 1.0, None),
                    z_axis: Point3d::new( 0.0, 1.0, 0.0, None),
                },
            ),
            (
                PlaneName::Yz,
                PlaneInfo {
                    origin: Point3d::new(0.0, 0.0, 0.0, Some(UnitLength::Millimeters)),
                    x_axis: Point3d::new(0.0, 1.0, 0.0, None),
                    y_axis: Point3d::new(0.0, 0.0, 1.0, None),
                    z_axis: Point3d::new(1.0, 0.0, 0.0, None),
                },
            ),
            (
                PlaneName::NegYz,
                PlaneInfo {
                    origin: Point3d::new( 0.0,  0.0, 0.0, Some(UnitLength::Millimeters)),
                    x_axis: Point3d::new( 0.0, -1.0, 0.0, None),
                    y_axis: Point3d::new( 0.0,  0.0, 1.0, None),
                    z_axis: Point3d::new(-1.0,  0.0, 0.0, None),
                },
            ),
    ]);
}

/// Per-execution buffer for modeling commands that must preserve temporal order.
///
/// A single execution can enqueue commands whose source ranges come from multiple
/// modules. The ownership boundary is the execution task carrying this context,
/// not the module id embedded in a source range.
#[derive(Debug, Clone)]
pub struct EngineBatchContext {
    batch: Arc<RwLock<Vec<(WebSocketRequest, SourceRange)>>>,
    batch_end: Arc<RwLock<IndexMap<Uuid, (WebSocketRequest, SourceRange)>>>,
}

impl Default for EngineBatchContext {
    fn default() -> Self {
        Self::new()
    }
}

impl EngineBatchContext {
    pub fn new() -> Self {
        Self {
            batch: Arc::new(RwLock::new(Vec::new())),
            batch_end: Arc::new(RwLock::new(IndexMap::new())),
        }
    }

    pub async fn is_empty(&self) -> bool {
        self.batch.read().await.is_empty() && self.batch_end.read().await.is_empty()
    }

    async fn clear(&self) {
        self.batch.write().await.clear();
        self.batch_end.write().await.clear();
    }

    async fn push(&self, req: WebSocketRequest, source_range: SourceRange) {
        self.batch.write().await.push((req, source_range));
    }

    async fn extend(&self, requests: Vec<(WebSocketRequest, SourceRange)>) {
        self.batch.write().await.extend(requests);
    }

    async fn insert_end(&self, id: Uuid, req: WebSocketRequest, source_range: SourceRange) {
        self.batch_end.write().await.insert(id, (req, source_range));
    }

    pub(crate) async fn move_batch_end_to_batch(&self, ids: Vec<Uuid>) {
        let mut moved = Vec::new();
        {
            let mut batch_end = self.batch_end.write().await;
            for id in ids {
                let Some(item) = batch_end.shift_remove(&id) else {
                    continue;
                };
                moved.push(item);
            }
        }

        self.extend(moved).await;
    }

    async fn take_batch(&self) -> Vec<(WebSocketRequest, SourceRange)> {
        std::mem::take(&mut *self.batch.write().await)
    }

    async fn take_batch_end(&self) -> IndexMap<Uuid, (WebSocketRequest, SourceRange)> {
        std::mem::take(&mut *self.batch_end.write().await)
    }
}

#[derive(Default, Debug)]
pub struct EngineStats {
    pub commands_batched: AtomicUsize,
    pub batches_sent: AtomicUsize,
}

impl Clone for EngineStats {
    fn clone(&self) -> Self {
        Self {
            commands_batched: AtomicUsize::new(self.commands_batched.load(Ordering::Relaxed)),
            batches_sent: AtomicUsize::new(self.batches_sent.load(Ordering::Relaxed)),
        }
    }
}

#[derive(Debug, Hash, Eq, Copy, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, Display, FromStr)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub enum PlaneName {
    /// The XY plane.
    #[display("XY")]
    Xy,
    /// The opposite side of the XY plane.
    #[display("-XY")]
    NegXy,
    /// The XZ plane.
    #[display("XZ")]
    Xz,
    /// The opposite side of the XZ plane.
    #[display("-XZ")]
    NegXz,
    /// The YZ plane.
    #[display("YZ")]
    Yz,
    /// The opposite side of the YZ plane.
    #[display("-YZ")]
    NegYz,
}

/// Create a new zoo api client.
#[cfg(not(target_arch = "wasm32"))]
pub fn new_zoo_client(token: Option<String>, engine_addr: Option<String>) -> anyhow::Result<kittycad::Client> {
    let user_agent = concat!(env!("CARGO_PKG_NAME"), ".rs/", env!("CARGO_PKG_VERSION"),);
    let http_client = reqwest::Client::builder()
        .user_agent(user_agent)
        // For file conversions we need this to be long.
        .timeout(std::time::Duration::from_secs(600))
        .connect_timeout(std::time::Duration::from_secs(60));
    let ws_client = reqwest::Client::builder()
        .user_agent(user_agent)
        // For file conversions we need this to be long.
        .timeout(std::time::Duration::from_secs(600))
        .connect_timeout(std::time::Duration::from_secs(60))
        .connection_verbose(true)
        .tcp_keepalive(std::time::Duration::from_secs(600))
        .http1_only();

    let zoo_token_env = std::env::var("ZOO_API_TOKEN");

    let token = if let Some(token) = token {
        token
    } else if let Ok(token) = std::env::var("KITTYCAD_API_TOKEN") {
        if let Ok(zoo_token) = zoo_token_env
            && zoo_token != token
        {
            return Err(anyhow::anyhow!(
                "Both environment variables KITTYCAD_API_TOKEN=`{}` and ZOO_API_TOKEN=`{}` are set. Use only one.",
                token,
                zoo_token
            ));
        }
        token
    } else if let Ok(token) = zoo_token_env {
        token
    } else {
        return Err(anyhow::anyhow!(
            "No API token found in environment variables. Use ZOO_API_TOKEN"
        ));
    };

    // Create the client.
    let mut client = kittycad::Client::new_from_reqwest(token, http_client, ws_client);
    // Set an engine address if it's set.
    let kittycad_host_env = std::env::var("KITTYCAD_HOST");
    if let Some(addr) = engine_addr {
        client.set_base_url(addr);
    } else if let Ok(addr) = std::env::var("ZOO_HOST") {
        if let Ok(kittycad_host) = kittycad_host_env
            && kittycad_host != addr
        {
            return Err(anyhow::anyhow!(
                "Both environment variables KITTYCAD_HOST=`{}` and ZOO_HOST=`{}` are set. Use only one.",
                kittycad_host,
                addr
            ));
        }
        client.set_base_url(addr);
    } else if let Ok(addr) = kittycad_host_env {
        client.set_base_url(addr);
    }

    Ok(client)
}

#[derive(Copy, Clone, Debug)]
pub enum GridScaleBehavior {
    ScaleWithZoom,
    Fixed(Option<UnitLength>),
}

impl GridScaleBehavior {
    fn into_modeling_cmd(self) -> ModelingCmd {
        const NUMBER_OF_GRID_COLUMNS: f32 = 10.0;
        match self {
            GridScaleBehavior::ScaleWithZoom => ModelingCmd::from(mcmd::SetGridAutoScale::builder().build()),
            GridScaleBehavior::Fixed(unit_length) => ModelingCmd::from(
                mcmd::SetGridScale::builder()
                    .value(NUMBER_OF_GRID_COLUMNS)
                    .units(unit_length.unwrap_or(UnitLength::Millimeters).to_kcmc())
                    .build(),
            ),
        }
    }
}
