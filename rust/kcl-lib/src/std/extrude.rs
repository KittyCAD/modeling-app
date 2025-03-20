//! Functions related to extruding.

use std::collections::HashMap;

use anyhow::Result;
use kcl_derive_docs::stdlib;
use kcmc::{
    each_cmd as mcmd,
    length_unit::LengthUnit,
    ok_response::OkModelingCmdResponse,
    output::ExtrusionFaceInfo,
    shared::ExtrusionFaceCapType,
    websocket::{ModelingCmdReq, OkWebSocketResponseData},
    ModelingCmd,
};
use kittycad_modeling_cmds as kcmc;
use uuid::Uuid;

use crate::{
    errors::{KclError, KclErrorDetails},
    execution::{
        kcl_value::{ArrayLen, RuntimeType},
        ArtifactId, ExecState, ExtrudeSurface, GeoMeta, KclValue, Path, PrimitiveType, Sketch, SketchSurface, Solid,
    },
    parsing::ast::types::TagNode,
    std::Args,
};

/// Extrudes by a given amount.
pub async fn extrude(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let sketches = args.get_unlabeled_kw_arg_typed(
        "sketches",
        &RuntimeType::Array(PrimitiveType::Sketch, ArrayLen::NonEmpty),
        exec_state,
    )?;
    let length = args.get_kw_arg("length")?;
    let tag_start = args.get_kw_arg_opt("tagStart")?;
    let tag_end = args.get_kw_arg_opt("tagEnd")?;

    let result = inner_extrude(sketches, length, tag_start, tag_end, exec_state, args).await?;

    Ok(result.into())
}

/// Extend a 2-dimensional sketch through a third dimension in order to
/// create new 3-dimensional volume, or if extruded into an existing volume,
/// cut into an existing solid.
///
/// You can provide more than one sketch to extrude, and they will all be
/// extruded in the same direction.
///
/// ```no_run
/// example = startSketchOn('XZ')
///   |> startProfileAt([0, 0], %)
///   |> line(end = [10, 0])
///   |> arc({
///     angleStart = 120,
///     angleEnd = 0,
///     radius = 5,
///   }, %)
///   |> line(end = [5, 0])
///   |> line(end = [0, 10])
///   |> bezierCurve({
///     control1 = [-10, 0],
///     control2 = [2, 10],
///     to = [-5, 10],
///   }, %)
///   |> line(end = [-5, -2])
///   |> close()
///   |> extrude(length = 10)
/// ```
///
/// ```no_run
/// exampleSketch = startSketchOn('XZ')
///   |> startProfileAt([-10, 0], %)
///   |> arc({
///     angleStart = 120,
///     angleEnd = -60,
///     radius = 5,
///   }, %)
///   |> line(end = [10, 0])
///   |> line(end = [5, 0])
///   |> bezierCurve({
///     control1 = [-3, 0],
///     control2 = [2, 10],
///     to = [-5, 10],
///   }, %)
///   |> line(end = [-4, 10])
///   |> line(end = [-5, -2])
///   |> close()
///
/// example = extrude(exampleSketch, length = 10)
/// ```
#[stdlib {
    name = "extrude",
    feature_tree_operation = true,
    keywords = true,
    unlabeled_first = true,
    args = {
        sketches = { docs = "Which sketch or sketches should be extruded"},
        length = { docs = "How far to extrude the given sketches"},
        tag_start = { docs = "A named tag for the face at the start of the extrusion, i.e. the original sketch" },
        tag_end = { docs = "A named tag for the face at the end of the extrusion, i.e. the new face created by extruding the original sketch" },
    }
}]
#[allow(clippy::too_many_arguments)]
async fn inner_extrude(
    sketches: Vec<Sketch>,
    length: f64,
    tag_start: Option<TagNode>,
    tag_end: Option<TagNode>,
    exec_state: &mut ExecState,
    args: Args,
) -> Result<Vec<Solid>, KclError> {
    // Extrude the element(s).
    let mut solids = Vec::new();
    for sketch in &sketches {
        let id = exec_state.next_uuid();
        args.batch_modeling_cmds(&sketch.build_sketch_mode_cmds(
            exec_state,
            ModelingCmdReq {
                cmd_id: id.into(),
                cmd: ModelingCmd::from(mcmd::Extrude {
                    target: sketch.id.into(),
                    distance: LengthUnit(length),
                    faces: Default::default(),
                }),
            },
        ))
        .await?;

        solids.push(
            do_post_extrude(
                sketch,
                id.into(),
                length,
                false,
                &NamedCapTags {
                    start: tag_start.as_ref(),
                    end: tag_end.as_ref(),
                },
                exec_state,
                &args,
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

pub(crate) async fn do_post_extrude<'a>(
    sketch: &Sketch,
    solid_id: ArtifactId,
    length: f64,
    sectional: bool,
    named_cap_tags: &'a NamedCapTags<'a>,
    exec_state: &mut ExecState,
    args: &Args,
) -> Result<Solid, KclError> {
    // Bring the object to the front of the scene.
    // See: https://github.com/KittyCAD/modeling-app/issues/806
    args.batch_modeling_cmd(
        exec_state.next_uuid(),
        ModelingCmd::from(mcmd::ObjectBringToFront { object_id: sketch.id }),
    )
    .await?;

    // The "get extrusion face info" API call requires *any* edge on the sketch being extruded.
    // So, let's just use the first one.
    let Some(any_edge_id) = sketch.paths.first().map(|edge| edge.get_base().geo_meta.id) else {
        return Err(KclError::Type(KclErrorDetails {
            message: "Expected a non-empty sketch".to_string(),
            source_ranges: vec![args.source_range],
        }));
    };

    let mut sketch = sketch.clone();

    // If we were sketching on a face, we need the original face id.
    if let SketchSurface::Face(ref face) = sketch.on {
        sketch.id = face.solid.sketch.id;
    }

    let solid3d_info = args
        .send_modeling_cmd(
            exec_state.next_uuid(),
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

    // Face filtering attempt in order to resolve https://github.com/KittyCAD/modeling-app/issues/5328
    // In case of a sectional sweep, empirically it looks that the first n faces that are yielded from the sweep
    // are the ones that work with GetOppositeEdge and GetNextAdjacentEdge, aka the n sides in the sweep.
    // So here we're figuring out that n number as yielded_sides_count here,
    // making sure that circle() calls count but close() don't (no length)
    let count_of_first_set_of_faces_if_sectional = if sectional {
        sketch
            .paths
            .iter()
            .filter(|p| {
                let is_circle = matches!(p, Path::Circle { .. });
                let has_length = p.get_base().from != p.get_base().to;
                is_circle || has_length
            })
            .count()
    } else {
        usize::MAX
    };

    for (curve_id, face_id) in face_infos
        .iter()
        .filter(|face_info| face_info.cap == ExtrusionFaceCapType::None)
        .filter_map(|face_info| {
            if let (Some(curve_id), Some(face_id)) = (face_info.curve_id, face_info.face_id) {
                Some((curve_id, face_id))
            } else {
                None
            }
        })
        .take(count_of_first_set_of_faces_if_sectional)
    {
        // Batch these commands, because the Rust code doesn't actually care about the outcome.
        // So, there's no need to await them.
        // Instead, the Typescript codebases (which handles WebSocket sends when compiled via Wasm)
        // uses this to build the artifact graph, which the UI needs.
        args.batch_modeling_cmd(
            exec_state.next_uuid(),
            ModelingCmd::from(mcmd::Solid3dGetOppositeEdge {
                edge_id: curve_id,
                object_id: sketch.id,
                face_id,
            }),
        )
        .await?;

        args.batch_modeling_cmd(
            exec_state.next_uuid(),
            ModelingCmd::from(mcmd::Solid3dGetNextAdjacentEdge {
                edge_id: curve_id,
                object_id: sketch.id,
                face_id,
            }),
        )
        .await?;
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
            return Err(KclError::Type(KclErrorDetails {
                message: format!(
                    "Expected a start cap ID for tag `{}` for extrusion of sketch {:?}",
                    tag_start.name, sketch.id
                ),
                source_ranges: vec![args.source_range],
            }));
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
            return Err(KclError::Type(KclErrorDetails {
                message: format!(
                    "Expected an end cap ID for tag `{}` for extrusion of sketch {:?}",
                    tag_end.name, sketch.id
                ),
                source_ranges: vec![args.source_range],
            }));
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
        sketch,
        height: length,
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
