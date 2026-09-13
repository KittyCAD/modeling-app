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
    assert_eq!(
        png,
        outcome.render_sketch_png_instance(&statuses[0].name, Some(0)).unwrap()
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn duplicate_names_require_an_explicit_instance() {
    use crate::tooling::sketch_visualizer::SketchVisualizationError;

    let path = sketch_visualizer_test_root().join("duplicate_names/input.kcl");
    let mut previous_images = None;
    for _ in 0..2 {
        let outcome = execute_visualizer_kcl(&path).await;
        let report = outcome.sketch_constraint_report();
        let indices = report
            .fully_constrained
            .iter()
            .map(|s| s.instance_index)
            .collect::<Vec<_>>();
        assert_eq!(indices, [0, 1]);
        assert!(matches!(
            outcome.render_sketch_png("profile"),
            Err(SketchVisualizationError::AmbiguousSketchName { count: 2, .. })
        ));
        assert!(matches!(
            outcome.render_sketch_png_instance("profile", Some(2)),
            Err(SketchVisualizationError::InstanceNotFound { index: 2, count: 2, .. })
        ));
        assert!(matches!(
            outcome.render_sketch_png_instance("missing", Some(0)),
            Err(SketchVisualizationError::SketchNotFound { .. })
        ));
        let images = [0, 1].map(|index| outcome.render_sketch_png_instance("profile", Some(index)).unwrap());
        assert_ne!(images[0], images[1]);
        if let Some(previous) = previous_images {
            assert_eq!(images, previous, "instance selection must survive a fresh execution");
        }
        previous_images = Some(images);
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn instance_indices_are_assigned_before_status_grouping() {
    let outcome = execute_visualizer_kcl(&sketch_visualizer_test_root().join("duplicate_names/statuses.kcl")).await;
    let report = outcome.sketch_constraint_report();
    assert_eq!(report.under_constrained[0].name, "profile");
    assert_eq!(report.under_constrained[0].instance_index, 0);
    assert_eq!(report.fully_constrained[0].name, "profile");
    assert_eq!(report.fully_constrained[0].instance_index, 1);
}

#[tokio::test(flavor = "multi_thread")]
async fn duplicate_names_from_imported_functions_are_selectable() {
    let path = sketch_visualizer_test_root().join("duplicate_names/imports.kcl");
    let mut previous_images = None;
    for _ in 0..2 {
        let outcome = execute_visualizer_kcl(&path).await;
        let report = outcome.sketch_constraint_report();
        assert_eq!(report.fully_constrained.len(), 2);
        assert_eq!(report.fully_constrained[0].instance_index, 0);
        assert_eq!(report.fully_constrained[1].instance_index, 1);
        let images = [0, 1].map(|index| outcome.render_sketch_png_instance("profile", Some(index)).unwrap());
        assert_ne!(images[0], images[1]);
        if let Some(previous) = previous_images {
            assert_eq!(images, previous);
        }
        previous_images = Some(images);
    }
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
