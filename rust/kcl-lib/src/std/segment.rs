//! Functions related to line segments.

use anyhow::Result;
use kittycad_modeling_cmds::shared::Angle;

use super::utils::untype_point;
use crate::errors::KclError;
use crate::errors::KclErrorDetails;
use crate::execution::ExecState;
use crate::execution::KclValue;
use crate::execution::Segment;
use crate::execution::SegmentKind;
use crate::execution::Sketch;
use crate::execution::TagIdentifier;
use crate::execution::UnsolvedExpr;
use crate::execution::UnsolvedSegment;
use crate::execution::UnsolvedSegmentKind;
use crate::execution::types::NumericType;
use crate::execution::types::PrimitiveType;
use crate::execution::types::RuntimeType;
use crate::std::Args;
use crate::std::args::TyF64;
use crate::std::utils::between;

/// Returns the point at the end of the given segment.
pub async fn segment_end(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let tag: TagIdentifier = args.get_unlabeled_kw_arg("tag", &RuntimeType::tagged_edge(), exec_state)?;
    let pt = inner_segment_end(&tag, exec_state, args.clone())?;

    args.make_kcl_val_from_point([pt[0].n, pt[1].n], pt[0].ty)
}

fn inner_segment_end(tag: &TagIdentifier, exec_state: &mut ExecState, args: Args) -> Result<[TyF64; 2], KclError> {
    let line = args.get_tag_engine_info(exec_state, tag)?;
    let path = line.path.clone().ok_or_else(|| {
        KclError::new_type(KclErrorDetails::new(
            format!("Expected a line segment with a path, found `{line:?}`"),
            vec![args.source_range],
        ))
    })?;
    let (p, ty) = path.end_point_components();
    // Docs generation isn't smart enough to handle ([f64; 2], NumericType).
    let point = [TyF64::new(p[0], ty), TyF64::new(p[1], ty)];

    Ok(point)
}

/// Returns the segment end of x.
pub async fn segment_end_x(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let tag: TagIdentifier = args.get_unlabeled_kw_arg("tag", &RuntimeType::tagged_edge(), exec_state)?;
    let result = inner_segment_end_x(&tag, exec_state, args.clone())?;

    Ok(args.make_user_val_from_f64_with_type(result))
}

fn inner_segment_end_x(tag: &TagIdentifier, exec_state: &mut ExecState, args: Args) -> Result<TyF64, KclError> {
    let line = args.get_tag_engine_info(exec_state, tag)?;
    let path = line.path.clone().ok_or_else(|| {
        KclError::new_type(KclErrorDetails::new(
            format!("Expected a line segment with a path, found `{line:?}`"),
            vec![args.source_range],
        ))
    })?;

    Ok(TyF64::new(path.get_base().to[0], path.get_base().units.into()))
}

/// Returns the segment end of y.
pub async fn segment_end_y(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let tag: TagIdentifier = args.get_unlabeled_kw_arg("tag", &RuntimeType::tagged_edge(), exec_state)?;
    let result = inner_segment_end_y(&tag, exec_state, args.clone())?;

    Ok(args.make_user_val_from_f64_with_type(result))
}

fn inner_segment_end_y(tag: &TagIdentifier, exec_state: &mut ExecState, args: Args) -> Result<TyF64, KclError> {
    let line = args.get_tag_engine_info(exec_state, tag)?;
    let path = line.path.clone().ok_or_else(|| {
        KclError::new_type(KclErrorDetails::new(
            format!("Expected a line segment with a path, found `{line:?}`"),
            vec![args.source_range],
        ))
    })?;

    Ok(path.get_to()[1].clone())
}

/// Returns the point at the start of the given segment.
pub async fn segment_start(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let tag: TagIdentifier = args.get_unlabeled_kw_arg("tag", &RuntimeType::tagged_edge(), exec_state)?;
    let pt = inner_segment_start(&tag, exec_state, args.clone())?;

    args.make_kcl_val_from_point([pt[0].n, pt[1].n], pt[0].ty)
}

fn inner_segment_start(tag: &TagIdentifier, exec_state: &mut ExecState, args: Args) -> Result<[TyF64; 2], KclError> {
    let line = args.get_tag_engine_info(exec_state, tag)?;
    let path = line.path.clone().ok_or_else(|| {
        KclError::new_type(KclErrorDetails::new(
            format!("Expected a line segment with a path, found `{line:?}`"),
            vec![args.source_range],
        ))
    })?;
    let (p, ty) = path.start_point_components();
    // Docs generation isn't smart enough to handle ([f64; 2], NumericType).
    let point = [TyF64::new(p[0], ty), TyF64::new(p[1], ty)];

    Ok(point)
}

/// Returns the segment start of x.
pub async fn segment_start_x(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let tag: TagIdentifier = args.get_unlabeled_kw_arg("tag", &RuntimeType::tagged_edge(), exec_state)?;
    let result = inner_segment_start_x(&tag, exec_state, args.clone())?;

    Ok(args.make_user_val_from_f64_with_type(result))
}

fn inner_segment_start_x(tag: &TagIdentifier, exec_state: &mut ExecState, args: Args) -> Result<TyF64, KclError> {
    let line = args.get_tag_engine_info(exec_state, tag)?;
    let path = line.path.clone().ok_or_else(|| {
        KclError::new_type(KclErrorDetails::new(
            format!("Expected a line segment with a path, found `{line:?}`"),
            vec![args.source_range],
        ))
    })?;

    Ok(path.get_from()[0].clone())
}

/// Returns the segment start of y.
pub async fn segment_start_y(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let tag: TagIdentifier = args.get_unlabeled_kw_arg("tag", &RuntimeType::tagged_edge(), exec_state)?;
    let result = inner_segment_start_y(&tag, exec_state, args.clone())?;

    Ok(args.make_user_val_from_f64_with_type(result))
}

fn inner_segment_start_y(tag: &TagIdentifier, exec_state: &mut ExecState, args: Args) -> Result<TyF64, KclError> {
    let line = args.get_tag_engine_info(exec_state, tag)?;
    let path = line.path.clone().ok_or_else(|| {
        KclError::new_type(KclErrorDetails::new(
            format!("Expected a line segment with a path, found `{line:?}`"),
            vec![args.source_range],
        ))
    })?;

    Ok(path.get_from()[1].clone())
}
/// Returns the last segment of x.
pub async fn last_segment_x(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let sketch = args.get_unlabeled_kw_arg("sketch", &RuntimeType::Primitive(PrimitiveType::Sketch), exec_state)?;
    let result = inner_last_segment_x(sketch, args.clone())?;

    Ok(args.make_user_val_from_f64_with_type(result))
}

fn inner_last_segment_x(sketch: Sketch, args: Args) -> Result<TyF64, KclError> {
    let last_line = sketch
        .paths
        .last()
        .ok_or_else(|| {
            KclError::new_type(KclErrorDetails::new(
                format!("Expected a Sketch with at least one segment, found `{sketch:?}`"),
                vec![args.source_range],
            ))
        })?
        .get_base();

    Ok(TyF64::new(last_line.to[0], last_line.units.into()))
}

/// Returns the last segment of y.
pub async fn last_segment_y(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let sketch = args.get_unlabeled_kw_arg("sketch", &RuntimeType::Primitive(PrimitiveType::Sketch), exec_state)?;
    let result = inner_last_segment_y(sketch, args.clone())?;

    Ok(args.make_user_val_from_f64_with_type(result))
}

fn inner_last_segment_y(sketch: Sketch, args: Args) -> Result<TyF64, KclError> {
    let last_line = sketch
        .paths
        .last()
        .ok_or_else(|| {
            KclError::new_type(KclErrorDetails::new(
                format!("Expected a Sketch with at least one segment, found `{sketch:?}`"),
                vec![args.source_range],
            ))
        })?
        .get_base();

    Ok(TyF64::new(last_line.to[1], last_line.units.into()))
}

/// Returns the length of the segment.
pub async fn segment_length(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let input = args.get_unlabeled_kw_arg::<KclValue>(
        "tag",
        &RuntimeType::Union(vec![
            RuntimeType::tagged_edge(),
            RuntimeType::Primitive(PrimitiveType::Segment),
        ]),
        exec_state,
    )?;
    let result = inner_segment_length(&input, exec_state, args.clone())?;
    Ok(args.make_user_val_from_f64_with_type(result))
}

fn inner_segment_length(input: &KclValue, exec_state: &mut ExecState, args: Args) -> Result<TyF64, KclError> {
    match input {
        KclValue::TagIdentifier(tag) => {
            let line = args.get_tag_engine_info(exec_state, tag)?;
            let path = line.path.clone().ok_or_else(|| {
                KclError::new_type(KclErrorDetails::new(
                    format!("Expected a line segment with a path, found `{line:?}`"),
                    vec![args.source_range],
                ))
            })?;

            path.length().ok_or_else(|| {
                KclError::new_semantic(KclErrorDetails::new(
                    "Computing the length of this segment type is unsupported".to_owned(),
                    vec![args.source_range],
                ))
            })
        }
        KclValue::Segment { value } => match &value.repr {
            crate::execution::SegmentRepr::Solved { segment } => segment_length_from_segment(segment, args),
            crate::execution::SegmentRepr::Unsolved { segment } => {
                segment_length_from_unsolved_segment(segment, exec_state, args)
            }
        },
        _ => Err(KclError::new_type(KclErrorDetails::new(
            format!(
                "Expected a tagged edge or Segment, found `{}`",
                input.human_friendly_type()
            ),
            vec![args.source_range],
        ))),
    }
}

fn segment_length_from_unsolved_segment(
    segment: &UnsolvedSegment,
    exec_state: &ExecState,
    args: Args,
) -> Result<TyF64, KclError> {
    match &segment.kind {
        UnsolvedSegmentKind::Point { .. } => Err(KclError::new_semantic(KclErrorDetails::new(
            "Computing the length of this segment type is unsupported".to_owned(),
            vec![args.source_range],
        ))),
        UnsolvedSegmentKind::Line { start, end, .. } => {
            let start_x = unsolved_expr_to_ty_f64(&start[0], exec_state, args.source_range)?;
            let start_y = unsolved_expr_to_ty_f64(&start[1], exec_state, args.source_range)?;
            let end_x = unsolved_expr_to_ty_f64(&end[0], exec_state, args.source_range)?;
            let end_y = unsolved_expr_to_ty_f64(&end[1], exec_state, args.source_range)?;
            Ok(TyF64::new(
                linear_distance(&[start_x.clone(), start_y], &[end_x, end_y]),
                start_x.ty,
            ))
        }
        UnsolvedSegmentKind::Arc { start, end, .. } => {
            let start_x = unsolved_expr_to_ty_f64(&start[0], exec_state, args.source_range)?;
            let start_y = unsolved_expr_to_ty_f64(&start[1], exec_state, args.source_range)?;
            let end_x = unsolved_expr_to_ty_f64(&end[0], exec_state, args.source_range)?;
            let end_y = unsolved_expr_to_ty_f64(&end[1], exec_state, args.source_range)?;
            Ok(TyF64::new(
                linear_distance(&[start_x.clone(), start_y], &[end_x, end_y]),
                start_x.ty,
            ))
        }
        UnsolvedSegmentKind::Circle { start, center, .. } => {
            let start_x = unsolved_expr_to_ty_f64(&start[0], exec_state, args.source_range)?;
            let start_y = unsolved_expr_to_ty_f64(&start[1], exec_state, args.source_range)?;
            let center_x = unsolved_expr_to_ty_f64(&center[0], exec_state, args.source_range)?;
            let center_y = unsolved_expr_to_ty_f64(&center[1], exec_state, args.source_range)?;
            let radius = linear_distance(&[start_x.clone(), start_y], &[center_x, center_y]);
            Ok(TyF64::new(std::f64::consts::TAU * radius, start_x.ty))
        }
    }
}

fn unsolved_expr_to_ty_f64(
    expr: &UnsolvedExpr,
    exec_state: &ExecState,
    source_range: crate::SourceRange,
) -> Result<TyF64, KclError> {
    match expr {
        UnsolvedExpr::Known(value) => Ok(value.clone()),
        UnsolvedExpr::Unknown(var_id) => {
            let Some(sketch_var) = exec_state
                .sketch_block()
                .and_then(|state| state.sketch_vars.get(var_id.0))
                .and_then(KclValue::as_sketch_var)
            else {
                return Err(KclError::new_internal(KclErrorDetails::new(
                    format!("Missing sketch variable with id {}", var_id.0),
                    vec![source_range],
                )));
            };
            Ok(TyF64::new(sketch_var.initial_value, sketch_var.ty))
        }
    }
}

fn segment_length_from_segment(segment: &Segment, args: Args) -> Result<TyF64, KclError> {
    match &segment.kind {
        SegmentKind::Point { .. } => Err(KclError::new_semantic(KclErrorDetails::new(
            "Computing the length of this segment type is unsupported".to_owned(),
            vec![args.source_range],
        ))),
        SegmentKind::Line { start, end, .. } => Ok(TyF64::new(linear_distance(start, end), start[0].ty)),
        SegmentKind::Arc { start, end, .. } => Ok(TyF64::new(linear_distance(start, end), start[0].ty)),
        SegmentKind::Circle { start, center, .. } => {
            let radius = linear_distance(start, center);
            Ok(TyF64::new(std::f64::consts::TAU * radius, start[0].ty))
        }
    }
}

fn linear_distance(a: &[TyF64; 2], b: &[TyF64; 2]) -> f64 {
    let dx = a[0].n - b[0].n;
    let dy = a[1].n - b[1].n;
    f64::hypot(dx, dy)
}

/// Returns the angle of the segment.
pub async fn segment_angle(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let tag: TagIdentifier = args.get_unlabeled_kw_arg("tag", &RuntimeType::tagged_edge(), exec_state)?;

    let result = inner_segment_angle(&tag, exec_state, args.clone())?;
    Ok(args.make_user_val_from_f64_with_type(TyF64::new(result, NumericType::degrees())))
}

fn inner_segment_angle(tag: &TagIdentifier, exec_state: &mut ExecState, args: Args) -> Result<f64, KclError> {
    let line = args.get_tag_engine_info(exec_state, tag)?;
    let path = line.path.clone().ok_or_else(|| {
        KclError::new_type(KclErrorDetails::new(
            format!("Expected a line segment with a path, found `{line:?}`"),
            vec![args.source_range],
        ))
    })?;

    let result = between(path.get_base().from, path.get_base().to);

    Ok(result.to_degrees())
}

/// Returns the angle coming out of the end of the segment in degrees.
pub async fn tangent_to_end(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let tag: TagIdentifier = args.get_unlabeled_kw_arg("tag", &RuntimeType::tagged_edge(), exec_state)?;

    let result = inner_tangent_to_end(&tag, exec_state, args.clone()).await?;
    Ok(args.make_user_val_from_f64_with_type(TyF64::new(result, NumericType::degrees())))
}

async fn inner_tangent_to_end(tag: &TagIdentifier, exec_state: &mut ExecState, args: Args) -> Result<f64, KclError> {
    let line = args.get_tag_engine_info(exec_state, tag)?;
    let path = line.path.clone().ok_or_else(|| {
        KclError::new_type(KclErrorDetails::new(
            format!("Expected a line segment with a path, found `{line:?}`"),
            vec![args.source_range],
        ))
    })?;

    let from = untype_point(path.get_to()).0;

    // Undocumented voodoo from get_tangential_arc_to_info
    let tangent_info = path.get_tangential_info();
    let tan_previous_point = tangent_info.tan_previous_point(from);

    // Calculate the end point from the angle and radius.
    // atan2 outputs radians.
    let previous_end_tangent = Angle::from_radians(libm::atan2(
        from[1] - tan_previous_point[1],
        from[0] - tan_previous_point[0],
    ));

    Ok(previous_end_tangent.to_degrees())
}
