use anyhow::Result;

use crate::{
    errors::{KclError, KclErrorDetails},
    execution::{
        AbstractSegment, ExecState, KclValue, SegmentRepr, SketchVarId, UnsolvedExpr, UnsolvedSegment,
        UnsolvedSegmentKind, normalize_to_solver_unit,
        types::{ArrayLen, PrimitiveType, RuntimeType},
    },
    front::{LineCtor, Point2d, PointCtor},
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
    let at_x_value = at.first().unwrap().clone();
    let Some(at_x) = at_x_value.as_unsolved_expr() else {
        return Err(KclError::new_semantic(KclErrorDetails::new(
            "at x must be a number or sketch var".to_owned(),
            vec![args.source_range],
        )));
    };
    let at_y_value = at.get(1).unwrap().clone();
    let Some(at_y) = at_y_value.as_unsolved_expr() else {
        return Err(KclError::new_semantic(KclErrorDetails::new(
            "at y must be a number or sketch var".to_owned(),
            vec![args.source_range],
        )));
    };
    let ctor = PointCtor {
        position: Point2d {
            x: at_x_value.to_sketch_expr().ok_or_else(|| {
                KclError::new_semantic(KclErrorDetails::new(
                    "unable to convert numeric type to suffix".to_owned(),
                    vec![args.source_range],
                ))
            })?,
            y: at_y_value.to_sketch_expr().ok_or_else(|| {
                KclError::new_semantic(KclErrorDetails::new(
                    "unable to convert numeric type to suffix".to_owned(),
                    vec![args.source_range],
                ))
            })?,
        },
    };
    let segment = UnsolvedSegment {
        kind: UnsolvedSegmentKind::Point {
            position: [at_x, at_y],
            ctor: Box::new(ctor),
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
    let start_x_value = start.first().unwrap().clone();
    let Some(start_x) = start_x_value.as_unsolved_expr() else {
        return Err(KclError::new_semantic(KclErrorDetails::new(
            "start x must be a number or sketch var".to_owned(),
            vec![args.source_range],
        )));
    };
    let start_y_value = start.get(1).unwrap().clone();
    let Some(start_y) = start_y_value.as_unsolved_expr() else {
        return Err(KclError::new_semantic(KclErrorDetails::new(
            "start y must be a number or sketch var".to_owned(),
            vec![args.source_range],
        )));
    };
    let end_x_value = end.first().unwrap().clone();
    let Some(end_x) = end_x_value.as_unsolved_expr() else {
        return Err(KclError::new_semantic(KclErrorDetails::new(
            "end x must be a number or sketch var".to_owned(),
            vec![args.source_range],
        )));
    };
    let end_y_value = end.get(1).unwrap().clone();
    let Some(end_y) = end_y_value.as_unsolved_expr() else {
        return Err(KclError::new_semantic(KclErrorDetails::new(
            "end y must be a number or sketch var".to_owned(),
            vec![args.source_range],
        )));
    };
    let ctor = LineCtor {
        start: Point2d {
            x: start_x_value.to_sketch_expr().ok_or_else(|| {
                KclError::new_semantic(KclErrorDetails::new(
                    "unable to convert numeric type to suffix".to_owned(),
                    vec![args.source_range],
                ))
            })?,
            y: start_y_value.to_sketch_expr().ok_or_else(|| {
                KclError::new_semantic(KclErrorDetails::new(
                    "unable to convert numeric type to suffix".to_owned(),
                    vec![args.source_range],
                ))
            })?,
        },
        end: Point2d {
            x: end_x_value.to_sketch_expr().ok_or_else(|| {
                KclError::new_semantic(KclErrorDetails::new(
                    "unable to convert numeric type to suffix".to_owned(),
                    vec![args.source_range],
                ))
            })?,
            y: end_y_value.to_sketch_expr().ok_or_else(|| {
                KclError::new_semantic(KclErrorDetails::new(
                    "unable to convert numeric type to suffix".to_owned(),
                    vec![args.source_range],
                ))
            })?,
        },
    };
    let segment = UnsolvedSegment {
        kind: UnsolvedSegmentKind::Line {
            start: [start_x, start_y],
            end: [end_x, end_y],
            ctor: Box::new(ctor),
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
                (
                    UnsolvedSegmentKind::Point { position: pos0, .. },
                    UnsolvedSegmentKind::Point { position: pos1, .. },
                ) => {
                    let p0_x = &pos0[0];
                    let p0_y = &pos0[1];
                    match (p0_x, p0_y) {
                        (UnsolvedExpr::Unknown(p0_x), UnsolvedExpr::Unknown(p0_y)) => {
                            let p1_x = &pos1[0];
                            let p1_y = &pos1[1];
                            match (p1_x, p1_y) {
                                (UnsolvedExpr::Unknown(p1_x), UnsolvedExpr::Unknown(p1_y)) => {
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
                                (UnsolvedExpr::Known(p1_x), UnsolvedExpr::Known(p1_y)) => {
                                    let p1_x = KclValue::Number {
                                        value: p1_x.n,
                                        ty: p1_x.ty,
                                        meta: vec![args.source_range.into()],
                                    };
                                    let p1_y = KclValue::Number {
                                        value: p1_y.n,
                                        ty: p1_y.ty,
                                        meta: vec![args.source_range.into()],
                                    };
                                    let (constraint_x, constraint_y) =
                                        coincident_constraints_fixed(*p0_x, *p0_y, &p1_x, &p1_y, exec_state, &args)?;

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
                                (UnsolvedExpr::Known(_), UnsolvedExpr::Unknown(_))
                                | (UnsolvedExpr::Unknown(_), UnsolvedExpr::Known(_)) => {
                                    // TODO: sketch-api: unimplemented
                                    Err(KclError::new_semantic(KclErrorDetails::new(
                                        "Unimplemented: When given points, input point at index 0 must be a sketch var for both x and y coordinates to constrain as coincident".to_owned(),
                                        vec![args.source_range],
                                    )))
                                }
                            }
                        }
                        (UnsolvedExpr::Known(_p0_x), UnsolvedExpr::Known(_p0_y)) => {
                            // TODO: sketch-api: unimplemented
                            Err(KclError::new_semantic(KclErrorDetails::new(
                                "Unimplemented: When given points, input point at index 0 must be a sketch var for both x and y coordinates to constrain as coincident".to_owned(),
                                vec![args.source_range],
                            )))
                        }
                        (UnsolvedExpr::Known(_), UnsolvedExpr::Unknown(_))
                        | (UnsolvedExpr::Unknown(_), UnsolvedExpr::Known(_)) => {
                            // The segment is a point with one sketch var.
                            Err(KclError::new_semantic(KclErrorDetails::new(
                                "When given points, input point at index 0 must be a sketch var for both x and y coordinates to constrain as coincident".to_owned(),
                                vec![args.source_range],
                            )))
                        }
                    }
                }
                _ => Err(KclError::new_semantic(KclErrorDetails::new(
                    format!(
                        "both inputs of coincident must be points; found {:?} and {:?}",
                        &unsolved0.kind, &unsolved1.kind
                    ),
                    vec![args.source_range],
                ))),
            }
        }
        (
            KclValue::HomArray { value: arr0, .. } | KclValue::Tuple { value: arr0, .. },
            KclValue::HomArray { value: arr1, .. } | KclValue::Tuple { value: arr1, .. },
        ) => {
            if arr0.len() != 2 {
                return Err(KclError::new_semantic(KclErrorDetails::new(
                    format!("point at index 0 must be a 2D point, but found length {}", arr0.len()),
                    vec![args.source_range],
                )));
            }
            if arr1.len() != 2 {
                return Err(KclError::new_semantic(KclErrorDetails::new(
                    format!("point at index 1 must be a 2D point, but found length {}", arr1.len()),
                    vec![args.source_range],
                )));
            }
            let p0_x = &arr0[0];
            let p0_y = &arr0[1];
            let p1_x = &arr1[0];
            let p1_y = &arr1[1];
            match (p0_x.as_sketch_var(), p0_y.as_sketch_var()) {
                (Some(p0_x), Some(p0_y)) => {
                    match (p1_x.as_sketch_var(), p1_y.as_sketch_var()) {
                        (Some(p1_x), Some(p1_y)) => {
                            let constraint = kcl_ezpz::Constraint::PointsCoincident(
                                kcl_ezpz::datatypes::DatumPoint::new_xy(
                                    p0_x.id.to_constraint_id(range)?,
                                    p0_y.id.to_constraint_id(range)?,
                                ),
                                kcl_ezpz::datatypes::DatumPoint::new_xy(
                                    p1_x.id.to_constraint_id(range)?,
                                    p1_y.id.to_constraint_id(range)?,
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
                        (None, None) => {
                            let (constraint_x, constraint_y) =
                                coincident_constraints_fixed(p0_x.id, p0_y.id, p1_x, p1_y, exec_state, &args)?;

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
                        (None, Some(_)) | (Some(_), None) => Err(KclError::new_semantic(KclErrorDetails::new(
                            "When given points, input point at index 1 must be a sketch var for both x and y coordinates to constrain as coincident"
                                .to_owned(),
                            vec![args.source_range],
                        ))),
                    }
                }
                (None, None) => {
                    let p1_x = p1_x.as_sketch_var().ok_or_else(|| {
                        KclError::new_semantic(KclErrorDetails::new(
                            "When given points, input point at index 1 must be a sketch var for both x and y coordinates to constrain as coincident"
                                .to_owned(),
                            vec![args.source_range],
                        ))
                    })?;
                    let p1_y = p1_y.as_sketch_var().ok_or_else(|| {
                        KclError::new_semantic(KclErrorDetails::new(
                            "When given points, input point at index 1 must be a sketch var for both x and y coordinates to constrain as coincident"
                                .to_owned(),
                            vec![args.source_range],
                        ))
                    })?;

                    let (constraint_x, constraint_y) =
                        coincident_constraints_fixed(p1_x.id, p1_y.id, p0_x, p0_y, exec_state, &args)?;

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
                (None, Some(_)) | (Some(_), None) => Err(KclError::new_semantic(KclErrorDetails::new(
                    "When given points, input point at index 0 must be a sketch var for both x and y coordinates to constrain as coincident"
                        .to_owned(),
                    vec![args.source_range],
                ))),
            }
        }
        _ => Err(KclError::new_semantic(KclErrorDetails::new(
            "All inputs must be points (Point2d or point segment)".to_owned(),
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
        UnsolvedSegmentKind::Point { position, .. } => {
            match (&position[0], &position[1]) {
                (UnsolvedExpr::Unknown(p0_x), UnsolvedExpr::Unknown(p0_y)) => {
                    // The segment is a point with two sketch vars.
                    let (constraint_x, constraint_y) =
                        coincident_constraints_fixed(*p0_x, *p0_y, &arr[0], &arr[1], exec_state, args)?;
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
                (UnsolvedExpr::Known(p0_x), UnsolvedExpr::Known(p0_y)) => {
                    // The segment is a point with no sketch vars.
                    let known_x = KclValue::Number {
                        value: p0_x.n,
                        ty: p0_x.ty,
                        meta: vec![args.source_range.into()],
                    };
                    let known_y = KclValue::Number {
                        value: p0_y.n,
                        ty: p0_y.ty,
                        meta: vec![args.source_range.into()],
                    };

                    let var_x = arr[0].as_sketch_var().ok_or_else(|| {
                        KclError::new_semantic(KclErrorDetails::new(
                            format!(
                                "input point at index {array_index} must be a sketch var for both x and y coordinates to constrain as coincident",
                            ),
                            vec![args.source_range],
                        ))
                    })?;
                    let var_y = arr[1].as_sketch_var().ok_or_else(|| {
                        KclError::new_semantic(KclErrorDetails::new(
                            format!(
                                "input point at index {array_index} must be a sketch var for both x and y coordinates to constrain as coincident",
                            ),
                            vec![args.source_range],
                        ))
                    })?;

                    let (constraint_x, constraint_y) =
                        coincident_constraints_fixed(var_x.id, var_y.id, &known_x, &known_y, exec_state, args)?;

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
                (UnsolvedExpr::Known(_), UnsolvedExpr::Unknown(_))
                | (UnsolvedExpr::Unknown(_), UnsolvedExpr::Known(_)) => {
                    // The segment is a point with one sketch var.
                    Err(KclError::new_semantic(KclErrorDetails::new(
                        format!(
                            "input point at index {segment_index} must be a sketch var for both x and y coordinates to constrain as coincident",
                        ),
                        vec![args.source_range],
                    )))
                }
            }
        }
        UnsolvedSegmentKind::Line { .. } => Err(KclError::new_semantic(KclErrorDetails::new(
            format!("both inputs must be points, but found line at index {segment_index}"),
            vec![args.source_range],
        ))),
    }
}

/// Order of points has been erased when calling this function.
fn coincident_constraints_fixed(
    p0_x: SketchVarId,
    p0_y: SketchVarId,
    p1_x: &KclValue,
    p1_y: &KclValue,
    exec_state: &mut ExecState,
    args: &Args,
) -> Result<(kcl_ezpz::Constraint, kcl_ezpz::Constraint), KclError> {
    let p1_x_number_value = normalize_to_solver_unit(p1_x, p1_x.into(), exec_state, "coincident constraint value")?;
    let p1_y_number_value = normalize_to_solver_unit(p1_y, p1_y.into(), exec_state, "coincident constraint value")?;
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
    Ok((constraint_x, constraint_y))
}

pub async fn horizontal(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let line: KclValue = args.get_unlabeled_kw_arg("line", &RuntimeType::segment(), exec_state)?;
    let KclValue::Segment { value: segment } = line else {
        return Err(KclError::new_semantic(KclErrorDetails::new(
            "line argument must be a Segment".to_owned(),
            vec![args.source_range],
        )));
    };
    let SegmentRepr::Unsolved { segment: unsolved } = &segment.repr else {
        return Err(KclError::new_internal(KclErrorDetails::new(
            "line must be an unsolved Segment".to_owned(),
            vec![args.source_range],
        )));
    };
    let UnsolvedSegmentKind::Line { start, end, .. } = &unsolved.kind else {
        return Err(KclError::new_semantic(KclErrorDetails::new(
            "line argument must be a line, no other type of Segment".to_owned(),
            vec![args.source_range],
        )));
    };
    let p0_x = &start[0];
    let p0_y = &start[1];
    let p1_x = &end[0];
    let p1_y = &end[1];
    match (p0_x, p0_y, p1_x, p1_y) {
        (
            UnsolvedExpr::Unknown(p0_x),
            UnsolvedExpr::Unknown(p0_y),
            UnsolvedExpr::Unknown(p1_x),
            UnsolvedExpr::Unknown(p1_y),
        ) => {
            let range = args.source_range;
            let solver_p0 =
                kcl_ezpz::datatypes::DatumPoint::new_xy(p0_x.to_constraint_id(range)?, p0_y.to_constraint_id(range)?);
            let solver_p1 =
                kcl_ezpz::datatypes::DatumPoint::new_xy(p1_x.to_constraint_id(range)?, p1_y.to_constraint_id(range)?);
            let solver_line = kcl_ezpz::datatypes::LineSegment::new(solver_p0, solver_p1);
            let constraint = kcl_ezpz::Constraint::Horizontal(solver_line);
            // Save the constraint to be used for solving.
            let Some(sketch_state) = exec_state.sketch_block_mut() else {
                return Err(KclError::new_semantic(KclErrorDetails::new(
                    "horizontal() can only be used inside a sketch block".to_owned(),
                    vec![args.source_range],
                )));
            };
            sketch_state.constraints.push(constraint);
            Ok(KclValue::none())
        }
        _ => Err(KclError::new_semantic(KclErrorDetails::new(
            "line's x and y coordinates of both start and end must be vars".to_owned(),
            vec![args.source_range],
        ))),
    }
}

pub async fn vertical(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let line: KclValue = args.get_unlabeled_kw_arg("line", &RuntimeType::segment(), exec_state)?;
    let KclValue::Segment { value: segment } = line else {
        return Err(KclError::new_semantic(KclErrorDetails::new(
            "line argument must be a Segment".to_owned(),
            vec![args.source_range],
        )));
    };
    let SegmentRepr::Unsolved { segment: unsolved } = &segment.repr else {
        return Err(KclError::new_internal(KclErrorDetails::new(
            "line must be an unsolved Segment".to_owned(),
            vec![args.source_range],
        )));
    };
    let UnsolvedSegmentKind::Line { start, end, .. } = &unsolved.kind else {
        return Err(KclError::new_semantic(KclErrorDetails::new(
            "line argument must be a line, no other type of Segment".to_owned(),
            vec![args.source_range],
        )));
    };
    let p0_x = &start[0];
    let p0_y = &start[1];
    let p1_x = &end[0];
    let p1_y = &end[1];
    match (p0_x, p0_y, p1_x, p1_y) {
        (
            UnsolvedExpr::Unknown(p0_x),
            UnsolvedExpr::Unknown(p0_y),
            UnsolvedExpr::Unknown(p1_x),
            UnsolvedExpr::Unknown(p1_y),
        ) => {
            let range = args.source_range;
            let solver_p0 =
                kcl_ezpz::datatypes::DatumPoint::new_xy(p0_x.to_constraint_id(range)?, p0_y.to_constraint_id(range)?);
            let solver_p1 =
                kcl_ezpz::datatypes::DatumPoint::new_xy(p1_x.to_constraint_id(range)?, p1_y.to_constraint_id(range)?);
            let solver_line = kcl_ezpz::datatypes::LineSegment::new(solver_p0, solver_p1);
            let constraint = kcl_ezpz::Constraint::Vertical(solver_line);
            // Save the constraint to be used for solving.
            let Some(sketch_state) = exec_state.sketch_block_mut() else {
                return Err(KclError::new_semantic(KclErrorDetails::new(
                    "vertical() can only be used inside a sketch block".to_owned(),
                    vec![args.source_range],
                )));
            };
            sketch_state.constraints.push(constraint);
            Ok(KclValue::none())
        }
        _ => Err(KclError::new_semantic(KclErrorDetails::new(
            "line's x and y coordinates of both start and end must be vars".to_owned(),
            vec![args.source_range],
        ))),
    }
}

pub async fn parallel(_exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    Err(KclError::Internal {
        details: KclErrorDetails::new("Not yet implemented".to_owned(), vec![args.source_range]),
    })
}
