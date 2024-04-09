//! Core dump related structures and functions.

#[cfg(not(target_arch = "wasm32"))]
pub mod local;
#[cfg(target_arch = "wasm32")]
pub mod wasm;

use anyhow::Result;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

#[async_trait::async_trait]
pub trait CoreDump: Clone {
    fn version(&self) -> Result<String>;

    async fn platform(&self) -> Result<String>;

    fn is_tauri(&self) -> Result<bool>;

    async fn get_webrtc_stats(&self) -> Result<WebrtcStats>;

    /// Dump the app info.
    async fn dump(&self) -> Result<AppInfo> {
        let webrtc_stats = self.get_webrtc_stats().await?;
        Ok(AppInfo {
            version: self.version()?,
            git_rev: git_rev::try_revision_string!().map_or_else(|| "unknown".to_string(), |s| s.to_string()),
            timestamp: chrono::Utc::now(),
            tauri: self.is_tauri()?,
            platform: self.platform().await?,
            webrtc_stats,
        })
    }
}

/// The app info structure.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub struct AppInfo {
    /// The version of the app.
    pub version: String,
    /// The git revision of the app.
    pub git_rev: String,
    /// A timestamp of the core dump.
    #[ts(type = "string")]
    pub timestamp: chrono::DateTime<chrono::Utc>,
    /// If the app is running in tauri or the browser.
    pub tauri: bool,
    /// The platform the app is running on.
    pub platform: String,

    /// The webrtc stats.
    pub webrtc_stats: WebrtcStats,
}

/// The webrtc stats structure.
#[derive(Default, Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub struct WebrtcStats {
    /// The packets lost.
    pub packets_lost: u32,
    /// The frames received.
    pub frames_received: u32,
    /// The frame width.
    pub frame_width: u32,
    /// The frame height.
    pub frame_height: u32,
    /// The frame rate.
    pub frame_rate: f32,
    /// The number of key frames decoded.
    pub key_frames_decoded: u32,
    /// The number of frames dropped.
    pub frames_dropped: u32,
    /// The pause count.
    pub pause_count: u32,
    /// The total pauses duration.
    pub total_pauses_duration: u32,
    /// The freeze count.
    pub freeze_count: u32,
    /// The total freezes duration.
    pub total_freezes_duration: u32,
    /// The pli count.
    pub pli_count: u32,
}
