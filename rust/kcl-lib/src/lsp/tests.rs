use std::collections::{BTreeMap, HashMap};

use pretty_assertions::assert_eq;
use tower_lsp::{
    LanguageServer,
    lsp_types::{
        CodeActionKind, CodeActionOrCommand, Diagnostic, PrepareRenameResponse, SemanticTokenModifier,
        SemanticTokenType, TextEdit, WorkspaceEdit,
    },
};

use crate::{
    SourceRange,
    errors::{LspSuggestion, Suggestion},
    lsp::test_util::{copilot_lsp_server, kcl_lsp_server},
    parsing::ast::types::{Node, Program},
};

#[track_caller]
fn assert_diagnostic_count(diagnostics: Option<&Vec<Diagnostic>>, n: usize) {
    let Some(diagnostics) = diagnostics else {
        assert_eq!(n, 0, "No diagnostics");
        return;
    };
    assert_eq!(
        diagnostics
            .iter()
            .filter(|d| d.severity.as_ref().unwrap() != &tower_lsp::lsp_types::DiagnosticSeverity::WARNING)
            .count(),
        n,
        "expected {n} errors, found {diagnostics:#?}"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 12)]
async fn test_updating_kcl_lsp_files() {
    let server = kcl_lsp_server(false).await.unwrap();

    assert_eq!(server.code_map.len(), 0);

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
        server.workspace_folders.get("my-project").unwrap().clone(),
        tower_lsp::lsp_types::WorkspaceFolder {
            uri: string_path.as_str().try_into().unwrap(),
            name: "my-project".to_string()
        }
    );

    assert_eq!(server.code_map.len(), 11);

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
    assert_eq!(server.code_map.len(), 12);
    assert_eq!(
        server.code_map.get("file:///test.kcl").unwrap().clone(),
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
    assert_eq!(server.code_map.len(), 12);
    assert_eq!(
        server.code_map.get("file:///test.kcl").unwrap().clone(),
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
    assert_eq!(server.code_map.len(), 13);
    assert_eq!(
        server.code_map.get("file:///test.kcl").unwrap().clone(),
        "test".as_bytes()
    );
    assert_eq!(
        server.code_map.get("file:///test2.kcl").unwrap().clone(),
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
    assert_eq!(server.code_map.len(), 13);
    assert_eq!(
        server.code_map.get("file:///test.kcl").unwrap().clone(),
        "test".as_bytes()
    );
    assert_eq!(
        server.code_map.get("file:///test2.kcl").unwrap().clone(),
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
    assert_eq!(server.code_map.len(), 13);
    assert_eq!(
        server.code_map.get("file:///test.kcl").unwrap().clone(),
        "test".as_bytes()
    );
    assert_eq!(
        server.code_map.get("file:///test3.kcl").unwrap().clone(),
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
    assert_eq!(server.code_map.len(), 14);
    assert_eq!(
        server.code_map.get("file:///test.kcl").unwrap().clone(),
        "test".as_bytes()
    );
    assert_eq!(
        server.code_map.get("file:///test3.kcl").unwrap().clone(),
        "changed".as_bytes()
    );
    assert_eq!(server.code_map.get("file:///test4.kcl").unwrap().clone(), "".as_bytes());

    // Delete a file.
    server
        .did_delete_files(tower_lsp::lsp_types::DeleteFilesParams {
            files: vec![tower_lsp::lsp_types::FileDelete {
                uri: "file:///test4.kcl".into(),
            }],
        })
        .await;

    // Check the code map.
    assert_eq!(server.code_map.len(), 13);
    assert_eq!(
        server.code_map.get("file:///test.kcl").unwrap().clone(),
        "test".as_bytes()
    );
    assert_eq!(
        server.code_map.get("file:///test3.kcl").unwrap().clone(),
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

    // Get the workspace folders.
    assert_eq!(server.workspace_folders.len(), 1);
    assert_eq!(
        server.workspace_folders.get("my-project").unwrap().clone(),
        tower_lsp::lsp_types::WorkspaceFolder {
            uri: string_path.as_str().try_into().unwrap(),
            name: "my-project".to_string()
        }
    );

    // Check the code map.
    assert_eq!(server.code_map.len(), 13);
    assert_eq!(
        server.code_map.get("file:///test.kcl").unwrap().clone(),
        "test".as_bytes()
    );
    assert_eq!(
        server.code_map.get("file:///test3.kcl").unwrap().clone(),
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
        server.workspace_folders.get("my-project2").unwrap().clone(),
        tower_lsp::lsp_types::WorkspaceFolder {
            uri: string_path.as_str().try_into().unwrap(),
            name: "my-project2".to_string()
        }
    );
    assert_eq!(server.code_map.len(), 11);
    // Just make sure that one of the current files read from disk is accurate.
    assert_eq!(
        server.code_map.get(&format!("{string_path}/util.rs")).unwrap().clone(),
        include_str!("util.rs").as_bytes()
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn test_updating_copilot_lsp_files() {
    let server = copilot_lsp_server().await.unwrap();

    assert_eq!(server.code_map.len(), 0);

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
        server.workspace_folders.get("my-project").unwrap().clone(),
        tower_lsp::lsp_types::WorkspaceFolder {
            uri: string_path.as_str().try_into().unwrap(),
            name: "my-project".to_string()
        }
    );

    assert_eq!(server.code_map.len(), 11);

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
    assert_eq!(server.code_map.len(), 12);
    assert_eq!(
        server.code_map.get("file:///test.kcl").unwrap().clone(),
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
    assert_eq!(server.code_map.len(), 12);
    assert_eq!(
        server.code_map.get("file:///test.kcl").unwrap().clone(),
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
    assert_eq!(server.code_map.len(), 13);
    assert_eq!(
        server.code_map.get("file:///test.kcl").unwrap().clone(),
        "test".as_bytes()
    );
    assert_eq!(
        server.code_map.get("file:///test2.kcl").unwrap().clone(),
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
    assert_eq!(server.code_map.len(), 13);
    assert_eq!(
        server.code_map.get("file:///test.kcl").unwrap().clone(),
        "test".as_bytes()
    );
    assert_eq!(
        server.code_map.get("file:///test2.kcl").unwrap().clone(),
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
    assert_eq!(server.code_map.len(), 13);
    assert_eq!(
        server.code_map.get("file:///test.kcl").unwrap().clone(),
        "test".as_bytes()
    );
    assert_eq!(
        server.code_map.get("file:///test3.kcl").unwrap().clone(),
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
    assert_eq!(server.code_map.len(), 14);
    assert_eq!(
        server.code_map.get("file:///test.kcl").unwrap().clone(),
        "test".as_bytes()
    );
    assert_eq!(
        server.code_map.get("file:///test3.kcl").unwrap().clone(),
        "changed".as_bytes()
    );
    assert_eq!(server.code_map.get("file:///test4.kcl").unwrap().clone(), "".as_bytes());

    // Delete a file.
    server
        .did_delete_files(tower_lsp::lsp_types::DeleteFilesParams {
            files: vec![tower_lsp::lsp_types::FileDelete {
                uri: "file:///test4.kcl".into(),
            }],
        })
        .await;

    // Check the code map.
    assert_eq!(server.code_map.len(), 13);
    assert_eq!(
        server.code_map.get("file:///test.kcl").unwrap().clone(),
        "test".as_bytes()
    );
    assert_eq!(
        server.code_map.get("file:///test3.kcl").unwrap().clone(),
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

    // Get the workspace folders.
    assert_eq!(server.workspace_folders.len(), 1);
    assert_eq!(
        server.workspace_folders.get("my-project").unwrap().clone(),
        tower_lsp::lsp_types::WorkspaceFolder {
            uri: string_path.as_str().try_into().unwrap(),
            name: "my-project".to_string()
        }
    );

    // Check the code map.
    assert_eq!(server.code_map.len(), 13);
    assert_eq!(
        server.code_map.get("file:///test.kcl").unwrap().clone(),
        "test".as_bytes()
    );
    assert_eq!(
        server.code_map.get("file:///test3.kcl").unwrap().clone(),
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
        server.workspace_folders.get("my-project").unwrap().clone(),
        tower_lsp::lsp_types::WorkspaceFolder {
            uri: string_path.as_str().try_into().unwrap(),
            name: "my-project".to_string()
        }
    );

    // Check the code map.
    assert_eq!(server.code_map.len(), 13);
    assert_eq!(
        server.code_map.get("file:///test.kcl").unwrap().clone(),
        "test".as_bytes()
    );
    assert_eq!(
        server.code_map.get("file:///test3.kcl").unwrap().clone(),
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
        server.workspace_folders.get("my-project2").unwrap().clone(),
        tower_lsp::lsp_types::WorkspaceFolder {
            uri: string_path.as_str().try_into().unwrap(),
            name: "my-project2".to_string()
        }
    );
    assert_eq!(server.code_map.len(), 11);
}

#[tokio::test(flavor = "multi_thread")]
async fn test_kcl_lsp_create_zip() {
    let server = kcl_lsp_server(false).await.unwrap();

    assert_eq!(server.code_map.len(), 0);

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
        server.workspace_folders.get("my-project").unwrap().clone(),
        tower_lsp::lsp_types::WorkspaceFolder {
            uri: string_path.as_str().try_into().unwrap(),
            name: "my-project".to_string()
        }
    );

    assert_eq!(server.code_map.len(), 11);

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
    assert_eq!(server.code_map.len(), 12);
    assert_eq!(
        server.code_map.get("file:///test.kcl").unwrap().clone(),
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

    assert_eq!(files.len(), 12);
    let util_path = format!("{string_path}/util.rs").replace("file://", "");
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
                // Blank lines to check that we get completions even in an AST newline thing.
                text: r#"
                
thing= 1
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
                position: tower_lsp::lsp_types::Position { line: 0, character: 0 },
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
        assert!(completions.iter().any(|c| c.label == "@settings"));
    } else {
        panic!("Expected array of completions");
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn test_kcl_lsp_completions_empty_in_comment() {
    let server = kcl_lsp_server(false).await.unwrap();

    // Send open file.
    server
        .did_open(tower_lsp::lsp_types::DidOpenTextDocumentParams {
            text_document: tower_lsp::lsp_types::TextDocumentItem {
                uri: "file:///test.kcl".try_into().unwrap(),
                language_id: "kcl".to_string(),
                version: 1,
                text: r#"thing= 1 // st"#.to_string(),
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
                position: tower_lsp::lsp_types::Position { line: 0, character: 13 },
            },
            context: None,
            partial_result_params: Default::default(),
            work_done_progress_params: Default::default(),
        })
        .await
        .unwrap();

    assert!(completions.is_none());
}

#[tokio::test(flavor = "multi_thread")]
async fn test_kcl_lsp_completions_tags() {
    let server = kcl_lsp_server(false).await.unwrap();

    // Send open file.
    server
        .did_open(tower_lsp::lsp_types::DidOpenTextDocumentParams {
            text_document: tower_lsp::lsp_types::TextDocumentItem {
                uri: "file:///test.kcl".try_into().unwrap(),
                language_id: "kcl".to_string(),
                version: 1,
                text: r#"part001 = startSketchOn(XY)
  |> startProfile(at = [11.19, 28.35])
  |> line(end = [28.67, -13.25], tag = $here)
  |> line(end = [-4.12, -22.81])
  |> line(end = [-33.24, 14.55])
  |> close()
  |> extrude(length = 5)"#
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
                position: tower_lsp::lsp_types::Position {
                    line: 0,
                    character: 198,
                },
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
        // Make sure that `here` is in the completions.
        let const_completion = completions
            .iter()
            .find(|completion| completion.label == "here")
            .unwrap();
        assert_eq!(
            const_completion.kind,
            Some(tower_lsp::lsp_types::CompletionItemKind::REFERENCE)
        );
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
        // Find the one with label "fn".
        let const_completion = completions.iter().find(|completion| completion.label == "fn").unwrap();
        assert_eq!(
            const_completion.kind,
            Some(tower_lsp::lsp_types::CompletionItemKind::KEYWORD)
        );
    } else {
        panic!("Expected array of completions");
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn test_kcl_lsp_completions_import() {
    let server = kcl_lsp_server(false).await.unwrap();

    // Send open file.
    server
        .did_open(tower_lsp::lsp_types::DidOpenTextDocumentParams {
            text_document: tower_lsp::lsp_types::TextDocumentItem {
                uri: "file:///test.kcl".try_into().unwrap(),
                language_id: "kcl".to_string(),
                version: 1,
                text: r#"import boo, baz as bux from 'bar.kcl'
//import 'bar.kcl'
x = b"#
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
                position: tower_lsp::lsp_types::Position { line: 2, character: 5 },
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
        // Find the one with label "foo".
        completions.iter().find(|completion| completion.label == "boo").unwrap();
        // completions
        //     .iter()
        //     .find(|completion| completion.label == "bar")
        //     .unwrap();
        completions.iter().find(|completion| completion.label == "bux").unwrap();
        assert!(!completions.iter().any(|completion| completion.label == "baz"));
        // Find the one with label "bar".
    } else {
        panic!("Expected array of completions");
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn test_kcl_lsp_on_hover() {
    let server = kcl_lsp_server(true).await.unwrap();

    // Send open file.
    server
        .did_open(tower_lsp::lsp_types::DidOpenTextDocumentParams {
            text_document: tower_lsp::lsp_types::TextDocumentItem {
                uri: "file:///test.kcl".try_into().unwrap(),
                language_id: "kcl".to_string(),
                version: 1,
                text: r#"startSketchOn(XY)
foo = 42
foo

fn bar(@x: string): string {
  return x
}

bar("an arg")

startSketchOn(XY)
  |> startProfile(at = [0, 0])
  |> line(end = [10, 0])
  |> line(end = [0, 10])
"#
                .to_string(),
            },
        })
        .await;

    // Std lib call
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

    match hover.unwrap().contents {
        tower_lsp::lsp_types::HoverContents::Markup(tower_lsp::lsp_types::MarkupContent { value, .. }) => {
            assert!(value.contains("startSketchOn"));
            assert!(value.contains(": Plane | Face"));
            assert!(value.contains("Start a new 2-dimensional sketch on a specific"));
        }
        _ => unreachable!(),
    }

    // Variable use
    let hover = server
        .hover(tower_lsp::lsp_types::HoverParams {
            text_document_position_params: tower_lsp::lsp_types::TextDocumentPositionParams {
                text_document: tower_lsp::lsp_types::TextDocumentIdentifier {
                    uri: "file:///test.kcl".try_into().unwrap(),
                },
                position: tower_lsp::lsp_types::Position { line: 2, character: 1 },
            },
            work_done_progress_params: Default::default(),
        })
        .await
        .unwrap();

    match hover.unwrap().contents {
        tower_lsp::lsp_types::HoverContents::Markup(tower_lsp::lsp_types::MarkupContent { value, .. }) => {
            assert!(value.contains("foo: number = 42"));
        }
        _ => unreachable!(),
    }

    // User-defined function call.
    let hover = server
        .hover(tower_lsp::lsp_types::HoverParams {
            text_document_position_params: tower_lsp::lsp_types::TextDocumentPositionParams {
                text_document: tower_lsp::lsp_types::TextDocumentIdentifier {
                    uri: "file:///test.kcl".try_into().unwrap(),
                },
                position: tower_lsp::lsp_types::Position { line: 8, character: 1 },
            },
            work_done_progress_params: Default::default(),
        })
        .await
        .unwrap();

    match hover.unwrap().contents {
        tower_lsp::lsp_types::HoverContents::Markup(tower_lsp::lsp_types::MarkupContent { value, .. }) => {
            assert!(value.contains("bar(@x: string): string"));
        }
        _ => unreachable!(),
    }

    // Variable inside a function
    let hover = server
        .hover(tower_lsp::lsp_types::HoverParams {
            text_document_position_params: tower_lsp::lsp_types::TextDocumentPositionParams {
                text_document: tower_lsp::lsp_types::TextDocumentIdentifier {
                    uri: "file:///test.kcl".try_into().unwrap(),
                },
                position: tower_lsp::lsp_types::Position { line: 5, character: 9 },
            },
            work_done_progress_params: Default::default(),
        })
        .await
        .unwrap();

    match hover.unwrap().contents {
        tower_lsp::lsp_types::HoverContents::Markup(tower_lsp::lsp_types::MarkupContent { value, .. }) => {
            assert!(value.contains("x: string"));
        }
        _ => unreachable!(),
    }

    // std function KwArg
    let hover = server
        .hover(tower_lsp::lsp_types::HoverParams {
            text_document_position_params: tower_lsp::lsp_types::TextDocumentPositionParams {
                text_document: tower_lsp::lsp_types::TextDocumentIdentifier {
                    uri: "file:///test.kcl".try_into().unwrap(),
                },
                position: tower_lsp::lsp_types::Position {
                    line: 12,
                    character: 11,
                },
            },
            work_done_progress_params: Default::default(),
        })
        .await
        .unwrap();

    match hover.unwrap().contents {
        tower_lsp::lsp_types::HoverContents::Markup(tower_lsp::lsp_types::MarkupContent { value, .. }) => {
            assert!(value.contains("end?: Point2d"));
            assert!(value.contains("How far away (along the X and Y axes) should this line go?"));
        }
        _ => unreachable!(),
    }

    server.executor_ctx().await.clone().unwrap().close().await;
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
                text: "startSketchOn(XY)".to_string(),
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
        assert!(signature_help.signatures[0].label.starts_with("startSketchOn"));
    } else {
        panic!("Expected signature help");
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn test_kcl_lsp_signature_help_on_parens_trigger() {
    let server = kcl_lsp_server(false).await.unwrap();

    // Send open file.
    // We do this to trigger a valid ast.
    server
        .did_change(tower_lsp::lsp_types::DidChangeTextDocumentParams {
            text_document: tower_lsp::lsp_types::VersionedTextDocumentIdentifier {
                uri: "file:///test.kcl".try_into().unwrap(),
                version: 1,
            },
            content_changes: vec![tower_lsp::lsp_types::TextDocumentContentChangeEvent {
                range: None,
                range_length: None,
                text: "myVarName = 100

a1 = startSketchOn(offsetPlane(XY, offset = 10))
  |> startProfile(at = [0, 0])
  |> line(end = [myVarName, 0])
  |> yLine(length = -100.0)
  |> xLine(length = -100.0)
  |> yLine(length = 100.0)
  |> close()"
                    .to_string(),
            }],
        })
        .await;

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
                text: "myVarName = 100

a1 = startSketchOn(offsetPlane(XY, offset = 10))
  |> startProfile(at = [0, 0])
  |> line(end = [myVarName, 0])
  |> yLine(length = -100.0)
  |> xLine(length = -100.0)
  |> yLine(length = 100.0)
  |> close()
  |> extrude("
                    .to_string(),
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
                position: tower_lsp::lsp_types::Position { line: 9, character: 14 },
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
        assert!(signature_help.signatures[0].label.starts_with("extrude"));
    } else {
        panic!("Expected signature help");
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn test_kcl_lsp_signature_help_on_parens_trigger_on_before() {
    let server = kcl_lsp_server(false).await.unwrap();

    // Send open file.
    // We do this to trigger a valid ast.
    server
        .did_change(tower_lsp::lsp_types::DidChangeTextDocumentParams {
            text_document: tower_lsp::lsp_types::VersionedTextDocumentIdentifier {
                uri: "file:///test.kcl".try_into().unwrap(),
                version: 1,
            },
            content_changes: vec![tower_lsp::lsp_types::TextDocumentContentChangeEvent {
                range: None,
                range_length: None,
                text: "myVarName = 100

a1 = startSketchOn(offsetPlane(XY, offset = 10))
  |> startProfile(at = [0, 0])
  |> line(end = [myVarName, 0])
  |> yLine(length = -100.0)
  |> xLine(length = -100.0)
  |> yLine(length = 100.0)
  |> close()"
                    .to_string(),
            }],
        })
        .await;

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
                text: "myVarName = 100

a1 = startSketchOn(offsetPlane(XY, offset = 10))
  |> startProfile(at = [0, 0])
  |> line(end = [myVarName, 0])
  |> yLine(length = -100.0)
  |> xLine(length = -100.0)
  |> yLine(length = 100.0)
  |> close()
  |> extrude("
                    .to_string(),
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
                position: tower_lsp::lsp_types::Position { line: 9, character: 10 },
            },
            context: Some(tower_lsp::lsp_types::SignatureHelpContext {
                trigger_kind: tower_lsp::lsp_types::SignatureHelpTriggerKind::INVOKED,
                trigger_character: Some("(".to_string()),
                is_retrigger: false,
                active_signature_help: None,
            }),
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
        assert!(signature_help.signatures[0].label.starts_with("extrude"));
    } else {
        panic!("Expected signature help");
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn test_kcl_lsp_signature_help_on_comma_trigger() {
    let server = kcl_lsp_server(false).await.unwrap();

    // Send open file.
    // We do this to trigger a valid ast.
    server
        .did_change(tower_lsp::lsp_types::DidChangeTextDocumentParams {
            text_document: tower_lsp::lsp_types::VersionedTextDocumentIdentifier {
                uri: "file:///test.kcl".try_into().unwrap(),
                version: 1,
            },
            content_changes: vec![tower_lsp::lsp_types::TextDocumentContentChangeEvent {
                range: None,
                range_length: None,
                text: "myVarName = 100

a1 = startSketchOn(offsetPlane(XY, offset = 10))
  |> startProfile(at = [0, 0])
  |> line(end = [myVarName, 0])
  |> yLine(length = -100.0)
  |> xLine(length = -100.0)
  |> yLine(length = 100.0)
  |> close()"
                    .to_string(),
            }],
        })
        .await;

    // Send update file.
    server
        .did_change(tower_lsp::lsp_types::DidChangeTextDocumentParams {
            text_document: tower_lsp::lsp_types::VersionedTextDocumentIdentifier {
                uri: "file:///test.kcl".try_into().unwrap(),
                version: 1,
            },
            content_changes: vec![tower_lsp::lsp_types::TextDocumentContentChangeEvent {
                range: None,
                range_length: None,
                text: "myVarName = 100

a1 = startSketchOn(offsetPlane(XY, offset = 10))
  |> startProfile(at = [0, 0])
  |> line(end = [myVarName, 0])
  |> yLine(length = -100.0)
  |> xLine(length = -100.0)
  |> yLine(length = 100.0)
  |> close()
  |> extrude(length = 10,"
                    .to_string(),
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
                position: tower_lsp::lsp_types::Position { line: 9, character: 25 },
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
        assert!(signature_help.signatures[0].label.starts_with("extrude"));
    } else {
        panic!("Expected signature help");
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn test_kcl_lsp_signature_help_on_comma_trigger_on_before() {
    let server = kcl_lsp_server(false).await.unwrap();

    // Send open file.
    // We do this to trigger a valid ast.
    server
        .did_change(tower_lsp::lsp_types::DidChangeTextDocumentParams {
            text_document: tower_lsp::lsp_types::VersionedTextDocumentIdentifier {
                uri: "file:///test.kcl".try_into().unwrap(),
                version: 1,
            },
            content_changes: vec![tower_lsp::lsp_types::TextDocumentContentChangeEvent {
                range: None,
                range_length: None,
                text: "myVarName = 100

a1 = startSketchOn(offsetPlane(XY, offset = 10))
  |> startProfile(at = [0, 0])
  |> line(end = [myVarName, 0])
  |> yLine(length = -100.0)
  |> xLine(length = -100.0)
  |> yLine(length = 100.0)
  |> close()"
                    .to_string(),
            }],
        })
        .await;

    // Send update file.
    server
        .did_change(tower_lsp::lsp_types::DidChangeTextDocumentParams {
            text_document: tower_lsp::lsp_types::VersionedTextDocumentIdentifier {
                uri: "file:///test.kcl".try_into().unwrap(),
                version: 1,
            },
            content_changes: vec![tower_lsp::lsp_types::TextDocumentContentChangeEvent {
                range: None,
                range_length: None,
                text: "myVarName = 100

a1 = startSketchOn(offsetPlane(XY, offset = 10))
  |> startProfile(at = [0, 0])
  |> line(end = [myVarName, 0])
  |> yLine(length = -100.0)
  |> xLine(length = -100.0)
  |> yLine(length = 100.0)
  |> close()
  |> extrude(length = 10,"
                    .to_string(),
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
                position: tower_lsp::lsp_types::Position { line: 9, character: 22 },
            },
            context: Some(tower_lsp::lsp_types::SignatureHelpContext {
                trigger_kind: tower_lsp::lsp_types::SignatureHelpTriggerKind::INVOKED,
                trigger_character: Some(",".to_string()),
                is_retrigger: false,
                active_signature_help: None,
            }),
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
        assert!(signature_help.signatures[0].label.starts_with("extrude"));
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
                text: "startSketchOn(XY)".to_string(),
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
        assert_eq!(semantic_tokens.data[0].delta_start, 0);
        assert_eq!(semantic_tokens.data[0].delta_line, 0);
        assert_eq!(
            semantic_tokens.data[0].token_type,
            server
                .get_semantic_token_type_index(&SemanticTokenType::FUNCTION)
                .unwrap()
        );
        assert_eq!(semantic_tokens.data[1].length, 2);
        assert_eq!(semantic_tokens.data[1].delta_start, 14);
        assert_eq!(semantic_tokens.data[1].delta_line, 0);
        assert_eq!(
            semantic_tokens.data[1].token_type,
            server
                .get_semantic_token_type_index(&SemanticTokenType::VARIABLE)
                .unwrap()
        );
    } else {
        panic!("Expected semantic tokens");
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn test_kcl_lsp_semantic_tokens_large_file() {
    let server = kcl_lsp_server(false).await.unwrap();
    let code = include_str!("../../e2e/executor/inputs/global-tags.kcl");

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
        assert!(!semantic_tokens.data.is_empty());
    } else {
        panic!("Expected semantic tokens");
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn test_kcl_lsp_semantic_tokens_with_modifiers() {
    let server = kcl_lsp_server(false).await.unwrap();

    // Send open file.
    server
        .did_open(tower_lsp::lsp_types::DidOpenTextDocumentParams {
            text_document: tower_lsp::lsp_types::TextDocumentItem {
                uri: "file:///test.kcl".try_into().unwrap(),
                language_id: "kcl".to_string(),
                version: 1,
                text: r#"part001 = startSketchOn(XY)
  |> startProfile(at = [-10, -10])
  |> line(end = [20, 0])
  |> line(end = [0, 20], tag = $seg01)
  |> line(end = [-20, 0])
  |> close()
  |> extrude(length = 3.14)

thing = {blah = "foo"}
bar = thing.blah

fn myFn(param1) {
    return param1
}"#
                .to_string(),
            },
        })
        .await;

    // Assure we have no errors.
    assert_diagnostic_count(server.diagnostics_map.get("file:///test.kcl").as_deref(), 0);

    // Get the token map.
    let token_map = server.token_map.get("file:///test.kcl").unwrap().clone();
    assert!(!token_map.is_empty());

    // Get the ast.
    let ast = server.ast_map.get("file:///test.kcl").unwrap().clone();
    assert!(ast.ast != Node::<Program>::default());

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
        let function_index = server
            .get_semantic_token_type_index(&SemanticTokenType::FUNCTION)
            .unwrap();
        let property_index = server
            .get_semantic_token_type_index(&SemanticTokenType::PROPERTY)
            .unwrap();
        let parameter_index = server
            .get_semantic_token_type_index(&SemanticTokenType::PARAMETER)
            .unwrap();
        let variable_index = server
            .get_semantic_token_type_index(&SemanticTokenType::VARIABLE)
            .unwrap();

        let declaration_index = server
            .get_semantic_token_modifier_index(vec![SemanticTokenModifier::DECLARATION])
            .unwrap();
        let definition_index = server
            .get_semantic_token_modifier_index(vec![SemanticTokenModifier::DEFINITION])
            .unwrap();
        let default_library_index = server
            .get_semantic_token_modifier_index(vec![SemanticTokenModifier::DEFAULT_LIBRARY])
            .unwrap();

        let variable_modifiers = server
            .get_semantic_token_modifier_index(vec![
                SemanticTokenModifier::DECLARATION,
                SemanticTokenModifier::READONLY,
            ])
            .unwrap();
        let tag_modifiers = server
            .get_semantic_token_modifier_index(vec![SemanticTokenModifier::DEFINITION, SemanticTokenModifier::STATIC])
            .unwrap();

        // Iterate over the tokens and check the token types.
        let mut found_parameter = false;
        let mut found_property = false;
        let mut found_function_declaration = false;
        let mut found_variable_declaration = false;
        let mut found_property_declaration = false;
        let mut found_tag_declaration = false;
        let mut found_default_library = false;
        for token in semantic_tokens.data {
            if token.token_type == function_index && token.token_modifiers_bitset == default_library_index {
                found_default_library = true;
            }

            if token.token_type == parameter_index {
                found_parameter = true;
            } else if token.token_type == property_index {
                found_property = true;
            }

            if token.token_type == definition_index && token.token_modifiers_bitset == tag_modifiers {
                found_tag_declaration = true;
            }

            if token.token_type == function_index && token.token_modifiers_bitset == variable_modifiers {
                found_function_declaration = true;
            }

            if token.token_type == variable_index && token.token_modifiers_bitset == variable_modifiers {
                found_variable_declaration = true;
            }

            if token.token_type == property_index && token.token_modifiers_bitset == declaration_index {
                found_property_declaration = true;
            }

            if found_parameter
                && found_property
                && found_function_declaration
                && found_variable_declaration
                && found_property_declaration
                && found_tag_declaration
                && found_default_library
            {
                break;
            }
        }

        if !found_parameter {
            panic!("Expected parameter token");
        }

        if !found_property {
            panic!("Expected property token");
        }

        if !found_function_declaration {
            panic!("Expected function declaration token");
        }

        if !found_variable_declaration {
            panic!("Expected variable declaration token");
        }

        if !found_property_declaration {
            panic!("Expected property declaration token");
        }

        if !found_tag_declaration {
            panic!("Expected tag declaration token");
        }

        if !found_default_library {
            panic!("Expected default library token");
        }
    } else {
        panic!("Expected semantic tokens");
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn test_kcl_lsp_semantic_tokens_multiple_comments() {
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

// Define constants like ball diameter, inside diameter, overhange length, and thickness
sphereDia = 0.5"#
                    .to_string(),
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
        assert_eq!(semantic_tokens.data.len(), 6);
        assert_eq!(semantic_tokens.data[0].length, 15);
        assert_eq!(semantic_tokens.data[0].delta_start, 0);
        assert_eq!(semantic_tokens.data[0].delta_line, 0);
        assert_eq!(
            semantic_tokens.data[0].token_type,
            server
                .get_semantic_token_type_index(&SemanticTokenType::COMMENT)
                .unwrap()
        );
        assert_eq!(semantic_tokens.data[1].length, 232);
        assert_eq!(semantic_tokens.data[1].delta_start, 0);
        assert_eq!(semantic_tokens.data[1].delta_line, 1);
        assert_eq!(
            semantic_tokens.data[1].token_type,
            server
                .get_semantic_token_type_index(&SemanticTokenType::COMMENT)
                .unwrap()
        );
        assert_eq!(semantic_tokens.data[2].length, 88);
        assert_eq!(semantic_tokens.data[2].delta_start, 0);
        assert_eq!(semantic_tokens.data[2].delta_line, 2);
        assert_eq!(
            semantic_tokens.data[2].token_type,
            server
                .get_semantic_token_type_index(&SemanticTokenType::COMMENT)
                .unwrap()
        );
        assert_eq!(semantic_tokens.data[3].length, 9);
        assert_eq!(semantic_tokens.data[3].delta_start, 0);
        assert_eq!(semantic_tokens.data[3].delta_line, 1);
        assert_eq!(
            semantic_tokens.data[3].token_type,
            server
                .get_semantic_token_type_index(&SemanticTokenType::VARIABLE)
                .unwrap()
        );
        assert_eq!(semantic_tokens.data[4].length, 1);
        assert_eq!(semantic_tokens.data[4].delta_start, 10);
        assert_eq!(
            semantic_tokens.data[4].token_type,
            server
                .get_semantic_token_type_index(&SemanticTokenType::OPERATOR)
                .unwrap()
        );
        assert_eq!(semantic_tokens.data[5].length, 3);
        assert_eq!(semantic_tokens.data[5].delta_start, 2);
        assert_eq!(
            semantic_tokens.data[5].token_type,
            server
                .get_semantic_token_type_index(&SemanticTokenType::NUMBER)
                .unwrap()
        );
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
                text: r#"myVar = 1
startSketchOn(XY)"#
                    .to_string(),
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
        assert_eq!(document_symbol[0].name, "myVar");
    } else {
        panic!("Expected document symbol");
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn test_kcl_lsp_document_symbol_tag() {
    let server = kcl_lsp_server(false).await.unwrap();

    // Send open file.
    server
        .did_open(tower_lsp::lsp_types::DidOpenTextDocumentParams {
            text_document: tower_lsp::lsp_types::TextDocumentItem {
                uri: "file:///test.kcl".try_into().unwrap(),
                language_id: "kcl".to_string(),
                version: 1,
                text: r#"part001 = startSketchOn(XY)
  |> startProfile(at = [11.19, 28.35])
  |> line(end = [28.67, -13.25], tag = $here)
  |> line(end = [-4.12, -22.81])
  |> line(end = [-33.24, 14.55])
  |> close()
  |> extrude(length = 5)"#
                    .to_string(),
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
        assert_eq!(document_symbol.len(), 2);
        assert_eq!(document_symbol[0].name, "part001");
        assert_eq!(document_symbol[1].name, "here");
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
                text: r#"startSketchOn(XY)
                    |> startProfile(at = [0,0])"#
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
        r#"startSketchOn(XY)
    |> startProfile(at = [0, 0])"#
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

// Define constants like ball diameter, inside diameter, overhange length, and thickness
sphereDia = 0.5
insideDia = 1
thickness = 0.25
overHangLength = .4

// Sketch and revolve the inside bearing piece
insideRevolve = startSketchOn(XZ)
  |> startProfile(at = [insideDia / 2, 0])
  |> line(end = [0, thickness + sphereDia / 2])
  |> line(end = [overHangLength, 0])
  |> line(end = [0, -thickness])
  |> line(end = [-overHangLength + thickness, 0])
  |> line(end = [0, -sphereDia])
  |> line(end = [overHangLength - thickness, 0])
  |> line(end = [0, -thickness])
  |> line(end = [-overHangLength, 0])
  |> close()
  |> revolve(axis = Y)

// Sketch and revolve one of the balls and duplicate it using a circular pattern. (This is currently a workaround, we have a bug with rotating on a sketch that touches the rotation axis)
sphere = startSketchOn(XZ)
  |> startProfile(at = [0.05 + insideDia / 2 + thickness, 0 - 0.05])
  |> line(end = [sphereDia - 0.1, 0])
  |> arc(angle_start = 0, angle_end = -180, radius = sphereDia / 2 - 0.05)
  |> close()
  |> revolve(axis = X)
  |> patternCircular3d(
       axis = [0, 0, 1],
       center = [0, 0, 0],
       repetitions = 10,
       arcDegrees = 360,
       rotateDuplicates = true,
     )

// Sketch and revolve the outside bearing
outsideRevolve = startSketchOn(XZ)
  |> startProfile(at = [insideDia / 2 + thickness + sphereDia, 0])
  |> line(end = [0, sphereDia / 2])
  |> line(end = [-overHangLength + thickness, 0])
  |> line(end = [0, thickness])
  |> line(end = [overHangLength, 0])
  |> line(end = [0, -2 * thickness - sphereDia])
  |> line(end = [-overHangLength, 0])
  |> line(end = [0, thickness])
  |> line(end = [overHangLength - thickness, 0])
  |> close()
  |> revolve(axis = Y)"#
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
        formatting[0].range,
        tower_lsp::lsp_types::Range {
            start: tower_lsp::lsp_types::Position { line: 0, character: 0 },
            end: tower_lsp::lsp_types::Position {
                line: 50,
                character: 22
            }
        }
    );
    assert_eq!(
        formatting[0].new_text,
        r#"// Ball Bearing
// A ball bearing is a type of rolling-element bearing that uses balls to maintain the separation between the bearing races. The primary purpose of a ball bearing is to reduce rotational friction and support radial and axial loads.

// Define constants like ball diameter, inside diameter, overhange length, and thickness
sphereDia = 0.5
insideDia = 1
thickness = 0.25
overHangLength = .4

// Sketch and revolve the inside bearing piece
insideRevolve = startSketchOn(XZ)
  |> startProfile(at = [insideDia / 2, 0])
  |> line(end = [0, thickness + sphereDia / 2])
  |> line(end = [overHangLength, 0])
  |> line(end = [0, -thickness])
  |> line(end = [-overHangLength + thickness, 0])
  |> line(end = [0, -sphereDia])
  |> line(end = [overHangLength - thickness, 0])
  |> line(end = [0, -thickness])
  |> line(end = [-overHangLength, 0])
  |> close()
  |> revolve(axis = Y)

// Sketch and revolve one of the balls and duplicate it using a circular pattern. (This is currently a workaround, we have a bug with rotating on a sketch that touches the rotation axis)
sphere = startSketchOn(XZ)
  |> startProfile(at = [
       0.05 + insideDia / 2 + thickness,
       0 - 0.05
     ])
  |> line(end = [sphereDia - 0.1, 0])
  |> arc(angle_start = 0, angle_end = -180, radius = sphereDia / 2 - 0.05)
  |> close()
  |> revolve(axis = X)
  |> patternCircular3d(
       axis = [0, 0, 1],
       center = [0, 0, 0],
       repetitions = 10,
       arcDegrees = 360,
       rotateDuplicates = true,
     )

// Sketch and revolve the outside bearing
outsideRevolve = startSketchOn(XZ)
  |> startProfile(at = [
       insideDia / 2 + thickness + sphereDia,
       0
     ])
  |> line(end = [0, sphereDia / 2])
  |> line(end = [-overHangLength + thickness, 0])
  |> line(end = [0, thickness])
  |> line(end = [overHangLength, 0])
  |> line(end = [0, -2 * thickness - sphereDia])
  |> line(end = [-overHangLength, 0])
  |> line(end = [0, thickness])
  |> line(end = [overHangLength - thickness, 0])
  |> close()
  |> revolve(axis = Y)"#
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
                text: r#"thing= 1"#.to_string(),
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
                position: tower_lsp::lsp_types::Position { line: 0, character: 2 },
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
                end: tower_lsp::lsp_types::Position { line: 0, character: 8 }
            },
            new_text: "newName = 1\n".to_string()
        }]
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn test_kcl_lsp_rename_no_hanging_parens() {
    let server = kcl_lsp_server(false).await.unwrap();

    let code = r#"myVARName = 100

a1 = startSketchOn(offsetPlane(XY, offset = 10))
  |> startProfile(at = [0, 0])
  |> line(end = [myVARName, 0])
  |> yLine(length = -100.0)
  |> xLine(length = -100.0)
  |> yLine(length = 100.0)
  |> close()
  |> extrude(length = 3.14)"#;

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

    // Send rename request.
    let rename = server
        .rename(tower_lsp::lsp_types::RenameParams {
            text_document_position: tower_lsp::lsp_types::TextDocumentPositionParams {
                text_document: tower_lsp::lsp_types::TextDocumentIdentifier {
                    uri: "file:///test.kcl".try_into().unwrap(),
                },
                position: tower_lsp::lsp_types::Position { line: 0, character: 2 },
            },
            new_name: "myVarName".to_string(),
            work_done_progress_params: Default::default(),
        })
        .await
        .unwrap()
        .unwrap();

    // Check the rename.
    let changes = rename.changes.unwrap();

    let last_character = 27;

    // Get the last character of the last line of the original code.
    assert_eq!(code.lines().last().unwrap().chars().count(), last_character);

    let u: tower_lsp::lsp_types::Url = "file:///test.kcl".try_into().unwrap();
    assert_eq!(
        changes.get(&u).unwrap().clone(),
        vec![tower_lsp::lsp_types::TextEdit {
            range: tower_lsp::lsp_types::Range {
                start: tower_lsp::lsp_types::Position { line: 0, character: 0 },
                // Its important we get back the right number here so that we actually replace the whole text!!
                end: tower_lsp::lsp_types::Position {
                    line: 9,
                    character: last_character as u32
                }
            },
            new_text: "myVarName = 100

a1 = startSketchOn(offsetPlane(XY, offset = 10))
  |> startProfile(at = [0, 0])
  |> line(end = [myVarName, 0])
  |> yLine(length = -100.0)
  |> xLine(length = -100.0)
  |> yLine(length = 100.0)
  |> close()
  |> extrude(length = 3.14)\n"
                .to_string()
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
                text: r#"thing= 1"#.to_string(),
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
                "Unexpected token: ;"
            );
        } else {
            panic!("Expected full diagnostics");
        }
    } else {
        panic!("Expected diagnostics");
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn test_kcl_lsp_diagnostic_has_lints() {
    let server = kcl_lsp_server(false).await.unwrap();

    // Send open file.
    server
        .did_open(tower_lsp::lsp_types::DidOpenTextDocumentParams {
            text_document: tower_lsp::lsp_types::TextDocumentItem {
                uri: "file:///testlint.kcl".try_into().unwrap(),
                language_id: "kcl".to_string(),
                version: 1,
                text: r#"THING = 10"#.to_string(),
            },
        })
        .await;

    // Send diagnostics request.
    let diagnostics = server
        .diagnostic(tower_lsp::lsp_types::DocumentDiagnosticParams {
            text_document: tower_lsp::lsp_types::TextDocumentIdentifier {
                uri: "file:///testlint.kcl".try_into().unwrap(),
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
                "Identifiers should be lowerCamelCase"
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

    // Send completion request.
    let completions = server
        .get_completions(
            "kcl".to_string(),
            r#"bracket = startSketchOn(XY)
  |> startProfile(at = [0, 0])
  "#
            .to_string(),
            r#"  |> close()
  |> extrude(length = 10)"#
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
            r#"bracket = startSketchOn(XY)
  |> startProfile(at = [0, 0])
  "#
            .to_string(),
            r#"  |> close()
  |> extrude(length = 10)"#
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

    // Send completion request.
    let params = crate::lsp::copilot::types::CopilotLspCompletionParams {
        doc: crate::lsp::copilot::types::CopilotDocParams {
            indent_size: 4,
            insert_spaces: true,
            language_id: "kcl".to_string(),
            path: "file:///test.copilot".to_string(),
            position: crate::lsp::copilot::types::CopilotPosition { line: 3, character: 3 },
            relative_path: "test.copilot".to_string(),
            source: r#"bracket = startSketchOn(XY)
  |> startProfile(at = [0, 0])
  
  |> close()
  |> extrude(length = 10)
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

    // Check the code map.
    assert_eq!(server.code_map.len(), 1);
    assert_eq!(
        server.code_map.get("file:///test.copilot").unwrap().clone(),
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

    // Check the code map.
    assert_eq!(server.code_map.len(), 1);
    assert_eq!(
        server.code_map.get("file:///test.kcl").unwrap().clone(),
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

    // Check the code map.
    assert_eq!(server.code_map.len(), 1);
    assert_eq!(
        server.code_map.get("file:///test2.copilot").unwrap().clone(),
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
    assert_eq!(copilot_server.code_map.len(), 0);

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
    assert_eq!(kcl_server.code_map.len(), 0);

    // Now shut them down.
    copilot_server.shutdown().await.unwrap();
    kcl_server.shutdown().await.unwrap();
}

#[tokio::test(flavor = "multi_thread")]
async fn test_kcl_lsp_on_change_update_ast() {
    let server = kcl_lsp_server(false).await.unwrap();

    let same_text = r#"thing = 1"#.to_string();

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

    // Get the ast.
    let ast = server.ast_map.get("file:///test.kcl").unwrap().clone();

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

    // Make sure the ast is the same.
    assert_eq!(ast, server.ast_map.get("file:///test.kcl").unwrap().clone());

    // Update the text.
    let new_text = r#"thing = 2"#.to_string();
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

    assert!(ast != server.ast_map.get("file:///test.kcl").unwrap().clone());
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_kcl_lsp_on_change_update_memory() {
    let server = kcl_lsp_server(true).await.unwrap();

    let same_text = r#"thing = 1"#.to_string();

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

    // Update the text.
    let new_text = r#"thing = 2"#.to_string();
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

    server.executor_ctx().await.clone().unwrap().close().await;
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_kcl_lsp_empty_file_execute_ok() {
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

    // Get the diagnostics.
    assert_diagnostic_count(server.diagnostics_map.get("file:///test.kcl").as_deref(), 1);

    // Update the text.
    let new_text = r#"thing = 2"#.to_string();
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

    // Get the diagnostics.
    assert_diagnostic_count(server.diagnostics_map.get("file:///test.kcl").as_deref(), 0);
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_kcl_lsp_diagnostics_on_execution_error() {
    let server = kcl_lsp_server(true).await.unwrap();

    // Send open file.
    server
        .did_open(tower_lsp::lsp_types::DidOpenTextDocumentParams {
            text_document: tower_lsp::lsp_types::TextDocumentItem {
                uri: "file:///test.kcl".try_into().unwrap(),
                language_id: "kcl".to_string(),
                version: 1,
                text: r#"part001 = startSketchOn(XY)
  |> startProfile(at = [-10, -10])
  |> line(end = [20, 0])
  |> line(end = [0, 20])
  |> line(end = [-20, 0])
  |> close()
  |> extrude(length = 3.14)
  |> fillet(
    radius = 3.14,
    tags = ["tag_or_edge_fn"],
  )"#
                .to_string(),
            },
        })
        .await;

    // Get the diagnostics.
    // TODO warnings being stomped by execution errors?
    assert_diagnostic_count(server.diagnostics_map.get("file:///test.kcl").as_deref(), 2);

    // Update the text.
    let new_text = r#"part001 = startSketchOn(XY)
  |> startProfile(at = [-10, -10])
  |> line(end = [20, 0])
  |> line(end = [0, 20])
  |> line(end = [-20, 0])
  |> close()
  |> extrude(length = 3.14)"#
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

    // Get the diagnostics.
    assert_diagnostic_count(server.diagnostics_map.get("file:///test.kcl").as_deref(), 0);

    server.executor_ctx().await.clone().unwrap().close().await;
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_kcl_lsp_full_to_empty_file_updates_ast_and_memory() {
    let server = kcl_lsp_server(true).await.unwrap();

    // Send open file.
    server
        .did_open(tower_lsp::lsp_types::DidOpenTextDocumentParams {
            text_document: tower_lsp::lsp_types::TextDocumentItem {
                uri: "file:///test.kcl".try_into().unwrap(),
                language_id: "kcl".to_string(),
                version: 1,
                text: r#"part001 = startSketchOn(XY)
  |> startProfile(at = [-10, -10])
  |> line(end = [20, 0])
  |> line(end = [0, 20])
  |> line(end = [-20, 0])
  |> close()
  |> extrude(length = 3.14)"#
                    .to_string(),
            },
        })
        .await;

    // Get the ast.
    let ast = server.ast_map.get("file:///test.kcl").unwrap().clone();
    assert!(ast.ast != Node::<Program>::default());

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

    let mut default_hashed = Node::<Program>::default();
    default_hashed.compute_digest();

    // Get the ast.
    let ast = server.ast_map.get("file:///test.kcl").unwrap().clone();
    assert_eq!(ast.ast, default_hashed);

    server.executor_ctx().await.clone().unwrap().close().await;
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_kcl_lsp_code_unchanged_but_has_diagnostics_reexecute() {
    let server = kcl_lsp_server(true).await.unwrap();

    let code = r#"part001 = startSketchOn(XY)
  |> startProfile(at = [-10, -10])
  |> line(end = [20, 0])
  |> line(end = [0, 20])
  |> line(end = [-20, 0])
  |> close()
  |> extrude(length = 3.14)"#;

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

    // Get the ast.
    let ast = server.ast_map.get("file:///test.kcl").unwrap().clone();
    assert!(ast.ast != Node::<Program>::default());

    // Assure we have no diagnostics.
    assert_diagnostic_count(server.diagnostics_map.get("file:///test.kcl").as_deref(), 0);

    // Add some fake diagnostics.
    server.diagnostics_map.insert(
        "file:///test.kcl".to_string(),
        vec![tower_lsp::lsp_types::Diagnostic {
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
    );
    // Assure we have one diagnostics.
    assert_diagnostic_count(server.diagnostics_map.get("file:///test.kcl").as_deref(), 1);

    // Clear the ast and memory.
    server.ast_map.insert(
        "file:///test.kcl".to_string(),
        crate::Program {
            ast: Default::default(),
            original_file_contents: Default::default(),
        },
    );
    let ast = server.ast_map.get("file:///test.kcl").unwrap().clone();
    assert_eq!(ast.ast, Node::<Program>::default());

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

    // Get the ast.
    let ast = server.ast_map.get("file:///test.kcl").unwrap().clone();
    assert!(ast.ast != Node::<Program>::default());

    // Assure we have no diagnostics.
    assert_diagnostic_count(server.diagnostics_map.get("file:///test.kcl").as_deref(), 0);

    server.executor_ctx().await.clone().unwrap().close().await;
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_kcl_lsp_code_and_ast_unchanged_but_has_diagnostics_reexecute() {
    let server = kcl_lsp_server(true).await.unwrap();

    let code = r#"part001 = startSketchOn(XY)
  |> startProfile(at = [-10, -10])
  |> line(end = [20, 0])
  |> line(end = [0, 20])
  |> line(end = [-20, 0])
  |> close()
  |> extrude(length = 3.14)"#;

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

    // Get the ast.
    let ast = server.ast_map.get("file:///test.kcl").unwrap().clone();
    assert!(ast.ast != Node::<Program>::default());

    // Assure we have no diagnostics.
    assert_diagnostic_count(server.diagnostics_map.get("file:///test.kcl").as_deref(), 0);

    // Add some fake diagnostics.
    server.diagnostics_map.insert(
        "file:///test.kcl".to_string(),
        vec![tower_lsp::lsp_types::Diagnostic {
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
    );
    // Assure we have one diagnostics.
    assert_diagnostic_count(server.diagnostics_map.get("file:///test.kcl").as_deref(), 1);

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

    // Get the ast.
    let ast = server.ast_map.get("file:///test.kcl").unwrap().clone();
    assert!(ast.ast != Node::<Program>::default());

    // Assure we have no diagnostics.
    assert_diagnostic_count(server.diagnostics_map.get("file:///test.kcl").as_deref(), 0);

    server.executor_ctx().await.clone().unwrap().close().await;
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_kcl_lsp_cant_execute_set() {
    let server = kcl_lsp_server(true).await.unwrap();

    let code = r#"part001 = startSketchOn(XY)
  |> startProfile(at = [-10, -10])
  |> line(end = [20, 0])
  |> line(end = [0, 20])
  |> line(end = [-20, 0])
  |> close()
  |> extrude(length = 3.14)"#;

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

    // Get the ast.
    let ast = server.ast_map.get("file:///test.kcl").unwrap().clone();
    assert!(ast.ast != Node::<Program>::default());

    // Assure we have no diagnostics.
    assert_diagnostic_count(server.diagnostics_map.get("file:///test.kcl").as_deref(), 0);

    // Get the ast.
    let ast = server.ast_map.get("file:///test.kcl").unwrap().clone();
    assert!(ast.ast != Node::<Program>::default());

    // Assure we have no diagnostics.
    assert_diagnostic_count(server.diagnostics_map.get("file:///test.kcl").as_deref(), 0);

    assert_eq!(server.can_execute().await, true);

    // Set that we cannot execute.
    server
        .update_can_execute(crate::lsp::kcl::custom_notifications::UpdateCanExecuteParams { can_execute: false })
        .await
        .unwrap();
    assert_eq!(server.can_execute().await, false);

    let mut default_hashed = Node::<Program>::default();
    default_hashed.compute_digest();

    // Get the ast.
    let ast = server.ast_map.get("file:///test.kcl").unwrap().clone();
    assert!(ast.ast != default_hashed);

    // Assure we have no diagnostics.
    assert_diagnostic_count(server.diagnostics_map.get("file:///test.kcl").as_deref(), 0);

    // Set that we CAN execute.
    server
        .update_can_execute(crate::lsp::kcl::custom_notifications::UpdateCanExecuteParams { can_execute: true })
        .await
        .unwrap();
    assert_eq!(server.can_execute().await, true);

    // Get the ast.
    let ast = server.ast_map.get("file:///test.kcl").unwrap().clone();
    assert!(ast.ast != Node::<Program>::default());

    // Assure we have no diagnostics.
    assert_diagnostic_count(server.diagnostics_map.get("file:///test.kcl").as_deref(), 0);

    server.executor_ctx().await.clone().unwrap().close().await;
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
                text: r#"startSketchOn(XY)
                    |> startProfile(at = [0,0])"#
                    .to_string(),
            },
        })
        .await;

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
            start_line: 17,
            start_character: None,
            end_line: 65,
            end_character: None,
            kind: Some(tower_lsp::lsp_types::FoldingRangeKind::Region),
            collapsed_text: Some("startSketchOn(XY)".to_string())
        }
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_kcl_lsp_code_with_parse_error_and_ast_unchanged_but_has_diagnostics_reparse() {
    let server = kcl_lsp_server(false).await.unwrap();

    let code = r#"part001 = startSketchOn(XY)
  |> startProfile(at = [-10, -10])
  |> line(end = [20, 0])
  |> line(end = [0, 20])
  |> line(end = [-20, 0])
  |> close()
  |> ^^^things(3.14, %)"#;

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

    // Get the ast.
    let ast = server.ast_map.get("file:///test.kcl");
    assert!(ast.is_none());

    // Assure we have one diagnostics.
    assert_diagnostic_count(server.diagnostics_map.get("file:///test.kcl").as_deref(), 1);

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

    // Get the ast.
    let ast = server.ast_map.get("file:///test.kcl");
    assert!(ast.is_none());

    // Assure we have one diagnostics.
    assert_diagnostic_count(server.diagnostics_map.get("file:///test.kcl").as_deref(), 1);
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_kcl_lsp_code_with_lint_and_ast_unchanged_but_has_diagnostics_reparse() {
    let server = kcl_lsp_server(false).await.unwrap();

    let code = r#"LINT = 1
part001 = startSketchOn(XY)
  |> startProfile(at = [-10, -10])
  |> line(end = [20, 0])
  |> line(end = [0, 20])
  |> line(end = [-20, 0])
  |> close()
  |> extrude(length = 3.14)"#;

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

    // Get the ast.
    let ast = server.ast_map.get("file:///test.kcl").unwrap().clone();
    assert!(ast.ast != Node::<Program>::default());

    // Assure we have one diagnostics.
    assert_diagnostic_count(server.diagnostics_map.get("file:///test.kcl").as_deref(), 1);
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

    // Get the ast.
    let ast = server.ast_map.get("file:///test.kcl").unwrap().clone();
    assert!(ast.ast != Node::<Program>::default());

    // Assure we have one diagnostics.
    assert_diagnostic_count(server.diagnostics_map.get("file:///test.kcl").as_deref(), 1);
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_kcl_lsp_code_with_lint_and_parse_error_and_ast_unchanged_but_has_diagnostics_reparse() {
    let server = kcl_lsp_server(false).await.unwrap();

    let code = r#"LINT = 1
part001 = startSketchOn(XY)
  |> startProfile(at = [-10, -10])
  |> line(end = [20, 0])
  |> line(end = [0, 20])
  |> line(end = [-20, 0])
  |> close()
  |> ^^^^thing(3.14, %)"#;

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

    // Get the ast.
    let ast = server.ast_map.get("file:///test.kcl");
    assert!(ast.is_none());

    // Assure we have diagnostics.
    assert_diagnostic_count(server.diagnostics_map.get("file:///test.kcl").as_deref(), 1);

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

    // Get the ast.
    let ast = server.ast_map.get("file:///test.kcl");
    assert!(ast.is_none());

    // Assure we have one diagnostics.
    assert_diagnostic_count(server.diagnostics_map.get("file:///test.kcl").as_deref(), 1);
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_kcl_lsp_code_lint_and_ast_unchanged_but_has_diagnostics_reexecute() {
    let server = kcl_lsp_server(true).await.unwrap();

    let code = r#"LINT = 1
part001 = startSketchOn(XY)
  |> startProfile(at = [-10, -10])
  |> line(end = [20, 0])
  |> line(end = [0, 20], tag = $seg01)
  |> line(end = [-20, 0], tag = $seg01)
  |> close()
  |> extrude(length = 3.14)"#;

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

    // Assure we have diagnostics.

    // Check the diagnostics.
    assert_diagnostic_count(server.diagnostics_map.get("file:///test.kcl").as_deref(), 2);

    // Get the ast.
    let ast = server.ast_map.get("file:///test.kcl").unwrap().clone();
    assert!(ast.ast != Node::<Program>::default());

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

    // Get the ast.
    let ast = server.ast_map.get("file:///test.kcl").unwrap().clone();
    assert!(ast.ast != Node::<Program>::default());

    // Assure we have diagnostics.

    // Check the diagnostics.
    assert_diagnostic_count(server.diagnostics_map.get("file:///test.kcl").as_deref(), 2);

    server.executor_ctx().await.clone().unwrap().close().await;
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_kcl_lsp_code_lint_reexecute_new_lint() {
    let server = kcl_lsp_server(true).await.unwrap();

    let code = r#"LINT = 1
part001 = startSketchOn(XY)
  |> startProfile(at = [-10, -10])
  |> line(end = [20, 0])
  |> line(end = [0, 20], tag = $seg01)
  |> line(end = [-20, 0], tag = $seg01)
  |> close()
  |> extrude(length = 3.14)"#;

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

    // Assure we have diagnostics.

    // Check the diagnostics.
    assert_diagnostic_count(server.diagnostics_map.get("file:///test.kcl").as_deref(), 2);

    // Get the ast.
    let ast = server.ast_map.get("file:///test.kcl").unwrap().clone();
    assert!(ast.ast != Node::<Program>::default());

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
                text: r#"part001 = startSketchOn(XY)
  |> startProfile(at = [-10, -10])
  |> line(end = [20, 0])
  |> line(end = [0, 20], tag = $seg01)
  |> line(end = [-20, 0], tag = $seg01)
  |> close()
  |> extrude(length = 3.14)
NEW_LINT = 1"#
                    .to_string(),
            }],
        })
        .await;

    // Get the ast.
    let ast = server.ast_map.get("file:///test.kcl").unwrap().clone();
    assert!(ast.ast != Node::<Program>::default());

    // Assure we have diagnostics.

    // Check the diagnostics.
    assert_diagnostic_count(server.diagnostics_map.get("file:///test.kcl").as_deref(), 2);

    server.executor_ctx().await.clone().unwrap().close().await;
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_kcl_lsp_code_lint_reexecute_new_ast_error() {
    let server = kcl_lsp_server(true).await.unwrap();

    let code = r#"LINT = 1
part001 = startSketchOn(XY)
  |> startProfile(at = [-10, -10])
  |> line(end = [20, 0])
  |> line(end = [0, 20], tag = $seg01)
  |> line(end = [-20, 0], tag = $seg01)
  |> close()
  |> ^^^extrude(length = 3.14)"#;

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

    // Assure we have diagnostics.

    // Check the diagnostics.
    assert_diagnostic_count(server.diagnostics_map.get("file:///test.kcl").as_deref(), 1);

    // Get the ast.
    let ast = server.ast_map.get("file:///test.kcl");
    assert!(ast.is_none());

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
                text: r#"part001 = startSketchOn(XY)
  |> ^^^^startProfile(at = [-10, -10])
  |> line(end = [20, 0])
  |> line(end = [0, 20], tag = $seg01)
  |> line(end = [-20, 0], tag = $seg01)
  |> close()
  |> extrude(length = 3.14)
NEW_LINT = 1"#
                    .to_string(),
            }],
        })
        .await;

    // Get the ast.
    let ast = server.ast_map.get("file:///test.kcl");
    assert!(ast.is_none());

    // Assure we have diagnostics.

    // Check the diagnostics.
    assert_diagnostic_count(server.diagnostics_map.get("file:///test.kcl").as_deref(), 1);

    server.executor_ctx().await.clone().unwrap().close().await;
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_kcl_lsp_code_lint_reexecute_had_lint_new_parse_error() {
    let server = kcl_lsp_server(true).await.unwrap();

    let code = r#"LINT = 1
part001 = startSketchOn(XY)
  |> startProfile(at = [-10, -10])
  |> line(end = [20, 0])
  |> line(end = [0, 20])
  |> line(end = [-20, 0])
  |> close()
  "#;

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

    // Assure we have diagnostics.

    // Check the diagnostics.
    assert_diagnostic_count(server.diagnostics_map.get("file:///test.kcl").as_deref(), 1);

    // Get the ast.
    let ast = server.ast_map.get("file:///test.kcl").unwrap().clone();
    assert!(ast.ast != Node::<Program>::default());

    // Get the symbols map.
    let symbols_map = server.symbols_map.get("file:///test.kcl").unwrap().clone();
    assert!(!symbols_map.is_empty());

    // Get the semantic tokens map.
    let semantic_tokens_map = server.semantic_tokens_map.get("file:///test.kcl").unwrap().clone();
    assert!(!semantic_tokens_map.is_empty());

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
                text: r#"part001 = startSketchOn(XY)
  |> ^^^^startProfile(at = [-10, -10])
  |> line(end = [20, 0])
  |> line(end = [0, 20])
  |> line(end = [-20, 0])
  |> close()
  |> extrude(length = 3.14)
NEW_LINT = 1"#
                    .to_string(),
            }],
        })
        .await;

    // Get the ast.
    let ast = server.ast_map.get("file:///test.kcl");
    assert!(ast.is_none());

    // Get the symbols map.
    let symbols_map = server.symbols_map.get("file:///test.kcl");
    assert!(symbols_map.is_none());

    // Get the semantic tokens map.
    let semantic_tokens_map = server.semantic_tokens_map.get("file:///test.kcl").unwrap().clone();
    assert!(!semantic_tokens_map.is_empty());

    // Assure we have diagnostics.

    // Check the diagnostics.
    assert_diagnostic_count(server.diagnostics_map.get("file:///test.kcl").as_deref(), 1);

    server.executor_ctx().await.clone().unwrap().close().await;
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_kcl_lsp_code_lint_reexecute_had_lint_new_execution_error() {
    let server = kcl_lsp_server(true).await.unwrap();

    let code = r#"LINT = 1
part001 = startSketchOn(XY)
  |> startProfile(at = [-10, -10])
  |> line(end = [20, 0])
  |> line(end = [0, 20])
  |> line(end = [-20, 0])
  |> close()
  "#;

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

    // Assure we have diagnostics.

    // Check the diagnostics.
    assert_diagnostic_count(server.diagnostics_map.get("file:///test.kcl").as_deref(), 1);

    // Get the token map.
    let token_map = server.token_map.get("file:///test.kcl").unwrap().clone();
    assert!(!token_map.is_empty());

    // Get the ast.
    let ast = server.ast_map.get("file:///test.kcl").unwrap().clone();
    assert!(ast.ast != Node::<Program>::default());

    // Get the symbols map.
    let symbols_map = server.symbols_map.get("file:///test.kcl").unwrap().clone();
    assert!(!symbols_map.is_empty());

    // Get the semantic tokens map.
    let semantic_tokens_map = server.semantic_tokens_map.get("file:///test.kcl").unwrap().clone();
    assert!(!semantic_tokens_map.is_empty());

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
                text: r#"LINT = 1
part001 = startSketchOn(XY)
  |> startProfile(at = [-10, -10])
  |> line(end = [20, 0], tag = $seg01)
  |> line(end = [0, 20], tag = $seg01)
  |> line(end = [-20, 0])
  |> close()
  "#
                .to_string(),
            }],
        })
        .await;

    // Get the token map.
    let token_map = server.token_map.get("file:///test.kcl").unwrap().clone();
    assert!(!token_map.is_empty());

    // Get the ast.
    let ast = server.ast_map.get("file:///test.kcl").unwrap().clone();
    assert!(ast.ast != Node::<Program>::default());

    // Get the symbols map.
    let symbols_map = server.symbols_map.get("file:///test.kcl").unwrap().clone();
    assert!(!symbols_map.is_empty());

    // Get the semantic tokens map.
    let semantic_tokens_map = server.semantic_tokens_map.get("file:///test.kcl").unwrap().clone();
    assert!(!semantic_tokens_map.is_empty());

    // Assure we have diagnostics.

    // Check the diagnostics.
    assert_diagnostic_count(server.diagnostics_map.get("file:///test.kcl").as_deref(), 2);

    server.executor_ctx().await.clone().unwrap().close().await;
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_kcl_lsp_completions_number_literal() {
    let server = kcl_lsp_server(false).await.unwrap();

    server
        .did_open(tower_lsp::lsp_types::DidOpenTextDocumentParams {
            text_document: tower_lsp::lsp_types::TextDocumentItem {
                uri: "file:///test.kcl".try_into().unwrap(),
                language_id: "kcl".to_string(),
                version: 1,
                text: "thing = 10".to_string(),
            },
        })
        .await;

    let completions = server
        .completion(tower_lsp::lsp_types::CompletionParams {
            text_document_position: tower_lsp::lsp_types::TextDocumentPositionParams {
                text_document: tower_lsp::lsp_types::TextDocumentIdentifier {
                    uri: "file:///test.kcl".try_into().unwrap(),
                },
                position: tower_lsp::lsp_types::Position { line: 0, character: 10 },
            },
            context: None,
            partial_result_params: Default::default(),
            work_done_progress_params: Default::default(),
        })
        .await
        .unwrap();

    assert_eq!(completions.is_none(), true);
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_kcl_lsp_multi_file_error() {
    let server = kcl_lsp_server(true).await.unwrap();

    let cwd = std::env::current_dir().unwrap();
    let joined = cwd.join("tests/import_file_parse_error/");

    // Change the current directory.
    std::env::set_current_dir(joined).unwrap();

    let code = std::fs::read_to_string("input.kcl").unwrap();

    // Send open file.
    server
        .did_open(tower_lsp::lsp_types::DidOpenTextDocumentParams {
            text_document: tower_lsp::lsp_types::TextDocumentItem {
                uri: "file:///input.kcl".try_into().unwrap(),
                language_id: "kcl".to_string(),
                version: 1,
                text: code.clone(),
            },
        })
        .await;

    // Send diagnostics request.
    let diagnostics = server
        .diagnostic(tower_lsp::lsp_types::DocumentDiagnosticParams {
            text_document: tower_lsp::lsp_types::TextDocumentIdentifier {
                uri: "file:///input.kcl".try_into().unwrap(),
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
            let item = diagnostics.full_document_diagnostic_report.items.first().unwrap();
            assert_eq!(item.message, "syntax: Unexpected token: }");
            assert_eq!(
                Some(vec![tower_lsp::lsp_types::DiagnosticRelatedInformation {
                    location: tower_lsp::lsp_types::Location {
                        uri: "file:///parse-failure.kcl".try_into().unwrap(),
                        range: tower_lsp::lsp_types::Range {
                            start: tower_lsp::lsp_types::Position { line: 1, character: 9 },
                            end: tower_lsp::lsp_types::Position { line: 2, character: 1 },
                        },
                    },
                    message: "syntax: Unexpected token: }".to_string(),
                }]),
                item.related_information
            );
        } else {
            panic!("Expected full diagnostics");
        }
    } else {
        panic!("Expected diagnostics");
    }

    server.executor_ctx().await.clone().unwrap().close().await;
}

#[tokio::test(flavor = "multi_thread")]
async fn test_kcl_lsp_on_hover_untitled_file_scheme() {
    let server = kcl_lsp_server(true).await.unwrap();

    // Send open file.
    server
        .did_open(tower_lsp::lsp_types::DidOpenTextDocumentParams {
            text_document: tower_lsp::lsp_types::TextDocumentItem {
                uri: "untitled:Untitled-1".try_into().unwrap(),
                language_id: "kcl".to_string(),
                version: 1,
                text: r#"startSketchOn(XY)
foo = 42
foo

fn bar(@x: string): string {
  return x
}

bar("an arg")

startSketchOn(XY)
  |> startProfile(at = [0, 0])
  |> line(end = [10, 0])
  |> line(end = [0, 10])
"#
                .to_string(),
            },
        })
        .await;

    // Std lib call
    let hover = server
        .hover(tower_lsp::lsp_types::HoverParams {
            text_document_position_params: tower_lsp::lsp_types::TextDocumentPositionParams {
                text_document: tower_lsp::lsp_types::TextDocumentIdentifier {
                    uri: "untitled:Untitled-1".try_into().unwrap(),
                },
                position: tower_lsp::lsp_types::Position { line: 0, character: 2 },
            },
            work_done_progress_params: Default::default(),
        })
        .await
        .unwrap();

    match hover.unwrap().contents {
        tower_lsp::lsp_types::HoverContents::Markup(tower_lsp::lsp_types::MarkupContent { value, .. }) => {
            assert!(value.contains("startSketchOn"));
            assert!(value.contains(": Plane | Face"));
            assert!(value.contains("Start a new 2-dimensional sketch on a specific"));
        }
        _ => unreachable!(),
    }

    // Variable use
    let hover = server
        .hover(tower_lsp::lsp_types::HoverParams {
            text_document_position_params: tower_lsp::lsp_types::TextDocumentPositionParams {
                text_document: tower_lsp::lsp_types::TextDocumentIdentifier {
                    uri: "untitled:Untitled-1".try_into().unwrap(),
                },
                position: tower_lsp::lsp_types::Position { line: 2, character: 1 },
            },
            work_done_progress_params: Default::default(),
        })
        .await
        .unwrap();

    match hover.unwrap().contents {
        tower_lsp::lsp_types::HoverContents::Markup(tower_lsp::lsp_types::MarkupContent { value, .. }) => {
            assert!(value.contains("foo: number = 42"));
        }
        _ => unreachable!(),
    }

    // User-defined function call.
    let hover = server
        .hover(tower_lsp::lsp_types::HoverParams {
            text_document_position_params: tower_lsp::lsp_types::TextDocumentPositionParams {
                text_document: tower_lsp::lsp_types::TextDocumentIdentifier {
                    uri: "untitled:Untitled-1".try_into().unwrap(),
                },
                position: tower_lsp::lsp_types::Position { line: 8, character: 1 },
            },
            work_done_progress_params: Default::default(),
        })
        .await
        .unwrap();

    match hover.unwrap().contents {
        tower_lsp::lsp_types::HoverContents::Markup(tower_lsp::lsp_types::MarkupContent { value, .. }) => {
            assert!(value.contains("bar(@x: string): string"));
        }
        _ => unreachable!(),
    }

    // Variable inside a function
    let hover = server
        .hover(tower_lsp::lsp_types::HoverParams {
            text_document_position_params: tower_lsp::lsp_types::TextDocumentPositionParams {
                text_document: tower_lsp::lsp_types::TextDocumentIdentifier {
                    uri: "untitled:Untitled-1".try_into().unwrap(),
                },
                position: tower_lsp::lsp_types::Position { line: 5, character: 9 },
            },
            work_done_progress_params: Default::default(),
        })
        .await
        .unwrap();

    match hover.unwrap().contents {
        tower_lsp::lsp_types::HoverContents::Markup(tower_lsp::lsp_types::MarkupContent { value, .. }) => {
            assert!(value.contains("x: string"));
        }
        _ => unreachable!(),
    }

    // std function KwArg
    let hover = server
        .hover(tower_lsp::lsp_types::HoverParams {
            text_document_position_params: tower_lsp::lsp_types::TextDocumentPositionParams {
                text_document: tower_lsp::lsp_types::TextDocumentIdentifier {
                    uri: "untitled:Untitled-1".try_into().unwrap(),
                },
                position: tower_lsp::lsp_types::Position {
                    line: 12,
                    character: 11,
                },
            },
            work_done_progress_params: Default::default(),
        })
        .await
        .unwrap();

    match hover.unwrap().contents {
        tower_lsp::lsp_types::HoverContents::Markup(tower_lsp::lsp_types::MarkupContent { value, .. }) => {
            assert!(value.contains("end?: Point2d"));
            assert!(value.contains("How far away (along the X and Y axes) should this line go?"));
        }
        _ => unreachable!(),
    }

    server.executor_ctx().await.clone().unwrap().close().await;
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_kcl_lsp_code_actions_lint_offset_planes() {
    let server = kcl_lsp_server(false).await.unwrap();

    // Send open file.
    server
        .did_open(tower_lsp::lsp_types::DidOpenTextDocumentParams {
            text_document: tower_lsp::lsp_types::TextDocumentItem {
                uri: "file:///testlint.kcl".try_into().unwrap(),
                language_id: "kcl".to_string(),
                version: 1,
                text: r#"startSketchOn({
    origin = { x = 0, y = -14.3, z = 0 },
    xAxis = { x = 1, y = 0, z = 0 },
    yAxis = { x = 0, y = 0, z = 1 },
})
|> startProfile(at = [0, 0])"#
                    .to_string(),
            },
        })
        .await;

    // Send diagnostics request.
    let diagnostics = server
        .diagnostic(tower_lsp::lsp_types::DocumentDiagnosticParams {
            text_document: tower_lsp::lsp_types::TextDocumentIdentifier {
                uri: "file:///testlint.kcl".try_into().unwrap(),
            },
            partial_result_params: Default::default(),
            work_done_progress_params: Default::default(),
            identifier: None,
            previous_result_id: None,
        })
        .await
        .unwrap();

    // Check the diagnostics.
    let tower_lsp::lsp_types::DocumentDiagnosticReportResult::Report(diagnostics) = diagnostics else {
        panic!("Expected diagnostics");
    };

    let tower_lsp::lsp_types::DocumentDiagnosticReport::Full(diagnostics) = diagnostics else {
        panic!("Expected full diagnostics");
    };
    assert_eq!(diagnostics.full_document_diagnostic_report.items.len(), 1);
    assert_eq!(
        diagnostics.full_document_diagnostic_report.items[0].message,
        "offsetPlane should be used to define a new plane offset from the origin"
    );

    // Make sure we get the suggestion data.
    assert_eq!(
        diagnostics.full_document_diagnostic_report.items[0]
            .data
            .clone()
            .map(|d| serde_json::from_value::<LspSuggestion>(d).unwrap()),
        Some((
            Suggestion {
                insert: "offsetPlane(XZ, offset = -14.3)".to_string(),
                source_range: SourceRange::new(14, 133, Default::default()),
                title: "use offsetPlane instead".to_string(),
            },
            tower_lsp::lsp_types::Range {
                start: tower_lsp::lsp_types::Position { line: 0, character: 14 },
                end: tower_lsp::lsp_types::Position { line: 4, character: 1 },
            }
        ))
    );

    let diagnostic = diagnostics.full_document_diagnostic_report.items[0].clone();

    // Run a code action.
    let code_action = server
        .code_action(tower_lsp::lsp_types::CodeActionParams {
            text_document: tower_lsp::lsp_types::TextDocumentIdentifier {
                uri: "file:///testlint.kcl".try_into().unwrap(),
            },
            range: tower_lsp::lsp_types::Range {
                start: tower_lsp::lsp_types::Position { line: 0, character: 14 },
                end: tower_lsp::lsp_types::Position { line: 4, character: 1 },
            },
            context: tower_lsp::lsp_types::CodeActionContext {
                diagnostics: vec![diagnostic.clone()],
                only: None,
                trigger_kind: Default::default(),
            },
            work_done_progress_params: Default::default(),
            partial_result_params: Default::default(),
        })
        .await
        .unwrap();

    assert!(code_action.is_some());

    let code_action = code_action.unwrap();

    assert_eq!(code_action.len(), 1);

    assert_eq!(
        code_action[0],
        CodeActionOrCommand::CodeAction(tower_lsp::lsp_types::CodeAction {
            title: "use offsetPlane instead".to_string(),
            kind: Some(CodeActionKind::QUICKFIX),
            diagnostics: Some(vec![diagnostic]),
            edit: Some(WorkspaceEdit {
                changes: Some(HashMap::from_iter(vec![(
                    "file:///testlint.kcl".try_into().unwrap(),
                    vec![TextEdit {
                        range: tower_lsp::lsp_types::Range {
                            start: tower_lsp::lsp_types::Position { line: 0, character: 14 },
                            end: tower_lsp::lsp_types::Position { line: 4, character: 1 },
                        },
                        new_text: "offsetPlane(XZ, offset = -14.3)".to_string(),
                    }],
                )])),
                document_changes: None,
                change_annotations: None,
            }),
            command: None,
            is_preferred: Some(true),
            disabled: None,
            data: None,
        })
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn test_kcl_lsp_prepare_rename() {
    let server = kcl_lsp_server(false).await.unwrap();

    // Send open file.
    server
        .did_open(tower_lsp::lsp_types::DidOpenTextDocumentParams {
            text_document: tower_lsp::lsp_types::TextDocumentItem {
                uri: "file:///test.kcl".try_into().unwrap(),
                language_id: "kcl".to_string(),
                version: 1,
                text: r#"thing= 1"#.to_string(),
            },
        })
        .await;

    // Send rename request.
    let result = server
        .prepare_rename(tower_lsp::lsp_types::TextDocumentPositionParams {
            text_document: tower_lsp::lsp_types::TextDocumentIdentifier {
                uri: "file:///test.kcl".try_into().unwrap(),
            },
            position: tower_lsp::lsp_types::Position { line: 0, character: 2 },
        })
        .await
        .unwrap()
        .unwrap();

    // Check the result.
    assert_eq!(
        result,
        PrepareRenameResponse::DefaultBehavior { default_behavior: true }
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn test_kcl_lsp_document_color() {
    let server = kcl_lsp_server(false).await.unwrap();

    // Send open file.
    server
        .did_open(tower_lsp::lsp_types::DidOpenTextDocumentParams {
            text_document: tower_lsp::lsp_types::TextDocumentItem {
                uri: "file:///test.kcl".try_into().unwrap(),
                language_id: "kcl".to_string(),
                version: 1,
                text: r#"// Add color to a revolved solid.
sketch001 = startSketchOn(XY)
  |> circle(center = [15, 0], radius = 5)
  |> revolve(angle = 360, axis = Y)
  |> appearance(color = '#ff0000', metalness = 90, roughness = 90)"#
                    .to_string(),
            },
        })
        .await;

    // Send document color request.
    let result = server
        .document_color(tower_lsp::lsp_types::DocumentColorParams {
            text_document: tower_lsp::lsp_types::TextDocumentIdentifier {
                uri: "file:///test.kcl".try_into().unwrap(),
            },
            work_done_progress_params: Default::default(),
            partial_result_params: Default::default(),
        })
        .await
        .unwrap();

    // Check the result.
    assert_eq!(
        result,
        vec![tower_lsp::lsp_types::ColorInformation {
            range: tower_lsp::lsp_types::Range {
                start: tower_lsp::lsp_types::Position { line: 4, character: 25 },
                end: tower_lsp::lsp_types::Position { line: 4, character: 32 },
            },
            color: tower_lsp::lsp_types::Color {
                red: 1.0,
                green: 0.0,
                blue: 0.0,
                alpha: 1.0,
            },
        }]
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn test_kcl_lsp_color_presentation() {
    let server = kcl_lsp_server(false).await.unwrap();

    let text = r#"// Add color to a revolved solid.
sketch001 = startSketchOn(XY)
  |> circle(center = [15, 0], radius = 5)
  |> revolve(angle = 360, axis = Y)
  |> appearance(color = '#ff0000', metalness = 90, roughness = 90)"#;

    // Send open file.
    server
        .did_open(tower_lsp::lsp_types::DidOpenTextDocumentParams {
            text_document: tower_lsp::lsp_types::TextDocumentItem {
                uri: "file:///test.kcl".try_into().unwrap(),
                language_id: "kcl".to_string(),
                version: 1,
                text: text.to_string(),
            },
        })
        .await;

    // Send document color request.
    let result = server
        .document_color(tower_lsp::lsp_types::DocumentColorParams {
            text_document: tower_lsp::lsp_types::TextDocumentIdentifier {
                uri: "file:///test.kcl".try_into().unwrap(),
            },
            work_done_progress_params: Default::default(),
            partial_result_params: Default::default(),
        })
        .await
        .unwrap();

    // Check the result.
    assert_eq!(
        result,
        vec![tower_lsp::lsp_types::ColorInformation {
            range: tower_lsp::lsp_types::Range {
                start: tower_lsp::lsp_types::Position { line: 4, character: 25 },
                end: tower_lsp::lsp_types::Position { line: 4, character: 32 },
            },
            color: tower_lsp::lsp_types::Color {
                red: 1.0,
                green: 0.0,
                blue: 0.0,
                alpha: 1.0,
            },
        }]
    );

    // Send color presentation request.
    let result = server
        .color_presentation(tower_lsp::lsp_types::ColorPresentationParams {
            text_document: tower_lsp::lsp_types::TextDocumentIdentifier {
                uri: "file:///test.kcl".try_into().unwrap(),
            },
            range: tower_lsp::lsp_types::Range {
                start: tower_lsp::lsp_types::Position { line: 4, character: 25 },
                end: tower_lsp::lsp_types::Position { line: 4, character: 32 },
            },
            color: tower_lsp::lsp_types::Color {
                red: 1.0,
                green: 0.0,
                blue: 1.0,
                alpha: 1.0,
            },
            work_done_progress_params: Default::default(),
            partial_result_params: Default::default(),
        })
        .await
        .unwrap();

    // Check the result.
    assert_eq!(
        result,
        vec![tower_lsp::lsp_types::ColorPresentation {
            label: "#ff00ff".to_string(),
            text_edit: None,
            additional_text_edits: None,
        }]
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn test_kcl_lsp_diagnostic_compilation_warnings() {
    let server = kcl_lsp_server(false).await.unwrap();

    // Send open file.
    server
        .did_open(tower_lsp::lsp_types::DidOpenTextDocumentParams {
            text_document: tower_lsp::lsp_types::TextDocumentItem {
                uri: "file:///test.kcl".try_into().unwrap(),
                language_id: "kcl".to_string(),
                version: 1,
                text: r#"foo = 42
@settings(defaultLengthUnit = mm)"#
                    .to_string(),
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
                diagnostics.full_document_diagnostic_report.items[0],
                tower_lsp::lsp_types::Diagnostic {
                    range: tower_lsp::lsp_types::Range {
                        start: tower_lsp::lsp_types::Position { line: 0, character: 8 },
                        end: tower_lsp::lsp_types::Position { line: 1, character: 33 },
                    },
                    severity: Some(tower_lsp::lsp_types::DiagnosticSeverity::WARNING),
                    code: None,
                    source: Some("kcl".to_string()),
                    message: "Named attributes should appear before any declarations or expressions.\n\nBecause named attributes apply to the whole function or module, including code written before them, it can be confusing for readers to not have these attributes at the top of code blocks.".to_string(),
                    related_information: None,
                    tags: None,
                    data: None,
                    code_description: None,
                }
            );
        } else {
            panic!("Expected full diagnostics");
        }
    } else {
        panic!("Expected diagnostics");
    }
}
