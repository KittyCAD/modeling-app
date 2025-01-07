use iai::black_box;

pub fn parse(program: &str) {
    black_box(kcl_lib::Program::parse(program).unwrap());
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
