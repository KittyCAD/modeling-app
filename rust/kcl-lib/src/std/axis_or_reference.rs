//! Types for referencing an axis or edge.

use super::args::TyF64;
use crate::KclError;
use crate::errors::KclErrorDetails;
use crate::execution::Plane;
use crate::execution::Segment;
use crate::execution::SegmentKind;
use crate::execution::Sketch;
use crate::execution::Solid;
use crate::execution::TagIdentifier;
use crate::std::fillet::EdgeReference;
use crate::std::sketch::FaceTag;

/// A 2D axis or tagged edge.
#[derive(Debug, Clone, PartialEq)]
pub enum Axis2dOrEdgeReference {
    /// 2D axis and origin.
    Axis { direction: [TyF64; 2], origin: [TyF64; 2] },
    /// Tagged edge.
    Edge(EdgeReference),
}

impl Axis2dOrEdgeReference {
    /// Use a sketch-solve segment by finding its engine ID.
    pub fn from_segment(segment: &Segment) -> Result<Self, KclError> {
        match &segment.kind {
            SegmentKind::Line { .. } => Ok(Self::Edge(EdgeReference::Uuid(segment.id))),
            SegmentKind::Point { .. } => {
                return Err(KclError::new_type(KclErrorDetails {
                    source_ranges: segment.meta.iter().map(|meta| meta.source_range).collect(),
                    backtrace: Default::default(),
                    message: "Cannot use a point as an axis".to_owned(),
                }));
            }
            SegmentKind::Arc { .. } => {
                return Err(KclError::new_type(KclErrorDetails {
                    source_ranges: segment.meta.iter().map(|meta| meta.source_range).collect(),
                    backtrace: Default::default(),
                    message: "Cannot use an arc as an axis".to_owned(),
                }));
            }
            SegmentKind::Circle { .. } => {
                return Err(KclError::new_type(KclErrorDetails {
                    source_ranges: segment.meta.iter().map(|meta| meta.source_range).collect(),
                    backtrace: Default::default(),
                    message: "Cannot use a circle as an axis".to_owned(),
                }));
            }
        }
    }
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

impl Axis3dOrEdgeReference {
    /// Use a sketch-solve segment by finding its engine ID.
    pub fn from_segment(segment: &Segment) -> Result<Self, KclError> {
        match &segment.kind {
            SegmentKind::Line { .. } => Ok(Self::Edge(EdgeReference::Uuid(segment.id))),
            SegmentKind::Point { .. } => {
                return Err(KclError::new_type(KclErrorDetails {
                    source_ranges: segment.meta.iter().map(|meta| meta.source_range).collect(),
                    backtrace: Default::default(),
                    message: "Cannot use a point as an axis".to_owned(),
                }));
            }
            SegmentKind::Arc { .. } => {
                return Err(KclError::new_type(KclErrorDetails {
                    source_ranges: segment.meta.iter().map(|meta| meta.source_range).collect(),
                    backtrace: Default::default(),
                    message: "Cannot use an arc as an axis".to_owned(),
                }));
            }
            SegmentKind::Circle { .. } => {
                return Err(KclError::new_type(KclErrorDetails {
                    source_ranges: segment.meta.iter().map(|meta| meta.source_range).collect(),
                    backtrace: Default::default(),
                    message: "Cannot use a circle as an axis".to_owned(),
                }));
            }
        }
    }
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

/// A raw point3d, 3D axis, Edge, Face, Solid or Tag.
#[allow(clippy::large_enum_variant)]
#[derive(Debug, Clone, PartialEq)]
pub enum Point3dAxis3dOrGeometryReference {
    /// Raw point3d.
    Point([TyF64; 3]),
    /// 3D axis and origin.
    Axis { direction: [TyF64; 3], origin: [TyF64; 3] },
    /// Plane.
    Plane(Box<Plane>),
    /// Edge Reference.
    Edge(EdgeReference),
    /// Face.
    Face(FaceTag),
    /// Sketch.
    Sketch(Box<Sketch>),
    /// Solid.
    Solid(Box<Solid>),
    /// Tagged edge or face.
    TaggedEdgeOrFace(TagIdentifier),
}
