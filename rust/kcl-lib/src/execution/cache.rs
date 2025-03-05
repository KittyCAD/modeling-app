//! Functions for helping with caching an ast and finding the parts the changed.

use std::sync::Arc;

use itertools::{EitherOrBoth, Itertools};
use tokio::sync::RwLock;

use crate::{
    execution::{annotations, memory::Stack, EnvironmentRef, ExecState, ExecutorSettings},
    parsing::ast::types::{Annotation, Node, Program},
    walk::Node as WalkNode,
};

lazy_static::lazy_static! {
    /// A static mutable lock for updating the last successful execution state for the cache.
    static ref OLD_AST: Arc<RwLock<Option<OldAstState>>> = Default::default();
    // The last successful run's memory. Not cleared after an unssuccessful run.
    static ref PREV_MEMORY: Arc<RwLock<Option<Stack>>> = Default::default();
}

/// Read the old ast memory from the lock.
pub(crate) async fn read_old_ast() -> Option<OldAstState> {
    let old_ast = OLD_AST.read().await;
    old_ast.clone()
}

pub(super) async fn write_old_ast(old_state: OldAstState) {
    let mut old_ast = OLD_AST.write().await;
    *old_ast = Some(old_state);
}

pub(crate) async fn read_old_memory() -> Option<Stack> {
    let old_mem = PREV_MEMORY.read().await;
    old_mem.clone()
}

pub(super) async fn write_old_memory(mem: Stack) {
    let mut old_mem = PREV_MEMORY.write().await;
    *old_mem = Some(mem);
}

pub async fn bust_cache() {
    let mut old_ast = OLD_AST.write().await;
    *old_ast = None;
}

pub async fn clear_mem_cache() {
    let mut old_mem = PREV_MEMORY.write().await;
    *old_mem = None;
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
    pub result_env: EnvironmentRef,
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
    let mut reapply_settings = false;

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
        reapply_settings = true;
    }

    // If the ASTs are the EXACT same we return None.
    // We don't even need to waste time computing the digests.
    if old.ast == new.ast {
        return CacheResult::NoAction(reapply_settings);
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
        return CacheResult::NoAction(reapply_settings);
    }

    // Check if the annotations are different.
    if !old_ast
        .inner_attrs
        .iter()
        .filter(annotations::is_significant)
        .zip_longest(new_ast.inner_attrs.iter().filter(annotations::is_significant))
        .all(|pair| {
            match pair {
                EitherOrBoth::Both(old, new) => {
                    // Compare annotations, ignoring source ranges.  Digests must
                    // have been computed before this.
                    let Annotation { name, properties, .. } = &old.inner;
                    let Annotation {
                        name: new_name,
                        properties: new_properties,
                        ..
                    } = &new.inner;

                    name.as_ref().map(|n| n.digest) == new_name.as_ref().map(|n| n.digest)
                        && properties
                            .as_ref()
                            .map(|props| props.iter().map(|p| p.digest).collect::<Vec<_>>())
                            == new_properties
                                .as_ref()
                                .map(|props| props.iter().map(|p| p.digest).collect::<Vec<_>>())
                }
                _ => false,
            }
        })
    {
        // If any of the annotations are different at the beginning of the
        // program, it's likely the settings, and we have to bust the cache and
        // re-execute the whole thing.
        return CacheResult::ReExecute {
            clear_scene: true,
            reapply_settings: true,
            program: new.ast.clone(),
        };
    }

    // Check if the changes were only to Non-code areas, like comments or whitespace.
    generate_changed_program(old_ast, new_ast, reapply_settings)
}

/// Force-generate a new CacheResult, even if one shouldn't be made. The
/// way in which this gets invoked should always be through
/// [get_changed_program]. This is purely to contain the logic on
/// how we construct a new [CacheResult].
///
/// Digests *must* be computed before calling this.
fn generate_changed_program(old_ast: Node<Program>, mut new_ast: Node<Program>, reapply_settings: bool) -> CacheResult {
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
            reapply_settings,
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
                reapply_settings,
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

            new_ast.body = new_ast.body[old_ast.body.len()..].to_owned();

            CacheResult::ReExecute {
                clear_scene: false,
                reapply_settings,
                program: new_ast,
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

            CacheResult::NoAction(reapply_settings)
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
shell(firstSketch, faces = ['end'], thickness = 0.25)"#;

        let (program, _, ctx, _) = parse_execute(new).await.unwrap();

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
shell(firstSketch, faces = ['end'], thickness = 0.25) "#;

        let new = r#"// Remove the end face for the extrusion.
firstSketch = startSketchOn('XY')
  |> startProfileAt([-12, 12], %)
  |> line(end = [24, 0])
  |> line(end = [0, -24])
  |> line(end = [-24, 0])
  |> close()
  |> extrude(length = 6)

// Remove the end face for the extrusion.
shell(firstSketch, faces = ['end'], thickness = 0.25)"#;

        let (program_old, _, ctx, _) = parse_execute(old).await.unwrap();

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
shell(firstSketch, faces = ['end'], thickness = 0.25) "#;

        let new = r#"// Remove the end face for the extrusion.
firstSketch = startSketchOn('XY')
  |> startProfileAt([-12, 12], %)
  |> line(end = [24, 0])
  |> line(end = [0, -24])
  |> line(end = [-24, 0])
  |> close()
  |> extrude(length = 6)

// Remove the end face for the extrusion.
shell(firstSketch, faces = ['end'], thickness = 0.25)"#;

        let (program, _, ctx, _) = parse_execute(old).await.unwrap();

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
    async fn test_get_changed_program_same_code_changed_code_comments_attrs() {
        let old = r#"@foo(whatever = whatever)
@bar
// Removed the end face for the extrusion.
firstSketch = startSketchOn('XY')
  |> startProfileAt([-12, 12], %)
  |> line(end = [24, 0])
  |> line(end = [0, -24])
  |> line(end = [-24, 0]) // my thing
  |> close()
  |> extrude(length = 6)

// Remove the end face for the extrusion.
shell(firstSketch, faces = ['end'], thickness = 0.25) "#;

        let new = r#"@foo(whatever = 42)
@baz
// Remove the end face for the extrusion.
firstSketch = startSketchOn('XY')
  |> startProfileAt([-12, 12], %)
  |> line(end = [24, 0])
  |> line(end = [0, -24])
  |> line(end = [-24, 0])
  |> close()
  |> extrude(length = 6)

// Remove the end face for the extrusion.
shell(firstSketch, faces = ['end'], thickness = 0.25)"#;

        let (program, _, ctx, _) = parse_execute(old).await.unwrap();

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
shell(firstSketch, faces = ['end'], thickness = 0.25)"#;

        let (program, _, mut ctx, _) = parse_execute(new).await.unwrap();

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
shell(firstSketch, faces = ['end'], thickness = 0.25)"#;

        let (program, _, mut ctx, _) = parse_execute(new).await.unwrap();

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
shell(firstSketch, faces = ['end'], thickness = 0.25)"#;

        let (program, _, mut ctx, _) = parse_execute(new).await.unwrap();

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

        // Change the settings back.
        let old_settings = ctx.settings.clone();
        ctx.settings.highlight_edges = !ctx.settings.highlight_edges;

        let result = get_changed_program(
            CacheInformation {
                ast: &program.ast,
                settings: &old_settings,
            },
            CacheInformation {
                ast: &program.ast,
                settings: &ctx.settings,
            },
        )
        .await;

        assert_eq!(result, CacheResult::NoAction(true));

        // Change the settings back.
        let old_settings = ctx.settings.clone();
        ctx.settings.highlight_edges = !ctx.settings.highlight_edges;

        let result = get_changed_program(
            CacheInformation {
                ast: &program.ast,
                settings: &old_settings,
            },
            CacheInformation {
                ast: &program.ast,
                settings: &ctx.settings,
            },
        )
        .await;

        assert_eq!(result, CacheResult::NoAction(true));
    }

    // Changing the units settings using an annotation with the exact same file
    // should bust the cache.
    #[tokio::test(flavor = "multi_thread")]
    async fn test_get_changed_program_same_code_but_different_unit_setting_using_annotation() {
        let old_code = r#"@settings(defaultLengthUnit = in)
startSketchOn('XY')
"#;
        let new_code = r#"@settings(defaultLengthUnit = mm)
startSketchOn('XY')
"#;

        let (program, _, ctx, _) = parse_execute(old_code).await.unwrap();

        let mut new_program = crate::Program::parse_no_errs(new_code).unwrap();
        new_program.compute_digest();

        let result = get_changed_program(
            CacheInformation {
                ast: &program.ast,
                settings: &ctx.settings,
            },
            CacheInformation {
                ast: &new_program.ast,
                settings: &ctx.settings,
            },
        )
        .await;

        assert_eq!(
            result,
            CacheResult::ReExecute {
                clear_scene: true,
                reapply_settings: true,
                program: new_program.ast
            }
        );
    }
}
