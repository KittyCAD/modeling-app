use anyhow::Result;
use kcl_lib::{
    ast::{modify::modify_ast_for_sketch, types::Program},
    engine::EngineManager,
    executor::{ExecutorContext, MemoryItem, PlaneType, SourceRange},
};
use kittycad::types::{ModelingCmd, Point3D};
use pretty_assertions::assert_eq;

/// Setup the engine and parse code for an ast.
async fn setup(code: &str, name: &str) -> Result<(ExecutorContext, Program, uuid::Uuid)> {
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

    let tokens = kcl_lib::token::lexer(code);
    let parser = kcl_lib::parser::Parser::new(tokens);
    let program = parser.ast()?;
    let mut mem: kcl_lib::executor::ProgramMemory = Default::default();
    let engine = kcl_lib::engine::EngineConnection::new(ws).await?;
    let planes = kcl_lib::executor::DefaultPlanes::new(&engine).await?;
    let ctx = ExecutorContext { engine, planes };
    let memory = kcl_lib::executor::execute(program.clone(), &mut mem, kcl_lib::executor::BodyType::Root, &ctx).await?;

    // We need to get the sketch ID.
    // Get the sketch group ID from memory.
    let MemoryItem::SketchGroup(sketch_group) = memory.root.get(name).unwrap() else {
        anyhow::bail!("part001 not found in memory: {:?}", memory);
    };
    let sketch_id = sketch_group.id;

    let plane_id = uuid::Uuid::new_v4();
    ctx.engine
        .send_modeling_cmd(
            plane_id,
            SourceRange::default(),
            ModelingCmd::MakePlane {
                clobber: false,
                origin: Point3D { x: 0.0, y: 0.0, z: 0.0 },
                size: 60.0,
                x_axis: Point3D { x: 1.0, y: 0.0, z: 0.0 },
                y_axis: Point3D { x: 0.0, y: 1.0, z: 0.0 },
                hide: Some(true),
            },
        )
        .await?;

    // Enter sketch mode.
    // We can't get control points without being in sketch mode.
    // You can however get path info without sketch mode.
    ctx.engine
        .send_modeling_cmd(
            uuid::Uuid::new_v4(),
            SourceRange::default(),
            ModelingCmd::SketchModeEnable {
                animated: false,
                ortho: true,
                plane_id,
                disable_camera_with_plane: Some(Point3D { x: 0.0, y: 0.0, z: 1.0 }),
            },
        )
        .await?;

    // Enter edit mode.
    // We can't get control points of an existing sketch without being in edit mode.
    ctx.engine
        .send_modeling_cmd(
            uuid::Uuid::new_v4(),
            SourceRange::default(),
            ModelingCmd::EditModeEnter { target: sketch_id },
        )
        .await?;

    Ok((ctx, program, sketch_id))
}

#[tokio::test(flavor = "multi_thread")]
async fn serial_test_modify_sketch_part001() {
    let name = "part001";
    let code = format!(
        r#"const {} = startSketchOn("XY")
  |> startProfileAt([8.41, 5.78], %)
  |> line([7.37, -11.0], %)
  |> line([-8.69, -3.75], %)
  |> line([-5.0, 4.25], %)
"#,
        name
    );

    let (mut ctx, program, sketch_id) = setup(&code, name).await.unwrap();
    let mut new_program = program.clone();
    let new_code = modify_ast_for_sketch(&mut ctx.engine, &mut new_program, name, PlaneType::XY, sketch_id)
        .await
        .unwrap();

    // Make sure the code is the same.
    assert_eq!(code, new_code);
    // Make sure the program is the same.
    assert_eq!(new_program, program);
}

#[tokio::test(flavor = "multi_thread")]
async fn serial_test_modify_sketch_part002() {
    let name = "part002";
    let code = format!(
        r#"const {} = startSketchOn("XY")
  |> startProfileAt([8.41, 5.78], %)
  |> line([7.42, -8.62], %)
  |> line([-6.38, -3.51], %)
  |> line([-3.77, 3.56], %)
"#,
        name
    );

    let (mut ctx, program, sketch_id) = setup(&code, name).await.unwrap();
    let mut new_program = program.clone();
    let new_code = modify_ast_for_sketch(&mut ctx.engine, &mut new_program, name, PlaneType::XY, sketch_id)
        .await
        .unwrap();

    // Make sure the code is the same.
    assert_eq!(code, new_code);
    // Make sure the program is the same.
    assert_eq!(new_program, program);
}

#[tokio::test(flavor = "multi_thread")]
#[ignore] // until KittyCAD/engine#1434 is fixed.
async fn serial_test_modify_close_sketch() {
    let name = "part002";
    let code = format!(
        r#"const {} = startSketchOn("XY")
  |> startProfileAt([7.91, 3.89], %)
  |> line([7.42, -8.62], %)
  |> line([-6.38, -3.51], %)
  |> line([-3.77, 3.56], %)
  |> close(%)
"#,
        name
    );

    let (mut ctx, program, sketch_id) = setup(&code, name).await.unwrap();
    let mut new_program = program.clone();
    let new_code = modify_ast_for_sketch(&mut ctx.engine, &mut new_program, name, PlaneType::XY, sketch_id)
        .await
        .unwrap();

    // Make sure the code is the same.
    assert_eq!(code, new_code);
    // Make sure the program is the same.
    assert_eq!(new_program, program);
}

#[tokio::test(flavor = "multi_thread")]
async fn serial_test_modify_line_to_close_sketch() {
    let name = "part002";
    let code = format!(
        r#"const {} = startSketchOn("XY")
  |> startProfileAt([7.91, 3.89], %)
  |> line([7.42, -8.62], %)
  |> line([-6.38, -3.51], %)
  |> line([-3.77, 3.56], %)
  |> lineTo([7.91, 3.89], %)
"#,
        name
    );

    let (mut ctx, program, sketch_id) = setup(&code, name).await.unwrap();
    let mut new_program = program.clone();
    let new_code = modify_ast_for_sketch(&mut ctx.engine, &mut new_program, name, PlaneType::XY, sketch_id)
        .await
        .unwrap();

    // Make sure the code is the same.
    assert_eq!(
        new_code,
        format!(
            r#"const {} = startSketchOn("XY")
  |> startProfileAt([7.91, 3.89], %)
  |> line([7.42, -8.62], %)
  |> line([-6.38, -3.51], %)
  |> line([-3.77, 3.56], %)
  |> close(%)
"#,
            name
        )
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn serial_test_modify_with_constraint() {
    let name = "part002";
    let code = format!(
        r#"const thing = 12
const {} = startSketchOn("XY")
  |> startProfileAt([7.91, 3.89], %)
  |> line([7.42, -8.62], %)
  |> line([-6.38, -3.51], %)
  |> line([-3.77, 3.56], %)
  |> lineTo([thing, 3.89], %)
"#,
        name
    );

    let (mut ctx, program, sketch_id) = setup(&code, name).await.unwrap();
    let mut new_program = program.clone();
    let result = modify_ast_for_sketch(&mut ctx.engine, &mut new_program, name, PlaneType::XY, sketch_id).await;

    assert!(result.is_err());
    assert_eq!(
        result.unwrap_err().to_string(),
        r#"engine: KclErrorDetails { source_ranges: [SourceRange([188, 193])], message: "Sketch part002 is constrained `partial` and cannot be modified" }"#
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn serial_test_modify_line_should_close_sketch() {
    let name = "part003";
    let code = format!(
        r#"const {} = startSketchOn("XY")
  |> startProfileAt([13.69, 3.8], %)
  |> line([4.23, -11.79], %)
  |> line([-10.7, -1.16], %)
  |> line([-3.72, 8.69], %)
  |> line([10.19, 4.26], %)
"#,
        name
    );

    let (mut ctx, program, sketch_id) = setup(&code, name).await.unwrap();
    let mut new_program = program.clone();
    let new_code = modify_ast_for_sketch(&mut ctx.engine, &mut new_program, name, PlaneType::XY, sketch_id)
        .await
        .unwrap();

    // Make sure the code is the same.
    assert_eq!(
        new_code,
        format!(
            r#"const {} = startSketchOn("XY")
  |> startProfileAt([13.69, 3.8], %)
  |> line([4.23, -11.79], %)
  |> line([-10.7, -1.16], %)
  |> line([-3.72, 8.69], %)
  |> close(%)
"#,
            name
        )
    );
}
