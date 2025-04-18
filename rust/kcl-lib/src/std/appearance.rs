//! Standard library appearance.

use anyhow::Result;
use kcl_derive_docs::stdlib;
use kcmc::{each_cmd as mcmd, ModelingCmd};
use kittycad_modeling_cmds::{self as kcmc, shared::Color};
use regex::Regex;
use rgba_simple::Hex;
use schemars::JsonSchema;
use serde::Serialize;

use crate::{
    errors::{KclError, KclErrorDetails},
    execution::{
        types::{NumericType, PrimitiveType, RuntimeType},
        ExecState, KclValue, SolidOrImportedGeometry,
    },
    std::Args,
};

use super::args::TyF64;

lazy_static::lazy_static! {
    static ref HEX_REGEX: Regex = Regex::new(r"^#[0-9a-fA-F]{6}$").unwrap();
}

/// Data for appearance.
#[derive(Debug, Clone, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
struct AppearanceData {
    /// Color of the new material, a hex string like "#ff0000".
    #[schemars(regex(pattern = "#[0-9a-fA-F]{6}"))]
    pub color: String,
    /// Metalness of the new material, a percentage like 95.7.
    #[validate(range(min = 0.0, max = 100.0))]
    pub metalness: Option<TyF64>,
    /// Roughness of the new material, a percentage like 95.7.
    #[validate(range(min = 0.0, max = 100.0))]
    pub roughness: Option<TyF64>,
    // TODO(jess): we can also ambient occlusion here I just don't know what it is.
}

/// Set the appearance of a solid. This only works on solids, not sketches or individual paths.
pub async fn appearance(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let solids = args.get_unlabeled_kw_arg_typed(
        "solids",
        &RuntimeType::Union(vec![RuntimeType::solids(), RuntimeType::imported()]),
        exec_state,
    )?;

    let color: String = args.get_kw_arg("color")?;
    let count_ty = RuntimeType::Primitive(PrimitiveType::Number(NumericType::count()));
    let metalness: Option<TyF64> = args.get_kw_arg_opt_typed("metalness", &count_ty, exec_state)?;
    let roughness: Option<TyF64> = args.get_kw_arg_opt_typed("roughness", &count_ty, exec_state)?;
    let data = AppearanceData {
        color,
        metalness,
        roughness,
    };

    // Make sure the color if set is valid.
    if !HEX_REGEX.is_match(&data.color) {
        return Err(KclError::Semantic(KclErrorDetails {
            message: format!("Invalid hex color (`{}`), try something like `#fff000`", data.color),
            source_ranges: vec![args.source_range],
        }));
    }

    let result = inner_appearance(
        solids,
        data.color,
        data.metalness.map(|t| t.n),
        data.roughness.map(|t| t.n),
        exec_state,
        args,
    )
    .await?;
    Ok(result.into())
}

/// Set the appearance of a solid. This only works on solids, not sketches or individual paths.
///
/// This will work on any solid, including extruded solids, revolved solids, and shelled solids.
/// ```no_run
/// // Add color to an extruded solid.
/// exampleSketch = startSketchOn(XZ)
///   |> startProfileAt([0, 0], %)
///   |> line(endAbsolute = [10, 0])
///   |> line(endAbsolute = [0, 10])
///   |> line(endAbsolute = [-10, 0])
///   |> close()
///
/// example = extrude(exampleSketch, length = 5)
///  // There are other options besides 'color', but they're optional.
///  |> appearance(color='#ff0000')
/// ```
///
/// ```no_run
/// // Add color to a revolved solid.
/// sketch001 = startSketchOn(XY)
///     |> circle( center = [15, 0], radius = 5 )
///     |> revolve( angle = 360, axis = Y)
///     |> appearance(
///         color = '#ff0000',
///         metalness = 90,
///         roughness = 90
///     )
/// ```
///
/// ```no_run
/// // Add color to different solids.
/// fn cube(center) {
///    return startSketchOn(XY)
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
///  appearance([example0, example1], color='#ff0000', metalness=50, roughness=50)
///  appearance(example2, color='#00ff00', metalness=50, roughness=50)
/// ```
///
/// ```no_run
/// // You can set the appearance before or after you shell it will yield the same result.
/// // This example shows setting the appearance _after_ the shell.
/// firstSketch = startSketchOn(XY)
///     |> startProfileAt([-12, 12], %)
///     |> line(end = [24, 0])
///     |> line(end = [0, -24])
///     |> line(end = [-24, 0])
///     |> close()
///     |> extrude(length = 6)
///
/// shell(
///     firstSketch,
///     faces = [END],
///     thickness = 0.25,
/// )
///     |> appearance(
///         color = '#ff0000',
///         metalness = 90,
///         roughness = 90
///     )
/// ```
///
/// ```no_run
/// // You can set the appearance before or after you shell it will yield the same result.
/// // This example shows setting the appearance _before_ the shell.
/// firstSketch = startSketchOn(XY)
///     |> startProfileAt([-12, 12], %)
///     |> line(end = [24, 0])
///     |> line(end = [0, -24])
///     |> line(end = [-24, 0])
///     |> close()
///     |> extrude(length = 6)
///     |> appearance(
///         color = '#ff0000',
///         metalness = 90,
///         roughness = 90
///     )
///
/// shell(
///     firstSketch,
///     faces = [END],
///     thickness = 0.25,
/// )
/// ```
///
/// ```no_run
/// // Setting the appearance of a 3D pattern can be done _before_ or _after_ the pattern.
/// // This example shows _before_ the pattern.
/// exampleSketch = startSketchOn(XZ)
///   |> startProfileAt([0, 0], %)
///   |> line(end = [0, 2])
///   |> line(end = [3, 1])
///   |> line(end = [0, -4])
///   |> close()
///
/// example = extrude(exampleSketch, length = 1)
///     |> appearance(
///         color = '#ff0000',
///         metalness = 90,
///         roughness = 90
///        )
///     |> patternLinear3d(
///         axis = [1, 0, 1],
///         instances = 7,
///         distance = 6
///        )
/// ```
///
/// ```no_run
/// // Setting the appearance of a 3D pattern can be done _before_ or _after_ the pattern.
/// // This example shows _after_ the pattern.
/// exampleSketch = startSketchOn(XZ)
///   |> startProfileAt([0, 0], %)
///   |> line(end = [0, 2])
///   |> line(end = [3, 1])
///   |> line(end = [0, -4])
///   |> close()
///
/// example = extrude(exampleSketch, length = 1)
///   |> patternLinear3d(
///       axis = [1, 0, 1],
///       instances = 7,
///       distance = 6
///      )
///   |> appearance(
///       color = '#ff0000',
///       metalness = 90,
///       roughness = 90
///      )
/// ```
///
/// ```no_run
/// // Color the result of a 2D pattern that was extruded.
/// exampleSketch = startSketchOn(XZ)
///   |> startProfileAt([.5, 25], %)
///   |> line(end = [0, 5])
///   |> line(end = [-1, 0])
///   |> line(end = [0, -5])
///   |> close()
///   |> patternCircular2d(
///        center = [0, 0],
///        instances = 13,
///        arcDegrees = 360,
///        rotateDuplicates = true
///      )
///
/// example = extrude(exampleSketch, length = 1)
///     |> appearance(
///         color = '#ff0000',
///         metalness = 90,
///         roughness = 90
///     )
/// ```
///
/// ```no_run
/// // Color the result of a sweep.
///
/// // Create a path for the sweep.
/// sweepPath = startSketchOn(XZ)
///     |> startProfileAt([0.05, 0.05], %)
///     |> line(end = [0, 7])
///     |> tangentialArc(angle = 90, radius = 5)
///     |> line(end = [-3, 0])
///     |> tangentialArc(angle = -90, radius = 5)
///     |> line(end = [0, 7])
///
/// pipeHole = startSketchOn(XY)
///     |> circle(
///         center = [0, 0],
///         radius = 1.5,
///     )
///
/// sweepSketch = startSketchOn(XY)
///     |> circle(
///         center = [0, 0],
///         radius = 2,
///         )              
///     |> hole(pipeHole, %)
///     |> sweep(path = sweepPath)
///     |> appearance(
///         color = "#ff0000",
///         metalness = 50,
///         roughness = 50
///     )
/// ```
///
/// ```no_run
/// // Change the appearance of an imported model.
///
/// import "tests/inputs/cube.sldprt" as cube
///
/// cube
/// //    |> appearance(
/// //        color = "#ff0000",
/// //        metalness = 50,
/// //        roughness = 50
/// //    )
/// ```
#[stdlib {
    name = "appearance",
    keywords = true,
    unlabeled_first = true,
    args = {
        solids = { docs = "The solid(s) whose appearance is being set" },
        color = { docs = "Color of the new material, a hex string like '#ff0000'"},
        metalness = { docs = "Metalness of the new material, a percentage like 95.7." },
        roughness = { docs = "Roughness of the new material, a percentage like 95.7." },
    }
}]
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
            KclError::Semantic(KclErrorDetails {
                message: format!("Invalid hex color (`{color}`): {err}"),
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
            exec_state.next_uuid(),
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
