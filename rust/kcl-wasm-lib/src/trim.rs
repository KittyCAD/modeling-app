//! Trim tool logic - WASM bindings
//!
//! This module provides WASM-specific types for trim operations.
//! Only `Coords2d` needs serialization (for input from TypeScript).
//! All other types are used directly from kcl-lib core types.

use kcl_lib::front::Coords2d as Coords2dCore;
#[cfg(target_arch = "wasm32")]
use serde::Deserialize;

/// 2D coordinates with WASM deserialization support for input from TypeScript
#[derive(Debug, Clone, Copy)]
pub struct Coords2d {
    pub x: f64,
    pub y: f64,
}

// Conversion functions between WASM Coords2d and core Coords2d
impl From<Coords2dCore> for Coords2d {
    fn from(c: Coords2dCore) -> Self {
        Coords2d { x: c.x, y: c.y }
    }
}

impl From<Coords2d> for Coords2dCore {
    fn from(c: Coords2d) -> Self {
        Coords2dCore { x: c.x, y: c.y }
    }
}

// Manual serde implementation for Coords2d to deserialize from [x, y] array
// This matches TypeScript's Coords2d type which is [number, number]
#[cfg(target_arch = "wasm32")]
impl<'de> Deserialize<'de> for Coords2d {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        struct Coords2dVisitor;

        impl<'de> serde::de::Visitor<'de> for Coords2dVisitor {
            type Value = Coords2d;

            fn expecting(&self, formatter: &mut std::fmt::Formatter) -> std::fmt::Result {
                formatter.write_str("a 2-element array [x, y]")
            }

            fn visit_seq<A>(self, mut seq: A) -> Result<Self::Value, A::Error>
            where
                A: serde::de::SeqAccess<'de>,
            {
                let x = seq
                    .next_element()?
                    .ok_or_else(|| serde::de::Error::invalid_length(0, &self))?;
                let y = seq
                    .next_element()?
                    .ok_or_else(|| serde::de::Error::invalid_length(1, &self))?;
                Ok(Coords2d { x, y })
            }
        }

        deserializer.deserialize_tuple(2, Coords2dVisitor)
    }
}
