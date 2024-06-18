//! Standard library shells.

use anyhow::Result;
use derive_docs::stdlib;
use kittycad::types::ModelingCmd;
use parse_display::{Display, FromStr};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::{
    errors::{KclError, KclErrorDetails},
    executor::{ExtrudeGroup, ExtrudeSurface, MemoryItem},
    std::{sketch::StartOrEnd, Args},
};

/// A tag for a face.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema, FromStr, Display)]
#[ts(export)]
#[serde(rename_all = "snake_case", untagged)]
#[display("{0}")]
pub enum FaceTag {
    StartOrEnd(StartOrEnd),
    /// A string tag for the face you want to sketch on.
    String(String),
}

/// Data for shells.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct ShellData {
    /// The thickness of the shell.
    pub thickness: f64,
    /// The faces you want removed.
    pub faces: Vec<FaceTag>,
}

/// Create a shell.
pub async fn shell(args: Args) -> Result<MemoryItem, KclError> {
    let (data, extrude_group): (ShellData, Box<ExtrudeGroup>) = args.get_data_and_extrude_group()?;

    let extrude_group = inner_shell(data, extrude_group, args).await?;
    Ok(MemoryItem::ExtrudeGroup(extrude_group))
}

/// Shell a solid.
///
/// ```no_run
/// const firstSketch = startSketchOn('XY')
///     |> startProfileAt([-12, 12], %)
///     |> line([24, 0], %)
///     |> line([0, -24], %)
///     |> line([-24, 0], %)
///     |> close(%)
///     |> extrude(6, %)
///
/// // Remove the end face for the extrusion.
/// shell({
///     faces: ['end'],
///     thickness: 0.25,
/// }, firstSketch)
/// ```
#[stdlib {
    name = "shell",
}]
async fn inner_shell(
    data: ShellData,
    extrude_group: Box<ExtrudeGroup>,
    args: Args,
) -> Result<Box<ExtrudeGroup>, KclError> {
    if data.faces.is_empty() {
        return Err(KclError::Type(KclErrorDetails {
            message: "Expected at least one face".to_string(),
            source_ranges: vec![args.source_range],
        }));
    }

    let mut face_ids = Vec::new();
    for tag in data.faces {
        let extrude_plane_id = match tag {
            FaceTag::String(ref s) => {
                if s.is_empty() {
                    return Err(KclError::Type(KclErrorDetails {
                        message: "Expected a non-empty tag for the face".to_string(),
                        source_ranges: vec![args.source_range],
                    }));
                }
                extrude_group
                    .value
                    .iter()
                    .find_map(|extrude_surface| match extrude_surface {
                        ExtrudeSurface::ExtrudePlane(extrude_plane) if extrude_plane.name == *s => {
                            Some(extrude_plane.face_id)
                        }
                        ExtrudeSurface::ExtrudeArc(extrude_arc) if extrude_arc.name == *s => Some(extrude_arc.face_id),
                        ExtrudeSurface::ExtrudePlane(_) | ExtrudeSurface::ExtrudeArc(_) => None,
                    })
                    .ok_or_else(|| {
                        KclError::Type(KclErrorDetails {
                            message: format!("Expected a face with the tag `{}`", tag),
                            source_ranges: vec![args.source_range],
                        })
                    })?
            }
            FaceTag::StartOrEnd(StartOrEnd::Start) => extrude_group.start_cap_id.ok_or_else(|| {
                KclError::Type(KclErrorDetails {
                    message: "Expected a start face".to_string(),
                    source_ranges: vec![args.source_range],
                })
            })?,
            FaceTag::StartOrEnd(StartOrEnd::End) => extrude_group.end_cap_id.ok_or_else(|| {
                KclError::Type(KclErrorDetails {
                    message: "Expected an end face".to_string(),
                    source_ranges: vec![args.source_range],
                })
            })?,
        };

        face_ids.push(extrude_plane_id);
    }

    if face_ids.is_empty() {
        return Err(KclError::Type(KclErrorDetails {
            message: "Expected at least one valid face".to_string(),
            source_ranges: vec![args.source_range],
        }));
    }

    args.send_modeling_cmd(
        uuid::Uuid::new_v4(),
        ModelingCmd::Solid3DShellFace {
            face_ids,
            object_id: extrude_group.id,
            shell_thickness: data.thickness,
        },
    )
    .await?;

    Ok(extrude_group)
}
