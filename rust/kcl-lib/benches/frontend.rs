use std::hint::black_box;

use criterion::Criterion;
use criterion::criterion_group;
use criterion::criterion_main;
use kcl_lib::ExecutorContext;
use kcl_lib::Program;
use kcl_lib::front::ExistingSegmentCtor;
use kcl_lib::front::Expr;
use kcl_lib::front::FrontendState;
use kcl_lib::front::Number;
use kcl_lib::front::Point2d;
use kcl_lib::front::PointCtor;
use kcl_lib::front::SegmentCtor;
use kcl_lib::front::SketchApi;
use kcl_lib::front::Version;
use kcl_lib::pretty::NumericSuffix;

fn bench_edit_segments(c: &mut Criterion) {
    c.bench_function(&"bench_edit_segment".to_string(), move |b| {
        let rt = tokio::runtime::Runtime::new().unwrap();
        let (mut frontend, mock_ctx, version, sketch_id, segments) = rt.block_on(async {
            let mut frontend = FrontendState::new();
            let ctx = ExecutorContext::new_with_default_client().await.unwrap();
            let mock_ctx = ExecutorContext::new_mock(None).await;
            let version = Version(0);
            let source = include_str!("../tests/inputs/lots_of_segments.kcl");
            let program = Program::parse(source).unwrap().0.unwrap();
            let outcome = frontend.hack_set_program(&ctx, program).await.unwrap();
            match outcome {
                kcl_lib::front::SetProgramOutcome::Success {
                    scene_graph: _,
                    exec_outcome: _,
                } => {}
                kcl_lib::front::SetProgramOutcome::ExecFailure { error } => panic!("{}", error.to_string()),
            };

            // Add a point.
            let point_ctor = PointCtor {
                position: Point2d {
                    x: Expr::Number(Number {
                        value: 1.0,
                        units: NumericSuffix::Inch,
                    }),
                    y: Expr::Number(Number {
                        value: 2.0,
                        units: NumericSuffix::Inch,
                    }),
                },
            };
            let segment = SegmentCtor::Point(point_ctor.clone());
            let sketch_id = kcl_lib::front::ObjectId(1);
            let (_, scene_delta) = frontend
                .add_segment(&mock_ctx, version, sketch_id, segment, None)
                .await
                .unwrap();
            let point_id = *scene_delta.new_objects.last().unwrap();

            let segments = vec![ExistingSegmentCtor {
                id: point_id,
                ctor: SegmentCtor::Point(point_ctor),
            }];
            ctx.close().await;
            (frontend, mock_ctx, version, sketch_id, segments)
        });
        b.iter(|| {
            if let Err(err) = rt.block_on(async {
                let _outcome = black_box(
                    frontend
                        .edit_segments(&mock_ctx, version, sketch_id, segments.clone())
                        .await
                        .unwrap(),
                );
                mock_ctx.close().await;
                Ok::<(), anyhow::Error>(())
            }) {
                panic!("Failed to execute program: {err}");
            }
        })
    });
}

criterion_group!(benches, bench_edit_segments);
criterion_main!(benches);
