//! Standard library plane helpers.

use kcl_api::UnitLength;
use kcmc::ModelingCmd;
use kcmc::each_cmd as mcmd;
use kcmc::length_unit::LengthUnit;
use kcmc::shared::Color;
use kittycad_modeling_cmds::ok_response::OkModelingCmdResponse;
use kittycad_modeling_cmds::websocket::OkWebSocketResponseData;
use kittycad_modeling_cmds::{self as kcmc};

use super::args::TyF64;
use super::sketch::PlaneData;
use crate::errors::KclError;
use crate::errors::KclErrorDetails;
use crate::execution::ArtifactId;
use crate::execution::ExecState;
use crate::execution::KclValue;
use crate::execution::Metadata;
use crate::execution::ModelingCmdMeta;
use crate::execution::Plane;
use crate::execution::PlaneInfo;
use crate::execution::PlaneKind;
use crate::execution::Point3d;
use crate::execution::types::ArrayLen;
use crate::execution::types::RuntimeType;
use crate::front::SourceRef;
use crate::std::Args;
use crate::std::args::FromKclValue;
use crate::std::faces::FaceSpecifier;

/// Construct a typed plane using the existing custom-plane engine lifecycle.
pub async fn plane(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let direction_ty = RuntimeType::Array(Box::new(RuntimeType::count()), ArrayLen::Known(3));
    let origin: Option<[TyF64; 3]> = args.get_kw_arg_opt("origin", &RuntimeType::point3d(), exec_state)?;
    let x: Option<[TyF64; 3]> = args.get_kw_arg_opt("xAxis", &direction_ty, exec_state)?;
    let y: Option<[TyF64; 3]> = args.get_kw_arg_opt("yAxis", &direction_ty, exec_state)?;
    let normal: Option<[TyF64; 3]> = args.get_kw_arg_opt("normal", &direction_ty, exec_state)?;
    let points: Option<Vec<KclValue>> = args.get_kw_arg_opt(
        "points",
        &RuntimeType::Array(Box::new(RuntimeType::point3d()), ArrayLen::Known(3)),
        exec_state,
    )?;
    let a: Option<TyF64> = args.get_kw_arg_opt("a", &RuntimeType::count(), exec_state)?;
    let b: Option<TyF64> = args.get_kw_arg_opt("b", &RuntimeType::count(), exec_state)?;
    let c: Option<TyF64> = args.get_kw_arg_opt("c", &RuntimeType::count(), exec_state)?;
    let d: Option<TyF64> = args.get_kw_arg_opt("d", &RuntimeType::length(), exec_state)?;
    let diagnostic = |message: String| KclError::new_semantic(KclErrorDetails::new(message, vec![args.source_range]));
    let fields = [
        origin.is_some(),
        x.is_some(),
        y.is_some(),
        normal.is_some(),
        points.is_some(),
        a.is_some(),
        b.is_some(),
        c.is_some(),
        d.is_some(),
    ];
    let definition = match (fields, origin, x, y, normal, points, a, b, c, d) {
        ([true, true, true, false, false, false, false, false, false], Some(o), Some(x), Some(y), ..) => {
            PlaneDefinition::Axes {
                origin: o.map(|n| n.to_mm()),
                x: x.map(|n| n.n),
                y: y.map(|n| n.n),
            }
        }
        ([true, true, false, true, false, false, false, false, false], Some(o), Some(x), _, Some(n), ..) => {
            PlaneDefinition::Normal {
                origin: o.map(|n| n.to_mm()),
                x: x.map(|n| n.n),
                normal: n.map(|n| n.n),
            }
        }
        ([false, false, false, false, true, false, false, false, false], _, _, _, _, Some(points), ..) => {
            let points = points
                .iter()
                .map(|p| <[TyF64; 3]>::from_kcl_val(p).map(|p| p.map(|n| n.to_mm())))
                .collect::<Option<Vec<_>>>()
                .ok_or_else(|| diagnostic("Expected three 3D points".to_owned()))?;
            let points: [[f64; 3]; 3] = points
                .try_into()
                .map_err(|_| diagnostic("Expected exactly three points".to_owned()))?;
            PlaneDefinition::Points(points)
        }
        (
            [false, true, false, false, false, true, true, true, true],
            _,
            Some(x),
            _,
            _,
            _,
            Some(a),
            Some(b),
            Some(c),
            Some(d),
        ) => PlaneDefinition::Equation {
            normal: [a.n, b.n, c.n],
            d: d.to_mm(),
            x: x.map(|n| n.n),
        },
        _ => {
            return Err(diagnostic(
                "Choose one plane definition: origin/xAxis/yAxis, origin/normal/xAxis, points, or a/b/c/d/xAxis"
                    .to_owned(),
            ));
        }
    };
    let info = plane_frame(definition).map_err(diagnostic)?;
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
    make_offset_plane_in_engine(&mut plane, exec_state, &args).await?;
    Ok(KclValue::Plane { value: Box::new(plane) })
}

enum PlaneDefinition {
    Axes {
        origin: [f64; 3],
        x: [f64; 3],
        y: [f64; 3],
    },
    Normal {
        origin: [f64; 3],
        x: [f64; 3],
        normal: [f64; 3],
    },
    Points([[f64; 3]; 3]),
    Equation {
        normal: [f64; 3],
        d: f64,
        x: [f64; 3],
    },
}

// Angular tolerance on unit directions, independent of the input length unit.
const PLANE_ANGLE_TOLERANCE: f64 = 1e-9;

fn finite(v: [f64; 3]) -> Result<[f64; 3], String> {
    if v.iter().all(|n| n.is_finite()) {
        Ok(v)
    } else {
        Err("Plane inputs must be finite".to_owned())
    }
}

fn unit(v: [f64; 3]) -> Result<[f64; 3], String> {
    let v = finite(v)?;
    let scale = v.iter().map(|n| n.abs()).fold(0.0, libm::fmax);
    if scale == 0.0 {
        return Err("Plane directions must be nonzero; points must be distinct".to_owned());
    }
    let v = v.map(|n| n / scale);
    let length = dot(v, v).sqrt();
    Ok(v.map(|n| n / length))
}

fn dot(a: [f64; 3], b: [f64; 3]) -> f64 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}
fn cross(a: [f64; 3], b: [f64; 3]) -> [f64; 3] {
    [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ]
}
fn sub(a: [f64; 3], b: [f64; 3]) -> [f64; 3] {
    [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}

fn normal_axes(normal: [f64; 3], x: [f64; 3]) -> Result<([f64; 3], [f64; 3]), String> {
    let n = unit(normal)?;
    let hint = unit(x)?;
    let projection = sub(hint, n.map(|v| v * dot(hint, n)));
    if dot(projection, projection).sqrt() <= PLANE_ANGLE_TOLERANCE {
        return Err("The X direction is parallel to the normal".to_owned());
    }
    let x = unit(projection)?;
    Ok((x, unit(cross(n, x))?))
}

fn plane_frame(definition: PlaneDefinition) -> Result<PlaneInfo, String> {
    let (origin, x, y) = match definition {
        PlaneDefinition::Axes { origin, x, y } => {
            let x = unit(x)?;
            let y = unit(y)?;
            if dot(x, y).abs() > PLANE_ANGLE_TOLERANCE {
                return Err("The X and Y axes must be perpendicular".to_owned());
            }
            (origin, x, unit(sub(y, x.map(|v| v * dot(x, y))))?)
        }
        PlaneDefinition::Normal { origin, x, normal } => {
            let (x, y) = normal_axes(normal, x)?;
            (origin, x, y)
        }
        PlaneDefinition::Points(points) => {
            for p in points {
                finite(p)?;
            }
            let x = unit(sub(points[1], points[0]))?;
            let to_third = unit(sub(points[2], points[0]))?;
            let normal = cross(x, to_third);
            if dot(normal, normal).sqrt() <= PLANE_ANGLE_TOLERANCE {
                return Err("The three points must not be collinear".to_owned());
            }
            (points[0], x, unit(cross(unit(normal)?, x))?)
        }
        PlaneDefinition::Equation { normal, d, x } => {
            let n = unit(normal)?;
            if !d.is_finite() {
                return Err("Plane inputs must be finite".to_owned());
            }
            let scale = normal.iter().map(|v| v.abs()).fold(0.0, libm::fmax);
            let scaled = normal.map(|v| v / scale);
            let distance = -(d / scale) / dot(scaled, scaled).sqrt();
            let (x, y) = normal_axes(n, x)?;
            (n.map(|v| v * distance), x, y)
        }
    };
    let origin = finite(origin)?;
    let axis = |v: [f64; 3]| Point3d::new(v[0], v[1], v[2], None);
    Ok(PlaneInfo {
        origin: Point3d::new(origin[0], origin[1], origin[2], Some(UnitLength::Millimeters)),
        x_axis: axis(x),
        y_axis: axis(y),
        z_axis: axis(unit(cross(x, y))?),
    })
}

/// Find the plane of a given face.
pub async fn plane_of(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let solid = args.get_unlabeled_kw_arg("solid", &RuntimeType::solid(), exec_state)?;
    let face = args.get_kw_arg("face", &RuntimeType::tagged_face_or_segment(), exec_state)?;

    inner_plane_of(solid, face, exec_state, &args)
        .await
        .map(Box::new)
        .map(|value| KclValue::Plane { value })
}

pub(crate) async fn inner_plane_of(
    solid: crate::execution::Solid,
    face: FaceSpecifier,
    exec_state: &mut ExecState,
    args: &Args,
) -> Result<Plane, KclError> {
    let plane_id = exec_state.id_generator().next_uuid();

    // Support mock execution
    // Return an arbitrary (incorrect) plane and a non-fatal error.
    if args.ctx.no_engine_commands().await {
        exec_state.err(crate::CompilationIssue {
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
    let face_id = face.face_id(&solid, exec_state, args, true).await?;
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
    let plane_object = crate::front::Object {
        id: plane_object_id,
        kind: crate::front::ObjectKind::Plane(crate::front::Plane::Object(plane_object_id)),
        label: Default::default(),
        comments: Default::default(),
        artifact_id: ArtifactId::new(plane_id),
        source: SourceRef::new(args.source_range, args.node_path.clone()),
    };
    exec_state.add_scene_object(plane_object, args.source_range);

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
// are used as a sketch plane. That hiding command is sent within create_sketch.
async fn make_offset_plane_in_engine(
    plane: &mut Plane,
    exec_state: &mut ExecState,
    args: &Args,
) -> Result<(), KclError> {
    let plane_object_id = exec_state.next_object_id();
    let plane_object = crate::front::Object {
        id: plane_object_id,
        kind: crate::front::ObjectKind::Plane(crate::front::Plane::Object(plane_object_id)),
        label: Default::default(),
        comments: Default::default(),
        artifact_id: plane.artifact_id,
        source: SourceRef::new(args.source_range, args.node_path.clone()),
    };
    exec_state.add_scene_object(plane_object, args.source_range);

    // Create new default planes.
    let default_size = 100.0;
    let color = Color::from_rgba(0.6, 0.6, 0.6, 0.3);

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
    // PlaneSetColor is blocked on CPU engines until https://github.com/KittyCAD/engine/pull/5127 or similar is merged
    if !exec_state.geometry_only() {
        exec_state
            .batch_modeling_cmd(
                ModelingCmdMeta::from_args(exec_state, args),
                ModelingCmd::from(mcmd::PlaneSetColor::builder().color(color).plane_id(plane.id).build()),
            )
            .await?;
    }

    // Though offset planes might be derived from standard planes, they are
    // not standard planes themselves.
    plane.kind = PlaneKind::Custom;
    plane.object_id = Some(plane_object_id);

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::execution::PlaneInfo;
    use crate::execution::Point3d;

    fn assert_vector(actual: Point3d, expected: [f64; 3]) {
        for (a, b) in [actual.x, actual.y, actual.z].into_iter().zip(expected) {
            assert!((a - b).abs() < 1e-9, "{actual:?} != {expected:?}");
        }
    }

    #[test]
    fn constructor_forms_produce_the_same_frame() {
        let definitions = [
            PlaneDefinition::Axes {
                origin: [0.0, 0.0, 20.0],
                x: [3.0, 0.0, 0.0],
                y: [0.0, 4.0, 0.0],
            },
            PlaneDefinition::Normal {
                origin: [0.0, 0.0, 20.0],
                x: [1.0, 0.0, 8.0],
                normal: [0.0, 0.0, 2.0],
            },
            PlaneDefinition::Points([[0.0, 0.0, 20.0], [10.0, 0.0, 20.0], [3.0, 10.0, 20.0]]),
            PlaneDefinition::Equation {
                normal: [0.0, 0.0, 2.0],
                d: -40.0,
                x: [1.0, 0.0, 0.0],
            },
        ];
        for definition in definitions {
            let p = plane_frame(definition).unwrap();
            assert_vector(p.origin, [0.0, 0.0, 20.0]);
            assert_vector(p.x_axis, [1.0, 0.0, 0.0]);
            assert_vector(p.y_axis, [0.0, 1.0, 0.0]);
            assert_vector(p.z_axis, [0.0, 0.0, 1.0]);
            assert!(p.is_right_handed());
        }
    }

    #[test]
    fn equation_sign_controls_orientation_and_large_vectors_are_stable() {
        let p = plane_frame(PlaneDefinition::Equation {
            normal: [0.0, 0.0, -1e200],
            d: 20e200,
            x: [1e200, 0.0, 0.0],
        })
        .unwrap();
        assert_vector(p.origin, [0.0, 0.0, 20.0]);
        assert_vector(p.y_axis, [0.0, -1.0, 0.0]);
        assert_vector(p.z_axis, [0.0, 0.0, -1.0]);
    }

    #[test]
    fn ordered_points_determine_origin_and_normal() {
        let p = plane_frame(PlaneDefinition::Points([
            [4.0, 5.0, 6.0],
            [4.0, 7.0, 6.0],
            [7.0, 5.0, 6.0],
        ]))
        .unwrap();
        assert_vector(p.origin, [4.0, 5.0, 6.0]);
        assert_vector(p.x_axis, [0.0, 1.0, 0.0]);
        assert_vector(p.z_axis, [0.0, 0.0, -1.0]);
    }

    #[test]
    fn rejects_degenerate_frames() {
        for definition in [
            PlaneDefinition::Axes {
                origin: [0.0; 3],
                x: [0.0; 3],
                y: [0.0, 1.0, 0.0],
            },
            PlaneDefinition::Axes {
                origin: [0.0; 3],
                x: [1.0, 0.0, 0.0],
                y: [1.0, 1.0, 0.0],
            },
            PlaneDefinition::Normal {
                origin: [0.0; 3],
                x: [0.0, 0.0, 1.0],
                normal: [0.0, 0.0, 1.0],
            },
            PlaneDefinition::Normal {
                origin: [f64::NAN, 0.0, 0.0],
                x: [1.0, 0.0, 0.0],
                normal: [0.0, 0.0, 1.0],
            },
            PlaneDefinition::Points([[1.0, 2.0, 3.0], [2.0, 3.0, 4.0], [4.0, 5.0, 6.0]]),
            PlaneDefinition::Points([[0.0; 3]; 3]),
            PlaneDefinition::Equation {
                normal: [0.0; 3],
                d: 1.0,
                x: [1.0, 0.0, 0.0],
            },
            PlaneDefinition::Equation {
                normal: [0.0, 0.0, 1.0],
                d: f64::INFINITY,
                x: [1.0, 0.0, 0.0],
            },
        ] {
            plane_frame(definition).unwrap_err();
        }
    }

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
