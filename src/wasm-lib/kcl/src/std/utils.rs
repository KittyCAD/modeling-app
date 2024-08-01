use std::f64::consts::PI;

use kittycad::types::Angle;

use crate::{
    errors::{KclError, KclErrorDetails},
    executor::{Point2d, SourceRange},
};

/// Get the angle between these points
pub fn between(a: Point2d, b: Point2d) -> Angle {
    let x = b.x - a.x;
    let y = b.y - a.y;
    normalize(Angle::from_radians(y.atan2(x)))
}

/// Normalize the angle
pub fn normalize(angle: Angle) -> Angle {
    let deg = angle.degrees();
    let result = ((deg % 360.0) + 360.0) % 360.0;
    Angle::from_degrees(if result > 180.0 { result - 360.0 } else { result })
}

/// Gives the ▲-angle between from and to angles (shortest path), use radians.
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
pub fn delta(from_angle: Angle, to_angle: Angle) -> Angle {
    let norm_from_angle = normalize_rad(from_angle.radians());
    let norm_to_angle = normalize_rad(to_angle.radians());
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
    Angle::ZERO
}

pub fn clockwise_sign(points: &[Point2d]) -> i32 {
    let mut sum = 0.0;
    for i in 0..points.len() {
        let current_point = points[i];
        let next_point = points[(i + 1) % points.len()];
        sum += (next_point.x - current_point.x) * (next_point.y + current_point.y);
    }
    if sum >= 0.0 {
        1
    } else {
        -1
    }
}

pub fn normalize_rad(angle: f64) -> f64 {
    let draft = angle % (2.0 * PI);
    if draft < 0.0 {
        draft + 2.0 * PI
    } else {
        draft
    }
}

/// Calculates the distance between two points.
///
/// # Examples
///
/// ```
/// use kcl_lib::executor::Point2d;
///
/// assert_eq!(
///     kcl_lib::std::utils::distance_between_points(Point2d::ZERO, Point2d { x: 0.0, y: 5.0 }),
///     5.0
/// );
/// assert_eq!(
///     kcl_lib::std::utils::distance_between_points(Point2d::ZERO, Point2d { x: 3.0, y: 4.0 }),
///     5.0
/// );
/// ```
#[allow(dead_code)]
pub fn distance_between_points(point_a: Point2d, point_b: Point2d) -> f64 {
    let x1 = point_a.x;
    let y1 = point_a.y;
    let x2 = point_b.x;
    let y2 = point_b.y;

    ((y2 - y1).powi(2) + (x2 - x1).powi(2)).sqrt()
}

pub fn calculate_intersection_of_two_lines(line1: &[Point2d; 2], line2_angle: f64, line2_point: Point2d) -> Point2d {
    let line2_point_b = Point2d {
        x: line2_point.x + f64::cos(line2_angle.to_radians()) * 10.0,
        y: line2_point.y + f64::sin(line2_angle.to_radians()) * 10.0,
    };
    intersect(line1[0], line1[1], line2_point, line2_point_b)
}

pub fn intersect(p1: Point2d, p2: Point2d, p3: Point2d, p4: Point2d) -> Point2d {
    let slope = |p1: Point2d, p2: Point2d| (p1.y - p2.y) / (p1.x - p2.x);
    let constant = |p1: Point2d, p2: Point2d| p1.y - slope(p1, p2) * p1.x;
    let get_y = |for_x: f64, p1: Point2d, p2: Point2d| slope(p1, p2) * for_x + constant(p1, p2);

    if p1.x == p2.x {
        return Point2d {
            x: p1.x,
            y: get_y(p1.x, p3, p4),
        };
    }
    if p3.x == p4.x {
        return Point2d {
            x: p3.x,
            y: get_y(p3.x, p1, p2),
        };
    }

    let x = (constant(p3, p4) - constant(p1, p2)) / (slope(p1, p2) - slope(p3, p4));
    let y = get_y(x, p1, p2);
    Point2d { x, y }
}

pub fn intersection_with_parallel_line(
    line1: &[Point2d; 2],
    line1_offset: f64,
    line2_angle: f64,
    line2_point: Point2d,
) -> Point2d {
    calculate_intersection_of_two_lines(&offset_line(line1_offset, line1[0], line1[1]), line2_angle, line2_point)
}

fn offset_line(offset: f64, p1: Point2d, p2: Point2d) -> [Point2d; 2] {
    if p1.x == p2.x {
        let direction = (p1.y - p2.y).signum();
        return [
            Point2d {
                x: p1.x + offset * direction,
                y: p1.y,
            },
            Point2d {
                x: p2.x + offset * direction,
                y: p2.y,
            },
        ];
    }
    if p1.y == p2.y {
        let direction = (p2.x - p1.x).signum();
        return [
            Point2d {
                x: p1.x,
                y: p1.y + offset * direction,
            },
            Point2d {
                x: p2.x,
                y: p2.y + offset * direction,
            },
        ];
    }
    let x_offset = offset / f64::sin(f64::atan2(p1.y - p2.y, p1.x - p2.x));
    [
        Point2d {
            x: p1.x + x_offset,
            y: p1.y,
        },
        Point2d {
            x: p2.x + x_offset,
            y: p2.y,
        },
    ]
}

pub fn get_y_component(angle: Angle, x: f64) -> Point2d {
    let normalised_angle = ((angle.degrees() % 360.0) + 360.0) % 360.0; // between 0 and 360
    let y = x * f64::tan(normalised_angle.to_radians());
    let sign = if normalised_angle > 90.0 && normalised_angle <= 270.0 {
        -1.0
    } else {
        1.0
    };
    Point2d { x, y }.scale(sign)
}

pub fn get_x_component(angle: Angle, y: f64) -> Point2d {
    let normalised_angle = ((angle.degrees() % 360.0) + 360.0) % 360.0; // between 0 and 360
    let x = y / f64::tan(normalised_angle.to_radians());
    let sign = if normalised_angle > 180.0 && normalised_angle <= 360.0 {
        -1.0
    } else {
        1.0
    };
    Point2d { x, y }.scale(sign)
}

pub fn arc_center_and_end(from: Point2d, start_angle: Angle, end_angle: Angle, radius: f64) -> (Point2d, Point2d) {
    let start_angle = start_angle.radians();
    let end_angle = end_angle.radians();

    let center = Point2d {
        x: -1.0 * (radius * start_angle.cos() - from.x),
        y: -1.0 * (radius * start_angle.sin() - from.y),
    };

    let end = Point2d {
        x: center.x + radius * end_angle.cos(),
        y: center.y + radius * end_angle.sin(),
    };

    (center, end)
}

pub fn arc_angles(
    from: Point2d,
    to: Point2d,
    center: Point2d,
    radius: f64,
    source_range: SourceRange,
) -> Result<(Angle, Angle), KclError> {
    // First make sure that the points are on the circumference of the circle.
    // If not, we'll return an error.
    if !is_on_circumference(center, from, radius) {
        return Err(KclError::Semantic(KclErrorDetails {
            message: format!(
                "Point {:?} is not on the circumference of the circle with center {:?} and radius {}.",
                from, center, radius
            ),
            source_ranges: vec![source_range],
        }));
    }

    if !is_on_circumference(center, to, radius) {
        return Err(KclError::Semantic(KclErrorDetails {
            message: format!(
                "Point {:?} is not on the circumference of the circle with center {:?} and radius {}.",
                to, center, radius
            ),
            source_ranges: vec![source_range],
        }));
    }

    let start_angle = (from.y - center.y).atan2(from.x - center.x);
    let end_angle = (to.y - center.y).atan2(to.x - center.x);

    Ok((Angle::from_radians(start_angle), Angle::from_radians(end_angle)))
}

pub fn is_on_circumference(center: Point2d, point: Point2d, radius: f64) -> bool {
    let dx = point.x - center.x;
    let dy = point.y - center.y;

    let distance_squared = dx.powi(2) + dy.powi(2);

    // We'll check if the distance squared is approximately equal to radius squared.
    // Due to potential floating point inaccuracies, we'll check if the difference
    // is very small (e.g., 1e-9) rather than checking for strict equality.
    (distance_squared - radius.powi(2)).abs() < 1e-9
}

#[cfg(test)]
mod tests {
    // Here you can bring your functions into scope
    use pretty_assertions::assert_eq;

    use super::{get_x_component, get_y_component, Angle};
    use crate::executor::SourceRange;

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
            results.push([res.x.round() as i32, res.y.round() as i32]);
            expected.push(expected_result);
        }

        assert_eq!(results, expected);

        let result = get_y_component(Angle::ZERO, 1.0);
        assert_eq!(result.x as i32, 1);
        assert_eq!(result.y as i32, 0);

        let result = get_y_component(Angle::from_degrees(90.0), 1.0);
        assert_eq!(result.x as i32, 1);
        assert!(result.y > 100000.0);

        let result = get_y_component(Angle::from_degrees(180.0), 1.0);
        assert_eq!(result.x as i32, -1);
        assert!((result.y - 0.0).abs() < f64::EPSILON);

        let result = get_y_component(Angle::from_degrees(270.0), 1.0);
        assert_eq!(result.x as i32, -1);
        assert!(result.y < -100000.0);
    }

    #[test]
    fn test_get_x_component() {
        let mut expected = Vec::new();
        let mut results = Vec::new();

        for &(angle, expected_result) in EACH_QUAD.iter() {
            let res = get_x_component(Angle::from_degrees(angle as f64), 1.0);
            results.push([res.x.round() as i32, res.y.round() as i32]);
            expected.push(expected_result);
        }

        assert_eq!(results, expected);

        let result = get_x_component(Angle::ZERO, 1.0);
        assert!(result.x > 100000.0);
        assert_eq!(result.y as i32, 1);

        let result = get_x_component(Angle::from_degrees(90.0), 1.0);
        assert!((result.x - 0.0).abs() < f64::EPSILON);
        assert_eq!(result.y as i32, 1);

        let result = get_x_component(Angle::from_degrees(180.0), 1.0);
        assert!(result.x < -100000.0);
        assert_eq!(result.y as i32, 1);

        let result = get_x_component(Angle::from_degrees(270.0), 1.0);
        assert!((result.x - 0.0).abs() < f64::EPSILON);
        assert_eq!(result.y as i32, -1);
    }

    #[test]
    fn test_arc_center_and_end() {
        let (center, end) = super::arc_center_and_end(
            super::Point2d { x: 0.0, y: 0.0 },
            Angle::ZERO,
            Angle::from_degrees(90.0),
            1.0,
        );
        assert_eq!(center.x.round(), -1.0);
        assert_eq!(center.y, 0.0);
        assert_eq!(end.x.round(), -1.0);
        assert_eq!(end.y, 1.0);

        let (center, end) = super::arc_center_and_end(
            super::Point2d { x: 0.0, y: 0.0 },
            Angle::ZERO,
            Angle::from_degrees(180.0),
            1.0,
        );
        assert_eq!(center.x.round(), -1.0);
        assert_eq!(center.y, 0.0);
        assert_eq!(end.x.round(), -2.0);
        assert_eq!(end.y.round(), 0.0);

        let (center, end) = super::arc_center_and_end(
            super::Point2d { x: 0.0, y: 0.0 },
            Angle::ZERO,
            Angle::from_degrees(180.0),
            10.0,
        );
        assert_eq!(center.x.round(), -10.0);
        assert_eq!(center.y, 0.0);
        assert_eq!(end.x.round(), -20.0);
        assert_eq!(end.y.round(), 0.0);
    }

    #[test]
    fn test_arc_angles() {
        let (angle_start, angle_end) = super::arc_angles(
            super::Point2d { x: 0.0, y: 0.0 },
            super::Point2d { x: -1.0, y: 1.0 },
            super::Point2d { x: -1.0, y: 0.0 },
            1.0,
            SourceRange(Default::default()),
        )
        .unwrap();
        assert_eq!(angle_start.degrees().round(), 0.0);
        assert_eq!(angle_end.degrees().round(), 90.0);

        let (angle_start, angle_end) = super::arc_angles(
            super::Point2d { x: 0.0, y: 0.0 },
            super::Point2d { x: -2.0, y: 0.0 },
            super::Point2d { x: -1.0, y: 0.0 },
            1.0,
            SourceRange(Default::default()),
        )
        .unwrap();
        assert_eq!(angle_start.degrees().round(), 0.0);
        assert_eq!(angle_end.degrees().round(), 180.0);

        let (angle_start, angle_end) = super::arc_angles(
            super::Point2d { x: 0.0, y: 0.0 },
            super::Point2d { x: -20.0, y: 0.0 },
            super::Point2d { x: -10.0, y: 0.0 },
            10.0,
            SourceRange(Default::default()),
        )
        .unwrap();
        assert_eq!(angle_start.degrees().round(), 0.0);
        assert_eq!(angle_end.degrees().round(), 180.0);

        let result = super::arc_angles(
            super::Point2d { x: 0.0, y: 5.0 },
            super::Point2d { x: 5.0, y: 5.0 },
            super::Point2d { x: 10.0, y: -10.0 },
            10.0,
            SourceRange(Default::default()),
        );

        if let Err(err) = result {
            assert!(err.to_string().contains("Point Point2d { x: 0.0, y: 5.0 } is not on the circumference of the circle with center Point2d { x: 10.0, y: -10.0 } and radius 10."));
        } else {
            panic!("Expected error");
        }
        assert_eq!(angle_start.degrees().round(), 0.0);
        assert_eq!(angle_end.degrees().round(), 180.0);
    }
}

pub type Coords2d = [f64; 2];

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

pub fn is_points_ccw(points: &[Coords2d]) -> i32 {
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
    let angle = delta_y.atan2(delta_x);

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
        delta_ang.cos() * radius + center[0],
        delta_ang.sin() * radius + center[1],
    ];
    let opposite_delta = delta_ang + PI;
    let longest_arc_mid_point: Coords2d = [
        opposite_delta.cos() * radius + center[0],
        opposite_delta.sin() * radius + center[1],
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

    let start_angle = (input.arc_start_point[1] - center[1]).atan2(input.arc_start_point[0] - center[0]);
    let end_angle = (input.arc_end_point[1] - center[1]).atan2(input.arc_end_point[0] - center[0]);
    let ccw = is_points_ccw(&[input.arc_start_point, arc_mid_point, input.arc_end_point]);

    let arc_mid_angle = (arc_mid_point[1] - center[1]).atan2(arc_mid_point[0] - center[0]);
    let start_to_mid_arc_length = radius
        * delta(Angle::from_radians(start_angle), Angle::from_radians(arc_mid_angle))
            .radians()
            .abs();
    let mid_to_end_arc_length = radius
        * delta(Angle::from_radians(arc_mid_angle), Angle::from_radians(end_angle))
            .radians()
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
        let arc_end = (std::f64::consts::PI / 4.0).cos() * 2.0;
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

pub fn get_tangent_point_from_previous_arc(
    last_arc_center: Coords2d,
    last_arc_ccw: bool,
    last_arc_end: Coords2d,
) -> Coords2d {
    let angle_from_old_center_to_arc_start = get_angle(last_arc_center, last_arc_end);
    let tangential_angle = angle_from_old_center_to_arc_start + if last_arc_ccw { -90.0 } else { 90.0 };
    [
        tangential_angle.to_radians().cos() * 10.0 + last_arc_end[0],
        tangential_angle.to_radians().sin() * 10.0 + last_arc_end[1],
    ]
}
