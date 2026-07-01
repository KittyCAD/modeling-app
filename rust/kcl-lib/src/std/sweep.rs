//! Standard library sweep.

use anyhow::Result;
use kcmc::ModelingCmd;
use kcmc::each_cmd as mcmd;
use kcmc::length_unit::LengthUnit;
use kcmc::shared::BodyType;
use kcmc::shared::Point3d as KPoint3d;
use kittycad_modeling_cmds::id::ModelingCmdId;
use kittycad_modeling_cmds::shared::DirectionType;
use kittycad_modeling_cmds::shared::RelativeTo;
use kittycad_modeling_cmds::websocket::ModelingCmdReq;
use kittycad_modeling_cmds::{self as kcmc};
use serde::Serialize;

use super::DEFAULT_TOLERANCE_MM;
use super::args::TyF64;
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
use crate::execution::types::PrimitiveType;
use crate::execution::types::RuntimeType;
use crate::parsing::ast::types::TagNode;
use crate::std::Args;
use crate::std::axis_or_reference::Point3dOrEdgeReference;
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
    let version: Option<u32> = args.get_kw_arg_opt("version", &RuntimeType::count(), exec_state)?;
    // Replaced by 2 args below.
    let relative_to: Option<String> = args.get_kw_arg_opt("relativeTo", &RuntimeType::string(), exec_state)?;
    // Replaces `relative_to`.
    let translate_profile_to_path: Option<bool> =
        args.get_kw_arg_opt("translateProfileToPath", &RuntimeType::bool(), exec_state)?;
    let orient_profile_perpendicular: Option<bool> =
        args.get_kw_arg_opt("orientProfilePerpendicular", &RuntimeType::bool(), exec_state)?;
    let projected_axis = args.get_kw_arg_opt(
        "projectedAxis",
        &RuntimeType::Union(vec![
            RuntimeType::point3d(),
            RuntimeType::Primitive(PrimitiveType::Edge),
            RuntimeType::tagged_edge(),
            RuntimeType::segment(),
        ]),
        exec_state,
    )?;

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
        projected_axis,
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
    projected_axis: Option<Point3dOrEdgeReference>,
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

    let version = version
        .map(|v| {
            u8::try_from(v).map_err(|_e| {
                KclError::new_argument(KclErrorDetails::new(
                    format!("Invalid version {}", v),
                    vec![args.source_range],
                ))
            })
        })
        .transpose()?;

    let trajectory = ModelingCmdId::from(match path {
        InnerSweepPath::Sketch(sketch) => sketch.id,
        InnerSweepPath::Helix(helix) => helix.value,
    });

    let profile_transform = match (relative_to, translate_profile_to_path, orient_profile_perpendicular) {
        // Default case when the user doesn't give any flags at all.
        (None, None, None) => ProfileTransform::RelativeTo(match version {
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

        // If the "new" profile transformation args are set.
        (None, translate, orient) => ProfileTransform::SeparateFlags {
            translate_profile_to_path: translate.unwrap_or_default(),
            orient_profile_perpendicular: orient.unwrap_or_default(),
        },

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

    let projected_axis = if let Some(axis) = projected_axis {
        match axis {
            Point3dOrEdgeReference::Point(p) => Some(DirectionType::Axis {
                direction: KPoint3d {
                    x: p[0].n,
                    y: p[1].n,
                    z: p[2].n,
                },
            }),
            Point3dOrEdgeReference::Edge(edge) => match edge {
                crate::std::fillet::EdgeReference::Uuid(uuid) => Some(DirectionType::Edge { id: uuid }),
                crate::std::fillet::EdgeReference::Tag(tag) => Some(DirectionType::Edge {
                    id: match tag.get_cur_info() {
                        Some(info) => info.id,
                        None => {
                            return Err(KclError::new_semantic(KclErrorDetails::new(
                                "Failed to get current info for tag".to_string(),
                                vec![args.source_range],
                            )));
                        }
                    },
                }),
            },
        }
    } else {
        None
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
                .maybe_projected_axis(projected_axis)
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
