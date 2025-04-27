//! Types for referencing an axis or edge.

use super::args::TyF64;
use crate::std::fillet::EdgeReference;

/// A 2D axis or tagged edge.
#[derive(Debug, Clone, PartialEq)]
pub enum Axis2dOrEdgeReference {
    /// 2D axis and origin.
    Axis { direction: [TyF64; 2], origin: [TyF64; 2] },
    /// Tagged edge.
    Edge(EdgeReference),
}

/// A 3D axis or tagged edge.
#[allow(clippy::large_enum_variant)]
#[derive(Debug, Clone, PartialEq)]
pub enum Axis3dOrEdgeReference {
    /// 3D axis and origin.
    Axis { direction: [TyF64; 3], origin: [TyF64; 3] },
    /// Tagged edge.
    Edge(EdgeReference),
}
