use pyo3::pyclass;
use pyo3::pymethods;

/// Overall constraint status of a sketch.
#[allow(clippy::enum_variant_names)] // Variant names mirror kcl_lib::ConstraintKind for 1:1 Python API mapping.
#[pyclass(eq, eq_int)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ConstraintKind {
    FullyConstrained,
    UnderConstrained,
    OverConstrained,
}

impl From<kcl_lib::ConstraintKind> for ConstraintKind {
    fn from(kind: kcl_lib::ConstraintKind) -> Self {
        match kind {
            kcl_lib::ConstraintKind::FullyConstrained => Self::FullyConstrained,
            kcl_lib::ConstraintKind::UnderConstrained => Self::UnderConstrained,
            kcl_lib::ConstraintKind::OverConstrained => Self::OverConstrained,
        }
    }
}

/// Per-sketch summary of constraint freedom analysis.
#[pyclass]
#[derive(Debug, Clone)]
pub struct SketchConstraintStatus {
    #[pyo3(get)]
    pub name: String,
    #[pyo3(get)]
    pub status: ConstraintKind,
    #[pyo3(get)]
    pub free_count: usize,
    #[pyo3(get)]
    pub conflict_count: usize,
    #[pyo3(get)]
    pub total_count: usize,
}

impl From<kcl_lib::SketchConstraintStatus> for SketchConstraintStatus {
    fn from(s: kcl_lib::SketchConstraintStatus) -> Self {
        Self {
            name: s.name,
            status: s.status.into(),
            free_count: s.free_count,
            conflict_count: s.conflict_count,
            total_count: s.total_count,
        }
    }
}

/// Grouped report of all sketches by constraint status.
#[pyclass]
#[derive(Debug, Clone)]
pub struct SketchConstraintReport {
    #[pyo3(get)]
    pub fully_constrained: Vec<SketchConstraintStatus>,
    #[pyo3(get)]
    pub under_constrained: Vec<SketchConstraintStatus>,
    #[pyo3(get)]
    pub over_constrained: Vec<SketchConstraintStatus>,
}

#[pymethods]
impl SketchConstraintReport {
    /// Total number of sketches across all categories.
    fn total_sketches(&self) -> usize {
        self.fully_constrained.len() + self.under_constrained.len() + self.over_constrained.len()
    }
}

impl From<kcl_lib::SketchConstraintReport> for SketchConstraintReport {
    fn from(r: kcl_lib::SketchConstraintReport) -> Self {
        Self {
            fully_constrained: r.fully_constrained.into_iter().map(Into::into).collect(),
            under_constrained: r.under_constrained.into_iter().map(Into::into).collect(),
            over_constrained: r.over_constrained.into_iter().map(Into::into).collect(),
        }
    }
}
