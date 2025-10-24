use anyhow::Result;

use crate::{
    errors::{KclError, KclErrorDetails},
    execution::{
        AbstractSegment, ExecState, KclValue, SegmentRepr, UnsolvedSegment, UnsolvedSegmentKind,
        normalize_to_solver_unit,
        types::{ArrayLen, PrimitiveType, RuntimeType},
    },
    std::Args,
};

pub async fn point(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let at: Vec<KclValue> = args.get_kw_arg("at", &RuntimeType::point2d(), exec_state)?;
    if at.len() != 2 {
        return Err(KclError::new_semantic(KclErrorDetails::new(
            "at must be a 2D point".to_owned(),
            vec![args.source_range],
        )));
    }
    let Some(at_x) = at.first().unwrap().clone().as_unsolved_expr() else {
        return Err(KclError::new_semantic(KclErrorDetails::new(
            "at x must be a number or sketch var".to_owned(),
            vec![args.source_range],
        )));
    };
    let Some(at_y) = at.get(1).unwrap().clone().as_unsolved_expr() else {
        return Err(KclError::new_semantic(KclErrorDetails::new(
            "at y must be a number or sketch var".to_owned(),
            vec![args.source_range],
        )));
    };
    let segment = UnsolvedSegment {
        kind: UnsolvedSegmentKind::Point { position: [at_x, at_y] },
        meta: vec![args.source_range.into()],
    };

    // Save the segment to be sent to the engine after solving.
    let Some(sketch_state) = exec_state.sketch_block_mut() else {
        return Err(KclError::new_semantic(KclErrorDetails::new(
            "line() can only be used inside a sketch block".to_owned(),
            vec![args.source_range],
        )));
    };
    sketch_state.needed_by_engine.push(segment.clone());

    let meta = segment.meta.clone();
    let abstract_segment = AbstractSegment {
        repr: SegmentRepr::Unsolved { segment },
        meta,
    };
    Ok(KclValue::Segment {
        value: Box::new(abstract_segment),
    })
}

pub async fn line(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let start: Vec<KclValue> = args.get_kw_arg("start", &RuntimeType::point2d(), exec_state)?;
    // TODO: make this optional and add midpoint.
    let end: Vec<KclValue> = args.get_kw_arg("end", &RuntimeType::point2d(), exec_state)?;
    if start.len() != 2 {
        return Err(KclError::new_semantic(KclErrorDetails::new(
            "start must be a 2D point".to_owned(),
            vec![args.source_range],
        )));
    }
    if end.len() != 2 {
        return Err(KclError::new_semantic(KclErrorDetails::new(
            "end must be a 2D point".to_owned(),
            vec![args.source_range],
        )));
    }
    // SAFETY: checked length above.
    let Some(start_x) = start.first().unwrap().clone().as_unsolved_expr() else {
        return Err(KclError::new_semantic(KclErrorDetails::new(
            "start x must be a number or sketch var".to_owned(),
            vec![args.source_range],
        )));
    };
    let Some(start_y) = start.get(1).unwrap().clone().as_unsolved_expr() else {
        return Err(KclError::new_semantic(KclErrorDetails::new(
            "start y must be a number or sketch var".to_owned(),
            vec![args.source_range],
        )));
    };
    let Some(end_x) = end.first().unwrap().clone().as_unsolved_expr() else {
        return Err(KclError::new_semantic(KclErrorDetails::new(
            "end x must be a number or sketch var".to_owned(),
            vec![args.source_range],
        )));
    };
    let Some(end_y) = end.get(1).unwrap().clone().as_unsolved_expr() else {
        return Err(KclError::new_semantic(KclErrorDetails::new(
            "end y must be a number or sketch var".to_owned(),
            vec![args.source_range],
        )));
    };
    let segment = UnsolvedSegment {
        kind: UnsolvedSegmentKind::Line {
            start: [start_x, start_y],
            end: [end_x, end_y],
        },
        meta: vec![args.source_range.into()],
    };

    // Save the segment to be sent to the engine after solving.
    let Some(sketch_state) = exec_state.sketch_block_mut() else {
        return Err(KclError::new_semantic(KclErrorDetails::new(
            "line() can only be used inside a sketch block".to_owned(),
            vec![args.source_range],
        )));
    };
    sketch_state.needed_by_engine.push(segment.clone());

    let meta = segment.meta.clone();
    let abstract_segment = AbstractSegment {
        repr: SegmentRepr::Unsolved { segment },
        meta,
    };
    Ok(KclValue::Segment {
        value: Box::new(abstract_segment),
    })
}

pub async fn coincident(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let points: Vec<KclValue> = args.get_unlabeled_kw_arg(
        "points",
        &RuntimeType::Array(Box::new(RuntimeType::Primitive(PrimitiveType::Any)), ArrayLen::Known(2)),
        exec_state,
    )?;
    if points.len() != 2 {
        return Err(KclError::new_semantic(KclErrorDetails::new(
            "must have two input points".to_owned(),
            vec![args.source_range],
        )));
    }

    let range = args.source_range;
    match (&points[0], &points[1]) {
        (
            KclValue::Segment { value: seg },
            KclValue::HomArray { value: arr, .. } | KclValue::Tuple { value: arr, .. },
        ) => add_coincident_segment_point_array(seg, arr, true, exec_state, &args),
        (
            KclValue::HomArray { value: arr, .. } | KclValue::Tuple { value: arr, .. },
            KclValue::Segment { value: seg },
        ) => add_coincident_segment_point_array(seg, arr, false, exec_state, &args),
        (KclValue::Segment { value: seg0 }, KclValue::Segment { value: seg1 }) => {
            let SegmentRepr::Unsolved { segment: unsolved0 } = &seg0.repr else {
                return Err(KclError::new_semantic(KclErrorDetails::new(
                    "first point must be an unsolved segment".to_owned(),
                    vec![args.source_range],
                )));
            };
            let SegmentRepr::Unsolved { segment: unsolved1 } = &seg1.repr else {
                return Err(KclError::new_semantic(KclErrorDetails::new(
                    "second point must be an unsolved segment".to_owned(),
                    vec![args.source_range],
                )));
            };
            match (&unsolved0.kind, &unsolved1.kind) {
                (UnsolvedSegmentKind::Point { position: pos0 }, UnsolvedSegmentKind::Point { position: pos1 }) => {
                    let p0_x = pos0[0].var().ok_or_else(|| {
                        KclError::new_semantic(KclErrorDetails::new(
                            "input point at index 0 must be a sketch var for both x and y coordinates to constrain as coincident"
                                .to_owned(),
                            vec![args.source_range],
                        ))
                    })?;
                    let p0_y = pos0[1].var().ok_or_else(|| {
                        KclError::new_semantic(KclErrorDetails::new(
                            "input point at index 0 must be a sketch var for both x and y coordinates to constrain as coincident"
                                .to_owned(),
                            vec![args.source_range],
                        ))
                    })?;
                    let p1_x = pos1[0].var().ok_or_else(|| {
                        KclError::new_semantic(KclErrorDetails::new(
                            "input point at index 1 must be a sketch var for both x and y coordinates to constrain as coincident"
                                .to_owned(),
                            vec![args.source_range],
                        ))
                    })?;
                    let p1_y = pos1[1].var().ok_or_else(|| {
                        KclError::new_semantic(KclErrorDetails::new(
                            "input point at index 1 must be a sketch var for both x and y coordinates to constrain as coincident"
                                .to_owned(),
                            vec![args.source_range],
                        ))
                    })?;
                    let constraint = kcl_ezpz::Constraint::PointsCoincident(
                        kcl_ezpz::datatypes::DatumPoint::new_xy(
                            p0_x.to_constraint_id(range)?,
                            p0_y.to_constraint_id(range)?,
                        ),
                        kcl_ezpz::datatypes::DatumPoint::new_xy(
                            p1_x.to_constraint_id(range)?,
                            p1_y.to_constraint_id(range)?,
                        ),
                    );
                    // Save the constraint to be used for solving.
                    let Some(sketch_state) = exec_state.sketch_block_mut() else {
                        return Err(KclError::new_semantic(KclErrorDetails::new(
                            "coincident() can only be used inside a sketch block".to_owned(),
                            vec![args.source_range],
                        )));
                    };
                    sketch_state.constraints.push(constraint);
                    Ok(KclValue::none())
                }
                _ => Err(KclError::new_semantic(KclErrorDetails::new(
                    "both inputs must be points".to_owned(),
                    vec![args.source_range],
                ))),
            }
        }
        _ => Err(KclError::new_semantic(KclErrorDetails::new(
            "all inputs must be segments".to_owned(),
            vec![args.source_range],
        ))),
    }
}

fn add_coincident_segment_point_array(
    segment: &AbstractSegment,
    arr: &[KclValue],
    segment_is_first: bool,
    exec_state: &mut ExecState,
    args: &Args,
) -> Result<KclValue, KclError> {
    let segment_index = if segment_is_first { 0 } else { 1 };
    let array_index = if segment_is_first { 1 } else { 0 };
    if arr.len() != 2 {
        return Err(KclError::new_semantic(KclErrorDetails::new(
            format!(
                "point at index {array_index} must be a 2D point, but found length {}",
                arr.len()
            ),
            vec![args.source_range],
        )));
    }
    let SegmentRepr::Unsolved { segment: unsolved } = &segment.repr else {
        return Err(KclError::new_semantic(KclErrorDetails::new(
            "input point must be an unsolved segment".to_owned(),
            vec![args.source_range],
        )));
    };
    match &unsolved.kind {
        UnsolvedSegmentKind::Point { position } => {
            let p0_x = position[0].var().ok_or_else(|| {
                KclError::new_semantic(KclErrorDetails::new(
                    format!("input point at index {segment_index} must be a sketch var for both x and y coordinates to constrain as coincident"),
                    vec![args.source_range],
                ))
            })?;
            let p0_y = position[1].var().ok_or_else(|| {
                KclError::new_semantic(KclErrorDetails::new(
                    format!("input point at index {segment_index} must be a sketch var for both x and y coordinates to constrain as coincident"),
                    vec![args.source_range],
                ))
            })?;
            let p1_x = &arr[0];
            let p1_y = &arr[1];
            let p1_x_number_value =
                normalize_to_solver_unit(p1_x, p1_x.into(), exec_state, "coincident constraint value")?;
            let p1_y_number_value =
                normalize_to_solver_unit(p1_y, p1_y.into(), exec_state, "coincident constraint value")?;
            let Some(p1_x) = p1_x_number_value.as_ty_f64() else {
                let message = format!(
                    "Expected number after coercion, but found {}",
                    p1_x_number_value.human_friendly_type()
                );
                debug_assert!(false, "{}", &message);
                return Err(KclError::new_internal(KclErrorDetails::new(
                    message,
                    vec![args.source_range],
                )));
            };
            let Some(p1_y) = p1_y_number_value.as_ty_f64() else {
                let message = format!(
                    "Expected number after coercion, but found {}",
                    p1_y_number_value.human_friendly_type()
                );
                debug_assert!(false, "{}", &message);
                return Err(KclError::new_internal(KclErrorDetails::new(
                    message,
                    vec![args.source_range],
                )));
            };
            let constraint_x = kcl_ezpz::Constraint::Fixed(p0_x.to_constraint_id(args.source_range)?, p1_x.n);
            let constraint_y = kcl_ezpz::Constraint::Fixed(p0_y.to_constraint_id(args.source_range)?, p1_y.n);
            // Save the constraint to be used for solving.
            let Some(sketch_state) = exec_state.sketch_block_mut() else {
                return Err(KclError::new_semantic(KclErrorDetails::new(
                    "coincident() can only be used inside a sketch block".to_owned(),
                    vec![args.source_range],
                )));
            };
            sketch_state.constraints.push(constraint_x);
            sketch_state.constraints.push(constraint_y);
            Ok(KclValue::none())
        }
        UnsolvedSegmentKind::Line { .. } => Err(KclError::new_semantic(KclErrorDetails::new(
            format!("both inputs must be points, but found line at index {segment_index}"),
            vec![args.source_range],
        ))),
    }
}

pub async fn parallel(_exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    Err(KclError::Internal {
        details: KclErrorDetails::new("Not yet implemented".to_owned(), vec![args.source_range]),
    })
}
