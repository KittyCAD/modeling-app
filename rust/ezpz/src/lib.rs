pub use crate::constraints::Constraint;
// Only public for now so that I can benchmark it.
// TODO: Replace this with an end-to-end benchmark,
// or find a different way to structure modules.
pub use crate::id::Id;

use crate::solver::Model;

/// Each kind of constraint we support.
mod constraints;
/// Geometric data (lines, points, etc).
mod datatypes;
/// IDs of various entities, points, scalars etc.
mod id;
/// Numeric solver using sparse matrices.
mod solver;

type Result<T> = std::result::Result<T, Error>;

#[derive(thiserror::Error, Debug)]
pub enum Error {
    #[error("ID {0} not found")]
    NotFound(Id),
    #[error("Solver error {0}")]
    Solver(Box<dyn std::error::Error>),
}

/// Given some initial guesses, constrain them.
/// Returns the same variables in the same order, but constrained.
pub fn solve(constraints: Vec<Constraint>, initial_guesses: Vec<f64>) -> Result<Vec<f64>> {
    let mut model = Model::new(constraints);
    let mut final_values = initial_guesses;
    let iters = newton_faer::solve(
        &mut model,
        &mut final_values,
        newton_faer::NewtonCfg::sparse().with_adaptive(true),
    )
    .map_err(|errs| Error::Solver(Box::new(errs.into_error())))?;
    println!("num iterations={iters}, variables={final_values:#?}");
    Ok(final_values)
}
