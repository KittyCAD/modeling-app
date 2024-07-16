use criterion::{criterion_group, criterion_main, Criterion};

pub fn bench_digest(c: &mut Criterion) {
    for (name, file) in [
        ("pipes_on_pipes", PIPES_PROGRAM),
        ("big_kitt", KITT_PROGRAM),
        ("cube", CUBE_PROGRAM),
        ("math", MATH_PROGRAM),
        ("mike_stress_test", MIKE_STRESS_TEST_PROGRAM),
    ] {
        let tokens = kcl_lib::token::lexer(file).unwrap();
        let prog = kcl_lib::parser::Parser::new(tokens).ast().unwrap();
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

const KITT_PROGRAM: &str = include_str!("../../tests/executor/inputs/kittycad_svg.kcl");
const PIPES_PROGRAM: &str = include_str!("../../tests/executor/inputs/pipes_on_pipes.kcl");
const CUBE_PROGRAM: &str = include_str!("../../tests/executor/inputs/cube.kcl");
const MATH_PROGRAM: &str = include_str!("../../tests/executor/inputs/math.kcl");
const MIKE_STRESS_TEST_PROGRAM: &str = include_str!("../../tests/executor/inputs/mike_stress_test.kcl");
