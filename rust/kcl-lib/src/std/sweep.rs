//! Standard library sweep.

use anyhow::Result;
use kcmc::ModelingCmd;
use kcmc::each_cmd as mcmd;
use kcmc::length_unit::LengthUnit;
use kcmc::shared::BodyType;
use kittycad_modeling_cmds::id::ModelingCmdId;
use kittycad_modeling_cmds::shared::RelativeTo;
use kittycad_modeling_cmds::websocket::ModelingCmdReq;
use kittycad_modeling_cmds::{self as kcmc};
use serde::Serialize;

use super::DEFAULT_TOLERANCE_MM;
use super::args::TyF64;
use crate::KclVersion;
use crate::errors::KclError;
use crate::errors::KclErrorDetails;
use crate::execution::ExecState;
use crate::execution::Extrudable;
use crate::execution::Helix;
use crate::execution::KclValue;
use crate::execution::ModelingCmdMeta;
use crate::execution::ProfileClosed;
use crate::execution::Segment;
use crate::execution::Sketch;
use crate::execution::SketchSurface;
use crate::execution::Solid;
use crate::execution::types::ArrayLen;
use crate::execution::types::RuntimeType;
use crate::parsing::ast::types::TagNode;
use crate::std::Args;
use crate::std::extrude::BeingExtruded;
use crate::std::extrude::build_segment_surface_sketch;
use crate::std::extrude::coerce_extrude_targets;
use crate::std::extrude::do_post_extrude;

/// A path to sweep along.
#[derive(Debug, Clone, Serialize, PartialEq, ts_rs::TS)]
#[ts(export)]
#[serde(untagged)]
#[allow(clippy::large_enum_variant)]
pub enum SweepPath {
    Sketch(Sketch),
    Helix(Box<Helix>),
    Segments(Vec<Segment>),
}

/// The outer (typical) sweep path gets converted to this, losing some of its variants in the conversion.
#[allow(clippy::large_enum_variant)]
enum InnerSweepPath {
    Sketch(Sketch),
    Helix(Box<Helix>),
}

/// Create a 3D surface or solid by sweeping a sketch along a path.
pub async fn sweep(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let sketch_values = args.get_unlabeled_kw_arg(
        "sketches",
        &RuntimeType::Array(
            Box::new(RuntimeType::Union(vec![
                RuntimeType::sketch(),
                RuntimeType::segment(),
                RuntimeType::face(),
                RuntimeType::tagged_face(),
            ])),
            ArrayLen::Minimum(1),
        ),
        exec_state,
    )?;
    let path: SweepPath = args.get_kw_arg(
        "path",
        &RuntimeType::Union(vec![
            RuntimeType::sketch(),
            RuntimeType::helix(),
            RuntimeType::Array(Box::new(RuntimeType::segment()), ArrayLen::Minimum(1)),
        ]),
        exec_state,
    )?;
    let sectional = args.get_kw_arg_opt("sectional", &RuntimeType::bool(), exec_state)?;
    let tolerance: Option<TyF64> = args.get_kw_arg_opt("tolerance", &RuntimeType::length(), exec_state)?;
    let tag_start = args.get_kw_arg_opt("tagStart", &RuntimeType::tag_decl(), exec_state)?;
    let tag_end = args.get_kw_arg_opt("tagEnd", &RuntimeType::tag_decl(), exec_state)?;
    let body_type: Option<BodyType> = args.get_kw_arg_opt("bodyType", &RuntimeType::string(), exec_state)?;
    // KCL 3.0 removes the version parameter (`removed_since` in sketch.kcl),
    // so from 3.0 on this is always None, and the newest algorithm is used.
    let version: Option<u32> = args.get_kw_arg_opt("version", &RuntimeType::count(), exec_state)?;
    // Replaced by 2 args below.
    let relative_to: Option<String> = args.get_kw_arg_opt("relativeTo", &RuntimeType::string(), exec_state)?;
    // Replaces `relative_to`.
    let translate_profile_to_path: Option<bool> =
        args.get_kw_arg_opt("translateProfileToPath", &RuntimeType::bool(), exec_state)?;
    let orient_profile_perpendicular: Option<bool> =
        args.get_kw_arg_opt("orientProfilePerpendicular", &RuntimeType::bool(), exec_state)?;

    let path = match path {
        SweepPath::Segments(segments) => InnerSweepPath::Sketch(
            build_segment_surface_sketch(segments, exec_state, &args.ctx, args.source_range).await?,
        ),
        SweepPath::Sketch(sketch) => InnerSweepPath::Sketch(sketch),
        SweepPath::Helix(helix) => InnerSweepPath::Helix(helix),
    };

    let sketches = coerce_extrude_targets(
        sketch_values,
        body_type.unwrap_or_default(),
        tag_start.as_ref(),
        tag_end.as_ref(),
        exec_state,
        &args.ctx,
        args.source_range,
    )
    .await?;

    let value = inner_sweep(
        sketches,
        path,
        sectional,
        tolerance,
        relative_to,
        translate_profile_to_path,
        orient_profile_perpendicular,
        tag_start,
        tag_end,
        body_type,
        version,
        exec_state,
        args,
    )
    .await?;
    Ok(value.into())
}

enum ProfileTransform {
    RelativeTo(RelativeTo),
    SeparateFlags {
        translate_profile_to_path: bool,
        orient_profile_perpendicular: bool,
    },
}

impl ProfileTransform {
    fn relative_to(&self) -> Option<RelativeTo> {
        match self {
            ProfileTransform::RelativeTo(relative_to) => Some(*relative_to),
            ProfileTransform::SeparateFlags { .. } => None,
        }
    }

    fn translate_profile_to_path(&self) -> Option<bool> {
        match self {
            ProfileTransform::RelativeTo(..) => None,
            ProfileTransform::SeparateFlags {
                translate_profile_to_path,
                ..
            } => Some(*translate_profile_to_path),
        }
    }
    fn orient_profile_perpendicular(&self) -> Option<bool> {
        match self {
            ProfileTransform::RelativeTo(..) => None,
            ProfileTransform::SeparateFlags {
                orient_profile_perpendicular,
                ..
            } => Some(*orient_profile_perpendicular),
        }
    }
}

/// The sweep algorithm version to send when the user does not set `version`.
/// KCL 3.0 removes the version parameter (`removed_since` in sketch.kcl), so
/// from 3.0 on this is always what is sent.
fn default_sweep_version(kcl_version: KclVersion) -> Option<u8> {
    if kcl_version <= KclVersion::V2 {
        // Unspecified, so the engine chooses. It currently chooses version 1.
        None
    } else {
        // KCL 3.0 and later always use the newest algorithm.
        Some(2)
    }
}

/// The value of `orientProfilePerpendicular` when the user does not set it.
fn default_orient_profile_perpendicular(kcl_version: KclVersion, translate_profile_to_path: bool) -> bool {
    if kcl_version <= KclVersion::V2 {
        false
    } else {
        // From a mechanical engineer on what is intuitive:
        // - `translateProfileToPath` should default to false.
        // - `orientProfilePerpendicular` should default to false,
        //   unless `translateProfileToPath` is true, in which case both should be true.
        translate_profile_to_path
    }
}

#[allow(clippy::too_many_arguments)]
async fn inner_sweep(
    sketches: Vec<Extrudable>,
    path: InnerSweepPath,
    sectional: Option<bool>,
    tolerance: Option<TyF64>,
    relative_to: Option<String>,
    translate_profile_to_path: Option<bool>,
    orient_profile_perpendicular: Option<bool>,
    tag_start: Option<TagNode>,
    tag_end: Option<TagNode>,
    body_type: Option<BodyType>,
    version: Option<u32>,
    exec_state: &mut ExecState,
    args: Args,
) -> Result<Vec<Solid>, KclError> {
    let body_type = body_type.unwrap_or_default();
    if matches!(body_type, BodyType::Solid) && sketches.iter().any(|sk| matches!(sk.is_closed(), ProfileClosed::No)) {
        return Err(KclError::new_semantic(KclErrorDetails::new(
            "Cannot solid sweep an open profile. Either close the profile, or use a surface sweep.".to_owned(),
            vec![args.source_range],
        )));
    }

    let kcl_version = exec_state.kcl_version();
    let version = version
        .map(|v| {
            u8::try_from(v).map_err(|_e| {
                KclError::new_argument(KclErrorDetails::new(
                    format!("Invalid version {}", v),
                    vec![args.source_range],
                ))
            })
        })
        .transpose()?
        .or_else(|| default_sweep_version(kcl_version));

    let trajectory = ModelingCmdId::from(match path {
        InnerSweepPath::Sketch(sketch) => sketch.id,
        InnerSweepPath::Helix(helix) => helix.value,
    });

    let profile_transform = match (relative_to, translate_profile_to_path, orient_profile_perpendicular) {
        // Before KCL 3.0, when the user doesn't give any flags at all, the
        // legacy `relativeTo` behavior is implied by the algorithm version.
        (None, None, None) if kcl_version <= KclVersion::V2 => ProfileTransform::RelativeTo(match version {
            // We default to algorithm v1 if no choice was made.
            None | Some(1) => RelativeTo::TrajectoryCurve,
            // 0 means "let engine choose". Engine currently chooses version 1.
            Some(0) => RelativeTo::TrajectoryCurve,
            // Algorithm version 2 defaults to SketchPlane.
            Some(2) => RelativeTo::SketchPlane,
            // Error on unknown algorithm.
            Some(other) => {
                return Err(KclError::new_argument(KclErrorDetails::new(
                    format!("Invalid version {}", other),
                    vec![args.source_range],
                )));
            }
        }),

        // If the "new" profile transformation args are set. KCL 3.0 removed
        // `relativeTo` (see `removed_since` in sketch.kcl), so from 3.0 on,
        // this is also the case when no flags are set at all.
        (None, translate, orient) => {
            let translate_profile_to_path = translate.unwrap_or_default();
            ProfileTransform::SeparateFlags {
                translate_profile_to_path,
                orient_profile_perpendicular: orient
                    .unwrap_or_else(|| default_orient_profile_perpendicular(kcl_version, translate_profile_to_path)),
            }
        }

        // RelativeTo was set, but none of its replacements were.
        (Some(relative_to), None, None) => ProfileTransform::RelativeTo(match relative_to.as_str() {
            "sketchPlane" => RelativeTo::SketchPlane,
            "trajectoryCurve" => RelativeTo::TrajectoryCurve,
            _ => {
                return Err(KclError::new_syntax(crate::errors::KclErrorDetails::new(
                    "If you provide relativeTo, it must either be 'sketchPlane' or 'trajectoryCurve'".to_owned(),
                    vec![args.source_range],
                )));
            }
        }),

        // RelativeTo was set, but also one of its replacements was.
        // This is an error.
        (Some(_relative_to), _, _) => {
            return Err(KclError::new_argument(crate::errors::KclErrorDetails::new(
                    "If you provide 'relativeTo', you cannot provide 'translateProfileToPath' or 'orientProfilePerpendicular'. Those arguments replace 'relativeTo', please use them instead.".to_owned(),
                    vec![args.source_range],
                )));
        }
    };

    let mut solids = Vec::new();
    for sketch in &sketches {
        let sweep_cmd_id = exec_state.next_uuid();
        let sketch_or_face_id = sketch.id_to_extrude(exec_state, &args, false).await?;
        let cmd = ModelingCmd::from(
            mcmd::Sweep::builder()
                .target(sketch_or_face_id.into())
                .trajectory(trajectory)
                .sectional(sectional.unwrap_or(false))
                .tolerance(LengthUnit(
                    tolerance.as_ref().map(|t| t.to_mm()).unwrap_or(DEFAULT_TOLERANCE_MM),
                ))
                .maybe_relative_to(profile_transform.relative_to())
                .maybe_orient_profile_perpendicular(profile_transform.orient_profile_perpendicular())
                .maybe_translate_profile_to_path(profile_transform.translate_profile_to_path())
                .body_type(body_type)
                .maybe_version(version)
                .build(),
        );

        let being_extruded = match sketch {
            Extrudable::Sketch(..) => BeingExtruded::Sketch,
            Extrudable::FaceTag(face_tag) => {
                let face_id = sketch_or_face_id;
                let solid_id = match face_tag.geometry() {
                    Some(crate::execution::Geometry::Solid(solid)) => solid.id,
                    Some(crate::execution::Geometry::Sketch(sketch)) => match sketch.on {
                        SketchSurface::Face(face) => face.parent_solid.solid_id,
                        SketchSurface::Plane(_) => sketch.id,
                    },
                    None => face_id,
                };
                BeingExtruded::Face { face_id, solid_id }
            }
            Extrudable::Face(face) => BeingExtruded::Face {
                face_id: face.id,
                solid_id: face.parent_solid.solid_id,
            },
            Extrudable::EdgeTag(_) => BeingExtruded::Edge,
            Extrudable::Edge(_) => BeingExtruded::Edge,
            Extrudable::EdgeSpecifier(_) => BeingExtruded::Edge,
        };

        if let Some(post_extr_sketch) = sketch.as_sketch() {
            let cmds = post_extr_sketch.build_sketch_mode_cmds(
                exec_state,
                ModelingCmdReq {
                    cmd_id: sweep_cmd_id.into(),
                    cmd,
                },
            );
            exec_state
                .batch_modeling_cmds(ModelingCmdMeta::from_args_id(exec_state, &args, sweep_cmd_id), &cmds)
                .await?;
            solids.push(
                do_post_extrude(
                    &post_extr_sketch,
                    sweep_cmd_id.into(),
                    sectional.unwrap_or(false),
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
                    being_extruded,
                )
                .await?,
            );
        } else {
            return Err(KclError::new_type(KclErrorDetails::new(
                "Expected a sketch for sweeping".to_owned(),
                vec![args.source_range],
            )));
        }
    }

    // Hide the artifact from the sketch or helix.
    exec_state
        .batch_modeling_cmd(
            ModelingCmdMeta::from_args(exec_state, &args),
            ModelingCmd::from(
                mcmd::ObjectVisible::builder()
                    .object_id(trajectory.into())
                    .hidden(true)
                    .build(),
            ),
        )
        .await?;

    Ok(solids)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::execution::ExecTestResults;
    use crate::execution::parse_execute;

    /// What each KCL version sends to the engine when the user leaves out
    /// `translateProfileToPath`, `orientProfilePerpendicular`, and `version`.
    #[tokio::test(flavor = "multi_thread")]
    async fn sweep_defaults_depend_on_kcl_version() {
        // Before KCL 3.0, the legacy `relative_to` field is sent instead of
        // the two flags, and the algorithm version is left to the engine.
        let cmd = emitted_sweep("2.0", "").await;
        assert_eq!(cmd.relative_to, Some(RelativeTo::TrajectoryCurve));
        assert_eq!(cmd.translate_profile_to_path, None);
        assert_eq!(cmd.orient_profile_perpendicular, None);
        assert_eq!(cmd.version, None);

        // From KCL 3.0, the two flags are always sent, both false by default,
        // and the algorithm is always version 2.
        let cmd = emitted_sweep("\"3.0-preview\"", "").await;
        assert_eq!(cmd.relative_to, None);
        assert_eq!(cmd.translate_profile_to_path, Some(false));
        assert_eq!(cmd.orient_profile_perpendicular, Some(false));
        assert_eq!(cmd.version, Some(2));
    }

    /// From KCL 3.0, `orientProfilePerpendicular` defaults to the value of
    /// `translateProfileToPath`. Before that, the two flags are independent.
    #[tokio::test(flavor = "multi_thread")]
    async fn orient_profile_perpendicular_follows_translate_in_kcl_3() {
        let cmd = emitted_sweep("\"3.0-preview\"", ", translateProfileToPath = true").await;
        assert_eq!(cmd.translate_profile_to_path, Some(true));
        assert_eq!(cmd.orient_profile_perpendicular, Some(true));

        let cmd = emitted_sweep("\"3.0-preview\"", ", translateProfileToPath = false").await;
        assert_eq!(cmd.translate_profile_to_path, Some(false));
        assert_eq!(cmd.orient_profile_perpendicular, Some(false));

        let cmd = emitted_sweep("2.0", ", translateProfileToPath = true").await;
        assert_eq!(cmd.translate_profile_to_path, Some(true));
        assert_eq!(cmd.orient_profile_perpendicular, Some(false));
    }

    /// An explicit `orientProfilePerpendicular` wins over the default,
    /// whatever `translateProfileToPath` is.
    #[tokio::test(flavor = "multi_thread")]
    async fn explicit_orient_profile_perpendicular_overrides_kcl_default() {
        let cmd = emitted_sweep(
            "\"3.0-preview\"",
            ", translateProfileToPath = true, orientProfilePerpendicular = false",
        )
        .await;
        assert_eq!(cmd.translate_profile_to_path, Some(true));
        assert_eq!(cmd.orient_profile_perpendicular, Some(false));

        let cmd = emitted_sweep("\"3.0-preview\"", ", orientProfilePerpendicular = true").await;
        assert_eq!(cmd.translate_profile_to_path, Some(false));
        assert_eq!(cmd.orient_profile_perpendicular, Some(true));
    }

    /// If the user chooses a sweep algorithm version, KCL should respect it,
    /// and not use that KCL version's default sweep algorithm version.
    #[tokio::test(flavor = "multi_thread")]
    async fn explicit_sweep_version_overrides_kcl_default() {
        assert_eq!(emitted_sweep("2.0", ", version = 2").await.version, Some(2));
        assert_eq!(emitted_sweep("2.0", ", version = 0").await.version, Some(0));
    }

    /// KCL 3.0 removed `sweep(version = )`. Passing it is reported like any
    /// other unknown argument, and the newest algorithm is used.
    #[tokio::test(flavor = "multi_thread")]
    async fn sweep_version_is_removed_in_kcl_3() {
        let result = run_sweep("\"3.0-preview\"", ", version = 1").await;
        assert!(
            result
                .issues()
                .iter()
                .any(|issue| {
                    issue.message
                        == "`version` is not an argument of `sweep`; it was removed as of KCL 3.0, but this program uses KCL 3.0-preview"
                }),
            "issues: {:#?}",
            result.issues()
        );
        assert_eq!(emitted_sweep_cmd(&result).version, Some(2));
    }

    /// Sweep a circle along a line under the given KCL version, passing
    /// `extra_args` to `sweep`, and return the `Sweep` command sent to the
    /// engine.
    async fn emitted_sweep(kcl_version: &str, extra_args: &str) -> mcmd::Sweep {
        emitted_sweep_cmd(&run_sweep(kcl_version, extra_args).await)
    }

    /// Sweep a circle along a line under the given KCL version, passing
    /// `extra_args` to `sweep`.
    async fn run_sweep(kcl_version: &str, extra_args: &str) -> ExecTestResults {
        let code = format!(
            r#"@settings(defaultLengthUnit = mm, kclVersion = {kcl_version})

profileSketch = sketch(on = XY) {{
  c = circle(start = [var 10mm, var 0mm], center = [var 0mm, var 0mm])
}}
profile = region(segments = [profileSketch.c])

pathSketch = sketch(on = XZ) {{
  path = line(start = [var 0mm, var 0mm], end = [var 0mm, var 100mm])
}}

sweep(profile, path = pathSketch{extra_args})
"#
        );
        parse_execute(&code).await.unwrap()
    }

    /// The `Sweep` command the run sent to the engine.
    fn emitted_sweep_cmd(result: &ExecTestResults) -> mcmd::Sweep {
        result
            .root_module_artifact_commands()
            .iter()
            .find_map(|artifact_command| match &artifact_command.command {
                ModelingCmd::Sweep(cmd) => Some(cmd.clone()),
                _ => None,
            })
            .expect("sweep should emit a Sweep command")
    }
}
