use anyhow::Result;
use kcl_lib::{
    ast::{modify::modify_ast_for_sketch, types::Program},
    engine::{EngineConnection, EngineManager},
    executor::{MemoryItem, SourceRange},
};
use kittycad::types::{ModelingCmd, Point3D};
use pretty_assertions::assert_eq;

/// Setup the engine and parse code for an ast.
async fn setup(code: &str, name: &str) -> Result<(EngineConnection, Program, uuid::Uuid)> {
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

    let tokens = kcl_lib::tokeniser::lexer(code);
    let parser = kcl_lib::parser::Parser::new(tokens);
    let program = parser.ast()?;
    let mut mem: kcl_lib::executor::ProgramMemory = Default::default();
    let mut engine = kcl_lib::engine::EngineConnection::new(ws).await?;
    let memory = kcl_lib::executor::execute(
        program.clone(),
        &mut mem,
        kcl_lib::executor::BodyType::Root,
        &mut engine,
    )?;

    // We need to get the sketch ID.
    // Get the sketch group ID from memory.
    let MemoryItem::SketchGroup(sketch_group) = memory.root.get(name).unwrap() else {
        anyhow::bail!("part001 not found in memory: {:?}", memory);
    };
    let sketch_id = sketch_group.id;

    println!("sketch_id: {:?}", sketch_id);
    let plane_id = uuid::Uuid::new_v4();
    engine.send_modeling_cmd(
        plane_id,
        SourceRange::default(),
        ModelingCmd::MakePlane {
            clobber: false,
            origin: Point3D { x: 0.0, y: 0.0, z: 0.0 },
            size: 60.0,
            x_axis: Point3D { x: 1.0, y: 0.0, z: 0.0 },
            y_axis: Point3D { x: 0.0, y: 1.0, z: 0.0 },
        },
    )?;

    // Enter sketch mode.
    // We can't get control points without being in sketch mode.
    // You can however get path info without sketch mode.
    engine.send_modeling_cmd(
        uuid::Uuid::new_v4(),
        SourceRange::default(),
        ModelingCmd::SketchModeEnable {
            animated: false,
            ortho: true,
            plane_id,
        },
    )?;

    // Enter edit mode.
    // We can't get control points of an existing sketch without being in edit mode.
    engine.send_modeling_cmd(
        uuid::Uuid::new_v4(),
        SourceRange::default(),
        ModelingCmd::EditModeEnter { target: sketch_id },
    )?;

    Ok((engine, program, sketch_id))
}

#[tokio::test(flavor = "multi_thread")]
async fn test_modify_sketch_part001() {
    let name = "part001";
    let code = format!(
        r#"const {} = startSketchAt([8.41, 5.78])
  |> line([7.37, -11.0], %)
  |> line([-8.69, -3.75], %)
  |> line([-5.0, 4.25], %)
"#,
        name
    );

    let (mut engine, program, sketch_id) = setup(&code, name).await.unwrap();
    let mut new_program = program.clone();
    let new_code = modify_ast_for_sketch(&mut engine, &mut new_program, name, sketch_id)
        .await
        .unwrap();

    // Make sure the code is the same.
    assert_eq!(code, new_code);
    // Make sure the program is the same.
    assert_eq!(new_program, program);
}

#[tokio::test(flavor = "multi_thread")]
async fn test_modify_sketch_part002() {
    let name = "part002";
    let code = format!(
        r#"const {} = startSketchAt([8.41, 5.78])
  |> line([7.42, -8.62], %)
  |> line([-6.38, -3.51], %)
  |> line([-3.77, 3.56], %)
"#,
        name
    );

    let (mut engine, program, sketch_id) = setup(&code, name).await.unwrap();
    let mut new_program = program.clone();
    let new_code = modify_ast_for_sketch(&mut engine, &mut new_program, name, sketch_id)
        .await
        .unwrap();

    // Make sure the code is the same.
    assert_eq!(code, new_code);
    // Make sure the program is the same.
    assert_eq!(new_program, program);
}

#[tokio::test(flavor = "multi_thread")]
async fn test_modify_close_sketch() {
    let name = "part002";
    let code = format!(
        r#"const {} = startSketchAt([7.91, 3.89])
  |> line([7.42, -8.62], %)
  |> line([-6.38, -3.51], %)
  |> line([-3.77, 3.56], %)
  |> close(%)
"#,
        name
    );

    let (mut engine, program, sketch_id) = setup(&code, name).await.unwrap();
    let mut new_program = program.clone();
    let new_code = modify_ast_for_sketch(&mut engine, &mut new_program, name, sketch_id)
        .await
        .unwrap();

    // Make sure the code is the same.
    assert_eq!(code, new_code);
    // Make sure the program is the same.
    assert_eq!(new_program, program);
}
