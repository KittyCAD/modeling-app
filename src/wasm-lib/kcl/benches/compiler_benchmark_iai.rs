use iai::black_box;

pub fn parse(program: &str) {
    let module_id = kcl_lib::ModuleId::default();
    let tokens = kcl_lib::token::lexer(program, module_id).unwrap();
    let tok = tokens.clone();
    let parser = kcl_lib::parser::Parser::new(tok.clone());
    black_box(parser.ast().unwrap());
}

fn lex_kitt() {
    let module_id = kcl_lib::ModuleId::default();
    black_box(kcl_lib::token::lexer(KITT_PROGRAM, module_id).unwrap());
}
fn lex_pipes() {
    let module_id = kcl_lib::ModuleId::default();
    black_box(kcl_lib::token::lexer(PIPES_PROGRAM, module_id).unwrap());
}
fn lex_cube() {
    let module_id = kcl_lib::ModuleId::default();
    black_box(kcl_lib::token::lexer(CUBE_PROGRAM, module_id).unwrap());
}
fn lex_math() {
    let module_id = kcl_lib::ModuleId::default();
    black_box(kcl_lib::token::lexer(MATH_PROGRAM, module_id).unwrap());
}
fn lex_lsystem() {
    let module_id = kcl_lib::ModuleId::default();
    black_box(kcl_lib::token::lexer(LSYSTEM_PROGRAM, module_id).unwrap());
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
