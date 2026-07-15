use anyhow::Result;
use ezpz::CircleSide;
use ezpz::Constraint as SolverConstraint;
use ezpz::LineSide;
use ezpz::datatypes::AngleKind;
use ezpz::datatypes::inputs::DatumCircle;
use ezpz::datatypes::inputs::DatumCircularArc;
use ezpz::datatypes::inputs::DatumDistance;
use ezpz::datatypes::inputs::DatumLineSegment;
use ezpz::datatypes::inputs::DatumPoint;
use kcl_api::UnitAngle;
use kcl_api::UnitLength;
use kittycad_modeling_cmds as kcmc;

use crate::errors::KclError;
use crate::errors::KclErrorDetails;
use crate::execution::AbstractSegment;
use crate::execution::Artifact;
use crate::execution::CodeRef;
use crate::execution::ConstrainableLine2d;
use crate::execution::ConstrainablePoint2d;
use crate::execution::ConstrainablePoint2dOrOrigin;
use crate::execution::ConstraintKey;
use crate::execution::ConstraintState;
use crate::execution::ExecState;
use crate::execution::KclValue;
use crate::execution::SegmentRepr;
use crate::execution::SketchBlockConstraint;
use crate::execution::SketchBlockConstraintType;
use crate::execution::SketchConstraint;
use crate::execution::SketchConstraintKind;
use crate::execution::SketchVarId;
use crate::execution::TangencyMode;
use crate::execution::UnsolvedExpr;
use crate::execution::UnsolvedSegment;
use crate::execution::UnsolvedSegmentKind;
use crate::execution::normalize_to_solver_distance_unit;
use crate::execution::solver_numeric_type;
use crate::execution::types::ArrayLen;
use crate::execution::types::NumericType;
use crate::execution::types::NumericTypeExt;
use crate::execution::types::PrimitiveType;
use crate::execution::types::RuntimeType;
use crate::execution::types::UnitType;
use crate::front::ArcCtor;
use crate::front::CircleCtor;
use crate::front::Coincident;
use crate::front::Constraint;
use crate::front::ControlPointSplineCtor;
use crate::front::EqualRadius;
use crate::front::Horizontal;
use crate::front::LineCtor;
use crate::front::LinesEqualLength;
use crate::front::Midpoint;
use crate::front::Number;
use crate::front::Object;
use crate::front::ObjectId;
use crate::front::ObjectKind;
use crate::front::Parallel;
use crate::front::Perpendicular;
use crate::front::Point2d;
use crate::front::PointCtor;
use crate::front::SourceRef;
use crate::front::Symmetric;
use crate::front::Tangent;
use crate::front::Vertical;
use crate::frontend::sketch::ConstraintSegment;
use crate::std::Args;
use crate::std::args::FromKclValue;
use crate::std::args::TyF64;

fn point2d_is_origin(point2d: &KclValue) -> bool {
    let Some([x, y]) = <[TyF64; 2]>::from_kcl_val(point2d) else {
        return false;
    };
    // Both components must be lengths (not angles or unknown types).
    // as_length() returns None for non-length types.
    if x.ty.as_length().is_none() || y.ty.as_length().is_none() {
        return false;
    }
    // Now that we've checked that they're lengths, the exact units don't
    // matter. We only care that the value is zero.
    x.n == 0.0 && y.n == 0.0
}

fn numeric_suffix_to_type(suffix: crate::pretty::NumericSuffix, exec_state: &ExecState) -> NumericType {
    match suffix {
        crate::pretty::NumericSuffix::None => NumericType::Default {
            len: exec_state.length_unit(),
            angle: exec_state.angle_unit(),
        },
        crate::pretty::NumericSuffix::Count => NumericType::Known(UnitType::Count),
        crate::pretty::NumericSuffix::Length => NumericType::Known(UnitType::GenericLength),
        crate::pretty::NumericSuffix::Angle => NumericType::Known(UnitType::GenericAngle),
        crate::pretty::NumericSuffix::Mm => NumericType::Known(UnitType::Length(UnitLength::Millimeters)),
        crate::pretty::NumericSuffix::Cm => NumericType::Known(UnitType::Length(UnitLength::Centimeters)),
        crate::pretty::NumericSuffix::M => NumericType::Known(UnitType::Length(UnitLength::Meters)),
        crate::pretty::NumericSuffix::Inch => NumericType::Known(UnitType::Length(UnitLength::Inches)),
        crate::pretty::NumericSuffix::Ft => NumericType::Known(UnitType::Length(UnitLength::Feet)),
        crate::pretty::NumericSuffix::Yd => NumericType::Known(UnitType::Length(UnitLength::Yards)),
        crate::pretty::NumericSuffix::Deg => NumericType::Known(UnitType::Angle(UnitAngle::Degrees)),
        crate::pretty::NumericSuffix::Rad => NumericType::Known(UnitType::Angle(UnitAngle::Radians)),
        crate::pretty::NumericSuffix::Unknown => NumericType::Unknown,
    }
}

fn number_to_solver_distance(
    number: Number,
    exec_state: &mut ExecState,
    source_range: crate::SourceRange,
    description: &str,
) -> Result<f64, KclError> {
    let value = ty_f64_to_kcl_value(
        TyF64::new(number.value, numeric_suffix_to_type(number.units, exec_state)),
        source_range,
    );
    let normalized = normalize_to_solver_distance_unit(&value, source_range, exec_state, description)?;
    let Some(n) = normalized.as_ty_f64() else {
        return Err(KclError::new_internal(KclErrorDetails::new(
            format!("{description} did not normalize to a number"),
            vec![source_range],
        )));
    };
    Ok(n.n)
}

fn drag_anchor_target_to_solver_units(
    target: Point2d<Number>,
    exec_state: &mut ExecState,
    source_range: crate::SourceRange,
) -> Result<[f64; 2], KclError> {
    Ok([
        number_to_solver_distance(target.x, exec_state, source_range, "drag anchor x")?,
        number_to_solver_distance(target.y, exec_state, source_range, "drag anchor y")?,
    ])
}

struct FixedDragAnchorPoint {
    point: DatumPoint,
    fixed_constraints: [SolverConstraint; 2],
}

fn fixed_drag_anchor_point(
    exec_state: &mut ExecState,
    range: crate::SourceRange,
    target: Point2d<Number>,
) -> Result<FixedDragAnchorPoint, KclError> {
    let [target_x, target_y] = drag_anchor_target_to_solver_units(target, exec_state, range)?;
    let solver_ty = solver_numeric_type(exec_state);
    let Some(sketch_state) = exec_state.sketch_block_mut() else {
        return Err(KclError::new_semantic(KclErrorDetails::new(
            "drag anchors can only be used inside a sketch block".to_owned(),
            vec![range],
        )));
    };

    let anchor_x_id = sketch_state.next_sketch_var_id();
    sketch_state.sketch_vars.push(KclValue::SketchVar {
        value: Box::new(crate::execution::SketchVar {
            id: anchor_x_id,
            initial_value: target_x,
            ty: solver_ty,
            node_path: None,
            meta: Vec::new(),
        }),
    });

    let anchor_y_id = sketch_state.next_sketch_var_id();
    sketch_state.sketch_vars.push(KclValue::SketchVar {
        value: Box::new(crate::execution::SketchVar {
            id: anchor_y_id,
            initial_value: target_y,
            ty: solver_ty,
            node_path: None,
            meta: Vec::new(),
        }),
    });

    let point = DatumPoint::new_xy(
        anchor_x_id.to_constraint_id(range)?,
        anchor_y_id.to_constraint_id(range)?,
    );
    Ok(FixedDragAnchorPoint {
        point,
        fixed_constraints: [
            SolverConstraint::Fixed(point.x_id, target_x),
            SolverConstraint::Fixed(point.y_id, target_y),
        ],
    })
}

fn fixed_origin_datum_point(
    exec_state: &mut ExecState,
    range: crate::SourceRange,
    constraint_name: &str,
) -> Result<(DatumPoint, [SolverConstraint; 2]), KclError> {
    let sketch_var_ty = solver_numeric_type(exec_state);
    let Some(sketch_state) = exec_state.sketch_block_mut() else {
        return Err(KclError::new_semantic(KclErrorDetails::new(
            format!("{constraint_name}() can only be used inside a sketch block"),
            vec![range],
        )));
    };

    let origin_x_id = sketch_state.next_sketch_var_id();
    sketch_state.sketch_vars.push(KclValue::SketchVar {
        value: Box::new(crate::execution::SketchVar {
            id: origin_x_id,
            initial_value: 0.0,
            ty: sketch_var_ty,
            // Synthesized fixed origin coord; not source-backed.
            node_path: None,
            meta: vec![],
        }),
    });

    let origin_y_id = sketch_state.next_sketch_var_id();
    sketch_state.sketch_vars.push(KclValue::SketchVar {
        value: Box::new(crate::execution::SketchVar {
            id: origin_y_id,
            initial_value: 0.0,
            ty: sketch_var_ty,
            // Synthesized fixed origin coord; not source-backed.
            node_path: None,
            meta: vec![],
        }),
    });

    let origin_x = origin_x_id.to_constraint_id(range)?;
    let origin_y = origin_y_id.to_constraint_id(range)?;

    Ok((
        DatumPoint::new_xy(origin_x, origin_y),
        [
            SolverConstraint::Fixed(origin_x, 0.0),
            SolverConstraint::Fixed(origin_y, 0.0),
        ],
    ))
}

#[derive(Debug, Clone, Copy)]
struct LineVars {
    start: [SketchVarId; 2],
    end: [SketchVarId; 2],
}

#[derive(Debug, Clone, Copy)]
struct ArcVars {
    center: [SketchVarId; 2],
    start: [SketchVarId; 2],
    end: Option<[SketchVarId; 2]>,
}

fn make_line_arc_tangency_key(line: LineVars, arc: ArcVars) -> ConstraintKey {
    let [a0, a1, a2, a3] = flatten_line_vars(line);
    let [b0, b1, b2, b3, b4, b5] = flatten_arc_vars(arc);
    ConstraintKey::LineCircle([a0, a1, a2, a3, b0, b1, b2, b3, b4, b5])
}

fn make_arc_arc_tangency_key(arc_a: ArcVars, arc_b: ArcVars) -> ConstraintKey {
    let flat_a = flatten_arc_vars(arc_a);
    let flat_b = flatten_arc_vars(arc_b);
    let (lhs, rhs) = if flat_a <= flat_b {
        (flat_a, flat_b)
    } else {
        (flat_b, flat_a)
    };
    let [a0, a1, a2, a3, a4, a5] = lhs;
    let [b0, b1, b2, b3, b4, b5] = rhs;
    ConstraintKey::CircleCircle([a0, a1, a2, a3, a4, a5, b0, b1, b2, b3, b4, b5])
}

fn flatten_line_vars(line: LineVars) -> [usize; 4] {
    [line.start[0].0, line.start[1].0, line.end[0].0, line.end[1].0]
}

fn flatten_arc_vars(arc: ArcVars) -> [usize; 6] {
    let end = arc.end.unwrap_or([SketchVarId::INVALID; 2]);
    [
        arc.center[0].0,
        arc.center[1].0,
        arc.start[0].0,
        arc.start[1].0,
        end[0].0,
        end[1].0,
    ]
}

fn infer_line_tangent_side(
    sketch_vars: &[KclValue],
    line: LineVars,
    circle_center: [SketchVarId; 2],
    exec_state: &mut ExecState,
    range: crate::SourceRange,
) -> Result<LineSide, KclError> {
    let [sx, sy] = point_initial_position(sketch_vars, line.start, exec_state, range)?;
    let [ex, ey] = point_initial_position(sketch_vars, line.end, exec_state, range)?;
    let [cx, cy] = point_initial_position(sketch_vars, circle_center, exec_state, range)?;
    let cross = (ex - sx) * (cy - sy) - (ey - sy) * (cx - sx);
    Ok(if cross >= 0.0 { LineSide::Left } else { LineSide::Right })
}

fn infer_arc_tangent_side(
    sketch_vars: &[KclValue],
    arc_a: ArcVars,
    arc_b: ArcVars,
    exec_state: &mut ExecState,
    range: crate::SourceRange,
) -> Result<CircleSide, KclError> {
    let rad_a = arc_initial_radius(sketch_vars, arc_a, exec_state, range)?;
    let rad_b = arc_initial_radius(sketch_vars, arc_b, exec_state, range)?;
    infer_circle_tangent_side(sketch_vars, arc_a.center, arc_b.center, rad_a, rad_b, exec_state, range)
}

fn infer_circle_tangent_side(
    sketch_vars: &[KclValue],
    center_a: [SketchVarId; 2],
    center_b: [SketchVarId; 2],
    radius_a: f64,
    radius_b: f64,
    exec_state: &mut ExecState,
    range: crate::SourceRange,
) -> Result<CircleSide, KclError> {
    let dist = points_initial_distance(sketch_vars, center_a, center_b, exec_state, range)?;
    let r_int = ((radius_a - radius_b).abs() - dist).abs();
    let r_ext = (radius_a + radius_b - dist).abs();
    Ok(if r_int < r_ext {
        CircleSide::Interior
    } else {
        CircleSide::Exterior
    })
}

fn point_initial_position(
    sketch_vars: &[KclValue],
    point: [SketchVarId; 2],
    exec_state: &mut ExecState,
    range: crate::SourceRange,
) -> Result<[f64; 2], KclError> {
    Ok([
        sketch_var_initial_value(sketch_vars, point[0], exec_state, range)?,
        sketch_var_initial_value(sketch_vars, point[1], exec_state, range)?,
    ])
}

fn points_initial_distance(
    sketch_vars: &[KclValue],
    point_a: [SketchVarId; 2],
    point_b: [SketchVarId; 2],
    exec_state: &mut ExecState,
    range: crate::SourceRange,
) -> Result<f64, KclError> {
    let [a_x, a_y] = point_initial_position(sketch_vars, point_a, exec_state, range)?;
    let [b_x, b_y] = point_initial_position(sketch_vars, point_b, exec_state, range)?;
    Ok(libm::hypot(a_x - b_x, a_y - b_y))
}

fn arc_initial_radius(
    sketch_vars: &[KclValue],
    arc: ArcVars,
    exec_state: &mut ExecState,
    range: crate::SourceRange,
) -> Result<f64, KclError> {
    points_initial_distance(sketch_vars, arc.center, arc.start, exec_state, range)
}

fn constrainable_point_from_unsolved_segment(
    segment: &UnsolvedSegment,
    function_name: &str,
    range: crate::SourceRange,
) -> Result<ConstrainablePoint2d, KclError> {
    let UnsolvedSegmentKind::Point { position, .. } = &segment.kind else {
        return Err(KclError::new_semantic(KclErrorDetails::new(
            format!("{function_name}() expected a point segment"),
            vec![range],
        )));
    };

    match (&position[0], &position[1]) {
        (UnsolvedExpr::Unknown(x), UnsolvedExpr::Unknown(y)) => Ok(ConstrainablePoint2d {
            vars: crate::front::Point2d { x: *x, y: *y },
            object_id: segment.object_id,
        }),
        _ => Err(KclError::new_semantic(KclErrorDetails::new(
            format!("unimplemented: {function_name}() point arguments must be sketch vars in all coordinates"),
            vec![range],
        ))),
    }
}

fn constrainable_line_from_unsolved_segment(
    segment: &UnsolvedSegment,
    function_name: &str,
    range: crate::SourceRange,
) -> Result<ConstrainableLine2d, KclError> {
    let UnsolvedSegmentKind::Line { start, end, .. } = &segment.kind else {
        return Err(KclError::new_semantic(KclErrorDetails::new(
            format!("{function_name}() expected a line segment"),
            vec![range],
        )));
    };

    match (&start[0], &start[1], &end[0], &end[1]) {
        (
            UnsolvedExpr::Unknown(start_x),
            UnsolvedExpr::Unknown(start_y),
            UnsolvedExpr::Unknown(end_x),
            UnsolvedExpr::Unknown(end_y),
        ) => Ok(ConstrainableLine2d {
            vars: [
                crate::front::Point2d {
                    x: *start_x,
                    y: *start_y,
                },
                crate::front::Point2d { x: *end_x, y: *end_y },
            ],
            object_id: segment.object_id,
        }),
        _ => Err(KclError::new_semantic(KclErrorDetails::new(
            format!("unimplemented: {function_name}() line arguments must be sketch vars in all coordinates"),
            vec![range],
        ))),
    }
}

fn constrainable_point_from_exprs(
    position: &[UnsolvedExpr; 2],
    object_id: ObjectId,
    function_name: &str,
    range: crate::SourceRange,
    description: &str,
) -> Result<ConstrainablePoint2d, KclError> {
    match (&position[0], &position[1]) {
        (UnsolvedExpr::Unknown(x), UnsolvedExpr::Unknown(y)) => Ok(ConstrainablePoint2d {
            vars: crate::front::Point2d { x: *x, y: *y },
            object_id,
        }),
        _ => Err(KclError::new_semantic(KclErrorDetails::new(
            format!("unimplemented: {function_name}() {description} must be sketch vars in all coordinates"),
            vec![range],
        ))),
    }
}

fn constrainable_circular_from_unsolved_segment(
    segment: &UnsolvedSegment,
    function_name: &str,
    range: crate::SourceRange,
) -> Result<(ConstrainablePoint2d, ConstrainablePoint2d, Option<ConstrainablePoint2d>), KclError> {
    match &segment.kind {
        UnsolvedSegmentKind::Arc {
            center,
            start,
            end,
            center_object_id,
            start_object_id,
            end_object_id,
            ..
        } => Ok((
            constrainable_point_from_exprs(center, *center_object_id, function_name, range, "arc center")?,
            constrainable_point_from_exprs(start, *start_object_id, function_name, range, "arc start")?,
            Some(constrainable_point_from_exprs(
                end,
                *end_object_id,
                function_name,
                range,
                "arc end",
            )?),
        )),
        UnsolvedSegmentKind::Circle {
            center,
            start,
            center_object_id,
            start_object_id,
            ..
        } => Ok((
            constrainable_point_from_exprs(center, *center_object_id, function_name, range, "circle center")?,
            constrainable_point_from_exprs(start, *start_object_id, function_name, range, "circle start")?,
            None,
        )),
        _ => Err(KclError::new_semantic(KclErrorDetails::new(
            format!("{function_name}() expected an arc or circle segment"),
            vec![range],
        ))),
    }
}

/// A point-based segment (arc, circle, ...) decomposes into scalar coordinate
/// values (the x and y of each of its points). Each could be a fixed constant
/// or a sketch variable to be solved, but each needs a sketch variable to feed
/// into the solver. If it's already a solver variable, use it. If it's a fixed
/// constant, create a solver variable for it and return a constraint to fix it.
fn extract_point_component(
    value: &KclValue,
    exec_state: &mut ExecState,
    range: crate::SourceRange,
    function_name: &str,
    description: &str,
) -> Result<(SketchVarId, Option<SolverConstraint>), KclError> {
    match value.as_unsolved_expr() {
        None => Err(KclError::new_semantic(KclErrorDetails::new(
            format!("{description} must be a number or sketch var"),
            vec![range],
        ))),
        Some(UnsolvedExpr::Unknown(var_id)) => Ok((var_id, None)),
        Some(UnsolvedExpr::Known(_)) => {
            let value_in_solver_units = normalize_to_solver_distance_unit(value, range, exec_state, description)?;
            let Some(normalized_value) = value_in_solver_units.as_ty_f64() else {
                return Err(KclError::new_internal(KclErrorDetails::new(
                    "Expected number after coercion".to_owned(),
                    vec![range],
                )));
            };

            let Some(sketch_state) = exec_state.sketch_block_mut() else {
                return Err(KclError::new_semantic(KclErrorDetails::new(
                    format!("{function_name}() can only be used inside a sketch block"),
                    vec![range],
                )));
            };
            let var_id = sketch_state.next_sketch_var_id();
            sketch_state.sketch_vars.push(KclValue::SketchVar {
                value: Box::new(crate::execution::SketchVar {
                    id: var_id,
                    initial_value: normalized_value.n,
                    ty: normalized_value.ty,
                    // Synthesized to fix a constant; not backed by a `var` in source.
                    node_path: None,
                    meta: vec![],
                }),
            });

            Ok((
                var_id,
                Some(SolverConstraint::Fixed(
                    var_id.to_constraint_id(range)?,
                    normalized_value.n,
                )),
            ))
        }
    }
}

fn coincident_segments_for_segment_and_point2d(
    segment_id: ObjectId,
    point2d: &KclValue,
    segment_first: bool,
) -> Vec<ConstraintSegment> {
    if !point2d_is_origin(point2d) {
        return vec![segment_id.into()];
    }

    if segment_first {
        vec![segment_id.into(), ConstraintSegment::ORIGIN]
    } else {
        vec![ConstraintSegment::ORIGIN, segment_id.into()]
    }
}

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
        tag: None,
        node_path: args.node_path.clone(),
        meta: vec![args.source_range.into()],
    };
    let optional_constraints = {
        let object_id = exec_state.add_placeholder_scene_object(segment.object_id, args.source_range, args.node_path);

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
            "point() can only be used inside a sketch block".to_owned(),
            vec![args.source_range],
        )));
    };
    sketch_state.needed_by_engine.push(segment.clone());

    sketch_state.solver_optional_constraints.extend(optional_constraints);

    let meta = segment.meta.clone();
    let abstract_segment = AbstractSegment {
        repr: SegmentRepr::Unsolved {
            segment: Box::new(segment),
        },
        meta,
    };
    Ok(KclValue::Segment {
        value: Box::new(abstract_segment),
    })
}

pub async fn line(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let start: Vec<KclValue> = args.get_kw_arg("start", &RuntimeType::point2d(), exec_state)?;
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
    let line_var_ids = (start_x.var(), start_y.var(), end_x.var(), end_y.var());
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
        tag: None,
        node_path: args.node_path.clone(),
        meta: vec![args.source_range.into()],
    };
    let mut optional_constraints = {
        let start_object_id =
            exec_state.add_placeholder_scene_object(start_object_id, args.source_range, args.node_path.clone());
        let end_object_id =
            exec_state.add_placeholder_scene_object(end_object_id, args.source_range, args.node_path.clone());
        let line_object_id =
            exec_state.add_placeholder_scene_object(line_object_id, args.source_range, args.node_path.clone());

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
    let mut required_constraints = Vec::new();
    if let Some(target) = exec_state.drag_anchor_target(&line_object_id).cloned()
        && let (Some(start_x), Some(start_y), Some(end_x), Some(end_y)) = line_var_ids
    {
        let anchor = fixed_drag_anchor_point(exec_state, args.source_range, target)?;
        required_constraints.push(SolverConstraint::PointLineDistance(
            anchor.point,
            DatumLineSegment::new(
                DatumPoint::new_xy(
                    start_x.to_constraint_id(args.source_range)?,
                    start_y.to_constraint_id(args.source_range)?,
                ),
                DatumPoint::new_xy(
                    end_x.to_constraint_id(args.source_range)?,
                    end_y.to_constraint_id(args.source_range)?,
                ),
            ),
            0.0,
        ));
        optional_constraints.extend(anchor.fixed_constraints);
    }

    // Save the segment to be sent to the engine after solving.
    let Some(sketch_state) = exec_state.sketch_block_mut() else {
        return Err(KclError::new_semantic(KclErrorDetails::new(
            "line() can only be used inside a sketch block".to_owned(),
            vec![args.source_range],
        )));
    };
    sketch_state.needed_by_engine.push(segment.clone());

    sketch_state.solver_constraints.extend(required_constraints);
    sketch_state.solver_optional_constraints.extend(optional_constraints);

    let meta = segment.meta.clone();
    let abstract_segment = AbstractSegment {
        repr: SegmentRepr::Unsolved {
            segment: Box::new(segment),
        },
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

    let (start_x, start_x_fixed) =
        extract_point_component(&start_x_value, exec_state, args.source_range, "arc", "start x")?;
    let (start_y, start_y_fixed) =
        extract_point_component(&start_y_value, exec_state, args.source_range, "arc", "start y")?;
    let (end_x, end_x_fixed) = extract_point_component(&end_x_value, exec_state, args.source_range, "arc", "end x")?;
    let (end_y, end_y_fixed) = extract_point_component(&end_y_value, exec_state, args.source_range, "arc", "end y")?;
    let (center_x, center_x_fixed) =
        extract_point_component(&center_x_value, exec_state, args.source_range, "arc", "center x")?;
    let (center_y, center_y_fixed) =
        extract_point_component(&center_y_value, exec_state, args.source_range, "arc", "center y")?;
    // If any of the points had any components that were fixed, then they'll become constraints
    // in this list.
    let arc_fixed_constraints = [
        start_x_fixed,
        start_y_fixed,
        end_x_fixed,
        end_y_fixed,
        center_x_fixed,
        center_y_fixed,
    ]
    .into_iter()
    .flatten();

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
        tag: None,
        node_path: args.node_path.clone(),
        meta: vec![args.source_range.into()],
    };
    let optional_constraints = {
        let start_object_id =
            exec_state.add_placeholder_scene_object(start_object_id, args.source_range, args.node_path.clone());
        let end_object_id =
            exec_state.add_placeholder_scene_object(end_object_id, args.source_range, args.node_path.clone());
        let center_object_id =
            exec_state.add_placeholder_scene_object(center_object_id, args.source_range, args.node_path.clone());
        let arc_object_id =
            exec_state.add_placeholder_scene_object(arc_object_id, args.source_range, args.node_path.clone());

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
                optional_constraints.push(ezpz::Constraint::Fixed(
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
                optional_constraints.push(ezpz::Constraint::Fixed(
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
                optional_constraints.push(ezpz::Constraint::Fixed(
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
                optional_constraints.push(ezpz::Constraint::Fixed(
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
                optional_constraints.push(ezpz::Constraint::Fixed(
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
                optional_constraints.push(ezpz::Constraint::Fixed(
                    center_y_var.id.to_constraint_id(args.source_range)?,
                    y_initial_value.n,
                ));
            }
        }
        optional_constraints
    };
    // Build the implicit arc constraint.
    let range = args.source_range;
    let mut required_constraints = Vec::with_capacity(7);
    required_constraints.extend(arc_fixed_constraints);
    required_constraints.push(ezpz::Constraint::Arc(ezpz::datatypes::inputs::DatumCircularArc {
        center: ezpz::datatypes::inputs::DatumPoint::new_xy(
            center_x.to_constraint_id(range)?,
            center_y.to_constraint_id(range)?,
        ),
        start: ezpz::datatypes::inputs::DatumPoint::new_xy(
            start_x.to_constraint_id(range)?,
            start_y.to_constraint_id(range)?,
        ),
        end: ezpz::datatypes::inputs::DatumPoint::new_xy(
            end_x.to_constraint_id(range)?,
            end_y.to_constraint_id(range)?,
        ),
    }));
    let drag_anchor = exec_state
        .drag_anchor_target(&arc_object_id)
        .cloned()
        .map(|target| fixed_drag_anchor_point(exec_state, range, target))
        .transpose()?;

    let Some(sketch_state) = exec_state.sketch_block_mut() else {
        return Err(KclError::new_semantic(KclErrorDetails::new(
            "arc() can only be used inside a sketch block".to_owned(),
            vec![args.source_range],
        )));
    };
    if let Some(anchor) = drag_anchor {
        required_constraints.push(ezpz::Constraint::PointArcCoincident(
            DatumCircularArc {
                center: DatumPoint::new_xy(center_x.to_constraint_id(range)?, center_y.to_constraint_id(range)?),
                start: DatumPoint::new_xy(start_x.to_constraint_id(range)?, start_y.to_constraint_id(range)?),
                end: DatumPoint::new_xy(end_x.to_constraint_id(range)?, end_y.to_constraint_id(range)?),
            },
            anchor.point,
        ));
        sketch_state
            .solver_optional_constraints
            .extend(anchor.fixed_constraints);
    }
    // Save the segment to be sent to the engine after solving.
    sketch_state.needed_by_engine.push(segment.clone());
    // Save the constraints to be used for solving.
    sketch_state.solver_constraints.extend(required_constraints);
    // The constraint isn't added to scene objects since it's implicit in the
    // arc segment. You cannot have an arc without it.

    sketch_state.solver_optional_constraints.extend(optional_constraints);

    let meta = segment.meta.clone();
    let abstract_segment = AbstractSegment {
        repr: SegmentRepr::Unsolved {
            segment: Box::new(segment),
        },
        meta,
    };
    Ok(KclValue::Segment {
        value: Box::new(abstract_segment),
    })
}

pub async fn circle(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let start: Vec<KclValue> = args.get_kw_arg("start", &RuntimeType::point2d(), exec_state)?;
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
    let [center_x_value, center_y_value]: [KclValue; 2] = center.try_into().map_err(|_| {
        KclError::new_semantic(KclErrorDetails::new(
            "center must be a 2D point".to_owned(),
            vec![args.source_range],
        ))
    })?;

    // Coordinates may be sketch vars or fixed constants. Constants become
    // synthetic solver vars pinned with a Fixed constraint, exactly like arc().
    // This keeps the circle's coordinates as solver vars so the circle can be
    // used in constraints (distance, diameter, radius, tangent, equalRadius).
    let (start_x, start_x_fixed) =
        extract_point_component(&start_x_value, exec_state, args.source_range, "circle", "start x")?;
    let (start_y, start_y_fixed) =
        extract_point_component(&start_y_value, exec_state, args.source_range, "circle", "start y")?;
    let (center_x, center_x_fixed) =
        extract_point_component(&center_x_value, exec_state, args.source_range, "circle", "center x")?;
    let (center_y, center_y_fixed) =
        extract_point_component(&center_y_value, exec_state, args.source_range, "circle", "center y")?;
    // If any coordinates were fixed constants, pin them with constraints.
    let circle_fixed_constraints = [start_x_fixed, start_y_fixed, center_x_fixed, center_y_fixed]
        .into_iter()
        .flatten();

    let ctor = CircleCtor {
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
    let center_object_id = exec_state.next_object_id();
    let circle_object_id = exec_state.next_object_id();
    let segment = UnsolvedSegment {
        id: exec_state.next_uuid(),
        object_id: circle_object_id,
        kind: UnsolvedSegmentKind::Circle {
            start: [UnsolvedExpr::Unknown(start_x), UnsolvedExpr::Unknown(start_y)],
            center: [UnsolvedExpr::Unknown(center_x), UnsolvedExpr::Unknown(center_y)],
            ctor: Box::new(ctor),
            start_object_id,
            center_object_id,
            construction,
        },
        tag: None,
        node_path: args.node_path.clone(),
        meta: vec![args.source_range.into()],
    };
    let mut optional_constraints = {
        let start_object_id =
            exec_state.add_placeholder_scene_object(start_object_id, args.source_range, args.node_path.clone());
        let center_object_id =
            exec_state.add_placeholder_scene_object(center_object_id, args.source_range, args.node_path.clone());
        let circle_object_id =
            exec_state.add_placeholder_scene_object(circle_object_id, args.source_range, args.node_path.clone());

        let mut optional_constraints = Vec::new();
        if exec_state.segment_ids_edited_contains(&start_object_id)
            || exec_state.segment_ids_edited_contains(&circle_object_id)
        {
            if let Some(start_x_var) = start_x_value.as_sketch_var() {
                let x_initial_value = start_x_var.initial_value_to_solver_units(
                    exec_state,
                    args.source_range,
                    "edited segment fixed constraint value",
                )?;
                optional_constraints.push(ezpz::Constraint::Fixed(
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
                optional_constraints.push(ezpz::Constraint::Fixed(
                    start_y_var.id.to_constraint_id(args.source_range)?,
                    y_initial_value.n,
                ));
            }
        }
        if exec_state.segment_ids_edited_contains(&center_object_id)
            || exec_state.segment_ids_edited_contains(&circle_object_id)
        {
            if let Some(center_x_var) = center_x_value.as_sketch_var() {
                let x_initial_value = center_x_var.initial_value_to_solver_units(
                    exec_state,
                    args.source_range,
                    "edited segment fixed constraint value",
                )?;
                optional_constraints.push(ezpz::Constraint::Fixed(
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
                optional_constraints.push(ezpz::Constraint::Fixed(
                    center_y_var.id.to_constraint_id(args.source_range)?,
                    y_initial_value.n,
                ));
            }
        }
        optional_constraints
    };
    let mut required_constraints = Vec::new();
    required_constraints.extend(circle_fixed_constraints);
    if let Some(target) = exec_state.drag_anchor_target(&circle_object_id).cloned() {
        let anchor = fixed_drag_anchor_point(exec_state, args.source_range, target)?;
        let center = DatumPoint::new_xy(
            center_x.to_constraint_id(args.source_range)?,
            center_y.to_constraint_id(args.source_range)?,
        );
        required_constraints.push(SolverConstraint::LinesEqualLength(
            DatumLineSegment::new(center, anchor.point),
            DatumLineSegment::new(
                center,
                DatumPoint::new_xy(
                    start_x.to_constraint_id(args.source_range)?,
                    start_y.to_constraint_id(args.source_range)?,
                ),
            ),
        ));
        optional_constraints.extend(anchor.fixed_constraints);
    }

    let Some(sketch_state) = exec_state.sketch_block_mut() else {
        return Err(KclError::new_semantic(KclErrorDetails::new(
            "circle() can only be used inside a sketch block".to_owned(),
            vec![args.source_range],
        )));
    };
    // Save the segment to be sent to the engine after solving.
    sketch_state.needed_by_engine.push(segment.clone());

    sketch_state.solver_constraints.extend(required_constraints);
    sketch_state.solver_optional_constraints.extend(optional_constraints);

    let meta = segment.meta.clone();
    let abstract_segment = AbstractSegment {
        repr: SegmentRepr::Unsolved {
            segment: Box::new(segment),
        },
        meta,
    };
    Ok(KclValue::Segment {
        value: Box::new(abstract_segment),
    })
}

pub async fn control_point_spline(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let points: Vec<KclValue> = args.get_kw_arg(
        "points",
        &RuntimeType::Array(Box::new(RuntimeType::point2d()), ArrayLen::Minimum(3)),
        exec_state,
    )?;
    let construction_opt = args.get_kw_arg_opt("construction", &RuntimeType::bool(), exec_state)?;
    let construction = construction_opt.unwrap_or(false);

    if points.len() < 3 {
        return Err(KclError::new_semantic(KclErrorDetails::new(
            "controlPointSpline requires at least 3 control points".to_owned(),
            vec![args.source_range],
        )));
    }

    let degree = usize::min(3, points.len() - 1) as u32;
    let mut ctor_points = Vec::with_capacity(points.len());
    let mut control_values = Vec::with_capacity(points.len());
    let mut controls = Vec::with_capacity(points.len());
    let mut control_object_ids = Vec::with_capacity(points.len());
    let mut control_polygon_edge_object_ids = Vec::with_capacity(points.len().saturating_sub(1));

    for point in points {
        let KclValue::HomArray { value, .. } = point else {
            return Err(KclError::new_semantic(KclErrorDetails::new(
                "each control point must be a 2D point".to_owned(),
                vec![args.source_range],
            )));
        };
        let [x_value, y_value]: [KclValue; 2] = value.try_into().map_err(|_| {
            KclError::new_semantic(KclErrorDetails::new(
                "each control point must be a 2D point".to_owned(),
                vec![args.source_range],
            ))
        })?;
        let Some(x) = x_value.as_unsolved_expr() else {
            return Err(KclError::new_semantic(KclErrorDetails::new(
                "control point x must be a number or sketch var".to_owned(),
                vec![args.source_range],
            )));
        };
        let Some(y) = y_value.as_unsolved_expr() else {
            return Err(KclError::new_semantic(KclErrorDetails::new(
                "control point y must be a number or sketch var".to_owned(),
                vec![args.source_range],
            )));
        };
        ctor_points.push(Point2d {
            x: x_value.to_sketch_expr().ok_or_else(|| {
                KclError::new_semantic(KclErrorDetails::new(
                    "unable to convert numeric type to suffix".to_owned(),
                    vec![args.source_range],
                ))
            })?,
            y: y_value.to_sketch_expr().ok_or_else(|| {
                KclError::new_semantic(KclErrorDetails::new(
                    "unable to convert numeric type to suffix".to_owned(),
                    vec![args.source_range],
                ))
            })?,
        });
        control_values.push([x_value, y_value]);
        controls.push([x, y]);
        control_object_ids.push(exec_state.next_object_id());
    }
    for _ in 0..controls.len().saturating_sub(1) {
        control_polygon_edge_object_ids.push(exec_state.next_object_id());
    }

    let spline_object_id = exec_state.next_object_id();
    let ctor = ControlPointSplineCtor {
        points: ctor_points,
        construction: construction_opt,
    };
    let segment = UnsolvedSegment {
        id: exec_state.next_uuid(),
        object_id: spline_object_id,
        kind: UnsolvedSegmentKind::ControlPointSpline {
            controls,
            ctor: Box::new(ctor),
            control_object_ids: control_object_ids.clone(),
            control_polygon_edge_object_ids: control_polygon_edge_object_ids.clone(),
            degree,
            construction,
        },
        tag: None,
        node_path: args.node_path.clone(),
        meta: vec![args.source_range.into()],
    };

    let optional_constraints = {
        let placeholder_control_ids = control_object_ids
            .iter()
            .map(|control_object_id| {
                exec_state.add_placeholder_scene_object(*control_object_id, args.source_range, args.node_path.clone())
            })
            .collect::<Vec<_>>();
        control_polygon_edge_object_ids.iter().for_each(|edge_object_id| {
            exec_state.add_placeholder_scene_object(*edge_object_id, args.source_range, args.node_path.clone());
        });
        let spline_object_id =
            exec_state.add_placeholder_scene_object(spline_object_id, args.source_range, args.node_path.clone());

        let mut optional_constraints = Vec::new();
        for (index, [x_value, y_value]) in control_values.iter().enumerate() {
            let control_object_id = placeholder_control_ids[index];
            if !(exec_state.segment_ids_edited_contains(&control_object_id)
                || exec_state.segment_ids_edited_contains(&spline_object_id))
            {
                continue;
            }

            if let Some(x_var) = x_value.as_sketch_var() {
                let x_initial_value = x_var.initial_value_to_solver_units(
                    exec_state,
                    args.source_range,
                    "edited segment fixed constraint value",
                )?;
                optional_constraints.push(SolverConstraint::Fixed(
                    x_var.id.to_constraint_id(args.source_range)?,
                    x_initial_value.n,
                ));
            }

            if let Some(y_var) = y_value.as_sketch_var() {
                let y_initial_value = y_var.initial_value_to_solver_units(
                    exec_state,
                    args.source_range,
                    "edited segment fixed constraint value",
                )?;
                optional_constraints.push(SolverConstraint::Fixed(
                    y_var.id.to_constraint_id(args.source_range)?,
                    y_initial_value.n,
                ));
            }
        }
        optional_constraints
    };

    let Some(sketch_state) = exec_state.sketch_block_mut() else {
        return Err(KclError::new_semantic(KclErrorDetails::new(
            "controlPointSpline() can only be used inside a sketch block".to_owned(),
            vec![args.source_range],
        )));
    };
    sketch_state.needed_by_engine.push(segment.clone());

    sketch_state.solver_optional_constraints.extend(optional_constraints);

    let meta = segment.meta.clone();
    let abstract_segment = AbstractSegment {
        repr: SegmentRepr::Unsolved {
            segment: Box::new(segment),
        },
        meta,
    };
    Ok(KclValue::Segment {
        value: Box::new(abstract_segment),
    })
}

pub async fn coincident(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let points: Vec<KclValue> = args.get_unlabeled_kw_arg(
        "points",
        &RuntimeType::Array(
            Box::new(RuntimeType::Union(vec![RuntimeType::segment(), RuntimeType::point2d()])),
            ArrayLen::Minimum(2),
        ),
        exec_state,
    )?;
    if points.len() > 2 {
        return coincident_points(points, exec_state, args);
    }
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
                                        ezpz::datatypes::inputs::DatumPoint::new_xy(
                                            p0_x.to_constraint_id(range)?,
                                            p0_y.to_constraint_id(range)?,
                                        ),
                                        ezpz::datatypes::inputs::DatumPoint::new_xy(
                                            p1_x.to_constraint_id(range)?,
                                            p1_y.to_constraint_id(range)?,
                                        ),
                                    );
                                    let constraint_id = exec_state.next_object_id();
                                    // Save the constraint to be used for solving.
                                    let Some(sketch_state) = exec_state.sketch_block_mut() else {
                                        return Err(KclError::new_semantic(KclErrorDetails::new(
                                            "coincident() can only be used inside a sketch block".to_owned(),
                                            vec![args.source_range],
                                        )));
                                    };
                                    sketch_state.solver_constraints.push(constraint);
                                    let constraint = crate::front::Constraint::Coincident(Coincident {
                                        segments: vec![unsolved0.object_id.into(), unsolved1.object_id.into()],
                                    });
                                    sketch_state.sketch_constraints.push(constraint_id);
                                    track_constraint(constraint_id, constraint, exec_state, &args);
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
                                    let constraint = crate::front::Constraint::Coincident(Coincident {
                                        segments: vec![unsolved0.object_id.into(), unsolved1.object_id.into()],
                                    });
                                    sketch_state.sketch_constraints.push(constraint_id);
                                    track_constraint(constraint_id, constraint, exec_state, &args);
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
                                    let constraint = crate::front::Constraint::Coincident(Coincident {
                                        segments: vec![unsolved0.object_id.into(), unsolved1.object_id.into()],
                                    });
                                    sketch_state.sketch_constraints.push(constraint_id);
                                    track_constraint(constraint_id, constraint, exec_state, &args);
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

                                    let constraint_id = exec_state.next_object_id();

                                    let Some(sketch_state) = exec_state.sketch_block_mut() else {
                                        return Err(KclError::new_semantic(KclErrorDetails::new(
                                            "coincident() can only be used inside a sketch block".to_owned(),
                                            vec![args.source_range],
                                        )));
                                    };
                                    sketch_state.solver_constraints.push(constraint);
                                    let constraint = crate::front::Constraint::Coincident(Coincident {
                                        segments: vec![unsolved0.object_id.into(), unsolved1.object_id.into()],
                                    });
                                    sketch_state.sketch_constraints.push(constraint_id);
                                    track_constraint(constraint_id, constraint, exec_state, &args);
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

                                    let constraint_id = exec_state.next_object_id();

                                    let Some(sketch_state) = exec_state.sketch_block_mut() else {
                                        return Err(KclError::new_semantic(KclErrorDetails::new(
                                            "coincident() can only be used inside a sketch block".to_owned(),
                                            vec![args.source_range],
                                        )));
                                    };
                                    sketch_state.solver_constraints.push(constraint);
                                    let constraint = crate::front::Constraint::Coincident(Coincident {
                                        segments: vec![unsolved0.object_id.into(), unsolved1.object_id.into()],
                                    });
                                    sketch_state.sketch_constraints.push(constraint_id);
                                    track_constraint(constraint_id, constraint, exec_state, &args);
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
                // Point-Circle or Circle-Point case: constrain point-to-center distance
                // to equal the circle radius.
                (
                    UnsolvedSegmentKind::Point {
                        position: point_pos, ..
                    },
                    UnsolvedSegmentKind::Circle {
                        start: circle_start,
                        center: circle_center,
                        ..
                    },
                )
                | (
                    UnsolvedSegmentKind::Circle {
                        start: circle_start,
                        center: circle_center,
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
                            // Extract circle center and start coordinates.
                            let (center_x, center_y) = (&circle_center[0], &circle_center[1]);
                            let (start_x, start_y) = (&circle_start[0], &circle_start[1]);

                            match (center_x, center_y, start_x, start_y) {
                                (
                                    UnsolvedExpr::Unknown(cx),
                                    UnsolvedExpr::Unknown(cy),
                                    UnsolvedExpr::Unknown(sx),
                                    UnsolvedExpr::Unknown(sy),
                                ) => {
                                    let point_radius_line = DatumLineSegment::new(
                                        DatumPoint::new_xy(
                                            cx.to_constraint_id(range)?,
                                            cy.to_constraint_id(range)?,
                                        ),
                                        DatumPoint::new_xy(
                                            point_x.to_constraint_id(range)?,
                                            point_y.to_constraint_id(range)?,
                                        ),
                                    );
                                    let circle_radius_line = DatumLineSegment::new(
                                        DatumPoint::new_xy(
                                            cx.to_constraint_id(range)?,
                                            cy.to_constraint_id(range)?,
                                        ),
                                        DatumPoint::new_xy(
                                            sx.to_constraint_id(range)?,
                                            sy.to_constraint_id(range)?,
                                        ),
                                    );
                                    let constraint =
                                        SolverConstraint::LinesEqualLength(point_radius_line, circle_radius_line);

                                    let constraint_id = exec_state.next_object_id();

                                    let Some(sketch_state) = exec_state.sketch_block_mut() else {
                                        return Err(KclError::new_semantic(KclErrorDetails::new(
                                            "coincident() can only be used inside a sketch block".to_owned(),
                                            vec![args.source_range],
                                        )));
                                    };
                                    sketch_state.solver_constraints.push(constraint);
                                    let constraint = crate::front::Constraint::Coincident(Coincident {
                                        segments: vec![unsolved0.object_id.into(), unsolved1.object_id.into()],
                                    });
                                    sketch_state.sketch_constraints.push(constraint_id);
                                    track_constraint(constraint_id, constraint, exec_state, &args);
                                    Ok(KclValue::none())
                                }
                                _ => Err(KclError::new_semantic(KclErrorDetails::new(
                                    "Circle start and center points must be sketch variables for point-circle coincident constraint".to_owned(),
                                    vec![args.source_range],
                                ))),
                            }
                        }
                        _ => Err(KclError::new_semantic(KclErrorDetails::new(
                            "Point coordinates must be sketch variables for point-circle coincident constraint"
                                .to_owned(),
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
                            let constraint = crate::front::Constraint::Coincident(Coincident {
                                segments: vec![unsolved0.object_id.into(), unsolved1.object_id.into()],
                            });
                            sketch_state.sketch_constraints.push(constraint_id);
                            track_constraint(constraint_id, constraint, exec_state, &args);
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
                        unsolved0.kind, unsolved1.kind
                    ),
                    vec![args.source_range],
                ))),
            }
        }
        // One argument is a Segment and the other is a Point2d literal.
        // Segment + point-literal branch; for now the only supported Point2d literal here is ORIGIN.
        (KclValue::Segment { value: seg }, point2d) | (point2d, KclValue::Segment { value: seg }) => {
            let Some(pt) = <[TyF64; 2]>::from_kcl_val(point2d) else {
                return Err(KclError::new_semantic(KclErrorDetails::new(
                    "Expected a Segment or Point2d (e.g. [1mm, 2mm])".to_owned(),
                    vec![args.source_range],
                )));
            };
            let SegmentRepr::Unsolved { segment: unsolved } = &seg.repr else {
                return Err(KclError::new_semantic(KclErrorDetails::new(
                    "segment must be an unsolved segment".to_owned(),
                    vec![args.source_range],
                )));
            };
            match &unsolved.kind {
                UnsolvedSegmentKind::Point { position, .. } => {
                    let p_x = &position[0];
                    let p_y = &position[1];
                    match (p_x, p_y) {
                        (UnsolvedExpr::Unknown(p_x), UnsolvedExpr::Unknown(p_y)) => {
                            let pt_x = KclValue::Number {
                                value: pt[0].n,
                                ty: pt[0].ty,
                                meta: vec![args.source_range.into()],
                            };
                            let pt_y = KclValue::Number {
                                value: pt[1].n,
                                ty: pt[1].ty,
                                meta: vec![args.source_range.into()],
                            };
                            let (constraint_x, constraint_y) =
                                coincident_constraints_fixed(*p_x, *p_y, &pt_x, &pt_y, exec_state, &args)?;

                            let constraint_id = exec_state.next_object_id();
                            let coincident_segments = coincident_segments_for_segment_and_point2d(
                                unsolved.object_id,
                                point2d,
                                matches!((&point0, &point1), (KclValue::Segment { .. }, _)),
                            );
                            let Some(sketch_state) = exec_state.sketch_block_mut() else {
                                return Err(KclError::new_semantic(KclErrorDetails::new(
                                    "coincident() can only be used inside a sketch block".to_owned(),
                                    vec![args.source_range],
                                )));
                            };
                            sketch_state.solver_constraints.push(constraint_x);
                            sketch_state.solver_constraints.push(constraint_y);
                            let constraint = crate::front::Constraint::Coincident(Coincident {
                                segments: coincident_segments,
                            });
                            sketch_state.sketch_constraints.push(constraint_id);
                            track_constraint(constraint_id, constraint, exec_state, &args);
                            Ok(KclValue::none())
                        }
                        (UnsolvedExpr::Known(known_x), UnsolvedExpr::Known(known_y)) => {
                            let pt_x_val = normalize_to_solver_distance_unit(
                                &KclValue::Number {
                                    value: pt[0].n,
                                    ty: pt[0].ty,
                                    meta: vec![args.source_range.into()],
                                },
                                args.source_range,
                                exec_state,
                                "coincident constraint value",
                            )?;
                            let pt_y_val = normalize_to_solver_distance_unit(
                                &KclValue::Number {
                                    value: pt[1].n,
                                    ty: pt[1].ty,
                                    meta: vec![args.source_range.into()],
                                },
                                args.source_range,
                                exec_state,
                                "coincident constraint value",
                            )?;
                            let Some(pt_x) = pt_x_val.as_ty_f64() else {
                                return Err(KclError::new_semantic(KclErrorDetails::new(
                                    "Expected number for Point2d x coordinate".to_owned(),
                                    vec![args.source_range],
                                )));
                            };
                            let Some(pt_y) = pt_y_val.as_ty_f64() else {
                                return Err(KclError::new_semantic(KclErrorDetails::new(
                                    "Expected number for Point2d y coordinate".to_owned(),
                                    vec![args.source_range],
                                )));
                            };
                            let known_x_val = normalize_to_solver_distance_unit(
                                &KclValue::Number {
                                    value: known_x.n,
                                    ty: known_x.ty,
                                    meta: vec![args.source_range.into()],
                                },
                                args.source_range,
                                exec_state,
                                "coincident constraint value",
                            )?;
                            let Some(known_x_f) = known_x_val.as_ty_f64() else {
                                return Err(KclError::new_semantic(KclErrorDetails::new(
                                    "Expected number for known x coordinate".to_owned(),
                                    vec![args.source_range],
                                )));
                            };
                            let known_y_val = normalize_to_solver_distance_unit(
                                &KclValue::Number {
                                    value: known_y.n,
                                    ty: known_y.ty,
                                    meta: vec![args.source_range.into()],
                                },
                                args.source_range,
                                exec_state,
                                "coincident constraint value",
                            )?;
                            let Some(known_y_f) = known_y_val.as_ty_f64() else {
                                return Err(KclError::new_semantic(KclErrorDetails::new(
                                    "Expected number for known y coordinate".to_owned(),
                                    vec![args.source_range],
                                )));
                            };
                            if known_x_f.n != pt_x.n || known_y_f.n != pt_y.n {
                                return Err(KclError::new_semantic(KclErrorDetails::new(
                                    "Coincident constraint between two fixed points failed since coordinates differ"
                                        .to_owned(),
                                    vec![args.source_range],
                                )));
                            }
                            Ok(KclValue::none())
                        }
                        _ => Err(KclError::new_semantic(KclErrorDetails::new(
                            "Point coordinates must have consistent known/unknown status for coincident constraint"
                                .to_owned(),
                            vec![args.source_range],
                        ))),
                    }
                }
                _ => Err(KclError::new_semantic(KclErrorDetails::new(
                    "A Point2d can only be constrained coincident with a point segment, not a line or arc".to_owned(),
                    vec![args.source_range],
                ))),
            }
        }
        // Both arguments are Point2d literals -- just verify equality.
        _ => {
            let pt0 = <[TyF64; 2]>::from_kcl_val(&point0);
            let pt1 = <[TyF64; 2]>::from_kcl_val(&point1);
            match (pt0, pt1) {
                (Some(a), Some(b)) => {
                    // Normalize both to solver units and compare.
                    let a_x = normalize_to_solver_distance_unit(
                        &KclValue::Number {
                            value: a[0].n,
                            ty: a[0].ty,
                            meta: vec![args.source_range.into()],
                        },
                        args.source_range,
                        exec_state,
                        "coincident constraint value",
                    )?;
                    let a_y = normalize_to_solver_distance_unit(
                        &KclValue::Number {
                            value: a[1].n,
                            ty: a[1].ty,
                            meta: vec![args.source_range.into()],
                        },
                        args.source_range,
                        exec_state,
                        "coincident constraint value",
                    )?;
                    let b_x = normalize_to_solver_distance_unit(
                        &KclValue::Number {
                            value: b[0].n,
                            ty: b[0].ty,
                            meta: vec![args.source_range.into()],
                        },
                        args.source_range,
                        exec_state,
                        "coincident constraint value",
                    )?;
                    let b_y = normalize_to_solver_distance_unit(
                        &KclValue::Number {
                            value: b[1].n,
                            ty: b[1].ty,
                            meta: vec![args.source_range.into()],
                        },
                        args.source_range,
                        exec_state,
                        "coincident constraint value",
                    )?;
                    if a_x.as_ty_f64().map(|v| v.n) != b_x.as_ty_f64().map(|v| v.n)
                        || a_y.as_ty_f64().map(|v| v.n) != b_y.as_ty_f64().map(|v| v.n)
                    {
                        return Err(KclError::new_semantic(KclErrorDetails::new(
                            "Coincident constraint between two fixed points failed since coordinates differ".to_owned(),
                            vec![args.source_range],
                        )));
                    }
                    Ok(KclValue::none())
                }
                _ => Err(KclError::new_semantic(KclErrorDetails::new(
                    "All inputs must be Segments or Point2d values".to_owned(),
                    vec![args.source_range],
                ))),
            }
        }
    }
}

fn coincident_points(
    point_values: Vec<KclValue>,
    exec_state: &mut ExecState,
    args: Args,
) -> Result<KclValue, KclError> {
    if point_values.len() < 2 {
        return Err(KclError::new_semantic(KclErrorDetails::new(
            "coincident() point list must contain at least two points".to_owned(),
            vec![args.source_range],
        )));
    }

    // For every point return either a fixed point or a variable point
    let points = point_values
        .iter()
        .map(|point| extract_multi_coincident_point(point, args.source_range))
        .collect::<Result<Vec<_>, _>>()?;

    let constraint_segments = points.iter().map(|point| point.constraint_segment).collect::<Vec<_>>();

    let mut variable_points = Vec::new();
    let mut fixed_points = Vec::new();
    for point in points {
        match point.point {
            PointToAlign::Variable { x, y } => variable_points.push([x, y]),
            PointToAlign::Fixed { x, y } => fixed_points.push([x, y]),
        }
    }

    let mut solver_constraints = Vec::with_capacity(point_values.len().saturating_sub(1) * 2);
    if let Some((anchor_fixed, remaining_fixed_points)) = fixed_points.split_first() {
        // A fixed point becomes the shared target location for every variable point.
        if remaining_fixed_points
            .iter()
            .any(|point| !fixed_points_match(point, anchor_fixed))
        {
            return Err(KclError::new_semantic(KclErrorDetails::new(
                "coincident() with more than two inputs can include at most one fixed point location".to_owned(),
                vec![args.source_range],
            )));
        }

        let anchor_x = ty_f64_to_kcl_value(anchor_fixed[0].clone(), args.source_range);
        let anchor_y = ty_f64_to_kcl_value(anchor_fixed[1].clone(), args.source_range);
        for point in variable_points {
            let (constraint_x, constraint_y) =
                coincident_constraints_fixed(point[0], point[1], &anchor_x, &anchor_y, exec_state, &args)?;
            solver_constraints.push(constraint_x);
            solver_constraints.push(constraint_y);
        }
    } else {
        // With only variable points, anchor everything to the first point.
        let mut points = variable_points.into_iter();
        let first_point = points.next().ok_or_else(|| {
            KclError::new_semantic(KclErrorDetails::new(
                "coincident() point list must contain at least two points".to_owned(),
                vec![args.source_range],
            ))
        })?;
        let anchor = datum_point(first_point, args.source_range)?;
        for point in points {
            let solver_point = datum_point(point, args.source_range)?;
            solver_constraints.push(SolverConstraint::PointsCoincident(anchor, solver_point));
        }
    }

    let Some(sketch_state) = exec_state.sketch_block_mut() else {
        return Err(KclError::new_semantic(KclErrorDetails::new(
            "coincident() can only be used inside a sketch block".to_owned(),
            vec![args.source_range],
        )));
    };
    sketch_state.solver_constraints.extend(solver_constraints);

    // Keep one artifact-graph coincident constraint even though the solver sees multiple relations.
    let constraint_id = exec_state.next_object_id();
    let Some(sketch_state) = exec_state.sketch_block_mut() else {
        debug_assert!(false, "Constraint created outside a sketch block");
        return Ok(KclValue::none());
    };
    sketch_state.sketch_constraints.push(constraint_id);
    let constraint = Constraint::Coincident(Coincident {
        segments: constraint_segments,
    });
    track_constraint(constraint_id, constraint, exec_state, &args);

    Ok(KclValue::none())
}

fn extract_multi_coincident_point(
    input: &KclValue,
    source_range: crate::SourceRange,
) -> Result<CoincidentPointInput, KclError> {
    // Normalize each multi-input item into either a fixed point or solver-backed point vars.
    match input {
        KclValue::Segment { value: segment } => {
            let SegmentRepr::Unsolved { segment: unsolved } = &segment.repr else {
                return Err(KclError::new_semantic(KclErrorDetails::new(
                    "coincident() with more than two inputs only supports unsolved points or ORIGIN".to_owned(),
                    vec![source_range],
                )));
            };
            let UnsolvedSegmentKind::Point { position, .. } = &unsolved.kind else {
                return Err(KclError::new_semantic(KclErrorDetails::new(
                    format!(
                        "coincident() with more than two inputs only supports points or ORIGIN, but one item is {}",
                        unsolved.kind.human_friendly_kind_with_article()
                    ),
                    vec![source_range],
                )));
            };
            match (&position[0], &position[1]) {
                (UnsolvedExpr::Known(x), UnsolvedExpr::Known(y)) => Ok(CoincidentPointInput {
                    point: PointToAlign::Fixed {
                        x: x.to_owned(),
                        y: y.to_owned(),
                    },
                    constraint_segment: unsolved.object_id.into(),
                }),
                (UnsolvedExpr::Unknown(x), UnsolvedExpr::Unknown(y)) => Ok(CoincidentPointInput {
                    point: PointToAlign::Variable { x: *x, y: *y },
                    constraint_segment: unsolved.object_id.into(),
                }),
                // Mixed points not supported
                (UnsolvedExpr::Known(..), UnsolvedExpr::Unknown(..))
                | (UnsolvedExpr::Unknown(..), UnsolvedExpr::Known(..)) => Err(KclError::new_semantic(
                    KclErrorDetails::new(
                        "coincident() with more than two inputs requires each point to be fully fixed or fully variable"
                            .to_owned(),
                        vec![source_range],
                    ),
                )),
            }
        }
        point if point2d_is_origin(point) => {
            let Some([x, y]) = <[TyF64; 2]>::from_kcl_val(point) else {
                debug_assert!(false, "Origin literal should coerce to Point2d");
                return Err(KclError::new_internal(KclErrorDetails::new(
                    "Origin literal could not be converted to a point".to_owned(),
                    vec![source_range],
                )));
            };
            Ok(CoincidentPointInput {
                point: PointToAlign::Fixed { x, y },
                constraint_segment: ConstraintSegment::ORIGIN,
            })
        }
        _ => Err(KclError::new_semantic(KclErrorDetails::new(
            "coincident() with more than two inputs only supports points and ORIGIN".to_owned(),
            vec![source_range],
        ))),
    }
}

#[derive(Debug, Clone)]
struct CoincidentPointInput {
    point: PointToAlign,
    constraint_segment: ConstraintSegment,
}

fn fixed_points_match(a: &[TyF64; 2], b: &[TyF64; 2]) -> bool {
    a[0].to_mm() == b[0].to_mm() && a[1].to_mm() == b[1].to_mm()
}

fn ty_f64_to_kcl_value(value: TyF64, source_range: crate::SourceRange) -> KclValue {
    KclValue::Number {
        value: value.n,
        ty: value.ty,
        meta: vec![source_range.into()],
    }
}

fn track_constraint(constraint_id: ObjectId, constraint: Constraint, exec_state: &mut ExecState, args: &Args) {
    let sketch_id = {
        let Some(sketch_state) = exec_state.sketch_block_mut() else {
            debug_assert!(false, "Constraint created outside a sketch block");
            return;
        };
        sketch_state.sketch_id
    };
    let Some(sketch_id) = sketch_id else {
        debug_assert!(false, "Constraint created without a sketch id");
        return;
    };
    let artifact_id = exec_state.next_artifact_id();
    exec_state.add_artifact(Artifact::SketchBlockConstraint(SketchBlockConstraint {
        id: artifact_id,
        sketch_id,
        constraint_id,
        constraint_type: SketchBlockConstraintType::from(&constraint),
        code_ref: CodeRef::placeholder(args.source_range),
    }));
    exec_state.add_scene_object(
        Object {
            id: constraint_id,
            kind: ObjectKind::Constraint { constraint },
            label: Default::default(),
            comments: Default::default(),
            artifact_id,
            source: SourceRef::new(args.source_range, args.node_path.clone()),
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
) -> Result<(ezpz::Constraint, ezpz::Constraint), KclError> {
    let p1_x_number_value =
        normalize_to_solver_distance_unit(p1_x, p1_x.into(), exec_state, "coincident constraint value")?;
    let p1_y_number_value =
        normalize_to_solver_distance_unit(p1_y, p1_y.into(), exec_state, "coincident constraint value")?;
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
    let label_position = get_constraint_label_position(exec_state, &args, "distance")?;
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
                                        ConstrainablePoint2dOrOrigin::Point(ConstrainablePoint2d {
                                            vars: crate::front::Point2d { x: *p0_x, y: *p0_y },
                                            object_id: unsolved0.object_id,
                                        }),
                                        ConstrainablePoint2dOrOrigin::Point(ConstrainablePoint2d {
                                            vars: crate::front::Point2d { x: *p1_x, y: *p1_y },
                                            object_id: unsolved1.object_id,
                                        }),
                                    ],
                                    label_position,
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
                (UnsolvedSegmentKind::Point { .. }, UnsolvedSegmentKind::Line { .. })
                | (UnsolvedSegmentKind::Line { .. }, UnsolvedSegmentKind::Point { .. }) => {
                    let (point_segment, line_segment) = match (&unsolved0.kind, &unsolved1.kind) {
                        (UnsolvedSegmentKind::Point { .. }, UnsolvedSegmentKind::Line { .. }) => (unsolved0, unsolved1),
                        (UnsolvedSegmentKind::Line { .. }, UnsolvedSegmentKind::Point { .. }) => (unsolved1, unsolved0),
                        _ => {
                            return Err(KclError::new_semantic(KclErrorDetails::new(
                                "distance() expected a point-line segment pair".to_owned(),
                                vec![args.source_range],
                            )));
                        }
                    };
                    let point =
                        constrainable_point_from_unsolved_segment(point_segment, "distance", args.source_range)?;
                    let line = constrainable_line_from_unsolved_segment(line_segment, "distance", args.source_range)?;

                    Ok(KclValue::SketchConstraint {
                        value: Box::new(SketchConstraint {
                            kind: SketchConstraintKind::PointLineDistance {
                                point: ConstrainablePoint2dOrOrigin::Point(point),
                                line,
                                input_object_ids: [Some(unsolved0.object_id), Some(unsolved1.object_id)],
                                label_position,
                            },
                            meta: vec![args.source_range.into()],
                        }),
                    })
                }
                (UnsolvedSegmentKind::Point { .. }, UnsolvedSegmentKind::Arc { .. })
                | (UnsolvedSegmentKind::Point { .. }, UnsolvedSegmentKind::Circle { .. })
                | (UnsolvedSegmentKind::Arc { .. }, UnsolvedSegmentKind::Point { .. })
                | (UnsolvedSegmentKind::Circle { .. }, UnsolvedSegmentKind::Point { .. }) => {
                    let (point_segment, circular_segment) = match (&unsolved0.kind, &unsolved1.kind) {
                        (UnsolvedSegmentKind::Point { .. }, UnsolvedSegmentKind::Arc { .. })
                        | (UnsolvedSegmentKind::Point { .. }, UnsolvedSegmentKind::Circle { .. }) => {
                            (unsolved0, unsolved1)
                        }
                        (UnsolvedSegmentKind::Arc { .. }, UnsolvedSegmentKind::Point { .. })
                        | (UnsolvedSegmentKind::Circle { .. }, UnsolvedSegmentKind::Point { .. }) => {
                            (unsolved1, unsolved0)
                        }
                        _ => {
                            return Err(KclError::new_semantic(KclErrorDetails::new(
                                "distance() expected a point-arc or point-circle segment pair".to_owned(),
                                vec![args.source_range],
                            )));
                        }
                    };
                    let point =
                        constrainable_point_from_unsolved_segment(point_segment, "distance", args.source_range)?;
                    let (center, start, end) =
                        constrainable_circular_from_unsolved_segment(circular_segment, "distance", args.source_range)?;

                    Ok(KclValue::SketchConstraint {
                        value: Box::new(SketchConstraint {
                            kind: SketchConstraintKind::PointCircularDistance {
                                point: ConstrainablePoint2dOrOrigin::Point(point),
                                center,
                                start,
                                end,
                                input_object_ids: [Some(unsolved0.object_id), Some(unsolved1.object_id)],
                                label_position,
                            },
                            meta: vec![args.source_range.into()],
                        }),
                    })
                }
                (UnsolvedSegmentKind::Line { .. }, UnsolvedSegmentKind::Arc { .. })
                | (UnsolvedSegmentKind::Line { .. }, UnsolvedSegmentKind::Circle { .. })
                | (UnsolvedSegmentKind::Arc { .. }, UnsolvedSegmentKind::Line { .. })
                | (UnsolvedSegmentKind::Circle { .. }, UnsolvedSegmentKind::Line { .. }) => {
                    let (line_segment, circular_segment) = match (&unsolved0.kind, &unsolved1.kind) {
                        (UnsolvedSegmentKind::Line { .. }, UnsolvedSegmentKind::Arc { .. })
                        | (UnsolvedSegmentKind::Line { .. }, UnsolvedSegmentKind::Circle { .. }) => {
                            (unsolved0, unsolved1)
                        }
                        (UnsolvedSegmentKind::Arc { .. }, UnsolvedSegmentKind::Line { .. })
                        | (UnsolvedSegmentKind::Circle { .. }, UnsolvedSegmentKind::Line { .. }) => {
                            (unsolved1, unsolved0)
                        }
                        _ => {
                            return Err(KclError::new_semantic(KclErrorDetails::new(
                                "distance() expected a line-arc or line-circle segment pair".to_owned(),
                                vec![args.source_range],
                            )));
                        }
                    };
                    let line = constrainable_line_from_unsolved_segment(line_segment, "distance", args.source_range)?;
                    let (center, start, end) =
                        constrainable_circular_from_unsolved_segment(circular_segment, "distance", args.source_range)?;

                    Ok(KclValue::SketchConstraint {
                        value: Box::new(SketchConstraint {
                            kind: SketchConstraintKind::LineCircularDistance {
                                line,
                                center,
                                start,
                                end,
                                input_object_ids: [unsolved0.object_id, unsolved1.object_id],
                                label_position,
                            },
                            meta: vec![args.source_range.into()],
                        }),
                    })
                }
                (UnsolvedSegmentKind::Arc { .. }, UnsolvedSegmentKind::Arc { .. })
                | (UnsolvedSegmentKind::Arc { .. }, UnsolvedSegmentKind::Circle { .. })
                | (UnsolvedSegmentKind::Circle { .. }, UnsolvedSegmentKind::Arc { .. })
                | (UnsolvedSegmentKind::Circle { .. }, UnsolvedSegmentKind::Circle { .. }) => {
                    let (center0, start0, end0) =
                        constrainable_circular_from_unsolved_segment(unsolved0, "distance", args.source_range)?;
                    let (center1, start1, end1) =
                        constrainable_circular_from_unsolved_segment(unsolved1, "distance", args.source_range)?;

                    Ok(KclValue::SketchConstraint {
                        value: Box::new(SketchConstraint {
                            kind: SketchConstraintKind::CircularCircularDistance {
                                center0,
                                start0,
                                end0,
                                center1,
                                start1,
                                end1,
                                input_object_ids: [unsolved0.object_id, unsolved1.object_id],
                                label_position,
                            },
                            meta: vec![args.source_range.into()],
                        }),
                    })
                }
                (UnsolvedSegmentKind::Line { .. }, UnsolvedSegmentKind::Line { .. }) => {
                    let line0 = constrainable_line_from_unsolved_segment(unsolved0, "distance", args.source_range)?;
                    let line1 = constrainable_line_from_unsolved_segment(unsolved1, "distance", args.source_range)?;

                    Ok(KclValue::SketchConstraint {
                        value: Box::new(SketchConstraint {
                            kind: SketchConstraintKind::LineLineDistance {
                                line0,
                                line1,
                                input_object_ids: [unsolved0.object_id, unsolved1.object_id],
                                label_position,
                            },
                            meta: vec![args.source_range.into()],
                        }),
                    })
                }
                (UnsolvedSegmentKind::ControlPointSpline { .. }, _)
                | (_, UnsolvedSegmentKind::ControlPointSpline { .. }) => {
                    Err(KclError::new_semantic(KclErrorDetails::new(
                        "distance() does not yet support control point spline segments".to_owned(),
                        vec![args.source_range],
                    )))
                }
            }
        }
        // Segment + point-literal branch; for now the only supported Point2d literal here is ORIGIN.
        (KclValue::Segment { value: seg }, point2d) | (point2d, KclValue::Segment { value: seg }) => {
            if !point2d_is_origin(point2d) {
                return Err(KclError::new_semantic(KclErrorDetails::new(
                    "distance() Point2d arguments must be ORIGIN".to_owned(),
                    vec![args.source_range],
                )));
            }

            let SegmentRepr::Unsolved { segment: unsolved } = &seg.repr else {
                return Err(KclError::new_semantic(KclErrorDetails::new(
                    "segment must be an unsolved segment".to_owned(),
                    vec![args.source_range],
                )));
            };
            let segment_first = matches!((&point0, &point1), (KclValue::Segment { .. }, _));
            let input_object_ids = if segment_first {
                [Some(unsolved.object_id), None]
            } else {
                [None, Some(unsolved.object_id)]
            };
            match &unsolved.kind {
                UnsolvedSegmentKind::Point { position, .. } => match (&position[0], &position[1]) {
                    (UnsolvedExpr::Unknown(point_x), UnsolvedExpr::Unknown(point_y)) => {
                        let point = ConstrainablePoint2dOrOrigin::Point(ConstrainablePoint2d {
                            vars: crate::front::Point2d {
                                x: *point_x,
                                y: *point_y,
                            },
                            object_id: unsolved.object_id,
                        });
                        let points = if segment_first {
                            [point, ConstrainablePoint2dOrOrigin::Origin]
                        } else {
                            [ConstrainablePoint2dOrOrigin::Origin, point]
                        };
                        Ok(KclValue::SketchConstraint {
                            value: Box::new(SketchConstraint {
                                kind: SketchConstraintKind::Distance { points, label_position },
                                meta: vec![args.source_range.into()],
                            }),
                        })
                    }
                    _ => Err(KclError::new_semantic(KclErrorDetails::new(
                        "unimplemented: distance() point arguments must be sketch vars in all coordinates".to_owned(),
                        vec![args.source_range],
                    ))),
                },
                UnsolvedSegmentKind::Line { .. } => {
                    let line = constrainable_line_from_unsolved_segment(unsolved, "distance", args.source_range)?;
                    Ok(KclValue::SketchConstraint {
                        value: Box::new(SketchConstraint {
                            kind: SketchConstraintKind::PointLineDistance {
                                point: ConstrainablePoint2dOrOrigin::Origin,
                                line,
                                input_object_ids,
                                label_position,
                            },
                            meta: vec![args.source_range.into()],
                        }),
                    })
                }
                UnsolvedSegmentKind::Arc { .. } | UnsolvedSegmentKind::Circle { .. } => {
                    let (center, start, end) =
                        constrainable_circular_from_unsolved_segment(unsolved, "distance", args.source_range)?;
                    Ok(KclValue::SketchConstraint {
                        value: Box::new(SketchConstraint {
                            kind: SketchConstraintKind::PointCircularDistance {
                                point: ConstrainablePoint2dOrOrigin::Origin,
                                center,
                                start,
                                end,
                                input_object_ids,
                                label_position,
                            },
                            meta: vec![args.source_range.into()],
                        }),
                    })
                }
                UnsolvedSegmentKind::ControlPointSpline { .. } => Err(KclError::new_semantic(KclErrorDetails::new(
                    "distance() does not yet support control point spline segments".to_owned(),
                    vec![args.source_range],
                ))),
            }
        }
        _ => Err(KclError::new_semantic(KclErrorDetails::new(
            "distance() arguments must be point segments or ORIGIN".to_owned(),
            vec![args.source_range],
        ))),
    }
}

fn get_constraint_label_position(
    exec_state: &mut ExecState,
    args: &Args,
    constraint_name: &str,
) -> Result<Option<Point2d<Number>>, KclError> {
    let label_position = args.get_kw_arg_opt::<[TyF64; 2]>("labelPosition", &RuntimeType::point2d(), exec_state)?;

    label_position
        .map(|label| {
            TyF64::to_point2d(&label).map_err(|_| {
                KclError::new_internal(KclErrorDetails::new(
                    format!("Could not convert {constraint_name} label position to a Point2d"),
                    vec![args.source_range],
                ))
            })
        })
        .transpose()
}

/// Helper function to create a radius or diameter constraint from a circular segment.
/// Used by both radius() and diameter() functions.
fn create_circular_radius_constraint(
    segment: KclValue,
    constraint_kind: impl Fn([ConstrainablePoint2d; 2]) -> SketchConstraintKind,
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
        }
        | UnsolvedSegmentKind::Circle {
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
                        "unimplemented: {}() arc or circle segment must have all sketch vars in all coordinates",
                        function_name
                    ),
                    vec![source_range],
                ))),
            }
        }
        _ => Err(KclError::new_semantic(KclErrorDetails::new(
            format!("{}() argument must be an arc or circle segment", function_name),
            vec![source_range],
        ))),
    }
}

pub async fn radius(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let segment: KclValue =
        args.get_unlabeled_kw_arg("points", &RuntimeType::Primitive(PrimitiveType::Any), exec_state)?;
    let label_position = get_constraint_label_position(exec_state, &args, "radius")?;

    create_circular_radius_constraint(
        segment,
        |points| SketchConstraintKind::Radius {
            points,
            label_position: label_position.clone(),
        },
        args.source_range,
    )
    .map(|constraint| KclValue::SketchConstraint {
        value: Box::new(constraint),
    })
}

pub async fn diameter(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let segment: KclValue =
        args.get_unlabeled_kw_arg("points", &RuntimeType::Primitive(PrimitiveType::Any), exec_state)?;
    let label_position = get_constraint_label_position(exec_state, &args, "diameter")?;

    create_circular_radius_constraint(
        segment,
        |points| SketchConstraintKind::Diameter {
            points,
            label_position: label_position.clone(),
        },
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
    let label_position = get_constraint_label_position(exec_state, &args, "horizontalDistance")?;
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
                                        ConstrainablePoint2dOrOrigin::Point(ConstrainablePoint2d {
                                            vars: crate::front::Point2d { x: *p0_x, y: *p0_y },
                                            object_id: unsolved0.object_id,
                                        }),
                                        ConstrainablePoint2dOrOrigin::Point(ConstrainablePoint2d {
                                            vars: crate::front::Point2d { x: *p1_x, y: *p1_y },
                                            object_id: unsolved1.object_id,
                                        }),
                                    ],
                                    label_position,
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
                (
                    UnsolvedSegmentKind::Point { .. },
                    UnsolvedSegmentKind::Line { .. },
                )
                | (
                    UnsolvedSegmentKind::Line { .. },
                    UnsolvedSegmentKind::Point { .. },
                ) => Err(KclError::new_semantic(KclErrorDetails::new(
                    "horizontalDistance() between a point and a line is invalid because the constraint is under-specified".to_owned(),
                    vec![args.source_range],
                ))),
                _ => Err(KclError::new_semantic(KclErrorDetails::new(
                    "horizontalDistance() arguments must be unsolved points".to_owned(),
                    vec![args.source_range],
                ))),
            }
        }
        // Segment + point-literal branch; for now the only supported Point2d literal here is ORIGIN.
        (KclValue::Segment { value: seg }, point2d) | (point2d, KclValue::Segment { value: seg }) => {
            if !point2d_is_origin(point2d) {
                return Err(KclError::new_semantic(KclErrorDetails::new(
                    "horizontalDistance() Point2d arguments must be ORIGIN".to_owned(),
                    vec![args.source_range],
                )));
            }

            let SegmentRepr::Unsolved { segment: unsolved } = &seg.repr else {
                return Err(KclError::new_semantic(KclErrorDetails::new(
                    "segment must be an unsolved segment".to_owned(),
                    vec![args.source_range],
                )));
            };
            let UnsolvedSegmentKind::Point { position, .. } = &unsolved.kind else {
                return Err(KclError::new_semantic(KclErrorDetails::new(
                    "horizontalDistance() arguments must be unsolved points or ORIGIN".to_owned(),
                    vec![args.source_range],
                )));
            };
            match (&position[0], &position[1]) {
                (UnsolvedExpr::Unknown(point_x), UnsolvedExpr::Unknown(point_y)) => {
                    let point = ConstrainablePoint2dOrOrigin::Point(ConstrainablePoint2d {
                        vars: crate::front::Point2d {
                            x: *point_x,
                            y: *point_y,
                        },
                        object_id: unsolved.object_id,
                    });
                    let points = if matches!((p1, p2), (KclValue::Segment { .. }, _)) {
                        [point, ConstrainablePoint2dOrOrigin::Origin]
                    } else {
                        [ConstrainablePoint2dOrOrigin::Origin, point]
                    };
                    Ok(KclValue::SketchConstraint {
                        value: Box::new(SketchConstraint {
                            kind: SketchConstraintKind::HorizontalDistance { points, label_position },
                            meta: vec![args.source_range.into()],
                        }),
                    })
                }
                _ => Err(KclError::new_semantic(KclErrorDetails::new(
                    "unimplemented: horizontalDistance() point arguments must be sketch vars in all coordinates"
                        .to_owned(),
                    vec![args.source_range],
                ))),
            }
        }
        _ => Err(KclError::new_semantic(KclErrorDetails::new(
            "horizontalDistance() arguments must be point segments or ORIGIN".to_owned(),
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
    let label_position = get_constraint_label_position(exec_state, &args, "verticalDistance")?;
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
                                        ConstrainablePoint2dOrOrigin::Point(ConstrainablePoint2d {
                                            vars: crate::front::Point2d { x: *p0_x, y: *p0_y },
                                            object_id: unsolved0.object_id,
                                        }),
                                        ConstrainablePoint2dOrOrigin::Point(ConstrainablePoint2d {
                                            vars: crate::front::Point2d { x: *p1_x, y: *p1_y },
                                            object_id: unsolved1.object_id,
                                        }),
                                    ],
                                    label_position,
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
                (
                    UnsolvedSegmentKind::Point { .. },
                    UnsolvedSegmentKind::Line { .. },
                )
                | (
                    UnsolvedSegmentKind::Line { .. },
                    UnsolvedSegmentKind::Point { .. },
                ) => Err(KclError::new_semantic(KclErrorDetails::new(
                    "verticalDistance() between a point and a line is invalid because the constraint is under-specified".to_owned(),
                    vec![args.source_range],
                ))),
                _ => Err(KclError::new_semantic(KclErrorDetails::new(
                    "verticalDistance() arguments must be unsolved points".to_owned(),
                    vec![args.source_range],
                ))),
            }
        }
        (KclValue::Segment { value: seg }, point2d) | (point2d, KclValue::Segment { value: seg }) => {
            if !point2d_is_origin(point2d) {
                return Err(KclError::new_semantic(KclErrorDetails::new(
                    "verticalDistance() Point2d arguments must be ORIGIN".to_owned(),
                    vec![args.source_range],
                )));
            }

            let SegmentRepr::Unsolved { segment: unsolved } = &seg.repr else {
                return Err(KclError::new_semantic(KclErrorDetails::new(
                    "segment must be an unsolved segment".to_owned(),
                    vec![args.source_range],
                )));
            };
            let UnsolvedSegmentKind::Point { position, .. } = &unsolved.kind else {
                return Err(KclError::new_semantic(KclErrorDetails::new(
                    "verticalDistance() arguments must be unsolved points or ORIGIN".to_owned(),
                    vec![args.source_range],
                )));
            };
            match (&position[0], &position[1]) {
                (UnsolvedExpr::Unknown(point_x), UnsolvedExpr::Unknown(point_y)) => {
                    let point = ConstrainablePoint2dOrOrigin::Point(ConstrainablePoint2d {
                        vars: crate::front::Point2d {
                            x: *point_x,
                            y: *point_y,
                        },
                        object_id: unsolved.object_id,
                    });
                    let points = if matches!((p1, p2), (KclValue::Segment { .. }, _)) {
                        [point, ConstrainablePoint2dOrOrigin::Origin]
                    } else {
                        [ConstrainablePoint2dOrOrigin::Origin, point]
                    };
                    Ok(KclValue::SketchConstraint {
                        value: Box::new(SketchConstraint {
                            kind: SketchConstraintKind::VerticalDistance { points, label_position },
                            meta: vec![args.source_range.into()],
                        }),
                    })
                }
                _ => Err(KclError::new_semantic(KclErrorDetails::new(
                    "unimplemented: verticalDistance() point arguments must be sketch vars in all coordinates"
                        .to_owned(),
                    vec![args.source_range],
                ))),
            }
        }
        _ => Err(KclError::new_semantic(KclErrorDetails::new(
            "verticalDistance() arguments must be point segments or ORIGIN".to_owned(),
            vec![args.source_range],
        ))),
    }
}

#[derive(Debug, Clone, Copy)]
enum MidpointPointVars {
    Segment {
        coords: [SketchVarId; 2],
        constraint_segment: ConstraintSegment,
    },
    Origin,
}

impl MidpointPointVars {
    fn constraint_segment(self) -> ConstraintSegment {
        match self {
            Self::Segment { constraint_segment, .. } => constraint_segment,
            Self::Origin => ConstraintSegment::ORIGIN,
        }
    }
}

#[derive(Debug, Clone, Copy)]
enum MidpointTargetVars {
    Line {
        start: [SketchVarId; 2],
        end: [SketchVarId; 2],
        object_id: ObjectId,
    },
    Arc {
        center: [SketchVarId; 2],
        start: [SketchVarId; 2],
        end: [SketchVarId; 2],
        object_id: ObjectId,
    },
}

impl MidpointTargetVars {
    fn object_id(self) -> ObjectId {
        match self {
            Self::Line { object_id, .. } | Self::Arc { object_id, .. } => object_id,
        }
    }
}

fn extract_midpoint_point(segment_value: &KclValue, range: crate::SourceRange) -> Result<MidpointPointVars, KclError> {
    if point2d_is_origin(segment_value) {
        return Ok(MidpointPointVars::Origin);
    }

    let KclValue::Segment { value: segment } = segment_value else {
        return Err(KclError::new_semantic(KclErrorDetails::new(
            format!(
                "midpoint() point must be a point Segment or ORIGIN, but found {}",
                segment_value.human_friendly_type()
            ),
            vec![range],
        )));
    };
    let SegmentRepr::Unsolved { segment: unsolved } = &segment.repr else {
        return Err(KclError::new_semantic(KclErrorDetails::new(
            "midpoint() point must be an unsolved point Segment".to_owned(),
            vec![range],
        )));
    };
    let UnsolvedSegmentKind::Point { position, .. } = &unsolved.kind else {
        return Err(KclError::new_semantic(KclErrorDetails::new(
            "midpoint() point must be a point Segment".to_owned(),
            vec![range],
        )));
    };
    let (UnsolvedExpr::Unknown(point_x), UnsolvedExpr::Unknown(point_y)) = (&position[0], &position[1]) else {
        return Err(KclError::new_semantic(KclErrorDetails::new(
            "midpoint() point coordinates must be sketch vars".to_owned(),
            vec![range],
        )));
    };

    Ok(MidpointPointVars::Segment {
        coords: [*point_x, *point_y],
        constraint_segment: unsolved.object_id.into(),
    })
}

fn extract_midpoint_target(
    segment_value: &KclValue,
    range: crate::SourceRange,
) -> Result<MidpointTargetVars, KclError> {
    let KclValue::Segment { value: segment } = segment_value else {
        return Err(KclError::new_semantic(KclErrorDetails::new(
            format!(
                "midpoint() target must be a line or arc Segment, but found {}",
                segment_value.human_friendly_type()
            ),
            vec![range],
        )));
    };
    let SegmentRepr::Unsolved { segment: unsolved } = &segment.repr else {
        return Err(KclError::new_semantic(KclErrorDetails::new(
            "midpoint() target must be an unsolved line or arc Segment".to_owned(),
            vec![range],
        )));
    };
    match &unsolved.kind {
        UnsolvedSegmentKind::Line { start, end, .. } => {
            let (
                UnsolvedExpr::Unknown(start_x),
                UnsolvedExpr::Unknown(start_y),
                UnsolvedExpr::Unknown(end_x),
                UnsolvedExpr::Unknown(end_y),
            ) = (&start[0], &start[1], &end[0], &end[1])
            else {
                return Err(KclError::new_semantic(KclErrorDetails::new(
                    "midpoint() line coordinates must be sketch vars".to_owned(),
                    vec![range],
                )));
            };

            Ok(MidpointTargetVars::Line {
                start: [*start_x, *start_y],
                end: [*end_x, *end_y],
                object_id: unsolved.object_id,
            })
        }
        UnsolvedSegmentKind::Arc { center, start, end, .. } => {
            let (
                UnsolvedExpr::Unknown(center_x),
                UnsolvedExpr::Unknown(center_y),
                UnsolvedExpr::Unknown(start_x),
                UnsolvedExpr::Unknown(start_y),
                UnsolvedExpr::Unknown(end_x),
                UnsolvedExpr::Unknown(end_y),
            ) = (&center[0], &center[1], &start[0], &start[1], &end[0], &end[1])
            else {
                return Err(KclError::new_semantic(KclErrorDetails::new(
                    "midpoint() arc center/start/end coordinates must be sketch vars".to_owned(),
                    vec![range],
                )));
            };

            Ok(MidpointTargetVars::Arc {
                center: [*center_x, *center_y],
                start: [*start_x, *start_y],
                end: [*end_x, *end_y],
                object_id: unsolved.object_id,
            })
        }
        _ => Err(KclError::new_semantic(KclErrorDetails::new(
            "midpoint() target must be a line or circular arc Segment".to_owned(),
            vec![range],
        ))),
    }
}

pub async fn midpoint(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let target: KclValue =
        args.get_unlabeled_kw_arg("input", &RuntimeType::Primitive(PrimitiveType::Segment), exec_state)?;
    let point: KclValue = args.get_kw_arg(
        "point",
        &RuntimeType::Union(vec![RuntimeType::segment(), RuntimeType::point2d()]),
        exec_state,
    )?;
    let range = args.source_range;

    let point = extract_midpoint_point(&point, range)?;
    let target = extract_midpoint_target(&target, range)?;

    let (solver_point, origin_constraints) = match point {
        MidpointPointVars::Segment { coords, .. } => (datum_point(coords, range)?, None),
        MidpointPointVars::Origin => {
            let (origin_point, origin_constraints) = fixed_origin_datum_point(exec_state, range, "midpoint")?;
            (origin_point, Some(origin_constraints))
        }
    };

    let constraint_id = exec_state.next_object_id();
    let Some(sketch_state) = exec_state.sketch_block_mut() else {
        return Err(KclError::new_semantic(KclErrorDetails::new(
            "midpoint() can only be used inside a sketch block".to_owned(),
            vec![range],
        )));
    };

    if let Some(origin_constraints) = origin_constraints {
        sketch_state.solver_constraints.extend(origin_constraints);
    }

    match target {
        MidpointTargetVars::Line { start, end, .. } => {
            sketch_state.solver_constraints.push(SolverConstraint::Midpoint(
                DatumLineSegment::new(datum_point(start, range)?, datum_point(end, range)?),
                solver_point,
            ));
        }
        MidpointTargetVars::Arc { center, start, end, .. } => {
            sketch_state
                .solver_constraints
                .extend(SolverConstraint::point_bisects_arc(
                    DatumCircularArc {
                        center: datum_point(center, range)?,
                        start: datum_point(start, range)?,
                        end: datum_point(end, range)?,
                    },
                    solver_point,
                ));
        }
    }

    let constraint = Constraint::Midpoint(Midpoint {
        point: point.constraint_segment(),
        segment: target.object_id(),
    });
    sketch_state.sketch_constraints.push(constraint_id);
    track_constraint(constraint_id, constraint, exec_state, &args);

    Ok(KclValue::none())
}

pub async fn equal_length(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    #[derive(Clone, Copy)]
    struct ConstrainableLine {
        solver_line: DatumLineSegment,
        object_id: ObjectId,
    }

    let lines: Vec<KclValue> = args.get_unlabeled_kw_arg(
        "lines",
        &RuntimeType::Array(
            Box::new(RuntimeType::Primitive(PrimitiveType::Any)),
            ArrayLen::Minimum(2),
        ),
        exec_state,
    )?;
    let range = args.source_range;
    let constrainable_lines: Vec<ConstrainableLine> = lines
        .iter()
        .map(|line| {
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
            let UnsolvedExpr::Unknown(line_p0_x) = &start[0] else {
                return Err(KclError::new_semantic(KclErrorDetails::new(
                    "line's start x coordinate must be a var".to_owned(),
                    vec![args.source_range],
                )));
            };
            let UnsolvedExpr::Unknown(line_p0_y) = &start[1] else {
                return Err(KclError::new_semantic(KclErrorDetails::new(
                    "line's start y coordinate must be a var".to_owned(),
                    vec![args.source_range],
                )));
            };
            let UnsolvedExpr::Unknown(line_p1_x) = &end[0] else {
                return Err(KclError::new_semantic(KclErrorDetails::new(
                    "line's end x coordinate must be a var".to_owned(),
                    vec![args.source_range],
                )));
            };
            let UnsolvedExpr::Unknown(line_p1_y) = &end[1] else {
                return Err(KclError::new_semantic(KclErrorDetails::new(
                    "line's end y coordinate must be a var".to_owned(),
                    vec![args.source_range],
                )));
            };

            let solver_line_p0 =
                DatumPoint::new_xy(line_p0_x.to_constraint_id(range)?, line_p0_y.to_constraint_id(range)?);
            let solver_line_p1 =
                DatumPoint::new_xy(line_p1_x.to_constraint_id(range)?, line_p1_y.to_constraint_id(range)?);

            Ok(ConstrainableLine {
                solver_line: DatumLineSegment::new(solver_line_p0, solver_line_p1),
                object_id: unsolved.object_id,
            })
        })
        .collect::<Result<_, _>>()?;

    let constraint_id = exec_state.next_object_id();
    // Save the constraint to be used for solving.
    let Some(sketch_state) = exec_state.sketch_block_mut() else {
        return Err(KclError::new_semantic(KclErrorDetails::new(
            "equalLength() can only be used inside a sketch block".to_owned(),
            vec![args.source_range],
        )));
    };
    let first_line = constrainable_lines[0];
    for line in constrainable_lines.iter().skip(1) {
        sketch_state.solver_constraints.push(SolverConstraint::LinesEqualLength(
            first_line.solver_line,
            line.solver_line,
        ));
    }
    let constraint = crate::front::Constraint::LinesEqualLength(LinesEqualLength {
        lines: constrainable_lines.iter().map(|line| line.object_id).collect(),
    });
    sketch_state.sketch_constraints.push(constraint_id);
    track_constraint(constraint_id, constraint, exec_state, &args);
    Ok(KclValue::none())
}

fn datum_point(coords: [SketchVarId; 2], range: crate::SourceRange) -> Result<DatumPoint, KclError> {
    Ok(DatumPoint::new_xy(
        coords[0].to_constraint_id(range)?,
        coords[1].to_constraint_id(range)?,
    ))
}

fn sketch_var_initial_value(
    sketch_vars: &[KclValue],
    id: SketchVarId,
    exec_state: &mut ExecState,
    range: crate::SourceRange,
) -> Result<f64, KclError> {
    sketch_vars
        .get(id.0)
        .and_then(KclValue::as_sketch_var)
        .map(|sketch_var| {
            sketch_var
                .initial_value_to_solver_units(exec_state, range, "equalRadius() hidden shared radius initial value")
                .map(|value| value.n)
        })
        .transpose()?
        .ok_or_else(|| {
            KclError::new_internal(KclErrorDetails::new(
                format!("Missing sketch variable initial value for id {}", id.0),
                vec![range],
            ))
        })
}

fn radius_guess(
    sketch_vars: &[KclValue],
    center: [SketchVarId; 2],
    point: [SketchVarId; 2],
    exec_state: &mut ExecState,
    range: crate::SourceRange,
) -> Result<f64, KclError> {
    let dx = sketch_var_initial_value(sketch_vars, point[0], exec_state, range)?
        - sketch_var_initial_value(sketch_vars, center[0], exec_state, range)?;
    let dy = sketch_var_initial_value(sketch_vars, point[1], exec_state, range)?
        - sketch_var_initial_value(sketch_vars, center[1], exec_state, range)?;
    Ok(libm::hypot(dx, dy))
}

fn reflect_point_across_line(point: [f64; 2], axis_start: [f64; 2], axis_end: [f64; 2]) -> [f64; 2] {
    let [px, py] = point;
    let [ax, ay] = axis_start;
    let [bx, by] = axis_end;
    let dx = bx - ax;
    let dy = by - ay;
    let axis_len_sq = dx * dx + dy * dy;
    if axis_len_sq <= f64::EPSILON {
        return point;
    }

    let point_from_axis = [px - ax, py - ay];
    let projection_scale = (point_from_axis[0] * dx + point_from_axis[1] * dy) / axis_len_sq;
    let projected = [ax + projection_scale * dx, ay + projection_scale * dy];

    [2.0 * projected[0] - px, 2.0 * projected[1] - py]
}

/// Calculate some initial guesses for the given points,
/// which are being constrained to symmetric across the given line.
fn symmetric_hidden_point_guess(
    sketch_vars: &[KclValue],
    point: [SketchVarId; 2],
    axis: SymmetricLineVars,
    exec_state: &mut ExecState,
    range: crate::SourceRange,
) -> Result<[f64; 2], KclError> {
    let point = [
        sketch_var_initial_value(sketch_vars, point[0], exec_state, range)?,
        sketch_var_initial_value(sketch_vars, point[1], exec_state, range)?,
    ];
    let axis_start = [
        sketch_var_initial_value(sketch_vars, axis.start[0], exec_state, range)?,
        sketch_var_initial_value(sketch_vars, axis.start[1], exec_state, range)?,
    ];
    let axis_end = [
        sketch_var_initial_value(sketch_vars, axis.end[0], exec_state, range)?,
        sketch_var_initial_value(sketch_vars, axis.end[1], exec_state, range)?,
    ];

    Ok(reflect_point_across_line(point, axis_start, axis_end))
}

fn create_hidden_point(
    exec_state: &mut ExecState,
    initial_position: [f64; 2],
    range: crate::SourceRange,
) -> Result<[SketchVarId; 2], KclError> {
    let sketch_var_ty = solver_numeric_type(exec_state);
    let Some(sketch_state) = exec_state.sketch_block_mut() else {
        return Err(KclError::new_semantic(KclErrorDetails::new(
            "symmetric() can only be used inside a sketch block".to_owned(),
            vec![range],
        )));
    };

    let x_id = sketch_state.next_sketch_var_id();
    sketch_state.sketch_vars.push(KclValue::SketchVar {
        value: Box::new(crate::execution::SketchVar {
            id: x_id,
            initial_value: initial_position[0],
            ty: sketch_var_ty,
            // Synthesized symmetric() support point coord; not source-backed.
            node_path: None,
            meta: vec![],
        }),
    });

    let y_id = sketch_state.next_sketch_var_id();
    sketch_state.sketch_vars.push(KclValue::SketchVar {
        value: Box::new(crate::execution::SketchVar {
            id: y_id,
            initial_value: initial_position[1],
            ty: sketch_var_ty,
            // Synthesized symmetric() support point coord; not source-backed.
            node_path: None,
            meta: vec![],
        }),
    });

    Ok([x_id, y_id])
}

pub async fn equal_radius(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    #[derive(Debug, Clone, Copy)]
    struct RadiusInputVars {
        center: [SketchVarId; 2],
        start: [SketchVarId; 2],
        end: Option<[SketchVarId; 2]>,
    }

    #[derive(Debug, Clone, Copy)]
    enum EqualRadiusInput {
        Radius(RadiusInputVars),
    }

    fn extract_equal_radius_input(
        segment_value: &KclValue,
        range: crate::SourceRange,
    ) -> Result<(EqualRadiusInput, ObjectId), KclError> {
        let KclValue::Segment { value: segment } = segment_value else {
            return Err(KclError::new_semantic(KclErrorDetails::new(
                format!(
                    "equalRadius() arguments must be segments but found {}",
                    segment_value.human_friendly_type()
                ),
                vec![range],
            )));
        };
        let SegmentRepr::Unsolved { segment: unsolved } = &segment.repr else {
            return Err(KclError::new_semantic(KclErrorDetails::new(
                "equalRadius() arguments must be unsolved segments".to_owned(),
                vec![range],
            )));
        };
        match &unsolved.kind {
            UnsolvedSegmentKind::Arc { center, start, end, .. } => {
                let (
                    UnsolvedExpr::Unknown(center_x),
                    UnsolvedExpr::Unknown(center_y),
                    UnsolvedExpr::Unknown(start_x),
                    UnsolvedExpr::Unknown(start_y),
                    UnsolvedExpr::Unknown(end_x),
                    UnsolvedExpr::Unknown(end_y),
                ) = (&center[0], &center[1], &start[0], &start[1], &end[0], &end[1])
                else {
                    return Err(KclError::new_semantic(KclErrorDetails::new(
                        "arc center/start/end coordinates must be sketch vars for equalRadius()".to_owned(),
                        vec![range],
                    )));
                };
                Ok((
                    EqualRadiusInput::Radius(RadiusInputVars {
                        center: [*center_x, *center_y],
                        start: [*start_x, *start_y],
                        end: Some([*end_x, *end_y]),
                    }),
                    unsolved.object_id,
                ))
            }
            UnsolvedSegmentKind::Circle { center, start, .. } => {
                let (
                    UnsolvedExpr::Unknown(center_x),
                    UnsolvedExpr::Unknown(center_y),
                    UnsolvedExpr::Unknown(start_x),
                    UnsolvedExpr::Unknown(start_y),
                ) = (&center[0], &center[1], &start[0], &start[1])
                else {
                    return Err(KclError::new_semantic(KclErrorDetails::new(
                        "circle center/start coordinates must be sketch vars for equalRadius()".to_owned(),
                        vec![range],
                    )));
                };
                Ok((
                    EqualRadiusInput::Radius(RadiusInputVars {
                        center: [*center_x, *center_y],
                        start: [*start_x, *start_y],
                        end: None,
                    }),
                    unsolved.object_id,
                ))
            }
            other => Err(KclError::new_semantic(KclErrorDetails::new(
                format!(
                    "equalRadius() currently supports only arc and circle segments, you provided {}",
                    other.human_friendly_kind_with_article()
                ),
                vec![range],
            ))),
        }
    }

    let input: Vec<KclValue> = args.get_unlabeled_kw_arg(
        "input",
        &RuntimeType::Array(
            Box::new(RuntimeType::Primitive(PrimitiveType::Any)),
            ArrayLen::Minimum(2),
        ),
        exec_state,
    )?;
    let range = args.source_range;

    let extracted_input = input
        .iter()
        .map(|segment_value| extract_equal_radius_input(segment_value, range))
        .collect::<Result<Vec<_>, _>>()?;
    let radius_inputs: Vec<RadiusInputVars> = extracted_input
        .iter()
        .map(|(equal_radius_input, _)| match equal_radius_input {
            EqualRadiusInput::Radius(radius_input) => *radius_input,
        })
        .collect();
    let input_object_ids: Vec<ObjectId> = extracted_input.iter().map(|(_, object_id)| *object_id).collect();

    let sketch_var_ty = solver_numeric_type(exec_state);
    let constraint_id = exec_state.next_object_id();

    let sketch_vars = {
        let Some(sketch_state) = exec_state.sketch_block_mut() else {
            return Err(KclError::new_semantic(KclErrorDetails::new(
                "equalRadius() can only be used inside a sketch block".to_owned(),
                vec![range],
            )));
        };
        sketch_state.sketch_vars.clone()
    };

    let radius_initial_value = radius_guess(
        &sketch_vars,
        radius_inputs[0].center,
        radius_inputs[0].start,
        exec_state,
        range,
    )?;

    let Some(sketch_state) = exec_state.sketch_block_mut() else {
        return Err(KclError::new_semantic(KclErrorDetails::new(
            "equalRadius() can only be used inside a sketch block".to_owned(),
            vec![range],
        )));
    };
    let radius_id = sketch_state.next_sketch_var_id();
    sketch_state.sketch_vars.push(KclValue::SketchVar {
        value: Box::new(crate::execution::SketchVar {
            id: radius_id,
            initial_value: radius_initial_value,
            ty: sketch_var_ty,
            // Synthesized hidden radius for equalRadius(); no source `var` to map back to.
            node_path: None,
            meta: vec![],
        }),
    });
    let radius = DatumDistance::new(radius_id.to_constraint_id(range)?);

    for radius_input in radius_inputs {
        let center = datum_point(radius_input.center, range)?;
        let start = datum_point(radius_input.start, range)?;
        sketch_state
            .solver_constraints
            .push(SolverConstraint::DistanceVar(start, center, radius));
        if let Some(end) = radius_input.end {
            let end = datum_point(end, range)?;
            sketch_state
                .solver_constraints
                .push(SolverConstraint::DistanceVar(end, center, radius));
        }
    }

    let constraint = crate::front::Constraint::EqualRadius(EqualRadius {
        input: input_object_ids,
    });
    sketch_state.sketch_constraints.push(constraint_id);
    track_constraint(constraint_id, constraint, exec_state, &args);

    Ok(KclValue::none())
}

pub async fn tangent(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let Some(Some(sketch_id)) = exec_state.sketch_block().map(|sb| sb.sketch_id) else {
        return Err(KclError::new_semantic(KclErrorDetails::new(
            "tangent() cannot be used outside a sketch block".to_owned(),
            vec![args.source_range],
        )));
    };

    #[derive(Debug, Clone)]
    enum TangentInput {
        Line(LineVars),
        Circular(ArcVars),
    }

    fn extract_tangent_input(
        segment_value: &KclValue,
        range: crate::SourceRange,
    ) -> Result<(TangentInput, ObjectId), KclError> {
        let KclValue::Segment { value: segment } = segment_value else {
            return Err(KclError::new_semantic(KclErrorDetails::new(
                "tangent() arguments must be segments".to_owned(),
                vec![range],
            )));
        };
        let SegmentRepr::Unsolved { segment: unsolved } = &segment.repr else {
            return Err(KclError::new_semantic(KclErrorDetails::new(
                "tangent() arguments must be unsolved segments".to_owned(),
                vec![range],
            )));
        };
        match &unsolved.kind {
            UnsolvedSegmentKind::Line { start, end, .. } => {
                let (
                    UnsolvedExpr::Unknown(start_x),
                    UnsolvedExpr::Unknown(start_y),
                    UnsolvedExpr::Unknown(end_x),
                    UnsolvedExpr::Unknown(end_y),
                ) = (&start[0], &start[1], &end[0], &end[1])
                else {
                    return Err(KclError::new_semantic(KclErrorDetails::new(
                        "line coordinates must be sketch vars for tangent()".to_owned(),
                        vec![range],
                    )));
                };
                Ok((
                    TangentInput::Line(LineVars {
                        start: [*start_x, *start_y],
                        end: [*end_x, *end_y],
                    }),
                    unsolved.object_id,
                ))
            }
            UnsolvedSegmentKind::Arc { center, start, end, .. } => {
                let (
                    UnsolvedExpr::Unknown(center_x),
                    UnsolvedExpr::Unknown(center_y),
                    UnsolvedExpr::Unknown(start_x),
                    UnsolvedExpr::Unknown(start_y),
                    UnsolvedExpr::Unknown(end_x),
                    UnsolvedExpr::Unknown(end_y),
                ) = (&center[0], &center[1], &start[0], &start[1], &end[0], &end[1])
                else {
                    return Err(KclError::new_semantic(KclErrorDetails::new(
                        "arc center/start/end coordinates must be sketch vars for tangent()".to_owned(),
                        vec![range],
                    )));
                };
                Ok((
                    TangentInput::Circular(ArcVars {
                        center: [*center_x, *center_y],
                        start: [*start_x, *start_y],
                        end: Some([*end_x, *end_y]),
                    }),
                    unsolved.object_id,
                ))
            }
            UnsolvedSegmentKind::Circle { center, start, .. } => {
                let (
                    UnsolvedExpr::Unknown(center_x),
                    UnsolvedExpr::Unknown(center_y),
                    UnsolvedExpr::Unknown(start_x),
                    UnsolvedExpr::Unknown(start_y),
                ) = (&center[0], &center[1], &start[0], &start[1])
                else {
                    return Err(KclError::new_semantic(KclErrorDetails::new(
                        "circle center/start coordinates must be sketch vars for tangent()".to_owned(),
                        vec![range],
                    )));
                };
                Ok((
                    TangentInput::Circular(ArcVars {
                        center: [*center_x, *center_y],
                        start: [*start_x, *start_y],
                        end: None,
                    }),
                    unsolved.object_id,
                ))
            }
            _ => Err(KclError::new_semantic(KclErrorDetails::new(
                "tangent() supports only line, arc, and circle segments".to_owned(),
                vec![range],
            ))),
        }
    }

    let input: Vec<KclValue> = args.get_unlabeled_kw_arg(
        "input",
        &RuntimeType::Array(Box::new(RuntimeType::Primitive(PrimitiveType::Any)), ArrayLen::Known(2)),
        exec_state,
    )?;
    let [item0, item1]: [KclValue; 2] = input.try_into().map_err(|_| {
        KclError::new_semantic(KclErrorDetails::new(
            "tangent() requires exactly 2 input segments".to_owned(),
            vec![args.source_range],
        ))
    })?;
    let range = args.source_range;
    let (input0, input0_object_id) = extract_tangent_input(&item0, range)?;
    let (input1, input1_object_id) = extract_tangent_input(&item1, range)?;

    enum TangentCase {
        LineCircular(LineVars, ArcVars),
        CircularCircular(ArcVars, ArcVars),
    }
    let tangent_case = match (input0, input1) {
        (TangentInput::Line(line), TangentInput::Circular(circular))
        | (TangentInput::Circular(circular), TangentInput::Line(line)) => TangentCase::LineCircular(line, circular),
        (TangentInput::Circular(circular0), TangentInput::Circular(circular1)) => {
            TangentCase::CircularCircular(circular0, circular1)
        }
        (TangentInput::Line(_), TangentInput::Line(_)) => {
            return Err(KclError::new_semantic(KclErrorDetails::new(
                "tangent() does not support Line/Line. Tangency requires at least one circular segment.".to_owned(),
                vec![range],
            )));
        }
    };

    let sketch_var_ty = solver_numeric_type(exec_state);
    let constraint_id = exec_state.next_object_id();

    let sketch_vars = {
        let Some(sketch_state) = exec_state.sketch_block_mut() else {
            return Err(KclError::new_semantic(KclErrorDetails::new(
                "tangent() can only be used inside a sketch block".to_owned(),
                vec![range],
            )));
        };
        sketch_state.sketch_vars.clone()
    };

    // Hidden radius vars. Empty metadata keeps them out of source write-back.
    match tangent_case {
        TangentCase::LineCircular(line, circular) => {
            let tangency_key = make_line_arc_tangency_key(line, circular);
            let tangency_side = match exec_state.constraint_state(sketch_id, &tangency_key) {
                Some(ConstraintState::Tangency(TangencyMode::LineCircle(side))) => side,
                _ => {
                    let side = infer_line_tangent_side(&sketch_vars, line, circular.center, exec_state, range)?;
                    exec_state.set_constraint_state(
                        sketch_id,
                        tangency_key,
                        ConstraintState::Tangency(TangencyMode::LineCircle(side)),
                    );
                    side
                }
            };
            let line_p0 = datum_point(line.start, range)?;
            let line_p1 = datum_point(line.end, range)?;
            let line_datum = DatumLineSegment::new(line_p0, line_p1);

            let center = datum_point(circular.center, range)?;
            let circular_start = datum_point(circular.start, range)?;
            let circular_end = circular.end.map(|end| datum_point(end, range)).transpose()?;
            let radius_initial_value = radius_guess(&sketch_vars, circular.center, circular.start, exec_state, range)?;
            let Some(sketch_state) = exec_state.sketch_block_mut() else {
                return Err(KclError::new_semantic(KclErrorDetails::new(
                    "tangent() can only be used inside a sketch block".to_owned(),
                    vec![range],
                )));
            };
            let radius_id = sketch_state.next_sketch_var_id();
            sketch_state.sketch_vars.push(KclValue::SketchVar {
                value: Box::new(crate::execution::SketchVar {
                    id: radius_id,
                    initial_value: radius_initial_value,
                    ty: sketch_var_ty,
                    // Synthesized hidden radius for tangent(); no source `var` to map back to.
                    node_path: None,
                    meta: vec![],
                }),
            });
            let radius = DatumDistance::new(radius_id.to_constraint_id(range)?);
            let circle = DatumCircle { center, radius };

            // Tangency decomposition for Line/circular segment:
            // 1) Introduce a hidden radius variable r for the segment's underlying circle.
            // 2) Keep the segment's defining points on that circle with DistanceVar(point, center, r).
            // 3) Apply the native LineTangentToCircle solver constraint.
            sketch_state
                .solver_constraints
                .push(SolverConstraint::DistanceVar(circular_start, center, radius));
            if let Some(circular_end) = circular_end {
                sketch_state
                    .solver_constraints
                    .push(SolverConstraint::DistanceVar(circular_end, center, radius));
            }
            sketch_state
                .solver_constraints
                .push(SolverConstraint::LineTangentToCircle(line_datum, circle, tangency_side));
        }
        TangentCase::CircularCircular(circular0, circular1) => {
            let tangency_key = make_arc_arc_tangency_key(circular0, circular1);
            let tangency_side = match exec_state.constraint_state(sketch_id, &tangency_key) {
                Some(ConstraintState::Tangency(TangencyMode::CircleCircle(side))) => side,
                _ => {
                    let side = infer_arc_tangent_side(&sketch_vars, circular0, circular1, exec_state, range)?;
                    exec_state.set_constraint_state(
                        sketch_id,
                        tangency_key,
                        ConstraintState::Tangency(TangencyMode::CircleCircle(side)),
                    );
                    side
                }
            };
            let center0 = datum_point(circular0.center, range)?;
            let start0 = datum_point(circular0.start, range)?;
            let end0 = circular0.end.map(|end| datum_point(end, range)).transpose()?;
            let radius0_initial_value =
                radius_guess(&sketch_vars, circular0.center, circular0.start, exec_state, range)?;
            let center1 = datum_point(circular1.center, range)?;
            let start1 = datum_point(circular1.start, range)?;
            let end1 = circular1.end.map(|end| datum_point(end, range)).transpose()?;
            let radius1_initial_value =
                radius_guess(&sketch_vars, circular1.center, circular1.start, exec_state, range)?;
            let Some(sketch_state) = exec_state.sketch_block_mut() else {
                return Err(KclError::new_semantic(KclErrorDetails::new(
                    "tangent() can only be used inside a sketch block".to_owned(),
                    vec![range],
                )));
            };
            let radius0_id = sketch_state.next_sketch_var_id();
            sketch_state.sketch_vars.push(KclValue::SketchVar {
                value: Box::new(crate::execution::SketchVar {
                    id: radius0_id,
                    initial_value: radius0_initial_value,
                    ty: sketch_var_ty,
                    // Synthesized hidden radius for tangent(); no source `var` to map back to.
                    node_path: None,
                    meta: vec![],
                }),
            });
            let radius0 = DatumDistance::new(radius0_id.to_constraint_id(range)?);
            let circle0 = DatumCircle {
                center: center0,
                radius: radius0,
            };

            let radius1_id = sketch_state.next_sketch_var_id();
            sketch_state.sketch_vars.push(KclValue::SketchVar {
                value: Box::new(crate::execution::SketchVar {
                    id: radius1_id,
                    initial_value: radius1_initial_value,
                    ty: sketch_var_ty,
                    // Synthesized hidden radius for tangent(); no source `var` to map back to.
                    node_path: None,
                    meta: vec![],
                }),
            });
            let radius1 = DatumDistance::new(radius1_id.to_constraint_id(range)?);
            let circle1 = DatumCircle {
                center: center1,
                radius: radius1,
            };

            // Tangency decomposition for circular segment/circular segment:
            // 1) Introduce one hidden radius variable per arc.
            // 2) Keep each segment's defining points on its corresponding circle.
            // 3) Apply the native CircleTangentToCircle solver constraint.
            sketch_state
                .solver_constraints
                .push(SolverConstraint::DistanceVar(start0, center0, radius0));
            if let Some(end0) = end0 {
                sketch_state
                    .solver_constraints
                    .push(SolverConstraint::DistanceVar(end0, center0, radius0));
            }
            sketch_state
                .solver_constraints
                .push(SolverConstraint::DistanceVar(start1, center1, radius1));
            if let Some(end1) = end1 {
                sketch_state
                    .solver_constraints
                    .push(SolverConstraint::DistanceVar(end1, center1, radius1));
            }
            sketch_state
                .solver_constraints
                .push(SolverConstraint::CircleTangentToCircle(circle0, circle1, tangency_side));
        }
    }

    let constraint = crate::front::Constraint::Tangent(Tangent {
        input: vec![input0_object_id, input1_object_id],
    });
    let Some(sketch_state) = exec_state.sketch_block_mut() else {
        return Err(KclError::new_semantic(KclErrorDetails::new(
            "tangent() can only be used inside a sketch block".to_owned(),
            vec![range],
        )));
    };
    sketch_state.sketch_constraints.push(constraint_id);
    track_constraint(constraint_id, constraint, exec_state, &args);

    Ok(KclValue::none())
}

#[derive(Debug, Clone, Copy)]
struct SymmetricPointVars {
    coords: [SketchVarId; 2],
    object_id: ObjectId,
}

/// The line that geometry should be symmetric across.
#[derive(Debug, Clone, Copy)]
struct SymmetricLineVars {
    start: [SketchVarId; 2],
    end: [SketchVarId; 2],
    object_id: ObjectId,
}

#[derive(Debug, Clone, Copy)]
struct SymmetricArcVars {
    center: [SketchVarId; 2],
    start: [SketchVarId; 2],
    end: [SketchVarId; 2],
    object_id: ObjectId,
}

#[derive(Debug, Clone, Copy)]
struct SymmetricCircleVars {
    center: [SketchVarId; 2],
    start: [SketchVarId; 2],
    object_id: ObjectId,
}

#[derive(Debug, Clone, Copy)]
enum SymmetricInput {
    Point(SymmetricPointVars),
    Line(SymmetricLineVars),
    Arc(SymmetricArcVars),
    Circle(SymmetricCircleVars),
}

impl SymmetricInput {
    fn type_name(self) -> &'static str {
        match self {
            SymmetricInput::Point(_) => "points",
            SymmetricInput::Line(_) => "lines",
            SymmetricInput::Arc(_) => "arcs",
            SymmetricInput::Circle(_) => "circles",
        }
    }

    fn object_id(self) -> ObjectId {
        match self {
            SymmetricInput::Point(point) => point.object_id,
            SymmetricInput::Line(line) => line.object_id,
            SymmetricInput::Arc(arc) => arc.object_id,
            SymmetricInput::Circle(circle) => circle.object_id,
        }
    }
}

fn extract_symmetric_input(segment_value: &KclValue, range: crate::SourceRange) -> Result<SymmetricInput, KclError> {
    let KclValue::Segment { value: segment } = segment_value else {
        return Err(KclError::new_semantic(KclErrorDetails::new(
            format!(
                "symmetric() arguments must be point, line, arc, or circle segments, but found {}",
                segment_value.human_friendly_type()
            ),
            vec![range],
        )));
    };
    let SegmentRepr::Unsolved { segment: unsolved } = &segment.repr else {
        return Err(KclError::new_semantic(KclErrorDetails::new(
            "symmetric() arguments must be unsolved segments".to_owned(),
            vec![range],
        )));
    };

    match &unsolved.kind {
        UnsolvedSegmentKind::Point { position, .. } => {
            let (UnsolvedExpr::Unknown(x), UnsolvedExpr::Unknown(y)) = (&position[0], &position[1]) else {
                return Err(KclError::new_semantic(KclErrorDetails::new(
                    "point coordinates must be sketch vars for symmetric()".to_owned(),
                    vec![range],
                )));
            };
            Ok(SymmetricInput::Point(SymmetricPointVars {
                coords: [*x, *y],
                object_id: unsolved.object_id,
            }))
        }
        UnsolvedSegmentKind::Line { start, end, .. } => {
            let (
                UnsolvedExpr::Unknown(start_x),
                UnsolvedExpr::Unknown(start_y),
                UnsolvedExpr::Unknown(end_x),
                UnsolvedExpr::Unknown(end_y),
            ) = (&start[0], &start[1], &end[0], &end[1])
            else {
                return Err(KclError::new_semantic(KclErrorDetails::new(
                    "line coordinates must be sketch vars for symmetric()".to_owned(),
                    vec![range],
                )));
            };
            Ok(SymmetricInput::Line(SymmetricLineVars {
                start: [*start_x, *start_y],
                end: [*end_x, *end_y],
                object_id: unsolved.object_id,
            }))
        }
        UnsolvedSegmentKind::Arc { center, start, end, .. } => {
            let (
                UnsolvedExpr::Unknown(center_x),
                UnsolvedExpr::Unknown(center_y),
                UnsolvedExpr::Unknown(start_x),
                UnsolvedExpr::Unknown(start_y),
                UnsolvedExpr::Unknown(end_x),
                UnsolvedExpr::Unknown(end_y),
            ) = (&center[0], &center[1], &start[0], &start[1], &end[0], &end[1])
            else {
                return Err(KclError::new_semantic(KclErrorDetails::new(
                    "arc center/start/end coordinates must be sketch vars for symmetric()".to_owned(),
                    vec![range],
                )));
            };
            Ok(SymmetricInput::Arc(SymmetricArcVars {
                center: [*center_x, *center_y],
                start: [*start_x, *start_y],
                end: [*end_x, *end_y],
                object_id: unsolved.object_id,
            }))
        }
        UnsolvedSegmentKind::Circle { center, start, .. } => {
            let (
                UnsolvedExpr::Unknown(center_x),
                UnsolvedExpr::Unknown(center_y),
                UnsolvedExpr::Unknown(start_x),
                UnsolvedExpr::Unknown(start_y),
            ) = (&center[0], &center[1], &start[0], &start[1])
            else {
                return Err(KclError::new_semantic(KclErrorDetails::new(
                    "circle center/start coordinates must be sketch vars for symmetric()".to_owned(),
                    vec![range],
                )));
            };
            Ok(SymmetricInput::Circle(SymmetricCircleVars {
                center: [*center_x, *center_y],
                start: [*start_x, *start_y],
                object_id: unsolved.object_id,
            }))
        }
        UnsolvedSegmentKind::ControlPointSpline { .. } => Err(KclError::new_semantic(KclErrorDetails::new(
            "symmetric() does not yet support control point spline segments".to_owned(),
            vec![range],
        ))),
    }
}

fn extract_symmetric_axis_line(
    segment_value: &KclValue,
    range: crate::SourceRange,
) -> Result<SymmetricLineVars, KclError> {
    let KclValue::Segment { value: segment } = segment_value else {
        return Err(KclError::new_semantic(KclErrorDetails::new(
            format!(
                "symmetric() axis must be a line Segment, but found {}",
                segment_value.human_friendly_type()
            ),
            vec![range],
        )));
    };
    let SegmentRepr::Unsolved { segment: unsolved } = &segment.repr else {
        return Err(KclError::new_semantic(KclErrorDetails::new(
            "symmetric() axis must be an unsolved line Segment".to_owned(),
            vec![range],
        )));
    };
    let UnsolvedSegmentKind::Line { start, end, .. } = &unsolved.kind else {
        return Err(KclError::new_semantic(KclErrorDetails::new(
            "symmetric() axis must be a line Segment".to_owned(),
            vec![range],
        )));
    };
    let (
        UnsolvedExpr::Unknown(start_x),
        UnsolvedExpr::Unknown(start_y),
        UnsolvedExpr::Unknown(end_x),
        UnsolvedExpr::Unknown(end_y),
    ) = (&start[0], &start[1], &end[0], &end[1])
    else {
        return Err(KclError::new_semantic(KclErrorDetails::new(
            "symmetric() axis line coordinates must be sketch vars".to_owned(),
            vec![range],
        )));
    };

    Ok(SymmetricLineVars {
        start: [*start_x, *start_y],
        end: [*end_x, *end_y],
        object_id: unsolved.object_id,
    })
}

pub async fn symmetric(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    #[derive(Debug, Clone, Copy)]
    struct SymmetricCircularVars {
        center: [SketchVarId; 2],
        start: [SketchVarId; 2],
        end: Option<[SketchVarId; 2]>,
    }

    let input: Vec<KclValue> = args.get_unlabeled_kw_arg(
        "input",
        &RuntimeType::Array(
            Box::new(RuntimeType::Primitive(PrimitiveType::Segment)),
            ArrayLen::Known(2),
        ),
        exec_state,
    )?;
    let [item0, item1]: [KclValue; 2] = input.try_into().map_err(|_| {
        KclError::new_semantic(KclErrorDetails::new(
            "symmetric() requires exactly 2 input segments".to_owned(),
            vec![args.source_range],
        ))
    })?;
    let axis: KclValue = args.get_kw_arg("axis", &RuntimeType::Primitive(PrimitiveType::Segment), exec_state)?;
    let range = args.source_range;

    let input0 = extract_symmetric_input(&item0, range)?;
    let input1 = extract_symmetric_input(&item1, range)?;
    let axis_line = extract_symmetric_axis_line(&axis, range)?;

    let solver_axis = DatumLineSegment::new(datum_point(axis_line.start, range)?, datum_point(axis_line.end, range)?);

    let (mut solver_constraints, circular_inputs) = match (input0, input1) {
        (SymmetricInput::Point(point0), SymmetricInput::Point(point1)) => (
            vec![SolverConstraint::Symmetric(
                solver_axis,
                datum_point(point0.coords, range)?,
                datum_point(point1.coords, range)?,
            )],
            None,
        ),
        (SymmetricInput::Line(line0), SymmetricInput::Line(line1)) => {
            let sketch_vars = {
                let Some(sketch_state) = exec_state.sketch_block_mut() else {
                    return Err(KclError::new_semantic(KclErrorDetails::new(
                        "symmetric() can only be used inside a sketch block".to_owned(),
                        vec![range],
                    )));
                };
                sketch_state.sketch_vars.clone()
            };
            let mirrored_start = symmetric_hidden_point_guess(&sketch_vars, line0.start, axis_line, exec_state, range)?;
            let mirrored_end = symmetric_hidden_point_guess(&sketch_vars, line0.end, axis_line, exec_state, range)?;
            let hidden_start = create_hidden_point(exec_state, mirrored_start, range)?;
            let hidden_end = create_hidden_point(exec_state, mirrored_end, range)?;
            let mirrored_support_line =
                DatumLineSegment::new(datum_point(hidden_start, range)?, datum_point(hidden_end, range)?);
            let solver_line1 = DatumLineSegment::new(datum_point(line1.start, range)?, datum_point(line1.end, range)?);

            (
                vec![
                    SolverConstraint::Symmetric(
                        solver_axis,
                        datum_point(line0.start, range)?,
                        datum_point(hidden_start, range)?,
                    ),
                    SolverConstraint::Symmetric(
                        solver_axis,
                        datum_point(line0.end, range)?,
                        datum_point(hidden_end, range)?,
                    ),
                    SolverConstraint::LinesAtAngle(mirrored_support_line, solver_line1, AngleKind::Parallel),
                    // Keep the second segment on the mirrored support line without
                    // forcing its endpoints to be pairwise mirrored.
                    SolverConstraint::PointLineDistance(datum_point(line1.start, range)?, mirrored_support_line, 0.0),
                ],
                None,
            )
        }
        (SymmetricInput::Arc(arc0), SymmetricInput::Arc(arc1)) => (
            vec![SolverConstraint::Symmetric(
                solver_axis,
                datum_point(arc0.center, range)?,
                datum_point(arc1.center, range)?,
            )],
            Some([
                SymmetricCircularVars {
                    center: arc0.center,
                    start: arc0.start,
                    end: Some(arc0.end),
                },
                SymmetricCircularVars {
                    center: arc1.center,
                    start: arc1.start,
                    end: Some(arc1.end),
                },
            ]),
        ),
        (SymmetricInput::Circle(circle0), SymmetricInput::Circle(circle1)) => (
            vec![SolverConstraint::Symmetric(
                solver_axis,
                datum_point(circle0.center, range)?,
                datum_point(circle1.center, range)?,
            )],
            Some([
                SymmetricCircularVars {
                    center: circle0.center,
                    start: circle0.start,
                    end: None,
                },
                SymmetricCircularVars {
                    center: circle1.center,
                    start: circle1.start,
                    end: None,
                },
            ]),
        ),
        _ => {
            return Err(KclError::new_semantic(KclErrorDetails::new(
                format!(
                    "symmetric() inputs must be homogeneous. You provided {} and {}",
                    input0.type_name(),
                    input1.type_name()
                ),
                vec![range],
            )));
        }
    };

    if let Some([circular0, circular1]) = circular_inputs {
        let sketch_var_ty = solver_numeric_type(exec_state);
        let sketch_vars = {
            let Some(sketch_state) = exec_state.sketch_block_mut() else {
                return Err(KclError::new_semantic(KclErrorDetails::new(
                    "symmetric() can only be used inside a sketch block".to_owned(),
                    vec![range],
                )));
            };
            sketch_state.sketch_vars.clone()
        };
        let radius_initial_value = radius_guess(&sketch_vars, circular0.center, circular0.start, exec_state, range)?;

        let Some(sketch_state) = exec_state.sketch_block_mut() else {
            return Err(KclError::new_semantic(KclErrorDetails::new(
                "symmetric() can only be used inside a sketch block".to_owned(),
                vec![range],
            )));
        };
        let radius_id = sketch_state.next_sketch_var_id();
        sketch_state.sketch_vars.push(KclValue::SketchVar {
            value: Box::new(crate::execution::SketchVar {
                id: radius_id,
                initial_value: radius_initial_value,
                ty: sketch_var_ty,
                // Synthesized shared radius for equalRadius() across circulars; not source-backed.
                node_path: None,
                meta: vec![],
            }),
        });
        let radius = DatumDistance::new(radius_id.to_constraint_id(range)?);

        for circular in [circular0, circular1] {
            let center = datum_point(circular.center, range)?;
            let start = datum_point(circular.start, range)?;
            solver_constraints.push(SolverConstraint::DistanceVar(start, center, radius));
            if let Some(end) = circular.end {
                let end = datum_point(end, range)?;
                solver_constraints.push(SolverConstraint::DistanceVar(end, center, radius));
            }
        }
    }

    let constraint_id = exec_state.next_object_id();
    let Some(sketch_state) = exec_state.sketch_block_mut() else {
        return Err(KclError::new_semantic(KclErrorDetails::new(
            "symmetric() can only be used inside a sketch block".to_owned(),
            vec![range],
        )));
    };
    sketch_state.solver_constraints.extend(solver_constraints);

    let constraint = crate::front::Constraint::Symmetric(Symmetric {
        input: vec![input0.object_id(), input1.object_id()],
        axis: axis_line.object_id,
    });
    sketch_state.sketch_constraints.push(constraint_id);
    track_constraint(constraint_id, constraint, exec_state, &args);

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

    fn to_solver_angle(self) -> ezpz::datatypes::AngleKind {
        match self {
            LinesAtAngleKind::Parallel => ezpz::datatypes::AngleKind::Parallel,
            LinesAtAngleKind::Perpendicular => ezpz::datatypes::AngleKind::Perpendicular,
        }
    }

    fn constraint(&self, lines: Vec<ObjectId>) -> Constraint {
        match self {
            LinesAtAngleKind::Parallel => Constraint::Parallel(Parallel { lines }),
            LinesAtAngleKind::Perpendicular => Constraint::Perpendicular(Perpendicular { lines }),
        }
    }
}

/// Convert between two different libraries with similar angle representations
#[expect(unused)]
fn into_kcmc_angle(angle: ezpz::datatypes::Angle) -> kcmc::shared::Angle {
    kcmc::shared::Angle::from_degrees(angle.to_degrees())
}

/// Convert between two different libraries with similar angle representations
#[expect(unused)]
fn into_ezpz_angle(angle: kcmc::shared::Angle) -> ezpz::datatypes::Angle {
    ezpz::datatypes::Angle::from_degrees(angle.to_degrees())
}

pub async fn parallel(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    #[derive(Clone, Copy)]
    struct ConstrainableLine {
        solver_line: DatumLineSegment,
        object_id: ObjectId,
    }

    let lines: Vec<KclValue> = args.get_unlabeled_kw_arg(
        "lines",
        &RuntimeType::Array(
            Box::new(RuntimeType::Primitive(PrimitiveType::Any)),
            ArrayLen::Minimum(2),
        ),
        exec_state,
    )?;
    let range = args.source_range;
    let constrainable_lines: Vec<ConstrainableLine> = lines
        .iter()
        .map(|line| {
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
            let UnsolvedExpr::Unknown(line_p0_x) = &start[0] else {
                return Err(KclError::new_semantic(KclErrorDetails::new(
                    "line's start x coordinate must be a var".to_owned(),
                    vec![args.source_range],
                )));
            };
            let UnsolvedExpr::Unknown(line_p0_y) = &start[1] else {
                return Err(KclError::new_semantic(KclErrorDetails::new(
                    "line's start y coordinate must be a var".to_owned(),
                    vec![args.source_range],
                )));
            };
            let UnsolvedExpr::Unknown(line_p1_x) = &end[0] else {
                return Err(KclError::new_semantic(KclErrorDetails::new(
                    "line's end x coordinate must be a var".to_owned(),
                    vec![args.source_range],
                )));
            };
            let UnsolvedExpr::Unknown(line_p1_y) = &end[1] else {
                return Err(KclError::new_semantic(KclErrorDetails::new(
                    "line's end y coordinate must be a var".to_owned(),
                    vec![args.source_range],
                )));
            };

            let solver_line_p0 =
                DatumPoint::new_xy(line_p0_x.to_constraint_id(range)?, line_p0_y.to_constraint_id(range)?);
            let solver_line_p1 =
                DatumPoint::new_xy(line_p1_x.to_constraint_id(range)?, line_p1_y.to_constraint_id(range)?);

            Ok(ConstrainableLine {
                solver_line: DatumLineSegment::new(solver_line_p0, solver_line_p1),
                object_id: unsolved.object_id,
            })
        })
        .collect::<Result<_, _>>()?;

    let constraint_id = exec_state.next_object_id();
    let Some(sketch_state) = exec_state.sketch_block_mut() else {
        return Err(KclError::new_semantic(KclErrorDetails::new(
            "parallel() can only be used inside a sketch block".to_owned(),
            vec![args.source_range],
        )));
    };

    let n = constrainable_lines.len();
    let mut constrainable_lines_iter = constrainable_lines.iter();
    let first_line = constrainable_lines_iter
        .next()
        .ok_or(KclError::new_semantic(KclErrorDetails::new(
            format!("parallel() requires at least 2 lines, but you provided {}", n),
            vec![args.source_range],
        )))?;
    for line in constrainable_lines_iter {
        sketch_state.solver_constraints.push(SolverConstraint::LinesAtAngle(
            first_line.solver_line,
            line.solver_line,
            AngleKind::Parallel,
        ));
    }
    let constraint = Constraint::Parallel(Parallel {
        lines: constrainable_lines.iter().map(|line| line.object_id).collect(),
    });
    sketch_state.sketch_constraints.push(constraint_id);
    track_constraint(constraint_id, constraint, exec_state, &args);
    Ok(KclValue::none())
}

pub async fn perpendicular(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    lines_at_angle(LinesAtAngleKind::Perpendicular, exec_state, args).await
}

/// A way to constrain points, or a line.
#[derive(Debug, Clone, Copy)]
enum AxisConstraintKind {
    Horizontal,
    Vertical,
}

impl AxisConstraintKind {
    /// Which KCL function this corresponds to.
    fn function_name(self) -> &'static str {
        match self {
            AxisConstraintKind::Horizontal => "horizontal",
            AxisConstraintKind::Vertical => "vertical",
        }
    }

    /// Use this constraint to align a line.
    fn line_constraint(self, line: DatumLineSegment) -> SolverConstraint {
        match self {
            AxisConstraintKind::Horizontal => SolverConstraint::Horizontal(line),
            AxisConstraintKind::Vertical => SolverConstraint::Vertical(line),
        }
    }

    /// Use this constraint to align a pair of points.
    fn point_pair_constraint(self, p0: DatumPoint, p1: DatumPoint) -> SolverConstraint {
        match self {
            // A horizontal point set means all Y values are equal.
            AxisConstraintKind::Horizontal => SolverConstraint::VerticalDistance(p1, p0, 0.0),
            // A vertical point set means all X values are equal.
            AxisConstraintKind::Vertical => SolverConstraint::HorizontalDistance(p1, p0, 0.0),
        }
    }

    /// Use this constraint to align a point to some known X or Y.
    fn constraint_aligning_point_to_constant(self, p0: DatumPoint, fixed_point: (f64, f64)) -> SolverConstraint {
        match self {
            AxisConstraintKind::Horizontal => SolverConstraint::Fixed(p0.y_id, fixed_point.1),
            AxisConstraintKind::Vertical => SolverConstraint::Fixed(p0.x_id, fixed_point.0),
        }
    }

    fn line_artifact_constraint(self, line: ObjectId) -> Constraint {
        match self {
            AxisConstraintKind::Horizontal => Constraint::Horizontal(Horizontal::Line { line }),
            AxisConstraintKind::Vertical => Constraint::Vertical(Vertical::Line { line }),
        }
    }

    fn point_artifact_constraint(self, points: Vec<ConstraintSegment>) -> Constraint {
        match self {
            AxisConstraintKind::Horizontal => Constraint::Horizontal(Horizontal::Points { points }),
            AxisConstraintKind::Vertical => Constraint::Vertical(Vertical::Points { points }),
        }
    }
}

/// The line the user wants to align vertically/horizontally.
/// Extracted from KCL arguments.
#[derive(Debug, Clone, Copy)]
struct AxisLineVars {
    start: [SketchVarId; 2],
    end: [SketchVarId; 2],
    object_id: ObjectId,
}

fn extract_axis_line_vars(
    segment: &AbstractSegment,
    kind: AxisConstraintKind,
    source_range: crate::SourceRange,
) -> Result<AxisLineVars, KclError> {
    let SegmentRepr::Unsolved { segment: unsolved } = &segment.repr else {
        return Err(KclError::new_internal(KclErrorDetails::new(
            "line must be an unsolved Segment".to_owned(),
            vec![source_range],
        )));
    };
    let UnsolvedSegmentKind::Line { start, end, .. } = &unsolved.kind else {
        return Err(KclError::new_semantic(KclErrorDetails::new(
            format!(
                "{}() line argument must be a line, no other type of Segment",
                kind.function_name()
            ),
            vec![source_range],
        )));
    };
    let (
        UnsolvedExpr::Unknown(start_x),
        UnsolvedExpr::Unknown(start_y),
        UnsolvedExpr::Unknown(end_x),
        UnsolvedExpr::Unknown(end_y),
    ) = (&start[0], &start[1], &end[0], &end[1])
    else {
        return Err(KclError::new_semantic(KclErrorDetails::new(
            "line's x and y coordinates of both start and end must be vars".to_owned(),
            vec![source_range],
        )));
    };

    Ok(AxisLineVars {
        start: [*start_x, *start_y],
        end: [*end_x, *end_y],
        object_id: unsolved.object_id,
    })
}

#[derive(Debug, Clone)]
enum PointToAlign {
    /// Variable point that could be constrained.
    Variable { x: SketchVarId, y: SketchVarId },
    /// Fixed millimeter constant.
    Fixed { x: TyF64, y: TyF64 },
}

impl From<[SketchVarId; 2]> for PointToAlign {
    fn from(sketch_var: [SketchVarId; 2]) -> Self {
        Self::Variable {
            x: sketch_var[0],
            y: sketch_var[1],
        }
    }
}

impl From<[TyF64; 2]> for PointToAlign {
    fn from([x, y]: [TyF64; 2]) -> Self {
        Self::Fixed { x, y }
    }
}

fn extract_axis_point_vars(
    input: &KclValue,
    kind: AxisConstraintKind,
    source_range: crate::SourceRange,
) -> Result<PointToAlign, KclError> {
    match input {
        KclValue::Segment { value: segment } => {
            let SegmentRepr::Unsolved { segment: unsolved } = &segment.repr else {
                return Err(KclError::new_semantic(KclErrorDetails::new(
                    format!(
                        "The `{}` function point arguments must be unsolved points",
                        kind.function_name()
                    ),
                    vec![source_range],
                )));
            };
            let UnsolvedSegmentKind::Point { position, .. } = &unsolved.kind else {
                return Err(KclError::new_semantic(KclErrorDetails::new(
                    format!(
                        "The `{}` function list arguments must be points, but one item is {}",
                        kind.function_name(),
                        unsolved.kind.human_friendly_kind_with_article()
                    ),
                    vec![source_range],
                )));
            };
            match (&position[0], &position[1]) {
                (UnsolvedExpr::Known(x), UnsolvedExpr::Known(y)) => Ok(PointToAlign::Fixed {
                    x: x.to_owned(),
                    y: y.to_owned(),
                }),
                (UnsolvedExpr::Unknown(x), UnsolvedExpr::Unknown(y)) => Ok(PointToAlign::Variable { x: *x, y: *y }),
                (UnsolvedExpr::Known(..), UnsolvedExpr::Unknown(..)) => {
                    Err(KclError::new_semantic(KclErrorDetails::new(
                        format!(
                            "The `{}` function cannot take a fixed X component and a variable Y component",
                            kind.function_name()
                        ),
                        vec![source_range],
                    )))
                }
                (UnsolvedExpr::Unknown(..), UnsolvedExpr::Known(..)) => {
                    Err(KclError::new_semantic(KclErrorDetails::new(
                        format!(
                            "The `{}` function cannot take a fixed X component and a variable Y component",
                            kind.function_name()
                        ),
                        vec![source_range],
                    )))
                }
            }
        }
        KclValue::Tuple { value, .. } | KclValue::HomArray { value, .. } => {
            let [x_value, y_value] = value.as_slice() else {
                return Err(KclError::new_semantic(KclErrorDetails::new(
                    format!(
                        "The `{}` function point arguments must each be a Point2d like [var 0mm, var 0mm]",
                        kind.function_name()
                    ),
                    vec![source_range],
                )));
            };
            let Some(x_expr) = x_value.as_unsolved_expr() else {
                return Err(KclError::new_semantic(KclErrorDetails::new(
                    format!(
                        "The `{}` function point x coordinate must be a number or sketch var",
                        kind.function_name()
                    ),
                    vec![source_range],
                )));
            };
            let Some(y_expr) = y_value.as_unsolved_expr() else {
                return Err(KclError::new_semantic(KclErrorDetails::new(
                    format!(
                        "The `{}` function point y coordinate must be a number or sketch var",
                        kind.function_name()
                    ),
                    vec![source_range],
                )));
            };
            match (x_expr, y_expr) {
                (UnsolvedExpr::Known(x), UnsolvedExpr::Known(y)) => Ok(PointToAlign::Fixed { x, y }),
                (UnsolvedExpr::Unknown(x), UnsolvedExpr::Unknown(y)) => Ok(PointToAlign::Variable { x, y }),
                (UnsolvedExpr::Known(..), UnsolvedExpr::Unknown(..)) => {
                    Err(KclError::new_semantic(KclErrorDetails::new(
                        format!(
                            "The `{}` function cannot take a fixed X component and a variable Y component",
                            kind.function_name()
                        ),
                        vec![source_range],
                    )))
                }
                (UnsolvedExpr::Unknown(..), UnsolvedExpr::Known(..)) => {
                    Err(KclError::new_semantic(KclErrorDetails::new(
                        format!(
                            "The `{}` function cannot take a fixed X component and a variable Y component",
                            kind.function_name()
                        ),
                        vec![source_range],
                    )))
                }
            }
        }
        _ => Err(KclError::new_semantic(KclErrorDetails::new(
            format!(
                "The `{}` function accepts either a line Segment or a list of points",
                kind.function_name()
            ),
            vec![source_range],
        ))),
    }
}

async fn axis_constraint(
    kind: AxisConstraintKind,
    exec_state: &mut ExecState,
    args: Args,
) -> Result<KclValue, KclError> {
    let input: KclValue =
        args.get_unlabeled_kw_arg("input", &RuntimeType::Primitive(PrimitiveType::Any), exec_state)?;

    // User could pass in a single line, or a sequence of points.
    match input {
        KclValue::Segment { value } => {
            // Single-line case.
            axis_constraint_line(value, kind, exec_state, args)
        }
        KclValue::Tuple { value, .. } | KclValue::HomArray { value, .. } => {
            // Sequence of points case.
            axis_constraint_points(value, kind, exec_state, args)
        }
        other => Err(KclError::new_semantic(KclErrorDetails::new(
            format!(
                "{}() accepts either a line Segment or a list of at least two points, but you provided {}",
                kind.function_name(),
                other.human_friendly_type(),
            ),
            vec![args.source_range],
        ))),
    }
}

/// User has provided a single line to align along the given axis.
fn axis_constraint_line(
    segment: Box<AbstractSegment>,
    kind: AxisConstraintKind,
    exec_state: &mut ExecState,
    args: Args,
) -> Result<KclValue, KclError> {
    let line = extract_axis_line_vars(&segment, kind, args.source_range)?;
    let range = args.source_range;
    let solver_p0 = DatumPoint::new_xy(
        line.start[0].to_constraint_id(range)?,
        line.start[1].to_constraint_id(range)?,
    );
    let solver_p1 = DatumPoint::new_xy(
        line.end[0].to_constraint_id(range)?,
        line.end[1].to_constraint_id(range)?,
    );
    let solver_line = DatumLineSegment::new(solver_p0, solver_p1);
    let constraint = kind.line_constraint(solver_line);
    let constraint_id = exec_state.next_object_id();
    let Some(sketch_state) = exec_state.sketch_block_mut() else {
        return Err(KclError::new_semantic(KclErrorDetails::new(
            format!("{}() can only be used inside a sketch block", kind.function_name()),
            vec![args.source_range],
        )));
    };
    sketch_state.solver_constraints.push(constraint);
    let constraint = kind.line_artifact_constraint(line.object_id);
    sketch_state.sketch_constraints.push(constraint_id);
    track_constraint(constraint_id, constraint, exec_state, &args);
    Ok(KclValue::none())
}

/// User has provided a sequence of points to align along the given axis.
fn axis_constraint_points(
    point_values: Vec<KclValue>,
    kind: AxisConstraintKind,
    exec_state: &mut ExecState,
    args: Args,
) -> Result<KclValue, KclError> {
    if point_values.len() < 2 {
        return Err(KclError::new_semantic(KclErrorDetails::new(
            format!("{}() point list must contain at least two points", kind.function_name()),
            vec![args.source_range],
        )));
    }

    let trackable_point_ids = point_values
        .iter()
        .map(|point| match point {
            KclValue::Segment { value: segment } => {
                let SegmentRepr::Unsolved { segment: unsolved } = &segment.repr else {
                    return None;
                };
                let UnsolvedSegmentKind::Point { .. } = &unsolved.kind else {
                    return None;
                };
                Some(ConstraintSegment::from(unsolved.object_id))
            }
            point if point2d_is_origin(point) => Some(ConstraintSegment::ORIGIN),
            _ => None,
        })
        .collect::<Option<Vec<_>>>();

    let Some(sketch_state) = exec_state.sketch_block_mut() else {
        return Err(KclError::new_semantic(KclErrorDetails::new(
            format!("{}() can only be used inside a sketch block", kind.function_name()),
            vec![args.source_range],
        )));
    };

    let points: Vec<PointToAlign> = point_values
        .iter()
        .map(|point| extract_axis_point_vars(point, kind, args.source_range))
        .collect::<Result<_, _>>()?;

    let mut solver_constraints = Vec::with_capacity(points.len().saturating_sub(1));

    let mut var_points = Vec::new();
    let mut fix_points = Vec::new();
    for point in points {
        match point {
            PointToAlign::Variable { x, y } => var_points.push((x, y)),
            PointToAlign::Fixed { x, y } => fix_points.push((x, y)),
        }
    }
    if fix_points.len() > 1 {
        return Err(KclError::new_semantic(KclErrorDetails::new(
            format!(
                "{}() point list can contain at most 1 fixed point, but you provided {}",
                kind.function_name(),
                fix_points.len()
            ),
            vec![args.source_range],
        )));
    }

    if let Some(fix_point) = fix_points.pop() {
        // We have to align all the variable points with this singular fixed point.
        // For points 0, 1, 2, ..., n, create constraints
        // fixed(0.x, fix.x)
        // fixed(1.x, fix.x)
        // ...
        // fixed(n.x, fix.x)
        // (or y, whatever is appropriate)
        for point in var_points {
            let solver_point = datum_point([point.0, point.1], args.source_range)?;
            let fix_point_mm = (fix_point.0.to_mm(), fix_point.1.to_mm());
            solver_constraints.push(kind.constraint_aligning_point_to_constant(solver_point, fix_point_mm));
        }
    } else {
        // For points 0, 1, 2, ..., n, create constraints
        // vertical(0, 1)
        // vertical(0, 2)
        // ...
        // vertical(0, n)
        // (or horizontal, if appropriate)
        let mut points = var_points.into_iter();
        let first_point = points.next().ok_or_else(|| {
            KclError::new_semantic(KclErrorDetails::new(
                format!("{}() point list must contain at least two points", kind.function_name()),
                vec![args.source_range],
            ))
        })?;
        let anchor = datum_point([first_point.0, first_point.1], args.source_range)?;
        for point in points {
            let solver_point = datum_point([point.0, point.1], args.source_range)?;
            solver_constraints.push(kind.point_pair_constraint(anchor, solver_point));
        }
    }
    sketch_state.solver_constraints.extend(solver_constraints);

    if let Some(point_ids) = trackable_point_ids {
        let constraint_id = exec_state.next_object_id();
        let Some(sketch_state) = exec_state.sketch_block_mut() else {
            debug_assert!(false, "Constraint created outside a sketch block");
            return Ok(KclValue::none());
        };
        sketch_state.sketch_constraints.push(constraint_id);
        let constraint = kind.point_artifact_constraint(point_ids);
        track_constraint(constraint_id, constraint, exec_state, &args);
    }

    Ok(KclValue::none())
}

pub async fn angle(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
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

    // All coordinates are sketch vars. Proceed.
    let sketch_constraint = SketchConstraint {
        kind: SketchConstraintKind::Angle {
            line0: crate::execution::ConstrainableLine2d {
                object_id: unsolved0.object_id,
                vars: [
                    crate::front::Point2d {
                        x: *line0_p0_x,
                        y: *line0_p0_y,
                    },
                    crate::front::Point2d {
                        x: *line0_p1_x,
                        y: *line0_p1_y,
                    },
                ],
            },
            line1: crate::execution::ConstrainableLine2d {
                object_id: unsolved1.object_id,
                vars: [
                    crate::front::Point2d {
                        x: *line1_p0_x,
                        y: *line1_p0_y,
                    },
                    crate::front::Point2d {
                        x: *line1_p1_x,
                        y: *line1_p1_y,
                    },
                ],
            },
        },
        meta: vec![args.source_range.into()],
    };
    Ok(KclValue::SketchConstraint {
        value: Box::new(sketch_constraint),
    })
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
    let solver_line0_p0 = ezpz::datatypes::inputs::DatumPoint::new_xy(
        line0_p0_x.to_constraint_id(range)?,
        line0_p0_y.to_constraint_id(range)?,
    );
    let solver_line0_p1 = ezpz::datatypes::inputs::DatumPoint::new_xy(
        line0_p1_x.to_constraint_id(range)?,
        line0_p1_y.to_constraint_id(range)?,
    );
    let solver_line0 = ezpz::datatypes::inputs::DatumLineSegment::new(solver_line0_p0, solver_line0_p1);
    let solver_line1_p0 = ezpz::datatypes::inputs::DatumPoint::new_xy(
        line1_p0_x.to_constraint_id(range)?,
        line1_p0_y.to_constraint_id(range)?,
    );
    let solver_line1_p1 = ezpz::datatypes::inputs::DatumPoint::new_xy(
        line1_p1_x.to_constraint_id(range)?,
        line1_p1_y.to_constraint_id(range)?,
    );
    let solver_line1 = ezpz::datatypes::inputs::DatumLineSegment::new(solver_line1_p0, solver_line1_p1);
    let constraint = SolverConstraint::LinesAtAngle(solver_line0, solver_line1, angle_kind.to_solver_angle());
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
    let constraint = angle_kind.constraint(vec![unsolved0.object_id, unsolved1.object_id]);
    sketch_state.sketch_constraints.push(constraint_id);
    track_constraint(constraint_id, constraint, exec_state, &args);
    Ok(KclValue::none())
}

pub async fn horizontal(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    axis_constraint(AxisConstraintKind::Horizontal, exec_state, args).await
}

pub async fn vertical(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    axis_constraint(AxisConstraintKind::Vertical, exec_state, args).await
}
