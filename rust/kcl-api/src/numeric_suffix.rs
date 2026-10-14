use core::fmt;
use std::str::FromStr;

use kcl_error::{CompilationIssue, SourceRange};
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize, ts_rs::TS)]
#[repr(u32)]
pub enum NumericSuffix {
    None,
    Count,
    Length,
    Angle,
    Mm,
    Cm,
    M,
    Inch,
    Ft,
    Yd,
    Deg,
    Rad,
    Unknown,
}

impl NumericSuffix {
    #[allow(dead_code)]
    pub fn is_none(self) -> bool {
        self == Self::None
    }

    pub fn is_some(self) -> bool {
        self != Self::None
    }

    pub fn digestable_id(&self) -> &[u8] {
        match self {
            NumericSuffix::None => &[],
            NumericSuffix::Count => b"_",
            NumericSuffix::Unknown => b"?",
            NumericSuffix::Length => b"Length",
            NumericSuffix::Angle => b"Angle",
            NumericSuffix::Mm => b"mm",
            NumericSuffix::Cm => b"cm",
            NumericSuffix::M => b"m",
            NumericSuffix::Inch => b"in",
            NumericSuffix::Ft => b"ft",
            NumericSuffix::Yd => b"yd",
            NumericSuffix::Deg => b"deg",
            NumericSuffix::Rad => b"rad",
        }
    }
}

impl FromStr for NumericSuffix {
    type Err = CompilationIssue;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "_" | "Count" => Ok(NumericSuffix::Count),
            "Length" => Ok(NumericSuffix::Length),
            "Angle" => Ok(NumericSuffix::Angle),
            "mm" | "millimeters" => Ok(NumericSuffix::Mm),
            "cm" | "centimeters" => Ok(NumericSuffix::Cm),
            "m" | "meters" => Ok(NumericSuffix::M),
            "inch" | "in" => Ok(NumericSuffix::Inch),
            "ft" | "feet" => Ok(NumericSuffix::Ft),
            "yd" | "yards" => Ok(NumericSuffix::Yd),
            "deg" | "degrees" => Ok(NumericSuffix::Deg),
            "rad" | "radians" => Ok(NumericSuffix::Rad),
            "?" => Ok(NumericSuffix::Unknown),
            _ => Err(CompilationIssue::err(SourceRange::default(), "invalid unit of measure")),
        }
    }
}

impl fmt::Display for NumericSuffix {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            NumericSuffix::None => Ok(()),
            NumericSuffix::Count => write!(f, "_"),
            NumericSuffix::Unknown => write!(f, "_?"),
            NumericSuffix::Length => write!(f, "Length"),
            NumericSuffix::Angle => write!(f, "Angle"),
            NumericSuffix::Mm => write!(f, "mm"),
            NumericSuffix::Cm => write!(f, "cm"),
            NumericSuffix::M => write!(f, "m"),
            NumericSuffix::Inch => write!(f, "in"),
            NumericSuffix::Ft => write!(f, "ft"),
            NumericSuffix::Yd => write!(f, "yd"),
            NumericSuffix::Deg => write!(f, "deg"),
            NumericSuffix::Rad => write!(f, "rad"),
        }
    }
}
