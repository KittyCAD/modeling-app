//! Standard library support for user-defined failures.

use anyhow::Result;

use crate::errors::KclError;
use crate::errors::KclErrorDetails;
use crate::execution::ExecState;
use crate::execution::KclValue;
use crate::execution::types::RuntimeType;
use crate::std::Args;

pub async fn fail(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let message = args.get_unlabeled_kw_arg("msg", &RuntimeType::string(), exec_state)?;

    // The call expression adds its source range while unwinding. Starting with
    // no ranges records the `fail(...)` call exactly once.
    Err(KclError::new_user_defined(KclErrorDetails::new(message, Vec::new())))
}

#[cfg(test)]
mod tests {
    use crate::docs::kcl_doc::ArgKind;
    use crate::docs::kcl_doc::DocData;
    use crate::docs::kcl_doc::walk_prelude;

    #[test]
    fn fail_prelude_contract_is_experimental_and_returns_never() {
        let prelude = walk_prelude();
        let fail = prelude.find_by_name("fail").unwrap();

        assert!(fail.is_experimental());
        let DocData::Fn(fail) = fail else {
            panic!("expected fail to be a function, found {fail:?}");
        };
        assert_eq!(fail.return_type.as_deref(), Some("never"));
        assert_eq!(fail.args.len(), 1);
        assert_eq!(fail.args[0].name, "msg");
        assert_eq!(fail.args[0].ty.as_deref(), Some("string"));
        assert!(matches!(fail.args[0].kind, ArgKind::Special));
    }
}
