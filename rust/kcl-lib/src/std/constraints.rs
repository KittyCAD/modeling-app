use anyhow::Result;
use kcl_ezpz::{
    Constraint as SolverConstraint,
    datatypes::{
        AngleKind,
        inputs::{DatumCircularArc, DatumLineSegment, DatumPoint},
    },
};

use crate::{
    errors::{KclError, KclErrorDetails},
    execution::{
        AbstractSegment, ConstrainablePoint2d, ExecState, KclValue, SegmentRepr, SketchConstraint,
        SketchConstraintKind, SketchVarId, UnsolvedExpr, UnsolvedSegment, UnsolvedSegmentKind,
        normalize_to_solver_unit,
        types::{ArrayLen, PrimitiveType, RuntimeType},
    },
    front::{ArcCtor, LineCtor, ObjectId, Point2d, PointCtor},
    std::Args,
};
#[cfg(feature = "artifact-graph")]
use crate::{
    execution::ArtifactId,
    front::{
        Coincident, Constraint, Horizontal, LinesEqualLength, Object, ObjectKind, Parallel, Perpendicular, Vertical,
    },
};

pub async fn point(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let at: Vec<KclValue> = args.get_kw_arg("at", &RuntimeType::point2d(), exec_state)?;
    let [at_x_value, at_y_value]: [KclValue; 2] = at.try_into().map_err(|_| {
        KclError::new_semantic(KclErrorDetails::new(
            "at must be a 2D point".to_owned(),
            vec![args.source_range],
        ))
    })?;
    let Some(at_x) = at_x_value.as_unsolved_expr() else {
        return Err(KclError::new_semantic(KclErrorDetails::new(
            "at x must be a number or sketch var".to_owned(),
            vec![args.source_range],
        )));
    };
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
        id: exec_state.next_uuid(),
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
                optional_constraints.push(SolverConstraint::Fixed(
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
                optional_constraints.push(SolverConstraint::Fixed(
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
    let construction_opt = args.get_kw_arg_opt("construction", &RuntimeType::bool(), exec_state)?;
    let construction: bool = construction_opt.unwrap_or(false);
    let construction_ctor = construction_opt;
    let [start_x_value, start_y_value]: [KclValue; 2] = start.try_into().map_err(|_| {
        KclError::new_semantic(KclErrorDetails::new(
            "start must be a 2D point".to_owned(),
            vec![args.source_range],
        ))
    })?;
    let [end_x_value, end_y_value]: [KclValue; 2] = end.try_into().map_err(|_| {
        KclError::new_semantic(KclErrorDetails::new(
            "end must be a 2D point".to_owned(),
            vec![args.source_range],
        ))
    })?;
    let Some(start_x) = start_x_value.as_unsolved_expr() else {
        return Err(KclError::new_semantic(KclErrorDetails::new(
            "start x must be a number or sketch var".to_owned(),
            vec![args.source_range],
        )));
    };
    let Some(start_y) = start_y_value.as_unsolved_expr() else {
        return Err(KclError::new_semantic(KclErrorDetails::new(
            "start y must be a number or sketch var".to_owned(),
            vec![args.source_range],
        )));
    };
    let Some(end_x) = end_x_value.as_unsolved_expr() else {
        return Err(KclError::new_semantic(KclErrorDetails::new(
            "end x must be a number or sketch var".to_owned(),
            vec![args.source_range],
        )));
    };
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
        construction: construction_ctor,
    };
    // Order of ID generation is important.
    let start_object_id = exec_state.next_object_id();
    let end_object_id = exec_state.next_object_id();
    let line_object_id = exec_state.next_object_id();
    let segment = UnsolvedSegment {
        id: exec_state.next_uuid(),
        object_id: line_object_id,
        kind: UnsolvedSegmentKind::Line {
            start: [start_x, start_y],
            end: [end_x, end_y],
            ctor: Box::new(ctor),
            start_object_id,
            end_object_id,
            construction,
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
                optional_constraints.push(SolverConstraint::Fixed(
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
                optional_constraints.push(SolverConstraint::Fixed(
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
                optional_constraints.push(SolverConstraint::Fixed(
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
                optional_constraints.push(SolverConstraint::Fixed(
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

pub async fn arc(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let start: Vec<KclValue> = args.get_kw_arg("start", &RuntimeType::point2d(), exec_state)?;
    let end: Vec<KclValue> = args.get_kw_arg("end", &RuntimeType::point2d(), exec_state)?;
    // TODO: make this optional and add interior.
    let center: Vec<KclValue> = args.get_kw_arg("center", &RuntimeType::point2d(), exec_state)?;
    let construction_opt = args.get_kw_arg_opt("construction", &RuntimeType::bool(), exec_state)?;
    let construction: bool = construction_opt.unwrap_or(false);
    let construction_ctor = construction_opt;

    let [start_x_value, start_y_value]: [KclValue; 2] = start.try_into().map_err(|_| {
        KclError::new_semantic(KclErrorDetails::new(
            "start must be a 2D point".to_owned(),
            vec![args.source_range],
        ))
    })?;
    let [end_x_value, end_y_value]: [KclValue; 2] = end.try_into().map_err(|_| {
        KclError::new_semantic(KclErrorDetails::new(
            "end must be a 2D point".to_owned(),
            vec![args.source_range],
        ))
    })?;
    let [center_x_value, center_y_value]: [KclValue; 2] = center.try_into().map_err(|_| {
        KclError::new_semantic(KclErrorDetails::new(
            "center must be a 2D point".to_owned(),
            vec![args.source_range],
        ))
    })?;

    let Some(UnsolvedExpr::Unknown(start_x)) = start_x_value.as_unsolved_expr() else {
        return Err(KclError::new_semantic(KclErrorDetails::new(
            "start x must be a sketch var".to_owned(),
            vec![args.source_range],
        )));
    };
    let Some(UnsolvedExpr::Unknown(start_y)) = start_y_value.as_unsolved_expr() else {
        return Err(KclError::new_semantic(KclErrorDetails::new(
            "start y must be a sketch var".to_owned(),
            vec![args.source_range],
        )));
    };
    let Some(UnsolvedExpr::Unknown(end_x)) = end_x_value.as_unsolved_expr() else {
        return Err(KclError::new_semantic(KclErrorDetails::new(
            "end x must be a sketch var".to_owned(),
            vec![args.source_range],
        )));
    };
    let Some(UnsolvedExpr::Unknown(end_y)) = end_y_value.as_unsolved_expr() else {
        return Err(KclError::new_semantic(KclErrorDetails::new(
            "end y must be a sketch var".to_owned(),
            vec![args.source_range],
        )));
    };
    let Some(UnsolvedExpr::Unknown(center_x)) = center_x_value.as_unsolved_expr() else {
        return Err(KclError::new_semantic(KclErrorDetails::new(
            "center x must be a sketch var".to_owned(),
            vec![args.source_range],
        )));
    };
    let Some(UnsolvedExpr::Unknown(center_y)) = center_y_value.as_unsolved_expr() else {
        return Err(KclError::new_semantic(KclErrorDetails::new(
            "center y must be a sketch var".to_owned(),
            vec![args.source_range],
        )));
    };

    let ctor = ArcCtor {
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
        center: Point2d {
            x: center_x_value.to_sketch_expr().ok_or_else(|| {
                KclError::new_semantic(KclErrorDetails::new(
                    "unable to convert numeric type to suffix".to_owned(),
                    vec![args.source_range],
                ))
            })?,
            y: center_y_value.to_sketch_expr().ok_or_else(|| {
                KclError::new_semantic(KclErrorDetails::new(
                    "unable to convert numeric type to suffix".to_owned(),
                    vec![args.source_range],
                ))
            })?,
        },
        construction: construction_ctor,
    };

    // Order of ID generation is important.
    let start_object_id = exec_state.next_object_id();
    let end_object_id = exec_state.next_object_id();
    let center_object_id = exec_state.next_object_id();
    let arc_object_id = exec_state.next_object_id();
    let segment = UnsolvedSegment {
        id: exec_state.next_uuid(),
        object_id: arc_object_id,
        kind: UnsolvedSegmentKind::Arc {
            start: [UnsolvedExpr::Unknown(start_x), UnsolvedExpr::Unknown(start_y)],
            end: [UnsolvedExpr::Unknown(end_x), UnsolvedExpr::Unknown(end_y)],
            center: [UnsolvedExpr::Unknown(center_x), UnsolvedExpr::Unknown(center_y)],
            ctor: Box::new(ctor),
            start_object_id,
            end_object_id,
            center_object_id,
            construction,
        },
        meta: vec![args.source_range.into()],
    };
    #[cfg(feature = "artifact-graph")]
    let optional_constraints = {
        let start_object_id = exec_state.add_placeholder_scene_object(start_object_id, args.source_range);
        let end_object_id = exec_state.add_placeholder_scene_object(end_object_id, args.source_range);
        let center_object_id = exec_state.add_placeholder_scene_object(center_object_id, args.source_range);
        let arc_object_id = exec_state.add_placeholder_scene_object(arc_object_id, args.source_range);

        let mut optional_constraints = Vec::new();
        if exec_state.segment_ids_edited_contains(&start_object_id)
            || exec_state.segment_ids_edited_contains(&arc_object_id)
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
            || exec_state.segment_ids_edited_contains(&arc_object_id)
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
        if exec_state.segment_ids_edited_contains(&center_object_id)
            || exec_state.segment_ids_edited_contains(&arc_object_id)
        {
            if let Some(center_x_var) = center_x_value.as_sketch_var() {
                let x_initial_value = center_x_var.initial_value_to_solver_units(
                    exec_state,
                    args.source_range,
                    "edited segment fixed constraint value",
                )?;
                optional_constraints.push(kcl_ezpz::Constraint::Fixed(
                    center_x_var.id.to_constraint_id(args.source_range)?,
                    x_initial_value.n,
                ));
            }
            if let Some(center_y_var) = center_y_value.as_sketch_var() {
                let y_initial_value = center_y_var.initial_value_to_solver_units(
                    exec_state,
                    args.source_range,
                    "edited segment fixed constraint value",
                )?;
                optional_constraints.push(kcl_ezpz::Constraint::Fixed(
                    center_y_var.id.to_constraint_id(args.source_range)?,
                    y_initial_value.n,
                ));
            }
        }
        optional_constraints
    };

    // Build the implicit arc constraint.
    let range = args.source_range;
    let constraint = kcl_ezpz::Constraint::Arc(kcl_ezpz::datatypes::inputs::DatumCircularArc {
        center: kcl_ezpz::datatypes::inputs::DatumPoint::new_xy(
            center_x.to_constraint_id(range)?,
            center_y.to_constraint_id(range)?,
        ),
        start: kcl_ezpz::datatypes::inputs::DatumPoint::new_xy(
            start_x.to_constraint_id(range)?,
            start_y.to_constraint_id(range)?,
        ),
        end: kcl_ezpz::datatypes::inputs::DatumPoint::new_xy(
            end_x.to_constraint_id(range)?,
            end_y.to_constraint_id(range)?,
        ),
    });

    let Some(sketch_state) = exec_state.sketch_block_mut() else {
        return Err(KclError::new_semantic(KclErrorDetails::new(
            "arc() can only be used inside a sketch block".to_owned(),
            vec![args.source_range],
        )));
    };
    // Save the segment to be sent to the engine after solving.
    sketch_state.needed_by_engine.push(segment.clone());
    // Save the constraint to be used for solving.
    sketch_state.solver_constraints.push(constraint);
    // The constraint isn't added to scene objects since it's implicit in the
    // arc segment. You cannot have an arc without it.

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
    let [point0, point1]: [KclValue; 2] = points.try_into().map_err(|_| {
        KclError::new_semantic(KclErrorDetails::new(
            "must have two input points".to_owned(),
            vec![args.source_range],
        ))
    })?;

    let range = args.source_range;
    match (&point0, &point1) {
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
                                    let constraint = SolverConstraint::PointsCoincident(
                                        kcl_ezpz::datatypes::inputs::DatumPoint::new_xy(
                                            p0_x.to_constraint_id(range)?,
                                            p0_y.to_constraint_id(range)?,
                                        ),
                                        kcl_ezpz::datatypes::inputs::DatumPoint::new_xy(
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
                                            segments: vec![unsolved0.object_id, unsolved1.object_id],
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
                                            segments: vec![unsolved0.object_id, unsolved1.object_id],
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
                                            segments: vec![unsolved0.object_id, unsolved1.object_id],
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
                // Point-Line or Line-Point case: create perpendicular distance constraint with distance 0
                (
                    UnsolvedSegmentKind::Point {
                        position: point_pos, ..
                    },
                    UnsolvedSegmentKind::Line {
                        start: line_start,
                        end: line_end,
                        ..
                    },
                )
                | (
                    UnsolvedSegmentKind::Line {
                        start: line_start,
                        end: line_end,
                        ..
                    },
                    UnsolvedSegmentKind::Point {
                        position: point_pos, ..
                    },
                ) => {
                    let point_x = &point_pos[0];
                    let point_y = &point_pos[1];
                    match (point_x, point_y) {
                        (UnsolvedExpr::Unknown(point_x), UnsolvedExpr::Unknown(point_y)) => {
                            // Extract line start and end coordinates
                            let (start_x, start_y) = (&line_start[0], &line_start[1]);
                            let (end_x, end_y) = (&line_end[0], &line_end[1]);

                            match (start_x, start_y, end_x, end_y) {
                                (
                                    UnsolvedExpr::Unknown(sx), UnsolvedExpr::Unknown(sy),
                                    UnsolvedExpr::Unknown(ex), UnsolvedExpr::Unknown(ey),
                                ) => {
                                    let point = DatumPoint::new_xy(
                                        point_x.to_constraint_id(range)?,
                                        point_y.to_constraint_id(range)?,
                                    );
                                    let line_segment = DatumLineSegment::new(
                                        DatumPoint::new_xy(sx.to_constraint_id(range)?, sy.to_constraint_id(range)?),
                                        DatumPoint::new_xy(ex.to_constraint_id(range)?, ey.to_constraint_id(range)?),
                                    );
                                    let constraint = SolverConstraint::PointLineDistance(point, line_segment, 0.0);

                                    #[cfg(feature = "artifact-graph")]
                                    let constraint_id = exec_state.next_object_id();

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
                                            segments: vec![unsolved0.object_id, unsolved1.object_id],
                                        });
                                        sketch_state.sketch_constraints.push(constraint_id);
                                        track_constraint(constraint_id, constraint, exec_state, &args);
                                    }
                                    Ok(KclValue::none())
                                }
                                _ => Err(KclError::new_semantic(KclErrorDetails::new(
                                    "Line segment endpoints must be sketch variables for point-segment coincident constraint".to_owned(),
                                    vec![args.source_range],
                                ))),
                            }
                        }
                        _ => Err(KclError::new_semantic(KclErrorDetails::new(
                            "Point coordinates must be sketch variables for point-segment coincident constraint"
                                .to_owned(),
                            vec![args.source_range],
                        ))),
                    }
                }
                // Point-Arc or Arc-Point case: create PointArcCoincident constraint
                (
                    UnsolvedSegmentKind::Point {
                        position: point_pos, ..
                    },
                    UnsolvedSegmentKind::Arc {
                        start: arc_start,
                        end: arc_end,
                        center: arc_center,
                        ..
                    },
                )
                | (
                    UnsolvedSegmentKind::Arc {
                        start: arc_start,
                        end: arc_end,
                        center: arc_center,
                        ..
                    },
                    UnsolvedSegmentKind::Point {
                        position: point_pos, ..
                    },
                ) => {
                    let point_x = &point_pos[0];
                    let point_y = &point_pos[1];
                    match (point_x, point_y) {
                        (UnsolvedExpr::Unknown(point_x), UnsolvedExpr::Unknown(point_y)) => {
                            // Extract arc center, start, and end coordinates
                            let (center_x, center_y) = (&arc_center[0], &arc_center[1]);
                            let (start_x, start_y) = (&arc_start[0], &arc_start[1]);
                            let (end_x, end_y) = (&arc_end[0], &arc_end[1]);

                            match (center_x, center_y, start_x, start_y, end_x, end_y) {
                                (
                                    UnsolvedExpr::Unknown(cx), UnsolvedExpr::Unknown(cy),
                                    UnsolvedExpr::Unknown(sx), UnsolvedExpr::Unknown(sy),
                                    UnsolvedExpr::Unknown(ex), UnsolvedExpr::Unknown(ey),
                                ) => {
                                    let point = DatumPoint::new_xy(
                                        point_x.to_constraint_id(range)?,
                                        point_y.to_constraint_id(range)?,
                                    );
                                    let circular_arc = DatumCircularArc {
                                        center: DatumPoint::new_xy(
                                            cx.to_constraint_id(range)?,
                                            cy.to_constraint_id(range)?,
                                        ),
                                        start: DatumPoint::new_xy(
                                            sx.to_constraint_id(range)?,
                                            sy.to_constraint_id(range)?,
                                        ),
                                        end: DatumPoint::new_xy(
                                            ex.to_constraint_id(range)?,
                                            ey.to_constraint_id(range)?,
                                        ),
                                    };
                                    let constraint = SolverConstraint::PointArcCoincident(circular_arc, point);

                                    #[cfg(feature = "artifact-graph")]
                                    let constraint_id = exec_state.next_object_id();

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
                                            segments: vec![unsolved0.object_id, unsolved1.object_id],
                                        });
                                        sketch_state.sketch_constraints.push(constraint_id);
                                        track_constraint(constraint_id, constraint, exec_state, &args);
                                    }
                                    Ok(KclValue::none())
                                }
                                _ => Err(KclError::new_semantic(KclErrorDetails::new(
                                    "Arc center, start, and end points must be sketch variables for point-arc coincident constraint".to_owned(),
                                    vec![args.source_range],
                                ))),
                            }
                        }
                        _ => Err(KclError::new_semantic(KclErrorDetails::new(
                            "Point coordinates must be sketch variables for point-arc coincident constraint".to_owned(),
                            vec![args.source_range],
                        ))),
                    }
                }
                // Line-Line case: create parallel constraint and perpendicular distance of zero
                (
                    UnsolvedSegmentKind::Line {
                        start: line0_start,
                        end: line0_end,
                        ..
                    },
                    UnsolvedSegmentKind::Line {
                        start: line1_start,
                        end: line1_end,
                        ..
                    },
                ) => {
                    // Extract line coordinates
                    let (line0_start_x, line0_start_y) = (&line0_start[0], &line0_start[1]);
                    let (line0_end_x, line0_end_y) = (&line0_end[0], &line0_end[1]);
                    let (line1_start_x, line1_start_y) = (&line1_start[0], &line1_start[1]);
                    let (line1_end_x, line1_end_y) = (&line1_end[0], &line1_end[1]);

                    match (
                        line0_start_x,
                        line0_start_y,
                        line0_end_x,
                        line0_end_y,
                        line1_start_x,
                        line1_start_y,
                        line1_end_x,
                        line1_end_y,
                    ) {
                        (
                            UnsolvedExpr::Unknown(l0_sx),
                            UnsolvedExpr::Unknown(l0_sy),
                            UnsolvedExpr::Unknown(l0_ex),
                            UnsolvedExpr::Unknown(l0_ey),
                            UnsolvedExpr::Unknown(l1_sx),
                            UnsolvedExpr::Unknown(l1_sy),
                            UnsolvedExpr::Unknown(l1_ex),
                            UnsolvedExpr::Unknown(l1_ey),
                        ) => {
                            // Create line segments for the solver
                            let line0_segment = DatumLineSegment::new(
                                DatumPoint::new_xy(l0_sx.to_constraint_id(range)?, l0_sy.to_constraint_id(range)?),
                                DatumPoint::new_xy(l0_ex.to_constraint_id(range)?, l0_ey.to_constraint_id(range)?),
                            );
                            let line1_segment = DatumLineSegment::new(
                                DatumPoint::new_xy(l1_sx.to_constraint_id(range)?, l1_sy.to_constraint_id(range)?),
                                DatumPoint::new_xy(l1_ex.to_constraint_id(range)?, l1_ey.to_constraint_id(range)?),
                            );

                            // Create parallel constraint
                            let parallel_constraint =
                                SolverConstraint::LinesAtAngle(line0_segment, line1_segment, AngleKind::Parallel);

                            // Create perpendicular distance constraint from first line to start point of second line
                            let point_on_line1 =
                                DatumPoint::new_xy(l1_sx.to_constraint_id(range)?, l1_sy.to_constraint_id(range)?);
                            let distance_constraint =
                                SolverConstraint::PointLineDistance(point_on_line1, line0_segment, 0.0);

                            #[cfg(feature = "artifact-graph")]
                            let constraint_id = exec_state.next_object_id();

                            let Some(sketch_state) = exec_state.sketch_block_mut() else {
                                return Err(KclError::new_semantic(KclErrorDetails::new(
                                    "coincident() can only be used inside a sketch block".to_owned(),
                                    vec![args.source_range],
                                )));
                            };
                            // Push both constraints to achieve collinearity
                            sketch_state.solver_constraints.push(parallel_constraint);
                            sketch_state.solver_constraints.push(distance_constraint);
                            #[cfg(feature = "artifact-graph")]
                            {
                                let constraint = crate::front::Constraint::Coincident(Coincident {
                                    segments: vec![unsolved0.object_id, unsolved1.object_id],
                                });
                                sketch_state.sketch_constraints.push(constraint_id);
                                track_constraint(constraint_id, constraint, exec_state, &args);
                            }
                            Ok(KclValue::none())
                        }
                        _ => Err(KclError::new_semantic(KclErrorDetails::new(
                            "Line segment endpoints must be sketch variables for line-line coincident constraint"
                                .to_owned(),
                            vec![args.source_range],
                        ))),
                    }
                }
                _ => Err(KclError::new_semantic(KclErrorDetails::new(
                    format!(
                        "coincident supports point-point, point-segment, or segment-segment; found {:?} and {:?}",
                        &unsolved0.kind, &unsolved1.kind
                    ),
                    vec![args.source_range],
                ))),
            }
        }
        _ => Err(KclError::new_semantic(KclErrorDetails::new(
            "All inputs must be segments (points or lines), created from point(), line(), or another sketch function"
                .to_owned(),
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
    let constraint_x = SolverConstraint::Fixed(p0_x.to_constraint_id(args.source_range)?, p1_x.n);
    let constraint_y = SolverConstraint::Fixed(p0_y.to_constraint_id(args.source_range)?, p1_y.n);
    Ok((constraint_x, constraint_y))
}

pub async fn distance(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let points: Vec<KclValue> = args.get_unlabeled_kw_arg(
        "points",
        &RuntimeType::Array(Box::new(RuntimeType::Primitive(PrimitiveType::Any)), ArrayLen::Known(2)),
        exec_state,
    )?;
    let [point0, point1]: [KclValue; 2] = points.try_into().map_err(|_| {
        KclError::new_semantic(KclErrorDetails::new(
            "must have two input points".to_owned(),
            vec![args.source_range],
        ))
    })?;

    match (&point0, &point1) {
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

/// Helper function to create a radius or diameter constraint from an arc segment.
/// Used by both radius() and diameter() functions.
fn create_arc_radius_constraint(
    segment: KclValue,
    constraint_kind: fn([ConstrainablePoint2d; 2]) -> SketchConstraintKind,
    source_range: crate::SourceRange,
) -> Result<SketchConstraint, KclError> {
    // Create a dummy constraint to get its name for error messages
    let dummy_constraint = constraint_kind([
        ConstrainablePoint2d {
            vars: crate::front::Point2d {
                x: SketchVarId(0),
                y: SketchVarId(0),
            },
            object_id: ObjectId(0),
        },
        ConstrainablePoint2d {
            vars: crate::front::Point2d {
                x: SketchVarId(0),
                y: SketchVarId(0),
            },
            object_id: ObjectId(0),
        },
    ]);
    let function_name = dummy_constraint.name();

    let KclValue::Segment { value: seg } = segment else {
        return Err(KclError::new_semantic(KclErrorDetails::new(
            format!("{}() argument must be a segment", function_name),
            vec![source_range],
        )));
    };
    let SegmentRepr::Unsolved { segment: unsolved } = &seg.repr else {
        return Err(KclError::new_semantic(KclErrorDetails::new(
            "segment must be unsolved".to_owned(),
            vec![source_range],
        )));
    };
    match &unsolved.kind {
        UnsolvedSegmentKind::Arc {
            center,
            start,
            center_object_id,
            start_object_id,
            ..
        } => {
            // Extract center and start point coordinates
            match (&center[0], &center[1], &start[0], &start[1]) {
                (
                    UnsolvedExpr::Unknown(center_x),
                    UnsolvedExpr::Unknown(center_y),
                    UnsolvedExpr::Unknown(start_x),
                    UnsolvedExpr::Unknown(start_y),
                ) => {
                    // All coordinates are sketch vars. Create constraint.
                    let sketch_constraint = SketchConstraint {
                        kind: constraint_kind([
                            ConstrainablePoint2d {
                                vars: crate::front::Point2d {
                                    x: *center_x,
                                    y: *center_y,
                                },
                                object_id: *center_object_id,
                            },
                            ConstrainablePoint2d {
                                vars: crate::front::Point2d {
                                    x: *start_x,
                                    y: *start_y,
                                },
                                object_id: *start_object_id,
                            },
                        ]),
                        meta: vec![source_range.into()],
                    };
                    Ok(sketch_constraint)
                }
                _ => Err(KclError::new_semantic(KclErrorDetails::new(
                    format!(
                        "unimplemented: {}() arc segment must have all sketch vars in all coordinates",
                        function_name
                    ),
                    vec![source_range],
                ))),
            }
        }
        _ => Err(KclError::new_semantic(KclErrorDetails::new(
            format!("{}() argument must be an arc segment", function_name),
            vec![source_range],
        ))),
    }
}

pub async fn radius(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let segment: KclValue =
        args.get_unlabeled_kw_arg("points", &RuntimeType::Primitive(PrimitiveType::Any), exec_state)?;

    create_arc_radius_constraint(
        segment,
        |points| SketchConstraintKind::Radius { points },
        args.source_range,
    )
    .map(|constraint| KclValue::SketchConstraint {
        value: Box::new(constraint),
    })
}

pub async fn diameter(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let segment: KclValue =
        args.get_unlabeled_kw_arg("points", &RuntimeType::Primitive(PrimitiveType::Any), exec_state)?;

    create_arc_radius_constraint(
        segment,
        |points| SketchConstraintKind::Diameter { points },
        args.source_range,
    )
    .map(|constraint| KclValue::SketchConstraint {
        value: Box::new(constraint),
    })
}

pub async fn horizontal_distance(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let points: Vec<KclValue> = args.get_unlabeled_kw_arg(
        "points",
        &RuntimeType::Array(Box::new(RuntimeType::Primitive(PrimitiveType::Any)), ArrayLen::Known(2)),
        exec_state,
    )?;
    let [p1, p2] = points.as_slice() else {
        return Err(KclError::new_semantic(KclErrorDetails::new(
            "must have two input points".to_owned(),
            vec![args.source_range],
        )));
    };
    match (p1, p2) {
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
                    // Both segments are points. Create a horizontal distance constraint
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
                                kind: SketchConstraintKind::HorizontalDistance {
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
                            "unimplemented: horizontalDistance() arguments must be all sketch vars in all coordinates"
                                .to_owned(),
                            vec![args.source_range],
                        ))),
                    }
                }
                _ => Err(KclError::new_semantic(KclErrorDetails::new(
                    "horizontalDistance() arguments must be unsolved points".to_owned(),
                    vec![args.source_range],
                ))),
            }
        }
        _ => Err(KclError::new_semantic(KclErrorDetails::new(
            "horizontalDistance() arguments must be point segments".to_owned(),
            vec![args.source_range],
        ))),
    }
}

pub async fn vertical_distance(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let points: Vec<KclValue> = args.get_unlabeled_kw_arg(
        "points",
        &RuntimeType::Array(Box::new(RuntimeType::Primitive(PrimitiveType::Any)), ArrayLen::Known(2)),
        exec_state,
    )?;
    let [p1, p2] = points.as_slice() else {
        return Err(KclError::new_semantic(KclErrorDetails::new(
            "must have two input points".to_owned(),
            vec![args.source_range],
        )));
    };
    match (p1, p2) {
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
                    // Both segments are points. Create a vertical distance constraint
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
                                kind: SketchConstraintKind::VerticalDistance {
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
                            "unimplemented: verticalDistance() arguments must be all sketch vars in all coordinates"
                                .to_owned(),
                            vec![args.source_range],
                        ))),
                    }
                }
                _ => Err(KclError::new_semantic(KclErrorDetails::new(
                    "verticalDistance() arguments must be unsolved points".to_owned(),
                    vec![args.source_range],
                ))),
            }
        }
        _ => Err(KclError::new_semantic(KclErrorDetails::new(
            "verticalDistance() arguments must be point segments".to_owned(),
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
    let [line0, line1]: [KclValue; 2] = lines.try_into().map_err(|_| {
        KclError::new_semantic(KclErrorDetails::new(
            "must have two input lines".to_owned(),
            vec![args.source_range],
        ))
    })?;

    let KclValue::Segment { value: segment0 } = &line0 else {
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
    let KclValue::Segment { value: segment1 } = &line1 else {
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
    let solver_line0_p0 = kcl_ezpz::datatypes::inputs::DatumPoint::new_xy(
        line0_p0_x.to_constraint_id(range)?,
        line0_p0_y.to_constraint_id(range)?,
    );
    let solver_line0_p1 = kcl_ezpz::datatypes::inputs::DatumPoint::new_xy(
        line0_p1_x.to_constraint_id(range)?,
        line0_p1_y.to_constraint_id(range)?,
    );
    let solver_line0 = kcl_ezpz::datatypes::inputs::DatumLineSegment::new(solver_line0_p0, solver_line0_p1);
    let solver_line1_p0 = kcl_ezpz::datatypes::inputs::DatumPoint::new_xy(
        line1_p0_x.to_constraint_id(range)?,
        line1_p0_y.to_constraint_id(range)?,
    );
    let solver_line1_p1 = kcl_ezpz::datatypes::inputs::DatumPoint::new_xy(
        line1_p1_x.to_constraint_id(range)?,
        line1_p1_y.to_constraint_id(range)?,
    );
    let solver_line1 = kcl_ezpz::datatypes::inputs::DatumLineSegment::new(solver_line1_p0, solver_line1_p1);
    let constraint = SolverConstraint::LinesEqualLength(solver_line0, solver_line1);
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

#[derive(Debug, Clone, Copy)]
pub(crate) enum LinesAtAngleKind {
    Parallel,
    Perpendicular,
}

impl LinesAtAngleKind {
    pub fn to_function_name(self) -> &'static str {
        match self {
            LinesAtAngleKind::Parallel => "parallel",
            LinesAtAngleKind::Perpendicular => "perpendicular",
        }
    }

    fn to_solver_angle(self) -> kcl_ezpz::datatypes::AngleKind {
        match self {
            LinesAtAngleKind::Parallel => kcl_ezpz::datatypes::AngleKind::Parallel,
            LinesAtAngleKind::Perpendicular => kcl_ezpz::datatypes::AngleKind::Perpendicular,
        }
    }

    #[cfg(feature = "artifact-graph")]
    fn constraint(&self, lines: Vec<ObjectId>) -> Constraint {
        match self {
            LinesAtAngleKind::Parallel => Constraint::Parallel(Parallel { lines }),
            LinesAtAngleKind::Perpendicular => Constraint::Perpendicular(Perpendicular { lines }),
        }
    }
}

pub async fn parallel(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    lines_at_angle(LinesAtAngleKind::Parallel, exec_state, args).await
}
pub async fn perpendicular(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    lines_at_angle(LinesAtAngleKind::Perpendicular, exec_state, args).await
}

async fn lines_at_angle(
    angle_kind: LinesAtAngleKind,
    exec_state: &mut ExecState,
    args: Args,
) -> Result<KclValue, KclError> {
    let lines: Vec<KclValue> = args.get_unlabeled_kw_arg(
        "lines",
        &RuntimeType::Array(Box::new(RuntimeType::Primitive(PrimitiveType::Any)), ArrayLen::Known(2)),
        exec_state,
    )?;
    let [line0, line1]: [KclValue; 2] = lines.try_into().map_err(|_| {
        KclError::new_semantic(KclErrorDetails::new(
            "must have two input lines".to_owned(),
            vec![args.source_range],
        ))
    })?;

    let KclValue::Segment { value: segment0 } = &line0 else {
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
    let KclValue::Segment { value: segment1 } = &line1 else {
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
    let solver_line0_p0 = kcl_ezpz::datatypes::inputs::DatumPoint::new_xy(
        line0_p0_x.to_constraint_id(range)?,
        line0_p0_y.to_constraint_id(range)?,
    );
    let solver_line0_p1 = kcl_ezpz::datatypes::inputs::DatumPoint::new_xy(
        line0_p1_x.to_constraint_id(range)?,
        line0_p1_y.to_constraint_id(range)?,
    );
    let solver_line0 = kcl_ezpz::datatypes::inputs::DatumLineSegment::new(solver_line0_p0, solver_line0_p1);
    let solver_line1_p0 = kcl_ezpz::datatypes::inputs::DatumPoint::new_xy(
        line1_p0_x.to_constraint_id(range)?,
        line1_p0_y.to_constraint_id(range)?,
    );
    let solver_line1_p1 = kcl_ezpz::datatypes::inputs::DatumPoint::new_xy(
        line1_p1_x.to_constraint_id(range)?,
        line1_p1_y.to_constraint_id(range)?,
    );
    let solver_line1 = kcl_ezpz::datatypes::inputs::DatumLineSegment::new(solver_line1_p0, solver_line1_p1);
    let constraint = SolverConstraint::LinesAtAngle(solver_line0, solver_line1, angle_kind.to_solver_angle());
    #[cfg(feature = "artifact-graph")]
    let constraint_id = exec_state.next_object_id();
    // Save the constraint to be used for solving.
    let Some(sketch_state) = exec_state.sketch_block_mut() else {
        return Err(KclError::new_semantic(KclErrorDetails::new(
            format!(
                "{}() can only be used inside a sketch block",
                angle_kind.to_function_name()
            ),
            vec![args.source_range],
        )));
    };
    sketch_state.solver_constraints.push(constraint);
    #[cfg(feature = "artifact-graph")]
    {
        let constraint = angle_kind.constraint(vec![unsolved0.object_id, unsolved1.object_id]);
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
            let solver_p0 = kcl_ezpz::datatypes::inputs::DatumPoint::new_xy(
                p0_x.to_constraint_id(range)?,
                p0_y.to_constraint_id(range)?,
            );
            let solver_p1 = kcl_ezpz::datatypes::inputs::DatumPoint::new_xy(
                p1_x.to_constraint_id(range)?,
                p1_y.to_constraint_id(range)?,
            );
            let solver_line = kcl_ezpz::datatypes::inputs::DatumLineSegment::new(solver_p0, solver_p1);
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
            let solver_p0 = kcl_ezpz::datatypes::inputs::DatumPoint::new_xy(
                p0_x.to_constraint_id(range)?,
                p0_y.to_constraint_id(range)?,
            );
            let solver_p1 = kcl_ezpz::datatypes::inputs::DatumPoint::new_xy(
                p1_x.to_constraint_id(range)?,
                p1_y.to_constraint_id(range)?,
            );
            let solver_line = kcl_ezpz::datatypes::inputs::DatumLineSegment::new(solver_p0, solver_p1);
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
