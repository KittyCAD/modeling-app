//! Defines functions which are written in Rust, but called from KCL.
//! This includes some of the stdlib, e.g. `startSketchAt`.
//! But some other stdlib functions will be written in KCL.

use kittycad_execution_plan::{BinaryArithmetic, Destination, Instruction};
use kittycad_execution_plan_traits::Address;

use crate::{CompileError, EpBinding, EvalPlan};

pub mod sketch;

/// The identity function. Always returns its first input.
#[derive(Debug, Clone)]
#[cfg_attr(test, derive(Eq, PartialEq))]
pub struct Id;

pub trait Callable {
    fn call(&self, ctx: &mut Context<'_>, args: Vec<EpBinding>) -> Result<EvalPlan, CompileError>;
}

#[derive(Debug)]
pub struct Context<'a> {
    pub next_address: &'a mut Address,
    pub next_sketch_group: &'a mut usize,
}

impl<'a> Context<'a> {
    pub fn assign_sketch_group(&mut self) -> usize {
        let out = *self.next_sketch_group;
        *self.next_sketch_group += 1;
        out
    }
}

impl Callable for Id {
    fn call(&self, _: &mut Context<'_>, args: Vec<EpBinding>) -> Result<EvalPlan, CompileError> {
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
#[derive(Debug, Clone)]
#[cfg_attr(test, derive(Eq, PartialEq))]
pub struct Add;

impl Callable for Add {
    fn call(&self, ctx: &mut Context<'_>, mut args: Vec<EpBinding>) -> Result<EvalPlan, CompileError> {
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
        let destination = ctx.next_address.offset_by(1);
        Ok(EvalPlan {
            instructions: vec![Instruction::BinaryArithmetic {
                arithmetic: BinaryArithmetic {
                    operation: kittycad_execution_plan::BinaryOperation::Add,
                    operand0: kittycad_execution_plan::Operand::Reference(arg0),
                    operand1: kittycad_execution_plan::Operand::Reference(arg1),
                },
                destination: Destination::Address(destination),
            }],
            binding: EpBinding::Single(destination),
        })
    }
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
