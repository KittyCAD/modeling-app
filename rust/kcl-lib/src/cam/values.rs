use crate::execution::Metadata;
use serde::Serialize;

#[derive(Debug, Clone, Serialize, PartialEq, ts_rs::TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub enum Unit {
    millimeter,
    inches,
}

#[derive(Debug, Clone, Serialize, PartialEq, ts_rs::TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct Program {
    pub name: String,
    pub number: usize,
    pub unit: Unit,
    #[serde(skip)]
    pub meta: Vec<Metadata>,
}

impl Program {
    /// The source metadata of the constructing call.
    pub fn meta(&self) -> &[Metadata] {
        &self.meta
    }
}

#[derive(Debug, Clone, Serialize, PartialEq, ts_rs::TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct Setup {
    name: String,
}
