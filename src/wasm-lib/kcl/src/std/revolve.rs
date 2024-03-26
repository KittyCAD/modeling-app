//! Standard library revolution surfaces.

use anyhow::Result;
use derive_docs::stdlib;
use kittycad::types::ModelingCmd;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::{
    errors::{KclError, KclErrorDetails},
    executor::{ExtrudeGroup, MemoryItem, SketchGroup},
    std::{extrude::do_post_extrude, fillet::EdgeReference, Args},
};

/// Data for revolution surfaces.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
pub struct RevolveData {
    /// Angle to revolve (in degrees). Default is 360.
    #[serde(default)]
    pub angle: Option<f64>,
    /// Axis of revolution.
    pub axis: RevolveAxis,
}

/// Axis of revolution or tagged edge.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(untagged)]
pub enum RevolveAxis {
    /// Axis of revolution.
    Axis(RevolveAxisAndOrigin),
    /// Tagged edge.
    Edge(EdgeReference),
}

/// Axis of revolution.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
pub enum RevolveAxisAndOrigin {
    /// X-axis.
    #[serde(alias = "x")]
    X,
    /// Y-axis.
    #[serde(alias = "y")]
    Y,
    /// Z-axis.
    #[serde(alias = "z")]
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
        /// The axis.
        axis: [f64; 3],
        /// The origin.
        origin: [f64; 3],
    },
}

impl RevolveAxisAndOrigin {
    /// Get the axis and origin.
    pub fn axis_and_origin(&self) -> Result<(kittycad::types::Point3D, kittycad::types::Point3D), KclError> {
        let (axis, origin) = match self {
            RevolveAxisAndOrigin::X => ([1.0, 0.0, 0.0], [0.0, 0.0, 0.0]),
            RevolveAxisAndOrigin::Y => ([0.0, 1.0, 0.0], [0.0, 0.0, 0.0]),
            RevolveAxisAndOrigin::Z => ([0.0, 0.0, 1.0], [0.0, 0.0, 0.0]),
            RevolveAxisAndOrigin::NegX => ([-1.0, 0.0, 0.0], [0.0, 0.0, 0.0]),
            RevolveAxisAndOrigin::NegY => ([0.0, -1.0, 0.0], [0.0, 0.0, 0.0]),
            RevolveAxisAndOrigin::NegZ => ([0.0, 0.0, -1.0], [0.0, 0.0, 0.0]),
            RevolveAxisAndOrigin::Custom { axis, origin } => (*axis, *origin),
        };

        Ok((
            kittycad::types::Point3D {
                x: axis[0],
                y: axis[1],
                z: axis[2],
            },
            kittycad::types::Point3D {
                x: origin[0],
                y: origin[1],
                z: origin[2],
            },
        ))
    }
}

/// Revolve a sketch around an axis.
pub async fn revolve(args: Args) -> Result<MemoryItem, KclError> {
    let (data, sketch_group): (RevolveData, Box<SketchGroup>) = args.get_data_and_sketch_group()?;

    let extrude_group = inner_revolve(data, sketch_group, args).await?;
    Ok(MemoryItem::ExtrudeGroup(extrude_group))
}

/// Revolve a sketch around an axis.
///
/// ```no_run
/// const part001 = startSketchOn('XY')
///     |> startProfileAt([4, 12], %)
///     |> line([2, 0], %)
///     |> line([0, -6], %)
///     |> line([4, -6], %)
///     |> line([0, -6], %)
///     |> line([-3.75, -4.5], %)
///     |> line([0, -5.5], %)
///     |> line([-2, 0], %)
///     |> close(%)
///     |> revolve({axis: 'y'}, %)
/// ```
#[stdlib {
    name = "revolve",
}]
async fn inner_revolve(
    data: RevolveData,
    sketch_group: Box<SketchGroup>,
    args: Args,
) -> Result<Box<ExtrudeGroup>, KclError> {
    if let Some(angle) = data.angle {
        // Return an error if the angle is less than -360 or greater than 360.
        if !(-360.0..=360.0).contains(&angle) {
            return Err(KclError::Semantic(KclErrorDetails {
                message: format!("Expected angle to be between -360 and 360, found `{}`", angle),
                source_ranges: vec![args.source_range],
            }));
        }
    }

    let angle = kittycad::types::Angle::from_degrees(data.angle.unwrap_or(360.0));

    let id = uuid::Uuid::new_v4();
    match data.axis {
        RevolveAxis::Axis(axis) => {
            let (axis, origin) = axis.axis_and_origin()?;
            args.send_modeling_cmd(
                id,
                ModelingCmd::Revolve {
                    angle,
                    target: sketch_group.id,
                    axis,
                    origin,
                },
            )
            .await?;
        }
        RevolveAxis::Edge(edge) => {
            let edge_id = match edge {
                EdgeReference::Uuid(uuid) => uuid,
                EdgeReference::Tag(tag) => {
                    sketch_group
                        .value
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
                id,
                ModelingCmd::RevolveAboutEdge {
                    angle,
                    target: sketch_group.id,
                    edge_id,
                },
            )
            .await?;
        }
    }

    do_post_extrude(sketch_group, 0.0, id, args).await
}
