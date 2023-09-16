use anyhow::Result;
use kcl_lib::{ast::types::Program, engine::EngineConnection};

/// Setup the engine and parse code for an ast.
async fn setup(code: &str) -> Result<(EngineConnection, Program)> {
    let user_agent = concat!(env!("CARGO_PKG_NAME"), ".rs/", env!("CARGO_PKG_VERSION"),);
    let http_client = reqwest::Client::builder()
        .user_agent(user_agent)
        // For file conversions we need this to be long.
        .timeout(std::time::Duration::from_secs(600))
        .connect_timeout(std::time::Duration::from_secs(60));
    let ws_client = reqwest::Client::builder()
        .user_agent(user_agent)
        // For file conversions we need this to be long.
        .timeout(std::time::Duration::from_secs(600))
        .connect_timeout(std::time::Duration::from_secs(60))
        .tcp_keepalive(std::time::Duration::from_secs(600))
        .http1_only();

    let token = std::env::var("KITTYCAD_API_TOKEN").expect("KITTYCAD_API_TOKEN not set");

    // Create the client.
    let client = kittycad::Client::new_from_reqwest(token, http_client, ws_client);

    let ws = client
        .modeling()
        .commands_ws(None, None, None, None, Some(false))
        .await?;

    // Create a temporary file to write the output to.
    let output_file = std::env::temp_dir().join(format!("kcl_output_{}.png", uuid::Uuid::new_v4()));

    let tokens = kcl_lib::tokeniser::lexer(code);
    let parser = kcl_lib::parser::Parser::new(tokens);
    let program = parser.ast()?;
    let mut mem: kcl_lib::executor::ProgramMemory = Default::default();
    let mut engine = kcl_lib::engine::EngineConnection::new(ws).await?;
    let _ = kcl_lib::executor::execute(program, &mut mem, kcl_lib::executor::BodyType::Root, &mut engine)?;

    // Send a snapshot request to the engine.
    let resp = engine.send_modeling_cmd_get_response(
        uuid::Uuid::new_v4(),
        kcl_lib::executor::SourceRange::default(),
        kittycad::types::ModelingCmd::TakeSnapshot {
            format: kittycad::types::ImageFormat::Png,
        },
    )?;

    if let kittycad::types::OkWebSocketResponseData::Modeling {
        modeling_response: kittycad::types::OkModelingCmdResponse::TakeSnapshot { data },
    } = &resp
    {
        // Save the snapshot locally.
        std::fs::write(&output_file, &data.contents.0)?;
    } else {
        anyhow::bail!("Unexpected response from engine: {:?}", resp);
    }

    // Read the output file.
    let actual = image::io::Reader::open(output_file).unwrap().decode().unwrap();
    Ok(actual)
}
