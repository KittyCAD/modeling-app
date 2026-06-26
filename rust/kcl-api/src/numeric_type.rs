use serde::Deserialize;
use serde::Serialize;

use crate::UnitAngle;
use crate::UnitLength;

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq, ts_rs::TS)]
#[ts(export)]
#[serde(tag = "type")]
pub enum UnitType {
    Count,
    Length(UnitLength),
    GenericLength,
    Angle(UnitAngle),
    GenericAngle,
}

impl UnitType {
    pub fn to_suffix(self) -> Option<String> {
        match self {
            UnitType::Count => Some("_".to_owned()),
            UnitType::GenericLength | UnitType::GenericAngle => None,
            UnitType::Length(l) => Some(l.to_string()),
            UnitType::Angle(a) => Some(a.to_string()),
        }
    }

    pub fn degrees() -> Self {
        Self::Angle(UnitAngle::Degrees)
    }

    pub fn radians() -> Self {
        Self::Angle(UnitAngle::Radians)
    }
}

impl std::fmt::Display for UnitType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            UnitType::Count => write!(f, "Count"),
            UnitType::Length(l) => l.fmt(f),
            UnitType::GenericLength => write!(f, "Length"),
            UnitType::Angle(a) => a.fmt(f),
            UnitType::GenericAngle => write!(f, "Angle"),
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, ts_rs::TS)]
#[ts(export)]
#[serde(tag = "type")]
pub enum NumericType {
    // Specified by the user (directly or indirectly)
    Known(UnitType),
    // Unspecified, using defaults
    Default { len: UnitLength, angle: UnitAngle },
    // Exceeded the ability of the type system to track.
    Unknown,
    // Type info has been explicitly cast away.
    Any,
}

impl Default for NumericType {
    fn default() -> Self {
        NumericType::Default {
            len: UnitLength::Millimeters,
            angle: UnitAngle::Degrees,
        }
    }
}
