//! Defines functions which are written in Rust, but called from KCL.
//! This includes some of the stdlib, e.g. `startSketchAt`.
//! But some other stdlib functions will be written in KCL.

use kittycad_execution_plan::{Address, Arithmetic, Instruction};

use crate::{CompileError, EpBinding, EvalPlan, KclFunction};

/// The identity function. Always returns its first input.
#[derive(Debug)]
pub struct Id;

impl KclFunction for Id {
    fn call(&self, _: &mut Address, args: Vec<EpBinding>) -> Result<EvalPlan, CompileError> {
        if args.len() > 1 {
            return Err(CompileError::TooManyArgs {
                fn_name: "id".into(),
                maximum: 1,
                actual: args.len(),
            });
        }
        let arg = args
            .first()
            .ok_or(CompileError::NotEnoughArgs {
                fn_name: "id".into(),
                required: 1,
                actual: 0,
            })?
            .clone();
        Ok(EvalPlan {
            instructions: Vec::new(),
            binding: arg,
        })
    }
}

/// A test function that adds two numbers.
#[derive(Debug)]
pub struct Add;

impl KclFunction for Add {
    fn call(&self, next_address: &mut Address, mut args: Vec<EpBinding>) -> Result<EvalPlan, CompileError> {
        let len = args.len();
        if len > 2 {
            return Err(CompileError::TooManyArgs {
                fn_name: "add".into(),
                maximum: 2,
                actual: len,
            });
        }
        let not_enough_args = CompileError::NotEnoughArgs {
            fn_name: "add".into(),
            required: 2,
            actual: len,
        };
        const ERR: &str = "cannot use composite values (e.g. array) as arguments to Add";
        let EpBinding::Single(arg1) = args.pop().ok_or(not_enough_args.clone())? else {
            return Err(CompileError::InvalidOperand(ERR));
        };
        let EpBinding::Single(arg0) = args.pop().ok_or(not_enough_args)? else {
            return Err(CompileError::InvalidOperand(ERR));
        };
        let destination = next_address.offset_by(1);
        Ok(EvalPlan {
            instructions: vec![Instruction::Arithmetic {
                arithmetic: Arithmetic {
                    operation: kittycad_execution_plan::Operation::Add,
                    operand0: kittycad_execution_plan::Operand::Reference(arg0),
                    operand1: kittycad_execution_plan::Operand::Reference(arg1),
                },
                destination,
            }],
            binding: EpBinding::Single(destination),
        })
    }
}
