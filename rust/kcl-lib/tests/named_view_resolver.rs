use indexmap::IndexMap;
use kcl_lib::named_views::Artifact;
use kcl_lib::named_views::ArtifactCameraLook;
use kcl_lib::named_views::ArtifactCameraView;
use kcl_lib::named_views::ArtifactGraph;
use kcl_lib::named_views::ArtifactId;
use kcl_lib::named_views::ArtifactPoint3d;
use kcl_lib::named_views::ArtifactProjection;
use kcl_lib::named_views::ModuleId;
use kcl_lib::named_views::ModulePath;
use kcl_lib::named_views::NamedViewInfo;
use kcl_lib::named_views::NamedViewResolver;
use kcl_lib::named_views::Operation;
use kcl_lib::named_views::ResolvedView;
use kcl_lib::named_views::ViewResolutionError;
use kcl_lib::named_views::ViewTarget;
use uuid::Uuid;

#[test]
fn public_resolver_accepts_execution_collections_and_exposes_results() {
    let plane_id = Uuid::from_u128(1);
    let view_id = Uuid::from_u128(2);
    let code_ref = serde_json::json!({ "range": [0, 0, 1], "nodePath": { "steps": [] } });
    let camera: ArtifactCameraView = serde_json::from_value(serde_json::json!({
        "look": { "type": "directed", "direction": { "x": 0, "y": 0, "z": -1, "units": null },
            "up": { "x": 0, "y": 1, "z": 0, "units": null } },
        "target": { "x": 1, "y": 2, "z": 3, "units": "mm" },
        "distance": 50, "projection": "perspective",
    }))
    .expect("camera fixture must deserialize as ArtifactCameraView");
    let plane: Artifact = serde_json::from_value(serde_json::json!({
        "type": "plane", "id": plane_id, "pathIds": [], "codeRef": code_ref,
    }))
    .expect("plane fixture must deserialize as Artifact");
    let view: Artifact = serde_json::from_value(serde_json::json!({
        "type": "namedView", "id": view_id, "name": "Detail", "declaringModuleId": 1, "camera": camera,
        "baseline": "hide", "showIds": [plane_id], "hideIds": [], "codeRef": code_ref,
    }))
    .expect("named-view fixture must deserialize as Artifact");
    assert_eq!(
        serde_json::to_value(&view).expect("named-view artifact must serialize")["declaringModuleId"],
        serde_json::json!(1),
        "TypeScript binding exclusion must preserve the declaring module in serialized artifacts"
    );
    let graph = ArtifactGraph::from_parts(
        [(ArtifactId::from(plane_id), plane), (ArtifactId::from(view_id), view)]
            .into_iter()
            .collect(),
        2,
    );
    let operation: Operation = serde_json::from_value(serde_json::json!({
        "type": "StdLibCall", "name": "hide",
        "unlabeledArg": { "value": { "type": "Plane", "artifact_id": plane_id }, "sourceRange": [0, 0, 1] },
        "labeledArgs": {}, "nodePath": { "steps": [] }, "sourceRange": [0, 0, 1],
    }))
    .expect("hide operation fixture must deserialize as Operation");
    let module_id = ModuleId::from_usize(1);
    let operations: IndexMap<ModuleId, Vec<Operation>> = [(module_id, vec![operation])].into_iter().collect();
    let module_path = ModulePath::Local {
        value: "part.kcl".into(),
        original_import_path: None,
    };
    let filenames = [(module_id, module_path.clone())].into_iter().collect();
    let resolver = NamedViewResolver::new(&graph, &operations, &filenames)
        .expect("resolver construction must succeed when every named view has a module-path entry");

    let views: Vec<NamedViewInfo> = resolver.list();
    assert_eq!(
        views,
        vec![NamedViewInfo {
            artifact_id: view_id.into(),
            name: "Detail".to_owned(),
            module_id,
            module_path,
        }],
        "listing must return the declared Detail view with its complete module metadata"
    );
    let resolved: ResolvedView = resolver
        .resolve(&ViewTarget::Named {
            name: "Detail".to_owned(),
            module_id,
        })
        .expect("resolving Detail in its declaring module must succeed");
    assert_eq!(
        resolved.visibility(),
        &[(plane_id, false)].into_iter().collect::<IndexMap<_, _>>(),
        "Detail must show the plane despite the program's hide operation (false means visible)"
    );
    let ResolvedView::Named { camera_intent, .. } = &resolved else {
        panic!("resolving Detail must return ResolvedView::Named; received {resolved:?}");
    };
    let authored: &ArtifactCameraView = camera_intent;
    assert_eq!(
        authored, &camera,
        "resolving Detail must preserve its authored camera settings"
    );
    let ArtifactCameraLook::Directed { direction, .. } = &authored.look else {
        panic!(
            "Detail's camera look must remain Directed; received {:?}",
            authored.look
        );
    };
    assert_eq!(
        direction.z, -1.0,
        "Detail's camera direction must retain its authored Z component"
    );
    let target: Option<ArtifactPoint3d> = authored.target;
    assert_eq!(
        target.expect("Detail's authored camera target must be present").x,
        1.0,
        "Detail's camera target must retain its authored X coordinate"
    );
    assert_eq!(
        authored.projection,
        ArtifactProjection::Perspective,
        "Detail's camera projection must remain Perspective"
    );

    let default = resolver
        .resolve(&ViewTarget::Default)
        .expect("resolving the default view from the program's hide operations must succeed");
    assert_eq!(
        default.visibility(),
        &[(plane_id, true)].into_iter().collect::<IndexMap<_, _>>(),
        "the default view must hide the plane according to the program's hide operation (true means hidden)"
    );
    assert!(
        matches!(default, ResolvedView::Default { .. }),
        "resolving the default view must return ResolvedView::Default; received {default:?}"
    );
    let missing: ViewResolutionError = resolver
        .resolve(&ViewTarget::Named {
            name: "missing".to_owned(),
            module_id,
        })
        .expect_err("resolving the undeclared view 'missing' must fail");
    assert_eq!(
        missing,
        ViewResolutionError::NotFound,
        "an undeclared view must return ViewResolutionError::NotFound"
    );
}
