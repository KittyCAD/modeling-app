use std::{
    ffi::OsString,
    fs,
    path::PathBuf,
    time::{Duration, Instant},
};

use bevy_math::{Mat4, Vec3};
use image::{DynamicImage, ImageFormat, Rgb, RgbImage};

use zoo_brep::{BrepRenderData, extract_zoo_extension};

pub const HELP: &str = r#"Usage:
  kcl-render <MODEL.glb>

Options:
  -h, --help                       Print this help

The renderer reads one local Zoo GLB and writes edges.png (x-ray B-rep edges)
and faces.png (flat-colored faces with depth-aware edges) in the current
directory. Both 1024x1024 passes are rasterized directly on the CPU. It does not
initialize Bevy's renderer or use a GPU."#;

const BACKGROUND: Rgb<u8> = Rgb([255, 255, 255]);
const EDGE_COLOR: Rgb<u8> = Rgb([0, 107, 184]);
const LINE_WIDTH: f32 = 2.5;
const OUTPUT_SIZE: u32 = 1024;
const EDGE_OUTPUT: &str = "edges.png";
const FACE_OUTPUT: &str = "faces.png";

#[derive(Debug)]
struct BatchRenderOptions {
    glb: PathBuf,
}

/// Render a Zoo GLB into a 1024x1024 image with flat-colored faces and
/// depth-aware B-rep edges, without reading or writing files.
///
/// Returns an error if the GLB or its required Zoo B-rep data cannot be parsed
/// or rendered.
pub fn render(glb: &[u8]) -> Result<DynamicImage, String> {
    let edges = load_edges(glb)?;
    let view = ViewProjection::from_edges(&edges, OUTPUT_SIZE, OUTPUT_SIZE)?;
    render_image(&glb, &edges, view)
}

fn load_edges(glb: &[u8]) -> Result<BrepRenderData, String> {
    let extension =
        extract_zoo_extension(glb).map_err(|error| format!("could not read B-rep data from GLB: {error}"))?;
    BrepRenderData::from_extension(&extension.value)
        .map_err(|error| format!("could not parse B-rep data from GLB: {error}"))
}

fn render_image(glb: &[u8], edges: &BrepRenderData, view: ViewProjection) -> Result<DynamicImage, String> {
    let mut face_pass = render_faces(glb, view)?;
    draw_depth_tested_edges(&mut face_pass, edges, view);
    Ok(DynamicImage::ImageRgb8(face_pass.image))
}

pub fn run(args: Vec<OsString>) -> Result<(), String> {
    let Some(options) = parse_args(args)? else {
        println!("{HELP}");
        return Ok(());
    };
    let load_started = Instant::now();
    let glb = fs::read(&options.glb).map_err(|error| format!("could not read {}: {error}", options.glb.display()))?;
    let edges = load_edges(&glb)?;
    let load_time = load_started.elapsed();

    let render_started = Instant::now();
    let view = ViewProjection::from_edges(&edges, OUTPUT_SIZE, OUTPUT_SIZE)?;
    let edge_image = render_edges(&edges, view);
    edge_image
        .save_with_format(EDGE_OUTPUT, ImageFormat::Png)
        .map_err(|error| format!("could not save {EDGE_OUTPUT}: {error}"))?;
    render_image(&glb, &edges, view)?
        .save_with_format(FACE_OUTPUT, ImageFormat::Png)
        .map_err(|error| format!("could not save {FACE_OUTPUT}: {error}"))?;
    let render_time = render_started.elapsed();

    println!("renders saved to {EDGE_OUTPUT} and {FACE_OUTPUT}");
    print_timings(load_time, render_time);
    Ok(())
}

#[derive(Clone, Copy)]
struct ViewProjection {
    center: Vec3,
    forward: Vec3,
    right: Vec3,
    up: Vec3,
    scale: f32,
    width: u32,
    height: u32,
}

#[derive(Clone, Copy)]
struct ScreenPoint {
    x: f32,
    y: f32,
    depth: f32,
}

struct FacePass {
    image: RgbImage,
    depth: Vec<f32>,
}

impl ViewProjection {
    fn from_edges(data: &BrepRenderData, width: u32, height: u32) -> Result<Self, String> {
        let mut minimum = Vec3::splat(f32::INFINITY);
        let mut maximum = Vec3::splat(f32::NEG_INFINITY);
        let mut point_count = 0usize;
        for &point in data.edge_polylines.iter().flatten() {
            minimum = minimum.min(point);
            maximum = maximum.max(point);
            point_count += 1;
        }
        if point_count == 0 {
            return Err("Zoo export contains no B-rep edge geometry".into());
        }

        let center = (minimum + maximum) * 0.5;
        let radius = data
            .edge_polylines
            .iter()
            .flatten()
            .map(|point| point.distance(center))
            .fold(0.0_f32, f32::max)
            .max(f32::EPSILON);

        // Match the interactive three-quarter view and fit the tight model
        // sphere directly to the shorter image dimension.
        let forward = -Vec3::new(1.0, 0.8, 1.5).normalize();
        let right = forward.cross(Vec3::Y).normalize();
        let up = right.cross(forward).normalize();
        Ok(Self {
            center,
            forward,
            right,
            up,
            scale: width.min(height) as f32 / (2.0 * radius),
            width,
            height,
        })
    }

    fn project(self, point: Vec3) -> ScreenPoint {
        let relative = point - self.center;
        ScreenPoint {
            x: self.width as f32 * 0.5 + relative.dot(self.right) * self.scale,
            y: self.height as f32 * 0.5 - relative.dot(self.up) * self.scale,
            depth: relative.dot(self.forward),
        }
    }
}

fn render_edges(data: &BrepRenderData, view: ViewProjection) -> RgbImage {
    let mut image = RgbImage::from_pixel(view.width, view.height, BACKGROUND);
    draw_edges(&mut image, data, view);
    image
}

fn draw_edges(image: &mut RgbImage, data: &BrepRenderData, view: ViewProjection) {
    for polyline in &data.edge_polylines {
        for segment in polyline.windows(2) {
            let start = view.project(segment[0]);
            let end = view.project(segment[1]);
            draw_line(image, (start.x, start.y), (end.x, end.y), LINE_WIDTH);
        }
    }
}

fn draw_depth_tested_edges(pass: &mut FacePass, data: &BrepRenderData, view: ViewProjection) {
    // Permit a few pixels of depth disagreement between the analytic B-rep
    // curves and the independently tessellated face mesh they bound.
    let depth_tolerance = 3.0 / view.scale;
    for polyline in &data.edge_polylines {
        for segment in polyline.windows(2) {
            draw_depth_tested_line(
                &mut pass.image,
                &pass.depth,
                view.project(segment[0]),
                view.project(segment[1]),
                depth_tolerance,
                LINE_WIDTH,
            );
        }
    }
}

fn render_faces(bytes: &[u8], view: ViewProjection) -> Result<FacePass, String> {
    let gltf = gltf::Gltf::from_slice(bytes).map_err(|error| format!("could not parse exported GLB mesh: {error}"))?;
    let blob = gltf
        .blob
        .as_deref()
        .ok_or_else(|| "exported GLB has no binary mesh buffer".to_string())?;
    let mut image = RgbImage::from_pixel(view.width, view.height, BACKGROUND);
    let mut depth = vec![f32::INFINITY; view.width as usize * view.height as usize];
    let scene = gltf
        .default_scene()
        .or_else(|| gltf.scenes().next())
        .ok_or_else(|| "exported GLB has no scene".to_string())?;
    for node in scene.nodes() {
        rasterize_node(node, Mat4::IDENTITY, blob, view, &mut image, &mut depth)?;
    }
    Ok(FacePass { image, depth })
}

fn rasterize_node(
    node: gltf::Node<'_>,
    parent_transform: Mat4,
    blob: &[u8],
    view: ViewProjection,
    image: &mut RgbImage,
    depth: &mut [f32],
) -> Result<(), String> {
    let local_transform = Mat4::from_cols_array_2d(&node.transform().matrix());
    let world_transform = parent_transform * local_transform;
    if let Some(mesh) = node.mesh() {
        for primitive in mesh.primitives() {
            if primitive.mode() != gltf::mesh::Mode::Triangles {
                continue;
            }
            let reader = primitive.reader(|buffer| match buffer.source() {
                gltf::buffer::Source::Bin => Some(blob),
                gltf::buffer::Source::Uri(_) => None,
            });
            let positions = reader
                .read_positions()
                .ok_or_else(|| "GLB mesh primitive has no positions".to_string())?
                .map(|position| {
                    // B-rep coordinates are converted to millimetre-sized Bevy
                    // world units, so apply the same conversion to face meshes.
                    view.project(world_transform.transform_point3(Vec3::from(position)) * 1_000.0)
                })
                .collect::<Vec<_>>();
            let indices = reader
                .read_indices()
                .map(|indices| indices.into_u32().collect::<Vec<_>>())
                .unwrap_or_else(|| (0..positions.len() as u32).collect());
            let color = material_color(primitive.material());
            for triangle in indices.chunks_exact(3) {
                let Some(a) = positions.get(triangle[0] as usize).copied() else {
                    return Err("GLB mesh primitive contains an invalid index".into());
                };
                let Some(b) = positions.get(triangle[1] as usize).copied() else {
                    return Err("GLB mesh primitive contains an invalid index".into());
                };
                let Some(c) = positions.get(triangle[2] as usize).copied() else {
                    return Err("GLB mesh primitive contains an invalid index".into());
                };
                draw_triangle(image, depth, [a, b, c], color);
            }
        }
    }
    for child in node.children() {
        rasterize_node(child, world_transform, blob, view, image, depth)?;
    }
    Ok(())
}

fn material_color(material: gltf::Material<'_>) -> Rgb<u8> {
    let [red, green, blue, alpha] = material.pbr_metallic_roughness().base_color_factor();
    let composite = |channel: f32| channel * alpha + (1.0 - alpha);
    Rgb([
        linear_to_srgb_u8(composite(red)),
        linear_to_srgb_u8(composite(green)),
        linear_to_srgb_u8(composite(blue)),
    ])
}

fn linear_to_srgb_u8(linear: f32) -> u8 {
    let linear = linear.clamp(0.0, 1.0);
    let srgb = if linear <= 0.003_130_8 {
        linear * 12.92
    } else {
        1.055 * linear.powf(1.0 / 2.4) - 0.055
    };
    (srgb * 255.0).round() as u8
}

fn draw_triangle(image: &mut RgbImage, depth_buffer: &mut [f32], points: [ScreenPoint; 3], color: Rgb<u8>) {
    let edge = |a: ScreenPoint, b: ScreenPoint, x: f32, y: f32| (x - a.x) * (b.y - a.y) - (y - a.y) * (b.x - a.x);
    let area = edge(points[0], points[1], points[2].x, points[2].y);
    if area.abs() <= f32::EPSILON {
        return;
    }
    let max_pixel_x = image.width().saturating_sub(1) as f32;
    let max_pixel_y = image.height().saturating_sub(1) as f32;
    let min_x = points
        .iter()
        .map(|point| point.x)
        .fold(f32::INFINITY, f32::min)
        .floor()
        .clamp(0.0, max_pixel_x) as u32;
    let max_x = points
        .iter()
        .map(|point| point.x)
        .fold(f32::NEG_INFINITY, f32::max)
        .ceil()
        .clamp(0.0, max_pixel_x) as u32;
    let min_y = points
        .iter()
        .map(|point| point.y)
        .fold(f32::INFINITY, f32::min)
        .floor()
        .clamp(0.0, max_pixel_y) as u32;
    let max_y = points
        .iter()
        .map(|point| point.y)
        .fold(f32::NEG_INFINITY, f32::max)
        .ceil()
        .clamp(0.0, max_pixel_y) as u32;
    let sign = area.signum();
    let inverse_area = 1.0 / area;

    for y in min_y..=max_y {
        for x in min_x..=max_x {
            let px = x as f32 + 0.5;
            let py = y as f32 + 0.5;
            let w0 = edge(points[1], points[2], px, py);
            let w1 = edge(points[2], points[0], px, py);
            let w2 = edge(points[0], points[1], px, py);
            if w0 * sign < 0.0 || w1 * sign < 0.0 || w2 * sign < 0.0 {
                continue;
            }
            let z = (w0 * points[0].depth + w1 * points[1].depth + w2 * points[2].depth) * inverse_area;
            let offset = y as usize * image.width() as usize + x as usize;
            if z < depth_buffer[offset] {
                depth_buffer[offset] = z;
                image.put_pixel(x, y, color);
            }
        }
    }
}

fn draw_line(image: &mut RgbImage, start: (f32, f32), end: (f32, f32), line_width: f32) {
    let dx = end.0 - start.0;
    let dy = end.1 - start.1;
    let length_squared = dx * dx + dy * dy;
    let radius = line_width * 0.5;
    let min_x = (start.0.min(end.0) - radius).floor().max(0.0) as u32;
    let max_x = (start.0.max(end.0) + radius)
        .ceil()
        .min(image.width().saturating_sub(1) as f32) as u32;
    let min_y = (start.1.min(end.1) - radius).floor().max(0.0) as u32;
    let max_y = (start.1.max(end.1) + radius)
        .ceil()
        .min(image.height().saturating_sub(1) as f32) as u32;

    for y in min_y..=max_y {
        for x in min_x..=max_x {
            let px = x as f32 + 0.5;
            let py = y as f32 + 0.5;
            let t = if length_squared > f32::EPSILON {
                (((px - start.0) * dx + (py - start.1) * dy) / length_squared).clamp(0.0, 1.0)
            } else {
                0.0
            };
            let closest_x = start.0 + t * dx;
            let closest_y = start.1 + t * dy;
            let distance_squared = (px - closest_x).powi(2) + (py - closest_y).powi(2);
            if distance_squared > radius * radius {
                continue;
            }
            image.put_pixel(x, y, EDGE_COLOR);
        }
    }
}

fn draw_depth_tested_line(
    image: &mut RgbImage,
    depth_buffer: &[f32],
    start: ScreenPoint,
    end: ScreenPoint,
    depth_tolerance: f32,
    line_width: f32,
) {
    let dx = end.x - start.x;
    let dy = end.y - start.y;
    let length_squared = dx * dx + dy * dy;
    let radius = line_width * 0.5;
    let min_x = (start.x.min(end.x) - radius).floor().max(0.0) as u32;
    let max_x = (start.x.max(end.x) + radius)
        .ceil()
        .min(image.width().saturating_sub(1) as f32) as u32;
    let min_y = (start.y.min(end.y) - radius).floor().max(0.0) as u32;
    let max_y = (start.y.max(end.y) + radius)
        .ceil()
        .min(image.height().saturating_sub(1) as f32) as u32;

    for y in min_y..=max_y {
        for x in min_x..=max_x {
            let px = x as f32 + 0.5;
            let py = y as f32 + 0.5;
            let t = if length_squared > f32::EPSILON {
                (((px - start.x) * dx + (py - start.y) * dy) / length_squared).clamp(0.0, 1.0)
            } else {
                0.0
            };
            let edge_depth = start.depth + (end.depth - start.depth) * t;
            let offset = y as usize * image.width() as usize + x as usize;
            if edge_depth > depth_buffer[offset] + depth_tolerance {
                continue;
            }
            let closest_x = start.x + t * dx;
            let closest_y = start.y + t * dy;
            let distance_squared = (px - closest_x).powi(2) + (py - closest_y).powi(2);
            if distance_squared > radius * radius {
                continue;
            }
            image.put_pixel(x, y, EDGE_COLOR);
        }
    }
}

fn print_timings(load: Duration, render: Duration) {
    println!("time to execute KCL: n/a (input is already a GLB)");
    println!("time to export:      n/a (input is already a GLB)");
    println!("time to download:    n/a (input is a local file)");
    println!("time to load:        {:.3}s", load.as_secs_f64());
    println!("time to render:      {:.3}s", render.as_secs_f64());
}

fn parse_args(args: Vec<OsString>) -> Result<Option<BatchRenderOptions>, String> {
    if args.len() == 1 && (args[0] == "-h" || args[0] == "--help") {
        return Ok(None);
    }
    if args.len() != 1 {
        return Err(format!("expected exactly one GLB path\n\n{HELP}"));
    }
    let glb = PathBuf::from(&args[0]);
    if !glb.extension().is_some_and(|extension| extension == "glb") {
        return Err(format!("input must be a .glb file: {}", glb.display()));
    }
    Ok(Some(BatchRenderOptions { glb }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn renders_glb_bytes() {
        let glb = fs::read(concat!(env!("CARGO_MANIFEST_DIR"), "/../../assets/output.glb")).unwrap();
        let image = render(&glb).unwrap().into_rgb8();
        assert_eq!(image.dimensions(), (OUTPUT_SIZE, OUTPUT_SIZE));
        assert!(image.pixels().any(|pixel| *pixel != BACKGROUND));
    }

    #[test]
    fn rejects_invalid_glb_bytes() {
        assert!(render(&[] as &[u8; 0]).is_err());
        assert!(render(b"not a GLB".as_slice()).is_err());
    }

    #[test]
    fn parses_glb_argument() {
        let options = parse_args(vec!["model.glb".into()]).unwrap().unwrap();
        assert_eq!(options.glb, PathBuf::from("model.glb"));
    }

    #[test]
    fn rejects_extra_arguments() {
        assert!(parse_args(vec!["one.glb".into(), "two.glb".into()]).is_err());
        assert!(parse_args(vec!["model.kcl".into()]).is_err());
    }

    #[test]
    fn rasterizes_a_line() {
        let data = BrepRenderData {
            edge_polylines: vec![vec![Vec3::new(-1.0, 0.0, 0.0), Vec3::new(1.0, 0.0, 0.0)]],
            ..Default::default()
        };
        let view = ViewProjection::from_edges(&data, 32, 32).unwrap();
        let image = render_edges(&data, view);
        assert!(image.pixels().any(|pixel| *pixel != BACKGROUND));
        assert!(image.pixels().all(|pixel| *pixel == BACKGROUND || *pixel == EDGE_COLOR));
    }

    #[test]
    fn depth_tests_flat_faces() {
        let mut image = RgbImage::from_pixel(8, 8, BACKGROUND);
        let mut depth = vec![f32::INFINITY; 64];
        let triangle = |depth| {
            [
                ScreenPoint { x: 1.0, y: 1.0, depth },
                ScreenPoint { x: 7.0, y: 1.0, depth },
                ScreenPoint { x: 1.0, y: 7.0, depth },
            ]
        };
        let near = Rgb([1, 2, 3]);
        draw_triangle(&mut image, &mut depth, triangle(1.0), near);
        draw_triangle(&mut image, &mut depth, triangle(2.0), Rgb([4, 5, 6]));
        assert_eq!(*image.get_pixel(2, 2), near);
    }

    #[test]
    fn hides_edges_behind_the_face_depth_buffer() {
        let mut image = RgbImage::from_pixel(8, 8, BACKGROUND);
        let depth = vec![0.0; 64];
        let point = |x, depth| ScreenPoint { x, y: 4.0, depth };

        draw_depth_tested_line(&mut image, &depth, point(1.0, 1.0), point(7.0, 1.0), 0.0, LINE_WIDTH);
        assert!(image.pixels().all(|pixel| *pixel == BACKGROUND));

        draw_depth_tested_line(&mut image, &depth, point(1.0, -1.0), point(7.0, -1.0), 0.0, LINE_WIDTH);
        assert!(image.pixels().any(|pixel| *pixel != BACKGROUND));
    }
}
