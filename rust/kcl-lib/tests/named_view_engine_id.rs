use kcl_lib::named_views::Artifact;
use kcl_lib::named_views::ArtifactGraph;
use kcl_lib::named_views::ArtifactId;
use kcl_lib::named_views::engine_id_for_artifact;
use uuid::Uuid;

#[test]
fn public_translator_accepts_a_sweep_supplied_separately_from_the_graph() {
    let body_id = Uuid::from_u128(1);
    let path_id = Uuid::from_u128(2);
    let code_ref = serde_json::json!({ "range": [0, 0, 0], "nodePath": { "steps": [] } });
    let body: Artifact = serde_json::from_value(serde_json::json!({
        "type": "sweep", "id": body_id, "subType": "extrusion", "pathId": path_id,
        "surfaceIds": [], "edgeIds": [], "codeRef": code_ref,
        "trajectoryId": null, "method": "new", "consumed": false,
    }))
    .unwrap();
    let path: Artifact = serde_json::from_value(serde_json::json!({
        "type": "path", "id": path_id, "subType": "region", "planeId": Uuid::from_u128(3),
        "segIds": [], "consumed": true, "sweepId": body_id, "trajectorySweepId": null,
        "codeRef": code_ref,
    }))
    .unwrap();
    let graph = ArtifactGraph::from_parts([(ArtifactId::from(path_id), path)].into_iter().collect(), 1);

    assert!(graph.get(&ArtifactId::from(body_id)).is_none());
    assert_eq!(engine_id_for_artifact(body_id.into(), &body, &graph), Some(path_id));
}
