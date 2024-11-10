use criterion::{black_box, criterion_group, criterion_main, Criterion};

pub fn bench_lex(c: &mut Criterion) {
    let module_id = kcl_lib::ModuleId::default();
    c.bench_function("lex_cube", |b| b.iter(|| lex(CUBE_PROGRAM, module_id)));
    c.bench_function("lex_big_kitt", |b| b.iter(|| lex(KITT_PROGRAM, module_id)));
    c.bench_function("lex_pipes_on_pipes", |b| b.iter(|| lex(PIPES_PROGRAM, module_id)));
}

pub fn bench_parse(c: &mut Criterion) {
    for (name, file) in [
        ("pipes_on_pipes", PIPES_PROGRAM),
        ("big_kitt", KITT_PROGRAM),
        ("cube", CUBE_PROGRAM),
        ("math", MATH_PROGRAM),
        ("mike_stress_test", MIKE_STRESS_TEST_PROGRAM),
        ("koch snowflake", LSYSTEM_KOCH_SNOWFLAKE_PROGRAM),
    ] {
        let module_id = kcl_lib::ModuleId::default();
        let tokens = kcl_lib::token::lexer(file, module_id).unwrap();
        c.bench_function(&format!("parse_{name}"), move |b| {
            let tok = tokens.clone();
            b.iter(move || {
                let parser = kcl_lib::parser::Parser::new(tok.clone());
                black_box(parser.ast().unwrap());
            })
        });
    }
}

fn lex(program: &str, module_id: kcl_lib::ModuleId) {
    black_box(kcl_lib::token::lexer(program, module_id).unwrap());
}

criterion_group!(benches, bench_lex, bench_parse);
criterion_main!(benches);

const KITT_PROGRAM: &str = include_str!("../../tests/executor/inputs/kittycad_svg.kcl");
const PIPES_PROGRAM: &str = include_str!("../../tests/executor/inputs/pipes_on_pipes.kcl");
const CUBE_PROGRAM: &str = include_str!("../../tests/executor/inputs/cube.kcl");
const MATH_PROGRAM: &str = include_str!("../../tests/executor/inputs/math.kcl");
const MIKE_STRESS_TEST_PROGRAM: &str = include_str!("../../tests/executor/inputs/mike_stress_test.kcl");
const LSYSTEM_KOCH_SNOWFLAKE_PROGRAM: &str = include_str!("../../tests/executor/inputs/lsystem.kcl");
