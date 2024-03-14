use kittycad_execution_plan::{
    api_request::ApiRequest,
    sketch_types::{self, Axes, BasePath, Plane, SketchGroup},
    Destination, Instruction,
};
use kittycad_execution_plan_traits::{Address, InMemory, Primitive, Value};
use kittycad_modeling_cmds::{
    shared::{Point3d, Point4d},
    ModelingCmdEndpoint,
};
use uuid::Uuid;

use super::helpers::{arg_point2d, no_arg_api_call, sg_binding, single_binding, stack_api_call};
use crate::{binding_scope::EpBinding, error::CompileError, native_functions::Callable, EvalPlan};

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
            Instruction::SketchGroupCopyFrom {
                destination: Destination::StackPush,
                length: 1,
                source: sg,
                offset: SketchGroup::path_id_offset(),
            },
            // Call the 'extrude' API request.
            Instruction::ApiRequest(ApiRequest {
                endpoint: ModelingCmdEndpoint::ClosePath,
                store_response: None,
                arguments: vec![
                    // Target (path ID)
                    InMemory::StackPop,
                ],
                cmd_id,
            }),
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
            Instruction::StackPush {
                data: vec![true.into()],
            },
            // Push the path ID onto the stack.
            Instruction::SketchGroupCopyFrom {
                destination: Destination::StackPush,
                length: 1,
                source: sg,
                offset: SketchGroup::path_id_offset(),
            },
            // Call the 'extrude' API request.
            Instruction::ApiRequest(ApiRequest {
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
            }),
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
        let mut instructions = Vec::new();
        let fn_name = "lineTo";
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
                instructions.push(Instruction::SetPrimitive {
                    address: empty_string_addr,
                    value: String::new().into(),
                });
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
        let start_of_line = ctx.next_address.offset_by(1);
        // Reserve space for the line's end, and the `relative: bool` field.
        ctx.next_address.offset_by(length_of_3d_point + 1);
        let new_sg_index = ctx.assign_sketch_group();
        instructions.extend([
            // Push the `to` 2D point onto the stack.
            Instruction::Copy {
                source: to,
                length: 2,
                destination: Destination::StackPush,
            },
            // Make it a 3D point.
            Instruction::StackExtend { data: vec![0.0.into()] },
            // Append the new path segment to memory.
            // First comes its tag.
            Instruction::SetPrimitive {
                address: start_of_line,
                value: "Line".to_owned().into(),
            },
            // Then its end
            Instruction::StackPop {
                destination: Some(Destination::Address(start_of_line + 1)),
            },
            // Then its `relative` field.
            Instruction::SetPrimitive {
                address: start_of_line + 1 + length_of_3d_point,
                value: false.into(),
            },
            // Push the path ID onto the stack.
            Instruction::SketchGroupCopyFrom {
                destination: Destination::StackPush,
                length: 1,
                source: sg,
                offset: SketchGroup::path_id_offset(),
            },
            // Send the ExtendPath request
            Instruction::ApiRequest(ApiRequest {
                endpoint: ModelingCmdEndpoint::ExtendPath,
                store_response: None,
                arguments: vec![
                    // Path ID
                    InMemory::StackPop,
                    // Segment
                    InMemory::Address(start_of_line),
                ],
                cmd_id: id.into(),
            }),
            // Push the new segment in SketchGroup format.
            //      Path tag.
            Instruction::StackPush {
                data: vec![Primitive::from("ToPoint".to_owned())],
            },
            //      `BasePath::from` point.
            Instruction::SketchGroupGetLastPoint {
                source: sg,
                destination: Destination::StackExtend,
            },
            //      `BasePath::to` point.
            Instruction::Copy {
                source: start_of_line + 1,
                length: 2,
                destination: Destination::StackExtend,
            },
            //      `BasePath::name` string.
            Instruction::Copy {
                source: tag,
                length: 1,
                destination: Destination::StackExtend,
            },
            // Update the SketchGroup with its new segment.
            Instruction::SketchGroupAddSegment {
                destination: new_sg_index,
                segment: InMemory::StackPop,
                source: sg,
            },
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
            ModelingCmdEndpoint::SketchModeEnable,
            None,
            Uuid::new_v4().into(),
            [
                Some(axes.z).into_parts(),
                vec![false.into()], // animated
                vec![false.into()], // ortho mode
                vec![plane_id.into()],
            ],
        );

        // Then start a path
        let path_id = Uuid::new_v4();
        no_arg_api_call(&mut instructions, ModelingCmdEndpoint::StartPath, path_id.into());

        // Move the path pen to the given point.
        instructions.push(Instruction::StackPush {
            data: vec![path_id.into()],
        });
        instructions.push(Instruction::ApiRequest(ApiRequest {
            endpoint: ModelingCmdEndpoint::MovePathPen,
            store_response: None,
            arguments: vec![InMemory::StackPop, InMemory::Address(start_point)],
            cmd_id: Uuid::new_v4().into(),
        }));

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
            Instruction::SketchGroupSet {
                sketch_group,
                destination: sketch_group_index,
            },
            // As mentioned above: Copy the existing data over the `path_first`.
            Instruction::SketchGroupSetBasePath {
                source: sketch_group_index,
                from: InMemory::Address(start_point),
                to: InMemory::Address(start_point),
                name: tag.map(InMemory::Address),
            },
        ]);

        Ok(EvalPlan {
            instructions,
            binding: EpBinding::SketchGroup {
                index: sketch_group_index,
            },
        })
    }
}
