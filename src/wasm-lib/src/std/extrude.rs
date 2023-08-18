//! Functions related to extruding.

use crate::{
    errors::{KclError, KclErrorDetails},
    executor::{ExtrudeGroup, MemoryItem},
    std::Args,
};

use anyhow::Result;

/// Extrudes by a given amount.
pub fn extrude(args: &mut Args) -> Result<MemoryItem, KclError> {
    let (length, sketch_group) = args.get_number_sketch_group()?;

    let id = uuid::Uuid::new_v4();

    let cmd = kittycad::types::ModelingCmd::Extrude {
        target: sketch_group.id,
        distance: length,
        cap: true,
    };
    args.send_modeling_cmd(id, cmd)?;

    Ok(MemoryItem::ExtrudeGroup(ExtrudeGroup {
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
pub fn get_extrude_wall_transform(args: &mut Args) -> Result<MemoryItem, KclError> {
    let (surface_name, extrude_group) = args.get_path_name_extrude_group()?;
    let surface = extrude_group
        .get_path_by_name(&surface_name)
        .ok_or_else(|| {
            KclError::Type(KclErrorDetails {
                message: format!(
                    "Expected a surface name that exists in the given ExtrudeGroup, found `{}`",
                    surface_name
                ),
                source_ranges: vec![args.source_range],
            })
        })?;

    Ok(MemoryItem::ExtrudeTransform {
        position: surface.get_position(),
        rotation: surface.get_rotation(),
        meta: extrude_group.meta,
    })
}
