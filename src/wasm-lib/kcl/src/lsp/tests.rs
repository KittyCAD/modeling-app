use std::{
    collections::BTreeMap,
    sync::{Arc, RwLock},
};

use anyhow::Result;
use pretty_assertions::assert_eq;
use tower_lsp::LanguageServer;

use crate::{executor::ProgramMemory, lsp::backend::Backend};

fn new_zoo_client() -> kittycad::Client {
    let user_agent = concat!(env!("CARGO_PKG_NAME"), ".rs/", env!("CARGO_PKG_VERSION"),);
    let http_client = reqwest::Client::builder()
        .user_agent(user_agent)
        // For file conversions we need this to be long.
        .timeout(std::time::Duration::from_secs(600))
        .connect_timeout(std::time::Duration::from_secs(60));
    let ws_client = reqwest::Client::builder()
        .user_agent(user_agent)
        // For file conversions we need this to be long.
        .timeout(std::time::Duration::from_secs(600))
        .connect_timeout(std::time::Duration::from_secs(60))
        .connection_verbose(true)
        .tcp_keepalive(std::time::Duration::from_secs(600))
        .http1_only();

    let token = std::env::var("KITTYCAD_API_TOKEN").expect("KITTYCAD_API_TOKEN not set");

    // Create the client.
    let mut client = kittycad::Client::new_from_reqwest(token, http_client, ws_client);
    // Set a local engine address if it's set.
    if let Ok(addr) = std::env::var("LOCAL_ENGINE_ADDR") {
        client.set_base_url(addr);
    }

    client
}

// Create a fake kcl lsp server for testing.
async fn kcl_lsp_server(execute: bool) -> Result<crate::lsp::kcl::Backend> {
    let stdlib = crate::std::StdLib::new();
    let stdlib_completions = crate::lsp::kcl::get_completions_from_stdlib(&stdlib)?;
    let stdlib_signatures = crate::lsp::kcl::get_signatures_from_stdlib(&stdlib)?;
    // We can unwrap here because we know the tokeniser is valid, since
    // we have a test for it.
    let token_types = crate::token::TokenType::all_semantic_token_types()?;

    let zoo_client = new_zoo_client();

    let executor_ctx = if execute {
        Some(crate::executor::ExecutorContext::new(&zoo_client, Default::default()).await?)
    } else {
        None
    };

    let can_execute = executor_ctx.is_some();

    // Create the backend.
    let (service, _) = tower_lsp::LspService::build(|client| crate::lsp::kcl::Backend {
        client,
        fs: Arc::new(crate::fs::FileManager::new()),
        workspace_folders: Default::default(),
        stdlib_completions,
        stdlib_signatures,
        token_types,
        token_map: Default::default(),
        ast_map: Default::default(),
        memory_map: Default::default(),
        code_map: Default::default(),
        diagnostics_map: Default::default(),
        symbols_map: Default::default(),
        semantic_tokens_map: Default::default(),
        zoo_client,
        can_send_telemetry: true,
        executor_ctx: Arc::new(tokio::sync::RwLock::new(executor_ctx)),
        can_execute: Arc::new(tokio::sync::RwLock::new(can_execute)),
        is_initialized: Default::default(),
        current_handle: Default::default(),
    })
    .custom_method("kcl/updateUnits", crate::lsp::kcl::Backend::update_units)
    .custom_method("kcl/updateCanExecute", crate::lsp::kcl::Backend::update_can_execute)
    .finish();

    let server = service.inner();

    server
        .initialize(tower_lsp::lsp_types::InitializeParams::default())
        .await?;

    server.initialized(tower_lsp::lsp_types::InitializedParams {}).await;

    Ok(server.clone())
}

// Create a fake copilot lsp server for testing.
async fn copilot_lsp_server() -> Result<crate::lsp::copilot::Backend> {
    // We don't actually need to authenticate to the backend for this test.
    let zoo_client = kittycad::Client::new_from_env();

    // Create the backend.
    let (service, _) = tower_lsp::LspService::new(|client| crate::lsp::copilot::Backend {
        client,
        fs: Arc::new(crate::fs::FileManager::new()),
        workspace_folders: Default::default(),
        code_map: Default::default(),
        zoo_client,
        editor_info: Arc::new(RwLock::new(crate::lsp::copilot::types::CopilotEditorInfo::default())),
        cache: Arc::new(crate::lsp::copilot::cache::CopilotCache::new()),
        telemetry: Default::default(),
        is_initialized: Default::default(),
        current_handle: Default::default(),
    });
    let server = service.inner();

    server
        .initialize(tower_lsp::lsp_types::InitializeParams::default())
        .await?;

    server.initialized(tower_lsp::lsp_types::InitializedParams {}).await;

    Ok(server.clone())
}

#[tokio::test(flavor = "multi_thread", worker_threads = 12)]
async fn test_updating_kcl_lsp_files() {
    let server = kcl_lsp_server(false).await.unwrap();

    assert_eq!(server.code_map.len().await, 0);

    // Get the path to the current file.
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src").join("lsp");
    let string_path = format!("file://{}", path.display());

    // Run workspace folders change.
    server
        .did_change_workspace_folders(tower_lsp::lsp_types::DidChangeWorkspaceFoldersParams {
            event: tower_lsp::lsp_types::WorkspaceFoldersChangeEvent {
                added: vec![tower_lsp::lsp_types::WorkspaceFolder {
                    uri: string_path.as_str().try_into().unwrap(),
                    name: "my-project".to_string(),
                }],
                removed: vec![],
            },
        })
        .await;
    server.wait_on_handle().await;

    // Get the workspace folders.
    assert_eq!(server.workspace_folders.len().await, 1);
    assert_eq!(
        server.workspace_folders.get("my-project").await.unwrap(),
        tower_lsp::lsp_types::WorkspaceFolder {
            uri: string_path.as_str().try_into().unwrap(),
            name: "my-project".to_string(),
        }
    );

    assert_eq!(server.code_map.len().await, 10);

    // Run open file.
    server
        .did_open(tower_lsp::lsp_types::DidOpenTextDocumentParams {
            text_document: tower_lsp::lsp_types::TextDocumentItem {
                uri: "file:///test.kcl".try_into().unwrap(),
                language_id: "kcl".to_string(),
                version: 1,
                text: "test".to_string(),
            },
        })
        .await;
    server.wait_on_handle().await;

    // Check the code map.
    assert_eq!(server.code_map.len().await, 11);
    assert_eq!(
        server.code_map.get("file:///test.kcl").await.unwrap(),
        "test".as_bytes()
    );

    // Close the file.
    server
        .did_close(tower_lsp::lsp_types::DidCloseTextDocumentParams {
            text_document: tower_lsp::lsp_types::TextDocumentIdentifier {
                uri: "file:///test.kcl".try_into().unwrap(),
            },
        })
        .await;
    server.wait_on_handle().await;

    // Check the code map.
    assert_eq!(server.code_map.len().await, 11);
    assert_eq!(
        server.code_map.get("file:///test.kcl").await.unwrap(),
        "test".as_bytes()
    );

    // Open another file.
    server
        .did_open(tower_lsp::lsp_types::DidOpenTextDocumentParams {
            text_document: tower_lsp::lsp_types::TextDocumentItem {
                uri: "file:///test2.kcl".try_into().unwrap(),
                language_id: "kcl".to_string(),
                version: 1,
                text: "test2".to_string(),
            },
        })
        .await;
    server.wait_on_handle().await;

    // Check the code map.
    assert_eq!(server.code_map.len().await, 12);
    assert_eq!(
        server.code_map.get("file:///test.kcl").await.unwrap(),
        "test".as_bytes()
    );
    assert_eq!(
        server.code_map.get("file:///test2.kcl").await.unwrap(),
        "test2".as_bytes()
    );

    // Run on change.
    server
        .did_change(tower_lsp::lsp_types::DidChangeTextDocumentParams {
            text_document: tower_lsp::lsp_types::VersionedTextDocumentIdentifier {
                uri: "file:///test2.kcl".try_into().unwrap(),
                version: 2,
            },
            content_changes: vec![tower_lsp::lsp_types::TextDocumentContentChangeEvent {
                range: None,
                range_length: None,
                text: "changed".to_string(),
            }],
        })
        .await;
    server.wait_on_handle().await;

    // Check the code map.
    assert_eq!(server.code_map.len().await, 12);
    assert_eq!(
        server.code_map.get("file:///test.kcl").await.unwrap(),
        "test".as_bytes()
    );
    assert_eq!(
        server.code_map.get("file:///test2.kcl").await.unwrap(),
        "changed".as_bytes()
    );

    // Rename a file.
    server
        .did_rename_files(tower_lsp::lsp_types::RenameFilesParams {
            files: vec![tower_lsp::lsp_types::FileRename {
                old_uri: "file:///test2.kcl".into(),
                new_uri: "file:///test3.kcl".into(),
            }],
        })
        .await;
    server.wait_on_handle().await;

    // Check the code map.
    assert_eq!(server.code_map.len().await, 12);
    assert_eq!(
        server.code_map.get("file:///test.kcl").await.unwrap(),
        "test".as_bytes()
    );
    assert_eq!(
        server.code_map.get("file:///test3.kcl").await.unwrap(),
        "changed".as_bytes()
    );

    // Create a file.
    server
        .did_create_files(tower_lsp::lsp_types::CreateFilesParams {
            files: vec![tower_lsp::lsp_types::FileCreate {
                uri: "file:///test4.kcl".into(),
            }],
        })
        .await;
    server.wait_on_handle().await;

    // Check the code map.
    assert_eq!(server.code_map.len().await, 13);
    assert_eq!(
        server.code_map.get("file:///test.kcl").await.unwrap(),
        "test".as_bytes()
    );
    assert_eq!(
        server.code_map.get("file:///test3.kcl").await.unwrap(),
        "changed".as_bytes()
    );
    assert_eq!(server.code_map.get("file:///test4.kcl").await.unwrap(), "".as_bytes());

    // Delete a file.
    server
        .did_delete_files(tower_lsp::lsp_types::DeleteFilesParams {
            files: vec![tower_lsp::lsp_types::FileDelete {
                uri: "file:///test4.kcl".into(),
            }],
        })
        .await;
    server.wait_on_handle().await;

    // Check the code map.
    assert_eq!(server.code_map.len().await, 12);
    assert_eq!(
        server.code_map.get("file:///test.kcl").await.unwrap(),
        "test".as_bytes()
    );
    assert_eq!(
        server.code_map.get("file:///test3.kcl").await.unwrap(),
        "changed".as_bytes()
    );

    // If we are adding the same folder we already had we should not nuke the code_map.
    server
        .did_change_workspace_folders(tower_lsp::lsp_types::DidChangeWorkspaceFoldersParams {
            event: tower_lsp::lsp_types::WorkspaceFoldersChangeEvent {
                added: vec![tower_lsp::lsp_types::WorkspaceFolder {
                    uri: string_path.as_str().try_into().unwrap(),
                    name: "my-project".to_string(),
                }],
                removed: vec![],
            },
        })
        .await;
    server.wait_on_handle().await;

    // Get the workspace folders.
    assert_eq!(server.workspace_folders.len().await, 1);
    assert_eq!(
        server.workspace_folders.get("my-project").await.unwrap(),
        tower_lsp::lsp_types::WorkspaceFolder {
            uri: string_path.as_str().try_into().unwrap(),
            name: "my-project".to_string(),
        }
    );

    // Check the code map.
    assert_eq!(server.code_map.len().await, 12);
    assert_eq!(
        server.code_map.get("file:///test.kcl").await.unwrap(),
        "test".as_bytes()
    );
    assert_eq!(
        server.code_map.get("file:///test3.kcl").await.unwrap(),
        "changed".as_bytes()
    );

    // Remove folders.
    // Run workspace folders change.
    server
        .did_change_workspace_folders(tower_lsp::lsp_types::DidChangeWorkspaceFoldersParams {
            event: tower_lsp::lsp_types::WorkspaceFoldersChangeEvent {
                added: vec![tower_lsp::lsp_types::WorkspaceFolder {
                    uri: string_path.as_str().try_into().unwrap(),
                    name: "my-project2".to_string(),
                }],
                removed: vec![tower_lsp::lsp_types::WorkspaceFolder {
                    uri: string_path.as_str().try_into().unwrap(),
                    name: "my-project".to_string(),
                }],
            },
        })
        .await;
    server.wait_on_handle().await;

    // Get the workspace folders.
    assert_eq!(server.workspace_folders.len().await, 1);
    assert_eq!(
        server.workspace_folders.get("my-project2").await.unwrap(),
        tower_lsp::lsp_types::WorkspaceFolder {
            uri: string_path.as_str().try_into().unwrap(),
            name: "my-project2".to_string(),
        }
    );
    assert_eq!(server.code_map.len().await, 10);
    // Just make sure that one of the current files read from disk is accurate.
    assert_eq!(
        server.code_map.get(&format!("{}/util.rs", string_path)).await.unwrap(),
        include_str!("util.rs").as_bytes()
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn test_updating_copilot_lsp_files() {
    let server = copilot_lsp_server().await.unwrap();

    assert_eq!(server.code_map.len().await, 0);

    // Get the path to the current file.
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src").join("lsp");
    let string_path = format!("file://{}", path.display());

    // Run workspace folders change.
    server
        .did_change_workspace_folders(tower_lsp::lsp_types::DidChangeWorkspaceFoldersParams {
            event: tower_lsp::lsp_types::WorkspaceFoldersChangeEvent {
                added: vec![tower_lsp::lsp_types::WorkspaceFolder {
                    uri: string_path.as_str().try_into().unwrap(),
                    name: "my-project".to_string(),
                }],
                removed: vec![],
            },
        })
        .await;
    server.wait_on_handle().await;

    // Get the workspace folders.
    assert_eq!(server.workspace_folders.len().await, 1);
    assert_eq!(
        server.workspace_folders.get("my-project").await.unwrap(),
        tower_lsp::lsp_types::WorkspaceFolder {
            uri: string_path.as_str().try_into().unwrap(),
            name: "my-project".to_string(),
        }
    );

    assert_eq!(server.code_map.len().await, 10);

    // Run open file.
    server
        .did_open(tower_lsp::lsp_types::DidOpenTextDocumentParams {
            text_document: tower_lsp::lsp_types::TextDocumentItem {
                uri: "file:///test.kcl".try_into().unwrap(),
                language_id: "kcl".to_string(),
                version: 1,
                text: "test".to_string(),
            },
        })
        .await;
    server.wait_on_handle().await;

    // Check the code map.
    assert_eq!(server.code_map.len().await, 11);
    assert_eq!(
        server.code_map.get("file:///test.kcl").await.unwrap(),
        "test".as_bytes()
    );

    // Close the file.
    server
        .did_close(tower_lsp::lsp_types::DidCloseTextDocumentParams {
            text_document: tower_lsp::lsp_types::TextDocumentIdentifier {
                uri: "file:///test.kcl".try_into().unwrap(),
            },
        })
        .await;

    // Check the code map.
    assert_eq!(server.code_map.len().await, 11);
    assert_eq!(
        server.code_map.get("file:///test.kcl").await.unwrap(),
        "test".as_bytes()
    );

    // Open another file.
    server
        .did_open(tower_lsp::lsp_types::DidOpenTextDocumentParams {
            text_document: tower_lsp::lsp_types::TextDocumentItem {
                uri: "file:///test2.kcl".try_into().unwrap(),
                language_id: "kcl".to_string(),
                version: 1,
                text: "test2".to_string(),
            },
        })
        .await;
    server.wait_on_handle().await;

    // Check the code map.
    assert_eq!(server.code_map.len().await, 12);
    assert_eq!(
        server.code_map.get("file:///test.kcl").await.unwrap(),
        "test".as_bytes()
    );
    assert_eq!(
        server.code_map.get("file:///test2.kcl").await.unwrap(),
        "test2".as_bytes()
    );

    // Run on change.
    server
        .did_change(tower_lsp::lsp_types::DidChangeTextDocumentParams {
            text_document: tower_lsp::lsp_types::VersionedTextDocumentIdentifier {
                uri: "file:///test2.kcl".try_into().unwrap(),
                version: 2,
            },
            content_changes: vec![tower_lsp::lsp_types::TextDocumentContentChangeEvent {
                range: None,
                range_length: None,
                text: "changed".to_string(),
            }],
        })
        .await;
    server.wait_on_handle().await;

    // Check the code map.
    assert_eq!(server.code_map.len().await, 12);
    assert_eq!(
        server.code_map.get("file:///test.kcl").await.unwrap(),
        "test".as_bytes()
    );
    assert_eq!(
        server.code_map.get("file:///test2.kcl").await.unwrap(),
        "changed".as_bytes()
    );

    // Rename a file.
    server
        .did_rename_files(tower_lsp::lsp_types::RenameFilesParams {
            files: vec![tower_lsp::lsp_types::FileRename {
                old_uri: "file:///test2.kcl".into(),
                new_uri: "file:///test3.kcl".into(),
            }],
        })
        .await;
    server.wait_on_handle().await;

    // Check the code map.
    assert_eq!(server.code_map.len().await, 12);
    assert_eq!(
        server.code_map.get("file:///test.kcl").await.unwrap(),
        "test".as_bytes()
    );
    assert_eq!(
        server.code_map.get("file:///test3.kcl").await.unwrap(),
        "changed".as_bytes()
    );

    // Create a file.
    server
        .did_create_files(tower_lsp::lsp_types::CreateFilesParams {
            files: vec![tower_lsp::lsp_types::FileCreate {
                uri: "file:///test4.kcl".into(),
            }],
        })
        .await;
    server.wait_on_handle().await;

    // Check the code map.
    assert_eq!(server.code_map.len().await, 13);
    assert_eq!(
        server.code_map.get("file:///test.kcl").await.unwrap(),
        "test".as_bytes()
    );
    assert_eq!(
        server.code_map.get("file:///test3.kcl").await.unwrap(),
        "changed".as_bytes()
    );
    assert_eq!(server.code_map.get("file:///test4.kcl").await.unwrap(), "".as_bytes());

    // Delete a file.
    server
        .did_delete_files(tower_lsp::lsp_types::DeleteFilesParams {
            files: vec![tower_lsp::lsp_types::FileDelete {
                uri: "file:///test4.kcl".into(),
            }],
        })
        .await;
    server.wait_on_handle().await;

    // Check the code map.
    assert_eq!(server.code_map.len().await, 12);
    assert_eq!(
        server.code_map.get("file:///test.kcl").await.unwrap(),
        "test".as_bytes()
    );
    assert_eq!(
        server.code_map.get("file:///test3.kcl").await.unwrap(),
        "changed".as_bytes()
    );

    // If we are adding the same folder we already had we should not nuke the code_map.
    server
        .did_change_workspace_folders(tower_lsp::lsp_types::DidChangeWorkspaceFoldersParams {
            event: tower_lsp::lsp_types::WorkspaceFoldersChangeEvent {
                added: vec![tower_lsp::lsp_types::WorkspaceFolder {
                    uri: string_path.as_str().try_into().unwrap(),
                    name: "my-project".to_string(),
                }],
                removed: vec![],
            },
        })
        .await;
    server.wait_on_handle().await;

    // Get the workspace folders.
    assert_eq!(server.workspace_folders.len().await, 1);
    assert_eq!(
        server.workspace_folders.get("my-project").await.unwrap(),
        tower_lsp::lsp_types::WorkspaceFolder {
            uri: string_path.as_str().try_into().unwrap(),
            name: "my-project".to_string(),
        }
    );

    // Check the code map.
    assert_eq!(server.code_map.len().await, 12);
    assert_eq!(
        server.code_map.get("file:///test.kcl").await.unwrap(),
        "test".as_bytes()
    );
    assert_eq!(
        server.code_map.get("file:///test3.kcl").await.unwrap(),
        "changed".as_bytes()
    );

    // If we change nothing it should not change the current code map.
    server
        .did_change_workspace_folders(tower_lsp::lsp_types::DidChangeWorkspaceFoldersParams {
            event: tower_lsp::lsp_types::WorkspaceFoldersChangeEvent {
                added: vec![],
                removed: vec![],
            },
        })
        .await;
    server.wait_on_handle().await;

    // Get the workspace folders.
    assert_eq!(server.workspace_folders.len().await, 1);
    assert_eq!(
        server.workspace_folders.get("my-project").await.unwrap(),
        tower_lsp::lsp_types::WorkspaceFolder {
            uri: string_path.as_str().try_into().unwrap(),
            name: "my-project".to_string(),
        }
    );

    // Check the code map.
    assert_eq!(server.code_map.len().await, 12);
    assert_eq!(
        server.code_map.get("file:///test.kcl").await.unwrap(),
        "test".as_bytes()
    );
    assert_eq!(
        server.code_map.get("file:///test3.kcl").await.unwrap(),
        "changed".as_bytes()
    );

    // Remove folders.
    // Run workspace folders change.
    server
        .did_change_workspace_folders(tower_lsp::lsp_types::DidChangeWorkspaceFoldersParams {
            event: tower_lsp::lsp_types::WorkspaceFoldersChangeEvent {
                added: vec![tower_lsp::lsp_types::WorkspaceFolder {
                    uri: string_path.as_str().try_into().unwrap(),
                    name: "my-project2".to_string(),
                }],
                removed: vec![tower_lsp::lsp_types::WorkspaceFolder {
                    uri: string_path.as_str().try_into().unwrap(),
                    name: "my-project".to_string(),
                }],
            },
        })
        .await;
    server.wait_on_handle().await;

    // Get the workspace folders.
    assert_eq!(server.workspace_folders.len().await, 1);
    assert_eq!(
        server.workspace_folders.get("my-project2").await.unwrap(),
        tower_lsp::lsp_types::WorkspaceFolder {
            uri: string_path.as_str().try_into().unwrap(),
            name: "my-project2".to_string(),
        }
    );
    assert_eq!(server.code_map.len().await, 10);
}

#[tokio::test(flavor = "multi_thread")]
async fn test_kcl_lsp_create_zip() {
    let server = kcl_lsp_server(false).await.unwrap();

    assert_eq!(server.code_map.len().await, 0);

    // Get the path to the current file.
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src").join("lsp");
    let string_path = format!("file://{}", path.display());

    // Run workspace folders change.
    server
        .did_change_workspace_folders(tower_lsp::lsp_types::DidChangeWorkspaceFoldersParams {
            event: tower_lsp::lsp_types::WorkspaceFoldersChangeEvent {
                added: vec![tower_lsp::lsp_types::WorkspaceFolder {
                    uri: string_path.as_str().try_into().unwrap(),
                    name: "my-project".to_string(),
                }],
                removed: vec![],
            },
        })
        .await;
    server.wait_on_handle().await;

    // Get the workspace folders.
    assert_eq!(server.workspace_folders.len().await, 1);
    assert_eq!(
        server.workspace_folders.get("my-project").await.unwrap(),
        tower_lsp::lsp_types::WorkspaceFolder {
            uri: string_path.as_str().try_into().unwrap(),
            name: "my-project".to_string(),
        }
    );

    assert_eq!(server.code_map.len().await, 10);

    // Run open file.
    server
        .did_open(tower_lsp::lsp_types::DidOpenTextDocumentParams {
            text_document: tower_lsp::lsp_types::TextDocumentItem {
                uri: "file:///test.kcl".try_into().unwrap(),
                language_id: "kcl".to_string(),
                version: 1,
                text: "test".to_string(),
            },
        })
        .await;
    server.wait_on_handle().await;

    // Check the code map.
    assert_eq!(server.code_map.len().await, 11);
    assert_eq!(
        server.code_map.get("file:///test.kcl").await.unwrap(),
        "test".as_bytes()
    );

    // Create a zip.
    let bytes = server.create_zip().await.unwrap();
    // Write the bytes to a tmp file.
    let tmp_dir = std::env::temp_dir();
    let filename = format!("test-{}.zip", chrono::Utc::now().timestamp());
    let tmp_file = tmp_dir.join(filename);
    std::fs::write(&tmp_file, bytes).unwrap();

    // Try to unzip the file.
    let mut archive = zip::ZipArchive::new(std::fs::File::open(&tmp_file).unwrap()).unwrap();

    // Check the files in the zip.
    let mut files = BTreeMap::new();
    for i in 0..archive.len() {
        let file = archive.by_index(i).unwrap();
        files.insert(file.name().to_string(), file.size());
    }

    assert_eq!(files.len(), 11);
    let util_path = format!("{}/util.rs", string_path).replace("file://", "");
    assert!(files.contains_key(&util_path));
    assert_eq!(files.get("/test.kcl"), Some(&4));
}

#[tokio::test(flavor = "multi_thread")]
async fn test_kcl_lsp_completions() {
    let server = kcl_lsp_server(false).await.unwrap();

    // Send open file.
    server
        .did_open(tower_lsp::lsp_types::DidOpenTextDocumentParams {
            text_document: tower_lsp::lsp_types::TextDocumentItem {
                uri: "file:///test.kcl".try_into().unwrap(),
                language_id: "kcl".to_string(),
                version: 1,
                text: r#"const thing= 1
st"#
                .to_string(),
            },
        })
        .await;

    // Send completion request.
    let completions = server
        .completion(tower_lsp::lsp_types::CompletionParams {
            text_document_position: tower_lsp::lsp_types::TextDocumentPositionParams {
                text_document: tower_lsp::lsp_types::TextDocumentIdentifier {
                    uri: "file:///test.kcl".try_into().unwrap(),
                },
                position: tower_lsp::lsp_types::Position { line: 0, character: 16 },
            },
            context: None,
            partial_result_params: Default::default(),
            work_done_progress_params: Default::default(),
        })
        .await
        .unwrap()
        .unwrap();

    // Check the completions.
    if let tower_lsp::lsp_types::CompletionResponse::Array(completions) = completions {
        assert!(completions.len() > 10);
    } else {
        panic!("Expected array of completions");
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn test_kcl_lsp_completions_const_raw() {
    let server = kcl_lsp_server(false).await.unwrap();

    // Send open file.
    server
        .did_open(tower_lsp::lsp_types::DidOpenTextDocumentParams {
            text_document: tower_lsp::lsp_types::TextDocumentItem {
                uri: "file:///test.kcl".try_into().unwrap(),
                language_id: "kcl".to_string(),
                version: 1,
                text: r#"con"#.to_string(),
            },
        })
        .await;

    // Send completion request.
    let completions = server
        .completion(tower_lsp::lsp_types::CompletionParams {
            text_document_position: tower_lsp::lsp_types::TextDocumentPositionParams {
                text_document: tower_lsp::lsp_types::TextDocumentIdentifier {
                    uri: "file:///test.kcl".try_into().unwrap(),
                },
                position: tower_lsp::lsp_types::Position { line: 0, character: 2 },
            },
            context: None,
            partial_result_params: Default::default(),
            work_done_progress_params: Default::default(),
        })
        .await
        .unwrap()
        .unwrap();

    // Check the completions.
    if let tower_lsp::lsp_types::CompletionResponse::Array(completions) = completions {
        assert!(completions.len() > 10);
        // Find the one with label "const".
        let const_completion = completions
            .iter()
            .find(|completion| completion.label == "const")
            .unwrap();
        assert_eq!(
            const_completion.kind,
            Some(tower_lsp::lsp_types::CompletionItemKind::KEYWORD)
        );
    } else {
        panic!("Expected array of completions");
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn test_kcl_lsp_on_hover() {
    let server = kcl_lsp_server(false).await.unwrap();

    // Send open file.
    server
        .did_open(tower_lsp::lsp_types::DidOpenTextDocumentParams {
            text_document: tower_lsp::lsp_types::TextDocumentItem {
                uri: "file:///test.kcl".try_into().unwrap(),
                language_id: "kcl".to_string(),
                version: 1,
                text: "startSketchOn()".to_string(),
            },
        })
        .await;
    server.wait_on_handle().await;

    // Send hover request.
    let hover = server
        .hover(tower_lsp::lsp_types::HoverParams {
            text_document_position_params: tower_lsp::lsp_types::TextDocumentPositionParams {
                text_document: tower_lsp::lsp_types::TextDocumentIdentifier {
                    uri: "file:///test.kcl".try_into().unwrap(),
                },
                position: tower_lsp::lsp_types::Position { line: 0, character: 2 },
            },
            work_done_progress_params: Default::default(),
        })
        .await
        .unwrap();

    // Check the hover.
    if let Some(hover) = hover {
        assert_eq!(
            hover.contents,
            tower_lsp::lsp_types::HoverContents::Markup(tower_lsp::lsp_types::MarkupContent {
                kind: tower_lsp::lsp_types::MarkupKind::Markdown,
                value: "```startSketchOn(data: SketchData, tag?: SketchOnFaceTag) -> SketchSurface```\nStart a sketch on a specific plane or face.".to_string()
            })
        );
    } else {
        panic!("Expected hover");
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn test_kcl_lsp_on_hover_shebang() {
    let server = kcl_lsp_server(false).await.unwrap();

    // Send open file.
    server
        .did_open(tower_lsp::lsp_types::DidOpenTextDocumentParams {
            text_document: tower_lsp::lsp_types::TextDocumentItem {
                uri: "file:///test.kcl".try_into().unwrap(),
                language_id: "kcl".to_string(),
                version: 1,
                text: r#"#!/usr/bin/env zoo kcl view
startSketchOn()"#
                    .to_string(),
            },
        })
        .await;
    server.wait_on_handle().await;

    // Send hover request.
    let hover = server
        .hover(tower_lsp::lsp_types::HoverParams {
            text_document_position_params: tower_lsp::lsp_types::TextDocumentPositionParams {
                text_document: tower_lsp::lsp_types::TextDocumentIdentifier {
                    uri: "file:///test.kcl".try_into().unwrap(),
                },
                position: tower_lsp::lsp_types::Position { line: 0, character: 2 },
            },
            work_done_progress_params: Default::default(),
        })
        .await
        .unwrap();

    // Check the hover.
    if let Some(hover) = hover {
        assert_eq!(
            hover.contents,
            tower_lsp::lsp_types::HoverContents::Markup(tower_lsp::lsp_types::MarkupContent {
                kind: tower_lsp::lsp_types::MarkupKind::Markdown,
                value: "The `#!` at the start of a script, known as a shebang, specifies the path to the interpreter that should execute the script. This line is not necessary for your `kcl` to run in the modeling-app. You can safely delete it. If you wish to learn more about what you _can_ do with a shebang, read this doc: [zoo.dev/docs/faq/shebang](https://zoo.dev/docs/faq/shebang).".to_string()
            })
        );
    } else {
        panic!("Expected hover");
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn test_kcl_lsp_signature_help() {
    let server = kcl_lsp_server(false).await.unwrap();

    // Send open file.
    server
        .did_change(tower_lsp::lsp_types::DidChangeTextDocumentParams {
            text_document: tower_lsp::lsp_types::VersionedTextDocumentIdentifier {
                uri: "file:///test.kcl".try_into().unwrap(),
                version: 1,
            },
            content_changes: vec![tower_lsp::lsp_types::TextDocumentContentChangeEvent {
                range: None,
                range_length: None,
                text: "startSketchOn('XY')".to_string(),
            }],
        })
        .await;
    server.wait_on_handle().await;

    // Send signature help request.
    let signature_help = server
        .signature_help(tower_lsp::lsp_types::SignatureHelpParams {
            text_document_position_params: tower_lsp::lsp_types::TextDocumentPositionParams {
                text_document: tower_lsp::lsp_types::TextDocumentIdentifier {
                    uri: "file:///test.kcl".try_into().unwrap(),
                },
                position: tower_lsp::lsp_types::Position { line: 0, character: 2 },
            },
            context: None,
            work_done_progress_params: Default::default(),
        })
        .await
        .unwrap();

    // Check the signature help.
    if let Some(signature_help) = signature_help {
        assert_eq!(
            signature_help.signatures.len(),
            1,
            "Expected one signature, got {:?}",
            signature_help.signatures
        );
        assert_eq!(signature_help.signatures[0].label, "startSketchOn");
    } else {
        panic!("Expected signature help");
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn test_kcl_lsp_semantic_tokens() {
    let server = kcl_lsp_server(false).await.unwrap();

    // Send open file.
    server
        .did_open(tower_lsp::lsp_types::DidOpenTextDocumentParams {
            text_document: tower_lsp::lsp_types::TextDocumentItem {
                uri: "file:///test.kcl".try_into().unwrap(),
                language_id: "kcl".to_string(),
                version: 1,
                text: "startSketchOn('XY')".to_string(),
            },
        })
        .await;
    server.wait_on_handle().await;

    // Send semantic tokens request.
    let semantic_tokens = server
        .semantic_tokens_full(tower_lsp::lsp_types::SemanticTokensParams {
            text_document: tower_lsp::lsp_types::TextDocumentIdentifier {
                uri: "file:///test.kcl".try_into().unwrap(),
            },
            partial_result_params: Default::default(),
            work_done_progress_params: Default::default(),
        })
        .await
        .unwrap()
        .unwrap();

    // Check the semantic tokens.
    if let tower_lsp::lsp_types::SemanticTokensResult::Tokens(semantic_tokens) = semantic_tokens {
        assert_eq!(semantic_tokens.data.len(), 2);
        assert_eq!(semantic_tokens.data[0].length, 13);
        assert_eq!(semantic_tokens.data[0].token_type, 8);
        assert_eq!(semantic_tokens.data[1].length, 4);
        assert_eq!(semantic_tokens.data[1].delta_start, 14);
        assert_eq!(semantic_tokens.data[1].token_type, 3);
    } else {
        panic!("Expected semantic tokens");
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn test_kcl_lsp_document_symbol() {
    let server = kcl_lsp_server(false).await.unwrap();

    // Send open file.
    server
        .did_open(tower_lsp::lsp_types::DidOpenTextDocumentParams {
            text_document: tower_lsp::lsp_types::TextDocumentItem {
                uri: "file:///test.kcl".try_into().unwrap(),
                language_id: "kcl".to_string(),
                version: 1,
                text: r#"const myVar = 1
startSketchOn('XY')"#
                    .to_string(),
            },
        })
        .await;
    server.wait_on_handle().await;

    // Send document symbol request.
    let document_symbol = server
        .document_symbol(tower_lsp::lsp_types::DocumentSymbolParams {
            text_document: tower_lsp::lsp_types::TextDocumentIdentifier {
                uri: "file:///test.kcl".try_into().unwrap(),
            },
            work_done_progress_params: Default::default(),
            partial_result_params: Default::default(),
        })
        .await
        .unwrap()
        .unwrap();

    // Check the document symbol.
    if let tower_lsp::lsp_types::DocumentSymbolResponse::Nested(document_symbol) = document_symbol {
        assert_eq!(document_symbol.len(), 1);
        assert_eq!(document_symbol[0].name, "myVar");
    } else {
        panic!("Expected document symbol");
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn test_kcl_lsp_formatting() {
    let server = kcl_lsp_server(false).await.unwrap();

    // Send open file.
    server
        .did_open(tower_lsp::lsp_types::DidOpenTextDocumentParams {
            text_document: tower_lsp::lsp_types::TextDocumentItem {
                uri: "file:///test.kcl".try_into().unwrap(),
                language_id: "kcl".to_string(),
                version: 1,
                text: r#"startSketchOn('XY')
                    |> startProfileAt([0,0], %)"#
                    .to_string(),
            },
        })
        .await;
    server.wait_on_handle().await;

    // Send formatting request.
    let formatting = server
        .formatting(tower_lsp::lsp_types::DocumentFormattingParams {
            text_document: tower_lsp::lsp_types::TextDocumentIdentifier {
                uri: "file:///test.kcl".try_into().unwrap(),
            },
            options: tower_lsp::lsp_types::FormattingOptions {
                tab_size: 4,
                insert_spaces: true,
                properties: Default::default(),
                trim_trailing_whitespace: None,
                insert_final_newline: None,
                trim_final_newlines: None,
            },
            work_done_progress_params: Default::default(),
        })
        .await
        .unwrap()
        .unwrap();

    // Check the formatting.
    assert_eq!(formatting.len(), 1);
    assert_eq!(
        formatting[0].new_text,
        r#"startSketchOn('XY')
    |> startProfileAt([0, 0], %)"#
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn test_kcl_lsp_formatting_extra_parens() {
    let server = kcl_lsp_server(false).await.unwrap();

    // Send open file.
    server
        .did_open(tower_lsp::lsp_types::DidOpenTextDocumentParams {
            text_document: tower_lsp::lsp_types::TextDocumentItem {
                uri: "file:///test.kcl".try_into().unwrap(),
                language_id: "kcl".to_string(),
                version: 1,
                text: r#"// Ball Bearing
// A ball bearing is a type of rolling-element bearing that uses balls to maintain the separation between the bearing races. The primary purpose of a ball bearing is to reduce rotational friction and support radial and axial loads. 

// Define constants like ball diameter, inside diamter, overhange length, and thickness
const sphereDia = 0.5
const insideDia = 1
const thickness = 0.25
const overHangLength = .4

// Sketch and revolve the inside bearing piece
const insideRevolve = startSketchOn('XZ')
  |> startProfileAt([insideDia / 2, 0], %)
  |> line([0, thickness + sphereDia / 2], %)
  |> line([overHangLength, 0], %)
  |> line([0, -thickness], %)
  |> line([-overHangLength + thickness, 0], %)
  |> line([0, -sphereDia], %)
  |> line([overHangLength - thickness, 0], %)
  |> line([0, -thickness], %)
  |> line([-overHangLength, 0], %)
  |> close(%)
  |> revolve({ axis: 'y' }, %)

// Sketch and revolve one of the balls and duplicate it using a circular pattern. (This is currently a workaround, we have a bug with rotating on a sketch that touches the rotation axis)
const sphere = startSketchOn('XZ')
  |> startProfileAt([
       0.05 + insideDia / 2 + thickness,
       0 - 0.05
     ], %)
  |> line([sphereDia - 0.1, 0], %)
  |> arc({
       angle_start: 0,
       angle_end: -180,
       radius: sphereDia / 2 - 0.05
     }, %)
  |> close(%)
  |> revolve({ axis: 'x' }, %)
  |> patternCircular3d({
       axis: [0, 0, 1],
       center: [0, 0, 0],
       repetitions: 10,
       arcDegrees: 360,
       rotateDuplicates: true
     }, %)

// Sketch and revolve the outside bearing
const outsideRevolve = startSketchOn('XZ')
  |> startProfileAt([
       insideDia / 2 + thickness + sphereDia,
       0
     ], %)
  |> line([0, sphereDia / 2], %)
  |> line([-overHangLength + thickness, 0], %)
  |> line([0, thickness], %)
  |> line([overHangLength, 0], %)
  |> line([0, -2 * thickness - sphereDia], %)
  |> line([-overHangLength, 0], %)
  |> line([0, thickness], %)
  |> line([overHangLength - thickness, 0], %)
  |> close(%)
  |> revolve({ axis: 'y' }, %)"#
                    .to_string(),
            },
        })
        .await;
    server.wait_on_handle().await;

    // Send formatting request.
    let formatting = server
        .formatting(tower_lsp::lsp_types::DocumentFormattingParams {
            text_document: tower_lsp::lsp_types::TextDocumentIdentifier {
                uri: "file:///test.kcl".try_into().unwrap(),
            },
            options: tower_lsp::lsp_types::FormattingOptions {
                tab_size: 2,
                insert_spaces: true,
                properties: Default::default(),
                trim_trailing_whitespace: None,
                insert_final_newline: None,
                trim_final_newlines: None,
            },
            work_done_progress_params: Default::default(),
        })
        .await
        .unwrap()
        .unwrap();

    // Check the formatting.
    assert_eq!(formatting.len(), 1);
    assert_eq!(
        formatting[0].new_text,
        r#"// Ball Bearing
// A ball bearing is a type of rolling-element bearing that uses balls to maintain the separation between the bearing races. The primary purpose of a ball bearing is to reduce rotational friction and support radial and axial loads.


// Define constants like ball diameter, inside diamter, overhange length, and thickness
const sphereDia = 0.5
const insideDia = 1
const thickness = 0.25
const overHangLength = .4

// Sketch and revolve the inside bearing piece
const insideRevolve = startSketchOn('XZ')
  |> startProfileAt([insideDia / 2, 0], %)
  |> line([0, thickness + sphereDia / 2], %)
  |> line([overHangLength, 0], %)
  |> line([0, -thickness], %)
  |> line([-overHangLength + thickness, 0], %)
  |> line([0, -sphereDia], %)
  |> line([overHangLength - thickness, 0], %)
  |> line([0, -thickness], %)
  |> line([-overHangLength, 0], %)
  |> close(%)
  |> revolve({ axis: 'y' }, %)

// Sketch and revolve one of the balls and duplicate it using a circular pattern. (This is currently a workaround, we have a bug with rotating on a sketch that touches the rotation axis)
const sphere = startSketchOn('XZ')
  |> startProfileAt([
       0.05 + insideDia / 2 + thickness,
       0 - 0.05
     ], %)
  |> line([sphereDia - 0.1, 0], %)
  |> arc({
       angle_start: 0,
       angle_end: -180,
       radius: sphereDia / 2 - 0.05
     }, %)
  |> close(%)
  |> revolve({ axis: 'x' }, %)
  |> patternCircular3d({
       axis: [0, 0, 1],
       center: [0, 0, 0],
       repetitions: 10,
       arcDegrees: 360,
       rotateDuplicates: true
     }, %)

// Sketch and revolve the outside bearing
const outsideRevolve = startSketchOn('XZ')
  |> startProfileAt([
       insideDia / 2 + thickness + sphereDia,
       0
     ], %)
  |> line([0, sphereDia / 2], %)
  |> line([-overHangLength + thickness, 0], %)
  |> line([0, thickness], %)
  |> line([overHangLength, 0], %)
  |> line([0, -2 * thickness - sphereDia], %)
  |> line([-overHangLength, 0], %)
  |> line([0, thickness], %)
  |> line([overHangLength - thickness, 0], %)
  |> close(%)
  |> revolve({ axis: 'y' }, %)"#
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn test_kcl_lsp_rename() {
    let server = kcl_lsp_server(false).await.unwrap();

    // Send open file.
    server
        .did_open(tower_lsp::lsp_types::DidOpenTextDocumentParams {
            text_document: tower_lsp::lsp_types::TextDocumentItem {
                uri: "file:///test.kcl".try_into().unwrap(),
                language_id: "kcl".to_string(),
                version: 1,
                text: r#"const thing= 1"#.to_string(),
            },
        })
        .await;
    server.wait_on_handle().await;

    // Send rename request.
    let rename = server
        .rename(tower_lsp::lsp_types::RenameParams {
            text_document_position: tower_lsp::lsp_types::TextDocumentPositionParams {
                text_document: tower_lsp::lsp_types::TextDocumentIdentifier {
                    uri: "file:///test.kcl".try_into().unwrap(),
                },
                position: tower_lsp::lsp_types::Position { line: 0, character: 8 },
            },
            new_name: "newName".to_string(),
            work_done_progress_params: Default::default(),
        })
        .await
        .unwrap()
        .unwrap();

    // Check the rename.
    let changes = rename.changes.unwrap();
    let u: tower_lsp::lsp_types::Url = "file:///test.kcl".try_into().unwrap();
    assert_eq!(
        changes.get(&u).unwrap().clone(),
        vec![tower_lsp::lsp_types::TextEdit {
            range: tower_lsp::lsp_types::Range {
                start: tower_lsp::lsp_types::Position { line: 0, character: 0 },
                end: tower_lsp::lsp_types::Position { line: 0, character: 13 },
            },
            new_text: "const newName = 1\n".to_string(),
        }]
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn test_kcl_lsp_diagnostic_no_errors() {
    let server = kcl_lsp_server(false).await.unwrap();

    // Send open file.
    server
        .did_open(tower_lsp::lsp_types::DidOpenTextDocumentParams {
            text_document: tower_lsp::lsp_types::TextDocumentItem {
                uri: "file:///test.kcl".try_into().unwrap(),
                language_id: "kcl".to_string(),
                version: 1,
                text: r#"const thing= 1"#.to_string(),
            },
        })
        .await;
    server.wait_on_handle().await;

    // Send diagnostics request.
    let diagnostics = server
        .diagnostic(tower_lsp::lsp_types::DocumentDiagnosticParams {
            text_document: tower_lsp::lsp_types::TextDocumentIdentifier {
                uri: "file:///test.kcl".try_into().unwrap(),
            },
            partial_result_params: Default::default(),
            work_done_progress_params: Default::default(),
            identifier: None,
            previous_result_id: None,
        })
        .await
        .unwrap();

    // Check the diagnostics.
    if let tower_lsp::lsp_types::DocumentDiagnosticReportResult::Report(diagnostics) = diagnostics {
        if let tower_lsp::lsp_types::DocumentDiagnosticReport::Full(diagnostics) = diagnostics {
            assert_eq!(diagnostics.full_document_diagnostic_report.items.len(), 0);
        } else {
            panic!("Expected full diagnostics");
        }
    } else {
        panic!("Expected diagnostics");
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn test_kcl_lsp_diagnostic_has_errors() {
    let server = kcl_lsp_server(false).await.unwrap();

    // Send open file.
    server
        .did_open(tower_lsp::lsp_types::DidOpenTextDocumentParams {
            text_document: tower_lsp::lsp_types::TextDocumentItem {
                uri: "file:///test.kcl".try_into().unwrap(),
                language_id: "kcl".to_string(),
                version: 1,
                text: r#"k;ajsndasd thing= 1"#.to_string(),
            },
        })
        .await;
    server.wait_on_handle().await;

    // Send diagnostics request.
    let diagnostics = server
        .diagnostic(tower_lsp::lsp_types::DocumentDiagnosticParams {
            text_document: tower_lsp::lsp_types::TextDocumentIdentifier {
                uri: "file:///test.kcl".try_into().unwrap(),
            },
            partial_result_params: Default::default(),
            work_done_progress_params: Default::default(),
            identifier: None,
            previous_result_id: None,
        })
        .await
        .unwrap();

    // Check the diagnostics.
    if let tower_lsp::lsp_types::DocumentDiagnosticReportResult::Report(diagnostics) = diagnostics {
        if let tower_lsp::lsp_types::DocumentDiagnosticReport::Full(diagnostics) = diagnostics {
            assert_eq!(diagnostics.full_document_diagnostic_report.items.len(), 1);
            assert_eq!(
                diagnostics.full_document_diagnostic_report.items[0].message,
                "lexical: found unknown token ';'"
            );
        } else {
            panic!("Expected full diagnostics");
        }
    } else {
        panic!("Expected diagnostics");
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn test_copilot_lsp_set_editor_info() {
    let server = copilot_lsp_server().await.unwrap();

    // Send set editor info request.
    server
        .set_editor_info(crate::lsp::copilot::types::CopilotEditorInfo {
            editor_info: crate::lsp::copilot::types::EditorInfo {
                name: "vscode".to_string(),
                version: "1.0.0".to_string(),
            },
            editor_configuration: crate::lsp::copilot::types::EditorConfiguration {
                disabled_languages: vec![],
                enable_auto_completions: true,
            },
            editor_plugin_info: crate::lsp::copilot::types::EditorInfo {
                name: "copilot".to_string(),
                version: "1.0.0".to_string(),
            },
        })
        .await
        .unwrap();

    // Check the editor info.
    // Acquire the lock.
    let editor_info = server.editor_info.read().unwrap();
    assert_eq!(editor_info.editor_info.name, "vscode");
    assert_eq!(editor_info.editor_info.version, "1.0.0");
}

#[tokio::test(flavor = "multi_thread")]
#[ignore] // Ignore til hosted model is faster (@jessfraz working on).
async fn test_copilot_lsp_completions_raw() {
    let server = copilot_lsp_server().await.unwrap();

    // Send open file.
    server
        .did_open(tower_lsp::lsp_types::DidOpenTextDocumentParams {
            text_document: tower_lsp::lsp_types::TextDocumentItem {
                uri: "file:///test.copilot".try_into().unwrap(),
                language_id: "copilot".to_string(),
                version: 1,
                text: "st".to_string(),
            },
        })
        .await;
    server.wait_on_handle().await;

    // Send completion request.
    let completions = server
        .get_completions(
            "kcl".to_string(),
            r#"const bracket = startSketchOn('XY')
  |> startProfileAt([0, 0], %)
  "#
            .to_string(),
            r#"  |> close(%)
  |> extrude(10, %)"#
                .to_string(),
        )
        .await
        .unwrap();

    // Check the completions.
    assert_eq!(completions.len(), 1);
    println!("got completion:\n```\n{}\n```", completions[0]);

    // Test the cache.
    let completions_hit_cache = server
        .get_completions(
            "kcl".to_string(),
            r#"const bracket = startSketchOn('XY')
  |> startProfileAt([0, 0], %)
  "#
            .to_string(),
            r#"  |> close(%)
  |> extrude(10, %)"#
                .to_string(),
        )
        .await
        .unwrap();

    assert_eq!(completions, completions_hit_cache);
}

#[tokio::test(flavor = "multi_thread")]
#[ignore] // Ignore til hosted model is faster (@jessfraz working on).
async fn test_copilot_lsp_completions() {
    let server = copilot_lsp_server().await.unwrap();

    // Send open file.
    server
        .did_open(tower_lsp::lsp_types::DidOpenTextDocumentParams {
            text_document: tower_lsp::lsp_types::TextDocumentItem {
                uri: "file:///test.copilot".try_into().unwrap(),
                language_id: "copilot".to_string(),
                version: 1,
                text: "st".to_string(),
            },
        })
        .await;
    server.wait_on_handle().await;

    // Send completion request.
    let params = crate::lsp::copilot::types::CopilotLspCompletionParams {
        doc: crate::lsp::copilot::types::CopilotDocParams {
            indent_size: 4,
            insert_spaces: true,
            language_id: "kcl".to_string(),
            path: "file:///test.copilot".to_string(),
            position: crate::lsp::copilot::types::CopilotPosition { line: 3, character: 3 },
            relative_path: "test.copilot".to_string(),
            source: r#"const bracket = startSketchOn('XY')
  |> startProfileAt([0, 0], %)
  
  |> close(%)
  |> extrude(10, %)
"#
            .to_string(),
            tab_size: 4,
            uri: "file:///test.copilot".into(),
        },
    };
    let completions = server.get_completions_cycling(params.clone()).await.unwrap();

    // Check the completions.
    assert_eq!(completions.completions.len(), 1);

    // Accept the completion.
    let completion = completions.completions.first().unwrap();

    // Send completion accept request.
    server
        .accept_completion(crate::lsp::copilot::types::CopilotAcceptCompletionParams { uuid: completion.uuid })
        .await;

    // Test the cache.
    let completions_hit_cache = server.get_completions_cycling(params).await.unwrap();

    assert_eq!(completions.completions, completions_hit_cache.completions);

    // Reject the completion.
    let completion = completions.completions.first().unwrap();

    // Send completion reject request.
    server
        .reject_completions(crate::lsp::copilot::types::CopilotRejectCompletionParams {
            uuids: vec![completion.uuid],
        })
        .await;
}

#[tokio::test(flavor = "multi_thread")]
async fn test_copilot_on_save() {
    let server = copilot_lsp_server().await.unwrap();

    // Send save file.
    server
        .did_save(tower_lsp::lsp_types::DidSaveTextDocumentParams {
            text_document: tower_lsp::lsp_types::TextDocumentIdentifier {
                uri: "file:///test.copilot".try_into().unwrap(),
            },
            text: Some("my file".to_string()),
        })
        .await;
    server.wait_on_handle().await;

    // Check the code map.
    assert_eq!(server.code_map.len().await, 1);
    assert_eq!(
        server.code_map.get("file:///test.copilot").await.unwrap(),
        "my file".as_bytes()
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn test_kcl_on_save() {
    let server = kcl_lsp_server(false).await.unwrap();

    // Send save file.
    server
        .did_save(tower_lsp::lsp_types::DidSaveTextDocumentParams {
            text_document: tower_lsp::lsp_types::TextDocumentIdentifier {
                uri: "file:///test.kcl".try_into().unwrap(),
            },
            text: Some("my file".to_string()),
        })
        .await;
    server.wait_on_handle().await;

    // Check the code map.
    assert_eq!(server.code_map.len().await, 1);
    assert_eq!(
        server.code_map.get("file:///test.kcl").await.unwrap(),
        "my file".as_bytes()
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn test_copilot_rename_not_exists() {
    let server = copilot_lsp_server().await.unwrap();

    // Send rename request.
    server
        .did_rename_files(tower_lsp::lsp_types::RenameFilesParams {
            files: vec![tower_lsp::lsp_types::FileRename {
                old_uri: "file:///test.copilot".into(),
                new_uri: "file:///test2.copilot".into(),
            }],
        })
        .await;
    server.wait_on_handle().await;

    // Check the code map.
    assert_eq!(server.code_map.len().await, 1);
    assert_eq!(
        server.code_map.get("file:///test2.copilot").await.unwrap(),
        "".as_bytes()
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn test_lsp_initialized() {
    let copilot_server = copilot_lsp_server().await.unwrap();

    // Send initialize request.
    copilot_server
        .initialize(tower_lsp::lsp_types::InitializeParams::default())
        .await
        .unwrap();

    // Send initialized request.
    copilot_server
        .initialized(tower_lsp::lsp_types::InitializedParams {})
        .await;

    // Check the code map.
    assert_eq!(copilot_server.code_map.len().await, 0);

    // Now do the same for kcl.
    let kcl_server = kcl_lsp_server(false).await.unwrap();

    // Send initialize request.
    kcl_server
        .initialize(tower_lsp::lsp_types::InitializeParams::default())
        .await
        .unwrap();

    // Send initialized request.
    kcl_server.initialized(tower_lsp::lsp_types::InitializedParams {}).await;

    // Check the code map.
    assert_eq!(kcl_server.code_map.len().await, 0);

    // Now shut them down.
    copilot_server.shutdown().await.unwrap();
    kcl_server.shutdown().await.unwrap();
}

#[tokio::test(flavor = "multi_thread")]
async fn test_kcl_lsp_on_change_update_ast() {
    let server = kcl_lsp_server(false).await.unwrap();

    let same_text = r#"const thing = 1"#.to_string();

    // Send open file.
    server
        .did_open(tower_lsp::lsp_types::DidOpenTextDocumentParams {
            text_document: tower_lsp::lsp_types::TextDocumentItem {
                uri: "file:///test.kcl".try_into().unwrap(),
                language_id: "kcl".to_string(),
                version: 1,
                text: same_text.clone(),
            },
        })
        .await;
    server.wait_on_handle().await;

    // Get the ast.
    let ast = server.ast_map.get("file:///test.kcl").await.unwrap().clone();

    // Send change file.
    server
        .did_change(tower_lsp::lsp_types::DidChangeTextDocumentParams {
            text_document: tower_lsp::lsp_types::VersionedTextDocumentIdentifier {
                uri: "file:///test.kcl".try_into().unwrap(),
                version: 1,
            },
            content_changes: vec![tower_lsp::lsp_types::TextDocumentContentChangeEvent {
                range: None,
                range_length: None,
                text: same_text.clone(),
            }],
        })
        .await;
    server.wait_on_handle().await;

    // Make sure the ast is the same.
    assert_eq!(ast, server.ast_map.get("file:///test.kcl").await.unwrap().clone());

    // Update the text.
    let new_text = r#"const thing = 2"#.to_string();
    // Send change file.
    server
        .did_change(tower_lsp::lsp_types::DidChangeTextDocumentParams {
            text_document: tower_lsp::lsp_types::VersionedTextDocumentIdentifier {
                uri: "file:///test.kcl".try_into().unwrap(),
                version: 2,
            },
            content_changes: vec![tower_lsp::lsp_types::TextDocumentContentChangeEvent {
                range: None,
                range_length: None,
                text: new_text.clone(),
            }],
        })
        .await;
    server.wait_on_handle().await;

    assert!(ast != server.ast_map.get("file:///test.kcl").await.unwrap().clone());

    // Make sure we never updated the memory since we aren't running the engine.
    assert!(server.memory_map.get("file:///test.kcl").await.is_none());
}

#[tokio::test(flavor = "multi_thread")]
async fn serial_test_kcl_lsp_on_change_update_memory() {
    let server = kcl_lsp_server(true).await.unwrap();

    let same_text = r#"const thing = 1"#.to_string();

    // Send open file.
    server
        .did_open(tower_lsp::lsp_types::DidOpenTextDocumentParams {
            text_document: tower_lsp::lsp_types::TextDocumentItem {
                uri: "file:///test.kcl".try_into().unwrap(),
                language_id: "kcl".to_string(),
                version: 1,
                text: same_text.clone(),
            },
        })
        .await;
    server.wait_on_handle().await;

    // Get the memory.
    let memory = server.memory_map.get("file:///test.kcl").await.unwrap().clone();

    // Send change file.
    server
        .did_change(tower_lsp::lsp_types::DidChangeTextDocumentParams {
            text_document: tower_lsp::lsp_types::VersionedTextDocumentIdentifier {
                uri: "file:///test.kcl".try_into().unwrap(),
                version: 1,
            },
            content_changes: vec![tower_lsp::lsp_types::TextDocumentContentChangeEvent {
                range: None,
                range_length: None,
                text: same_text.clone(),
            }],
        })
        .await;
    server.wait_on_handle().await;

    // Make sure the memory is the same.
    assert_eq!(memory, server.memory_map.get("file:///test.kcl").await.unwrap().clone());

    // Update the text.
    let new_text = r#"const thing = 2"#.to_string();
    // Send change file.
    server
        .did_change(tower_lsp::lsp_types::DidChangeTextDocumentParams {
            text_document: tower_lsp::lsp_types::VersionedTextDocumentIdentifier {
                uri: "file:///test.kcl".try_into().unwrap(),
                version: 2,
            },
            content_changes: vec![tower_lsp::lsp_types::TextDocumentContentChangeEvent {
                range: None,
                range_length: None,
                text: new_text.clone(),
            }],
        })
        .await;
    server.wait_on_handle().await;

    assert!(memory != server.memory_map.get("file:///test.kcl").await.unwrap().clone());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 10)]
async fn serial_test_kcl_lsp_update_units() {
    let server = kcl_lsp_server(true).await.unwrap();

    let same_text = r#"fn cube = (pos, scale) => {
  const sg = startSketchOn('XY')
    |> startProfileAt(pos, %)
    |> line([0, scale], %)
    |> line([scale, 0], %)
    |> line([0, -scale], %)

  return sg
}
const part001 = cube([0,0], 20)
    |> close(%)
    |> extrude(20, %)"#
        .to_string();

    // Send open file.
    server
        .did_open(tower_lsp::lsp_types::DidOpenTextDocumentParams {
            text_document: tower_lsp::lsp_types::TextDocumentItem {
                uri: "file:///test.kcl".try_into().unwrap(),
                language_id: "kcl".to_string(),
                version: 1,
                text: same_text.clone(),
            },
        })
        .await;
    server.wait_on_handle().await;

    // Get the tokens.
    let tokens = server.token_map.get("file:///test.kcl").await.unwrap().clone();
    assert_eq!(tokens.len(), 124);

    // Get the ast.
    let ast = server.ast_map.get("file:///test.kcl").await.unwrap().clone();
    assert_eq!(ast.body.len(), 2);

    // Get the memory.
    let memory = server.memory_map.get("file:///test.kcl").await.unwrap().clone();

    // Send change file.
    server
        .did_change(tower_lsp::lsp_types::DidChangeTextDocumentParams {
            text_document: tower_lsp::lsp_types::VersionedTextDocumentIdentifier {
                uri: "file:///test.kcl".try_into().unwrap(),
                version: 1,
            },
            content_changes: vec![tower_lsp::lsp_types::TextDocumentContentChangeEvent {
                range: None,
                range_length: None,
                text: same_text.clone(),
            }],
        })
        .await;
    server.wait_on_handle().await;

    // Make sure the memory is the same.
    assert_eq!(memory, server.memory_map.get("file:///test.kcl").await.unwrap().clone());

    let units = server.executor_ctx.read().await.clone().unwrap().settings.units;
    assert_eq!(units, crate::settings::types::UnitLength::Mm);

    // Update the units.
    server
        .update_units(crate::lsp::kcl::custom_notifications::UpdateUnitsParams {
            text_document: crate::lsp::kcl::custom_notifications::TextDocumentIdentifier {
                uri: "file:///test.kcl".try_into().unwrap(),
            },
            units: crate::settings::types::UnitLength::M,
            text: same_text.clone(),
        })
        .await
        .unwrap();
    server.wait_on_handle().await;

    let units = server.executor_ctx().await.unwrap().settings.units;
    assert_eq!(units, crate::settings::types::UnitLength::M);

    // Make sure it forced a memory update.
    assert!(memory != server.memory_map.get("file:///test.kcl").await.unwrap().clone());
}

#[tokio::test(flavor = "multi_thread")]
async fn serial_test_kcl_lsp_empty_file_execute_ok() {
    let server = kcl_lsp_server(true).await.unwrap();

    // Send open file.
    server
        .did_open(tower_lsp::lsp_types::DidOpenTextDocumentParams {
            text_document: tower_lsp::lsp_types::TextDocumentItem {
                uri: "file:///test.kcl".try_into().unwrap(),
                language_id: "kcl".to_string(),
                version: 1,
                text: "".to_string(),
            },
        })
        .await;
    server.wait_on_handle().await;

    // Get the memory.
    let memory = server.memory_map.get("file:///test.kcl").await.unwrap().clone();
    assert_eq!(memory, ProgramMemory::default());
}

#[tokio::test(flavor = "multi_thread")]
async fn test_kcl_lsp_diagnostics_on_parse_error() {
    let server = kcl_lsp_server(false).await.unwrap();

    // Send open file.
    server
        .did_open(tower_lsp::lsp_types::DidOpenTextDocumentParams {
            text_document: tower_lsp::lsp_types::TextDocumentItem {
                uri: "file:///test.kcl".try_into().unwrap(),
                language_id: "kcl".to_string(),
                version: 1,
                text: "asdasd asdasd asda!d".to_string(),
            },
        })
        .await;
    server.wait_on_handle().await;

    // Get the diagnostics.
    let diagnostics = server.diagnostics_map.get("file:///test.kcl").await.unwrap().clone();
    // Check the diagnostics.
    if let tower_lsp::lsp_types::DocumentDiagnosticReport::Full(diagnostics) = diagnostics {
        assert_eq!(diagnostics.full_document_diagnostic_report.items.len(), 1);
    } else {
        panic!("Expected full diagnostics");
    }

    // Update the text.
    let new_text = r#"const thing = 2"#.to_string();
    // Send change file.
    server
        .did_change(tower_lsp::lsp_types::DidChangeTextDocumentParams {
            text_document: tower_lsp::lsp_types::VersionedTextDocumentIdentifier {
                uri: "file:///test.kcl".try_into().unwrap(),
                version: 2,
            },
            content_changes: vec![tower_lsp::lsp_types::TextDocumentContentChangeEvent {
                range: None,
                range_length: None,
                text: new_text.clone(),
            }],
        })
        .await;
    server.wait_on_handle().await;

    // Get the diagnostics.
    let diagnostics = server.diagnostics_map.get("file:///test.kcl").await.unwrap().clone();
    // Check the diagnostics.
    if let tower_lsp::lsp_types::DocumentDiagnosticReport::Full(diagnostics) = diagnostics {
        assert_eq!(diagnostics.full_document_diagnostic_report.items.len(), 0);
    } else {
        panic!("Expected full diagnostics");
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn serial_test_kcl_lsp_diagnostics_on_execution_error() {
    let server = kcl_lsp_server(true).await.unwrap();

    // Send open file.
    server
        .did_open(tower_lsp::lsp_types::DidOpenTextDocumentParams {
            text_document: tower_lsp::lsp_types::TextDocumentItem {
                uri: "file:///test.kcl".try_into().unwrap(),
                language_id: "kcl".to_string(),
                version: 1,
                text: r#"const part001 = startSketchOn('XY')
  |> startProfileAt([-10, -10], %)
  |> line([20, 0], %)
  |> line([0, 20], %)
  |> line([-20, 0], %)
  |> close(%)
  |> extrude(3.14, %)
  |> fillet({
    radius: 3.14,
    tags: ["tag_or_edge_fn"],
  }, %)"#
                    .to_string(),
            },
        })
        .await;
    server.wait_on_handle().await;

    // Get the diagnostics.
    let diagnostics = server.diagnostics_map.get("file:///test.kcl").await.unwrap().clone();
    // Check the diagnostics.
    if let tower_lsp::lsp_types::DocumentDiagnosticReport::Full(diagnostics) = diagnostics {
        assert_eq!(diagnostics.full_document_diagnostic_report.items.len(), 1);
    } else {
        panic!("Expected full diagnostics");
    }

    // Update the text.
    let new_text = r#"const part001 = startSketchOn('XY')
  |> startProfileAt([-10, -10], %)
  |> line([20, 0], %)
  |> line([0, 20], %)
  |> line([-20, 0], %)
  |> close(%)
  |> extrude(3.14, %)"#
        .to_string();
    // Send change file.
    server
        .did_change(tower_lsp::lsp_types::DidChangeTextDocumentParams {
            text_document: tower_lsp::lsp_types::VersionedTextDocumentIdentifier {
                uri: "file:///test.kcl".try_into().unwrap(),
                version: 2,
            },
            content_changes: vec![tower_lsp::lsp_types::TextDocumentContentChangeEvent {
                range: None,
                range_length: None,
                text: new_text.clone(),
            }],
        })
        .await;
    server.wait_on_handle().await;

    // Get the diagnostics.
    let diagnostics = server.diagnostics_map.get("file:///test.kcl").await.unwrap().clone();
    // Check the diagnostics.
    if let tower_lsp::lsp_types::DocumentDiagnosticReport::Full(diagnostics) = diagnostics {
        assert_eq!(diagnostics.full_document_diagnostic_report.items.len(), 0);
    } else {
        panic!("Expected full diagnostics");
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn serial_test_kcl_lsp_full_to_empty_file_updates_ast_and_memory() {
    let server = kcl_lsp_server(true).await.unwrap();

    // Send open file.
    server
        .did_open(tower_lsp::lsp_types::DidOpenTextDocumentParams {
            text_document: tower_lsp::lsp_types::TextDocumentItem {
                uri: "file:///test.kcl".try_into().unwrap(),
                language_id: "kcl".to_string(),
                version: 1,
                text: r#"const part001 = startSketchOn('XY')
  |> startProfileAt([-10, -10], %)
  |> line([20, 0], %)
  |> line([0, 20], %)
  |> line([-20, 0], %)
  |> close(%)
  |> extrude(3.14, %)"#
                    .to_string(),
            },
        })
        .await;
    server.wait_on_handle().await;

    // Get the ast.
    let ast = server.ast_map.get("file:///test.kcl").await.unwrap().clone();
    assert!(ast != crate::ast::types::Program::default());
    // Get the memory.
    let memory = server.memory_map.get("file:///test.kcl").await.unwrap().clone();
    assert!(memory != ProgramMemory::default());

    // Send change file.
    server
        .did_change(tower_lsp::lsp_types::DidChangeTextDocumentParams {
            text_document: tower_lsp::lsp_types::VersionedTextDocumentIdentifier {
                uri: "file:///test.kcl".try_into().unwrap(),
                version: 2,
            },
            content_changes: vec![tower_lsp::lsp_types::TextDocumentContentChangeEvent {
                range: None,
                range_length: None,
                text: "".to_string(),
            }],
        })
        .await;
    server.wait_on_handle().await;

    // Get the ast.
    let ast = server.ast_map.get("file:///test.kcl").await.unwrap().clone();
    assert_eq!(ast, crate::ast::types::Program::default());
    // Get the memory.
    let memory = server.memory_map.get("file:///test.kcl").await.unwrap().clone();
    assert_eq!(memory, ProgramMemory::default());
}

#[tokio::test(flavor = "multi_thread")]
async fn serial_test_kcl_lsp_code_unchanged_but_has_diagnostics_reexecute() {
    let server = kcl_lsp_server(true).await.unwrap();

    let code = r#"const part001 = startSketchOn('XY')
  |> startProfileAt([-10, -10], %)
  |> line([20, 0], %)
  |> line([0, 20], %)
  |> line([-20, 0], %)
  |> close(%)
  |> extrude(3.14, %)"#;

    // Send open file.
    server
        .did_open(tower_lsp::lsp_types::DidOpenTextDocumentParams {
            text_document: tower_lsp::lsp_types::TextDocumentItem {
                uri: "file:///test.kcl".try_into().unwrap(),
                language_id: "kcl".to_string(),
                version: 1,
                text: code.to_string(),
            },
        })
        .await;
    server.wait_on_handle().await;

    // Get the ast.
    let ast = server.ast_map.get("file:///test.kcl").await.unwrap().clone();
    assert!(ast != crate::ast::types::Program::default());
    // Get the memory.
    let memory = server.memory_map.get("file:///test.kcl").await.unwrap().clone();
    assert!(memory != ProgramMemory::default());

    // Assure we have no diagnostics.
    let diagnostics = server.diagnostics_map.get("file:///test.kcl").await.unwrap().clone();
    // Check the diagnostics.
    if let tower_lsp::lsp_types::DocumentDiagnosticReport::Full(ref diagnostics) = diagnostics {
        assert_eq!(diagnostics.full_document_diagnostic_report.items.len(), 0);
    } else {
        panic!("Expected full diagnostics");
    }

    // Add some fake diagnostics.
    server
        .diagnostics_map
        .insert(
            "file:///test.kcl".to_string(),
            tower_lsp::lsp_types::DocumentDiagnosticReport::Full(
                tower_lsp::lsp_types::RelatedFullDocumentDiagnosticReport {
                    related_documents: None,
                    full_document_diagnostic_report: tower_lsp::lsp_types::FullDocumentDiagnosticReport {
                        result_id: None,
                        items: vec![tower_lsp::lsp_types::Diagnostic {
                            range: tower_lsp::lsp_types::Range {
                                start: tower_lsp::lsp_types::Position { line: 0, character: 0 },
                                end: tower_lsp::lsp_types::Position { line: 0, character: 0 },
                            },
                            message: "fake diagnostic".to_string(),
                            severity: Some(tower_lsp::lsp_types::DiagnosticSeverity::ERROR),
                            code: None,
                            source: None,
                            related_information: None,
                            tags: None,
                            data: None,
                            code_description: None,
                        }],
                    },
                },
            ),
        )
        .await;
    // Assure we have one diagnostics.
    let diagnostics = server.diagnostics_map.get("file:///test.kcl").await.unwrap().clone();
    if let tower_lsp::lsp_types::DocumentDiagnosticReport::Full(diagnostics) = diagnostics {
        assert_eq!(diagnostics.full_document_diagnostic_report.items.len(), 1);
    } else {
        panic!("Expected full diagnostics");
    }

    // Clear the ast and memory.
    server
        .ast_map
        .insert("file:///test.kcl".to_string(), crate::ast::types::Program::default())
        .await;
    let ast = server.ast_map.get("file:///test.kcl").await.unwrap().clone();
    assert_eq!(ast, crate::ast::types::Program::default());
    server
        .memory_map
        .insert("file:///test.kcl".to_string(), ProgramMemory::default())
        .await;
    let memory = server.memory_map.get("file:///test.kcl").await.unwrap().clone();
    assert_eq!(memory, ProgramMemory::default());

    // Send change file, but the code is the same.
    server
        .did_change(tower_lsp::lsp_types::DidChangeTextDocumentParams {
            text_document: tower_lsp::lsp_types::VersionedTextDocumentIdentifier {
                uri: "file:///test.kcl".try_into().unwrap(),
                version: 2,
            },
            content_changes: vec![tower_lsp::lsp_types::TextDocumentContentChangeEvent {
                range: None,
                range_length: None,
                text: code.to_string(),
            }],
        })
        .await;
    server.wait_on_handle().await;

    // Get the ast.
    let ast = server.ast_map.get("file:///test.kcl").await.unwrap().clone();
    assert!(ast != crate::ast::types::Program::default());
    // Get the memory.
    let memory = server.memory_map.get("file:///test.kcl").await.unwrap().clone();
    assert!(memory != ProgramMemory::default());

    // Assure we have no diagnostics.
    let diagnostics = server.diagnostics_map.get("file:///test.kcl").await.unwrap().clone();
    // Check the diagnostics.
    if let tower_lsp::lsp_types::DocumentDiagnosticReport::Full(diagnostics) = diagnostics {
        assert_eq!(diagnostics.full_document_diagnostic_report.items.len(), 0);
    } else {
        panic!("Expected full diagnostics");
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn serial_test_kcl_lsp_code_and_ast_unchanged_but_has_diagnostics_reexecute() {
    let server = kcl_lsp_server(true).await.unwrap();

    let code = r#"const part001 = startSketchOn('XY')
  |> startProfileAt([-10, -10], %)
  |> line([20, 0], %)
  |> line([0, 20], %)
  |> line([-20, 0], %)
  |> close(%)
  |> extrude(3.14, %)"#;

    // Send open file.
    server
        .did_open(tower_lsp::lsp_types::DidOpenTextDocumentParams {
            text_document: tower_lsp::lsp_types::TextDocumentItem {
                uri: "file:///test.kcl".try_into().unwrap(),
                language_id: "kcl".to_string(),
                version: 1,
                text: code.to_string(),
            },
        })
        .await;
    server.wait_on_handle().await;

    // Get the ast.
    let ast = server.ast_map.get("file:///test.kcl").await.unwrap().clone();
    assert!(ast != crate::ast::types::Program::default());
    // Get the memory.
    let memory = server.memory_map.get("file:///test.kcl").await.unwrap().clone();
    assert!(memory != ProgramMemory::default());

    // Assure we have no diagnostics.
    let diagnostics = server.diagnostics_map.get("file:///test.kcl").await.unwrap().clone();
    // Check the diagnostics.
    if let tower_lsp::lsp_types::DocumentDiagnosticReport::Full(ref diagnostics) = diagnostics {
        assert_eq!(diagnostics.full_document_diagnostic_report.items.len(), 0);
    } else {
        panic!("Expected full diagnostics");
    }

    // Add some fake diagnostics.
    server
        .diagnostics_map
        .insert(
            "file:///test.kcl".to_string(),
            tower_lsp::lsp_types::DocumentDiagnosticReport::Full(
                tower_lsp::lsp_types::RelatedFullDocumentDiagnosticReport {
                    related_documents: None,
                    full_document_diagnostic_report: tower_lsp::lsp_types::FullDocumentDiagnosticReport {
                        result_id: None,
                        items: vec![tower_lsp::lsp_types::Diagnostic {
                            range: tower_lsp::lsp_types::Range {
                                start: tower_lsp::lsp_types::Position { line: 0, character: 0 },
                                end: tower_lsp::lsp_types::Position { line: 0, character: 0 },
                            },
                            message: "fake diagnostic".to_string(),
                            severity: Some(tower_lsp::lsp_types::DiagnosticSeverity::ERROR),
                            code: None,
                            source: None,
                            related_information: None,
                            tags: None,
                            data: None,
                            code_description: None,
                        }],
                    },
                },
            ),
        )
        .await;
    // Assure we have one diagnostics.
    let diagnostics = server.diagnostics_map.get("file:///test.kcl").await.unwrap().clone();
    if let tower_lsp::lsp_types::DocumentDiagnosticReport::Full(diagnostics) = diagnostics {
        assert_eq!(diagnostics.full_document_diagnostic_report.items.len(), 1);
    } else {
        panic!("Expected full diagnostics");
    }

    // Clear ONLY the memory.
    server
        .memory_map
        .insert("file:///test.kcl".to_string(), ProgramMemory::default())
        .await;
    let memory = server.memory_map.get("file:///test.kcl").await.unwrap().clone();
    assert_eq!(memory, ProgramMemory::default());

    // Send change file, but the code is the same.
    server
        .did_change(tower_lsp::lsp_types::DidChangeTextDocumentParams {
            text_document: tower_lsp::lsp_types::VersionedTextDocumentIdentifier {
                uri: "file:///test.kcl".try_into().unwrap(),
                version: 2,
            },
            content_changes: vec![tower_lsp::lsp_types::TextDocumentContentChangeEvent {
                range: None,
                range_length: None,
                text: code.to_string(),
            }],
        })
        .await;
    server.wait_on_handle().await;

    // Get the ast.
    let ast = server.ast_map.get("file:///test.kcl").await.unwrap().clone();
    assert!(ast != crate::ast::types::Program::default());
    // Get the memory.
    let memory = server.memory_map.get("file:///test.kcl").await.unwrap().clone();
    assert!(memory != ProgramMemory::default());

    // Assure we have no diagnostics.
    let diagnostics = server.diagnostics_map.get("file:///test.kcl").await.unwrap().clone();
    // Check the diagnostics.
    if let tower_lsp::lsp_types::DocumentDiagnosticReport::Full(diagnostics) = diagnostics {
        assert_eq!(diagnostics.full_document_diagnostic_report.items.len(), 0);
    } else {
        panic!("Expected full diagnostics");
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn serial_test_kcl_lsp_code_and_ast_units_unchanged_but_has_diagnostics_reexecute_on_unit_change() {
    let server = kcl_lsp_server(true).await.unwrap();

    let code = r#"const part001 = startSketchOn('XY')
  |> startProfileAt([-10, -10], %)
  |> line([20, 0], %)
  |> line([0, 20], %)
  |> line([-20, 0], %)
  |> close(%)
  |> extrude(3.14, %)"#;

    // Send open file.
    server
        .did_open(tower_lsp::lsp_types::DidOpenTextDocumentParams {
            text_document: tower_lsp::lsp_types::TextDocumentItem {
                uri: "file:///test.kcl".try_into().unwrap(),
                language_id: "kcl".to_string(),
                version: 1,
                text: code.to_string(),
            },
        })
        .await;
    server.wait_on_handle().await;

    // Get the ast.
    let ast = server.ast_map.get("file:///test.kcl").await.unwrap().clone();
    assert!(ast != crate::ast::types::Program::default());
    // Get the memory.
    let memory = server.memory_map.get("file:///test.kcl").await.unwrap().clone();
    assert!(memory != ProgramMemory::default());

    // Assure we have no diagnostics.
    let diagnostics = server.diagnostics_map.get("file:///test.kcl").await.unwrap().clone();
    // Check the diagnostics.
    if let tower_lsp::lsp_types::DocumentDiagnosticReport::Full(ref diagnostics) = diagnostics {
        assert_eq!(diagnostics.full_document_diagnostic_report.items.len(), 0);
    } else {
        panic!("Expected full diagnostics");
    }

    // Add some fake diagnostics.
    server
        .diagnostics_map
        .insert(
            "file:///test.kcl".to_string(),
            tower_lsp::lsp_types::DocumentDiagnosticReport::Full(
                tower_lsp::lsp_types::RelatedFullDocumentDiagnosticReport {
                    related_documents: None,
                    full_document_diagnostic_report: tower_lsp::lsp_types::FullDocumentDiagnosticReport {
                        result_id: None,
                        items: vec![tower_lsp::lsp_types::Diagnostic {
                            range: tower_lsp::lsp_types::Range {
                                start: tower_lsp::lsp_types::Position { line: 0, character: 0 },
                                end: tower_lsp::lsp_types::Position { line: 0, character: 0 },
                            },
                            message: "fake diagnostic".to_string(),
                            severity: Some(tower_lsp::lsp_types::DiagnosticSeverity::ERROR),
                            code: None,
                            source: None,
                            related_information: None,
                            tags: None,
                            data: None,
                            code_description: None,
                        }],
                    },
                },
            ),
        )
        .await;
    // Assure we have one diagnostics.
    let diagnostics = server.diagnostics_map.get("file:///test.kcl").await.unwrap().clone();
    if let tower_lsp::lsp_types::DocumentDiagnosticReport::Full(diagnostics) = diagnostics {
        assert_eq!(diagnostics.full_document_diagnostic_report.items.len(), 1);
    } else {
        panic!("Expected full diagnostics");
    }

    // Clear ONLY the memory.
    server
        .memory_map
        .insert("file:///test.kcl".to_string(), ProgramMemory::default())
        .await;
    let memory = server.memory_map.get("file:///test.kcl").await.unwrap().clone();
    assert_eq!(memory, ProgramMemory::default());

    let units = server.executor_ctx().await.unwrap().settings.units;
    assert_eq!(units, crate::settings::types::UnitLength::Mm);

    // Update the units to the _same_ units.
    server
        .update_units(crate::lsp::kcl::custom_notifications::UpdateUnitsParams {
            text_document: crate::lsp::kcl::custom_notifications::TextDocumentIdentifier {
                uri: "file:///test.kcl".try_into().unwrap(),
            },
            units: crate::settings::types::UnitLength::Mm,
            text: code.to_string(),
        })
        .await
        .unwrap();
    server.wait_on_handle().await;

    let units = server.executor_ctx().await.unwrap().settings.units;
    assert_eq!(units, crate::settings::types::UnitLength::Mm);

    // Get the ast.
    let ast = server.ast_map.get("file:///test.kcl").await.unwrap().clone();
    assert!(ast != crate::ast::types::Program::default());
    // Get the memory.
    let memory = server.memory_map.get("file:///test.kcl").await.unwrap().clone();
    assert!(memory != ProgramMemory::default());

    // Assure we have no diagnostics.
    let diagnostics = server.diagnostics_map.get("file:///test.kcl").await.unwrap().clone();
    // Check the diagnostics.
    if let tower_lsp::lsp_types::DocumentDiagnosticReport::Full(diagnostics) = diagnostics {
        assert_eq!(diagnostics.full_document_diagnostic_report.items.len(), 0);
    } else {
        panic!("Expected full diagnostics");
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn serial_test_kcl_lsp_code_and_ast_units_unchanged_but_has_memory_reexecute_on_unit_change() {
    let server = kcl_lsp_server(true).await.unwrap();

    let code = r#"const part001 = startSketchOn('XY')
  |> startProfileAt([-10, -10], %)
  |> line([20, 0], %)
  |> line([0, 20], %)
  |> line([-20, 0], %)
  |> close(%)
  |> extrude(3.14, %)"#;

    // Send open file.
    server
        .did_open(tower_lsp::lsp_types::DidOpenTextDocumentParams {
            text_document: tower_lsp::lsp_types::TextDocumentItem {
                uri: "file:///test.kcl".try_into().unwrap(),
                language_id: "kcl".to_string(),
                version: 1,
                text: code.to_string(),
            },
        })
        .await;
    server.wait_on_handle().await;

    // Get the ast.
    let ast = server.ast_map.get("file:///test.kcl").await.unwrap().clone();
    assert!(ast != crate::ast::types::Program::default());
    // Get the memory.
    let memory = server.memory_map.get("file:///test.kcl").await.unwrap().clone();
    assert!(memory != ProgramMemory::default());

    // Assure we have no diagnostics.
    let diagnostics = server.diagnostics_map.get("file:///test.kcl").await.unwrap().clone();
    // Check the diagnostics.
    if let tower_lsp::lsp_types::DocumentDiagnosticReport::Full(ref diagnostics) = diagnostics {
        assert_eq!(diagnostics.full_document_diagnostic_report.items.len(), 0);
    } else {
        panic!("Expected full diagnostics");
    }

    // Clear ONLY the memory.
    server
        .memory_map
        .insert("file:///test.kcl".to_string(), ProgramMemory::default())
        .await;
    let memory = server.memory_map.get("file:///test.kcl").await.unwrap().clone();
    assert_eq!(memory, ProgramMemory::default());

    let units = server.executor_ctx().await.unwrap().settings.units;
    assert_eq!(units, crate::settings::types::UnitLength::Mm);

    // Update the units to the _same_ units.
    server
        .update_units(crate::lsp::kcl::custom_notifications::UpdateUnitsParams {
            text_document: crate::lsp::kcl::custom_notifications::TextDocumentIdentifier {
                uri: "file:///test.kcl".try_into().unwrap(),
            },
            units: crate::settings::types::UnitLength::Mm,
            text: code.to_string(),
        })
        .await
        .unwrap();
    server.wait_on_handle().await;

    let units = server.executor_ctx().await.unwrap().settings.units;
    assert_eq!(units, crate::settings::types::UnitLength::Mm);

    // Get the ast.
    let ast = server.ast_map.get("file:///test.kcl").await.unwrap().clone();
    assert!(ast != crate::ast::types::Program::default());
    // Get the memory.
    let memory = server.memory_map.get("file:///test.kcl").await.unwrap().clone();
    assert!(memory != ProgramMemory::default());

    // Assure we have no diagnostics.
    let diagnostics = server.diagnostics_map.get("file:///test.kcl").await.unwrap().clone();
    // Check the diagnostics.
    if let tower_lsp::lsp_types::DocumentDiagnosticReport::Full(diagnostics) = diagnostics {
        assert_eq!(diagnostics.full_document_diagnostic_report.items.len(), 0);
    } else {
        panic!("Expected full diagnostics");
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn serial_test_kcl_lsp_cant_execute_set() {
    let server = kcl_lsp_server(true).await.unwrap();

    let code = r#"const part001 = startSketchOn('XY')
  |> startProfileAt([-10, -10], %)
  |> line([20, 0], %)
  |> line([0, 20], %)
  |> line([-20, 0], %)
  |> close(%)
  |> extrude(3.14, %)"#;

    // Send open file.
    server
        .did_open(tower_lsp::lsp_types::DidOpenTextDocumentParams {
            text_document: tower_lsp::lsp_types::TextDocumentItem {
                uri: "file:///test.kcl".try_into().unwrap(),
                language_id: "kcl".to_string(),
                version: 1,
                text: code.to_string(),
            },
        })
        .await;
    server.wait_on_handle().await;

    // Get the ast.
    let ast = server.ast_map.get("file:///test.kcl").await.unwrap().clone();
    assert!(ast != crate::ast::types::Program::default());
    // Get the memory.
    let memory = server.memory_map.get("file:///test.kcl").await.unwrap().clone();
    assert!(memory != ProgramMemory::default());

    // Assure we have no diagnostics.
    let diagnostics = server.diagnostics_map.get("file:///test.kcl").await.unwrap().clone();
    // Check the diagnostics.
    if let tower_lsp::lsp_types::DocumentDiagnosticReport::Full(ref diagnostics) = diagnostics {
        assert_eq!(diagnostics.full_document_diagnostic_report.items.len(), 0);
    } else {
        panic!("Expected full diagnostics");
    }

    // Clear ONLY the memory.
    server
        .memory_map
        .insert("file:///test.kcl".to_string(), ProgramMemory::default())
        .await;
    let memory = server.memory_map.get("file:///test.kcl").await.unwrap().clone();
    assert_eq!(memory, ProgramMemory::default());

    // Update the units to the _same_ units.
    let units = server.executor_ctx().await.unwrap().settings.units;
    assert_eq!(units, crate::settings::types::UnitLength::Mm);
    server
        .update_units(crate::lsp::kcl::custom_notifications::UpdateUnitsParams {
            text_document: crate::lsp::kcl::custom_notifications::TextDocumentIdentifier {
                uri: "file:///test.kcl".try_into().unwrap(),
            },
            units: crate::settings::types::UnitLength::Mm,
            text: code.to_string(),
        })
        .await
        .unwrap();
    server.wait_on_handle().await;
    let units = server.executor_ctx().await.unwrap().settings.units;
    assert_eq!(units, crate::settings::types::UnitLength::Mm);

    // Get the ast.
    let ast = server.ast_map.get("file:///test.kcl").await.unwrap().clone();
    assert!(ast != crate::ast::types::Program::default());
    // Get the memory.
    let memory = server.memory_map.get("file:///test.kcl").await.unwrap().clone();
    assert!(memory != ProgramMemory::default());

    // Assure we have no diagnostics.
    let diagnostics = server.diagnostics_map.get("file:///test.kcl").await.unwrap().clone();
    // Check the diagnostics.
    if let tower_lsp::lsp_types::DocumentDiagnosticReport::Full(ref diagnostics) = diagnostics {
        assert_eq!(diagnostics.full_document_diagnostic_report.items.len(), 0);
    } else {
        panic!("Expected full diagnostics");
    }

    // Clear ONLY the memory.
    server
        .memory_map
        .insert("file:///test.kcl".to_string(), ProgramMemory::default())
        .await;
    let memory = server.memory_map.get("file:///test.kcl").await.unwrap().clone();
    assert_eq!(memory, ProgramMemory::default());

    assert_eq!(server.can_execute().await, true);

    // Set that we cannot execute.
    server
        .update_can_execute(crate::lsp::kcl::custom_notifications::UpdateCanExecuteParams { can_execute: false })
        .await
        .unwrap();
    assert_eq!(server.can_execute().await, false);

    // Update the units to the _same_ units.
    let units = server.executor_ctx().await.unwrap().settings.units;
    assert_eq!(units, crate::settings::types::UnitLength::Mm);
    server
        .update_units(crate::lsp::kcl::custom_notifications::UpdateUnitsParams {
            text_document: crate::lsp::kcl::custom_notifications::TextDocumentIdentifier {
                uri: "file:///test.kcl".try_into().unwrap(),
            },
            units: crate::settings::types::UnitLength::Mm,
            text: code.to_string(),
        })
        .await
        .unwrap();
    server.wait_on_handle().await;
    let units = server.executor_ctx().await.unwrap().settings.units;
    assert_eq!(units, crate::settings::types::UnitLength::Mm);

    // Get the ast.
    let ast = server.ast_map.get("file:///test.kcl").await.unwrap().clone();
    assert!(ast != crate::ast::types::Program::default());
    // Get the memory.
    let memory = server.memory_map.get("file:///test.kcl").await.unwrap().clone();
    // Now it should be the default memory.
    assert!(memory == ProgramMemory::default());

    // Assure we have no diagnostics.
    let diagnostics = server.diagnostics_map.get("file:///test.kcl").await.unwrap().clone();
    // Check the diagnostics.
    if let tower_lsp::lsp_types::DocumentDiagnosticReport::Full(ref diagnostics) = diagnostics {
        assert_eq!(diagnostics.full_document_diagnostic_report.items.len(), 0);
    } else {
        panic!("Expected full diagnostics");
    }

    // Set that we CAN execute.
    server
        .update_can_execute(crate::lsp::kcl::custom_notifications::UpdateCanExecuteParams { can_execute: true })
        .await
        .unwrap();
    assert_eq!(server.can_execute().await, true);

    // Update the units to the _same_ units.
    let units = server.executor_ctx.read().await.clone().unwrap().settings.units;
    assert_eq!(units, crate::settings::types::UnitLength::Mm);
    server
        .update_units(crate::lsp::kcl::custom_notifications::UpdateUnitsParams {
            text_document: crate::lsp::kcl::custom_notifications::TextDocumentIdentifier {
                uri: "file:///test.kcl".try_into().unwrap(),
            },
            units: crate::settings::types::UnitLength::Mm,
            text: code.to_string(),
        })
        .await
        .unwrap();
    server.wait_on_handle().await;
    let units = server.executor_ctx.read().await.clone().unwrap().settings.units;
    assert_eq!(units, crate::settings::types::UnitLength::Mm);

    // Get the ast.
    let ast = server.ast_map.get("file:///test.kcl").await.unwrap().clone();
    assert!(ast != crate::ast::types::Program::default());
    // Get the memory.
    let memory = server.memory_map.get("file:///test.kcl").await.unwrap().clone();
    // Now it should NOT be the default memory.
    assert!(memory != ProgramMemory::default());

    // Assure we have no diagnostics.
    let diagnostics = server.diagnostics_map.get("file:///test.kcl").await.unwrap();
    // Check the diagnostics.
    if let tower_lsp::lsp_types::DocumentDiagnosticReport::Full(ref diagnostics) = diagnostics {
        assert_eq!(diagnostics.full_document_diagnostic_report.items.len(), 0);
    } else {
        panic!("Expected full diagnostics");
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn test_kcl_lsp_folding() {
    let server = kcl_lsp_server(false).await.unwrap();

    // Send open file.
    server
        .did_open(tower_lsp::lsp_types::DidOpenTextDocumentParams {
            text_document: tower_lsp::lsp_types::TextDocumentItem {
                uri: "file:///test.kcl".try_into().unwrap(),
                language_id: "kcl".to_string(),
                version: 1,
                text: r#"startSketchOn('XY')
                    |> startProfileAt([0,0], %)"#
                    .to_string(),
            },
        })
        .await;
    server.wait_on_handle().await;

    // Send folding request.
    let folding = server
        .folding_range(tower_lsp::lsp_types::FoldingRangeParams {
            text_document: tower_lsp::lsp_types::TextDocumentIdentifier {
                uri: "file:///test.kcl".try_into().unwrap(),
            },
            work_done_progress_params: Default::default(),
            partial_result_params: Default::default(),
        })
        .await
        .unwrap()
        .unwrap();

    // Check the folding.
    assert_eq!(folding.len(), 1);
    assert_eq!(
        folding.first().unwrap().clone(),
        tower_lsp::lsp_types::FoldingRange {
            start_line: 19,
            start_character: None,
            end_line: 67,
            end_character: None,
            kind: Some(tower_lsp::lsp_types::FoldingRangeKind::Region),
            collapsed_text: Some("startSketchOn('XY')".to_string()),
        }
    );
}
