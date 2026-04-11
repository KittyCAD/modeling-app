use std::env;
use std::fs;
use std::io::Cursor;
use std::path::{Path, PathBuf};

use anyhow::{Context, Result, bail};
use image::{DynamicImage, ImageReader, RgbaImage, imageops};
use kcl_lib::ExecError;
use kcl_lib::ExecState;
use kcl_lib::Program;
use kcl_lib::SourceRange;
use kcl_lib::test_server::new_context;
use kittycad_modeling_cmds as kcmc;
use kittycad_modeling_cmds::ImageFormat;
use kittycad_modeling_cmds::ModelingCmd;
use kittycad_modeling_cmds::each_cmd as mcmd;
use kittycad_modeling_cmds::ok_response::OkModelingCmdResponse;
use kittycad_modeling_cmds::shared::Point3d;
use kittycad_modeling_cmds::websocket::OkWebSocketResponseData;
use uuid::Uuid;

#[derive(Clone, Copy)]
enum ViewKind {
    Front,
    Right,
    Top,
    Isometric,
}

impl ViewKind {
    fn parse(raw: &str) -> Result<Self> {
        match raw {
            "front" => Ok(Self::Front),
            "right" => Ok(Self::Right),
            "top" => Ok(Self::Top),
            "isometric" => Ok(Self::Isometric),
            _ => bail!("unsupported view `{raw}`, expected front|right|top|isometric"),
        }
    }
}

#[tokio::main]
async fn main() -> Result<()> {
    let args = env::args().skip(1).collect::<Vec<_>>();
    if args.len() < 2 || args.len() > 3 {
        bail!("usage: render_multiview <input-path> <output-png> [front|right|top|isometric]");
    }

    let input_path = PathBuf::from(&args[0]);
    let output_path = PathBuf::from(&args[1]);
    let single_view = args.get(2).map(|view| ViewKind::parse(view)).transpose()?;

    let main_file = resolve_main_file(&input_path)?;
    let source = fs::read_to_string(&main_file)
        .with_context(|| format!("failed to read KCL source from {}", main_file.display()))?;

    let ctx = new_context(true, Some(main_file.clone()))
        .await
        .context("failed to create execution context")?;

    let run_result = async {
        let program = Program::parse_no_errs(&source).context("failed to parse KCL")?;
        let mut exec_state = ExecState::new(&ctx);
        ctx.run(&program, &mut exec_state)
            .await
            .map_err(|err| anyhow::anyhow!(err.to_string()))
            .context("failed to execute KCL")?;

        for issue in exec_state.issues() {
            if issue.severity.is_err() {
                bail!("execution reported an error issue: {}", issue.message);
            }
        }

        if let Some(view) = single_view {
            let image = render_view(&ctx, view).await?;
            save_png(&output_path, image)?;
        } else {
            let views = [
                render_view(&ctx, ViewKind::Front).await?,
                render_view(&ctx, ViewKind::Right).await?,
                render_view(&ctx, ViewKind::Top).await?,
                render_view(&ctx, ViewKind::Isometric).await?,
            ];
            let composite = compose_grid(views);
            save_png(&output_path, DynamicImage::ImageRgba8(composite))?;
        }

        Ok::<(), anyhow::Error>(())
    }
    .await;

    ctx.close().await;
    run_result
}

fn resolve_main_file(input_path: &Path) -> Result<PathBuf> {
    if input_path.is_dir() {
        let main_file = input_path.join("main.kcl");
        if !main_file.is_file() {
            bail!("expected {} to exist", main_file.display());
        }
        Ok(main_file)
    } else if input_path.is_file() {
        Ok(input_path.to_path_buf())
    } else {
        bail!("input path does not exist: {}", input_path.display())
    }
}

async fn render_view(ctx: &kcl_lib::ExecutorContext, view: ViewKind) -> Result<DynamicImage> {
    set_view(ctx, view).await?;
    snapshot(ctx, 0.1).await
}

async fn set_view(ctx: &kcl_lib::ExecutorContext, view: ViewKind) -> Result<()> {
    let cmd = match view {
        ViewKind::Front => ModelingCmd::from(mcmd::DefaultCameraLookAt::builder()
            .vantage(point3d(0.0, -1.0, 0.0))
            .center(point3d(0.0, 0.0, 0.0))
            .up(point3d(0.0, 0.0, 1.0))
            .build()),
        ViewKind::Right => ModelingCmd::from(mcmd::DefaultCameraLookAt::builder()
            .vantage(point3d(1.0, 0.0, 0.0))
            .center(point3d(0.0, 0.0, 0.0))
            .up(point3d(0.0, 0.0, 1.0))
            .build()),
        ViewKind::Top => ModelingCmd::from(mcmd::DefaultCameraLookAt::builder()
            .vantage(point3d(0.0, 0.0, 1.0))
            .center(point3d(0.0, 0.0, 0.0))
            .up(point3d(0.0, 1.0, 0.0))
            .build()),
        ViewKind::Isometric => ModelingCmd::from(mcmd::ViewIsometric::builder().padding(0.0).build()),
    };

    ctx.engine
        .send_modeling_cmd(Uuid::new_v4(), SourceRange::default(), &cmd)
        .await
        .map_err(|err| anyhow::anyhow!(err.to_string()))
        .context("failed to set camera view")?;

    Ok(())
}

async fn snapshot(ctx: &kcl_lib::ExecutorContext, padding: f32) -> Result<DynamicImage> {
    ctx.engine
        .send_modeling_cmd(
            Uuid::new_v4(),
            SourceRange::default(),
            &ModelingCmd::from(mcmd::DefaultCameraSetOrthographic::builder().build()),
        )
        .await
        .map_err(|err| anyhow::anyhow!(err.to_string()))
        .context("failed to switch to orthographic camera")?;

    ctx.engine
        .send_modeling_cmd(
            Uuid::new_v4(),
            SourceRange::default(),
            &ModelingCmd::from(
                mcmd::ZoomToFit::builder()
                    .padding(padding)
                    .animated(false)
                    .object_ids(Default::default())
                    .build(),
            ),
        )
        .await
        .map_err(|err| anyhow::anyhow!(err.to_string()))
        .context("failed to zoom to fit")?;

    let response = ctx
        .engine
        .send_modeling_cmd(
            Uuid::new_v4(),
            SourceRange::default(),
            &ModelingCmd::from(mcmd::TakeSnapshot::builder().format(ImageFormat::Png).build()),
        )
        .await
        .map_err(|err| anyhow::anyhow!(err.to_string()))
        .context("failed to request snapshot")?;

    let OkWebSocketResponseData::Modeling {
        modeling_response: OkModelingCmdResponse::TakeSnapshot(contents),
    } = response
    else {
        return Err(anyhow::anyhow!(
            "unexpected engine response while taking snapshot: {response:?}"
        ));
    };

    decode_png(&contents.contents.0)
}

fn decode_png(bytes: &[u8]) -> Result<DynamicImage> {
    ImageReader::new(Cursor::new(bytes))
        .with_guessed_format()
        .context("failed to guess snapshot image format")?
        .decode()
        .map_err(|err| anyhow::anyhow!(ExecError::BadPng(err.to_string())))
}

fn compose_grid(images: [DynamicImage; 4]) -> RgbaImage {
    let tiles = images.map(|image| image.to_rgba8());
    let tile_width = tiles[0].width();
    let tile_height = tiles[0].height();
    let mut canvas = RgbaImage::new(tile_width * 2, tile_height * 2);

    for (index, tile) in tiles.into_iter().enumerate() {
        let x = if index % 2 == 0 { 0 } else { tile_width };
        let y = if index < 2 { 0 } else { tile_height };
        imageops::overlay(&mut canvas, &tile, i64::from(x), i64::from(y));
    }

    canvas
}

fn save_png(path: &Path, image: DynamicImage) -> Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .with_context(|| format!("failed to create output directory {}", parent.display()))?;
    }

    image
        .save(path)
        .with_context(|| format!("failed to save PNG to {}", path.display()))
}

fn point3d(x: f32, y: f32, z: f32) -> Point3d<f32> {
    Point3d { x, y, z }
}
