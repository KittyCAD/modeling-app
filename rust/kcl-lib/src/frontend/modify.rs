use std::collections::HashSet;

use crate::parsing::ast::types::{BodyItem, CodeBlock, ImportSelector};

/// Find all defined names in the given code block. This ignores names defined
/// by glob imports.
pub(super) fn find_defined_names<B: CodeBlock>(block: &B) -> HashSet<String> {
    let mut defined_names = HashSet::new();
    for item in block.body() {
        if let BodyItem::ImportStatement(import) = item {
            match &import.selector {
                ImportSelector::List { items } => {
                    for import_item in items {
                        if let Some(alias) = &import_item.alias {
                            defined_names.insert(alias.name.clone());
                        } else {
                            defined_names.insert(import_item.name.name.clone());
                        }
                    }
                }
                ImportSelector::Glob(_) => {}
                ImportSelector::None { .. } => {}
            }
            if let Some(module_name) = import.module_name() {
                defined_names.insert(module_name);
            }
        }
        if let BodyItem::VariableDeclaration(var_decl) = item {
            let decl = &var_decl.declaration;
            defined_names.insert(decl.id.name.clone());
        }
    }
    defined_names
}

pub(super) fn next_free_name(prefix: &str, taken_names: &HashSet<String>) -> anyhow::Result<String> {
    next_free_name_using_max(prefix, taken_names, 999)
}

pub(super) fn next_free_name_using_max(
    prefix: &str,
    taken_names: &HashSet<String>,
    mut max: u16,
) -> anyhow::Result<String> {
    if max == u16::MAX {
        // Prevent overflow.
        max = u16::MAX - 1;
    }
    let mut index = 1;
    while index <= max {
        let candidate = format!("{prefix}{index}");
        if !taken_names.contains(&candidate) {
            return Ok(candidate);
        }
        index += 1;
    }
    Err(anyhow::anyhow!(
        "Could not find a free name with prefix '{prefix}' after maximum tries."
    ))
}
