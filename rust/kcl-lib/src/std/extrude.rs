//! Functions related to extruding.

use std::collections::HashMap;

use anyhow::Result;
use kcmc::{
    ModelingCmd, each_cmd as mcmd,
    length_unit::LengthUnit,
    ok_response::OkModelingCmdResponse,
    output::ExtrusionFaceInfo,
    shared::{ExtrusionFaceCapType, Opposite},
    websocket::{ModelingCmdReq, OkWebSocketResponseData},
};
use kittycad_modeling_cmds::{
    self as kcmc,
    shared::{Angle, Point2d},
};
use uuid::Uuid;

use super::{DEFAULT_TOLERANCE_MM, args::TyF64, utils::point_to_mm};
use crate::{
    errors::{KclError, KclErrorDetails},
    execution::{
        ArtifactId, ExecState, ExtrudeSurface, GeoMeta, KclValue, ModelingCmdMeta, Path, Sketch, SketchSurface, Solid,
        types::RuntimeType,
    },
    parsing::ast::types::TagNode,
    std::Args,
};

/// Extrudes by a given amount.
pub async fn extrude(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let sketches = args.get_unlabeled_kw_arg("sketches", &RuntimeType::sketches(), exec_state)?;
    let length: TyF64 = args.get_kw_arg("length", &RuntimeType::length(), exec_state)?;
    let symmetric = args.get_kw_arg_opt("symmetric", &RuntimeType::bool(), exec_state)?;
    let bidirectional_length: Option<TyF64> =
        args.get_kw_arg_opt("bidirectionalLength", &RuntimeType::length(), exec_state)?;
    let tag_start = args.get_kw_arg_opt("tagStart", &RuntimeType::tag_decl(), exec_state)?;
    let tag_end = args.get_kw_arg_opt("tagEnd", &RuntimeType::tag_decl(), exec_state)?;
    let twist_angle: Option<TyF64> = args.get_kw_arg_opt("twistAngle", &RuntimeType::degrees(), exec_state)?;
    let twist_angle_step: Option<TyF64> = args.get_kw_arg_opt("twistAngleStep", &RuntimeType::degrees(), exec_state)?;
    let twist_center: Option<[TyF64; 2]> = args.get_kw_arg_opt("twistCenter", &RuntimeType::point2d(), exec_state)?;
    let tolerance: Option<TyF64> = args.get_kw_arg_opt("tolerance", &RuntimeType::length(), exec_state)?;

    let result = inner_extrude(
        sketches,
        length,
        symmetric,
        bidirectional_length,
        tag_start,
        tag_end,
        twist_angle,
        twist_angle_step,
        twist_center,
        tolerance,
        exec_state,
        args,
    )
    .await?;

    Ok(result.into())
}

#[allow(clippy::too_many_arguments)]
async fn inner_extrude(
    sketches: Vec<Sketch>,
    length: TyF64,
    symmetric: Option<bool>,
    bidirectional_length: Option<TyF64>,
    tag_start: Option<TagNode>,
    tag_end: Option<TagNode>,
    twist_angle: Option<TyF64>,
    twist_angle_step: Option<TyF64>,
    twist_center: Option<[TyF64; 2]>,
    tolerance: Option<TyF64>,
    exec_state: &mut ExecState,
    args: Args,
) -> Result<Vec<Solid>, KclError> {
    // Extrude the element(s).
    let mut solids = Vec::new();
    let tolerance = LengthUnit(tolerance.as_ref().map(|t| t.to_mm()).unwrap_or(DEFAULT_TOLERANCE_MM));

    if symmetric.unwrap_or(false) && bidirectional_length.is_some() {
        return Err(KclError::new_semantic(KclErrorDetails::new(
            "You cannot give both `symmetric` and `bidirectional` params, you have to choose one or the other"
                .to_owned(),
            vec![args.source_range],
        )));
    }

    let bidirection = bidirectional_length.map(|l| LengthUnit(l.to_mm()));

    let opposite = match (symmetric, bidirection) {
        (Some(true), _) => Opposite::Symmetric,
        (None, None) => Opposite::None,
        (Some(false), None) => Opposite::None,
        (None, Some(length)) => Opposite::Other(length),
        (Some(false), Some(length)) => Opposite::Other(length),
    };

    for sketch in &sketches {
        let id = exec_state.next_uuid();
        let cmd = match (&twist_angle, &twist_angle_step, &twist_center) {
            (Some(angle), angle_step, center) => {
                let center = center.clone().map(point_to_mm).map(Point2d::from).unwrap_or_default();
                let total_rotation_angle = Angle::from_degrees(angle.to_degrees());
                let angle_step_size = Angle::from_degrees(angle_step.clone().map(|a| a.to_degrees()).unwrap_or(15.0));
                ModelingCmd::from(mcmd::TwistExtrude {
                    target: sketch.id.into(),
                    distance: LengthUnit(length.to_mm()),
                    faces: Default::default(),
                    center_2d: center,
                    total_rotation_angle,
                    angle_step_size,
                    tolerance,
                })
            }
            (None, _, _) => ModelingCmd::from(mcmd::Extrude {
                target: sketch.id.into(),
                distance: LengthUnit(length.to_mm()),
                faces: Default::default(),
                opposite: opposite.clone(),
            }),
        };
        let cmds = sketch.build_sketch_mode_cmds(exec_state, ModelingCmdReq { cmd_id: id.into(), cmd });
        exec_state
            .batch_modeling_cmds(ModelingCmdMeta::from_args_id(&args, id), &cmds)
            .await?;

        solids.push(
            do_post_extrude(
                sketch,
                id.into(),
                length.clone(),
                false,
                &NamedCapTags {
                    start: tag_start.as_ref(),
                    end: tag_end.as_ref(),
                },
                exec_state,
                &args,
                None,
            )
            .await?,
        );
    }

    Ok(solids)
}

#[derive(Debug, Default)]
pub(crate) struct NamedCapTags<'a> {
    pub start: Option<&'a TagNode>,
    pub end: Option<&'a TagNode>,
}

#[allow(clippy::too_many_arguments)]
pub(crate) async fn do_post_extrude<'a>(
    sketch: &Sketch,
    solid_id: ArtifactId,
    length: TyF64,
    sectional: bool,
    named_cap_tags: &'a NamedCapTags<'a>,
    exec_state: &mut ExecState,
    args: &Args,
    edge_id: Option<Uuid>,
) -> Result<Solid, KclError> {
    // Bring the object to the front of the scene.
    // See: https://github.com/KittyCAD/modeling-app/issues/806
    exec_state
        .batch_modeling_cmd(
            args.into(),
            ModelingCmd::from(mcmd::ObjectBringToFront { object_id: sketch.id }),
        )
        .await?;

    let any_edge_id = if let Some(edge_id) = sketch.mirror {
        edge_id
    } else if let Some(id) = edge_id {
        id
    } else {
        // The "get extrusion face info" API call requires *any* edge on the sketch being extruded.
        // So, let's just use the first one.
        let Some(any_edge_id) = sketch.paths.first().map(|edge| edge.get_base().geo_meta.id) else {
            return Err(KclError::new_type(KclErrorDetails::new(
                "Expected a non-empty sketch".to_owned(),
                vec![args.source_range],
            )));
        };
        any_edge_id
    };

    let mut sketch = sketch.clone();

    // If we were sketching on a face, we need the original face id.
    if let SketchSurface::Face(ref face) = sketch.on {
        sketch.id = face.solid.sketch.id;
    }

    let solid3d_info = exec_state
        .send_modeling_cmd(
            args.into(),
            ModelingCmd::from(mcmd::Solid3dGetExtrusionFaceInfo {
                edge_id: any_edge_id,
                object_id: sketch.id,
            }),
        )
        .await?;

    let face_infos = if let OkWebSocketResponseData::Modeling {
        modeling_response: OkModelingCmdResponse::Solid3dGetExtrusionFaceInfo(data),
    } = solid3d_info
    {
        data.faces
    } else {
        vec![]
    };

    // Only do this if we need the artifact graph.
    #[cfg(feature = "artifact-graph")]
    {
        // Getting the ids of a sectional sweep does not work well and we cannot guarantee that
        // any of these call will not just fail.
        if !sectional {
            exec_state
                .batch_modeling_cmd(
                    args.into(),
                    ModelingCmd::from(mcmd::Solid3dGetAdjacencyInfo {
                        object_id: sketch.id,
                        edge_id: any_edge_id,
                    }),
                )
                .await?;
        }
    }

    let Faces {
        sides: face_id_map,
        start_cap_id,
        end_cap_id,
    } = analyze_faces(exec_state, args, face_infos).await;

    // Iterate over the sketch.value array and add face_id to GeoMeta
    let no_engine_commands = args.ctx.no_engine_commands().await;
    let mut new_value: Vec<ExtrudeSurface> = sketch
        .paths
        .iter()
        .flat_map(|path| {
            if let Some(Some(actual_face_id)) = face_id_map.get(&path.get_base().geo_meta.id) {
                match path {
                    Path::Arc { .. }
                    | Path::TangentialArc { .. }
                    | Path::TangentialArcTo { .. }
                    // TODO: (bc) fix me
                    | Path::Ellipse { .. }
                    | Path::Conic {.. }
                    | Path::Circle { .. }
                    | Path::CircleThreePoint { .. } => {
                        let extrude_surface = ExtrudeSurface::ExtrudeArc(crate::execution::ExtrudeArc {
                            face_id: *actual_face_id,
                            tag: path.get_base().tag.clone(),
                            geo_meta: GeoMeta {
                                id: path.get_base().geo_meta.id,
                                metadata: path.get_base().geo_meta.metadata,
                            },
                        });
                        Some(extrude_surface)
                    }
                    Path::Base { .. } | Path::ToPoint { .. } | Path::Horizontal { .. } | Path::AngledLineTo { .. } => {
                        let extrude_surface = ExtrudeSurface::ExtrudePlane(crate::execution::ExtrudePlane {
                            face_id: *actual_face_id,
                            tag: path.get_base().tag.clone(),
                            geo_meta: GeoMeta {
                                id: path.get_base().geo_meta.id,
                                metadata: path.get_base().geo_meta.metadata,
                            },
                        });
                        Some(extrude_surface)
                    }
                    Path::ArcThreePoint { .. } => {
                        let extrude_surface = ExtrudeSurface::ExtrudeArc(crate::execution::ExtrudeArc {
                            face_id: *actual_face_id,
                            tag: path.get_base().tag.clone(),
                            geo_meta: GeoMeta {
                                id: path.get_base().geo_meta.id,
                                metadata: path.get_base().geo_meta.metadata,
                            },
                        });
                        Some(extrude_surface)
                    }
                }
            } else if no_engine_commands {
                // Only pre-populate the extrude surface if we are in mock mode.

                let extrude_surface = ExtrudeSurface::ExtrudePlane(crate::execution::ExtrudePlane {
                    // pushing this values with a fake face_id to make extrudes mock-execute safe
                    face_id: exec_state.next_uuid(),
                    tag: path.get_base().tag.clone(),
                    geo_meta: GeoMeta {
                        id: path.get_base().geo_meta.id,
                        metadata: path.get_base().geo_meta.metadata,
                    },
                });
                Some(extrude_surface)
            } else {
                None
            }
        })
        .collect();

    // Add the tags for the start or end caps.
    if let Some(tag_start) = named_cap_tags.start {
        let Some(start_cap_id) = start_cap_id else {
            return Err(KclError::new_type(KclErrorDetails::new(
                format!(
                    "Expected a start cap ID for tag `{}` for extrusion of sketch {:?}",
                    tag_start.name, sketch.id
                ),
                vec![args.source_range],
            )));
        };

        new_value.push(ExtrudeSurface::ExtrudePlane(crate::execution::ExtrudePlane {
            face_id: start_cap_id,
            tag: Some(tag_start.clone()),
            geo_meta: GeoMeta {
                id: start_cap_id,
                metadata: args.source_range.into(),
            },
        }));
    }
    if let Some(tag_end) = named_cap_tags.end {
        let Some(end_cap_id) = end_cap_id else {
            return Err(KclError::new_type(KclErrorDetails::new(
                format!(
                    "Expected an end cap ID for tag `{}` for extrusion of sketch {:?}",
                    tag_end.name, sketch.id
                ),
                vec![args.source_range],
            )));
        };

        new_value.push(ExtrudeSurface::ExtrudePlane(crate::execution::ExtrudePlane {
            face_id: end_cap_id,
            tag: Some(tag_end.clone()),
            geo_meta: GeoMeta {
                id: end_cap_id,
                metadata: args.source_range.into(),
            },
        }));
    }

    Ok(Solid {
        // Ok so you would think that the id would be the id of the solid,
        // that we passed in to the function, but it's actually the id of the
        // sketch.
        id: sketch.id,
        artifact_id: solid_id,
        value: new_value,
        meta: sketch.meta.clone(),
        units: sketch.units,
        height: length.to_length_units(sketch.units),
        sectional,
        sketch,
        start_cap_id,
        end_cap_id,
        edge_cuts: vec![],
    })
}

#[derive(Default)]
struct Faces {
    /// Maps curve ID to face ID for each side.
    sides: HashMap<Uuid, Option<Uuid>>,
    /// Top face ID.
    end_cap_id: Option<Uuid>,
    /// Bottom face ID.
    start_cap_id: Option<Uuid>,
}

async fn analyze_faces(exec_state: &mut ExecState, args: &Args, face_infos: Vec<ExtrusionFaceInfo>) -> Faces {
    let mut faces = Faces {
        sides: HashMap::with_capacity(face_infos.len()),
        ..Default::default()
    };
    if args.ctx.no_engine_commands().await {
        // Create fake IDs for start and end caps, to make extrudes mock-execute safe
        faces.start_cap_id = Some(exec_state.next_uuid());
        faces.end_cap_id = Some(exec_state.next_uuid());
    }
    for face_info in face_infos {
        match face_info.cap {
            ExtrusionFaceCapType::Bottom => faces.start_cap_id = face_info.face_id,
            ExtrusionFaceCapType::Top => faces.end_cap_id = face_info.face_id,
            ExtrusionFaceCapType::Both => {
                faces.end_cap_id = face_info.face_id;
                faces.start_cap_id = face_info.face_id;
            }
            ExtrusionFaceCapType::None => {
                if let Some(curve_id) = face_info.curve_id {
                    faces.sides.insert(curve_id, face_info.face_id);
                }
            }
        }
    }
    faces
}
