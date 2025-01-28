use std::path::Path;

use insta::rounded_redaction;

use crate::{
    errors::KclError,
    parsing::ast::types::{Node, Program},
    source_range::ModuleId,
};

/// Deserialize the data from a snapshot.
fn get<T: serde::de::DeserializeOwned>(snapshot: &str) -> T {
    let mut parts = snapshot.split("---");
    let _empty = parts.next().unwrap();
    let _header = parts.next().unwrap();
    let snapshot_data = parts.next().unwrap();
    serde_json::from_str(snapshot_data)
        .and_then(serde_json::from_value)
        .unwrap()
}

fn assert_snapshot<F, R>(test_name: &str, operation: &str, f: F)
where
    F: FnOnce() -> R,
{
    let mut settings = insta::Settings::clone_current();
    // These make the snapshots more readable and match our dir structure.
    settings.set_omit_expression(true);
    settings.set_snapshot_path(format!("../tests/{test_name}"));
    settings.set_prepend_module_to_snapshot(false);
    settings.set_description(format!("{operation} {test_name}.kcl"));
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

fn read(filename: &'static str, test_name: &str) -> String {
    std::fs::read_to_string(format!("tests/{test_name}/{filename}")).unwrap()
}

fn parse(test_name: &str) {
    let input = read("input.kcl", test_name);
    let tokens = crate::parsing::token::lex(&input, ModuleId::default()).unwrap();

    // Parse the tokens into an AST.
    let parse_res = Result::<_, KclError>::Ok(crate::parsing::parse_tokens(tokens).unwrap());
    assert_snapshot(test_name, "Result of parsing", || {
        insta::assert_json_snapshot!("ast", parse_res);
    });
}

fn unparse(test_name: &str) {
    let input = read("ast.snap", test_name);
    let ast_res: Result<Program, KclError> = get(&input);
    let Ok(ast) = ast_res else {
        return;
    };
    // Check recasting the AST produces the original string.
    let actual = ast.recast(&Default::default(), 0);
    if matches!(std::env::var("EXPECTORATE").as_deref(), Ok("overwrite")) {
        std::fs::write(format!("tests/{test_name}/input.kcl"), &actual).unwrap();
    }
    let expected = read("input.kcl", test_name);
    pretty_assertions::assert_eq!(
        actual,
        expected,
        "Parse then unparse didn't recreate the original KCL file"
    );
}

async fn execute(test_name: &str, render_to_png: bool) {
    // Read the AST from disk.
    let input = read("ast.snap", test_name);
    let ast_res: Result<Node<Program>, KclError> = get(&input);
    let Ok(ast) = ast_res else {
        return;
    };

    // Run the program.
    let exec_res = crate::test_server::execute_and_snapshot_ast(
        ast.into(),
        crate::settings::types::UnitLength::Mm,
        Some(Path::new("tests").join(test_name)),
    )
    .await;
    match exec_res {
        Ok((exec_state, png)) => {
            if render_to_png {
                twenty_twenty::assert_image(format!("tests/{test_name}/rendered_model.png"), &png, 0.99);
            }
            assert_snapshot(test_name, "Program memory after executing", || {
                insta::assert_json_snapshot!("program_memory", exec_state.mod_local.memory, {
                    ".environments[].**[].from[]" => rounded_redaction(4),
                    ".environments[].**[].to[]" => rounded_redaction(4),
                    ".environments[].**[].x[]" => rounded_redaction(4),
                    ".environments[].**[].y[]" => rounded_redaction(4),
                    ".environments[].**[].z[]" => rounded_redaction(4),
                });
            });
            assert_snapshot(test_name, "Operations executed", || {
                insta::assert_json_snapshot!("ops", exec_state.mod_local.operations);
            });
            assert_snapshot(test_name, "Artifact commands", || {
                insta::assert_json_snapshot!("artifact_commands", exec_state.global.artifact_commands, {
                    "[].command.segment.*.x" => rounded_redaction(4),
                    "[].command.segment.*.y" => rounded_redaction(4),
                    "[].command.segment.*.z" => rounded_redaction(4),
                });
            });
            assert_snapshot(test_name, "Artifact graph flowchart", || {
                let flowchart = exec_state
                    .global
                    .artifact_graph
                    .to_mermaid_flowchart()
                    .unwrap_or_else(|e| format!("Failed to convert artifact graph to flowchart: {e}"));
                // Change the snapshot suffix so that it is rendered as a
                // Markdown file in GitHub.
                insta::assert_binary_snapshot!("artifact_graph_flowchart.md", flowchart.as_bytes().to_owned());
            });
            assert_snapshot(test_name, "Artifact graph mind map", || {
                let mind_map = exec_state
                    .global
                    .artifact_graph
                    .to_mermaid_mind_map()
                    .unwrap_or_else(|e| format!("Failed to convert artifact graph to mind map: {e}"));
                // Change the snapshot suffix so that it is rendered as a
                // Markdown file in GitHub.
                insta::assert_binary_snapshot!("artifact_graph_mind_map.md", mind_map.as_bytes().to_owned());
            });
        }
        Err(e) => {
            match e.error {
                crate::errors::ExecError::Kcl(error) => {
                    // Snapshot the KCL error with a fancy graphical report.
                    // This looks like a Cargo compile error, with arrows pointing
                    // to source code, underlines, etc.
                    let report = crate::errors::Report {
                        error: error.error,
                        filename: format!("{test_name}.kcl"),
                        kcl_source: read("input.kcl", test_name),
                    };
                    let report = miette::Report::new(report);
                    let report = format!("{:?}", report);

                    assert_snapshot(test_name, "Error from executing", || {
                        insta::assert_snapshot!("execution_error", report);
                    });

                    assert_snapshot(test_name, "Operations executed", || {
                        insta::assert_json_snapshot!("ops", error.operations);
                    });

                    assert_snapshot(test_name, "Artifact commands", || {
                        insta::assert_json_snapshot!("artifact_commands", error.artifact_commands, {
                            "[].command.segment.*.x" => rounded_redaction(4),
                            "[].command.segment.*.y" => rounded_redaction(4),
                            "[].command.segment.*.z" => rounded_redaction(4),
                        });
                    });
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

mod cube {
    const TEST_NAME: &str = "cube";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[test]
    fn unparse() {
        super::unparse(TEST_NAME)
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
    #[test]
    fn unparse() {
        super::unparse(TEST_NAME)
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
    #[test]
    fn unparse() {
        super::unparse(TEST_NAME)
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
    #[test]
    fn unparse() {
        super::unparse(TEST_NAME)
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
    #[test]
    fn unparse() {
        super::unparse(TEST_NAME)
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
    #[test]
    fn unparse() {
        super::unparse(TEST_NAME)
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
    #[test]
    fn unparse() {
        super::unparse(TEST_NAME)
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
    #[test]
    fn unparse() {
        super::unparse(TEST_NAME)
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
    #[test]
    fn unparse() {
        super::unparse(TEST_NAME)
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
    #[test]
    fn unparse() {
        super::unparse(TEST_NAME)
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
    #[test]
    fn unparse() {
        super::unparse(TEST_NAME)
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
    #[test]
    fn unparse() {
        super::unparse(TEST_NAME)
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
    #[test]
    fn unparse() {
        super::unparse(TEST_NAME)
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
    #[test]
    fn unparse() {
        super::unparse(TEST_NAME)
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
    #[test]
    fn unparse() {
        super::unparse(TEST_NAME)
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
    #[test]
    fn unparse() {
        super::unparse(TEST_NAME)
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
    #[test]
    fn unparse() {
        super::unparse(TEST_NAME)
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
    #[test]
    fn unparse() {
        super::unparse(TEST_NAME)
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
    #[test]
    fn unparse() {
        super::unparse(TEST_NAME)
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
    #[test]
    fn unparse() {
        super::unparse(TEST_NAME)
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
    #[test]
    fn unparse() {
        super::unparse(TEST_NAME)
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
    #[test]
    fn unparse() {
        super::unparse(TEST_NAME)
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
    #[test]
    fn unparse() {
        super::unparse(TEST_NAME)
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
    #[test]
    fn unparse() {
        super::unparse(TEST_NAME)
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
    #[test]
    fn unparse() {
        super::unparse(TEST_NAME)
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
    #[test]
    fn unparse() {
        super::unparse(TEST_NAME)
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
    #[test]
    fn unparse() {
        super::unparse(TEST_NAME)
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
    #[test]
    fn unparse() {
        super::unparse(TEST_NAME)
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME, false).await
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
    #[test]
    fn unparse() {
        super::unparse(TEST_NAME)
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
    #[test]
    fn unparse() {
        super::unparse(TEST_NAME)
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
    #[test]
    fn unparse() {
        super::unparse(TEST_NAME)
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
    #[test]
    fn unparse() {
        super::unparse(TEST_NAME)
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
    #[test]
    fn unparse() {
        super::unparse(TEST_NAME)
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
    #[test]
    fn unparse() {
        super::unparse(TEST_NAME)
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME, false).await
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
    #[test]
    fn unparse() {
        super::unparse(TEST_NAME)
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
    #[test]
    fn unparse() {
        super::unparse(TEST_NAME)
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
    #[test]
    fn unparse() {
        super::unparse(TEST_NAME)
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
    #[test]
    fn unparse() {
        super::unparse(TEST_NAME)
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
    #[test]
    fn unparse() {
        super::unparse(TEST_NAME)
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
    #[test]
    fn unparse() {
        super::unparse(TEST_NAME)
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
    #[test]
    fn unparse() {
        super::unparse(TEST_NAME)
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
    #[test]
    fn unparse() {
        super::unparse(TEST_NAME)
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
    #[test]
    fn unparse() {
        super::unparse(TEST_NAME)
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
    #[test]
    fn unparse() {
        super::unparse(TEST_NAME)
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
    #[test]
    fn unparse() {
        super::unparse(TEST_NAME)
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
    #[test]
    fn unparse() {
        super::unparse(TEST_NAME)
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
    #[test]
    fn unparse() {
        super::unparse(TEST_NAME)
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
    #[test]
    fn unparse() {
        super::unparse(TEST_NAME)
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
    #[test]
    fn unparse() {
        super::unparse(TEST_NAME)
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
    #[test]
    fn unparse() {
        super::unparse(TEST_NAME)
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
    #[test]
    fn unparse() {
        super::unparse(TEST_NAME)
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
    #[test]
    fn unparse() {
        super::unparse(TEST_NAME)
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
    #[test]
    fn unparse() {
        super::unparse(TEST_NAME)
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
    #[test]
    fn unparse() {
        super::unparse(TEST_NAME)
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
    #[test]
    fn unparse() {
        super::unparse(TEST_NAME)
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
    #[test]
    fn unparse() {
        super::unparse(TEST_NAME)
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
    #[test]
    fn unparse() {
        super::unparse(TEST_NAME)
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
    #[test]
    fn unparse() {
        super::unparse(TEST_NAME)
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
    #[test]
    fn unparse() {
        super::unparse(TEST_NAME)
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
    #[test]
    fn unparse() {
        super::unparse(TEST_NAME)
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
    #[test]
    fn unparse() {
        super::unparse(TEST_NAME)
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
    #[test]
    fn unparse() {
        super::unparse(TEST_NAME)
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
    #[test]
    fn unparse() {
        super::unparse(TEST_NAME)
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
    #[test]
    fn unparse() {
        super::unparse(TEST_NAME)
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
    #[test]
    fn unparse() {
        super::unparse(TEST_NAME)
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
    #[test]
    fn unparse() {
        super::unparse(TEST_NAME)
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
    #[test]
    fn unparse() {
        super::unparse(TEST_NAME)
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
    #[test]
    fn unparse() {
        super::unparse(TEST_NAME)
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
    #[test]
    fn unparse() {
        super::unparse(TEST_NAME)
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
    #[test]
    fn unparse() {
        super::unparse(TEST_NAME)
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
    #[test]
    fn unparse() {
        super::unparse(TEST_NAME)
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
    #[test]
    fn unparse() {
        super::unparse(TEST_NAME)
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
    #[test]
    fn unparse() {
        super::unparse(TEST_NAME)
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
    #[test]
    fn unparse() {
        super::unparse(TEST_NAME)
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
    #[test]
    fn unparse() {
        super::unparse(TEST_NAME)
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
    #[test]
    fn unparse() {
        super::unparse(TEST_NAME)
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
    #[test]
    fn unparse() {
        super::unparse(TEST_NAME)
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
    #[test]
    fn unparse() {
        super::unparse(TEST_NAME)
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
    #[test]
    fn unparse() {
        super::unparse(TEST_NAME)
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
    #[test]
    fn unparse() {
        super::unparse(TEST_NAME)
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
    #[test]
    fn unparse() {
        super::unparse(TEST_NAME)
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME, false).await
    }
}
