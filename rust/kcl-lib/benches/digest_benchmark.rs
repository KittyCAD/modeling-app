use criterion::{criterion_group, criterion_main, Criterion};

pub fn bench_digest(c: &mut Criterion) {
    for (name, file) in [
        ("pipes_on_pipes", PIPES_PROGRAM),
        ("big_kitt", KITT_PROGRAM),
        ("cube", CUBE_PROGRAM),
        ("math", MATH_PROGRAM),
        ("mike_stress_test", MIKE_STRESS_TEST_PROGRAM),
        ("lsystem", LSYSTEM_PROGRAM),
    ] {
        let prog = kcl_lib::Program::parse_no_errs(file).unwrap();
        c.bench_function(&format!("digest_{name}"), move |b| {
            let prog = prog.clone();

            b.iter(move || {
                let mut prog = prog.clone();
                prog.compute_digest();
            });
        });
    }
}

criterion_group!(benches, bench_digest);
criterion_main!(benches);

const KITT_PROGRAM: &str = include_str!("../e2e/executor/inputs/kittycad_svg.kcl");
const PIPES_PROGRAM: &str = include_str!("../e2e/executor/inputs/pipes_on_pipes.kcl");
const CUBE_PROGRAM: &str = include_str!("../e2e/executor/inputs/cube.kcl");
const MATH_PROGRAM: &str = include_str!("../e2e/executor/inputs/math.kcl");
const MIKE_STRESS_TEST_PROGRAM: &str = include_str!("../tests/mike_stress_test/input.kcl");
const LSYSTEM_PROGRAM: &str = include_str!("../e2e/executor/inputs/lsystem.kcl");
