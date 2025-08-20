pub use crate::constraints::Constraint;
// Only public for now so that I can benchmark it.
// TODO: Replace this with an end-to-end benchmark,
// or find a different way to structure modules.
pub use crate::id::{Id, IdGenerator};
use crate::solver::Model;

/// Each kind of constraint we support.
mod constraints;
/// Geometric data (lines, points, etc).
pub mod datatypes;
/// IDs of various entities, points, scalars etc.
mod id;
/// Numeric solver using sparse matrices.
mod solver;

#[derive(thiserror::Error, Debug)]
pub enum Error {
    #[error("{0}")]
    NonLinearSystemError(NonLinearSystemError),
    #[error("Solver error {0}")]
    Solver(Box<dyn std::error::Error>),
}

#[derive(thiserror::Error, Debug)]
pub enum NonLinearSystemError {
    #[error("ID {0} not found")]
    NotFound(Id),
}

#[derive(Debug)]
pub struct SolveOutcome {
    pub final_values: Vec<f64>,
    pub iterations: usize,
}

/// Given some initial guesses, constrain them.
/// Returns the same variables in the same order, but constrained.
pub fn solve(constraints: Vec<Constraint>, initial_guesses: Vec<(Id, f64)>) -> Result<SolveOutcome, Error> {
    let (all_variables, mut final_values): (Vec<Id>, Vec<f64>) = initial_guesses.into_iter().unzip();
    let mut model = Model::new(constraints, all_variables);
    let iterations = newton_faer::solve(
        &mut model,
        &mut final_values,
        newton_faer::NewtonCfg::sparse().with_adaptive(true),
    )
    .map_err(|errs| Error::Solver(Box::new(errs.into_error())))?;
    Ok(SolveOutcome {
        final_values,
        iterations,
    })
}

#[cfg(test)]
mod tests {

    use super::*;
    use crate::datatypes::{DatumPoint, LineSegment};

    #[test]
    fn simple() {
        let mut id_generator = IdGenerator::default();
        // We want to constrain two points.
        let p = DatumPoint::new(&mut id_generator);
        let q = DatumPoint::new(&mut id_generator);

        // Start p at the origin, and q at (0.01,9)
        let initial_guesses = vec![
            // px and py
            (p.id_x(), 0.0),
            (p.id_y(), 0.0),
            // qx and qy
            (q.id_x(), 0.01),
            (q.id_y(), 9.0),
        ];

        // Now constrain the points to be vertical.
        let actual = solve(
            vec![
                Constraint::Vertical(LineSegment::new(p, q, &mut id_generator)),
                Constraint::Fixed(p.id_x(), 0.0),
                Constraint::Fixed(p.id_y(), 0.0),
                Constraint::Fixed(q.id_y(), 9.0),
            ],
            initial_guesses,
        )
        .unwrap();

        // The new actual variables are the same order as we supplied the initial guess variables,
        // i.e. px, py, qx, qy
        eprintln!("{}", actual.iterations);
        let actual_px = actual.final_values[0];
        let actual_py = actual.final_values[1];
        let actual_qx = actual.final_values[2];
        let actual_qy = actual.final_values[3];
        // if the constraint was solved, P and Q should have equal X components.
        assert_eq!(actual_px, actual_qx);
        // and the Y components didn't matter in the end, so they should stay the same.
        assert_eq!(actual_py, 0.0);
        assert!(actual_qy > 0.0);
        assert!(actual.iterations <= 2);
    }

    #[test]
    fn dead_simple() {
        let mut id_generator = IdGenerator::default();

        // We want to constrain this point.
        let p = DatumPoint::new(&mut id_generator);

        // Start p at some initial guess.
        let initial_guesses = vec![
            // px and py
            (p.id_x(), 0.1),
            (p.id_y(), 0.1),
        ];

        // Now add constraints.
        // Two very simple constraints.
        let actual = solve(
            vec![
                // p.x == 0
                Constraint::Fixed(p.id_x(), 0.0),
                // p.y == 0
                Constraint::Fixed(p.id_y(), 0.0),
            ],
            initial_guesses,
        )
        .unwrap();

        // The new actual variables are the same order as we supplied the initial guess variables,
        // i.e. px, py, qx, qy
        let actual_px = actual.final_values[0];
        let actual_py = actual.final_values[1];

        // if the constraint was solved, P and Q should have equal X components.
        assert_eq!(actual_px, 0.0);
        assert_eq!(actual_py, 0.0);
        assert!(actual.iterations < 3)
    }

    #[test]
    fn rectangle() {
        let mut id_generator = IdGenerator::default();
        // First square (lower case IDs)
        let p0 = DatumPoint::new(&mut id_generator);
        let p1 = DatumPoint::new(&mut id_generator);
        let p2 = DatumPoint::new(&mut id_generator);
        let p3 = DatumPoint::new(&mut id_generator);
        let line0_bottom = LineSegment::new(p0, p1, &mut id_generator);
        let line0_right = LineSegment::new(p1, p2, &mut id_generator);
        let line0_top = LineSegment::new(p2, p3, &mut id_generator);
        let line0_left = LineSegment::new(p3, p0, &mut id_generator);
        let constraints0 = vec![
            Constraint::Fixed(p0.id_x(), 1.0),
            Constraint::Fixed(p0.id_y(), 1.0),
            Constraint::Horizontal(line0_bottom),
            Constraint::Horizontal(line0_top),
            Constraint::Vertical(line0_left),
            Constraint::Vertical(line0_right),
            Constraint::Distance(p0, p1, 4.0),
            Constraint::Distance(p0, p3, 3.0),
        ];

        // Second square (upper case IDs)
        let p4 = DatumPoint::new(&mut id_generator);
        let p5 = DatumPoint::new(&mut id_generator);
        let p6 = DatumPoint::new(&mut id_generator);
        let p7 = DatumPoint::new(&mut id_generator);
        let line1_bottom = LineSegment::new(p4, p5, &mut id_generator);
        let line1_right = LineSegment::new(p5, p6, &mut id_generator);
        let line1_top = LineSegment::new(p6, p7, &mut id_generator);
        let line1_left = LineSegment::new(p7, p4, &mut id_generator);

        // Start p at the origin, and q at (1,9)
        let initial_guesses = vec![
            // First square.
            (p0.id_x(), 1.0),
            (p0.id_y(), 1.0),
            (p1.id_x(), 4.5),
            (p1.id_y(), 1.5),
            (p2.id_x(), 4.0),
            (p2.id_y(), 3.5),
            (p3.id_x(), 1.5),
            (p3.id_y(), 3.0),
            // Second square.
            (p4.id_x(), 2.0),
            (p4.id_y(), 2.0),
            (p5.id_x(), 5.5),
            (p5.id_y(), 3.5),
            (p6.id_x(), 5.0),
            (p6.id_y(), 4.5),
            (p7.id_x(), 2.5),
            (p7.id_y(), 4.0),
        ];

        let constraints1 = vec![
            Constraint::Fixed(p4.id_x(), 2.0),
            Constraint::Fixed(p4.id_y(), 2.0),
            Constraint::Horizontal(line1_bottom),
            Constraint::Horizontal(line1_top),
            Constraint::Vertical(line1_left),
            Constraint::Vertical(line1_right),
            Constraint::Distance(p4, p5, 4.0),
            Constraint::Distance(p4, p7, 4.0),
        ];

        let mut constraints = constraints0;
        constraints.extend(constraints1);
        let actual = solve(constraints, initial_guesses).unwrap();
        // This forms two rectangles.
        assert_eq!(
            actual.final_values,
            vec![
                1.0, 1.0, 5.0, 1.0, 5.0, 4.0, 1.0, 4.0, 2.0, 2.0, 6.0, 2.0, 6.0, 6.0, 2.0, 6.0
            ]
        );
        assert!(actual.iterations <= 10)
        // Uncomment this to print out the points nicely.
        // for (point_num, (i, j)) in [
        //     // first square
        //     (0, 1),
        //     (2, 3),
        //     (4, 5),
        //     (6, 7),
        //     // second square
        //     (8, 9),
        //     (10, 11),
        //     (12, 13),
        //     (14, 15),
        // ]
        // .into_iter()
        // .enumerate()
        // {
        //     let x = actual.final_values[i];
        //     let y = actual.final_values[j];
        //     eprintln!("p{point_num}: ({x},{y})");
        // }
    }
}
