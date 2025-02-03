//! Representation of KCL memory.
//!
//! Stores `KclValue`s by name using dynamic scoping (i.e., functions as both KCL's runtime memory
//! and name resolution). Memory does not support addresses or references, so all values must be
//! self-contained.
//!
//! Memory is mostly immutable (or at least monotonic; since KCL does not support mutation or
//! reassignment). However, tags may change as code is executed and that mutates tag values in
//! memory and the records of tags in the representation of geometry.

use anyhow::Result;
use indexmap::IndexMap;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::{
    errors::{KclError, KclErrorDetails},
    execution::{KclValue, Metadata, Sketch, Solid, TagIdentifier},
    source_range::SourceRange,
};
use env::Environment;

pub(crate) const RETURN_NAME: &str = "__return";

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct ProgramMemory {
    environments: Vec<Environment>,
    current_env: EnvironmentRef,
}

impl ProgramMemory {
    pub fn new() -> Self {
        Self {
            environments: vec![Environment::root()],
            current_env: EnvironmentRef::root(),
        }
    }

    pub fn push_new_env_for_call(&mut self) {
        let new_env_ref = EnvironmentRef(self.environments.len());
        let new_env = Environment::new(self.current_env);
        self.environments.push(new_env);
        self.current_env = new_env_ref
    }

    /// Add to the program memory in the current scope.
    pub fn add(&mut self, key: &str, value: KclValue, source_range: SourceRange) -> Result<(), KclError> {
        if self.environments[self.current_env.index()].contains_key(key) {
            return Err(KclError::ValueAlreadyDefined(KclErrorDetails {
                message: format!("Cannot redefine `{}`", key),
                source_ranges: vec![source_range],
            }));
        }

        self.environments[self.current_env.index()].insert(key.to_owned(), value);

        Ok(())
    }

    /// Get a value from the program memory.
    /// Return Err if not found.
    pub fn get(&self, var: &str, source_range: SourceRange) -> Result<&KclValue, KclError> {
        let mut env_ref = self.current_env;
        loop {
            let env = &self.environments[env_ref.index()];
            if let Some(item) = env.get(var) {
                return Ok(item);
            }
            if let Some(parent) = env.parent {
                env_ref = parent;
            } else {
                break;
            }
        }

        Err(KclError::UndefinedValue(KclErrorDetails {
            message: format!("memory item key `{}` is not defined", var),
            source_ranges: vec![source_range],
        }))
    }

    /// Find all solids in the memory that are on a specific sketch id.
    /// This does not look inside closures.  But as long as we do not allow
    /// mutation of variables in KCL, closure memory should be a subset of this.
    #[allow(clippy::vec_box)]
    pub fn find_solids_on_sketch(&self, sketch_id: uuid::Uuid) -> Vec<Box<Solid>> {
        self.environments
            .iter()
            .flat_map(|env| {
                env.values()
                    .filter_map(|item| match item {
                        KclValue::Solid { value } if value.sketch.id == sketch_id => Some(value.clone()),
                        _ => None,
                    })
                    .collect::<Vec<_>>()
            })
            .collect()
    }

    pub fn update_sketch_tags(&mut self, sg: &Sketch) {
        self.environments[self.current_env.index()].update_sketch_tags(sg);
    }

    pub fn update_tag(&mut self, tag: &str, value: TagIdentifier) {
        debug_assert!(
            self.environments[self.current_env.index()]
                .get(tag)
                .map(|val| matches!(val, KclValue::TagIdentifier(_)))
                .unwrap_or(true),
            "Attempt to update tag, but value to update is not in fact a tag. Key: `{tag}`",
        );

        self.environments[self.current_env.index()]
            .insert_or_update(tag.to_string(), KclValue::TagIdentifier(Box::new(value)));
    }

    pub fn iter_values(&self) -> impl Iterator<Item = &KclValue> {
        self.environments.iter().flat_map(|e| e.values())
    }
}

impl Default for ProgramMemory {
    fn default() -> Self {
        Self::new()
    }
}

/// An index pointing to an environment.
#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[schemars(transparent)]
pub struct EnvironmentRef(usize);

impl EnvironmentRef {
    fn root() -> Self {
        Self(0)
    }

    fn index(&self) -> usize {
        self.0
    }
}

// Use a sub-module to protect access to `Environment::bindings` and prevent unexpected mutatation
// of stored values.
mod env {
    use super::*;

    #[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
    pub(super) struct Environment {
        bindings: IndexMap<String, KclValue>,
        pub(super) parent: Option<EnvironmentRef>,
    }

    const NO_META: Vec<Metadata> = Vec::new();

    impl Environment {
        pub(super) fn root() -> Self {
            Self {
                // Prelude
                bindings: IndexMap::from([
                    ("ZERO".to_string(), KclValue::from_number(0.0, NO_META)),
                    ("QUARTER_TURN".to_string(), KclValue::from_number(90.0, NO_META)),
                    ("HALF_TURN".to_string(), KclValue::from_number(180.0, NO_META)),
                    ("THREE_QUARTER_TURN".to_string(), KclValue::from_number(270.0, NO_META)),
                ]),
                parent: None,
            }
        }

        pub(super) fn new(parent: EnvironmentRef) -> Self {
            Self {
                bindings: IndexMap::new(),
                parent: Some(parent),
            }
        }

        pub(super) fn get(&self, key: &str) -> Option<&KclValue> {
            self.bindings.get(key)
        }

        pub(super) fn values(&self) -> impl Iterator<Item = &KclValue> {
            self.bindings.values()
        }

        /// Pure insert, panics if `key` is already in this environment.
        ///
        /// Precondition: !self.contains_key(key)
        pub(super) fn insert(&mut self, key: String, value: KclValue) {
            debug_assert!(!self.bindings.contains_key(&key));
            self.bindings.insert(key, value);
        }

        pub(super) fn insert_or_update(&mut self, key: String, value: KclValue) {
            self.bindings.insert(key, value);
        }

        pub(super) fn contains_key(&self, key: &str) -> bool {
            self.bindings.contains_key(key)
        }

        pub(super) fn update_sketch_tags(&mut self, sg: &Sketch) {
            if sg.tags.is_empty() {
                return;
            }

            let mut updates = Vec::new();

            for (key, val) in self.bindings.iter() {
                let KclValue::Sketch { value } = val else { continue };

                if value.artifact_id == sg.artifact_id {
                    let mut value = value.clone();
                    for (tag_name, tag_id) in sg.tags.iter() {
                        value.tags.insert(tag_name.clone(), tag_id.clone());
                    }
                    updates.push((key.clone(), KclValue::Sketch { value }));
                }
            }

            for (key, value) in updates {
                self.insert_or_update(key, value);
            }
        }
    }
}
