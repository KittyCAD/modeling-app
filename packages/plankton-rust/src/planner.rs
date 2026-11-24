use std::{
    collections::{HashMap, HashSet},
    rc::Rc,
};

use crate::{
    Binding, Extension, ItemPath, PathStep, RegistryError,
    factory::{ExtensionKind, FactoryItem, FactoryKey},
};

/// Expand declared dependencies before any constructor reveals its children.
pub(crate) fn plan(
    items: &[Extension],
    parent: Option<&ItemPath>,
    selected: &mut HashMap<FactoryKey, FactoryItem>,
) -> Result<Vec<Planned>, RegistryError> {
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

pub(crate) enum Planned {
    Binding(Binding, ItemPath),
    Factory(FactoryItem, ItemPath),
}

/// Select declared definitions before any constructor reveals its children.
#[derive(Default)]
struct Plan {
    entries: Vec<Planned>,
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
                self.entries.push(Planned::Binding(binding.clone(), path))
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
        self.entries.push(Planned::Factory(item.clone(), path));
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
