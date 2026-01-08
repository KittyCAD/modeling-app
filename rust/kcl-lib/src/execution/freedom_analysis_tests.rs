#[cfg(test)]
#[cfg(feature = "artifact-graph")]
mod test {
    use std::sync::Arc;

    use crate::{
        ExecutorContext, ExecutorSettings,
        execution::{ContextType, MockConfig},
        front::{Freedom, ObjectKind},
        frontend::api::ObjectId,
        engine::conn_mock::EngineConnection,
    };

    async fn run_with_freedom_analysis(kcl: &str) -> Vec<(ObjectId, Freedom)> {
        let program = crate::Program::parse_no_errs(kcl).unwrap();

        let exec_ctxt = ExecutorContext {
            engine: Arc::new(Box::new(EngineConnection::new().unwrap())),
            fs: Arc::new(crate::fs::FileManager::new()),
            settings: ExecutorSettings::default(),
            context_type: ContextType::Mock,
        };

        let mock_config = MockConfig {
            freedom_analysis: true,
            ..Default::default()
        };

        let outcome = exec_ctxt.run_mock(&program, &mock_config).await.unwrap();

        let mut point_freedoms = Vec::new();
        for obj in &outcome.scene_objects {
            if let ObjectKind::Segment {
                segment: crate::front::Segment::Point(point),
            } = &obj.kind
            {
                point_freedoms.push((obj.id, point.freedom));
            }
        }
        // Sort by object ID for consistent ordering
        point_freedoms.sort_by_key(|(id, _)| id.0);
        point_freedoms
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn test_freedom_analysis_with_conflicts() {
        let kcl = r#"
@settings(experimentalFeatures = allow)

sketch(on = YZ) {
  line1 = sketch2::line(start = [var 2mm, var 8mm], end = [var 5mm, var 7mm])
line1.start.at[0] == 2
line1.start.at[1] == 8
line1.end.at[0] == 5
line1.end.at[1] == 7


  line2 = sketch2::line(start = [var 2mm, var 1mm], end = [var -4.75mm, var -0.88mm])
line2.start.at[0] == 2
line2.start.at[1] == 1

  line3 = sketch2::line(start = [var -2.591mm, var -7.081mm], end = [var 1.331mm, var -3.979mm])
sketch2::distance([line3.start, line3.end]) == 4mm
sketch2::distance([line3.start, line3.end]) == 6mm
}
"#;

        let point_freedoms = run_with_freedom_analysis(kcl).await;

        // Expected: line1 has both ends constrained -> Fixed, Fixed
        //           line2 has one end constrained -> Fixed, Free (but currently shows Fixed, Conflict - bug)
        //           line3 has conflicting distance constraints -> Conflict, Conflict (but currently shows Free, Free - bug)
        // Note: IDs skip every third because segments don't get freedom values
        // Format: (ObjectId, Freedom)
        
        println!("Point freedoms: {:?}", point_freedoms);
        
        // Expected after bug fix:
        // - line1.start (ObjectId(1)) and line1.end (ObjectId(2)): both Fixed
        // - line2.start (ObjectId(4)): Fixed, line2.end (ObjectId(5)): Free
        // - line3.start (ObjectId(7)) and line3.end (ObjectId(8)): both Conflict
        let expected = vec![
            (ObjectId(1), Freedom::Fixed),  // line1.start
            (ObjectId(2), Freedom::Fixed),    // line1.end
            (ObjectId(4), Freedom::Fixed),   // line2.start
            (ObjectId(5), Freedom::Free),     // line2.end (currently bug shows Conflict)
            (ObjectId(7), Freedom::Conflict),  // line3.start (currently bug shows Free)
            (ObjectId(8), Freedom::Conflict), // line3.end (currently bug shows Free)
        ];
        
        // This assertion will fail until the bug is fixed
        assert_eq!(
            point_freedoms, expected,
            "Point freedoms should match expected values. Current behavior shows bugs with conflicts and reordered lines."
        );
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn test_freedom_analysis_without_conflicts() {
        let kcl = r#"
@settings(experimentalFeatures = allow)

sketch(on = YZ) {
  line1 = sketch2::line(start = [var 2mm, var 8mm], end = [var 5mm, var 7mm])
line1.start.at[0] == 2
line1.start.at[1] == 8
line1.end.at[0] == 5
line1.end.at[1] == 7


  line2 = sketch2::line(start = [var 2mm, var 1mm], end = [var -4.75mm, var -0.88mm])
line2.start.at[0] == 2
line2.start.at[1] == 1

  line3 = sketch2::line(start = [var -2.591mm, var -7.081mm], end = [var 1.331mm, var -3.979mm])
sketch2::distance([line3.start, line3.end]) == 4mm
}
"#;

        let point_freedoms = run_with_freedom_analysis(kcl).await;

        // Expected: line1 has both ends constrained -> Fixed, Fixed
        //           line2 has one end constrained -> Fixed, Free
        //           line3 has one distance constraint -> Free, Free (both points can move)
        
        println!("Point freedoms: {:?}", point_freedoms);
        
        // Expected: Fixed, Fixed, Fixed, Free, Free, Free
        // This case works correctly according to user
        let expected = vec![
            (ObjectId(1), Freedom::Fixed),
            (ObjectId(2), Freedom::Fixed),
            (ObjectId(4), Freedom::Fixed),
            (ObjectId(5), Freedom::Free),
            (ObjectId(7), Freedom::Free),
            (ObjectId(8), Freedom::Free),
        ];
        
        assert_eq!(point_freedoms, expected, "Point freedoms should match expected values");
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn test_freedom_analysis_reordered_lines() {
        let kcl = r#"
@settings(experimentalFeatures = allow)

sketch(on = YZ) {
  line1 = sketch2::line(start = [var 2mm, var 8mm], end = [var 5mm, var 7mm])
line1.start.at[0] == 2
line1.start.at[1] == 8
line1.end.at[0] == 5
line1.end.at[1] == 7

  line3 = sketch2::line(start = [var -2.591mm, var -7.081mm], end = [var 1.331mm, var -3.979mm])
sketch2::distance([line3.start, line3.end]) == 4mm
sketch2::distance([line3.start, line3.end]) == 6mm

  line2 = sketch2::line(start = [var 2mm, var 1mm], end = [var -4.75mm, var -0.88mm])
line2.start.at[0] == 2
line2.start.at[1] == 1

}
"#;

        let point_freedoms = run_with_freedom_analysis(kcl).await;

        // Expected: line1 has both ends constrained -> Fixed, Fixed
        //           line3 has conflicting distance constraints -> Conflict, Conflict (but bug shows one Conflict, one Free)
        //           line2 has one end constrained -> Fixed, Free
        
        println!("Point freedoms: {:?}", point_freedoms);
        
        // Expected after bug fix:
        // - line1.start (ObjectId(1)) and line1.end (ObjectId(2)): both Fixed
        // - line3.start (ObjectId(4)) and line3.end (ObjectId(5)): both Conflict (currently bug shows one Conflict, one Free)
        // - line2.start (ObjectId(9)): Fixed, line2.end (ObjectId(10)): Free
        // Note: IDs are different when lines are reordered because constraints get different IDs
        let expected = vec![
            (ObjectId(1), Freedom::Fixed),   // line1.start
            (ObjectId(2), Freedom::Fixed),   // line1.end
            (ObjectId(4), Freedom::Conflict), // line3.start (currently bug shows Conflict)
            (ObjectId(5), Freedom::Conflict),   // line3.end (currently bug shows Free)
            (ObjectId(9), Freedom::Fixed),    // line2.start
            (ObjectId(10), Freedom::Free),    // line2.end
        ];
        
        // This assertion will fail until the bug is fixed
        assert_eq!(
            point_freedoms, expected,
            "Point freedoms should match expected values. Current behavior shows bug where line3.end is Free instead of Conflict."
        );
    }
}

