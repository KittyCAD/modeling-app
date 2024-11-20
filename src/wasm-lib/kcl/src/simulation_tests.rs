use insta::rounded_redaction;

use crate::{
    ast::types::{ModuleId, Node, Program},
    errors::KclError,
    parser::Parser,
    token::Token,
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

fn tokenize(test_name: &str) {
    let input = read("input.kcl", test_name);
    let token_res = crate::token::lexer(&input, ModuleId::default());

    assert_snapshot(test_name, "Result of tokenizing", || {
        insta::assert_json_snapshot!("tokens", token_res);
    });
}

fn parse(test_name: &str) {
    let input = read("tokens.snap", test_name);
    let tokens: Result<Vec<Token>, KclError> = get(&input);
    let Ok(tokens) = tokens else {
        return;
    };

    // Parse the tokens into an AST.
    let parse_res = Parser::new(tokens).ast();
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
    let exec_res =
        crate::test_server::execute_and_snapshot_ast(ast.into(), crate::settings::types::UnitLength::Mm).await;
    match exec_res {
        Ok((program_memory, png)) => {
            if render_to_png {
                twenty_twenty::assert_image(format!("tests/{test_name}/rendered_model.png"), &png, 0.99);
            }
            assert_snapshot(test_name, "Program memory after executing", || {
                insta::assert_json_snapshot!("program_memory", program_memory, {
                    ".environments[].**[].from[]" => rounded_redaction(4),
                    ".environments[].**[].to[]" => rounded_redaction(4),
                    ".environments[].**[].x[]" => rounded_redaction(4),
                    ".environments[].**[].y[]" => rounded_redaction(4),
                    ".environments[].**[].z[]" => rounded_redaction(4),
                });
            });
        }
        Err(e) => {
            assert_snapshot(test_name, "Error from executing", || {
                insta::assert_snapshot!("execution_error", e);
            });
        }
    }
}

mod cube {
    const TEST_NAME: &str = "cube";

    /// Test tokenizing KCL.
    #[test]
    fn tokenize() {
        super::tokenize(TEST_NAME)
    }

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

    /// Test tokenizing KCL.
    #[test]
    fn tokenize() {
        super::tokenize(TEST_NAME)
    }

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

    /// Test tokenizing KCL.
    #[test]
    fn tokenize() {
        super::tokenize(TEST_NAME)
    }

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

    /// Test tokenizing KCL.
    #[test]
    fn tokenize() {
        super::tokenize(TEST_NAME)
    }

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

    /// Test tokenizing KCL.
    #[test]
    fn tokenize() {
        super::tokenize(TEST_NAME)
    }

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

    /// Test tokenizing KCL.
    #[test]
    fn tokenize() {
        super::tokenize(TEST_NAME)
    }

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

    /// Test tokenizing KCL.
    #[test]
    fn tokenize() {
        super::tokenize(TEST_NAME)
    }

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

    /// Test tokenizing KCL.
    #[test]
    fn tokenize() {
        super::tokenize(TEST_NAME)
    }

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

    /// Test tokenizing KCL.
    #[test]
    fn tokenize() {
        super::tokenize(TEST_NAME)
    }

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

    /// Test tokenizing KCL.
    #[test]
    fn tokenize() {
        super::tokenize(TEST_NAME)
    }

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

    /// Test tokenizing KCL.
    #[test]
    fn tokenize() {
        super::tokenize(TEST_NAME)
    }

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

    /// Test tokenizing KCL.
    #[test]
    fn tokenize() {
        super::tokenize(TEST_NAME)
    }

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

    /// Test tokenizing KCL.
    #[test]
    fn tokenize() {
        super::tokenize(TEST_NAME)
    }

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

    /// Test tokenizing KCL.
    #[test]
    fn tokenize() {
        super::tokenize(TEST_NAME)
    }

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

    /// Test tokenizing KCL.
    #[test]
    fn tokenize() {
        super::tokenize(TEST_NAME)
    }

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

    /// Test tokenizing KCL.
    #[test]
    fn tokenize() {
        super::tokenize(TEST_NAME)
    }

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

    /// Test tokenizing KCL.
    #[test]
    fn tokenize() {
        super::tokenize(TEST_NAME)
    }

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

    /// Test tokenizing KCL.
    #[test]
    fn tokenize() {
        super::tokenize(TEST_NAME)
    }

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

    /// Test tokenizing KCL.
    #[test]
    fn tokenize() {
        super::tokenize(TEST_NAME)
    }

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

    /// Test tokenizing KCL.
    #[test]
    fn tokenize() {
        super::tokenize(TEST_NAME)
    }

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

    /// Test tokenizing KCL.
    #[test]
    fn tokenize() {
        super::tokenize(TEST_NAME)
    }

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

    /// Test tokenizing KCL.
    #[test]
    fn tokenize() {
        super::tokenize(TEST_NAME)
    }

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

    /// Test tokenizing KCL.
    #[test]
    fn tokenize() {
        super::tokenize(TEST_NAME)
    }

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

    /// Test tokenizing KCL.
    #[test]
    fn tokenize() {
        super::tokenize(TEST_NAME)
    }

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

    /// Test tokenizing KCL.
    #[test]
    fn tokenize() {
        super::tokenize(TEST_NAME)
    }

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

    /// Test tokenizing KCL.
    #[test]
    fn tokenize() {
        super::tokenize(TEST_NAME)
    }

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

    /// Test tokenizing KCL.
    #[test]
    fn tokenize() {
        super::tokenize(TEST_NAME)
    }

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

    /// Test tokenizing KCL.
    #[test]
    fn tokenize() {
        super::tokenize(TEST_NAME)
    }

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

    /// Test tokenizing KCL.
    #[test]
    fn tokenize() {
        super::tokenize(TEST_NAME)
    }

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

    /// Test tokenizing KCL.
    #[test]
    fn tokenize() {
        super::tokenize(TEST_NAME)
    }

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

    /// Test tokenizing KCL.
    #[test]
    fn tokenize() {
        super::tokenize(TEST_NAME)
    }

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

    /// Test tokenizing KCL.
    #[test]
    fn tokenize() {
        super::tokenize(TEST_NAME)
    }

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

    /// Test tokenizing KCL.
    #[test]
    fn tokenize() {
        super::tokenize(TEST_NAME)
    }

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

    /// Test tokenizing KCL.
    #[test]
    fn tokenize() {
        super::tokenize(TEST_NAME)
    }

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

    /// Test tokenizing KCL.
    #[test]
    fn tokenize() {
        super::tokenize(TEST_NAME)
    }

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

    /// Test tokenizing KCL.
    #[test]
    fn tokenize() {
        super::tokenize(TEST_NAME)
    }

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

    /// Test tokenizing KCL.
    #[test]
    fn tokenize() {
        super::tokenize(TEST_NAME)
    }

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

    /// Test tokenizing KCL.
    #[test]
    fn tokenize() {
        super::tokenize(TEST_NAME)
    }

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

    /// Test tokenizing KCL.
    #[test]
    fn tokenize() {
        super::tokenize(TEST_NAME)
    }

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

    /// Test tokenizing KCL.
    #[test]
    fn tokenize() {
        super::tokenize(TEST_NAME)
    }

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

    /// Test tokenizing KCL.
    #[test]
    fn tokenize() {
        super::tokenize(TEST_NAME)
    }

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

    /// Test tokenizing KCL.
    #[test]
    fn tokenize() {
        super::tokenize(TEST_NAME)
    }

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

    /// Test tokenizing KCL.
    #[test]
    fn tokenize() {
        super::tokenize(TEST_NAME)
    }

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

    /// Test tokenizing KCL.
    #[test]
    fn tokenize() {
        super::tokenize(TEST_NAME)
    }

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

    /// Test tokenizing KCL.
    #[test]
    fn tokenize() {
        super::tokenize(TEST_NAME)
    }

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

    /// Test tokenizing KCL.
    #[test]
    fn tokenize() {
        super::tokenize(TEST_NAME)
    }

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

    /// Test tokenizing KCL.
    #[test]
    fn tokenize() {
        super::tokenize(TEST_NAME)
    }

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

    /// Test tokenizing KCL.
    #[test]
    fn tokenize() {
        super::tokenize(TEST_NAME)
    }

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

    /// Test tokenizing KCL.
    #[test]
    fn tokenize() {
        super::tokenize(TEST_NAME)
    }

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

    /// Test tokenizing KCL.
    #[test]
    fn tokenize() {
        super::tokenize(TEST_NAME)
    }

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

    /// Test tokenizing KCL.
    #[test]
    fn tokenize() {
        super::tokenize(TEST_NAME)
    }

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

    /// Test tokenizing KCL.
    #[test]
    fn tokenize() {
        super::tokenize(TEST_NAME)
    }

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

    /// Test tokenizing KCL.
    #[test]
    fn tokenize() {
        super::tokenize(TEST_NAME)
    }

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

    /// Test tokenizing KCL.
    #[test]
    fn tokenize() {
        super::tokenize(TEST_NAME)
    }

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
