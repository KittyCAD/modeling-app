use serde::Deserialize;
use serde::Serialize;

#[derive(Debug, Clone, Copy, Hash, Eq, PartialEq, PartialOrd, Ord, Deserialize, Serialize, ts_rs::TS)]
#[ts(export, export_to = "FrontendApi.ts", rename = "ApiObjectId")]
pub struct ObjectId(pub usize);

impl ObjectId {
    pub fn predecessor(self) -> Option<Self> {
        self.0.checked_sub(1).map(ObjectId)
    }
}
