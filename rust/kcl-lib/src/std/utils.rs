use std::f64::consts::PI;

use kittycad_modeling_cmds::shared::Angle;

use super::args::TyF64;
use crate::execution::types::{NumericType, UnitLen};

pub(crate) fn untype_point(p: [TyF64; 2]) -> ([f64; 2], NumericType) {
    let (x, y, ty) = NumericType::combine_eq_coerce(p[0].clone(), p[1].clone());
    ([x, y], ty)
}

pub(crate) fn untype_array<const N: usize>(p: [TyF64; N]) -> ([f64; N], NumericType) {
    let (vec, ty) = NumericType::combine_eq_array(&p);
    (
        vec.try_into()
            .unwrap_or_else(|v: Vec<f64>| panic!("Expected a Vec of length {} but it was {}", N, v.len())),
        ty,
    )
}

pub(crate) fn point_to_mm(p: [TyF64; 2]) -> [f64; 2] {
    [p[0].to_mm(), p[1].to_mm()]
}

pub(crate) fn untyped_point_to_mm(p: [f64; 2], units: UnitLen) -> [f64; 2] {
    assert_ne!(units, UnitLen::Unknown);
    [
        units.adjust_to(p[0], UnitLen::Mm).0,
        units.adjust_to(p[1], UnitLen::Mm).0,
    ]
}

pub(crate) fn point_to_len_unit(p: [TyF64; 2], len: UnitLen) -> [f64; 2] {
    [p[0].to_length_units(len), p[1].to_length_units(len)]
}

/// Precondition, `p` must be in `len` units (this function does no conversion).
pub(crate) fn point_to_typed(p: [f64; 2], len: UnitLen) -> [TyF64; 2] {
    [TyF64::new(p[0], len.into()), TyF64::new(p[1], len.into())]
}

pub(crate) fn point_3d_to_mm(p: [TyF64; 3]) -> [f64; 3] {
    [p[0].to_mm(), p[1].to_mm(), p[2].to_mm()]
}

/// Get the distance between two points.
pub(crate) fn distance(a: Coords2d, b: Coords2d) -> f64 {
    ((b[0] - a[0]).powi(2) + (b[1] - a[1]).powi(2)).sqrt()
}

/// Get the angle between these points
pub(crate) fn between(a: Coords2d, b: Coords2d) -> Angle {
    let x = b[0] - a[0];
    let y = b[1] - a[1];
    normalize(Angle::from_radians(libm::atan2(y, x)))
}

/// Normalize the angle
pub(crate) fn normalize(angle: Angle) -> Angle {
    let deg = angle.to_degrees();
    let result = ((deg % 360.0) + 360.0) % 360.0;
    Angle::from_degrees(if result > 180.0 { result - 360.0 } else { result })
}

/// Gives the ▲-angle between from and to angles (shortest path)
///
/// Sign of the returned angle denotes direction, positive means counterClockwise 🔄
/// # Examples
///
/// ```
/// use std::f64::consts::PI;
///
/// use kcl_lib::std::utils::Angle;
///
/// assert_eq!(
///     Angle::delta(Angle::from_radians(PI / 8.0), Angle::from_radians(PI / 4.0)),
///     Angle::from_radians(PI / 8.0)
/// );
/// ```
pub(crate) fn delta(from_angle: Angle, to_angle: Angle) -> Angle {
    let norm_from_angle = normalize_rad(from_angle.to_radians());
    let norm_to_angle = normalize_rad(to_angle.to_radians());
    let provisional = norm_to_angle - norm_from_angle;

    if provisional > -PI && provisional <= PI {
        return Angle::from_radians(provisional);
    }
    if provisional > PI {
        return Angle::from_radians(provisional - 2.0 * PI);
    }
    if provisional < -PI {
        return Angle::from_radians(provisional + 2.0 * PI);
    }
    Angle::default()
}

pub(crate) fn normalize_rad(angle: f64) -> f64 {
    let draft = angle % (2.0 * PI);
    if draft < 0.0 { draft + 2.0 * PI } else { draft }
}

fn calculate_intersection_of_two_lines(line1: &[Coords2d; 2], line2_angle: f64, line2_point: Coords2d) -> Coords2d {
    let line2_point_b = [
        line2_point[0] + libm::cos(line2_angle.to_radians()) * 10.0,
        line2_point[1] + libm::sin(line2_angle.to_radians()) * 10.0,
    ];
    intersect(line1[0], line1[1], line2_point, line2_point_b)
}

fn intersect(p1: Coords2d, p2: Coords2d, p3: Coords2d, p4: Coords2d) -> Coords2d {
    let slope = |p1: Coords2d, p2: Coords2d| (p1[1] - p2[1]) / (p1[0] - p2[0]);
    let constant = |p1: Coords2d, p2: Coords2d| p1[1] - slope(p1, p2) * p1[0];
    let get_y = |for_x: f64, p1: Coords2d, p2: Coords2d| slope(p1, p2) * for_x + constant(p1, p2);

    if p1[0] == p2[0] {
        return [p1[0], get_y(p1[0], p3, p4)];
    }
    if p3[0] == p4[0] {
        return [p3[0], get_y(p3[0], p1, p2)];
    }

    let x = (constant(p3, p4) - constant(p1, p2)) / (slope(p1, p2) - slope(p3, p4));
    let y = get_y(x, p1, p2);
    [x, y]
}

pub(crate) fn intersection_with_parallel_line(
    line1: &[Coords2d; 2],
    line1_offset: f64,
    line2_angle: f64,
    line2_point: Coords2d,
) -> Coords2d {
    calculate_intersection_of_two_lines(&offset_line(line1_offset, line1[0], line1[1]), line2_angle, line2_point)
}

fn offset_line(offset: f64, p1: Coords2d, p2: Coords2d) -> [Coords2d; 2] {
    if p1[0] == p2[0] {
        let direction = (p1[1] - p2[1]).signum();
        return [[p1[0] + offset * direction, p1[1]], [p2[0] + offset * direction, p2[1]]];
    }
    if p1[1] == p2[1] {
        let direction = (p2[0] - p1[0]).signum();
        return [[p1[0], p1[1] + offset * direction], [p2[0], p2[1] + offset * direction]];
    }
    let x_offset = offset / libm::sin(libm::atan2(p1[1] - p2[1], p1[0] - p2[0]));
    [[p1[0] + x_offset, p1[1]], [p2[0] + x_offset, p2[1]]]
}

pub(crate) fn get_y_component(angle: Angle, x: f64) -> Coords2d {
    let normalised_angle = ((angle.to_degrees() % 360.0) + 360.0) % 360.0; // between 0 and 360
    let y = x * libm::tan(normalised_angle.to_radians());
    let sign = if normalised_angle > 90.0 && normalised_angle <= 270.0 {
        -1.0
    } else {
        1.0
    };
    [x * sign, y * sign]
}

pub(crate) fn get_x_component(angle: Angle, y: f64) -> Coords2d {
    let normalised_angle = ((angle.to_degrees() % 360.0) + 360.0) % 360.0; // between 0 and 360
    let x = y / libm::tan(normalised_angle.to_radians());
    let sign = if normalised_angle > 180.0 && normalised_angle <= 360.0 {
        -1.0
    } else {
        1.0
    };
    [x * sign, y * sign]
}

pub(crate) fn arc_center_and_end(
    from: Coords2d,
    start_angle: Angle,
    end_angle: Angle,
    radius: f64,
) -> (Coords2d, Coords2d) {
    let start_angle = start_angle.to_radians();
    let end_angle = end_angle.to_radians();

    let center = [
        -(radius * libm::cos(start_angle) - from[0]),
        -(radius * libm::sin(start_angle) - from[1]),
    ];

    let end = [
        center[0] + radius * libm::cos(end_angle),
        center[1] + radius * libm::sin(end_angle),
    ];

    (center, end)
}

// Calculate the center of 3 points using an algebraic method
// Handles if 3 points lie on the same line (collinear) by returning the average of the points (could return None instead..)
pub(crate) fn calculate_circle_center(p1: [f64; 2], p2: [f64; 2], p3: [f64; 2]) -> [f64; 2] {
    let (x1, y1) = (p1[0], p1[1]);
    let (x2, y2) = (p2[0], p2[1]);
    let (x3, y3) = (p3[0], p3[1]);

    // Compute the determinant d = 2 * (x1*(y2-y3) + x2*(y3-y1) + x3*(y1-y2))
    // Visually d is twice the area of the triangle formed by the points,
    // also the same as: cross(p2 - p1, p3 - p1)
    let d = 2.0 * (x1 * (y2 - y3) + x2 * (y3 - y1) + x3 * (y1 - y2));

    // If d is nearly zero, the points are collinear, and a unique circle cannot be defined.
    if d.abs() < f64::EPSILON {
        return [(x1 + x2 + x3) / 3.0, (y1 + y2 + y3) / 3.0];
    }

    // squared lengths
    let p1_sq = x1 * x1 + y1 * y1;
    let p2_sq = x2 * x2 + y2 * y2;
    let p3_sq = x3 * x3 + y3 * y3;

    // This formula is derived from the circle equations:
    //   (x - cx)^2 + (y - cy)^2 = r^2
    // All 3 points will satisfy this equation, so we have 3 equations. Radius can be eliminated
    // by subtracting one of the equations from the other two and the remaining 2 equations can
    // be solved for cx and cy.
    [
        (p1_sq * (y2 - y3) + p2_sq * (y3 - y1) + p3_sq * (y1 - y2)) / d,
        (p1_sq * (x3 - x2) + p2_sq * (x1 - x3) + p3_sq * (x2 - x1)) / d,
    ]
}

pub struct CircleParams {
    pub center: Coords2d,
    pub radius: f64,
}

pub fn calculate_circle_from_3_points(points: [Coords2d; 3]) -> CircleParams {
    let center = calculate_circle_center(points[0], points[1], points[2]);
    CircleParams {
        center,
        radius: distance(center, points[1]),
    }
}

#[cfg(test)]
mod tests {
    // Here you can bring your functions into scope
    use std::f64::consts::TAU;

    use approx::assert_relative_eq;
    use pretty_assertions::assert_eq;

    use super::{Angle, calculate_circle_center, get_x_component, get_y_component};

    static EACH_QUAD: [(i32, [i32; 2]); 12] = [
        (-315, [1, 1]),
        (-225, [-1, 1]),
        (-135, [-1, -1]),
        (-45, [1, -1]),
        (45, [1, 1]),
        (135, [-1, 1]),
        (225, [-1, -1]),
        (315, [1, -1]),
        (405, [1, 1]),
        (495, [-1, 1]),
        (585, [-1, -1]),
        (675, [1, -1]),
    ];

    #[test]
    fn test_get_y_component() {
        let mut expected = Vec::new();
        let mut results = Vec::new();

        for &(angle, expected_result) in EACH_QUAD.iter() {
            let res = get_y_component(Angle::from_degrees(angle as f64), 1.0);
            results.push([res[0].round() as i32, res[1].round() as i32]);
            expected.push(expected_result);
        }

        assert_eq!(results, expected);

        let result = get_y_component(Angle::zero(), 1.0);
        assert_eq!(result[0] as i32, 1);
        assert_eq!(result[1] as i32, 0);

        let result = get_y_component(Angle::from_degrees(90.0), 1.0);
        assert_eq!(result[0] as i32, 1);
        assert!(result[1] > 100000.0);

        let result = get_y_component(Angle::from_degrees(180.0), 1.0);
        assert_eq!(result[0] as i32, -1);
        assert!((result[1] - 0.0).abs() < f64::EPSILON);

        let result = get_y_component(Angle::from_degrees(270.0), 1.0);
        assert_eq!(result[0] as i32, -1);
        assert!(result[1] < -100000.0);
    }

    #[test]
    fn test_get_x_component() {
        let mut expected = Vec::new();
        let mut results = Vec::new();

        for &(angle, expected_result) in EACH_QUAD.iter() {
            let res = get_x_component(Angle::from_degrees(angle as f64), 1.0);
            results.push([res[0].round() as i32, res[1].round() as i32]);
            expected.push(expected_result);
        }

        assert_eq!(results, expected);

        let result = get_x_component(Angle::zero(), 1.0);
        assert!(result[0] > 100000.0);
        assert_eq!(result[1] as i32, 1);

        let result = get_x_component(Angle::from_degrees(90.0), 1.0);
        assert!((result[0] - 0.0).abs() < f64::EPSILON);
        assert_eq!(result[1] as i32, 1);

        let result = get_x_component(Angle::from_degrees(180.0), 1.0);
        assert!(result[0] < -100000.0);
        assert_eq!(result[1] as i32, 1);

        let result = get_x_component(Angle::from_degrees(270.0), 1.0);
        assert!((result[0] - 0.0).abs() < f64::EPSILON);
        assert_eq!(result[1] as i32, -1);
    }

    #[test]
    fn test_arc_center_and_end() {
        let (center, end) = super::arc_center_and_end([0.0, 0.0], Angle::zero(), Angle::from_degrees(90.0), 1.0);
        assert_eq!(center[0].round(), -1.0);
        assert_eq!(center[1], 0.0);
        assert_eq!(end[0].round(), -1.0);
        assert_eq!(end[1], 1.0);

        let (center, end) = super::arc_center_and_end([0.0, 0.0], Angle::zero(), Angle::from_degrees(180.0), 1.0);
        assert_eq!(center[0].round(), -1.0);
        assert_eq!(center[1], 0.0);
        assert_eq!(end[0].round(), -2.0);
        assert_eq!(end[1].round(), 0.0);

        let (center, end) = super::arc_center_and_end([0.0, 0.0], Angle::zero(), Angle::from_degrees(180.0), 10.0);
        assert_eq!(center[0].round(), -10.0);
        assert_eq!(center[1], 0.0);
        assert_eq!(end[0].round(), -20.0);
        assert_eq!(end[1].round(), 0.0);
    }

    #[test]
    fn test_calculate_circle_center() {
        const EPS: f64 = 1e-4;

        // Test: circle center = (4.1, 1.9)
        let p1 = [1.0, 2.0];
        let p2 = [4.0, 5.0];
        let p3 = [7.0, 3.0];
        let center = calculate_circle_center(p1, p2, p3);
        assert_relative_eq!(center[0], 4.1, epsilon = EPS);
        assert_relative_eq!(center[1], 1.9, epsilon = EPS);

        // Tests: Generate a few circles and test its points
        let center = [3.2, 0.7];
        let radius_array = [0.001, 0.01, 0.6, 1.0, 5.0, 60.0, 500.0, 2000.0, 400_000.0];
        let points_array = [[0.0, 0.33, 0.66], [0.0, 0.1, 0.2], [0.0, -0.1, 0.1], [0.0, 0.5, 0.7]];

        let get_point = |radius: f64, t: f64| {
            let angle = t * TAU;
            [
                center[0] + radius * libm::cos(angle),
                center[1] + radius * libm::sin(angle),
            ]
        };

        for radius in radius_array {
            for point in points_array {
                let p1 = get_point(radius, point[0]);
                let p2 = get_point(radius, point[1]);
                let p3 = get_point(radius, point[2]);
                let c = calculate_circle_center(p1, p2, p3);
                assert_relative_eq!(c[0], center[0], epsilon = EPS);
                assert_relative_eq!(c[1], center[1], epsilon = EPS);
            }
        }

        // Test: Equilateral triangle
        let p1 = [0.0, 0.0];
        let p2 = [1.0, 0.0];
        let p3 = [0.5, 3.0_f64.sqrt() / 2.0];
        let center = calculate_circle_center(p1, p2, p3);
        assert_relative_eq!(center[0], 0.5, epsilon = EPS);
        assert_relative_eq!(center[1], 1.0 / (2.0 * 3.0_f64.sqrt()), epsilon = EPS);

        // Test: Collinear points (should return the average of the points)
        let p1 = [0.0, 0.0];
        let p2 = [1.0, 0.0];
        let p3 = [2.0, 0.0];
        let center = calculate_circle_center(p1, p2, p3);
        assert_relative_eq!(center[0], 1.0, epsilon = EPS);
        assert_relative_eq!(center[1], 0.0, epsilon = EPS);

        // Test: Points forming a circle with radius = 1
        let p1 = [0.0, 0.0];
        let p2 = [0.0, 2.0];
        let p3 = [2.0, 0.0];
        let center = calculate_circle_center(p1, p2, p3);
        assert_relative_eq!(center[0], 1.0, epsilon = EPS);
        assert_relative_eq!(center[1], 1.0, epsilon = EPS);

        // Test: Integer coordinates
        let p1 = [0.0, 0.0];
        let p2 = [0.0, 6.0];
        let p3 = [6.0, 0.0];
        let center = calculate_circle_center(p1, p2, p3);
        assert_relative_eq!(center[0], 3.0, epsilon = EPS);
        assert_relative_eq!(center[1], 3.0, epsilon = EPS);
        // Verify radius (should be 3 * sqrt(2))
        let radius = ((center[0] - p1[0]).powi(2) + (center[1] - p1[1]).powi(2)).sqrt();
        assert_relative_eq!(radius, 3.0 * 2.0_f64.sqrt(), epsilon = EPS);
    }
}

pub(crate) type Coords2d = [f64; 2];

pub fn is_points_ccw_wasm(points: &[f64]) -> i32 {
    // CCW is positive as that the Math convention

    let mut sum = 0.0;
    for i in 0..(points.len() / 2) {
        let point1 = [points[2 * i], points[2 * i + 1]];
        let point2 = [points[(2 * i + 2) % points.len()], points[(2 * i + 3) % points.len()]];
        sum += (point2[0] + point1[0]) * (point2[1] - point1[1]);
    }
    sum.signum() as i32
}

pub(crate) fn is_points_ccw(points: &[Coords2d]) -> i32 {
    let flattened_points: Vec<f64> = points.iter().flat_map(|&p| vec![p[0], p[1]]).collect();
    is_points_ccw_wasm(&flattened_points)
}

fn get_slope(start: Coords2d, end: Coords2d) -> (f64, f64) {
    let slope = if start[0] - end[0] == 0.0 {
        f64::INFINITY
    } else {
        (start[1] - end[1]) / (start[0] - end[0])
    };

    let perp_slope = if slope == f64::INFINITY { 0.0 } else { -1.0 / slope };

    (slope, perp_slope)
}

fn get_angle(point1: Coords2d, point2: Coords2d) -> f64 {
    let delta_x = point2[0] - point1[0];
    let delta_y = point2[1] - point1[1];
    let angle = libm::atan2(delta_y, delta_x);

    let result = if angle < 0.0 { angle + 2.0 * PI } else { angle };
    result * (180.0 / PI)
}

fn delta_angle(from_angle: f64, to_angle: f64) -> f64 {
    let norm_from_angle = normalize_rad(from_angle);
    let norm_to_angle = normalize_rad(to_angle);
    let provisional = norm_to_angle - norm_from_angle;

    if provisional > -PI && provisional <= PI {
        provisional
    } else if provisional > PI {
        provisional - 2.0 * PI
    } else if provisional < -PI {
        provisional + 2.0 * PI
    } else {
        provisional
    }
}

fn deg2rad(deg: f64) -> f64 {
    deg * (PI / 180.0)
}

fn get_mid_point(
    center: Coords2d,
    arc_start_point: Coords2d,
    arc_end_point: Coords2d,
    tan_previous_point: Coords2d,
    radius: f64,
    obtuse: bool,
) -> Coords2d {
    let angle_from_center_to_arc_start = get_angle(center, arc_start_point);
    let angle_from_center_to_arc_end = get_angle(center, arc_end_point);
    let delta_ang = delta_angle(
        deg2rad(angle_from_center_to_arc_start),
        deg2rad(angle_from_center_to_arc_end),
    );
    let delta_ang = delta_ang / 2.0 + deg2rad(angle_from_center_to_arc_start);
    let shortest_arc_mid_point: Coords2d = [
        libm::cos(delta_ang) * radius + center[0],
        libm::sin(delta_ang) * radius + center[1],
    ];
    let opposite_delta = delta_ang + PI;
    let longest_arc_mid_point: Coords2d = [
        libm::cos(opposite_delta) * radius + center[0],
        libm::sin(opposite_delta) * radius + center[1],
    ];

    let rotation_direction_original_points = is_points_ccw(&[tan_previous_point, arc_start_point, arc_end_point]);
    let rotation_direction_points_on_arc = is_points_ccw(&[arc_start_point, shortest_arc_mid_point, arc_end_point]);
    if rotation_direction_original_points != rotation_direction_points_on_arc && obtuse {
        longest_arc_mid_point
    } else {
        shortest_arc_mid_point
    }
}

fn intersect_point_n_slope(point1: Coords2d, slope1: f64, point2: Coords2d, slope2: f64) -> Coords2d {
    let x = if slope1.abs() == f64::INFINITY {
        point1[0]
    } else if slope2.abs() == f64::INFINITY {
        point2[0]
    } else {
        (point2[1] - slope2 * point2[0] - point1[1] + slope1 * point1[0]) / (slope1 - slope2)
    };
    let y = if slope1.abs() != f64::INFINITY {
        slope1 * x - slope1 * point1[0] + point1[1]
    } else {
        slope2 * x - slope2 * point2[0] + point2[1]
    };
    [x, y]
}

/// Structure to hold input data for calculating tangential arc information.
pub struct TangentialArcInfoInput {
    /// The starting point of the arc.
    pub arc_start_point: Coords2d,
    /// The ending point of the arc.
    pub arc_end_point: Coords2d,
    /// The point from which the tangent is drawn.
    pub tan_previous_point: Coords2d,
    /// Flag to determine if the arc is obtuse. Obtuse means it flows smoothly from the previous segment.
    pub obtuse: bool,
}

/// Structure to hold the output data from calculating tangential arc information.
pub struct TangentialArcInfoOutput {
    /// The center point of the arc.
    pub center: Coords2d,
    /// The midpoint on the arc.
    pub arc_mid_point: Coords2d,
    /// The radius of the arc.
    pub radius: f64,
    /// Start angle of the arc in radians.
    pub start_angle: f64,
    /// End angle of the arc in radians.
    pub end_angle: f64,
    /// If the arc is counter-clockwise.
    pub ccw: i32,
    /// The length of the arc.
    pub arc_length: f64,
}

// tanPreviousPoint and arcStartPoint make up a straight segment leading into the arc (of which the arc should be tangential). The arc should start at arcStartPoint and end at, arcEndPoint
// With this information we should everything we need to calculate the arc's center and radius. However there is two tangential arcs possible, that just varies on their direction
// One is obtuse where the arc smoothly flows from the straight segment, and the other would be acute that immediately cuts back in the other direction. The obtuse boolean is there to control for this.
pub fn get_tangential_arc_to_info(input: TangentialArcInfoInput) -> TangentialArcInfoOutput {
    let (_, perp_slope) = get_slope(input.tan_previous_point, input.arc_start_point);
    let tangential_line_perp_slope = perp_slope;

    // Calculate the midpoint of the line segment between arcStartPoint and arcEndPoint
    let mid_point: Coords2d = [
        (input.arc_start_point[0] + input.arc_end_point[0]) / 2.0,
        (input.arc_start_point[1] + input.arc_end_point[1]) / 2.0,
    ];

    let slope_mid_point_line = get_slope(input.arc_start_point, mid_point);

    let center: Coords2d;
    let radius: f64;

    if tangential_line_perp_slope == slope_mid_point_line.0 {
        // can't find the intersection of the two lines if they have the same gradient
        // but in this case the center is the midpoint anyway
        center = mid_point;
        radius =
            ((input.arc_start_point[0] - center[0]).powi(2) + (input.arc_start_point[1] - center[1]).powi(2)).sqrt();
    } else {
        center = intersect_point_n_slope(
            mid_point,
            slope_mid_point_line.1,
            input.arc_start_point,
            tangential_line_perp_slope,
        );
        radius =
            ((input.arc_start_point[0] - center[0]).powi(2) + (input.arc_start_point[1] - center[1]).powi(2)).sqrt();
    }

    let arc_mid_point = get_mid_point(
        center,
        input.arc_start_point,
        input.arc_end_point,
        input.tan_previous_point,
        radius,
        input.obtuse,
    );

    let start_angle = libm::atan2(
        input.arc_start_point[1] - center[1],
        input.arc_start_point[0] - center[0],
    );
    let end_angle = libm::atan2(input.arc_end_point[1] - center[1], input.arc_end_point[0] - center[0]);
    let ccw = is_points_ccw(&[input.arc_start_point, arc_mid_point, input.arc_end_point]);

    let arc_mid_angle = libm::atan2(arc_mid_point[1] - center[1], arc_mid_point[0] - center[0]);
    let start_to_mid_arc_length = radius
        * delta(Angle::from_radians(start_angle), Angle::from_radians(arc_mid_angle))
            .to_radians()
            .abs();
    let mid_to_end_arc_length = radius
        * delta(Angle::from_radians(arc_mid_angle), Angle::from_radians(end_angle))
            .to_radians()
            .abs();
    let arc_length = start_to_mid_arc_length + mid_to_end_arc_length;

    TangentialArcInfoOutput {
        center,
        radius,
        arc_mid_point,
        start_angle,
        end_angle,
        ccw,
        arc_length,
    }
}

#[cfg(test)]
mod get_tangential_arc_to_info_tests {
    use approx::assert_relative_eq;

    use super::*;

    fn round_to_three_decimals(num: f64) -> f64 {
        (num * 1000.0).round() / 1000.0
    }

    #[test]
    fn test_basic_case() {
        let result = get_tangential_arc_to_info(TangentialArcInfoInput {
            tan_previous_point: [0.0, -5.0],
            arc_start_point: [0.0, 0.0],
            arc_end_point: [4.0, 0.0],
            obtuse: true,
        });
        assert_relative_eq!(result.center[0], 2.0);
        assert_relative_eq!(result.center[1], 0.0);
        assert_relative_eq!(result.arc_mid_point[0], 2.0);
        assert_relative_eq!(result.arc_mid_point[1], 2.0);
        assert_relative_eq!(result.radius, 2.0);
        assert_relative_eq!(result.start_angle, PI);
        assert_relative_eq!(result.end_angle, 0.0);
        assert_eq!(result.ccw, -1);
    }

    #[test]
    fn basic_case_with_arc_centered_at_0_0_and_the_tangential_line_being_45_degrees() {
        let result = get_tangential_arc_to_info(TangentialArcInfoInput {
            tan_previous_point: [0.0, -4.0],
            arc_start_point: [2.0, -2.0],
            arc_end_point: [-2.0, 2.0],
            obtuse: true,
        });
        assert_relative_eq!(result.center[0], 0.0);
        assert_relative_eq!(result.center[1], 0.0);
        assert_relative_eq!(round_to_three_decimals(result.arc_mid_point[0]), 2.0);
        assert_relative_eq!(round_to_three_decimals(result.arc_mid_point[1]), 2.0);
        assert_relative_eq!(result.radius, (2.0f64 * 2.0 + 2.0 * 2.0).sqrt());
        assert_relative_eq!(result.start_angle, -PI / 4.0);
        assert_relative_eq!(result.end_angle, 3.0 * PI / 4.0);
        assert_eq!(result.ccw, 1);
    }

    #[test]
    fn test_get_tangential_arc_to_info_moving_arc_end_point() {
        let result = get_tangential_arc_to_info(TangentialArcInfoInput {
            tan_previous_point: [0.0, -4.0],
            arc_start_point: [2.0, -2.0],
            arc_end_point: [2.0, 2.0],
            obtuse: true,
        });
        let expected_radius = (2.0f64 * 2.0 + 2.0 * 2.0).sqrt();
        assert_relative_eq!(round_to_three_decimals(result.center[0]), 0.0);
        assert_relative_eq!(result.center[1], 0.0);
        assert_relative_eq!(result.arc_mid_point[0], expected_radius);
        assert_relative_eq!(round_to_three_decimals(result.arc_mid_point[1]), -0.0);
        assert_relative_eq!(result.radius, expected_radius);
        assert_relative_eq!(result.start_angle, -PI / 4.0);
        assert_relative_eq!(result.end_angle, PI / 4.0);
        assert_eq!(result.ccw, 1);
    }

    #[test]
    fn test_get_tangential_arc_to_info_moving_arc_end_point_again() {
        let result = get_tangential_arc_to_info(TangentialArcInfoInput {
            tan_previous_point: [0.0, -4.0],
            arc_start_point: [2.0, -2.0],
            arc_end_point: [-2.0, -2.0],
            obtuse: true,
        });
        let expected_radius = (2.0f64 * 2.0 + 2.0 * 2.0).sqrt();
        assert_relative_eq!(result.center[0], 0.0);
        assert_relative_eq!(result.center[1], 0.0);
        assert_relative_eq!(result.radius, expected_radius);
        assert_relative_eq!(round_to_three_decimals(result.arc_mid_point[0]), 0.0);
        assert_relative_eq!(result.arc_mid_point[1], expected_radius);
        assert_relative_eq!(result.start_angle, -PI / 4.0);
        assert_relative_eq!(result.end_angle, -3.0 * PI / 4.0);
        assert_eq!(result.ccw, 1);
    }

    #[test]
    fn test_get_tangential_arc_to_info_acute_moving_arc_end_point() {
        let result = get_tangential_arc_to_info(TangentialArcInfoInput {
            tan_previous_point: [0.0, -4.0],
            arc_start_point: [2.0, -2.0],
            arc_end_point: [-2.0, -2.0],
            obtuse: false,
        });
        let expected_radius = (2.0f64 * 2.0 + 2.0 * 2.0).sqrt();
        assert_relative_eq!(result.center[0], 0.0);
        assert_relative_eq!(result.center[1], 0.0);
        assert_relative_eq!(result.radius, expected_radius);
        assert_relative_eq!(round_to_three_decimals(result.arc_mid_point[0]), -0.0);
        assert_relative_eq!(result.arc_mid_point[1], -expected_radius);
        assert_relative_eq!(result.start_angle, -PI / 4.0);
        assert_relative_eq!(result.end_angle, -3.0 * PI / 4.0);
        // would be cw if it was obtuse
        assert_eq!(result.ccw, -1);
    }

    #[test]
    fn test_get_tangential_arc_to_info_obtuse_with_wrap_around() {
        let arc_end = libm::cos(std::f64::consts::PI / 4.0) * 2.0;
        let result = get_tangential_arc_to_info(TangentialArcInfoInput {
            tan_previous_point: [2.0, -4.0],
            arc_start_point: [2.0, 0.0],
            arc_end_point: [0.0, -2.0],
            obtuse: true,
        });
        assert_relative_eq!(result.center[0], -0.0);
        assert_relative_eq!(result.center[1], 0.0);
        assert_relative_eq!(result.radius, 2.0);
        assert_relative_eq!(result.arc_mid_point[0], -arc_end);
        assert_relative_eq!(result.arc_mid_point[1], arc_end);
        assert_relative_eq!(result.start_angle, 0.0);
        assert_relative_eq!(result.end_angle, -PI / 2.0);
        assert_eq!(result.ccw, 1);
    }

    #[test]
    fn test_arc_length_obtuse_cw() {
        let result = get_tangential_arc_to_info(TangentialArcInfoInput {
            tan_previous_point: [-1.0, -1.0],
            arc_start_point: [-1.0, 0.0],
            arc_end_point: [0.0, -1.0],
            obtuse: true,
        });
        let circumference = 2.0 * PI * result.radius;
        let expected_length = circumference * 3.0 / 4.0; // 3 quarters of a circle circle
        assert_relative_eq!(result.arc_length, expected_length);
    }

    #[test]
    fn test_arc_length_acute_cw() {
        let result = get_tangential_arc_to_info(TangentialArcInfoInput {
            tan_previous_point: [-1.0, -1.0],
            arc_start_point: [-1.0, 0.0],
            arc_end_point: [0.0, 1.0],
            obtuse: true,
        });
        let circumference = 2.0 * PI * result.radius;
        let expected_length = circumference / 4.0; // 1 quarters of a circle circle
        assert_relative_eq!(result.arc_length, expected_length);
    }

    #[test]
    fn test_arc_length_obtuse_ccw() {
        let result = get_tangential_arc_to_info(TangentialArcInfoInput {
            tan_previous_point: [1.0, -1.0],
            arc_start_point: [1.0, 0.0],
            arc_end_point: [0.0, -1.0],
            obtuse: true,
        });
        let circumference = 2.0 * PI * result.radius;
        let expected_length = circumference * 3.0 / 4.0; // 1 quarters of a circle circle
        assert_relative_eq!(result.arc_length, expected_length);
    }

    #[test]
    fn test_arc_length_acute_ccw() {
        let result = get_tangential_arc_to_info(TangentialArcInfoInput {
            tan_previous_point: [1.0, -1.0],
            arc_start_point: [1.0, 0.0],
            arc_end_point: [0.0, 1.0],
            obtuse: true,
        });
        let circumference = 2.0 * PI * result.radius;
        let expected_length = circumference / 4.0; // 1 quarters of a circle circle
        assert_relative_eq!(result.arc_length, expected_length);
    }
}

pub(crate) fn get_tangent_point_from_previous_arc(
    last_arc_center: Coords2d,
    last_arc_ccw: bool,
    last_arc_end: Coords2d,
) -> Coords2d {
    let angle_from_old_center_to_arc_start = get_angle(last_arc_center, last_arc_end);
    let tangential_angle = angle_from_old_center_to_arc_start + if last_arc_ccw { -90.0 } else { 90.0 };
    // What is the 10.0 constant doing???
    [
        libm::cos(tangential_angle.to_radians()) * 10.0 + last_arc_end[0],
        libm::sin(tangential_angle.to_radians()) * 10.0 + last_arc_end[1],
    ]
}
