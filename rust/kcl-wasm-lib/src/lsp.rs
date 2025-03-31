//! Wasm interface for our LSP servers.

use futures::stream::TryStreamExt;
use tower_lsp::{LspService, Server};
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub struct LspServerConfig {
    into_server: js_sys::AsyncIterator,
    from_server: web_sys::WritableStream,
    fs: kcl_lib::wasm_engine::FileSystemManager,
}

#[wasm_bindgen]
impl LspServerConfig {
    #[wasm_bindgen(constructor)]
    pub fn new(
        into_server: js_sys::AsyncIterator,
        from_server: web_sys::WritableStream,
        fs: kcl_lib::wasm_engine::FileSystemManager,
    ) -> Self {
        Self {
            into_server,
            from_server,
            fs,
        }
    }
}

/// Run the `kcl` lsp server.
//
// NOTE: we don't use web_sys::ReadableStream for input here because on the
// browser side we need to use a ReadableByteStreamController to construct it
// and so far only Chromium-based browsers support that functionality.

// NOTE: input needs to be an AsyncIterator<Uint8Array, never, void> specifically
#[wasm_bindgen]
pub async fn lsp_run_kcl(config: LspServerConfig, token: String, baseurl: String) -> Result<(), JsValue> {
    console_error_panic_hook::set_once();

    let LspServerConfig {
        into_server,
        from_server,
        fs,
    } = config;

    let executor_ctx = None;

    let mut zoo_client = kittycad::Client::new(token);
    zoo_client.set_base_url(baseurl.as_str());

    // Check if we can send telemetry for this user.
    let can_send_telemetry = match zoo_client.users().get_privacy_settings().await {
        Ok(privacy_settings) => privacy_settings.can_train_on_data,
        Err(err) => {
            // In the case of dev we don't always have a sub set, but prod we should.
            if err
                .to_string()
                .contains("The modeling app subscription type is missing.")
            {
                true
            } else {
                web_sys::console::warn_1(&format!("Failed to get privacy settings: {err:?}").into());
                false
            }
        }
    };

    let (service, socket) = LspService::build(|client| {
        kcl_lib::KclLspBackend::new_wasm(client, executor_ctx, fs, zoo_client, can_send_telemetry).unwrap()
    })
    .custom_method("kcl/updateCanExecute", kcl_lib::KclLspBackend::update_can_execute)
    .finish();

    let input = wasm_bindgen_futures::stream::JsStream::from(into_server);
    let input = input
        .map_ok(|value| {
            value
                .dyn_into::<js_sys::Uint8Array>()
                .expect("could not cast stream item to Uint8Array")
                .to_vec()
        })
        .map_err(|_err| std::io::Error::from(std::io::ErrorKind::Other))
        .into_async_read();

    let output = wasm_bindgen::JsCast::unchecked_into::<wasm_streams::writable::sys::WritableStream>(from_server);
    let output = wasm_streams::WritableStream::from_raw(output);
    let output = output.try_into_async_write().map_err(|err| err.0)?;

    Server::new(input, output, socket).serve(service).await;

    Ok(())
}

/// Run the `copilot` lsp server.
//
// NOTE: we don't use web_sys::ReadableStream for input here because on the
// browser side we need to use a ReadableByteStreamController to construct it
// and so far only Chromium-based browsers support that functionality.

// NOTE: input needs to be an AsyncIterator<Uint8Array, never, void> specifically
#[wasm_bindgen]
pub async fn lsp_run_copilot(config: LspServerConfig, token: String, baseurl: String) -> Result<(), JsValue> {
    console_error_panic_hook::set_once();

    let LspServerConfig {
        into_server,
        from_server,
        fs,
    } = config;

    let mut zoo_client = kittycad::Client::new(token);
    zoo_client.set_base_url(baseurl.as_str());

    let dev_mode = baseurl == "https://api.dev.zoo.dev";

    let (service, socket) =
        LspService::build(|client| kcl_lib::CopilotLspBackend::new_wasm(client, fs, zoo_client, dev_mode))
            .custom_method("copilot/setEditorInfo", kcl_lib::CopilotLspBackend::set_editor_info)
            .custom_method(
                "copilot/getCompletions",
                kcl_lib::CopilotLspBackend::get_completions_cycling,
            )
            .custom_method("copilot/notifyAccepted", kcl_lib::CopilotLspBackend::accept_completion)
            .custom_method("copilot/notifyRejected", kcl_lib::CopilotLspBackend::reject_completions)
            .finish();

    let input = wasm_bindgen_futures::stream::JsStream::from(into_server);
    let input = input
        .map_ok(|value| {
            value
                .dyn_into::<js_sys::Uint8Array>()
                .expect("could not cast stream item to Uint8Array")
                .to_vec()
        })
        .map_err(|_err| std::io::Error::from(std::io::ErrorKind::Other))
        .into_async_read();

    let output = wasm_bindgen::JsCast::unchecked_into::<wasm_streams::writable::sys::WritableStream>(from_server);
    let output = wasm_streams::WritableStream::from_raw(output);
    let output = output.try_into_async_write().map_err(|err| err.0)?;

    Server::new(input, output, socket).serve(service).await;

    Ok(())
}
