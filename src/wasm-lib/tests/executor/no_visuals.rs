macro_rules! gen_test {
    ($file:ident) => {
        #[tokio::test]
        async fn $file() {
            let code = include_str!(concat!("inputs/no_visuals/", stringify!($file), ".kcl"));
            run(&code).await;
        }
    };
}

async fn run(program: &str) {
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

    ctx.run(&program, None).await.unwrap();
}

gen_test!(property_of_object);
gen_test!(index_of_array);
