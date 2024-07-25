use anyhow::Result;
use kcl_lib::{
    executor::{ExecutorContext, ExecutorSettings},
    settings::types::UnitLength,
};

/// The minimum permissible difference between asserted twenty-twenty images.
/// i.e. how different the current model snapshot can be from the previous saved one.
const MIN_DIFF: f64 = 0.99;

// mod server;

async fn new_context(units: UnitLength) -> Result<ExecutorContext> {
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

    let ctx = ExecutorContext::new(
        &client,
        ExecutorSettings {
            units,
            highlight_edges: true,
            enable_ssao: false,
            show_grid: false,
        },
    )
    .await?;
    Ok(ctx)
}

/// Executes a kcl program and takes a snapshot of the result.
/// This returns the bytes of the snapshot.
async fn execute_and_snapshot(code: &str, units: UnitLength) -> Result<image::DynamicImage> {
    let ctx = new_context(units).await?;
    let tokens = kcl_lib::token::lexer(code)?;
    let parser = kcl_lib::parser::Parser::new(tokens);
    let program = parser.ast()?;

    let snapshot = ctx.execute_and_prepare_snapshot(&program).await?;

    // Create a temporary file to write the output to.
    let output_file = std::env::temp_dir().join(format!("kcl_output_{}.png", uuid::Uuid::new_v4()));
    // Save the snapshot locally, to that temporary file.
    std::fs::write(&output_file, snapshot.contents.0)?;
    // Decode the snapshot, return it.
    let img = image::io::Reader::open(output_file).unwrap().decode()?;
    Ok(img)
}

#[tokio::test(flavor = "multi_thread")]
async fn serial_test_sketch_on_face() {
    let code = r#"const part001 = startSketchOn('XY')
  |> startProfileAt([11.19, 28.35], %)
  |> line([28.67, -13.25], %, $here)
  |> line([-4.12, -22.81], %)
  |> line([-33.24, 14.55], %)
  |> close(%)
  |> extrude(5, %)

const part002 = startSketchOn(part001, here)
  |> startProfileAt([0, 0], %)
  |> line([0, 10], %)
  |> line([10, 0], %)
  |> line([0, -10], %)
  |> close(%)
  |> extrude(5, %)
"#;

    let result = execute_and_snapshot(code, UnitLength::Mm).await.unwrap();
    twenty_twenty::assert_image("tests/executor/outputs/sketch_on_face.png", &result, MIN_DIFF);
}

#[tokio::test(flavor = "multi_thread")]
async fn serial_test_riddle_small() {
    let code = include_str!("inputs/riddle_small.kcl");
    let result = execute_and_snapshot(code, UnitLength::Mm).await.unwrap();
    twenty_twenty::assert_image("tests/executor/outputs/riddle_small.png", &result, MIN_DIFF);
}

#[tokio::test(flavor = "multi_thread")]
async fn serial_test_lego() {
    let code = include_str!("inputs/lego.kcl");
    let result = execute_and_snapshot(code, UnitLength::Mm).await.unwrap();
    twenty_twenty::assert_image("tests/executor/outputs/lego.png", &result, MIN_DIFF);
}

#[tokio::test(flavor = "multi_thread")]
async fn serial_test_pipe_as_arg() {
    let code = include_str!("inputs/pipe_as_arg.kcl");
    let result = execute_and_snapshot(code, UnitLength::Mm).await.unwrap();
    twenty_twenty::assert_image("tests/executor/outputs/pipe_as_arg.png", &result, MIN_DIFF);
}

#[tokio::test(flavor = "multi_thread")]
async fn serial_test_pentagon_fillet_sugar() {
    let code = include_str!("inputs/pentagon_fillet_sugar.kcl");
    let result = execute_and_snapshot(code, UnitLength::Cm).await.unwrap();
    twenty_twenty::assert_image("tests/executor/outputs/pentagon_fillet_sugar.png", &result, MIN_DIFF);
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

    let result = execute_and_snapshot(code, UnitLength::Mm).await.unwrap();
    twenty_twenty::assert_image("tests/executor/outputs/sketch_on_face_start.png", &result, MIN_DIFF);
}

#[tokio::test(flavor = "multi_thread")]
async fn serial_test_mike_stress_lines() {
    let code = include_str!("inputs/mike_stress_test.kcl");
    let result = execute_and_snapshot(code, UnitLength::Mm).await.unwrap();
    twenty_twenty::assert_image("tests/executor/outputs/mike_stress_test.png", &result, MIN_DIFF);
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

    let result = execute_and_snapshot(code, UnitLength::Mm).await.unwrap();
    twenty_twenty::assert_image("tests/executor/outputs/sketch_on_face_end.png", &result, MIN_DIFF);
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

    let result = execute_and_snapshot(code, UnitLength::Mm).await.unwrap();
    twenty_twenty::assert_image(
        "tests/executor/outputs/sketch_on_face_end_negative_extrude.png",
        &result,
        MIN_DIFF,
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

    let result = execute_and_snapshot(code, UnitLength::Mm).await;
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

    let result = execute_and_snapshot(code, UnitLength::Mm).await.unwrap();
    twenty_twenty::assert_image("tests/executor/outputs/basic_fillet_cube_start.png", &result, MIN_DIFF);
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

    let result = execute_and_snapshot(code, UnitLength::Mm).await.unwrap();
    twenty_twenty::assert_image("tests/executor/outputs/basic_fillet_cube_end.png", &result, MIN_DIFF);
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

    let result = execute_and_snapshot(code, UnitLength::Mm).await.unwrap();
    twenty_twenty::assert_image(
        "tests/executor/outputs/basic_fillet_cube_close_opposite.png",
        &result,
        MIN_DIFF,
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

    let result = execute_and_snapshot(code, UnitLength::Mm).await.unwrap();
    twenty_twenty::assert_image(
        "tests/executor/outputs/basic_fillet_cube_next_adjacent.png",
        &result,
        MIN_DIFF,
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

    let result = execute_and_snapshot(code, UnitLength::Mm).await.unwrap();
    twenty_twenty::assert_image(
        "tests/executor/outputs/basic_fillet_cube_previous_adjacent.png",
        &result,
        MIN_DIFF,
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

    let result = execute_and_snapshot(code, UnitLength::Mm).await.unwrap();
    twenty_twenty::assert_image("tests/executor/outputs/function_sketch.png", &result, MIN_DIFF);
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

    let result = execute_and_snapshot(code, UnitLength::Mm).await.unwrap();
    twenty_twenty::assert_image(
        "tests/executor/outputs/function_sketch_with_position.png",
        &result,
        MIN_DIFF,
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

    let result = execute_and_snapshot(code, UnitLength::Mm).await.unwrap();
    twenty_twenty::assert_image("tests/executor/outputs/angled_line.png", &result, MIN_DIFF);
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

    let result = execute_and_snapshot(code, UnitLength::Mm).await.unwrap();
    twenty_twenty::assert_image("tests/executor/outputs/parametric.png", &result, MIN_DIFF);
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

    let result = execute_and_snapshot(code, UnitLength::Mm).await.unwrap();
    twenty_twenty::assert_image("tests/executor/outputs/parametric_with_tan_arc.png", &result, MIN_DIFF);
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

    let result = execute_and_snapshot(code, UnitLength::Mm).await;
    assert!(result.is_err());
    assert_eq!(
        result.err().unwrap().to_string(),
        r#"engine: KclErrorDetails { source_ranges: [SourceRange([222, 235])], message: "Modeling command failed: [ApiError { error_code: BadRequest, message: \"The path is not closed.  Solid2D construction requires a closed path!\" }]" }"#,
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn serial_test_execute_i_shape() {
    // This is some code from lee that starts a pipe expression with a variable.
    let code = include_str!("inputs/i_shape.kcl");

    let result = execute_and_snapshot(code, UnitLength::Mm).await.unwrap();
    twenty_twenty::assert_image("tests/executor/outputs/i_shape.png", &result, MIN_DIFF);
}

#[tokio::test(flavor = "multi_thread")]
#[ignore] // No longer a stack overflow problem, instead it causes an engine internal error.
async fn serial_test_execute_pipes_on_pipes() {
    let code = include_str!("inputs/pipes_on_pipes.kcl");

    let result = execute_and_snapshot(code, UnitLength::Mm).await.unwrap();
    twenty_twenty::assert_image("tests/executor/outputs/pipes_on_pipes.png", &result, MIN_DIFF);
}

#[tokio::test(flavor = "multi_thread")]
async fn serial_test_execute_cylinder() {
    let code = include_str!("inputs/cylinder.kcl");

    let result = execute_and_snapshot(code, UnitLength::Mm).await.unwrap();
    twenty_twenty::assert_image("tests/executor/outputs/cylinder.png", &result, MIN_DIFF);
}

#[tokio::test(flavor = "multi_thread")]
async fn serial_test_execute_kittycad_svg() {
    let code = include_str!("inputs/kittycad_svg.kcl");

    let result = execute_and_snapshot(code, UnitLength::Mm).await.unwrap();
    twenty_twenty::assert_image("tests/executor/outputs/kittycad_svg.png", &result, MIN_DIFF);
}

#[tokio::test(flavor = "multi_thread")]
async fn serial_test_member_expression_sketch_group() {
    let code = r#"fn cube = (pos, scale) => {
  const sg = startSketchOn('XY')
    |> startProfileAt(pos, %)
    |> line([0, scale], %)
    |> line([scale, 0], %)
    |> line([0, -scale], %)
    |> close(%)

  return sg
}

const b1 = cube([0,0], 10)
const b2 = cube([3,3], 4)
    |> extrude(10, %)

const pt1 = b1.value[0]
const pt2 = b2.value[0]
"#;

    let result = execute_and_snapshot(code, UnitLength::Mm).await.unwrap();
    twenty_twenty::assert_image(
        "tests/executor/outputs/member_expression_sketch_group.png",
        &result,
        MIN_DIFF,
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn serial_test_helix_defaults() {
    let code = r#"const part001 = startSketchOn('XY')
     |> circle([5, 5], 10, %)
     |> extrude(10, %)
     |> helix({revolutions: 16, angle_start: 0}, %)
"#;

    let result = execute_and_snapshot(code, UnitLength::Mm).await.unwrap();
    twenty_twenty::assert_image("tests/executor/outputs/helix_defaults.png", &result, MIN_DIFF);
}

#[tokio::test(flavor = "multi_thread")]
async fn serial_test_helix_defaults_negative_extrude() {
    let code = r#"const part001 = startSketchOn('XY')
     |> circle([5, 5], 10, %)
     |> extrude(-10, %)
     |> helix({revolutions: 16, angle_start: 0}, %)
"#;

    let result = execute_and_snapshot(code, UnitLength::Mm).await.unwrap();
    twenty_twenty::assert_image(
        "tests/executor/outputs/helix_defaults_negative_extrude.png",
        &result,
        MIN_DIFF,
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn serial_test_helix_ccw() {
    let code = r#"const part001 = startSketchOn('XY')
     |> circle([5, 5], 10, %)
     |> extrude(10, %)
     |> helix({revolutions: 16, angle_start: 0, ccw: true}, %)
"#;

    let result = execute_and_snapshot(code, UnitLength::Mm).await.unwrap();
    twenty_twenty::assert_image("tests/executor/outputs/helix_ccw.png", &result, MIN_DIFF);
}

#[tokio::test(flavor = "multi_thread")]
async fn serial_test_helix_with_length() {
    let code = r#"const part001 = startSketchOn('XY')
     |> circle([5, 5], 10, %)
     |> extrude(10, %)
     |> helix({revolutions: 16, angle_start: 0, length: 3}, %)
"#;

    let result = execute_and_snapshot(code, UnitLength::Mm).await.unwrap();
    twenty_twenty::assert_image("tests/executor/outputs/helix_with_length.png", &result, MIN_DIFF);
}

#[tokio::test(flavor = "multi_thread")]
async fn serial_test_dimensions_match() {
    let code = r#"const part001 = startSketchOn('XY')
  |> startProfileAt([-10, -10], %)
  |> line([20, 0], %)
  |> line([0, 20], %)
  |> line([-20, 0], %)
  |> close(%)
  |> extrude(10, %)
"#;

    let result = execute_and_snapshot(code, UnitLength::Mm).await.unwrap();
    twenty_twenty::assert_image("tests/executor/outputs/dimensions_match.png", &result, MIN_DIFF);
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

    let result = execute_and_snapshot(code, UnitLength::Mm).await.unwrap();
    twenty_twenty::assert_image("tests/executor/outputs/close_arc.png", &result, MIN_DIFF);
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

    let result = execute_and_snapshot(code, UnitLength::Mm).await.unwrap();
    twenty_twenty::assert_image("tests/executor/outputs/negative_args.png", &result, MIN_DIFF);
}

#[tokio::test(flavor = "multi_thread")]
async fn serial_test_basic_tangential_arc() {
    let code = r#"const boxSketch = startSketchAt([0, 0])
    |> line([0, 10], %)
    |> tangentialArc({radius: 5, offset: 90}, %)
    |> line([5, -15], %)
    |> extrude(10, %)
"#;

    let result = execute_and_snapshot(code, UnitLength::Mm).await.unwrap();
    twenty_twenty::assert_image("tests/executor/outputs/tangential_arc.png", &result, MIN_DIFF);
}

#[tokio::test(flavor = "multi_thread")]
async fn serial_test_basic_tangential_arc_with_point() {
    let code = r#"const boxSketch = startSketchAt([0, 0])
    |> line([0, 10], %)
    |> tangentialArc([-5, 5], %)
    |> line([5, -15], %)
    |> extrude(10, %)
"#;

    let result = execute_and_snapshot(code, UnitLength::Mm).await.unwrap();
    twenty_twenty::assert_image(
        "tests/executor/outputs/tangential_arc_with_point.png",
        &result,
        MIN_DIFF,
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn serial_test_basic_tangential_arc_to() {
    let code = r#"const boxSketch = startSketchAt([0, 0])
    |> line([0, 10], %)
    |> tangentialArcTo([-5, 15], %)
    |> line([5, -15], %)
    |> extrude(10, %)
"#;

    let result = execute_and_snapshot(code, UnitLength::Mm).await.unwrap();
    twenty_twenty::assert_image("tests/executor/outputs/tangential_arc_to.png", &result, MIN_DIFF);
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

    let result = execute_and_snapshot(code, UnitLength::Mm).await.unwrap();
    twenty_twenty::assert_image(
        "tests/executor/outputs/different_planes_same_drawing.png",
        &result,
        MIN_DIFF,
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

    let result = execute_and_snapshot(code, UnitLength::Mm).await.unwrap();
    twenty_twenty::assert_image("tests/executor/outputs/lots_of_planes.png", &result, MIN_DIFF);
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

    let result = execute_and_snapshot(code, UnitLength::Mm).await.unwrap();
    twenty_twenty::assert_image("tests/executor/outputs/holes.png", &result, MIN_DIFF);
}

#[tokio::test(flavor = "multi_thread")]
async fn optional_params() {
    let code = r#"
    fn other_circle = (pos, radius, tag?) => {
      const sg = startSketchOn('XY')
        |> startProfileAt(pos, %)
        |> arc({angle_end: 360, angle_start: 0, radius: radius}, %)
        |> close(%)
        |> extrude(2, %)

      return sg
  }

const thing = other_circle([2, 2], 20)
"#;
    let result = execute_and_snapshot(code, UnitLength::Mm).await.unwrap();
    twenty_twenty::assert_image("tests/executor/outputs/optional_params.png", &result, MIN_DIFF);
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
    |> tarc([pos[0] - w/2 + cornerRadius, pos[1] - l/2], %, $arc0)
    |> lineTo([pos[0] + w/2 - cornerRadius, pos[1] - l/2], %)
    |> tarc([pos[0] + w/2, pos[1] - l/2 + cornerRadius], %)
    |> lineTo([pos[0] + w/2, pos[1] + l/2 - cornerRadius], %)
    |> tarc([pos[0] + w/2 - cornerRadius, pos[1] + l/2], %, $arc2)
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

    let result = execute_and_snapshot(code, UnitLength::Mm).await.unwrap();
    twenty_twenty::assert_image("tests/executor/outputs/rounded_with_holes.png", &result, MIN_DIFF);
}

#[tokio::test(flavor = "multi_thread")]
async fn serial_test_top_level_expression() {
    let code = r#"startSketchOn('XY') |> circle([0,0], 22, %) |> extrude(14, %)"#;

    let result = execute_and_snapshot(code, UnitLength::Mm).await.unwrap();
    twenty_twenty::assert_image("tests/executor/outputs/top_level_expression.png", &result, MIN_DIFF);
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

    let result = execute_and_snapshot(code, UnitLength::Mm).await.unwrap();
    twenty_twenty::assert_image(
        "tests/executor/outputs/patterns_linear_basic_with_math.png",
        &result,
        MIN_DIFF,
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn serial_test_patterns_linear_basic() {
    let code = r#"const part =  startSketchOn('XY')
    |> circle([0,0], 2, %)
    |> patternLinear2d({axis: [0,1], repetitions: 12, distance: 4}, %)
    |> extrude(1, %)
"#;

    let result = execute_and_snapshot(code, UnitLength::Mm).await.unwrap();
    twenty_twenty::assert_image("tests/executor/outputs/patterns_linear_basic.png", &result, MIN_DIFF);
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

    let result = execute_and_snapshot(code, UnitLength::Mm).await.unwrap();
    twenty_twenty::assert_image("tests/executor/outputs/patterns_linear_basic_3d.png", &result, MIN_DIFF);
}

#[tokio::test(flavor = "multi_thread")]
async fn serial_test_patterns_linear_basic_negative_distance() {
    let code = r#"const part = startSketchOn('XY')
    |> circle([0,0], 2, %)
    |> patternLinear2d({axis: [0,1], repetitions: 12, distance: -2}, %)
    |> extrude(1, %)
"#;

    let result = execute_and_snapshot(code, UnitLength::Mm).await.unwrap();
    twenty_twenty::assert_image(
        "tests/executor/outputs/patterns_linear_basic_negative_distance.png",
        &result,
        MIN_DIFF,
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn serial_test_patterns_linear_basic_negative_axis() {
    let code = r#"const part = startSketchOn('XY')
    |> circle([0,0], 2, %)
    |> patternLinear2d({axis: [0,-1], repetitions: 12, distance: 2}, %)
    |> extrude(1, %)
"#;

    let result = execute_and_snapshot(code, UnitLength::Mm).await.unwrap();
    twenty_twenty::assert_image(
        "tests/executor/outputs/patterns_linear_basic_negative_axis.png",
        &result,
        MIN_DIFF,
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
  |> extrude(10, %)

"#;

    let result = execute_and_snapshot(code, UnitLength::Mm).await.unwrap();
    twenty_twenty::assert_image(
        "tests/executor/outputs/patterns_linear_basic_holes.png",
        &result,
        MIN_DIFF,
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn serial_test_patterns_circular_basic_2d() {
    let code = r#"const part = startSketchOn('XY')
    |> circle([0,0], 2, %)
    |> patternCircular2d({center: [20, 20], repetitions: 12, arcDegrees: 210, rotateDuplicates: true}, %)
    |> extrude(1, %)
"#;

    let result = execute_and_snapshot(code, UnitLength::Mm).await.unwrap();
    twenty_twenty::assert_image(
        "tests/executor/outputs/patterns_circular_basic_2d.png",
        &result,
        MIN_DIFF,
    );
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

    let result = execute_and_snapshot(code, UnitLength::Mm).await.unwrap();
    twenty_twenty::assert_image(
        "tests/executor/outputs/patterns_circular_basic_3d.png",
        &result,
        MIN_DIFF,
    );
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

    let result = execute_and_snapshot(code, UnitLength::Mm).await.unwrap();
    twenty_twenty::assert_image(
        "tests/executor/outputs/patterns_circular_3d_tilted_axis.png",
        &result,
        MIN_DIFF,
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn serial_test_import_file_doesnt_exist() {
    let code = r#"const model = import("thing.obj")"#;

    let result = execute_and_snapshot(code, UnitLength::Mm).await;
    assert!(result.is_err());
    assert_eq!(
        result.err().unwrap().to_string(),
        r#"semantic: KclErrorDetails { source_ranges: [SourceRange([14, 33])], message: "File `thing.obj` does not exist." }"#
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn serial_test_import_obj_with_mtl() {
    let code = r#"const model = import("tests/executor/inputs/cube.obj")"#;

    let result = execute_and_snapshot(code, UnitLength::Mm).await.unwrap();
    twenty_twenty::assert_image("tests/executor/outputs/import_obj_with_mtl.png", &result, MIN_DIFF);
}

#[tokio::test(flavor = "multi_thread")]
async fn serial_test_import_obj_with_mtl_units() {
    let code = r#"const model = import("tests/executor/inputs/cube.obj", {type: "obj", units: "m"})"#;

    let result = execute_and_snapshot(code, UnitLength::Mm).await.unwrap();
    twenty_twenty::assert_image(
        "tests/executor/outputs/import_obj_with_mtl_units.png",
        &result,
        MIN_DIFF,
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn serial_test_import_stl() {
    let code = r#"const model = import("tests/executor/inputs/2-5-long-m8-chc-screw.stl")"#;

    let result = execute_and_snapshot(code, UnitLength::Mm).await.unwrap();
    twenty_twenty::assert_image("tests/executor/outputs/import_stl.png", &result, MIN_DIFF);
}

#[tokio::test(flavor = "multi_thread")]
async fn serial_test_import_gltf_with_bin() {
    let code = r#"const model = import("tests/executor/inputs/cube.gltf")"#;

    let result = execute_and_snapshot(code, UnitLength::Mm).await.unwrap();
    twenty_twenty::assert_image("tests/executor/outputs/import_gltf_with_bin.png", &result, MIN_DIFF);
}

#[tokio::test(flavor = "multi_thread")]
async fn serial_test_import_gltf_embedded() {
    let code = r#"const model = import("tests/executor/inputs/cube-embedded.gltf")"#;

    let result = execute_and_snapshot(code, UnitLength::Mm).await.unwrap();
    twenty_twenty::assert_image("tests/executor/outputs/import_gltf_embedded.png", &result, MIN_DIFF);
}

#[tokio::test(flavor = "multi_thread")]
async fn serial_test_import_glb() {
    let code = r#"const model = import("tests/executor/inputs/cube.glb")"#;

    let result = execute_and_snapshot(code, UnitLength::Mm).await.unwrap();
    twenty_twenty::assert_image("tests/executor/outputs/import_glb.png", &result, MIN_DIFF);
}

#[tokio::test(flavor = "multi_thread")]
async fn serial_test_import_glb_no_assign() {
    let code = r#"import("tests/executor/inputs/cube.glb")"#;

    let result = execute_and_snapshot(code, UnitLength::Mm).await.unwrap();
    twenty_twenty::assert_image("tests/executor/outputs/import_glb_no_assign.png", &result, MIN_DIFF);
}

#[tokio::test(flavor = "multi_thread")]
async fn serial_test_import_ext_doesnt_match() {
    let code = r#"const model = import("tests/executor/inputs/cube.gltf", {type: "obj", units: "m"})"#;

    let result = execute_and_snapshot(code, UnitLength::Mm).await;
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

    let result = execute_and_snapshot(code, UnitLength::Mm).await.unwrap();
    twenty_twenty::assert_image("tests/executor/outputs/cube_mm.png", &result, MIN_DIFF);
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

    let result = execute_and_snapshot(code, UnitLength::Cm).await.unwrap();
    twenty_twenty::assert_image("tests/executor/outputs/cube_cm.png", &result, MIN_DIFF);
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

    let result = execute_and_snapshot(code, UnitLength::M).await.unwrap();
    twenty_twenty::assert_image("tests/executor/outputs/cube_m.png", &result, MIN_DIFF);
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

    let result = execute_and_snapshot(code, UnitLength::In).await.unwrap();
    twenty_twenty::assert_image("tests/executor/outputs/cube_in.png", &result, MIN_DIFF);
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

    let result = execute_and_snapshot(code, UnitLength::Ft).await.unwrap();
    twenty_twenty::assert_image("tests/executor/outputs/cube_ft.png", &result, MIN_DIFF);
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

    let result = execute_and_snapshot(code, UnitLength::Yd).await.unwrap();
    twenty_twenty::assert_image("tests/executor/outputs/cube_yd.png", &result, MIN_DIFF);
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

    let result = execute_and_snapshot(code, UnitLength::Mm).await;

    assert!(result.is_err());
    assert_eq!(
        result.err().unwrap().to_string(),
        r#"type: KclErrorDetails { source_ranges: [SourceRange([281, 311])], message: "Tag `here` is a non-planar surface" }"#
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

    let result = execute_and_snapshot(code, UnitLength::Mm).await.unwrap();
    twenty_twenty::assert_image("tests/executor/outputs/sketch_on_face_of_face.png", &result, MIN_DIFF);
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

    let result = execute_and_snapshot(code, UnitLength::Mm).await;
    assert!(result.is_err());
    assert_eq!(
        result.err().unwrap().to_string(),
        r#"semantic: KclErrorDetails { source_ranges: [SourceRange([157, 175])], message: "Expected an argument at index 2" }"#,
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

    let result = execute_and_snapshot(code, UnitLength::Mm).await.unwrap();
    twenty_twenty::assert_image("tests/executor/outputs/sketch_on_face_circle.png", &result, MIN_DIFF);
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

    let result = execute_and_snapshot(code, UnitLength::Mm).await.unwrap();
    twenty_twenty::assert_image(
        "tests/executor/outputs/sketch_on_face_circle_tagged.png",
        &result,
        MIN_DIFF,
    );
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

    let result = execute_and_snapshot(code, UnitLength::Mm).await;
    assert!(result.is_err());
    assert_eq!(
        result.err().unwrap().to_string(),
        r#"semantic: KclErrorDetails { source_ranges: [SourceRange([891, 940])], message: "Argument at index 0 was supposed to be type [f64; 2] but wasn't" }"#,
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

    let result = execute_and_snapshot(code, UnitLength::Mm).await.unwrap();
    twenty_twenty::assert_image(
        "tests/executor/outputs/big_number_angle_to_match_length_x.png",
        &result,
        MIN_DIFF,
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

    let result = execute_and_snapshot(code, UnitLength::Mm).await.unwrap();
    twenty_twenty::assert_image(
        "tests/executor/outputs/big_number_angle_to_match_length_y.png",
        &result,
        MIN_DIFF,
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

    let result = execute_and_snapshot(code, UnitLength::Mm).await.unwrap();
    twenty_twenty::assert_image("tests/executor/outputs/simple_revolve.png", &result, MIN_DIFF);
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

    let result = execute_and_snapshot(code, UnitLength::Mm).await.unwrap();
    twenty_twenty::assert_image("tests/executor/outputs/simple_revolve_uppercase.png", &result, MIN_DIFF);
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

    let result = execute_and_snapshot(code, UnitLength::Mm).await.unwrap();
    twenty_twenty::assert_image("tests/executor/outputs/simple_revolve_negative.png", &result, MIN_DIFF);
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

    let result = execute_and_snapshot(code, UnitLength::Mm).await;

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

    let result = execute_and_snapshot(code, UnitLength::Mm).await;

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

    let result = execute_and_snapshot(code, UnitLength::Mm).await.unwrap();
    twenty_twenty::assert_image(
        "tests/executor/outputs/simple_revolve_custom_angle.png",
        &result,
        MIN_DIFF,
    );
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

    let result = execute_and_snapshot(code, UnitLength::Mm).await.unwrap();
    twenty_twenty::assert_image(
        "tests/executor/outputs/simple_revolve_custom_axis.png",
        &result,
        MIN_DIFF,
    );
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

    let result = execute_and_snapshot(code, UnitLength::Mm).await.unwrap();
    twenty_twenty::assert_image("tests/executor/outputs/revolve_on_edge.png", &result, MIN_DIFF);
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

    let result = execute_and_snapshot(code, UnitLength::Mm).await;

    assert!(result.is_err());
    assert_eq!(
        result.err().unwrap().to_string(),
        r#"engine: KclErrorDetails { source_ranges: [SourceRange([349, 409])], message: "Modeling command failed: [ApiError { error_code: InternalEngine, message: \"Solid3D revolve failed:  sketch profile must lie entirely on one side of the revolution axis\" }]" }"#
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

    let result = execute_and_snapshot(code, UnitLength::Mm).await.unwrap();
    twenty_twenty::assert_image(
        "tests/executor/outputs/revolve_on_face_circle_edge.png",
        &result,
        MIN_DIFF,
    );
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

    let result = execute_and_snapshot(code, UnitLength::Mm).await.unwrap();
    twenty_twenty::assert_image("tests/executor/outputs/revolve_on_face_circle.png", &result, MIN_DIFF);
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

    let result = execute_and_snapshot(code, UnitLength::Mm).await.unwrap();
    twenty_twenty::assert_image("tests/executor/outputs/revolve_on_face.png", &result, MIN_DIFF);
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

    let result = execute_and_snapshot(code, UnitLength::Mm).await.unwrap();
    twenty_twenty::assert_image("tests/executor/outputs/basic_revolve_circle.png", &result, MIN_DIFF);
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

    let result = execute_and_snapshot(code, UnitLength::Mm).await.unwrap();
    twenty_twenty::assert_image(
        "tests/executor/outputs/simple_revolve_sketch_on_edge.png",
        &result,
        MIN_DIFF,
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn serial_test_plumbus_fillets() {
    let code = r#"fn make_circle = (ext, face, pos, radius) => {
  const sg = startSketchOn(ext, face)
  |> startProfileAt([pos[0] + radius, pos[1]], %)
  |> arc({
       angle_end: 360,
       angle_start: 0,
       radius: radius
     }, %, $arc1)
  |> close(%)

  return sg
}

fn pentagon = (len) => {
  const sg = startSketchOn('XY')
  |> startProfileAt([-len / 2, -len / 2], %)
  |> angledLine({ angle: 0, length: len }, %, $a)
  |> angledLine({
       angle: segAng(a, %) + 180 - 108,
       length: len
     }, %, $b)
  |> angledLine({
       angle: segAng(b, %) + 180 - 108,
       length: len
     }, %, $c)
  |> angledLine({
       angle: segAng(c, %) + 180 - 108,
       length: len
     }, %, $d)
  |> angledLine({
       angle: segAng(d, %) + 180 - 108,
       length: len
     }, %)

  return sg
}

const p = pentagon(32)
  |> extrude(10, %)

const circle0 = make_circle(p, p.sketchGroup.tags.a, [0, 0], 2.5)
const plumbus0 = circle0
  |> extrude(10, %)
  |> fillet({
       radius: 0.5,
       tags: [circle0.tags.arc1, getOppositeEdge(circle0.tags.arc1, %)]
     }, %)

const circle1 = make_circle(p, p.sketchGroup.tags.b, [0, 0], 2.5)
const plumbus1 = circle1
   |> extrude(10, %)
   |> fillet({
        radius: 0.5,
        tags: [circle1.tags.arc1, getOppositeEdge(circle1.tags.arc1, %)]
      }, %)
"#;

    let result = execute_and_snapshot(code, UnitLength::Mm).await.unwrap();
    twenty_twenty::assert_image("tests/executor/outputs/plumbus_fillets.png", &result, MIN_DIFF);
}

#[tokio::test(flavor = "multi_thread")]
async fn serial_test_empty_file_is_ok() {
    let code = r#""#;

    let result = execute_and_snapshot(code, UnitLength::Mm).await;
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

    let result = execute_and_snapshot(code, UnitLength::Mm).await.unwrap();
    twenty_twenty::assert_image(
        "tests/executor/outputs/member_expression_in_params.png",
        &result,
        MIN_DIFF,
    );
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

    let result = execute_and_snapshot(code, UnitLength::Mm).await;
    assert!(result.is_err());
    assert_eq!(
        result.err().unwrap().to_string(),
        r#"engine: KclErrorDetails { source_ranges: [SourceRange([1336, 1442])], message: "Modeling command failed: [ApiError { error_code: BadRequest, message: \"Fillet failed\" }]" }"#
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn serial_test_error_empty_start_sketch_on_string() {
    let code = r#"const part001 = startSketchOn('-XZ')
  |> startProfileAt([75.75, 184.25], %)
  |> line([190.03, -118.13], %)
  |> line([-33.38, -202.86], %)
  |> line([-315.86, -64.2], %)
  |> tangentialArcTo([-147.66, 121.34], %)
  |> close(%)
  |> extrude(100, %)

const secondSketch = startSketchOn(part001, '')
  |> circle([-20, 50], 40, %)
  |> extrude(20, %)
"#;

    let result = execute_and_snapshot(code, UnitLength::Mm).await;
    assert!(result.is_err());
    assert_eq!(
        result.err().unwrap().to_string(),
        r#"type: KclErrorDetails { source_ranges: [SourceRange([272, 298])], message: "Expected a non-empty tag for the face" }"#
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn serial_test_error_user_function_wrong_args() {
    let code = r#"const length = .750
const width = 0.500
const height = 0.500
const dia = 4

fn squareHole = (l, w) => {
  const squareHoleSketch = startSketchOn('XY')
  |> startProfileAt([-width / 2, -length / 2], %)
  |> lineTo([width / 2, -length / 2], %)
  |> lineTo([width / 2, length / 2], %)
  |> lineTo([-width / 2, length / 2], %)
  |> close(%)
  return squareHoleSketch
}

const extrusion = startSketchOn('XY')
  |> circle([0, 0], dia/2, %)
  |> hole(squareHole(length, width, height), %)
  |> extrude(height, %)
"#;

    let result = execute_and_snapshot(code, UnitLength::Mm).await;
    assert!(result.is_err());
    assert_eq!(
        result.err().unwrap().to_string(),
        r#"semantic: KclErrorDetails { source_ranges: [SourceRange([92, 364]), SourceRange([444, 477])], message: "Expected 2 arguments, got 3" }"#
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn serial_test_xz_plane() {
    let code = r#"const part001 = startSketchOn('XZ')
  |> startProfileAt([0, 0], %)
  |> lineTo([100, 100], %)
  |> lineTo([100, 0], %)
  |> close(%)
  |> extrude(5 + 7, %)
"#;

    let result = execute_and_snapshot(code, UnitLength::Mm).await.unwrap();
    twenty_twenty::assert_image("tests/executor/outputs/xz_plane.png", &result, MIN_DIFF);
}

#[tokio::test(flavor = "multi_thread")]
async fn serial_test_neg_xz_plane() {
    let code = r#"const part001 = startSketchOn('-XZ')
  |> startProfileAt([0, 0], %)
  |> lineTo([100, 100], %)
  |> lineTo([100, 0], %)
  |> close(%)
  |> extrude(5 + 7, %)
"#;

    let result = execute_and_snapshot(code, UnitLength::Mm).await.unwrap();
    twenty_twenty::assert_image("tests/executor/outputs/neg_xz_plane.png", &result, MIN_DIFF);
}

#[tokio::test(flavor = "multi_thread")]
async fn serial_test_linear_pattern3d_a_pattern() {
    let code = r#"const exampleSketch = startSketchOn('XZ')
  |> startProfileAt([0, 0], %)
  |> line([0, 2], %)
  |> line([3, 1], %)
  |> line([0, -4], %)
  |> close(%)
  |> extrude(1, %)

const pattn1 = patternLinear3d({
       axis: [1, 0, 0],
       repetitions: 6,
       distance: 6
     }, exampleSketch)

const pattn2 = patternLinear3d({
       axis: [0, 0, 1],
       distance: 1,
       repetitions: 6
     }, pattn1)
"#;

    let result = execute_and_snapshot(code, UnitLength::Mm).await.unwrap();
    twenty_twenty::assert_image(
        "tests/executor/outputs/linear_pattern3d_a_pattern.png",
        &result,
        MIN_DIFF,
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn serial_test_circular_pattern3d_a_pattern() {
    let code = r#"const exampleSketch = startSketchOn('XZ')
  |> startProfileAt([0, 0], %)
  |> line([0, 2], %)
  |> line([3, 1], %)
  |> line([0, -4], %)
  |> close(%)
  |> extrude(1, %)

const pattn1 = patternLinear3d({
       axis: [1, 0, 0],
       repetitions: 6,
       distance: 6
     }, exampleSketch)

const pattn2 = patternCircular3d({axis: [0,0, 1], center: [-20, -20, -20], repetitions: 40, arcDegrees: 360, rotateDuplicates: false}, pattn1)
"#;

    let result = execute_and_snapshot(code, UnitLength::Mm).await.unwrap();
    twenty_twenty::assert_image(
        "tests/executor/outputs/circular_pattern3d_a_pattern.png",
        &result,
        MIN_DIFF,
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn serial_test_array_of_sketches() {
    let code = r#"const plane001 = startSketchOn('XZ')

const profile001 = plane001
  |> startProfileAt([40.82, 240.82], %)
  |> line([235.72, -8.16], %)
  |> line([13.27, -253.07], %)
  |> line([-247.97, -19.39], %)
  |> lineTo([profileStartX(%), profileStartY(%)], %)
  |> close(%)

const profile002 = plane001
  |> startProfileAt([47.17, -71.91], %)
  |> line([247.96, -4.03], %)
  |> line([-17.26, -116.79], %)
  |> line([-235.87, 12.66], %)
  |> lineTo([profileStartX(%), profileStartY(%)], %)
  |> close(%)

const sketch001 = [profile001, profile002]

extrude(10, sketch001)
"#;

    let result = execute_and_snapshot(code, UnitLength::Mm).await.unwrap();
    twenty_twenty::assert_image("tests/executor/outputs/array_of_sketches.png", &result, MIN_DIFF);
}

#[tokio::test(flavor = "multi_thread")]
async fn serial_test_sketch_on_face_after_fillets_referencing_face() {
    let code = r#"// Shelf Bracket
// This is a shelf bracket made out of 6061-T6 aluminum sheet metal. The required thickness is calculated based on a point load of 300 lbs applied to the end of the shelf. There are two brackets holding up the shelf, so the moment experienced is divided by 2. The shelf is 1 foot long from the wall.


// Define our bracket feet lengths
const shelfMountL = 8 // The length of the bracket holding up the shelf is 6 inches
const wallMountL = 6 // the length of the bracket


// Define constants required to calculate the thickness needed to support 300 lbs
const sigmaAllow = 35000 // psi
const width = 6 // inch
const p = 300 // Force on shelf - lbs
const L = 12 // inches
const M = L * p / 2 // Moment experienced at fixed end of bracket
const FOS = 2 // Factor of safety of 2 to be conservative


// Calculate the thickness off the bending stress and factor of safety
const thickness = sqrt(6 * M * FOS / (width * sigmaAllow))

// 0.25 inch fillet radius
const filletR = 0.25

// Sketch the bracket and extrude with fillets
const bracket = startSketchOn('XY')
  |> startProfileAt([0, 0], %)
  |> line([0, wallMountL], %, 'outerEdge')
  |> line([-shelfMountL, 0], %, 'seg01')
  |> line([0, -thickness], %)
  |> line([shelfMountL - thickness, 0], %, 'innerEdge')
  |> line([0, -wallMountL + thickness], %)
  |> close(%)
  |> extrude(width, %)
  |> fillet({
       radius: filletR,
       tags: [
         getPreviousAdjacentEdge('innerEdge', %)
       ]
     }, %)
  |> fillet({
       radius: filletR + thickness,
       tags: [
         getPreviousAdjacentEdge('outerEdge', %)
       ]
     }, %)

const sketch001 = startSketchOn(bracket, 'seg01')
  |> startProfileAt([4.28, 3.83], %)
  |> line([2.17, -0.03], %)
  |> line([-0.07, -1.8], %)
  |> line([-2.07, 0.05], %)
  |> lineTo([profileStartX(%), profileStartY(%)], %)
  |> close(%)
  |> extrude(10, %)
"#;

    let result = execute_and_snapshot(code, UnitLength::Mm).await.unwrap();
    twenty_twenty::assert_image(
        "tests/executor/outputs/sketch_on_face_after_fillets_referencing_face.png",
        &result,
        MIN_DIFF,
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn serial_test_circular_pattern3d_array_of_extrudes() {
    let code = r#"const plane001 = startSketchOn('XZ')

const sketch001 = plane001
  |> startProfileAt([40.82, 240.82], %)
  |> line([235.72, -8.16], %)
  |> line([13.27, -253.07], %)
  |> line([-247.97, -19.39], %)
  |> lineTo([profileStartX(%), profileStartY(%)], %)
  |> close(%)
  |> extrude(10, %)

const sketch002 = plane001
  |> startProfileAt([47.17, -71.91], %)
  |> line([247.96, -4.03], %)
  |> line([-17.26, -116.79], %)
  |> line([-235.87, 12.66], %)
  |> lineTo([profileStartX(%), profileStartY(%)], %)
  |> close(%)
  |> extrude(10, %)


let extrudes = [sketch001, sketch002] 

const pattn1 = patternLinear3d({
       axis: [0, 1, 0],
       repetitions: 2,
       distance: 20
     }, extrudes)
"#;

    let result = execute_and_snapshot(code, UnitLength::Mm).await.unwrap();
    twenty_twenty::assert_image(
        "tests/executor/outputs/pattern3d_array_of_extrudes.png",
        &result,
        MIN_DIFF,
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn serial_test_fillets_referencing_other_fillets() {
    let code = r#"// Z-Bracket

// Z-brackets are designed to affix or hang objects from a wall by securing them to the wall's studs. These brackets offer support and mounting solutions for bulky or heavy items that may be challenging to attach directly. Serving as a protective feature, Z-brackets help prevent heavy loads from moving or toppling, enhancing safety in the environment where they are used.

// Define constants
const foot1Length = 4
const height = 4
const foot2Length = 5
const width = 4
const filletRad = 0.25
const thickness = 0.125

const cornerFilletRad = 0.5

const holeDia = 0.5

const sketch001 = startSketchOn("XZ")
  |> startProfileAt([-foot1Length, 0], %)
  |> line([0, thickness], %, 'cornerFillet1')
  |> line([foot1Length, 0], %)
  |> line([0, height], %, 'fillet1')
  |> line([foot2Length, 0], %)
  |> line([0, -thickness], %, 'cornerFillet2')
  |> line([-foot2Length+thickness, 0], %)
  |> line([0, -height], %, 'fillet2')
  |> close(%)

const baseExtrusion = extrude(width, sketch001)
  |> fillet({
    radius: cornerFilletRad,
    tags: ["cornerFillet1", "cornerFillet2", getOppositeEdge("cornerFillet1", %), getOppositeEdge("cornerFillet2", %)],
  }, %)
  |> fillet({
    radius: filletRad,
    tags: [getPreviousAdjacentEdge("fillet1", %), getPreviousAdjacentEdge("fillet2", %)]
  }, %)
  |> fillet({
   radius: filletRad + thickness,
   tags: [getNextAdjacentEdge("fillet1", %), getNextAdjacentEdge("fillet2", %)],
 }, %)
"#;

    let result = execute_and_snapshot(code, UnitLength::Mm).await.unwrap();
    twenty_twenty::assert_image(
        "tests/executor/outputs/fillets_referencing_other_fillets.png",
        &result,
        MIN_DIFF,
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn serial_test_chamfers_referencing_other_chamfers() {
    let code = r#"// Z-Bracket

// Z-brackets are designed to affix or hang objects from a wall by securing them to the wall's studs. These brackets offer support and mounting solutions for bulky or heavy items that may be challenging to attach directly. Serving as a protective feature, Z-brackets help prevent heavy loads from moving or toppling, enhancing safety in the environment where they are used.

// Define constants
const foot1Length = 4
const height = 4
const foot2Length = 5
const width = 4
const chamferRad = 0.25
const thickness = 0.125

const cornerChamferRad = 0.5

const holeDia = 0.5

const sketch001 = startSketchOn("XZ")
  |> startProfileAt([-foot1Length, 0], %)
  |> line([0, thickness], %, 'cornerChamfer1')
  |> line([foot1Length, 0], %)
  |> line([0, height], %, 'chamfer1')
  |> line([foot2Length, 0], %)
  |> line([0, -thickness], %, 'cornerChamfer2')
  |> line([-foot2Length+thickness, 0], %)
  |> line([0, -height], %, 'chamfer2')
  |> close(%)

const baseExtrusion = extrude(width, sketch001)
  |> chamfer({
    length: cornerChamferRad,
    tags: ["cornerChamfer1", "cornerChamfer2", getOppositeEdge("cornerChamfer1", %), getOppositeEdge("cornerChamfer2", %)],
  }, %)
  |> chamfer({
    length: chamferRad,
    tags: [getPreviousAdjacentEdge("chamfer1", %), getPreviousAdjacentEdge("chamfer2", %)]
  }, %)
  |> chamfer({
   length: chamferRad + thickness,
   tags: [getNextAdjacentEdge("chamfer1", %), getNextAdjacentEdge("chamfer2", %)],
 }, %)
"#;

    let result = execute_and_snapshot(code, UnitLength::Mm).await.unwrap();
    twenty_twenty::assert_image(
        "tests/executor/outputs/chamfers_referencing_other_chamfers.png",
        &result,
        MIN_DIFF,
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn serial_test_engine_error_source_range_on_last_command() {
    let code = r#"const sketch001 = startSketchOn('XZ')
  |> startProfileAt([61.74, 206.13], %)
  |> xLine(305.11, %, 'seg01')
  |> yLine(-291.85, %)
  |> xLine(-segLen('seg01', %), %)
  |> lineTo([profileStartX(%), profileStartY(%)], %)
  |> close(%)
  |> extrude(40.14, %)
  |> shell({
    faces: ["seg01"],
    thickness: 3.14,
  }, %)
"#;

    let result = execute_and_snapshot(code, UnitLength::Mm).await;
    assert!(result.is_err());
    assert_eq!(
        result.err().unwrap().to_string(),
        r#"engine: KclErrorDetails { source_ranges: [SourceRange([262, 320])], message: "Modeling command failed: [ApiError { error_code: InternalEngine, message: \"Invalid brep after shell operation\" }]" }"#
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn serial_test_linear_pattern3d_filleted_sketch() {
    let code = r#"fn cube = (pos, scale) => {
  const sg = startSketchOn('XY')
    |> startProfileAt(pos, %)
    |> line([0, scale], %)
    |> line([scale, 0], %)
    |> line([0, -scale], %)

  return sg
}
const part001 = cube([0,0], 20)
    |> close(%, 'line1')
    |> extrude(20, %)
  |> fillet({
    radius: 10,
    tags: [getOppositeEdge('line1',%)]
  }, %)

const pattn1 = patternLinear3d({
       axis: [1, 0, 0],
       repetitions: 3,
       distance: 40
     }, part001)

"#;

    let result = execute_and_snapshot(code, UnitLength::Mm).await.unwrap();
    twenty_twenty::assert_image(
        "tests/executor/outputs/linear_pattern3d_filleted_sketch.png",
        &result,
        MIN_DIFF,
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn serial_test_circular_pattern3d_filleted_sketch() {
    let code = r#"fn cube = (pos, scale) => {
  const sg = startSketchOn('XY')
    |> startProfileAt(pos, %)
    |> line([0, scale], %)
    |> line([scale, 0], %)
    |> line([0, -scale], %)

  return sg
}
const part001 = cube([0,0], 20)
    |> close(%, 'line1')
    |> extrude(20, %)
  |> fillet({
    radius: 10,
    tags: [getOppositeEdge('line1',%)]
  }, %)

const pattn2 = patternCircular3d({axis: [0,0, 1], center: [-20, -20, -20], repetitions: 4, arcDegrees: 360, rotateDuplicates: false}, part001) 

"#;

    let result = execute_and_snapshot(code, UnitLength::Mm).await.unwrap();
    twenty_twenty::assert_image(
        "tests/executor/outputs/circular_pattern3d_filleted_sketch.png",
        &result,
        MIN_DIFF,
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn serial_test_circular_pattern3d_chamfered_sketch() {
    let code = r#"fn cube = (pos, scale) => {
  const sg = startSketchOn('XY')
    |> startProfileAt(pos, %)
    |> line([0, scale], %)
    |> line([scale, 0], %)
    |> line([0, -scale], %)

  return sg
}
const part001 = cube([0,0], 20)
    |> close(%, 'line1')
    |> extrude(20, %)
  |> chamfer({
    length: 10,
    tags: [getOppositeEdge('line1',%)]
  }, %)

const pattn2 = patternCircular3d({axis: [0,0, 1], center: [-20, -20, -20], repetitions: 4, arcDegrees: 360, rotateDuplicates: false}, part001) 

"#;

    let result = execute_and_snapshot(code, UnitLength::Mm).await.unwrap();
    twenty_twenty::assert_image(
        "tests/executor/outputs/circular_pattern3d_chamfered_sketch.png",
        &result,
        MIN_DIFF,
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn serial_test_tag_chamfer_with_more_than_one_edge_should_fail() {
    let code = r#"fn cube = (pos, scale) => {
  const sg = startSketchOn('XY')
    |> startProfileAt(pos, %)
    |> line([0, scale], %)
    |> line([scale, 0], %)
    |> line([0, -scale], %)

  return sg
}
const part001 = cube([0,0], 20)
    |> close(%, 'line1')
    |> extrude(20, %)
  |> chamfer({
    length: 10,
    tags: ['line1', getOppositeEdge('line1',%)]
  }, %, 'chamfer1')


"#;

    let result = execute_and_snapshot(code, UnitLength::Mm).await;
    assert!(result.is_err());
    assert_eq!(
        result.err().unwrap().to_string(),
        r#"type: KclErrorDetails { source_ranges: [SourceRange([272, 365])], message: "You can only tag one edge at a time with a tagged chamfer. Either delete the tag for the chamfer fn if you don't need it OR separate into individual chamfer functions for each tag." }"#
    );
}

#[tokio::test(flavor = "multi_thread")]
#[ignore] // Ignore until this is fixed in the engine: https://github.com/KittyCAD/engine/issues/2260
async fn serial_test_sketch_on_face_of_chamfer() {
    let code = r#"fn cube = (pos, scale) => {
  const sg = startSketchOn('XY')
    |> startProfileAt(pos, %)
    |> line([0, scale], %)
    |> line([scale, 0], %)
    |> line([0, -scale], %)

  return sg
}
const part001 = cube([0,0], 20)
    |> close(%, 'line1')
    |> extrude(20, %)
  |> chamfer({
    length: 10,
    tags: [getOppositeEdge('line1',%)]
  }, %, 'chamfer1')

const sketch001 = startSketchOn(part001, 'chamfer1')
    |> startProfileAt([4.28, 3.83], %)
    |> line([2.17, -0.03], %)
    |> line([-0.07, -1.8], %)
    |> line([-2.07, 0.05], %)
    |> lineTo([profileStartX(%), profileStartY(%)], %)
    |> close(%)
    |> extrude(10, %)
"#;

    let result = execute_and_snapshot(code, UnitLength::Mm).await.unwrap();
    twenty_twenty::assert_image(
        "tests/executor/outputs/sketch_on_face_of_chamfer.png",
        &result,
        MIN_DIFF,
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn serial_test_duplicate_tags_should_error() {
    let code = r#"fn triangle = (len) => {
  return startSketchOn('XY')
  |> startProfileAt([-len / 2, -len / 2], %)
  |> angledLine({ angle: 0, length: len }, %, $a)
  |> angledLine({
       angle: segAng(a, %) + 120,
       length: len
     }, %, $b)
  |> angledLine({
       angle: segAng(b, %) + 120,
       length: len
     }, %, $a)
}

let p = triangle(200)
"#;

    let result = execute_and_snapshot(code, UnitLength::Mm).await;
    assert!(result.is_err());
    assert_eq!(
        result.err().unwrap().to_string(),
        r#"value already defined: KclErrorDetails { source_ranges: [SourceRange([317, 319]), SourceRange([332, 345])], message: "Cannot redefine `a`" }"#
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn serial_test_global_tags() {
    let code = include_str!("inputs/global-tags.kcl");
    let result = execute_and_snapshot(code, UnitLength::Mm).await.unwrap();
    twenty_twenty::assert_image("tests/executor/outputs/global_tags.png", &result, MIN_DIFF);
}

#[tokio::test(flavor = "multi_thread")]
async fn serial_test_pattern_vase() {
    let code = include_str!("inputs/pattern_vase.kcl");
    let result = execute_and_snapshot(code, UnitLength::Mm).await.unwrap();
    twenty_twenty::assert_image("tests/executor/outputs/pattern_vase.png", &result, MIN_DIFF);
}

#[tokio::test(flavor = "multi_thread")]
async fn serial_test_scoped_tags() {
    let code = include_str!("inputs/scoped-tags.kcl");
    let result = execute_and_snapshot(code, UnitLength::Mm).await.unwrap();
    twenty_twenty::assert_image("tests/executor/outputs/scoped_tags.png", &result, MIN_DIFF);
}

#[tokio::test(flavor = "multi_thread")]
async fn serial_test_order_sketch_extrude_in_order() {
    let code = include_str!("inputs/order-sketch-extrude-in-order.kcl");
    let result = execute_and_snapshot(code, UnitLength::Mm).await.unwrap();
    twenty_twenty::assert_image(
        "tests/executor/outputs/order-sketch-extrude-in-order.png",
        &result,
        MIN_DIFF,
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn serial_test_order_sketch_extrude_out_of_order() {
    let code = include_str!("inputs/order-sketch-extrude-out-of-order.kcl");
    let result = execute_and_snapshot(code, UnitLength::Mm).await.unwrap();
    twenty_twenty::assert_image(
        "tests/executor/outputs/order-sketch-extrude-out-of-order.png",
        &result,
        MIN_DIFF,
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn serial_test_extrude_custom_plane() {
    let code = include_str!("inputs/extrude-custom-plane.kcl");
    let result = execute_and_snapshot(code, UnitLength::Mm).await.unwrap();
    twenty_twenty::assert_image("tests/executor/outputs/extrude-custom-plane.png", &result, MIN_DIFF);
}
