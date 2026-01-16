//! Standard library plane helpers.

use kcmc::{ModelingCmd, each_cmd as mcmd, length_unit::LengthUnit, shared::Color};
use kittycad_modeling_cmds::{
    self as kcmc, ok_response::OkModelingCmdResponse, units::UnitLength, websocket::OkWebSocketResponseData,
};

use super::{
    args::TyF64,
    sketch::{FaceTag, PlaneData},
};
use crate::{
    errors::{KclError, KclErrorDetails},
    execution::{ExecState, KclValue, Metadata, ModelingCmdMeta, Plane, PlaneInfo, PlaneKind, types::RuntimeType},
    std::Args,
};

/// Find the plane of a given face.
pub async fn plane_of(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let solid = args.get_unlabeled_kw_arg("solid", &RuntimeType::solid(), exec_state)?;
    let face = args.get_kw_arg("face", &RuntimeType::tagged_face(), exec_state)?;

    inner_plane_of(solid, face, exec_state, &args)
        .await
        .map(Box::new)
        .map(|value| KclValue::Plane { value })
}

pub(crate) async fn inner_plane_of(
    solid: crate::execution::Solid,
    face: FaceTag,
    exec_state: &mut ExecState,
    args: &Args,
) -> Result<Plane, KclError> {
    let plane_id = exec_state.id_generator().next_uuid();

    // Support mock execution
    // Return an arbitrary (incorrect) plane and a non-fatal error.
    if args.ctx.no_engine_commands().await {
        exec_state.err(crate::CompilationError {
            source_range: args.source_range,
            message: "The engine isn't available, so returning an arbitrary incorrect plane".to_owned(),
            suggestion: None,
            severity: crate::errors::Severity::Error,
            tag: crate::errors::Tag::None,
        });
        return Ok(Plane {
            artifact_id: plane_id.into(),
            id: plane_id,
            // Engine doesn't know about the ID we created, so set this to
            // uninitialized.
            object_id: None,
            kind: PlaneKind::Custom,
            info: crate::execution::PlaneInfo {
                origin: crate::execution::Point3d {
                    x: 0.0,
                    y: 0.0,
                    z: 0.0,
                    units: Some(UnitLength::Millimeters),
                },
                x_axis: crate::execution::Point3d {
                    x: 1.0,
                    y: 0.0,
                    z: 0.0,
                    units: None,
                },
                y_axis: crate::execution::Point3d {
                    x: 0.0,
                    y: 1.0,
                    z: 0.0,
                    units: None,
                },
                z_axis: crate::execution::Point3d {
                    x: 0.0,
                    y: 0.0,
                    z: 1.0,
                    units: None,
                },
            },
            meta: vec![Metadata {
                source_range: args.source_range,
            }],
        });
    }

    // Flush the batch for our fillets/chamfers if there are any.
    exec_state
        .flush_batch_for_solids(
            ModelingCmdMeta::from_args(exec_state, args),
            std::slice::from_ref(&solid),
        )
        .await?;

    // Query the engine to learn what plane, if any, this face is on.
    let face_id = face.get_face_id(&solid, exec_state, args, true).await?;
    let meta = ModelingCmdMeta::from_args_id(exec_state, args, plane_id);
    let cmd = ModelingCmd::FaceIsPlanar(mcmd::FaceIsPlanar::builder().object_id(face_id).build());
    let plane_resp = exec_state.send_modeling_cmd(meta, cmd).await?;
    let OkWebSocketResponseData::Modeling {
        modeling_response: OkModelingCmdResponse::FaceIsPlanar(planar),
    } = plane_resp
    else {
        return Err(KclError::new_semantic(KclErrorDetails::new(
            format!(
                "Engine returned invalid response, it should have returned FaceIsPlanar but it returned {plane_resp:#?}"
            ),
            vec![args.source_range],
        )));
    };

    // Destructure engine's response to check if the face was on a plane.
    let not_planar: Result<_, KclError> = Err(KclError::new_semantic(KclErrorDetails::new(
        "The face you provided doesn't lie on any plane. It might be curved.".to_owned(),
        vec![args.source_range],
    )));
    let Some(x_axis) = planar.x_axis else { return not_planar };
    let Some(y_axis) = planar.y_axis else { return not_planar };
    let Some(z_axis) = planar.z_axis else { return not_planar };
    let Some(origin) = planar.origin else { return not_planar };

    // Engine always returns measurements in mm.
    let engine_units = Some(UnitLength::Millimeters);
    let x_axis = crate::execution::Point3d {
        x: x_axis.x,
        y: x_axis.y,
        z: x_axis.z,
        units: engine_units,
    };
    let y_axis = crate::execution::Point3d {
        x: y_axis.x,
        y: y_axis.y,
        z: y_axis.z,
        units: engine_units,
    };
    let z_axis = crate::execution::Point3d {
        x: z_axis.x,
        y: z_axis.y,
        z: z_axis.z,
        units: engine_units,
    };
    let origin = crate::execution::Point3d {
        x: origin.x.0,
        y: origin.y.0,
        z: origin.z.0,
        units: engine_units,
    };

    // Planes should always be right-handed, but due to an engine bug sometimes they're not.
    // Test for right-handedness: cross(X,Y) is Z
    let plane_info = crate::execution::PlaneInfo {
        origin,
        x_axis,
        y_axis,
        z_axis,
    };
    let plane_info = plane_info.make_right_handed();

    let plane_object_id = exec_state.next_object_id();
    #[cfg(feature = "artifact-graph")]
    {
        use crate::execution::ArtifactId;

        let plane_object = crate::front::Object {
            id: plane_object_id,
            kind: crate::front::ObjectKind::Plane(crate::front::Plane::Object(plane_object_id)),
            label: Default::default(),
            comments: Default::default(),
            artifact_id: ArtifactId::new(plane_id),
            source: args.source_range.into(),
        };
        exec_state.add_scene_object(plane_object, args.source_range);
    }

    Ok(Plane {
        artifact_id: plane_id.into(),
        id: plane_id,
        object_id: Some(plane_object_id),
        kind: PlaneKind::Custom,
        info: plane_info,
        meta: vec![Metadata {
            source_range: args.source_range,
        }],
    })
}

/// Offset a plane by a distance along its normal.
pub async fn offset_plane(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let std_plane = args.get_unlabeled_kw_arg("plane", &RuntimeType::plane(), exec_state)?;
    let offset: TyF64 = args.get_kw_arg("offset", &RuntimeType::length(), exec_state)?;
    let plane = inner_offset_plane(std_plane, offset, exec_state, &args).await?;
    Ok(KclValue::Plane { value: Box::new(plane) })
}

async fn inner_offset_plane(
    plane: PlaneData,
    offset: TyF64,
    exec_state: &mut ExecState,
    args: &Args,
) -> Result<Plane, KclError> {
    let mut info = PlaneInfo::try_from(plane)?;

    let normal = info.x_axis.axes_cross_product(&info.y_axis);
    info.origin += normal * offset.to_length_units(info.origin.units.unwrap_or(UnitLength::Millimeters));

    let id = exec_state.next_uuid();
    let mut plane = Plane {
        id,
        artifact_id: id.into(),
        object_id: None,
        kind: PlaneKind::Custom,
        info,
        meta: vec![Metadata {
            source_range: args.source_range,
        }],
    };
    make_offset_plane_in_engine(&mut plane, exec_state, args).await?;

    Ok(plane)
}

// Engine-side effectful creation of an actual plane object.
// offset planes are shown by default, and hidden by default if they
// are used as a sketch plane. That hiding command is sent within inner_start_profile_at
async fn make_offset_plane_in_engine(
    plane: &mut Plane,
    exec_state: &mut ExecState,
    args: &Args,
) -> Result<(), KclError> {
    let plane_object_id = exec_state.next_object_id();
    #[cfg(feature = "artifact-graph")]
    {
        let plane_object = crate::front::Object {
            id: plane_object_id,
            kind: crate::front::ObjectKind::Plane(crate::front::Plane::Object(plane_object_id)),
            label: Default::default(),
            comments: Default::default(),
            artifact_id: plane.artifact_id,
            source: args.source_range.into(),
        };
        exec_state.add_scene_object(plane_object, args.source_range);
    }

    // Create new default planes.
    let default_size = 100.0;
    let color = Color {
        r: 0.6,
        g: 0.6,
        b: 0.6,
        a: 0.3,
    };

    let meta = ModelingCmdMeta::from_args_id(exec_state, args, plane.id);
    exec_state
        .batch_modeling_cmd(
            meta,
            ModelingCmd::from(
                mcmd::MakePlane::builder()
                    .clobber(false)
                    .origin(plane.info.origin.into())
                    .size(LengthUnit(default_size))
                    .x_axis(plane.info.x_axis.into())
                    .y_axis(plane.info.y_axis.into())
                    .hide(false)
                    .build(),
            ),
        )
        .await?;

    // Set the color.
    exec_state
        .batch_modeling_cmd(
            ModelingCmdMeta::from_args(exec_state, args),
            ModelingCmd::from(mcmd::PlaneSetColor::builder().color(color).plane_id(plane.id).build()),
        )
        .await?;

    // Though offset planes might be derived from standard planes, they are
    // not standard planes themselves.
    plane.kind = PlaneKind::Custom;
    plane.object_id = Some(plane_object_id);

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::execution::{PlaneInfo, Point3d};

    #[test]
    fn fixes_left_handed_plane() {
        let plane_info = PlaneInfo {
            origin: Point3d {
                x: 0.0,
                y: 0.0,
                z: 0.0,
                units: Some(UnitLength::Millimeters),
            },
            x_axis: Point3d {
                x: 1.0,
                y: 0.0,
                z: 0.0,
                units: None,
            },
            y_axis: Point3d {
                x: 0.0,
                y: 1.0,
                z: 0.0,
                units: None,
            },
            z_axis: Point3d {
                x: 0.0,
                y: 0.0,
                z: -1.0,
                units: None,
            },
        };

        // This plane is NOT right-handed.
        assert!(plane_info.is_left_handed());
        // But we can make it right-handed:
        let fixed = plane_info.make_right_handed();
        assert!(fixed.is_right_handed());
    }
}
