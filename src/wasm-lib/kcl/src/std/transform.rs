//! Standard library transforms.

use anyhow::Result;
use derive_docs::stdlib;
use kcmc::{
    each_cmd as mcmd,
    length_unit::LengthUnit,
    shared,
    shared::{Point3d, Point4d},
    ModelingCmd,
};
use kittycad_modeling_cmds as kcmc;

use crate::{
    errors::{KclError, KclErrorDetails},
    execution::{ExecState, KclValue, Solid},
    std::Args,
};

/// Scale a solid.
pub async fn scale(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let solid = args.get_unlabeled_kw_arg("solid")?;
    let scale = args.get_kw_arg("scale")?;
    let global = args.get_kw_arg_opt("global")?;

    let solid = inner_scale(solid, scale, global, exec_state, args).await?;
    Ok(KclValue::Solid { value: solid })
}

/// Scale a solid.
///
/// By default the transform is applied in local sketch axis, therefore the origin will not move.
///
/// If you want to apply the transform in global space, set `global` to `true`. The origin of the
/// model will move. If the model is not centered on origin and you scale globally it will
/// look like the model moves and gets bigger at the same time. Say you have a square
/// `(1,1) - (1,2) - (2,2) - (2,1)` and you scale by 2 globally it will become
/// `(2,2) - (2,4)`...etc so the origin has moved from `(1.5, 1.5)` to `(2,2)`.
///
/// ```no_run
/// // Scale a pipe.
///
/// // Create a path for the sweep.
/// sweepPath = startSketchOn('XZ')
///     |> startProfileAt([0.05, 0.05], %)
///     |> line(end = [0, 7])
///     |> tangentialArc({
///         offset: 90,
///         radius: 5
///     }, %)
///     |> line(end = [-3, 0])
///     |> tangentialArc({
///         offset: -90,
///         radius: 5
///     }, %)
///     |> line(end = [0, 7])
///
/// // Create a hole for the pipe.
/// pipeHole = startSketchOn('XY')
///     |> circle({
///         center = [0, 0],
///         radius = 1.5,
///     }, %)
///
/// sweepSketch = startSketchOn('XY')
///     |> circle({
///         center = [0, 0],
///         radius = 2,
///         }, %)              
///     |> hole(pipeHole, %)
///     |> sweep(path = sweepPath)   
///     |> scale(
///     scale = [1.0, 1.0, 2.5],
///     )
/// ```
#[stdlib {
    name = "scale",
    feature_tree_operation = false,
    keywords = true,
    unlabeled_first = true,
    args = {
        solid = {docs = "The solid to scale."},
        scale = {docs = "The scale factor for the x, y, and z axes."},
        global = {docs = "If true, the transform is applied in global space. The origin of the model will move. By default, the transform is applied in local sketch axis, therefore the origin will not move."}
    }
}]
async fn inner_scale(
    solid: Box<Solid>,
    scale: [f64; 3],
    global: Option<bool>,
    exec_state: &mut ExecState,
    args: Args,
) -> Result<Box<Solid>, KclError> {
    let id = exec_state.next_uuid();

    args.batch_modeling_cmd(
        id,
        ModelingCmd::from(mcmd::SetObjectTransform {
            object_id: solid.id,
            transforms: vec![shared::ComponentTransform {
                scale: Some(shared::TransformBy::<Point3d<f64>> {
                    property: Point3d {
                        x: scale[0],
                        y: scale[1],
                        z: scale[2],
                    },
                    set: false,
                    is_local: !global.unwrap_or(false),
                }),
                translate: None,
                rotate_rpy: None,
                rotate_angle_axis: None,
            }],
        }),
    )
    .await?;

    Ok(solid)
}

/// Move a solid.
pub async fn translate(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let solid = args.get_unlabeled_kw_arg("solid")?;
    let translate = args.get_kw_arg("translate")?;
    let global = args.get_kw_arg_opt("global")?;

    let solid = inner_translate(solid, translate, global, exec_state, args).await?;
    Ok(KclValue::Solid { value: solid })
}

/// Move a solid.
///
/// ```no_run
/// // Move a pipe.
///
/// // Create a path for the sweep.
/// sweepPath = startSketchOn('XZ')
///     |> startProfileAt([0.05, 0.05], %)
///     |> line(end = [0, 7])
///     |> tangentialArc({
///         offset: 90,
///         radius: 5
///     }, %)
///     |> line(end = [-3, 0])
///     |> tangentialArc({
///         offset: -90,
///         radius: 5
///     }, %)
///     |> line(end = [0, 7])
///
/// // Create a hole for the pipe.
/// pipeHole = startSketchOn('XY')
///     |> circle({
///         center = [0, 0],
///         radius = 1.5,
///     }, %)
///
/// sweepSketch = startSketchOn('XY')
///     |> circle({
///         center = [0, 0],
///         radius = 2,
///         }, %)              
///     |> hole(pipeHole, %)
///     |> sweep(path = sweepPath)   
///     |> translate(
///     translate = [1.0, 1.0, 2.5],
///     )
/// ```
#[stdlib {
    name = "translate",
    feature_tree_operation = false,
    keywords = true,
    unlabeled_first = true,
    args = {
        solid = {docs = "The solid to move."},
        translate = {docs = "The amount to move the solid in all three axes."},
        global = {docs = "If true, the transform is applied in global space. The origin of the model will move. By default, the transform is applied in local sketch axis, therefore the origin will not move."}
    }
}]
async fn inner_translate(
    solid: Box<Solid>,
    translate: [f64; 3],
    global: Option<bool>,
    exec_state: &mut ExecState,
    args: Args,
) -> Result<Box<Solid>, KclError> {
    let id = exec_state.next_uuid();

    args.batch_modeling_cmd(
        id,
        ModelingCmd::from(mcmd::SetObjectTransform {
            object_id: solid.id,
            transforms: vec![shared::ComponentTransform {
                translate: Some(shared::TransformBy::<Point3d<LengthUnit>> {
                    property: shared::Point3d {
                        x: LengthUnit(translate[0]),
                        y: LengthUnit(translate[1]),
                        z: LengthUnit(translate[2]),
                    },
                    set: false,
                    is_local: !global.unwrap_or(false),
                }),
                scale: None,
                rotate_rpy: None,
                rotate_angle_axis: None,
            }],
        }),
    )
    .await?;

    Ok(solid)
}

/// Rotate a solid.
pub async fn rotate(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let solid = args.get_unlabeled_kw_arg("solid")?;
    let roll = args.get_kw_arg_opt("roll")?;
    let pitch = args.get_kw_arg_opt("pitch")?;
    let yaw = args.get_kw_arg_opt("yaw")?;
    let axis = args.get_kw_arg_opt("axis")?;
    let angle = args.get_kw_arg_opt("angle")?;
    let global = args.get_kw_arg_opt("global")?;

    // Check if no rotation values are provided.
    if roll.is_none() && pitch.is_none() && yaw.is_none() && axis.is_none() && angle.is_none() {
        return Err(KclError::Semantic(KclErrorDetails {
            message: "Expected `roll`, `pitch`, and `yaw` or `axis` and `angle` to be provided.".to_string(),
            source_ranges: vec![args.source_range],
        }));
    }

    // If they give us a roll, pitch, or yaw, they must give us all three.
    if roll.is_some() || pitch.is_some() || yaw.is_some() {
        if roll.is_none() {
            return Err(KclError::Semantic(KclErrorDetails {
                message: "Expected `roll` to be provided when `pitch` or `yaw` is provided.".to_string(),
                source_ranges: vec![args.source_range],
            }));
        }
        if pitch.is_none() {
            return Err(KclError::Semantic(KclErrorDetails {
                message: "Expected `pitch` to be provided when `roll` or `yaw` is provided.".to_string(),
                source_ranges: vec![args.source_range],
            }));
        }
        if yaw.is_none() {
            return Err(KclError::Semantic(KclErrorDetails {
                message: "Expected `yaw` to be provided when `roll` or `pitch` is provided.".to_string(),
                source_ranges: vec![args.source_range],
            }));
        }

        // Ensure they didn't also provide an axis or angle.
        if axis.is_some() || angle.is_some() {
            return Err(KclError::Semantic(KclErrorDetails {
                message: "Expected `axis` and `angle` to not be provided when `roll`, `pitch`, and `yaw` are provided."
                    .to_string(),
                source_ranges: vec![args.source_range],
            }));
        }
    }

    // If they give us an axis or angle, they must give us both.
    if axis.is_some() || angle.is_some() {
        if axis.is_none() {
            return Err(KclError::Semantic(KclErrorDetails {
                message: "Expected `axis` to be provided when `angle` is provided.".to_string(),
                source_ranges: vec![args.source_range],
            }));
        }
        if angle.is_none() {
            return Err(KclError::Semantic(KclErrorDetails {
                message: "Expected `angle` to be provided when `axis` is provided.".to_string(),
                source_ranges: vec![args.source_range],
            }));
        }

        // Ensure they didn't also provide a roll, pitch, or yaw.
        if roll.is_some() || pitch.is_some() || yaw.is_some() {
            return Err(KclError::Semantic(KclErrorDetails {
                message: "Expected `roll`, `pitch`, and `yaw` to not be provided when `axis` and `angle` are provided."
                    .to_string(),
                source_ranges: vec![args.source_range],
            }));
        }
    }

    // Validate the roll, pitch, and yaw values.
    if let Some(roll) = roll {
        if !(-360.0..=360.0).contains(&roll) {
            return Err(KclError::Semantic(KclErrorDetails {
                message: format!("Expected roll to be between -360 and 360, found `{}`", roll),
                source_ranges: vec![args.source_range],
            }));
        }
    }
    if let Some(pitch) = pitch {
        if !(-360.0..=360.0).contains(&pitch) {
            return Err(KclError::Semantic(KclErrorDetails {
                message: format!("Expected pitch to be between -360 and 360, found `{}`", pitch),
                source_ranges: vec![args.source_range],
            }));
        }
    }
    if let Some(yaw) = yaw {
        if !(-360.0..=360.0).contains(&yaw) {
            return Err(KclError::Semantic(KclErrorDetails {
                message: format!("Expected yaw to be between -360 and 360, found `{}`", yaw),
                source_ranges: vec![args.source_range],
            }));
        }
    }

    // Validate the axis and angle values.
    if let Some(angle) = angle {
        if !(-360.0..=360.0).contains(&angle) {
            return Err(KclError::Semantic(KclErrorDetails {
                message: format!("Expected angle to be between -360 and 360, found `{}`", angle),
                source_ranges: vec![args.source_range],
            }));
        }
    }

    let solid = inner_rotate(solid, roll, pitch, yaw, axis, angle, global, exec_state, args).await?;
    Ok(KclValue::Solid { value: solid })
}

/// Rotate a solid.
///
/// ### Using Roll, Pitch, and Yaw
///
/// When rotating a part in 3D space, "roll," "pitch," and "yaw" refer to the
/// three rotational axes used to describe its orientation: roll is rotation
/// around the longitudinal axis (front-to-back), pitch is rotation around the
/// lateral axis (wing-to-wing), and yaw is rotation around the vertical axis
/// (up-down); essentially, it's like tilting the part on its side (roll),
/// tipping the nose up or down (pitch), and turning it left or right (yaw).
///
/// So, in the context of a 3D model:
///
/// - **Roll**: Imagine spinning a pencil on its tip - that's a roll movement.
///
/// - **Pitch**: Think of a seesaw motion, where the object tilts up or down along its side axis.
///
/// - **Yaw**: Like turning your head left or right, this is a rotation around the vertical axis
///
/// ### Using an Axis and Angle
///
/// When rotating a part around an axis, you specify the axis of rotation and the angle of
/// rotation.
///
/// ```no_run
/// // Rotate a pipe with roll, pitch, and yaw.
///
/// // Create a path for the sweep.
/// sweepPath = startSketchOn('XZ')
///     |> startProfileAt([0.05, 0.05], %)
///     |> line(end = [0, 7])
///     |> tangentialArc({
///         offset: 90,
///         radius: 5
///     }, %)
///     |> line(end = [-3, 0])
///     |> tangentialArc({
///         offset: -90,
///         radius: 5
///     }, %)
///     |> line(end = [0, 7])
///
/// // Create a hole for the pipe.
/// pipeHole = startSketchOn('XY')
///     |> circle({
///         center = [0, 0],
///         radius = 1.5,
///     }, %)
///
/// sweepSketch = startSketchOn('XY')
///     |> circle({
///         center = [0, 0],
///         radius = 2,
///         }, %)              
///     |> hole(pipeHole, %)
///     |> sweep(path = sweepPath)   
///     |> rotate(
///         roll = 10,
///         pitch =  10,
///         yaw = 90,
///     )
/// ```
///
/// ```no_run
/// // Rotate a pipe about an axis with an angle.
///
/// // Create a path for the sweep.
/// sweepPath = startSketchOn('XZ')
///     |> startProfileAt([0.05, 0.05], %)
///     |> line(end = [0, 7])
///     |> tangentialArc({
///         offset: 90,
///         radius: 5
///     }, %)
///     |> line(end = [-3, 0])
///     |> tangentialArc({
///         offset: -90,
///         radius: 5
///     }, %)
///     |> line(end = [0, 7])
///
/// // Create a hole for the pipe.
/// pipeHole = startSketchOn('XY')
///     |> circle({
///         center = [0, 0],
///         radius = 1.5,
///     }, %)
///
/// sweepSketch = startSketchOn('XY')
///     |> circle({
///         center = [0, 0],
///         radius = 2,
///         }, %)              
///     |> hole(pipeHole, %)
///     |> sweep(path = sweepPath)   
///     |> rotate(
///     axis =  [0, 0, 1.0],
///     angle = 90,
///     )
/// ```
#[stdlib {
    name = "rotate",
    feature_tree_operation = false,
    keywords = true,
    unlabeled_first = true,
    args = {
        solid = {docs = "The solid to rotate."},
        roll = {docs = "The roll angle in degrees. Must be used with `pitch` and `yaw`. Must be between -360 and 360.", include_in_snippet = true},
        pitch = {docs = "The pitch angle in degrees. Must be used with `roll` and `yaw`. Must be between -360 and 360.", include_in_snippet = true},
        yaw = {docs = "The yaw angle in degrees. Must be used with `roll` and `pitch`. Must be between -360 and 360.", include_in_snippet = true},
        axis = {docs = "The axis to rotate around. Must be used with `angle`.", include_in_snippet = false},
        angle = {docs = "The angle to rotate in degrees. Must be used with `axis`. Must be between -360 and 360.", include_in_snippet = false},
        global = {docs = "If true, the transform is applied in global space. The origin of the model will move. By default, the transform is applied in local sketch axis, therefore the origin will not move."}
    }
}]
#[allow(clippy::too_many_arguments)]
async fn inner_rotate(
    solid: Box<Solid>,
    roll: Option<f64>,
    pitch: Option<f64>,
    yaw: Option<f64>,
    axis: Option<[f64; 3]>,
    angle: Option<f64>,
    global: Option<bool>,
    exec_state: &mut ExecState,
    args: Args,
) -> Result<Box<Solid>, KclError> {
    let id = exec_state.next_uuid();

    if let (Some(roll), Some(pitch), Some(yaw)) = (roll, pitch, yaw) {
        args.batch_modeling_cmd(
            id,
            ModelingCmd::from(mcmd::SetObjectTransform {
                object_id: solid.id,
                transforms: vec![shared::ComponentTransform {
                    rotate_rpy: Some(shared::TransformBy::<Point3d<f64>> {
                        property: shared::Point3d {
                            x: roll,
                            y: pitch,
                            z: yaw,
                        },
                        set: false,
                        is_local: !global.unwrap_or(false),
                    }),
                    scale: None,
                    rotate_angle_axis: None,
                    translate: None,
                }],
            }),
        )
        .await?;
    }

    if let (Some(axis), Some(angle)) = (axis, angle) {
        args.batch_modeling_cmd(
            id,
            ModelingCmd::from(mcmd::SetObjectTransform {
                object_id: solid.id,
                transforms: vec![shared::ComponentTransform {
                    rotate_angle_axis: Some(shared::TransformBy::<Point4d<f64>> {
                        property: shared::Point4d {
                            x: axis[0],
                            y: axis[1],
                            z: axis[2],
                            w: angle,
                        },
                        set: false,
                        is_local: !global.unwrap_or(false),
                    }),
                    scale: None,
                    rotate_rpy: None,
                    translate: None,
                }],
            }),
        )
        .await?;
    }

    Ok(solid)
}

#[cfg(test)]
mod tests {
    use crate::execution::parse_execute;
    use pretty_assertions::assert_eq;

    const PIPE: &str = r#"sweepPath = startSketchOn('XZ')
    |> startProfileAt([0.05, 0.05], %)
    |> line(end = [0, 7])
    |> tangentialArc({
        offset: 90,
        radius: 5
    }, %)
    |> line(end = [-3, 0])
    |> tangentialArc({
        offset: -90,
        radius: 5
    }, %)
    |> line(end = [0, 7])

// Create a hole for the pipe.
pipeHole = startSketchOn('XY')
    |> circle({
        center = [0, 0],
        radius = 1.5,
    }, %)
sweepSketch = startSketchOn('XY')
    |> circle({
        center = [0, 0],
        radius = 2,
        }, %)              
    |> hole(pipeHole, %)
    |> sweep(
        path = sweepPath,
    )"#;

    #[tokio::test(flavor = "multi_thread")]
    async fn test_rotate_empty() {
        let ast = PIPE.to_string()
            + r#"
    |> rotate()
"#;
        let result = parse_execute(&ast).await;
        assert!(result.is_err());
        assert_eq!(
            result.unwrap_err().to_string(),
            r#"semantic: KclErrorDetails { source_ranges: [SourceRange([630, 638, 0])], message: "Expected `roll`, `pitch`, and `yaw` or `axis` and `angle` to be provided." }"#.to_string()
        );
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn test_rotate_axis_no_angle() {
        let ast = PIPE.to_string()
            + r#"
    |> rotate(
    axis =  [0, 0, 1.0],
    )
"#;
        let result = parse_execute(&ast).await;
        assert!(result.is_err());
        assert_eq!(
            result.unwrap_err().to_string(),
            r#"semantic: KclErrorDetails { source_ranges: [SourceRange([630, 668, 0])], message: "Expected `angle` to be provided when `axis` is provided." }"#.to_string()
        );
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn test_rotate_angle_no_axis() {
        let ast = PIPE.to_string()
            + r#"
    |> rotate(
    angle = 90,
    )
"#;
        let result = parse_execute(&ast).await;
        assert!(result.is_err());
        assert_eq!(
            result.unwrap_err().to_string(),
            r#"semantic: KclErrorDetails { source_ranges: [SourceRange([630, 659, 0])], message: "Expected `axis` to be provided when `angle` is provided." }"#.to_string()
        );
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn test_rotate_angle_out_of_range() {
        let ast = PIPE.to_string()
            + r#"
    |> rotate(
    axis =  [0, 0, 1.0],
    angle = 900,
    )
"#;
        let result = parse_execute(&ast).await;
        assert!(result.is_err());
        assert_eq!(
            result.unwrap_err().to_string(),
            r#"semantic: KclErrorDetails { source_ranges: [SourceRange([630, 685, 0])], message: "Expected angle to be between -360 and 360, found `900`" }"#.to_string()
        );
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn test_rotate_angle_axis_yaw() {
        let ast = PIPE.to_string()
            + r#"
    |> rotate(
    axis =  [0, 0, 1.0],
    angle = 90,
    yaw = 90,
   ) 
"#;
        let result = parse_execute(&ast).await;
        assert!(result.is_err());
        assert_eq!(
            result.unwrap_err().to_string(),
            r#"semantic: KclErrorDetails { source_ranges: [SourceRange([630, 697, 0])], message: "Expected `roll` to be provided when `pitch` or `yaw` is provided." }"#.to_string()
        );
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn test_rotate_yaw_no_pitch() {
        let ast = PIPE.to_string()
            + r#"
    |> rotate(
    yaw = 90,
    )
"#;
        let result = parse_execute(&ast).await;
        assert!(result.is_err());
        assert_eq!(
            result.unwrap_err().to_string(),
            r#"semantic: KclErrorDetails { source_ranges: [SourceRange([630, 657, 0])], message: "Expected `roll` to be provided when `pitch` or `yaw` is provided." }"#.to_string()
        );
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn test_rotate_yaw_out_of_range() {
        let ast = PIPE.to_string()
            + r#"
    |> rotate(
    yaw = 900,
    pitch = 90,
    roll = 90,
    )
"#;
        let result = parse_execute(&ast).await;
        assert!(result.is_err());
        assert_eq!(
            result.unwrap_err().to_string(),
            r#"semantic: KclErrorDetails { source_ranges: [SourceRange([630, 689, 0])], message: "Expected yaw to be between -360 and 360, found `900`" }"#.to_string()
        );
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn test_rotate_roll_out_of_range() {
        let ast = PIPE.to_string()
            + r#"
    |> rotate(
    yaw = 90,
    pitch = 90,
    roll = 900,
    )
"#;
        let result = parse_execute(&ast).await;
        assert!(result.is_err());
        assert_eq!(
            result.unwrap_err().to_string(),
            r#"semantic: KclErrorDetails { source_ranges: [SourceRange([630, 689, 0])], message: "Expected roll to be between -360 and 360, found `900`" }"#.to_string()
        );
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn test_rotate_pitch_out_of_range() {
        let ast = PIPE.to_string()
            + r#"
    |> rotate(
    yaw = 90,
    pitch = 900,
    roll = 90,
    )
"#;
        let result = parse_execute(&ast).await;
        assert!(result.is_err());
        assert_eq!(
            result.unwrap_err().to_string(),
            r#"semantic: KclErrorDetails { source_ranges: [SourceRange([630, 689, 0])], message: "Expected pitch to be between -360 and 360, found `900`" }"#.to_string()
        );
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn test_rotate_roll_pitch_yaw_with_angle() {
        let ast = PIPE.to_string()
            + r#"
    |> rotate(
    yaw = 90,
    pitch = 90,
    roll = 90,
    angle = 90,
    )
"#;
        let result = parse_execute(&ast).await;
        assert!(result.is_err());
        assert_eq!(
            result.unwrap_err().to_string(),
            r#"semantic: KclErrorDetails { source_ranges: [SourceRange([630, 704, 0])], message: "Expected `axis` and `angle` to not be provided when `roll`, `pitch`, and `yaw` are provided." }"#.to_string()
        );
    }
}
