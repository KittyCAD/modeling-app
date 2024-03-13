use std::{
    collections::BTreeMap,
    sync::{Arc, RwLock},
};

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
    let zoo_client = kittycad::Client::new_from_env();

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
                old_uri: "file:///test2.kcl".into(),
                new_uri: "file:///test3.kcl".into(),
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
                uri: "file:///test4.kcl".into(),
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
                uri: "file:///test4.kcl".into(),
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
                old_uri: "file:///test2.kcl".into(),
                new_uri: "file:///test3.kcl".into(),
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
                uri: "file:///test4.kcl".into(),
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
                uri: "file:///test4.kcl".into(),
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

#[tokio::test]
async fn test_kcl_lsp_create_zip() {
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

    // Create a zip.
    let bytes = server.create_zip().unwrap();
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

    assert_eq!(files.len(), 9);
    let util_path = format!("{}/util.rs", string_path).replace("file://", "");
    assert!(files.get(&util_path).is_some());
    assert_eq!(files.get("/test.kcl"), Some(&4));
}

#[tokio::test]
async fn test_kcl_lsp_completions() {
    let server = kcl_lsp_server().unwrap();

    // Send open file.
    server
        .did_open(tower_lsp::lsp_types::DidOpenTextDocumentParams {
            text_document: tower_lsp::lsp_types::TextDocumentItem {
                uri: "file:///test.kcl".try_into().unwrap(),
                language_id: "kcl".to_string(),
                version: 1,
                text: "st".to_string(),
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
                position: tower_lsp::lsp_types::Position { line: 0, character: 1 },
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

#[tokio::test]
async fn test_kcl_lsp_on_hover() {
    let server = kcl_lsp_server().unwrap();

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

#[tokio::test]
async fn test_kcl_lsp_signature_help() {
    let server = kcl_lsp_server().unwrap();

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

#[tokio::test]
async fn test_kcl_lsp_semantic_tokens() {
    let server = kcl_lsp_server().unwrap();

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
        assert_eq!(semantic_tokens.data[0].token_type, 7);
        assert_eq!(semantic_tokens.data[1].length, 4);
        assert_eq!(semantic_tokens.data[1].delta_start, 14);
        assert_eq!(semantic_tokens.data[1].token_type, 3);
    } else {
        panic!("Expected semantic tokens");
    }
}

#[tokio::test]
async fn test_kcl_lsp_document_symbol() {
    let server = kcl_lsp_server().unwrap();

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
        assert_eq!(document_symbol[0].name, "startSketchOn");
    } else {
        panic!("Expected document symbol");
    }
}

#[tokio::test]
async fn test_kcl_lsp_formatting() {
    let server = kcl_lsp_server().unwrap();

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

#[tokio::test]
async fn test_kcl_lsp_rename() {
    let server = kcl_lsp_server().unwrap();

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

#[tokio::test]
async fn test_kcl_lsp_diagnostic_no_errors() {
    let server = kcl_lsp_server().unwrap();

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

#[tokio::test]
async fn test_kcl_lsp_diagnostic_has_errors() {
    let server = kcl_lsp_server().unwrap();

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

#[tokio::test]
async fn test_copilot_lsp_set_editor_info() {
    let server = copilot_lsp_server().unwrap();

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
    // Aquire the lock.
    let editor_info = server.editor_info.read().unwrap();
    assert_eq!(editor_info.editor_info.name, "vscode");
    assert_eq!(editor_info.editor_info.version, "1.0.0");
}

#[tokio::test]
async fn test_copilot_lsp_completions() {
    let server = copilot_lsp_server().unwrap();

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

    // Send completion request.
    let completions = server
        .get_completions(
            "kcl".to_string(),
            r#"// Create a cube.
fn cube = (pos, scale) => {
  const sg = startSketchOn('XY')
    |> startProfileAt(pos, %)
    |> line([0, scale], %)
    |> line([scale, 0], %)
    |> line([0, -scale], %)

  return sg
}

const part001 = cube([0,0], 20)
    |> close(%)
    |> extrude(20, %)

"#
            .to_string(),
            r#""#.to_string(),
        )
        .await
        .unwrap();

    // Check the completions.
    assert_eq!(completions.len(), 1);
    println!("got completion:\n```\n{}\n```", completions[0]);
}
