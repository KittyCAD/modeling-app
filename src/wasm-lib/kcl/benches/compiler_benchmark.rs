use criterion::{black_box, criterion_group, criterion_main, Criterion};

pub fn bench_lex(c: &mut Criterion) {
    c.bench_function("lex_cube", |b| b.iter(|| lex(CUBE_PROGRAM)));
    c.bench_function("lex_big_kitt", |b| b.iter(|| lex(KITT_PROGRAM)));
    c.bench_function("lex_pipes_on_pipes", |b| b.iter(|| lex(PIPES_PROGRAM)));
}

pub fn bench_lex_parse(c: &mut Criterion) {
    c.bench_function("parse_lex_cube", |b| b.iter(|| lex_and_parse(CUBE_PROGRAM)));
    c.bench_function("parse_lex_big_kitt", |b| b.iter(|| lex_and_parse(KITT_PROGRAM)));
    c.bench_function("parse_lex_pipes_on_pipes", |b| b.iter(|| lex_and_parse(PIPES_PROGRAM)));
}

fn lex(program: &str) {
    black_box(kcl_lib::token::lexer(program));
}

fn lex_and_parse(program: &str) {
    let tokens = kcl_lib::token::lexer(program);
    let parser = kcl_lib::parser::Parser::new(tokens);
    black_box(parser.ast().unwrap());
}

criterion_group!(benches, bench_lex, bench_lex_parse);
criterion_main!(benches);

const KITT_PROGRAM: &str = include_str!("../../tests/executor/inputs/kittycad_svg.kcl");
const PIPES_PROGRAM: &str = include_str!("../../tests/executor/inputs/pipes_on_pipes.kcl");
const CUBE_PROGRAM: &str = r#"fn cube = (pos, scale) => {
  const sg = startSketchAt(pos)
    |> line([0, scale], %)
    |> line([scale, 0], %)
    |> line([0, -scale], %)

  return sg
}

const b1 = cube([0,0], 10)
const pt1 = b1[0]
show(b1)"#;
