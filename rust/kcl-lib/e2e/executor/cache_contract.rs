//! Cache contracts exercised against real files and a real engine session.

use kcl_lib::ExecOutcome;
use kcl_lib::ExecutorContext;
use kcl_lib::ExecutorSettings;
use kcl_lib::KclError;
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
    let program = Program::parse_no_errs(BODY).unwrap();
    let ctx = kcl_lib::test_server::new_context(true, Some(main.clone()), false, program.language_version().unwrap())
        .await
        .unwrap();
    let original = execute(&ctx, BODY).await;
    let parsed = ctx.parse_for_execution(BODY).await.unwrap();
    let receipt: PlaneReceipt = serde_json::from_slice(&serde_json::to_vec(&parsed).unwrap()).unwrap();
    assert_eq!(receipt.engine_scene_generation, original.engine_scene_generation);
    let first_planes = receipt.default_planes.unwrap();
    let unchanged = execute(&ctx, BODY).await;
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
    let rebuilt = execute(&ctx, &changed).await;
    assert!(rebuilt.engine_scene_generation > original.engine_scene_generation);
    let parsed = ctx.parse_for_execution(&changed).await.unwrap();
    let receipt: PlaneReceipt = serde_json::from_slice(&serde_json::to_vec(&parsed).unwrap()).unwrap();
    assert_eq!(receipt.engine_scene_generation, rebuilt.engine_scene_generation);
    let rebuilt_planes = receipt.default_planes.unwrap();
    assert_eq!(rebuilt_planes, first_planes);
    assert_volume(volume(&ctx).await, 6.0);
    ctx.close().await;
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
    let response = ctx
        .engine
        .send_modeling_cmd(
            &ctx.engine_batch,
            uuid::Uuid::new_v4(),
            Default::default(),
            &ModelingCmd::from(
                mcmd::Volume::builder()
                    .output_unit(UnitVolume::CubicMillimeters)
                    .build(),
            ),
        )
        .await
        .unwrap();
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

async fn solid_ids(ctx: &ExecutorContext) -> Vec<uuid::Uuid> {
    let response = ctx
        .engine
        .send_modeling_cmd(
            &ctx.engine_batch,
            uuid::Uuid::new_v4(),
            Default::default(),
            &mcmd::SceneGetEntityIds::builder()
                .filter(vec![EntityType::Solid3D])
                .skip(0)
                .take(100)
                .build()
                .into(),
        )
        .await
        .unwrap();
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
    let ctx = kcl_lib::test_server::new_context(true, Some(main), false, program.language_version().unwrap())
        .await
        .unwrap();
    let original = execute(&ctx, BODY).await;
    let cached = execute(&ctx, BODY).await;
    assert_eq!(cached.engine_scene_generation, original.engine_scene_generation);
    let ids = solid_ids(&ctx).await;
    assert_eq!(ids.len(), 1);
    assert_volume(volume(&ctx).await, 5.0);

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
    let retained = execute(&ctx, BODY).await;
    let retained_ids = solid_ids(&ctx).await;
    let retained_volume = volume(&ctx).await;
    ctx.close().await;

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
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_cache_contract_unchanged_programs_do_not_contact_engine() {
    use std::sync::atomic::Ordering::Relaxed;

    let project = tempfile::tempdir().unwrap();
    let main = project.path().join("main.kcl");
    tokio::fs::write(&main, BODY).await.unwrap();
    tokio::fs::write(
        project.path().join("dimensions.kcl"),
        "@settings(kclVersion = 3.0)\nexport height = 5mm",
    )
    .await
    .unwrap();
    let version = Program::parse_no_errs(BODY).unwrap().language_version().unwrap();
    let mut ctx = kcl_lib::test_server::new_context(true, Some(main.clone()), false, version)
        .await
        .unwrap();
    for code in [BODY, IMPORTING_BODY] {
        tokio::fs::write(&main, code).await.unwrap();
        let original = execute(&ctx, code).await;
        let ids = solid_ids(&ctx).await;
        assert_eq!(ids.len(), 1);
        assert_volume(volume(&ctx).await, 5.0);
        let commands = ctx.engine.stats().commands_batched.load(Relaxed);
        let batches = ctx.engine.stats().batches_sent.load(Relaxed);
        for source in [code.to_owned(), format!("{code}\n// Unchanged geometry and imports")] {
            tokio::fs::write(&main, &source).await.unwrap();
            let outcome = execute(&ctx, &source).await;
            assert_eq!(outcome.engine_scene_generation, original.engine_scene_generation);
            assert_eq!(outcome.variables, original.variables);
            assert_eq!(outcome.artifact_graph, original.artifact_graph);
            assert_eq!(ctx.engine.stats().commands_batched.load(Relaxed), commands);
            assert_eq!(ctx.engine.stats().batches_sent.load(Relaxed), batches);
        }
        assert_eq!(solid_ids(&ctx).await, ids);
        assert_volume(volume(&ctx).await, 5.0);

        // Appending geometry retains the existing body's IDs. A subsequent
        // preference change still applies without rebuilding that body.
        let appended = format!("{code}\nextraPlane = offsetPlane(XY, offset = 20mm)");
        tokio::fs::write(&main, &appended).await.unwrap();
        let appended_outcome = execute(&ctx, &appended).await;
        assert_eq!(
            appended_outcome.engine_scene_generation,
            original.engine_scene_generation + 1
        );
        assert!(appended_outcome.variables.contains_key("extraPlane"));
        assert_eq!(solid_ids(&ctx).await, ids);
        assert_volume(volume(&ctx).await, 5.0);
        ctx.settings.highlight_edges = !ctx.settings.highlight_edges;
        let updated_preferences = execute(&ctx, &appended).await;
        assert_eq!(
            updated_preferences.engine_scene_generation,
            appended_outcome.engine_scene_generation
        );
        assert_eq!(solid_ids(&ctx).await, ids);
        assert_volume(volume(&ctx).await, 5.0);
    }
    ctx.close().await;
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_cache_contract_parse_and_preferences_preserve_real_geometry() {
    use std::sync::atomic::Ordering::Relaxed;

    let project = tempfile::tempdir().unwrap();
    let main = project.path().join("main.kcl");
    tokio::fs::write(&main, BODY).await.unwrap();
    let version = Program::parse_no_errs(BODY).unwrap().language_version().unwrap();
    let mut ctx = kcl_lib::test_server::new_context(true, Some(main), false, version)
        .await
        .unwrap();
    let original = execute(&ctx, BODY).await;
    let ids = solid_ids(&ctx).await;
    assert_eq!(ids.len(), 1);
    let settings = ctx.settings.clone();
    for settings in [
        settings.clone(),
        ExecutorSettings {
            show_grid: !settings.show_grid,
            ..settings.clone()
        },
        ExecutorSettings {
            fixed_size_grid: !settings.fixed_size_grid,
            ..settings.clone()
        },
        ExecutorSettings {
            highlight_edges: !settings.highlight_edges,
            ..settings.clone()
        },
        ExecutorSettings {
            default_backface_color: Some("#123456".to_owned()),
            ..settings.clone()
        },
    ] {
        ctx.settings = settings;
        let commands = ctx.engine.stats().commands_batched.load(Relaxed);
        let batches = ctx.engine.stats().batches_sent.load(Relaxed);
        for valid in [
            BODY.to_owned(),
            BODY.replace("height = 5mm", "height = 8mm"),
            String::new(),
        ] {
            let parsed = ctx.parse_for_execution(&valid).await.unwrap();
            assert!(parsed.program.is_some());
            assert!(parsed.issues.iter().all(|issue| !issue.severity.is_err()));
        }
        let syntax = ctx
            .parse_for_execution("@settings(kclVersion = 3.0)\nx = )")
            .await
            .unwrap();
        assert!(syntax.issues.iter().any(|issue| issue.severity.is_err()));
        let lexical = ctx
            .parse_for_execution("@settings(kclVersion = 3.0)\nx = \"unterminated")
            .await
            .unwrap_err();
        assert!(matches!(lexical.error, KclError::Lexical { .. }));
        assert_eq!(ctx.engine.stats().commands_batched.load(Relaxed), commands);
        assert_eq!(ctx.engine.stats().batches_sent.load(Relaxed), batches);
        let cached = execute(&ctx, BODY).await;
        assert_eq!(cached.engine_scene_generation, original.engine_scene_generation);
        assert_eq!(cached.variables, original.variables);
        assert_eq!(solid_ids(&ctx).await, ids);
        assert_volume(volume(&ctx).await, 5.0);
    }
    ctx.close().await;
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
    let version = Program::parse_no_errs(BODY).unwrap().language_version().unwrap();
    let mut ctx = kcl_lib::test_server::new_context(true, Some(first), false, version)
        .await
        .unwrap();
    execute(&ctx, BODY).await;
    let failing = format!("{BODY}\nbad = missing");
    let error = ctx
        .run_with_caching(Program::parse_no_errs(&failing).unwrap())
        .await
        .unwrap_err();
    assert!(matches!(error.error, KclError::UndefinedValue { .. }));
    let partial_ids = solid_ids(&ctx).await;
    assert_eq!(partial_ids.len(), 1);
    assert_volume(volume(&ctx).await, 5.0);
    assert!(ctx.cache.read_old_memory_var("body").await.is_some());
    let commands = ctx.engine.stats().commands_batched.load(Relaxed);
    let parsed = ctx.parse_for_execution(invalid).await.unwrap();
    assert!(parsed.issues.iter().any(|issue| issue.severity.is_err()));
    assert_eq!(ctx.engine.stats().commands_batched.load(Relaxed), commands);
    assert_eq!(solid_ids(&ctx).await, partial_ids);

    ctx.settings.with_current_file(TypedPath(second.clone()));
    let parsed = ctx.parse_for_execution(invalid).await.unwrap();
    assert!(parsed.issues.iter().any(|issue| issue.severity.is_err()));
    assert!(
        solid_ids(&ctx).await.is_empty(),
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
    let repaired = execute(&ctx, BODY).await;
    assert_eq!(repaired.engine_scene_generation, cached.engine_scene_generation + 1);
    assert_volume(volume(&ctx).await, 5.0);
    ctx.close().await;
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
    let program = Program::parse_no_errs(IMPORTING_BODY).unwrap();
    let ctx = kcl_lib::test_server::new_context(true, Some(main), false, program.language_version().unwrap())
        .await
        .unwrap();

    let first = execute(&ctx, IMPORTING_BODY).await;
    assert_eq!(first.engine_scene_generation, 1);
    assert_volume(volume(&ctx).await, 5.0);
    let cached = execute(&ctx, IMPORTING_BODY).await;
    assert_eq!(cached.engine_scene_generation, first.engine_scene_generation);
    assert_eq!(first.variables, cached.variables);

    // Same path and unchanged entry point, different dependency bytes.
    tokio::fs::write(&dependency, "@settings(kclVersion = 3.0)\nexport height = 12mm\n")
        .await
        .unwrap();
    let changed = execute(&ctx, IMPORTING_BODY).await;
    assert_eq!(changed.engine_scene_generation, first.engine_scene_generation + 1);
    assert_volume(volume(&ctx).await, 12.0);
    let cached = execute(&ctx, IMPORTING_BODY).await;
    assert_eq!(cached.engine_scene_generation, changed.engine_scene_generation);
    assert_eq!(changed.variables, cached.variables);
    ctx.close().await;
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_cache_contract_same_source_in_another_file_has_new_ownership() {
    let project = tempfile::tempdir().unwrap();
    let first_path = project.path().join("first.kcl");
    let second_path = project.path().join("second.kcl");
    tokio::fs::write(&first_path, BODY).await.unwrap();
    tokio::fs::write(&second_path, BODY).await.unwrap();
    let program = Program::parse_no_errs(BODY).unwrap();
    let mut ctx = kcl_lib::test_server::new_context(true, Some(first_path), false, program.language_version().unwrap())
        .await
        .unwrap();
    let original = execute(&ctx, BODY).await;
    let cached = execute(&ctx, BODY).await;
    assert_eq!(cached.engine_scene_generation, original.engine_scene_generation);
    ctx.settings.with_current_file(TypedPath(second_path));
    let changed = execute(&ctx, BODY).await;
    assert_eq!(
        changed.engine_scene_generation,
        original.engine_scene_generation + 1,
        "a different entry-point file must not inherit the old file's cached execution metadata"
    );
    assert_volume(volume(&ctx).await, 5.0);
    let cached = execute(&ctx, BODY).await;
    assert_eq!(cached.engine_scene_generation, changed.engine_scene_generation);
    ctx.close().await;
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_cache_contract_replacement_engine_rebuilds_without_a_javascript_reset() {
    let program = Program::parse_no_errs(BODY).unwrap();
    let version = program.language_version().unwrap();
    let first = kcl_lib::test_server::new_context(true, None, false, version)
        .await
        .unwrap();
    let original = execute(&first, BODY).await;
    assert_volume(volume(&first).await, 5.0);
    let cached = execute(&first, BODY).await;
    assert_eq!(cached.engine_scene_generation, original.engine_scene_generation);
    let cache = first.cache.clone();
    first.close().await;

    // Reuse interpreter state while the real engine's scene is brand new, as
    // happens when the browser reconnects without replacing its Rust context.
    let replacement = kcl_lib::test_server::new_context(true, None, false, version)
        .await
        .unwrap()
        .with_cache(cache);
    let changed = execute(&replacement, BODY).await;
    assert_eq!(
        changed.engine_scene_generation,
        original.engine_scene_generation + 1,
        "memoized IDs belong to the disconnected engine, not its replacement"
    );
    assert_volume(volume(&replacement).await, 5.0);
    let cached = execute(&replacement, BODY).await;
    assert_eq!(cached.engine_scene_generation, changed.engine_scene_generation);
    replacement.close().await;
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_cache_contract_imported_model_kernel_error_is_the_appended_fillet() {
    use std::sync::atomic::Ordering::Relaxed;

    let repository = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    let fixture = tokio::fs::read_to_string(repository.join("rust/kcl-lib/tests/named_views_hide_extrude/input.kcl"))
        .await
        .unwrap();
    // Match the app's existing unannotated entry point and legacy imports.
    // Adding a 3.0 header would reject this workload before any geometry runs.
    let code = format!(
        "{}\n\nimport \"large-model/main.kcl\" as performanceModel\nperformanceModel\n",
        fixture.trim_end()
    );
    let tail = "\n// Intentional trailing kernel failure for the performance profile.\nperformanceInvalid = fillet(boxVisible, edges = [{ sideFaces = [boxVisible.sketch.tags.line1, boxVisible.sketch.tags.line2] }], radius = 100000mm)\n";
    let failing = format!("{}\n{tail}", code.trim_end());
    let tail_start = failing.find("performanceInvalid = ").unwrap();
    let project = tempfile::tempdir().unwrap();
    let main = project.path().join("main.kcl");
    let modules = project.path().join("large-model");
    tokio::fs::create_dir(&modules).await.unwrap();
    let mut sources = tokio::fs::read_dir(repository.join("public/kcl-samples/cpu-cooler"))
        .await
        .unwrap();
    while let Some(source) = sources.next_entry().await.unwrap() {
        tokio::fs::copy(source.path(), modules.join(source.file_name()))
            .await
            .unwrap();
    }
    tokio::fs::write(&main, &code).await.unwrap();
    let parsed = Program::parse_no_errs(&code).unwrap();
    let ctx = kcl_lib::test_server::new_context(true, Some(main.clone()), false, parsed.language_version().unwrap())
        .await
        .unwrap();
    let warm = execute(&ctx, &code).await;
    let ids = solid_ids(&ctx).await;
    assert!(
        ids.len() > 2,
        "the real imported CPU cooler must exist before appending the failure"
    );
    let loaded_volume = volume(&ctx).await;
    let commands = ctx.engine.stats().commands_batched.load(Relaxed);
    let cached = execute(&ctx, &code).await;
    assert_eq!(cached.engine_scene_generation, warm.engine_scene_generation);
    assert_eq!(ctx.engine.stats().commands_batched.load(Relaxed), commands);

    // Same file/session and real bytes. Only the root tail changes.
    tokio::fs::write(&main, &failing).await.unwrap();
    let failure = ctx.run_with_caching(Program::parse_no_errs(&failing).unwrap()).await;
    let drained = ctx.engine_batch.is_empty().await;
    let append_commands = ctx.engine.stats().commands_batched.load(Relaxed) - commands;
    let retained_ids = solid_ids(&ctx).await;
    let retained_volume = volume(&ctx).await;
    ctx.close().await;

    let failure = failure.expect_err("the deliberate fillet must fail; success is a regression");
    let KclError::Engine { details } = failure.error else {
        panic!("expected the appended engine fillet failure, got {failure:?}");
    };
    assert!(
        details
            .message
            .contains("Fillet blend creation encountered an internal error."),
        "wrong kernel failure: {}\nranges: {:?}\nappend commands: {append_commands}\nsource ({} bytes):\n{failing}",
        details.message,
        details.source_ranges,
        failing.len()
    );
    assert!(!details.source_ranges.is_empty());
    for range in details.source_ranges {
        assert!(range.module_id().is_top_level());
        assert!(range.start() >= tail_start && range.end() <= failing.len());
    }
    assert!(
        drained,
        "all real commands must settle before returning the kernel failure"
    );
    assert_eq!(
        retained_ids, ids,
        "the failing append must not recreate unchanged imported/root bodies"
    );
    assert!((retained_volume - loaded_volume).abs() <= loaded_volume.abs() * 1e-9);
}
