use std::{
    panic::{AssertUnwindSafe, catch_unwind},
    path::{Path, PathBuf},
};

use indexmap::IndexMap;

use crate::{
    ExecOutcome, ExecState, ExecutorContext, ModuleId,
    errors::KclError,
    execution::{EnvironmentRef, ModuleArtifactState},
};
#[cfg(feature = "artifact-graph")]
use crate::{
    execution::ArtifactGraph,
    modules::{ModulePath, ModuleRepr},
};

mod kcl_samples;

/// A simulation test.
#[derive(Debug, Clone)]
struct Test {
    /// The name of the test.
    name: String,
    /// The KCL file that's the entry point, e.g. "main.kcl", in the `input_dir`.
    entry_point: PathBuf,
    /// Input KCL files are in this directory.
    input_dir: PathBuf,
    /// Expected snapshot output files are in this directory.
    output_dir: PathBuf,
    /// True to skip asserting the artifact graph and only write it. The default
    /// is false and to assert it.
    #[cfg_attr(not(feature = "artifact-graph"), expect(dead_code))]
    skip_assert_artifact_graph: bool,
}

pub(crate) const RENDERED_MODEL_NAME: &str = "rendered_model.png";

#[cfg(feature = "artifact-graph")]
const REPO_ROOT: &str = "../..";

impl Test {
    fn new(name: &str) -> Self {
        Self {
            name: name.to_owned(),
            entry_point: Path::new("tests").join(name).join("input.kcl"),
            input_dir: Path::new("tests").join(name),
            output_dir: Path::new("tests").join(name),
            skip_assert_artifact_graph: false,
        }
    }

    /// Read in the entry point file and return its contents as a string.
    pub fn read(&self) -> String {
        std::fs::read_to_string(&self.entry_point)
            .unwrap_or_else(|e| panic!("Failed to read file: {:?} due to {e}", self.entry_point))
    }
}

impl ExecState {
    /// Same as [`Self::into_exec_outcome`], but also returns the module state.
    async fn into_test_exec_outcome(
        self,
        main_ref: EnvironmentRef,
        ctx: &ExecutorContext,
        project_directory: &Path,
    ) -> (ExecOutcome, IndexMap<String, ModuleArtifactState>) {
        let module_state = self.to_module_state(project_directory);
        let outcome = self.into_exec_outcome(main_ref, ctx).await;
        (outcome, module_state)
    }

    #[cfg(not(feature = "artifact-graph"))]
    fn to_module_state(&self, _project_directory: &Path) -> IndexMap<String, ModuleArtifactState> {
        Default::default()
    }

    /// The keys of the map are the module paths.  Can't use `ModulePath` since
    /// it needs to be converted to a string to be a JSON object key.  The paths
    /// need to be relative so that generating locally works in CI.
    #[cfg(feature = "artifact-graph")]
    fn to_module_state(&self, _project_directory: &Path) -> IndexMap<String, ModuleArtifactState> {
        let project_directory = std::path::Path::new(REPO_ROOT)
            .canonicalize()
            .unwrap_or_else(|_| panic!("Failed to canonicalize project directory: {REPO_ROOT}"));
        let mut module_state = IndexMap::new();
        for info in self.modules().values() {
            let relative_path = relative_module_path(&info.path, &project_directory).unwrap_or_else(|err| {
                panic!(
                    "Failed to get relative module path for {:?} in {:?}; caused by {err:?}",
                    &info.path, project_directory
                )
            });
            match &info.repr {
                ModuleRepr::Root => {
                    module_state.insert(relative_path, self.root_module_artifact_state().clone());
                }
                ModuleRepr::Kcl(_, None) => {
                    module_state.insert(relative_path, Default::default());
                }
                ModuleRepr::Kcl(_, Some((_, _, _, module_artifacts))) => {
                    module_state.insert(relative_path, module_artifacts.clone());
                }
                ModuleRepr::Foreign(_, Some((_, module_artifacts))) => {
                    module_state.insert(relative_path, module_artifacts.clone());
                }
                ModuleRepr::Foreign(_, None) | ModuleRepr::Dummy => {}
            }
        }
        module_state
    }
}

#[cfg(feature = "artifact-graph")]
fn relative_module_path(module_path: &ModulePath, abs_project_directory: &Path) -> Result<String, std::io::Error> {
    match module_path {
        ModulePath::Main => Ok("main".to_owned()),
        ModulePath::Local { value: path } => {
            let abs_path = path.canonicalize()?;
            abs_path
                .strip_prefix(abs_project_directory)
                .map(|p| p.to_string_lossy())
                .map_err(|_| std::io::Error::other(format!("Failed to strip prefix from module path {abs_path:?}")))
        }
        ModulePath::Std { value } => Ok(format!("std::{value}")),
    }
}

fn assert_snapshot<F, R>(test: &Test, operation: &str, f: F)
where
    F: FnOnce() -> R,
{
    let mut settings = insta::Settings::clone_current();
    // These make the snapshots more readable and match our dir structure.
    settings.set_omit_expression(true);
    settings.set_snapshot_path(Path::new("..").join(&test.output_dir));
    settings.set_prepend_module_to_snapshot(false);
    settings.set_description(format!("{operation} {}.kcl", &test.name));
    // We don't do it on the flowchart
    if operation != "Artifact graph flowchart" {
        // Sorting maps makes them easier to diff.
        settings.set_sort_maps(true);
    }
    // Replace UUIDs with the string "[uuid]", because otherwise the tests would constantly
    // be changing the UUID. This is a stopgap measure until we make the engine more deterministic.
    settings.add_filter(
        r"\b[[:xdigit:]]{8}-[[:xdigit:]]{4}-[[:xdigit:]]{4}-[[:xdigit:]]{4}-[[:xdigit:]]{12}\b",
        "[uuid]",
    );
    // Run `f` (the closure that was passed in) with these settings.
    settings.bind(f);
}

fn parse(test_name: &str) {
    parse_test(&Test::new(test_name));
}

fn parse_test(test: &Test) {
    let input = test.read();
    let tokens = crate::parsing::token::lex(&input, ModuleId::default()).unwrap();

    // Parse the tokens into an AST.
    let parse_res = Result::<_, KclError>::Ok(crate::parsing::parse_tokens(tokens).unwrap());
    assert_snapshot(test, "Result of parsing", || {
        insta::assert_json_snapshot!("ast", parse_res, {
            ".**.start" => 0,
            ".**.end" => 0,
            ".**.commentStart" => 0,
        });
    });
}

async fn unparse(test_name: &str) {
    unparse_test(&Test::new(test_name)).await;
}

async fn unparse_test(test: &Test) {
    // Parse into an AST
    let input = test.read();
    let tokens = crate::parsing::token::lex(&input, ModuleId::default()).unwrap();
    let ast = crate::parsing::parse_tokens(tokens).unwrap();

    // Check recasting.
    let actual = ast.recast(&Default::default(), 0);
    let input_result = catch_unwind(AssertUnwindSafe(|| {
        assert_snapshot(test, "Result of unparsing", || {
            insta::assert_snapshot!("unparsed", actual);
        })
    }));

    // Check all the rest of the files in the directory.
    let kcl_files = crate::unparser::walk_dir(&test.input_dir).await.unwrap();
    // Filter out the entry point file.
    let kcl_files = kcl_files.into_iter().filter(|f| f != &test.entry_point);
    let futures = kcl_files
        .into_iter()
        .filter(|file| file.extension().is_some_and(|ext| ext == "kcl")) // We only care about kcl
        // files here.
        .map(|file| {
            let snap_path = Path::new("..").join(&test.output_dir);
            tokio::spawn(async move {
                let contents = tokio::fs::read_to_string(&file).await.unwrap();
                let program = crate::Program::parse_no_errs(&contents).unwrap();
                let recast = program.recast_with_options(&Default::default());

                catch_unwind(AssertUnwindSafe(|| {
                    let mut settings = insta::Settings::clone_current();
                    settings.set_omit_expression(true);
                    settings.set_snapshot_path(snap_path);
                    settings.set_prepend_module_to_snapshot(false);
                    settings.set_snapshot_suffix(file.file_name().unwrap().to_str().unwrap());
                    settings.set_description(format!("Result of unparsing {}", file.display()));
                    // Run `f` (the closure that was passed in) with these settings.
                    settings.bind(|| {
                        insta::assert_snapshot!("unparsed", recast);
                    })
                }))
            })
        })
        .collect::<Vec<_>>();

    // Join all futures and await their completion.
    for future in futures {
        future.await.unwrap().unwrap();
    }
    input_result.unwrap();
}

async fn execute(test_name: &str, render_to_png: bool) {
    execute_test(&Test::new(test_name), render_to_png, false).await
}

async fn execute_test(test: &Test, render_to_png: bool, export_step: bool) {
    let input = test.read();
    let ast = crate::Program::parse_no_errs(&input).unwrap();

    // Run the program.
    let exec_res = crate::test_server::execute_and_snapshot_ast(ast, Some(test.entry_point.clone()), export_step).await;
    match exec_res {
        Ok((exec_state, ctx, env_ref, png, step)) => {
            let fail_path = test.output_dir.join("execution_error.snap");
            if std::fs::exists(&fail_path).unwrap() {
                panic!(
                    "This test case is expected to fail, but it passed. If this is intended, and the test should actually be passing now, please delete kcl-lib/{}",
                    fail_path.to_string_lossy()
                )
            }
            if render_to_png {
                twenty_twenty::assert_image(test.output_dir.join(RENDERED_MODEL_NAME), &png, 0.99);
            }

            // Ensure the step has data.
            if export_step {
                let Some(step_contents) = step else {
                    panic!("Step data was not generated");
                };
                if step_contents.is_empty() {
                    panic!("Step data was empty");
                }
            }
            let (outcome, module_state) = exec_state.into_test_exec_outcome(env_ref, &ctx, &test.input_dir).await;

            let mem_result = catch_unwind(AssertUnwindSafe(|| {
                assert_snapshot(test, "Variables in memory after executing", || {
                    insta::assert_json_snapshot!("program_memory", outcome.variables, {
                         ".**.sourceRange" => Vec::new(),
                    })
                })
            }));

            #[cfg(not(feature = "artifact-graph"))]
            drop(module_state);
            #[cfg(feature = "artifact-graph")]
            assert_artifact_snapshots(test, module_state, outcome.artifact_graph);
            mem_result.unwrap();
        }
        Err(e) => {
            let ok_path = test.output_dir.join("program_memory.snap");
            let previously_passed = std::fs::exists(&ok_path).unwrap();
            match e.error {
                crate::errors::ExecError::Kcl(error) => {
                    // Snapshot the KCL error with a fancy graphical report.
                    // This looks like a Cargo compile error, with arrows pointing
                    // to source code, underlines, etc.
                    miette::set_hook(Box::new(|_| {
                        Box::new(miette::MietteHandlerOpts::new().show_related_errors_as_nested().build())
                    }))
                    .unwrap();
                    let report = error.clone().into_miette_report_with_outputs(&input).unwrap();
                    let report = miette::Report::new(report);
                    if previously_passed {
                        eprintln!(
                            "This test case failed, but it previously passed. If this is intended, and the test should actually be failing now, please delete kcl-lib/{} and other associated passing artifacts",
                            ok_path.to_string_lossy()
                        );
                        panic!("{report:?}");
                    }
                    let report = format!("{report:?}");

                    let err_result = catch_unwind(AssertUnwindSafe(|| {
                        assert_snapshot(test, "Error from executing", || {
                            insta::assert_snapshot!("execution_error", report);
                        })
                    }));

                    #[cfg(feature = "artifact-graph")]
                    {
                        let module_state = e
                            .exec_state
                            .map(|e| e.to_module_state(&test.input_dir))
                            .unwrap_or_default();
                        assert_artifact_snapshots(test, module_state, error.artifact_graph);
                    }
                    err_result.unwrap();
                }
                e => {
                    // These kinds of errors aren't expected to occur. We don't
                    // snapshot them because they indicate there's something wrong
                    // with the Rust test, not with the KCL code being tested.
                    panic!("{e}")
                }
            };
        }
    }
}

/// Assert snapshots for artifacts that should happen both when KCL execution
/// succeeds and when it results in an error.
#[cfg(feature = "artifact-graph")]
fn assert_artifact_snapshots(
    test: &Test,
    module_state: IndexMap<String, ModuleArtifactState>,
    artifact_graph: ArtifactGraph,
) {
    let module_operations = module_state
        .iter()
        .map(|(path, s)| (path, &s.operations))
        .collect::<IndexMap<_, _>>();
    let result1 = catch_unwind(AssertUnwindSafe(|| {
        assert_snapshot(test, "Operations executed", || {
            insta::assert_json_snapshot!("ops", module_operations, {
                ".**.sourceRange" => Vec::new(),
                ".**.functionSourceRange" => Vec::new(),
                ".**.moduleId" => 0,
            });
        })
    }));
    let module_commands = module_state
        .iter()
        .map(|(path, s)| (path, &s.commands))
        .collect::<IndexMap<_, _>>();
    let result2 = catch_unwind(AssertUnwindSafe(|| {
        assert_snapshot(test, "Artifact commands", || {
            insta::assert_json_snapshot!("artifact_commands", module_commands, {
                ".**.range" => Vec::new(),
            });
        })
    }));
    let result3 = catch_unwind(AssertUnwindSafe(|| {
        // If the user is explicitly writing, we always want to run so that they
        // can save new expected output.  There's no way to reliably determine
        // if insta will write, as far as I can tell, so we use our own
        // environment variable.
        let is_writing = matches!(std::env::var("ZOO_SIM_UPDATE").as_deref(), Ok("always"));
        if !test.skip_assert_artifact_graph || is_writing {
            assert_snapshot(test, "Artifact graph flowchart", || {
                let flowchart = artifact_graph
                    .to_mermaid_flowchart()
                    .unwrap_or_else(|e| format!("Failed to convert artifact graph to flowchart: {e}"));
                // Change the snapshot suffix so that it is rendered as a Markdown file
                // in GitHub.
                insta::assert_binary_snapshot!("artifact_graph_flowchart.md", flowchart.as_bytes().to_owned());
            })
        }
    }));

    result1.unwrap();
    result2.unwrap();
    result3.unwrap();
}

mod cube {
    const TEST_NAME: &str = "cube";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME, true).await
    }
}
mod cube_with_error {
    const TEST_NAME: &str = "cube_with_error";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME, true).await
    }
}
mod any_type {
    const TEST_NAME: &str = "any_type";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME, false).await
    }
}
mod coerce_from_trig_to_point {
    const TEST_NAME: &str = "coerce_from_trig_to_point";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME, true).await
    }
}
mod artifact_graph_example_code1 {
    const TEST_NAME: &str = "artifact_graph_example_code1";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME, true).await
    }
}
mod artifact_graph_example_code_no_3d {
    const TEST_NAME: &str = "artifact_graph_example_code_no_3d";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME, true).await
    }
}
mod artifact_graph_example_code_offset_planes {
    const TEST_NAME: &str = "artifact_graph_example_code_offset_planes";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME, true).await
    }
}
mod artifact_graph_sketch_on_face_etc {
    const TEST_NAME: &str = "artifact_graph_sketch_on_face_etc";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME, true).await
    }
}
mod helix_ccw {
    const TEST_NAME: &str = "helix_ccw";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME, true).await
    }
}
mod double_map_fn {
    const TEST_NAME: &str = "double_map_fn";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME, false).await
    }
}
mod index_of_array {
    const TEST_NAME: &str = "index_of_array";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME, false).await
    }
}
mod comparisons {
    const TEST_NAME: &str = "comparisons";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME, false).await
    }
}
mod array_range_expr {
    const TEST_NAME: &str = "array_range_expr";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME, false).await
    }
}
mod array_range_negative_expr {
    const TEST_NAME: &str = "array_range_negative_expr";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME, false).await
    }
}
mod array_range_with_units {
    const TEST_NAME: &str = "array_range_with_units";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME, false).await
    }
}
mod array_range_mismatch_units {
    const TEST_NAME: &str = "array_range_mismatch_units";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME, false).await
    }
}
mod sketch_in_object {
    const TEST_NAME: &str = "sketch_in_object";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME, false).await
    }
}
mod if_else {
    const TEST_NAME: &str = "if_else";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME, false).await
    }
}
mod add_lots {
    const TEST_NAME: &str = "add_lots";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME, false).await
    }
}
mod add_arrays {
    const TEST_NAME: &str = "add_arrays";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME, false).await
    }
}
mod argument_error {
    //! The argument error points to the problematic argument in the call site,
    //! not the function definition that the variable points to.

    const TEST_NAME: &str = "argument_error";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME, false).await
    }
}
mod array_elem_push {
    const TEST_NAME: &str = "array_elem_push";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME, false).await
    }
}
mod array_concat_non_array {
    const TEST_NAME: &str = "array_concat_non_array";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME, false).await
    }
}
mod invalid_index_str {
    const TEST_NAME: &str = "invalid_index_str";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME, false).await
    }
}
mod invalid_index_negative {
    const TEST_NAME: &str = "invalid_index_negative";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME, false).await
    }
}
mod invalid_index_fractional {
    const TEST_NAME: &str = "invalid_index_fractional";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME, false).await
    }
}
mod property_access_not_found_on_solid {
    const TEST_NAME: &str = "property_access_not_found_on_solid";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME, true).await
    }
}
mod invalid_member_object {
    const TEST_NAME: &str = "invalid_member_object";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME, false).await
    }
}
mod invalid_member_object_prop {
    const TEST_NAME: &str = "invalid_member_object_prop";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME, false).await
    }
}
mod invalid_member_object_using_string {
    const TEST_NAME: &str = "invalid_member_object_using_string";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME, false).await
    }
}
mod non_string_key_of_object {
    const TEST_NAME: &str = "non_string_key_of_object";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME, false).await
    }
}
mod array_index_oob {
    const TEST_NAME: &str = "array_index_oob";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME, false).await
    }
}
mod object_prop_not_found {
    const TEST_NAME: &str = "object_prop_not_found";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME, false).await
    }
}
mod pipe_substitution_inside_function_called_from_pipeline {
    const TEST_NAME: &str = "pipe_substitution_inside_function_called_from_pipeline";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME, false).await
    }
}
mod comparisons_multiple {
    const TEST_NAME: &str = "comparisons_multiple";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME, false).await
    }
}
mod import_cycle1 {
    const TEST_NAME: &str = "import_cycle1";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME, false).await
    }
}
mod import_only_at_top_level {
    const TEST_NAME: &str = "import_only_at_top_level";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME, false).await
    }
}
mod import_function_not_sketch {
    const TEST_NAME: &str = "import_function_not_sketch";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME, true).await
    }
}
mod import_constant {
    const TEST_NAME: &str = "import_constant";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME, false).await
    }
}
mod import_export {
    const TEST_NAME: &str = "import_export";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME, false).await
    }
}
mod import_glob {
    const TEST_NAME: &str = "import_glob";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME, false).await
    }
}
mod import_whole_simple {
    const TEST_NAME: &str = "import_whole_simple";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME, false).await
    }
}
mod import_whole_transitive_import {
    const TEST_NAME: &str = "import_whole_transitive_import";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME, false).await
    }
}
mod import_side_effect {
    const TEST_NAME: &str = "import_side_effect";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME, false).await
    }
}
mod import_foreign {
    const TEST_NAME: &str = "import_foreign";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME, false).await
    }
}
mod export_var_only_at_top_level {
    const TEST_NAME: &str = "export_var_only_at_top_level";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME, false).await
    }
}
mod assembly_non_default_units {
    const TEST_NAME: &str = "assembly_non_default_units";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME, true).await
    }
}

mod array_elem_push_fail {
    const TEST_NAME: &str = "array_elem_push_fail";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME, false).await
    }
}
mod array_push_item_wrong_type {
    const TEST_NAME: &str = "array_push_item_wrong_type";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME, false).await
    }
}
mod sketch_on_face {
    const TEST_NAME: &str = "sketch_on_face";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME, true).await
    }
}
mod revolve_about_edge {
    const TEST_NAME: &str = "revolve_about_edge";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME, true).await
    }
}
mod poop_chute {
    const TEST_NAME: &str = "poop_chute";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME, true).await
    }
}
mod neg_xz_plane {
    const TEST_NAME: &str = "neg_xz_plane";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME, true).await
    }
}
mod xz_plane {
    const TEST_NAME: &str = "xz_plane";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME, true).await
    }
}
mod sketch_on_face_after_fillets_referencing_face {
    const TEST_NAME: &str = "sketch_on_face_after_fillets_referencing_face";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME, true).await
    }
}
mod circular_pattern3d_a_pattern {
    const TEST_NAME: &str = "circular_pattern3d_a_pattern";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME, true).await
    }
}
mod linear_pattern3d_a_pattern {
    const TEST_NAME: &str = "linear_pattern3d_a_pattern";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME, true).await
    }
}
mod pattern_circular_in_module {
    const TEST_NAME: &str = "pattern_circular_in_module";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME, true).await
    }
}
mod pattern_linear_in_module {
    const TEST_NAME: &str = "pattern_linear_in_module";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME, true).await
    }
}
mod tangential_arc {
    const TEST_NAME: &str = "tangential_arc";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME, true).await
    }
}
mod sketch_on_face_circle_tagged {
    const TEST_NAME: &str = "sketch_on_face_circle_tagged";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME, true).await
    }
}
mod basic_fillet_cube_start {
    const TEST_NAME: &str = "basic_fillet_cube_start";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME, true).await
    }
}
mod basic_fillet_cube_next_adjacent {
    const TEST_NAME: &str = "basic_fillet_cube_next_adjacent";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME, true).await
    }
}
mod basic_fillet_cube_previous_adjacent {
    const TEST_NAME: &str = "basic_fillet_cube_previous_adjacent";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME, true).await
    }
}
mod basic_fillet_cube_end {
    const TEST_NAME: &str = "basic_fillet_cube_end";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME, true).await
    }
}
mod basic_fillet_cube_close_opposite {
    const TEST_NAME: &str = "basic_fillet_cube_close_opposite";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME, true).await
    }
}
mod sketch_on_face_end {
    const TEST_NAME: &str = "sketch_on_face_end";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME, true).await
    }
}
mod sketch_on_face_start {
    const TEST_NAME: &str = "sketch_on_face_start";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME, true).await
    }
}
mod sketch_on_face_end_negative_extrude {
    const TEST_NAME: &str = "sketch_on_face_end_negative_extrude";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME, true).await
    }
}
mod mike_stress_test {
    const TEST_NAME: &str = "mike_stress_test";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME, true).await
    }
}
mod pentagon_fillet_sugar {
    const TEST_NAME: &str = "pentagon_fillet_sugar";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME, true).await
    }
}
mod pipe_as_arg {
    const TEST_NAME: &str = "pipe_as_arg";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME, true).await
    }
}
mod computed_var {
    const TEST_NAME: &str = "computed_var";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME, true).await
    }
}
mod riddle_small {
    const TEST_NAME: &str = "riddle_small";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME, true).await
    }
}
mod tan_arc_x_line {
    const TEST_NAME: &str = "tan_arc_x_line";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME, true).await
    }
}
mod fillet_and_shell {
    const TEST_NAME: &str = "fillet-and-shell";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME, true).await
    }
}
mod sketch_on_chamfer_two_times {
    const TEST_NAME: &str = "sketch-on-chamfer-two-times";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME, true).await
    }
}
mod sketch_on_chamfer_two_times_different_order {
    const TEST_NAME: &str = "sketch-on-chamfer-two-times-different-order";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME, true).await
    }
}
mod parametric_with_tan_arc {
    const TEST_NAME: &str = "parametric_with_tan_arc";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME, true).await
    }
}
mod parametric {
    const TEST_NAME: &str = "parametric";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME, true).await
    }
}
mod ssi_pattern {
    const TEST_NAME: &str = "ssi_pattern";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME, true).await
    }
}
mod angled_line {
    const TEST_NAME: &str = "angled_line";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME, true).await
    }
}
mod function_sketch_with_position {
    const TEST_NAME: &str = "function_sketch_with_position";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME, true).await
    }
}
mod function_sketch {
    const TEST_NAME: &str = "function_sketch";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME, true).await
    }
}
mod i_shape {
    const TEST_NAME: &str = "i_shape";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME, true).await
    }
}
mod kittycad_svg {
    const TEST_NAME: &str = "kittycad_svg";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME, true).await
    }
}
mod kw_fn {
    const TEST_NAME: &str = "kw_fn";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME, true).await
    }
}
mod kw_fn_too_few_args {
    const TEST_NAME: &str = "kw_fn_too_few_args";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME, false).await
    }
}
mod kw_fn_unlabeled_but_has_label {
    const TEST_NAME: &str = "kw_fn_unlabeled_but_has_label";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME, false).await
    }
}
mod kw_fn_with_defaults {
    const TEST_NAME: &str = "kw_fn_with_defaults";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME, false).await
    }
}
mod boolean_logical_and {
    const TEST_NAME: &str = "boolean_logical_and";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME, false).await
    }
}
mod boolean_logical_or {
    const TEST_NAME: &str = "boolean_logical_or";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME, false).await
    }
}
mod boolean_logical_multiple {
    const TEST_NAME: &str = "boolean_logical_multiple";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME, false).await
    }
}
mod circle_three_point {
    const TEST_NAME: &str = "circle_three_point";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME, true).await
    }
}
mod array_elem_pop {
    const TEST_NAME: &str = "array_elem_pop";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME, false).await
    }
}
mod array_elem_pop_empty_fail {
    const TEST_NAME: &str = "array_elem_pop_empty_fail";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME, false).await
    }
}
mod array_elem_pop_fail {
    const TEST_NAME: &str = "array_elem_pop_fail";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME, false).await
    }
}
mod helix_simple {
    const TEST_NAME: &str = "helix_simple";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME);
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME, true).await
    }
}

mod import_file_not_exist_error {
    const TEST_NAME: &str = "import_file_not_exist_error";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME);
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME, true).await
    }
}

mod import_file_parse_error {
    const TEST_NAME: &str = "import_file_parse_error";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME);
    }

    #[test]
    fn unparse() {
        // Do nothing since we want to keep the parse error for the test.
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME, true).await
    }
}

mod flush_batch_on_end {
    const TEST_NAME: &str = "flush_batch_on_end";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME);
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME, true).await
    }
}

mod multi_transform {
    const TEST_NAME: &str = "multi_transform";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME);
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME, true).await
    }
}

mod module_return_using_var {
    const TEST_NAME: &str = "module_return_using_var";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME, true).await
    }
}

mod import_transform {
    const TEST_NAME: &str = "import_transform";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME);
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME, true).await
    }
}

mod out_of_band_sketches {
    const TEST_NAME: &str = "out_of_band_sketches";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME);
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME, true).await
    }
}

mod crazy_multi_profile {
    const TEST_NAME: &str = "crazy_multi_profile";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME);
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME, true).await
    }
}
mod assembly_mixed_units_cubes {
    const TEST_NAME: &str = "assembly_mixed_units_cubes";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME, true).await
    }
}
mod bad_units_in_annotation {
    const TEST_NAME: &str = "bad_units_in_annotation";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME, true).await
    }
}
mod translate_after_fillet {
    const TEST_NAME: &str = "translate_after_fillet";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME, true).await
    }
}
mod scale_after_fillet {
    const TEST_NAME: &str = "scale_after_fillet";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME, true).await
    }
}
mod rotate_after_fillet {
    const TEST_NAME: &str = "rotate_after_fillet";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME, true).await
    }
}
mod union_cubes {
    const TEST_NAME: &str = "union_cubes";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME, true).await
    }
}
mod subtract_cylinder_from_cube {
    const TEST_NAME: &str = "subtract_cylinder_from_cube";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME, true).await
    }
}
mod intersect_cubes {
    const TEST_NAME: &str = "intersect_cubes";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME, true).await
    }
}

mod pattern_into_union {
    const TEST_NAME: &str = "pattern_into_union";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME, true).await
    }
}
mod subtract_doesnt_need_brackets {
    const TEST_NAME: &str = "subtract_doesnt_need_brackets";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME, true).await
    }
}

mod tangent_to_3_point_arc {
    const TEST_NAME: &str = "tangent_to_3_point_arc";
    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME, true).await
    }
}
mod import_async {
    const TEST_NAME: &str = "import_async";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME, true).await
    }
}
mod loop_tag {
    const TEST_NAME: &str = "loop_tag";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME, true).await
    }
}
mod multiple_foreign_imports_all_render {
    const TEST_NAME: &str = "multiple-foreign-imports-all-render";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME, true).await
    }
}
mod import_mesh_clone {
    const TEST_NAME: &str = "import_mesh_clone";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME, true).await
    }
}
mod clone_w_fillets {
    const TEST_NAME: &str = "clone_w_fillets";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    #[ignore] // turn on when https://github.com/KittyCAD/engine/pull/3380 is merged
    // There's also a test in clone.rs you need to turn too
    async fn kcl_test_execute() {
        super::execute(TEST_NAME, true).await
    }
}
mod clone_w_shell {
    const TEST_NAME: &str = "clone_w_shell";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    #[ignore] // turn on when https://github.com/KittyCAD/engine/pull/3380 is merged
    async fn kcl_test_execute() {
        super::execute(TEST_NAME, true).await
    }
}
mod involute_circular_units {
    const TEST_NAME: &str = "involute_circular_units";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME, true).await
    }
}
mod panic_repro_cube {
    const TEST_NAME: &str = "panic_repro_cube";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME, true).await
    }
}
mod subtract_regression00 {
    const TEST_NAME: &str = "subtract_regression00";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME, true).await
    }
}
mod subtract_regression01 {
    const TEST_NAME: &str = "subtract_regression01";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME, true).await
    }
}
mod subtract_regression02 {
    const TEST_NAME: &str = "subtract_regression02";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME, true).await
    }
}
mod subtract_regression03 {
    const TEST_NAME: &str = "subtract_regression03";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME, true).await
    }
}
mod subtract_regression04 {
    const TEST_NAME: &str = "subtract_regression04";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME, true).await
    }
}
mod subtract_regression05 {
    const TEST_NAME: &str = "subtract_regression05";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME, true).await
    }
}
mod subtract_regression06 {
    const TEST_NAME: &str = "subtract_regression06";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME, true).await
    }
}
mod fillet_duplicate_tags {
    const TEST_NAME: &str = "fillet_duplicate_tags";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME, true).await
    }
}
mod execute_engine_error_return {
    const TEST_NAME: &str = "execute_engine_error_return";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME, true).await
    }
}
mod basic_revolve_circle {
    const TEST_NAME: &str = "basic_revolve_circle";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME, true).await
    }
}
mod error_inside_fn_also_has_source_range_of_call_site_recursive {
    const TEST_NAME: &str = "error_inside_fn_also_has_source_range_of_call_site_recursive";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME, true).await
    }
}
mod error_revolve_on_edge_get_edge {
    const TEST_NAME: &str = "error_revolve_on_edge_get_edge";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME, true).await
    }
}
mod subtract_with_pattern {
    const TEST_NAME: &str = "subtract_with_pattern";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME, true).await
    }
}
mod subtract_with_pattern_cut_thru {
    const TEST_NAME: &str = "subtract_with_pattern_cut_thru";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME, true).await
    }
}
mod sketch_on_face_union {
    const TEST_NAME: &str = "sketch_on_face_union";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME, true).await
    }
}
mod multi_target_csg {
    const TEST_NAME: &str = "multi_target_csg";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME, true).await
    }
}
mod revolve_colinear {
    const TEST_NAME: &str = "revolve-colinear";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME, true).await
    }
}
mod subtract_regression07 {
    const TEST_NAME: &str = "subtract_regression07";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME, true).await
    }
}
mod subtract_regression08 {
    const TEST_NAME: &str = "subtract_regression08";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME, true).await
    }
}
mod subtract_regression09 {
    const TEST_NAME: &str = "subtract_regression09";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME, true).await
    }
}
mod subtract_regression10 {
    const TEST_NAME: &str = "subtract_regression10";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME, true).await
    }
}
mod nested_main_kcl {
    const TEST_NAME: &str = "nested_main_kcl";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME, true).await
    }
}
mod nested_windows_main_kcl {
    const TEST_NAME: &str = "nested_windows_main_kcl";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME, true).await
    }
}
mod nested_assembly {
    const TEST_NAME: &str = "nested_assembly";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME, true).await
    }
}
mod subtract_regression11 {
    const TEST_NAME: &str = "subtract_regression11";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME, true).await
    }
}
mod subtract_regression12 {
    const TEST_NAME: &str = "subtract_regression12";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME, true).await
    }
}
mod spheres {
    const TEST_NAME: &str = "spheres";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME, true).await
    }
}
mod var_ref_in_own_def {
    const TEST_NAME: &str = "var_ref_in_own_def";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME, true).await
    }
}
mod ascription_unknown_type {
    const TEST_NAME: &str = "ascription_unknown_type";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME, true).await
    }
}
mod var_ref_in_own_def_decl {
    const TEST_NAME: &str = "var_ref_in_own_def_decl";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME, true).await
    }
}
mod user_reported_union_2_bug {
    // TODO IF THIS TEST START PASSING, CLOSE THE FOLLOWING ISSUE
    // https://github.com/KittyCAD/modeling-app/issues/7310
    // and https://github.com/KittyCAD/engine/issues/3539
    const TEST_NAME: &str = "user_reported_union_2_bug";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME, false).await
    }
}
mod non_english_identifiers {
    const TEST_NAME: &str = "non_english_identifiers";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME, true).await
    }
}
mod rect {
    const TEST_NAME: &str = "rect";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME, true).await
    }
}
mod rect_helper {
    const TEST_NAME: &str = "rect_helper";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME, true).await
    }
}
mod plane_of {
    const TEST_NAME: &str = "plane_of";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME, true).await
    }
}
