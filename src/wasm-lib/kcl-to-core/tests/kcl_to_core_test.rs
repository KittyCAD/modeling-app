use kcl_to_core::*;

#[tokio::test]
async fn kcl_to_core_test() {
    let result = kcl_to_engine_core(
        r#"
        const part001 = startSketchOn('XY')
            |> startProfileAt([11.19, 28.35], %)
            |> line([28.67, -13.25], %, $here)
            |> line([-4.12, -22.81], %)
            |> line([-33.24, 14.55], %)
            |> close(%)
            |> extrude(5, %)
    "#,
    )
    .await;

    assert!(result.is_ok());
}
