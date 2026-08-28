use indexmap::IndexMap;
use kcl_error::ModuleId;
use kcl_error::SourceRange;
use schemars::JsonSchema;
use serde::Deserialize;
use serde::Serialize;
use serde_json::Value as JsonValue;

use crate::ArtifactId;
use crate::NumericType;
use crate::ObjectId;
use crate::UnitLength;

pub type KclObjectFields = IndexMap<String, KclValueView>;

/// A serializable, presentational view of any KCL value.
///
/// This type deliberately contains no executor state. Runtime values are
/// converted to it by `kcl-lib` before they cross an API boundary.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(tag = "type")]
pub enum KclValueView {
    Uuid {
        value: uuid::Uuid,
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
        value: Box<SketchVarView>,
    },
    /// Sketch constraints are currently only shown in the debug memory pane.
    SketchConstraint {
        value: JsonValue,
    },
    Tuple {
        value: Vec<KclValueView>,
    },
    /// An array where all values have a shared type.
    HomArray {
        value: Vec<KclValueView>,
    },
    Object {
        value: KclObjectFields,
        constrainable: bool,
    },
    TagIdentifier(TagIdentifierView),
    TagDeclarator {
        value: String,
    },
    GdtAnnotation {
        value: Box<GdtAnnotationView>,
    },
    /// Camera values are currently only shown in the debug memory pane.
    CameraView {
        value: JsonValue,
    },
    /// Named views are consumed through the artifact graph, not program memory.
    NamedView {
        value: JsonValue,
    },
    Plane {
        value: Box<PlaneView>,
    },
    Face {
        value: Box<FaceView>,
    },
    BoundedEdge {
        value: BoundedEdgeView,
    },
    /// Standalone segments are currently only shown in the debug memory pane.
    Segment {
        value: JsonValue,
    },
    Sketch {
        value: Box<SketchView>,
    },
    Solid {
        value: Box<SolidView>,
    },
    Helix {
        value: Box<HelixView>,
    },
    ImportedGeometry(ImportedGeometryView),
    Function {},
    Module {
        value: ModuleId,
    },
    Type {
        experimental: bool,
    },
    KclNone {},
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct SketchVarView {
    pub initial_value: f64,
    pub ty: NumericType,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct TagIdentifierView {
    pub value: String,
}

/// The source-independent portion of a tag declaration.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, ts_rs::TS, JsonSchema)]
#[ts(export, rename = "TagDeclarator")]
#[serde(tag = "type", rename = "TagDeclarator")]
pub struct TagDeclaratorView {
    #[serde(rename = "value")]
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct GdtAnnotationView {
    pub id: uuid::Uuid,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
pub struct Point3dView {
    pub x: f64,
    pub y: f64,
    pub z: f64,
    pub units: Option<UnitLength>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct PlaneView {
    pub id: uuid::Uuid,
    pub artifact_id: ArtifactId,
    pub object_id: Option<ObjectId>,
    pub kind: PlaneKindView,
    pub origin: Point3dView,
    pub x_axis: Point3dView,
    pub y_axis: Point3dView,
    pub z_axis: Point3dView,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, ts_rs::TS, JsonSchema)]
#[ts(export)]
pub enum PlaneKindView {
    #[serde(rename = "XY", alias = "xy")]
    XY,
    #[serde(rename = "XZ", alias = "xz")]
    XZ,
    #[serde(rename = "YZ", alias = "yz")]
    YZ,
    Custom,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct FaceView {
    pub id: uuid::Uuid,
    pub artifact_id: ArtifactId,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct BoundedEdgeView {
    pub face_id: uuid::Uuid,
    pub edge_id: Option<uuid::Uuid>,
    pub lower_bound: f32,
    pub upper_bound: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct ImportedGeometryView {
    pub id: uuid::Uuid,
    pub value: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct HelixView {
    pub value: uuid::Uuid,
    pub artifact_id: ArtifactId,
    pub revolutions: f64,
    pub angle_start: f64,
    pub ccw: bool,
    pub cylinder_id: Option<uuid::Uuid>,
    pub units: UnitLength,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum SketchSurfaceView {
    Plane(Box<PlaneView>),
    Face(Box<FaceView>),
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct BasePathView {
    #[ts(type = "[number, number]")]
    pub from: [f64; 2],
    #[ts(type = "[number, number]")]
    pub to: [f64; 2],
    pub units: UnitLength,
    pub tag: Option<TagDeclaratorView>,
    #[serde(rename = "__geoMeta")]
    pub geo_meta: GeoMetaView,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct GeoMetaView {
    pub id: uuid::Uuid,
    pub source_range: SourceRange,
}

/// A sketch path containing the geometry and source data used by the editor.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(tag = "type")]
pub enum PathView {
    ToPoint {
        #[serde(flatten)]
        base: BasePathView,
    },
    TangentialArcTo {
        #[serde(flatten)]
        base: BasePathView,
        center: [f64; 2],
        ccw: bool,
    },
    TangentialArc {
        #[serde(flatten)]
        base: BasePathView,
        center: [f64; 2],
        ccw: bool,
    },
    Circle {
        #[serde(flatten)]
        base: BasePathView,
        center: [f64; 2],
        radius: f64,
        ccw: bool,
    },
    CircleThreePoint {
        #[serde(flatten)]
        base: BasePathView,
        p1: [f64; 2],
        p2: [f64; 2],
        p3: [f64; 2],
    },
    ArcThreePoint {
        #[serde(flatten)]
        base: BasePathView,
        p1: [f64; 2],
        p2: [f64; 2],
        p3: [f64; 2],
    },
    Horizontal {
        #[serde(flatten)]
        base: BasePathView,
        x: f64,
    },
    AngledLineTo {
        #[serde(flatten)]
        base: BasePathView,
        x: Option<f64>,
        y: Option<f64>,
    },
    Base {
        #[serde(flatten)]
        base: BasePathView,
    },
    Arc {
        #[serde(flatten)]
        base: BasePathView,
        center: [f64; 2],
        radius: f64,
        ccw: bool,
    },
    Ellipse {
        #[serde(flatten)]
        base: BasePathView,
        center: [f64; 2],
        major_axis: [f64; 2],
        minor_radius: f64,
        ccw: bool,
    },
    Conic {
        #[serde(flatten)]
        base: BasePathView,
    },
    Bezier {
        #[serde(flatten)]
        base: BasePathView,
        control1: [f64; 2],
        control2: [f64; 2],
    },
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub enum ProfileClosedView {
    No,
    Maybe,
    Implicitly,
    Explicitly,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export, rename = "SketchView")]
#[serde(rename_all = "camelCase")]
pub struct SketchView {
    pub id: uuid::Uuid,
    pub original_id: uuid::Uuid,
    pub paths: Vec<PathView>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub inner_paths: Vec<PathView>,
    pub on: SketchSurfaceView,
    pub start: BasePathView,
    #[serde(default, skip_serializing_if = "IndexMap::is_empty")]
    pub tags: IndexMap<String, TagIdentifierView>,
    pub artifact_id: ArtifactId,
    pub units: UnitLength,
    pub is_closed: ProfileClosedView,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum ExtrudeSurfaceView {
    ExtrudePlane(SurfaceView),
    ExtrudeArc(SurfaceView),
    Chamfer(SurfaceView),
    Fillet(SurfaceView),
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct SurfaceView {
    pub face_id: uuid::Uuid,
    pub tag: Option<TagDeclaratorView>,
    #[serde(flatten)]
    pub geo_meta: GeoMetaView,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum EdgeCutView {
    Fillet {
        id: uuid::Uuid,
        edge_id: uuid::Uuid,
        tag: Option<TagDeclaratorView>,
    },
    Chamfer {
        id: uuid::Uuid,
        edge_id: uuid::Uuid,
        tag: Option<TagDeclaratorView>,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(tag = "creatorType", rename_all = "camelCase")]
pub enum SolidCreatorView {
    Sketch(SketchView),
    Face {
        face_id: uuid::Uuid,
        solid_id: uuid::Uuid,
        sketch: SketchView,
    },
    Edge {
        edge_id: uuid::Uuid,
        body_id: uuid::Uuid,
    },
    Procedural,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export, rename = "SolidView")]
#[serde(rename_all = "camelCase")]
pub struct SolidView {
    pub id: uuid::Uuid,
    pub original_id: uuid::Uuid,
    pub topology_id: uuid::Uuid,
    pub artifact_id: ArtifactId,
    /// Surface summaries are retained for the debug memory pane.
    pub value: Vec<ExtrudeSurfaceView>,
    #[serde(default, skip_serializing_if = "IndexMap::is_empty")]
    pub faces: IndexMap<String, TagIdentifierView>,
    #[serde(rename = "sketch")]
    pub creator: SolidCreatorView,
    pub start_cap_id: Option<uuid::Uuid>,
    pub end_cap_id: Option<uuid::Uuid>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub edge_cuts: Vec<EdgeCutView>,
    pub units: UnitLength,
    pub sectional: bool,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn value_view_round_trips_through_json() {
        let value = KclValueView::Object {
            value: IndexMap::from([
                (
                    "length".to_owned(),
                    KclValueView::Number {
                        value: 12.5,
                        ty: NumericType::default(),
                    },
                ),
                (
                    "tag".to_owned(),
                    KclValueView::TagDeclarator {
                        value: "edge01".to_owned(),
                    },
                ),
            ]),
            constrainable: false,
        };

        let json = serde_json::to_value(&value).unwrap();
        let round_trip = serde_json::from_value(json).unwrap();
        assert_eq!(value, round_trip);
    }

    #[test]
    fn tag_declarator_keeps_the_existing_wire_shape() {
        let value = KclValueView::TagDeclarator {
            value: "edge01".to_owned(),
        };

        assert_eq!(
            serde_json::to_value(value).unwrap(),
            serde_json::json!({ "type": "TagDeclarator", "value": "edge01" })
        );
    }
}
