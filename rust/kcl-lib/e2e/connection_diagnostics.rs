#![cfg(not(target_arch = "wasm32"))]

use std::collections::HashMap;
use std::time::Duration;

use futures::StreamExt;
use kcl_lib::ExecutorContext;
use kcl_lib::ExecutorSettings;
use kcl_lib::SourceRange;
use kittycad_modeling_cmds::websocket::WebSocketRequest;
use tokio_tungstenite::tungstenite::Message as WsMsg;
use uuid::Uuid;

const DIAGNOSTICS_ENV: &str = "ZOO_ENGINE_CONNECTION_DIAGNOSTICS";

#[test]
fn connection_diagnostics_capture_early_failure_and_teardown() {
    // This integration test links kcl-lib as a normal dependency (without cfg(test)).
    // Cargo requires disable-println for this target, matching the LSP's library build.
    // Subprocesses capture stderr without changing other tests' environments.
    for enabled in [None, Some("0"), Some("1")] {
        let mut command = std::process::Command::new(std::env::current_exe().unwrap());
        command.args(["--exact", "connection_diagnostics_fixture", "--ignored", "--nocapture"]);
        command.env_remove(DIAGNOSTICS_ENV).env_remove("ZOO_LOG");
        if let Some(enabled) = enabled {
            command.env(DIAGNOSTICS_ENV, enabled);
        }
        let output = command.output().unwrap();
        let stderr = String::from_utf8(output.stderr).unwrap();
        assert!(output.status.success(), "fixture failed: {stderr}");
        assert!(!stderr.contains("private-cookie"));
        assert!(!stderr.contains("unrelated-request-id"));
        let records: Vec<serde_json::Value> = stderr
            .lines()
            .filter_map(|line| serde_json::from_str::<serde_json::Value>(line).ok())
            .filter(|record| record["event"] == "engine_connection_error")
            .collect();
        if enabled != Some("1") {
            assert!(records.is_empty(), "diagnostics must be opt-in: {stderr}");
            continue;
        }

        for record in &records {
            assert!(record["timestamp_ms"].as_u64().unwrap() > 0);
            assert!(matches!(
                record["request_id"].as_str(),
                Some("early-reset" | "local-teardown")
            ));
        }
        let early_read = records
            .iter()
            .find(|r| r["request_id"] == "early-reset" && r["operation"] == "read")
            .expect("missing early read diagnostic from the non-test kcl-lib build");
        assert_eq!(early_read["local_close_requested"], false);
        assert!(
            early_read["error"]
                .as_str()
                .unwrap()
                .contains("ResetWithoutClosingHandshake")
        );
        let later_send = records
            .iter()
            .find(|r| r["request_id"] == "early-reset" && r["operation"] == "send")
            .unwrap();
        assert_eq!(later_send["local_close_requested"], false);
        assert!(later_send["error"].as_str().unwrap().contains("closed connection"));
        let teardown = records
            .iter()
            .find(|r| r["request_id"] == "local-teardown" && r["operation"].as_str().unwrap().starts_with("read"))
            .unwrap();
        assert_eq!(teardown["local_close_requested"], true);
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
#[ignore = "subprocess fixture invoked by connection_diagnostics_capture_early_failure_and_teardown"]
async fn connection_diagnostics_fixture() {
    for local_close in [false, true] {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server =
            tokio::spawn(async move {
                let (socket, _) = listener.accept().await.unwrap();
                let mut websocket = tokio_tungstenite::accept_hdr_async(
                socket,
                move |_: &tokio_tungstenite::tungstenite::handshake::server::Request,
                      mut response: tokio_tungstenite::tungstenite::handshake::server::Response| {
                    let id = if local_close { "local-teardown" } else { "early-reset" };
                    response.headers_mut().insert("x-request-id", id.parse().unwrap());
                    response.headers_mut().insert("set-cookie", "private-cookie".parse().unwrap());
                    response
                        .headers_mut()
                        .insert("x-other-request-id", "unrelated-request-id".parse().unwrap());
                    Ok(response)
                },
            )
            .await
            .unwrap();
                if local_close {
                    // Match an API that tears down TCP after receiving our Close frame.
                    assert!(matches!(websocket.next().await.unwrap().unwrap(), WsMsg::Close(_)));
                } else {
                    // Let a request finish sending before dropping TCP, so its caller
                    // observes the read failure before trying the subsequent send.
                    assert!(matches!(websocket.next().await.unwrap().unwrap(), WsMsg::Text(_)));
                }
                // Drop without session data or a WebSocket close handshake.
            });

        let http_client = || {
            reqwest::Client::builder()
                .no_proxy()
                .http1_only()
                .timeout(Duration::from_secs(5))
        };
        let mut client = kittycad::Client::new_from_reqwest("synthetic-test-token", http_client(), http_client());
        client.set_base_url(format!("http://{address}"));
        // Use the real executor upgrade path, including propagation of x-request-id.
        let context = ExecutorContext::new(&client, ExecutorSettings::default())
            .await
            .unwrap();
        let manager = &context.engine;

        if local_close {
            tokio::time::timeout(Duration::from_secs(5), context.close())
                .await
                .unwrap();
        } else {
            let result = tokio::time::timeout(
                Duration::from_secs(5),
                manager.transport.inner_send_modeling_cmd(
                    Uuid::new_v4(),
                    SourceRange::default(),
                    WebSocketRequest::Ping {},
                    HashMap::new(),
                ),
            )
            .await
            .unwrap();
            assert!(result.unwrap_err().to_string().contains("websocket closed early"));
            let result = manager
                .transport
                .inner_fire_modeling_cmd(
                    Uuid::new_v4(),
                    SourceRange::default(),
                    WebSocketRequest::Ping {},
                    HashMap::new(),
                )
                .await;
            assert!(result.is_err());
        }
        assert!(manager.get_session_data().await.is_none());
        server.await.unwrap();
    }
}
