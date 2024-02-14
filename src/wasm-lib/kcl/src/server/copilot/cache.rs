//! The cache.

use std::{
    collections::HashMap,
    fmt::Debug,
    sync::{Mutex, RwLock},
};



use crate::server::copilot::types::{CopilotCompletionResponse};

// if file changes, keep the cache
// if line number is different for an existing file, clean
#[derive(Debug)]
pub struct CopilotCache {
    inner: RwLock<HashMap<String, Mutex<CopilotCompletionResponse>>>,
    last_line: RwLock<HashMap<String, Mutex<u32>>>,
    pending: RwLock<Mutex<bool>>,
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
            pending: RwLock::new(Mutex::new(false)),
        }
    }

    fn get_last_line(&self, uri: &String) -> Option<u32> {
        let inner = self.last_line.read().unwrap();
        let last_line = inner.get(uri);
        match last_line {
            Some(last_line) => {
                let last_line = last_line.lock().unwrap();
                Some(*last_line)
            }
            None => None,
        }
    }

    fn get_cached_response(&self, uri: &String, _lnum: u32) -> Option<CopilotCompletionResponse> {
        let inner = self.inner.read().unwrap();
        let cache = inner.get(uri);
        match cache {
            Some(completion_response) => {
                let completion_response = completion_response.lock().unwrap();
                Some(completion_response.clone())
            }
            None => None,
        }
    }

    fn set_file_cache(&self, uri: &String, completion_response: CopilotCompletionResponse) {
        let mut inner = self.inner.write().unwrap();
        inner.insert(uri.clone(), Mutex::new(completion_response));
    }

    fn set_last_line(&self, uri: &String, last_line: u32) {
        let mut inner = self.last_line.write().unwrap();
        inner.insert(uri.clone(), Mutex::new(last_line));
    }

    pub fn get_cached_result(&self, uri: &String, last_line: u32) -> Option<CopilotCompletionResponse> {
        let cached_line = self.get_last_line(uri);
        if cached_line.is_none() || cached_line.unwrap() != last_line {
            return None;
        }
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
        let inner = self.inner.write().unwrap();
        let cache = inner.get(uri);
        match cache {
            Some(completion_response) => {
                let completion_response = completion_response.lock().unwrap();
                Some(completion_response.clone())
            }
            None => None,
        }
    }
}
