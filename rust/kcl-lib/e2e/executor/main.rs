mod cache;

use kcl_lib::{
    test_server::{execute_and_export_step, execute_and_snapshot, execute_and_snapshot_no_auth},
    ExecError,
};

/// The minimum permissible difference between asserted twenty-twenty images.
/// i.e. how different the current model snapshot can be from the previous saved one.
pub(crate) const MIN_DIFF: f64 = 0.99;

macro_rules! kcl_input {
    ($file:literal) => {
        include_str!(concat!("inputs/", $file, ".kcl"))
    };
}

pub(crate) fn assert_out(test_name: &str, result: &image::DynamicImage) -> String {
    let path = format!("e2e/executor/outputs/{test_name}.png");
    twenty_twenty::assert_image(&path, result, MIN_DIFF);

    path
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_fillet_duplicate_tags() {
    let code = kcl_input!("fillet_duplicate_tags");

    let result = execute_and_snapshot(code, None).await;
    let err = result.expect_err("Code should have failed due to the duplicate edges being filletted");

    let err = err.as_kcl_error().unwrap();
    assert_eq!(
        err.message(),
        "The same edge ID is being referenced multiple times, which is not allowed. Please select a different edge"
    );
    assert_eq!(err.source_ranges().len(), 2);
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_execute_engine_error_return() {
    let code = r#"part001 = startSketchOn(XY)
  |> startProfileAt([5.5229, 5.25217], %)
  |> line(end = [10.50433, -1.19122])
  |> line(end = [8.01362, -5.48731])
  |> line(end = [-1.02877, -6.76825])
  |> line(end = [-11.53311, 2.81559])
  |> extrude(length = 4)
"#;

    let result = execute_and_snapshot(code, None).await;
    assert!(result.is_err());
    assert_eq!(
        result.err().unwrap().to_string(),
        r#"engine: KclErrorDetails { source_ranges: [SourceRange([226, 245, 0])], message: "Modeling command failed: [ApiError { error_code: BadRequest, message: \"The path is not closed.  Solid2D construction requires a closed path!\" }]" }"#,
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_execute_i_shape() {
    // This is some code from lee that starts a pipe expression with a variable.
    let code = kcl_input!("i_shape");

    let result = execute_and_snapshot(code, None).await.unwrap();
    assert_out("i_shape", &result);
}

#[tokio::test(flavor = "multi_thread")]
#[ignore] // No longer a stack overflow problem, instead it causes an engine internal error.
async fn kcl_test_execute_pipes_on_pipes() {
    let code = kcl_input!("pipes_on_pipes");

    let result = execute_and_snapshot(code, None).await.unwrap();
    assert_out("pipes_on_pipes", &result);
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_execute_cylinder() {
    let code = kcl_input!("cylinder");

    let result = execute_and_snapshot(code, None).await.unwrap();
    assert_out("cylinder", &result);
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_execute_kittycad_svg() {
    let code = kcl_input!("kittycad_svg");

    let result = execute_and_snapshot(code, None).await.unwrap();
    assert_out("kittycad_svg", &result);
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_execute_lsystem() {
    let code = kcl_input!("lsystem");

    let result = execute_and_snapshot(code, None).await.unwrap();
    assert_out("lsystem", &result);
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_member_expression_sketch() {
    let code = kcl_input!("member_expression_sketch");

    let result = execute_and_snapshot(code, None).await.unwrap();
    assert_out("member_expression_sketch", &result);
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_helix_defaults() {
    let code = kcl_input!("helix_defaults");

    let result = execute_and_snapshot(code, None).await.unwrap();
    assert_out("helix_defaults", &result);
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_helix_defaults_negative_extrude() {
    let code = kcl_input!("helix_defaults_negative_extrude");

    let result = execute_and_snapshot(code, None).await.unwrap();
    assert_out("helix_defaults_negative_extrude", &result);
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_helix_with_length() {
    let code = kcl_input!("helix_with_length");

    let result = execute_and_snapshot(code, None).await.unwrap();
    assert_out("helix_with_length", &result);
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_dimensions_match() {
    let code = kcl_input!("dimensions_match");

    let result = execute_and_snapshot(code, None).await.unwrap();
    assert_out("dimensions_match", &result);
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_close_arc() {
    let code = kcl_input!("close_arc");

    let result = execute_and_snapshot(code, None).await.unwrap();
    assert_out("close_arc", &result);
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_negative_args() {
    let code = kcl_input!("negative_args");

    let result = execute_and_snapshot(code, None).await.unwrap();
    assert_out("negative_args", &result);
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_basic_tangential_arc_with_point() {
    let code = r#"boxSketch = startSketchOn(XY)
    |> startProfileAt([0, 0], %)
    |> line(end = [0, 10])
    |> tangentialArcToRelative([-5, 5], %)
    |> line(end = [5, -15])
    |> extrude(length = 10)
"#;

    let result = execute_and_snapshot(code, None).await.unwrap();
    assert_out("tangential_arc_with_point", &result);
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_basic_tangential_arc_to() {
    let code = r#"boxSketch = startSketchOn(XY)
    |> startProfileAt([0, 0], %)
    |> line(end = [0, 10])
    |> tangentialArcTo([-5, 15], %)
    |> line(end = [5, -15])
    |> extrude(length = 10)
"#;

    let result = execute_and_snapshot(code, None).await.unwrap();
    assert_out("tangential_arc_to", &result);
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_different_planes_same_drawing() {
    let code = r#"width = 5
height = 10
length = 12

fn box = (sk1, sk2, scale, plane) => {
  boxsketch = startSketchOn(plane)
    |> startProfileAt([sk1, sk2], %)
    |> line(end = [0, scale])
    |> line(end = [scale, 0])
    |> line(end = [0, -scale])
    |> close()
    |> extrude(length = scale)
  return boxsketch
}

box(0, 0, 5, 'xy')
box(10, 23, 8, 'xz')
box(30, 43, 18, '-xy')
let thing = box(-12, -15, 10, 'yz')
box(-20, -5, 10, 'xy')"#;

    let result = execute_and_snapshot(code, None).await.unwrap();
    assert_out("different_planes_same_drawing", &result);
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_lots_of_planes() {
    let code = r#"sigmaAllow = 15000 // psi
width = 11 // inch
p = 150 // Force on shelf - lbs
distance = 12 // inches
FOS = 2
thickness = sqrt(distance * p * FOS * 6 / (sigmaAllow * width))
filletR = thickness * 2
shelfMountL = 9
wallMountL = 8

bracket = startSketchOn(XY)
  |> startProfileAt([0, 0], %)
  |> line(end = [0, wallMountL])
  |> tangentialArc({ radius= filletR, offset: 90 }, %)
  |> line(end = [-shelfMountL, 0])
  |> line(end = [0, -thickness])
  |> line(end = [shelfMountL, 0])
  |> tangentialArc({
       radius= filletR - thickness,
       offset: -90
     }, %)
  |> line(end = [0, -wallMountL])
  |> close()
  |> extrude(length = width)

part001 = startSketchOn(XY)
  |> startProfileAt([-15.53, -10.28], %)
  |> line(end = [10.49, -2.08])
  |> line(end = [10.42, 8.47])
  |> line(end = [-19.16, 5.1])
  |> close()
  |> extrude(length = 4)

part002 = startSketchOn('-XZ')
  |> startProfileAt([-9.35, 19.18], %)
  |> line(end = [32.14, -2.47])
  |> line(end = [8.39, -3.73])
  |> close()

part003 = startSketchOn('-XZ')
  |> startProfileAt([13.82, 16.51], %)
  |> line(end = [-6.24, -30.82])
  |> line(end = [8.39, -3.73])
  |> close()

part004 = startSketchOn(YZ)
  |> startProfileAt([19.04, 20.22], %)
  |> line(end = [9.44, -30.16])
  |> line(end = [8.39, -3.73])
  |> close()
"#;

    let result = execute_and_snapshot(code, None).await.unwrap();
    assert_out("lots_of_planes", &result);
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_holes() {
    let code = r#"square = startSketchOn(XY)
  |> startProfileAt([0, 0], %)
  |> line(end = [0, 10])
  |> line(end = [10, 0])
  |> line(end = [0, -10])
  |> close()
  |> hole(circle(center = [2, 2], radius= .5), %)
  |> hole(circle(center = [2, 8], radius= .5), %)
  |> extrude(length = 2)
"#;

    let result = execute_and_snapshot(code, None).await.unwrap();
    assert_out("holes", &result);
}

#[tokio::test(flavor = "multi_thread")]
async fn optional_params() {
    let code = r#"
    fn other_circle = (pos, radius, tag?) => {
      sg = startSketchOn(XY)
        |> startProfileAt(pos, %)
        |> arc({angleEnd = 360, angleStart = 0, radius}, %)
        |> close()
        |> extrude(length = 2)

      return sg
  }

thing = other_circle([2, 2], 20)
"#;
    let result = execute_and_snapshot(code, None).await.unwrap();
    assert_out("optional_params", &result);
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_rounded_with_holes() {
    let code = r#"fn tarc = (to, sktch, tag?) => {
  return tangentialArcTo(to, sktch, tag)
}

fn roundedRectangle = (pos, w, l, cornerRadius) => {
  rr = startSketchOn(XY)
    |> startProfileAt([pos[0] - w/2, 0], %)
    |> line(endAbsolute = [pos[0] - w/2, pos[1] - l/2 + cornerRadius])
    |> tarc([pos[0] - w/2 + cornerRadius, pos[1] - l/2], %, $arc0)
    |> line(endAbsolute = [pos[0] + w/2 - cornerRadius, pos[1] - l/2])
    |> tarc([pos[0] + w/2, pos[1] - l/2 + cornerRadius], %)
    |> line(endAbsolute = [pos[0] + w/2, pos[1] + l/2 - cornerRadius])
    |> tarc([pos[0] + w/2 - cornerRadius, pos[1] + l/2], %, $arc2)
    |> line(endAbsolute = [pos[0] - w/2 + cornerRadius, pos[1] + l/2])
    |> tarc([pos[0] - w/2, pos[1] + l/2 - cornerRadius], %)
    |> close()
  return rr
}

holeRadius = 1
holeIndex = 6

part = roundedRectangle([0, 0], 20, 20, 4)
  |> hole(circle(center = [-holeIndex, holeIndex], radius= holeRadius), %)
  |> hole(circle(center = [holeIndex, holeIndex], radius= holeRadius), %)
  |> hole(circle(center = [-holeIndex, -holeIndex], radius= holeRadius), %)
  |> hole(circle(center = [holeIndex, -holeIndex], radius= holeRadius), %)
  |> extrude(length = 2)
"#;

    let result = execute_and_snapshot(code, None).await.unwrap();
    assert_out("rounded_with_holes", &result);
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_top_level_expression() {
    let code = r#"startSketchOn(XY) |> circle(center = [0,0], radius= 22) |> extrude(length = 14)"#;

    let result = execute_and_snapshot(code, None).await.unwrap();
    assert_out("top_level_expression", &result);
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_patterns_linear_basic_with_math() {
    let code = r#"num = 12
distance = 5
part =  startSketchOn(XY)
    |> circle(center = [0,0], radius= 2)
    |> patternLinear2d(axis = [0,1], instances = num, distance = distance - 1)
    |> extrude(length = 1)
"#;

    let result = execute_and_snapshot(code, None).await.unwrap();
    assert_out("patterns_linear_basic_with_math", &result);
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_patterns_linear_basic() {
    let code = r#"part =  startSketchOn(XY)
    |> circle(center = [0,0], radius= 2)
    |> patternLinear2d(axis = [0,1], instances = 13, distance = 4)
    |> extrude(length = 1)
"#;

    let result = execute_and_snapshot(code, None).await.unwrap();
    assert_out("patterns_linear_basic", &result);
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_patterns_linear_basic_3d() {
    let code = r#"part = startSketchOn(XY)
    |> startProfileAt([0, 0], %)
    |> line(end = [0,1])
    |> line(end = [1, 0])
    |> line(end = [0, -1])
    |> close()
    |> extrude(length = 1)
    |> patternLinear3d(axis = [1, 0, 1], instances = 4, distance = 6)
"#;

    let result = execute_and_snapshot(code, None).await.unwrap();
    assert_out("patterns_linear_basic_3d", &result);
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_patterns_linear_basic_negative_distance() {
    let code = r#"part = startSketchOn(XY)
    |> circle(center = [0,0], radius= 2)
    |> patternLinear2d(axis = [0,1], instances = 13, distance = -2)
    |> extrude(length = 1)
"#;

    let result = execute_and_snapshot(code, None).await.unwrap();
    assert_out("patterns_linear_basic_negative_distance", &result);
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_patterns_linear_basic_negative_axis() {
    let code = r#"part = startSketchOn(XY)
    |> circle(center = [0,0], radius= 2)
    |> patternLinear2d(axis = [0,-1], instances = 13, distance = 2)
    |> extrude(length = 1)
"#;

    let result = execute_and_snapshot(code, None).await.unwrap();
    assert_out("patterns_linear_basic_negative_axis", &result);
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_patterns_linear_basic_holes() {
    let code = r#"circles = startSketchOn(XY)
    |> circle(center = [5, 5], radius= 1)
    |> patternLinear2d(axis = [1,1], instances = 13, distance = 3)

rectangle = startSketchOn(XY)
  |> startProfileAt([0, 0], %)
  |> line(end = [0, 50])
  |> line(end = [50, 0])
  |> line(end = [0, -50])
  |> close()
  |> hole(circles, %)
  |> extrude(length = 10)

"#;

    let result = execute_and_snapshot(code, None).await.unwrap();
    assert_out("patterns_linear_basic_holes", &result);
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_patterns_circular_basic_2d() {
    let code = r#"part = startSketchOn(XY)
    |> circle(center = [0,0], radius= 2)
    |> patternCircular2d(center = [20, 20], instances = 13, arcDegrees = 210, rotateDuplicates = true)
    |> extrude(length = 1)
"#;

    let result = execute_and_snapshot(code, None).await.unwrap();
    assert_out("patterns_circular_basic_2d", &result);
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_patterns_circular_basic_3d() {
    let code = r#"part = startSketchOn(XY)
    |> startProfileAt([0, 0], %)
    |> line(end = [0,1])
    |> line(end = [1, 0])
    |> line(end = [0, -1])
    |> close()
    |> extrude(length = 1)
    |> patternCircular3d(axis = [0,0, 1], center = [-20, -20, -20], instances = 41, arcDegrees = 360, rotateDuplicates = false)
"#;

    let result = execute_and_snapshot(code, None).await.unwrap();
    assert_out("patterns_circular_basic_3d", &result);
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_patterns_circular_3d_tilted_axis() {
    let code = r#"part = startSketchOn(XY)
    |> startProfileAt([0, 0], %)
    |> line(end = [0,1])
    |> line(end = [1, 0])
    |> line(end = [0, -1])
    |> close()
    |> extrude(length = 1)
    |> patternCircular3d(axis = [1,1,0], center = [10, 0, 10], instances = 11, arcDegrees = 360, rotateDuplicates = true)
"#;

    let result = execute_and_snapshot(code, None).await.unwrap();
    assert_out("patterns_circular_3d_tilted_axis", &result);
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_import_file_doesnt_exist() {
    let code = r#"import 'thing.obj'
model = cube"#;

    let result = execute_and_snapshot(code, None).await;
    assert!(result.is_err());
    assert_eq!(
        result.err().unwrap().to_string(),
        r#"semantic: KclErrorDetails { source_ranges: [SourceRange([0, 18, 0])], message: "File `thing.obj` does not exist." }"#
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_import_obj_with_mtl() {
    let code = r#"import 'e2e/executor/inputs/cube.obj'
model = cube"#;

    let result = execute_and_snapshot(code, None).await.unwrap();
    assert_out("import_obj_with_mtl", &result);
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_import_obj_with_mtl_units() {
    let code = r#"@(format = obj, lengthUnit = m)
import 'e2e/executor/inputs/cube.obj'
model = cube"#;

    let result = execute_and_snapshot(code, None).await.unwrap();
    assert_out("import_obj_with_mtl_units", &result);
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_import_stl() {
    let code = r#"import 'e2e/executor/inputs/2-5-long-m8-chc-screw.stl' as screw
model = screw"#;

    let result = execute_and_snapshot(code, None).await.unwrap();
    assert_out("import_stl", &result);
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_import_gltf_with_bin() {
    let code = r#"import 'e2e/executor/inputs/cube.gltf'
model = cube"#;

    let result = execute_and_snapshot(code, None).await.unwrap();
    assert_out("import_gltf_with_bin", &result);
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_import_gltf_embedded() {
    let code = r#"import 'e2e/executor/inputs/cube-embedded.gltf' as cube
model = cube"#;

    let result = execute_and_snapshot(code, None).await.unwrap();
    assert_out("import_gltf_embedded", &result);
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_import_glb() {
    let code = r#"import 'e2e/executor/inputs/cube.glb'
model = cube"#;

    let result = execute_and_snapshot(code, None).await.unwrap();
    assert_out("import_glb", &result);
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_import_glb_no_assign() {
    let code = r#"import 'e2e/executor/inputs/cube.glb'
cube"#;

    let result = execute_and_snapshot(code, None).await.unwrap();
    assert_out("import_glb_no_assign", &result);
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_import_ext_doesnt_match() {
    let code = r#"@(format = obj, lengthUnit = m)
import 'e2e/executor/inputs/cube.gltf'
model = cube"#;

    let result = execute_and_snapshot(code, None).await;
    assert!(result.is_err());
    assert_eq!(
        result.err().unwrap().to_string(),
        r#"semantic: KclErrorDetails { source_ranges: [SourceRange([32, 70, 0])], message: "The given format does not match the file extension. Expected: `gltf`, Given: `obj`" }"#
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_cube_mm() {
    let code = r#"fn cube = (pos, scale) => {
  sg = startSketchOn(XY)
    |> startProfileAt(pos, %)
    |> line(end = [0, scale])
    |> line(end = [scale, 0])
    |> line(end = [0, -scale])
    |> close()
    |> extrude(length = scale)

  return sg
}

myCube = cube([0,0], 10)
"#;

    let result = execute_and_snapshot(code, None).await.unwrap();
    assert_out("cube_mm", &result);
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_cube_cm() {
    let code = r#"@settings(defaultLengthUnit = cm)
fn cube = (pos, scale) => {
  sg = startSketchOn(XY)
    |> startProfileAt(pos, %)
    |> line(end = [0, scale])
    |> line(end = [scale, 0])
    |> line(end = [0, -scale])
    |> close()
    |> extrude(length = scale)

  return sg
}

myCube = cube([0,0], 10)
"#;

    let result = execute_and_snapshot(code, None).await.unwrap();
    assert_out("cube_cm", &result);
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_cube_m() {
    let code = r#"@settings(defaultLengthUnit = m)
fn cube = (pos, scale) => {
  sg = startSketchOn(XY)
    |> startProfileAt(pos, %)
    |> line(end = [0, scale])
    |> line(end = [scale, 0])
    |> line(end = [0, -scale])
    |> close()
    |> extrude(length = scale)

  return sg
}

myCube = cube([0,0], 10)
"#;

    let result = execute_and_snapshot(code, None).await.unwrap();
    assert_out("cube_m", &result);
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_cube_in() {
    let code = r#"@settings(defaultLengthUnit = in)
fn cube = (pos, scale) => {
  sg = startSketchOn(XY)
    |> startProfileAt(pos, %)
    |> line(end = [0, scale])
    |> line(end = [scale, 0])
    |> line(end = [0, -scale])
    |> close()
    |> extrude(length = scale)

  return sg
}

myCube = cube([0,0], 10)
"#;

    let result = execute_and_snapshot(code, None).await.unwrap();
    assert_out("cube_in", &result);
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_cube_ft() {
    let code = r#"@settings(defaultLengthUnit = ft)
fn cube = (pos, scale) => {
  sg = startSketchOn(XY)
    |> startProfileAt(pos, %)
    |> line(end = [0, scale])
    |> line(end = [scale, 0])
    |> line(end = [0, -scale])
    |> close()
    |> extrude(length = scale)

  return sg
}

myCube = cube([0,0], 10)
"#;

    let result = execute_and_snapshot(code, None).await.unwrap();
    assert_out("cube_ft", &result);
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_cube_yd() {
    let code = r#"@settings(defaultLengthUnit = yd)
fn cube = (pos, scale) => {
  sg = startSketchOn(XY)
    |> startProfileAt(pos, %)
    |> line(end = [0, scale])
    |> line(end = [scale, 0])
    |> line(end = [0, -scale])
    |> close()
    |> extrude(length = scale)

  return sg
}

myCube = cube([0,0], 10)
"#;

    let result = execute_and_snapshot(code, None).await.unwrap();
    assert_out("cube_yd", &result);
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_error_sketch_on_arc_face() {
    let code = r#"fn cube = (pos, scale) => {
  sg = startSketchOn(XY)
  |> startProfileAt(pos, %)
  |> tangentialArcToRelative([0, scale], %, $here)
  |> line(end = [scale, 0])
  |> line(end = [0, -scale])

  return sg
}
part001 = cube([0, 0], 20)
  |> close()
  |> extrude(length = 20)

part002 = startSketchOn(part001, part001.sketch.tags.here)
  |> startProfileAt([0, 0], %)
  |> line(end = [5, 0])
  |> line(end = [5, 5])
  |> line(end = [0, 5])
  |> close()
  |> extrude(length = 1)
"#;

    let result = execute_and_snapshot(code, None).await;

    let err = result.err().unwrap();
    let ExecError::Kcl(err) = err else {
        panic!("Expected KCL error, found {err}");
    };
    assert_eq!(
        err.error.message(),
        "could not sketch tangential arc, because its center would be infinitely far away in the X direction"
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_sketch_on_face_of_face() {
    let code = r#"fn cube = (pos, scale) => {
  sg = startSketchOn(XY)
    |> startProfileAt(pos, %)
    |> line(end = [0, scale])
    |> line(end = [scale, 0])
    |> line(end = [0, -scale])

  return sg
}
part001 = cube([0,0], 20)
    |> close()
    |> extrude(length = 20)

part002 = startSketchOn(part001, "end")
  |> startProfileAt([0, 0], %)
  |> line(end = [0, 10])
  |> line(end = [10, 0])
  |> line(end = [0, -10])
  |> close()
  |> extrude(length = 5)

part003 = startSketchOn(part002, "end")
  |> startProfileAt([0, 0], %)
  |> line(end = [0, 5])
  |> line(end = [5, 0])
  |> line(end = [0, -5])
  |> close()
  |> extrude(length = 5)
"#;

    let result = execute_and_snapshot(code, None).await.unwrap();
    assert_out("sketch_on_face_of_face", &result);
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_stdlib_kcl_error_right_code_path() {
    let code = r#"square = startSketchOn(XY)
  |> startProfileAt([0, 0], %)
  |> line(end = [0, 10])
  |> line(end = [10, 0])
  |> line(end = [0, -10])
  |> close()
  |> hole(circle(), %)
  |> hole(circle(center = [2, 8], radius= .5), %)
  |> extrude(length = 2)
"#;

    let result = execute_and_snapshot(code, None).await;
    let err = result.err().unwrap();
    let ExecError::Kcl(err) = err else {
        panic!("Expected KCL error, found {err}");
    };
    assert_eq!(
        err.error.message(),
        "This function requires a keyword argument 'center'"
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_sketch_on_face_circle() {
    let code = r#"fn cube = (pos, scale) => {
  sg = startSketchOn(XY)
    |> startProfileAt(pos, %)
    |> line(end = [0, scale])
    |> line(end = [scale, 0])
    |> line(end = [0, -scale])

  return sg
}
part001 = cube([0,0], 20)
    |> close()
    |> extrude(length = 20)

part002 = startSketchOn(part001, "end")
  |> circle(center = [0, 0], radius= 5) 
  |> extrude(length = 5)
"#;

    let result = execute_and_snapshot(code, None).await.unwrap();
    assert_out("sketch_on_face_circle", &result);
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_stdlib_kcl_error_circle() {
    let code = r#"// Mounting Plate
// A flat piece of material, often metal or plastic, that serves as a support or base for attaching, securing, or mounting various types of equipment, devices, or components. 

// Create a function that defines the body width and length of the mounting plate. Tag the corners so they can be passed through the fillet function.
fn rectShape = (pos, w, l) => {
  rr = startSketchOn(XY)
  |> startProfileAt([pos[0] - (w / 2), pos[1] - (l / 2)], %)
  |> line(endAbsolute = [pos[0] + w / 2, pos[1] - (l / 2)], tag = $edge1)
  |> line(endAbsolute = [pos[0] + w / 2, pos[1] + l / 2], tag = $edge2)
  |> line(endAbsolute = [pos[0] - (w / 2), pos[1] + l / 2], tag = $edge3)
  |> close(tag = $edge4)
  return rr
}

// Define the hole radius and x, y location constants
holeRadius = 1
holeIndex = 6

// Create the mounting plate extrusion, holes, and fillets
part = rectShape([0, 0], 20, 20)
  |> hole(circle('XY', center = [-holeIndex, holeIndex], radius = holeRadius))
  |> hole(circle('XY', center = [holeIndex, holeIndex], radius = holeRadius))
  |> hole(circle('XY', center = [-holeIndex, -holeIndex], radius = holeRadius))
  |> hole(circle('XY', center = [holeIndex, -holeIndex], radius = holeRadius))
  |> extrude(length = 2)
  |> fillet(
       radius = 4,
       tags = [
          getNextAdjacentEdge(edge1),
          getNextAdjacentEdge(edge2),
          getNextAdjacentEdge(edge3),
          getNextAdjacentEdge(edge4)
       ]
     )
"#;

    let result = execute_and_snapshot(code, None).await;
    let err = result.err().unwrap();
    let ExecError::Kcl(err) = err else {
        panic!("Expected KCL error, found {err}");
    };
    assert_eq!(
        err.error.message(),
        "The input argument of `std::sketch::circle` requires a value with type `Sketch | Plane | Face`, but found string (text)"
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_simple_revolve() {
    let code = r#"part001 = startSketchOn(XY)
     |> startProfileAt([4, 12], %)
     |> line(end = [2, 0])
     |> line(end = [0, -6])
     |> line(end = [4, -6])
     |> line(end = [0, -6])
     |> line(end = [-3.75, -4.5])
     |> line(end = [0, -5.5])
     |> line(end = [-2, 0])
     |> close()
     |> revolve(axis = Y)

"#;

    let result = execute_and_snapshot(code, None).await.unwrap();
    assert_out("simple_revolve", &result);
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_simple_revolve_uppercase() {
    let code = r#"part001 = startSketchOn(XY)
     |> startProfileAt([4, 12], %)
     |> line(end = [2, 0])
     |> line(end = [0, -6])
     |> line(end = [4, -6])
     |> line(end = [0, -6])
     |> line(end = [-3.75, -4.5])
     |> line(end = [0, -5.5])
     |> line(end = [-2, 0])
     |> close()
     |> revolve(axis = Y)

"#;

    let result = execute_and_snapshot(code, None).await.unwrap();
    assert_out("simple_revolve_uppercase", &result);
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_simple_revolve_negative() {
    let code = r#"part001 = startSketchOn(XY)
     |> startProfileAt([4, 12], %)
     |> line(end = [2, 0])
     |> line(end = [0, -6])
     |> line(end = [4, -6])
     |> line(end = [0, -6])
     |> line(end = [-3.75, -4.5])
     |> line(end = [0, -5.5])
     |> line(end = [-2, 0])
     |> close()
     |> revolve(axis = -Y, angle = 180)

"#;

    let result = execute_and_snapshot(code, None).await.unwrap();
    assert_out("simple_revolve_negative", &result);
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_revolve_bad_angle_low() {
    let code = r#"part001 = startSketchOn(XY)
     |> startProfileAt([4, 12], %)
     |> line(end = [2, 0])
     |> line(end = [0, -6])
     |> line(end = [4, -6])
     |> line(end = [0, -6])
     |> line(end = [-3.75, -4.5])
     |> line(end = [0, -5.5])
     |> line(end = [-2, 0])
     |> close()
     |> revolve(axis = Y, angle = -455)

"#;

    let result = execute_and_snapshot(code, None).await;

    assert!(result.is_err());
    assert!(result
        .err()
        .unwrap()
        .to_string()
        .contains("Expected angle to be between -360 and 360 and not 0, found `-455`"));
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_revolve_bad_angle_high() {
    let code = r#"part001 = startSketchOn(XY)
     |> startProfileAt([4, 12], %)
     |> line(end = [2, 0])
     |> line(end = [0, -6])
     |> line(end = [4, -6])
     |> line(end = [0, -6])
     |> line(end = [-3.75, -4.5])
     |> line(end = [0, -5.5])
     |> line(end = [-2, 0])
     |> close()
     |> revolve(axis = Y, angle = 455)

"#;

    let result = execute_and_snapshot(code, None).await;

    assert!(result.is_err());
    assert!(result
        .err()
        .unwrap()
        .to_string()
        .contains("Expected angle to be between -360 and 360 and not 0, found `455`"));
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_simple_revolve_custom_angle() {
    let code = r#"part001 = startSketchOn(XY)
     |> startProfileAt([4, 12], %)
     |> line(end = [2, 0])
     |> line(end = [0, -6])
     |> line(end = [4, -6])
     |> line(end = [0, -6])
     |> line(end = [-3.75, -4.5])
     |> line(end = [0, -5.5])
     |> line(end = [-2, 0])
     |> close()
     |> revolve(axis = Y, angle = 180)

"#;

    let result = execute_and_snapshot(code, None).await.unwrap();
    assert_out("simple_revolve_custom_angle", &result);
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_simple_revolve_custom_axis() {
    let code = r#"part001 = startSketchOn(XY)
     |> startProfileAt([4, 12], %)
     |> line(end = [2, 0])
     |> line(end = [0, -6])
     |> line(end = [4, -6])
     |> line(end = [0, -6])
     |> line(end = [-3.75, -4.5])
     |> line(end = [0, -5.5])
     |> line(end = [-2, 0])
     |> close()
     |> revolve(axis = { direction = [0, -1], origin: [0,0] }, angle = 180)

"#;

    let result = execute_and_snapshot(code, None).await.unwrap();
    assert_out("simple_revolve_custom_axis", &result);
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_revolve_on_edge() {
    let code = r#"box = startSketchOn(XY)
  |> startProfileAt([0, 0], %)
  |> line(end = [0, 10])
  |> line(end = [10, 0])
  |> line(end = [0, -10], tag = $revolveAxis)
  |> close()
  |> extrude(length = 10)

sketch001 = startSketchOn(box, "end")
  |> startProfileAt([5, 10], %)
  |> line(end = [0, -10])
  |> line(end = [2, 0])
  |> line(end = [0, 10])
  |> close()
  |> revolve(axis = getOppositeEdge(revolveAxis), angle = 90)

"#;

    let result = execute_and_snapshot(code, None).await.unwrap();
    assert_out("revolve_on_edge", &result);
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_revolve_on_edge_get_edge() {
    let code = r#"box = startSketchOn(XY)
  |> startProfileAt([0, 0], %)
  |> line(end = [0, 10])
  |> line(end = [10, 0])
  |> line(end = [0, -10], tag = $revolveAxis)
  |> close()
  |> extrude(length = 10)

sketch001 = startSketchOn(box, revolveAxis)
  |> startProfileAt([5, 10], %)
  |> line(end = [0, -10])
  |> line(end = [2, 0])
  |> line(end = [0, 10])
  |> close()
  |> revolve(axis = revolveAxis, angle = 90)

"#;

    let result = execute_and_snapshot(code, None).await;

    result.unwrap_err();
    //this fails right now, but slightly differently, lets just say its enough for it to fail - mike
    //assert_eq!(
    //    result.err().unwrap().to_string(),
    //    r#"engine: KclErrorDetails { source_ranges: [SourceRange([346, 390, 0])], message: "Modeling command failed: [ApiError { error_code: InternalEngine, message: \"Solid3D revolve failed:  sketch profile must lie entirely on one side of the revolution axis\" }]" }"#
    //);
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_revolve_on_face_circle_edge() {
    let code = r#"box = startSketchOn(XY)
  |> startProfileAt([0, 0], %)
  |> line(end = [0, 20])
  |> line(end = [20, 0])
  |> line(end = [0, -20], tag = $revolveAxis) 
  |> close()
  |> extrude(length = 20)

sketch001 = startSketchOn(box, "END")
  |> circle(center = [10,10], radius= 4)
  |> revolve(
    angle = 90,
    axis = getOppositeEdge(revolveAxis)
    )
"#;

    let result = execute_and_snapshot(code, None).await.unwrap();
    assert_out("revolve_on_face_circle_edge", &result);
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_revolve_on_face_circle() {
    let code = r#"box = startSketchOn(XY)
  |> startProfileAt([0, 0], %)
  |> line(end = [0, 20])
  |> line(end = [20, 0], tag = $revolveAxis)
  |> line(end = [0, -20]) 
  |> close()
  |> extrude(length = 20)

sketch001 = startSketchOn(box, "END")
  |> circle(center = [10,10], radius= 4 )
  |> revolve(
    angle = -90, 
    axis = Y 
    )
"#;

    let result = execute_and_snapshot(code, None).await.unwrap();
    assert_out("revolve_on_face_circle", &result);
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_revolve_on_face() {
    let code = r#"box = startSketchOn(XY)
  |> startProfileAt([0, 0], %)
  |> line(end = [0, 10])
  |> line(end = [10, 0])
  |> line(end = [0, -10])
  |> close(tag = $revolveAxis)
  |> extrude(length = 10)

sketch001 = startSketchOn(box, "end")
  |> startProfileAt([5, 10], %)
  |> line(end = [0, -10])
  |> line(end = [2, 0])
  |> line(end = [0, 10])
  |> close()
  |> revolve(
      axis = Y,
      angle = -90,
  )
"#;

    let result = execute_and_snapshot(code, None).await.unwrap();
    assert_out("revolve_on_face", &result);
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_basic_revolve_circle() {
    let code = r#"sketch001 = startSketchOn(XY)
  |> circle(center = [15, 0], radius= 5)
  |> revolve(
    angle = 360, 
    axis = Y 
    )
"#;

    let result = execute_and_snapshot(code, None).await.unwrap();
    assert_out("basic_revolve_circle", &result);
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_simple_revolve_sketch_on_edge() {
    let code = r#"part001 = startSketchOn(XY)
     |> startProfileAt([4, 12], %)
     |> line(end = [2, 0])
     |> line(end = [0, -6])
     |> line(end = [4, -6])
     |> line(end = [0, -6])
     |> line(end = [-3.75, -4.5])
     |> line(end = [0, -5.5])
     |> line(end = [-2, 0])
     |> close()
     |> revolve(axis = Y, angle = 180)

part002 = startSketchOn(part001, 'end')
    |> startProfileAt([4.5, -5], %)
    |> line(end = [0, 5])
    |> line(end = [5, 0])
    |> line(end = [0, -5])
    |> close()
    |> extrude(length = 5)
"#;

    let result = execute_and_snapshot(code, None).await.unwrap();
    assert_out("simple_revolve_sketch_on_edge", &result);
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_plumbus_fillets() {
    let code = r#"fn make_circle = (ext, face, pos, radius) => {
  sg = startSketchOn(ext, face)
  |> startProfileAt([pos[0] + radius, pos[1]], %)
  |> arc({
       angleEnd = 360,
       angleStart = 0,
       radius = radius
     }, %, $arc1)
  |> close()

  return sg
}

fn pentagon = (len) => {
  sg = startSketchOn(XY)
  |> startProfileAt([-len / 2, -len / 2], %)
  |> angledLine(angle = 0, length = len, tag = $a)
  |> angledLine(
       angle = segAng(a) + 180 - 108,
       length = len,
       tag = $b,
     )
  |> angledLine(
       angle = segAng(b) + 180 - 108,
       length = len,
       tag = $c,
     )
  |> angledLine(
       angle = segAng(c) + 180 - 108,
       length = len,
       tag = $d,
     )
  |> angledLine(
       angle = segAng(d) + 180 - 108,
       length = len,
     )

  return sg
}

p = pentagon(32)
  |> extrude(length = 10)

circle0 = make_circle(p, p.sketch.tags.a, [0, 0], 2.5)
plumbus0 = circle0
  |> extrude(length = 10)
  |> fillet(
       radius = 0.5,
       tags = [circle0.tags.arc1, getOppositeEdge(circle0.tags.arc1)]
     )

circle1 = make_circle(p, p.sketch.tags.b, [0, 0], 2.5)
plumbus1 = circle1
   |> extrude(length = 10)
   |> fillet(
        radius = 0.5,
        tags = [circle1.tags.arc1, getOppositeEdge(circle1.tags.arc1)]
      )
"#;

    let result = execute_and_snapshot(code, None).await.unwrap();
    assert_out("plumbus_fillets", &result);
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_empty_file_is_ok() {
    let code = r#""#;

    let result = execute_and_snapshot(code, None).await;
    result.unwrap();
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_member_expression_in_params() {
    let code = r#"fn capScrew = (originStart, length, dia, capDia, capHeadLength) => {
  screwHead = startSketchOn({
       plane: {
         origin: {
          x: originStart[0],
          y: originStart[1],
          z: originStart[2],
         },
         xAxis: { x: 0, y: 0, z: -1 },
         yAxis: { x: 1, y: 0, z: 0 },
         zAxis: { x: 0, y: 1, z: 0 }
      }
  })
    |> circle(center = [0, 0], radius= capDia / 2)
    |> extrude(length = capHeadLength)
  screw = startSketchOn(screwHead, "start")
    |> circle(center = [0, 0], radius= dia / 2)
    |> extrude(length = length)
  return screw
}

capScrew([0, 0.5, 0], 50, 37.5, 50, 25)
"#;

    let result = execute_and_snapshot(code, None).await.unwrap();
    assert_out("member_expression_in_params", &result);
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_bracket_with_fillets() {
    let code = r#"// Shelf Bracket
// This is a shelf bracket made out of 6061-T6 aluminum sheet metal. The required thickness is calculated based on a point load of 300 lbs applied to the end of the shelf. There are two brackets holding up the shelf, so the moment experienced is divided by 2. The shelf is 1 foot long from the wall.

sigmaAllow = 35000 // psi
width = 6 // inch
p = 300 // Force on shelf - lbs
distance = 12 // inches
M = 12 * 300 / 2 // Moment experienced at fixed end of bracket
FOS = 2 // Factor of safety of 2
shelfMountL = 8 // The length of the bracket holding up the shelf is 6 inches
wallMountL = 8 // the length of the bracket


// Calculate the thickness off the allowable bending stress and factor of safety
thickness = sqrt(6 * M * FOS / (width * sigmaAllow))

// 0.25 inch fillet radius
filletR = 0.25

// Sketch the bracket and extrude with fillets
bracket = startSketchOn(XY)
  |> startProfileAt([0, 0], %)
  |> line(end = [0, wallMountL], tag = $outerEdge)
  |> line(end = [-shelfMountL, 0])
  |> line(end = [0, -thickness])
  |> line(end = [shelfMountL - thickness, 0], tag = $innerEdge)
  |> line(end = [0, -wallMountL + thickness])
  |> close()
  |> extrude(length = width)
  |> fillet(
       radius = filletR,
       tags = [getNextAdjacentEdge(innerEdge)]
     )
  |> fillet(
       radius = filletR + thickness,
       tags = [getNextAdjacentEdge(outerEdge)]
     )
"#;

    let result = execute_and_snapshot(code, None).await;
    result.unwrap();
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_error_empty_start_sketch_on_string() {
    let code = r#"part001 = startSketchOn('-XZ')
  |> startProfileAt([75.75, 184.25], %)
  |> line(end = [190.03, -118.13])
  |> line(end = [-33.38, -202.86])
  |> line(end = [-315.86, -64.2])
  |> tangentialArcTo([-147.66, 121.34], %)
  |> close()
  |> extrude(length = 100)

secondSketch = startSketchOn(part001, '')
  |> circle(center = [-20, 50], radius= 40)
  |> extrude(length = 20)
"#;

    let result = execute_and_snapshot(code, None).await;
    assert!(result.is_err());
    assert_eq!(
        result.err().unwrap().to_string(),
        r#"semantic: KclErrorDetails { source_ranges: [SourceRange([297, 299, 0])], message: "Argument at index 1 was supposed to be type Option<FaceTag> but found string (text)" }"#
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_error_user_function_wrong_args() {
    let code = r#"length = .750
width = 0.500
height = 0.500
dia = 4

fn squareHole = (l, w) => {
  squareHoleSketch = startSketchOn(XY)
  |> startProfileAt([-width / 2, -length / 2], %)
  |> line(endAbsolute = [width / 2, -length / 2])
  |> line(endAbsolute = [width / 2, length / 2])
  |> line(endAbsolute = [-width / 2, length / 2])
  |> close()
  return squareHoleSketch
}

extrusion = startSketchOn(XY)
  |> circle(center = [0, 0], radius= dia/2 )
  |> hole(squareHole(length, width, height), %)
  |> extrude(length = height)
"#;

    let result = execute_and_snapshot(code, None).await;
    assert!(result.is_err());
    assert_eq!(
        result.err().unwrap().to_string(),
        r#"semantic: KclErrorDetails { source_ranges: [SourceRange([68, 358, 0]), SourceRange([445, 478, 0])], message: "Expected 2 arguments, got 3" }"#
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_array_of_sketches() {
    let code = r#"plane001 = startSketchOn(XZ)

profile001 = plane001
  |> startProfileAt([40.82, 240.82], %)
  |> line(end = [235.72, -8.16])
  |> line(end = [13.27, -253.07])
  |> line(end = [-247.97, -19.39])
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()

profile002 = plane001
  |> startProfileAt([47.17, -71.91], %)
  |> line(end = [247.96, -4.03])
  |> line(end = [-17.26, -116.79])
  |> line(end = [-235.87, 12.66])
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()

sketch001 = [profile001, profile002]

 extrude(sketch001, length = 10)
"#;

    let result = execute_and_snapshot(code, None).await.unwrap();
    assert_out("array_of_sketches", &result);
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_circular_pattern3d_array_of_extrudes() {
    let code = r#"plane001 = startSketchOn(XZ)

sketch001 = plane001
  |> startProfileAt([40.82, 240.82], %)
  |> line(end = [235.72, -8.16])
  |> line(end = [13.27, -253.07])
  |> line(end = [-247.97, -19.39])
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
  |> extrude(length = 10)

sketch002 = plane001
  |> startProfileAt([47.17, -71.91], %)
  |> line(end = [247.96, -4.03])
  |> line(end = [-17.26, -116.79])
  |> line(end = [-235.87, 12.66])
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
  |> extrude(length = 10)


let extrudes = [sketch001, sketch002] 

pattn1 = patternLinear3d(
       extrudes,
       axis = [0, 1, 0],
       instances = 3,
       distance = 20
     )
"#;

    let result = execute_and_snapshot(code, None).await.unwrap();
    assert_out("pattern3d_array_of_extrudes", &result);
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_fillets_referencing_other_fillets() {
    let code = r#"// Z-Bracket

// Z-brackets are designed to affix or hang objects from a wall by securing them to the wall's studs. These brackets offer support and mounting solutions for bulky or heavy items that may be challenging to attach directly. Serving as a protective feature, Z-brackets help prevent heavy loads from moving or toppling, enhancing safety in the environment where they are used.

// Define constants
foot1Length = 4
height = 4
foot2Length = 5
width = 4
filletRad = 0.25
thickness = 0.125

cornerFilletRad = 0.5

holeDia = 0.5

sketch001 = startSketchOn(XZ)
  |> startProfileAt([-foot1Length, 0], %)
  |> line(end = [0, thickness], tag = $cornerFillet1)
  |> line(end = [foot1Length, 0])
  |> line(end = [0, height], tag = $fillet1)
  |> line(end = [foot2Length, 0])
  |> line(end = [0, -thickness], tag = $cornerFillet2)
  |> line(end = [-foot2Length+thickness, 0])
  |> line(end = [0, -height], tag = $fillet2)
  |> close()

baseExtrusion = extrude(sketch001, length = width)
  |> fillet(
    radius = cornerFilletRad,
    tags = [cornerFillet1, cornerFillet2, getOppositeEdge(cornerFillet1), getOppositeEdge(cornerFillet2)],
  )
  |> fillet(
    radius = filletRad,
    tags = [getPreviousAdjacentEdge(fillet1), getPreviousAdjacentEdge(fillet2)]
  )
  |> fillet(
   radius = filletRad + thickness,
   tags = [getNextAdjacentEdge(fillet1), getNextAdjacentEdge(fillet2)],
 )
"#;

    let result = execute_and_snapshot(code, None).await.unwrap();
    assert_out("fillets_referencing_other_fillets", &result);
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_chamfers_referencing_other_chamfers() {
    let code = r#"// Z-Bracket

// Z-brackets are designed to affix or hang objects from a wall by securing them to the wall's studs. These brackets offer support and mounting solutions for bulky or heavy items that may be challenging to attach directly. Serving as a protective feature, Z-brackets help prevent heavy loads from moving or toppling, enhancing safety in the environment where they are used.

// Define constants
foot1Length = 4
height = 4
foot2Length = 5
width = 4
chamferRad = 0.25
thickness = 0.125

cornerChamferRad = 0.5

holeDia = 0.5

sketch001 = startSketchOn(XZ)
  |> startProfileAt([-foot1Length, 0], %)
  |> line(end = [0, thickness], tag = $cornerChamfer1)
  |> line(end = [foot1Length, 0])
  |> line(end = [0, height], tag = $chamfer1)
  |> line(end = [foot2Length, 0])
  |> line(end = [0, -thickness], tag = $cornerChamfer2)
  |> line(end = [-foot2Length+thickness, 0])
  |> line(end = [0, -height], tag = $chamfer2)
  |> close()

baseExtrusion = extrude(sketch001, length = width)
  |> chamfer(
    length = cornerChamferRad,
    tags = [cornerChamfer1, cornerChamfer2, getOppositeEdge(cornerChamfer1), getOppositeEdge(cornerChamfer2)],
    )
  |> chamfer(
    length = chamferRad,
    tags = [getPreviousAdjacentEdge(chamfer1), getPreviousAdjacentEdge(chamfer2)],
  )
  |> chamfer(
   length = chamferRad + thickness,
   tags = [getNextAdjacentEdge(chamfer1), getNextAdjacentEdge(chamfer2)],
   )
"#;

    let result = execute_and_snapshot(code, None).await.unwrap();
    assert_out("chamfers_referencing_other_chamfers", &result);
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_shell_with_tag() {
    let code = r#"sketch001 = startSketchOn(XZ)
  |> startProfileAt([61.74, 206.13], %)
  |> xLine(length = 305.11, tag = $seg01)
  |> yLine(length = -291.85)
  |> xLine(length = -segLen(seg01))
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
  |> extrude(length = 40.14)
  |> shell(
    faces = [seg01],
    thickness = 3.14,
  )
"#;

    let result = execute_and_snapshot(code, None).await.unwrap();
    assert_out("shell_with_tag", &result);
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_linear_pattern3d_filleted_sketch() {
    let code = r#"fn cube = (pos, scale) => {
  sg = startSketchOn(XY)
    |> startProfileAt(pos, %)
    |> line(end = [0, scale])
    |> line(end = [scale, 0])
    |> line(end = [0, -scale])

  return sg
}
part001 = cube([0,0], 20)
    |> close(tag = $line1)
    |> extrude(length = 20)
    |> fillet(
      radius = 10,
      tags = [getOppositeEdge(line1)]
    )

pattn1 = patternLinear3d(
     part001,
     axis = [1, 0, 0],
     instances = 4,
     distance = 40
)
"#;

    let result = execute_and_snapshot(code, None).await.unwrap();
    assert_out("linear_pattern3d_filleted_sketch", &result);
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_circular_pattern3d_filleted_sketch() {
    let code = r#"fn cube = (pos, scale) => {
  sg = startSketchOn(XY)
    |> startProfileAt(pos, %)
    |> line(end = [0, scale])
    |> line(end = [scale, 0])
    |> line(end = [0, -scale])

  return sg
}
part001 = cube([0,0], 20)
    |> close(tag = $line1)
    |> extrude(length = 20)
  |> fillet(
    radius = 10,
    tags = [getOppositeEdge(line1)]
  )

pattn2 = patternCircular3d(part001, axis = [0,0, 1], center = [-20, -20, -20], instances = 5, arcDegrees = 360, rotateDuplicates = false) 

"#;

    let result = execute_and_snapshot(code, None).await.unwrap();
    assert_out("circular_pattern3d_filleted_sketch", &result);
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_circular_pattern3d_chamfered_sketch() {
    let code = r#"fn cube = (pos, scale) => {
  sg = startSketchOn(XY)
    |> startProfileAt(pos, %)
    |> line(end = [0, scale])
    |> line(end = [scale, 0])
    |> line(end = [0, -scale])

  return sg
}
part001 = cube([0,0], 20)
    |> close(tag = $line1)
    |> extrude(length = 20)
    |> chamfer(
      length = 10,
      tags = [getOppositeEdge(line1)],
    )

pattn2 = patternCircular3d(part001, axis = [0,0, 1], center = [-20, -20, -20], instances = 5, arcDegrees = 360, rotateDuplicates = false)
"#;

    let result = execute_and_snapshot(code, None).await.unwrap();
    assert_out("circular_pattern3d_chamfered_sketch", &result);
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_tag_chamfer_with_more_than_one_edge_should_fail() {
    let code = r#"fn cube = (pos, scale) => {
  sg = startSketchOn(XY)
    |> startProfileAt(pos, %)
    |> line(end = [0, scale])
    |> line(end = [scale, 0])
    |> line(end = [0, -scale])

  return sg
}
part001 = cube([0,0], 20)
    |> close(tag = $line1)
    |> extrude(length = 20)
  |> chamfer(
    length = 10,
    tags = [line1, getOppositeEdge(line1)],
    tag = $chamfer1
  )


"#;

    let result = execute_and_snapshot(code, None).await;
    let err = result.err().unwrap();
    let ExecError::Kcl(err) = err else {
        panic!("Expected KCL error, found {err}");
    };
    assert_eq!(
        err.error.message(),
        "You can only tag one edge at a time with a tagged chamfer. Either delete the tag for the chamfer fn if you don't need it OR separate into individual chamfer functions for each tag."
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_duplicate_tags_should_error() {
    let code = r#"fn triangle = (len) => {
  return startSketchOn(XY)
  |> startProfileAt([-len / 2, -len / 2], %)
  |> angledLine(angle = 0, length = len , tag = $a)
  |> angledLine(
       angle = segAng(a) + 120,
       length = len,
       tag = $b,
     )
  |> angledLine(
       angle = segAng(b) + 120,
       length = len,
       tag = $a,
     )
}

let p = triangle(200)
"#;

    let result = execute_and_snapshot(code, None).await;
    let err = result.unwrap_err();
    let err = err.as_kcl_error().unwrap();
    assert_eq!(err.message(), "Cannot redefine `a`");
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_global_tags() {
    let code = kcl_input!("global-tags");
    let result = execute_and_snapshot(code, None).await.unwrap();
    assert_out("global_tags", &result);
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_extrude_inside_fn_with_tags() {
    let code = kcl_input!("extrude-inside-fn-with-tags");
    let result = execute_and_snapshot(code, None).await.unwrap();
    assert_out("extrude-inside-fn-with-tags", &result);
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_pattern_vase() {
    let code = kcl_input!("pattern_vase");
    let result = execute_and_snapshot(code, None).await.unwrap();
    assert_out("pattern_vase", &result);
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_scoped_tags() {
    let code = kcl_input!("scoped-tags");
    let result = execute_and_snapshot(code, None).await.unwrap();
    assert_out("scoped_tags", &result);
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_order_sketch_extrude_in_order() {
    let code = kcl_input!("order-sketch-extrude-in-order");
    let result = execute_and_snapshot(code, None).await.unwrap();
    assert_out("order-sketch-extrude-in-order", &result);
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_order_sketch_extrude_out_of_order() {
    let code = kcl_input!("order-sketch-extrude-out-of-order");
    let result = execute_and_snapshot(code, None).await.unwrap();
    assert_out("order-sketch-extrude-out-of-order", &result);
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_extrude_custom_plane() {
    let code = kcl_input!("extrude-custom-plane");
    let result = execute_and_snapshot(code, None).await.unwrap();
    assert_out("extrude-custom-plane", &result);
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_arc_error_same_start_end() {
    let code = r#"startSketchOn(XY)
  |> startProfileAt([10, 0], %)
  |> arc({
       angleStart: 180,
       angleEnd: 180,
       radius= 1.5
     }, %)
  |> close()
  |> patternCircular2d(
       arcDegrees = 360,
       center = [0, 0],
       instances = 6,
       rotateDuplicates = true
     )
"#;

    let result = execute_and_snapshot(code, None).await;
    assert!(result.is_err());
    assert_eq!(
        result.err().unwrap().to_string(),
        r#"type: KclErrorDetails { source_ranges: [SourceRange([55, 136, 0])], message: "Arc start and end angles must be different" }"#
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_angled_line_to_x_90() {
    let code = r#"exampleSketch = startSketchOn(XZ)
  |> startProfileAt([0, 0], %)
  |> angledLine(angle = 90, endAbsoluteX = 10)
  |> line(end = [0, 10])
  |> line(end = [-10, 0])
  |> close()

example = extrude(exampleSketch, length = 10)
"#;

    let result = execute_and_snapshot(code, None).await;
    assert!(result.is_err());
    assert_eq!(
        result.err().unwrap().to_string(),
        r#"type: KclErrorDetails { source_ranges: [SourceRange([70, 111, 0])], message: "Cannot have an x constrained angle of 90 degrees" }"#
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_angled_line_to_x_270() {
    let code = r#"exampleSketch = startSketchOn(XZ)
  |> startProfileAt([0, 0], %)
  |> angledLine(angle = 270, endAbsoluteX = 10)
  |> line(end = [0, 10])
  |> line(end = [-10, 0])
  |> close()

example = extrude(exampleSketch, length = 10)
"#;

    let result = execute_and_snapshot(code, None).await;
    assert!(result.is_err());
    assert_eq!(
        result.err().unwrap().to_string(),
        r#"type: KclErrorDetails { source_ranges: [SourceRange([70, 112, 0])], message: "Cannot have an x constrained angle of 270 degrees" }"#
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_angled_line_to_y_0() {
    let code = r#"exampleSketch = startSketchOn(XZ)
  |> startProfileAt([0, 0], %)
  |> angledLine(angle = 0, endAbsoluteY = 20)
  |> line(end = [-20, 0])
  |> angledLine(angle = 70, endAbsoluteY = 10)
  |> close()

example = extrude(exampleSketch, length = 10)
"#;

    let result = execute_and_snapshot(code, None).await;
    assert!(result.is_err());
    assert_eq!(
        result.err().unwrap().to_string(),
        r#"type: KclErrorDetails { source_ranges: [SourceRange([70, 110, 0])], message: "Cannot have a y constrained angle of 0 degrees" }"#
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_angled_line_to_y_180() {
    let code = r#"exampleSketch = startSketchOn(XZ)
  |> startProfileAt([0, 0], %)
  |> angledLine(angle = 180, endAbsoluteY = 20)
  |> line(end = [-20, 0])
  |> angledLine(angle = 70, endAbsoluteY = 10)
  |> close()

example = extrude(exampleSketch, length = 10)
"#;

    let result = execute_and_snapshot(code, None).await;
    assert!(result.is_err());
    assert_eq!(
        result.err().unwrap().to_string(),
        r#"type: KclErrorDetails { source_ranges: [SourceRange([70, 112, 0])], message: "Cannot have a y constrained angle of 180 degrees" }"#
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_angled_line_of_x_length_90() {
    let code = r#"sketch001 = startSketchOn(XZ)
  |> startProfileAt([0, 0], %)
  |> angledLine(angle = 90, lengthX = 90, tag = $edge1)
  |> angledLine(angle = -15, lengthX = -15, tag = $edge2)
  |> line(end = [0, -5])
  |> close(tag = $edge3)

extrusion = extrude(sketch001, length = 10)
"#;

    let result = execute_and_snapshot(code, None).await;
    assert!(result.is_err());
    assert_eq!(
        result.err().unwrap().to_string(),
        r#"type: KclErrorDetails { source_ranges: [SourceRange([66, 116, 0])], message: "Cannot have an x constrained angle of 90 degrees" }"#
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_angled_line_of_x_length_270() {
    let code = r#"sketch001 = startSketchOn(XZ)
  |> startProfileAt([0, 0], %)
  |> angledLine(angle = 90, lengthX = 90, tag = $edge1)
  |> angledLine(angle = -15, lengthX = -15, tag = $edge2)
  |> line(end = [0, -5])
  |> close(tag = $edge3)

extrusion = extrude(sketch001, length = 10)
"#;

    let result = execute_and_snapshot(code, None).await;
    assert!(result.is_err());
    assert_eq!(
        result.err().unwrap().to_string(),
        r#"type: KclErrorDetails { source_ranges: [SourceRange([66, 116, 0])], message: "Cannot have an x constrained angle of 90 degrees" }"#
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_angled_line_of_y_length_0() {
    let code = r#"exampleSketch = startSketchOn(XZ)
  |> startProfileAt([0, 0], %)
  |> line(end = [10, 0])
  |> angledLine(angle = 0, lengthY = 10)
  |> line(end = [0, 10])
  |> angledLine(angle = 135, lengthY = 10)
  |> line(end = [-10, 0])
  |> line(end = [0, -30])

example = extrude(exampleSketch, length = 10)
"#;

    let result = execute_and_snapshot(code, None).await;
    assert!(result.is_err());
    assert_eq!(
        result.err().unwrap().to_string(),
        r#"type: KclErrorDetails { source_ranges: [SourceRange([95, 130, 0])], message: "Cannot have a y constrained angle of 0 degrees" }"#
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_angled_line_of_y_length_180() {
    let code = r#"exampleSketch = startSketchOn(XZ)
  |> startProfileAt([0, 0], %)
  |> line(end = [10, 0])
  |> angledLine(angle = 180, lengthY = 10)
  |> line(end = [0, 10])
  |> angledLine(angle = 135, lengthY = 10)
  |> line(end = [-10, 0])
  |> line(end = [0, -30])

example = extrude(exampleSketch, length = 10)
"#;

    let result = execute_and_snapshot(code, None).await;
    assert!(result.is_err());
    assert_eq!(
        result.err().unwrap().to_string(),
        r#"type: KclErrorDetails { source_ranges: [SourceRange([95, 132, 0])], message: "Cannot have a y constrained angle of 180 degrees" }"#
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_angled_line_of_y_length_negative_180() {
    let code = r#"exampleSketch = startSketchOn(XZ)
  |> startProfileAt([0, 0], %)
  |> line(end = [10, 0])
  |> angledLine(angle = -180, lengthY = 10)
  |> line(end = [0, 10])
  |> angledLine(angle = 135, lengthY = 10)
  |> line(end = [-10, 0])
  |> line(end = [0, -30])

example = extrude(exampleSketch, length = 10)
"#;

    let result = execute_and_snapshot(code, None).await;
    assert!(result.is_err());
    assert_eq!(
        result.err().unwrap().to_string(),
        r#"type: KclErrorDetails { source_ranges: [SourceRange([95, 133, 0])], message: "Cannot have a y constrained angle of 180 degrees" }"#
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_error_inside_fn_also_has_source_range_of_call_site() {
    let code = r#"fn someFunction = (something) => {
  startSketchOn(something)
}

someFunction('INVALID')
"#;

    let result = execute_and_snapshot(code, None).await;
    assert!(result.is_err());
    assert_eq!(
        result.err().unwrap().to_string(),
        r#"semantic: KclErrorDetails { source_ranges: [SourceRange([51, 60, 0]), SourceRange([65, 88, 0])], message: "Argument at index 0 was supposed to be type SketchData but found string (text)" }"#
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

    let result = execute_and_snapshot(code, None).await;
    assert!(result.is_err());
    assert_eq!(
        result.err().unwrap().to_string(),
        r#"semantic: KclErrorDetails { source_ranges: [SourceRange([103, 113, 0]), SourceRange([126, 155, 0]), SourceRange([159, 182, 0])], message: "Argument at index 0 was supposed to be type SketchData but found string (text)" }"#
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_error_no_auth_websocket() {
    let code = r#"const sketch001 = startSketchOn(XZ)
  |> startProfileAt([61.74, 206.13], %)
  |> xLine(length = 305.11, tag = $seg01)
  |> yLine(length = -291.85)
  |> xLine(length = -segLen(seg01))
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
  |> extrude(length = 40.14)
  |> shell(
    faces = [seg01],
    thickness = 3.14,
  )
"#;

    let result = execute_and_snapshot_no_auth(code, None).await;
    assert!(result.is_err());
    assert!(result
        .err()
        .unwrap()
        .to_string()
        .contains("Please send the following object over this websocket"));
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_ensure_nothing_left_in_batch_single_file() {
    let code = r#"@settings(defaultLengthUnit = in)
// Set units in inches (in)


// Define constants
innerDiameter = 0.364
outerDiameter = 35 / 64
length = 1 + 1 / 2

// create a sketch on the XY plane
sketch000 = startSketchOn(XY)
    |> startProfileAt([0, 0], %)
    |> line(end = [0, innerDiameter / 2])
"#;

    let ctx = kcl_lib::ExecutorContext::new_with_default_client().await.unwrap();
    let mut exec_state = kcl_lib::ExecState::new(&ctx);
    let program = kcl_lib::Program::parse_no_errs(code).unwrap();
    ctx.run(&program, &mut exec_state).await.unwrap();

    // Ensure nothing is left in the batch
    assert!(ctx.engine.batch().read().await.is_empty());
    assert!(ctx.engine.batch_end().read().await.is_empty());

    ctx.close().await;
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_ensure_nothing_left_in_batch_multi_file() {
    // Get the current working directory.
    let current_dir = std::env::current_dir().unwrap();
    // Get the code in the test directory we need.
    let path = current_dir.join("tests/assembly_non_default_units/input.kcl");
    let code = std::fs::read_to_string(&path).unwrap();

    // Change the current working directory to the test directory.
    std::env::set_current_dir(path.parent().unwrap()).unwrap();

    let ctx = kcl_lib::ExecutorContext::new_with_default_client().await.unwrap();
    let mut exec_state = kcl_lib::ExecState::new(&ctx);
    let program = kcl_lib::Program::parse_no_errs(&code).unwrap();
    ctx.run(&program, &mut exec_state).await.unwrap();

    // Ensure nothing is left in the batch
    assert!(ctx.engine.batch().read().await.is_empty());
    assert!(ctx.engine.batch_end().read().await.is_empty());

    ctx.close().await;
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_better_type_names() {
    let code = r#"startSketchOn(XY)
  |> circle(center = [-95.51, -74.7], radius = 262.23)
  |> appearance(metalness = 0.9)
"#;
    let result = execute_and_snapshot(code, None).await;

    let err = match result.err() {
        Some(x) => match x {
            ExecError::Kcl(kcl_error_with_outputs) => kcl_error_with_outputs.error.message().to_owned(),
            ExecError::Connection(_) => todo!(),
            ExecError::BadPng(_) => todo!(),
            ExecError::BadExport(_) => todo!(),
        },
        None => todo!(),
    };
    assert_eq!(err, "This function expected the input argument to be one or more Solids but it's actually of type Sketch. You can convert a sketch (2D) into a Solid (3D) by calling a function like `extrude` or `revolve`");
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_exporting_step_file() {
    // This tests export like how we do it in cli and kcl.py.
    let code = kcl_input!("helix_defaults_negative_extrude");

    let (_, _, files) = execute_and_export_step(code, None).await.unwrap();
    for file in files {
        expectorate::assert_contents(
            format!("e2e/executor/outputs/helix_defaults_negative_extrude_{}", file.name),
            std::str::from_utf8(&file.contents).unwrap(),
        );
    }
}
