//! Cache testing framework.

use kcl_lib::{bust_cache, ExecError, ExecOutcome};
use kcmc::{each_cmd as mcmd, ModelingCmd};
use kittycad_modeling_cmds as kcmc;
use pretty_assertions::assert_eq;

#[derive(Debug)]
struct Variation<'a> {
    code: &'a str,
    other_files: Vec<(std::path::PathBuf, std::string::String)>,
    settings: &'a kcl_lib::ExecutorSettings,
}

async fn cache_test(
    test_name: &str,
    variations: Vec<Variation<'_>>,
) -> Vec<(String, image::DynamicImage, ExecOutcome)> {
    let first = variations
        .first()
        .ok_or_else(|| anyhow::anyhow!("No variations provided for test '{}'", test_name))
        .unwrap();

    let mut ctx = kcl_lib::ExecutorContext::new_with_client(first.settings.clone(), None, None)
        .await
        .unwrap();

    bust_cache().await;
    let mut img_results = Vec::new();
    for (index, variation) in variations.iter().enumerate() {
        let program = kcl_lib::Program::parse_no_errs(variation.code).unwrap();

        // set the new settings.
        ctx.settings = variation.settings.clone();

        if !variation.other_files.is_empty() {
            let tmp_dir = std::env::temp_dir();
            let tmp_dir = tmp_dir
                .join(format!("kcl_test_{}", test_name))
                .join(uuid::Uuid::new_v4().to_string());

            // Create a temporary file for each of the other files.
            for (variant_path, variant_code) in &variation.other_files {
                let tmp_file = tmp_dir.join(variant_path);
                std::fs::create_dir_all(tmp_file.parent().unwrap()).unwrap();
                std::fs::write(tmp_file, variant_code).unwrap();
            }

            ctx.settings.project_directory = Some(kcl_lib::TypedPath(tmp_dir.clone()));
        }

        let outcome = match ctx.run_with_caching(program).await {
            Ok(outcome) => outcome,
            Err(error) => {
                let report = error.clone().into_miette_report_with_outputs(variation.code).unwrap();
                let report = miette::Report::new(report);
                panic!("{:?}", report);
            }
        };

        let snapshot_png_bytes = ctx.prepare_snapshot().await.unwrap().contents.0;

        // Decode the snapshot, return it.
        let img = image::ImageReader::new(std::io::Cursor::new(snapshot_png_bytes))
            .with_guessed_format()
            .map_err(|e| ExecError::BadPng(e.to_string()))
            .and_then(|x| x.decode().map_err(|e| ExecError::BadPng(e.to_string())))
            .unwrap();
        // Save the snapshot.
        let path = crate::assert_out(&format!("cache_{}_{}", test_name, index), &img);

        img_results.push((path, img, outcome));
    }

    ctx.close().await;

    img_results
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_cache_change_grid_visualizes_grid_off_to_on() {
    let code = r#"part001 = startSketchOn(XY)
  |> startProfile(at = [5.5229, 5.25217])
  |> line(end = [10.50433, -1.19122])
  |> line(end = [8.01362, -5.48731])
  |> line(end = [-1.02877, -6.76825])
  |> line(end = [-11.53311, 2.81559])
  |> close()
  |> extrude(length = 4)
"#;

    let result = cache_test(
        "change_grid_visualizes_grid_off_to_on",
        vec![
            Variation {
                code,
                other_files: vec![],
                settings: &kcl_lib::ExecutorSettings {
                    show_grid: false,
                    ..Default::default()
                },
            },
            Variation {
                code,
                other_files: vec![],
                settings: &kcl_lib::ExecutorSettings {
                    show_grid: true,
                    ..Default::default()
                },
            },
        ],
    )
    .await;

    let first = result.first().unwrap();
    let second = result.last().unwrap();

    assert!(first.1 != second.1);
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_cache_change_grid_visualizes_grid_on_to_off() {
    let code = r#"part001 = startSketchOn(XY)
  |> startProfile(at = [5.5229, 5.25217])
  |> line(end = [10.50433, -1.19122])
  |> line(end = [8.01362, -5.48731])
  |> line(end = [-1.02877, -6.76825])
  |> line(end = [-11.53311, 2.81559])
  |> close()
  |> extrude(length = 4)
"#;

    let result = cache_test(
        "change_grid_visualizes_grid_on_to_off",
        vec![
            Variation {
                code,
                other_files: vec![],
                settings: &kcl_lib::ExecutorSettings {
                    show_grid: true,
                    ..Default::default()
                },
            },
            Variation {
                code,
                other_files: vec![],
                settings: &kcl_lib::ExecutorSettings {
                    show_grid: false,
                    ..Default::default()
                },
            },
        ],
    )
    .await;

    let first = result.first().unwrap();
    let second = result.last().unwrap();

    assert!(first.1 != second.1);
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_cache_change_highlight_edges_changes_visual() {
    let code = r#"part001 = startSketchOn(XY)
  |> startProfile(at = [5.5229, 5.25217])
  |> line(end = [10.50433, -1.19122])
  |> line(end = [8.01362, -5.48731])
  |> line(end = [-1.02877, -6.76825])
  |> line(end = [-11.53311, 2.81559])
  |> close()
  |> extrude(length = 4)
"#;

    let result = cache_test(
        "change_highlight_edges_changes_visual",
        vec![
            Variation {
                code,
                other_files: vec![],
                settings: &kcl_lib::ExecutorSettings {
                    highlight_edges: true,
                    ..Default::default()
                },
            },
            Variation {
                code,
                other_files: vec![],
                settings: &kcl_lib::ExecutorSettings {
                    highlight_edges: false,
                    ..Default::default()
                },
            },
        ],
    )
    .await;

    let first = result.first().unwrap();
    let second = result.last().unwrap();

    assert!(first.1 != second.1);
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_cache_multi_file_same_code_dont_reexecute() {
    let code = r#"import "toBeImported.kcl" as importedCube

importedCube

sketch001 = startSketchOn(XZ)
profile001 = startProfile(sketch001, at = [-134.53, -56.17])
  |> angledLine(angle = 0, length = 79.05, tag = $rectangleSegmentA001)
  |> angledLine(angle = segAng(rectangleSegmentA001) - 90, length = 76.28)
  |> angledLine(angle = segAng(rectangleSegmentA001), length = -segLen(rectangleSegmentA001), tag = $seg01)
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)], tag = $seg02)
  |> close()
extrude001 = extrude(profile001, length = 100)
sketch003 = startSketchOn(extrude001, face = seg02)
sketch002 = startSketchOn(extrude001, face = seg01)
"#;

    let other_file = (
        std::path::PathBuf::from("toBeImported.kcl"),
        r#"sketch001 = startSketchOn(XZ)
profile001 = startProfile(sketch001, at = [281.54, 305.81])
  |> angledLine(angle = 0, length = 123.43, tag = $rectangleSegmentA001)
  |> angledLine(angle = segAng(rectangleSegmentA001) - 90, length = 85.99)
  |> angledLine(angle = segAng(rectangleSegmentA001), length = -segLen(rectangleSegmentA001))
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
extrude(profile001, length = 100)"#
            .to_string(),
    );

    let result = cache_test(
        "multi_file_same_code_dont_reexecute",
        vec![
            Variation {
                code,
                other_files: vec![other_file.clone()],
                settings: &Default::default(),
            },
            Variation {
                code,
                other_files: vec![other_file],
                settings: &Default::default(),
            },
        ],
    )
    .await;

    let first = result.first().unwrap();
    let last = result.last().unwrap();

    assert!(first.1 == last.1, "The images should be the same");
    assert_eq!(first.2, last.2, "The outcomes should be the same");
}

#[cfg(feature = "artifact-graph")]
#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_cache_add_line_preserves_artifact_commands() {
    let code = r#"sketch001 = startSketchOn(XY)
  |> startProfile(at = [5.5229, 5.25217])
  |> line(end = [10.50433, -1.19122])
  |> line(end = [8.01362, -5.48731])
  |> line(end = [-1.02877, -6.76825])
  |> line(end = [-11.53311, 2.81559])
  |> close()
"#;
    // Use a new statement; don't extend the prior pipeline.  This allows us to
    // detect a prefix.
    let code_with_extrude = code.to_owned()
        + r#"
extrude(sketch001, length = 4)
"#;

    let result = cache_test(
        "add_line_preserves_artifact_commands",
        vec![
            Variation {
                code,
                other_files: vec![],
                settings: &Default::default(),
            },
            Variation {
                code: code_with_extrude.as_str(),
                other_files: vec![],
                settings: &Default::default(),
            },
        ],
    )
    .await;

    let first = &result.first().unwrap().2;
    let second = &result.last().unwrap().2;

    assert!(
        first.artifact_commands.len() < second.artifact_commands.len(),
        "Second should have all the artifact commands of the first, plus more. first={:?}, second={:?}",
        first.artifact_commands.len(),
        second.artifact_commands.len()
    );
    assert!(
        first.artifact_graph.len() < second.artifact_graph.len(),
        "Second should have all the artifacts of the first, plus more. first={:?}, second={:?}",
        first.artifact_graph.len(),
        second.artifact_graph.len()
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_cache_empty_file_pop_cache_empty_file_planes_work() {
    // Get the current working directory.
    let code = "";

    let ctx = kcl_lib::ExecutorContext::new_with_default_client().await.unwrap();
    let program = kcl_lib::Program::parse_no_errs(code).unwrap();
    let outcome = ctx.run_with_caching(program).await.unwrap();

    // Ensure nothing is left in the batch
    assert!(ctx.engine.batch().read().await.is_empty());
    assert!(ctx.engine.batch_end().read().await.is_empty());

    // Ensure the planes work, and we can show or hide them.
    // Hide/show the grid.
    let default_planes = ctx.engine.get_default_planes().read().await.clone().unwrap();

    // Assure the outcome is the same.
    assert_eq!(outcome.default_planes, Some(default_planes.clone()));

    ctx.engine
        .send_modeling_cmd(
            uuid::Uuid::new_v4(),
            Default::default(),
            &ModelingCmd::from(mcmd::ObjectVisible {
                hidden: false,
                object_id: default_planes.xy,
            }),
        )
        .await
        .unwrap();

    // Now simulate an engine pause/network disconnect.
    // Raw dog clear the scene entirely.
    ctx.engine
        .send_modeling_cmd(
            uuid::Uuid::new_v4(),
            Default::default(),
            &ModelingCmd::from(mcmd::SceneClearAll {}),
        )
        .await
        .unwrap();

    // Bust the cache and reset the scene.
    let outcome = ctx.bust_cache_and_reset_scene().await.unwrap();
    // Get the default planes.
    let default_planes = ctx.engine.get_default_planes().read().await.clone().unwrap();

    assert_eq!(outcome.default_planes, Some(default_planes.clone()));

    // Ensure we can show a plane.
    ctx.engine
        .send_modeling_cmd(
            uuid::Uuid::new_v4(),
            Default::default(),
            &ModelingCmd::from(mcmd::ObjectVisible {
                hidden: false,
                object_id: default_planes.xz,
            }),
        )
        .await
        .unwrap();

    ctx.close().await;
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_cache_multi_file_after_empty_with_export() {
    let code = r#"import importedCube from "toBeImported.kcl"

importedCube

sketch001 = startSketchOn(XZ)
profile001 = startProfile(sketch001, at = [-134.53, -56.17])
  |> angledLine(angle = 0, length = 79.05, tag = $rectangleSegmentA001)
  |> angledLine(angle = segAng(rectangleSegmentA001) - 90, length = 76.28)
  |> angledLine(angle = segAng(rectangleSegmentA001), length = -segLen(rectangleSegmentA001), tag = $seg01)
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)], tag = $seg02)
  |> close()
extrude001 = extrude(profile001, length = 100)
sketch003 = startSketchOn(extrude001, face = seg02)
sketch002 = startSketchOn(extrude001, face = seg01)
"#;

    let other_file = (
        std::path::PathBuf::from("toBeImported.kcl"),
        r#"sketch001 = startSketchOn(XZ)
profile001 = startProfile(sketch001, at = [281.54, 305.81])
  |> angledLine(angle = 0, length = 123.43, tag = $rectangleSegmentA001)
  |> angledLine(angle = segAng(rectangleSegmentA001) - 90, length = 85.99)
  |> angledLine(angle = segAng(rectangleSegmentA001), length = -segLen(rectangleSegmentA001))
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
export importedCube = extrude(profile001, length = 100)
"#
        .to_string(),
    );

    let result = cache_test(
        "multi_file_after_empty",
        vec![
            Variation {
                code: "",
                other_files: vec![],
                settings: &Default::default(),
            },
            Variation {
                code,
                other_files: vec![other_file],
                settings: &Default::default(),
            },
        ],
    )
    .await;

    result.first().unwrap();
    result.last().unwrap();
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_cache_multi_file_after_empty_with_woo() {
    let code = r#"import "toBeImported.kcl" as importedCube

importedCube

sketch001 = startSketchOn(XZ)
profile001 = startProfile(sketch001, at = [-134.53, -56.17])
  |> angledLine(angle = 0, length = 79.05, tag = $rectangleSegmentA001)
  |> angledLine(angle = segAng(rectangleSegmentA001) - 90, length = 76.28)
  |> angledLine(angle = segAng(rectangleSegmentA001), length = -segLen(rectangleSegmentA001), tag = $seg01)
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)], tag = $seg02)
  |> close()
extrude001 = extrude(profile001, length = 100)
sketch003 = startSketchOn(extrude001, face = seg02)
sketch002 = startSketchOn(extrude001, face = seg01)
"#;

    let other_file = (
        std::path::PathBuf::from("toBeImported.kcl"),
        r#"sketch001 = startSketchOn(XZ)
profile001 = startProfile(sketch001, at = [281.54, 305.81])
  |> angledLine(angle = 0, length = 123.43, tag = $rectangleSegmentA001)
  |> angledLine(angle = segAng(rectangleSegmentA001) - 90, length = 85.99)
  |> angledLine(angle = segAng(rectangleSegmentA001), length = -segLen(rectangleSegmentA001))
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
extrude(profile001, length = 100)
"#
        .to_string(),
    );

    let result = cache_test(
        "multi_file_after_empty",
        vec![
            Variation {
                code: "",
                other_files: vec![],
                settings: &Default::default(),
            },
            Variation {
                code,
                other_files: vec![other_file],
                settings: &Default::default(),
            },
        ],
    )
    .await;

    result.first().unwrap();
    result.last().unwrap();
}

#[cfg(feature = "artifact-graph")]
#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_cache_multi_file_other_file_only_change() {
    let code = r#"import "toBeImported.kcl" as importedCube

importedCube

sketch001 = startSketchOn(XZ)
profile001 = startProfile(sketch001, at = [-134.53, -56.17])
  |> angledLine(angle = 0, length = 79.05, tag = $rectangleSegmentA001)
  |> angledLine(angle = segAng(rectangleSegmentA001) - 90, length = 76.28)
  |> angledLine(angle = segAng(rectangleSegmentA001), length = -segLen(rectangleSegmentA001), tag = $seg01)
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)], tag = $seg02)
  |> close()
extrude001 = extrude(profile001, length = 100)
sketch003 = startSketchOn(extrude001, face = seg02)
sketch002 = startSketchOn(extrude001, face = seg01)
"#;

    let other_file = (
        std::path::PathBuf::from("toBeImported.kcl"),
        r#"sketch001 = startSketchOn(XZ)
profile001 = startProfile(sketch001, at = [281.54, 305.81])
  |> angledLine(angle = 0, length = 123.43, tag = $rectangleSegmentA001)
  |> angledLine(angle = segAng(rectangleSegmentA001) - 90, length = 85.99)
  |> angledLine(angle = segAng(rectangleSegmentA001), length = -segLen(rectangleSegmentA001))
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
extrude(profile001, length = 100)
"#
        .to_string(),
    );

    let other_file2 = (
        std::path::PathBuf::from("toBeImported.kcl"),
        r#"sketch001 = startSketchOn(XZ)
profile001 = startProfile(sketch001, at = [281.54, 305.81])
  |> angledLine(angle = 0, length = 123.43, tag = $rectangleSegmentA001)
  |> angledLine(angle = segAng(rectangleSegmentA001) - 90, length = 85.99)
  |> angledLine(angle = segAng(rectangleSegmentA001), length = -segLen(rectangleSegmentA001))
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
extrude(profile001, length = 100)
    |> translate(z = 100)
"#
        .to_string(),
    );

    let result = cache_test(
        "multi_file_other_file_only_change",
        vec![
            Variation {
                code,
                other_files: vec![other_file],
                settings: &Default::default(),
            },
            Variation {
                code,
                other_files: vec![other_file2],
                settings: &Default::default(),
            },
        ],
    )
    .await;

    let r1 = result.first().unwrap();
    let r2 = result.last().unwrap();

    assert!(r1.1 != r2.1, "The images should be different");
    // Make sure the outcomes are different.
    assert!(
        r1.2.artifact_graph != r2.2.artifact_graph,
        "The outcomes artifact graphs should be different"
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_cache_multi_file_same_code_dont_reexecute_settings_only_change() {
    let code = r#"import "toBeImported.kcl" as importedCube

importedCube

sketch001 = startSketchOn(XZ)
profile001 = startProfile(sketch001, at = [-134.53, -56.17])
  |> angledLine(angle = 0, length = 79.05, tag = $rectangleSegmentA001)
  |> angledLine(angle = segAng(rectangleSegmentA001) - 90, length = 76.28)
  |> angledLine(angle = segAng(rectangleSegmentA001), length = -segLen(rectangleSegmentA001), tag = $seg01)
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)], tag = $seg02)
  |> close()
extrude001 = extrude(profile001, length = 100)
sketch003 = startSketchOn(extrude001, face = seg02)
sketch002 = startSketchOn(extrude001, face = seg01)
"#;

    let other_file = (
        std::path::PathBuf::from("toBeImported.kcl"),
        r#"sketch001 = startSketchOn(XZ)
profile001 = startProfile(sketch001, at = [281.54, 305.81])
  |> angledLine(angle = 0, length = 123.43, tag = $rectangleSegmentA001)
  |> angledLine(angle = segAng(rectangleSegmentA001) - 90, length = 85.99)
  |> angledLine(angle = segAng(rectangleSegmentA001), length = -segLen(rectangleSegmentA001))
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
extrude(profile001, length = 100)"#
            .to_string(),
    );

    let result = cache_test(
        "multi_file_same_code_dont_reexecute_settings_only_change",
        vec![
            Variation {
                code,
                other_files: vec![other_file.clone()],
                settings: &kcl_lib::ExecutorSettings {
                    show_grid: false,
                    ..Default::default()
                },
            },
            Variation {
                code,
                other_files: vec![other_file],
                settings: &kcl_lib::ExecutorSettings {
                    show_grid: true,
                    ..Default::default()
                },
            },
        ],
    )
    .await;

    let first = result.first().unwrap();
    let last = result.last().unwrap();

    assert!(first.1 != last.1, "The images should be different for the grid");
    assert_eq!(first.2, last.2, "The outcomes should be the same");
}
