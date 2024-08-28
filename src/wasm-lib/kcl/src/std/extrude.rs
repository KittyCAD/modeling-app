//! Functions related to extruding.

use anyhow::Result;
use derive_docs::stdlib;
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
                    Some(plane.z_axis.clone().into())
                } else {
                    None
                },
            },
        )
        .await?;

        args.send_modeling_cmd(
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
        extrude_groups.push(do_post_extrude(sketch_group.clone(), length, id, args.clone()).await?);
    }

    Ok(extrude_groups.into())
}

pub(crate) async fn do_post_extrude(
    sketch_group: SketchGroup,
    length: f64,
    id: Uuid,
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
            id,
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

    for face_info in face_infos.iter() {
        if face_info.cap == kittycad::types::ExtrusionFaceCapType::None {
            if let (Some(curve_id), Some(face_id)) = (face_info.curve_id, face_info.face_id) {
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
        }
    }

    // Create a hashmap for quick id lookup
    let mut face_id_map = std::collections::HashMap::new();
    // creating fake ids for start and end caps is to make extrudes mock-execute safe
    let mut start_cap_id = if args.ctx.is_mock { Some(Uuid::new_v4()) } else { None };
    let mut end_cap_id = if args.ctx.is_mock { Some(Uuid::new_v4()) } else { None };

    for face_info in face_infos {
        match face_info.cap {
            kittycad::types::ExtrusionFaceCapType::Bottom => start_cap_id = face_info.face_id,
            kittycad::types::ExtrusionFaceCapType::Top => end_cap_id = face_info.face_id,
            _ => {
                if let Some(curve_id) = face_info.curve_id {
                    face_id_map.insert(curve_id, face_info.face_id);
                }
            }
        }
    }

    // Iterate over the sketch_group.value array and add face_id to GeoMeta
    let mut new_value: Vec<ExtrudeSurface> = Vec::new();
    for path in sketch_group.value.iter() {
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
                    new_value.push(extrude_surface);
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
                    new_value.push(extrude_surface);
                }
            }
        } else if args.ctx.is_mock {
            // Only pre-populate the extrude surface if we are in mock mode.
            new_value.push(ExtrudeSurface::ExtrudePlane(crate::executor::ExtrudePlane {
                // pushing this values with a fake face_id to make extrudes mock-execute safe
                face_id: Uuid::new_v4(),
                tag: path.get_base().tag.clone(),
                geo_meta: GeoMeta {
                    id: path.get_base().geo_meta.id,
                    metadata: path.get_base().geo_meta.metadata.clone(),
                },
            }));
        }
    }

    Ok(Box::new(ExtrudeGroup {
        // Ok so you would think that the id would be the id of the extrude group,
        // that we passed in to the function, but it's actually the id of the
        // sketch group.
        id: sketch_group.id,
        value: new_value,
        sketch_group: sketch_group.clone(),
        height: length,
        start_cap_id,
        end_cap_id,
        edge_cuts: vec![],
        meta: sketch_group.meta,
    }))
}
