use schemars::JsonSchema;
use serde::Deserialize;
use serde::Serialize;

/// There's six standard planes (XY/XZ/YZ, and their negations).
/// They get created by the engine, and the engine needs to tell
/// clients what each plane's ID is.
#[derive(Debug, Default, Clone, Deserialize, Serialize, JsonSchema, PartialEq, ts_rs::TS)]
#[cfg_attr(feature = "arbitrary", derive(arbitrary::Arbitrary))]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct DefaultPlanes {
    pub xy: uuid::Uuid,
    pub xz: uuid::Uuid,
    pub yz: uuid::Uuid,
    pub neg_xy: uuid::Uuid,
    pub neg_xz: uuid::Uuid,
    pub neg_yz: uuid::Uuid,
}
