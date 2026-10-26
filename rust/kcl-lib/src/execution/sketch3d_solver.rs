//! World-space constraint equations. This module has no engine or AST dependencies.
use nalgebra::DMatrix;
use nalgebra::DVector;
use nalgebra::Vector3;

#[derive(Debug, Clone, Copy)]
pub(crate) enum Scalar {
    Constant(f64),
    Variable(usize),
}

impl Scalar {
    pub(crate) fn value(self, values: &[f64]) -> f64 {
        match self {
            Self::Constant(value) => value,
            Self::Variable(index) => values.get(index).copied().unwrap_or(f64::NAN),
        }
    }
}

pub(crate) type Point = [Scalar; 3];
pub(crate) type Line = [Point; 2];
type CircleTangency = (Point, Point, [f64; 3], Point, Point, [f64; 3], Point);

#[derive(Debug, Clone, Copy)]
pub(crate) struct CircularArc {
    pub start: Point,
    pub end: Point,
    pub center: Point,
    pub normal: [f64; 3],
    pub clockwise: bool,
}

impl CircularArc {
    fn frame(self, values: &[f64]) -> (Vector3<f64>, Vector3<f64>, Vector3<f64>, f64, f64) {
        let center = point(self.center, values);
        let radial = point(self.start, values) - center;
        let radius = radial.norm();
        let u = radial / libm::fmax(radius, 1e-12);
        let v = Vector3::from(self.normal).cross(&u);
        let end = point(self.end, values) - center;
        let angle = libm::atan2(end.dot(&v), end.dot(&u));
        let sweep = if self.clockwise {
            -(-angle).rem_euclid(std::f64::consts::TAU)
        } else {
            angle.rem_euclid(std::f64::consts::TAU)
        };
        (center, u, v, radius, sweep)
    }

    fn midpoint(self, values: &[f64]) -> Vector3<f64> {
        let (center, u, v, radius, sweep) = self.frame(values);
        center + (u * libm::cos(sweep / 2.0) + v * libm::sin(sweep / 2.0)) * radius
    }

    fn closest(self, p: Vector3<f64>, values: &[f64]) -> Vector3<f64> {
        let (center, u, v, radius, sweep) = self.frame(values);
        let delta = p - center;
        let angle = libm::atan2(delta.dot(&v), delta.dot(&u));
        let travel = if self.clockwise {
            (-angle).rem_euclid(std::f64::consts::TAU)
        } else {
            angle.rem_euclid(std::f64::consts::TAU)
        };
        if travel <= sweep.abs() {
            center + (u * libm::cos(angle) + v * libm::sin(angle)) * radius
        } else {
            let start = point(self.start, values);
            let end = point(self.end, values);
            if (p - start).norm_squared() < (p - end).norm_squared() {
                start
            } else {
                end
            }
        }
    }
}

fn point(p: Point, values: &[f64]) -> Vector3<f64> {
    Vector3::from(p.map(|c| c.value(values)))
}

#[derive(Debug, Clone)]
pub(crate) enum Equation {
    Equal(Scalar, Scalar),
    Coincident(Point, Point),
    Distance(Point, Point, f64),
    AxisDistance(Point, Point, usize, f64),
    PointLineDistance(Point, Line, f64),
    Midpoint(Point, Line),
    ArcMidpoint(Point, CircularArc),
    PointOnArc(Point, CircularArc),
    Parallel(Line, Line),
    Perpendicular(Line, Line),
    EqualLength(Line, Line),
    Angle(Line, Line, f64),
    Symmetric(Point, Point, Line),
    /// The first radius of an arc has the same length as the second radius.
    Arc(Point, Point, Point),
    InPlane(Point, Point, [f64; 3]),
    LineCircleTangent(Line, Point, Point, [f64; 3]),
    CirclesTangent(Box<CircleTangency>),
    CoplanarCirclesTangent(Point, Point, Point, Point, [f64; 3], bool),
}

impl Equation {
    fn residuals(&self, values: &[f64], out: &mut Vec<f64>) {
        let p = |p| point(p, values);
        let direction = |line: Line| p(line[1]) - p(line[0]);
        match *self {
            Self::Equal(a, b) => out.push(a.value(values) - b.value(values)),
            Self::Coincident(a, b) => out.extend((p(a) - p(b)).iter()),
            Self::Distance(a, b, distance) => {
                if distance == 0.0 {
                    out.extend((p(a) - p(b)).iter());
                } else {
                    out.push((p(a) - p(b)).norm() - distance);
                }
            }
            Self::AxisDistance(a, b, axis, distance) => out.push(p(b)[axis] - p(a)[axis] - distance),
            Self::PointLineDistance(a, line, distance) => {
                let d = direction(line);
                let perpendicular = (p(a) - p(line[0])).cross(&d) / libm::fmax(d.norm(), 1e-12);
                if distance == 0.0 {
                    out.extend(perpendicular.iter());
                } else {
                    out.push(perpendicular.norm() - distance);
                }
            }
            Self::Midpoint(a, line) => out.extend((p(a) - (p(line[0]) + p(line[1])) * 0.5).iter()),
            Self::ArcMidpoint(a, arc) => out.extend((p(a) - arc.midpoint(values)).iter()),
            Self::PointOnArc(a, arc) => out.extend((p(a) - arc.closest(p(a), values)).iter()),
            Self::Parallel(a, b) => {
                let a = direction(a);
                let b = direction(b);
                out.extend((a.cross(&b) / libm::fmax(a.norm() * b.norm(), 1e-12)).iter());
            }
            Self::Perpendicular(a, b) => {
                let a = direction(a);
                let b = direction(b);
                out.push(a.dot(&b) / libm::fmax(a.norm() * b.norm(), 1e-12));
            }
            Self::EqualLength(a, b) => out.push(direction(a).norm() - direction(b).norm()),
            Self::Angle(a, b, angle) => {
                let a = direction(a);
                let b = direction(b);
                out.push(a.dot(&b) / libm::fmax(a.norm() * b.norm(), 1e-12) - libm::cos(angle));
            }
            Self::Symmetric(a, b, axis) => {
                let midpoint = (p(a) + p(b)) * 0.5;
                let d = direction(axis);
                out.extend(((midpoint - p(axis[0])).cross(&d) / libm::fmax(d.norm(), 1e-12)).iter());
                out.push((p(b) - p(a)).dot(&d) / libm::fmax(d.norm(), 1e-12));
            }
            Self::Arc(start, end, center) => out.push((p(start) - p(center)).norm() - (p(end) - p(center)).norm()),
            Self::InPlane(a, center, normal) => out.push((p(a) - p(center)).dot(&Vector3::from(normal))),
            Self::LineCircleTangent(line, center, start, normal) => {
                let d = direction(line);
                let n = Vector3::from(normal);
                let delta = p(center) - p(line[0]);
                out.push(delta.cross(&d).norm() / libm::fmax(d.norm(), 1e-12) - (p(start) - p(center)).norm());
                out.push(delta.dot(&n));
                out.push(d.dot(&n) / libm::fmax(d.norm(), 1e-12));
            }
            Self::CirclesTangent(ref geometry) => {
                let (c1, s1, n1, c2, s2, n2, contact) = **geometry;
                let a = p(contact) - p(c1);
                let b = p(contact) - p(c2);
                let n1 = Vector3::from(n1);
                let n2 = Vector3::from(n2);
                out.push(a.norm() - (p(s1) - p(c1)).norm());
                out.push(b.norm() - (p(s2) - p(c2)).norm());
                out.push(a.dot(&n1));
                out.push(b.dot(&n2));
                let t1 = n1.cross(&a);
                let t2 = n2.cross(&b);
                out.extend((t1.cross(&t2) / libm::fmax(t1.norm() * t2.norm(), 1e-12)).iter());
            }
            Self::CoplanarCirclesTangent(c1, s1, c2, s2, normal, internal) => {
                let r1 = (p(s1) - p(c1)).norm();
                let r2 = (p(s2) - p(c2)).norm();
                let delta = p(c2) - p(c1);
                out.push(delta.norm() - if internal { (r1 - r2).abs() } else { r1 + r2 });
                out.push(delta.dot(&Vector3::from(normal)));
            }
        }
    }
}

fn residuals(equations: &[Equation], values: &[f64]) -> DVector<f64> {
    let mut out = Vec::new();
    for equation in equations {
        equation.residuals(values, &mut out);
    }
    DVector::from_vec(out)
}

fn jacobian(equations: &[Equation], values: &[f64], rows: usize) -> DMatrix<f64> {
    let mut jacobian = DMatrix::zeros(rows, values.len());
    let mut probe = values.to_vec();
    for column in 0..values.len() {
        let step = 1e-5 * libm::fmax(values[column].abs(), 1.0);
        probe[column] = values[column] + step;
        let plus = residuals(equations, &probe);
        probe[column] = values[column] - step;
        let minus = residuals(equations, &probe);
        probe[column] = values[column];
        jacobian.set_column(column, &((plus - minus) / (2.0 * step)));
    }
    jacobian
}

pub(crate) struct Solution {
    pub values: Vec<f64>,
    pub degrees_of_freedom: usize,
}

/// Damped least squares starts from the authored guesses and retains free coordinates.
/// Failure is an error: callers must never publish unsolved geometry as a solution.
pub(crate) fn solve(equations: &[Equation], mut values: Vec<f64>, tolerance: f64) -> Result<Solution, &'static str> {
    if values.iter().any(|v| !v.is_finite()) {
        return Err("3D sketch coordinates must be finite");
    }
    let mut damping: f64 = 1e-6;
    for _ in 0..100 {
        let residual = residuals(equations, &values);
        if residual.iter().any(|v| !v.is_finite()) {
            return Err("Invalid 3D sketch constraint");
        }
        let jac = jacobian(equations, &values, residual.len());
        if jac.iter().any(|v| !v.is_finite()) {
            return Err("Invalid 3D sketch constraint derivative");
        }
        if residual.amax() <= tolerance {
            for equation in equations {
                if let Equation::CoplanarCirclesTangent(c1, _, c2, _, _, true) = equation
                    && (point(*c1, &values) - point(*c2, &values)).norm() <= tolerance
                {
                    return Err("Coincident circles cannot define a unique tangency");
                }
            }
            let rank = if jac.is_empty() {
                0
            } else {
                jac.svd(false, false)
                    .singular_values
                    .iter()
                    .filter(|s| **s > 1e-7)
                    .count()
            };
            return Ok(Solution {
                degrees_of_freedom: values.len().saturating_sub(rank),
                values,
            });
        }
        if values.is_empty() {
            return Err("Conflicting constraints in 3D sketch");
        }
        let transpose = jac.transpose();
        let mut normal = &transpose * &jac;
        for i in 0..values.len() {
            normal[(i, i)] += damping;
        }
        let Some(step) = normal.lu().solve(&(-transpose * &residual)) else {
            return Err("Unable to solve 3D sketch constraints");
        };
        let candidate = values.iter().zip(step.iter()).map(|(v, d)| v + d).collect::<Vec<_>>();
        if candidate.iter().all(|v| v.is_finite())
            && residuals(equations, &candidate).norm_squared() < residual.norm_squared()
        {
            values = candidate;
            damping = libm::fmax(damping * 0.25, 1e-12);
        } else {
            damping *= 10.0;
        }
    }
    Err("3D sketch constraints conflict or the solver did not converge")
}

#[cfg(test)]
mod tests {
    use super::*;
    const O: Point = [Scalar::Constant(0.0); 3];
    fn variable_point(start: usize) -> Point {
        std::array::from_fn(|i| Scalar::Variable(start + i))
    }

    #[test]
    fn bounded_arc_coincidence_and_midpoint_follow_the_authored_sweep() {
        let constant = |p: [f64; 3]| p.map(Scalar::Constant);
        let arc = CircularArc {
            start: constant([1.0, 0.0, 0.0]),
            end: constant([0.0, 1.0, 0.0]),
            center: O,
            normal: [0.0, 0.0, 1.0],
            clockwise: false,
        };
        assert!(solve(&[Equation::PointOnArc(constant([-1.0, 0.0, 0.0]), arc)], vec![], 1e-8).is_err());
        let solution = solve(
            &[Equation::ArcMidpoint(variable_point(0), arc)],
            vec![0.5, 0.5, 0.2],
            1e-8,
        )
        .unwrap();
        assert!((solution.values[0] - std::f64::consts::FRAC_1_SQRT_2).abs() < 1e-7);
        let major = CircularArc { clockwise: true, ..arc };
        let solution = solve(
            &[Equation::ArcMidpoint(variable_point(0), major)],
            vec![-0.5, -0.5, 0.2],
            1e-8,
        )
        .unwrap();
        assert!((solution.values[1] + std::f64::consts::FRAC_1_SQRT_2).abs() < 1e-7);
    }

    #[test]
    fn distance_includes_z_and_preserves_free_coordinates() {
        let p = variable_point(0);
        let solution = solve(
            &[
                Equation::Distance(O, p, 10.0),
                Equation::AxisDistance(O, p, 0, 6.0),
                Equation::AxisDistance(O, p, 1, 0.0),
            ],
            vec![5.5, 0.2, 7.5],
            1e-8,
        )
        .unwrap();
        assert!((solution.values[2] - 8.0).abs() < 1e-7);
        assert_eq!(solution.degrees_of_freedom, 0);
    }

    #[test]
    fn underconstrained_and_conflicting_sketches() {
        let solution = solve(
            &[Equation::Distance(O, variable_point(0), 10.0)],
            vec![0.0, 0.0, 8.0],
            1e-8,
        )
        .unwrap();
        assert_eq!(solution.degrees_of_freedom, 2);
        assert!(solve(&[Equation::Distance(O, O, 10.0)], vec![], 1e-8).is_err());
    }

    #[test]
    fn zero_distances_preserve_the_rank_of_coincidence_constraints() {
        let p = variable_point(0);
        let solution = solve(&[Equation::Distance(O, p, 0.0)], vec![1.0, 2.0, 3.0], 1e-8).unwrap();
        assert_eq!(solution.degrees_of_freedom, 0);
        let x = [
            O,
            [Scalar::Constant(10.0), Scalar::Constant(0.0), Scalar::Constant(0.0)],
        ];
        let solution = solve(&[Equation::PointLineDistance(p, x, 0.0)], vec![2.0, 3.0, 4.0], 1e-8).unwrap();
        assert_eq!(solution.degrees_of_freedom, 1);
        assert!((solution.values[0] - 2.0).abs() < 1e-8);
    }

    #[test]
    fn skew_lines_are_not_parallel_or_perpendicular_from_xy_alone() {
        let a = [O, [Scalar::Constant(1.0), Scalar::Constant(0.0), Scalar::Constant(1.0)]];
        let b = [O, [Scalar::Constant(0.0), Scalar::Constant(1.0), Scalar::Constant(1.0)]];
        assert!(solve(&[Equation::Perpendicular(a, b)], vec![], 1e-8).is_err());
        assert!(solve(&[Equation::Parallel(a, b)], vec![], 1e-8).is_err());
    }
}
