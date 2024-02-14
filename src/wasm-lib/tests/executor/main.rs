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
        .connection_verbose(true)
        .tcp_keepalive(std::time::Duration::from_secs(600))
        .http1_only();

    let token = std::env::var("KITTYCAD_API_TOKEN").expect("KITTYCAD_API_TOKEN not set");

    // Create the client.
    let mut client = kittycad::Client::new_from_reqwest(token, http_client, ws_client);
    // uncomment to use a local server
    client.set_base_url("http://system76-pc:8080/");

    let ws = client
        .modeling()
        .commands_ws(None, None, None, None, Some(false))
        .await?;

    // Create a temporary file to write the output to.
    let output_file = std::env::temp_dir().join(format!("kcl_output_{}.png", uuid::Uuid::new_v4()));

    let tokens = kcl_lib::token::lexer(code);
    let parser = kcl_lib::parser::Parser::new(tokens);
    let program = parser.ast()?;
    let mut mem: kcl_lib::executor::ProgramMemory = Default::default();
    let ctx = kcl_lib::executor::ExecutorContext::new(ws).await?;
    let _ = kcl_lib::executor::execute(program, &mut mem, kcl_lib::executor::BodyType::Root, &ctx).await?;

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
  |> line({to: [28.67, -13.25], tag: "here"}, %)
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

    let result = execute_and_snapshot(code).await.unwrap();
    twenty_twenty::assert_image("tests/executor/outputs/sketch_on_face.png", &result, 0.999);
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

    let result = execute_and_snapshot(code).await.unwrap();
    twenty_twenty::assert_image("tests/executor/outputs/sketch_on_face_start.png", &result, 0.999);
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

    let result = execute_and_snapshot(code).await.unwrap();
    twenty_twenty::assert_image("tests/executor/outputs/sketch_on_face_end.png", &result, 0.999);
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

show(fnBox)"#;

    let result = execute_and_snapshot(code).await.unwrap();
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

show(box([0,0], 3, 6, 10))"#;

    let result = execute_and_snapshot(code).await.unwrap();
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
  |> line({ to: [3.15, -9.85], tag: 'seg01' }, %)
  |> line([-15.17, -4.1], %)
  |> angledLine([segAng('seg01', %), 12.35], %)
  |> line([-13.02, 10.03], %)
  |> close(%)
  |> extrude(4, %)

show(part001)"#;

    let result = execute_and_snapshot(code).await.unwrap();
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

show(bracket)"#;

    let result = execute_and_snapshot(code).await.unwrap();
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

show(bracket)"#;

    let result = execute_and_snapshot(code).await.unwrap();
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

    let result = execute_and_snapshot(code).await;
    assert!(result.is_err());
    assert_eq!(
        result.err().unwrap().to_string(),
        r#"engine: KclErrorDetails { source_ranges: [SourceRange([222, 235])], message: "Modeling command failed: Some([ApiError { error_code: BadRequest, message: \"The path is not closed.  Solid2D construction requires a closed path!\" }])" }"#,
    );
}

#[tokio::test(flavor = "multi_thread")]
#[ignore] // ignore until more stack fixes
async fn serial_test_execute_pipes_on_pipes() {
    let code = include_str!("inputs/pipes_on_pipes.kcl");

    let result = execute_and_snapshot(code).await.unwrap();
    twenty_twenty::assert_image("tests/executor/outputs/pipes_on_pipes.png", &result, 0.999);
}

#[tokio::test(flavor = "multi_thread")]
async fn serial_test_execute_cylinder() {
    let code = include_str!("inputs/cylinder.kcl");

    let result = execute_and_snapshot(code).await.unwrap();
    twenty_twenty::assert_image("tests/executor/outputs/cylinder.png", &result, 0.999);
}

#[tokio::test(flavor = "multi_thread")]
#[ignore = "currently stack overflows"]
async fn serial_test_execute_kittycad_svg() {
    let code = include_str!("inputs/kittycad_svg.kcl");

    let result = execute_and_snapshot(code).await.unwrap();
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

show(b1)
show(b2)"#;

    let result = execute_and_snapshot(code).await.unwrap();
    twenty_twenty::assert_image(
        "tests/executor/outputs/member_expression_sketch_group.png",
        &result,
        1.0,
    );
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

show(body)"#;

    let result = execute_and_snapshot(code).await.unwrap();
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

    let result = execute_and_snapshot(code).await.unwrap();
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

    let result = execute_and_snapshot(code).await.unwrap();
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

    let result = execute_and_snapshot(code).await.unwrap();
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

    let result = execute_and_snapshot(code).await.unwrap();
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

    let result = execute_and_snapshot(code).await.unwrap();
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

show(bracket)
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

    let result = execute_and_snapshot(code).await.unwrap();
    twenty_twenty::assert_image("tests/executor/outputs/lots_of_planes.png", &result, 0.999);
}

#[tokio::test(flavor = "multi_thread")]
async fn serial_test_holes() {
    let code = r#"fn circle = (pos, radius) => {
    const sg = startSketchOn('XY')
      |> startProfileAt(pos, %)
      |> arc({angle_end: 360, angle_start: 0, radius: radius}, %)
      |> close(%)

    return sg
}

const square = startSketchOn('XY')
  |> startProfileAt([0, 0], %)
  |> line([0, 10], %)
  |> line([10, 0], %)
  |> line([0, -10], %)
  |> close(%)
  |> hole(circle([2, 2], .5), %)
  |> hole(circle([2, 8], .5), %)
  |> extrude(2, %)

show(square)
"#;

    let result = execute_and_snapshot(code).await.unwrap();
    twenty_twenty::assert_image("tests/executor/outputs/holes.png", &result, 0.999);
}

#[tokio::test(flavor = "multi_thread")]
async fn optional_params() {
    let code = r#"
    fn circle = (pos, radius, tag?) => {
      const sg = startSketchOn('XY')
        |> startProfileAt(pos, %)
        |> arc({angle_end: 360, angle_start: 0, radius: radius}, %)
        |> close(%)

      return sg
  }

  show(circle([2, 2], 20))
"#;
    let result = execute_and_snapshot(code).await.unwrap();
    twenty_twenty::assert_image("tests/executor/outputs/optional_params.png", &result, 0.999);
}

#[tokio::test(flavor = "multi_thread")]
async fn serial_test_rounded_with_holes() {
    let code = r#"fn circle = (pos, radius) => {
  const sg = startSketchOn('XY')
    |> startProfileAt([pos[0] + radius, pos[1]], %)
    |> arc({
       angle_end: 360,
       angle_start: 0,
       radius: radius
     }, %)
    |> close(%)
  return sg
}

fn tarc = (to, sketchGroup, tag?) => {
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
  |> hole(circle([-holeIndex, holeIndex], holeRadius), %)
  |> hole(circle([holeIndex, holeIndex], holeRadius), %)
  |> hole(circle([-holeIndex, -holeIndex], holeRadius), %)
  |> hole(circle([holeIndex, -holeIndex], holeRadius), %)
  |> extrude(2, %)

show(part)"#;

    let result = execute_and_snapshot(code).await.unwrap();
    twenty_twenty::assert_image("tests/executor/outputs/rounded_with_holes.png", &result, 0.999);
}

#[tokio::test(flavor = "multi_thread")]
async fn serial_test_top_level_expression() {
    let code = r#"fn circle = (pos, radius) => {
  const sg = startSketchOn('XY')
    |> startProfileAt([pos[0] + radius, pos[1]], %)
    |> arc({
       angle_end: 360,
       angle_start: 0,
       radius: radius
     }, %)
    |> close(%)
  return sg
}

circle([0,0], 22) |> extrude(14, %)"#;

    let result = execute_and_snapshot(code).await.unwrap();
    twenty_twenty::assert_image("tests/executor/outputs/top_level_expression.png", &result, 0.999);
}

#[tokio::test(flavor = "multi_thread")]
async fn serial_test_patterns_linear_basic() {
    let code = r#"fn circle = (pos, radius) => {
  const sg = startSketchOn('XY')
    |> startProfileAt([pos[0] + radius, pos[1]], %)
    |> arc({
       angle_end: 360,
       angle_start: 0,
       radius: radius
     }, %)
    |> close(%)
  return sg
}

const part = circle([0,0], 2)
    |> patternLinear({axis: [0,0,1], repetitions: 12, distance: 2}, %)
"#;

    let result = execute_and_snapshot(code).await.unwrap();
    twenty_twenty::assert_image("tests/executor/outputs/patterns_linear_basic.png", &result, 0.999);
}

#[tokio::test(flavor = "multi_thread")]
async fn serial_test_patterns_linear_basic_3d() {
    let code = r#"fn circle = (pos, radius) => {
  const sg = startSketchOn('XY')
    |> startProfileAt([pos[0] + radius, pos[1]], %)
    |> arc({
       angle_end: 360,
       angle_start: 0,
       radius: radius
     }, %)
    |> close(%)
  return sg
}

const part = startSketchOn('XY')
    |> startProfileAt([0, 0], %)
    |> line([0,1], %)
    |> line([1, 0], %)
    |> line([0, -1], %)
    |> close(%)
    |> extrude(1, %)
    |> patternLinear({axis: [1, 0,1], repetitions: 3, distance: 6}, %)
"#;

    let result = execute_and_snapshot(code).await.unwrap();
    twenty_twenty::assert_image("tests/executor/outputs/patterns_linear_basic_3d.png", &result, 0.999);
}

#[tokio::test(flavor = "multi_thread")]
async fn serial_test_patterns_linear_basic_negative_distance() {
    let code = r#"fn circle = (pos, radius) => {
  const sg = startSketchOn('XY')
    |> startProfileAt([pos[0] + radius, pos[1]], %)
    |> arc({
       angle_end: 360,
       angle_start: 0,
       radius: radius
     }, %)
    |> close(%)
  return sg
}

const part = circle([0,0], 2)
    |> patternLinear({axis: [0,0,1], repetitions: 12, distance: -2}, %)
"#;

    let result = execute_and_snapshot(code).await.unwrap();
    twenty_twenty::assert_image(
        "tests/executor/outputs/patterns_linear_basic_negative_distance.png",
        &result,
        0.999,
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn serial_test_patterns_linear_basic_negative_axis() {
    let code = r#"fn circle = (pos, radius) => {
  const sg = startSketchOn('XY')
    |> startProfileAt([pos[0] + radius, pos[1]], %)
    |> arc({
       angle_end: 360,
       angle_start: 0,
       radius: radius
     }, %)
    |> close(%)
  return sg
}

const part = circle([0,0], 2)
    |> patternLinear({axis: [0,0,-1], repetitions: 12, distance: 2}, %)
"#;

    let result = execute_and_snapshot(code).await.unwrap();
    twenty_twenty::assert_image(
        "tests/executor/outputs/patterns_linear_basic_negative_axis.png",
        &result,
        0.999,
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn serial_test_patterns_linear_basic_holes() {
    let code = r#"fn circle = (pos, radius) => {
  const sg = startSketchOn('XY')
    |> startProfileAt([pos[0] + radius, pos[1]], %)
    |> arc({
       angle_end: 360,
       angle_start: 0,
       radius: radius
     }, %)
    |> close(%)
  return sg
}

const circles = circle([5, 5], 1)
    |> patternLinear({axis: [1,1,0], repetitions: 12, distance: 3}, %)

const rectangle = startSketchOn('XY')
  |> startProfileAt([0, 0], %)
  |> line([0, 50], %)
  |> line([50, 0], %)
  |> line([0, -50], %)
  |> close(%)
  |> hole(circles, %)

"#;

    let result = execute_and_snapshot(code).await.unwrap();
    twenty_twenty::assert_image("tests/executor/outputs/patterns_linear_basic_holes.png", &result, 0.999);
}

#[tokio::test(flavor = "multi_thread")]
async fn serial_test_patterns_circular_basic_2d() {
    let code = r#"fn circle = (pos, radius) => {
  const sg = startSketchOn('XY')
    |> startProfileAt([pos[0] + radius, pos[1]], %)
    |> arc({
       angle_end: 360,
       angle_start: 0,
       radius: radius
     }, %)
    |> close(%)
  return sg
}

const part = circle([0,0], 2)
    |> patternCircular({axis: [0,0,1], center: [20, 20, 20], repetitions: 12, arcDegrees: 210, rotateDuplicates: true}, %)
"#;

    let result = execute_and_snapshot(code).await.unwrap();
    twenty_twenty::assert_image("tests/executor/outputs/patterns_circular_basic_2d.png", &result, 0.999);
}

#[tokio::test(flavor = "multi_thread")]
async fn serial_test_patterns_circular_basic_3d() {
    let code = r#"fn circle = (pos, radius) => {
  const sg = startSketchOn('XY')
    |> startProfileAt([pos[0] + radius, pos[1]], %)
    |> arc({
       angle_end: 360,
       angle_start: 0,
       radius: radius
     }, %)
    |> close(%)
  return sg
}

const part = startSketchOn('XY')
    |> startProfileAt([0, 0], %)
    |> line([0,1], %)
    |> line([1, 0], %)
    |> line([0, -1], %)
    |> close(%)
    |> extrude(1, %)
    |> patternCircular({axis: [0,1,0], center: [-20, -20, -20], repetitions: 40, arcDegrees: 360, rotateDuplicates: false}, %)
"#;

    let result = execute_and_snapshot(code).await.unwrap();
    twenty_twenty::assert_image("tests/executor/outputs/patterns_circular_basic_3d.png", &result, 0.999);
}

#[tokio::test(flavor = "multi_thread")]
async fn serial_test_patterns_circular_3d_tilted_axis() {
    let code = r#"fn circle = (pos, radius) => {
  const sg = startSketchOn('XY')
    |> startProfileAt([pos[0] + radius, pos[1]], %)
    |> arc({
       angle_end: 360,
       angle_start: 0,
       radius: radius
     }, %)
    |> close(%)
  return sg
}

const part = startSketchOn('XY')
    |> startProfileAt([0, 0], %)
    |> line([0,1], %)
    |> line([1, 0], %)
    |> line([0, -1], %)
    |> close(%)
    |> extrude(1, %)
    |> patternCircular({axis: [1,1,-1], center: [10, 0, 10], repetitions: 10, arcDegrees: 360, rotateDuplicates: true}, %)
"#;

    let result = execute_and_snapshot(code).await.unwrap();
    twenty_twenty::assert_image(
        "tests/executor/outputs/patterns_circular_3d_tilted_axis.png",
        &result,
        0.999,
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn serial_test_import_file_doesnt_exist() {
    let code = r#"const model = import("thing.obj")"#;

    let result = execute_and_snapshot(code).await;
    assert!(result.is_err());
    assert_eq!(
        result.err().unwrap().to_string(),
        r#"semantic: KclErrorDetails { source_ranges: [SourceRange([14, 33])], message: "File `thing.obj` does not exist." }"#
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn serial_test_import_obj_with_mtl() {
    let code = r#"const model = import("tests/executor/inputs/cube.obj")"#;

    let result = execute_and_snapshot(code).await.unwrap();
    twenty_twenty::assert_image("tests/executor/outputs/import_obj_with_mtl.png", &result, 0.999);
}

#[tokio::test(flavor = "multi_thread")]
async fn serial_test_import_obj_with_mtl_units() {
    let code = r#"const model = import("tests/executor/inputs/cube.obj", {type: "obj", units: "m"})"#;

    let result = execute_and_snapshot(code).await.unwrap();
    twenty_twenty::assert_image("tests/executor/outputs/import_obj_with_mtl_units.png", &result, 0.999);
}

#[tokio::test(flavor = "multi_thread")]
async fn serial_test_import_gltf_with_bin() {
    let code = r#"const model = import("tests/executor/inputs/cube.gltf")"#;

    let result = execute_and_snapshot(code).await.unwrap();
    twenty_twenty::assert_image("tests/executor/outputs/import_gltf_with_bin.png", &result, 0.999);
}

#[tokio::test(flavor = "multi_thread")]
async fn serial_test_import_gltf_embedded() {
    let code = r#"const model = import("tests/executor/inputs/cube-embedded.gltf")"#;

    let result = execute_and_snapshot(code).await.unwrap();
    twenty_twenty::assert_image("tests/executor/outputs/import_gltf_embedded.png", &result, 0.999);
}

#[tokio::test(flavor = "multi_thread")]
async fn serial_test_import_glb() {
    let code = r#"const model = import("tests/executor/inputs/cube.glb")"#;

    let result = execute_and_snapshot(code).await.unwrap();
    twenty_twenty::assert_image("tests/executor/outputs/import_glb.png", &result, 0.999);
}

#[tokio::test(flavor = "multi_thread")]
async fn serial_test_import_glb_no_assign() {
    let code = r#"import("tests/executor/inputs/cube.glb")"#;

    let result = execute_and_snapshot(code).await.unwrap();
    twenty_twenty::assert_image("tests/executor/outputs/import_glb_no_assign.png", &result, 0.999);
}

#[tokio::test(flavor = "multi_thread")]
async fn serial_test_import_ext_doesnt_match() {
    let code = r#"const model = import("tests/executor/inputs/cube.gltf", {type: "obj", units: "m"})"#;

    let result = execute_and_snapshot(code).await;
    assert!(result.is_err());
    assert_eq!(
        result.err().unwrap().to_string(),
        r#"semantic: KclErrorDetails { source_ranges: [SourceRange([14, 82])], message: "The given format does not match the file extension. Expected: `gltf`, Given: `obj`" }"#
    );
}
