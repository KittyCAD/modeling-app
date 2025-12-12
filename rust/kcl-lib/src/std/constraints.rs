use anyhow::Result;

use crate::{
    errors::{KclError, KclErrorDetails},
    execution::{
        AbstractSegment, ConstrainablePoint2d, ExecState, KclValue, SegmentRepr, SketchConstraint,
        SketchConstraintKind, SketchVarId, UnsolvedExpr, UnsolvedSegment, UnsolvedSegmentKind,
        normalize_to_solver_unit,
        types::{ArrayLen, PrimitiveType, RuntimeType},
    },
    front::{LineCtor, Point2d, PointCtor},
    std::Args,
};
#[cfg(feature = "artifact-graph")]
use crate::{
    execution::ArtifactId,
    front::{Coincident, Constraint, Horizontal, LinesEqualLength, Object, ObjectId, ObjectKind, Parallel, Vertical},
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
        object_id: exec_state.next_object_id(),
        kind: UnsolvedSegmentKind::Point {
            position: [at_x, at_y],
            ctor: Box::new(ctor),
        },
        meta: vec![args.source_range.into()],
    };
    #[cfg(feature = "artifact-graph")]
    let optional_constraints = {
        let object_id = exec_state.add_placeholder_scene_object(segment.object_id, args.source_range);

        let mut optional_constraints = Vec::new();
        if exec_state.segment_ids_edited_contains(&object_id) {
            if let Some(at_x_var) = at_x_value.as_sketch_var() {
                let x_initial_value = at_x_var.initial_value_to_solver_units(
                    exec_state,
                    args.source_range,
                    "edited segment fixed constraint value",
                )?;
                optional_constraints.push(kcl_ezpz::Constraint::Fixed(
                    at_x_var.id.to_constraint_id(args.source_range)?,
                    x_initial_value.n,
                ));
            }
            if let Some(at_y_var) = at_y_value.as_sketch_var() {
                let y_initial_value = at_y_var.initial_value_to_solver_units(
                    exec_state,
                    args.source_range,
                    "edited segment fixed constraint value",
                )?;
                optional_constraints.push(kcl_ezpz::Constraint::Fixed(
                    at_y_var.id.to_constraint_id(args.source_range)?,
                    y_initial_value.n,
                ));
            }
        }
        optional_constraints
    };

    // Save the segment to be sent to the engine after solving.
    let Some(sketch_state) = exec_state.sketch_block_mut() else {
        return Err(KclError::new_semantic(KclErrorDetails::new(
            "line() can only be used inside a sketch block".to_owned(),
            vec![args.source_range],
        )));
    };
    sketch_state.needed_by_engine.push(segment.clone());

    #[cfg(feature = "artifact-graph")]
    sketch_state.solver_optional_constraints.extend(optional_constraints);

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
    // Order of ID generation is important.
    let start_object_id = exec_state.next_object_id();
    let end_object_id = exec_state.next_object_id();
    let line_object_id = exec_state.next_object_id();
    let segment = UnsolvedSegment {
        object_id: line_object_id,
        kind: UnsolvedSegmentKind::Line {
            start: [start_x, start_y],
            end: [end_x, end_y],
            ctor: Box::new(ctor),
            start_object_id,
            end_object_id,
        },
        meta: vec![args.source_range.into()],
    };
    #[cfg(feature = "artifact-graph")]
    let optional_constraints = {
        let start_object_id = exec_state.add_placeholder_scene_object(start_object_id, args.source_range);
        let end_object_id = exec_state.add_placeholder_scene_object(end_object_id, args.source_range);
        let line_object_id = exec_state.add_placeholder_scene_object(line_object_id, args.source_range);

        let mut optional_constraints = Vec::new();
        if exec_state.segment_ids_edited_contains(&start_object_id)
            || exec_state.segment_ids_edited_contains(&line_object_id)
        {
            if let Some(start_x_var) = start_x_value.as_sketch_var() {
                let x_initial_value = start_x_var.initial_value_to_solver_units(
                    exec_state,
                    args.source_range,
                    "edited segment fixed constraint value",
                )?;
                optional_constraints.push(kcl_ezpz::Constraint::Fixed(
                    start_x_var.id.to_constraint_id(args.source_range)?,
                    x_initial_value.n,
                ));
            }
            if let Some(start_y_var) = start_y_value.as_sketch_var() {
                let y_initial_value = start_y_var.initial_value_to_solver_units(
                    exec_state,
                    args.source_range,
                    "edited segment fixed constraint value",
                )?;
                optional_constraints.push(kcl_ezpz::Constraint::Fixed(
                    start_y_var.id.to_constraint_id(args.source_range)?,
                    y_initial_value.n,
                ));
            }
        }
        if exec_state.segment_ids_edited_contains(&end_object_id)
            || exec_state.segment_ids_edited_contains(&line_object_id)
        {
            if let Some(end_x_var) = end_x_value.as_sketch_var() {
                let x_initial_value = end_x_var.initial_value_to_solver_units(
                    exec_state,
                    args.source_range,
                    "edited segment fixed constraint value",
                )?;
                optional_constraints.push(kcl_ezpz::Constraint::Fixed(
                    end_x_var.id.to_constraint_id(args.source_range)?,
                    x_initial_value.n,
                ));
            }
            if let Some(end_y_var) = end_y_value.as_sketch_var() {
                let y_initial_value = end_y_var.initial_value_to_solver_units(
                    exec_state,
                    args.source_range,
                    "edited segment fixed constraint value",
                )?;
                optional_constraints.push(kcl_ezpz::Constraint::Fixed(
                    end_y_var.id.to_constraint_id(args.source_range)?,
                    y_initial_value.n,
                ));
            }
        }
        optional_constraints
    };

    // Save the segment to be sent to the engine after solving.
    let Some(sketch_state) = exec_state.sketch_block_mut() else {
        return Err(KclError::new_semantic(KclErrorDetails::new(
            "line() can only be used inside a sketch block".to_owned(),
            vec![args.source_range],
        )));
    };
    sketch_state.needed_by_engine.push(segment.clone());

    #[cfg(feature = "artifact-graph")]
    sketch_state.solver_optional_constraints.extend(optional_constraints);

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
                                    #[cfg(feature = "artifact-graph")]
                                    let constraint_id = exec_state.next_object_id();
                                    // Save the constraint to be used for solving.
                                    let Some(sketch_state) = exec_state.sketch_block_mut() else {
                                        return Err(KclError::new_semantic(KclErrorDetails::new(
                                            "coincident() can only be used inside a sketch block".to_owned(),
                                            vec![args.source_range],
                                        )));
                                    };
                                    sketch_state.solver_constraints.push(constraint);
                                    #[cfg(feature = "artifact-graph")]
                                    {
                                        let constraint = crate::front::Constraint::Coincident(Coincident {
                                            points: vec![unsolved0.object_id, unsolved1.object_id],
                                        });
                                        sketch_state.sketch_constraints.push(constraint_id);
                                        track_constraint(constraint_id, constraint, exec_state, &args);
                                    }
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

                                    #[cfg(feature = "artifact-graph")]
                                    let constraint_id = exec_state.next_object_id();
                                    // Save the constraint to be used for solving.
                                    let Some(sketch_state) = exec_state.sketch_block_mut() else {
                                        return Err(KclError::new_semantic(KclErrorDetails::new(
                                            "coincident() can only be used inside a sketch block".to_owned(),
                                            vec![args.source_range],
                                        )));
                                    };
                                    sketch_state.solver_constraints.push(constraint_x);
                                    sketch_state.solver_constraints.push(constraint_y);
                                    #[cfg(feature = "artifact-graph")]
                                    {
                                        let constraint = crate::front::Constraint::Coincident(Coincident {
                                            points: vec![unsolved0.object_id, unsolved1.object_id],
                                        });
                                        sketch_state.sketch_constraints.push(constraint_id);
                                        track_constraint(constraint_id, constraint, exec_state, &args);
                                    }
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
                        (UnsolvedExpr::Known(p0_x), UnsolvedExpr::Known(p0_y)) => {
                            let p1_x = &pos1[0];
                            let p1_y = &pos1[1];
                            match (p1_x, p1_y) {
                                (UnsolvedExpr::Unknown(p1_x), UnsolvedExpr::Unknown(p1_y)) => {
                                    let p0_x = KclValue::Number {
                                        value: p0_x.n,
                                        ty: p0_x.ty,
                                        meta: vec![args.source_range.into()],
                                    };
                                    let p0_y = KclValue::Number {
                                        value: p0_y.n,
                                        ty: p0_y.ty,
                                        meta: vec![args.source_range.into()],
                                    };
                                    let (constraint_x, constraint_y) =
                                        coincident_constraints_fixed(*p1_x, *p1_y, &p0_x, &p0_y, exec_state, &args)?;

                                    #[cfg(feature = "artifact-graph")]
                                    let constraint_id = exec_state.next_object_id();
                                    // Save the constraint to be used for solving.
                                    let Some(sketch_state) = exec_state.sketch_block_mut() else {
                                        return Err(KclError::new_semantic(KclErrorDetails::new(
                                            "coincident() can only be used inside a sketch block".to_owned(),
                                            vec![args.source_range],
                                        )));
                                    };
                                    sketch_state.solver_constraints.push(constraint_x);
                                    sketch_state.solver_constraints.push(constraint_y);
                                    #[cfg(feature = "artifact-graph")]
                                    {
                                        let constraint = crate::front::Constraint::Coincident(Coincident {
                                            points: vec![unsolved0.object_id, unsolved1.object_id],
                                        });
                                        sketch_state.sketch_constraints.push(constraint_id);
                                        track_constraint(constraint_id, constraint, exec_state, &args);
                                    }
                                    Ok(KclValue::none())
                                }
                                (UnsolvedExpr::Known(p1_x), UnsolvedExpr::Known(p1_y)) => {
                                    if *p0_x != *p1_x || *p0_y != *p1_y {
                                        return Err(KclError::new_semantic(KclErrorDetails::new(
                                            "Coincident constraint between two fixed points failed since coordinates differ"
                                                .to_owned(),
                                            vec![args.source_range],
                                        )));
                                    }
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
        _ => Err(KclError::new_semantic(KclErrorDetails::new(
            "All inputs must be points, created from point(), line(), or another sketch function".to_owned(),
            vec![args.source_range],
        ))),
    }
}

#[cfg(feature = "artifact-graph")]
fn track_constraint(constraint_id: ObjectId, constraint: Constraint, exec_state: &mut ExecState, args: &Args) {
    exec_state.add_scene_object(
        Object {
            id: constraint_id,
            kind: ObjectKind::Constraint { constraint },
            label: Default::default(),
            comments: Default::default(),
            artifact_id: ArtifactId::constraint(),
            source: args.source_range.into(),
        },
        args.source_range,
    );
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

pub async fn distance(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
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

    match (&points[0], &points[1]) {
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
                    // Both segments are points. Create a distance constraint
                    // between them.
                    match (&pos0[0], &pos0[1], &pos1[0], &pos1[1]) {
                        (
                            UnsolvedExpr::Unknown(p0_x),
                            UnsolvedExpr::Unknown(p0_y),
                            UnsolvedExpr::Unknown(p1_x),
                            UnsolvedExpr::Unknown(p1_y),
                        ) => {
                            // All coordinates are sketch vars. Proceed.
                            let sketch_constraint = SketchConstraint {
                                kind: SketchConstraintKind::Distance {
                                    points: [
                                        ConstrainablePoint2d {
                                            vars: crate::front::Point2d { x: *p0_x, y: *p0_y },
                                            object_id: unsolved0.object_id,
                                        },
                                        ConstrainablePoint2d {
                                            vars: crate::front::Point2d { x: *p1_x, y: *p1_y },
                                            object_id: unsolved1.object_id,
                                        },
                                    ],
                                },
                                meta: vec![args.source_range.into()],
                            };
                            Ok(KclValue::SketchConstraint {
                                value: Box::new(sketch_constraint),
                            })
                        }
                        _ => Err(KclError::new_semantic(KclErrorDetails::new(
                            "unimplemented: distance() arguments must be all sketch vars in all coordinates".to_owned(),
                            vec![args.source_range],
                        ))),
                    }
                }
                _ => Err(KclError::new_semantic(KclErrorDetails::new(
                    "distance() arguments must be unsolved points".to_owned(),
                    vec![args.source_range],
                ))),
            }
        }
        _ => Err(KclError::new_semantic(KclErrorDetails::new(
            "distance() arguments must be point segments".to_owned(),
            vec![args.source_range],
        ))),
    }
}

pub async fn equal_length(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let lines: Vec<KclValue> = args.get_unlabeled_kw_arg(
        "lines",
        &RuntimeType::Array(Box::new(RuntimeType::Primitive(PrimitiveType::Any)), ArrayLen::Known(2)),
        exec_state,
    )?;
    if lines.len() != 2 {
        return Err(KclError::new_semantic(KclErrorDetails::new(
            "must have two input lines".to_owned(),
            vec![args.source_range],
        )));
    }

    let KclValue::Segment { value: segment0 } = &lines[0] else {
        return Err(KclError::new_semantic(KclErrorDetails::new(
            "line argument must be a Segment".to_owned(),
            vec![args.source_range],
        )));
    };
    let SegmentRepr::Unsolved { segment: unsolved0 } = &segment0.repr else {
        return Err(KclError::new_internal(KclErrorDetails::new(
            "line must be an unsolved Segment".to_owned(),
            vec![args.source_range],
        )));
    };
    let UnsolvedSegmentKind::Line {
        start: start0,
        end: end0,
        ..
    } = &unsolved0.kind
    else {
        return Err(KclError::new_semantic(KclErrorDetails::new(
            "line argument must be a line, no other type of Segment".to_owned(),
            vec![args.source_range],
        )));
    };
    let UnsolvedExpr::Unknown(line0_p0_x) = &start0[0] else {
        return Err(KclError::new_semantic(KclErrorDetails::new(
            "line's start x coordinate must be a var".to_owned(),
            vec![args.source_range],
        )));
    };
    let UnsolvedExpr::Unknown(line0_p0_y) = &start0[1] else {
        return Err(KclError::new_semantic(KclErrorDetails::new(
            "line's start y coordinate must be a var".to_owned(),
            vec![args.source_range],
        )));
    };
    let UnsolvedExpr::Unknown(line0_p1_x) = &end0[0] else {
        return Err(KclError::new_semantic(KclErrorDetails::new(
            "line's end x coordinate must be a var".to_owned(),
            vec![args.source_range],
        )));
    };
    let UnsolvedExpr::Unknown(line0_p1_y) = &end0[1] else {
        return Err(KclError::new_semantic(KclErrorDetails::new(
            "line's end y coordinate must be a var".to_owned(),
            vec![args.source_range],
        )));
    };
    let KclValue::Segment { value: segment1 } = &lines[1] else {
        return Err(KclError::new_semantic(KclErrorDetails::new(
            "line argument must be a Segment".to_owned(),
            vec![args.source_range],
        )));
    };
    let SegmentRepr::Unsolved { segment: unsolved1 } = &segment1.repr else {
        return Err(KclError::new_internal(KclErrorDetails::new(
            "line must be an unsolved Segment".to_owned(),
            vec![args.source_range],
        )));
    };
    let UnsolvedSegmentKind::Line {
        start: start1,
        end: end1,
        ..
    } = &unsolved1.kind
    else {
        return Err(KclError::new_semantic(KclErrorDetails::new(
            "line argument must be a line, no other type of Segment".to_owned(),
            vec![args.source_range],
        )));
    };
    let UnsolvedExpr::Unknown(line1_p0_x) = &start1[0] else {
        return Err(KclError::new_semantic(KclErrorDetails::new(
            "line's start x coordinate must be a var".to_owned(),
            vec![args.source_range],
        )));
    };
    let UnsolvedExpr::Unknown(line1_p0_y) = &start1[1] else {
        return Err(KclError::new_semantic(KclErrorDetails::new(
            "line's start y coordinate must be a var".to_owned(),
            vec![args.source_range],
        )));
    };
    let UnsolvedExpr::Unknown(line1_p1_x) = &end1[0] else {
        return Err(KclError::new_semantic(KclErrorDetails::new(
            "line's end x coordinate must be a var".to_owned(),
            vec![args.source_range],
        )));
    };
    let UnsolvedExpr::Unknown(line1_p1_y) = &end1[1] else {
        return Err(KclError::new_semantic(KclErrorDetails::new(
            "line's end y coordinate must be a var".to_owned(),
            vec![args.source_range],
        )));
    };

    let range = args.source_range;
    let solver_line0_p0 = kcl_ezpz::datatypes::DatumPoint::new_xy(
        line0_p0_x.to_constraint_id(range)?,
        line0_p0_y.to_constraint_id(range)?,
    );
    let solver_line0_p1 = kcl_ezpz::datatypes::DatumPoint::new_xy(
        line0_p1_x.to_constraint_id(range)?,
        line0_p1_y.to_constraint_id(range)?,
    );
    let solver_line0 = kcl_ezpz::datatypes::LineSegment::new(solver_line0_p0, solver_line0_p1);
    let solver_line1_p0 = kcl_ezpz::datatypes::DatumPoint::new_xy(
        line1_p0_x.to_constraint_id(range)?,
        line1_p0_y.to_constraint_id(range)?,
    );
    let solver_line1_p1 = kcl_ezpz::datatypes::DatumPoint::new_xy(
        line1_p1_x.to_constraint_id(range)?,
        line1_p1_y.to_constraint_id(range)?,
    );
    let solver_line1 = kcl_ezpz::datatypes::LineSegment::new(solver_line1_p0, solver_line1_p1);
    let constraint = kcl_ezpz::Constraint::LinesEqualLength(solver_line0, solver_line1);
    #[cfg(feature = "artifact-graph")]
    let constraint_id = exec_state.next_object_id();
    // Save the constraint to be used for solving.
    let Some(sketch_state) = exec_state.sketch_block_mut() else {
        return Err(KclError::new_semantic(KclErrorDetails::new(
            "equalLength() can only be used inside a sketch block".to_owned(),
            vec![args.source_range],
        )));
    };
    sketch_state.solver_constraints.push(constraint);
    #[cfg(feature = "artifact-graph")]
    {
        let constraint = crate::front::Constraint::LinesEqualLength(LinesEqualLength {
            lines: vec![unsolved0.object_id, unsolved1.object_id],
        });
        sketch_state.sketch_constraints.push(constraint_id);
        track_constraint(constraint_id, constraint, exec_state, &args);
    }
    Ok(KclValue::none())
}

pub async fn parallel(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let lines: Vec<KclValue> = args.get_unlabeled_kw_arg(
        "lines",
        &RuntimeType::Array(Box::new(RuntimeType::Primitive(PrimitiveType::Any)), ArrayLen::Known(2)),
        exec_state,
    )?;
    if lines.len() != 2 {
        return Err(KclError::new_semantic(KclErrorDetails::new(
            "must have two input lines".to_owned(),
            vec![args.source_range],
        )));
    }

    let KclValue::Segment { value: segment0 } = &lines[0] else {
        return Err(KclError::new_semantic(KclErrorDetails::new(
            "line argument must be a Segment".to_owned(),
            vec![args.source_range],
        )));
    };
    let SegmentRepr::Unsolved { segment: unsolved0 } = &segment0.repr else {
        return Err(KclError::new_internal(KclErrorDetails::new(
            "line must be an unsolved Segment".to_owned(),
            vec![args.source_range],
        )));
    };
    let UnsolvedSegmentKind::Line {
        start: start0,
        end: end0,
        ..
    } = &unsolved0.kind
    else {
        return Err(KclError::new_semantic(KclErrorDetails::new(
            "line argument must be a line, no other type of Segment".to_owned(),
            vec![args.source_range],
        )));
    };
    let UnsolvedExpr::Unknown(line0_p0_x) = &start0[0] else {
        return Err(KclError::new_semantic(KclErrorDetails::new(
            "line's start x coordinate must be a var".to_owned(),
            vec![args.source_range],
        )));
    };
    let UnsolvedExpr::Unknown(line0_p0_y) = &start0[1] else {
        return Err(KclError::new_semantic(KclErrorDetails::new(
            "line's start y coordinate must be a var".to_owned(),
            vec![args.source_range],
        )));
    };
    let UnsolvedExpr::Unknown(line0_p1_x) = &end0[0] else {
        return Err(KclError::new_semantic(KclErrorDetails::new(
            "line's end x coordinate must be a var".to_owned(),
            vec![args.source_range],
        )));
    };
    let UnsolvedExpr::Unknown(line0_p1_y) = &end0[1] else {
        return Err(KclError::new_semantic(KclErrorDetails::new(
            "line's end y coordinate must be a var".to_owned(),
            vec![args.source_range],
        )));
    };
    let KclValue::Segment { value: segment1 } = &lines[1] else {
        return Err(KclError::new_semantic(KclErrorDetails::new(
            "line argument must be a Segment".to_owned(),
            vec![args.source_range],
        )));
    };
    let SegmentRepr::Unsolved { segment: unsolved1 } = &segment1.repr else {
        return Err(KclError::new_internal(KclErrorDetails::new(
            "line must be an unsolved Segment".to_owned(),
            vec![args.source_range],
        )));
    };
    let UnsolvedSegmentKind::Line {
        start: start1,
        end: end1,
        ..
    } = &unsolved1.kind
    else {
        return Err(KclError::new_semantic(KclErrorDetails::new(
            "line argument must be a line, no other type of Segment".to_owned(),
            vec![args.source_range],
        )));
    };
    let UnsolvedExpr::Unknown(line1_p0_x) = &start1[0] else {
        return Err(KclError::new_semantic(KclErrorDetails::new(
            "line's start x coordinate must be a var".to_owned(),
            vec![args.source_range],
        )));
    };
    let UnsolvedExpr::Unknown(line1_p0_y) = &start1[1] else {
        return Err(KclError::new_semantic(KclErrorDetails::new(
            "line's start y coordinate must be a var".to_owned(),
            vec![args.source_range],
        )));
    };
    let UnsolvedExpr::Unknown(line1_p1_x) = &end1[0] else {
        return Err(KclError::new_semantic(KclErrorDetails::new(
            "line's end x coordinate must be a var".to_owned(),
            vec![args.source_range],
        )));
    };
    let UnsolvedExpr::Unknown(line1_p1_y) = &end1[1] else {
        return Err(KclError::new_semantic(KclErrorDetails::new(
            "line's end y coordinate must be a var".to_owned(),
            vec![args.source_range],
        )));
    };

    let range = args.source_range;
    let solver_line0_p0 = kcl_ezpz::datatypes::DatumPoint::new_xy(
        line0_p0_x.to_constraint_id(range)?,
        line0_p0_y.to_constraint_id(range)?,
    );
    let solver_line0_p1 = kcl_ezpz::datatypes::DatumPoint::new_xy(
        line0_p1_x.to_constraint_id(range)?,
        line0_p1_y.to_constraint_id(range)?,
    );
    let solver_line0 = kcl_ezpz::datatypes::LineSegment::new(solver_line0_p0, solver_line0_p1);
    let solver_line1_p0 = kcl_ezpz::datatypes::DatumPoint::new_xy(
        line1_p0_x.to_constraint_id(range)?,
        line1_p0_y.to_constraint_id(range)?,
    );
    let solver_line1_p1 = kcl_ezpz::datatypes::DatumPoint::new_xy(
        line1_p1_x.to_constraint_id(range)?,
        line1_p1_y.to_constraint_id(range)?,
    );
    let solver_line1 = kcl_ezpz::datatypes::LineSegment::new(solver_line1_p0, solver_line1_p1);
    let constraint =
        kcl_ezpz::Constraint::LinesAtAngle(solver_line0, solver_line1, kcl_ezpz::datatypes::AngleKind::Parallel);
    #[cfg(feature = "artifact-graph")]
    let constraint_id = exec_state.next_object_id();
    // Save the constraint to be used for solving.
    let Some(sketch_state) = exec_state.sketch_block_mut() else {
        return Err(KclError::new_semantic(KclErrorDetails::new(
            "equalLength() can only be used inside a sketch block".to_owned(),
            vec![args.source_range],
        )));
    };
    sketch_state.solver_constraints.push(constraint);
    #[cfg(feature = "artifact-graph")]
    {
        let constraint = crate::front::Constraint::Parallel(Parallel {
            lines: vec![unsolved0.object_id, unsolved1.object_id],
        });
        sketch_state.sketch_constraints.push(constraint_id);
        track_constraint(constraint_id, constraint, exec_state, &args);
    }
    Ok(KclValue::none())
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
            #[cfg(feature = "artifact-graph")]
            let constraint_id = exec_state.next_object_id();
            // Save the constraint to be used for solving.
            let Some(sketch_state) = exec_state.sketch_block_mut() else {
                return Err(KclError::new_semantic(KclErrorDetails::new(
                    "horizontal() can only be used inside a sketch block".to_owned(),
                    vec![args.source_range],
                )));
            };
            sketch_state.solver_constraints.push(constraint);
            #[cfg(feature = "artifact-graph")]
            {
                let constraint = crate::front::Constraint::Horizontal(Horizontal {
                    line: unsolved.object_id,
                });
                sketch_state.sketch_constraints.push(constraint_id);
                track_constraint(constraint_id, constraint, exec_state, &args);
            }
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
            #[cfg(feature = "artifact-graph")]
            let constraint_id = exec_state.next_object_id();
            // Save the constraint to be used for solving.
            let Some(sketch_state) = exec_state.sketch_block_mut() else {
                return Err(KclError::new_semantic(KclErrorDetails::new(
                    "vertical() can only be used inside a sketch block".to_owned(),
                    vec![args.source_range],
                )));
            };
            sketch_state.solver_constraints.push(constraint);
            #[cfg(feature = "artifact-graph")]
            {
                let constraint = crate::front::Constraint::Vertical(Vertical {
                    line: unsolved.object_id,
                });
                sketch_state.sketch_constraints.push(constraint_id);
                track_constraint(constraint_id, constraint, exec_state, &args);
            }
            Ok(KclValue::none())
        }
        _ => Err(KclError::new_semantic(KclErrorDetails::new(
            "line's x and y coordinates of both start and end must be vars".to_owned(),
            vec![args.source_range],
        ))),
    }
}
