mod cache;
mod execution_order;

use kcl_lib::BacktraceItem;
use kcl_lib::BacktraceItemKind;
use kcl_lib::ModuleId;
use kcl_lib::SourceRange;
use kcl_lib::test_server::execute;
use kcl_lib::test_server::execute_and_export_step;
use kcl_lib::test_server::execute_and_snapshot_legacy_sim_test;
use kcl_lib::test_server::execute_and_snapshot_no_auth;

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
    if let Err(err) = twenty_twenty::try_assert_image(&path, result, MIN_DIFF) {
        panic!("Image assertion failed for test {test_name}: {err}");
    }

    path
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_import_file_doesnt_exist() {
    let code = r#"import 'thing.obj'
model = cube"#;

    let result = execute(code, None).await;
    let err = result.unwrap_err();
    let err = err.as_kcl_error().unwrap();
    assert_eq!(err.message(), "File `thing.obj` does not exist.");
    assert_eq!(
        err.backtrace(),
        vec![BacktraceItem {
            source_range: SourceRange::new(0, 18, ModuleId::default()),
            fn_name: None,
            kind: BacktraceItemKind::Call,
        }]
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_import_ext_doesnt_match() {
    let code = r#"@(format = obj, lengthUnit = m)
import 'e2e/executor/inputs/cube.gltf'
model = cube"#;

    let result = execute(code, None).await;
    let err = result.unwrap_err();
    let err = err.as_kcl_error().unwrap();
    assert_eq!(
        err.message(),
        "The given format does not match the file extension. Expected: `gltf`, Given: `obj`"
    );
    assert_eq!(
        err.backtrace(),
        vec![BacktraceItem {
            source_range: SourceRange::new(32, 70, ModuleId::default()),
            fn_name: None,
            kind: BacktraceItemKind::Call,
        }]
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_error_empty_start_sketch_on_string() {
    let code = r#"part001 = startSketchOn(-XZ)
  |> startProfile(at = [75.75, 184.25])
  |> line(end = [190.03, -118.13])
  |> line(end = [-33.38, -202.86])
  |> line(end = [-315.86, -64.2])
  |> tangentialArc(endAbsolute = [-147.66, 121.34])
  |> close()
  |> extrude(length = 100)

secondSketch = startSketchOn(part001, face = '')
  |> circle(center = [-20, 50], radius= 40)
  |> extrude(length = 20)
"#;

    let result = execute(code, None).await;
    let err = result.unwrap_err();
    let err = err.as_kcl_error().unwrap();
    assert_eq!(
        err.message(),
        "face requires a value with type `TaggedFace` or a value with type `Segment` (`TaggedFace | Segment`), but found a value with type `string`."
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_error_user_function_wrong_args() {
    let code = r#"length = .750
width = 0.500
height = 0.500
dia = 4

fn squareHole(l, w) {
  squareHoleSketch = startSketchOn(XY)
  |> startProfile(at = [-width / 2, -length / 2])
  |> line(endAbsolute = [width / 2, -length / 2])
  |> line(endAbsolute = [width / 2, length / 2])
  |> line(endAbsolute = [-width / 2, length / 2])
  |> close()
  return squareHoleSketch
}

extrusion = startSketchOn(XY)
  |> circle(center = [0, 0], radius= dia/2 )
  |> subtract2d(tool = squareHole(l = length, w = width, h = height))
  |> extrude(length = height)
"#;

    let result = execute(code, None).await;
    assert!(result.is_err());
    let expected_msg = "semantic: `h` is not an argument of `squareHole`";
    let err = result.unwrap_err().as_kcl_error().unwrap().get_message();
    assert_eq!(err, expected_msg);
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
  |> startProfile(at = [-foot1Length, 0])
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

    let result = execute_and_snapshot_legacy_sim_test(code, None).await.unwrap();
    assert_out("fillets_referencing_other_fillets", &result);
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_delete_face_on_chamfer_edgecut() {
    let code = r#"@settings(kclVersion = 2.0)

sketch001 = sketch(on = XY) {
  line1 = line(start = [var 0.52mm, var 0.57mm], end = [var 3.88mm, var 0.77mm])
  line2 = line(start = [var 3.88mm, var 0.77mm], end = [var 3.88mm, var 3.12mm])
  line3 = line(start = [var 3.88mm, var 3.12mm], end = [var 0.83mm, var 3.12mm])
  line4 = line(start = [var 0.83mm, var 3.12mm], end = [var 0mm, var 0mm])
  coincident([line1.end, line2.start])
  coincident([line2.end, line3.start])
  coincident([line3.end, line4.start])
  coincident([line4.end, line1.start])
  parallel([line2, line4])
  parallel([line3, line1])
  perpendicular([line1, line2])
  horizontal(line3)
  coincident([line4.end, ORIGIN])
}
region001 = region(point = [1.9352069mm, 0.0025mm], sketch = sketch001)
extrude001 = extrude(region001, length = 5, tagEnd = $capEnd001)
chamfer001 = chamfer(
  extrude001,
  tags = getCommonEdge(faces = [region001.tags.line1, capEnd001]), length = 1, tag = $chamfer001Tag)
surface001 = deleteFace(chamfer001, faces = chamfer001Tag)
"#;

    execute(code, None).await.unwrap();
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_duplicate_tags_should_error() {
    let code = r#"fn triangle(@len) {
  return startSketchOn(XY)
  |> startProfile(at = [-len / 2, -len / 2])
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

p = triangle(200)
"#;

    let result = execute(code, None).await;
    let err = result.unwrap_err();
    let err = err.as_kcl_error().unwrap();
    assert_eq!(err.message(), "Cannot redefine `a`");
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_angled_line_to_x_90() {
    let code = r#"exampleSketch = startSketchOn(XZ)
  |> startProfile(at = [0, 0])
  |> angledLine(angle = 90, endAbsoluteX = 10)
  |> line(end = [0, 10])
  |> line(end = [-10, 0])
  |> close()

example = extrude(exampleSketch, length = 10)
"#;

    let result = execute(code, None).await;
    let err = result.unwrap_err();
    let err = err.as_kcl_error().unwrap();
    assert_eq!(err.message(), "Cannot have an x constrained angle of 90 degrees");
    assert_eq!(
        err.backtrace(),
        vec![
            BacktraceItem {
                source_range: SourceRange::new(70, 111, ModuleId::default()),
                fn_name: Some("angledLine".to_owned()),
                kind: BacktraceItemKind::Call,
            },
            BacktraceItem {
                source_range: SourceRange::new(70, 111, ModuleId::default()),
                fn_name: None,
                kind: BacktraceItemKind::Call,
            }
        ]
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_angled_line_to_x_270() {
    let code = r#"exampleSketch = startSketchOn(XZ)
  |> startProfile(at = [0, 0])
  |> angledLine(angle = 270, endAbsoluteX = 10)
  |> line(end = [0, 10])
  |> line(end = [-10, 0])
  |> close()

example = extrude(exampleSketch, length = 10)
"#;

    let result = execute(code, None).await;
    let err = result.unwrap_err();
    let err = err.as_kcl_error().unwrap();
    assert_eq!(err.message(), "Cannot have an x constrained angle of 270 degrees");
    assert_eq!(
        err.backtrace(),
        vec![
            BacktraceItem {
                source_range: SourceRange::new(70, 112, ModuleId::default()),
                fn_name: Some("angledLine".to_owned()),
                kind: BacktraceItemKind::Call,
            },
            BacktraceItem {
                source_range: SourceRange::new(70, 112, ModuleId::default()),
                fn_name: None,
                kind: BacktraceItemKind::Call,
            }
        ]
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_angled_line_to_y_0() {
    let code = r#"exampleSketch = startSketchOn(XZ)
  |> startProfile(at = [0, 0])
  |> angledLine(angle = 0, endAbsoluteY = 20)
  |> line(end = [-20, 0])
  |> angledLine(angle = 70, endAbsoluteY = 10)
  |> close()

example = extrude(exampleSketch, length = 10)
"#;

    let result = execute(code, None).await;
    let err = result.unwrap_err();
    let err = err.as_kcl_error().unwrap();
    assert_eq!(err.message(), "Cannot have a y constrained angle of 0 degrees");
    assert_eq!(
        err.backtrace(),
        vec![
            BacktraceItem {
                source_range: SourceRange::new(70, 110, ModuleId::default()),
                fn_name: Some("angledLine".to_owned()),
                kind: BacktraceItemKind::Call,
            },
            BacktraceItem {
                source_range: SourceRange::new(70, 110, ModuleId::default()),
                fn_name: None,
                kind: BacktraceItemKind::Call,
            }
        ]
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_angled_line_to_y_180() {
    let code = r#"exampleSketch = startSketchOn(XZ)
  |> startProfile(at = [0, 0])
  |> angledLine(angle = 180, endAbsoluteY = 20)
  |> line(end = [-20, 0])
  |> angledLine(angle = 70, endAbsoluteY = 10)
  |> close()

example = extrude(exampleSketch, length = 10)
"#;

    let result = execute(code, None).await;
    let err = result.unwrap_err();
    let err = err.as_kcl_error().unwrap();
    assert_eq!(err.message(), "Cannot have a y constrained angle of 180 degrees");
    assert_eq!(
        err.backtrace(),
        vec![
            BacktraceItem {
                source_range: SourceRange::new(70, 112, ModuleId::default()),
                fn_name: Some("angledLine".to_owned()),
                kind: BacktraceItemKind::Call,
            },
            BacktraceItem {
                source_range: SourceRange::new(70, 112, ModuleId::default()),
                fn_name: None,
                kind: BacktraceItemKind::Call,
            }
        ]
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_angled_line_of_x_length_90() {
    let code = r#"sketch001 = startSketchOn(XZ)
  |> startProfile(at = [0, 0])
  |> angledLine(angle = 90, lengthX = 90, tag = $edge1)
  |> angledLine(angle = -15, lengthX = -15, tag = $edge2)
  |> line(end = [0, -5])
  |> close(tag = $edge3)

extrusion = extrude(sketch001, length = 10)
"#;

    let result = execute(code, None).await;
    let err = result.unwrap_err();
    let err = err.as_kcl_error().unwrap();
    assert_eq!(err.message(), "Cannot have an x constrained angle of 90 degrees");
    assert_eq!(
        err.backtrace(),
        vec![
            BacktraceItem {
                source_range: SourceRange::new(66, 116, ModuleId::default()),
                fn_name: Some("angledLine".to_owned()),
                kind: BacktraceItemKind::Call,
            },
            BacktraceItem {
                source_range: SourceRange::new(66, 116, ModuleId::default()),
                fn_name: None,
                kind: BacktraceItemKind::Call,
            }
        ]
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_angled_line_of_x_length_270() {
    let code = r#"sketch001 = startSketchOn(XZ)
  |> startProfile(at = [0, 0])
  |> angledLine(angle = 270, lengthX = 90, tag = $edge1)
  |> angledLine(angle = -15, lengthX = -15, tag = $edge2)
  |> line(end = [0, -5])
  |> close(tag = $edge3)

extrusion = extrude(sketch001, length = 10)
"#;

    let result = execute(code, None).await;
    let err = result.unwrap_err();
    let err = err.as_kcl_error().unwrap();
    assert_eq!(err.message(), "Cannot have an x constrained angle of 270 degrees");
    assert_eq!(
        err.backtrace(),
        vec![
            BacktraceItem {
                source_range: SourceRange::new(66, 117, ModuleId::default()),
                fn_name: Some("angledLine".to_owned()),
                kind: BacktraceItemKind::Call,
            },
            BacktraceItem {
                source_range: SourceRange::new(66, 117, ModuleId::default()),
                fn_name: None,
                kind: BacktraceItemKind::Call,
            }
        ]
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_angled_line_of_y_length_0() {
    let code = r#"exampleSketch = startSketchOn(XZ)
  |> startProfile(at = [0, 0])
  |> line(end = [10, 0])
  |> angledLine(angle = 0, lengthY = 10)
  |> line(end = [0, 10])
  |> angledLine(angle = 135, lengthY = 10)
  |> line(end = [-10, 0])
  |> line(end = [0, -30])

example = extrude(exampleSketch, length = 10)
"#;

    let result = execute(code, None).await;
    let err = result.unwrap_err();
    let err = err.as_kcl_error().unwrap();
    assert_eq!(err.message(), "Cannot have a y constrained angle of 0 degrees");
    assert_eq!(
        err.backtrace(),
        vec![
            BacktraceItem {
                source_range: SourceRange::new(95, 130, ModuleId::default()),
                fn_name: Some("angledLine".to_owned()),
                kind: BacktraceItemKind::Call,
            },
            BacktraceItem {
                source_range: SourceRange::new(95, 130, ModuleId::default()),
                fn_name: None,
                kind: BacktraceItemKind::Call,
            }
        ]
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_angled_line_of_y_length_180() {
    let code = r#"exampleSketch = startSketchOn(XZ)
  |> startProfile(at = [0, 0])
  |> line(end = [10, 0])
  |> angledLine(angle = 180, lengthY = 10)
  |> line(end = [0, 10])
  |> angledLine(angle = 135, lengthY = 10)
  |> line(end = [-10, 0])
  |> line(end = [0, -30])

example = extrude(exampleSketch, length = 10)
"#;

    let result = execute(code, None).await;
    let err = result.unwrap_err();
    let err = err.as_kcl_error().unwrap();
    assert_eq!(err.message(), "Cannot have a y constrained angle of 180 degrees");
    assert_eq!(
        err.backtrace(),
        vec![
            BacktraceItem {
                source_range: SourceRange::new(95, 132, ModuleId::default()),
                fn_name: Some("angledLine".to_owned()),
                kind: BacktraceItemKind::Call,
            },
            BacktraceItem {
                source_range: SourceRange::new(95, 132, ModuleId::default()),
                fn_name: None,
                kind: BacktraceItemKind::Call,
            }
        ]
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_angled_line_of_y_length_negative_180() {
    let code = r#"exampleSketch = startSketchOn(XZ)
  |> startProfile(at = [0, 0])
  |> line(end = [10, 0])
  |> angledLine(angle = -180, lengthY = 10)
  |> line(end = [0, 10])
  |> angledLine(angle = 135, lengthY = 10)
  |> line(end = [-10, 0])
  |> line(end = [0, -30])

example = extrude(exampleSketch, length = 10)
"#;

    let result = execute(code, None).await;
    let err = result.unwrap_err();
    let err = err.as_kcl_error().unwrap();
    assert_eq!(err.message(), "Cannot have a y constrained angle of 180 degrees");
    assert_eq!(
        err.backtrace(),
        vec![
            BacktraceItem {
                source_range: SourceRange::new(95, 133, ModuleId::default()),
                fn_name: Some("angledLine".to_owned()),
                kind: BacktraceItemKind::Call,
            },
            BacktraceItem {
                source_range: SourceRange::new(95, 133, ModuleId::default()),
                fn_name: None,
                kind: BacktraceItemKind::Call,
            }
        ]
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_error_inside_fn_also_has_source_range_of_call_site() {
    let code = r#"fn someFunction(@something) {
  startSketchOn(something)
}

someFunction('INVALID')
"#;

    let result = execute(code, None).await;
    let err = result.unwrap_err();
    let err = err.as_kcl_error().unwrap();
    assert_eq!(
        err.message(),
        "The input argument of `startSketchOn` requires a value with type `Solid` or a value with type `Plane` (`Solid | Plane`), but found a value with type `string`."
    );
    assert_eq!(
        err.source_ranges(),
        vec![
            SourceRange::new(46, 55, ModuleId::default()),
            SourceRange::new(32, 56, ModuleId::default()),
            SourceRange::new(60, 83, ModuleId::default()),
        ]
    );
    assert_eq!(
        err.backtrace(),
        vec![
            BacktraceItem {
                source_range: SourceRange::new(46, 55, ModuleId::default()),
                fn_name: Some("startSketchOn".to_owned()),
                kind: BacktraceItemKind::Call,
            },
            BacktraceItem {
                source_range: SourceRange::new(32, 56, ModuleId::default()),
                fn_name: Some("someFunction".to_owned()),
                kind: BacktraceItemKind::Call,
            },
            BacktraceItem {
                source_range: SourceRange::new(60, 83, ModuleId::default()),
                fn_name: None,
                kind: BacktraceItemKind::Call,
            },
        ]
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_error_no_auth_websocket() {
    let code = r#"sketch001 = startSketchOn(XZ)
  |> startProfile(at = [61.74, 206.13])
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
    let err = result.unwrap_err();
    let err = err.as_kcl_error().unwrap();
    assert!(err.message().contains("Authorization"), "actual: {}", err.message());
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_error_no_csg_overlap() {
    // Test that if you do a CSG operation where the bodies don't have any overlap,
    // you get a warning about it. That warning can be upgraded to an error, if the
    // user configures it to.
    let code = kcl_input!("no_csg_overlap");

    let result = execute(code, None).await;
    let err = result.unwrap_err();
    let err = err.as_kcl_error().unwrap();
    // The error message should be meaningful.
    assert!(
        err.message().contains("The bodies in this subtraction had no overlap"),
        "actual: {}",
        err.message()
    );
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
    |> startProfile(at = [0, 0])
    |> line(end = [0, innerDiameter / 2])
"#;

    let ctx = kcl_lib::ExecutorContext::new_geometry_only_with_version(kcl_api::KclVersion::V2)
        .await
        .unwrap();
    let mut exec_state = kcl_lib::ExecState::new(&ctx);
    let program = kcl_lib::Program::parse_no_errs(code).unwrap();
    ctx.run(&program, &mut exec_state).await.unwrap();

    // Ensure nothing is left in the batch
    assert!(ctx.engine_batch.is_empty().await);

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

    let ctx = kcl_lib::ExecutorContext::new_geometry_only_with_version(kcl_api::KclVersion::V2)
        .await
        .unwrap();
    let mut exec_state = kcl_lib::ExecState::new(&ctx);
    let program = kcl_lib::Program::parse_no_errs(&code).unwrap();
    ctx.run(&program, &mut exec_state).await.unwrap();

    // Ensure nothing is left in the batch
    assert!(ctx.engine_batch.is_empty().await);

    ctx.close().await;
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_exporting_step_file() {
    // This tests export like how we do it in cli and kcl.py.
    let code = include_str!("../../tests/helix_defaults_negative_extrude/input.kcl");

    let (_, _, files) = execute_and_export_step(code, None).await.unwrap();
    for file in files {
        expectorate::assert_contents(
            format!("e2e/executor/outputs/helix_defaults_negative_extrude_{}", file.name),
            std::str::from_utf8(&file.contents).unwrap(),
        );
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_gear_with_units() {
    // This tests export like how we do it in cli and kcl.py.
    let code = kcl_input!("gear_units");

    let (_, _, _files) = execute_and_export_step(code, None).await.unwrap();
}
