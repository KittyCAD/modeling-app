//! Lossless view values retained in interpreter memory.

use serde::Deserialize;

use super::*;
use crate::execution::memory_snapshot as snapshot;

#[derive(Serialize, Deserialize)]
#[serde(remote = "Orientation")]
enum OrientationSnapshot {
    Front,
    Back,
    Left,
    Right,
    Top,
    Bottom,
    Isometric,
}
snapshot::snapshot_type!(Orientation, OrientationSnapshot);

#[derive(Serialize, Deserialize)]
#[serde(remote = "Projection")]
enum ProjectionSnapshot {
    Orthographic,
    Perspective,
}
snapshot::snapshot_type!(Projection, ProjectionSnapshot);

#[derive(Serialize, Deserialize)]
#[serde(remote = "Visibility")]
enum VisibilitySnapshot {
    Show,
    Hide,
}
snapshot::snapshot_type!(Visibility, VisibilitySnapshot);

#[derive(Serialize, Deserialize)]
#[serde(remote = "CameraLook")]
#[allow(clippy::large_enum_variant)]
enum CameraLookSnapshot {
    Oriented {
        #[serde(with = "snapshot")]
        orientation: Orientation,
    },
    Directed {
        #[serde(with = "snapshot")]
        direction: Point3d,
        #[serde(with = "snapshot")]
        up: Point3d,
    },
}
snapshot::snapshot_type!(CameraLook, CameraLookSnapshot);

#[derive(Serialize, Deserialize)]
#[serde(remote = "CameraView")]
struct CameraViewSnapshot {
    #[serde(with = "snapshot")]
    look: CameraLook,
    #[serde(with = "snapshot")]
    target: Option<Point3d>,
    distance: Option<TyF64>,
    #[serde(with = "snapshot")]
    projection: Projection,
    meta: Vec<Metadata>,
}
snapshot::snapshot_type!(CameraView, CameraViewSnapshot);

#[derive(Serialize, Deserialize)]
#[serde(remote = "NamedViewValue")]
struct NamedViewValueSnapshot {
    artifact_id: ArtifactId,
    name: String,
    #[serde(with = "snapshot")]
    camera: CameraView,
    #[serde(with = "snapshot")]
    baseline: Visibility,
    except_ids: Vec<ArtifactId>,
    meta: Vec<Metadata>,
}
snapshot::snapshot_type!(NamedViewValue, NamedViewValueSnapshot);
