//! Engine-backed regressions for CSG artifact consumption.

use anyhow::Context;
use anyhow::bail;
use anyhow::ensure;
use indexmap::IndexMap;
use kcl_api::ArtifactId;
use kcl_api::artifact::Artifact;
use kcl_api::artifact::CompositeSolidSubType;
use kittycad_modeling_cmds::ModelingCmd;
use kittycad_modeling_cmds::each_cmd as mcmd;
use kittycad_modeling_cmds::ok_response::OkModelingCmdResponse;
use kittycad_modeling_cmds::shared::BodyType;
use kittycad_modeling_cmds::shared::EntityType;
use kittycad_modeling_cmds::units::UnitVolume;
use kittycad_modeling_cmds::websocket::OkWebSocketResponseData;
use uuid::Uuid;

use crate::ExecOutcome;
use crate::ExecutorContext;
use crate::KclError;
use crate::Program;
use crate::csg_test_fixtures::CsgFixture;
use crate::execution::KclValue;
use crate::execution::Solid;
use crate::test_server::TestGraphicsParams;
use crate::util::RetryConfig;
use crate::util::execute_with_retries;

#[derive(Debug)]
enum EngineSolidState {
    Live { body_type: BodyType, volume: f64 },
    Absent,
}

struct Execution {
    outcome: ExecOutcome,
    engine_states: IndexMap<Uuid, EngineSolidState>,
}

fn solids<'a>(outcome: &'a ExecOutcome, name: &str) -> anyhow::Result<Vec<&'a Solid>> {
    match outcome.test_program_memory.get(name) {
        Some(KclValue::Solid { value }) => Ok(vec![value]),
        Some(KclValue::HomArray { value, .. }) => value
            .iter()
            .map(|value| value.as_solid().context("every result array element must be a solid"))
            .collect(),
        other => bail!("fixture variable {name} must contain solid bodies, received {other:?}"),
    }
}

fn input<'a>(outcome: &'a ExecOutcome, name: &str) -> &'a Solid {
    outcome.test_program_memory[name]
        .as_solid()
        .unwrap_or_else(|| panic!("fixture variable {name} must be a solid"))
}

async fn engine_solid_state(ctx: &ExecutorContext, id: Uuid) -> anyhow::Result<EngineSolidState> {
    let send = |command| async move {
        ctx.engine
            .send_modeling_cmd(&ctx.engine_batch, Uuid::new_v4(), Default::default(), &command)
            .await
    };
    let scene = send(ModelingCmd::from(
        mcmd::SceneGetEntityIds::builder()
            .filter(vec![EntityType::Solid3D])
            .skip(0)
            .take(1000)
            .build(),
    ))
    .await;
    let body_type = send(ModelingCmd::from(
        mcmd::Solid3dGetBodyType::builder().object_id(id).build(),
    ))
    .await;
    let volume = send(ModelingCmd::from(
        mcmd::Volume::builder()
            .entity_ids(vec![id])
            .output_unit(UnitVolume::CubicMillimeters)
            .build(),
    ))
    .await;

    let Ok(OkWebSocketResponseData::Modeling {
        modeling_response: OkModelingCmdResponse::SceneGetEntityIds(scene),
    }) = scene
    else {
        bail!("scene membership query for {id} must succeed, received {scene:?}");
    };
    if scene.entity_ids.iter().flatten().any(|entity_id| *entity_id == id) {
        let Ok(OkWebSocketResponseData::Modeling {
            modeling_response: OkModelingCmdResponse::Solid3dGetBodyType(body_type),
        }) = body_type
        else {
            bail!("body-type query for live entity {id} must succeed, received {body_type:?}");
        };
        let Ok(OkWebSocketResponseData::Modeling {
            modeling_response: OkModelingCmdResponse::Volume(volume),
        }) = volume
        else {
            bail!("volume query for live entity {id} must succeed, received {volume:?}");
        };
        Ok(EngineSolidState::Live {
            body_type: body_type.body_type,
            volume: volume.volume,
        })
    } else {
        ensure!(
            body_type.as_ref().is_err_and(
                |error| matches!(error, KclError::Engine { .. }) && error.message() == "No such object exists"
            ),
            "absent entity {id} must fail its body-type query as missing, received {body_type:?}"
        );
        ensure!(
            volume
                .as_ref()
                .is_err_and(|error| matches!(error, KclError::Engine { .. })
                    && error.message().contains("No such Brep object exists")),
            "absent entity {id} must fail its volume query as missing, received {volume:?}"
        );
        Ok(EngineSolidState::Absent)
    }
}

async fn execute_fixture(fixture: CsgFixture, input_names: &[&str]) -> Execution {
    let program = Program::parse_no_errs(fixture.source())
        .unwrap_or_else(|error| panic!("{fixture:?} must parse as KCL 3.0: {error}"));
    let (state, ctx, environment, _) = execute_with_retries(&RetryConfig::default(), || {
        crate::test_server::execute_sim_test_no_close(program.clone(), None, None, TestGraphicsParams::None)
    })
    .await
    .expect("the CSG fixture must execute against the geometry engine");

    let result = async {
        let outcome = state.into_exec_outcome(environment, &ctx).await?;
        let errors = outcome.errors().collect::<Vec<_>>();
        ensure!(
            errors.is_empty(),
            "{fixture:?} must execute without errors: {errors:#?}"
        );
        let mut engine_states = IndexMap::new();
        for variable in input_names.iter().copied().chain(std::iter::once("result")) {
            for solid in solids(&outcome, variable)? {
                if !engine_states.contains_key(&solid.id) {
                    engine_states.insert(solid.id, engine_solid_state(&ctx, solid.id).await?);
                }
            }
        }
        Ok::<_, anyhow::Error>(Execution { outcome, engine_states })
    }
    .await;
    ctx.close().await;
    result.unwrap_or_else(|error| panic!("{fixture:?}: fixture execution and engine queries must succeed: {error:#}"))
}

enum VolumeExpectation {
    Finite,
    CubicMillimeters(f64),
}

fn assert_live(execution: &Execution, id: Uuid, expected_body_type: BodyType, expected_volume: VolumeExpectation) {
    let state = &execution.engine_states[&id];
    let EngineSolidState::Live { body_type, volume } = state else {
        panic!("entity {id} must exist in the engine, received {state:?}");
    };
    assert_eq!(
        *body_type, expected_body_type,
        "entity {id} has an unexpected body type"
    );
    match expected_volume {
        VolumeExpectation::Finite => assert!(volume.is_finite(), "entity {id} must have finite volume"),
        VolumeExpectation::CubicMillimeters(expected_volume) => assert!(
            (volume - expected_volume).abs() < 0.001,
            "entity {id} must have volume {expected_volume} mm^3, received {volume} mm^3"
        ),
    }
}

fn assert_absent(execution: &Execution, id: Uuid) {
    let state = &execution.engine_states[&id];
    assert!(
        matches!(state, EngineSolidState::Absent),
        "consumed entity {id} must be absent from the engine, received {state:?}"
    );
}

#[derive(Clone, Copy)]
enum BooleanCase {
    UnionSweptInputs,
    UnionCompositeInput,
    UnionAddOperator,
    UnionOrOperator,
    IntersectSweptInputs,
    IntersectCompositeInput,
    IntersectAndOperator,
}

struct BooleanExpectations {
    fixture: CsgFixture,
    input_names: &'static [&'static str],
    sub_type: CompositeSolidSubType,
    volume: f64,
}

impl BooleanCase {
    fn expectations(self) -> BooleanExpectations {
        match self {
            Self::UnionSweptInputs => BooleanExpectations {
                fixture: CsgFixture::UnionSweptInputs,
                input_names: &["left", "right"],
                sub_type: CompositeSolidSubType::Union,
                volume: 1500.0,
            },
            Self::UnionCompositeInput => BooleanExpectations {
                fixture: CsgFixture::UnionCompositeInput,
                input_names: &["left", "right", "first", "third"],
                sub_type: CompositeSolidSubType::Union,
                volume: 2000.0,
            },
            Self::UnionAddOperator => BooleanExpectations {
                fixture: CsgFixture::UnionAddOperator,
                input_names: &["left", "right"],
                sub_type: CompositeSolidSubType::Union,
                volume: 1500.0,
            },
            Self::UnionOrOperator => BooleanExpectations {
                fixture: CsgFixture::UnionOrOperator,
                input_names: &["left", "right"],
                sub_type: CompositeSolidSubType::Union,
                volume: 1500.0,
            },
            Self::IntersectSweptInputs => BooleanExpectations {
                fixture: CsgFixture::IntersectSweptInputs,
                input_names: &["left", "right"],
                sub_type: CompositeSolidSubType::Intersect,
                volume: 500.0,
            },
            Self::IntersectCompositeInput => BooleanExpectations {
                fixture: CsgFixture::IntersectCompositeInput,
                input_names: &["left", "right", "first", "third"],
                sub_type: CompositeSolidSubType::Intersect,
                volume: 250.0,
            },
            Self::IntersectAndOperator => BooleanExpectations {
                fixture: CsgFixture::IntersectAndOperator,
                input_names: &["left", "right"],
                sub_type: CompositeSolidSubType::Intersect,
                volume: 500.0,
            },
        }
    }
}

async fn assert_boolean_consumption(case: BooleanCase) {
    let BooleanExpectations {
        fixture,
        input_names,
        sub_type,
        volume,
    } = case.expectations();
    let execution = execute_fixture(fixture, input_names).await;
    let outcome = &execution.outcome;
    let outputs = solids(outcome, "result").unwrap();
    assert_eq!(outputs.len(), 1, "{fixture:?} must return one output body");
    for name in input_names {
        assert_absent(&execution, input(outcome, name).id);
    }
    for output in &outputs {
        assert_live(
            &execution,
            output.id,
            BodyType::Solid,
            VolumeExpectation::CubicMillimeters(volume),
        );
    }

    for name in input_names {
        let artifact_id = input(outcome, name).artifact_id;
        let artifact = outcome
            .artifact_graph
            .get(&artifact_id)
            .expect("the input must have an artifact");
        let consumed = match artifact {
            Artifact::Sweep(sweep) => sweep.consumed,
            Artifact::CompositeSolid(composite) => {
                assert_eq!(composite.sub_type, sub_type, "{fixture:?}: {name}");
                composite.consumed
            }
            _ => panic!("{fixture:?}: {name} must have a body artifact, received {artifact:?}"),
        };
        assert!(consumed, "{fixture:?}: input {name} must be marked consumed");
    }
    for output in outputs {
        let artifact = outcome
            .artifact_graph
            .get(&output.artifact_id)
            .expect("the output must have an artifact");
        let Artifact::CompositeSolid(composite) = artifact else {
            panic!("{fixture:?}: output must have a composite artifact, received {artifact:?}");
        };
        assert_eq!(composite.sub_type, sub_type);
        assert!(!composite.consumed, "{fixture:?}: the output must remain unconsumed");
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_multi_target_subtract_outputs_remain_unconsumed_in_artifact_graph() {
    let execution = execute_fixture(CsgFixture::SubtractReusedOutputs, &["leftBody", "rightBody", "tool"]).await;
    let outcome = &execution.outcome;
    let outputs = solids(outcome, "result").unwrap();
    assert_eq!(outputs.len(), 2, "the fixture must return two subtraction outputs");
    for output in &outputs {
        assert_live(
            &execution,
            output.id,
            BodyType::Solid,
            VolumeExpectation::CubicMillimeters(56.0),
        );
    }
    assert!(
        outputs.iter().any(|output| {
            ["leftBody", "rightBody"]
                .iter()
                .any(|name| output.artifact_id == ArtifactId::new(input(outcome, name).id))
        }),
        "the subtraction must reuse a target's engine UUID as an output artifact ID"
    );
    for output in outputs {
        let artifact = outcome
            .artifact_graph
            .get(&output.artifact_id)
            .expect("the output must have an artifact");
        assert!(
            matches!(artifact, Artifact::CompositeSolid(body) if !body.consumed),
            "live subtraction output {} must have an unconsumed composite artifact, received {artifact:?}",
            output.id
        );
    }
}

enum SplitCase {
    KeepTools,
    ConsumeTools,
    DefaultToolConsumption,
    KeepCompositeTool,
    ConsumeCompositeTool,
    KeepToolsAndMerge,
}

struct SplitExpectations {
    fixture: CsgFixture,
    keep_tools: bool,
    tool_name: &'static str,
    tool_volume: f64,
    output_body_type: BodyType,
    output_count: usize,
}

impl SplitCase {
    fn expectations(self) -> SplitExpectations {
        match self {
            Self::KeepTools => SplitExpectations {
                fixture: CsgFixture::SplitKeepToolsTrue,
                keep_tools: true,
                tool_name: "cutter",
                tool_volume: 576.0,
                output_body_type: BodyType::Surface,
                output_count: 3,
            },
            Self::ConsumeTools => SplitExpectations {
                fixture: CsgFixture::SplitKeepToolsFalse,
                keep_tools: false,
                tool_name: "cutter",
                tool_volume: 576.0,
                output_body_type: BodyType::Surface,
                output_count: 3,
            },
            Self::DefaultToolConsumption => SplitExpectations {
                fixture: CsgFixture::SplitKeepToolsDefault,
                keep_tools: false,
                tool_name: "cutter",
                tool_volume: 576.0,
                output_body_type: BodyType::Surface,
                output_count: 3,
            },
            Self::KeepCompositeTool => SplitExpectations {
                fixture: CsgFixture::SplitCompositeToolKeepToolsTrue,
                keep_tools: true,
                tool_name: "compositeCutter",
                tool_volume: 720.0,
                output_body_type: BodyType::Surface,
                output_count: 3,
            },
            Self::ConsumeCompositeTool => SplitExpectations {
                fixture: CsgFixture::SplitCompositeToolKeepToolsFalse,
                keep_tools: false,
                tool_name: "compositeCutter",
                tool_volume: 720.0,
                output_body_type: BodyType::Surface,
                output_count: 3,
            },
            Self::KeepToolsAndMerge => SplitExpectations {
                fixture: CsgFixture::SplitKeepToolsTrueMerge,
                keep_tools: true,
                tool_name: "cutter",
                tool_volume: 576.0,
                output_body_type: BodyType::Solid,
                output_count: 1,
            },
        }
    }
}

async fn assert_split_consumption(case: SplitCase) {
    let expected = case.expectations();
    let fixture = expected.fixture;
    let execution = execute_fixture(fixture, &["target", expected.tool_name]).await;
    let outcome = &execution.outcome;
    let target = input(outcome, "target");
    let cutter = input(outcome, expected.tool_name);
    let outputs = solids(outcome, "result").unwrap();
    assert_eq!(
        outputs.len(),
        expected.output_count,
        "{fixture:?} has an unexpected output count"
    );
    assert_absent(&execution, target.id);
    if expected.keep_tools {
        assert_live(
            &execution,
            cutter.id,
            BodyType::Solid,
            VolumeExpectation::CubicMillimeters(expected.tool_volume),
        );
    } else {
        assert_absent(&execution, cutter.id);
    }
    for output in &outputs {
        assert_live(
            &execution,
            output.id,
            expected.output_body_type,
            VolumeExpectation::Finite,
        );
    }

    let output_ids = outputs.iter().map(|solid| solid.artifact_id).collect::<Vec<_>>();
    for (name, solid, expected_consumed) in [
        ("target", target, true),
        (expected.tool_name, cutter, !expected.keep_tools),
    ] {
        let artifact = outcome
            .artifact_graph
            .get(&solid.artifact_id)
            .expect("the input must have an artifact");
        let (consumed, replacement_id) = match artifact {
            Artifact::Sweep(sweep) => {
                let Some(Artifact::Path(path)) = sweep.path_id.and_then(|id| outcome.artifact_graph.get(&id)) else {
                    panic!("{fixture:?}: {name} must retain its profile path");
                };
                assert_eq!(path.id, ArtifactId::new(solid.id));
                assert_eq!(path.sweep_id, Some(sweep.id));
                assert!(path.consumed, "{fixture:?}: extrusion must leave its profile consumed");
                (sweep.consumed, path.composite_solid_id)
            }
            Artifact::CompositeSolid(composite) => {
                assert_eq!(composite.sub_type, CompositeSolidSubType::Union);
                (composite.consumed, composite.composite_solid_id)
            }
            _ => panic!("{fixture:?}: {name} must have a body artifact, received {artifact:?}"),
        };
        assert_eq!(consumed, expected_consumed, "{fixture:?}: {name}");
        if expected_consumed {
            assert!(
                replacement_id.is_some_and(|id| output_ids.contains(&id)),
                "{fixture:?}: consumed input {name} must refer to a split output, received {replacement_id:?}"
            );
        } else {
            assert_eq!(
                replacement_id, None,
                "{fixture:?}: retained tool {name} must have no replacement"
            );
        }
    }
    for output in outputs {
        let artifact = outcome
            .artifact_graph
            .get(&output.artifact_id)
            .expect("the output must have an artifact");
        let Artifact::CompositeSolid(composite) = artifact else {
            panic!("{fixture:?}: output must have a composite artifact, received {artifact:?}");
        };
        assert_eq!(composite.sub_type, CompositeSolidSubType::Split);
        assert_eq!(composite.solid_ids, vec![ArtifactId::new(target.id)]);
        assert_eq!(composite.tool_ids, vec![ArtifactId::new(cutter.id)]);
        assert!(
            !composite.consumed,
            "{fixture:?}: the split output must remain unconsumed"
        );
        assert_eq!(
            composite.composite_solid_id, None,
            "{fixture:?}: the output must have no replacement"
        );
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_split_keep_tools_true_preserves_tool_artifact() {
    assert_split_consumption(SplitCase::KeepTools).await;
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_split_keep_tools_false_consumes_tool_artifact() {
    assert_split_consumption(SplitCase::ConsumeTools).await;
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_split_keep_tools_omitted_consumes_tool_artifact() {
    assert_split_consumption(SplitCase::DefaultToolConsumption).await;
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_split_keep_tools_true_preserves_composite_tool_artifact() {
    assert_split_consumption(SplitCase::KeepCompositeTool).await;
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_split_keep_tools_false_consumes_composite_tool_artifact() {
    assert_split_consumption(SplitCase::ConsumeCompositeTool).await;
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_split_keep_tools_true_merge_preserves_tool_artifact() {
    assert_split_consumption(SplitCase::KeepToolsAndMerge).await;
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_union_consumes_swept_inputs() {
    assert_boolean_consumption(BooleanCase::UnionSweptInputs).await;
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_union_consumes_composite_input() {
    assert_boolean_consumption(BooleanCase::UnionCompositeInput).await;
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_union_add_operator_consumes_inputs() {
    assert_boolean_consumption(BooleanCase::UnionAddOperator).await;
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_union_or_operator_consumes_inputs() {
    assert_boolean_consumption(BooleanCase::UnionOrOperator).await;
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_intersect_consumes_swept_inputs() {
    assert_boolean_consumption(BooleanCase::IntersectSweptInputs).await;
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_intersect_consumes_composite_input() {
    assert_boolean_consumption(BooleanCase::IntersectCompositeInput).await;
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_intersect_and_operator_consumes_inputs() {
    assert_boolean_consumption(BooleanCase::IntersectAndOperator).await;
}
