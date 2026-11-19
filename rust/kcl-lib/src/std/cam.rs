use kcl_api::NumericType::Any;
use kcl_error::{KclError, KclErrorDetails};

use crate::ExecState;
use crate::cam::values::Program;
use crate::cam::values::Unit;
use crate::exec::KclValue;
use crate::execution::Metadata;
use crate::execution::types::NumericTypeExt;
use crate::execution::types::PrimitiveType::Number;
use crate::execution::types::RuntimeType;
use crate::std::Args;
use crate::std::args::TyF64;

// number needs to be an integer. I could floor it.
pub async fn program(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let target: Option<TyF64> = args.get_kw_arg_opt("number", &RuntimeType::Primitive(Number(Any)), exec_state)?;

    // Verify that the number argument is a positive integer
    let n: Option<f64> = if let Some(TyF64 { n, .. }) = target {
        if n < 0. {
            return Err(KclError::Argument {
                details: KclErrorDetails::new(
                    "Number should be a positive integer.".to_string(),
                    vec![args.source_range],
                ),
            });
        }

        let is_integer = n.floor() == n && n.ceil() == n;
        if !is_integer {
            return Err(KclError::Argument {
                details: KclErrorDetails::new("Number should be an integer.".to_string(), vec![args.source_range]),
            });
        }

        Some(n)
    } else {
        None
    };

    let p = Program {
        name: "Welcome!".to_string(),
        number: 42,
        unit: Unit::millimeter,
        meta: vec![Metadata {
            source_range: args.source_range,
        }],
    };

    Ok(KclValue::Program { value: Box::new(p) })
}
