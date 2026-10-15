//! Native clients can execute a project on their existing engine connection.
use std::borrow::Cow;
use std::collections::VecDeque;
use std::path::Path;
use std::path::PathBuf;

use indexmap::IndexMap;
use kittycad_modeling_cmds::exec_kcl::ExecKclProjectErr;
use kittycad_modeling_cmds::exec_kcl::ExecKclProjectOk;
use kittycad_modeling_cmds::exec_kcl::KclFile;
use kittycad_modeling_cmds::exec_kcl::KclProject;
use kittycad_modeling_cmds::shared::safe_filepath::SafeFilepath;
use kittycad_modeling_cmds::websocket::OkWebSocketResponseData;
use kittycad_modeling_cmds::websocket::WebSocketRequest;

use super::ExecOutcome;
use super::ExecState;
use super::ExecutorContext;
use super::IdGenerator;
use super::OperationsByModule;
use crate::Program;
use crate::SourceRange;
use crate::TypedPath;
use crate::engine::GridScaleBehavior;
use crate::errors::KclError;
use crate::errors::KclErrorDetails;
use crate::errors::KclErrorWithOutputs;
use crate::modules::ModuleId;
use crate::modules::ModulePath;
use crate::modules::ModuleSource;
use crate::parsing::ast::types::ImportPath;

impl ExecutorContext {
    /// Execute KCL on the engine, retaining this connection for follow-up commands.
    /// `state` holds only client-side follow-up settings, not interpreter memory.
    pub async fn execute_remote_project(
        &self,
        program: &Program,
        state: &mut ExecState,
    ) -> Result<ExecOutcome, KclErrorWithOutputs> {
        let mut project = UploadedProject::collect(self, program)
            .await
            .map_err(KclErrorWithOutputs::no_outputs)?;
        let id = uuid::Uuid::new_v4();
        let range = SourceRange::synthetic();
        let request = KclProject::new(
            std::mem::take(&mut project.request.files),
            project.request.entrypoint.clone(),
        );
        let response = self
            .engine
            .transport
            .inner_send_modeling_cmd(
                id,
                range,
                WebSocketRequest::ExecKclProject {
                    request_id: id,
                    project: request,
                },
                Default::default(),
            )
            .await
            .map_err(KclErrorWithOutputs::no_outputs)?;
        let response = self
            .engine
            .parse_websocket_response(response, range)
            .map_err(KclErrorWithOutputs::no_outputs)?;
        let OkWebSocketResponseData::ExecKclProject { result } = response else {
            return Err(KclErrorWithOutputs::no_outputs(remote_error(
                "Engine did not return an ExecKclProject response; update the engine to support remote KCL execution.",
            )));
        };
        let outcome = project.outcome(*result)?;

        state.mod_local.settings = program
            .meta_settings()
            .map_err(KclErrorWithOutputs::no_outputs)?
            .unwrap_or_default();
        state.mod_local.id_generator = IdGenerator::remote_session();
        *self.engine.get_default_planes().write().await = outcome.default_planes.clone();
        // The engine executes without client graphics settings. Reapply them before
        // snapshots, including overrides such as highlight_edges=False.
        let grid_scale = if self.settings.fixed_size_grid {
            GridScaleBehavior::Fixed(Some(state.length_unit()))
        } else {
            GridScaleBehavior::ScaleWithZoom
        };
        self.engine
            .reapply_settings(
                &self.engine_batch,
                &self.settings,
                range,
                state.id_generator(),
                grid_scale,
            )
            .await
            .map_err(|err| KclErrorWithOutputs::from_error_outcome(err, outcome.clone()))?;
        if !self.settings.geometry_only && self.settings.enable_ssao {
            self.engine
                .send_modeling_cmd(
                    &self.engine_batch,
                    state.next_uuid(),
                    range,
                    &kittycad_modeling_cmds::ModelingCmd::from(
                        kittycad_modeling_cmds::SetOrderIndependentTransparency::builder()
                            .enabled(false)
                            .build(),
                    ),
                )
                .await
                .map_err(|err| KclErrorWithOutputs::from_error_outcome(err, outcome.clone()))?;
        }
        Ok(outcome)
    }
}

fn remote_error(message: impl Into<String>) -> KclError {
    KclError::new_semantic(KclErrorDetails::new(message.into(), vec![SourceRange::synthetic()]))
}

/// Normalize uploaded virtual paths without accessing the host filesystem.
fn normalize(path: &Path) -> PathBuf {
    PathBuf::from(
        typed_path::TypedPath::derive(path.as_os_str().as_encoded_bytes())
            .normalize()
            .to_string_lossy()
            .as_ref(),
    )
}

struct UploadedProject {
    request: KclProject,
    /// Upload name -> original client filename and exact bytes sent to the engine.
    files: IndexMap<String, (PathBuf, Vec<u8>)>,
    inline: bool,
}

impl UploadedProject {
    async fn collect(ctx: &ExecutorContext, program: &Program) -> Result<Self, KclError> {
        let cwd = std::env::current_dir().map_err(|err| remote_error(err.to_string()))?;
        let root = normalize(
            &ctx.settings
                .current_file
                .as_ref()
                .map(|path| cwd.join(&path.0))
                .unwrap_or_else(|| {
                    ctx.settings
                        .project_directory
                        .as_ref()
                        .map(|dir| cwd.join(&dir.0))
                        .unwrap_or(cwd)
                        .join(format!("__zoo_kcl_{}.kcl", uuid::Uuid::new_v4()))
                }),
        );
        let mut files = IndexMap::new();
        files.insert(root.clone(), program.original_file_contents.as_bytes().to_vec());
        let mut pending = VecDeque::from([(root.clone(), Cow::Borrowed(program), Vec::<PathBuf>::new())]);
        while let Some((path, program, mut ancestors)) = pending.pop_front() {
            if let Ok(real_path) = tokio::fs::canonicalize(&path).await {
                if ancestors.contains(&real_path) {
                    continue;
                }
                ancestors.push(real_path);
            }
            let imports = std::cell::RefCell::new(Vec::new());
            crate::walk::walk(&program.ast, |node| {
                if let crate::walk::Node::ImportStatement(import) = node {
                    match &import.path {
                        ImportPath::Kcl { filename } => imports.borrow_mut().push((filename.clone(), true)),
                        ImportPath::Foreign { path } => imports.borrow_mut().push((path.clone(), false)),
                        ImportPath::Std { .. } => {}
                    }
                }
                Ok::<_, KclError>(true)
            })
            .map_err(|err| remote_error(err.to_string()))?;
            for (import, is_kcl) in imports.into_inner() {
                reject_absolute_import(&import.to_string())?;
                let imported_path = normalize(&path.parent().unwrap_or(Path::new("")).join(&import.0));
                if files.contains_key(&imported_path) {
                    continue;
                }
                // Leave missing files and invalid modules to the engine so its
                // diagnostics retain the correct source ranges and partial output.
                let Ok(bytes) = ctx
                    .fs
                    .read(&TypedPath(imported_path.clone()), SourceRange::synthetic())
                    .await
                else {
                    continue;
                };
                if is_kcl {
                    if let Ok(source) = std::str::from_utf8(&bytes)
                        && let Ok(imported) = Program::parse_no_errs(source)
                    {
                        pending.push_back((imported_path.clone(), Cow::Owned(imported), ancestors.clone()));
                    }
                } else if imported_path
                    .extension()
                    .is_some_and(|ext| ext.eq_ignore_ascii_case("gltf") || ext.eq_ignore_ascii_case("glb"))
                    && !bytes.starts_with(b"glTF")
                    && let Ok(gltf) = gltf_json::Root::from_slice(&bytes)
                {
                    for buffer in gltf.buffers {
                        if let Some(uri) = buffer.uri
                            && !uri.starts_with("data:")
                        {
                            reject_absolute_import(&uri)?;
                            let buffer_path = normalize(&imported_path.parent().unwrap_or(Path::new("")).join(uri));
                            if let Ok(data) = ctx
                                .fs
                                .read(&TypedPath(buffer_path.clone()), SourceRange::synthetic())
                                .await
                            {
                                files.entry(buffer_path).or_insert(data);
                            }
                        }
                    }
                }
                files.insert(imported_path, bytes);
            }
        }

        // A common root keeps relative parent imports inside the uploaded project.
        let mut directory = root.parent().unwrap_or(Path::new("")).to_path_buf();
        for path in files.keys() {
            while !path.starts_with(&directory) {
                if !directory.pop() {
                    return Err(remote_error("Imported files do not share a project root"));
                }
            }
        }
        let relative = |path: &Path| -> Result<String, KclError> {
            path.strip_prefix(&directory)
                .map(|path| path.to_string_lossy().replace('\\', "/"))
                .map_err(|err| remote_error(err.to_string()))
        };
        let entrypoint = safe_path(&relative(&root)?)?;
        let files: IndexMap<_, _> = files
            .into_iter()
            .map(|(path, bytes)| Ok((relative(&path)?, (path, bytes))))
            .collect::<Result<_, KclError>>()?;
        let request = KclProject::new(
            files
                .iter()
                .map(|(name, (_, bytes))| Ok(KclFile::new(safe_path(name)?, bytes.clone())))
                .collect::<Result<_, KclError>>()?,
            entrypoint,
        );
        Ok(Self {
            request,
            files,
            inline: ctx.settings.current_file.is_none(),
        })
    }

    fn sources(&self, filenames: &mut IndexMap<ModuleId, ModulePath>) -> IndexMap<ModuleId, ModuleSource> {
        let mut sources = IndexMap::new();
        for (id, path) in filenames {
            let source = if id.is_top_level() {
                let (original, bytes) = &self.files[&self.request.entrypoint.to_string()];
                *path = if self.inline {
                    ModulePath::Main
                } else {
                    ModulePath::Local {
                        value: TypedPath(original.clone()),
                        original_import_path: None,
                    }
                };
                Some(bytes.as_slice())
            } else {
                match path {
                    ModulePath::Main => Some(self.files[&self.request.entrypoint.to_string()].1.as_slice()),
                    ModulePath::Local { value, .. } => {
                        let name = normalize(&value.0).to_string_lossy().replace('\\', "/");
                        self.files.get(&name).map(|(original, bytes)| {
                            *value = TypedPath(original.clone());
                            bytes.as_slice()
                        })
                    }
                    ModulePath::Std { value } => crate::modules::read_std(value).map(str::as_bytes),
                }
            };
            if let Some(source) = source.and_then(|source| std::str::from_utf8(source).ok()) {
                sources.insert(
                    *id,
                    ModuleSource {
                        path: path.clone(),
                        source: source.to_owned(),
                    },
                );
            }
        }
        sources
    }

    fn outcome(&self, result: Result<ExecKclProjectOk, ExecKclProjectErr>) -> Result<ExecOutcome, KclErrorWithOutputs> {
        let mut response = match result {
            Ok(response) => response,
            Err(response) => {
                if let Some(mut error) = response.error {
                    self.restore_entrypoint_name(&mut error.details_mut().message);
                    let mut error = KclErrorWithOutputs::no_outputs(error);
                    error.non_fatal = response.non_fatal;
                    for issue in &mut error.non_fatal {
                        self.restore_entrypoint_name(&mut issue.message);
                    }
                    error.variables = response.variables;
                    error.operations = OperationsByModule {
                        map: response.operations,
                    };
                    error.artifact_graph = response.artifact_graph;
                    error.scene_objects = response.scene_objects;
                    error.filenames = response.filenames;
                    error.source_files = self.sources(&mut error.filenames);
                    error.default_planes = response.default_planes.map(|planes| *planes);
                    return Err(error);
                }
                // Completed execution with non-fatal errors still returns an
                // outcome, as the local interpreter does.
                ExecKclProjectOk::builder()
                    .variables(response.variables)
                    .operations(response.operations)
                    .artifact_graph(response.artifact_graph)
                    .scene_objects(response.scene_objects)
                    .filenames(response.filenames)
                    .issues(response.non_fatal)
                    .maybe_default_planes(response.default_planes)
                    .build()
            }
        };
        for issue in &mut response.issues {
            self.restore_entrypoint_name(&mut issue.message);
        }
        let mut filenames = response.filenames;
        let source_files = self.sources(&mut filenames);
        Ok(ExecOutcome {
            variables: response.variables,
            operations: OperationsByModule {
                map: response.operations,
            },
            artifact_graph: response.artifact_graph,
            scene_objects: response.scene_objects,
            source_range_to_object: Default::default(),
            var_solutions: Default::default(),
            refactor_metadata: Default::default(),
            issues: response.issues,
            filenames,
            source_files,
            default_planes: response.default_planes.map(|planes| *planes),
            #[cfg(test)]
            test_program_memory: Default::default(),
        })
    }

    fn restore_entrypoint_name(&self, message: &mut String) {
        let upload_name = self.request.entrypoint.to_string();
        let client_name = if self.inline {
            Cow::Borrowed("main")
        } else {
            self.files[&upload_name].0.to_string_lossy()
        };
        *message = message.replace(&format!("`{upload_name}`"), &format!("`{client_name}`"));
    }
}

fn reject_absolute_import(path: &str) -> Result<(), KclError> {
    if typed_path::UnixPath::new(path).is_absolute() || typed_path::WindowsPath::new(path).has_root() {
        return Err(remote_error(format!(
            "Absolute import paths are not supported by engine execution: {path}"
        )));
    }
    Ok(())
}

fn safe_path(path: &str) -> Result<SafeFilepath, KclError> {
    path.parse()
        .map_err(|err| remote_error(format!("Cannot upload project path {path}: {err}")))
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use kittycad_modeling_cmds::websocket::WebSocketResponse;

    use super::*;
    use crate::ExecutorSettings;
    use crate::engine_connection::EngineManager;
    use crate::engine_connection::EngineTransport;

    const ROOT: &str = "@settings(kclVersion = 3.0)\nimport \"sub/main.kcl\"\nvalue = 1\n";

    async fn project() -> (tempfile::TempDir, UploadedProject) {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir(dir.path().join("sub")).unwrap();
        std::fs::write(
            dir.path().join("sub/main.kcl"),
            "@settings(kclVersion = 3.0)\nimport \"main.kcl\"\nexport value = 2\n",
        )
        .unwrap();
        std::fs::write(dir.path().join("main.kcl"), ROOT).unwrap();
        std::fs::write(dir.path().join("unrelated.txt"), "must not upload").unwrap();
        let ctx = ExecutorContext::new_mock(Some(ExecutorSettings {
            current_file: Some(TypedPath(dir.path().join("main.kcl"))),
            ..Default::default()
        }))
        .await;
        let uploaded = UploadedProject::collect(&ctx, &Program::parse_no_errs(ROOT).unwrap())
            .await
            .unwrap();
        (dir, uploaded)
    }

    fn response() -> ExecKclProjectOk {
        ExecKclProjectOk::builder()
            .artifact_graph(Default::default())
            .variables(Default::default())
            .operations(Default::default())
            .issues(Vec::new())
            .scene_objects(Vec::new())
            .filenames(IndexMap::from([
                (
                    ModuleId::default(),
                    ModulePath::Local {
                        value: "main.kcl".into(),
                        original_import_path: None,
                    },
                ),
                (
                    ModuleId::from_usize(1),
                    ModulePath::Local {
                        value: "sub/main.kcl".into(),
                        original_import_path: Some("sub/main.kcl".into()),
                    },
                ),
            ]))
            .build()
    }

    #[tokio::test]
    async fn uploads_only_dependencies_and_stops_at_cycles() {
        let (_, project) = project().await;
        assert_eq!(project.request.entrypoint.to_string(), "main.kcl");
        assert_eq!(
            project.files.keys().map(String::as_str).collect::<Vec<_>>(),
            ["main.kcl", "sub/main.kcl"]
        );
    }

    #[tokio::test]
    async fn reconstructs_sources_from_uploaded_bytes_after_files_change() {
        let (dir, project) = project().await;
        std::fs::write(dir.path().join("main.kcl"), "changed").unwrap();
        let outcome = project.outcome(Ok(response())).unwrap();
        assert_eq!(outcome.source_files[&ModuleId::default()].source, ROOT);
        assert_eq!(
            outcome.filenames[&ModuleId::default()].to_string(),
            dir.path().join("main.kcl").display().to_string()
        );
        assert_eq!(outcome.source_files.len(), 2);
    }

    #[tokio::test]
    async fn diagnostics_keep_the_client_entrypoint_name() {
        let ctx = ExecutorContext::new_mock(None).await;
        let program = Program::parse_no_errs("@settings(kclVersion = 3.0)\nvalue = 1").unwrap();
        let project = UploadedProject::collect(&ctx, &program).await.unwrap();
        let error = project
            .outcome(Err(ExecKclProjectErr::error_before_execution(remote_error(format!(
                "The entry point `{}` failed",
                project.request.entrypoint
            )))))
            .unwrap_err();
        assert_eq!(error.error.message(), "The entry point `main` failed");
    }

    #[tokio::test]
    async fn retains_partial_output_on_fatal_errors_and_all_nonfatal_issues() {
        let (_, project) = project().await;
        let success = response();
        let mut warning = crate::CompilationIssue::err(SourceRange::synthetic(), "keep warning");
        warning.severity = crate::errors::Severity::Warning;
        let error = project
            .outcome(Err(ExecKclProjectErr::builder()
                .error(remote_error("failed"))
                .non_fatal(vec![warning.clone()])
                .variables(success.variables)
                .operations(success.operations)
                .artifact_graph(success.artifact_graph)
                .scene_objects(success.scene_objects)
                .filenames(success.filenames)
                .build()))
            .unwrap_err();
        assert_eq!(error.non_fatal, [warning.clone()]);
        assert_eq!(error.source_files.len(), 2);
        let response = response();
        let outcome = project
            .outcome(Err(ExecKclProjectErr::builder()
                .non_fatal(vec![warning.clone()])
                .variables(response.variables)
                .operations(response.operations)
                .artifact_graph(response.artifact_graph)
                .scene_objects(response.scene_objects)
                .filenames(response.filenames)
                .build()))
            .unwrap();
        assert_eq!(outcome.issues, [warning]);
    }

    #[test]
    fn absolute_imports_are_rejected_on_all_platforms() {
        for path in ["/tmp/part.kcl", "C:\\project\\part.kcl", "\\\\server\\part.kcl"] {
            assert!(reject_absolute_import(path).is_err(), "{path}");
        }
        reject_absolute_import("../part.kcl").unwrap();
    }

    #[tokio::test]
    async fn includes_gltf_buffers_without_interpreting_them_as_modules() {
        let dir = tempfile::tempdir().unwrap();
        let source = "@settings(kclVersion = 3.0)\nimport \"shape.gltf\" as shape\n";
        std::fs::write(
            dir.path().join("shape.gltf"),
            r#"{"asset":{"version":"2.0"},"buffers":[{"uri":"buffer.bin","byteLength":4}]}"#,
        )
        .unwrap();
        std::fs::write(dir.path().join("buffer.bin"), [0, 255, 1, 2]).unwrap();
        let ctx = ExecutorContext::new_mock(Some(ExecutorSettings {
            current_file: Some(TypedPath(dir.path().join("main.kcl"))),
            ..Default::default()
        }))
        .await;
        let project = UploadedProject::collect(&ctx, &Program::parse_no_errs(source).unwrap())
            .await
            .unwrap();
        assert_eq!(project.files["buffer.bin"].1, [0, 255, 1, 2]);
    }

    #[tokio::test]
    async fn uploaded_nested_entrypoints_resolve_parent_relative_assets() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir(dir.path().join("sub")).unwrap();
        let code = "@settings(kclVersion = 3.0)\nimport \"../part.step\" as part\n";
        std::fs::write(dir.path().join("part.step"), b"step file sent to the engine").unwrap();
        let client = ExecutorContext::new_mock(Some(ExecutorSettings {
            current_file: Some(TypedPath(dir.path().join("sub/main.kcl"))),
            ..Default::default()
        }))
        .await;
        let program = Program::parse_no_errs(code).unwrap();
        let project = UploadedProject::collect(&client, &program).await.unwrap().request;
        let entrypoint = TypedPath::new(&project.entrypoint.to_string());
        let files = crate::InMemoryFiles::new(
            project
                .files
                .into_iter()
                .map(|file| (file.path.to_string(), file.contents))
                .collect(),
        );
        // This is the same filesystem and directory setup used by the engine,
        // with a mock modeling transport so no external process is required.
        let ctx = ExecutorContext::new_with_engine_and_fs(
            Arc::new(EngineManager::new_mock()),
            crate::new_file_system_handle(files),
            ExecutorSettings {
                project_directory: entrypoint.parent(),
                current_file: Some(entrypoint),
                geometry_only: true,
                ..Default::default()
            },
        );
        let mut state = ExecState::new(&ctx);
        ctx.run(&program, &mut state).await.unwrap();
    }

    struct RecordingTransport {
        requests: Arc<tokio::sync::Mutex<Vec<WebSocketRequest>>>,
    }

    #[async_trait::async_trait]
    impl EngineTransport for RecordingTransport {
        async fn inner_fire_modeling_cmd(
            &self,
            _: uuid::Uuid,
            _: SourceRange,
            _: WebSocketRequest,
            _: std::collections::HashMap<uuid::Uuid, SourceRange>,
        ) -> Result<(), KclError> {
            panic!("unexpected unawaited command")
        }
        async fn inner_send_modeling_cmd(
            &self,
            id: uuid::Uuid,
            _: SourceRange,
            request: WebSocketRequest,
            _: std::collections::HashMap<uuid::Uuid, SourceRange>,
        ) -> Result<WebSocketResponse, KclError> {
            let response = if matches!(request, WebSocketRequest::ExecKclProject { .. }) {
                OkWebSocketResponseData::ExecKclProject {
                    result: Box::new(Ok(response())),
                }
            } else {
                OkWebSocketResponseData::Modeling {
                    modeling_response: kittycad_modeling_cmds::ok_response::OkModelingCmdResponse::Empty {},
                }
            };
            self.requests.lock().await.push(request);
            Ok(WebSocketResponse::success(Some(id), response))
        }
        async fn close(&self) -> Result<(), crate::engine_connection::TransportCloseError> {
            Ok(())
        }
    }

    #[tokio::test]
    async fn executes_once_and_keeps_the_transport_for_followups() {
        let requests = Arc::new(tokio::sync::Mutex::new(Vec::new()));
        let mut engine = EngineManager::new_mock();
        engine.transport = Arc::new(Box::new(RecordingTransport {
            requests: requests.clone(),
        }));
        let ctx = ExecutorContext::new_with_engine(
            Arc::new(engine),
            ExecutorSettings {
                geometry_only: true,
                ..Default::default()
            },
        );
        let mut state = ExecState::new(&ctx);
        ctx.execute_remote_project(
            &Program::parse_no_errs("@settings(kclVersion = 3.0)\nvalue = 1").unwrap(),
            &mut state,
        )
        .await
        .unwrap();
        ctx.engine
            .send_modeling_cmd(
                &ctx.engine_batch,
                state.next_uuid(),
                SourceRange::synthetic(),
                &kittycad_modeling_cmds::ModelingCmd::ViewIsometric(
                    kittycad_modeling_cmds::ViewIsometric::builder().padding(0.1).build(),
                ),
            )
            .await
            .unwrap();
        let requests = requests.lock().await;
        assert_eq!(requests.len(), 2);
        assert!(matches!(requests[0], WebSocketRequest::ExecKclProject { .. }));
        assert!(matches!(requests[1], WebSocketRequest::ModelingCmdReq(_)));
        assert_ne!(state.next_uuid(), IdGenerator::new(None).next_uuid());
    }
}
