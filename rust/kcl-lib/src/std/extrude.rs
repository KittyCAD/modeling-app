//! Functions related to extruding.

use std::collections::HashMap;

use anyhow::Result;
use kcmc::shared::Point3d as KPoint3d; // Point3d is already defined in this pkg, to impl ts_rs traits.
use kcmc::{
    ModelingCmd, each_cmd as mcmd,
    length_unit::LengthUnit,
    ok_response::OkModelingCmdResponse,
    output::ExtrusionFaceInfo,
    shared::{ExtrudeReference, ExtrusionFaceCapType, Opposite},
    websocket::{ModelingCmdReq, OkWebSocketResponseData},
};
use kittycad_modeling_cmds::{
    self as kcmc,
    shared::{Angle, BodyType, ExtrudeMethod, Point2d},
};
use uuid::Uuid;

use super::{DEFAULT_TOLERANCE_MM, args::TyF64, utils::point_to_mm};
use crate::{
    errors::{KclError, KclErrorDetails},
    execution::{
        ArtifactId, ExecState, Extrudable, ExtrudeSurface, GeoMeta, KclValue, ModelingCmdMeta, Path, ProfileClosed,
        Sketch, SketchSurface, Solid,
        types::{ArrayLen, PrimitiveType, RuntimeType},
    },
    parsing::ast::types::TagNode,
    std::{Args, axis_or_reference::Point3dAxis3dOrGeometryReference},
};

/// Extrudes by a given amount.
pub async fn extrude(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let sketches: Vec<Extrudable> = args.get_unlabeled_kw_arg(
        "sketches",
        &RuntimeType::Array(
            Box::new(RuntimeType::Union(vec![
                RuntimeType::sketch(),
                RuntimeType::face(),
                RuntimeType::tagged_face(),
            ])),
            ArrayLen::Minimum(1),
        ),
        exec_state,
    )?;

    let length: Option<TyF64> = args.get_kw_arg_opt("length", &RuntimeType::length(), exec_state)?;
    let to = args.get_kw_arg_opt(
        "to",
        &RuntimeType::Union(vec![
            RuntimeType::point3d(),
            RuntimeType::Primitive(PrimitiveType::Axis3d),
            RuntimeType::Primitive(PrimitiveType::Edge),
            RuntimeType::plane(),
            RuntimeType::Primitive(PrimitiveType::Face),
            RuntimeType::sketch(),
            RuntimeType::Primitive(PrimitiveType::Solid),
            RuntimeType::tagged_edge(),
            RuntimeType::tagged_face(),
        ]),
        exec_state,
    )?;
    let symmetric = args.get_kw_arg_opt("symmetric", &RuntimeType::bool(), exec_state)?;
    let bidirectional_length: Option<TyF64> =
        args.get_kw_arg_opt("bidirectionalLength", &RuntimeType::length(), exec_state)?;
    let tag_start = args.get_kw_arg_opt("tagStart", &RuntimeType::tag_decl(), exec_state)?;
    let tag_end = args.get_kw_arg_opt("tagEnd", &RuntimeType::tag_decl(), exec_state)?;
    let twist_angle: Option<TyF64> = args.get_kw_arg_opt("twistAngle", &RuntimeType::degrees(), exec_state)?;
    let twist_angle_step: Option<TyF64> = args.get_kw_arg_opt("twistAngleStep", &RuntimeType::degrees(), exec_state)?;
    let twist_center: Option<[TyF64; 2]> = args.get_kw_arg_opt("twistCenter", &RuntimeType::point2d(), exec_state)?;
    let tolerance: Option<TyF64> = args.get_kw_arg_opt("tolerance", &RuntimeType::length(), exec_state)?;
    let method: Option<String> = args.get_kw_arg_opt("method", &RuntimeType::string(), exec_state)?;
    let hide_seams: Option<bool> = args.get_kw_arg_opt("hideSeams", &RuntimeType::bool(), exec_state)?;
    let body_type: Option<BodyType> = args.get_kw_arg_opt("bodyType", &RuntimeType::string(), exec_state)?;

    let result = inner_extrude(
        sketches,
        length,
        to,
        symmetric,
        bidirectional_length,
        tag_start,
        tag_end,
        twist_angle,
        twist_angle_step,
        twist_center,
        tolerance,
        method,
        hide_seams,
        body_type,
        exec_state,
        args,
    )
    .await?;

    Ok(result.into())
}

#[allow(clippy::too_many_arguments)]
async fn inner_extrude(
    extrudables: Vec<Extrudable>,
    length: Option<TyF64>,
    to: Option<Point3dAxis3dOrGeometryReference>,
    symmetric: Option<bool>,
    bidirectional_length: Option<TyF64>,
    tag_start: Option<TagNode>,
    tag_end: Option<TagNode>,
    twist_angle: Option<TyF64>,
    twist_angle_step: Option<TyF64>,
    twist_center: Option<[TyF64; 2]>,
    tolerance: Option<TyF64>,
    method: Option<String>,
    hide_seams: Option<bool>,
    body_type: Option<BodyType>,
    exec_state: &mut ExecState,
    args: Args,
) -> Result<Vec<Solid>, KclError> {
    let body_type = body_type.unwrap_or_default();

    if matches!(body_type, BodyType::Solid) && extrudables.iter().any(|sk| matches!(sk.is_closed(), ProfileClosed::No))
    {
        return Err(KclError::new_semantic(KclErrorDetails::new(
            "Cannot solid extrude an open profile. Either close the profile, or use a surface extrude.".to_owned(),
            vec![args.source_range],
        )));
    }

    // Extrude the element(s).
    let mut solids = Vec::new();
    let tolerance = LengthUnit(tolerance.as_ref().map(|t| t.to_mm()).unwrap_or(DEFAULT_TOLERANCE_MM));

    let extrude_method = match method.as_deref() {
        Some("new" | "NEW") => ExtrudeMethod::New,
        Some("merge" | "MERGE") => ExtrudeMethod::Merge,
        None => ExtrudeMethod::default(),
        Some(other) => {
            return Err(KclError::new_semantic(KclErrorDetails::new(
                format!("Unknown merge method {other}, try using `MERGE` or `NEW`"),
                vec![args.source_range],
            )));
        }
    };

    if symmetric.unwrap_or(false) && bidirectional_length.is_some() {
        return Err(KclError::new_semantic(KclErrorDetails::new(
            "You cannot give both `symmetric` and `bidirectional` params, you have to choose one or the other"
                .to_owned(),
            vec![args.source_range],
        )));
    }

    if (length.is_some() || twist_angle.is_some()) && to.is_some() {
        return Err(KclError::new_semantic(KclErrorDetails::new(
            "You cannot give `length` or `twist` params with the `to` param, you have to choose one or the other"
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

    for extrudable in &extrudables {
        let extrude_cmd_id = exec_state.next_uuid();
        let sketch_or_face_id = extrudable.id_to_extrude(exec_state, &args, false).await?;
        let cmd = match (&twist_angle, &twist_angle_step, &twist_center, length.clone(), &to) {
            (Some(angle), angle_step, center, Some(length), None) => {
                let center = center.clone().map(point_to_mm).map(Point2d::from).unwrap_or_default();
                let total_rotation_angle = Angle::from_degrees(angle.to_degrees(exec_state, args.source_range));
                let angle_step_size = Angle::from_degrees(
                    angle_step
                        .clone()
                        .map(|a| a.to_degrees(exec_state, args.source_range))
                        .unwrap_or(15.0),
                );
                ModelingCmd::from(
                    mcmd::TwistExtrude::builder()
                        .target(sketch_or_face_id.into())
                        .distance(LengthUnit(length.to_mm()))
                        .center_2d(center)
                        .total_rotation_angle(total_rotation_angle)
                        .angle_step_size(angle_step_size)
                        .tolerance(tolerance)
                        .body_type(body_type)
                        .build(),
                )
            }
            (None, None, None, Some(length), None) => ModelingCmd::from(
                mcmd::Extrude::builder()
                    .target(sketch_or_face_id.into())
                    .distance(LengthUnit(length.to_mm()))
                    .opposite(opposite.clone())
                    .extrude_method(extrude_method)
                    .body_type(body_type)
                    .maybe_merge_coplanar_faces(hide_seams)
                    .build(),
            ),
            (None, None, None, None, Some(to)) => match to {
                Point3dAxis3dOrGeometryReference::Point(point) => ModelingCmd::from(
                    mcmd::ExtrudeToReference::builder()
                        .target(sketch_or_face_id.into())
                        .reference(ExtrudeReference::Point {
                            point: KPoint3d {
                                x: LengthUnit(point[0].to_mm()),
                                y: LengthUnit(point[1].to_mm()),
                                z: LengthUnit(point[2].to_mm()),
                            },
                        })
                        .extrude_method(extrude_method)
                        .body_type(body_type)
                        .build(),
                ),
                Point3dAxis3dOrGeometryReference::Axis { direction, origin } => ModelingCmd::from(
                    mcmd::ExtrudeToReference::builder()
                        .target(sketch_or_face_id.into())
                        .reference(ExtrudeReference::Axis {
                            axis: KPoint3d {
                                x: direction[0].to_mm(),
                                y: direction[1].to_mm(),
                                z: direction[2].to_mm(),
                            },
                            point: KPoint3d {
                                x: LengthUnit(origin[0].to_mm()),
                                y: LengthUnit(origin[1].to_mm()),
                                z: LengthUnit(origin[2].to_mm()),
                            },
                        })
                        .extrude_method(extrude_method)
                        .body_type(body_type)
                        .build(),
                ),
                Point3dAxis3dOrGeometryReference::Plane(plane) => {
                    let plane_id = if plane.is_uninitialized() {
                        if plane.info.origin.units.is_none() {
                            return Err(KclError::new_semantic(KclErrorDetails::new(
                                "Origin of plane has unknown units".to_string(),
                                vec![args.source_range],
                            )));
                        }
                        let sketch_plane = crate::std::sketch::make_sketch_plane_from_orientation(
                            plane.clone().info.into_plane_data(),
                            exec_state,
                            &args,
                        )
                        .await?;
                        sketch_plane.id
                    } else {
                        plane.id
                    };
                    ModelingCmd::from(
                        mcmd::ExtrudeToReference::builder()
                            .target(sketch_or_face_id.into())
                            .reference(ExtrudeReference::EntityReference { entity_id: plane_id })
                            .extrude_method(extrude_method)
                            .body_type(body_type)
                            .build(),
                    )
                }
                Point3dAxis3dOrGeometryReference::Edge(edge_ref) => {
                    let edge_id = edge_ref.get_engine_id(exec_state, &args)?;
                    ModelingCmd::from(
                        mcmd::ExtrudeToReference::builder()
                            .target(sketch_or_face_id.into())
                            .reference(ExtrudeReference::EntityReference { entity_id: edge_id })
                            .extrude_method(extrude_method)
                            .body_type(body_type)
                            .build(),
                    )
                }
                Point3dAxis3dOrGeometryReference::Face(face_tag) => {
                    let face_id = face_tag.get_face_id_from_tag(exec_state, &args, false).await?;
                    ModelingCmd::from(
                        mcmd::ExtrudeToReference::builder()
                            .target(sketch_or_face_id.into())
                            .reference(ExtrudeReference::EntityReference { entity_id: face_id })
                            .extrude_method(extrude_method)
                            .body_type(body_type)
                            .build(),
                    )
                }
                Point3dAxis3dOrGeometryReference::Sketch(sketch_ref) => ModelingCmd::from(
                    mcmd::ExtrudeToReference::builder()
                        .target(sketch_or_face_id.into())
                        .reference(ExtrudeReference::EntityReference {
                            entity_id: sketch_ref.id,
                        })
                        .extrude_method(extrude_method)
                        .body_type(body_type)
                        .build(),
                ),
                Point3dAxis3dOrGeometryReference::Solid(solid) => ModelingCmd::from(
                    mcmd::ExtrudeToReference::builder()
                        .target(sketch_or_face_id.into())
                        .reference(ExtrudeReference::EntityReference { entity_id: solid.id })
                        .extrude_method(extrude_method)
                        .body_type(body_type)
                        .build(),
                ),
                Point3dAxis3dOrGeometryReference::TaggedEdgeOrFace(tag) => {
                    let tagged_edge_or_face = args.get_tag_engine_info(exec_state, tag)?;
                    let tagged_edge_or_face_id = tagged_edge_or_face.id;
                    ModelingCmd::from(
                        mcmd::ExtrudeToReference::builder()
                            .target(sketch_or_face_id.into())
                            .reference(ExtrudeReference::EntityReference {
                                entity_id: tagged_edge_or_face_id,
                            })
                            .extrude_method(extrude_method)
                            .body_type(body_type)
                            .build(),
                    )
                }
            },
            (Some(_), _, _, None, None) => {
                return Err(KclError::new_semantic(KclErrorDetails::new(
                    "The `length` parameter must be provided when using twist angle for extrusion.".to_owned(),
                    vec![args.source_range],
                )));
            }
            (_, _, _, None, None) => {
                return Err(KclError::new_semantic(KclErrorDetails::new(
                    "Either `length` or `to` parameter must be provided for extrusion.".to_owned(),
                    vec![args.source_range],
                )));
            }
            (_, _, _, Some(_), Some(_)) => {
                return Err(KclError::new_semantic(KclErrorDetails::new(
                    "You cannot give both `length` and `to` params, you have to choose one or the other".to_owned(),
                    vec![args.source_range],
                )));
            }
            (_, _, _, _, _) => {
                return Err(KclError::new_semantic(KclErrorDetails::new(
                    "Invalid combination of parameters for extrusion.".to_owned(),
                    vec![args.source_range],
                )));
            }
        };

        let being_extruded = match extrudable {
            Extrudable::Sketch(..) => BeingExtruded::Sketch,
            Extrudable::Face(..) => BeingExtruded::Face,
        };
        if let Some(post_extr_sketch) = extrudable.as_sketch() {
            let cmds = post_extr_sketch.build_sketch_mode_cmds(
                exec_state,
                ModelingCmdReq {
                    cmd_id: extrude_cmd_id.into(),
                    cmd,
                },
            );
            exec_state
                .batch_modeling_cmds(ModelingCmdMeta::from_args_id(exec_state, &args, extrude_cmd_id), &cmds)
                .await?;
            solids.push(
                do_post_extrude(
                    &post_extr_sketch,
                    extrude_cmd_id.into(),
                    false,
                    &NamedCapTags {
                        start: tag_start.as_ref(),
                        end: tag_end.as_ref(),
                    },
                    extrude_method,
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
                "Expected a sketch for extrusion".to_owned(),
                vec![args.source_range],
            )));
        }
    }

    Ok(solids)
}

#[derive(Debug, Default)]
pub(crate) struct NamedCapTags<'a> {
    pub start: Option<&'a TagNode>,
    pub end: Option<&'a TagNode>,
}

#[derive(Debug, Clone, Copy)]
pub enum BeingExtruded {
    Sketch,
    Face,
}

#[allow(clippy::too_many_arguments)]
pub(crate) async fn do_post_extrude<'a>(
    sketch: &Sketch,
    extrude_cmd_id: ArtifactId,
    sectional: bool,
    named_cap_tags: &'a NamedCapTags<'a>,
    extrude_method: ExtrudeMethod,
    exec_state: &mut ExecState,
    args: &Args,
    edge_id: Option<Uuid>,
    clone_id_map: Option<&HashMap<Uuid, Uuid>>, // old sketch id -> new sketch id
    body_type: BodyType,
    being_extruded: BeingExtruded,
) -> Result<Solid, KclError> {
    // Bring the object to the front of the scene.
    // See: https://github.com/KittyCAD/modeling-app/issues/806

    exec_state
        .batch_modeling_cmd(
            ModelingCmdMeta::from_args(exec_state, args),
            ModelingCmd::from(mcmd::ObjectBringToFront::builder().object_id(sketch.id).build()),
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

    // If the sketch is a clone, we will use the original info to get the extrusion face info.
    let mut extrusion_info_edge_id = any_edge_id;
    if sketch.clone.is_some() && clone_id_map.is_some() {
        extrusion_info_edge_id = if let Some(clone_map) = clone_id_map {
            if let Some(new_edge_id) = clone_map.get(&extrusion_info_edge_id) {
                *new_edge_id
            } else {
                extrusion_info_edge_id
            }
        } else {
            any_edge_id
        };
    }

    let mut sketch = sketch.clone();
    match body_type {
        BodyType::Solid => {
            sketch.is_closed = ProfileClosed::Explicitly;
        }
        BodyType::Surface => {}
    }

    // 1st time: Merge, Sketch
    // 2nd time: New, Face
    match (extrude_method, being_extruded) {
        (ExtrudeMethod::Merge, BeingExtruded::Face) => {
            // Merge the IDs.
            // If we were sketching on a face, we need the original face id.
            if let SketchSurface::Face(ref face) = sketch.on {
                match extrude_method {
                    // If we are creating a new body we need to preserve its new id.
                    ExtrudeMethod::New => {
                        // The sketch's ID is already correct here, it should be the ID of the sketch.
                    }
                    // If we're merging into an existing body, then assign the existing body's ID,
                    // because the variable binding for this solid won't be its own object, it's just modifying the original one.
                    ExtrudeMethod::Merge => sketch.id = face.solid.sketch.id,
                }
            }
        }
        (ExtrudeMethod::New, BeingExtruded::Face) => {
            // We're creating a new solid, it's not based on any existing sketch (it's based on a face).
            // So we need a new ID, the extrude command ID.
            sketch.id = extrude_cmd_id.into();
        }
        (ExtrudeMethod::New, BeingExtruded::Sketch) => {
            // If we are creating a new body we need to preserve its new id.
            // The sketch's ID is already correct here, it should be the ID of the sketch.
        }
        (ExtrudeMethod::Merge, BeingExtruded::Sketch) => {
            if let SketchSurface::Face(ref face) = sketch.on {
                match extrude_method {
                    // If we are creating a new body we need to preserve its new id.
                    ExtrudeMethod::New => {
                        // The sketch's ID is already correct here, it should be the ID of the sketch.
                    }
                    // If we're merging into an existing body, then assign the existing body's ID,
                    // because the variable binding for this solid won't be its own object, it's just modifying the original one.
                    ExtrudeMethod::Merge => sketch.id = face.solid.sketch.id,
                }
            }
        }
    }

    // Similarly, if the sketch is a clone, we need to use the original sketch id to get the extrusion face info.
    let sketch_id = if let Some(cloned_from) = sketch.clone
        && clone_id_map.is_some()
    {
        cloned_from
    } else {
        sketch.id
    };

    let solid3d_info = exec_state
        .send_modeling_cmd(
            ModelingCmdMeta::from_args(exec_state, args),
            ModelingCmd::from(
                mcmd::Solid3dGetExtrusionFaceInfo::builder()
                    .edge_id(extrusion_info_edge_id)
                    .object_id(sketch_id)
                    .build(),
            ),
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
                    ModelingCmdMeta::from_args(exec_state, args),
                    ModelingCmd::from(
                        mcmd::Solid3dGetAdjacencyInfo::builder()
                            .object_id(sketch.id)
                            .edge_id(any_edge_id)
                            .build(),
                    ),
                )
                .await?;
        }
    }

    let Faces {
        sides: mut face_id_map,
        start_cap_id,
        end_cap_id,
    } = analyze_faces(exec_state, args, face_infos).await;

    // If this is a clone, we will use the clone_id_map to map the face info from the original sketch to the clone sketch.
    if sketch.clone.is_some()
        && let Some(clone_id_map) = clone_id_map
    {
        face_id_map = face_id_map
            .into_iter()
            .filter_map(|(k, v)| {
                let fe_key = clone_id_map.get(&k)?;
                let fe_value = clone_id_map.get(&(v?)).copied();
                Some((*fe_key, fe_value))
            })
            .collect::<HashMap<Uuid, Option<Uuid>>>();
    }

    // Iterate over the sketch.value array and add face_id to GeoMeta
    let no_engine_commands = args.ctx.no_engine_commands().await;
    let mut new_value: Vec<ExtrudeSurface> = Vec::with_capacity(sketch.paths.len() + sketch.inner_paths.len() + 2);
    let outer_surfaces = sketch.paths.iter().flat_map(|path| {
        if let Some(Some(actual_face_id)) = face_id_map.get(&path.get_base().geo_meta.id) {
            surface_of(path, *actual_face_id)
        } else if no_engine_commands {
            crate::log::logln!(
                "No face ID found for path ID {:?}, but in no-engine-commands mode, so faking it",
                path.get_base().geo_meta.id
            );
            // Only pre-populate the extrude surface if we are in mock mode.
            fake_extrude_surface(exec_state, path)
        } else if sketch.clone.is_some()
            && let Some(clone_map) = clone_id_map
        {
            let new_path = clone_map.get(&(path.get_base().geo_meta.id));

            if let Some(new_path) = new_path {
                match face_id_map.get(new_path) {
                    Some(Some(actual_face_id)) => clone_surface_of(path, *new_path, *actual_face_id),
                    _ => {
                        let actual_face_id = face_id_map.iter().find_map(|(key, value)| {
                            if let Some(value) = value {
                                if value == new_path { Some(key) } else { None }
                            } else {
                                None
                            }
                        });
                        match actual_face_id {
                            Some(actual_face_id) => clone_surface_of(path, *new_path, *actual_face_id),
                            None => {
                                crate::log::logln!("No face ID found for clone path ID {:?}, so skipping it", new_path);
                                None
                            }
                        }
                    }
                }
            } else {
                None
            }
        } else {
            crate::log::logln!(
                "No face ID found for path ID {:?}, and not in no-engine-commands mode, so skipping it",
                path.get_base().geo_meta.id
            );
            None
        }
    });

    new_value.extend(outer_surfaces);
    let inner_surfaces = sketch.inner_paths.iter().flat_map(|path| {
        if let Some(Some(actual_face_id)) = face_id_map.get(&path.get_base().geo_meta.id) {
            surface_of(path, *actual_face_id)
        } else if no_engine_commands {
            // Only pre-populate the extrude surface if we are in mock mode.
            fake_extrude_surface(exec_state, path)
        } else {
            None
        }
    });
    new_value.extend(inner_surfaces);

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
        id: sketch.id,
        artifact_id: extrude_cmd_id,
        value: new_value,
        meta: sketch.meta.clone(),
        units: sketch.units,
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
fn surface_of(path: &Path, actual_face_id: Uuid) -> Option<ExtrudeSurface> {
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
                face_id: actual_face_id,
                tag: path.get_base().tag.clone(),
                geo_meta: GeoMeta {
                    id: path.get_base().geo_meta.id,
                    metadata: path.get_base().geo_meta.metadata,
                },
            });
            Some(extrude_surface)
        }
        Path::Base { .. } | Path::ToPoint { .. } | Path::Horizontal { .. } | Path::AngledLineTo { .. } | Path::Bezier { .. } => {
            let extrude_surface = ExtrudeSurface::ExtrudePlane(crate::execution::ExtrudePlane {
                face_id: actual_face_id,
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
                face_id: actual_face_id,
                tag: path.get_base().tag.clone(),
                geo_meta: GeoMeta {
                    id: path.get_base().geo_meta.id,
                    metadata: path.get_base().geo_meta.metadata,
                },
            });
            Some(extrude_surface)
        }
    }
}

fn clone_surface_of(path: &Path, clone_path_id: Uuid, actual_face_id: Uuid) -> Option<ExtrudeSurface> {
    match path {
        Path::Arc { .. }
        | Path::TangentialArc { .. }
        | Path::TangentialArcTo { .. }
        // TODO: (gserena) fix me
        | Path::Ellipse { .. }
        | Path::Conic {.. }
        | Path::Circle { .. }
        | Path::CircleThreePoint { .. } => {
            let extrude_surface = ExtrudeSurface::ExtrudeArc(crate::execution::ExtrudeArc {
                face_id: actual_face_id,
                tag: path.get_base().tag.clone(),
                geo_meta: GeoMeta {
                    id: clone_path_id,
                    metadata: path.get_base().geo_meta.metadata,
                },
            });
            Some(extrude_surface)
        }
        Path::Base { .. } | Path::ToPoint { .. } | Path::Horizontal { .. } | Path::AngledLineTo { .. } | Path::Bezier { .. } => {
            let extrude_surface = ExtrudeSurface::ExtrudePlane(crate::execution::ExtrudePlane {
                face_id: actual_face_id,
                tag: path.get_base().tag.clone(),
                geo_meta: GeoMeta {
                    id: clone_path_id,
                    metadata: path.get_base().geo_meta.metadata,
                },
            });
            Some(extrude_surface)
        }
        Path::ArcThreePoint { .. } => {
            let extrude_surface = ExtrudeSurface::ExtrudeArc(crate::execution::ExtrudeArc {
                face_id: actual_face_id,
                tag: path.get_base().tag.clone(),
                geo_meta: GeoMeta {
                    id: clone_path_id,
                    metadata: path.get_base().geo_meta.metadata,
                },
            });
            Some(extrude_surface)
        }
    }
}

/// Create a fake extrude surface to report for mock execution, when there's no engine response.
fn fake_extrude_surface(exec_state: &mut ExecState, path: &Path) -> Option<ExtrudeSurface> {
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
}
