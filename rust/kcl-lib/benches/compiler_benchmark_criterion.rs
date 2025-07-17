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
    ] {
        c.bench_function(&format!("parse_{name}"), move |b| {
            b.iter(move || {
                black_box(kcl_lib::Program::parse(file).unwrap());
            })
        });
    }
}

pub fn bench_mock(c: &mut Criterion) {
    for (name, file) in [
        ("medium_sketch", MEDIUM_SKETCH),
        ("mike_stress_test_program", MIKE_STRESS_TEST_PROGRAM),
    ] {
        let program = kcl_lib::Program::parse_no_errs(black_box(file)).unwrap();
        c.bench_function(&format!("mock_execute_{name}"), move |b| {
            let rt = tokio::runtime::Runtime::new().unwrap();
            let ctx = rt.block_on(async { kcl_lib::ExecutorContext::new_mock(None).await });
            b.iter(|| {
                if let Err(err) = rt.block_on(async {
                    ctx.run_mock(black_box(&program), false).await?;
                    ctx.close().await;
                    Ok::<(), anyhow::Error>(())
                }) {
                    panic!("Failed to execute program: {err}");
                }
            })
        });
    }
}

criterion_group!(benches, bench_parse, bench_mock);
criterion_main!(benches);

const KITT_PROGRAM: &str = include_str!("../e2e/executor/inputs/kittycad_svg.kcl");
const PIPES_PROGRAM: &str = include_str!("../e2e/executor/inputs/pipes_on_pipes.kcl");
const CUBE_PROGRAM: &str = include_str!("../e2e/executor/inputs/cube.kcl");
const MATH_PROGRAM: &str = include_str!("../e2e/executor/inputs/math.kcl");
const MEDIUM_SKETCH: &str = include_str!("../e2e/executor/inputs/medium_sketch.kcl");
const MIKE_STRESS_TEST_PROGRAM: &str = include_str!("../tests/mike_stress_test/input.kcl");
const LSYSTEM_KOCH_SNOWFLAKE_PROGRAM: &str = include_str!("../e2e/executor/inputs/lsystem.kcl");
