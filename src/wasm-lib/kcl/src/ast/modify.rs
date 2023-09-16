use crate::{
    ast::types::{FormatOptions, Program},
    engine::EngineConnection,
    errors::KclError,
};

/// Update the AST to reflect the new state of the program after something like
/// a move or a new line.
pub fn modify_ast(program: Program, engine: &mut EngineConnection) -> Result<(Program, String), KclError> {
    Ok((program.clone(), program.recast(&FormatOptions::default(), 0)))
}
