// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::io::Read;

use anyhow::Result;
use tauri::InvokeError;
use toml;
use tauri::Manager;

/// This command returns the a json string parse from a toml file at the path.
#[tauri::command]
fn read_toml(path: &str) -> Result<String, InvokeError> {
  let mut file = std::fs::File::open(path).map_err(|e| InvokeError::from_anyhow(e.into()))?;
  let mut contents = String::new();
  file.read_to_string(&mut contents).map_err(|e| InvokeError::from_anyhow(e.into()))?;
  let value = toml::from_str::<toml::Value>(&contents).map_err(|e| InvokeError::from_anyhow(e.into()))?;
  let value = serde_json::to_string(&value).map_err(|e| InvokeError::from_anyhow(e.into()))?;
  Ok(value.to_string())
}

// This command returns a string that is the contents of a file at the path.
#[tauri::command]
fn read_txt_file(path: &str) -> Result<String, InvokeError> {
  let mut file = std::fs::File::open(path).map_err(|e| InvokeError::from_anyhow(e.into()))?;
  let mut contents = String::new();
  file.read_to_string(&mut contents).map_err(|e| InvokeError::from_anyhow(e.into()))?;
  Ok(contents)
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
    .invoke_handler(tauri::generate_handler![read_toml, read_txt_file])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
