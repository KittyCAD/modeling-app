use std::hint::black_box;

use criterion::{Criterion, criterion_group, criterion_main};

pub fn bench_parse(c: &mut Criterion) {
    for (name, file) in [
        ("pipes_on_pipes", PIPES_PROGRAM),
        ("big_kitt", KITT_PROGRAM),
        ("cube", CUBE_PROGRAM),
        ("math", MATH_PROGRAM),
        ("mike_stress_test", MIKE_STRESS_TEST_PROGRAM),
        ("koch snowflake", LSYSTEM_KOCH_SNOWFLAKE_PROGRAM),
        ("nested function calls", NESTED_FN_CALLS),
    ] {
        c.bench_function(&format!("parse_{name}"), move |b| {
            b.iter(move || {
                black_box(kcl_lib::Program::parse(file).unwrap());
            })
        });
    }
}

/// This benchmarks the same sort of code that the ZDS app uses when users
/// drag a point/line around in sketch mode. This benchmark should correlate with
/// user-perceived latency in sketch mode.
pub fn bench_mock_warmed_up(c: &mut Criterion) {
    for (name, file) in [
        ("medium_sketch", MEDIUM_SKETCH),
        ("mike_stress_test_program", MIKE_STRESS_TEST_PROGRAM),
    ] {
        let program = kcl_lib::Program::parse_no_errs(black_box(file)).unwrap();
        c.bench_function(&format!("mock_execute_{name}"), move |b| {
            let rt = tokio::runtime::Runtime::new().unwrap();
            let ctx = rt.block_on(async { kcl_lib::ExecutorContext::new_mock(None).await });
            // First run outside the benchmark measurement, to initialize KCL memory.
            #[cfg(feature = "artifact-graph")]
            let mock_config = kcl_lib::MockConfig {
                use_prev_memory: false,
                ..Default::default()
            };
            #[cfg(not(feature = "artifact-graph"))]
            let mock_config = kcl_lib::MockConfig { use_prev_memory: false };
            let _out = rt.block_on(async { ctx.run_mock(&program, &mock_config).await.unwrap() });
            b.iter(|| {
                if let Err(err) = rt.block_on(async {
                    // Subsequent runs set use_previous_memory to true, because that's what the app
                    // uses in production.
                    ctx.run_mock(black_box(&program), &Default::default()).await?;
                    ctx.close().await;
                    Ok::<(), anyhow::Error>(())
                }) {
                    panic!("Failed to execute program: {err}");
                }
            })
        });
    }
}

/// The frontend needs to recast every time the user drags a line/point around in sketch mode,
/// so this should also correlate with user-perceived sketch mode latency.
pub fn recast(c: &mut Criterion) {
    for (name, file) in [
        ("medium_sketch", MEDIUM_SKETCH),
        ("mike_stress_test_program", MIKE_STRESS_TEST_PROGRAM),
    ] {
        let program = kcl_lib::Program::parse_no_errs(black_box(file)).unwrap();
        c.bench_function(&format!("recast_{name}"), move |b| {
            b.iter(|| {
                black_box(program.recast());
            })
        });
    }
}

criterion_group!(benches, bench_parse, bench_mock_warmed_up, recast);
criterion_main!(benches);

const KITT_PROGRAM: &str = include_str!("../e2e/executor/inputs/kittycad_svg.kcl");
const PIPES_PROGRAM: &str = include_str!("../e2e/executor/inputs/pipes_on_pipes.kcl");
const CUBE_PROGRAM: &str = include_str!("../e2e/executor/inputs/cube.kcl");
const MATH_PROGRAM: &str = include_str!("../e2e/executor/inputs/math.kcl");
const MEDIUM_SKETCH: &str = include_str!("../e2e/executor/inputs/medium_sketch.kcl");
const MIKE_STRESS_TEST_PROGRAM: &str = include_str!("../tests/mike_stress_test/input.kcl");
const LSYSTEM_KOCH_SNOWFLAKE_PROGRAM: &str = include_str!("../e2e/executor/inputs/lsystem.kcl");
// Previously had O(c^n) behaviour due to excessive backtracking in the parser, https://github.com/KittyCAD/modeling-app/issues/7866
const NESTED_FN_CALLS: &str = "extrude(
 close(
  xLine(
    yLine(
      xLine(
        yLine(
          startProfile(at)
        ),
        length = 10
      ),
      length = 10
    ),
    length = 10
  )
 )
)";
