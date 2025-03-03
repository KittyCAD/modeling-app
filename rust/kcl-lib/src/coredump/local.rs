//! Functions for getting core dump information via local rust.

use anyhow::Result;
use serde_json::Value as JValue;

use crate::coredump::CoreDump;

#[derive(Debug, Clone)]
pub struct CoreDumper {}

impl CoreDumper {
    pub fn new() -> Self {
        CoreDumper {}
    }
}

impl Default for CoreDumper {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait::async_trait(?Send)]
impl CoreDump for CoreDumper {
    fn token(&self) -> Result<String> {
        Ok(std::env::var("KITTYCAD_API_TOKEN").unwrap_or_default())
    }

    fn base_api_url(&self) -> Result<String> {
        Ok("https://api.zoo.dev".to_string())
    }

    fn version(&self) -> Result<String> {
        Ok(env!("CARGO_PKG_VERSION").to_string())
    }

    fn kcl_code(&self) -> Result<String> {
        Ok("".to_owned())
    }

    fn pool(&self) -> Result<String> {
        Ok("".to_owned())
    }

    fn os(&self) -> Result<crate::coredump::OsInfo> {
        Ok(crate::coredump::OsInfo {
            platform: Some(std::env::consts::OS.to_string()),
            arch: Some(std::env::consts::ARCH.to_string()),
            version: None,
            browser: None,
        })
    }

    fn is_desktop(&self) -> Result<bool> {
        Ok(false)
    }

    async fn get_webrtc_stats(&self) -> Result<crate::coredump::WebrtcStats> {
        // TODO: we could actually implement this.
        Ok(crate::coredump::WebrtcStats::default())
    }

    async fn get_client_state(&self) -> Result<JValue> {
        Ok(JValue::default())
    }

    async fn screenshot(&self) -> Result<String> {
        // Take a screenshot of the engine.
        todo!()
    }
}
