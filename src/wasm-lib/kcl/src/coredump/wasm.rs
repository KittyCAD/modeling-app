//! Functions for getting core dump information via wasm.

use anyhow::Result;
use wasm_bindgen::prelude::wasm_bindgen;

use crate::{coredump::CoreDump, wasm::JsFuture};

#[wasm_bindgen(module = "/../../lib/coredump.ts")]
extern "C" {
    #[derive(Debug, Clone)]
    pub type CoreDumpManager;

    #[wasm_bindgen(method, js_name = version, catch)]
    fn version(this: &CoreDumpManager) -> Result<String, js_sys::Error>;

    #[wasm_bindgen(method, js_name = getOsInfo, catch)]
    fn get_os_info(this: &CoreDumpManager) -> Result<js_sys::Promise, js_sys::Error>;

    #[wasm_bindgen(method, js_name = isTauri, catch)]
    fn is_tauri(this: &CoreDumpManager) -> Result<bool, js_sys::Error>;

    #[wasm_bindgen(method, js_name = getWebrtcStats, catch)]
    fn get_webrtc_stats(this: &CoreDumpManager) -> Result<js_sys::Promise, js_sys::Error>;

    #[wasm_bindgen(method, js_name = screenshot, catch)]
    fn screenshot(this: &CoreDumpManager) -> Result<js_sys::Promise, js_sys::Error>;
}

#[derive(Debug, Clone)]
pub struct CoreDumper {
    manager: CoreDumpManager,
}

impl CoreDumper {
    pub fn new(manager: CoreDumpManager) -> Self {
        CoreDumper { manager }
    }
}

unsafe impl Send for CoreDumper {}
unsafe impl Sync for CoreDumper {}

#[async_trait::async_trait]
impl CoreDump for CoreDumper {
    fn version(&self) -> Result<String> {
        self.manager
            .version()
            .map_err(|e| anyhow::anyhow!("Failed to get response from version: {:?}", e))
    }

    async fn os(&self) -> Result<crate::coredump::OsInfo> {
        let promise = self
            .manager
            .get_os_info()
            .map_err(|e| anyhow::anyhow!("Failed to get promise from get os info: {:?}", e))?;

        let value = JsFuture::from(promise)
            .await
            .map_err(|e| anyhow::anyhow!("Failed to get response from os info: {:?}", e))?;

        // Parse the value as a string.
        let s = value
            .as_string()
            .ok_or_else(|| anyhow::anyhow!("Failed to get string from response from os info: `{:?}`", value))?;

        let os: crate::coredump::OsInfo =
            serde_json::from_str(&s).map_err(|e| anyhow::anyhow!("Failed to parse os info: {:?}", e))?;

        Ok(os)
    }

    fn is_tauri(&self) -> Result<bool> {
        self.manager
            .is_tauri()
            .map_err(|e| anyhow::anyhow!("Failed to get response from is tauri: {:?}", e))
    }

    async fn get_webrtc_stats(&self) -> Result<crate::coredump::WebrtcStats> {
        let promise = self
            .manager
            .get_webrtc_stats()
            .map_err(|e| anyhow::anyhow!("Failed to get promise from get webrtc stats: {:?}", e))?;

        let value = JsFuture::from(promise)
            .await
            .map_err(|e| anyhow::anyhow!("Failed to get response from webrtc stats: {:?}", e))?;

        // Parse the value as a string.
        let s = value
            .as_string()
            .ok_or_else(|| anyhow::anyhow!("Failed to get string from response from webrtc stats: `{:?}`", value))?;

        let stats: crate::coredump::WebrtcStats =
            serde_json::from_str(&s).map_err(|e| anyhow::anyhow!("Failed to parse webrtc stats: {:?}", e))?;

        Ok(stats)
    }

    async fn screenshot(&self) -> Result<String> {
        let promise = self
            .manager
            .screenshot()
            .map_err(|e| anyhow::anyhow!("Failed to get promise from get screenshot: {:?}", e))?;

        let value = JsFuture::from(promise)
            .await
            .map_err(|e| anyhow::anyhow!("Failed to get response from screenshot: {:?}", e))?;

        // Parse the value as a string.
        let s = value
            .as_string()
            .ok_or_else(|| anyhow::anyhow!("Failed to get string from response from screenshot: `{:?}`", value))?;

        Ok(s)
    }
}
