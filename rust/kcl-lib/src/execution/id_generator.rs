//! A generator for ArtifactIds that can be stable across executions.

use crate::execution::{ArtifactId, ModuleId};

const NAMESPACE_KCL: uuid::Uuid = uuid::uuid!("8bda3118-75eb-58c7-a866-bef1dcb495e7");

/// A generator for ArtifactIds that can be stable across executions.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct IdGenerator {
    module_id: Option<ModuleId>,
    next_id: u64,
}

impl IdGenerator {
    pub fn new(module_id: Option<ModuleId>) -> Self {
        Self { module_id, next_id: 0 }
    }

    pub fn next_uuid(&mut self) -> uuid::Uuid {
        let next_id = self.next_id;

        let next = format!(
            "{} {}",
            self.module_id.map(|id| id.to_string()).unwrap_or("none".to_string()),
            next_id
        );
        let next_uuid = uuid::Uuid::new_v5(&NAMESPACE_KCL, next.as_bytes());

        self.next_id += 1;

        next_uuid
    }
}

const ENGINE_NAMESPACE_KCL: uuid::Uuid = uuid::uuid!("22b85cda-1c8d-57c4-88b5-3fd71846f31e");
pub struct EngineIdGenerator {
    base: uuid::Uuid, // this is the sketch id, aka ClosePath's path_id, aka object uuid in engine
    path_index: u32,  // zero based index of the segment/curve/edge in the path.
}

impl EngineIdGenerator {
    pub fn new(base: uuid::Uuid) -> Self {
        Self { base, path_index: 0 }
    }

    pub fn next_edge(&mut self) {
        self.path_index += 1;
    }

    // aka edge/segment id
    pub fn get_curve_id(&self) -> ArtifactId {
        self.generate_path_id("") // "path_0"
    }

    // aka wall_id
    pub fn get_face_id(&self) -> ArtifactId {
        self.generate_path_id("face") // "path_0_face"
    }

    pub fn get_next_face_id(&self, num_segments: u32) -> ArtifactId {
        let index = (self.path_index + 1) % num_segments;
        let path_modifier = format!("path_{}", index);
        let modifier = format!("{}_{}", path_modifier, "face");
        self.generate_id(&modifier)
    }

    pub fn get_opposite_edge_id(&self) -> ArtifactId {
        self.generate_path_id("opp") // "path_0_opp"
    }

    pub fn get_adjacent_edge_id(&self) -> ArtifactId {
        self.generate_path_id("adj") // "path_0_adj"
    }

    pub fn get_start_cap_id(&self) -> ArtifactId {
        self.generate_id("face_bottom") // "path_0_face_bottom"
    }

    pub fn get_end_cap_id(&self) -> ArtifactId {
        self.generate_id("face_top") // "path_0_face_bottom"
    }

    fn generate_path_id(&self, suffix: &str) -> ArtifactId {
        let path_modifier = format!("path_{}", self.path_index);
        let modifier = if suffix.is_empty() {
            path_modifier
        } else {
            format!("{}_{}", path_modifier, suffix)
        };
        self.generate_id(&modifier)
    }

    fn generate_id(&self, modifier: &str) -> ArtifactId {
        let name = format!("{}_{}", self.base, modifier);
        let uuid = uuid::Uuid::new_v5(&ENGINE_NAMESPACE_KCL, name.as_bytes());
        ArtifactId::new(uuid)
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
