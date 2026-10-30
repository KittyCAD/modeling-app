//! Cache contracts exercised against real files and a real engine session.

use std::panic::AssertUnwindSafe;

use futures::FutureExt;
use kcl_lib::CompilationIssue;
use kcl_lib::ExecOutcome;
use kcl_lib::ExecutorContext;
use kcl_lib::ExecutorSettings;
use kcl_lib::KclError;
use kcl_lib::KclVersion;
use kcl_lib::Program;
use kcl_lib::TypedPath;
use kittycad_modeling_cmds::ModelingCmd;
use kittycad_modeling_cmds::each_cmd as mcmd;
use kittycad_modeling_cmds::ok_response::OkModelingCmdResponse;
use kittycad_modeling_cmds::shared::EntityType;
use kittycad_modeling_cmds::units::UnitVolume;
use kittycad_modeling_cmds::websocket::OkWebSocketResponseData;

pub(super) const BODY: &str = r#"@settings(kclVersion = 3.0)
radiusValue = 10mm
height = 5mm
profile = sketch(on = XY) {
  perimeter = circle(start = [var 10mm, var 0mm], center = [var 0mm, var 0mm])
  coincident([perimeter.center, ORIGIN])
  radius(perimeter) == radiusValue
  horizontal([perimeter.center, perimeter.start])
}
body = extrude(region(segments = [profile.perimeter]), length = height)
"#;

pub(super) const IMPORTING_BODY: &str = r#"@settings(kclVersion = 3.0)
import height from 'dimensions.kcl'
radiusValue = 10mm
profile = sketch(on = XY) {
  perimeter = circle(start = [var 10mm, var 0mm], center = [var 0mm, var 0mm])
  coincident([perimeter.center, ORIGIN])
  radius(perimeter) == radiusValue
  horizontal([perimeter.center, perimeter.start])
}
body = extrude(region(segments = [profile.perimeter]), length = height)
"#;

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_cache_contract_parse_reports_the_owned_plane_scene() {
    // Consume the real serialized producer contract, including a mandatory
    // generation. Plane UUIDs alone cannot identify a recreated engine scene.
    #[derive(serde::Deserialize)]
    struct PlaneReceipt {
        default_planes: Option<kcl_api::DefaultPlanes>,
        engine_scene_generation: usize,
    }
    let project = tempfile::tempdir().unwrap();
    let main = project.path().join("main.kcl");
    tokio::fs::write(&main, BODY).await.unwrap();
    with_context(new_context(Some(main.clone()), BODY).await, async |ctx| {
        let original = execute(ctx, BODY).await;
        let parsed = ctx.parse_for_execution(BODY).await.unwrap();
        let receipt: PlaneReceipt = serde_json::from_slice(&serde_json::to_vec(&parsed).unwrap()).unwrap();
        assert_eq!(receipt.engine_scene_generation, original.engine_scene_generation);
        let first_planes = receipt.default_planes.unwrap();
        let unchanged = execute(ctx, BODY).await;
        assert_eq!(unchanged.engine_scene_generation, original.engine_scene_generation);
        let syntax = ctx
            .parse_for_execution("@settings(kclVersion = 3.0)\nx = (")
            .await
            .unwrap();
        let receipt: PlaneReceipt = serde_json::from_slice(&serde_json::to_vec(&syntax).unwrap()).unwrap();
        assert_eq!(receipt.engine_scene_generation, original.engine_scene_generation);
        assert_eq!(receipt.default_planes.as_ref(), Some(&first_planes));
        let lexical = ctx
            .parse_for_execution("@settings(kclVersion = 3.0)\nx = \"unterminated")
            .await
            .unwrap_err();
        assert_eq!(lexical.engine_scene_generation, Some(original.engine_scene_generation));
        assert_eq!(lexical.default_planes.as_ref(), Some(&first_planes));

        let changed = BODY.replace("height = 5mm", "height = 6mm");
        tokio::fs::write(&main, &changed).await.unwrap();
        let rebuilt = execute(ctx, &changed).await;
        assert!(rebuilt.engine_scene_generation > original.engine_scene_generation);
        let parsed = ctx.parse_for_execution(&changed).await.unwrap();
        let receipt: PlaneReceipt = serde_json::from_slice(&serde_json::to_vec(&parsed).unwrap()).unwrap();
        assert_eq!(receipt.engine_scene_generation, rebuilt.engine_scene_generation);
        let rebuilt_planes = receipt.default_planes.unwrap();
        assert_eq!(rebuilt_planes, first_planes);
        assert_volume(volume(ctx).await, 6.0);
    })
    .await;
}

pub(super) async fn new_context(main: Option<std::path::PathBuf>, source: &str) -> ExecutorContext {
    let version = Program::parse_no_errs(source).unwrap().language_version().unwrap();
    kcl_lib::test_server::new_context(true, main, false, version)
        .await
        .unwrap()
}

// Test failures must close their real session before the original panic resumes.
async fn with_context<T>(mut ctx: ExecutorContext, test: impl AsyncFnOnce(&mut ExecutorContext) -> T) -> T {
    let result = AssertUnwindSafe(test(&mut ctx)).catch_unwind().await;
    ctx.close().await;
    match result {
        Ok(value) => value,
        Err(panic) => std::panic::resume_unwind(panic),
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_cache_contract_fixture_closes_engine_before_resuming_panics() {
    let ctx = new_context(None, BODY).await;
    let observer = ctx.clone();
    let failure = AssertUnwindSafe(with_context::<()>(ctx, async |ctx| {
        execute(ctx, BODY).await;
        panic!("cache contract cleanup probe");
    }))
    .catch_unwind()
    .await
    .expect_err("the fixture must resume the original panic");
    assert_eq!(failure.downcast_ref::<&str>(), Some(&"cache contract cleanup probe"));

    let command = mcmd::Volume::builder()
        .output_unit(UnitVolume::CubicMillimeters)
        .build()
        .into();
    let error = tokio::time::timeout(
        std::time::Duration::from_secs(5),
        observer.engine.send_modeling_cmd(
            &observer.engine_batch,
            uuid::Uuid::new_v4(),
            Default::default(),
            &command,
        ),
    )
    .await
    .expect("closing the session must not leave a command waiting")
    .expect_err("the real engine must be closed before the panic resumes");
    assert!(matches!(error, KclError::EngineHangup { .. }), "{error:?}");
}

pub(super) async fn send(ctx: &ExecutorContext, command: ModelingCmd) -> OkWebSocketResponseData {
    ctx.engine
        .send_modeling_cmd(&ctx.engine_batch, uuid::Uuid::new_v4(), Default::default(), &command)
        .await
        .unwrap()
}

pub(super) async fn execute(ctx: &ExecutorContext, code: &str) -> ExecOutcome {
    let outcome = ctx
        .run_with_caching(Program::parse_no_errs(code).unwrap())
        .await
        .unwrap();
    assert!(outcome.errors().next().is_none(), "unexpected execution diagnostics");
    assert!(ctx.engine_batch.is_empty().await, "execution left unsent commands");
    outcome
}

pub(super) async fn volume(ctx: &ExecutorContext) -> f64 {
    let response = send(
        ctx,
        mcmd::Volume::builder()
            .output_unit(UnitVolume::CubicMillimeters)
            .build()
            .into(),
    )
    .await;
    let OkWebSocketResponseData::Modeling {
        modeling_response: OkModelingCmdResponse::Volume(result),
    } = response
    else {
        panic!("expected the engine's volume response, got {response:?}");
    };
    result.volume
}

pub(super) fn assert_volume(actual: f64, height: f64) {
    let expected = std::f64::consts::PI * 10.0_f64.powi(2) * height;
    assert!(
        (actual - expected).abs() < expected * 0.001,
        "volume {actual}, expected {expected}"
    );
}

pub(super) async fn solid_ids(ctx: &ExecutorContext) -> Vec<uuid::Uuid> {
    let response = send(
        ctx,
        mcmd::SceneGetEntityIds::builder()
            .filter(vec![EntityType::Solid3D])
            .skip(0)
            .take(1000)
            .build()
            .into(),
    )
    .await;
    let OkWebSocketResponseData::Modeling {
        modeling_response: OkModelingCmdResponse::SceneGetEntityIds(scene),
    } = response
    else {
        panic!("expected actual engine solid IDs, received {response:?}");
    };
    scene.entity_ids.into_iter().flatten().collect()
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_cache_contract_anonymous_execution_cannot_replace_loaded_file() {
    use std::sync::atomic::Ordering::Relaxed;

    let project = tempfile::tempdir().unwrap();
    let main = project.path().join("main.kcl");
    tokio::fs::write(&main, BODY).await.unwrap();
    let program = Program::parse_no_errs(BODY).unwrap();
    with_context(new_context(Some(main), BODY).await, async |ctx| {
        let original = execute(ctx, BODY).await;
        let cached = execute(ctx, BODY).await;
        assert_eq!(cached.engine_scene_generation, original.engine_scene_generation);
        let ids = solid_ids(ctx).await;
        assert_eq!(ids.len(), 1);
        assert_volume(volume(ctx).await, 5.0);

        let anonymous = ExecutorContext::new_with_engine_and_fs(
            ctx.engine.clone(),
            ctx.fs.clone(),
            ExecutorSettings {
                current_file: None,
                project_directory: None,
                ..ctx.settings.clone()
            },
        )
        .with_cache(ctx.cache.clone());
        let commands = ctx.engine.stats().commands_batched.load(Relaxed);
        let batches = ctx.engine.stats().batches_sent.load(Relaxed);
        let result = anonymous.run_with_caching(program).await;
        let anonymous_commands = ctx.engine.stats().commands_batched.load(Relaxed) - commands;
        let anonymous_batches = ctx.engine.stats().batches_sent.load(Relaxed) - batches;
        let retained = execute(ctx, BODY).await;
        let retained_ids = solid_ids(ctx).await;
        let retained_volume = volume(ctx).await;

        match result {
            Err(error) => assert!(
                matches!(error.error, KclError::Engine { details } if details.message ==
                    "Anonymous execution cannot replace a file-backed execution in the same engine session."),
                "anonymous ownership loss must be rejected as an engine error"
            ),
            Ok(outcome) => panic!(
                "anonymous execution unexpectedly succeeded: generation={}, {anonymous_commands} commands in {anonymous_batches} batches",
                outcome.engine_scene_generation
            ),
        }
        assert_eq!(anonymous_commands, 0, "reject before clearing or regenerating geometry");
        assert_eq!(anonymous_batches, 0);
        assert_eq!(
            retained.engine_scene_generation, original.engine_scene_generation,
            "rejected anonymous execution must preserve the registered owner"
        );
        assert_eq!(retained_ids, ids);
        assert_volume(retained_volume, 5.0);
    })
    .await;
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_cache_contract_invalid_entry_clears_real_geometry_only_once() {
    use std::sync::atomic::Ordering::Relaxed;

    let project = tempfile::tempdir().unwrap();
    let first = project.path().join("first.kcl");
    let second = project.path().join("second.kcl");
    let invalid = "@settings(kclVersion = 3.0)\nx = )";
    tokio::fs::write(&first, BODY).await.unwrap();
    tokio::fs::write(&second, invalid).await.unwrap();
    with_context(new_context(Some(first), BODY).await, async |ctx| {
        execute(ctx, BODY).await;
        let failing = format!("{BODY}\nbad = missing");
        let error = ctx
            .run_with_caching(Program::parse_no_errs(&failing).unwrap())
            .await
            .unwrap_err();
        assert!(matches!(error.error, KclError::UndefinedValue { .. }));
        let partial_ids = solid_ids(ctx).await;
        assert_eq!(partial_ids.len(), 1);
        assert_volume(volume(ctx).await, 5.0);
        assert!(ctx.cache.read_old_memory_var("body").await.is_some());
        let commands = ctx.engine.stats().commands_batched.load(Relaxed);
        let parsed = ctx.parse_for_execution(invalid).await.unwrap();
        assert!(parsed.issues.iter().any(|issue| issue.severity.is_err()));
        assert_eq!(ctx.engine.stats().commands_batched.load(Relaxed), commands);
        assert_eq!(solid_ids(ctx).await, partial_ids);

        ctx.settings.with_current_file(TypedPath(second.clone()));
        let parsed = ctx.parse_for_execution(invalid).await.unwrap();
        assert!(parsed.issues.iter().any(|issue| issue.severity.is_err()));
        assert!(
            solid_ids(ctx).await.is_empty(),
            "the other file must not display the first file's body"
        );
        assert!(ctx.cache.read_old_memory_var("body").await.is_none());
        let mut retry = ctx.clone();
        retry.settings.show_grid = !retry.settings.show_grid;
        let commands = ctx.engine.stats().commands_batched.load(Relaxed);
        let batches = ctx.engine.stats().batches_sent.load(Relaxed);
        for _ in 0..2 {
            let parsed = retry.parse_for_execution(invalid).await.unwrap();
            assert!(parsed.issues.iter().any(|issue| issue.severity.is_err()));
        }
        assert_eq!(ctx.engine.stats().commands_batched.load(Relaxed), commands);
        assert_eq!(ctx.engine.stats().batches_sent.load(Relaxed), batches);
        let cached = ctx.run_with_caching(Program::empty()).await.unwrap();
        assert_eq!(
            cached.engine_scene_generation,
            error.engine_scene_generation.unwrap() + 1,
            "only the actual invalid file switch changes the scene generation"
        );
        tokio::fs::write(&second, BODY).await.unwrap();
        let repaired = execute(ctx, BODY).await;
        assert_eq!(repaired.engine_scene_generation, cached.engine_scene_generation + 1);
        assert_volume(volume(ctx).await, 5.0);
    })
    .await;
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_cache_contract_changed_import_rebuilds_from_the_same_file() {
    let project = tempfile::tempdir().unwrap();
    let main = project.path().join("main.kcl");
    let dependency = project.path().join("dimensions.kcl");
    tokio::fs::write(&main, IMPORTING_BODY).await.unwrap();
    tokio::fs::write(&dependency, "@settings(kclVersion = 3.0)\nexport height = 5mm\n")
        .await
        .unwrap();
    with_context(new_context(Some(main), IMPORTING_BODY).await, async |ctx| {
        let first = execute(ctx, IMPORTING_BODY).await;
        assert_eq!(first.engine_scene_generation, 1);
        assert_volume(volume(ctx).await, 5.0);
        let cached = execute(ctx, IMPORTING_BODY).await;
        assert_eq!(cached.engine_scene_generation, first.engine_scene_generation);
        assert_eq!(first.variables, cached.variables);

        // Same path and unchanged entry point, different dependency bytes.
        tokio::fs::write(&dependency, "@settings(kclVersion = 3.0)\nexport height = 12mm\n")
            .await
            .unwrap();
        let changed = execute(ctx, IMPORTING_BODY).await;
        assert_eq!(changed.engine_scene_generation, first.engine_scene_generation + 1);
        assert_volume(volume(ctx).await, 12.0);
        let cached = execute(ctx, IMPORTING_BODY).await;
        assert_eq!(cached.engine_scene_generation, changed.engine_scene_generation);
        assert_eq!(changed.variables, cached.variables);
    })
    .await;
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_cache_contract_same_source_in_another_file_has_new_ownership() {
    let project = tempfile::tempdir().unwrap();
    let first_path = project.path().join("first.kcl");
    let second_path = project.path().join("second.kcl");
    tokio::fs::write(&first_path, BODY).await.unwrap();
    tokio::fs::write(&second_path, BODY).await.unwrap();
    with_context(new_context(Some(first_path), BODY).await, async |ctx| {
        let original = execute(ctx, BODY).await;
        let cached = execute(ctx, BODY).await;
        assert_eq!(cached.engine_scene_generation, original.engine_scene_generation);
        ctx.settings.with_current_file(TypedPath(second_path));
        let changed = execute(ctx, BODY).await;
        assert_eq!(
            changed.engine_scene_generation,
            original.engine_scene_generation + 1,
            "a different entry-point file must not inherit the old file's cached execution metadata"
        );
        assert_volume(volume(ctx).await, 5.0);
        let cached = execute(ctx, BODY).await;
        assert_eq!(cached.engine_scene_generation, changed.engine_scene_generation);
    })
    .await;
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_cache_contract_replacement_engine_rebuilds_without_a_javascript_reset() {
    let (original, cache) = with_context(new_context(None, BODY).await, async |first| {
        let original = execute(first, BODY).await;
        assert_volume(volume(first).await, 5.0);
        let cached = execute(first, BODY).await;
        assert_eq!(cached.engine_scene_generation, original.engine_scene_generation);
        (original, first.cache.clone())
    })
    .await;

    // Reuse interpreter state while the real engine's scene is brand new, as
    // happens when the browser reconnects without replacing its Rust context.
    with_context(new_context(None, BODY).await.with_cache(cache), async |replacement| {
        let changed = execute(replacement, BODY).await;
        assert_eq!(
            changed.engine_scene_generation,
            original.engine_scene_generation + 1,
            "memoized IDs belong to the disconnected engine, not its replacement"
        );
        assert_volume(volume(replacement).await, 5.0);
        let cached = execute(replacement, BODY).await;
        assert_eq!(cached.engine_scene_generation, changed.engine_scene_generation);
    })
    .await;
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_cache_contract_parse_keeps_the_version_with_its_program() {
    #[derive(serde::Deserialize)]
    struct AstReceipt {
        body: Vec<serde::de::IgnoredAny>,
    }
    #[derive(serde::Deserialize)]
    struct VersionedProgram {
        ast: AstReceipt,
        kcl_version: KclVersion,
    }
    #[derive(serde::Deserialize)]
    struct ParseReceipt {
        program: Option<VersionedProgram>,
        issues: Vec<CompilationIssue>,
    }

    with_context(new_context(None, BODY).await, async |ctx| {
        let mut results = Vec::new();
        for (source, expected_version) in [
            ("@settings(kclVersion = 2.0)\nx = 1\n", Some(KclVersion::V2)),
            ("@settings(kclVersion = 3.0)\nx = 1\n", Some(KclVersion::V3)),
            ("@settings(kclVersion = 2.0)\nx = (\n", None),
        ] {
            results.push((ctx.parse_for_execution(source).await, expected_version));
        }
        let lexical = ctx
            .parse_for_execution("@settings(kclVersion = 2.0)\nx = \"unterminated")
            .await;

        for (result, expected_version) in results {
            // Consume the real wire representation, not a reconstructed DTO.
            let encoded = serde_json::to_vec(&result.unwrap()).unwrap();
            let receipt: ParseReceipt = serde_json::from_slice(&encoded).unwrap();
            if let Some(expected_version) = expected_version {
                let program = receipt.program.unwrap();
                assert_eq!(program.kcl_version, expected_version);
                assert_eq!(program.ast.body.len(), 1);
                assert!(receipt.issues.iter().all(|issue| !issue.severity.is_err()));
            } else {
                assert!(receipt.program.is_none());
                assert!(receipt.issues.iter().any(|issue| issue.severity.is_err()));
            }
        }
        assert!(matches!(lexical.unwrap_err().error, KclError::Lexical { .. }));
    })
    .await;
}
