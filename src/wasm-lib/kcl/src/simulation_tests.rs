use crate::{
    ast::types::{Node, Program},
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
    let token_res = crate::token::lexer(&input);

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
    let exec_res = crate::test_server::execute_and_snapshot_ast(ast, crate::settings::types::UnitLength::Mm).await;
    match exec_res {
        Ok((program_memory, png)) => {
            if render_to_png {
                twenty_twenty::assert_image(format!("tests/{test_name}/rendered_model.png"), &png, 0.99);
            }
            assert_snapshot(test_name, "Program memory after executing", || {
                insta::assert_json_snapshot!("program_memory", program_memory);
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
