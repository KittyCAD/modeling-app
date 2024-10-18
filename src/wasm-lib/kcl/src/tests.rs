fn get<T: serde::de::DeserializeOwned>(snap: &str) -> T {
    let parts = snap.split("---").collect::<Vec<_>>();
    let s = parts.last().unwrap();
    serde_json::from_str(s).unwrap()
}

mod cube {

    use crate::{ast::types::Program, errors::KclError, parser::Parser, token::Token};
    use std::fs::read_to_string;

    fn read(filename: &'static str) -> String {
        read_to_string(format!("tests/cube/{filename}")).unwrap()
    }

    #[test]
    fn tokenize() {
        let input = read("input.kcl");
        let token_res = crate::token::lexer(&input);

        insta::with_settings!(
            {
                input_file => "../tests/cube/input.kcl",
                prepend_module_to_snapshot => false,
                snapshot_path => "../tests/cube",
            }, {
            insta::assert_json_snapshot!(token_res);
        });
    }

    #[test]
    fn parse() {
        let input = read("tokenize.snap");
        let tokens: Result<Vec<Token>, KclError> = super::get(&input);
        let Ok(tokens) = tokens else {
            return;
        };

        // Parse the tokens into an AST.
        let parse_res = Parser::new(tokens).ast();
        insta::with_settings!(
            {
                input_file => "../tests/cube/tokenize.snap",
                prepend_module_to_snapshot => false,
                snapshot_path => "../tests/cube",
                sort_maps => true,
            }, {
            insta::assert_json_snapshot!(parse_res);
        });

        // Check recasting the AST produces the original string.
        if let Ok(tree) = parse_res {
            let actual = tree.recast(&Default::default(), 0);
            let expected = read("input.kcl");
            pretty_assertions::assert_eq!(
                actual,
                expected,
                "Parse then unparse didn't recreate the original KCL file"
            );
        }
    }

    #[tokio::test]
    async fn execute() {
        // Read the AST from disk.
        let input = read("parse.snap");
        let ast_res: Result<Program, KclError> = super::get(&input);
        let Ok(ast) = ast_res else {
            return;
        };

        // Confirm the AST recasts to the same input KCL.
        println!("{ast:#?}");
        let source = ast.recast(&Default::default(), 0);
        println!("{source}");
        pretty_assertions::assert_eq!(source, read("input.kcl"));

        // Run the program.
        let png_res = crate::test_server::execute_and_snapshot_ast(ast).await;
        let png = png_res.unwrap();
        twenty_twenty::assert_image("../tests/cube/rendered.png", &png, 0.99);
    }
}
