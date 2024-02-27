//! Native functions for sketching on the plane.

use kittycad_execution_plan::{api_request::ApiRequest, Instruction};
use kittycad_execution_plan_traits::{Address, InMemory, Value};
use kittycad_modeling_cmds::{id::ModelingCmdId, shared::Point3d, ModelingCmdEndpoint};
use uuid::Uuid;

use crate::{binding_scope::EpBinding, error::CompileError, EvalPlan};

use super::Callable;

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
        let start_point = {
            let expected = "2D point (array with length 2)";
            let fn_name = "startSketchAt";
            match start {
                EpBinding::Single(_) => {
                    return Err(CompileError::ArgWrongType {
                        fn_name,
                        expected,
                        actual: "a single value".to_owned(),
                    })
                }
                EpBinding::Sequence { elements, .. } if elements.len() == 2 => {
                    // KCL stores points as an array.
                    // KC API stores them as Rust objects laid flat out in memory.
                    let start = next_addr.offset_by(2);
                    let start_x = start;
                    let start_y = start + 1;
                    let start_z = start + 2;
                    instructions.extend([
                        Instruction::Copy {
                            source: single_binding(
                                elements[0].clone(),
                                "startSketchAt (first parameter, elem 0)",
                                "number",
                            )?,
                            destination: start_x,
                        },
                        Instruction::Copy {
                            source: single_binding(
                                elements[1].clone(),
                                "startSketchAt (first parameter, elem 1)",
                                "number",
                            )?,
                            destination: start_y,
                        },
                        Instruction::SetPrimitive {
                            address: start_z,
                            value: 0.0.into(),
                        },
                    ]);
                    start
                }
                EpBinding::Sequence { elements, .. } => {
                    return Err(CompileError::ArgWrongType {
                        fn_name,
                        expected,
                        actual: format!("array of length {}", elements.len()),
                    })
                }
                EpBinding::Map { .. } => {
                    return Err(CompileError::ArgWrongType {
                        fn_name,
                        expected,
                        actual: "object".to_owned(),
                    })
                }
                EpBinding::Function(_) => {
                    return Err(CompileError::ArgWrongType {
                        fn_name,
                        expected,
                        actual: "function".to_owned(),
                    })
                }
            }
        };

        // Now the function can start.

        // First API call: make the plane.
        let plane_id = Uuid::new_v4();
        stack_api_call(
            &mut instructions,
            ModelingCmdEndpoint::MakePlane,
            None,
            plane_id.into(),
            [
                Some(true).into_parts(),                         // hide
                vec![false.into()],                              // clobber
                vec![60.0.into()],                               // size
                Point3d { x: 0.0, y: 1.0, z: 0.0 }.into_parts(), // Y axis
                Point3d { x: 1.0, y: 0.0, z: 0.0 }.into_parts(), // X axis
                Point3d { x: 0.0, y: 0.0, z: 0.0 }.into_parts(), // origin of plane
            ],
        );

        // Next, enter sketch mode.
        stack_api_call(
            &mut instructions,
            ModelingCmdEndpoint::SketchModeEnable,
            None,
            Uuid::new_v4().into(),
            [
                Some(Point3d { x: 0.0, y: 0.0, z: 1.0 }).into_parts(), // Z axis
                vec![false.into()],                                    // animated
                vec![false.into()],                                    // ortho mode
                vec![plane_id.into()],                                 // plane ID
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

        // TODO: Store the SketchGroup in KCEP memory.
        let sketch_group = EpBinding::Single(Address::ZERO + 999);

        Ok(EvalPlan {
            instructions,
            binding: sketch_group,
        })
    }
}

/// Emit instructions for an API call with no parameters.
fn no_arg_api_call(instrs: &mut Vec<Instruction>, endpoint: ModelingCmdEndpoint, cmd_id: ModelingCmdId) {
    instrs.push(Instruction::ApiRequest(ApiRequest {
        endpoint,
        store_response: None,
        arguments: vec![],
        cmd_id,
    }))
}

/// Emit instructions for an API call with the given parameters.
/// The API parameters are stored in the EP memory stack.
/// So, they have to be pushed onto the stack in the right order,
/// i.e. the reverse order in which the API call's Rust struct defines the fields.
fn stack_api_call<const N: usize>(
    instrs: &mut Vec<Instruction>,
    endpoint: ModelingCmdEndpoint,
    store_response: Option<Address>,
    cmd_id: ModelingCmdId,
    data: [Vec<kittycad_execution_plan_traits::Primitive>; N],
) {
    let arguments = vec![InMemory::StackPop; data.len()];
    instrs.extend(data.map(|data| Instruction::StackPush { data }));
    instrs.push(Instruction::ApiRequest(ApiRequest {
        endpoint,
        store_response,
        arguments,
        cmd_id,
    }))
}

fn single_binding(b: EpBinding, fn_name: &'static str, expected: &'static str) -> Result<Address, CompileError> {
    match b {
        EpBinding::Single(a) => Ok(a),
        EpBinding::Sequence { .. } => Err(CompileError::ArgWrongType {
            fn_name,
            expected,
            actual: "array".to_owned(),
        }),
        EpBinding::Map { .. } => Err(CompileError::ArgWrongType {
            fn_name,
            expected,
            actual: "array".to_owned(),
        }),
        EpBinding::Function(_) => Err(CompileError::ArgWrongType {
            fn_name,
            expected,
            actual: "function".to_owned(),
        }),
    }
}
