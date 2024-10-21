use anyhow::Result;
use kcl_lib::{
    ast::{
        modify::modify_ast_for_sketch,
        types::{Program, UnboxedNode},
    },
    executor::{ExecutorContext, IdGenerator, KclValue, PlaneType, Sketch, SourceRange},
};
use kittycad_modeling_cmds::{each_cmd as mcmd, length_unit::LengthUnit, shared::Point3d, ModelingCmd};
use pretty_assertions::assert_eq;

/// Setup the engine and parse code for an ast.
async fn setup(code: &str, name: &str) -> Result<(ExecutorContext, UnboxedNode<Program>, uuid::Uuid)> {
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
    let mut client = kittycad::Client::new_from_reqwest(token, http_client, ws_client);
    // Set a local engine address if it's set.
    if let Ok(addr) = std::env::var("LOCAL_ENGINE_ADDR") {
        client.set_base_url(addr);
    }

    let tokens = kcl_lib::token::lexer(code)?;
    let parser = kcl_lib::parser::Parser::new(tokens);
    let program = parser.ast()?;
    let ctx = kcl_lib::executor::ExecutorContext::new(&client, Default::default()).await?;
    let exec_state = ctx.run(&program, None, IdGenerator::default(), None).await?;

    // We need to get the sketch ID.
    // Get the sketch ID from memory.
    let KclValue::UserVal(user_val) = exec_state.memory.get(name, SourceRange::default()).unwrap() else {
        anyhow::bail!("part001 not found in memory: {:?}", exec_state.memory);
    };
    let Some((sketch, _meta)) = user_val.get::<Sketch>() else {
        anyhow::bail!("part001 was not a Sketch");
    };
    let sketch_id = sketch.id;

    let plane_id = uuid::Uuid::new_v4();
    ctx.engine
        .send_modeling_cmd(
            plane_id,
            SourceRange::default(),
            ModelingCmd::from(mcmd::MakePlane {
                clobber: false,
                origin: Point3d::default(),
                size: LengthUnit(60.0),
                x_axis: Point3d { x: 1.0, y: 0.0, z: 0.0 },
                y_axis: Point3d { x: 0.0, y: 1.0, z: 0.0 },
                hide: Some(true),
            }),
        )
        .await?;

    // Enter sketch mode.
    // We can't get control points without being in sketch mode.
    // You can however get path info without sketch mode.
    ctx.engine
        .send_modeling_cmd(
            uuid::Uuid::new_v4(),
            SourceRange::default(),
            ModelingCmd::from(mcmd::EnableSketchMode {
                animated: false,
                ortho: true,
                entity_id: plane_id,
                planar_normal: Some(Point3d { x: 0.0, y: 0.0, z: 1.0 }),
                adjust_camera: false,
            }),
        )
        .await?;

    Ok((ctx, program, sketch_id))
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_modify_sketch_part001() {
    let name = "part001";
    let code = format!(
        r#"{} = startSketchOn("XY")
  |> startProfileAt([8.41, 5.78], %)
  |> line([7.37, -11.0], %)
  |> line([-8.69, -3.75], %)
  |> line([-5.0, 4.25], %)
"#,
        name
    );

    let (ctx, program, sketch_id) = setup(&code, name).await.unwrap();
    let mut new_program = program.clone();
    let new_code = modify_ast_for_sketch(&ctx.engine, &mut new_program, name, PlaneType::XY, sketch_id)
        .await
        .unwrap();

    // Make sure the code is the same.
    assert_eq!(code, new_code);
    // Make sure the program is the same.
    assert_eq!(new_program, program);
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_modify_sketch_part002() {
    let name = "part002";
    let code = format!(
        r#"{} = startSketchOn("XY")
  |> startProfileAt([8.41, 5.78], %)
  |> line([7.42, -8.62], %)
  |> line([-6.38, -3.51], %)
  |> line([-3.77, 3.56], %)
"#,
        name
    );

    let (ctx, program, sketch_id) = setup(&code, name).await.unwrap();
    let mut new_program = program.clone();
    let new_code = modify_ast_for_sketch(&ctx.engine, &mut new_program, name, PlaneType::XY, sketch_id)
        .await
        .unwrap();

    // Make sure the code is the same.
    assert_eq!(code, new_code);
    // Make sure the program is the same.
    assert_eq!(new_program, program);
}

#[tokio::test(flavor = "multi_thread")]
#[ignore] // until KittyCAD/engine#1434 is fixed.
async fn kcl_test_modify_close_sketch() {
    let name = "part002";
    let code = format!(
        r#"{} = startSketchOn("XY")
  |> startProfileAt([7.91, 3.89], %)
  |> line([7.42, -8.62], %)
  |> line([-6.38, -3.51], %)
  |> line([-3.77, 3.56], %)
  |> close(%)
"#,
        name
    );

    let (ctx, program, sketch_id) = setup(&code, name).await.unwrap();
    let mut new_program = program.clone();
    let new_code = modify_ast_for_sketch(&ctx.engine, &mut new_program, name, PlaneType::XY, sketch_id)
        .await
        .unwrap();

    // Make sure the code is the same.
    assert_eq!(code, new_code);
    // Make sure the program is the same.
    assert_eq!(new_program, program);
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_modify_line_to_close_sketch() {
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

    let (ctx, program, sketch_id) = setup(&code, name).await.unwrap();
    let mut new_program = program.clone();
    let new_code = modify_ast_for_sketch(&ctx.engine, &mut new_program, name, PlaneType::XY, sketch_id)
        .await
        .unwrap();

    // Make sure the code is the same.
    assert_eq!(
        new_code,
        format!(
            r#"{} = startSketchOn("XY")
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
async fn kcl_test_modify_with_constraint() {
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

    let (ctx, program, sketch_id) = setup(&code, name).await.unwrap();
    let mut new_program = program.clone();
    let result = modify_ast_for_sketch(&ctx.engine, &mut new_program, name, PlaneType::XY, sketch_id).await;

    assert!(result.is_err());
    assert_eq!(
        result.unwrap_err().to_string(),
        r#"engine: KclErrorDetails { source_ranges: [SourceRange([188, 193])], message: "Sketch part002 is constrained `partial` and cannot be modified" }"#
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_modify_line_should_close_sketch() {
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

    let (ctx, program, sketch_id) = setup(&code, name).await.unwrap();
    let mut new_program = program.clone();
    let new_code = modify_ast_for_sketch(&ctx.engine, &mut new_program, name, PlaneType::XY, sketch_id)
        .await
        .unwrap();

    // Make sure the code is the same.
    assert_eq!(
        new_code,
        format!(
            r#"{} = startSketchOn("XY")
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
