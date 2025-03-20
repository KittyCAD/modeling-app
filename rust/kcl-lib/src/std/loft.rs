//! Standard library lofts.

use std::num::NonZeroU32;

use anyhow::Result;
use kcl_derive_docs::stdlib;
use kcmc::{each_cmd as mcmd, length_unit::LengthUnit, ModelingCmd};
use kittycad_modeling_cmds as kcmc;

use crate::{
    errors::{KclError, KclErrorDetails},
    execution::{types::RuntimeType, ExecState, KclValue, Sketch, Solid},
    parsing::ast::types::TagNode,
    std::{extrude::do_post_extrude, fillet::default_tolerance, Args},
};

const DEFAULT_V_DEGREE: u32 = 2;

/// Create a 3D surface or solid by interpolating between two or more sketches.
pub async fn loft(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let sketches = args.get_unlabeled_kw_arg_typed("sketches", &RuntimeType::sketches(), exec_state)?;
    let v_degree: NonZeroU32 = args
        .get_kw_arg_opt("vDegree")?
        .unwrap_or(NonZeroU32::new(DEFAULT_V_DEGREE).unwrap());
    // Attempt to approximate rational curves (such as arcs) using a bezier.
    // This will remove banding around interpolations between arcs and non-arcs.  It may produce errors in other scenarios
    // Over time, this field won't be necessary.
    let bez_approximate_rational = args.get_kw_arg_opt("bezApproximateRational")?.unwrap_or(false);
    // This can be set to override the automatically determined topological base curve, which is usually the first section encountered.
    let base_curve_index: Option<u32> = args.get_kw_arg_opt("baseCurveIndex")?;
    // Tolerance for the loft operation.
    let tolerance: Option<f64> = args.get_kw_arg_opt("tolerance")?;
    let tag_start = args.get_kw_arg_opt("tagStart")?;
    let tag_end = args.get_kw_arg_opt("tagEnd")?;

    let value = inner_loft(
        sketches,
        v_degree,
        bez_approximate_rational,
        base_curve_index,
        tolerance,
        tag_start,
        tag_end,
        exec_state,
        args,
    )
    .await?;
    Ok(KclValue::Solid { value })
}

/// Create a 3D surface or solid by interpolating between two or more sketches.
///
/// The sketches need to closed and on the same plane.
///
/// ```no_run
/// // Loft a square and a triangle.
/// squareSketch = startSketchOn('XY')
///     |> startProfileAt([-100, 200], %)
///     |> line(end = [200, 0])
///     |> line(end = [0, -200])
///     |> line(end = [-200, 0])
///     |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
///     |> close()
///
/// triangleSketch = startSketchOn(offsetPlane('XY', offset = 75))
///     |> startProfileAt([0, 125], %)
///     |> line(end = [-15, -30])
///     |> line(end = [30, 0])
///     |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
///     |> close()
///
/// loft([squareSketch, triangleSketch])
/// ```
///
/// ```no_run
/// // Loft a square, a circle, and another circle.
/// squareSketch = startSketchOn('XY')
///     |> startProfileAt([-100, 200], %)
///     |> line(end = [200, 0])
///     |> line(end = [0, -200])
///     |> line(end = [-200, 0])
///     |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
///     |> close()
///
/// circleSketch0 = startSketchOn(offsetPlane('XY', offset = 75))
///     |> circle( center = [0, 100], radius = 50 )
///
/// circleSketch1 = startSketchOn(offsetPlane('XY', offset = 150))
///     |> circle( center = [0, 100], radius = 20 )
///
/// loft([squareSketch, circleSketch0, circleSketch1])
/// ```
///
/// ```no_run
/// // Loft a square, a circle, and another circle with options.
/// squareSketch = startSketchOn('XY')
///     |> startProfileAt([-100, 200], %)
///     |> line(end = [200, 0])
///     |> line(end = [0, -200])
///     |> line(end = [-200, 0])
///     |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
///     |> close()
///
/// circleSketch0 = startSketchOn(offsetPlane('XY', offset = 75))
///     |> circle( center = [0, 100], radius = 50 )
///
/// circleSketch1 = startSketchOn(offsetPlane('XY', offset = 150))
///     |> circle( center = [0, 100], radius = 20 )
///
/// loft([squareSketch, circleSketch0, circleSketch1],
///     baseCurveIndex = 0,
///     bezApproximateRational = false,
///     tolerance = 0.000001,
///     vDegree = 2,
/// )
/// ```
#[stdlib {
    name = "loft",
    feature_tree_operation = true,
    keywords = true,
    unlabeled_first = true,
    args = {
        sketches = {docs = "Which sketches to loft. Must include at least 2 sketches."},
        v_degree = {docs = "Degree of the interpolation. Must be greater than zero. For example, use 2 for quadratic, or 3 for cubic interpolation in the V direction. This defaults to 2, if not specified."},
        bez_approximate_rational = {docs = "Attempt to approximate rational curves (such as arcs) using a bezier. This will remove banding around interpolations between arcs and non-arcs. It may produce errors in other scenarios Over time, this field won't be necessary."},
        base_curve_index = {docs = "This can be set to override the automatically determined topological base curve, which is usually the first section encountered."},
        tolerance = {docs = "Tolerance for the loft operation."},
        tag_start = { docs = "A named tag for the face at the start of the loft, i.e. the original sketch" },
        tag_end = { docs = "A named tag for the face at the end of the loft, i.e. the last sketch" },
    }
}]
#[allow(clippy::too_many_arguments)]
async fn inner_loft(
    sketches: Vec<Sketch>,
    v_degree: NonZeroU32,
    bez_approximate_rational: bool,
    base_curve_index: Option<u32>,
    tolerance: Option<f64>,
    tag_start: Option<TagNode>,
    tag_end: Option<TagNode>,
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

    let id = exec_state.next_uuid();
    args.batch_modeling_cmd(
        id,
        ModelingCmd::from(mcmd::Loft {
            section_ids: sketches.iter().map(|group| group.id).collect(),
            base_curve_index,
            bez_approximate_rational,
            tolerance: LengthUnit(tolerance.unwrap_or_else(|| default_tolerance(&exec_state.length_unit().into()))),
            v_degree,
        }),
    )
    .await?;

    // Using the first sketch as the base curve, idk we might want to change this later.
    let mut sketch = sketches[0].clone();
    // Override its id with the loft id so we can get its faces later
    sketch.id = id;
    Ok(Box::new(
        do_post_extrude(
            &sketch,
            id.into(),
            0.0,
            &super::extrude::NamedCapTags {
                start: tag_start.as_ref(),
                end: tag_end.as_ref(),
            },
            exec_state,
            &args,
        )
        .await?,
    ))
}
