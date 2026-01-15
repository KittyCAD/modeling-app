//! Trim tool logic - WASM bindings
//!
//! This module provides WASM-specific serialization and re-exports core trim logic from kcl-lib.

#[cfg(target_arch = "wasm32")]
use gloo_utils::format::JsValueSerdeExt;
// Import core types and functions from kcl-lib
use kcl_lib::front::{
    get_next_trim_coords, get_position_coords_for_line, get_position_coords_from_arc, get_trim_spawn_terminations,
    trim_strategy, ConstraintToMigrate as ConstraintToMigrateCore, Coords2d as Coords2dCore,
    NextTrimResult as NextTrimResultCore, Object, TrimOperation as TrimOperationCore,
    TrimTermination as TrimTerminationCore, TrimTerminations as TrimTerminationsCore,
};
#[cfg(target_arch = "wasm32")]
use serde::{Deserialize, Serialize};
#[cfg(target_arch = "wasm32")]
use wasm_bindgen::{prelude::*, JsValue};

/// 2D coordinates with WASM serialization support
/// This is a wrapper around the core Coords2d that adds serde support for WASM
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

// Manual serde implementation for Coords2d to serialize as [x, y] array
// This matches TypeScript's Coords2d type which is [number, number]
#[cfg(target_arch = "wasm32")]
impl Serialize for Coords2d {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeTuple;
        let mut tuple = serializer.serialize_tuple(2)?;
        tuple.serialize_element(&self.x)?;
        tuple.serialize_element(&self.y)?;
        tuple.end()
    }
}

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

// Wrapper types for WASM serialization
// These wrap the kcl-lib types and implement Serialize/Deserialize

// A trim spawn is the intersection point of the trim line (drawn by the user) and a segment.
// We travel in both directions along the segment from the trim spawn to determine how to implement the trim.

/// Result of finding the next trim spawn (intersection) - WASM version
#[derive(Debug, Clone)]
pub enum NextTrimResult {
    TrimSpawn {
        trim_spawn_seg_id: usize,
        trim_spawn_coords: Coords2d,
        next_index: usize,
    },
    NoTrimSpawn {
        next_index: usize,
    },
}

impl From<NextTrimResultCore> for NextTrimResult {
    fn from(r: NextTrimResultCore) -> Self {
        match r {
            NextTrimResultCore::TrimSpawn {
                trim_spawn_seg_id,
                trim_spawn_coords,
                next_index,
            } => NextTrimResult::TrimSpawn {
                trim_spawn_seg_id,
                trim_spawn_coords: trim_spawn_coords.into(),
                next_index,
            },
            NextTrimResultCore::NoTrimSpawn { next_index } => NextTrimResult::NoTrimSpawn { next_index },
        }
    }
}

#[cfg(target_arch = "wasm32")]
impl Serialize for NextTrimResult {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        match self {
            NextTrimResult::TrimSpawn {
                trim_spawn_seg_id,
                trim_spawn_coords,
                next_index,
            } => {
                let mut state = serializer.serialize_struct("TrimSpawn", 4)?;
                state.serialize_field("type", "trimSpawn")?;
                state.serialize_field("trimSpawnSegId", trim_spawn_seg_id)?;
                state.serialize_field("trimSpawnCoords", trim_spawn_coords)?;
                state.serialize_field("nextIndex", next_index)?;
                state.end()
            }
            NextTrimResult::NoTrimSpawn { next_index } => {
                let mut state = serializer.serialize_struct("NoTrimSpawn", 2)?;
                state.serialize_field("type", "noTrimSpawn")?;
                state.serialize_field("nextIndex", next_index)?;
                state.end()
            }
        }
    }
}

#[cfg(target_arch = "wasm32")]
impl<'de> Deserialize<'de> for NextTrimResult {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        use std::fmt;

        use serde::de::{self, MapAccess, Visitor};

        struct NextTrimResultVisitor;

        impl<'de> Visitor<'de> for NextTrimResultVisitor {
            type Value = NextTrimResult;

            fn expecting(&self, formatter: &mut fmt::Formatter) -> fmt::Result {
                formatter.write_str("NextTrimResult")
            }

            fn visit_map<A>(self, mut map: A) -> Result<Self::Value, A::Error>
            where
                A: MapAccess<'de>,
            {
                let mut type_str = None;
                let mut trim_spawn_seg_id = None;
                let mut trim_spawn_coords = None;
                let mut next_index = None;

                while let Some(key) = map.next_key::<String>()? {
                    match key.as_str() {
                        "type" => {
                            type_str = Some(map.next_value()?);
                        }
                        "trimSpawnSegId" => {
                            trim_spawn_seg_id = Some(map.next_value()?);
                        }
                        "trimSpawnCoords" => {
                            trim_spawn_coords = Some(map.next_value::<Coords2d>()?);
                        }
                        "nextIndex" => {
                            next_index = Some(map.next_value()?);
                        }
                        _ => {
                            let _ = map.next_value::<de::IgnoredAny>()?;
                        }
                    }
                }

                let type_str = type_str.ok_or_else(|| de::Error::missing_field("type"))?;
                let next_index = next_index.ok_or_else(|| de::Error::missing_field("nextIndex"))?;

                match type_str {
                    "trimSpawn" => {
                        let trim_spawn_seg_id =
                            trim_spawn_seg_id.ok_or_else(|| de::Error::missing_field("trimSpawnSegId"))?;
                        let trim_spawn_coords =
                            trim_spawn_coords.ok_or_else(|| de::Error::missing_field("trimSpawnCoords"))?;
                        Ok(NextTrimResult::TrimSpawn {
                            trim_spawn_seg_id,
                            trim_spawn_coords,
                            next_index,
                        })
                    }
                    "noTrimSpawn" => Ok(NextTrimResult::NoTrimSpawn { next_index }),
                    _ => Err(de::Error::unknown_variant(type_str, &["trimSpawn", "noTrimSpawn"])),
                }
            }
        }

        deserializer.deserialize_map(NextTrimResultVisitor)
    }
}

/// Trim termination types - WASM version
///
/// Trim termination is the term used to figure out each end of a segment after a trim spawn has been found.
/// When a trim spawn is found, we travel in both directions to find this termination. It can be:
/// (1) the end of a segment (floating end), (2) an intersection with another segment, or
/// (3) a coincident point where another segment is coincident with the segment we're traveling along.
#[derive(Debug, Clone)]
pub enum TrimTermination {
    SegEndPoint {
        trim_termination_coords: Coords2d,
    },
    Intersection {
        trim_termination_coords: Coords2d,
        intersecting_seg_id: usize,
    },
    TrimSpawnSegmentCoincidentWithAnotherSegmentPoint {
        trim_termination_coords: Coords2d,
        intersecting_seg_id: usize,
        trim_spawn_segment_coincident_with_another_segment_point_id: usize,
    },
}

impl From<TrimTerminationCore> for TrimTermination {
    fn from(t: TrimTerminationCore) -> Self {
        match t {
            TrimTerminationCore::SegEndPoint {
                trim_termination_coords,
            } => TrimTermination::SegEndPoint {
                trim_termination_coords: trim_termination_coords.into(),
            },
            TrimTerminationCore::Intersection {
                trim_termination_coords,
                intersecting_seg_id,
            } => TrimTermination::Intersection {
                trim_termination_coords: trim_termination_coords.into(),
                intersecting_seg_id,
            },
            TrimTerminationCore::TrimSpawnSegmentCoincidentWithAnotherSegmentPoint {
                trim_termination_coords,
                intersecting_seg_id,
                trim_spawn_segment_coincident_with_another_segment_point_id,
            } => TrimTermination::TrimSpawnSegmentCoincidentWithAnotherSegmentPoint {
                trim_termination_coords: trim_termination_coords.into(),
                intersecting_seg_id,
                trim_spawn_segment_coincident_with_another_segment_point_id,
            },
        }
    }
}

#[cfg(target_arch = "wasm32")]
impl Serialize for TrimTermination {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        match self {
            TrimTermination::SegEndPoint {
                trim_termination_coords,
            } => {
                let mut state = serializer.serialize_struct("SegEndPoint", 2)?;
                state.serialize_field("type", "segEndPoint")?;
                state.serialize_field("trimTerminationCoords", trim_termination_coords)?;
                state.end()
            }
            TrimTermination::Intersection {
                trim_termination_coords,
                intersecting_seg_id,
            } => {
                let mut state = serializer.serialize_struct("Intersection", 3)?;
                state.serialize_field("type", "intersection")?;
                state.serialize_field("trimTerminationCoords", trim_termination_coords)?;
                state.serialize_field("intersectingSegId", intersecting_seg_id)?;
                state.end()
            }
            TrimTermination::TrimSpawnSegmentCoincidentWithAnotherSegmentPoint {
                trim_termination_coords,
                intersecting_seg_id,
                trim_spawn_segment_coincident_with_another_segment_point_id,
            } => {
                let mut state = serializer.serialize_struct("TrimSpawnSegmentCoincidentWithAnotherSegmentPoint", 4)?;
                state.serialize_field("type", "trimSpawnSegmentCoincidentWithAnotherSegmentPoint")?;
                state.serialize_field("trimTerminationCoords", trim_termination_coords)?;
                state.serialize_field("intersectingSegId", intersecting_seg_id)?;
                state.serialize_field(
                    "trimSpawnSegmentCoincidentWithAnotherSegmentPointId",
                    trim_spawn_segment_coincident_with_another_segment_point_id,
                )?;
                state.end()
            }
        }
    }
}

#[cfg(target_arch = "wasm32")]
impl<'de> Deserialize<'de> for TrimTermination {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        use std::fmt;

        use serde::de::{self, MapAccess, Visitor};

        struct TrimTerminationVisitor;

        impl<'de> Visitor<'de> for TrimTerminationVisitor {
            type Value = TrimTermination;

            fn expecting(&self, formatter: &mut fmt::Formatter) -> fmt::Result {
                formatter.write_str("TrimTermination")
            }

            fn visit_map<A>(self, mut map: A) -> Result<Self::Value, A::Error>
            where
                A: MapAccess<'de>,
            {
                let mut type_str = None;
                let mut trim_termination_coords = None;
                let mut intersecting_seg_id = None;
                let mut trim_spawn_segment_coincident_with_another_segment_point_id = None;

                while let Some(key) = map.next_key::<String>()? {
                    match key.as_str() {
                        "type" => {
                            type_str = Some(map.next_value()?);
                        }
                        "trimTerminationCoords" => {
                            trim_termination_coords = Some(map.next_value::<Coords2d>()?);
                        }
                        "intersectingSegId" => {
                            intersecting_seg_id = Some(map.next_value()?);
                        }
                        "trimSpawnSegmentCoincidentWithAnotherSegmentPointId" => {
                            trim_spawn_segment_coincident_with_another_segment_point_id = Some(map.next_value()?);
                        }
                        _ => {
                            let _ = map.next_value::<de::IgnoredAny>()?;
                        }
                    }
                }

                let type_str = type_str.ok_or_else(|| de::Error::missing_field("type"))?;

                match type_str {
                    "segEndPoint" => {
                        let trim_termination_coords =
                            trim_termination_coords.ok_or_else(|| de::Error::missing_field("trimTerminationCoords"))?;
                        Ok(TrimTermination::SegEndPoint {
                            trim_termination_coords,
                        })
                    }
                    "intersection" => {
                        let trim_termination_coords =
                            trim_termination_coords.ok_or_else(|| de::Error::missing_field("trimTerminationCoords"))?;
                        let intersecting_seg_id =
                            intersecting_seg_id.ok_or_else(|| de::Error::missing_field("intersectingSegId"))?;
                        Ok(TrimTermination::Intersection {
                            trim_termination_coords,
                            intersecting_seg_id,
                        })
                    }
                    "trimSpawnSegmentCoincidentWithAnotherSegmentPoint" => {
                        let trim_termination_coords =
                            trim_termination_coords.ok_or_else(|| de::Error::missing_field("trimTerminationCoords"))?;
                        let intersecting_seg_id =
                            intersecting_seg_id.ok_or_else(|| de::Error::missing_field("intersectingSegId"))?;
                        let trim_spawn_segment_coincident_with_another_segment_point_id =
                            trim_spawn_segment_coincident_with_another_segment_point_id.ok_or_else(|| {
                                de::Error::missing_field("trimSpawnSegmentCoincidentWithAnotherSegmentPointId")
                            })?;
                        Ok(TrimTermination::TrimSpawnSegmentCoincidentWithAnotherSegmentPoint {
                            trim_termination_coords,
                            intersecting_seg_id,
                            trim_spawn_segment_coincident_with_another_segment_point_id,
                        })
                    }
                    _ => Err(de::Error::unknown_variant(
                        type_str,
                        &[
                            "segEndPoint",
                            "intersection",
                            "trimSpawnSegmentCoincidentWithAnotherSegmentPoint",
                        ],
                    )),
                }
            }
        }

        deserializer.deserialize_map(TrimTerminationVisitor)
    }
}

/// Trim terminations for both sides - WASM version
#[derive(Debug, Clone)]
pub struct TrimTerminations {
    pub left_side: TrimTermination,
    pub right_side: TrimTermination,
}

impl From<TrimTerminationsCore> for TrimTerminations {
    fn from(t: TrimTerminationsCore) -> Self {
        TrimTerminations {
            left_side: t.left_side.into(),
            right_side: t.right_side.into(),
        }
    }
}

#[cfg(target_arch = "wasm32")]
impl Serialize for TrimTerminations {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut state = serializer.serialize_struct("TrimTerminations", 2)?;
        state.serialize_field("leftSide", &self.left_side)?;
        state.serialize_field("rightSide", &self.right_side)?;
        state.end()
    }
}

#[cfg(target_arch = "wasm32")]
impl<'de> Deserialize<'de> for TrimTerminations {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        use std::fmt;

        use serde::de::{self, MapAccess, Visitor};

        struct TrimTerminationsVisitor;

        impl<'de> Visitor<'de> for TrimTerminationsVisitor {
            type Value = TrimTerminations;

            fn expecting(&self, formatter: &mut fmt::Formatter) -> fmt::Result {
                formatter.write_str("TrimTerminations")
            }

            fn visit_map<A>(self, mut map: A) -> Result<Self::Value, A::Error>
            where
                A: MapAccess<'de>,
            {
                let mut left_side = None;
                let mut right_side = None;

                while let Some(key) = map.next_key::<String>()? {
                    match key.as_str() {
                        "leftSide" => {
                            left_side = Some(map.next_value()?);
                        }
                        "rightSide" => {
                            right_side = Some(map.next_value()?);
                        }
                        _ => {
                            let _ = map.next_value::<de::IgnoredAny>()?;
                        }
                    }
                }

                let left_side = left_side.ok_or_else(|| de::Error::missing_field("leftSide"))?;
                let right_side = right_side.ok_or_else(|| de::Error::missing_field("rightSide"))?;

                Ok(TrimTerminations { left_side, right_side })
            }
        }

        deserializer.deserialize_map(TrimTerminationsVisitor)
    }
}

/// Trim operation types - WASM version
#[derive(Debug, Clone)]
pub enum TrimOperation {
    SimpleTrim {
        segment_to_trim_id: usize,
    },
    EditSegment {
        segment_id: usize,
        ctor: serde_json::Value,  // SegmentCtor as JSON
        endpoint_changed: String, // "start" or "end"
    },
    AddCoincidentConstraint {
        segment_id: usize,
        endpoint_changed: String,
        segment_or_point_to_make_coincident_to: usize,
        intersecting_endpoint_point_id: Option<usize>,
    },
    SplitSegment {
        segment_id: usize,
        left_trim_coords: Coords2d,
        right_trim_coords: Coords2d,
        original_end_coords: Coords2d,
        left_side: TrimTermination,
        right_side: TrimTermination,
        left_side_coincident_data: serde_json::Value, // Complex nested structure
        right_side_coincident_data: serde_json::Value,
        constraints_to_migrate: Vec<ConstraintToMigrate>,
        constraints_to_delete: Vec<usize>,
    },
    DeleteConstraints {
        constraint_ids: Vec<usize>,
    },
}

impl From<TrimOperationCore> for TrimOperation {
    fn from(op: TrimOperationCore) -> Self {
        match op {
            TrimOperationCore::SimpleTrim { segment_to_trim_id } => TrimOperation::SimpleTrim { segment_to_trim_id },
            TrimOperationCore::EditSegment {
                segment_id,
                ctor,
                endpoint_changed,
            } => TrimOperation::EditSegment {
                segment_id,
                ctor,
                endpoint_changed,
            },
            TrimOperationCore::AddCoincidentConstraint {
                segment_id,
                endpoint_changed,
                segment_or_point_to_make_coincident_to,
                intersecting_endpoint_point_id,
            } => TrimOperation::AddCoincidentConstraint {
                segment_id,
                endpoint_changed,
                segment_or_point_to_make_coincident_to,
                intersecting_endpoint_point_id,
            },
            TrimOperationCore::SplitSegment {
                segment_id,
                left_trim_coords,
                right_trim_coords,
                original_end_coords,
                left_side,
                right_side,
                left_side_coincident_data,
                right_side_coincident_data,
                constraints_to_migrate,
                constraints_to_delete,
            } => TrimOperation::SplitSegment {
                segment_id,
                left_trim_coords: left_trim_coords.into(),
                right_trim_coords: right_trim_coords.into(),
                original_end_coords: original_end_coords.into(),
                left_side: (*left_side).into(),
                right_side: (*right_side).into(),
                left_side_coincident_data: *left_side_coincident_data,
                right_side_coincident_data: *right_side_coincident_data,
                constraints_to_migrate: constraints_to_migrate
                    .into_iter()
                    .map(|c: ConstraintToMigrateCore| c.into())
                    .collect(),
                constraints_to_delete,
            },
            TrimOperationCore::DeleteConstraints { constraint_ids } => {
                TrimOperation::DeleteConstraints { constraint_ids }
            }
        }
    }
}

#[cfg(target_arch = "wasm32")]
impl Serialize for TrimOperation {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        match self {
            TrimOperation::SimpleTrim { segment_to_trim_id } => {
                let mut state = serializer.serialize_struct("SimpleTrim", 2)?;
                state.serialize_field("type", "simpleTrim")?;
                state.serialize_field("segmentToTrimId", segment_to_trim_id)?;
                state.end()
            }
            TrimOperation::EditSegment {
                segment_id,
                ctor,
                endpoint_changed,
            } => {
                let mut state = serializer.serialize_struct("EditSegment", 4)?;
                state.serialize_field("type", "editSegment")?;
                state.serialize_field("segmentId", segment_id)?;
                state.serialize_field("ctor", ctor)?;
                state.serialize_field("endpointChanged", endpoint_changed)?;
                state.end()
            }
            TrimOperation::AddCoincidentConstraint {
                segment_id,
                endpoint_changed,
                segment_or_point_to_make_coincident_to,
                intersecting_endpoint_point_id: _,
            } => {
                let mut state = serializer.serialize_struct("AddCoincidentConstraint", 4)?;
                state.serialize_field("type", "addCoincidentConstraint")?;
                state.serialize_field("segmentId", segment_id)?;
                state.serialize_field("endpointChanged", endpoint_changed)?;
                state.serialize_field(
                    "segmentOrPointToMakeCoincidentTo",
                    segment_or_point_to_make_coincident_to,
                )?;
                state.end()
            }
            TrimOperation::SplitSegment {
                segment_id,
                left_trim_coords,
                right_trim_coords,
                original_end_coords,
                left_side,
                right_side,
                left_side_coincident_data,
                right_side_coincident_data,
                constraints_to_migrate,
                constraints_to_delete,
            } => {
                let mut state = serializer.serialize_struct("SplitSegment", 11)?;
                state.serialize_field("type", "splitSegment")?;
                state.serialize_field("segmentId", segment_id)?;
                state.serialize_field("leftTrimCoords", left_trim_coords)?;
                state.serialize_field("rightTrimCoords", right_trim_coords)?;
                state.serialize_field("originalEndCoords", original_end_coords)?;
                state.serialize_field("leftSide", left_side)?;
                state.serialize_field("rightSide", right_side)?;
                state.serialize_field("leftSideCoincidentData", left_side_coincident_data)?;
                state.serialize_field("rightSideCoincidentData", right_side_coincident_data)?;
                state.serialize_field("constraintsToMigrate", constraints_to_migrate)?;
                state.serialize_field("constraintsToDelete", constraints_to_delete)?;
                state.end()
            }
            TrimOperation::DeleteConstraints { constraint_ids } => {
                let mut state = serializer.serialize_struct("DeleteConstraints", 2)?;
                state.serialize_field("type", "deleteConstraints")?;
                state.serialize_field("constraintIds", constraint_ids)?;
                state.end()
            }
        }
    }
}

#[cfg(target_arch = "wasm32")]
impl<'de> Deserialize<'de> for TrimOperation {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        use std::fmt;

        use serde::de::{self, MapAccess, Visitor};

        struct TrimOperationVisitor;

        impl<'de> Visitor<'de> for TrimOperationVisitor {
            type Value = TrimOperation;

            fn expecting(&self, formatter: &mut fmt::Formatter) -> fmt::Result {
                formatter.write_str("TrimOperation")
            }

            fn visit_map<A>(self, mut map: A) -> Result<Self::Value, A::Error>
            where
                A: MapAccess<'de>,
            {
                let mut type_str = None;
                let mut segment_to_trim_id = None;
                let mut segment_id = None;
                let mut ctor = None;
                let mut endpoint_changed = None;
                let mut segment_or_point_to_make_coincident_to = None;
                let mut left_trim_coords = None;
                let mut right_trim_coords = None;
                let mut original_end_coords = None;
                let mut left_side = None;
                let mut right_side = None;
                let mut left_side_coincident_data = None;
                let mut right_side_coincident_data = None;
                let mut constraints_to_migrate = None;
                let mut constraints_to_delete = None;
                let mut constraint_ids = None;

                while let Some(key) = map.next_key::<String>()? {
                    match key.as_str() {
                        "type" => {
                            type_str = Some(map.next_value()?);
                        }
                        "segmentToTrimId" => {
                            segment_to_trim_id = Some(map.next_value()?);
                        }
                        "segmentId" => {
                            segment_id = Some(map.next_value()?);
                        }
                        "ctor" => {
                            ctor = Some(map.next_value()?);
                        }
                        "endpointChanged" => {
                            endpoint_changed = Some(map.next_value()?);
                        }
                        "segmentOrPointToMakeCoincidentTo" => {
                            segment_or_point_to_make_coincident_to = Some(map.next_value()?);
                        }
                        "leftTrimCoords" => {
                            left_trim_coords = Some(map.next_value::<Coords2d>()?);
                        }
                        "rightTrimCoords" => {
                            right_trim_coords = Some(map.next_value::<Coords2d>()?);
                        }
                        "originalEndCoords" => {
                            original_end_coords = Some(map.next_value::<Coords2d>()?);
                        }
                        "leftSide" => {
                            left_side = Some(map.next_value()?);
                        }
                        "rightSide" => {
                            right_side = Some(map.next_value()?);
                        }
                        "leftSideCoincidentData" => {
                            left_side_coincident_data = Some(map.next_value()?);
                        }
                        "rightSideCoincidentData" => {
                            right_side_coincident_data = Some(map.next_value()?);
                        }
                        "constraintsToMigrate" => {
                            constraints_to_migrate = Some(map.next_value()?);
                        }
                        "constraintsToDelete" => {
                            constraints_to_delete = Some(map.next_value()?);
                        }
                        "constraintIds" => {
                            constraint_ids = Some(map.next_value()?);
                        }
                        _ => {
                            let _ = map.next_value::<de::IgnoredAny>()?;
                        }
                    }
                }

                let type_str = type_str.ok_or_else(|| de::Error::missing_field("type"))?;

                match type_str {
                    "simpleTrim" => {
                        let segment_to_trim_id =
                            segment_to_trim_id.ok_or_else(|| de::Error::missing_field("segmentToTrimId"))?;
                        Ok(TrimOperation::SimpleTrim { segment_to_trim_id })
                    }
                    "editSegment" => {
                        let segment_id = segment_id.ok_or_else(|| de::Error::missing_field("segmentId"))?;
                        let ctor = ctor.ok_or_else(|| de::Error::missing_field("ctor"))?;
                        let endpoint_changed =
                            endpoint_changed.ok_or_else(|| de::Error::missing_field("endpointChanged"))?;
                        Ok(TrimOperation::EditSegment {
                            segment_id,
                            ctor,
                            endpoint_changed,
                        })
                    }
                    "addCoincidentConstraint" => {
                        let segment_id = segment_id.ok_or_else(|| de::Error::missing_field("segmentId"))?;
                        let endpoint_changed =
                            endpoint_changed.ok_or_else(|| de::Error::missing_field("endpointChanged"))?;
                        let segment_or_point_to_make_coincident_to = segment_or_point_to_make_coincident_to
                            .ok_or_else(|| de::Error::missing_field("segmentOrPointToMakeCoincidentTo"))?;
                        Ok(TrimOperation::AddCoincidentConstraint {
                            segment_id,
                            endpoint_changed,
                            segment_or_point_to_make_coincident_to,
                            intersecting_endpoint_point_id: None, // Optional field, default to None
                        })
                    }
                    "splitSegment" => {
                        let segment_id = segment_id.ok_or_else(|| de::Error::missing_field("segmentId"))?;
                        let left_trim_coords =
                            left_trim_coords.ok_or_else(|| de::Error::missing_field("leftTrimCoords"))?;
                        let right_trim_coords =
                            right_trim_coords.ok_or_else(|| de::Error::missing_field("rightTrimCoords"))?;
                        let original_end_coords =
                            original_end_coords.ok_or_else(|| de::Error::missing_field("originalEndCoords"))?;
                        let left_side = left_side.ok_or_else(|| de::Error::missing_field("leftSide"))?;
                        let right_side = right_side.ok_or_else(|| de::Error::missing_field("rightSide"))?;
                        let left_side_coincident_data = left_side_coincident_data
                            .ok_or_else(|| de::Error::missing_field("leftSideCoincidentData"))?;
                        let right_side_coincident_data = right_side_coincident_data
                            .ok_or_else(|| de::Error::missing_field("rightSideCoincidentData"))?;
                        let constraints_to_migrate =
                            constraints_to_migrate.ok_or_else(|| de::Error::missing_field("constraintsToMigrate"))?;
                        let constraints_to_delete =
                            constraints_to_delete.ok_or_else(|| de::Error::missing_field("constraintsToDelete"))?;
                        Ok(TrimOperation::SplitSegment {
                            segment_id,
                            left_trim_coords,
                            right_trim_coords,
                            original_end_coords,
                            left_side,
                            right_side,
                            left_side_coincident_data,
                            right_side_coincident_data,
                            constraints_to_migrate,
                            constraints_to_delete,
                        })
                    }
                    "deleteConstraints" => {
                        let constraint_ids = constraint_ids.ok_or_else(|| de::Error::missing_field("constraintIds"))?;
                        Ok(TrimOperation::DeleteConstraints { constraint_ids })
                    }
                    _ => Err(de::Error::unknown_variant(
                        type_str,
                        &["simpleTrim", "editSegment", "addCoincidentConstraint", "splitSegment"],
                    )),
                }
            }
        }

        deserializer.deserialize_map(TrimOperationVisitor)
    }
}

/// Constraint to migrate during split operations - WASM version
#[derive(Debug, Clone)]
pub struct ConstraintToMigrate {
    pub constraint_id: usize,
    pub other_entity_id: usize,
    pub is_point_point: bool,
    pub attach_to_endpoint: String, // "start", "end", or "segment"
}

impl From<ConstraintToMigrateCore> for ConstraintToMigrate {
    fn from(c: ConstraintToMigrateCore) -> Self {
        ConstraintToMigrate {
            constraint_id: c.constraint_id,
            other_entity_id: c.other_entity_id,
            is_point_point: c.is_point_point,
            attach_to_endpoint: c.attach_to_endpoint,
        }
    }
}

#[cfg(target_arch = "wasm32")]
impl Serialize for ConstraintToMigrate {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut state = serializer.serialize_struct("ConstraintToMigrate", 4)?;
        state.serialize_field("constraintId", &self.constraint_id)?;
        state.serialize_field("otherEntityId", &self.other_entity_id)?;
        state.serialize_field("isPointPoint", &self.is_point_point)?;
        state.serialize_field("attachToEndpoint", &self.attach_to_endpoint)?;
        state.end()
    }
}

#[cfg(target_arch = "wasm32")]
impl<'de> Deserialize<'de> for ConstraintToMigrate {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        use std::fmt;

        use serde::de::{self, MapAccess, Visitor};

        struct ConstraintToMigrateVisitor;

        impl<'de> Visitor<'de> for ConstraintToMigrateVisitor {
            type Value = ConstraintToMigrate;

            fn expecting(&self, formatter: &mut fmt::Formatter) -> fmt::Result {
                formatter.write_str("ConstraintToMigrate")
            }

            fn visit_map<A>(self, mut map: A) -> Result<Self::Value, A::Error>
            where
                A: MapAccess<'de>,
            {
                let mut constraint_id = None;
                let mut other_entity_id = None;
                let mut is_point_point = None;
                let mut attach_to_endpoint = None;

                while let Some(key) = map.next_key::<String>()? {
                    match key.as_str() {
                        "constraintId" => {
                            constraint_id = Some(map.next_value()?);
                        }
                        "otherEntityId" => {
                            other_entity_id = Some(map.next_value()?);
                        }
                        "isPointPoint" => {
                            is_point_point = Some(map.next_value()?);
                        }
                        "attachToEndpoint" => {
                            attach_to_endpoint = Some(map.next_value()?);
                        }
                        _ => {
                            let _ = map.next_value::<de::IgnoredAny>()?;
                        }
                    }
                }

                let constraint_id = constraint_id.ok_or_else(|| de::Error::missing_field("constraintId"))?;
                let other_entity_id = other_entity_id.ok_or_else(|| de::Error::missing_field("otherEntityId"))?;
                let is_point_point = is_point_point.ok_or_else(|| de::Error::missing_field("isPointPoint"))?;
                let attach_to_endpoint =
                    attach_to_endpoint.ok_or_else(|| de::Error::missing_field("attachToEndpoint"))?;

                Ok(ConstraintToMigrate {
                    constraint_id,
                    other_entity_id,
                    is_point_point,
                    attach_to_endpoint,
                })
            }
        }

        deserializer.deserialize_map(ConstraintToMigrateVisitor)
    }
}

/// Input to the trim loop processing function
#[cfg(target_arch = "wasm32")]
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrimLoopInput {
    pub points: Vec<Coords2d>,
    pub objects: Vec<serde_json::Value>, // Object[] as JSON
    #[serde(rename = "startIndex")]
    pub start_index: usize,
}

/// Output from the trim loop processing function
#[cfg(target_arch = "wasm32")]
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrimLoopOutput {
    #[serde(rename = "nextTrimResult")]
    pub next_trim_result: NextTrimResult,
    pub terminations: Option<TrimTerminations>,
    #[serde(rename = "trimStrategy")]
    pub trim_strategy: Option<Vec<serde_json::Value>>, // TrimOperation[] as JSON
    pub error: Option<String>,
}

/// WASM wrapper function that processes trim loop and returns JSON
///
/// This function takes trim points and objects, finds the next trim spawn (intersection),
/// and returns the trim strategy operations that need to be executed.
///
/// The TypeScript side will execute these operations and call this function again
/// with updated objects if needed.
#[cfg(target_arch = "wasm32")]
#[wasm_bindgen]
pub fn process_trim_loop(input_json: &str) -> Result<JsValue, JsValue> {
    console_error_panic_hook::set_once();

    // Parse input
    let input: TrimLoopInput =
        serde_json::from_str(input_json).map_err(|e| JsValue::from_str(&format!("Failed to parse input: {}", e)))?;

    // Convert JSON objects to native Object types
    let objects: Vec<Object> = input
        .objects
        .iter()
        .map(|obj_json| {
            serde_json::from_value(obj_json.clone()).map_err(|e| format!("Failed to deserialize object: {}", e))
        })
        .collect::<Result<Vec<Object>, String>>()
        .map_err(|e| JsValue::from_str(&e))?;

    // Convert WASM Coords2d to core Coords2d
    let points_core: Vec<Coords2dCore> = input.points.iter().map(|c| (*c).into()).collect();

    // Find the next trim spawn (intersection) using kcl-lib functions
    let next_trim_result_core = get_next_trim_coords(&points_core, input.start_index, &objects);

    // If we found a trim spawn, get terminations
    let (terminations, trim_strategy) = match &next_trim_result_core {
        NextTrimResultCore::TrimSpawn { trim_spawn_seg_id, .. } => {
            // Get terminations using kcl-lib functions
            let terms_core = match get_trim_spawn_terminations(*trim_spawn_seg_id, &points_core, &objects) {
                Ok(t) => t,
                Err(e) => {
                    // Convert to WASM type for error output
                    let next_trim_result: NextTrimResult = next_trim_result_core.clone().into();
                    return Ok(JsValue::from_serde(&TrimLoopOutput {
                        next_trim_result,
                        terminations: None,
                        trim_strategy: None,
                        error: Some(e),
                    })
                    .map_err(|e| JsValue::from_str(&format!("Failed to serialize output: {}", e)))?);
                }
            };

            // Convert to WASM type
            let terms: TrimTerminations = terms_core.clone().into();

            // Find the trim spawn segment object using native types
            let trim_spawn_segment = objects.iter().find(|obj| obj.id.0 == *trim_spawn_seg_id);

            let trim_spawn_segment = match trim_spawn_segment {
                Some(seg) => seg,
                None => {
                    // Convert to WASM type for error output
                    let next_trim_result: NextTrimResult = next_trim_result_core.clone().into();
                    return Ok(JsValue::from_serde(&TrimLoopOutput {
                        next_trim_result,
                        terminations: Some(terms.clone()),
                        trim_strategy: None,
                        error: Some(format!("Trim spawn segment {} not found", trim_spawn_seg_id)),
                    })
                    .map_err(|e| JsValue::from_str(&format!("Failed to serialize output: {}", e)))?);
                }
            };

            // Get trim strategy using kcl-lib functions
            let left_side_core = terms_core.left_side.clone();
            let right_side_core = terms_core.right_side.clone();
            let strategy_core = match trim_strategy(
                *trim_spawn_seg_id,
                trim_spawn_segment,
                &left_side_core,
                &right_side_core,
                &objects,
            ) {
                Ok(ops) => ops,
                Err(e) => {
                    // Convert to WASM type for error output
                    let next_trim_result: NextTrimResult = next_trim_result_core.clone().into();
                    return Ok(JsValue::from_serde(&TrimLoopOutput {
                        next_trim_result,
                        terminations: Some(terms),
                        trim_strategy: None,
                        error: Some(e),
                    })
                    .map_err(|e| JsValue::from_str(&format!("Failed to serialize output: {}", e)))?);
                }
            };

            // Convert TrimOperation enum to JSON
            let ops_json: Vec<serde_json::Value> = strategy_core
                .iter()
                .map(|op| {
                    let op_wasm: TrimOperation = op.clone().into();
                    serde_json::to_value(&op_wasm).map_err(|e| format!("Failed to serialize operation: {}", e))
                })
                .collect::<Result<Vec<_>, _>>()
                .map_err(|e| format!("Failed to serialize operations: {}", e))?;

            (Some(terms), Some(ops_json))
        }
        NextTrimResultCore::NoTrimSpawn { .. } => (None, None),
    };

    // Convert to WASM type for output
    let next_trim_result: NextTrimResult = next_trim_result_core.into();

    let output = TrimLoopOutput {
        next_trim_result,
        terminations,
        trim_strategy,
        error: None,
    };

    Ok(JsValue::from_serde(&output).map_err(|e| JsValue::from_str(&format!("Failed to serialize output: {}", e)))?)
}
