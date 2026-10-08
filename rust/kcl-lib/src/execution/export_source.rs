use std::collections::BTreeMap;

use indexmap::IndexMap;
use kittycad_modeling_cmds::ImportFile;
use kittycad_modeling_cmds::shared::KclFile;
use kittycad_modeling_cmds::shared::KclProject;
use typed_path::Utf8TypedPath;

use crate::ExecutorSettings;
use crate::KclError;
use crate::SourceRange;
use crate::errors::KclErrorDetails;
use crate::modules::ModuleId;
use crate::modules::ModulePath;
use crate::modules::ModuleSource;

/// Files belonging to the successfully executed scene, shared by export contexts.
#[derive(Debug, Clone)]
pub(crate) struct ExportSource {
    pub kcl_source: KclProject,
    pub imported_files: Result<Vec<ImportFile>, KclError>,
}

/// Capture original inputs from execution, without rereading files or editor buffers.
pub(super) fn collect(
    sources: &IndexMap<ModuleId, ModuleSource>,
    imported_files: &[ImportFile],
    settings: &ExecutorSettings,
    entrypoint_source: &str,
) -> Option<ExportSource> {
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
            ModulePath::Local { value, .. } => normalize_path(&value.to_string(), &directory),
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
        directory.clone()
    };
    // Include sibling imports while keeping every stored path relative.
    for (_, path, _) in &files {
        while !path.starts_with(base.as_str()) {
            base = base.parent()?.to_path_buf();
        }
    }
    // Imports can widen the shared relative base. Invalid import metadata must
    // not discard KCL source or prevent exporting the geometry as STEP.
    let imported_files = match collect_imports(imported_files, &directory, base.clone()) {
        Ok((import_base, imports)) => {
            base = import_base;
            Ok(imports)
        }
        Err(error) => Err(error),
    };
    let relative = |path: &typed_path::Utf8TypedPathBuf| {
        path.strip_prefix(base.as_str())
            .ok()
            .map(|p| p.with_unix_encoding().to_string())
    };
    let entrypoint = relative(root_path)?;
    let files = files
        .into_iter()
        .map(|(_, path, source)| Some((relative(&path)?, source)))
        .collect::<Option<BTreeMap<_, _>>>()?;
    let files = files
        .into_iter()
        .map(|(path, source)| Some(KclFile::new(path.parse().ok()?, source.into_bytes())))
        .collect::<Option<_>>()?;
    Some(ExportSource {
        kcl_source: KclProject::new(files, entrypoint.parse().ok()?),
        imported_files,
    })
}

fn normalize_path(value: &str, directory: &typed_path::Utf8TypedPathBuf) -> typed_path::Utf8TypedPathBuf {
    let path = Utf8TypedPath::derive(value);
    if directory.is_absolute() && path.is_relative() {
        directory.join(path.as_str()).normalize()
    } else {
        path.normalize()
    }
}

fn collect_imports(
    imports: &[ImportFile],
    directory: &typed_path::Utf8TypedPathBuf,
    mut base: typed_path::Utf8TypedPathBuf,
) -> Result<(typed_path::Utf8TypedPathBuf, Vec<ImportFile>), KclError> {
    let invalid_path = |path: &typed_path::Utf8TypedPathBuf| {
        KclError::new_semantic(KclErrorDetails::new(
            format!(
                "Cannot export imported file `{path}` as glTF because it cannot share a relative project path. Move the file into the project and run it again."
            ),
            vec![SourceRange::default()],
        ))
    };
    for file in imports {
        let path = Utf8TypedPath::derive(&file.path);
        if base.is_relative() && path.is_relative() {
            let mut depth = 0usize;
            for component in path.components() {
                if component.is_normal() {
                    depth += 1;
                } else if component.is_parent() {
                    if depth == 0 {
                        return Err(invalid_path(&path.to_path_buf()));
                    }
                    depth -= 1;
                }
            }
        }
    }
    let paths: Vec<_> = imports
        .iter()
        .map(|file| (normalize_path(&file.path, directory), &file.data))
        .collect();
    for (path, _) in &paths {
        while !path.starts_with(base.as_str()) {
            base = base.parent().ok_or_else(|| invalid_path(path))?.to_path_buf();
        }
    }
    let mut files = BTreeMap::new();
    for (path, data) in &paths {
        let relative = path
            .strip_prefix(base.as_str())
            .map_err(|_| invalid_path(path))?
            .with_unix_encoding();
        if relative.as_str().is_empty() || relative.components().any(|component| !component.is_normal()) {
            return Err(invalid_path(path));
        }
        let relative = relative.to_string();
        if let Some(previous) = files.insert(relative.clone(), *data)
            && previous != *data
        {
            return Err(KclError::new_semantic(KclErrorDetails::new(
                format!("Imported file `{relative}` changed during execution. Run the project again before exporting."),
                vec![SourceRange::default()],
            )));
        }
    }
    let files = files
        .into_iter()
        .map(|(path, data)| ImportFile::builder().path(path).data(data.clone()).build())
        .collect();
    Ok((base, files))
}

#[cfg(test)]
mod tests {
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

    fn file(path: &str, source: &str) -> KclFile {
        KclFile::new(path.parse().unwrap(), source.as_bytes().to_vec())
    }

    struct RecordingTransport {
        inner: Arc<Box<dyn EngineTransport>>,
        exports: Arc<RwLock<Vec<Option<KclProject>>>>,
        imported_files: Arc<RwLock<Vec<Vec<ImportFile>>>>,
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
                self.imported_files.write().await.push(export.imported_files.clone());
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
        let mut expected = KclProject::new(
            vec![file("assembly.kcl", main), file("lib/main.kcl", width)],
            "assembly.kcl".parse().unwrap(),
        );
        let exports = Arc::new(RwLock::new(Vec::new()));
        let mut engine = EngineManager::new_mock();
        engine.transport = Arc::new(Box::new(RecordingTransport {
            inner: engine.transport.clone(),
            exports: exports.clone(),
            imported_files: Default::default(),
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
        expected.files[0].contents = main.as_bytes().to_vec();
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
        updated.files[1].contents = newer_width.as_bytes().to_vec();
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
        updated.entrypoint = "renamed.kcl".parse().unwrap();
        updated.files[0].path = "renamed.kcl".parse().unwrap();
        updated.files.sort_by_key(|file| file.path.to_string());
        export_ctx.export_step(true).await.unwrap();
        assert_eq!(exports.read().await.last(), Some(&Some(updated.clone())));

        let other_directory = TypedPath::new("/another-export-project");
        ctx.settings.project_directory = Some(other_directory.clone());
        ctx.settings.current_file = Some(other_directory.join("renamed.kcl"));
        ctx.fs = project_fs(&other_directory, width);
        ctx.run_with_caching(program.clone()).await.unwrap();
        updated.files[0].contents = width.as_bytes().to_vec();
        export_ctx.export_step(true).await.unwrap();
        assert_eq!(exports.read().await.last(), Some(&Some(updated.clone())));

        let mut state = ExecState::new(&ctx);
        ctx.send_clear_scene(Some(program.kcl_version), &mut state, SourceRange::default())
            .await
            .unwrap();
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
                &[],
                &ExecutorSettings {
                    project_directory: Some(TypedPath::from(directory)),
                    ..Default::default()
                },
                "// entry\r\n",
            )
            .unwrap();
            assert_eq!(bundle.kcl_source.entrypoint.to_string(), "design.kcl");
            assert_eq!(
                bundle.kcl_source.files,
                vec![
                    file("design.kcl", "// entry\r\n"),
                    file("size.kcl", "export size = 2\n")
                ]
            );
        }
    }

    fn import_file(path: &str, data: &[u8]) -> ImportFile {
        ImportFile::builder().path(path.to_owned()).data(data.to_vec()).build()
    }

    async fn export_gltf(ctx: &ExecutorContext) {
        ctx.export(kittycad_modeling_cmds::format::OutputFormat3d::Gltf(
            kittycad_modeling_cmds::format::gltf::export::Options::default(),
        ))
        .await
        .unwrap();
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn export_source_preserves_executed_import_bytes_and_dependencies() {
        cache::bust_cache().await;
        let directory = TypedPath::new("/export-imports-project");
        let main = "@settings(kclVersion = \"2.0\")\nimport \"assets/part.step\" as part\nimport \"assets/part.step\" as again\nimport \"models/mesh.gltf\" as mesh\n";
        let gltf = b"{\"asset\":{\"version\":\"2.0\"},\"buffers\":[{\"uri\":\"data/nested.bin\",\"byteLength\":4},{\"uri\":\"data/nested.bin\",\"byteLength\":4},{\"uri\":\"data:application/octet-stream;base64,AAAA\",\"byteLength\":3}]}";
        let part = [0, 255, 128, 13, 10];
        let bin = [255, 0, 128, 42];
        let fs = |part: &[u8], bin: Option<&[u8]>| {
            let mut files = vec![
                (directory.join("assets/part.step").to_string(), part.to_vec()),
                (directory.join("models/mesh.gltf").to_string(), gltf.to_vec()),
                (directory.join("unused.step").to_string(), vec![1, 2, 3]),
            ];
            if let Some(bin) = bin {
                files.push((directory.join("models/data/nested.bin").to_string(), bin.to_vec()));
            }
            crate::fs::new_file_system_handle(crate::InMemoryFiles::new(files.into_iter().collect()))
        };
        let expected = vec![
            import_file("assets/part.step", &part),
            import_file("models/data/nested.bin", &bin),
            import_file("models/mesh.gltf", gltf),
        ];
        let exports = Arc::new(RwLock::new(Vec::new()));
        let imported_files = Arc::new(RwLock::new(Vec::new()));
        let mut engine = EngineManager::new_mock();
        engine.transport = Arc::new(Box::new(RecordingTransport {
            inner: engine.transport.clone(),
            exports: exports.clone(),
            imported_files: imported_files.clone(),
        }));
        let mut ctx = ExecutorContext::new_with_engine_and_fs(
            Arc::new(engine),
            fs(&part, Some(&bin)),
            ExecutorSettings {
                project_directory: Some(directory.clone()),
                current_file: Some(directory.join("assembly.kcl")),
                ..Default::default()
            },
        );
        let export_ctx = ExecutorContext::new_with_engine(ctx.engine.clone(), Default::default());
        export_gltf(&export_ctx).await;
        assert_eq!(imported_files.read().await.last(), Some(&Vec::new()));

        let program = Program::parse_no_errs(main).unwrap();
        ctx.run_with_caching(program.clone()).await.unwrap();
        export_gltf(&export_ctx).await;
        assert_eq!(imported_files.read().await.last(), Some(&expected));
        let original_source = exports.read().await.last().cloned().unwrap();

        ctx.export_step(true).await.unwrap();
        assert_eq!(imported_files.read().await.last(), Some(&Vec::new()));
        ctx.run_with_caching(program.clone()).await.unwrap();
        export_gltf(&export_ctx).await;
        assert_eq!(imported_files.read().await.last(), Some(&expected));

        // A cache hit may read changed project files, but its geometry still owns the old bytes.
        ctx.fs = fs(&[3, 2, 1], Some(&[8, 7, 6, 5]));
        ctx.run_with_caching(program.clone()).await.unwrap();
        let mut mock = ctx.clone();
        mock.context_type = ContextType::Mock;
        mock.run_mock(&program, &MockConfig::default()).await.unwrap();
        export_gltf(&export_ctx).await;
        assert_eq!(imported_files.read().await.last(), Some(&expected));
        assert_eq!(exports.read().await.last(), Some(&original_source));

        // Missing dependencies fail execution and clear source metadata together.
        cache::bust_cache().await;
        ctx.fs = fs(&part, None);
        let failure = ctx.run_with_caching(program.clone()).await.unwrap_err();
        assert!(failure.error.message().contains("nested.bin"));
        export_gltf(&export_ctx).await;
        assert_eq!(imported_files.read().await.last(), Some(&Vec::new()));
        assert_eq!(exports.read().await.last(), Some(&None));

        ctx.fs = fs(&[3, 2, 1], Some(&[8, 7, 6, 5]));
        ctx.run_with_caching(program).await.unwrap();
        export_gltf(&export_ctx).await;
        let updated = vec![
            import_file("assets/part.step", &[3, 2, 1]),
            import_file("models/data/nested.bin", &[8, 7, 6, 5]),
            import_file("models/mesh.gltf", gltf),
        ];
        assert_eq!(imported_files.read().await.last(), Some(&updated));
        cache::bust_cache().await;
        ctx.close().await;
        assert!(ctx.engine.export_source.read().await.is_none());
    }

    #[test]
    fn export_source_normalizes_and_deduplicates_import_paths() {
        for directory in ["/project", r"C:\project"] {
            let main = format!("{directory}/design.kcl");
            let sources = IndexMap::from([(
                ModuleId::default(),
                ModuleSource {
                    path: ModulePath::Local {
                        value: TypedPath::from(&main),
                        original_import_path: None,
                    },
                    source: "// entry\n".to_owned(),
                },
            )]);
            let imports = vec![
                import_file(&format!("{directory}/assets/sub/../part.step"), &[0, 128, 255]),
                import_file(&format!("{directory}/assets/part.step"), &[0, 128, 255]),
            ];
            let bundle = collect(
                &sources,
                &imports,
                &ExecutorSettings {
                    project_directory: Some(TypedPath::from(directory)),
                    ..Default::default()
                },
                "// entry\n",
            )
            .unwrap();
            assert_eq!(
                bundle.imported_files.unwrap(),
                vec![import_file("assets/part.step", &[0, 128, 255])]
            );

            let conflicting = vec![imports[0].clone(), import_file(&imports[1].path, &[42])];
            let error = collect(
                &sources,
                &conflicting,
                &ExecutorSettings {
                    project_directory: Some(TypedPath::from(directory)),
                    ..Default::default()
                },
                "// entry\n",
            )
            .unwrap()
            .imported_files
            .unwrap_err();
            assert!(error.message().contains("changed during execution"));
        }
    }

    #[tokio::test]
    async fn export_source_omits_foreign_modules_until_executed() {
        let path = TypedPath::new("/project/part.glb");
        let bytes = b"glTF\x00\xff\x80";
        let ctx = ExecutorContext::new_with_engine_and_fs(
            Arc::new(EngineManager::new_mock()),
            crate::fs::new_file_system_handle(crate::InMemoryFiles::new(
                [(path.to_string(), bytes.to_vec())].into_iter().collect(),
            )),
            Default::default(),
        );
        let mut state = ExecState::new(&ctx);
        let geometry = crate::execution::import::import_foreign(&path, None, &mut state, &ctx, SourceRange::default())
            .await
            .unwrap();
        let id = ModuleId::from_usize(1);
        let module_path = ModulePath::Local {
            value: path.clone(),
            original_import_path: None,
        };
        state.add_path_to_source_id(module_path.clone(), id);
        state.add_module(
            id,
            module_path,
            crate::modules::ModuleRepr::Foreign(geometry.clone(), None),
        );
        assert!(state.global.imported_files().is_empty());
        state.global.module_infos.get_mut(&id).unwrap().repr =
            crate::modules::ModuleRepr::Foreign(geometry, Some((None, Default::default())));
        assert_eq!(
            state.global.imported_files(),
            vec![import_file(&path.to_string(), bytes)]
        );

        let missing = crate::execution::import::import_foreign(
            &TypedPath::new("/project/missing.step"),
            None,
            &mut state,
            &ctx,
            SourceRange::default(),
        )
        .await
        .unwrap_err();
        assert!(missing.message().contains("does not exist"));
    }

    #[tokio::test]
    async fn export_source_reports_invalid_import_metadata_only_for_gltf() {
        let directory = TypedPath::from(r"C:\project");
        let source = "// entry\n";
        let sources = IndexMap::from([(
            ModuleId::default(),
            ModuleSource {
                path: ModulePath::Local {
                    value: TypedPath::from(r"C:\project\design.kcl"),
                    original_import_path: None,
                },
                source: source.to_owned(),
            },
        )]);
        for (imports, message) in [
            (
                vec![import_file(r"D:\models\part.step", &[0, 255])],
                "cannot share a relative project path",
            ),
            (
                vec![
                    import_file(r"C:\project\part.step", &[0]),
                    import_file(r"C:\project\part.step", &[255]),
                ],
                "changed during execution",
            ),
        ] {
            let snapshot = collect(
                &sources,
                &imports,
                &ExecutorSettings {
                    project_directory: Some(directory.clone()),
                    ..Default::default()
                },
                source,
            )
            .unwrap();
            assert_eq!(snapshot.kcl_source.entrypoint.to_string(), "design.kcl");
            assert_eq!(snapshot.kcl_source.files, vec![file("design.kcl", source)]);
            assert!(
                snapshot
                    .imported_files
                    .as_ref()
                    .unwrap_err()
                    .message()
                    .contains(message)
            );
            let exports = Arc::new(RwLock::new(Vec::new()));
            let mut engine = EngineManager::new_mock();
            engine.transport = Arc::new(Box::new(RecordingTransport {
                inner: engine.transport.clone(),
                exports: exports.clone(),
                imported_files: Default::default(),
            }));
            *engine.export_source.write().await = Some(snapshot.clone());
            let ctx = ExecutorContext::new_with_engine(Arc::new(engine), Default::default());
            ctx.export_step(true).await.unwrap();
            assert_eq!(exports.read().await.last(), Some(&Some(snapshot.kcl_source)));
            let error = ctx
                .export(kittycad_modeling_cmds::format::OutputFormat3d::Gltf(
                    kittycad_modeling_cmds::format::gltf::export::Options::default(),
                ))
                .await
                .unwrap_err();
            assert!(error.message().contains(message));
            assert_eq!(exports.read().await.len(), 1);
        }
    }

    #[test]
    fn export_source_requires_relative_import_paths_without_a_project_directory() {
        let sources = IndexMap::from([(
            ModuleId::default(),
            ModuleSource {
                path: ModulePath::Main,
                source: "// entry\n".to_owned(),
            },
        )]);
        for path in ["/models/part.step", "../part.step", "nested/../../outside.step"] {
            let source = collect(
                &sources,
                &[import_file(path, &[255])],
                &Default::default(),
                "// entry\n",
            )
            .unwrap();
            assert_eq!(source.kcl_source.entrypoint.to_string(), "main.kcl");
            assert!(
                source
                    .imported_files
                    .unwrap_err()
                    .message()
                    .contains("relative project path")
            );
        }
        let source = collect(
            &sources,
            &[import_file("nested/../part.step", &[255])],
            &Default::default(),
            "// entry\n",
        )
        .unwrap();
        assert_eq!(source.imported_files.unwrap(), vec![import_file("part.step", &[255])]);
    }
}
