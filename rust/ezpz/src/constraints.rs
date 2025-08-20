use crate::{NonLinearSystemError, datatypes::*, id::Id, solver::Layout};

/// Each geometric constraint we support.
#[derive(Clone, Copy)]
pub enum Constraint {
    /// Also length.
    Distance(DatumPoint, DatumPoint, Distance),
    /// These two points have the same Y value.
    Vertical(LineSegment),
    /// These two points have the same X value.
    Horizontal(LineSegment),
    /// Some scalar value is fixed.
    Fixed(Id, f64),
}

/// Given a list of all IDs in the system, find the target ID's index in that list.
pub fn lookup(target_id: Id, all_ids: &[Id]) -> Result<usize, NonLinearSystemError> {
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
    Err(NonLinearSystemError::NotFound(target_id))
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
    pub fn residual(&self, layout: &Layout, current_assignments: &[f64]) -> Result<Vec<f64>, NonLinearSystemError> {
        match self {
            Constraint::Distance(p0, p1, expected_distance) => {
                let p0_x = current_assignments[layout.index_of(p0.id_x())?];
                let p0_y = current_assignments[layout.index_of(p0.id_y())?];
                let p1_x = current_assignments[layout.index_of(p1.id_x())?];
                let p1_y = current_assignments[layout.index_of(p1.id_y())?];
                let actual_distance = euclidian_distance((p0_x, p0_y), (p1_x, p1_y));
                Ok(vec![actual_distance - expected_distance])
            }
            Constraint::Vertical(line) => {
                let p0_x = current_assignments[layout.index_of(line.p0.id_x())?];
                let p1_x = current_assignments[layout.index_of(line.p1.id_x())?];
                Ok(vec![p0_x - p1_x])
            }
            Constraint::Horizontal(line) => {
                let p0_y = current_assignments[layout.index_of(line.p0.id_y())?];
                let p1_y = current_assignments[layout.index_of(line.p1.id_y())?];
                Ok(vec![p0_y - p1_y])
            }
            Constraint::Fixed(id, expected) => {
                let actual = current_assignments[layout.index_of(*id)?];
                Ok(vec![actual - expected])
            }
        }
    }

    /// How many equations does this constraint correspond to?
    /// Each equation is a residual function (a measure of error)
    pub fn residual_dim(&self) -> usize {
        match self {
            Constraint::Distance(..) => 1,
            Constraint::Vertical(..) => 1,
            Constraint::Horizontal(..) => 1,
            Constraint::Fixed(..) => 1,
        }
    }

    /// Used to construct part of a Jacobian matrix.
    /// Returns rows of the Jacobian, where in each row,
    /// each column is a variable's partial derivative for this equation.
    /// One row per equation this constraint corresponds to.
    pub fn jacobian_rows(
        &self,
        layout: &Layout,
        current_assignments: &[f64],
    ) -> Result<Vec<JacobianRow>, NonLinearSystemError> {
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
            Constraint::Vertical(line) => {
                // Residual: R = x0 - x1
                // ∂R/∂x for p0 and p1.
                let dr_dx0 = 1.0;
                let dr_dx1 = -1.0;

                // Get the 'x' variable ID for the line's points.
                let p0_x_id = line.p0.id_x();
                let p1_x_id = line.p1.id_x();

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
            Constraint::Horizontal(line) => {
                // Residual: R = y1 - y2
                // ∂R/∂y for p0 and p1.
                let dr_dy0 = 1.0;
                let dr_dy1 = -1.0;

                // Get the 'y' variable ID for the line's points.
                let p0_y_id = line.p0.id_y();
                let p1_y_id = line.p1.id_y();

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
            Constraint::Fixed(id, _expected) => Ok(vec![JacobianRow {
                nonzero_columns: vec![JacobianVar {
                    id: *id,
                    partial_derivative: 1.0,
                }],
            }]),
        }
    }

    pub fn constraint_kind(&self) -> &'static str {
        match self {
            Constraint::Distance(..) => "Distance",
            Constraint::Vertical(..) => "Vertical",
            Constraint::Horizontal(..) => "Horizontal",
            Constraint::Fixed(..) => "Fixed",
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
