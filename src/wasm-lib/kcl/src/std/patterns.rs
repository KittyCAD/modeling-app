//! Standard library patterns.

use anyhow::Result;
use derive_docs::stdlib;
use kittycad::types::ModelingCmd;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::{
    errors::{KclError, KclErrorDetails},
    executor::{Geometries, Geometry, MemoryItem},
    std::Args,
};

/// Data for a linear pattern.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct LinearPatternData {
    /// The number of repetitions. Must be greater than 0.
    /// This excludes the original entity. For example, if `repetitions` is 1,
    /// the original entity will be copied once.
    pub repetitions: usize,
    /// The distance between each repetition. This can also be referred to as spacing.
    pub distance: f64,
    /// The axis of the pattern. This is a 3D vector.
    pub axis: [f64; 3],
}

/// A linear pattern.
pub async fn pattern_linear(args: Args) -> Result<MemoryItem, KclError> {
    let (data, geometry): (LinearPatternData, Geometry) = args.get_data_and_geometry()?;

    if data.axis == [0.0, 0.0, 0.0] {
        return Err(KclError::Semantic(KclErrorDetails {
            message:
                "The axis of the linear pattern cannot be the zero vector. Otherwise they will just duplicate in place."
                    .to_string(),
            source_ranges: vec![args.source_range],
        }));
    }

    let new_geometries = inner_pattern_linear(data, geometry, args).await?;
    match new_geometries {
        Geometries::SketchGroups(sketch_groups) => Ok(MemoryItem::SketchGroups { value: sketch_groups }),
        Geometries::ExtrudeGroups(extrude_groups) => Ok(MemoryItem::ExtrudeGroups { value: extrude_groups }),
    }
}

/// A linear pattern.
#[stdlib {
    name = "patternLinear",
}]
async fn inner_pattern_linear(data: LinearPatternData, geometry: Geometry, args: Args) -> Result<Geometries, KclError> {
    let id = uuid::Uuid::new_v4();

    let resp = args
        .send_modeling_cmd(
            id,
            ModelingCmd::EntityLinearPattern {
                axis: data.axis.into(),
                entity_id: geometry.id(),
                num_repetitions: data.repetitions as u32,
                spacing: data.distance,
            },
        )
        .await?;

    let kittycad::types::OkWebSocketResponseData::Modeling {
        modeling_response: kittycad::types::OkModelingCmdResponse::EntityLinearPattern { data: pattern_info },
    } = &resp
    else {
        return Err(KclError::Engine(KclErrorDetails {
            message: format!("EntityLinearPattern response was not as expected: {:?}", resp),
            source_ranges: vec![args.source_range],
        }));
    };

    let geometries = match geometry {
        Geometry::SketchGroup(sketch_group) => {
            let mut geometries = vec![sketch_group.clone()];
            for id in pattern_info.entity_ids.iter() {
                let mut new_sketch_group = sketch_group.clone();
                new_sketch_group.id = *id;
                geometries.push(new_sketch_group);
            }
            Geometries::SketchGroups(geometries)
        }
        Geometry::ExtrudeGroup(extrude_group) => {
            let mut geometries = vec![extrude_group.clone()];
            for id in pattern_info.entity_ids.iter() {
                let mut new_extrude_group = extrude_group.clone();
                new_extrude_group.id = *id;
                geometries.push(new_extrude_group);
            }
            Geometries::ExtrudeGroups(geometries)
        }
    };

    Ok(geometries)
}
