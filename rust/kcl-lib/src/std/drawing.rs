//! Default optional sheet orientation while preserving the KCL enum's nominal identity.

use crate::errors::KclError;
use crate::execution::ExecState;
use crate::execution::KclValue;
use crate::execution::types::RuntimeType;
use crate::std::Args;

pub async fn sheet_orientation(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    // The KCL signatures have already coerced both arguments to drawing::Orientation.
    let orientation: Option<KclValue> = args.get_kw_arg_opt("orientation", &RuntimeType::any(), exec_state)?;
    match orientation {
        Some(value) => Ok(value),
        None => args.get_kw_arg("fallback", &RuntimeType::any(), exec_state),
    }
}
