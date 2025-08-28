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

/// A 2D axis or a raw point2d.
#[derive(Debug, Clone, PartialEq)]
pub enum Axis2dOrPoint2d {
    /// 2D axis and origin.
    Axis { direction: [TyF64; 2], origin: [TyF64; 2] },
    /// Raw point2d.
    Point([TyF64; 2]),
}

impl Axis2dOrPoint2d {
    /// Convert to a 2D axis.
    pub fn to_point2d(&self) -> [TyF64; 2] {
        match self {
            Axis2dOrPoint2d::Axis { direction, origin: _ } => direction.clone(),
            Axis2dOrPoint2d::Point(point) => point.clone(),
        }
    }
}

/// A 3D axis or a raw point3d.
#[derive(Debug, Clone, PartialEq)]
pub enum Axis3dOrPoint3d {
    /// 3D axis and origin.
    Axis { direction: [TyF64; 3], origin: [TyF64; 3] },
    /// Raw point3d.
    Point([TyF64; 3]),
}

impl Axis3dOrPoint3d {
    /// Convert to a 3D axis.
    pub fn to_point3d(&self) -> [TyF64; 3] {
        match self {
            Axis3dOrPoint3d::Axis { direction, origin: _ } => direction.clone(),
            Axis3dOrPoint3d::Point(point) => point.clone(),
        }
    }

    pub fn axis_origin(&self) -> Option<[TyF64; 3]> {
        match self {
            Axis3dOrPoint3d::Axis { origin, .. } => Some(origin.clone()),
            Axis3dOrPoint3d::Point(..) => None,
        }
    }
}
