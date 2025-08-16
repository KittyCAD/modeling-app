use indexmap::IndexMap;
use kittycad_modeling_cmds::shared::Angle;

use crate::{datatypes::*, id::Id, solver::Model};

pub mod datatypes;
pub mod id;
pub mod solver;

pub enum Constraint {
    /// Also length.
    Distance(DatumPoint, DatumPoint),
    /// Also point-on-line
    DistancePointToLine(DatumPoint, DatumLine),
    /// Also perpendicular, parallel, tangent
    Angle(DatumLine, Angle),
    /// Two points are the same
    Coincident(DatumPoint, DatumPoint),
    /// These two points have the same Y value.
    Vertical(DatumPoint, DatumPoint),
    /// These two points have the same X value.
    Horizontal(DatumPoint, DatumPoint),
    /// Two points symmetric across a line.
    Symmetric(DatumLine, DatumPoint, DatumPoint),
}

pub struct Positions {
    storage: IndexMap<Id, Position>,
}

#[derive(Debug, Copy, Clone, PartialEq)]
pub struct Position {
    x: f64,
    y: f64,
}

impl Positions {
    pub fn get(&self, id: &Id) -> Result<&Position> {
        self.storage.get(id).ok_or(Error::NotFound(id.clone()))
    }
}

type Result<T> = std::result::Result<T, Error>;

#[derive(thiserror::Error, Debug)]
pub enum Error {
    #[error("ID {0} not found")]
    NotFound(Id),
    #[error("Solver error {0}")]
    Solver(Box<dyn std::error::Error>),
}

fn lookup(target_id: Id, all_ids: &[Id]) -> Result<usize> {
    // Right now data is small enough that I suspect linear search
    // beats binary search.
    for (i, id) in all_ids.iter().enumerate() {
        if id == &target_id {
            return Ok(i);
        }
    }
    Err(Error::NotFound(target_id))
}

impl Constraint {
    /// How close is this constraint to being satisfied?
    pub fn residual(&self, all_ids: &[Id], current_assignments: &[f64]) -> Result<Vec<f64>> {
        match self {
            Constraint::Distance(_p0, _p1) => todo!(),
            Constraint::DistancePointToLine(_p0, _line) => todo!(),
            Constraint::Angle(_line, _angle) => todo!(),
            Constraint::Coincident(p0, p1) => {
                let p0_x = current_assignments[lookup(p0.id_x(), all_ids)?];
                let p0_y = current_assignments[lookup(p0.id_y(), all_ids)?];
                let p1_x = current_assignments[lookup(p1.id_x(), all_ids)?];
                let p1_y = current_assignments[lookup(p1.id_y(), all_ids)?];
                Ok(vec![p0_x - p1_x, p0_y - p1_y])
            }
            Constraint::Vertical(p0, p1) => {
                let p0_x = current_assignments[lookup(p0.id_x(), all_ids)?];
                let p1_x = current_assignments[lookup(p1.id_x(), all_ids)?];
                Ok(vec![p0_x - p1_x])
            }
            Constraint::Horizontal(p0, p1) => {
                let p0_y = current_assignments[lookup(p0.id_y(), all_ids)?];
                let p1_y = current_assignments[lookup(p1.id_y(), all_ids)?];
                Ok(vec![p0_y - p1_y])
            }
            Constraint::Symmetric(_line, _p0, _p1) => todo!(),
        }
    }

    /// How many equations does this constraint correspond to?
    /// Each equation is a residual function (a measure of error)
    pub fn residual_dim(&self) -> usize {
        match self {
            Constraint::Distance(_p0, _p1) => 1,
            Constraint::DistancePointToLine(_p0, _line) => 1,
            Constraint::Angle(_line, _angle) => 1,
            Constraint::Coincident(_p0, _p1) => 2,
            Constraint::Vertical(_p0, _p1) => 1,
            Constraint::Horizontal(_p0, _p1) => 1,
            Constraint::Symmetric(_line, _p0, _p1) => 1,
        }
    }

    /// Used to construct part of a Jacobian matrix.
    /// Returns rows of the Jacobian, where in each row,
    /// each column is a variable's partial derivative for this equation.
    /// One row per equation this constraint corresponds to.
    pub fn jacobian_section(&self, _all_ids: &[Id], _current_assignments: &[f64]) -> Result<Vec<(Id, f64, i64)>> {
        match self {
            Constraint::Distance(_p0, _p1) => todo!(),
            Constraint::DistancePointToLine(_p0, _line) => todo!(),
            Constraint::Angle(_line, _angle) => todo!(),
            Constraint::Coincident(p0, _p1) => {
                // Residuals: R1 = px - fx, R2 = py - fy
                // ∂R1/∂px = 1
                // ∂R1/∂py = 0
                // ∂R2/∂px = 0
                // ∂R2/∂py = 1

                // Derivatives with respect to the fixed point's coordinates.
                let dr0_dx = 1.0;
                // let dr0_dy = 0.0;
                // let dr1_dx = 0.0;
                let dr1_dy = 1.0;

                // Indices for the residuals. This is a 2D constraint, so we have two residuals.
                // Basically all other constraints will have 1 residual.
                let i_x = 0;
                let i_y = 1;

                Ok(vec![(p0.id_x(), dr0_dx, i_x), (p0.id_y(), dr1_dy, i_y)])
            }
            Constraint::Vertical(p0, p1) => {
                // Residual: R = x1 - x2
                // ∂R/∂x for p0 and p1.
                let dr_dx0 = 1.0;
                let dr_dx1 = -1.0;

                // This constraint has a scalar residual.
                let i_residual = 0;

                // Get the 'x' variable ID for the line's points.
                let p0_x_id = p0.id_x();
                let p1_x_id = p1.id_x();

                let p0_out = (p0_x_id, dr_dx0, i_residual);
                let p1_out = (p1_x_id, dr_dx1, i_residual);
                Ok(vec![p0_out, p1_out])
            }
            Constraint::Horizontal(p0, p1) => {
                // Residual: R = y1 - y2
                // ∂R/∂y for p0 and p1.
                let dr_dy0 = 1.0;
                let dr_dy1 = -1.0;

                // This constraint has a scalar residual.
                let i_residual = 0;

                // Get the 'y' variable ID for the line's points.
                let p0_y_id = p0.id_y();
                let p1_y_id = p1.id_y();

                let p0_out = (p0_y_id, dr_dy0, i_residual);
                let p1_out = (p1_y_id, dr_dy1, i_residual);
                Ok(vec![p0_out, p1_out])
            }
            Constraint::Symmetric(_line, _p0, _p1) => todo!(),
        }
    }

    pub fn involved_ids(&self) -> Vec<Id> {
        match self {
            Constraint::Distance(_p0, _p1) => todo!(),
            Constraint::DistancePointToLine(_p0, _line) => todo!(),
            Constraint::Angle(_line, _angle) => todo!(),
            Constraint::Coincident(p0, p1) => {
                vec![p0.id(), p1.id()]
            }
            Constraint::Vertical(p0, p1) => {
                vec![p0.id(), p1.id()]
            }
            Constraint::Horizontal(p0, p1) => {
                vec![p0.id(), p1.id()]
            }
            Constraint::Symmetric(_line, _p0, _p1) => todo!(),
        }
    }
}

pub fn solve(constraints: Vec<Constraint>, initial_guesses: Vec<f64>) -> Result<()> {
    let mut model = Model::new(constraints);
    let mut final_values = initial_guesses;
    let iters = newton_faer::solve(
        &mut model,
        &mut final_values,
        newton_faer::NewtonCfg::sparse().with_adaptive(true),
    )
    .map_err(|errs| Error::Solver(Box::new(errs.into_error())))?;
    println!("num iterations={iters}, variables={final_values:#?}");
    Ok(())
}
