use crate::{KclError, errors::ExecErrorWithState};

/// Additional attempts after the initial execution when the engine yields a
/// transient error.
const EXECUTE_RETRIES_FROM_ENGINE_ERROR: usize = 2;

/// If execution results in `EngineHangup` or `EngineInternal`, retry.
pub(crate) async fn execute_with_retries<F, Fut, T>(mut execute: F) -> Result<T, ExecErrorWithState>
where
    F: FnMut() -> Fut,
    Fut: Future<Output = Result<T, ExecErrorWithState>>,
{
    let mut retries_remaining = EXECUTE_RETRIES_FROM_ENGINE_ERROR;
    loop {
        // Run the closure to execute.
        let exec_result = execute().await;

        if retries_remaining > 0
            && let Err(error) = &exec_result
            && let crate::errors::ExecError::Kcl(kcl_error) = &error.error
            && matches!(
                &kcl_error.error,
                KclError::EngineHangup { .. } | KclError::EngineInternal { .. }
            )
        {
            let error_type = kcl_error.error.error_type();
            eprintln!("Execute got {error_type}; retrying...");
            retries_remaining -= 1;
            continue;
        }

        return exec_result;
    }
}
