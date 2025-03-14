//! A generator for ArtifactIds that can be stable across executions.

use serde::{Deserialize, Serialize};

use crate::execution::ModuleId;

const NAMESPACE_KCL: uuid::Uuid = uuid::uuid!("29081a99-00fc-11f0-82ab-9cb6d03e6817");

/// A generator for ArtifactIds that can be stable across executions.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct IdGenerator {
    module_id: ModuleId,
    next_id: u64,
}

impl IdGenerator {
    pub fn new(module_id: ModuleId) -> Self {
        Self { module_id, next_id: 0 }
    }

    pub fn next_uuid(&mut self) -> uuid::Uuid {
        let next_id = self.next_id;

        let next_uuid = uuid::Uuid::new_v5(&NAMESPACE_KCL, format!("{} {}", self.module_id, next_id).as_bytes());

        self.next_id += 1;

        next_uuid
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_id_generator() {
        let mut generator = IdGenerator::new(ModuleId::default());

        let uuid1 = generator.next_uuid();
        let uuid2 = generator.next_uuid();

        assert_ne!(uuid1, uuid2);
    }

    #[test]
    // Test that the same generator produces the same UUIDs.
    fn test_id_generator_stable() {
        let mut generator = IdGenerator::new(ModuleId::default());

        let uuid1 = generator.next_uuid();
        let uuid2 = generator.next_uuid();

        let mut generator = IdGenerator::new(ModuleId::default());

        let uuid3 = generator.next_uuid();
        let uuid4 = generator.next_uuid();

        assert_eq!(uuid1, uuid3);
        assert_eq!(uuid2, uuid4);
    }
}
