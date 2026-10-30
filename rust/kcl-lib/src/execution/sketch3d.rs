//! Constructors and constraints scoped to world-space sketch blocks.
use std::collections::HashMap;

use kcl_api::Constraint3d;
use kcl_api::Segment3d;
use kcl_api::SourceRef;
use nalgebra::Vector3;

use crate::ExecState;
use crate::KclError;
use crate::NodePathExt;
use crate::SourceRange;
use crate::errors::KclErrorDetails;
use crate::execution::KclObjectKind;
use crate::execution::KclValue;
use crate::execution::Metadata;
use crate::execution::SketchConstraint;
use crate::execution::SketchConstraintKind;
use crate::execution::UnsolvedExpr;
use crate::execution::normalize_to_solver_distance_unit;
use crate::execution::sketch3d_solver::CircularArc;
use crate::execution::sketch3d_solver::Equation;
use crate::execution::sketch3d_solver::Line;
use crate::execution::sketch3d_solver::Point;
use crate::execution::sketch3d_solver::Scalar;
use crate::execution::types::RuntimeType;
use crate::std::Args;

#[derive(Debug, Clone, Default)]
pub(crate) struct SpatialState {
    pub equations: Vec<Equation>,
    pub geometry: Vec<Geometry>,
    pub constraints: Vec<Constraint3d>,
}

#[derive(Debug, Clone)]
pub(crate) struct Geometry {
    pub label: String,
    pub kind: String,
    pub points: Vec<Point>,
    pub normal: Option<[f64; 3]>,
    pub clockwise: bool,
    pub construction: bool,
    pub source: SourceRef,
}

impl Geometry {
    pub(crate) fn solved(&self, values: &[f64], scale: f64) -> Segment3d {
        Segment3d {
            label: self.label.clone(),
            kind: self.kind.clone(),
            points: self.points.iter().map(|p| p.map(|s| s.value(values) * scale)).collect(),
            normal: self.normal,
            clockwise: self.clockwise,
            construction: self.construction,
            source: self.source.clone(),
        }
    }
}

fn error(message: impl Into<String>, range: SourceRange) -> KclError {
    KclError::new_semantic(KclErrorDetails::new(message.into(), vec![range]))
}

fn state(exec: &mut ExecState, range: SourceRange) -> Result<&mut SpatialState, KclError> {
    exec.sketch_block_mut()
        .and_then(|s| s.spatial.as_mut())
        .ok_or_else(|| error("This function requires a sketch3d block", range))
}

fn object(fields: HashMap<String, KclValue>, range: SourceRange) -> KclValue {
    KclValue::Object {
        value: fields,
        constrainable: true,
        object_kind: KclObjectKind::Default,
        meta: vec![Metadata { source_range: range }],
    }
}

fn field<'a>(value: &'a KclValue, key: &str, range: SourceRange) -> Result<&'a KclValue, KclError> {
    let KclValue::Object { value, .. } = value else {
        return Err(error("Expected 3D sketch geometry", range));
    };
    value
        .get(key)
        .ok_or_else(|| error(format!("3D geometry has no {key}"), range))
}

fn point(value: &KclValue, exec: &mut ExecState, range: SourceRange) -> Result<Point, KclError> {
    let value = if matches!(value, KclValue::Object { .. }) {
        field(value, "at", range)?
    } else {
        value
    };
    let values = value.clone().into_array();
    if values.len() != 3 {
        return Err(error("Expected a point with X, Y, and Z coordinates", range));
    }
    let mut result = [Scalar::Constant(0.0); 3];
    for (i, value) in values.iter().enumerate() {
        result[i] = match value.as_unsolved_expr() {
            Some(UnsolvedExpr::Unknown(id)) => Scalar::Variable(id.0),
            Some(UnsolvedExpr::Known(_)) => {
                let normalized = normalize_to_solver_distance_unit(value, range, exec, "3D point coordinate")?;
                let number = normalized
                    .as_ty_f64()
                    .ok_or_else(|| error("Expected a length", range))?;
                if !number.n.is_finite() {
                    return Err(error("3D coordinates must be finite", range));
                }
                Scalar::Constant(number.n)
            }
            None => return Err(error("3D coordinates must be lengths or sketch variables", range)),
        };
    }
    Ok(result)
}

fn line(value: &KclValue, exec: &mut ExecState, range: SourceRange) -> Result<Line, KclError> {
    if circular(value) {
        return Err(error("This constraint requires a straight line", range));
    }
    Ok([
        point(field(value, "start", range)?, exec, range)?,
        point(field(value, "end", range)?, exec, range)?,
    ])
}

fn radius(value: &KclValue, exec: &mut ExecState, range: SourceRange) -> Result<Line, KclError> {
    Ok([
        point(field(value, "center", range)?, exec, range)?,
        point(field(value, "start", range)?, exec, range)?,
    ])
}

fn circular(value: &KclValue) -> bool {
    matches!(value, KclValue::Object { value, .. } if value.contains_key("center"))
}

fn is_arc(value: &KclValue) -> bool {
    circular(value) && matches!(value, KclValue::Object { value, .. } if value.contains_key("end"))
}

fn arc_geometry(value: &KclValue, exec: &mut ExecState, range: SourceRange) -> Result<CircularArc, KclError> {
    let clockwise = matches!(value, KclValue::Object { value, .. } if matches!(value.get("direction"), Some(KclValue::String { value, .. }) if value.eq_ignore_ascii_case("cw")));
    Ok(CircularArc {
        start: point(field(value, "start", range)?, exec, range)?,
        end: point(field(value, "end", range)?, exec, range)?,
        center: point(field(value, "center", range)?, exec, range)?,
        normal: circle_normal(value, range)?,
        clockwise,
    })
}

fn is_point(value: &KclValue) -> bool {
    !matches!(value, KclValue::Object { value, .. } if !value.contains_key("at"))
}

fn geometry_points(value: &KclValue, exec: &mut ExecState, range: SourceRange) -> Result<Vec<Point>, KclError> {
    if is_point(value) {
        return Ok(vec![point(value, exec, range)?]);
    }
    let mut points = vec![point(field(value, "start", range)?, exec, range)?];
    if let KclValue::Object { value, .. } = value {
        if let Some(end) = value.get("end") {
            points.push(point(end, exec, range)?);
        }
        if let Some(center) = value.get("center") {
            points.push(point(center, exec, range)?);
        }
    }
    Ok(points)
}

fn circle_normal(value: &KclValue, range: SourceRange) -> Result<[f64; 3], KclError> {
    let raw = field(value, "normal", range)?.clone().into_array();
    if raw.len() != 3 {
        return Err(error("Expected a circle normal", range));
    }
    let mut out = [0.0; 3];
    for (i, n) in raw.iter().enumerate() {
        out[i] = n
            .as_ty_f64()
            .ok_or_else(|| error("A circle normal must be fixed", range))?
            .n;
    }
    let n = Vector3::from(out);
    if !n.norm().is_finite() || n.norm() < 1e-10 {
        return Err(error("Expected a nonzero normal", range));
    }
    Ok((n / n.norm()).into())
}

fn initial(p: Point, exec: &mut ExecState, range: SourceRange) -> Result<[f64; 3], KclError> {
    let mut out = [0.0; 3];
    for (i, scalar) in p.into_iter().enumerate() {
        out[i] = match scalar {
            Scalar::Constant(v) => v,
            Scalar::Variable(id) => {
                let raw = exec
                    .sketch_block_mut()
                    .and_then(|s| s.sketch_vars.get(id))
                    .and_then(KclValue::as_sketch_var)
                    .ok_or_else(|| error("Missing sketch variable", range))?
                    .clone();
                let value = KclValue::Number {
                    value: raw.initial_value,
                    ty: raw.ty,
                    meta: raw.meta,
                };
                normalize_to_solver_distance_unit(&value, range, exec, "3D initial coordinate")?
                    .as_ty_f64()
                    .ok_or_else(|| error("Expected a length", range))?
                    .n
            }
        };
    }
    Ok(out)
}

fn auxiliary_point(guess: [f64; 3], exec: &mut ExecState, range: SourceRange) -> Result<Point, KclError> {
    let ty = crate::execution::solver_numeric_type(exec);
    let block = exec
        .sketch_block_mut()
        .ok_or_else(|| error("Missing sketch state", range))?;
    let mut out = [Scalar::Constant(0.0); 3];
    for i in 0..3 {
        let id = block.next_sketch_var_id();
        out[i] = Scalar::Variable(id.0);
        block.sketch_vars.push(KclValue::SketchVar {
            value: Box::new(crate::execution::SketchVar {
                id,
                initial_value: guess[i],
                ty,
                node_path: None,
                meta: vec![],
            }),
        });
    }
    Ok(out)
}

fn kw(args: &Args, name: &str) -> Result<KclValue, KclError> {
    args.labeled
        .get(name)
        .map(|a| a.value.clone())
        .ok_or_else(|| error(format!("Missing {name}"), args.source_range))
}

/// The same names resolve to different constructors inside sketch3d blocks.
pub(crate) async fn call(exec: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let range = args.source_range;
    state(exec, range)?;
    let name = args.fn_name.as_deref().unwrap_or("").rsplit("::").next().unwrap_or("");
    if matches!(name, "point" | "line" | "arc" | "circle") {
        let keys: &[&str] = match name {
            "point" => &["at"],
            "line" => &["start", "end"],
            "arc" => &["start", "end", "center"],
            _ => &["start", "center"],
        };
        let mut fields = HashMap::new();
        let mut points = Vec::new();
        for key in keys {
            let value = kw(&args, key)?;
            points.push(point(&value, exec, range)?);
            fields.insert((*key).to_owned(), value);
        }
        let normal = if matches!(name, "arc" | "circle") {
            let raw_normal: [crate::std::args::TyF64; 3] = args.get_kw_arg("normal", &RuntimeType::any(), exec)?;
            let normal = raw_normal.map(|n| n.n);
            let vector = Vector3::from(normal);
            if !vector.iter().all(|v| v.is_finite()) || !vector.norm().is_finite() || vector.norm() < 1e-10 {
                return Err(error("A circle or arc needs a nonzero normal", range));
            }
            let normal: [f64; 3] = (vector / vector.norm()).into();
            fields.insert("normal".into(), kw(&args, "normal")?);
            Some(normal)
        } else {
            None
        };
        let construction = args
            .get_kw_arg_opt::<bool>("construction", &RuntimeType::bool(), exec)?
            .unwrap_or(false);
        let direction = args
            .get_kw_arg_opt::<String>("direction", &RuntimeType::string(), exec)?
            .unwrap_or_else(|| "CCW".to_owned())
            .to_ascii_uppercase();
        if !matches!(direction.as_str(), "CCW" | "CW") {
            return Err(error("direction must be CCW or CW", range));
        }
        if name == "arc" {
            fields.insert(
                "direction".to_owned(),
                KclValue::String {
                    value: direction.clone(),
                    meta: vec![Metadata { source_range: range }],
                },
            );
        }
        let label = exec.mod_local.being_declared.clone().unwrap_or_default();
        let source = SourceRef::new(range, args.node_path.clone());
        let spatial = state(exec, range)?;
        if let Some(normal) = normal {
            let center = *points.last().ok_or_else(|| error("Missing center", range))?;
            spatial.equations.push(Equation::InPlane(points[0], center, normal));
            if name == "arc" {
                spatial.equations.push(Equation::InPlane(points[1], center, normal));
                spatial.equations.push(Equation::Arc(points[0], points[1], center));
            }
        }
        spatial.geometry.push(Geometry {
            label,
            kind: name.to_owned(),
            points,
            normal,
            clockwise: direction == "CW",
            construction,
            source,
        });
        return Ok(object(fields, range));
    }
    let input: KclValue = args.get_unlabeled_kw_arg("objects", &RuntimeType::any(), exec)?;
    if matches!(
        name,
        "distance" | "horizontalDistance" | "verticalDistance" | "depthDistance" | "radius" | "diameter" | "angle"
    ) {
        return Ok(KclValue::SketchConstraint {
            value: Box::new(SketchConstraint {
                kind: SketchConstraintKind::Spatial {
                    name: name.to_owned(),
                    input: Box::new(input),
                },
                meta: vec![Metadata { source_range: range }],
            }),
        });
    }
    let inputs = input.clone().into_array();
    let mut equations = Vec::new();
    match name {
        "tangent" => {
            if inputs.len() != 2 {
                return Err(error("tangent requires two curves", range));
            }
            let (a, b) = (&inputs[0], &inputs[1]);
            match (circular(a), circular(b)) {
                (false, false) => return Err(error("Use parallel for two straight lines", range)),
                (true, true) => {
                    let [c1, s1] = radius(a, exec, range)?;
                    let [c2, s2] = radius(b, exec, range)?;
                    let n1 = circle_normal(a, range)?;
                    let n2 = circle_normal(b, range)?;
                    let center1 = Vector3::from(initial(c1, exec, range)?);
                    let center2 = Vector3::from(initial(c2, exec, range)?);
                    let r1 = (Vector3::from(initial(s1, exec, range)?) - center1).norm();
                    let delta = center2 - center1;
                    if delta.norm() < 1e-10 {
                        return Err(error("Tangency needs distinct circle centers", range));
                    }
                    if Vector3::from(n1).cross(&Vector3::from(n2)).norm() < 1e-10 {
                        let r2 = (Vector3::from(initial(s2, exec, range)?) - center2).norm();
                        let internal = delta.norm() + libm::fmin(r1, r2) < libm::fmax(r1, r2);
                        equations.push(Equation::CoplanarCirclesTangent(c1, s1, c2, s2, n1, internal));
                    } else {
                        let contact = auxiliary_point((center1 + delta.normalize() * r1).into(), exec, range)?;
                        equations.push(Equation::CirclesTangent(Box::new((c1, s1, n1, c2, s2, n2, contact))));
                    }
                }
                _ => {
                    let (circle, straight) = if circular(a) { (a, b) } else { (b, a) };
                    let [center, start] = radius(circle, exec, range)?;
                    equations.push(Equation::LineCircleTangent(
                        line(straight, exec, range)?,
                        center,
                        start,
                        circle_normal(circle, range)?,
                    ));
                }
            }
        }
        "coincident" | "fixed" => {
            if inputs.len() < 2 {
                return Err(error("coincident requires at least two points", range));
            }
            for b in &inputs[1..] {
                let a = &inputs[0];
                match (is_point(a), is_point(b)) {
                    (true, true) => {
                        equations.push(Equation::Coincident(point(a, exec, range)?, point(b, exec, range)?))
                    }
                    (false, false) if !circular(a) && !circular(b) => {
                        let l1 = line(a, exec, range)?;
                        let l2 = line(b, exec, range)?;
                        equations.push(Equation::Parallel(l1, l2));
                        equations.push(Equation::PointLineDistance(l1[0], l2, 0.0));
                    }
                    (false, false) => {
                        return Err(error(
                            "Select points on the circular geometry to constrain coincidence",
                            range,
                        ));
                    }
                    _ => {
                        let (p, curve) = if is_point(a) { (a, b) } else { (b, a) };
                        let p = point(p, exec, range)?;
                        if is_arc(curve) {
                            equations.push(Equation::PointOnArc(p, arc_geometry(curve, exec, range)?));
                        } else if circular(curve) {
                            let [center, start] = radius(curve, exec, range)?;
                            equations.push(Equation::EqualLength([center, p], [center, start]));
                            equations.push(Equation::InPlane(p, center, circle_normal(curve, range)?));
                        } else {
                            equations.push(Equation::PointLineDistance(p, line(curve, exec, range)?, 0.0));
                        }
                    }
                }
            }
        }
        "equalLength" | "equalRadius" | "parallel" | "perpendicular" => {
            if inputs.len() < 2 {
                return Err(error("This constraint requires at least two objects", range));
            }
            let extract = if name == "equalRadius" { radius } else { line };
            let a = extract(&inputs[0], exec, range)?;
            for value in &inputs[1..] {
                let b = extract(value, exec, range)?;
                equations.push(match name {
                    "equalLength" | "equalRadius" => Equation::EqualLength(a, b),
                    "parallel" => Equation::Parallel(a, b),
                    "perpendicular" => Equation::Perpendicular(a, b),
                    _ => Equation::Perpendicular(a, b),
                });
            }
        }
        "horizontal" | "vertical" | "depth" => {
            let [a, b] = if inputs.len() == 2 {
                [point(&inputs[0], exec, range)?, point(&inputs[1], exec, range)?]
            } else {
                line(&input, exec, range)?
            };
            let direction = match name {
                "horizontal" => 0,
                "vertical" => 1,
                _ => 2,
            };
            for axis in 0..3 {
                if axis != direction {
                    equations.push(Equation::AxisDistance(a, b, axis, 0.0));
                }
            }
        }
        "midpoint" => {
            let p = point(&kw(&args, "point")?, exec, range)?;
            if is_arc(&input) {
                equations.push(Equation::ArcMidpoint(p, arc_geometry(&input, exec, range)?));
            } else {
                let l = line(&input, exec, range)?;
                equations.push(Equation::Midpoint(p, l));
            }
        }
        "symmetric" => {
            if inputs.len() != 2 {
                return Err(error("symmetric requires two points", range));
            }
            let a = geometry_points(&inputs[0], exec, range)?;
            let b = geometry_points(&inputs[1], exec, range)?;
            if a.len() != b.len() || circular(&inputs[0]) != circular(&inputs[1]) {
                return Err(error("Symmetry requires matching kinds of geometry", range));
            }
            let axis = line(&kw(&args, "axis")?, exec, range)?;
            for (a, b) in a.into_iter().zip(b) {
                equations.push(Equation::Symmetric(a, b, axis));
            }
        }
        _ => return Err(error(format!("Unsupported sketch3d constraint {name}"), range)),
    }
    let spatial = state(exec, range)?;
    spatial.equations.extend(equations);
    spatial.constraints.push(Constraint3d {
        kind: name.to_owned(),
        source: SourceRef::new(range, args.node_path.clone()),
    });
    Ok(KclValue::none())
}

pub(crate) fn dimension(
    name: &str,
    input: &KclValue,
    desired: &KclValue,
    exec: &mut ExecState,
    range: SourceRange,
    node_path: Option<kcl_api::NodePath>,
) -> Result<KclValue, KclError> {
    state(exec, range)?;
    let inputs = input.clone().into_array();
    let normalized = if name == "angle" {
        crate::execution::normalize_to_solver_angle_unit(desired, range, exec, "3D angle")?
    } else {
        normalize_to_solver_distance_unit(desired, range, exec, "3D dimension")?
    };
    let number = normalized
        .as_ty_f64()
        .ok_or_else(|| error("Expected a dimension", range))?;
    let value = number.n;
    if !value.is_finite() {
        return Err(error("A dimension must be finite", range));
    }
    let equation = match name {
        "radius" | "diameter" => {
            if value <= 0.0 {
                return Err(error("A radius or diameter must be positive", range));
            }
            let [a, b] = radius(input, exec, range)?;
            Equation::Distance(a, b, value / if name == "diameter" { 2.0 } else { 1.0 })
        }
        "angle" => {
            if inputs.len() != 2 {
                return Err(error("angle requires two lines", range));
            }
            let radians = number
                .to_radians(exec, range)
                .ok_or_else(|| error("Expected an angle", range))?;
            if !(0.0..=std::f64::consts::PI).contains(&radians) {
                return Err(error("A spatial angle must be between 0 and 180 degrees", range));
            }
            Equation::Angle(line(&inputs[0], exec, range)?, line(&inputs[1], exec, range)?, radians)
        }
        _ => {
            if inputs.len() != 2 {
                return Err(error("A distance requires two points", range));
            }
            if name == "distance" && (is_point(&inputs[0]) != is_point(&inputs[1])) {
                if value < 0.0 {
                    return Err(error("distance must be nonnegative", range));
                }
                let (p, l) = if is_point(&inputs[0]) {
                    (&inputs[0], &inputs[1])
                } else {
                    (&inputs[1], &inputs[0])
                };
                if circular(l) {
                    return Err(error("Use a point on the circle for this distance", range));
                }
                let equation = Equation::PointLineDistance(point(p, exec, range)?, line(l, exec, range)?, value);
                let spatial = state(exec, range)?;
                spatial.equations.push(equation);
                spatial.constraints.push(Constraint3d {
                    kind: name.to_owned(),
                    source: SourceRef::new(range, node_path),
                });
                return Ok(KclValue::none());
            }
            let a = point(&inputs[0], exec, range)?;
            let b = point(&inputs[1], exec, range)?;
            if name == "distance" {
                if value < 0.0 {
                    return Err(error("distance must be nonnegative", range));
                }
                Equation::Distance(a, b, value)
            } else {
                Equation::AxisDistance(
                    a,
                    b,
                    match name {
                        "horizontalDistance" => 0,
                        "verticalDistance" => 1,
                        _ => 2,
                    },
                    value,
                )
            }
        }
    };
    let spatial = state(exec, range)?;
    spatial.equations.push(equation);
    spatial.constraints.push(Constraint3d {
        kind: name.to_owned(),
        source: SourceRef::new(range, node_path),
    });
    Ok(KclValue::none())
}

pub(crate) fn setup(
    node: &crate::parsing::ast::types::Node<crate::parsing::ast::types::SketchBlock>,
    sketch_id: kcl_api::ObjectId,
    exec: &mut ExecState,
) -> Result<kcl_api::ArtifactId, KclError> {
    let range = SourceRange::from(node);
    exec.warn_experimental("3D sketch blocks", range);
    let artifact_id = exec.next_artifact_id();
    exec.set_scene_object(kcl_api::Object {
        id: sketch_id,
        kind: kcl_api::ObjectKind::Sketch3d(kcl_api::Sketch3d {
            segments: vec![],
            constraints: vec![],
            degrees_of_freedom: 0,
        }),
        label: exec.mod_local.being_declared.clone().unwrap_or_default(),
        comments: Default::default(),
        artifact_id,
        source: SourceRef::new(range, node.node_path.clone()),
    });
    exec.add_artifact(kcl_api::artifact::Artifact::SketchBlock(
        kcl_api::artifact::SketchBlock {
            id: artifact_id,
            standard_plane: None,
            plane_id: None,
            plane_info: None,
            path_id: None,
            code_ref: kcl_api::artifact::CodeRef::placeholder(range),
            sketch_id,
        },
    ));
    exec.push_op(kcl_api::Operation::GroupBegin {
        group: kcl_api::Group::SketchBlock { sketch_id },
        node_path: kcl_api::NodePath::placeholder(),
        source_range: range,
    });
    Ok(artifact_id)
}

pub(crate) fn finalize(
    node: &crate::parsing::ast::types::Node<crate::parsing::ast::types::SketchBlock>,
    sketch_id: kcl_api::ObjectId,
    variables: indexmap::IndexMap<String, KclValue>,
    mut block: crate::execution::SketchBlockState,
    exec: &mut ExecState,
) -> Result<KclValue, KclError> {
    let range = SourceRange::from(node);
    let mut spatial = block
        .spatial
        .take()
        .ok_or_else(|| error("Missing 3D sketch state", range))?;
    let mut guesses = Vec::new();
    for value in &block.sketch_vars {
        let var = value
            .as_sketch_var()
            .ok_or_else(|| error("Expected a sketch variable", range))?;
        let raw = KclValue::Number {
            value: var.initial_value,
            ty: var.ty,
            meta: var.meta.clone(),
        };
        let normalized = normalize_to_solver_distance_unit(&raw, range, exec, "3D coordinate initial value")?;
        guesses.push(
            normalized
                .as_ty_f64()
                .ok_or_else(|| error("Expected a length", range))?
                .n,
        );
    }
    for constraint in &block.solver_constraints {
        spatial.equations.push(match constraint {
            ezpz::Constraint::Fixed(id, value) => {
                Equation::Equal(Scalar::Variable(*id as usize), Scalar::Constant(*value))
            }
            ezpz::Constraint::ScalarEqual(a, b) => {
                Equation::Equal(Scalar::Variable(*a as usize), Scalar::Variable(*b as usize))
            }
            _ => return Err(error("Unsupported scalar constraint in sketch3d", range)),
        });
    }
    let tolerance = kcl_api::UnitLength::Millimeters.convert_to(exec.length_unit(), 1e-8);
    let solution = crate::execution::sketch3d_solver::solve(&spatial.equations, guesses, tolerance)
        .map_err(|e| error(e, range))?;
    let scale = exec.length_unit().convert_to(kcl_api::UnitLength::Millimeters, 1.0);
    let segments = spatial
        .geometry
        .iter()
        .map(|g| g.solved(&solution.values, scale))
        .collect::<Vec<_>>();
    for segment in &segments {
        if segment.kind != "point"
            && (Vector3::from(segment.points[0]) - Vector3::from(segment.points[1])).norm() < 1e-8
        {
            return Err(error("A 3D line or circular segment must have distinct points", range));
        }
    }
    let solved = crate::execution::Solved {
        final_values: solution.values,
        iterations: 0,
        warnings: vec![],
        priority_solved: 0,
        variables_in_conflicts: Default::default(),
        unsatisfied_directional_constraints: vec![],
        converged: true,
    };
    let ty = crate::execution::solver_numeric_type(exec);
    exec.mod_local.artifacts.var_solutions = block.var_solutions(&solved, ty, range)?;
    let obj = exec
        .mod_local
        .artifacts
        .scene_object_by_id_mut(sketch_id)
        .ok_or_else(|| error("Missing 3D sketch object", range))?;
    obj.kind = kcl_api::ObjectKind::Sketch3d(kcl_api::Sketch3d {
        segments,
        constraints: spatial.constraints,
        degrees_of_freedom: solution.degrees_of_freedom,
    });
    fn substitute(
        value: KclValue,
        values: &[f64],
        ty: crate::execution::types::NumericType,
        range: SourceRange,
    ) -> Result<KclValue, KclError> {
        Ok(match value {
            KclValue::SketchVar { value } => KclValue::Number {
                value: *values
                    .get(value.id.0)
                    .ok_or_else(|| error("Missing 3D coordinate solution", range))?,
                ty,
                meta: value.meta,
            },
            KclValue::Tuple { value, meta } => KclValue::Tuple {
                value: value
                    .into_iter()
                    .map(|v| substitute(v, values, ty, range))
                    .collect::<Result<_, _>>()?,
                meta,
            },
            KclValue::HomArray { value, ty: array_ty } => KclValue::HomArray {
                value: value
                    .into_iter()
                    .map(|v| substitute(v, values, ty, range))
                    .collect::<Result<_, _>>()?,
                ty: array_ty,
            },
            KclValue::Object {
                value,
                constrainable,
                object_kind,
                meta,
            } => KclValue::Object {
                value: value
                    .into_iter()
                    .map(|(k, v)| substitute(v, values, ty, range).map(|v| (k, v)))
                    .collect::<Result<_, _>>()?,
                constrainable,
                object_kind,
                meta,
            },
            other => other,
        })
    }
    let properties = variables
        .into_iter()
        .map(|(k, v)| substitute(v, &solved.final_values, ty, range).map(|v| (k, v)))
        .collect::<Result<_, _>>()?;
    exec.push_op(kcl_api::Operation::GroupEnd);
    Ok(object(properties, range))
}

#[cfg(test)]
mod tests {
    use crate::execution::parse_execute;

    #[tokio::test]
    async fn sketch3d_dimensions_solve_world_coordinates() {
        let result = parse_execute(
            r#"@settings(kclVersion = 3.0, experimentalFeatures = allow)
s = sketch3d() {
  edge = line(start = [0mm, 0mm, 0mm], end = [var 5mm, var 0.1mm, var 7mm])
  distance([edge.start, edge.end]) == 10mm
  horizontalDistance([edge.start, edge.end]) == 6mm
  verticalDistance([edge.start, edge.end]) == 0mm
}
z = s.edge.end[2]
"#,
        )
        .await
        .unwrap();
        assert!((result.variable("z").as_ty_f64().unwrap().n - 8.0).abs() < 1e-7);
        let objects = &result.exec_state.global.root_module_artifacts.scene_objects;
        let sketch = objects
            .iter()
            .find_map(|o| match &o.kind {
                kcl_api::ObjectKind::Sketch3d(s) => Some(s),
                _ => None,
            })
            .unwrap();
        assert_eq!(sketch.degrees_of_freedom, 0);
        assert_eq!(sketch.segments[0].label, "edge");
        assert!((sketch.segments[0].points[1][2] - 8.0).abs() < 1e-7);
    }

    #[tokio::test]
    async fn sketch3d_points_arcs_and_circles_in_different_planes() {
        let result = parse_execute(
            r#"@settings(kclVersion = 3.0, experimentalFeatures = allow)
s = sketch3d() {
  p = point(at = [var 2mm, var 3mm, var 4mm])
  fixed([p, [2mm, 3mm, 4mm]])
  a = arc(start = [var 9mm, 0mm, 20mm], end = [0mm, var 9mm, 20mm], center = [0mm, 0mm, 20mm], normal = [0, 0, 1])
  radius(a) == 10mm
  c = circle(start = [0mm, 20mm, var 4mm], center = [0mm, 20mm, 0mm], normal = [1, 0, 0])
  diameter(c) == 10mm
}
r = s.c.start[2]
"#,
        )
        .await
        .unwrap();
        assert!((result.variable("r").as_ty_f64().unwrap().n - 5.0).abs() < 1e-7);
    }

    #[tokio::test]
    async fn sketch3d_tangent_line_in_a_world_plane() {
        let result = parse_execute(
            r#"@settings(kclVersion = 3.0, experimentalFeatures = allow)
s = sketch3d() {
  c = circle(start = [5mm, 0mm, 12mm], center = [0mm, 0mm, 12mm], normal = [0, 0, 1])
  l = line(start = [-10mm, var 4mm, 12mm], end = [10mm, var 4mm, 12mm])
  horizontal(l)
  tangent([l, c])
}
y = s.l.start[1]
"#,
        )
        .await
        .unwrap();
        assert!((result.variable("y").as_ty_f64().unwrap().n - 5.0).abs() < 1e-7);
    }

    #[tokio::test]
    async fn sketch3d_rejects_conflicts_and_supporting_planes() {
        let error = parse_execute(
            "s = sketch3d() {\n a = point(at = [0mm, 0mm, 0mm])\n distance([a, [0mm, 0mm, 0mm]]) == 10mm\n }",
        )
        .await
        .unwrap_err();
        assert!(error.message().contains("Conflicting"), "{error:?}");
        assert!(
            parse_execute("s = sketch3d(on = XY) {}")
                .await
                .unwrap_err()
                .message()
                .contains("supporting plane")
        );
    }

    #[tokio::test]
    async fn sketch3d_scope_does_not_replace_2d_solver() {
        parse_execute(
            r#"@settings(kclVersion = 3.0, experimentalFeatures = allow)
a = sketch3d() { p = point(at = [1mm, 2mm, 3mm]) }
b = sketch(on = XY) { p = point(at = [1mm, 2mm]) }
c = sketch3d() { p = point(at = [1mm, 2mm, 3mm]) }
"#,
        )
        .await
        .unwrap();
    }

    #[tokio::test]
    async fn sketch3d_arc_midpoint_uses_direction_and_keeps_the_world_plane() {
        let result = parse_execute(r#"@settings(kclVersion = 3.0, experimentalFeatures = allow)
s = sketch3d() {
  a = arc(start = [10mm, 0mm, 12mm], end = [0mm, 10mm, 12mm], center = [0mm, 0mm, 12mm], normal = [0, 0, 1], direction = "cw")
  p = point(at = [var -5mm, var -5mm, var 12mm])
  midpoint(a, point = p)
}
x = s.p.at[0]
z = s.p.at[2]
"#).await.unwrap();
        assert!((result.variable("x").as_ty_f64().unwrap().n + 10.0 * std::f64::consts::FRAC_1_SQRT_2).abs() < 1e-7);
        assert!((result.variable("z").as_ty_f64().unwrap().n - 12.0).abs() < 1e-7);
    }

    #[tokio::test]
    async fn sketch3d_mixed_units_have_one_solver_unit_and_world_millimeters() {
        let result = parse_execute(
            r#"@settings(kclVersion = 3.0, defaultLengthUnit = in, experimentalFeatures = allow)
s = sketch3d() {
  l = line(start = [1inch, 0mm, 0mm], end = [var 2inch, var 0inch, var 0inch])
  distance([l.start, l.end]) == 25.4mm
  horizontal(l)
}
"#,
        )
        .await
        .unwrap();
        let sketch = result
            .exec_state
            .global
            .root_module_artifacts
            .scene_objects
            .iter()
            .find_map(|o| match &o.kind {
                kcl_api::ObjectKind::Sketch3d(s) => Some(s),
                _ => None,
            })
            .unwrap();
        assert!((sketch.segments[0].points[0][0] - 25.4).abs() < 1e-7);
        assert!((sketch.segments[0].points[1][0] - 50.8).abs() < 1e-7);
    }

    #[tokio::test]
    async fn sketch3d_circle_tangency_keeps_equal_circles_distinct() {
        let result = parse_execute(
            r#"@settings(kclVersion = 3.0, experimentalFeatures = allow)
s = sketch3d() {
  c1 = circle(center = [0mm,0mm,6mm], start = [5mm,0mm,6mm], normal = [0,0,1])
  c2 = circle(center = [var 14mm,0mm,6mm], start = [var 19mm,0mm,6mm], normal = [0,0,1])
  radius(c2) == 5mm
  tangent([c1,c2])
}
x = s.c2.center[0]
"#,
        )
        .await
        .unwrap();
        assert!((result.variable("x").as_ty_f64().unwrap().n - 10.0).abs() < 1e-7);
    }
}
