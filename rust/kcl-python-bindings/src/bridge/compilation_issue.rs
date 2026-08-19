use pyo3::pyclass;
use pyo3::pymethods;

/// Wrapper for [kcl_lib::kcl_error::CompilationIssue].
#[pyo3_stub_gen::derive::gen_stub_pyclass]
#[pyclass(from_py_object)]
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CompilationIssue {
    pub inner: kcl_lib::CompilationIssue,
}

impl From<kcl_lib::kcl_error::CompilationIssue> for CompilationIssue {
    fn from(value: kcl_lib::kcl_error::CompilationIssue) -> Self {
        Self { inner: value }
    }
}

#[pyo3_stub_gen::derive::gen_stub_pymethods]
#[pymethods]
impl CompilationIssue {
    pub fn is_warning(&self) -> bool {
        self.inner.severity.is_warning()
    }

    pub fn is_err(&self) -> bool {
        self.inner.severity.is_err()
    }

    pub fn is_fatal(&self) -> bool {
        self.inner.severity.is_fatal()
    }

    pub fn message(&self) -> &str {
        &self.inner.message
    }
}
