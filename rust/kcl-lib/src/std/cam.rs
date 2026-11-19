use kcl_api::NumericType::{Any, Unknown};
use kcl_error::{KclError, KclErrorDetails};

use crate::ExecState;
use crate::exec::KclValue;
use crate::execution::types::NumericTypeExt;
use crate::execution::types::PrimitiveType::Number;
use crate::execution::types::RuntimeType;
use crate::std::Args;
use crate::std::args::TyF64;

// number needs to be an integer. I could floor it.
pub async fn program(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let target: Option<TyF64> = args.get_kw_arg_opt("number", &RuntimeType::Primitive(Number(Any)), exec_state)?;

    match target {
        Some(TyF64 { n, .. }) => {
            let is_integer = n.floor() == n && n.ceil() == n;

            if !is_integer {
                return Err(KclError::Argument {
                    details: KclErrorDetails::new("Number should be an integer.".to_string(), vec![args.source_range]),
                });
            }
        }
        None => {}
    }

    Ok(KclValue::Number {
        value: 4.0,
        ty: kcl_api::NumericType::count(),
        meta: vec![],
    })
}
