pub fn get_angle(a: &[f64; 2], b: &[f64; 2]) -> f64 {
    let x = b[0] - a[0];
    let y = b[1] - a[1];
    normalise_angle(y.atan2(x) * 180.0 / std::f64::consts::PI)
}

pub fn normalise_angle(angle: f64) -> f64 {
    let result = ((angle % 360.0) + 360.0) % 360.0;
    if result > 180.0 {
        result - 360.0
    } else {
        result
    }
}

#[allow(dead_code)]
pub fn clockwise_sign(points: &[[f64; 2]]) -> i32 {
    let mut sum = 0.0;
    for i in 0..points.len() {
        let current_point = points[i];
        let next_point = points[(i + 1) % points.len()];
        sum += (next_point[0] - current_point[0]) * (next_point[1] + current_point[1]);
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

/// Gives the ▲-angle between from and to angles (shortest path), use radians.
///
/// Sign of the returned angle denotes direction, positive means counterClockwise 🔄
/// # Examples
///
/// ```
/// assert_eq!(crate::std::utils::delta_angle(std::f64::consts::PI/8.0, std::f64::consts::PI/4.0), std::f64::consts::PI/8.0);
/// ```
#[allow(dead_code)]
pub fn delta_angle(from_angle: f64, to_angle: f64) -> f64 {
    let norm_from_angle = normalize_rad(from_angle);
    let norm_to_angle = normalize_rad(to_angle);
    let provisional = norm_to_angle - norm_from_angle;

    if provisional > -std::f64::consts::PI && provisional <= std::f64::consts::PI {
        return provisional;
    }
    if provisional > std::f64::consts::PI {
        return provisional - 2.0 * std::f64::consts::PI;
    }
    if provisional < -std::f64::consts::PI {
        return provisional + 2.0 * std::f64::consts::PI;
    }
    0.0
}

/// Calculates the distance between two points.
///
/// # Examples
///
/// ```
/// assert_eq!(crate::std::utils::distance_between_points(&[0.0, 0.0], &[0.0, 5.0]), 5.0);
/// assert_eq!(crate::std::utils::distance_between_points(&[0.0, 0.0], &[3.0, 4.0]), 5.0);
/// ```
#[allow(dead_code)]
pub fn distance_between_points(point_a: &[f64; 2], point_b: &[f64; 2]) -> f64 {
    let x1 = point_a[0];
    let y1 = point_a[1];
    let x2 = point_b[0];
    let y2 = point_b[1];

    ((y2 - y1).powi(2) + (x2 - x1).powi(2)).sqrt()
}

pub fn calculate_intersection_of_two_lines(
    line1: &[[f64; 2]; 2],
    line2_angle: f64,
    line2_point: [f64; 2],
) -> [f64; 2] {
    let line2_point_b = [
        line2_point[0] + f64::cos(line2_angle * std::f64::consts::PI / 180.0) * 10.0,
        line2_point[1] + f64::sin(line2_angle * std::f64::consts::PI / 180.0) * 10.0,
    ];
    intersect(line1[0], line1[1], line2_point, line2_point_b)
}

pub fn intersect(p1: [f64; 2], p2: [f64; 2], p3: [f64; 2], p4: [f64; 2]) -> [f64; 2] {
    let slope = |p1: [f64; 2], p2: [f64; 2]| (p1[1] - p2[1]) / (p1[0] - p2[0]);
    let constant = |p1: [f64; 2], p2: [f64; 2]| p1[1] - slope(p1, p2) * p1[0];
    let get_y = |for_x: f64, p1: [f64; 2], p2: [f64; 2]| slope(p1, p2) * for_x + constant(p1, p2);

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

pub fn intersection_with_parallel_line(
    line1: &[[f64; 2]; 2],
    line1_offset: f64,
    line2_angle: f64,
    line2_point: [f64; 2],
) -> [f64; 2] {
    calculate_intersection_of_two_lines(
        &offset_line(line1_offset, line1[0], line1[1]),
        line2_angle,
        line2_point,
    )
}

fn offset_line(offset: f64, p1: [f64; 2], p2: [f64; 2]) -> [[f64; 2]; 2] {
    if p1[0] == p2[0] {
        let direction = (p1[1] - p2[1]).signum();
        return [
            [p1[0] + offset * direction, p1[1]],
            [p2[0] + offset * direction, p2[1]],
        ];
    }
    if p1[1] == p2[1] {
        let direction = (p2[0] - p1[0]).signum();
        return [
            [p1[0], p1[1] + offset * direction],
            [p2[0], p2[1] + offset * direction],
        ];
    }
    let x_offset = offset / f64::sin(f64::atan2(p1[1] - p2[1], p1[0] - p2[0]));
    [[p1[0] + x_offset, p1[1]], [p2[0] + x_offset, p2[1]]]
}

pub fn get_y_component(angle_degree: f64, x_component: f64) -> [f64; 2] {
    let normalised_angle = ((angle_degree % 360.0) + 360.0) % 360.0; // between 0 and 360
    let y_component = x_component * f64::tan(normalised_angle * std::f64::consts::PI / 180.0);
    let sign = if normalised_angle > 90.0 && normalised_angle <= 270.0 {
        -1.0
    } else {
        1.0
    };
    [sign * x_component, sign * y_component]
}

pub fn get_x_component(angle_degree: f64, y_component: f64) -> [f64; 2] {
    let normalised_angle = ((angle_degree % 360.0) + 360.0) % 360.0; // between 0 and 360
    let x_component = y_component / f64::tan(normalised_angle * std::f64::consts::PI / 180.0);
    let sign = if normalised_angle > 180.0 && normalised_angle <= 360.0 {
        -1.0
    } else {
        1.0
    };
    [sign * x_component, sign * y_component]
}

#[cfg(test)]
mod tests {
    // Here you can bring your functions into scope
    use super::{get_x_component, get_y_component};
    use pretty_assertions::assert_eq;

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
            let res = get_y_component(angle as f64, 1.0);
            results.push([res[0].round() as i32, res[1].round() as i32]);
            expected.push(expected_result);
        }

        assert_eq!(results, expected);

        let result = get_y_component(0.0, 1.0);
        assert_eq!(result[0] as i32, 1);
        assert_eq!(result[1] as i32, 0);

        let result = get_y_component(90.0, 1.0);
        assert_eq!(result[0] as i32, 1);
        assert!(result[1] > 100000.0);

        let result = get_y_component(180.0, 1.0);
        assert_eq!(result[0] as i32, -1);
        assert!((result[1] - 0.0).abs() < f64::EPSILON);

        let result = get_y_component(270.0, 1.0);
        assert_eq!(result[0] as i32, -1);
        assert!(result[1] < -100000.0);
    }

    #[test]
    fn test_get_x_component() {
        let mut expected = Vec::new();
        let mut results = Vec::new();

        for &(angle, expected_result) in EACH_QUAD.iter() {
            let res = get_x_component(angle as f64, 1.0);
            results.push([res[0].round() as i32, res[1].round() as i32]);
            expected.push(expected_result);
        }

        assert_eq!(results, expected);

        let result = get_x_component(0.0, 1.0);
        assert!(result[0] > 100000.0);
        assert_eq!(result[1] as i32, 1);

        let result = get_x_component(90.0, 1.0);
        assert!((result[0] - 0.0).abs() < f64::EPSILON);
        assert_eq!(result[1] as i32, 1);

        let result = get_x_component(180.0, 1.0);
        assert!(result[0] < -100000.0);
        assert_eq!(result[1] as i32, 1);

        let result = get_x_component(270.0, 1.0);
        assert!((result[0] - 0.0).abs() < f64::EPSILON);
        assert_eq!(result[1] as i32, -1);
    }
}
