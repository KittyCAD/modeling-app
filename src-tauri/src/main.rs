// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

pub(crate) mod state;

use std::{
    env,
    path::{Path, PathBuf},
};

use anyhow::Result;
use kcl_lib::settings::types::{
    file::{FileEntry, Project, ProjectRoute, ProjectState},
    project::ProjectConfiguration,
    Configuration,
};
use oauth2::TokenResponse;
use tauri::{ipc::InvokeError, Manager};
use tauri_plugin_cli::CliExt;
use tauri_plugin_shell::ShellExt;
use tokio::process::Command;

const DEFAULT_HOST: &str = "https://api.zoo.dev";
const SETTINGS_FILE_NAME: &str = "settings.toml";
const PROJECT_SETTINGS_FILE_NAME: &str = "project.toml";
const PROJECT_FOLDER: &str = "zoo-modeling-app-projects";

#[tauri::command]
fn get_initial_default_dir(app: tauri::AppHandle) -> Result<PathBuf, InvokeError> {
    let dir = match app.path().document_dir() {
        Ok(dir) => dir,
        Err(_) => {
            // for headless Linux (eg. Github Actions)
            let home_dir = app.path().home_dir()?;
            home_dir.join("Documents")
        }
    };

    Ok(dir.join(PROJECT_FOLDER))
}

#[tauri::command]
async fn get_state(app: tauri::AppHandle) -> Result<Option<ProjectState>, InvokeError> {
    let store = app.state::<state::Store>();
    Ok(store.get().await)
}

#[tauri::command]
async fn set_state(app: tauri::AppHandle, state: Option<ProjectState>) -> Result<(), InvokeError> {
    let store = app.state::<state::Store>();
    store.set(state).await;
    Ok(())
}

async fn get_app_settings_file_path(app: &tauri::AppHandle) -> Result<PathBuf, InvokeError> {
    let app_config_dir = app.path().app_config_dir()?;

    // Ensure this directory exists.
    if !app_config_dir.exists() {
        tokio::fs::create_dir_all(&app_config_dir)
            .await
            .map_err(|e| InvokeError::from_anyhow(e.into()))?;
    }

    Ok(app_config_dir.join(SETTINGS_FILE_NAME))
}

#[tauri::command]
async fn read_app_settings_file(app: tauri::AppHandle) -> Result<Configuration, InvokeError> {
    let mut settings_path = get_app_settings_file_path(&app).await?;
    let mut needs_migration = false;

    // Check if this file exists.
    if !settings_path.exists() {
        // Try the backwards compatible path.
        // TODO: Remove this after a few releases.
        let app_config_dir = app.path().app_config_dir()?;
        settings_path = format!(
            "{}user.toml",
            app_config_dir.display().to_string().trim_end_matches('/')
        )
        .into();
        needs_migration = true;
        // Check if this path exists.
        if !settings_path.exists() {
            let mut default = Configuration::default();
            default.settings.project.directory = get_initial_default_dir(app.clone())?;
            // Return the default configuration.
            return Ok(default);
        }
    }

    let contents = tokio::fs::read_to_string(&settings_path)
        .await
        .map_err(|e| InvokeError::from_anyhow(e.into()))?;
    let mut parsed = Configuration::backwards_compatible_toml_parse(&contents).map_err(InvokeError::from_anyhow)?;
    if parsed.settings.project.directory == PathBuf::new() {
        parsed.settings.project.directory = get_initial_default_dir(app.clone())?;
    }

    // TODO: Remove this after a few releases.
    if needs_migration {
        write_app_settings_file(app, parsed.clone()).await?;
        // Delete the old file.
        tokio::fs::remove_file(settings_path)
            .await
            .map_err(|e| InvokeError::from_anyhow(e.into()))?;
    }

    Ok(parsed)
}

#[tauri::command]
async fn write_app_settings_file(app: tauri::AppHandle, configuration: Configuration) -> Result<(), InvokeError> {
    let settings_path = get_app_settings_file_path(&app).await?;
    let contents = toml::to_string_pretty(&configuration).map_err(|e| InvokeError::from_anyhow(e.into()))?;
    tokio::fs::write(settings_path, contents.as_bytes())
        .await
        .map_err(|e| InvokeError::from_anyhow(e.into()))?;

    Ok(())
}

async fn get_project_settings_file_path(
    app_settings: Configuration,
    project_name: &str,
) -> Result<PathBuf, InvokeError> {
    let project_dir = app_settings.settings.project.directory.join(project_name);

    if !project_dir.exists() {
        tokio::fs::create_dir_all(&project_dir)
            .await
            .map_err(|e| InvokeError::from_anyhow(e.into()))?;
    }

    Ok(project_dir.join(PROJECT_SETTINGS_FILE_NAME))
}

#[tauri::command]
async fn read_project_settings_file(
    app_settings: Configuration,
    project_name: &str,
) -> Result<ProjectConfiguration, InvokeError> {
    let settings_path = get_project_settings_file_path(app_settings, project_name).await?;

    // Check if this file exists.
    if !settings_path.exists() {
        // Return the default configuration.
        return Ok(ProjectConfiguration::default());
    }

    let contents = tokio::fs::read_to_string(&settings_path)
        .await
        .map_err(|e| InvokeError::from_anyhow(e.into()))?;
    let parsed = ProjectConfiguration::backwards_compatible_toml_parse(&contents).map_err(InvokeError::from_anyhow)?;

    Ok(parsed)
}

#[tauri::command]
async fn write_project_settings_file(
    app_settings: Configuration,
    project_name: &str,
    configuration: ProjectConfiguration,
) -> Result<(), InvokeError> {
    let settings_path = get_project_settings_file_path(app_settings, project_name).await?;
    let contents = toml::to_string_pretty(&configuration).map_err(|e| InvokeError::from_anyhow(e.into()))?;
    tokio::fs::write(settings_path, contents.as_bytes())
        .await
        .map_err(|e| InvokeError::from_anyhow(e.into()))?;

    Ok(())
}

/// Initialize the directory that holds all the projects.
#[tauri::command]
async fn initialize_project_directory(configuration: Configuration) -> Result<PathBuf, InvokeError> {
    configuration
        .ensure_project_directory_exists()
        .await
        .map_err(InvokeError::from_anyhow)
}

/// Create a new project directory.
#[tauri::command]
async fn create_new_project_directory(
    configuration: Configuration,
    project_name: &str,
    initial_code: Option<&str>,
) -> Result<Project, InvokeError> {
    configuration
        .create_new_project_directory(project_name, initial_code)
        .await
        .map_err(InvokeError::from_anyhow)
}

/// List all the projects in the project directory.
#[tauri::command]
async fn list_projects(configuration: Configuration) -> Result<Vec<Project>, InvokeError> {
    configuration.list_projects().await.map_err(InvokeError::from_anyhow)
}

/// Get information about a project.
#[tauri::command]
async fn get_project_info(configuration: Configuration, project_path: &str) -> Result<Project, InvokeError> {
    configuration
        .get_project_info(project_path)
        .await
        .map_err(InvokeError::from_anyhow)
}

/// Parse the project route.
#[tauri::command]
async fn parse_project_route(configuration: Configuration, route: &str) -> Result<ProjectRoute, InvokeError> {
    ProjectRoute::from_route(&configuration, route).map_err(InvokeError::from_anyhow)
}

#[tauri::command]
async fn read_dir_recursive(path: &str) -> Result<FileEntry, InvokeError> {
    kcl_lib::settings::utils::walk_dir(&Path::new(path).to_path_buf())
        .await
        .map_err(InvokeError::from_anyhow)
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
        oauth2::AuthUrl::new(format!("{host}/authorize")).map_err(|e| InvokeError::from_anyhow(e.into()))?,
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
        println!("E2E_TAURI_ENABLED is set, won't open {} externally", auth_uri.secret());
        tokio::fs::write("/tmp/kittycad_user_code", details.user_code().secret())
            .await
            .map_err(|e| InvokeError::from_anyhow(e.into()))?;
    } else {
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
async fn get_user(token: &str, hostname: &str) -> Result<kittycad::types::User, InvokeError> {
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
    let mut client = kittycad::Client::new(token);

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

/// Open the selected path in the system file manager.
/// From this GitHub comment: https://github.com/tauri-apps/tauri/issues/4062#issuecomment-1338048169
/// But with the Linux support removed since we don't need it for now.
#[tauri::command]
fn show_in_folder(path: &str) -> Result<(), InvokeError> {
    #[cfg(not(unix))]
    {
        Command::new("explorer")
            .args(["/select,", &path]) // The comma after select is not a typo
            .spawn()
            .map_err(|e| InvokeError::from_anyhow(e.into()))?;
    }

    #[cfg(unix)]
    {
        Command::new("open")
            .args(["-R", &path])
            .spawn()
            .map_err(|e| InvokeError::from_anyhow(e.into()))?;
    }

    Ok(())
}

#[allow(dead_code)]
fn open_url_sync(app: &tauri::AppHandle, url: &url::Url) {
    println!("Opening URL: {:?}", url);
    let cloned_url = url.clone();
    let runner: tauri::async_runtime::JoinHandle<Result<ProjectState>> = tauri::async_runtime::spawn(async move {
        let url_str = cloned_url.to_string();
        let path = Path::new(url_str.as_str());
        ProjectState::new_from_path(path.to_path_buf()).await
    });

    // Block on the handle.
    match tauri::async_runtime::block_on(runner) {
        Ok(Ok(store)) => {
            // Create a state object to hold the project.
            app.manage(state::Store::new(store));
        }
        Err(e) => {
            println!("Error opening URL:{} {:?}", url, e);
        }
        Ok(Err(e)) => {
            println!("Error opening URL:{} {:?}", url, e);
        }
    }
}

fn main() -> Result<()> {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            get_state,
            set_state,
            get_initial_default_dir,
            initialize_project_directory,
            create_new_project_directory,
            list_projects,
            get_project_info,
            parse_project_route,
            get_user,
            login,
            read_dir_recursive,
            show_in_folder,
            read_app_settings_file,
            write_app_settings_file,
            read_project_settings_file,
            write_project_settings_file,
        ])
        .plugin(tauri_plugin_cli::init())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            // Do update things.
            #[cfg(debug_assertions)]
            {
                app.get_webview("main").unwrap().open_devtools();
            }
            #[cfg(not(debug_assertions))]
            #[cfg(feature = "updater")]
            {
                app.handle().plugin(tauri_plugin_updater::Builder::new().build())?;
            }

            let mut verbose = false;
            let mut source_path: Option<PathBuf> = None;
            match app.cli().matches() {
                // `matches` here is a Struct with { args, subcommand }.
                // `args` is `HashMap<String, ArgData>` where `ArgData` is a struct with { value, occurrences }.
                // `subcommand` is `Option<Box<SubcommandMatches>>` where `SubcommandMatches` is a struct with { name, matches }.
                Ok(matches) => {
                    if let Some(verbose_flag) = matches.args.get("verbose") {
                        let Some(value) = verbose_flag.value.as_bool() else {
                            return Err(
                                anyhow::anyhow!("Error parsing CLI arguments: verbose flag is not a boolean").into(),
                            );
                        };
                        verbose = value;
                    }

                    // Get the path we are trying to open.
                    if let Some(source_arg) = matches.args.get("source") {
                        // We don't do an else here because this can be null.
                        if let Some(value) = source_arg.value.as_str() {
                            println!("Got path in cli argument: {}", value);
                            source_path = Some(Path::new(value).to_path_buf());
                        }
                    }
                }
                Err(err) => {
                    return Err(anyhow::anyhow!("Error parsing CLI arguments: {:?}", err).into());
                }
            }

            if verbose {
                println!("Verbose mode enabled.");
            }

            // If we have a source path to open, make sure it exists.
            let Some(source_path) = source_path else {
                // The user didn't provide a source path to open.
                // Run the app as normal.
                app.manage(state::Store::default());
                return Ok(());
            };

            if !source_path.exists() {
                return Err(anyhow::anyhow!(
                    "Error: the path `{}` you are trying to open does not exist",
                    source_path.display()
                )
                .into());
            }

            let runner: tauri::async_runtime::JoinHandle<Result<ProjectState>> =
                tauri::async_runtime::spawn(async move { ProjectState::new_from_path(source_path).await });

            // Block on the handle.
            let store = tauri::async_runtime::block_on(runner)??;

            // Create a state object to hold the project.
            app.manage(state::Store::new(store));

            // Listen on the deep links.
            app.listen("deep-link://new-url", |event| {
                println!("got deep-link url: {:?}", event);
                // TODO: open_url_sync(app.handle(), event.url);
            });

            Ok(())
        })
        .build(tauri::generate_context!())?
        .run(
            #[allow(unused_variables)]
            |app, event| {
                #[cfg(any(target_os = "macos", target_os = "ios"))]
                if let tauri::RunEvent::Opened { urls } = event {
                    println!("Opened URLs: {:?}", urls);

                    // Handle the first URL.
                    // TODO: do we want to handle more than one URL?
                    // Under what conditions would we even have more than one?
                    if let Some(url) = urls.first() {
                        open_url_sync(app, url);
                    }
                }
            },
        );

    Ok(())
}
