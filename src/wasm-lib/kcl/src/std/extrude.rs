//! Functions related to extruding.

use std::collections::HashMap;

use anyhow::Result;
use derive_docs::stdlib;
use kittycad::types::{ExtrusionFaceCapType, ExtrusionFaceInfo};
use schemars::JsonSchema;
use uuid::Uuid;

use crate::{
    errors::{KclError, KclErrorDetails},
    executor::{
        ExtrudeGroup, ExtrudeGroupSet, ExtrudeSurface, GeoMeta, KclValue, Path, SketchGroup, SketchGroupSet,
        SketchSurface,
    },
    std::Args,
};

/// Extrudes by a given amount.
pub async fn extrude(args: Args) -> Result<KclValue, KclError> {
    let (length, sketch_group_set) = args.get_number_sketch_group_set()?;

    let result = inner_extrude(length, sketch_group_set, args).await?;

    Ok(result.into())
}

/// Extend a 2-dimensional sketch through a third dimension in order to
/// create new 3-dimensional volume, or if extruded into an existing volume,
/// cut into an existing solid.
///
/// ```no_run
/// const example = startSketchOn('XZ')
///   |> startProfileAt([0, 0], %)
///   |> line([10, 0], %)
///   |> arc({
///     angleStart: 120,
///     angleEnd: 0,
///     radius: 5,
///   }, %)
///   |> line([5, 0], %)
///   |> line([0, 10], %)
///   |> bezierCurve({
///     control1: [-10, 0],
///     control2: [2, 10],
///     to: [-5, 10],
///   }, %)
///   |> line([-5, -2], %)
///   |> close(%)
///   |> extrude(10, %)
/// ```
///
/// ```no_run
/// const exampleSketch = startSketchOn('XZ')
///   |> startProfileAt([-10, 0], %)
///   |> arc({
///     angleStart: 120,
///     angleEnd: -60,
///     radius: 5,
///   }, %)
///   |> line([10, 0], %)
///   |> line([5, 0], %)
///   |> bezierCurve({
///     control1: [-3, 0],
///     control2: [2, 10],
///     to: [-5, 10],
///   }, %)
///   |> line([-4, 10], %)
///   |> line([-5, -2], %)
///   |> close(%)
///
/// const example = extrude(10, exampleSketch)
/// ```
#[stdlib {
    name = "extrude"
}]
async fn inner_extrude(length: f64, sketch_group_set: SketchGroupSet, args: Args) -> Result<ExtrudeGroupSet, KclError> {
    let id = uuid::Uuid::new_v4();

    // Extrude the element(s).
    let sketch_groups: Vec<SketchGroup> = sketch_group_set.into();
    let mut extrude_groups = Vec::new();
    for sketch_group in &sketch_groups {
        // Before we extrude, we need to enable the sketch mode.
        // We do this here in case extrude is called out of order.
        args.batch_modeling_cmd(
            uuid::Uuid::new_v4(),
            kittycad::types::ModelingCmd::EnableSketchMode {
                animated: false,
                ortho: false,
                entity_id: sketch_group.on.id(),
                adjust_camera: false,
                planar_normal: if let SketchSurface::Plane(plane) = &sketch_group.on {
                    // We pass in the normal for the plane here.
                    Some(plane.z_axis.into())
                } else {
                    None
                },
            },
        )
        .await?;

        args.batch_modeling_cmd(
            id,
            kittycad::types::ModelingCmd::Extrude {
                target: sketch_group.id,
                distance: length,
                cap: true,
            },
        )
        .await?;

        // Disable the sketch mode.
        args.batch_modeling_cmd(uuid::Uuid::new_v4(), kittycad::types::ModelingCmd::SketchModeDisable {})
            .await?;
        extrude_groups.push(do_post_extrude(sketch_group.clone(), length, args.clone()).await?);
    }

    Ok(extrude_groups.into())
}

pub(crate) async fn do_post_extrude(
    sketch_group: SketchGroup,
    length: f64,
    args: Args,
) -> Result<Box<ExtrudeGroup>, KclError> {
    // Bring the object to the front of the scene.
    // See: https://github.com/KittyCAD/modeling-app/issues/806
    args.batch_modeling_cmd(
        uuid::Uuid::new_v4(),
        kittycad::types::ModelingCmd::ObjectBringToFront {
            object_id: sketch_group.id,
        },
    )
    .await?;

    if sketch_group.value.is_empty() {
        return Err(KclError::Type(KclErrorDetails {
            message: "Expected a non-empty sketch group".to_string(),
            source_ranges: vec![args.source_range],
        }));
    }

    let mut edge_id = None;
    for segment in sketch_group.value.iter() {
        if let Path::ToPoint { base } = segment {
            edge_id = Some(base.geo_meta.id);
            break;
        }
    }

    let Some(edge_id) = edge_id else {
        return Err(KclError::Type(KclErrorDetails {
            message: "Expected a Path::ToPoint variant".to_string(),
            source_ranges: vec![args.source_range],
        }));
    };

    let mut sketch_group = sketch_group.clone();

    // If we were sketching on a face, we need the original face id.
    if let SketchSurface::Face(ref face) = sketch_group.on {
        sketch_group.id = face.extrude_group.sketch_group.id;
    }

    let solid3d_info = args
        .send_modeling_cmd(
            uuid::Uuid::new_v4(),
            kittycad::types::ModelingCmd::Solid3DGetExtrusionFaceInfo {
                edge_id,
                object_id: sketch_group.id,
            },
        )
        .await?;

    let face_infos = if let kittycad::types::OkWebSocketResponseData::Modeling {
        modeling_response: kittycad::types::OkModelingCmdResponse::Solid3DGetExtrusionFaceInfo { data },
    } = solid3d_info
    {
        data.faces
    } else {
        vec![]
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
    {
        // Batch these commands, because the Rust code doesn't actually care about the outcome.
        // So, there's no need to await them.
        // Instead, the Typescript codebases (which handles WebSocket sends when compiled via Wasm)
        // uses this to build the artifact graph, which the UI needs.
        args.batch_modeling_cmd(
            uuid::Uuid::new_v4(),
            kittycad::types::ModelingCmd::Solid3DGetOppositeEdge {
                edge_id: curve_id,
                object_id: sketch_group.id,
                face_id,
            },
        )
        .await?;

        args.batch_modeling_cmd(
            uuid::Uuid::new_v4(),
            kittycad::types::ModelingCmd::Solid3DGetPrevAdjacentEdge {
                edge_id: curve_id,
                object_id: sketch_group.id,
                face_id,
            },
        )
        .await?;
    }

    let Faces {
        sides: face_id_map,
        start_cap_id,
        end_cap_id,
    } = analyze_faces(&args, face_infos);
    // Iterate over the sketch_group.value array and add face_id to GeoMeta
    let new_value = sketch_group
        .value
        .iter()
        .flat_map(|path| {
            if let Some(Some(actual_face_id)) = face_id_map.get(&path.get_base().geo_meta.id) {
                match path {
                    Path::TangentialArc { .. } | Path::TangentialArcTo { .. } => {
                        let extrude_surface = ExtrudeSurface::ExtrudeArc(crate::executor::ExtrudeArc {
                            face_id: *actual_face_id,
                            tag: path.get_base().tag.clone(),
                            geo_meta: GeoMeta {
                                id: path.get_base().geo_meta.id,
                                metadata: path.get_base().geo_meta.metadata.clone(),
                            },
                        });
                        Some(extrude_surface)
                    }
                    Path::Base { .. } | Path::ToPoint { .. } | Path::Horizontal { .. } | Path::AngledLineTo { .. } => {
                        let extrude_surface = ExtrudeSurface::ExtrudePlane(crate::executor::ExtrudePlane {
                            face_id: *actual_face_id,
                            tag: path.get_base().tag.clone(),
                            geo_meta: GeoMeta {
                                id: path.get_base().geo_meta.id,
                                metadata: path.get_base().geo_meta.metadata.clone(),
                            },
                        });
                        Some(extrude_surface)
                    }
                }
            } else if args.ctx.is_mock {
                // Only pre-populate the extrude surface if we are in mock mode.

                let extrude_surface = ExtrudeSurface::ExtrudePlane(crate::executor::ExtrudePlane {
                    // pushing this values with a fake face_id to make extrudes mock-execute safe
                    face_id: Uuid::new_v4(),
                    tag: path.get_base().tag.clone(),
                    geo_meta: GeoMeta {
                        id: path.get_base().geo_meta.id,
                        metadata: path.get_base().geo_meta.metadata.clone(),
                    },
                });
                Some(extrude_surface)
            } else {
                None
            }
        })
        .collect();

    Ok(Box::new(ExtrudeGroup {
        // Ok so you would think that the id would be the id of the extrude group,
        // that we passed in to the function, but it's actually the id of the
        // sketch group.
        id: sketch_group.id,
        value: new_value,
        meta: sketch_group.meta.clone(),
        sketch_group,
        height: length,
        start_cap_id,
        end_cap_id,
        edge_cuts: vec![],
    }))
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

fn analyze_faces(args: &Args, face_infos: Vec<ExtrusionFaceInfo>) -> Faces {
    let mut faces = Faces {
        sides: HashMap::with_capacity(face_infos.len()),
        ..Default::default()
    };
    if args.ctx.is_mock {
        // Create fake IDs for start and end caps, to make extrudes mock-execute safe
        faces.start_cap_id = Some(Uuid::new_v4());
        faces.end_cap_id = Some(Uuid::new_v4());
    }
    for face_info in face_infos {
        match face_info.cap {
            ExtrusionFaceCapType::Bottom => faces.start_cap_id = face_info.face_id,
            ExtrusionFaceCapType::Top => faces.end_cap_id = face_info.face_id,
            ExtrusionFaceCapType::None => {
                if let Some(curve_id) = face_info.curve_id {
                    faces.sides.insert(curve_id, face_info.face_id);
                }
            }
        }
    }
    faces
}
