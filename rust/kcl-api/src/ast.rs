use parse_display::Display;
use parse_display::FromStr;
use serde::Deserialize;
use serde::Serialize;

pub mod node_path;

#[derive(Debug, Default, Clone, Copy, Deserialize, Serialize, PartialEq, ts_rs::TS, FromStr, Display)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
#[display(style = "snake_case")]
pub enum ItemVisibility {
    #[default]
    Default,
    Export,
}

impl ItemVisibility {
    pub fn is_default(&self) -> bool {
        matches!(self, Self::Default)
    }
}
