//! Standard library revolution surfaces.

use anyhow::Result;
use kcmc::ModelingCmd;
use kcmc::each_cmd as mcmd;
use kcmc::length_unit::LengthUnit;
use kcmc::shared::Angle;
use kcmc::shared::Opposite;
use kittycad_modeling_cmds::shared::BodyType;
use kittycad_modeling_cmds::shared::Point3d;
use kittycad_modeling_cmds::{self as kcmc};

use super::DEFAULT_TOLERANCE_MM;
use super::args::TyF64;
use crate::errors::KclError;
use crate::errors::KclErrorDetails;
use crate::execution::ExecState;
use crate::execution::ExecutorContext;
use crate::execution::KclValue;
use crate::execution::ModelingCmdMeta;
use crate::execution::Sketch;
use crate::execution::Solid;
use crate::execution::types::ArrayLen;
use crate::execution::types::PrimitiveType;
use crate::execution::types::RuntimeType;
use crate::parsing::ast::types::TagNode;
use crate::std::Args;
use crate::std::args::FromKclValue;
use crate::std::axis_or_reference::Axis2dOrEdgeReference;
use crate::std::extrude::build_segment_surface_sketch;
use crate::std::extrude::do_post_extrude;

extern crate nalgebra_glm as glm;

/// Revolve a sketch or set of sketches around an axis.
pub async fn revolve(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let sketch_values: Vec<KclValue> = args.get_unlabeled_kw_arg(
        "sketches",
        &RuntimeType::Array(
            Box::new(RuntimeType::Union(vec![RuntimeType::sketch(), RuntimeType::segment()])),
            ArrayLen::Minimum(1),
        ),
        exec_state,
    )?;
    let axis = args.get_kw_arg(
        "axis",
        &RuntimeType::Union(vec![
            RuntimeType::Primitive(PrimitiveType::Edge),
            RuntimeType::Primitive(PrimitiveType::Axis2d),
            RuntimeType::segment(),
        ]),
        exec_state,
    )?;
    let angle: Option<TyF64> = args.get_kw_arg_opt("angle", &RuntimeType::degrees(), exec_state)?;
    let tolerance: Option<TyF64> = args.get_kw_arg_opt("tolerance", &RuntimeType::length(), exec_state)?;
    let tag_start = args.get_kw_arg_opt("tagStart", &RuntimeType::tag_decl(), exec_state)?;
    let tag_end = args.get_kw_arg_opt("tagEnd", &RuntimeType::tag_decl(), exec_state)?;
    let symmetric = args.get_kw_arg_opt("symmetric", &RuntimeType::bool(), exec_state)?;
    let bidirectional_angle: Option<TyF64> =
        args.get_kw_arg_opt("bidirectionalAngle", &RuntimeType::angle(), exec_state)?;
    let body_type: BodyType = args
        .get_kw_arg_opt("bodyType", &RuntimeType::string(), exec_state)?
        .unwrap_or_default();
    let sketches = coerce_revolve_targets(
        sketch_values,
        body_type,
        tag_start.as_ref(),
        tag_end.as_ref(),
        exec_state,
        &args.ctx,
        args.source_range,
    )
    .await?;

    let value = inner_revolve(
        sketches,
        axis,
        angle.map(|t| t.n),
        tolerance,
        tag_start,
        tag_end,
        symmetric,
        bidirectional_angle.map(|t| t.n),
        body_type,
        exec_state,
        args,
    )
    .await?;
    Ok(value.into())
}

#[allow(clippy::too_many_arguments)]
async fn inner_revolve(
    sketches: Vec<Sketch>,
    axis: Axis2dOrEdgeReference,
    angle: Option<f64>,
    tolerance: Option<TyF64>,
    tag_start: Option<TagNode>,
    tag_end: Option<TagNode>,
    symmetric: Option<bool>,
    bidirectional_angle: Option<f64>,
    body_type: BodyType,
    exec_state: &mut ExecState,
    args: Args,
) -> Result<Vec<Solid>, KclError> {
    if let Some(angle) = angle {
        // Return an error if the angle is zero.
        // We don't use validate() here because we want to return a specific error message that is
        // nice and we use the other data in the docs, so we still need use the derive above for the json schema.
        if !(-360.0..=360.0).contains(&angle) || angle == 0.0 {
            return Err(KclError::new_semantic(KclErrorDetails::new(
                format!("Expected angle to be between -360 and 360 and not 0, found `{angle}`"),
                vec![args.source_range],
            )));
        }
    }

    if let Some(bidirectional_angle) = bidirectional_angle {
        // Return an error if the angle is zero.
        // We don't use validate() here because we want to return a specific error message that is
        // nice and we use the other data in the docs, so we still need use the derive above for the json schema.
        if !(-360.0..=360.0).contains(&bidirectional_angle) || bidirectional_angle == 0.0 {
            return Err(KclError::new_semantic(KclErrorDetails::new(
                format!(
                    "Expected bidirectional angle to be between -360 and 360 and not 0, found `{bidirectional_angle}`"
                ),
                vec![args.source_range],
            )));
        }

        if let Some(angle) = angle {
            let ang = angle.signum() * bidirectional_angle + angle;
            if !(-360.0..=360.0).contains(&ang) {
                return Err(KclError::new_semantic(KclErrorDetails::new(
                    format!("Combined angle and bidirectional must be between -360 and 360, found '{ang}'"),
                    vec![args.source_range],
                )));
            }
        }
    }

    if symmetric.unwrap_or(false) && bidirectional_angle.is_some() {
        return Err(KclError::new_semantic(KclErrorDetails::new(
            "You cannot give both `symmetric` and `bidirectional` params, you have to choose one or the other"
                .to_owned(),
            vec![args.source_range],
        )));
    }

    let angle = Angle::from_degrees(angle.unwrap_or(360.0));

    let bidirectional_angle = bidirectional_angle.map(Angle::from_degrees);

    let opposite = match (symmetric, bidirectional_angle) {
        (Some(true), _) => Opposite::Symmetric,
        (None, None) => Opposite::None,
        (Some(false), None) => Opposite::None,
        (None, Some(angle)) => Opposite::Other(angle),
        (Some(false), Some(angle)) => Opposite::Other(angle),
    };

    let mut solids = Vec::new();
    for sketch in &sketches {
        let new_solid_id = exec_state.next_uuid();
        let tolerance = tolerance.as_ref().map(|t| t.to_mm()).unwrap_or(DEFAULT_TOLERANCE_MM);

        let direction = match &axis {
            Axis2dOrEdgeReference::Axis { direction, origin } => {
                exec_state
                    .batch_modeling_cmd(
                        ModelingCmdMeta::from_args_id(exec_state, &args, new_solid_id),
                        ModelingCmd::from(
                            mcmd::Revolve::builder()
                                .angle(angle)
                                .target(sketch.id.into())
                                .axis(Point3d {
                                    x: direction[0].to_mm(),
                                    y: direction[1].to_mm(),
                                    z: 0.0,
                                })
                                .origin(Point3d {
                                    x: LengthUnit(origin[0].to_mm()),
                                    y: LengthUnit(origin[1].to_mm()),
                                    z: LengthUnit(0.0),
                                })
                                .tolerance(LengthUnit(tolerance))
                                .axis_is_2d(true)
                                .opposite(opposite.clone())
                                .body_type(body_type)
                                .build(),
                        ),
                    )
                    .await?;
                glm::DVec2::new(direction[0].to_mm(), direction[1].to_mm())
            }
            Axis2dOrEdgeReference::Edge(edge) => {
                let edge_id = edge.get_engine_id(exec_state, &args)?;
                exec_state
                    .batch_modeling_cmd(
                        ModelingCmdMeta::from_args_id(exec_state, &args, new_solid_id),
                        ModelingCmd::from(
                            mcmd::RevolveAboutEdge::builder()
                                .angle(angle)
                                .target(sketch.id.into())
                                .edge_id(edge_id)
                                .tolerance(LengthUnit(tolerance))
                                .opposite(opposite.clone())
                                .body_type(body_type)
                                .build(),
                        ),
                    )
                    .await?;
                //TODO: fix me! Need to be able to calculate this to ensure the path isn't colinear
                glm::DVec2::new(0.0, 1.0)
            }
        };

        let mut edge_id = None;
        // If an edge lies on the axis of revolution it will not exist after the revolve, so
        // it cannot be used to retrieve data about the solid
        for path in sketch.paths.clone() {
            if sketch.synthetic_jump_path_ids.contains(&path.get_id()) {
                continue;
            }

            if !path.is_straight_line() {
                edge_id = Some(path.get_id());
                break;
            }

            let from = path.get_from();
            let to = path.get_to();

            let dir = glm::DVec2::new(to[0].n - from[0].n, to[1].n - from[1].n);
            if glm::are_collinear2d(&dir, &direction, tolerance) {
                continue;
            }
            edge_id = Some(path.get_id());
            break;
        }

        solids.push(
            do_post_extrude(
                sketch,
                new_solid_id.into(),
                false,
                &super::extrude::NamedCapTags {
                    start: tag_start.as_ref(),
                    end: tag_end.as_ref(),
                },
                kittycad_modeling_cmds::shared::ExtrudeMethod::New,
                exec_state,
                &args,
                edge_id,
                None,
                body_type,
                crate::std::extrude::BeingExtruded::Sketch,
            )
            .await?,
        );
    }

    Ok(solids)
}

async fn coerce_revolve_targets(
    sketch_values: Vec<KclValue>,
    body_type: BodyType,
    tag_start: Option<&TagNode>,
    tag_end: Option<&TagNode>,
    exec_state: &mut ExecState,
    ctx: &ExecutorContext,
    source_range: crate::SourceRange,
) -> Result<Vec<Sketch>, KclError> {
    let mut sketches = Vec::new();
    let mut segments = Vec::new();

    for value in sketch_values {
        if let Some(segment) = value.clone().into_segment() {
            segments.push(segment);
            continue;
        }

        let Some(sketch) = Sketch::from_kcl_val(&value) else {
            return Err(KclError::new_type(KclErrorDetails::new(
                "Expected sketches or solved sketch segments for revolve.".to_owned(),
                vec![source_range],
            )));
        };
        sketches.push(sketch);
    }

    if !segments.is_empty() && !sketches.is_empty() {
        return Err(KclError::new_semantic(KclErrorDetails::new(
            "Cannot revolve sketch segments together with sketches in the same call. Use separate `revolve()` calls."
                .to_owned(),
            vec![source_range],
        )));
    }

    if !segments.is_empty() {
        if !matches!(body_type, BodyType::Surface) {
            return Err(KclError::new_semantic(KclErrorDetails::new(
                "Revolving sketch segments is only supported for surface revolves. Set `bodyType = SURFACE`."
                    .to_owned(),
                vec![source_range],
            )));
        }

        if tag_start.is_some() || tag_end.is_some() {
            return Err(KclError::new_semantic(KclErrorDetails::new(
                "`tagStart` and `tagEnd` are not supported when revolving sketch segments. Segment surface revolves do not create start or end caps."
                    .to_owned(),
                vec![source_range],
            )));
        }

        let synthetic_sketch = build_segment_surface_sketch(segments, exec_state, ctx, source_range).await?;
        return Ok(vec![synthetic_sketch]);
    }

    Ok(sketches)
}

#[cfg(test)]
mod tests {
    use kittycad_modeling_cmds::units::UnitLength;

    use super::*;
    use crate::execution::AbstractSegment;
    use crate::execution::Plane;
    use crate::execution::Segment;
    use crate::execution::SegmentKind;
    use crate::execution::SegmentRepr;
    use crate::execution::SketchSurface;
    use crate::execution::types::NumericType;
    use crate::front::Expr;
    use crate::front::Number;
    use crate::front::ObjectId;
    use crate::front::Point2d;
    use crate::front::PointCtor;
    use crate::parsing::ast::types::TagDeclarator;
    use crate::std::sketch::PlaneData;

    fn point_expr(x: f64, y: f64) -> Point2d<Expr> {
        Point2d {
            x: Expr::Var(Number::from((x, UnitLength::Millimeters))),
            y: Expr::Var(Number::from((y, UnitLength::Millimeters))),
        }
    }

    fn segment_value(exec_state: &mut ExecState) -> KclValue {
        let plane = Plane::from_plane_data_skipping_engine(PlaneData::XY, exec_state).unwrap();
        let segment = Segment {
            id: exec_state.next_uuid(),
            object_id: ObjectId(1),
            kind: SegmentKind::Point {
                position: [TyF64::new(0.0, NumericType::mm()), TyF64::new(0.0, NumericType::mm())],
                ctor: Box::new(PointCtor {
                    position: point_expr(0.0, 0.0),
                }),
                freedom: None,
            },
            surface: SketchSurface::Plane(Box::new(plane)),
            sketch_id: exec_state.next_uuid(),
            sketch: None,
            tag: None,
            meta: vec![],
        };
        KclValue::Segment {
            value: Box::new(AbstractSegment {
                repr: SegmentRepr::Solved {
                    segment: Box::new(segment),
                },
                meta: vec![],
            }),
        }
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn segment_revolve_rejects_cap_tags() {
        let ctx = ExecutorContext::new_mock(None).await;
        let mut exec_state = ExecState::new(&ctx);
        let err = coerce_revolve_targets(
            vec![segment_value(&mut exec_state)],
            BodyType::Surface,
            Some(&TagDeclarator::new("cap_start")),
            None,
            &mut exec_state,
            &ctx,
            crate::SourceRange::default(),
        )
        .await
        .unwrap_err();

        assert!(
            err.message()
                .contains("`tagStart` and `tagEnd` are not supported when revolving sketch segments"),
            "{err:?}"
        );
        ctx.close().await;
    }
}
