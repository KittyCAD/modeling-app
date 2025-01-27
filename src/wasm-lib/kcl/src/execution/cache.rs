//! Functions for helping with caching an ast and finding the parts the changed.

use serde::{Deserialize, Serialize};

use crate::{
    execution::ExecState,
    parsing::ast::types::{Node, Program},
    walk::Node as WalkNode,
};

use super::ExecutorSettings;

/// Information for the caching an AST and smartly re-executing it if we can.
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct CacheInformation {
    /// The old information.
    pub old: Option<OldAstState>,
    /// The new ast to executed.
    pub new_ast: Node<Program>,
}

/// The old ast and program memory.
#[derive(Debug, Clone, Deserialize, Serialize)]
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
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[allow(clippy::large_enum_variant)]
pub(super) enum CacheResult {
    ReExecute {
        /// Should we clear the scene and start over?
        clear_scene: bool,
        /// The program that needs to be executed.
        program: Node<Program>,
    },
    ReapplySettings,
    NoAction,
}

/// Given an old ast, old program memory and new ast, find the parts of the code that need to be
/// re-executed.
/// This function should never error, because in the case of any internal error, we should just pop
/// the cache.
///
/// Returns `None` when there are no changes to the program, i.e. it is
/// fully cached.
pub(super) async fn get_changed_program(info: CacheInformation, settings: &ExecutorSettings) -> CacheResult {
    let Some(old) = info.old else {
        // We have no old info, we need to re-execute the whole thing.
        return CacheResult::ReExecute {
            clear_scene: true,
            program: info.new_ast,
        };
    };

    // If the settings are different we might need to bust the cache.
    // We specifically do this before checking if they are the exact same.
    if &old.settings != settings {
        // If the units are different we need to re-execute the whole thing.
        if old.settings.units != settings.units {
            return CacheResult::ReExecute {
                clear_scene: true,
                program: info.new_ast,
            };
        }

        // If anything else is different we do not need to re-execute, but rather just
        // run the settings again.
        return CacheResult::ReapplySettings;
    }

    // If the ASTs are the EXACT same we return None.
    // We don't even need to waste time computing the digests.
    if old.ast == info.new_ast {
        return CacheResult::NoAction;
    }

    let mut old_ast = old.ast;
    let mut new_ast = info.new_ast;

    // The digests should already be computed, but just in case we don't
    // want to compare against none.
    old_ast.compute_digest();
    new_ast.compute_digest();

    // Check if the digest is the same.
    if old_ast.digest == new_ast.digest {
        return CacheResult::NoAction;
    }

    // Check if the changes were only to Non-code areas, like comments or whitespace.
    generate_changed_program(old_ast, new_ast)
}

/// Force-generate a new CacheResult, even if one shouldn't be made. The
/// way in which this gets invoked should always be through
/// [get_changed_program]. This is purely to contain the logic on
/// how we construct a new [CacheResult].
fn generate_changed_program(old_ast: Node<Program>, new_ast: Node<Program>) -> CacheResult {
    let mut generated_program = new_ast.clone();
    generated_program.body = vec![];

    if !old_ast.body.iter().zip(new_ast.body.iter()).all(|(old, new)| {
        let old_node: WalkNode = old.into();
        let new_node: WalkNode = new.into();
        old_node.digest() == new_node.digest()
    }) {
        // If any of the nodes are different in the stretch of body that
        // overlaps, we have to bust cache and rebuild the scene. This
        // means a single insertion or deletion will result in a cache
        // bust.

        return CacheResult::ReExecute {
            clear_scene: true,
            program: new_ast,
        };
    }

    // otherwise the overlapping section of the ast bodies matches.
    // Let's see what the rest of the slice looks like.

    match new_ast.body.len().cmp(&old_ast.body.len()) {
        std::cmp::Ordering::Less => {
            // the new AST is shorter than the old AST -- statements
            // were removed from the "current" code in the "new" code.
            //
            // Statements up until now match which means this is a
            // "pure delete" of the remaining slice, when we get to
            // supporting that.

            // Cache bust time.
            CacheResult::ReExecute {
                clear_scene: true,
                program: new_ast,
            }
        }
        std::cmp::Ordering::Greater => {
            // the new AST is longer than the old AST, which means
            // statements were added to the new code we haven't previously
            // seen.
            //
            // Statements up until now are the same, which means this
            // is a "pure addition" of the remaining slice.

            generated_program
                .body
                .extend_from_slice(&new_ast.body[old_ast.body.len()..]);

            CacheResult::ReExecute {
                clear_scene: false,
                program: generated_program,
            }
        }
        std::cmp::Ordering::Equal => {
            // currently unreachable, but let's pretend like the code
            // above can do something meaningful here for when we get
            // to diffing and yanking chunks of the program apart.

            // We don't actually want to do anything here; so we're going
            // to not clear and do nothing. Is this wrong? I don't think
            // so but i think many things. This def needs to change
            // when the code above changes.

            CacheResult::ReExecute {
                clear_scene: false,
                program: generated_program,
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use crate::execution::parse_execute;

    use super::*;

    // Easy case where we have no old ast and memory.
    // We need to re-execute everything.
    #[tokio::test(flavor = "multi_thread")]
    async fn test_get_changed_program_no_old_information() {
        let new = r#"// Remove the end face for the extrusion.
firstSketch = startSketchOn('XY')
  |> startProfileAt([-12, 12], %)
  |> line(end = [24, 0])
  |> line(end = [0, -24])
  |> line(end = [-24, 0])
  |> close()
  |> extrude(length = 6)

// Remove the end face for the extrusion.
shell({ faces = ['end'], thickness = 0.25 }, firstSketch)"#;
        let (program, ctx, _) = parse_execute(new).await.unwrap();

        let result = get_changed_program(
            CacheInformation {
                old: None,
                new_ast: program.ast.clone(),
            },
            &ctx.settings,
        )
        .await;

        assert_eq!(
            result,
            CacheResult::ReExecute {
                clear_scene: true,
                program: program.ast
            }
        );
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn test_get_changed_program_same_code() {
        let new = r#"// Remove the end face for the extrusion.
firstSketch = startSketchOn('XY')
  |> startProfileAt([-12, 12], %)
  |> line(end = [24, 0])
  |> line(end = [0, -24])
  |> line(end = [-24, 0])
  |> close()
  |> extrude(length = 6)

// Remove the end face for the extrusion.
shell({ faces = ['end'], thickness = 0.25 }, firstSketch)"#;

        let (program, ctx, exec_state) = parse_execute(new).await.unwrap();

        let result = get_changed_program(
            CacheInformation {
                old: Some(OldAstState {
                    ast: program.ast.clone(),
                    exec_state,
                    settings: Default::default(),
                }),
                new_ast: program.ast.clone(),
            },
            &ctx.settings,
        )
        .await;

        assert_eq!(result, CacheResult::NoAction);
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn test_get_changed_program_same_code_changed_whitespace() {
        let old = r#" // Remove the end face for the extrusion.
firstSketch = startSketchOn('XY')
  |> startProfileAt([-12, 12], %)
  |> line(end = [24, 0])
  |> line(end = [0, -24])
  |> line(end = [-24, 0])
  |> close()
  |> extrude(length = 6)

// Remove the end face for the extrusion.
shell({ faces = ['end'], thickness = 0.25 }, firstSketch) "#;

        let new = r#"// Remove the end face for the extrusion.
firstSketch = startSketchOn('XY')
  |> startProfileAt([-12, 12], %)
  |> line(end = [24, 0])
  |> line(end = [0, -24])
  |> line(end = [-24, 0])
  |> close()
  |> extrude(length = 6)

// Remove the end face for the extrusion.
shell({ faces = ['end'], thickness = 0.25 }, firstSketch)"#;

        let (program_old, ctx, exec_state) = parse_execute(old).await.unwrap();

        let program_new = crate::Program::parse_no_errs(new).unwrap();

        let result = get_changed_program(
            CacheInformation {
                old: Some(OldAstState {
                    ast: program_old.ast.clone(),
                    exec_state,
                    settings: Default::default(),
                }),
                new_ast: program_new.ast.clone(),
            },
            &ctx.settings,
        )
        .await;

        assert_eq!(result, CacheResult::NoAction);
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn test_get_changed_program_same_code_changed_code_comment_start_of_program() {
        let old = r#" // Removed the end face for the extrusion.
firstSketch = startSketchOn('XY')
  |> startProfileAt([-12, 12], %)
  |> line(end = [24, 0])
  |> line(end = [0, -24])
  |> line(end = [-24, 0])
  |> close()
  |> extrude(length = 6)

// Remove the end face for the extrusion.
shell({ faces = ['end'], thickness = 0.25 }, firstSketch) "#;

        let new = r#"// Remove the end face for the extrusion.
firstSketch = startSketchOn('XY')
  |> startProfileAt([-12, 12], %)
  |> line(end = [24, 0])
  |> line(end = [0, -24])
  |> line(end = [-24, 0])
  |> close()
  |> extrude(length = 6)

// Remove the end face for the extrusion.
shell({ faces = ['end'], thickness = 0.25 }, firstSketch)"#;

        let (program, ctx, exec_state) = parse_execute(old).await.unwrap();

        let program_new = crate::Program::parse_no_errs(new).unwrap();

        let result = get_changed_program(
            CacheInformation {
                old: Some(OldAstState {
                    ast: program.ast.clone(),
                    exec_state,
                    settings: Default::default(),
                }),
                new_ast: program_new.ast.clone(),
            },
            &ctx.settings,
        )
        .await;

        assert_eq!(result, CacheResult::NoAction);
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn test_get_changed_program_same_code_changed_code_comments() {
        let old = r#" // Removed the end face for the extrusion.
firstSketch = startSketchOn('XY')
  |> startProfileAt([-12, 12], %)
  |> line(end = [24, 0])
  |> line(end = [0, -24])
  |> line(end = [-24, 0]) // my thing
  |> close()
  |> extrude(length = 6)

// Remove the end face for the extrusion.
shell({ faces = ['end'], thickness = 0.25 }, firstSketch) "#;

        let new = r#"// Remove the end face for the extrusion.
firstSketch = startSketchOn('XY')
  |> startProfileAt([-12, 12], %)
  |> line(end = [24, 0])
  |> line(end = [0, -24])
  |> line(end = [-24, 0])
  |> close()
  |> extrude(length = 6)

// Remove the end face for the extrusion.
shell({ faces = ['end'], thickness = 0.25 }, firstSketch)"#;

        let (program, ctx, exec_state) = parse_execute(old).await.unwrap();

        let program_new = crate::Program::parse_no_errs(new).unwrap();

        let result = get_changed_program(
            CacheInformation {
                old: Some(OldAstState {
                    ast: program.ast.clone(),
                    exec_state,
                    settings: Default::default(),
                }),
                new_ast: program_new.ast.clone(),
            },
            &ctx.settings,
        )
        .await;

        assert_eq!(result, CacheResult::NoAction);
    }

    // Changing the units with the exact same file should bust the cache.
    #[tokio::test(flavor = "multi_thread")]
    async fn test_get_changed_program_same_code_but_different_units() {
        let new = r#"// Remove the end face for the extrusion.
firstSketch = startSketchOn('XY')
  |> startProfileAt([-12, 12], %)
  |> line(end = [24, 0])
  |> line(end = [0, -24])
  |> line(end = [-24, 0])
  |> close()
  |> extrude(length = 6)

// Remove the end face for the extrusion.
shell({ faces = ['end'], thickness = 0.25 }, firstSketch)"#;

        let (program, mut ctx, exec_state) = parse_execute(new).await.unwrap();

        // Change the settings to cm.
        ctx.settings.units = crate::UnitLength::Cm;

        let result = get_changed_program(
            CacheInformation {
                old: Some(OldAstState {
                    ast: program.ast.clone(),
                    exec_state,
                    settings: Default::default(),
                }),
                new_ast: program.ast.clone(),
            },
            &ctx.settings,
        )
        .await;

        assert_eq!(
            result,
            CacheResult::ReExecute {
                clear_scene: true,
                program: program.ast
            }
        );
    }

    // Changing the grid settings with the exact same file should NOT bust the cache.
    #[tokio::test(flavor = "multi_thread")]
    async fn test_get_changed_program_same_code_but_different_grid_setting() {
        let new = r#"// Remove the end face for the extrusion.
firstSketch = startSketchOn('XY')
  |> startProfileAt([-12, 12], %)
  |> line(end = [24, 0])
  |> line(end = [0, -24])
  |> line(end = [-24, 0])
  |> close()
  |> extrude(length = 6)

// Remove the end face for the extrusion.
shell({ faces = ['end'], thickness = 0.25 }, firstSketch)"#;

        let (program, mut ctx, exec_state) = parse_execute(new).await.unwrap();

        // Change the settings.
        ctx.settings.show_grid = !ctx.settings.show_grid;

        let result = get_changed_program(
            CacheInformation {
                old: Some(OldAstState {
                    ast: program.ast.clone(),
                    exec_state,
                    settings: Default::default(),
                }),
                new_ast: program.ast.clone(),
            },
            &ctx.settings,
        )
        .await;

        assert_eq!(result, CacheResult::ReapplySettings);
    }

    // Changing the edge visibility settings with the exact same file should NOT bust the cache.
    #[tokio::test(flavor = "multi_thread")]
    async fn test_get_changed_program_same_code_but_different_edge_visiblity_setting() {
        let new = r#"// Remove the end face for the extrusion.
firstSketch = startSketchOn('XY')
  |> startProfileAt([-12, 12], %)
  |> line(end = [24, 0])
  |> line(end = [0, -24])
  |> line(end = [-24, 0])
  |> close()
  |> extrude(length = 6)

// Remove the end face for the extrusion.
shell({ faces = ['end'], thickness = 0.25 }, firstSketch)"#;

        let (program, mut ctx, exec_state) = parse_execute(new).await.unwrap();

        // Change the settings.
        ctx.settings.highlight_edges = !ctx.settings.highlight_edges;

        let result = get_changed_program(
            CacheInformation {
                old: Some(OldAstState {
                    ast: program.ast.clone(),
                    exec_state,
                    settings: Default::default(),
                }),
                new_ast: program.ast.clone(),
            },
            &ctx.settings,
        )
        .await;

        assert_eq!(result, CacheResult::ReapplySettings);
    }
}
