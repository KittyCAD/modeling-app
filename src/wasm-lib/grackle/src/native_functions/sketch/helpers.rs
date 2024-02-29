use kittycad_execution_plan::{api_request::ApiRequest, Instruction};
use kittycad_execution_plan_traits::{Address, InMemory};
use kittycad_modeling_cmds::{id::ModelingCmdId, ModelingCmdEndpoint};

use crate::{binding_scope::EpBinding, error::CompileError};

/// Emit instructions for an API call with no parameters.
pub fn no_arg_api_call(instrs: &mut Vec<Instruction>, endpoint: ModelingCmdEndpoint, cmd_id: ModelingCmdId) {
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
pub fn stack_api_call<const N: usize>(
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

pub fn single_binding(b: EpBinding, fn_name: &'static str, expected: &'static str) -> Result<Address, CompileError> {
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
            actual: "object".to_owned(),
        }),
        EpBinding::Function(_) => Err(CompileError::ArgWrongType {
            fn_name,
            expected,
            actual: "function".to_owned(),
        }),
    }
}

pub fn sequence_binding(
    b: EpBinding,
    fn_name: &'static str,
    expected: &'static str,
) -> Result<Vec<EpBinding>, CompileError> {
    match b {
        EpBinding::Sequence { elements, .. } => Ok(elements),
        EpBinding::Single(_) => Err(CompileError::ArgWrongType {
            fn_name,
            expected,
            actual: "single".to_owned(),
        }),
        EpBinding::Map { .. } => Err(CompileError::ArgWrongType {
            fn_name,
            expected,
            actual: "object".to_owned(),
        }),
        EpBinding::Function(_) => Err(CompileError::ArgWrongType {
            fn_name,
            expected,
            actual: "function".to_owned(),
        }),
    }
}
