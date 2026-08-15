use crate::exec::KclValue;
use crate::execution::AbstractSegment;
use crate::execution::BoundedEdge;
use crate::execution::CameraView;
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
use crate::parsing::ast::types::KclNone;
use crate::parsing::ast::types::TagDeclarator;

pub type KclValueView = kcl_api::KclValueView<
    SketchVar,
    SketchConstraint,
    TagIdentifier,
    crate::parsing::ast::types::BoxNode<TagDeclarator>,
    GdtAnnotation,
    CameraView,
    Plane,
    Face,
    BoundedEdge,
    AbstractSegment,
    Sketch,
    Solid,
    Helix,
    ImportedGeometry,
    KclNone,
>;

/// Any KCL value.
#[allow(dead_code)]
#[derive(ts_rs::TS)]
#[ts(export, rename = "KclValueView")]
pub(crate) struct KclValueViewTs(#[ts(inline)] KclValueView);

impl From<KclValue> for KclValueView {
    fn from(full: KclValue) -> Self {
        match full {
            KclValue::Uuid { value, .. } => KclValueView::Uuid { value },
            KclValue::Bool { value, .. } => KclValueView::Bool { value },
            KclValue::Number { value, ty, .. } => KclValueView::Number { value, ty },
            KclValue::String { value, .. } => KclValueView::String { value },
            KclValue::Enum { value } => KclValueView::Enum {
                enum_name: value.enum_id().declared_name().to_owned(),
                variant: value.variant().to_owned(),
            },
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
            KclValue::CameraView { value } => KclValueView::CameraView { value },
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
