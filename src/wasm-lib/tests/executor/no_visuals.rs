use kcl_lib::{ast::types::Program, errors::KclError, executor::ExecutorContext};

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
    let (ctx, program) = setup(code).await;

    ctx.run(&program, None).await.unwrap();
}

async fn setup(program: &str) -> (ExecutorContext, Program) {
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
        is_mock: true,
    };
    (ctx, program)
}

async fn run_fail(code: &str) -> KclError {
    let (ctx, program) = setup(code).await;
    ctx.run(&program, None).await.unwrap_err()
}

gen_test!(property_of_object);
gen_test!(index_of_array);
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
