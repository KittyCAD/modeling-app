use criterion::{criterion_group, criterion_main, Criterion};

pub fn criterion_benchmark(c: &mut Criterion) {
    c.bench_function("parse + lex cube", |b| b.iter(|| lex_and_parse(CUBE_PROGRAM)));
    c.bench_function("parse + lex big kitt", |b| {
        b.iter(|| lex_and_parse(include_str!("../../tests/executor/inputs/kittycad_svg.kcl")))
    });
}

fn lex_and_parse(program: &str) {
    let tokens = kcl_lib::tokeniser::lexer(program);
    let parser = kcl_lib::parser::Parser::new(tokens);
    parser.ast().unwrap();
}

criterion_group!(benches, criterion_benchmark);
criterion_main!(benches);

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
