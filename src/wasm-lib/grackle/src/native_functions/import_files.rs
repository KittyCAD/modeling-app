//! Standard library functions involved in importing files.

use kittycad_execution_plan::{api_request::ApiRequest, import_files, Instruction};
use kittycad_execution_plan_traits::{Address, InMemory, MemoryArea, Primitive};
use kittycad_modeling_cmds::ModelingCmdEndpoint;
use uuid::Uuid;

use crate::{binding_scope::EpBinding, error::CompileError, EvalPlan};

use super::Callable;

#[derive(Debug, Clone)]
#[cfg_attr(test, derive(Eq, PartialEq))]
pub struct ImportFiles;

/// Import a CAD file.
/// For formats lacking unit data (STL, OBJ, PLY), the default import unit is millimeters.
/// Otherwise you can specify the unit by passing in the options parameter.
/// If you import a gltf file, we will try to find the bin file and import it as well.
impl Callable for ImportFiles {
    fn call(&self, addr_retval: &mut Address, args: Vec<EpBinding>) -> Result<EvalPlan, CompileError> {
        let mut instructions: Vec<Instruction> = vec![];

        let fn_name = "import";
        let required_args = 1;

        let args_len = args.len();
        let mut args_iter = args.into_iter();

        let EpBinding::Single(file_path) = args_iter.next().ok_or_else(|| CompileError::NotEnoughArgs {
            fn_name: fn_name.into(),
            required: required_args,
            actual: args_len,
        })?
        else {
            panic!("file path must be a single value.")
        };

        let file_format = if let Some(EpBinding::Map {
            length_at: e,
            properties: format_props,
        }) = args_iter.next()
        {
            let mut input_format_vals: Vec<InMemory> = vec![];
            if let Some(EpBinding::Single(addr_type)) = format_props.get("type") {
                input_format_vals.push((*addr_type).into());
            }
            if let Some(EpBinding::Single(addr_units)) = format_props.get("units") {
                input_format_vals.push((*addr_units).into());
            }
            if let Some(EpBinding::Map {
                length_at: _,
                properties: coords_props,
            }) = format_props.get("coords")
            {
                if let Some(EpBinding::Map {
                    length_at: _,
                    properties: forward_props,
                }) = coords_props.get("forward")
                {
                    if let Some(EpBinding::Single(addr_coords_forward_axis)) = forward_props.get("axis") {
                        input_format_vals.push((*addr_coords_forward_axis).into());
                    }
                    if let Some(EpBinding::Single(addr_coords_forward_direction)) = forward_props.get("direction") {
                        input_format_vals.push((*addr_coords_forward_direction).into());
                    }
                }
                if let Some(EpBinding::Map {
                    length_at: _,
                    properties: up_props,
                }) = coords_props.get("up")
                {
                    if let Some(EpBinding::Single(addr_coords_up_axis)) = up_props.get("axis") {
                        input_format_vals.push((*addr_coords_up_axis).into());
                    }
                    if let Some(EpBinding::Single(addr_coords_up_direction)) = up_props.get("direction") {
                        input_format_vals.push((*addr_coords_up_direction).into());
                    }
                }
            }
            input_format_vals
        } else {
            vec![]
        };

        if let Some(_) = args_iter.next() {
            return Err(CompileError::TooManyArgs {
                fn_name: fn_name.into(),
                maximum: 2,
                actual: args_len,
            });
        }

        let mut import_files_arguments = vec![file_path.into()];
        import_files_arguments.extend(file_format);

        instructions.push(Instruction::ImportFiles(import_files::ImportFiles {
            store_response: Some(MemoryArea::Stack),
            arguments: import_files_arguments,
        }));

        instructions.push(Instruction::ApiRequest(ApiRequest {
            endpoint: ModelingCmdEndpoint::ImportFiles,
            store_response: Some(*addr_retval),
            arguments: vec![InMemory::StackPop],
            cmd_id: Uuid::new_v4().into(),
        }));

        let retval_without_enclosing_enum_variant_name = *addr_retval + 1;

        Ok(EvalPlan {
            instructions,
            binding: EpBinding::Single(retval_without_enclosing_enum_variant_name),
        })
    }
}
