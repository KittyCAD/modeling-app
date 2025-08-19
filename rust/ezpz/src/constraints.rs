use kittycad_modeling_cmds::shared::Angle;

use crate::{Error, Result, datatypes::*, id::Id, solver::Layout};

/// Each geometric constraint we support.
#[derive(Clone, Copy)]
pub enum Constraint {
    /// Also length.
    Distance(DatumPoint, DatumPoint, Distance),
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
    /// Meaningless constraint.
    /// Used to ensure matrices are square.
    Null,
    /// Some scalar value is fixed.
    Fixed(Id, f64),
    /// This point cannot change.
    PointFixed(DatumPoint, f64, f64),
}

/// Given a list of all IDs in the system, find the target ID's index in that list.
pub fn lookup(target_id: Id, all_ids: &[Id]) -> Result<usize> {
    // Right now data is small enough that I suspect linear search
    // beats binary search.
    // I think I'm probably supposed to do this in the RowMap type:
    // <https://docs.rs/newton_faer/latest/newton_faer/trait.RowMap.html>
    // but it's not very well commented and I don't really understand it.
    for (i, id) in all_ids.iter().enumerate() {
        if id == &target_id {
            return Ok(i);
        }
    }
    Err(Error::NotFound(target_id))
}

/// Describes one value in one row of the Jacobian matrix.
#[derive(Clone, Copy, Debug)]
pub struct JacobianVar {
    /// Which variable are we talking about?
    /// Corresponds to one column in the row.
    pub id: Id,
    /// What value is its partial derivative?
    pub partial_derivative: f64,
}

/// One row of the Jacobian matrix.
/// I.e. describes a single equation in the system of equations being solved.
/// Specifically, it gives the partial derivatives of every variable in the equation.
/// If a variable isn't given, assume its partial derivative is 0.
#[derive(Default, Debug)]
pub struct JacobianRow {
    nonzero_columns: Vec<JacobianVar>,
}

impl JacobianRow {
    /// Iterate over columns.
    pub fn iter(&mut self) -> impl Iterator<Item = &JacobianVar> {
        self.nonzero_columns.iter()
    }
}

/// Iterate over columns in the row.
impl IntoIterator for JacobianRow {
    type Item = JacobianVar;
    type IntoIter = std::vec::IntoIter<Self::Item>;

    /// Iterate over columns in the row.
    fn into_iter(self) -> Self::IntoIter {
        self.nonzero_columns.into_iter()
    }
}

impl Constraint {
    /// How close is this constraint to being satisfied?
    pub fn residual(&self, layout: &Layout, current_assignments: &[f64]) -> Result<Vec<f64>> {
        match self {
            Constraint::Distance(p0, p1, expected_distance) => {
                let p0_x = current_assignments[layout.index_of(p0.id_x())?];
                let p0_y = current_assignments[layout.index_of(p0.id_y())?];
                let p1_x = current_assignments[layout.index_of(p1.id_x())?];
                let p1_y = current_assignments[layout.index_of(p1.id_y())?];
                let actual_distance = euclidian_distance((p0_x, p0_y), (p1_x, p1_y));
                Ok(vec![actual_distance - expected_distance])
            }
            Constraint::DistancePointToLine(_p0, _line) => todo!(),
            Constraint::Angle(_line, _angle) => todo!(),
            Constraint::Coincident(p0, p1) => {
                let p0_x = current_assignments[layout.index_of(p0.id_x())?];
                let p0_y = current_assignments[layout.index_of(p0.id_y())?];
                let p1_x = current_assignments[layout.index_of(p1.id_x())?];
                let p1_y = current_assignments[layout.index_of(p1.id_y())?];
                Ok(vec![p0_x - p1_x, p0_y - p1_y])
            }
            Constraint::Vertical(p0, p1) => {
                let p0_x = current_assignments[layout.index_of(p0.id_x())?];
                let p1_x = current_assignments[layout.index_of(p1.id_x())?];
                Ok(vec![p0_x - p1_x])
            }
            Constraint::Horizontal(p0, p1) => {
                let p0_y = current_assignments[layout.index_of(p0.id_y())?];
                let p1_y = current_assignments[layout.index_of(p1.id_y())?];
                Ok(vec![p0_y - p1_y])
            }
            Constraint::Symmetric(_line, _p0, _p1) => todo!(),
            Constraint::Null => Ok(vec![0.0]),
            Constraint::Fixed(id, expected) => {
                let actual = current_assignments[layout.index_of(*id)?];
                Ok(vec![actual - expected])
            }
            Constraint::PointFixed(p, expected_x, expected_y) => {
                let actual_x = current_assignments[layout.index_of(p.id_x())?];
                let actual_y = current_assignments[layout.index_of(p.id_y())?];
                Ok(vec![actual_x - expected_x, actual_y - expected_y])
            }
        }
    }

    /// How many equations does this constraint correspond to?
    /// Each equation is a residual function (a measure of error)
    pub fn residual_dim(&self) -> usize {
        match self {
            Constraint::Coincident(_p0, _p1) => 2,
            Constraint::Null => 1,
            Constraint::Distance(..) => 1,
            Constraint::DistancePointToLine(..) => 1,
            Constraint::Angle(..) => 1,
            Constraint::Vertical(..) => 1,
            Constraint::Horizontal(..) => 1,
            Constraint::Symmetric(..) => 1,
            Constraint::Fixed(..) => 1,
            Constraint::PointFixed(..) => 2,
        }
    }

    /// Used to construct part of a Jacobian matrix.
    /// Returns rows of the Jacobian, where in each row,
    /// each column is a variable's partial derivative for this equation.
    /// One row per equation this constraint corresponds to.
    pub fn jacobian_section(&self, layout: &Layout, current_assignments: &[f64]) -> Result<Vec<JacobianRow>> {
        match self {
            Constraint::Distance(p0, p1, _expected_distance) => {
                // Residual: R = sqrt((x1-x2)**2 + (y1-y2)**2) - d
                // ∂R/∂x0 = (x0 - x1) / sqrt((x0 - x1)**2 + (y0 - y1)**2)
                // ∂R/∂y0 = (y0 - y1) / sqrt((x0 - x1)**2 + (y0 - y1)**2)
                // ∂R/∂x1 = (-x0 + x1)/ sqrt((x0 - x1)**2 + (y0 - y1)**2)
                // ∂R/∂y1 = (-y0 + y1)/ sqrt((x0 - x1)**2 + (y0 - y1)**2)

                // Derivatives wrt p0 and p2's X/Y coordinates.
                let x0 = current_assignments[layout.index_of(p0.id_x())?];
                let y0 = current_assignments[layout.index_of(p0.id_y())?];
                let x1 = current_assignments[layout.index_of(p1.id_x())?];
                let y1 = current_assignments[layout.index_of(p1.id_y())?];

                // TODO: Handle zero-length vecs gracefully.

                let dist = euclidian_distance((x0, y0), (x1, y1));
                let dr_dx0 = (x0 - x1) / dist;
                let dr_dy0 = (y0 - y1) / dist;
                let dr_dx1 = (-x0 + x1) / dist;
                let dr_dy1 = (-y0 + y1) / dist;

                Ok(vec![JacobianRow {
                    nonzero_columns: vec![
                        JacobianVar {
                            id: p0.id_x(),
                            partial_derivative: dr_dx0,
                        },
                        JacobianVar {
                            id: p0.id_y(),
                            partial_derivative: dr_dy0,
                        },
                        JacobianVar {
                            id: p1.id_x(),
                            partial_derivative: dr_dx1,
                        },
                        JacobianVar {
                            id: p1.id_y(),
                            partial_derivative: dr_dy1,
                        },
                    ],
                }])
            }
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

                Ok(vec![
                    // One row describing the x constraint
                    JacobianRow {
                        nonzero_columns: vec![JacobianVar {
                            id: p0.id_x(),
                            partial_derivative: dr0_dx,
                        }],
                    },
                    // One row describing the y constraint
                    JacobianRow {
                        nonzero_columns: vec![JacobianVar {
                            id: p0.id_y(),
                            partial_derivative: dr1_dy,
                        }],
                    },
                ])
            }
            Constraint::Vertical(p0, p1) => {
                // Residual: R = x0 - x1
                // ∂R/∂x for p0 and p1.
                let dr_dx0 = 1.0;
                let dr_dx1 = -1.0;

                // Get the 'x' variable ID for the line's points.
                let p0_x_id = p0.id_x();
                let p1_x_id = p1.id_x();

                Ok(vec![
                    // One row with values for both p0.x and p1.x
                    JacobianRow {
                        nonzero_columns: vec![
                            JacobianVar {
                                id: p0_x_id,
                                partial_derivative: dr_dx0,
                            },
                            JacobianVar {
                                id: p1_x_id,
                                partial_derivative: dr_dx1,
                            },
                        ],
                    },
                ])
            }
            Constraint::Horizontal(p0, p1) => {
                // Residual: R = y1 - y2
                // ∂R/∂y for p0 and p1.
                let dr_dy0 = 1.0;
                let dr_dy1 = -1.0;

                // Get the 'y' variable ID for the line's points.
                let p0_y_id = p0.id_y();
                let p1_y_id = p1.id_y();

                Ok(vec![
                    // One row with values for both p0.x and p1.x
                    JacobianRow {
                        nonzero_columns: vec![
                            JacobianVar {
                                id: p0_y_id,
                                partial_derivative: dr_dy0,
                            },
                            JacobianVar {
                                id: p1_y_id,
                                partial_derivative: dr_dy1,
                            },
                        ],
                    },
                ])
            }
            Constraint::Symmetric(_line, _p0, _p1) => todo!(),
            Constraint::Null => Ok(vec![JacobianRow::default()]),
            Constraint::Fixed(id, _expected) => Ok(vec![JacobianRow {
                nonzero_columns: vec![JacobianVar {
                    id: *id,
                    partial_derivative: 1.0,
                }],
            }]),
            Constraint::PointFixed(p, _expected_x, _expected_y) => {
                // Residuals: R1 = px - fx, R2 = py - fy
                // ∂R1/∂px = 1
                // ∂R1/∂py = 0
                // ∂R2/∂px = 0
                // ∂R2/∂py = 1

                // Derivatives with respect to the fixed point's coordinates.
                let dr0_dx = 1.0;
                // dr0_dy = 0.0
                // dr1_dx = 0.0
                let dr1_dy = 1.0;
                Ok(vec![
                    JacobianRow {
                        nonzero_columns: vec![JacobianVar {
                            id: p.id_x(),
                            partial_derivative: dr0_dx,
                        }],
                    },
                    JacobianRow {
                        nonzero_columns: vec![JacobianVar {
                            id: p.id_y(),
                            partial_derivative: dr1_dy,
                        }],
                    },
                ])
            }
        }
    }

    pub fn constraint_kind(&self) -> &'static str {
        match self {
            Constraint::Distance(..) => "Distance",
            Constraint::DistancePointToLine(..) => "DistancePointToLine",
            Constraint::Angle(..) => "Angle",
            Constraint::Coincident(..) => "Coincident",
            Constraint::Vertical(..) => "Vertical",
            Constraint::Horizontal(..) => "Horizontal",
            Constraint::Symmetric(..) => "Symmetric",
            Constraint::Null => "Null",
            Constraint::Fixed(..) => "Fixed",
            Constraint::PointFixed(..) => "PointFixed",
        }
    }
}

/// Euclidian distance between two points.
fn euclidian_distance(p0: (f64, f64), p1: (f64, f64)) -> f64 {
    let dx = p0.0 - p1.0;
    let dy = p0.1 - p1.1;
    (dx.powf(2.0) + dy.powf(2.0)).sqrt()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_euclidian_distance() {
        assert_eq!(euclidian_distance((-1.0, 0.0), (2.0, 4.0)), 5.0);
    }
}
