//! Functions for getting core dump information via local rust.

use anyhow::Result;

use crate::coredump::CoreDump;

#[derive(Debug, Clone)]
pub struct LocalCoreDump {}

impl LocalCoreDump {
    pub fn new() -> Self {
        LocalCoreDump {}
    }
}

impl Default for LocalCoreDump {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait::async_trait]
impl CoreDump for LocalCoreDump {
    fn version(&self) -> Result<String> {
        Ok(env!("CARGO_PKG_VERSION").to_string())
    }

    async fn os(&self) -> Result<crate::coredump::OsInfo> {
        Ok(crate::coredump::OsInfo {
            platform: std::env::consts::OS.to_string(),
            arch: std::env::consts::ARCH.to_string(),
            version: None,
        })
    }

    fn is_tauri(&self) -> Result<bool> {
        Ok(false)
    }

    async fn get_webrtc_stats(&self) -> Result<crate::coredump::WebrtcStats> {
        // TODO: we could actually implement this.
        Ok(crate::coredump::WebrtcStats::default())
    }
}
