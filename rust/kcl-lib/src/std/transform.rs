//! Standard library transforms.

use anyhow::Result;
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
    execution::{
        types::{PrimitiveType, RuntimeType},
        ExecState, KclValue, SolidOrSketchOrImportedGeometry,
    },
    std::{args::TyF64, axis_or_reference::Axis3dOrPoint3d, Args},
};

/// Scale a solid or a sketch.
pub async fn scale(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let objects = args.get_unlabeled_kw_arg(
        "objects",
        &RuntimeType::Union(vec![
            RuntimeType::sketches(),
            RuntimeType::solids(),
            RuntimeType::imported(),
        ]),
        exec_state,
    )?;
    let scale_x: Option<TyF64> = args.get_kw_arg_opt("x", &RuntimeType::count(), exec_state)?;
    let scale_y: Option<TyF64> = args.get_kw_arg_opt("y", &RuntimeType::count(), exec_state)?;
    let scale_z: Option<TyF64> = args.get_kw_arg_opt("z", &RuntimeType::count(), exec_state)?;
    let global = args.get_kw_arg_opt("global", &RuntimeType::bool(), exec_state)?;

    // Ensure at least one scale value is provided.
    if scale_x.is_none() && scale_y.is_none() && scale_z.is_none() {
        return Err(KclError::new_semantic(KclErrorDetails::new(
            "Expected `x`, `y`, or `z` to be provided.".to_string(),
            vec![args.source_range],
        )));
    }

    let objects = inner_scale(
        objects,
        scale_x.map(|t| t.n),
        scale_y.map(|t| t.n),
        scale_z.map(|t| t.n),
        global,
        exec_state,
        args,
    )
    .await?;
    Ok(objects.into())
}

async fn inner_scale(
    objects: SolidOrSketchOrImportedGeometry,
    x: Option<f64>,
    y: Option<f64>,
    z: Option<f64>,
    global: Option<bool>,
    exec_state: &mut ExecState,
    args: Args,
) -> Result<SolidOrSketchOrImportedGeometry, KclError> {
    // If we have a solid, flush the fillets and chamfers.
    // Only transforms needs this, it is very odd, see: https://github.com/KittyCAD/modeling-app/issues/5880
    if let SolidOrSketchOrImportedGeometry::SolidSet(solids) = &objects {
        exec_state.flush_batch_for_solids((&args).into(), solids).await?;
    }

    let mut objects = objects.clone();
    for object_id in objects.ids(&args.ctx).await? {
        exec_state
            .batch_modeling_cmd(
                (&args).into(),
                ModelingCmd::from(mcmd::SetObjectTransform {
                    object_id,
                    transforms: vec![shared::ComponentTransform {
                        scale: Some(shared::TransformBy::<Point3d<f64>> {
                            property: Point3d {
                                x: x.unwrap_or(1.0),
                                y: y.unwrap_or(1.0),
                                z: z.unwrap_or(1.0),
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
    }

    Ok(objects)
}

/// Move a solid or a sketch.
pub async fn translate(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let objects = args.get_unlabeled_kw_arg(
        "objects",
        &RuntimeType::Union(vec![
            RuntimeType::sketches(),
            RuntimeType::solids(),
            RuntimeType::imported(),
        ]),
        exec_state,
    )?;
    let translate_x: Option<TyF64> = args.get_kw_arg_opt("x", &RuntimeType::length(), exec_state)?;
    let translate_y: Option<TyF64> = args.get_kw_arg_opt("y", &RuntimeType::length(), exec_state)?;
    let translate_z: Option<TyF64> = args.get_kw_arg_opt("z", &RuntimeType::length(), exec_state)?;
    let global = args.get_kw_arg_opt("global", &RuntimeType::bool(), exec_state)?;

    // Ensure at least one translation value is provided.
    if translate_x.is_none() && translate_y.is_none() && translate_z.is_none() {
        return Err(KclError::new_semantic(KclErrorDetails::new(
            "Expected `x`, `y`, or `z` to be provided.".to_string(),
            vec![args.source_range],
        )));
    }

    let objects = inner_translate(objects, translate_x, translate_y, translate_z, global, exec_state, args).await?;
    Ok(objects.into())
}

async fn inner_translate(
    objects: SolidOrSketchOrImportedGeometry,
    x: Option<TyF64>,
    y: Option<TyF64>,
    z: Option<TyF64>,
    global: Option<bool>,
    exec_state: &mut ExecState,
    args: Args,
) -> Result<SolidOrSketchOrImportedGeometry, KclError> {
    // If we have a solid, flush the fillets and chamfers.
    // Only transforms needs this, it is very odd, see: https://github.com/KittyCAD/modeling-app/issues/5880
    if let SolidOrSketchOrImportedGeometry::SolidSet(solids) = &objects {
        exec_state.flush_batch_for_solids((&args).into(), solids).await?;
    }

    let mut objects = objects.clone();
    for object_id in objects.ids(&args.ctx).await? {
        exec_state
            .batch_modeling_cmd(
                (&args).into(),
                ModelingCmd::from(mcmd::SetObjectTransform {
                    object_id,
                    transforms: vec![shared::ComponentTransform {
                        translate: Some(shared::TransformBy::<Point3d<LengthUnit>> {
                            property: shared::Point3d {
                                x: LengthUnit(x.as_ref().map(|t| t.to_mm()).unwrap_or_default()),
                                y: LengthUnit(y.as_ref().map(|t| t.to_mm()).unwrap_or_default()),
                                z: LengthUnit(z.as_ref().map(|t| t.to_mm()).unwrap_or_default()),
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
    }

    Ok(objects)
}

/// Rotate a solid or a sketch.
pub async fn rotate(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let objects = args.get_unlabeled_kw_arg(
        "objects",
        &RuntimeType::Union(vec![
            RuntimeType::sketches(),
            RuntimeType::solids(),
            RuntimeType::imported(),
        ]),
        exec_state,
    )?;
    let roll: Option<TyF64> = args.get_kw_arg_opt("roll", &RuntimeType::degrees(), exec_state)?;
    let pitch: Option<TyF64> = args.get_kw_arg_opt("pitch", &RuntimeType::degrees(), exec_state)?;
    let yaw: Option<TyF64> = args.get_kw_arg_opt("yaw", &RuntimeType::degrees(), exec_state)?;
    let axis: Option<Axis3dOrPoint3d> = args.get_kw_arg_opt(
        "axis",
        &RuntimeType::Union(vec![
            RuntimeType::Primitive(PrimitiveType::Axis3d),
            RuntimeType::point3d(),
        ]),
        exec_state,
    )?;
    let axis = axis.map(|a| a.to_point3d());
    let angle: Option<TyF64> = args.get_kw_arg_opt("angle", &RuntimeType::degrees(), exec_state)?;
    let global = args.get_kw_arg_opt("global", &RuntimeType::bool(), exec_state)?;

    // Check if no rotation values are provided.
    if roll.is_none() && pitch.is_none() && yaw.is_none() && axis.is_none() && angle.is_none() {
        return Err(KclError::new_semantic(KclErrorDetails::new(
            "Expected `roll`, `pitch`, and `yaw` or `axis` and `angle` to be provided.".to_string(),
            vec![args.source_range],
        )));
    }

    // If they give us a roll, pitch, or yaw, they must give us at least one of them.
    if roll.is_some() || pitch.is_some() || yaw.is_some() {
        // Ensure they didn't also provide an axis or angle.
        if axis.is_some() || angle.is_some() {
            return Err(KclError::new_semantic(KclErrorDetails::new(
                "Expected `axis` and `angle` to not be provided when `roll`, `pitch`, and `yaw` are provided."
                    .to_owned(),
                vec![args.source_range],
            )));
        }
    }

    // If they give us an axis or angle, they must give us both.
    if axis.is_some() || angle.is_some() {
        if axis.is_none() {
            return Err(KclError::new_semantic(KclErrorDetails::new(
                "Expected `axis` to be provided when `angle` is provided.".to_string(),
                vec![args.source_range],
            )));
        }
        if angle.is_none() {
            return Err(KclError::new_semantic(KclErrorDetails::new(
                "Expected `angle` to be provided when `axis` is provided.".to_string(),
                vec![args.source_range],
            )));
        }

        // Ensure they didn't also provide a roll, pitch, or yaw.
        if roll.is_some() || pitch.is_some() || yaw.is_some() {
            return Err(KclError::new_semantic(KclErrorDetails::new(
                "Expected `roll`, `pitch`, and `yaw` to not be provided when `axis` and `angle` are provided."
                    .to_owned(),
                vec![args.source_range],
            )));
        }
    }

    // Validate the roll, pitch, and yaw values.
    if let Some(roll) = &roll {
        if !(-360.0..=360.0).contains(&roll.n) {
            return Err(KclError::new_semantic(KclErrorDetails::new(
                format!("Expected roll to be between -360 and 360, found `{}`", roll.n),
                vec![args.source_range],
            )));
        }
    }
    if let Some(pitch) = &pitch {
        if !(-360.0..=360.0).contains(&pitch.n) {
            return Err(KclError::new_semantic(KclErrorDetails::new(
                format!("Expected pitch to be between -360 and 360, found `{}`", pitch.n),
                vec![args.source_range],
            )));
        }
    }
    if let Some(yaw) = &yaw {
        if !(-360.0..=360.0).contains(&yaw.n) {
            return Err(KclError::new_semantic(KclErrorDetails::new(
                format!("Expected yaw to be between -360 and 360, found `{}`", yaw.n),
                vec![args.source_range],
            )));
        }
    }

    // Validate the axis and angle values.
    if let Some(angle) = &angle {
        if !(-360.0..=360.0).contains(&angle.n) {
            return Err(KclError::new_semantic(KclErrorDetails::new(
                format!("Expected angle to be between -360 and 360, found `{}`", angle.n),
                vec![args.source_range],
            )));
        }
    }

    let objects = inner_rotate(
        objects,
        roll.map(|t| t.n),
        pitch.map(|t| t.n),
        yaw.map(|t| t.n),
        // Don't adjust axis units since the axis must be normalized and only the direction
        // should be significant, not the magnitude.
        axis.map(|a| [a[0].n, a[1].n, a[2].n]),
        angle.map(|t| t.n),
        global,
        exec_state,
        args,
    )
    .await?;
    Ok(objects.into())
}

#[allow(clippy::too_many_arguments)]
async fn inner_rotate(
    objects: SolidOrSketchOrImportedGeometry,
    roll: Option<f64>,
    pitch: Option<f64>,
    yaw: Option<f64>,
    axis: Option<[f64; 3]>,
    angle: Option<f64>,
    global: Option<bool>,
    exec_state: &mut ExecState,
    args: Args,
) -> Result<SolidOrSketchOrImportedGeometry, KclError> {
    // If we have a solid, flush the fillets and chamfers.
    // Only transforms needs this, it is very odd, see: https://github.com/KittyCAD/modeling-app/issues/5880
    if let SolidOrSketchOrImportedGeometry::SolidSet(solids) = &objects {
        exec_state.flush_batch_for_solids((&args).into(), solids).await?;
    }

    let mut objects = objects.clone();
    for object_id in objects.ids(&args.ctx).await? {
        if let (Some(axis), Some(angle)) = (&axis, angle) {
            exec_state
                .batch_modeling_cmd(
                    (&args).into(),
                    ModelingCmd::from(mcmd::SetObjectTransform {
                        object_id,
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
        } else {
            // Do roll, pitch, and yaw.
            exec_state
                .batch_modeling_cmd(
                    (&args).into(),
                    ModelingCmd::from(mcmd::SetObjectTransform {
                        object_id,
                        transforms: vec![shared::ComponentTransform {
                            rotate_rpy: Some(shared::TransformBy::<Point3d<f64>> {
                                property: shared::Point3d {
                                    x: roll.unwrap_or(0.0),
                                    y: pitch.unwrap_or(0.0),
                                    z: yaw.unwrap_or(0.0),
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
    }

    Ok(objects)
}

#[cfg(test)]
mod tests {
    use pretty_assertions::assert_eq;

    use crate::execution::parse_execute;

    const PIPE: &str = r#"sweepPath = startSketchOn(XZ)
    |> startProfile(at = [0.05, 0.05])
    |> line(end = [0, 7])
    |> tangentialArc(angle = 90, radius = 5)
    |> line(end = [-3, 0])
    |> tangentialArc(angle = -90, radius = 5)
    |> line(end = [0, 7])

// Create a hole for the pipe.
pipeHole = startSketchOn(XY)
    |> circle(
        center = [0, 0],
        radius = 1.5,
    )
sweepSketch = startSketchOn(XY)
    |> circle(
        center = [0, 0],
        radius = 2,
        )              
    |> subtract2d(tool = pipeHole)
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
            result.unwrap_err().message(),
            r#"Expected `roll`, `pitch`, and `yaw` or `axis` and `angle` to be provided."#.to_string()
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
            result.unwrap_err().message(),
            r#"Expected `angle` to be provided when `axis` is provided."#.to_string()
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
            result.unwrap_err().message(),
            r#"Expected `axis` to be provided when `angle` is provided."#.to_string()
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
            result.unwrap_err().message(),
            r#"Expected angle to be between -360 and 360, found `900`"#.to_string()
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
            result.unwrap_err().message(),
            r#"Expected `axis` and `angle` to not be provided when `roll`, `pitch`, and `yaw` are provided."#
                .to_string()
        );
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn test_rotate_yaw_only() {
        let ast = PIPE.to_string()
            + r#"
    |> rotate(
    yaw = 90,
    )
"#;
        parse_execute(&ast).await.unwrap();
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn test_rotate_pitch_only() {
        let ast = PIPE.to_string()
            + r#"
    |> rotate(
    pitch = 90,
    )
"#;
        parse_execute(&ast).await.unwrap();
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn test_rotate_roll_only() {
        let ast = PIPE.to_string()
            + r#"
    |> rotate(
    pitch = 90,
    )
"#;
        parse_execute(&ast).await.unwrap();
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
            result.unwrap_err().message(),
            r#"Expected yaw to be between -360 and 360, found `900`"#.to_string()
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
            result.unwrap_err().message(),
            r#"Expected roll to be between -360 and 360, found `900`"#.to_string()
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
            result.unwrap_err().message(),
            r#"Expected pitch to be between -360 and 360, found `900`"#.to_string()
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
            result.unwrap_err().message(),
            r#"Expected `axis` and `angle` to not be provided when `roll`, `pitch`, and `yaw` are provided."#
                .to_string()
        );
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn test_translate_no_args() {
        let ast = PIPE.to_string()
            + r#"
    |> translate(
    )
"#;
        let result = parse_execute(&ast).await;
        assert!(result.is_err());
        assert_eq!(
            result.unwrap_err().message(),
            r#"Expected `x`, `y`, or `z` to be provided."#.to_string()
        );
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn test_scale_no_args() {
        let ast = PIPE.to_string()
            + r#"
    |> scale(
    )
"#;
        let result = parse_execute(&ast).await;
        assert!(result.is_err());
        assert_eq!(
            result.unwrap_err().message(),
            r#"Expected `x`, `y`, or `z` to be provided."#.to_string()
        );
    }
}
