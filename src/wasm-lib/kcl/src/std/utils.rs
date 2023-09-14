use crate::{
    errors::{KclError, KclErrorDetails},
    executor::{Point2d, SourceRange},
};

#[derive(Clone, Copy, Default, PartialOrd, PartialEq, Debug)]
pub struct Angle {
    degrees: f64,
}

impl Angle {
    const ZERO: Self = Self { degrees: 0.0 };
    /// Make an angle of the given degrees.
    pub fn from_degrees(degrees: f64) -> Self {
        Self { degrees }
    }
    /// Make an angle of the given radians.
    pub fn from_radians(radians: f64) -> Self {
        Self::from_degrees(radians.to_degrees())
    }
    /// Get the angle in degrees
    pub fn degrees(&self) -> f64 {
        self.degrees
    }
    /// Get the angle in radians
    pub fn radians(&self) -> f64 {
        self.degrees.to_radians()
    }
    /// Get the angle between these points
    pub fn between(a: Point2d, b: Point2d) -> Self {
        let x = b.x - a.x;
        let y = b.y - a.y;
        Self::from_radians(y.atan2(x)).normalize()
    }
    /// Normalize the angle
    pub fn normalize(self) -> Self {
        let angle = self.degrees();
        let result = ((angle % 360.0) + 360.0) % 360.0;
        Self::from_degrees(if result > 180.0 { result - 360.0 } else { result })
    }
    /// Gives the ▲-angle between from and to angles (shortest path), use radians.
    ///
    /// Sign of the returned angle denotes direction, positive means counterClockwise 🔄
    /// # Examples
    ///
    /// ```
    /// assert_eq!(
    ///     kcl_lib::std::utils::delta_angle(std::f64::consts::PI / 8.0, std::f64::consts::PI / 4.0),
    ///     std::f64::consts::PI / 8.0
    /// );
    /// ```
    #[allow(dead_code)]
    pub fn delta(from_angle: Self, to_angle: Self) -> Self {
        let norm_from_angle = normalize_rad(from_angle.radians());
        let norm_to_angle = normalize_rad(to_angle.radians());
        let provisional = norm_to_angle - norm_from_angle;

        if provisional > -std::f64::consts::PI && provisional <= std::f64::consts::PI {
            return Angle::from_radians(provisional);
        }
        if provisional > std::f64::consts::PI {
            return Angle::from_radians(provisional - 2.0 * std::f64::consts::PI);
        }
        if provisional < -std::f64::consts::PI {
            return Angle::from_radians(provisional + 2.0 * std::f64::consts::PI);
        }
        Angle::ZERO
    }
}

#[allow(dead_code)]
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

#[allow(dead_code)]
pub fn normalize_rad(angle: f64) -> f64 {
    let draft = angle % (2.0 * std::f64::consts::PI);
    if draft < 0.0 {
        draft + 2.0 * std::f64::consts::PI
    } else {
        draft
    }
}

/// Calculates the distance between two points.
///
/// # Examples
///
/// ```
/// assert_eq!(
///     kcl_lib::std::utils::distance_between_points(&[0.0, 0.0], &[0.0, 5.0]),
///     5.0
/// );
/// assert_eq!(
///     kcl_lib::std::utils::distance_between_points(&[0.0, 0.0], &[3.0, 4.0]),
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

pub fn arc_center_and_end(from: Point2d, start_angle_deg: f64, end_angle_deg: f64, radius: f64) -> (Point2d, Point2d) {
    let start_angle = start_angle_deg.to_radians();
    let end_angle = end_angle_deg.to_radians();

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
) -> Result<(f64, f64), KclError> {
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

    let start_angle_deg = start_angle.to_degrees();
    let end_angle_deg = end_angle.to_degrees();

    Ok((start_angle_deg, end_angle_deg))
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
        let (center, end) = super::arc_center_and_end(super::Point2d { x: 0.0, y: 0.0 }, 0.0, 90.0, 1.0);
        assert_eq!(center.x.round(), -1.0);
        assert_eq!(center.y, 0.0);
        assert_eq!(end.x.round(), -1.0);
        assert_eq!(end.y, 1.0);

        let (center, end) = super::arc_center_and_end(super::Point2d { x: 0.0, y: 0.0 }, 0.0, 180.0, 1.0);
        assert_eq!(center.x.round(), -1.0);
        assert_eq!(center.y, 0.0);
        assert_eq!(end.x.round(), -2.0);
        assert_eq!(end.y.round(), 0.0);

        let (center, end) = super::arc_center_and_end(super::Point2d { x: 0.0, y: 0.0 }, 0.0, 180.0, 10.0);
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
        assert_eq!(angle_start.round(), 0.0);
        assert_eq!(angle_end.round(), 90.0);

        let (angle_start, angle_end) = super::arc_angles(
            super::Point2d { x: 0.0, y: 0.0 },
            super::Point2d { x: -2.0, y: 0.0 },
            super::Point2d { x: -1.0, y: 0.0 },
            1.0,
            SourceRange(Default::default()),
        )
        .unwrap();
        assert_eq!(angle_start.round(), 0.0);
        assert_eq!(angle_end.round(), 180.0);

        let (angle_start, angle_end) = super::arc_angles(
            super::Point2d { x: 0.0, y: 0.0 },
            super::Point2d { x: -20.0, y: 0.0 },
            super::Point2d { x: -10.0, y: 0.0 },
            10.0,
            SourceRange(Default::default()),
        )
        .unwrap();
        assert_eq!(angle_start.round(), 0.0);
        assert_eq!(angle_end.round(), 180.0);

        let result = super::arc_angles(
            super::Point2d { x: 0.0, y: 5.0 },
            super::Point2d { x: 5.0, y: 5.0 },
            super::Point2d { x: 10.0, y: -10.0 },
            10.0,
            SourceRange(Default::default()),
        );

        if let Err(err) = result {
            assert!(err.to_string().contains( "Point Point2d { x: 0.0, y: 5.0 } is not on the circumference of the circle with center Point2d { x: 10.0, y: -10.0 } and radius 10."));
        } else {
            panic!("Expected error");
        }
        assert_eq!(angle_start.round(), 0.0);
        assert_eq!(angle_end.round(), 180.0);
    }
}
