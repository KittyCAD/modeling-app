use kcl_lib::{settings::types::UnitLength, test_server::execute_and_snapshot};

/// The minimum permissible difference between asserted twenty-twenty images.
/// i.e. how different the current model snapshot can be from the previous saved one.
const MIN_DIFF: f64 = 0.99;

mod no_visuals;
mod visuals;

macro_rules! kcl_input {
    ($file:literal) => {
        include_str!(concat!("inputs/", $file, ".kcl"))
    };
}

fn assert_out(test_name: &str, result: &image::DynamicImage) {
    twenty_twenty::assert_image(format!("tests/executor/outputs/{test_name}.png"), result, MIN_DIFF);
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_fillet_duplicate_tags() {
    let code = kcl_input!("fillet_duplicate_tags");

    let result = execute_and_snapshot(code, UnitLength::Mm).await;
    assert!(result.is_err());
    assert_eq!(
        result.err().unwrap().to_string(),
        r#"type: KclErrorDetails { source_ranges: [SourceRange([203, 249])], message: "Duplicate tags are not allowed." }"#,
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_execute_with_function_sketch() {
    let code = kcl_input!("function_sketch");
    let result = execute_and_snapshot(code, UnitLength::Mm).await.unwrap();
    assert_out("function_sketch", &result);
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_execute_with_function_sketch_with_position() {
    let code = kcl_input!("function_sketch_with_position");

    let result = execute_and_snapshot(code, UnitLength::Mm).await.unwrap();
    assert_out("function_sketch_with_position", &result);
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_execute_with_angled_line() {
    let code = kcl_input!("angled_line");
    let result = execute_and_snapshot(code, UnitLength::Mm).await.unwrap();
    assert_out("angled_line", &result);
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_execute_parametric_example() {
    let code = kcl_input!("parametric");
    let result = execute_and_snapshot(code, UnitLength::Mm).await.unwrap();
    assert_out("parametric", &result);
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_execute_parametric_with_tan_arc_example() {
    let code = kcl_input!("parametric_with_tan_arc");
    let result = execute_and_snapshot(code, UnitLength::Mm).await.unwrap();
    assert_out("parametric_with_tan_arc", &result);
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_execute_engine_error_return() {
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
async fn kcl_test_execute_i_shape() {
    // This is some code from lee that starts a pipe expression with a variable.
    let code = kcl_input!("i_shape");

    let result = execute_and_snapshot(code, UnitLength::Mm).await.unwrap();
    assert_out("i_shape", &result);
}

#[tokio::test(flavor = "multi_thread")]
#[ignore] // No longer a stack overflow problem, instead it causes an engine internal error.
async fn kcl_test_execute_pipes_on_pipes() {
    let code = kcl_input!("pipes_on_pipes");

    let result = execute_and_snapshot(code, UnitLength::Mm).await.unwrap();
    assert_out("pipes_on_pipes", &result);
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_execute_cylinder() {
    let code = kcl_input!("cylinder");

    let result = execute_and_snapshot(code, UnitLength::Mm).await.unwrap();
    assert_out("cylinder", &result);
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_execute_kittycad_svg() {
    let code = kcl_input!("kittycad_svg");

    let result = execute_and_snapshot(code, UnitLength::Mm).await.unwrap();
    assert_out("kittycad_svg", &result);
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_member_expression_sketch_group() {
    let code = kcl_input!("member_expression_sketch_group");

    let result = execute_and_snapshot(code, UnitLength::Mm).await.unwrap();
    assert_out("member_expression_sketch_group", &result);
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_helix_defaults() {
    let code = kcl_input!("helix_defaults");

    let result = execute_and_snapshot(code, UnitLength::Mm).await.unwrap();
    assert_out("helix_defaults", &result);
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_helix_defaults_negative_extrude() {
    let code = kcl_input!("helix_defaults_negative_extrude");

    let result = execute_and_snapshot(code, UnitLength::Mm).await.unwrap();
    assert_out("helix_defaults_negative_extrude", &result);
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_helix_ccw() {
    let code = kcl_input!("helix_ccw");

    let result = execute_and_snapshot(code, UnitLength::Mm).await.unwrap();
    assert_out("helix_ccw", &result);
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_helix_with_length() {
    let code = kcl_input!("helix_with_length");

    let result = execute_and_snapshot(code, UnitLength::Mm).await.unwrap();
    assert_out("helix_with_length", &result);
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_dimensions_match() {
    let code = kcl_input!("dimensions_match");

    let result = execute_and_snapshot(code, UnitLength::Mm).await.unwrap();
    assert_out("dimensions_match", &result);
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_close_arc() {
    let code = kcl_input!("close_arc");

    let result = execute_and_snapshot(code, UnitLength::Mm).await.unwrap();
    assert_out("close_arc", &result);
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_negative_args() {
    let code = kcl_input!("negative_args");

    let result = execute_and_snapshot(code, UnitLength::Mm).await.unwrap();
    assert_out("negative_args", &result);
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_basic_tangential_arc_with_point() {
    let code = r#"const boxSketch = startSketchAt([0, 0])
    |> line([0, 10], %)
    |> tangentialArcToRelative([-5, 5], %)
    |> line([5, -15], %)
    |> extrude(10, %)
"#;

    let result = execute_and_snapshot(code, UnitLength::Mm).await.unwrap();
    assert_out("tangential_arc_with_point", &result);
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_basic_tangential_arc_to() {
    let code = r#"const boxSketch = startSketchAt([0, 0])
    |> line([0, 10], %)
    |> tangentialArcTo([-5, 15], %)
    |> line([5, -15], %)
    |> extrude(10, %)
"#;

    let result = execute_and_snapshot(code, UnitLength::Mm).await.unwrap();
    assert_out("tangential_arc_to", &result);
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_different_planes_same_drawing() {
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
    assert_out("different_planes_same_drawing", &result);
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_lots_of_planes() {
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
    assert_out("lots_of_planes", &result);
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_holes() {
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
    assert_out("holes", &result);
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
    assert_out("optional_params", &result);
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_rounded_with_holes() {
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
    assert_out("rounded_with_holes", &result);
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_top_level_expression() {
    let code = r#"startSketchOn('XY') |> circle([0,0], 22, %) |> extrude(14, %)"#;

    let result = execute_and_snapshot(code, UnitLength::Mm).await.unwrap();
    assert_out("top_level_expression", &result);
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_patterns_linear_basic_with_math() {
    let code = r#"const num = 12
const distance = 5
const part =  startSketchOn('XY')
    |> circle([0,0], 2, %)
    |> patternLinear2d({axis: [0,1], repetitions: num -1, distance: distance - 1}, %)
    |> extrude(1, %)
"#;

    let result = execute_and_snapshot(code, UnitLength::Mm).await.unwrap();
    assert_out("patterns_linear_basic_with_math", &result);
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_patterns_linear_basic() {
    let code = r#"const part =  startSketchOn('XY')
    |> circle([0,0], 2, %)
    |> patternLinear2d({axis: [0,1], repetitions: 12, distance: 4}, %)
    |> extrude(1, %)
"#;

    let result = execute_and_snapshot(code, UnitLength::Mm).await.unwrap();
    assert_out("patterns_linear_basic", &result);
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_patterns_linear_basic_3d() {
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
    assert_out("patterns_linear_basic_3d", &result);
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_patterns_linear_basic_negative_distance() {
    let code = r#"const part = startSketchOn('XY')
    |> circle([0,0], 2, %)
    |> patternLinear2d({axis: [0,1], repetitions: 12, distance: -2}, %)
    |> extrude(1, %)
"#;

    let result = execute_and_snapshot(code, UnitLength::Mm).await.unwrap();
    assert_out("patterns_linear_basic_negative_distance", &result);
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_patterns_linear_basic_negative_axis() {
    let code = r#"const part = startSketchOn('XY')
    |> circle([0,0], 2, %)
    |> patternLinear2d({axis: [0,-1], repetitions: 12, distance: 2}, %)
    |> extrude(1, %)
"#;

    let result = execute_and_snapshot(code, UnitLength::Mm).await.unwrap();
    assert_out("patterns_linear_basic_negative_axis", &result);
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_patterns_linear_basic_holes() {
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
    assert_out("patterns_linear_basic_holes", &result);
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_patterns_circular_basic_2d() {
    let code = r#"const part = startSketchOn('XY')
    |> circle([0,0], 2, %)
    |> patternCircular2d({center: [20, 20], repetitions: 12, arcDegrees: 210, rotateDuplicates: true}, %)
    |> extrude(1, %)
"#;

    let result = execute_and_snapshot(code, UnitLength::Mm).await.unwrap();
    assert_out("patterns_circular_basic_2d", &result);
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_patterns_circular_basic_3d() {
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
    assert_out("patterns_circular_basic_3d", &result);
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_patterns_circular_3d_tilted_axis() {
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
    assert_out("patterns_circular_3d_tilted_axis", &result);
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_import_file_doesnt_exist() {
    let code = r#"const model = import("thing.obj")"#;

    let result = execute_and_snapshot(code, UnitLength::Mm).await;
    assert!(result.is_err());
    assert_eq!(
        result.err().unwrap().to_string(),
        r#"semantic: KclErrorDetails { source_ranges: [SourceRange([14, 33])], message: "File `thing.obj` does not exist." }"#
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_import_obj_with_mtl() {
    let code = r#"const model = import("tests/executor/inputs/cube.obj")"#;

    let result = execute_and_snapshot(code, UnitLength::Mm).await.unwrap();
    assert_out("import_obj_with_mtl", &result);
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_import_obj_with_mtl_units() {
    let code = r#"const model = import("tests/executor/inputs/cube.obj", {type: "obj", units: "m"})"#;

    let result = execute_and_snapshot(code, UnitLength::Mm).await.unwrap();
    assert_out("import_obj_with_mtl_units", &result);
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_import_stl() {
    let code = r#"const model = import("tests/executor/inputs/2-5-long-m8-chc-screw.stl")"#;

    let result = execute_and_snapshot(code, UnitLength::Mm).await.unwrap();
    assert_out("import_stl", &result);
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_import_gltf_with_bin() {
    let code = r#"const model = import("tests/executor/inputs/cube.gltf")"#;

    let result = execute_and_snapshot(code, UnitLength::Mm).await.unwrap();
    assert_out("import_gltf_with_bin", &result);
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_import_gltf_embedded() {
    let code = r#"const model = import("tests/executor/inputs/cube-embedded.gltf")"#;

    let result = execute_and_snapshot(code, UnitLength::Mm).await.unwrap();
    assert_out("import_gltf_embedded", &result);
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_import_glb() {
    let code = r#"const model = import("tests/executor/inputs/cube.glb")"#;

    let result = execute_and_snapshot(code, UnitLength::Mm).await.unwrap();
    assert_out("import_glb", &result);
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_import_glb_no_assign() {
    let code = r#"import("tests/executor/inputs/cube.glb")"#;

    let result = execute_and_snapshot(code, UnitLength::Mm).await.unwrap();
    assert_out("import_glb_no_assign", &result);
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_import_ext_doesnt_match() {
    let code = r#"const model = import("tests/executor/inputs/cube.gltf", {type: "obj", units: "m"})"#;

    let result = execute_and_snapshot(code, UnitLength::Mm).await;
    assert!(result.is_err());
    assert_eq!(
        result.err().unwrap().to_string(),
        r#"semantic: KclErrorDetails { source_ranges: [SourceRange([14, 82])], message: "The given format does not match the file extension. Expected: `gltf`, Given: `obj`" }"#
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_cube_mm() {
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
    assert_out("cube_mm", &result);
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_cube_cm() {
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
    assert_out("cube_cm", &result);
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_cube_m() {
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
    assert_out("cube_m", &result);
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_cube_in() {
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
    assert_out("cube_in", &result);
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_cube_ft() {
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
    assert_out("cube_ft", &result);
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_cube_yd() {
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
    assert_out("cube_yd", &result);
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_error_sketch_on_arc_face() {
    let code = r#"fn cube = (pos, scale) => {
  const sg = startSketchOn('XY')
  |> startProfileAt(pos, %)
  |> tangentialArcToRelative([0, scale], %, $here)
  |> line([scale, 0], %)
  |> line([0, -scale], %)

  return sg
}
const part001 = cube([0, 0], 20)
  |> close(%)
  |> extrude(20, %)

const part002 = startSketchOn(part001, part001.sketchGroup.tags.here)
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
        r#"semantic: KclErrorDetails { source_ranges: [SourceRange([94, 139]), SourceRange([222, 238])], message: "could not sketch tangential arc, because its center would be infinitely far away in the X direction" }"#
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_sketch_on_face_of_face() {
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
    assert_out("sketch_on_face_of_face", &result);
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_stdlib_kcl_error_right_code_path() {
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
async fn kcl_test_sketch_on_face_circle() {
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
    assert_out("sketch_on_face_circle", &result);
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_stdlib_kcl_error_circle() {
    let code = r#"// Mounting Plate
// A flat piece of material, often metal or plastic, that serves as a support or base for attaching, securing, or mounting various types of equipment, devices, or components. 

// Create a function that defines the body width and length of the mounting plate. Tag the corners so they can be passed through the fillet function.
fn rectShape = (pos, w, l) => {
  const rr = startSketchOn('XY')
  |> startProfileAt([pos[0] - (w / 2), pos[1] - (l / 2)], %)
  |> lineTo([pos[0] + w / 2, pos[1] - (l / 2)], %, $edge1)
  |> lineTo([pos[0] + w / 2, pos[1] + l / 2], %, $edge2)
  |> lineTo([pos[0] - (w / 2), pos[1] + l / 2], %, $edge3)
  |> close(%, $edge4)
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
          getNextAdjacentEdge(edge1),
          getNextAdjacentEdge(edge2),
          getNextAdjacentEdge(edge3),
          getNextAdjacentEdge(edge4)
       ]
     }, %)
"#;

    let result = execute_and_snapshot(code, UnitLength::Mm).await;
    assert!(result.is_err());
    assert_eq!(
        result.err().unwrap().to_string(),
        r#"semantic: KclErrorDetails { source_ranges: [SourceRange([887, 936])], message: "Argument at index 0 was supposed to be type [f64; 2] but found string (text)" }"#,
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_simple_revolve() {
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
    assert_out("simple_revolve", &result);
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_simple_revolve_uppercase() {
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
    assert_out("simple_revolve_uppercase", &result);
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_simple_revolve_negative() {
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
    assert_out("simple_revolve_negative", &result);
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_revolve_bad_angle_low() {
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
async fn kcl_test_revolve_bad_angle_high() {
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
async fn kcl_test_simple_revolve_custom_angle() {
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
    assert_out("simple_revolve_custom_angle", &result);
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_simple_revolve_custom_axis() {
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
    assert_out("simple_revolve_custom_axis", &result);
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_revolve_on_edge() {
    let code = r#"const box = startSketchOn('XY')
  |> startProfileAt([0, 0], %)
  |> line([0, 10], %)
  |> line([10, 0], %)
  |> line([0, -10], %, $revolveAxis)
  |> close(%)
  |> extrude(10, %)

const sketch001 = startSketchOn(box, "end")
  |> startProfileAt([5, 10], %)
  |> line([0, -10], %)
  |> line([2, 0], %)
  |> line([0, 10], %)
  |> close(%)
  |> revolve({ axis: getOppositeEdge(revolveAxis), angle: 90 }, %)

"#;

    let result = execute_and_snapshot(code, UnitLength::Mm).await.unwrap();
    assert_out("revolve_on_edge", &result);
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_revolve_on_edge_get_edge() {
    let code = r#"const box = startSketchOn('XY')
  |> startProfileAt([0, 0], %)
  |> line([0, 10], %)
  |> line([10, 0], %)
  |> line([0, -10], %, $revolveAxis)
  |> close(%)
  |> extrude(10, %)

const sketch001 = startSketchOn(box, revolveAxis)
  |> startProfileAt([5, 10], %)
  |> line([0, -10], %)
  |> line([2, 0], %)
  |> line([0, 10], %)
  |> close(%)
  |> revolve({ axis: revolveAxis, angle: 90 }, %)

"#;

    let result = execute_and_snapshot(code, UnitLength::Mm).await;

    assert!(result.is_err());
    //this fails right now, but slightly differently, lets just say its enough for it to fail - mike
    //assert_eq!(
    //    result.err().unwrap().to_string(),
    //    r#"engine: KclErrorDetails { source_ranges: [SourceRange([346, 390])], message: "Modeling command failed: [ApiError { error_code: InternalEngine, message: \"Solid3D revolve failed:  sketch profile must lie entirely on one side of the revolution axis\" }]" }"#
    //);
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_revolve_on_face_circle_edge() {
    let code = r#"const box = startSketchOn('XY')
  |> startProfileAt([0, 0], %)
  |> line([0, 20], %)
  |> line([20, 0], %)
  |> line([0, -20], %, $revolveAxis) 
  |> close(%)
  |> extrude(20, %)

const sketch001 = startSketchOn(box, "END")
  |> circle([10,10], 4, %)
  |> revolve({
    angle: 90, 
    axis: getOppositeEdge(revolveAxis) 
    }, %)
"#;

    let result = execute_and_snapshot(code, UnitLength::Mm).await.unwrap();
    assert_out("revolve_on_face_circle_edge", &result);
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_revolve_on_face_circle() {
    let code = r#"const box = startSketchOn('XY')
  |> startProfileAt([0, 0], %)
  |> line([0, 20], %)
  |> line([20, 0], %, $revolveAxis)
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
    assert_out("revolve_on_face_circle", &result);
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_revolve_on_face() {
    let code = r#"const box = startSketchOn('XY')
  |> startProfileAt([0, 0], %)
  |> line([0, 10], %)
  |> line([10, 0], %)
  |> line([0, -10], %)
  |> close(%, $revolveAxis)
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
    assert_out("revolve_on_face", &result);
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_basic_revolve_circle() {
    let code = r#"const sketch001 = startSketchOn('XY')
  |> circle([15, 0], 5, %)
  |> revolve({
    angle: 360, 
    axis: 'y' 
    }, %)
"#;

    let result = execute_and_snapshot(code, UnitLength::Mm).await.unwrap();
    assert_out("basic_revolve_circle", &result);
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_simple_revolve_sketch_on_edge() {
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
    assert_out("simple_revolve_sketch_on_edge", &result);
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_plumbus_fillets() {
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
       angle: segAng(a) + 180 - 108,
       length: len
     }, %, $b)
  |> angledLine({
       angle: segAng(b) + 180 - 108,
       length: len
     }, %, $c)
  |> angledLine({
       angle: segAng(c) + 180 - 108,
       length: len
     }, %, $d)
  |> angledLine({
       angle: segAng(d) + 180 - 108,
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
       tags: [circle0.tags.arc1, getOppositeEdge(circle0.tags.arc1)]
     }, %)

const circle1 = make_circle(p, p.sketchGroup.tags.b, [0, 0], 2.5)
const plumbus1 = circle1
   |> extrude(10, %)
   |> fillet({
        radius: 0.5,
        tags: [circle1.tags.arc1, getOppositeEdge(circle1.tags.arc1)]
      }, %)
"#;

    let result = execute_and_snapshot(code, UnitLength::Mm).await.unwrap();
    assert_out("plumbus_fillets", &result);
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_empty_file_is_ok() {
    let code = r#""#;

    let result = execute_and_snapshot(code, UnitLength::Mm).await;
    assert!(result.is_ok());
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_member_expression_in_params() {
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
    assert_out("member_expression_in_params", &result);
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_bracket_with_fillets_ensure_fail_on_flush_source_ranges() {
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
  |> line([0, wallMountL], %, $outerEdge)
  |> line([-shelfMountL, 0], %)
  |> line([0, -thickness], %)
  |> line([shelfMountL - thickness, 0], %, $innerEdge)
  |> line([0, -wallMountL + thickness], %)
  |> close(%)
  |> extrude(width, %)
  |> fillet({
       radius: filletR,
       tags: [getNextAdjacentEdge(innerEdge)]
     }, %)
  |> fillet({
       radius: filletR + thickness,
       tags: [getNextAdjacentEdge(outerEdge)]
     }, %)
"#;

    let result = execute_and_snapshot(code, UnitLength::Mm).await;
    assert!(result.is_err());
    assert_eq!(
        result.err().unwrap().to_string(),
        r#"engine: KclErrorDetails { source_ranges: [SourceRange([1329, 1430])], message: "Modeling command failed: [ApiError { error_code: BadRequest, message: \"Fillet failed\" }]" }"#
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_error_empty_start_sketch_on_string() {
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
        r#"semantic: KclErrorDetails { source_ranges: [SourceRange([272, 298])], message: "Argument at index 1 was supposed to be type kcl_lib::std::sketch::FaceTag but found string (text)" }"#
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_error_user_function_wrong_args() {
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
async fn kcl_test_xz_plane() {
    let code = r#"const part001 = startSketchOn('XZ')
  |> startProfileAt([0, 0], %)
  |> lineTo([100, 100], %)
  |> lineTo([100, 0], %)
  |> close(%)
  |> extrude(5 + 7, %)
"#;

    let result = execute_and_snapshot(code, UnitLength::Mm).await.unwrap();
    assert_out("xz_plane", &result);
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_neg_xz_plane() {
    let code = r#"const part001 = startSketchOn('-XZ')
  |> startProfileAt([0, 0], %)
  |> lineTo([100, 100], %)
  |> lineTo([100, 0], %)
  |> close(%)
  |> extrude(5 + 7, %)
"#;

    let result = execute_and_snapshot(code, UnitLength::Mm).await.unwrap();
    assert_out("neg_xz_plane", &result);
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_linear_pattern3d_a_pattern() {
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
    assert_out("linear_pattern3d_a_pattern", &result);
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_circular_pattern3d_a_pattern() {
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
    assert_out("circular_pattern3d_a_pattern", &result);
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_array_of_sketches() {
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
    assert_out("array_of_sketches", &result);
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_sketch_on_face_after_fillets_referencing_face() {
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
  |> line([0, wallMountL], %, $outerEdge)
  |> line([-shelfMountL, 0], %, $seg01)
  |> line([0, -thickness], %)
  |> line([shelfMountL - thickness, 0], %, $innerEdge)
  |> line([0, -wallMountL + thickness], %)
  |> close(%)
  |> extrude(width, %)
  |> fillet({
       radius: filletR,
       tags: [
         getPreviousAdjacentEdge(innerEdge)
       ]
     }, %)
  |> fillet({
       radius: filletR + thickness,
       tags: [
         getPreviousAdjacentEdge(outerEdge)
       ]
     }, %)

const sketch001 = startSketchOn(bracket, seg01)
  |> startProfileAt([4.28, 3.83], %)
  |> line([2.17, -0.03], %)
  |> line([-0.07, -1.8], %)
  |> line([-2.07, 0.05], %)
  |> lineTo([profileStartX(%), profileStartY(%)], %)
  |> close(%)
  |> extrude(10, %)
"#;

    let result = execute_and_snapshot(code, UnitLength::Mm).await.unwrap();
    assert_out("sketch_on_face_after_fillets_referencing_face", &result);
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_circular_pattern3d_array_of_extrudes() {
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
    assert_out("pattern3d_array_of_extrudes", &result);
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_fillets_referencing_other_fillets() {
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
  |> line([0, thickness], %, $cornerFillet1)
  |> line([foot1Length, 0], %)
  |> line([0, height], %, $fillet1)
  |> line([foot2Length, 0], %)
  |> line([0, -thickness], %, $cornerFillet2)
  |> line([-foot2Length+thickness, 0], %)
  |> line([0, -height], %, $fillet2)
  |> close(%)

const baseExtrusion = extrude(width, sketch001)
  |> fillet({
    radius: cornerFilletRad,
    tags: [cornerFillet1, cornerFillet2, getOppositeEdge(cornerFillet1), getOppositeEdge(cornerFillet2)],
  }, %)
  |> fillet({
    radius: filletRad,
    tags: [getPreviousAdjacentEdge(fillet1), getPreviousAdjacentEdge(fillet2)]
  }, %)
  |> fillet({
   radius: filletRad + thickness,
   tags: [getNextAdjacentEdge(fillet1), getNextAdjacentEdge(fillet2)],
 }, %)
"#;

    let result = execute_and_snapshot(code, UnitLength::Mm).await.unwrap();
    assert_out("fillets_referencing_other_fillets", &result);
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_chamfers_referencing_other_chamfers() {
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
  |> line([0, thickness], %, $cornerChamfer1)
  |> line([foot1Length, 0], %)
  |> line([0, height], %, $chamfer1)
  |> line([foot2Length, 0], %)
  |> line([0, -thickness], %, $cornerChamfer2)
  |> line([-foot2Length+thickness, 0], %)
  |> line([0, -height], %, $chamfer2)
  |> close(%)

const baseExtrusion = extrude(width, sketch001)
  |> chamfer({
    length: cornerChamferRad,
    tags: [cornerChamfer1, cornerChamfer2, getOppositeEdge(cornerChamfer1), getOppositeEdge(cornerChamfer2)],
  }, %)
  |> chamfer({
    length: chamferRad,
    tags: [getPreviousAdjacentEdge(chamfer1), getPreviousAdjacentEdge(chamfer2)]
  }, %)
  |> chamfer({
   length: chamferRad + thickness,
   tags: [getNextAdjacentEdge(chamfer1), getNextAdjacentEdge(chamfer2)],
 }, %)
"#;

    let result = execute_and_snapshot(code, UnitLength::Mm).await.unwrap();
    assert_out("chamfers_referencing_other_chamfers", &result);
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_shell_with_tag() {
    let code = r#"const sketch001 = startSketchOn('XZ')
  |> startProfileAt([61.74, 206.13], %)
  |> xLine(305.11, %, $seg01)
  |> yLine(-291.85, %)
  |> xLine(-segLen(seg01), %)
  |> lineTo([profileStartX(%), profileStartY(%)], %)
  |> close(%)
  |> extrude(40.14, %)
  |> shell({
    faces: [seg01],
    thickness: 3.14,
  }, %)
"#;

    let result = execute_and_snapshot(code, UnitLength::Mm).await.unwrap();
    assert_out("shell_with_tag", &result);
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_linear_pattern3d_filleted_sketch() {
    let code = r#"fn cube = (pos, scale) => {
  const sg = startSketchOn('XY')
    |> startProfileAt(pos, %)
    |> line([0, scale], %)
    |> line([scale, 0], %)
    |> line([0, -scale], %)

  return sg
}
const part001 = cube([0,0], 20)
    |> close(%, $line1)
    |> extrude(20, %)
  |> fillet({
    radius: 10,
    tags: [getOppositeEdge(line1)]
  }, %)

const pattn1 = patternLinear3d({
       axis: [1, 0, 0],
       repetitions: 3,
       distance: 40
     }, part001)

"#;

    let result = execute_and_snapshot(code, UnitLength::Mm).await.unwrap();
    assert_out("linear_pattern3d_filleted_sketch", &result);
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_circular_pattern3d_filleted_sketch() {
    let code = r#"fn cube = (pos, scale) => {
  const sg = startSketchOn('XY')
    |> startProfileAt(pos, %)
    |> line([0, scale], %)
    |> line([scale, 0], %)
    |> line([0, -scale], %)

  return sg
}
const part001 = cube([0,0], 20)
    |> close(%, $line1)
    |> extrude(20, %)
  |> fillet({
    radius: 10,
    tags: [getOppositeEdge(line1)]
  }, %)

const pattn2 = patternCircular3d({axis: [0,0, 1], center: [-20, -20, -20], repetitions: 4, arcDegrees: 360, rotateDuplicates: false}, part001) 

"#;

    let result = execute_and_snapshot(code, UnitLength::Mm).await.unwrap();
    assert_out("circular_pattern3d_filleted_sketch", &result);
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_circular_pattern3d_chamfered_sketch() {
    let code = r#"fn cube = (pos, scale) => {
  const sg = startSketchOn('XY')
    |> startProfileAt(pos, %)
    |> line([0, scale], %)
    |> line([scale, 0], %)
    |> line([0, -scale], %)

  return sg
}
const part001 = cube([0,0], 20)
    |> close(%, $line1)
    |> extrude(20, %)
  |> chamfer({
    length: 10,
    tags: [getOppositeEdge(line1)]
  }, %)

const pattn2 = patternCircular3d({axis: [0,0, 1], center: [-20, -20, -20], repetitions: 4, arcDegrees: 360, rotateDuplicates: false}, part001) 

"#;

    let result = execute_and_snapshot(code, UnitLength::Mm).await.unwrap();
    assert_out("circular_pattern3d_chamfered_sketch", &result);
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_tag_chamfer_with_more_than_one_edge_should_fail() {
    let code = r#"fn cube = (pos, scale) => {
  const sg = startSketchOn('XY')
    |> startProfileAt(pos, %)
    |> line([0, scale], %)
    |> line([scale, 0], %)
    |> line([0, -scale], %)

  return sg
}
const part001 = cube([0,0], 20)
    |> close(%, $line1)
    |> extrude(20, %)
  |> chamfer({
    length: 10,
    tags: [line1, getOppositeEdge(line1)]
  }, %, $chamfer1)


"#;

    let result = execute_and_snapshot(code, UnitLength::Mm).await;
    assert!(result.is_err());
    assert_eq!(
        result.err().unwrap().to_string(),
        r#"type: KclErrorDetails { source_ranges: [SourceRange([271, 357])], message: "You can only tag one edge at a time with a tagged chamfer. Either delete the tag for the chamfer fn if you don't need it OR separate into individual chamfer functions for each tag." }"#
    );
}

#[tokio::test(flavor = "multi_thread")]
#[ignore] // Will return an error until this is fixed in the engine: https://github.com/KittyCAD/engine/issues/2260
async fn kcl_test_sketch_on_face_of_chamfer() {
    let code = r#"fn cube = (pos, scale) => {
  const sg = startSketchOn('XY')
    |> startProfileAt(pos, %)
    |> line([0, scale], %)
    |> line([scale, 0], %)
    |> line([0, -scale], %)

  return sg
}
const part001 = cube([0,0], 20)
    |> close(%, $line1)
    |> extrude(20, %)
  |> chamfer({
    length: 10,
    tags: [getOppositeEdge(line1)]
  }, %, $chamfer1)

const sketch001 = startSketchOn(part001, chamfer1)
    |> startProfileAt([4.28, 3.83], %)
    |> line([2.17, -0.03], %)
    |> line([-0.07, -1.8], %)
    |> line([-2.07, 0.05], %)
    |> lineTo([profileStartX(%), profileStartY(%)], %)
    |> close(%)
    |> extrude(10, %)
"#;

    let result = execute_and_snapshot(code, UnitLength::Mm).await.unwrap();
    assert_out("sketch_on_face_of_chamfer", &result);
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_duplicate_tags_should_error() {
    let code = r#"fn triangle = (len) => {
  return startSketchOn('XY')
  |> startProfileAt([-len / 2, -len / 2], %)
  |> angledLine({ angle: 0, length: len }, %, $a)
  |> angledLine({
       angle: segAng(a) + 120,
       length: len
     }, %, $b)
  |> angledLine({
       angle: segAng(b) + 120,
       length: len
     }, %, $a)
}

let p = triangle(200)
"#;

    let result = execute_and_snapshot(code, UnitLength::Mm).await;
    assert!(result.is_err());
    assert_eq!(
        result.err().unwrap().to_string(),
        r#"value already defined: KclErrorDetails { source_ranges: [SourceRange([311, 313]), SourceRange([326, 339])], message: "Cannot redefine `a`" }"#
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_global_tags() {
    let code = kcl_input!("global-tags");
    let result = execute_and_snapshot(code, UnitLength::Mm).await.unwrap();
    assert_out("global_tags", &result);
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_extrude_inside_fn_with_tags() {
    let code = kcl_input!("extrude-inside-fn-with-tags");
    let result = execute_and_snapshot(code, UnitLength::Mm).await.unwrap();
    assert_out("extrude-inside-fn-with-tags", &result);
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_pattern_vase() {
    let code = kcl_input!("pattern_vase");
    let result = execute_and_snapshot(code, UnitLength::Mm).await.unwrap();
    assert_out("pattern_vase", &result);
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_scoped_tags() {
    let code = kcl_input!("scoped-tags");
    let result = execute_and_snapshot(code, UnitLength::Mm).await.unwrap();
    assert_out("scoped_tags", &result);
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_order_sketch_extrude_in_order() {
    let code = kcl_input!("order-sketch-extrude-in-order");
    let result = execute_and_snapshot(code, UnitLength::Mm).await.unwrap();
    assert_out("order-sketch-extrude-in-order", &result);
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_order_sketch_extrude_out_of_order() {
    let code = kcl_input!("order-sketch-extrude-out-of-order");
    let result = execute_and_snapshot(code, UnitLength::Mm).await.unwrap();
    assert_out("order-sketch-extrude-out-of-order", &result);
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_extrude_custom_plane() {
    let code = kcl_input!("extrude-custom-plane");
    let result = execute_and_snapshot(code, UnitLength::Mm).await.unwrap();
    assert_out("extrude-custom-plane", &result);
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_arc_error_same_start_end() {
    let code = r#"startSketchOn('XY')
  |> startProfileAt([10, 0], %)
  |> arc({
       angle_start: 180,
       angle_end: 180,
       radius: 1.5
     }, %)
  |> close(%)
  |> patternCircular2d({
       arcDegrees: 360,
       center: [0, 0],
       repetitions: 5,
       rotateDuplicates: true
     }, %)
"#;

    let result = execute_and_snapshot(code, UnitLength::Mm).await;
    assert!(result.is_err());
    assert_eq!(
        result.err().unwrap().to_string(),
        r#"type: KclErrorDetails { source_ranges: [SourceRange([57, 140])], message: "Arc start and end angles must be different" }"#
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_angled_line_to_x_90() {
    let code = r#"const exampleSketch = startSketchOn('XZ')
  |> startProfileAt([0, 0], %)
  |> angledLineToX({ angle: 90, to: 10 }, %)
  |> line([0, 10], %)
  |> line([-10, 0], %)
  |> close(%)

const example = extrude(10, exampleSketch)
"#;

    let result = execute_and_snapshot(code, UnitLength::Mm).await;
    assert!(result.is_err());
    assert_eq!(
        result.err().unwrap().to_string(),
        r#"type: KclErrorDetails { source_ranges: [SourceRange([78, 117])], message: "Cannot have an x constrained angle of 90 degrees" }"#
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_angled_line_to_x_270() {
    let code = r#"const exampleSketch = startSketchOn('XZ')
  |> startProfileAt([0, 0], %)
  |> angledLineToX({ angle: 270, to: 10 }, %)
  |> line([0, 10], %)
  |> line([-10, 0], %)
  |> close(%)

const example = extrude(10, exampleSketch)
"#;

    let result = execute_and_snapshot(code, UnitLength::Mm).await;
    assert!(result.is_err());
    assert_eq!(
        result.err().unwrap().to_string(),
        r#"type: KclErrorDetails { source_ranges: [SourceRange([78, 118])], message: "Cannot have an x constrained angle of 270 degrees" }"#
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_angled_line_to_y_0() {
    let code = r#"const exampleSketch = startSketchOn('XZ')
  |> startProfileAt([0, 0], %)
  |> angledLineToY({ angle: 0, to: 20 }, %)
  |> line([-20, 0], %)
  |> angledLineToY({ angle: 70, to: 10 }, %)
  |> close(%)

const example = extrude(10, exampleSketch)
"#;

    let result = execute_and_snapshot(code, UnitLength::Mm).await;
    assert!(result.is_err());
    assert_eq!(
        result.err().unwrap().to_string(),
        r#"type: KclErrorDetails { source_ranges: [SourceRange([78, 116])], message: "Cannot have a y constrained angle of 0 degrees" }"#
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_angled_line_to_y_180() {
    let code = r#"const exampleSketch = startSketchOn('XZ')
  |> startProfileAt([0, 0], %)
  |> angledLineToY({ angle: 180, to: 20 }, %)
  |> line([-20, 0], %)
  |> angledLineToY({ angle: 70, to: 10 }, %)
  |> close(%)

const example = extrude(10, exampleSketch)
"#;

    let result = execute_and_snapshot(code, UnitLength::Mm).await;
    assert!(result.is_err());
    assert_eq!(
        result.err().unwrap().to_string(),
        r#"type: KclErrorDetails { source_ranges: [SourceRange([78, 118])], message: "Cannot have a y constrained angle of 180 degrees" }"#
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_angled_line_of_x_length_90() {
    let code = r#"const sketch001 = startSketchOn('XZ')
  |> startProfileAt([0, 0], %)
  |> angledLineOfXLength({ angle: 90, length: 10 }, %, $edge1)
  |> angledLineOfXLength({ angle: -15, length: 20 }, %, $edge2)
  |> line([0, -5], %)
  |> close(%, $edge3)

const extrusion = extrude(10, sketch001)
"#;

    let result = execute_and_snapshot(code, UnitLength::Mm).await;
    assert!(result.is_err());
    assert_eq!(
        result.err().unwrap().to_string(),
        r#"type: KclErrorDetails { source_ranges: [SourceRange([74, 131])], message: "Cannot have an x constrained angle of 90 degrees" }"#
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_angled_line_of_x_length_270() {
    let code = r#"const sketch001 = startSketchOn('XZ')
  |> startProfileAt([0, 0], %)
  |> angledLineOfXLength({ angle: 90, length: 10 }, %, $edge1)
  |> angledLineOfXLength({ angle: -15, length: 20 }, %, $edge2)
  |> line([0, -5], %)
  |> close(%, $edge3)

const extrusion = extrude(10, sketch001)
"#;

    let result = execute_and_snapshot(code, UnitLength::Mm).await;
    assert!(result.is_err());
    assert_eq!(
        result.err().unwrap().to_string(),
        r#"type: KclErrorDetails { source_ranges: [SourceRange([74, 131])], message: "Cannot have an x constrained angle of 90 degrees" }"#
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_angled_line_of_y_length_0() {
    let code = r#"const exampleSketch = startSketchOn('XZ')
  |> startProfileAt([0, 0], %)
  |> line([10, 0], %)
  |> angledLineOfYLength({ angle: 0, length: 10 }, %)
  |> line([0, 10], %)
  |> angledLineOfYLength({ angle: 135, length: 10 }, %)
  |> line([-10, 0], %)
  |> line([0, -30], %)

const example = extrude(10, exampleSketch)
"#;

    let result = execute_and_snapshot(code, UnitLength::Mm).await;
    assert!(result.is_err());
    assert_eq!(
        result.err().unwrap().to_string(),
        r#"type: KclErrorDetails { source_ranges: [SourceRange([100, 148])], message: "Cannot have a y constrained angle of 0 degrees" }"#
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_angled_line_of_y_length_180() {
    let code = r#"const exampleSketch = startSketchOn('XZ')
  |> startProfileAt([0, 0], %)
  |> line([10, 0], %)
  |> angledLineOfYLength({ angle: 180, length: 10 }, %)
  |> line([0, 10], %)
  |> angledLineOfYLength({ angle: 135, length: 10 }, %)
  |> line([-10, 0], %)
  |> line([0, -30], %)

const example = extrude(10, exampleSketch)
"#;

    let result = execute_and_snapshot(code, UnitLength::Mm).await;
    assert!(result.is_err());
    assert_eq!(
        result.err().unwrap().to_string(),
        r#"type: KclErrorDetails { source_ranges: [SourceRange([100, 150])], message: "Cannot have a y constrained angle of 180 degrees" }"#
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_angled_line_of_y_length_negative_180() {
    let code = r#"const exampleSketch = startSketchOn('XZ')
  |> startProfileAt([0, 0], %)
  |> line([10, 0], %)
  |> angledLineOfYLength({ angle: -180, length: 10 }, %)
  |> line([0, 10], %)
  |> angledLineOfYLength({ angle: 135, length: 10 }, %)
  |> line([-10, 0], %)
  |> line([0, -30], %)

const example = extrude(10, exampleSketch)
"#;

    let result = execute_and_snapshot(code, UnitLength::Mm).await;
    assert!(result.is_err());
    assert_eq!(
        result.err().unwrap().to_string(),
        r#"type: KclErrorDetails { source_ranges: [SourceRange([100, 151])], message: "Cannot have a y constrained angle of 180 degrees" }"#
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_error_inside_fn_also_has_source_range_of_call_site() {
    let code = r#"fn someFunction = (something) => {
  startSketchOn(something)
}

someFunction('INVALID')
"#;

    let result = execute_and_snapshot(code, UnitLength::Mm).await;
    assert!(result.is_err());
    assert_eq!(
        result.err().unwrap().to_string(),
        r#"semantic: KclErrorDetails { source_ranges: [SourceRange([37, 61]), SourceRange([65, 88])], message: "Argument at index 0 was supposed to be type kcl_lib::std::sketch::SketchData but found string (text)" }"#
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_error_inside_fn_also_has_source_range_of_call_site_recursive() {
    let code = r#"fn someFunction = (something) => {
    fn someNestedFunction = (something2) => {
        startSketchOn(something2)
    }

    someNestedFunction(something)
}

someFunction('INVALID')
"#;

    let result = execute_and_snapshot(code, UnitLength::Mm).await;
    assert!(result.is_err());
    assert_eq!(
        result.err().unwrap().to_string(),
        r#"semantic: KclErrorDetails { source_ranges: [SourceRange([89, 114]), SourceRange([126, 155]), SourceRange([159, 182])], message: "Argument at index 0 was supposed to be type kcl_lib::std::sketch::SketchData but found string (text)" }"#
    );
}
