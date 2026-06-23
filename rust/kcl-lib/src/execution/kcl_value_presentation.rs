use std::collections::HashMap;

use serde::Serialize;

use crate::ModuleId;
use crate::exec::KclValue;
use crate::execution::AbstractSegment;
use crate::execution::BoundedEdge;
use crate::execution::Face;
use crate::execution::GdtAnnotation;
use crate::execution::Helix;
use crate::execution::ImportedGeometry;
use crate::execution::Metadata;
use crate::execution::Plane;
use crate::execution::Sketch;
use crate::execution::SketchConstraint;
use crate::execution::SketchVar;
use crate::execution::Solid;
use crate::execution::TagIdentifier;
use crate::execution::types::NumericType;
use crate::parsing::ast::types::KclNone;
use crate::parsing::ast::types::TagDeclarator;

pub type KclObjectFields = HashMap<String, KclValuePresentation>;

/// Any KCL value.
#[derive(Debug, Clone, Serialize, PartialEq, ts_rs::TS)]
#[ts(export)]
#[serde(tag = "type")]
pub enum KclValuePresentation {
    Uuid {
        value: ::uuid::Uuid,
    },
    Bool {
        value: bool,
    },
    Number {
        value: f64,
        ty: NumericType,
    },
    String {
        value: String,
    },
    SketchVar {
        value: Box<SketchVar>,
    },
    SketchConstraint {
        value: Box<SketchConstraint>,
    },
    Tuple {
        value: Vec<KclValuePresentation>,
    },
    // An array where all values have a shared type (not necessarily the same principal type).
    HomArray {
        value: Vec<KclValuePresentation>,
        // The type of values, not the array type.
    },
    Object {
        value: KclObjectFields,
        constrainable: bool,
        #[serde(default, skip_serializing_if = "super::kcl_value::KclObjectKind::is_default")]
        #[ts(skip)]
        object_kind: super::kcl_value::KclObjectKind,
    },
    TagIdentifier(Box<TagIdentifier>),
    TagDeclarator(crate::parsing::ast::types::BoxNode<TagDeclarator>),
    GdtAnnotation {
        value: Box<GdtAnnotation>,
    },
    Plane {
        value: Box<Plane>,
    },
    Face {
        value: Box<Face>,
    },
    BoundedEdge {
        value: BoundedEdge,
    },
    Segment {
        value: Box<AbstractSegment>,
    },
    Sketch {
        value: Box<Sketch>,
    },
    Solid {
        value: Box<Solid>,
    },
    Helix {
        value: Box<Helix>,
    },
    ImportedGeometry(ImportedGeometry),
    Function {},
    Module {
        value: ModuleId,
    },
    #[ts(skip)]
    Type {
        experimental: bool,
    },
    KclNone {
        value: KclNone,
    },
}

impl KclValuePresentation {
    #[allow(unused)]
    pub(crate) fn none() -> Self {
        Self::KclNone {
            value: Default::default(),
        }
    }
}

impl From<KclValue> for KclValuePresentation {
    fn from(full: KclValue) -> Self {
        match full {
            KclValue::Uuid { value, meta } => KclValuePresentation::Uuid { value },
            KclValue::Bool { value, meta } => KclValuePresentation::Bool { value },
            KclValue::Number { value, ty, meta } => KclValuePresentation::Number { value, ty },
            KclValue::String { value, meta } => KclValuePresentation::String { value },
            KclValue::SketchVar { value } => KclValuePresentation::SketchVar { value },
            KclValue::SketchConstraint { value } => KclValuePresentation::SketchConstraint { value },
            KclValue::Tuple { value, meta } => KclValuePresentation::Tuple {
                value: value.into_iter().map(KclValuePresentation::from).collect(),
            },
            KclValue::HomArray { value, ty } => KclValuePresentation::HomArray {
                value: value.into_iter().map(KclValuePresentation::from).collect(),
            },
            KclValue::Object {
                value,
                constrainable,
                object_kind,
                meta,
            } => KclValuePresentation::Object {
                value: value
                    .into_iter()
                    .map(|(k, v)| (k, KclValuePresentation::from(v)))
                    .collect(),
                constrainable,
                object_kind,
            },
            KclValue::TagIdentifier(tag_identifier) => KclValuePresentation::TagIdentifier(tag_identifier),
            KclValue::TagDeclarator(node) => KclValuePresentation::TagDeclarator(node),
            KclValue::GdtAnnotation { value } => KclValuePresentation::GdtAnnotation { value },
            KclValue::Plane { value } => KclValuePresentation::Plane { value },
            KclValue::Face { value } => KclValuePresentation::Face { value },
            KclValue::BoundedEdge { value, meta } => KclValuePresentation::BoundedEdge { value },
            KclValue::Segment { value } => KclValuePresentation::Segment { value },
            KclValue::Sketch { value } => KclValuePresentation::Sketch { value },
            KclValue::Solid { value } => KclValuePresentation::Solid { value },
            KclValue::Helix { value } => KclValuePresentation::Helix { value },
            KclValue::ImportedGeometry(imported_geometry) => KclValuePresentation::ImportedGeometry(imported_geometry),
            KclValue::Function { value, meta } => KclValuePresentation::Function { value },
            KclValue::Module { value, meta } => KclValuePresentation::Module { value },
            KclValue::Type {
                value,
                experimental,
                meta,
            } => KclValuePresentation::Type { value },
            KclValue::KclNone { value, meta } => KclValuePresentation::KclNone { value },
        }
    }
}
