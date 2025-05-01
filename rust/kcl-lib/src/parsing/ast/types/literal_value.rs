use std::{fmt, str::FromStr};

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use super::Node;
use crate::parsing::{
    ast::types::{Expr, Literal},
    token::NumericSuffix,
};

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(untagged, rename_all = "snake_case")]
pub enum LiteralValue {
    Number { value: f64, suffix: NumericSuffix },
    String(String),
    Bool(bool),
}

impl LiteralValue {
    pub fn from_f64_no_uom(value: f64) -> Self {
        LiteralValue::Number {
            value,
            suffix: NumericSuffix::None,
        }
    }

    pub fn string_value(&self) -> Option<&str> {
        match self {
            Self::String(s) => Some(s),
            _ => None,
        }
    }

    pub fn is_color(&self) -> Option<csscolorparser::Color> {
        if let Self::String(s) = self {
            // Check if the string is a color.
            if s.starts_with('#') && s.len() == 7 {
                let Ok(c) = csscolorparser::Color::from_str(s) else {
                    return None;
                };

                return Some(c);
            }
        }

        None
    }
}

impl fmt::Display for LiteralValue {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            LiteralValue::Number { value, suffix } => {
                let int_value = *value as u64;
                if int_value as f64 == *value {
                    write!(f, "{int_value}")?;
                } else {
                    write!(f, "{value}")?;
                }
                if *suffix != NumericSuffix::None {
                    write!(f, "{suffix}")?;
                }
                Ok(())
            }
            LiteralValue::String(s) => write!(f, "\"{s}\""),
            LiteralValue::Bool(b) => write!(f, "{b}"),
        }
    }
}

impl From<Node<Literal>> for Expr {
    fn from(literal: Node<Literal>) -> Self {
        Expr::Literal(Box::new(literal))
    }
}

impl From<String> for LiteralValue {
    fn from(value: String) -> Self {
        Self::String(value)
    }
}

impl From<&'static str> for LiteralValue {
    fn from(value: &'static str) -> Self {
        // TODO: Make this Cow<str>
        Self::String(value.to_owned())
    }
}

impl From<bool> for LiteralValue {
    fn from(value: bool) -> Self {
        Self::Bool(value)
    }
}
