//! Functions for getting core dump information via wasm.

use anyhow::Result;
use serde_json::Value as JValue;
use wasm_bindgen::prelude::wasm_bindgen;

use crate::{coredump::CoreDump, wasm::JsFuture};

#[wasm_bindgen(module = "/../../lib/coredump.ts")]
extern "C" {
    #[derive(Debug, Clone)]
    pub type CoreDumpManager;

    #[wasm_bindgen(method, js_name = authToken, catch)]
    fn auth_token(this: &CoreDumpManager) -> Result<String, js_sys::Error>;

    #[wasm_bindgen(method, js_name = baseApiUrl, catch)]
    fn baseApiUrl(this: &CoreDumpManager) -> Result<String, js_sys::Error>;

    #[wasm_bindgen(method, js_name = pool, catch)]
    fn pool(this: &CoreDumpManager) -> Result<String, js_sys::Error>;

    #[wasm_bindgen(method, js_name = version, catch)]
    fn version(this: &CoreDumpManager) -> Result<String, js_sys::Error>;

    #[wasm_bindgen(method, js_name = kclCode, catch)]
    fn kcl_code(this: &CoreDumpManager) -> Result<String, js_sys::Error>;

    #[wasm_bindgen(method, js_name = getOsInfo, catch)]
    fn get_os_info(this: &CoreDumpManager) -> Result<js_sys::Promise, js_sys::Error>;

    #[wasm_bindgen(method, js_name = isTauri, catch)]
    fn is_tauri(this: &CoreDumpManager) -> Result<bool, js_sys::Error>;

    #[wasm_bindgen(method, js_name = getWebrtcStats, catch)]
    fn get_webrtc_stats(this: &CoreDumpManager) -> Result<js_sys::Promise, js_sys::Error>;

    #[wasm_bindgen(method, js_name = getClientState, catch)]
    fn get_client_state(this: &CoreDumpManager) -> Result<js_sys::Promise, js_sys::Error>;

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

#[async_trait::async_trait(?Send)]
impl CoreDump for CoreDumper {
    fn token(&self) -> Result<String> {
        self.manager
            .auth_token()
            .map_err(|e| anyhow::anyhow!("Failed to get response from token: {:?}", e))
    }

    fn base_api_url(&self) -> Result<String> {
        self.manager
            .baseApiUrl()
            .map_err(|e| anyhow::anyhow!("Failed to get response from base api url: {:?}", e))
    }

    fn version(&self) -> Result<String> {
        self.manager
            .version()
            .map_err(|e| anyhow::anyhow!("Failed to get response from version: {:?}", e))
    }

    fn kcl_code(&self) -> Result<String> {
        self.manager
            .kcl_code()
            .map_err(|e| anyhow::anyhow!("Failed to get response from kcl code: {:?}", e))
    }

    fn pool(&self) -> Result<String> {
        self.manager
            .pool()
            .map_err(|e| anyhow::anyhow!("Failed to get response from pool: {:?}", e))
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

    async fn get_client_state(&self) -> Result<JValue> {
        let promise = self
            .manager
            .get_client_state()
            .map_err(|e| anyhow::anyhow!("Failed to get promise from get client state: {:?}", e))?;

        let value = JsFuture::from(promise)
            .await
            .map_err(|e| anyhow::anyhow!("Failed to get response from client state: {:?}", e))?;

        // Parse the value as a string.
        let s = value
            .as_string()
            .ok_or_else(|| anyhow::anyhow!("Failed to get string from response from client stat: `{:?}`", value))?;

        let client_state: JValue =
            serde_json::from_str(&s).map_err(|e| anyhow::anyhow!("Failed to parse client state: {:?}", e))?;

        Ok(client_state)
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
