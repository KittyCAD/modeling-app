//! Standard library lofts.

use std::num::NonZeroU32;

use anyhow::Result;
use kcmc::ModelingCmd;
use kcmc::each_cmd as mcmd;
use kcmc::length_unit::LengthUnit;
use kcmc::shared::BodyType;
use kittycad_modeling_cmds as kcmc;

use super::DEFAULT_TOLERANCE_MM;
use super::args::TyF64;
use crate::errors::KclError;
use crate::errors::KclErrorDetails;
use crate::execution::ExecState;
use crate::execution::ExecutorContext;
use crate::execution::KclValue;
use crate::execution::ModelingCmdMeta;
use crate::execution::Path;
use crate::execution::ProfileClosed;
use crate::execution::Sketch;
use crate::execution::Solid;
use crate::execution::types::ArrayLen;
use crate::execution::types::RuntimeType;
use crate::parsing::ast::types::TagNode;
use crate::std::Args;
use crate::std::args::FromKclValue;
use crate::std::extrude::build_segment_surface_sketch;
use crate::std::extrude::do_post_extrude;

const DEFAULT_V_DEGREE: u32 = 2;

/// Create a 3D surface or solid by interpolating between two or more sketches.
pub async fn loft(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let sketch_values: Vec<KclValue> = args.get_unlabeled_kw_arg(
        "sketches",
        &RuntimeType::Array(
            Box::new(RuntimeType::Union(vec![RuntimeType::sketch(), RuntimeType::segment()])),
            ArrayLen::Minimum(2),
        ),
        exec_state,
    )?;
    let v_degree: NonZeroU32 = args
        .get_kw_arg_opt("vDegree", &RuntimeType::count(), exec_state)?
        .unwrap_or(NonZeroU32::new(DEFAULT_V_DEGREE).unwrap());
    // Attempt to approximate rational curves (such as arcs) using a bezier.
    // This will remove banding around interpolations between arcs and non-arcs.  It may produce errors in other scenarios
    // Over time, this field won't be necessary.
    let bez_approximate_rational = args
        .get_kw_arg_opt("bezApproximateRational", &RuntimeType::bool(), exec_state)?
        .unwrap_or(false);
    // This can be set to override the automatically determined topological base curve, which is usually the first section encountered.
    let base_curve_index: Option<u32> = args.get_kw_arg_opt("baseCurveIndex", &RuntimeType::count(), exec_state)?;
    // Tolerance for the loft operation.
    let tolerance: Option<TyF64> = args.get_kw_arg_opt("tolerance", &RuntimeType::length(), exec_state)?;
    let tag_start = args.get_kw_arg_opt("tagStart", &RuntimeType::tag_decl(), exec_state)?;
    let tag_end = args.get_kw_arg_opt("tagEnd", &RuntimeType::tag_decl(), exec_state)?;
    let body_type: Option<BodyType> = args.get_kw_arg_opt("bodyType", &RuntimeType::string(), exec_state)?;

    let sketches = coerce_loft_targets(
        sketch_values,
        body_type.unwrap_or_default(),
        tag_start.as_ref(),
        tag_end.as_ref(),
        exec_state,
        &args.ctx,
        args.source_range,
    )
    .await?;
    let value = inner_loft(
        sketches,
        v_degree,
        bez_approximate_rational,
        base_curve_index,
        tolerance,
        tag_start,
        tag_end,
        body_type,
        exec_state,
        args,
    )
    .await?;
    Ok(KclValue::Solid { value })
}

async fn coerce_loft_targets(
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
                "Expected sketches or solved sketch segments for loft.".to_owned(),
                vec![source_range],
            )));
        };
        sketches.push(sketch);
    }

    if !segments.is_empty() && !sketches.is_empty() {
        return Err(KclError::new_semantic(KclErrorDetails::new(
            "Cannot loft sketch segments together with sketches in the same call. Use separate `loft()` calls."
                .to_owned(),
            vec![source_range],
        )));
    }

    if !segments.is_empty() {
        if !matches!(body_type, BodyType::Surface) {
            return Err(KclError::new_semantic(KclErrorDetails::new(
                "Lofting sketch segments is only supported for surface lofts. Set `bodyType = SURFACE`.".to_owned(),
                vec![source_range],
            )));
        }

        if tag_start.is_some() || tag_end.is_some() {
            return Err(KclError::new_semantic(KclErrorDetails::new(
                "`tagStart` and `tagEnd` are not supported when lofting sketch segments. Segment surface lofts do not create start or end caps."
                    .to_owned(),
                vec![source_range],
            )));
        }

        let mut loft_sections = Vec::with_capacity(segments.len());
        for segment in segments {
            loft_sections.push(build_segment_surface_sketch(vec![segment], exec_state, ctx, source_range).await?);
        }
        return Ok(loft_sections);
    }

    Ok(sketches)
}

#[allow(clippy::too_many_arguments)]
async fn inner_loft(
    sketches: Vec<Sketch>,
    v_degree: NonZeroU32,
    bez_approximate_rational: bool,
    base_curve_index: Option<u32>,
    tolerance: Option<TyF64>,
    tag_start: Option<TagNode>,
    tag_end: Option<TagNode>,
    body_type: Option<BodyType>,
    exec_state: &mut ExecState,
    args: Args,
) -> Result<Box<Solid>, KclError> {
    let body_type = body_type.unwrap_or_default();
    if matches!(body_type, BodyType::Solid) && sketches.iter().any(|sk| matches!(sk.is_closed, ProfileClosed::No)) {
        return Err(KclError::new_semantic(KclErrorDetails::new(
            "Cannot solid loft an open profile. Either close the profile, or use a surface loft.".to_owned(),
            vec![args.source_range],
        )));
    }

    // Make sure we have at least two sketches.
    if sketches.len() < 2 {
        return Err(KclError::new_semantic(KclErrorDetails::new(
            format!(
                "Loft requires at least two sketches, but only {} were provided.",
                sketches.len()
            ),
            vec![args.source_range],
        )));
    }

    let id = exec_state.next_uuid();
    exec_state
        .batch_modeling_cmd(
            ModelingCmdMeta::from_args_id(exec_state, &args, id),
            ModelingCmd::from(
                mcmd::Loft::builder()
                    .section_ids(sketches.iter().map(|group| group.id).collect())
                    .bez_approximate_rational(bez_approximate_rational)
                    .tolerance(LengthUnit(
                        tolerance.as_ref().map(|t| t.to_mm()).unwrap_or(DEFAULT_TOLERANCE_MM),
                    ))
                    .v_degree(v_degree)
                    .body_type(body_type)
                    .maybe_base_curve_index(base_curve_index)
                    .build(),
            ),
        )
        .await?;

    // Choose the base curve.
    // Try to avoid choosing a circle...
    let first_noncircle_sketch = sketches.iter().find(|sketch| {
        // There must be a path in the sketch
        let Some(first_path) = sketch.paths.first() else {
            return false;
        };
        // And that path cannot be a circle, because I think it makes the engine
        // do something weird.
        if matches!(first_path, Path::Circle { .. }) {
            return false;
        };
        true
    });
    // ...but if you have to, then OK.
    let sketch: &Sketch = first_noncircle_sketch.clone().unwrap_or(&sketches[0]);
    let mut sketch: Sketch = sketch.clone();
    // Override its id with the loft id so we can get its faces later
    sketch.id = id;
    Ok(Box::new(
        do_post_extrude(
            &sketch,
            id.into(),
            false,
            &super::extrude::NamedCapTags {
                start: tag_start.as_ref(),
                end: tag_end.as_ref(),
            },
            kittycad_modeling_cmds::shared::ExtrudeMethod::New,
            exec_state,
            &args,
            None,
            None,
            body_type,
            crate::std::extrude::BeingExtruded::Sketch,
        )
        .await?,
    ))
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
    use crate::front::LineCtor;
    use crate::front::Number;
    use crate::front::ObjectId;
    use crate::front::Point2d;
    use crate::parsing::ast::types::TagDeclarator;
    use crate::std::sketch::PlaneData;

    fn point_expr(x: f64, y: f64) -> Point2d<Expr> {
        Point2d {
            x: Expr::Var(Number::from((x, UnitLength::Millimeters))),
            y: Expr::Var(Number::from((y, UnitLength::Millimeters))),
        }
    }

    fn line_segment_value(exec_state: &mut ExecState, plane_data: PlaneData, object_id_seed: usize) -> KclValue {
        let plane = Plane::from_plane_data_skipping_engine(plane_data, exec_state).unwrap();
        let start = [TyF64::new(-2.0, NumericType::mm()), TyF64::new(0.0, NumericType::mm())];
        let end = [TyF64::new(2.0, NumericType::mm()), TyF64::new(0.0, NumericType::mm())];
        let segment = Segment {
            id: exec_state.next_uuid(),
            object_id: ObjectId(object_id_seed),
            kind: SegmentKind::Line {
                start,
                end,
                ctor: Box::new(LineCtor {
                    start: point_expr(-2.0, 0.0),
                    end: point_expr(2.0, 0.0),
                    construction: None,
                }),
                start_object_id: ObjectId(object_id_seed + 1),
                end_object_id: ObjectId(object_id_seed + 2),
                start_freedom: None,
                end_freedom: None,
                construction: false,
            },
            surface: SketchSurface::Plane(Box::new(plane)),
            sketch_id: exec_state.next_uuid(),
            sketch: None,
            tag: None,
            meta: vec![],
            node_path: None,
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
    async fn segment_loft_supports_sections_from_different_sketches() {
        let ctx = ExecutorContext::new_mock(None).await;
        let mut exec_state = ExecState::new(&ctx);
        let sketches = coerce_loft_targets(
            vec![
                line_segment_value(&mut exec_state, PlaneData::XY, 1),
                line_segment_value(&mut exec_state, PlaneData::NegXY, 10),
                line_segment_value(&mut exec_state, PlaneData::XZ, 20),
            ],
            BodyType::Surface,
            None,
            None,
            &mut exec_state,
            &ctx,
            crate::SourceRange::default(),
        )
        .await
        .unwrap();

        assert_eq!(sketches.len(), 3);
        assert!(sketches.iter().all(|sketch| sketch.paths.len() == 1));
        assert_ne!(sketches[0].id, sketches[1].id);
        assert_ne!(sketches[1].id, sketches[2].id);
        ctx.close().await;
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn segment_loft_rejects_cap_tags() {
        let ctx = ExecutorContext::new_mock(None).await;
        let mut exec_state = ExecState::new(&ctx);
        let err = coerce_loft_targets(
            vec![line_segment_value(&mut exec_state, PlaneData::XY, 1)],
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
                .contains("`tagStart` and `tagEnd` are not supported when lofting sketch segments"),
            "{err:?}"
        );
        ctx.close().await;
    }
}
