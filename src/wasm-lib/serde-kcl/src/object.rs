use std::collections::HashMap;

use crate::Value;

/// A KCL object.
#[derive(Debug, Default, PartialEq)]
pub struct Object {
    /// The object's properties.
    pub properties: HashMap<String, Value>,
}

impl Object {
    /// Create a new object with no properties.
    pub fn new() -> Self {
        Self::default()
    }
    /// How many properties does this object have?
    pub fn len(&self) -> usize {
        self.properties.len()
    }
    /// Add a new property to the object.
    /// If the object already has a property with this name, overwrites it.
    pub fn insert(&mut self, property: String, value: Value) {
        self.properties.insert(property, value);
    }
}

/// Given a list of (key, value) pairs, you can make a KCL object.
impl<const N: usize> From<[(String, Value); N]> for Object {
    fn from(value: [(String, Value); N]) -> Self {
        Self {
            properties: HashMap::from(value),
        }
    }
}
