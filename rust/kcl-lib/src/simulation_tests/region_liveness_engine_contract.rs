use std::path::Path;
use std::path::PathBuf;

use kittycad_modeling_cmds::ModelingCmd;
use kittycad_modeling_cmds::each_cmd as mcmd;
use kittycad_modeling_cmds::length_unit::LengthUnit;
use kittycad_modeling_cmds::ok_response::OkModelingCmdResponse;
use kittycad_modeling_cmds::shared::ExtrudeReference;
use kittycad_modeling_cmds::websocket::OkWebSocketResponseData;
use uuid::Uuid;

use crate::ExecState;
use crate::ExecutorContext;
use crate::MockConfig;
use crate::Program;
use crate::SourceRange;
use crate::errors::CompilationIssue;
use crate::errors::ExecError;
use crate::errors::IsRetryable;
use crate::errors::Severity;
use crate::util::RetryConfig;
use crate::util::execute_with_retries;

const TEST_DIR: &str = "tests/region_liveness_engine_contract";
const REGION_LIVENESS_UPDATE_REQUIRED: &str =
    "THE KCL LOGIC FOR LIVENESS OF REGIONS NEEDS TO BE UPDATED BEFORE ACCEPTING THIS ENGINE CHANGE.";
const REGION_REUSE_WORKAROUND: &str = "Create a separate region for each consuming operation by calling `region(...)` multiple times with the original sketch. Do not clone the source sketch.";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ContractCommand {
    Extrude,
    TwistExtrude,
    ExtrudeToReference,
    Revolve,
    RevolveAboutEdge,
    Sweep,
    RemoveSceneObjects,
}

impl ContractCommand {
    const ALL: [Self; 7] = [
        Self::Extrude,
        Self::TwistExtrude,
        Self::ExtrudeToReference,
        Self::Revolve,
        Self::RevolveAboutEdge,
        Self::Sweep,
        Self::RemoveSceneObjects,
    ];

    fn matches(self, command: &ModelingCmd) -> bool {
        matches!(
            (self, command),
            (Self::Extrude, ModelingCmd::Extrude(_))
                | (Self::TwistExtrude, ModelingCmd::TwistExtrude(_))
                | (Self::ExtrudeToReference, ModelingCmd::ExtrudeToReference(_))
                | (Self::Revolve, ModelingCmd::Revolve(_))
                | (Self::RevolveAboutEdge, ModelingCmd::RevolveAboutEdge(_))
                | (Self::Sweep, ModelingCmd::Sweep(_))
                | (Self::RemoveSceneObjects, ModelingCmd::RemoveSceneObjects(_))
        )
    }

    fn name(self) -> &'static str {
        match self {
            Self::Extrude => "extrude",
            Self::TwistExtrude => "twist_extrude",
            Self::ExtrudeToReference => "extrude_to_reference",
            Self::Revolve => "revolve",
            Self::RevolveAboutEdge => "revolve_about_edge",
            Self::Sweep => "sweep",
            Self::RemoveSceneObjects => "delete",
        }
    }

    fn consumed_region_error(self) -> &'static str {
        match self {
            Self::Extrude | Self::TwistExtrude | Self::ExtrudeToReference => {
                "Unable to extract solid2D within this object to extrude from"
            }
            Self::Revolve | Self::RevolveAboutEdge => "Unable to extract solid2D within this object to revolve from",
            Self::Sweep => "Unable to extract solid2D within this object to sweep from",
            Self::RemoveSceneObjects => "No such object exists",
        }
    }

    fn second_use_error_after(self, first: Self) -> &'static str {
        if first != Self::RemoveSceneObjects {
            return self.consumed_region_error();
        }

        match self {
            Self::Extrude => "The provided entity is not extrudable",
            Self::TwistExtrude => "The provided entity is not twist-extrudable",
            Self::ExtrudeToReference | Self::RemoveSceneObjects => "No such object exists",
            Self::Revolve | Self::RevolveAboutEdge => "The provided entity is not revolvable",
            Self::Sweep => "The provided entity is not sweepable",
        }
    }

    fn retarget(self, command: &ModelingCmd, region_id: Uuid) -> ModelingCmd {
        match (self, command.clone()) {
            (Self::Extrude, ModelingCmd::Extrude(mut command)) => {
                command.target = Some(region_id.into());
                command.target_reference = None;
                command.faces = None;
                ModelingCmd::Extrude(command)
            }
            (Self::TwistExtrude, ModelingCmd::TwistExtrude(mut command)) => {
                command.target = region_id.into();
                command.faces = None;
                ModelingCmd::TwistExtrude(command)
            }
            (Self::ExtrudeToReference, ModelingCmd::ExtrudeToReference(mut command)) => {
                command.target = Some(region_id.into());
                command.target_reference = None;
                command.faces = None;
                ModelingCmd::ExtrudeToReference(command)
            }
            (Self::Revolve, ModelingCmd::Revolve(mut command)) => {
                command.target = region_id.into();
                ModelingCmd::Revolve(command)
            }
            (Self::RevolveAboutEdge, ModelingCmd::RevolveAboutEdge(mut command)) => {
                command.target = region_id.into();
                ModelingCmd::RevolveAboutEdge(command)
            }
            (Self::Sweep, ModelingCmd::Sweep(mut command)) => {
                command.target = region_id.into();
                ModelingCmd::Sweep(command)
            }
            (Self::RemoveSceneObjects, ModelingCmd::RemoveSceneObjects(mut command)) => {
                command.object_ids.clear();
                command.object_ids.insert(region_id);
                ModelingCmd::RemoveSceneObjects(command)
            }
            _ => panic!("expected a {self:?} command template"),
        }
    }
}

fn input_path(file_name: &str) -> PathBuf {
    Path::new(TEST_DIR).join(file_name)
}

fn region_liveness_changed(case_name: &str, expected: &str, actual: &str) -> ! {
    panic!(
        "{REGION_LIVENESS_UPDATE_REQUIRED}\n\
         Case: `{case_name}`\n\
         Expected: {expected}\n\
         Actual: {actual}"
    )
}

fn read_fixture(file_name: &str) -> (PathBuf, String, Program) {
    let path = input_path(file_name);
    let input = std::fs::read_to_string(&path)
        .unwrap_or_else(|error| panic!("failed to read region-liveness fixture {}: {error}", path.display()));
    let program = Program::parse_no_errs(&input)
        .unwrap_or_else(|error| panic!("failed to parse region-liveness fixture {}: {error}", path.display()));
    (path, input, program)
}

fn region_liveness_issues(issues: &[CompilationIssue]) -> Vec<CompilationIssue> {
    issues
        .iter()
        .filter(|issue| issue.message.contains(REGION_REUSE_WORKAROUND))
        .cloned()
        .collect()
}

fn argument_range(input: &str, call_prefix: &str) -> SourceRange {
    let call_start = input
        .find(call_prefix)
        .unwrap_or_else(|| panic!("expected `{call_prefix}` in region-liveness fixture"));
    let argument_offset = input[call_start..]
        .find("sharedRegion")
        .unwrap_or_else(|| panic!("expected `sharedRegion` after `{call_prefix}`"));
    let start = call_start + argument_offset;
    SourceRange::from([start, start + "sharedRegion".len(), 0])
}

async fn execute_first_operation(file_name: &str) -> Result<(ExecutorContext, ExecState), ExecError> {
    let (path, _, program) = read_fixture(file_name);
    let ctx = crate::test_server::new_context(true, Some(path)).await?;
    let mut exec_state = ExecState::new(&ctx);

    if let Err(error) = ctx.run(&program, &mut exec_state).await {
        ctx.close().await;
        return Err(error.into());
    }

    Ok((ctx, exec_state))
}

async fn assert_region_is_consumed(
    case_name: &str,
    file_name: &str,
    command_kind: ContractCommand,
    expected_engine_message: &str,
) {
    let prepared = execute_with_retries(&RetryConfig::default(), || execute_first_operation(file_name)).await;
    let (ctx, exec_state) = prepared
        .unwrap_or_else(|error| panic!("region-liveness engine contract setup failed for `{case_name}`: {error}"));
    let artifact_command = exec_state
        .root_module_artifact_state()
        .commands
        .iter()
        .rev()
        .find(|artifact_command| command_kind.matches(&artifact_command.command))
        .unwrap_or_else(|| panic!("fixture `{case_name}` did not emit the expected {command_kind:?} command"));

    // Resend the operation below the KCL stdlib so future KCL liveness checks
    // cannot mask a change in the engine's ownership behavior.
    let second_result = ctx
        .engine
        .send_modeling_cmd(
            &ctx.engine_batch,
            Uuid::new_v4(),
            SourceRange::default(),
            &artifact_command.command,
        )
        .await;
    ctx.close().await;

    match second_result {
        Err(error) if error.message() == expected_engine_message => {}
        Err(error) if error.is_retryable() => {
            panic!("region-liveness engine contract transport failed for `{case_name}`: {error}")
        }
        Err(error) => region_liveness_changed(
            case_name,
            &format!("the repeated command to fail with `{expected_engine_message}`"),
            &format!("engine error `{}`", error.message()),
        ),
        Ok(response) => region_liveness_changed(
            case_name,
            "the repeated command to consume its region",
            &format!("the engine accepted it with response {response:?}"),
        ),
    }
}

async fn prepare_live_region(case_name: &str, file_name: &str) -> (ExecutorContext, Uuid) {
    let prepared = execute_with_retries(&RetryConfig::default(), || execute_first_operation(file_name)).await;
    let (ctx, exec_state) = prepared
        .unwrap_or_else(|error| panic!("region-liveness engine contract setup failed for `{case_name}`: {error}"));
    let region_id = exec_state
        .root_module_artifact_state()
        .commands
        .iter()
        .rev()
        .find(|artifact_command| matches!(artifact_command.command, ModelingCmd::CreateRegion(_)))
        .map(|artifact_command| artifact_command.cmd_id)
        .unwrap_or_else(|| panic!("fixture `{case_name}` did not create an engine Region"));

    (ctx, region_id)
}

async fn prepare_consuming_command_matrix(
    case_name: &str,
) -> (ExecutorContext, ModelingCmd, Vec<(ContractCommand, ModelingCmd)>) {
    let file_name = "mixed_profile_consumers_source.kcl";
    let prepared = execute_with_retries(&RetryConfig::default(), || execute_first_operation(file_name)).await;
    let (ctx, exec_state) = match prepared {
        Ok(prepared) => prepared,
        Err(error) if error.is_retryable() => {
            panic!("region-liveness engine contract transport failed for `{case_name}`: {error}")
        }
        Err(error) => region_liveness_changed(
            case_name,
            "the consuming-command fixture to execute successfully",
            &format!("fixture execution failed with `{error}`"),
        ),
    };
    let commands = &exec_state.root_module_artifact_state().commands;
    let create_region_command = commands
        .iter()
        .rev()
        .find(|artifact_command| matches!(artifact_command.command, ModelingCmd::CreateRegion(_)))
        .map(|artifact_command| artifact_command.command.clone())
        .unwrap_or_else(|| panic!("fixture `{file_name}` did not emit a CreateRegion command"));
    let command_templates = ContractCommand::ALL
        .into_iter()
        .map(|command_kind| {
            let command = commands
                .iter()
                .rev()
                .find(|artifact_command| command_kind.matches(&artifact_command.command))
                .map(|artifact_command| artifact_command.command.clone())
                .unwrap_or_else(|| panic!("fixture `{file_name}` did not emit a {command_kind:?} command"));
            (command_kind, command)
        })
        .collect();

    (ctx, create_region_command, command_templates)
}

fn command_template(
    command_templates: &[(ContractCommand, ModelingCmd)],
    command_kind: ContractCommand,
) -> &ModelingCmd {
    command_templates
        .iter()
        .find(|(candidate, _)| *candidate == command_kind)
        .map(|(_, command)| command)
        .unwrap_or_else(|| panic!("missing {command_kind:?} command template"))
}

#[tokio::test(flavor = "multi_thread")]
async fn same_region_as_extrude_target_and_reference_is_rejected() {
    let case_name = "same_region_as_extrude_target_and_reference_is_rejected";
    let (ctx, region_id) = prepare_live_region(case_name, "same_region_multiple_roles_source.kcl").await;
    let command = ModelingCmd::from(
        mcmd::ExtrudeToReference::builder()
            .target(region_id.into())
            .reference(ExtrudeReference::EntityReference {
                entity_id: Some(region_id),
                entity_reference: None,
            })
            .build(),
    );
    let result = ctx
        .engine
        .send_modeling_cmd(&ctx.engine_batch, Uuid::new_v4(), SourceRange::default(), &command)
        .await;
    ctx.close().await;

    match result {
        Err(error)
            if error.message() == "Failed to extrude the profile curve. Possible 0-length sections may be present" => {}
        Err(error) if error.is_retryable() => {
            panic!("region-liveness engine contract transport failed for `{case_name}`: {error}")
        }
        result => region_liveness_changed(
            case_name,
            "the aliased ExtrudeToReference command to fail with `Failed to extrude the profile curve. Possible 0-length sections may be present`",
            &format!("the engine returned `{result:?}`"),
        ),
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn same_region_as_sweep_profile_and_trajectory_is_a_successful_no_op() {
    let case_name = "same_region_as_sweep_profile_and_trajectory_is_a_successful_no_op";
    let (ctx, region_id) = prepare_live_region(case_name, "same_region_multiple_roles_source.kcl").await;
    let command = ModelingCmd::from(
        mcmd::Sweep::builder()
            .target(region_id.into())
            .trajectory(region_id.into())
            .sectional(false)
            .tolerance(LengthUnit(0.0000001))
            .body_type(Default::default())
            .translate_profile_to_path(true)
            .orient_profile_perpendicular(true)
            .version(2)
            .build(),
    );
    let operation_id = Uuid::new_v4();
    let result = ctx
        .engine
        .send_modeling_cmd(&ctx.engine_batch, operation_id, SourceRange::default(), &command)
        .await;

    match result {
        Ok(OkWebSocketResponseData::Modeling {
            modeling_response: OkModelingCmdResponse::Sweep(response),
        }) if response.bodies_created.bodies.is_empty() && response.bodies_updated.bodies.is_empty() => {}
        Err(error) if error.is_retryable() => {
            ctx.close().await;
            panic!("region-liveness engine contract transport failed for `{case_name}`: {error}")
        }
        result => {
            ctx.close().await;
            region_liveness_changed(
                case_name,
                "the aliased Sweep command to report success with no created or updated bodies",
                &format!("the engine returned `{result:?}`"),
            )
        }
    }

    let source_lookup = ctx
        .engine
        .send_modeling_cmd(
            &ctx.engine_batch,
            Uuid::new_v4(),
            SourceRange::default(),
            &ModelingCmd::from(mcmd::EntityGetAllChildUuids::builder().entity_id(region_id).build()),
        )
        .await;

    match source_lookup {
        Ok(OkWebSocketResponseData::Modeling {
            modeling_response: OkModelingCmdResponse::EntityGetAllChildUuids(_),
        }) => {}
        Err(error) if error.is_retryable() => {
            ctx.close().await;
            panic!("region-liveness engine contract transport failed for `{case_name}`: {error}")
        }
        result => {
            ctx.close().await;
            region_liveness_changed(
                case_name,
                "the aliased Sweep command to leave its source Region live",
                &format!("the source lookup returned `{result:?}`"),
            )
        }
    }

    let destination_lookup = ctx
        .engine
        .send_modeling_cmd(
            &ctx.engine_batch,
            Uuid::new_v4(),
            SourceRange::default(),
            &ModelingCmd::from(mcmd::EntityGetAllChildUuids::builder().entity_id(operation_id).build()),
        )
        .await;
    ctx.close().await;

    match destination_lookup {
        Err(error) if error.message() == "No such entity exists" => {}
        Err(error) if error.is_retryable() => {
            panic!("region-liveness engine contract transport failed for `{case_name}`: {error}")
        }
        result => region_liveness_changed(
            case_name,
            "the aliased Sweep command to create no destination entity",
            &format!("the destination lookup returned `{result:?}`"),
        ),
    }
}

async fn assert_clone_region_known_failure(case_name: &str, file_name: &str) {
    let prepared = execute_with_retries(&RetryConfig::default(), || execute_first_operation(file_name)).await;
    let (ctx, exec_state) = prepared
        .unwrap_or_else(|error| panic!("region-liveness engine contract setup failed for `{case_name}`: {error}"));

    let region_id = exec_state
        .root_module_artifact_state()
        .commands
        .iter()
        .rev()
        .find(|artifact_command| matches!(artifact_command.command, ModelingCmd::CreateRegion(_)))
        .map(|artifact_command| artifact_command.cmd_id)
        .unwrap_or_else(|| panic!("fixture `{case_name}` did not create an engine Region"));

    let source_lookup = ctx
        .engine
        .send_modeling_cmd(
            &ctx.engine_batch,
            Uuid::new_v4(),
            SourceRange::default(),
            &ModelingCmd::from(mcmd::EntityGetAllChildUuids::builder().entity_id(region_id).build()),
        )
        .await;

    match source_lookup {
        Ok(OkWebSocketResponseData::Modeling {
            modeling_response: OkModelingCmdResponse::EntityGetAllChildUuids(_),
        }) => {}
        Err(error) if error.is_retryable() => {
            ctx.close().await;
            panic!("region-liveness engine contract transport failed for `{case_name}`: {error}")
        }
        result => {
            ctx.close().await;
            region_liveness_changed(
                case_name,
                "the engine object created by region() to exist before EntityClone",
                &format!("the source lookup returned `{result:?}`"),
            )
        }
    }

    // Send exactly one clone command against the freshly verified Region.
    // This is not evidence that a successful clone leaves its source live:
    // no clone occurs. It pins the independent engine failure so the test
    // can be replaced with successful source-and-clone reuse coverage when
    // clone(Region) is fixed.
    let clone_id = Uuid::new_v4();
    let clone_result = ctx
        .engine
        .send_modeling_cmd(
            &ctx.engine_batch,
            clone_id,
            SourceRange::default(),
            &ModelingCmd::from(mcmd::EntityClone::builder().entity_id(region_id).build()),
        )
        .await;

    match clone_result {
        Ok(OkWebSocketResponseData::Modeling {
            modeling_response: OkModelingCmdResponse::EntityClone(response),
        }) if response.face_edge_ids.is_empty() => {}
        Err(error) if error.is_retryable() => {
            panic!("region-liveness engine contract transport failed for `{case_name}`: {error}")
        }
        result => {
            ctx.close().await;
            region_liveness_changed(
                case_name,
                "EntityClone to report success with no destination while the independent clone(Region) bug is open",
                &format!("EntityClone returned `{result:?}`"),
            )
        }
    }

    let destination_lookup = ctx
        .engine
        .send_modeling_cmd(
            &ctx.engine_batch,
            Uuid::new_v4(),
            SourceRange::default(),
            &ModelingCmd::from(mcmd::EntityGetAllChildUuids::builder().entity_id(clone_id).build()),
        )
        .await;
    ctx.close().await;

    match destination_lookup {
        Err(error) if error.message() == "No such entity exists" => {}
        Err(error) if error.is_retryable() => {
            panic!("region-liveness engine contract transport failed for `{case_name}`: {error}")
        }
        result => region_liveness_changed(
            case_name,
            "the clone destination to be absent while the independent clone(Region) bug is open",
            &format!("the clone destination lookup returned `{result:?}`"),
        ),
    }
}

async fn assert_fixture_succeeds(case_name: &str, file_name: &str, expected: &str) {
    let path = input_path(file_name);
    let input = std::fs::read_to_string(&path)
        .unwrap_or_else(|error| panic!("failed to read region-liveness fixture {}: {error}", path.display()));
    let result = execute_with_retries(&RetryConfig::default(), || {
        crate::test_server::execute(&input, Some(path.clone()))
    })
    .await;

    match result {
        Ok(()) => {}
        Err(error) if error.is_retryable() => {
            panic!("region-liveness engine contract transport failed for `{case_name}`: {error}")
        }
        Err(error) => region_liveness_changed(case_name, expected, &format!("execution failed with `{error}`")),
    }
}

async fn assert_region_is_reusable(case_name: &str, file_name: &str) {
    assert_fixture_succeeds(case_name, file_name, "the region to remain reusable").await;
}

#[tokio::test(flavor = "multi_thread")]
async fn region_liveness_warnings_match_in_mock_and_real_execution() {
    let case_name = "region_liveness_warnings_match_in_mock_and_real_execution";
    let file_name = "interpreter_warning_parity.kcl";
    let (_, input, program) = read_fixture(file_name);

    let mock_ctx = ExecutorContext::new_mock(None).await;
    let mock_outcome = mock_ctx
        .run_mock(&program, &MockConfig::default())
        .await
        .unwrap_or_else(|error| panic!("mock execution failed for `{case_name}`: {error}"));
    mock_ctx.close().await;

    let prepared = execute_with_retries(&RetryConfig::default(), || execute_first_operation(file_name)).await;
    let (real_ctx, real_state) =
        prepared.unwrap_or_else(|error| panic!("real execution failed for `{case_name}`: {error}"));
    real_ctx.close().await;

    let mock_issues = region_liveness_issues(&mock_outcome.issues);
    let real_issues = region_liveness_issues(real_state.issues());
    assert_eq!(
        mock_issues, real_issues,
        "mock and real region-liveness warnings differ"
    );

    let expected = [
        (
            argument_range(&input, "hidden = hide("),
            format!(
                "`sharedRegion` was already consumed by `extrude`. Passing it to `hide` may fail or have no effect because its engine object may no longer be valid. {REGION_REUSE_WORKAROUND}"
            ),
        ),
        (
            argument_range(&input, "delete("),
            format!(
                "`sharedRegion` was already consumed by `extrude`. Passing it to `delete` may fail or have no effect because its engine object may no longer be valid. {REGION_REUSE_WORKAROUND}"
            ),
        ),
    ];
    assert_eq!(mock_issues.len(), expected.len(), "unexpected region-liveness issues");
    for (issue, (source_range, message)) in mock_issues.iter().zip(expected) {
        assert_eq!(issue.source_range, source_range);
        assert_eq!(issue.message, message);
        assert_eq!(issue.severity, Severity::Warning);
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn region_liveness_errors_match_in_mock_and_real_execution() {
    let case_name = "region_liveness_errors_match_in_mock_and_real_execution";
    let file_name = "interpreter_error_parity.kcl";
    let (path, input, program) = read_fixture(file_name);

    let mock_ctx = ExecutorContext::new_mock(None).await;
    let mock_error = mock_ctx
        .run_mock(&program, &MockConfig::default())
        .await
        .expect_err("mock execution should reject a consumed sweep profile");
    mock_ctx.close().await;

    let real_error = execute_with_retries(&RetryConfig::default(), || {
        crate::test_server::execute(&input, Some(path.clone()))
    })
    .await
    .expect_err("real execution should reject a consumed sweep profile");
    let ExecError::Kcl(real_error) = real_error else {
        panic!("real execution failed outside KCL for `{case_name}`: {real_error}");
    };

    assert_eq!(
        mock_error.error, real_error.error,
        "mock and real region-liveness errors differ"
    );
    assert_eq!(
        mock_error.error.message(),
        format!(
            "`sharedRegion` was already consumed by a `extrude` operation and can no longer be used. {REGION_REUSE_WORKAROUND}"
        )
    );
}

#[test]
#[should_panic(expected = "THE KCL LOGIC FOR LIVENESS OF REGIONS NEEDS TO BE UPDATED")]
fn engine_contract_change_has_an_actionable_failure_message() {
    region_liveness_changed(
        "diagnostic contract",
        "the pinned engine behavior",
        "changed engine behavior",
    )
}

#[tokio::test(flavor = "multi_thread")]
async fn consumed_region_contracts() {
    let cases = [
        (
            "extrude_target_is_consumed",
            "input.kcl",
            ContractCommand::Extrude,
            "Unable to extract solid2D within this object to extrude from",
        ),
        (
            "twist_extrude_target_is_consumed",
            "twist_extrude.kcl",
            ContractCommand::TwistExtrude,
            "Unable to extract solid2D within this object to extrude from",
        ),
        (
            "extrude_to_reference_target_is_consumed",
            "extrude_to_reference.kcl",
            ContractCommand::ExtrudeToReference,
            "Unable to extract solid2D within this object to extrude from",
        ),
        (
            "revolve_target_is_consumed",
            "revolve.kcl",
            ContractCommand::Revolve,
            "Unable to extract solid2D within this object to revolve from",
        ),
        (
            "revolve_about_edge_target_is_consumed",
            "revolve_about_edge.kcl",
            ContractCommand::RevolveAboutEdge,
            "Unable to extract solid2D within this object to revolve from",
        ),
        (
            "sweep_profile_is_consumed",
            "sweep_profile.kcl",
            ContractCommand::Sweep,
            "Unable to extract solid2D within this object to sweep from",
        ),
        (
            "delete_target_is_consumed",
            "delete_target.kcl",
            ContractCommand::RemoveSceneObjects,
            "No such object exists",
        ),
        (
            "duplicate_extrude_profiles_are_rejected",
            "duplicate_extrude_profiles.kcl",
            ContractCommand::Extrude,
            "Unable to extract solid2D within this object to extrude from",
        ),
        (
            "duplicate_revolve_profiles_are_rejected",
            "duplicate_revolve_profiles.kcl",
            ContractCommand::Revolve,
            "Unable to extract solid2D within this object to revolve from",
        ),
        (
            "duplicate_sweep_profiles_are_rejected",
            "duplicate_sweep_profiles.kcl",
            ContractCommand::Sweep,
            "Unable to extract solid2D within this object to sweep from",
        ),
    ];

    for (case_name, file_name, command, expected_message) in cases {
        assert_region_is_consumed(case_name, file_name, command, expected_message).await;
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn every_mixed_consuming_command_has_pinned_second_operation_behavior() {
    let matrix_name = "every_mixed_consuming_command_has_pinned_second_operation_behavior";
    let (ctx, create_region_command, command_templates) = prepare_consuming_command_matrix(matrix_name).await;

    for first in ContractCommand::ALL {
        for second in ContractCommand::ALL {
            if first == second {
                continue;
            }

            let case_name = format!("{}_then_{}", first.name(), second.name());
            let region_id = Uuid::new_v4();
            let create_result = ctx
                .engine
                .send_modeling_cmd(
                    &ctx.engine_batch,
                    region_id,
                    SourceRange::default(),
                    &create_region_command,
                )
                .await;
            match create_result {
                Ok(_) => {}
                Err(error) if error.is_retryable() => {
                    ctx.close().await;
                    panic!("region-liveness engine contract transport failed for `{case_name}`: {error}")
                }
                Err(error) => {
                    ctx.close().await;
                    region_liveness_changed(
                        &case_name,
                        "region(...) to create a fresh profile for the command pair",
                        &format!("CreateRegion failed with `{}`", error.message()),
                    )
                }
            }

            let first_command = first.retarget(command_template(&command_templates, first), region_id);
            let first_result = ctx
                .engine
                .send_modeling_cmd(
                    &ctx.engine_batch,
                    Uuid::new_v4(),
                    SourceRange::default(),
                    &first_command,
                )
                .await;
            match first_result {
                Ok(_) => {}
                Err(error) if error.is_retryable() => {
                    ctx.close().await;
                    panic!("region-liveness engine contract transport failed for `{case_name}`: {error}")
                }
                Err(error) => {
                    ctx.close().await;
                    region_liveness_changed(
                        &case_name,
                        &format!("the first {} command to succeed", first.name()),
                        &format!("the engine returned error `{}`", error.message()),
                    )
                }
            }

            let second_command = second.retarget(command_template(&command_templates, second), region_id);
            let second_result = ctx
                .engine
                .send_modeling_cmd(
                    &ctx.engine_batch,
                    Uuid::new_v4(),
                    SourceRange::default(),
                    &second_command,
                )
                .await;
            match second_result {
                Ok(_) if second == ContractCommand::RemoveSceneObjects => {}
                Err(error)
                    if second != ContractCommand::RemoveSceneObjects
                        && error.message() == second.second_use_error_after(first) => {}
                Err(error) if error.is_retryable() => {
                    ctx.close().await;
                    panic!("region-liveness engine contract transport failed for `{case_name}`: {error}")
                }
                Err(error) => {
                    ctx.close().await;
                    region_liveness_changed(
                        &case_name,
                        if second == ContractCommand::RemoveSceneObjects {
                            "delete to accept a profile consumed by another command".to_owned()
                        } else {
                            format!(
                                "the second {} command to fail with `{}`",
                                second.name(),
                                second.second_use_error_after(first)
                            )
                        }
                        .as_str(),
                        &format!("the engine returned error `{}`", error.message()),
                    )
                }
                Ok(response) => {
                    ctx.close().await;
                    region_liveness_changed(
                        &case_name,
                        &format!(
                            "the first {} command to consume the profile before {}",
                            first.name(),
                            second.name()
                        ),
                        &format!("the engine accepted the second command with response {response:?}"),
                    )
                }
            }
        }
    }

    ctx.close().await;
}

#[tokio::test(flavor = "multi_thread")]
async fn regions_from_one_original_sketch_are_independently_consumable() {
    assert_fixture_succeeds(
        "regions_from_one_original_sketch_are_independently_consumable",
        "mixed_profile_consumers_source.kcl",
        "each region(...) result from the original sketch to be independently consumable",
    )
    .await;
}

#[tokio::test(flavor = "multi_thread")]
async fn reusable_region_contracts() {
    let cases = [
        ("extrude_reference_region_is_reusable", "extrude_reference_region.kcl"),
        (
            "pattern_transform_2d_source_region_is_reusable",
            "pattern_transform_2d_source.kcl",
        ),
        (
            "pattern_linear_2d_source_region_is_reusable",
            "pattern_linear_2d_source.kcl",
        ),
        (
            "pattern_circular_2d_source_region_is_reusable",
            "pattern_circular_2d_source.kcl",
        ),
        ("mirror_2d_source_region_is_reusable", "mirror_2d_source.kcl"),
        (
            "mirror_2d_across_edge_source_region_is_reusable",
            "mirror_2d_across_edge_source.kcl",
        ),
        ("transform_source_region_is_reusable", "transform_source.kcl"),
        ("hidden_region_is_reusable", "hide_source.kcl"),
        ("extend_path_region_is_reusable", "extend_path_region.kcl"),
        ("close_path_region_is_reusable", "close_path_region.kcl"),
        ("create_region_source_region_is_reusable", "region_source_region.kcl"),
        ("sweep_trajectory_is_reusable", "sweep_trajectory.kcl"),
        ("loft_sections_are_reusable", "loft_sections.kcl"),
        ("subtract2d_target_is_reusable", "subtract2d_target.kcl"),
        ("subtract2d_tool_is_reusable", "subtract2d_tool.kcl"),
    ];

    for (case_name, file_name) in cases {
        assert_region_is_reusable(case_name, file_name).await;
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn duplicate_delete_targets_are_deduplicated() {
    assert_fixture_succeeds(
        "duplicate_delete_targets_are_deduplicated",
        "duplicate_delete_targets.kcl",
        "duplicate delete targets to be deduplicated and accepted",
    )
    .await;
}

#[tokio::test(flavor = "multi_thread")]
async fn clone_source_region_is_reusable_is_unverified_while_clone_is_broken() {
    assert_clone_region_known_failure(
        "clone_source_region_is_reusable_is_unverified_while_clone_is_broken",
        "clone_source.kcl",
    )
    .await;
}
