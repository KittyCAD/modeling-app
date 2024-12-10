//! Functions for helping with caching an ast and finding the parts the changed.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::{
    execution::ExecState,
    parsing::ast::types::{Node, Program},
};

/// Information for the caching an AST and smartly re-executing it if we can.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
pub struct CacheInformation {
    /// The old information.
    pub old: Option<OldAstState>,
    /// The new ast to executed.
    pub new_ast: Node<Program>,
}

/// The old ast and program memory.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
pub struct OldAstState {
    /// The ast.
    pub ast: Node<Program>,
    /// The exec state.
    pub exec_state: ExecState,
    /// The last settings used for execution.
    pub settings: crate::execution::ExecutorSettings,
}

impl From<crate::Program> for CacheInformation {
    fn from(program: crate::Program) -> Self {
        CacheInformation {
            old: None,
            new_ast: program.ast,
        }
    }
}

/// The result of a cache check.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
pub struct CacheResult {
    /// Should we clear the scene and start over?
    pub clear_scene: bool,
    /// The program that needs to be executed.
    pub program: Node<Program>,
}
