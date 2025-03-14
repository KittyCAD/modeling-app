use std::{
    panic::{catch_unwind, AssertUnwindSafe},
    path::{Path, PathBuf},
};

use insta::rounded_redaction;

use crate::{
    errors::KclError,
    exec::ArtifactCommand,
    execution::{ArtifactGraph, Operation},
    ModuleId,
};

mod kcl_samples;

/// A simulation test.
#[derive(Debug, Clone)]
struct Test {
    /// The name of the test.
    name: String,
    /// The name of the KCL file that's the entry point, e.g. "main.kcl", in the
    /// `input_dir`.
    entry_point: String,
    /// Input KCL files are in this directory.
    input_dir: PathBuf,
    /// Expected snapshot output files are in this directory.
    output_dir: PathBuf,
}

pub(crate) const RENDERED_MODEL_NAME: &str = "rendered_model.png";

impl Test {
    fn new(name: &str) -> Self {
        Self {
            name: name.to_owned(),
            entry_point: "input.kcl".to_owned(),
            input_dir: Path::new("tests").join(name),
            output_dir: Path::new("tests").join(name),
        }
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
    // Sorting maps makes them easier to diff.
    settings.set_sort_maps(true);
    // Replace UUIDs with the string "[uuid]", because otherwise the tests would constantly
    // be changing the UUID. This is a stopgap measure until we make the engine more deterministic.
    settings.add_filter(
        r"\b[[:xdigit:]]{8}-[[:xdigit:]]{4}-[[:xdigit:]]{4}-[[:xdigit:]]{4}-[[:xdigit:]]{12}\b",
        "[uuid]",
    );
    // Run `f` (the closure that was passed in) with these settings.
    settings.bind(f);
}

fn read<P>(filename: &str, dir: P) -> String
where
    P: AsRef<Path>,
{
    std::fs::read_to_string(dir.as_ref().join(filename)).expect("Failed to read file: {filename}")
}

fn parse(test_name: &str) {
    parse_test(&Test::new(test_name));
}

fn parse_test(test: &Test) {
    let input = read(&test.entry_point, &test.input_dir);
    let tokens = crate::parsing::token::lex(&input, ModuleId::default()).unwrap();

    // Parse the tokens into an AST.
    let parse_res = Result::<_, KclError>::Ok(crate::parsing::parse_tokens(tokens).unwrap());
    assert_snapshot(test, "Result of parsing", || {
        insta::assert_json_snapshot!("ast", parse_res, {
            ".**.start" => 0,
            ".**.end" => 0,
            ".**.comment_start" => 0,
        });
    });
}

async fn unparse(test_name: &str) {
    unparse_test(&Test::new(test_name)).await;
}

async fn unparse_test(test: &Test) {
    // Parse into an AST
    let input = read(&test.entry_point, &test.input_dir);
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
    let entry_point = test.input_dir.join(&test.entry_point);
    let kcl_files = crate::unparser::walk_dir(&test.input_dir).await.unwrap();
    // Filter out the entry point file.
    let kcl_files = kcl_files.into_iter().filter(|f| f != &entry_point);
    let futures = kcl_files
        .into_iter()
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
    let input = read(&test.entry_point, &test.input_dir);
    let ast = crate::Program::parse_no_errs(&input).unwrap();

    // Run the program.
    let exec_res =
        crate::test_server::execute_and_snapshot_ast(ast, Some(test.input_dir.join(&test.entry_point)), export_step)
            .await;
    match exec_res {
        Ok((exec_state, env_ref, png, step)) => {
            let fail_path = test.output_dir.join("execution_error.snap");
            if std::fs::exists(&fail_path).unwrap() {
                panic!("This test case is expected to fail, but it passed. If this is intended, and the test should actually be passing now, please delete kcl-lib/{}", fail_path.to_string_lossy())
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
            let outcome = exec_state.to_wasm_outcome(env_ref).await;

            let mem_result = catch_unwind(AssertUnwindSafe(|| {
                assert_snapshot(test, "Variables in memory after executing", || {
                    insta::assert_json_snapshot!("program_memory", outcome.variables, {
                        ".**.value" => rounded_redaction(4),
                        ".**[].value" => rounded_redaction(4),
                        ".**.from[]" => rounded_redaction(4),
                        ".**.to[]" => rounded_redaction(4),
                        ".**.center[]" => rounded_redaction(4),
                        ".**[].x[]" => rounded_redaction(4),
                        ".**[].y[]" => rounded_redaction(4),
                        ".**[].z[]" => rounded_redaction(4),
                        ".**.sourceRange" => Vec::new(),
                    })
                })
            }));

            assert_common_snapshots(
                test,
                outcome.operations,
                outcome.artifact_commands,
                outcome.artifact_graph,
            );
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
                        eprintln!("This test case failed, but it previously passed. If this is intended, and the test should actually be failing now, please delete kcl-lib/{} and other associated passing artifacts", ok_path.to_string_lossy());
                        panic!("{report:?}");
                    }
                    let report = format!("{:?}", report);

                    let err_result = catch_unwind(AssertUnwindSafe(|| {
                        assert_snapshot(test, "Error from executing", || {
                            insta::assert_snapshot!("execution_error", report);
                        })
                    }));

                    assert_common_snapshots(test, error.operations, error.artifact_commands, error.artifact_graph);
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
/// when it results in an error.
fn assert_common_snapshots(
    test: &Test,
    operations: Vec<Operation>,
    artifact_commands: Vec<ArtifactCommand>,
    artifact_graph: ArtifactGraph,
) {
    let result1 = catch_unwind(AssertUnwindSafe(|| {
        assert_snapshot(test, "Operations executed", || {
            insta::assert_json_snapshot!("ops", operations, {
                "[].unlabeledArg.*.value.**[].from[]" => rounded_redaction(4),
                "[].unlabeledArg.*.value.**[].to[]" => rounded_redaction(4),
                "[].labeledArgs.*.value.**[].from[]" => rounded_redaction(4),
                "[].labeledArgs.*.value.**[].to[]" => rounded_redaction(4),
                ".**.sourceRange" => Vec::new(),
            });
        })
    }));
    let result2 = catch_unwind(AssertUnwindSafe(|| {
        assert_snapshot(test, "Artifact commands", || {
            insta::assert_json_snapshot!("artifact_commands", artifact_commands, {
                "[].command.segment.*.x" => rounded_redaction(4),
                "[].command.segment.*.y" => rounded_redaction(4),
                "[].command.segment.*.z" => rounded_redaction(4),
                ".**.range" => Vec::new(),
            });
        })
    }));
    let result3 = catch_unwind(AssertUnwindSafe(|| {
        assert_snapshot(test, "Artifact graph flowchart", || {
            let flowchart = artifact_graph
                .to_mermaid_flowchart()
                .unwrap_or_else(|e| format!("Failed to convert artifact graph to flowchart: {e}"));
            // Change the snapshot suffix so that it is rendered as a Markdown file
            // in GitHub.
            insta::assert_binary_snapshot!("artifact_graph_flowchart.md", flowchart.as_bytes().to_owned());
        })
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
mod property_of_object {
    const TEST_NAME: &str = "property_of_object";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
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
mod import_whole {
    const TEST_NAME: &str = "import_whole";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
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
mod big_number_angle_to_match_length_x {
    const TEST_NAME: &str = "big_number_angle_to_match_length_x";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME, true).await
    }
}
mod big_number_angle_to_match_length_y {
    const TEST_NAME: &str = "big_number_angle_to_match_length_y";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
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
