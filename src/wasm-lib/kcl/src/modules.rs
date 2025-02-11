use std::{fmt, path::PathBuf};

use anyhow::Result;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::{
    errors::{KclError, KclErrorDetails},
    execution::PreImportedGeometry,
    fs::{FileManager, FileSystem},
    parsing::ast::types::{ImportPath, Node, Program},
    source_range::SourceRange,
};

/// Identifier of a source file.  Uses a u32 to keep the size small.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq, Hash, Deserialize, Serialize, ts_rs::TS, JsonSchema)]
#[ts(export)]
pub struct ModuleId(u32);

impl ModuleId {
    pub fn from_usize(id: usize) -> Self {
        Self(u32::try_from(id).expect("module ID should fit in a u32"))
    }

    pub fn as_usize(&self) -> usize {
        usize::try_from(self.0).expect("module ID should fit in a usize")
    }

    /// Top-level file is the one being executed.
    /// Represented by module ID of 0, i.e. the default value.
    pub fn is_top_level(&self) -> bool {
        *self == Self::default()
    }
}

#[derive(Debug, Clone, Deserialize, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ModuleLoader {
    /// The stack of import statements for detecting circular module imports.
    /// If this is empty, we're not currently executing an import statement.
    pub import_stack: Vec<PathBuf>,
}

impl ModuleLoader {
    pub(crate) fn cycle_check(&self, path: &ModulePath, source_range: SourceRange) -> Result<(), KclError> {
        if self.import_stack.contains(path.expect_path()) {
            return Err(KclError::ImportCycle(KclErrorDetails {
                message: format!(
                    "circular import of modules is not allowed: {} -> {}",
                    self.import_stack
                        .iter()
                        .map(|p| p.as_path().to_string_lossy())
                        .collect::<Vec<_>>()
                        .join(" -> "),
                    path,
                ),
                source_ranges: vec![source_range],
            }));
        }
        Ok(())
    }

    pub(crate) fn enter_module(&mut self, path: &ModulePath) {
        if let ModulePath::Local(ref path) = path {
            self.import_stack.push(path.clone());
        }
    }

    pub(crate) fn leave_module(&mut self, path: &ModulePath) {
        if let ModulePath::Local(ref path) = path {
            let popped = self.import_stack.pop().unwrap();
            assert_eq!(path, &popped);
        }
    }
}

pub(crate) fn read_std(_mod_name: &str) -> Option<&'static str> {
    None
}

/// Info about a module.  Right now, this is pretty minimal.  We hope to cache
/// modules here in the future.
#[derive(Debug, Clone, PartialEq, Deserialize, Serialize)]
pub struct ModuleInfo {
    /// The ID of the module.
    pub(crate) id: ModuleId,
    /// Absolute path of the module's source file.
    pub(crate) path: ModulePath,
    pub(crate) repr: ModuleRepr,
}

#[allow(clippy::large_enum_variant)]
#[derive(Debug, Clone, PartialEq, Deserialize, Serialize)]
pub enum ModuleRepr {
    Root,
    Kcl(Node<Program>),
    Foreign(PreImportedGeometry),
}

#[allow(clippy::large_enum_variant)]
#[derive(Debug, Clone, Eq, PartialEq, Deserialize, Serialize, Hash)]
pub enum ModulePath {
    Local(PathBuf),
    Std(String),
}

impl ModulePath {
    pub(crate) fn expect_path(&self) -> &PathBuf {
        match self {
            ModulePath::Local(p) => p,
            _ => unreachable!(),
        }
    }

    pub(crate) async fn source(&self, fs: &FileManager, source_range: SourceRange) -> Result<String, KclError> {
        match self {
            ModulePath::Local(p) => fs.read_to_string(p, source_range).await,
            ModulePath::Std(name) => read_std(name)
                .ok_or_else(|| {
                    KclError::Semantic(KclErrorDetails {
                        message: format!("Cannot find standard library module to import: std::{name}."),
                        source_ranges: vec![source_range],
                    })
                })
                .map(str::to_owned),
        }
    }

    pub(crate) fn from_import_path(path: &ImportPath, project_directory: &Option<PathBuf>) -> Self {
        match path {
            ImportPath::Kcl { filename: path } | ImportPath::Foreign { path } => {
                let resolved_path = if let Some(project_dir) = project_directory {
                    project_dir.join(path)
                } else {
                    std::path::PathBuf::from(path)
                };
                ModulePath::Local(resolved_path)
            }
            ImportPath::Std { path } => {
                // For now we only support importing from singly-nested modules inside std.
                assert_eq!(path.len(), 2);
                assert_eq!(&path[0], "std");

                ModulePath::Std(path[1].clone())
            }
        }
    }
}

impl fmt::Display for ModulePath {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ModulePath::Local(path) => path.display().fmt(f),
            ModulePath::Std(s) => write!(f, "std::{s}"),
        }
    }
}
