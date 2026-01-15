//! Tests for the artifact graph that convert it to Mermaid diagrams.
//! The implementation has been moved to artifact.rs, this module now only contains test helpers.

use super::*;

type NodeId = u32;

type Edges = IndexMap<(NodeId, NodeId), EdgeInfo>;

#[derive(Debug, Clone, PartialEq, Eq)]
struct EdgeInfo {
    direction: EdgeDirection,
    flow: EdgeFlow,
    kind: EdgeKind,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
enum EdgeDirection {
    Forward,
    Backward,
    Bidirectional,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
enum EdgeFlow {
    SourceToTarget,
    TargetToSource,
}

impl EdgeFlow {
    #[must_use]
    fn reverse(&self) -> EdgeFlow {
        match self {
            EdgeFlow::SourceToTarget => EdgeFlow::TargetToSource,
            EdgeFlow::TargetToSource => EdgeFlow::SourceToTarget,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
enum EdgeKind {
    PathToSweep,
    Other,
}

impl EdgeDirection {
    #[must_use]
    fn merge(&self, other: EdgeDirection) -> EdgeDirection {
        match self {
            EdgeDirection::Forward => match other {
                EdgeDirection::Forward => EdgeDirection::Forward,
                EdgeDirection::Backward => EdgeDirection::Bidirectional,
                EdgeDirection::Bidirectional => EdgeDirection::Bidirectional,
            },
            EdgeDirection::Backward => match other {
                EdgeDirection::Forward => EdgeDirection::Bidirectional,
                EdgeDirection::Backward => EdgeDirection::Backward,
                EdgeDirection::Bidirectional => EdgeDirection::Bidirectional,
            },
            EdgeDirection::Bidirectional => EdgeDirection::Bidirectional,
        }
    }
}

// The back_edges and child_ids implementations have been moved to artifact.rs

// The to_mermaid_flowchart implementation has been moved to artifact.rs
// Tests now use the public method from there
