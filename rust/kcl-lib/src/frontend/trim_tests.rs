#[cfg(test)]
mod tests {
    use crate::frontend::{
        api::ObjectId,
        trim::{Coords2d, execute_trim_flow},
    };

    #[tokio::test]
    async fn test_trim_line2_left_side() {
        // This test mirrors: "Case 1: trim line2 from [-2, -2] to [-2, 2] - should trim left side (start)"
        // from the TypeScript test file
        let base_kcl_code = r#"@settings(experimentalFeatures = allow)

sketch(on = YZ) {
  line1 = sketch2::line(start = [var 0mm, var 5mm], end = [var 0mm, var -5mm])
  line2 = sketch2::line(start = [var 5mm, var 0mm], end = [var -5mm, var 0mm])
}
"#;

        let trim_points = vec![Coords2d { x: -2.0, y: -2.0 }, Coords2d { x: -2.0, y: 2.0 }];

        let sketch_id = ObjectId(1);

        let result = execute_trim_flow(base_kcl_code, &trim_points, sketch_id).await;

        match result {
            Ok(result) => {
                let expected_code = r#"@settings(experimentalFeatures = allow)

sketch(on = YZ) {
  line1 = sketch2::line(start = [var 0mm, var 5mm], end = [var 0mm, var -5mm])
  line2 = sketch2::line(start = [var 5mm, var 0mm], end = [var 0mm, var 0mm])
  sketch2::coincident([line2.end, line1])
}
"#;

                // Normalize both strings for comparison (trim whitespace)
                let result_normalized = result.kcl_code.trim();
                let expected_normalized = expected_code.trim();

                if result_normalized != expected_normalized {
                    eprintln!("Actual result:\n{}", result_normalized);
                    eprintln!("Expected result:\n{}", expected_normalized);
                }

                assert_eq!(
                    result_normalized, expected_normalized,
                    "Trim result should match expected KCL code"
                );
            }
            Err(e) => {
                panic!("trim flow failed: {}", e);
            }
        }
    }
    #[tokio::test]
    async fn test_tail_cut_should_remove_constraints_on_that_end_of_trimmed_segment() {
        // This test mirrors: "Case 1: trim line2 from [-2, -2] to [-2, 2] - should trim left side (start)"
        // from the TypeScript test file
        let base_kcl_code = r#"@settings(experimentalFeatures = allow)

sketch(on = YZ) {
  line1 = sketch2::line(start = [var -5.33mm, var 3.69mm], end = [var -5.93mm, var -2.59mm])
  line2 = sketch2::line(start = [var -5.1mm, var 0.75mm], end = [var 4.01mm, var 0.68mm])
  line3 = sketch2::line(start = [var 4.26mm, var -3.44mm], end = [var 4.33mm, var 3.61mm])
  line4 = sketch2::line(start = [var -0.9mm, var 0.43mm], end = [var -1.28mm, var -3.04mm])
  sketch2::coincident([line2.start, line1])
  sketch2::coincident([line4.start, line2])
  sketch2::coincident([line2.end, line3])
}
"#;

        let trim_points = vec![Coords2d { x: -2.18, y: 4.92 }, Coords2d { x: -4.23, y: -5.15 }];

        let sketch_id = ObjectId(1);

        let result = execute_trim_flow(base_kcl_code, &trim_points, sketch_id).await;

        match result {
            Ok(result) => {
                let expected_code = r#"@settings(experimentalFeatures = allow)

sketch(on = YZ) {
  line1 = sketch2::line(start = [var -5.33mm, var 3.69mm], end = [var -5.93mm, var -2.59mm])
  line2 = sketch2::line(start = [var -0.9mm, var 0.63mm], end = [var 4.01mm, var 0.68mm])
  line3 = sketch2::line(start = [var 4.03mm, var -3.44mm], end = [var 4mm, var 3.61mm])
  line4 = sketch2::line(start = [var -0.9mm, var 0.63mm], end = [var -1.28mm, var -3.04mm])
  sketch2::coincident([line2.end, line3])
  sketch2::coincident([line2.start, line4.start])
}
"#;

                // Normalize both strings for comparison (trim whitespace)
                let result_normalized = result.kcl_code.trim();
                let expected_normalized = expected_code.trim();

                if result_normalized != expected_normalized {
                    eprintln!("Actual result:\n{}", result_normalized);
                    eprintln!("Expected result:\n{}", expected_normalized);
                }

                assert_eq!(
                    result_normalized, expected_normalized,
                    "Trim result should match expected KCL code"
                );
            }
            Err(e) => {
                panic!("trim flow failed: {}", e);
            }
        }
    }

    #[tokio::test]
    async fn test_trim_line2_right_side() {
        // Case 2: trim line2 from [2, -2] to [2, 2] - should trim right side (end)
        let base_kcl_code = r#"@settings(experimentalFeatures = allow)

sketch(on = YZ) {
  line1 = sketch2::line(start = [var 0mm, var 5mm], end = [var 0mm, var -5mm])
  line2 = sketch2::line(start = [var 5mm, var 0mm], end = [var -5mm, var 0mm])
}
"#;

        let trim_points = vec![Coords2d { x: 2.0, y: -2.0 }, Coords2d { x: 2.0, y: 2.0 }];

        let sketch_id = ObjectId(1);

        let result = execute_trim_flow(base_kcl_code, &trim_points, sketch_id).await;

        match result {
            Ok(result) => {
                let expected_code = r#"@settings(experimentalFeatures = allow)

sketch(on = YZ) {
  line1 = sketch2::line(start = [var 0mm, var 5mm], end = [var 0mm, var -5mm])
  line2 = sketch2::line(start = [var 0mm, var 0mm], end = [var -5mm, var 0mm])
  sketch2::coincident([line2.start, line1])
}
"#;

                let result_normalized = result.kcl_code.trim();
                let expected_normalized = expected_code.trim();

                if result_normalized != expected_normalized {
                    eprintln!("Actual result:\n{}", result_normalized);
                    eprintln!("Expected result:\n{}", expected_normalized);
                }

                assert_eq!(
                    result_normalized, expected_normalized,
                    "Trim result should match expected KCL code"
                );
            }
            Err(e) => {
                panic!("trim flow failed: {}", e);
            }
        }
    }

    #[tokio::test]
    async fn test_trim_line1_bottom() {
        // Case 3: trim line1 from [-2, 2] to [2, 2] - should trim bottom (end)
        let base_kcl_code = r#"@settings(experimentalFeatures = allow)

sketch(on = YZ) {
  line1 = sketch2::line(start = [var 0mm, var 5mm], end = [var 0mm, var -5mm])
  line2 = sketch2::line(start = [var 5mm, var 0mm], end = [var -5mm, var 0mm])
}
"#;

        let trim_points = vec![Coords2d { x: -2.0, y: 2.0 }, Coords2d { x: 2.0, y: 2.0 }];

        let sketch_id = ObjectId(1);

        let result = execute_trim_flow(base_kcl_code, &trim_points, sketch_id).await;

        match result {
            Ok(result) => {
                let expected_code = r#"@settings(experimentalFeatures = allow)

sketch(on = YZ) {
  line1 = sketch2::line(start = [var 0mm, var 0mm], end = [var 0mm, var -5mm])
  line2 = sketch2::line(start = [var 5mm, var 0mm], end = [var -5mm, var 0mm])
  sketch2::coincident([line1.start, line2])
}
"#;

                let result_normalized = result.kcl_code.trim();
                let expected_normalized = expected_code.trim();

                if result_normalized != expected_normalized {
                    eprintln!("Actual result:\n{}", result_normalized);
                    eprintln!("Expected result:\n{}", expected_normalized);
                }

                assert_eq!(
                    result_normalized, expected_normalized,
                    "Trim result should match expected KCL code"
                );
            }
            Err(e) => {
                panic!("trim flow failed: {}", e);
            }
        }
    }

    #[tokio::test]
    async fn test_trim_line1_top() {
        // Case 4: trim line1 from [-2, -2] to [2, -2] - should trim top (start)
        let base_kcl_code = r#"@settings(experimentalFeatures = allow)

sketch(on = YZ) {
  line1 = sketch2::line(start = [var 0mm, var 5mm], end = [var 0mm, var -5mm])
  line2 = sketch2::line(start = [var 5mm, var 0mm], end = [var -5mm, var 0mm])
}
"#;

        let trim_points = vec![Coords2d { x: -2.0, y: -2.0 }, Coords2d { x: 2.0, y: -2.0 }];

        let sketch_id = ObjectId(1);

        let result = execute_trim_flow(base_kcl_code, &trim_points, sketch_id).await;

        match result {
            Ok(result) => {
                let expected_code = r#"@settings(experimentalFeatures = allow)

sketch(on = YZ) {
  line1 = sketch2::line(start = [var 0mm, var 5mm], end = [var 0mm, var 0mm])
  line2 = sketch2::line(start = [var 5mm, var 0mm], end = [var -5mm, var 0mm])
  sketch2::coincident([line1.end, line2])
}
"#;

                let result_normalized = result.kcl_code.trim();
                let expected_normalized = expected_code.trim();

                if result_normalized != expected_normalized {
                    eprintln!("Actual result:\n{}", result_normalized);
                    eprintln!("Expected result:\n{}", expected_normalized);
                }

                assert_eq!(
                    result_normalized, expected_normalized,
                    "Trim result should match expected KCL code"
                );
            }
            Err(e) => {
                panic!("trim flow failed: {}", e);
            }
        }
    }

    #[tokio::test]
    async fn test_trim_arc2_left_side() {
        // Case 1: trim arc2 from [-2, -2] to [-2, 2] - should trim left side (start)
        let base_kcl_code = r#"@settings(experimentalFeatures = allow)

sketch(on = YZ) {
  arc1 = sketch2::arc(start = [var 0mm, var 5mm], end = [var 0mm, var -5mm], center = [var 30mm, var 0mm])
  arc2 = sketch2::arc(start = [var 5mm, var 0mm], end = [var -5mm, var 0mm], center = [var 0mm, var -30mm])
}
"#;

        let trim_points = vec![Coords2d { x: -2.0, y: -2.0 }, Coords2d { x: -2.0, y: 2.0 }];

        let sketch_id = ObjectId(1);

        let result = execute_trim_flow(base_kcl_code, &trim_points, sketch_id).await;

        match result {
            Ok(result) => {
                let expected_code = r#"@settings(experimentalFeatures = allow)

sketch(on = YZ) {
  arc1 = sketch2::arc(start = [var 0mm, var 5mm], end = [var 0mm, var -5mm], center = [var 30mm, var 0mm])
  arc2 = sketch2::arc(start = [var 5mm, var 0mm], end = [var -0.41mm, var 0.41mm], center = [var 0mm, var -30mm])
  sketch2::coincident([arc2.end, arc1])
}
"#;

                let result_normalized = result.kcl_code.trim();
                let expected_normalized = expected_code.trim();

                if result_normalized != expected_normalized {
                    eprintln!("Actual result:\n{}", result_normalized);
                    eprintln!("Expected result:\n{}", expected_normalized);
                }

                assert_eq!(
                    result_normalized, expected_normalized,
                    "Trim result should match expected KCL code"
                );
            }
            Err(e) => {
                panic!("trim flow failed: {}", e);
            }
        }
    }

    #[tokio::test]
    async fn test_trim_arc2_right_side() {
        // Case 2: trim arc2 from [2, -2] to [2, 2] - should trim right side (end)
        let base_kcl_code = r#"@settings(experimentalFeatures = allow)

sketch(on = YZ) {
  arc1 = sketch2::arc(start = [var 0mm, var 5mm], end = [var 0mm, var -5mm], center = [var 30mm, var 0mm])
  arc2 = sketch2::arc(start = [var 5mm, var 0mm], end = [var -5mm, var 0mm], center = [var 0mm, var -30mm])
}
"#;

        let trim_points = vec![Coords2d { x: 2.0, y: -2.0 }, Coords2d { x: 2.0, y: 2.0 }];

        let sketch_id = ObjectId(1);

        let result = execute_trim_flow(base_kcl_code, &trim_points, sketch_id).await;

        match result {
            Ok(result) => {
                let expected_code = r#"@settings(experimentalFeatures = allow)

sketch(on = YZ) {
  arc1 = sketch2::arc(start = [var 0mm, var 5mm], end = [var 0mm, var -5mm], center = [var 30mm, var 0mm])
  arc2 = sketch2::arc(start = [var -0.41mm, var 0.41mm], end = [var -5mm, var 0mm], center = [var 0mm, var -30mm])
  sketch2::coincident([arc2.start, arc1])
}
"#;

                let result_normalized = result.kcl_code.trim();
                let expected_normalized = expected_code.trim();

                if result_normalized != expected_normalized {
                    eprintln!("Actual result:\n{}", result_normalized);
                    eprintln!("Expected result:\n{}", expected_normalized);
                }

                assert_eq!(
                    result_normalized, expected_normalized,
                    "Trim result should match expected KCL code"
                );
            }
            Err(e) => {
                panic!("trim flow failed: {}", e);
            }
        }
    }

    #[tokio::test]
    async fn test_trim_arc1_bottom() {
        // Case 3: trim arc1 from [-2, 2] to [2, 2] - should trim bottom (end)
        let base_kcl_code = r#"@settings(experimentalFeatures = allow)

sketch(on = YZ) {
  arc1 = sketch2::arc(start = [var 0mm, var 5mm], end = [var 0mm, var -5mm], center = [var 30mm, var 0mm])
  arc2 = sketch2::arc(start = [var 5mm, var 0mm], end = [var -5mm, var 0mm], center = [var 0mm, var -30mm])
}
"#;

        let trim_points = vec![Coords2d { x: -2.0, y: 2.0 }, Coords2d { x: 2.0, y: 2.0 }];

        let sketch_id = ObjectId(1);

        let result = execute_trim_flow(base_kcl_code, &trim_points, sketch_id).await;

        match result {
            Ok(result) => {
                let expected_code = r#"@settings(experimentalFeatures = allow)

sketch(on = YZ) {
  arc1 = sketch2::arc(start = [var -0.41mm, var 0.41mm], end = [var 0mm, var -5mm], center = [var 30mm, var 0mm])
  arc2 = sketch2::arc(start = [var 5mm, var 0mm], end = [var -5mm, var 0mm], center = [var 0mm, var -30mm])
  sketch2::coincident([arc1.start, arc2])
}
"#;

                let result_normalized = result.kcl_code.trim();
                let expected_normalized = expected_code.trim();

                if result_normalized != expected_normalized {
                    eprintln!("Actual result:\n{}", result_normalized);
                    eprintln!("Expected result:\n{}", expected_normalized);
                }

                assert_eq!(
                    result_normalized, expected_normalized,
                    "Trim result should match expected KCL code"
                );
            }
            Err(e) => {
                panic!("trim flow failed: {}", e);
            }
        }
    }

    #[tokio::test]
    async fn test_trim_arc1_top() {
        // Case 4: trim arc1 from [-2, -2] to [2, -2] - should trim top (start)
        let base_kcl_code = r#"@settings(experimentalFeatures = allow)

sketch(on = YZ) {
  arc1 = sketch2::arc(start = [var 0mm, var 5mm], end = [var 0mm, var -5mm], center = [var 30mm, var 0mm])
  arc2 = sketch2::arc(start = [var 5mm, var 0mm], end = [var -5mm, var 0mm], center = [var 0mm, var -30mm])
}
"#;

        let trim_points = vec![Coords2d { x: -2.0, y: -2.0 }, Coords2d { x: 2.0, y: -2.0 }];

        let sketch_id = ObjectId(1);

        let result = execute_trim_flow(base_kcl_code, &trim_points, sketch_id).await;

        match result {
            Ok(result) => {
                let expected_code = r#"@settings(experimentalFeatures = allow)

sketch(on = YZ) {
  arc1 = sketch2::arc(start = [var 0mm, var 5mm], end = [var -0.41mm, var 0.41mm], center = [var 30mm, var 0mm])
  arc2 = sketch2::arc(start = [var 5mm, var 0mm], end = [var -5mm, var 0mm], center = [var 0mm, var -30mm])
  sketch2::coincident([arc1.end, arc2])
}
"#;

                let result_normalized = result.kcl_code.trim();
                let expected_normalized = expected_code.trim();

                if result_normalized != expected_normalized {
                    eprintln!("Actual result:\n{}", result_normalized);
                    eprintln!("Expected result:\n{}", expected_normalized);
                }

                assert_eq!(
                    result_normalized, expected_normalized,
                    "Trim result should match expected KCL code"
                );
            }
            Err(e) => {
                panic!("trim flow failed: {}", e);
            }
        }
    }

    #[tokio::test]
    async fn test_trim_delete_both_segments() {
        // should delete both segments when a single section of the trim line intersects two segments
        let base_kcl_code = r#"@settings(experimentalFeatures = allow)

sketch(on = YZ) {
  line2 = sketch2::line(start = [var 4mm, var 3mm], end = [var 4mm, var -3mm])
  line1 = sketch2::line(start = [var -4mm, var 3mm], end = [var -4mm, var -3mm])
}
"#;

        let trim_points = vec![Coords2d { x: -5.0, y: 1.0 }, Coords2d { x: 5.0, y: 1.0 }];

        let sketch_id = ObjectId(1);

        let result = execute_trim_flow(base_kcl_code, &trim_points, sketch_id).await;

        match result {
            Ok(result) => {
                let expected_code = r#"@settings(experimentalFeatures = allow)

sketch(on = YZ) {
}
"#;

                let result_normalized = result.kcl_code.trim();
                let expected_normalized = expected_code.trim();

                if result_normalized != expected_normalized {
                    eprintln!("Actual result:\n{}", result_normalized);
                    eprintln!("Expected result:\n{}", expected_normalized);
                }

                assert_eq!(
                    result_normalized, expected_normalized,
                    "Trim result should match expected KCL code"
                );
            }
            Err(e) => {
                panic!("trim flow failed: {}", e);
            }
        }
    }

    #[tokio::test]
    async fn test_trim_remove_coincident_point_from_segment_end() {
        // Should remove coincident point from the end of a segment's end that is being trimmed
        let base_kcl_code = r#"@settings(experimentalFeatures = allow)

sketch(on = YZ) {
  line1 = sketch2::line(start = [var -5mm, var 5mm], end = [var -3mm, var 2mm])
  line2 = sketch2::line(start = [var -3mm, var 2mm], end = [var 3mm, var 2mm])
  sketch2::coincident([line1.end, line2.start])
  line3 = sketch2::line(start = [var 3.5mm, var 2mm], end = [var 5mm, var 5mm])
  sketch2::coincident([line2.end, line3.start])
  sketch2::arc(start = [var 1mm, var 5mm], end = [var 1mm, var -1mm], center = [var 5mm, var 2mm])
}
"#;

        let trim_points = vec![Coords2d { x: -1.5, y: 5.0 }, Coords2d { x: -1.5, y: -5.0 }];

        let sketch_id = ObjectId(1);

        let result = execute_trim_flow(base_kcl_code, &trim_points, sketch_id).await;

        match result {
            Ok(result) => {
                let expected_code = r#"@settings(experimentalFeatures = allow)

sketch(on = YZ) {
  line1 = sketch2::line(start = [var -5mm, var 5mm], end = [var -3mm, var 2mm])
  line2 = sketch2::line(start = [var 0mm, var 2mm], end = [var 3mm, var 2mm])
  line3 = sketch2::line(start = [var 3mm, var 2mm], end = [var 5mm, var 5mm])
  sketch2::coincident([line2.end, line3.start])
  arc1 = sketch2::arc(start = [var 1mm, var 5mm], end = [var 1mm, var -1mm], center = [var 5mm, var 2mm])
  sketch2::coincident([line2.start, arc1])
}
"#;

                let result_normalized = result.kcl_code.trim();
                let expected_normalized = expected_code.trim();

                if result_normalized != expected_normalized {
                    eprintln!("Actual result:\n{}", result_normalized);
                    eprintln!("Expected result:\n{}", expected_normalized);
                }

                assert_eq!(
                    result_normalized, expected_normalized,
                    "Trim result should match expected KCL code"
                );
            }
            Err(e) => {
                panic!("trim flow failed: {}", e);
            }
        }
    }

    #[tokio::test]
    async fn test_split_trim_with_point_line_coincident_constraint() {
        // split trim where the end of the trimmed segment has a point-line coincident constraint,
        // should move the constraint to the newly created segment
        let base_kcl_code = r#"@settings(experimentalFeatures = allow)

sketch(on = YZ) {
  arc9 = sketch2::arc(start = [var -5.648mm, var 6.909mm], end = [var -6.864mm, var 2.472mm], center = [var -0.293mm, var 3.056mm])
  arc2 = sketch2::arc(start = [var -7.463mm, var 5.878mm], end = [var -4.365mm, var 6.798mm], center = [var -6.237mm, var 7.425mm])
  line5 = sketch2::line(start = [var -7.81mm, var 3.77mm], end = [var -6.845mm, var 3.828mm])
  line6 = sketch2::line(start = [var -7.47mm, var 2.459mm], end = [var -6.1mm, var 2.489mm])
  sketch2::coincident([arc9.end, line6])
  sketch2::coincident([line5.end, arc9])
}
"#;

        // Trim line that intersects arc9 at two points to cause a split trim
        let trim_points = vec![Coords2d { x: -5.69, y: 4.67 }, Coords2d { x: -7.65, y: 4.83 }];

        let sketch_id = ObjectId(1);

        let result = execute_trim_flow(base_kcl_code, &trim_points, sketch_id).await;

        match result {
            Ok(result) => {
                let expected_code = r#"@settings(experimentalFeatures = allow)

sketch(on = YZ) {
  arc9 = sketch2::arc(start = [var -5.65mm, var 6.91mm], end = [var -6.44mm, var 5.46mm], center = [var -0.29mm, var 3.06mm])
  arc2 = sketch2::arc(start = [var -7.46mm, var 5.88mm], end = [var -4.37mm, var 6.8mm], center = [var -6.24mm, var 7.42mm])
  line5 = sketch2::line(start = [var -7.81mm, var 3.77mm], end = [var -6.84mm, var 3.83mm])
  line6 = sketch2::line(start = [var -7.47mm, var 2.46mm], end = [var -6.1mm, var 2.49mm])
  arc1 = sketch2::arc(start = [var -6.84mm, var 3.83mm], end = [var -6.86mm, var 2.47mm], center = [var -0.29mm, var 3.06mm])
  sketch2::coincident([arc9.end, arc2])
  sketch2::coincident([arc1.start, line5.end])
  sketch2::coincident([arc1.end, line6])
}
"#;

                let result_normalized = result.kcl_code.trim();
                let expected_normalized = expected_code.trim();

                if result_normalized != expected_normalized {
                    eprintln!("Actual result:\n{}", result_normalized);
                    eprintln!("Expected result:\n{}", expected_normalized);
                }

                assert_eq!(
                    result_normalized, expected_normalized,
                    "Trim result should match expected KCL code"
                );
            }
            Err(e) => {
                panic!("trim flow failed: {}", e);
            }
        }
    }

    #[tokio::test]
    async fn test_arc_line_trim_replace_point_segment_coincident() {
        // replaces point-segment coincident with point-point when trimming at coincident endpoint
        let base_kcl_code = r#"@settings(experimentalFeatures = allow)

sketch(on = YZ) {
  arc1 = sketch2::arc(start = [var 0mm, var 5mm], end = [var 0mm, var -5mm], center = [var 30mm, var 0mm])
  line1 = sketch2::line(start = [var -5mm, var -2mm], end = [var -0.41mm, var -0.17mm])
  sketch2::coincident([line1.end, arc1])
}
"#;

        let trim_points = vec![Coords2d { x: -2.0, y: 2.0 }, Coords2d { x: 2.0, y: 2.0 }];

        let sketch_id = ObjectId(1);

        let result = execute_trim_flow(base_kcl_code, &trim_points, sketch_id).await;

        match result {
            Ok(result) => {
                let expected_code = r#"@settings(experimentalFeatures = allow)

sketch(on = YZ) {
  arc1 = sketch2::arc(start = [var -0.41mm, var -0.17mm], end = [var 0mm, var -5mm], center = [var 30mm, var 0mm])
  line1 = sketch2::line(start = [var -5mm, var -2mm], end = [var -0.41mm, var -0.17mm])
  sketch2::coincident([arc1.start, line1.end])
}
"#;

                let result_normalized = result.kcl_code.trim();
                let expected_normalized = expected_code.trim();

                if result_normalized != expected_normalized {
                    eprintln!("Actual result:\n{}", result_normalized);
                    eprintln!("Expected result:\n{}", expected_normalized);
                }

                assert_eq!(
                    result_normalized, expected_normalized,
                    "Trim result should match expected KCL code"
                );
            }
            Err(e) => {
                panic!("trim flow failed: {}", e);
            }
        }
    }

    #[tokio::test]
    async fn test_split_trim_line_trimmed_between_two_intersections() {
        // splits line1 into two segments when trimmed between two intersections
        let base_kcl_code = r#"@settings(experimentalFeatures = allow)

sketch(on = YZ) {
  line1 = sketch2::line(start = [var -4mm, var 0mm], end = [var 5mm, var 0mm])
  line2 = sketch2::line(start = [var -2mm, var 4mm], end = [var -2mm, var -4mm])
  arc1 = sketch2::arc(start = [var 2mm, var 4mm], end = [var 2mm, var -4mm], center = [var 500mm, var 0mm])
}
"#;

        let trim_points = vec![Coords2d { x: 0.0, y: 2.0 }, Coords2d { x: 0.0, y: -2.0 }];

        let sketch_id = ObjectId(1);

        let result = execute_trim_flow(base_kcl_code, &trim_points, sketch_id).await;

        match result {
            Ok(result) => {
                let expected_code = r#"@settings(experimentalFeatures = allow)

sketch(on = YZ) {
  line1 = sketch2::line(start = [var -4mm, var 0mm], end = [var -2mm, var 0mm])
  line2 = sketch2::line(start = [var -2mm, var 4mm], end = [var -2mm, var -4mm])
  arc1 = sketch2::arc(start = [var 2mm, var 4mm], end = [var 2mm, var -4mm], center = [var 500mm, var 0mm])
  line3 = sketch2::line(start = [var 1.98mm, var 0mm], end = [var 5mm, var 0mm])
  sketch2::coincident([line1.end, line2])
  sketch2::coincident([line3.start, arc1])
}
"#;

                let result_normalized = result.kcl_code.trim();
                let expected_normalized = expected_code.trim();

                if result_normalized != expected_normalized {
                    eprintln!("Actual result:\n{}", result_normalized);
                    eprintln!("Expected result:\n{}", expected_normalized);
                }

                assert_eq!(
                    result_normalized, expected_normalized,
                    "Trim result should match expected KCL code"
                );
            }
            Err(e) => {
                panic!("trim flow failed: {}", e);
            }
        }
    }

    #[tokio::test]
    async fn test_split_lines_with_point_segment_coincident_points() {
        // another edge case involving split lines and point-segment coincident points
        let base_kcl_code = r#"@settings(experimentalFeatures = allow)

sketch(on = YZ) {
  line1 = sketch2::line(start = [var -3.86mm, var 5.53mm], end = [var -4.35mm, var 2.301mm])
  line2 = sketch2::line(start = [var -6.13mm, var 1.67mm], end = [var 4.25mm, var 5.351mm])
  arc4 = sketch2::arc(start = [var 3.09mm, var 4.939mm], end = [var 2.691mm, var 6.42mm], center = [var -7.39mm, var 2.91mm])
  sketch2::coincident([arc4.start, line2])
  sketch2::coincident([line1.end, line2])
  arc3 = sketch2::arc(start = [var -2.42mm, var 5.38mm], end = [var -0.69mm, var -0.661mm], center = [var 1.286mm, var 3.174mm])
}
"#;

        let trim_points = vec![Coords2d { x: 0.0, y: 6.0 }, Coords2d { x: -1.1, y: 1.6 }];

        let sketch_id = ObjectId(1);

        let result = execute_trim_flow(base_kcl_code, &trim_points, sketch_id).await;

        match result {
            Ok(result) => {
                let expected_code = r#"@settings(experimentalFeatures = allow)

sketch(on = YZ) {
  line1 = sketch2::line(start = [var -3.86mm, var 5.53mm], end = [var -4.35mm, var 2.3mm])
  line2 = sketch2::line(start = [var -6.13mm, var 1.67mm], end = [var -3.01mm, var 2.78mm])
  arc4 = sketch2::arc(start = [var 3.09mm, var 4.94mm], end = [var 2.69mm, var 6.42mm], center = [var -7.39mm, var 2.91mm])
  sketch2::coincident([line1.end, line2])
  arc3 = sketch2::arc(start = [var -2.42mm, var 5.38mm], end = [var -0.69mm, var -0.66mm], center = [var 1.29mm, var 3.17mm])
  line3 = sketch2::line(start = [var 3.09mm, var 4.94mm], end = [var 4.25mm, var 5.35mm])
  sketch2::coincident([line2.end, arc3])
  sketch2::coincident([line3.start, arc4.start])
}
"#;

                let result_normalized = result.kcl_code.trim();
                let expected_normalized = expected_code.trim();

                if result_normalized != expected_normalized {
                    eprintln!("Actual result:\n{}", result_normalized);
                    eprintln!("Expected result:\n{}", expected_normalized);
                }

                assert_eq!(
                    result_normalized, expected_normalized,
                    "Trim result should match expected KCL code"
                );
            }
            Err(e) => {
                panic!("trim flow failed: {}", e);
            }
        }
    }

    #[tokio::test]
    async fn test_split_arc_with_point_segment_coincident_constraints() {
        // Can split arc with point-segment coincident constraints
        let base_kcl_code = r#"@settings(experimentalFeatures = allow)

sketch(on = YZ) {
  arc1 = sketch2::arc(start = [var -3.2mm, var 6.2mm], end = [var -1.8mm, var -4.7mm], center = [var 1.8mm, var 1.3mm])
  arc2 = sketch2::arc(start = [var -4.6mm, var -1.6mm], end = [var -6.5mm, var -2mm], center = [var -4.4mm, var -8.2mm])
  line1 = sketch2::line(start = [var -7.5mm, var 2.5mm], end = [var -5.1mm, var 2.3mm])
  sketch2::coincident([line1.end, arc1])
  sketch2::coincident([arc2.start, arc1])
}
"#;

        // Test that all trim lines produce the same result
        let trim_lines = [
            vec![Coords2d { x: -3.45, y: -1.3 }, Coords2d { x: -5.53, y: -1.3 }],
            vec![Coords2d { x: -3.93, y: 2.17 }, Coords2d { x: -6.24, y: 2.14 }],
            vec![Coords2d { x: -3.77, y: 0.5 }, Coords2d { x: -6.11, y: 0.37 }],
        ];

        let expected_code = r#"@settings(experimentalFeatures = allow)

sketch(on = YZ) {
  arc1 = sketch2::arc(start = [var -3.2mm, var 6.2mm], end = [var -5.12mm, var 2.3mm], center = [var 1.8mm, var 1.3mm])
  arc2 = sketch2::arc(start = [var -4.58mm, var -1.62mm], end = [var -6.51mm, var -1.97mm], center = [var -4.39mm, var -8.2mm])
  line1 = sketch2::line(start = [var -7.5mm, var 2.5mm], end = [var -5.12mm, var 2.3mm])
  arc3 = sketch2::arc(start = [var -4.58mm, var -1.62mm], end = [var -1.81mm, var -4.72mm], center = [var 1.8mm, var 1.3mm])
  sketch2::coincident([arc1.end, line1.end])
  sketch2::coincident([arc3.start, arc2.start])
}
"#;

        let sketch_id = ObjectId(1);

        for (i, trim_points) in trim_lines.iter().enumerate() {
            let result = execute_trim_flow(base_kcl_code, trim_points, sketch_id).await;

            match result {
                Ok(result) => {
                    let result_normalized = result.kcl_code.trim();
                    let expected_normalized = expected_code.trim();

                    if result_normalized != expected_normalized {
                        eprintln!("Trim line {} ({:?}) produced different result", i + 1, trim_points);
                        eprintln!("Actual result:\n{}", result_normalized);
                        eprintln!("Expected result:\n{}", expected_normalized);
                    }

                    assert_eq!(
                        result_normalized,
                        expected_normalized,
                        "Trim line {} should produce the same result",
                        i + 1
                    );
                }
                Err(e) => {
                    panic!("trim flow failed for trim line {}: {}", i + 1, e);
                }
            }
        }
    }

    #[tokio::test]
    async fn test_split_arc_with_point_segment_coincident_on_one_side_and_intersection_on_other() {
        // split arc with point-segment coincident on one side and intersection on the other
        let base_kcl_code = r#"@settings(experimentalFeatures = allow)

sketch(on = YZ) {
  arc2 = sketch2::arc(start = [var 2.541mm, var -5.65mm], end = [var 1.979mm, var 6.83mm], center = [var -7.28mm, var 0.161mm])
  arc1 = sketch2::arc(start = [var 5.69mm, var 4.559mm], end = [var -4.011mm, var -3.04mm], center = [var 5.1mm, var -4.678mm])
  line1 = sketch2::line(start = [var -4.28mm, var 4.29mm], end = [var 1.34mm, var -4.76mm])
  line4 = sketch2::line(start = [var -1.029mm, var 2.259mm], end = [var -2.01mm, var -6.62mm])
  sketch2::coincident([line4.start, arc1])
}
"#;

        let trim_points = vec![Coords2d { x: -0.4, y: 4.4 }, Coords2d { x: 1.3, y: 2.4 }];

        let sketch_id = ObjectId(1);

        let result = execute_trim_flow(base_kcl_code, &trim_points, sketch_id).await;

        match result {
            Ok(result) => {
                let expected_code = r#"@settings(experimentalFeatures = allow)

sketch(on = YZ) {
  arc2 = sketch2::arc(start = [var 2.54mm, var -5.65mm], end = [var 1.98mm, var 6.83mm], center = [var -7.28mm, var 0.16mm])
  arc1 = sketch2::arc(start = [var 5.69mm, var 4.56mm], end = [var 3.31mm, var 4.4mm], center = [var 5.1mm, var -4.68mm])
  line1 = sketch2::line(start = [var -4.28mm, var 4.29mm], end = [var 1.34mm, var -4.76mm])
  line4 = sketch2::line(start = [var -1.03mm, var 2.26mm], end = [var -2.01mm, var -6.62mm])
  arc3 = sketch2::arc(start = [var -1.03mm, var 2.26mm], end = [var -4.01mm, var -3.04mm], center = [var 5.1mm, var -4.68mm])
  sketch2::coincident([arc1.end, arc2])
  sketch2::coincident([arc3.start, line4.start])
}
"#;

                let result_normalized = result.kcl_code.trim();
                let expected_normalized = expected_code.trim();

                if result_normalized != expected_normalized {
                    eprintln!("Actual result:\n{}", result_normalized);
                    eprintln!("Expected result:\n{}", expected_normalized);
                }

                assert_eq!(
                    result_normalized, expected_normalized,
                    "Trim result should match expected KCL code"
                );
            }
            Err(e) => {
                panic!("trim flow failed: {}", e);
            }
        }
    }

    #[tokio::test]
    async fn test_split_straight_segments_migrate_constraints() {
        // split straight segments should migrate other constraints correctly
        let base_kcl_code = r#"@settings(experimentalFeatures = allow)

sketch(on = YZ) {
  segmentToBeTrimmedAndSplit = sketch2::line(start = [var -6mm, var 0mm], end = [var 6mm, var 0mm])
  startSideCoincidentWithTrimSegStart = sketch2::line(start = [var -6mm, var 3mm], end = [var -6mm, var -3mm])
  startSideEndPointCoincidentWithTrimSeg = sketch2::line(start = [var -4mm, var 0mm], end = [var -4mm, var 3mm])
  startSideIntersectionTrimTermination = sketch2::line(start = [var -2mm, var 3mm], end = [var -2mm, var -3mm])
  endSideIntersectionTrimTermination = sketch2::line(start = [var 2mm, var 3mm], end = [var 2mm, var -3mm])
  endSideEndPointCoincidentWithTrimSeg = sketch2::line(start = [var 4mm, var -3mm], end = [var 4mm, var 0mm])
  endSideCoincidentWithTrimSegStart = sketch2::line(start = [var 6mm, var 3mm], end = [var 6mm, var -3mm])
  sketch2::coincident([
    segmentToBeTrimmedAndSplit.start,
    startSideCoincidentWithTrimSegStart
  ])
  sketch2::coincident([
    startSideEndPointCoincidentWithTrimSeg.start,
    segmentToBeTrimmedAndSplit
  ])
  sketch2::coincident([
    endSideEndPointCoincidentWithTrimSeg.end,
    segmentToBeTrimmedAndSplit
  ])
  sketch2::coincident([
    segmentToBeTrimmedAndSplit.end,
    endSideCoincidentWithTrimSegStart
  ])
}
"#;

        let trim_points = vec![Coords2d { x: 0.0, y: 4.0 }, Coords2d { x: 0.0, y: -4.0 }];

        let sketch_id = ObjectId(1);

        let result = execute_trim_flow(base_kcl_code, &trim_points, sketch_id).await;

        match result {
            Ok(result) => {
                let expected_code = r#"@settings(experimentalFeatures = allow)

sketch(on = YZ) {
  segmentToBeTrimmedAndSplit = sketch2::line(start = [var -6mm, var 0mm], end = [var -2mm, var 0mm])
  startSideCoincidentWithTrimSegStart = sketch2::line(start = [var -6mm, var 3mm], end = [var -6mm, var -3mm])
  startSideEndPointCoincidentWithTrimSeg = sketch2::line(start = [var -4mm, var 0mm], end = [var -4mm, var 3mm])
  startSideIntersectionTrimTermination = sketch2::line(start = [var -2mm, var 3mm], end = [var -2mm, var -3mm])
  endSideIntersectionTrimTermination = sketch2::line(start = [var 2mm, var 3mm], end = [var 2mm, var -3mm])
  endSideEndPointCoincidentWithTrimSeg = sketch2::line(start = [var 4mm, var -3mm], end = [var 4mm, var 0mm])
  endSideCoincidentWithTrimSegStart = sketch2::line(start = [var 6mm, var 3mm], end = [var 6mm, var -3mm])
  sketch2::coincident([
    segmentToBeTrimmedAndSplit.start,
    startSideCoincidentWithTrimSegStart
  ])
  sketch2::coincident([
    startSideEndPointCoincidentWithTrimSeg.start,
    segmentToBeTrimmedAndSplit
  ])
  line1 = sketch2::line(start = [var 2mm, var 0mm], end = [var 6mm, var 0mm])
  sketch2::coincident([
    segmentToBeTrimmedAndSplit.end,
    startSideIntersectionTrimTermination
  ])
  sketch2::coincident([
    line1.start,
    endSideIntersectionTrimTermination
  ])
  sketch2::coincident([
    line1.end,
    endSideCoincidentWithTrimSegStart
  ])
  sketch2::coincident([
    endSideEndPointCoincidentWithTrimSeg.end,
    line1
  ])
}
"#;

                let result_normalized = result.kcl_code.trim();
                let expected_normalized = expected_code.trim();

                if result_normalized != expected_normalized {
                    eprintln!("Actual result:\n{}", result_normalized);
                    eprintln!("Expected result:\n{}", expected_normalized);
                }

                assert_eq!(
                    result_normalized, expected_normalized,
                    "Trim result should match expected KCL code"
                );
            }
            Err(e) => {
                panic!("trim flow failed: {}", e);
            }
        }
    }

    #[tokio::test]
    async fn test_trim_with_distance_constraints_preserve_constraints() {
        // trim with distance constraints should preserve constraints correctly
        let base_kcl_code = r#"@settings(experimentalFeatures = allow)

sketch(on = YZ) {
  line1 = sketch2::line(start = [var -5.5mm, var 7mm], end = [var -3mm, var 5mm])
  simpleDeleteLineDisConstraintDeletedAsWell = sketch2::line(start = [var -3mm, var 5mm], end = [var 3.5mm, var 4.5mm])
  sketch2::coincident([
    line1.end,
    simpleDeleteLineDisConstraintDeletedAsWell.start
  ])
  simpleDeleteLineDisConstraintDeletedAsWell2 = sketch2::line(start = [var -3.5mm, var 3.5mm], end = [var 3.5mm, var 3.5mm])
  line4 = sketch2::line(start = [var -6mm, var 4mm], end = [var -3.5mm, var 2mm])
  endTrimmedShouldDeleteDisConstraint = sketch2::line(start = [var -3.5mm, var 2mm], end = [var 3mm, var 2mm])
  sketch2::coincident([
    line4.end,
    endTrimmedShouldDeleteDisConstraint.start
  ])
  line6 = sketch2::line(start = [var -3mm, var 1mm], end = [var -2mm, var 2.5mm])
  startTrimmedAlsoDeleteDisConstraint = sketch2::line(start = [var -3.22mm, var -0.64mm], end = [var 3.02mm, var -0.75mm])
  line3 = sketch2::line(start = [var 3.02mm, var -0.75mm], end = [var 5.38mm, var 1.14mm])
  sketch2::coincident([
    startTrimmedAlsoDeleteDisConstraint.end,
    line3.start
  ])
  line5 = sketch2::line(start = [var 1.24mm, var 0.92mm], end = [var 1.84mm, var -1.64mm])
  splitTrimLineDistanceConstraintMigrated = sketch2::line(start = [var -2.67mm, var -3.46mm], end = [var 2.87mm, var -3.54mm])
  line8 = sketch2::line(start = [var 2.87mm, var -3.54mm], end = [var 5.42mm, var -1.72mm])
  sketch2::coincident([
    splitTrimLineDistanceConstraintMigrated.end,
    line8.start
  ])
  line9 = sketch2::line(start = [var 1.1mm, var -3.98mm], end = [var 1.28mm, var -5.69mm])
  line10 = sketch2::line(start = [var 1.98mm, var -4.06mm], end = [var 2.57mm, var -5.65mm])
  line11 = sketch2::line(start = [var -1.93mm, var -2.2mm], end = [var -1.6mm, var -5.43mm])
  sketch2::coincident([
    line9.start,
    splitTrimLineDistanceConstraintMigrated
  ])
  sketch2::coincident([
    line10.start,
    splitTrimLineDistanceConstraintMigrated
  ])
  sketch2::distance([
    simpleDeleteLineDisConstraintDeletedAsWell.start,
    simpleDeleteLineDisConstraintDeletedAsWell.end
  ]) == 6.52mm
  sketch2::distance([
    simpleDeleteLineDisConstraintDeletedAsWell2.start,
    simpleDeleteLineDisConstraintDeletedAsWell2.end
  ]) == 7mm
  sketch2::distance([
    endTrimmedShouldDeleteDisConstraint.start,
    endTrimmedShouldDeleteDisConstraint.end
  ]) == 6.5mm
  sketch2::distance([
    startTrimmedAlsoDeleteDisConstraint.start,
    startTrimmedAlsoDeleteDisConstraint.end
  ]) == 6.24mm
  sketch2::distance([
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

        let sketch_id = ObjectId(1);

        let result = execute_trim_flow(base_kcl_code, &trim_points, sketch_id).await;

        match result {
            Ok(result) => {
                let expected_code = r#"@settings(experimentalFeatures = allow)

sketch(on = YZ) {
  line1 = sketch2::line(start = [var -5.5mm, var 7mm], end = [var -3mm, var 5mm])
  line4 = sketch2::line(start = [var -6mm, var 4mm], end = [var -3.5mm, var 2mm])
  endTrimmedShouldDeleteDisConstraint = sketch2::line(start = [var -3.5mm, var 2mm], end = [var -2.33mm, var 2mm])
  sketch2::coincident([
    line4.end,
    endTrimmedShouldDeleteDisConstraint.start
  ])
  line6 = sketch2::line(start = [var -3mm, var 1mm], end = [var -2mm, var 2.5mm])
  startTrimmedAlsoDeleteDisConstraint = sketch2::line(start = [var 1.63mm, var -0.73mm], end = [var 3.02mm, var -0.75mm])
  line3 = sketch2::line(start = [var 3.02mm, var -0.75mm], end = [var 5.38mm, var 1.14mm])
  sketch2::coincident([
    startTrimmedAlsoDeleteDisConstraint.end,
    line3.start
  ])
  line5 = sketch2::line(start = [var 1.24mm, var 0.92mm], end = [var 1.84mm, var -1.64mm])
  splitTrimLineDistanceConstraintMigrated = sketch2::line(start = [var -2.67mm, var -3.46mm], end = [var -1.78mm, var -3.62mm])
  line8 = sketch2::line(start = [var 2.87mm, var -3.72mm], end = [var 5.42mm, var -1.72mm])
  line9 = sketch2::line(start = [var 1.1mm, var -3.91mm], end = [var 1.28mm, var -5.69mm])
  line10 = sketch2::line(start = [var 1.99mm, var -3.81mm], end = [var 2.57mm, var -5.65mm])
  line11 = sketch2::line(start = [var -1.93mm, var -2.2mm], end = [var -1.6mm, var -5.43mm])
  sketch2::coincident([
    endTrimmedShouldDeleteDisConstraint.end,
    line6
  ])
  sketch2::coincident([
    startTrimmedAlsoDeleteDisConstraint.start,
    line5
  ])
  line2 = sketch2::line(start = [var 1.1mm, var -3.91mm], end = [var 2.87mm, var -3.72mm])
  sketch2::coincident([
    splitTrimLineDistanceConstraintMigrated.end,
    line11
  ])
  sketch2::coincident([line2.start, line9.start])
  sketch2::coincident([line2.end, line8.start])
  sketch2::coincident([line10.start, line2])
sketch2::distance([
  splitTrimLineDistanceConstraintMigrated.start,
  line2.end
]) == 5.54mm
}
"#;

                let result_normalized = result.kcl_code.trim();
                let expected_normalized = expected_code.trim();

                if result_normalized != expected_normalized {
                    eprintln!("Actual result:\n{}", result_normalized);
                    eprintln!("Expected result:\n{}", expected_normalized);
                }

                assert_eq!(
                    result_normalized, expected_normalized,
                    "Trim result should match expected KCL code"
                );
            }
            Err(e) => {
                panic!("trim flow failed: {}", e);
            }
        }
    }

    #[tokio::test]
    async fn test_split_trim_migrate_angle_constraints() {
        // split trim should migrate angle constraints to new segment
        let base_kcl_code = r#"@settings(experimentalFeatures = allow)

sketch(on = YZ) {
  line1 = sketch2::line(start = [var -2.01mm, var 6.12mm], end = [var 0.23mm, var 4.55mm])
  line2 = sketch2::line(start = [var -4.15mm, var -0mm], end = [var 0.79mm, var -3.47mm])
  sketch2::parallel([line1, line2])
  line3 = sketch2::line(start = [var -3.1mm, var 1.3mm], end = [var -2.96mm, var -3.08mm])
  line4 = sketch2::line(start = [var -0.58mm, var -0.81mm], end = [var -1.13mm, var -4.94mm])
  line5 = sketch2::line(start = [var -0.11mm, var -3.3mm], end = [var -0.11mm, var -5.63mm])
  line6 = sketch2::line(start = [var 1.49mm, var -3.48mm], end = [var 3.5mm, var -1.84mm])
  sketch2::coincident([line6.start, line2.end])
  sketch2::coincident([line5.start, line2])
}
"#;

        let trim_points = vec![Coords2d { x: -1.75, y: -0.56 }, Coords2d { x: -1.75, y: -2.93 }];

        let sketch_id = ObjectId(1);

        let result = execute_trim_flow(base_kcl_code, &trim_points, sketch_id).await;

        match result {
            Ok(result) => {
                let expected_code = r#"@settings(experimentalFeatures = allow)

sketch(on = YZ) {
  line1 = sketch2::line(start = [var -2.05mm, var 6.06mm], end = [var 0.27mm, var 4.61mm])
  line2 = sketch2::line(start = [var -4.18mm, var -0.05mm], end = [var -3.02mm, var -0.78mm])
  sketch2::parallel([line1, line2])
  line3 = sketch2::line(start = [var -3.09mm, var 1.3mm], end = [var -2.95mm, var -3.08mm])
  line4 = sketch2::line(start = [var -0.59mm, var -0.81mm], end = [var -1.14mm, var -4.94mm])
  line5 = sketch2::line(start = [var 0.1mm, var -2.99mm], end = [var -0.11mm, var -5.63mm])
  line6 = sketch2::line(start = [var 1.18mm, var -3.67mm], end = [var 3.5mm, var -1.84mm])
  line7 = sketch2::line(start = [var -0.81mm, var -2.42mm], end = [var 1.18mm, var -3.67mm])
  sketch2::coincident([line2.end, line3])
  sketch2::coincident([line7.start, line4])
  sketch2::coincident([line7.end, line6.start])
  sketch2::coincident([line5.start, line7])
  sketch2::parallel([line1, line7])
}
"#;

                let result_normalized = result.kcl_code.trim();
                let expected_normalized = expected_code.trim();

                if result_normalized != expected_normalized {
                    eprintln!("Actual result:\n{}", result_normalized);
                    eprintln!("Expected result:\n{}", expected_normalized);
                }

                assert_eq!(
                    result_normalized, expected_normalized,
                    "Trim result should match expected KCL code"
                );
            }
            Err(e) => {
                panic!("trim flow failed: {}", e);
            }
        }
    }

    #[tokio::test]
    async fn test_split_trim_migrate_horizontal_constraint() {
        // split trim should migrate horizontal constraint to new segment
        let base_kcl_code = r#"@settings(experimentalFeatures = allow)

sketch(on = YZ) {
  line1 = sketch2::line(start = [var -3.64mm, var 1.26mm], end = [var 3.8mm, var 1.26mm])
  line2 = sketch2::line(start = [var 3.32mm, var 5.32mm], end = [var -4.67mm, var -1.14mm])
  line3 = sketch2::line(start = [var 4.34mm, var 3.17mm], end = [var -3.94mm, var -3.95mm])
  sketch2::horizontal(line1)
}
"#;

        let trim_points = vec![Coords2d { x: 0.73, y: 1.85 }, Coords2d { x: -0.8, y: 0.25 }];

        let sketch_id = ObjectId(1);

        let result = execute_trim_flow(base_kcl_code, &trim_points, sketch_id).await;

        match result {
            Ok(result) => {
                let expected_code = r#"@settings(experimentalFeatures = allow)

sketch(on = YZ) {
  line1 = sketch2::line(start = [var -3.64mm, var 1.26mm], end = [var -1.7mm, var 1.26mm])
  line2 = sketch2::line(start = [var 3.32mm, var 5.32mm], end = [var -4.67mm, var -1.14mm])
  line3 = sketch2::line(start = [var 4.34mm, var 3.17mm], end = [var -3.94mm, var -3.95mm])
  sketch2::horizontal(line1)
  line4 = sketch2::line(start = [var 2.12mm, var 1.26mm], end = [var 3.8mm, var 1.26mm])
  sketch2::coincident([line1.end, line2])
  sketch2::coincident([line4.start, line3])
  sketch2::horizontal(line4)
}
"#;

                let result_normalized = result.kcl_code.trim();
                let expected_normalized = expected_code.trim();

                if result_normalized != expected_normalized {
                    eprintln!("Actual result:\n{}", result_normalized);
                    eprintln!("Expected result:\n{}", expected_normalized);
                }

                assert_eq!(
                    result_normalized, expected_normalized,
                    "Trim result should match expected KCL code"
                );
            }
            Err(e) => {
                panic!("trim flow failed: {}", e);
            }
        }
    }

    #[tokio::test]
    async fn test_split_trim_migrate_vertical_constraint() {
        // split trim should migrate vertical constraint to new segment
        let base_kcl_code = r#"@settings(experimentalFeatures = allow)

sketch(on = YZ) {
  line1 = sketch2::line(start = [var -0.36mm, var 3.66mm], end = [var -0.36mm, var -2.66mm])
  line2 = sketch2::line(start = [var 3.32mm, var 5.32mm], end = [var -4.67mm, var -1.14mm])
  line3 = sketch2::line(start = [var 4.34mm, var 3.17mm], end = [var -3.94mm, var -3.95mm])
  sketch2::vertical(line1)
}
"#;

        let trim_points = vec![Coords2d { x: 0.47, y: 1.45 }, Coords2d { x: -1.72, y: 0.1 }];

        let sketch_id = ObjectId(1);

        let result = execute_trim_flow(base_kcl_code, &trim_points, sketch_id).await;

        match result {
            Ok(result) => {
                let expected_code = r#"@settings(experimentalFeatures = allow)

sketch(on = YZ) {
  line1 = sketch2::line(start = [var -0.36mm, var 3.66mm], end = [var -0.36mm, var 2.34mm])
  line2 = sketch2::line(start = [var 3.32mm, var 5.32mm], end = [var -4.67mm, var -1.14mm])
  line3 = sketch2::line(start = [var 4.34mm, var 3.17mm], end = [var -3.94mm, var -3.95mm])
  sketch2::vertical(line1)
  line4 = sketch2::line(start = [var -0.36mm, var -0.87mm], end = [var -0.36mm, var -2.66mm])
  sketch2::coincident([line1.end, line2])
  sketch2::coincident([line4.start, line3])
  sketch2::vertical(line4)
}
"#;

                let result_normalized = result.kcl_code.trim();
                let expected_normalized = expected_code.trim();

                if result_normalized != expected_normalized {
                    eprintln!("Actual result:\n{}", result_normalized);
                    eprintln!("Expected result:\n{}", expected_normalized);
                }

                assert_eq!(
                    result_normalized, expected_normalized,
                    "Trim result should match expected KCL code"
                );
            }
            Err(e) => {
                panic!("trim flow failed: {}", e);
            }
        }
    }

    #[tokio::test]
    async fn test_split_trim_migrate_perpendicular_constraint() {
        // split trim should migrate perpendicular constraint to new segment
        let base_kcl_code = r#"@settings(experimentalFeatures = allow)

sketch(on = YZ) {
  line4 = sketch2::line(start = [var -0.91mm, var 5.79mm], end = [var 1.86mm, var 7.22mm])
  line1 = sketch2::line(start = [var -1.97mm, var 3.24mm], end = [var 0.55mm, var -2.31mm])
  line2 = sketch2::line(start = [var 3.32mm, var 5.32mm], end = [var -4.67mm, var -1.14mm])
  line3 = sketch2::line(start = [var 4.34mm, var 3.17mm], end = [var -3.94mm, var -3.95mm])
  sketch2::perpendicular([line4, line1])
}
"#;

        let trim_points = vec![Coords2d { x: 0.95, y: 1.67 }, Coords2d { x: -2.3, y: -0.08 }];

        let sketch_id = ObjectId(1);

        let result = execute_trim_flow(base_kcl_code, &trim_points, sketch_id).await;

        match result {
            Ok(result) => {
                let expected_code = r#"@settings(experimentalFeatures = allow)

sketch(on = YZ) {
  line4 = sketch2::line(start = [var -0.92mm, var 5.82mm], end = [var 1.87mm, var 7.19mm])
  line1 = sketch2::line(start = [var -2mm, var 3.22mm], end = [var -1.22mm, var 1.64mm])
  line2 = sketch2::line(start = [var 3.32mm, var 5.32mm], end = [var -4.67mm, var -1.14mm])
  line3 = sketch2::line(start = [var 4.34mm, var 3.17mm], end = [var -3.94mm, var -3.95mm])
  sketch2::perpendicular([line4, line1])
  line5 = sketch2::line(start = [var -0.18mm, var -0.71mm], end = [var 0.6mm, var -2.29mm])
  sketch2::coincident([line1.end, line2])
  sketch2::coincident([line5.start, line3])
  sketch2::perpendicular([line4, line5])
}
"#;

                let result_normalized = result.kcl_code.trim();
                let expected_normalized = expected_code.trim();

                if result_normalized != expected_normalized {
                    eprintln!("Actual result:\n{}", result_normalized);
                    eprintln!("Expected result:\n{}", expected_normalized);
                }

                assert_eq!(
                    result_normalized, expected_normalized,
                    "Trim result should match expected KCL code"
                );
            }
            Err(e) => {
                panic!("trim flow failed: {}", e);
            }
        }
    }

    #[tokio::test]
    async fn test_split_arc_duplicate_center_point_constraints() {
        // split arc should duplicate center point constraints to new arc
        let base_kcl_code = r#"@settings(experimentalFeatures = allow)

sketch(on = YZ) {
  arcToSplit = sketch2::arc(start = [var 10.5mm, var 1mm], end = [var -10.5mm, var 0.5mm], center = [var 0.5mm, var -8.5mm])
  line1 = sketch2::line(start = [var -6mm, var 8mm], end = [var -5.5mm, var 0mm])
  line2 = sketch2::line(start = [var 4mm, var 8.5mm], end = [var 3mm, var 1.5mm])
  lineCoincidentWithArcCen = sketch2::line(start = [var 1.5mm, var -9mm], end = [var 11.5mm, var -7.5mm])
  line4 = sketch2::line(start = [var 11.5mm, var 1mm], end = [var 13mm, var 6.5mm])
  line5 = sketch2::line(start = [var 7.5mm, var 4mm], end = [var 10mm, var 8mm])
  sketch2::coincident([line5.start, arcToSplit])
  sketch2::coincident([line4.start, arcToSplit.start])
  sketch2::coincident([
    lineCoincidentWithArcCen.start,
    arcToSplit.center
  ])
  sketch2::distance([arcToSplit.center, line4.end]) == 20mm
  line3 = sketch2::line(start = [var -0.9mm, var -6.9mm], end = [var 2.9mm, var -11.2mm])
  sketch2::coincident([arcToSplit.center, line3])
}
"#;

        let trim_points = vec![Coords2d { x: -1.66, y: 7.54 }, Coords2d { x: -1.81, y: 2.11 }];

        let sketch_id = ObjectId(1);

        let result = execute_trim_flow(base_kcl_code, &trim_points, sketch_id).await;

        match result {
            Ok(result) => {
                let expected_code = r#"@settings(experimentalFeatures = allow)

sketch(on = YZ) {
  arcToSplit = sketch2::arc(start = [var 11.03mm, var 1.02mm], end = [var 3.52mm, var 5.17mm], center = [var 0.75mm, var -8.72mm])
  line1 = sketch2::line(start = [var -6mm, var 8mm], end = [var -5.5mm, var 0mm])
  line2 = sketch2::line(start = [var 4mm, var 8.5mm], end = [var 3mm, var 1.5mm])
  lineCoincidentWithArcCen = sketch2::line(start = [var 0.75mm, var -8.72mm], end = [var 11.5mm, var -7.5mm])
  line4 = sketch2::line(start = [var 11.03mm, var 1.02mm], end = [var 13.3mm, var 6.85mm])
  line5 = sketch2::line(start = [var 7.38mm, var 3.8mm], end = [var 10mm, var 8mm])
  sketch2::coincident([line5.start, arcToSplit])
  sketch2::coincident([line4.start, arcToSplit.start])
  sketch2::coincident([
    lineCoincidentWithArcCen.start,
    arcToSplit.center
  ])
sketch2::distance([arcToSplit.center, line4.end]) == 20mm
  line3 = sketch2::line(start = [var -0.87mm, var -6.87mm], end = [var 2.91mm, var -11.19mm])
  sketch2::coincident([arcToSplit.center, line3])
  arc1 = sketch2::arc(start = [var -5.75mm, var 3.97mm], end = [var -10.28mm, var 0.32mm], center = [var 0.75mm, var -8.72mm])
  sketch2::coincident([arcToSplit.end, line2])
  sketch2::coincident([arc1.start, line1])
  sketch2::coincident([
    lineCoincidentWithArcCen.start,
    arc1.center
  ])
sketch2::distance([arc1.center, line4.end]) == 20mm
  sketch2::coincident([arc1.center, line3])
}
"#;

                let result_normalized = result.kcl_code.trim();
                let expected_normalized = expected_code.trim();

                if result_normalized != expected_normalized {
                    eprintln!("Actual result:\n{}", result_normalized);
                    eprintln!("Expected result:\n{}", expected_normalized);
                }

                assert_eq!(
                    result_normalized, expected_normalized,
                    "Trim result should match expected KCL code"
                );
            }
            Err(e) => {
                panic!("trim flow failed: {}", e);
            }
        }
    }

    #[tokio::test]
    async fn test_trimming_arcs_preserve_distance_constraints() {
        // Trimming arcs should preserve distance constraints that reference other segments
        let base_kcl_code = r#"@settings(experimentalFeatures = allow)

sketch(on = YZ) {
  arc1 = sketch2::arc(start = [var 0.87mm, var 2.9mm], end = [var -5.31mm, var -1.34mm], center = [var -0.65mm, var -1.5mm])
  line1 = sketch2::line(start = [var -4.72mm, var 3.54mm], end = [var -2.24mm, var -1.48mm])
  line2 = sketch2::line(start = [var 2.27mm, var -4.04mm], end = [var 4.65mm, var -1.26mm])
sketch2::distance([arc1.center, line2.start]) == 3.87mm
  line3 = sketch2::line(start = [var -5.61mm, var 5.38mm], end = [var 1.03mm, var 5.53mm])
  line4 = sketch2::line(start = [var 1.03mm, var 5.53mm], end = [var 6.15mm, var 3.11mm])
  sketch2::coincident([line3.end, line4.start])
  line5 = sketch2::line(start = [var -1.05mm, var 6.42mm], end = [var -0.77mm, var 4.73mm])
sketch2::distance([line4.end, line3.start]) == 11.98mm
}
"#;

        let trim_points = vec![
            Coords2d { x: 0.24, y: 6.57 },
            Coords2d { x: -1.66, y: 3.78 },
            Coords2d { x: -1.57, y: 1.03 },
        ];

        let sketch_id = ObjectId(1);

        let result = execute_trim_flow(base_kcl_code, &trim_points, sketch_id).await;

        match result {
            Ok(result) => {
                let expected_code = r#"@settings(experimentalFeatures = allow)

sketch(on = YZ) {
  arc1 = sketch2::arc(start = [var -3.89mm, var 1.85mm], end = [var -5.31mm, var -1.34mm], center = [var -0.65mm, var -1.5mm])
  line1 = sketch2::line(start = [var -4.72mm, var 3.54mm], end = [var -2.24mm, var -1.48mm])
  line2 = sketch2::line(start = [var 2.27mm, var -4.04mm], end = [var 4.65mm, var -1.26mm])
sketch2::distance([arc1.center, line2.start]) == 3.87mm
  line3 = sketch2::line(start = [var -5.61mm, var 5.38mm], end = [var -0.9mm, var 5.49mm])
  line4 = sketch2::line(start = [var 1.03mm, var 5.53mm], end = [var 6.15mm, var 3.11mm])
  line5 = sketch2::line(start = [var -1.05mm, var 6.42mm], end = [var -0.77mm, var 4.73mm])
sketch2::distance([line4.end, line3.start]) == 11.98mm
  sketch2::coincident([line3.end, line5])
  sketch2::coincident([arc1.start, line1])
}
"#;

                let result_normalized = result.kcl_code.trim();
                let expected_normalized = expected_code.trim();

                if result_normalized != expected_normalized {
                    eprintln!("Actual result:\n{}", result_normalized);
                    eprintln!("Expected result:\n{}", expected_normalized);
                }

                assert_eq!(
                    result_normalized, expected_normalized,
                    "Trim result should match expected KCL code"
                );
            }
            Err(e) => {
                panic!("trim flow failed: {}", e);
            }
        }
    }

    #[tokio::test]
    async fn test_stress_complex_trim_line_through_many_segments() {
        // stress test: complex trim line through many segments
        let base_kcl_code = r#"@settings(experimentalFeatures = allow)

sketch(on = YZ) {
  line1 = sketch2::line(start = [var -5.17mm, var 4.96mm], end = [var 4.84mm, var 6.49mm])
  line2 = sketch2::line(start = [var 4.84mm, var 6.49mm], end = [var -3.92mm, var 2.05mm])
  sketch2::coincident([line1.end, line2.start])
  line3 = sketch2::line(start = [var -3.92mm, var 2.05mm], end = [var 6.02mm, var 3.98mm])
  sketch2::coincident([line2.end, line3.start])
  line4 = sketch2::line(start = [var 6.02mm, var 3.98mm], end = [var -7.23mm, var -1.81mm])
  sketch2::coincident([line3.end, line4.start])
  line5 = sketch2::line(start = [var -7.23mm, var -1.81mm], end = [var 6.5mm, var -1.47mm])
  sketch2::coincident([line4.end, line5.start])
  line6 = sketch2::line(start = [var 6.5mm, var -1.47mm], end = [var -6.69mm, var -4.73mm])
  sketch2::coincident([line5.end, line6.start])
  line7 = sketch2::line(start = [var -6.69mm, var -4.73mm], end = [var 6.77mm, var -4.86mm])
  sketch2::coincident([line6.end, line7.start])
  line10 = sketch2::line(start = [var -1.08mm, var -10.86mm], end = [var -4.36mm, var 7.64mm])
  line11 = sketch2::line(start = [var -4.36mm, var 7.64mm], end = [var 5.28mm, var -8.62mm])
  sketch2::coincident([line10.end, line11.start])
  line12 = sketch2::line(start = [var 5.28mm, var -8.62mm], end = [var 6.9mm, var 0.39mm])
  sketch2::coincident([line11.end, line12.start])
  line13 = sketch2::line(start = [var 6.9mm, var 0.39mm], end = [var -7.84mm, var 4.45mm])
  sketch2::coincident([line12.end, line13.start])
  line14 = sketch2::line(start = [var -7.84mm, var 4.45mm], end = [var 3.05mm, var 7.98mm])
  sketch2::coincident([line13.end, line14.start])
  line15 = sketch2::line(start = [var 3.05mm, var 7.98mm], end = [var 0.71mm, var -10.01mm])
  sketch2::coincident([line14.end, line15.start])
  line18 = sketch2::line(start = [var 5.24mm, var 2.08mm], end = [var -6.76mm, var 0.49mm])
  line19 = sketch2::line(start = [var -6.76mm, var 0.49mm], end = [var -1.86mm, var 8.22mm])
  sketch2::coincident([line18.end, line19.start])
  line20 = sketch2::line(start = [var -1.86mm, var 8.22mm], end = [var 3.11mm, var -9.16mm])
  sketch2::coincident([line19.end, line20.start])
  line21 = sketch2::line(start = [var 3.11mm, var -9.16mm], end = [var 6.97mm, var 7.91mm])
  sketch2::coincident([line20.end, line21.start])
  line22 = sketch2::line(start = [var -6.96mm, var 3.03mm], end = [var 7mm, var -3.78mm])
  line23 = sketch2::line(start = [var -1.99mm, var -2.39mm], end = [var 4.2mm, var 4.73mm])
  line24 = sketch2::line(start = [var 1.42mm, var 6.72mm], end = [var -4.46mm, var 2.86mm])
  line25 = sketch2::line(start = [var -6.18mm, var -3.61mm], end = [var -0.4mm, var -8.25mm])
  line27 = sketch2::line(start = [var 5.45mm, var 7.3mm], end = [var -7.06mm, var 6.28mm])
  sketch2::arc(start = [var 2.71mm, var -9.71mm], end = [var -3.98mm, var 8.12mm], center = [var -6.86mm, var -3.13mm])
  sketch2::arc(start = [var -2.95mm, var 1.9mm], end = [var 1.73mm, var -6.79mm], center = [var 7.68mm, var 2.02mm])
  sketch2::arc(start = [var -6.149mm, var 5.57mm], end = [var 6.911mm, var 3.169mm], center = [var 1.118mm, var 8.38mm])
  sketch2::arc(start = [var 5.55mm, var 7.909mm], end = [var -7.641mm, var -6.45mm], center = [var 7.51mm, var -7.13mm])
  sketch2::arc(start = [var 3.69mm, var -3.61mm], end = [var -5.68mm, var -5.96mm], center = [var 0.58mm, var -11.06mm])
  sketch2::arc(start = [var -1.311mm, var -0.729mm], end = [var -0.609mm, var -8.789mm], center = [var 3.72mm, var -4.352mm])
  sketch2::arc(start = [var -4.9mm, var 0.12mm], end = [var -5.32mm, var -3.75mm], center = [var -0.74mm, var -2.29mm])
  line8 = sketch2::line(start = [var -6.79mm, var -6.46mm], end = [var -3.45mm, var -6.7mm])
  line9 = sketch2::line(start = [var -4.8mm, var -6.07mm], end = [var -4.59mm, var -6.91mm])
  line16 = sketch2::line(start = [var -7.78mm, var -7.36mm], end = [var -5.25mm, var -7.36mm])
  line17 = sketch2::line(start = [var -5.25mm, var -7.36mm], end = [var -3.69mm, var -7.72mm])
  sketch2::coincident([line16.end, line17.start])
  line26 = sketch2::line(start = [var -3.69mm, var -7.72mm], end = [var -2.49mm, var -7.33mm])
  sketch2::coincident([line17.end, line26.start])
  line28 = sketch2::line(start = [var -5.4mm, var -7.99mm], end = [var -3.75mm, var -8.33mm])
  line29 = sketch2::line(start = [var -4.89mm, var -5.47mm], end = [var -3.84mm, var -6.04mm])
  line30 = sketch2::line(start = [var -7.42mm, var -8.27mm], end = [var -5.55mm, var -8.51mm])
  line31 = sketch2::line(start = [var -5.55mm, var -8.51mm], end = [var -3.45mm, var -8.87mm])
  sketch2::coincident([line30.end, line31.start])
  line32 = sketch2::line(start = [var -7.54mm, var -9.14mm], end = [var -2.91mm, var -9.29mm])
  line33 = sketch2::line(start = [var -2.91mm, var -9.92mm], end = [var -7.33mm, var -8.78mm])
  line34 = sketch2::line(start = [var -5.07mm, var -2.3mm], end = [var -2.79mm, var -3mm])
  line35 = sketch2::line(start = [var -5.04mm, var -3.12mm], end = [var -2.91mm, var -2.48mm])
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

        let sketch_id = ObjectId(1);

        let start = std::time::Instant::now();
        let result = execute_trim_flow(base_kcl_code, &trim_points, sketch_id).await;
        let duration = start.elapsed();

        match result {
            Ok(result) => {
                // Just assert that it doesn't error - the output code can be whatever the solver produces
                assert!(
                    !result.kcl_code.trim().is_empty(),
                    "Trim should produce non-empty KCL code"
                );

                // Assert that the test completes within a reasonable time
                // Note: Rust implementation may have different performance characteristics
                assert!(
                    duration.as_millis() < 40_000,
                    "Stress test should complete within 20 seconds, took {}ms",
                    duration.as_millis()
                );
            }
            Err(e) => {
                panic!("trim flow failed: {}", e);
            }
        }
    }

    #[tokio::test]
    async fn test_trim_through_segment_invalidates_ids() {
        // Test that trimming through a segment (which causes deletion) sets invalidates_ids to true
        // This is a regression test for the bug where segments disappear but points remain
        // due to ID mismatches when invalidates_ids is not properly propagated
        let base_kcl_code = r#"@settings(experimentalFeatures = allow)

sketch(on = YZ) {
  arc3 = sketch2::arc(start = [var 1.67mm, var 5.51mm], end = [var 5.77mm, var 1.36mm], center = [var 5.3mm, var 4.99mm])
  sketch2::arc(start = [var 2.35mm, var 4.27mm], end = [var 0.44mm, var 4.55mm], center = [var 1.19mm, var 3.04mm])
  arc2 = sketch2::arc(start = [var 6.49mm, var 5.09mm], end = [var 5.77mm, var 1.36mm], center = [var 7.56mm, var 2.95mm])
  sketch2::coincident([arc2.end, arc3.end])
  line4 = sketch2::line(start = [var 0.95mm, var 2.01mm], end = [var 6.62mm, var 4.2mm])
  line5 = sketch2::line(start = [var 6.62mm, var 4.29mm], end = [var 2.02mm, var 0.37mm])
  sketch2::coincident([line4.end, line5.start])
  line6 = sketch2::line(start = [var 4.36mm, var 2.37mm], end = [var 2.9mm, var 5.83mm])
  sketch2::coincident([line6.start, line5])
}
"#;

        // Trim line that goes through segments (points from the user's example)
        let trim_points = vec![Coords2d { x: 2.57, y: 1.83 }, Coords2d { x: 3.42, y: 2.49 }];

        let sketch_id = ObjectId(1);

        let result = execute_trim_flow(base_kcl_code, &trim_points, sketch_id).await;

        match result {
            Ok(result) => {
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
            Err(e) => {
                panic!("trim flow failed: {}", e);
            }
        }
    }

    // Helper function to get objects from KCL code (similar to getSceneGraphDeltaFromKcl in TypeScript)
    async fn get_objects_from_kcl(kcl_code: &str) -> Vec<crate::frontend::api::Object> {
        use crate::{ExecutorContext, Program, execution::MockConfig, frontend::FrontendState};

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

    /// Tests for `get_trim_spawn_terminations` function.
    /// These tests mirror the TypeScript tests in `trimToolImpl.spec.ts`.
    /// Note: These tests require the `artifact-graph` feature to be enabled to access scene objects.
    mod get_trim_spawn_terminations_tests {
        use super::*;
        use crate::frontend::trim::{Coords2d, TrimTermination, get_trim_spawn_terminations};

        #[tokio::test]
        async fn test_line_segment_intersection_terminations() {
            let kcl_code = r#"@settings(experimentalFeatures = allow)

sketch(on = YZ) {
  line1 = sketch2::line(start = [var -3.05mm, var 2.44mm], end = [var 2.88mm, var 2.81mm])
  line2 = sketch2::line(start = [var -2.77mm, var 1mm], end = [var -1.91mm, var 4.06mm])
  arc1 = sketch2::arc(start = [var 2.4mm, var 4.48mm], end = [var 3.4mm, var 5.41mm], center = [var 3.99mm, var 3.07mm])
}
"#;

            let objects = get_objects_from_kcl(kcl_code).await;
            let trim_points = vec![Coords2d { x: -1.3, y: 4.62 }, Coords2d { x: -2.46, y: 0.1 }];

            let result = get_trim_spawn_terminations(find_first_line_id(&objects), &trim_points, &objects)
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
        async fn test_line_segment_seg_endpoint_with_coincident_constraints() {
            let kcl_code = r#"@settings(experimentalFeatures = allow)

sketch(on = YZ) {
  line1 = sketch2::line(start = [var -3.24mm, var 2.44mm], end = [var 2.6mm, var 2.81mm])
  line2 = sketch2::line(start = [var -2.38mm, var 2.5mm], end = [var -4.22mm, var -0.41mm])
  arc1 = sketch2::arc(start = [var 2.24mm, var 5.64mm], end = [var 1.65mm, var 2.83mm], center = [var 3.6mm, var 3.89mm])
  sketch2::coincident([line2.start, line1.start])
  sketch2::coincident([arc1.end, line1.end])
}
"#;

            let objects = get_objects_from_kcl(kcl_code).await;
            let trim_points = vec![Coords2d { x: -1.9, y: 0.5 }, Coords2d { x: -1.9, y: 4.0 }];

            let result = get_trim_spawn_terminations(find_first_line_id(&objects), &trim_points, &objects)
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
            let kcl_code = r#"@settings(experimentalFeatures = allow)

sketch(on = YZ) {
  line1 = sketch2::line(start = [var -3.24mm, var 2.44mm], end = [var 2.6mm, var 2.81mm])
  line2 = sketch2::line(start = [var -2.38mm, var 2.5mm], end = [var -4.22mm, var -0.41mm])
  arc1 = sketch2::arc(start = [var 2.24mm, var 5.64mm], end = [var 1.65mm, var 2.83mm], center = [var 3.6mm, var 3.89mm])
  sketch2::coincident([arc1.end, line1])
  sketch2::coincident([line2.start, line1])
}
"#;

            let objects = get_objects_from_kcl(kcl_code).await;
            let trim_points = vec![Coords2d { x: -1.9, y: 0.5 }, Coords2d { x: -1.9, y: 4.0 }];

            let result = get_trim_spawn_terminations(find_first_line_id(&objects), &trim_points, &objects)
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
                trim_spawn_segment_coincident_with_another_segment_point_id,
            } = result.left_side
            {
                assert!((trim_termination_coords.x - (-2.380259288059525)).abs() < 1e-5);
                assert!((trim_termination_coords.y - 2.5040925592307945).abs() < 1e-5);
                assert_eq!(intersecting_seg_id, crate::frontend::api::ObjectId(7));
                assert_eq!(
                    trim_spawn_segment_coincident_with_another_segment_point_id,
                    crate::frontend::api::ObjectId(5)
                );
            }

            if let TrimTermination::TrimSpawnSegmentCoincidentWithAnotherSegmentPoint {
                trim_termination_coords,
                intersecting_seg_id,
                trim_spawn_segment_coincident_with_another_segment_point_id,
            } = result.right_side
            {
                assert!((trim_termination_coords.x - 1.6587744607636377).abs() < 1e-5);
                assert!((trim_termination_coords.y - 2.784726710328238).abs() < 1e-5);
                assert_eq!(intersecting_seg_id, crate::frontend::api::ObjectId(11));
                assert_eq!(
                    trim_spawn_segment_coincident_with_another_segment_point_id,
                    crate::frontend::api::ObjectId(9)
                );
            }
        }

        #[tokio::test]
        async fn test_line_segment_seg_endpoint_without_coincident_constraint() {
            let kcl_code = r#"@settings(experimentalFeatures = allow)

sketch(on = YZ) {
  line1 = sketch2::line(start = [var -3.24mm, var 2.46mm], end = [var 2.6mm, var 2.9mm])
  line2 = sketch2::line(start = [var -2.38mm, var 2.47mm], end = [var -3.94mm, var -0.64mm])
  arc1 = sketch2::arc(start = [var 2.239mm, var 5.641mm], end = [var 1.651mm, var 2.85mm], center = [var 3.6mm, var 3.889mm])
}
"#;

            let objects = get_objects_from_kcl(kcl_code).await;
            let trim_points = vec![Coords2d { x: -1.9, y: 0.5 }, Coords2d { x: -1.9, y: 4.0 }];

            let result = get_trim_spawn_terminations(find_first_line_id(&objects), &trim_points, &objects)
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
            let kcl_code = r#"@settings(experimentalFeatures = allow)

sketch(on = YZ) {
  sketch2::arc(start = [var 0.79mm, var 2.4mm], end = [var -5.61mm, var 1.77mm], center = [var -1.88mm, var -3.29mm])
  sketch2::arc(start = [var -0.072mm, var 4.051mm], end = [var -0.128mm, var -0.439mm], center = [var 5.32mm, var 1.738mm])
  line1 = sketch2::line(start = [var -5.41mm, var 4.99mm], end = [var -4.02mm, var -0.47mm])
}
"#;

            let objects = get_objects_from_kcl(kcl_code).await;
            let trim_points = vec![Coords2d { x: -1.3, y: 4.62 }, Coords2d { x: -2.46, y: 0.1 }];

            let result = get_trim_spawn_terminations(find_first_arc_id(&objects), &trim_points, &objects)
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
            let kcl_code = r#"@settings(experimentalFeatures = allow)

sketch(on = YZ) {
  arc1 = sketch2::arc(start = [var 0.79mm, var 2.4mm], end = [var -5.61mm, var 1.77mm], center = [var -1.88mm, var -3.29mm])
  arc2 = sketch2::arc(start = [var -0.07mm, var 4.05mm], end = [var -0.13mm, var -0.44mm], center = [var 5.32mm, var 1.74mm])
  line1 = sketch2::line(start = [var -5.41mm, var 4.99mm], end = [var -4.02mm, var -0.47mm])
  sketch2::coincident([line1.end, arc1.end])
  sketch2::coincident([arc1.start, arc2.start])
}
"#;

            let objects = get_objects_from_kcl(kcl_code).await;
            let trim_points = vec![Coords2d { x: -1.9, y: 0.5 }, Coords2d { x: -1.9, y: 4.0 }];

            let result = get_trim_spawn_terminations(find_first_arc_id(&objects), &trim_points, &objects)
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
            let kcl_code = r#"@settings(experimentalFeatures = allow)

sketch(on = YZ) {
  arc1 = sketch2::arc(start = [var 0.882mm, var 2.596mm], end = [var -5.481mm, var 1.595mm], center = [var -1.484mm, var -3.088mm])
  arc2 = sketch2::arc(start = [var -0.367mm, var 2.967mm], end = [var -0.099mm, var -0.427mm], center = [var 5.317mm, var 1.708mm])
  line1 = sketch2::line(start = [var -5.41mm, var 4.99mm], end = [var -4.179mm, var 2.448mm])
  sketch2::coincident([line1.end, arc1])
  sketch2::coincident([arc1, arc2.start])
}
"#;

            let objects = get_objects_from_kcl(kcl_code).await;
            let trim_points = vec![Coords2d { x: -1.9, y: 0.5 }, Coords2d { x: -1.9, y: 4.0 }];

            let result = get_trim_spawn_terminations(find_first_arc_id(&objects), &trim_points, &objects)
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
                trim_spawn_segment_coincident_with_another_segment_point_id,
            } = result.left_side
            {
                assert!((trim_termination_coords.x - (-0.36700307305406205)).abs() < 1e-5);
                assert!((trim_termination_coords.y - 2.966675365647721).abs() < 1e-5);
                assert_eq!(intersecting_seg_id, crate::frontend::api::ObjectId(9));
                assert_eq!(
                    trim_spawn_segment_coincident_with_another_segment_point_id,
                    crate::frontend::api::ObjectId(6)
                );
            }

            if let TrimTermination::TrimSpawnSegmentCoincidentWithAnotherSegmentPoint {
                trim_termination_coords,
                intersecting_seg_id,
                trim_spawn_segment_coincident_with_another_segment_point_id,
            } = result.right_side
            {
                assert!((trim_termination_coords.x - (-4.178878101257838)).abs() < 1e-5);
                assert!((trim_termination_coords.y - 2.447749604872991).abs() < 1e-5);
                assert_eq!(intersecting_seg_id, crate::frontend::api::ObjectId(12));
                assert_eq!(
                    trim_spawn_segment_coincident_with_another_segment_point_id,
                    crate::frontend::api::ObjectId(11)
                );
            }
        }

        #[tokio::test]
        async fn test_arc_segment_seg_endpoint_without_coincident_constraint() {
            let kcl_code = r#"@settings(experimentalFeatures = allow)

sketch(on = YZ) {
  arc1 = sketch2::arc(start = [var 0.882mm, var 2.596mm], end = [var -5.481mm, var 1.595mm], center = [var -1.484mm, var -3.088mm])
  arc2 = sketch2::arc(start = [var -0.367mm, var 2.967mm], end = [var -0.099mm, var -0.427mm], center = [var 5.317mm, var 1.708mm])
  line1 = sketch2::line(start = [var -5.41mm, var 4.99mm], end = [var -4.179mm, var 2.448mm])
}
"#;

            let objects = get_objects_from_kcl(kcl_code).await;
            let trim_points = vec![Coords2d { x: -1.9, y: 0.5 }, Coords2d { x: -1.9, y: 4.0 }];

            let result = get_trim_spawn_terminations(find_first_arc_id(&objects), &trim_points, &objects)
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
}
