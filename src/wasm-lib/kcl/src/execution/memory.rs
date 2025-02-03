use anyhow::Result;
use indexmap::IndexMap;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::{
    errors::{KclError, KclErrorDetails},
    execution::{KclValue, Metadata, Sketch, Solid, TagIdentifier},
    source_range::SourceRange,
};

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

        self.environments[self.current_env.index()].insert(key.to_string(), value);

        Ok(())
    }

    pub fn update_tag(&mut self, tag: &str, value: TagIdentifier) -> Result<(), KclError> {
        self.environments[self.current_env.index()].insert(tag.to_string(), KclValue::TagIdentifier(Box::new(value)));

        Ok(())
    }

    /// Get a value from the program memory.
    /// Return Err if not found.
    pub fn get(&self, var: &str, source_range: SourceRange) -> Result<&KclValue, KclError> {
        let mut env_ref = self.current_env;
        loop {
            let env = &self.environments[env_ref.index()];
            if let Some(item) = env.bindings.get(var) {
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

    /// Returns all bindings in the current scope.
    #[allow(dead_code)]
    fn get_all_cur_scope(&self) -> IndexMap<String, KclValue> {
        let env = &self.environments[self.current_env.index()];
        env.bindings.clone()
    }

    /// Find all solids in the memory that are on a specific sketch id.
    /// This does not look inside closures.  But as long as we do not allow
    /// mutation of variables in KCL, closure memory should be a subset of this.
    #[allow(clippy::vec_box)]
    pub fn find_solids_on_sketch(&self, sketch_id: uuid::Uuid) -> Vec<Box<Solid>> {
        self.environments
            .iter()
            .flat_map(|env| {
                env.bindings
                    .values()
                    .filter_map(|item| match item {
                        KclValue::Solid { value } if value.sketch.id == sketch_id => Some(value.clone()),
                        _ => None,
                    })
                    .collect::<Vec<_>>()
            })
            .collect()
    }

    pub fn update_sketch_tags(&mut self, sg: &Sketch) {
        let cur_env_index = self.current_env.index();
        if let Some(current_env) = self.environments.get_mut(cur_env_index) {
            current_env.update_sketch_tags(sg);
        }
    }

    pub fn iter_values(&self) -> impl Iterator<Item = &KclValue> {
        self.environments.iter().flat_map(|e| e.bindings.values())
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

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
pub struct Environment {
    bindings: IndexMap<String, KclValue>,
    parent: Option<EnvironmentRef>,
}

const NO_META: Vec<Metadata> = Vec::new();

impl Environment {
    fn root() -> Self {
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

    fn new(parent: EnvironmentRef) -> Self {
        Self {
            bindings: IndexMap::new(),
            parent: Some(parent),
        }
    }

    fn insert(&mut self, key: String, value: KclValue) {
        self.bindings.insert(key, value);
    }

    fn contains_key(&self, key: &str) -> bool {
        self.bindings.contains_key(key)
    }

    fn update_sketch_tags(&mut self, sg: &Sketch) {
        if sg.tags.is_empty() {
            return;
        }

        for (_, val) in self.bindings.iter_mut() {
            let KclValue::Sketch { value } = val else { continue };

            if value.artifact_id == sg.artifact_id {
                let mut value = value.clone();
                for (tag_name, tag_id) in sg.tags.iter() {
                    value.tags.insert(tag_name.clone(), tag_id.clone());
                }
                *val = KclValue::Sketch { value };
            }
        }
    }
}
