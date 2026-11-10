//! Embedded CSG programs for regression tests.

#[derive(Debug, Clone, Copy)]
pub(crate) enum CsgFixture {
    SubtractReusedOutputs,
    SplitKeepToolsTrue,
    SplitKeepToolsFalse,
    SplitKeepToolsDefault,
    SplitCompositeToolKeepToolsTrue,
    SplitCompositeToolKeepToolsFalse,
    SplitKeepToolsTrueMerge,
    UnionSweptInputs,
    UnionCompositeInput,
    UnionAddOperator,
    UnionOrOperator,
    IntersectSweptInputs,
    IntersectCompositeInput,
    IntersectAndOperator,
}

impl CsgFixture {
    /// Returns the complete in-memory KCL program for this fixture.
    pub(crate) fn source(self) -> &'static str {
        match self {
            Self::SubtractReusedOutputs => include_str!("../tests/artifact_graph_csg/subtract_reused_outputs.kcl"),
            Self::SplitKeepToolsTrue => include_str!("../tests/artifact_graph_csg/split_keep_tools_true.kcl"),
            Self::SplitKeepToolsFalse => include_str!("../tests/artifact_graph_csg/split_keep_tools_false.kcl"),
            Self::SplitKeepToolsDefault => include_str!("../tests/artifact_graph_csg/split_keep_tools_default.kcl"),
            Self::SplitCompositeToolKeepToolsTrue => {
                include_str!("../tests/artifact_graph_csg/split_composite_tool_keep_tools_true.kcl")
            }
            Self::SplitCompositeToolKeepToolsFalse => {
                include_str!("../tests/artifact_graph_csg/split_composite_tool_keep_tools_false.kcl")
            }
            Self::SplitKeepToolsTrueMerge => {
                include_str!("../tests/artifact_graph_csg/split_keep_tools_true_merge.kcl")
            }
            Self::UnionSweptInputs => include_str!("../tests/artifact_graph_csg/union_swept_inputs.kcl"),
            Self::UnionCompositeInput => include_str!("../tests/artifact_graph_csg/union_composite_input.kcl"),
            Self::UnionAddOperator => include_str!("../tests/artifact_graph_csg/union_add_operator.kcl"),
            Self::UnionOrOperator => include_str!("../tests/artifact_graph_csg/union_or_operator.kcl"),
            Self::IntersectSweptInputs => include_str!("../tests/artifact_graph_csg/intersect_swept_inputs.kcl"),
            Self::IntersectCompositeInput => include_str!("../tests/artifact_graph_csg/intersect_composite_input.kcl"),
            Self::IntersectAndOperator => include_str!("../tests/artifact_graph_csg/intersect_and_operator.kcl"),
        }
    }
}
