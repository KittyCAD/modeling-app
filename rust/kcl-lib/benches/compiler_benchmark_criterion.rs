use criterion::{black_box, criterion_group, criterion_main, Criterion};

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

criterion_group!(benches, bench_parse);
criterion_main!(benches);

const KITT_PROGRAM: &str = include_str!("../e2e/executor/inputs/kittycad_svg.kcl");
const PIPES_PROGRAM: &str = include_str!("../e2e/executor/inputs/pipes_on_pipes.kcl");
const CUBE_PROGRAM: &str = include_str!("../e2e/executor/inputs/cube.kcl");
const MATH_PROGRAM: &str = include_str!("../e2e/executor/inputs/math.kcl");
const MIKE_STRESS_TEST_PROGRAM: &str = include_str!("../tests/mike_stress_test/input.kcl");
const LSYSTEM_KOCH_SNOWFLAKE_PROGRAM: &str = include_str!("../e2e/executor/inputs/lsystem.kcl");
