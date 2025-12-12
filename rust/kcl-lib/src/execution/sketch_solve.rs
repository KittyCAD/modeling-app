use ahash::AHashSet;

/// Freedom analysis results from solving a sketch constraint system. The `Vec`
/// is converted to a set to avoid quadratic runtime.
pub(super) struct FreedomAnalysis {
    pub underconstrained: AHashSet<u32>,
}

impl From<kcl_ezpz::FreedomAnalysis> for FreedomAnalysis {
    fn from(value: kcl_ezpz::FreedomAnalysis) -> Self {
        FreedomAnalysis {
            underconstrained: AHashSet::from_iter(value.underconstrained),
        }
    }
}
