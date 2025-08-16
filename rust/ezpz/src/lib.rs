pub use crate::constraints::Constraint;
use indexmap::IndexMap;
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
pub fn solve(constraints: Vec<Constraint>, initial_guesses: IndexMap<Id, f64>) -> Result<Vec<f64>> {
    // TODO: The model has to take in the list of IDs.
    let mut model = Model::new(constraints);
    let mut final_values: Vec<_> = initial_guesses.into_iter().map(|(_id, guess)| guess).collect();
    let iters = newton_faer::solve(
        &mut model,
        &mut final_values,
        newton_faer::NewtonCfg::sparse().with_adaptive(true),
    )
    .map_err(|errs| Error::Solver(Box::new(errs.into_error())))?;
    println!("num iterations={iters}, variables={final_values:#?}");
    Ok(final_values)
}

#[cfg(test)]
mod tests {

    use crate::datatypes::DatumPoint;

    use super::*;

    #[test]
    fn test_simple() {
        // We want to constrain two points.
        let p = DatumPoint::new(Id::new_point('p'));
        let q = DatumPoint::new(Id::new_point('q'));

        // Start p at the origin, and q at (1,9)
        let initial_guesses = IndexMap::from([(p.id_x(), 0.0), (p.id_y(), 0.0), (q.id_x(), 1.0), (q.id_y(), 9.0)]);

        // Now constrain the points to be vertical.
        let actual = solve(vec![Constraint::Vertical(p, q)], initial_guesses).unwrap();

        // The new actual variables are the same order as we supplied the initial guess variables,
        // i.e. px, py, qx, qy
        let actual_px = actual[0];
        let actual_py = actual[1];
        let actual_qx = actual[2];
        let actual_qy = actual[3];
        // if the constraint was solved, P and Q should have equal X components.
        assert_eq!(actual_px, actual_qx);
        // and the Y components didn't matter in the end, so they should stay the same.
        assert_eq!(actual_py, 0.0);
        assert_eq!(actual_qy, 9.0);
    }
}
