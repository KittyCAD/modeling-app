use kittycad_execution_plan::{api_request::ApiRequest, Destination, Instruction};
use kittycad_execution_plan_traits::{Address, InMemory, Value};
use kittycad_modeling_cmds::{
    shared::{Point3d, Point4d},
    ModelingCmdEndpoint,
};
use uuid::Uuid;

use super::{
    helpers::{arg_point2d, no_arg_api_call, single_binding, stack_api_call},
    types::{Axes, BasePath, Plane, SketchGroup},
};
use crate::{binding_scope::EpBinding, error::CompileError, native_functions::Callable, EvalPlan};

#[derive(Debug, Clone)]
#[cfg_attr(test, derive(Eq, PartialEq))]
pub struct LineTo;

impl Callable for LineTo {
    fn call(&self, next_addr: &mut Address, args: Vec<EpBinding>) -> Result<EvalPlan, CompileError> {
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
        // Check the type of both required params.
        let to = arg_point2d(to, fn_name, &mut instructions, next_addr, 0)?;
        let sg = single_binding(sketch_group, fn_name, "sketch group", 1)?;
        let id = Uuid::new_v4();
        let start_of_line = next_addr.offset(1);
        let length_of_3d_point = Point3d::<f64>::default().into_parts().len();
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
                destination: Some(start_of_line + 1),
            },
            // Then its `relative` field.
            Instruction::SetPrimitive {
                address: start_of_line + 1 + length_of_3d_point,
                value: false.into(),
            },
            // Send the ExtendPath request
            Instruction::ApiRequest(ApiRequest {
                endpoint: ModelingCmdEndpoint::ExtendPath,
                store_response: None,
                arguments: vec![
                    // Path ID
                    InMemory::Address(sg + SketchGroup::path_id_offset()),
                    // Segment
                    InMemory::Address(start_of_line),
                ],
                cmd_id: id.into(),
            }),
        ]);

        // TODO: Create a new SketchGroup from the old one + add the new path, then store it.
        Ok(EvalPlan {
            instructions,
            binding: EpBinding::Single(Address::ZERO + 9999),
        })
    }
}

#[derive(Debug, Clone)]
#[cfg_attr(test, derive(Eq, PartialEq))]
pub struct StartSketchAt;

impl Callable for StartSketchAt {
    fn call(&self, next_addr: &mut Address, args: Vec<EpBinding>) -> Result<EvalPlan, CompileError> {
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
        let start_point = arg_point2d(start, "startSketchAt", &mut instructions, next_addr, 0)?;
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
            // TODO: Must copy the existing data (from the arguments to this KCL function)
            // over these values after writing to memory.
            path_first: BasePath {
                from: Default::default(),
                to: Default::default(),
                name: Default::default(),
            },
            path_rest: Vec::new(),
            on: super::types::SketchSurface::Plane(Plane {
                id: plane_id,
                value: super::types::PlaneType::XY,
                origin,
                axes,
            }),
            axes,
            entity_id: Some(plane_id),
        };
        let sketch_group_primitives = sketch_group.clone().into_parts();

        let sketch_group_addr = next_addr.offset_by(sketch_group_primitives.len());
        instructions.push(Instruction::SetValue {
            address: sketch_group_addr,
            value_parts: sketch_group_primitives,
        });
        instructions.extend(sketch_group.set_base_path(sketch_group_addr, start_point, tag));

        Ok(EvalPlan {
            instructions,
            binding: EpBinding::Single(sketch_group_addr),
        })
    }
}
