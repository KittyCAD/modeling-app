use std::any::Any;
use std::panic::AssertUnwindSafe;
use std::panic::catch_unwind;
use std::path::Path;
use std::path::PathBuf;

use indexmap::IndexMap;
use kittycad_modeling_cmds::ModelingCmd;
use kittycad_modeling_cmds::each_cmd as mcmd;
use kittycad_modeling_cmds::ok_response::OkModelingCmdResponse;
use kittycad_modeling_cmds::units::UnitArea;
use kittycad_modeling_cmds::units::UnitDensity;
use kittycad_modeling_cmds::units::UnitLength;
use kittycad_modeling_cmds::units::UnitMass;
use kittycad_modeling_cmds::websocket::OkWebSocketResponseData;
use kittycad_modeling_cmds::websocket::WebSocketResponse;
use serde::Deserialize;
use serde::Serialize;
use uuid::Uuid;

use crate::ExecOutcome;
use crate::ExecState;
use crate::ExecutorContext;
use crate::ModuleId;
use crate::errors::KclError;
use crate::errors::Tag;
use crate::execution::AbstractSegment;
use crate::execution::ArtifactGraph;
use crate::execution::ArtifactGraphMermaidExt;
use crate::execution::CameraView;
use crate::execution::EnvironmentRef;
use crate::execution::KclValue;
use crate::execution::KclValueView;
use crate::execution::ModuleArtifactState;
use crate::execution::NamedViewValue;
use crate::execution::SketchConstraint;
use crate::modules::ModulePath;
use crate::modules::ModuleRepr;
use crate::test_server::TestGraphicsParams;
use crate::tooling::render_artifacts::RENDERED_MODEL_NAME;
use crate::util::RetryConfig;
use crate::util::execute_with_retries;
use crate::walk::Node;
use crate::walk::walk;

mod kcl_samples;
mod region_liveness_engine_contract;

/// Preserve the concrete runtime types used by opaque debug-only API values in
/// program-memory snapshots. Insta distinguishes structs from maps when sorting
/// fields; serializing these values through `serde_json::Value` would turn every
/// nested struct into a map and reorder its fields alphabetically.
#[derive(Serialize)]
#[serde(untagged)]
enum ProgramMemoryValueSnapshot {
    Runtime(RuntimeProgramMemoryValueSnapshot),
    View(KclValueView),
}

#[derive(Serialize)]
#[serde(tag = "type")]
enum RuntimeProgramMemoryValueSnapshot {
    SketchConstraint {
        value: Box<SketchConstraint>,
    },
    CameraView {
        value: Box<CameraView>,
    },
    NamedView {
        value: Box<NamedViewValue>,
    },
    Segment {
        value: Box<AbstractSegment>,
    },
    Tuple {
        value: Vec<ProgramMemoryValueSnapshot>,
    },
    HomArray {
        value: Vec<ProgramMemoryValueSnapshot>,
    },
    Object {
        value: Box<IndexMap<String, ProgramMemoryValueSnapshot>>,
        constrainable: bool,
    },
}

impl From<KclValue> for ProgramMemoryValueSnapshot {
    fn from(value: KclValue) -> Self {
        let runtime = match value {
            KclValue::SketchConstraint { value } => RuntimeProgramMemoryValueSnapshot::SketchConstraint { value },
            KclValue::CameraView { value } => RuntimeProgramMemoryValueSnapshot::CameraView { value },
            KclValue::NamedView { value } => RuntimeProgramMemoryValueSnapshot::NamedView { value },
            KclValue::Segment { value } => RuntimeProgramMemoryValueSnapshot::Segment { value },
            KclValue::Tuple { value, .. } => RuntimeProgramMemoryValueSnapshot::Tuple {
                value: value.into_iter().map(Self::from).collect(),
            },
            KclValue::HomArray { value, .. } => RuntimeProgramMemoryValueSnapshot::HomArray {
                value: value.into_iter().map(Self::from).collect(),
            },
            KclValue::Object {
                value, constrainable, ..
            } => RuntimeProgramMemoryValueSnapshot::Object {
                value: Box::new(
                    value
                        .into_iter()
                        .map(|(name, value)| (name, Self::from(value)))
                        .collect(),
                ),
                constrainable,
            },
            value => return Self::View(KclValueView::from(value)),
        };
        Self::Runtime(runtime)
    }
}

/// A simulation test.
#[derive(Debug, Clone)]
struct Test {
    /// The name of the test.
    name: String,
    /// The KCL file that's the entry point, e.g. "main.kcl", in the `input_dir`.
    entry_point: PathBuf,
    /// Input KCL files are in this directory.
    input_dir: PathBuf,
    /// Expected snapshot output files are in this directory.
    output_dir: PathBuf,
    /// True to skip asserting the artifact graph and only write it. The default
    /// is false and to assert it.
    skip_assert_artifact_graph: bool,
    /// Whether a successful execution should snapshot physical properties.
    snapshot_physical_properties: bool,
    /// If set, assert that execution emits exactly this many deprecation warnings.
    expected_deprecation_warnings: Option<usize>,
    /// If set, redact the test's UUIDs.
    #[cfg_attr(feature = "snapshot-engine-responses", expect(dead_code))]
    redact_uuids: bool,
    /// KCL versions to execute against. Empty means use the file as written.
    kcl_versions: Vec<String>,
    test_graphics_params: TestGraphicsParams,
}

const REPO_ROOT: &str = "../..";
const KCL_SAMPLE_DEPRECATION_VERSION: &str = "2.0";
const MATERIAL_DENSITY_KG_PER_CUBIC_METER: f64 = 1000.0;
// Physical properties come from floating-point geometry calculations. Require
// agreement to one part per trillion, with a small absolute floor for values
// near zero. The snapshots use fixed units: mm, mm^2, g, and kg/m^3.
const PHYSICAL_PROPERTIES_ABSOLUTE_TOLERANCE: f64 = 1e-9;
const PHYSICAL_PROPERTIES_RELATIVE_TOLERANCE: f64 = 1e-12;

fn is_writing() -> bool {
    matches!(std::env::var("ZOO_SIM_UPDATE").as_deref(), Ok("always"))
}

#[derive(Deserialize, Clone, Debug)]
#[serde(deny_unknown_fields)]
struct TestConfig {
    /// Replace UUIDs with the string "[uuid]", because otherwise the tests
    /// would constantly be changing the UUID. This is a stopgap measure
    /// until we make the engine more deterministic.
    #[serde(default = "default_redact_uuids")]
    redact_uuids: bool,
    #[serde(default)]
    kcl_versions: Vec<String>,
    #[serde(default)]
    test_graphics: TestGraphicsParams,
}

impl Default for TestConfig {
    fn default() -> Self {
        Self {
            redact_uuids: default_redact_uuids(),
            kcl_versions: Vec::new(),
            test_graphics: TestGraphicsParams::default(),
        }
    }
}

fn default_redact_uuids() -> bool {
    true
}

impl TestConfig {
    /// Read from the config file in the given directory, return None if the file doesn't exist.
    /// Panic if the file exists but was invalid, or some other IO error.
    fn from_file(test_dir: &Path) -> Option<Self> {
        let test_config_path = test_dir.join("config.toml");
        let config_str_res = std::fs::read_to_string(test_config_path);
        let config_str = match config_str_res {
            Ok(config_str) => config_str,
            Err(e) => {
                if e.kind() == std::io::ErrorKind::NotFound {
                    return None;
                }
                panic!("Could not read file: {e}")
            }
        };
        let config: TestConfig = toml::from_str(&config_str).unwrap();
        Some(config)
    }
}

impl Test {
    fn new(name: &str) -> Self {
        let test_dir = Path::new("tests").join(name);
        let test_config = TestConfig::from_file(&test_dir).unwrap_or_default();
        let TestConfig {
            redact_uuids,
            kcl_versions,
            test_graphics,
        } = test_config;
        let output_dir = if kcl_versions.is_empty() {
            test_dir.clone()
        } else {
            let output_dir = test_dir.join("output");
            std::fs::create_dir_all(&output_dir).unwrap();
            output_dir
        };
        Self {
            name: name.to_owned(),
            entry_point: test_dir.clone().join("input.kcl"),
            input_dir: test_dir,
            output_dir,
            skip_assert_artifact_graph: false,
            snapshot_physical_properties: true,
            expected_deprecation_warnings: None,
            redact_uuids,
            kcl_versions,
            test_graphics_params: test_graphics,
        }
    }

    /// Read in the entry point file and return its contents as a string.
    pub fn read(&self) -> String {
        std::fs::read_to_string(&self.entry_point)
            .unwrap_or_else(|e| panic!("Failed to read file: {:?} due to {e}", self.entry_point))
    }
}

impl ExecState {
    /// Same as [`Self::into_exec_outcome`], but also returns the module state.
    async fn into_test_exec_outcome(
        self,
        main_ref: EnvironmentRef,
        ctx: &ExecutorContext,
        project_directory: &Path,
    ) -> (
        ExecOutcome,
        IndexMap<String, ProgramMemoryValueSnapshot>,
        IndexMap<String, ModuleArtifactState>,
        Option<IndexMap<Uuid, WebSocketResponse>>,
    ) {
        let program_memory = self
            .program_memory_for_tests(main_ref)
            .expect("simulation test execution outcome should collect variables")
            .into_iter()
            .map(|(name, value)| (name, ProgramMemoryValueSnapshot::from(value)))
            .collect();
        let module_state = self.to_module_state(project_directory);
        #[cfg(feature = "snapshot-engine-responses")]
        let (outcome, responses) = {
            let mut exec_state = self;
            let responses = Some(exec_state.take_root_module_responses());
            let outcome = exec_state
                .into_exec_outcome(main_ref, ctx)
                .await
                .expect("simulation test execution outcome should collect variables");
            (outcome, responses)
        };
        #[cfg(not(feature = "snapshot-engine-responses"))]
        let (outcome, responses) = {
            let responses = None;
            let outcome = self
                .into_exec_outcome(main_ref, ctx)
                .await
                .expect("simulation test execution outcome should collect variables");
            (outcome, responses)
        };
        (outcome, program_memory, module_state, responses)
    }

    /// The keys of the map are the module paths.  Can't use `ModulePath` since
    /// it needs to be converted to a string to be a JSON object key.  The paths
    /// need to be relative so that generating locally works in CI.
    fn to_module_state(&self, _project_directory: &Path) -> IndexMap<String, ModuleArtifactState> {
        let project_directory = std::path::Path::new(REPO_ROOT)
            .canonicalize()
            .unwrap_or_else(|_| panic!("Failed to canonicalize project directory: {REPO_ROOT}"));
        let mut module_state = IndexMap::new();
        for info in self.modules().values() {
            let relative_path = relative_module_path(&info.path, &project_directory).unwrap_or_else(|err| {
                panic!(
                    "Failed to get relative module path for {:?} in {:?}; caused by {err:?}",
                    info.path, project_directory
                )
            });
            match &info.repr {
                ModuleRepr::Root => {
                    module_state.insert(relative_path, self.root_module_artifact_state().clone());
                }
                ModuleRepr::Kcl(_, None) => {
                    module_state.insert(relative_path, Default::default());
                }
                ModuleRepr::Kcl(_, Some(outcome)) => {
                    module_state.insert(relative_path, outcome.artifacts.clone());
                }
                ModuleRepr::Foreign(_, Some((_, module_artifacts))) => {
                    module_state.insert(relative_path, module_artifacts.clone());
                }
                ModuleRepr::Foreign(_, None) | ModuleRepr::Dummy => {}
            }
        }
        module_state
    }
}

fn relative_module_path(module_path: &ModulePath, abs_project_directory: &Path) -> Result<String, std::io::Error> {
    match module_path {
        ModulePath::Main => Ok("main".to_owned()),
        ModulePath::Local { value: path, .. } => {
            let abs_path = path.canonicalize()?;
            abs_path
                .strip_prefix(abs_project_directory)
                .map(|p| p.to_string_lossy())
                .map_err(|_| std::io::Error::other(format!("Failed to strip prefix from module path {abs_path:?}")))
        }
        ModulePath::Std { value } => Ok(format!("std::{value}")),
    }
}

fn assert_snapshot<F, R>(test: &Test, operation: &str, f: F)
where
    F: FnOnce() -> R,
{
    let mut settings = insta::Settings::clone_current();
    // These make the snapshots more readable and match our dir structure.
    settings.set_omit_expression(true);
    settings.set_snapshot_path(Path::new("..").join(&test.output_dir));
    settings.set_prepend_module_to_snapshot(false);
    settings.set_description(format!("{operation} {}.kcl", test.name));
    // We don't do it on the flowchart
    if operation != "Artifact graph flowchart" {
        // Sorting maps makes them easier to diff.
        settings.set_sort_maps(true);
    }
    #[cfg(not(feature = "snapshot-engine-responses"))]
    {
        if test.redact_uuids {
            // Replace UUIDs with the string "[uuid]", because otherwise the tests
            // would constantly be changing the UUID. This is a stopgap measure
            // until we make the engine more deterministic.
            settings.add_filter(
                r"\b[[:xdigit:]]{8}-[[:xdigit:]]{4}-[[:xdigit:]]{4}-[[:xdigit:]]{4}-[[:xdigit:]]{12}\b",
                "[uuid]",
            );
            settings.add_filter(
                r"\bface_id_[[:xdigit:]]{8}_[[:xdigit:]]{4}_[[:xdigit:]]{4}_[[:xdigit:]]{4}_[[:xdigit:]]{12}\b",
                "face_id_[uuid]",
            );
        }
    }
    // Run `f` (the closure that was passed in) with these settings.
    settings.bind(f);
}

fn physical_property_values_match(expected: f64, actual: f64) -> bool {
    approx::relative_eq!(
        expected,
        actual,
        epsilon = PHYSICAL_PROPERTIES_ABSOLUTE_TOLERANCE,
        max_relative = PHYSICAL_PROPERTIES_RELATIVE_TOLERANCE
    )
}

fn physical_properties_mismatch(
    expected: &serde_json::Value,
    actual: &serde_json::Value,
    path: &str,
) -> Option<String> {
    match (expected, actual) {
        (serde_json::Value::Number(expected), serde_json::Value::Number(actual)) => {
            let (Some(expected), Some(actual)) = (expected.as_f64(), actual.as_f64()) else {
                return (expected != actual).then(|| format!("{path}: expected {expected}, got {actual}"));
            };
            (!physical_property_values_match(expected, actual)).then(|| {
                format!(
                    "{path}: expected {expected}, got {actual} (absolute tolerance {}, relative tolerance {})",
                    PHYSICAL_PROPERTIES_ABSOLUTE_TOLERANCE, PHYSICAL_PROPERTIES_RELATIVE_TOLERANCE
                )
            })
        }
        (serde_json::Value::Object(expected), serde_json::Value::Object(actual)) => {
            for (key, expected_value) in expected {
                let child_path = format!("{path}.{key}");
                let Some(actual_value) = actual.get(key) else {
                    return Some(format!("{child_path}: missing from actual physical properties"));
                };
                if let Some(mismatch) = physical_properties_mismatch(expected_value, actual_value, &child_path) {
                    return Some(mismatch);
                }
            }
            actual
                .keys()
                .find(|key| !expected.contains_key(*key))
                .map(|key| format!("{path}.{key}: unexpected physical property"))
        }
        (serde_json::Value::Array(expected), serde_json::Value::Array(actual)) => {
            if expected.len() != actual.len() {
                return Some(format!(
                    "{path}: expected an array of length {}, got {}",
                    expected.len(),
                    actual.len()
                ));
            }
            expected
                .iter()
                .zip(actual)
                .enumerate()
                .find_map(|(index, (expected, actual))| {
                    physical_properties_mismatch(expected, actual, &format!("{path}[{index}]"))
                })
        }
        _ => (expected != actual).then(|| format!("{path}: expected {expected}, got {actual}")),
    }
}

fn assert_physical_properties_snapshot(test: &Test, actual: serde_json::Value) {
    if !is_writing()
        && let Ok(snapshot) = insta::Snapshot::from_file(&test.output_dir.join("physical_properties.snap"))
        && let Some(text) = snapshot.as_text()
        && let Ok(expected) = serde_json::from_str(&text.to_string())
        && physical_properties_mismatch(&expected, &actual, "physical_properties").is_none()
    {
        // Keep the original text after accepting numeric noise. Parsing and
        // serializing it again can change a float's last digit. Still invoke
        // Insta so it tracks the snapshot and applies its normal update policy.
        assert_snapshot(test, "Physical properties", || {
            insta::assert_snapshot!("physical_properties", text.to_string())
        });
        return;
    }

    // Missing, unreadable, or materially different snapshots use Insta's normal
    // failure reporting and update policy, including .snap.new review files.
    assert_snapshot(test, "Physical properties", || {
        insta::assert_json_snapshot!("physical_properties", actual)
    });
}

#[test]
fn physical_property_values_allow_numeric_noise_but_reject_wrong_results() {
    let expected = serde_json::json!({
        "surface_area": {
            "unit": "mm2",
            "value": 138_485.213_581_107_76,
        },
    });
    let observed_numeric_noise = serde_json::json!({
        "surface_area": {
            "unit": "mm2",
            "value": 138_485.213_581_107_73,
        },
    });
    let materially_wrong_surface_area = serde_json::json!({
        "surface_area": {
            "unit": "mm2",
            "value": 138_486.213_581_107_76,
        },
    });

    assert_eq!(
        physical_properties_mismatch(&expected, &observed_numeric_noise, "physical_properties"),
        None
    );
    assert!(physical_properties_mismatch(&expected, &materially_wrong_surface_area, "physical_properties").is_some());
}

#[test]
fn physical_properties_snapshot_preserves_insta_workflow() {
    const CHILD_MODE: &str = "KCL_PHYSICAL_PROPERTIES_SNAPSHOT_TEST_MODE";
    let Ok(mode) = std::env::var(CHILD_MODE) else {
        // Insta caches its environment configuration. Use subprocesses to test
        // each policy without changing the environment of parallel tests.
        for mode in ["new", "always", "no", "force"] {
            let output = std::process::Command::new(std::env::current_exe().unwrap())
                .args([
                    "--exact",
                    "simulation_tests::physical_properties_snapshot_preserves_insta_workflow",
                    "--nocapture",
                ])
                .env(CHILD_MODE, mode)
                .env("INSTA_UPDATE", if mode == "force" { "always" } else { mode })
                .env("ZOO_SIM_UPDATE", if mode == "force" { "always" } else { "" })
                .env("INSTA_FORCE_PASS", "0")
                .env_remove("INSTA_SNAPSHOT_REFERENCES_FILE")
                .output()
                .unwrap();
            assert!(
                output.status.success(),
                "{mode}:\n{}\n{}",
                String::from_utf8_lossy(&output.stdout),
                String::from_utf8_lossy(&output.stderr)
            );
        }
        return;
    };

    for (stored, value, within_tolerance) in [
        (None, 2.0, false),
        (Some(1.0), 2.0, false),
        (Some(1.0), 1.0 + 5e-13, true),
    ] {
        let directory = tempfile::tempdir().unwrap();
        let mut test = Test::new("physical_properties_snapshot_workflow");
        test.output_dir = directory.path().to_owned();
        let snapshot_path = test.output_dir.join("physical_properties.snap");
        let properties = |value| serde_json::json!({"surface_area": {"unit": "mm2", "value": value}});
        let original = stored.map(|value| {
            format!(
                "---\nsource: simulation_tests.rs\n---\n{}\n",
                serde_json::to_string_pretty(&properties(value)).unwrap()
            )
        });
        if let Some(original) = &original {
            std::fs::write(&snapshot_path, original).unwrap();
        }

        let actual = properties(value);
        let result = catch_unwind(|| assert_physical_properties_snapshot(&test, actual.clone()));
        let updates = matches!(mode.as_str(), "always" | "force");
        assert_eq!(result.is_ok(), within_tolerance || updates);
        assert_eq!(
            test.output_dir.join("physical_properties.snap.new").exists(),
            mode == "new" && !within_tolerance
        );
        if updates {
            let snapshot = insta::Snapshot::from_file(&snapshot_path).unwrap();
            let updated: serde_json::Value = serde_json::from_str(&snapshot.as_text().unwrap().to_string()).unwrap();
            let expected = if within_tolerance && mode != "force" {
                properties(stored.unwrap())
            } else {
                actual
            };
            assert_eq!(updated, expected);
        } else {
            assert_eq!(std::fs::read_to_string(&snapshot_path).ok(), original);
        }
    }
}

#[test]
fn physical_properties_snapshot_preserves_stored_decimal_text() {
    let directory = tempfile::tempdir().unwrap();
    let mut test = Test::new("holes_cube");
    test.output_dir = directory.path().to_owned();
    let snapshot_path = test.output_dir.join("physical_properties.snap");
    let original = include_str!("../tests/holes_cube/output/kcl-1.0/physical_properties.snap");
    std::fs::write(&snapshot_path, original).unwrap();
    let snapshot = insta::Snapshot::from_file(&snapshot_path).unwrap();
    let actual = serde_json::from_str(&snapshot.as_text().unwrap().to_string()).unwrap();

    // Parsing this snapshot and serializing its numbers again changes the last
    // digit of bounding_box.center.z despite an exact numeric comparison.
    assert_physical_properties_snapshot(&test, actual);

    assert_eq!(std::fs::read_to_string(&snapshot_path).unwrap(), original);
    assert!(!test.output_dir.join("physical_properties.snap.new").exists());
}

fn parse(test_name: &str) {
    parse_test(&Test::new(test_name));
}

fn parse_test(test: &Test) {
    let input = test.read();
    let parse_res = Result::<_, KclError>::Ok(crate::parsing::parse_str(&input, ModuleId::default()).unwrap());
    assert_snapshot(test, "Result of parsing", || {
        insta::assert_json_snapshot!("ast", parse_res, {
            ".**.start" => 0,
            ".**.end" => 0,
            ".**.commentStart" => 0,
        });
    });
    if let Ok(program) = parse_res {
        let input = input.as_bytes();
        walk(&program, |node| {
            match node {
                Node::Program(node) => assert!(node.non_code_meta.comment_start_is_accurate(input)),
                Node::PipeExpression(node) => assert!(node.non_code_meta.comment_start_is_accurate(input)),
                Node::SketchBlock(node) => assert!(node.non_code_meta.comment_start_is_accurate(input)),
                Node::Block(node) => assert!(node.non_code_meta.comment_start_is_accurate(input)),
                Node::CallExpressionKw(node) => assert!(node.non_code_meta.comment_start_is_accurate(input)),
                Node::ArrayExpression(node) => assert!(node.non_code_meta.comment_start_is_accurate(input)),
                Node::ObjectExpression(node) => assert!(node.non_code_meta.comment_start_is_accurate(input)),
                _ => {}
            }
            Ok::<_, anyhow::Error>(true)
        })
        .unwrap();
    }
}

async fn unparse(test_name: &str) {
    unparse_test(&Test::new(test_name)).await;
}

async fn unparse_test(test: &Test) {
    // Parse into an AST
    let input = test.read();
    let ast = crate::parsing::parse_str(&input, ModuleId::default()).unwrap();

    // Check recasting.
    let actual = ast.recast_top(&Default::default(), 0);
    let input_result = catch_unwind(AssertUnwindSafe(|| {
        assert_snapshot(test, "Result of unparsing", || {
            insta::assert_snapshot!("unparsed", actual);
        })
    }));

    // Check all the rest of the files in the directory.
    let kcl_files = crate::unparser::walk_dir(&test.input_dir).await.unwrap();
    // Filter out the entry point file.
    let kcl_files = kcl_files.into_iter().filter(|f| f != &test.entry_point);
    let futures = kcl_files
        .into_iter()
        .filter(|file| file.extension().is_some_and(|ext| ext == "kcl")) // We only care about kcl
        // files here.
        .map(|file| {
            let snap_path = Path::new("..").join(&test.output_dir);
            tokio::spawn(async move {
                let contents = tokio::fs::read_to_string(&file).await.unwrap();
                let program = crate::Program::parse_no_errs(&contents).unwrap();
                let recast = program.recast_with_options(&Default::default());

                catch_unwind(AssertUnwindSafe(|| {
                    let mut settings = insta::Settings::clone_current();
                    settings.set_omit_expression(true);
                    settings.set_snapshot_path(snap_path);
                    settings.set_prepend_module_to_snapshot(false);
                    settings.set_snapshot_suffix(file.file_name().unwrap().to_str().unwrap());
                    settings.set_description(format!("Result of unparsing {}", file.display()));
                    // Run `f` (the closure that was passed in) with these settings.
                    settings.bind(|| {
                        insta::assert_snapshot!("unparsed", recast);
                    })
                }))
            })
        })
        .collect::<Vec<_>>();

    // Join all futures and await their completion.
    for future in futures {
        future.await.unwrap().unwrap();
    }
    input_result.unwrap();
}

async fn execute(test_name: &str) {
    execute_test(&Test::new(test_name)).await
}

async fn execute_test(test: &Test) {
    miette::set_hook(Box::new(|_| {
        Box::new(miette::MietteHandlerOpts::new().show_related_errors_as_nested().build())
    }))
    .unwrap();
    if test.kcl_versions.is_empty() {
        execute_once(test, None).await;
        return;
    }
    for version in &test.kcl_versions {
        let mut run = test.clone();
        run.output_dir = test.output_dir.join(format!("kcl-{version}"));
        std::fs::create_dir_all(&run.output_dir).unwrap();
        execute_once(&run, Some(version.as_str())).await;
    }
}

async fn physical_properties(ctx: &ExecutorContext) -> Option<serde_json::Value> {
    // The combined command exports/tessellates before querying bounds, so empty
    // scenes still return "Nothing to export" without closing the connection.
    let response = match ctx
        .engine
        .send_modeling_cmd(
            &ctx.engine_batch,
            Uuid::new_v4(),
            crate::SourceRange::default(),
            &ModelingCmd::from(
                mcmd::PhysicalProperties::builder()
                    .material_density(MATERIAL_DENSITY_KG_PER_CUBIC_METER)
                    .material_density_unit(UnitDensity::KilogramsPerCubicMeter)
                    // Density is not included in these snapshots.
                    .material_mass(1.0)
                    .material_mass_unit(UnitMass::Grams)
                    .mass_output_unit(UnitMass::Grams)
                    .density_output_unit(UnitDensity::KilogramsPerCubicMeter)
                    .volume_output_unit(kittycad_modeling_cmds::units::UnitVolume::CubicMillimeters)
                    .center_of_mass_output_unit(UnitLength::Millimeters)
                    .surface_area_output_unit(UnitArea::SquareMillimeters)
                    .bounding_box_output_unit(UnitLength::Millimeters)
                    .build(),
            ),
        )
        .await
    {
        Ok(response) => response,
        Err(err)
            if err.message() == "Nothing to export"
                // Surface bodies have area and bounds, but no volume from
                // which the engine can calculate mass.
                || err.message() == "internal error: unknown" =>
        {
            return None;
        }
        Err(err) => panic!("simulation test should measure the model physical properties: {err}"),
    };
    let OkWebSocketResponseData::Modeling {
        modeling_response: OkModelingCmdResponse::PhysicalProperties(properties),
    } = response
    else {
        panic!("Expected a physical properties response, got {response:?}");
    };
    let mass = properties.mass;
    let bounding_box = properties.bounding_box;
    let surface_area = properties.surface_area;

    Some(serde_json::json!({
        "bounding_box": {
            "center": bounding_box.center,
            "dimensions": bounding_box.dimensions,
            "unit": UnitLength::Millimeters,
        },
        "weight": {
            "value": mass.mass,
            "unit": mass.output_unit,
            "material_density": MATERIAL_DENSITY_KG_PER_CUBIC_METER,
            "material_density_unit": UnitDensity::KilogramsPerCubicMeter,
        },
        "surface_area": {
            "value": surface_area.surface_area,
            "unit": surface_area.output_unit,
        },
    }))
}

async fn execute_once(test: &Test, kcl_version: Option<&str>) {
    crate::set_kcl_runtime_flags(crate::KclRuntimeFlags {
        enable_z0006_lint: crate::RuntimeFlag::On,
        ..Default::default()
    });
    let input = test.read();
    let mut ast = crate::Program::parse_no_errs(&input).unwrap();
    let program_to_lint = ast.clone();
    eprintln!("=========");
    eprintln!("Running test {}", test.name);
    if let Some(kcl_version) = kcl_version {
        eprintln!("\t kclVersion: {kcl_version}");
        ast = ast.change_kcl_version(Some(kcl_version.to_owned())).unwrap();
    }
    if test.input_dir != test.output_dir {
        eprintln!("\tInput dir: {}", test.input_dir.display());
        eprintln!("\tOutput dir: {}", test.output_dir.display());
    } else {
        eprintln!("\t Test dir: {}", test.output_dir.display());
    }
    eprintln!(
        "\t To accept changes to snapshots, run `just overwrite-sim-test {}`",
        test.name
    );
    eprintln!("=========");

    // Run the program.
    let exec_res = execute_with_retries(&RetryConfig::default(), || {
        crate::test_server::execute_sim_test_no_close(
            ast.clone(),
            Some(test.entry_point.clone()),
            test.expected_deprecation_warnings
                .map(|_| KCL_SAMPLE_DEPRECATION_VERSION),
            test.test_graphics_params.clone(),
        )
    })
    .await;
    match exec_res {
        Ok((exec_state, ctx, env_ref, graphics_result)) => {
            if let Some(expected_deprecation_warnings) = test.expected_deprecation_warnings {
                let deprecation_warnings = exec_state
                    .issues()
                    .iter()
                    .filter(|issue| issue.tag == Tag::Deprecated)
                    .collect::<Vec<_>>();
                assert_eq!(
                    deprecation_warnings.len(),
                    expected_deprecation_warnings,
                    "KCL sample `{}` expected {expected_deprecation_warnings} deprecation warnings, got: {deprecation_warnings:#?}",
                    test.name,
                );
            }

            // Depth survey: when KCL_DEPTH_HIGH_WATER_FILE is set, append the
            // machine executor's high-water call depth for this program, to
            // validate the runaway guard's default limit against real code.
            if let Ok(path) = std::env::var("KCL_DEPTH_HIGH_WATER_FILE") {
                use std::io::Write;
                if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(path) {
                    let _ = writeln!(f, "{}\t{}", exec_state.machine_depth_high_water(), test.name);
                }
            }
            let fail_path = test.output_dir.join("execution_error.snap");
            if std::fs::exists(&fail_path).unwrap() {
                panic!(
                    "This test case is expected to fail, but it passed. If this is intended, and the test should actually be passing now, please delete kcl-lib/{}",
                    fail_path.to_string_lossy()
                )
            }
            // rendering to png means the model was exported with mesh and readable brep data.
            if let Some(image) = graphics_result.image()
                && let Err(err) =
                    twenty_twenty::try_assert_image(test.output_dir.join(RENDERED_MODEL_NAME), &image, 0.99)
            {
                panic!(
                    "Image assertion failed; input KCL file: {}; error: \n{err}",
                    test.entry_point.display()
                )
            }

            let ok_snap = catch_unwind(AssertUnwindSafe(|| {
                assert_snapshot(test, "Execution success", || {
                    insta::assert_json_snapshot!("execution_success", ())
                })
            }));

            let mut lint_findings = program_to_lint
                .lint_all_with_options(crate::lint::LintOptions::default().with_z0006(true))
                .expect("failed to lint program");
            lint_findings.extend(
                exec_state
                    .modules()
                    .values()
                    .filter_map(|module| {
                        // Don't lint the stdlib.
                        if matches!(module.path, ModulePath::Std { .. }) {
                            return None;
                        }
                        // Only lint KCL files.
                        match &module.repr {
                            ModuleRepr::Root | ModuleRepr::Foreign(..) | ModuleRepr::Dummy => None,
                            ModuleRepr::Kcl(node, _exec_result) => Some(
                                node.lint_all_with_options(crate::lint::LintOptions::default().with_z0006(true))
                                    .expect("failed to lint program"),
                            ),
                        }
                    })
                    .flatten(),
            );

            // Filter out Z0005 (old sketch syntax) from test snapshots.
            lint_findings.retain(|finding| finding.finding.code != "Z0005");

            let (outcome, program_memory, module_state, responses) =
                exec_state.into_test_exec_outcome(env_ref, &ctx, &test.input_dir).await;
            let physical_properties = if test.snapshot_physical_properties {
                physical_properties(&ctx).await
            } else {
                None
            };
            ctx.close().await;

            let mut snapshot_results = common_snapshots(test, program_memory, responses);
            if let Some(physical_properties) = physical_properties {
                snapshot_results.push(catch_unwind(AssertUnwindSafe(|| {
                    assert_physical_properties_snapshot(test, physical_properties)
                })));
            } else {
                let physical_properties_snap_path = test.output_dir.join("physical_properties.snap");
                if is_writing() {
                    let _ = std::fs::remove_file(&physical_properties_snap_path);
                } else if physical_properties_snap_path.exists() {
                    panic!(
                        "This test case produced no physical model, but it previously did. If this is intended, delete kcl-lib/{}.",
                        physical_properties_snap_path.to_string_lossy()
                    );
                }
            }
            assert_artifact_snapshots(test, module_state, outcome.artifact_graph);

            let lint_snap_path = test.output_dir.join("lints.snap");
            if lint_findings.is_empty() {
                if is_writing() {
                    let _ = std::fs::remove_file(&lint_snap_path);
                } else if lint_snap_path.exists() {
                    eprintln!(
                        "This test case produced no lints, but it previously did. If this is intended, and the test should actually be lint-free now, please delete kcl-lib/{}.",
                        lint_snap_path.to_string_lossy()
                    );
                    panic!("Missing lints");
                }
            } else {
                assert_snapshot(test, "Lints", || insta::assert_json_snapshot!("lints", lint_findings));
            }

            for result in snapshot_results {
                result.unwrap();
            }
            ok_snap.unwrap();
        }
        Err(e) => {
            let ok_path = test.output_dir.join("execution_success.snap");
            let previously_passed = std::fs::exists(&ok_path).unwrap();
            match e.error {
                crate::errors::ExecError::Kcl(error) => {
                    // Snapshot the KCL error with a fancy graphical report.
                    // This looks like a Cargo compile error, with arrows pointing
                    // to source code, underlines, etc.
                    let report = error.clone().into_miette_report_with_outputs(&input).unwrap();
                    let report = miette::Report::new(report);
                    if previously_passed {
                        eprintln!(
                            "This test case failed, but it previously passed. If this is intended, and the test should actually be failing now, please delete kcl-lib/{} and other associated passing artifacts",
                            ok_path.to_string_lossy()
                        );
                        panic!("{report:?}");
                    }
                    let report = format!("{report:?}");

                    let err_result = catch_unwind(AssertUnwindSafe(|| {
                        assert_snapshot(test, "Error from executing", || {
                            insta::assert_snapshot!("execution_error", report);
                        })
                    }));

                    let responses = {
                        #[cfg(feature = "snapshot-engine-responses")]
                        {
                            e.responses
                        }
                        #[cfg(not(feature = "snapshot-engine-responses"))]
                        None
                    };
                    let program_memory = error
                        .variables
                        .into_iter()
                        .map(|(name, value)| (name, ProgramMemoryValueSnapshot::View(value)))
                        .collect();
                    let snapshot_results = common_snapshots(test, program_memory, responses);

                    {
                        let module_state = e
                            .exec_state
                            .map(|e| e.to_module_state(&test.input_dir))
                            .unwrap_or_default();
                        assert_artifact_snapshots(test, module_state, error.artifact_graph);
                    }

                    for result in snapshot_results {
                        result.unwrap();
                    }
                    err_result.unwrap();
                }
                e => {
                    // These kinds of errors aren't expected to occur. We don't
                    // snapshot them because they indicate there's something wrong
                    // with the Rust test, not with the KCL code being tested.
                    panic!("{e}")
                }
            };
        }
    }
}

/// Assert snapshots that should happen both when KCL execution succeeds and
/// when it results in an error. The caller needs to unwrap the returned results
/// to panic when there's a difference. We don't do it inside this function so
/// that other snapshots can be written to file first.
#[must_use]
fn common_snapshots(
    test: &Test,
    variables: IndexMap<String, ProgramMemoryValueSnapshot>,
    #[cfg_attr(not(feature = "snapshot-engine-responses"), expect(unused_variables))] responses: Option<
        IndexMap<Uuid, WebSocketResponse>,
    >,
) -> Vec<Result<(), Box<dyn Any + Send>>> {
    let mem_result = catch_unwind(AssertUnwindSafe(|| {
        assert_snapshot(test, "Variables in memory after executing", || {
            insta::assert_json_snapshot!("program_memory", variables, {
                 ".**.sourceRange" => Vec::new(),
            })
        })
    }));
    #[cfg(feature = "snapshot-engine-responses")]
    let responses_result_option = responses.map(|responses| {
        catch_unwind(AssertUnwindSafe(|| {
            assert_snapshot(test, "Root module engine responses", || {
                insta::assert_json_snapshot!("root_module_engine_responses", responses)
            })
        }))
    });
    let results = vec![mem_result];
    #[cfg(feature = "snapshot-engine-responses")]
    {
        if let Some(responses_result) = responses_result_option {
            let mut results = results;
            results.push(responses_result);
            return results;
        }
    }
    results
}

/// Assert snapshots for artifacts that should happen both when KCL execution
/// succeeds and when it results in an error.
fn assert_artifact_snapshots(
    test: &Test,
    module_state: IndexMap<String, ModuleArtifactState>,
    artifact_graph: ArtifactGraph,
) {
    let module_operations = module_state
        .iter()
        .map(|(path, s)| (path, &s.operations))
        // Remove empty modules, to save filespace,
        // and so that adding a new module without any operations
        // doesn't generate a massive diff.
        .filter(|(_path, s)| !s.is_empty())
        .collect::<IndexMap<_, _>>();
    let result1 = catch_unwind(AssertUnwindSafe(|| {
        assert_snapshot(test, "Operations executed", || {
            insta::assert_json_snapshot!("ops", module_operations, {
                ".**.sourceRange" => Vec::new(),
                ".**.functionSourceRange" => Vec::new(),
                ".**.moduleId" => 0,
            });
        })
    }));
    let module_commands = module_state
        .iter()
        .map(|(path, s)| (path, &s.commands))
        // Remove empty modules, to save filespace,
        // and so that adding a new module without any operations
        // doesn't generate a massive diff.
        .filter(|(_path, s)| !s.is_empty())
        .collect::<IndexMap<_, _>>();
    let result2 = catch_unwind(AssertUnwindSafe(|| {
        assert_snapshot(test, "Artifact commands", || {
            insta::assert_json_snapshot!("artifact_commands", module_commands, {
                ".**.range" => Vec::new(),
            });
        })
    }));
    let result3 = catch_unwind(AssertUnwindSafe(|| {
        // If the user is explicitly writing, we always want to run so that they
        // can save new expected output.  There's no way to reliably determine
        // if insta will write, as far as I can tell, so we use our own
        // environment variable.
        let is_writing = is_writing();
        if !test.skip_assert_artifact_graph || is_writing {
            assert_snapshot(test, "Artifact graph flowchart", || {
                let flowchart = artifact_graph
                    .to_mermaid_flowchart()
                    .unwrap_or_else(|e| format!("Failed to convert artifact graph to flowchart: {e}"));
                // Change the snapshot suffix so that it is rendered as a Markdown file
                // in GitHub.
                insta::assert_binary_snapshot!("artifact_graph_flowchart.md", flowchart.as_bytes().to_owned());
            })
        }
    }));

    result1.unwrap();
    result2.unwrap();
    result3.unwrap();
}

mod cube {
    const TEST_NAME: &str = "cube";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod cube_with_error {
    const TEST_NAME: &str = "cube_with_error";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod any_type {
    const TEST_NAME: &str = "any_type";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod coerce_from_trig_to_point {
    const TEST_NAME: &str = "coerce_from_trig_to_point";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod artifact_graph_example_code1 {
    const TEST_NAME: &str = "artifact_graph_example_code1";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod artifact_graph_example_code_no_3d {
    const TEST_NAME: &str = "artifact_graph_example_code_no_3d";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod artifact_graph_example_code_offset_planes {
    const TEST_NAME: &str = "artifact_graph_example_code_offset_planes";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod artifact_graph_sketch_on_face_etc {
    const TEST_NAME: &str = "artifact_graph_sketch_on_face_etc";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod helix_ccw {
    const TEST_NAME: &str = "helix_ccw";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod double_map_fn {
    const TEST_NAME: &str = "double_map_fn";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod blend_with_edge_specifier_objects {
    const TEST_NAME: &str = "blend_with_edge_specifier_objects";

    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod extrude_to_edge_specifier {
    const TEST_NAME: &str = "extrude_to_edge_specifier";

    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod revolve_axis_edge_ref {
    const TEST_NAME: &str = "revolve_axis_edge_ref";

    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod index_of_array {
    const TEST_NAME: &str = "index_of_array";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod comparisons {
    const TEST_NAME: &str = "comparisons";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod array_range_expr {
    const TEST_NAME: &str = "array_range_expr";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod array_range_negative_expr {
    const TEST_NAME: &str = "array_range_negative_expr";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod array_range_with_units {
    const TEST_NAME: &str = "array_range_with_units";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod array_range_mismatch_units {
    const TEST_NAME: &str = "array_range_mismatch_units";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod array_range_units_default_count {
    const TEST_NAME: &str = "array_range_units_default_count";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}

mod sketch_in_object {
    const TEST_NAME: &str = "sketch_in_object";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod if_else {
    const TEST_NAME: &str = "if_else";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod add_lots {
    const TEST_NAME: &str = "add_lots";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod add_arrays {
    const TEST_NAME: &str = "add_arrays";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod argument_error {
    //! The argument error points to the problematic argument in the call site,
    //! not the function definition that the variable points to.

    const TEST_NAME: &str = "argument_error";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod array_elem_push {
    const TEST_NAME: &str = "array_elem_push";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod array_concat_non_array {
    const TEST_NAME: &str = "array_concat_non_array";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod invalid_index_str {
    const TEST_NAME: &str = "invalid_index_str";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod invalid_index_negative {
    const TEST_NAME: &str = "invalid_index_negative";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod invalid_index_fractional {
    const TEST_NAME: &str = "invalid_index_fractional";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod property_access_not_found_on_solid {
    const TEST_NAME: &str = "property_access_not_found_on_solid";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod invalid_member_object {
    const TEST_NAME: &str = "invalid_member_object";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod invalid_member_object_prop {
    const TEST_NAME: &str = "invalid_member_object_prop";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod invalid_member_object_using_string {
    const TEST_NAME: &str = "invalid_member_object_using_string";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod non_string_key_of_object {
    const TEST_NAME: &str = "non_string_key_of_object";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod array_index_oob {
    const TEST_NAME: &str = "array_index_oob";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod object_prop_not_found {
    const TEST_NAME: &str = "object_prop_not_found";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod pipe_substitution_inside_function_called_from_pipeline {
    const TEST_NAME: &str = "pipe_substitution_inside_function_called_from_pipeline";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod comparisons_multiple {
    const TEST_NAME: &str = "comparisons_multiple";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod import_cycle1 {
    const TEST_NAME: &str = "import_cycle1";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod import_only_at_top_level {
    const TEST_NAME: &str = "import_only_at_top_level";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod import_function_not_sketch {
    const TEST_NAME: &str = "import_function_not_sketch";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod import_constant {
    const TEST_NAME: &str = "import_constant";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod import_export {
    const TEST_NAME: &str = "import_export";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod import_glob {
    const TEST_NAME: &str = "import_glob";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod import_whole_simple {
    const TEST_NAME: &str = "import_whole_simple";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod import_whole_transitive_import {
    const TEST_NAME: &str = "import_whole_transitive_import";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod import_side_effect {
    const TEST_NAME: &str = "import_side_effect";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod import_foreign {
    const TEST_NAME: &str = "import_foreign";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod export_var_only_at_top_level {
    const TEST_NAME: &str = "export_var_only_at_top_level";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod import_nested_runtime_error {
    const TEST_NAME: &str = "import_nested_runtime_error";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod assembly_non_default_units {
    const TEST_NAME: &str = "assembly_non_default_units";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}

mod array_elem_push_fail {
    const TEST_NAME: &str = "array_elem_push_fail";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod array_push_item_wrong_type {
    const TEST_NAME: &str = "array_push_item_wrong_type";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod sketch_on_face {
    const TEST_NAME: &str = "sketch_on_face";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod revolve_about_edge {
    const TEST_NAME: &str = "revolve_about_edge";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod poop_chute {
    const TEST_NAME: &str = "poop_chute";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod neg_xz_plane {
    const TEST_NAME: &str = "neg_xz_plane";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod xz_plane {
    const TEST_NAME: &str = "xz_plane";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod sketch_on_face_after_fillets_referencing_face {
    const TEST_NAME: &str = "sketch_on_face_after_fillets_referencing_face";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod circular_pattern3d_a_pattern {
    const TEST_NAME: &str = "circular_pattern3d_a_pattern";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod linear_pattern3d_a_pattern {
    const TEST_NAME: &str = "linear_pattern3d_a_pattern";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod pattern_circular_in_module {
    const TEST_NAME: &str = "pattern_circular_in_module";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod pattern_linear_in_module {
    const TEST_NAME: &str = "pattern_linear_in_module";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod tangential_arc {
    const TEST_NAME: &str = "tangential_arc";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod sketch_on_face_circle_tagged {
    const TEST_NAME: &str = "sketch_on_face_circle_tagged";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod basic_fillet_cube_start {
    const TEST_NAME: &str = "basic_fillet_cube_start";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod basic_fillet_cube_next_adjacent {
    const TEST_NAME: &str = "basic_fillet_cube_next_adjacent";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod basic_fillet_cube_previous_adjacent {
    const TEST_NAME: &str = "basic_fillet_cube_previous_adjacent";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod basic_fillet_cube_end {
    const TEST_NAME: &str = "basic_fillet_cube_end";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod basic_fillet_cube_close_opposite {
    const TEST_NAME: &str = "basic_fillet_cube_close_opposite";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod sketch_on_face_end {
    const TEST_NAME: &str = "sketch_on_face_end";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod sketch_on_face_start {
    const TEST_NAME: &str = "sketch_on_face_start";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod sketch_on_face_end_negative_extrude {
    const TEST_NAME: &str = "sketch_on_face_end_negative_extrude";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod pentagon_fillet_sugar {
    const TEST_NAME: &str = "pentagon_fillet_sugar";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod pipe_as_arg {
    const TEST_NAME: &str = "pipe_as_arg";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod computed_var {
    const TEST_NAME: &str = "computed_var";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod riddle_small {
    const TEST_NAME: &str = "riddle_small";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod tan_arc_x_line {
    const TEST_NAME: &str = "tan_arc_x_line";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod fillet_and_shell {
    const TEST_NAME: &str = "fillet-and-shell";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod sketch_on_chamfer_two_times {
    const TEST_NAME: &str = "sketch-on-chamfer-two-times";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod sketch_on_chamfer_two_times_different_order {
    const TEST_NAME: &str = "sketch-on-chamfer-two-times-different-order";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod parametric_with_tan_arc {
    const TEST_NAME: &str = "parametric_with_tan_arc";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod parametric {
    const TEST_NAME: &str = "parametric";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod ssi_pattern {
    const TEST_NAME: &str = "ssi_pattern";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod angled_line {
    const TEST_NAME: &str = "angled_line";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod function_sketch_with_position {
    const TEST_NAME: &str = "function_sketch_with_position";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod function_sketch {
    const TEST_NAME: &str = "function_sketch";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod i_shape {
    const TEST_NAME: &str = "i_shape";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod kittycad_svg {
    const TEST_NAME: &str = "kittycad_svg";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod kw_fn {
    const TEST_NAME: &str = "kw_fn";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod kw_fn_too_few_args {
    const TEST_NAME: &str = "kw_fn_too_few_args";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod kw_fn_unlabeled_but_has_label {
    const TEST_NAME: &str = "kw_fn_unlabeled_but_has_label";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod kw_fn_with_defaults {
    const TEST_NAME: &str = "kw_fn_with_defaults";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod function_expr_with_name {
    const TEST_NAME: &str = "function_expr_with_name";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod recursive_function_factorial {
    const TEST_NAME: &str = "recursive_function_factorial";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod boolean_logical_and {
    const TEST_NAME: &str = "boolean_logical_and";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod boolean_logical_or {
    const TEST_NAME: &str = "boolean_logical_or";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod boolean_logical_multiple {
    const TEST_NAME: &str = "boolean_logical_multiple";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod circle_three_point {
    const TEST_NAME: &str = "circle_three_point";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod array_elem_pop {
    const TEST_NAME: &str = "array_elem_pop";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod array_elem_pop_empty_fail {
    const TEST_NAME: &str = "array_elem_pop_empty_fail";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod array_elem_pop_fail {
    const TEST_NAME: &str = "array_elem_pop_fail";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod helix_simple {
    const TEST_NAME: &str = "helix_simple";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME);
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}

mod helix_axis_edge_ref {
    const TEST_NAME: &str = "helix_axis_edge_ref";

    /// Test parsing KCL that uses axis = { sideFaces = [...] } (edge reference object).
    #[test]
    fn parse() {
        super::parse(TEST_NAME);
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that helix with axis as edge reference object executes correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}

mod import_file_not_exist_error {
    const TEST_NAME: &str = "import_file_not_exist_error";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME);
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}

mod import_file_parse_error {
    const TEST_NAME: &str = "import_file_parse_error";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME);
    }

    #[test]
    fn unparse() {
        // Do nothing since we want to keep the parse error for the test.
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}

mod flush_batch_on_end {
    const TEST_NAME: &str = "flush_batch_on_end";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME);
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}

mod multi_transform {
    const TEST_NAME: &str = "multi_transform";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME);
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}

mod module_return_using_var {
    const TEST_NAME: &str = "module_return_using_var";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}

mod import_transform {
    const TEST_NAME: &str = "import_transform";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME);
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}

mod out_of_band_sketches {
    const TEST_NAME: &str = "out_of_band_sketches";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME);
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}

mod crazy_multi_profile {
    const TEST_NAME: &str = "crazy_multi_profile";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME);
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod assembly_mixed_units_cubes {
    const TEST_NAME: &str = "assembly_mixed_units_cubes";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod bad_units_in_annotation {
    const TEST_NAME: &str = "bad_units_in_annotation";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod translate_after_fillet {
    const TEST_NAME: &str = "translate_after_fillet";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod scale_after_fillet {
    const TEST_NAME: &str = "scale_after_fillet";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod rotate_after_fillet {
    const TEST_NAME: &str = "rotate_after_fillet";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod union_cubes {
    const TEST_NAME: &str = "union_cubes";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod subtract_cylinder_from_cube {
    const TEST_NAME: &str = "subtract_cylinder_from_cube";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod intersect_cubes {
    const TEST_NAME: &str = "intersect_cubes";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod csg_subtract_multi_target_result_reuse {
    const TEST_NAME: &str = "csg_subtract_multi_target_result_reuse";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod csg_subtract_self_empty_result {
    const TEST_NAME: &str = "csg_subtract_self_empty_result";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod pattern_into_union {
    const TEST_NAME: &str = "pattern_into_union";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod subtract_doesnt_need_brackets {
    const TEST_NAME: &str = "subtract_doesnt_need_brackets";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}

mod tangent_to_3_point_arc {
    const TEST_NAME: &str = "tangent_to_3_point_arc";
    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod import_async {
    const TEST_NAME: &str = "import_async";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod loop_tag {
    const TEST_NAME: &str = "loop_tag";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod multiple_foreign_imports_all_render {
    const TEST_NAME: &str = "multiple-foreign-imports-all-render";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod import_mesh_clone {
    const TEST_NAME: &str = "import_mesh_clone";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod clone_w_fillets {
    const TEST_NAME: &str = "clone_w_fillets";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    ///
    /// The engine's EntityClone does not yet carry fillets/chamfers over to
    /// the cloned body, even though the cut commands are sent before the
    /// clone (verified 2026-07 after KittyCAD/engine#3380: execution
    /// succeeds, but the clone renders without fillets, and its KCL-side
    /// surfaces, edge cuts, and cap ids are empty). Ignored so an engine
    /// deploy that fixes it doesn't break CI. When enabling, regenerate the
    /// snapshots, and expect the clone bookkeeping in
    /// `fix_tags_and_references` to need to carry over edge cuts and
    /// fillet/chamfer surfaces.
    #[tokio::test(flavor = "multi_thread")]
    #[ignore] // engine EntityClone does not carry fillets/chamfers to the clone yet
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod clone_w_shell {
    const TEST_NAME: &str = "clone_w_shell";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod involute_circular_units {
    const TEST_NAME: &str = "involute_circular_units";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod panic_repro_cube {
    const TEST_NAME: &str = "panic_repro_cube";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod subtract_regression00 {
    const TEST_NAME: &str = "subtract_regression00";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod subtract_regression01 {
    const TEST_NAME: &str = "subtract_regression01";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod subtract_regression02 {
    const TEST_NAME: &str = "subtract_regression02";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod subtract_regression03 {
    const TEST_NAME: &str = "subtract_regression03";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod subtract_regression04 {
    const TEST_NAME: &str = "subtract_regression04";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod subtract_regression05 {
    const TEST_NAME: &str = "subtract_regression05";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod subtract_regression06 {
    const TEST_NAME: &str = "subtract_regression06";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod fillet_duplicate_tags {
    const TEST_NAME: &str = "fillet_duplicate_tags";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod execute_engine_error_return {
    const TEST_NAME: &str = "execute_engine_error_return";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod basic_revolve_circle {
    const TEST_NAME: &str = "basic_revolve_circle";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod error_inside_fn_also_has_source_range_of_call_site_recursive {
    const TEST_NAME: &str = "error_inside_fn_also_has_source_range_of_call_site_recursive";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod revolve_on_edge_get_edge {
    const TEST_NAME: &str = "revolve_on_edge_get_edge";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod subtract_with_pattern {
    const TEST_NAME: &str = "subtract_with_pattern";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod subtract_with_pattern_cut_thru {
    const TEST_NAME: &str = "subtract_with_pattern_cut_thru";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod sketch_on_face_union {
    const TEST_NAME: &str = "sketch_on_face_union";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod multi_target_csg {
    const TEST_NAME: &str = "multi_target_csg";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod revolve_colinear {
    const TEST_NAME: &str = "revolve-colinear";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod subtract_regression07 {
    const TEST_NAME: &str = "subtract_regression07";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod subtract_regression08 {
    const TEST_NAME: &str = "subtract_regression08";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod subtract_regression09 {
    const TEST_NAME: &str = "subtract_regression09";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod subtract_regression10 {
    const TEST_NAME: &str = "subtract_regression10";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod nested_main_kcl {
    const TEST_NAME: &str = "nested_main_kcl";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod nested_windows_main_kcl {
    const TEST_NAME: &str = "nested_windows_main_kcl";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod nested_assembly {
    const TEST_NAME: &str = "nested_assembly";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod subtract_regression11 {
    const TEST_NAME: &str = "subtract_regression11";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod subtract_regression12 {
    const TEST_NAME: &str = "subtract_regression12";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod spheres {
    const TEST_NAME: &str = "spheres";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod var_ref_in_own_def {
    const TEST_NAME: &str = "var_ref_in_own_def";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod ascription_unknown_type {
    const TEST_NAME: &str = "ascription_unknown_type";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod var_ref_in_own_def_decl {
    const TEST_NAME: &str = "var_ref_in_own_def_decl";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod user_reported_union_2_bug {
    // TODO IF THIS TEST START PASSING, CLOSE THE FOLLOWING ISSUE
    // https://github.com/KittyCAD/modeling-app/issues/7310
    // and https://github.com/KittyCAD/engine/issues/3539
    const TEST_NAME: &str = "user_reported_union_2_bug";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod non_english_identifiers {
    const TEST_NAME: &str = "non_english_identifiers";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod rect {
    const TEST_NAME: &str = "rect";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod rect_helper {
    const TEST_NAME: &str = "rect_helper";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod plane_of {
    const TEST_NAME: &str = "plane_of";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod complex_expr_as_array_index {
    const TEST_NAME: &str = "complex_expr_as_array_index";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod elliptic_curve_inches_regression {
    const TEST_NAME: &str = "elliptic_curve_inches_regression";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod tag_inner_face {
    const TEST_NAME: &str = "tag_inner_face";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}

mod double_close {
    const TEST_NAME: &str = "double_close";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}

mod revolve_on_face {
    const TEST_NAME: &str = "revolve_on_face";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod subtract_self {
    const TEST_NAME: &str = "subtract_self";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod subtract_self_multiple_tools {
    const TEST_NAME: &str = "subtract_self_multiple_tools";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod union_self {
    const TEST_NAME: &str = "union_self";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod plane_of_chamfer {
    const TEST_NAME: &str = "plane_of_chamfer";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod sketch_block_basic_fixed_constraints {
    const TEST_NAME: &str = "sketch_block_basic_fixed_constraints";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod sketch_block_failed_unit_conversion {
    const TEST_NAME: &str = "sketch_block_failed_unit_conversion";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod sketch_block_unexpected_argument {
    const TEST_NAME: &str = "sketch_block_unexpected_argument";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod sketch_block_unexpected_shorthand_arg {
    const TEST_NAME: &str = "sketch_block_unexpected_shorthand_arg";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod sketch_block_vars_equal {
    const TEST_NAME: &str = "sketch_block_vars_equal";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod sketch_block_coincident_constraint {
    const TEST_NAME: &str = "sketch_block_coincident_constraint";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod sketch_block_coincident_point2d {
    const TEST_NAME: &str = "sketch_block_coincident_point2d";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod sketch_block_arc_using_center_simple {
    const TEST_NAME: &str = "sketch_block_arc_using_center_simple";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod sketch_block_arc_using_center_coincident {
    const TEST_NAME: &str = "sketch_block_arc_using_center_coincident";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod sketch_block_circle_simple {
    const TEST_NAME: &str = "sketch_block_circle_simple";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod sketch_block_modeling_command_is_error {
    const TEST_NAME: &str = "sketch_block_modeling_command_is_error";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod holes_cube {
    const TEST_NAME: &str = "holes_cube";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod multi_body_multi_tool_subtract {
    const TEST_NAME: &str = "multi_body_multi_tool_subtract";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod sketch_block_line_simple {
    const TEST_NAME: &str = "sketch_block_line_simple";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod sketch_block_points_coincident_simple {
    const TEST_NAME: &str = "sketch_block_points_coincident_simple";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod sketch_block_lines_coincident_simple {
    const TEST_NAME: &str = "sketch_block_lines_coincident_simple";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod sketch_block_on_face {
    const TEST_NAME: &str = "sketch_block_on_face";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod sketch_block_on_plane_of {
    const TEST_NAME: &str = "sketch_block_on_plane_of";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod sketch_block_on_offset_plane {
    const TEST_NAME: &str = "sketch_block_on_offset_plane";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod sketch_block_region_triangle {
    const TEST_NAME: &str = "sketch_block_region_triangle";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod sketch_block_region_from_point_in_triangle {
    const TEST_NAME: &str = "sketch_block_region_from_point_in_triangle";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod sketch_block_region_from_point2d_in_triangle {
    const TEST_NAME: &str = "sketch_block_region_from_point2d_in_triangle";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod sketch_block_on_negative_plane {
    const TEST_NAME: &str = "sketch_block_on_negative_plane";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod sketch_on_face_normal {
    const TEST_NAME: &str = "sketch_on_face_normal";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod sketch_on_face_normal_inches {
    const TEST_NAME: &str = "sketch_on_face_normal_inches";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod sketch_on_face_of_region_extrude_one_to_one {
    const TEST_NAME: &str = "sketch_on_face_of_region_extrude_one_to_one";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod sketch_on_face_of_region_extrude_one_to_many {
    const TEST_NAME: &str = "sketch_on_face_of_region_extrude_one_to_many";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod sketch_block_tags_do_not_leak_to_parent_from_region {
    const TEST_NAME: &str = "sketch_block_tags_do_not_leak_to_parent_from_region";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod sketch_block_tags_do_not_leak_to_parent_from_extrude {
    const TEST_NAME: &str = "sketch_block_tags_do_not_leak_to_parent_from_extrude";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod sketch_block_import_multiple {
    const TEST_NAME: &str = "sketch_block_import_multiple";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod sketch_block_get_common_edge_fillet {
    const TEST_NAME: &str = "sketch_block_get_common_edge_fillet";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod crab_mirror_region {
    const TEST_NAME: &str = "crab_mirror_region";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod sketch_on_face_loft_subtract {
    const TEST_NAME: &str = "sketch_on_face_loft_subtract";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod get_common_edge_of_segment_edge_tag {
    const TEST_NAME: &str = "get_common_edge_of_segment_edge_tag";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod pos_literals {
    const TEST_NAME: &str = "pos_literals";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod runtime_exit {
    const TEST_NAME: &str = "runtime_exit";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod extrude_closes {
    const TEST_NAME: &str = "extrude_closes";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod implicit_close {
    const TEST_NAME: &str = "implicit_close";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod extrude_face {
    const TEST_NAME: &str = "extrude_face";
    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}

mod sketch_block_lines_coincident_collinear {
    const TEST_NAME: &str = "sketch_block_lines_coincident_collinear";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod face_api_fillet_edge_refs_variant_1 {
    const TEST_NAME: &str = "face_api_fillet_edge_refs_variant_1";

    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod face_api_fillet_edge_refs_variant_2 {
    const TEST_NAME: &str = "face_api_fillet_edge_refs_variant_2";

    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod face_api_fillet_edge_refs_variant_3 {
    const TEST_NAME: &str = "face_api_fillet_edge_refs_variant_3";

    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod face_api_fillet_edge_refs_variant_4 {
    const TEST_NAME: &str = "face_api_fillet_edge_refs_variant_4";

    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod face_api_fillet_edge_refs_variant_5 {
    const TEST_NAME: &str = "face_api_fillet_edge_refs_variant_5";

    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod face_api_fillet_edge_refs_variant_6 {
    const TEST_NAME: &str = "face_api_fillet_edge_refs_variant_6";

    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod face_api_fillet_edge_refs_variant_7 {
    const TEST_NAME: &str = "face_api_fillet_edge_refs_variant_7";

    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod face_api_fillet_chamfer_tags_and_edge_refs {
    const TEST_NAME: &str = "face_api_fillet_chamfer_tags_and_edge_refs";

    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod sketch_on_face_index {
    const TEST_NAME: &str = "sketch_on_face_index";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod delete_face_by_index {
    const TEST_NAME: &str = "delete_face_by_index";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod delete_face_by_id {
    const TEST_NAME: &str = "delete_face_by_id";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod sketch_block_angle_constraint {
    const TEST_NAME: &str = "sketch_block_angle_constraint";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod tangent_line_arc {
    const TEST_NAME: &str = "tangent_line_arc";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod tangent_line_circle {
    const TEST_NAME: &str = "tangent_line_circle";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod tangent_line_arc_reversed_line {
    const TEST_NAME: &str = "tangent_line_arc_reversed_line";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod tangent_arc_arc {
    const TEST_NAME: &str = "tangent_arc_arc";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod tangent_line_line_error {
    const TEST_NAME: &str = "tangent_line_line_error";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod tangent_circle_circle {
    const TEST_NAME: &str = "tangent_circle_circle";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod tangent_circle_circle_native {
    const TEST_NAME: &str = "tangent_circle_circle_native";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod equal_radius_circle_circle_native {
    const TEST_NAME: &str = "equal_radius_circle_circle_native";

    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod equal_radius_arc_arc_native {
    const TEST_NAME: &str = "equal_radius_arc_arc_native";

    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod equal_radius_arc_circle_native {
    const TEST_NAME: &str = "equal_radius_arc_circle_native";

    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod tangent_arc_arc_math_only {
    const TEST_NAME: &str = "tangent_arc_arc_math_only";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod endless_impeller {
    const TEST_NAME: &str = "endless_impeller";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod consumed_solid_subtract_reuse_target {
    const TEST_NAME: &str = "consumed_solid_subtract_reuse_target";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod consumed_solid_subtract_use_result_success {
    const TEST_NAME: &str = "consumed_solid_subtract_use_result_success";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod consumed_solid_join_surfaces_reuse_input {
    const TEST_NAME: &str = "consumed_solid_join_surfaces_reuse_input";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod consumed_solid_join_surfaces_consumed_input {
    const TEST_NAME: &str = "consumed_solid_join_surfaces_consumed_input";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod consumed_solid_clone {
    const TEST_NAME: &str = "consumed_solid_clone";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod consumed_solid_appearance {
    const TEST_NAME: &str = "consumed_solid_appearance";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod consumed_solid_binary_add {
    const TEST_NAME: &str = "consumed_solid_binary_add";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod consumed_solid_binary_subtract {
    const TEST_NAME: &str = "consumed_solid_binary_subtract";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod join_surfaces_single_input_does_not_consume {
    const TEST_NAME: &str = "join_surfaces_single_input_does_not_consume";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod kcl_v2 {
    const TEST_NAME: &str = "kcl_v2";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod inconsistent_sketch {
    const TEST_NAME: &str = "inconsistent_sketch";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod inconsistent_sketch_converge {
    const TEST_NAME: &str = "inconsistent_sketch_converge";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod consumed_solid_original_issue {
    const TEST_NAME: &str = "consumed_solid_original_issue";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod zds_extrude_fillet_top_edge {
    const TEST_NAME: &str = "zds_extrude_fillet_top_edge";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod regression_test_hide_flatten_consumed {
    const TEST_NAME: &str = "regression_test_hide_flatten_consumed";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}

mod christmas_tree_mirror3d_union {
    const TEST_NAME: &str = "christmas_tree_mirror3d_union";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod delete_body {
    const TEST_NAME: &str = "delete_body";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod solid_edge_cut_using_edge_ref_csg {
    const TEST_NAME: &str = "solid_edge_cut_using_edge_ref_csg";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod extrude_split {
    const TEST_NAME: &str = "extrude_split";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod loft_arc_subtract {
    const TEST_NAME: &str = "loft_arc_subtract";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod hide_offset_plane {
    const TEST_NAME: &str = "hide_offset_plane";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod clone_a_mirror3d {
    const TEST_NAME: &str = "clone_a_mirror3d";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod surface_extrude_edge_from_solid {
    const TEST_NAME: &str = "surface_extrude_edge_from_solid";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod sketch_block_circle_constants {
    const TEST_NAME: &str = "sketch_block_circle_constants";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod surface_extrude_edge_from_surface {
    const TEST_NAME: &str = "surface_extrude_edge_from_surface";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod radius_circle_native {
    const TEST_NAME: &str = "radius_circle_native";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod surface_extrude_edge_direction {
    const TEST_NAME: &str = "surface_extrude_edge_direction";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod surface_extrude_edge_symmetric {
    const TEST_NAME: &str = "surface_extrude_edge_symmetric";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod surface_extrude_edge_bidirectional {
    const TEST_NAME: &str = "surface_extrude_edge_bidirectional";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod surface_extrude_edge_to {
    const TEST_NAME: &str = "surface_extrude_edge_to";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod surface_extrude_edge_merge_error {
    const TEST_NAME: &str = "surface_extrude_edge_merge_error";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod sweep_mirror {
    const TEST_NAME: &str = "sweep_mirror";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod beam_sweeps {
    const TEST_NAME: &str = "beam_sweeps";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod truss_bridge {
    const TEST_NAME: &str = "truss_bridge";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod fillet_ambiguous_region_edge_specifier {
    const TEST_NAME: &str = "fillet_ambiguous_region_edge_specifier";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod fillet_ambiguous_region_edge_specifier_broad {
    const TEST_NAME: &str = "fillet_ambiguous_region_edge_specifier_broad";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod chamfer_multiple_auto_hole_region_face_api {
    const TEST_NAME: &str = "chamfer_multiple_auto_hole_region_face_api";

    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod gdt_face_api_edge_specifier {
    const TEST_NAME: &str = "gdt_face_api_edge_specifier";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod error_large_fillet_radius {
    const TEST_NAME: &str = "error_large_fillet_radius";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod clone_w_face_tags {
    const TEST_NAME: &str = "clone_w_face_tags";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod surface_extrude_edge_specifier_input {
    const TEST_NAME: &str = "surface_extrude_edge_specifier_input";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod sketch_block_exit {
    const TEST_NAME: &str = "sketch_block_exit";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod surface_extrude_edge_specifier_direction {
    const TEST_NAME: &str = "surface_extrude_edge_specifier_direction";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod mirror3d_edge_specifier {
    const TEST_NAME: &str = "mirror3d_edge_specifier";

    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod mirror3d_edge_specifier_after_subtract {
    const TEST_NAME: &str = "mirror3d_edge_specifier_after_subtract";

    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod fail_user_defined_error {
    const TEST_NAME: &str = "fail_user_defined_error";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that we can unparse the KCL.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL execution fails.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod runtime_exit_in_map {
    const TEST_NAME: &str = "runtime_exit_in_map";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod runtime_exit_in_reduce {
    const TEST_NAME: &str = "runtime_exit_in_reduce";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod runtime_exit_in_pattern_transform {
    const TEST_NAME: &str = "runtime_exit_in_pattern_transform";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod runtime_exit_in_imported_module {
    const TEST_NAME: &str = "runtime_exit_in_imported_module";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod runtime_exit_in_index {
    const TEST_NAME: &str = "runtime_exit_in_index";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod scale_helix {
    const TEST_NAME: &str = "scale_helix";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod translate_helix {
    const TEST_NAME: &str = "translate_helix";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod rotate_helix {
    const TEST_NAME: &str = "rotate_helix";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod sketch_block_arc_direction_cw {
    const TEST_NAME: &str = "sketch_block_arc_direction_cw";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod clone_a_pattern {
    const TEST_NAME: &str = "clone_a_pattern";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod rolling_ball_chamfer_interacting_edges {
    const TEST_NAME: &str = "rolling_ball_chamfer_interacting_edges";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod sketch_block_arc_direction_invalid {
    const TEST_NAME: &str = "sketch_block_arc_direction_invalid";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod clone_an_import {
    const TEST_NAME: &str = "clone_an_import";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod named_views_hide_extrude_v1 {
    const TEST_NAME: &str = "named_views_hide_extrude_v1";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod named_views_hide_sweep_v1 {
    const TEST_NAME: &str = "named_views_hide_sweep_v1";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod named_views_hide_sketch_v1 {
    const TEST_NAME: &str = "named_views_hide_sketch_v1";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod named_views_hide_helix {
    const TEST_NAME: &str = "named_views_hide_helix";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod named_views_hide_imported {
    const TEST_NAME: &str = "named_views_hide_imported";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod named_views_hide_plane {
    const TEST_NAME: &str = "named_views_hide_plane";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod named_views_hide_extrude {
    const TEST_NAME: &str = "named_views_hide_extrude";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod named_views_hide_revolve {
    const TEST_NAME: &str = "named_views_hide_revolve";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod named_views_hide_sweep {
    const TEST_NAME: &str = "named_views_hide_sweep";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod named_views_hide_loft {
    const TEST_NAME: &str = "named_views_hide_loft";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod named_views_hide_sketch {
    const TEST_NAME: &str = "named_views_hide_sketch";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod named_views_hide_pattern {
    const TEST_NAME: &str = "named_views_hide_pattern";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod named_views_hide_gdt {
    const TEST_NAME: &str = "named_views_hide_gdt";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod named_views_module_explicit_import {
    const TEST_NAME: &str = "named_views_module_explicit_import";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod named_views_module_prelude {
    const TEST_NAME: &str = "named_views_module_prelude";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod named_views_module_requires_opt_in {
    const TEST_NAME: &str = "named_views_module_requires_opt_in";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod named_views_oriented {
    const TEST_NAME: &str = "named_views_oriented";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod named_views_directed {
    const TEST_NAME: &str = "named_views_directed";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod named_views_directed_zero_direction {
    const TEST_NAME: &str = "named_views_directed_zero_direction";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod named_views_units_are_millimeters {
    const TEST_NAME: &str = "named_views_units_are_millimeters";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod named_views_units_in_inch_default_file {
    const TEST_NAME: &str = "named_views_units_in_inch_default_file";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod named_views_negative_distance {
    const TEST_NAME: &str = "named_views_negative_distance";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod named_views_baseline_show {
    const TEST_NAME: &str = "named_views_baseline_show";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod named_views_baseline_hide {
    const TEST_NAME: &str = "named_views_baseline_hide";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod named_views_duplicate_name {
    const TEST_NAME: &str = "named_views_duplicate_name";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod named_views_duplicate_across_modules {
    const TEST_NAME: &str = "named_views_duplicate_across_modules";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod named_views_duplicate_from_a_function {
    const TEST_NAME: &str = "named_views_duplicate_from_a_function";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod named_views_except_a_sketch_block {
    const TEST_NAME: &str = "named_views_except_a_sketch_block";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod clone_dodecahedron {
    const TEST_NAME: &str = "clone_dodecahedron";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod mirror3d_and_boolean {
    const TEST_NAME: &str = "mirror3d_and_boolean";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod use_point_from_other_sketch {
    const TEST_NAME: &str = "use_point_from_other_sketch";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod import_nested_foreign_error {
    const TEST_NAME: &str = "import_nested_foreign_error";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod import_error_in_other_module_with_overflow {
    const TEST_NAME: &str = "import_error_in_other_module_with_overflow";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod early_return_v3 {
    const TEST_NAME: &str = "early_return_v3";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod early_return_cross_module {
    const TEST_NAME: &str = "early_return_cross_module";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod early_return_geometry {
    const TEST_NAME: &str = "early_return_geometry";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod if_else_scoped {
    const TEST_NAME: &str = "if_else_scoped";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod if_arm_scoped_geometry {
    const TEST_NAME: &str = "if_arm_scoped_geometry";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod clone_a_blend {
    const TEST_NAME: &str = "clone_a_blend";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod chamfer_multiple_tags_v3 {
    const TEST_NAME: &str = "chamfer_multiple_tags_v3";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod sketch_on_chamfer_two_times_v3 {
    const TEST_NAME: &str = "sketch_on_chamfer_two_times_v3";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod sketch_on_chamfer_two_times_different_order_v3 {
    const TEST_NAME: &str = "sketch_on_chamfer_two_times_different_order_v3";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod get_opposite_edge_after_fillet_v3 {
    const TEST_NAME: &str = "get_opposite_edge_after_fillet_v3";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod sweep_profile_defaults_v3 {
    const TEST_NAME: &str = "sweep_profile_defaults_v3";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod member_expression_order_v3 {
    const TEST_NAME: &str = "member_expression_order_v3";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod import_kcl_version_mismatch_v3 {
    const TEST_NAME: &str = "import_kcl_version_mismatch_v3";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod import_kcl_version_mismatch_undeclared_entry_point {
    const TEST_NAME: &str = "import_kcl_version_mismatch_undeclared_entry_point";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod diagnostics_attribute_v3 {
    const TEST_NAME: &str = "diagnostics_attribute_v3";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod cylinder {
    const TEST_NAME: &str = "cylinder";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod pipes_on_pipes {
    const TEST_NAME: &str = "pipes_on_pipes";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod lsystem {
    const TEST_NAME: &str = "lsystem";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod member_expression_sketch {
    const TEST_NAME: &str = "member_expression_sketch";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod helix_defaults {
    const TEST_NAME: &str = "helix_defaults";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod helix_defaults_negative_extrude {
    const TEST_NAME: &str = "helix_defaults_negative_extrude";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod helix_with_length {
    const TEST_NAME: &str = "helix_with_length";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod dimensions_match {
    const TEST_NAME: &str = "dimensions_match";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod close_arc {
    const TEST_NAME: &str = "close_arc";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod negative_args {
    const TEST_NAME: &str = "negative_args";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod tangential_arc_with_point {
    const TEST_NAME: &str = "tangential_arc_with_point";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod tangential_arc_to {
    const TEST_NAME: &str = "tangential_arc_to";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod different_planes_same_drawing {
    const TEST_NAME: &str = "different_planes_same_drawing";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod lots_of_planes {
    const TEST_NAME: &str = "lots_of_planes";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod holes {
    const TEST_NAME: &str = "holes";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod optional_params {
    const TEST_NAME: &str = "optional_params";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod rounded_with_holes {
    const TEST_NAME: &str = "rounded_with_holes";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod top_level_expression {
    const TEST_NAME: &str = "top_level_expression";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod patterns_linear_basic_with_math {
    const TEST_NAME: &str = "patterns_linear_basic_with_math";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod patterns_linear_basic {
    const TEST_NAME: &str = "patterns_linear_basic";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod patterns_linear_basic_3d {
    const TEST_NAME: &str = "patterns_linear_basic_3d";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod patterns_linear_basic_negative_distance {
    const TEST_NAME: &str = "patterns_linear_basic_negative_distance";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod patterns_linear_basic_negative_axis {
    const TEST_NAME: &str = "patterns_linear_basic_negative_axis";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod patterns_linear_basic_holes {
    const TEST_NAME: &str = "patterns_linear_basic_holes";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod patterns_circular_basic_2d {
    const TEST_NAME: &str = "patterns_circular_basic_2d";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod patterns_circular_basic_3d {
    const TEST_NAME: &str = "patterns_circular_basic_3d";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod patterns_circular_3d_tilted_axis {
    const TEST_NAME: &str = "patterns_circular_3d_tilted_axis";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod import_obj_with_mtl {
    const TEST_NAME: &str = "import_obj_with_mtl";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod import_obj_with_mtl_units {
    const TEST_NAME: &str = "import_obj_with_mtl_units";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod import_stl {
    const TEST_NAME: &str = "import_stl";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod import_gltf_with_bin {
    const TEST_NAME: &str = "import_gltf_with_bin";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod import_gltf_embedded {
    const TEST_NAME: &str = "import_gltf_embedded";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod import_glb {
    const TEST_NAME: &str = "import_glb";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod import_glb_no_assign {
    const TEST_NAME: &str = "import_glb_no_assign";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod cube_mm {
    const TEST_NAME: &str = "cube_mm";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod cube_cm {
    const TEST_NAME: &str = "cube_cm";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod cube_m {
    const TEST_NAME: &str = "cube_m";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod cube_in {
    const TEST_NAME: &str = "cube_in";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod cube_ft {
    const TEST_NAME: &str = "cube_ft";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod cube_yd {
    const TEST_NAME: &str = "cube_yd";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod error_sketch_on_arc_face {
    const TEST_NAME: &str = "error_sketch_on_arc_face";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod sketch_on_face_of_face {
    const TEST_NAME: &str = "sketch_on_face_of_face";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod stdlib_kcl_error_right_code_path {
    const TEST_NAME: &str = "stdlib_kcl_error_right_code_path";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod sketch_on_face_circle {
    const TEST_NAME: &str = "sketch_on_face_circle";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod simple_revolve {
    const TEST_NAME: &str = "simple_revolve";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod simple_revolve_uppercase {
    const TEST_NAME: &str = "simple_revolve_uppercase";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod simple_revolve_negative {
    const TEST_NAME: &str = "simple_revolve_negative";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod revolve_bad_angle_low {
    const TEST_NAME: &str = "revolve_bad_angle_low";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod revolve_bad_angle_high {
    const TEST_NAME: &str = "revolve_bad_angle_high";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod simple_revolve_custom_angle {
    const TEST_NAME: &str = "simple_revolve_custom_angle";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod simple_revolve_custom_axis {
    const TEST_NAME: &str = "simple_revolve_custom_axis";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod revolve_on_edge {
    const TEST_NAME: &str = "revolve_on_edge";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod revolve_on_face_circle_edge {
    const TEST_NAME: &str = "revolve_on_face_circle_edge";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod revolve_on_face_circle {
    const TEST_NAME: &str = "revolve_on_face_circle";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod simple_revolve_sketch_on_edge {
    const TEST_NAME: &str = "simple_revolve_sketch_on_edge";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod plumbus_fillets {
    const TEST_NAME: &str = "plumbus_fillets";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod empty_file_is_ok {
    const TEST_NAME: &str = "empty_file_is_ok";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod member_expression_in_params {
    const TEST_NAME: &str = "member_expression_in_params";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod bracket_with_fillets {
    const TEST_NAME: &str = "bracket_with_fillets";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod array_of_sketches {
    const TEST_NAME: &str = "array_of_sketches";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod pattern3d_array_of_extrudes {
    const TEST_NAME: &str = "pattern3d_array_of_extrudes";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod chamfers_referencing_other_chamfers {
    const TEST_NAME: &str = "chamfers_referencing_other_chamfers";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
// These KCL 3.0 edge-cut fixtures hoist every edge lookup above the first cut,
// since edge cuts are sent to the engine immediately.
mod fillets_referencing_other_fillets_v3 {
    const TEST_NAME: &str = "fillets_referencing_other_fillets_v3";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod chamfers_referencing_other_chamfers_v3 {
    const TEST_NAME: &str = "chamfers_referencing_other_chamfers_v3";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod shell_with_tag {
    const TEST_NAME: &str = "shell_with_tag";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod linear_pattern3d_filleted_sketch {
    const TEST_NAME: &str = "linear_pattern3d_filleted_sketch";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod circular_pattern3d_filleted_sketch {
    const TEST_NAME: &str = "circular_pattern3d_filleted_sketch";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod circular_pattern3d_chamfered_sketch {
    const TEST_NAME: &str = "circular_pattern3d_chamfered_sketch";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod tag_chamfer_with_more_than_one_edge_should_fail {
    const TEST_NAME: &str = "tag_chamfer_with_more_than_one_edge_should_fail";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod global_tags {
    const TEST_NAME: &str = "global_tags";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod extrude_inside_fn_with_tags {
    const TEST_NAME: &str = "extrude_inside_fn_with_tags";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod pattern_vase {
    const TEST_NAME: &str = "pattern_vase";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod scoped_tags {
    const TEST_NAME: &str = "scoped_tags";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod order_sketch_extrude_in_order {
    const TEST_NAME: &str = "order_sketch_extrude_in_order";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod order_sketch_extrude_out_of_order {
    const TEST_NAME: &str = "order_sketch_extrude_out_of_order";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod extrude_custom_plane {
    const TEST_NAME: &str = "extrude_custom_plane";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod arc_error_same_start_end {
    const TEST_NAME: &str = "arc_error_same_start_end";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod better_type_names {
    const TEST_NAME: &str = "better_type_names";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
mod double_delete {
    const TEST_NAME: &str = "double_delete";

    /// Test parsing KCL.
    #[test]
    fn parse() {
        super::parse(TEST_NAME)
    }

    /// Test that parsing and unparsing KCL produces the original KCL input.
    #[tokio::test(flavor = "multi_thread")]
    async fn unparse() {
        super::unparse(TEST_NAME).await
    }

    /// Test that KCL is executed correctly.
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_execute() {
        super::execute(TEST_NAME).await
    }
}
