//! How we build the request to send to the API.
use chrono::Utc;
use reqwest::{Client, RequestBuilder};
use std::sync::Arc;
use uuid::Uuid;

use crate::server::copilot::types::{CopilotCompletionParams, CopilotCompletionRequest};

/// Build a request to send to the API.
// TODO: make this the kittycad api.
// TODO: add auth.
pub fn build_request(http_client: Arc<Client>, language: String, prompt: String, suffix: String) -> RequestBuilder {
    let extra = CopilotCompletionParams {
        language: language.to_string(),
        next_indent: 0,
        trim_by_indentation: true,
        prompt_tokens: prompt.len() as i32,
        suffix_tokens: suffix.len() as i32,
    };
    let body = Some(CopilotCompletionRequest {
        prompt,
        suffix,
        max_tokens: 500,
        temperature: 1.0,
        top_p: 1.0,
        n: 3,
        stop: ["unset".to_string()].to_vec(),
        nwo: "my_org/my_repo".to_string(),
        stream: true,
        extra,
    });
    let body = serde_json::to_string(&body).unwrap();
    let completions_url = "https://copilot-proxy.githubusercontent.com/v1/engines/copilot-codex/completions";
    http_client
        .post(completions_url)
        .header("X-Request-Id", Uuid::new_v4().to_string())
        .header(
            "VScode-SessionId",
            Uuid::new_v4().to_string() + &Utc::now().timestamp().to_string(),
        )
        .body(body)
}
