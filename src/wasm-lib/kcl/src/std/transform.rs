//! Standard library transforms.

use anyhow::Result;
use derive_docs::stdlib;
use kcmc::{each_cmd as mcmd, length_unit::LengthUnit, shared, shared::Angle, ModelingCmd};
use kittycad_modeling_cmds as kcmc;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

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
    pub translate: [f64; 3],
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
                    property: shared::Point3d::<LengthUnit> {
                        x: LengthUnit(data.translate[0]),
                        y: LengthUnit(data.translate[1]),
                        z: LengthUnit(data.translate[2]),
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
