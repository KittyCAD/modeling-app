//! Standard library shells.

use anyhow::Result;
use derive_docs::stdlib;
use kcmc::{each_cmd as mcmd, length_unit::LengthUnit, ModelingCmd};
use kittycad_modeling_cmds as kcmc;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::{
    errors::{KclError, KclErrorDetails},
    executor::{ExecState, KclValue, Solid, SolidSet},
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
pub async fn shell(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let (data, solid_set): (ShellData, SolidSet) = args.get_data_and_solid_set()?;

    let result = inner_shell(data, solid_set, exec_state, args).await?;
    Ok(result.into())
}

/// Remove volume from a 3-dimensional shape such that a wall of the
/// provided thickness remains, taking volume starting at the provided
/// face, leaving it open in that direction.
///
/// ```no_run
/// // Remove the end face for the extrusion.
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
///     faces = ['end'],
///     thickness = 0.25,
/// }, firstSketch)
/// ```
///
/// ```no_run
/// // Remove the start face for the extrusion.
/// const firstSketch = startSketchOn('-XZ')
///     |> startProfileAt([-12, 12], %)
///     |> line([24, 0], %)
///     |> line([0, -24], %)
///     |> line([-24, 0], %)
///     |> close(%)
///     |> extrude(6, %)
///
/// // Remove the start face for the extrusion.
/// shell({
///     faces = ['start'],
///     thickness = 0.25,
/// }, firstSketch)
/// ```
///
/// ```no_run
/// // Remove a tagged face and the end face for the extrusion.
/// const firstSketch = startSketchOn('XY')
///     |> startProfileAt([-12, 12], %)
///     |> line([24, 0], %)
///     |> line([0, -24], %)
///     |> line([-24, 0], %, $myTag)
///     |> close(%)
///     |> extrude(6, %)
///
/// // Remove a tagged face for the extrusion.
/// shell({
///     faces = [myTag],
///     thickness = 0.25,
/// }, firstSketch)
/// ```
///
/// ```no_run
/// // Remove multiple faces at once.
/// const firstSketch = startSketchOn('XY')
///     |> startProfileAt([-12, 12], %)
///     |> line([24, 0], %)
///     |> line([0, -24], %)
///     |> line([-24, 0], %, $myTag)
///     |> close(%)
///     |> extrude(6, %)
///
/// // Remove a tagged face and the end face for the extrusion.
/// shell({
///     faces = [myTag, 'end'],
///     thickness = 0.25,
/// }, firstSketch)
/// ```
///
/// ```no_run
/// // Shell a sketch on face.
/// let size = 100
/// const case = startSketchOn('-XZ')
///     |> startProfileAt([-size, -size], %)
///     |> line([2 * size, 0], %)
///     |> line([0, 2 * size], %)
///     |> tangentialArcTo([-size, size], %)
///     |> close(%)
///     |> extrude(65, %)
///
/// const thing1 = startSketchOn(case, 'end')
///     |> circle({ center = [-size / 2, -size / 2], radius = 25 }, %)
///     |> extrude(50, %)
///
/// const thing2 = startSketchOn(case, 'end')
///     |> circle({ center = [size / 2, -size / 2], radius = 25 }, %)
///     |> extrude(50, %)
///
/// // We put "case" in the shell function to shell the entire object.
/// shell({ faces = ['start'], thickness = 5 }, case)
/// ```
///
/// ```no_run
/// // Shell a sketch on face object on the end face.
/// let size = 100
/// const case = startSketchOn('XY')
///     |> startProfileAt([-size, -size], %)
///     |> line([2 * size, 0], %)
///     |> line([0, 2 * size], %)
///     |> tangentialArcTo([-size, size], %)
///     |> close(%)
///     |> extrude(65, %)
///
/// const thing1 = startSketchOn(case, 'end')
///     |> circle({ center = [-size / 2, -size / 2], radius = 25 }, %)
///     |> extrude(50, %)
///
/// const thing2 = startSketchOn(case, 'end')
///     |> circle({ center = [size / 2, -size / 2], radius = 25 }, %)
///     |> extrude(50, %)
///
/// // We put "thing1" in the shell function to shell the end face of the object.
/// shell({ faces = ['end'], thickness = 5 }, thing1)
/// ```
///
/// ```no_run
/// // Shell sketched on face objects on the end face, include all sketches to shell
/// // the entire object.
///
/// let size = 100
/// const case = startSketchOn('XY')
///     |> startProfileAt([-size, -size], %)
///     |> line([2 * size, 0], %)
///     |> line([0, 2 * size], %)
///     |> tangentialArcTo([-size, size], %)
///     |> close(%)
///     |> extrude(65, %)
///
/// const thing1 = startSketchOn(case, 'end')
///     |> circle({ center = [-size / 2, -size / 2], radius = 25 }, %)
///     |> extrude(50, %)
///
/// const thing2 = startSketchOn(case, 'end')
///     |> circle({ center = [size / 2, -size / 2], radius = 25 }, %)
///     |> extrude(50, %)
///
/// // We put "thing1" and "thing2" in the shell function to shell the end face of the object.
/// shell({ faces = ['end'], thickness = 5 }, [thing1, thing2])
/// ```
#[stdlib {
    name = "shell",
}]
async fn inner_shell(
    data: ShellData,
    solid_set: SolidSet,
    exec_state: &mut ExecState,
    args: Args,
) -> Result<SolidSet, KclError> {
    if data.faces.is_empty() {
        return Err(KclError::Type(KclErrorDetails {
            message: "Expected at least one face".to_string(),
            source_ranges: vec![args.source_range],
        }));
    }

    let solids: Vec<Box<Solid>> = solid_set.clone().into();
    if solids.is_empty() {
        return Err(KclError::Type(KclErrorDetails {
            message: "Expected at least one solid".to_string(),
            source_ranges: vec![args.source_range],
        }));
    }

    let mut face_ids = Vec::new();
    for solid in &solids {
        // Flush the batch for our fillets/chamfers if there are any.
        // If we do not do these for sketch on face, things will fail with face does not exist.
        args.flush_batch_for_solid_set(exec_state, solid.clone().into()).await?;

        for tag in &data.faces {
            let extrude_plane_id = tag.get_face_id(solid, exec_state, &args, false).await?;

            face_ids.push(extrude_plane_id);
        }
    }

    if face_ids.is_empty() {
        return Err(KclError::Type(KclErrorDetails {
            message: "Expected at least one valid face".to_string(),
            source_ranges: vec![args.source_range],
        }));
    }

    // Make sure all the solids have the same id, as we are going to shell them all at
    // once.
    if !solids.iter().all(|eg| eg.id == solids[0].id) {
        return Err(KclError::Type(KclErrorDetails {
            message: "All solids stem from the same root object, like multiple sketch on face extrusions, etc."
                .to_string(),
            source_ranges: vec![args.source_range],
        }));
    }

    args.batch_modeling_cmd(
        exec_state.id_generator.next_uuid(),
        ModelingCmd::from(mcmd::Solid3dShellFace {
            hollow: false,
            face_ids,
            object_id: solids[0].id,
            shell_thickness: LengthUnit(data.thickness),
        }),
    )
    .await?;

    Ok(solid_set)
}

/// Make the inside of a 3D object hollow.
pub async fn hollow(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let (thickness, solid): (f64, Box<Solid>) = args.get_data_and_solid()?;

    let solid = inner_hollow(thickness, solid, exec_state, args).await?;
    Ok(KclValue::Solid(solid))
}

/// Make the inside of a 3D object hollow.
///
/// Remove volume from a 3-dimensional shape such that a wall of the
/// provided thickness remains around the exterior of the shape.
///
/// ```no_run
/// // Hollow a basic sketch.
/// const firstSketch = startSketchOn('XY')
///     |> startProfileAt([-12, 12], %)
///     |> line([24, 0], %)
///     |> line([0, -24], %)
///     |> line([-24, 0], %)
///     |> close(%)
///     |> extrude(6, %)
///     |> hollow (0.25, %)
/// ```
///
/// ```no_run
/// // Hollow a basic sketch.
/// const firstSketch = startSketchOn('-XZ')
///     |> startProfileAt([-12, 12], %)
///     |> line([24, 0], %)
///     |> line([0, -24], %)
///     |> line([-24, 0], %)
///     |> close(%)
///     |> extrude(6, %)
///     |> hollow (0.5, %)
/// ```
///
/// ```no_run
/// // Hollow a sketch on face object.
/// let size = 100
/// const case = startSketchOn('-XZ')
///     |> startProfileAt([-size, -size], %)
///     |> line([2 * size, 0], %)
///     |> line([0, 2 * size], %)
///     |> tangentialArcTo([-size, size], %)
///     |> close(%)
///     |> extrude(65, %)
///
/// const thing1 = startSketchOn(case, 'end')
///     |> circle({ center = [-size / 2, -size / 2], radius = 25 }, %)
///     |> extrude(50, %)
///
/// const thing2 = startSketchOn(case, 'end')
///     |> circle({ center = [size / 2, -size / 2], radius = 25 }, %)
///     |> extrude(50, %)
///
/// hollow(0.5, case)
/// ```
#[stdlib {
    name = "hollow",
}]
async fn inner_hollow(
    thickness: f64,
    solid: Box<Solid>,
    exec_state: &mut ExecState,
    args: Args,
) -> Result<Box<Solid>, KclError> {
    // Flush the batch for our fillets/chamfers if there are any.
    // If we do not do these for sketch on face, things will fail with face does not exist.
    args.flush_batch_for_solid_set(exec_state, solid.clone().into()).await?;

    args.batch_modeling_cmd(
        exec_state.id_generator.next_uuid(),
        ModelingCmd::from(mcmd::Solid3dShellFace {
            hollow: true,
            face_ids: Vec::new(), // This is empty because we want to hollow the entire object.
            object_id: solid.id,
            shell_thickness: LengthUnit(thickness),
        }),
    )
    .await?;

    Ok(solid)
}
