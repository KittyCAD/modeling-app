use kittycad_execution_plan_traits::Address;

use crate::{CompileError, EpBinding, EvalPlan};

use super::Callable;

/// The identity function. Always returns its first input.
#[derive(Debug, Clone)]
#[cfg_attr(test, derive(Eq, PartialEq))]
pub struct Id;

impl Callable for Id {
    fn call(&self, _next_addr: &mut Address, args: Vec<EpBinding>) -> Result<EvalPlan, CompileError> {
        if args.len() > 1 {
            return Err(CompileError::TooManyArgs {
                fn_name: "id".into(),
                maximum: 1,
                actual: args.len(),
            });
        } else if args.len() < 1 {
          return Err(CompileError::NotEnoughArgs {
              fn_name: "id".into(),
              required: 1,
              actual: args.len(),
          });
        }

        let arg = args.get(0).unwrap().clone();

        Ok(EvalPlan {
            instructions: vec![],
            binding: arg,
        })
    }
}

#[test]
fn call_id() {
    let fn_id = Id {};
    let mut addr = Address::ZERO;
    addr = addr.offset_by(1);
    let args = vec![EpBinding::Single(addr)];
    let ep = fn_id.call(&mut addr, args.clone());

    assert_eq!(
        ep,
        Ok(EvalPlan{
          instructions: vec![],
          binding: args.get(0).unwrap().clone()
        })
    );
}

#[test]
fn call_id_too_many_args() {
    let fn_id = Id {};
    let mut addr = Address::ZERO;
    let b1 = EpBinding::Single(addr);
    addr = addr.offset_by(1);
    let b2 = EpBinding::Single(addr);
    addr = addr.offset_by(1);

    let args = vec![b1, b2];
    let ep = fn_id.call(&mut addr, args.clone());

    assert_eq!(
        ep,
        Err(CompileError::TooManyArgs {
            fn_name: "id".into(),
            maximum: 1,
            actual: args.len(),
        })
    );
}

#[test]
fn call_id_not_enough_args() {
    let fn_id = Id {};
    let mut addr = Address::ZERO;
    let args = vec![];
    let ep = fn_id.call(&mut addr, args.clone());

    assert_eq!(
        ep,
        Err(CompileError::NotEnoughArgs {
            fn_name: "id".into(),
            required: 1,
            actual: args.len(),
        })
    );
}
