//! Standard library revolution surfaces.

use anyhow::Result;
use kcl_derive_docs::stdlib;
use kcmc::{each_cmd as mcmd, length_unit::LengthUnit, shared::Angle, ModelingCmd};
use kittycad_modeling_cmds::{self as kcmc};

use crate::{
    errors::{KclError, KclErrorDetails},
    execution::{types::RuntimeType, ExecState, KclValue, Sketch, Solid},
    parsing::ast::types::TagNode,
    std::{axis_or_reference::Axis2dOrEdgeReference, extrude::do_post_extrude, fillet::default_tolerance, Args},
};

/// Revolve a sketch or set of sketches around an axis.
pub async fn revolve(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let sketches = args.get_unlabeled_kw_arg_typed("sketches", &RuntimeType::sketches(), exec_state)?;
    let axis: Axis2dOrEdgeReference = args.get_kw_arg("axis")?;
    let angle = args.get_kw_arg_opt("angle")?;
    let tolerance = args.get_kw_arg_opt("tolerance")?;
    let tag_start = args.get_kw_arg_opt("tagStart")?;
    let tag_end = args.get_kw_arg_opt("tagEnd")?;

    let value = inner_revolve(sketches, axis, angle, tolerance, tag_start, tag_end, exec_state, args).await?;
    Ok(value.into())
}

/// Rotate a sketch around some provided axis, creating a solid from its extent.
///
/// This, like extrude, is able to create a 3-dimensional solid from a
/// 2-dimensional sketch. However, unlike extrude, this creates a solid
/// by using the extent of the sketch as its revolved around an axis rather
/// than using the extent of the sketch linearly translated through a third
/// dimension.
///
/// Revolve occurs around a local sketch axis rather than a global axis.
///
/// You can provide more than one sketch to revolve, and they will all be
/// revolved around the same axis.
///
/// ```no_run
/// part001 = startSketchOn('XY')
///     |> startProfileAt([4, 12], %)
///     |> line(end = [2, 0])
///     |> line(end = [0, -6])
///     |> line(end = [4, -6])
///     |> line(end = [0, -6])
///     |> line(end = [-3.75, -4.5])
///     |> line(end = [0, -5.5])
///     |> line(end = [-2, 0])
///     |> close()
///     |> revolve(axis = 'y') // default angle is 360
/// ```
///
/// ```no_run
/// // A donut shape.
/// sketch001 = startSketchOn('XY')
///     |> circle( center = [15, 0], radius = 5 )
///     |> revolve(
///         angle = 360,
///         axis = 'y'
///     )
/// ```
///
/// ```no_run
/// part001 = startSketchOn('XY')
///     |> startProfileAt([4, 12], %)
///     |> line(end = [2, 0])
///     |> line(end = [0, -6])
///     |> line(end = [4, -6])
///     |> line(end = [0, -6])
///     |> line(end = [-3.75, -4.5])
///     |> line(end = [0, -5.5])
///     |> line(end = [-2, 0])
///     |> close()
///     |> revolve(axis = 'y', angle = 180)
/// ```
///
/// ```no_run
/// part001 = startSketchOn('XY')
///     |> startProfileAt([4, 12], %)
///     |> line(end = [2, 0])
///     |> line(end = [0, -6])
///     |> line(end = [4, -6])
///     |> line(end = [0, -6])
///     |> line(end = [-3.75, -4.5])
///     |> line(end = [0, -5.5])
///     |> line(end = [-2, 0])
///     |> close()
///     |> revolve(axis = 'y', angle = 180)
///
/// part002 = startSketchOn(part001, 'end')
///     |> startProfileAt([4.5, -5], %)
///     |> line(end = [0, 5])
///     |> line(end = [5, 0])
///     |> line(end = [0, -5])
///     |> close()
///     |> extrude(length = 5)
/// ```
///
/// ```no_run
/// box = startSketchOn('XY')
///     |> startProfileAt([0, 0], %)
///     |> line(end = [0, 20])
///     |> line(end = [20, 0])
///     |> line(end = [0, -20])
///     |> close()
///     |> extrude(length = 20)
///
/// sketch001 = startSketchOn(box, "END")
///     |> circle( center = [10,10], radius = 4 )
///     |> revolve(
///         angle = -90,
///         axis = 'y'
///     )
/// ```
///
/// ```no_run
/// box = startSketchOn('XY')
///     |> startProfileAt([0, 0], %)
///     |> line(end = [0, 20])
///     |> line(end = [20, 0])
///     |> line(end = [0, -20], tag = $revolveAxis)
///     |> close()
///     |> extrude(length = 20)
///
/// sketch001 = startSketchOn(box, "END")
///     |> circle( center = [10,10], radius = 4 )
///     |> revolve(
///         angle = 90,
///         axis = getOppositeEdge(revolveAxis)
///     )
/// ```
///
/// ```no_run
/// box = startSketchOn('XY')
///     |> startProfileAt([0, 0], %)
///     |> line(end = [0, 20])
///     |> line(end = [20, 0])
///     |> line(end = [0, -20], tag = $revolveAxis)
///     |> close()
///     |> extrude(length = 20)
///
/// sketch001 = startSketchOn(box, "END")
///     |> circle( center = [10,10], radius = 4 )
///     |> revolve(
///         angle = 90,
///         axis = getOppositeEdge(revolveAxis),
///         tolerance = 0.0001
///     )
/// ```
///
/// ```no_run
/// sketch001 = startSketchOn('XY')
///   |> startProfileAt([10, 0], %)
///   |> line(end = [5, -5])
///   |> line(end = [5, 5])
///   |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
///   |> close()
///
/// part001 = revolve(
///    sketch001,
///   axis = {
///     custom: {
///       axis = [0.0, 1.0],
///       origin: [0.0, 0.0]
///     }
///   }
/// )
/// ```
///
/// ```no_run
/// // Revolve two sketches around the same axis.
///
/// sketch001 = startSketchOn('XY')
/// profile001 = startProfileAt([4, 8], sketch001)
///     |> xLine(length = 3)
///     |> yLine(length = -3)
///     |> xLine(length = -3)
///     |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
///     |> close()
///
/// profile002 = startProfileAt([-5, 8], sketch001)
///     |> xLine(length = 3)
///     |> yLine(length = -3)
///     |> xLine(length = -3)
///     |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
///     |> close()
///
/// revolve(
///     [profile001, profile002],
///     axis = "X",
/// )
/// ```
///
/// ```no_run
/// // Revolve around a path that has not been extruded.
///
/// profile001 = startSketchOn('XY')
///     |> startProfileAt([0, 0], %)
///     |> line(end = [0, 20], tag = $revolveAxis)
///     |> line(end = [20, 0])
///     |> line(end = [0, -20])
///     |> close(%)
///
/// sketch001 = startSketchOn('XY')
///     |> circle(center = [-10, 10], radius = 4)
///     |> revolve(angle = 90, axis = revolveAxis)
/// ```
///
/// ```no_run
/// // Revolve around a path that has not been extruded or closed.
///
/// profile001 = startSketchOn('XY')
///     |> startProfileAt([0, 0], %)
///     |> line(end = [0, 20], tag = $revolveAxis)
///     |> line(end = [20, 0])
///
/// sketch001 = startSketchOn('XY')
///     |> circle(center = [-10, 10], radius = 4)
///     |> revolve(angle = 90, axis = revolveAxis)
/// ```
#[stdlib {
    name = "revolve",
    feature_tree_operation = true,
    keywords = true,
    unlabeled_first = true,
    args = {
        sketches = { docs = "The sketch or set of sketches that should be revolved" },
        axis = { docs = "Axis of revolution." },
        angle = { docs = "Angle to revolve (in degrees). Default is 360." },
        tolerance = { docs = "Tolerance for the revolve operation." },
        tag_start = { docs = "A named tag for the face at the start of the revolve, i.e. the original sketch" },
        tag_end = { docs = "A named tag for the face at the end of the revolve" },
    }
}]
#[allow(clippy::too_many_arguments)]
async fn inner_revolve(
    sketches: Vec<Sketch>,
    axis: Axis2dOrEdgeReference,
    angle: Option<f64>,
    tolerance: Option<f64>,
    tag_start: Option<TagNode>,
    tag_end: Option<TagNode>,
    exec_state: &mut ExecState,
    args: Args,
) -> Result<Vec<Solid>, KclError> {
    if let Some(angle) = angle {
        // Return an error if the angle is zero.
        // We don't use validate() here because we want to return a specific error message that is
        // nice and we use the other data in the docs, so we still need use the derive above for the json schema.
        if !(-360.0..=360.0).contains(&angle) || angle == 0.0 {
            return Err(KclError::Semantic(KclErrorDetails {
                message: format!("Expected angle to be between -360 and 360 and not 0, found `{}`", angle),
                source_ranges: vec![args.source_range],
            }));
        }
    }

    let angle = Angle::from_degrees(angle.unwrap_or(360.0));

    let mut solids = Vec::new();
    for sketch in &sketches {
        let id = exec_state.next_uuid();

        match &axis {
            Axis2dOrEdgeReference::Axis(axis) => {
                let (axis, origin) = axis.axis_and_origin()?;
                args.batch_modeling_cmd(
                    id,
                    ModelingCmd::from(mcmd::Revolve {
                        angle,
                        target: sketch.id.into(),
                        axis,
                        origin,
                        tolerance: LengthUnit(tolerance.unwrap_or(default_tolerance(&args.ctx.settings.units))),
                        axis_is_2d: true,
                    }),
                )
                .await?;
            }
            Axis2dOrEdgeReference::Edge(edge) => {
                let edge_id = edge.get_engine_id(exec_state, &args)?;
                args.batch_modeling_cmd(
                    id,
                    ModelingCmd::from(mcmd::RevolveAboutEdge {
                        angle,
                        target: sketch.id.into(),
                        edge_id,
                        tolerance: LengthUnit(tolerance.unwrap_or(default_tolerance(&args.ctx.settings.units))),
                    }),
                )
                .await?;
            }
        }

        solids.push(
            do_post_extrude(
                sketch,
                id.into(),
                0.0,
                false,
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

    Ok(solids)
}
