//! Curve sampling and world-space bounds helpers.
//!
//! Rendering is intentionally polyline-based: extraction samples arcs, circles,
//! and splines here, then `render` only has to draw straight segments. This keeps
//! the PNG path deterministic and keeps sidecar bounds aligned with the rendered
//! geometry.

use std::f64::consts::TAU;

use super::types::SketchVisualizationBounds;
use super::types::SketchVisualizationPoint;

pub(super) const ARC_SAMPLE_COUNT: usize = 100;
const SPLINE_SAMPLES_PER_SPAN: usize = 24;

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
    samples: usize,
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
    (0..=samples)
        .map(|index| {
            let t = index as f64 / samples.max(1) as f64;
            let angle = start_angle + sweep * t;
            SketchVisualizationPoint {
                x: center.x + radius * libm::cos(angle),
                y: center.y + radius * libm::sin(angle),
            }
        })
        .collect()
}

pub(super) fn sample_circle(
    center: SketchVisualizationPoint,
    radius: f64,
    samples: usize,
) -> Vec<SketchVisualizationPoint> {
    (0..=samples)
        .map(|index| {
            let angle = TAU * index as f64 / samples.max(1) as f64;
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
    if points.len() < 2 {
        return points.to_vec();
    }

    let effective_degree = degree.max(1).min(points.len() - 1);
    if effective_degree == 1 {
        return points.to_vec();
    }

    // The frontend uses an open-uniform B-spline for control point splines. We
    // evaluate the same knot layout with de Boor so the static PNG resembles the
    // interactive sketch.
    let knots = build_open_uniform_knot_vector(points.len(), effective_degree);
    let span_count = (points.len() - effective_degree).max(1);
    let sample_count = (span_count * SPLINE_SAMPLES_PER_SPAN).max(2);

    (0..=sample_count)
        .map(|index| {
            let u = if index == sample_count {
                1.0
            } else {
                index as f64 / sample_count as f64
            };
            de_boor_point(points, effective_degree, &knots, u)
        })
        .collect()
}

fn build_open_uniform_knot_vector(point_count: usize, degree: usize) -> Vec<f64> {
    let order = degree + 1;
    let knot_count = point_count + order;
    let interior_count = knot_count.saturating_sub(2 * order);
    (0..knot_count)
        .map(|index| {
            if index < order {
                0.0
            } else if index >= knot_count - order {
                1.0
            } else {
                (index - degree) as f64 / (interior_count + 1) as f64
            }
        })
        .collect()
}

fn find_knot_span(u: f64, degree: usize, knots: &[f64]) -> usize {
    let point_count = knots.len() - degree - 1;
    let last_span = point_count - 1;
    if u >= knots[last_span + 1] {
        return last_span;
    }
    if u <= knots[degree] {
        return degree;
    }

    let mut low = degree;
    let mut high = last_span + 1;
    let mut mid = (low + high) / 2;
    while u < knots[mid] || u >= knots[mid + 1] {
        if u < knots[mid] {
            high = mid;
        } else {
            low = mid;
        }
        mid = (low + high) / 2;
    }
    mid
}

fn de_boor_point(
    points: &[SketchVisualizationPoint],
    degree: usize,
    knots: &[f64],
    u: f64,
) -> SketchVisualizationPoint {
    let span = find_knot_span(u, degree, knots);
    let mut d = (0..=degree)
        .map(|offset| points[span - degree + offset])
        .collect::<Vec<_>>();

    // de Boor repeatedly interpolates the local control points for this knot
    // span until one point on the curve remains.
    for r in 1..=degree {
        for j in (r..=degree).rev() {
            let knot_index = span - degree + j;
            let denom = knots[knot_index + degree - r + 1] - knots[knot_index];
            let alpha = if denom == 0.0 {
                0.0
            } else {
                (u - knots[knot_index]) / denom
            };
            d[j] = SketchVisualizationPoint {
                x: (1.0 - alpha) * d[j - 1].x + alpha * d[j].x,
                y: (1.0 - alpha) * d[j - 1].y + alpha * d[j].y,
            };
        }
    }

    d[degree]
}

pub(super) fn distance(a: SketchVisualizationPoint, b: SketchVisualizationPoint) -> f64 {
    ((a.x - b.x).powi(2) + (a.y - b.y).powi(2)).sqrt()
}
