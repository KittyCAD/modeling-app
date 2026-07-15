//! Types for referencing an axis or edge.

use kittycad_modeling_cmds::shared::EdgeSpecifier as ModelingEdgeSpecifier;

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
    /// Tagged edge
    Edge(EdgeReference),
    /// Edge specifier with side faces, end faces, and index.
    EdgeSpecifier(ModelingEdgeSpecifier),
}

/// A 3D mirror target.
#[derive(Debug, Clone, PartialEq)]
pub enum MirrorAcross3d {
    /// 3D axis and origin.
    Axis {
        direction: Box<[TyF64; 3]>,
        origin: Box<[TyF64; 3]>,
    },
    /// Tagged edge.
    Edge(Box<EdgeReference>),
    /// A plane.
    Plane(Box<Plane>),
}

impl Axis2dOrEdgeReference {
    /// Use a sketch-solve segment by finding its engine ID.
    pub fn from_segment(segment: &Segment) -> Result<Self, KclError> {
        match &segment.kind {
            SegmentKind::Line { .. } => Ok(Self::Edge(EdgeReference::Uuid(segment.id))),
            SegmentKind::Point { .. } => Err(KclError::new_type(KclErrorDetails {
                source_ranges: segment.meta.iter().map(|meta| meta.source_range).collect(),
                backtrace: Default::default(),
                message: "Cannot use a point as an axis".to_owned(),
            })),
            SegmentKind::Arc { .. } => Err(KclError::new_type(KclErrorDetails {
                source_ranges: segment.meta.iter().map(|meta| meta.source_range).collect(),
                backtrace: Default::default(),
                message: "Cannot use an arc as an axis".to_owned(),
            })),
            SegmentKind::Circle { .. } => Err(KclError::new_type(KclErrorDetails {
                source_ranges: segment.meta.iter().map(|meta| meta.source_range).collect(),
                backtrace: Default::default(),
                message: "Cannot use a circle as an axis".to_owned(),
            })),
            SegmentKind::ControlPointSpline { .. } => Err(KclError::new_type(KclErrorDetails {
                source_ranges: segment.meta.iter().map(|meta| meta.source_range).collect(),
                backtrace: Default::default(),
                message: "Cannot use a control point spline as an axis".to_owned(),
            })),
        }
    }
}

impl MirrorAcross3d {
    /// Use a sketch-solve segment by finding its engine ID.
    pub fn from_segment(segment: &Segment) -> Result<Self, KclError> {
        match &segment.kind {
            SegmentKind::Line { .. } => Ok(Self::Edge(Box::new(EdgeReference::Uuid(segment.id)))),
            SegmentKind::Point { .. } => Err(KclError::new_type(KclErrorDetails {
                source_ranges: segment.meta.iter().map(|meta| meta.source_range).collect(),
                backtrace: Default::default(),
                message: "Cannot use a point as an axis".to_owned(),
            })),
            SegmentKind::Arc { .. } => Err(KclError::new_type(KclErrorDetails {
                source_ranges: segment.meta.iter().map(|meta| meta.source_range).collect(),
                backtrace: Default::default(),
                message: "Cannot use an arc as an axis".to_owned(),
            })),
            SegmentKind::Circle { .. } => Err(KclError::new_type(KclErrorDetails {
                source_ranges: segment.meta.iter().map(|meta| meta.source_range).collect(),
                backtrace: Default::default(),
                message: "Cannot use a circle as an axis".to_owned(),
            })),
            SegmentKind::ControlPointSpline { .. } => Err(KclError::new_type(KclErrorDetails {
                source_ranges: segment.meta.iter().map(|meta| meta.source_range).collect(),
                backtrace: Default::default(),
                message: "Cannot use a control point spline as an axis".to_owned(),
            })),
        }
    }
}

/// A 3D axis or tagged edge.
#[allow(clippy::large_enum_variant)]
#[derive(Debug, Clone, PartialEq)]
pub enum Axis3dOrEdgeReference {
    /// 3D axis and origin.
    Axis { direction: [TyF64; 3], origin: [TyF64; 3] },
    /// Tagged edge
    Edge(EdgeReference),
    /// Edge specifier with side faces, end faces, and index.
    EdgeSpecifier(ModelingEdgeSpecifier),
}

impl Axis3dOrEdgeReference {
    /// Use a sketch-solve segment by finding its engine ID.
    pub fn from_segment(segment: &Segment) -> Result<Self, KclError> {
        match &segment.kind {
            SegmentKind::Line { .. } => Ok(Self::Edge(EdgeReference::Uuid(segment.id))),
            SegmentKind::Point { .. } => Err(KclError::new_type(KclErrorDetails {
                source_ranges: segment.meta.iter().map(|meta| meta.source_range).collect(),
                backtrace: Default::default(),
                message: "Cannot use a point as an axis".to_owned(),
            })),
            SegmentKind::Arc { .. } => Err(KclError::new_type(KclErrorDetails {
                source_ranges: segment.meta.iter().map(|meta| meta.source_range).collect(),
                backtrace: Default::default(),
                message: "Cannot use an arc as an axis".to_owned(),
            })),
            SegmentKind::Circle { .. } => Err(KclError::new_type(KclErrorDetails {
                source_ranges: segment.meta.iter().map(|meta| meta.source_range).collect(),
                backtrace: Default::default(),
                message: "Cannot use a circle as an axis".to_owned(),
            })),
            SegmentKind::ControlPointSpline { .. } => Err(KclError::new_type(KclErrorDetails {
                source_ranges: segment.meta.iter().map(|meta| meta.source_range).collect(),
                backtrace: Default::default(),
                message: "Cannot use a control point spline as an axis".to_owned(),
            })),
        }
    }
}

/// A 3D point or tagged edge.
#[allow(clippy::large_enum_variant)]
#[derive(Debug, Clone, PartialEq)]
pub enum Point3dOrEdgeReference {
    /// 3D point and origin.
    Point([TyF64; 3]),
    /// Tagged edge.
    Edge(EdgeReference),
}

impl Point3dOrEdgeReference {
    /// Use a sketch-solve segment by finding its engine ID.
    pub fn from_segment(segment: &Segment) -> Result<Self, KclError> {
        match &segment.kind {
            SegmentKind::Line { .. } => Ok(Self::Edge(EdgeReference::Uuid(segment.id))),
            SegmentKind::Point { position, .. } => Ok(Self::Point([
                position[0].clone(),
                position[1].clone(),
                TyF64::count(0.0),
            ])),
            SegmentKind::Arc { .. } => Err(KclError::new_type(KclErrorDetails {
                source_ranges: segment.meta.iter().map(|meta| meta.source_range).collect(),
                backtrace: Default::default(),
                message: "Cannot use an arc as a 3D point or edge reference".to_owned(),
            })),
            SegmentKind::Circle { .. } => Err(KclError::new_type(KclErrorDetails {
                source_ranges: segment.meta.iter().map(|meta| meta.source_range).collect(),
                backtrace: Default::default(),
                message: "Cannot use a circle as a 3D point or edge reference".to_owned(),
            })),
            SegmentKind::ControlPointSpline { .. } => Err(KclError::new_type(KclErrorDetails {
                source_ranges: segment.meta.iter().map(|meta| meta.source_range).collect(),
                backtrace: Default::default(),
                message: "Cannot use a control point spline as a 3D point or edge reference".to_owned(),
            })),
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
    /// Extrude-to edge: `{ sideFaces = [...], endFaces = [...], index? }` (face tags or UUIDs).
    EdgeToReference(super::edge::UnresolvedEdgeSpecifier),
}

/// A 3D axis a point 3D or tagged edge.
#[allow(clippy::large_enum_variant)]
#[derive(Debug, Clone, PartialEq)]
pub enum Axis3dOrPoint3dOrEdgeReference {
    /// 3D axis and origin.
    Axis { direction: [TyF64; 3], origin: [TyF64; 3] },
    /// 3D point
    Point([TyF64; 3]),
    /// Tagged edge
    Edge(EdgeReference),
}

impl Axis3dOrPoint3dOrEdgeReference {
    pub fn from_segment(segment: &Segment) -> Result<Self, KclError> {
        match &segment.kind {
            SegmentKind::Line { .. } => Ok(Self::Edge(EdgeReference::Uuid(segment.id))),
            SegmentKind::Point { .. } => Err(KclError::new_type(KclErrorDetails {
                source_ranges: segment.meta.iter().map(|meta| meta.source_range).collect(),
                backtrace: Default::default(),
                message: "Cannot use a point as an axis".to_owned(),
            })),
            SegmentKind::Arc { .. } => Err(KclError::new_type(KclErrorDetails {
                source_ranges: segment.meta.iter().map(|meta| meta.source_range).collect(),
                backtrace: Default::default(),
                message: "Cannot use an arc as an axis".to_owned(),
            })),
            SegmentKind::Circle { .. } => Err(KclError::new_type(KclErrorDetails {
                source_ranges: segment.meta.iter().map(|meta| meta.source_range).collect(),
                backtrace: Default::default(),
                message: "Cannot use a circle as an axis".to_owned(),
            })),
            SegmentKind::ControlPointSpline { .. } => Err(KclError::new_type(KclErrorDetails {
                source_ranges: segment.meta.iter().map(|meta| meta.source_range).collect(),
                backtrace: Default::default(),
                message: "Cannot use a control point spline as an axis".to_owned(),
            })),
        }
    }
}
