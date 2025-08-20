use kittycad_modeling_cmds::shared::Angle;

use crate::{NonLinearSystemError, datatypes::*, id::Id, solver::Layout};

const EPSILON: f64 = 0.00000001;

/// Each geometric constraint we support.
#[derive(Clone, Copy)]
pub enum Constraint {
    /// These two points should be a given distance apart.
    Distance(DatumPoint, DatumPoint, Distance),
    /// These two points have the same Y value.
    Vertical(LineSegment),
    /// These two points have the same X value.
    Horizontal(LineSegment),
    /// These lines meet at this angle.
    LinesAtAngle(LineSegment, LineSegment, Angle),
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
    /// Constrain these lines to be parallel.
    /// This is a constructor for the special case of the more general LinesAtAngle constraint.
    pub fn lines_parallel([l0, l1]: [LineSegment; 2]) -> Self {
        Self::LinesAtAngle(l0, l1, Angle::from_degrees(0.0))
    }

    /// Constrain these lines to be perpendicular.
    /// This is a constructor for the special case of the more general LinesAtAngle constraint.
    pub fn lines_perpendicular([l0, l1]: [LineSegment; 2]) -> Self {
        Self::LinesAtAngle(l0, l1, Angle::from_degrees(90.0))
    }

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
            Constraint::LinesAtAngle(line0, line1, expected_angle) => {
                // Get direction vectors for both lines.
                let p0_x_l0 = current_assignments[layout.index_of(line0.p0.id_x())?];
                let p0_y_l0 = current_assignments[layout.index_of(line0.p0.id_y())?];
                let p1_x_l0 = current_assignments[layout.index_of(line0.p1.id_x())?];
                let p1_y_l0 = current_assignments[layout.index_of(line0.p1.id_y())?];
                let l0 = ((p0_x_l0, p0_y_l0), (p1_x_l0, p1_y_l0));
                let p0_x_l1 = current_assignments[layout.index_of(line1.p0.id_x())?];
                let p0_y_l1 = current_assignments[layout.index_of(line1.p0.id_y())?];
                let p1_x_l1 = current_assignments[layout.index_of(line1.p1.id_x())?];
                let p1_y_l1 = current_assignments[layout.index_of(line1.p1.id_y())?];
                let l1 = ((p0_x_l1, p0_y_l1), (p1_x_l1, p1_y_l1));

                let v0 = (p0_x_l0 - p1_x_l0, p0_y_l0 - p1_y_l0);
                let v1 = (p0_x_l1 - p1_x_l1, p0_y_l1 - p1_y_l1);

                // Calculate magnitudes.
                let mag0 = euclidian_distance_line(l0);
                let mag1 = euclidian_distance_line(l1);

                // Check for zero-length lines.
                let is_invalid = (mag0 < EPSILON) || (mag1 < EPSILON);
                if is_invalid {
                    return Ok(vec![0.0]);
                }

                // 2D cross product and dot product.
                let cross_2d = cross(v0, v1);
                let dot_product = dot(v0, v1);

                // Current angle using atan2.
                let current_angle_radians = libm::atan2(cross_2d, dot_product);

                // Compute angle difference.
                let angle_residual = current_angle_radians - expected_angle.to_radians();

                Ok(vec![angle_residual])
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
            Constraint::LinesAtAngle(..) => 1,
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
            Constraint::LinesAtAngle(line0, line1, _expected_angle) => {
                // Residual: R = atan2(v1×v2, v1·v2) - α
                // ∂R/∂x1 = (y1 - y2)/(x1**2 - 2*x1*x2 + x2**2 + y1**2 - 2*y1*y2 + y2**2)
                // ∂R/∂y1 = (-x1 + x2)/(x1**2 - 2*x1*x2 + x2**2 + y1**2 - 2*y1*y2 + y2**2)
                // ∂R/∂x2 = (-y1 + y2)/(x1**2 - 2*x1*x2 + x2**2 + y1**2 - 2*y1*y2 + y2**2)
                // ∂R/∂y2 = (x1 - x2)/(x1**2 - 2*x1*x2 + x2**2 + y1**2 - 2*y1*y2 + y2**2)
                // ∂R/∂x3 = (-y3 + y4)/(x3**2 - 2*x3*x4 + x4**2 + y3**2 - 2*y3*y4 + y4**2)
                // ∂R/∂y3 = (x3 - x4)/(x3**2 - 2*x3*x4 + x4**2 + y3**2 - 2*y3*y4 + y4**2)
                // ∂R/∂x4 = (y3 - y4)/(x3**2 - 2*x3*x4 + x4**2 + y3**2 - 2*y3*y4 + y4**2)
                // ∂R/∂y4 = (-x3 + x4)/(x3**2 - 2*x3*x4 + x4**2 + y3**2 - 2*y3*y4 + y4**2)

                let x0 = current_assignments[layout.index_of(line0.p0.id_x())?];
                let y0 = current_assignments[layout.index_of(line0.p0.id_y())?];
                let x1 = current_assignments[layout.index_of(line0.p1.id_x())?];
                let y1 = current_assignments[layout.index_of(line0.p1.id_y())?];
                let l0 = ((x0, y0), (x1, y1));
                let x2 = current_assignments[layout.index_of(line1.p0.id_x())?];
                let y2 = current_assignments[layout.index_of(line1.p0.id_y())?];
                let x3 = current_assignments[layout.index_of(line1.p1.id_x())?];
                let y3 = current_assignments[layout.index_of(line1.p1.id_y())?];
                let l1 = ((x2, y2), (x3, y3));

                // Calculate magnitudes.
                let mag0 = euclidian_distance_line(l0);
                let mag1 = euclidian_distance_line(l1);

                // Check for zero-length lines.
                let is_invalid = (mag0 < EPSILON) || (mag1 < EPSILON);
                if is_invalid {
                    // All zeroes
                    return Ok(Default::default());
                }

                // Calculate derivatives.

                // Note that our denominator terms for the partial derivatives above are
                // the squared magnitudes of the vectors, i.e.:
                // x1**2 - 2*x1*x2 + x2**2 + y1**2 - 2*y1*y2 + y2**2 == (x1 - x2)²  + (y1 - y2)²
                // x3**2 - 2*x3*x4 + x4**2 + y3**2 - 2*y3*y4 + y4**2 == (x3 - x4)²  + (y3 - y4)²
                let mag1_squared = mag0.powi(2);
                let mag2_squared = mag1.powi(2);

                let dr_dx0 = (y0 - y1) / mag1_squared;
                let dr_dy0 = (-x0 + x1) / mag1_squared;
                let dr_dx1 = (-y0 + y1) / mag1_squared;
                let dr_dy1 = (x0 - x1) / mag1_squared;
                let dr_dx2 = (-y2 + y3) / mag2_squared;
                let dr_dy2 = (x2 - x3) / mag2_squared;
                let dr_dx3 = (y2 - y3) / mag2_squared;
                let dr_dy3 = (-x2 + x3) / mag2_squared;

                Ok(vec![JacobianRow {
                    nonzero_columns: vec![
                        JacobianVar {
                            id: line0.p0.id_x(),
                            partial_derivative: dr_dx0,
                        },
                        JacobianVar {
                            id: line0.p0.id_y(),
                            partial_derivative: dr_dy0,
                        },
                        JacobianVar {
                            id: line0.p1.id_x(),
                            partial_derivative: dr_dx1,
                        },
                        JacobianVar {
                            id: line0.p1.id_y(),
                            partial_derivative: dr_dy1,
                        },
                        JacobianVar {
                            id: line1.p0.id_x(),
                            partial_derivative: dr_dx2,
                        },
                        JacobianVar {
                            id: line1.p0.id_y(),
                            partial_derivative: dr_dy2,
                        },
                        JacobianVar {
                            id: line1.p1.id_x(),
                            partial_derivative: dr_dx3,
                        },
                        JacobianVar {
                            id: line1.p1.id_y(),
                            partial_derivative: dr_dy3,
                        },
                    ],
                }])
            }
        }
    }

    /// Human-readable constraint name, useful for debugging.
    pub fn constraint_kind(&self) -> &'static str {
        match self {
            Constraint::Distance(..) => "Distance",
            Constraint::Vertical(..) => "Vertical",
            Constraint::Horizontal(..) => "Horizontal",
            Constraint::Fixed(..) => "Fixed",
            Constraint::LinesAtAngle(..) => "LinesAtAngle",
        }
    }
}

/// Euclidian distance between two points.
fn euclidian_distance(p0: (f64, f64), p1: (f64, f64)) -> f64 {
    let dx = p0.0 - p1.0;
    let dy = p0.1 - p1.1;
    (dx.powf(2.0) + dy.powf(2.0)).sqrt()
}

/// Euclidian distance of a line.
fn euclidian_distance_line(line: ((f64, f64), (f64, f64))) -> f64 {
    euclidian_distance(line.0, line.1)
}

fn cross(p0: (f64, f64), p1: (f64, f64)) -> f64 {
    p0.0 * p1.1 - p0.1 * p1.0
}

fn dot(p0: (f64, f64), p1: (f64, f64)) -> f64 {
    p0.0 * p1.0 + p0.1 * p1.1
}

#[allow(dead_code)]
fn dot_line((p0, p1): ((f64, f64), (f64, f64))) -> f64 {
    dot(p0, p1)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_geometry() {
        assert_eq!(euclidian_distance((-1.0, 0.0), (2.0, 4.0)), 5.0);
        assert_eq!(dot_line(((1.0, 2.0), (4.0, -5.0))), 4.0 - 10.0);
        assert_eq!(cross((1.0, 0.0), (0.0, 1.0)), 1.0);
        assert_eq!(cross((0.0, 1.0), (1.0, 0.0)), -1.0);
        assert_eq!(cross((2.0, 2.0), (4.0, 4.0)), 0.0);
        assert_eq!(cross((3.0, 4.0), (5.0, 6.0)), -2.0);
    }
}
