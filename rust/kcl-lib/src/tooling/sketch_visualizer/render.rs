//! Deterministic raster rendering for sampled sketch geometry.
//!
//! By the time data reaches this module, curves have already been sampled into
//! polylines and colors have been decided by extraction. Rendering can therefore
//! be a small pixel pipeline: fit world bounds to the canvas, draw optional
//! helper polylines, draw primary polylines, then draw points on top.

use std::collections::BTreeMap;
use std::io::Cursor;

use image::DynamicImage;
use image::ImageFormat;
use image::Rgba;
use image::RgbaImage;

use super::model::InternalPoint;
use super::model::InternalPolyline;
use super::model::InternalSegment;
use super::types::SketchVisualizationBounds;
use super::types::SketchVisualizationError;
use super::types::SketchVisualizationOptions;
use super::types::SketchVisualizationPoint;
use super::types::SketchVisualizationSegmentKind;
use super::types::SketchVisualizationTheme;
use crate::front::Freedom;

const PRIMARY_LINE_WIDTH: f64 = 3.0;
const CONTROL_POLYGON_LINE_WIDTH: f64 = 1.25;
const POINT_RADIUS: f64 = 4.0;
const GROUPED_POINT_RADIUS: f64 = 5.0;

pub(super) const FREE_COLOR: Color = Color::rgb(0x3c, 0x73, 0xff);
const CONFLICT_COLOR: Color = Color::rgb(0xff, 0x5e, 0x5b);
const FIXED_DARK_THEME_COLOR: Color = Color::rgb(0xff, 0xff, 0xff);
const FIXED_LIGHT_THEME_COLOR: Color = Color::rgb(0x00, 0x00, 0x00);
const DARK_BACKGROUND: Color = Color::rgb(0x18, 0x1a, 0x1f);
const LIGHT_BACKGROUND: Color = Color::rgb(0xfa, 0xfa, 0xfa);
const CONTROL_POLYGON_COLOR: Color = Color::rgb(0x8a, 0x8a, 0x8a);
const POINT_OUTLINE_DARK: Color = Color::rgb(0x18, 0x1a, 0x1f);
const POINT_OUTLINE_LIGHT: Color = Color::rgb(0xfa, 0xfa, 0xfa);
const NO_SHARP_TANGENT_DARK_COLOR: Color = Color::rgb(0xd4, 0xd4, 0xd8);
const NO_SHARP_TANGENT_LIGHT_COLOR: Color = Color::rgb(0x33, 0x33, 0x3a);
const SHARP_TANGENT_RED: Color = Color::rgb(0xff, 0x5e, 0x5b);
const SHARP_TANGENT_PURPLE: Color = Color::rgb(0x7c, 0x3a, 0xff);

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

    pub(super) fn to_hex_string(self) -> String {
        format!("#{:02x}{:02x}{:02x}", self.r, self.g, self.b)
    }
}

pub(super) fn dof_color(freedom: Option<Freedom>, theme: SketchVisualizationTheme) -> Color {
    match freedom {
        Some(Freedom::Conflict) => CONFLICT_COLOR,
        Some(Freedom::Fixed) => match theme {
            SketchVisualizationTheme::Dark => FIXED_DARK_THEME_COLOR,
            SketchVisualizationTheme::Light => FIXED_LIGHT_THEME_COLOR,
        },
        Some(Freedom::Free) | None => FREE_COLOR,
    }
}

pub(super) fn id_color(id: usize) -> Color {
    // Hash the object ID before mapping into HSV so nearby segment IDs do not
    // produce visually adjacent colors.
    let hash = stable_id_hash(id as u64);
    let hue = ((hash % 360) as f64) / 360.0;
    let saturation = 0.62 + (((hash >> 32) % 18) as f64 / 100.0);
    let value = 0.82 + (((hash >> 40) % 14) as f64 / 100.0);
    hsv_to_rgb(hue, saturation, value)
}

pub(super) fn sharp_tangent_color(count: usize, theme: SketchVisualizationTheme) -> Color {
    if count == 0 {
        return match theme {
            SketchVisualizationTheme::Dark => NO_SHARP_TANGENT_DARK_COLOR,
            SketchVisualizationTheme::Light => NO_SHARP_TANGENT_LIGHT_COLOR,
        };
    }

    let t = libm::fmin((count.saturating_sub(1)) as f64 / 3.0, 1.0);
    Color::rgb(
        lerp_channel(SHARP_TANGENT_RED.r, SHARP_TANGENT_PURPLE.r, t),
        lerp_channel(SHARP_TANGENT_RED.g, SHARP_TANGENT_PURPLE.g, t),
        lerp_channel(SHARP_TANGENT_RED.b, SHARP_TANGENT_PURPLE.b, t),
    )
}

fn stable_id_hash(mut value: u64) -> u64 {
    value = value.wrapping_add(0x9e37_79b9_7f4a_7c15);
    value = (value ^ (value >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
    value = (value ^ (value >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
    value ^ (value >> 31)
}

fn hsv_to_rgb(h: f64, s: f64, v: f64) -> Color {
    let i = (h * 6.0).floor();
    let f = h * 6.0 - i;
    let p = v * (1.0 - s);
    let q = v * (1.0 - f * s);
    let t = v * (1.0 - (1.0 - f) * s);
    let (r, g, b) = match (i as u32) % 6 {
        0 => (v, t, p),
        1 => (q, v, p),
        2 => (p, v, t),
        3 => (p, q, v),
        4 => (t, p, v),
        _ => (v, p, q),
    };
    Color::rgb(float_channel(r), float_channel(g), float_channel(b))
}

fn float_channel(value: f64) -> u8 {
    (value.clamp(0.0, 1.0) * 255.0).round() as u8
}

fn lerp_channel(from: u8, to: u8, t: f64) -> u8 {
    (from as f64 + (to as f64 - from as f64) * t).round().clamp(0.0, 255.0) as u8
}

pub(super) fn render_png(
    segments: &BTreeMap<usize, InternalSegment>,
    control_polygons: &[InternalPolyline],
    points: &BTreeMap<usize, InternalPoint>,
    rendered_colors: &BTreeMap<usize, String>,
    point_contact_group: &BTreeMap<usize, usize>,
    bounds: SketchVisualizationBounds,
    options: &SketchVisualizationOptions,
) -> Result<Vec<u8>, SketchVisualizationError> {
    let background = match options.theme {
        SketchVisualizationTheme::Dark => DARK_BACKGROUND,
        SketchVisualizationTheme::Light => LIGHT_BACKGROUND,
    };
    let point_outline = match options.theme {
        SketchVisualizationTheme::Dark => POINT_OUTLINE_DARK,
        SketchVisualizationTheme::Light => POINT_OUTLINE_LIGHT,
    };
    let mut image = RgbaImage::from_pixel(options.width, options.height, background.to_rgba());
    let transform = Transform::new(bounds, options);

    // Draw control polygons first so primary geometry and endpoint points remain
    // visually dominant.
    if options.show_control_polygons {
        for polyline in control_polygons {
            draw_polyline(
                &mut image,
                &polyline.points,
                CONTROL_POLYGON_COLOR,
                CONTROL_POLYGON_LINE_WIDTH,
                polyline.dashed,
                &transform,
            );
        }
    }

    // Segment polylines were sampled in world coordinates by extraction. The
    // transform below is the only world-to-screen conversion in the raster path.
    for segment in segments.values() {
        let color = rendered_colors
            .get(&segment.id)
            .and_then(|hex| Color::from_hex(hex))
            .unwrap_or(FREE_COLOR);
        for polyline in &segment.polylines {
            if segment.kind == SketchVisualizationSegmentKind::Point {
                continue;
            }
            draw_polyline(
                &mut image,
                polyline,
                color,
                PRIMARY_LINE_WIDTH,
                segment.construction,
                &transform,
            );
        }
    }

    for point in points.values() {
        let owner_color = point
            .owner
            .and_then(|owner| rendered_colors.get(&owner))
            .and_then(|hex| Color::from_hex(hex));
        let color = owner_color.unwrap_or_else(|| dof_color(Some(point.freedom), options.theme));
        let radius = if point_contact_group.contains_key(&point.id) {
            GROUPED_POINT_RADIUS
        } else {
            POINT_RADIUS
        };
        let screen = transform.point(point.position);
        draw_filled_circle(&mut image, screen, radius + 1.5, point_outline);
        draw_filled_circle(&mut image, screen, radius, color);
    }

    let dynamic = DynamicImage::ImageRgba8(image);
    let mut cursor = Cursor::new(Vec::new());
    dynamic.write_to(&mut cursor, ImageFormat::Png)?;
    Ok(cursor.into_inner())
}

impl Color {
    fn from_hex(hex: &str) -> Option<Self> {
        let hex = hex.strip_prefix('#').unwrap_or(hex);
        if hex.len() != 6 {
            return None;
        }
        let r = u8::from_str_radix(&hex[0..2], 16).ok()?;
        let g = u8::from_str_radix(&hex[2..4], 16).ok()?;
        let b = u8::from_str_radix(&hex[4..6], 16).ok()?;
        Some(Self::rgb(r, g, b))
    }
}

#[derive(Debug, Clone, Copy)]
struct Transform {
    scale: f64,
    offset_x: f64,
    offset_y: f64,
}

impl Transform {
    fn new(bounds: SketchVisualizationBounds, options: &SketchVisualizationOptions) -> Self {
        let content_width = (options.width - options.padding * 2) as f64;
        let content_height = (options.height - options.padding * 2) as f64;
        let world_width = libm::fmax((bounds.max.x - bounds.min.x).abs(), 1.0);
        let world_height = libm::fmax((bounds.max.y - bounds.min.y).abs(), 1.0);
        let scale = libm::fmin(content_width / world_width, content_height / world_height);
        let world_center_x = (bounds.min.x + bounds.max.x) * 0.5;
        let world_center_y = (bounds.min.y + bounds.max.y) * 0.5;
        let screen_center_x = options.width as f64 * 0.5;
        let screen_center_y = options.height as f64 * 0.5;
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
    width: f64,
    dashed: bool,
    transform: &Transform,
) {
    for segment in points.windows(2) {
        let start = transform.point(segment[0]);
        let end = transform.point(segment[1]);
        if dashed {
            draw_dashed_line(image, start, end, color, width);
        } else {
            draw_line(image, start, end, color, width);
        }
    }
}

fn draw_dashed_line(image: &mut RgbaImage, start: ScreenPoint, end: ScreenPoint, color: Color, width: f64) {
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
        draw_line(image, from, to, color, width);
        cursor += step;
    }
}

fn draw_line(image: &mut RgbaImage, start: ScreenPoint, end: ScreenPoint, color: Color, width: f64) {
    let length = screen_distance(start, end);
    if length <= f64::EPSILON {
        draw_filled_circle(image, start, width * 0.5, color);
        return;
    }

    // The `image` crate gives raw pixels, not vector stroking. Sampling along the
    // line and stamping filled circles gives deterministic anti-aliased-enough
    // strokes without pulling in a larger renderer.
    let samples = length.ceil() as usize;
    for index in 0..=samples {
        let t = index as f64 / samples as f64;
        draw_filled_circle(image, interpolate_screen(start, end, t), width * 0.5, color);
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
