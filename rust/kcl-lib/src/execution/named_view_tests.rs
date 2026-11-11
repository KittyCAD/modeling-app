use std::collections::HashMap;
use std::sync::Arc;
use std::sync::atomic::AtomicU8;
use std::sync::atomic::Ordering;

use kittycad_modeling_cmds::ModelingCmd;
use kittycad_modeling_cmds::websocket::WebSocketRequest;
use kittycad_modeling_cmds::websocket::WebSocketResponse;
use uuid::Uuid;

use super::ExecState;
use super::ExecutorContext;
use super::ExecutorSettings;
use super::cache::GlobalState;
use crate::CompilationIssue;
use crate::KclError;
use crate::MockConfig;
use crate::Program;
use crate::SourceRange;
use crate::engine::engine_manager::EngineManager;
use crate::engine::engine_manager::EngineTransport;
use crate::engine::engine_manager::TransportCloseError;
use crate::named_views::Artifact;
use crate::named_views::ModuleId;
use crate::named_views::ViewResolutionError;
use crate::named_views::ViewTarget;

const PROGRAM: &str = r#"@settings(kclVersion = 3.0)
plane = offsetPlane(XY, offset = 10mm)
hide(plane)
front = view::named("Front", camera = view::oriented(view::Orientation::Front), baseline = view::Visibility::Hide, except = [plane])
rear = view::named("Rear", camera = view::oriented(view::Orientation::Back), baseline = view::Visibility::Show)
"#;

fn context() -> ExecutorContext {
    let ctx = ExecutorContext::new_with_engine(Arc::new(EngineManager::new_mock()), Default::default());
    assert!(!ctx.is_mock());
    ctx
}

#[tokio::test]
async fn native_execution_stores_results_and_invalidates_them_on_failure() {
    let ctx = context();
    let mut state = ExecState::new(&ctx);
    assert!(state.named_views().is_none());
    let program = Program::parse_no_errs(PROGRAM).unwrap();
    let (environment, _) = ctx.run(&program, &mut state).await.unwrap();
    let views = state.named_views().unwrap();
    assert_eq!(views.named_views().len(), 2);
    assert_eq!(views.default_view().len(), 1);
    assert!(views.default_view().values().all(|hidden| *hidden));
    let selected = views
        .get(&ViewTarget::Named {
            name: "Front".to_owned(),
            module_id: ModuleId::default(),
        })
        .unwrap();
    assert!(selected.visibility().values().all(|hidden| !hidden));

    let outcome = state.clone().into_exec_outcome(environment, &ctx).await.unwrap();
    assert_eq!(outcome.named_views.as_ref(), Some(views));
    let json = serde_json::to_value(&outcome).unwrap();
    let batch = &json["namedViews"];
    assert_eq!(batch["namedViews"].as_array().unwrap().len(), 2);
    assert_eq!(batch["defaultView"].as_object().unwrap().len(), 1);
    assert!(batch["failures"].as_array().unwrap().is_empty());
    for view in batch["namedViews"].as_array().unwrap() {
        assert_eq!(view["info"]["moduleId"], 0);
        assert!(view["info"]["artifactId"].is_string());
        assert!(view["cameraIntent"].is_object());
        assert_eq!(view["visibility"].as_object().unwrap().len(), 1);
    }

    let invalid = Program::parse_no_errs("@settings(kclVersion = 3.0)\nbad = missing").unwrap();
    ctx.run(&invalid, &mut state).await.unwrap_err();
    assert!(state.named_views().is_none());
    ctx.close().await;
}

#[tokio::test]
async fn cache_hits_reuse_stored_results_without_resolving_again() {
    let ctx = context();
    let program = Program::parse_no_errs(PROGRAM).unwrap();
    let first = ctx.run_with_caching(program.clone()).await.unwrap();
    assert_eq!(first.named_views.as_ref().unwrap().named_views().len(), 2);

    // Remove the cached resolver inputs so recalculation would produce different results.
    let mut cached = ctx.cache.read_old_ast().await.unwrap();
    cached.exec_state.artifacts.graph.clear();
    ctx.cache.write_old_ast(cached).await;
    let hit = ctx.run_with_caching(program).await.unwrap();
    assert!(hit.artifact_graph.is_empty());
    assert_eq!(hit.engine_scene_generation, first.engine_scene_generation);
    assert_eq!(hit.named_views, first.named_views);
    ctx.close().await;
}

#[tokio::test]
async fn mock_results_do_not_replace_or_restore_actual_results() {
    let ctx = context();
    let program = Program::parse_no_errs(PROGRAM).unwrap();
    let first = ctx.run_with_caching(program.clone()).await.unwrap();
    let mock = ExecutorContext::new_mock(None).await.with_cache(ctx.cache.clone());
    let expression = Program::parse_no_errs("@settings(kclVersion = 3.0)\nx = 2").unwrap();
    let outcome = mock.run_mock(&expression, &MockConfig::default()).await.unwrap();
    assert!(outcome.named_views.is_none());
    assert_eq!(
        ctx.cache.read_old_ast().await.unwrap().exec_state.named_views,
        first.named_views
    );

    let invalid = Program::parse_no_errs("@settings(kclVersion = 3.0)\nbad = missing").unwrap();
    ctx.run_with_caching(invalid).await.unwrap_err();
    assert!(ctx.cache.read_old_ast().await.is_none());
    let late_mock = mock.run_mock(&expression, &MockConfig::default()).await.unwrap();
    assert!(late_mock.named_views.is_none());
    assert!(ctx.cache.read_old_ast().await.is_none());
    let recovered = ctx.run_with_caching(program).await.unwrap();
    assert_eq!(recovered.named_views.as_ref().unwrap().named_views().len(), 2);
    ctx.close().await;
    mock.close().await;
}

#[tokio::test]
async fn per_view_failures_produce_contextual_issues_without_duplicate_cached_issues() {
    let ctx = context();
    let program = Program::parse_no_errs(PROGRAM).unwrap();
    let mut state = ExecState::new(&ctx);
    let (environment, _) = ctx.run(&program, &mut state).await.unwrap();
    let missing_module =
        ModuleId::from_usize(state.global.filenames().keys().map(ModuleId::as_usize).max().unwrap() + 1);
    let (mut artifacts, item_count) = std::mem::take(&mut state.global.artifacts.graph).into_parts();
    for artifact in artifacts.values_mut() {
        if let Artifact::NamedView(view) = artifact
            && view.name == "Front"
        {
            view.declaring_module_id = missing_module;
        }
    }
    state.global.artifacts.graph = crate::named_views::ArtifactGraph::from_parts(artifacts, item_count);
    state.resolve_named_views();
    state.err(CompilationIssue::err(SourceRange::synthetic(), "Unrelated issue"));
    let cached = GlobalState::new(
        state.clone(),
        ctx.settings.clone(),
        program.kcl_version,
        program.ast,
        environment,
    );
    let fresh = state.into_exec_outcome(environment, &ctx).await.unwrap();
    let views = fresh.named_views.as_ref().unwrap();
    assert_eq!(views.named_views().len(), 1);
    assert_eq!(views.named_views()[0].info.name, "Rear");
    assert_eq!(views.default_view().len(), 1);
    let failure = &views.failures()[0];
    assert_eq!(failure.name, "Front");
    assert_eq!(
        failure.error,
        ViewResolutionError::MissingModulePath {
            module_id: missing_module
        }
    );
    assert_eq!(fresh.issues.len(), 2);
    let issue = &fresh.issues[1];
    assert_eq!(issue.source_range, failure.source_range);
    assert_eq!(issue.severity, crate::errors::Severity::Error);
    assert!(issue.message.contains("Front"));
    assert!(issue.message.contains(&format!("module {missing_module}")));
    let json = serde_json::to_value(&fresh).unwrap();
    assert_eq!(json["namedViews"]["failures"][0]["error"]["type"], "missingModulePath");
    assert_eq!(
        json["namedViews"]["failures"][0]["error"]["moduleId"],
        missing_module.as_usize()
    );
    for _ in 0..2 {
        let hit = cached.clone().into_exec_outcome(&ctx).await.unwrap();
        assert_eq!(hit.named_views, fresh.named_views);
        assert_eq!(hit.issues, fresh.issues);
    }
    ctx.close().await;
}

struct FailingBoundaryTransport {
    inner: Arc<Box<dyn EngineTransport>>,
    fail_on: Arc<AtomicU8>,
}

#[async_trait::async_trait]
impl EngineTransport for FailingBoundaryTransport {
    async fn inner_fire_modeling_cmd(
        &self,
        cmd_id: Uuid,
        source_range: SourceRange,
        cmd: WebSocketRequest,
        id_to_source_range: HashMap<Uuid, SourceRange>,
    ) -> Result<(), KclError> {
        self.inner
            .inner_fire_modeling_cmd(cmd_id, source_range, cmd, id_to_source_range)
            .await
    }

    async fn inner_send_modeling_cmd(
        &self,
        cmd_id: Uuid,
        source_range: SourceRange,
        cmd: WebSocketRequest,
        id_to_source_range: HashMap<Uuid, SourceRange>,
    ) -> Result<WebSocketResponse, KclError> {
        let boundary = match &cmd {
            WebSocketRequest::ModelingCmdReq(request) => match request.cmd {
                ModelingCmd::BeginExecution(_) => 1,
                ModelingCmd::EndExecution(_) => 2,
                _ => 0,
            },
            _ => 0,
        };
        if boundary != 0 && self.fail_on.load(Ordering::Relaxed) == boundary {
            return Err(KclError::internal("Injected execution boundary failure".to_owned()));
        }
        self.inner
            .inner_send_modeling_cmd(cmd_id, source_range, cmd, id_to_source_range)
            .await
    }

    async fn close(&self) -> Result<(), TransportCloseError> {
        self.inner.close().await
    }
}

fn context_with_boundary_failure() -> (ExecutorContext, Arc<AtomicU8>) {
    let fail_on = Arc::new(AtomicU8::new(0));
    let mut engine = EngineManager::new_mock();
    engine.transport = Arc::new(Box::new(FailingBoundaryTransport {
        inner: engine.transport.clone(),
        fail_on: fail_on.clone(),
    }));
    let ctx = ExecutorContext::new_with_engine(Arc::new(engine), ExecutorSettings::default());
    assert!(!ctx.is_mock());
    (ctx, fail_on)
}

#[tokio::test]
async fn native_boundary_failures_invalidate_previous_results() {
    for boundary in [1, 2] {
        let (ctx, fail_on) = context_with_boundary_failure();
        let program = Program::parse_no_errs(PROGRAM).unwrap();
        let mut state = ExecState::new(&ctx);
        ctx.run(&program, &mut state).await.unwrap();
        assert!(state.named_views().is_some());
        let next = Program::parse_no_errs("@settings(kclVersion = 3.0)\nx = 2").unwrap();
        fail_on.store(boundary, Ordering::Relaxed);
        let error = ctx.run(&next, &mut state).await.unwrap_err();
        assert!(
            error.error.message().contains("Injected execution boundary failure"),
            "boundary {boundary}: {}",
            error.error
        );
        assert!(state.named_views().is_none());
        ctx.close().await;
    }
}

#[tokio::test]
async fn cached_boundary_failures_invalidate_stored_results() {
    for boundary in [1, 2] {
        for cache_hit in [false, true] {
            let (ctx, fail_on) = context_with_boundary_failure();
            let program = Program::parse_no_errs(PROGRAM).unwrap();
            ctx.run_with_caching(program.clone()).await.unwrap();
            assert!(ctx.cache.read_old_ast().await.unwrap().exec_state.named_views.is_some());
            let next = if cache_hit {
                program
            } else {
                Program::parse_no_errs(&format!("{PROGRAM}\nx = 2")).unwrap()
            };
            fail_on.store(boundary, Ordering::Relaxed);
            let error = ctx.run_with_caching(next).await.unwrap_err();
            assert!(error.error.message().contains("Injected execution boundary failure"));
            assert!(ctx.cache.read_old_ast().await.is_none());
            ctx.close().await;
        }
    }
}
