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
    assert!(!png_contains_color(&png, [43, 72, 43, 255]));
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

    let ctx = ExecutorContext::new_mock(None).await;
    let region_error = outcome
        .resolve_sketch_region(&ctx, "missing")
        .await
        .expect_err("an unknown region should fail");
    assert!(matches!(
        region_error,
        crate::tooling::sketch_visualizer::SketchVisualizationError::RegionNotFound { .. }
    ));
}

#[tokio::test(flavor = "multi_thread")]
async fn exec_outcome_renders_engine_resolved_region_fill() {
    let (outcome, region) =
        execute_visualizer_kcl_with_engine(&sketch_visualizer_test_root().join("region_overlay/input.kcl")).await;
    let png = outcome
        .render_sketch_png_with_overlays("profile", &["bottom".to_owned(), "right".to_owned()], Some(&region))
        .expect("the named segments and resolved region should be highlighted");

    assert!(png_contains_color(&png, [0xff, 0x4f, 0xd8, 0xff]));
    assert!(png_contains_color(&png, [43, 72, 43, 255]));
    // Every original line/point pixel must retain its constraint color.
    let plain = image::load_from_memory(&outcome.render_sketch_png("profile").unwrap())
        .unwrap()
        .into_rgba8();
    let filled = image::load_from_memory(&png).unwrap().into_rgba8();
    for (before, after) in plain.pixels().zip(filled.pixels()) {
        if matches!(
            before.0,
            [60, 115, 255, 255] | [255, 255, 255, 255] | [255, 94, 91, 255]
        ) {
            assert_eq!(before, after);
        }
    }
    assert_eq!(filled.get_pixel(512, 512).0, [43, 72, 43, 255]);
    assert_eq!(filled.get_pixel(20, 20).0, [24, 26, 31, 255]);
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

#[tokio::test(flavor = "multi_thread")]
async fn engine_region_fill_uses_trimmed_curves_and_sketch_units() {
    // Public primitive regression fixtures, not trace/eval checkpoint data.
    for (plane, unit, direction) in [("XY", "mm", "CW"), ("XZ", "in", "CCW")] {
        let source = format!(
            r#"
@settings(defaultLengthUnit = {unit}, kclVersion = "3.0-preview")
profile = sketch(on = {plane}) {{
  rim = circle(start = [10{unit}, 0{unit}], center = [0{unit}, 0{unit}])
  chord = line(start = [-8{unit}, 6{unit}], end = [8{unit}, 6{unit}])
}}
selectedRegion = region(segments = [profile.chord, profile.rim], direction = {direction})
"#
        );
        let ctx = ExecutorContext::new_with_client(ExecutorSettings::default(), None, None)
            .await
            .unwrap();
        let outcome = ctx
            .run_with_caching(Program::parse_no_errs(&source).unwrap())
            .await
            .unwrap_or_else(|e| panic!("{}", e.error));
        let region = outcome.resolve_sketch_region(&ctx, "selectedRegion").await.unwrap();
        ctx.close().await;
        assert_eq!(region.contours.len(), 1);
        let contour = &region.contours[0];
        assert!(contour.len() > 4, "the circular portion must be sampled");
        assert!(
            contour.iter().all(|p| libm::hypot(p.x, p.y) <= 10.00001),
            "must not include untrimmed chord endpoints"
        );
        assert!(
            contour
                .iter()
                .any(|p| (p.y - 6.0).abs() < 1e-6 && (p.x.abs() - 8.0).abs() < 1e-6)
        );
        let png = outcome
            .render_sketch_png_with_overlays("profile", &["chord".to_owned()], Some(&region))
            .unwrap();
        assert!(png_contains_color(&png, [43, 72, 43, 255]));
        assert!(png_contains_color(&png, [255, 255, 255, 255]));
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn engine_region_fill_preserves_holes() {
    let source = r#"
@settings(kclVersion = "3.0-preview")
profile = sketch(on = XY) {
  rim = circle(start = [10mm, 0mm], center = [0mm, 0mm])
  hole = circle(start = [3mm, 0mm], center = [0mm, 0mm])
}
selectedRegion = subtract2d(region(segments = [profile.rim]), tool = region(segments = [profile.hole]))
"#;
    let inch_source = source
        .replace("mm", "in")
        .replace("on = XY", "on = XZ")
        .replace("@settings(", "@settings(defaultLengthUnit = in, ");
    for source in [source, inch_source.as_str()] {
        let ctx = ExecutorContext::new_with_client(ExecutorSettings::default(), None, None)
            .await
            .unwrap();
        let outcome = ctx
            .run_with_caching(Program::parse_no_errs(source).unwrap())
            .await
            .unwrap_or_else(|e| panic!("{}", e.error));
        let region = outcome.resolve_sketch_region(&ctx, "selectedRegion").await.unwrap();
        ctx.close().await;
        assert_eq!(region.contours.len(), 2);
        let png = outcome
            .render_sketch_png_with_overlays("profile", &[], Some(&region))
            .unwrap();
        let image = image::load_from_memory(&png).unwrap().into_rgba8();
        assert_eq!(image.get_pixel(540, 540).0, [24, 26, 31, 255]);
        assert_eq!(image.get_pixel(800, 512).0, [43, 72, 43, 255]);
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

async fn execute_visualizer_kcl_with_engine(input_path: &Path) -> (ExecOutcome, super::ResolvedSketchRegion) {
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
    let region = outcome.resolve_sketch_region(&ctx, "selectedRegion").await.unwrap();
    ctx.close().await;
    (outcome, region)
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
