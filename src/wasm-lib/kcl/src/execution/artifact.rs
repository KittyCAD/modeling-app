use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::SourceRange;

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq, Hash, ts_rs::TS, JsonSchema)]
#[ts(export)]
pub struct ArtifactId(Uuid);

impl ArtifactId {
    pub fn new(uuid: Uuid) -> Self {
        Self(uuid)
    }
}

impl From<Uuid> for ArtifactId {
    fn from(uuid: Uuid) -> Self {
        Self::new(uuid)
    }
}

impl From<&Uuid> for ArtifactId {
    fn from(uuid: &Uuid) -> Self {
        Self::new(*uuid)
    }
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct Artifact {
    pub id: ArtifactId,
    #[serde(flatten)]
    pub inner: ArtifactInner,
    pub source_range: SourceRange,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(tag = "type")]
pub enum ArtifactInner {
    #[serde(rename_all = "camelCase")]
    StartSketchOnFace { face_id: Uuid },
    #[serde(rename_all = "camelCase")]
    StartSketchOnPlane { plane_id: Uuid },
}
