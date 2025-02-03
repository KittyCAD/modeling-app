//! Cache testing framework.

use anyhow::Result;
use kcl_lib::{ExecError, ExecState};

#[derive(Debug)]
struct Variation<'a> {
    code: &'a str,
    settings: &'a kcl_lib::ExecutorSettings,
}

async fn cache_test(
    test_name: &str,
    variations: Vec<Variation<'_>>,
) -> Result<Vec<(String, image::DynamicImage, ExecState)>> {
    let first = variations
        .first()
        .ok_or_else(|| anyhow::anyhow!("No variations provided for test '{}'", test_name))?;

    let mut ctx = kcl_lib::ExecutorContext::new_with_client(first.settings.clone(), None, None).await?;
    let mut exec_state = kcl_lib::ExecState::new(&ctx.settings);

    let mut old_ast_state = None;
    let mut img_results = Vec::new();
    for (index, variation) in variations.iter().enumerate() {
        let program = kcl_lib::Program::parse_no_errs(variation.code)?;

        // set the new settings.
        ctx.settings = variation.settings.clone();

        ctx.run(
            kcl_lib::CacheInformation {
                old: old_ast_state,
                new_ast: program.ast.clone(),
            },
            &mut exec_state,
        )
        .await?;
        let snapshot_png_bytes = ctx.prepare_snapshot().await?.contents.0;

        // Decode the snapshot, return it.
        let img = image::ImageReader::new(std::io::Cursor::new(snapshot_png_bytes))
            .with_guessed_format()
            .map_err(|e| ExecError::BadPng(e.to_string()))
            .and_then(|x| x.decode().map_err(|e| ExecError::BadPng(e.to_string())))?;
        // Save the snapshot.
        let path = crate::assert_out(&format!("cache_{}_{}", test_name, index), &img);

        img_results.push((path, img, exec_state.clone()));

        // Prepare the last state.
        old_ast_state = Some(kcl_lib::OldAstState {
            ast: program.ast,
            exec_state: exec_state.clone(),
            settings: variation.settings.clone(),
        });
    }

    ctx.close().await;

    Ok(img_results)
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_cache_change_units_changes_output() {
    let code = r#"part001 = startSketchOn('XY')
  |> startProfileAt([5.5229, 5.25217], %)
  |> line([10.50433, -1.19122], %)
  |> line([8.01362, -5.48731], %)
  |> line([-1.02877, -6.76825], %)
  |> line([-11.53311, 2.81559], %)
  |> close(%)
  |> extrude(4, %)
"#;

    let result = cache_test(
        "change_units_changes_output",
        vec![
            Variation {
                code,
                settings: &kcl_lib::ExecutorSettings {
                    units: kcl_lib::UnitLength::In,
                    ..Default::default()
                },
            },
            Variation {
                code,
                settings: &kcl_lib::ExecutorSettings {
                    units: kcl_lib::UnitLength::Mm,
                    ..Default::default()
                },
            },
        ],
    )
    .await
    .unwrap();

    let first = result.first().unwrap();
    let second = result.last().unwrap();

    assert!(first.1 != second.1);
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_cache_change_grid_visualizes_grid_off_to_on() {
    let code = r#"part001 = startSketchOn('XY')
  |> startProfileAt([5.5229, 5.25217], %)
  |> line([10.50433, -1.19122], %)
  |> line([8.01362, -5.48731], %)
  |> line([-1.02877, -6.76825], %)
  |> line([-11.53311, 2.81559], %)
  |> close(%)
  |> extrude(4, %)
"#;

    let result = cache_test(
        "change_grid_visualizes_grid_off_to_on",
        vec![
            Variation {
                code,
                settings: &kcl_lib::ExecutorSettings {
                    show_grid: false,
                    ..Default::default()
                },
            },
            Variation {
                code,
                settings: &kcl_lib::ExecutorSettings {
                    show_grid: true,
                    ..Default::default()
                },
            },
        ],
    )
    .await
    .unwrap();

    let first = result.first().unwrap();
    let second = result.last().unwrap();

    assert!(first.1 != second.1);
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_cache_change_grid_visualizes_grid_on_to_off() {
    let code = r#"part001 = startSketchOn('XY')
  |> startProfileAt([5.5229, 5.25217], %)
  |> line([10.50433, -1.19122], %)
  |> line([8.01362, -5.48731], %)
  |> line([-1.02877, -6.76825], %)
  |> line([-11.53311, 2.81559], %)
  |> close(%)
  |> extrude(4, %)
"#;

    let result = cache_test(
        "change_grid_visualizes_grid_on_to_off",
        vec![
            Variation {
                code,
                settings: &kcl_lib::ExecutorSettings {
                    show_grid: true,
                    ..Default::default()
                },
            },
            Variation {
                code,
                settings: &kcl_lib::ExecutorSettings {
                    show_grid: false,
                    ..Default::default()
                },
            },
        ],
    )
    .await
    .unwrap();

    let first = result.first().unwrap();
    let second = result.last().unwrap();

    assert!(first.1 != second.1);
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_cache_change_highlight_edges_changes_visual() {
    let code = r#"part001 = startSketchOn('XY')
  |> startProfileAt([5.5229, 5.25217], %)
  |> line([10.50433, -1.19122], %)
  |> line([8.01362, -5.48731], %)
  |> line([-1.02877, -6.76825], %)
  |> line([-11.53311, 2.81559], %)
  |> close(%)
  |> extrude(4, %)
"#;

    let result = cache_test(
        "change_highlight_edges_changes_visual",
        vec![
            Variation {
                code,
                settings: &kcl_lib::ExecutorSettings {
                    highlight_edges: true,
                    ..Default::default()
                },
            },
            Variation {
                code,
                settings: &kcl_lib::ExecutorSettings {
                    highlight_edges: false,
                    ..Default::default()
                },
            },
        ],
    )
    .await
    .unwrap();

    let first = result.first().unwrap();
    let second = result.last().unwrap();

    assert!(first.1 != second.1);
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_cache_add_line_preserves_artifact_commands() {
    let code = r#"sketch001 = startSketchOn('XY')
  |> startProfileAt([5.5229, 5.25217], %)
  |> line([10.50433, -1.19122], %)
  |> line([8.01362, -5.48731], %)
  |> line([-1.02877, -6.76825], %)
  |> line([-11.53311, 2.81559], %)
  |> close(%)
"#;
    // Use a new statement; don't extend the prior pipeline.  This allows us to
    // detect a prefix.
    let code_with_extrude = code.to_owned()
        + r#"
extrude(4, sketch001)
"#;

    let result = cache_test(
        "add_line_preserves_artifact_commands",
        vec![
            Variation {
                code,
                settings: &Default::default(),
            },
            Variation {
                code: code_with_extrude.as_str(),
                settings: &Default::default(),
            },
        ],
    )
    .await
    .unwrap();

    let first = result.first().unwrap();
    let second = result.last().unwrap();

    assert!(
        first.2.global.artifact_commands.len() < second.2.global.artifact_commands.len(),
        "Second should have all the artifact commands of the first, plus more. first={:?}, second={:?}",
        first.2.global.artifact_commands.len(),
        second.2.global.artifact_commands.len()
    );
    assert!(
        first.2.global.artifact_responses.len() < second.2.global.artifact_responses.len(),
        "Second should have all the artifact responses of the first, plus more. first={:?}, second={:?}",
        first.2.global.artifact_responses.len(),
        second.2.global.artifact_responses.len()
    );
}
