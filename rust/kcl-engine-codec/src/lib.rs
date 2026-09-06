//! Concrete serializers and deserializers for the engine WebSocket protocol.
//!
//! Keeping these entry points in a small crate lets Cargo cache the large serde
//! monomorphizations generated for the modeling command types across `kcl-lib`
//! recompiles.

use kittycad_modeling_cmds::websocket::WebSocketRequest;
use kittycad_modeling_cmds::websocket::WebSocketResponse;

/// Deserialize a JSON engine response.
pub fn deserialize_response_json(message: &str) -> Result<WebSocketResponse, serde_json::Error> {
    serde_json::from_str(message)
}

/// Deserialize a MessagePack engine response.
pub fn deserialize_response_msgpack(message: &[u8]) -> Result<WebSocketResponse, rmp_serde::decode::Error> {
    rmp_serde::from_slice(message)
}

/// Serialize an engine request as JSON.
pub fn serialize_request_json(request: &WebSocketRequest) -> Result<String, serde_json::Error> {
    serde_json::to_string(request)
}

/// Serialize an engine request as named MessagePack.
pub fn serialize_request_msgpack(request: &WebSocketRequest) -> Result<Vec<u8>, rmp_serde::encode::Error> {
    rmp_serde::to_vec_named(request)
}

#[cfg(test)]
mod tests {
    use kittycad_modeling_cmds::websocket::OkWebSocketResponseData;

    use super::*;

    #[test]
    fn request_serializers_accept_ping() {
        let request = WebSocketRequest::Ping {};

        assert_eq!(serialize_request_json(&request).unwrap(), r#"{"type":"ping"}"#);
        assert!(!serialize_request_msgpack(&request).unwrap().is_empty());
    }

    #[test]
    fn response_deserializers_round_trip_pong() {
        let response = WebSocketResponse::success(None, OkWebSocketResponseData::Pong {});
        let json = serde_json::to_string(&response).unwrap();
        let msgpack = rmp_serde::to_vec_named(&response).unwrap();

        assert_eq!(deserialize_response_json(&json).unwrap(), response);
        assert_eq!(deserialize_response_msgpack(&msgpack).unwrap(), response);
    }
}
