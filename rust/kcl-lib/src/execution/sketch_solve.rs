use std::collections::HashMap;

use ahash::AHashSet;
use indexmap::IndexMap;
use kcl_error::SourceRange;
use kcl_ezpz::Warning;
use kittycad_modeling_cmds::units::UnitLength;

use crate::{
    ExecState, KclError,
    errors::KclErrorDetails,
    exec::{KclValue, NumericType, UnitType},
    execution::{
        AbstractSegment, Segment, SegmentKind, SegmentRepr, UnsolvedExpr, UnsolvedSegment, UnsolvedSegmentKind,
        types::{PrimitiveType, RuntimeType},
    },
    front::{Freedom, Object},
    std::args::TyF64,
};
#[cfg(feature = "artifact-graph")]
use crate::{execution::Metadata, front::ObjectKind};

/// Freedom analysis results from solving a sketch constraint system. The `Vec`
/// is converted to a set to avoid quadratic runtime.
pub(super) struct FreedomAnalysis {
    pub underconstrained: AHashSet<u32>,
}

impl From<kcl_ezpz::FreedomAnalysis> for FreedomAnalysis {
    fn from(analysis: kcl_ezpz::FreedomAnalysis) -> Self {
        FreedomAnalysis {
            underconstrained: AHashSet::from_iter(analysis.into_underconstrained()),
        }
    }
}

fn solver_unit(exec_state: &ExecState) -> UnitLength {
    exec_state.length_unit()
}

pub(super) fn solver_numeric_type(exec_state: &ExecState) -> NumericType {
    NumericType::Known(UnitType::Length(solver_unit(exec_state)))
}

/// When giving input to the solver, all numbers must be given in the same
/// units.
pub(crate) fn normalize_to_solver_unit(
    value: &KclValue,
    source_range: SourceRange,
    exec_state: &mut ExecState,
    description: &str,
) -> Result<KclValue, KclError> {
    let length_ty = RuntimeType::Primitive(PrimitiveType::Number(solver_numeric_type(exec_state)));
    value.coerce(&length_ty, true, exec_state).map_err(|_| {
        KclError::new_semantic(KclErrorDetails::new(
            format!(
                "{} must be a length coercible to the module length unit {}, but found {}",
                description,
                length_ty.human_friendly_type(),
                value.human_friendly_type(),
            ),
            vec![source_range],
        ))
    })
}

pub(super) fn substitute_sketch_vars(
    variables: IndexMap<String, KclValue>,
    solve_outcome: &Solved,
    solution_ty: NumericType,
    analysis: Option<&FreedomAnalysis>,
) -> Result<HashMap<String, KclValue>, KclError> {
    let mut subbed = HashMap::with_capacity(variables.len());
    for (name, value) in variables {
        let subbed_value = substitute_sketch_var(value, solve_outcome, solution_ty, analysis)?;
        subbed.insert(name, subbed_value);
    }
    Ok(subbed)
}

fn substitute_sketch_var(
    value: KclValue,
    solve_outcome: &Solved,
    solution_ty: NumericType,
    analysis: Option<&FreedomAnalysis>,
) -> Result<KclValue, KclError> {
    match value {
        KclValue::Uuid { .. } => Ok(value),
        KclValue::Bool { .. } => Ok(value),
        KclValue::Number { .. } => Ok(value),
        KclValue::String { .. } => Ok(value),
        KclValue::SketchVar { value: var } => {
            let Some(solution) = solve_outcome.final_values.get(var.id.0) else {
                let message = format!("No solution for sketch variable with id {}", var.id.0);
                debug_assert!(false, "{}", &message);
                return Err(KclError::new_internal(KclErrorDetails::new(
                    message,
                    var.meta.into_iter().map(|m| m.source_range).collect(),
                )));
            };
            Ok(KclValue::Number {
                value: *solution,
                ty: solution_ty,
                meta: var.meta.clone(),
            })
        }
        KclValue::SketchConstraint { .. } => {
            debug_assert!(false, "Sketch constraints should not appear in substituted values");
            Ok(value)
        }
        KclValue::Tuple { value, meta } => {
            let subbed = value
                .into_iter()
                .map(|v| substitute_sketch_var(v, solve_outcome, solution_ty, analysis))
                .collect::<Result<Vec<_>, KclError>>()?;
            Ok(KclValue::Tuple { value: subbed, meta })
        }
        KclValue::HomArray { value, ty } => {
            let subbed = value
                .into_iter()
                .map(|v| substitute_sketch_var(v, solve_outcome, solution_ty, analysis))
                .collect::<Result<Vec<_>, KclError>>()?;
            Ok(KclValue::HomArray { value: subbed, ty })
        }
        KclValue::Object {
            value,
            constrainable,
            meta,
        } => {
            let subbed = value
                .into_iter()
                .map(|(k, v)| substitute_sketch_var(v, solve_outcome, solution_ty, analysis).map(|v| (k, v)))
                .collect::<Result<HashMap<_, _>, KclError>>()?;
            Ok(KclValue::Object {
                value: subbed,
                constrainable,
                meta,
            })
        }
        KclValue::TagIdentifier(_) => Ok(value),
        KclValue::TagDeclarator(_) => Ok(value),
        KclValue::GdtAnnotation { .. } => Ok(value),
        KclValue::Plane { .. } => Ok(value),
        KclValue::Face { .. } => Ok(value),
        KclValue::Segment {
            value: abstract_segment,
        } => match abstract_segment.repr {
            SegmentRepr::Unsolved { segment } => {
                let subbed = substitute_sketch_var_in_segment(segment, solve_outcome, solution_ty, analysis)?;
                Ok(KclValue::Segment {
                    value: Box::new(AbstractSegment {
                        repr: SegmentRepr::Solved { segment: subbed },
                        meta: abstract_segment.meta,
                    }),
                })
            }
            SegmentRepr::Solved { .. } => Ok(KclValue::Segment {
                value: abstract_segment,
            }),
        },
        KclValue::Sketch { .. } => Ok(value),
        KclValue::Solid { .. } => Ok(value),
        KclValue::Helix { .. } => Ok(value),
        KclValue::ImportedGeometry(_) => Ok(value),
        KclValue::Function { .. } => Ok(value),
        KclValue::Module { .. } => Ok(value),
        KclValue::Type { .. } => Ok(value),
        KclValue::KclNone { .. } => Ok(value),
    }
}

pub(super) fn substitute_sketch_var_in_segment(
    segment: UnsolvedSegment,
    solve_outcome: &Solved,
    solution_ty: NumericType,
    analysis: Option<&FreedomAnalysis>,
) -> Result<Segment, KclError> {
    let srs = segment.meta.iter().map(|m| m.source_range).collect::<Vec<_>>();
    match &segment.kind {
        UnsolvedSegmentKind::Point { position, ctor } => {
            let (position_x, position_x_freedom) =
                substitute_sketch_var_in_unsolved_expr(&position[0], solve_outcome, solution_ty, analysis, &srs)?;
            let (position_y, position_y_freedom) =
                substitute_sketch_var_in_unsolved_expr(&position[1], solve_outcome, solution_ty, analysis, &srs)?;
            let position = [position_x, position_y];
            Ok(Segment {
                object_id: segment.object_id,
                kind: SegmentKind::Point {
                    position,
                    ctor: ctor.clone(),
                    freedom: point_freedom(position_x_freedom, position_y_freedom),
                },
                meta: segment.meta,
            })
        }
        UnsolvedSegmentKind::Line {
            start,
            end,
            ctor,
            start_object_id,
            end_object_id,
        } => {
            let (start_x, start_x_freedom) =
                substitute_sketch_var_in_unsolved_expr(&start[0], solve_outcome, solution_ty, analysis, &srs)?;
            let (start_y, start_y_freedom) =
                substitute_sketch_var_in_unsolved_expr(&start[1], solve_outcome, solution_ty, analysis, &srs)?;
            let (end_x, end_x_freedom) =
                substitute_sketch_var_in_unsolved_expr(&end[0], solve_outcome, solution_ty, analysis, &srs)?;
            let (end_y, end_y_freedom) =
                substitute_sketch_var_in_unsolved_expr(&end[1], solve_outcome, solution_ty, analysis, &srs)?;
            let start = [start_x, start_y];
            let end = [end_x, end_y];
            Ok(Segment {
                object_id: segment.object_id,
                kind: SegmentKind::Line {
                    start,
                    end,
                    ctor: ctor.clone(),
                    start_object_id: *start_object_id,
                    end_object_id: *end_object_id,
                    start_freedom: point_freedom(start_x_freedom, start_y_freedom),
                    end_freedom: point_freedom(end_x_freedom, end_y_freedom),
                },
                meta: segment.meta,
            })
        }
        UnsolvedSegmentKind::Arc {
            start,
            end,
            center,
            ctor,
            start_object_id,
            end_object_id,
            center_object_id,
        } => {
            let (start_x, start_x_freedom) =
                substitute_sketch_var_in_unsolved_expr(&start[0], solve_outcome, solution_ty, analysis, &srs)?;
            let (start_y, start_y_freedom) =
                substitute_sketch_var_in_unsolved_expr(&start[1], solve_outcome, solution_ty, analysis, &srs)?;
            let (end_x, end_x_freedom) =
                substitute_sketch_var_in_unsolved_expr(&end[0], solve_outcome, solution_ty, analysis, &srs)?;
            let (end_y, end_y_freedom) =
                substitute_sketch_var_in_unsolved_expr(&end[1], solve_outcome, solution_ty, analysis, &srs)?;
            let (center_x, center_x_freedom) =
                substitute_sketch_var_in_unsolved_expr(&center[0], solve_outcome, solution_ty, analysis, &srs)?;
            let (center_y, center_y_freedom) =
                substitute_sketch_var_in_unsolved_expr(&center[1], solve_outcome, solution_ty, analysis, &srs)?;
            let start = [start_x, start_y];
            let end = [end_x, end_y];
            let center = [center_x, center_y];
            Ok(Segment {
                object_id: segment.object_id,
                kind: SegmentKind::Arc {
                    start,
                    end,
                    center,
                    ctor: ctor.clone(),
                    start_object_id: *start_object_id,
                    end_object_id: *end_object_id,
                    center_object_id: *center_object_id,
                    start_freedom: point_freedom(start_x_freedom, start_y_freedom),
                    end_freedom: point_freedom(end_x_freedom, end_y_freedom),
                    center_freedom: point_freedom(center_x_freedom, center_y_freedom),
                },
                meta: segment.meta,
            })
        }
    }
}

fn substitute_sketch_var_in_unsolved_expr(
    unsolved_expr: &UnsolvedExpr,
    solve_outcome: &Solved,
    solution_ty: NumericType,
    analysis: Option<&FreedomAnalysis>,
    source_ranges: &[SourceRange],
) -> Result<(TyF64, Option<Freedom>), KclError> {
    match unsolved_expr {
        UnsolvedExpr::Known(n) => Ok((n.clone(), Some(Freedom::Fixed))),
        UnsolvedExpr::Unknown(var_id) => {
            let Some(solution) = solve_outcome.final_values.get(var_id.0) else {
                let message = format!("No solution for sketch variable with id {}", var_id.0);
                debug_assert!(false, "{}", &message);
                return Err(KclError::new_internal(KclErrorDetails::new(
                    message,
                    source_ranges.to_vec(),
                )));
            };
            let freedom = if solve_outcome.unsatisfied.contains(&var_id.0) {
                Some(Freedom::Conflict)
            } else if let Some(analysis) = analysis {
                let solver_var_id = var_id.to_constraint_id(source_ranges.first().copied().unwrap_or_default())?;
                if analysis.underconstrained.contains(&solver_var_id) {
                    Some(Freedom::Free)
                } else {
                    Some(Freedom::Fixed)
                }
            } else {
                // We didn't do the freedom analysis, so we don't know.
                None
            };
            Ok((TyF64::new(*solution, solution_ty), freedom))
        }
    }
}

pub(crate) struct Solved {
    /// Which constraints couldn't be satisfied
    pub(crate) unsatisfied: Vec<usize>,
    /// Each variable's final value.
    pub(crate) final_values: Vec<f64>,
    /// How many iterations of Newton's method were required?
    #[expect(dead_code, reason = "ezpz provides this info, but we aren't using it yet")]
    pub(crate) iterations: usize,
    /// Anything that went wrong either in problem definition or during solving it.
    pub(crate) warnings: Vec<Warning>,
    /// What is the lowest priority that got solved?
    /// 0 is the highest priority. Larger numbers are lower priority.
    #[expect(dead_code, reason = "ezpz provides this info, but we aren't using it yet")]
    pub(crate) priority_solved: u32,
}

impl From<kcl_ezpz::SolveOutcome> for Solved {
    fn from(value: kcl_ezpz::SolveOutcome) -> Self {
        Self {
            unsatisfied: value.unsatisfied().to_owned(),
            final_values: value.final_values().to_owned(),
            iterations: value.iterations(),
            warnings: value.warnings().to_owned(),
            priority_solved: value.priority_solved(),
        }
    }
}

/// Create the freedom for a 2D point by merging two optional `Freedom` values.
/// None represents unknown. If both are Some, merges them using
/// [`Freedom::merge`]. If one is None, returns the other *only if* it's not
/// `Fixed`. We don't want to communicate that a point is well-constrained if we
/// don't actually know.
fn point_freedom(x: Option<Freedom>, y: Option<Freedom>) -> Option<Freedom> {
    match (x, y) {
        (Some(x), Some(y)) => Some(x.merge(y)),
        (Some(f), None) | (None, Some(f)) => match f {
            Freedom::Fixed => None,
            Freedom::Conflict | Freedom::Free => Some(f),
        },
        (None, None) => None,
    }
}

#[cfg(not(feature = "artifact-graph"))]
pub(super) fn create_segment_scene_objects(
    _segments: &[Segment],
    _sketch_block_range: SourceRange,
    _exec_state: &mut ExecState,
) -> Result<Vec<Object>, KclError> {
    Ok(Vec::new())
}

#[cfg(feature = "artifact-graph")]
pub(super) fn create_segment_scene_objects(
    segments: &[Segment],
    sketch_block_range: SourceRange,
    exec_state: &mut ExecState,
) -> Result<Vec<Object>, KclError> {
    let mut scene_objects = Vec::with_capacity(segments.len());
    for segment in segments {
        let source = Metadata::to_source_ref(&segment.meta);

        match &segment.kind {
            SegmentKind::Point {
                position,
                ctor,
                freedom,
            } => {
                let point2d = TyF64::to_point2d(position).map_err(|_| {
                    KclError::new_internal(KclErrorDetails::new(
                        format!("Error converting start point runtime type to API value: {:?}", position),
                        vec![sketch_block_range],
                    ))
                })?;
                let artifact_id = exec_state.next_artifact_id();
                let point_object = Object {
                    id: segment.object_id,
                    kind: ObjectKind::Segment {
                        segment: crate::front::Segment::Point(crate::front::Point {
                            position: point2d.clone(),
                            ctor: Some(crate::front::PointCtor {
                                position: ctor.position.clone(),
                            }),
                            owner: None,
                            freedom: *freedom,
                            constraints: Vec::new(),
                        }),
                    },
                    label: Default::default(),
                    comments: Default::default(),
                    artifact_id,
                    source: source.clone(),
                };
                scene_objects.push(point_object);
            }
            SegmentKind::Line {
                start,
                end,
                ctor,
                start_object_id,
                end_object_id,
                start_freedom,
                end_freedom,
            } => {
                let start_point2d = TyF64::to_point2d(start).map_err(|_| {
                    KclError::new_internal(KclErrorDetails::new(
                        format!("Error converting start point runtime type to API value: {:?}", start),
                        vec![sketch_block_range],
                    ))
                })?;
                let start_artifact_id = exec_state.next_artifact_id();
                let start_point_object = Object {
                    id: *start_object_id,
                    kind: ObjectKind::Segment {
                        segment: crate::front::Segment::Point(crate::front::Point {
                            position: start_point2d.clone(),
                            ctor: None,
                            owner: Some(segment.object_id),
                            freedom: *start_freedom,
                            constraints: Vec::new(),
                        }),
                    },
                    label: Default::default(),
                    comments: Default::default(),
                    artifact_id: start_artifact_id,
                    source: source.clone(),
                };
                let start_point_object_id = start_point_object.id;
                scene_objects.push(start_point_object);

                let end_point2d = TyF64::to_point2d(end).map_err(|_| {
                    KclError::new_internal(KclErrorDetails::new(
                        format!("Error converting end point runtime type to API value: {:?}", end),
                        vec![sketch_block_range],
                    ))
                })?;
                let end_artifact_id = exec_state.next_artifact_id();
                let end_point_object = Object {
                    id: *end_object_id,
                    kind: ObjectKind::Segment {
                        segment: crate::front::Segment::Point(crate::front::Point {
                            position: end_point2d.clone(),
                            ctor: None,
                            owner: Some(segment.object_id),
                            freedom: *end_freedom,
                            constraints: Vec::new(),
                        }),
                    },
                    label: Default::default(),
                    comments: Default::default(),
                    artifact_id: end_artifact_id,
                    source: source.clone(),
                };
                let end_point_object_id = end_point_object.id;
                scene_objects.push(end_point_object);

                let line_artifact_id = exec_state.next_artifact_id();
                let segment_object = Object {
                    id: segment.object_id,
                    kind: ObjectKind::Segment {
                        segment: crate::front::Segment::Line(crate::front::Line {
                            start: start_point_object_id,
                            end: end_point_object_id,
                            ctor: crate::front::SegmentCtor::Line(ctor.as_ref().clone()),
                            ctor_applicable: true,
                        }),
                    },
                    label: Default::default(),
                    comments: Default::default(),
                    artifact_id: line_artifact_id,
                    source,
                };
                scene_objects.push(segment_object);
            }
            SegmentKind::Arc {
                start,
                end,
                center,
                ctor,
                start_object_id,
                end_object_id,
                center_object_id,
                start_freedom,
                end_freedom,
                center_freedom,
            } => {
                let start_point2d = TyF64::to_point2d(start).map_err(|_| {
                    KclError::new_internal(KclErrorDetails::new(
                        format!("Error converting start point runtime type to API value: {:?}", start),
                        vec![sketch_block_range],
                    ))
                })?;
                let start_artifact_id = exec_state.next_artifact_id();
                let start_point_object = Object {
                    id: *start_object_id,
                    kind: ObjectKind::Segment {
                        segment: crate::front::Segment::Point(crate::front::Point {
                            position: start_point2d.clone(),
                            ctor: None,
                            owner: Some(segment.object_id),
                            freedom: *start_freedom,
                            constraints: Vec::new(),
                        }),
                    },
                    label: Default::default(),
                    comments: Default::default(),
                    artifact_id: start_artifact_id,
                    source: source.clone(),
                };
                let start_point_object_id = start_point_object.id;
                scene_objects.push(start_point_object);

                let end_point2d = TyF64::to_point2d(end).map_err(|_| {
                    KclError::new_internal(KclErrorDetails::new(
                        format!("Error converting end point runtime type to API value: {:?}", end),
                        vec![sketch_block_range],
                    ))
                })?;
                let end_artifact_id = exec_state.next_artifact_id();
                let end_point_object = Object {
                    id: *end_object_id,
                    kind: ObjectKind::Segment {
                        segment: crate::front::Segment::Point(crate::front::Point {
                            position: end_point2d.clone(),
                            ctor: None,
                            owner: Some(segment.object_id),
                            freedom: *end_freedom,
                            constraints: Vec::new(),
                        }),
                    },
                    label: Default::default(),
                    comments: Default::default(),
                    artifact_id: end_artifact_id,
                    source: source.clone(),
                };
                let end_point_object_id = end_point_object.id;
                scene_objects.push(end_point_object);

                let center_point2d = TyF64::to_point2d(center).map_err(|_| {
                    KclError::new_internal(KclErrorDetails::new(
                        format!("Error converting center point runtime type to API value: {:?}", center),
                        vec![sketch_block_range],
                    ))
                })?;
                let center_artifact_id = exec_state.next_artifact_id();
                let center_point_object = Object {
                    id: *center_object_id,
                    kind: ObjectKind::Segment {
                        segment: crate::front::Segment::Point(crate::front::Point {
                            position: center_point2d.clone(),
                            ctor: None,
                            owner: Some(segment.object_id),
                            freedom: *center_freedom,
                            constraints: Vec::new(),
                        }),
                    },
                    label: Default::default(),
                    comments: Default::default(),
                    artifact_id: center_artifact_id,
                    source: source.clone(),
                };
                let center_point_object_id = center_point_object.id;
                scene_objects.push(center_point_object);

                let arc_artifact_id = exec_state.next_artifact_id();
                let segment_object = Object {
                    id: segment.object_id,
                    kind: ObjectKind::Segment {
                        segment: crate::front::Segment::Arc(crate::front::Arc {
                            start: start_point_object_id,
                            end: end_point_object_id,
                            center: center_point_object_id,
                            ctor: crate::front::SegmentCtor::Arc(ctor.as_ref().clone()),
                            ctor_applicable: true,
                        }),
                    },
                    label: Default::default(),
                    comments: Default::default(),
                    artifact_id: arc_artifact_id,
                    source,
                };
                scene_objects.push(segment_object);
            }
        }
    }
    Ok(scene_objects)
}
