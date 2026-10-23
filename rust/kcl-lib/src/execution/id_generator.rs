//! A generator for ArtifactIds that can be stable across executions.

use crate::execution::ArtifactId;
use crate::execution::ModuleId;

const NAMESPACE_KCL: uuid::Uuid = uuid::uuid!("8bda3118-75eb-58c7-a866-bef1dcb495e7");

/// A generator for ArtifactIds that can be stable across executions.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct IdGenerator {
    module_id: Option<ModuleId>,
    next_id: u64,
    namespace: Option<uuid::Uuid>,
}

impl IdGenerator {
    pub fn new(module_id: Option<ModuleId>) -> Self {
        Self {
            module_id,
            next_id: 0,
            namespace: None,
        }
    }

    /// Follow-up commands must not reuse IDs allocated by the remote interpreter.
    #[cfg(not(target_arch = "wasm32"))]
    pub(super) fn remote_session() -> Self {
        Self {
            namespace: Some(uuid::Uuid::new_v4()),
            ..Self::default()
        }
    }

    pub fn next_uuid(&mut self) -> uuid::Uuid {
        let next_id = self.next_id;

        let next = format!(
            "{} {}",
            self.module_id.map(|id| id.to_string()).unwrap_or("none".to_string()),
            next_id
        );
        let next_uuid = uuid::Uuid::new_v5(self.namespace.as_ref().unwrap_or(&NAMESPACE_KCL), next.as_bytes());

        self.next_id += 1;

        next_uuid
    }

    pub fn next_artifact_id(&mut self) -> ArtifactId {
        ArtifactId::new(self.next_uuid())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_id_generator() {
        let mut generator = IdGenerator::new(Some(ModuleId::default()));

        let uuid1 = generator.next_uuid();
        let uuid2 = generator.next_uuid();

        assert_ne!(uuid1, uuid2);
    }

    #[test]
    // Test that the same generator produces the same UUIDs.
    fn test_id_generator_stable() {
        let mut generator = IdGenerator::new(Some(ModuleId::default()));

        let uuid1 = generator.next_uuid();
        let uuid2 = generator.next_uuid();

        let mut generator = IdGenerator::new(Some(ModuleId::default()));

        let uuid3 = generator.next_uuid();
        let uuid4 = generator.next_uuid();

        assert_eq!(uuid1, uuid3);
        assert_eq!(uuid2, uuid4);
    }

    #[test]
    // Generate 20 uuids and make sure all are unique.
    fn test_id_generator_unique() {
        let mut generator = IdGenerator::new(Some(ModuleId::default()));

        let mut uuids = Vec::new();

        for _ in 0..20 {
            uuids.push(generator.next_uuid());
        }

        for i in 0..uuids.len() {
            for j in i + 1..uuids.len() {
                assert_ne!(uuids[i], uuids[j]);
            }
        }
    }
}
