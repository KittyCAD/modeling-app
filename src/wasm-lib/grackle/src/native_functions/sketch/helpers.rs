use kittycad_execution_plan::{api_request::ApiRequest, Destination, Instruction, InstructionKind};
use kittycad_execution_plan_traits::{Address, InMemory};
use kittycad_modeling_cmds::{id::ModelingCmdId, ModelingCmdEndpoint};

use crate::{binding_scope::EpBinding, error::CompileError};

/// Emit instructions for an API call with no parameters.
pub fn no_arg_api_call(instrs: &mut Vec<Instruction>, endpoint: ModelingCmdEndpoint, cmd_id: ModelingCmdId) {
    instrs.push(Instruction::from(InstructionKind::ApiRequest(ApiRequest {
        endpoint,
        store_response: None,
        arguments: vec![],
        cmd_id,
    })))
}

/// Emit instructions for an API call with the given parameters.
/// The API parameters are stored in the EP memory stack.
/// So, they have to be pushed onto the stack in the right order,
/// i.e. the reverse order in which the API call's Rust struct defines the fields.
pub fn stack_api_call<const N: usize>(
    instrs: &mut Vec<Instruction>,
    endpoint: ModelingCmdEndpoint,
    store_response: Option<Address>,
    cmd_id: ModelingCmdId,
    data: [Vec<kittycad_execution_plan_traits::Primitive>; N],
) {
    let arguments = vec![InMemory::StackPop; data.len()];
    instrs.extend(data.map(|data| Instruction::from(InstructionKind::StackPush { data })));
    instrs.push(Instruction::from(InstructionKind::ApiRequest(ApiRequest {
        endpoint,
        store_response,
        arguments,
        cmd_id,
    })))
}

pub fn sg_binding(
    b: EpBinding,
    fn_name: &'static str,
    expected: &'static str,
    arg_number: usize,
) -> Result<usize, CompileError> {
    match b {
        EpBinding::SketchGroup { index } => Ok(index),
        EpBinding::Single(_) => Err(CompileError::ArgWrongType {
            fn_name,
            expected,
            actual: "single".to_owned(),
            arg_number,
        }),
        EpBinding::Sequence { .. } => Err(CompileError::ArgWrongType {
            fn_name,
            expected,
            actual: "array".to_owned(),
            arg_number,
        }),
        EpBinding::Map { .. } => Err(CompileError::ArgWrongType {
            fn_name,
            expected,
            actual: "object".to_owned(),
            arg_number,
        }),
        EpBinding::Function(_) => Err(CompileError::ArgWrongType {
            fn_name,
            expected,
            actual: "function".to_owned(),
            arg_number,
        }),
        EpBinding::Constant(_) => Err(CompileError::ArgWrongType {
            fn_name,
            expected,
            actual: "constant".to_owned(),
            arg_number,
        }),
    }
}
pub fn single_binding(
    b: EpBinding,
    fn_name: &'static str,
    expected: &'static str,
    arg_number: usize,
) -> Result<Address, CompileError> {
    match b {
        EpBinding::Single(a) => Ok(a),
        EpBinding::SketchGroup { .. } => Err(CompileError::ArgWrongType {
            fn_name,
            expected,
            actual: "SketchGroup".to_owned(),
            arg_number,
        }),
        EpBinding::Sequence { .. } => Err(CompileError::ArgWrongType {
            fn_name,
            expected,
            actual: "array".to_owned(),
            arg_number,
        }),
        EpBinding::Map { .. } => Err(CompileError::ArgWrongType {
            fn_name,
            expected,
            actual: "object".to_owned(),
            arg_number,
        }),
        EpBinding::Function(_) => Err(CompileError::ArgWrongType {
            fn_name,
            expected,
            actual: "function".to_owned(),
            arg_number,
        }),
        EpBinding::Constant(_) => Err(CompileError::ArgWrongType {
            fn_name,
            expected,
            actual: "constant".to_owned(),
            arg_number,
        }),
    }
}

pub fn sequence_binding(
    b: EpBinding,
    fn_name: &'static str,
    expected: &'static str,
    arg_number: usize,
) -> Result<Vec<EpBinding>, CompileError> {
    match b {
        EpBinding::Sequence { elements, .. } => Ok(elements),
        EpBinding::Single(_) => Err(CompileError::ArgWrongType {
            fn_name,
            expected,
            actual: "single".to_owned(),
            arg_number,
        }),
        EpBinding::SketchGroup { .. } => Err(CompileError::ArgWrongType {
            fn_name,
            expected,
            actual: "SketchGroup".to_owned(),
            arg_number,
        }),
        EpBinding::Map { .. } => Err(CompileError::ArgWrongType {
            fn_name,
            expected,
            actual: "object".to_owned(),
            arg_number,
        }),
        EpBinding::Function(_) => Err(CompileError::ArgWrongType {
            fn_name,
            expected,
            actual: "function".to_owned(),
            arg_number,
        }),
        EpBinding::Constant(_) => Err(CompileError::ArgWrongType {
            fn_name,
            expected,
            actual: "constant".to_owned(),
            arg_number,
        }),
    }
}

/// Extract a 2D point from an argument to a KCL Function.
pub fn arg_point2d(
    arg: EpBinding,
    fn_name: &'static str,
    instructions: &mut Vec<Instruction>,
    ctx: &mut crate::native_functions::Context<'_>,
    arg_number: usize,
) -> Result<Address, CompileError> {
    let expected = "2D point (array with length 2)";
    let elements = sequence_binding(arg, fn_name, "an array of length 2", arg_number)?;
    if elements.len() != 2 {
        return Err(CompileError::ArgWrongType {
            fn_name,
            expected,
            actual: format!("array of length {}", elements.len()),
            arg_number: 0,
        });
    }
    // KCL stores points as an array.
    // KC API stores them as Rust objects laid flat out in memory.
    let start = ctx.next_address.offset_by(2);
    let start_x = start;
    let start_y = start + 1;
    let start_z = start + 2;
    instructions.extend([
        Instruction::from(InstructionKind::Copy {
            source: single_binding(elements[0].clone(), fn_name, "number", arg_number)?,
            destination: Destination::Address(start_x),
            length: 1,
        }),
        Instruction::from(InstructionKind::Copy {
            source: single_binding(elements[1].clone(), fn_name, "number", arg_number)?,
            destination: Destination::Address(start_y),
            length: 1,
        }),
        Instruction::from(InstructionKind::SetPrimitive {
            address: start_z,
            value: 0.0.into(),
        }),
    ]);
    ctx.next_address.offset_by(1); // After we pushed 0.0 here, just above.
    Ok(start)
}
