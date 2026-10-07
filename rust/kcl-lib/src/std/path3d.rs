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
    v[0].hypot(v[1]).hypot(v[2])
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

/// Start a world-space path. Disable sketch mode before creation so a previous
/// sketch cannot supply an implicit local frame.
pub async fn start_path3d(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let at = point_mm(
        args.get_kw_arg("at", &RuntimeType::point3d(), exec_state)?,
        args.source_range,
    )?;
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
    Ok(KclValue::Path3d {
        value: Box::new(Path3d {
            id,
            artifact_id: id.into(),
            start: at,
            end: at,
            segment_count: 0,
            meta: vec![args.source_range.into()],
        }),
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
    append(
        path,
        end,
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
    append(
        path,
        end,
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
    mut path: Path3d,
    end: [f64; 3],
    segment: PathSegment,
    exec_state: &mut ExecState,
    args: Args,
) -> Result<KclValue, KclError> {
    let mut artifact = validate_current_path(&path, exec_state, args.source_range)?;
    if artifact.consumed {
        return Err(argument_error(
            "A 3D path used by a sweep cannot be extended. Complete the route before sweeping it.",
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
    path.segment_count += 1;
    artifact.seg_ids.push(id.into());
    exec_state.update_spatial_path_artifact(artifact);
    Ok(KclValue::Path3d { value: Box::new(path) })
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
            "This 3D path value is out of date. Use the result of the most recent line3d or arc3d call.",
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
