//! Standard library shells.

use anyhow::Result;
use kcmc::{each_cmd as mcmd, length_unit::LengthUnit, ModelingCmd};
use kittycad_modeling_cmds as kcmc;

use super::args::TyF64;
use crate::{
    errors::{KclError, KclErrorDetails},
    execution::{
        types::{ArrayLen, RuntimeType},
        ExecState, KclValue, Solid,
    },
    std::{sketch::FaceTag, Args},
};

/// Create a shell.
pub async fn shell(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let solids = args.get_unlabeled_kw_arg_typed("solids", &RuntimeType::solids(), exec_state)?;
    let thickness: TyF64 = args.get_kw_arg_typed("thickness", &RuntimeType::length(), exec_state)?;
    let faces = args.get_kw_arg_typed(
        "faces",
        &RuntimeType::Array(Box::new(RuntimeType::tag()), ArrayLen::NonEmpty),
        exec_state,
    )?;

    let result = inner_shell(solids, thickness, faces, exec_state, args).await?;
    Ok(result.into())
}

async fn inner_shell(
    solids: Vec<Solid>,
    thickness: TyF64,
    faces: Vec<FaceTag>,
    exec_state: &mut ExecState,
    args: Args,
) -> Result<Vec<Solid>, KclError> {
    if faces.is_empty() {
        return Err(KclError::Type(KclErrorDetails {
            message: "You must shell at least one face".to_string(),
            source_ranges: vec![args.source_range],
        }));
    }

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
        args.flush_batch_for_solids(exec_state, &[solid.clone()]).await?;

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
            shell_thickness: LengthUnit(thickness.to_mm()),
        }),
    )
    .await?;

    Ok(solids)
}

/// Make the inside of a 3D object hollow.
pub async fn hollow(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let solid = args.get_unlabeled_kw_arg_typed("solid", &RuntimeType::solid(), exec_state)?;
    let thickness: TyF64 = args.get_kw_arg_typed("thickness", &RuntimeType::length(), exec_state)?;

    let value = inner_hollow(solid, thickness, exec_state, args).await?;
    Ok(KclValue::Solid { value })
}

async fn inner_hollow(
    solid: Box<Solid>,
    thickness: TyF64,
    exec_state: &mut ExecState,
    args: Args,
) -> Result<Box<Solid>, KclError> {
    // Flush the batch for our fillets/chamfers if there are any.
    // If we do not do these for sketch on face, things will fail with face does not exist.
    args.flush_batch_for_solids(exec_state, &[(*solid).clone()]).await?;

    args.batch_modeling_cmd(
        exec_state.next_uuid(),
        ModelingCmd::from(mcmd::Solid3dShellFace {
            hollow: true,
            face_ids: Vec::new(), // This is empty because we want to hollow the entire object.
            object_id: solid.id,
            shell_thickness: LengthUnit(thickness.to_mm()),
        }),
    )
    .await?;

    Ok(solid)
}
