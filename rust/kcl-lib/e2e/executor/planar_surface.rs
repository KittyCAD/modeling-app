use kcl_api::artifact::Artifact;
use kcl_api::artifact::SweepSubType;
use kcl_lib::ExecState;
use kcl_lib::ExecutorContext;
use kcl_lib::Program;
use kcl_lib::SourceRange;
use kittycad_modeling_cmds::each_cmd::BoundingBox;
use kittycad_modeling_cmds::ok_response::OkModelingCmdResponse;
use kittycad_modeling_cmds::websocket::OkWebSocketResponseData;
use uuid::Uuid;

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_planar_surface_preserves_a_mirrored_region() {
    let code = r#"
@settings(kclVersion = 3.0, experimentalFeatures = allow)
sketch001 = sketch(on = XY) {
  bottom = line(start = [1mm, 1mm], end = [3mm, 1mm])
  top = line(start = [3mm, 3mm], end = [1mm, 3mm])
  right = line(start = [3mm, 1mm], end = [3mm, 3mm])
  left = line(start = [1mm, 3mm], end = [1mm, 1mm])
}
selected = region(segments = [sketch001.bottom, sketch001.right])
transformed = mirror2d(selected, axis = Y)
surface001 = planarSurface(transformed)
"#;
    let program = Program::parse_no_errs(&code).unwrap();
    let ctx = ExecutorContext::new_geometry_only_with_version(program.kcl_version)
        .await
        .unwrap();
    let mut state = ExecState::new(&ctx);
    let result = ctx.run(&program, &mut state).await;
    let (environment, _) = result.unwrap();
    let outcome = state.into_exec_outcome(environment, &ctx).await.unwrap();
    let surface_id = outcome
        .artifact_graph
        .values()
        .find_map(|artifact| match artifact {
            Artifact::Sweep(surface) if surface.sub_type == SweepSubType::PlanarSurface => Some(surface.id),
            _ => None,
        })
        .expect("Missing Planar Surface");
    let response = ctx
        .engine
        .send_modeling_cmd(
            &ctx.engine_batch,
            Uuid::new_v4(),
            SourceRange::default(),
            &BoundingBox::builder()
                .entity_ids(vec![surface_id.into()])
                .build()
                .into(),
        )
        .await;
    ctx.close().await;
    let OkWebSocketResponseData::Modeling {
        modeling_response: OkModelingCmdResponse::BoundingBox(bounds),
    } = response.unwrap()
    else {
        panic!("Expected bounding box response");
    };
    for (actual, expected) in [
        (bounds.center.x, -2.0),
        (bounds.center.y, 2.0),
        (bounds.center.z, 0.0),
        (bounds.dimensions.x, 2.0),
        (bounds.dimensions.y, 2.0),
        (bounds.dimensions.z, 0.0),
    ] {
        assert!((actual - expected).abs() < 1e-8, "expected {expected}, got {actual}");
    }
}
