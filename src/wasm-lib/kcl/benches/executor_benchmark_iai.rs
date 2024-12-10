use iai::black_box;

async fn execute_server_rack_heavy() {
    let code = SERVER_RACK_HEAVY_PROGRAM;
    black_box(
        kcl_lib::test_server::execute_and_snapshot(code, kcl_lib::UnitLength::Mm, None)
            .await
            .unwrap(),
    );
}

async fn execute_server_rack_lite() {
    let code = SERVER_RACK_LITE_PROGRAM;
    black_box(
        kcl_lib::test_server::execute_and_snapshot(code, kcl_lib::UnitLength::Mm, None)
            .await
            .unwrap(),
    );
}

iai::main! {
    execute_server_rack_lite,
    execute_server_rack_heavy,
}

const SERVER_RACK_HEAVY_PROGRAM: &str = include_str!("../../tests/executor/inputs/server-rack-heavy.kcl");
const SERVER_RACK_LITE_PROGRAM: &str = include_str!("../../tests/executor/inputs/server-rack-lite.kcl");
