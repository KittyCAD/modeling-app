//! Runtime scene discovery for an end-of-file section cut.

use indexmap::IndexMap;
use indexmap::IndexSet;
use kittycad_modeling_cmds::ModelingCmd;
use kittycad_modeling_cmds::each_cmd::ObjectSetMaterialParamsPbr;
use uuid::Uuid;

use super::ArtifactCommand;
use super::ConsumedSolidKey;
use super::ExecState;
use super::KclValue;
use super::ModuleArtifactState;
use super::Solid;
use crate::modules::ModuleRepr;

#[derive(Debug, Clone, Default, PartialEq)]
pub(crate) struct SectionScene {
    // None is a tombstone: consumed/deleted bodies must also disappear from cached modules.
    pub(crate) bodies: IndexMap<Uuid, Option<Solid>>,
    pub(crate) materials: IndexMap<Uuid, ObjectSetMaterialParamsPbr>,
    pub(crate) deleted: IndexSet<Uuid>,
    pub(crate) consumed: IndexSet<ConsumedSolidKey>,
}

impl ExecState {
    fn section_modules(&self) -> impl Iterator<Item = &ModuleArtifactState> {
        self.global
            .module_infos
            .values()
            .filter_map(|module| match &module.repr {
                ModuleRepr::Kcl(_, Some(outcome)) => Some(&outcome.artifacts),
                ModuleRepr::Foreign(_, Some((_, artifacts))) => Some(artifacts),
                _ => None,
            })
            .chain([&self.global.root_module_artifacts, &self.mod_local.artifacts])
    }

    pub(crate) fn section_bodies(&self) -> Vec<Solid> {
        let mut bodies = IndexMap::new();
        for module in self.section_modules() {
            bodies.extend(module.section_scene.bodies.iter().map(|(id, body)| (*id, body.clone())));
        }
        bodies
            .into_values()
            .flatten()
            .filter(|body| body.best_guess_body_type != Some(kittycad_modeling_cmds::shared::BodyType::Surface))
            .collect()
    }

    pub(crate) fn section_material(&self, id: Uuid) -> Option<ObjectSetMaterialParamsPbr> {
        self.section_modules()
            .filter_map(|module| module.section_scene.materials.get(&id))
            .last()
            .cloned()
    }

    pub(crate) fn track_section_value(&mut self, value: &KclValue) {
        match value {
            KclValue::Solid { value } => {
                if !self.section_modules().any(|module| {
                    module.section_scene.deleted.contains(&value.id)
                        || module
                            .section_scene
                            .consumed
                            .contains(&ConsumedSolidKey::new(value.id, value.value_id))
                }) && self
                    .check_solid_consumed(&ConsumedSolidKey::new(value.id, value.value_id))
                    .is_none()
                {
                    self.mod_local
                        .artifacts
                        .section_scene
                        .bodies
                        .insert(value.id, Some((**value).clone()));
                }
            }
            KclValue::HomArray { value, .. } | KclValue::Tuple { value, .. } => {
                for item in value {
                    self.track_section_value(item);
                }
            }
            KclValue::Object { value, .. } => {
                for (_, item) in value.iter() {
                    self.track_section_value(item);
                }
            }
            _ => {}
        }
    }

    pub(crate) fn copy_section_material(&mut self, source: Uuid, target: Uuid) {
        if let Some(mut material) = self.section_material(source) {
            material.object_id = target;
            self.mod_local
                .artifacts
                .section_scene
                .materials
                .insert(target, material);
        }
    }

    pub(crate) fn track_section_command(&mut self, command: &ArtifactCommand) {
        match &command.command {
            ModelingCmd::ObjectSetMaterialParamsPbr(material) => {
                self.mod_local
                    .artifacts
                    .section_scene
                    .materials
                    .insert(material.object_id, material.clone());
            }
            ModelingCmd::EntityClone(clone) => self.copy_section_material(clone.entity_id, command.cmd_id),
            ModelingCmd::RemoveSceneObjects(remove) => {
                for id in &remove.object_ids {
                    self.mod_local.artifacts.section_scene.deleted.insert(*id);
                    self.mod_local.artifacts.section_scene.bodies.insert(*id, None);
                }
            }
            _ => {}
        }
    }
}
