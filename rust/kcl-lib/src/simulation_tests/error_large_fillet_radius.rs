use super::Test;
use crate::KclErrorWithOutputs;
use crate::ModuleId;
use crate::SourceRange;
use crate::errors::KclError;

const TEST_NAME: &str = "error_large_fillet_radius";
const FILLET: &str = "fillet(extrude001, tags = getCommonEdge(faces = [region001.tags.line1, capEnd001]), radius = 13)";

fn fillet_range(input: &str) -> SourceRange {
    let start = input.find(FILLET).expect("fixture must retain the oversized fillet");
    SourceRange::new(start, start + FILLET.len(), ModuleId::default())
}

fn assert_error(error: &KclErrorWithOutputs, input: &str) {
    assert!(matches!(error.error, KclError::Engine { .. }), "{error:#?}");
    // The CSG explanation can improve independently of this invalid-radius
    // regression. Keep the useful operation failure and the fix from #13601.
    let message = error.error.message().split_whitespace().collect::<Vec<_>>().join(" ");
    assert!(message.contains("Edge cut failed"), "{message}");
    assert!(!message.to_ascii_lowercase().contains("please report"), "{message}");
    assert_eq!(error.error.source_ranges(), vec![fillet_range(input)]);
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
    let test = Test {
        assert_error: Some(assert_error),
        // Surface disconnects and internal failures on this attempt instead of
        // silently recovering before checking the expected operation error.
        retry_config: crate::util::RetryConfig {
            retries: 0,
            ..Default::default()
        },
        ..Test::new(TEST_NAME)
    };
    super::execute_test(&test, true, false).await
}
