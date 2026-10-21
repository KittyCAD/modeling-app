//! Live rendering settings must update existing geometry without executing KCL.

use image::RgbImage;
use kcl_lib::ExecOutcome;
use kcl_lib::ExecutorContext;
use kcl_lib::KclValueView;
use kcl_lib::Program;
use kittycad_modeling_cmds::ImageFormat;
use kittycad_modeling_cmds::ModelingCmd;
use kittycad_modeling_cmds::each_cmd as mcmd;
use kittycad_modeling_cmds::ok_response::OkModelingCmdResponse;
use kittycad_modeling_cmds::shared::Color;
use kittycad_modeling_cmds::shared::EntityType;
use kittycad_modeling_cmds::shared::Point3d;
use kittycad_modeling_cmds::units::UnitLength;
use kittycad_modeling_cmds::websocket::OkWebSocketResponseData;
use uuid::Uuid;

use crate::cache_contract::BODY;
use crate::cache_contract::assert_volume;
use crate::cache_contract::execute;
use crate::cache_contract::volume;

async fn send(ctx: &ExecutorContext, command: ModelingCmd) -> OkWebSocketResponseData {
    ctx.engine
        .send_modeling_cmd(&ctx.engine_batch, Uuid::new_v4(), Default::default(), &command)
        .await
        .unwrap()
}

async fn snapshot(ctx: &ExecutorContext) -> RgbImage {
    // Unlike prepare_snapshot, this does not zoom or move the camera between
    // observations. In particular, it must leave the backface camera inside.
    let response = send(
        ctx,
        mcmd::TakeSnapshot::builder().format(ImageFormat::Png).build().into(),
    )
    .await;
    let OkWebSocketResponseData::Modeling {
        modeling_response: OkModelingCmdResponse::TakeSnapshot(snapshot),
    } = response
    else {
        panic!("expected a rendered PNG snapshot, received {response:?}");
    };
    let image = image::load_from_memory_with_format(&snapshot.contents.0, image::ImageFormat::Png)
        .unwrap()
        .to_rgb8();
    if let Some(directory) = std::env::var_os("ZDS_RENDER_SETTINGS_DIAGNOSTICS") {
        let directory = std::path::PathBuf::from(directory);
        std::fs::create_dir_all(&directory).unwrap();
        let path = directory.join(format!("frame-{}.png", Uuid::new_v4()));
        image.save(&path).unwrap();
        println!("render settings snapshot: {}", path.display());
    }
    image
}

fn body_id(outcome: &ExecOutcome) -> Uuid {
    let Some(KclValueView::Solid { value }) = outcome.variables.get("body") else {
        panic!("the fixture must produce a solid body");
    };
    value.id
}

async fn assert_original_body(ctx: &ExecutorContext, body: Uuid) {
    let response = send(
        ctx,
        mcmd::SceneGetEntityIds::builder()
            .filter(vec![EntityType::Solid3D])
            .skip(0)
            .take(1000)
            .build()
            .into(),
    )
    .await;
    let OkWebSocketResponseData::Modeling {
        modeling_response: OkModelingCmdResponse::SceneGetEntityIds(scene),
    } = response
    else {
        panic!("expected the engine's solid IDs, received {response:?}");
    };
    assert_eq!(scene.entity_ids.into_iter().flatten().collect::<Vec<_>>(), vec![body]);
    assert_volume(volume(ctx).await, 5.0);
    if std::env::var_os("ZDS_RENDER_SETTINGS_DIAGNOSTICS").is_some() {
        let bounds = send(
            ctx,
            mcmd::BoundingBox::builder()
                .entity_ids(vec![body])
                .output_unit(UnitLength::Millimeters)
                .build()
                .into(),
        )
        .await;
        println!("render settings body bounds: {bounds:?}");
    }
}

async fn camera(ctx: &ExecutorContext, vantage: Point3d, center: Point3d) {
    send(ctx, mcmd::DefaultCameraSetPerspective::builder().build().into()).await;
    send(
        ctx,
        mcmd::DefaultCameraLookAt::builder()
            .vantage(vantage)
            .center(center)
            .up(Point3d { x: 0.0, y: 0.0, z: 1.0 })
            .build()
            .into(),
    )
    .await;
    if std::env::var_os("ZDS_RENDER_SETTINGS_DIAGNOSTICS").is_some() {
        let settings = send(ctx, mcmd::DefaultCameraGetSettings::builder().build().into()).await;
        println!("render settings camera: {settings:?}");
    }
}

fn assert_backface_color(image: &RgbImage, channel: usize) {
    let (width, height) = image.dimensions();
    assert!(
        width >= 64 && height >= 64,
        "the rendering must have a usable central ROI"
    );
    let mut dominant = 0_u32;
    let mut total = 0_u32;
    for y in height / 4..height * 3 / 4 {
        for x in width / 4..width * 3 / 4 {
            let pixel = image.get_pixel(x, y);
            total += 1;
            if pixel[channel] >= 96
                && (0..3).all(|other| other == channel || u16::from(pixel[channel]) > u16::from(pixel[other]) + 48)
            {
                dominant += 1;
            }
        }
    }
    println!("backface RGB channel {channel}: {dominant}/{total} central pixels have the requested dominant color");
    assert!(
        dominant * 10 >= total * 7,
        "the requested backface color must cover the cylinder's interior, not just change PNG bytes: channel {channel}, {dominant}/{total} pixels"
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_render_settings_existing_backfaces_change_color_without_execution() {
    let project = tempfile::tempdir().unwrap();
    let main = project.path().join("main.kcl");
    tokio::fs::write(&main, BODY).await.unwrap();
    let program = Program::parse_no_errs(BODY).unwrap();
    let mut ctx =
        kcl_lib::test_server::new_context_engine_graphics(true, Some(main), program.language_version().unwrap())
            .await
            .unwrap();
    let initial = execute(&ctx, BODY).await;
    let body = body_id(&initial);
    assert_original_body(&ctx, body).await;
    camera(
        &ctx,
        Point3d { x: 0.0, y: 0.0, z: 2.5 },
        Point3d {
            x: 20.0,
            y: 0.0,
            z: 2.5,
        },
    )
    .await;

    // Pierre #10263: these commands must recolor the already-created body's
    // backfaces, without executing the program or rebuilding its geometry.
    for (channel, color) in [
        (0, Color::from_rgba(1.0, 0.0, 0.0, 1.0)),
        (1, Color::from_rgba(0.0, 1.0, 0.0, 1.0)),
        (2, Color::from_rgba(0.0, 0.0, 1.0, 1.0)),
    ] {
        send(
            &ctx,
            mcmd::SetDefaultSystemProperties::builder()
                .backface_color(color)
                .build()
                .into(),
        )
        .await;
        assert_backface_color(&snapshot(&ctx).await, channel);
        assert_original_body(&ctx, body).await;
    }

    // Only after all direct-command observations, an ordinary execution may
    // reuse the cache and must leave those same bodies and the final color live.
    ctx.settings.default_backface_color = Some("#0000ff".to_owned());
    let cached = execute(&ctx, BODY).await;
    assert_eq!(cached.engine_scene_generation, initial.engine_scene_generation);
    assert_eq!(body_id(&cached), body);
    assert_backface_color(&snapshot(&ctx).await, 2);
    assert_original_body(&ctx, body).await;
    ctx.close().await;
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_render_settings_imported_body_grid_toggles_preserve_cached_execution() {
    let project = tempfile::tempdir().unwrap();
    let main = project.path().join("main.kcl");
    let code = "@settings(kclVersion = 3.0)\nimport importedBody from 'body.kcl'\nbody = importedBody\n";
    tokio::fs::write(&main, code).await.unwrap();
    tokio::fs::write(
        project.path().join("body.kcl"),
        format!("{BODY}\nexport importedBody = body\n"),
    )
    .await
    .unwrap();
    let program = Program::parse_no_errs(code).unwrap();
    let mut ctx =
        kcl_lib::test_server::new_context_engine_graphics(true, Some(main), program.language_version().unwrap())
            .await
            .unwrap();
    let initial = execute(&ctx, code).await;
    assert!(
        initial.filenames.len() > 1,
        "the model must actually load its module from disk"
    );
    let body = body_id(&initial);
    assert_original_body(&ctx, body).await;
    assert_eq!(initial.engine_scene_generation, 1);
    let cached = execute(&ctx, code).await;
    assert_eq!(cached.engine_scene_generation, initial.engine_scene_generation);

    // Andrew #9101: settings-only executions must keep the imported model's
    // live geometry and reuse its cache for every toggle, not only the first.
    // The live-video UI test covers visibility; TakeSnapshot does not promise
    // to include the video-feed scale grid.
    for visible in [true, false, true] {
        ctx.settings.show_grid = visible;
        let cached = execute(&ctx, code).await;
        assert_eq!(
            cached.engine_scene_generation, initial.engine_scene_generation,
            "grid visibility must not reexecute imported KCL"
        );
        assert_eq!(body_id(&cached), body);
        assert_eq!(cached.variables, initial.variables);
        assert!(
            cached.filenames.len() > 1,
            "cached executions must retain the real import"
        );
        assert_original_body(&ctx, body).await;
    }
    ctx.close().await;
}
