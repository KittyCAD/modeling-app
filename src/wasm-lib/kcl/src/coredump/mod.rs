//! Core dump related structures and functions.

#[cfg(not(target_arch = "wasm32"))]
pub mod local;
#[cfg(target_arch = "wasm32")]
pub mod wasm;

use anyhow::Result;
use base64::Engine;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

#[async_trait::async_trait(?Send)]
pub trait CoreDump: Clone {
    /// Return the authentication token.
    fn token(&self) -> Result<String>;

    fn version(&self) -> Result<String>;

    async fn os(&self) -> Result<OsInfo>;

    fn is_tauri(&self) -> Result<bool>;

    async fn get_webrtc_stats(&self) -> Result<WebrtcStats>;

    /// Return a screenshot of the app.
    async fn screenshot(&self) -> Result<String>;

    /// Get a screenshot of the app and upload it to public cloud storage.
    async fn upload_screenshot(&self) -> Result<String> {
        let screenshot = self.screenshot().await?;
        let cleaned = screenshot.trim_start_matches("data:image/png;base64,");
        // Create the zoo client.
        let zoo = kittycad::Client::new(self.token()?);
        // Base64 decode the screenshot.
        let data = base64::engine::general_purpose::STANDARD.decode(cleaned)?;
        // Upload the screenshot.
        let links = zoo
            .meta()
            .create_debug_uploads(vec![kittycad::types::multipart::Attachment {
                name: "".to_string(),
                filename: Some("modeling-app/core-dump-screenshot.png".to_string()),
                content_type: None,
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
    async fn dump(&self) -> Result<AppInfo> {
        let webrtc_stats = self.get_webrtc_stats().await?;
        let os = self.os().await?;
        let screenshot_url = self.upload_screenshot().await?;

        let mut app_info = AppInfo {
            version: self.version()?,
            git_rev: git_rev::try_revision_string!().map_or_else(|| "unknown".to_string(), |s| s.to_string()),
            timestamp: chrono::Utc::now(),
            tauri: self.is_tauri()?,
            os,
            webrtc_stats,
            github_issue_url: None,
        };
        app_info.set_github_issue_url(&screenshot_url)?;

        Ok(app_info)
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

    /// The os info.
    pub os: OsInfo,

    /// The webrtc stats.
    pub webrtc_stats: WebrtcStats,

    /// A GitHub issue url to report the core dump.
    /// This gets prepoulated with all the core dump info.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub github_issue_url: Option<String>,
}

impl AppInfo {
    /// Set the github issue url.
    pub fn set_github_issue_url(&mut self, screenshot_url: &str) -> Result<()> {
        let tauri_or_browser_label = if self.tauri { "tauri" } else { "browser" };
        let labels = ["coredump", "bug", tauri_or_browser_label];
        let body = format!(
            r#"[Insert a description of the issue here]

![Screenshot]({})

<details>
<summary><b>Core Dump</b></summary>

```json
{}
```
</details>
"#,
            screenshot_url,
            serde_json::to_string_pretty(&self)?
        );
        let urlencoded: String = form_urlencoded::byte_serialize(body.as_bytes()).collect();

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
