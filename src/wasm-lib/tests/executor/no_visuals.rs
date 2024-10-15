use kcl_lib::{
    ast::types::Program,
    errors::KclError,
    executor::{ExecutorContext, IdGenerator},
};

macro_rules! gen_test {
    ($file:ident) => {
        #[tokio::test]
        async fn $file() {
            let code = include_str!(concat!("inputs/no_visuals/", stringify!($file), ".kcl"));
            run(&code).await;
        }
    };
}

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

async fn run(code: &str) {
    let (ctx, program, id_generator) = setup(code).await;

    let res = ctx.run(&program, None, id_generator).await;
    match res {
        Ok(state) => {
            println!("{:#?}", state.memory);
        }
        Err(e) => {
            panic!("{e}");
        }
    }
}

async fn setup(program: &str) -> (ExecutorContext, Program, IdGenerator) {
    let tokens = kcl_lib::token::lexer(program).unwrap();
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
    let Err(e) = ctx.run(&program, None, id_generator).await else {
        panic!("Expected this KCL program to fail, but it (incorrectly) never threw an error.");
    };
    e
}

gen_test!(property_of_object);
gen_test!(index_of_array);
gen_test!(comparisons);
gen_test_fail!(
    invalid_index_str,
    "semantic: Only integers >= 0 can be used as the index of an array, but you're using a string"
);
gen_test_fail!(
    invalid_index_negative,
    "semantic: i's value is not a valid property/index, you can only use a string or int (>= 0) here"
);
gen_test_fail!(
    invalid_index_fractional,
    "semantic: Only strings or ints (>= 0) can be properties/indexes"
);
gen_test_fail!(
    invalid_member_object,
    "semantic: Only arrays and objects can be indexed, but you're trying to index a number"
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
gen_test!(sketch_in_object);
gen_test!(if_else);
// gen_test_fail!(
//     if_else_no_expr,
//     "syntax: blocks inside an if/else expression must end in an expression"
// );
gen_test_fail!(comparisons_multiple, "syntax: Invalid number: true");
gen_test!(add_lots);
gen_test!(double_map);
