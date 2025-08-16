use faer::sparse::{Pair, SymbolicSparseColMat};
use indexmap::IndexSet;
use newton_faer::{JacobianCache, NonlinearSystem, RowMap};

use crate::Constraint;
use crate::id::Id;

/// TODO. I don't really know what this is used for yet.
/// newton_faer crate uses it, but it might just be for
/// bookkeeping when mapping variables to the index they occupy,
/// which I'm currently doing in my own way.
pub struct Layout {
    dimensions: usize,
}

impl RowMap for Layout {
    type Var = Id;

    fn dim(&self) -> usize {
        self.dimensions
    }

    // bus = index?
    // I think `bus` is the row number and `var` is the variable being looked up,
    // and you give the index (column) of the variable in that row?
    fn row(&self, _bus: usize, _var: Self::Var) -> Option<usize> {
        None
    }
}

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

fn gen_pairs(num_cols: usize, num_rows: usize) -> Vec<Pair<usize, usize>> {
    let mut out = Vec::with_capacity(num_cols * num_rows);
    for col in 0..num_cols {
        for row in 0..num_rows {
            out.push(Pair { row, col })
        }
    }
    out
}

pub struct Model {
    layout: Layout,
    all_ids: Vec<Id>,
    jc: Jc,
    constraints: Vec<Constraint>,
}

impl Model {
    pub fn new(constraints: Vec<Constraint>) -> Self {
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
        let num_constraints = constraints.len();
        let mut all_variables: IndexSet<Id> = IndexSet::with_capacity(num_constraints);
        let num_residuals: usize = constraints.iter().map(|c| c.residual_dim()).sum();
        for constraint in &constraints {
            all_variables.extend(constraint.involved_ids());
        }
        let num_cols = all_variables.len();
        let num_rows = num_residuals;

        // Generate the matrix.
        let pairs = gen_pairs(num_cols, num_rows);
        let (sym, _) = SymbolicSparseColMat::try_new_from_indices(num_rows, num_cols, &pairs).unwrap();
        let num_cells = sym.col_ptr()[sym.ncols()];
        assert_eq!(num_cells, num_cols * num_rows);

        // All done.
        Self {
            // TODO: not sure if this is really num_rows or num_cols.
            layout: Layout { dimensions: num_cols },
            jc: Jc {
                sym,
                vals: vec![0.0; num_cells],
            },
            constraints,
            all_ids: all_variables.into_iter().collect(),
        }
    }
}

impl NonlinearSystem for Model {
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
        for (row_num, residual) in self
            .constraints
            .iter()
            .flat_map(|constraint| {
                let residual = constraint.residual(&self.all_ids, current_assignments).unwrap();
                debug_assert_eq!(residual.len(), constraint.residual_dim());
                residual
            })
            .enumerate()
        {
            out[row_num] = residual;
        }
    }

    /// Update the values of a cached sparse Jacobian.
    fn refresh_jacobian(&mut self, current_assignments: &[Self::Real]) {
        for (row_num, jacobian_row) in self
            .constraints
            .iter()
            .flat_map(|constraint| {
                let row = constraint.jacobian_section(&self.all_ids, current_assignments).unwrap();
                debug_assert_eq!(row.len(), constraint.residual_dim());
                row
            })
            .enumerate()
        {
            todo!("Use {row_num} and {jacobian_row:?}")
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
