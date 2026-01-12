#[cfg(test)]
mod tests {
    use crate::frontend::api::ObjectId;
    use crate::frontend::trim::{Coords2d, execute_trim_flow};

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

        let sketch_id = ObjectId(0);

        let result = execute_trim_flow(base_kcl_code, &trim_points, sketch_id).await;

        match result {
            Ok(kcl_code) => {
                let expected_code = r#"@settings(experimentalFeatures = allow)

sketch(on = YZ) {
  line1 = sketch2::line(start = [var 0mm, var 5mm], end = [var 0mm, var -5mm])
  line2 = sketch2::line(start = [var 5mm, var 0mm], end = [var 0mm, var 0mm])
  sketch2::coincident([line2.end, line1])
}
"#;

                // Normalize both strings for comparison (trim whitespace)
                let result_normalized = kcl_code.trim();
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
}
