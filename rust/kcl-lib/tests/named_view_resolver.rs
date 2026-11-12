use indexmap::IndexMap;
use kcl_lib::named_views::Artifact;
use kcl_lib::named_views::ArtifactCameraLook;
use kcl_lib::named_views::ArtifactCameraView;
use kcl_lib::named_views::ArtifactProjection;
use kcl_lib::named_views::ModuleId;
use kcl_lib::named_views::ModulePath;
use kcl_lib::named_views::NamedViewInfo;
use kcl_lib::named_views::ResolvedNamedView;
use kcl_lib::named_views::ResolvedView;
use uuid::Uuid;

#[cfg(not(target_arch = "wasm32"))]
#[tokio::test]
async fn execution_state_exposes_borrowed_view_queries() {
    let mut ctx = kcl_lib::ExecutorContext::new_with_engine(
        std::sync::Arc::new(kcl_lib::engine_connection::EngineManager::new_mock()),
        Default::default(),
    );
    ctx.configure_engine_render = false;
    let program = kcl_lib::Program::parse_no_errs("@settings(kclVersion = 3.0)").unwrap();
    let mut state = kcl_lib::ExecState::new(&ctx);
    let _ = ctx.run(&program, &mut state).await.unwrap();
    let views: &kcl_lib::named_views::ResolvedViewBatch = state.named_views().unwrap();
    assert!(views.list_named_views().is_empty());
    let selected = views.get(&kcl_lib::named_views::ViewTarget::Default).unwrap();
    assert!(std::ptr::eq(selected.visibility(), views.default_view()));
    ctx.close().await;
}

#[test]
fn public_view_selection_borrows_calculated_data() {
    let plane_id = Uuid::from_u128(1);
    let view_id = Uuid::from_u128(2);
    let module_id = ModuleId::from_usize(1);
    let camera: ArtifactCameraView = serde_json::from_value(serde_json::json!({
        "look": { "type": "directed", "direction": { "x": 0, "y": 0, "z": -1, "units": null },
            "up": { "x": 0, "y": 1, "z": 0, "units": null } },
        "target": { "x": 1, "y": 2, "z": 3, "units": "mm" },
        "distance": 50, "projection": "perspective",
    }))
    .expect("camera fixture must deserialize as ArtifactCameraView");
    let info = NamedViewInfo {
        artifact_id: view_id.into(),
        name: "Detail".to_owned(),
        module_id,
        module_path: ModulePath::Local {
            value: "part.kcl".into(),
            original_import_path: None,
        },
    };
    let named_view = ResolvedNamedView {
        info,
        visibility: [(plane_id, false)].into_iter().collect(),
        camera_intent: Box::new(camera.clone()),
    };
    let selected = ResolvedView::Named(&named_view);
    assert!(std::ptr::eq(selected.visibility(), &named_view.visibility));
    assert_eq!(named_view.camera_intent.as_ref(), &camera);
    assert!(matches!(
        named_view.camera_intent.look,
        ArtifactCameraLook::Directed { .. }
    ));
    assert_eq!(named_view.camera_intent.projection, ArtifactProjection::Perspective);
    assert_eq!(
        selected.visibility(),
        &[(plane_id, false)].into_iter().collect::<IndexMap<_, _>>()
    );
    let default_visibility = [(plane_id, true)].into_iter().collect();
    let default = ResolvedView::Default {
        visibility: &default_visibility,
    };
    assert!(std::ptr::eq(default.visibility(), &default_visibility));
}

#[test]
fn named_view_artifact_serializes_declaring_module_id() {
    let view: Artifact = serde_json::from_value(serde_json::json!({
        "type": "namedView", "id": Uuid::from_u128(2), "name": "Detail", "declaringModuleId": 1,
        "camera": {
            "look": { "type": "oriented", "orientation": "front" },
            "target": null, "distance": null, "projection": "orthographic",
        },
        "baseline": "show", "showIds": [], "hideIds": [],
        "codeRef": { "range": [0, 0, 1], "nodePath": { "steps": [] } },
    }))
    .expect("named-view artifact fixture must deserialize");
    assert_eq!(
        serde_json::to_value(view).unwrap()["declaringModuleId"],
        serde_json::json!(1),
        "TypeScript binding exclusion must preserve the declaring module in serialized artifacts"
    );
}
