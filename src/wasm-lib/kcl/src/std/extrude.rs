//! Functions related to extruding.

use anyhow::Result;
use derive_docs::stdlib;
use schemars::JsonSchema;

use crate::{
    errors::{KclError, KclErrorDetails},
    executor::{ExtrudeGroup, ExtrudeSurface, ExtrudeTransform, GeoMeta, MemoryItem, Path, SketchGroup},
    std::Args,
};

/// Extrudes by a given amount.
pub async fn extrude(args: Args) -> Result<MemoryItem, KclError> {
    let (length, sketch_group) = args.get_number_sketch_group()?;

    let result = inner_extrude(length, sketch_group, args).await?;

    Ok(MemoryItem::ExtrudeGroup(result))
}

/// Extrudes by a given amount.
#[stdlib {
    name = "extrude"
}]
async fn inner_extrude(length: f64, sketch_group: Box<SketchGroup>, args: Args) -> Result<Box<ExtrudeGroup>, KclError> {
    let id = uuid::Uuid::new_v4();
    // Extrude the element.
    args.send_modeling_cmd(
        id,
        kittycad::types::ModelingCmd::Extrude {
            target: sketch_group.id,
            distance: length,
            cap: true,
        },
    )
    .await?;

    // Bring the object to the front of the scene.
    // See: https://github.com/KittyCAD/modeling-app/issues/806
    args.send_modeling_cmd(
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

    // Create a hashmap for quick id lookup
    let mut face_id_map = std::collections::HashMap::new();
    let mut start_cap_id = None;
    let mut end_cap_id = None;

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
            let extrude_surface = ExtrudeSurface::ExtrudePlane(crate::executor::ExtrudePlane {
                position: sketch_group.position, // TODO should be for the extrude surface
                rotation: sketch_group.rotation, // TODO should be for the extrude surface
                face_id: *actual_face_id,
                name: path.get_base().name.clone(),
                geo_meta: GeoMeta {
                    id: path.get_base().geo_meta.id,
                    metadata: path.get_base().geo_meta.metadata.clone(),
                },
            });
            new_value.push(extrude_surface);
        }
    }

    Ok(Box::new(ExtrudeGroup {
        id: sketch_group.id,
        value: new_value,
        height: length,
        position: sketch_group.position,
        rotation: sketch_group.rotation,
        x_axis: sketch_group.x_axis,
        y_axis: sketch_group.y_axis,
        z_axis: sketch_group.z_axis,
        start_cap_id,
        end_cap_id,
        meta: sketch_group.meta,
    }))
}

/// Returns the extrude wall transform.
pub async fn get_extrude_wall_transform(args: Args) -> Result<MemoryItem, KclError> {
    let (surface_name, extrude_group) = args.get_path_name_extrude_group()?;
    let result = inner_get_extrude_wall_transform(&surface_name, *extrude_group, args)?;
    Ok(MemoryItem::ExtrudeTransform(result))
}

/// Returns the extrude wall transform.
#[stdlib {
    name = "getExtrudeWallTransform"
}]
fn inner_get_extrude_wall_transform(
    surface_name: &str,
    extrude_group: ExtrudeGroup,
    args: Args,
) -> Result<Box<ExtrudeTransform>, KclError> {
    let surface = extrude_group.get_path_by_name(surface_name).ok_or_else(|| {
        KclError::Type(KclErrorDetails {
            message: format!(
                "Expected a surface name that exists in the given ExtrudeGroup, found `{}`",
                surface_name
            ),
            source_ranges: vec![args.source_range],
        })
    })?;

    Ok(Box::new(ExtrudeTransform {
        position: surface.get_position(),
        rotation: surface.get_rotation(),
        meta: extrude_group.meta,
    }))
}
