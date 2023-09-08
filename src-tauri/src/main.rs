// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::io::Read;

use anyhow::Result;
use oauth2::TokenResponse;
use tauri::{InvokeError, Manager};

/// This command returns the a json string parse from a toml file at the path.
#[tauri::command]
fn read_toml(path: &str) -> Result<String, InvokeError> {
    let mut file = std::fs::File::open(path).map_err(|e| InvokeError::from_anyhow(e.into()))?;
    let mut contents = String::new();
    file.read_to_string(&mut contents)
        .map_err(|e| InvokeError::from_anyhow(e.into()))?;
    let value =
        toml::from_str::<toml::Value>(&contents).map_err(|e| InvokeError::from_anyhow(e.into()))?;
    let value = serde_json::to_string(&value).map_err(|e| InvokeError::from_anyhow(e.into()))?;
    Ok(value)
}

/// This command returns a string that is the contents of a file at the path.
#[tauri::command]
fn read_txt_file(path: &str) -> Result<String, InvokeError> {
    let mut file = std::fs::File::open(path).map_err(|e| InvokeError::from_anyhow(e.into()))?;
    let mut contents = String::new();
    file.read_to_string(&mut contents)
        .map_err(|e| InvokeError::from_anyhow(e.into()))?;
    Ok(contents)
}

/// This command instantiates a new window with auth.
/// The string returned from this method is the access token.
#[tauri::command]
async fn login(app: tauri::AppHandle, host: &str) -> Result<String, InvokeError> {
    println!("Logging in...");
    // Do an OAuth 2.0 Device Authorization Grant dance to get a token.
    let device_auth_url = oauth2::DeviceAuthorizationUrl::new(format!("{host}/oauth2/device/auth"))
        .map_err(|e| InvokeError::from_anyhow(e.into()))?;
    // We can hardcode the client ID.
    // This value is safe to be embedded in version control.
    // This is the client ID of the KittyCAD app.
    let client_id = "2af127fb-e14e-400a-9c57-a9ed08d1a5b7".to_string();
    let auth_client = oauth2::basic::BasicClient::new(
        oauth2::ClientId::new(client_id),
        None,
        oauth2::AuthUrl::new(format!("{host}/authorize"))
            .map_err(|e| InvokeError::from_anyhow(e.into()))?,
        Some(
            oauth2::TokenUrl::new(format!("{host}/oauth2/device/token"))
                .map_err(|e| InvokeError::from_anyhow(e.into()))?,
        ),
    )
    .set_auth_type(oauth2::AuthType::RequestBody)
    .set_device_authorization_url(device_auth_url);

    let details: oauth2::devicecode::StandardDeviceAuthorizationResponse = auth_client
        .exchange_device_code()
        .map_err(|e| InvokeError::from_anyhow(e.into()))?
        .request_async(oauth2::reqwest::async_http_client)
        .await
        .map_err(|e| InvokeError::from_anyhow(e.into()))?;

    let Some(auth_uri) = details.verification_uri_complete() else {
        return Err(InvokeError::from("getting the verification uri failed"));
    };

    // Open the system browser with the auth_uri.
    // We do this in the browser and not a seperate window because we want 1password and
    // other crap to work well.
    tauri::api::shell::open(&app.shell_scope(), auth_uri.secret(), None)
        .map_err(|e| InvokeError::from_anyhow(e.into()))?;

    // Wait for the user to login.
    let token = auth_client
        .exchange_device_access_token(&details)
        .request_async(oauth2::reqwest::async_http_client, tokio::time::sleep, None)
        .await
        .map_err(|e| InvokeError::from_anyhow(e.into()))?
        .access_token()
        .secret()
        .to_string();

    Ok(token)
}

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            #[cfg(debug_assertions)] // only include this code on debug builds
            {
                let window = app.get_window("main").unwrap();
                // comment out the below if you don't devtools to open everytime.
                // it's useful because otherwise devtools shuts everytime rust code changes.
                window.open_devtools();
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![login, read_toml, read_txt_file])
        .plugin(tauri_plugin_fs_extra::init())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
