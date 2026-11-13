//! Experimental, GPU-independent display tessellation of B-rep snapshots.
//! Inputs use the engine IR's surfaces, oriented faces and UV trim traces.

pub use kittycad_modeling_cmds::format::native_brep::Brep;
use kittycad_modeling_cmds::format::native_brep::Curve;
#[cfg(test)]
use kittycad_modeling_cmds::format::native_brep::Nurbs;
use kittycad_modeling_cmds::format::native_brep::Point;
pub use kittycad_modeling_cmds::format::native_brep::Snapshot;
use kittycad_modeling_cmds::format::native_brep::Surface;
use kittycad_modeling_cmds::format::native_brep::Uv;
use kittycad_modeling_cmds::format::native_brep::VERSION;
#[cfg(test)]
use serde::Deserialize;
use serde::Serialize;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FaceRange {
    face_index: usize,
    first_vertex: usize,
    vertex_count: usize,
}

#[derive(Debug)]
pub struct Mesh {
    pub positions: Vec<f32>,
    pub normals: Vec<f32>,
    pub faces: Vec<FaceRange>,
}

fn finite(values: impl IntoIterator<Item = f64>) -> Result<(), String> {
    if values.into_iter().all(f64::is_finite) {
        Ok(())
    } else {
        Err("Non-finite geometry".into())
    }
}

fn basis(knots: &[f64], count: usize, order: usize, t: f64) -> Result<Vec<f64>, String> {
    if order < 2 || order > count || count > 4096 || knots.len() != count + order {
        return Err("Invalid NURBS dimensions".into());
    }
    finite(knots.iter().copied().chain([t]))?;
    if knots.windows(2).any(|w| w[0] > w[1]) {
        return Err("Invalid knot vector".into());
    }
    let (start, end) = (knots[order - 1], knots[count]);
    let tolerance = 512.0 * f64::EPSILON * start.abs().max(end.abs()).max(1.0);
    if t < start - tolerance || t > end + tolerance {
        return Err(format!(
            "Parameter {t} outside domain [{}, {}]",
            knots[order - 1],
            knots[count]
        ));
    }
    // Native trim evaluation can land a few ulps outside a surface knot domain.
    let t = t.clamp(start, end);
    let mut b = vec![0.0; count + order - 1];
    let at_end = t == knots[count];
    for i in 0..b.len() {
        if (at_end && i == count - 1) || (!at_end && knots[i] <= t && t < knots[i + 1]) {
            b[i] = 1.0;
        }
    }
    for degree in 1..order {
        for i in 0..b.len() - degree {
            let left = knots[i + degree] - knots[i];
            let right = knots[i + degree + 1] - knots[i + 1];
            b[i] = if left > 0.0 { (t - knots[i]) / left * b[i] } else { 0.0 }
                + if right > 0.0 {
                    (knots[i + degree + 1] - t) / right * b[i + 1]
                } else {
                    0.0
                };
        }
    }
    b.truncate(count);
    Ok(b)
}

fn rational(points: impl IntoIterator<Item = (Point, f64)>) -> Result<Point, String> {
    let mut sum = [0.0; 3];
    let mut weight = 0.0;
    for (p, w) in points {
        finite(p.into_iter().chain([w]))?;
        for k in 0..3 {
            sum[k] += p[k] * w;
        }
        weight += w;
    }
    // Uniform scaling of homogeneous weights does not change the geometry.
    if weight == 0.0 {
        return Err("Singular NURBS weight".into());
    }
    let p = sum.map(|x| x / weight);
    finite(p)?;
    Ok(p)
}

trait SurfaceEvaluation {
    fn is_planar(&self) -> bool;
    fn normal(&self, uv: Uv) -> Result<Point, String>;
    fn evaluate(&self, uv: Uv) -> Result<Point, String>;
}

impl SurfaceEvaluation for Surface {
    fn is_planar(&self) -> bool {
        let Self::Nurbs { nurbs } = self else { return true };
        let Some(origin) = nurbs.control_points.first() else {
            return true;
        };
        let Some(a) = nurbs
            .control_points
            .iter()
            .map(|p| std::array::from_fn::<_, 3, _>(|i| p[i] - origin[i]))
            .find(|a| a.iter().map(|x| x * x).sum::<f64>() > 1e-24)
        else {
            return true;
        };
        let normal = nurbs.control_points.iter().find_map(|p| {
            let b: Point = std::array::from_fn(|i| p[i] - origin[i]);
            let n = [
                a[1] * b[2] - a[2] * b[1],
                a[2] * b[0] - a[0] * b[2],
                a[0] * b[1] - a[1] * b[0],
            ];
            let length = n.iter().map(|x| x * x).sum::<f64>().sqrt();
            (length > 1e-18).then(|| n.map(|x| x / length))
        });
        normal.is_none_or(|n| {
            nurbs
                .control_points
                .iter()
                .all(|p| (0..3).map(|i| (p[i] - origin[i]) * n[i]).sum::<f64>().abs() < 1e-10)
        })
    }

    fn normal(&self, uv: Uv) -> Result<Point, String> {
        let (du, dv) = match self {
            Self::Plane { plane } => (plane.x_axis, plane.y_axis),
            Self::Nurbs { nurbs: n } => {
                let mut tangents = [[0.0; 3]; 2];
                for (axis, tangent) in tangents.iter_mut().enumerate() {
                    let offset = if axis == 0 { 0 } else { n.num_knots[0] };
                    let min = n.knot_vector[offset + n.order[axis] - 1];
                    let max = n.knot_vector[offset + n.num_control_points[axis]];
                    let step = (max - min) * 1e-6;
                    let mut a = uv;
                    let mut b = uv;
                    a[axis] = (uv[axis] - step).max(min);
                    b[axis] = (uv[axis] + step).min(max);
                    let pa = self.evaluate(a)?;
                    let pb = self.evaluate(b)?;
                    *tangent = std::array::from_fn(|k| pb[k] - pa[k]);
                }
                (tangents[0], tangents[1])
            }
        };
        let cross = [
            du[1] * dv[2] - du[2] * dv[1],
            du[2] * dv[0] - du[0] * dv[2],
            du[0] * dv[1] - du[1] * dv[0],
        ];
        let length = cross.iter().map(|x| x * x).sum::<f64>().sqrt();
        if length < 1e-20 {
            return Err("Degenerate surface normal".into());
        }
        Ok(cross.map(|x| x / length))
    }

    fn evaluate(&self, uv: Uv) -> Result<Point, String> {
        match self {
            Self::Plane { plane } => {
                let p = std::array::from_fn(|k| plane.origin[k] + uv[0] * plane.x_axis[k] + uv[1] * plane.y_axis[k]);
                finite(p)?;
                Ok(p)
            }
            Self::Nurbs { nurbs: n } => {
                let [nu, nv] = n.num_control_points;
                let [ku, kv] = n.num_knots;
                if nu.checked_mul(nv) != Some(n.control_points.len())
                    || ku.checked_add(kv) != Some(n.knot_vector.len())
                    || (!n.weights.is_empty() && n.weights.len() != n.control_points.len())
                    || ku > n.knot_vector.len()
                {
                    return Err("Invalid surface control net".into());
                }
                let u = basis(&n.knot_vector[..ku], nu, n.order[0], uv[0])?;
                let v = basis(&n.knot_vector[ku..], nv, n.order[1], uv[1])?;
                rational(u.iter().enumerate().filter(|(_, b)| **b != 0.0).flat_map(|(i, a)| {
                    v.iter().enumerate().filter(|(_, b)| **b != 0.0).map(move |(j, b)| {
                        let index = i * nv + j;
                        (
                            n.control_points[index],
                            a * b * n.weights.get(index).copied().unwrap_or(1.0),
                        )
                    })
                }))
            }
        }
    }
}

trait CurveEvaluation {
    fn sample(&self, interval: [f64; 2], reverse: bool) -> Result<Vec<Uv>, String>;
    fn evaluate(&self, t: f64) -> Result<Uv, String>;
}

impl CurveEvaluation for Curve {
    fn sample(&self, interval: [f64; 2], reverse: bool) -> Result<Vec<Uv>, String> {
        let linear = matches!(self, Self::Line { .. })
            || matches!(self, Self::Nurbs { nurbs } if nurbs.order == 2 && nurbs.control_points.len() == 2);
        let segments = if linear { 1 } else { 32 };
        let mut parameters: Vec<f64> = (0..=segments)
            .map(|i| interval[0] + (interval[1] - interval[0]) * i as f64 / segments as f64)
            .collect();
        if let Self::Nurbs { nurbs } = self {
            // Short knot spans can contain whole corners that uniform sampling misses.
            for knots in nurbs.knot_vector.windows(2) {
                for t in [knots[0], (knots[0] + knots[1]) / 2.0] {
                    if t > interval[0] && t < interval[1] {
                        parameters.push(t);
                    }
                }
            }
        }
        parameters.sort_by(f64::total_cmp);
        parameters.dedup();
        if parameters.len() > 16_384 {
            return Err("Trim sampling budget exceeded".into());
        }
        let points = parameters
            .into_iter()
            .map(|t| self.evaluate(t))
            .collect::<Result<Vec<_>, _>>()?;
        let mut min = [f64::INFINITY; 2];
        let mut max = [f64::NEG_INFINITY; 2];
        for p in &points {
            for k in 0..2 {
                min[k] = min[k].min(p[k]);
                max[k] = max[k].max(p[k]);
            }
        }
        let tolerance2 = ((max[0] - min[0]).hypot(max[1] - min[1]) * 1e-4).max(1e-12).powi(2);
        let mut keep = vec![false; points.len()];
        let mut stack = vec![(0, points.len() - 1)];
        while let Some((start, end)) = stack.pop() {
            keep[start] = true;
            keep[end] = true;
            let a = points[start];
            let b = points[end];
            let delta = [b[0] - a[0], b[1] - a[1]];
            let length2 = delta[0] * delta[0] + delta[1] * delta[1];
            let mut farthest = (0, tolerance2);
            for (i, p) in points.iter().enumerate().take(end).skip(start + 1) {
                let t = if length2 > 0.0 {
                    (((p[0] - a[0]) * delta[0] + (p[1] - a[1]) * delta[1]) / length2).clamp(0.0, 1.0)
                } else {
                    0.0
                };
                let distance2 = (p[0] - a[0] - t * delta[0]).powi(2) + (p[1] - a[1] - t * delta[1]).powi(2);
                if distance2 > farthest.1 {
                    farthest = (i, distance2);
                }
            }
            if farthest.1 > tolerance2 {
                stack.push((start, farthest.0));
                stack.push((farthest.0, end));
            }
        }
        let mut points: Vec<_> = points
            .into_iter()
            .zip(keep)
            .filter_map(|(p, keep)| keep.then_some(p))
            .collect();
        if reverse {
            points.reverse();
        }
        // The next trace contributes the shared endpoint.
        points.pop();
        Ok(points)
    }

    fn evaluate(&self, t: f64) -> Result<Uv, String> {
        let p = match self {
            Self::Line { line } => [
                line.origin[0] + t * line.direction[0],
                line.origin[1] + t * line.direction[1],
            ],
            Self::Circle { circle } => [
                circle.origin[0] + circle.radius * (circle.x_axis[0] * t.cos() + circle.y_axis[0] * t.sin()),
                circle.origin[1] + circle.radius * (circle.x_axis[1] * t.cos() + circle.y_axis[1] * t.sin()),
            ],
            Self::Nurbs { nurbs: n } => {
                if !n.weights.is_empty() && n.weights.len() != n.control_points.len() {
                    return Err("Invalid curve weights".into());
                }
                let b = basis(&n.knot_vector, n.control_points.len(), n.order, t)?;
                let p = rational(
                    n.control_points
                        .iter()
                        .enumerate()
                        .map(|(i, p)| ([p[0], p[1], 0.0], b[i] * n.weights.get(i).copied().unwrap_or(1.0))),
                )?;
                [p[0], p[1]]
            }
        };
        finite(p)?;
        Ok(p)
    }
}

fn midpoint(a: Uv, b: Uv) -> Uv {
    [(a[0] + b[0]) / 2.0, (a[1] + b[1]) / 2.0]
}

// Quarter samples catch bends whose midpoint lies on the straight chord.
fn curved_refinement(surface: &Surface, points: &[Uv], indices: &[usize], minimum: u32) -> Result<u32, String> {
    let mut error: f64 = 0.0;
    let mut low = [f64::INFINITY; 3];
    let mut high = [f64::NEG_INFINITY; 3];
    for t in indices.as_chunks::<3>().0 {
        for (a, b) in [(t[0], t[1]), (t[1], t[2]), (t[2], t[0])] {
            let pa = surface.evaluate(points[a])?;
            let pb = surface.evaluate(points[b])?;
            for fraction in [0.0, 0.25, 0.5, 0.75, 1.0] {
                let uv = std::array::from_fn(|i| points[a][i] * (1.0 - fraction) + points[b][i] * fraction);
                let actual = surface.evaluate(uv)?;
                let mut distance = 0.0;
                for i in 0..3 {
                    low[i] = low[i].min(actual[i]);
                    high[i] = high[i].max(actual[i]);
                    distance += (actual[i] - (pa[i] * (1.0 - fraction) + pb[i] * fraction)).powi(2);
                }
                error = error.max(distance.sqrt());
            }
        }
    }
    let scale = (0..3).map(|i| (high[i] - low[i]).powi(2)).sum::<f64>().sqrt();
    // Relative face tolerance keeps this independent of model units. Smooth
    // curve chord error falls approximately fourfold per subdivision level.
    let tolerance = (scale * 0.001).max(1e-12);
    let estimated = if error > tolerance {
        (error / tolerance).log(4.0).ceil() as u32
    } else {
        0
    };
    Ok(minimum.max(estimated.min(5)))
}

fn triangle(
    surface: &Surface,
    uv: [Uv; 3],
    depth: u32,
    reverse: bool,
    circumference_intervals: u32,
    out: &mut Mesh,
) -> Result<(), String> {
    if out.positions.len() / 9 >= 200_000 {
        return Err("Display triangle budget exceeded".into());
    }
    if depth > 0 {
        let [a, b, c] = uv;
        let (ab, bc, ca) = (midpoint(a, b), midpoint(b, c), midpoint(c, a));
        for t in [[a, ab, ca], [ab, b, bc], [ca, bc, c], [ab, bc, ca]] {
            triangle(surface, t, depth - 1, reverse, circumference_intervals, out)?;
        }
        return Ok(());
    }
    // Keep circular silhouettes round even when the scene budget selects the
    // coarse fallback. Bisect only along closed parameter directions, rather
    // than multiplying axial subdivisions as uniform refinement would do.
    if let Surface::Nurbs { nurbs } = surface {
        let mut best = None;
        let mut largest = 1.0 + 1e-10;
        for (axis, closed) in nurbs.closed.iter().enumerate() {
            if !closed {
                continue;
            }
            let offset = if axis == 0 { 0 } else { nurbs.num_knots[0] };
            let Some(start) = nurbs.order[axis]
                .checked_sub(1)
                .and_then(|i| offset.checked_add(i))
                .and_then(|i| nurbs.knot_vector.get(i))
            else {
                continue;
            };
            let Some(end) = offset
                .checked_add(nurbs.num_control_points[axis])
                .and_then(|i| nurbs.knot_vector.get(i))
            else {
                continue;
            };
            let step = (end - start) / f64::from(circumference_intervals.clamp(16, 64));
            if !step.is_finite() || step <= 0.0 {
                continue;
            }
            for (a, b, c) in [(0, 1, 2), (1, 2, 0), (2, 0, 1)] {
                let ratio = (uv[a][axis] - uv[b][axis]).abs() / step;
                if ratio > largest {
                    largest = ratio;
                    best = Some((a, b, c));
                }
            }
        }
        if let Some((a, b, c)) = best {
            let m = midpoint(uv[a], uv[b]);
            triangle(surface, [uv[a], m, uv[c]], 0, reverse, circumference_intervals, out)?;
            triangle(surface, [m, uv[b], uv[c]], 0, reverse, circumference_intervals, out)?;
            return Ok(());
        }
    }
    let mut p = [
        surface.evaluate(uv[0])?,
        surface.evaluate(uv[1])?,
        surface.evaluate(uv[2])?,
    ];
    let mut uv = uv;
    if reverse {
        p.swap(1, 2);
        uv.swap(1, 2);
    }
    let a: Point = std::array::from_fn(|k| p[1][k] - p[0][k]);
    let b: Point = std::array::from_fn(|k| p[2][k] - p[0][k]);
    let n = [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ];
    let length = n.iter().map(|x| x * x).sum::<f64>().sqrt();
    if length < 1e-20 {
        return Ok(());
    }
    for (vertex, point) in p.into_iter().enumerate() {
        for x in point {
            let f = x as f32;
            if !f.is_finite() {
                return Err("Position exceeds display precision range".into());
            }
            out.positions.push(f);
        }
        let normal = match surface.normal(uv[vertex]) {
            Ok(normal) => normal.map(|x| if reverse { -x } else { x }),
            Err(_) => n.map(|x| x / length),
        };
        out.normals.extend(normal.map(|x| x as f32));
    }
    Ok(())
}

/// Triangulate UV trim polygons and sample their surface in double precision.
/// Curved patches choose a bounded subdivision level from estimated chord error.
pub fn tessellate(snapshot: &Snapshot, refinement: u32) -> Result<Mesh, String> {
    tessellate_with_budget(snapshot, refinement, 150_000)
}

fn tessellate_with_budget(snapshot: &Snapshot, refinement: u32, smoothing_budget: usize) -> Result<Mesh, String> {
    tessellate_limited(snapshot, refinement, smoothing_budget, 5, 32)
}

fn tessellate_limited(
    snapshot: &Snapshot,
    refinement: u32,
    smoothing_budget: usize,
    max_subdivision: u32,
    circumference_intervals: u32,
) -> Result<Mesh, String> {
    if snapshot.version != VERSION || refinement > 5 || snapshot.brep.faces.len() > 10_000 {
        return Err("Unsupported snapshot version or tessellation budget".into());
    }
    let brep = &snapshot.brep;
    let mut out = Mesh {
        positions: vec![],
        normals: vec![],
        faces: vec![],
    };
    for (face_index, face) in brep.faces.iter().enumerate() {
        let surface = brep.surfaces.get(face.surface.0).ok_or("Missing face surface")?;
        // The corners of a periodic UV patch can coincide in 3D. Sampling only
        // those corners collapses cylinders and tubes to zero-area triangles.
        let refinement = match surface {
            Surface::Nurbs { nurbs } if nurbs.closed.iter().any(|closed| *closed) => refinement.max(3),
            _ if !surface.is_planar() => refinement.max(2),
            _ => refinement,
        };
        let mut points = Vec::<Uv>::new();
        let mut holes = vec![];
        for (i, &(index, orientation)) in face.loops.iter().enumerate() {
            if orientation != 1 && orientation != -1 {
                return Err("Invalid loop orientation".into());
            }
            let loop_ = brep.loops.get(index).ok_or("Missing trim loop")?;
            if loop_.traces.is_empty() {
                return Err(
                    "UV trim traces are required; 3D-edge-only exports cannot be tessellated by this prototype".into(),
                );
            }
            let mut ring = vec![];
            for trace in &loop_.traces {
                let curve = brep.curves2d.get(trace.curve.0).ok_or("Missing trim curve")?;
                if trace.curve.1 != 1 && trace.curve.1 != -1 {
                    return Err("Invalid trace orientation".into());
                }
                ring.extend(curve.sample(trace.t, trace.curve.1 < 0)?);
            }
            if orientation < 0 {
                ring.reverse();
            }
            if ring.len() < 3 {
                return Err("Trim loop has fewer than three points".into());
            }
            if i > 0 {
                holes.push(points.len());
            }
            points.extend(ring);
        }
        if points.len() < 3 || points.len() > 100_000 {
            return Err("Invalid trim polygon size".into());
        }
        let flat: Vec<f64> = points.iter().flat_map(|p| *p).collect();
        let indices = earcutr::earcut(&flat, &holes, 2).map_err(|e| e.to_string())?;
        let refinement = if surface.is_planar() {
            refinement
        } else {
            {
                let desired = curved_refinement(surface, &points, &indices, refinement)?;
                // Reserve a share for every face, retaining the existing floor.
                // Extra smoothness must not make previously valid previews fail.
                let share = smoothing_budget / brep.faces.len().max(1);
                let base = indices.len() / 3;
                let mut affordable = refinement;
                while affordable < desired && base.saturating_mul(4usize.pow(affordable + 1)) <= share {
                    affordable += 1;
                }
                affordable
            }
        };
        let mut refinement = refinement.min(max_subdivision.clamp(2, 5));
        if max_subdivision == 2
            && let Surface::Nurbs { nurbs } = surface
        {
            // Cylinders and straight ruled annuli need circumferential
            // samples, but no interior samples along their straight axis.
            let straight_other_axis = (0..2).any(|axis| {
                nurbs.closed[axis] && nurbs.order[1 - axis] == 2 && nurbs.num_control_points[1 - axis] == 2
            });
            if straight_other_axis {
                refinement = 0;
            }
        }
        let first_vertex = out.positions.len() / 3;
        for t in indices.as_chunks::<3>().0 {
            triangle(
                surface,
                [points[t[0]], points[t[1]], points[t[2]]],
                refinement,
                face.surface.1 < 0,
                circumference_intervals,
                &mut out,
            )?;
        }
        out.faces.push(FaceRange {
            face_index,
            first_vertex,
            vertex_count: out.positions.len() / 3 - first_vertex,
        });
    }
    if !out.positions.iter().chain(&out.normals).all(|value| value.is_finite()) {
        return Err("Geometry exceeds finite display coordinates".into());
    }
    Ok(out)
}

#[cfg(target_arch = "wasm32")]
mod wasm {
    use wasm_bindgen::prelude::*;

    use super::*;

    #[wasm_bindgen]
    pub struct DisplayMesh {
        mesh: Mesh,
    }

    #[wasm_bindgen]
    impl DisplayMesh {
        pub fn positions(&self) -> js_sys::Float32Array {
            js_sys::Float32Array::from(self.mesh.positions.as_slice())
        }
        pub fn normals(&self) -> js_sys::Float32Array {
            js_sys::Float32Array::from(self.mesh.normals.as_slice())
        }
        pub fn faces(&self) -> Result<String, JsValue> {
            serde_json::to_string(&self.mesh.faces).map_err(|e| JsValue::from_str(&e.to_string()))
        }
    }

    #[wasm_bindgen]
    pub fn tessellate_snapshot(
        json: &str,
        refinement: u32,
        smoothing_budget: Option<u32>,
        max_subdivision: Option<u32>,
        circumference_intervals: Option<u32>,
    ) -> Result<DisplayMesh, JsValue> {
        let snapshot: Snapshot = serde_json::from_str(json).map_err(|e| JsValue::from_str(&e.to_string()))?;
        tessellate_limited(
            &snapshot,
            refinement,
            smoothing_budget.unwrap_or(150_000) as usize,
            max_subdivision.unwrap_or(5),
            circumference_intervals.unwrap_or(32),
        )
        .map(|mesh| DisplayMesh { mesh })
        .map_err(|e| JsValue::from_str(&e))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample() -> Snapshot {
        serde_json::from_str(include_str!("../fixtures/fixture.json")).unwrap()
    }

    #[test]
    fn planar_hole_preserves_area_and_normals() {
        let mut input = sample();
        input.brep.faces.truncate(1);
        let mesh = tessellate(&input, 2).unwrap();
        let area: f64 = mesh
            .positions
            .as_chunks::<9>()
            .0
            .iter()
            .map(|p| {
                ((p[3] - p[0]) as f64 * (p[7] - p[1]) as f64 - (p[4] - p[1]) as f64 * (p[6] - p[0]) as f64).abs() / 2.0
            })
            .sum();
        assert!((area - 0.96).abs() < 1e-6, "{area}");
        assert!(mesh.normals.as_chunks::<3>().0.iter().all(|n| n[2] > 0.999));
        for p in mesh.positions.as_chunks::<9>().0.iter() {
            let x = (p[0] + p[3] + p[6]) / 3.0 + 2.0;
            let y = (p[1] + p[4] + p[7]) / 3.0;
            assert!(!(x > 0.40001 && x < 0.59999 && y > 0.40001 && y < 0.59999));
        }
    }

    #[test]
    fn rational_surface_evaluation_matches_quarter_cylinder() {
        let input = sample();
        let p = input.brep.surfaces[1].evaluate([0.5, 0.5]).unwrap();
        let r = 0.5_f64.sqrt();
        assert!((p[0] - (1.5 + r)).abs() < 1e-12);
        assert!((p[1] - r).abs() < 1e-12);
        assert!((p[2] - 1.0).abs() < 1e-12);
        assert_eq!(input.brep.surfaces[1].evaluate([1.0, 1.0]).unwrap(), [1.5, 1.0, 2.0]);
        let normal = input.brep.surfaces[1].normal([0.5, 0.5]).unwrap();
        assert!((normal[0] - r).abs() < 1e-8 && (normal[1] - r).abs() < 1e-8);
        let mesh = tessellate(&input, 3).unwrap();
        for p in mesh.positions[mesh.faces[1].first_vertex * 3..]
            .as_chunks::<3>()
            .0
            .iter()
        {
            let radius = ((p[0] as f64 - 1.5).powi(2) + (p[1] as f64).powi(2)).sqrt();
            assert!((radius - 1.0).abs() < 1e-6);
        }
    }

    #[test]
    fn rejects_missing_traces_and_bad_control_net_without_panicking() {
        let mut input = sample();
        input.brep.loops[0].traces.clear();
        assert!(tessellate(&input, 1).unwrap_err().contains("UV trim traces"));
        let mut input = sample();
        if let Surface::Nurbs { nurbs } = &mut input.brep.surfaces[1] {
            nurbs.num_knots[0] = usize::MAX;
        }
        assert!(tessellate(&input, 1).unwrap_err().contains("control net"));
        tessellate(&sample(), 6).unwrap_err();
    }

    #[test]
    fn unclamped_curve_endpoint_preserves_finite_geometry() {
        let curve: Curve = serde_json::from_value(serde_json::json!({
            "type": "nurbs", "nurbs": {
                "controlPoints": [[0, 0.25], [0.1, 0.25], [0.2, 0.25], [0.3, 0.25]],
                "weights": [1e308, 1e308, 1e308, 1e308], "order": 3,
                "knotVector": [-2, -1, 0, 1, 2, 3, 4]
            }
        }))
        .unwrap();
        let point = curve.evaluate(2.0).unwrap();
        assert!(
            (point[0] - 0.25).abs() < 1e-12 && (point[1] - 0.25).abs() < 1e-12,
            "{point:?}"
        );
        assert_eq!(
            basis(&[-2., -1., 0., 1., 2., 3., 4.], 4, 3, 2.).unwrap(),
            vec![0., 0., 0.5, 0.5]
        );
    }

    #[test]
    fn rational_geometry_is_invariant_to_weight_scale() {
        let expected = sample().brep.surfaces[1].evaluate([0.5, 0.5]).unwrap();
        for scale in [1e-20, 1e20] {
            let mut input = sample();
            let Surface::Nurbs { nurbs } = &mut input.brep.surfaces[1] else {
                panic!("Expected NURBS");
            };
            for weight in &mut nurbs.weights {
                *weight *= scale;
            }
            let actual = input.brep.surfaces[1].evaluate([0.5, 0.5]).unwrap();
            for (a, b) in actual.into_iter().zip(expected) {
                assert!((a - b).abs() < 1e-12);
            }
            let curve: Curve = serde_json::from_value(serde_json::json!({
                "type": "nurbs", "nurbs": { "controlPoints": [[0, 0], [1, 1]],
                    "weights": [scale, scale], "order": 2, "knotVector": [0, 0, 1, 1] }
            }))
            .unwrap();
            assert_eq!(curve.evaluate(0.5).unwrap(), [0.5, 0.5]);
        }
        assert!(rational([([1., 1., 1.], 0.)]).unwrap_err().contains("Singular"));
    }

    #[test]
    fn circle_trace_preserves_its_local_axes() {
        let curve: Curve = serde_json::from_str(
            r#"{"type":"circle","circle":{"origin":[2,3],"radius":2,"xAxis":[0,1],"yAxis":[-1,0]}}"#,
        )
        .unwrap();
        assert_eq!(curve.evaluate(0.0).unwrap(), [2.0, 5.0]);
        let p = curve.evaluate(std::f64::consts::FRAC_PI_2).unwrap();
        assert!((p[0] - 0.0).abs() < 1e-12 && (p[1] - 3.0).abs() < 1e-12);
    }

    #[test]
    fn reversed_surface_flips_display_normals() {
        let mut input = sample();
        input.brep.faces.truncate(1);
        input.brep.faces[0].surface.1 = -1;
        let mesh = tessellate(&input, 0).unwrap();
        assert!(mesh.normals.as_chunks::<3>().0.iter().all(|n| n[2] < -0.999));
    }

    #[test]
    fn engine_captures_match_native_surface_samples_and_tessellate() {
        #[derive(Deserialize)]
        struct NativeSample {
            surface: usize,
            uv: Uv,
            position: Point,
        }
        for (input, oracle, faces) in [
            (
                include_str!("../fixtures/sphere-remapped.json"),
                include_str!("../fixtures/sphere-remapped-oracle.json"),
                1,
            ),
            (
                include_str!("../fixtures/arc.json"),
                include_str!("../fixtures/arc-oracle.json"),
                4,
            ),
            (
                include_str!("../fixtures/cylinder.json"),
                include_str!("../fixtures/cylinder-oracle.json"),
                8,
            ),
        ] {
            let snapshot: Snapshot = serde_json::from_str(input).unwrap();
            let oracle: Vec<NativeSample> = serde_json::from_str(oracle).unwrap();
            for sample in oracle {
                let actual = snapshot.brep.surfaces[sample.surface].evaluate(sample.uv).unwrap();
                for (actual, expected) in actual.into_iter().zip(sample.position) {
                    assert!((actual - expected).abs() < 1e-10, "{actual} != {expected}");
                }
            }
            let mesh = tessellate(&snapshot, 2).unwrap();
            assert_eq!(mesh.faces.len(), faces);
            assert!(mesh.faces.iter().all(|face| face.vertex_count > 0));
            assert!(mesh.positions.iter().chain(&mesh.normals).all(|x| x.is_finite()));
        }
    }

    #[test]
    fn shell_planes_preserve_trims_beyond_nominal_surface_domain() {
        for fixture in [
            include_str!("../fixtures/shell-plane.json"),
            include_str!("../fixtures/affine-plane.json"),
        ] {
            let scene: serde_json::Value = serde_json::from_str(fixture).unwrap();
            let input: Snapshot = serde_json::from_value(serde_json::json!({
                "version": 1, "brep": scene["bodies"][0]["brep"]
            }))
            .unwrap();
            let mesh = tessellate(&input, 0).unwrap();
            assert_eq!(mesh.faces.len(), input.brep.faces.len());
            assert!(mesh.faces.iter().all(|face| face.vertex_count > 0));
            assert!(
                mesh.positions
                    .iter()
                    .chain(&mesh.normals)
                    .all(|value| value.is_finite())
            );
        }
    }

    #[test]
    fn domain_roundoff_is_clamped_but_real_out_of_bounds_is_rejected() {
        let knots = [1.0, 1.0, 29.284271247461906, 29.284271247461906];
        assert_eq!(basis(&knots, 2, 2, 29.28427124746191).unwrap(), vec![0.0, 1.0]);
        basis(&knots, 2, 2, 29.285).unwrap_err();
        assert_eq!(
            basis(&[80.0, 80.0, 120.0, 120.0], 2, 2, 120.00000000000507).unwrap(),
            vec![0.0, 1.0]
        );
    }

    #[test]
    fn periodic_cylinder_remains_visible_at_coarsest_preview_quality() {
        let mut input = sample();
        input.brep.faces.remove(0);
        for curve in &mut input.brep.curves2d[..4] {
            if let Curve::Line { line } = curve {
                line.origin[0] *= 4.0;
                line.direction[0] *= 4.0;
            }
        }
        let circle = [
            [1., 0.],
            [1., 1.],
            [0., 1.],
            [-1., 1.],
            [-1., 0.],
            [-1., -1.],
            [0., -1.],
            [1., -1.],
            [1., 0.],
        ];
        input.brep.surfaces[1] = Surface::Nurbs {
            nurbs: Nurbs {
                closed: [true, false],
                control_points: circle.into_iter().flat_map(|[x, y]| [[x, y, 0.], [x, y, 1.]]).collect(),
                weights: (0..9)
                    .flat_map(|i| [if i % 2 == 0 { 1. } else { 0.5_f64.sqrt() }; 2])
                    .collect(),
                knot_vector: vec![0., 0., 0., 1., 1., 2., 2., 3., 3., 4., 4., 4., 0., 0., 1., 1.],
                num_control_points: [9, 2],
                num_knots: [12, 4],
                order: [3, 2],
            },
        };
        let mesh = tessellate(&input, 0).unwrap();
        assert!(!mesh.positions.is_empty());
        for point in mesh.positions.as_chunks::<3>().0 {
            assert!((point[0].hypot(point[1]) - 1.).abs() < 1e-6);
        }
        assert!(mesh.positions.as_chunks::<3>().0.iter().any(|p| p[0] < -0.99));
        assert!(mesh.positions.as_chunks::<3>().0.iter().any(|p| p[1] < -0.99));
        // Exercise the exact budget fallback that previously produced a square.
        let coarse = tessellate_limited(&input, 0, 0, 2, 32).unwrap();
        let tight = tessellate_limited(&input, 0, 0, 2, 16).unwrap();
        for t in tight.positions.as_chunks::<9>().0 {
            let x = (t[0] + t[3] + t[6]) / 3.0;
            let y = (t[1] + t[4] + t[7]) / 3.0;
            assert!(
                x.hypot(y) > 0.98,
                "Tight scene budget must still preserve a round silhouette"
            );
        }

        for t in coarse.positions.as_chunks::<9>().0 {
            let x = (t[0] + t[3] + t[6]) / 3.0;
            let y = (t[1] + t[4] + t[7]) / 3.0;
            assert!(x.hypot(y) > 0.99, "Fallback must preserve the circular silhouette");
        }
        assert!(
            coarse.positions.len() / 9 < 1024,
            "Roundness should not require dense axial subdivision"
        );
    }

    #[test]
    fn curved_preview_stays_close_to_the_surface_between_vertices() {
        let input = sample();
        let mesh = tessellate(&input, 0).unwrap();
        let start = mesh.faces[1].first_vertex * 3;
        for triangle in mesh.positions[start..].as_chunks::<9>().0 {
            let x = (triangle[0] + triangle[3] + triangle[6]) / 3.0 - 1.5;
            let y = (triangle[1] + triangle[4] + triangle[7]) / 3.0;
            assert!(
                x.hypot(y) > 0.997,
                "A curved face must not become a chord through its body"
            );
        }
    }

    #[test]
    fn smoothing_budget_can_be_shared_without_discarding_curved_faces() {
        let input = sample();
        let coarse = tessellate_with_budget(&input, 0, 0).unwrap();
        let smooth = tessellate_with_budget(&input, 0, 150_000).unwrap();
        assert_eq!(coarse.faces.len(), smooth.faces.len());
        assert!(coarse.faces.iter().all(|face| face.vertex_count > 0));
        assert!(coarse.positions.len() < smooth.positions.len());
    }

    #[test]
    fn trim_sampling_retains_corners_in_short_knot_spans() {
        let curve: Curve = serde_json::from_str(
            r#"{"type":"nurbs","nurbs":{
            "controlPoints":[[0,0],[1,0],[1,1],[0,1]],"order":2,
            "knotVector":[0,0,0.001,0.002,1,1]}}"#,
        )
        .unwrap();
        let points = curve.sample([0., 1.], false).unwrap();
        assert!(points.iter().any(|p| (p[0] - 1.).abs() < 1e-12 && p[1].abs() < 1e-12));
        assert!(
            points
                .iter()
                .any(|p| (p[0] - 1.).abs() < 1e-12 && (p[1] - 1.).abs() < 1e-12)
        );
    }
}
