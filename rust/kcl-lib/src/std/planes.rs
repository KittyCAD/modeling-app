//! Standard library plane helpers.

use kcmc::{each_cmd as mcmd, length_unit::LengthUnit, shared::Color, ModelingCmd};
use kittycad_modeling_cmds as kcmc;

use super::{args::TyF64, sketch::PlaneData};
use crate::{
    errors::KclError,
    execution::{types::RuntimeType, ExecState, KclValue, Plane, PlaneType},
    std::Args,
};

/// Offset a plane by a distance along its normal.
pub async fn offset_plane(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let std_plane = args.get_unlabeled_kw_arg("plane")?;
    let offset: TyF64 = args.get_kw_arg_typed("offset", &RuntimeType::length(), exec_state)?;
    let plane = inner_offset_plane(std_plane, offset, exec_state, &args).await?;
    Ok(KclValue::Plane { value: Box::new(plane) })
}

async fn inner_offset_plane(
    plane: PlaneData,
    offset: TyF64,
    exec_state: &mut ExecState,
    args: &Args,
) -> Result<Plane, KclError> {
    let mut plane = Plane::from_plane_data(plane, exec_state)?;
    // Though offset planes might be derived from standard planes, they are not
    // standard planes themselves.
    plane.value = PlaneType::Custom;

    let normal = plane.info.x_axis.axes_cross_product(&plane.info.y_axis);
    plane.info.origin += normal * offset.to_length_units(plane.info.origin.units);
    make_offset_plane_in_engine(&plane, exec_state, args).await?;

    Ok(plane)
}

// Engine-side effectful creation of an actual plane object.
// offset planes are shown by default, and hidden by default if they
// are used as a sketch plane. That hiding command is sent within inner_start_profile_at
async fn make_offset_plane_in_engine(plane: &Plane, exec_state: &mut ExecState, args: &Args) -> Result<(), KclError> {
    // Create new default planes.
    let default_size = 100.0;
    let color = Color {
        r: 0.6,
        g: 0.6,
        b: 0.6,
        a: 0.3,
    };

    args.batch_modeling_cmd(
        plane.id,
        ModelingCmd::from(mcmd::MakePlane {
            clobber: false,
            origin: plane.info.origin.into(),
            size: LengthUnit(default_size),
            x_axis: plane.info.x_axis.into(),
            y_axis: plane.info.y_axis.into(),
            hide: Some(false),
        }),
    )
    .await?;

    // Set the color.
    args.batch_modeling_cmd(
        exec_state.next_uuid(),
        ModelingCmd::from(mcmd::PlaneSetColor {
            color,
            plane_id: plane.id,
        }),
    )
    .await?;

    Ok(())
}
