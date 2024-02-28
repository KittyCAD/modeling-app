use kittycad_execution_plan_traits::Address;

use crate::{CompileError, EpBinding, EvalPlan};

use super::Callable;

pub mod id;

/// The identity function. Always returns its first input.
#[derive(Debug, Clone)]
#[cfg_attr(test, derive(Eq, PartialEq))]
pub struct Id;

impl Callable for Id {
    fn call(&self, next_addr: &mut Address, args: Vec<EpBinding>) -> Result<EvalPlan, CompileError> {
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

        // We already verify bounds above. Double bounds checking is unnecessary.
        // If it ever does happen in some event of a cosmic bit flip, we want
        // it to fail.
        let arg = args.get_unchecked(0);

        Ok(EvalPlan {
            instructions: vec![],
            binding: arg,
        })
    }
}

#[test]
fn call_id() {
    const fn_id = Id {};
    let mut addr = Address::ZERO;
    let binding = EpBinding::Single(addr);
    addr = addr.offset_by(1);
    let ep = fn_id.call(addr, vec![binding]);

    assert_eq!(
        ep,
        Ok(EvalPlan{
          instructions: vec![],
          binding
        })
    );
}

#[test]
fn call_id_too_many_args() {
    const fn_id = Id {};
    let mut addr = Address::ZERO;
    let binding = EpBinding::Single(addr);
    addr = addr.offset_by(1);
    let ep = fn_id.call(addr, vec![binding, binding]);

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
    const fn_id = Id {};
    let mut addr = Address::ZERO;
    let binding = EpBinding::Single(addr);
    addr = addr.offset_by(1);
    let ep = fn_id.call(addr, vec![binding, binding]);

    assert_eq!(
        ep,
        Err(CompileError::NotEnoughArgs {
            fn_name: "id".into(),
            required: 1,
            actual: args.len(),
        })
    );
}
