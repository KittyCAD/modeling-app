//! Core dump related structures and functions.

#[cfg(not(target_arch = "wasm32"))]
pub mod local;
#[cfg(target_arch = "wasm32")]
pub mod wasm;

use std::path::Path;

use anyhow::Result;
use base64::Engine;
use kittycad::Client;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
/// "Value" would be OK. This is imported as "JValue" throughout the rest of this crate.
use serde_json::Value as JValue;
use uuid::Uuid;

#[async_trait::async_trait(?Send)]
pub trait CoreDump: Clone {
    /// Return the authentication token.
    fn token(&self) -> Result<String>;

    fn base_api_url(&self) -> Result<String>;

    fn version(&self) -> Result<String>;

    fn pool(&self) -> Result<String>;

    async fn os(&self) -> Result<OsInfo>;

    fn is_desktop(&self) -> Result<bool>;

    async fn get_webrtc_stats(&self) -> Result<WebrtcStats>;

    async fn get_client_state(&self) -> Result<JValue>;

    /// Return a screenshot of the app.
    async fn screenshot(&self) -> Result<String>;

    /// Get a screenshot of the app and upload it to public cloud storage.
    async fn upload_screenshot(&self, coredump_id: &Uuid, zoo_client: &Client) -> Result<String> {
        let screenshot = self.screenshot().await?;
        let cleaned = screenshot.trim_start_matches("data:image/png;base64,");

        // Base64 decode the screenshot.
        let data = base64::engine::general_purpose::STANDARD.decode(cleaned)?;
        // Upload the screenshot.
        let links = zoo_client
            .meta()
            .create_debug_uploads(vec![kittycad::types::multipart::Attachment {
                name: "".to_string(),
                filename: Some(format!(r#"modeling-app/coredump-{coredump_id}-screenshot.png"#)),
                content_type: Some("image/png".to_string()),
                data,
            }])
            .await
            .map_err(|e| anyhow::anyhow!(e.to_string()))?;

        if links.is_empty() {
            anyhow::bail!("Failed to upload screenshot");
        }

        Ok(links[0].clone())
    }

    /// Dump the app info.
    async fn dump(&self) -> Result<CoreDumpInfo> {
        // Create the zoo client.
        let mut zoo_client = kittycad::Client::new(self.token()?);
        zoo_client.set_base_url(&self.base_api_url()?);

        let coredump_id = uuid::Uuid::new_v4();
        let client_state = self.get_client_state().await?;
        let webrtc_stats = self.get_webrtc_stats().await?;
        let os = self.os().await?;
        let screenshot_url = self.upload_screenshot(&coredump_id, &zoo_client).await?;

        let mut core_dump_info = CoreDumpInfo {
            id: coredump_id,
            version: self.version()?,
            git_rev: git_rev::try_revision_string!().map_or_else(|| "unknown".to_string(), |s| s.to_string()),
            timestamp: chrono::Utc::now(),
            tauri: self.is_desktop()?,
            os,
            webrtc_stats,
            github_issue_url: None,
            pool: self.pool()?,
            client_state,
        };

        // pretty-printed JSON byte vector of the coredump.
        let data = serde_json::to_vec_pretty(&core_dump_info)?;

        // Upload the coredump.
        let links = zoo_client
            .meta()
            .create_debug_uploads(vec![kittycad::types::multipart::Attachment {
                name: "".to_string(),
                filename: Some(format!(r#"modeling-app/coredump-{}.json"#, coredump_id)),
                content_type: Some("application/json".to_string()),
                data,
            }])
            .await
            .map_err(|e| anyhow::anyhow!(e.to_string()))?;

        if links.is_empty() {
            anyhow::bail!("Failed to upload coredump");
        }

        let coredump_url = &links[0];

        core_dump_info.set_github_issue_url(&screenshot_url, coredump_url, &coredump_id)?;

        Ok(core_dump_info)
    }
}

/// The app info structure.
/// The Core Dump Info structure.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
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
    /// If the app is running in tauri or the browser.
    pub tauri: bool,
    /// The os info.
    pub os: OsInfo,
    /// The webrtc stats.
    pub webrtc_stats: WebrtcStats,
    /// A GitHub issue url to report the core dump.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub github_issue_url: Option<String>,
    /// Engine pool the client is connected to.
    pub pool: String,
    /// The client state (singletons and xstate).
    pub client_state: JValue,
}

impl CoreDumpInfo {
    /// Set the github issue url.
    pub fn set_github_issue_url(&mut self, screenshot_url: &str, coredump_url: &str, coredump_id: &Uuid) -> Result<()> {
        let coredump_filename = Path::new(coredump_url).file_name().unwrap().to_str().unwrap();
        let tauri_or_browser_label = if self.tauri { "tauri" } else { "browser" };
        let labels = ["coredump", "bug", tauri_or_browser_label];
        let body = format!(
            r#"[Add a title above and insert a description of the issue here]

![Screenshot]({screenshot_url})

<details>
<summary><b>Core Dump</b></summary>

[{coredump_filename}]({coredump_url})

Reference ID: {coredump_id}
</details>
"#
        );
        let urlencoded: String = form_urlencoded::byte_serialize(body.as_bytes()).collect();

        // Note that `github_issue_url` is not included in the coredump file.
        // It has already been encoded and uploaded at this point.
        // The `github_issue_url` is used in openWindow in wasm.ts.
        self.github_issue_url = Some(format!(
            r#"https://github.com/{}/{}/issues/new?body={}&labels={}"#,
            "KittyCAD",
            "modeling-app",
            urlencoded,
            labels.join(",")
        ));

        Ok(())
    }
}

/// The os info structure.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
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
#[derive(Default, Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub struct WebrtcStats {
    /// The packets lost.
    pub packets_lost: u32,
    /// The frames received.
    pub frames_received: u32,
    /// The frame width.
    pub frame_width: f32,
    /// The frame height.
    pub frame_height: f32,
    /// The frame rate.
    pub frame_rate: f32,
    /// The number of key frames decoded.
    pub key_frames_decoded: u32,
    /// The number of frames dropped.
    pub frames_dropped: u32,
    /// The pause count.
    pub pause_count: u32,
    /// The total pauses duration.
    pub total_pauses_duration: f32,
    /// The freeze count.
    pub freeze_count: u32,
    /// The total freezes duration.
    pub total_freezes_duration: f32,
    /// The pli count.
    pub pli_count: u32,
    /// Packet jitter for this synchronizing source, measured in seconds.
    pub jitter: f32,
}
