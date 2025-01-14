//! Standard library transforms.

use anyhow::Result;
use derive_docs::stdlib;
use kcmc::{each_cmd as mcmd, length_unit::LengthUnit, shared, ModelingCmd};
use kittycad_modeling_cmds as kcmc;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use validator::Validate;

use crate::{
    errors::{KclError, KclErrorDetails},
    execution::{ExecState, KclValue, Solid},
    std::Args,
};

/// Data for scaling a solid.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
pub struct ScaleData {
    /// The scale factor for the x, y, and z axes.
    pub scale: [f32; 3],
}

/// Scale a solid.
pub async fn scale(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let (data, solid): (ScaleData, Box<Solid>) = args.get_data_and_solid()?;

    let solid = inner_scale(data, solid, exec_state, args).await?;
    Ok(KclValue::Solid(solid))
}

/// Scale a solid.
///
/// ```no_run
/// // Scale a pipe.
///
/// // Create a path for the sweep.
/// sweepPath = startSketchOn('XZ')
///     |> startProfileAt([0.05, 0.05], %)
///     |> line([0, 7], %)
///     |> tangentialArc({
///         offset: 90,
///         radius: 5
///     }, %)
///     |> line([-3, 0], %)
///     |> tangentialArc({
///         offset: -90,
///         radius: 5
///     }, %)
///     |> line([0, 7], %)
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
///     |> sweep({
///         path: sweepPath,
///     }, %)   
///     |> scale({
///     scale: [1.0, 1.0, 2.5],
///     }, %)
/// ```
#[stdlib {
    name = "scale",
    feature_tree_operation = false,
}]
async fn inner_scale(
    data: ScaleData,
    solid: Box<Solid>,
    exec_state: &mut ExecState,
    args: Args,
) -> Result<Box<Solid>, KclError> {
    let id = exec_state.next_uuid();

    args.batch_modeling_cmd(
        id,
        ModelingCmd::from(mcmd::SetObjectTransform {
            object_id: solid.id,
            transforms: vec![shared::ComponentTransform {
                scale: Some(shared::TransformByPoint3d {
                    property: shared::Point3d {
                        x: data.scale[0],
                        y: data.scale[1],
                        z: data.scale[2],
                    },
                    set: false,
                    is_local: false,
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

/// Data for moving a solid.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
pub struct TranslateData {
    /// The amount to move the solid in all three axes.
    pub translate: [f32; 3],
    /// If true, the transform is applied in global space. If false, the transform is applied in local sketch axis.
    /// Default is false.
    /// Meaning, if you were sketching on 'XY' and you wanted to move the solid in the z direction,
    /// you would set the above as [0, 0, 1].
    /// If you were sketching on 'XZ' and you wanted to move the solid in the y direction,
    /// you would set the above as [0, 0, 1].
    #[serde(default)]
    pub global: Option<bool>,
}

/// Move a solid.
pub async fn translate(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let (data, solid): (TranslateData, Box<Solid>) = args.get_data_and_solid()?;

    let solid = inner_translate(data, solid, exec_state, args).await?;
    Ok(KclValue::Solid(solid))
}

/// Move a solid.
///
/// ```no_run
/// // Move a pipe.
///
/// // Create a path for the sweep.
/// sweepPath = startSketchOn('XZ')
///     |> startProfileAt([0.05, 0.05], %)
///     |> line([0, 7], %)
///     |> tangentialArc({
///         offset: 90,
///         radius: 5
///     }, %)
///     |> line([-3, 0], %)
///     |> tangentialArc({
///         offset: -90,
///         radius: 5
///     }, %)
///     |> line([0, 7], %)
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
///     |> sweep({
///         path: sweepPath,
///     }, %)   
///     |> translate({
///     translate: [1.0, 1.0, 2.5],
///     }, %)
/// ```
#[stdlib {
    name = "translate",
    feature_tree_operation = false,
}]
async fn inner_translate(
    data: TranslateData,
    solid: Box<Solid>,
    exec_state: &mut ExecState,
    args: Args,
) -> Result<Box<Solid>, KclError> {
    let id = exec_state.next_uuid();

    args.batch_modeling_cmd(
        id,
        ModelingCmd::from(mcmd::SetObjectTransform {
            object_id: solid.id,
            transforms: vec![shared::ComponentTransform {
                translate: Some(shared::TransformByPoint3d {
                    // TODO: THIS NEEDS TO BE A LENGTH UNIT.
                    property: shared::Point3d {
                        x: data.translate[0],
                        y: data.translate[1],
                        z: data.translate[2],
                    },
                    set: false,
                    is_local: !data.global.unwrap_or(false),
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

/// Data for rotating a solid around an axis with an angle.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
pub struct RotateAboutAxisData {
    /// The axis.
    pub axis: [f32; 3],
    /// Angle (in degrees).
    #[schemars(range(min = -360.0, max = 360.0))]
    pub angle: f32,
}

/// Rotate a solid around an axis with an angle.
pub async fn rotate_about_axis(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let (data, solid): (RotateAboutAxisData, Box<Solid>) = args.get_data_and_solid()?;

    // Return an error if the angle is zero.
    // We don't use validate() here because we want to return a specific error message that is
    // nice and we use the other data in the docs, so we still need use the derive above for the json schema.
    if !(-360.0..=360.0).contains(&data.angle) || data.angle == 0.0 {
        return Err(KclError::Semantic(KclErrorDetails {
            message: format!(
                "Expected angle to be between -360 and 360 and not 0, found `{}`",
                data.angle
            ),
            source_ranges: vec![args.source_range],
        }));
    }

    let solid = inner_rotate_about_axis(data, solid, exec_state, args).await?;
    Ok(KclValue::Solid(solid))
}

/// Rotate a solid around an axis with an angle.
///
/// ```no_run
/// // Rotate a pipe about an axis with an angle.
///
/// // Create a path for the sweep.
/// sweepPath = startSketchOn('XZ')
///     |> startProfileAt([0.05, 0.05], %)
///     |> line([0, 7], %)
///     |> tangentialArc({
///         offset: 90,
///         radius: 5
///     }, %)
///     |> line([-3, 0], %)
///     |> tangentialArc({
///         offset: -90,
///         radius: 5
///     }, %)
///     |> line([0, 7], %)
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
///     |> sweep({
///         path: sweepPath,
///     }, %)   
///     |> rotateAboutAxis({
///     axis: [0, 0, 1.0],
///     angle: 90,
///     }, %)
/// ```
#[stdlib {
    name = "rotateAboutAxis",
    feature_tree_operation = false,
}]
async fn inner_rotate_about_axis(
    data: RotateAboutAxisData,
    solid: Box<Solid>,
    exec_state: &mut ExecState,
    args: Args,
) -> Result<Box<Solid>, KclError> {
    let id = exec_state.next_uuid();

    args.batch_modeling_cmd(
        id,
        ModelingCmd::from(mcmd::SetObjectTransform {
            object_id: solid.id,
            transforms: vec![shared::ComponentTransform {
                rotate_angle_axis: Some(shared::TransformByPoint4d {
                    property: shared::Point4d {
                        x: data.axis[0],
                        y: data.axis[1],
                        z: data.axis[2],
                        w: data.angle,
                    },
                    set: false,
                    is_local: false,
                }),
                scale: None,
                rotate_rpy: None,
                translate: None,
            }],
        }),
    )
    .await?;

    Ok(solid)
}

/// Data for rotating a solid with roll, pitch, and yaw.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema, Validate)]
#[ts(export)]
pub struct RotateData {
    /// The roll.
    #[validate(range(min = -360.0, max = 360.0))]
    pub roll: f32,
    /// The pitch.
    #[validate(range(min = -360.0, max = 360.0))]
    pub pitch: f32,
    /// The yaw.
    #[validate(range(min = -360.0, max = 360.0))]
    pub yaw: f32,
    /// If true, the transform is applied in global space. If false, the transform is applied in local sketch axis.
    #[serde(default)]
    pub global: Option<bool>,
}

/// Rotate a solid with roll, pitch, and yaw.
pub async fn rotate(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let (data, solid): (RotateData, Box<Solid>) = args.get_data_and_solid()?;

    // Validate the data.
    data.validate().map_err(|err| {
        KclError::Semantic(KclErrorDetails {
            message: format!("Invalid rotate data: {}", err),
            source_ranges: vec![args.source_range],
        })
    })?;

    let solid = inner_rotate(data, solid, exec_state, args).await?;
    Ok(KclValue::Solid(solid))
}

/// Rotate a solid with roll, pitch, and yaw.
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
/// - **Pitch**: Think of a seesaw motion, where the object tilts up or down along its side axis.
/// - **Yaw**: Like turning your head left or right, this is a rotation around the vertical axis
///
/// ```no_run
/// // Rotate a pipe with roll, pitch, and yaw.
///
/// // Create a path for the sweep.
/// sweepPath = startSketchOn('XZ')
///     |> startProfileAt([0.05, 0.05], %)
///     |> line([0, 7], %)
///     |> tangentialArc({
///         offset: 90,
///         radius: 5
///     }, %)
///     |> line([-3, 0], %)
///     |> tangentialArc({
///         offset: -90,
///         radius: 5
///     }, %)
///     |> line([0, 7], %)
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
///     |> sweep({
///         path: sweepPath,
///     }, %)   
///     |> rotate({
///         roll: 10,
///         pitch: 10,
///         yaw: 90,
///     }, %)
/// ```
#[stdlib {
    name = "rotate",
    feature_tree_operation = false,
}]
async fn inner_rotate(
    data: RotateData,
    solid: Box<Solid>,
    exec_state: &mut ExecState,
    args: Args,
) -> Result<Box<Solid>, KclError> {
    let id = exec_state.next_uuid();

    args.batch_modeling_cmd(
        id,
        ModelingCmd::from(mcmd::SetObjectTransform {
            object_id: solid.id,
            transforms: vec![shared::ComponentTransform {
                rotate_rpy: Some(shared::TransformByPoint3d {
                    property: shared::Point3d {
                        x: data.roll,
                        y: data.pitch,
                        z: data.yaw,
                    },
                    set: false,
                    is_local: !data.global.unwrap_or(false),
                }),
                scale: None,
                rotate_angle_axis: None,
                translate: None,
            }],
        }),
    )
    .await?;

    Ok(solid)
}
