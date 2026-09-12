use bevy_math::{FloatExt, Vec3};
use serde::Deserialize;
use serde_json::Value;
use thiserror::Error;

/// Zoo exports geometry in metres. One displayed millimetre occupies one world unit.
const WORLD_SCALE: f32 = 1_000.0;
const CURVE_CHORD_ERROR: f32 = 0.002;
const MIN_CURVE_SEGMENTS: usize = 2;
const MIN_CLOSED_CURVE_SEGMENTS: usize = 8;
const MAX_CURVE_SEGMENTS: usize = 512;
const MAX_NURBS_SUBDIVISION_DEPTH: usize = 10;

#[cfg_attr(feature = "bevy", derive(bevy_ecs::prelude::Resource))]
#[derive(Clone, Debug, Default)]
pub struct BrepRenderData {
    pub vertices: Vec<Vec3>,
    pub edges: Vec<[Vec3; 2]>,
    pub edge_vertices: Vec<[usize; 2]>,
    pub edge_polylines: Vec<Vec<Vec3>>,
    pub curved_edges: Vec<bool>,
    pub face_edges: Vec<Vec<usize>>,
    pub face_count: usize,
    pub vertex_radius: f32,
}

#[derive(Debug, Error)]
pub enum BrepRenderError {
    #[error("invalid Zoo B-rep extension: {0}")]
    InvalidExtension(#[from] serde_json::Error),
    #[error("edge {edge} references missing vertex {vertex}")]
    MissingVertex { edge: usize, vertex: usize },
}

#[derive(Deserialize)]
struct WireBrep {
    #[serde(default)]
    vertices: Vec<[f32; 3]>,
    #[serde(default)]
    edges: Vec<WireEdge>,
    #[serde(default, rename = "curves3D", alias = "curves")]
    curves3_d: Vec<Value>,
    #[serde(default)]
    loops: Vec<WireLoop>,
    #[serde(default)]
    faces: Vec<WireFace>,
}

#[derive(Deserialize)]
struct WireFace {
    #[serde(default)]
    loops: Vec<Vec<Value>>,
}

#[derive(Deserialize)]
struct WireLoop {
    #[serde(default)]
    edges: Vec<Value>,
}

#[derive(Deserialize)]
struct WireEdge {
    #[serde(default)]
    start: Option<usize>,
    #[serde(default)]
    end: Option<usize>,
    #[serde(default)]
    curve: Option<Value>,
    #[serde(default)]
    t: Option<Value>,
}

impl BrepRenderData {
    pub fn from_extension(extension: &Value) -> Result<Self, BrepRenderError> {
        let wire: WireBrep = serde_json::from_value(extension.clone())?;
        let vertices = wire
            .vertices
            .into_iter()
            .map(Vec3::from_array)
            .collect::<Vec<_>>();
        let mut edges = Vec::with_capacity(wire.edges.len());
        let mut edge_vertices = Vec::with_capacity(wire.edges.len());
        let mut edge_polylines = Vec::with_capacity(wire.edges.len());
        let mut curved_edges = Vec::with_capacity(wire.edges.len());
        for (index, edge) in wire.edges.into_iter().enumerate() {
            let curve = edge
                .curve
                .as_ref()
                .and_then(curve_reference_index)
                .and_then(|curve| wire.curves3_d.get(curve));
            let resolve_vertex = |vertex: Option<usize>| {
                vertex
                    .map(|vertex| {
                        vertices
                            .get(vertex)
                            .copied()
                            .ok_or(BrepRenderError::MissingVertex {
                                edge: index,
                                vertex,
                            })
                    })
                    .transpose()
            };
            let start = resolve_vertex(edge.start)?;
            let end = resolve_vertex(edge.end)?;
            let polyline = sample_edge_curve(start, end, curve, edge.t.as_ref());
            let rendered_start = polyline
                .first()
                .copied()
                .or(start)
                .or(end)
                .unwrap_or(Vec3::ZERO);
            let rendered_end = polyline
                .last()
                .copied()
                .or(end)
                .or(start)
                .unwrap_or(Vec3::ZERO);
            edges.push([rendered_start, rendered_end]);
            edge_vertices.push([
                edge.start.unwrap_or(usize::MAX),
                edge.end.unwrap_or(usize::MAX),
            ]);
            curved_edges.push(curve.is_some_and(|curve| {
                !matches!(
                    curve.get("type").and_then(Value::as_str),
                    None | Some("line")
                )
            }));
            edge_polylines.push(polyline);
        }

        let vertex_radius = if vertices.is_empty() {
            0.0
        } else {
            let minimum = vertices
                .iter()
                .copied()
                .fold(Vec3::splat(f32::INFINITY), Vec3::min);
            let maximum = vertices
                .iter()
                .copied()
                .fold(Vec3::splat(f32::NEG_INFINITY), Vec3::max);
            ((maximum - minimum).length() * 0.0125).max(1.0e-7)
        };
        let face_edges = wire
            .faces
            .iter()
            .map(|face| {
                face.loops
                    .iter()
                    .filter_map(|reference| reference.first().and_then(curve_reference_index))
                    .filter_map(|index| wire.loops.get(index))
                    .flat_map(|wire_loop| &wire_loop.edges)
                    .filter_map(curve_reference_index)
                    .collect::<Vec<_>>()
            })
            .collect::<Vec<_>>();

        let mut result = Self {
            vertices,
            edges,
            edge_vertices,
            edge_polylines,
            curved_edges,
            face_count: face_edges.len(),
            face_edges,
            vertex_radius,
        };
        result.scale_world(WORLD_SCALE);
        Ok(result)
    }

    fn scale_world(&mut self, scale: f32) {
        for vertex in &mut self.vertices {
            *vertex *= scale;
        }
        for edge in &mut self.edges {
            edge[0] *= scale;
            edge[1] *= scale;
        }
        for polyline in &mut self.edge_polylines {
            for point in polyline {
                *point *= scale;
            }
        }
        self.vertex_radius *= scale;
    }
}

fn curve_reference_index(value: &Value) -> Option<usize> {
    value
        .as_u64()
        .map(|index| index as usize)
        .or_else(|| value.as_array()?.first().and_then(curve_reference_index))
        .or_else(|| {
            value
                .get("index")
                .or_else(|| value.get("curve"))
                .and_then(curve_reference_index)
        })
}

fn sample_edge_curve(
    start: Option<Vec3>,
    end: Option<Vec3>,
    curve: Option<&Value>,
    edge_domain: Option<&Value>,
) -> Vec<Vec3> {
    let endpoints = || start.into_iter().chain(end).collect::<Vec<_>>();
    let Some(curve) = curve else {
        return endpoints();
    };
    let curve_type = curve.get("type").and_then(Value::as_str).unwrap_or("");
    let domain = parameter_domain(edge_domain)
        .or_else(|| parameter_domain(curve.get("domain")))
        .unwrap_or(match curve_type {
            "circle" => (0.0, std::f32::consts::TAU),
            _ => (0.0, 1.0),
        });
    match curve_type {
        "circle" => {
            sample_circle(curve.get("circle").unwrap_or(curve), domain).unwrap_or_else(endpoints)
        }
        "nurbs" => {
            sample_nurbs(curve.get("nurbs").unwrap_or(curve), domain).unwrap_or_else(endpoints)
        }
        _ => endpoints(),
    }
}

fn parameter_domain(value: Option<&Value>) -> Option<(f32, f32)> {
    let value = value?;
    if let Some(values) = value.as_array()
        && values.len() >= 2
    {
        return Some((values[0].as_f64()? as f32, values[1].as_f64()? as f32));
    }
    Some((
        value.get("min")?.as_f64()? as f32,
        value.get("max")?.as_f64()? as f32,
    ))
}

fn vec3_field(value: &Value, name: &str) -> Option<Vec3> {
    let values = value.get(name)?.as_array()?;
    Some(Vec3::new(
        values.first()?.as_f64()? as f32,
        values.get(1)?.as_f64()? as f32,
        values.get(2)?.as_f64()? as f32,
    ))
}

fn sample_circle(circle: &Value, mut domain: (f32, f32)) -> Option<Vec<Vec3>> {
    let origin = vec3_field(circle, "origin").or_else(|| vec3_field(circle, "center"))?;
    let x_basis = vec3_field(circle, "xbasis")
        .or_else(|| vec3_field(circle, "xBasis"))
        .or_else(|| vec3_field(circle, "xAxis"))?
        .normalize_or_zero();
    let y_basis = vec3_field(circle, "yAxis")
        .or_else(|| vec3_field(circle, "yBasis"))
        .map(Vec3::normalize_or_zero)
        .or_else(|| {
            vec3_field(circle, "normal").map(|normal| {
                normal
                    .normalize_or_zero()
                    .cross(x_basis)
                    .normalize_or_zero()
            })
        })?;
    let radius = circle.get("radius")?.as_f64()? as f32;
    if domain.0.abs().max(domain.1.abs()) > std::f32::consts::TAU * 1.5 {
        domain.0 = domain.0.to_radians();
        domain.1 = domain.1.to_radians();
    }
    let sweep = domain.1 - domain.0;
    let count = circle_segment_count(radius, sweep);
    Some(
        (0..=count)
            .map(|step| {
                let angle = domain.0.lerp(domain.1, step as f32 / count as f32);
                origin + radius * (x_basis * angle.cos() + y_basis * angle.sin())
            })
            .collect(),
    )
}

fn circle_segment_count(radius: f32, sweep: f32) -> usize {
    let radius = radius.abs();
    let sweep = sweep.abs();
    if radius <= f32::EPSILON || sweep <= f32::EPSILON {
        return MIN_CURVE_SEGMENTS;
    }
    let raw_error = CURVE_CHORD_ERROR / WORLD_SCALE;
    let max_angle = if raw_error >= radius {
        std::f32::consts::PI
    } else {
        2.0 * (1.0 - raw_error / radius).clamp(-1.0, 1.0).acos()
    };
    let minimum = if sweep >= std::f32::consts::TAU * 0.99 {
        MIN_CLOSED_CURVE_SEGMENTS
    } else {
        MIN_CURVE_SEGMENTS
    };
    ((sweep / max_angle.max(1.0e-6)).ceil() as usize).clamp(minimum, MAX_CURVE_SEGMENTS)
}

fn sample_nurbs(nurbs: &Value, domain: (f32, f32)) -> Option<Vec<Vec3>> {
    let control_points = nurbs
        .get("controlPoints")
        .or_else(|| nurbs.get("control_points"))?
        .as_array()?;
    let points = control_points
        .iter()
        .map(|point| {
            let values = point.as_array()?;
            Some((
                Vec3::new(
                    values.first()?.as_f64()? as f32,
                    values.get(1)?.as_f64()? as f32,
                    values.get(2)?.as_f64()? as f32,
                ),
                values.get(3).and_then(Value::as_f64).unwrap_or(1.0) as f32,
            ))
        })
        .collect::<Option<Vec<_>>>()?;
    let knots = nurbs
        .get("knotVector")
        .or_else(|| nurbs.get("knots"))?
        .as_array()?
        .iter()
        .map(|knot| Some(knot.as_f64()? as f32))
        .collect::<Option<Vec<_>>>()?;
    let order = nurbs.get("order")?.as_u64()? as usize;
    if order == 0 || knots.len() < points.len() + order {
        return None;
    }
    let knot_domain = (knots[order - 1], knots[points.len()]);
    let domain = if domain == (0.0, 1.0) {
        knot_domain
    } else {
        domain
    };
    let start = evaluate_nurbs(&points, &knots, order - 1, domain.0)?;
    let end = evaluate_nurbs(&points, &knots, order - 1, domain.1)?;
    let mut samples = vec![start];
    subdivide_nurbs(
        &points,
        &knots,
        order - 1,
        (domain.0, start),
        (domain.1, end),
        0,
        &mut samples,
    )?;
    if samples.len() > MAX_CURVE_SEGMENTS + 1 {
        samples = (0..=MAX_CURVE_SEGMENTS)
            .filter_map(|step| {
                let t = step as f32 / MAX_CURVE_SEGMENTS as f32;
                evaluate_nurbs(&points, &knots, order - 1, domain.0.lerp(domain.1, t))
            })
            .collect();
    }
    Some(samples)
}

fn subdivide_nurbs(
    points: &[(Vec3, f32)],
    knots: &[f32],
    degree: usize,
    start: (f32, Vec3),
    end: (f32, Vec3),
    depth: usize,
    samples: &mut Vec<Vec3>,
) -> Option<()> {
    let (start_t, start_point) = start;
    let (end_t, end_point) = end;
    let quarter_t = start_t.lerp(end_t, 0.25);
    let midpoint_t = start_t.lerp(end_t, 0.5);
    let three_quarter_t = start_t.lerp(end_t, 0.75);
    let quarter = evaluate_nurbs(points, knots, degree, quarter_t)?;
    let midpoint = evaluate_nurbs(points, knots, degree, midpoint_t)?;
    let three_quarter = evaluate_nurbs(points, knots, degree, three_quarter_t)?;
    let chord_error = [quarter, midpoint, three_quarter]
        .into_iter()
        .map(|point| distance_to_segment(point, start_point, end_point))
        .fold(0.0, f32::max);
    if chord_error <= CURVE_CHORD_ERROR / WORLD_SCALE || depth >= MAX_NURBS_SUBDIVISION_DEPTH {
        samples.push(end_point);
        return Some(());
    }
    subdivide_nurbs(
        points,
        knots,
        degree,
        start,
        (midpoint_t, midpoint),
        depth + 1,
        samples,
    )?;
    subdivide_nurbs(
        points,
        knots,
        degree,
        (midpoint_t, midpoint),
        end,
        depth + 1,
        samples,
    )
}

fn distance_to_segment(point: Vec3, start: Vec3, end: Vec3) -> f32 {
    let segment = end - start;
    let length_squared = segment.length_squared();
    if length_squared <= f32::MIN_POSITIVE {
        return point.distance(start);
    }
    let t = ((point - start).dot(segment) / length_squared).clamp(0.0, 1.0);
    point.distance(start + segment * t)
}

fn evaluate_nurbs(
    points: &[(Vec3, f32)],
    knots: &[f32],
    degree: usize,
    parameter: f32,
) -> Option<Vec3> {
    let end = knots[points.len()];
    let mut weighted = Vec3::ZERO;
    let mut weight_sum = 0.0;
    for (index, (point, weight)) in points.iter().enumerate() {
        let basis = bspline_basis(index, degree, parameter, knots, end);
        weighted += *point * (*weight * basis);
        weight_sum += *weight * basis;
    }
    (weight_sum.abs() > f32::EPSILON).then_some(weighted / weight_sum)
}

fn bspline_basis(index: usize, degree: usize, t: f32, knots: &[f32], end: f32) -> f32 {
    if degree == 0 {
        return ((knots[index] <= t && t < knots[index + 1])
            || (t == end && knots[index + 1] == end && knots[index] < end)) as u8
            as f32;
    }
    let left_denominator = knots[index + degree] - knots[index];
    let right_denominator = knots[index + degree + 1] - knots[index + 1];
    let left = if left_denominator.abs() > f32::EPSILON {
        (t - knots[index]) / left_denominator * bspline_basis(index, degree - 1, t, knots, end)
    } else {
        0.0
    };
    let right = if right_denominator.abs() > f32::EPSILON {
        (knots[index + degree + 1] - t) / right_denominator
            * bspline_basis(index + 1, degree - 1, t, knots, end)
    } else {
        0.0
    };
    left + right
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn builds_edges_and_face_relationships() {
        let extension = json!({
            "vertices": [[0.0, 0.0, 0.0], [0.005, 0.0, 0.0]],
            "edges": [{"start": 0, "end": 1}],
            "loops": [{"edges": [[0, 1]]}],
            "faces": [{"loops": [[0, 1]]}, {}]
        });
        let data = BrepRenderData::from_extension(&extension).unwrap();
        assert_eq!(data.edges, vec![[Vec3::ZERO, Vec3::X * 5.0]]);
        assert_eq!(data.face_edges, vec![vec![0], vec![]]);
    }

    #[test]
    fn rejects_missing_vertices() {
        let extension = json!({
            "vertices": [[0.0, 0.0, 0.0]],
            "edges": [{"start": 0, "end": 4}]
        });
        assert!(matches!(
            BrepRenderData::from_extension(&extension),
            Err(BrepRenderError::MissingVertex { vertex: 4, .. })
        ));
    }

    #[test]
    fn samples_circle_and_nurbs_curves() {
        assert!(circle_segment_count(0.001, std::f32::consts::TAU) > MIN_CURVE_SEGMENTS);
        let nurbs = json!({
            "controlPoints": [[0.0, 0.0, 0.0, 1.0], [0.005, 0.01, 0.0, 1.0], [0.01, 0.0, 0.0, 1.0]],
            "knotVector": [0.0, 0.0, 0.0, 1.0, 1.0, 1.0],
            "order": 3
        });
        assert!(sample_nurbs(&nurbs, (0.0, 1.0)).unwrap().len() > 2);
    }
}
