//! Functions for helping with caching an ast and finding the parts the changed.

use std::sync::Arc;

use tokio::sync::RwLock;

use crate::{
    execution::{ExecState, ExecutorSettings},
    parsing::ast::types::{Node, Program},
    walk::Node as WalkNode,
};

lazy_static::lazy_static! {
    /// A static mutable lock for updating the last successful execution state for the cache.
    static ref OLD_AST_MEMORY: Arc<RwLock<Option<OldAstState>>> = Default::default();
}

/// Read the old ast memory from the lock.
pub(super) async fn read_old_ast_memory() -> Option<OldAstState> {
    let old_ast = OLD_AST_MEMORY.read().await;
    old_ast.clone()
}

pub(super) async fn write_old_ast_memory(old_state: OldAstState) {
    let mut old_ast = OLD_AST_MEMORY.write().await;
    *old_ast = Some(old_state);
}

pub async fn bust_cache() {
    let mut old_ast = OLD_AST_MEMORY.write().await;
    // Set the cache to None.
    *old_ast = None;
}

/// Information for the caching an AST and smartly re-executing it if we can.
#[derive(Debug, Clone)]
pub struct CacheInformation<'a> {
    pub ast: &'a Node<Program>,
    pub settings: &'a ExecutorSettings,
}

/// The old ast and program memory.
#[derive(Debug, Clone)]
pub struct OldAstState {
    /// The ast.
    pub ast: Node<Program>,
    /// The exec state.
    pub exec_state: ExecState,
    /// The last settings used for execution.
    pub settings: crate::execution::ExecutorSettings,
}

/// The result of a cache check.
#[derive(Debug, Clone, PartialEq)]
#[allow(clippy::large_enum_variant)]
pub(super) enum CacheResult {
    ReExecute {
        /// Should we clear the scene and start over?
        clear_scene: bool,
        /// Do we need to reapply settings?
        reapply_settings: bool,
        /// The program that needs to be executed.
        program: Node<Program>,
    },
    /// Argument is whether we need to reapply settings.
    NoAction(bool),
}

/// Given an old ast, old program memory and new ast, find the parts of the code that need to be
/// re-executed.
/// This function should never error, because in the case of any internal error, we should just pop
/// the cache.
///
/// Returns `None` when there are no changes to the program, i.e. it is
/// fully cached.
pub(super) async fn get_changed_program(old: CacheInformation<'_>, new: CacheInformation<'_>) -> CacheResult {
    let mut try_reapply_settings = false;

    // If the settings are different we might need to bust the cache.
    // We specifically do this before checking if they are the exact same.
    if old.settings != new.settings {
        // If the units are different we need to re-execute the whole thing.
        if old.settings.units != new.settings.units {
            return CacheResult::ReExecute {
                clear_scene: true,
                reapply_settings: true,
                program: new.ast.clone(),
            };
        }

        // If anything else is different we may not need to re-execute, but rather just
        // run the settings again.
        try_reapply_settings = true;
    }

    // If the ASTs are the EXACT same we return None.
    // We don't even need to waste time computing the digests.
    if old.ast == new.ast {
        return CacheResult::NoAction(try_reapply_settings);
    }

    // We have to clone just because the digests are stored inline :-(
    let mut old_ast = old.ast.clone();
    let mut new_ast = new.ast.clone();

    // The digests should already be computed, but just in case we don't
    // want to compare against none.
    old_ast.compute_digest();
    new_ast.compute_digest();

    // Check if the digest is the same.
    if old_ast.digest == new_ast.digest {
        return CacheResult::NoAction(try_reapply_settings);
    }

    // Check if the changes were only to Non-code areas, like comments or whitespace.
    let (clear_scene, program) = generate_changed_program(old_ast, new_ast);
    CacheResult::ReExecute {
        clear_scene,
        reapply_settings: try_reapply_settings,
        program,
    }
}

/// Force-generate a new CacheResult, even if one shouldn't be made. The
/// way in which this gets invoked should always be through
/// [get_changed_program]. This is purely to contain the logic on
/// how we construct a new [CacheResult].
fn generate_changed_program(old_ast: Node<Program>, mut new_ast: Node<Program>) -> (bool, Node<Program>) {
    if !old_ast.body.iter().zip(new_ast.body.iter()).all(|(old, new)| {
        let old_node: WalkNode = old.into();
        let new_node: WalkNode = new.into();
        old_node.digest() == new_node.digest()
    }) {
        // If any of the nodes are different in the stretch of body that
        // overlaps, we have to bust cache and rebuild the scene. This
        // means a single insertion or deletion will result in a cache
        // bust.

        return (true, new_ast);
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
            (true, new_ast)
        }
        std::cmp::Ordering::Greater => {
            // the new AST is longer than the old AST, which means
            // statements were added to the new code we haven't previously
            // seen.
            //
            // Statements up until now are the same, which means this
            // is a "pure addition" of the remaining slice.

            new_ast.body = new_ast.body[old_ast.body.len()..].to_owned();

            (false, new_ast)
        }
        std::cmp::Ordering::Equal => {
            // currently unreachable, but let's pretend like the code
            // above can do something meaningful here for when we get
            // to diffing and yanking chunks of the program apart.

            // We don't actually want to do anything here; so we're going
            // to not clear and do nothing. Is this wrong? I don't think
            // so but i think many things. This def needs to change
            // when the code above changes.

            new_ast.body = vec![];

            (false, new_ast)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::execution::parse_execute;

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

        let (program, ctx, _) = parse_execute(new).await.unwrap();

        let result = get_changed_program(
            CacheInformation {
                ast: &program.ast,
                settings: &ctx.settings,
            },
            CacheInformation {
                ast: &program.ast,
                settings: &ctx.settings,
            },
        )
        .await;

        assert_eq!(result, CacheResult::NoAction(false));
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

        let (program_old, ctx, _) = parse_execute(old).await.unwrap();

        let program_new = crate::Program::parse_no_errs(new).unwrap();

        let result = get_changed_program(
            CacheInformation {
                ast: &program_old.ast,
                settings: &ctx.settings,
            },
            CacheInformation {
                ast: &program_new.ast,
                settings: &ctx.settings,
            },
        )
        .await;

        assert_eq!(result, CacheResult::NoAction(false));
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

        let (program, ctx, _) = parse_execute(old).await.unwrap();

        let program_new = crate::Program::parse_no_errs(new).unwrap();

        let result = get_changed_program(
            CacheInformation {
                ast: &program.ast,
                settings: &ctx.settings,
            },
            CacheInformation {
                ast: &program_new.ast,
                settings: &ctx.settings,
            },
        )
        .await;

        assert_eq!(result, CacheResult::NoAction(false));
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

        let (program, ctx, _) = parse_execute(old).await.unwrap();

        let program_new = crate::Program::parse_no_errs(new).unwrap();

        let result = get_changed_program(
            CacheInformation {
                ast: &program.ast,
                settings: &ctx.settings,
            },
            CacheInformation {
                ast: &program_new.ast,
                settings: &ctx.settings,
            },
        )
        .await;

        assert_eq!(result, CacheResult::NoAction(false));
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

        let (program, mut ctx, _) = parse_execute(new).await.unwrap();

        // Change the settings to cm.
        ctx.settings.units = crate::UnitLength::Cm;

        let result = get_changed_program(
            CacheInformation {
                ast: &program.ast,
                settings: &Default::default(),
            },
            CacheInformation {
                ast: &program.ast,
                settings: &ctx.settings,
            },
        )
        .await;

        assert_eq!(
            result,
            CacheResult::ReExecute {
                clear_scene: true,
                reapply_settings: true,
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

        let (program, mut ctx, _) = parse_execute(new).await.unwrap();

        // Change the settings.
        ctx.settings.show_grid = !ctx.settings.show_grid;

        let result = get_changed_program(
            CacheInformation {
                ast: &program.ast,
                settings: &Default::default(),
            },
            CacheInformation {
                ast: &program.ast,
                settings: &ctx.settings,
            },
        )
        .await;

        assert_eq!(result, CacheResult::NoAction(true));
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

        let (program, mut ctx, _) = parse_execute(new).await.unwrap();

        // Change the settings.
        ctx.settings.highlight_edges = !ctx.settings.highlight_edges;

        let result = get_changed_program(
            CacheInformation {
                ast: &program.ast,
                settings: &Default::default(),
            },
            CacheInformation {
                ast: &program.ast,
                settings: &ctx.settings,
            },
        )
        .await;

        assert_eq!(result, CacheResult::NoAction(true));
    }
}
