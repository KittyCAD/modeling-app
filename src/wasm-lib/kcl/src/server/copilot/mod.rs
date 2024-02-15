//! The copilot lsp server for ghost text.

pub mod cache;
pub mod types;

use std::{
    borrow::Cow,
    fmt::Debug,
    sync::{Arc, RwLock},
};

use eventsource_stream::Eventsource;
use futures::StreamExt;
use reqwest::RequestBuilder;
use serde::{Deserialize, Serialize};
use tower_lsp::{
    jsonrpc::{Error, Result},
    lsp_types::{InitializeParams, InitializeResult, InitializedParams, MessageType, ServerCapabilities},
    Client, LanguageServer,
};

use crate::server::copilot::types::{
    CopilotCompletionParams, CopilotCompletionRequest, CopilotCompletionResponse, CopilotEditorInfo, CopilotResponse,
    DocParams,
};

use self::types::CopilotLspCompletionParams;

#[derive(Deserialize, Serialize, Debug)]
pub struct Success {
    success: bool,
}
impl Success {
    pub fn new(success: bool) -> Self {
        Self { success }
    }
}

#[derive(Debug)]
pub struct Backend {
    /// The client is used to send notifications and requests to the client.
    pub client: Client,
    /// The http client is used to make requests to the API server.
    pub http_client: Arc<reqwest::Client>,
    /// The token is used to authenticate requests to the API server.
    pub token: String,
    /// The editor info is used to store information about the editor.
    pub editor_info: Arc<RwLock<CopilotEditorInfo>>,
    /// The cache is used to store the results of previous requests.
    pub cache: cache::CopilotCache,
}

fn handle_event(event: eventsource_stream::Event) -> CopilotResponse {
    if event.data == "[DONE]" {
        return CopilotResponse::Done;
    }
    match serde_json::from_str(&event.data) {
        Ok(data) => CopilotResponse::Answer(data),
        Err(e) => CopilotResponse::Error(e.to_string()),
    }
}

pub async fn await_stream(req: RequestBuilder) -> anyhow::Result<Vec<String>> {
    /*let resp = req.send().await?;
    let mut stream = resp.bytes_stream().eventsource();
    let mut completion_list = Vec::<String>::with_capacity(4);
    let mut s = "".to_string();

    while let Some(event) = stream.next().await {
        match handle_event(event?) {
            CopilotResponse::Answer(answer) => {
                answer.choices.iter().for_each(|x| {
                    s.push_str(&x.text);
                    if x.finish_reason.is_some() {
                        completion_list.push(s.to_string());
                        s = "".to_string();
                    }
                });
            }
            CopilotResponse::Done => {
                return Ok(completion_list);
            }
            CopilotResponse::Error(_e) => {
                // TODO: log error to lsp server
            }
        }
    }*/

    let completion_list = vec![r#"fn box = (h, l, w) => {
 const myBox = startSketchOn('XY')
    |> startProfileAt([0,0], %)
    |> line([0, l], %)
    |> line([w, 0], %)
    |> line([0, -l], %)
    |> close(%)
    |> extrude(h, %)

  return myBox
}

const fnBox = box(3, 6, 10)

show(fnBox)"#
        .to_string()];

    Ok(completion_list)
}

impl Backend {
    /// Build a request to send to the API.
    fn build_request(&self, language: String, prompt: String, suffix: String) -> anyhow::Result<RequestBuilder> {
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
            // We only handle one completion at a time, for now so don't even waste the tokens.
            n: 1,
            stop: ["unset".to_string()].to_vec(),
            nwo: "kittycad/modeling-app".to_string(),
            stream: true,
            extra,
        });
        let body = serde_json::to_string(&body)?;
        let completions_url = "https://copilot-proxy.githubusercontent.com/v1/engines/copilot-codex/completions";

        Ok(self.http_client.post(completions_url).body(body))
    }

    pub async fn set_editor_info(&self, params: CopilotEditorInfo) -> Result<Success> {
        self.client.log_message(MessageType::INFO, "setEditorInfo").await;
        let copy = Arc::clone(&self.editor_info);
        let mut lock = copy.write().map_err(|err| Error {
            code: tower_lsp::jsonrpc::ErrorCode::from(69),
            data: None,
            message: Cow::from(format!("Failed lock: {}", err)),
        })?;
        *lock = params;
        Ok(Success::new(true))
    }

    pub fn get_doc_params(&self, params: &CopilotLspCompletionParams) -> Result<DocParams> {
        let pos = params.doc.position;
        let uri = params.doc.uri.to_string();
        let rope = ropey::Rope::from_str(&params.doc.source);
        let offset = crate::server::util::position_to_offset(pos, &rope).unwrap_or_default();

        Ok(DocParams {
            uri: uri.to_string(),
            pos,
            language: params.doc.language_id.to_string(),
            prefix: crate::server::util::get_text_before(offset, &rope).unwrap_or_default(),
            suffix: crate::server::util::get_text_after(offset, &rope).unwrap_or_default(),
            line_before: crate::server::util::get_line_before(pos, &rope).unwrap_or_default(),
            rope,
        })
    }

    pub async fn get_completions_cycling(
        &self,
        params: CopilotLspCompletionParams,
    ) -> Result<CopilotCompletionResponse> {
        let doc_params = self.get_doc_params(&params)?;
        let cached_result = self.cache.get_cached_result(&doc_params.uri, doc_params.pos.line);
        if let Some(cached_result) = cached_result {
            return Ok(cached_result);
        }

        let doc_params = self.get_doc_params(&params)?;
        let line_before = doc_params.line_before.to_string();
        let _prompt = format!("// Path: {}\n{}", doc_params.uri, doc_params.prefix);

        let req = self
            .build_request(doc_params.language, doc_params.prefix, doc_params.suffix)
            .map_err(|err| Error {
                code: tower_lsp::jsonrpc::ErrorCode::from(69),
                data: None,
                message: Cow::from(format!("Failed to build request: {}", err)),
            })?;

        let completion_list = await_stream(req).await.map_err(|err| Error {
            code: tower_lsp::jsonrpc::ErrorCode::from(69),
            data: None,
            message: Cow::from(format!("Failed to await stream: {}", err)),
        })?;

        let response = CopilotCompletionResponse::from_str_vec(completion_list, line_before, doc_params.pos);
        self.cache
            .set_cached_result(&doc_params.uri, &doc_params.pos.line, &response);

        Ok(response)
    }

    pub async fn accept_completions(&self, params: Vec<String>) {
        self.client
            .log_message(MessageType::INFO, format!("Accepted completions: {:?}", params))
            .await;

        // TODO: send telemetry data back out that we accepted the completions
    }

    pub async fn reject_completions(&self, params: Vec<String>) {
        self.client
            .log_message(MessageType::INFO, format!("Rejected completions: {:?}", params))
            .await;

        // TODO: send telemetry data back out that we rejected the completions
    }
}

#[tower_lsp::async_trait]
impl LanguageServer for Backend {
    async fn initialize(&self, _: InitializeParams) -> Result<InitializeResult> {
        Ok(InitializeResult {
            capabilities: ServerCapabilities {
                inlay_hint_provider: None,
                text_document_sync: None,
                completion_provider: None,
                workspace: None,
                semantic_tokens_provider: None,
                ..ServerCapabilities::default()
            },
            ..Default::default()
        })
    }
    async fn initialized(&self, _: InitializedParams) {
        self.client.log_message(MessageType::INFO, "initialized!").await;
    }

    async fn shutdown(&self) -> Result<()> {
        Ok(())
    }
}
