use faer::sparse::{Pair, SymbolicSparseColMat};
use newton_faer::{JacobianCache, NewtonCfg, NonlinearSystem, RowMap, solve};

use crate::System;

struct Model {
    system: System,
    jac: Jc,
}

impl RowMap for System {
    type Var = ();

    fn dim(&self) -> usize {
        self.equations.len()
    }

    // bus = i
    // var = v
    fn row(&self, bus: usize, var: Self::Var) -> Option<usize> {
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

impl Model {
    fn new(system: System) -> Self {
        let pairs = [
            Pair { row: 0, col: 0 },
            Pair { row: 1, col: 0 },
            Pair { row: 0, col: 1 },
            Pair { row: 1, col: 1 },
        ];
        let (sym, _) = SymbolicSparseColMat::try_new_from_indices(2, 2, &pairs).unwrap();
        let nnz = sym.col_ptr()[sym.ncols()];
        Self {
            system,
            jac: Jc {
                sym,
                vals: vec![0.0; nnz],
            },
        }
    }
}

impl NonlinearSystem for Model {
    type Real = f64;
    type Layout = System;

    fn layout(&self) -> &Self::Layout {
        &self.system
    }

    fn jacobian(&self) -> &dyn JacobianCache<Self::Real> {
        &self.jac
    }

    fn jacobian_mut(&mut self) -> &mut dyn JacobianCache<Self::Real> {
        &mut self.jac
    }

    fn residual(&self, x: &[Self::Real], out: &mut [Self::Real]) {
        todo!()
    }

    fn refresh_jacobian(&mut self, x: &[Self::Real]) {
        todo!()
    }
}
