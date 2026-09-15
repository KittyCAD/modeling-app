//! Connection IDs observed while talking to the Zoo backend.

use std::sync::Arc;
use std::sync::Mutex;

/// A shared collector that survives connection failure and task cancellation.
/// Clones share storage; snapshots contain distinct IDs in observation order.
#[derive(Clone, Debug, Default)]
pub struct ApiCallTrace {
    ids: Arc<Mutex<Vec<String>>>,
}

impl ApiCallTrace {
    /// Take a snapshot without exposing the collector's mutable storage.
    pub fn api_call_ids(&self) -> Vec<String> {
        self.ids.lock().unwrap_or_else(|error| error.into_inner()).clone()
    }

    pub(crate) fn record(&self, id: String) {
        if id.is_empty() {
            return;
        }
        let mut ids = self.ids.lock().unwrap_or_else(|error| error.into_inner());
        if !ids.contains(&id) {
            ids.push(id);
        }
    }

    pub(crate) fn record_headers(&self, headers: &http::HeaderMap) {
        if let Some(id) = ["x-api-call-id", "x-request-id"].into_iter().find_map(|name| {
            headers
                .get(name)
                .and_then(|value| value.to_str().ok())
                .filter(|id| !id.is_empty())
        }) {
            self.record(id.to_owned());
        }
    }

    pub(crate) fn record_error(&self, error: &kittycad::types::error::Error) {
        match error {
            kittycad::types::error::Error::UnexpectedResponse { headers, .. } => self.record_headers(headers),
            kittycad::types::error::Error::InvalidResponsePayload { response, .. } => {
                self.record_headers(response.headers());
            }
            _ => {}
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn header_precedence_deduplication_and_snapshot_isolation() {
        let trace = ApiCallTrace::default();
        let mut headers = http::HeaderMap::new();
        headers.insert("x-request-id", "fallback".parse().unwrap());
        headers.insert("x-api-call-id", "connection".parse().unwrap());
        trace.record_headers(&headers);
        let snapshot = trace.api_call_ids();
        trace.record("connection".to_owned());
        headers.remove("x-api-call-id");
        trace.record_headers(&headers);
        assert_eq!(snapshot, ["connection"]);
        assert_eq!(trace.api_call_ids(), ["connection", "fallback"]);
    }

    #[test]
    fn rejected_handshake_and_pre_response_failure() {
        let trace = ApiCallTrace::default();
        trace.record_error(&kittycad::types::error::Error::InvalidRequest("invalid".to_owned()));
        assert!(trace.api_call_ids().is_empty());
        let mut headers = http::HeaderMap::new();
        headers.insert("x-request-id", "rejected".parse().unwrap());
        trace.record_error(&kittycad::types::error::Error::UnexpectedResponse {
            status: reqwest::StatusCode::UNAUTHORIZED,
            url: "http://localhost".to_owned(),
            body: String::new(),
            headers,
        });
        assert_eq!(trace.api_call_ids(), ["rejected"]);
    }

    #[test]
    fn clones_can_record_from_other_threads() {
        let trace = ApiCallTrace::default();
        let other = trace.clone();
        std::thread::spawn(move || other.record("connection".to_owned()))
            .join()
            .unwrap();
        assert_eq!(trace.api_call_ids(), ["connection"]);
    }
}
