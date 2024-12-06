//! Functions for helping with caching an ast and finding the parts the changed.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::{
    executor::ExecState,
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
    pub settings: crate::executor::ExecutorSettings,
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

// Given an old ast, old program memory and new ast, find the parts of the code that need to be
// re-executed.
// This function should never error, because in the case of any internal error, we should just pop
// the cache.
pub fn get_changed_program(
    info: CacheInformation,
    new_settings: &crate::executor::ExecutorSettings,
) -> Option<CacheResult> {
    let Some(old) = info.old else {
        // We have no old info, we need to re-execute the whole thing.
        return Some(CacheResult {
            clear_scene: true,
            program: info.new_ast,
        });
    };

    // If the settings are different we need to bust the cache.
    // We specifically do this before checking if they are the exact same.
    if old.settings != *new_settings {
        return Some(CacheResult {
            clear_scene: true,
            program: info.new_ast,
        });
    }

    // If the ASTs are the EXACT same we return None.
    // We don't even need to waste time computing the digests.
    if old.ast == info.new_ast {
        return None;
    }

    let mut old_ast = old.ast.inner;
    old_ast.compute_digest();
    let mut new_ast = info.new_ast.inner.clone();
    new_ast.compute_digest();

    // Check if the digest is the same.
    if old_ast.digest == new_ast.digest {
        return None;
    }

    // Check if the changes were only to Non-code areas, like comments or whitespace.

    // For any unhandled cases just re-execute the whole thing.
    Some(CacheResult {
        clear_scene: true,
        program: info.new_ast,
    })
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use anyhow::Result;
    use pretty_assertions::assert_eq;

    use super::*;

    async fn execute(program: &crate::Program) -> Result<ExecState> {
        let ctx = crate::executor::ExecutorContext {
            engine: Arc::new(Box::new(crate::engine::conn_mock::EngineConnection::new().await?)),
            fs: Arc::new(crate::fs::FileManager::new()),
            stdlib: Arc::new(crate::std::StdLib::new()),
            settings: Default::default(),
            context_type: crate::executor::ContextType::Mock,
        };
        let mut exec_state = crate::executor::ExecState::default();
        ctx.run(program.clone().into(), &mut exec_state).await?;

        Ok(exec_state)
    }

    // Easy case where we have no old ast and memory.
    // We need to re-execute everything.
    #[test]
    fn test_get_changed_program_no_old_information() {
        let new = r#"// Remove the end face for the extrusion.
firstSketch = startSketchOn('XY')
  |> startProfileAt([-12, 12], %)
  |> line([24, 0], %)
  |> line([0, -24], %)
  |> line([-24, 0], %)
  |> close(%)
  |> extrude(6, %)

// Remove the end face for the extrusion.
shell({ faces = ['end'], thickness = 0.25 }, firstSketch)"#;
        let program = crate::Program::parse_no_errs(new).unwrap().ast;

        let result = get_changed_program(
            CacheInformation {
                old: None,
                new_ast: program.clone(),
            },
            &Default::default(),
        );

        assert!(result.is_some());

        let result = result.unwrap();

        assert_eq!(result.program, program);
        assert!(result.clear_scene);
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn test_get_changed_program_same_code() {
        let new = r#"// Remove the end face for the extrusion.
firstSketch = startSketchOn('XY')
  |> startProfileAt([-12, 12], %)
  |> line([24, 0], %)
  |> line([0, -24], %)
  |> line([-24, 0], %)
  |> close(%)
  |> extrude(6, %)

// Remove the end face for the extrusion.
shell({ faces = ['end'], thickness = 0.25 }, firstSketch)"#;
        let program = crate::Program::parse_no_errs(new).unwrap();

        let executed = execute(&program).await.unwrap();

        let result = get_changed_program(
            CacheInformation {
                old: Some(OldAstState {
                    ast: program.ast.clone(),
                    exec_state: executed,
                    settings: Default::default(),
                }),
                new_ast: program.ast.clone(),
            },
            &Default::default(),
        );

        assert_eq!(result, None);
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn test_get_changed_program_same_code_changed_whitespace() {
        let old = r#" // Remove the end face for the extrusion.
firstSketch = startSketchOn('XY')
  |> startProfileAt([-12, 12], %)
  |> line([24, 0], %)
  |> line([0, -24], %)
  |> line([-24, 0], %)
  |> close(%)
  |> extrude(6, %)

// Remove the end face for the extrusion.
shell({ faces = ['end'], thickness = 0.25 }, firstSketch) "#;

        let new = r#"// Remove the end face for the extrusion.
firstSketch = startSketchOn('XY')
  |> startProfileAt([-12, 12], %)
  |> line([24, 0], %)
  |> line([0, -24], %)
  |> line([-24, 0], %)
  |> close(%)
  |> extrude(6, %)

// Remove the end face for the extrusion.
shell({ faces = ['end'], thickness = 0.25 }, firstSketch)"#;
        let program_old = crate::Program::parse_no_errs(old).unwrap();

        let executed = execute(&program_old).await.unwrap();

        let program_new = crate::Program::parse_no_errs(new).unwrap();

        let result = get_changed_program(
            CacheInformation {
                old: Some(OldAstState {
                    ast: program_old.ast.clone(),
                    exec_state: executed,
                    settings: Default::default(),
                }),
                new_ast: program_new.ast.clone(),
            },
            &Default::default(),
        );

        assert_eq!(result, None);
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn test_get_changed_program_same_code_changed_code_comment_start_of_program() {
        let old = r#" // Removed the end face for the extrusion.
firstSketch = startSketchOn('XY')
  |> startProfileAt([-12, 12], %)
  |> line([24, 0], %)
  |> line([0, -24], %)
  |> line([-24, 0], %)
  |> close(%)
  |> extrude(6, %)

// Remove the end face for the extrusion.
shell({ faces = ['end'], thickness = 0.25 }, firstSketch) "#;

        let new = r#"// Remove the end face for the extrusion.
firstSketch = startSketchOn('XY')
  |> startProfileAt([-12, 12], %)
  |> line([24, 0], %)
  |> line([0, -24], %)
  |> line([-24, 0], %)
  |> close(%)
  |> extrude(6, %)

// Remove the end face for the extrusion.
shell({ faces = ['end'], thickness = 0.25 }, firstSketch)"#;
        let program_old = crate::Program::parse_no_errs(old).unwrap();

        let executed = execute(&program_old).await.unwrap();

        let program_new = crate::Program::parse_no_errs(new).unwrap();

        let result = get_changed_program(
            CacheInformation {
                old: Some(OldAstState {
                    ast: program_old.ast.clone(),
                    exec_state: executed,
                    settings: Default::default(),
                }),
                new_ast: program_new.ast.clone(),
            },
            &Default::default(),
        );

        assert_eq!(result, None);
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn test_get_changed_program_same_code_changed_code_comments() {
        let old = r#" // Removed the end face for the extrusion.
firstSketch = startSketchOn('XY')
  |> startProfileAt([-12, 12], %)
  |> line([24, 0], %)
  |> line([0, -24], %)
  |> line([-24, 0], %) // my thing
  |> close(%)
  |> extrude(6, %)

// Remove the end face for the extrusion.
shell({ faces = ['end'], thickness = 0.25 }, firstSketch) "#;

        let new = r#"// Remove the end face for the extrusion.
firstSketch = startSketchOn('XY')
  |> startProfileAt([-12, 12], %)
  |> line([24, 0], %)
  |> line([0, -24], %)
  |> line([-24, 0], %)
  |> close(%)
  |> extrude(6, %)

// Remove the end face for the extrusion.
shell({ faces = ['end'], thickness = 0.25 }, firstSketch)"#;
        let program_old = crate::Program::parse_no_errs(old).unwrap();

        let executed = execute(&program_old).await.unwrap();

        let program_new = crate::Program::parse_no_errs(new).unwrap();

        let result = get_changed_program(
            CacheInformation {
                old: Some(OldAstState {
                    ast: program_old.ast.clone(),
                    exec_state: executed,
                    settings: Default::default(),
                }),
                new_ast: program_new.ast.clone(),
            },
            &Default::default(),
        );

        assert!(result.is_some());

        let result = result.unwrap();

        assert_eq!(result.program, program_new.ast);
        assert!(result.clear_scene);
    }

    // Changing the units with the exact same file should bust the cache.
    #[tokio::test(flavor = "multi_thread")]
    async fn test_get_changed_program_same_code_but_different_units() {
        let new = r#"// Remove the end face for the extrusion.
firstSketch = startSketchOn('XY')
  |> startProfileAt([-12, 12], %)
  |> line([24, 0], %)
  |> line([0, -24], %)
  |> line([-24, 0], %)
  |> close(%)
  |> extrude(6, %)

// Remove the end face for the extrusion.
shell({ faces = ['end'], thickness = 0.25 }, firstSketch)"#;
        let program = crate::Program::parse_no_errs(new).unwrap();

        let executed = execute(&program).await.unwrap();

        let result = get_changed_program(
            CacheInformation {
                old: Some(OldAstState {
                    ast: program.ast.clone(),
                    exec_state: executed,
                    settings: Default::default(),
                }),
                new_ast: program.ast.clone(),
            },
            &crate::ExecutorSettings {
                units: crate::UnitLength::Cm,
                ..Default::default()
            },
        );

        assert!(result.is_some());

        let result = result.unwrap();

        assert_eq!(result.program, program.ast);
        assert!(result.clear_scene);
    }
}
