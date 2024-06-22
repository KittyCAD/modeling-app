//! Standard library mirror.

use anyhow::Result;
use derive_docs::stdlib;
use kittycad::types::ModelingCmd;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::{
    errors::{KclError, KclErrorDetails},
    executor::{MemoryItem, SketchGroup, SketchGroupSet},
    std::{fillet::EdgeReference, Args},
};

/// Data for a mirror.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct MirrorData {
    /// Axis to use as mirror.
    pub axis: MirrorAxis,
}

/// Axis of the mirror or tagged edge.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(untagged)]
pub enum MirrorAxis {
    /// Axis of revolution.
    Axis(MirrorAxisAndPoint),
    /// Tagged edge.
    Edge(EdgeReference),
}

/// Axis of revolution.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub enum MirrorAxisAndPoint {
    /// X-axis.
    #[serde(rename = "X", alias = "x")]
    X,
    /// Y-axis.
    #[serde(rename = "Y", alias = "y")]
    Y,
    /// Z-axis.
    #[serde(rename = "Z", alias = "z")]
    Z,
    /// Flip the X-axis.
    #[serde(rename = "-X", alias = "-x")]
    NegX,
    /// Flip the Y-axis.
    #[serde(rename = "-Y", alias = "-y")]
    NegY,
    /// Flip the Z-axis.
    #[serde(rename = "-Z", alias = "-z")]
    NegZ,
    Custom {
        /// Axis to use as mirror.
        axis: [f64; 3],
        /// Point through which the mirror axis passes.
        point: [f64; 3],
    },
}

impl MirrorAxisAndPoint {
    /// Get the axis and point.
    pub fn axis_and_point(&self) -> Result<(kittycad::types::Point3D, kittycad::types::Point3D), KclError> {
        let (axis, point) = match self {
            MirrorAxisAndPoint::X => ([1.0, 0.0, 0.0], [0.0, 0.0, 0.0]),
            MirrorAxisAndPoint::Y => ([0.0, 1.0, 0.0], [0.0, 0.0, 0.0]),
            MirrorAxisAndPoint::Z => ([0.0, 0.0, 1.0], [0.0, 0.0, 0.0]),
            MirrorAxisAndPoint::NegX => ([-1.0, 0.0, 0.0], [0.0, 0.0, 0.0]),
            MirrorAxisAndPoint::NegY => ([0.0, -1.0, 0.0], [0.0, 0.0, 0.0]),
            MirrorAxisAndPoint::NegZ => ([0.0, 0.0, -1.0], [0.0, 0.0, 0.0]),
            MirrorAxisAndPoint::Custom { axis, point } => (*axis, *point),
        };

        Ok((
            kittycad::types::Point3D {
                x: axis[0],
                y: axis[1],
                z: axis[2],
            },
            kittycad::types::Point3D {
                x: point[0],
                y: point[1],
                z: point[2],
            },
        ))
    }
}

/// Mirror a sketch or set of sketches.
///
/// Only works on 2D sketches for now.
pub async fn mirror(args: Args) -> Result<MemoryItem, KclError> {
    let (data, sketch_group_set): (MirrorData, SketchGroupSet) = args.get_data_and_sketch_group_set()?;

    let sketch_groups = inner_mirror(data, sketch_group_set, args).await?;
    Ok(MemoryItem::SketchGroups { value: sketch_groups })
}

/// Mirror a sketch or set of sketches.
///
/// Only works on 2D sketches for now.
///
/// ```no_run
/// const exampleSketch = startSketchOn('XZ')
///   |> circle([0, 0], 1, %)
///   |> mirror({axis: 'X'}, %)
///
/// const example = extrude(10, exampleSketch)
/// ```
#[stdlib {
    name = "mirror",
}]
async fn inner_mirror(
    data: MirrorData,
    sketch_group_set: SketchGroupSet,
    args: Args,
) -> Result<Vec<Box<SketchGroup>>, KclError> {
    let starting_sketch_groups = match sketch_group_set {
        SketchGroupSet::SketchGroup(sketch_group) => vec![sketch_group],
        SketchGroupSet::SketchGroups(sketch_groups) => sketch_groups,
    };

    if args.ctx.is_mock {
        return Ok(starting_sketch_groups);
    }

    let (axis, point) = match data.axis {
        MirrorAxis::Axis(axis) => axis.axis_and_point()?,
        MirrorAxis::Edge(_edge) => {
            // TODO: Implement this engine side.
            return Err(KclError::Semantic(KclErrorDetails {
                message: "Mirroring by edge or path is not yet implemented".to_string(),
                source_ranges: vec![args.source_range],
            }));
        }
    };

    args.batch_modeling_cmd(
        uuid::Uuid::new_v4(),
        ModelingCmd::EntityMirror {
            ids: starting_sketch_groups
                .iter()
                .map(|sketch_group| sketch_group.id)
                .collect(),
            axis,
            point,
        },
    )
    .await?;

    Ok(starting_sketch_groups)
}

#[cfg(test)]
mod tests {

    use pretty_assertions::assert_eq;

    use crate::std::mirror::{MirrorAxis, MirrorAxisAndPoint};

    #[test]
    fn test_deserialize_mirror_axis() {
        let data = MirrorAxis::Axis(MirrorAxisAndPoint::X);
        let mut str_json = serde_json::to_string(&data).unwrap();
        assert_eq!(str_json, "\"X\"");

        str_json = "\"Y\"".to_string();
        let data: MirrorAxis = serde_json::from_str(&str_json).unwrap();
        assert_eq!(data, MirrorAxis::Axis(MirrorAxisAndPoint::Y));

        str_json = "\"-Y\"".to_string();
        let data: MirrorAxis = serde_json::from_str(&str_json).unwrap();
        assert_eq!(data, MirrorAxis::Axis(MirrorAxisAndPoint::NegY));

        str_json = "\"-x\"".to_string();
        let data: MirrorAxis = serde_json::from_str(&str_json).unwrap();
        assert_eq!(data, MirrorAxis::Axis(MirrorAxisAndPoint::NegX));

        let data = MirrorAxis::Axis(MirrorAxisAndPoint::Custom {
            axis: [0.0, -1.0, 0.0],
            point: [1.0, 0.0, 2.0],
        });
        str_json = serde_json::to_string(&data).unwrap();
        assert_eq!(str_json, r#"{"custom":{"axis":[0.0,-1.0,0.0],"point":[1.0,0.0,2.0]}}"#);

        str_json = r#"{"custom": {"axis": [0,-1,0], "point": [1,0,2.0]}}"#.to_string();
        let data: MirrorAxis = serde_json::from_str(&str_json).unwrap();
        assert_eq!(
            data,
            MirrorAxis::Axis(MirrorAxisAndPoint::Custom {
                axis: [0.0, -1.0, 0.0],
                point: [1.0, 0.0, 2.0]
            })
        );
    }
}
