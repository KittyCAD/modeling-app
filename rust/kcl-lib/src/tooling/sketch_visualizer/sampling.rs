//! Curve sampling and world-space bounds helpers.
//!
//! Rendering is intentionally polyline-based: extraction samples arcs, circles,
//! and splines here, then `render` only has to draw straight segments.

use std::f64::consts::TAU;

use super::types::SketchVisualizationBounds;
use super::types::SketchVisualizationPoint;

const ARC_SAMPLE_COUNT: usize = 100;

/// Incrementally computes finite world-space bounds for sampled geometry.
#[derive(Default)]
pub(super) struct BoundsBuilder {
    min_x: Option<f64>,
    min_y: Option<f64>,
    max_x: Option<f64>,
    max_y: Option<f64>,
}

impl BoundsBuilder {
    pub(super) fn include(&mut self, point: SketchVisualizationPoint) {
        if !point.x.is_finite() || !point.y.is_finite() {
            return;
        }
        self.min_x = Some(self.min_x.map_or(point.x, |value| libm::fmin(value, point.x)));
        self.min_y = Some(self.min_y.map_or(point.y, |value| libm::fmin(value, point.y)));
        self.max_x = Some(self.max_x.map_or(point.x, |value| libm::fmax(value, point.x)));
        self.max_y = Some(self.max_y.map_or(point.y, |value| libm::fmax(value, point.y)));
    }

    pub(super) fn finish(self) -> SketchVisualizationBounds {
        let min_x = self.min_x.unwrap_or(-1.0);
        let min_y = self.min_y.unwrap_or(-1.0);
        let max_x = self.max_x.unwrap_or(1.0);
        let max_y = self.max_y.unwrap_or(1.0);
        let pad_x = if (max_x - min_x).abs() < f64::EPSILON { 0.5 } else { 0.0 };
        let pad_y = if (max_y - min_y).abs() < f64::EPSILON { 0.5 } else { 0.0 };
        SketchVisualizationBounds {
            min: SketchVisualizationPoint {
                x: min_x - pad_x,
                y: min_y - pad_y,
            },
            max: SketchVisualizationPoint {
                x: max_x + pad_x,
                y: max_y + pad_y,
            },
        }
    }
}

pub(super) fn sample_arc(
    center: SketchVisualizationPoint,
    start: SketchVisualizationPoint,
    end: SketchVisualizationPoint,
    ccw: bool,
) -> Vec<SketchVisualizationPoint> {
    let radius = (distance(center, start) + distance(center, end)) * 0.5;
    let start_angle = libm::atan2(start.y - center.y, start.x - center.x);
    let end_angle = libm::atan2(end.y - center.y, end.x - center.x);
    let mut sweep = if ccw {
        positive_angle_delta(end_angle - start_angle)
    } else {
        -positive_angle_delta(start_angle - end_angle)
    };
    if sweep.abs() <= 1.0e-12 {
        // Matching the frontend convention: equal start/end angles represent a
        // full arc sweep rather than an empty curve.
        sweep = if ccw { TAU } else { -TAU };
    }
    (0..=ARC_SAMPLE_COUNT)
        .map(|index| {
            let t = index as f64 / ARC_SAMPLE_COUNT as f64;
            let angle = start_angle + sweep * t;
            SketchVisualizationPoint {
                x: center.x + radius * libm::cos(angle),
                y: center.y + radius * libm::sin(angle),
            }
        })
        .collect()
}

pub(super) fn sample_circle(center: SketchVisualizationPoint, radius: f64) -> Vec<SketchVisualizationPoint> {
    (0..=ARC_SAMPLE_COUNT)
        .map(|index| {
            let angle = TAU * index as f64 / ARC_SAMPLE_COUNT as f64;
            SketchVisualizationPoint {
                x: center.x + radius * libm::cos(angle),
                y: center.y + radius * libm::sin(angle),
            }
        })
        .collect()
}

fn positive_angle_delta(delta: f64) -> f64 {
    let mut normalized = delta % TAU;
    if normalized < 0.0 {
        normalized += TAU;
    }
    normalized
}

pub(super) fn sample_control_point_spline(
    points: &[SketchVisualizationPoint],
    degree: usize,
) -> Vec<SketchVisualizationPoint> {
    let controls = points.iter().map(|point| [point.x, point.y]).collect::<Vec<_>>();
    crate::std::solver::sample_control_point_spline_points(&controls, degree)
        .into_iter()
        .map(|[x, y]| SketchVisualizationPoint { x, y })
        .collect()
}

pub(super) fn distance(a: SketchVisualizationPoint, b: SketchVisualizationPoint) -> f64 {
    ((a.x - b.x).powi(2) + (a.y - b.y).powi(2)).sqrt()
}
