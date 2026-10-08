//! Code-authored continuous spatial paths, without a sketch plane or solver.

use kcl_api::artifact::Artifact;
use kcl_api::artifact::CodeRef;
use kcl_api::artifact::Path;
use kcl_api::artifact::PathSubType;
use kittycad_modeling_cmds::ModelingCmd;
use kittycad_modeling_cmds::each_cmd as mcmd;
use kittycad_modeling_cmds::length_unit::LengthUnit;
use kittycad_modeling_cmds::shared::PathSegment;
use kittycad_modeling_cmds::shared::Point3d;
use kittycad_modeling_cmds::websocket::ModelingCmdReq;

use crate::SourceRange;
use crate::errors::KclError;
use crate::errors::KclErrorDetails;
use crate::execution::ExecState;
use crate::execution::KclValue;
use crate::execution::ModelingCmdMeta;
use crate::execution::Path3d;
use crate::execution::types::RuntimeType;
use crate::std::Args;
use crate::std::args::TyF64;

const POINT_TOLERANCE_MM: f64 = 1.0e-8;

fn argument_error(message: &str, range: SourceRange) -> KclError {
    KclError::new_argument(KclErrorDetails::new(message.to_owned(), vec![range]))
}

fn point_mm(point: [TyF64; 3], range: SourceRange) -> Result<[f64; 3], KclError> {
    let point = point.map(|v| v.unwrap_to_mm());
    if !point.iter().all(|v| v.is_finite()) {
        return Err(argument_error("3D path coordinates must be finite lengths.", range));
    }
    Ok(point)
}

fn engine_point([x, y, z]: [f64; 3]) -> Point3d<LengthUnit> {
    Point3d {
        x: LengthUnit(x),
        y: LengthUnit(y),
        z: LengthUnit(z),
    }
}

fn delta(a: [f64; 3], b: [f64; 3]) -> [f64; 3] {
    std::array::from_fn(|i| a[i] - b[i])
}

fn length(v: [f64; 3]) -> f64 {
    libm::hypot(libm::hypot(v[0], v[1]), v[2])
}

fn validate_arc(start: [f64; 3], interior: [f64; 3], end: [f64; 3], range: SourceRange) -> Result<(), KclError> {
    let a = delta(interior, start);
    let b = delta(end, start);
    let a_len = length(a);
    let b_len = length(b);
    if a_len <= POINT_TOLERANCE_MM || b_len <= POINT_TOLERANCE_MM || length(delta(end, interior)) <= POINT_TOLERANCE_MM
    {
        return Err(argument_error("arc3d requires three distinct points.", range));
    }
    let a = a.map(|v| v / a_len);
    let b = b.map(|v| v / b_len);
    let cross = [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ];
    if !a_len.is_finite() || !b_len.is_finite() || length(cross) <= 1.0e-8 {
        return Err(argument_error(
            "arc3d requires non-collinear points that define a circular arc.",
            range,
        ));
    }
    Ok(())
}

fn dot(a: [f64; 3], b: [f64; 3]) -> f64 {
    a.iter().zip(b).map(|(a, b)| a * b).sum()
}

fn cross(a: [f64; 3], b: [f64; 3]) -> [f64; 3] {
    [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ]
}

fn unit(v: [f64; 3], range: SourceRange) -> Result<[f64; 3], KclError> {
    let len = length(v);
    if !len.is_finite() || len <= POINT_TOLERANCE_MM {
        return Err(argument_error(
            "The 3D arc cannot be represented with finite coordinates.",
            range,
        ));
    }
    Ok(v.map(|v| v / len))
}

/// Use the ordered three-point circle's normal to preserve major-arc traversal.
fn arc_end_tangent(
    start: [f64; 3],
    interior: [f64; 3],
    end: [f64; 3],
    range: SourceRange,
) -> Result<[f64; 3], KclError> {
    let a = delta(interior, start);
    let b = delta(end, start);
    let u = unit(a, range)?;
    let b_len = length(b);
    let b_unit = b.map(|v| v / b_len);
    let normal = unit(cross(u, b_unit), range)?;
    let v = cross(normal, u);
    let x = dot(b_unit, u);
    let y = dot(b_unit, v);
    let cx = length(a) / 2.0;
    let cy = (b_len / 2.0 - cx * x) / y;
    let radius = std::array::from_fn(|i| b[i] - cx * u[i] - cy * v[i]);
    Ok(cross(normal, unit(radius, range)?))
}

fn tangent_arc(
    start: [f64; 3],
    tangent: [f64; 3],
    end: [f64; 3],
    range: SourceRange,
) -> Result<([f64; 3], [f64; 3]), KclError> {
    let chord = delta(end, start);
    let chord_len = length(chord);
    if !chord_len.is_finite() || !end.iter().all(|v| v.is_finite()) {
        return Err(argument_error("3D path coordinates must be finite lengths.", range));
    }
    if chord_len <= POINT_TOLERANCE_MM {
        return Err(argument_error(
            "tangentialArc3d requires an endpoint different from the current path position.",
            range,
        ));
    }
    let chord_unit = chord.map(|v| v / chord_len);
    let cos_half = dot(chord_unit, tangent).clamp(-1.0, 1.0);
    let perpendicular = std::array::from_fn(|i| chord_unit[i] - tangent[i] * cos_half);
    let sin_half = length(perpendicular);
    if sin_half <= 1.0e-8 {
        return Err(argument_error(
            "tangentialArc3d requires an endpoint off the preceding tangent line. Use line3d for a straight continuation.",
            range,
        ));
    }
    let v = perpendicular.map(|v| v / sin_half);
    // Rationalize 1 - cos(theta/2) for shallow bends. A negative cosine
    // selects the major arc, whose halfway point lies beyond the endpoint.
    let sideways = if cos_half >= 0.0 {
        (chord_len / 2.0) * sin_half / (1.0 + cos_half)
    } else {
        (chord_len / 2.0) * (1.0 - cos_half) / sin_half
    };
    let interior = std::array::from_fn(|i| start[i] + tangent[i] * (chord_len / 2.0) + v[i] * sideways);
    if !interior.iter().all(|v| v.is_finite()) {
        return Err(argument_error(
            "The 3D arc cannot be represented with finite coordinates.",
            range,
        ));
    }
    validate_arc(start, interior, end, range)?;
    let cos_angle = cos_half * cos_half - sin_half * sin_half;
    let sin_angle = 2.0 * cos_half * sin_half;
    let end_tangent = unit(
        std::array::from_fn(|i| tangent[i] * cos_angle + v[i] * sin_angle),
        range,
    )?;
    Ok((interior, end_tangent))
}

struct CornerFillet {
    entry: [f64; 3],
    interior: [f64; 3],
    exit: [f64; 3],
    incoming: [f64; 3],
    outgoing: [f64; 3],
}

/// Construct the whole corner before emitting any commands. Both straight
/// portions must remain nonzero, and the arc must fit on both finite legs.
fn corner_fillet(
    start: [f64; 3],
    corner: [f64; 3],
    end: [f64; 3],
    radius: f64,
    range: SourceRange,
) -> Result<CornerFillet, KclError> {
    if !radius.is_finite() || radius <= POINT_TOLERANCE_MM {
        return Err(argument_error(
            "fillet3d requires a finite positive radius greater than the path tolerance.",
            range,
        ));
    }
    let a = delta(corner, start);
    let b = delta(end, corner);
    let a_len = length(a);
    let b_len = length(b);
    if !a_len.is_finite() || !b_len.is_finite() || !corner.iter().chain(end.iter()).all(|v| v.is_finite()) {
        return Err(argument_error("3D path coordinates must be finite lengths.", range));
    }
    if a_len <= POINT_TOLERANCE_MM || b_len <= POINT_TOLERANCE_MM {
        return Err(argument_error("fillet3d requires two nonzero corner legs.", range));
    }
    let incoming = a.map(|v| v / a_len);
    let outgoing = b.map(|v| v / b_len);
    let cosine = dot(incoming, outgoing).clamp(-1.0, 1.0);
    let sine = length(cross(incoming, outgoing));
    if sine <= 1.0e-8 {
        return Err(argument_error(
            "fillet3d requires a non-collinear corner, not a straight continuation or reversal.",
            range,
        ));
    }
    // Stable tan(turn/2), including turns approaching 180 degrees.
    let tan_half = if cosine >= 0.0 {
        sine / (1.0 + cosine)
    } else {
        (1.0 - cosine) / sine
    };
    let setback = radius * tan_half;
    if !setback.is_finite() || a_len - setback <= POINT_TOLERANCE_MM || b_len - setback <= POINT_TOLERANCE_MM {
        return Err(argument_error(
            "fillet3d radius must leave a nonzero straight portion on both corner legs.",
            range,
        ));
    }
    let entry = std::array::from_fn(|i| corner[i] - setback * incoming[i]);
    let exit = std::array::from_fn(|i| corner[i] + setback * outgoing[i]);
    let (interior, _) = tangent_arc(entry, incoming, exit, range)?;
    // World-coordinate rounding must not collapse either straight segment.
    if length(delta(entry, start)) <= POINT_TOLERANCE_MM || length(delta(end, exit)) <= POINT_TOLERANCE_MM {
        return Err(argument_error(
            "The corner fillet cannot be represented with distinct tangent points.",
            range,
        ));
    }
    Ok(CornerFillet {
        entry,
        interior,
        exit,
        incoming,
        outgoing,
    })
}

/// Plan every cut before creating the replacement path. Adjacent fillets must
/// leave a positive straight portion on their shared segment.
struct PlannedSegment {
    end: [f64; 3],
    tangent: [f64; 3],
    segment: PathSegment,
}

fn fillet_polyline(path: &Path3d, radius: f64, range: SourceRange) -> Result<Vec<PlannedSegment>, KclError> {
    if !radius.is_finite() || radius <= POINT_TOLERANCE_MM {
        return Err(argument_error(
            "fillet3d requires a finite positive radius greater than the path tolerance.",
            range,
        ));
    }
    if path.segments.len() < 2 {
        return Err(argument_error(
            "fillet3d requires at least two straight line segments.",
            range,
        ));
    }
    let mut points = vec![path.start];
    for segment in &path.segments {
        let PathSegment::Line { end, relative: false } = segment else {
            return Err(argument_error(
                "fillet3d currently accepts only straight line routes. Apply it before adding arcs.",
                range,
            ));
        };
        points.push([end.x.0, end.y.0, end.z.0]);
    }
    if length(delta(*points.last().unwrap_or(&path.start), path.start)) <= POINT_TOLERANCE_MM {
        return Err(argument_error("fillet3d currently requires an open route.", range));
    }
    let mut corners = Vec::new();
    for points in points.windows(3) {
        let incoming = unit(delta(points[1], points[0]), range)?;
        let outgoing = unit(delta(points[2], points[1]), range)?;
        // Redundant vertices on a straight continuation need no fillet.
        if length(cross(incoming, outgoing)) <= 1.0e-8 && dot(incoming, outgoing) > 0.0 {
            corners.push(None);
        } else {
            corners.push(Some(corner_fillet(points[0], points[1], points[2], radius, range)?));
        }
    }
    let mut segments = Vec::new();
    let mut current = path.start;
    for (i, corner) in corners.iter().enumerate() {
        let (entry, exit) = match corner {
            Some(corner) => (corner.entry, corner.exit),
            None => (points[i + 1], points[i + 1]),
        };
        let direction = match corner {
            Some(corner) => corner.incoming,
            None => unit(delta(points[i + 1], points[i]), range)?,
        };
        if dot(delta(entry, current), direction) <= POINT_TOLERANCE_MM {
            return Err(argument_error(
                "fillet3d radius causes adjacent corner cuts to overlap or consume a straight segment.",
                range,
            ));
        }
        segments.push(PlannedSegment {
            end: entry,
            tangent: direction,
            segment: PathSegment::Line {
                end: engine_point(entry),
                relative: false,
            },
        });
        if let Some(corner) = corner {
            segments.push(PlannedSegment {
                end: exit,
                tangent: corner.outgoing,
                segment: PathSegment::ArcTo {
                    interior: engine_point(corner.interior),
                    end: engine_point(exit),
                    relative: false,
                },
            });
        }
        current = exit;
    }
    let end = points[points.len() - 1];
    segments.push(PlannedSegment {
        end,
        tangent: unit(delta(end, current), range)?,
        segment: PathSegment::Line {
            end: engine_point(end),
            relative: false,
        },
    });
    Ok(segments)
}

pub async fn fillet3d(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let path: Path3d = args.get_unlabeled_kw_arg("path", &RuntimeType::path3d(), exec_state)?;
    let mut artifact = validate_current_path(&path, exec_state, args.source_range)?;
    if artifact.consumed {
        return Err(argument_error(
            "A consumed 3D path cannot be filleted.",
            args.source_range,
        ));
    }
    let radius: TyF64 = args.get_kw_arg("radius", &RuntimeType::length(), exec_state)?;
    let segments = fillet_polyline(&path, radius.unwrap_to_mm(), args.source_range)?;
    let mut rounded = new_path3d(path.start, exec_state, args.clone()).await?;
    for segment in segments {
        rounded = append_segment(
            rounded,
            segment.end,
            segment.tangent,
            segment.segment,
            exec_state,
            args.clone(),
        )
        .await?;
    }
    exec_state
        .batch_modeling_cmd(
            ModelingCmdMeta::from_args(exec_state, &args),
            ModelingCmd::from(mcmd::ObjectVisible::builder().object_id(path.id).hidden(true).build()),
        )
        .await?;
    artifact.consumed = true;
    exec_state.update_spatial_path_artifact(artifact);
    Ok(KclValue::Path3d {
        value: Box::new(rounded),
    })
}

pub async fn tangential_arc3d(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let path: Path3d = args.get_unlabeled_kw_arg("path", &RuntimeType::path3d(), exec_state)?;
    validate_current_path(&path, exec_state, args.source_range)?;
    let tangent = path
        .end_tangent
        .ok_or_else(|| argument_error("tangentialArc3d requires a preceding line or arc.", args.source_range))?;
    let relative: Option<[TyF64; 3]> = args.get_kw_arg_opt("end", &RuntimeType::point3d(), exec_state)?;
    let absolute: Option<[TyF64; 3]> = args.get_kw_arg_opt("endAbsolute", &RuntimeType::point3d(), exec_state)?;
    let end = match (relative, absolute) {
        (Some(offset), None) => {
            let offset = point_mm(offset, args.source_range)?;
            std::array::from_fn(|i| path.end[i] + offset[i])
        }
        (None, Some(end)) => point_mm(end, args.source_range)?,
        _ => {
            return Err(argument_error(
                "tangentialArc3d requires exactly one of end or endAbsolute.",
                args.source_range,
            ));
        }
    };
    let (interior, tangent) = tangent_arc(path.end, tangent, end, args.source_range)?;
    append(
        path,
        end,
        tangent,
        PathSegment::ArcTo {
            interior: engine_point(interior),
            end: engine_point(end),
            relative: false,
        },
        exec_state,
        args,
    )
    .await
}

/// Start a world-space path. Disable sketch mode before creation so a previous
/// sketch cannot supply an implicit local frame.
pub async fn start_path3d(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let at = point_mm(
        args.get_kw_arg("at", &RuntimeType::point3d(), exec_state)?,
        args.source_range,
    )?;
    Ok(KclValue::Path3d {
        value: Box::new(new_path3d(at, exec_state, args).await?),
    })
}

async fn new_path3d(at: [f64; 3], exec_state: &mut ExecState, args: Args) -> Result<Path3d, KclError> {
    let id = exec_state.next_uuid();
    let disable_id = exec_state.next_uuid();
    let move_id = exec_state.next_uuid();
    exec_state
        .batch_modeling_cmds(
            ModelingCmdMeta::new(exec_state, &args.ctx, args.source_range),
            &[
                ModelingCmdReq {
                    cmd: ModelingCmd::SketchModeDisable(mcmd::SketchModeDisable::default()),
                    cmd_id: disable_id.into(),
                },
                ModelingCmdReq {
                    cmd: ModelingCmd::from(mcmd::StartPath::default()),
                    cmd_id: id.into(),
                },
                ModelingCmdReq {
                    cmd: ModelingCmd::from(
                        mcmd::MovePathPen::builder()
                            .path(id.into())
                            .to(engine_point(at))
                            .build(),
                    ),
                    cmd_id: move_id.into(),
                },
            ],
        )
        .await?;
    exec_state.add_artifact(Artifact::Path(Path {
        id: id.into(),
        sub_type: PathSubType::Spatial,
        plane_id: None,
        seg_ids: Vec::new(),
        consumed: false,
        sweep_id: None,
        trajectory_sweep_id: None,
        solid2d_id: None,
        code_ref: CodeRef::placeholder(args.source_range),
        composite_solid_id: None,
        sketch_block_id: None,
        origin_path_id: None,
        inner_path_id: None,
        outer_path_id: None,
        pattern_ids: Vec::new(),
    }));
    Ok(Path3d {
        id,
        artifact_id: id.into(),
        start: at,
        end: at,
        segment_count: 0,
        segments: Vec::new(),
        end_tangent: None,
        meta: vec![args.source_range.into()],
    })
}

pub async fn line3d(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let path: Path3d = args.get_unlabeled_kw_arg("path", &RuntimeType::path3d(), exec_state)?;
    let relative: Option<[TyF64; 3]> = args.get_kw_arg_opt("end", &RuntimeType::point3d(), exec_state)?;
    let absolute: Option<[TyF64; 3]> = args.get_kw_arg_opt("endAbsolute", &RuntimeType::point3d(), exec_state)?;
    let end = match (relative, absolute) {
        (Some(offset), None) => {
            let offset = point_mm(offset, args.source_range)?;
            std::array::from_fn(|i| path.end[i] + offset[i])
        }
        (None, Some(end)) => point_mm(end, args.source_range)?,
        _ => {
            return Err(argument_error(
                "line3d requires exactly one of end or endAbsolute.",
                args.source_range,
            ));
        }
    };
    if !end.iter().all(|v| v.is_finite()) || !length(delta(end, path.end)).is_finite() {
        return Err(argument_error(
            "3D path coordinates must be finite lengths.",
            args.source_range,
        ));
    }
    if length(delta(end, path.end)) <= POINT_TOLERANCE_MM {
        return Err(argument_error(
            "line3d requires an endpoint different from the current path position.",
            args.source_range,
        ));
    }
    let tangent = unit(delta(end, path.end), args.source_range)?;
    append(
        path,
        end,
        tangent,
        PathSegment::Line {
            end: engine_point(end),
            relative: false,
        },
        exec_state,
        args,
    )
    .await
}

pub async fn arc3d(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let path: Path3d = args.get_unlabeled_kw_arg("path", &RuntimeType::path3d(), exec_state)?;
    let interior = point_mm(
        args.get_kw_arg("interiorAbsolute", &RuntimeType::point3d(), exec_state)?,
        args.source_range,
    )?;
    let end = point_mm(
        args.get_kw_arg("endAbsolute", &RuntimeType::point3d(), exec_state)?,
        args.source_range,
    )?;
    validate_arc(path.end, interior, end, args.source_range)?;
    let tangent = arc_end_tangent(path.end, interior, end, args.source_range)?;
    append(
        path,
        end,
        tangent,
        PathSegment::ArcTo {
            interior: engine_point(interior),
            end: engine_point(end),
            relative: false,
        },
        exec_state,
        args,
    )
    .await
}

async fn append(
    path: Path3d,
    end: [f64; 3],
    tangent: [f64; 3],
    segment: PathSegment,
    exec_state: &mut ExecState,
    args: Args,
) -> Result<KclValue, KclError> {
    Ok(KclValue::Path3d {
        value: Box::new(append_segment(path, end, tangent, segment, exec_state, args).await?),
    })
}

async fn append_segment(
    mut path: Path3d,
    end: [f64; 3],
    tangent: [f64; 3],
    segment: PathSegment,
    exec_state: &mut ExecState,
    args: Args,
) -> Result<Path3d, KclError> {
    let mut artifact = validate_current_path(&path, exec_state, args.source_range)?;
    if artifact.consumed {
        return Err(argument_error(
            "A consumed 3D path cannot be extended. Complete the route before filleting or sweeping it.",
            args.source_range,
        ));
    }
    let id = exec_state.next_uuid();
    exec_state
        .batch_modeling_cmd(
            ModelingCmdMeta::from_args_id(exec_state, &args, id),
            ModelingCmd::from(
                mcmd::ExtendPath::builder()
                    .path(path.id.into())
                    .segment(segment)
                    .build(),
            ),
        )
        .await?;
    path.end = end;
    path.end_tangent = Some(tangent);
    path.segment_count += 1;
    path.segments.push(segment);
    artifact.seg_ids.push(id.into());
    exec_state.update_spatial_path_artifact(artifact);
    Ok(path)
}

pub(super) fn validate_current_path(
    path: &Path3d,
    exec_state: &ExecState,
    range: SourceRange,
) -> Result<Path, KclError> {
    let artifact = exec_state
        .spatial_path_artifact(path.artifact_id)
        .ok_or_else(|| argument_error("The 3D path is no longer available in this execution.", range))?;
    if artifact.seg_ids.len() != path.segment_count {
        return Err(argument_error(
            "This 3D path value is out of date. Use the result of the most recent 3D path segment call.",
            range,
        ));
    }
    Ok(artifact)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::execution::parse_execute;

    // The doc harness's `norun` option executes on the engine without generating
    // images. Check the complete route and sweep without a screenshot baseline.
    #[tokio::test]
    async fn engine_customer_route_sweep() {
        crate::test_server::kcl_doc_execute_and_snapshot(include_str!("path3d_customer_route.kcl"), None, false, true)
            .await
            .unwrap();
    }

    const SETTINGS: &str = "@settings(kclVersion = 3.0, defaultLengthUnit = mm, experimentalFeatures = allow)\n";

    fn assert_point(actual: [f64; 3], expected: [f64; 3]) {
        for (actual, expected) in actual.into_iter().zip(expected) {
            assert!((actual - expected).abs() < 1.0e-9, "{actual} != {expected}");
        }
    }

    fn polyline(points: &[[f64; 3]]) -> Path3d {
        let segments: Vec<_> = points
            .iter()
            .skip(1)
            .map(|point| PathSegment::Line {
                end: engine_point(*point),
                relative: false,
            })
            .collect();
        Path3d {
            id: uuid::Uuid::nil(),
            artifact_id: uuid::Uuid::nil().into(),
            start: points[0],
            end: points[points.len() - 1],
            segment_count: segments.len(),
            segments,
            end_tangent: None,
            meta: Vec::new(),
        }
    }

    #[test]
    fn fillet_polyline_rebuilds_all_corners_with_continuous_tangents() {
        let points = [
            [0.0, 0.0, 0.0],
            [0.0, 0.0, 60.0],
            [70.0, 0.0, 60.0],
            [70.0, 70.0, 100.0],
            [-30.0, 70.0, 100.0],
            [-30.0, -30.0, 140.0],
            [50.0, -30.0, 180.0],
            [50.0, 50.0, 210.0],
            [-10.0, 50.0, 250.0],
            [-10.0, -10.0, 280.0],
        ];
        let raw = polyline(&points);
        let planned = fillet_polyline(&raw, 8.0, SourceRange::default()).unwrap();
        assert_eq!(planned.len(), 17);
        assert_eq!(raw.segments.len(), 9);
        let mut start = raw.start;
        let mut previous_tangent = None;
        for (i, planned) in planned.iter().enumerate() {
            let (start_tangent, end_tangent) = match planned.segment {
                PathSegment::Line { .. } => {
                    assert_eq!(i % 2, 0);
                    let tangent = unit(delta(planned.end, start), SourceRange::default()).unwrap();
                    (tangent, tangent)
                }
                PathSegment::ArcTo { interior, .. } => {
                    assert_eq!(i % 2, 1);
                    let interior = [interior.x.0, interior.y.0, interior.z.0];
                    (
                        arc_end_tangent(planned.end, interior, start, SourceRange::default())
                            .unwrap()
                            .map(|v| -v),
                        arc_end_tangent(start, interior, planned.end, SourceRange::default()).unwrap(),
                    )
                }
                _ => panic!("unexpected route segment"),
            };
            if let Some(previous) = previous_tangent {
                assert_point(start_tangent, previous);
            }
            assert_point(end_tangent, planned.tangent);
            previous_tangent = Some(end_tangent);
            start = planned.end;
        }
        assert_point(start, raw.end);
    }

    #[test]
    fn fillet_polyline_rejects_overlapping_cuts_and_keeps_straight_vertices() {
        for shared_length in [15.0, 20.0] {
            let raw = polyline(&[
                [0.0; 3],
                [0.0, 0.0, 60.0],
                [0.0, shared_length, 60.0],
                [30.0, shared_length, 60.0],
            ]);
            let error = fillet_polyline(&raw, 10.0, SourceRange::default()).err().unwrap();
            assert!(error.to_string().contains("overlap"), "{error}");
            assert_eq!(fillet_polyline(&raw, 7.0, SourceRange::default()).unwrap().len(), 5);
        }
        let raw = polyline(&[[0.0; 3], [0.0, 0.0, 30.0], [0.0, 0.0, 60.0]]);
        let planned = fillet_polyline(&raw, 10.0, SourceRange::default()).unwrap();
        assert_eq!(planned.len(), 2);
        assert!(planned.iter().all(|p| matches!(p.segment, PathSegment::Line { .. })));
    }

    #[tokio::test]
    async fn fillet_consumes_and_hides_input_but_returned_route_can_extend() {
        let mut result = parse_execute(&format!(
            "{SETTINGS}
raw = startPath3d(at = [0mm, 0mm, 0mm])
  |> line3d(endAbsolute = [0mm, 0mm, 60mm])
  |> line3d(endAbsolute = [0mm, 25mm, 60mm])
rounded = raw |> fillet3d(radius = 10mm)
route = rounded |> line3d(end = [0mm, 5mm, 0mm])
"
        ))
        .await
        .unwrap();
        let KclValue::Path3d { value: raw } = result.variable("raw") else {
            panic!("expected input path")
        };
        let KclValue::Path3d { value: route } = result.variable("route") else {
            panic!("expected rounded path")
        };
        assert_ne!(raw.id, route.id);
        assert_eq!(route.segments.len(), 4);
        assert_point(route.end, [0.0, 30.0, 60.0]);
        let hidden: Vec<_> = result
            .root_module_artifact_commands()
            .iter()
            .filter_map(|c| match &c.command {
                ModelingCmd::ObjectVisible(c) if c.hidden => Some(c.object_id),
                _ => None,
            })
            .collect();
        assert!(hidden.contains(&raw.id));
        let graph = result.artifact_graph().await.unwrap();
        let Some(Artifact::Path(raw_artifact)) = graph.get(&raw.artifact_id) else {
            panic!("missing input path")
        };
        assert!(raw_artifact.consumed);
        let Some(Artifact::Path(route_artifact)) = graph.get(&route.artifact_id) else {
            panic!("missing rounded path")
        };
        assert!(!route_artifact.consumed);
        assert_eq!(route_artifact.seg_ids.len(), 4);
        let code = format!(
            "{SETTINGS}raw = startPath3d(at = [0mm, 0mm, 0mm]) |> line3d(endAbsolute = [0mm, 0mm, 60mm]) |> line3d(endAbsolute = [0mm, 25mm, 60mm])\nrounded = raw |> fillet3d(radius = 10mm)\n"
        );
        for operation in ["line3d(end = [0mm, 5mm, 0mm])", "fillet3d(radius = 5mm)"] {
            let error = parse_execute(&format!("{code}raw |> {operation}\n")).await.unwrap_err();
            assert!(error.to_string().contains("consumed"), "{error}");
        }
    }

    #[tokio::test]
    async fn fillet_rejects_incomplete_arc_and_reversing_routes() {
        for (route, expected) in [
            ("", "at least two"),
            (" |> line3d(end = [0mm, 0mm, 60mm])", "at least two"),
            (
                " |> line3d(end = [0mm, 0mm, 60mm]) |> tangentialArc3d(end = [0mm, 10mm, 10mm])",
                "only straight line",
            ),
            (
                " |> line3d(end = [0mm, 0mm, 60mm]) |> line3d(endAbsolute = [0mm, 0mm, 20mm])",
                "non-collinear",
            ),
        ] {
            let error = parse_execute(&format!(
                "{SETTINGS}startPath3d(at = [0mm, 0mm, 0mm]){route} |> fillet3d(radius = 10mm)\n"
            ))
            .await
            .unwrap_err();
            assert!(error.to_string().contains(expected), "{error}");
        }
    }

    fn assert_corner_tangency(start: [f64; 3], corner: [f64; 3], end: [f64; 3], radius: f64) -> CornerFillet {
        let fillet = corner_fillet(start, corner, end, radius, SourceRange::default()).unwrap();
        let normal = unit(cross(fillet.incoming, fillet.outgoing), SourceRange::default()).unwrap();
        let radial = cross(normal, fillet.incoming);
        let center = std::array::from_fn(|i| fillet.entry[i] + radius * radial[i]);
        for point in [fillet.entry, fillet.interior, fillet.exit] {
            assert!((length(delta(point, center)) - radius).abs() < 1.0e-8);
        }
        assert!(dot(delta(fillet.entry, center), fillet.incoming).abs() < 1.0e-8);
        assert!(dot(delta(fillet.exit, center), fillet.outgoing).abs() < 1.0e-8);
        assert_point(
            arc_end_tangent(fillet.exit, fillet.interior, fillet.entry, SourceRange::default()).unwrap(),
            fillet.incoming.map(|v| -v),
        );
        assert_point(
            arc_end_tangent(fillet.entry, fillet.interior, fillet.exit, SourceRange::default()).unwrap(),
            fillet.outgoing,
        );
        assert_point(
            unit(delta(fillet.entry, start), SourceRange::default()).unwrap(),
            fillet.incoming,
        );
        assert_point(
            unit(delta(end, fillet.exit), SourceRange::default()).unwrap(),
            fillet.outgoing,
        );
        fillet
    }

    #[test]
    fn corner_fillet_recomputes_both_joins_when_endpoint_moves() {
        let start = [0.0, 0.0, 0.0];
        let corner = [0.0, 0.0, 60.0];
        let original = assert_corner_tangency(start, corner, [0.0, 25.0, 60.0], 10.0);
        assert_point(original.entry, [0.0, 0.0, 50.0]);
        assert_point(original.exit, [0.0, 10.0, 60.0]);
        let moved = assert_corner_tangency(start, corner, [15.0, 25.0, 65.0], 10.0);
        assert_ne!(original.entry, moved.entry);
        assert_ne!(original.exit, moved.exit);
    }

    #[test]
    fn corner_fillet_supports_rotated_acute_and_obtuse_corners() {
        let u = [1.0 / libm::sqrt(2.0), 1.0 / libm::sqrt(2.0), 0.0];
        let corner = [17.0, -23.0, 31.0];
        let start = std::array::from_fn(|i| corner[i] - 100.0 * u[i]);
        for angle in [30.0_f64, 90.0, 150.0] {
            let angle = angle.to_radians();
            let v = [u[0] * libm::cos(angle), u[1] * libm::cos(angle), libm::sin(angle)];
            let end = std::array::from_fn(|i| corner[i] + 100.0 * v[i]);
            assert_corner_tangency(start, corner, end, 2.0);
        }
    }

    #[test]
    fn corner_fillet_rejects_nonfinite_geometry() {
        for radius in [f64::NAN, f64::INFINITY, 0.0, -1.0] {
            assert!(
                corner_fillet(
                    [0.0; 3],
                    [0.0, 0.0, 60.0],
                    [0.0, 25.0, 60.0],
                    radius,
                    SourceRange::default()
                )
                .is_err()
            );
        }
        for end in [[0.0, f64::INFINITY, 60.0], [f64::NAN, 25.0, 60.0]] {
            assert!(corner_fillet([0.0; 3], [0.0, 0.0, 60.0], end, 10.0, SourceRange::default()).is_err());
        }
    }

    #[tokio::test]
    async fn corner_fillet_pipeline_units_artifacts_and_following_arc() {
        let mut result = parse_execute(&format!(
            "{SETTINGS}
base = startPath3d(at = [0mm, 0mm, 0mm])
  |> line3d(endAbsolute = [0mm, 0mm, 100mm])
  |> line3d(endAbsolute = [0mm, 100mm, 100mm])
  |> fillet3d(radius = 1in)
route = base |> tangentialArc3d(end = [10mm, 10mm, 0mm])
"
        ))
        .await
        .unwrap();
        let KclValue::Path3d { value } = result.variable("route") else {
            panic!("expected Path3d")
        };
        assert_eq!(value.segment_count, 4);
        assert_point(value.end, [10.0, 110.0, 100.0]);
        assert_point(value.end_tangent.unwrap(), [1.0, 0.0, 0.0]);
        let segments: Vec<_> = result
            .root_module_artifact_commands()
            .iter()
            .filter_map(|c| match &c.command {
                ModelingCmd::ExtendPath(c) if c.path.as_ref() == &value.id => Some(c.segment),
                _ => None,
            })
            .collect();
        assert_eq!(
            segments[0],
            PathSegment::Line {
                end: engine_point([0.0, 0.0, 74.6]),
                relative: false
            }
        );
        let PathSegment::ArcTo {
            interior,
            end,
            relative,
        } = &segments[1]
        else {
            panic!("expected corner arc")
        };
        assert!(!*relative);
        assert_point([end.x.0, end.y.0, end.z.0], [0.0, 25.4, 100.0]);
        let diagonal = 25.4 / libm::sqrt(2.0);
        assert_point(
            [interior.x.0, interior.y.0, interior.z.0],
            [0.0, 25.4 - diagonal, 74.6 + diagonal],
        );
        assert_eq!(
            segments[2],
            PathSegment::Line {
                end: engine_point([0.0, 100.0, 100.0]),
                relative: false
            }
        );
        let graph = result.artifact_graph().await.unwrap();
        let Some(Artifact::Path(path)) = graph.get(&value.artifact_id) else {
            panic!("missing spatial path")
        };
        assert_eq!(path.seg_ids.len(), 4);
        assert_eq!(path.plane_id, None);
    }

    #[tokio::test]
    async fn corner_fillet_rejects_invalid_corners_stale_and_swept_paths() {
        for (corner, end, radius, expected) in [
            ("[0mm, 0mm, 0mm]", "[0mm, 25mm, 60mm]", "10mm", "endpoint different"),
            ("[0mm, 0mm, 60mm]", "[0mm, 0mm, 60mm]", "10mm", "endpoint different"),
            ("[0mm, 0mm, 60mm]", "[0mm, 0mm, 0mm]", "10mm", "open route"),
            ("[0mm, 0mm, 60mm]", "[0mm, 25mm, 60mm]", "0mm", "positive radius"),
            ("[0mm, 0mm, 60mm]", "[0mm, 25mm, 60mm]", "-1mm", "positive radius"),
            ("[0mm, 0mm, 60mm]", "[0mm, 25mm, 60mm]", "25mm", "both corner legs"),
            ("[0mm, 0mm, 5mm]", "[0mm, 25mm, 5mm]", "10mm", "both corner legs"),
        ] {
            let error = parse_execute(&format!("{SETTINGS}startPath3d(at = [0mm, 0mm, 0mm]) |> line3d(endAbsolute = {corner}) |> line3d(endAbsolute = {end}) |> fillet3d(radius = {radius})\n")).await.unwrap_err();
            assert!(error.to_string().contains(expected), "{error}");
        }
        let error = parse_execute(&format!(
            "{SETTINGS}
base = startPath3d(at = [0mm, 0mm, 0mm])
route = base |> line3d(endAbsolute = [0mm, 0mm, 60mm]) |> line3d(endAbsolute = [0mm, 25mm, 60mm]) |> fillet3d(radius = 10mm)
base |> line3d(end = [0mm, 0mm, 1mm])
"
        ))
        .await
        .unwrap_err();
        assert!(error.to_string().contains("out of date"), "{error}");
        let error = parse_execute(&format!(
            "{}\nroute |> fillet3d(radius = 5mm)\n",
            include_str!("path3d_fillet_corner.kcl")
        ))
        .await
        .unwrap_err();
        assert!(error.to_string().contains("cannot be filleted"), "{error}");
    }

    #[tokio::test]
    async fn engine_corner_fillet_sweeps_before_and_after_endpoint_edit() {
        let code = include_str!("path3d_fillet_corner.kcl");
        for code in [code.to_owned(), code.replace("[15mm, 25mm, 65mm]", "[0mm, 25mm, 60mm]")] {
            crate::test_server::kcl_doc_execute_and_snapshot(&code, None, false, true)
                .await
                .unwrap();
        }
    }

    #[tokio::test]
    async fn tangent_arcs_chain_across_planes_and_units() {
        let result = parse_execute(&format!(
            "{SETTINGS}
route = startPath3d(at = [0mm, 0mm, 0mm])
  |> line3d(end = [0mm, 0mm, 1in])
  |> tangentialArc3d(end = [0mm, 10mm, 10mm])
  |> tangentialArc3d(endAbsolute = [10mm, 20mm, 35.4mm])
"
        ))
        .await
        .unwrap();
        let KclValue::Path3d { value } = result.variable("route") else {
            panic!("expected Path3d")
        };
        assert_point(value.end, [10.0, 20.0, 35.4]);
        assert_point(value.end_tangent.unwrap(), [1.0, 0.0, 0.0]);
        assert_eq!(value.segment_count, 3);
        let arcs: Vec<_> = result
            .root_module_artifact_commands()
            .iter()
            .filter_map(|c| match &c.command {
                ModelingCmd::ExtendPath(c) => match &c.segment {
                    PathSegment::ArcTo { interior, relative, .. } => {
                        assert!(!relative);
                        Some([interior.x.0, interior.y.0, interior.z.0])
                    }
                    _ => None,
                },
                _ => None,
            })
            .collect();
        let diagonal = 10.0 / libm::sqrt(2.0);
        assert_point(arcs[0], [0.0, 10.0 - diagonal, 25.4 + diagonal]);
        assert_point(arcs[1], [10.0 - diagonal, 10.0 + diagonal, 35.4]);
    }

    #[tokio::test]
    async fn tangent_arc_after_three_point_arc() {
        let result = parse_execute(&format!(
            "{SETTINGS}
route = startPath3d(at = [0mm, 0mm, 0mm])
  |> arc3d(interiorAbsolute = [5mm, 0mm, 5mm], endAbsolute = [10mm, 0mm, 0mm])
  |> tangentialArc3d(end = [0mm, 10mm, -10mm])
"
        ))
        .await
        .unwrap();
        let KclValue::Path3d { value } = result.variable("route") else {
            panic!("expected Path3d")
        };
        assert_point(value.end_tangent.unwrap(), [0.0, 1.0, 0.0]);
        assert_point(value.end, [10.0, 10.0, -10.0]);
    }

    #[test]
    fn tangent_arc_supports_major_arcs_and_rotated_lines() {
        let range = SourceRange::default();
        let (interior, tangent) = tangent_arc([0.0; 3], [1.0, 0.0, 0.0], [-10.0, 10.0, 0.0], range).unwrap();
        let diagonal = 10.0 / libm::sqrt(2.0);
        assert_point(interior, [diagonal, 10.0 + diagonal, 0.0]);
        assert_point(tangent, [0.0, -1.0, 0.0]);
        assert_point(
            arc_end_tangent([0.0; 3], interior, [-10.0, 10.0, 0.0], range).unwrap(),
            tangent,
        );
        // Rotating the preceding line changes the circle while retaining the endpoint.
        let unit_diagonal = 1.0 / libm::sqrt(2.0);
        let (_, tangent) = tangent_arc([0.0; 3], [unit_diagonal, unit_diagonal, 0.0], [0.0, 10.0, 0.0], range).unwrap();
        assert_point(tangent, [-unit_diagonal, unit_diagonal, 0.0]);
    }

    #[tokio::test]
    async fn rejects_invalid_tangent_arcs() {
        let cases = [
            (
                "route |> tangentialArc3d(end = [1mm, 1mm, 0mm])",
                "preceding line or arc",
            ),
            ("next |> tangentialArc3d()", "exactly one"),
            (
                "next |> tangentialArc3d(end = [1mm, 1mm, 0mm], endAbsolute = [2mm, 2mm, 0mm])",
                "exactly one",
            ),
            ("next |> tangentialArc3d(end = [0mm, 0mm, 0mm])", "endpoint different"),
            ("next |> tangentialArc3d(end = [10mm, 0mm, 0mm])", "tangent line"),
            ("next |> tangentialArc3d(end = [-10mm, 0mm, 0mm])", "tangent line"),
            ("route |> tangentialArc3d(end = [0mm, 10mm, 0mm])", "out of date"),
        ];
        for (body, expected) in cases {
            let prefix = if expected == "preceding line or arc" {
                ""
            } else {
                "next = route |> line3d(end = [10mm, 0mm, 0mm])\n"
            };
            let error = parse_execute(&format!(
                "{SETTINGS}route = startPath3d(at = [0mm, 0mm, 0mm])\n{prefix}{body}\n"
            ))
            .await
            .unwrap_err();
            assert!(error.to_string().contains(expected), "{body}: {error}");
        }
    }

    #[tokio::test]
    async fn world_coordinates_and_units() {
        let result = parse_execute(&format!(
            "{SETTINGS}
route = startPath3d(at = [1in, 2mm, 3mm])
  |> line3d(end = [1in, 0mm, 4mm])
  |> arc3d(interiorAbsolute = [60mm, 10mm, 10mm], endAbsolute = [70mm, 2mm, 20mm])
"
        ))
        .await
        .unwrap();
        let KclValue::Path3d { value } = result.variable("route") else {
            panic!("expected Path3d")
        };
        assert_eq!(value.start, [25.4, 2.0, 3.0]);
        assert_eq!(value.end, [70.0, 2.0, 20.0]);
        assert_eq!(value.segment_count, 2);
        let commands = result.root_module_artifact_commands();
        let start = commands
            .iter()
            .position(|c| matches!(c.command, ModelingCmd::StartPath(_)))
            .unwrap();
        assert!(matches!(commands[start - 1].command, ModelingCmd::SketchModeDisable(_)));
        let segments: Vec<_> = commands
            .iter()
            .filter_map(|c| match &c.command {
                ModelingCmd::ExtendPath(c) => Some(&c.segment),
                _ => None,
            })
            .collect();
        assert_eq!(
            segments,
            vec![
                &PathSegment::Line {
                    end: engine_point([50.8, 2.0, 7.0]),
                    relative: false
                },
                &PathSegment::ArcTo {
                    interior: engine_point([60.0, 10.0, 10.0]),
                    end: engine_point([70.0, 2.0, 20.0]),
                    relative: false
                },
            ]
        );
    }

    #[tokio::test]
    async fn rejects_invalid_segments_and_stale_values() {
        let cases = [
            ("route |> line3d(end = [0mm, 0mm, 0mm])", "endpoint different"),
            ("route |> line3d()", "exactly one"),
            (
                "route |> line3d(end = [1mm, 0mm, 0mm], endAbsolute = [2mm, 0mm, 0mm])",
                "exactly one",
            ),
            (
                "route |> arc3d(interiorAbsolute = [0mm, 0mm, 0mm], endAbsolute = [1mm, 1mm, 1mm])",
                "distinct points",
            ),
            (
                "route |> arc3d(interiorAbsolute = [1mm, 1mm, 1mm], endAbsolute = [0mm, 0mm, 0mm])",
                "distinct points",
            ),
            (
                "route |> arc3d(interiorAbsolute = [1mm, 1mm, 1mm], endAbsolute = [1mm, 1mm, 1mm])",
                "distinct points",
            ),
            (
                "route |> arc3d(interiorAbsolute = [1mm, 1mm, 1mm], endAbsolute = [2mm, 2mm, 2mm])",
                "non-collinear",
            ),
            (
                "next = route |> line3d(end = [1mm, 2mm, 3mm])\nroute |> line3d(end = [2mm, 3mm, 4mm])",
                "out of date",
            ),
        ];
        for (body, expected) in cases {
            let error = parse_execute(&format!(
                "{SETTINGS}route = startPath3d(at = [0mm, 0mm, 0mm])\n{body}\n"
            ))
            .await
            .unwrap_err();
            assert!(error.to_string().contains(expected), "{body}: {error}");
        }
    }

    #[tokio::test]
    async fn customer_route_sweep_and_sealing() {
        let code = include_str!("path3d_customer_route.kcl");
        let mut result = parse_execute(code).await.unwrap();
        let KclValue::Path3d { value } = result.variable("route") else {
            panic!("expected Path3d")
        };
        assert_eq!(value.segment_count, 8);
        assert_eq!(value.end, [-60.0, 35.0, 35.0]);
        assert!(matches!(result.variable("body"), KclValue::Solid { .. }));
        let sweep = result
            .root_module_artifact_commands()
            .iter()
            .find_map(|c| match &c.command {
                ModelingCmd::Sweep(c) => Some(c),
                _ => None,
            })
            .unwrap();
        assert_eq!(sweep.trajectory.as_ref(), &value.id);
        assert_eq!(sweep.version, Some(2));
        let graph = result.artifact_graph().await.unwrap();
        let Some(Artifact::Path(path)) = graph.get(&value.artifact_id) else {
            panic!("missing spatial path")
        };
        assert_eq!(path.sub_type, PathSubType::Spatial);
        assert_eq!(path.plane_id, None);
        assert_eq!(path.seg_ids.len(), 8);
        assert!(path.consumed);
        assert!(path.trajectory_sweep_id.is_some());
        let error = parse_execute(&format!("{code}\nroute |> line3d(end = [1mm, 0mm, 0mm])\n"))
            .await
            .unwrap_err();
        assert!(error.to_string().contains("cannot be extended"), "{error}");
    }

    #[tokio::test]
    async fn rejects_empty_sweep() {
        let code = include_str!("path3d_customer_route.kcl");
        let route_end = code.find("\nprofile =").unwrap();
        let code = format!(
            "{SETTINGS}route = startPath3d(at = [0mm, 0mm, 0mm]){}",
            &code[route_end..]
        );
        let error = parse_execute(&code).await.unwrap_err();
        assert!(error.to_string().contains("empty 3D path"), "{error}");
    }

    #[tokio::test]
    async fn can_extend_in_a_function() {
        let result = parse_execute(&format!(
            "{SETTINGS}
fn extend(@path: Path3d): Path3d {{
  return path |> line3d(end = [1mm, 2mm, 3mm])
}}
route = startPath3d(at = [0mm, 0mm, 0mm]) |> extend() |> extend()
"
        ))
        .await
        .unwrap();
        let KclValue::Path3d { value } = result.variable("route") else {
            panic!("expected Path3d")
        };
        assert_eq!(value.end, [2.0, 4.0, 6.0]);
    }
}
