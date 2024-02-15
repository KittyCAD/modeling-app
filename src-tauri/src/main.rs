// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::env;
use std::fs;
use std::io::Read;
use std::path::Path;
use std::path::PathBuf;

use anyhow::Result;
use oauth2::TokenResponse;
use serde::Serialize;
use tauri::ipc::InvokeError;
use tauri::Manager;
use tauri_plugin_shell::ShellExt;
const DEFAULT_HOST: &str = "https://api.kittycad.io";

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

/// From https://github.com/tauri-apps/tauri/blob/1.x/core/tauri/src/api/dir.rs#L51
/// Removed from tauri v2
#[derive(Debug, Serialize)]
pub struct DiskEntry {
    /// The path to the entry.
    pub path: PathBuf,
    /// The name of the entry (file name with extension or directory name).
    pub name: Option<String>,
    /// The children of this entry if it's a directory.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub children: Option<Vec<DiskEntry>>,
}

/// From https://github.com/tauri-apps/tauri/blob/1.x/core/tauri/src/api/dir.rs#L51
/// Removed from tauri v2
fn is_dir<P: AsRef<Path>>(path: P) -> Result<bool> {
    std::fs::metadata(path).map(|md| md.is_dir()).map_err(Into::into)
}

/// From https://github.com/tauri-apps/tauri/blob/1.x/core/tauri/src/api/dir.rs#L51
/// Removed from tauri v2
#[tauri::command]
fn read_dir_recursive(path: &str) -> Result<Vec<DiskEntry>, InvokeError> {
    let mut files_and_dirs: Vec<DiskEntry> = vec![];
    // let path = path.as_ref();
    for entry in fs::read_dir(path).map_err(|e| InvokeError::from_anyhow(e.into()))? {
      let path = entry.map_err(|e| InvokeError::from_anyhow(e.into()))?.path();
  
      if let Ok(flag) = is_dir(&path) {
        files_and_dirs.push(DiskEntry {
          path: path.clone(),
          children: if flag {
            Some(
                read_dir_recursive(path.to_str().expect("No path"))?
            )
          } else {
            None
          },
          name: path
            .file_name()
            .map(|name| name.to_string_lossy())
            .map(|name| name.to_string()),
        });
      }
    }
    Ok(files_and_dirs)
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
    // We do this in the browser and not a separate window because we want 1password and
    // other crap to work well.
    // TODO: find a better way to share this value with tauri e2e tests
    // Here we're using an env var to enable the /tmp file (windows not supported for now)
    // and bypass the shell::open call as it fails on GitHub Actions.
    let e2e_tauri_enabled = env::var("E2E_TAURI_ENABLED").is_ok();
    if e2e_tauri_enabled {
        println!(
            "E2E_TAURI_ENABLED is set, won't open {} externally",
            auth_uri.secret()
        );
        fs::write("/tmp/kittycad_user_code", details.user_code().secret())
            .expect("Unable to write /tmp/kittycad_user_code file");
    } else {
        println!("{}", auth_uri.secret().to_string());
        app.shell()
            .open(auth_uri.secret(), None)
            .map_err(|e| InvokeError::from_anyhow(e.into()))?;
    }

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

///This command returns the KittyCAD user info given a token.
/// The string returned from this method is the user info as a json string.
#[tauri::command]
async fn get_user(
    token: Option<String>,
    hostname: &str,
) -> Result<kittycad::types::User, InvokeError> {
    // Use the host passed in if it's set.
    // Otherwise, use the default host.
    let host = if hostname.is_empty() {
        DEFAULT_HOST.to_string()
    } else {
        hostname.to_string()
    };

    // Change the baseURL to the one we want.
    let mut baseurl = host.to_string();
    if !host.starts_with("http://") && !host.starts_with("https://") {
        baseurl = format!("https://{host}");
        if host.starts_with("localhost") {
            baseurl = format!("http://{host}")
        }
    }
    println!("Getting user info...");

    // use kittycad library to fetch the user info from /user/me
    let mut client = kittycad::Client::new(token.unwrap());

    if baseurl != DEFAULT_HOST {
        client.set_base_url(&baseurl);
    }

    let user_info: kittycad::types::User = client
        .users()
        .get_self()
        .await
        .map_err(|e| InvokeError::from_anyhow(e.into()))?;

    Ok(user_info)
}

fn main() {
    tauri::Builder::default()
        .setup(|_app| {
            #[cfg(debug_assertions)] // only include this code on debug builds
            {
                _app.get_webview("main").unwrap().open_devtools();
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_user,
            login,
            read_toml,
            read_txt_file,
            read_dir_recursive
        ])
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_shell::init())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
