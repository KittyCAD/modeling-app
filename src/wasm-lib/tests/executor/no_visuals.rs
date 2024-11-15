use kcl_lib::{
    ast::types::{ModuleId, Node, Program},
    errors::KclError,
    executor::{ExecutorContext, IdGenerator},
    parser,
};

macro_rules! gen_test_fail {
    ($file:ident, $expected:literal) => {
        #[tokio::test]
        async fn $file() {
            let code = include_str!(concat!("inputs/no_visuals/", stringify!($file), ".kcl"));
            let actual = run_fail(&code).await;
            assert_eq!(actual.get_message(), $expected);
        }
    };
}

macro_rules! gen_test_parse_fail {
    ($file:ident, $expected:literal) => {
        #[tokio::test]
        async fn $file() {
            let code = include_str!(concat!("inputs/no_visuals/", stringify!($file), ".kcl"));
            let actual = run_parse_fail(&code).await;
            assert_eq!(actual.get_message(), $expected);
        }
    };
}

async fn setup(program: &str) -> (ExecutorContext, Node<Program>, IdGenerator) {
    let module_id = ModuleId::default();
    let tokens = kcl_lib::token::lexer(program, module_id).unwrap();
    let parser = kcl_lib::parser::Parser::new(tokens);
    let program = parser.ast().unwrap();
    let ctx = kcl_lib::executor::ExecutorContext {
        engine: std::sync::Arc::new(Box::new(
            kcl_lib::engine::conn_mock::EngineConnection::new().await.unwrap(),
        )),
        fs: std::sync::Arc::new(kcl_lib::fs::FileManager::new()),
        stdlib: std::sync::Arc::new(kcl_lib::std::StdLib::new()),
        settings: Default::default(),
        context_type: kcl_lib::executor::ContextType::Mock,
    };
    (ctx, program, IdGenerator::default())
}

async fn run_fail(code: &str) -> KclError {
    let (ctx, program, id_generator) = setup(code).await;
    let Err(e) = ctx
        .run(
            &program,
            None,
            id_generator,
            Some("tests/executor/inputs/no_visuals/".to_owned()),
        )
        .await
    else {
        panic!("Expected this KCL program to fail, but it (incorrectly) never threw an error.");
    };
    e
}

async fn run_parse_fail(code: &str) -> KclError {
    let Err(e) = parser::top_level_parse(code) else {
        panic!("Expected this KCL program to fail to parse, but it (incorrectly) never threw an error.");
    };
    e
}

gen_test_fail!(
    invalid_index_str,
    "semantic: Only integers >= 0 can be used as the index of an array, but you're using a string"
);
gen_test_fail!(
    invalid_index_negative,
    "semantic: '-1' is negative, so you can't index an array with it"
);
gen_test_fail!(
    invalid_index_fractional,
    "semantic: Only strings or ints (>= 0) can be properties/indexes"
);
gen_test_fail!(
    invalid_member_object,
    "semantic: Only arrays and objects can be indexed, but you're trying to index an integer"
);
gen_test_fail!(
    invalid_member_object_prop,
    "semantic: Only arrays and objects can be indexed, but you're trying to index a boolean (true/false value)"
);
gen_test_fail!(
    non_string_key_of_object,
    "semantic: Only strings can be used as the property of an object, but you're using a number"
);
gen_test_fail!(
    array_index_oob,
    "undefined value: The array doesn't have any item at index 0"
);
gen_test_fail!(
    object_prop_not_found,
    "undefined value: Property 'age' not found in object"
);
gen_test_fail!(
    pipe_substitution_inside_function_called_from_pipeline,
    "semantic: cannot use % outside a pipe expression"
);
// gen_test_fail!(
//     if_else_no_expr,
//     "syntax: blocks inside an if/else expression must end in an expression"
// );
gen_test_fail!(
    comparisons_multiple,
    "semantic: Expected a number, but found a boolean (true/false value)"
);
gen_test_fail!(
    import_cycle1,
    "import cycle: circular import of modules is not allowed: tests/executor/inputs/no_visuals/import_cycle2.kcl -> tests/executor/inputs/no_visuals/import_cycle3.kcl -> tests/executor/inputs/no_visuals/import_cycle1.kcl -> tests/executor/inputs/no_visuals/import_cycle2.kcl"
);
gen_test_fail!(
    import_constant,
    "semantic: Error loading imported file. Open it to view more details. export_constant.kcl: Only functions can be exported"
);
gen_test_fail!(
    import_side_effect,
    "semantic: Error loading imported file. Open it to view more details. export_side_effect.kcl: Cannot send modeling commands while importing. Wrap your code in a function if you want to import the file."
);
gen_test_parse_fail!(
    import_from_other_directory,
    "syntax: import path may only contain alphanumeric characters, underscore, hyphen, and period. Files in other directories are not yet supported."
);
// TODO: We'd like these tests.
// gen_test_fail!(
//     import_in_if,
//     "syntax: Can import only import at the top level"
// );
// gen_test_fail!(
//     import_in_function,
//     "syntax: Can import only import at the top level"
// );
gen_test_fail!(
    array_elem_push_fail,
    "undefined value: The array doesn't have any item at index 3"
);
