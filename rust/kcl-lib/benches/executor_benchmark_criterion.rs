use criterion::{criterion_group, criterion_main, BenchmarkId, Criterion};
use kcl_lib::{test_server, UnitLength::Mm};
use tokio::runtime::Runtime;

pub fn bench_execute(c: &mut Criterion) {
    for (name, code) in [
        ("big_kitt", KITT_PROGRAM),
        ("cube", CUBE_PROGRAM),
        ("server_rack_lite", SERVER_RACK_LITE_PROGRAM),
        ("server_rack_heavy", SERVER_RACK_HEAVY_PROGRAM),
        ("lsystem", LSYSTEM_PROGRAM),
    ] {
        let mut group = c.benchmark_group("executor");
        // Configure Criterion.rs to detect smaller differences and increase sample size to improve
        // precision and counteract the resulting noise.
        group
            .sample_size(10)
            .measurement_time(std::time::Duration::from_secs(1)); // Short
                                                                  // measurement
                                                                  // time to keep
                                                                  // it from
                                                                  // running in
                                                                  // parallel
        group.bench_with_input(BenchmarkId::new("execute", name), &code, |b, &s| {
            let rt = Runtime::new().unwrap();
            // Spawn a future onto the runtime
            b.iter(|| {
                rt.block_on(test_server::execute_and_snapshot(s, Mm, None)).unwrap();
            });
        });
        group.finish();
    }
}

pub fn bench_lego(c: &mut Criterion) {
    let mut group = c.benchmark_group("executor_lego_pattern");
    // Configure Criterion.rs to detect smaller differences and increase sample size to improve
    // precision and counteract the resulting noise.
    group.sample_size(10);
    // Create lego bricks with N x 10 bumps, where N is each element of `sizes`.
    let sizes = vec![1, 2, 4];
    for size in sizes {
        group.bench_with_input(BenchmarkId::from_parameter(size), &size, |b, &size| {
            let rt = Runtime::new().unwrap();
            let code = LEGO_PROGRAM.replace("{{N}}", &size.to_string());
            // Spawn a future onto the runtime
            b.iter(|| {
                rt.block_on(test_server::execute_and_snapshot(&code, Mm, None)).unwrap();
            });
        });
    }
    group.finish();
}

criterion_group!(benches, bench_lego, bench_execute);
criterion_main!(benches);

const KITT_PROGRAM: &str = include_str!("../e2e/executor/inputs/kittycad_svg.kcl");
const CUBE_PROGRAM: &str = include_str!("../e2e/executor/inputs/cube.kcl");
const SERVER_RACK_HEAVY_PROGRAM: &str = include_str!("../e2e/executor/inputs/server-rack-heavy.kcl");
const SERVER_RACK_LITE_PROGRAM: &str = include_str!("../e2e/executor/inputs/server-rack-lite.kcl");
const LEGO_PROGRAM: &str = include_str!("../e2e/executor/inputs/slow_lego.kcl.tmpl");
const LSYSTEM_PROGRAM: &str = include_str!("../e2e/executor/inputs/lsystem.kcl");
