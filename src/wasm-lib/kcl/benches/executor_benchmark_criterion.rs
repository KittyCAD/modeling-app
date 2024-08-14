use criterion::{criterion_group, criterion_main, BenchmarkId, Criterion};
use kcl_lib::test_server;
use tokio::runtime::Runtime;

pub fn bench_execute(c: &mut Criterion) {
    for (name, code) in [
        ("big_kitt", KITT_PROGRAM),
        ("cube", CUBE_PROGRAM),
        ("server_rack_heavy", SERVER_RACK_HEAVY_PROGRAM),
    ] {
        let mut group = c.benchmark_group("executor");
        // Configure Criterion.rs to detect smaller differences and increase sample size to improve
        // precision and counteract the resulting noise.
        group.sample_size(10);
        group.bench_with_input(BenchmarkId::new("execute_", name), &code, |b, &s| {
            let rt = Runtime::new().unwrap();

            // Spawn a future onto the runtime
            b.iter(|| {
                rt.block_on(test_server::execute_and_snapshot(
                    s,
                    kcl_lib::settings::types::UnitLength::Mm,
                ))
                .unwrap();
            });
        });
        group.finish();
    }
}

criterion_group!(benches, bench_execute);
criterion_main!(benches);

const KITT_PROGRAM: &str = include_str!("../../tests/executor/inputs/kittycad_svg.kcl");
const CUBE_PROGRAM: &str = include_str!("../../tests/executor/inputs/cube.kcl");
const SERVER_RACK_HEAVY_PROGRAM: &str = include_str!("../../tests/executor/inputs/server-rack-heavy.kcl");
