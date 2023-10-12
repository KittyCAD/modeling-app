//! Functions related to extruding.

use anyhow::Result;
use derive_docs::stdlib;
use schemars::JsonSchema;

use crate::{
    errors::{KclError, KclErrorDetails},
    executor::{ExtrudeGroup, ExtrudeTransform, MemoryItem, SketchGroup},
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
    // Extrude the element.
    args.send_modeling_cmd(
        uuid::Uuid::new_v4(),
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
        kittycad::types::ModelingCmd::ObjectBringToFront { uuid: sketch_group.id },
    )
    .await?;

    Ok(Box::new(ExtrudeGroup {
        id,
        // TODO, this is just an empty array now, should be deleted. This
        // comment was originally in the JS code.
        value: Default::default(),
        height: length,
        position: sketch_group.position,
        rotation: sketch_group.rotation,
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
