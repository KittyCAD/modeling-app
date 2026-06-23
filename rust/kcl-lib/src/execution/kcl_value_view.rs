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
use crate::execution::Plane;
use crate::execution::Sketch;
use crate::execution::SketchConstraint;
use crate::execution::SketchVar;
use crate::execution::Solid;
use crate::execution::TagIdentifier;
use crate::execution::types::NumericType;
use crate::parsing::ast::types::KclNone;
use crate::parsing::ast::types::TagDeclarator;

pub type KclObjectFields = HashMap<String, KclValueView>;

/// Any KCL value.
#[derive(Debug, Clone, Serialize, PartialEq, ts_rs::TS)]
#[ts(export)]
#[serde(tag = "type")]
pub enum KclValueView {
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
        value: Vec<KclValueView>,
    },
    // An array where all values have a shared type (not necessarily the same principal type).
    HomArray {
        value: Vec<KclValueView>,
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

impl From<KclValue> for KclValueView {
    fn from(full: KclValue) -> Self {
        match full {
            KclValue::Uuid { value, .. } => KclValueView::Uuid { value },
            KclValue::Bool { value, .. } => KclValueView::Bool { value },
            KclValue::Number { value, ty, .. } => KclValueView::Number { value, ty },
            KclValue::String { value, .. } => KclValueView::String { value },
            KclValue::SketchVar { value } => KclValueView::SketchVar { value },
            KclValue::SketchConstraint { value } => KclValueView::SketchConstraint { value },
            KclValue::Tuple { value, .. } => KclValueView::Tuple {
                value: value.into_iter().map(KclValueView::from).collect(),
            },
            KclValue::HomArray { value, .. } => KclValueView::HomArray {
                value: value.into_iter().map(KclValueView::from).collect(),
            },
            KclValue::Object {
                value,
                constrainable,
                object_kind,
                ..
            } => KclValueView::Object {
                value: value.into_iter().map(|(k, v)| (k, KclValueView::from(v))).collect(),
                constrainable,
                object_kind,
            },
            KclValue::TagIdentifier(tag_identifier) => KclValueView::TagIdentifier(tag_identifier),
            KclValue::TagDeclarator(node) => KclValueView::TagDeclarator(node),
            KclValue::GdtAnnotation { value } => KclValueView::GdtAnnotation { value },
            KclValue::Plane { value } => KclValueView::Plane { value },
            KclValue::Face { value } => KclValueView::Face { value },
            KclValue::BoundedEdge { value, .. } => KclValueView::BoundedEdge { value },
            KclValue::Segment { value } => KclValueView::Segment { value },
            KclValue::Sketch { value } => KclValueView::Sketch { value },
            KclValue::Solid { value } => KclValueView::Solid { value },
            KclValue::Helix { value } => KclValueView::Helix { value },
            KclValue::ImportedGeometry(imported_geometry) => KclValueView::ImportedGeometry(imported_geometry),
            KclValue::Function { .. } => KclValueView::Function {},
            KclValue::Module { value, .. } => KclValueView::Module { value },
            KclValue::Type { experimental, .. } => KclValueView::Type { experimental },
            KclValue::KclNone { value, .. } => KclValueView::KclNone { value },
        }
    }
}
