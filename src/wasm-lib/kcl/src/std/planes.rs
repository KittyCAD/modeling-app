//! Standard library plane helpers.

use derive_docs::stdlib;
use kcmc::{each_cmd as mcmd, length_unit::LengthUnit, shared::Color, ModelingCmd};
use kittycad_modeling_cmds as kcmc;

use super::sketch::PlaneData;
use crate::{
    errors::KclError,
    execution::{ExecState, KclValue, Plane, PlaneType},
    std::Args,
};

/// Offset a plane by a distance along its normal.
pub async fn offset_plane(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let std_plane = args.get_unlabeled_kw_arg("plane")?;
    let offset = args.get_kw_arg("offset")?;
    let plane = inner_offset_plane(std_plane, offset, exec_state).await?;
    make_offset_plane_in_engine(&plane, exec_state, &args).await?;
    Ok(KclValue::Plane { value: Box::new(plane) })
}

/// Offset a plane by a distance along its normal.
///
/// For example, if you offset the 'XZ' plane by 10, the new plane will be parallel to the 'XZ'
/// plane and 10 units away from it.
///
/// ```no_run
/// // Loft a square and a circle on the `XY` plane using offset.
/// squareSketch = startSketchOn('XY')
///     |> startProfileAt([-100, 200], %)
///     |> line(end = [200, 0])
///     |> line(end = [0, -200])
///     |> line(end = [-200, 0])
///     |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
///     |> close()
///
/// circleSketch = startSketchOn(offsetPlane('XY', offset = 150))
///     |> circle( center = [0, 100], radius = 50 )
///
/// loft([squareSketch, circleSketch])
/// ```
///
/// ```no_run
/// // Loft a square and a circle on the `XZ` plane using offset.
/// squareSketch = startSketchOn('XZ')
///     |> startProfileAt([-100, 200], %)
///     |> line(end = [200, 0])
///     |> line(end = [0, -200])
///     |> line(end = [-200, 0])
///     |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
///     |> close()
///
/// circleSketch = startSketchOn(offsetPlane('XZ', offset = 150))
///     |> circle( center = [0, 100], radius = 50 )
///
/// loft([squareSketch, circleSketch])
/// ```
///
/// ```no_run
/// // Loft a square and a circle on the `YZ` plane using offset.
/// squareSketch = startSketchOn('YZ')
///     |> startProfileAt([-100, 200], %)
///     |> line(end = [200, 0])
///     |> line(end = [0, -200])
///     |> line(end = [-200, 0])
///     |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
///     |> close()
///
/// circleSketch = startSketchOn(offsetPlane('YZ', offset = 150))
///     |> circle( center = [0, 100], radius = 50 )
///
/// loft([squareSketch, circleSketch])
/// ```
///
/// ```no_run
/// // Loft a square and a circle on the `-XZ` plane using offset.
/// squareSketch = startSketchOn('-XZ')
///     |> startProfileAt([-100, 200], %)
///     |> line(end = [200, 0])
///     |> line(end = [0, -200])
///     |> line(end = [-200, 0])
///     |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
///     |> close()
///
/// circleSketch = startSketchOn(offsetPlane('-XZ', offset = -150))
///     |> circle( center = [0, 100], radius = 50 )
///
/// loft([squareSketch, circleSketch])
/// ```
/// ```no_run
/// // A circle on the XY plane
/// startSketchOn("XY")
///   |> startProfileAt([0, 0], %)
///   |> circle( radius = 10, center = [0, 0] )
///   
/// // Triangle on the plane 4 units above
/// startSketchOn(offsetPlane("XY", offset = 4))
///   |> startProfileAt([0, 0], %)
///   |> line(end = [10, 0])
///   |> line(end = [0, 10])
///   |> close()
/// ```

#[stdlib {
    name = "offsetPlane",
    feature_tree_operation = true,
    keywords = true,
    unlabeled_first = true,
    args = {
        plane = { docs = "The plane (e.g. 'XY') which this new plane is created from." },
        offset = { docs = "Distance from the standard plane this new plane will be created at." },
    }
}]
async fn inner_offset_plane(plane: PlaneData, offset: f64, exec_state: &mut ExecState) -> Result<Plane, KclError> {
    let mut plane = Plane::from_plane_data(plane, exec_state);
    // Though offset planes might be derived from standard planes, they are not
    // standard planes themselves.
    plane.value = PlaneType::Custom;

    plane.origin += plane.z_axis * offset;

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
            origin: plane.origin.into(),
            size: LengthUnit(default_size),
            x_axis: plane.x_axis.into(),
            y_axis: plane.y_axis.into(),
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
