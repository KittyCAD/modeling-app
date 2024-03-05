//! Standard library fillets.

use anyhow::Result;
use derive_docs::stdlib;
use kittycad::types::ModelingCmd;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{
    errors::{KclError, KclErrorDetails},
    executor::{ExtrudeGroup, ExtrudeSurface, MemoryItem, UserVal},
    std::Args,
};

/// Data for fillets.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct FilletData {
    /// The radius of the fillet.
    pub radius: f64,
    /// The tags of the paths you want to fillet.
    pub tags: Vec<StringOrUuid>,
}

/// A string or a uuid.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema, Ord, PartialOrd, Eq, Hash)]
#[serde(untagged)]
pub enum StringOrUuid {
    /// A uuid.
    Uuid(Uuid),
    /// A string.
    String(String),
}

/// Create fillets on tagged paths.
pub async fn fillet(args: Args) -> Result<MemoryItem, KclError> {
    let (data, extrude_group): (FilletData, Box<ExtrudeGroup>) = args.get_data_and_extrude_group()?;

    let extrude_group = inner_fillet(data, extrude_group, args).await?;
    Ok(MemoryItem::ExtrudeGroup(extrude_group))
}

/// Create fillets on tagged paths.
#[stdlib {
    name = "fillet",
}]
async fn inner_fillet(
    data: FilletData,
    extrude_group: Box<ExtrudeGroup>,
    args: Args,
) -> Result<Box<ExtrudeGroup>, KclError> {
    // Check if tags contains any duplicate values.
    let mut tags = data.tags.clone();
    tags.sort();
    tags.dedup();
    if tags.len() != data.tags.len() {
        return Err(KclError::Type(KclErrorDetails {
            message: "Duplicate tags are not allowed.".to_string(),
            source_ranges: vec![args.source_range],
        }));
    }

    for tag in data.tags {
        let edge_id = match tag {
            StringOrUuid::Uuid(uuid) => uuid,
            StringOrUuid::String(tag) => {
                extrude_group
                    .sketch_group_values
                    .iter()
                    .find(|p| p.get_name() == tag)
                    .ok_or_else(|| {
                        KclError::Type(KclErrorDetails {
                            message: format!("No edge found with tag: `{}`", tag),
                            source_ranges: vec![args.source_range],
                        })
                    })?
                    .get_base()
                    .geo_meta
                    .id
            }
        };

        args.send_modeling_cmd(
            uuid::Uuid::new_v4(),
            ModelingCmd::Solid3DFilletEdge {
                edge_id,
                object_id: extrude_group.id,
                radius: data.radius,
                tolerance: 0.0000001, // We can let the user set this in the future.
            },
        )
        .await?;
    }

    Ok(extrude_group)
}

/// Get the opposite edge to the edge given.
pub async fn get_opposite_edge(args: Args) -> Result<MemoryItem, KclError> {
    let (tag, extrude_group): (String, Box<ExtrudeGroup>) = args.get_data_and_extrude_group()?;

    let edge = inner_get_opposite_edge(tag, extrude_group, args.clone()).await?;
    Ok(MemoryItem::UserVal(UserVal {
        value: serde_json::to_value(edge).map_err(|e| {
            KclError::Type(KclErrorDetails {
                message: format!("Failed to convert Uuid to json: {}", e),
                source_ranges: vec![args.source_range],
            })
        })?,
        meta: vec![args.source_range.into()],
    }))
}

/// Get the opposite edge to the edge given.
#[stdlib {
    name = "getOppositeEdge",
}]
async fn inner_get_opposite_edge(tag: String, extrude_group: Box<ExtrudeGroup>, args: Args) -> Result<Uuid, KclError> {
    let tagged_path = extrude_group
        .sketch_group_values
        .iter()
        .find(|p| p.get_name() == tag)
        .ok_or_else(|| {
            KclError::Type(KclErrorDetails {
                message: format!("No edge found with tag: `{}`", tag),
                source_ranges: vec![args.source_range],
            })
        })?
        .get_base();

    let face_id = get_adjacent_face_to_tag(&extrude_group, &tag, &args)?;

    let resp = args
        .send_modeling_cmd(
            uuid::Uuid::new_v4(),
            ModelingCmd::Solid3DGetOppositeEdge {
                edge_id: tagged_path.geo_meta.id,
                object_id: extrude_group.id,
                face_id,
            },
        )
        .await?;
    let kittycad::types::OkWebSocketResponseData::Modeling {
        modeling_response: kittycad::types::OkModelingCmdResponse::Solid3DGetOppositeEdge { data: opposite_edge },
    } = &resp
    else {
        return Err(KclError::Engine(KclErrorDetails {
            message: format!("Solid3DGetOppositeEdge response was not as expected: {:?}", resp),
            source_ranges: vec![args.source_range],
        }));
    };

    Ok(opposite_edge.edge)
}

/// Get the next adjacent edge to the edge given.
pub async fn get_next_adjacent_edge(args: Args) -> Result<MemoryItem, KclError> {
    let (tag, extrude_group): (String, Box<ExtrudeGroup>) = args.get_data_and_extrude_group()?;

    let edge = inner_get_next_adjacent_edge(tag, extrude_group, args.clone()).await?;
    Ok(MemoryItem::UserVal(UserVal {
        value: serde_json::to_value(edge).map_err(|e| {
            KclError::Type(KclErrorDetails {
                message: format!("Failed to convert Uuid to json: {}", e),
                source_ranges: vec![args.source_range],
            })
        })?,
        meta: vec![args.source_range.into()],
    }))
}

/// Get the next adjacent edge to the edge given.
#[stdlib {
    name = "getNextAdjacentEdge",
}]
async fn inner_get_next_adjacent_edge(
    tag: String,
    extrude_group: Box<ExtrudeGroup>,
    args: Args,
) -> Result<Uuid, KclError> {
    let tagged_path = extrude_group
        .sketch_group_values
        .iter()
        .find(|p| p.get_name() == tag)
        .ok_or_else(|| {
            KclError::Type(KclErrorDetails {
                message: format!("No edge found with tag: `{}`", tag),
                source_ranges: vec![args.source_range],
            })
        })?
        .get_base();

    let face_id = get_adjacent_face_to_tag(&extrude_group, &tag, &args)?;

    let resp = args
        .send_modeling_cmd(
            uuid::Uuid::new_v4(),
            ModelingCmd::Solid3DGetNextAdjacentEdge {
                edge_id: tagged_path.geo_meta.id,
                object_id: extrude_group.id,
                face_id,
            },
        )
        .await?;
    let kittycad::types::OkWebSocketResponseData::Modeling {
        modeling_response: kittycad::types::OkModelingCmdResponse::Solid3DGetNextAdjacentEdge { data: ajacent_edge },
    } = &resp
    else {
        return Err(KclError::Engine(KclErrorDetails {
            message: format!("Solid3DGetNextAdjacentEdge response was not as expected: {:?}", resp),
            source_ranges: vec![args.source_range],
        }));
    };

    ajacent_edge.edge.ok_or_else(|| {
        KclError::Type(KclErrorDetails {
            message: format!("No edge found next adjacent to tag: `{}`", tag),
            source_ranges: vec![args.source_range],
        })
    })
}

/// Get the previous adjacent edge to the edge given.
pub async fn get_previous_adjacent_edge(args: Args) -> Result<MemoryItem, KclError> {
    let (tag, extrude_group): (String, Box<ExtrudeGroup>) = args.get_data_and_extrude_group()?;

    let edge = inner_get_previous_adjacent_edge(tag, extrude_group, args.clone()).await?;
    Ok(MemoryItem::UserVal(UserVal {
        value: serde_json::to_value(edge).map_err(|e| {
            KclError::Type(KclErrorDetails {
                message: format!("Failed to convert Uuid to json: {}", e),
                source_ranges: vec![args.source_range],
            })
        })?,
        meta: vec![args.source_range.into()],
    }))
}

/// Get the previous adjacent edge to the edge given.
#[stdlib {
    name = "getPreviousAdjacentEdge",
}]
async fn inner_get_previous_adjacent_edge(
    tag: String,
    extrude_group: Box<ExtrudeGroup>,
    args: Args,
) -> Result<Uuid, KclError> {
    let tagged_path = extrude_group
        .sketch_group_values
        .iter()
        .find(|p| p.get_name() == tag)
        .ok_or_else(|| {
            KclError::Type(KclErrorDetails {
                message: format!("No edge found with tag: `{}`", tag),
                source_ranges: vec![args.source_range],
            })
        })?
        .get_base();

    let face_id = get_adjacent_face_to_tag(&extrude_group, &tag, &args)?;

    let resp = args
        .send_modeling_cmd(
            uuid::Uuid::new_v4(),
            ModelingCmd::Solid3DGetPrevAdjacentEdge {
                edge_id: tagged_path.geo_meta.id,
                object_id: extrude_group.id,
                face_id,
            },
        )
        .await?;
    let kittycad::types::OkWebSocketResponseData::Modeling {
        modeling_response: kittycad::types::OkModelingCmdResponse::Solid3DGetPrevAdjacentEdge { data: ajacent_edge },
    } = &resp
    else {
        return Err(KclError::Engine(KclErrorDetails {
            message: format!("Solid3DGetPrevAdjacentEdge response was not as expected: {:?}", resp),
            source_ranges: vec![args.source_range],
        }));
    };

    ajacent_edge.edge.ok_or_else(|| {
        KclError::Type(KclErrorDetails {
            message: format!("No edge found previous adjacent to tag: `{}`", tag),
            source_ranges: vec![args.source_range],
        })
    })
}

fn get_adjacent_face_to_tag(extrude_group: &ExtrudeGroup, tag: &str, args: &Args) -> Result<uuid::Uuid, KclError> {
    extrude_group
        .value
        .iter()
        .find_map(|extrude_surface| match extrude_surface {
            ExtrudeSurface::ExtrudePlane(extrude_plane) if extrude_plane.name == tag => Some(Ok(extrude_plane.face_id)),
            ExtrudeSurface::ExtrudeArc(extrude_arc) if extrude_arc.name == tag => Some(Ok(extrude_arc.face_id)),
            ExtrudeSurface::ExtrudePlane(_) | ExtrudeSurface::ExtrudeArc(_) => None,
        })
        .ok_or_else(|| {
            KclError::Type(KclErrorDetails {
                message: format!("Expected a face with the tag `{}`", tag),
                source_ranges: vec![args.source_range],
            })
        })?
}
