use schemars::JsonSchema;
use serde::Deserialize;
use serde::Serialize;

use crate::UnitAngle;
use crate::UnitLength;

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(tag = "type")]
pub enum UnitType {
    Count,
    Length(UnitLength),
    GenericLength,
    Angle(UnitAngle),
    GenericAngle,
    /// A unit produced by arithmetic over concrete length and angle values.
    ///
    /// Base dimensions keep their existing variants for wire compatibility.
    /// This variant is used only when the result cannot be represented as a
    /// count, a single length, or a single angle.
    Dimensional {
        length_unit: UnitLength,
        length_exponent: i8,
        angle_unit: UnitAngle,
        angle_exponent: i8,
    },
}

impl UnitType {
    pub fn to_suffix(self) -> Option<String> {
        match self {
            UnitType::Count => Some("_".to_owned()),
            UnitType::GenericLength | UnitType::GenericAngle => None,
            UnitType::Length(l) => Some(l.to_string()),
            UnitType::Angle(a) => Some(a.to_string()),
            UnitType::Dimensional { .. } => None,
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
            UnitType::Dimensional {
                length_unit,
                length_exponent,
                angle_unit,
                angle_exponent,
            } => {
                let mut wrote_dimension = false;
                if *length_exponent != 0 {
                    write_dimension(f, length_unit, *length_exponent)?;
                    wrote_dimension = true;
                }
                if *angle_exponent != 0 {
                    if wrote_dimension {
                        write!(f, " * ")?;
                    }
                    write_dimension(f, angle_unit, *angle_exponent)?;
                    wrote_dimension = true;
                }
                if !wrote_dimension {
                    write!(f, "Count")?;
                }
                Ok(())
            }
        }
    }
}

fn write_dimension<T: std::fmt::Display>(f: &mut std::fmt::Formatter<'_>, unit: &T, exponent: i8) -> std::fmt::Result {
    if exponent == 1 {
        unit.fmt(f)
    } else {
        write!(f, "{unit}^{exponent}")
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, ts_rs::TS, JsonSchema)]
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

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn dimensional_unit_display_and_serialization_are_stable() {
        let area = UnitType::Dimensional {
            length_unit: UnitLength::Millimeters,
            length_exponent: 2,
            angle_unit: UnitAngle::Degrees,
            angle_exponent: 0,
        };
        assert_eq!(area.to_string(), "mm^2");
        assert_eq!(area.to_suffix(), None);
        assert_eq!(
            serde_json::to_value(area).unwrap(),
            json!({
                "type": "Dimensional",
                "length_unit": "mm",
                "length_exponent": 2,
                "angle_unit": "degrees",
                "angle_exponent": 0,
            })
        );

        let angular_rate = UnitType::Dimensional {
            length_unit: UnitLength::Centimeters,
            length_exponent: -1,
            angle_unit: UnitAngle::Radians,
            angle_exponent: 1,
        };
        assert_eq!(angular_rate.to_string(), "cm^-1 * rad");
    }
}
