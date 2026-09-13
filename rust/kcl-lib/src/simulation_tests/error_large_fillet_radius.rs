use super::Test;
use crate::ModuleId;
use crate::SourceRange;
use crate::errors::KclError;
use crate::errors::ReportWithOutputs;

const TEST_NAME: &str = "error_large_fillet_radius";
const FILLET: &str = "fillet(extrude001, tags = getCommonEdge(faces = [region001.tags.line1, capEnd001]), radius = 13)";

fn assert_error(report: &ReportWithOutputs) {
    assert!(matches!(report.error.error, KclError::Engine { .. }), "{report:#?}");
    // The CSG explanation can improve independently of this invalid-radius
    // regression. Keep the useful operation failure and the fix from #13601.
    let message = report.error.error.message();
    assert!(message.contains("Edge cut failed"), "{message}");
    assert!(!message.contains("Please report"), "{message}");

    let start = report
        .kcl_source
        .find(FILLET)
        .expect("fixture must retain the oversized fillet");
    let range = SourceRange::new(start, start + FILLET.len(), ModuleId::default());
    assert_eq!(report.error.error.source_ranges(), vec![range]);
    assert_eq!(report.filename, "tests/error_large_fillet_radius/input.kcl");
    assert_eq!(
        report.primary_labels,
        vec![miette::LabeledSpan::new_with_span(Some(report.filename.clone()), range)]
    );
}

#[test]
fn parse() {
    super::parse(TEST_NAME)
}

#[tokio::test(flavor = "multi_thread")]
async fn unparse() {
    super::unparse(TEST_NAME).await
}

/// Shared by Modeling App's remote-engine CI and Engine's local-engine CI.
#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_execute() {
    super::execute_error_test(&Test::new(TEST_NAME), assert_error).await
}
