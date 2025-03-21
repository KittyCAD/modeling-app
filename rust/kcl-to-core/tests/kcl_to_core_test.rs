use kcl_to_core::*;

#[tokio::test]
async fn kcl_to_core_test() {
    let result = kcl_to_engine_core(
        r#"
        part001 = startSketchOn('XY')
            |> startProfileAt([11.19, 28.35], %)
            |> line(end = [28.67, -13.25], tag = $here)
            |> line(end = [-4.12, -22.81])
            |> line(end = [-33.24, 14.55])
            |> close()
            |> extrude(length = 5)
    "#,
    )
    .await;

    result.unwrap();
}
