use std::path::Path;
use std::path::PathBuf;

use serde::Deserialize;

use crate::ExecOutcome;
use crate::ExecutorContext;
use crate::ExecutorSettings;
use crate::Program;
use crate::TypedPath;
use crate::execution::MockConfig;

#[tokio::test(flavor = "multi_thread")]
async fn exec_outcome_renders_sketch_png_separately_from_constraint_report() {
    let outcome = execute_visualizer_kcl(&sketch_visualizer_test_root().join("connected_profile/input.kcl")).await;
    let report = outcome.sketch_constraint_report();
    let statuses = report
        .fully_constrained
        .iter()
        .chain(&report.under_constrained)
        .chain(&report.over_constrained)
        .chain(&report.errors)
        .collect::<Vec<_>>();

    assert_eq!(statuses.len(), 1);
    let png = outcome
        .render_sketch_png(&statuses[0].name)
        .expect("the sketch should render from the same execution outcome");
    assert!(png.starts_with(b"\x89PNG\r\n\x1a\n"));
}

#[tokio::test(flavor = "multi_thread")]
async fn exec_outcome_highlights_named_segments() {
    let outcome = execute_visualizer_kcl(&sketch_visualizer_test_root().join("connected_profile/input.kcl")).await;
    let png = outcome
        .render_sketch_png_with_overlays("profile", &["bottom".to_owned(), "right".to_owned()], None)
        .expect("the named segments should be highlighted");

    assert!(png_contains_color(&png, [0xff, 0x4f, 0xd8, 0xff]));
    assert!(!png_contains_color(&png, [0x75, 0xff, 0x5a, 0xff]));
}

#[tokio::test(flavor = "multi_thread")]
async fn exec_outcome_rejects_unknown_overlay_names() {
    let outcome = execute_visualizer_kcl(&sketch_visualizer_test_root().join("connected_profile/input.kcl")).await;

    let segment_error = outcome
        .render_sketch_png_with_overlays("profile", &["missing".to_owned()], None)
        .expect_err("an unknown segment should fail");
    assert!(matches!(
        segment_error,
        crate::tooling::sketch_visualizer::SketchVisualizationError::SegmentNotFound { .. }
    ));

    let region_error = outcome
        .render_sketch_png_with_overlays("profile", &[], Some("missing"))
        .expect_err("an unknown region should fail");
    assert!(matches!(
        region_error,
        crate::tooling::sketch_visualizer::SketchVisualizationError::RegionNotFound { .. }
    ));
}

#[tokio::test(flavor = "multi_thread")]
async fn exec_outcome_renders_engine_resolved_region_boundary() {
    let outcome =
        execute_visualizer_kcl_with_engine(&sketch_visualizer_test_root().join("region_overlay/input.kcl")).await;
    let png = outcome
        .render_sketch_png_with_overlays(
            "profile",
            &["bottom".to_owned(), "right".to_owned()],
            Some("selectedRegion"),
        )
        .expect("the named segments and resolved region should be highlighted");

    assert!(png_contains_color(&png, [0xff, 0x4f, 0xd8, 0xff]));
    assert!(png_contains_color(&png, [0x75, 0xff, 0x5a, 0xff]));
}

#[tokio::test(flavor = "multi_thread")]
async fn snapshots_kcl_visualizer_pngs() {
    let manifest = sketch_visualizer_snapshot_manifest();

    for case in manifest.cases {
        let input_path = sketch_visualizer_test_root().join(&case.input);
        let outcome = execute_visualizer_kcl(&input_path).await;
        let png = outcome
            .render_sketch_png(&case.sketch)
            .unwrap_or_else(|err| panic!("failed to visualize sketch for case `{}`: {err:?}", case.name));
        assert_png_snapshot(&case.name, &png);
    }
}

fn assert_png_snapshot(case_name: &str, png: &[u8]) {
    let output_dir = sketch_visualizer_test_root().join(case_name);
    let image = image::load_from_memory(png).unwrap();
    twenty_twenty::assert_image(output_dir.join("dof.png"), &image, 1.0);
}

fn png_contains_color(png: &[u8], expected: [u8; 4]) -> bool {
    image::load_from_memory(png)
        .expect("the renderer should return a valid PNG")
        .into_rgba8()
        .pixels()
        .any(|pixel| pixel.0 == expected)
}

async fn execute_visualizer_kcl(input_path: &Path) -> ExecOutcome {
    let source = std::fs::read_to_string(input_path)
        .unwrap_or_else(|err| panic!("failed to read `{}`: {err}", input_path.display()));
    let program = Program::parse_no_errs(&source)
        .unwrap_or_else(|err| panic!("failed to parse `{}`: {err:?}", input_path.display()));
    let mut settings = ExecutorSettings::default();
    settings.with_current_file(TypedPath(input_path.to_path_buf()));
    settings.project_directory = input_path.parent().map(|path| TypedPath(path.to_path_buf()));
    let ctx = ExecutorContext::new_mock(Some(settings)).await;
    let outcome = ctx
        .run_mock(
            &program,
            &MockConfig {
                use_prev_memory: false,
                ..Default::default()
            },
        )
        .await
        .unwrap_or_else(|err| panic!("failed to execute `{}`: {err:?}", input_path.display()));
    ctx.close().await;
    outcome
}

async fn execute_visualizer_kcl_with_engine(input_path: &Path) -> ExecOutcome {
    let source = std::fs::read_to_string(input_path)
        .unwrap_or_else(|err| panic!("failed to read `{}`: {err}", input_path.display()));
    let program = Program::parse_no_errs(&source)
        .unwrap_or_else(|err| panic!("failed to parse `{}`: {err:?}", input_path.display()));
    let mut settings = ExecutorSettings::default();
    settings.with_current_file(TypedPath(input_path.to_path_buf()));
    settings.project_directory = input_path.parent().map(|path| TypedPath(path.to_path_buf()));
    let ctx = ExecutorContext::new_with_client(settings, None, None)
        .await
        .expect("the engine context should connect");
    let outcome = ctx
        .run_with_caching(program)
        .await
        .unwrap_or_else(|err| panic!("failed to execute `{}`: {err:?}", input_path.display()));
    ctx.close().await;
    outcome
}

fn sketch_visualizer_snapshot_manifest() -> SketchVisualizerSnapshotManifest {
    let manifest_path = sketch_visualizer_test_root().join("manifest.toml");
    let contents = std::fs::read_to_string(&manifest_path)
        .unwrap_or_else(|err| panic!("failed to read `{}`: {err}", manifest_path.display()));
    toml::from_str(&contents).unwrap_or_else(|err| panic!("failed to parse `{}`: {err}", manifest_path.display()))
}

fn sketch_visualizer_test_root() -> PathBuf {
    Path::new("tests").join("sketch_visualizer")
}

#[derive(Debug, Deserialize)]
struct SketchVisualizerSnapshotManifest {
    cases: Vec<SketchVisualizerSnapshotCase>,
}

#[derive(Debug, Deserialize)]
struct SketchVisualizerSnapshotCase {
    name: String,
    input: PathBuf,
    sketch: String,
}
