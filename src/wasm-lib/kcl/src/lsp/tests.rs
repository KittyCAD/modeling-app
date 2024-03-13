use std::sync::{Arc, RwLock};

use anyhow::Result;
use pretty_assertions::assert_eq;
use tower_lsp::LanguageServer;

// Create a fake kcl lsp server for testing.
fn kcl_lsp_server() -> Result<crate::lsp::kcl::Backend> {
    let stdlib = crate::std::StdLib::new();
    let stdlib_completions = crate::lsp::kcl::get_completions_from_stdlib(&stdlib)?;
    let stdlib_signatures = crate::lsp::kcl::get_signatures_from_stdlib(&stdlib)?;
    // We can unwrap here because we know the tokeniser is valid, since
    // we have a test for it.
    let token_types = crate::token::TokenType::all_semantic_token_types().unwrap();

    // We don't actually need to authenticate to the backend for this test.
    let mut zoo_client = kittycad::Client::new("");
    zoo_client.set_base_url("https://api.dev.zoo.dev");

    // Create the backend.
    let (service, _) = tower_lsp::LspService::new(|client| crate::lsp::kcl::Backend {
        client,
        fs: crate::fs::FileManager::new(),
        workspace_folders: Default::default(),
        stdlib_completions,
        stdlib_signatures,
        token_types,
        token_map: Default::default(),
        ast_map: Default::default(),
        current_code_map: Default::default(),
        diagnostics_map: Default::default(),
        symbols_map: Default::default(),
        semantic_tokens_map: Default::default(),
        zoo_client,
        can_send_telemetry: true,
    });
    let server = service.inner();

    Ok(server.clone())
}

// Create a fake copilot lsp server for testing.
fn copilot_lsp_server() -> Result<crate::lsp::copilot::Backend> {
    // We don't actually need to authenticate to the backend for this test.
    let mut zoo_client = kittycad::Client::new("");
    zoo_client.set_base_url("https://api.dev.zoo.dev");

    // Create the backend.
    let (service, _) = tower_lsp::LspService::new(|client| crate::lsp::copilot::Backend {
        client,
        fs: crate::fs::FileManager::new(),
        workspace_folders: Default::default(),
        current_code_map: Default::default(),
        zoo_client,
        editor_info: Arc::new(RwLock::new(crate::lsp::copilot::types::CopilotEditorInfo::default())),
        cache: Arc::new(crate::lsp::copilot::cache::CopilotCache::new()),
    });
    let server = service.inner();

    Ok(server.clone())
}

#[tokio::test]
async fn test_updating_kcl_lsp_files() {
    let server = kcl_lsp_server().unwrap();

    assert_eq!(server.current_code_map.len(), 0);

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

    // Get the workspace folders.
    assert_eq!(server.workspace_folders.len(), 1);
    assert_eq!(
        server.workspace_folders.get("my-project").unwrap().value().clone(),
        tower_lsp::lsp_types::WorkspaceFolder {
            uri: string_path.as_str().try_into().unwrap(),
            name: "my-project".to_string(),
        }
    );

    assert_eq!(server.current_code_map.len(), 8);

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

    // Check the code map.
    assert_eq!(server.current_code_map.len(), 9);
    assert_eq!(
        server.current_code_map.get("file:///test.kcl").unwrap().value(),
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
    assert_eq!(server.current_code_map.len(), 9);
    assert_eq!(
        server.current_code_map.get("file:///test.kcl").unwrap().value(),
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

    // Check the code map.
    assert_eq!(server.current_code_map.len(), 10);
    assert_eq!(
        server.current_code_map.get("file:///test.kcl").unwrap().value(),
        "test".as_bytes()
    );
    assert_eq!(
        server.current_code_map.get("file:///test2.kcl").unwrap().value(),
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

    // Check the code map.
    assert_eq!(server.current_code_map.len(), 10);
    assert_eq!(
        server.current_code_map.get("file:///test.kcl").unwrap().value(),
        "test".as_bytes()
    );
    assert_eq!(
        server.current_code_map.get("file:///test2.kcl").unwrap().value(),
        "changed".as_bytes()
    );

    // Rename a file.
    server
        .did_rename_files(tower_lsp::lsp_types::RenameFilesParams {
            files: vec![tower_lsp::lsp_types::FileRename {
                old_uri: "file:///test2.kcl".try_into().unwrap(),
                new_uri: "file:///test3.kcl".try_into().unwrap(),
            }],
        })
        .await;

    // Check the code map.
    assert_eq!(server.current_code_map.len(), 10);
    assert_eq!(
        server.current_code_map.get("file:///test.kcl").unwrap().value(),
        "test".as_bytes()
    );
    assert_eq!(
        server.current_code_map.get("file:///test3.kcl").unwrap().value(),
        "changed".as_bytes()
    );

    // Create a file.
    server
        .did_create_files(tower_lsp::lsp_types::CreateFilesParams {
            files: vec![tower_lsp::lsp_types::FileCreate {
                uri: "file:///test4.kcl".try_into().unwrap(),
            }],
        })
        .await;

    // Check the code map.
    assert_eq!(server.current_code_map.len(), 11);
    assert_eq!(
        server.current_code_map.get("file:///test.kcl").unwrap().value(),
        "test".as_bytes()
    );
    assert_eq!(
        server.current_code_map.get("file:///test3.kcl").unwrap().value(),
        "changed".as_bytes()
    );
    assert_eq!(
        server.current_code_map.get("file:///test4.kcl").unwrap().value(),
        "".as_bytes()
    );

    // Delete a file.
    server
        .did_delete_files(tower_lsp::lsp_types::DeleteFilesParams {
            files: vec![tower_lsp::lsp_types::FileDelete {
                uri: "file:///test4.kcl".try_into().unwrap(),
            }],
        })
        .await;

    // Check the code map.
    assert_eq!(server.current_code_map.len(), 10);
    assert_eq!(
        server.current_code_map.get("file:///test.kcl").unwrap().value(),
        "test".as_bytes()
    );
    assert_eq!(
        server.current_code_map.get("file:///test3.kcl").unwrap().value(),
        "changed".as_bytes()
    );

    // If we are adding the same folder we already had we should not nuke the current_code_map.
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

    // Get the workspace folders.
    assert_eq!(server.workspace_folders.len(), 1);
    assert_eq!(
        server.workspace_folders.get("my-project").unwrap().value().clone(),
        tower_lsp::lsp_types::WorkspaceFolder {
            uri: string_path.as_str().try_into().unwrap(),
            name: "my-project".to_string(),
        }
    );

    // Check the code map.
    assert_eq!(server.current_code_map.len(), 10);
    assert_eq!(
        server.current_code_map.get("file:///test.kcl").unwrap().value(),
        "test".as_bytes()
    );
    assert_eq!(
        server.current_code_map.get("file:///test3.kcl").unwrap().value(),
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

    // Get the workspace folders.
    assert_eq!(server.workspace_folders.len(), 1);
    assert_eq!(
        server.workspace_folders.get("my-project2").unwrap().value().clone(),
        tower_lsp::lsp_types::WorkspaceFolder {
            uri: string_path.as_str().try_into().unwrap(),
            name: "my-project2".to_string(),
        }
    );
    assert_eq!(server.current_code_map.len(), 8);
    // Just make sure that one of the current files read from disk is accurate.
    assert_eq!(
        server
            .current_code_map
            .get(&format!("{}/util.rs", string_path))
            .unwrap()
            .value(),
        include_str!("util.rs").as_bytes()
    );
}

#[tokio::test]
async fn test_updating_copilot_lsp_files() {
    let server = copilot_lsp_server().unwrap();

    assert_eq!(server.current_code_map.len(), 0);

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

    // Get the workspace folders.
    assert_eq!(server.workspace_folders.len(), 1);
    assert_eq!(
        server.workspace_folders.get("my-project").unwrap().value().clone(),
        tower_lsp::lsp_types::WorkspaceFolder {
            uri: string_path.as_str().try_into().unwrap(),
            name: "my-project".to_string(),
        }
    );

    assert_eq!(server.current_code_map.len(), 8);

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

    // Check the code map.
    assert_eq!(server.current_code_map.len(), 9);
    assert_eq!(
        server.current_code_map.get("file:///test.kcl").unwrap().value(),
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
    assert_eq!(server.current_code_map.len(), 9);
    assert_eq!(
        server.current_code_map.get("file:///test.kcl").unwrap().value(),
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

    // Check the code map.
    assert_eq!(server.current_code_map.len(), 10);
    assert_eq!(
        server.current_code_map.get("file:///test.kcl").unwrap().value(),
        "test".as_bytes()
    );
    assert_eq!(
        server.current_code_map.get("file:///test2.kcl").unwrap().value(),
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

    // Check the code map.
    assert_eq!(server.current_code_map.len(), 10);
    assert_eq!(
        server.current_code_map.get("file:///test.kcl").unwrap().value(),
        "test".as_bytes()
    );
    assert_eq!(
        server.current_code_map.get("file:///test2.kcl").unwrap().value(),
        "changed".as_bytes()
    );

    // Rename a file.
    server
        .did_rename_files(tower_lsp::lsp_types::RenameFilesParams {
            files: vec![tower_lsp::lsp_types::FileRename {
                old_uri: "file:///test2.kcl".try_into().unwrap(),
                new_uri: "file:///test3.kcl".try_into().unwrap(),
            }],
        })
        .await;

    // Check the code map.
    assert_eq!(server.current_code_map.len(), 10);
    assert_eq!(
        server.current_code_map.get("file:///test.kcl").unwrap().value(),
        "test".as_bytes()
    );
    assert_eq!(
        server.current_code_map.get("file:///test3.kcl").unwrap().value(),
        "changed".as_bytes()
    );

    // Create a file.
    server
        .did_create_files(tower_lsp::lsp_types::CreateFilesParams {
            files: vec![tower_lsp::lsp_types::FileCreate {
                uri: "file:///test4.kcl".try_into().unwrap(),
            }],
        })
        .await;

    // Check the code map.
    assert_eq!(server.current_code_map.len(), 11);
    assert_eq!(
        server.current_code_map.get("file:///test.kcl").unwrap().value(),
        "test".as_bytes()
    );
    assert_eq!(
        server.current_code_map.get("file:///test3.kcl").unwrap().value(),
        "changed".as_bytes()
    );
    assert_eq!(
        server.current_code_map.get("file:///test4.kcl").unwrap().value(),
        "".as_bytes()
    );

    // Delete a file.
    server
        .did_delete_files(tower_lsp::lsp_types::DeleteFilesParams {
            files: vec![tower_lsp::lsp_types::FileDelete {
                uri: "file:///test4.kcl".try_into().unwrap(),
            }],
        })
        .await;

    // Check the code map.
    assert_eq!(server.current_code_map.len(), 10);
    assert_eq!(
        server.current_code_map.get("file:///test.kcl").unwrap().value(),
        "test".as_bytes()
    );
    assert_eq!(
        server.current_code_map.get("file:///test3.kcl").unwrap().value(),
        "changed".as_bytes()
    );

    // If we are adding the same folder we already had we should not nuke the current_code_map.
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

    // Get the workspace folders.
    assert_eq!(server.workspace_folders.len(), 1);
    assert_eq!(
        server.workspace_folders.get("my-project").unwrap().value().clone(),
        tower_lsp::lsp_types::WorkspaceFolder {
            uri: string_path.as_str().try_into().unwrap(),
            name: "my-project".to_string(),
        }
    );

    // Check the code map.
    assert_eq!(server.current_code_map.len(), 10);
    assert_eq!(
        server.current_code_map.get("file:///test.kcl").unwrap().value(),
        "test".as_bytes()
    );
    assert_eq!(
        server.current_code_map.get("file:///test3.kcl").unwrap().value(),
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

    // Get the workspace folders.
    assert_eq!(server.workspace_folders.len(), 1);
    assert_eq!(
        server.workspace_folders.get("my-project").unwrap().value().clone(),
        tower_lsp::lsp_types::WorkspaceFolder {
            uri: string_path.as_str().try_into().unwrap(),
            name: "my-project".to_string(),
        }
    );

    // Check the code map.
    assert_eq!(server.current_code_map.len(), 10);
    assert_eq!(
        server.current_code_map.get("file:///test.kcl").unwrap().value(),
        "test".as_bytes()
    );
    assert_eq!(
        server.current_code_map.get("file:///test3.kcl").unwrap().value(),
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

    // Get the workspace folders.
    assert_eq!(server.workspace_folders.len(), 1);
    assert_eq!(
        server.workspace_folders.get("my-project2").unwrap().value().clone(),
        tower_lsp::lsp_types::WorkspaceFolder {
            uri: string_path.as_str().try_into().unwrap(),
            name: "my-project2".to_string(),
        }
    );
    assert_eq!(server.current_code_map.len(), 8);
}
