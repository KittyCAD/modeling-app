//! Standard library shells.

use anyhow::Result;
use derive_docs::stdlib;
use kcmc::{each_cmd as mcmd, length_unit::LengthUnit, ModelingCmd};
use kittycad_modeling_cmds as kcmc;

use crate::{
    errors::{KclError, KclErrorDetails},
    execution::{ExecState, KclValue, Solid, SolidSet},
    std::{sketch::FaceTag, Args},
};

/// Create a shell.
pub async fn shell(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let solid_set = args.get_unlabeled_kw_arg("solidSet")?;
    let thickness = args.get_kw_arg("thickness")?;
    let faces = args.get_kw_arg("faces")?;

    let result = inner_shell(solid_set, thickness, faces, exec_state, args).await?;
    Ok(result.into())
}

/// Remove volume from a 3-dimensional shape such that a wall of the
/// provided thickness remains, taking volume starting at the provided
/// face, leaving it open in that direction.
///
/// ```no_run
/// // Remove the end face for the extrusion.
/// firstSketch = startSketchOn('XY')
///     |> startProfileAt([-12, 12], %)
///     |> line(end = [24, 0])
///     |> line(end = [0, -24])
///     |> line(end = [-24, 0])
///     |> close()
///     |> extrude(length = 6)
///
/// // Remove the end face for the extrusion.
/// shell(
///     firstSketch,
///     faces = ['end'],
///     thickness = 0.25,
/// )
/// ```
///
/// ```no_run
/// // Remove the start face for the extrusion.
/// firstSketch = startSketchOn('-XZ')
///     |> startProfileAt([-12, 12], %)
///     |> line(end = [24, 0])
///     |> line(end = [0, -24])
///     |> line(end = [-24, 0])
///     |> close()
///     |> extrude(length = 6)
///
/// // Remove the start face for the extrusion.
/// shell(
///     firstSketch,
///     faces = ['start'],
///     thickness = 0.25,
/// )
/// ```
///
/// ```no_run
/// // Remove a tagged face and the end face for the extrusion.
/// firstSketch = startSketchOn('XY')
///     |> startProfileAt([-12, 12], %)
///     |> line(end = [24, 0])
///     |> line(end = [0, -24])
///     |> line(end = [-24, 0], tag = $myTag)
///     |> close()
///     |> extrude(length = 6)
///
/// // Remove a tagged face for the extrusion.
/// shell(
///     firstSketch,
///     faces = [myTag],
///     thickness = 0.25,
/// )
/// ```
///
/// ```no_run
/// // Remove multiple faces at once.
/// firstSketch = startSketchOn('XY')
///     |> startProfileAt([-12, 12], %)
///     |> line(end = [24, 0])
///     |> line(end = [0, -24])
///     |> line(end = [-24, 0], tag = $myTag)
///     |> close()
///     |> extrude(length = 6)
///
/// // Remove a tagged face and the end face for the extrusion.
/// shell(
///     firstSketch,
///     faces = [myTag, 'end'],
///     thickness = 0.25,
/// )
/// ```
///
/// ```no_run
/// // Shell a sketch on face.
/// size = 100
/// case = startSketchOn('-XZ')
///     |> startProfileAt([-size, -size], %)
///     |> line(end = [2 * size, 0])
///     |> line(end = [0, 2 * size])
///     |> tangentialArcTo([-size, size], %)
///     |> close()
///     |> extrude(length = 65)
///
/// thing1 = startSketchOn(case, 'end')
///     |> circle({ center = [-size / 2, -size / 2], radius = 25 }, %)
///     |> extrude(length = 50)
///
/// thing2 = startSketchOn(case, 'end')
///     |> circle({ center = [size / 2, -size / 2], radius = 25 }, %)
///     |> extrude(length = 50)
///
/// // We put "case" in the shell function to shell the entire object.
/// shell(case, faces = ['start'], thickness = 5)
/// ```
///
/// ```no_run
/// // Shell a sketch on face object on the end face.
/// size = 100
/// case = startSketchOn('XY')
///     |> startProfileAt([-size, -size], %)
///     |> line(end = [2 * size, 0])
///     |> line(end = [0, 2 * size])
///     |> tangentialArcTo([-size, size], %)
///     |> close()
///     |> extrude(length = 65)
///
/// thing1 = startSketchOn(case, 'end')
///     |> circle({ center = [-size / 2, -size / 2], radius = 25 }, %)
///     |> extrude(length = 50)
///
/// thing2 = startSketchOn(case, 'end')
///     |> circle({ center = [size / 2, -size / 2], radius = 25 }, %)
///     |> extrude(length = 50)
///
/// // We put "thing1" in the shell function to shell the end face of the object.
/// shell(thing1, faces = ['end'], thickness = 5)
/// ```
///
/// ```no_run
/// // Shell sketched on face objects on the end face, include all sketches to shell
/// // the entire object.
///
/// size = 100
/// case = startSketchOn('XY')
///     |> startProfileAt([-size, -size], %)
///     |> line(end = [2 * size, 0])
///     |> line(end = [0, 2 * size])
///     |> tangentialArcTo([-size, size], %)
///     |> close()
///     |> extrude(length = 65)
///
/// thing1 = startSketchOn(case, 'end')
///     |> circle({ center = [-size / 2, -size / 2], radius = 25 }, %)
///     |> extrude(length = 50)
///
/// thing2 = startSketchOn(case, 'end')
///     |> circle({ center = [size / 2, -size / 2], radius = 25 }, %)
///     |> extrude(length = 50)
///
/// // We put "thing1" and "thing2" in the shell function to shell the end face of the object.
/// shell([thing1, thing2], faces = ['end'], thickness = 5)
/// ```
#[stdlib {
    name = "shell",
    feature_tree_operation = true,
    keywords = true,
    unlabeled_first = true,
    args = {
        solid_set = { docs = "Which solid (or solids) to shell out"},
        thickness = {docs = "The thickness of the shell"},
        faces = {docs = "The faces you want removed"},
    }
}]
async fn inner_shell(
    solid_set: SolidSet,
    thickness: f64,
    faces: Vec<FaceTag>,
    exec_state: &mut ExecState,
    args: Args,
) -> Result<SolidSet, KclError> {
    if faces.is_empty() {
        return Err(KclError::Type(KclErrorDetails {
            message: "You must shell at least one face".to_string(),
            source_ranges: vec![args.source_range],
        }));
    }

    let solids: Vec<Box<Solid>> = solid_set.clone().into();
    if solids.is_empty() {
        return Err(KclError::Type(KclErrorDetails {
            message: "You must shell at least one solid".to_string(),
            source_ranges: vec![args.source_range],
        }));
    }

    let mut face_ids = Vec::new();
    for solid in &solids {
        // Flush the batch for our fillets/chamfers if there are any.
        // If we do not do these for sketch on face, things will fail with face does not exist.
        args.flush_batch_for_solid_set(exec_state, solid.clone().into()).await?;

        for tag in &faces {
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
        exec_state.next_uuid(),
        ModelingCmd::from(mcmd::Solid3dShellFace {
            hollow: false,
            face_ids,
            object_id: solids[0].id,
            shell_thickness: LengthUnit(thickness),
        }),
    )
    .await?;

    Ok(solid_set)
}

/// Make the inside of a 3D object hollow.
pub async fn hollow(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let (thickness, solid): (f64, Box<Solid>) = args.get_data_and_solid()?;

    let value = inner_hollow(thickness, solid, exec_state, args).await?;
    Ok(KclValue::Solid { value })
}

/// Make the inside of a 3D object hollow.
///
/// Remove volume from a 3-dimensional shape such that a wall of the
/// provided thickness remains around the exterior of the shape.
///
/// ```no_run
/// // Hollow a basic sketch.
/// firstSketch = startSketchOn('XY')
///     |> startProfileAt([-12, 12], %)
///     |> line(end = [24, 0])
///     |> line(end = [0, -24])
///     |> line(end = [-24, 0])
///     |> close()
///     |> extrude(length = 6)
///     |> hollow (0.25, %)
/// ```
///
/// ```no_run
/// // Hollow a basic sketch.
/// firstSketch = startSketchOn('-XZ')
///     |> startProfileAt([-12, 12], %)
///     |> line(end = [24, 0])
///     |> line(end = [0, -24])
///     |> line(end = [-24, 0])
///     |> close()
///     |> extrude(length = 6)
///     |> hollow (0.5, %)
/// ```
///
/// ```no_run
/// // Hollow a sketch on face object.
/// size = 100
/// case = startSketchOn('-XZ')
///     |> startProfileAt([-size, -size], %)
///     |> line(end = [2 * size, 0])
///     |> line(end = [0, 2 * size])
///     |> tangentialArcTo([-size, size], %)
///     |> close()
///     |> extrude(length = 65)
///
/// thing1 = startSketchOn(case, 'end')
///     |> circle({ center = [-size / 2, -size / 2], radius = 25 }, %)
///     |> extrude(length = 50)
///
/// thing2 = startSketchOn(case, 'end')
///     |> circle({ center = [size / 2, -size / 2], radius = 25 }, %)
///     |> extrude(length = 50)
///
/// hollow(0.5, case)
/// ```
#[stdlib {
    name = "hollow",
    feature_tree_operation = true,
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
        exec_state.next_uuid(),
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
