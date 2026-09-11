use std::collections::HashMap;
use std::ffi::OsString;
use std::fs;
use std::path::PathBuf;
use std::time::Duration;
use std::time::Instant;

use bevy_math::Mat4;
use bevy_math::Vec3;
use image::DynamicImage;
use image::ImageFormat;
use image::Rgba;
use image::RgbaImage;
use zoo_brep::BrepRenderData;
use zoo_brep::extract_zoo_extension;

pub const HELP: &str = r#"Usage:
  kcl-render <MODEL.glb>

Options:
  -h, --help                       Print this help

The renderer reads one local Zoo GLB and writes edges.png (x-ray B-rep edges)
and faces.png (flat-colored faces with green mesh silhouettes and blue B-rep
edges) in the current directory. Both passes fit within 1024x1024, trimming
unused space to leave five percent margins. Rasterization runs directly on
the CPU without initializing Bevy's renderer or using a GPU."#;

const BACKGROUND: Rgba<u8> = Rgba([255, 255, 255, 0]);
const EDGE_COLOR: Rgba<u8> = Rgba([0, 107, 184, 255]);
const SILHOUETTE_COLOR: Rgba<u8> = Rgba([0, 180, 0, 255]);
const LINE_WIDTH: f32 = 2.5;
const FRAME_PADDING: f32 = 0.05;
const MAX_OUTPUT_SIZE: ImageSize = ImageSize { x: 1024, y: 1024 };
const EDGE_OUTPUT: &str = "edges.png";
const FACE_OUTPUT: &str = "faces.png";

#[derive(Debug)]
struct ImageSize {
    x: u32,
    y: u32,
}

#[derive(Debug)]
struct BatchRenderOptions {
    glb: PathBuf,
}

/// Render a Zoo GLB with flat-colored faces, green mesh silhouettes and blue
/// depth-aware B-rep edges, without reading or writing files. The image fits
/// within 1024x1024, trimming unused space to leave five percent margins.
///
/// Returns an error if the GLB or its required Zoo B-rep data cannot be parsed
/// or rendered.
pub fn render(glb: &[u8]) -> Result<DynamicImage, String> {
    let edges = load_edges(glb)?;
    let view = ViewProjection::from_model(glb, &edges, MAX_OUTPUT_SIZE.x, MAX_OUTPUT_SIZE.y)?;
    render_image(glb, &edges, view)
}

fn load_edges(glb: &[u8]) -> Result<BrepRenderData, String> {
    let extension =
        extract_zoo_extension(glb).map_err(|error| format!("could not read B-rep data from GLB: {error}"))?;
    BrepRenderData::from_extension(&extension.value)
        .map_err(|error| format!("could not parse B-rep data from GLB: {error}"))
}

fn render_image(glb: &[u8], edges: &BrepRenderData, view: ViewProjection) -> Result<DynamicImage, String> {
    let mut face_pass = render_faces(glb, view)?;
    draw_silhouettes(&mut face_pass, view);
    draw_depth_tested_edges(&mut face_pass, edges, view);
    Ok(DynamicImage::ImageRgba8(face_pass.image))
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
    let view = ViewProjection::from_model(&glb, &edges, MAX_OUTPUT_SIZE.x, MAX_OUTPUT_SIZE.y)?;
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
    image: RgbaImage,
    depth: Vec<f32>,
    silhouettes: Vec<[ScreenPoint; 2]>,
}

// Weld identical positions across primitive, normal and UV seams within a mesh.
// Keep separate node instances independent, even when they overlap in space.
type PositionKey = [u32; 3];

fn position_key(position: Vec3) -> PositionKey {
    position
        .to_array()
        .map(|value| if value == 0.0 { 0 } else { value.to_bits() })
}

struct MeshEdge {
    points: [ScreenPoint; 2],
    face_count: usize,
    // Bit flags: front = 1, back = 2, edge-on = 4.
    facings: u8,
}

#[derive(Default)]
struct MeshEdges {
    edges: HashMap<[PositionKey; 2], MeshEdge>,
}

impl MeshEdges {
    fn add_triangle(&mut self, positions: [Vec3; 3], points: [ScreenPoint; 3]) {
        if (positions[1] - positions[0])
            .cross(positions[2] - positions[0])
            .length_squared()
            == 0.0
        {
            return;
        }
        let area = triangle_area(points);
        let facing = if area > f32::EPSILON {
            1
        } else if area < -f32::EPSILON {
            2
        } else {
            4
        };
        for [a, b] in [[0, 1], [1, 2], [2, 0]] {
            let mut key = [position_key(positions[a]), position_key(positions[b])];
            key.sort_unstable();
            let edge = self.edges.entry(key).or_insert(MeshEdge {
                points: [points[a], points[b]],
                face_count: 0,
                facings: 0,
            });
            edge.face_count += 1;
            edge.facings |= facing;
        }
    }

    fn into_silhouettes(self) -> impl Iterator<Item = [ScreenPoint; 2]> {
        self.edges.into_values().filter_map(|edge| {
            // Include open boundaries and edges separating different facings,
            // including a face viewed exactly edge-on. Suppress interior edges.
            (edge.face_count == 1 || edge.facings.count_ones() > 1).then_some(edge.points)
        })
    }
}

fn triangle_area([a, b, c]: [ScreenPoint; 3]) -> f32 {
    (c.x - a.x) * (b.y - a.y) - (c.y - a.y) * (b.x - a.x)
}

fn draw_silhouettes(pass: &mut FacePass, view: ViewProjection) {
    for &[start, end] in &pass.silhouettes {
        draw_depth_tested_line(
            &mut pass.image,
            &pass.depth,
            start,
            end,
            3.0 / view.scale,
            LINE_WIDTH,
            SILHOUETTE_COLOR,
        );
    }
}

impl ViewProjection {
    fn from_model(bytes: &[u8], edges: &BrepRenderData, width: u32, height: u32) -> Result<Self, String> {
        let gltf =
            gltf::Gltf::from_slice(bytes).map_err(|error| format!("could not parse exported GLB mesh: {error}"))?;
        let blob = gltf
            .blob
            .as_deref()
            .ok_or_else(|| "exported GLB has no binary mesh buffer".to_string())?;
        let scene = gltf
            .default_scene()
            .or_else(|| gltf.scenes().next())
            .ok_or_else(|| "exported GLB has no scene".to_string())?;
        let mut points = Vec::new();
        for node in scene.nodes() {
            collect_mesh_positions(node, Mat4::IDENTITY, blob, &mut points)?;
        }
        Self::from_points(
            edges.edge_polylines.iter().flatten().copied().chain(points),
            width,
            height,
        )
    }

    fn from_points(points: impl IntoIterator<Item = Vec3>, width: u32, height: u32) -> Result<Self, String> {
        if width == 0 || height == 0 {
            return Err("render dimensions must be nonzero".into());
        }
        // Match the interactive three-quarter view, but fit the visible bounds.
        let forward = -Vec3::new(1.0, 0.8, 1.5).normalize();
        let right = forward.cross(Vec3::Y).normalize();
        let up = right.cross(forward).normalize();
        let mut points = points.into_iter();
        let origin = points
            .next()
            .ok_or_else(|| "model contains no renderable geometry".to_string())?;
        let mut minimum = Vec3::ZERO;
        let mut maximum = Vec3::ZERO;
        if !origin.is_finite() {
            return Err("model contains non-finite geometry".into());
        }
        for point in points {
            // Relative coordinates reduce cancellation for translated models.
            let relative = point - origin;
            let projected = Vec3::new(relative.dot(right), relative.dot(up), relative.dot(forward));
            if !projected.is_finite() {
                return Err("model contains non-finite geometry".into());
            }
            minimum = minimum.min(projected);
            maximum = maximum.max(projected);
        }
        let midpoint = minimum * 0.5 + maximum * 0.5;
        let extent = maximum - minimum;
        // Reserve five percent on each side, plus half a stroke so its outside
        // edge stays within the padded rectangle. Degenerate axes do not limit fit.
        let available_width = (width as f32 * (1.0 - 2.0 * FRAME_PADDING) - LINE_WIDTH).max(1.0);
        let available_height = (height as f32 * (1.0 - 2.0 * FRAME_PADDING) - LINE_WIDTH).max(1.0);
        let scale = (available_width / extent.x.max(f32::EPSILON)).min(available_height / extent.y.max(f32::EPSILON));
        // Keep the fitted scale, then trim each axis to the geometry plus its
        // stroke and proportional padding. Round up to avoid clipping a margin.
        let trimmed_size = |extent: f32, maximum: u32| {
            ((extent * scale + LINE_WIDTH) / (1.0 - 2.0 * FRAME_PADDING))
                .ceil()
                .clamp(1.0, maximum as f32) as u32
        };
        let width = trimmed_size(extent.x, width);
        let height = trimmed_size(extent.y, height);
        Ok(Self {
            center: origin + right * midpoint.x + up * midpoint.y + forward * midpoint.z,
            forward,
            right,
            up,
            scale,
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

// Include transformed face vertices as well as B-rep edges: curved silhouettes
// can extend beyond their analytic boundary curves in the chosen view.
fn collect_mesh_positions(
    node: gltf::Node<'_>,
    parent_transform: Mat4,
    blob: &[u8],
    points: &mut Vec<Vec3>,
) -> Result<(), String> {
    let world_transform = parent_transform * Mat4::from_cols_array_2d(&node.transform().matrix());
    if let Some(mesh) = node.mesh() {
        for primitive in mesh.primitives() {
            if primitive.mode() != gltf::mesh::Mode::Triangles || material_color(primitive.material())[3] == 0 {
                continue;
            }
            let reader = primitive.reader(|buffer| match buffer.source() {
                gltf::buffer::Source::Bin => Some(blob),
                gltf::buffer::Source::Uri(_) => None,
            });
            let positions = reader
                .read_positions()
                .ok_or_else(|| "GLB mesh primitive has no positions".to_string())?
                .collect::<Vec<_>>();
            let transform = |position| world_transform.transform_point3(Vec3::from(position)) * 1_000.0;
            if let Some(indices) = reader.read_indices() {
                for index in indices.into_u32() {
                    let position = positions
                        .get(index as usize)
                        .ok_or_else(|| "GLB mesh primitive contains an invalid index".to_string())?;
                    points.push(transform(*position));
                }
            } else {
                points.extend(positions.into_iter().map(transform));
            }
        }
    }
    for child in node.children() {
        collect_mesh_positions(child, world_transform, blob, points)?;
    }
    Ok(())
}

fn render_edges(data: &BrepRenderData, view: ViewProjection) -> RgbaImage {
    let mut image = RgbaImage::from_pixel(view.width, view.height, BACKGROUND);
    draw_edges(&mut image, data, view);
    image
}

fn draw_edges(image: &mut RgbaImage, data: &BrepRenderData, view: ViewProjection) {
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
                EDGE_COLOR,
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
    let mut pass = FacePass {
        image: RgbaImage::from_pixel(view.width, view.height, BACKGROUND),
        depth: vec![f32::INFINITY; view.width as usize * view.height as usize],
        silhouettes: Vec::new(),
    };
    let scene = gltf
        .default_scene()
        .or_else(|| gltf.scenes().next())
        .ok_or_else(|| "exported GLB has no scene".to_string())?;
    for node in scene.nodes() {
        rasterize_node(node, Mat4::IDENTITY, blob, view, &mut pass)?;
    }
    Ok(pass)
}

fn rasterize_node(
    node: gltf::Node<'_>,
    parent_transform: Mat4,
    blob: &[u8],
    view: ViewProjection,
    pass: &mut FacePass,
) -> Result<(), String> {
    let local_transform = Mat4::from_cols_array_2d(&node.transform().matrix());
    let world_transform = parent_transform * local_transform;
    if let Some(mesh) = node.mesh() {
        let mut mesh_edges = MeshEdges::default();
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
                .map(Vec3::from)
                .collect::<Vec<_>>();
            // Match the millimetre-sized world units used by B-rep geometry.
            let projected = positions
                .iter()
                .map(|&position| view.project(world_transform.transform_point3(position) * 1_000.0))
                .collect::<Vec<_>>();
            let indices = reader
                .read_indices()
                .map(|indices| indices.into_u32().collect::<Vec<_>>())
                .unwrap_or_else(|| (0..positions.len() as u32).collect());
            let color = material_color(primitive.material());
            for &[a, b, c] in indices.as_chunks::<3>().0 {
                let indices = [a as usize, b as usize, c as usize];
                if indices.iter().any(|&index| index >= positions.len()) {
                    return Err("GLB mesh primitive contains an invalid index".into());
                }
                let points = indices.map(|index| projected[index]);
                draw_triangle(&mut pass.image, &mut pass.depth, points, color);
                if color[3] != 0 {
                    mesh_edges.add_triangle(indices.map(|index| positions[index]), points);
                }
            }
        }
        pass.silhouettes.extend(mesh_edges.into_silhouettes());
    }
    for child in node.children() {
        rasterize_node(child, world_transform, blob, view, pass)?;
    }
    Ok(())
}

fn material_color(material: gltf::Material<'_>) -> Rgba<u8> {
    let [red, green, blue, alpha] = material.pbr_metallic_roughness().base_color_factor();
    let alpha = match material.alpha_mode() {
        gltf::material::AlphaMode::Opaque => 1.0,
        gltf::material::AlphaMode::Mask => {
            if alpha < material.alpha_cutoff().unwrap_or(0.5) {
                0.0
            } else {
                1.0
            }
        }
        gltf::material::AlphaMode::Blend => alpha,
    };
    // PNG stores straight alpha: only RGB channels use the sRGB transfer function.
    Rgba([
        linear_to_srgb_u8(red),
        linear_to_srgb_u8(green),
        linear_to_srgb_u8(blue),
        (alpha.clamp(0.0, 1.0) * 255.0).round() as u8,
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

fn draw_triangle(image: &mut RgbaImage, depth_buffer: &mut [f32], points: [ScreenPoint; 3], color: Rgba<u8>) {
    // Fully transparent fragments must not hide faces or edges behind them.
    if color[3] == 0 {
        return;
    }
    let edge = |a: ScreenPoint, b: ScreenPoint, x: f32, y: f32| (x - a.x) * (b.y - a.y) - (y - a.y) * (b.x - a.x);
    let area = triangle_area(points);
    if area.abs() <= f32::EPSILON {
        return;
    }
    // glTF front faces wind counterclockwise. Projection flips Y, so this
    // edge function gives front faces positive area and backfaces negative area.
    let color = if area < 0.0 { Rgba([0, 213, 255, 255]) } else { color };
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

fn draw_line(image: &mut RgbaImage, start: (f32, f32), end: (f32, f32), line_width: f32) {
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
    image: &mut RgbaImage,
    depth_buffer: &[f32],
    start: ScreenPoint,
    end: ScreenPoint,
    depth_tolerance: f32,
    line_width: f32,
    color: Rgba<u8>,
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
            image.put_pixel(x, y, color);
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

    fn silhouette_view() -> ViewProjection {
        ViewProjection {
            center: Vec3::ZERO,
            forward: -Vec3::Z,
            right: Vec3::X,
            up: Vec3::Y,
            scale: 1.0,
            width: 32,
            height: 32,
        }
    }

    // Each triangle has its own accessor and primitive, as with exported seams.
    fn triangle_glb(triangles: &[[Vec3; 3]], alpha: f32, nodes: &str) -> Vec<u8> {
        let bin: Vec<u8> = triangles
            .iter()
            .flatten()
            .flat_map(|point| point.to_array().into_iter().flat_map(f32::to_le_bytes))
            .collect();
        let accessors = (0..triangles.len()).map(|i| format!(
            r#"{{"bufferView":0,"byteOffset":{},"componentType":5126,"count":3,"type":"VEC3","min":[-1,-1,-1],"max":[1,1,1]}}"#, i * 36
        )).collect::<Vec<_>>().join(",");
        let primitives = (0..triangles.len())
            .map(|i| format!(r#"{{"attributes":{{"POSITION":{i}}},"material":0}}"#))
            .collect::<Vec<_>>()
            .join(",");
        let json = format!(
            r#"{{"asset":{{"version":"2.0"}},"buffers":[{{"byteLength":{}}}],"bufferViews":[{{"buffer":0,"byteLength":{}}}],"accessors":[{accessors}],"materials":[{{"alphaMode":"BLEND","pbrMetallicRoughness":{{"baseColorFactor":[1,0,0,{alpha}]}}}}],"meshes":[{{"primitives":[{primitives}]}}],"nodes":[{nodes}],"scenes":[{{"nodes":[0]}}],"scene":0}}"#,
            bin.len(),
            bin.len()
        );
        gltf::binary::Glb {
            header: gltf::binary::Header {
                magic: *b"glTF",
                version: 2,
                length: 0,
            },
            json: json.into_bytes().into(),
            bin: Some(bin.into()),
        }
        .to_vec()
        .unwrap()
    }

    fn square_triangles() -> [[Vec3; 3]; 2] {
        let a = Vec3::new(-0.01, -0.01, 0.0);
        let b = Vec3::new(0.01, -0.01, 0.0);
        let c = Vec3::new(0.01, 0.01, 0.0);
        let d = Vec3::new(-0.01, 0.01, -0.0);
        [[a, b, c], [a, c, d]]
    }

    fn assert_padded_fit(view: ViewProjection, points: &[Vec3]) {
        let mut min_x = f32::INFINITY;
        let mut max_x = f32::NEG_INFINITY;
        let mut min_y = f32::INFINITY;
        let mut max_y = f32::NEG_INFINITY;
        for &point in points {
            let point = view.project(point);
            min_x = min_x.min(point.x);
            max_x = max_x.max(point.x);
            min_y = min_y.min(point.y);
            max_y = max_y.max(point.y);
        }
        let padding_x = view.width as f32 * FRAME_PADDING + LINE_WIDTH * 0.5;
        let padding_y = view.height as f32 * FRAME_PADDING + LINE_WIDTH * 0.5;
        assert!((min_x + max_x - view.width as f32).abs() < 0.1, "horizontal centering");
        assert!((min_y + max_y - view.height as f32).abs() < 0.1, "vertical centering");
        assert!(min_x >= padding_x - 0.1 && min_y >= padding_y - 0.1, "minimum padding");
        assert!(
            (min_x - padding_x).abs() < 0.6 && (min_y - padding_y).abs() < 0.6,
            "five percent margins on both axes, allowing pixel rounding"
        );
    }

    #[test]
    fn framing_fits_projected_bounds_at_different_aspect_ratios() {
        // Asymmetric shapes expose the difference between 3D and screen centering.
        let shape = [Vec3::ZERO, Vec3::X, Vec3::Y * 0.4, Vec3::new(0.2, 0.1, 1.5)];
        for (width, height) in [(1280, 720), (720, 1280), (512, 512)] {
            for stretch in [Vec3::ONE, Vec3::new(20.0, 1.0, 1.0), Vec3::new(1.0, 20.0, 1.0)] {
                for angle in [0.0, 0.7, 1.5] {
                    let transform = Mat4::from_rotation_y(angle);
                    let points = shape.map(|p| transform.transform_point3(p * stretch) + Vec3::new(100.0, -20.0, 7.0));
                    let view = ViewProjection::from_points(points, width, height).unwrap();
                    assert_padded_fit(view, &points);
                    assert!(view.width <= width && view.height <= height);
                    assert!(view.width == width || view.height == height);
                }
            }
        }
    }

    #[test]
    fn framing_trims_wide_tall_and_square_views_within_default_size() {
        let basis = ViewProjection::from_points([Vec3::ZERO, Vec3::ONE], 1024, 1024).unwrap();
        for (horizontal, vertical) in [(4.0, 1.0), (1.0, 4.0), (1.0, 1.0), (1000.0, 0.01)] {
            let points = [
                -basis.right * horizontal - basis.up * vertical,
                basis.right * horizontal + basis.up * vertical,
            ];
            let view = ViewProjection::from_points(points, MAX_OUTPUT_SIZE.x, MAX_OUTPUT_SIZE.y).unwrap();
            assert_padded_fit(view, &points);
            assert_eq!(view.width.max(view.height), 1024);
            if horizontal > vertical {
                assert!(view.width > view.height);
            } else if horizontal < vertical {
                assert!(view.height > view.width);
            } else {
                assert_eq!((view.width, view.height), (1024, 1024));
            }
        }
    }

    #[test]
    fn framing_is_independent_of_camera_depth_extent() {
        let basis = ViewProjection::from_points([Vec3::ZERO, Vec3::ONE], 1280, 720).unwrap();
        for depth in [0.0, 10.0, 100.0] {
            let points = [
                -basis.right - basis.up,
                basis.right + basis.up + basis.forward * depth,
                basis.right - basis.up,
            ];
            let view = ViewProjection::from_points(points, 1280, 720).unwrap();
            assert_padded_fit(view, &points);
            assert!((view.scale - (720.0 * 0.9 - LINE_WIDTH) * 0.5).abs() < 0.1);
        }
    }

    #[test]
    fn framing_includes_transformed_mesh_silhouettes_and_brep_geometry() {
        let triangles = square_triangles();
        let nodes = r#"{"translation":[0.04,0,0],"children":[1]},{"mesh":0,"translation":[0,0,0.02],"scale":[2,1,1]}"#;
        let glb = triangle_glb(&triangles, 1.0, nodes);
        let edges = BrepRenderData {
            edge_polylines: vec![vec![Vec3::ZERO, Vec3::new(0.0, 30.0, 0.0)]],
            ..Default::default()
        };
        let mut points = edges.edge_polylines[0].clone();
        points.extend(
            triangles
                .into_iter()
                .flatten()
                .map(|p| (p * Vec3::new(2.0, 1.0, 1.0) + Vec3::new(0.04, 0.0, 0.02)) * 1_000.0),
        );
        let view = ViewProjection::from_model(&glb, &edges, 1280, 720).unwrap();
        assert_padded_fit(view, &points);

        let hidden = triangle_glb(&triangles, 0.0, nodes);
        let view = ViewProjection::from_model(&hidden, &edges, 1280, 720).unwrap();
        assert_padded_fit(view, &edges.edge_polylines[0]);
    }

    #[test]
    fn framing_handles_points_lines_and_empty_geometry() {
        assert!(ViewProjection::from_points([], 1280, 720).is_err());
        assert!(ViewProjection::from_points([Vec3::NAN], 1280, 720).is_err());
        assert!(ViewProjection::from_points([Vec3::ZERO], 0, 720).is_err());
        let point = Vec3::new(10.0, -4.0, 2.0);
        let view = ViewProjection::from_points([point], 1280, 720).unwrap();
        assert!(view.scale.is_finite());
        let projected = view.project(point);
        assert_eq!(
            (projected.x, projected.y),
            (view.width as f32 * 0.5, view.height as f32 * 0.5)
        );
        assert_eq!((view.width, view.height), (3, 3));
        let points = [-view.right, view.right];
        assert_padded_fit(ViewProjection::from_points(points, 1280, 720).unwrap(), &points);
    }

    #[test]
    fn silhouettes_weld_primitive_seams_and_keep_brep_edges_blue() {
        let glb = triangle_glb(&square_triangles(), 1.0, r#"{"mesh":0}"#);
        let view = silhouette_view();
        let pass = render_faces(&glb, view).unwrap();
        assert_eq!(pass.silhouettes.len(), 4, "the shared diagonal is not a silhouette");
        let edges = BrepRenderData {
            edge_polylines: vec![vec![Vec3::new(-10.0, -10.0, 0.0), Vec3::new(10.0, -10.0, 0.0)]],
            ..Default::default()
        };
        let image = render_image(&glb, &edges, view).unwrap().into_rgba8();
        assert_eq!(*image.get_pixel(16, 6), SILHOUETTE_COLOR);
        assert_eq!(*image.get_pixel(16, 26), EDGE_COLOR);
        assert_eq!(*image.get_pixel(16, 16), Rgba([255, 0, 0, 255]));
    }

    #[test]
    fn silhouettes_include_front_back_transitions_and_ignore_degenerate_faces() {
        let view = silhouette_view();
        let triangles = square_triangles();
        for (reverse, expected) in [(false, 4), (true, 5)] {
            let mut mesh = MeshEdges::default();
            for mut triangle in triangles {
                if reverse && triangle[2].x < 0.0 {
                    triangle.swap(1, 2);
                }
                mesh.add_triangle(triangle, triangle.map(|p| view.project(p * 1_000.0)));
            }
            mesh.add_triangle([Vec3::ZERO; 3], [view.project(Vec3::ZERO); 3]);
            assert_eq!(mesh.into_silhouettes().count(), expected);
        }
    }

    #[test]
    fn transparent_meshes_have_no_silhouettes() {
        let glb = triangle_glb(&square_triangles(), 0.0, r#"{"mesh":0}"#);
        let mut pass = render_faces(&glb, silhouette_view()).unwrap();
        assert!(pass.silhouettes.is_empty());
        draw_silhouettes(&mut pass, silhouette_view());
        assert!(pass.image.pixels().all(|pixel| *pixel == BACKGROUND));
    }

    #[test]
    fn silhouettes_depth_test_against_later_nodes_and_respect_transforms() {
        // The child instance covers the first instance and is ten units nearer.
        let nodes = r#"{"mesh":0,"children":[1]},{"mesh":0,"translation":[0,0,0.01],"scale":[1.5,1.5,1]}"#;
        let glb = triangle_glb(&square_triangles(), 1.0, nodes);
        let view = silhouette_view();
        let mut pass = render_faces(&glb, view).unwrap();
        assert_eq!(pass.silhouettes.len(), 8);
        draw_silhouettes(&mut pass, view);
        assert_eq!(*pass.image.get_pixel(16, 6), Rgba([255, 0, 0, 255]));
        assert_eq!(*pass.image.get_pixel(16, 1), SILHOUETTE_COLOR);
    }

    #[test]
    fn material_colors_preserve_straight_alpha() {
        for (mode, alpha, cutoff, expected_alpha) in [
            ("BLEND", 0.5, 0.5, 128),
            ("BLEND", 0.0, 0.5, 0),
            ("BLEND", 1.0, 0.5, 255),
            ("OPAQUE", 0.5, 0.5, 255),
            ("MASK", 0.4, 0.5, 0),
            ("MASK", 0.5, 0.5, 255),
            ("MASK", 0.5, 0.6, 0),
        ] {
            let json = format!(
                r#"{{"asset":{{"version":"2.0"}},"materials":[{{"alphaMode":"{mode}","alphaCutoff":{cutoff},"pbrMetallicRoughness":{{"baseColorFactor":[1.0,0.5,0.0,{alpha}]}}}}]}}"#
            );
            let gltf = gltf::Gltf::from_slice(json.as_bytes()).unwrap();
            let color = material_color(gltf.materials().next().unwrap());
            assert_eq!(color, Rgba([255, 188, 0, expected_alpha]), "{json}");
        }
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
        let view = ViewProjection::from_points(data.edge_polylines.iter().flatten().copied(), 32, 32).unwrap();
        let image = render_edges(&data, view);
        assert!(image.pixels().any(|pixel| *pixel != BACKGROUND));
        assert!(image.pixels().all(|pixel| *pixel == BACKGROUND || *pixel == EDGE_COLOR));
    }

    #[test]
    fn depth_tests_flat_faces() {
        let mut image = RgbaImage::from_pixel(8, 8, BACKGROUND);
        let mut depth = vec![f32::INFINITY; 64];
        let triangle = |depth| {
            [
                ScreenPoint { x: 1.0, y: 1.0, depth },
                ScreenPoint { x: 1.0, y: 7.0, depth },
                ScreenPoint { x: 7.0, y: 1.0, depth },
            ]
        };
        draw_triangle(&mut image, &mut depth, triangle(0.0), Rgba([255, 0, 0, 0]));
        assert!(image.pixels().all(|pixel| *pixel == BACKGROUND));
        assert!(depth.iter().all(|value| *value == f32::INFINITY));
        let near = Rgba([1, 2, 3, 128]);
        draw_triangle(&mut image, &mut depth, triangle(1.0), near);
        draw_triangle(&mut image, &mut depth, triangle(2.0), Rgba([4, 5, 6, 255]));
        assert_eq!(*image.get_pixel(2, 2), near);
    }

    #[test]
    fn backfaces_use_opaque_cyan() {
        let data = BrepRenderData {
            edge_polylines: vec![vec![-Vec3::ONE, Vec3::ONE]],
            ..Default::default()
        };
        let view = ViewProjection::from_points(data.edge_polylines.iter().flatten().copied(), 32, 32).unwrap();
        // This counterclockwise triangle has a normal pointing toward the camera.
        let front = [
            view.project(-view.right - view.up),
            view.project(view.right - view.up),
            view.project(view.up),
        ];
        for alpha in [128, 255] {
            let material = Rgba([255, 100, 0, alpha]);
            for (points, expected) in [
                (front, material),
                ([front[0], front[2], front[1]], Rgba([0, 213, 255, 255])),
            ] {
                let mut image = RgbaImage::from_pixel(32, 32, BACKGROUND);
                let mut depth = vec![f32::INFINITY; 32 * 32];
                draw_triangle(&mut image, &mut depth, points, material);
                assert_eq!(*image.get_pixel(16, 16), expected);
                assert!(depth[16 * 32 + 16].is_finite());
                assert_eq!(*image.get_pixel(0, 0), BACKGROUND);
            }
        }
    }

    #[test]
    fn hides_edges_behind_the_face_depth_buffer() {
        let mut image = RgbaImage::from_pixel(8, 8, BACKGROUND);
        let depth = vec![0.0; 64];
        let point = |x, depth| ScreenPoint { x, y: 4.0, depth };

        draw_depth_tested_line(
            &mut image,
            &depth,
            point(1.0, 1.0),
            point(7.0, 1.0),
            0.0,
            LINE_WIDTH,
            EDGE_COLOR,
        );
        assert!(image.pixels().all(|pixel| *pixel == BACKGROUND));

        draw_depth_tested_line(
            &mut image,
            &depth,
            point(1.0, -1.0),
            point(7.0, -1.0),
            0.0,
            LINE_WIDTH,
            EDGE_COLOR,
        );
        assert!(image.pixels().any(|pixel| *pixel != BACKGROUND));
    }
}
