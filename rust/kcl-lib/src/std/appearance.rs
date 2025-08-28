//! Standard library appearance.

use anyhow::Result;
use kcmc::{ModelingCmd, each_cmd as mcmd};
use kittycad_modeling_cmds::{self as kcmc, shared::Color};
use regex::Regex;
use rgba_simple::Hex;

use super::args::TyF64;
use crate::{
    errors::{KclError, KclErrorDetails},
    execution::{
        ExecState, KclValue, SolidOrImportedGeometry,
        types::{ArrayLen, RuntimeType},
    },
    std::Args,
};

lazy_static::lazy_static! {
    static ref HEX_REGEX: Regex = Regex::new(r"^#[0-9a-fA-F]{6}$").unwrap();
}

/// Construct a color from its red, blue and green components.
pub async fn hex_string(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let rgb: [TyF64; 3] = args.get_unlabeled_kw_arg(
        "rgb",
        &RuntimeType::Array(Box::new(RuntimeType::count()), ArrayLen::Known(3)),
        exec_state,
    )?;

    // Make sure the color if set is valid.
    if let Some(component) = rgb.iter().find(|component| component.n < 0.0 || component.n > 255.0) {
        return Err(KclError::new_semantic(KclErrorDetails::new(
            format!("Colors are given between 0 and 255, so {} is invalid", component.n),
            vec![args.source_range],
        )));
    }

    inner_hex_string(rgb, exec_state, args).await
}

async fn inner_hex_string(rgb: [TyF64; 3], _: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let [r, g, b] = rgb.map(|n| n.n.floor() as u32);
    let s = format!("#{r:02x}{g:02x}{b:02x}");
    Ok(KclValue::String {
        value: s,
        meta: args.into(),
    })
}

/// Set the appearance of a solid. This only works on solids, not sketches or individual paths.
pub async fn appearance(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let solids = args.get_unlabeled_kw_arg(
        "solids",
        &RuntimeType::Union(vec![RuntimeType::solids(), RuntimeType::imported()]),
        exec_state,
    )?;

    let color: String = args.get_kw_arg("color", &RuntimeType::string(), exec_state)?;
    let metalness: Option<TyF64> = args.get_kw_arg_opt("metalness", &RuntimeType::count(), exec_state)?;
    let roughness: Option<TyF64> = args.get_kw_arg_opt("roughness", &RuntimeType::count(), exec_state)?;

    // Make sure the color if set is valid.
    if !HEX_REGEX.is_match(&color) {
        return Err(KclError::new_semantic(KclErrorDetails::new(
            format!("Invalid hex color (`{color}`), try something like `#fff000`"),
            vec![args.source_range],
        )));
    }

    let result = inner_appearance(
        solids,
        color,
        metalness.map(|t| t.n),
        roughness.map(|t| t.n),
        exec_state,
        args,
    )
    .await?;
    Ok(result.into())
}

async fn inner_appearance(
    solids: SolidOrImportedGeometry,
    color: String,
    metalness: Option<f64>,
    roughness: Option<f64>,
    exec_state: &mut ExecState,
    args: Args,
) -> Result<SolidOrImportedGeometry, KclError> {
    let mut solids = solids.clone();

    for solid_id in solids.ids(&args.ctx).await? {
        // Set the material properties.
        let rgb = rgba_simple::RGB::<f32>::from_hex(&color).map_err(|err| {
            KclError::new_semantic(KclErrorDetails::new(
                format!("Invalid hex color (`{color}`): {err}"),
                vec![args.source_range],
            ))
        })?;

        let color = Color {
            r: rgb.red,
            g: rgb.green,
            b: rgb.blue,
            a: 100.0,
        };

        exec_state
            .batch_modeling_cmd(
                (&args).into(),
                ModelingCmd::from(mcmd::ObjectSetMaterialParamsPbr {
                    object_id: solid_id,
                    color,
                    metalness: metalness.unwrap_or_default() as f32 / 100.0,
                    roughness: roughness.unwrap_or_default() as f32 / 100.0,
                    ambient_occlusion: 0.0,
                }),
            )
            .await?;

        // Idk if we want to actually modify the memory for the colors, but I'm not right now since
        // I can't think of a use case for it.
    }

    Ok(solids)
}
