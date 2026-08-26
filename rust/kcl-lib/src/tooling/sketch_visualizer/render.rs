//! Deterministic raster rendering for sampled sketch geometry.
//!
//! By the time data reaches this module, curves have already been sampled into
//! polylines. Rendering fits each polyline to the canvas and colors it by
//! solver freedom.

use std::collections::BTreeMap;
use std::collections::BTreeSet;
use std::io::Cursor;

use image::DynamicImage;
use image::ImageFormat;
use image::Rgba;
use image::RgbaImage;

use super::model::InternalPoint;
use super::model::InternalSegment;
use super::types::SketchVisualizationBounds;
use super::types::SketchVisualizationError;
use super::types::SketchVisualizationPoint;
use crate::front::Freedom;

const CANVAS_WIDTH: u32 = 1024;
const CANVAS_HEIGHT: u32 = 1024;
const CANVAS_PADDING: u32 = 48;
const PRIMARY_LINE_WIDTH: f64 = 3.0;
const POINT_RADIUS: f64 = 4.0;
const CONTACT_POINT_RADIUS: f64 = 5.0;

const FREE_COLOR: Color = Color::rgb(0x3c, 0x73, 0xff);
const CONFLICT_COLOR: Color = Color::rgb(0xff, 0x5e, 0x5b);
const FIXED_COLOR: Color = Color::rgb(0xff, 0xff, 0xff);
const DARK_BACKGROUND: Color = Color::rgb(0x18, 0x1a, 0x1f);
const POINT_OUTLINE_DARK: Color = Color::rgb(0x18, 0x1a, 0x1f);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) struct Color {
    r: u8,
    g: u8,
    b: u8,
    a: u8,
}

impl Color {
    const fn rgb(r: u8, g: u8, b: u8) -> Self {
        Self { r, g, b, a: 255 }
    }

    fn to_rgba(self) -> Rgba<u8> {
        Rgba([self.r, self.g, self.b, self.a])
    }
}

fn dof_color(freedom: Option<Freedom>) -> Color {
    match freedom {
        Some(Freedom::Conflict) => CONFLICT_COLOR,
        Some(Freedom::Fixed) => FIXED_COLOR,
        Some(Freedom::Free) | None => FREE_COLOR,
    }
}

pub(super) fn render_png(
    segments: &BTreeMap<usize, InternalSegment>,
    points: &BTreeMap<usize, InternalPoint>,
    contact_point_ids: &BTreeSet<usize>,
    bounds: SketchVisualizationBounds,
) -> Result<Vec<u8>, SketchVisualizationError> {
    let mut image = RgbaImage::from_pixel(CANVAS_WIDTH, CANVAS_HEIGHT, DARK_BACKGROUND.to_rgba());
    let transform = Transform::new(bounds);

    // Segment polylines were sampled in world coordinates by extraction. The
    // transform below is the only world-to-screen conversion in the raster path.
    for segment in segments.values() {
        let color = dof_color(segment.freedom);
        draw_polyline(&mut image, &segment.polyline, color, segment.construction, &transform);
    }

    for (point_id, point) in points {
        let owner_color = point
            .owner
            .and_then(|owner| segments.get(&owner))
            .map(|segment| dof_color(segment.freedom));
        let color = owner_color.unwrap_or_else(|| dof_color(Some(point.freedom)));
        let radius = if contact_point_ids.contains(point_id) {
            CONTACT_POINT_RADIUS
        } else {
            POINT_RADIUS
        };
        let screen = transform.point(point.position);
        draw_filled_circle(&mut image, screen, radius + 1.5, POINT_OUTLINE_DARK);
        draw_filled_circle(&mut image, screen, radius, color);
    }

    let dynamic = DynamicImage::ImageRgba8(image);
    let mut cursor = Cursor::new(Vec::new());
    dynamic.write_to(&mut cursor, ImageFormat::Png)?;
    Ok(cursor.into_inner())
}

#[derive(Debug, Clone, Copy)]
struct Transform {
    scale: f64,
    offset_x: f64,
    offset_y: f64,
}

impl Transform {
    fn new(bounds: SketchVisualizationBounds) -> Self {
        let content_width = (CANVAS_WIDTH - CANVAS_PADDING * 2) as f64;
        let content_height = (CANVAS_HEIGHT - CANVAS_PADDING * 2) as f64;
        let world_width = libm::fmax((bounds.max.x - bounds.min.x).abs(), 1.0);
        let world_height = libm::fmax((bounds.max.y - bounds.min.y).abs(), 1.0);
        let scale = libm::fmin(content_width / world_width, content_height / world_height);
        let world_center_x = (bounds.min.x + bounds.max.x) * 0.5;
        let world_center_y = (bounds.min.y + bounds.max.y) * 0.5;
        let screen_center_x = CANVAS_WIDTH as f64 * 0.5;
        let screen_center_y = CANVAS_HEIGHT as f64 * 0.5;
        // KCL sketch space is y-up, while image pixels are y-down.
        Self {
            scale,
            offset_x: screen_center_x - world_center_x * scale,
            offset_y: screen_center_y + world_center_y * scale,
        }
    }

    fn point(self, point: SketchVisualizationPoint) -> ScreenPoint {
        ScreenPoint {
            x: point.x * self.scale + self.offset_x,
            y: -point.y * self.scale + self.offset_y,
        }
    }
}

#[derive(Debug, Clone, Copy)]
struct ScreenPoint {
    x: f64,
    y: f64,
}

fn draw_polyline(
    image: &mut RgbaImage,
    points: &[SketchVisualizationPoint],
    color: Color,
    dashed: bool,
    transform: &Transform,
) {
    for segment in points.windows(2) {
        let start = transform.point(segment[0]);
        let end = transform.point(segment[1]);
        if dashed {
            draw_dashed_line(image, start, end, color);
        } else {
            draw_line(image, start, end, color);
        }
    }
}

fn draw_dashed_line(image: &mut RgbaImage, start: ScreenPoint, end: ScreenPoint, color: Color) {
    let length = screen_distance(start, end);
    if length <= f64::EPSILON {
        return;
    }

    let dash = 12.0;
    let gap = 8.0;
    let step = dash + gap;
    let mut cursor = 0.0;
    while cursor < length {
        let dash_end = libm::fmin(cursor + dash, length);
        let from = interpolate_screen(start, end, cursor / length);
        let to = interpolate_screen(start, end, dash_end / length);
        draw_line(image, from, to, color);
        cursor += step;
    }
}

fn draw_line(image: &mut RgbaImage, start: ScreenPoint, end: ScreenPoint, color: Color) {
    let length = screen_distance(start, end);
    if length <= f64::EPSILON {
        draw_filled_circle(image, start, PRIMARY_LINE_WIDTH * 0.5, color);
        return;
    }

    // The `image` crate gives raw pixels, not vector stroking. Sampling along the
    // line and stamping filled circles gives deterministic anti-aliased-enough
    // strokes without pulling in a larger renderer.
    let samples = length.ceil() as usize;
    for index in 0..=samples {
        let t = index as f64 / samples as f64;
        draw_filled_circle(
            image,
            interpolate_screen(start, end, t),
            PRIMARY_LINE_WIDTH * 0.5,
            color,
        );
    }
}

fn draw_filled_circle(image: &mut RgbaImage, center: ScreenPoint, radius: f64, color: Color) {
    let min_x = (center.x - radius).floor() as i32;
    let max_x = (center.x + radius).ceil() as i32;
    let min_y = (center.y - radius).floor() as i32;
    let max_y = (center.y + radius).ceil() as i32;
    let radius_sq = radius * radius;

    for y in min_y..=max_y {
        for x in min_x..=max_x {
            if x < 0 || y < 0 || x >= image.width() as i32 || y >= image.height() as i32 {
                continue;
            }
            let dx = x as f64 + 0.5 - center.x;
            let dy = y as f64 + 0.5 - center.y;
            if dx * dx + dy * dy <= radius_sq {
                image.put_pixel(x as u32, y as u32, color.to_rgba());
            }
        }
    }
}

fn screen_distance(a: ScreenPoint, b: ScreenPoint) -> f64 {
    ((a.x - b.x).powi(2) + (a.y - b.y).powi(2)).sqrt()
}

fn interpolate_screen(a: ScreenPoint, b: ScreenPoint, t: f64) -> ScreenPoint {
    ScreenPoint {
        x: a.x + (b.x - a.x) * t,
        y: a.y + (b.y - a.y) * t,
    }
}
