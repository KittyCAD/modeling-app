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
            ModelingCmd::from(if let Some(base_curve_index) = base_curve_index {
                mcmd::Loft::builder()
                    .section_ids(sketches.iter().map(|group| group.id).collect())
                    .bez_approximate_rational(bez_approximate_rational)
                    .tolerance(LengthUnit(
                        tolerance
                            .as_ref()
                            .map(|t| t.unwrap_to_mm())
                            .unwrap_or(DEFAULT_TOLERANCE_MM),
                    ))
                    .v_degree(v_degree)
                    .body_type(body_type)
                    .base_curve_index(base_curve_index)
                    .build()
            } else {
                mcmd::Loft::builder()
                    .section_ids(sketches.iter().map(|group| group.id).collect())
                    .bez_approximate_rational(bez_approximate_rational)
                    .tolerance(LengthUnit(
                        tolerance
                            .as_ref()
                            .map(|t| t.unwrap_to_mm())
                            .unwrap_or(DEFAULT_TOLERANCE_MM),
                    ))
                    .v_degree(v_degree)
                    .body_type(body_type)
                    .build()
            }),
        )
        .await?;

    // Using the first sketch as the base curve, idk we might want to change this later.
    let mut sketch = sketches[0].clone();
    // A loft creates a new engine body rather than reusing its first section.
    // Keep both ID fields on the new body so follow-up operations query the
    // loft instead of the first section's path object.
    sketch.id = id;
    sketch.original_id = id;
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
    use kcl_api::UnitLength;

    use super::*;
    use crate::execution::AbstractSegment;
    use crate::execution::Geometry;
    use crate::execution::KclValue;
    use crate::execution::Plane;
    use crate::execution::Segment;
    use crate::execution::SegmentKind;
    use crate::execution::SegmentRepr;
    use crate::execution::SketchSurface;
    use crate::execution::parse_execute;
    use crate::execution::types::NumericType;
    use crate::execution::types::NumericTypeExt;
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

    #[tokio::test(flavor = "multi_thread")]
    async fn loft_uses_its_body_id_for_topology_queries() {
        let result = parse_execute(
            r#"@settings(kclVersion = 2.0)

firstSketch = sketch(on = XY) {
  circle1 = circle(start = [var 10, var 0], center = [var 0, var 0])
}
secondSketch = sketch(on = offsetPlane(XY, offset = 10)) {
  circle1 = circle(start = [var 5, var 0], center = [var 0, var 0])
}

lofted = loft([
  region(segments = [firstSketch.circle1]),
  region(segments = [secondSketch.circle1]),
])
"#,
        )
        .await
        .expect("loft executes");

        let KclValue::Solid { value: solid } = result.variable("lofted") else {
            panic!("`lofted` is not a solid");
        };
        assert_eq!(solid.id, solid.topology_id());
        assert_eq!(
            solid.sketch().expect("loft retains its base sketch").original_id,
            solid.id
        );
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn loft_updates_region_edge_tags_to_faces() {
        for upper_profile in [
            r#"line1 = line(start = [var 0mm, var 0mm], end = [var 8mm, var 0mm])
  line2 = line(start = [var 8mm, var 0mm], end = [var 4mm, var 8mm])
  line3 = line(start = [var 4mm, var 8mm], end = [var 0mm, var 0mm])"#,
            r#"line1 = line(start = [var 0mm, var 0mm], end = [var 8mm, var 0mm])
  line2 = line(start = [var 8mm, var 0mm], end = [var 8mm, var 8mm])
  line3 = line(start = [var 8mm, var 8mm], end = [var 0mm, var 8mm])
  line4 = line(start = [var 0mm, var 8mm], end = [var 0mm, var 0mm])"#,
        ] {
            let upper_constraints = if upper_profile.contains("line4") {
                "coincident([line3.end, line4.start])\n  coincident([line4.end, line1.start])"
            } else {
                "coincident([line3.end, line1.start])"
            };
            let program = format!(
                r#"@settings(kclVersion = 3.0)
lower = sketch(on = XY) {{
  line1 = line(start = [var 0mm, var 0mm], end = [var 10mm, var 0mm])
  line2 = line(start = [var 10mm, var 0mm], end = [var 5mm, var 10mm])
  line3 = line(start = [var 5mm, var 10mm], end = [var 0mm, var 0mm])
  coincident([line1.end, line2.start])
  coincident([line2.end, line3.start])
  coincident([line3.end, line1.start])
}}
upper = sketch(on = offsetPlane(XY, offset = 10mm)) {{
  {upper_profile}
  coincident([line1.end, line2.start])
  coincident([line2.end, line3.start])
  {upper_constraints}
}}
lowerRegion = region(segments = [lower.line1, lower.line2], direction = CW)
upperRegion = region(segments = [upper.line1, upper.line2], direction = CW)
body = loft([lowerRegion, upperRegion])
gdt::annotation(faces = [lowerRegion.tags.line1], annotation = "EDGE", fontSize = 2mm)
"#
            );
            let result = parse_execute(&program).await.expect("loft edge tag resolves to a face");
            let KclValue::Sketch { value: region } = result.variable("lowerRegion") else {
                panic!("lowerRegion is not a sketch");
            };
            assert!(region.tags["line1"].get_cur_info().unwrap().surface.is_some());
        }
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn loft_updates_linearly_patterned_region_tags_to_faces() {
        let code = r#"@settings(kclVersion = 3.0, experimentalFeatures = allow)
lower = sketch(on = XY) {
  edge = circle(start = [var 10mm, var 0mm], center = [var 0mm, var 0mm])
}
upper = sketch(on = offsetPlane(XY, offset = 10mm)) {
  edge = circle(start = [var 5mm, var 0mm], center = [var 0mm, var 0mm])
}
lowerRegion = region(segments = [lower.edge])
upperRegion = region(segments = [upper.edge])
patterned = patternLinear2d(lowerRegion, instances = 2, distance = 20mm, axis = X)
lowerCopy = patterned[1]
lowerCopyAlias = lowerCopy
body = loft([lowerCopy, upperRegion])
"#;
        let result = parse_execute(code).await.expect("loft of patterned region executes");
        let KclValue::Solid { value: body } = result.variable("body") else {
            panic!("body is not a solid");
        };
        let KclValue::Sketch { value: original } = result.variable("lowerRegion") else {
            panic!("lowerRegion is not a sketch");
        };

        for name in ["lowerCopy", "lowerCopyAlias"] {
            let KclValue::Sketch { value: copy } = result.variable(name) else {
                panic!("{name} is not a sketch");
            };
            assert_eq!(copy.original_id, original.original_id);
            assert_ne!(copy.artifact_id, original.artifact_id);
            let info = copy.tags["edge"].get_cur_info().expect("pattern copy has a tag");
            assert!(info.surface.is_some(), "{name} should identify a loft face");
            let Geometry::Solid(tagged_body) = &info.geometry else {
                panic!("{name} does not have a solid face tag");
            };
            assert_eq!(tagged_body.id, body.id);
        }

        assert!(
            original.tags["edge"]
                .get_cur_info()
                .expect("original region has a tag")
                .surface
                .is_none(),
            "lofting a pattern copy should preserve the original region's sketch tag"
        );
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn loft_face_and_edge_annotations_resolve() {
        parse_execute(
            r#"@settings(kclVersion = 3.0)

sketch001 = sketch(on = XY) {
  line1 = line(start = [var -16.5mm, var -9.16mm], end = [var -12.95mm, var 21.02mm])
  line2 = line(start = [var -12.95mm, var 21.02mm], end = [var 28.04mm, var 7.59mm])
  coincident([line1.end, line2.start])
  line3 = line(start = [var 28.04mm, var 7.59mm], end = [var -16.5mm, var -9.16mm])
  coincident([line2.end, line3.start])
  coincident([line3.end, line1.start])
}
plane001 = offsetPlane(XY, offset = 15)
sketch002 = sketch(on = plane001) {
  line1 = line(start = [var -21.29mm, var 13.79mm], end = [var 12.63mm, var 22.51mm])
  line2 = line(start = [var 12.63mm, var 22.51mm], end = [var 24.51mm, var 0mm])
  coincident([line1.end, line2.start])
  horizontal([line2.end, ORIGIN])
  line3 = line(start = [var 24.51mm, var 0mm], end = [var -6.03mm, var -12.36mm])
  coincident([line2.end, line3.start])
  line4 = line(start = [var -6.03mm, var -12.36mm], end = [var -21.29mm, var 13.79mm])
  coincident([line3.end, line4.start])
  coincident([line4.end, line1.start])
}
region001 = region(segments = [sketch001.line1, sketch001.line2], direction = CW)
region002 = region(segments = [sketch002.line1, sketch002.line2], direction = CW)
loft001 = loft([region001, region002], tagStart = $capStart001, tagEnd = $capEnd001)

gdt::annotation(faces = [region001.tags.line3], annotation = "loft face", fontSize = 2.8572mm)
gdt::annotation(edges = [{ sideFaces = [region001.tags.line3, capStart001] }], annotation = "loft bottom edge", fontSize = 2.8572mm)
gdt::annotation(edges = [{ sideFaces = [region001.tags.line3, capEnd001] }], annotation = "loft top edge", fontSize = 2.8572mm)
gdt::annotation(edges = [{ sideFaces = [region001.tags.line1, region001.tags.line3] }], annotation = "loft vertical edge", fontSize = 2.8572mm)
"#,
        )
        .await
        .expect("loft face and edge annotations resolve");
    }
}
