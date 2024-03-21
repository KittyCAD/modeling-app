//! Defines functions which are written in Rust, but called from KCL.
//! This includes some of the stdlib, e.g. `startSketchAt`.
//! But some other stdlib functions will be written in KCL.

use kittycad_execution_plan::{
    BinaryArithmetic, BinaryOperation, Destination, Instruction, Operand, UnaryArithmetic, UnaryOperation,
};
use kittycad_execution_plan_traits::Address;

use crate::{CompileError, EpBinding, EvalPlan};

pub mod sketch;

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

/// Unary operator macro to quickly create new bindings.
macro_rules! define_unary {
  () => {};
  ($h:ident$( $r:ident)*) => {
    #[derive(Debug, Clone)]
    #[cfg_attr(test, derive(Eq, PartialEq))]
    pub struct $h;

    impl Callable for $h {
        fn call(&self, ctx: &mut Context<'_>, mut args: Vec<EpBinding>) -> Result<EvalPlan, CompileError> {
            if args.len() > 1 {
                return Err(CompileError::TooManyArgs {
                    fn_name: "$h".into(),
                    maximum: 1,
                    actual: args.len(),
                });
            }

            let not_enough_args = CompileError::NotEnoughArgs {
                fn_name: "$h".into(),
                required: 1,
                actual: args.len(),
            };

            let EpBinding::Single(arg0) = args.pop().ok_or(not_enough_args.clone())? else {
                return Err(CompileError::InvalidOperand("A single value binding is expected"));
            };

            let destination = ctx.next_address.offset_by(1);
            let instructions = vec![
              Instruction::UnaryArithmetic {
                arithmetic: UnaryArithmetic {
                  operation: UnaryOperation::$h,
                  operand: Operand::Reference(arg0)
                },
                destination: Destination::Address(destination)
              }
            ];

            Ok(EvalPlan {
                instructions,
                binding: EpBinding::Single(destination),
            })
        }
    }

    define_unary!($($r)*);
  };
}

define_unary!(Abs Acos Asin Atan Ceil Cos Floor Ln Log10 Log2 Sin Sqrt Tan ToDegrees ToRadians);

/// The identity function. Always returns its first input.
/// Implemented purely on the KCL side so it doesn't need to be in the
/// define_unary! macro above.
#[derive(Debug, Clone)]
#[cfg_attr(test, derive(Eq, PartialEq))]
pub struct Id;

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

/// Binary operator macro to quickly create new bindings.
macro_rules! define_binary {
  () => {};
  ($h:ident$( $r:ident)*) => {
    #[derive(Debug, Clone)]
    #[cfg_attr(test, derive(Eq, PartialEq))]
    pub struct $h;

    impl Callable for $h {
        fn call(&self, ctx: &mut Context<'_>, mut args: Vec<EpBinding>) -> Result<EvalPlan, CompileError> {
          let len = args.len();
          if len > 2 {
              return Err(CompileError::TooManyArgs {
                  fn_name: "$h".into(),
                  maximum: 2,
                  actual: len,
              });
          }
          let not_enough_args = CompileError::NotEnoughArgs {
              fn_name: "$h".into(),
              required: 2,
              actual: len,
          };
          const ERR: &str = "cannot use composite values (e.g. array) as arguments to $h";
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
                      operation: BinaryOperation::$h,
                      operand0: Operand::Reference(arg0),
                      operand1: Operand::Reference(arg1),
                  },
                  destination: Destination::Address(destination),
              }],
              binding: EpBinding::Single(destination),
          })
        }
    }

    define_binary!($($r)*);
  };
}

define_binary!(Add Log Max Min);
