use std::sync::Arc;

use crate::ExecutorContext;
use crate::ExecutorSettings;
use crate::engine::conn_mock::EngineConnection;
use crate::execution::ContextType;
use crate::execution::MockConfig;
use crate::front::Freedom;
use crate::front::ObjectKind;

async fn run_with_freedom_analysis(kcl: &str) -> Vec<Freedom> {
    let program = crate::Program::parse_no_errs(kcl).unwrap();

    let exec_ctxt = ExecutorContext {
        engine: Arc::new(Box::new(EngineConnection::new().unwrap())),
        fs: Arc::new(crate::fs::FileManager::new()),
        settings: ExecutorSettings::default(),
        context_type: ContextType::Mock,
    };

    let mock_config = MockConfig {
        freedom_analysis: true,
        ..Default::default()
    };

    let outcome = exec_ctxt.run_mock(&program, &mock_config).await.unwrap();

    let mut point_freedoms = Vec::new();
    for obj in &outcome.scene_objects {
        if let ObjectKind::Segment {
            segment: crate::front::Segment::Point(point),
        } = &obj.kind
        {
            point_freedoms.push((obj.id, point.freedom));
        }
    }
    // Sort by object ID so the freedom list is stable even if scene object IDs shift.
    point_freedoms.sort_by_key(|(id, _)| *id);
    exec_ctxt.close().await;
    point_freedoms.into_iter().map(|(_, freedom)| freedom).collect()
}

#[tokio::test(flavor = "multi_thread")]
async fn test_freedom_analysis_with_conflicts() {
    let kcl = r#"
@settings(experimentalFeatures = allow)

sketch(on = YZ) {
  line1 = line(start = [var 2mm, var 8mm], end = [var 5mm, var 7mm])
line1.start.at[0] == 2
line1.start.at[1] == 8
line1.end.at[0] == 5
line1.end.at[1] == 7


  line2 = line(start = [var 2mm, var 1mm], end = [var -4.75mm, var -0.88mm])
line2.start.at[0] == 2
line2.start.at[1] == 1

  line3 = line(start = [var -2.591mm, var -7.081mm], end = [var 1.331mm, var -3.979mm])
distance([line3.start, line3.end]) == 4mm
distance([line3.start, line3.end]) == 6mm
}
"#;

    let point_freedoms = run_with_freedom_analysis(kcl).await;

    // Expected: line1 has both ends constrained -> Fixed, Fixed
    //           line2 has one end constrained -> Fixed, Free (but currently shows Fixed, Conflict - bug)
    //           line3 has conflicting distance constraints -> Conflict, Conflict (but currently shows Free, Free - bug)
    let expected = vec![
        Freedom::Fixed,
        Freedom::Fixed,
        Freedom::Fixed,
        Freedom::Free,
        Freedom::Conflict,
        Freedom::Conflict,
    ];

    assert_eq!(point_freedoms, expected, "Point freedoms should match expected values.");
}

#[tokio::test(flavor = "multi_thread")]
async fn test_freedom_analysis_without_conflicts() {
    let kcl = r#"
@settings(experimentalFeatures = allow)

sketch(on = YZ) {
  line1 = line(start = [var 2mm, var 8mm], end = [var 5mm, var 7mm])
line1.start.at[0] == 2
line1.start.at[1] == 8
line1.end.at[0] == 5
line1.end.at[1] == 7


  line2 = line(start = [var 2mm, var 1mm], end = [var -4.75mm, var -0.88mm])
line2.start.at[0] == 2
line2.start.at[1] == 1

  line3 = line(start = [var -2.591mm, var -7.081mm], end = [var 1.331mm, var -3.979mm])
distance([line3.start, line3.end]) == 4mm
}
"#;

    let point_freedoms = run_with_freedom_analysis(kcl).await;

    // Expected: line1 has both ends constrained -> Fixed, Fixed
    //           line2 has one end constrained -> Fixed, Free
    //           line3 has one distance constraint -> Free, Free (both points can move)

    // Expected: Fixed, Fixed, Fixed, Free, Free, Free
    let expected = vec![
        Freedom::Fixed,
        Freedom::Fixed,
        Freedom::Fixed,
        Freedom::Free,
        Freedom::Free,
        Freedom::Free,
    ];

    assert_eq!(point_freedoms, expected, "Point freedoms should match expected values");
}

#[tokio::test(flavor = "multi_thread")]
async fn test_freedom_analysis_reordered_lines() {
    let kcl = r#"
@settings(experimentalFeatures = allow)

sketch(on = YZ) {
  line1 = line(start = [var 2mm, var 8mm], end = [var 5mm, var 7mm])
line1.start.at[0] == 2
line1.start.at[1] == 8
line1.end.at[0] == 5
line1.end.at[1] == 7

  line3 = line(start = [var -2.591mm, var -7.081mm], end = [var 1.331mm, var -3.979mm])
distance([line3.start, line3.end]) == 4mm
distance([line3.start, line3.end]) == 6mm

  line2 = line(start = [var 2mm, var 1mm], end = [var -4.75mm, var -0.88mm])
line2.start.at[0] == 2
line2.start.at[1] == 1

}
"#;

    let point_freedoms = run_with_freedom_analysis(kcl).await;

    // Expected: line1 has both ends constrained -> Fixed, Fixed
    //           line3 has conflicting distance constraints -> Conflict, Conflict (but bug shows one Conflict, one Free)
    //           line2 has one end constrained -> Fixed, Free

    let expected = vec![
        Freedom::Fixed,
        Freedom::Fixed,
        Freedom::Conflict,
        Freedom::Conflict,
        Freedom::Fixed,
        Freedom::Free,
    ];

    assert_eq!(point_freedoms, expected, "Point freedoms should match expected values.");
}

#[tokio::test(flavor = "multi_thread")]
async fn test_freedom_analysis_with_zero_constraints() {
    // This test verifies the fix for the bug where segments with no constraints
    // incorrectly showed as Fixed (white) instead of Free (blue).
    let kcl = r#"
@settings(experimentalFeatures = allow)

sketch(on = YZ) {
  line1 = line(start = [var 1.32mm, var -1.93mm], end = [var 6.08mm, var 2.51mm])
  line2 = line(start = [var -5.98mm, var 3.5mm], end = [var -8.52mm, var -1.59mm])
  line3 = line(start = [var -6.66mm, var -3.03mm], end = [var 0.52mm, var -3.26mm])
}
"#;

    let point_freedoms = run_with_freedom_analysis(kcl).await;

    // With 0 constraints, ALL points should be Free (underconstrained)
    // This test would have failed before the fix, where all points were incorrectly marked as Fixed
    let expected = vec![
        Freedom::Free,
        Freedom::Free,
        Freedom::Free,
        Freedom::Free,
        Freedom::Free,
        Freedom::Free,
    ];

    assert_eq!(
        point_freedoms, expected,
        "With 0 constraints, all points should be Free (underconstrained), not Fixed"
    );
}
