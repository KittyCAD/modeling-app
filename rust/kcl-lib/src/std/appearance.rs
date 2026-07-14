//! Standard library appearance.

use anyhow::Result;
use kcl_error::CompilationIssue;
use kcmc::ModelingCmd;
use kcmc::each_cmd as mcmd;
use kittycad_modeling_cmds::shared::Color;
use kittycad_modeling_cmds::{self as kcmc};
use regex::Regex;
use rgba_simple::Hex;

use super::args::TyF64;
use crate::errors::KclError;
use crate::errors::KclErrorDetails;
use crate::execution::ExecState;
use crate::execution::HasAppearance;
use crate::execution::KclValue;
use crate::execution::ModelingCmdMeta;
use crate::execution::annotations;
use crate::execution::types::ArrayLen;
use crate::execution::types::RuntimeType;
use crate::std::Args;

lazy_static::lazy_static! {
    static ref HEX_REGEX: Regex = Regex::new(r"^#[0-9a-fA-F]{6}$").unwrap();
}

const DEFAULT_ROUGHNESS: f64 = 1.0;
const DEFAULT_METALNESS: f64 = 0.0;

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

/// Set the appearance of something (e.g. a solid, imported geometry, or plane).
pub async fn appearance(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let solids = args.get_unlabeled_kw_arg(
        "solids",
        &RuntimeType::Union(vec![
            RuntimeType::solids(),
            RuntimeType::imported(),
            RuntimeType::plane(),
        ]),
        exec_state,
    )?;

    let color: String = args.get_kw_arg("color", &RuntimeType::string(), exec_state)?;
    let metalness: Option<TyF64> = args.get_kw_arg_opt("metalness", &RuntimeType::count(), exec_state)?;
    let roughness: Option<TyF64> = args.get_kw_arg_opt("roughness", &RuntimeType::count(), exec_state)?;
    let opacity: Option<TyF64> = args.get_kw_arg_opt("opacity", &RuntimeType::count(), exec_state)?;

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
        opacity.map(|t| t.n),
        exec_state,
        args,
    )
    .await?;
    Ok(result.into())
}

async fn inner_appearance(
    geometry: HasAppearance,
    color: String,
    metalness: Option<f64>,
    roughness: Option<f64>,
    opacity: Option<f64>,
    exec_state: &mut ExecState,
    args: Args,
) -> Result<HasAppearance, KclError> {
    let mut geometry = geometry;

    // Set the material properties.
    let rgb = rgba_simple::RGB::<f32>::from_hex(&color).map_err(|err| {
        KclError::new_semantic(KclErrorDetails::new(
            format!("Invalid hex color (`{color}`): {err}"),
            vec![args.source_range],
        ))
    })?;

    let percent_range = (0.0)..=100.0;
    let zero_one_range = (0.0)..=1.0;
    if let HasAppearance::Plane(plane) = &geometry {
        if let Some(user_opacity) = opacity {
            if zero_one_range.contains(&user_opacity) && user_opacity != 0.0 {
                exec_state.warn(
                        CompilationIssue::err(args.source_range, "This looks like you're setting a property to a number between 0 and 1, but the property should be between 0 and 100.".to_string()),
                        annotations::WARN_SHOULD_BE_PERCENTAGE,
                    );
            }
            if !percent_range.contains(&user_opacity) {
                return Err(KclError::new_semantic(KclErrorDetails::new(
                    format!("Opacity must be between 0 and 100, but it was {user_opacity}"),
                    vec![args.source_range],
                )));
            }
        }
        let opacity = (opacity.unwrap_or(50.0) / 100.0) as f32;
        exec_state
            .batch_modeling_cmd(
                ModelingCmdMeta::from_args(exec_state, &args),
                ModelingCmd::from(
                    mcmd::PlaneSetColor::builder()
                        .color(Color::from_rgba(rgb.red, rgb.green, rgb.blue, opacity))
                        .plane_id(plane.id)
                        .build(),
                ),
            )
            .await?;

        return Ok(geometry);
    }

    // Set the material properties.
    for (prop, val) in [("Metalness", metalness), ("Roughness", roughness), ("Opacity", opacity)] {
        if let Some(x) = val {
            if !(percent_range.contains(&x)) {
                return Err(KclError::new_semantic(KclErrorDetails::new(
                    format!("{prop} must be between 0 and 100, but it was {x}"),
                    vec![args.source_range],
                )));
            }
            if zero_one_range.contains(&x) && x != 0.0 {
                exec_state.warn(
                        CompilationIssue::err(args.source_range, "This looks like you're setting a property to a number between 0 and 1, but the property should be between 0 and 100.".to_string()),
                        annotations::WARN_SHOULD_BE_PERCENTAGE,
                    );
            }
        }
    }

    // OIT (order-independent transparency) is required to show transparency.
    // But it degrades engine performance. So only enable it if necessary,
    // i.e. if user has chosen to make something transparent.
    let mut needs_oit = false;
    let opacity_param = if let Some(opacity) = opacity {
        // The engine errors out if you toggle OIT with SSAO off.
        // So ignore OIT settings if SSAO is off.
        if opacity < 100.0 && args.ctx.settings.enable_ssao {
            needs_oit = true;
        }
        opacity / 100.0
    } else {
        1.0
    };
    let color = Color::from_rgba(rgb.red, rgb.green, rgb.blue, opacity_param as f32);

    if needs_oit {
        // TODO: Emit a warning annotation if SSAO is disabled.
        exec_state
            .batch_modeling_cmd(
                ModelingCmdMeta::from_args(exec_state, &args),
                ModelingCmd::from(mcmd::SetOrderIndependentTransparency::builder().enabled(true).build()),
            )
            .await?;
    }

    for solid_id in geometry.ids(&args.ctx).await? {
        exec_state
            .batch_modeling_cmd(
                ModelingCmdMeta::from_args(exec_state, &args),
                ModelingCmd::from(
                    mcmd::ObjectSetMaterialParamsPbr::builder()
                        .object_id(solid_id)
                        .color(color)
                        .metalness(metalness.unwrap_or(DEFAULT_METALNESS) as f32 / 100.0)
                        .roughness(roughness.unwrap_or(DEFAULT_ROUGHNESS) as f32 / 100.0)
                        .ambient_occlusion(0.0)
                        .build(),
                ),
            )
            .await?;

        // Idk if we want to actually modify the memory for the colors, but I'm not right now since
        // I can't think of a use case for it.
    }

    Ok(geometry)
}

#[cfg(test)]
mod tests {
    use kittycad_modeling_cmds::ModelingCmd;

    use crate::execution::parse_execute;

    #[tokio::test(flavor = "multi_thread")]
    async fn appearance_on_plane_uses_plane_set_color_only() {
        let result = parse_execute(
            r##"
plane = offsetPlane(XZ, offset = 4)
styled = plane |> appearance(color = "#ff0000", opacity = 30, metalness = 200, roughness = 200)
"##,
        )
        .await
        .unwrap();

        let commands = result
            .root_module_artifact_commands()
            .iter()
            .map(|artifact_command| &artifact_command.command)
            .collect::<Vec<_>>();

        assert_eq!(
            commands
                .iter()
                .filter(|command| matches!(command, ModelingCmd::PlaneSetColor(_)))
                .count(),
            2
        );
        assert!(
            !commands
                .iter()
                .any(|command| matches!(command, ModelingCmd::ObjectSetMaterialParamsPbr(_)))
        );
        assert!(
            !commands
                .iter()
                .any(|command| matches!(command, ModelingCmd::SetOrderIndependentTransparency(_)))
        );
    }
}
