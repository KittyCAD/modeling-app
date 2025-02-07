//! Standard library appearance.

use anyhow::Result;
use derive_docs::stdlib;
use kcmc::{each_cmd as mcmd, ModelingCmd};
use kittycad_modeling_cmds::{self as kcmc, shared::Color};
use regex::Regex;
use rgba_simple::Hex;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use validator::Validate;

use crate::{
    errors::{KclError, KclErrorDetails},
    execution::{ExecState, KclValue, Solid, SolidSet},
    std::Args,
};

lazy_static::lazy_static! {
    static ref HEX_REGEX: Regex = Regex::new(r"^#[0-9a-fA-F]{6}$").unwrap();
}

/// Data for appearance.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema, Validate)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct AppearanceData {
    /// Color of the new material, a hex string like "#ff0000".
    #[schemars(regex(pattern = "#[0-9a-fA-F]{6}"))]
    pub color: String,
    /// Metalness of the new material, a percentage like 95.7.
    #[validate(range(min = 0.0, max = 100.0))]
    pub metalness: Option<f64>,
    /// Roughness of the new material, a percentage like 95.7.
    #[validate(range(min = 0.0, max = 100.0))]
    pub roughness: Option<f64>,
    // TODO(jess): we can also ambient occlusion here I just don't know what it is.
}

/// Set the appearance of a solid. This only works on solids, not sketches or individual paths.
pub async fn appearance(_exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let (data, solid_set): (AppearanceData, SolidSet) = args.get_data_and_solid_set()?;

    // Validate the data.
    data.validate().map_err(|err| {
        KclError::Semantic(KclErrorDetails {
            message: format!("Invalid appearance data: {}", err),
            source_ranges: vec![args.source_range],
        })
    })?;

    // Make sure the color if set is valid.
    if !HEX_REGEX.is_match(&data.color) {
        return Err(KclError::Semantic(KclErrorDetails {
            message: format!("Invalid hex color (`{}`), try something like `#fff000`", data.color),
            source_ranges: vec![args.source_range],
        }));
    }

    let result = inner_appearance(data, solid_set, args).await?;
    Ok(result.into())
}

/// Set the appearance of a solid. This only works on solids, not sketches or individual paths.
///
/// This will work on any solid, including extruded solids, revolved solids, and shelled solids.
/// ```no_run
/// // Add color to an extruded solid.
/// exampleSketch = startSketchOn("XZ")
///   |> startProfileAt([0, 0], %)
///   |> line(endAbsolute = [10, 0])
///   |> line(endAbsolute = [0, 10])
///   |> line(endAbsolute = [-10, 0])
///   |> close()
///
/// example = extrude(exampleSketch, length = 5)
///  |> appearance({color= '#ff0000', metalness= 50, roughness= 50}, %)
/// ```
///
/// ```no_run
/// // Add color to a revolved solid.
/// sketch001 = startSketchOn('XY')
///     |> circle({ center = [15, 0], radius = 5 }, %)
///     |> revolve({ angle = 360, axis = 'y' }, %)
///     |> appearance({
///         color = '#ff0000',
///         metalness = 90,
///         roughness = 90
///     }, %)
/// ```
///
/// ```no_run
/// // Add color to different solids.
/// fn cube(center) {
///    return startSketchOn('XY')
///    |> startProfileAt([center[0] - 10, center[1] - 10], %)
///    |> line(endAbsolute = [center[0] + 10, center[1] - 10])
///     |> line(endAbsolute = [center[0] + 10, center[1] + 10])
///     |> line(endAbsolute = [center[0] - 10, center[1] + 10])
///     |> close()
///    |> extrude(length = 10)
/// }
///
/// example0 = cube([0, 0])
/// example1 = cube([20, 0])
/// example2 = cube([40, 0])
///
///  appearance({color= '#ff0000', metalness= 50, roughness= 50}, [example0, example1])
///  appearance({color= '#00ff00', metalness= 50, roughness= 50}, example2)
/// ```
///
/// ```no_run
/// // You can set the appearance before or after you shell it will yield the same result.
/// // This example shows setting the appearance _after_ the shell.
/// firstSketch = startSketchOn('XY')
///     |> startProfileAt([-12, 12], %)
///     |> line(end = [24, 0])
///     |> line(end = [0, -24])
///     |> line(end = [-24, 0])
///     |> close()
///     |> extrude(length = 6)
///
/// shell(
///     firstSketch,
///     faces = ['end'],
///     thickness = 0.25,
/// )
///     |> appearance({
///         color = '#ff0000',
///         metalness = 90,
///         roughness = 90
///     }, %)
/// ```
///
/// ```no_run
/// // You can set the appearance before or after you shell it will yield the same result.
/// // This example shows setting the appearance _before_ the shell.
/// firstSketch = startSketchOn('XY')
///     |> startProfileAt([-12, 12], %)
///     |> line(end = [24, 0])
///     |> line(end = [0, -24])
///     |> line(end = [-24, 0])
///     |> close()
///     |> extrude(length = 6)
///     |> appearance({
///         color = '#ff0000',
///         metalness = 90,
///         roughness = 90
///     }, %)
///
/// shell(
///     firstSketch,
///     faces = ['end'],
///     thickness = 0.25,
/// )
/// ```
///
/// ```no_run
/// // Setting the appearance of a 3D pattern can be done _before_ or _after_ the pattern.
/// // This example shows _before_ the pattern.
/// exampleSketch = startSketchOn('XZ')
///   |> startProfileAt([0, 0], %)
///   |> line(end = [0, 2])
///   |> line(end = [3, 1])
///   |> line(end = [0, -4])
///   |> close()
///
/// example = extrude(exampleSketch, length = 1)
///     |> appearance({
///         color = '#ff0000',
///         metalness = 90,
///         roughness = 90
///     }, %)
///   |> patternLinear3d({
///       axis = [1, 0, 1],
///       instances = 7,
///       distance = 6
///     }, %)
/// ```
///
/// ```no_run
/// // Setting the appearance of a 3D pattern can be done _before_ or _after_ the pattern.
/// // This example shows _after_ the pattern.
/// exampleSketch = startSketchOn('XZ')
///   |> startProfileAt([0, 0], %)
///   |> line(end = [0, 2])
///   |> line(end = [3, 1])
///   |> line(end = [0, -4])
///   |> close()
///
/// example = extrude(exampleSketch, length = 1)
///   |> patternLinear3d({
///       axis = [1, 0, 1],
///       instances = 7,
///       distance = 6
///     }, %)
///     |> appearance({
///         color = '#ff0000',
///         metalness = 90,
///         roughness = 90
///     }, %)
/// ```
///
/// ```no_run
/// // Color the result of a 2D pattern that was extruded.
/// exampleSketch = startSketchOn('XZ')
///   |> startProfileAt([.5, 25], %)
///   |> line(end = [0, 5])
///   |> line(end = [-1, 0])
///   |> line(end = [0, -5])
///   |> close()
///   |> patternCircular2d({
///        center = [0, 0],
///        instances = 13,
///        arcDegrees = 360,
///        rotateDuplicates = true
///      }, %)
///
/// example = extrude(exampleSketch, length = 1)
///     |> appearance({
///         color = '#ff0000',
///         metalness = 90,
///         roughness = 90
///     }, %)
/// ```
///
/// ```no_run
/// // Color the result of a sweep.
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
///     |> appearance({
///         color: "#ff0000",
///         metalness: 50,
///         roughness: 50
///     }, %)
/// ```
#[stdlib {
    name = "appearance",
}]
async fn inner_appearance(data: AppearanceData, solid_set: SolidSet, args: Args) -> Result<SolidSet, KclError> {
    let solids: Vec<Box<Solid>> = solid_set.into();

    for solid in &solids {
        // Set the material properties.
        let rgb = rgba_simple::RGB::<f32>::from_hex(&data.color).map_err(|err| {
            KclError::Semantic(KclErrorDetails {
                message: format!("Invalid hex color (`{}`): {}", data.color, err),
                source_ranges: vec![args.source_range],
            })
        })?;

        let color = Color {
            r: rgb.red,
            g: rgb.green,
            b: rgb.blue,
            a: 100.0,
        };

        args.batch_modeling_cmd(
            uuid::Uuid::new_v4(),
            ModelingCmd::from(mcmd::ObjectSetMaterialParamsPbr {
                object_id: solid.id,
                color,
                metalness: data.metalness.unwrap_or_default() as f32 / 100.0,
                roughness: data.roughness.unwrap_or_default() as f32 / 100.0,
                ambient_occlusion: 0.0,
            }),
        )
        .await?;

        // Idk if we want to actually modify the memory for the colors, but I'm not right now since
        // I can't think of a use case for it.
    }

    Ok(SolidSet::from(solids))
}
