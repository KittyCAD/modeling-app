use kittycad_execution_plan::{
    api_request::ApiRequest,
    sketch_types::{self, Axes, BasePath, Plane, SketchGroup},
    BinaryArithmetic, BinaryOperation, Destination, Instruction, InstructionKind, Operand,
};
use kittycad_execution_plan_traits::{Address, InMemory, Primitive, Value};
use kittycad_modeling_cmds::{
    shared::{Point3d, Point4d},
    ModelingCmdEndpoint,
};
use uuid::Uuid;

use super::helpers::{arg_point2d, no_arg_api_call, sg_binding, single_binding, stack_api_call};
use crate::{binding_scope::EpBinding, error::CompileError, native_functions::Callable, EvalPlan};

#[derive(PartialEq)]
pub enum At {
    RelativeXY,
    AbsoluteXY,
    RelativeX,
    AbsoluteX,
    RelativeY,
    AbsoluteY,
}

impl At {
    pub fn is_relative(&self) -> bool {
        *self == At::RelativeX || *self == At::RelativeY || *self == At::RelativeXY
    }
}

#[derive(Debug, Clone)]
#[cfg_attr(test, derive(Eq, PartialEq))]
pub struct Close;

impl Callable for Close {
    fn call(
        &self,
        _ctx: &mut crate::native_functions::Context<'_>,
        args: Vec<EpBinding>,
    ) -> Result<EvalPlan, CompileError> {
        let mut instructions = Vec::new();
        let fn_name = "close";
        // Get all required params.
        let mut args_iter = args.into_iter();
        let Some(sketch_group) = args_iter.next() else {
            return Err(CompileError::NotEnoughArgs {
                fn_name: fn_name.into(),
                required: 1,
                actual: 1,
            });
        };
        // Check param type.
        let sg = sg_binding(sketch_group, fn_name, "sketch group", 1)?;
        let cmd_id = Uuid::new_v4().into();
        instructions.extend([
            // Push the path ID onto the stack.
            Instruction::from(InstructionKind::SketchGroupCopyFrom {
                destination: Destination::StackPush,
                length: 1,
                source: sg,
                offset: SketchGroup::path_id_offset(),
            }),
            // Call the 'extrude' API request.
            Instruction::from(InstructionKind::ApiRequest(ApiRequest {
                endpoint: ModelingCmdEndpoint::ClosePath,
                store_response: None,
                arguments: vec![
                    // Target (path ID)
                    InMemory::StackPop,
                ],
                cmd_id,
            })),
        ]);

        Ok(EvalPlan {
            instructions,
            binding: EpBinding::SketchGroup { index: sg },
        })
    }
}
#[derive(Debug, Clone)]
#[cfg_attr(test, derive(Eq, PartialEq))]
pub struct Extrude;

impl Callable for Extrude {
    fn call(
        &self,
        _ctx: &mut crate::native_functions::Context<'_>,
        args: Vec<EpBinding>,
    ) -> Result<EvalPlan, CompileError> {
        let mut instructions = Vec::new();
        let fn_name = "extrude";
        // Get all required params.
        let mut args_iter = args.into_iter();
        let Some(height) = args_iter.next() else {
            return Err(CompileError::NotEnoughArgs {
                fn_name: fn_name.into(),
                required: 2,
                actual: 0,
            });
        };
        let Some(sketch_group) = args_iter.next() else {
            return Err(CompileError::NotEnoughArgs {
                fn_name: fn_name.into(),
                required: 2,
                actual: 1,
            });
        };
        // Check param type.
        let height = single_binding(height, fn_name, "numeric height", 0)?;
        let sg = sg_binding(sketch_group, fn_name, "sketch group", 1)?;
        let cmd_id = Uuid::new_v4().into();
        instructions.extend([
            // Push the `cap` bool onto the stack.
            Instruction::from(InstructionKind::StackPush {
                data: vec![true.into()],
            }),
            // Push the path ID onto the stack.
            Instruction::from(InstructionKind::SketchGroupCopyFrom {
                destination: Destination::StackPush,
                length: 1,
                source: sg,
                offset: SketchGroup::path_id_offset(),
            }),
            // Call the 'extrude' API request.
            Instruction::from(InstructionKind::ApiRequest(ApiRequest {
                endpoint: ModelingCmdEndpoint::Extrude,
                store_response: None,
                arguments: vec![
                    // Target
                    InMemory::StackPop,
                    // Height
                    InMemory::Address(height),
                    // Cap
                    InMemory::StackPop,
                ],
                cmd_id,
            })),
        ]);

        // TODO: make an ExtrudeGroup and store it.
        Ok(EvalPlan {
            instructions,
            binding: EpBinding::Single(Address::ZERO + 999),
        })
    }
}

#[derive(Debug, Clone)]
#[cfg_attr(test, derive(Eq, PartialEq))]
pub struct LineTo;

impl Callable for LineTo {
    fn call(
        &self,
        ctx: &mut crate::native_functions::Context<'_>,
        args: Vec<EpBinding>,
    ) -> Result<EvalPlan, CompileError> {
        LineBare::call(ctx, "lineTo", args, LineBareOptions { at: At::AbsoluteXY })
    }
}

#[derive(Debug, Clone)]
#[cfg_attr(test, derive(Eq, PartialEq))]
pub struct Line;

impl Callable for Line {
    fn call(
        &self,
        ctx: &mut crate::native_functions::Context<'_>,
        args: Vec<EpBinding>,
    ) -> Result<EvalPlan, CompileError> {
        LineBare::call(ctx, "line", args, LineBareOptions { at: At::RelativeXY })
    }
}

#[derive(Debug, Clone)]
#[cfg_attr(test, derive(Eq, PartialEq))]
pub struct XLineTo;

impl Callable for XLineTo {
    fn call(
        &self,
        ctx: &mut crate::native_functions::Context<'_>,
        args: Vec<EpBinding>,
    ) -> Result<EvalPlan, CompileError> {
        LineBare::call(ctx, "xLineTo", args, LineBareOptions { at: At::AbsoluteX })
    }
}

#[derive(Debug, Clone)]
#[cfg_attr(test, derive(Eq, PartialEq))]
pub struct XLine;

impl Callable for XLine {
    fn call(
        &self,
        ctx: &mut crate::native_functions::Context<'_>,
        args: Vec<EpBinding>,
    ) -> Result<EvalPlan, CompileError> {
        LineBare::call(ctx, "xLine", args, LineBareOptions { at: At::RelativeX })
    }
}

#[derive(Debug, Clone)]
#[cfg_attr(test, derive(Eq, PartialEq))]
pub struct YLineTo;

impl Callable for YLineTo {
    fn call(
        &self,
        ctx: &mut crate::native_functions::Context<'_>,
        args: Vec<EpBinding>,
    ) -> Result<EvalPlan, CompileError> {
        LineBare::call(ctx, "yLineTo", args, LineBareOptions { at: At::AbsoluteY })
    }
}

#[derive(Debug, Clone)]
#[cfg_attr(test, derive(Eq, PartialEq))]
pub struct YLine;

impl Callable for YLine {
    fn call(
        &self,
        ctx: &mut crate::native_functions::Context<'_>,
        args: Vec<EpBinding>,
    ) -> Result<EvalPlan, CompileError> {
        LineBare::call(ctx, "yLine", args, LineBareOptions { at: At::RelativeY })
    }
}

#[derive(Debug, Clone)]
#[cfg_attr(test, derive(Eq, PartialEq))]
/// Exposes all the possible arguments the `line` modeling command can take.
/// Reduces code for the other line functions needed.
/// We do not expose this to the developer since it does not align with
/// the documentation (there is no "lineBare").
pub struct LineBare;

/// Used to configure the call to handle different line variants.
pub struct LineBareOptions {
    /// Where to start coordinates at, ex: At::RelativeXY.
    at: At,
}

impl LineBare {
    fn call(
        ctx: &mut crate::native_functions::Context<'_>,
        fn_name: &'static str,
        args: Vec<EpBinding>,
        opts: LineBareOptions,
    ) -> Result<EvalPlan, CompileError> {
        let mut instructions = Vec::new();

        let required = 2;

        let mut args_iter = args.into_iter();

        let Some(to) = args_iter.next() else {
            return Err(CompileError::NotEnoughArgs {
                fn_name: fn_name.into(),
                required,
                actual: args_iter.count(),
            });
        };

        let Some(sketch_group) = args_iter.next() else {
            return Err(CompileError::NotEnoughArgs {
                fn_name: fn_name.into(),
                required,
                actual: args_iter.count(),
            });
        };

        let tag = match args_iter.next() {
            Some(a) => a,
            None => {
                // Write an empty string and use that.
                let empty_string_addr = ctx.next_address.offset_by(1);
                instructions.push(Instruction::from(InstructionKind::SetPrimitive {
                    address: empty_string_addr,
                    value: String::new().into(),
                }));
                EpBinding::Single(empty_string_addr)
            }
        };

        // Check the type of required params.
        // We don't check `to` here because it can take on either a
        // EpBinding::Sequence or EpBinding::Single.

        let sg = sg_binding(sketch_group, fn_name, "sketch group", 1)?;
        let tag = single_binding(tag, fn_name, "string tag", 2)?;
        let id = Uuid::new_v4();

        // Start of the path segment (which is a straight line).
        let length_of_3d_point = Point3d::<f64>::default().into_parts().len();
        let start_of_line = ctx.next_address.offset_by(1);

        // Reserve space for the line's end, and the `relative: bool` field.
        ctx.next_address.offset_by(length_of_3d_point + 1);
        let new_sg_index = ctx.assign_sketch_group();

        // Copy based on the options.
        match opts {
            LineBareOptions { at: At::AbsoluteXY, .. } | LineBareOptions { at: At::RelativeXY, .. } => {
                // Push the `to` 2D point onto the stack.
                let EpBinding::Sequence { elements, length_at: _ } = to.clone() else {
                    return Err(CompileError::InvalidOperand("Must pass a list of length 2"));
                };
                let &[EpBinding::Single(el0), EpBinding::Single(el1)] = elements.as_slice() else {
                    return Err(CompileError::InvalidOperand("Must pass a sequence here."));
                };
                instructions.extend([
                    // X
                    Instruction::from(InstructionKind::Copy {
                        source: el0,
                        length: 1,
                        destination: Destination::StackPush,
                    }),
                    // Y
                    Instruction::from(InstructionKind::Copy {
                        source: el1,
                        length: 1,
                        destination: Destination::StackExtend,
                    }),
                    // Z
                    Instruction::from(InstructionKind::StackExtend { data: vec![0.0.into()] }),
                ]);
            }
            LineBareOptions { at: At::AbsoluteX, .. } | LineBareOptions { at: At::RelativeX, .. } => {
                let EpBinding::Single(addr) = to else {
                    return Err(CompileError::InvalidOperand("Must pass a single value here."));
                };
                instructions.extend([
                    Instruction::from(InstructionKind::Copy {
                        // X
                        source: addr,
                        length: 1,
                        destination: Destination::StackPush,
                    }),
                    Instruction::from(InstructionKind::StackExtend {
                        data: vec![Primitive::from(0.0)],
                    }), // Y
                    Instruction::from(InstructionKind::StackExtend {
                        data: vec![Primitive::from(0.0)],
                    }), // Z
                ]);
            }
            LineBareOptions { at: At::AbsoluteY, .. } | LineBareOptions { at: At::RelativeY, .. } => {
                let EpBinding::Single(addr) = to else {
                    return Err(CompileError::InvalidOperand("Must pass a single value here."));
                };
                instructions.extend([
                    // X
                    Instruction::from(InstructionKind::StackPush {
                        data: vec![Primitive::from(0.0)],
                    }),
                    // Y
                    Instruction::from(InstructionKind::Copy {
                        source: addr,
                        length: 1,
                        destination: Destination::StackExtend,
                    }),
                    // Z
                    Instruction::from(InstructionKind::StackExtend {
                        data: vec![Primitive::from(0.0)],
                    }),
                ]);
            }
        }

        instructions.extend([
            // Append the new path segment to memory.
            // First comes its tag.
            Instruction::from(InstructionKind::SetPrimitive {
                address: start_of_line,
                value: "Line".to_owned().into(),
            }),
            // Then its end
            Instruction::from(InstructionKind::StackPop {
                destination: Some(Destination::Address(start_of_line + 1)),
            }),
            // Then its `relative` field.
            Instruction::from(InstructionKind::SetPrimitive {
                address: start_of_line + 1 + length_of_3d_point,
                value: opts.at.is_relative().into(),
            }),
            // Push the path ID onto the stack.
            Instruction::from(InstructionKind::SketchGroupCopyFrom {
                destination: Destination::StackPush,
                length: 1,
                source: sg,
                offset: SketchGroup::path_id_offset(),
            }),
            // Send the ExtendPath request
            Instruction::from(InstructionKind::ApiRequest(ApiRequest {
                endpoint: ModelingCmdEndpoint::ExtendPath,
                store_response: None,
                arguments: vec![
                    // Path ID
                    InMemory::StackPop,
                    // Segment
                    InMemory::Address(start_of_line),
                ],
                cmd_id: id.into(),
            })),
            // Push the new segment in SketchGroup format.
            //      Path tag.
            Instruction::from(InstructionKind::StackPush {
                data: vec![Primitive::from("ToPoint".to_owned())],
            }),
            //      `BasePath::from` point.
            // Place them in the secondary stack to prepare ToPoint structure.
            Instruction::from(InstructionKind::SketchGroupGetLastPoint {
                source: sg,
                destination: Destination::StackExtend,
            }),
        ]);

        // Reserve space for the segment last point
        let to_point_from = ctx.next_address.offset_by(2);

        instructions.extend([
            // Copy to the primary stack as well to be worked with.
            Instruction::from(InstructionKind::SketchGroupGetLastPoint {
                source: sg,
                destination: Destination::Address(to_point_from),
            }),
        ]);

        //      `BasePath::to` point.

        // The copy here depends on the incoming `to` data.
        // Sometimes it's a list, sometimes it's single datum.
        // And the relative/not relative matters. When relative, we need to
        // copy coords from `from` into the new `to` coord that don't change.
        // At least everything else can be built up from these "primitives".
        if let EpBinding::Sequence { elements, length_at: _ } = to.clone() {
            if let &[EpBinding::Single(el0), EpBinding::Single(el1)] = elements.as_slice() {
                match opts {
                    // ToPoint { from: { x1, y1 }, to: { x1 + x2, y1 + y2 } }
                    LineBareOptions { at: At::RelativeXY, .. } => {
                        instructions.extend([
                            Instruction::from(InstructionKind::BinaryArithmetic {
                                arithmetic: BinaryArithmetic {
                                    operation: BinaryOperation::Add,
                                    operand0: Operand::Reference(to_point_from + 0),
                                    operand1: Operand::Reference(el0),
                                },
                                destination: Destination::StackExtend,
                            }),
                            Instruction::from(InstructionKind::BinaryArithmetic {
                                arithmetic: BinaryArithmetic {
                                    operation: BinaryOperation::Add,
                                    operand0: Operand::Reference(to_point_from + 1),
                                    operand1: Operand::Reference(el1),
                                },
                                destination: Destination::StackExtend,
                            }),
                        ]);
                    }
                    // ToPoint { from: { x1, y1 }, to: { x2, y2 } }
                    LineBareOptions { at: At::AbsoluteXY, .. } => {
                        // Otherwise just directly copy the new points.
                        instructions.extend([
                            Instruction::from(InstructionKind::Copy {
                                source: el0,
                                length: 1,
                                destination: Destination::StackExtend,
                            }),
                            Instruction::from(InstructionKind::Copy {
                                source: el1,
                                length: 1,
                                destination: Destination::StackExtend,
                            }),
                        ]);
                    }
                    _ => {
                        return Err(CompileError::InvalidOperand(
                            "A Sequence with At::...X or At::...Y is not valid here. Must be At::...XY.",
                        ));
                    }
                }
            }
        } else if let EpBinding::Single(addr) = to {
            match opts {
                // ToPoint { from: { x1, y1 }, to: { x1 + x2, y1 } }
                LineBareOptions { at: At::RelativeX } => {
                    instructions.extend([
                        Instruction::from(InstructionKind::BinaryArithmetic {
                            arithmetic: BinaryArithmetic {
                                operation: BinaryOperation::Add,
                                operand0: Operand::Reference(to_point_from + 0),
                                operand1: Operand::Reference(addr),
                            },
                            destination: Destination::StackExtend,
                        }),
                        Instruction::from(InstructionKind::Copy {
                            source: to_point_from + 1,
                            length: 1,
                            destination: Destination::StackExtend,
                        }),
                    ]);
                }
                // ToPoint { from: { x1, y1 }, to: { x2, y1 } }
                LineBareOptions { at: At::AbsoluteX } => {
                    instructions.extend([
                        Instruction::from(InstructionKind::Copy {
                            source: addr,
                            length: 1,
                            destination: Destination::StackExtend,
                        }),
                        Instruction::from(InstructionKind::Copy {
                            source: to_point_from + 1,
                            length: 1,
                            destination: Destination::StackExtend,
                        }),
                    ]);
                }
                // ToPoint { from: { x1, y1 }, to: { x1, y1 + y2 } }
                LineBareOptions { at: At::RelativeY } => {
                    instructions.extend([
                        Instruction::from(InstructionKind::Copy {
                            source: to_point_from + 0,
                            length: 1,
                            destination: Destination::StackExtend,
                        }),
                        Instruction::from(InstructionKind::BinaryArithmetic {
                            arithmetic: BinaryArithmetic {
                                operation: BinaryOperation::Add,
                                operand0: Operand::Reference(to_point_from + 1),
                                operand1: Operand::Reference(addr),
                            },
                            destination: Destination::StackExtend,
                        }),
                    ]);
                }
                // ToPoint { from: { x1, y1 }, to: { x1, y2 } }
                LineBareOptions { at: At::AbsoluteY } => {
                    instructions.extend([
                        Instruction::from(InstructionKind::Copy {
                            source: to_point_from + 0,
                            length: 1,
                            destination: Destination::StackExtend,
                        }),
                        Instruction::from(InstructionKind::Copy {
                            source: addr,
                            length: 1,
                            destination: Destination::StackExtend,
                        }),
                    ]);
                }
                _ => {
                    return Err(CompileError::InvalidOperand(
                        "A Single binding with At::...XY is not valid here.",
                    ));
                }
            }
        } else {
            return Err(CompileError::InvalidOperand(
                "Must be a sequence or single value binding.",
            ));
        }

        instructions.extend([
            //      `BasePath::name` string.
            Instruction::from(InstructionKind::Copy {
                source: tag,
                length: 1,
                destination: Destination::StackExtend,
            }),
            // Update the SketchGroup with its new segment.
            Instruction::from(InstructionKind::SketchGroupAddSegment {
                destination: new_sg_index,
                segment: InMemory::StackPop,
                source: sg,
            }),
        ]);

        Ok(EvalPlan {
            instructions,
            binding: EpBinding::SketchGroup { index: new_sg_index },
        })
    }
}

#[derive(Debug, Clone)]
#[cfg_attr(test, derive(Eq, PartialEq))]
pub struct StartSketchAt;

impl Callable for StartSketchAt {
    fn call(
        &self,
        ctx: &mut crate::native_functions::Context<'_>,
        args: Vec<EpBinding>,
    ) -> Result<EvalPlan, CompileError> {
        let mut instructions = Vec::new();
        // First, before we send any API calls, let's validate the arguments to this function.
        let mut args_iter = args.into_iter();
        let Some(start) = args_iter.next() else {
            return Err(CompileError::NotEnoughArgs {
                fn_name: "startSketchAt".into(),
                required: 1,
                actual: 0,
            });
        };
        let start_point = arg_point2d(start, "startSketchAt", &mut instructions, ctx, 0)?;
        let tag = match args_iter.next() {
            None => None,
            Some(b) => Some(single_binding(b, "startSketchAt", "a single string", 1)?),
        };

        // Define some constants:
        let axes = Axes {
            x: Point3d { x: 1.0, y: 0.0, z: 0.0 },
            y: Point3d { x: 0.0, y: 1.0, z: 0.0 },
            z: Point3d { x: 0.0, y: 0.0, z: 1.0 },
        };
        let origin = Point3d::default();

        // Now the function can start.
        // First API call: make the plane.
        let plane_id = Uuid::new_v4();
        stack_api_call(
            &mut instructions,
            ModelingCmdEndpoint::MakePlane,
            None,
            plane_id.into(),
            [
                Some(true).into_parts(), // hide
                vec![false.into()],      // clobber
                vec![60.0.into()],       // size
                axes.y.into_parts(),
                axes.x.into_parts(),
                origin.into_parts(),
            ],
        );

        // Next, enter sketch mode.
        stack_api_call(
            &mut instructions,
            ModelingCmdEndpoint::EnableSketchMode,
            None,
            Uuid::new_v4().into(),
            [
                Some(axes.z).into_parts(),
                vec![false.into()],    // adjust camera
                vec![false.into()],    // animated
                vec![false.into()],    // ortho mode
                vec![plane_id.into()], // entity id (plane in this case)
            ],
        );

        // Then start a path
        let path_id = Uuid::new_v4();
        no_arg_api_call(&mut instructions, ModelingCmdEndpoint::StartPath, path_id.into());

        // Move the path pen to the given point.
        instructions.push(Instruction::from(InstructionKind::StackPush {
            data: vec![path_id.into()],
        }));
        instructions.push(Instruction::from(InstructionKind::ApiRequest(ApiRequest {
            endpoint: ModelingCmdEndpoint::MovePathPen,
            store_response: None,
            arguments: vec![InMemory::StackPop, InMemory::Address(start_point)],
            cmd_id: Uuid::new_v4().into(),
        })));

        // Starting a sketch creates a sketch group.
        // Updating the sketch will update this sketch group later.
        let sketch_group = SketchGroup {
            id: path_id,
            position: origin,
            rotation: Point4d {
                x: 0.0,
                y: 0.0,
                z: 0.0,
                w: 1.0,
            },
            // Below: Must copy the existing data (from the arguments to this KCL function)
            // over these values after writing to memory.
            path_first: BasePath {
                from: Default::default(),
                to: Default::default(),
                name: Default::default(),
            },
            path_rest: Vec::new(),
            on: sketch_types::SketchSurface::Plane(Plane {
                id: plane_id,
                value: sketch_types::PlaneType::XY,
                origin,
                axes,
            }),
            axes,
            entity_id: Some(plane_id),
        };
        let sketch_group_index = ctx.assign_sketch_group();
        instructions.extend([
            Instruction::from(InstructionKind::SketchGroupSet {
                sketch_group,
                destination: sketch_group_index,
            }),
            // As mentioned above: Copy the existing data over the `path_first`.
            Instruction::from(InstructionKind::SketchGroupSetBasePath {
                source: sketch_group_index,
                from: InMemory::Address(start_point),
                to: InMemory::Address(start_point),
                name: tag.map(InMemory::Address),
            }),
        ]);

        Ok(EvalPlan {
            instructions,
            binding: EpBinding::SketchGroup {
                index: sketch_group_index,
            },
        })
    }
}

#[derive(Debug, Clone)]
#[cfg_attr(test, derive(Eq, PartialEq))]
pub struct TangentialArcTo;

impl Callable for TangentialArcTo {
    fn call(
        &self,
        ctx: &mut crate::native_functions::Context<'_>,
        args: Vec<EpBinding>,
    ) -> Result<EvalPlan, CompileError> {
        let mut instructions = Vec::new();
        let fn_name = "tangential_arc_to";
        // Get both required params.
        let mut args_iter = args.into_iter();
        let Some(to) = args_iter.next() else {
            return Err(CompileError::NotEnoughArgs {
                fn_name: fn_name.into(),
                required: 2,
                actual: 0,
            });
        };
        let Some(sketch_group) = args_iter.next() else {
            return Err(CompileError::NotEnoughArgs {
                fn_name: fn_name.into(),
                required: 2,
                actual: 1,
            });
        };
        let tag = match args_iter.next() {
            Some(a) => a,
            None => {
                // Write an empty string and use that.
                let empty_string_addr = ctx.next_address.offset_by(1);
                instructions.push(Instruction::from(InstructionKind::SetPrimitive {
                    address: empty_string_addr,
                    value: String::new().into(),
                }));
                EpBinding::Single(empty_string_addr)
            }
        };
        // Check the type of required params.
        let to = arg_point2d(to, fn_name, &mut instructions, ctx, 0)?;
        let sg = sg_binding(sketch_group, fn_name, "sketch group", 1)?;
        let tag = single_binding(tag, fn_name, "string tag", 2)?;
        let id = Uuid::new_v4();
        // Start of the path segment (which is a straight line).
        let length_of_3d_point = Point3d::<f64>::default().into_parts().len();
        let start_of_tangential_arc = ctx.next_address.offset_by(1);
        // Reserve space for the line's end, and the `relative: bool` field.
        ctx.next_address.offset_by(length_of_3d_point + 1);
        let new_sg_index = ctx.assign_sketch_group();
        instructions.extend([
            // Push the `to` 2D point onto the stack.
            Instruction::from(InstructionKind::Copy {
                source: to,
                length: 2,
                destination: Destination::StackPush,
            }),
            // Make it a 3D point.
            Instruction::from(InstructionKind::StackExtend { data: vec![0.0.into()] }),
            // Append the new path segment to memory.
            // First comes its tag.
            Instruction::from(InstructionKind::SetPrimitive {
                address: start_of_tangential_arc,
                value: "TangentialArcTo".to_owned().into(),
            }),
            // Then its to
            Instruction::from(InstructionKind::StackPop {
                destination: Some(Destination::Address(start_of_tangential_arc + 1)),
            }),
            // Then its `angle_snap_increment` field.
            Instruction::from(InstructionKind::SetPrimitive {
                address: start_of_tangential_arc + 1 + length_of_3d_point,
                value: Primitive::from("None".to_owned()),
            }),
            // Push the path ID onto the stack.
            Instruction::from(InstructionKind::SketchGroupCopyFrom {
                destination: Destination::StackPush,
                length: 1,
                source: sg,
                offset: SketchGroup::path_id_offset(),
            }),
            // Send the ExtendPath request
            Instruction::from(InstructionKind::ApiRequest(ApiRequest {
                endpoint: ModelingCmdEndpoint::ExtendPath,
                store_response: None,
                arguments: vec![
                    // Path ID
                    InMemory::StackPop,
                    // Segment
                    InMemory::Address(start_of_tangential_arc),
                ],
                cmd_id: id.into(),
            })),
            // Push the new segment in SketchGroup format.
            //      Path tag.
            Instruction::from(InstructionKind::StackPush {
                data: vec![Primitive::from("ToPoint".to_owned())],
            }),
            //      `BasePath::from` point.
            Instruction::from(InstructionKind::SketchGroupGetLastPoint {
                source: sg,
                destination: Destination::StackExtend,
            }),
            //      `BasePath::to` point.
            Instruction::from(InstructionKind::Copy {
                source: start_of_tangential_arc + 1,
                length: 2,
                destination: Destination::StackExtend,
            }),
            //      `BasePath::name` string.
            Instruction::from(InstructionKind::Copy {
                source: tag,
                length: 1,
                destination: Destination::StackExtend,
            }),
            // Update the SketchGroup with its new segment.
            Instruction::from(InstructionKind::SketchGroupAddSegment {
                destination: new_sg_index,
                segment: InMemory::StackPop,
                source: sg,
            }),
        ]);

        Ok(EvalPlan {
            instructions,
            binding: EpBinding::SketchGroup { index: new_sg_index },
        })
    }
}
