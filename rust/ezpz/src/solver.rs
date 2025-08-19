use faer::sparse::{Pair, SymbolicSparseColMat};
use newton_faer::{JacobianCache, NonlinearSystem, RowMap};

use crate::{Constraint, constraints::lookup, id::Id};

pub struct Layout {
    /// Equivalent to number of rows in the matrix being solved.
    total_num_residuals: usize,
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
    fn row(&self, _bus: usize, var: Self::Var) -> Option<usize> {
        lookup(var, &self.all_variables).ok()
    }
}

impl Layout {
    pub fn index_of(&self, var: <Layout as RowMap>::Var) -> crate::Result<usize> {
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
        // f.debug_struct("Jc")
        //     // .field("sym", &self.sym)
        //     .field("vals", &self.vals)
        //     .field("rows", &nrows)
        //     .field("cols", &ncols)
        //     .finish()
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
        // eprintln!("{} constraints", constraints.len());
        // for (i, c) in constraints.iter().enumerate() {
        //     eprintln!(
        //         "\t{i}: {} ({} residual{})",
        //         c.constraint_kind(),
        //         c.residual_dim(),
        //         if c.residual_dim() > 1 { "s" } else { "" }
        //     );
        // }
        let num_residuals: usize = constraints.iter().map(|c| c.residual_dim()).sum();
        let num_cols = all_variables.len();
        let num_rows = num_residuals;
        // eprintln!("Matrix size is {num_rows} rows by {num_cols} cols");

        // Generate the matrix.
        let pairs = gen_pairs(num_cols, num_rows);
        let (sym, _) = SymbolicSparseColMat::try_new_from_indices(num_rows, num_cols, &pairs).unwrap();
        let num_cells = sym.col_ptr()[sym.ncols()];
        assert_eq!(num_cells, num_cols * num_rows);

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
    fn residual(&self, current_assignments: &[Self::Real], out: &mut [Self::Real]) {
        // Each row of `out` corresponds to one row of the matrix, i.e. one equation.
        // Each item of `current_assignments` corresponds to one column of the matrix, i.e. one variable.
        // eprintln!("Current variables:\n{current_assignments:?}");
        for (row_num, residual) in self
            .constraints
            .iter()
            // Each constraint could have multiple residuals, so flat map to combine them into
            // one flat list of residuals.
            .flat_map(|constraint| {
                let residual = constraint.residual(&self.layout, current_assignments).unwrap();
                debug_assert_eq!(
                    residual.len(),
                    constraint.residual_dim(),
                    "Constraint {} should have {} residuals but actually had {}",
                    constraint.constraint_kind(),
                    constraint.residual_dim(),
                    residual.len(),
                );
                residual
            })
            .enumerate()
        {
            out[row_num] = residual;
        }
        // eprintln!("R rows: {out:?}");
    }

    /// Update the values of a cached sparse Jacobian.
    fn refresh_jacobian(&mut self, current_assignments: &[Self::Real]) {
        // eprintln!("Refreshing jacobian.");
        let num_cols = self.layout.num_cols();
        let num_rows = self.layout.num_rows();
        for (row_num, jacobian_row) in self
            .constraints
            .iter()
            // Each constraint could have multiple rows, so flat map to combine them into one flat list
            // of rows.
            .flat_map(|constraint| {
                let rows = constraint
                    .jacobian_section(&self.layout, current_assignments)
                    // TODO: Update the solver crate to handle Result properly.
                    .unwrap();
                debug_assert_eq!(rows.len(), constraint.residual_dim());
                rows
            })
            .enumerate()
        {
            // JacobianRow shows only nonzero values, so,
            // add all the required zeroes.
            let mut row = vec![0.0; num_cols];
            for jacobian_var in jacobian_row {
                // TODO: Update the solver crate to handle Result properly.
                let i = self.layout.index_of(jacobian_var.id).unwrap();
                row[i] = jacobian_var.partial_derivative;
            }
            let target_column_num = row_num;
            for (i, v) in row.into_iter().enumerate() {
                let dst = target_column_num + (i * num_rows);
                self.jc.values_mut()[dst] = v;
            }
        }
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
