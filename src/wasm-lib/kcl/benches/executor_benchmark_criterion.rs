use criterion::{criterion_group, criterion_main, BenchmarkId, Criterion};
use kcl_lib::test_server;
use tokio::runtime::Runtime;

pub fn bench_execute(c: &mut Criterion) {
    for (name, code) in [
        ("big_kitt", KITT_PROGRAM),
        ("cube", CUBE_PROGRAM),
        ("mike_stress_test", MIKE_STRESS_TEST_PROGRAM),
        ("server_rack_heavy", SERVER_RACK_HEAVY_PROGRAM),
    ] {
        c.bench_with_input(BenchmarkId::new("execute_", name), &code, |b, &s| {
            let rt = Runtime::new().unwrap();

            // Spawn a future onto the runtime
            b.iter(|| {
                let result = rt.block_on(test_server::execute_and_snapshot(
                    s,
                    kcl_lib::settings::types::UnitLength::Mm,
                ));
                assert!(result.is_ok());
            });
        });
    }
}

criterion_group!(benches, bench_execute);
criterion_main!(benches);

const KITT_PROGRAM: &str = include_str!("../../tests/executor/inputs/kittycad_svg.kcl");
const CUBE_PROGRAM: &str = include_str!("../../tests/executor/inputs/cube.kcl");
const MIKE_STRESS_TEST_PROGRAM: &str = include_str!("../../tests/executor/inputs/mike_stress_test.kcl");
const SERVER_RACK_HEAVY_PROGRAM: &str = include_str!("../../tests/executor/inputs/server-rack-heavy.kcl");
