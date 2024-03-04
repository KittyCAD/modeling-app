//! Standard library fillets.

use anyhow::Result;
use derive_docs::stdlib;
use kittycad::types::ModelingCmd;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::{
    errors::{KclError, KclErrorDetails},
    executor::{ExtrudeGroup, MemoryItem},
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
    pub tags: Vec<String>,
    /// The query to select the paths you want to fillet, based on the tags.
    #[serde(default)]
    pub query: FilletEdgeQuery,
}

#[derive(Debug, Default, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub enum FilletEdgeQuery {
    /// Use the tags to select the paths on the start face.
    #[default]
    StartFace,
    /// Use the tags to select the paths on the end face.
    EndFace,
    /// Use the tags to select the path between the two tags.
    BetweenTags,
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

        let edge_id = match &data.query {
            FilletEdgeQuery::StartFace => tagged_path.geo_meta.id,
            FilletEdgeQuery::EndFace => {
                // We need to get the face id for the end.
                let face_id = extrude_group.end_cap_id.ok_or_else(|| {
                    KclError::Type(KclErrorDetails {
                        message: "Expected an end face to sketch on".to_string(),
                        source_ranges: vec![args.source_range],
                    })
                })?;

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
                    modeling_response:
                        kittycad::types::OkModelingCmdResponse::Solid3DGetOppositeEdge { data: opposite_edge },
                } = &resp
                else {
                    return Err(KclError::Engine(KclErrorDetails {
                        message: format!("Solid3DGetOppositeEdge response was not as expected: {:?}", resp),
                        source_ranges: vec![args.source_range],
                    }));
                };

                opposite_edge.edge
            }
            FilletEdgeQuery::BetweenTags => {
                // TODO: query for the edge between the two tags.
                tagged_path.geo_meta.id
            }
        };

        args.send_modeling_cmd(
            uuid::Uuid::new_v4(),
            ModelingCmd::Solid3DFilletEdge {
                edge_id,
                object_id: extrude_group.id,
                radius: data.radius,
                tolerance: 0.01, // We can let the user set this in the future.
            },
        )
        .await?;
    }

    Ok(extrude_group)
}
