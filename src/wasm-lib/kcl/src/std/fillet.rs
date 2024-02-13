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

        args.send_modeling_cmd(
            uuid::Uuid::new_v4(),
            ModelingCmd::Solid3DFilletEdge {
                edge_id: tagged_path.geo_meta.id,
                object_id: extrude_group.id,
                radius: data.radius,
            },
        )
        .await?;
    }

    Ok(extrude_group)
}
