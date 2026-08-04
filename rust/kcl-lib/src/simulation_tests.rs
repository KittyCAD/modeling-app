use std::any::Any;
use std::panic::AssertUnwindSafe;
use std::panic::catch_unwind;
use std::path::Path;
use std::path::PathBuf;

use indexmap::IndexMap;
use kittycad_modeling_cmds::websocket::WebSocketResponse;
use uuid::Uuid;

use crate::ExecOutcome;
use crate::ExecState;
use crate::ExecutorContext;
use crate::ModuleId;
use crate::errors::KclError;
use crate::execution::ArtifactGraph;
use crate::execution::ArtifactGraphMermaidExt;
use crate::execution::EnvironmentRef;
use crate::execution::KclValueView;
use crate::execution::ModuleArtifactState;
use crate::modules::ModulePath;
use crate::modules::ModuleRepr;
use crate::tooling::render_artifacts::RENDERED_MODEL_NAME;
use crate::util::RetryConfig;
use crate::util::execute_with_retries;
use crate::walk::Node;
use crate::walk::walk;

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
    skip_assert_artifact_graph: bool,
}

const REPO_ROOT: &str = "../..";

fn is_writing() -> bool {
    matches!(std::env::var("ZOO_SIM_UPDATE").as_deref(), Ok("always"))
}

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
    ) -> (
        ExecOutcome,
        IndexMap<String, ModuleArtifactState>,
        Option<IndexMap<Uuid, WebSocketResponse>>,
    ) {
        let module_state = self.to_module_state(project_directory);
        #[cfg(feature = "snapshot-engine-responses")]
        let (outcome, responses) = {
            let mut exec_state = self;
            let responses = Some(exec_state.take_root_module_responses());
            let outcome = exec_state
                .into_exec_outcome(main_ref, ctx)
                .await
                .expect("simulation test execution outcome should collect variables");
            (outcome, responses)
        };
        #[cfg(not(feature = "snapshot-engine-responses"))]
        let (outcome, responses) = {
            let responses = None;
            let outcome = self
                .into_exec_outcome(main_ref, ctx)
                .await
                .expect("simulation test execution outcome should collect variables");
            (outcome, responses)
        };
        (outcome, module_state, responses)
    }

    /// The keys of the map are the module paths.  Can't use `ModulePath` since
    /// it needs to be converted to a string to be a JSON object key.  The paths
    /// need to be relative so that generating locally works in CI.
    fn to_module_state(&self, _project_directory: &Path) -> IndexMap<String, ModuleArtifactState> {
        let project_directory = std::path::Path::new(REPO_ROOT)
            .canonicalize()
            .unwrap_or_else(|_| panic!("Failed to canonicalize project directory: {REPO_ROOT}"));
        let mut module_state = IndexMap::new();
        for info in self.modules().values() {
            let relative_path = relative_module_path(&info.path, &project_directory).unwrap_or_else(|err| {
                panic!(
                    "Failed to get relative module path for {:?} in {:?}; caused by {err:?}",
                    info.path, project_directory
                )
            });
            match &info.repr {
                ModuleRepr::Root => {
                    module_state.insert(relative_path, self.root_module_artifact_state().clone());
                }
                ModuleRepr::Kcl(_, None) => {
                    module_state.insert(relative_path, Default::default());
                }
                ModuleRepr::Kcl(_, Some(outcome)) => {
                    module_state.insert(relative_path, outcome.artifacts.clone());
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

fn relative_module_path(module_path: &ModulePath, abs_project_directory: &Path) -> Result<String, std::io::Error> {
    match module_path {
        ModulePath::Main => Ok("main".to_owned()),
        ModulePath::Local { value: path, .. } => {
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
    settings.set_description(format!("{operation} {}.kcl", test.name));
    // We don't do it on the flowchart
    if operation != "Artifact graph flowchart" {
        // Sorting maps makes them easier to diff.
        settings.set_sort_maps(true);
    }
    #[cfg(not(feature = "snapshot-engine-responses"))]
    {
        // Replace UUIDs with the string "[uuid]", because otherwise the tests
        // would constantly be changing the UUID. This is a stopgap measure
        // until we make the engine more deterministic.
        settings.add_filter(
            r"\b[[:xdigit:]]{8}-[[:xdigit:]]{4}-[[:xdigit:]]{4}-[[:xdigit:]]{4}-[[:xdigit:]]{12}\b",
            "[uuid]",
        );
        settings.add_filter(
            r"\bface_id_[[:xdigit:]]{8}_[[:xdigit:]]{4}_[[:xdigit:]]{4}_[[:xdigit:]]{4}_[[:xdigit:]]{12}\b",
            "face_id_[uuid]",
        );
    }
    // Run `f` (the closure that was passed in) with these settings.
    settings.bind(f);
}

fn parse(test_name: &str) {
    parse_test(&Test::new(test_name));
}

fn parse_test(test: &Test) {
    let input = test.read();
    let parse_res = Result::<_, KclError>::Ok(crate::parsing::parse_str(&input, ModuleId::default()).unwrap());
    assert_snapshot(test, "Result of parsing", || {
        insta::assert_json_snapshot!("ast", parse_res, {
            ".**.start" => 0,
            ".**.end" => 0,
            ".**.commentStart" => 0,
        });
    });
    if let Ok(program) = parse_res {
        let input = input.as_bytes();
        walk(&program, |node| {
            match node {
                Node::Program(node) => assert!(node.non_code_meta.comment_start_is_accurate(input)),
                Node::PipeExpression(node) => assert!(node.non_code_meta.comment_start_is_accurate(input)),
                Node::SketchBlock(node) => assert!(node.non_code_meta.comment_start_is_accurate(input)),
                Node::Block(node) => assert!(node.non_code_meta.comment_start_is_accurate(input)),
                Node::CallExpressionKw(node) => assert!(node.non_code_meta.comment_start_is_accurate(input)),
                Node::ArrayExpression(node) => assert!(node.non_code_meta.comment_start_is_accurate(input)),
                Node::ObjectExpression(node) => assert!(node.non_code_meta.comment_start_is_accurate(input)),
                _ => {}
            }
            Ok::<_, anyhow::Error>(true)
        })
        .unwrap();
    }
}

async fn unparse(test_name: &str) {
    unparse_test(&Test::new(test_name)).await;
}

async fn unparse_test(test: &Test) {
    // Parse into an AST
    let input = test.read();
    let ast = crate::parsing::parse_str(&input, ModuleId::default()).unwrap();

    // Check recasting.
    let actual = ast.recast_top(&Default::default(), 0);
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
    let program_to_lint = ast.clone();

    // Run the program.
    let exec_res = execute_with_retries(&RetryConfig::default(), || {
        crate::test_server::execute_and_snapshot_ast(ast.clone(), Some(test.entry_point.clone()), export_step)
    })
    .await;
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
            let ok_snap = catch_unwind(AssertUnwindSafe(|| {
                assert_snapshot(test, "Execution success", || {
                    insta::assert_json_snapshot!("execution_success", ())
                })
            }));

            let mut lint_findings = program_to_lint
                .lint_all_with_options(crate::lint::LintOptions::default().with_z0006(true))
                .expect("failed to lint program");
            lint_findings.extend(
                exec_state
                    .modules()
                    .values()
                    .filter_map(|module| {
                        // Don't lint the stdlib.
                        if matches!(module.path, ModulePath::Std { .. }) {
                            return None;
                        }
                        // Only lint KCL files.
                        match &module.repr {
                            ModuleRepr::Root | ModuleRepr::Foreign(..) | ModuleRepr::Dummy => None,
                            ModuleRepr::Kcl(node, _exec_result) => Some(
                                node.lint_all_with_options(crate::lint::LintOptions::default().with_z0006(true))
                                    .expect("failed to lint program"),
                            ),
                        }
                    })
                    .flatten(),
            );

            // Filter out Z0005 (old sketch syntax) from test snapshots
            // TODO: Remove this filter once the transpiler is complete and all tests are updated
            lint_findings.retain(|finding| finding.finding.code != "Z0005");

            let (outcome, module_state, responses) =
                exec_state.into_test_exec_outcome(env_ref, &ctx, &test.input_dir).await;

            let snapshot_results = common_snapshots(test, outcome.variables, responses);

            assert_artifact_snapshots(test, module_state, outcome.artifact_graph);

            let lint_snap_path = test.output_dir.join("lints.snap");
            if lint_findings.is_empty() {
                if is_writing() {
                    let _ = std::fs::remove_file(&lint_snap_path);
                } else if lint_snap_path.exists() {
                    eprintln!(
                        "This test case produced no lints, but it previously did. If this is intended, and the test should actually be lint-free now, please delete kcl-lib/{}.",
                        lint_snap_path.to_string_lossy()
                    );
                    panic!("Missing lints");
                }
            } else {
                assert_snapshot(test, "Lints", || insta::assert_json_snapshot!("lints", lint_findings));
            }

            for result in snapshot_results {
                result.unwrap();
            }
            ok_snap.unwrap();
        }
        Err(e) => {
            let ok_path = test.output_dir.join("execution_success.snap");
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

                    let responses = {
                        #[cfg(feature = "snapshot-engine-responses")]
                        {
                            e.responses
                        }
                        #[cfg(not(feature = "snapshot-engine-responses"))]
                        None
                    };
                    let snapshot_results = common_snapshots(test, error.variables, responses);

                    {
                        let module_state = e
                            .exec_state
                            .map(|e| e.to_module_state(&test.input_dir))
                            .unwrap_or_default();
                        assert_artifact_snapshots(test, module_state, error.artifact_graph);
                    }

                    for result in snapshot_results {
                        result.unwrap();
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

/// Assert snapshots that should happen both when KCL execution succeeds and
/// when it results in an error. The caller needs to unwrap the returned results
/// to panic when there's a difference. We don't do it inside this function so
/// that other snapshots can be written to file first.
#[must_use]
fn common_snapshots(
    test: &Test,
    variables: IndexMap<String, KclValueView>,
    #[cfg_attr(not(feature = "snapshot-engine-responses"), expect(unused_variables))] responses: Option<
        IndexMap<Uuid, WebSocketResponse>,
    >,
) -> Vec<Result<(), Box<dyn Any + Send>>> {
    let mem_result = catch_unwind(AssertUnwindSafe(|| {
        assert_snapshot(test, "Variables in memory after executing", || {
            insta::assert_json_snapshot!("program_memory", variables, {
                 ".**.sourceRange" => Vec::new(),
            })
        })
    }));
    #[cfg(feature = "snapshot-engine-responses")]
    let responses_result_option = responses.map(|responses| {
        catch_unwind(AssertUnwindSafe(|| {
            assert_snapshot(test, "Root module engine responses", || {
                insta::assert_json_snapshot!("root_module_engine_responses", responses)
            })
        }))
    });
    let results = vec![mem_result];
    #[cfg(feature = "snapshot-engine-responses")]
    {
        if let Some(responses_result) = responses_result_option {
            let mut results = results;
            results.push(responses_result);
            return results;
        }
    }
    results
}

/// Assert snapshots for artifacts that should happen both when KCL execution
/// succeeds and when it results in an error.
fn assert_artifact_snapshots(
    test: &Test,
    module_state: IndexMap<String, ModuleArtifactState>,
    artifact_graph: ArtifactGraph,
) {
    let module_operations = module_state
        .iter()
        .map(|(path, s)| (path, &s.operations))
        // Remove empty modules, to save filespace,
        // and so that adding a new module without any operations
        // doesn't generate a massive diff.
        .filter(|(_path, s)| !s.is_empty())
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
        // Remove empty modules, to save filespace,
        // and so that adding a new module without any operations
        // doesn't generate a massive diff.
        .filter(|(_path, s)| !s.is_empty())
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
        let is_writing = is_writing();
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
mod blend_with_edge_specifier_objects {
    const TEST_NAME: &str = "blend_with_edge_specifier_objects";

    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME, true).await
    }
}
mod extrude_to_edge_specifier {
    const TEST_NAME: &str = "extrude_to_edge_specifier";

    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME, true).await
    }
}
mod revolve_axis_edge_ref {
    const TEST_NAME: &str = "revolve_axis_edge_ref";

    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME, true).await
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
mod array_range_units_default_count {
    const TEST_NAME: &str = "array_range_units_default_count";

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
mod function_expr_with_name {
    const TEST_NAME: &str = "function_expr_with_name";

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
mod recursive_function_factorial {
    const TEST_NAME: &str = "recursive_function_factorial";

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

mod helix_axis_edge_ref {
    const TEST_NAME: &str = "helix_axis_edge_ref";

    /// Test parsing KCL that uses axis = { sideFaces = [...] } (edge reference object).
    #[test]
    fn parse() {
        super::parse(TEST_NAME);
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that helix with axis as edge reference object executes correctly.
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
mod csg_subtract_multi_target_result_reuse {
    const TEST_NAME: &str = "csg_subtract_multi_target_result_reuse";

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
mod csg_subtract_self_empty_result {
    const TEST_NAME: &str = "csg_subtract_self_empty_result";

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
    ///
    /// The engine's EntityClone does not yet carry fillets/chamfers over to
    /// the cloned body, even though the cut commands are sent before the
    /// clone (verified 2026-07 after KittyCAD/engine#3380: execution
    /// succeeds, but the clone renders without fillets, and its KCL-side
    /// surfaces, edge cuts, and cap ids are empty). Ignored so an engine
    /// deploy that fixes it doesn't break CI. When enabling, regenerate the
    /// snapshots, and expect the clone bookkeeping in
    /// `fix_tags_and_references` to need to carry over edge cuts and
    /// fillet/chamfer surfaces.
    #[tokio::test(flavor = "multi_thread")]
    #[ignore] // engine EntityClone does not carry fillets/chamfers to the clone yet
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
mod revolve_on_edge_get_edge {
    const TEST_NAME: &str = "revolve_on_edge_get_edge";

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
mod complex_expr_as_array_index {
    const TEST_NAME: &str = "complex_expr_as_array_index";

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
mod elliptic_curve_inches_regression {
    const TEST_NAME: &str = "elliptic_curve_inches_regression";

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
mod tag_inner_face {
    const TEST_NAME: &str = "tag_inner_face";

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

mod double_close {
    const TEST_NAME: &str = "double_close";

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

mod revolve_on_face {
    const TEST_NAME: &str = "revolve_on_face";

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
mod subtract_self {
    const TEST_NAME: &str = "subtract_self";

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
mod subtract_self_multiple_tools {
    const TEST_NAME: &str = "subtract_self_multiple_tools";

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
mod union_self {
    const TEST_NAME: &str = "union_self";

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
mod plane_of_chamfer {
    const TEST_NAME: &str = "plane_of_chamfer";

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
mod sketch_block_basic_fixed_constraints {
    const TEST_NAME: &str = "sketch_block_basic_fixed_constraints";

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
mod sketch_block_failed_unit_conversion {
    const TEST_NAME: &str = "sketch_block_failed_unit_conversion";

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
mod sketch_block_unexpected_argument {
    const TEST_NAME: &str = "sketch_block_unexpected_argument";

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
mod sketch_block_unexpected_shorthand_arg {
    const TEST_NAME: &str = "sketch_block_unexpected_shorthand_arg";

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
mod sketch_block_vars_equal {
    const TEST_NAME: &str = "sketch_block_vars_equal";

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
mod sketch_block_coincident_constraint {
    const TEST_NAME: &str = "sketch_block_coincident_constraint";

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
mod sketch_block_coincident_point2d {
    const TEST_NAME: &str = "sketch_block_coincident_point2d";

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
mod sketch_block_arc_using_center_simple {
    const TEST_NAME: &str = "sketch_block_arc_using_center_simple";

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
mod sketch_block_arc_using_center_coincident {
    const TEST_NAME: &str = "sketch_block_arc_using_center_coincident";

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
mod sketch_block_circle_simple {
    const TEST_NAME: &str = "sketch_block_circle_simple";

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
mod sketch_block_modeling_command_is_error {
    const TEST_NAME: &str = "sketch_block_modeling_command_is_error";

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
mod holes_cube {
    const TEST_NAME: &str = "holes_cube";

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
mod multi_body_multi_tool_subtract {
    const TEST_NAME: &str = "multi_body_multi_tool_subtract";

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
mod sketch_block_line_simple {
    const TEST_NAME: &str = "sketch_block_line_simple";

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
mod sketch_block_points_coincident_simple {
    const TEST_NAME: &str = "sketch_block_points_coincident_simple";

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
mod sketch_block_lines_coincident_simple {
    const TEST_NAME: &str = "sketch_block_lines_coincident_simple";

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
mod sketch_block_on_face {
    const TEST_NAME: &str = "sketch_block_on_face";

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
mod sketch_block_on_plane_of {
    const TEST_NAME: &str = "sketch_block_on_plane_of";

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
mod sketch_block_on_offset_plane {
    const TEST_NAME: &str = "sketch_block_on_offset_plane";

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
mod sketch_block_region_triangle {
    const TEST_NAME: &str = "sketch_block_region_triangle";

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
mod sketch_block_region_from_point_in_triangle {
    const TEST_NAME: &str = "sketch_block_region_from_point_in_triangle";

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
mod sketch_block_region_from_point2d_in_triangle {
    const TEST_NAME: &str = "sketch_block_region_from_point2d_in_triangle";

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
mod sketch_block_on_negative_plane {
    const TEST_NAME: &str = "sketch_block_on_negative_plane";

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
mod sketch_on_face_normal {
    const TEST_NAME: &str = "sketch_on_face_normal";

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
mod sketch_on_face_normal_inches {
    const TEST_NAME: &str = "sketch_on_face_normal_inches";

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
mod sketch_on_face_of_region_extrude_one_to_one {
    const TEST_NAME: &str = "sketch_on_face_of_region_extrude_one_to_one";

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
mod sketch_on_face_of_region_extrude_one_to_many {
    const TEST_NAME: &str = "sketch_on_face_of_region_extrude_one_to_many";

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
mod sketch_block_tags_do_not_leak_to_parent_from_region {
    const TEST_NAME: &str = "sketch_block_tags_do_not_leak_to_parent_from_region";

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
mod sketch_block_tags_do_not_leak_to_parent_from_extrude {
    const TEST_NAME: &str = "sketch_block_tags_do_not_leak_to_parent_from_extrude";

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
mod sketch_block_import_multiple {
    const TEST_NAME: &str = "sketch_block_import_multiple";

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
mod sketch_block_get_common_edge_fillet {
    const TEST_NAME: &str = "sketch_block_get_common_edge_fillet";

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
mod crab_mirror_region {
    const TEST_NAME: &str = "crab_mirror_region";

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
mod sketch_on_face_loft_subtract {
    const TEST_NAME: &str = "sketch_on_face_loft_subtract";

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
mod get_common_edge_of_segment_edge_tag {
    const TEST_NAME: &str = "get_common_edge_of_segment_edge_tag";

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
mod pos_literals {
    const TEST_NAME: &str = "pos_literals";

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
mod runtime_exit {
    const TEST_NAME: &str = "runtime_exit";

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
mod extrude_closes {
    const TEST_NAME: &str = "extrude_closes";

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
mod implicit_close {
    const TEST_NAME: &str = "implicit_close";

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
mod extrude_face {
    const TEST_NAME: &str = "extrude_face";
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

mod sketch_block_lines_coincident_collinear {
    const TEST_NAME: &str = "sketch_block_lines_coincident_collinear";

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
mod face_api_fillet_edge_refs_variant_1 {
    const TEST_NAME: &str = "face_api_fillet_edge_refs_variant_1";

    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME, true).await
    }
}
mod face_api_fillet_edge_refs_variant_2 {
    const TEST_NAME: &str = "face_api_fillet_edge_refs_variant_2";

    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME, true).await
    }
}
mod face_api_fillet_edge_refs_variant_3 {
    const TEST_NAME: &str = "face_api_fillet_edge_refs_variant_3";

    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME, true).await
    }
}
mod face_api_fillet_edge_refs_variant_4 {
    const TEST_NAME: &str = "face_api_fillet_edge_refs_variant_4";

    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME, true).await
    }
}
mod face_api_fillet_edge_refs_variant_5 {
    const TEST_NAME: &str = "face_api_fillet_edge_refs_variant_5";

    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME, true).await
    }
}
mod face_api_fillet_edge_refs_variant_6 {
    const TEST_NAME: &str = "face_api_fillet_edge_refs_variant_6";

    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME, true).await
    }
}
mod face_api_fillet_edge_refs_variant_7 {
    const TEST_NAME: &str = "face_api_fillet_edge_refs_variant_7";

    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME, true).await
    }
}
mod face_api_fillet_chamfer_tags_and_edge_refs {
    const TEST_NAME: &str = "face_api_fillet_chamfer_tags_and_edge_refs";

    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME, true).await
    }
}
mod sketch_on_face_index {
    const TEST_NAME: &str = "sketch_on_face_index";

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
mod delete_face_by_index {
    const TEST_NAME: &str = "delete_face_by_index";

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
mod delete_face_by_id {
    const TEST_NAME: &str = "delete_face_by_id";

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
mod sketch_block_angle_constraint {
    const TEST_NAME: &str = "sketch_block_angle_constraint";

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
mod tangent_line_arc {
    const TEST_NAME: &str = "tangent_line_arc";

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
mod tangent_line_circle {
    const TEST_NAME: &str = "tangent_line_circle";

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
mod tangent_line_arc_reversed_line {
    const TEST_NAME: &str = "tangent_line_arc_reversed_line";

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
mod tangent_arc_arc {
    const TEST_NAME: &str = "tangent_arc_arc";

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
mod tangent_line_line_error {
    const TEST_NAME: &str = "tangent_line_line_error";

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
mod tangent_circle_circle {
    const TEST_NAME: &str = "tangent_circle_circle";

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
mod tangent_circle_circle_native {
    const TEST_NAME: &str = "tangent_circle_circle_native";

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
mod equal_radius_circle_circle_native {
    const TEST_NAME: &str = "equal_radius_circle_circle_native";

    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME, false).await
    }
}
mod equal_radius_arc_arc_native {
    const TEST_NAME: &str = "equal_radius_arc_arc_native";

    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME, false).await
    }
}
mod equal_radius_arc_circle_native {
    const TEST_NAME: &str = "equal_radius_arc_circle_native";

    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME, false).await
    }
}
mod tangent_arc_arc_math_only {
    const TEST_NAME: &str = "tangent_arc_arc_math_only";

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
mod endless_impeller {
    const TEST_NAME: &str = "endless_impeller";

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
mod consumed_solid_subtract_reuse_target {
    const TEST_NAME: &str = "consumed_solid_subtract_reuse_target";

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
mod consumed_solid_subtract_use_result_success {
    const TEST_NAME: &str = "consumed_solid_subtract_use_result_success";

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
mod consumed_solid_join_surfaces_reuse_input {
    const TEST_NAME: &str = "consumed_solid_join_surfaces_reuse_input";

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
mod consumed_solid_join_surfaces_consumed_input {
    const TEST_NAME: &str = "consumed_solid_join_surfaces_consumed_input";

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
mod consumed_solid_clone {
    const TEST_NAME: &str = "consumed_solid_clone";

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
mod consumed_solid_appearance {
    const TEST_NAME: &str = "consumed_solid_appearance";

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
mod consumed_solid_binary_add {
    const TEST_NAME: &str = "consumed_solid_binary_add";

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
mod consumed_solid_binary_subtract {
    const TEST_NAME: &str = "consumed_solid_binary_subtract";

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
mod join_surfaces_single_input_does_not_consume {
    const TEST_NAME: &str = "join_surfaces_single_input_does_not_consume";

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
mod kcl_v2 {
    const TEST_NAME: &str = "kcl_v2";

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
mod inconsistent_sketch {
    const TEST_NAME: &str = "inconsistent_sketch";

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
mod inconsistent_sketch_converge {
    const TEST_NAME: &str = "inconsistent_sketch_converge";

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
mod consumed_solid_original_issue {
    const TEST_NAME: &str = "consumed_solid_original_issue";

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
mod zds_extrude_fillet_top_edge {
    const TEST_NAME: &str = "zds_extrude_fillet_top_edge";

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
mod regression_test_hide_flatten_consumed {
    const TEST_NAME: &str = "regression_test_hide_flatten_consumed";

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

mod christmas_tree_mirror3d_union {
    const TEST_NAME: &str = "christmas_tree_mirror3d_union";

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
mod delete_body {
    const TEST_NAME: &str = "delete_body";

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
mod solid_edge_cut_using_edge_ref_csg {
    const TEST_NAME: &str = "solid_edge_cut_using_edge_ref_csg";

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
mod extrude_split {
    const TEST_NAME: &str = "extrude_split";

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
mod loft_arc_subtract {
    const TEST_NAME: &str = "loft_arc_subtract";

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
mod hide_offset_plane {
    const TEST_NAME: &str = "hide_offset_plane";

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
mod clone_a_mirror3d {
    const TEST_NAME: &str = "clone_a_mirror3d";

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
mod surface_extrude_edge_from_solid {
    const TEST_NAME: &str = "surface_extrude_edge_from_solid";

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
mod sketch_block_circle_constants {
    const TEST_NAME: &str = "sketch_block_circle_constants";

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
mod surface_extrude_edge_from_surface {
    const TEST_NAME: &str = "surface_extrude_edge_from_surface";

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
mod radius_circle_native {
    const TEST_NAME: &str = "radius_circle_native";

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
mod surface_extrude_edge_direction {
    const TEST_NAME: &str = "surface_extrude_edge_direction";

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
mod surface_extrude_edge_symmetric {
    const TEST_NAME: &str = "surface_extrude_edge_symmetric";

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
mod surface_extrude_edge_bidirectional {
    const TEST_NAME: &str = "surface_extrude_edge_bidirectional";

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
mod surface_extrude_edge_to {
    const TEST_NAME: &str = "surface_extrude_edge_to";

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
mod surface_extrude_edge_merge_error {
    const TEST_NAME: &str = "surface_extrude_edge_merge_error";

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
mod sweep_mirror {
    const TEST_NAME: &str = "sweep_mirror";

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
mod beam_sweeps {
    const TEST_NAME: &str = "beam_sweeps";

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
mod truss_bridge {
    const TEST_NAME: &str = "truss_bridge";

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
mod fillet_ambiguous_region_edge_specifier {
    const TEST_NAME: &str = "fillet_ambiguous_region_edge_specifier";

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
mod fillet_ambiguous_region_edge_specifier_broad {
    const TEST_NAME: &str = "fillet_ambiguous_region_edge_specifier_broad";

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
mod gdt_face_api_edge_specifier {
    const TEST_NAME: &str = "gdt_face_api_edge_specifier";

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
mod error_large_fillet_radius {
    const TEST_NAME: &str = "error_large_fillet_radius";

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
mod clone_w_face_tags {
    const TEST_NAME: &str = "clone_w_face_tags";

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
mod surface_extrude_edge_specifier_input {
    const TEST_NAME: &str = "surface_extrude_edge_specifier_input";

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
mod sketch_block_exit {
    const TEST_NAME: &str = "sketch_block_exit";

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
mod surface_extrude_edge_specifier_direction {
    const TEST_NAME: &str = "surface_extrude_edge_specifier_direction";

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
mod mirror3d_edge_specifier {
    const TEST_NAME: &str = "mirror3d_edge_specifier";

    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME, true).await
    }
}
mod mirror3d_edge_specifier_after_subtract {
    const TEST_NAME: &str = "mirror3d_edge_specifier_after_subtract";

    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME, true).await
    }
}
mod fail_user_defined_error {
    const TEST_NAME: &str = "fail_user_defined_error";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that we can unparse the KCL.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL execution fails.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME, false).await
    }
}
mod runtime_exit_in_map {
    const TEST_NAME: &str = "runtime_exit_in_map";

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
mod runtime_exit_in_reduce {
    const TEST_NAME: &str = "runtime_exit_in_reduce";

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
mod runtime_exit_in_pattern_transform {
    const TEST_NAME: &str = "runtime_exit_in_pattern_transform";

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
mod runtime_exit_in_imported_module {
    const TEST_NAME: &str = "runtime_exit_in_imported_module";

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
mod runtime_exit_in_index {
    const TEST_NAME: &str = "runtime_exit_in_index";

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
mod translate_helix {
    const TEST_NAME: &str = "translate_helix";

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
mod region_liveness_engine_contract {
    use std::path::Path;
    use std::path::PathBuf;

    use kittycad_modeling_cmds::ModelingCmd;
    use kittycad_modeling_cmds::each_cmd as mcmd;
    use kittycad_modeling_cmds::length_unit::LengthUnit;
    use kittycad_modeling_cmds::ok_response::OkModelingCmdResponse;
    use kittycad_modeling_cmds::shared::ExtrudeReference;
    use kittycad_modeling_cmds::websocket::OkWebSocketResponseData;
    use uuid::Uuid;

    use crate::ExecState;
    use crate::ExecutorContext;
    use crate::MockConfig;
    use crate::Program;
    use crate::SourceRange;
    use crate::errors::CompilationIssue;
    use crate::errors::ExecError;
    use crate::errors::IsRetryable;
    use crate::errors::Severity;
    use crate::util::RetryConfig;
    use crate::util::execute_with_retries;

    const TEST_DIR: &str = "tests/region_liveness_engine_contract";
    const REGION_LIVENESS_UPDATE_REQUIRED: &str =
        "THE KCL LOGIC FOR LIVENESS OF REGIONS NEEDS TO BE UPDATED BEFORE ACCEPTING THIS ENGINE CHANGE.";
    const REGION_REUSE_WORKAROUND: &str = "Create a separate region for each consuming operation by calling `region(...)` multiple times with the original sketch. Do not clone the source sketch.";

    #[derive(Debug, Clone, Copy, PartialEq, Eq)]
    enum ContractCommand {
        Extrude,
        TwistExtrude,
        ExtrudeToReference,
        Revolve,
        RevolveAboutEdge,
        Sweep,
        RemoveSceneObjects,
    }

    impl ContractCommand {
        const ALL: [Self; 7] = [
            Self::Extrude,
            Self::TwistExtrude,
            Self::ExtrudeToReference,
            Self::Revolve,
            Self::RevolveAboutEdge,
            Self::Sweep,
            Self::RemoveSceneObjects,
        ];

        fn matches(self, command: &ModelingCmd) -> bool {
            matches!(
                (self, command),
                (Self::Extrude, ModelingCmd::Extrude(_))
                    | (Self::TwistExtrude, ModelingCmd::TwistExtrude(_))
                    | (Self::ExtrudeToReference, ModelingCmd::ExtrudeToReference(_))
                    | (Self::Revolve, ModelingCmd::Revolve(_))
                    | (Self::RevolveAboutEdge, ModelingCmd::RevolveAboutEdge(_))
                    | (Self::Sweep, ModelingCmd::Sweep(_))
                    | (Self::RemoveSceneObjects, ModelingCmd::RemoveSceneObjects(_))
            )
        }

        fn name(self) -> &'static str {
            match self {
                Self::Extrude => "extrude",
                Self::TwistExtrude => "twist_extrude",
                Self::ExtrudeToReference => "extrude_to_reference",
                Self::Revolve => "revolve",
                Self::RevolveAboutEdge => "revolve_about_edge",
                Self::Sweep => "sweep",
                Self::RemoveSceneObjects => "delete",
            }
        }

        fn consumed_region_error(self) -> &'static str {
            match self {
                Self::Extrude | Self::TwistExtrude | Self::ExtrudeToReference => {
                    "Unable to extract solid2D within this object to extrude from"
                }
                Self::Revolve | Self::RevolveAboutEdge => {
                    "Unable to extract solid2D within this object to revolve from"
                }
                Self::Sweep => "Unable to extract solid2D within this object to sweep from",
                Self::RemoveSceneObjects => "No such object exists",
            }
        }

        fn second_use_error_after(self, first: Self) -> &'static str {
            if first != Self::RemoveSceneObjects {
                return self.consumed_region_error();
            }

            match self {
                Self::Extrude => "The provided entity is not extrudable",
                Self::TwistExtrude => "The provided entity is not twist-extrudable",
                Self::ExtrudeToReference | Self::RemoveSceneObjects => "No such object exists",
                Self::Revolve | Self::RevolveAboutEdge => "The provided entity is not revolvable",
                Self::Sweep => "The provided entity is not sweepable",
            }
        }

        fn retarget(self, command: &ModelingCmd, region_id: Uuid) -> ModelingCmd {
            match (self, command.clone()) {
                (Self::Extrude, ModelingCmd::Extrude(mut command)) => {
                    command.target = Some(region_id.into());
                    command.target_reference = None;
                    command.faces = None;
                    ModelingCmd::Extrude(command)
                }
                (Self::TwistExtrude, ModelingCmd::TwistExtrude(mut command)) => {
                    command.target = region_id.into();
                    command.faces = None;
                    ModelingCmd::TwistExtrude(command)
                }
                (Self::ExtrudeToReference, ModelingCmd::ExtrudeToReference(mut command)) => {
                    command.target = Some(region_id.into());
                    command.target_reference = None;
                    command.faces = None;
                    ModelingCmd::ExtrudeToReference(command)
                }
                (Self::Revolve, ModelingCmd::Revolve(mut command)) => {
                    command.target = region_id.into();
                    ModelingCmd::Revolve(command)
                }
                (Self::RevolveAboutEdge, ModelingCmd::RevolveAboutEdge(mut command)) => {
                    command.target = region_id.into();
                    ModelingCmd::RevolveAboutEdge(command)
                }
                (Self::Sweep, ModelingCmd::Sweep(mut command)) => {
                    command.target = region_id.into();
                    ModelingCmd::Sweep(command)
                }
                (Self::RemoveSceneObjects, ModelingCmd::RemoveSceneObjects(mut command)) => {
                    command.object_ids.clear();
                    command.object_ids.insert(region_id);
                    ModelingCmd::RemoveSceneObjects(command)
                }
                _ => panic!("expected a {self:?} command template"),
            }
        }
    }

    fn input_path(file_name: &str) -> PathBuf {
        Path::new(TEST_DIR).join(file_name)
    }

    fn region_liveness_changed(case_name: &str, expected: &str, actual: &str) -> ! {
        panic!(
            "{REGION_LIVENESS_UPDATE_REQUIRED}\n\
             Case: `{case_name}`\n\
             Expected: {expected}\n\
             Actual: {actual}"
        )
    }

    fn read_fixture(file_name: &str) -> (PathBuf, String, Program) {
        let path = input_path(file_name);
        let input = std::fs::read_to_string(&path)
            .unwrap_or_else(|error| panic!("failed to read region-liveness fixture {}: {error}", path.display()));
        let program = Program::parse_no_errs(&input)
            .unwrap_or_else(|error| panic!("failed to parse region-liveness fixture {}: {error}", path.display()));
        (path, input, program)
    }

    fn region_liveness_issues(issues: &[CompilationIssue]) -> Vec<CompilationIssue> {
        issues
            .iter()
            .filter(|issue| issue.message.contains(REGION_REUSE_WORKAROUND))
            .cloned()
            .collect()
    }

    fn argument_range(input: &str, call_prefix: &str) -> SourceRange {
        let call_start = input
            .find(call_prefix)
            .unwrap_or_else(|| panic!("expected `{call_prefix}` in region-liveness fixture"));
        let argument_offset = input[call_start..]
            .find("sharedRegion")
            .unwrap_or_else(|| panic!("expected `sharedRegion` after `{call_prefix}`"));
        let start = call_start + argument_offset;
        SourceRange::from([start, start + "sharedRegion".len(), 0])
    }

    async fn execute_first_operation(file_name: &str) -> Result<(ExecutorContext, ExecState), ExecError> {
        let (path, _, program) = read_fixture(file_name);
        let ctx = crate::test_server::new_context(true, Some(path)).await?;
        let mut exec_state = ExecState::new(&ctx);

        if let Err(error) = ctx.run(&program, &mut exec_state).await {
            ctx.close().await;
            return Err(error.into());
        }

        Ok((ctx, exec_state))
    }

    async fn assert_region_is_consumed(
        case_name: &str,
        file_name: &str,
        command_kind: ContractCommand,
        expected_engine_message: &str,
    ) {
        let prepared = execute_with_retries(&RetryConfig::default(), || execute_first_operation(file_name)).await;
        let (ctx, exec_state) = prepared
            .unwrap_or_else(|error| panic!("region-liveness engine contract setup failed for `{case_name}`: {error}"));
        let artifact_command = exec_state
            .root_module_artifact_state()
            .commands
            .iter()
            .rev()
            .find(|artifact_command| command_kind.matches(&artifact_command.command))
            .unwrap_or_else(|| panic!("fixture `{case_name}` did not emit the expected {command_kind:?} command"));

        // Resend the operation below the KCL stdlib so future KCL liveness checks
        // cannot mask a change in the engine's ownership behavior.
        let second_result = ctx
            .engine
            .send_modeling_cmd(
                &ctx.engine_batch,
                Uuid::new_v4(),
                SourceRange::default(),
                &artifact_command.command,
            )
            .await;
        ctx.close().await;

        match second_result {
            Err(error) if error.message() == expected_engine_message => {}
            Err(error) if error.is_retryable() => {
                panic!("region-liveness engine contract transport failed for `{case_name}`: {error}")
            }
            Err(error) => region_liveness_changed(
                case_name,
                &format!("the repeated command to fail with `{expected_engine_message}`"),
                &format!("engine error `{}`", error.message()),
            ),
            Ok(response) => region_liveness_changed(
                case_name,
                "the repeated command to consume its region",
                &format!("the engine accepted it with response {response:?}"),
            ),
        }
    }

    async fn prepare_live_region(case_name: &str, file_name: &str) -> (ExecutorContext, Uuid) {
        let prepared = execute_with_retries(&RetryConfig::default(), || execute_first_operation(file_name)).await;
        let (ctx, exec_state) = prepared
            .unwrap_or_else(|error| panic!("region-liveness engine contract setup failed for `{case_name}`: {error}"));
        let region_id = exec_state
            .root_module_artifact_state()
            .commands
            .iter()
            .rev()
            .find(|artifact_command| matches!(artifact_command.command, ModelingCmd::CreateRegion(_)))
            .map(|artifact_command| artifact_command.cmd_id)
            .unwrap_or_else(|| panic!("fixture `{case_name}` did not create an engine Region"));

        (ctx, region_id)
    }

    async fn prepare_consuming_command_matrix(
        case_name: &str,
    ) -> (ExecutorContext, ModelingCmd, Vec<(ContractCommand, ModelingCmd)>) {
        let file_name = "mixed_profile_consumers_source.kcl";
        let prepared = execute_with_retries(&RetryConfig::default(), || execute_first_operation(file_name)).await;
        let (ctx, exec_state) = match prepared {
            Ok(prepared) => prepared,
            Err(error) if error.is_retryable() => {
                panic!("region-liveness engine contract transport failed for `{case_name}`: {error}")
            }
            Err(error) => region_liveness_changed(
                case_name,
                "the consuming-command fixture to execute successfully",
                &format!("fixture execution failed with `{error}`"),
            ),
        };
        let commands = &exec_state.root_module_artifact_state().commands;
        let create_region_command = commands
            .iter()
            .rev()
            .find(|artifact_command| matches!(artifact_command.command, ModelingCmd::CreateRegion(_)))
            .map(|artifact_command| artifact_command.command.clone())
            .unwrap_or_else(|| panic!("fixture `{file_name}` did not emit a CreateRegion command"));
        let command_templates = ContractCommand::ALL
            .into_iter()
            .map(|command_kind| {
                let command = commands
                    .iter()
                    .rev()
                    .find(|artifact_command| command_kind.matches(&artifact_command.command))
                    .map(|artifact_command| artifact_command.command.clone())
                    .unwrap_or_else(|| panic!("fixture `{file_name}` did not emit a {command_kind:?} command"));
                (command_kind, command)
            })
            .collect();

        (ctx, create_region_command, command_templates)
    }

    fn command_template(
        command_templates: &[(ContractCommand, ModelingCmd)],
        command_kind: ContractCommand,
    ) -> &ModelingCmd {
        command_templates
            .iter()
            .find(|(candidate, _)| *candidate == command_kind)
            .map(|(_, command)| command)
            .unwrap_or_else(|| panic!("missing {command_kind:?} command template"))
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn same_region_as_extrude_target_and_reference_is_rejected() {
        let case_name = "same_region_as_extrude_target_and_reference_is_rejected";
        let (ctx, region_id) = prepare_live_region(case_name, "same_region_multiple_roles_source.kcl").await;
        let command = ModelingCmd::from(
            mcmd::ExtrudeToReference::builder()
                .target(region_id.into())
                .reference(ExtrudeReference::EntityReference {
                    entity_id: Some(region_id),
                    entity_reference: None,
                })
                .build(),
        );
        let result = ctx
            .engine
            .send_modeling_cmd(&ctx.engine_batch, Uuid::new_v4(), SourceRange::default(), &command)
            .await;
        ctx.close().await;

        match result {
            Err(error)
                if error.message()
                    == "Failed to extrude the profile curve. Possible 0-length sections may be present" => {}
            Err(error) if error.is_retryable() => {
                panic!("region-liveness engine contract transport failed for `{case_name}`: {error}")
            }
            result => region_liveness_changed(
                case_name,
                "the aliased ExtrudeToReference command to fail with `Failed to extrude the profile curve. Possible 0-length sections may be present`",
                &format!("the engine returned `{result:?}`"),
            ),
        }
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn same_region_as_sweep_profile_and_trajectory_is_a_successful_no_op() {
        let case_name = "same_region_as_sweep_profile_and_trajectory_is_a_successful_no_op";
        let (ctx, region_id) = prepare_live_region(case_name, "same_region_multiple_roles_source.kcl").await;
        let command = ModelingCmd::from(
            mcmd::Sweep::builder()
                .target(region_id.into())
                .trajectory(region_id.into())
                .sectional(false)
                .tolerance(LengthUnit(0.0000001))
                .body_type(Default::default())
                .translate_profile_to_path(true)
                .orient_profile_perpendicular(true)
                .version(2)
                .build(),
        );
        let operation_id = Uuid::new_v4();
        let result = ctx
            .engine
            .send_modeling_cmd(&ctx.engine_batch, operation_id, SourceRange::default(), &command)
            .await;

        match result {
            Ok(OkWebSocketResponseData::Modeling {
                modeling_response: OkModelingCmdResponse::Sweep(response),
            }) if response.bodies_created.bodies.is_empty() && response.bodies_updated.bodies.is_empty() => {}
            Err(error) if error.is_retryable() => {
                ctx.close().await;
                panic!("region-liveness engine contract transport failed for `{case_name}`: {error}")
            }
            result => {
                ctx.close().await;
                region_liveness_changed(
                    case_name,
                    "the aliased Sweep command to report success with no created or updated bodies",
                    &format!("the engine returned `{result:?}`"),
                )
            }
        }

        let source_lookup = ctx
            .engine
            .send_modeling_cmd(
                &ctx.engine_batch,
                Uuid::new_v4(),
                SourceRange::default(),
                &ModelingCmd::from(mcmd::EntityGetAllChildUuids::builder().entity_id(region_id).build()),
            )
            .await;

        match source_lookup {
            Ok(OkWebSocketResponseData::Modeling {
                modeling_response: OkModelingCmdResponse::EntityGetAllChildUuids(_),
            }) => {}
            Err(error) if error.is_retryable() => {
                ctx.close().await;
                panic!("region-liveness engine contract transport failed for `{case_name}`: {error}")
            }
            result => {
                ctx.close().await;
                region_liveness_changed(
                    case_name,
                    "the aliased Sweep command to leave its source Region live",
                    &format!("the source lookup returned `{result:?}`"),
                )
            }
        }

        let destination_lookup = ctx
            .engine
            .send_modeling_cmd(
                &ctx.engine_batch,
                Uuid::new_v4(),
                SourceRange::default(),
                &ModelingCmd::from(mcmd::EntityGetAllChildUuids::builder().entity_id(operation_id).build()),
            )
            .await;
        ctx.close().await;

        match destination_lookup {
            Err(error) if error.message() == "No such entity exists" => {}
            Err(error) if error.is_retryable() => {
                panic!("region-liveness engine contract transport failed for `{case_name}`: {error}")
            }
            result => region_liveness_changed(
                case_name,
                "the aliased Sweep command to create no destination entity",
                &format!("the destination lookup returned `{result:?}`"),
            ),
        }
    }

    async fn assert_clone_region_known_failure(case_name: &str, file_name: &str) {
        let prepared = execute_with_retries(&RetryConfig::default(), || execute_first_operation(file_name)).await;
        let (ctx, exec_state) = prepared
            .unwrap_or_else(|error| panic!("region-liveness engine contract setup failed for `{case_name}`: {error}"));

        let region_id = exec_state
            .root_module_artifact_state()
            .commands
            .iter()
            .rev()
            .find(|artifact_command| matches!(artifact_command.command, ModelingCmd::CreateRegion(_)))
            .map(|artifact_command| artifact_command.cmd_id)
            .unwrap_or_else(|| panic!("fixture `{case_name}` did not create an engine Region"));

        let source_lookup = ctx
            .engine
            .send_modeling_cmd(
                &ctx.engine_batch,
                Uuid::new_v4(),
                SourceRange::default(),
                &ModelingCmd::from(mcmd::EntityGetAllChildUuids::builder().entity_id(region_id).build()),
            )
            .await;

        match source_lookup {
            Ok(OkWebSocketResponseData::Modeling {
                modeling_response: OkModelingCmdResponse::EntityGetAllChildUuids(_),
            }) => {}
            Err(error) if error.is_retryable() => {
                ctx.close().await;
                panic!("region-liveness engine contract transport failed for `{case_name}`: {error}")
            }
            result => {
                ctx.close().await;
                region_liveness_changed(
                    case_name,
                    "the engine object created by region() to exist before EntityClone",
                    &format!("the source lookup returned `{result:?}`"),
                )
            }
        }

        // Send exactly one clone command against the freshly verified Region.
        // This is not evidence that a successful clone leaves its source live:
        // no clone occurs. It pins the independent engine failure so the test
        // can be replaced with successful source-and-clone reuse coverage when
        // clone(Region) is fixed.
        let clone_id = Uuid::new_v4();
        let clone_result = ctx
            .engine
            .send_modeling_cmd(
                &ctx.engine_batch,
                clone_id,
                SourceRange::default(),
                &ModelingCmd::from(mcmd::EntityClone::builder().entity_id(region_id).build()),
            )
            .await;

        match clone_result {
            Ok(OkWebSocketResponseData::Modeling {
                modeling_response: OkModelingCmdResponse::EntityClone(response),
            }) if response.face_edge_ids.is_empty() => {}
            Err(error) if error.is_retryable() => {
                panic!("region-liveness engine contract transport failed for `{case_name}`: {error}")
            }
            result => {
                ctx.close().await;
                region_liveness_changed(
                    case_name,
                    "EntityClone to report success with no destination while the independent clone(Region) bug is open",
                    &format!("EntityClone returned `{result:?}`"),
                )
            }
        }

        let destination_lookup = ctx
            .engine
            .send_modeling_cmd(
                &ctx.engine_batch,
                Uuid::new_v4(),
                SourceRange::default(),
                &ModelingCmd::from(mcmd::EntityGetAllChildUuids::builder().entity_id(clone_id).build()),
            )
            .await;
        ctx.close().await;

        match destination_lookup {
            Err(error) if error.message() == "No such entity exists" => {}
            Err(error) if error.is_retryable() => {
                panic!("region-liveness engine contract transport failed for `{case_name}`: {error}")
            }
            result => region_liveness_changed(
                case_name,
                "the clone destination to be absent while the independent clone(Region) bug is open",
                &format!("the clone destination lookup returned `{result:?}`"),
            ),
        }
    }

    async fn assert_fixture_succeeds(case_name: &str, file_name: &str, expected: &str) {
        let path = input_path(file_name);
        let input = std::fs::read_to_string(&path)
            .unwrap_or_else(|error| panic!("failed to read region-liveness fixture {}: {error}", path.display()));
        let result = execute_with_retries(&RetryConfig::default(), || {
            crate::test_server::execute(&input, Some(path.clone()))
        })
        .await;

        match result {
            Ok(()) => {}
            Err(error) if error.is_retryable() => {
                panic!("region-liveness engine contract transport failed for `{case_name}`: {error}")
            }
            Err(error) => region_liveness_changed(case_name, expected, &format!("execution failed with `{error}`")),
        }
    }

    async fn assert_region_is_reusable(case_name: &str, file_name: &str) {
        assert_fixture_succeeds(case_name, file_name, "the region to remain reusable").await;
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn region_liveness_warnings_match_in_mock_and_real_execution() {
        let case_name = "region_liveness_warnings_match_in_mock_and_real_execution";
        let file_name = "interpreter_warning_parity.kcl";
        let (_, input, program) = read_fixture(file_name);

        let mock_ctx = ExecutorContext::new_mock(None).await;
        let mock_outcome = mock_ctx
            .run_mock(&program, &MockConfig::default())
            .await
            .unwrap_or_else(|error| panic!("mock execution failed for `{case_name}`: {error}"));
        mock_ctx.close().await;

        let prepared = execute_with_retries(&RetryConfig::default(), || execute_first_operation(file_name)).await;
        let (real_ctx, real_state) =
            prepared.unwrap_or_else(|error| panic!("real execution failed for `{case_name}`: {error}"));
        real_ctx.close().await;

        let mock_issues = region_liveness_issues(&mock_outcome.issues);
        let real_issues = region_liveness_issues(real_state.issues());
        assert_eq!(
            mock_issues, real_issues,
            "mock and real region-liveness warnings differ"
        );

        let expected = [
            (
                argument_range(&input, "hidden = hide("),
                format!(
                    "`sharedRegion` was already consumed by `extrude`. Passing it to `hide` may fail or have no effect because its engine object may no longer be valid. {REGION_REUSE_WORKAROUND}"
                ),
            ),
            (
                argument_range(&input, "delete("),
                format!(
                    "`sharedRegion` was already consumed by `extrude`. Passing it to `delete` may fail or have no effect because its engine object may no longer be valid. {REGION_REUSE_WORKAROUND}"
                ),
            ),
        ];
        assert_eq!(mock_issues.len(), expected.len(), "unexpected region-liveness issues");
        for (issue, (source_range, message)) in mock_issues.iter().zip(expected) {
            assert_eq!(issue.source_range, source_range);
            assert_eq!(issue.message, message);
            assert_eq!(issue.severity, Severity::Warning);
        }
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn region_liveness_errors_match_in_mock_and_real_execution() {
        let case_name = "region_liveness_errors_match_in_mock_and_real_execution";
        let file_name = "interpreter_error_parity.kcl";
        let (path, input, program) = read_fixture(file_name);

        let mock_ctx = ExecutorContext::new_mock(None).await;
        let mock_error = mock_ctx
            .run_mock(&program, &MockConfig::default())
            .await
            .expect_err("mock execution should reject a consumed sweep profile");
        mock_ctx.close().await;

        let real_error = execute_with_retries(&RetryConfig::default(), || {
            crate::test_server::execute(&input, Some(path.clone()))
        })
        .await
        .expect_err("real execution should reject a consumed sweep profile");
        let ExecError::Kcl(real_error) = real_error else {
            panic!("real execution failed outside KCL for `{case_name}`: {real_error}");
        };

        assert_eq!(
            mock_error.error, real_error.error,
            "mock and real region-liveness errors differ"
        );
        assert_eq!(
            mock_error.error.message(),
            format!(
                "`sharedRegion` was already consumed by a `extrude` operation and can no longer be used. {REGION_REUSE_WORKAROUND}"
            )
        );
    }

    #[test]
    #[should_panic(expected = "THE KCL LOGIC FOR LIVENESS OF REGIONS NEEDS TO BE UPDATED")]
    fn engine_contract_change_has_an_actionable_failure_message() {
        region_liveness_changed(
            "diagnostic contract",
            "the pinned engine behavior",
            "changed engine behavior",
        )
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn consumed_region_contracts() {
        let cases = [
            (
                "extrude_target_is_consumed",
                "input.kcl",
                ContractCommand::Extrude,
                "Unable to extract solid2D within this object to extrude from",
            ),
            (
                "twist_extrude_target_is_consumed",
                "twist_extrude.kcl",
                ContractCommand::TwistExtrude,
                "Unable to extract solid2D within this object to extrude from",
            ),
            (
                "extrude_to_reference_target_is_consumed",
                "extrude_to_reference.kcl",
                ContractCommand::ExtrudeToReference,
                "Unable to extract solid2D within this object to extrude from",
            ),
            (
                "revolve_target_is_consumed",
                "revolve.kcl",
                ContractCommand::Revolve,
                "Unable to extract solid2D within this object to revolve from",
            ),
            (
                "revolve_about_edge_target_is_consumed",
                "revolve_about_edge.kcl",
                ContractCommand::RevolveAboutEdge,
                "Unable to extract solid2D within this object to revolve from",
            ),
            (
                "sweep_profile_is_consumed",
                "sweep_profile.kcl",
                ContractCommand::Sweep,
                "Unable to extract solid2D within this object to sweep from",
            ),
            (
                "delete_target_is_consumed",
                "delete_target.kcl",
                ContractCommand::RemoveSceneObjects,
                "No such object exists",
            ),
            (
                "duplicate_extrude_profiles_are_rejected",
                "duplicate_extrude_profiles.kcl",
                ContractCommand::Extrude,
                "Unable to extract solid2D within this object to extrude from",
            ),
            (
                "duplicate_revolve_profiles_are_rejected",
                "duplicate_revolve_profiles.kcl",
                ContractCommand::Revolve,
                "Unable to extract solid2D within this object to revolve from",
            ),
            (
                "duplicate_sweep_profiles_are_rejected",
                "duplicate_sweep_profiles.kcl",
                ContractCommand::Sweep,
                "Unable to extract solid2D within this object to sweep from",
            ),
        ];

        for (case_name, file_name, command, expected_message) in cases {
            assert_region_is_consumed(case_name, file_name, command, expected_message).await;
        }
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn every_mixed_consuming_command_has_pinned_second_operation_behavior() {
        let matrix_name = "every_mixed_consuming_command_has_pinned_second_operation_behavior";
        let (ctx, create_region_command, command_templates) = prepare_consuming_command_matrix(matrix_name).await;

        for first in ContractCommand::ALL {
            for second in ContractCommand::ALL {
                if first == second {
                    continue;
                }

                let case_name = format!("{}_then_{}", first.name(), second.name());
                let region_id = Uuid::new_v4();
                let create_result = ctx
                    .engine
                    .send_modeling_cmd(
                        &ctx.engine_batch,
                        region_id,
                        SourceRange::default(),
                        &create_region_command,
                    )
                    .await;
                match create_result {
                    Ok(_) => {}
                    Err(error) if error.is_retryable() => {
                        ctx.close().await;
                        panic!("region-liveness engine contract transport failed for `{case_name}`: {error}")
                    }
                    Err(error) => {
                        ctx.close().await;
                        region_liveness_changed(
                            &case_name,
                            "region(...) to create a fresh profile for the command pair",
                            &format!("CreateRegion failed with `{}`", error.message()),
                        )
                    }
                }

                let first_command = first.retarget(command_template(&command_templates, first), region_id);
                let first_result = ctx
                    .engine
                    .send_modeling_cmd(
                        &ctx.engine_batch,
                        Uuid::new_v4(),
                        SourceRange::default(),
                        &first_command,
                    )
                    .await;
                match first_result {
                    Ok(_) => {}
                    Err(error) if error.is_retryable() => {
                        ctx.close().await;
                        panic!("region-liveness engine contract transport failed for `{case_name}`: {error}")
                    }
                    Err(error) => {
                        ctx.close().await;
                        region_liveness_changed(
                            &case_name,
                            &format!("the first {} command to succeed", first.name()),
                            &format!("the engine returned error `{}`", error.message()),
                        )
                    }
                }

                let second_command = second.retarget(command_template(&command_templates, second), region_id);
                let second_result = ctx
                    .engine
                    .send_modeling_cmd(
                        &ctx.engine_batch,
                        Uuid::new_v4(),
                        SourceRange::default(),
                        &second_command,
                    )
                    .await;
                match second_result {
                    Ok(_) if second == ContractCommand::RemoveSceneObjects => {}
                    Err(error)
                        if second != ContractCommand::RemoveSceneObjects
                            && error.message() == second.second_use_error_after(first) => {}
                    Err(error) if error.is_retryable() => {
                        ctx.close().await;
                        panic!("region-liveness engine contract transport failed for `{case_name}`: {error}")
                    }
                    Err(error) => {
                        ctx.close().await;
                        region_liveness_changed(
                            &case_name,
                            if second == ContractCommand::RemoveSceneObjects {
                                "delete to accept a profile consumed by another command".to_owned()
                            } else {
                                format!(
                                    "the second {} command to fail with `{}`",
                                    second.name(),
                                    second.second_use_error_after(first)
                                )
                            }
                            .as_str(),
                            &format!("the engine returned error `{}`", error.message()),
                        )
                    }
                    Ok(response) => {
                        ctx.close().await;
                        region_liveness_changed(
                            &case_name,
                            &format!(
                                "the first {} command to consume the profile before {}",
                                first.name(),
                                second.name()
                            ),
                            &format!("the engine accepted the second command with response {response:?}"),
                        )
                    }
                }
            }
        }

        ctx.close().await;
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn regions_from_one_original_sketch_are_independently_consumable() {
        assert_fixture_succeeds(
            "regions_from_one_original_sketch_are_independently_consumable",
            "mixed_profile_consumers_source.kcl",
            "each region(...) result from the original sketch to be independently consumable",
        )
        .await;
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn reusable_region_contracts() {
        let cases = [
            ("extrude_reference_region_is_reusable", "extrude_reference_region.kcl"),
            (
                "pattern_transform_2d_source_region_is_reusable",
                "pattern_transform_2d_source.kcl",
            ),
            (
                "pattern_linear_2d_source_region_is_reusable",
                "pattern_linear_2d_source.kcl",
            ),
            (
                "pattern_circular_2d_source_region_is_reusable",
                "pattern_circular_2d_source.kcl",
            ),
            ("mirror_2d_source_region_is_reusable", "mirror_2d_source.kcl"),
            (
                "mirror_2d_across_edge_source_region_is_reusable",
                "mirror_2d_across_edge_source.kcl",
            ),
            ("transform_source_region_is_reusable", "transform_source.kcl"),
            ("hidden_region_is_reusable", "hide_source.kcl"),
            ("extend_path_region_is_reusable", "extend_path_region.kcl"),
            ("close_path_region_is_reusable", "close_path_region.kcl"),
            ("create_region_source_region_is_reusable", "region_source_region.kcl"),
            ("sweep_trajectory_is_reusable", "sweep_trajectory.kcl"),
            ("loft_sections_are_reusable", "loft_sections.kcl"),
            ("subtract2d_target_is_reusable", "subtract2d_target.kcl"),
            ("subtract2d_tool_is_reusable", "subtract2d_tool.kcl"),
        ];

        for (case_name, file_name) in cases {
            assert_region_is_reusable(case_name, file_name).await;
        }
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn duplicate_delete_targets_are_deduplicated() {
        assert_fixture_succeeds(
            "duplicate_delete_targets_are_deduplicated",
            "duplicate_delete_targets.kcl",
            "duplicate delete targets to be deduplicated and accepted",
        )
        .await;
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn clone_source_region_is_reusable_is_unverified_while_clone_is_broken() {
        assert_clone_region_known_failure(
            "clone_source_region_is_reusable_is_unverified_while_clone_is_broken",
            "clone_source.kcl",
        )
        .await;
    }
}
