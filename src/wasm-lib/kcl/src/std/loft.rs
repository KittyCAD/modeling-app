//! Standard library lofts.

use anyhow::Result;
use derive_docs::stdlib;
use kcmc::{each_cmd as mcmd, length_unit::LengthUnit, ModelingCmd};
use kittycad_modeling_cmds as kcmc;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::{
    errors::{KclError, KclErrorDetails},
    execution::{ExecState, KclValue, Sketch, Solid},
    std::{extrude::do_post_extrude, fillet::default_tolerance, Args},
};

const DEFAULT_V_DEGREE: u32 = 2;

/// Data for a loft.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct LoftData {
    /// Degree of the interpolation. Must be greater than zero.
    /// For example, use 2 for quadratic, or 3 for cubic interpolation in the V direction.
    /// This defaults to 2, if not specified.
    pub v_degree: Option<std::num::NonZeroU32>,
    /// Attempt to approximate rational curves (such as arcs) using a bezier.
    /// This will remove banding around interpolations between arcs and non-arcs.  It may produce errors in other scenarios
    /// Over time, this field won't be necessary.
    #[serde(default)]
    pub bez_approximate_rational: Option<bool>,
    /// This can be set to override the automatically determined topological base curve, which is usually the first section encountered.
    #[serde(default)]
    pub base_curve_index: Option<u32>,
    /// Tolerance for the loft operation.
    #[serde(default)]
    pub tolerance: Option<f64>,
}

impl Default for LoftData {
    fn default() -> Self {
        Self {
            // This unwrap is safe because the default value is always greater than zero.
            v_degree: Some(std::num::NonZeroU32::new(DEFAULT_V_DEGREE).unwrap()),
            bez_approximate_rational: None,
            base_curve_index: None,
            tolerance: None,
        }
    }
}

/// Create a 3D surface or solid by interpolating between two or more sketches.
pub async fn loft(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let (sketches, data): (Vec<Sketch>, Option<LoftData>) = args.get_sketches_and_data()?;

    let solid = inner_loft(sketches, data, exec_state, args).await?;
    Ok(KclValue::Solid(solid))
}

/// Create a 3D surface or solid by interpolating between two or more sketches.
///
/// The sketches need to closed and on the same plane.
///
/// ```no_run
/// // Loft a square and a triangle.
/// squareSketch = startSketchOn('XY')
///     |> startProfileAt([-100, 200], %)
///     |> line([200, 0], %)
///     |> line([0, -200], %)
///     |> line([-200, 0], %)
///     |> lineTo([profileStartX(%), profileStartY(%)], %)
///     |> close(%)
///
/// triangleSketch = startSketchOn(offsetPlane('XY', 75))
///     |> startProfileAt([0, 125], %)
///     |> line([-15, -30], %)
///     |> line([30, 0], %)
///     |> lineTo([profileStartX(%), profileStartY(%)], %)
///     |> close(%)
///
/// loft([squareSketch, triangleSketch])
/// ```
///
/// ```no_run
/// // Loft a square, a circle, and another circle.
/// squareSketch = startSketchOn('XY')
///     |> startProfileAt([-100, 200], %)
///     |> line([200, 0], %)
///     |> line([0, -200], %)
///     |> line([-200, 0], %)
///     |> lineTo([profileStartX(%), profileStartY(%)], %)
///     |> close(%)
///
/// circleSketch0 = startSketchOn(offsetPlane('XY', 75))
///     |> circle({ center = [0, 100], radius = 50 }, %)
///
/// circleSketch1 = startSketchOn(offsetPlane('XY', 150))
///     |> circle({ center = [0, 100], radius = 20 }, %)
///
/// loft([squareSketch, circleSketch0, circleSketch1])
/// ```
///
/// ```no_run
/// // Loft a square, a circle, and another circle with options.
/// squareSketch = startSketchOn('XY')
///     |> startProfileAt([-100, 200], %)
///     |> line([200, 0], %)
///     |> line([0, -200], %)
///     |> line([-200, 0], %)
///     |> lineTo([profileStartX(%), profileStartY(%)], %)
///     |> close(%)
///
/// circleSketch0 = startSketchOn(offsetPlane('XY', 75))
///     |> circle({ center = [0, 100], radius = 50 }, %)
///
/// circleSketch1 = startSketchOn(offsetPlane('XY', 150))
///     |> circle({ center = [0, 100], radius = 20 }, %)
///
/// loft([squareSketch, circleSketch0, circleSketch1], {
///     // This can be set to override the automatically determined
///     // topological base curve, which is usually the first section encountered.
///     baseCurveIndex = 0,
///     // Attempt to approximate rational curves (such as arcs) using a bezier.
///     // This will remove banding around interpolations between arcs and non-arcs.
///     // It may produce errors in other scenarios Over time, this field won't be necessary.
///     bezApproximateRational = false,
///     // Tolerance for the loft operation.
///     tolerance = 0.000001,
///     // Degree of the interpolation. Must be greater than zero.
///     // For example, use 2 for quadratic, or 3 for cubic interpolation in
///     // the V direction. This defaults to 2, if not specified.
///     vDegree = 2,
/// })
/// ```
#[stdlib {
    name = "loft",
    feature_tree_operation = true,
}]
async fn inner_loft(
    sketches: Vec<Sketch>,
    data: Option<LoftData>,
    exec_state: &mut ExecState,
    args: Args,
) -> Result<Box<Solid>, KclError> {
    // Make sure we have at least two sketches.
    if sketches.len() < 2 {
        return Err(KclError::Semantic(KclErrorDetails {
            message: format!(
                "Loft requires at least two sketches, but only {} were provided.",
                sketches.len()
            ),
            source_ranges: vec![args.source_range],
        }));
    }

    // Get the loft data.
    let data = data.unwrap_or_default();

    let id = exec_state.id_generator.next_uuid();
    args.batch_modeling_cmd(
        id,
        ModelingCmd::from(mcmd::Loft {
            section_ids: sketches.iter().map(|group| group.id).collect(),
            base_curve_index: data.base_curve_index,
            bez_approximate_rational: data.bez_approximate_rational.unwrap_or(false),
            tolerance: LengthUnit(data.tolerance.unwrap_or(default_tolerance(&args.ctx.settings.units))),
            v_degree: data
                .v_degree
                .unwrap_or_else(|| std::num::NonZeroU32::new(DEFAULT_V_DEGREE).unwrap()),
        }),
    )
    .await?;

    // Using the first sketch as the base curve, idk we might want to change this later.
    do_post_extrude(sketches[0].clone(), 0.0, exec_state, args).await
}
