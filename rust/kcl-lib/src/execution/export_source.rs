use indexmap::IndexMap;
use kittycad_modeling_cmds::shared::KclSource;
use typed_path::Utf8TypedPath;

use crate::ExecutorSettings;
use crate::modules::ModuleId;
use crate::modules::ModulePath;
use crate::modules::ModuleSource;

/// Capture original text from execution, without rereading files or editor buffers.
pub(super) fn collect(
    sources: &IndexMap<ModuleId, ModuleSource>,
    settings: &ExecutorSettings,
    entrypoint_source: &str,
) -> Option<KclSource> {
    if entrypoint_source.is_empty() {
        return None;
    }
    let directory = settings
        .project_directory
        .as_ref()
        .map(ToString::to_string)
        .unwrap_or_default();
    let directory = Utf8TypedPath::derive(&directory).normalize();
    let mut files = Vec::new();
    for (id, source) in sources {
        let path = match &source.path {
            ModulePath::Std { .. } => continue,
            ModulePath::Main => directory.join("main.kcl"),
            ModulePath::Local { value, .. } if value.to_string().is_empty() => directory.join("main.kcl"),
            ModulePath::Local { value, .. } => {
                let path = Utf8TypedPath::derive(&value.to_string()).normalize();
                if directory.is_absolute() && path.is_relative() {
                    directory.join(path.as_str()).normalize()
                } else {
                    path
                }
            }
        };
        // A successful cache hit can have newer comments or whitespace in the entrypoint.
        let text = if *id == ModuleId::default() {
            entrypoint_source
        } else {
            &source.source
        };
        files.push((*id, path, text.to_owned()));
    }

    let root_path = &files.iter().find(|(id, _, _)| *id == ModuleId::default())?.1;
    let mut base = if directory.as_str().is_empty() {
        root_path.parent()?.to_path_buf()
    } else {
        directory
    };
    // Include sibling imports while keeping every stored path relative.
    for (_, path, _) in &files {
        while !path.starts_with(base.as_str()) {
            base = base.parent()?.to_path_buf();
        }
    }
    let relative = |path: &typed_path::Utf8TypedPathBuf| {
        path.strip_prefix(base.as_str())
            .ok()
            .map(|p| p.with_unix_encoding().to_string())
    };
    let entrypoint = relative(root_path)?;
    let files = files
        .into_iter()
        .map(|(_, path, source)| Some((relative(&path)?, source)))
        .collect::<Option<_>>()?;
    Some(KclSource::builder().entrypoint(entrypoint).files(files).build())
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;
    use std::collections::HashMap;
    use std::sync::Arc;

    use kittycad_modeling_cmds::ModelingCmd;
    use kittycad_modeling_cmds::websocket::ModelingCmdReq;
    use kittycad_modeling_cmds::websocket::OkWebSocketResponseData;
    use kittycad_modeling_cmds::websocket::SuccessWebSocketResponse;
    use kittycad_modeling_cmds::websocket::WebSocketRequest;
    use kittycad_modeling_cmds::websocket::WebSocketResponse;
    use tokio::sync::RwLock;
    use uuid::Uuid;

    use super::*;
    use crate::KclError;
    use crate::Program;
    use crate::SourceRange;
    use crate::TypedPath;
    use crate::engine_connection::EngineManager;
    use crate::engine_connection::EngineTransport;
    use crate::engine_connection::TransportCloseError;
    use crate::execution::ContextType;
    use crate::execution::ExecState;
    use crate::execution::ExecutorContext;
    use crate::execution::MockConfig;
    use crate::execution::cache;

    struct RecordingTransport {
        inner: Arc<Box<dyn EngineTransport>>,
        exports: Arc<RwLock<Vec<Option<KclSource>>>>,
    }

    #[async_trait::async_trait]
    impl EngineTransport for RecordingTransport {
        async fn inner_fire_modeling_cmd(
            &self,
            id: Uuid,
            range: SourceRange,
            cmd: WebSocketRequest,
            ranges: HashMap<Uuid, SourceRange>,
        ) -> Result<(), KclError> {
            self.inner.inner_fire_modeling_cmd(id, range, cmd, ranges).await
        }

        async fn inner_send_modeling_cmd(
            &self,
            id: Uuid,
            range: SourceRange,
            cmd: WebSocketRequest,
            ranges: HashMap<Uuid, SourceRange>,
        ) -> Result<WebSocketResponse, KclError> {
            if let WebSocketRequest::ModelingCmdReq(ModelingCmdReq {
                cmd: ModelingCmd::Export(export),
                ..
            }) = &cmd
            {
                self.exports.write().await.push(export.kcl_source.clone());
                return Ok(WebSocketResponse::Success(SuccessWebSocketResponse {
                    request_id: Some(id),
                    resp: OkWebSocketResponseData::Export { files: Vec::new() },
                    success: true,
                }));
            }
            self.inner.inner_send_modeling_cmd(id, range, cmd, ranges).await
        }

        async fn close(&self) -> Result<(), TransportCloseError> {
            self.inner.close().await
        }
    }

    fn project_fs(directory: &TypedPath, width: &str) -> crate::fs::FileSystemHandle {
        crate::fs::new_file_system_handle(crate::InMemoryFiles::new(
            [
                (directory.join("lib/main.kcl").to_string(), width.as_bytes().to_vec()),
                (
                    directory.join("unused.kcl").to_string(),
                    b"export unused = 100\n".to_vec(),
                ),
                (directory.join("unused.step").to_string(), vec![0, 255, 128]),
            ]
            .into_iter()
            .collect(),
        ))
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn export_source_tracks_execution_cache_failures_and_scene_lifetime() {
        cache::bust_cache().await;
        let directory = TypedPath::new("/export-source-project");
        let main = "@settings(kclVersion = \"2.0\")\r\nimport width from \"lib/main.kcl\"\r\n// Designer's \"part\": \u{03c0}\r\nshape = sketch(on = XY) {\r\n  edge = line(start = [var 0mm, var 0mm], end = [width, var 0mm])\r\n}\r\n";
        let width = "@settings(kclVersion = \"2.0\")\nexport width = 10mm\n";
        let newer_width = "@settings(kclVersion = \"2.0\")\nexport width = 20mm\n";
        let mut expected = KclSource::builder()
            .entrypoint("assembly.kcl".to_owned())
            .files(BTreeMap::from([
                ("assembly.kcl".to_owned(), main.to_owned()),
                ("lib/main.kcl".to_owned(), width.to_owned()),
            ]))
            .build();
        let exports = Arc::new(RwLock::new(Vec::new()));
        let mut engine = EngineManager::new_mock();
        engine.transport = Arc::new(Box::new(RecordingTransport {
            inner: engine.transport.clone(),
            exports: exports.clone(),
        }));
        let mut ctx = ExecutorContext::new_with_engine_and_fs(
            Arc::new(engine),
            project_fs(&directory, width),
            ExecutorSettings {
                project_directory: Some(directory.clone()),
                current_file: Some(directory.join("assembly.kcl")),
                ..Default::default()
            },
        );
        let export_ctx = ExecutorContext::new_with_engine(ctx.engine.clone(), Default::default());
        export_ctx.export_step(true).await.unwrap();
        assert_eq!(exports.read().await.last(), Some(&None));

        let program = Program::parse_no_errs(main).unwrap();
        let outcome = ctx.run_with_caching(program.clone()).await.unwrap();
        assert_eq!(outcome.errors().count(), 0);
        export_ctx.export_step(true).await.unwrap();
        assert_eq!(exports.read().await.last(), Some(&Some(expected.clone())));

        // An unchanged program/import cache hit must retain the executed source.
        ctx.run_with_caching(program.clone()).await.unwrap();
        ctx.export_step(true).await.unwrap();
        assert_eq!(exports.read().await.last(), Some(&Some(expected.clone())));

        let main = format!("{main}\n// Updated comment\n");
        let program = Program::parse_no_errs(&main).unwrap();
        ctx.run_with_caching(program.clone()).await.unwrap();
        expected.files.insert("assembly.kcl".to_owned(), main.clone());
        ctx.export_step(true).await.unwrap();
        assert_eq!(exports.read().await.last(), Some(&Some(expected.clone())));

        // Files and editor text may change without changing the exported scene.
        ctx.fs = project_fs(&directory, newer_width);
        let mut mock = ctx.clone();
        mock.context_type = ContextType::Mock;
        mock.run_mock(
            &Program::parse_no_errs("@settings(kclVersion = \"2.0\")\nx = 42\n").unwrap(),
            &MockConfig {
                use_prev_memory: false,
                ..Default::default()
            },
        )
        .await
        .unwrap();
        ctx.export_step(true).await.unwrap();
        assert_eq!(exports.read().await.last(), Some(&Some(expected.clone())));

        ctx.run_with_caching(program.clone()).await.unwrap();
        let mut updated = expected;
        updated.files.insert("lib/main.kcl".to_owned(), newer_width.to_owned());
        ctx.export_step(true).await.unwrap();
        assert_eq!(exports.read().await.last(), Some(&Some(updated.clone())));

        let failure = Program::parse_no_errs(&format!("{main}\nbroken = missingName\n")).unwrap();
        ctx.run_with_caching(failure).await.unwrap_err();
        ctx.export_step(true).await.unwrap();
        assert_eq!(exports.read().await.last(), Some(&None));

        ctx.run_with_caching(program.clone()).await.unwrap();
        ctx.export_step(true).await.unwrap();
        assert_eq!(exports.read().await.last(), Some(&Some(updated.clone())));

        ctx.settings.current_file = Some(directory.join("renamed.kcl"));
        ctx.run_with_caching(program.clone()).await.unwrap();
        updated.entrypoint = "renamed.kcl".to_owned();
        let main_source = updated.files.remove("assembly.kcl").unwrap();
        updated.files.insert("renamed.kcl".to_owned(), main_source);
        export_ctx.export_step(true).await.unwrap();
        assert_eq!(exports.read().await.last(), Some(&Some(updated.clone())));

        let other_directory = TypedPath::new("/another-export-project");
        ctx.settings.project_directory = Some(other_directory.clone());
        ctx.settings.current_file = Some(other_directory.join("renamed.kcl"));
        ctx.fs = project_fs(&other_directory, width);
        ctx.run_with_caching(program.clone()).await.unwrap();
        updated.files.insert("lib/main.kcl".to_owned(), width.to_owned());
        export_ctx.export_step(true).await.unwrap();
        assert_eq!(exports.read().await.last(), Some(&Some(updated.clone())));

        let mut state = ExecState::new(&ctx);
        ctx.send_clear_scene(&mut state, SourceRange::default()).await.unwrap();
        ctx.export_step(true).await.unwrap();
        assert_eq!(exports.read().await.last(), Some(&None));

        // Native kcl-lib callers use run rather than Studio's cached execution.
        ctx.run(&program, &mut state).await.unwrap();
        ctx.export_step(true).await.unwrap();
        assert_eq!(exports.read().await.last(), Some(&Some(updated)));
        cache::bust_cache().await;
        ctx.close().await;
        assert!(ctx.engine.export_source.read().await.is_none());
    }

    #[test]
    fn export_source_normalizes_portable_paths_and_omits_standard_library() {
        for (directory, main, import) in [
            ("/project", "/project/design.kcl", "/project/lib/../size.kcl"),
            (r"C:\project", r"C:\project\design.kcl", r"C:\project\lib\..\size.kcl"),
        ] {
            let source = |path: &str, text: &str| ModuleSource {
                path: ModulePath::Local {
                    value: TypedPath::from(path),
                    original_import_path: None,
                },
                source: text.to_owned(),
            };
            let sources = IndexMap::from([
                (ModuleId::default(), source(main, "// entry\r\n")),
                (ModuleId::from_usize(1), source(import, "export size = 2\n")),
                (
                    ModuleId::from_usize(2),
                    ModuleSource {
                        path: ModulePath::Std {
                            value: "prelude".to_owned(),
                        },
                        source: "standard library".to_owned(),
                    },
                ),
            ]);
            let bundle = collect(
                &sources,
                &ExecutorSettings {
                    project_directory: Some(TypedPath::from(directory)),
                    ..Default::default()
                },
                "// entry\r\n",
            )
            .unwrap();
            assert_eq!(bundle.entrypoint, "design.kcl");
            assert_eq!(
                bundle.files,
                BTreeMap::from([
                    ("design.kcl".to_owned(), "// entry\r\n".to_owned()),
                    ("size.kcl".to_owned(), "export size = 2\n".to_owned())
                ])
            );
        }
    }
}
