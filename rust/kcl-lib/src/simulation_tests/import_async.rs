use kittycad_modeling_cmds::ModelingCmd;
use kittycad_modeling_cmds::each_cmd as mcmd;
use kittycad_modeling_cmds::ok_response::OkModelingCmdResponse;
use kittycad_modeling_cmds::units::UnitLength;
use kittycad_modeling_cmds::websocket::OkWebSocketResponseData;
use uuid::Uuid;

use crate::ExecState;
use crate::ExecutorContext;
use crate::Program;
use crate::SourceRange;

const TEST_NAME: &str = "import_async";

/// Test parsing KCL.
#[test]
fn parse() {
    super::parse(TEST_NAME)
}

/// Test that parsing and unparsing KCL produces the original KCL input.
#[tokio::test(flavor = "multi_thread")]
async fn unparse() {
    super::unparse(TEST_NAME).await
}

/// Test that KCL is executed correctly.
#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_execute() {
    super::execute(TEST_NAME, true).await
}

async fn bounds(ctx: &ExecutorContext) -> kittycad_modeling_cmds::output::BoundingBox {
    let response = ctx
        .engine
        .send_modeling_cmd(
            &ctx.engine_batch,
            Uuid::new_v4(),
            SourceRange::default(),
            &ModelingCmd::from(
                mcmd::BoundingBox::builder()
                    .output_unit(UnitLength::Millimeters)
                    .build(),
            ),
        )
        .await
        .expect("completed import must support a bounding-box query");
    let OkWebSocketResponseData::Modeling {
        modeling_response: OkModelingCmdResponse::BoundingBox(bounds),
    } = response
    else {
        panic!("expected bounding box, got {response:?}");
    };
    bounds
}

fn assert_close(actual: f64, expected: f64) {
    // Mesh coordinates use float32. These cuboids have 12 triangles each, so
    // allow for accumulation while still rejecting missing or stale bounds.
    let tolerance = 1e-9 + 64.0 * f64::from(f32::EPSILON) * expected.abs();
    assert!(
        actual.is_finite() && (actual - expected).abs() <= tolerance,
        "expected {expected}, got {actual} (absolute tolerance {tolerance})"
    );
}

fn assert_bounds(actual: &kittycad_modeling_cmds::output::BoundingBox, center: [f64; 3], dimensions: [f64; 3]) {
    for (actual, expected) in [actual.center.x, actual.center.y, actual.center.z]
        .into_iter()
        .zip(center)
        .chain(
            [actual.dimensions.x, actual.dimensions.y, actual.dimensions.z]
                .into_iter()
                .zip(dimensions),
        )
    {
        assert_close(actual, expected);
    }
}

/// Exercise both the KCL completion barrier and the async command completion
/// barrier before any camera, render, export, or idle-wait can refresh bounds.
/// Keep `kcl_test` in the name: Engine CI selects shared tests by that substring.
#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_completed_import_bounds() {
    let path = std::path::PathBuf::from("tests/import_async/completion.kcl");
    let program = Program::parse_no_errs(&std::fs::read_to_string(&path).unwrap()).unwrap();
    let ctx = crate::test_server::new_context(true, Some(path)).await.unwrap();
    let mut exec_state = ExecState::new(&ctx);
    let result = ctx.run(&program, &mut exec_state).await;
    if let Err(error) = result {
        ctx.close().await;
        panic!("async-import fixture must execute successfully: {error}");
    }
    assert!(exec_state.issues().iter().all(|issue| !issue.severity.is_err()));

    // Query first, before another modeling command can refresh a stale cache.
    let completed_kcl_bounds = bounds(&ctx).await;

    // The first read also primes the cache. Add another cuboid asynchronously,
    // at x=110..112, and demand fresh bounds as soon as its response arrives.
    // This forces a cache invalidation check independently of import timing
    // relative to the native extrude in the KCL program above.
    let import_id = Uuid::new_v4();
    let obj = include_str!("../../tests/import_async/completion.obj")
        .lines()
        .map(|line| {
            if let Some(vertex) = line.strip_prefix("v ") {
                let xyz = vertex
                    .split_whitespace()
                    .map(|s| s.parse::<f64>().unwrap())
                    .collect::<Vec<_>>();
                format!("v {} {} {}", xyz[0] + 100.0, xyz[1], xyz[2])
            } else {
                line.to_owned()
            }
        })
        .collect::<Vec<_>>()
        .join("\n");
    ctx.engine
        .async_modeling_cmd(
            import_id,
            SourceRange::default(),
            &ModelingCmd::from(
                mcmd::ImportFiles::builder()
                    .files(vec![
                        kittycad_modeling_cmds::ImportFile::builder()
                            .path("translated-completion.obj".into())
                            .data(obj.into_bytes())
                            .build(),
                    ])
                    .format(kittycad_modeling_cmds::format::InputFormat3d::Obj(
                        kittycad_modeling_cmds::format::obj::import::Options::builder()
                            .coords(*kittycad_modeling_cmds::coord::KITTYCAD)
                            .units(UnitLength::Millimeters)
                            .build(),
                    ))
                    .build(),
            ),
        )
        .await
        .unwrap();
    ctx.engine
        .ensure_async_commands_completed(&ctx.engine_batch)
        .await
        .unwrap();
    let completed_command_bounds = bounds(&ctx).await;
    ctx.close().await;

    assert_bounds(&completed_kcl_bounds, [6.0, 11.5, 17.0], [12.0, 23.0, 34.0]);
    assert_bounds(&completed_command_bounds, [56.0, 11.5, 17.0], [112.0, 23.0, 34.0]);
}
