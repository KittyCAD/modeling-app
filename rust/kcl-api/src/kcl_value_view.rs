use std::collections::HashMap;

use serde::Serialize;

use crate::ModuleId;
use crate::NumericType;

/// Extra information carried by a KCL object value.
#[derive(Debug, Clone, Default, PartialEq, Serialize)]
pub enum KclObjectKind {
    #[default]
    Default,
    SketchTags {
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        deprecated_solid_tag_names: Vec<String>,
    },
}

impl KclObjectKind {
    pub fn is_default(&self) -> bool {
        matches!(self, Self::Default)
    }

    pub fn deprecated_solid_tag_names(&self) -> &[String] {
        match self {
            Self::Default => &[],
            Self::SketchTags {
                deprecated_solid_tag_names,
            } => deprecated_solid_tag_names,
        }
    }
}

/// Any KCL value exposed through the KCL API.
///
/// The payload types are parameters because their runtime representations are
/// owned by the executor. API-only consumers can use [`OpaqueKclValueView`] to
/// treat those payloads as JSON, while executors can retain their concrete
/// types without creating a dependency from `kcl-api` back to the executor.
#[derive(Debug, Clone, Serialize, PartialEq, ts_rs::TS)]
#[serde(tag = "type")]
pub enum KclValueView<
    SketchVar,
    SketchConstraint,
    TagIdentifier,
    TagDeclarator,
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
> {
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
    /// Exposed by nominal identity, not by the variant's representation.
    Enum {
        enum_name: String,
        variant: String,
    },
    SketchVar {
        value: Box<SketchVar>,
    },
    SketchConstraint {
        value: Box<SketchConstraint>,
    },
    Tuple {
        #[ts(type = "Array<KclValueView>")]
        value: Vec<Self>,
    },
    // An array where all values have a shared type (not necessarily the same principal type).
    HomArray {
        #[ts(type = "Array<KclValueView>")]
        value: Vec<Self>,
    },
    Object {
        #[ts(type = "{ [key in string]: KclValueView }")]
        value: HashMap<String, Self>,
        constrainable: bool,
        #[serde(default, skip_serializing_if = "KclObjectKind::is_default")]
        #[ts(skip)]
        object_kind: KclObjectKind,
    },
    TagIdentifier(Box<TagIdentifier>),
    TagDeclarator(TagDeclarator),
    GdtAnnotation {
        value: Box<GdtAnnotation>,
    },
    CameraView {
        value: Box<CameraView>,
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

/// A KCL value view whose executor-owned payloads are represented as JSON.
pub type OpaqueKclValueView = KclValueView<
    serde_json::Value,
    serde_json::Value,
    serde_json::Value,
    serde_json::Value,
    serde_json::Value,
    serde_json::Value,
    serde_json::Value,
    serde_json::Value,
    serde_json::Value,
    serde_json::Value,
    serde_json::Value,
    serde_json::Value,
    serde_json::Value,
    serde_json::Value,
    serde_json::Value,
>;

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn opaque_value_view_preserves_the_wire_shape() {
        let value: OpaqueKclValueView = KclValueView::Object {
            value: HashMap::from([(
                "answer".to_owned(),
                KclValueView::Number {
                    value: 42.0,
                    ty: NumericType::Unknown,
                },
            )]),
            constrainable: false,
            object_kind: KclObjectKind::Default,
        };

        assert_eq!(
            serde_json::to_value(value).unwrap(),
            json!({
                "type": "Object",
                "value": {
                    "answer": {
                        "type": "Number",
                        "value": 42.0,
                        "ty": { "type": "Unknown" },
                    },
                },
                "constrainable": false,
            })
        );
    }

    #[test]
    fn sketch_tag_object_kind_preserves_the_wire_shape() {
        let value: OpaqueKclValueView = KclValueView::Object {
            value: HashMap::new(),
            constrainable: false,
            object_kind: KclObjectKind::SketchTags {
                deprecated_solid_tag_names: Vec::new(),
            },
        };

        assert_eq!(
            serde_json::to_value(value).unwrap(),
            json!({
                "type": "Object",
                "value": {},
                "constrainable": false,
                "object_kind": { "SketchTags": {} },
            })
        );
    }
}
