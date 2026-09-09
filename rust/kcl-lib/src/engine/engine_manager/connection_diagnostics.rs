use std::io::Write;
use std::sync::atomic::AtomicBool;
use std::sync::atomic::Ordering;
use std::time::SystemTime;
use std::time::UNIX_EPOCH;

/// Native transport diagnostics, including builds that disable ordinary KCL logging.
/// Capture the upgrade ID before starting either actor: session data can arrive too late.
pub(super) struct ConnectionDiagnostics {
    enabled: bool,
    request_id: Option<String>,
    local_close_requested: AtomicBool,
}

impl ConnectionDiagnostics {
    pub(super) fn new(request_id: Option<String>) -> Self {
        Self {
            enabled: std::env::var("ZOO_ENGINE_CONNECTION_DIAGNOSTICS").as_deref() == Ok("1"),
            request_id,
            local_close_requested: AtomicBool::new(false),
        }
    }

    pub(super) fn request_close(&self) {
        self.local_close_requested.store(true, Ordering::Relaxed);
    }

    pub(super) fn error(&self, operation: &str, error: impl std::fmt::Debug) {
        if !self.enabled {
            return;
        }

        let record = serde_json::json!({
            "event": "engine_connection_error",
            "timestamp_ms": SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis(),
            "request_id": self.request_id,
            "operation": operation,
            // This records local intent, not proof that local teardown caused the error.
            "local_close_requested": self.local_close_requested.load(Ordering::Relaxed),
            "error": format!("{error:?}"),
        });
        // Deliberately bypass disable-println, but only with the explicit diagnostic opt-in.
        // A logging failure must not change transport behavior.
        let _ = writeln!(std::io::stderr().lock(), "{record}");
    }
}

pub(super) fn upgrade_request_id(headers: &reqwest::header::HeaderMap) -> Option<String> {
    // Never dump the response headers or select names by substring.
    headers.get("x-request-id")?.to_str().ok().map(str::to_owned)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn upgrade_request_id_uses_only_the_exact_header() {
        let mut headers = reqwest::header::HeaderMap::new();
        headers.insert("x-other-request-id", "unrelated".parse().unwrap());
        headers.insert("set-cookie", "private-cookie".parse().unwrap());
        assert_eq!(upgrade_request_id(&headers), None);
        headers.insert("x-request-id", "early-request-id".parse().unwrap());
        assert_eq!(upgrade_request_id(&headers).as_deref(), Some("early-request-id"));
        headers.insert(
            "x-request-id",
            reqwest::header::HeaderValue::from_bytes(&[0xff]).unwrap(),
        );
        assert_eq!(upgrade_request_id(&headers), None);
    }
}
