//! Presentation of the debug-only values whose API fields are JSON.
//!
//! Keep these explicit so runtime serialization can retain execution state
//! without exposing it in the memory pane or program-memory snapshots.

use serde::Serialize;
use serde::ser::SerializeStructVariant;

use super::*;
use crate::execution::kcl_value_view::sketch_surface_view;
use crate::named_views::values;
use crate::std::args::TyF64;

#[derive(Serialize)]
pub(crate) struct ConstraintView {
    kind: ConstraintKindView,
}
struct ConstraintKindView(runtime::SketchConstraintKind);
impl Serialize for ConstraintKindView {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        if let runtime::SketchConstraintKind::Angle {
            line0,
            line1,
            label_position,
            ..
        } = &self.0
        {
            let mut output = serializer.serialize_struct_variant(
                "SketchConstraintKind",
                0,
                "angle",
                if label_position.is_some() { 3 } else { 2 },
            )?;
            output.serialize_field("line0", line0)?;
            output.serialize_field("line1", line1)?;
            if let Some(position) = label_position {
                output.serialize_field("labelPosition", position)?;
            }
            output.end()
        } else {
            self.0.serialize(serializer)
        }
    }
}
impl From<runtime::SketchConstraint> for ConstraintView {
    fn from(value: runtime::SketchConstraint) -> Self {
        Self {
            kind: ConstraintKindView(value.kind),
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CameraValueView {
    look: values::CameraLook,
    target: Option<Point3dView>,
    distance: Option<TyF64>,
    projection: values::Projection,
}
impl From<&values::CameraView> for CameraValueView {
    fn from(value: &values::CameraView) -> Self {
        Self {
            look: value.look().clone(),
            target: value.target().copied().map(point3d_view),
            distance: value.distance().cloned(),
            projection: value.projection(),
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct NamedValueView {
    artifact_id: crate::execution::ArtifactId,
    name: String,
    camera: CameraValueView,
    baseline: values::Visibility,
    except_ids: Vec<crate::execution::ArtifactId>,
}
impl From<&values::NamedViewValue> for NamedValueView {
    fn from(value: &values::NamedViewValue) -> Self {
        Self {
            artifact_id: value.artifact_id(),
            name: value.name().to_owned(),
            camera: value.camera().into(),
            baseline: value.baseline(),
            except_ids: value.except_ids().to_vec(),
        }
    }
}

#[derive(Serialize)]
pub(crate) struct SegmentValueView {
    repr: SegmentReprView,
}
#[derive(Serialize)]
enum SegmentReprView {
    Unsolved { segment: UnsolvedSegmentView },
    Solved { segment: SolvedSegmentView },
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct UnsolvedSegmentView {
    id: uuid::Uuid,
    object_id: kcl_api::ObjectId,
    kind: runtime::UnsolvedSegmentKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    tag: Option<TagIdentifierView>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SolvedSegmentView {
    id: uuid::Uuid,
    object_id: kcl_api::ObjectId,
    kind: runtime::SegmentKind,
    surface: SurfaceView,
    sketch_id: uuid::Uuid,
    #[serde(skip_serializing_if = "Option::is_none")]
    tag: Option<TagIdentifierView>,
}

struct SurfaceView(SketchSurfaceView);
impl Serialize for SurfaceView {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        // Plane's historical flattened representation is a map, whereas Face
        // is a struct. Preserve that distinction in sorted debug snapshots.
        if let SketchSurfaceView::Plane(plane) = &self.0 {
            #[derive(Serialize)]
            struct PlaneSurface<'a> {
                #[serde(rename = "type")]
                kind: &'static str,
                #[serde(flatten)]
                plane: &'a PlaneView,
            }
            PlaneSurface { kind: "plane", plane }.serialize(serializer)
        } else {
            self.0.serialize(serializer)
        }
    }
}
impl From<runtime::AbstractSegment> for SegmentValueView {
    fn from(value: runtime::AbstractSegment) -> Self {
        let repr = match value.repr {
            runtime::SegmentRepr::Unsolved { segment } => SegmentReprView::Unsolved {
                segment: UnsolvedSegmentView {
                    id: segment.id,
                    object_id: segment.object_id,
                    kind: segment.kind,
                    tag: segment.tag.map(tag_identifier_view),
                },
            },
            runtime::SegmentRepr::Solved { segment } => SegmentReprView::Solved {
                segment: SolvedSegmentView {
                    id: segment.id,
                    object_id: segment.object_id,
                    kind: segment.kind,
                    surface: SurfaceView(sketch_surface_view(segment.surface)),
                    sketch_id: segment.sketch_id,
                    tag: segment.tag.map(tag_identifier_view),
                },
            },
        };
        Self { repr }
    }
}
