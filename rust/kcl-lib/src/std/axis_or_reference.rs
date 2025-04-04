//! Types for referencing an axis or edge.

use crate::std::fillet::EdgeReference;

/// A 2D axis or tagged edge.
#[derive(Debug, Clone, PartialEq)]
pub enum Axis2dOrEdgeReference {
    /// 2D axis and origin.
    Axis { direction: [f64; 2], origin: [f64; 2] },
    /// Tagged edge.
    Edge(EdgeReference),
}

/// A 3D axis or tagged edge.
#[derive(Debug, Clone, PartialEq)]
pub enum Axis3dOrEdgeReference {
    /// 3D axis and origin.
    Axis { direction: [f64; 3], origin: [f64; 3] },
    /// Tagged edge.
    Edge(EdgeReference),
}
