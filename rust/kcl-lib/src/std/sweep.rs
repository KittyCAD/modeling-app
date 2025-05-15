//! Standard library sweep.

use anyhow::Result;
use kcl_derive_docs::stdlib;
use kcmc::{each_cmd as mcmd, length_unit::LengthUnit, ModelingCmd};
use kittycad_modeling_cmds::{self as kcmc, shared::RelativeTo};
use schemars::JsonSchema;
use serde::Serialize;

use super::{args::TyF64, DEFAULT_TOLERANCE};
use crate::{
    errors::KclError,
    execution::{
        types::{NumericType, RuntimeType},
        ExecState, Helix, KclValue, Sketch, Solid,
    },
    parsing::ast::types::TagNode,
    std::{extrude::do_post_extrude, Args},
};

/// A path to sweep along.
#[derive(Debug, Clone, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(untagged)]
pub enum SweepPath {
    Sketch(Sketch),
    Helix(Box<Helix>),
}

/// Extrude a sketch along a path.
pub async fn sweep(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let sketches = args.get_unlabeled_kw_arg_typed("sketches", &RuntimeType::sketches(), exec_state)?;
    let path: SweepPath = args.get_kw_arg_typed(
        "path",
        &RuntimeType::Union(vec![RuntimeType::sketch(), RuntimeType::helix()]),
        exec_state,
    )?;
    let sectional = args.get_kw_arg_opt("sectional")?;
    let tolerance: Option<TyF64> = args.get_kw_arg_opt_typed("tolerance", &RuntimeType::length(), exec_state)?;
    let relative_to: Option<String> = args.get_kw_arg_opt_typed("relativeTo", &RuntimeType::string(), exec_state)?;
    let tag_start = args.get_kw_arg_opt("tagStart")?;
    let tag_end = args.get_kw_arg_opt("tagEnd")?;

    let value = inner_sweep(
        sketches,
        path,
        sectional,
        tolerance,
        relative_to,
        tag_start,
        tag_end,
        exec_state,
        args,
    )
    .await?;
    Ok(value.into())
}

/// Extrude a sketch along a path.
///
/// This, like extrude, is able to create a 3-dimensional solid from a
/// 2-dimensional sketch. However, unlike extrude, this creates a solid
/// by using the extent of the sketch as its path. This is useful for
/// creating more complex shapes that can't be created with a simple
/// extrusion.
///
/// You can provide more than one sketch to sweep, and they will all be
/// swept along the same path.
///
/// ```no_run
/// // Create a pipe using a sweep.
///
/// // Create a path for the sweep.
/// sweepPath = startSketchOn(XZ)
///     |> startProfile(at = [0.05, 0.05])
///     |> line(end = [0, 7])
///     |> tangentialArc(angle = 90, radius = 5)
///     |> line(end = [-3, 0])
///     |> tangentialArc(angle = -90, radius = 5)
///     |> line(end = [0, 7])
///
/// // Create a hole for the pipe.
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
///     |> subtract2d(tool = pipeHole)
///     |> sweep(path = sweepPath)   
/// ```
///
/// ```no_run
/// // Create a spring by sweeping around a helix path.
///
/// // Create a helix around the Z axis.
/// helixPath = helix(
///     angleStart = 0,
///     ccw = true,
///     revolutions = 4,
///     length = 10,
///     radius = 5,
///     axis = Z,
///  )
///
///
/// // Create a spring by sweeping around the helix path.
/// springSketch = startSketchOn(YZ)
///     |> circle( center = [0, 0], radius = 1)
///     |> sweep(path = helixPath, relativeTo = "sketchPlane")
/// ```
///
/// ```no_run
/// // Sweep two sketches along the same path.
///
/// sketch001 = startSketchOn(XY)
/// rectangleSketch = startProfile(sketch001, at = [-200, 23.86])
///     |> angledLine(angle = 0, length = 73.47, tag = $rectangleSegmentA001)
///     |> angledLine(
///         angle = segAng(rectangleSegmentA001) - 90,
///         length = 50.61,
///     )
///     |> angledLine(
///         angle = segAng(rectangleSegmentA001),
///         length = -segLen(rectangleSegmentA001),
///     )
///     |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
///     |> close()
///
/// circleSketch = circle(sketch001, center = [200, -30.29], radius = 32.63)
///
/// sketch002 = startSketchOn(YZ)
/// sweepPath = startProfile(sketch002, at = [0, 0])
///     |> yLine(length = 231.81)
///     |> tangentialArc(radius = 80, angle = -90)
///     |> xLine(length = 384.93)
///
/// sweep([rectangleSketch, circleSketch], path = sweepPath)
/// ```
/// ```
/// // Sectionally sweep one sketch along the path
///
/// sketch001 = startSketchOn(XY)
/// circleSketch = circle(sketch001, center = [200, -30.29], radius = 32.63)
///
/// sketch002 = startSketchOn(YZ)
/// sweepPath = startProfile(sketch002, at = [0, 0])
///     |> yLine(length = 231.81)
///     |> tangentialArc(radius = 80, angle = -90)
///     |> xLine(length = 384.93)
///
/// sweep(circleSketch, path = sweepPath, sectional = true)
/// ```

#[stdlib {
    name = "sweep",
    feature_tree_operation = true,
    keywords = true,
    unlabeled_first = true,
    args = {
        sketches = { docs = "The sketch or set of sketches that should be swept in space" },
        path = { docs = "The path to sweep the sketch along" },
        sectional = { docs = "If true, the sweep will be broken up into sub-sweeps (extrusions, revolves, sweeps) based on the trajectory path components." },
        tolerance = { docs = "Tolerance for this operation" },
        relative_to = { docs = "What is the sweep relative to? Can be either 'sketchPlane' or 'trajectoryCurve'. Defaults to trajectoryCurve."},
        tag_start = { docs = "A named tag for the face at the start of the sweep, i.e. the original sketch" },
        tag_end = { docs = "A named tag for the face at the end of the sweep" },
    },
    tags = ["sketch"]
}]
#[allow(clippy::too_many_arguments)]
async fn inner_sweep(
    sketches: Vec<Sketch>,
    path: SweepPath,
    sectional: Option<bool>,
    tolerance: Option<TyF64>,
    relative_to: Option<String>,
    tag_start: Option<TagNode>,
    tag_end: Option<TagNode>,
    exec_state: &mut ExecState,
    args: Args,
) -> Result<Vec<Solid>, KclError> {
    let trajectory = match path {
        SweepPath::Sketch(sketch) => sketch.id.into(),
        SweepPath::Helix(helix) => helix.value.into(),
    };
    let relative_to = match relative_to.as_deref() {
        Some("sketchPlane") => RelativeTo::SketchPlane,
        Some("trajectoryCurve") | None => RelativeTo::TrajectoryCurve,
        Some(_) => {
            return Err(KclError::Syntax(crate::errors::KclErrorDetails {
                source_ranges: vec![args.source_range],
                message: "If you provide relativeTo, it must either be 'sketchPlane' or 'trajectoryCurve'".to_owned(),
            }))
        }
    };

    let mut solids = Vec::new();
    for sketch in &sketches {
        let id = exec_state.next_uuid();
        args.batch_modeling_cmd(
            id,
            ModelingCmd::from(mcmd::Sweep {
                target: sketch.id.into(),
                trajectory,
                sectional: sectional.unwrap_or(false),
                tolerance: LengthUnit(tolerance.as_ref().map(|t| t.to_mm()).unwrap_or(DEFAULT_TOLERANCE)),
                relative_to,
            }),
        )
        .await?;

        solids.push(
            do_post_extrude(
                sketch,
                #[cfg(feature = "artifact-graph")]
                id.into(),
                TyF64::new(0.0, NumericType::mm()),
                sectional.unwrap_or(false),
                &super::extrude::NamedCapTags {
                    start: tag_start.as_ref(),
                    end: tag_end.as_ref(),
                },
                exec_state,
                &args,
            )
            .await?,
        );
    }

    // Hide the artifact from the sketch or helix.
    args.batch_modeling_cmd(
        exec_state.next_uuid(),
        ModelingCmd::from(mcmd::ObjectVisible {
            object_id: trajectory.into(),
            hidden: true,
        }),
    )
    .await?;

    Ok(solids)
}
