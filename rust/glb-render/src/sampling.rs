use bevy_math::Vec3;
use gltf::kittycad_boundary_representation::Endpoints;
use gltf::kittycad_boundary_representation::curve::Curve3d;
use gltf::kittycad_boundary_representation::curve::Geometry3d;
use gltf::kittycad_boundary_representation::curve::Nurbs3d;

/// Zoo exports geometry in metres. One displayed millimetre occupies one world unit.
const WORLD_SCALE: f32 = 1_000.0;
const CURVE_CHORD_ERROR: f32 = 0.002;
const MIN_CURVE_SEGMENTS: usize = 2;
const MIN_CLOSED_CURVE_SEGMENTS: usize = 8;
const MAX_CURVE_SEGMENTS: usize = 512;
const MAX_NURBS_SUBDIVISION_DEPTH: usize = 10;

#[derive(Default)]
pub(super) struct BrepRenderData {
    pub edge_polylines: Vec<Vec<Vec3>>,
}

impl BrepRenderData {
    /// The document must have passed glTF validation before following topology references.
    pub fn from_document(document: &gltf::Document) -> Result<Self, String> {
        let edges = document
            .edges()
            .ok_or_else(|| "GLB does not contain `KITTYCAD_boundary_representation`".to_string())?;
        let edge_polylines = edges
            .map(|edge| sample_edge(&edge).map_err(|error| format!("edge {}: {error}", edge.index())))
            .collect::<Result<_, _>>()?;
        Ok(Self { edge_polylines })
    }
}

fn world_point(point: [f64; 3]) -> Result<Vec3, String> {
    let point = Vec3::from_array(point.map(|coordinate| coordinate as f32)) * WORLD_SCALE;
    if point.is_finite() {
        Ok(point)
    } else {
        Err("curve produced a non-finite position".into())
    }
}

fn sample_edge(edge: &gltf::Edge<'_>) -> Result<Vec<Vec3>, String> {
    let (curve, orientation) = edge.curve();
    let interval = edge.t();
    let domain = (interval.min(), interval.max());
    if !domain.0.is_finite() || !domain.1.is_finite() {
        return Err("non-finite curve parameter interval".into());
    }
    let evaluate = |t| world_point(curve.evaluate(t));
    let mut samples = match curve.geometry() {
        Geometry3d::Line(_) => {
            // Use the topology's exact endpoints for straight edges.
            return match edge.endpoints() {
                Endpoints::Open { start, end } => {
                    Ok(vec![world_point(start.position())?, world_point(end.position())?])
                }
                Endpoints::Closed => Ok(vec![evaluate(domain.0)?, evaluate(domain.1)?]),
            };
        }
        Geometry3d::Circle(circle) => {
            let count = circle_segment_count(circle.radius(), domain.1 - domain.0);
            sample_uniformly(&curve, domain, count)?
        }
        Geometry3d::Nurbs(nurbs) => {
            validate_nurbs(&nurbs, domain)?;
            let start = evaluate(domain.0)?;
            let end = evaluate(domain.1)?;
            let mut samples = vec![start];
            subdivide_nurbs(&curve, (domain.0, start), (domain.1, end), 0, &mut samples)?;
            if samples.len() > MAX_CURVE_SEGMENTS + 1 {
                samples = sample_uniformly(&curve, domain, MAX_CURVE_SEGMENTS)?;
            }
            samples
        }
    };
    if orientation.is_reverse() {
        samples.reverse();
    }
    Ok(samples)
}

fn sample_uniformly(curve: &Curve3d<'_>, domain: (f64, f64), count: usize) -> Result<Vec<Vec3>, String> {
    (0..=count)
        .map(|step| world_point(curve.evaluate(lerp(domain.0, domain.1, step as f64 / count as f64))))
        .collect()
}

fn lerp(start: f64, end: f64, t: f64) -> f64 {
    (1.0 - t) * start + t * end
}

fn circle_segment_count(radius: f64, sweep: f64) -> usize {
    let radius = radius.abs();
    let sweep = sweep.abs();
    if radius <= f64::EPSILON || sweep <= f64::EPSILON {
        return MIN_CURVE_SEGMENTS;
    }
    let raw_error = f64::from(CURVE_CHORD_ERROR / WORLD_SCALE);
    let max_angle = if raw_error >= radius {
        std::f64::consts::PI
    } else {
        2.0 * (1.0 - raw_error / radius).clamp(-1.0, 1.0).acos()
    };
    let minimum = if sweep >= std::f64::consts::TAU * 0.99 {
        MIN_CLOSED_CURVE_SEGMENTS
    } else {
        MIN_CURVE_SEGMENTS
    };
    ((sweep / max_angle.max(1.0e-6)).ceil() as usize).clamp(minimum, MAX_CURVE_SEGMENTS)
}

fn validate_nurbs(nurbs: &Nurbs3d<'_>, domain: (f64, f64)) -> Result<(), String> {
    // The fork validates references and weight counts, but its evaluator assumes
    // a usable order and knot vector. Check those before entering the evaluator.
    let order = nurbs.order() as usize;
    let points = nurbs.control_points();
    let knots = nurbs.knot_vector();
    if order < 2 || order > points.len() || knots.len() != points.len() + order {
        return Err("invalid NURBS order or knot count".into());
    }
    if knots.iter().any(|knot| !knot.is_finite()) || knots.windows(2).any(|pair| pair[0] > pair[1]) {
        return Err("NURBS knots must be finite and nondecreasing".into());
    }
    let minimum = knots[order - 1];
    let maximum = knots[points.len()];
    if minimum >= maximum || domain.0.min(domain.1) < minimum || domain.0.max(domain.1) > maximum {
        return Err("curve parameter interval is outside the NURBS knot domain".into());
    }
    Ok(())
}

fn subdivide_nurbs(
    curve: &Curve3d<'_>,
    start: (f64, Vec3),
    end: (f64, Vec3),
    depth: usize,
    samples: &mut Vec<Vec3>,
) -> Result<(), String> {
    let (start_t, start_point) = start;
    let (end_t, end_point) = end;
    let midpoint_t = lerp(start_t, end_t, 0.5);
    let quarter = world_point(curve.evaluate(lerp(start_t, end_t, 0.25)))?;
    let midpoint = world_point(curve.evaluate(midpoint_t))?;
    let three_quarter = world_point(curve.evaluate(lerp(start_t, end_t, 0.75)))?;
    let chord_error = [quarter, midpoint, three_quarter]
        .into_iter()
        .map(|point| distance_to_segment(point, start_point, end_point))
        .fold(0.0, f32::max);
    if chord_error <= CURVE_CHORD_ERROR || depth >= MAX_NURBS_SUBDIVISION_DEPTH {
        samples.push(end_point);
        return Ok(());
    }
    subdivide_nurbs(curve, start, (midpoint_t, midpoint), depth + 1, samples)?;
    subdivide_nurbs(curve, (midpoint_t, midpoint), end, depth + 1, samples)
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

#[cfg(test)]
mod tests {
    use serde_json::Value;
    use serde_json::json;

    use super::*;

    fn sample(extension: Value) -> Result<BrepRenderData, String> {
        let bytes = serde_json::to_vec(&json!({
            "asset": {"version": "2.0"},
            "extensions": {"KITTYCAD_boundary_representation": extension},
            "extensionsUsed": ["KITTYCAD_boundary_representation"],
            "extensionsRequired": ["KITTYCAD_boundary_representation"]
        }))
        .unwrap();
        let gltf = gltf::Gltf::from_slice(&bytes).map_err(|error| error.to_string())?;
        BrepRenderData::from_document(&gltf.document)
    }

    fn line() -> Value {
        json!({
            "vertices": [[0, 0, 0], [0.005, 0, 0]],
            "edges": [{"curve": [0, 1], "start": 0, "end": 1, "t": [0, 0.005]}],
            "curves3D": [{"type": "line", "line": {"direction": [1, 0, 0]}}]
        })
    }

    #[test]
    fn scales_line_endpoints() {
        assert_eq!(
            sample(line()).unwrap().edge_polylines,
            vec![vec![Vec3::ZERO, Vec3::X * 5.0]]
        );
    }

    #[test]
    fn rejects_missing_topology_references() {
        let mut extension = line();
        extension["edges"][0]["end"] = json!(4);
        assert!(sample(extension).is_err());
        let mut extension = line();
        extension["edges"][0]["curve"] = json!([4, 1]);
        assert!(sample(extension).is_err());
        let mut extension = line();
        extension["edges"][0].as_object_mut().unwrap().remove("start");
        assert!(sample(extension).is_err());
    }

    #[test]
    fn samples_closed_circle_and_reversed_arc() {
        let mut extension = json!({
            "edges": [{"curve": [0, 1], "closed": true, "t": [0, std::f64::consts::TAU]}],
            "curves3D": [{"type": "circle", "circle": {"radius": 0.01}}]
        });
        let data = sample(extension.clone()).unwrap();
        let points = &data.edge_polylines[0];
        assert!(points.len() > MIN_CLOSED_CURVE_SEGMENTS);
        assert!(points.len() <= MAX_CURVE_SEGMENTS + 1);
        assert!(points.first().unwrap().distance(*points.last().unwrap()) < 1.0e-5);
        for pair in points.windows(2) {
            assert!(10.0 - ((pair[0] + pair[1]) * 0.5).length() <= CURVE_CHORD_ERROR * 1.01);
        }
        extension["edges"][0] = json!({"curve": [0, -1], "start": 0, "end": 1, "t": [0, std::f64::consts::FRAC_PI_2]});
        extension["vertices"] = json!([[0, 0.01, 0], [0.01, 0, 0]]);
        let data = sample(extension).unwrap();
        let points = &data.edge_polylines[0];
        assert!(points.first().unwrap().distance(Vec3::Y * 10.0) < 1.0e-5);
        assert!(points.last().unwrap().distance(Vec3::X * 10.0) < 1.0e-5);
    }

    fn nurbs() -> Value {
        json!({
            "vertices": [[0.01, 0, 0], [0, 0.01, 0]],
            "edges": [{"curve": [0, 1], "start": 0, "end": 1, "t": [0, 1]}],
            "curves3D": [{"type": "nurbs", "nurbs": {
                "controlPoints": [[0.01, 0, 0], [0.01, 0.01, 0], [0, 0.01, 0]],
                "weights": [1, std::f64::consts::FRAC_1_SQRT_2, 1],
                "knotVector": [0, 0, 0, 1, 1, 1], "order": 3
            }}]
        })
    }

    #[test]
    fn samples_rational_nurbs_and_preserves_trim_interval() {
        let mut extension = nurbs();
        let data = sample(extension.clone()).unwrap();
        let points = &data.edge_polylines[0];
        assert!(points.len() > 2 && points.len() <= MAX_CURVE_SEGMENTS + 1);
        assert!(points.iter().all(|point| (point.length() - 10.0).abs() < 1.0e-5));
        extension["edges"][0]["t"] = json!([0.25, 0.75]);
        let data = sample(extension).unwrap();
        let points = &data.edge_polylines[0];
        assert!(points.first().unwrap().distance(Vec3::new(9.297883, 3.680947, 0.0)) < 1.0e-4);
        assert!(points.last().unwrap().distance(Vec3::new(3.680947, 9.297883, 0.0)) < 1.0e-4);
    }

    #[test]
    fn rejects_invalid_nurbs_before_evaluation() {
        for (field, value) in [
            ("order", json!(0)),
            ("order", json!(8)),
            ("knotVector", json!([0, 1])),
            ("knotVector", json!([0, 0, 0, 1, 0, 1])),
            ("weights", json!([1])),
        ] {
            let mut extension = nurbs();
            extension["curves3D"][0]["nurbs"][field] = value;
            assert!(sample(extension).is_err(), "{field}");
        }
        let mut extension = nurbs();
        extension["edges"][0]["t"] = json!([-1, 2]);
        assert!(sample(extension).is_err());
    }
}
