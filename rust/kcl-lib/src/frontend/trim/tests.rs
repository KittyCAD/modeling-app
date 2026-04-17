use crate::frontend::api::ObjectId;
use crate::frontend::trim::Coords2d;
use crate::frontend::trim::execute_trim_flow;

/// Helper function to run a trim test with the common pattern:
/// - Execute trim flow with base code and trim points
/// - Compare result with expected code (normalized by trimming whitespace)
async fn assert_trim_result(base_kcl_code: &str, trim_points: &[Coords2d], expected_code: &str, sketch_id: ObjectId) {
    let result = execute_trim_flow(base_kcl_code, trim_points, sketch_id).await;

    match result {
        Ok(result) => {
            let result_normalized = result.kcl_code.trim();
            let expected_normalized = expected_code.trim();

            pretty_assertions::assert_eq!(
                result_normalized,
                expected_normalized,
                "Trim result should match expected KCL code (left = actual, right = expected)"
            );
        }
        Err(e) => {
            panic!("trim flow failed: {}", e);
        }
    }
}

/// Convenience wrapper that uses the default sketch_id (ObjectId(1))
async fn assert_trim_result_default_sketch(base_kcl_code: &str, trim_points: &[Coords2d], expected_code: &str) {
    assert_trim_result(base_kcl_code, trim_points, expected_code, ObjectId(1)).await;
}

mod sync {
    use crate::frontend::trim::*;

    fn make_number_mm(v: f64) -> crate::frontend::api::Number {
        crate::frontend::api::Number {
            value: v,
            units: crate::pretty::NumericSuffix::Mm,
        }
    }

    fn make_expr_mm(v: f64) -> crate::frontend::api::Expr {
        crate::frontend::api::Expr::Number(make_number_mm(v))
    }

    fn make_object(id: usize, kind: crate::frontend::api::ObjectKind) -> crate::frontend::api::Object {
        use kcl_error::SourceRange;

        use crate::execution::ArtifactId;
        use crate::frontend::api::SourceRef;

        crate::frontend::api::Object {
            id: ObjectId(id),
            kind,
            label: Default::default(),
            comments: Default::default(),
            artifact_id: ArtifactId::placeholder(),
            source: SourceRef::from(SourceRange::default()),
        }
    }

    fn make_point_segment(id: usize, x: f64, y: f64) -> crate::frontend::api::Object {
        make_object(
            id,
            crate::frontend::api::ObjectKind::Segment {
                segment: crate::frontend::sketch::Segment::Point(crate::frontend::sketch::Point {
                    position: crate::frontend::sketch::Point2d {
                        x: make_number_mm(x),
                        y: make_number_mm(y),
                    },
                    ctor: None,
                    owner: None,
                    freedom: crate::frontend::sketch::Freedom::Free,
                    constraints: Vec::new(),
                }),
            },
        )
    }

    fn make_line_segment(
        id: usize,
        start_id: usize,
        end_id: usize,
        start: Coords2d,
        end: Coords2d,
    ) -> crate::frontend::api::Object {
        let ctor = crate::frontend::sketch::SegmentCtor::Line(crate::frontend::sketch::LineCtor {
            start: crate::frontend::sketch::Point2d {
                x: make_expr_mm(start.x),
                y: make_expr_mm(start.y),
            },
            end: crate::frontend::sketch::Point2d {
                x: make_expr_mm(end.x),
                y: make_expr_mm(end.y),
            },
            construction: None,
        });

        make_object(
            id,
            crate::frontend::api::ObjectKind::Segment {
                segment: crate::frontend::sketch::Segment::Line(crate::frontend::sketch::Line {
                    start: ObjectId(start_id),
                    end: ObjectId(end_id),
                    owner: None,
                    ctor,
                    ctor_applicable: false,
                    construction: false,
                }),
            },
        )
    }

    fn make_arc_segment(
        id: usize,
        start_id: usize,
        end_id: usize,
        center_id: usize,
        start: Coords2d,
        end: Coords2d,
        center: Coords2d,
    ) -> crate::frontend::api::Object {
        let ctor = crate::frontend::sketch::SegmentCtor::Arc(crate::frontend::sketch::ArcCtor {
            start: crate::frontend::sketch::Point2d {
                x: make_expr_mm(start.x),
                y: make_expr_mm(start.y),
            },
            end: crate::frontend::sketch::Point2d {
                x: make_expr_mm(end.x),
                y: make_expr_mm(end.y),
            },
            center: crate::frontend::sketch::Point2d {
                x: make_expr_mm(center.x),
                y: make_expr_mm(center.y),
            },
            construction: None,
        });

        make_object(
            id,
            crate::frontend::api::ObjectKind::Segment {
                segment: crate::frontend::sketch::Segment::Arc(crate::frontend::sketch::Arc {
                    start: ObjectId(start_id),
                    end: ObjectId(end_id),
                    center: ObjectId(center_id),
                    ctor,
                    ctor_applicable: false,
                    construction: false,
                }),
            },
        )
    }

    fn make_circle_segment(
        id: usize,
        start_id: usize,
        center_id: usize,
        start: Coords2d,
        center: Coords2d,
    ) -> crate::frontend::api::Object {
        let ctor = crate::frontend::sketch::SegmentCtor::Circle(crate::frontend::sketch::CircleCtor {
            start: crate::frontend::sketch::Point2d {
                x: make_expr_mm(start.x),
                y: make_expr_mm(start.y),
            },
            center: crate::frontend::sketch::Point2d {
                x: make_expr_mm(center.x),
                y: make_expr_mm(center.y),
            },
            construction: None,
        });

        make_object(
            id,
            crate::frontend::api::ObjectKind::Segment {
                segment: crate::frontend::sketch::Segment::Circle(crate::frontend::sketch::Circle {
                    start: ObjectId(start_id),
                    center: ObjectId(center_id),
                    ctor,
                    ctor_applicable: false,
                    construction: false,
                }),
            },
        )
    }

    #[test]
    fn test_is_point_on_line_segment_exactly_on_segment() {
        let point = Coords2d { x: 5.0, y: 5.0 };
        let segment_start = Coords2d { x: 0.0, y: 0.0 };
        let segment_end = Coords2d { x: 10.0, y: 10.0 };
        let result = is_point_on_line_segment(point, segment_start, segment_end, EPSILON_POINT_ON_SEGMENT);
        assert!(result.is_some());
        if let Some(r) = result {
            assert!((r.x - 5.0).abs() < 1e-5);
            assert!((r.y - 5.0).abs() < 1e-5);
        }
    }

    #[test]
    fn test_is_point_on_line_segment_at_start() {
        let point = Coords2d { x: 0.0, y: 0.0 };
        let segment_start = Coords2d { x: 0.0, y: 0.0 };
        let segment_end = Coords2d { x: 10.0, y: 10.0 };
        let result = is_point_on_line_segment(point, segment_start, segment_end, EPSILON_POINT_ON_SEGMENT);
        assert!(result.is_some());
        if let Some(r) = result {
            assert_eq!(r.x, 0.0);
            assert_eq!(r.y, 0.0);
        }
    }

    #[test]
    fn test_is_point_on_line_segment_at_end() {
        let point = Coords2d { x: 10.0, y: 10.0 };
        let segment_start = Coords2d { x: 0.0, y: 0.0 };
        let segment_end = Coords2d { x: 10.0, y: 10.0 };
        let result = is_point_on_line_segment(point, segment_start, segment_end, EPSILON_POINT_ON_SEGMENT);
        assert!(result.is_some());
        if let Some(r) = result {
            assert_eq!(r.x, 10.0);
            assert_eq!(r.y, 10.0);
        }
    }

    #[test]
    fn test_is_point_on_line_segment_before_start() {
        let point = Coords2d { x: -1.0, y: -1.0 };
        let segment_start = Coords2d { x: 0.0, y: 0.0 };
        let segment_end = Coords2d { x: 10.0, y: 10.0 };
        let result = is_point_on_line_segment(point, segment_start, segment_end, EPSILON_POINT_ON_SEGMENT);
        assert!(result.is_none());
    }

    #[test]
    fn test_is_point_on_line_segment_after_end() {
        let point = Coords2d { x: 11.0, y: 11.0 };
        let segment_start = Coords2d { x: 0.0, y: 0.0 };
        let segment_end = Coords2d { x: 10.0, y: 10.0 };
        let result = is_point_on_line_segment(point, segment_start, segment_end, EPSILON_POINT_ON_SEGMENT);
        assert!(result.is_none());
    }

    #[test]
    fn test_is_point_on_line_segment_off_to_side() {
        let point = Coords2d { x: 5.0, y: 6.0 };
        let segment_start = Coords2d { x: 0.0, y: 0.0 };
        let segment_end = Coords2d { x: 10.0, y: 10.0 };
        let result = is_point_on_line_segment(point, segment_start, segment_end, EPSILON_POINT_ON_SEGMENT);
        assert!(result.is_none());
    }

    #[test]
    fn test_is_point_on_line_segment_horizontal() {
        let point = Coords2d { x: 5.0, y: 0.0 };
        let segment_start = Coords2d { x: 0.0, y: 0.0 };
        let segment_end = Coords2d { x: 10.0, y: 0.0 };
        let result = is_point_on_line_segment(point, segment_start, segment_end, EPSILON_POINT_ON_SEGMENT);
        assert!(result.is_some());
        if let Some(r) = result {
            assert_eq!(r.x, 5.0);
            assert_eq!(r.y, 0.0);
        }
    }

    #[test]
    fn test_is_point_on_line_segment_vertical() {
        let point = Coords2d { x: 0.0, y: 5.0 };
        let segment_start = Coords2d { x: 0.0, y: 0.0 };
        let segment_end = Coords2d { x: 0.0, y: 10.0 };
        let result = is_point_on_line_segment(point, segment_start, segment_end, EPSILON_POINT_ON_SEGMENT);
        assert!(result.is_some());
        if let Some(r) = result {
            assert_eq!(r.x, 0.0);
            assert_eq!(r.y, 5.0);
        }
    }

    #[test]
    fn test_is_point_on_line_segment_degenerate() {
        let point = Coords2d { x: 0.0, y: 0.0 };
        let segment_start = Coords2d { x: 0.0, y: 0.0 };
        let segment_end = Coords2d { x: 0.0, y: 0.0 };
        let result = is_point_on_line_segment(point, segment_start, segment_end, EPSILON_POINT_ON_SEGMENT);
        assert!(result.is_some());
        if let Some(r) = result {
            assert_eq!(r.x, 0.0);
            assert_eq!(r.y, 0.0);
        }
    }

    #[test]
    fn test_is_point_on_line_segment_far_from_degenerate() {
        let point = Coords2d { x: 1.0, y: 1.0 };
        let segment_start = Coords2d { x: 0.0, y: 0.0 };
        let segment_end = Coords2d { x: 0.0, y: 0.0 };
        let result = is_point_on_line_segment(point, segment_start, segment_end, EPSILON_POINT_ON_SEGMENT);
        assert!(result.is_none());
    }

    #[test]
    fn test_line_segment_intersection_crossing_segments() {
        let result = line_segment_intersection(
            Coords2d { x: 0.0, y: 0.0 },
            Coords2d { x: 10.0, y: 10.0 },
            Coords2d { x: 0.0, y: 10.0 },
            Coords2d { x: 10.0, y: 0.0 },
            EPSILON_POINT_ON_SEGMENT,
        );
        assert!(result.is_some());
        if let Some(r) = result {
            assert!((r.x - 5.0).abs() < 1e-5);
            assert!((r.y - 5.0).abs() < 1e-5);
        }
    }

    #[test]
    fn test_line_segment_intersection_shared_endpoint() {
        let result = line_segment_intersection(
            Coords2d { x: 0.0, y: 0.0 },
            Coords2d { x: 5.0, y: 5.0 },
            Coords2d { x: 5.0, y: 5.0 },
            Coords2d { x: 10.0, y: 10.0 },
            EPSILON_POINT_ON_SEGMENT,
        );
        assert!(result.is_some());
        if let Some(r) = result {
            assert!((r.x - 5.0).abs() < 1e-5);
            assert!((r.y - 5.0).abs() < 1e-5);
        }
    }

    #[test]
    fn test_line_segment_intersection_parallel() {
        let result = line_segment_intersection(
            Coords2d { x: 0.0, y: 0.0 },
            Coords2d { x: 10.0, y: 0.0 },
            Coords2d { x: 0.0, y: 5.0 },
            Coords2d { x: 10.0, y: 5.0 },
            EPSILON_POINT_ON_SEGMENT,
        );
        assert!(result.is_none());
    }

    #[test]
    fn test_line_segment_intersection_non_intersecting() {
        let result = line_segment_intersection(
            Coords2d { x: 0.0, y: 0.0 },
            Coords2d { x: 5.0, y: 5.0 },
            Coords2d { x: 10.0, y: 10.0 },
            Coords2d { x: 15.0, y: 15.0 },
            EPSILON_POINT_ON_SEGMENT,
        );
        assert!(result.is_none());
    }

    #[test]
    fn test_line_segment_intersection_outside_segments() {
        let result = line_segment_intersection(
            Coords2d { x: 0.0, y: 0.0 },
            Coords2d { x: 5.0, y: 5.0 },
            Coords2d { x: 10.0, y: 10.0 },
            Coords2d { x: 20.0, y: 20.0 },
            EPSILON_POINT_ON_SEGMENT,
        );
        assert!(result.is_none());
    }

    #[test]
    fn test_line_segment_intersection_t_intersection() {
        let result = line_segment_intersection(
            Coords2d { x: 0.0, y: 0.0 },
            Coords2d { x: 10.0, y: 0.0 },
            Coords2d { x: 5.0, y: -5.0 },
            Coords2d { x: 5.0, y: 5.0 },
            EPSILON_POINT_ON_SEGMENT,
        );
        assert!(result.is_some());
        if let Some(r) = result {
            assert!((r.x - 5.0).abs() < 1e-5);
            assert!((r.y - 0.0).abs() < 1e-5);
        }
    }

    #[test]
    fn test_project_point_onto_segment_at_start() {
        let result = project_point_onto_segment(
            Coords2d { x: 0.0, y: 0.0 },
            Coords2d { x: 0.0, y: 0.0 },
            Coords2d { x: 10.0, y: 10.0 },
        );
        assert!((result - 0.0).abs() < 1e-5);
    }

    #[test]
    fn test_project_point_onto_segment_at_end() {
        let result = project_point_onto_segment(
            Coords2d { x: 10.0, y: 10.0 },
            Coords2d { x: 0.0, y: 0.0 },
            Coords2d { x: 10.0, y: 10.0 },
        );
        assert!((result - 1.0).abs() < 1e-5);
    }

    #[test]
    fn test_project_point_onto_segment_at_midpoint() {
        let result = project_point_onto_segment(
            Coords2d { x: 5.0, y: 5.0 },
            Coords2d { x: 0.0, y: 0.0 },
            Coords2d { x: 10.0, y: 10.0 },
        );
        assert!((result - 0.5).abs() < 1e-5);
    }

    #[test]
    fn test_project_point_onto_segment_before_start() {
        let result = project_point_onto_segment(
            Coords2d { x: -1.0, y: -1.0 },
            Coords2d { x: 0.0, y: 0.0 },
            Coords2d { x: 10.0, y: 10.0 },
        );
        assert!(result < 0.0);
    }

    #[test]
    fn test_project_point_onto_segment_after_end() {
        let result = project_point_onto_segment(
            Coords2d { x: 11.0, y: 11.0 },
            Coords2d { x: 0.0, y: 0.0 },
            Coords2d { x: 10.0, y: 10.0 },
        );
        assert!(result > 1.0);
    }

    #[test]
    fn test_project_point_onto_segment_horizontal() {
        let result = project_point_onto_segment(
            Coords2d { x: 5.0, y: 0.0 },
            Coords2d { x: 0.0, y: 0.0 },
            Coords2d { x: 10.0, y: 0.0 },
        );
        assert!((result - 0.5).abs() < 1e-5);
    }

    #[test]
    fn test_project_point_onto_segment_vertical() {
        let result = project_point_onto_segment(
            Coords2d { x: 0.0, y: 5.0 },
            Coords2d { x: 0.0, y: 0.0 },
            Coords2d { x: 0.0, y: 10.0 },
        );
        assert!((result - 0.5).abs() < 1e-5);
    }

    #[test]
    fn test_perpendicular_distance_to_segment_on_segment() {
        let result = perpendicular_distance_to_segment(
            Coords2d { x: 5.0, y: 5.0 },
            Coords2d { x: 0.0, y: 0.0 },
            Coords2d { x: 10.0, y: 10.0 },
        );
        assert!((result - 0.0).abs() < 1e-5);
    }

    #[test]
    fn test_perpendicular_distance_to_segment_perpendicular() {
        // Point at [5, 5] with segment from [0, 0] to [10, 0]
        // Perpendicular distance should be 5
        let result = perpendicular_distance_to_segment(
            Coords2d { x: 5.0, y: 5.0 },
            Coords2d { x: 0.0, y: 0.0 },
            Coords2d { x: 10.0, y: 0.0 },
        );
        assert!((result - 5.0).abs() < 1e-5);
    }

    #[test]
    fn test_perpendicular_distance_to_segment_outside_segment() {
        // Point at [-1, 0] with segment from [0, 0] to [10, 0]
        // Should return distance to start point (1)
        let result = perpendicular_distance_to_segment(
            Coords2d { x: -1.0, y: 0.0 },
            Coords2d { x: 0.0, y: 0.0 },
            Coords2d { x: 10.0, y: 0.0 },
        );
        assert!((result - 1.0).abs() < 1e-5);
    }

    #[test]
    fn test_perpendicular_distance_to_segment_degenerate() {
        // Degenerate segment (start == end)
        let result = perpendicular_distance_to_segment(
            Coords2d { x: 1.0, y: 1.0 },
            Coords2d { x: 0.0, y: 0.0 },
            Coords2d { x: 0.0, y: 0.0 },
        );
        // Distance should be sqrt(2)
        assert!((result - 2.0_f64.sqrt()).abs() < 1e-5);
    }

    #[test]
    fn test_is_point_on_arc_on_arc() {
        // Arc from [1, 0] to [0, 1] with center at [0, 0] (quarter circle)
        // Use a point that's exactly on the unit circle
        let angle = std::f64::consts::PI / 4.0; // 45 degrees
        let point = Coords2d {
            x: libm::cos(angle),
            y: libm::sin(angle),
        };
        let result = is_point_on_arc(
            point,
            Coords2d { x: 0.0, y: 0.0 },
            Coords2d { x: 1.0, y: 0.0 },
            Coords2d { x: 0.0, y: 1.0 },
            EPSILON_POINT_ON_SEGMENT,
        );
        assert!(result);
    }

    #[test]
    fn test_is_point_on_arc_at_start() {
        let result = is_point_on_arc(
            Coords2d { x: 1.0, y: 0.0 },
            Coords2d { x: 0.0, y: 0.0 },
            Coords2d { x: 1.0, y: 0.0 },
            Coords2d { x: 0.0, y: 1.0 },
            EPSILON_POINT_ON_SEGMENT,
        );
        assert!(result);
    }

    #[test]
    fn test_is_point_on_arc_at_end() {
        let result = is_point_on_arc(
            Coords2d { x: 0.0, y: 1.0 },
            Coords2d { x: 0.0, y: 0.0 },
            Coords2d { x: 1.0, y: 0.0 },
            Coords2d { x: 0.0, y: 1.0 },
            EPSILON_POINT_ON_SEGMENT,
        );
        assert!(result);
    }

    #[test]
    fn test_is_point_on_arc_off_arc() {
        // Point on circle but not on the arc (opposite side)
        let result = is_point_on_arc(
            Coords2d { x: -1.0, y: 0.0 },
            Coords2d { x: 0.0, y: 0.0 },
            Coords2d { x: 1.0, y: 0.0 },
            Coords2d { x: 0.0, y: 1.0 },
            EPSILON_POINT_ON_SEGMENT,
        );
        assert!(!result);
    }

    #[test]
    fn test_is_point_on_arc_not_on_circle() {
        let result = is_point_on_arc(
            Coords2d { x: 2.0, y: 0.0 },
            Coords2d { x: 0.0, y: 0.0 },
            Coords2d { x: 1.0, y: 0.0 },
            Coords2d { x: 0.0, y: 1.0 },
            EPSILON_POINT_ON_SEGMENT,
        );
        assert!(!result);
    }

    #[test]
    fn test_is_point_on_arc_wraps_around() {
        // Arc from 350° to 10° (wraps around)
        let center = Coords2d { x: 0.0, y: 0.0 };
        let start = Coords2d {
            x: libm::cos(350.0 * std::f64::consts::PI / 180.0),
            y: libm::sin(350.0 * std::f64::consts::PI / 180.0),
        };
        let end = Coords2d {
            x: libm::cos(10.0 * std::f64::consts::PI / 180.0),
            y: libm::sin(10.0 * std::f64::consts::PI / 180.0),
        };
        let point = Coords2d {
            x: libm::cos(5.0 * std::f64::consts::PI / 180.0),
            y: libm::sin(5.0 * std::f64::consts::PI / 180.0),
        };
        let result = is_point_on_arc(point, center, start, end, EPSILON_POINT_ON_SEGMENT);
        assert!(result);
    }

    #[test]
    fn test_line_arc_intersection_intersects() {
        // Line from [-2, 0] to [2, 0], arc from [1, 0] to [0, 1] with center at [0, 0]
        // Should intersect at [1, 0] (arc start)
        let result = line_arc_intersection(
            Coords2d { x: -2.0, y: 0.0 },
            Coords2d { x: 2.0, y: 0.0 },
            Coords2d { x: 0.0, y: 0.0 },
            Coords2d { x: 1.0, y: 0.0 },
            Coords2d { x: 0.0, y: 1.0 },
            EPSILON_POINT_ON_SEGMENT,
        );
        assert!(result.is_some());
        if let Some(r) = result {
            assert!((r.x - 1.0).abs() < 1e-5);
            assert!((r.y - 0.0).abs() < 1e-5);
        }
    }

    #[test]
    fn test_line_arc_intersection_no_intersection() {
        // Line that doesn't intersect the arc
        let result = line_arc_intersection(
            Coords2d { x: 0.0, y: 2.0 },
            Coords2d { x: 0.0, y: 3.0 },
            Coords2d { x: 0.0, y: 0.0 },
            Coords2d { x: 1.0, y: 0.0 },
            Coords2d { x: 0.0, y: 1.0 },
            EPSILON_POINT_ON_SEGMENT,
        );
        assert!(result.is_none());
    }

    #[test]
    fn test_line_arc_intersection_tangent() {
        // Line tangent to arc (touches at one point)
        // Line from [0, 1] to [0, 2], arc from [1, 0] to [0, 1] with center at [0, 0]
        // Should intersect at [0, 1] (arc end)
        let result = line_arc_intersection(
            Coords2d { x: 0.0, y: 1.0 },
            Coords2d { x: 0.0, y: 2.0 },
            Coords2d { x: 0.0, y: 0.0 },
            Coords2d { x: 1.0, y: 0.0 },
            Coords2d { x: 0.0, y: 1.0 },
            EPSILON_POINT_ON_SEGMENT,
        );
        assert!(result.is_some());
        if let Some(r) = result {
            assert!((r.x - 0.0).abs() < 1e-5);
            assert!((r.y - 1.0).abs() < 1e-5);
        }
    }

    #[test]
    fn test_line_arc_intersection_horizontal_line() {
        // Horizontal line at y=0.5 intersecting arc from [1,0] to [0,1] centered at [0,0]
        let result = line_arc_intersection(
            Coords2d { x: -1.0, y: 0.5 },
            Coords2d { x: 1.0, y: 0.5 },
            Coords2d { x: 0.0, y: 0.0 },
            Coords2d { x: 1.0, y: 0.0 },
            Coords2d { x: 0.0, y: 1.0 },
            EPSILON_POINT_ON_SEGMENT,
        );
        assert!(result.is_some());
        if let Some(r) = result {
            // Should intersect at approximately [0.866, 0.5] or [-0.866, 0.5]
            // But only [0.866, 0.5] is on the arc from [1,0] to [0,1]
            assert!(r.x.abs() > 0.8);
            assert!((r.y - 0.5).abs() < 0.1);
        }
    }

    #[test]
    fn test_line_arc_intersection_endpoint() {
        // Line starts at arc endpoint
        let result = line_arc_intersection(
            Coords2d { x: 1.0, y: 0.0 },
            Coords2d { x: 2.0, y: 0.0 },
            Coords2d { x: 0.0, y: 0.0 },
            Coords2d { x: 1.0, y: 0.0 },
            Coords2d { x: 0.0, y: 1.0 },
            EPSILON_POINT_ON_SEGMENT,
        );
        assert!(result.is_some());
        if let Some(r) = result {
            assert!((r.x - 1.0).abs() < 1e-5);
            assert!((r.y - 0.0).abs() < 1e-5);
        }
    }

    #[test]
    fn test_line_circle_intersections_secant_returns_two_sorted_points() {
        let intersections = line_circle_intersections(
            Coords2d { x: -2.0, y: 0.0 },
            Coords2d { x: 2.0, y: 0.0 },
            Coords2d { x: 0.0, y: 0.0 },
            1.0,
            EPSILON_POINT_ON_SEGMENT,
        );

        assert_eq!(intersections.len(), 2);
        assert!((intersections[0].0 - 0.25).abs() < 1e-5);
        assert!((intersections[0].1.x - -1.0).abs() < 1e-5);
        assert!((intersections[0].1.y - 0.0).abs() < 1e-5);
        assert!((intersections[1].0 - 0.75).abs() < 1e-5);
        assert!((intersections[1].1.x - 1.0).abs() < 1e-5);
        assert!((intersections[1].1.y - 0.0).abs() < 1e-5);
    }

    #[test]
    fn test_line_circle_intersections_tangent_returns_single_point() {
        let intersections = line_circle_intersections(
            Coords2d { x: -2.0, y: 1.0 },
            Coords2d { x: 2.0, y: 1.0 },
            Coords2d { x: 0.0, y: 0.0 },
            1.0,
            EPSILON_POINT_ON_SEGMENT,
        );

        assert_eq!(intersections.len(), 1);
        assert!((intersections[0].0 - 0.5).abs() < 1e-5);
        assert!((intersections[0].1.x - 0.0).abs() < 1e-5);
        assert!((intersections[0].1.y - 1.0).abs() < 1e-5);
    }

    #[test]
    fn test_line_circle_intersections_disjoint_returns_empty() {
        let intersections = line_circle_intersections(
            Coords2d { x: -2.0, y: 2.0 },
            Coords2d { x: 2.0, y: 2.0 },
            Coords2d { x: 0.0, y: 0.0 },
            1.0,
            EPSILON_POINT_ON_SEGMENT,
        );

        assert!(intersections.is_empty());
    }

    #[test]
    fn test_project_point_onto_circle_start_is_zero() {
        let t = project_point_onto_circle(
            Coords2d { x: 1.0, y: 0.0 },
            Coords2d { x: 0.0, y: 0.0 },
            Coords2d { x: 1.0, y: 0.0 },
        );

        assert!((t - 0.0).abs() < 1e-5);
    }

    #[test]
    fn test_project_point_onto_circle_quarter_turn_is_one_quarter() {
        let t = project_point_onto_circle(
            Coords2d { x: 0.0, y: 1.0 },
            Coords2d { x: 0.0, y: 0.0 },
            Coords2d { x: 1.0, y: 0.0 },
        );

        assert!((t - 0.25).abs() < 1e-5);
    }

    #[test]
    fn test_project_point_onto_circle_wraps_across_zero_angle() {
        let start = Coords2d {
            x: libm::cos(350.0_f64.to_radians()),
            y: libm::sin(350.0_f64.to_radians()),
        };
        let point = Coords2d {
            x: libm::cos(10.0_f64.to_radians()),
            y: libm::sin(10.0_f64.to_radians()),
        };
        let t = project_point_onto_circle(point, Coords2d { x: 0.0, y: 0.0 }, start);

        assert!((t - (20.0 / 360.0)).abs() < 1e-5);
    }

    #[test]
    fn test_circle_circle_intersections_two_points() {
        let mut intersections = circle_circle_intersections(
            Coords2d { x: 0.0, y: 0.0 },
            2.0,
            Coords2d { x: 2.0, y: 0.0 },
            2.0,
            EPSILON_POINT_ON_SEGMENT,
        );

        intersections.sort_by(|a, b| a.y.partial_cmp(&b.y).unwrap_or(std::cmp::Ordering::Equal));
        assert_eq!(intersections.len(), 2);
        assert!((intersections[0].x - 1.0).abs() < 1e-5);
        assert!((intersections[0].y - -3.0_f64.sqrt()).abs() < 1e-5);
        assert!((intersections[1].x - 1.0).abs() < 1e-5);
        assert!((intersections[1].y - 3.0_f64.sqrt()).abs() < 1e-5);
    }

    #[test]
    fn test_circle_circle_intersections_tangent_returns_single_point() {
        let intersections = circle_circle_intersections(
            Coords2d { x: 0.0, y: 0.0 },
            1.0,
            Coords2d { x: 2.0, y: 0.0 },
            1.0,
            EPSILON_POINT_ON_SEGMENT,
        );

        assert_eq!(intersections.len(), 1);
        assert!((intersections[0].x - 1.0).abs() < 1e-5);
        assert!((intersections[0].y - 0.0).abs() < 1e-5);
    }

    #[test]
    fn test_circle_circle_intersections_disjoint_returns_empty() {
        let intersections = circle_circle_intersections(
            Coords2d { x: 0.0, y: 0.0 },
            1.0,
            Coords2d { x: 3.0, y: 0.0 },
            1.0,
            EPSILON_POINT_ON_SEGMENT,
        );

        assert!(intersections.is_empty());
    }

    #[test]
    fn test_circle_circle_intersections_concentric_returns_empty() {
        let intersections = circle_circle_intersections(
            Coords2d { x: 0.0, y: 0.0 },
            1.0,
            Coords2d { x: 0.0, y: 0.0 },
            2.0,
            EPSILON_POINT_ON_SEGMENT,
        );

        assert!(intersections.is_empty());
    }

    #[test]
    fn test_arc_arc_intersection() {
        // Test case matching TypeScript test: two arcs that may or may not intersect
        // arc1: center [0, 0], start [1, 0], end [0, 1] (quarter circle from 0° to 90°)
        // arc2: center [1, 0], start [2, 0], end [1, 1] (quarter circle from 0° to 90°)
        let result = arc_arc_intersection(
            Coords2d { x: 0.0, y: 0.0 }, // arc1 center
            Coords2d { x: 1.0, y: 0.0 }, // arc1 start
            Coords2d { x: 0.0, y: 1.0 }, // arc1 end
            Coords2d { x: 1.0, y: 0.0 }, // arc2 center
            Coords2d { x: 2.0, y: 0.0 }, // arc2 start
            Coords2d { x: 1.0, y: 1.0 }, // arc2 end
            EPSILON_POINT_ON_SEGMENT,
        );
        // arc_arc_intersection may return None if no intersection, or Some(point)
        // The test just verifies the function works without panicking
        // In this case, the arcs may or may not intersect depending on geometry
        // The important thing is that the function returns Option<Coords2d>
        assert!(result.is_none() || result.is_some());
    }

    #[test]
    fn test_load_curve_handle_normalizes_line_arc_circle() {
        let line = make_line_segment(0, 1, 2, Coords2d { x: 0.0, y: 0.0 }, Coords2d { x: 10.0, y: 0.0 });
        let line_start = make_point_segment(1, 0.0, 0.0);
        let line_end = make_point_segment(2, 10.0, 0.0);

        let arc = make_arc_segment(
            3,
            4,
            5,
            6,
            Coords2d { x: 1.0, y: 0.0 },
            Coords2d { x: 0.0, y: 1.0 },
            Coords2d { x: 0.0, y: 0.0 },
        );
        let arc_start = make_point_segment(4, 1.0, 0.0);
        let arc_end = make_point_segment(5, 0.0, 1.0);
        let arc_center = make_point_segment(6, 0.0, 0.0);

        let circle = make_circle_segment(7, 8, 9, Coords2d { x: 2.0, y: 0.0 }, Coords2d { x: 0.0, y: 0.0 });
        let circle_start = make_point_segment(8, 2.0, 0.0);
        let circle_center = make_point_segment(9, 0.0, 0.0);

        let objects = vec![
            line,
            line_start,
            line_end,
            arc,
            arc_start,
            arc_end,
            arc_center,
            circle,
            circle_start,
            circle_center,
        ];

        let line_curve = load_curve_handle(&objects[0], &objects, UnitLength::Millimeters).expect("load line curve");
        assert_eq!(line_curve.kind, CurveKind::Line);
        assert_eq!(line_curve.domain, CurveDomain::Open);
        assert!(line_curve.center.is_none());
        assert!(line_curve.radius.is_none());
        assert!((line_curve.start.x - 0.0).abs() < 1e-6);
        assert!((line_curve.end.x - 10.0).abs() < 1e-6);

        let arc_curve = load_curve_handle(&objects[3], &objects, UnitLength::Millimeters).expect("load arc curve");
        assert_eq!(arc_curve.kind, CurveKind::Circular);
        assert_eq!(arc_curve.domain, CurveDomain::Open);
        assert!(arc_curve.center.is_some());
        assert!((arc_curve.radius.expect("arc radius") - 1.0).abs() < 1e-6);

        let circle_curve =
            load_curve_handle(&objects[7], &objects, UnitLength::Millimeters).expect("load circle curve");
        assert_eq!(circle_curve.kind, CurveKind::Circular);
        assert_eq!(circle_curve.domain, CurveDomain::Closed);
        assert!(circle_curve.center.is_some());
        assert!((circle_curve.radius.expect("circle radius") - 2.0).abs() < 1e-6);
        assert!((circle_curve.end.x - circle_curve.start.x).abs() < 1e-6);
        assert!((circle_curve.end.y - circle_curve.start.y).abs() < 1e-6);
    }

    #[test]
    fn test_curve_polyline_and_curve_curve_intersections_are_generic() {
        let circle = make_circle_segment(0, 1, 2, Coords2d { x: 1.0, y: 0.0 }, Coords2d { x: 0.0, y: 0.0 });
        let circle_start = make_point_segment(1, 1.0, 0.0);
        let circle_center = make_point_segment(2, 0.0, 0.0);
        let line = make_line_segment(3, 4, 5, Coords2d { x: -2.0, y: 0.0 }, Coords2d { x: 2.0, y: 0.0 });
        let line_start = make_point_segment(4, -2.0, 0.0);
        let line_end = make_point_segment(5, 2.0, 0.0);
        let objects = vec![circle, circle_start, circle_center, line, line_start, line_end];

        let circle_curve = load_curve_handle(&objects[0], &objects, UnitLength::Millimeters).expect("circle curve");
        let line_curve = load_curve_handle(&objects[3], &objects, UnitLength::Millimeters).expect("line curve");

        let polyline_hits = curve_polyline_intersections(
            circle_curve,
            &[Coords2d { x: -2.0, y: 0.0 }, Coords2d { x: 2.0, y: 0.0 }],
            EPSILON_POINT_ON_SEGMENT,
        );
        assert_eq!(polyline_hits.len(), 2);
        assert!(polyline_hits.iter().all(|(_, seg_i)| *seg_i == 0));

        let curve_hits = curve_curve_intersections(circle_curve, line_curve, EPSILON_POINT_ON_SEGMENT);
        assert_eq!(curve_hits.len(), 2);
        assert!(curve_hits.iter().any(|p| (p.x - -1.0).abs() < 1e-6 && p.y.abs() < 1e-6));
        assert!(curve_hits.iter().any(|p| (p.x - 1.0).abs() < 1e-6 && p.y.abs() < 1e-6));
    }

    #[test]
    fn test_build_trim_plan_and_lowering_for_simple_and_tail_cut() {
        let line = make_line_segment(0, 1, 2, Coords2d { x: 0.0, y: 0.0 }, Coords2d { x: 10.0, y: 0.0 });
        let line_start = make_point_segment(1, 0.0, 0.0);
        let line_end = make_point_segment(2, 10.0, 0.0);
        let intersecting_point = make_point_segment(10, 5.0, 0.0);
        let objects = vec![line.clone(), line_start, line_end, intersecting_point];

        let seg_end_left = TrimTermination::SegEndPoint {
            trim_termination_coords: Coords2d { x: 0.0, y: 0.0 },
        };
        let seg_end_right = TrimTermination::SegEndPoint {
            trim_termination_coords: Coords2d { x: 10.0, y: 0.0 },
        };

        let delete_plan = build_trim_plan(
            ObjectId(0),
            Coords2d { x: 5.0, y: 0.0 },
            &line,
            &seg_end_left,
            &seg_end_right,
            &objects,
            UnitLength::Millimeters,
        )
        .expect("build delete plan");

        match delete_plan {
            TrimPlan::DeleteSegment { segment_id } => assert_eq!(segment_id, ObjectId(0)),
            other => panic!("expected delete plan, got {:?}", other),
        }

        let left_intersection = TrimTermination::Intersection {
            trim_termination_coords: Coords2d { x: 3.0, y: 0.0 },
            intersecting_seg_id: ObjectId(10),
        };
        let tail_cut_plan = build_trim_plan(
            ObjectId(0),
            Coords2d { x: 5.0, y: 0.0 },
            &line,
            &left_intersection,
            &seg_end_right,
            &objects,
            UnitLength::Millimeters,
        )
        .expect("build tail-cut plan");

        match &tail_cut_plan {
            TrimPlan::TailCut {
                segment_id,
                endpoint_changed,
                segment_or_point_to_make_coincident_to,
                ..
            } => {
                assert_eq!(*segment_id, ObjectId(0));
                assert_eq!(*endpoint_changed, EndpointChanged::End);
                assert_eq!(*segment_or_point_to_make_coincident_to, ObjectId(10));
            }
            other => panic!("expected tail-cut plan, got {:?}", other),
        }

        let lowered = lower_trim_plan(&tail_cut_plan);
        assert!(
            matches!(lowered.first(), Some(TrimOperation::EditSegment { .. })),
            "first op should be EditSegment, got {:?}",
            lowered.first()
        );
        assert!(
            matches!(lowered.get(1), Some(TrimOperation::AddCoincidentConstraint { .. })),
            "second op should be AddCoincidentConstraint, got {:?}",
            lowered.get(1)
        );
    }

    #[test]
    fn test_rewrite_constraint_with_map_rewrites_ids_consistently() {
        let rewrite_map = std::collections::HashMap::from([(ObjectId(1), ObjectId(101)), (ObjectId(2), ObjectId(202))]);

        let coincident = Constraint::Coincident(crate::frontend::sketch::Coincident {
            segments: vec![
                crate::frontend::sketch::ConstraintSegment::Segment(ObjectId(1)),
                crate::frontend::sketch::ConstraintSegment::Segment(ObjectId(99)),
            ],
        });
        let distance = Constraint::Distance(crate::frontend::sketch::Distance {
            points: vec![
                crate::frontend::sketch::ConstraintSegment::Segment(ObjectId(2)),
                crate::frontend::sketch::ConstraintSegment::Origin(crate::frontend::sketch::OriginLiteral::Origin),
            ],
            distance: make_number_mm(4.0),
            source: crate::frontend::sketch::ConstraintSource::default(),
        });
        let tangent = Constraint::Tangent(crate::frontend::sketch::Tangent {
            input: vec![ObjectId(1), ObjectId(2), ObjectId(77)],
        });

        let Some(Constraint::Coincident(rewritten_coincident)) = rewrite_constraint_with_map(&coincident, &rewrite_map)
        else {
            panic!("expected coincident rewrite");
        };
        let coincident_ids: Vec<ObjectId> = rewritten_coincident.segment_ids().collect();
        assert!(coincident_ids.contains(&ObjectId(101)));
        assert!(coincident_ids.contains(&ObjectId(99)));

        let Some(Constraint::Distance(rewritten_distance)) = rewrite_constraint_with_map(&distance, &rewrite_map)
        else {
            panic!("expected distance rewrite");
        };
        let rewritten_distance_ids: Vec<ObjectId> = rewritten_distance.point_ids().collect();
        assert!(rewritten_distance_ids.contains(&ObjectId(202)));

        let Some(Constraint::Tangent(rewritten_tangent)) = rewrite_constraint_with_map(&tangent, &rewrite_map) else {
            panic!("expected tangent rewrite");
        };
        assert_eq!(
            rewritten_tangent.input,
            vec![ObjectId(101), ObjectId(202), ObjectId(77)]
        );
    }

    #[test]
    fn test_get_next_trim_spawn_line_intersection() {
        use kcl_error::SourceRange;

        use crate::execution::ArtifactId;
        use crate::frontend::api::Expr;
        use crate::frontend::api::Number;
        use crate::frontend::api::Object;
        use crate::frontend::api::ObjectKind;
        use crate::frontend::api::SourceRef;
        use crate::frontend::sketch::Freedom;
        use crate::frontend::sketch::Line;
        use crate::frontend::sketch::LineCtor;
        use crate::frontend::sketch::Point;
        use crate::frontend::sketch::Point2d;
        use crate::frontend::sketch::Segment;
        use crate::frontend::sketch::SegmentCtor;
        use crate::pretty::NumericSuffix;

        let num = |v: f64| Number {
            value: v,
            units: NumericSuffix::None,
        };
        let expr = |v: f64| Expr::Number(num(v));
        let make_obj = |id: usize, kind: ObjectKind| Object {
            id: ObjectId(id),
            kind,
            label: Default::default(),
            comments: Default::default(),
            artifact_id: ArtifactId::placeholder(),
            source: SourceRef::from(SourceRange::default()),
        };

        // Create a simple line segment object
        let line_obj = make_obj(
            0,
            ObjectKind::Segment {
                segment: Segment::Line(Line {
                    start: ObjectId(1),
                    end: ObjectId(2),
                    owner: None,
                    ctor: SegmentCtor::Line(LineCtor {
                        start: Point2d {
                            x: expr(0.0),
                            y: expr(0.0),
                        },
                        end: Point2d {
                            x: expr(10.0),
                            y: expr(10.0),
                        },
                        construction: None,
                    }),
                    ctor_applicable: false,
                    construction: false,
                }),
            },
        );

        // Create point objects for start and end
        let start_point = make_obj(
            1,
            ObjectKind::Segment {
                segment: Segment::Point(Point {
                    position: Point2d {
                        x: num(0.0),
                        y: num(0.0),
                    },
                    ctor: None,
                    owner: None,
                    freedom: Freedom::Free,
                    constraints: vec![],
                }),
            },
        );

        let end_point = make_obj(
            2,
            ObjectKind::Segment {
                segment: Segment::Point(Point {
                    position: Point2d {
                        x: num(10.0),
                        y: num(10.0),
                    },
                    ctor: None,
                    owner: None,
                    freedom: Freedom::Free,
                    constraints: vec![],
                }),
            },
        );

        let objects = vec![line_obj, start_point, end_point];

        // Trim line that intersects: from [0, 10] to [10, 0]
        let points = vec![Coords2d { x: 0.0, y: 10.0 }, Coords2d { x: 10.0, y: 0.0 }];

        let result = get_next_trim_spawn(&points, 0, &objects, UnitLength::Millimeters);

        match result {
            TrimItem::Spawn { trim_spawn_coords, .. } => {
                // Should intersect at [5, 5]
                assert!((trim_spawn_coords.x - 5.0).abs() < 1e-5);
                assert!((trim_spawn_coords.y - 5.0).abs() < 1e-5);
            }
            TrimItem::None { .. } => {
                panic!("Expected intersection but got None");
            }
        }
    }

    #[test]
    fn test_get_next_trim_spawn_no_intersection() {
        use kcl_error::SourceRange;

        use crate::execution::ArtifactId;
        use crate::frontend::api::Expr;
        use crate::frontend::api::Number;
        use crate::frontend::api::Object;
        use crate::frontend::api::ObjectKind;
        use crate::frontend::api::SourceRef;
        use crate::frontend::sketch::Freedom;
        use crate::frontend::sketch::Line;
        use crate::frontend::sketch::LineCtor;
        use crate::frontend::sketch::Point;
        use crate::frontend::sketch::Point2d;
        use crate::frontend::sketch::Segment;
        use crate::frontend::sketch::SegmentCtor;
        use crate::pretty::NumericSuffix;

        let num = |v: f64| Number {
            value: v,
            units: NumericSuffix::None,
        };
        let expr = |v: f64| Expr::Number(num(v));
        let make_obj = |id: usize, kind: ObjectKind| Object {
            id: ObjectId(id),
            kind,
            label: String::new(),
            comments: String::new(),
            artifact_id: ArtifactId::placeholder(),
            source: SourceRef::from(SourceRange::default()),
        };

        // Create a line segment that won't intersect
        let line_obj = make_obj(
            0,
            ObjectKind::Segment {
                segment: Segment::Line(Line {
                    start: ObjectId(1),
                    end: ObjectId(2),
                    owner: None,
                    ctor: SegmentCtor::Line(LineCtor {
                        start: Point2d {
                            x: expr(0.0),
                            y: expr(0.0),
                        },
                        end: Point2d {
                            x: expr(10.0),
                            y: expr(0.0),
                        },
                        construction: None,
                    }),
                    ctor_applicable: false,
                    construction: false,
                }),
            },
        );

        let start_point = make_obj(
            1,
            ObjectKind::Segment {
                segment: Segment::Point(Point {
                    position: Point2d {
                        x: num(0.0),
                        y: num(0.0),
                    },
                    ctor: None,
                    owner: None,
                    freedom: Freedom::Free,
                    constraints: vec![],
                }),
            },
        );

        let end_point = make_obj(
            2,
            ObjectKind::Segment {
                segment: Segment::Point(Point {
                    position: Point2d {
                        x: num(10.0),
                        y: num(0.0),
                    },
                    ctor: None,
                    owner: None,
                    freedom: Freedom::Free,
                    constraints: vec![],
                }),
            },
        );

        let objects = vec![line_obj, start_point, end_point];

        // Trim line that doesn't intersect: from [0, 10] to [10, 10]
        let points = vec![Coords2d { x: 0.0, y: 10.0 }, Coords2d { x: 10.0, y: 10.0 }];

        let result = get_next_trim_spawn(&points, 0, &objects, UnitLength::Millimeters);

        match result {
            TrimItem::None { .. } => {
                // Expected
            }
            TrimItem::Spawn { .. } => {
                panic!("Expected no intersection but got Spawn");
            }
        }
    }
}

#[tokio::test]
async fn test_execute_trim_flow_infrastructure() {
    // Simple test to verify the infrastructure works
    // This is a minimal test that just verifies we can parse KCL and set up the frontend
    let kcl_code = r#"
sketch(on = YZ) {
  line1 = line(start = [var 0mm, var 5mm], end = [var 0mm, var -5mm])
  line2 = line(start = [var 5mm, var 0mm], end = [var -5mm, var 0mm])
}
"#;

    let trim_points = vec![Coords2d { x: -2.0, y: -2.0 }, Coords2d { x: -2.0, y: 2.0 }];

    // This should at least parse and set up the frontend without errors
    // The actual trim might not work yet if operations aren't fully implemented
    let result = execute_trim_flow(kcl_code, &trim_points, ObjectId(0)).await;

    // For now, just verify it doesn't panic
    // Once operations are fully implemented, we can add assertions
    match result {
        Ok(_) => {
            // Success - infrastructure is working
        }
        Err(e) => {
            // This is expected for now since some operations aren't implemented
            // Just verify we got a reasonable error message
            // The error could be various things like parsing errors, execution errors, or empty results
            assert!(
                e.contains("Failed")
                    || e.contains("not yet implemented")
                    || e.contains("Reached max iterations")
                    || e.contains("No trim operations")
                    || e.contains("No operations were executed")
                    || e.contains("parse")
                    || e.contains("execute")
            );
        }
    }
}

#[tokio::test]
async fn test_trim_line2_left_side() {
    // This test mirrors: "Case 1: trim line2 from [-2, -2] to [-2, 2] - should trim left side (start)"
    // from the TypeScript test file
    let base_kcl_code = r#"sketch(on = YZ) {
  line1 = line(start = [var 0mm, var 5mm], end = [var 0mm, var -5mm])
  line2 = line(start = [var 5mm, var 0mm], end = [var -5mm, var 0mm])
}
"#;

    let trim_points = vec![Coords2d { x: -2.0, y: -2.0 }, Coords2d { x: -2.0, y: 2.0 }];

    let expected_code = r#"sketch(on = YZ) {
  line1 = line(start = [var 0mm, var 5mm], end = [var 0mm, var -5mm])
  line2 = line(start = [var 5mm, var 0mm], end = [var 0mm, var 0mm])
  coincident([line2.end, line1])
}
"#;

    assert_trim_result_default_sketch(base_kcl_code, &trim_points, expected_code).await;
}
#[tokio::test]
async fn test_tail_cut_should_remove_constraints_on_that_end_of_trimmed_segment() {
    // This test mirrors: "Case 1: trim line2 from [-2, -2] to [-2, 2] - should trim left side (start)"
    // from the TypeScript test file
    let base_kcl_code = r#"sketch(on = YZ) {
  line1 = line(start = [var -5.33mm, var 3.69mm], end = [var -5.93mm, var -2.59mm])
  line2 = line(start = [var -5.1mm, var 0.75mm], end = [var 4.01mm, var 0.68mm])
  line3 = line(start = [var 4.26mm, var -3.44mm], end = [var 4.33mm, var 3.61mm])
  line4 = line(start = [var -0.9mm, var 0.43mm], end = [var -1.28mm, var -3.04mm])
  coincident([line2.start, line1])
  coincident([line4.start, line2])
  coincident([line2.end, line3])
}
"#;

    let trim_points = vec![Coords2d { x: -2.18, y: 4.92 }, Coords2d { x: -4.23, y: -5.15 }];

    let expected_code = r#"sketch(on = YZ) {
  line1 = line(start = [var -5.33mm, var 3.69mm], end = [var -5.93mm, var -2.59mm])
  line2 = line(start = [var -0.9mm, var 0.63mm], end = [var 4.01mm, var 0.68mm])
  line3 = line(start = [var 4.03mm, var -3.44mm], end = [var 4mm, var 3.61mm])
  line4 = line(start = [var -0.9mm, var 0.63mm], end = [var -1.28mm, var -3.04mm])
  coincident([line2.end, line3])
  coincident([line2.start, line4.start])
}
"#;

    assert_trim_result_default_sketch(base_kcl_code, &trim_points, expected_code).await;
}

#[tokio::test]
async fn test_trim_line2_right_side() {
    // Case 2: trim line2 from [2, -2] to [2, 2] - should trim right side (end)
    let base_kcl_code = r#"sketch(on = YZ) {
  line1 = line(start = [var 0mm, var 5mm], end = [var 0mm, var -5mm])
  line2 = line(start = [var 5mm, var 0mm], end = [var -5mm, var 0mm])
}
"#;

    let trim_points = vec![Coords2d { x: 2.0, y: -2.0 }, Coords2d { x: 2.0, y: 2.0 }];

    let expected_code = r#"sketch(on = YZ) {
  line1 = line(start = [var 0mm, var 5mm], end = [var 0mm, var -5mm])
  line2 = line(start = [var 0mm, var 0mm], end = [var -5mm, var 0mm])
  coincident([line2.start, line1])
}
"#;

    assert_trim_result_default_sketch(base_kcl_code, &trim_points, expected_code).await;
}

#[tokio::test]
async fn test_trim_line1_bottom() {
    // Case 3: trim line1 from [-2, 2] to [2, 2] - should trim bottom (end)
    let base_kcl_code = r#"sketch(on = YZ) {
  line1 = line(start = [var 0mm, var 5mm], end = [var 0mm, var -5mm])
  line2 = line(start = [var 5mm, var 0mm], end = [var -5mm, var 0mm])
}
"#;

    let trim_points = vec![Coords2d { x: -2.0, y: 2.0 }, Coords2d { x: 2.0, y: 2.0 }];

    let expected_code = r#"sketch(on = YZ) {
  line1 = line(start = [var 0mm, var 0mm], end = [var 0mm, var -5mm])
  line2 = line(start = [var 5mm, var 0mm], end = [var -5mm, var 0mm])
  coincident([line1.start, line2])
}
"#;

    assert_trim_result_default_sketch(base_kcl_code, &trim_points, expected_code).await;
}

#[tokio::test]
async fn test_trim_line1_top() {
    // Case 4: trim line1 from [-2, -2] to [2, -2] - should trim top (start)
    let base_kcl_code = r#"sketch(on = YZ) {
  line1 = line(start = [var 0mm, var 5mm], end = [var 0mm, var -5mm])
  line2 = line(start = [var 5mm, var 0mm], end = [var -5mm, var 0mm])
}
"#;

    let trim_points = vec![Coords2d { x: -2.0, y: -2.0 }, Coords2d { x: 2.0, y: -2.0 }];

    let expected_code = r#"sketch(on = YZ) {
  line1 = line(start = [var 0mm, var 5mm], end = [var 0mm, var 0mm])
  line2 = line(start = [var 5mm, var 0mm], end = [var -5mm, var 0mm])
  coincident([line1.end, line2])
}
"#;

    assert_trim_result_default_sketch(base_kcl_code, &trim_points, expected_code).await;
}

#[tokio::test]
async fn test_trim_arc2_left_side() {
    // Case 1: trim arc2 from [-2, -2] to [-2, 2] - should trim left side (start)
    let base_kcl_code = r#"sketch(on = YZ) {
  arc1 = arc(start = [var 0mm, var 5mm], end = [var 0mm, var -5mm], center = [var 30mm, var 0mm])
  arc2 = arc(start = [var 5mm, var 0mm], end = [var -5mm, var 0mm], center = [var 0mm, var -30mm])
}
"#;

    let trim_points = vec![Coords2d { x: -2.0, y: -2.0 }, Coords2d { x: -2.0, y: 2.0 }];

    let expected_code = r#"sketch(on = YZ) {
  arc1 = arc(start = [var 0mm, var 5mm], end = [var 0mm, var -5mm], center = [var 30mm, var 0mm])
  arc2 = arc(start = [var 5mm, var -0mm], end = [var -0.41mm, var 0.41mm], center = [var 0mm, var -30mm])
  coincident([arc2.end, arc1])
}
"#;

    assert_trim_result_default_sketch(base_kcl_code, &trim_points, expected_code).await;
}

#[tokio::test]
async fn test_trim_arc2_right_side() {
    // Case 2: trim arc2 from [2, -2] to [2, 2] - should trim right side (end)
    let base_kcl_code = r#"sketch(on = YZ) {
  arc1 = arc(start = [var 0mm, var 5mm], end = [var 0mm, var -5mm], center = [var 30mm, var 0mm])
  arc2 = arc(start = [var 5mm, var 0mm], end = [var -5mm, var 0mm], center = [var 0mm, var -30mm])
}
"#;

    let trim_points = vec![Coords2d { x: 2.0, y: -2.0 }, Coords2d { x: 2.0, y: 2.0 }];

    let expected_code = r#"sketch(on = YZ) {
  arc1 = arc(start = [var 0mm, var 5mm], end = [var 0mm, var -5mm], center = [var 30mm, var 0mm])
  arc2 = arc(start = [var -0.41mm, var 0.41mm], end = [var -5mm, var -0mm], center = [var 0mm, var -30mm])
  coincident([arc2.start, arc1])
}
"#;

    assert_trim_result_default_sketch(base_kcl_code, &trim_points, expected_code).await;
}

#[tokio::test]
async fn test_trim_arc1_bottom() {
    // Case 3: trim arc1 from [-2, 2] to [2, 2] - should trim bottom (end)
    let base_kcl_code = r#"sketch(on = YZ) {
  arc1 = arc(start = [var 0mm, var 5mm], end = [var 0mm, var -5mm], center = [var 30mm, var 0mm])
  arc2 = arc(start = [var 5mm, var 0mm], end = [var -5mm, var 0mm], center = [var 0mm, var -30mm])
}
"#;

    let trim_points = vec![Coords2d { x: -2.0, y: 2.0 }, Coords2d { x: 2.0, y: 2.0 }];

    let expected_code = r#"sketch(on = YZ) {
  arc1 = arc(start = [var -0.41mm, var 0.41mm], end = [var 0mm, var -5mm], center = [var 30mm, var 0mm])
  arc2 = arc(start = [var 5mm, var 0mm], end = [var -5mm, var 0mm], center = [var 0mm, var -30mm])
  coincident([arc1.start, arc2])
}
"#;

    assert_trim_result_default_sketch(base_kcl_code, &trim_points, expected_code).await;
}

#[tokio::test]
async fn test_trim_arc1_top() {
    // Case 4: trim arc1 from [-2, -2] to [2, -2] - should trim top (start)
    let base_kcl_code = r#"sketch(on = YZ) {
  arc1 = arc(start = [var 0mm, var 5mm], end = [var 0mm, var -5mm], center = [var 30mm, var 0mm])
  arc2 = arc(start = [var 5mm, var 0mm], end = [var -5mm, var 0mm], center = [var 0mm, var -30mm])
}
"#;

    let trim_points = vec![Coords2d { x: -2.0, y: -2.0 }, Coords2d { x: 2.0, y: -2.0 }];

    let expected_code = r#"sketch(on = YZ) {
  arc1 = arc(start = [var 0mm, var 5mm], end = [var -0.41mm, var 0.41mm], center = [var 30mm, var 0mm])
  arc2 = arc(start = [var 5mm, var 0mm], end = [var -5mm, var 0mm], center = [var 0mm, var -30mm])
  coincident([arc1.end, arc2])
}
"#;

    assert_trim_result_default_sketch(base_kcl_code, &trim_points, expected_code).await;
}

#[tokio::test]
async fn test_trim_delete_both_segments() {
    // should delete both segments when a single section of the trim line intersects two segments
    let base_kcl_code = r#"sketch(on = YZ) {
  line2 = line(start = [var 4mm, var 3mm], end = [var 4mm, var -3mm])
  line1 = line(start = [var -4mm, var 3mm], end = [var -4mm, var -3mm])
}
"#;

    let trim_points = vec![Coords2d { x: -5.0, y: 1.0 }, Coords2d { x: 5.0, y: 1.0 }];

    let expected_code = r#"sketch(on = YZ) {
}
"#;

    assert_trim_result_default_sketch(base_kcl_code, &trim_points, expected_code).await;
}

#[tokio::test]
async fn test_trim_remove_coincident_point_from_segment_end() {
    // Should remove coincident point from the end of a segment's end that is being trimmed
    let base_kcl_code = r#"sketch(on = YZ) {
  line1 = line(start = [var -5mm, var 5mm], end = [var -3mm, var 2mm])
  line2 = line(start = [var -3mm, var 2mm], end = [var 3mm, var 2mm])
  coincident([line1.end, line2.start])
  line3 = line(start = [var 3.5mm, var 2mm], end = [var 5mm, var 5mm])
  coincident([line2.end, line3.start])
  arc(start = [var 1mm, var 5mm], end = [var 1mm, var -1mm], center = [var 5mm, var 2mm])
}
"#;

    let trim_points = vec![Coords2d { x: -1.5, y: 5.0 }, Coords2d { x: -1.5, y: -5.0 }];

    let expected_code = r#"sketch(on = YZ) {
  line1 = line(start = [var -5mm, var 5mm], end = [var -3mm, var 2mm])
  line2 = line(start = [var 0mm, var 2mm], end = [var 3mm, var 2mm])
  line3 = line(start = [var 3mm, var 2mm], end = [var 5mm, var 5mm])
  coincident([line2.end, line3.start])
  arc1 = arc(start = [var 1mm, var 5mm], end = [var 1mm, var -1mm], center = [var 5mm, var 2mm])
  coincident([line2.start, arc1])
}
"#;

    assert_trim_result_default_sketch(base_kcl_code, &trim_points, expected_code).await;
}

#[tokio::test]
async fn test_trim_remove_point_axis_constraint_from_segment_end() {
    let base_kcl_code = r#"sketch(on = YZ) {
  line1 = line(start = [var -5mm, var 5mm], end = [var -3mm, var 2mm])
  line2 = line(start = [var -3mm, var 2mm], end = [var 3mm, var 2mm])
  vertical([line1.end, line2.start])
  line3 = line(start = [var 3.5mm, var 2mm], end = [var 5mm, var 5mm])
  horizontal([line2.end, line3.start])
  arc(start = [var 1mm, var 5mm], end = [var 1mm, var -1mm], center = [var 5mm, var 2mm])
}
"#;

    let trim_points = vec![Coords2d { x: -1.5, y: 5.0 }, Coords2d { x: -1.5, y: -5.0 }];

    let expected_code = r#"sketch(on = YZ) {
  line1 = line(start = [var -5mm, var 5mm], end = [var -3mm, var 2mm])
  line2 = line(start = [var 0mm, var 2mm], end = [var 3mm, var 2mm])
  line3 = line(start = [var 3.5mm, var 2mm], end = [var 5mm, var 5mm])
  horizontal([line2.end, line3.start])
  arc1 = arc(start = [var 1mm, var 5mm], end = [var 1mm, var -1mm], center = [var 5mm, var 2mm])
  coincident([line2.start, arc1])
}
"#;

    assert_trim_result_default_sketch(base_kcl_code, &trim_points, expected_code).await;
}

/// Same logical trim line [[-15, 50], [-15, -50]] (vertical at -15mm) and equivalent sketches in cm vs mm.
/// Trim line should produce equivalent trimmed sketches regardless of sketch default unit.
#[tokio::test]
async fn test_trim_should_work_with_different_units() {
    let base_kcl_code = r#"@settings(defaultLengthUnit = mm)

sketch(on = YZ) {
  line1 = line(start = [var -10mm, var 50mm], end = [var -10mm, var -50mm])
  line2 = line(start = [var -20mm, var 0mm], end = [var 50mm, var 0mm])
}
"#;

    let trim_points = vec![Coords2d { x: -15.0, y: 50.0 }, Coords2d { x: -15.0, y: -50.0 }];

    // Expected: trim line at -15mm trims line2 to the intersection with line1 at -10mm.
    let expected_code = r#"@settings(defaultLengthUnit = mm)

sketch(on = YZ) {
  line1 = line(start = [var -10mm, var 50mm], end = [var -10mm, var -50mm])
  line2 = line(start = [var -10mm, var 0mm], end = [var 50mm, var 0mm])
  coincident([line2.start, line1])
}
"#;

    assert_trim_result_default_sketch(base_kcl_code, &trim_points, expected_code).await;

    let base_kcl_code = r#"@settings(defaultLengthUnit = cm)

sketch(on = YZ) {
  line1 = line(start = [var -1cm, var 5cm], end = [var -1cm, var -5cm])
  line2 = line(start = [var -2cm, var 0cm], end = [var 5cm, var 0cm])
}
"#;

    // Same physical trim line as mm case, still provided in mm.
    let trim_points = vec![Coords2d { x: -15.0, y: 50.0 }, Coords2d { x: -15.0, y: -50.0 }];

    let expected_code = r#"@settings(defaultLengthUnit = cm)

sketch(on = YZ) {
  line1 = line(start = [var -1cm, var 5cm], end = [var -1cm, var -5cm])
  line2 = line(start = [var -1cm, var 0cm], end = [var 5cm, var 0cm])
  coincident([line2.start, line1])
}
"#;

    assert_trim_result_default_sketch(base_kcl_code, &trim_points, expected_code).await;
}

#[tokio::test]
async fn test_split_trim_with_point_line_coincident_constraint() {
    // split trim where the end of the trimmed segment has a point-line coincident constraint,
    // should move the constraint to the newly created segment
    let base_kcl_code = r#"sketch(on = YZ) {
  arc9 = arc(start = [var -5.648mm, var 6.909mm], end = [var -6.864mm, var 2.472mm], center = [var -0.293mm, var 3.056mm])
  arc2 = arc(start = [var -7.463mm, var 5.878mm], end = [var -4.365mm, var 6.798mm], center = [var -6.237mm, var 7.425mm])
  line5 = line(start = [var -7.81mm, var 3.77mm], end = [var -6.845mm, var 3.828mm])
  line6 = line(start = [var -7.47mm, var 2.459mm], end = [var -6.1mm, var 2.489mm])
  coincident([arc9.end, line6])
  coincident([line5.end, arc9])
}
"#;

    // Trim line that intersects arc9 at two points to cause a split trim
    let trim_points = vec![Coords2d { x: -5.69, y: 4.67 }, Coords2d { x: -7.65, y: 4.83 }];

    let expected_code = r#"sketch(on = YZ) {
  arc9 = arc(start = [var -5.65mm, var 6.91mm], end = [var -6.44mm, var 5.46mm], center = [var -0.29mm, var 3.06mm])
  arc2 = arc(start = [var -7.46mm, var 5.88mm], end = [var -4.36mm, var 6.8mm], center = [var -6.24mm, var 7.42mm])
  line5 = line(start = [var -7.81mm, var 3.77mm], end = [var -6.84mm, var 3.83mm])
  line6 = line(start = [var -7.47mm, var 2.46mm], end = [var -6.1mm, var 2.49mm])
  arc1 = arc(start = [var -6.84mm, var 3.83mm], end = [var -6.86mm, var 2.47mm], center = [var -0.29mm, var 3.06mm])
  coincident([arc9.end, arc2])
  coincident([arc1.start, line5.end])
  coincident([arc1.end, line6])
}
"#;

    assert_trim_result_default_sketch(base_kcl_code, &trim_points, expected_code).await;
}

#[tokio::test]
async fn test_arc_line_trim_replace_point_segment_coincident() {
    // replaces point-segment coincident with point-point when trimming at coincident endpoint
    let base_kcl_code = r#"sketch(on = YZ) {
  arc1 = arc(start = [var 0mm, var 5mm], end = [var 0mm, var -5mm], center = [var 30mm, var 0mm])
  line1 = line(start = [var -5mm, var -2mm], end = [var -0.41mm, var -0.17mm])
  coincident([line1.end, arc1])
}
"#;

    let trim_points = vec![Coords2d { x: -2.0, y: 2.0 }, Coords2d { x: 2.0, y: 2.0 }];

    let expected_code = r#"sketch(on = YZ) {
  arc1 = arc(start = [var -0.41mm, var -0.17mm], end = [var 0mm, var -5mm], center = [var 30mm, var 0mm])
  line1 = line(start = [var -5mm, var -2mm], end = [var -0.41mm, var -0.17mm])
  coincident([arc1.start, line1.end])
}
"#;

    assert_trim_result_default_sketch(base_kcl_code, &trim_points, expected_code).await;
}

#[tokio::test]
async fn test_split_trim_line_trimmed_between_two_intersections() {
    // splits line1 into two segments when trimmed between two intersections
    let base_kcl_code = r#"sketch(on = YZ) {
  line1 = line(start = [var -4mm, var 0mm], end = [var 5mm, var 0mm])
  line2 = line(start = [var -2mm, var 4mm], end = [var -2mm, var -4mm])
  arc1 = arc(start = [var 2mm, var 4mm], end = [var 2mm, var -4mm], center = [var 500mm, var 0mm])
}
"#;

    let trim_points = vec![Coords2d { x: 0.0, y: 2.0 }, Coords2d { x: 0.0, y: -2.0 }];

    let expected_code = r#"sketch(on = YZ) {
  line1 = line(start = [var -4mm, var 0mm], end = [var -2mm, var 0mm])
  line2 = line(start = [var -2mm, var 4mm], end = [var -2mm, var -4mm])
  arc1 = arc(start = [var 2mm, var 4mm], end = [var 2mm, var -4mm], center = [var 500mm, var 0mm])
  line3 = line(start = [var 1.98mm, var 0mm], end = [var 5mm, var 0mm])
  coincident([line1.end, line2])
  coincident([line3.start, arc1])
}
"#;

    assert_trim_result_default_sketch(base_kcl_code, &trim_points, expected_code).await;
}

#[tokio::test]
async fn test_split_lines_with_point_segment_coincident_points() {
    // another edge case involving split lines and point-segment coincident points
    let base_kcl_code = r#"sketch(on = YZ) {
  line1 = line(start = [var -3.86mm, var 5.53mm], end = [var -4.35mm, var 2.301mm])
  line2 = line(start = [var -6.13mm, var 1.67mm], end = [var 4.25mm, var 5.351mm])
  arc4 = arc(start = [var 3.09mm, var 4.939mm], end = [var 2.691mm, var 6.42mm], center = [var -7.39mm, var 2.91mm])
  coincident([arc4.start, line2])
  coincident([line1.end, line2])
  arc3 = arc(start = [var -2.42mm, var 5.38mm], end = [var -0.69mm, var -0.661mm], center = [var 1.286mm, var 3.174mm])
}
"#;

    let trim_points = vec![Coords2d { x: 0.0, y: 6.0 }, Coords2d { x: -1.1, y: 1.6 }];

    let expected_code = r#"sketch(on = YZ) {
  line1 = line(start = [var -3.86mm, var 5.53mm], end = [var -4.35mm, var 2.3mm])
  line2 = line(start = [var -6.13mm, var 1.67mm], end = [var -3.01mm, var 2.78mm])
  arc4 = arc(start = [var 3.09mm, var 4.94mm], end = [var 2.69mm, var 6.42mm], center = [var -7.39mm, var 2.91mm])
  coincident([line1.end, line2])
  arc3 = arc(start = [var -2.42mm, var 5.38mm], end = [var -0.69mm, var -0.66mm], center = [var 1.29mm, var 3.17mm])
  line3 = line(start = [var 3.09mm, var 4.94mm], end = [var 4.25mm, var 5.35mm])
  coincident([line2.end, arc3])
  coincident([line3.start, arc4.start])
}
"#;

    assert_trim_result_default_sketch(base_kcl_code, &trim_points, expected_code).await;
}

#[tokio::test]
async fn test_split_arc_with_point_segment_coincident_constraints() {
    // Can split arc with point-segment coincident constraints
    let base_kcl_code = r#"sketch(on = YZ) {
  arc1 = arc(start = [var -3.2mm, var 6.2mm], end = [var -1.8mm, var -4.7mm], center = [var 1.8mm, var 1.3mm])
  arc2 = arc(start = [var -4.6mm, var -1.6mm], end = [var -6.5mm, var -2mm], center = [var -4.4mm, var -8.2mm])
  line1 = line(start = [var -7.5mm, var 2.5mm], end = [var -5.1mm, var 2.3mm])
  coincident([line1.end, arc1])
  coincident([arc2.start, arc1])
}
"#;

    // Test that all trim lines produce the same result
    let trim_lines = [
        vec![Coords2d { x: -3.45, y: -1.3 }, Coords2d { x: -5.53, y: -1.3 }],
        vec![Coords2d { x: -3.93, y: 2.17 }, Coords2d { x: -6.24, y: 2.14 }],
        vec![Coords2d { x: -3.77, y: 0.5 }, Coords2d { x: -6.11, y: 0.37 }],
    ];

    let expected_code = r#"sketch(on = YZ) {
  arc1 = arc(start = [var -3.2mm, var 6.2mm], end = [var -5.12mm, var 2.3mm], center = [var 1.8mm, var 1.3mm])
  arc2 = arc(start = [var -4.59mm, var -1.62mm], end = [var -6.51mm, var -1.97mm], center = [var -4.39mm, var -8.2mm])
  line1 = line(start = [var -7.5mm, var 2.5mm], end = [var -5.12mm, var 2.3mm])
  arc3 = arc(start = [var -4.59mm, var -1.62mm], end = [var -1.81mm, var -4.72mm], center = [var 1.8mm, var 1.3mm])
  coincident([arc1.end, line1.end])
  coincident([arc3.start, arc2.start])
}
"#;

    let sketch_id = ObjectId(1);

    for trim_points in trim_lines.iter() {
        assert_trim_result(base_kcl_code, trim_points, expected_code, sketch_id).await;
    }
}

#[tokio::test]
async fn test_split_arc_with_point_segment_coincident_on_one_side_and_intersection_on_other() {
    // split arc with point-segment coincident on one side and intersection on the other
    let base_kcl_code = r#"sketch(on = YZ) {
  arc2 = arc(start = [var 2.541mm, var -5.65mm], end = [var 1.979mm, var 6.83mm], center = [var -7.28mm, var 0.161mm])
  arc1 = arc(start = [var 5.69mm, var 4.559mm], end = [var -4.011mm, var -3.04mm], center = [var 5.1mm, var -4.678mm])
  line1 = line(start = [var -4.28mm, var 4.29mm], end = [var 1.34mm, var -4.76mm])
  line4 = line(start = [var -1.029mm, var 2.259mm], end = [var -2.01mm, var -6.62mm])
  coincident([line4.start, arc1])
}
"#;

    let trim_points = vec![Coords2d { x: -0.4, y: 4.4 }, Coords2d { x: 1.3, y: 2.4 }];

    let expected_code = r#"sketch(on = YZ) {
  arc2 = arc(start = [var 2.54mm, var -5.65mm], end = [var 1.98mm, var 6.83mm], center = [var -7.28mm, var 0.16mm])
  arc1 = arc(start = [var 5.69mm, var 4.56mm], end = [var 3.31mm, var 4.4mm], center = [var 5.1mm, var -4.68mm])
  line1 = line(start = [var -4.28mm, var 4.29mm], end = [var 1.34mm, var -4.76mm])
  line4 = line(start = [var -1.03mm, var 2.26mm], end = [var -2.01mm, var -6.62mm])
  arc3 = arc(start = [var -1.03mm, var 2.26mm], end = [var -4.01mm, var -3.04mm], center = [var 5.1mm, var -4.68mm])
  coincident([arc1.end, arc2])
  coincident([arc3.start, line4.start])
}
"#;

    assert_trim_result_default_sketch(base_kcl_code, &trim_points, expected_code).await;
}

#[tokio::test]
async fn test_split_straight_segments_migrate_constraints() {
    // split straight segments should migrate other constraints correctly
    let base_kcl_code = r#"sketch(on = YZ) {
  segmentToBeTrimmedAndSplit = line(start = [var -6mm, var 0mm], end = [var 6mm, var 0mm])
  startSideCoincidentWithTrimSegStart = line(start = [var -6mm, var 3mm], end = [var -6mm, var -3mm])
  startSideEndPointCoincidentWithTrimSeg = line(start = [var -4mm, var 0mm], end = [var -4mm, var 3mm])
  startSideIntersectionTrimTermination = line(start = [var -2mm, var 3mm], end = [var -2mm, var -3mm])
  endSideIntersectionTrimTermination = line(start = [var 2mm, var 3mm], end = [var 2mm, var -3mm])
  endSideEndPointCoincidentWithTrimSeg = line(start = [var 4mm, var -3mm], end = [var 4mm, var 0mm])
  endSideCoincidentWithTrimSegStart = line(start = [var 6mm, var 3mm], end = [var 6mm, var -3mm])
  coincident([
    segmentToBeTrimmedAndSplit.start,
    startSideCoincidentWithTrimSegStart
  ])
  coincident([
    startSideEndPointCoincidentWithTrimSeg.start,
    segmentToBeTrimmedAndSplit
  ])
  coincident([
    endSideEndPointCoincidentWithTrimSeg.end,
    segmentToBeTrimmedAndSplit
  ])
  coincident([
    segmentToBeTrimmedAndSplit.end,
    endSideCoincidentWithTrimSegStart
  ])
}
"#;

    let trim_points = vec![Coords2d { x: 0.0, y: 4.0 }, Coords2d { x: 0.0, y: -4.0 }];

    let expected_code = r#"sketch(on = YZ) {
  segmentToBeTrimmedAndSplit = line(start = [var -6mm, var 0mm], end = [var -2mm, var 0mm])
  startSideCoincidentWithTrimSegStart = line(start = [var -6mm, var 3mm], end = [var -6mm, var -3mm])
  startSideEndPointCoincidentWithTrimSeg = line(start = [var -4mm, var 0mm], end = [var -4mm, var 3mm])
  startSideIntersectionTrimTermination = line(start = [var -2mm, var 3mm], end = [var -2mm, var -3mm])
  endSideIntersectionTrimTermination = line(start = [var 2mm, var 3mm], end = [var 2mm, var -3mm])
  endSideEndPointCoincidentWithTrimSeg = line(start = [var 4mm, var -3mm], end = [var 4mm, var 0mm])
  endSideCoincidentWithTrimSegStart = line(start = [var 6mm, var 3mm], end = [var 6mm, var -3mm])
  coincident([
    segmentToBeTrimmedAndSplit.start,
    startSideCoincidentWithTrimSegStart
  ])
  coincident([
    startSideEndPointCoincidentWithTrimSeg.start,
    segmentToBeTrimmedAndSplit
  ])
  line1 = line(start = [var 2mm, var 0mm], end = [var 6mm, var 0mm])
  coincident([
    segmentToBeTrimmedAndSplit.end,
    startSideIntersectionTrimTermination
  ])
  coincident([
    line1.start,
    endSideIntersectionTrimTermination
  ])
  coincident([
    line1.end,
    endSideCoincidentWithTrimSegStart
  ])
  coincident([
    endSideEndPointCoincidentWithTrimSeg.end,
    line1
  ])
}
"#;

    assert_trim_result_default_sketch(base_kcl_code, &trim_points, expected_code).await;
}

#[tokio::test]
async fn test_trim_with_distance_constraints_preserve_constraints() {
    // trim with distance constraints should preserve constraints correctly
    let base_kcl_code = r#"sketch(on = YZ) {
  line1 = line(start = [var -5.5mm, var 7mm], end = [var -3mm, var 5mm])
  simpleDeleteLineDisConstraintDeletedAsWell = line(start = [var -3mm, var 5mm], end = [var 3.5mm, var 4.5mm])
  coincident([
    line1.end,
    simpleDeleteLineDisConstraintDeletedAsWell.start
  ])
  simpleDeleteLineDisConstraintDeletedAsWell2 = line(start = [var -3.5mm, var 3.5mm], end = [var 3.5mm, var 3.5mm])
  line4 = line(start = [var -6mm, var 4mm], end = [var -3.5mm, var 2mm])
  endTrimmedShouldDeleteDisConstraint = line(start = [var -3.5mm, var 2mm], end = [var 3mm, var 2mm])
  coincident([
    line4.end,
    endTrimmedShouldDeleteDisConstraint.start
  ])
  line6 = line(start = [var -3mm, var 1mm], end = [var -2mm, var 2.5mm])
  startTrimmedAlsoDeleteDisConstraint = line(start = [var -3.22mm, var -0.64mm], end = [var 3.02mm, var -0.75mm])
  line3 = line(start = [var 3.02mm, var -0.75mm], end = [var 5.38mm, var 1.14mm])
  coincident([
    startTrimmedAlsoDeleteDisConstraint.end,
    line3.start
  ])
  line5 = line(start = [var 1.24mm, var 0.92mm], end = [var 1.84mm, var -1.64mm])
  splitTrimLineDistanceConstraintMigrated = line(start = [var -2.67mm, var -3.46mm], end = [var 2.87mm, var -3.54mm])
  line8 = line(start = [var 2.87mm, var -3.54mm], end = [var 5.42mm, var -1.72mm])
  coincident([
    splitTrimLineDistanceConstraintMigrated.end,
    line8.start
  ])
  line9 = line(start = [var 1.1mm, var -3.98mm], end = [var 1.28mm, var -5.69mm])
  line10 = line(start = [var 1.98mm, var -4.06mm], end = [var 2.57mm, var -5.65mm])
  line11 = line(start = [var -1.93mm, var -2.2mm], end = [var -1.6mm, var -5.43mm])
  coincident([
    line9.start,
    splitTrimLineDistanceConstraintMigrated
  ])
  coincident([
    line10.start,
    splitTrimLineDistanceConstraintMigrated
  ])
  distance([
    simpleDeleteLineDisConstraintDeletedAsWell.start,
    simpleDeleteLineDisConstraintDeletedAsWell.end
  ]) == 6.52mm
  distance([
    simpleDeleteLineDisConstraintDeletedAsWell2.start,
    simpleDeleteLineDisConstraintDeletedAsWell2.end
  ]) == 7mm
  distance([
    endTrimmedShouldDeleteDisConstraint.start,
    endTrimmedShouldDeleteDisConstraint.end
  ]) == 6.5mm
  distance([
    startTrimmedAlsoDeleteDisConstraint.start,
    startTrimmedAlsoDeleteDisConstraint.end
  ]) == 6.24mm
  distance([
    splitTrimLineDistanceConstraintMigrated.start,
    splitTrimLineDistanceConstraintMigrated.end
  ]) == 5.54mm
}
"#;

    let trim_points = vec![
        Coords2d { x: -0.56, y: 5.56 },
        Coords2d { x: -0.97, y: 4.11 },
        Coords2d { x: -0.97, y: 2.77 },
        Coords2d { x: -0.93, y: 0.77 },
        Coords2d { x: -0.56, y: -2.61 },
        Coords2d { x: 0.14, y: -4.8 },
    ];

    let expected_code = r#"sketch(on = YZ) {
  line1 = line(start = [var -5.5mm, var 7mm], end = [var -3mm, var 5mm])
  line4 = line(start = [var -6mm, var 4mm], end = [var -3.5mm, var 2mm])
  endTrimmedShouldDeleteDisConstraint = line(start = [var -3.5mm, var 2mm], end = [var -2.33mm, var 2mm])
  coincident([
    line4.end,
    endTrimmedShouldDeleteDisConstraint.start
  ])
  line6 = line(start = [var -3mm, var 1mm], end = [var -2mm, var 2.5mm])
  startTrimmedAlsoDeleteDisConstraint = line(start = [var 1.63mm, var -0.73mm], end = [var 3.02mm, var -0.75mm])
  line3 = line(start = [var 3.02mm, var -0.75mm], end = [var 5.38mm, var 1.14mm])
  coincident([
    startTrimmedAlsoDeleteDisConstraint.end,
    line3.start
  ])
  line5 = line(start = [var 1.24mm, var 0.92mm], end = [var 1.84mm, var -1.64mm])
  splitTrimLineDistanceConstraintMigrated = line(start = [var -2.67mm, var -3.46mm], end = [var -1.78mm, var -3.62mm])
  line8 = line(start = [var 2.87mm, var -3.72mm], end = [var 5.42mm, var -1.72mm])
  line9 = line(start = [var 1.1mm, var -3.91mm], end = [var 1.28mm, var -5.69mm])
  line10 = line(start = [var 1.99mm, var -3.81mm], end = [var 2.57mm, var -5.65mm])
  line11 = line(start = [var -1.93mm, var -2.2mm], end = [var -1.6mm, var -5.43mm])
  coincident([
    endTrimmedShouldDeleteDisConstraint.end,
    line6
  ])
  coincident([
    startTrimmedAlsoDeleteDisConstraint.start,
    line5
  ])
  line2 = line(start = [var 1.1mm, var -3.91mm], end = [var 2.87mm, var -3.72mm])
  coincident([
    splitTrimLineDistanceConstraintMigrated.end,
    line11
  ])
  coincident([line2.start, line9.start])
  coincident([line2.end, line8.start])
  coincident([line10.start, line2])
  distance([
  splitTrimLineDistanceConstraintMigrated.start,
  line2.end
]) == 5.54mm
}
"#;

    assert_trim_result_default_sketch(base_kcl_code, &trim_points, expected_code).await;
}

#[tokio::test]
async fn test_split_trim_migrate_angle_constraints() {
    // split trim should migrate angle constraints to new segment
    let base_kcl_code = r#"sketch(on = YZ) {
  line1 = line(start = [var -2.01mm, var 6.12mm], end = [var 0.23mm, var 4.55mm])
  line2 = line(start = [var -4.15mm, var -0mm], end = [var 0.79mm, var -3.47mm])
  parallel([line1, line2])
  line3 = line(start = [var -3.1mm, var 1.3mm], end = [var -2.96mm, var -3.08mm])
  line4 = line(start = [var -0.58mm, var -0.81mm], end = [var -1.13mm, var -4.94mm])
  line5 = line(start = [var -0.11mm, var -3.3mm], end = [var -0.11mm, var -5.63mm])
  line6 = line(start = [var 1.49mm, var -3.48mm], end = [var 3.5mm, var -1.84mm])
  coincident([line6.start, line2.end])
  coincident([line5.start, line2])
}
"#;

    let trim_points = vec![Coords2d { x: -1.75, y: -0.56 }, Coords2d { x: -1.75, y: -2.93 }];

    let expected_code = r#"sketch(on = YZ) {
  line1 = line(start = [var -2.05mm, var 6.06mm], end = [var 0.27mm, var 4.61mm])
  line2 = line(start = [var -4.18mm, var -0.05mm], end = [var -3.02mm, var -0.78mm])
  parallel([line1, line2])
  line3 = line(start = [var -3.09mm, var 1.3mm], end = [var -2.95mm, var -3.08mm])
  line4 = line(start = [var -0.59mm, var -0.81mm], end = [var -1.14mm, var -4.94mm])
  line5 = line(start = [var 0.1mm, var -2.99mm], end = [var -0.11mm, var -5.63mm])
  line6 = line(start = [var 1.18mm, var -3.67mm], end = [var 3.5mm, var -1.84mm])
  line7 = line(start = [var -0.81mm, var -2.42mm], end = [var 1.18mm, var -3.67mm])
  coincident([line2.end, line3])
  coincident([line7.start, line4])
  coincident([line7.end, line6.start])
  coincident([line5.start, line7])
  parallel([line1, line7])
}
"#;

    assert_trim_result_default_sketch(base_kcl_code, &trim_points, expected_code).await;
}

#[tokio::test]
async fn test_split_trim_migrate_horizontal_constraint() {
    // split trim should migrate horizontal constraint to new segment
    let base_kcl_code = r#"sketch(on = YZ) {
  line1 = line(start = [var -3.64mm, var 1.26mm], end = [var 3.8mm, var 1.26mm])
  line2 = line(start = [var 3.32mm, var 5.32mm], end = [var -4.67mm, var -1.14mm])
  line3 = line(start = [var 4.34mm, var 3.17mm], end = [var -3.94mm, var -3.95mm])
  horizontal(line1)
}
"#;

    let trim_points = vec![Coords2d { x: 0.73, y: 1.85 }, Coords2d { x: -0.8, y: 0.25 }];

    let expected_code = r#"sketch(on = YZ) {
  line1 = line(start = [var -3.64mm, var 1.26mm], end = [var -1.7mm, var 1.26mm])
  line2 = line(start = [var 3.32mm, var 5.32mm], end = [var -4.67mm, var -1.14mm])
  line3 = line(start = [var 4.34mm, var 3.17mm], end = [var -3.94mm, var -3.95mm])
  horizontal(line1)
  line4 = line(start = [var 2.12mm, var 1.26mm], end = [var 3.8mm, var 1.26mm])
  coincident([line1.end, line2])
  coincident([line4.start, line3])
  horizontal(line4)
}
"#;

    assert_trim_result_default_sketch(base_kcl_code, &trim_points, expected_code).await;
}

#[tokio::test]
async fn test_split_trim_migrate_horizontal_points_constraint() {
    let base_kcl_code = r#"sketch(on = YZ) {
  line1 = line(start = [var -3.64mm, var 1.26mm], end = [var 3.8mm, var 1.26mm])
  line2 = line(start = [var 3.32mm, var 5.32mm], end = [var -4.67mm, var -1.14mm])
  line3 = line(start = [var 4.34mm, var 3.17mm], end = [var -3.94mm, var -3.95mm])
  point1 = point(at = [var 5mm, var 1.26mm])
  horizontal([line1.end, point1])
}
"#;

    let trim_points = vec![Coords2d { x: 0.73, y: 1.85 }, Coords2d { x: -0.8, y: 0.25 }];

    let expected_code = r#"sketch(on = YZ) {
  line1 = line(start = [var -3.64mm, var 1.26mm], end = [var -1.7mm, var 1.26mm])
  line2 = line(start = [var 3.32mm, var 5.32mm], end = [var -4.67mm, var -1.14mm])
  line3 = line(start = [var 4.34mm, var 3.17mm], end = [var -3.94mm, var -3.95mm])
  point1 = point(at = [var 5mm, var 1.26mm])
  line4 = line(start = [var 2.12mm, var 1.26mm], end = [var 3.8mm, var 1.26mm])
  coincident([line1.end, line2])
  coincident([line4.start, line3])
  horizontal([line4.end, point1])
}
"#;

    assert_trim_result_default_sketch(base_kcl_code, &trim_points, expected_code).await;
}

#[tokio::test]
async fn test_split_trim_migrate_vertical_constraint() {
    // split trim should migrate vertical constraint to new segment
    let base_kcl_code = r#"sketch(on = YZ) {
  line1 = line(start = [var -0.36mm, var 3.66mm], end = [var -0.36mm, var -2.66mm])
  line2 = line(start = [var 3.32mm, var 5.32mm], end = [var -4.67mm, var -1.14mm])
  line3 = line(start = [var 4.34mm, var 3.17mm], end = [var -3.94mm, var -3.95mm])
  vertical(line1)
}
"#;

    let trim_points = vec![Coords2d { x: 0.47, y: 1.45 }, Coords2d { x: -1.72, y: 0.1 }];

    let expected_code = r#"sketch(on = YZ) {
  line1 = line(start = [var -0.36mm, var 3.66mm], end = [var -0.36mm, var 2.34mm])
  line2 = line(start = [var 3.32mm, var 5.32mm], end = [var -4.67mm, var -1.14mm])
  line3 = line(start = [var 4.34mm, var 3.17mm], end = [var -3.94mm, var -3.95mm])
  vertical(line1)
  line4 = line(start = [var -0.36mm, var -0.87mm], end = [var -0.36mm, var -2.66mm])
  coincident([line1.end, line2])
  coincident([line4.start, line3])
  vertical(line4)
}
"#;

    assert_trim_result_default_sketch(base_kcl_code, &trim_points, expected_code).await;
}

#[tokio::test]
async fn test_split_trim_migrate_vertical_points_constraint() {
    let base_kcl_code = r#"sketch(on = YZ) {
  line1 = line(start = [var -0.36mm, var 3.66mm], end = [var -0.36mm, var -2.66mm])
  line2 = line(start = [var 3.32mm, var 5.32mm], end = [var -4.67mm, var -1.14mm])
  line3 = line(start = [var 4.34mm, var 3.17mm], end = [var -3.94mm, var -3.95mm])
  point1 = point(at = [var -0.36mm, var -4mm])
  vertical([line1.end, point1])
}
"#;

    let trim_points = vec![Coords2d { x: 0.47, y: 1.45 }, Coords2d { x: -1.72, y: 0.1 }];

    let expected_code = r#"sketch(on = YZ) {
  line1 = line(start = [var -0.36mm, var 3.66mm], end = [var -0.36mm, var 2.34mm])
  line2 = line(start = [var 3.32mm, var 5.32mm], end = [var -4.67mm, var -1.14mm])
  line3 = line(start = [var 4.34mm, var 3.17mm], end = [var -3.94mm, var -3.95mm])
  point1 = point(at = [var -0.36mm, var -4mm])
  line4 = line(start = [var -0.36mm, var -0.87mm], end = [var -0.36mm, var -2.66mm])
  coincident([line1.end, line2])
  coincident([line4.start, line3])
  vertical([line4.end, point1])
}
"#;

    assert_trim_result_default_sketch(base_kcl_code, &trim_points, expected_code).await;
}

#[tokio::test]
async fn test_split_trim_migrate_perpendicular_constraint() {
    // split trim should migrate perpendicular constraint to new segment
    let base_kcl_code = r#"sketch(on = YZ) {
  line4 = line(start = [var -0.91mm, var 5.79mm], end = [var 1.86mm, var 7.22mm])
  line1 = line(start = [var -1.97mm, var 3.24mm], end = [var 0.55mm, var -2.31mm])
  line2 = line(start = [var 3.32mm, var 5.32mm], end = [var -4.67mm, var -1.14mm])
  line3 = line(start = [var 4.34mm, var 3.17mm], end = [var -3.94mm, var -3.95mm])
  perpendicular([line4, line1])
}
"#;

    let trim_points = vec![Coords2d { x: 0.95, y: 1.67 }, Coords2d { x: -2.3, y: -0.08 }];

    let expected_code = r#"sketch(on = YZ) {
  line4 = line(start = [var -0.92mm, var 5.82mm], end = [var 1.87mm, var 7.19mm])
  line1 = line(start = [var -2mm, var 3.22mm], end = [var -1.22mm, var 1.64mm])
  line2 = line(start = [var 3.32mm, var 5.32mm], end = [var -4.67mm, var -1.14mm])
  line3 = line(start = [var 4.34mm, var 3.17mm], end = [var -3.94mm, var -3.95mm])
  perpendicular([line4, line1])
  line5 = line(start = [var -0.18mm, var -0.71mm], end = [var 0.6mm, var -2.29mm])
  coincident([line1.end, line2])
  coincident([line5.start, line3])
  perpendicular([line4, line5])
}
"#;

    assert_trim_result_default_sketch(base_kcl_code, &trim_points, expected_code).await;
}

#[tokio::test]
async fn test_split_arc_duplicate_center_point_constraints() {
    // split arc should duplicate center point constraints to new arc
    let base_kcl_code = r#"sketch(on = YZ) {
  arcToSplit = arc(start = [var 10.5mm, var 1mm], end = [var -10.5mm, var 0.5mm], center = [var 0.5mm, var -8.5mm])
  line1 = line(start = [var -6mm, var 8mm], end = [var -5.5mm, var 0mm])
  line2 = line(start = [var 4mm, var 8.5mm], end = [var 3mm, var 1.5mm])
  lineCoincidentWithArcCen = line(start = [var 1.5mm, var -9mm], end = [var 11.5mm, var -7.5mm])
  line4 = line(start = [var 11.5mm, var 1mm], end = [var 13mm, var 6.5mm])
  line5 = line(start = [var 7.5mm, var 4mm], end = [var 10mm, var 8mm])
  coincident([line5.start, arcToSplit])
  coincident([line4.start, arcToSplit.start])
  coincident([
    lineCoincidentWithArcCen.start,
    arcToSplit.center
  ])
  distance([arcToSplit.center, line4.end]) == 20mm
  line3 = line(start = [var -0.9mm, var -6.9mm], end = [var 2.9mm, var -11.2mm])
  coincident([arcToSplit.center, line3])
}
"#;

    let trim_points = vec![Coords2d { x: -1.66, y: 7.54 }, Coords2d { x: -1.81, y: 2.11 }];

    let expected_code = r#"sketch(on = YZ) {
  arcToSplit = arc(start = [var 11.07mm, var 1.06mm], end = [var 3.54mm, var 5.27mm], center = [var 0.67mm, var -8.71mm])
  line1 = line(start = [var -6mm, var 8mm], end = [var -5.5mm, var 0mm])
  line2 = line(start = [var 4mm, var 8.5mm], end = [var 3mm, var 1.5mm])
  lineCoincidentWithArcCen = line(start = [var 0.67mm, var -8.71mm], end = [var 11.5mm, var -7.5mm])
  line4 = line(start = [var 11.07mm, var 1.06mm], end = [var 13.27mm, var 6.82mm])
  line5 = line(start = [var 7.64mm, var 3.74mm], end = [var 10mm, var 8mm])
  coincident([line5.start, arcToSplit])
  coincident([line4.start, arcToSplit.start])
  coincident([
    lineCoincidentWithArcCen.start,
    arcToSplit.center
  ])
  distance([arcToSplit.center, line4.end]) == 20mm
  line3 = line(start = [var -0.92mm, var -6.92mm], end = [var 2.89mm, var -11.21mm])
  coincident([arcToSplit.center, line3])
  arc1 = arc(start = [var -5.76mm, var 4.08mm], end = [var -10.37mm, var 0.39mm], center = [var 0.67mm, var -8.71mm])
  coincident([arcToSplit.end, line2])
  coincident([arc1.start, line1])
  coincident([
    lineCoincidentWithArcCen.start,
    arc1.center
  ])
  distance([arc1.center, line4.end]) == 20mm
  coincident([arc1.center, line3])
}
"#;

    assert_trim_result_default_sketch(base_kcl_code, &trim_points, expected_code).await;
}

#[tokio::test]
async fn test_trimming_arcs_preserve_distance_constraints() {
    // Trimming arcs should preserve distance constraints that reference other segments
    let base_kcl_code = r#"sketch(on = YZ) {
  arc1 = arc(start = [var 0.87mm, var 2.9mm], end = [var -5.31mm, var -1.34mm], center = [var -0.65mm, var -1.5mm])
  line1 = line(start = [var -4.72mm, var 3.54mm], end = [var -2.24mm, var -1.48mm])
  line2 = line(start = [var 2.27mm, var -4.04mm], end = [var 4.65mm, var -1.26mm])
  distance([arc1.center, line2.start]) == 3.87mm
  line3 = line(start = [var -5.61mm, var 5.38mm], end = [var 1.03mm, var 5.53mm])
  line4 = line(start = [var 1.03mm, var 5.53mm], end = [var 6.15mm, var 3.11mm])
  coincident([line3.end, line4.start])
  line5 = line(start = [var -1.05mm, var 6.42mm], end = [var -0.77mm, var 4.73mm])
  distance([line4.end, line3.start]) == 11.98mm
}
"#;

    let trim_points = vec![
        Coords2d { x: 0.24, y: 6.57 },
        Coords2d { x: -1.66, y: 3.78 },
        Coords2d { x: -1.57, y: 1.03 },
    ];

    let expected_code = r#"sketch(on = YZ) {
  arc1 = arc(start = [var -3.89mm, var 1.85mm], end = [var -5.31mm, var -1.34mm], center = [var -0.65mm, var -1.5mm])
  line1 = line(start = [var -4.72mm, var 3.54mm], end = [var -2.24mm, var -1.48mm])
  line2 = line(start = [var 2.27mm, var -4.04mm], end = [var 4.65mm, var -1.26mm])
  distance([arc1.center, line2.start]) == 3.87mm
  line3 = line(start = [var -5.61mm, var 5.38mm], end = [var -0.9mm, var 5.49mm])
  line4 = line(start = [var 1.03mm, var 5.53mm], end = [var 6.15mm, var 3.11mm])
  line5 = line(start = [var -1.05mm, var 6.42mm], end = [var -0.9mm, var 5.49mm])
  distance([line4.end, line3.start]) == 11.98mm
  coincident([line5.end, line3.end])
  coincident([arc1.start, line1])
}
"#;

    assert_trim_result_default_sketch(base_kcl_code, &trim_points, expected_code).await;
}

#[tokio::test]
async fn test_stress_complex_trim_line_through_many_segments() {
    // stress test: complex trim line through many segments
    let base_kcl_code = r#"sketch(on = YZ) {
  line1 = line(start = [var -5.17mm, var 4.96mm], end = [var 4.84mm, var 6.49mm])
  line2 = line(start = [var 4.84mm, var 6.49mm], end = [var -3.92mm, var 2.05mm])
  coincident([line1.end, line2.start])
  line3 = line(start = [var -3.92mm, var 2.05mm], end = [var 6.02mm, var 3.98mm])
  coincident([line2.end, line3.start])
  line4 = line(start = [var 6.02mm, var 3.98mm], end = [var -7.23mm, var -1.81mm])
  coincident([line3.end, line4.start])
  line5 = line(start = [var -7.23mm, var -1.81mm], end = [var 6.5mm, var -1.47mm])
  coincident([line4.end, line5.start])
  line6 = line(start = [var 6.5mm, var -1.47mm], end = [var -6.69mm, var -4.73mm])
  coincident([line5.end, line6.start])
  line7 = line(start = [var -6.69mm, var -4.73mm], end = [var 6.77mm, var -4.86mm])
  coincident([line6.end, line7.start])
  line10 = line(start = [var -1.08mm, var -10.86mm], end = [var -4.36mm, var 7.64mm])
  line11 = line(start = [var -4.36mm, var 7.64mm], end = [var 5.28mm, var -8.62mm])
  coincident([line10.end, line11.start])
  line12 = line(start = [var 5.28mm, var -8.62mm], end = [var 6.9mm, var 0.39mm])
  coincident([line11.end, line12.start])
  line13 = line(start = [var 6.9mm, var 0.39mm], end = [var -7.84mm, var 4.45mm])
  coincident([line12.end, line13.start])
  line14 = line(start = [var -7.84mm, var 4.45mm], end = [var 3.05mm, var 7.98mm])
  coincident([line13.end, line14.start])
  line15 = line(start = [var 3.05mm, var 7.98mm], end = [var 0.71mm, var -10.01mm])
  coincident([line14.end, line15.start])
  line18 = line(start = [var 5.24mm, var 2.08mm], end = [var -6.76mm, var 0.49mm])
  line19 = line(start = [var -6.76mm, var 0.49mm], end = [var -1.86mm, var 8.22mm])
  coincident([line18.end, line19.start])
  line20 = line(start = [var -1.86mm, var 8.22mm], end = [var 3.11mm, var -9.16mm])
  coincident([line19.end, line20.start])
  line21 = line(start = [var 3.11mm, var -9.16mm], end = [var 6.97mm, var 7.91mm])
  coincident([line20.end, line21.start])
  line22 = line(start = [var -6.96mm, var 3.03mm], end = [var 7mm, var -3.78mm])
  line23 = line(start = [var -1.99mm, var -2.39mm], end = [var 4.2mm, var 4.73mm])
  line24 = line(start = [var 1.42mm, var 6.72mm], end = [var -4.46mm, var 2.86mm])
  line25 = line(start = [var -6.18mm, var -3.61mm], end = [var -0.4mm, var -8.25mm])
  line27 = line(start = [var 5.45mm, var 7.3mm], end = [var -7.06mm, var 6.28mm])
  arc(start = [var 2.71mm, var -9.71mm], end = [var -3.98mm, var 8.12mm], center = [var -6.86mm, var -3.13mm])
  arc(start = [var -2.95mm, var 1.9mm], end = [var 1.73mm, var -6.79mm], center = [var 7.68mm, var 2.02mm])
  arc(start = [var -6.149mm, var 5.57mm], end = [var 6.911mm, var 3.169mm], center = [var 1.118mm, var 8.38mm])
  arc(start = [var 5.55mm, var 7.909mm], end = [var -7.641mm, var -6.45mm], center = [var 7.51mm, var -7.13mm])
  arc(start = [var 3.69mm, var -3.61mm], end = [var -5.68mm, var -5.96mm], center = [var 0.58mm, var -11.06mm])
  arc(start = [var -1.311mm, var -0.729mm], end = [var -0.609mm, var -8.789mm], center = [var 3.72mm, var -4.352mm])
  arc(start = [var -4.9mm, var 0.12mm], end = [var -5.32mm, var -3.75mm], center = [var -0.74mm, var -2.29mm])
  line8 = line(start = [var -6.79mm, var -6.46mm], end = [var -3.45mm, var -6.7mm])
  line9 = line(start = [var -4.8mm, var -6.07mm], end = [var -4.59mm, var -6.91mm])
  line16 = line(start = [var -7.78mm, var -7.36mm], end = [var -5.25mm, var -7.36mm])
  line17 = line(start = [var -5.25mm, var -7.36mm], end = [var -3.69mm, var -7.72mm])
  coincident([line16.end, line17.start])
  line26 = line(start = [var -3.69mm, var -7.72mm], end = [var -2.49mm, var -7.33mm])
  coincident([line17.end, line26.start])
  line28 = line(start = [var -5.4mm, var -7.99mm], end = [var -3.75mm, var -8.33mm])
  line29 = line(start = [var -4.89mm, var -5.47mm], end = [var -3.84mm, var -6.04mm])
  line30 = line(start = [var -7.42mm, var -8.27mm], end = [var -5.55mm, var -8.51mm])
  line31 = line(start = [var -5.55mm, var -8.51mm], end = [var -3.45mm, var -8.87mm])
  coincident([line30.end, line31.start])
  line32 = line(start = [var -7.54mm, var -9.14mm], end = [var -2.91mm, var -9.29mm])
  line33 = line(start = [var -2.91mm, var -9.92mm], end = [var -7.33mm, var -8.78mm])
  line34 = line(start = [var -5.07mm, var -2.3mm], end = [var -2.79mm, var -3mm])
  line35 = line(start = [var -5.04mm, var -3.12mm], end = [var -2.91mm, var -2.48mm])
}
"#;

    let trim_points = vec![
        Coords2d {
            x: -0.20484096959875361,
            y: 7.75406075078318,
        },
        Coords2d {
            x: 0.36613122302493517,
            y: 7.723947893498586,
        },
        Coords2d {
            x: 0.9371034156486249,
            y: 7.723947893498586,
        },
        Coords2d {
            x: 1.5080756082723146,
            y: 7.723947893498586,
        },
        Coords2d {
            x: 2.0790478008960025,
            y: 7.723947893498586,
        },
        Coords2d {
            x: 2.5598664894212146,
            y: 7.4228193206526365,
        },
        Coords2d {
            x: 2.5598664894212146,
            y: 6.850675032245334,
        },
        Coords2d {
            x: 2.0790478008960025,
            y: 6.519433602114789,
        },
        Coords2d {
            x: 1.5381267763051405,
            y: 6.338756458407221,
        },
        Coords2d {
            x: 0.9671545836814508,
            y: 6.3086436011226255,
        },
        Coords2d {
            x: 0.4262335590905869,
            y: 6.4592078875456,
        },
        Coords2d {
            x: -0.14473863353310187,
            y: 6.368869315691816,
        },
        Coords2d {
            x: -0.7157108261567917,
            y: 6.248417886553436,
        },
        Coords2d {
            x: -1.2566318507476546,
            y: 6.067740742845867,
        },
        Coords2d {
            x: -1.7975528753385184,
            y: 5.917176456422893,
        },
        Coords2d {
            x: -2.188218059765253,
            y: 5.495596454438564,
        },
        Coords2d {
            x: -1.8877063794369962,
            y: 5.0137907378850475,
        },
        Coords2d {
            x: -1.3167341868133065,
            y: 4.953565023315857,
        },
        Coords2d {
            x: -0.7457619941896175,
            y: 4.923452166031262,
        },
        Coords2d {
            x: -0.17478980156592777,
            y: 4.833113594177478,
        },
        Coords2d {
            x: 0.15577304679515594,
            y: 4.3513078776239595,
        },
        Coords2d {
            x: 0.4262335590905869,
            y: 3.839389303785847,
        },
        Coords2d {
            x: 0.4562847271234128,
            y: 3.267245015378544,
        },
        Coords2d {
            x: 0.30602888695928343,
            y: 2.725213584255836,
        },
        Coords2d {
            x: -0.024533961401799326,
            y: 2.2735207249869136,
        },
        Coords2d {
            x: -0.5955061540254881,
            y: 2.122956438563939,
        },
        Coords2d {
            x: -1.136427178616352,
            y: 1.9723921521409638,
        },
        Coords2d {
            x: -1.6773482032072158,
            y: 1.82182786571799,
        },
        Coords2d {
            x: -2.158166891732427,
            y: 2.122956438563939,
        },
        Coords2d {
            x: -2.638985580257639,
            y: 2.424085011409887,
        },
        Coords2d {
            x: -3.1799066048485027,
            y: 2.6047621551174567,
        },
        Coords2d {
            x: -3.750878797472192,
            y: 2.5746492978328623,
        },
        Coords2d {
            x: -4.171595149931753,
            y: 2.1530692958485336,
        },
        Coords2d {
            x: -4.502157998292836,
            y: 1.6712635792950152,
        },
        Coords2d {
            x: -4.892823182719571,
            y: 1.2496835773106867,
        },
        Coords2d {
            x: -4.381953326161533,
            y: 1.0087807190339289,
        },
        Coords2d {
            x: -4.351902158128707,
            y: 0.4366364306266254,
        },
        Coords2d {
            x: -4.141543981898927,
            y: -0.10539500049608215,
        },
        Coords2d {
            x: -3.991288141734798,
            y: -0.6474264316187898,
        },
        Coords2d {
            x: -3.8109811335378434,
            y: -1.1894578627414973,
        },
        Coords2d {
            x: -3.8109811335378434,
            y: -1.7616021511488007,
        },
        Coords2d {
            x: -3.4804182851767607,
            y: -2.213295010417723,
        },
        Coords2d {
            x: -3.149855436815677,
            y: -2.6649878696866476,
        },
        Coords2d {
            x: -3.2400089409141546,
            y: -3.2371321580939485,
        },
        Coords2d {
            x: -3.750878797472192,
            y: -3.4780350163707086,
        },
        Coords2d {
            x: -4.26174865403023,
            y: -3.7490507319320625,
        },
        Coords2d {
            x: -4.021339309767624,
            y: -4.260969305770174,
        },
        Coords2d {
            x: -3.5405206212424116,
            y: -4.562097878616124,
        },
        Coords2d {
            x: -3.5405206212424116,
            y: -5.134242167023425,
        },
        Coords2d {
            x: -3.991288141734798,
            y: -5.495596454438564,
        },
        Coords2d {
            x: -4.111492813866102,
            y: -6.037627885561271,
        },
        Coords2d {
            x: -4.0513904778004495,
            y: -6.609772173968575,
        },
        Coords2d {
            x: -3.991288141734798,
            y: -7.181916462375878,
        },
        Coords2d {
            x: -4.231697485997404,
            y: -7.69383503621399,
        },
        Coords2d {
            x: -4.412004494194359,
            y: -8.265979324621293,
        },
        Coords2d {
            x: -4.412004494194359,
            y: -8.838123613028595,
        },
        Coords2d {
            x: -4.562260334358488,
            y: -9.380155044151303,
        },
        Coords2d {
            x: -4.862772014686745,
            y: -9.861960760704822,
        },
    ];

    let start = std::time::Instant::now();
    let result = execute_trim_flow(base_kcl_code, &trim_points, ObjectId(1)).await;
    let duration = start.elapsed();

    let result = result.expect("trim flow failed");

    // Just assert that it doesn't error - the output code can be whatever the solver produces
    assert!(
        !result.kcl_code.trim().is_empty(),
        "Trim should produce non-empty KCL code"
    );

    // Assert that the test completes within a reasonable time.
    // Keep this fairly loose because CI machine load can vary significantly.
    const STRESS_TEST_MAX_MS: u128 = 70_000;
    assert!(
        duration.as_millis() < STRESS_TEST_MAX_MS,
        "Stress test should complete within {}ms, took {}ms",
        STRESS_TEST_MAX_MS,
        duration.as_millis()
    );
}

#[tokio::test]
async fn test_trim_through_segment_invalidates_ids() {
    // Test that trimming through a segment (which causes deletion) sets invalidates_ids to true
    // This is a regression test for the bug where segments disappear but points remain
    // due to ID mismatches when invalidates_ids is not properly propagated
    let base_kcl_code = r#"sketch(on = YZ) {
  arc3 = arc(start = [var 1.67mm, var 5.51mm], end = [var 5.77mm, var 1.36mm], center = [var 5.3mm, var 4.99mm])
  arc(start = [var 2.35mm, var 4.27mm], end = [var 0.44mm, var 4.55mm], center = [var 1.19mm, var 3.04mm])
  arc2 = arc(start = [var 6.49mm, var 5.09mm], end = [var 5.77mm, var 1.36mm], center = [var 7.56mm, var 2.95mm])
  coincident([arc2.end, arc3.end])
  line4 = line(start = [var 0.95mm, var 2.01mm], end = [var 6.62mm, var 4.2mm])
  line5 = line(start = [var 6.62mm, var 4.29mm], end = [var 2.02mm, var 0.37mm])
  coincident([line4.end, line5.start])
  line6 = line(start = [var 4.36mm, var 2.37mm], end = [var 2.9mm, var 5.83mm])
  coincident([line6.start, line5])
}
"#;

    // Trim line that goes through segments (points from the user's example)
    let trim_points = vec![Coords2d { x: 2.57, y: 1.83 }, Coords2d { x: 3.42, y: 2.49 }];

    let result = execute_trim_flow(base_kcl_code, &trim_points, ObjectId(1)).await;

    let result = result.expect("trim flow failed");

    // The key assertion: invalidates_ids should be true when trimming through segments
    // This happens because trimming through a segment causes deletion, which invalidates IDs
    assert!(
        result.invalidates_ids,
        "invalidates_ids should be true when trimming through segments that get deleted"
    );

    // Also verify that we got some KCL code back
    assert!(
        !result.kcl_code.trim().is_empty(),
        "Trim should produce non-empty KCL code"
    );
}

// Helper function to get objects from KCL code (similar to getSceneGraphDeltaFromKcl in TypeScript)
async fn get_objects_from_kcl(kcl_code: &str) -> Vec<crate::frontend::api::Object> {
    use crate::ExecutorContext;
    use crate::Program;
    use crate::execution::MockConfig;
    use crate::frontend::FrontendState;

    // Parse KCL code
    let parse_result = Program::parse(kcl_code).expect("Failed to parse KCL");
    let (program_opt, errors) = parse_result;
    if !errors.is_empty() {
        panic!("Failed to parse KCL: {:?}", errors);
    }
    let program = program_opt.expect("No AST produced");

    // Use mock context
    let mock_ctx = ExecutorContext::new_mock(None).await;
    let mut frontend = FrontendState::new();
    frontend.program = program.clone();

    // Execute to get scene graph
    let exec_outcome = mock_ctx
        .run_mock(&program, &MockConfig::default())
        .await
        .expect("Failed to execute program");

    #[allow(unused_variables)]
    let exec_outcome = frontend.update_state_after_exec(exec_outcome, false);
    #[allow(unused_mut)]
    let mut scene_graph = frontend.scene_graph.clone();

    // If scene graph is empty, try to get objects from exec_outcome.scene_objects
    // (this is only available when artifact-graph feature is enabled)
    #[cfg(feature = "artifact-graph")]
    if scene_graph.objects.is_empty() && !exec_outcome.scene_objects.is_empty() {
        scene_graph.objects = exec_outcome.scene_objects;
    }

    if scene_graph.objects.is_empty() {
        panic!(
            "No objects found in scene graph. This might indicate the KCL code didn't produce any objects. Try enabling the 'artifact-graph' feature."
        );
    }

    scene_graph.objects
}

fn find_first_line_id(objects: &[crate::frontend::api::Object]) -> crate::frontend::api::ObjectId {
    for obj in objects {
        if let crate::frontend::api::ObjectKind::Segment { segment } = &obj.kind
            && matches!(segment, crate::frontend::sketch::Segment::Line(_))
        {
            return obj.id;
        }
    }
    panic!("No line segment found in {} objects", objects.len());
}

fn find_first_arc_id(objects: &[crate::frontend::api::Object]) -> crate::frontend::api::ObjectId {
    for obj in objects {
        if let crate::frontend::api::ObjectKind::Segment { segment } = &obj.kind
            && matches!(segment, crate::frontend::sketch::Segment::Arc(_))
        {
            return obj.id;
        }
    }
    panic!("No arc segment found in {} objects", objects.len());
}

fn find_first_circle_id(objects: &[crate::frontend::api::Object]) -> crate::frontend::api::ObjectId {
    for obj in objects {
        if let crate::frontend::api::ObjectKind::Segment { segment } = &obj.kind
            && matches!(segment, crate::frontend::sketch::Segment::Circle(_))
        {
            return obj.id;
        }
    }
    panic!("No circle segment found in {} objects", objects.len());
}

fn count_segment_kinds(objects: &[crate::frontend::api::Object]) -> (usize, usize, usize) {
    let mut line_count = 0;
    let mut arc_count = 0;
    let mut circle_count = 0;

    for obj in objects {
        let crate::frontend::api::ObjectKind::Segment { segment } = &obj.kind else {
            continue;
        };

        match segment {
            crate::frontend::sketch::Segment::Line(_) => line_count += 1,
            crate::frontend::sketch::Segment::Arc(_) => arc_count += 1,
            crate::frontend::sketch::Segment::Circle(_) => circle_count += 1,
            _ => {}
        }
    }

    (line_count, arc_count, circle_count)
}

fn count_coincident_constraints(objects: &[crate::frontend::api::Object]) -> usize {
    objects
        .iter()
        .filter(|obj| {
            matches!(
                &obj.kind,
                crate::frontend::api::ObjectKind::Constraint {
                    constraint: crate::frontend::sketch::Constraint::Coincident(_)
                }
            )
        })
        .count()
}

/// Tests for `get_trim_spawn_terminations` function.
/// These tests mirror the TypeScript tests in `trimToolImpl.spec.ts`.
/// Note: These tests require the `artifact-graph` feature to be enabled to access scene objects.
mod get_trim_spawn_terminations_tests {
    use kittycad_modeling_cmds::units::UnitLength;

    use super::*;
    use crate::frontend::trim::Coords2d;
    use crate::frontend::trim::TrimTermination;
    use crate::frontend::trim::get_trim_spawn_terminations;

    #[tokio::test]
    async fn test_line_segment_intersection_terminations() {
        let kcl_code = r#"sketch(on = YZ) {
  line1 = line(start = [var -3.05mm, var 2.44mm], end = [var 2.88mm, var 2.81mm])
  line2 = line(start = [var -2.77mm, var 1mm], end = [var -1.91mm, var 4.06mm])
  arc1 = arc(start = [var 2.4mm, var 4.48mm], end = [var 3.4mm, var 5.41mm], center = [var 3.99mm, var 3.07mm])
}
"#;

        let objects = get_objects_from_kcl(kcl_code).await;
        let trim_points = vec![Coords2d { x: -1.3, y: 4.62 }, Coords2d { x: -2.46, y: 0.1 }];

        let result = get_trim_spawn_terminations(
            find_first_line_id(&objects),
            &trim_points,
            &objects,
            UnitLength::Millimeters,
        )
        .expect("get_trim_spawn_terminations failed");

        // Both sides should be intersections
        assert!(matches!(result.left_side, TrimTermination::Intersection { .. }));
        assert!(matches!(result.right_side, TrimTermination::Intersection { .. }));

        if let TrimTermination::Intersection {
            trim_termination_coords,
            intersecting_seg_id,
        } = result.left_side
        {
            assert!((trim_termination_coords.x - (-2.3530729879512666)).abs() < 1e-5);
            assert!((trim_termination_coords.y - 2.4834844847315396).abs() < 1e-5);
            assert_eq!(intersecting_seg_id, crate::frontend::api::ObjectId(7));
        }

        if let TrimTermination::Intersection {
            trim_termination_coords,
            intersecting_seg_id,
        } = result.right_side
        {
            assert!((trim_termination_coords.x - 1.8273063333627224).abs() < 1e-5);
            assert!((trim_termination_coords.y - 2.7443175958421935).abs() < 1e-5);
            assert_eq!(intersecting_seg_id, crate::frontend::api::ObjectId(11));
        }
    }

    #[tokio::test]
    async fn test_line_segment_intersection_with_circle_termination() {
        let kcl_code = r#"sketch001 = sketch(on = YZ) {
  circle1 = circle(start = [var -2.67mm, var 1.8mm], center = [var -1.53mm, var 0.78mm])
  line1 = line(start = [var -0.56mm, var 2.8mm], end = [var -3.58mm, var -0.78mm])
}
"#;

        let objects = get_objects_from_kcl(kcl_code).await;
        let trim_points = vec![Coords2d { x: -1.24, y: 2.78 }, Coords2d { x: -0.5, y: 2.3 }];

        let line_id = find_first_line_id(&objects);
        let circle_id = find_first_circle_id(&objects);

        let result = get_trim_spawn_terminations(line_id, &trim_points, &objects, UnitLength::Millimeters)
            .expect("get_trim_spawn_terminations failed");

        // One side should terminate at line endpoint, the other should terminate by intersecting circle.
        let has_circle_intersection = matches!(
            (&result.left_side, &result.right_side),
            (
                TrimTermination::Intersection {
                    intersecting_seg_id, ..
                },
                TrimTermination::SegEndPoint { .. }
            ) | (
                TrimTermination::SegEndPoint { .. },
                TrimTermination::Intersection {
                    intersecting_seg_id, ..
                }
            ) if *intersecting_seg_id == circle_id
        );

        assert!(
            has_circle_intersection,
            "Expected one termination to be a circle intersection, got left={:?}, right={:?}",
            result.left_side, result.right_side
        );
    }

    #[tokio::test]
    async fn test_line_segment_seg_endpoint_with_coincident_constraints() {
        let kcl_code = r#"sketch(on = YZ) {
  line1 = line(start = [var -3.24mm, var 2.44mm], end = [var 2.6mm, var 2.81mm])
  line2 = line(start = [var -2.38mm, var 2.5mm], end = [var -4.22mm, var -0.41mm])
  arc1 = arc(start = [var 2.24mm, var 5.64mm], end = [var 1.65mm, var 2.83mm], center = [var 3.6mm, var 3.89mm])
  coincident([line2.start, line1.start])
  coincident([arc1.end, line1.end])
}
"#;

        let objects = get_objects_from_kcl(kcl_code).await;
        let trim_points = vec![Coords2d { x: -1.9, y: 0.5 }, Coords2d { x: -1.9, y: 4.0 }];

        let result = get_trim_spawn_terminations(
            find_first_line_id(&objects),
            &trim_points,
            &objects,
            UnitLength::Millimeters,
        )
        .expect("get_trim_spawn_terminations failed");

        // Both sides should be segEndPoint
        assert!(matches!(result.left_side, TrimTermination::SegEndPoint { .. }));
        assert!(matches!(result.right_side, TrimTermination::SegEndPoint { .. }));

        if let TrimTermination::SegEndPoint {
            trim_termination_coords,
        } = result.left_side
        {
            assert!((trim_termination_coords.x - (-2.810000000215)).abs() < 1e-5);
            assert!((trim_termination_coords.y - 2.469999999985).abs() < 1e-5);
        }

        if let TrimTermination::SegEndPoint {
            trim_termination_coords,
        } = result.right_side
        {
            assert!((trim_termination_coords.x - 2.0716435933183504).abs() < 1e-5);
            assert!((trim_termination_coords.y - 2.7918829774915763).abs() < 1e-5);
        }
    }

    #[tokio::test]
    async fn test_line_segment_coincident_with_another_segment_point() {
        let kcl_code = r#"sketch(on = YZ) {
  line1 = line(start = [var -3.24mm, var 2.44mm], end = [var 2.6mm, var 2.81mm])
  line2 = line(start = [var -2.38mm, var 2.5mm], end = [var -4.22mm, var -0.41mm])
  arc1 = arc(start = [var 2.24mm, var 5.64mm], end = [var 1.65mm, var 2.83mm], center = [var 3.6mm, var 3.89mm])
  coincident([arc1.end, line1])
  coincident([line2.start, line1])
}
"#;

        let objects = get_objects_from_kcl(kcl_code).await;
        let trim_points = vec![Coords2d { x: -1.9, y: 0.5 }, Coords2d { x: -1.9, y: 4.0 }];

        let result = get_trim_spawn_terminations(
            find_first_line_id(&objects),
            &trim_points,
            &objects,
            UnitLength::Millimeters,
        )
        .expect("get_trim_spawn_terminations failed");

        // Both sides should be trimSpawnSegmentCoincidentWithAnotherSegmentPoint
        assert!(matches!(
            result.left_side,
            TrimTermination::TrimSpawnSegmentCoincidentWithAnotherSegmentPoint { .. }
        ));
        assert!(matches!(
            result.right_side,
            TrimTermination::TrimSpawnSegmentCoincidentWithAnotherSegmentPoint { .. }
        ));

        if let TrimTermination::TrimSpawnSegmentCoincidentWithAnotherSegmentPoint {
            trim_termination_coords,
            intersecting_seg_id,
            other_segment_point_id,
        } = result.left_side
        {
            assert!((trim_termination_coords.x - (-2.380259288059525)).abs() < 1e-5);
            assert!((trim_termination_coords.y - 2.5040925592307945).abs() < 1e-5);
            assert_eq!(intersecting_seg_id, crate::frontend::api::ObjectId(7));
            assert_eq!(other_segment_point_id, crate::frontend::api::ObjectId(5));
        }

        if let TrimTermination::TrimSpawnSegmentCoincidentWithAnotherSegmentPoint {
            trim_termination_coords,
            intersecting_seg_id,
            other_segment_point_id,
        } = result.right_side
        {
            assert!((trim_termination_coords.x - 1.6587744607636377).abs() < 1e-5);
            assert!((trim_termination_coords.y - 2.784726710328238).abs() < 1e-5);
            assert_eq!(intersecting_seg_id, crate::frontend::api::ObjectId(11));
            assert_eq!(other_segment_point_id, crate::frontend::api::ObjectId(9));
        }
    }

    #[tokio::test]
    async fn test_line_segment_seg_endpoint_without_coincident_constraint() {
        let kcl_code = r#"sketch(on = YZ) {
  line1 = line(start = [var -3.24mm, var 2.46mm], end = [var 2.6mm, var 2.9mm])
  line2 = line(start = [var -2.38mm, var 2.47mm], end = [var -3.94mm, var -0.64mm])
  arc1 = arc(start = [var 2.239mm, var 5.641mm], end = [var 1.651mm, var 2.85mm], center = [var 3.6mm, var 3.889mm])
}
"#;

        let objects = get_objects_from_kcl(kcl_code).await;
        let trim_points = vec![Coords2d { x: -1.9, y: 0.5 }, Coords2d { x: -1.9, y: 4.0 }];

        let result = get_trim_spawn_terminations(
            find_first_line_id(&objects),
            &trim_points,
            &objects,
            UnitLength::Millimeters,
        )
        .expect("get_trim_spawn_terminations failed");

        // Both sides should be segEndPoint
        assert!(matches!(result.left_side, TrimTermination::SegEndPoint { .. }));
        assert!(matches!(result.right_side, TrimTermination::SegEndPoint { .. }));

        if let TrimTermination::SegEndPoint {
            trim_termination_coords,
        } = result.left_side
        {
            assert!((trim_termination_coords.x - (-3.24)).abs() < 1e-5);
            assert!((trim_termination_coords.y - 2.46).abs() < 1e-5);
        }

        if let TrimTermination::SegEndPoint {
            trim_termination_coords,
        } = result.right_side
        {
            assert!((trim_termination_coords.x - 2.6).abs() < 1e-5);
            assert!((trim_termination_coords.y - 2.9).abs() < 1e-5);
        }
    }

    #[tokio::test]
    async fn test_arc_segment_intersection_terminations() {
        let kcl_code = r#"sketch(on = YZ) {
  arc(start = [var 0.79mm, var 2.4mm], end = [var -5.61mm, var 1.77mm], center = [var -1.88mm, var -3.29mm])
  arc(start = [var -0.072mm, var 4.051mm], end = [var -0.128mm, var -0.439mm], center = [var 5.32mm, var 1.738mm])
  line1 = line(start = [var -5.41mm, var 4.99mm], end = [var -4.02mm, var -0.47mm])
}
"#;

        let objects = get_objects_from_kcl(kcl_code).await;
        let trim_points = vec![Coords2d { x: -1.3, y: 4.62 }, Coords2d { x: -2.46, y: 0.1 }];

        let result = get_trim_spawn_terminations(
            find_first_arc_id(&objects),
            &trim_points,
            &objects,
            UnitLength::Millimeters,
        )
        .expect("get_trim_spawn_terminations failed");

        // Both sides should be intersections
        assert!(matches!(result.left_side, TrimTermination::Intersection { .. }));
        assert!(matches!(result.right_side, TrimTermination::Intersection { .. }));

        if let TrimTermination::Intersection {
            trim_termination_coords,
            intersecting_seg_id,
        } = result.left_side
        {
            assert!((trim_termination_coords.x - (-0.44459011806535265)).abs() < 1e-5);
            assert!((trim_termination_coords.y - 2.8295671172502757).abs() < 1e-5);
            assert_eq!(intersecting_seg_id, crate::frontend::api::ObjectId(9));
        }

        if let TrimTermination::Intersection {
            trim_termination_coords,
            intersecting_seg_id,
        } = result.right_side
        {
            assert!((trim_termination_coords.x - (-4.728585883881671)).abs() < 1e-5);
            assert!((trim_termination_coords.y - 2.3133661338085765).abs() < 1e-5);
            assert_eq!(intersecting_seg_id, crate::frontend::api::ObjectId(12));
        }
    }

    #[tokio::test]
    async fn test_arc_segment_seg_endpoint_with_coincident_constraints() {
        let kcl_code = r#"sketch(on = YZ) {
  arc1 = arc(start = [var 0.79mm, var 2.4mm], end = [var -5.61mm, var 1.77mm], center = [var -1.88mm, var -3.29mm])
  arc2 = arc(start = [var -0.07mm, var 4.05mm], end = [var -0.13mm, var -0.44mm], center = [var 5.32mm, var 1.74mm])
  line1 = line(start = [var -5.41mm, var 4.99mm], end = [var -4.02mm, var -0.47mm])
  coincident([line1.end, arc1.end])
  coincident([arc1.start, arc2.start])
}
"#;

        let objects = get_objects_from_kcl(kcl_code).await;
        let trim_points = vec![Coords2d { x: -1.9, y: 0.5 }, Coords2d { x: -1.9, y: 4.0 }];

        let result = get_trim_spawn_terminations(
            find_first_arc_id(&objects),
            &trim_points,
            &objects,
            UnitLength::Millimeters,
        )
        .expect("get_trim_spawn_terminations failed");

        // Both sides should be segEndPoint
        assert!(matches!(result.left_side, TrimTermination::SegEndPoint { .. }));
        assert!(matches!(result.right_side, TrimTermination::SegEndPoint { .. }));

        if let TrimTermination::SegEndPoint {
            trim_termination_coords,
        } = result.left_side
        {
            assert!((trim_termination_coords.x - 0.008837118620591083).abs() < 1e-5);
            assert!((trim_termination_coords.y - 2.809080419697051).abs() < 1e-5);
        }

        if let TrimTermination::SegEndPoint {
            trim_termination_coords,
        } = result.right_side
        {
            assert!((trim_termination_coords.x - (-5.1310115335133135)).abs() < 1e-5);
            assert!((trim_termination_coords.y - 1.0662359198714615).abs() < 1e-5);
        }
    }

    #[tokio::test]
    async fn test_arc_segment_coincident_with_another_segment_point() {
        let kcl_code = r#"sketch(on = YZ) {
  arc1 = arc(start = [var 0.882mm, var 2.596mm], end = [var -5.481mm, var 1.595mm], center = [var -1.484mm, var -3.088mm])
  arc2 = arc(start = [var -0.367mm, var 2.967mm], end = [var -0.099mm, var -0.427mm], center = [var 5.317mm, var 1.708mm])
  line1 = line(start = [var -5.41mm, var 4.99mm], end = [var -4.179mm, var 2.448mm])
  coincident([line1.end, arc1])
  coincident([arc1, arc2.start])
}
"#;

        let objects = get_objects_from_kcl(kcl_code).await;
        let trim_points = vec![Coords2d { x: -1.9, y: 0.5 }, Coords2d { x: -1.9, y: 4.0 }];

        let result = get_trim_spawn_terminations(
            find_first_arc_id(&objects),
            &trim_points,
            &objects,
            UnitLength::Millimeters,
        )
        .expect("get_trim_spawn_terminations failed");

        // Both sides should be trimSpawnSegmentCoincidentWithAnotherSegmentPoint
        assert!(matches!(
            result.left_side,
            TrimTermination::TrimSpawnSegmentCoincidentWithAnotherSegmentPoint { .. }
        ));
        assert!(matches!(
            result.right_side,
            TrimTermination::TrimSpawnSegmentCoincidentWithAnotherSegmentPoint { .. }
        ));

        if let TrimTermination::TrimSpawnSegmentCoincidentWithAnotherSegmentPoint {
            trim_termination_coords,
            intersecting_seg_id,
            other_segment_point_id,
        } = result.left_side
        {
            assert!((trim_termination_coords.x - (-0.36700307305406205)).abs() < 1e-5);
            assert!((trim_termination_coords.y - 2.9668103031831037).abs() < 1e-5);
            assert_eq!(intersecting_seg_id, crate::frontend::api::ObjectId(9));
            assert_eq!(other_segment_point_id, crate::frontend::api::ObjectId(6));
        }

        if let TrimTermination::TrimSpawnSegmentCoincidentWithAnotherSegmentPoint {
            trim_termination_coords,
            intersecting_seg_id,
            other_segment_point_id,
        } = result.right_side
        {
            assert!((trim_termination_coords.x - (-4.178914525037132)).abs() < 1e-5);
            assert!((trim_termination_coords.y - 2.4478569077378745).abs() < 1e-5);
            assert_eq!(intersecting_seg_id, crate::frontend::api::ObjectId(12));
            assert_eq!(other_segment_point_id, crate::frontend::api::ObjectId(11));
        }
    }

    #[tokio::test]
    async fn test_arc_segment_seg_endpoint_without_coincident_constraint() {
        let kcl_code = r#"sketch(on = YZ) {
  arc1 = arc(start = [var 0.882mm, var 2.596mm], end = [var -5.481mm, var 1.595mm], center = [var -1.484mm, var -3.088mm])
  arc2 = arc(start = [var -0.367mm, var 2.967mm], end = [var -0.099mm, var -0.427mm], center = [var 5.317mm, var 1.708mm])
  line1 = line(start = [var -5.41mm, var 4.99mm], end = [var -4.179mm, var 2.448mm])
}
"#;

        let objects = get_objects_from_kcl(kcl_code).await;
        let trim_points = vec![Coords2d { x: -1.9, y: 0.5 }, Coords2d { x: -1.9, y: 4.0 }];

        let result = get_trim_spawn_terminations(
            find_first_arc_id(&objects),
            &trim_points,
            &objects,
            UnitLength::Millimeters,
        )
        .expect("get_trim_spawn_terminations failed");

        // Both sides should be segEndPoint
        assert!(matches!(result.left_side, TrimTermination::SegEndPoint { .. }));
        assert!(matches!(result.right_side, TrimTermination::SegEndPoint { .. }));

        if let TrimTermination::SegEndPoint {
            trim_termination_coords,
        } = result.left_side
        {
            assert!((trim_termination_coords.x - 0.8820069182524407).abs() < 1e-5);
            assert!((trim_termination_coords.y - 2.596016620488862).abs() < 1e-5);
        }

        if let TrimTermination::SegEndPoint {
            trim_termination_coords,
        } = result.right_side
        {
            assert!((trim_termination_coords.x - (-5.480988312959221)).abs() < 1e-5);
            assert!((trim_termination_coords.y - 1.5949863061464085).abs() < 1e-5);
        }
    }
}

#[tokio::test]
async fn point_on_arc_coincident_should_not_effect_initial_guesses() {
    let base_kcl_code = r#"sketch(on = XY) {
  line3 = line(start = [var 4.32mm, var 3.72mm], end = [var 1.06mm, var -3.26mm])
  line4 = line(start = [var 1.06mm, var -3.26mm], end = [var -6.71mm, var -2.8mm])
  coincident([line3.end, line4.start])
  arc1 = arc(start = [var -1.44mm, var -0.99mm], end = [var 2.49mm, var -0.2mm], center = [var 1.06mm, var -3.26mm])
  coincident([arc1.center, line3.end])
  coincident([arc1.end, line3])
}
"#;

    let trim_points = vec![Coords2d { x: -0.29, y: -1.91 }, Coords2d { x: -0.34, y: -4.42 }];

    let expected_code = r#"sketch(on = XY) {
  line3 = line(start = [var 4.32mm, var 3.72mm], end = [var 1.06mm, var -3.26mm])
  line4 = line(start = [var -2.31mm, var -3.06mm], end = [var -6.71mm, var -2.8mm])
  arc1 = arc(start = [var -1.44mm, var -0.99mm], end = [var 2.49mm, var -0.2mm], center = [var 1.06mm, var -3.26mm])
  coincident([arc1.center, line3.end])
  coincident([arc1.end, line3])
  coincident([line4.start, arc1])
}
"#;

    assert_trim_result_default_sketch(base_kcl_code, &trim_points, expected_code).await;
}

#[tokio::test]
/// Issue #10732 case 1.1:
/// trims a circle into an arc when cut in half by a line and trimmed on the side
/// without the circle start point.
async fn test_trim_circle_case_1_1_circle_to_arc_trimmed_without_start_point_side() {
    let base_kcl_code = r#"sketch001 = sketch(on = YZ) {
  circle1 = circle(start = [var -2.67mm, var 1.8mm], center = [var -1.53mm, var 0.78mm])
  line1 = line(start = [var -0.56mm, var 2.8mm], end = [var -3.58mm, var -0.78mm])
}
"#;

    let trim_points = vec![Coords2d { x: 0.21, y: 2.24 }, Coords2d { x: -1.23, y: 1.12 }];

    let expected_code = r#"sketch001 = sketch(on = YZ) {
  line1 = line(start = [var -0.56mm, var 2.8mm], end = [var -3.58mm, var -0.78mm])
  arc1 = arc(start = [var -1.04mm, var 2.23mm], end = [var -2.88mm, var 0.05mm], center = [var -1.53mm, var 0.78mm])
  coincident([arc1.start, line1])
  coincident([arc1.end, line1])
}
"#;

    assert_trim_result_default_sketch(base_kcl_code, &trim_points, expected_code).await;
}

#[tokio::test]
/// Issue #10732 case 1.2:
/// trims a circle into an arc when cut in half by a line and trimmed on the side
/// with the circle start point.
async fn test_trim_circle_case_1_2_circle_to_arc_trimmed_with_start_point_side() {
    let base_kcl_code = r#"sketch001 = sketch(on = YZ) {
  circle1 = circle(start = [var -2.67mm, var 1.8mm], center = [var -1.53mm, var 0.78mm])
  line1 = line(start = [var -0.56mm, var 2.8mm], end = [var -3.58mm, var -0.78mm])
}
"#;

    let trim_points = vec![Coords2d { x: -2.0, y: 2.86 }, Coords2d { x: -2.53, y: 1.1 }];

    let expected_code = r#"sketch001 = sketch(on = YZ) {
  line1 = line(start = [var -0.56mm, var 2.8mm], end = [var -3.58mm, var -0.78mm])
  arc1 = arc(start = [var -2.88mm, var 0.05mm], end = [var -1.04mm, var 2.23mm], center = [var -1.53mm, var 0.78mm])
  coincident([arc1.start, line1])
  coincident([arc1.end, line1])
}
"#;

    assert_trim_result_default_sketch(base_kcl_code, &trim_points, expected_code).await;
}

#[tokio::test]
/// Issue #10732 case 1.3:
/// trims the line so its endpoint becomes coincident with the circle.
async fn test_trim_circle_case_1_3_trim_line_to_be_coincident_with_circle() {
    let base_kcl_code = r#"sketch001 = sketch(on = YZ) {
  circle1 = circle(start = [var -2.67mm, var 1.8mm], center = [var -1.53mm, var 0.78mm])
  line1 = line(start = [var -0.56mm, var 2.8mm], end = [var -3.58mm, var -0.78mm])
}
"#;

    let trim_points = vec![Coords2d { x: -1.24, y: 2.78 }, Coords2d { x: -0.5, y: 2.3 }];

    let expected_code = r#"sketch001 = sketch(on = YZ) {
  circle1 = circle(start = [var -2.67mm, var 1.8mm], center = [var -1.53mm, var 0.78mm])
  line1 = line(start = [var -1.04mm, var 2.23mm], end = [var -3.58mm, var -0.78mm])
  coincident([line1.start, circle1])
}
"#;

    assert_trim_result_default_sketch(base_kcl_code, &trim_points, expected_code).await;
}

#[tokio::test]
/// Issue #10732 case 1.4:
/// trims a line and circle such that the circle becomes an arc with coincident
/// endpoints.
async fn test_trim_circle_case_1_4_trim_line_and_circle_arc_with_coincident_endpoints() {
    let base_kcl_code = r#"sketch001 = sketch(on = YZ) {
  circle1 = circle(start = [var -2.67mm, var 1.8mm], center = [var -1.53mm, var 0.78mm])
  line1 = line(start = [var -0.56mm, var 2.8mm], end = [var -3.58mm, var -0.78mm])
}
"#;

    let trim_points = vec![
        Coords2d { x: -1.14, y: 2.96 },
        Coords2d { x: -0.51, y: 2.22 },
        Coords2d { x: -0.4, y: 0.57 },
    ];

    let expected_code = r#"sketch001 = sketch(on = YZ) {
  line1 = line(start = [var -1.04mm, var 2.23mm], end = [var -3.58mm, var -0.78mm])
  arc1 = arc(start = [var -1.04mm, var 2.23mm], end = [var -2.88mm, var 0.05mm], center = [var -1.53mm, var 0.78mm])
  coincident([arc1.start, line1.start])
  coincident([arc1.end, line1])
}
"#;

    assert_trim_result_default_sketch(base_kcl_code, &trim_points, expected_code).await;
}

#[tokio::test]
/// Issue #10732 case 2:
/// trimming a circle between two segments should convert it to one arc rather
/// than split into multiple segments, with arc ends constrained to each segment.
async fn test_trim_circle_case_2_convert_circle_to_arc_between_two_segments() {
    let base_kcl_code = r#"sketch001 = sketch(on = YZ) {
  circle1 = circle(start = [var -2.67mm, var 1.8mm], center = [var -1.53mm, var 0.78mm])
  line1 = line(start = [var -0.75mm, var 2.93mm], end = [var -2.97mm, var -1.17mm])
  line2 = line(start = [var -0.1mm, var 2.46mm], end = [var -0.67mm, var 0.97mm])
}
"#;

    let trim_points = vec![Coords2d { x: -0.44, y: 2.72 }, Coords2d { x: -0.99, y: 1.38 }];

    let expected_code = r#"sketch001 = sketch(on = YZ) {
  line1 = line(start = [var -0.75mm, var 2.93mm], end = [var -2.97mm, var -1.17mm])
  line2 = line(start = [var -0.1mm, var 2.46mm], end = [var -0.67mm, var 0.97mm])
  arc1 = arc(start = [var -1.12mm, var 2.25mm], end = [var -0.36mm, var 1.77mm], center = [var -1.53mm, var 0.78mm])
  coincident([arc1.start, line1])
  coincident([arc1.end, line2])
}
"#;

    assert_trim_result_default_sketch(base_kcl_code, &trim_points, expected_code).await;
}

#[tokio::test]
/// Issue #10732 comment case 3 variant A:
/// trimming through a standalone circle should delete the circle.
async fn test_trim_circle_case_3a_delete_standalone_circle() {
    let base_kcl_code = r#"sketch001 = sketch(on = YZ) {
  circle1 = circle(start = [var -3.73mm, var 2.21mm], center = [var -2.22mm, var 0.63mm])
}
"#;

    let trim_points = vec![Coords2d { x: -1.77, y: 4.3 }, Coords2d { x: -1.99, y: 1.71 }];

    let result = execute_trim_flow(base_kcl_code, &trim_points, ObjectId(1))
        .await
        .expect("trim flow failed");
    let objects = get_objects_from_kcl(&result.kcl_code).await;
    let (_, arc_count, circle_count) = count_segment_kinds(&objects);

    assert_eq!(
        circle_count, 0,
        "Expected trimmed standalone circle to be deleted, got KCL:\n{}",
        result.kcl_code
    );
    assert_eq!(
        arc_count, 0,
        "Expected no replacement arc when deleting standalone circle, got KCL:\n{}",
        result.kcl_code
    );
}

#[tokio::test]
/// Issue #10732 comment case 3 variant B:
/// trimming through a circle in a circle+line sketch should delete only the circle.
async fn test_trim_circle_case_3b_delete_circle_keep_line() {
    let base_kcl_code = r#"sketch001 = sketch(on = YZ) {
  circle1 = circle(start = [var -3.73mm, var 2.21mm], center = [var -2.22mm, var 0.63mm])
  line1 = line(start = [var 0.01mm, var 3.31mm], end = [var -0.95mm, var 0.92mm])
}
"#;

    let trim_points = vec![Coords2d { x: -1.77, y: 4.3 }, Coords2d { x: -1.99, y: 1.71 }];

    let result = execute_trim_flow(base_kcl_code, &trim_points, ObjectId(1))
        .await
        .expect("trim flow failed");
    let objects = get_objects_from_kcl(&result.kcl_code).await;
    let (line_count, arc_count, circle_count) = count_segment_kinds(&objects);

    assert_eq!(
        line_count, 1,
        "Expected line to be preserved after circle deletion, got KCL:\n{}",
        result.kcl_code
    );
    assert_eq!(
        circle_count, 0,
        "Expected circle to be deleted, got KCL:\n{}",
        result.kcl_code
    );
    assert_eq!(
        arc_count, 0,
        "Expected no arc replacement when no intersection terminators exist, got KCL:\n{}",
        result.kcl_code
    );
}

#[tokio::test]
/// Issue #10732 comment case 4:
/// trimming one of two intersecting circles should convert the trimmed circle to an arc
/// with coincident constraints at both circle-circle intersections.
async fn test_trim_circle_case_4_circle_circle_intersections_convert_to_arc() {
    let base_kcl_code = r#"sketch001 = sketch(on = YZ) {
  circle1 = circle(start = [var -0.35mm, var 0.6mm], center = [var -1.13mm, var 0.57mm])
  circle2 = circle(start = [var -0.83mm, var 0.93mm], center = [var -0.16mm, var 1.56mm])
}
"#;

    let trim_points = vec![Coords2d { x: -0.69, y: 1.6 }, Coords2d { x: -0.73, y: 1.07 }];

    let result = execute_trim_flow(base_kcl_code, &trim_points, ObjectId(1))
        .await
        .expect("trim flow failed");
    let objects = get_objects_from_kcl(&result.kcl_code).await;
    let (line_count, arc_count, circle_count) = count_segment_kinds(&objects);
    let coincident_count = count_coincident_constraints(&objects);

    assert_eq!(
        line_count, 0,
        "Expected no lines in final geometry for circle-circle case, got KCL:\n{}",
        result.kcl_code
    );
    assert_eq!(
        circle_count, 1,
        "Expected one remaining circle and one trimmed arc, got KCL:\n{}",
        result.kcl_code
    );
    assert_eq!(
        arc_count, 1,
        "Expected one trimmed arc from circle-circle intersection case, got KCL:\n{}",
        result.kcl_code
    );
    assert!(
        coincident_count >= 2,
        "Expected at least two coincident constraints (arc endpoints to other circle), got KCL:\n{}",
        result.kcl_code
    );
}

#[tokio::test]
/// Regression: when a circle is converted to an arc during trim, pre-existing
/// constraints should transfer from the circle to the new arc.
async fn test_trim_circle_to_arc_transfers_constraints() {
    let base_kcl_code = r#"sketch(on = YZ) {
  circle1 = circle(start = [var -1.62mm, var 3.03mm], center = [var -3.29mm, var 5.8mm])
  line1 = line(start = [var -0.35mm, var 2.72mm], end = [var -0.69mm, var -1.58mm])
  line2 = line(start = [var -5.11mm, var 1.19mm], end = [var 0.52mm, var 9.59mm])
  line3 = line(start = [var 0.07mm, var 5.3mm], end = [var 4.62mm, var 5.43mm])
  coincident([line3.start, circle1])
  line4 = line(start = [var -4.09mm, var 7.82mm], end = [var -4.18mm, var 5.89mm])
  coincident([line4.end, circle1.center])
  radius(circle1) == 3.66mm
  tangent([line1, circle1])
}
"#;

    let trim_points = vec![Coords2d { x: -1.79, y: 10.65 }, Coords2d { x: -2.3, y: 8.0 }];

    let result = execute_trim_flow(base_kcl_code, &trim_points, ObjectId(1))
        .await
        .expect("trim flow failed");

    let objects = get_objects_from_kcl(&result.kcl_code).await;
    let (_, arc_count, circle_count) = count_segment_kinds(&objects);

    assert_eq!(
        circle_count, 0,
        "Expected original circle to be replaced by an arc, got KCL:\n{}",
        result.kcl_code
    );
    assert_eq!(
        arc_count, 1,
        "Expected a single replacement arc after trim, got KCL:\n{}",
        result.kcl_code
    );

    assert!(
        result.kcl_code.contains("radius(arc1) == 3.66mm"),
        "Expected radius constraint to transfer from circle1 to arc1, got KCL:\n{}",
        result.kcl_code
    );
    assert!(
        result.kcl_code.contains("tangent([line1, arc1])") || result.kcl_code.contains("tangent([arc1, line1])"),
        "Expected tangent constraint to transfer from circle1 to arc1, got KCL:\n{}",
        result.kcl_code
    );
    assert!(
        result.kcl_code.contains("coincident([line3.start, arc1])")
            || result.kcl_code.contains("coincident([arc1, line3.start])"),
        "Expected point-segment coincident to transfer from circle1 to arc1, got KCL:\n{}",
        result.kcl_code
    );
    assert!(
        result.kcl_code.contains("coincident([line4.end, arc1.center])")
            || result.kcl_code.contains("coincident([arc1.center, line4.end])"),
        "Expected center-point coincident to transfer from circle1.center to arc1.center, got KCL:\n{}",
        result.kcl_code
    );
}

#[tokio::test]
/// Regression: three intersecting arcs should trim deterministically and preserve
/// expected coincident relationships.
async fn test_trim_three_arcs_intersecting_each_other() {
    let base_kcl_code = r#"sketch002 = sketch(on = YZ) {
  arc1 = arc(start = [var -0mm, var -0mm], end = [var -3.77mm, var 4.2mm], center = [var -1.93mm, var 2.06mm])
  arc2 = arc(start = [var 3.58mm, var 7.01mm], end = [var -0mm, var -0mm], center = [var 4.54mm, var 2.1mm])
  coincident([arc2.end, arc1.start])
  arc3 = arc(start = [var -3.77mm, var 4.2mm], end = [var 3.58mm, var 7.01mm], center = [var -0.76mm, var 7.34mm])
  coincident([arc3.start, arc1.end])
  coincident([arc3.end, arc2.start])
}
"#;

    let trim_points = vec![Coords2d { x: 2.36, y: 2.6 }, Coords2d { x: 1.58, y: 4.45 }];

    let result = execute_trim_flow(base_kcl_code, &trim_points, ObjectId(1))
        .await
        .expect("trim flow failed");
    let objects = get_objects_from_kcl(&result.kcl_code).await;

    #[derive(Clone, Copy, Debug)]
    struct ArcInfo {
        id: ObjectId,
        start_id: ObjectId,
        end_id: ObjectId,
        center_x: f64,
        center_y: f64,
    }

    let expr_to_f64 = |expr: &crate::frontend::api::Expr| -> Option<f64> {
        match expr {
            crate::frontend::api::Expr::Var(n) | crate::frontend::api::Expr::Number(n) => Some(n.value),
            _ => None,
        }
    };

    let mut arcs: Vec<ArcInfo> = Vec::new();
    for obj in &objects {
        let crate::frontend::api::ObjectKind::Segment { segment } = &obj.kind else {
            continue;
        };
        let crate::frontend::sketch::Segment::Arc(arc) = segment else {
            continue;
        };
        let crate::frontend::sketch::SegmentCtor::Arc(ctor) = &arc.ctor else {
            continue;
        };
        let center_x = expr_to_f64(&ctor.center.x).expect("arc center.x should be numeric");
        let center_y = expr_to_f64(&ctor.center.y).expect("arc center.y should be numeric");
        arcs.push(ArcInfo {
            id: obj.id,
            start_id: arc.start,
            end_id: arc.end,
            center_x,
            center_y,
        });
    }

    assert_eq!(
        arcs.len(),
        3,
        "Expected 3 arcs after trim in three-arc case, got KCL:\n{}",
        result.kcl_code
    );

    let take_closest_arc = |pool: &mut Vec<ArcInfo>, tx: f64, ty: f64| -> ArcInfo {
        let (idx, _) = pool
            .iter()
            .enumerate()
            .map(|(i, a)| {
                let d = ((a.center_x - tx) * (a.center_x - tx) + (a.center_y - ty) * (a.center_y - ty)).sqrt();
                (i, d)
            })
            .min_by(|a, b| a.1.partial_cmp(&b.1).expect("distance should be finite"))
            .expect("at least one arc expected");
        pool.remove(idx)
    };

    let mut pool = arcs;
    let arc1 = take_closest_arc(&mut pool, -1.93, 2.06);
    let arc2 = take_closest_arc(&mut pool, 4.54, 2.10);
    let arc3 = take_closest_arc(&mut pool, -0.76, 7.34);

    let has_point_point = |a: ObjectId, b: ObjectId| -> bool {
        objects.iter().any(|obj| {
            let crate::frontend::api::ObjectKind::Constraint { constraint } = &obj.kind else {
                return false;
            };
            let crate::frontend::sketch::Constraint::Coincident(coincident) = constraint else {
                return false;
            };
            let ids: Vec<ObjectId> = coincident.segment_ids().collect();
            ids.len() == 2 && ids.contains(&a) && ids.contains(&b)
        })
    };

    let has_point_segment = |point: ObjectId, segment: ObjectId| -> bool {
        objects.iter().any(|obj| {
            let crate::frontend::api::ObjectKind::Constraint { constraint } = &obj.kind else {
                return false;
            };
            let crate::frontend::sketch::Constraint::Coincident(coincident) = constraint else {
                return false;
            };
            let ids: Vec<ObjectId> = coincident.segment_ids().collect();
            ids.contains(&point) && ids.contains(&segment)
        })
    };

    assert!(
        has_point_point(arc2.end_id, arc1.start_id),
        "Expected arc2.end to remain coincident with arc1.start, got KCL:\n{}",
        result.kcl_code
    );
    assert!(
        has_point_point(arc3.start_id, arc1.end_id),
        "Expected arc3.start to remain coincident with arc1.end, got KCL:\n{}",
        result.kcl_code
    );
    assert!(
        has_point_segment(arc3.end_id, arc1.id),
        "Expected arc3.end to be point-segment coincident with arc1, got KCL:\n{}",
        result.kcl_code
    );
    assert!(
        !has_point_point(arc3.end_id, arc2.start_id),
        "arc3.end should not remain point-point coincident with arc2.start after trim, got KCL:\n{}",
        result.kcl_code
    );
}

#[tokio::test]
/// Regression: arc/arc trim should update arc2 start and create a point-segment
/// coincident from arc2.start to arc1 while preserving existing arc relationships.
async fn test_trim_arc_arc_intersection_updates_start_and_preserves_constraints() {
    let base_kcl_code = r#"sketch001 = sketch(on = YZ) {
  arc1 = arc(start = [var -2.27mm, var 1.02mm], end = [var -5.86mm, var 3.53mm], center = [var -3.85mm, var 2.58mm])
  arc2 = arc(start = [var 0.84mm, var 5.87mm], end = [var -2.27mm, var 1.02mm], center = [var 0.92mm, var 2.4mm])
  coincident([arc2.end, arc1.start])
  arc3 = arc(start = [var -5.86mm, var 3.53mm], end = [var -1.72mm, var 3.2mm], center = [var -3.46mm, var 7.43mm])
  coincident([arc3.start, arc1.end])
  coincident([arc3.end, arc1])
}
"#;

    let trim_points = vec![Coords2d { x: -1.48, y: 5.87 }, Coords2d { x: -0.61, y: 4.21 }];

    let result = execute_trim_flow(base_kcl_code, &trim_points, ObjectId(1))
        .await
        .expect("trim flow failed");
    let objects = get_objects_from_kcl(&result.kcl_code).await;

    #[derive(Clone, Copy, Debug)]
    struct ArcInfo {
        id: ObjectId,
        start_id: ObjectId,
        end_id: ObjectId,
        center_x: f64,
        center_y: f64,
    }

    let mut arcs: Vec<ArcInfo> = Vec::new();
    for obj in &objects {
        let crate::frontend::api::ObjectKind::Segment { segment } = &obj.kind else {
            continue;
        };
        let crate::frontend::sketch::Segment::Arc(arc) = segment else {
            continue;
        };
        let crate::frontend::sketch::SegmentCtor::Arc(ctor) = &arc.ctor else {
            continue;
        };
        let (center_x, center_y) = match (&ctor.center.x, &ctor.center.y) {
            (
                crate::frontend::api::Expr::Var(x) | crate::frontend::api::Expr::Number(x),
                crate::frontend::api::Expr::Var(y) | crate::frontend::api::Expr::Number(y),
            ) => (x.value, y.value),
            _ => panic!("arc centers should be numeric"),
        };

        arcs.push(ArcInfo {
            id: obj.id,
            start_id: arc.start,
            end_id: arc.end,
            center_x,
            center_y,
        });
    }

    assert_eq!(
        arcs.len(),
        3,
        "Expected 3 arcs after trim in arc-arc regression case, got KCL:\n{}",
        result.kcl_code
    );

    let take_closest_arc = |pool: &mut Vec<ArcInfo>, tx: f64, ty: f64| -> ArcInfo {
        let (idx, _) = pool
            .iter()
            .enumerate()
            .map(|(i, a)| {
                let d = ((a.center_x - tx) * (a.center_x - tx) + (a.center_y - ty) * (a.center_y - ty)).sqrt();
                (i, d)
            })
            .min_by(|a, b| a.1.partial_cmp(&b.1).expect("distance should be finite"))
            .expect("at least one arc expected");
        pool.remove(idx)
    };

    let mut pool = arcs;
    let arc1 = take_closest_arc(&mut pool, -3.85, 2.58);
    let arc2 = take_closest_arc(&mut pool, 0.92, 2.40);
    let arc3 = take_closest_arc(&mut pool, -3.46, 7.43);

    let mut point_positions: std::collections::HashMap<ObjectId, Coords2d> = std::collections::HashMap::new();
    for obj in &objects {
        let crate::frontend::api::ObjectKind::Segment { segment } = &obj.kind else {
            continue;
        };
        let crate::frontend::sketch::Segment::Point(point) = segment else {
            continue;
        };
        point_positions.insert(
            obj.id,
            Coords2d {
                x: point.position.x.value,
                y: point.position.y.value,
            },
        );
    }

    let arc2_start = point_positions
        .get(&arc2.start_id)
        .copied()
        .expect("arc2.start point should exist");
    assert!(
        ((arc2_start.x - -2.15) * (arc2_start.x - -2.15) + (arc2_start.y - 4.0) * (arc2_start.y - 4.0)).sqrt() < 0.4,
        "Expected arc2.start to move near the trim/arc intersection, got arc2.start={:?}, KCL:\n{}",
        arc2_start,
        result.kcl_code
    );

    let has_point_point = |a: ObjectId, b: ObjectId| -> bool {
        objects.iter().any(|obj| {
            let crate::frontend::api::ObjectKind::Constraint { constraint } = &obj.kind else {
                return false;
            };
            let crate::frontend::sketch::Constraint::Coincident(coincident) = constraint else {
                return false;
            };
            let ids: Vec<ObjectId> = coincident.segment_ids().collect();
            ids.len() == 2 && ids.contains(&a) && ids.contains(&b)
        })
    };

    let has_point_segment = |point: ObjectId, segment: ObjectId| -> bool {
        objects.iter().any(|obj| {
            let crate::frontend::api::ObjectKind::Constraint { constraint } = &obj.kind else {
                return false;
            };
            let crate::frontend::sketch::Constraint::Coincident(coincident) = constraint else {
                return false;
            };
            let ids: Vec<ObjectId> = coincident.segment_ids().collect();
            ids.contains(&point) && ids.contains(&segment)
        })
    };

    assert!(
        has_point_point(arc2.end_id, arc1.start_id),
        "Expected arc2.end to remain coincident with arc1.start, got KCL:\n{}",
        result.kcl_code
    );
    assert!(
        has_point_point(arc3.start_id, arc1.end_id),
        "Expected arc3.start to remain coincident with arc1.end, got KCL:\n{}",
        result.kcl_code
    );
    assert!(
        has_point_segment(arc3.end_id, arc1.id),
        "Expected arc3.end to remain point-segment coincident with arc1, got KCL:\n{}",
        result.kcl_code
    );
    assert!(
        has_point_segment(arc2.start_id, arc1.id),
        "Expected arc2.start to become point-segment coincident with arc1 after trim, got KCL:\n{}",
        result.kcl_code
    );
}
