use crate::{
    ExecState,
    errors::KclError,
    exec::KclValue,
    execution::{
        ModelingCmdMeta, Solid,
        types::{NumericTypeExt, PrimitiveType, RuntimeType},
    },
    std::{
        Args,
        args::TyF64,
        sketch::{PlaneData, make_sketch_plane_from_orientation},
    },
};
use kcmc::each_cmd as mcmd;
use kittycad_modeling_cmds::{
    self as kcmc,
    ok_response::OkModelingCmdResponse,
    shared::{PathSegment, Point3d},
    units::UnitLength,
    websocket::OkWebSocketResponseData,
};
use kittycad_modeling_cmds::{ModelingCmd, websocket::ModelingCmdReq};

#[derive(Debug)]
pub struct Move {
    end: Point3d<f32>,
    point: Option<Point3d<f32>>,
    trajectory: Trajectory,
}

#[derive(Debug)]
pub enum Trajectory {
    Linear,
    CircularCw,
    CircularCcw,
}

pub fn s_curve(
    part_width: f32,
    part_height: f32,
    tool_diameter: f32,
    origin: Point3d<f32>,
    direction: Point3d<f32>,
    stepover: f32,
) -> Vec<Move> {
    // The distance before or past the part itself. This gives the operation clearance to go past the part
    // and back into the part.
    let overhang = tool_diameter;

    // Start point in world coordinate for the S Curve
    let start_point = Point3d {
        x: (-((1.0 - stepover) * overhang)) * direction.x + origin.x,
        y: (-overhang) * direction.y + origin.y,
        z: origin.z,
    };

    let mut moves: Vec<Move> = vec![];

    // Scalar between the S Curve rows based on the tool diameter and the percent stepover.
    let density = tool_diameter * stepover;

    // The number of S curve rows
    let interval = (part_width / density).ceil() as i32 + 1;

    // Push origin
    moves.push(Move {
        trajectory: Trajectory::Linear,
        end: Point3d {
            x: start_point.x,
            y: start_point.y,
            z: start_point.z,
        },
        point: None,
    });

    // For the number of rows in the s curve push lines and arcs
    for i in 0..interval {
        // X position of the row
        let x_row: f32 = (i as f32 * density * direction.x) + start_point.x;
        // X position of the next row in the loop
        let next_x_row = (((i + 1) as f32 * density) * direction.x) + start_point.x;
        // Difference of values between the x row and next x row. Not a world coordinate value.
        let diff_of_x_rows = (next_x_row - x_row) * direction.x / 2.0;

        // First draw the line going upwards in +Y from the origin point in world coordinate
        if i % 2 == 0 {
            // The x position of the line and the start of the arc.
            let x = x_row;
            let end_y = ((part_height + overhang + overhang) * direction.y) + start_point.y;
            // diff_of_x_rows makes it a circular arc
            let arc_middle_y = start_point.y + (direction.y * (part_height + overhang + overhang + diff_of_x_rows));

            // Push line
            moves.push(Move {
                trajectory: Trajectory::Linear,
                end: Point3d {
                    x: x,
                    y: end_y,
                    z: start_point.z,
                },
                point: None,
            });

            if i < interval - 1 {
                // Create the clockwise arc since you are moving +Y then going +X
                moves.push(Move {
                    trajectory: Trajectory::CircularCw,
                    point: Some(Point3d {
                        x: x_row + diff_of_x_rows,
                        y: arc_middle_y,
                        z: start_point.z,
                    }),
                    end: Point3d {
                        x: next_x_row,
                        y: end_y,
                        z: start_point.z,
                    },
                });
            }
        } else {
            // -Y
            let x = x_row;

            // The move end needs to be in the direction going down.
            let y = start_point.y;
            // diff_of_x_rows makes it a circular arc
            let arc_middle_y = -diff_of_x_rows * direction.y + start_point.y;
            moves.push(Move {
                trajectory: Trajectory::Linear,
                end: Point3d {
                    x: x,
                    y: y,
                    z: start_point.z,
                },
                point: None,
            });

            if i < interval - 1 {
                // Create the counter clockwise arc
                moves.push(Move {
                    trajectory: Trajectory::CircularCcw,
                    point: Some(Point3d {
                        x: x + diff_of_x_rows,
                        y: arc_middle_y,
                        z: start_point.z,
                    }),
                    end: Point3d {
                        x: next_x_row,
                        y: y,
                        z: start_point.z,
                    },
                });
            }
        }
    }

    moves
}

pub async fn facing(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    #[cfg(target_arch = "wasm32")]
    web_sys::console::log_1(&format!("Facing was called!").into());

    // Get the 3D Solid
    let solid: Solid = args.get_unlabeled_kw_arg("solid", &RuntimeType::Primitive(PrimitiveType::Solid), exec_state)?;

    // Get the tool diameter
    let tool_diameter: TyF64 = args.get_kw_arg("toolDiameter", &RuntimeType::length(), exec_state)?;

    let step_over: TyF64 = args.get_kw_arg("stepOver", &RuntimeType::num_any(), exec_state)?;

    let bounding_box_cmd_id = exec_state.next_uuid();
    let cmd = ModelingCmd::from(
        mcmd::BoundingBox::builder()
            .entity_ids(vec![solid.id])
            .output_unit(UnitLength::Millimeters)
            .build(),
    );
    // Await the response of the AABB
    let response = exec_state
        .send_modeling_cmd(
            ModelingCmdMeta::from_args_id(exec_state, &args, bounding_box_cmd_id),
            cmd,
        )
        .await?;

    let bounding_box = if let OkWebSocketResponseData::Modeling {
        modeling_response: OkModelingCmdResponse::BoundingBox(data),
    } = response
    {
        Some(data)
    } else {
        None
    };

    match bounding_box {
        Some(bounding_box) => {
            let aabb = bounding_box.dimensions;
            let center = bounding_box.center;
            let origin = Point3d {
                x: (center.x - (aabb.x / 2.0)) as f32,
                y: (center.y - (aabb.y / 2.0)) as f32,
                z: (center.z + (aabb.z / 2.0)) as f32,
            };
            let direction = Point3d { x: 1.0, y: 1.0, z: 1.0 };
            let part_width = aabb.x;
            let part_height = aabb.y;
            let moves = s_curve(
                part_width as f32,
                part_height as f32,
                tool_diameter.n as f32,
                origin,
                direction,
                step_over.n as f32,
            );

            let plane = make_sketch_plane_from_orientation(PlaneData::XY, exec_state, &args).await?;
            let sketch_surface_id = plane.id;
            let enable_sketch_id = exec_state.next_uuid();
            let path_id = exec_state.next_uuid();
            let disable_sketch_id = exec_state.next_uuid();

            let mut cmds = vec![
                // Enter sketch mode on the surface.
                // We call this here so you can reuse the sketch surface for multiple sketches.
                ModelingCmdReq {
                    cmd: ModelingCmd::from(
                        mcmd::EnableSketchMode::builder()
                            .animated(false)
                            .ortho(false)
                            .entity_id(sketch_surface_id)
                            .adjust_camera(false)
                            .planar_normal(plane.info.x_axis.axes_cross_product(&plane.info.y_axis).into())
                            .build(),
                    ),
                    cmd_id: enable_sketch_id.into(),
                },
                ModelingCmdReq {
                    cmd: ModelingCmd::from(mcmd::StartPath::default()),
                    cmd_id: path_id.into(),
                },
                ModelingCmdReq {
                    cmd: ModelingCmd::from(
                        mcmd::MovePathPen::builder()
                            .path(path_id.into())
                            .to(Point3d {
                                x: kittycad_modeling_cmds::length_unit::LengthUnit(moves[0].end.x as f64),
                                y: kittycad_modeling_cmds::length_unit::LengthUnit(moves[0].end.y as f64),
                                z: kittycad_modeling_cmds::length_unit::LengthUnit(moves[0].end.z as f64),
                            })
                            .build(),
                    ),
                    cmd_id: exec_state.next_uuid().into(),
                },
            ];

            for move_op in moves {
                match move_op.point {
                    Some(p) => {
                        cmds.push(ModelingCmdReq {
                            cmd_id: exec_state.next_uuid().into(),
                            cmd: ModelingCmd::from(
                                mcmd::ExtendPath::builder()
                                    .path(path_id.into())
                                    .segment(PathSegment::ArcTo {
                                        interior: Point3d {
                                            x: kittycad_modeling_cmds::length_unit::LengthUnit(p.x as f64),
                                            y: kittycad_modeling_cmds::length_unit::LengthUnit(p.y as f64),
                                            z: kittycad_modeling_cmds::length_unit::LengthUnit(p.z as f64),
                                        },
                                        end: Point3d {
                                            x: kittycad_modeling_cmds::length_unit::LengthUnit(move_op.end.x as f64),
                                            y: kittycad_modeling_cmds::length_unit::LengthUnit(move_op.end.y as f64),
                                            z: kittycad_modeling_cmds::length_unit::LengthUnit(move_op.end.z as f64),
                                        },
                                        relative: false,
                                    })
                                    .build(),
                            ),
                        });
                    }
                    None => {
                        cmds.push(ModelingCmdReq {
                            cmd_id: exec_state.next_uuid().into(),
                            cmd: ModelingCmd::from(
                                mcmd::ExtendPath::builder()
                                    .path(path_id.into())
                                    .segment(PathSegment::Line {
                                        end: Point3d {
                                            x: kittycad_modeling_cmds::length_unit::LengthUnit(move_op.end.x as f64),
                                            y: kittycad_modeling_cmds::length_unit::LengthUnit(move_op.end.y as f64),
                                            z: kittycad_modeling_cmds::length_unit::LengthUnit(move_op.end.z as f64),
                                        },
                                        relative: false,
                                    })
                                    .build(),
                            ),
                        });
                    }
                }
            }

            // disable
            cmds.push(ModelingCmdReq {
                cmd: ModelingCmd::SketchModeDisable(mcmd::SketchModeDisable::default()),
                cmd_id: disable_sketch_id.into(),
            });

            exec_state
                .batch_modeling_cmds(ModelingCmdMeta::new(exec_state, &args.ctx, args.source_range), &cmds)
                .await?;
        }
        None => {}
    }

    // Pass this to the engine in an engine endpoint
    Ok(KclValue::Number {
        value: 4.0,
        ty: kcl_api::NumericType::count(),
        meta: vec![],
    })
}
