use anyhow::Result;
use kcl_lib::executor::ExecutorSettings;

/// Executes a kcl program and takes a snapshot of the result.
/// This returns the bytes of the snapshot.
async fn execute_and_snapshot(code: &str, units: kcl_lib::settings::types::UnitLength) -> Result<image::DynamicImage> {
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
        .connection_verbose(true)
        .tcp_keepalive(std::time::Duration::from_secs(600))
        .http1_only();

    let token = std::env::var("KITTYCAD_API_TOKEN").expect("KITTYCAD_API_TOKEN not set");

    // Create the client.
    let mut client = kittycad::Client::new_from_reqwest(token, http_client, ws_client);
    // Set a local engine address if it's set.
    if let Ok(addr) = std::env::var("LOCAL_ENGINE_ADDR") {
        client.set_base_url(addr);
    }

    // Create a temporary file to write the output to.
    let output_file = std::env::temp_dir().join(format!("kcl_output_{}.png", uuid::Uuid::new_v4()));

    let tokens = kcl_lib::token::lexer(code)?;
    let parser = kcl_lib::parser::Parser::new(tokens);
    let program = parser.ast()?;
    let ctx = kcl_lib::executor::ExecutorContext::new(
        &client,
        ExecutorSettings {
            units,
            highlight_edges: true,
            enable_ssao: false,
        },
    )
    .await?;

    let _ = ctx.run(program, None).await?;

    // Zoom to fit.
    ctx.engine
        .send_modeling_cmd(
            uuid::Uuid::new_v4(),
            kcl_lib::executor::SourceRange::default(),
            kittycad::types::ModelingCmd::ZoomToFit {
                object_ids: Default::default(),
                padding: 0.1,
            },
        )
        .await?;

    // Send a snapshot request to the engine.
    let resp = ctx
        .engine
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
async fn serial_test_sketch_on_face() {
    let code = r#"const part001 = startSketchOn('XY')
  |> startProfileAt([11.19, 28.35], %)
  |> line([28.67, -13.25], %, "here")
  |> line([-4.12, -22.81], %)
  |> line([-33.24, 14.55], %)
  |> close(%)
  |> extrude(5, %)

const part002 = startSketchOn(part001, "here")
  |> startProfileAt([0, 0], %)
  |> line([0, 10], %)
  |> line([10, 0], %)
  |> line([0, -10], %)
  |> close(%)
  |> extrude(5, %)
"#;

    let result = execute_and_snapshot(code, kcl_lib::settings::types::UnitLength::Mm)
        .await
        .unwrap();
    twenty_twenty::assert_image("tests/executor/outputs/sketch_on_face.png", &result, 0.999);
}

#[tokio::test(flavor = "multi_thread")]
async fn serial_test_riddle_small() {
    let code = include_str!("inputs/riddle_small.kcl");
    let result = execute_and_snapshot(code, kcl_lib::settings::types::UnitLength::Mm)
        .await
        .unwrap();
    twenty_twenty::assert_image("tests/executor/outputs/riddle_small.png", &result, 0.999);
}

#[tokio::test(flavor = "multi_thread")]
async fn serial_test_lego() {
    let code = include_str!("inputs/lego.kcl");
    let result = execute_and_snapshot(code, kcl_lib::settings::types::UnitLength::Mm)
        .await
        .unwrap();
    twenty_twenty::assert_image("tests/executor/outputs/lego.png", &result, 0.999);
}

#[tokio::test(flavor = "multi_thread")]
async fn serial_test_pentagon_fillet_desugar() {
    let code = include_str!("inputs/pentagon_fillet_desugar.kcl");
    let result = execute_and_snapshot(code, kcl_lib::settings::types::UnitLength::Cm)
        .await
        .unwrap();
    twenty_twenty::assert_image("tests/executor/outputs/pentagon_fillet_desugar.png", &result, 0.999);
}

#[tokio::test(flavor = "multi_thread")]
async fn serial_test_pentagon_fillet_sugar() {
    let code = include_str!("inputs/pentagon_fillet_sugar.kcl");
    let result = execute_and_snapshot(code, kcl_lib::settings::types::UnitLength::Cm)
        .await
        .unwrap();
    twenty_twenty::assert_image("tests/executor/outputs/pentagon_fillet_sugar.png", &result, 0.999);
}

#[tokio::test(flavor = "multi_thread")]
async fn serial_test_sketch_on_face_start() {
    let code = r#"fn cube = (pos, scale) => {
  const sg = startSketchOn('XY')
    |> startProfileAt(pos, %)
    |> line([0, scale], %)
    |> line([scale, 0], %)
    |> line([0, -scale], %)

  return sg
}
const part001 = cube([0,0], 20)
    |> close(%)
    |> extrude(20, %)

const part002 = startSketchOn(part001, "start")
  |> startProfileAt([0, 0], %)
  |> line([0, 10], %)
  |> line([10, 0], %)
  |> line([0, -10], %)
  |> close(%)
  |> extrude(5, %)
"#;

    let result = execute_and_snapshot(code, kcl_lib::settings::types::UnitLength::Mm)
        .await
        .unwrap();
    twenty_twenty::assert_image("tests/executor/outputs/sketch_on_face_start.png", &result, 0.999);
}

#[tokio::test(flavor = "multi_thread")]
async fn serial_test_mike_stress_lines() {
    let code = include_str!("inputs/mike_stress_test.kcl");
    let result = execute_and_snapshot(code, kcl_lib::settings::types::UnitLength::Mm)
        .await
        .unwrap();
    twenty_twenty::assert_image("tests/executor/outputs/mike_stress_test.png", &result, 0.999);
}

#[tokio::test(flavor = "multi_thread")]
async fn serial_test_sketch_on_face_end() {
    let code = r#"fn cube = (pos, scale) => {
  const sg = startSketchOn('XY')
    |> startProfileAt(pos, %)
    |> line([0, scale], %)
    |> line([scale, 0], %)
    |> line([0, -scale], %)

  return sg
}
const part001 = cube([0,0], 20)
    |> close(%)
    |> extrude(20, %)

const part002 = startSketchOn(part001, "END")
  |> startProfileAt([0, 0], %)
  |> line([0, 10], %)
  |> line([10, 0], %)
  |> line([0, -10], %)
  |> close(%)
  |> extrude(5, %)
"#;

    let result = execute_and_snapshot(code, kcl_lib::settings::types::UnitLength::Mm)
        .await
        .unwrap();
    twenty_twenty::assert_image("tests/executor/outputs/sketch_on_face_end.png", &result, 0.999);
}

#[tokio::test(flavor = "multi_thread")]
async fn serial_test_sketch_on_face_end_negative_extrude() {
    let code = r#"fn cube = (pos, scale) => {
  const sg = startSketchOn('XY')
    |> startProfileAt(pos, %)
    |> line([0, scale], %)
    |> line([scale, 0], %)
    |> line([0, -scale], %)

  return sg
}
const part001 = cube([0,0], 20)
    |> close(%)
    |> extrude(20, %)

const part002 = startSketchOn(part001, "END")
  |> startProfileAt([0, 0], %)
  |> line([0, 10], %)
  |> line([10, 0], %)
  |> line([0, -10], %)
  |> close(%)
  |> extrude(-5, %)
"#;

    let result = execute_and_snapshot(code, kcl_lib::settings::types::UnitLength::Mm)
        .await
        .unwrap();
    twenty_twenty::assert_image(
        "tests/executor/outputs/sketch_on_face_end_negative_extrude.png",
        &result,
        0.999,
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn serial_test_fillet_duplicate_tags() {
    let code = r#"const part001 = startSketchOn('XY')
    |> startProfileAt([0,0], %)
    |> line([0, 10], %, "thing")
    |> line([10, 0], %)
    |> line([0, -10], %, "thing2")
    |> close(%)
    |> extrude(10, %)
    |> fillet({radius: 0.5, tags: ["thing", "thing"]}, %)
"#;

    let result = execute_and_snapshot(code, kcl_lib::settings::types::UnitLength::Mm).await;
    assert!(result.is_err());
    assert_eq!(
        result.err().unwrap().to_string(),
        r#"type: KclErrorDetails { source_ranges: [SourceRange([205, 255])], message: "Duplicate tags are not allowed." }"#,
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn serial_test_basic_fillet_cube_start() {
    let code = r#"const part001 = startSketchOn('XY')
    |> startProfileAt([0,0], %)
    |> line([0, 10], %, "thing")
    |> line([10, 0], %)
    |> line([0, -10], %, "thing2")
    |> close(%)
    |> extrude(10, %)
    |> fillet({radius: 2, tags: ["thing", "thing2"]}, %)
"#;

    let result = execute_and_snapshot(code, kcl_lib::settings::types::UnitLength::Mm)
        .await
        .unwrap();
    twenty_twenty::assert_image("tests/executor/outputs/basic_fillet_cube_start.png", &result, 0.999);
}

#[tokio::test(flavor = "multi_thread")]
async fn serial_test_basic_fillet_cube_end() {
    let code = r#"const part001 = startSketchOn('XY')
    |> startProfileAt([0,0], %)
    |> line([0, 10], %, "thing")
    |> line([10, 0], %)
    |> line([0, -10], %, "thing2")
    |> close(%)
    |> extrude(10, %)
    |> fillet({radius: 2, tags: ["thing", getOppositeEdge("thing", %)]}, %)

"#;

    let result = execute_and_snapshot(code, kcl_lib::settings::types::UnitLength::Mm)
        .await
        .unwrap();
    twenty_twenty::assert_image("tests/executor/outputs/basic_fillet_cube_end.png", &result, 0.999);
}

#[tokio::test(flavor = "multi_thread")]
async fn serial_test_basic_fillet_cube_close_opposite() {
    let code = r#"const part001 = startSketchOn('XY')
    |> startProfileAt([0,0], %)
    |> line([0, 10], %, "thing")
    |> line([10, 0], %)
    |> line([0, -10], %, "thing2")
    |> close(%, "thing3")
    |> extrude(10, %)
    |> fillet({radius: 2, tags: ["thing3", getOppositeEdge("thing3", %)]}, %)

"#;

    let result = execute_and_snapshot(code, kcl_lib::settings::types::UnitLength::Mm)
        .await
        .unwrap();
    twenty_twenty::assert_image(
        "tests/executor/outputs/basic_fillet_cube_close_opposite.png",
        &result,
        0.999,
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn serial_test_basic_fillet_cube_next_adjacent() {
    let code = r#"const part001 = startSketchOn('XY')
    |> startProfileAt([0,0], %)
    |> line([0, 10], %, "thing")
    |> line([10, 0], %, "thing1")
    |> line([0, -10], %, "thing2")
    |> close(%, "thing3")
    |> extrude(10, %)
    |> fillet({radius: 2, tags: [getNextAdjacentEdge("thing3", %)]}, %)
"#;

    let result = execute_and_snapshot(code, kcl_lib::settings::types::UnitLength::Mm)
        .await
        .unwrap();
    twenty_twenty::assert_image(
        "tests/executor/outputs/basic_fillet_cube_next_adjacent.png",
        &result,
        0.999,
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn serial_test_basic_fillet_cube_previous_adjacent() {
    let code = r#"const part001 = startSketchOn('XY')
    |> startProfileAt([0,0], %)
    |> line([0, 10], %, "thing")
    |> line([10, 0], %, "thing1")
    |> line([0, -10], %, "thing2")
    |> close(%, "thing3")
    |> extrude(10, %)
    |> fillet({radius: 2, tags: [getPreviousAdjacentEdge("thing3", %)]}, %)
"#;

    let result = execute_and_snapshot(code, kcl_lib::settings::types::UnitLength::Mm)
        .await
        .unwrap();
    twenty_twenty::assert_image(
        "tests/executor/outputs/basic_fillet_cube_previous_adjacent.png",
        &result,
        0.999,
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn serial_test_execute_with_function_sketch() {
    let code = r#"fn box = (h, l, w) => {
 const myBox = startSketchOn('XY')
    |> startProfileAt([0,0], %)
    |> line([0, l], %)
    |> line([w, 0], %)
    |> line([0, -l], %)
    |> close(%)
    |> extrude(h, %)

  return myBox
}

const fnBox = box(3, 6, 10)
"#;

    let result = execute_and_snapshot(code, kcl_lib::settings::types::UnitLength::Mm)
        .await
        .unwrap();
    twenty_twenty::assert_image("tests/executor/outputs/function_sketch.png", &result, 0.999);
}

#[tokio::test(flavor = "multi_thread")]
async fn serial_test_execute_with_function_sketch_with_position() {
    let code = r#"fn box = (p, h, l, w) => {
 const myBox = startSketchOn('XY')
    |> startProfileAt(p, %)
    |> line([0, l], %)
    |> line([w, 0], %)
    |> line([0, -l], %)
    |> close(%)
    |> extrude(h, %)

  return myBox
}

const thing = box([0,0], 3, 6, 10)"#;

    let result = execute_and_snapshot(code, kcl_lib::settings::types::UnitLength::Mm)
        .await
        .unwrap();
    twenty_twenty::assert_image(
        "tests/executor/outputs/function_sketch_with_position.png",
        &result,
        0.999,
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn serial_test_execute_with_angled_line() {
    let code = r#"const part001 = startSketchOn('XY')
  |> startProfileAt([4.83, 12.56], %)
  |> line([15.1, 2.48], %)
  |> line([3.15, -9.85], %, 'seg01')
  |> line([-15.17, -4.1], %)
  |> angledLine([segAng('seg01', %), 12.35], %)
  |> line([-13.02, 10.03], %)
  |> close(%)
  |> extrude(4, %)
"#;

    let result = execute_and_snapshot(code, kcl_lib::settings::types::UnitLength::Mm)
        .await
        .unwrap();
    twenty_twenty::assert_image("tests/executor/outputs/angled_line.png", &result, 0.999);
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
const bracket = startSketchOn('XY')
  |> startProfileAt([0, 0], %)
  |> line([0, leg1], %)
  |> line([leg2, 0], %)
  |> line([0, -thickness], %)
  |> line([-leg2 + thickness, 0], %)
  |> line([0, -leg1 + thickness], %)
  |> close(%)
  |> extrude(width, %)
"#;

    let result = execute_and_snapshot(code, kcl_lib::settings::types::UnitLength::Mm)
        .await
        .unwrap();
    twenty_twenty::assert_image("tests/executor/outputs/parametric.png", &result, 0.999);
}

#[tokio::test(flavor = "multi_thread")]
async fn serial_test_execute_parametric_with_tan_arc_example() {
    let code = r#"const sigmaAllow = 15000 // psi
const width = 11 // inch
const p = 150 // Force on shelf - lbs
const distance = 12 // inches
const FOS = 2
const thickness = sqrt(distance * p * FOS * 6 / ( sigmaAllow * width ))
const filletR = thickness * 2
const shelfMountL = 9
const wallMountL = 8

const bracket = startSketchAt([0, 0])
  |> line([0, wallMountL], %)
  |> tangentialArc({
    radius: filletR,
    offset: 90
  }, %)
  |> line([-shelfMountL, 0], %)
  |> line([0, -thickness], %)
  |> line([shelfMountL, 0], %)
  |> tangentialArc({
    radius: filletR - thickness,
    offset: -90
  }, %)
  |> line([0, -wallMountL], %)
  |> close(%)
  |> extrude(width, %)
"#;

    let result = execute_and_snapshot(code, kcl_lib::settings::types::UnitLength::Mm)
        .await
        .unwrap();
    twenty_twenty::assert_image("tests/executor/outputs/parametric_with_tan_arc.png", &result, 0.999);
}

#[tokio::test(flavor = "multi_thread")]
async fn serial_test_execute_engine_error_return() {
    let code = r#"const part001 = startSketchOn('XY')
  |> startProfileAt([5.5229, 5.25217], %)
  |> line([10.50433, -1.19122], %)
  |> line([8.01362, -5.48731], %)
  |> line([-1.02877, -6.76825], %)
  |> line([-11.53311, 2.81559], %)
  |> extrude(4, %)
"#;

    let result = execute_and_snapshot(code, kcl_lib::settings::types::UnitLength::Mm).await;
    assert!(result.is_err());
    assert_eq!(
        result.err().unwrap().to_string(),
        r#"engine: KclErrorDetails { source_ranges: [SourceRange([222, 235])], message: "Modeling command failed: Some([ApiError { error_code: BadRequest, message: \"The path is not closed.  Solid2D construction requires a closed path!\" }])" }"#,
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn serial_test_execute_i_shape() {
    // This is some code from lee that starts a pipe expression with a variable.
    let code = include_str!("inputs/i_shape.kcl");

    let result = execute_and_snapshot(code, kcl_lib::settings::types::UnitLength::Mm)
        .await
        .unwrap();
    twenty_twenty::assert_image("tests/executor/outputs/i_shape.png", &result, 0.999);
}

#[tokio::test(flavor = "multi_thread")]
#[ignore] // No longer a stack overflow problem, instead it causes an engine internal error.
async fn serial_test_execute_pipes_on_pipes() {
    let code = include_str!("inputs/pipes_on_pipes.kcl");

    let result = execute_and_snapshot(code, kcl_lib::settings::types::UnitLength::Mm)
        .await
        .unwrap();
    twenty_twenty::assert_image("tests/executor/outputs/pipes_on_pipes.png", &result, 0.999);
}

#[tokio::test(flavor = "multi_thread")]
async fn serial_test_execute_cylinder() {
    let code = include_str!("inputs/cylinder.kcl");

    let result = execute_and_snapshot(code, kcl_lib::settings::types::UnitLength::Mm)
        .await
        .unwrap();
    twenty_twenty::assert_image("tests/executor/outputs/cylinder.png", &result, 0.999);
}

#[tokio::test(flavor = "multi_thread")]
async fn serial_test_execute_kittycad_svg() {
    let code = include_str!("inputs/kittycad_svg.kcl");

    let result = execute_and_snapshot(code, kcl_lib::settings::types::UnitLength::Mm)
        .await
        .unwrap();
    twenty_twenty::assert_image("tests/executor/outputs/kittycad_svg.png", &result, 0.999);
}

#[tokio::test(flavor = "multi_thread")]
async fn serial_test_member_expression_sketch_group() {
    let code = r#"fn cube = (pos, scale) => {
  const sg = startSketchOn('XY')
    |> startProfileAt(pos, %)
    |> line([0, scale], %)
    |> line([scale, 0], %)
    |> line([0, -scale], %)

  return sg
}

const b1 = cube([0,0], 10)
const b2 = cube([3,3], 4)

const pt1 = b1.value[0]
const pt2 = b2.value[0]
"#;

    let result = execute_and_snapshot(code, kcl_lib::settings::types::UnitLength::Mm)
        .await
        .unwrap();
    twenty_twenty::assert_image(
        "tests/executor/outputs/member_expression_sketch_group.png",
        &result,
        1.0,
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn serial_test_helix_defaults() {
    let code = r#"const part001 = startSketchOn('XY')
     |> circle([5, 5], 10, %)
     |> extrude(10, %)
     |> helix({revolutions: 16, angle_start: 0}, %)
"#;

    let result = execute_and_snapshot(code, kcl_lib::settings::types::UnitLength::Mm)
        .await
        .unwrap();
    twenty_twenty::assert_image("tests/executor/outputs/helix_defaults.png", &result, 1.0);
}

#[tokio::test(flavor = "multi_thread")]
async fn serial_test_helix_defaults_negative_extrude() {
    let code = r#"const part001 = startSketchOn('XY')
     |> circle([5, 5], 10, %)
     |> extrude(-10, %)
     |> helix({revolutions: 16, angle_start: 0}, %)
"#;

    let result = execute_and_snapshot(code, kcl_lib::settings::types::UnitLength::Mm)
        .await
        .unwrap();
    twenty_twenty::assert_image(
        "tests/executor/outputs/helix_defaults_negative_extrude.png",
        &result,
        1.0,
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn serial_test_helix_ccw() {
    let code = r#"const part001 = startSketchOn('XY')
     |> circle([5, 5], 10, %)
     |> extrude(10, %)
     |> helix({revolutions: 16, angle_start: 0, ccw: true}, %)
"#;

    let result = execute_and_snapshot(code, kcl_lib::settings::types::UnitLength::Mm)
        .await
        .unwrap();
    twenty_twenty::assert_image("tests/executor/outputs/helix_ccw.png", &result, 1.0);
}

#[tokio::test(flavor = "multi_thread")]
async fn serial_test_helix_with_length() {
    let code = r#"const part001 = startSketchOn('XY')
     |> circle([5, 5], 10, %)
     |> extrude(10, %)
     |> helix({revolutions: 16, angle_start: 0, length: 3}, %)
"#;

    let result = execute_and_snapshot(code, kcl_lib::settings::types::UnitLength::Mm)
        .await
        .unwrap();
    twenty_twenty::assert_image("tests/executor/outputs/helix_with_length.png", &result, 1.0);
}

#[tokio::test(flavor = "multi_thread")]
async fn serial_test_dimensions_match() {
    let code = r#"const part001 = startSketchOn('XY')
  |> startProfileAt([-10, -10], %)
  |> line([20, 0], %)
  |> line([0, 20], %)
  |> line([-20, 0], %)
  |> close(%)
"#;

    let result = execute_and_snapshot(code, kcl_lib::settings::types::UnitLength::Mm)
        .await
        .unwrap();
    twenty_twenty::assert_image("tests/executor/outputs/dimensions_match.png", &result, 1.0);
}

#[tokio::test(flavor = "multi_thread")]
async fn serial_test_close_arc() {
    let code = r#"const center = [0,0]
const radius = 40
const height = 3

const body = startSketchOn('XY')
      |> startProfileAt([center[0]+radius, center[1]], %)
      |> arc({angle_end: 360, angle_start: 0, radius: radius}, %)
      |> close(%)
      |> extrude(height, %)
"#;

    let result = execute_and_snapshot(code, kcl_lib::settings::types::UnitLength::Mm)
        .await
        .unwrap();
    twenty_twenty::assert_image("tests/executor/outputs/close_arc.png", &result, 0.999);
}

#[tokio::test(flavor = "multi_thread")]
async fn serial_test_negative_args() {
    let code = r#"const width = 5
const height = 10
const length = 12

fn box = (sk1, sk2, scale) => {
  const boxSketch = startSketchOn('XY')
    |> startProfileAt([sk1, sk2], %)
    |> line([0, scale], %)
    |> line([scale, 0], %)
    |> line([0, -scale], %)
    |> close(%)
    |> extrude(scale, %)
  return boxSketch
}

box(0, 0, 5)
box(10, 23, 8)
let thing = box(-12, -15, 10)
box(-20, -5, 10)"#;

    let result = execute_and_snapshot(code, kcl_lib::settings::types::UnitLength::Mm)
        .await
        .unwrap();
    twenty_twenty::assert_image("tests/executor/outputs/negative_args.png", &result, 0.999);
}

#[tokio::test(flavor = "multi_thread")]
async fn serial_test_basic_tangential_arc() {
    let code = r#"const boxSketch = startSketchAt([0, 0])
    |> line([0, 10], %)
    |> tangentialArc({radius: 5, offset: 90}, %)
    |> line([5, -15], %)
    |> extrude(10, %)
"#;

    let result = execute_and_snapshot(code, kcl_lib::settings::types::UnitLength::Mm)
        .await
        .unwrap();
    twenty_twenty::assert_image("tests/executor/outputs/tangential_arc.png", &result, 0.999);
}

#[tokio::test(flavor = "multi_thread")]
async fn serial_test_basic_tangential_arc_with_point() {
    let code = r#"const boxSketch = startSketchAt([0, 0])
    |> line([0, 10], %)
    |> tangentialArc([-5, 5], %)
    |> line([5, -15], %)
    |> extrude(10, %)
"#;

    let result = execute_and_snapshot(code, kcl_lib::settings::types::UnitLength::Mm)
        .await
        .unwrap();
    twenty_twenty::assert_image("tests/executor/outputs/tangential_arc_with_point.png", &result, 0.999);
}

#[tokio::test(flavor = "multi_thread")]
async fn serial_test_basic_tangential_arc_to() {
    let code = r#"const boxSketch = startSketchAt([0, 0])
    |> line([0, 10], %)
    |> tangentialArcTo([-5, 15], %)
    |> line([5, -15], %)
    |> extrude(10, %)
"#;

    let result = execute_and_snapshot(code, kcl_lib::settings::types::UnitLength::Mm)
        .await
        .unwrap();
    twenty_twenty::assert_image("tests/executor/outputs/tangential_arc_to.png", &result, 0.999);
}

#[tokio::test(flavor = "multi_thread")]
async fn serial_test_different_planes_same_drawing() {
    let code = r#"const width = 5
const height = 10
const length = 12

fn box = (sk1, sk2, scale, plane) => {
  const boxsketch = startSketchOn(plane)
    |> startProfileAt([sk1, sk2], %)
    |> line([0, scale], %)
    |> line([scale, 0], %)
    |> line([0, -scale], %)
    |> close(%)
    |> extrude(scale, %)
  return boxsketch
}

box(0, 0, 5, 'xy')
box(10, 23, 8, 'xz')
box(30, 43, 18, '-xy')
let thing = box(-12, -15, 10, 'yz')
box(-20, -5, 10, 'xy')"#;

    let result = execute_and_snapshot(code, kcl_lib::settings::types::UnitLength::Mm)
        .await
        .unwrap();
    twenty_twenty::assert_image(
        "tests/executor/outputs/different_planes_same_drawing.png",
        &result,
        0.999,
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn serial_test_lots_of_planes() {
    let code = r#"const sigmaAllow = 15000 // psi
const width = 11 // inch
const p = 150 // Force on shelf - lbs
const distance = 12 // inches
const FOS = 2
const thickness = sqrt(distance * p * FOS * 6 / (sigmaAllow * width))
const filletR = thickness * 2
const shelfMountL = 9
const wallMountL = 8

const bracket = startSketchOn('XY')
  |> startProfileAt([0, 0], %)
  |> line([0, wallMountL], %)
  |> tangentialArc({ radius: filletR, offset: 90 }, %)
  |> line([-shelfMountL, 0], %)
  |> line([0, -thickness], %)
  |> line([shelfMountL, 0], %)
  |> tangentialArc({
       radius: filletR - thickness,
       offset: -90
     }, %)
  |> line([0, -wallMountL], %)
  |> close(%)
  |> extrude(width, %)

const part001 = startSketchOn('XY')
  |> startProfileAt([-15.53, -10.28], %)
  |> line([10.49, -2.08], %)
  |> line([10.42, 8.47], %)
  |> line([-19.16, 5.1], %)
  |> close(%)
  |> extrude(4, %)

const part002 = startSketchOn('-XZ')
  |> startProfileAt([-9.35, 19.18], %)
  |> line([32.14, -2.47], %)
  |> line([8.39, -3.73], %)
  |> close(%)

const part003 = startSketchOn('-XZ')
  |> startProfileAt([13.82, 16.51], %)
  |> line([-6.24, -30.82], %)
  |> line([8.39, -3.73], %)
  |> close(%)

const part004 = startSketchOn('YZ')
  |> startProfileAt([19.04, 20.22], %)
  |> line([9.44, -30.16], %)
  |> line([8.39, -3.73], %)
  |> close(%)
"#;

    let result = execute_and_snapshot(code, kcl_lib::settings::types::UnitLength::Mm)
        .await
        .unwrap();
    twenty_twenty::assert_image("tests/executor/outputs/lots_of_planes.png", &result, 0.999);
}

#[tokio::test(flavor = "multi_thread")]
async fn serial_test_holes() {
    let code = r#"const square = startSketchOn('XY')
  |> startProfileAt([0, 0], %)
  |> line([0, 10], %)
  |> line([10, 0], %)
  |> line([0, -10], %)
  |> close(%)
  |> hole(circle([2, 2], .5, %), %)
  |> hole(circle([2, 8], .5, %), %)
  |> extrude(2, %)
"#;

    let result = execute_and_snapshot(code, kcl_lib::settings::types::UnitLength::Mm)
        .await
        .unwrap();
    twenty_twenty::assert_image("tests/executor/outputs/holes.png", &result, 0.999);
}

#[tokio::test(flavor = "multi_thread")]
async fn optional_params() {
    let code = r#"
    fn other_circle = (pos, radius, tag?) => {
      const sg = startSketchOn('XY')
        |> startProfileAt(pos, %)
        |> arc({angle_end: 360, angle_start: 0, radius: radius}, %)
        |> close(%)

      return sg
  }

const thing = other_circle([2, 2], 20)
"#;
    let result = execute_and_snapshot(code, kcl_lib::settings::types::UnitLength::Mm)
        .await
        .unwrap();
    twenty_twenty::assert_image("tests/executor/outputs/optional_params.png", &result, 0.999);
}

#[tokio::test(flavor = "multi_thread")]
async fn serial_test_rounded_with_holes() {
    let code = r#"fn tarc = (to, sketchGroup, tag?) => {
  return tangentialArcTo(to, sketchGroup, tag)
}

fn roundedRectangle = (pos, w, l, cornerRadius) => {
  const rr = startSketchOn('XY')
    |> startProfileAt([pos[0] - w/2, 0], %)
    |> lineTo([pos[0] - w/2, pos[1] - l/2 + cornerRadius], %)
    |> tarc([pos[0] - w/2 + cornerRadius, pos[1] - l/2], %, "arc0")
    |> lineTo([pos[0] + w/2 - cornerRadius, pos[1] - l/2], %)
    |> tarc([pos[0] + w/2, pos[1] - l/2 + cornerRadius], %)
    |> lineTo([pos[0] + w/2, pos[1] + l/2 - cornerRadius], %)
    |> tarc([pos[0] + w/2 - cornerRadius, pos[1] + l/2], %, "arc2")
    |> lineTo([pos[0] - w/2 + cornerRadius, pos[1] + l/2], %)
    |> tarc([pos[0] - w/2, pos[1] + l/2 - cornerRadius], %)
    |> close(%)
  return rr
}

const holeRadius = 1
const holeIndex = 6

const part = roundedRectangle([0, 0], 20, 20, 4)
  |> hole(circle([-holeIndex, holeIndex], holeRadius, %), %)
  |> hole(circle([holeIndex, holeIndex], holeRadius, %), %)
  |> hole(circle([-holeIndex, -holeIndex], holeRadius, %), %)
  |> hole(circle([holeIndex, -holeIndex], holeRadius, %), %)
  |> extrude(2, %)
"#;

    let result = execute_and_snapshot(code, kcl_lib::settings::types::UnitLength::Mm)
        .await
        .unwrap();
    twenty_twenty::assert_image("tests/executor/outputs/rounded_with_holes.png", &result, 0.999);
}

#[tokio::test(flavor = "multi_thread")]
async fn serial_test_top_level_expression() {
    let code = r#"startSketchOn('XY') |> circle([0,0], 22, %) |> extrude(14, %)"#;

    let result = execute_and_snapshot(code, kcl_lib::settings::types::UnitLength::Mm)
        .await
        .unwrap();
    twenty_twenty::assert_image("tests/executor/outputs/top_level_expression.png", &result, 0.999);
}

#[tokio::test(flavor = "multi_thread")]
async fn serial_test_patterns_linear_basic_with_math() {
    let code = r#"const num = 12
const distance = 5
const part =  startSketchOn('XY')
    |> circle([0,0], 2, %)
    |> patternLinear2d({axis: [0,1], repetitions: num -1, distance: distance - 1}, %)
    |> extrude(1, %)
"#;

    let result = execute_and_snapshot(code, kcl_lib::settings::types::UnitLength::Mm)
        .await
        .unwrap();
    twenty_twenty::assert_image(
        "tests/executor/outputs/patterns_linear_basic_with_math.png",
        &result,
        0.999,
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn serial_test_patterns_linear_basic() {
    let code = r#"const part =  startSketchOn('XY')
    |> circle([0,0], 2, %)
    |> patternLinear2d({axis: [0,1], repetitions: 12, distance: 4}, %)
    |> extrude(1, %)
"#;

    let result = execute_and_snapshot(code, kcl_lib::settings::types::UnitLength::Mm)
        .await
        .unwrap();
    twenty_twenty::assert_image("tests/executor/outputs/patterns_linear_basic.png", &result, 0.999);
}

#[tokio::test(flavor = "multi_thread")]
async fn serial_test_patterns_linear_basic_3d() {
    let code = r#"const part = startSketchOn('XY')
    |> startProfileAt([0, 0], %)
    |> line([0,1], %)
    |> line([1, 0], %)
    |> line([0, -1], %)
    |> close(%)
    |> extrude(1, %)
    |> patternLinear3d({axis: [1, 0, 1], repetitions: 3, distance: 6}, %)
"#;

    let result = execute_and_snapshot(code, kcl_lib::settings::types::UnitLength::Mm)
        .await
        .unwrap();
    twenty_twenty::assert_image("tests/executor/outputs/patterns_linear_basic_3d.png", &result, 0.999);
}

#[tokio::test(flavor = "multi_thread")]
async fn serial_test_patterns_linear_basic_negative_distance() {
    let code = r#"const part = startSketchOn('XY')
    |> circle([0,0], 2, %)
    |> patternLinear2d({axis: [0,1], repetitions: 12, distance: -2}, %)
"#;

    let result = execute_and_snapshot(code, kcl_lib::settings::types::UnitLength::Mm)
        .await
        .unwrap();
    twenty_twenty::assert_image(
        "tests/executor/outputs/patterns_linear_basic_negative_distance.png",
        &result,
        0.999,
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn serial_test_patterns_linear_basic_negative_axis() {
    let code = r#"const part = startSketchOn('XY')
    |> circle([0,0], 2, %)
    |> patternLinear2d({axis: [0,-1], repetitions: 12, distance: 2}, %)
"#;

    let result = execute_and_snapshot(code, kcl_lib::settings::types::UnitLength::Mm)
        .await
        .unwrap();
    twenty_twenty::assert_image(
        "tests/executor/outputs/patterns_linear_basic_negative_axis.png",
        &result,
        0.999,
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn serial_test_patterns_linear_basic_holes() {
    let code = r#"const circles = startSketchOn('XY')
    |> circle([5, 5], 1, %)
    |> patternLinear2d({axis: [1,1], repetitions: 12, distance: 3}, %)

const rectangle = startSketchOn('XY')
  |> startProfileAt([0, 0], %)
  |> line([0, 50], %)
  |> line([50, 0], %)
  |> line([0, -50], %)
  |> close(%)
  |> hole(circles, %)

"#;

    let result = execute_and_snapshot(code, kcl_lib::settings::types::UnitLength::Mm)
        .await
        .unwrap();
    twenty_twenty::assert_image("tests/executor/outputs/patterns_linear_basic_holes.png", &result, 0.999);
}

#[tokio::test(flavor = "multi_thread")]
async fn serial_test_patterns_circular_basic_2d() {
    let code = r#"const part = startSketchOn('XY')
    |> circle([0,0], 2, %)
    |> patternCircular2d({center: [20, 20], repetitions: 12, arcDegrees: 210, rotateDuplicates: true}, %)
"#;

    let result = execute_and_snapshot(code, kcl_lib::settings::types::UnitLength::Mm)
        .await
        .unwrap();
    twenty_twenty::assert_image("tests/executor/outputs/patterns_circular_basic_2d.png", &result, 0.999);
}

#[tokio::test(flavor = "multi_thread")]
async fn serial_test_patterns_circular_basic_3d() {
    let code = r#"const part = startSketchOn('XY')
    |> startProfileAt([0, 0], %)
    |> line([0,1], %)
    |> line([1, 0], %)
    |> line([0, -1], %)
    |> close(%)
    |> extrude(1, %)
    |> patternCircular3d({axis: [0,0, 1], center: [-20, -20, -20], repetitions: 40, arcDegrees: 360, rotateDuplicates: false}, %)
"#;

    let result = execute_and_snapshot(code, kcl_lib::settings::types::UnitLength::Mm)
        .await
        .unwrap();
    twenty_twenty::assert_image("tests/executor/outputs/patterns_circular_basic_3d.png", &result, 0.999);
}

#[tokio::test(flavor = "multi_thread")]
async fn serial_test_patterns_circular_3d_tilted_axis() {
    let code = r#"const part = startSketchOn('XY')
    |> startProfileAt([0, 0], %)
    |> line([0,1], %)
    |> line([1, 0], %)
    |> line([0, -1], %)
    |> close(%)
    |> extrude(1, %)
    |> patternCircular3d({axis: [1,1,0], center: [10, 0, 10], repetitions: 10, arcDegrees: 360, rotateDuplicates: true}, %)
"#;

    let result = execute_and_snapshot(code, kcl_lib::settings::types::UnitLength::Mm)
        .await
        .unwrap();
    twenty_twenty::assert_image(
        "tests/executor/outputs/patterns_circular_3d_tilted_axis.png",
        &result,
        0.999,
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn serial_test_import_file_doesnt_exist() {
    let code = r#"const model = import("thing.obj")"#;

    let result = execute_and_snapshot(code, kcl_lib::settings::types::UnitLength::Mm).await;
    assert!(result.is_err());
    assert_eq!(
        result.err().unwrap().to_string(),
        r#"semantic: KclErrorDetails { source_ranges: [SourceRange([14, 33])], message: "File `thing.obj` does not exist." }"#
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn serial_test_import_obj_with_mtl() {
    let code = r#"const model = import("tests/executor/inputs/cube.obj")"#;

    let result = execute_and_snapshot(code, kcl_lib::settings::types::UnitLength::Mm)
        .await
        .unwrap();
    twenty_twenty::assert_image("tests/executor/outputs/import_obj_with_mtl.png", &result, 0.999);
}

#[tokio::test(flavor = "multi_thread")]
async fn serial_test_import_obj_with_mtl_units() {
    let code = r#"const model = import("tests/executor/inputs/cube.obj", {type: "obj", units: "m"})"#;

    let result = execute_and_snapshot(code, kcl_lib::settings::types::UnitLength::Mm)
        .await
        .unwrap();
    twenty_twenty::assert_image("tests/executor/outputs/import_obj_with_mtl_units.png", &result, 0.999);
}

#[tokio::test(flavor = "multi_thread")]
async fn serial_test_import_gltf_with_bin() {
    let code = r#"const model = import("tests/executor/inputs/cube.gltf")"#;

    let result = execute_and_snapshot(code, kcl_lib::settings::types::UnitLength::Mm)
        .await
        .unwrap();
    twenty_twenty::assert_image("tests/executor/outputs/import_gltf_with_bin.png", &result, 0.999);
}

#[tokio::test(flavor = "multi_thread")]
async fn serial_test_import_gltf_embedded() {
    let code = r#"const model = import("tests/executor/inputs/cube-embedded.gltf")"#;

    let result = execute_and_snapshot(code, kcl_lib::settings::types::UnitLength::Mm)
        .await
        .unwrap();
    twenty_twenty::assert_image("tests/executor/outputs/import_gltf_embedded.png", &result, 0.999);
}

#[tokio::test(flavor = "multi_thread")]
async fn serial_test_import_glb() {
    let code = r#"const model = import("tests/executor/inputs/cube.glb")"#;

    let result = execute_and_snapshot(code, kcl_lib::settings::types::UnitLength::Mm)
        .await
        .unwrap();
    twenty_twenty::assert_image("tests/executor/outputs/import_glb.png", &result, 0.999);
}

#[tokio::test(flavor = "multi_thread")]
async fn serial_test_import_glb_no_assign() {
    let code = r#"import("tests/executor/inputs/cube.glb")"#;

    let result = execute_and_snapshot(code, kcl_lib::settings::types::UnitLength::Mm)
        .await
        .unwrap();
    twenty_twenty::assert_image("tests/executor/outputs/import_glb_no_assign.png", &result, 0.999);
}

#[tokio::test(flavor = "multi_thread")]
async fn serial_test_import_ext_doesnt_match() {
    let code = r#"const model = import("tests/executor/inputs/cube.gltf", {type: "obj", units: "m"})"#;

    let result = execute_and_snapshot(code, kcl_lib::settings::types::UnitLength::Mm).await;
    assert!(result.is_err());
    assert_eq!(
        result.err().unwrap().to_string(),
        r#"semantic: KclErrorDetails { source_ranges: [SourceRange([14, 82])], message: "The given format does not match the file extension. Expected: `gltf`, Given: `obj`" }"#
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn serial_test_cube_mm() {
    let code = r#"fn cube = (pos, scale) => {
  const sg = startSketchOn('XY')
    |> startProfileAt(pos, %)
    |> line([0, scale], %)
    |> line([scale, 0], %)
    |> line([0, -scale], %)
    |> close(%)
    |> extrude(scale, %)

  return sg
}

const myCube = cube([0,0], 10)
"#;

    let result = execute_and_snapshot(code, kcl_lib::settings::types::UnitLength::Mm)
        .await
        .unwrap();
    twenty_twenty::assert_image("tests/executor/outputs/cube_mm.png", &result, 1.0);
}

#[tokio::test(flavor = "multi_thread")]
async fn serial_test_cube_cm() {
    let code = r#"fn cube = (pos, scale) => {
  const sg = startSketchOn('XY')
    |> startProfileAt(pos, %)
    |> line([0, scale], %)
    |> line([scale, 0], %)
    |> line([0, -scale], %)
    |> close(%)
    |> extrude(scale, %)

  return sg
}

const myCube = cube([0,0], 10)
"#;

    let result = execute_and_snapshot(code, kcl_lib::settings::types::UnitLength::Cm)
        .await
        .unwrap();
    twenty_twenty::assert_image("tests/executor/outputs/cube_cm.png", &result, 1.0);
}

#[tokio::test(flavor = "multi_thread")]
async fn serial_test_cube_m() {
    let code = r#"fn cube = (pos, scale) => {
  const sg = startSketchOn('XY')
    |> startProfileAt(pos, %)
    |> line([0, scale], %)
    |> line([scale, 0], %)
    |> line([0, -scale], %)
    |> close(%)
    |> extrude(scale, %)

  return sg
}

const myCube = cube([0,0], 10)
"#;

    let result = execute_and_snapshot(code, kcl_lib::settings::types::UnitLength::M)
        .await
        .unwrap();
    twenty_twenty::assert_image("tests/executor/outputs/cube_m.png", &result, 1.0);
}

#[tokio::test(flavor = "multi_thread")]
async fn serial_test_cube_in() {
    let code = r#"fn cube = (pos, scale) => {
  const sg = startSketchOn('XY')
    |> startProfileAt(pos, %)
    |> line([0, scale], %)
    |> line([scale, 0], %)
    |> line([0, -scale], %)
    |> close(%)
    |> extrude(scale, %)

  return sg
}

const myCube = cube([0,0], 10)
"#;

    let result = execute_and_snapshot(code, kcl_lib::settings::types::UnitLength::In)
        .await
        .unwrap();
    twenty_twenty::assert_image("tests/executor/outputs/cube_in.png", &result, 1.0);
}

#[tokio::test(flavor = "multi_thread")]
async fn serial_test_cube_ft() {
    let code = r#"fn cube = (pos, scale) => {
  const sg = startSketchOn('XY')
    |> startProfileAt(pos, %)
    |> line([0, scale], %)
    |> line([scale, 0], %)
    |> line([0, -scale], %)
    |> close(%)
    |> extrude(scale, %)

  return sg
}

const myCube = cube([0,0], 10)
"#;

    let result = execute_and_snapshot(code, kcl_lib::settings::types::UnitLength::Ft)
        .await
        .unwrap();
    twenty_twenty::assert_image("tests/executor/outputs/cube_ft.png", &result, 1.0);
}

#[tokio::test(flavor = "multi_thread")]
async fn serial_test_cube_yd() {
    let code = r#"fn cube = (pos, scale) => {
  const sg = startSketchOn('XY')
    |> startProfileAt(pos, %)
    |> line([0, scale], %)
    |> line([scale, 0], %)
    |> line([0, -scale], %)
    |> close(%)
    |> extrude(scale, %)

  return sg
}

const myCube = cube([0,0], 10)
"#;

    let result = execute_and_snapshot(code, kcl_lib::settings::types::UnitLength::Yd)
        .await
        .unwrap();
    twenty_twenty::assert_image("tests/executor/outputs/cube_yd.png", &result, 1.0);
}

#[tokio::test(flavor = "multi_thread")]
async fn serial_test_error_sketch_on_arc_face() {
    let code = r#"fn cube = (pos, scale) => {
  const sg = startSketchOn('XY')
  |> startProfileAt(pos, %)
  |> tangentialArc([0, scale], %, "here")
  |> line([scale, 0], %)
  |> line([0, -scale], %)

  return sg
}
const part001 = cube([0, 0], 20)
  |> close(%)
  |> extrude(20, %)

const part002 = startSketchOn(part001, "here")
  |> startProfileAt([0, 0], %)
  |> line([5, 0], %)
  |> line([5, 5], %)
  |> line([0, 5], %)
  |> close(%)
  |> extrude(1, %)
"#;

    let result = execute_and_snapshot(code, kcl_lib::settings::types::UnitLength::Mm).await;

    assert!(result.is_err());
    assert_eq!(
        result.err().unwrap().to_string(),
        r#"type: KclErrorDetails { source_ranges: [SourceRange([281, 311])], message: "Cannot sketch on a non-planar surface: `here`" }"#
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn serial_test_sketch_on_face_of_face() {
    let code = r#"fn cube = (pos, scale) => {
  const sg = startSketchOn('XY')
    |> startProfileAt(pos, %)
    |> line([0, scale], %)
    |> line([scale, 0], %)
    |> line([0, -scale], %)

  return sg
}
const part001 = cube([0,0], 20)
    |> close(%)
    |> extrude(20, %)

const part002 = startSketchOn(part001, "end")
  |> startProfileAt([0, 0], %)
  |> line([0, 10], %)
  |> line([10, 0], %)
  |> line([0, -10], %)
  |> close(%)
  |> extrude(5, %)

const part003 = startSketchOn(part002, "end")
  |> startProfileAt([0, 0], %)
  |> line([0, 5], %)
  |> line([5, 0], %)
  |> line([0, -5], %)
  |> close(%)
  |> extrude(5, %)
"#;

    let result = execute_and_snapshot(code, kcl_lib::settings::types::UnitLength::Mm)
        .await
        .unwrap();
    twenty_twenty::assert_image("tests/executor/outputs/sketch_on_face_of_face.png", &result, 1.0);
}

#[tokio::test(flavor = "multi_thread")]
async fn serial_test_stdlib_kcl_error_right_code_path() {
    let code = r#"const square = startSketchOn('XY')
  |> startProfileAt([0, 0], %)
  |> line([0, 10], %)
  |> line([10, 0], %)
  |> line([0, -10], %)
  |> close(%)
  |> hole(circle([2, 2], .5), %)
  |> hole(circle([2, 8], .5, %), %)
  |> extrude(2, %)
"#;

    let result = execute_and_snapshot(code, kcl_lib::settings::types::UnitLength::Mm).await;
    assert!(result.is_err());
    assert_eq!(
        result.err().unwrap().to_string(),
        r#"type: KclErrorDetails { source_ranges: [SourceRange([157, 175])], message: "Expected a SketchGroup or SketchSurface as the third argument, found `[UserVal(UserVal { value: Array [Number(2), Number(2)], meta: [Metadata { source_range: SourceRange([164, 170]) }] }), UserVal(UserVal { value: Number(0.5), meta: [Metadata { source_range: SourceRange([172, 174]) }] })]`" }"#
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn serial_test_sketch_on_face_circle() {
    let code = r#"fn cube = (pos, scale) => {
  const sg = startSketchOn('XY')
    |> startProfileAt(pos, %)
    |> line([0, scale], %)
    |> line([scale, 0], %)
    |> line([0, -scale], %)

  return sg
}
const part001 = cube([0,0], 20)
    |> close(%)
    |> extrude(20, %)

const part002 = startSketchOn(part001, "end")
  |> circle([0, 0], 5, %) 
  |> extrude(5, %)
"#;

    let result = execute_and_snapshot(code, kcl_lib::settings::types::UnitLength::Mm)
        .await
        .unwrap();
    twenty_twenty::assert_image("tests/executor/outputs/sketch_on_face_circle.png", &result, 1.0);
}

#[tokio::test(flavor = "multi_thread")]
async fn serial_test_sketch_on_face_circle_tagged() {
    let code = r#"fn cube = (pos, scale) => {
  const sg = startSketchOn('XY')
    |> startProfileAt(pos, %)
    |> line([0, scale], %)
    |> line([scale, 0], %)
    |> line([0, -scale], %)

  return sg
}
const part001 = cube([0,0], 20)
    |> close(%)
    |> extrude(20, %)

const part002 = startSketchOn(part001, "end")
  |> circle([0, 0], 5, %, "myCircle") 
  |> extrude(5, %)
"#;

    let result = execute_and_snapshot(code, kcl_lib::settings::types::UnitLength::Mm)
        .await
        .unwrap();
    twenty_twenty::assert_image("tests/executor/outputs/sketch_on_face_circle_tagged.png", &result, 1.0);
}

#[tokio::test(flavor = "multi_thread")]
async fn serial_test_stdlib_kcl_error_circle() {
    let code = r#"// Mounting Plate
// A flat piece of material, often metal or plastic, that serves as a support or base for attaching, securing, or mounting various types of equipment, devices, or components. 

// Create a function that defines the body width and length of the mounting plate. Tag the corners so they can be passed through the fillet function.
fn rectShape = (pos, w, l) => {
  const rr = startSketchOn('XY')
  |> startProfileAt([pos[0] - (w / 2), pos[1] - (l / 2)], %)
  |> lineTo([pos[0] + w / 2, pos[1] - (l / 2)], %, "edge1")
  |> lineTo([pos[0] + w / 2, pos[1] + l / 2], %, "edge2")
  |> lineTo([pos[0] - (w / 2), pos[1] + l / 2], %, "edge3")
  |> close(%, "edge4")
  return rr
}

// Define the hole radius and x, y location constants
const holeRadius = 1
const holeIndex = 6

// Create the mounting plate extrusion, holes, and fillets
const part = rectShape([0, 0], 20, 20)
  |> hole(circle('XY', [-holeIndex, holeIndex], holeRadius), %)
  |> hole(circle('XY', [holeIndex, holeIndex], holeRadius), %)
  |> hole(circle('XY', [-holeIndex, -holeIndex], holeRadius), %)
  |> hole(circle('XY', [holeIndex, -holeIndex], holeRadius), %)
  |> extrude(2, %)
  |> fillet({
       radius: 4,
       tags: [
          getNextAdjacentEdge("edge1", %),
          getNextAdjacentEdge("edge2", %),
          getNextAdjacentEdge("edge3", %),
          getNextAdjacentEdge("edge4", %)
       ]
     }, %)
"#;

    let result = execute_and_snapshot(code, kcl_lib::settings::types::UnitLength::Mm).await;
    assert!(result.is_err());
    assert_eq!(
        result.err().unwrap().to_string(),
        r#"type: KclErrorDetails { source_ranges: [SourceRange([891, 940])], message: "Expected a [number, number] as the first argument, found `[UserVal(UserVal { value: String(\"XY\"), meta: [Metadata { source_range: SourceRange([898, 902]) }] }), UserVal(UserVal { value: Array [Number(-6.0), Number(6)], meta: [Metadata { source_range: SourceRange([904, 927]) }] }), UserVal(UserVal { value: Number(1), meta: [Metadata { source_range: SourceRange([760, 761]) }] })]`" }"#
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn serial_test_big_number_angle_to_match_length_x() {
    let code = r#"const part001 = startSketchOn('XY')
  |> startProfileAt([0, 0], %)
  |> line([1, 3.82], %, 'seg01')
  |> angledLineToX([
       -angleToMatchLengthX('seg01', 3, %),
       3
     ], %)
  |> close(%)
  |> extrude(10, %)
"#;

    let result = execute_and_snapshot(code, kcl_lib::settings::types::UnitLength::Mm)
        .await
        .unwrap();
    twenty_twenty::assert_image(
        "tests/executor/outputs/big_number_angle_to_match_length_x.png",
        &result,
        1.0,
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn serial_test_big_number_angle_to_match_length_y() {
    let code = r#"const part001 = startSketchOn('XY')
  |> startProfileAt([0, 0], %)
  |> line([1, 3.82], %, 'seg01')
  |> angledLineToX([
       -angleToMatchLengthY('seg01', 3, %),
       3
     ], %)
  |> close(%)
  |> extrude(10, %)
"#;

    let result = execute_and_snapshot(code, kcl_lib::settings::types::UnitLength::Mm)
        .await
        .unwrap();
    twenty_twenty::assert_image(
        "tests/executor/outputs/big_number_angle_to_match_length_y.png",
        &result,
        1.0,
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn serial_test_simple_revolve() {
    let code = r#"const part001 = startSketchOn('XY')
     |> startProfileAt([4, 12], %)
     |> line([2, 0], %)
     |> line([0, -6], %)
     |> line([4, -6], %)
     |> line([0, -6], %)
     |> line([-3.75, -4.5], %)
     |> line([0, -5.5], %)
     |> line([-2, 0], %)
     |> close(%)
     |> revolve({axis: 'y'}, %)

"#;

    let result = execute_and_snapshot(code, kcl_lib::settings::types::UnitLength::Mm)
        .await
        .unwrap();
    twenty_twenty::assert_image("tests/executor/outputs/simple_revolve.png", &result, 1.0);
}

#[tokio::test(flavor = "multi_thread")]
async fn serial_test_simple_revolve_uppercase() {
    let code = r#"const part001 = startSketchOn('XY')
     |> startProfileAt([4, 12], %)
     |> line([2, 0], %)
     |> line([0, -6], %)
     |> line([4, -6], %)
     |> line([0, -6], %)
     |> line([-3.75, -4.5], %)
     |> line([0, -5.5], %)
     |> line([-2, 0], %)
     |> close(%)
     |> revolve({axis: 'Y'}, %)

"#;

    let result = execute_and_snapshot(code, kcl_lib::settings::types::UnitLength::Mm)
        .await
        .unwrap();
    twenty_twenty::assert_image("tests/executor/outputs/simple_revolve_uppercase.png", &result, 1.0);
}

#[tokio::test(flavor = "multi_thread")]
async fn serial_test_simple_revolve_negative() {
    let code = r#"const part001 = startSketchOn('XY')
     |> startProfileAt([4, 12], %)
     |> line([2, 0], %)
     |> line([0, -6], %)
     |> line([4, -6], %)
     |> line([0, -6], %)
     |> line([-3.75, -4.5], %)
     |> line([0, -5.5], %)
     |> line([-2, 0], %)
     |> close(%)
     |> revolve({axis: '-Y', angle: 180}, %)

"#;

    let result = execute_and_snapshot(code, kcl_lib::settings::types::UnitLength::Mm)
        .await
        .unwrap();
    twenty_twenty::assert_image("tests/executor/outputs/simple_revolve_negative.png", &result, 1.0);
}

#[tokio::test(flavor = "multi_thread")]
async fn serial_test_revolve_bad_angle_low() {
    let code = r#"const part001 = startSketchOn('XY')
     |> startProfileAt([4, 12], %)
     |> line([2, 0], %)
     |> line([0, -6], %)
     |> line([4, -6], %)
     |> line([0, -6], %)
     |> line([-3.75, -4.5], %)
     |> line([0, -5.5], %)
     |> line([-2, 0], %)
     |> close(%)
     |> revolve({axis: 'y', angle: -455}, %)

"#;

    let result = execute_and_snapshot(code, kcl_lib::settings::types::UnitLength::Mm).await;

    assert!(result.is_err());
    assert_eq!(
        result.err().unwrap().to_string(),
        r#"semantic: KclErrorDetails { source_ranges: [SourceRange([278, 314])], message: "Expected angle to be between -360 and 360, found `-455`" }"#
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn serial_test_revolve_bad_angle_high() {
    let code = r#"const part001 = startSketchOn('XY')
     |> startProfileAt([4, 12], %)
     |> line([2, 0], %)
     |> line([0, -6], %)
     |> line([4, -6], %)
     |> line([0, -6], %)
     |> line([-3.75, -4.5], %)
     |> line([0, -5.5], %)
     |> line([-2, 0], %)
     |> close(%)
     |> revolve({axis: 'y', angle: 455}, %)

"#;

    let result = execute_and_snapshot(code, kcl_lib::settings::types::UnitLength::Mm).await;

    assert!(result.is_err());
    assert_eq!(
        result.err().unwrap().to_string(),
        r#"semantic: KclErrorDetails { source_ranges: [SourceRange([278, 313])], message: "Expected angle to be between -360 and 360, found `455`" }"#
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn serial_test_simple_revolve_custom_angle() {
    let code = r#"const part001 = startSketchOn('XY')
     |> startProfileAt([4, 12], %)
     |> line([2, 0], %)
     |> line([0, -6], %)
     |> line([4, -6], %)
     |> line([0, -6], %)
     |> line([-3.75, -4.5], %)
     |> line([0, -5.5], %)
     |> line([-2, 0], %)
     |> close(%)
     |> revolve({axis: 'y', angle: 180}, %)

"#;

    let result = execute_and_snapshot(code, kcl_lib::settings::types::UnitLength::Mm)
        .await
        .unwrap();
    twenty_twenty::assert_image("tests/executor/outputs/simple_revolve_custom_angle.png", &result, 1.0);
}

#[tokio::test(flavor = "multi_thread")]
async fn serial_test_simple_revolve_custom_axis() {
    let code = r#"const part001 = startSketchOn('XY')
     |> startProfileAt([4, 12], %)
     |> line([2, 0], %)
     |> line([0, -6], %)
     |> line([4, -6], %)
     |> line([0, -6], %)
     |> line([-3.75, -4.5], %)
     |> line([0, -5.5], %)
     |> line([-2, 0], %)
     |> close(%)
     |> revolve({axis: {custom: {axis: [0, -1, 0], origin: [0,0,0]}}, angle: 180}, %)

"#;

    let result = execute_and_snapshot(code, kcl_lib::settings::types::UnitLength::Mm)
        .await
        .unwrap();
    twenty_twenty::assert_image("tests/executor/outputs/simple_revolve_custom_axis.png", &result, 1.0);
}

#[tokio::test(flavor = "multi_thread")]
async fn serial_test_revolve_on_edge() {
    let code = r#"const box = startSketchOn('XY')
  |> startProfileAt([0, 0], %)
  |> line([0, 10], %)
  |> line([10, 0], %)
  |> line([0, -10], %, 'revolveAxis')
  |> close(%)
  |> extrude(10, %)

const sketch001 = startSketchOn(box, "end")
  |> startProfileAt([5, 10], %)
  |> line([0, -10], %)
  |> line([2, 0], %)
  |> line([0, 10], %)
  |> close(%)
  |> revolve({ axis: getOppositeEdge('revolveAxis', box), angle: 90 }, %)

"#;

    let result = execute_and_snapshot(code, kcl_lib::settings::types::UnitLength::Mm)
        .await
        .unwrap();
    twenty_twenty::assert_image("tests/executor/outputs/revolve_on_edge.png", &result, 1.0);
}

#[tokio::test(flavor = "multi_thread")]
async fn serial_test_revolve_on_edge_get_edge() {
    let code = r#"const box = startSketchOn('XY')
  |> startProfileAt([0, 0], %)
  |> line([0, 10], %)
  |> line([10, 0], %)
  |> line([0, -10], %, 'revolveAxis')
  |> close(%)
  |> extrude(10, %)

const sketch001 = startSketchOn(box, "revolveAxis")
  |> startProfileAt([5, 10], %)
  |> line([0, -10], %)
  |> line([2, 0], %)
  |> line([0, 10], %)
  |> close(%)
  |> revolve({ axis: getEdge('revolveAxis', box), angle: 90 }, %)

"#;

    let result = execute_and_snapshot(code, kcl_lib::settings::types::UnitLength::Mm).await;

    assert!(result.is_err());
    assert_eq!(
        result.err().unwrap().to_string(),
        r#"engine: KclErrorDetails { source_ranges: [SourceRange([349, 409])], message: "Modeling command failed: Some([ApiError { error_code: InternalEngine, message: \"Solid3D revolve failed:  sketch profile must lie entirely on one side of the revolution axis\" }])" }"#
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn serial_test_revolve_on_face_circle_edge() {
    let code = r#"const box = startSketchOn('XY')
  |> startProfileAt([0, 0], %)
  |> line([0, 20], %)
  |> line([20, 0], %)
  |> line([0, -20], %, 'revolveAxis') 
  |> close(%)
  |> extrude(20, %)

const sketch001 = startSketchOn(box, "END")
  |> circle([10,10], 4, %)
  |> revolve({
    angle: 90, 
    axis: getOppositeEdge('revolveAxis', box) 
    }, %)
"#;

    let result = execute_and_snapshot(code, kcl_lib::settings::types::UnitLength::Mm)
        .await
        .unwrap();
    twenty_twenty::assert_image("tests/executor/outputs/revolve_on_face_circle_edge.png", &result, 1.0);
}

#[tokio::test(flavor = "multi_thread")]
async fn serial_test_revolve_on_face_circle() {
    let code = r#"const box = startSketchOn('XY')
  |> startProfileAt([0, 0], %)
  |> line([0, 20], %)
  |> line([20, 0], %, 'revolveAxis')
  |> line([0, -20], %) 
  |> close(%)
  |> extrude(20, %)

const sketch001 = startSketchOn(box, "END")
  |> circle([10,10], 4, %)
  |> revolve({
    angle: -90, 
    axis: 'y' 
    }, %)
"#;

    let result = execute_and_snapshot(code, kcl_lib::settings::types::UnitLength::Mm)
        .await
        .unwrap();
    twenty_twenty::assert_image("tests/executor/outputs/revolve_on_face_circle.png", &result, 1.0);
}

#[tokio::test(flavor = "multi_thread")]
async fn serial_test_revolve_on_face() {
    let code = r#"const box = startSketchOn('XY')
  |> startProfileAt([0, 0], %)
  |> line([0, 10], %)
  |> line([10, 0], %)
  |> line([0, -10], %)
  |> close(%, 'revolveAxis')
  |> extrude(10, %)

const sketch001 = startSketchOn(box, "end")
  |> startProfileAt([5, 10], %)
  |> line([0, -10], %)
  |> line([2, 0], %)
  |> line([0, 10], %)
  |> close(%)
  |> revolve({
      axis: 'y',
      angle: -90,
  }, %)
"#;

    let result = execute_and_snapshot(code, kcl_lib::settings::types::UnitLength::Mm)
        .await
        .unwrap();
    twenty_twenty::assert_image("tests/executor/outputs/revolve_on_face.png", &result, 1.0);
}

#[tokio::test(flavor = "multi_thread")]
async fn serial_test_basic_revolve_circle() {
    let code = r#"const sketch001 = startSketchOn('XY')
  |> circle([15, 0], 5, %)
  |> revolve({
    angle: 360, 
    axis: 'y' 
    }, %)
"#;

    let result = execute_and_snapshot(code, kcl_lib::settings::types::UnitLength::Mm)
        .await
        .unwrap();
    twenty_twenty::assert_image("tests/executor/outputs/basic_revolve_circle.png", &result, 1.0);
}

#[tokio::test(flavor = "multi_thread")]
async fn serial_test_simple_revolve_sketch_on_edge() {
    let code = r#"const part001 = startSketchOn('XY')
     |> startProfileAt([4, 12], %)
     |> line([2, 0], %)
     |> line([0, -6], %)
     |> line([4, -6], %)
     |> line([0, -6], %)
     |> line([-3.75, -4.5], %)
     |> line([0, -5.5], %)
     |> line([-2, 0], %)
     |> close(%)
     |> revolve({axis: 'y', angle: 180}, %)

const part002 = startSketchOn(part001, 'end')
    |> startProfileAt([4.5, -5], %)
    |> line([0, 5], %)
    |> line([5, 0], %)
    |> line([0, -5], %)
    |> close(%)
    |> extrude(5, %)
"#;

    let result = execute_and_snapshot(code, kcl_lib::settings::types::UnitLength::Mm)
        .await
        .unwrap();
    twenty_twenty::assert_image("tests/executor/outputs/simple_revolve_sketch_on_edge.png", &result, 1.0);
}

#[tokio::test(flavor = "multi_thread")]
async fn serial_test_plumbus_fillets() {
    let code = r#"fn make_circle = (face, tag, pos, radius) => {
  const sg = startSketchOn(face, tag)
  |> startProfileAt([pos[0] + radius, pos[1]], %)
  |> arc({
       angle_end: 360,
       angle_start: 0,
       radius: radius
     }, %, 'arc-' + tag)
  |> close(%)

  return sg
}

fn pentagon = (len) => {
  const sg = startSketchOn('XY')
  |> startProfileAt([-len / 2, -len / 2], %)
  |> angledLine({ angle: 0, length: len }, %, 'a')
  |> angledLine({
       angle: segAng('a', %) + 180 - 108,
       length: len
     }, %, 'b')
  |> angledLine({
       angle: segAng('b', %) + 180 - 108,
       length: len
     }, %, 'c')
  |> angledLine({
       angle: segAng('c', %) + 180 - 108,
       length: len
     }, %, 'd')
  |> angledLine({
       angle: segAng('d', %) + 180 - 108,
       length: len
     }, %)

  return sg
}

const p = pentagon(32)
  |> extrude(10, %)

const plumbus0 = make_circle(p, 'a', [0, 0], 2.5)
  |> extrude(10, %)
  |> fillet({
       radius: 0.5,
       tags: ['arc-a', getOppositeEdge('arc-a', %)]
     }, %)

// const plumbus1 = make_circle(p, 'b', [0, 0], 2.5)
//   |> extrude(10, %)
//   |> fillet({
//        radius: 0.5,
//        tags: ['arc-b', getOppositeEdge('arc-b', %)]
//      }, %)
"#;

    let result = execute_and_snapshot(code, kcl_lib::settings::types::UnitLength::Mm)
        .await
        .unwrap();
    twenty_twenty::assert_image("tests/executor/outputs/plumbus_fillets.png", &result, 1.0);
}

#[tokio::test(flavor = "multi_thread")]
async fn serial_test_empty_file_is_ok() {
    let code = r#""#;

    let result = execute_and_snapshot(code, kcl_lib::settings::types::UnitLength::Mm).await;
    assert!(result.is_ok());
}

#[tokio::test(flavor = "multi_thread")]
async fn serial_test_member_expression_in_params() {
    let code = r#"fn capScrew = (originStart, length, dia, capDia, capHeadLength) => {
  const screwHead = startSketchOn({
       plane: {
         origin: {
          x: originStart[0],
          y: originStart[1],
          z: originStart[2],
         },
         x_axis: { x: 0, y: 0, z: -1 },
         y_axis: { x: 1, y: 0, z: 0 },
         z_axis: { x: 0, y: 1, z: 0 }
      }
  })
    |> circle([0, 0], capDia / 2, %)
    |> extrude(capHeadLength, %)
  const screw = startSketchOn(screwHead, "start")
    |> circle([0, 0], dia / 2, %)
    |> extrude(length, %)
  return screw
}

capScrew([0, 0.5, 0], 50, 37.5, 50, 25)
"#;

    let result = execute_and_snapshot(code, kcl_lib::settings::types::UnitLength::Mm)
        .await
        .unwrap();
    twenty_twenty::assert_image("tests/executor/outputs/member_expression_in_params.png", &result, 1.0);
}

#[tokio::test(flavor = "multi_thread")]
async fn serial_test_bracket_with_fillets_ensure_fail_on_flush_source_ranges() {
    let code = r#"// Shelf Bracket
// This is a shelf bracket made out of 6061-T6 aluminum sheet metal. The required thickness is calculated based on a point load of 300 lbs applied to the end of the shelf. There are two brackets holding up the shelf, so the moment experienced is divided by 2. The shelf is 1 foot long from the wall.

const sigmaAllow = 35000 // psi
const width = 6 // inch
const p = 300 // Force on shelf - lbs
const distance = 12 // inches
const M = 12 * 300 / 2 // Moment experienced at fixed end of bracket
const FOS = 2 // Factor of safety of 2
const shelfMountL = 8 // The length of the bracket holding up the shelf is 6 inches
const wallMountL = 8 // the length of the bracket


// Calculate the thickness off the allowable bending stress and factor of safety
const thickness = sqrt(6 * M * FOS / (width * sigmaAllow))

// 0.25 inch fillet radius
const filletR = 0.25

// Sketch the bracket and extrude with fillets
const bracket = startSketchOn('XY')
  |> startProfileAt([0, 0], %)
  |> line([0, wallMountL], %, 'outerEdge')
  |> line([-shelfMountL, 0], %)
  |> line([0, -thickness], %)
  |> line([shelfMountL - thickness, 0], %, 'innerEdge')
  |> line([0, -wallMountL + thickness], %)
  |> close(%)
  |> extrude(width, %)
  |> fillet({
       radius: filletR,
       tags: [getNextAdjacentEdge('innerEdge', %)]
     }, %)
  |> fillet({
       radius: filletR + thickness,
       tags: [getNextAdjacentEdge('outerEdge', %)]
     }, %)
"#;

    let result = execute_and_snapshot(code, kcl_lib::settings::types::UnitLength::Mm).await;
    assert!(result.is_err());
    assert_eq!(
        result.err().unwrap().to_string(),
        r#"engine: KclErrorDetails { source_ranges: [SourceRange([1443, 1443])], message: "Modeling command failed: Some([ApiError { error_code: BadRequest, message: \"Fillet failed\" }])" }"#
    );
}
