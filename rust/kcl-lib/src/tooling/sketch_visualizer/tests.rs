use std::path::Path;
use std::path::PathBuf;

use serde::Deserialize;

use super::api::render_sketch_png_with_options;
use super::types::SketchVisualizationOptions;
use crate::ExecOutcome;
use crate::ExecutorContext;
use crate::ExecutorSettings;
use crate::Program;
use crate::TypedPath;
use crate::execution::MockConfig;
use crate::front::Object;
use crate::front::ObjectKind;

#[tokio::test(flavor = "multi_thread")]
async fn constraint_report_includes_png_for_each_sketch() {
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
    assert!(
        statuses[0]
            .png
            .as_deref()
            .is_some_and(|png| png.starts_with(b"\x89PNG\r\n\x1a\n"))
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn snapshots_kcl_visualizer_pngs() {
    let manifest = sketch_visualizer_snapshot_manifest();

    for case in manifest.cases {
        let input_path = sketch_visualizer_test_root().join(&case.input);
        let outcome = execute_visualizer_kcl(&input_path).await;
        let sketch = find_sketch(&outcome, case.sketch.as_deref());

        for snapshot in &case.visualizations {
            let png = render_sketch_png_with_options(&outcome.scene_objects, sketch, snapshot.options())
                .unwrap_or_else(|err| {
                    panic!(
                        "failed to visualize sketch for case `{}` snapshot `{}`: {err:?}",
                        case.name, snapshot.name
                    )
                });
            assert_png_snapshot(&case.name, &snapshot.name, &png);
        }
    }
}

fn find_sketch<'a>(outcome: &'a ExecOutcome, name: Option<&str>) -> &'a Object {
    let sketches = outcome
        .scene_objects
        .iter()
        .filter(|object| matches!(object.kind, ObjectKind::Sketch(_)))
        .collect::<Vec<_>>();
    sketches
        .iter()
        .copied()
        .find(|object| name.is_none_or(|name| object.label == name))
        .or_else(|| (sketches.len() == 1).then_some(sketches[0]))
        .unwrap_or_else(|| panic!("could not find sketch {name:?}"))
}

fn assert_png_snapshot(case_name: &str, snapshot_name: &str, png: &[u8]) {
    let output_dir = sketch_visualizer_test_root().join(case_name);
    let image = image::load_from_memory(png).unwrap();
    twenty_twenty::assert_image(output_dir.join(format!("{snapshot_name}.png")), &image, 1.0);
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
    sketch: Option<String>,
    visualizations: Vec<SketchVisualizerSnapshot>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "kebab-case")]
struct SketchVisualizerSnapshot {
    name: String,
    width: Option<u32>,
    height: Option<u32>,
    padding: Option<u32>,
}

impl SketchVisualizerSnapshot {
    fn options(&self) -> SketchVisualizationOptions {
        let default_options = SketchVisualizationOptions::default();

        SketchVisualizationOptions {
            width: self.width.unwrap_or(default_options.width),
            height: self.height.unwrap_or(default_options.height),
            padding: self.padding.unwrap_or(default_options.padding),
        }
    }
}
