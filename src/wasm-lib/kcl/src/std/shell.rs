//! Standard library shells.

use anyhow::Result;
use derive_docs::stdlib;
use kittycad::types::ModelingCmd;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::{
    ast::types::TagDeclarator,
    errors::{KclError, KclErrorDetails},
    executor::{ExtrudeGroup, ExtrudePlane, ExtrudeSurface, GeoMeta, MemoryItem, Metadata},
    std::{sketch::FaceTag, Args},
};

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
    let (data, extrude_group, tag): (ShellData, Box<ExtrudeGroup>, Option<TagDeclarator>) =
        args.get_data_and_extrude_group_and_tag()?;

    let extrude_group = inner_shell(data, extrude_group, tag, args).await?;
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
///
/// ```no_run
/// const firstSketch = startSketchOn('XY')
///     |> startProfileAt([-12, 12], %)
///     |> line([24, 0], %)
///     |> line([0, -24], %)
///     |> line([-24, 0], %)
///     |> close(%)
///     |> extrude(6, %)
///     |> shell({
///         faces: ['end'],
///         thickness: 0.25,
///     }, %, $shellFace)
///
/// // Sketch on the inside of the shell.
/// startSketchOn(firstSketch, shellFace)
///    |> circle([0, 0], 6, %)
///    |> extrude(6, %)
/// ```
#[stdlib {
    name = "shell",
}]
async fn inner_shell(
    data: ShellData,
    extrude_group: Box<ExtrudeGroup>,
    tag: Option<TagDeclarator>,
    args: Args,
) -> Result<Box<ExtrudeGroup>, KclError> {
    if data.faces.is_empty() {
        return Err(KclError::Type(KclErrorDetails {
            message: "Expected at least one face".to_string(),
            source_ranges: vec![args.source_range],
        }));
    }

    let mut face_ids = Vec::new();
    for face_tag in data.faces {
        let extrude_plane_id = face_tag.get_face_id(&extrude_group, &args, false).await?;

        face_ids.push(extrude_plane_id);
    }

    if face_ids.is_empty() {
        return Err(KclError::Type(KclErrorDetails {
            message: "Expected at least one valid face".to_string(),
            source_ranges: vec![args.source_range],
        }));
    }

    let id = uuid::Uuid::new_v4();
    args.batch_modeling_cmd(
        id,
        ModelingCmd::Solid3DShellFace {
            face_ids,
            object_id: extrude_group.id,
            shell_thickness: data.thickness,
        },
    )
    .await?;

    let mut extrude_group = extrude_group.clone();
    extrude_group.value.push(ExtrudeSurface::ExtrudePlane(ExtrudePlane {
        face_id: id,
        tag,
        geo_meta: GeoMeta {
            id,
            metadata: Metadata {
                source_range: args.source_range,
            },
        },
    }));

    Ok(extrude_group)
}
