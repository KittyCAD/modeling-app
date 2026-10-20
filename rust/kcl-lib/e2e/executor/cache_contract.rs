//! Cache contracts exercised against real files and a real engine session.

use kcl_lib::ExecOutcome;
use kcl_lib::ExecutorContext;
use kcl_lib::Program;
use kcl_lib::TypedPath;
use kittycad_modeling_cmds::ModelingCmd;
use kittycad_modeling_cmds::each_cmd as mcmd;
use kittycad_modeling_cmds::ok_response::OkModelingCmdResponse;
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
    assert!(!first.from_cache);
    assert_volume(volume(&ctx).await, 5.0);
    let cached = execute(&ctx, IMPORTING_BODY).await;
    assert!(cached.from_cache);
    assert_eq!(first.variables, cached.variables);

    // Same path and unchanged entry point, different dependency bytes.
    tokio::fs::write(&dependency, "@settings(kclVersion = 3.0)\nexport height = 12mm\n")
        .await
        .unwrap();
    let changed = execute(&ctx, IMPORTING_BODY).await;
    assert!(!changed.from_cache);
    assert_volume(volume(&ctx).await, 12.0);
    let cached = execute(&ctx, IMPORTING_BODY).await;
    assert!(cached.from_cache);
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
    execute(&ctx, BODY).await;
    assert!(execute(&ctx, BODY).await.from_cache);
    ctx.settings.with_current_file(TypedPath(second_path));
    assert!(
        !execute(&ctx, BODY).await.from_cache,
        "a different entry-point file must not inherit the old file's cached execution metadata"
    );
    assert_volume(volume(&ctx).await, 5.0);
    assert!(execute(&ctx, BODY).await.from_cache);
    ctx.close().await;
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_cache_contract_replacement_engine_rebuilds_without_a_javascript_reset() {
    let program = Program::parse_no_errs(BODY).unwrap();
    let version = program.language_version().unwrap();
    let first = kcl_lib::test_server::new_context(true, None, false, version)
        .await
        .unwrap();
    execute(&first, BODY).await;
    assert_volume(volume(&first).await, 5.0);
    assert!(execute(&first, BODY).await.from_cache);
    let cache = first.cache.clone();
    first.close().await;

    // Reuse interpreter state while the real engine's scene is brand new, as
    // happens when the browser reconnects without replacing its Rust context.
    let replacement = kcl_lib::test_server::new_context(true, None, false, version)
        .await
        .unwrap()
        .with_cache(cache);
    assert!(
        !execute(&replacement, BODY).await.from_cache,
        "memoized IDs belong to the disconnected engine, not its replacement"
    );
    assert_volume(volume(&replacement).await, 5.0);
    assert!(execute(&replacement, BODY).await.from_cache);
    replacement.close().await;
}
