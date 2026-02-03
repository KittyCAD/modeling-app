use std::fmt;

use anyhow::Result;
pub use kcl_error::ModuleId;
use serde::{Deserialize, Serialize};

use crate::{
    SourceRange,
    errors::{KclError, KclErrorDetails},
    exec::KclValue,
    execution::{EnvironmentRef, ModuleArtifactState, PreImportedGeometry, typed_path::TypedPath},
    fs::{FileManager, FileSystem},
    parsing::ast::types::{ImportPath, Node, Program},
};

#[derive(Debug, Clone, Default)]
pub(crate) struct ModuleLoader {
    /// The stack of import statements for detecting circular module imports.
    /// If this is empty, we're not currently executing an import statement.
    pub import_stack: Vec<TypedPath>,
}

impl ModuleLoader {
    pub(crate) fn cycle_check(&self, path: &ModulePath, source_range: SourceRange) -> Result<(), KclError> {
        if self.import_stack.contains(path.expect_path()) {
            return Err(self.import_cycle_error(path, source_range));
        }
        Ok(())
    }

    pub(crate) fn import_cycle_error(&self, path: &ModulePath, source_range: SourceRange) -> KclError {
        KclError::new_import_cycle(KclErrorDetails::new(
            format!(
                "circular import of modules is not allowed: {} -> {}",
                self.import_stack
                    .iter()
                    .map(|p| p.to_string_lossy())
                    .collect::<Vec<_>>()
                    .join(" -> "),
                path,
            ),
            vec![source_range],
        ))
    }

    pub(crate) fn enter_module(&mut self, path: &ModulePath) {
        if let ModulePath::Local { value: path, .. } = path {
            self.import_stack.push(path.clone());
        }
    }

    pub(crate) fn leave_module(&mut self, path: &ModulePath, source_range: SourceRange) -> Result<(), KclError> {
        if let ModulePath::Local { value: path, .. } = path {
            if let Some(popped) = self.import_stack.pop() {
                debug_assert_eq!(path, &popped);
                if path != &popped {
                    return Err(KclError::new_internal(KclErrorDetails::new(
                        format!(
                            "Import stack mismatch when leaving module: expected to leave {}, but leaving {}",
                            path.to_string_lossy(),
                            popped.to_string_lossy(),
                        ),
                        vec![source_range],
                    )));
                }
            } else {
                let message = format!("Import stack underflow when leaving module: {path}");
                debug_assert!(false, "{}", &message);
                return Err(KclError::new_internal(KclErrorDetails::new(
                    message,
                    vec![source_range],
                )));
            }
        }
        Ok(())
    }
}

pub(crate) fn read_std(mod_name: &str) -> Option<&'static str> {
    match mod_name {
        "prelude" => Some(include_str!("../std/prelude.kcl")),
        "gdt" => Some(include_str!("../std/gdt.kcl")),
        "math" => Some(include_str!("../std/math.kcl")),
        "runtime" => Some(include_str!("../std/runtime.kcl")),
        "sketch" => Some(include_str!("../std/sketch.kcl")),
        "sketch2" => Some(include_str!("../std/sketch2.kcl")),
        "turns" => Some(include_str!("../std/turns.kcl")),
        "types" => Some(include_str!("../std/types.kcl")),
        "solid" => Some(include_str!("../std/solid.kcl")),
        "units" => Some(include_str!("../std/units.kcl")),
        "array" => Some(include_str!("../std/array.kcl")),
        "sweep" => Some(include_str!("../std/sweep.kcl")),
        "appearance" => Some(include_str!("../std/appearance.kcl")),
        "transform" => Some(include_str!("../std/transform.kcl")),
        "vector" => Some(include_str!("../std/vector.kcl")),
        "hole" => Some(include_str!("../std/hole.kcl")),
        _ => None,
    }
}

/// Info about a module.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ModuleInfo {
    /// The ID of the module.
    pub(crate) id: ModuleId,
    /// Absolute path of the module's source file.
    pub(crate) path: ModulePath,
    pub(crate) repr: ModuleRepr,
}

impl ModuleInfo {
    pub(crate) fn take_repr(&mut self) -> ModuleRepr {
        let mut result = ModuleRepr::Dummy;
        std::mem::swap(&mut self.repr, &mut result);
        result
    }

    pub(crate) fn restore_repr(&mut self, repr: ModuleRepr) {
        assert!(matches!(&self.repr, ModuleRepr::Dummy));
        self.repr = repr;
    }
}

#[allow(clippy::large_enum_variant)]
#[derive(Debug, Clone, PartialEq, Serialize)]
pub enum ModuleRepr {
    Root,
    // AST, memory, exported names
    Kcl(
        Node<Program>,
        /// Cached execution outcome.
        Option<ModuleExecutionOutcome>,
    ),
    Foreign(PreImportedGeometry, Option<(Option<KclValue>, ModuleArtifactState)>),
    Dummy,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ModuleExecutionOutcome {
    pub last_expr: Option<KclValue>,
    pub environment: EnvironmentRef,
    pub exports: Vec<String>,
    pub artifacts: ModuleArtifactState,
}

#[allow(clippy::large_enum_variant)]
#[derive(Debug, Clone, Eq, PartialEq, Deserialize, Serialize, Hash, ts_rs::TS)]
#[serde(tag = "type")]
pub enum ModulePath {
    // The main file of the project.
    Main,
    Local {
        value: TypedPath,
        original_import_path: Option<TypedPath>,
    },
    Std {
        value: String,
    },
}

impl ModulePath {
    pub(crate) fn expect_path(&self) -> &TypedPath {
        match self {
            ModulePath::Local { value: p, .. } => p,
            _ => unreachable!(),
        }
    }

    pub(crate) async fn source(&self, fs: &FileManager, source_range: SourceRange) -> Result<ModuleSource, KclError> {
        match self {
            ModulePath::Local { value: p, .. } => Ok(ModuleSource {
                source: fs.read_to_string(p, source_range).await?,
                path: self.clone(),
            }),
            ModulePath::Std { value: name } => Ok(ModuleSource {
                source: read_std(name)
                    .ok_or_else(|| {
                        KclError::new_semantic(KclErrorDetails::new(
                            format!("Cannot find standard library module to import: std::{name}."),
                            vec![source_range],
                        ))
                    })
                    .map(str::to_owned)?,
                path: self.clone(),
            }),
            ModulePath::Main => unreachable!(),
        }
    }

    pub(crate) fn from_import_path(
        path: &ImportPath,
        project_directory: &Option<TypedPath>,
        import_from: &ModulePath,
    ) -> Result<Self, KclError> {
        match path {
            ImportPath::Kcl { filename: path } | ImportPath::Foreign { path } => {
                let resolved_path = match import_from {
                    ModulePath::Main => {
                        if let Some(project_dir) = project_directory {
                            project_dir.join_typed(path)
                        } else {
                            path.clone()
                        }
                    }
                    ModulePath::Local { value, .. } => {
                        let import_from_dir = value.parent();
                        let base = import_from_dir.as_ref().or(project_directory.as_ref());
                        if let Some(dir) = base {
                            dir.join_typed(path)
                        } else {
                            path.clone()
                        }
                    }
                    ModulePath::Std { .. } => {
                        let message = format!("Cannot import a non-std KCL file from std: {path}.");
                        debug_assert!(false, "{}", &message);
                        return Err(KclError::new_internal(KclErrorDetails::new(message, vec![])));
                    }
                };

                Ok(ModulePath::Local {
                    value: resolved_path,
                    original_import_path: Some(path.clone()),
                })
            }
            ImportPath::Std { path } => Self::from_std_import_path(path),
        }
    }

    pub(crate) fn from_std_import_path(path: &[String]) -> Result<Self, KclError> {
        // For now we only support importing from singly-nested modules inside std.
        if path.len() > 2 || path[0] != "std" {
            let message = format!("Invalid std import path: {path:?}.");
            debug_assert!(false, "{}", &message);
            return Err(KclError::new_internal(KclErrorDetails::new(message, vec![])));
        }

        if path.len() == 1 {
            Ok(ModulePath::Std {
                value: "prelude".to_owned(),
            })
        } else {
            Ok(ModulePath::Std { value: path[1].clone() })
        }
    }
}

impl fmt::Display for ModulePath {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ModulePath::Main => write!(f, "main"),
            ModulePath::Local { value: path, .. } => path.fmt(f),
            ModulePath::Std { value: s } => write!(f, "std::{s}"),
        }
    }
}

#[derive(Debug, Clone, Eq, PartialEq, Deserialize, Serialize, ts_rs::TS)]
pub struct ModuleSource {
    pub path: ModulePath,
    pub source: String,
}
