//! Pins the mock/real execution parity contract for `getCommonEdge`. The
//! `.kcl` fixtures live in this directory, next to this module.

use std::path::Path;
use std::path::PathBuf;

use crate::ExecutorContext;
use crate::MockConfig;
use crate::Program;
use crate::errors::ExecError;
use crate::errors::KclError;
use crate::util::RetryConfig;
use crate::util::execute_with_retries;

const TEST_DIR: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/src/engine_contracts/get_common_edge");

#[derive(Debug, Clone, Copy)]
enum Expectation {
    Accepts,
    RejectsWith(&'static str),
}

const SAME_BODY_ERROR: &str = "getCommonEdge requires both faces to belong to the same body";
const FACE_TAG_ERROR: &str = "refers to a sketch edge, but this operation requires a face tag";

fn read_fixture(file_name: &str) -> (PathBuf, String, Program) {
    let path = Path::new(TEST_DIR).join(file_name);
    let input = std::fs::read_to_string(&path)
        .unwrap_or_else(|error| panic!("failed to read common-edge fixture {}: {error}", path.display()));
    let program = Program::parse_no_errs(&input)
        .unwrap_or_else(|error| panic!("failed to parse common-edge fixture {}: {error}", path.display()));
    (path, input, program)
}

async fn mock_execution_error(program: &Program) -> Option<KclError> {
    let mock_ctx = ExecutorContext::new_mock(None).await;
    let mock_result = mock_ctx.run_mock(program, &MockConfig::default()).await;
    mock_ctx.close().await;
    match mock_result {
        Ok(_) => None,
        Err(error) => Some(error.error),
    }
}

async fn real_execution_error(case_name: &str, input: &str, path: PathBuf) -> Option<KclError> {
    let real_result = execute_with_retries(&RetryConfig::default(), || {
        crate::test_server::execute(input, Some(path.clone()))
    })
    .await;
    match real_result {
        Ok(()) => None,
        Err(ExecError::Kcl(error)) => Some(error.error),
        Err(error) => panic!("real execution failed outside KCL for `{case_name}`: {error}"),
    }
}

async fn assert_common_edge_contract(case_name: &str, file_name: &str, expectation: Expectation) {
    let (path, input, program) = read_fixture(file_name);

    let mock_error = mock_execution_error(&program).await;
    let real_error = real_execution_error(case_name, &input, path).await;

    assert_eq!(
        mock_error, real_error,
        "mock and real getCommonEdge outcomes differ for `{case_name}`"
    );

    match expectation {
        Expectation::Accepts => {
            if let Some(error) = real_error {
                panic!("expected `{case_name}` to execute, but it failed with: {error:?}");
            }
        }
        Expectation::RejectsWith(expected_message) => {
            let error =
                real_error.unwrap_or_else(|| panic!("expected `{case_name}` to fail, but it executed successfully"));
            assert!(
                matches!(&error, KclError::Type { .. }),
                "expected a type error for `{case_name}`, got: {error:?}"
            );
            assert!(
                error.message().contains(expected_message),
                "unexpected error message for `{case_name}`: {}",
                error.message()
            );
        }
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_faces_from_different_sketches_are_rejected() {
    assert_common_edge_contract(
        "kcl_test_faces_from_different_sketches_are_rejected",
        "different_sketches.kcl",
        Expectation::RejectsWith(SAME_BODY_ERROR),
    )
    .await;
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_unextruded_region_tags_are_rejected() {
    assert_common_edge_contract(
        "kcl_test_unextruded_region_tags_are_rejected",
        "unextruded_region_tags.kcl",
        Expectation::RejectsWith(FACE_TAG_ERROR),
    )
    .await;
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_csg_region_tag_vs_face_tag_is_rejected() {
    // The face tags carried onto a CSG result still name the consumed source
    // body, so real execution rejects them; mock execution must match.
    assert_common_edge_contract(
        "kcl_test_csg_region_tag_vs_face_tag_is_rejected",
        "csg_region_tag_vs_face_tag.kcl",
        Expectation::RejectsWith(SAME_BODY_ERROR),
    )
    .await;
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_csg_sketch_tag_vs_face_tag_is_rejected() {
    assert_common_edge_contract(
        "kcl_test_csg_sketch_tag_vs_face_tag_is_rejected",
        "csg_sketch_tag_vs_face_tag.kcl",
        Expectation::RejectsWith(SAME_BODY_ERROR),
    )
    .await;
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_union_same_output_stale_face_tag_is_rejected() {
    assert_common_edge_contract(
        "kcl_test_union_same_output_stale_face_tag_is_rejected",
        "union_same_output.kcl",
        Expectation::RejectsWith(SAME_BODY_ERROR),
    )
    .await;
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_union_cross_bodies_are_rejected() {
    assert_common_edge_contract(
        "kcl_test_union_cross_bodies_are_rejected",
        "union_cross_bodies.kcl",
        Expectation::RejectsWith(SAME_BODY_ERROR),
    )
    .await;
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_cloned_body_face_tags_are_accepted() {
    assert_common_edge_contract(
        "kcl_test_cloned_body_face_tags_are_accepted",
        "cloned_body_same_body.kcl",
        Expectation::Accepts,
    )
    .await;
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_cloned_body_cross_bodies_are_rejected() {
    assert_common_edge_contract(
        "kcl_test_cloned_body_cross_bodies_are_rejected",
        "cloned_body_cross_bodies.kcl",
        Expectation::RejectsWith(SAME_BODY_ERROR),
    )
    .await;
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_mirrored_body_face_tags_are_accepted() {
    assert_common_edge_contract(
        "kcl_test_mirrored_body_face_tags_are_accepted",
        "mirrored_body_same_body.kcl",
        Expectation::Accepts,
    )
    .await;
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_mirrored_body_cross_bodies_are_rejected() {
    assert_common_edge_contract(
        "kcl_test_mirrored_body_cross_bodies_are_rejected",
        "mirrored_body_cross_bodies.kcl",
        Expectation::RejectsWith(SAME_BODY_ERROR),
    )
    .await;
}
