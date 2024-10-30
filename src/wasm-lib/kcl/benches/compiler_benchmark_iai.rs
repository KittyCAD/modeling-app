use iai::black_box;

pub fn parse(program: &str) {
    let tokens = kcl_lib::token::lexer(program).unwrap();
    let tok = tokens.clone();
    let parser = kcl_lib::parser::Parser::new(tok.clone());
    black_box(parser.ast().unwrap());
}

fn lex_kitt() {
    black_box(kcl_lib::token::lexer(KITT_PROGRAM).unwrap());
}
fn lex_pipes() {
    black_box(kcl_lib::token::lexer(PIPES_PROGRAM).unwrap());
}
fn lex_cube() {
    black_box(kcl_lib::token::lexer(CUBE_PROGRAM).unwrap());
}
fn lex_math() {
    black_box(kcl_lib::token::lexer(MATH_PROGRAM).unwrap());
}
fn lex_lsystem() {
    black_box(kcl_lib::token::lexer(LSYSTEM_PROGRAM).unwrap());
}

fn parse_kitt() {
    parse(KITT_PROGRAM)
}
fn parse_pipes() {
    parse(PIPES_PROGRAM)
}
fn parse_cube() {
    parse(CUBE_PROGRAM)
}
fn parse_math() {
    parse(MATH_PROGRAM)
}
fn parse_lsystem() {
    parse(LSYSTEM_PROGRAM)
}

iai::main! {
    lex_kitt,
    lex_pipes,
    lex_cube,
    lex_math,
    lex_lsystem,
    parse_kitt,
    parse_pipes,
    parse_cube,
    parse_math,
    parse_lsystem,
}

const KITT_PROGRAM: &str = include_str!("../../tests/executor/inputs/kittycad_svg.kcl");
const PIPES_PROGRAM: &str = include_str!("../../tests/executor/inputs/pipes_on_pipes.kcl");
const CUBE_PROGRAM: &str = include_str!("../../tests/executor/inputs/cube.kcl");
const MATH_PROGRAM: &str = include_str!("../../tests/executor/inputs/math.kcl");
const LSYSTEM_PROGRAM: &str = include_str!("../../tests/executor/inputs/lsystem.kcl");
