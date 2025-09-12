use faer::sparse::{Pair, SymbolicSparseColMat};
use newton_faer::{JacobianCache, NonlinearSystem, RowMap};

use crate::{Constraint, NonLinearSystemError, constraints::lookup, id::Id};

pub struct Layout {
    /// Equivalent to number of rows in the matrix being solved.
    total_num_residuals: usize,
    /// One variable per column of the matrix.
    all_variables: Vec<Id>,
}

impl RowMap for Layout {
    type Var = Id;

    /// Total number of rows in the matrix.
    fn dim(&self) -> usize {
        self.total_num_residuals
    }

    // `faer_newton` stores variables in a vec, refers to them only by their offset.
    // So this function lets you look up the index of a particular variable in that vec.
    // `bus` is the row index and `var` is the variable being looked up,
    // and you get the index (column) of the variable in that row.
    fn row(&self, _row_number: usize, var: Self::Var) -> Option<usize> {
        lookup(var, &self.all_variables).ok()
    }
}

impl Layout {
    pub fn index_of(&self, var: <Layout as RowMap>::Var) -> Result<usize, NonLinearSystemError> {
        lookup(var, &self.all_variables)
    }

    pub fn num_cols(&self) -> usize {
        self.all_variables.len()
    }

    pub fn num_rows(&self) -> usize {
        self.dim()
    }
}

/// A Jacobian cache.
/// Stores the Jacobian so we don't constantly reallocate it.
/// Required by newton_faer.
struct Jc {
    sym: SymbolicSparseColMat<usize>,
    vals: Vec<f64>,
}

impl JacobianCache<f64> for Jc {
    /// Self owns the symbolic pattern, so it can
    /// give out a reference to it.
    fn symbolic(&self) -> &SymbolicSparseColMat<usize> {
        &self.sym
    }

    fn values(&self) -> &[f64] {
        &self.vals
    }

    /// Exposes a mutable values slice each iteration
    fn values_mut(&mut self) -> &mut [f64] {
        &mut self.vals
    }
}

impl std::fmt::Debug for Jc {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let ncols = self.sym.ncols();
        let nrows = self.sym.nrows();
        for y in 0..nrows {
            for x in 0..ncols {
                write!(f, "{:3} ", self.vals[ncols * y + x])?;
            }
            writeln!(f)?;
        }
        Ok(())
    }
}

/// Generate 2D indices that iterate over every cell in a matrix of the given size.
fn gen_pairs(num_cols: usize, num_rows: usize) -> Vec<Pair<usize, usize>> {
    let mut out = Vec::with_capacity(num_cols * num_rows);
    for col in 0..num_cols {
        for row in 0..num_rows {
            out.push(Pair { row, col })
        }
    }
    out
}

/// The problem to actually solve.
pub struct Model {
    layout: Layout,
    jc: Jc,
    constraints: Vec<Constraint>,
}

impl Model {
    pub fn new(constraints: Vec<Constraint>, all_variables: Vec<Id>) -> Self {
        /*
        Firstly, find the size of the relevant matrices.
        Each constraint yields 1 or more residual function f.
        Each residual function f is summed to form the overall residual F.
        Each residual function yields a derivative f'.
        The overall Jacobian is a matrix where
            each row is one of the residual functions.
            each column in a row represents the partial derivative of a given variable in that equation
        Thus the Jacobian has
            num_rows = number of residual functions,
                       which is >= number of constraints (as each constraint yields 1 or more residual functions)
            num_cols = total number of variables
                       which is = total number of "involved primitive IDs"
        */
        let num_residuals: usize = constraints.iter().map(|c| c.residual_dim()).sum();
        let num_cols = all_variables.len();
        let num_rows = num_residuals;

        // Generate the matrix.
        let pairs = gen_pairs(num_cols, num_rows);
        let (sym, _) = SymbolicSparseColMat::try_new_from_indices(num_rows, num_cols, &pairs).unwrap();
        let num_cells = sym.col_ptr()[sym.ncols()];
        debug_assert_eq!(num_cells, num_cols * num_rows);

        // All done.
        Self {
            layout: Layout {
                total_num_residuals: num_rows,
                all_variables,
            },
            jc: Jc {
                sym,
                vals: vec![0.0; num_cells],
            },
            constraints,
        }
    }
}

/// Connect the model to newton_faer's solver.
impl NonlinearSystem for Model {
    /// What number type we're using.
    type Real = f64;
    type Layout = Layout;
    type Error = crate::NonLinearSystemError;

    fn layout(&self) -> &Self::Layout {
        &self.layout
    }

    /// Let the solver read the Jacobian cache.
    fn jacobian(&self) -> &dyn JacobianCache<Self::Real> {
        &self.jc
    }

    /// Let the solver write into the Jacobian cache.
    fn jacobian_mut(&mut self) -> &mut dyn JacobianCache<Self::Real> {
        &mut self.jc
    }

    /// Compute the residual F, figuring out how close the problem is to being solved.
    fn residual(&self, current_assignments: &[Self::Real], out: &mut [Self::Real]) -> Result<(), Self::Error> {
        // Each row of `out` corresponds to one row of the matrix, i.e. one equation.
        // Each item of `current_assignments` corresponds to one column of the matrix, i.e. one variable.
        let mut row_num = 0;
        for constraint in &self.constraints {
            let residuals = constraint.residual(&self.layout, current_assignments)?;
            debug_assert_eq!(
                residuals.len(),
                constraint.residual_dim(),
                "Constraint {} should have {} residuals but actually had {}",
                constraint.constraint_kind(),
                constraint.residual_dim(),
                residuals.len(),
            );
            for residual in residuals {
                out[row_num] = residual;
                row_num += 1;
            }
        }
        Ok(())
    }

    /// Update the values of a cached sparse Jacobian.
    fn refresh_jacobian(&mut self, current_assignments: &[Self::Real]) -> Result<(), Self::Error> {
        let num_cols = self.layout.num_cols();
        let num_rows = self.layout.num_rows();
        let mut row_num = 0;
        for constraint in &self.constraints {
            let jacobian_rows = constraint.jacobian_rows(&self.layout, current_assignments)?;
            debug_assert_eq!(
                jacobian_rows.len(),
                constraint.residual_dim(),
                "Constraint {} should have {} Jacobian rows but actually had {}",
                constraint.constraint_kind(),
                constraint.residual_dim(),
                jacobian_rows.len(),
            );

            for jacobian_row in jacobian_rows {
                // newton_faer requires the matrix in column-major order,
                // so we write this row into a column of the matrix.
                // Transpose basically.
                let target_column_num = row_num;
                row_num += 1;

                // Write zeros in every cell for this row of the Jacobian matrix
                // (which, again, is internally represented by a column in `jc`).
                for i in 0..num_cols {
                    let dst = target_column_num + (i * num_rows);
                    self.jc.values_mut()[dst] = 0.0;
                }
                // Overwrite any nonzero cells.
                // It's probably faster than avoiding the writes of zeroes in the first place.
                for jacobian_var in jacobian_row {
                    let i = self.layout.index_of(jacobian_var.id)?;
                    let dst = target_column_num + (i * num_rows);
                    self.jc.values_mut()[dst] = jacobian_var.partial_derivative;
                }
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_gen_pairs() {
        let actual = gen_pairs(3, 2);
        let expected = vec![
            Pair { row: 0, col: 0 },
            Pair { row: 1, col: 0 },
            Pair { row: 0, col: 1 },
            Pair { row: 1, col: 1 },
            Pair { row: 0, col: 2 },
            Pair { row: 1, col: 2 },
        ];
        assert_eq!(expected, actual)
    }
}
