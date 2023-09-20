use anyhow::Result;
use kcl_lib::engine::EngineManager;

/// Executes a kcl program and takes a snapshot of the result.
/// This returns the bytes of the snapshot.
async fn execute_and_snapshot(code: &str) -> Result<image::DynamicImage> {
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
    let engine = kcl_lib::engine::EngineConnection::new(ws).await?;
    let _ = kcl_lib::executor::execute(program, &mut mem, kcl_lib::executor::BodyType::Root, &engine).await?;

    // Send a snapshot request to the engine.
    let resp = engine
        .send_modeling_cmd(
            uuid::Uuid::new_v4(),
            kcl_lib::executor::SourceRange::default(),
            kittycad::types::ModelingCmd::TakeSnapshot {
                format: kittycad::types::ImageFormat::Png,
            },
        )
        .await?;

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

#[tokio::test(flavor = "multi_thread")]
async fn serial_test_execute_with_function_sketch() {
    let code = r#"fn box = (h, l, w) => {
 const myBox = startSketchAt([0,0])
    |> line([0, l], %)
    |> line([w, 0], %)
    |> line([0, -l], %)
    |> close(%)
    |> extrude(h, %)

  return myBox
}

const fnBox = box(3, 6, 10)

show(fnBox)"#;

    let result = execute_and_snapshot(code).await.unwrap();
    twenty_twenty::assert_image("tests/executor/outputs/function_sketch.png", &result, 1.0);
}

#[tokio::test(flavor = "multi_thread")]
async fn serial_test_execute_with_function_sketch_with_position() {
    let code = r#"fn box = (p, h, l, w) => {
 const myBox = startSketchAt(p)
    |> line([0, l], %)
    |> line([w, 0], %)
    |> line([0, -l], %)
    |> close(%)
    |> extrude(h, %)

  return myBox
}

show(box([0,0], 3, 6, 10))"#;

    let result = execute_and_snapshot(code).await.unwrap();
    twenty_twenty::assert_image("tests/executor/outputs/function_sketch_with_position.png", &result, 1.0);
}

#[tokio::test(flavor = "multi_thread")]
async fn serial_test_execute_with_angled_line() {
    let code = r#"const part001 = startSketchAt([4.83, 12.56])
  |> line([15.1, 2.48], %)
  |> line({ to: [3.15, -9.85], tag: 'seg01' }, %)
  |> line([-15.17, -4.1], %)
  |> angledLine([segAng('seg01', %), 12.35], %)
  |> line([-13.02, 10.03], %)
  |> close(%)
  |> extrude(4, %)

show(part001)"#;

    let result = execute_and_snapshot(code).await.unwrap();
    twenty_twenty::assert_image("tests/executor/outputs/angled_line.png", &result, 1.0);
}

#[tokio::test(flavor = "multi_thread")]
async fn serial_test_execute_parametric_example() {
    let code = r#"const sigmaAllow = 35000 // psi
const width = 9 // inch
const p = 150 // Force on shelf - lbs
const distance = 6 // inches
const FOS = 2

const leg1 = 5 // inches
const leg2 = 8 // inches
const thickness = sqrt(distance * p * FOS * 6 / sigmaAllow / width) // inches
const bracket = startSketchAt([0, 0])
  |> line([0, leg1], %)
  |> line([leg2, 0], %)
  |> line([0, -thickness], %)
  |> line([-leg2 + thickness, 0], %)
  |> line([0, -leg1 + thickness], %)
  |> close(%)
  |> extrude(width, %)

show(bracket)"#;

    let result = execute_and_snapshot(code).await.unwrap();
    twenty_twenty::assert_image("tests/executor/outputs/parametric.png", &result, 1.0);
}

#[tokio::test(flavor = "multi_thread")]
async fn serial_test_execute_engine_error_return() {
    let code = r#"const part001 = startSketchAt([5.5229, 5.25217])
  |> line([10.50433, -1.19122], %)
  |> line([8.01362, -5.48731], %)
  |> line([-1.02877, -6.76825], %)
  |> line([-11.53311, 2.81559], %)
  |> extrude(4, %)
"#;

    let result = execute_and_snapshot(code).await;
    assert!(result.is_err());
    assert_eq!(
        result.err().unwrap().to_string(),
        r#"engine: KclErrorDetails { source_ranges: [SourceRange([193, 206])], message: "Modeling command failed: Some([ApiError { error_code: BadRequest, message: \"The path is not closed.  Solid2D construction requires a closed path!\" }])" }"#,
    );
}

#[tokio::test(flavor = "multi_thread")]
#[ignore] // ignore until more stack fixes
async fn serial_test_execute_pipes_on_pipes() {
    let code = include_str!("inputs/pipes_on_pipes.kcl");

    let result = execute_and_snapshot(code).await.unwrap();
    twenty_twenty::assert_image("tests/executor/outputs/pipes_on_pipes.png", &result, 1.0);
}

#[tokio::test(flavor = "multi_thread")]
async fn test_member_expression_sketch_group() {
    let code = r#"fn cube = (pos, scale) => {
  const sg = startSketchAt(pos)
    |> line([0, scale], %)
    |> line([scale, 0], %)
    |> line([0, -scale], %)

  return sg
}

const b1 = cube([0,0], 10)
const b2 = cube([3,3], 4)

const pt1 = b1.value[0]
const pt2 = b2.value[0]

show(b1)
show(b2)"#;

    let result = execute_and_snapshot(code).await.unwrap();
    twenty_twenty::assert_image(
        "tests/executor/outputs/member_expression_sketch_group.png",
        &result,
        1.0,
    );
}
