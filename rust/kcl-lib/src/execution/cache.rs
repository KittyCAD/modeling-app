//! Functions for helping with caching an ast and finding the parts the changed.

use std::sync::Arc;

use itertools::{EitherOrBoth, Itertools};
use tokio::sync::RwLock;

use crate::{
    ExecOutcome, ExecutorContext,
    execution::{
        EnvironmentRef, ExecutorSettings, annotations,
        memory::Stack,
        state::{self as exec_state, ModuleInfoMap},
    },
    parsing::ast::types::{Annotation, Node, Program},
    walk::Node as WalkNode,
};

lazy_static::lazy_static! {
    /// A static mutable lock for updating the last successful execution state for the cache.
    static ref OLD_AST: Arc<RwLock<Option<GlobalState>>> = Default::default();
    // The last successful run's memory. Not cleared after an unsuccessful run.
    static ref PREV_MEMORY: Arc<RwLock<Option<(Stack, ModuleInfoMap)>>> = Default::default();
}

/// Read the old ast memory from the lock.
pub(super) async fn read_old_ast() -> Option<GlobalState> {
    let old_ast = OLD_AST.read().await;
    old_ast.clone()
}

pub(super) async fn write_old_ast(old_state: GlobalState) {
    let mut old_ast = OLD_AST.write().await;
    *old_ast = Some(old_state);
}

pub(crate) async fn read_old_memory() -> Option<(Stack, ModuleInfoMap)> {
    let old_mem = PREV_MEMORY.read().await;
    old_mem.clone()
}

pub(crate) async fn write_old_memory(mem: (Stack, ModuleInfoMap)) {
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

/// The cached state of the whole program.
#[derive(Debug, Clone)]
pub(super) struct GlobalState {
    pub(super) main: ModuleState,
    /// The exec state.
    pub(super) exec_state: exec_state::GlobalState,
    /// The last settings used for execution.
    pub(super) settings: ExecutorSettings,
}

impl GlobalState {
    pub fn new(
        state: exec_state::ExecState,
        settings: ExecutorSettings,
        ast: Node<Program>,
        result_env: EnvironmentRef,
    ) -> Self {
        Self {
            main: ModuleState {
                ast,
                exec_state: state.mod_local,
                result_env,
            },
            exec_state: state.global,
            settings,
        }
    }

    pub fn with_settings(mut self, settings: ExecutorSettings) -> GlobalState {
        self.settings = settings;
        self
    }

    pub fn reconstitute_exec_state(&self) -> exec_state::ExecState {
        exec_state::ExecState {
            global: self.exec_state.clone(),
            mod_local: self.main.exec_state.clone(),
        }
    }

    pub async fn into_exec_outcome(self, ctx: &ExecutorContext) -> ExecOutcome {
        // Fields are opt-in so that we don't accidentally leak private internal
        // state when we add more to ExecState.
        ExecOutcome {
            variables: self.main.exec_state.variables(self.main.result_env),
            filenames: self.exec_state.filenames(),
            #[cfg(feature = "artifact-graph")]
            operations: self.exec_state.root_module_artifacts.operations,
            #[cfg(feature = "artifact-graph")]
            artifact_graph: self.exec_state.artifacts.graph,
            errors: self.exec_state.errors,
            default_planes: ctx.engine.get_default_planes().read().await.clone(),
        }
    }
}

/// Per-module cached state
#[derive(Debug, Clone)]
pub(super) struct ModuleState {
    /// The AST of the module.
    pub(super) ast: Node<Program>,
    /// The ExecState of the module.
    pub(super) exec_state: exec_state::ModuleState,
    /// The memory env for the module.
    pub(super) result_env: EnvironmentRef,
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
    /// Check only the imports, and not the main program.
    /// Before sending this we already checked the main program and it is the same.
    /// And we made sure the import statements > 0.
    CheckImportsOnly {
        /// Argument is whether we need to reapply settings.
        reapply_settings: bool,
        /// The ast of the main file, which did not change.
        ast: Node<Program>,
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
        // If anything else is different we may not need to re-execute, but rather just
        // run the settings again.
        reapply_settings = true;
    }

    // If the ASTs are the EXACT same we return None.
    // We don't even need to waste time computing the digests.
    if old.ast == new.ast {
        // First we need to make sure an imported file didn't change it's ast.
        // We know they have the same imports because the ast is the same.
        // If we have no imports, we can skip this.
        if !old.ast.has_import_statements() {
            return CacheResult::NoAction(reapply_settings);
        }

        // Tell the CacheResult we need to check all the imports, but the main ast is the same.
        return CacheResult::CheckImportsOnly {
            reapply_settings,
            ast: old.ast.clone(),
        };
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
        // First we need to make sure an imported file didn't change it's ast.
        // We know they have the same imports because the ast is the same.
        // If we have no imports, we can skip this.
        if !old.ast.has_import_statements() {
            return CacheResult::NoAction(reapply_settings);
        }

        // Tell the CacheResult we need to check all the imports, but the main ast is the same.
        return CacheResult::CheckImportsOnly {
            reapply_settings,
            ast: old.ast.clone(),
        };
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
    use pretty_assertions::assert_eq;

    use super::*;
    use crate::execution::{ExecTestResults, parse_execute, parse_execute_with_project_dir};

    #[tokio::test(flavor = "multi_thread")]
    async fn test_get_changed_program_same_code() {
        let new = r#"// Remove the end face for the extrusion.
firstSketch = startSketchOn(XY)
  |> startProfile(at = [-12, 12])
  |> line(end = [24, 0])
  |> line(end = [0, -24])
  |> line(end = [-24, 0])
  |> close()
  |> extrude(length = 6)

// Remove the end face for the extrusion.
shell(firstSketch, faces = [END], thickness = 0.25)"#;

        let ExecTestResults { program, exec_ctxt, .. } = parse_execute(new).await.unwrap();

        let result = get_changed_program(
            CacheInformation {
                ast: &program.ast,
                settings: &exec_ctxt.settings,
            },
            CacheInformation {
                ast: &program.ast,
                settings: &exec_ctxt.settings,
            },
        )
        .await;

        assert_eq!(result, CacheResult::NoAction(false));
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn test_get_changed_program_same_code_changed_whitespace() {
        let old = r#" // Remove the end face for the extrusion.
firstSketch = startSketchOn(XY)
  |> startProfile(at = [-12, 12])
  |> line(end = [24, 0])
  |> line(end = [0, -24])
  |> line(end = [-24, 0])
  |> close()
  |> extrude(length = 6)

// Remove the end face for the extrusion.
shell(firstSketch, faces = [END], thickness = 0.25) "#;

        let new = r#"// Remove the end face for the extrusion.
firstSketch = startSketchOn(XY)
  |> startProfile(at = [-12, 12])
  |> line(end = [24, 0])
  |> line(end = [0, -24])
  |> line(end = [-24, 0])
  |> close()
  |> extrude(length = 6)

// Remove the end face for the extrusion.
shell(firstSketch, faces = [END], thickness = 0.25)"#;

        let ExecTestResults { program, exec_ctxt, .. } = parse_execute(old).await.unwrap();

        let program_new = crate::Program::parse_no_errs(new).unwrap();

        let result = get_changed_program(
            CacheInformation {
                ast: &program.ast,
                settings: &exec_ctxt.settings,
            },
            CacheInformation {
                ast: &program_new.ast,
                settings: &exec_ctxt.settings,
            },
        )
        .await;

        assert_eq!(result, CacheResult::NoAction(false));
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn test_get_changed_program_same_code_changed_code_comment_start_of_program() {
        let old = r#" // Removed the end face for the extrusion.
firstSketch = startSketchOn(XY)
  |> startProfile(at = [-12, 12])
  |> line(end = [24, 0])
  |> line(end = [0, -24])
  |> line(end = [-24, 0])
  |> close()
  |> extrude(length = 6)

// Remove the end face for the extrusion.
shell(firstSketch, faces = [END], thickness = 0.25) "#;

        let new = r#"// Remove the end face for the extrusion.
firstSketch = startSketchOn(XY)
  |> startProfile(at = [-12, 12])
  |> line(end = [24, 0])
  |> line(end = [0, -24])
  |> line(end = [-24, 0])
  |> close()
  |> extrude(length = 6)

// Remove the end face for the extrusion.
shell(firstSketch, faces = [END], thickness = 0.25)"#;

        let ExecTestResults { program, exec_ctxt, .. } = parse_execute(old).await.unwrap();

        let program_new = crate::Program::parse_no_errs(new).unwrap();

        let result = get_changed_program(
            CacheInformation {
                ast: &program.ast,
                settings: &exec_ctxt.settings,
            },
            CacheInformation {
                ast: &program_new.ast,
                settings: &exec_ctxt.settings,
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
firstSketch = startSketchOn(XY)
  |> startProfile(at = [-12, 12])
  |> line(end = [24, 0])
  |> line(end = [0, -24])
  |> line(end = [-24, 0]) // my thing
  |> close()
  |> extrude(length = 6)

// Remove the end face for the extrusion.
shell(firstSketch, faces = [END], thickness = 0.25) "#;

        let new = r#"@foo(whatever = 42)
@baz
// Remove the end face for the extrusion.
firstSketch = startSketchOn(XY)
  |> startProfile(at = [-12, 12])
  |> line(end = [24, 0])
  |> line(end = [0, -24])
  |> line(end = [-24, 0])
  |> close()
  |> extrude(length = 6)

// Remove the end face for the extrusion.
shell(firstSketch, faces = [END], thickness = 0.25)"#;

        let ExecTestResults { program, exec_ctxt, .. } = parse_execute(old).await.unwrap();

        let program_new = crate::Program::parse_no_errs(new).unwrap();

        let result = get_changed_program(
            CacheInformation {
                ast: &program.ast,
                settings: &exec_ctxt.settings,
            },
            CacheInformation {
                ast: &program_new.ast,
                settings: &exec_ctxt.settings,
            },
        )
        .await;

        assert_eq!(result, CacheResult::NoAction(false));
    }

    // Changing the grid settings with the exact same file should NOT bust the cache.
    #[tokio::test(flavor = "multi_thread")]
    async fn test_get_changed_program_same_code_but_different_grid_setting() {
        let new = r#"// Remove the end face for the extrusion.
firstSketch = startSketchOn(XY)
  |> startProfile(at = [-12, 12])
  |> line(end = [24, 0])
  |> line(end = [0, -24])
  |> line(end = [-24, 0])
  |> close()
  |> extrude(length = 6)

// Remove the end face for the extrusion.
shell(firstSketch, faces = [END], thickness = 0.25)"#;

        let ExecTestResults {
            program, mut exec_ctxt, ..
        } = parse_execute(new).await.unwrap();

        // Change the settings.
        exec_ctxt.settings.show_grid = !exec_ctxt.settings.show_grid;

        let result = get_changed_program(
            CacheInformation {
                ast: &program.ast,
                settings: &Default::default(),
            },
            CacheInformation {
                ast: &program.ast,
                settings: &exec_ctxt.settings,
            },
        )
        .await;

        assert_eq!(result, CacheResult::NoAction(true));
    }

    // Changing the edge visibility settings with the exact same file should NOT bust the cache.
    #[tokio::test(flavor = "multi_thread")]
    async fn test_get_changed_program_same_code_but_different_edge_visibility_setting() {
        let new = r#"// Remove the end face for the extrusion.
firstSketch = startSketchOn(XY)
  |> startProfile(at = [-12, 12])
  |> line(end = [24, 0])
  |> line(end = [0, -24])
  |> line(end = [-24, 0])
  |> close()
  |> extrude(length = 6)

// Remove the end face for the extrusion.
shell(firstSketch, faces = [END], thickness = 0.25)"#;

        let ExecTestResults {
            program, mut exec_ctxt, ..
        } = parse_execute(new).await.unwrap();

        // Change the settings.
        exec_ctxt.settings.highlight_edges = !exec_ctxt.settings.highlight_edges;

        let result = get_changed_program(
            CacheInformation {
                ast: &program.ast,
                settings: &Default::default(),
            },
            CacheInformation {
                ast: &program.ast,
                settings: &exec_ctxt.settings,
            },
        )
        .await;

        assert_eq!(result, CacheResult::NoAction(true));

        // Change the settings back.
        let old_settings = exec_ctxt.settings.clone();
        exec_ctxt.settings.highlight_edges = !exec_ctxt.settings.highlight_edges;

        let result = get_changed_program(
            CacheInformation {
                ast: &program.ast,
                settings: &old_settings,
            },
            CacheInformation {
                ast: &program.ast,
                settings: &exec_ctxt.settings,
            },
        )
        .await;

        assert_eq!(result, CacheResult::NoAction(true));

        // Change the settings back.
        let old_settings = exec_ctxt.settings.clone();
        exec_ctxt.settings.highlight_edges = !exec_ctxt.settings.highlight_edges;

        let result = get_changed_program(
            CacheInformation {
                ast: &program.ast,
                settings: &old_settings,
            },
            CacheInformation {
                ast: &program.ast,
                settings: &exec_ctxt.settings,
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
startSketchOn(XY)
"#;
        let new_code = r#"@settings(defaultLengthUnit = mm)
startSketchOn(XY)
"#;

        let ExecTestResults { program, exec_ctxt, .. } = parse_execute(old_code).await.unwrap();

        let mut new_program = crate::Program::parse_no_errs(new_code).unwrap();
        new_program.compute_digest();

        let result = get_changed_program(
            CacheInformation {
                ast: &program.ast,
                settings: &exec_ctxt.settings,
            },
            CacheInformation {
                ast: &new_program.ast,
                settings: &exec_ctxt.settings,
            },
        )
        .await;

        assert_eq!(
            result,
            CacheResult::ReExecute {
                clear_scene: true,
                reapply_settings: true,
                program: new_program.ast,
            }
        );
    }

    // Removing the units settings using an annotation, when it was non-default
    // units, with the exact same file should bust the cache.
    #[tokio::test(flavor = "multi_thread")]
    async fn test_get_changed_program_same_code_but_removed_unit_setting_using_annotation() {
        let old_code = r#"@settings(defaultLengthUnit = in)
startSketchOn(XY)
"#;
        let new_code = r#"
startSketchOn(XY)
"#;

        let ExecTestResults { program, exec_ctxt, .. } = parse_execute(old_code).await.unwrap();

        let mut new_program = crate::Program::parse_no_errs(new_code).unwrap();
        new_program.compute_digest();

        let result = get_changed_program(
            CacheInformation {
                ast: &program.ast,
                settings: &exec_ctxt.settings,
            },
            CacheInformation {
                ast: &new_program.ast,
                settings: &exec_ctxt.settings,
            },
        )
        .await;

        assert_eq!(
            result,
            CacheResult::ReExecute {
                clear_scene: true,
                reapply_settings: true,
                program: new_program.ast,
            }
        );
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn test_multi_file_no_changes_does_not_reexecute() {
        let code = r#"import "toBeImported.kcl" as importedCube

importedCube

sketch001 = startSketchOn(XZ)
profile001 = startProfile(sketch001, at = [-134.53, -56.17])
  |> angledLine(angle = 0, length = 79.05, tag = $rectangleSegmentA001)
  |> angledLine(angle = segAng(rectangleSegmentA001) - 90, length = 76.28)
  |> angledLine(angle = segAng(rectangleSegmentA001), length = -segLen(rectangleSegmentA001), tag = $seg01)
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)], tag = $seg02)
  |> close()
extrude001 = extrude(profile001, length = 100)
sketch003 = startSketchOn(extrude001, face = seg02)
sketch002 = startSketchOn(extrude001, face = seg01)
"#;

        let other_file = (
            std::path::PathBuf::from("toBeImported.kcl"),
            r#"sketch001 = startSketchOn(XZ)
profile001 = startProfile(sketch001, at = [281.54, 305.81])
  |> angledLine(angle = 0, length = 123.43, tag = $rectangleSegmentA001)
  |> angledLine(angle = segAng(rectangleSegmentA001) - 90, length = 85.99)
  |> angledLine(angle = segAng(rectangleSegmentA001), length = -segLen(rectangleSegmentA001))
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
extrude(profile001, length = 100)"#
                .to_string(),
        );

        let tmp_dir = std::env::temp_dir();
        let tmp_dir = tmp_dir.join(uuid::Uuid::new_v4().to_string());

        // Create a temporary file for each of the other files.
        let tmp_file = tmp_dir.join(other_file.0);
        std::fs::create_dir_all(tmp_file.parent().unwrap()).unwrap();
        std::fs::write(tmp_file, other_file.1).unwrap();

        let ExecTestResults { program, exec_ctxt, .. } =
            parse_execute_with_project_dir(code, Some(crate::TypedPath(tmp_dir)))
                .await
                .unwrap();

        let mut new_program = crate::Program::parse_no_errs(code).unwrap();
        new_program.compute_digest();

        let result = get_changed_program(
            CacheInformation {
                ast: &program.ast,
                settings: &exec_ctxt.settings,
            },
            CacheInformation {
                ast: &new_program.ast,
                settings: &exec_ctxt.settings,
            },
        )
        .await;

        let CacheResult::CheckImportsOnly { reapply_settings, .. } = result else {
            panic!("Expected CheckImportsOnly, got {result:?}");
        };

        assert_eq!(reapply_settings, false);
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn test_cache_multi_file_only_other_file_changes_should_reexecute() {
        let code = r#"import "toBeImported.kcl" as importedCube

importedCube

sketch001 = startSketchOn(XZ)
profile001 = startProfile(sketch001, at = [-134.53, -56.17])
  |> angledLine(angle = 0, length = 79.05, tag = $rectangleSegmentA001)
  |> angledLine(angle = segAng(rectangleSegmentA001) - 90, length = 76.28)
  |> angledLine(angle = segAng(rectangleSegmentA001), length = -segLen(rectangleSegmentA001), tag = $seg01)
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)], tag = $seg02)
  |> close()
extrude001 = extrude(profile001, length = 100)
sketch003 = startSketchOn(extrude001, face = seg02)
sketch002 = startSketchOn(extrude001, face = seg01)
"#;

        let other_file = (
            std::path::PathBuf::from("toBeImported.kcl"),
            r#"sketch001 = startSketchOn(XZ)
profile001 = startProfile(sketch001, at = [281.54, 305.81])
  |> angledLine(angle = 0, length = 123.43, tag = $rectangleSegmentA001)
  |> angledLine(angle = segAng(rectangleSegmentA001) - 90, length = 85.99)
  |> angledLine(angle = segAng(rectangleSegmentA001), length = -segLen(rectangleSegmentA001))
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
extrude(profile001, length = 100)"#
                .to_string(),
        );

        let other_file2 = (
            std::path::PathBuf::from("toBeImported.kcl"),
            r#"sketch001 = startSketchOn(XZ)
profile001 = startProfile(sketch001, at = [281.54, 305.81])
  |> angledLine(angle = 0, length = 123.43, tag = $rectangleSegmentA001)
  |> angledLine(angle = segAng(rectangleSegmentA001) - 90, length = 85.99)
  |> angledLine(angle = segAng(rectangleSegmentA001), length = -segLen(rectangleSegmentA001))
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
extrude(profile001, length = 100)
|> translate(z=100) 
"#
            .to_string(),
        );

        let tmp_dir = std::env::temp_dir();
        let tmp_dir = tmp_dir.join(uuid::Uuid::new_v4().to_string());

        // Create a temporary file for each of the other files.
        let tmp_file = tmp_dir.join(other_file.0);
        std::fs::create_dir_all(tmp_file.parent().unwrap()).unwrap();
        std::fs::write(&tmp_file, other_file.1).unwrap();

        let ExecTestResults { program, exec_ctxt, .. } =
            parse_execute_with_project_dir(code, Some(crate::TypedPath(tmp_dir)))
                .await
                .unwrap();

        // Change the other file.
        std::fs::write(tmp_file, other_file2.1).unwrap();

        let mut new_program = crate::Program::parse_no_errs(code).unwrap();
        new_program.compute_digest();

        let result = get_changed_program(
            CacheInformation {
                ast: &program.ast,
                settings: &exec_ctxt.settings,
            },
            CacheInformation {
                ast: &new_program.ast,
                settings: &exec_ctxt.settings,
            },
        )
        .await;

        let CacheResult::CheckImportsOnly { reapply_settings, .. } = result else {
            panic!("Expected CheckImportsOnly, got {result:?}");
        };

        assert_eq!(reapply_settings, false);
    }
}
