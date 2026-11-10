use std::path::PathBuf;

use indexmap::IndexMap;
use kcl_api::UnitLength;
use uuid::Uuid;

use crate::ExecOutcome;
use crate::Program;
use crate::csg_test_fixtures::CsgFixture;
use crate::errors::KclErrorWithOutputs;
use crate::execution::KclValue;
use crate::execution::SKETCH_OBJECT_META;
use crate::execution::SKETCH_OBJECT_META_SKETCH;
use crate::execution::Solid;
use crate::named_views::Artifact;
use crate::named_views::ArtifactCameraLook;
use crate::named_views::ArtifactCameraView;
use crate::named_views::ArtifactId;
use crate::named_views::ArtifactOrientation;
use crate::named_views::ArtifactPoint3d;
use crate::named_views::ArtifactProjection;
use crate::named_views::ModuleId;
use crate::named_views::ModulePath;
use crate::named_views::NamedViewResolver;
use crate::named_views::Operation;
use crate::named_views::ResolvedView;
use crate::named_views::ViewResolutionError;
use crate::named_views::ViewTarget;
use crate::util::RetryConfig;
use crate::util::execute_with_retries;

fn assert_execution_succeeded(outcome: &ExecOutcome) {
    let errors = outcome.errors().collect::<Vec<_>>();
    assert!(
        errors.is_empty(),
        "resolver fixture must execute without errors: {errors:#?}"
    );
}

async fn execute(code: &str, current_file: Option<PathBuf>) -> ExecOutcome {
    let outcome = execute_with_retries(&RetryConfig::default(), || {
        crate::test_server::execute_with_exec_outcome(code, current_file.clone())
    })
    .await
    .unwrap_or_else(|error| panic!("resolver fixture must execute against the geometry engine: {error}"));
    assert_execution_succeeded(&outcome);
    outcome
}

async fn execute_cached(current_file: PathBuf, versions: &[String]) -> Vec<ExecOutcome> {
    let first = Program::parse_no_errs(&versions[0]).expect("cached resolver fixture must parse");
    let outcomes = execute_with_retries(&RetryConfig::default(), || async {
        let ctx = crate::test_server::new_context(
            true,
            Some(current_file.clone()),
            true,
            first
                .language_version()
                .expect("resolver fixture must specify a KCL version"),
        )
        .await
        .expect("cached resolver fixture must connect to the geometry engine");
        ctx.bust_cache().await;
        let result = async {
            let mut outcomes = Vec::new();
            for code in versions {
                let program = Program::parse_no_errs(code).expect("cached resolver fixture must parse");
                outcomes.push(ctx.run_with_caching(program).await?);
            }
            Ok::<_, KclErrorWithOutputs>(outcomes)
        }
        .await;
        ctx.close().await;
        result
    })
    .await
    .unwrap_or_else(|error| panic!("cached resolver fixture must execute: {error}"));
    for outcome in &outcomes {
        assert_execution_succeeded(outcome);
    }
    outcomes
}

fn variable<'a>(outcome: &'a ExecOutcome, name: &str) -> &'a KclValue {
    outcome
        .test_program_memory
        .get(name)
        .unwrap_or_else(|| panic!("resolver fixture must define variable {name}"))
}

fn solid<'a>(outcome: &'a ExecOutcome, name: &str) -> &'a Solid {
    variable(outcome, name)
        .as_solid()
        .unwrap_or_else(|| panic!("resolver fixture variable {name} must hold a solid"))
}

fn sketch_id(outcome: &ExecOutcome, name: &str) -> Uuid {
    variable(outcome, name)
        .as_object()
        .and_then(|object| object.get(SKETCH_OBJECT_META))
        .and_then(KclValue::as_object)
        .and_then(|metadata| metadata.get(SKETCH_OBJECT_META_SKETCH))
        .and_then(KclValue::as_sketch)
        .unwrap_or_else(|| panic!("resolver fixture variable {name} must contain sketch-block metadata"))
        .id
}

fn resolver(outcome: &ExecOutcome) -> NamedViewResolver<'_> {
    NamedViewResolver::new(&outcome.artifact_graph, &outcome.operations.map, &outcome.filenames)
        .expect("real execution must provide a module path for every named view")
}

fn module_id(outcome: &ExecOutcome, filename: &str) -> ModuleId {
    outcome
        .filenames
        .iter()
        .find_map(|(id, path)| match path {
            ModulePath::Local { value, .. } if value.file_name().is_some_and(|name| name == filename) => Some(*id),
            _ => None,
        })
        .unwrap_or_else(|| panic!("execution must register module {filename}"))
}

fn named_target(name: &str, module_id: ModuleId) -> ViewTarget {
    ViewTarget::Named {
        name: name.to_owned(),
        module_id,
    }
}

fn assert_visibility(outcome: &ExecOutcome, target: ViewTarget, decisions: &[(Uuid, bool)]) -> ResolvedView {
    let resolved = resolver(outcome)
        .resolve(&target)
        .unwrap_or_else(|error| panic!("resolver must select {target:?}: {error}"));
    assert_eq!(
        resolved.visibility(),
        &decisions.iter().copied().collect::<IndexMap<_, _>>(),
        "{target:?} must return complete decisions using runtime engine IDs (true means hidden)"
    );
    resolved
}

fn named_view_id(outcome: &ExecOutcome, variable: &str) -> ArtifactId {
    let value = outcome
        .test_program_memory
        .get(variable)
        .unwrap_or_else(|| panic!("execution must define the named-view variable {variable}"));
    let KclValue::NamedView { value } = value else {
        panic!("{variable} must hold a named-view value; received {value:?}");
    };
    value.artifact_id()
}

fn plane_id(outcome: &ExecOutcome, variable: &str) -> Uuid {
    outcome
        .test_program_memory
        .get(variable)
        .and_then(KclValue::as_plane)
        .unwrap_or_else(|| panic!("execution must define the plane variable {variable}"))
        .id
}

fn assert_resolution(outcome: &ExecOutcome) {
    let resolver = NamedViewResolver::new(&outcome.artifact_graph, &outcome.operations.map, &outcome.filenames)
        .expect("real execution must provide a module path for every named view");
    let imported_module = outcome
        .filenames
        .iter()
        .find_map(|(module_id, path)| match path {
            ModulePath::Local { value, .. } if value.to_string_lossy().ends_with("panel.kcl") => Some(*module_id),
            _ => None,
        })
        .expect("execution must register panel.kcl in the filename map");
    let views = resolver.list();
    assert_eq!(
        views.len(),
        2,
        "execution must register one view per declaration; received {views:?}"
    );
    assert_eq!(
        views
            .iter()
            .map(|view| (view.name.as_str(), view.module_id))
            .collect::<Vec<_>>(),
        vec![("Front", imported_module), ("Front", ModuleId::default())],
        "same-named views must retain their declaring modules in registration order"
    );
    for view in &views {
        assert_eq!(
            view.module_path, outcome.filenames[&view.module_id],
            "discovery must preserve the execution's path for module {}",
            view.module_id
        );
    }
    assert_eq!(
        views[1].artifact_id,
        named_view_id(outcome, "localFront"),
        "the root-module selection must identify its declared view value"
    );

    let imported_plane = plane_id(outcome, "importedPlane");
    let local_plane = plane_id(outcome, "localPlane");
    assert_ne!(
        imported_plane, local_plane,
        "the fixtures must create distinct engine planes"
    );
    for (view, orientation, decisions) in [
        (
            &views[0],
            ArtifactOrientation::Front,
            [(imported_plane, false), (local_plane, true)],
        ),
        (
            &views[1],
            ArtifactOrientation::Back,
            [(imported_plane, true), (local_plane, false)],
        ),
    ] {
        let resolved = resolver
            .resolve(&ViewTarget::Named {
                name: view.name.clone(),
                module_id: view.module_id,
            })
            .unwrap_or_else(|error| panic!("selection of {view:?} must succeed: {error}"));
        assert_eq!(
            resolved.visibility(),
            &decisions.into_iter().collect::<IndexMap<_, _>>(),
            "view in module {} must show only its own plane (false means visible)",
            view.module_id
        );
        let ResolvedView::Named { camera_intent, .. } = resolved else {
            panic!("named selection must return ResolvedView::Named; received {resolved:?}");
        };
        assert_eq!(
            camera_intent.look,
            ArtifactCameraLook::Oriented { orientation },
            "same-named views must retain the camera authored in their declaring module"
        );
    }

    let default = resolver
        .resolve(&ViewTarget::Default)
        .expect("default resolution must succeed for real execution output");
    assert!(
        matches!(default, ResolvedView::Default { .. }),
        "default selection must return ResolvedView::Default; received {default:?}"
    );
    assert_eq!(
        default.visibility(),
        &[(imported_plane, true), (local_plane, true)]
            .into_iter()
            .collect::<IndexMap<_, _>>(),
        "default visibility must include hide operations from both executed modules (true means hidden)"
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn named_import_preserves_view_identity_after_rebinding() {
    let outcome = execute(
        include_str!("../../tests/named_view_resolver_execution/input.kcl"),
        Some("tests/named_view_resolver_execution/input.kcl".into()),
    )
    .await;
    assert_resolution(&outcome);
    assert_eq!(
        named_view_id(&outcome, "importedFront"),
        named_view_id(&outcome, "panelFront"),
        "rebinding an imported view must preserve its original artifact identity"
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn whole_module_import_preserves_declaring_module_identity() {
    let outcome = execute(
        include_str!("../../tests/named_view_resolver_execution/whole_module.kcl"),
        Some("tests/named_view_resolver_execution/whole_module.kcl".into()),
    )
    .await;
    assert_resolution(&outcome);

    let imported_view = outcome
        .artifact_graph
        .values()
        .find_map(|artifact| match artifact {
            Artifact::NamedView(view) if view.declaring_module_id != ModuleId::default() => Some(view),
            _ => None,
        })
        .expect("whole-module execution must retain an imported view's declaring module");
    let (import_range, import_node_path) = outcome.operations.map[&ModuleId::default()]
        .iter()
        .find_map(|operation| match operation {
            Operation::ModuleInstance {
                module_id,
                source_range,
                node_path,
                ..
            } if *module_id == imported_view.declaring_module_id => Some((source_range, node_path)),
            _ => None,
        })
        .expect("root operations must contain the imported view's module instance");
    assert_eq!(
        import_range.module_id(),
        ModuleId::default(),
        "the import statement must belong to the root module"
    );
    assert_eq!(
        imported_view.code_ref.range, *import_range,
        "an imported view's source range must continue to refer to its root import statement"
    );
    assert_eq!(
        imported_view.code_ref.node_path, *import_node_path,
        "an imported view's node path must continue to refer to its root import statement"
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn visibility_baselines_preserve_directed_camera_intent() {
    let code = format!(
        r#"{}
hide([plate, boss])
hideExcept = view::named(
  "Hide except plate",
  camera = view::directed(
    [0, 0, -4],
    up = [0, 2, 0],
    target = [1inch, 2mm, 3mm],
    distance = 2inch,
    projection = view::Projection::Perspective,
  ),
  baseline = view::Visibility::Hide,
  except = [plate],
)
showAll = view::named(
  "Show all",
  camera = view::oriented(view::Orientation::Front),
  baseline = view::Visibility::Show,
)
hideAll = view::named(
  "Hide all",
  camera = view::oriented(view::Orientation::Front),
  baseline = view::Visibility::Hide,
)
"#,
        include_str!("../../tests/named_views_baseline_show/input.kcl")
    );
    let outcome = execute(&code, Some("tests/named_views_baseline_show/input.kcl".into())).await;
    assert_eq!(
        resolver(&outcome).list().len(),
        4,
        "execution must declare all four visibility combinations"
    );
    let plate = solid(&outcome, "plate");
    let boss = solid(&outcome, "boss");
    assert_ne!(
        plate.artifact_id,
        ArtifactId::from(plate.id),
        "the extrusion must exercise translation between distinct artifact and engine IDs"
    );
    let plate_sketch = sketch_id(&outcome, "plateSketch");
    let boss_sketch = sketch_id(&outcome, "bossSketch");
    for (name, plate_hidden, boss_hidden, sketches_hidden) in [
        ("Plate in context", false, true, false),
        ("Hide except plate", false, true, true),
        ("Show all", false, false, false),
        ("Hide all", true, true, true),
    ] {
        assert_visibility(
            &outcome,
            named_target(name, ModuleId::default()),
            &[
                (plate.id, plate_hidden),
                (boss.id, boss_hidden),
                (plate_sketch, sketches_hidden),
                (boss_sketch, sketches_hidden),
            ],
        );
    }
    assert_visibility(
        &outcome,
        ViewTarget::Default,
        &[
            (plate.id, true),
            (boss.id, true),
            (plate_sketch, false),
            (boss_sketch, false),
        ],
    );

    let directed = resolver(&outcome)
        .resolve(&named_target("Hide except plate", ModuleId::default()))
        .expect("the directed view must resolve");
    let ResolvedView::Named { camera_intent, .. } = directed else {
        panic!("the directed view must return ResolvedView::Named; received {directed:?}");
    };
    assert_eq!(
        *camera_intent,
        ArtifactCameraView {
            look: ArtifactCameraLook::Directed {
                direction: ArtifactPoint3d {
                    z: -1.0,
                    ..Default::default()
                },
                up: ArtifactPoint3d {
                    y: 1.0,
                    ..Default::default()
                },
            },
            target: Some(ArtifactPoint3d {
                x: 25.4,
                y: 2.0,
                z: 3.0,
                units: Some(UnitLength::Millimeters),
            }),
            distance: Some(50.8),
            projection: ArtifactProjection::Perspective,
        },
        "resolution must preserve normalized directions and millimeter camera lengths from actual execution"
    );
    let oriented = resolver(&outcome)
        .resolve(&named_target("Show all", ModuleId::default()))
        .expect("the minimally authored camera must resolve");
    let ResolvedView::Named { camera_intent, .. } = oriented else {
        panic!("the oriented view must return ResolvedView::Named; received {oriented:?}");
    };
    assert_eq!(
        *camera_intent,
        ArtifactCameraView {
            look: ArtifactCameraLook::Oriented {
                orientation: ArtifactOrientation::Front
            },
            target: None,
            distance: None,
            projection: ArtifactProjection::Orthographic,
        },
        "resolution must preserve omitted camera framing parameters"
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn default_without_declarations_reads_hide_arrays_across_modules() {
    let outcome = execute(
        include_str!("../../tests/named_view_resolver_execution/default.kcl"),
        Some("tests/named_view_resolver_execution/default.kcl".into()),
    )
    .await;
    assert!(
        resolver(&outcome).list().is_empty(),
        "the default-only fixture must declare no named views"
    );
    let resolved = assert_visibility(
        &outcome,
        ViewTarget::Default,
        &[
            (plane_id(&outcome, "firstPlane"), true),
            (plane_id(&outcome, "secondPlane"), true),
            (plane_id(&outcome, "hiddenPlane"), true),
            (plane_id(&outcome, "visiblePlane"), false),
        ],
    );
    assert!(
        matches!(resolved, ResolvedView::Default { .. }),
        "default-only execution must return no camera intent"
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn transitive_imports_and_helper_calls_preserve_declaring_modules() {
    let outcome = execute(
        include_str!("../../tests/named_view_resolver_execution/transitive.kcl"),
        Some("tests/named_view_resolver_execution/transitive.kcl".into()),
    )
    .await;
    let resolver = resolver(&outcome);
    let views = resolver.list();
    let panel_module = module_id(&outcome, "panel.kcl");
    let helper_module = module_id(&outcome, "helper.kcl");
    assert_eq!(
        views.len(),
        2,
        "re-exporting and rebinding must not register additional declarations"
    );
    for variable in ["panelFront", "importedFront", "reboundFront"] {
        assert_eq!(
            named_view_id(&outcome, variable),
            views[0].artifact_id,
            "{variable} must retain the original declaration's artifact identity"
        );
    }
    assert_eq!(
        views
            .iter()
            .map(|view| (view.name.as_str(), view.module_id))
            .collect::<Vec<_>>(),
        [("Front", panel_module), ("Front", helper_module)],
        "view identity must use the module containing view::named rather than an importer or caller"
    );
    assert_eq!(
        views[1].artifact_id,
        named_view_id(&outcome, "helperFront"),
        "the helper must return its registered view"
    );
    for (view, orientation) in views.iter().zip([ArtifactOrientation::Front, ArtifactOrientation::Top]) {
        assert_eq!(
            view.module_path, outcome.filenames[&view.module_id],
            "discovered paths must identify declaring modules"
        );
        let resolved = assert_visibility(
            &outcome,
            named_target(&view.name, view.module_id),
            &[(plane_id(&outcome, "panelPlane"), false)],
        );
        let ResolvedView::Named { camera_intent, .. } = resolved else {
            panic!("selection of {view:?} must return ResolvedView::Named; received {resolved:?}");
        };
        assert_eq!(
            camera_intent.look,
            ArtifactCameraLook::Oriented { orientation },
            "{view:?} must retain its declaration's camera"
        );
    }
    assert_eq!(
        resolver.resolve(&named_target("Front", module_id(&outcome, "reexport.kcl"))),
        Err(ViewResolutionError::NotFound),
        "a re-export must not become the declaring module"
    );
    assert_eq!(
        resolver.resolve(&named_target("Front", ModuleId::default())),
        Err(ViewResolutionError::NotFound),
        "calling the helper must not register its declaration in the caller's module"
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn cached_import_allows_a_same_named_root_declaration() {
    let before = include_str!("../../tests/named_view_resolver_execution/cache_import.kcl");
    let after = format!(
        r#"{before}
localPlane = offsetPlane(XY, offset = 20)
hide(localPlane)
localFront = view::named(
  "Front",
  camera = view::oriented(view::Orientation::Back),
  baseline = view::Visibility::Hide,
  except = [localPlane],
)
"#
    );
    let outcomes = execute_cached(
        "tests/named_view_resolver_execution/cache_import.kcl".into(),
        &[before.to_owned(), after],
    )
    .await;
    let initial_views = resolver(&outcomes[0]).list();
    assert_eq!(
        initial_views.len(),
        1,
        "the unchanged prefix must initially register only the imported declaration"
    );
    assert_eq!(
        initial_views[0].module_id,
        module_id(&outcomes[0], "panel.kcl"),
        "the cached imported declaration must retain its defining module"
    );
    let artifact = outcomes[0]
        .artifact_graph
        .get(&initial_views[0].artifact_id)
        .expect("the cached view's artifact must be present in the graph");
    let Artifact::NamedView(imported) = artifact else {
        panic!("the cached view must reference a NamedView artifact; received {artifact:?}");
    };
    assert_eq!(
        imported.code_ref.range.module_id(),
        ModuleId::default(),
        "the fixture must exercise a cached view whose navigation reference identifies the root import statement"
    );
    assert_resolution(&outcomes[1]);
    assert_eq!(
        resolver(&outcomes[1]).list()[0].artifact_id,
        initial_views[0].artifact_id,
        "appending a declaration must preserve the cached imported view's artifact identity"
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn cached_edits_replace_view_metadata_camera_and_visibility() {
    let base = include_str!("../../tests/named_view_resolver_execution/cache_edit.kcl");
    let version = |name, orientation, exception| {
        format!(
            r#"{base}
selected = view::named(
  "{name}",
  camera = view::oriented(view::Orientation::{orientation}),
  baseline = view::Visibility::Hide,
  except = [{exception}],
)
"#
        )
    };
    let outcomes = execute_cached(
        "tests/named_view_resolver_execution/cache_edit.kcl".into(),
        &[
            version("Front", "Front", "firstPlane"),
            version("Rear", "Back", "secondPlane"),
        ],
    )
    .await;
    for (outcome, name, orientation, first_hidden) in [
        (&outcomes[0], "Front", ArtifactOrientation::Front, false),
        (&outcomes[1], "Rear", ArtifactOrientation::Back, true),
    ] {
        let views = resolver(outcome).list();
        assert_eq!(
            views.len(),
            1,
            "cached editing must retain exactly one current declaration"
        );
        assert_eq!(
            views[0].name, name,
            "cached editing must report the current display name"
        );
        assert_eq!(
            views[0].artifact_id,
            named_view_id(outcome, "selected"),
            "discovery must identify the current runtime view"
        );
        let resolved = assert_visibility(
            outcome,
            named_target(name, ModuleId::default()),
            &[
                (plane_id(outcome, "firstPlane"), first_hidden),
                (plane_id(outcome, "secondPlane"), !first_hidden),
            ],
        );
        let ResolvedView::Named { camera_intent, .. } = resolved else {
            panic!("cached selection of {name} must return ResolvedView::Named; received {resolved:?}");
        };
        assert_eq!(
            camera_intent.look,
            ArtifactCameraLook::Oriented { orientation },
            "cached editing must return the current camera"
        );
    }
    assert_eq!(
        resolver(&outcomes[1]).resolve(&named_target("Front", ModuleId::default())),
        Err(ViewResolutionError::NotFound),
        "the previous display name must no longer resolve after editing"
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn consumed_geometry_and_support_planes_are_excluded() {
    let code = format!(
        r#"@settings(kclVersion = "3.0", defaultLengthUnit = mm)
{}
standalonePlane = offsetPlane(XY, offset = 60)
cutOnly = view::named(
  "Cut only",
  camera = view::oriented(view::Orientation::Front),
  baseline = view::Visibility::Hide,
  except = [second],
)
"#,
        include_str!("../../tests/consumed_solid_subtract_use_result_success/input.kcl")
    );
    let outcome = execute(
        &code,
        Some("tests/consumed_solid_subtract_use_result_success/input.kcl".into()),
    )
    .await;
    for name in ["target", "tool1", "tool2"] {
        let body = solid(&outcome, name);
        assert!(
            matches!(outcome.artifact_graph.get(&body.artifact_id), Some(Artifact::Sweep(body)) if body.consumed),
            "the Boolean operation must mark its {name} input as consumed"
        );
        let region = body.sketch().expect("the extrusion input must be a sketch region");
        assert!(
            matches!(outcome.artifact_graph.get(&region.artifact_id), Some(Artifact::Path(path)) if path.consumed),
            "extrusion must mark the {name} input region as consumed"
        );
        let support_plane = region.on.id();
        assert!(
            matches!(outcome.artifact_graph.get(&support_plane.into()), Some(Artifact::Plane(plane)) if !plane.path_ids.is_empty()),
            "the {name} support plane must be present in the graph and used by a sketch"
        );
    }
    for (name, consumed) in [("first", true), ("second", false)] {
        let result = solid(&outcome, name);
        let artifact = outcome.artifact_graph.get(&result.artifact_id);
        assert!(
            matches!(artifact, Some(Artifact::CompositeSolid(body)) if body.consumed == consumed),
            "Boolean result {name} must reference a composite solid with consumed = {consumed}; received {artifact:?}"
        );
    }
    assert_visibility(
        &outcome,
        named_target("Cut only", ModuleId::default()),
        &[
            (solid(&outcome, "second").id, false),
            (sketch_id(&outcome, "targetSketch"), true),
            (sketch_id(&outcome, "tool1Sketch"), true),
            (sketch_id(&outcome, "tool2Sketch"), true),
            (plane_id(&outcome, "standalonePlane"), true),
        ],
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn mirrored_body_visibility_uses_its_runtime_engine_id() {
    let code = format!(
        r#"{}
mirrorPlane = offsetPlane(YZ, offset = 0)
mirrored = mirror3d(plate, across = mirrorPlane)
mirrorOnly = view::named(
  "Mirror only",
  camera = view::oriented(view::Orientation::Front),
  baseline = view::Visibility::Hide,
  except = [mirrored],
)
"#,
        include_str!("../../tests/named_views_baseline_show/input.kcl")
    );
    let outcome = execute(&code, Some("tests/named_views_baseline_show/input.kcl".into())).await;
    let source = solid(&outcome, "plate");
    let mirrored = solid(&outcome, "mirrored");
    assert_ne!(
        source.id, mirrored.id,
        "the mirror must create an independent engine object"
    );
    assert!(
        matches!(outcome.artifact_graph.get(&mirrored.artifact_id), Some(Artifact::Sweep(body)) if body.path_id == Some(source.id.into())),
        "the fixture must exercise a mirrored sweep retaining its source's path ID"
    );
    assert_visibility(
        &outcome,
        named_target("Mirror only", ModuleId::default()),
        &[
            (source.id, true),
            (mirrored.id, false),
            (plane_id(&outcome, "mirrorPlane"), true),
            (solid(&outcome, "boss").id, true),
            (sketch_id(&outcome, "plateSketch"), true),
            (sketch_id(&outcome, "bossSketch"), true),
        ],
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn pattern_copy_visibility_uses_runtime_engine_ids() {
    let code = format!(
        r#"@settings(kclVersion = "3.0", defaultLengthUnit = mm)
{}
copyOnly = view::named(
  "Copy only",
  camera = view::oriented(view::Orientation::Front),
  baseline = view::Visibility::Hide,
  except = [rowHidden[1]],
)
"#,
        include_str!("../../tests/named_views_hide_pattern/input.kcl")
    );
    let outcome = execute(&code, Some("tests/named_views_hide_pattern/input.kcl".into())).await;
    let KclValue::HomArray { value, .. } = variable(&outcome, "rowHidden") else {
        panic!("the pattern must return an array of solid instances");
    };
    let instances = value
        .iter()
        .map(|value| value.as_solid().expect("every pattern instance must be a solid"))
        .collect::<Vec<_>>();
    assert_eq!(
        instances.len(),
        3,
        "the pattern must return its original and two copies"
    );
    assert_ne!(
        instances[0].artifact_id,
        ArtifactId::from(instances[0].id),
        "the original extrusion must exercise distinct artifact and engine IDs"
    );
    for copy in &instances[1..] {
        assert_ne!(
            copy.id, instances[0].id,
            "a pattern copy must have an independent engine ID"
        );
        assert_eq!(
            copy.artifact_id,
            ArtifactId::from(copy.id),
            "a pattern copy must record its engine ID as its artifact ID"
        );
    }
    assert_ne!(
        instances[1].id, instances[2].id,
        "pattern copies must have distinct engine IDs"
    );
    assert_visibility(
        &outcome,
        named_target("Copy only", ModuleId::default()),
        &[
            (instances[0].id, true),
            (instances[1].id, false),
            (instances[2].id, true),
            (solid(&outcome, "boxVisible").id, true),
            (sketch_id(&outcome, "rowSketch"), true),
            (sketch_id(&outcome, "anchorSketch"), true),
        ],
    );
}

async fn execute_csg_fixture(fixture: CsgFixture) -> ExecOutcome {
    execute(fixture.source(), None).await
}

fn csg_outputs(outcome: &ExecOutcome) -> Vec<&Solid> {
    match variable(outcome, "result") {
        KclValue::Solid { value } => vec![value],
        KclValue::HomArray { value, .. } => value
            .iter()
            .map(|value| value.as_solid().expect("every CSG result must be a solid"))
            .collect(),
        other => panic!("the CSG fixture must return solid bodies, received {other:?}"),
    }
}

fn assert_csg_visibility(outcome: &ExecOutcome, sketches: &[&str], retained_tool: Option<&str>) {
    let outputs = csg_outputs(outcome);
    assert!(!outputs.is_empty(), "the CSG fixture must return at least one output");
    for (target, baseline_hidden) in [
        (ViewTarget::Default, false),
        (named_target("Show except selected bodies", ModuleId::default()), false),
        (named_target("Hide except selected bodies", ModuleId::default()), true),
    ] {
        let mut decisions = outputs
            .iter()
            .enumerate()
            .map(|(index, output)| {
                let hidden = if index == 0 { !baseline_hidden } else { baseline_hidden };
                (output.id, hidden)
            })
            .collect::<Vec<_>>();
        if let Some(name) = retained_tool {
            decisions.push((solid(outcome, name).id, !baseline_hidden));
        }
        decisions.extend(sketches.iter().map(|name| (sketch_id(outcome, name), baseline_hidden)));
        assert_visibility(outcome, target, &decisions);
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn csg_subtract_reused_outputs_have_complete_visibility() {
    let outcome = execute_csg_fixture(CsgFixture::SubtractReusedOutputs).await;
    let outputs = csg_outputs(&outcome);
    assert_eq!(outputs.len(), 2, "the subtraction fixture must return two outputs");
    assert!(
        outputs.iter().any(|output| {
            ["leftBody", "rightBody"]
                .iter()
                .any(|name| output.artifact_id == ArtifactId::from(solid(&outcome, name).id))
        }),
        "the subtraction must reuse a target's engine UUID as an output artifact ID"
    );
    assert_csg_visibility(&outcome, &["leftSketch", "rightSketch", "toolSketch"], None);
}

#[tokio::test(flavor = "multi_thread")]
async fn csg_split_keep_tools_true_preserves_tool_visibility() {
    let outcome = execute_csg_fixture(CsgFixture::SplitKeepToolsTrue).await;
    assert_csg_visibility(&outcome, &["targetSketch", "cutterSketch"], Some("cutter"));
}

#[tokio::test(flavor = "multi_thread")]
async fn csg_split_keep_tools_false_excludes_tool_visibility() {
    let outcome = execute_csg_fixture(CsgFixture::SplitKeepToolsFalse).await;
    assert_csg_visibility(&outcome, &["targetSketch", "cutterSketch"], None);
}

#[tokio::test(flavor = "multi_thread")]
async fn csg_split_keep_tools_omitted_excludes_tool_visibility() {
    let outcome = execute_csg_fixture(CsgFixture::SplitKeepToolsDefault).await;
    assert_csg_visibility(&outcome, &["targetSketch", "cutterSketch"], None);
}

#[tokio::test(flavor = "multi_thread")]
async fn csg_split_keep_tools_true_preserves_composite_tool_visibility() {
    let outcome = execute_csg_fixture(CsgFixture::SplitCompositeToolKeepToolsTrue).await;
    assert_csg_visibility(&outcome, &["targetSketch", "cutterSketch"], Some("compositeCutter"));
}

#[tokio::test(flavor = "multi_thread")]
async fn csg_split_keep_tools_false_excludes_composite_tool_visibility() {
    let outcome = execute_csg_fixture(CsgFixture::SplitCompositeToolKeepToolsFalse).await;
    assert_csg_visibility(&outcome, &["targetSketch", "cutterSketch"], None);
}

#[tokio::test(flavor = "multi_thread")]
async fn csg_split_keep_tools_true_merge_preserves_tool_visibility() {
    let outcome = execute_csg_fixture(CsgFixture::SplitKeepToolsTrueMerge).await;
    assert_csg_visibility(&outcome, &["targetSketch", "cutterSketch"], Some("cutter"));
}
