//! BOM / part-properties runtime data for solids.
//!
//! Label + free-form properties live on [`crate::execution::Solid`]. Membership in the
//! global BOM is tracked in an ExecState registry keyed by [`ArtifactId`].
//!
//! The registry lives on [`crate::execution::state::GlobalState`] (not per-module
//! `ModuleState`) so it survives `mod_local` swaps during module execution and is
//! snapshotted/restored with the execution cache via `global`.

use indexmap::IndexMap;
use serde::Deserialize;
use serde::Serialize;

use crate::execution::ArtifactId;
use crate::execution::types::NumericType;

/// One free-form property value attached to a solid for BOM / cut-list use.
///
/// Geometry values are intentionally excluded — properties are fabrication /
/// identity data, not scene references.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, ts_rs::TS)]
#[ts(export)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum PropertyValue {
    String {
        value: String,
    },
    Number {
        value: f64,
        ty: NumericType,
    },
    Bool {
        value: bool,
    },
    Object {
        value: IndexMap<String, PropertyValue>,
    },
}

/// A BOM registry row: required label plus free-form properties.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, ts_rs::TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct BomEntry {
    pub label: String,
    pub properties: IndexMap<String, PropertyValue>,
}

impl BomEntry {
    pub fn new(label: impl Into<String>, properties: IndexMap<String, PropertyValue>) -> Self {
        Self {
            label: label.into(),
            properties,
        }
    }
}

/// Global BOM membership for one module execution, keyed by solid `artifact_id`.
///
/// Insertion order is preserved so `bom()` output is deterministic.
pub type BomRegistry = IndexMap<ArtifactId, BomEntry>;

#[cfg(test)]
mod tests {
    use super::*;
    use uuid::Uuid;

    #[test]
    fn property_map_clones_independently() {
        let mut props = IndexMap::new();
        props.insert(
            "length".to_owned(),
            PropertyValue::Number {
                value: 1550.0,
                ty: NumericType::default(),
            },
        );
        let entry = BomEntry::new("stud", props);
        let mut clone = entry.clone();
        clone.properties.insert(
            "sku".to_owned(),
            PropertyValue::String {
                value: "90x45".to_owned(),
            },
        );

        assert!(!entry.properties.contains_key("sku"));
        assert_eq!(clone.properties.len(), 2);
        assert_eq!(entry.label, "stud");
    }

    #[test]
    fn registry_upsert_by_artifact_id() {
        let id = ArtifactId::new(Uuid::from_u128(1));
        let mut registry = BomRegistry::default();
        registry.insert(id, BomEntry::new("stud", IndexMap::new()));
        registry.insert(
            id,
            BomEntry::new("batten", {
                let mut props = IndexMap::new();
                props.insert(
                    "length".to_owned(),
                    PropertyValue::Number {
                        value: 2400.0,
                        ty: NumericType::default(),
                    },
                );
                props
            }),
        );

        assert_eq!(registry.len(), 1);
        assert_eq!(registry.get(&id).unwrap().label, "batten");
        assert!(registry.get(&id).unwrap().properties.contains_key("length"));
    }

    #[test]
    fn registry_clone_preserves_entries() {
        let id_a = ArtifactId::new(Uuid::from_u128(1));
        let id_b = ArtifactId::new(Uuid::from_u128(2));
        let mut registry = BomRegistry::default();
        registry.insert(id_a, BomEntry::new("stud", IndexMap::new()));
        registry.insert(id_b, BomEntry::new("rafter", IndexMap::new()));

        let cached = registry.clone();
        assert_eq!(cached.len(), 2);
        assert_eq!(cached.get(&id_a).unwrap().label, "stud");
        assert_eq!(cached.get(&id_b).unwrap().label, "rafter");
    }
}
