//! The cache.

use std::{
    collections::HashMap,
    fmt::Debug,
    sync::{Mutex, RwLock},
};

use crate::lsp::copilot::types::CopilotCompletionResponse;

// if file changes, keep the cache.
// if line number is different for an existing file, clean.
#[derive(Debug)]
pub struct CopilotCache {
    inner: RwLock<HashMap<String, Mutex<CopilotCompletionResponse>>>,
    last_line: RwLock<HashMap<String, Mutex<u32>>>,
}

impl Default for CopilotCache {
    fn default() -> Self {
        Self::new()
    }
}

impl CopilotCache {
    pub fn new() -> Self {
        Self {
            inner: RwLock::new(HashMap::new()),
            last_line: RwLock::new(HashMap::new()),
        }
    }

    fn get_last_line(&self, uri: &String) -> Option<u32> {
        let Ok(inner) = self.last_line.read() else {
            return None;
        };
        let last_line = inner.get(uri);
        match last_line {
            Some(last_line) => {
                let Ok(last_line) = last_line.lock() else {
                    return None;
                };
                Some(*last_line)
            }
            None => None,
        }
    }

    fn get_cached_response(&self, uri: &String, _lnum: u32) -> Option<CopilotCompletionResponse> {
        let Ok(inner) = self.inner.read() else {
            return None;
        };
        let cache = inner.get(uri);
        match cache {
            Some(completion_response) => {
                let Ok(completion_response) = completion_response.lock() else {
                    return None;
                };
                Some(completion_response.clone())
            }
            None => None,
        }
    }

    fn set_file_cache(&self, uri: &str, completion_response: CopilotCompletionResponse) {
        let Ok(mut inner) = self.inner.write() else {
            return;
        };
        inner.insert(uri.to_string(), Mutex::new(completion_response));
    }

    fn set_last_line(&self, uri: &str, last_line: u32) {
        let Ok(mut inner) = self.last_line.write() else {
            return;
        };
        inner.insert(uri.to_string(), Mutex::new(last_line));
    }

    pub fn get_cached_result(&self, uri: &String, last_line: u32) -> Option<CopilotCompletionResponse> {
        let cached_line = self.get_last_line(uri)?;
        if last_line != cached_line {
            return None;
        };
        self.get_cached_response(uri, last_line)
    }

    pub fn set_cached_result(
        &self,
        uri: &String,
        lnum: &u32,
        completion_response: &CopilotCompletionResponse,
    ) -> Option<CopilotCompletionResponse> {
        self.set_file_cache(uri, completion_response.clone());
        self.set_last_line(uri, *lnum);
        let Ok(inner) = self.inner.write() else {
            return None;
        };
        let cache = inner.get(uri);
        match cache {
            Some(completion_response) => {
                let Ok(completion_response) = completion_response.lock() else {
                    return None;
                };
                Some(completion_response.clone())
            }
            None => None,
        }
    }
}
