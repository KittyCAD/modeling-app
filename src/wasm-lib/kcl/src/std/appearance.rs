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
    let re = Regex::new(r"^#[0-9a-fA-F]{6}$").unwrap();
    if !re.is_match(&data.color) {
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
/// ```no_run
/// /// Add color to an extruded solid.
/// const exampleSketch = startSketchOn("XZ")
///   |> startProfileAt([0, 0], %)
///   |> lineTo([10, 0], %)
///   |> lineTo([0, 10], %)
///   |> lineTo([-10, 0], %)
///   |> close(%)
///
/// const example = extrude(5, exampleSketch)
///  |> appearance({color= '#ff0000', metalness= 50, roughness= 50}, %)
/// ```
///
/// ```no_run
/// /// Add color to a revolved solid.
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
/// /// Add color to different solids.
/// fn cube(center) {
///    return startSketchOn('XY')
///    |> startProfileAt([center[0] - 10, center[1] - 10], %)
///    |> lineTo([center[0] + 10, center[1] - 10], %)
///     |> lineTo([center[0] + 10, center[1] + 10], %)
///     |> lineTo([center[0] - 10, center[1] + 10], %)
///     |> close(%)
///    |> extrude(10, %)
/// }
///
/// const example0 = cube([0, 0])
///  const example1 = cube([20, 0])
///  const example2 = cube([40, 0])
///
///  appearance({color= '#ff0000', metalness= 50, roughness= 50}, [example0, example1])
///  appearance({color= '#00ff00', metalness= 50, roughness= 50}, example2)
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
