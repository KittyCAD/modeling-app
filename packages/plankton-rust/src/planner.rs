use std::{
    collections::{HashMap, HashSet},
    rc::Rc,
};

use crate::{
    Binding, Extension, ItemPath, PathStep, RegistryError,
    factory::{ExtensionKind, FactoryItem, FactoryKey},
};

/// Expand declared dependencies before their consumers and flatten static groups.
/// Returns the first selected occurrence of each factory and binding. This
/// dry run does not evaluate constructors, factory children, or binding sources.
pub fn plan(items: &[Extension]) -> Result<Vec<PlannedItem>, RegistryError> {
    plan_selected(items, None, &mut HashMap::new())
}

pub(crate) fn plan_selected(
    items: &[Extension],
    parent: Option<&ItemPath>,
    selected: &mut HashMap<FactoryKey, FactoryItem>,
) -> Result<Vec<PlannedItem>, RegistryError> {
    let mut plan = Plan::default();
    for (index, item) in items.iter().enumerate() {
        let path = match parent {
            Some(parent) => parent.at(PathStep::Child(index)),
            None => ItemPath {
                root: index,
                steps: Vec::new(),
            },
        };
        plan.visit(item, path, selected)?;
    }
    Ok(plan.entries)
}

/// The kind of declaration and its explicit key, when one was supplied.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ItemKind {
    Binding { contribution_key: Option<String> },
    Factory { key: Option<Rc<str>> },
}

impl ItemKind {
    pub(crate) fn binding(binding: &Binding) -> Self {
        Self::Binding {
            contribution_key: binding.options.key.clone(),
        }
    }

    pub(crate) fn factory(factory: &FactoryItem) -> Self {
        Self::Factory {
            key: factory.0.key.clone(),
        }
    }
}

/// A declaration selected by the dry-run planner and its path in the input.
pub struct PlannedItem {
    pub path: ItemPath,
    pub(crate) item: Planned,
}

impl PlannedItem {
    pub fn kind(&self) -> ItemKind {
        match &self.item {
            Planned::Binding(binding) => ItemKind::binding(binding),
            Planned::Factory(factory) => ItemKind::factory(factory),
        }
    }

    /// Get the selected declaration as an extension, preserving its identity.
    pub fn extension(&self) -> Extension {
        match &self.item {
            Planned::Binding(binding) => binding.clone().into(),
            Planned::Factory(factory) => Extension(ExtensionKind::Factory(factory.clone())),
        }
    }
}

impl std::fmt::Debug for PlannedItem {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("PlannedItem")
            .field("path", &self.path)
            .field("kind", &self.kind())
            .finish()
    }
}

pub(crate) enum Planned {
    Binding(Binding),
    Factory(FactoryItem),
}

/// Select declared definitions before any constructor reveals its children.
#[derive(Default)]
struct Plan {
    entries: Vec<PlannedItem>,
    bindings: HashSet<usize>,
    complete: HashSet<FactoryKey>,
    active: Vec<(FactoryKey, ItemPath)>,
}

impl Plan {
    fn visit(
        &mut self,
        item: &Extension,
        path: ItemPath,
        selected: &mut HashMap<FactoryKey, FactoryItem>,
    ) -> Result<(), RegistryError> {
        match &item.0 {
            ExtensionKind::Group(items) => {
                for (index, child) in items.iter().enumerate() {
                    self.visit(child, path.at(PathStep::Child(index)), selected)?;
                }
            }
            ExtensionKind::Binding(binding) => {
                if self.bindings.insert(binding.identity()) {
                    self.entries.push(PlannedItem {
                        path,
                        item: Planned::Binding(binding.clone()),
                    });
                }
            }
            ExtensionKind::Factory(factory) => self.factory(factory, path, selected)?,
        }
        Ok(())
    }

    fn factory(
        &mut self,
        item: &FactoryItem,
        path: ItemPath,
        selected: &mut HashMap<FactoryKey, FactoryItem>,
    ) -> Result<(), RegistryError> {
        let key = item.key();
        if let Some(error) = cycle(&self.active, &key, &path) {
            return Err(error);
        }
        let winner = selected.entry(key.clone()).or_insert_with(|| item.clone());
        if !Rc::ptr_eq(&winner.0, &item.0) || self.complete.contains(&key) {
            return Ok(());
        }
        self.active.push((key.clone(), path.clone()));
        for edge in &item.0.edges {
            self.factory(
                &edge.item,
                path.at(PathStep::Dependency(edge.name.clone())),
                selected,
            )?;
        }
        self.active.pop();
        self.complete.insert(key);
        self.entries.push(PlannedItem {
            path,
            item: Planned::Factory(item.clone()),
        });
        Ok(())
    }
}

pub(crate) fn cycle(
    active: &[(FactoryKey, ItemPath)],
    key: &FactoryKey,
    path: &ItemPath,
) -> Option<RegistryError> {
    let start = active.iter().position(|(ancestor, _)| ancestor == key)?;
    let paths = active[start..]
        .iter()
        .map(|(_, path)| path.clone())
        .chain(std::iter::once(path.clone()))
        .collect();
    Some(RegistryError::DependencyCycle(paths))
}
