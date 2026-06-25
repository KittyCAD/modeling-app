use parse_display_derive::Display;
use parse_display_derive::FromStr;
use schemars::JsonSchema;
use serde::Deserialize;
use serde::Serialize;
use ts_rs::TS;

/// The valid types of length units.
#[derive(
    Default,
    Display,
    FromStr,
    Copy,
    Eq,
    PartialEq,
    Debug,
    JsonSchema,
    Deserialize,
    Serialize,
    Clone,
    Ord,
    PartialOrd,
    Hash,
    TS,
)]
#[cfg_attr(
    feature = "pyo3",
    pyo3::pyclass(eq, from_py_object),
    pyo3_stub_gen::derive::gen_stub_pyclass_enum
)]
pub enum UnitLength {
    /// Centimeters <https://en.wikipedia.org/wiki/Centimeter>
    #[serde(rename = "cm")]
    #[display("cm")]
    Centimeters,
    /// Feet <https://en.wikipedia.org/wiki/Foot_(unit)>
    #[serde(rename = "ft")]
    #[display("ft")]
    Feet,
    /// Inches <https://en.wikipedia.org/wiki/Inch>
    #[serde(rename = "in")]
    #[display("in")]
    Inches,
    /// Meters <https://en.wikipedia.org/wiki/Meter>
    #[default]
    #[serde(rename = "m")]
    #[display("m")]
    Meters,
    /// Millimeters <https://en.wikipedia.org/wiki/Millimeter>
    #[serde(rename = "mm")]
    #[display("mm")]
    Millimeters,
    /// Yards <https://en.wikipedia.org/wiki/Yard>
    #[serde(rename = "yd")]
    #[display("yd")]
    Yards,
}

/// The valid types of angle formats.
#[derive(
    Default,
    Display,
    FromStr,
    Copy,
    Eq,
    PartialEq,
    Debug,
    JsonSchema,
    Deserialize,
    Serialize,
    Clone,
    Ord,
    PartialOrd,
    Hash,
    TS,
)]
#[serde(rename_all = "snake_case")]
#[display(style = "snake_case")]
#[cfg_attr(
    feature = "pyo3",
    pyo3::pyclass(eq, from_py_object),
    pyo3_stub_gen::derive::gen_stub_pyclass_enum
)]
pub enum UnitAngle {
    /// Degrees <https://en.wikipedia.org/wiki/Degree_(angle)>
    #[default]
    #[display("deg")]
    Degrees,
    /// Radians <https://en.wikipedia.org/wiki/Radian>
    #[display("rad")]
    Radians,
}

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
