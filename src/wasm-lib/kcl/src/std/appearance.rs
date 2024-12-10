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
    #[schemars(inner(regex(pattern = "#[0-9a-fA-F]{6}")))]
    pub color: Option<String>,
    /// Metalness of the new material, a percentage like 95.7.
    #[validate(range(min = 0.0, max = 100.0))]
    pub metalness: Option<f64>,
    /// Roughness of the new material, a percentage like 95.7.
    #[validate(range(min = 0.0, max = 100.0))]
    pub roughness: Option<f64>,
    /// Opacity of the new material, a percentage like 95.7.
    #[validate(range(min = 0.0, max = 100.0))]
    pub opacity: Option<f64>,
    // TODO(jess): we can also ambient occlusion here I just don't know what it is.
}

/// Set the appearance of a solid. This only works on solids, not sketches or individual paths.
pub async fn appearance(_exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let (data, solid_set): (AppearanceData, SolidSet) = args.get_data_and_solid_set()?;

    // Make sure they set at least one of the appearance properties.
    if data.color.is_none() && data.metalness.is_none() && data.roughness.is_none() && data.opacity.is_none() {
        return Err(KclError::Semantic(KclErrorDetails {
            message: "You must set at least one of the appearance properties.".to_string(),
            source_ranges: vec![args.source_range],
        }));
    }

    // Validate the data.
    data.validate().map_err(|err| {
        KclError::Semantic(KclErrorDetails {
            message: format!("Invalid appearance data: {}", err),
            source_ranges: vec![args.source_range],
        })
    })?;

    // Make sure the color if set is valid.
    if let Some(color) = &data.color {
        let re = Regex::new(r"^#[0-9a-fA-F]{6}$").unwrap();
        if !re.is_match(color) {
            return Err(KclError::Semantic(KclErrorDetails {
                message: format!("Invalid hex color (`{}`)", color),
                source_ranges: vec![args.source_range],
            }));
        }
    }

    let result = inner_appearance(data, solid_set, args).await?;
    Ok(result.into())
}

/// Set the appearance of a solid. This only works on solids, not sketches or individual paths.
///
/// ```no_run
/// const exampleSketch = startSketchOn("XZ")
///   |> startProfileAt([0, 0], %)
///   |> lineTo([10, 0], %)
///   |> lineTo([0, 10], %)
///   |> lineTo([-10, 0], %)
///   |> close(%)
///
/// const example = extrude(5, exampleSketch)
///  |> appearance({color: '#ff0000', metalness: 50, roughness: 50, opacity: 100})
/// ```
#[stdlib {
    name = "appearance",
}]
async fn inner_appearance(data: AppearanceData, solid_set: SolidSet, args: Args) -> Result<SolidSet, KclError> {
    let solids: Vec<Box<Solid>> = solid_set.into();

    for solid in &solids {
        // Set the material properties.
        let color = if let Some(color) = &data.color {
            let rgb = rgba_simple::RGB::<f32>::from_hex(color).map_err(|err| {
                KclError::Semantic(KclErrorDetails {
                    message: format!("Invalid hex color (`{}`): {}", color, err),
                    source_ranges: vec![args.source_range],
                })
            })?;

            Some(Color {
                r: rgb.red,
                g: rgb.green,
                b: rgb.blue,
                a: data.opacity.unwrap_or(1.0) as f32,
            })
        } else {
            None
        };

        args.batch_modeling_cmd(
            uuid::Uuid::new_v4(),
            ModelingCmd::from(mcmd::ObjectSetMaterialParamsPbr {
                object_id: solid.id,
                color: color.unwrap_or(Color {
                    r: 1.0,
                    g: 1.0,
                    b: 1.0,
                    a: 1.0,
                }),
                metalness: data.metalness.unwrap_or_default() as f32,
                roughness: data.roughness.unwrap_or_default() as f32,
                ambient_occlusion: 0.0,
            }),
        )
        .await?;

        // Idk if we want to actually modify the memory for the colors, but I'm not right now since
        // I can't think of a use case for it.
    }

    Ok(SolidSet::from(solids))
}
