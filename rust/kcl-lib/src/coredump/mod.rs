//! Core dump related structures and functions.
#![allow(dead_code)]

#[cfg(not(target_arch = "wasm32"))]
pub mod local;
#[cfg(target_arch = "wasm32")]
pub mod wasm;

use anyhow::Result;
use serde::Deserialize;
use serde::Serialize;
/// "Value" would be OK. This is imported as "JValue" throughout the rest of this crate.
use serde_json::Value as JValue;
use uuid::Uuid;

#[async_trait::async_trait(?Send)]
pub trait CoreDump: Clone {
    fn version(&self) -> Result<String>;

    fn kcl_code(&self) -> Result<String>;

    fn os(&self) -> Result<OsInfo>;

    fn is_desktop(&self) -> Result<bool>;

    async fn get_webrtc_stats(&self) -> Result<WebrtcStats>;

    async fn get_client_state(&self) -> Result<JValue>;

    /// Dump the app info.
    async fn dump(&self) -> Result<CoreDumpInfo> {
        let coredump_id = uuid::Uuid::new_v4();
        let client_state = self.get_client_state().await?;
        let webrtc_stats = self.get_webrtc_stats().await?;
        let os = self.os()?;

        let core_dump_info = CoreDumpInfo {
            id: coredump_id,
            version: self.version()?,
            git_rev: git_rev::try_revision_string!().map_or_else(|| "unknown".to_string(), |s| s.to_string()),
            timestamp: chrono::Utc::now(),
            desktop: self.is_desktop()?,
            kcl_code: self.kcl_code()?,
            os,
            webrtc_stats,
            client_state,
        };

        // pretty-printed JSON byte vector of the coredump.
        Ok(core_dump_info)
    }
}

/// The app info structure.
/// The Core Dump Info structure.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub struct CoreDumpInfo {
    /// The unique id for the core dump - this helps correlate uploaded files with coredump data.
    pub id: Uuid,
    /// The version of the app.
    pub version: String,
    /// The git revision of the app.
    pub git_rev: String,
    /// A timestamp of the core dump.
    #[ts(type = "string")]
    pub timestamp: chrono::DateTime<chrono::Utc>,
    /// If the app is running in desktop or the browser.
    pub desktop: bool,
    /// The os info.
    pub os: OsInfo,
    /// The webrtc stats.
    pub webrtc_stats: WebrtcStats,
    /// The kcl code the user is using.
    pub kcl_code: String,
    /// The client state (singletons and xstate).
    pub client_state: JValue,
}

/// The os info structure.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub struct OsInfo {
    /// The platform the app is running on.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub platform: Option<String>,
    /// The architecture the app is running on.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub arch: Option<String>,
    /// The kernel version.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    /// Information about the browser.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub browser: Option<String>,
}

/// The webrtc stats structure.
#[derive(Default, Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub struct WebrtcStats {
    /// The packets lost.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub packets_lost: Option<u32>,
    /// The frames received.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub frames_received: Option<u32>,
    /// The frame width.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub frame_width: Option<f32>,
    /// The frame height.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub frame_height: Option<f32>,
    /// The frame rate.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub frame_rate: Option<f32>,
    /// The number of key frames decoded.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub key_frames_decoded: Option<u32>,
    /// The number of frames dropped.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub frames_dropped: Option<u32>,
    /// The pause count.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pause_count: Option<u32>,
    /// The total pauses duration.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub total_pauses_duration: Option<f32>,
    /// The freeze count.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub freeze_count: Option<u32>,
    /// The total freezes duration.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub total_freezes_duration: Option<f32>,
    /// The pli count.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pli_count: Option<u32>,
    /// Packet jitter for this synchronizing source, measured in seconds.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub jitter: Option<f32>,
}
