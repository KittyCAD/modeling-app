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
